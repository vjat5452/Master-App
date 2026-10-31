// Size match and availability are hard rules no weight can outweigh; a weighted score (lower is
// better) orders results within them. Unknown distance or ETA scores as the worst, never zero.
import { z } from 'zod';

export const POLICIES = ['best_value', 'lowest_price', 'fastest', 'nearest'];
const FACTORS = ['price', 'eta', 'distance', 'freshness', 'match'];

export const DEFAULT_WEIGHTS = Object.freeze({
  best_value: { price: 0.45, eta: 0.2, distance: 0.1, freshness: 0.15, match: 0.1 },
  lowest_price: { price: 0.8, eta: 0, distance: 0, freshness: 0.1, match: 0.1 },
  fastest: { price: 0.15, eta: 0.7, distance: 0, freshness: 0.15, match: 0 },
  nearest: { price: 0.15, eta: 0, distance: 0.7, freshness: 0.15, match: 0 },
});

const weightsSchema = z.partialRecord(z.enum(POLICIES), z.partialRecord(z.enum(FACTORS), z.number().min(0).max(1)));

/** Parses COMPARE_RANKING_WEIGHTS (JSON) into per-policy weights merged with defaults. */
export function parseRankingWeights(text) {
  if (!text || !text.trim()) return DEFAULT_WEIGHTS;
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('COMPARE_RANKING_WEIGHTS must be valid JSON');
  }
  const result = weightsSchema.safeParse(json);
  if (!result.success) throw new Error(`COMPARE_RANKING_WEIGHTS: ${result.error.issues[0].path.join('.')}: ${result.error.issues[0].message}`);
  return Object.fromEntries(POLICIES.map((p) => [p, { ...DEFAULT_WEIGHTS[p], ...(result.data[p] ?? {}) }]));
}

const UNAVAILABLE = new Set(['OUT_OF_STOCK', 'NOT_SERVICEABLE', 'FETCH_FAILED']);
const KNOWN_DISTANCE = new Set(['VERIFIED', 'SOURCE_PROVIDED']);
const FRESHNESS_COST = { FRESH: 0, STALE: 0.5, UNVERIFIED: 0.75, EXPIRED: 1 };
const MATCH_COST = { CANONICAL: 0, MATCHED: 0, NEEDS_REVIEW: 0.5, UNMAPPED: 1 };

const priceOf = (r) => r.price?.itemPriceMinor ?? null;
const etaOf = (r) => r.eta?.maxMinutes ?? r.eta?.minMinutes ?? null;
const kmOf = (r) => (KNOWN_DISTANCE.has(r.distance?.status) ? r.distance.km : null);

// 0 for the best known value, 1 for the worst; unknown is 1.
function normalizer(values) {
  const known = values.filter((v) => v !== null);
  const min = Math.min(...known);
  const max = Math.max(...known);
  return (v) => (v === null ? 1 : max === min ? 0 : (v - min) / (max - min));
}

// Requested size (or none requested) first, unknown size next, a different size last;
// within each, available before unavailable.
const SIZE_RANK = { EXACT: 0, NOT_REQUESTED: 0, UNKNOWN: 1, DIFFERENT: 2 };
const group = (r) => (SIZE_RANK[r.sizeMatch] ?? 0) * 2 + (UNAVAILABLE.has(r.availability) ? 1 : 0);

// Returns a new array; results must already have sizeMatch set.
export function rankResults(results, { policy = 'best_value', weights = DEFAULT_WEIGHTS } = {}) {
  const w = weights[policy] ?? DEFAULT_WEIGHTS.best_value;
  // "Lowest/nearest/fastest" claims are only made among comparable, available results.
  const comparable = results.filter((r) => group(r) === 0);
  const pool = comparable.length ? comparable : results;
  const norm = { price: normalizer(pool.map(priceOf)), eta: normalizer(pool.map(etaOf)), distance: normalizer(pool.map(kmOf)) };

  const best = (fn) => {
    const known = comparable.map(fn).filter((v) => v !== null);
    return known.length ? Math.min(...known) : null;
  };
  const minPrice = best(priceOf);
  const minEta = best(etaOf);
  const minKm = best(kmOf);
  const completeTotals = comparable.filter((r) => r.price?.totalCostCompleteness === 'COMPLETE');
  const minCompleteTotal = completeTotals.length ? Math.min(...completeTotals.map((r) => r.price.totalKnownCostMinor)) : null;

  const scored = results.map((r) => {
    const factors = {
      price: norm.price(priceOf(r)),
      eta: norm.eta(etaOf(r)),
      distance: norm.distance(kmOf(r)),
      freshness: FRESHNESS_COST[r.freshness?.status] ?? 1,
      match: MATCH_COST[r.matchStatus] ?? 1,
    };
    const score = FACTORS.reduce((s, f) => s + (w[f] ?? 0) * factors[f], 0);
    const reasons = [];
    const inComparable = group(r) === 0;
    if (r.sizeMatch === 'DIFFERENT') reasons.push('VARIANT_MISMATCH');
    if (UNAVAILABLE.has(r.availability)) reasons.push('UNAVAILABLE');
    if (inComparable && minPrice !== null && priceOf(r) === minPrice) reasons.push('LOWEST_ITEM_PRICE');
    if (inComparable && minCompleteTotal !== null && r.price?.totalCostCompleteness === 'COMPLETE' && r.price.totalKnownCostMinor === minCompleteTotal) {
      reasons.push('LOWEST_KNOWN_TOTAL');
    }
    if (r.price && r.price.totalCostCompleteness !== 'COMPLETE') reasons.push('INCOMPLETE_TOTAL');
    if (inComparable && minKm !== null && kmOf(r) === minKm) reasons.push('NEAREST_VERIFIED_STORE');
    if (kmOf(r) === null) reasons.push('UNKNOWN_DISTANCE');
    if (inComparable && minEta !== null && etaOf(r) === minEta) reasons.push('FASTEST_KNOWN_ETA');
    if (r.freshness && r.freshness.status !== 'FRESH') reasons.push('FRESHNESS_PENALTY');
    if (r.matchStatus === 'UNMAPPED' || r.matchStatus === 'NEEDS_REVIEW') reasons.push('UNCONFIRMED_PRODUCT');
    return { r, score, factors, reasons };
  });

  scored.sort(
    (a, b) =>
      group(a.r) - group(b.r) ||
      a.score - b.score ||
      (priceOf(a.r) ?? Infinity) - (priceOf(b.r) ?? Infinity) ||
      a.r.sourceName.localeCompare(b.r.sourceName) ||
      String(a.r.listingId).localeCompare(String(b.r.listingId)),
  );

  return scored.map(({ r, score, factors, reasons }, i) => {
    if (i === 0 && group(r) === 0) reasons.unshift('BEST_AVAILABLE_VALUE');
    return {
      ...r,
      rank: i + 1,
      ranking: { score: Math.round(score * 1000) / 1000, reasons, factors: Object.fromEntries(Object.entries(factors).map(([k, v]) => [k, Math.round(v * 1000) / 1000])) },
    };
  });
}
