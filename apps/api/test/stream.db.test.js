// Requires PostgreSQL. Run with: RUN_DB_TESTS=1 npm run test:db
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { withTransaction } from '@localstock/database';
import { createSourceRegistry, recordChange } from '@localstock/external-data';
import { createLogger } from '@localstock/logger';
import { createChangeFeed } from '../src/modules/realtime/change-feed.js';
import { createTestApi, dbTestsEnabled } from '../test-support/db-app.js';

const skip = !dbTestsEnabled && 'set RUN_DB_TESTS=1';
let api;
let server;
let base;
let user;
let sourceId;
let feed;

before(async () => {
  if (!dbTestsEnabled) return;
  api = await createTestApi({ changeFeed: (pool) => (feed = createChangeFeed({ pool, logger: createLogger({ level: 'silent' }), pollMs: 50, maxPerUser: 2 })) });
  user = await api.createUser();
  const connector = { code: 'stream-source', name: 'Stream Source', platformCode: 'blinkit', accessType: 'LICENSED_PROVIDER', isDemo: false, capabilities: {}, validateConfiguration: () => ({ ok: true }) };
  ({ sourceId } = await createSourceRegistry({ pool: api.pool }).ensure(connector));
  server = http.createServer(api.app).listen(0);
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  feed?.close();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
  await api?.pool.end();
});

function openStream(path, headers = {}) {
  const events = [];
  let resolveFirst;
  const first = new Promise((r) => (resolveFirst = r));
  const req = http.get(`${base}${path}`, { headers: { authorization: user.auth, ...headers } });
  const ready = new Promise((resolve, reject) => {
    req.on('error', reject);
    req.on('response', (res) => {
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buffer += chunk;
        let at;
        while ((at = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, at);
          buffer = buffer.slice(at + 2);
          if (block.includes(': subscribed')) resolve(res);
          const data = block.split('\n').find((l) => l.startsWith('data: '));
          if (data) {
            events.push(JSON.parse(data.slice(6)));
            resolveFirst();
          }
        }
      });
      if (res.statusCode !== 200) resolve(res);
    });
  });
  return { events, ready, first, close: () => req.destroy() };
}

const change = (cell, newPrice) =>
  withTransaction(api.pool, (client) =>
    recordChange(client, { entityType: 'PRICE', sourceId, sourceCode: 'stream-source', cell, oldValue: { itemPriceMinor: 5400 }, newValue: { itemPriceMinor: newPrice } }),
  );

const waitFor = async (fn, ms = 3000) => {
  const until = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > until) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

test('the stream needs a login and a filter', { skip }, async () => {
  const anonymous = await fetch(`${base}/api/v1/discovery/stream?cell=ttnfv2`);
  assert.equal(anonymous.status, 401);
  const unfiltered = await fetch(`${base}/api/v1/discovery/stream`, { headers: { authorization: user.auth } });
  assert.equal(unfiltered.status, 400);
});

test('stored changes are pushed to subscribers of that area only', { skip }, async () => {
  const near = openStream('/api/v1/discovery/stream?cell=ttnf');
  const elsewhere = openStream('/api/v1/discovery/stream?cell=te7u');
  const [res] = await Promise.all([near.ready, elsewhere.ready]);
  assert.equal(res.headers['content-type'], 'text/event-stream; charset=utf-8');

  const eventId = await change('ttnfv2', 5200);
  await near.first;
  assert.equal(near.events.length, 1);
  assert.deepEqual(
    { eventId: near.events[0].eventId, type: near.events[0].type, source: near.events[0].sourceId, cell: near.events[0].cell, price: near.events[0].newValue.itemPriceMinor },
    { eventId, type: 'PRICE', source: 'stream-source', cell: 'ttnfv2', price: 5200 },
  );
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(elsewhere.events.length, 0);
  near.close();
  elsewhere.close();
  await waitFor(() => feed.size() === 0);
});

test('a reconnecting client resumes after Last-Event-ID', { skip }, async () => {
  const missedFrom = await change('ttnfv2', 5100);
  const missed = await change('ttnfv2', 5000);
  const stream = openStream('/api/v1/discovery/stream?cell=ttnfv2', { 'last-event-id': missedFrom });
  await stream.first;
  await waitFor(() => stream.events.length >= 1);
  assert.deepEqual(stream.events.map((e) => e.eventId), [missed]);
  stream.close();
  await waitFor(() => feed.size() === 0);
});

test('streams per user are limited', { skip }, async () => {
  const a = openStream('/api/v1/discovery/stream?cell=ttnfv2');
  const b = openStream('/api/v1/discovery/stream?cell=ttnfv2');
  await Promise.all([a.ready, b.ready]);
  const third = await fetch(`${base}/api/v1/discovery/stream?cell=ttnfv2`, { headers: { authorization: user.auth } });
  assert.equal(third.status, 429);
  a.close();
  b.close();
  await waitFor(() => feed.size() === 0);
});
