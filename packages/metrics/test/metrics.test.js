import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry, metricsAccess } from '../src/index.js';

test('counters, histograms and gauges render in Prometheus text format', async () => {
  const r = createRegistry();
  const c = r.counter('http_requests_total', 'Requests');
  c.inc({ method: 'GET', status: 200 });
  c.inc({ status: 200, method: 'GET' }, 2); // label order does not matter
  c.inc({ method: 'POST', status: 400 });
  const h = r.histogram('http_request_duration_seconds', 'Latency', [0.1, 1]);
  h.observe({ route: '/x' }, 0.05);
  h.observe({ route: '/x' }, 0.5);
  h.observe({ route: '/x' }, 3);
  r.gauge('queue_depth', 'Depth', () => [{ labels: { queue: 'a"b' }, value: 7 }]);
  r.gauge('broken', 'Fails', () => {
    throw new Error('db down');
  });

  const text = await r.render();
  assert.match(text, /# TYPE localstock_http_requests_total counter/);
  assert.match(text, /localstock_http_requests_total\{method="GET",status="200"\} 3/);
  assert.match(text, /localstock_http_requests_total\{method="POST",status="400"\} 1/);
  assert.match(text, /localstock_http_request_duration_seconds_bucket\{route="\/x",le="0.1"\} 1/);
  assert.match(text, /localstock_http_request_duration_seconds_bucket\{route="\/x",le="1"\} 2/);
  assert.match(text, /localstock_http_request_duration_seconds_bucket\{route="\/x",le="\+Inf"\} 3/);
  assert.match(text, /localstock_http_request_duration_seconds_count\{route="\/x"\} 3/);
  assert.match(text, /localstock_queue_depth\{queue="a\\"b"\} 7/);
  assert.match(text, /# TYPE localstock_broken gauge/, 'a failing gauge keeps its header and does not break the scrape');
  assert.match(text, /localstock_process_uptime_seconds \d+/);
  assert.ok(text.endsWith('\n'));
});

test('metrics access: token when configured, otherwise only outside production', () => {
  assert.equal(metricsAccess({ token: 's3cret', production: true })('Bearer s3cret'), true);
  assert.equal(metricsAccess({ token: 's3cret', production: false })('Bearer nope'), false);
  assert.equal(metricsAccess({ production: true })(undefined), false);
  assert.equal(metricsAccess({ production: false })(undefined), true);
});
