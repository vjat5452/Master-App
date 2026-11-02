import { createHash } from 'node:crypto';
import { AppError, conflict } from '../../shared/errors.js';

// Stable JSON so semantically identical bodies hash the same regardless of key order.
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export const requestHash = (body) => createHash('sha256').update(stableStringify(body)).digest('hex');

const STALE_AFTER_SECONDS = 300;

// Reusing a key with a different body is rejected; a crashed request's stale key can be reclaimed.
// The claim's created_at is returned as a fencing value: a holder whose key was taken over can
// neither complete nor release it.
export async function claimIdempotencyKey(pool, { userId, key, hash }, retried = false) {
  const { rows: inserted } = await pool.query(
    `INSERT INTO idempotency_keys (user_id, key, request_hash) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, key) DO NOTHING RETURNING created_at::text AS claimed_at`,
    [userId, key, hash],
  );
  if (inserted[0]) return { claimed: true, claimedAt: inserted[0].claimed_at };

  const { rows } = await pool.query(
    'SELECT request_hash, status, response_status, response_body FROM idempotency_keys WHERE user_id = $1 AND key = $2',
    [userId, key],
  );
  const existing = rows[0];
  if (!existing) {
    // The previous holder failed and released the key between our two statements.
    if (!retried) return claimIdempotencyKey(pool, { userId, key, hash }, true);
    throw conflict('REQUEST_IN_PROGRESS', 'A request with this Idempotency-Key is being processed');
  }
  if (existing.request_hash !== hash) {
    throw new AppError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request body');
  }
  if (existing.status === 'COMPLETED') {
    return { replay: { status: existing.response_status, body: existing.response_body } };
  }

  const { rows: takenOver } = await pool.query(
    `UPDATE idempotency_keys SET created_at = clock_timestamp()
      WHERE user_id = $1 AND key = $2 AND status = 'IN_PROGRESS'
        AND created_at < now() - make_interval(secs => $3::int)
      RETURNING created_at::text AS claimed_at`,
    [userId, key, STALE_AFTER_SECONDS],
  );
  if (takenOver[0]) return { claimed: true, claimedAt: takenOver[0].claimed_at };
  throw conflict('REQUEST_IN_PROGRESS', 'A request with this Idempotency-Key is being processed');
}

// Called inside the business transaction so the stored response commits atomically with the order.
// Matching nothing means another request took the key over, so this one must roll back.
export async function completeIdempotencyKey(client, { userId, key, claimedAt, status, body }) {
  const { rowCount } = await client.query(
    `UPDATE idempotency_keys SET status = 'COMPLETED', response_status = $4, response_body = $5
      WHERE user_id = $1 AND key = $2 AND created_at = $3::timestamptz AND status = 'IN_PROGRESS'`,
    [userId, key, claimedAt, status, JSON.stringify(body)],
  );
  if (rowCount !== 1) throw conflict('REQUEST_IN_PROGRESS', 'A request with this Idempotency-Key is being processed');
}

// A failed request releases its key so the client can retry with the same key.
export async function releaseIdempotencyKey(pool, { userId, key, claimedAt }) {
  await pool.query(
    `DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2 AND created_at = $3::timestamptz AND status = 'IN_PROGRESS'`,
    [userId, key, claimedAt],
  );
}
