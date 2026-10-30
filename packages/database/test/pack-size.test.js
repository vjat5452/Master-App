import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPackSize, packSizeFromAttributes, parsePackSize, samePackSize } from '../src/domain/pack-size.js';

test('parses single sizes into base units', () => {
  assert.deepEqual(parsePackSize('500 g'), { quantity: 500, unit: 'g', count: 1 });
  assert.deepEqual(parsePackSize('1 kg'), { quantity: 1000, unit: 'g', count: 1 });
  assert.deepEqual(parsePackSize('1.3 kg'), { quantity: 1300, unit: 'g', count: 1 });
  assert.deepEqual(parsePackSize('175.95 g'), { quantity: 175.95, unit: 'g', count: 1 });
  assert.deepEqual(parsePackSize('250 ml'), { quantity: 250, unit: 'ml', count: 1 });
  assert.deepEqual(parsePackSize('1 l'), { quantity: 1000, unit: 'ml', count: 1 });
  assert.deepEqual(parsePackSize('1.2 L'), { quantity: 1200, unit: 'ml', count: 1 });
  assert.deepEqual(parsePackSize('2 Ltr'), { quantity: 2000, unit: 'ml', count: 1 });
  assert.deepEqual(parsePackSize('500g'), { quantity: 500, unit: 'g', count: 1 });
  assert.deepEqual(parsePackSize('1,5 l'), { quantity: 1500, unit: 'ml', count: 1 });
  assert.deepEqual(parsePackSize('6 pcs'), { quantity: 6, unit: 'pcs', count: 1 });
  assert.deepEqual(parsePackSize('pack of 4'), { quantity: 4, unit: 'pcs', count: 1 });
});

test('parses multipacks in either order', () => {
  assert.deepEqual(parsePackSize('6 x 200 ml'), { quantity: 200, unit: 'ml', count: 6 });
  assert.deepEqual(parsePackSize('6x200ml'), { quantity: 200, unit: 'ml', count: 6 });
  assert.deepEqual(parsePackSize('200 ml x 6'), { quantity: 200, unit: 'ml', count: 6 });
  assert.deepEqual(parsePackSize('4 × 1 kg'), { quantity: 1000, unit: 'g', count: 4 });
});

test('returns null instead of guessing', () => {
  for (const input of [undefined, null, 42, '', 'large', '500', 'approx 500 g', '500 oz', '0 g', 'family pack', '-1 kg']) {
    assert.equal(parsePackSize(input), null, `expected null for ${JSON.stringify(input)}`);
  }
});

test('500 ml is not 1 l, 1 l is 1000 ml, and a multipack is not a single item', () => {
  assert.equal(samePackSize(parsePackSize('500 ml'), parsePackSize('1 l')), false);
  assert.equal(samePackSize(parsePackSize('1 l'), parsePackSize('1000 ml')), true);
  assert.equal(samePackSize(parsePackSize('1 kg'), parsePackSize('1000 g')), true);
  assert.equal(samePackSize(parsePackSize('6 x 200 ml'), parsePackSize('200 ml')), false);
  assert.equal(samePackSize(parsePackSize('6 x 200 ml'), parsePackSize('1200 ml')), false);
  assert.equal(samePackSize(parsePackSize('500 g'), parsePackSize('500 ml')), false);
});

test('unknown sizes never count as the same size', () => {
  assert.equal(samePackSize(null, null), false);
  assert.equal(samePackSize(parsePackSize('500 g'), null), false);
});

test('finds a size inside free text', () => {
  assert.deepEqual(extractPackSize('Amul Taaza Toned Milk 1 L'), { packSize: { quantity: 1000, unit: 'ml', count: 1 }, phrase: '1 L' });
  assert.deepEqual(extractPackSize('Maggi Noodles 6 x 70 g').packSize, { quantity: 70, unit: 'g', count: 6 });
  assert.deepEqual(extractPackSize('Pack of 6 x 200 ml').packSize, { quantity: 200, unit: 'ml', count: 6 });
  assert.deepEqual(extractPackSize('Eggs pack of 12').packSize, { quantity: 12, unit: 'pcs', count: 1 });
  assert.deepEqual(extractPackSize('7up and 100 Pipers'), { packSize: null, phrase: null });
  assert.deepEqual(extractPackSize(null), { packSize: null, phrase: null });
});

test('reads the size from variant attributes', () => {
  assert.deepEqual(packSizeFromAttributes({ weight: '500 g' }), { quantity: 500, unit: 'g', count: 1 });
  assert.deepEqual(packSizeFromAttributes({ volume: '60 ml' }), { quantity: 60, unit: 'ml', count: 1 });
  assert.deepEqual(packSizeFromAttributes({ flavour: 'mango', pack_size: '6 x 200 ml', volume: '200 ml' }), {
    quantity: 200,
    unit: 'ml',
    count: 6,
  });
  assert.deepEqual(packSizeFromAttributes({ count: 12 }), { quantity: 12, unit: 'pcs', count: 1 });
  // A bare number has no unit, so it is unknown.
  assert.equal(packSizeFromAttributes({ weight: 500 }), null);
  assert.equal(packSizeFromAttributes({ colour: 'red' }), null);
  assert.equal(packSizeFromAttributes(null), null);
});
