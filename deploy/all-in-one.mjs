// One process running the release step, the API and the worker, for hosts whose free plan
// offers neither background workers nor pre-deploy commands (e.g. Render free web services).
// Elsewhere, run the API and worker as separate services (their own Dockerfiles).
//
//   1. release: migrations, then demo data when SEED_DEMO_DATA=true (exits on failure);
//   2. the API (listens on PORT);
//   3. the worker (outbox, consumers, scheduled jobs). If the broker connection drops, the
//      process exits and the host restarts it.
import { createLogger } from '@localstock/logger';

await import('../apps/api/src/scripts/release.js');
await import('../apps/api/src/server.js');

const { loadConfig } = await import('../apps/worker/src/config.js');
const { startWorker } = await import('../apps/worker/src/start-worker.js');
const config = loadConfig();
const logger = createLogger({ level: config.LOG_LEVEL, base: { service: 'worker' } });
const worker = await startWorker({ config, logger });

// The API's own handler closes the HTTP server and exits; stop the worker alongside it.
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => worker.stop());
