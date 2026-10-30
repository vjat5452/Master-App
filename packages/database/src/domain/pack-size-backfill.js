import { packSizeFromAttributes } from './pack-size.js';

/**
 * Fills product_variants.pack_* from `attributes`. By default only rows not parsed yet;
 * with `all` it recomputes every row (and clears sizes that no longer parse).
 * Returns { scanned, parsed, unparsed }.
 */
export async function backfillPackSizes(pool, { all = false } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, attributes FROM product_variants ${all ? '' : 'WHERE pack_quantity IS NULL'} FOR UPDATE`,
    );
    const ids = [];
    const quantities = [];
    const units = [];
    const counts = [];
    for (const row of rows) {
      const size = packSizeFromAttributes(row.attributes);
      if (!size && !all) continue;
      ids.push(row.id);
      quantities.push(size?.quantity ?? null);
      units.push(size?.unit ?? null);
      counts.push(size?.count ?? null);
    }
    if (ids.length) {
      await client.query(
        `UPDATE product_variants v
            SET pack_quantity = s.quantity, pack_unit = s.unit, pack_count = s.count
           FROM unnest($1::uuid[], $2::numeric[], $3::text[], $4::int[]) AS s(id, quantity, unit, count)
          WHERE v.id = s.id`,
        [ids, quantities, units, counts],
      );
    }
    await client.query('COMMIT');
    const parsed = units.filter(Boolean).length;
    return { scanned: rows.length, parsed, unparsed: rows.length - parsed };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
