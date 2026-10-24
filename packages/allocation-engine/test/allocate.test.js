import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocate } from '../src/index.js';

const platform = {
  id: 'platform',
  type: 'PLATFORM_FLEET',
  companyId: null,
  baseFeeMinor: 2000,
  perKmFeeMinor: 100,
  speedKmph: 30,
  pickupMinutes: 10,
  reliability: 0.95,
  maxDistanceMeters: 50_000,
};

function cand(warehouseId, variantId, available, { price = 5000, distance = 1000, company = 'co1' } = {}) {
  return {
    inventoryId: `${warehouseId}:${variantId}`,
    warehouseId,
    companyId: company,
    offerId: `${company}:${variantId}`,
    variantId,
    unitPriceMinor: price,
    available,
    distanceMeters: distance,
  };
}

const warehousesUsed = (plan) => plan.shipments.map((s) => s.warehouseId);
const unitsOf = (plan) => plan.shipments.reduce((sum, s) => sum + s.units, 0);

test('prefers fulfilling the whole cart from one warehouse', () => {
  const result = allocate({
    items: [{ variantId: 'A', quantity: 2 }, { variantId: 'B', quantity: 1 }],
    candidates: [cand('W1', 'A', 2), cand('W1', 'B', 2), cand('W2', 'A', 5, { price: 100 })],
    providers: [platform],
  });
  assert.equal(result.status, 'OK');
  assert.equal(result.best.strategy, 'SINGLE_WAREHOUSE');
  assert.deepEqual(warehousesUsed(result.best), ['W1']);
});

test('blueprint case: W1=2, W2=2, W3=5, demand 5 -> W3 alone', () => {
  const result = allocate({
    items: [{ variantId: 'A', quantity: 5 }],
    candidates: [cand('W1', 'A', 2), cand('W2', 'A', 2), cand('W3', 'A', 5)],
    providers: [platform],
  });
  assert.equal(result.status, 'OK');
  assert.deepEqual(warehousesUsed(result.best), ['W3']);
  assert.equal(result.best.shipmentCount, 1);
});

test('blueprint case: W3 ineligible -> W1+W2 cannot cover 5, report unavailable', () => {
  const result = allocate({
    items: [{ variantId: 'A', quantity: 5 }],
    candidates: [cand('W1', 'A', 2), cand('W2', 'A', 2)],
    providers: [platform],
  });
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.reason, 'INSUFFICIENT_STOCK');
  assert.deepEqual(result.shortages, [{ variantId: 'A', requested: 5, available: 4, reason: 'INSUFFICIENT_STOCK' }]);
});

test('splits quantity across warehouses only when necessary and allowed', () => {
  const input = {
    items: [{ variantId: 'A', quantity: 6 }],
    candidates: [cand('W1', 'A', 3), cand('W2', 'A', 4)],
    providers: [platform],
  };
  const split = allocate(input);
  assert.equal(split.status, 'OK');
  assert.equal(split.best.strategy, 'SPLIT');
  assert.equal(unitsOf(split.best), 6);
  assert.equal(split.best.shipmentCount, 2);

  const noSplit = allocate({ ...input, preferences: { allowSplit: false } });
  assert.equal(noSplit.status, 'UNAVAILABLE');
  assert.equal(noSplit.shortages[0].reason, 'SPLIT_NOT_ALLOWED');
});

test('uses one warehouse per line when no warehouse has the whole cart', () => {
  const result = allocate({
    items: [{ variantId: 'A', quantity: 1 }, { variantId: 'B', quantity: 1 }],
    candidates: [cand('W1', 'A', 5), cand('W2', 'B', 5)],
    providers: [platform],
  });
  assert.equal(result.best.strategy, 'WAREHOUSE_PER_LINE');
  assert.deepEqual(warehousesUsed(result.best), ['W1', 'W2']);
});

test('a seller fleet only delivers for its own company', () => {
  const sellerFleet = { ...platform, id: 'fleet-co2', type: 'SELLER_FLEET', companyId: 'co2' };
  const result = allocate({
    items: [{ variantId: 'A', quantity: 1 }],
    candidates: [cand('W1', 'A', 5, { company: 'co1' })],
    providers: [sellerFleet],
  });
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.reason, 'NO_DELIVERY_PROVIDER');
});

