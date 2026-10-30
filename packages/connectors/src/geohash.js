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

/** Centre of a geohash cell: background collection queries a cell, never a person's location. */
export function decodeGeohash(hash) {
  if (!/^[0-9b-hjkmnp-z]{1,12}$/.test(hash)) throw new RangeError('invalid geohash');
  const lat = [-90, 90];
  const lng = [-180, 180];
  let evenBit = true;
  for (const ch of hash) {
    const bits = BASE32.indexOf(ch);
    for (let i = 4; i >= 0; i--) {
      const range = evenBit ? lng : lat;
      const mid = (range[0] + range[1]) / 2;
      if ((bits >> i) & 1) range[0] = mid;
      else range[1] = mid;
      evenBit = !evenBit;
    }
  }
  return { lat: (lat[0] + lat[1]) / 2, lng: (lng[0] + lng[1]) / 2 };
}

/** The coarse cell for a customer location. */
export const locationCell = ({ lat, lng }, precision = DEFAULT_CELL_PRECISION) =>
  encodeGeohash(lat, lng, Math.min(precision, DEFAULT_CELL_PRECISION));
