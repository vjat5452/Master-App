// Release, API and worker in one process: Render's free plan has no background workers or pre-deploy commands.
import http from 'node:http';
import { createLogger } from '@localstock/logger';

// Bind the port immediately or the host gives up on the service; the API takes it over after release.
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

// The API's own signal handler closes the server and exits; stop the worker alongside it.
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => worker.stop());
