// Staged heuristic: (A) one warehouse, (B) one warehouse per line, (C) split quantities.
// With preferSingleWarehouse the first stage with a deliverable plan wins; not a global optimum.

import { attachDelivery } from './delivery.js';
import { DEFAULT_WEIGHTS, rankPlans } from './scoring.js';
import { compareIds } from './util.js';

export const SORTS = Object.freeze(['best_value', 'lowest_price', 'fastest']);

// candidates must be pre-filtered to active, in-service-area, in-radius warehouse/offer pairs.
export function allocate({ items, candidates, providers = [], preferences = {}, weights = {}, options = {} }) {
  const prefs = { allowSplit: true, preferSingleWarehouse: true, sort: 'best_value', ...preferences };
  if (!SORTS.includes(prefs.sort)) throw new TypeError(`Unknown sort: ${prefs.sort}`);
  const w = { ...DEFAULT_WEIGHTS, ...weights };

  const lines = mergeLines(items);
  const warehouses = indexWarehouses(candidates ?? [], lines);

  const stages = [
    () => singleWarehousePlans(lines, warehouses),
    () => warehousePerLinePlans(lines, warehouses),
    () => (prefs.allowSplit ? [splitQuantitiesPlan(lines, warehouses)].filter(Boolean) : []),
  ];

  const seen = new Set();
  const feasible = [];
  let stockFeasible = false;
  for (const stage of stages) {
    for (const draft of stage()) {
      const key = planKey(draft.allocations);
      if (seen.has(key)) continue;
      seen.add(key);
      stockFeasible = true;
      const plan = attachDelivery({ ...draft, key }, providers, prefs.sort, w, options);
      if (plan) feasible.push(plan);
    }
    if (feasible.length > 0 && prefs.preferSingleWarehouse) break;
  }

  if (feasible.length === 0) {
    return stockFeasible
      ? { status: 'UNAVAILABLE', reason: 'NO_DELIVERY_PROVIDER', shortages: [], plans: [] }
      : { status: 'UNAVAILABLE', reason: 'INSUFFICIENT_STOCK', shortages: findShortages(lines, warehouses, prefs), plans: [] };
  }

  const plans = rankPlans(feasible, prefs.sort, w);
  return { status: 'OK', best: plans[0], plans };
}

function mergeLines(items) {
  if (!Array.isArray(items) || items.length === 0) throw new TypeError('items must be a non-empty array');
  const totals = new Map();
  for (const { variantId, quantity } of items) {
    if (!Number.isInteger(quantity) || quantity <= 0) throw new TypeError(`Invalid quantity for ${variantId}`);
    totals.set(variantId, (totals.get(variantId) ?? 0) + quantity);
  }
  return [...totals].map(([variantId, quantity]) => ({ variantId, quantity }));
}

// warehouseId -> { warehouseId, companyId, distanceMeters, stock: Map(variantId -> cheapest candidate) }
function indexWarehouses(candidates, lines) {
  const wanted = new Set(lines.map((l) => l.variantId));
  const byId = new Map();
  for (const c of candidates) {
    if (!wanted.has(c.variantId) || !(c.available > 0)) continue;
    let wh = byId.get(c.warehouseId);
    if (!wh) {
      wh = { warehouseId: c.warehouseId, companyId: c.companyId, distanceMeters: c.distanceMeters ?? 0, stock: new Map() };
      byId.set(c.warehouseId, wh);
    }
    const current = wh.stock.get(c.variantId);
    if (!current || c.unitPriceMinor < current.unitPriceMinor) wh.stock.set(c.variantId, c);
  }
  return [...byId.values()].sort((a, b) => compareIds(a.warehouseId, b.warehouseId));
}

const stockOf = (wh, variantId) => wh.stock.get(variantId)?.available ?? 0;
const covers = (wh, line) => stockOf(wh, line.variantId) >= line.quantity;
const lineCost = (wh, line) => wh.stock.get(line.variantId).unitPriceMinor * line.quantity;

function toAllocation(wh, variantId, quantity) {
  const c = wh.stock.get(variantId);
  return {
    warehouseId: wh.warehouseId,
    companyId: wh.companyId,
    distanceMeters: wh.distanceMeters,
    inventoryId: c.inventoryId,
    offerId: c.offerId,
    variantId,
    unitPriceMinor: c.unitPriceMinor,
    quantity,
  };
}

function planKey(allocations) {
  return allocations
    .map((a) => `${a.inventoryId}:${a.quantity}`)
    .sort()
    .join('|');
}

