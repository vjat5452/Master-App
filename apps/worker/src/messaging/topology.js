export const EVENTS_EXCHANGE = 'localstock.events';
export const DEAD_LETTER_EXCHANGE = 'localstock.dlx';
export const DEAD_LETTER_QUEUE = 'localstock.dead-letter';

// Routing key is `<aggregateType>.<EventType>`, e.g. `order.OrderConfirmed`.
export const QUEUES = Object.freeze({
  notifications: { name: 'localstock.notifications', bindings: ['order.#'] },
  searchProjection: { name: 'localstock.search-projection', bindings: ['inventory.#', 'offer.#', 'company.#', 'warehouse.#'] },
  externalChanges: { name: 'localstock.external-changes', bindings: ['external_price.#', 'external_availability.#', 'external_serviceability.#'] },
  // Sent directly by the refresh scheduler; more demanded queries get higher priority.
  externalCollection: { name: 'localstock.external-collection', bindings: [], maxPriority: 9 },
});

export const routingKey = (aggregateType, eventType) => `${aggregateType}.${eventType}`;

export async function assertTopology(channel) {
  await channel.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
  await channel.assertExchange(DEAD_LETTER_EXCHANGE, 'fanout', { durable: true });
  await channel.assertQueue(DEAD_LETTER_QUEUE, { durable: true });
  await channel.bindQueue(DEAD_LETTER_QUEUE, DEAD_LETTER_EXCHANGE, '');

  for (const queue of Object.values(QUEUES)) {
    await channel.assertQueue(queue.name, {
      durable: true,
      deadLetterExchange: DEAD_LETTER_EXCHANGE,
      ...(queue.maxPriority ? { maxPriority: queue.maxPriority } : {}),
    });
    for (const pattern of queue.bindings) await channel.bindQueue(queue.name, EVENTS_EXCHANGE, pattern);
  }
}
