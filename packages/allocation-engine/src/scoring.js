import { compareIds } from './util.js';

// Tunable product defaults, not universal truths. Lower score is better.
export const DEFAULT_WEIGHTS = Object.freeze({ cost: 0.45, eta: 0.3, shipments: 0.15, risk: 0.1 });

function normalizer(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return (v) => (max === min ? 0 : (v - min) / (max - min));
}

export function rankPlans(plans, sort, weights) {
  const n = {
    cost: normalizer(plans.map((p) => p.totalLandedCostMinor)),
    eta: normalizer(plans.map((p) => p.maxEtaMinutes)),
    shipments: normalizer(plans.map((p) => p.shipmentCount)),
    risk: normalizer(plans.map((p) => p.risk)),
  };

  const scored = plans.map((p) => ({
    ...p,
    score:
      Math.round(
        (weights.cost * n.cost(p.totalLandedCostMinor) +
          weights.eta * n.eta(p.maxEtaMinutes) +
          weights.shipments * n.shipments(p.shipmentCount) +
          weights.risk * n.risk(p.risk)) *
          10000,
      ) / 10000,
  }));

  const tieBreak = (a, b) => compareIds(a.key, b.key);
  const comparators = {
    // Lowest price means total landed cost (items + delivery), not item price alone.
    lowest_price: (a, b) => a.totalLandedCostMinor - b.totalLandedCostMinor || a.maxEtaMinutes - b.maxEtaMinutes || a.score - b.score || tieBreak(a, b),
    fastest: (a, b) => a.maxEtaMinutes - b.maxEtaMinutes || a.totalLandedCostMinor - b.totalLandedCostMinor || a.score - b.score || tieBreak(a, b),
    best_value: (a, b) => a.score - b.score || a.totalLandedCostMinor - b.totalLandedCostMinor || tieBreak(a, b),
  };

  return scored.sort(comparators[sort]);
}
