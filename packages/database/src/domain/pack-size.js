// Parses free-text pack sizes into base units; anything not understood is null, never a guess.

const UNITS = new Map([
  ...['mg'].map((u) => [u, { unit: 'g', factor: 0.001 }]),
  ...['g', 'gm', 'gms', 'gr', 'gram', 'grams', 'gramme', 'grammes'].map((u) => [u, { unit: 'g', factor: 1 }]),
  ...['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms'].map((u) => [u, { unit: 'g', factor: 1000 }]),
  ...['ml', 'mls', 'millilitre', 'millilitres', 'milliliter', 'milliliters'].map((u) => [u, { unit: 'ml', factor: 1 }]),
  ...['cl'].map((u) => [u, { unit: 'ml', factor: 10 }]),
  ...['l', 'lt', 'ltr', 'ltrs', 'litre', 'litres', 'liter', 'liters'].map((u) => [u, { unit: 'ml', factor: 1000 }]),
  ...['pc', 'pcs', 'piece', 'pieces', 'unit', 'units', 'nos', 'count', 'ct'].map((u) => [u, { unit: 'pcs', factor: 1 }]),
]);

const NUM = String.raw`(\d+(?:\.\d+)?)`;
const UNIT = String.raw`([a-z]+)`;
const COUNT = String.raw`(\d{1,4})`;

const SINGLE = new RegExp(`^${NUM}\\s*${UNIT}$`);
const COUNT_FIRST = new RegExp(`^${COUNT}\\s*x\\s*${NUM}\\s*${UNIT}$`); // 6 x 200 ml
const SIZE_FIRST = new RegExp(`^${NUM}\\s*${UNIT}\\s*x\\s*${COUNT}$`); // 200 ml x 6
const PACK_OF = new RegExp(`^pack\\s+of\\s+${COUNT}$`); // pack of 4

const MAX_COUNT = 1000;

const round3 = (n) => Math.round(n * 1000) / 1000;

function build(rawQuantity, rawUnit, count) {
  const unit = UNITS.get(rawUnit);
  const quantity = Number(rawQuantity);
  if (!unit || !Number.isFinite(quantity) || !Number.isInteger(count)) return null;
  const base = round3(quantity * unit.factor);
  if (base <= 0 || count < 1 || count > MAX_COUNT) return null;
  // A count of pieces is a pack of N single pieces: "6 pcs" is (6, pcs, 1).
  return { quantity: base, unit: unit.unit, count };
}

// Returns { quantity per item in g/ml/pcs, unit, count of items } or null.
export function parsePackSize(text) {
  if (typeof text !== 'string') return null;
  const s = text
    .toLowerCase()
    .replace(/[×*]/g, 'x')
    .replace(/(\d),(\d)/g, '$1.$2') // "1,5 l"
    .replace(/[.]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s || s.length > 40) return null;

  let m;
  if ((m = s.match(COUNT_FIRST))) return build(m[2], m[3], Number(m[1]));
  if ((m = s.match(SIZE_FIRST))) return build(m[1], m[2], Number(m[3]));
  if ((m = s.match(PACK_OF))) return build(m[1], 'pcs', 1);
  if ((m = s.match(SINGLE))) return build(m[1], m[2], 1);
  return null;
}

// Attribute keys that hold a pack size, most specific first.
const SIZE_KEYS = ['pack_size', 'packSize', 'net_quantity', 'netQuantity', 'size', 'weight', 'volume', 'quantity', 'count'];

export function packSizeFromAttributes(attributes) {
  if (!attributes || typeof attributes !== 'object') return null;
  for (const key of SIZE_KEYS) {
    const value = attributes[key];
    // A bare number has no unit, except a count, which is pieces.
    const parsed = typeof value === 'number' ? (key === 'count' ? parsePackSize(`${value} pcs`) : null) : parsePackSize(value);
    if (parsed) return parsed;
  }
  return null;
}

// A size with a unit wins over "pack of N", wherever each appears.
const SIZES_IN_TEXT = [
  /(?:\b\d{1,4}\s*[x×]\s*)?\b\d+(?:[.,]\d+)?\s*(?:kgs?|kilos?|kilograms?|grams?|gms?|gm|g|mg|mls?|millilitres?|milliliters?|cl|litres?|liters?|ltrs?|lt|l|pcs?|pieces?)\b(?:\s*[x×]\s*\d{1,4}\b)?/i,
  /\bpack\s+of\s+\d{1,4}\b/i,
];

// Also returns the matched phrase so callers can strip it from the title.
export function extractPackSize(text) {
  if (typeof text !== 'string') return { packSize: null, phrase: null };
  for (const pattern of SIZES_IN_TEXT) {
    const match = text.match(pattern);
    const packSize = match ? parsePackSize(match[0]) : null;
    if (packSize) return { packSize, phrase: match[0] };
  }
  return { packSize: null, phrase: null };
}

// Unknown sizes are never equal; callers should treat them as needing review.
export function samePackSize(a, b) {
  return Boolean(a && b) && a.unit === b.unit && a.count === b.count && round3(a.quantity) === round3(b.quantity);
}
