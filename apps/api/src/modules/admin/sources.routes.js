// ACTIVE is only ever set here by an admin, for a configured non-demo source with an evidence note.
import { z } from 'zod';
import { PLATFORMS } from '@localstock/connectors';
import { withTransaction } from '@localstock/database';
import { createSourceRegistry } from '@localstock/external-data';
import { writeAudit } from '../../shared/audit.js';
import { AppError, notFound } from '../../shared/errors.js';
import { validate } from '../../shared/validate.js';

const codeParams = z.object({ code: z.string().regex(/^[a-z0-9][a-z0-9-]{1,49}$/) });
const runsQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });
const statusBody = z
  .object({
    integrationStatus: z.enum(['RESEARCH_REQUIRED', 'ACCESS_REQUESTED', 'SANDBOX', 'APPROVED', 'ACTIVE', 'DISABLED']),
    note: z.string().trim().max(1000).optional(),
  })
  .refine((b) => b.integrationStatus !== 'ACTIVE' || (b.note && b.note.length >= 10), {
    message: 'Marking a source ACTIVE needs a note describing the acceptance tests it passed',
    path: ['note'],
  });

const DOCS = Object.fromEntries(PLATFORMS.map((p) => [p.code, p.doc]));

export function registerSourceRoutes(router, { pool, connectors }) {
  const sources = createSourceRegistry({ pool });
  const connectorOr404 = (code) => {
    const connector = connectors.list().find((c) => c.code === code);
    if (!connector) throw notFound('SOURCE_NOT_FOUND', 'No source with this code is configured in this deployment');
    return connector;
  };

  router.get('/admin/external-platforms', async (_req, res) => {
    // Every source this deployment knows about has a row, so the page shows all of them.
    await Promise.all(connectors.list().map((c) => sources.ensure(c)));
    const { rows } = await pool.query(
      `SELECT p.id AS platform_id, p.code AS platform_code, p.name AS platform_name, p.is_demo, p.status AS platform_status,
              s.id AS source_id, s.code, s.name, s.access_type, s.integration_status, s.capabilities, s.updated_at,
              h.health, h.circuit_state, h.last_success_at, h.last_failure_at, h.last_error_code, h.latency_p50_ms, h.error_rate, h.checked_at,
              r.total AS runs_24h, r.failed AS failed_24h, r.last_run_at,
              (SELECT count(DISTINCT m.listing_id)::int FROM external_product_mappings m JOIN external_listings l ON l.id = m.listing_id
                WHERE l.platform_id = p.id AND m.match_status = 'NEEDS_REVIEW') AS open_reviews,
              (SELECT count(*)::int FROM external_listings l WHERE l.platform_id = p.id) AS listings
         FROM external_platforms p
         LEFT JOIN external_sources s ON s.platform_id = p.id
         LEFT JOIN external_source_health h ON h.source_id = s.id
         LEFT JOIN LATERAL (
           SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'FAILED')::int AS failed, max(started_at) AS last_run_at
             FROM external_collection_runs WHERE source_id = s.id AND started_at > now() - interval '24 hours'
         ) r ON true
        ORDER BY p.is_demo, p.name, s.code`,
    );

    const platforms = new Map();
    for (const r of rows) {
      if (!platforms.has(r.platform_id)) {
        platforms.set(r.platform_id, {
          platform: { id: r.platform_id, code: r.platform_code, name: r.platform_name, isDemo: r.is_demo, status: r.platform_status, doc: DOCS[r.platform_code] ?? null },
          listings: r.listings,
          openReviews: r.open_reviews,
          sources: [],
        });
      }
      if (!r.source_id) continue;
      const connector = connectors.list().find((c) => c.code === r.code);
      const setup = connector?.validateConfiguration();
      platforms.get(r.platform_id).sources.push({
        code: r.code,
        name: r.name,
        accessType: r.access_type,
        integrationStatus: r.integration_status,
        // Whether this deployment can call it right now.
        configured: Boolean(setup?.ok),
        inThisDeployment: Boolean(connector),
        reason: setup && !setup.ok ? setup.reason : null,
        missing: setup && !setup.ok ? setup.missing : [],
        capabilities: r.capabilities,
        health: r.health
          ? {
              status: r.health,
              circuitState: r.circuit_state,
              lastSuccessAt: r.last_success_at,
              lastFailureAt: r.last_failure_at,
              lastErrorCode: r.last_error_code,
              latencyP50Ms: r.latency_p50_ms,
              errorRate: r.error_rate === null ? null : Number(r.error_rate),
              checkedAt: r.checked_at,
            }
          : null,
        runs24h: { total: r.runs_24h, failed: r.failed_24h, lastRunAt: r.last_run_at },
        updatedAt: r.updated_at,
      });
    }
    res.json({ items: [...platforms.values()] });
  });

  router.get('/admin/external-sources/:code/runs', validate({ params: codeParams, query: runsQuery }), async (req, res) => {
    const { rows } = await pool.query(
      `SELECT r.id, r.status, r.started_at, r.completed_at, r.items_received, r.items_valid, r.items_rejected,
              r.observations_written, r.latency_ms, r.error_code, r.error_message, j.query_cell, j.job_type
         FROM external_collection_runs r
         JOIN external_sources s ON s.id = r.source_id
         LEFT JOIN external_collection_jobs j ON j.id = r.job_id
        WHERE s.code = $1
        ORDER BY r.started_at DESC LIMIT $2`,
      [req.valid.params.code, req.valid.query.limit],
    );
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        status: r.status,
        jobType: r.job_type,
        cell: r.query_cell,
        startedAt: r.started_at,
        completedAt: r.completed_at,
        itemsReceived: r.items_received,
        itemsValid: r.items_valid,
        itemsRejected: r.items_rejected,
        observationsWritten: r.observations_written,
        latencyMs: r.latency_ms,
        errorCode: r.error_code,
        errorMessage: r.error_message,
      })),
    });
  });

  router.post('/admin/external-sources/:code/test-connection', validate({ params: codeParams }), async (req, res) => {
    const connector = connectorOr404(req.valid.params.code);
    const started = Date.now();
    const result = await connector.healthCheck();
    res.json({ source: connector.code, ...result, durationMs: Date.now() - started });
  });

  router.patch('/admin/external-sources/:code/status', validate({ params: codeParams, body: statusBody }), async (req, res) => {
    const { code } = req.valid.params;
    const { integrationStatus, note } = req.valid.body;
    const connector = connectors.list().find((c) => c.code === code);
    if (integrationStatus === 'ACTIVE') {
      if (!connector || !connector.validateConfiguration().ok) {
        throw new AppError(422, 'SOURCE_NOT_CONFIGURED', 'Only a source configured in this deployment can be marked ACTIVE');
      }
      if (connector.isDemo || connector.accessType === 'DEMO_FIXTURE') {
        throw new AppError(422, 'DEMO_SOURCE', 'Demo fixture sources can never be ACTIVE');
      }
    }
    const updated = await withTransaction(pool, async (client) => {
      const { rows } = await client.query('SELECT id, integration_status FROM external_sources WHERE code = $1 FOR UPDATE', [code]);
      if (!rows[0]) throw notFound('SOURCE_NOT_FOUND', 'Source not found');
      await client.query('UPDATE external_sources SET integration_status = $2, updated_at = now() WHERE id = $1', [rows[0].id, integrationStatus]);
      await writeAudit(client, {
        actorUserId: req.user.id,
        action: 'external_source.status_changed',
        entityType: 'external_source',
        entityId: rows[0].id,
        before: { integrationStatus: rows[0].integration_status },
        after: { integrationStatus, note: note ?? null },
        sourceOfChange: 'ADMIN',
      });
      return { code, integrationStatus, previous: rows[0].integration_status };
    });
    res.json(updated);
  });
}
