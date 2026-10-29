import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, isSensitiveKey, redact, REDACTED } from '../src/index.js';

test('credentials and personal data are redacted at any depth', () => {
  const out = redact({
    userId: 'u1',
    authorization: 'Bearer abc',
    headers: { Cookie: 'sid=1', 'x-api-key': 'k', 'X-Request-Id': 'r1' },
    accessToken: 't',
    refresh_token: 't2',
    password: 'p',
    clientSecret: 's',
    customer: { email: 'a@b.c', phone: '+91 99999 99999', location: { lat: 28.6, lng: 77.2 } },
    items: [{ latitude: 1, longitude: 2, sku: 'A' }],
  });
  assert.equal(out.userId, 'u1');
  assert.equal(out.authorization, REDACTED);
  assert.equal(out.headers.Cookie, REDACTED);
  assert.equal(out.headers['x-api-key'], REDACTED);
  assert.equal(out.headers['X-Request-Id'], 'r1');
  assert.equal(out.accessToken, REDACTED);
  assert.equal(out.refresh_token, REDACTED);
  assert.equal(out.password, REDACTED);
  assert.equal(out.clientSecret, REDACTED);
  assert.equal(out.customer.email, REDACTED);
  assert.equal(out.customer.phone, REDACTED);
  assert.equal(out.customer.location, REDACTED);
  assert.deepEqual(out.items, [{ latitude: REDACTED, longitude: REDACTED, sku: 'A' }]);
});

test('similar but harmless keys stay visible', () => {
  for (const key of ['latency', 'latencyMs', 'emailTemplate', 'template', 'requestId', 'orderId', 'customerId', 'count']) {
    assert.equal(isSensitiveKey(key), false, key);
  }
});

test('redact does not mutate its input and handles deep or odd values', () => {
  const input = { password: 'p', nested: { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } } };
  const out = redact(input);
  assert.equal(input.password, 'p');
  assert.equal(out.nested.a.b.c.d.e, '[TRUNCATED]');
  assert.equal(redact(null), null);
  assert.equal(redact('text'), 'text');
});

test('the logger writes redacted entries', (t) => {
  const lines = [];
  t.mock.method(process.stdout, 'write', (chunk) => {
    lines.push(String(chunk));
    return true;
  });
  createLogger({ base: { service: 'test' } })
    .child({ token: 'abc' })
    .info('hello', { email: 'a@b.c', orderId: 'o1' });
  t.mock.restoreAll();
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.msg, 'hello');
  assert.equal(entry.service, 'test');
  assert.equal(entry.token, REDACTED);
  assert.equal(entry.email, REDACTED);
  assert.equal(entry.orderId, 'o1');
});
