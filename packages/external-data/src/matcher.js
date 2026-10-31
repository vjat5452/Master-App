// Order: GTIN, brand+size+name, brand+size+overlapping name, fuzzy title. A known pack-size
// difference always rules a candidate out, and fuzzy matches only ever propose.
import { extractPackSize, normalizeText, packSizeFromAttributes, samePackSize } from '@localstock/database';

const NOISE = new Set(['the', 'and', 'with', 'of', 'a', 'pack', 'pouch', 'bottle', 'tetra', 'tetrapack', 'carton', 'box', 'jar', 'tin', 'can', 'packet', 'pkt', 'combo', 'new', 'fresh', 'x']);

// Plain numbers and leftover sizes ("400g"); "2minute" (from "2-Minute") is a real word.
const SIZE_OR_NUMBER = /^\d+(\.\d+)?(g|gm|gms|kg|mg|ml|l|ltr|lt|cl|pc|pcs)?$/;

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

// Equivalent zero-padded EAN-8/UPC-12/EAN-13/GTIN-14 forms.
export function gtinForms(gtin) {
  if (!gtin || !/^\d{8,14}$/.test(gtin)) return [];
  const core = gtin.replace(/^0+/, '');
  return [...new Set([8, 12, 13, 14].filter((n) => core.length <= n).map((n) => core.padStart(n, '0')))];
}

const sizeRelation = (a, b) => (!a || !b ? 'UNKNOWN' : samePackSize(a, b) ? 'SAME' : 'DIFFERENT');

// excludeVariantIds: variants a reviewer already rejected.
export function decideMatch(listing, candidates, { excludeVariantIds = new Set() } = {}) {
  const usable = candidates.filter((c) => !excludeVariantIds.has(c.id));
  const forms = new Set(gtinForms(listing.gtin));
  const listingTokens = nameTokens(listing.title, listing.brand);
  const brand = normalizeText(listing.brand ?? '');

  const byGtin = usable.filter((c) => c.barcode && forms.has(c.barcode));
  if (byGtin.length === 1) {
    const c = byGtin[0];
    const size = sizeRelation(listing.packSize, c.packSize);
    const evidence = { gtin: listing.gtin, variantBarcode: c.barcode, packSize: size };
    // Same barcode with contradicting sizes means one side's data is wrong.
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
    // Same-brand names that each have words the other lacks are different variants (flavours).
    .filter((s) => s.size !== 'DIFFERENT' && !(s.sameBrand && differsBothWays(s.tokens, listingTokens)));

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

  // Several exact candidates, or exact words with an unknown size, go to review.
  for (const s of scored.filter((x) => x.sameBrand && listingTokens.size > 0 && sameSet(x.tokens, listingTokens))) {
    propose(s.c, 'BRAND_ATTRIBUTES', s.size === 'SAME' ? 0.8 : 0.6, { brand: s.c.brand, packSize: s.size, reason: s.size === 'SAME' ? 'several identical candidates' : 'pack size unknown' });
  }
  for (const s of scored.filter((x) => x.sameBrand && x.size === 'SAME' && (isSubset(x.tokens, listingTokens) || isSubset(listingTokens, x.tokens)))) {
    propose(s.c, 'ATTRIBUTES', 0.7, { brand: s.c.brand, packSize: 'SAME', listingTokens: [...listingTokens].sort(), variantTokens: [...s.tokens].sort() });
  }
  for (const s of scored.filter((x) => (x.c.similarity ?? 0) >= 0.45).sort((a, b) => b.c.similarity - a.c.similarity)) {
    propose(s.c, 'FUZZY_CANDIDATE', Math.min(0.6, s.c.similarity * 0.6), { similarity: s.c.similarity, packSize: s.size });
  }

  const top = proposals.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
  return top.length ? { status: 'NEEDS_REVIEW', proposals: top } : { status: 'UNMATCHED', proposals: [] };
}

export async function findCandidates(db, listing) {
  const forms = gtinForms(listing.gtin);
  const title = `${listing.brand ?? ''} ${listing.title}`.trim();
  const { rows } = await db.query(
    `SELECT v.id, v.brand, v.name, v.barcode, v.attributes, v.pack_quantity, v.pack_unit, v.pack_count,
            similarity(coalesce(v.brand, '') || ' ' || v.name, $3) AS similarity
       FROM product_variants v
      -- Externally discovered products awaiting review are candidates too, so the same
      -- product found on a second platform links to them instead of being created twice.
      WHERE (v.status = 'ACTIVE' OR (v.origin = 'EXTERNAL' AND v.status = 'PENDING_REVIEW'))
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
