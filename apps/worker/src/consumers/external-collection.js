// The job row is the source of truth: the collector claims it atomically (redeliveries are
// no-ops) and reschedules retries itself, so the message is always acked.
export async function runCollectionConsumer({ channel, queue, collector, logger, onResult = () => {} }) {
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
      onResult(await collector.runJob(jobId));
    } catch (err) {
      // The job stays RUNNING and is re-queued by the scheduler's stuck-job sweep.
      logger.error('collection job crashed', { jobId, err });
    }
    channel.ack(msg);
  });
}

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
