import { compareIds } from './util.js';

// Straight-line distance understates road distance; this factor is a crude stand-in until a
// routing service provides real road ETAs.
const DEFAULT_ROAD_FACTOR = 1.3;

/**
 * Quote one provider for one shipment, or null if the provider is ineligible.
 * provider: { id, type, companyId, baseFeeMinor, perKmFeeMinor, speedKmph, pickupMinutes, reliability, maxDistanceMeters, maxUnits? }
 */
export function quoteProvider(provider, shipment, { roadFactor = DEFAULT_ROAD_FACTOR } = {}) {
  if (provider.maxDistanceMeters != null && shipment.distanceMeters > provider.maxDistanceMeters) return null;
  if (provider.type === 'SELLER_FLEET' && provider.companyId !== shipment.companyId) return null;
  if (provider.maxUnits != null && shipment.units > provider.maxUnits) return null;

  const roadKm = (shipment.distanceMeters / 1000) * roadFactor;
  return {
    providerId: provider.id,
    providerType: provider.type,
    feeMinor: provider.baseFeeMinor + Math.round(provider.perKmFeeMinor * roadKm),
    etaMinutes: (provider.pickupMinutes ?? 0) + Math.ceil((roadKm / provider.speedKmph) * 60),
    reliability: provider.reliability ?? 1,
  };
}

const byFee = (a, b) =>
  a.feeMinor - b.feeMinor || a.etaMinutes - b.etaMinutes || b.reliability - a.reliability || compareIds(a.providerId, b.providerId);
const byEta = (a, b) =>
  a.etaMinutes - b.etaMinutes || a.feeMinor - b.feeMinor || b.reliability - a.reliability || compareIds(a.providerId, b.providerId);

function chooseQuote(quotes, sort, weights) {
  if (sort === 'lowest_price') return [...quotes].sort(byFee)[0];
  if (sort === 'fastest') return [...quotes].sort(byEta)[0];
  const maxFee = Math.max(1, ...quotes.map((q) => q.feeMinor));
  const maxEta = Math.max(1, ...quotes.map((q) => q.etaMinutes));
  const score = (q) => weights.cost * (q.feeMinor / maxFee) + weights.eta * (q.etaMinutes / maxEta) + weights.risk * (1 - q.reliability);
  return [...quotes].sort((a, b) => score(a) - score(b) || byFee(a, b))[0];
}

// Group a draft plan's allocations into one shipment per warehouse and attach the best provider
// to each. Returns null if any shipment has no eligible provider.
export function attachDelivery(draft, providers, sort, weights, options) {
  const groups = new Map();
  for (const a of draft.allocations) {
    let s = groups.get(a.warehouseId);
    if (!s) {
      s = { warehouseId: a.warehouseId, companyId: a.companyId, distanceMeters: a.distanceMeters, units: 0, itemsCostMinor: 0, lines: [] };
      groups.set(a.warehouseId, s);
    }
    s.units += a.quantity;
    s.itemsCostMinor += a.unitPriceMinor * a.quantity;
    s.lines.push({ variantId: a.variantId, offerId: a.offerId, inventoryId: a.inventoryId, quantity: a.quantity, unitPriceMinor: a.unitPriceMinor });
  }

  const shipments = [];
  for (const s of [...groups.values()].sort((a, b) => compareIds(a.warehouseId, b.warehouseId))) {
    const quotes = providers.map((p) => quoteProvider(p, s, options)).filter(Boolean);
    if (quotes.length === 0) return null;
    shipments.push({ ...s, delivery: chooseQuote(quotes, sort, weights) });
  }

  const itemsCostMinor = shipments.reduce((sum, s) => sum + s.itemsCostMinor, 0);
  const deliveryFeeMinor = shipments.reduce((sum, s) => sum + s.delivery.feeMinor, 0);
  const successProbability = shipments.reduce((p, s) => p * s.delivery.reliability, 1);

  return {
    key: draft.key,
    strategy: draft.strategy,
    shipments,
    itemsCostMinor,
    deliveryFeeMinor,
    totalLandedCostMinor: itemsCostMinor + deliveryFeeMinor,
    // The order arrives when its slowest shipment arrives.
    maxEtaMinutes: Math.max(...shipments.map((s) => s.delivery.etaMinutes)),
    shipmentCount: shipments.length,
    risk: Math.round((1 - successProbability) * 10000) / 10000,
  };
}
