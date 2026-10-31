// A listing is matched once and the stored decision reused; open NEEDS_REVIEW candidates are
// never shown as a match, and re-matching skips products a reviewer rejected.
import { normalizeText } from '@localstock/database';
import { decideMatch, findCandidates, nameTokens } from './matcher.js';
import { createSourceRegistry } from './sources.js';

// `pool` may also be a transaction client.
export function createMatchingService({ pool, sources = createSourceRegistry({ pool }), createCanonicalProducts = true }) {
  async function upsertListings({ sourceId, platformId }, entries) {
    const unique = [...new Map(entries.map((e) => [e.listing.externalListingId, e])).values()];
    const col = (fn) => unique.map(fn);
    const { rows } = await pool.query(
      `INSERT INTO external_listings
         (platform_id, first_source_id, external_listing_id, title, brand, variant_text, pack_quantity, pack_unit, pack_count, gtin, image_url, deep_link)
       SELECT $1, $2, s.id, s.title, s.brand, s.variant, s.qty, s.unit, s.count, s.gtin, s.image, s.link
         FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::numeric[], $8::text[], $9::int[], $10::text[], $11::text[], $12::text[])
              AS s(id, title, brand, variant, qty, unit, count, gtin, image, link)
       ON CONFLICT (platform_id, external_listing_id) DO UPDATE SET
         title = EXCLUDED.title, brand = EXCLUDED.brand, variant_text = EXCLUDED.variant_text,
         pack_quantity = EXCLUDED.pack_quantity, pack_unit = EXCLUDED.pack_unit, pack_count = EXCLUDED.pack_count,
         gtin = COALESCE(EXCLUDED.gtin, external_listings.gtin), image_url = EXCLUDED.image_url,
         deep_link = EXCLUDED.deep_link, last_seen_at = now()
       RETURNING id, external_listing_id`,
      [
        platformId,
        sourceId,
        col((e) => e.listing.externalListingId),
        col((e) => e.listing.title),
        col((e) => e.listing.brand),
        col((e) => e.listing.variantText),
        col((e) => e.packSize?.quantity ?? null),
        col((e) => e.packSize?.unit ?? null),
        col((e) => e.packSize?.count ?? null),
        col((e) => e.listing.gtin),
        col((e) => e.listing.imageUrl),
        col((e) => e.listing.deepLink),
      ],
    );
    return new Map(rows.map((r) => [r.external_listing_id, r.id]));
  }

  // Requires a known pack size; without it different sizes could not be kept apart.
  async function createCanonical(listingId, listing, packSize) {
    if (!packSize || !listing.title) return null;
    const brand = listing.brand?.trim() || null;
    const name = (brand && listing.title.toLowerCase().startsWith(`${brand.toLowerCase()} `) ? listing.title.slice(brand.length + 1) : listing.title).trim();
    const sizeKey = `${packSize.count > 1 ? `${packSize.count}x` : ''}${packSize.quantity}${packSize.unit}`;
    // Keyed on identifying words so concurrent creation from two platforms lands on one row.
    const words = [...nameTokens(listing.title, brand)].sort().join(' ') || normalizeText(name);
    const key = `ext|${normalizeText(brand ?? '')}|${words}|${sizeKey}`;
    const attributes = listing.variantText ? { size: listing.variantText } : {};
    try {
      const { rows } = await pool.query(
        `INSERT INTO product_variants (group_id, brand, name, attributes, barcode, normalized_key, status, origin, created_from_listing_id, pack_quantity, pack_unit, pack_count)
         VALUES (NULL, $1, $2, $3, $4, $5, 'PENDING_REVIEW', 'EXTERNAL', $6, $7, $8, $9)
         ON CONFLICT (normalized_key) DO UPDATE SET normalized_key = EXCLUDED.normalized_key
         RETURNING id`,
        [brand, name, JSON.stringify(attributes), listing.gtin, key, listingId, packSize.quantity, packSize.unit, packSize.count],
      );
      return rows[0].id;
    } catch (err) {
      if (err.code !== '23505') throw err;
      // Barcode already taken: reuse that product if usable and sizes agree, else leave unmapped.
      const { rows } = await pool.query(
        `SELECT id FROM product_variants
          WHERE barcode = $1 AND (status = 'ACTIVE' OR (origin = 'EXTERNAL' AND status = 'PENDING_REVIEW'))
            AND (pack_unit IS NULL OR (pack_unit = $2 AND pack_quantity = $3 AND pack_count = $4))`,
        [listing.gtin, packSize.unit, packSize.quantity, packSize.count],
      );
      return rows[0]?.id ?? null;
    }
  }

  async function storeDecision(listingId, decision) {
    for (const p of decision.proposals) {
      await pool.query(
        `INSERT INTO external_product_mappings (listing_id, variant_id, match_method, match_confidence, match_status, evidence)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [listingId, p.variantId, p.method, p.confidence, decision.status, JSON.stringify(p.evidence)],
      );
    }
  }

  const unmapped = (listingRecordId) => ({ listingRecordId, matchStatus: 'UNMAPPED', canonicalProductId: null, match: null });

  return {
    ensureSource: (connector) => sources.ensure(connector),
    upsertListings,

    async resolve(connector, entries) {
      const out = new Map();
      if (entries.length === 0) return out;
      const source = await sources.ensure(connector);
      const ids = await upsertListings(source, entries);

      const { rows: mappings } = await pool.query(
        `SELECT id, listing_id, variant_id, match_method, match_confidence, match_status
           FROM external_product_mappings WHERE listing_id = ANY($1::uuid[])`,
        [[...ids.values()]],
      );
      const byListing = groupBy(mappings, (m) => m.listing_id);

      for (const { listing, packSize } of entries) {
        const listingId = ids.get(listing.externalListingId);
        if (!listingId) {
          out.set(listing.externalListingId, unmapped(null));
          continue;
        }
        let rows = byListing.get(listingId) ?? [];
        const open = () => rows.filter((m) => m.match_status === 'NEEDS_REVIEW');
        const accepted = () => rows.find((m) => m.match_status === 'AUTO_CONFIRMED' || m.match_status === 'CONFIRMED');

        if (!accepted() && open().length === 0) {
          const rejected = new Set(rows.filter((m) => m.match_status === 'REJECTED').map((m) => m.variant_id));
          const candidates = await findCandidates(pool, { gtin: listing.gtin, brand: listing.brand, title: listing.title });
          const decision = decideMatch({ gtin: listing.gtin, brand: listing.brand, title: listing.title, packSize }, candidates, { excludeVariantIds: rejected });
          if (decision.status === 'UNMATCHED' && createCanonicalProducts) {
            const variantId = await createCanonical(listingId, listing, packSize);
            if (variantId) {
              decision.status = 'AUTO_CONFIRMED';
              decision.proposals = [{ variantId, method: 'NEW_CANONICAL', confidence: 1, evidence: { reason: 'no matching catalogue product; created from this listing' } }];
            }
          }
          if (decision.status !== 'UNMATCHED') {
            await storeDecision(listingId, decision);
            rows = (await pool.query(
              `SELECT id, listing_id, variant_id, match_method, match_confidence, match_status FROM external_product_mappings WHERE listing_id = $1`,
              [listingId],
            )).rows;
          }
        }

        const hit = accepted();
        if (hit) {
          out.set(listing.externalListingId, {
            listingRecordId: listingId,
            matchStatus: 'MATCHED',
            canonicalProductId: hit.variant_id,
            match: { status: hit.match_status, method: hit.match_method, confidence: Number(hit.match_confidence) },
          });
        } else if (open().length) {
          out.set(listing.externalListingId, { listingRecordId: listingId, matchStatus: 'NEEDS_REVIEW', canonicalProductId: null, match: { status: 'NEEDS_REVIEW', candidates: open().length } });
        } else {
          out.set(listing.externalListingId, unmapped(listingId));
        }
      }
      return out;
    },
  };
}

// Map.groupBy needs Node 21; the project supports Node 20.
function groupBy(items, key) {
  const map = new Map();
  for (const item of items) {
    const k = key(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
}
