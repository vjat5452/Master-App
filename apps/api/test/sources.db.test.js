// Requires PostgreSQL. Run with: RUN_DB_TESTS=1 npm run test:db
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildConnectorRegistry } from '@localstock/connectors';
import { createTestApi, dbTestsEnabled } from '../test-support/db-app.js';

const skip = !dbTestsEnabled && 'set RUN_DB_TESTS=1';
let api;
let admin;

before(async () => {
  if (!dbTestsEnabled) return;
  api = await createTestApi({ connectors: buildConnectorRegistry({ env: { NODE_ENV: 'test', DEMO_EXTERNAL_FIXTURES: 'true' } }) });
  // prepareTestDatabase empties reference rows; restore the seeded platforms.
  await api.pool.query(
    `INSERT INTO external_platforms (code, name) VALUES ('blinkit','Blinkit'),('zepto','Zepto'),('instamart','Swiggy Instamart'),('bigbasket','BigBasket')
     ON CONFLICT (code) DO NOTHING`,
  );
  admin = await api.createUser('ADMIN');
});

after(async () => {
  await api?.pool.end();
});

const asAdmin = (req) => req.set('authorization', admin.auth);
const http = () => request(api.app);

test('only admins see sources', { skip }, async () => {
  const user = await api.createUser();
  assert.equal((await http().get('/api/v1/admin/external-platforms').set('authorization', user.auth)).status, 403);
});

test('every platform and source is listed with its real access state', { skip }, async () => {
  const res = await asAdmin(http().get('/api/v1/admin/external-platforms'));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const by = Object.fromEntries(res.body.items.map((p) => [p.platform.code, p]));
  assert.deepEqual(Object.keys(by).sort(), ['amazon', 'bigbasket', 'blinkit', 'demo-quick-commerce', 'flipkart', 'instamart', 'zepto']);

  const blinkit = by.blinkit.sources[0];
  assert.equal(blinkit.code, 'blinkit-official');
  assert.equal(blinkit.configured, false);
  assert.equal(blinkit.integrationStatus, 'RESEARCH_REQUIRED');
  assert.match(blinkit.reason, /docs\/platforms\/blinkit\.md/);
  assert.equal(by.blinkit.platform.doc, 'docs/platforms/blinkit.md');

  const demo = by['demo-quick-commerce'];
  assert.equal(demo.platform.isDemo, true);
  assert.equal(demo.sources[0].configured, true);
  assert.equal(demo.sources[0].integrationStatus, 'SANDBOX');
  assert.ok(demo.sources[0].capabilities.includes('product_search'));
  assert.deepEqual(demo.sources[0].runs24h, { total: 0, failed: 0, lastRunAt: null });
});

test('test connection runs the source health check', { skip }, async () => {
  const demo = await asAdmin(http().post('/api/v1/admin/external-sources/demo-quick-commerce-fixture/test-connection'));
  assert.equal(demo.body.health, 'HEALTHY');
  const blinkit = await asAdmin(http().post('/api/v1/admin/external-sources/blinkit-official/test-connection'));
  assert.equal(blinkit.body.health, 'NOT_CONFIGURED');
  const missing = await asAdmin(http().post('/api/v1/admin/external-sources/nope-source/test-connection'));
  assert.equal(missing.status, 404);
});

test('ACTIVE is refused for unconfigured and demo sources, and needs evidence', { skip }, async () => {
  const unconfigured = await asAdmin(http().patch('/api/v1/admin/external-sources/blinkit-official/status')).send({ integrationStatus: 'ACTIVE', note: 'passed all acceptance tests' });
  assert.equal(unconfigured.status, 422);
  assert.equal(unconfigured.body.error.code, 'SOURCE_NOT_CONFIGURED');

  const demo = await asAdmin(http().patch('/api/v1/admin/external-sources/demo-quick-commerce-fixture/status')).send({ integrationStatus: 'ACTIVE', note: 'passed all acceptance tests' });
  assert.equal(demo.status, 422);
  assert.equal(demo.body.error.code, 'DEMO_SOURCE');

  const noNote = await asAdmin(http().patch('/api/v1/admin/external-sources/demo-quick-commerce-fixture/status')).send({ integrationStatus: 'ACTIVE' });
  assert.equal(noNote.status, 400);
});

test('other status changes are recorded and audited', { skip }, async () => {
  const res = await asAdmin(http().patch('/api/v1/admin/external-sources/blinkit-official/status')).send({ integrationStatus: 'ACCESS_REQUESTED', note: 'emailed partnerships' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { code: 'blinkit-official', integrationStatus: 'ACCESS_REQUESTED', previous: 'RESEARCH_REQUIRED' });
  const audit = await api.one(`SELECT after, source_of_change FROM audit_logs WHERE action = 'external_source.status_changed' ORDER BY created_at DESC LIMIT 1`);
  assert.deepEqual(audit, { after: { integrationStatus: 'ACCESS_REQUESTED', note: 'emailed partnerships' }, source_of_change: 'ADMIN' });

  const runs = await asAdmin(http().get('/api/v1/admin/external-sources/blinkit-official/runs'));
  assert.deepEqual(runs.body, { items: [] });
});
