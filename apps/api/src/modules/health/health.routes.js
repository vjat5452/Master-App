import { Router } from 'express';

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function check(fn) {
  const start = Date.now();
  try {
    await withTimeout(fn(), 2000);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function createHealthRouter({ pool, redis, state }) {
  const router = Router();

  // Liveness: the process is up and serving. Never checks dependencies.
  router.get('/health/live', (_req, res) => res.json({ status: 'ok' }));

  // Readiness: safe to route traffic here. Fails while shutting down or if a dependency is down.
  router.get('/health/ready', async (_req, res) => {
    const [postgres, cache] = await Promise.all([check(() => pool.query('SELECT 1')), check(() => redis.ping())]);
    const ready = !state.shuttingDown && postgres.ok && cache.ok;
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      shuttingDown: state.shuttingDown,
      checks: { postgres, redis: cache },
    });
  });

  return router;
}
