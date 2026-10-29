// Matches an external listing to a LocalStock product variant, in this order:
//   1. GTIN (barcode) equal                          -> AUTO_CONFIRMED (unless sizes conflict)
//   2. same brand + same pack size + same name words -> AUTO_CONFIRMED (if exactly one)
//   3. same brand + same pack size + overlapping name -> NEEDS_REVIEW
//   4. similar title (trigram), size not contradicting -> NEEDS_REVIEW (FUZZY_CANDIDATE)
//   5. nothing                                        -> unmapped
// A known pack-size difference always rules a candidate out: 500 ml is not 1 l, and a
// 6-pack is not the single item. Fuzzy similarity only ever proposes; a person decides.
// Manufacturer part numbers are not used: no source in this project supplies them.
import { extractPackSize, packSizeFromAttributes, samePackSize } from '@localstock/database';
import { normalizeText } from '../catalog/product-matching.js';

// Packaging and filler words that do not identify a product.
const NOISE = new Set(['the', 'and', 'with', 'of', 'a', 'pack', 'pouch', 'bottle', 'tetra', 'tetrapack', 'carton', 'box', 'jar', 'tin', 'can', 'packet', 'pkt', 'combo', 'new', 'fresh', 'x']);

// Plain numbers and leftover sizes ("400g"); "2minute" (from "2-Minute") is a real word.
const SIZE_OR_NUMBER = /^\d+(\.\d+)?(g|gm|gms|kg|mg|ml|l|ltr|lt|cl|pc|pcs)?$/;

/** Identifying words of a product name: lowercase, no brand, no size, no packaging. */
export function nameTokens(text, brand) {
  const { phrase } = extractPackSize(text ?? '');
  const brandTokens = new Set(normalizeText(brand ?? '').split(' ').filter(Boolean));
  return new Set(
    normalizeText((phrase ? text.replace(phrase, ' ') : text) ?? '')
      .split(' ')
      .filter((t) => t && !brandTokens.has(t) && !NOISE.has(t) && !SIZE_OR_NUMBER.test(t)),
  );
}

const sameSet = (a, b) => a.size === b.size && [...a].every((t) => b.has(t));
const isSubset = (small, big) => small.size > 0 && [...small].every((t) => big.has(t));
const differsBothWays = (a, b) => [...a].some((t) => !b.has(t)) && [...b].some((t) => !a.has(t));

/** All equivalent spellings of a GTIN (EAN-8/UPC-12/EAN-13/GTIN-14 with leading zeros). */
export function gtinForms(gtin) {
  if (!gtin || !/^\d{8,14}$/.test(gtin)) return [];
  const core = gtin.replace(/^0+/, '');
  return [...new Set([8, 12, 13, 14].filter((n) => core.length <= n).map((n) => core.padStart(n, '0')))];
}

const sizeRelation = (a, b) => (!a || !b ? 'UNKNOWN' : samePackSize(a, b) ? 'SAME' : 'DIFFERENT');

/**
 * Pure decision.
 * @param {{ gtin, brand, title, packSize }} listing  packSize from listingPackSize()
 * @param {{ id, brand, name, barcode, packSize, similarity }[]} candidates
 * @param {{ excludeVariantIds?: Set<string> }} [opts] variants a reviewer already rejected
 * @returns {{ status: 'AUTO_CONFIRMED'|'NEEDS_REVIEW'|'UNMATCHED', proposals: { variantId, method, confidence, evidence }[] }}
 */
