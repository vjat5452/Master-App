// Deletes in small batches to avoid long locks; table order follows foreign keys.
// Listings and product mappings are never deleted.

const BATCH = 5000;

const STEPS = [
  { table: 'external_change_events', where: 'detected_at < now() - make_interval(days => $1)', days: 'external' },
  { table: 'external_price_observations', where: 'collected_at < now() - make_interval(days => $1)', days: 'external' },
  { table: 'external_availability_observations', where: 'collected_at < now() - make_interval(days => $1)', days: 'external' },
  { table: 'external_offer_observations', where: 'collected_at < now() - make_interval(days => $1)', days: 'external' },
  {
    table: 'external_serviceability_observations',
    where: `collected_at < now() - make_interval(days => $1)
            AND NOT EXISTS (SELECT 1 FROM external_availability_observations a WHERE a.serviceability_observation_id = t.id)`,
    days: 'external',
  },
  {
    table: 'external_collection_runs',
    where: `started_at < now() - make_interval(days => $1) AND status <> 'RUNNING'
            AND NOT EXISTS (SELECT 1 FROM external_price_observations o WHERE o.run_id = t.id)
            AND NOT EXISTS (SELECT 1 FROM external_availability_observations o WHERE o.run_id = t.id)
            AND NOT EXISTS (SELECT 1 FROM external_offer_observations o WHERE o.run_id = t.id)
            AND NOT EXISTS (SELECT 1 FROM external_serviceability_observations o WHERE o.run_id = t.id)`,
    days: 'external',
  },
  {
    table: 'external_collection_jobs',
    where: `updated_at < now() - make_interval(days => $1) AND status IN ('SUCCEEDED', 'FAILED', 'CANCELLED')
            AND NOT EXISTS (SELECT 1 FROM external_collection_runs r WHERE r.job_id = t.id)`,
    days: 'external',
  },
  {
    table: 'outbox_events',
    where: `published_at IS NOT NULL AND published_at < now() - make_interval(days => $1)
            AND NOT EXISTS (SELECT 1 FROM external_change_events c WHERE c.outbox_event_id = t.id)`,
    days: 'events',
  },
  { table: 'inbox_events', where: 'processed_at < now() - make_interval(days => $1)', days: 'events' },
];

export function createRetentionJob({ pool, logger, externalDays, eventDays, batch = BATCH }) {
  return async function applyRetention() {
    const deleted = {};
    for (const step of STEPS) {
      const days = step.days === 'external' ? externalDays : eventDays;
      let total = 0;
      for (;;) {
        const { rowCount } = await pool.query(
          `DELETE FROM ${step.table} WHERE ctid IN (SELECT t.ctid FROM ${step.table} t WHERE ${step.where} LIMIT $2)`,
          [days, batch],
        );
        total += rowCount;
        if (rowCount < batch) break;
      }
      if (total) deleted[step.table] = total;
    }
    if (Object.keys(deleted).length) logger.info('retention applied', { deleted, externalDays, eventDays });
    return deleted;
  };
}
