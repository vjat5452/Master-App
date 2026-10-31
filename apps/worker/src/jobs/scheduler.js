// Runs never overlap; stop() waits for the in-flight run.
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
