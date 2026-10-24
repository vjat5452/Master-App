// Write an event in the same transaction as the business change. The worker publishes it later,
// so a broker outage can delay an event but never lose one.
export async function enqueueEvent(client, { eventType, aggregateType, aggregateId, payload }) {
  await client.query(
    `INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
     VALUES ($1, $2, $3, $4)`,
    [eventType, aggregateType, aggregateId, JSON.stringify(payload)],
  );
}
