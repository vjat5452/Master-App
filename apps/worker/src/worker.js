import { createLogger } from '@localstock/logger';
import { loadConfig } from './config.js';
import { startWorker } from './start-worker.js';

const config = loadConfig();
const logger = createLogger({ level: config.LOG_LEVEL, base: { service: 'worker' } });

const worker = await startWorker({ config, logger });

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutting down', { signal });
  setTimeout(() => process.exit(1), 15_000).unref();
  await worker.stop();
  logger.info('shutdown complete');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
