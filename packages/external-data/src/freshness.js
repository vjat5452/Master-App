// FRESH < freshSeconds <= STALE (shown, labelled) < expireSeconds <= EXPIRED (not shown).
// UNVERIFIED: demo data or no trustworthy timestamp. minRefreshSeconds is the permitted cadence.
import { z } from 'zod';

const timeWindow = z.object({ freshSeconds: z.number().positive(), expireSeconds: z.number().positive() }).refine((w) => w.freshSeconds <= w.expireSeconds, 'freshSeconds must not exceed expireSeconds');
const sourceRules = z.object({
  price: timeWindow.optional(),
  availability: timeWindow.optional(),
  serviceability: timeWindow.optional(),
  minRefreshSeconds: z.number().int().min(60).optional(),
});
const configSchema = z.record(z.string().regex(/^[a-z0-9][a-z0-9-]{1,49}$/), sourceRules);

export const DEFAULT_POLICY = Object.freeze({
  LOCALSTOCK_INVENTORY: {
    price: { freshSeconds: Infinity, expireSeconds: Infinity },
    availability: { freshSeconds: Infinity, expireSeconds: Infinity },
  },
  EXTERNAL: {
    price: { freshSeconds: 15 * 60, expireSeconds: 6 * 3600 },
    availability: { freshSeconds: 5 * 60, expireSeconds: 3600 },
    serviceability: { freshSeconds: 30 * 60, expireSeconds: 12 * 3600 },
    minRefreshSeconds: 15 * 60,
  },
});

// EXTERNAL_FRESHNESS is JSON keyed by source code.
export function parseFreshnessConfig(text) {
  if (!text || !text.trim()) return {};
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('EXTERNAL_FRESHNESS must be valid JSON');
  }
  const result = configSchema.safeParse(json);
  if (!result.success) {
    const i = result.error.issues[0];
    throw new Error(`EXTERNAL_FRESHNESS: ${i.path.join('.')}: ${i.message}`);
  }
  return result.data;
}

export function createFreshnessPolicy(overrides = {}) {
  const rulesFor = (sourceType, sourceCode) => {
    const base = DEFAULT_POLICY[sourceType] ?? DEFAULT_POLICY.EXTERNAL;
    const own = (sourceCode && overrides[sourceCode]) || {};
    return { ...base, ...own };
  };
  return {
    rulesFor,
    minRefreshSeconds: (sourceCode) => rulesFor('EXTERNAL', sourceCode).minRefreshSeconds,
  };
}

const DEFAULT = createFreshnessPolicy();

export function fieldFreshness(collectedAt, { freshSeconds, expireSeconds }, now = Date.now()) {
  const t = collectedAt ? Date.parse(collectedAt) : NaN;
  if (!Number.isFinite(t)) return 'UNVERIFIED';
  const ageSeconds = Math.max(0, (now - t) / 1000);
  if (ageSeconds < freshSeconds) return 'FRESH';
  if (ageSeconds < expireSeconds) return 'STALE';
  return 'EXPIRED';
}

const RANK = { FRESH: 0, STALE: 1, EXPIRED: 2, UNVERIFIED: 3 };

// Worst of price and availability; prefers the source's timestamp over collection time.
export function assessFreshness(
  { sourceType, sourceCode = null, isDemo = false, sourceObservedAt = null, collectedAt },
  { now = Date.now(), policy = DEFAULT } = {},
) {
  const basis = sourceObservedAt ? 'SOURCE_OBSERVED_AT' : 'COLLECTED_AT';
  const reference = sourceObservedAt ?? collectedAt;
  const rules = policy.rulesFor(sourceType, sourceCode);
  const fields = isDemo
    ? { price: 'UNVERIFIED', availability: 'UNVERIFIED' }
    : { price: fieldFreshness(reference, rules.price, now), availability: fieldFreshness(reference, rules.availability, now) };
  const status = Object.values(fields).reduce((worst, s) => (RANK[s] > RANK[worst] ? s : worst), 'FRESH');
  const ageSeconds = Number.isFinite(Date.parse(reference)) ? Math.max(0, Math.round((now - Date.parse(reference)) / 1000)) : null;
  return { status, fields, basis, sourceObservedAt, collectedAt, ageSeconds };
}
