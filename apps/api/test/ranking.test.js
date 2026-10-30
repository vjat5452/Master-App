import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_WEIGHTS, parseRankingWeights, rankResults } from '../src/modules/discovery/ranking.js';

let n = 0;
const result = (overrides = {}) => ({
  sourceName: `S${++n}`,
  listingId: `L${n}`,
  sourceType: 'EXTERNAL_PLATFORM',
  sizeMatch: 'EXACT',
  availability: 'IN_STOCK',
  matchStatus: 'MATCHED',
  price: { itemPriceMinor: 5000, totalKnownCostMinor: 5000, totalCostCompleteness: 'PARTIAL' },
  distance: { km: null, status: 'UNKNOWN' },
  eta: null,
  freshness: { status: 'FRESH' },
  ...overrides,
});
const ids = (ranked) => ranked.map((r) => r.listingId);

test('unavailable results never outrank available ones, whatever their price', () => {
  const cheapOos = result({ listingId: 'oos', availability: 'OUT_OF_STOCK', price: { itemPriceMinor: 100, totalCostCompleteness: 'UNKNOWN' } });
  const failed = result({ listingId: 'failed', availability: 'FETCH_FAILED', price: null });
  const dear = result({ listingId: 'dear', price: { itemPriceMinor: 9000, totalCostCompleteness: 'PARTIAL' } });
  const ranked = rankResults([cheapOos, failed, dear]);
  assert.equal(ranked[0].listingId, 'dear');
  assert.deepEqual(ranked[0].ranking.reasons.slice(0, 2), ['BEST_AVAILABLE_VALUE', 'LOWEST_ITEM_PRICE']);
  assert.ok(ranked.find((r) => r.listingId === 'oos').ranking.reasons.includes('UNAVAILABLE'));
  assert.ok(!ranked.find((r) => r.listingId === 'oos').ranking.reasons.includes('LOWEST_ITEM_PRICE'), 'no "lowest" claim for an unavailable result');
});

test('size rules come before price: exact, then unknown, then different', () => {
  const ranked = rankResults([
    result({ listingId: 'different', sizeMatch: 'DIFFERENT', price: { itemPriceMinor: 100, totalCostCompleteness: 'UNKNOWN' } }),
    result({ listingId: 'unknown', sizeMatch: 'UNKNOWN', price: { itemPriceMinor: 200, totalCostCompleteness: 'UNKNOWN' } }),
    result({ listingId: 'exact', price: { itemPriceMinor: 9000, totalCostCompleteness: 'UNKNOWN' } }),
  ]);
  assert.deepEqual(ids(ranked), ['exact', 'unknown', 'different']);
  assert.ok(ranked[2].ranking.reasons.includes('VARIANT_MISMATCH'));
});

test('unknown distance is never treated as nearest', () => {
  const known = result({ listingId: 'known', distance: { km: 4.2, status: 'VERIFIED' } });
  const unknown = result({ listingId: 'unknown' });
  const ranked = rankResults([unknown, known], { policy: 'nearest' });
  assert.deepEqual(ids(ranked), ['known', 'unknown']);
  assert.ok(ranked[0].ranking.reasons.includes('NEAREST_VERIFIED_STORE'));
  assert.ok(ranked[1].ranking.reasons.includes('UNKNOWN_DISTANCE'));
  assert.equal(ranked[1].ranking.factors.distance, 1);
});

test('"lowest known total" needs a complete total; partial totals are flagged', () => {
  const partial = result({ listingId: 'partial', price: { itemPriceMinor: 4000, totalKnownCostMinor: 4000, totalCostCompleteness: 'PARTIAL' } });
  const complete = result({ listingId: 'complete', price: { itemPriceMinor: 4500, totalKnownCostMinor: 5200, totalCostCompleteness: 'COMPLETE' } });
  const ranked = rankResults([partial, complete], { policy: 'lowest_price' });
  const by = Object.fromEntries(ranked.map((r) => [r.listingId, r.ranking.reasons]));
  assert.ok(by.partial.includes('LOWEST_ITEM_PRICE'));
  assert.ok(by.partial.includes('INCOMPLETE_TOTAL'));
  assert.ok(!by.partial.includes('LOWEST_KNOWN_TOTAL'));
  assert.ok(by.complete.includes('LOWEST_KNOWN_TOTAL'));
});

test('policies change the order, and stale or unconfirmed data is penalised', () => {
  const cheapSlow = result({ listingId: 'cheapSlow', price: { itemPriceMinor: 4000, totalCostCompleteness: 'PARTIAL' }, eta: { maxMinutes: 60 } });
  const dearFast = result({ listingId: 'dearFast', price: { itemPriceMinor: 6000, totalCostCompleteness: 'PARTIAL' }, eta: { maxMinutes: 10 } });
  assert.equal(rankResults([cheapSlow, dearFast], { policy: 'lowest_price' })[0].listingId, 'cheapSlow');
  assert.equal(rankResults([cheapSlow, dearFast], { policy: 'fastest' })[0].listingId, 'dearFast');

  const stale = result({ listingId: 'stale', freshness: { status: 'EXPIRED' }, matchStatus: 'UNMAPPED' });
  const fresh = result({ listingId: 'fresh' });
  const ranked = rankResults([stale, fresh]);
  assert.deepEqual(ids(ranked), ['fresh', 'stale']);
  assert.ok(ranked[1].ranking.reasons.includes('FRESHNESS_PENALTY'));
  assert.ok(ranked[1].ranking.reasons.includes('UNCONFIRMED_PRODUCT'));
});

test('ties are broken deterministically', () => {
  const a = result({ sourceName: 'Beta', listingId: 'b' });
  const b = result({ sourceName: 'Alpha', listingId: 'a' });
  assert.deepEqual(ids(rankResults([a, b])), ['a', 'b']);
  assert.deepEqual(ids(rankResults([b, a])), ['a', 'b']);
  assert.deepEqual(rankResults([a, b]).map((r) => r.rank), [1, 2]);
});

test('weights are configurable per policy and validated', () => {
  assert.equal(parseRankingWeights(''), DEFAULT_WEIGHTS);
  const w = parseRankingWeights('{"best_value":{"price":1,"eta":0}}');
  assert.equal(w.best_value.price, 1);
  assert.equal(w.best_value.freshness, DEFAULT_WEIGHTS.best_value.freshness);
  assert.deepEqual(w.fastest, DEFAULT_WEIGHTS.fastest);
  assert.throws(() => parseRankingWeights('{"best_value":{"price":3}}'), /COMPARE_RANKING_WEIGHTS/);
  assert.throws(() => parseRankingWeights('{"cheapest":{}}'), /COMPARE_RANKING_WEIGHTS/);
});
