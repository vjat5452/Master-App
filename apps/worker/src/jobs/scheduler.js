// Run a job repeatedly without overlapping runs. stop() waits for an in-flight run to finish.
export function every(name, intervalMs, job, logger) {
  let timer = null;
  let running = Promise.resolve();
  let stopped = false;

  const tick = async () => {
    try {
      await job();
    } catch (err) {
      logger.error('job failed', { job: name, err });
    }
    if (!stopped) timer = setTimeout(run, intervalMs);
  };
  const run = () => {
    running = tick();
  };

  run();
  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
