// Observations are append-only history; nothing here touches LocalStock sellers' prices or stock.
import { enqueueEvent } from '@localstock/database';

const PRICE_FIELDS = ['itemPriceMinor', 'mrpMinor', 'currency'];

export function detectChanges(previous, next) {
  const changes = [];
  if (previous.price && next.price && PRICE_FIELDS.some((f) => previous.price[f] !== next.price[f])) {
    changes.push({ entityType: 'PRICE', oldValue: previous.price, newValue: next.price });
  }
  if (previous.availability && next.availability && previous.availability !== next.availability) {
    changes.push({ entityType: 'AVAILABILITY', oldValue: { status: previous.availability }, newValue: { status: next.availability } });
  }
  return changes;
}

const EVENT = {
  PRICE: { aggregateType: 'external_price', eventType: 'PriceChanged' },
  AVAILABILITY: { aggregateType: 'external_availability', eventType: 'AvailabilityChanged' },
  SERVICEABILITY: { aggregateType: 'external_serviceability', eventType: 'ServiceabilityChanged' },
  SOURCE_HEALTH: { aggregateType: 'external_source', eventType: 'HealthChanged' },
};

// Must run inside a transaction so the change and its outbox event commit together.
export async function recordChange(client, { entityType, sourceId, sourceCode, listingId = null, cell = null, oldValue, newValue, aggregateId }) {
  const { aggregateType, eventType } = EVENT[entityType];
  const detectedAt = new Date().toISOString();
  const { rows } = await client.query(
    `INSERT INTO external_change_events (entity_type, source_id, listing_id, query_cell, old_value, new_value, detected_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, event_id`,
    [entityType, sourceId, listingId, cell, oldValue && JSON.stringify(oldValue), JSON.stringify(newValue), detectedAt],
  );
  const outboxId = await enqueueEvent(client, {
    eventType,
    aggregateType,
    aggregateId: aggregateId ?? listingId ?? sourceId,
    payload: { schemaVersion: 1, changeEventId: rows[0].event_id, entityType, sourceId, sourceCode, listingId, cell, oldValue, newValue, detectedAt },
  });
  await client.query('UPDATE external_change_events SET outbox_event_id = $2 WHERE id = $1', [rows[0].id, outboxId]);
  return rows[0].event_id;
}

async function upsertNode(client, { platformId, sourceId }, node) {
  const located = node.lat !== null && node.lng !== null;
  const { rows } = await client.query(
    `INSERT INTO external_fulfillment_nodes (platform_id, source_id, external_node_id, name, location, verification_status)
     VALUES ($1, $2, $3, $4, CASE WHEN $5 THEN ST_SetSRID(ST_MakePoint($7::float8, $6::float8), 4326)::geography END, $8)
     ON CONFLICT (platform_id, external_node_id) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, external_fulfillment_nodes.name),
       location = COALESCE(EXCLUDED.location, external_fulfillment_nodes.location),
       verification_status = CASE WHEN EXCLUDED.location IS NOT NULL THEN EXCLUDED.verification_status ELSE external_fulfillment_nodes.verification_status END,
       last_seen_at = now()
     RETURNING id`,
    [platformId, sourceId, node.externalNodeId, node.name, located, node.lat, node.lng, located ? node.verification : 'UNVERIFIED'],
  );
  return rows[0].id;
}

