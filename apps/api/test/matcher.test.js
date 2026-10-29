import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePackSize } from '@localstock/database';
import { decideMatch, gtinForms, nameTokens } from '../src/modules/matching/matcher.js';
import { checkListingQuality, listingPackSize } from '../src/modules/matching/normalize.js';

const size = (s) => parsePackSize(s);
const variant = (id, overrides = {}) => ({ id, brand: 'Amul', name: 'Taaza Toned Milk', barcode: null, packSize: size('1 l'), similarity: 0.5, ...overrides });
const listing = (overrides = {}) => ({ gtin: null, brand: 'Amul', title: 'Amul Taaza Toned Milk', packSize: size('1 l'), ...overrides });

test('name tokens drop brand, size, packaging and numbers', () => {
  assert.deepEqual([...nameTokens('Amul Taaza Toned Milk 1 L Pouch', 'Amul')].sort(), ['milk', 'taaza', 'toned']);
  assert.deepEqual([...nameTokens('Taaza Toned Milk', 'Amul')].sort(), ['milk', 'taaza', 'toned']);
  assert.deepEqual([...nameTokens('Maggi 2-Minute Masala Noodles 6 x 70 g', 'Maggi')].sort(), ['2minute', 'masala', 'noodles']);
});

test('GTIN forms cover leading-zero spellings', () => {
  assert.deepEqual(gtinForms('08901262150064'), ['8901262150064', '08901262150064']);
  assert.ok(gtinForms('8901262150064').includes('08901262150064'));
  assert.ok(gtinForms('041102177191').includes('0041102177191'));
  assert.deepEqual(gtinForms('abc'), []);
});

test('an exact GTIN is auto-confirmed', () => {
  const d = decideMatch(listing({ gtin: '8901262150064', title: 'Some Totally Different Title' }), [variant('v1', { barcode: '8901262150064' }), variant('v2')]);
  assert.equal(d.status, 'AUTO_CONFIRMED');
  assert.deepEqual(d.proposals.map((p) => [p.variantId, p.method, p.confidence]), [['v1', 'GTIN', 1]]);
});

test('a GTIN match with contradicting pack sizes goes to review', () => {
  const d = decideMatch(listing({ gtin: '8901262150064', packSize: size('500 ml') }), [variant('v1', { barcode: '8901262150064' })]);
  assert.equal(d.status, 'NEEDS_REVIEW');
  assert.match(d.proposals[0].evidence.conflict, /pack sizes differ/);
});

test('brand + identical pack size + identical name words is auto-confirmed', () => {
  const d = decideMatch(listing({ title: 'Amul Taaza Toned Milk 1 L' }), [variant('v1'), variant('v2', { name: 'Taaza Toned Milk', packSize: size('500 ml') })]);
  assert.equal(d.status, 'AUTO_CONFIRMED');
  assert.equal(d.proposals[0].variantId, 'v1');
  assert.equal(d.proposals[0].method, 'BRAND_ATTRIBUTES');
});

test('500 ml is never matched to 1 l, at any level', () => {
  const d = decideMatch(listing({ packSize: size('500 ml') }), [variant('v1', { similarity: 0.99 })]);
  assert.equal(d.status, 'UNMATCHED');
  assert.deepEqual(d.proposals, []);
});

test('a multipack is never matched to the single item', () => {
  const d = decideMatch(
    listing({ brand: 'Amul', title: 'Amul Masti Spiced Buttermilk', packSize: size('6 x 200 ml') }),
    [variant('single', { name: 'Masti Spiced Buttermilk', packSize: size('200 ml'), similarity: 0.9 })],
  );
  assert.equal(d.status, 'UNMATCHED');
});

test('a different flavour of the same brand and size is rejected', () => {
  const d = decideMatch(
    listing({ title: 'Amul Kool Kesar', packSize: size('180 ml') }),
    [variant('elaichi', { name: 'Kool Elaichi', packSize: size('180 ml'), similarity: 0.7 })],
  );
  assert.equal(d.status, 'UNMATCHED');
});

test('unknown size with identical words needs review, never auto', () => {
  const d = decideMatch(listing({ packSize: null }), [variant('v1')]);
  assert.equal(d.status, 'NEEDS_REVIEW');
  assert.equal(d.proposals[0].method, 'BRAND_ATTRIBUTES');
  assert.equal(d.proposals[0].evidence.packSize, 'UNKNOWN');
});

test('two identical candidates need review', () => {
  const d = decideMatch(listing(), [variant('v1'), variant('v2')]);
  assert.equal(d.status, 'NEEDS_REVIEW');
  assert.deepEqual(d.proposals.map((p) => p.variantId).sort(), ['v1', 'v2']);
});

