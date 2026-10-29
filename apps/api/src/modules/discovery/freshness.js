// How old an observation may be before it is no longer "fresh". Per source type, and per
// field where they differ: availability goes stale faster than price. Milestone 8 extends
// this with per-source overrides from configuration.
//
//   FRESH       younger than `freshSeconds`
//   STALE       younger than `expireSeconds`: shown, labelled stale
//   EXPIRED     older: not shown as a current value
//   UNVERIFIED  demo data, or no trustworthy timestamp at all

export const DEFAULT_POLICY = Object.freeze({
  LOCALSTOCK_INVENTORY: { price: { freshSeconds: Infinity, expireSeconds: Infinity }, availability: { freshSeconds: Infinity, expireSeconds: Infinity } },
  EXTERNAL: { price: { freshSeconds: 15 * 60, expireSeconds: 6 * 3600 }, availability: { freshSeconds: 5 * 60, expireSeconds: 3600 } },
});

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
export function assessFreshness({ sourceType, isDemo = false, sourceObservedAt = null, collectedAt }, { now = Date.now(), policy = DEFAULT_POLICY } = {}) {
  const basis = sourceObservedAt ? 'SOURCE_OBSERVED_AT' : 'COLLECTED_AT';
  const reference = sourceObservedAt ?? collectedAt;
  const rules = policy[sourceType] ?? policy.EXTERNAL;
  const fields = isDemo
    ? { price: 'UNVERIFIED', availability: 'UNVERIFIED' }
    : { price: fieldFreshness(reference, rules.price, now), availability: fieldFreshness(reference, rules.availability, now) };
  const status = Object.values(fields).reduce((worst, s) => (RANK[s] > RANK[worst] ? s : worst), 'FRESH');
  const ageSeconds = Number.isFinite(Date.parse(reference)) ? Math.max(0, Math.round((now - Date.parse(reference)) / 1000)) : null;
  return { status, fields, basis, sourceObservedAt, collectedAt, ageSeconds };
}
