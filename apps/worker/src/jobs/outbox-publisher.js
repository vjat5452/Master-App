import { withTransaction } from '@localstock/database';
import { EVENTS_EXCHANGE, routingKey } from '../messaging/topology.js';

// SKIP LOCKED lets several workers share the table. A broker failure rolls the batch back,
// so delivery is at least once and consumers dedupe by message id.
export function createOutboxPublisher({ pool, channel, logger, batchSize = 100 }) {
  return async function publishOutbox() {
    const published = await withTransaction(pool, async (client) => {
      const { rows } = await client.query(
        `SELECT id, event_type, aggregate_type, aggregate_id, payload, created_at
           FROM outbox_events
          WHERE published_at IS NULL
          ORDER BY created_at
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [batchSize],
      );
      if (rows.length === 0) return 0;

      for (const row of rows) {
        const message = {
          id: row.id,
          type: row.event_type,
          aggregateType: row.aggregate_type,
          aggregateId: row.aggregate_id,
          occurredAt: row.created_at,
          payload: row.payload,
        };
        channel.publish(EVENTS_EXCHANGE, routingKey(row.aggregate_type, row.event_type), Buffer.from(JSON.stringify(message)), {
          messageId: row.id,
          type: row.event_type,
          contentType: 'application/json',
          persistent: true,
          timestamp: Math.floor(row.created_at.getTime() / 1000),
        });
      }
      await channel.waitForConfirms();

      await client.query('UPDATE outbox_events SET published_at = now(), attempts = attempts + 1 WHERE id = ANY($1::uuid[])', [rows.map((r) => r.id)]);
      return rows.length;
    });

    if (published > 0) logger.debug('published outbox events', { count: published });
    return published;
  };
}
