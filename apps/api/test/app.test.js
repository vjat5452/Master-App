// HTTP-level tests that need no infrastructure: the database and Redis are stubbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createLogger } from '@localstock/logger';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';

const config = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  PAYMENT_WEBHOOK_SECRET: 'test-webhook-secret',
});

function makeApp({ dbUp = true } = {}) {
  const queries = [];
  const pool = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (!dbUp) throw new Error('connection refused');
      return { rows: [], rowCount: 0 };
    },
  };
  const redis = {
    ping: async () => 'PONG',
    get: async () => null,
    set: async () => 'OK',
    incr: async () => {
      throw new Error('redis down');
    },
    expire: async () => 1,
  };
  const app = createApp({ config, logger: createLogger({ level: 'silent' }), pool, redis, state: { shuttingDown: false } });
  return { app, queries };
}

const token = (sub = '6f1c1d2e-0000-4000-8000-000000000001', role = 'USER') =>
  jwt.sign({ role }, config.JWT_ACCESS_SECRET, { subject: sub, issuer: 'localstock', expiresIn: 60 });

test('liveness never depends on infrastructure', async () => {
  const { app } = makeApp({ dbUp: false });
  const res = await request(app).get('/health/live');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: 'ok' });
});

test('readiness reports a failed dependency with 503', async () => {
  const { app } = makeApp({ dbUp: false });
  const res = await request(app).get('/health/ready');
  assert.equal(res.status, 503);
  assert.equal(res.body.checks.postgres.ok, false);
  assert.equal(res.body.checks.redis.ok, true);
});

test('request ids are generated and echoed', async () => {
  const { app } = makeApp();
  const res = await request(app).get('/health/live').set('x-request-id', 'abc-123');
  assert.equal(res.headers['x-request-id'], 'abc-123');
});

test('validation errors are explicit and reach no database', async () => {
  const { app, queries } = makeApp();
  const res = await request(app).post('/api/v1/auth/register').send({ name: '', email: 'not-an-email', password: 'short' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_FAILED');
  assert.deepEqual(res.body.error.details.map((d) => d.path).sort(), ['body.email', 'body.name', 'body.password']);
  assert.equal(queries.length, 0);
});

test('malformed JSON is a 400, not a 500', async () => {
  const { app } = makeApp();
  const res = await request(app).post('/api/v1/auth/login').set('content-type', 'application/json').send('{"email":');
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'MALFORMED_JSON');
});

test('seller routes require authentication', async () => {
  const { app } = makeApp();
  const res = await request(app).get('/api/v1/companies/6f1c1d2e-0000-4000-8000-000000000002/warehouses');
  assert.equal(res.status, 401);
});

test('non-members get 404 for a company, so ids cannot be probed', async () => {
  const { app } = makeApp();
  const res = await request(app)
    .get('/api/v1/companies/6f1c1d2e-0000-4000-8000-000000000002/inventory')
    .set('authorization', `Bearer ${token()}`);
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'COMPANY_NOT_FOUND');
});

test('tampered tokens are rejected', async () => {
  const { app } = makeApp();
  const forged = jwt.sign({ role: 'ADMIN' }, 'some-other-secret-that-is-long-enough!!', { subject: 'x', issuer: 'localstock' });
  const res = await request(app).get('/api/v1/users/me').set('authorization', `Bearer ${forged}`);
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'INVALID_TOKEN');
});

test('catalog admin routes need the platform admin role', async () => {
  const { app } = makeApp();
  const res = await request(app)
    .post('/api/v1/catalog/categories')
    .set('authorization', `Bearer ${token()}`)
    .send({ name: 'Bakery', slug: 'bakery' });
  assert.equal(res.status, 403);
});

test('order creation requires an Idempotency-Key', async () => {
  const { app } = makeApp();
  const res = await request(app)
    .post('/api/v1/orders')
    .set('authorization', `Bearer ${token()}`)
    .send({ location: { lat: 28.6, lng: 77.2 }, items: [{ variantId: '6f1c1d2e-0000-4000-8000-000000000003', quantity: 1 }] });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
});

test('webhooks with a bad signature are rejected before any processing', async () => {
  const { app, queries } = makeApp();
  const res = await request(app)
    .post('/api/v1/payments/webhooks/sandbox')
    .set('x-sandbox-signature', 'deadbeef')
    .send({ eventId: 'e1', providerPaymentId: 'p1', status: 'SUCCEEDED' });
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'INVALID_SIGNATURE');
  assert.equal(queries.length, 0);
});

test('search requires lat and lng together', async () => {
  const { app } = makeApp();
  const res = await request(app).get('/api/v1/catalog/search?q=bread&lat=28.6');
  assert.equal(res.status, 400);
});

test('unknown routes return a JSON 404', async () => {
  const { app } = makeApp();
  const res = await request(app).get('/api/v1/nope');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});
