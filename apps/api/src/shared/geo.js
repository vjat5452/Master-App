// SQL fragment for a geography point from numeric lat/lng parameters.
export const pointSql = (latParam, lngParam) =>
  `ST_SetSRID(ST_MakePoint(${lngParam}::float8, ${latParam}::float8), 4326)::geography`;

// Rough customer-facing estimate for discovery listings. Checkout quotes use real provider data.
export function estimateDeliveryMinutes(distanceMeters) {
  if (distanceMeters == null) return null;
  const roadKm = (distanceMeters / 1000) * 1.3;
  return 15 + Math.ceil((roadKm / 25) * 60);
}
