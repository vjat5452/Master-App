import { test } from 'node:test';
import assert from 'node:assert/strict';
import { every } from '../src/jobs/scheduler.js';
import { backoffMs } from '../src/consumers/run-consumer.js';

const silent = { error: () => {} };

test('scheduled runs never overlap and stop() waits for the current run', async () => {
  let active = 0;
  let maxActive = 0;
  let runs = 0;
  const job = every(
    'test',
    1,
    async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      runs++;
      active--;
    },
    silent,
  );
  await new Promise((r) => setTimeout(r, 60));
  await job.stop();
  assert.equal(maxActive, 1);
  assert.equal(active, 0);
  assert.ok(runs >= 2);
});

test('a failing job keeps being scheduled', async () => {
  let calls = 0;
  const job = every(
    'flaky',
    1,
    async () => {
      calls++;
      throw new Error('boom');
    },
    silent,
  );
  await new Promise((r) => setTimeout(r, 30));
  await job.stop();
  assert.ok(calls >= 2);
});

test('retry backoff grows and is capped', () => {
  assert.ok(backoffMs(0) < backoffMs(3));
  assert.ok(backoffMs(20) <= 30_250);
});
