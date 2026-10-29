// Write an event in the same transaction as the business change. The worker publishes it later,
// so a broker outage can delay an event but never lose one. Returns the event id.
export async function enqueueEvent(client, { eventType, aggregateType, aggregateId, payload }) {
  const { rows } = await client.query(
    `INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [eventType, aggregateType, aggregateId, JSON.stringify(payload)],
  );
  return rows[0]?.id;
}
