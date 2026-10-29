// Builds every external source from configuration. Platform sources are disabled until an
// authorized adapter exists; a licensed provider is built only from complete configuration;
// the demo fixture source exists only when explicitly enabled outside production.
import { z } from 'zod';
import { DemoFixtureConnector } from './demo-fixture.js';
import { LicensedProviderConnector, licensedProviderConfig } from './licensed-provider.js';
import { NotConfiguredConnector } from './not-configured.js';
import { createPlatformConnector, PLATFORMS } from './platforms.js';

const flag = z.enum(['true', 'false']).default('false');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  EXTERNAL_SOURCE_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(4000),
  EXTERNAL_SEARCH_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  DEMO_EXTERNAL_FIXTURES: flag,
  LICENSED_PROVIDER_ENABLED: flag,
  ...Object.fromEntries(PLATFORMS.map((p) => [`${p.envPrefix}_ENABLED`, flag])),
});

export function loadConnectorConfig(env = process.env) {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid external source configuration:\n${problems}`);
  }
  const config = result.data;
  if (config.NODE_ENV === 'production' && config.DEMO_EXTERNAL_FIXTURES === 'true') {
    throw new Error('DEMO_EXTERNAL_FIXTURES must not be enabled in production: demo data may never be shown as live data');
  }
  return config;
}

/**
 * @returns {{ list(): BaseConnector[], get(code: string): BaseConnector | undefined, enabled(): BaseConnector[], describe(): object[] }}
 */
export function buildConnectorRegistry({ env = process.env, logger, now, fetchImpl } = {}) {
  const config = loadConnectorConfig(env);
  const policy = { timeoutMs: config.EXTERNAL_SOURCE_TIMEOUT_MS, maxConcurrency: config.EXTERNAL_SEARCH_MAX_CONCURRENCY };
  const connectors = [];

  for (const platform of PLATFORMS) {
    connectors.push(createPlatformConnector(platform, { enabled: config[`${platform.envPrefix}_ENABLED`] === 'true', logger, now }));
  }

  const provider = licensedProviderConfig(env);
  if (config.LICENSED_PROVIDER_ENABLED === 'true') {
    if (provider.missing.length) {
      connectors.push(
        new NotConfiguredConnector({
          code: 'licensed-provider',
          platformCode: 'licensed-provider',
          name: 'Licensed data provider',
          accessType: 'LICENSED_PROVIDER',
          missing: provider.missing,
          reason: `LICENSED_PROVIDER_ENABLED is true but configuration is incomplete: missing ${provider.missing.join(', ')}`,
          logger,
          now,
        }),
      );
    } else {
      for (const platformCode of provider.platforms) {
        connectors.push(new LicensedProviderConnector({ platformCode, provider, fetchImpl, policy, logger, now }));
      }
    }
  }

  if (config.DEMO_EXTERNAL_FIXTURES === 'true') connectors.push(new DemoFixtureConnector({ env, policy, logger, now }));

  const byCode = new Map(connectors.map((c) => [c.code, c]));
  return {
    list: () => [...connectors],
    get: (code) => byCode.get(code),
    /** Sources that are configured and may be called. */
    enabled: () => connectors.filter((c) => c.validateConfiguration().ok),
    describe: () => connectors.map((c) => c.describe()),
    close: () => Promise.all(connectors.map((c) => c.close())),
  };
}