test('falls back to a later stage when earlier plans have no delivery provider', () => {
  const shortRange = { ...platform, maxDistanceMeters: 5000 };
  const result = allocate({
    items: [{ variantId: 'A', quantity: 1 }, { variantId: 'B', quantity: 1 }],
    candidates: [
      cand('FAR', 'A', 5, { distance: 20_000 }),
      cand('FAR', 'B', 5, { distance: 20_000 }),
      cand('N1', 'A', 5, { distance: 1000 }),
      cand('N2', 'B', 5, { distance: 2000 }),
    ],
    providers: [shortRange],
  });
  assert.equal(result.status, 'OK');
  assert.equal(result.best.strategy, 'WAREHOUSE_PER_LINE');
  assert.deepEqual(warehousesUsed(result.best), ['N1', 'N2']);
});

test('lowest_price ranks by landed cost (items + delivery), fastest by slowest shipment', () => {
  // NEAR: item 5600, 1 km. FAR: item 3000, 15 km (higher delivery fee, slower).
  const candidates = [cand('NEAR', 'A', 5, { price: 5600, distance: 1000 }), cand('FAR', 'A', 5, { price: 3000, distance: 15_000 })];
  const items = [{ variantId: 'A', quantity: 1 }];

  const cheapest = allocate({ items, candidates, providers: [platform], preferences: { sort: 'lowest_price' } });
  assert.deepEqual(warehousesUsed(cheapest.best), ['FAR']);
  assert.equal(cheapest.best.totalLandedCostMinor, 3000 + 2000 + Math.round(100 * 15 * 1.3));

  const fastest = allocate({ items, candidates, providers: [platform], preferences: { sort: 'fastest' } });
  assert.deepEqual(warehousesUsed(fastest.best), ['NEAR']);

  // Cheaper item price alone must not win when delivery makes it more expensive overall.
  const pricier = allocate({
    items,
    candidates: [cand('NEAR', 'A', 5, { price: 5600, distance: 1000 }), cand('FAR', 'A', 5, { price: 5000, distance: 15_000 })],
    providers: [platform],
    preferences: { sort: 'lowest_price' },
  });
  assert.deepEqual(warehousesUsed(pricier.best), ['NEAR']);
});

test('maxEtaMinutes is the arrival time of the slowest shipment', () => {
  const result = allocate({
    items: [{ variantId: 'A', quantity: 1 }, { variantId: 'B', quantity: 1 }],
    candidates: [cand('W1', 'A', 5, { distance: 1000 }), cand('W2', 'B', 5, { distance: 12_000 })],
    providers: [platform],
  });
  const etas = result.best.shipments.map((s) => s.delivery.etaMinutes);
  assert.equal(result.best.maxEtaMinutes, Math.max(...etas));
  assert.notEqual(Math.min(...etas), Math.max(...etas));
});

test('preferSingleWarehouse=false lets scoring compare split and single plans', () => {
  const result = allocate({
    items: [{ variantId: 'A', quantity: 1 }, { variantId: 'B', quantity: 1 }],
    candidates: [
      cand('BIG', 'A', 5, { price: 9000 }),
      cand('BIG', 'B', 5, { price: 9000 }),
      cand('W1', 'A', 5, { price: 1000 }),
      cand('W2', 'B', 5, { price: 1000 }),
    ],
    providers: [platform],
    preferences: { preferSingleWarehouse: false, sort: 'lowest_price' },
  });
  assert.ok(result.plans.some((p) => p.strategy === 'SINGLE_WAREHOUSE'));
  assert.equal(result.best.strategy, 'WAREHOUSE_PER_LINE');
});

test('merges duplicate cart lines and is deterministic', () => {
  const input = {
    items: [{ variantId: 'A', quantity: 2 }, { variantId: 'A', quantity: 3 }],
    candidates: [cand('W2', 'A', 5), cand('W1', 'A', 5)],
    providers: [platform],
  };
  const first = allocate(input);
  assert.equal(unitsOf(first.best), 5);
  assert.deepEqual(allocate(input), first);
});

test('rejects invalid input', () => {
  assert.throws(() => allocate({ items: [], candidates: [] }), TypeError);
  assert.throws(() => allocate({ items: [{ variantId: 'A', quantity: 0 }], candidates: [] }), TypeError);
  assert.throws(() => allocate({ items: [{ variantId: 'A', quantity: 1 }], candidates: [], preferences: { sort: 'random' } }), TypeError);
});