export function decideMatch(listing, candidates, { excludeVariantIds = new Set() } = {}) {
  const usable = candidates.filter((c) => !excludeVariantIds.has(c.id));
  const forms = new Set(gtinForms(listing.gtin));
  const listingTokens = nameTokens(listing.title, listing.brand);
  const brand = normalizeText(listing.brand ?? '');

  // 1. GTIN
  const byGtin = usable.filter((c) => c.barcode && forms.has(c.barcode));
  if (byGtin.length === 1) {
    const c = byGtin[0];
    const size = sizeRelation(listing.packSize, c.packSize);
    const evidence = { gtin: listing.gtin, variantBarcode: c.barcode, packSize: size };
    // Same barcode but a contradicting size means one side's data is wrong: a person checks.
    if (size === 'DIFFERENT') return { status: 'NEEDS_REVIEW', proposals: [{ variantId: c.id, method: 'GTIN', confidence: 0.5, evidence: { ...evidence, conflict: 'GTIN matches but pack sizes differ' } }] };
    return { status: 'AUTO_CONFIRMED', proposals: [{ variantId: c.id, method: 'GTIN', confidence: 1, evidence }] };
  }

  const scored = usable
    .map((c) => {
      const size = sizeRelation(listing.packSize, c.packSize);
      const tokens = nameTokens(c.name, c.brand);
      const sameBrand = brand !== '' && normalizeText(c.brand ?? '') === brand;
      return { c, size, tokens, sameBrand };
    })
    // A known size difference is never a match, at any level. Within one brand, names that
    // each have words the other lacks ("Kool Kesar" vs "Kool Elaichi") are different
    // variants (flavour, type), not spellings of one product.
    .filter((s) => s.size !== 'DIFFERENT' && !(s.sameBrand && differsBothWays(s.tokens, listingTokens)));

  // 2. Brand + size + identical name words
  const exact = scored.filter((s) => s.sameBrand && s.size === 'SAME' && listingTokens.size > 0 && sameSet(s.tokens, listingTokens));
  if (exact.length === 1) {
    const { c } = exact[0];
    return {
      status: 'AUTO_CONFIRMED',
      proposals: [{ variantId: c.id, method: 'BRAND_ATTRIBUTES', confidence: 0.95, evidence: { brand: c.brand, packSize: c.packSize, nameTokens: [...listingTokens].sort() } }],
    };
  }

  const proposals = [];
  const seen = new Set();
  const propose = (c, method, confidence, evidence) => {
    if (seen.has(c.id)) return;
    seen.add(c.id);
    proposals.push({ variantId: c.id, method, confidence: Math.round(confidence * 1000) / 1000, evidence });
  };

  // Several exact candidates, or exact words but an unknown size: a person decides.
  for (const s of scored.filter((x) => x.sameBrand && listingTokens.size > 0 && sameSet(x.tokens, listingTokens))) {
    propose(s.c, 'BRAND_ATTRIBUTES', s.size === 'SAME' ? 0.8 : 0.6, { brand: s.c.brand, packSize: s.size, reason: s.size === 'SAME' ? 'several identical candidates' : 'pack size unknown' });
  }
  // 3. Brand + size + one name contained in the other ("Taaza Toned Milk" vs "Taaza Homogenised Toned Milk")
  for (const s of scored.filter((x) => x.sameBrand && x.size === 'SAME' && (isSubset(x.tokens, listingTokens) || isSubset(listingTokens, x.tokens)))) {
    propose(s.c, 'ATTRIBUTES', 0.7, { brand: s.c.brand, packSize: 'SAME', listingTokens: [...listingTokens].sort(), variantTokens: [...s.tokens].sort() });
  }
  // 4. Fuzzy title candidates
  for (const s of scored.filter((x) => (x.c.similarity ?? 0) >= 0.45).sort((a, b) => b.c.similarity - a.c.similarity)) {
    propose(s.c, 'FUZZY_CANDIDATE', Math.min(0.6, s.c.similarity * 0.6), { similarity: s.c.similarity, packSize: s.size });
  }

  const top = proposals.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
  return top.length ? { status: 'NEEDS_REVIEW', proposals: top } : { status: 'UNMATCHED', proposals: [] };
}

/** Candidate variants for a listing: same GTIN, same brand, or a similar title. */
export async function findCandidates(db, listing) {
  const forms = gtinForms(listing.gtin);
  const title = `${listing.brand ?? ''} ${listing.title}`.trim();
  const { rows } = await db.query(
    `SELECT v.id, v.brand, v.name, v.barcode, v.attributes, v.pack_quantity, v.pack_unit, v.pack_count,
            similarity(coalesce(v.brand, '') || ' ' || v.name, $3) AS similarity
       FROM product_variants v
      WHERE v.status = 'ACTIVE'
        AND (v.barcode = ANY($1::text[])
             OR ($2::text IS NOT NULL AND lower(v.brand) = lower($2))
             OR (coalesce(v.brand, '') || ' ' || v.name) % $3)
      ORDER BY (v.barcode = ANY($1::text[])) DESC, similarity DESC, v.id
      LIMIT 25`,
    [forms, listing.brand ?? null, title],
  );
  return rows.map((r) => ({
    id: r.id,
    brand: r.brand,
    name: r.name,
    barcode: r.barcode,
    similarity: Number(r.similarity),
    packSize: r.pack_unit ? { quantity: Number(r.pack_quantity), unit: r.pack_unit, count: r.pack_count } : packSizeFromAttributes(r.attributes),
  }));
}
