// Consumes collection jobs. The job row in PostgreSQL is the source of truth: the collector
// claims it atomically (so a redelivered message is a no-op), records success or failure,
// and reschedules retryable failures itself. The message is therefore always acknowledged.
export async function runCollectionConsumer({ channel, queue, collector, logger }) {
  await channel.consume(queue, async (msg) => {
    if (!msg) return;
    let jobId;
    try {
      ({ jobId } = JSON.parse(msg.content.toString('utf8')));
    } catch {
      logger.error('poison collection message: invalid JSON, dead-lettering', { queue });
      return channel.nack(msg, false, false);
    }
    try {
      await collector.runJob(jobId);
    } catch (err) {
      // Database trouble mid-job: the job stays RUNNING and is re-queued by the scheduler's
      // stuck-job sweep.
      logger.error('collection job crashed', { jobId, err });
    }
    channel.ack(msg);
  });
}

/** Publishes one job id to the collection queue and waits for the broker's confirm. */
export function createJobPublisher(confirmChannel, queue) {
  return async (jobId, priority) => {
    confirmChannel.sendToQueue(queue, Buffer.from(JSON.stringify({ jobId })), {
      messageId: jobId,
      contentType: 'application/json',
      persistent: true,
      priority,
    });
    await confirmChannel.waitForConfirms();
  };
}
