// Barcode matches are deterministic; fuzzy name matches never merge, they only flag for review.

import { normalizeText } from '@localstock/database';

export { normalizeText };

export function normalizeAttributes(attributes = {}) {
  return Object.fromEntries(
    Object.keys(attributes)
      .map((k) => [normalizeText(k), normalizeText(attributes[k])])
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

export function variantKey({ brand, name, attributes }) {
  const attrs = Object.entries(normalizeAttributes(attributes))
    .map(([k, v]) => `${k}=${v}`)
    .join(';');
  return [normalizeText(brand ?? ''), normalizeText(name), attrs].join('|');
}

// Two similarly named variants are only ambiguous if no shared attribute tells them apart.
export function hasDistinguishingAttribute(a, b) {
  const left = normalizeAttributes(a);
  const right = normalizeAttributes(b);
  return Object.keys(left).some((k) => k in right && left[k] !== right[k]);
}
