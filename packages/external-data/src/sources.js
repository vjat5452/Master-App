// Never sets ACTIVE: that is an operator decision after acceptance tests against the real source.

const CONFIG_REFERENCE = {
  DEMO_FIXTURE: 'DEMO_EXTERNAL_FIXTURES',
  LICENSED_PROVIDER: 'LICENSED_PROVIDER_*',
};

export function createSourceRegistry({ pool }) {
  const cache = new Map(); // connector code -> Promise<{ sourceId, platformId }>

  async function register(connector) {
    const { rows: platform } = await pool.query(
      // Real platforms are seeded by migration 002; only a new (e.g. demo) platform is created here.
      `INSERT INTO external_platforms (code, name, is_demo, status) VALUES ($1, $2, $3, 'ACTIVE')
       ON CONFLICT (code) DO UPDATE SET updated_at = now() RETURNING id`,
      [connector.platformCode, connector.isDemo ? connector.name : connector.platformName ?? connector.platformCode, connector.isDemo],
    );
    const configured = connector.validateConfiguration().ok;
    const capabilities = Object.entries(connector.capabilities ?? {})
      .filter(([, state]) => state === 'SUPPORTED')
      .map(([name]) => name);
    const { rows: source } = await pool.query(
      `INSERT INTO external_sources (platform_id, code, name, access_type, integration_status, config_reference, capabilities)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, capabilities = EXCLUDED.capabilities, updated_at = now()
       RETURNING id, platform_id`,
      [
        platform[0].id,
        connector.code,
        connector.name,
        connector.accessType,
        configured ? 'SANDBOX' : 'RESEARCH_REQUIRED',
        CONFIG_REFERENCE[connector.accessType] ?? null,
        capabilities,
      ],
    );
    return { sourceId: source[0].id, platformId: source[0].platform_id };
  }

  return {
    ensure(connector) {
      if (!cache.has(connector.code)) {
        const pending = register(connector);
        pending.catch(() => cache.delete(connector.code)); // retry on the next call
        cache.set(connector.code, pending);
      }
      return cache.get(connector.code);
    },
  };
}