export async function persistListingObservations(client, ctx, entries) {
  const stored = entries.filter((e) => e.listingRecordId);
  if (stored.length === 0) return { observations: 0, changes: 0 };
  const ids = stored.map((e) => e.listingRecordId);

  const { rows: prevPrices } = await client.query(
    `SELECT DISTINCT ON (listing_id) listing_id, item_price_minor, mrp_minor, currency
       FROM external_price_observations WHERE listing_id = ANY($1::uuid[]) AND query_cell = $2
      ORDER BY listing_id, collected_at DESC, id DESC`,
    [ids, ctx.cell],
  );
  const { rows: prevAvailability } = await client.query(
    `SELECT DISTINCT ON (listing_id) listing_id, status
       FROM external_availability_observations WHERE listing_id = ANY($1::uuid[]) AND query_cell = $2
      ORDER BY listing_id, collected_at DESC, id DESC`,
    [ids, ctx.cell],
  );
  const priceBy = new Map(prevPrices.map((r) => [r.listing_id, { itemPriceMinor: r.item_price_minor, mrpMinor: r.mrp_minor, currency: r.currency.trim() }]));
  const availabilityBy = new Map(prevAvailability.map((r) => [r.listing_id, r.status]));

  let observations = 0;
  let changes = 0;
  for (const { listing, listingRecordId } of stored) {
    const nodeId = listing.fulfillmentNode ? await upsertNode(client, ctx, listing.fulfillmentNode) : null;
    const p = listing.price;
    if (p) {
      await client.query(
        `INSERT INTO external_price_observations
           (listing_id, source_id, run_id, query_cell, fulfillment_node_id, item_price_minor, mrp_minor, currency, tax_inclusive,
            delivery_fee_minor, platform_fee_minor, handling_fee_minor, other_fee_minor, total_cost_completeness, source_observed_at, collected_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          listingRecordId, ctx.sourceId, ctx.runId, ctx.cell, nodeId, p.itemPriceMinor, p.mrpMinor, p.currency, p.taxInclusive,
          p.deliveryFeeMinor, p.platformFeeMinor, p.handlingFeeMinor, p.otherFeeMinor, p.totalCostCompleteness, listing.sourceObservedAt, listing.collectedAt,
        ],
      );
      observations += 1;
    }
    await client.query(
      `INSERT INTO external_availability_observations (listing_id, source_id, run_id, query_cell, fulfillment_node_id, status, source_observed_at, collected_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [listingRecordId, ctx.sourceId, ctx.runId, ctx.cell, nodeId, listing.availability, listing.sourceObservedAt, listing.collectedAt],
    );
    observations += 1;

    const next = { price: p && { itemPriceMinor: p.itemPriceMinor, mrpMinor: p.mrpMinor, currency: p.currency }, availability: listing.availability };
    const previous = { price: priceBy.get(listingRecordId), availability: availabilityBy.get(listingRecordId) };
    for (const change of detectChanges(previous, next)) {
      await recordChange(client, { ...change, sourceId: ctx.sourceId, sourceCode: ctx.sourceCode, listingId: listingRecordId, cell: ctx.cell });
      changes += 1;
    }
  }
  return { observations, changes };
}

export async function persistServiceability(client, ctx, result) {
  const { rows: prev } = await client.query(
    `SELECT status FROM external_serviceability_observations WHERE platform_id = $1 AND query_cell = $2 AND source_id = $3
      ORDER BY collected_at DESC, id DESC LIMIT 1`,
    [ctx.platformId, ctx.cell, ctx.sourceId],
  );
  const nodeId = result.fulfillmentNode ? await upsertNode(client, ctx, result.fulfillmentNode) : null;
  await client.query(
    `INSERT INTO external_serviceability_observations
       (platform_id, source_id, run_id, query_cell, status, fulfillment_node_id, eta_min_minutes, eta_max_minutes, delivery_fee_minor, currency, source_observed_at, collected_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      ctx.platformId, ctx.sourceId, ctx.runId, ctx.cell, result.status, nodeId, result.eta?.minMinutes ?? null, result.eta?.maxMinutes ?? null,
      result.deliveryFeeMinor, result.currency, result.sourceObservedAt, result.collectedAt,
    ],
  );
  if (prev[0] && prev[0].status !== result.status) {
    await recordChange(client, {
      entityType: 'SERVICEABILITY',
      sourceId: ctx.sourceId,
      sourceCode: ctx.sourceCode,
      cell: ctx.cell,
      oldValue: { status: prev[0].status },
      newValue: { status: result.status },
      aggregateId: ctx.sourceId,
    });
    return { observations: 1, changes: 1 };
  }
  return { observations: 1, changes: 0 };
}
