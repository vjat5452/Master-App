// API metrics. Route labels are Express route patterns (e.g. /api/v1/orders/:orderId), never
// raw URLs, so ids and query strings cannot explode the number of series.
import { createRegistry, metricsAccess } from '@localstock/metrics';

export function createApiMetrics() {
  const registry = createRegistry();
  const requests = registry.counter('http_requests_total', 'HTTP requests by method, route pattern and status');
  const duration = registry.histogram('http_request_duration_seconds', 'HTTP request duration by method and route pattern');
  const compareSources = registry.counter('compare_source_results_total', 'Comparison answers per source and outcome');
  return { registry, requests, duration, compareSources };
}

/**
 * Records every request once it finishes. Express has reset req.baseUrl by then, so the
 * /api/v1 mount (the only router mount) is restored from the URL.
 */
export function metricsMiddleware(metrics) {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const prefix = req.originalUrl.startsWith('/api/v1/') ? '/api/v1' : '';
      const route = req.route ? `${prefix}${req.route.path}` : 'unmatched';
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      metrics.requests.inc({ method: req.method, route, status: res.statusCode });
      metrics.duration.observe({ method: req.method, route }, seconds);
    });
    next();
  };
}

/** GET /metrics: 404 unless allowed (token, or any caller outside production). */
export function metricsHandler(metrics, config) {
  const allowed = metricsAccess({ token: config.METRICS_TOKEN, production: config.NODE_ENV === 'production' });
  return async (req, res) => {
    if (!allowed(req.get('authorization'))) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found', requestId: req.id } });
    res.set('content-type', metrics.registry.contentType).send(await metrics.registry.render());
  };
}
