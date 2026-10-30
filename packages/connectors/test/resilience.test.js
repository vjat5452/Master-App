import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  backoffDelay,
  CircuitBreaker,
  ConnectorError,
  createResiliencePolicy,
  ERROR_CODES,
  retry,
  Semaphore,
  TokenBucket,
  withTimeout,
} from '../src/index.js';
import { encodeGeohash, locationCell } from '../src/geohash.js';

// A fake clock: sleeping advances time instantly.
function fakeClock(start = 1_000_000) {
  const clock = { t: start, slept: [] };
  clock.now = () => clock.t;
  clock.sleep = async (ms) => {
    clock.slept.push(ms);
    clock.t += ms;
  };
  return clock;
}

const upstream = () => new ConnectorError(ERROR_CODES.UPSTREAM_ERROR, 'boom');

test('withTimeout fails with TIMEOUT and aborts the signal', async () => {
  let seen;
  await assert.rejects(
    withTimeout((signal) => {
      seen = signal;
      return new Promise(() => {});
    }, 20),
    (err) => err.code === ERROR_CODES.TIMEOUT && err.retryable === true,
  );
  assert.equal(seen.aborted, true);
  assert.equal(await withTimeout(async () => 'ok', 100), 'ok');
});

test('backoff is exponential, capped, and fully jittered', () => {
  assert.equal(backoffDelay(1, { baseMs: 100, random: () => 1 }), 100);
  assert.equal(backoffDelay(3, { baseMs: 100, random: () => 1 }), 400);
  assert.equal(backoffDelay(10, { baseMs: 100, maxMs: 1000, random: () => 1 }), 1000);
  assert.equal(backoffDelay(3, { baseMs: 100, random: () => 0 }), 0);
  const d = backoffDelay(2, { baseMs: 100 });
  assert.ok(d >= 0 && d <= 200);
});

test('retry repeats retryable errors only, and honours Retry-After', async () => {
  const clock = fakeClock();
  let calls = 0;
  const result = await retry(
    async () => {
      calls += 1;
      if (calls === 1) throw new ConnectorError(ERROR_CODES.RATE_LIMITED, '429', { retryAfterMs: 1500 });
      if (calls === 2) throw upstream();
      return 'done';
    },
    { attempts: 3, baseMs: 100, sleep: clock.sleep, random: () => 0.5 },
  );
  assert.equal(result, 'done');
  assert.deepEqual(clock.slept, [1500, 100]);

  for (const code of [ERROR_CODES.INVALID_RESPONSE, ERROR_CODES.UNSUPPORTED, ERROR_CODES.SOURCE_NOT_CONFIGURED]) {
    let n = 0;
    await assert.rejects(
      retry(async () => {
        n += 1;
        throw new ConnectorError(code, 'no');
      }, { attempts: 5, sleep: clock.sleep }),
    );
    assert.equal(n, 1, `${code} must not be retried`);
  }

  let n = 0;
  await assert.rejects(retry(async () => {
    n += 1;
    throw new Error('programming error');
  }, { attempts: 5, sleep: clock.sleep }));
  assert.equal(n, 1, 'non-connector errors are not retried');

  n = 0;
  await assert.rejects(retry(async () => {
    n += 1;
    throw upstream();
  }, { attempts: 3, sleep: clock.sleep }), /boom/);
  assert.equal(n, 3, 'gives up after the attempt limit');
});

test('token bucket allows a burst, then paces, then refuses long waits', async () => {
  const clock = fakeClock();
  const bucket = new TokenBucket({ ratePerSecond: 2, burst: 2, maxWaitMs: 1000, now: clock.now, sleep: clock.sleep });
  await bucket.acquire();
  await bucket.acquire();
  assert.deepEqual(clock.slept, []);
  await bucket.acquire(); // waits 500 ms for the next token
  assert.deepEqual(clock.slept, [500]);

  const strict = new TokenBucket({ ratePerSecond: 0.5, burst: 1, maxWaitMs: 1000, now: clock.now, sleep: clock.sleep });
  await strict.acquire();
  await assert.rejects(strict.acquire(), (err) => err.code === ERROR_CODES.RATE_LIMITED && err.retryable === false);
});

test('circuit breaker: closed -> open -> half-open -> closed or open again', async () => {
  const clock = fakeClock();
  const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 10_000, now: clock.now });
  const fail = () => breaker.run(async () => {
    throw upstream();
  });

  for (let i = 0; i < 3; i++) await assert.rejects(fail());
  assert.equal(breaker.currentState(), 'OPEN');
  let called = false;
  await assert.rejects(breaker.run(async () => (called = true)), (err) => err.code === ERROR_CODES.CIRCUIT_OPEN);
  assert.equal(called, false, 'an open breaker does not call the source');

  clock.t += 10_000;
  assert.equal(breaker.currentState(), 'HALF_OPEN');
  await assert.rejects(fail());
  assert.equal(breaker.currentState(), 'OPEN', 'a failed trial re-opens');

  clock.t += 10_000;
  assert.equal(await breaker.run(async () => 'ok'), 'ok');
  assert.equal(breaker.currentState(), 'CLOSED');
});

test('only upstream trouble opens the breaker', async () => {
  const breaker = new CircuitBreaker({ failureThreshold: 1 });
  await assert.rejects(breaker.run(async () => {
    throw new ConnectorError(ERROR_CODES.INVALID_RESPONSE, 'bad shape');
  }));
  assert.equal(breaker.currentState(), 'CLOSED');
});

test('half-open lets a single trial through', async () => {
  const clock = fakeClock();
  const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 100, now: clock.now });
  await assert.rejects(breaker.run(async () => {
    throw upstream();
  }));
  clock.t += 100;
  let release;
  const trial = breaker.run(() => new Promise((resolve) => (release = resolve)));
  await assert.rejects(breaker.run(async () => 'second'), (err) => err.code === ERROR_CODES.CIRCUIT_OPEN);
  release('first');
  assert.equal(await trial, 'first');
});

test('semaphore bounds concurrency', async () => {
  const sem = new Semaphore(2);
  let active = 0;
  let peak = 0;
  const job = () =>
    sem.run(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
    });
  await Promise.all(Array.from({ length: 6 }, job));
  assert.equal(peak, 2);
});

test('a policy combines retry, timeout and breaker', async () => {
  const clock = fakeClock();
  const policy = createResiliencePolicy({ source: 's', retries: 2, failureThreshold: 1, ratePerSecond: 100, now: clock.now, sleep: clock.sleep, random: () => 0 });
  let calls = 0;
  await assert.rejects(policy.call(async () => {
    calls += 1;
    throw upstream();
  }));
  assert.equal(calls, 3, 'one call plus two retries');
  assert.equal(policy.circuitState(), 'OPEN');
  await assert.rejects(policy.call(async () => 'x'), (err) => err.code === ERROR_CODES.CIRCUIT_OPEN);
});

test('geohash matches the reference encoding and caps cell precision', () => {
  assert.equal(encodeGeohash(57.64911, 10.40744, 11), 'u4pruydqqvj');
  assert.equal(encodeGeohash(28.6129, 77.2295, 6), 'ttnfv2');
  assert.equal(locationCell({ lat: 28.6129, lng: 77.2295 }, 9), 'ttnfv2', 'never finer than 6 characters');
  assert.throws(() => encodeGeohash(91, 0));
});
