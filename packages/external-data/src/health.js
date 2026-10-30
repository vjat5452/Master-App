// Periodic health of every external source: the connector's own health check combined with
// the last hour of collection runs (error rate, median latency, last success/failure).
// Written to external_source_health; a change of health is recorded as a change event and
// published as external_source.HealthChanged.
import { withTransaction } from '@localstock/database';
import { recordChange } from './observations.js';
import { createSourceRegistry } from './sources.js';

const MIN_RUNS_FOR_RATE = 3;

/** Pure: overall health from the connector's answer and recent run statistics. */
export function deriveHealth(check, stats) {
  if (check.health === 'NOT_CONFIGURED') return 'NOT_CONFIGURED';
  if (check.health === 'DOWN') return 'DOWN';
  if (stats.total >= MIN_RUNS_FOR_RATE) {
    if (stats.errorRate === 1) return 'DOWN';
    if (stats.errorRate >= 0.5) return 'DEGRADED';
  }
  if (check.health === 'HEALTHY') return 'HEALTHY';
  // UNKNOWN from the connector: recent successful runs are the best evidence available.
  return stats.total > 0 && stats.errorRate < 0.5 ? 'HEALTHY' : 'UNKNOWN';
}

export function createHealthJob({ pool, connectors, logger, sources = createSourceRegistry({ pool }) }) {
  return async function checkSourceHealth() {
    const results = [];
    for (const connector of connectors.list()) {
      try {
        const { sourceId } = await sources.ensure(connector);
        const check = await connector.healthCheck();
        const { rows } = await pool.query(
          `SELECT count(*)::int AS total,
                  count(*) FILTER (WHERE status = 'FAILED')::int AS failed,
                  percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50,
                  max(completed_at) FILTER (WHERE status = 'SUCCEEDED') AS last_success,
                  max(completed_at) FILTER (WHERE status = 'FAILED') AS last_failure,
                  (array_agg(error_code ORDER BY completed_at DESC) FILTER (WHERE status = 'FAILED'))[1] AS last_error
             FROM external_collection_runs
            WHERE source_id = $1 AND status <> 'RUNNING' AND started_at > now() - interval '1 hour'`,
          [sourceId],
        );
        const r = rows[0];
        const stats = { total: r.total, errorRate: r.total ? r.failed / r.total : 0 };
        const health = deriveHealth(check, stats);

        await withTransaction(pool, async (client) => {
          const { rows: prev } = await client.query('SELECT health FROM external_source_health WHERE source_id = $1 FOR UPDATE', [sourceId]);
          await client.query(
            `INSERT INTO external_source_health (source_id, health, circuit_state, last_success_at, last_failure_at, last_error_code, latency_p50_ms, error_rate, checked_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
             ON CONFLICT (source_id) DO UPDATE SET
               health = EXCLUDED.health, circuit_state = EXCLUDED.circuit_state,
               last_success_at = COALESCE(EXCLUDED.last_success_at, external_source_health.last_success_at),
               last_failure_at = COALESCE(EXCLUDED.last_failure_at, external_source_health.last_failure_at),
               last_error_code = COALESCE(EXCLUDED.last_error_code, external_source_health.last_error_code),
               latency_p50_ms = EXCLUDED.latency_p50_ms, error_rate = EXCLUDED.error_rate, checked_at = now()`,
            [
              sourceId,
              health,
              check.circuitState ?? 'CLOSED',
              r.last_success,
              r.last_failure,
              r.last_error ?? check.errorCode ?? null,
              r.p50 === null ? null : Math.round(r.p50),
              r.total ? Math.round(stats.errorRate * 10_000) / 10_000 : null,
            ],
          );
          if (prev[0] && prev[0].health !== health) {
            await recordChange(client, {
              entityType: 'SOURCE_HEALTH',
              sourceId,
              sourceCode: connector.code,
              oldValue: { health: prev[0].health },
              newValue: { health },
              aggregateId: sourceId,
            });
          }
        });
        results.push({ source: connector.code, health });
      } catch (err) {
        logger.warn('source health check failed', { source: connector.code, err: err.message });
        results.push({ source: connector.code, health: 'UNKNOWN', error: true });
      }
    }
    return results;
  };
}
