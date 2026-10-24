// Product identity rules. A variant is a specific sellable item: "400 g" and "700 g" packs of the
// same bread are different variants. Exact barcode matches are deterministic; fuzzy name matches
// never merge silently, they only flag the new variant for review.

export function normalizeText(value = '') {
  return String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.]+/gu, ' ')
    .replace(/(\d)\s+(?=[a-z])/g, '$1') // "400 g" -> "400g"
    .trim();
}

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
