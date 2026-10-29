// Geohash encoding for coarse location cells. Precision 6 is about 1.2 km x 0.6 km: precise
// enough for serviceability and caching, too coarse to identify a home.
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export const DEFAULT_CELL_PRECISION = 6;

export function encodeGeohash(lat, lng, precision = DEFAULT_CELL_PRECISION) {
  if (!(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180)) throw new RangeError('lat/lng out of range');
  if (!Number.isInteger(precision) || precision < 1 || precision > 12) throw new RangeError('precision must be 1-12');
  const latRange = [-90, 90];
  const lngRange = [-180, 180];
  let hash = '';
  let bits = 0;
  let bitCount = 0;
  let evenBit = true; // longitude first
  while (hash.length < precision) {
    const range = evenBit ? lngRange : latRange;
    const value = evenBit ? lng : lat;
    const mid = (range[0] + range[1]) / 2;
    bits <<= 1;
    if (value >= mid) {
      bits |= 1;
      range[0] = mid;
    } else {
      range[1] = mid;
    }
    evenBit = !evenBit;
    if (++bitCount === 5) {
      hash += BASE32[bits];
      bits = 0;
      bitCount = 0;
    }
  }
  return hash;
}

/** The coarse cell for a customer location. */
export const locationCell = ({ lat, lng }, precision = DEFAULT_CELL_PRECISION) =>
  encodeGeohash(lat, lng, Math.min(precision, DEFAULT_CELL_PRECISION));
