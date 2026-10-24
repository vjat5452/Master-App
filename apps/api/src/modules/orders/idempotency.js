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

/**
 * Claim (userId, key) for a new request. Returns { claimed: true } or { replay: {status, body} }.
 * Reusing a key with a different body is rejected; a crashed request's key can be reclaimed
 * once it is stale.
 */
export async function claimIdempotencyKey(pool, { userId, key, hash }, retried = false) {
  const { rowCount } = await pool.query(
    `INSERT INTO idempotency_keys (user_id, key, request_hash) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, key) DO NOTHING`,
    [userId, key, hash],
  );
  if (rowCount === 1) return { claimed: true };

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

  const { rowCount: takenOver } = await pool.query(
    `UPDATE idempotency_keys SET created_at = now()
      WHERE user_id = $1 AND key = $2 AND status = 'IN_PROGRESS'
        AND created_at < now() - make_interval(secs => $3::int)`,
    [userId, key, STALE_AFTER_SECONDS],
  );
  if (takenOver === 1) return { claimed: true };
  throw conflict('REQUEST_IN_PROGRESS', 'A request with this Idempotency-Key is being processed');
}

// Called inside the business transaction so the stored response commits atomically with the order.
export async function completeIdempotencyKey(client, { userId, key, status, body }) {
  await client.query(
    `UPDATE idempotency_keys SET status = 'COMPLETED', response_status = $3, response_body = $4
      WHERE user_id = $1 AND key = $2`,
    [userId, key, status, JSON.stringify(body)],
  );
}

// A failed request releases its key so the client can retry with the same key.
export async function releaseIdempotencyKey(pool, { userId, key }) {
  await pool.query(`DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2 AND status = 'IN_PROGRESS'`, [userId, key]);
}
