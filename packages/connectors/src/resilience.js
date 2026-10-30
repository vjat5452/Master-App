// Protection around every outbound call: timeout, per-source rate limit, retry of
// retryable failures only (exponential backoff with full jitter), circuit breaker and
// bounded concurrency. Clock, sleep and randomness are injectable for tests.
import { ConnectorError, ERROR_CODES, isRetryable } from './contract.js';

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs fn(signal) and fails with TIMEOUT after `ms`, aborting the signal. */
export async function withTimeout(fn, ms, { source } = {}) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ConnectorError(ERROR_CODES.TIMEOUT, `no response within ${ms} ms`, { source }));
    }, ms);
  });
  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Delay before retry `attempt` (1-based): random in [0, min(maxMs, baseMs * 2^(attempt-1))]. */
export function backoffDelay(attempt, { baseMs = 200, maxMs = 5000, random = Math.random } = {}) {
  return Math.round(random() * Math.min(maxMs, baseMs * 2 ** (attempt - 1)));
}

/** Retries retryable ConnectorErrors only. A source's Retry-After wins over the backoff. */
export async function retry(fn, { attempts = 3, baseMs = 200, maxMs = 5000, sleep = realSleep, random = Math.random, onRetry } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (!isRetryable(err) || attempt >= attempts) throw err;
      const delay = Math.min(maxMs, err.retryAfterMs ?? backoffDelay(attempt, { baseMs, maxMs, random }));
      onRetry?.({ attempt, delay, code: err.code });
      await sleep(delay);
    }
  }
}

/**
 * Token bucket: `ratePerSecond` sustained, `burst` at once. acquire() waits for a token
 * but fails with RATE_LIMITED rather than queue longer than `maxWaitMs`.
 */
export class TokenBucket {
  constructor({ ratePerSecond, burst = ratePerSecond, maxWaitMs = 2000, now = Date.now, sleep = realSleep }) {
    if (!(ratePerSecond > 0)) throw new Error('ratePerSecond must be positive');
    Object.assign(this, { ratePerSecond, burst, maxWaitMs, now, sleep });
    this.tokens = burst;
    this.updatedAt = now();
  }

  refill() {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.updatedAt) / 1000) * this.ratePerSecond);
    this.updatedAt = t;
  }

  async acquire({ source } = {}) {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    const waitMs = Math.ceil(((1 - this.tokens) / this.ratePerSecond) * 1000);
    if (waitMs > this.maxWaitMs) {
      throw new ConnectorError(ERROR_CODES.RATE_LIMITED, 'local rate limit for this source reached', { source, retryAfterMs: waitMs, retryable: false });
    }
    // Reserve the token now so concurrent callers queue behind it.
    this.tokens -= 1;
    await this.sleep(waitMs);
  }
}

/**
 * CLOSED -> (failureThreshold consecutive failures) -> OPEN -> (cooldownMs) -> HALF_OPEN,
 * which lets one trial call through: success closes, failure re-opens.
 * Only upstream trouble counts; UNSUPPORTED or INVALID_RESPONSE from our side do not open it.
 */
export class CircuitBreaker {
  constructor({ failureThreshold = 5, cooldownMs = 30_000, now = Date.now } = {}) {
    Object.assign(this, { failureThreshold, cooldownMs, now });
    this.state = 'CLOSED';
    this.failures = 0;
    this.openedAt = 0;
    this.trialInFlight = false;
  }

  currentState() {
    if (this.state === 'OPEN' && this.now() - this.openedAt >= this.cooldownMs) this.state = 'HALF_OPEN';
    return this.state;
  }

  async run(fn, { source } = {}) {
    const state = this.currentState();
    if (state === 'OPEN' || (state === 'HALF_OPEN' && this.trialInFlight)) {
      throw new ConnectorError(ERROR_CODES.CIRCUIT_OPEN, 'source temporarily disabled after repeated failures', {
        source,
        retryAfterMs: Math.max(0, this.cooldownMs - (this.now() - this.openedAt)),
        retryable: false,
      });
    }
    if (state === 'HALF_OPEN') this.trialInFlight = true;
    try {
      const result = await fn();
      this.state = 'CLOSED';
      this.failures = 0;
      return result;
    } catch (err) {
      if (isRetryable(err)) {
        this.failures += 1;
        if (state === 'HALF_OPEN' || this.failures >= this.failureThreshold) {
          this.state = 'OPEN';
          this.openedAt = this.now();
        }
      }
      throw err;
    } finally {
      if (state === 'HALF_OPEN') this.trialInFlight = false;
    }
  }
}

/** Limits how many calls run at once; the rest wait in order. */
export class Semaphore {
  constructor(limit) {
    if (!(limit >= 1)) throw new Error('limit must be at least 1');
    this.limit = limit;
    this.active = 0;
    this.waiting = [];
  }

  async run(fn) {
    if (this.active >= this.limit) await new Promise((resolve) => this.waiting.push(resolve));
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}

/**
 * One policy per source. call(fn) runs fn(signal) under: breaker -> concurrency ->
 * retry(rate limit -> timeout). Each retry takes a fresh rate-limit token.
 */
export function createResiliencePolicy({
  source,
  timeoutMs = 4000,
  ratePerSecond = 5,
  burst,
  maxConcurrency = 4,
  retries = 2,
  baseBackoffMs = 200,
  maxBackoffMs = 5000,
  failureThreshold = 5,
  cooldownMs = 30_000,
  now,
  sleep,
  random,
  onRetry,
} = {}) {
  const bucket = new TokenBucket({ ratePerSecond, burst, now, sleep });
  const breaker = new CircuitBreaker({ failureThreshold, cooldownMs, now });
  const semaphore = new Semaphore(maxConcurrency);

  return {
    breaker,
    circuitState: () => breaker.currentState(),
    call: (fn) =>
      breaker.run(
        () =>
          semaphore.run(() =>
            retry(
              async () => {
                await bucket.acquire({ source });
                return withTimeout(fn, timeoutMs, { source });
              },
              { attempts: retries + 1, baseMs: baseBackoffMs, maxMs: maxBackoffMs, sleep, random, onRetry },
            ),
          ),
        { source },
      ),
  };
}