test('a longer or shorter name of the same brand and size needs review', () => {
  const d = decideMatch(listing({ title: 'Amul Taaza Homogenised Toned Milk' }), [variant('v1')]);
  assert.equal(d.status, 'NEEDS_REVIEW');
  assert.equal(d.proposals[0].method, 'ATTRIBUTES');
});

test('fuzzy title similarity only proposes, with capped confidence', () => {
  const d = decideMatch(listing({ brand: null, title: 'Taza Toned Milk' }), [variant('v1', { similarity: 0.8 })]);
  assert.equal(d.status, 'NEEDS_REVIEW');
  assert.equal(d.proposals[0].method, 'FUZZY_CANDIDATE');
  assert.ok(d.proposals[0].confidence <= 0.6);
  assert.equal(decideMatch(listing({ brand: null, title: 'Bread' }), [variant('v1', { similarity: 0.2 })]).status, 'UNMATCHED');
});

test('variants a reviewer rejected are not proposed again', () => {
  const d = decideMatch(listing({ gtin: '8901262150064' }), [variant('v1', { barcode: '8901262150064' })], { excludeVariantIds: new Set(['v1']) });
  assert.equal(d.status, 'UNMATCHED');
});

// ---------------------------------------------------------------- data quality

const external = (overrides = {}) => ({
  externalListingId: 'L1',
  title: 'Amul Taaza Toned Milk',
  brand: 'Amul',
  variantText: '1 l',
  gtin: null,
  imageUrl: null,
  deepLink: null,
  price: { itemPriceMinor: 5400, mrpMinor: 5600, currency: 'INR', taxInclusive: null, deliveryFeeMinor: null, platformFeeMinor: null, handlingFeeMinor: null, otherFeeMinor: null, totalCostCompleteness: 'UNKNOWN' },
  availability: 'IN_STOCK',
  eta: null,
  fulfillmentNode: null,
  sourceObservedAt: null,
  collectedAt: '2026-10-29T10:00:00Z',
  ...overrides,
});
const NOW = Date.parse('2026-10-29T10:00:30Z');
const codes = (r) => r.issues.map((i) => i.code);

test('clean listings pass with their pack size', () => {
  const r = checkListingQuality(external(), { now: NOW });
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.packSize, { quantity: 1000, unit: 'ml', count: 1 });
  assert.equal(r.listing.price.itemPriceMinor, 5400);
});

test('implausible prices are dropped, not shown', () => {
  const above = checkListingQuality(external({ price: { ...external().price, itemPriceMinor: 6000 } }), { now: NOW });
  assert.deepEqual(codes(above), ['PRICE_ABOVE_MRP']);
  assert.equal(above.listing.price, null);

  const discount = checkListingQuality(external({ price: { ...external().price, itemPriceMinor: 100 } }), { now: NOW });
  assert.deepEqual(codes(discount), ['IMPLAUSIBLE_DISCOUNT']);
  assert.equal(discount.listing.price, null);

  const usd = checkListingQuality(external({ price: { ...external().price, currency: 'USD' } }), { now: NOW });
  assert.deepEqual(codes(usd), ['UNKNOWN_CURRENCY']);
  assert.equal(usd.listing.price, null);

  const zero = checkListingQuality(external({ price: { ...external().price, itemPriceMinor: 0, mrpMinor: null } }), { now: NOW });
  assert.deepEqual(zero.issues.map((i) => [i.code, i.severity]), [['ZERO_PRICE', 'WARNING']]);
  assert.equal(zero.listing.price.itemPriceMinor, 0);
});

test('future timestamps are not trusted; unknown sizes are flagged', () => {
  const future = checkListingQuality(external({ sourceObservedAt: '2026-10-29T11:00:00Z' }), { now: NOW });
  assert.deepEqual(codes(future), ['FUTURE_TIMESTAMP']);
  assert.equal(future.listing.sourceObservedAt, null);

  const unknown = checkListingQuality(external({ variantText: null, title: 'Robusta Bananas' }), { now: NOW });
  assert.deepEqual(codes(unknown), ['PACK_SIZE_UNKNOWN']);
  assert.equal(unknown.packSize, null);
});

test('pack size falls back to the title', () => {
  assert.deepEqual(listingPackSize({ variantText: null, title: 'Amul Butter 500g' }), { quantity: 500, unit: 'g', count: 1 });
  assert.deepEqual(listingPackSize({ variantText: 'Pack of 6 x 200 ml', title: 'x' }), { quantity: 200, unit: 'ml', count: 6 });
});
