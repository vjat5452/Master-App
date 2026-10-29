import { enqueueEvent, recordMovement } from '@localstock/database';
import { writeAudit } from '../../shared/audit.js';

// Seller catalogue / stock import. One CSV row is one offer and, optionally, the stock of
// that offer in one warehouse:
//
//   sku,barcode,variant_id,price,mrp,warehouse,quantity
//
// - sku: required, the seller's SKU.
// - barcode or variant_id: which catalogue product. Products must already exist in the
//   catalogue; the import never creates catalogue entries (those go through matching).
// - price: required, rupees with up to 2 decimals. mrp: optional; blank keeps the current MRP.
// - warehouse: the warehouse name or id (required when quantity is given).
// - quantity: optional, the new on-hand count (absolute, not a delta).
//
// The whole file is validated first. Any error means nothing is written.

export const MAX_IMPORT_ROWS = 2000;
const KNOWN_COLUMNS = ['sku', 'barcode', 'variant_id', 'price', 'mrp', 'warehouse', 'quantity'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONEY_RE = /^\d{1,9}(\.\d{1,2})?$/;

/** "45.5" -> 4550 paise, without floating point. */
export function rupeesToMinor(text) {
  const [rupees, paise = ''] = text.split('.');
  return Number(rupees) * 100 + Number(paise.padEnd(2, '0'));
}

/**
 * Validates the shape of every row without touching the database.
 * @param {{ line: number, cells: string[] }[]} csvRows header first
 * @returns {{ rows: object[], errors: { line: number, column?: string, message: string }[] }}
 */
export function validateRows(csvRows) {
  const errors = [];
  if (csvRows.length === 0) return { rows: [], errors: [{ line: 1, message: 'The file is empty' }] };

  const [header, ...body] = csvRows;
  const columns = header.cells.map((c) => c.trim().toLowerCase());
  const unknown = columns.filter((c) => !KNOWN_COLUMNS.includes(c));
  if (unknown.length) errors.push({ line: header.line, message: `Unknown column(s): ${unknown.join(', ')}. Allowed: ${KNOWN_COLUMNS.join(', ')}` });
  for (const required of ['sku', 'price']) {
    if (!columns.includes(required)) errors.push({ line: header.line, column: required, message: `Missing required column "${required}"` });
  }
  if (!columns.includes('barcode') && !columns.includes('variant_id')) {
    errors.push({ line: header.line, message: 'Add a "barcode" or a "variant_id" column to identify products' });
  }
  if (new Set(columns).size !== columns.length) errors.push({ line: header.line, message: 'Duplicate column names' });
  if (body.length === 0) errors.push({ line: header.line, message: 'No data rows' });
  if (body.length > MAX_IMPORT_ROWS) errors.push({ line: header.line, message: `At most ${MAX_IMPORT_ROWS} rows per file` });
  if (errors.length) return { rows: [], errors };

  const rows = [];
  for (const { line, cells } of body) {
    const get = (name) => {
      const i = columns.indexOf(name);
      return i === -1 ? '' : (cells[i] ?? '').trim();
    };
    const fail = (column, message) => errors.push({ line, column, message });
    if (cells.length > columns.length) fail(undefined, `Expected ${columns.length} fields, found ${cells.length}`);

    const sku = get('sku');
    if (!sku) fail('sku', 'Required');
    else if (sku.length > 100) fail('sku', 'At most 100 characters');

    const barcode = get('barcode');
    const variantId = get('variant_id');
    if (!barcode && !variantId) fail('barcode', 'Give a barcode or a variant_id');
    if (barcode && !/^\d{8,14}$/.test(barcode)) fail('barcode', 'Must be a GTIN (8-14 digits)');
    if (variantId && !UUID_RE.test(variantId)) fail('variant_id', 'Must be a UUID');

    const price = get('price');
    if (!MONEY_RE.test(price)) fail('price', 'Must be an amount in rupees, e.g. 45 or 45.50');
    const mrp = get('mrp');
    if (mrp && !MONEY_RE.test(mrp)) fail('mrp', 'Must be an amount in rupees, e.g. 50 or 49.99');
    const priceMinor = MONEY_RE.test(price) ? rupeesToMinor(price) : null;
    const mrpMinor = mrp && MONEY_RE.test(mrp) ? rupeesToMinor(mrp) : null;
    if (priceMinor !== null && mrpMinor !== null && mrpMinor < priceMinor) fail('mrp', 'MRP must be at least the selling price');

    const warehouse = get('warehouse');
    const quantityText = get('quantity');
    let quantity = null;
    if (quantityText) {
      if (!/^\d{1,7}$/.test(quantityText)) fail('quantity', 'Must be a whole number of units, 0 or more');
      else quantity = Number(quantityText);
      if (!warehouse) fail('warehouse', 'Required when quantity is given');
    }

    rows.push({ line, sku, barcode: barcode || null, variantId: variantId || null, priceMinor, mrpMinor, warehouse: warehouse || null, quantity });
  }
  return { rows, errors };
}

/**
 * Resolves rows against the catalogue and the seller's own offers, warehouses and stock,
 * and works out what would change. With `lock`, the seller's offers and stock rows are
 * locked so the plan stays true until the transaction commits.
 */
export async function planImport(db, companyId, rows, { lock = false } = {}) {
  const errors = [];
  const fail = (line, column, message) => errors.push({ line, column, message });
  const forUpdate = lock ? 'FOR UPDATE' : '';

  const barcodes = [...new Set(rows.map((r) => r.barcode).filter(Boolean))];
  const ids = [...new Set(rows.map((r) => r.variantId).filter(Boolean))];
  const { rows: variants } = await db.query(
    `SELECT id, barcode, status, name FROM product_variants WHERE barcode = ANY($1::text[]) OR id = ANY($2::uuid[])`,
    [barcodes, ids],
  );
  const byBarcode = new Map(variants.filter((v) => v.barcode).map((v) => [v.barcode, v]));
  const byId = new Map(variants.map((v) => [v.id, v]));

  const { rows: offers } = await db.query(
    `SELECT id, variant_id, seller_sku, price_minor, mrp_minor, status FROM seller_offers WHERE company_id = $1 ORDER BY id ${forUpdate}`,
    [companyId],
  );
  const offerByVariant = new Map(offers.map((o) => [o.variant_id, o]));
  const offerBySku = new Map(offers.map((o) => [o.seller_sku, o]));

  const { rows: warehouses } = await db.query('SELECT id, name FROM warehouses WHERE company_id = $1', [companyId]);
  const resolveWarehouse = (ref) => {
    const byWarehouseId = warehouses.find((w) => w.id === ref);
    if (byWarehouseId) return { warehouse: byWarehouseId };
    const named = warehouses.filter((w) => w.name.trim().toLowerCase() === ref.toLowerCase());
    if (named.length === 1) return { warehouse: named[0] };
    return { error: named.length ? 'More than one warehouse has this name; use its id' : 'No warehouse of yours has this name or id' };
  };

  const { rows: stock } = await db.query(
    `SELECT i.id, i.warehouse_id, i.offer_id, i.on_hand, i.reserved
       FROM warehouse_inventory i JOIN warehouses w ON w.id = i.warehouse_id
      WHERE w.company_id = $1 ORDER BY i.id ${lock ? 'FOR UPDATE OF i' : ''}`,
    [companyId],
  );
  const stockKey = (warehouseId, offerId) => `${warehouseId}:${offerId}`;
  const stockByKey = new Map(stock.map((s) => [stockKey(s.warehouse_id, s.offer_id), s]));

  // One offer per product: every row for a product must agree on sku, price and mrp.
  const offerPlans = new Map();
  const seenStock = new Set();
  const planned = [];

  for (const row of rows) {
    const variant = row.barcode ? byBarcode.get(row.barcode) : byId.get(row.variantId);
    if (row.barcode && row.variantId && variant && variant.id !== row.variantId) {
      fail(row.line, 'variant_id', 'barcode and variant_id point to different products');
      continue;
    }
    if (!variant) {
      fail(row.line, row.barcode ? 'barcode' : 'variant_id', 'No catalogue product found; add it to the catalogue first');
      continue;
    }
    if (variant.status !== 'ACTIVE') {
      fail(row.line, row.barcode ? 'barcode' : 'variant_id', `Product is ${variant.status}, offers can only be created for active products`);
      continue;
    }

    const existing = offerByVariant.get(variant.id);
    const skuOwner = offerBySku.get(row.sku);
    if (skuOwner && skuOwner.variant_id !== variant.id) {
      fail(row.line, 'sku', 'This SKU is already used by one of your offers for a different product');
      continue;
    }

    let offerPlan = offerPlans.get(variant.id);
    if (offerPlan) {
      if (offerPlan.sku !== row.sku || offerPlan.priceMinor !== row.priceMinor || offerPlan.requestedMrp !== row.mrpMinor) {
        fail(row.line, 'sku', `Line ${offerPlan.line} lists the same product with a different sku, price or mrp`);
        continue;
      }
    } else {
      const sameSku = [...offerPlans.values()].find((p) => p.sku === row.sku);
      if (sameSku) {
        fail(row.line, 'sku', `Line ${sameSku.line} uses the same SKU for a different product`);
        continue;
      }
      // Blank MRP keeps the current one.
      const mrpMinor = row.mrpMinor ?? existing?.mrp_minor ?? null;
      if (mrpMinor !== null && mrpMinor < row.priceMinor) {
        fail(row.line, 'price', `Price is above the current MRP (${(mrpMinor / 100).toFixed(2)}); give a new mrp too`);
        continue;
      }
      const unchanged =
        existing && existing.seller_sku === row.sku && existing.price_minor === row.priceMinor && existing.mrp_minor === mrpMinor;
      offerPlan = {
        line: row.line,
        variantId: variant.id,
        variantName: variant.name,
        sku: row.sku,
        priceMinor: row.priceMinor,
        requestedMrp: row.mrpMinor,
        mrpMinor,
        existing: existing ?? null,
        action: existing ? (unchanged ? 'UNCHANGED' : 'UPDATE') : 'CREATE',
      };
      offerPlans.set(variant.id, offerPlan);
    }

    let stockPlan = null;
    if (row.quantity !== null) {
      const resolved = resolveWarehouse(row.warehouse);
      if (resolved.error) {
        fail(row.line, 'warehouse', resolved.error);
        continue;
      }
      const key = `${resolved.warehouse.id}:${variant.id}`;
      if (seenStock.has(key)) {
        fail(row.line, 'warehouse', 'This product and warehouse appear more than once');
        continue;
      }
      seenStock.add(key);
      const current = existing ? stockByKey.get(stockKey(resolved.warehouse.id, existing.id)) : undefined;
      const from = current?.on_hand ?? 0;
      if (current && row.quantity < current.reserved) {
        fail(row.line, 'quantity', `${current.reserved} unit(s) are reserved for orders; quantity cannot be lower`);
        continue;
      }
      stockPlan = {
        warehouseId: resolved.warehouse.id,
        warehouseName: resolved.warehouse.name,
        inventoryId: current?.id ?? null,
        from,
        to: row.quantity,
        action: from === row.quantity && current ? 'UNCHANGED' : 'SET',
      };
    }

    planned.push({ line: row.line, offer: offerPlan, stock: stockPlan });
  }

  const offerList = [...offerPlans.values()];
  const summary = {
    rows: rows.length,
    offersCreated: offerList.filter((o) => o.action === 'CREATE').length,
    offersUpdated: offerList.filter((o) => o.action === 'UPDATE').length,
    offersUnchanged: offerList.filter((o) => o.action === 'UNCHANGED').length,
    stockChanged: planned.filter((p) => p.stock?.action === 'SET').length,
    stockUnchanged: planned.filter((p) => p.stock?.action === 'UNCHANGED').length,
  };
  return { planned, offers: offerList, summary, errors };
}

/** Applies a plan made with `lock: true` inside the same transaction. */
export async function applyImport(client, { companyId, actorUserId, plan }) {
  const audit = (fields) => writeAudit(client, { actorUserId, companyId, sourceOfChange: 'CSV_IMPORT', ...fields });
  const offerIds = new Map();

  for (const offer of plan.offers) {
    if (offer.action === 'CREATE') {
      const { rows } = await client.query(
        `INSERT INTO seller_offers (company_id, variant_id, seller_sku, price_minor, mrp_minor) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [companyId, offer.variantId, offer.sku, offer.priceMinor, offer.mrpMinor],
      );
      offerIds.set(offer.variantId, rows[0].id);
      const after = { variantId: offer.variantId, sellerSku: offer.sku, priceMinor: offer.priceMinor, mrpMinor: offer.mrpMinor };
      await audit({ action: 'offer.created', entityType: 'seller_offer', entityId: rows[0].id, after });
      await enqueueEvent(client, { eventType: 'OfferCreated', aggregateType: 'offer', aggregateId: rows[0].id, payload: { offerId: rows[0].id, companyId, ...after } });
    } else {
      offerIds.set(offer.variantId, offer.existing.id);
      if (offer.action === 'UPDATE') {
        await client.query(
          `UPDATE seller_offers SET seller_sku = $2, price_minor = $3, mrp_minor = $4, updated_at = now() WHERE id = $1`,
          [offer.existing.id, offer.sku, offer.priceMinor, offer.mrpMinor],
        );
        const before = { sellerSku: offer.existing.seller_sku, priceMinor: offer.existing.price_minor, mrpMinor: offer.existing.mrp_minor };
        const after = { sellerSku: offer.sku, priceMinor: offer.priceMinor, mrpMinor: offer.mrpMinor };
        await audit({ action: 'offer.updated', entityType: 'seller_offer', entityId: offer.existing.id, before, after });
        await enqueueEvent(client, {
          eventType: 'OfferUpdated',
          aggregateType: 'offer',
          aggregateId: offer.existing.id,
          payload: { offerId: offer.existing.id, priceMinor: offer.priceMinor, mrpMinor: offer.mrpMinor, status: offer.existing.status },
        });
      }
    }
  }

  // Existing stock rows in id order (the order checkout locks them in), then new ones.
  const order = (p) => p.stock.inventoryId ?? '~'; // '~' sorts after any hex uuid
  const stockChanges = plan.planned
    .filter((p) => p.stock?.action === 'SET')
    .sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0));
  for (const { offer, stock } of stockChanges) {
    const offerId = offerIds.get(offer.variantId);
    await client.query(
      'INSERT INTO warehouse_inventory (warehouse_id, offer_id) VALUES ($1, $2) ON CONFLICT (warehouse_id, offer_id) DO NOTHING',
      [stock.warehouseId, offerId],
    );
    const { rows } = await client.query(
      `UPDATE warehouse_inventory SET on_hand = $3, version = version + 1, updated_at = now()
        WHERE warehouse_id = $1 AND offer_id = $2 AND reserved <= $3
        RETURNING id, on_hand, reserved, version`,
      [stock.warehouseId, offerId, stock.to],
    );
    // The rows were locked while planning, so this only fails if the plan was not made with lock: true.
    if (!rows[0]) throw new Error(`stock for ${offer.sku} changed during import`);
    const inv = rows[0];
    const delta = stock.to - stock.from;
    await recordMovement(client, { inventoryId: inv.id, onHandDelta: delta, reason: 'CORRECTION', note: 'CSV import', referenceType: 'import', actorUserId });
    await audit({ action: 'inventory.imported', entityType: 'warehouse_inventory', entityId: inv.id, before: { onHand: stock.from }, after: { onHand: stock.to } });
    await enqueueEvent(client, {
      eventType: 'InventoryChanged',
      aggregateType: 'inventory',
      aggregateId: inv.id,
      payload: { inventoryId: inv.id, warehouseId: stock.warehouseId, offerId, onHand: inv.on_hand, reserved: inv.reserved, version: inv.version },
    });
  }
}

/** Response rows: what happens to each line. */
export const describePlan = (plan) =>
  plan.planned.map(({ line, offer, stock }) => ({
    line,
    variantId: offer.variantId,
    product: offer.variantName,
    sku: offer.sku,
    offer: offer.action,
    priceMinor: offer.priceMinor,
    mrpMinor: offer.mrpMinor,
    stock: stock && { warehouseId: stock.warehouseId, warehouse: stock.warehouseName, from: stock.from, to: stock.to, action: stock.action },
  }));
