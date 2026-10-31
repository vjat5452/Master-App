import { pointSql } from '../../shared/geo.js';
import { toProvider } from '../delivery/delivery.routes.js';

// Candidate filtering happens here in SQL so the allocation engine stays pure.
export async function loadAllocationInput(db, { location, items }, { maxCandidateRadiusKm }) {
  const variantIds = [...new Set(items.map((i) => i.variantId))];
  const { rows } = await db.query(
    `SELECT i.id AS inventory_id, w.id AS warehouse_id, w.company_id, o.id AS offer_id, o.variant_id,
            o.price_minor, (i.on_hand - i.reserved) AS available,
            ST_Distance(w.location, ${pointSql('$1', '$2')}) AS distance_m
       FROM warehouses w
       JOIN companies c ON c.id = w.company_id AND c.status = 'ACTIVE'
       JOIN warehouse_inventory i ON i.warehouse_id = w.id AND i.on_hand - i.reserved > 0
       JOIN seller_offers o ON o.id = i.offer_id AND o.status = 'ACTIVE' AND o.variant_id = ANY($3::uuid[])
      WHERE w.status = 'ACTIVE'
        AND ST_DWithin(w.location, ${pointSql('$1', '$2')}, LEAST(w.service_radius_m, $4::float8))`,
    [location.lat, location.lng, variantIds, maxCandidateRadiusKm * 1000],
  );

  const candidates = rows.map((r) => ({
    inventoryId: r.inventory_id,
    warehouseId: r.warehouse_id,
    companyId: r.company_id,
    offerId: r.offer_id,
    variantId: r.variant_id,
    unitPriceMinor: r.price_minor,
    available: r.available,
    distanceMeters: Math.round(r.distance_m),
  }));

  const companyIds = [...new Set(candidates.map((c) => c.companyId))];
  const { rows: providerRows } = await db.query(
    `SELECT id, company_id, name, type, base_fee_minor, per_km_fee_minor, speed_kmph, pickup_minutes,
            reliability, max_distance_m, status
       FROM delivery_providers
      WHERE status = 'ACTIVE' AND (company_id IS NULL OR company_id = ANY($1::uuid[]))`,
    [companyIds],
  );

  return { candidates, providers: providerRows.map(toProvider) };
}

// Quotes are advisory and public-facing: strip internal inventory identifiers.
export function presentPlan(plan) {
  return {
    strategy: plan.strategy,
    itemsCostMinor: plan.itemsCostMinor,
    deliveryFeeMinor: plan.deliveryFeeMinor,
    totalLandedCostMinor: plan.totalLandedCostMinor,
    maxEtaMinutes: plan.maxEtaMinutes,
    shipmentCount: plan.shipmentCount,
    score: plan.score,
    shipments: plan.shipments.map((s) => ({
      warehouseId: s.warehouseId,
      distanceMeters: s.distanceMeters,
      itemsCostMinor: s.itemsCostMinor,
      lines: s.lines.map(({ inventoryId, ...line }) => line),
      delivery: s.delivery,
    })),
  };
}
