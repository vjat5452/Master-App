// Micro-benchmark for the allocator on synthetic data. Report the dataset shape with any numbers you publish.
import { performance } from 'node:perf_hooks';
import { allocate } from '../src/index.js';

const WAREHOUSES = Number(process.env.WAREHOUSES ?? 50);
const VARIANTS = Number(process.env.VARIANTS ?? 200);
const CART_LINES = Number(process.env.CART_LINES ?? 8);
const RUNS = Number(process.env.RUNS ?? 2000);

let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

const candidates = [];
for (let w = 0; w < WAREHOUSES; w++) {
  const distance = Math.round(rand() * 15000);
  for (let v = 0; v < VARIANTS; v++) {
    if (rand() < 0.4) continue;
    candidates.push({
      inventoryId: `w${w}:v${v}`,
      warehouseId: `w${String(w).padStart(3, '0')}`,
      companyId: `c${w % 10}`,
      offerId: `c${w % 10}:v${v}`,
      variantId: `v${v}`,
      unitPriceMinor: 2000 + Math.round(rand() * 8000),
      available: Math.round(rand() * 6),
      distanceMeters: distance,
    });
  }
}
const providers = [
  { id: 'platform', type: 'PLATFORM_FLEET', companyId: null, baseFeeMinor: 2500, perKmFeeMinor: 800, speedKmph: 25, pickupMinutes: 10, reliability: 0.95, maxDistanceMeters: 20000 },
  { id: '3p', type: 'THIRD_PARTY', companyId: null, baseFeeMinor: 3000, perKmFeeMinor: 600, speedKmph: 30, pickupMinutes: 15, reliability: 0.9, maxDistanceMeters: 30000 },
];

const durations = [];
let ok = 0;
for (let i = 0; i < RUNS; i++) {
  const items = Array.from({ length: CART_LINES }, () => ({ variantId: `v${Math.floor(rand() * VARIANTS)}`, quantity: 1 + Math.floor(rand() * 3) }));
  const start = performance.now();
  const result = allocate({ items, candidates, providers });
  durations.push(performance.now() - start);
  if (result.status === 'OK') ok++;
}

durations.sort((a, b) => a - b);
const pct = (p) => durations[Math.min(durations.length - 1, Math.floor((p / 100) * durations.length))].toFixed(3);
console.log({
  dataset: { warehouses: WAREHOUSES, variants: VARIANTS, candidates: candidates.length, cartLines: CART_LINES, runs: RUNS },
  feasibleRate: (ok / RUNS).toFixed(3),
  latencyMs: { p50: pct(50), p95: pct(95), p99: pct(99) },
  node: process.version,
});
