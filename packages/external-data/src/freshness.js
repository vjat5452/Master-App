// How old an observation may be before it is no longer "fresh", per source and per field:
// availability goes stale faster than price. Defaults can be overridden per source with
// EXTERNAL_FRESHNESS (JSON), whose keys are source codes, e.g.
//   {"acme-blinkit": {"price": {"freshSeconds": 600, "expireSeconds": 7200}, "minRefreshSeconds": 1800}}
// `minRefreshSeconds` is the shortest interval at which the background collector may
// refresh the same query from that source (its permitted cadence).
//
//   FRESH       younger than `freshSeconds`
//   STALE       younger than `expireSeconds`: shown, labelled stale
//   EXPIRED     older: not shown as a current value
//   UNVERIFIED  demo data, or no trustworthy timestamp at all
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

/** Parses EXTERNAL_FRESHNESS; throws a readable error on bad JSON or values. */
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

/** Freshness policy: defaults plus per-source overrides. */
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

/** Age-based status of one field. */
export function fieldFreshness(collectedAt, { freshSeconds, expireSeconds }, now = Date.now()) {
  const t = collectedAt ? Date.parse(collectedAt) : NaN;
  if (!Number.isFinite(t)) return 'UNVERIFIED';
  const ageSeconds = Math.max(0, (now - t) / 1000);
  if (ageSeconds < freshSeconds) return 'FRESH';
  if (ageSeconds < expireSeconds) return 'STALE';
  return 'EXPIRED';
}

const RANK = { FRESH: 0, STALE: 1, EXPIRED: 2, UNVERIFIED: 3 };

/**
 * Freshness of a result: the worst of its price and availability statuses. Demo data is
 * always UNVERIFIED. The source's own timestamp is preferred; otherwise LocalStock's
 * collection time is used and `basis` says so.
 */
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
