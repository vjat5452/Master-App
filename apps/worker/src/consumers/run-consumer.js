import { withTransaction } from '@localstock/database';

export const backoffMs = (attempt) => Math.min(30_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);

/**
 * Consume a queue with inbox deduplication: the message id is recorded in the same transaction
 * as the handler's database effects, so a redelivered message is acknowledged without being
 * applied twice. Failures are retried with exponential backoff and jitter, then dead-lettered.
 */
export async function runConsumer({ channel, pool, logger, queue, consumer, handle, maxAttempts = 5 }) {
  await channel.consume(queue, async (msg) => {
    if (!msg) return;
    const messageId = msg.properties.messageId;
    const attempt = Number(msg.properties.headers?.['x-attempt'] ?? 0);

    let event;
    try {
      event = JSON.parse(msg.content.toString('utf8'));
    } catch {
      logger.error('poison message: invalid JSON, dead-lettering', { queue, messageId });
      return channel.nack(msg, false, false);
    }
    if (!messageId) {
      logger.error('poison message: missing messageId, dead-lettering', { queue });
      return channel.nack(msg, false, false);
    }

    try {
      await withTransaction(pool, async (client) => {
        const { rowCount } = await client.query(
          'INSERT INTO inbox_events (consumer, message_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [consumer, messageId],
        );
        if (rowCount === 0) return; // already processed
        await handle(event, { client, logger });
      });
      channel.ack(msg);
    } catch (err) {
      if (attempt + 1 >= maxAttempts) {
        logger.error('message failed permanently, dead-lettering', { queue, messageId, attempt, err });
        return channel.nack(msg, false, false);
      }
      const delay = backoffMs(attempt);
      logger.warn('message failed, scheduling retry', { queue, messageId, attempt, delayMs: delay, err });
      setTimeout(() => {
        channel.sendToQueue(queue, msg.content, {
          ...msg.properties,
          headers: { ...msg.properties.headers, 'x-attempt': attempt + 1 },
        });
        channel.ack(msg);
      }, delay);
    }
  });
}
