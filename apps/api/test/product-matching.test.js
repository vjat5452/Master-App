import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasDistinguishingAttribute, variantKey } from '../src/modules/catalog/product-matching.js';
import { hashPassword, verifyPassword } from '../src/modules/auth/passwords.js';
import { requestHash } from '../src/modules/orders/idempotency.js';

test('different pack sizes are different variants', () => {
  const a = variantKey({ brand: 'Brand X', name: 'Whole Wheat Bread', attributes: { weight: '400 g' } });
  const b = variantKey({ brand: 'Brand X', name: 'Whole Wheat Bread', attributes: { weight: '700 g' } });
  assert.notEqual(a, b);
});

test('formatting differences normalize to the same variant', () => {
  const a = variantKey({ brand: 'Brand X', name: 'Whole-Wheat  Bread', attributes: { Weight: '400 g', pack: 1 } });
  const b = variantKey({ brand: 'brand x', name: 'whole wheat bread', attributes: { pack: '1', weight: '400G' } });
  assert.equal(a, b);
});

test('different brands stay distinct', () => {
  assert.notEqual(
    variantKey({ brand: 'Brand X', name: 'Bread', attributes: {} }),
    variantKey({ brand: 'Brand Y', name: 'Bread', attributes: {} }),
  );
});

test('a shared attribute with different values distinguishes similar names', () => {
  assert.equal(hasDistinguishingAttribute({ weight: '400 g' }, { weight: '700g' }), true);
  assert.equal(hasDistinguishingAttribute({ weight: '400 g' }, { weight: '400g' }), false);
  assert.equal(hasDistinguishingAttribute({ weight: '400 g' }, { flavour: 'plain' }), false);
});

test('password hashes verify and reject wrong passwords', async () => {
  const hash = await hashPassword('correct horse battery');
  assert.equal(await verifyPassword('correct horse battery', hash), true);
  assert.equal(await verifyPassword('wrong password!!', hash), false);
  assert.notEqual(await hashPassword('correct horse battery'), hash);
});

test('idempotency request hash ignores key order', () => {
  assert.equal(requestHash({ a: 1, b: { c: 2, d: [1, 2] } }), requestHash({ b: { d: [1, 2], c: 2 }, a: 1 }));
  assert.notEqual(requestHash({ a: 1 }), requestHash({ a: 2 }));
});