function singleWarehousePlans(lines, warehouses) {
  return warehouses
    .filter((wh) => lines.every((l) => covers(wh, l)))
    .map((wh) => ({
      strategy: 'SINGLE_WAREHOUSE',
      allocations: lines.map((l) => toAllocation(wh, l.variantId, l.quantity)),
    }));
}

// Stage B: emits several alternative plans and lets ranking choose.
function warehousePerLinePlans(lines, warehouses) {
  const coverers = new Map(lines.map((l) => [l.variantId, warehouses.filter((wh) => covers(wh, l))]));
  if (lines.some((l) => coverers.get(l.variantId).length === 0)) return [];

  const pickEach = (compare) => ({
    strategy: 'WAREHOUSE_PER_LINE',
    allocations: lines.map((l) => {
      const wh = [...coverers.get(l.variantId)].sort((a, b) => compare(a, b, l))[0];
      return toAllocation(wh, l.variantId, l.quantity);
    }),
  });

  const cheapest = (a, b, l) => lineCost(a, l) - lineCost(b, l) || a.distanceMeters - b.distanceMeters || compareIds(a.warehouseId, b.warehouseId);
  const nearest = (a, b, l) => a.distanceMeters - b.distanceMeters || lineCost(a, l) - lineCost(b, l) || compareIds(a.warehouseId, b.warehouseId);

  return [consolidatedPlan(lines, warehouses), pickEach(cheapest), pickEach(nearest)];
}

// Greedy set cover to minimize shipment count without exhaustive search.
function consolidatedPlan(lines, warehouses) {
  const remaining = new Map(lines.map((l) => [l.variantId, l]));
  const allocations = [];
  while (remaining.size > 0) {
    let best = null;
    for (const wh of warehouses) {
      const covered = [...remaining.values()].filter((l) => covers(wh, l));
      if (covered.length === 0) continue;
      const cost = covered.reduce((sum, l) => sum + lineCost(wh, l), 0);
      const better =
        !best ||
        covered.length > best.covered.length ||
        (covered.length === best.covered.length &&
          (cost < best.cost || (cost === best.cost && wh.distanceMeters < best.wh.distanceMeters)));
      if (better) best = { wh, covered, cost };
    }
    for (const l of best.covered) {
      allocations.push(toAllocation(best.wh, l.variantId, l.quantity));
      remaining.delete(l.variantId);
    }
  }
  return { strategy: 'WAREHOUSE_PER_LINE', allocations };
}

// Stage C: prefer warehouses already in the plan (fewer shipments), then price, then distance.
function splitQuantitiesPlan(lines, warehouses) {
  const used = new Set();
  const allocations = [];
  const preference = (variantId) => (a, b) =>
    Number(used.has(b.warehouseId)) - Number(used.has(a.warehouseId)) ||
    a.stock.get(variantId).unitPriceMinor - b.stock.get(variantId).unitPriceMinor ||
    a.distanceMeters - b.distanceMeters ||
    compareIds(a.warehouseId, b.warehouseId);

  const whole = lines.filter((l) => warehouses.some((wh) => covers(wh, l)));
  const split = lines.filter((l) => !whole.includes(l));

  for (const l of whole) {
    const wh = warehouses.filter((w) => covers(w, l)).sort(preference(l.variantId))[0];
    allocations.push(toAllocation(wh, l.variantId, l.quantity));
    used.add(wh.warehouseId);
  }

  for (const l of split) {
    let remaining = l.quantity;
    const sources = warehouses.filter((wh) => stockOf(wh, l.variantId) > 0).sort(preference(l.variantId));
    for (const wh of sources) {
      if (remaining === 0) break;
      const take = Math.min(stockOf(wh, l.variantId), remaining);
      allocations.push(toAllocation(wh, l.variantId, take));
      used.add(wh.warehouseId);
      remaining -= take;
    }
    if (remaining > 0) return null;
  }

  return { strategy: 'SPLIT', allocations };
}

function findShortages(lines, warehouses, prefs) {
  return lines.flatMap((l) => {
    const stocks = warehouses.map((wh) => stockOf(wh, l.variantId));
    const total = stocks.reduce((a, b) => a + b, 0);
    const largest = Math.max(0, ...stocks);
    if (total < l.quantity) {
      return [{ variantId: l.variantId, requested: l.quantity, available: total, reason: 'INSUFFICIENT_STOCK' }];
    }
    if (!prefs.allowSplit && largest < l.quantity) {
      return [{ variantId: l.variantId, requested: l.quantity, available: largest, reason: 'SPLIT_NOT_ALLOWED' }];
    }
    return [];
  });
}
