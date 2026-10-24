export const EVENTS_EXCHANGE = 'localstock.events';
export const DEAD_LETTER_EXCHANGE = 'localstock.dlx';
export const DEAD_LETTER_QUEUE = 'localstock.dead-letter';

// Routing key is `<aggregateType>.<EventType>`, e.g. `order.OrderConfirmed`.
export const QUEUES = Object.freeze({
  notifications: { name: 'localstock.notifications', bindings: ['order.#'] },
  searchProjection: { name: 'localstock.search-projection', bindings: ['inventory.#', 'offer.#'] },
});

export const routingKey = (aggregateType, eventType) => `${aggregateType}.${eventType}`;

export async function assertTopology(channel) {
  await channel.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
  await channel.assertExchange(DEAD_LETTER_EXCHANGE, 'fanout', { durable: true });
  await channel.assertQueue(DEAD_LETTER_QUEUE, { durable: true });
  await channel.bindQueue(DEAD_LETTER_QUEUE, DEAD_LETTER_EXCHANGE, '');

  for (const queue of Object.values(QUEUES)) {
    await channel.assertQueue(queue.name, { durable: true, deadLetterExchange: DEAD_LETTER_EXCHANGE });
    for (const pattern of queue.bindings) await channel.bindQueue(queue.name, EVENTS_EXCHANGE, pattern);
  }
}
