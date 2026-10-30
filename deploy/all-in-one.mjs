// One process running the release step, the API and the worker, for hosts whose free plan
// offers neither background workers nor pre-deploy commands (e.g. Render free web services).
// Elsewhere, run the API and worker as separate services (their own Dockerfiles).
//
//   1. a placeholder server takes the port at once (hosts give up on a service that does not
//      bind its port in time) and answers 503 "starting", except 200 on /health/live;
//   2. release: migrations, then demo data when SEED_DEMO_DATA=true (exits on failure);
//   3. the API replaces the placeholder on the same port;
//   4. the worker (outbox, consumers, scheduled jobs). If the broker connection drops, the
//      process exits and the host restarts it.
import http from 'node:http';
import { createLogger } from '@localstock/logger';

const port = Number(process.env.API_PORT ?? process.env.PORT ?? 5000);
const placeholder = http.createServer((req, res) => {
  const live = req.url === '/health/live';
  res.writeHead(live ? 200 : 503, { 'content-type': 'application/json', 'retry-after': '30' });
  res.end(JSON.stringify(live ? { status: 'ok' } : { error: { code: 'STARTING', message: 'Starting up, try again shortly' } }));
});
await new Promise((resolve) => placeholder.listen(port, resolve));
console.log(`starting: placeholder listening on port ${port}`);

await import('../apps/api/src/scripts/release.js');

await new Promise((resolve) => {
  placeholder.close(resolve);
  placeholder.closeAllConnections();
});
await import('../apps/api/src/server.js');

const { loadConfig } = await import('../apps/worker/src/config.js');
const { startWorker } = await import('../apps/worker/src/start-worker.js');
const config = loadConfig();
const logger = createLogger({ level: config.LOG_LEVEL, base: { service: 'worker' } });
const worker = await startWorker({ config, logger });

// The API's own handler closes the HTTP server and exits; stop the worker alongside it.
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => worker.stop());
