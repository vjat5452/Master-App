// Problems are reported, never silently fixed: implausible prices are dropped, future timestamps distrusted.
import { extractPackSize, parsePackSize } from '@localstock/database';

export const KNOWN_CURRENCIES = new Set(['INR']);
// A discount deeper than this off MRP is treated as a data error, not a deal.
export const MAX_PLAUSIBLE_DISCOUNT = 0.9;
// Allowed clock difference between a source and LocalStock.
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export function listingPackSize(listing) {
  return parsePackSize(listing.variantText) ?? extractPackSize(listing.variantText ?? '').packSize ?? extractPackSize(listing.title).packSize;
}

// Returns a copy of the listing with unusable values removed.
export function checkListingQuality(listing, { now = Date.now() } = {}) {
  const issues = [];
  const issue = (code, severity, field, message) => issues.push({ code, severity, field, message });
  const out = { ...listing };

  const price = listing.price;
  if (price) {
    let dropPrice = false;
    if (!KNOWN_CURRENCIES.has(price.currency)) {
      issue('UNKNOWN_CURRENCY', 'ERROR', 'price.currency', `Currency ${price.currency} is not supported`);
      dropPrice = true;
    }
    if (price.itemPriceMinor === 0) issue('ZERO_PRICE', 'WARNING', 'price.itemPriceMinor', 'Item price is zero');
    if (price.mrpMinor !== null) {
      if (price.itemPriceMinor > price.mrpMinor) {
        issue('PRICE_ABOVE_MRP', 'ERROR', 'price.itemPriceMinor', 'Selling price is above MRP');
        dropPrice = true;
      } else if (price.mrpMinor > 0 && 1 - price.itemPriceMinor / price.mrpMinor > MAX_PLAUSIBLE_DISCOUNT) {
        issue('IMPLAUSIBLE_DISCOUNT', 'ERROR', 'price.itemPriceMinor', `Discount above ${MAX_PLAUSIBLE_DISCOUNT * 100}% of MRP`);
        dropPrice = true;
      }
    }
    if (dropPrice) out.price = null;
  }

  const observed = listing.sourceObservedAt ? Date.parse(listing.sourceObservedAt) : null;
  if (observed !== null && observed > now + MAX_CLOCK_SKEW_MS) {
    issue('FUTURE_TIMESTAMP', 'ERROR', 'sourceObservedAt', 'Source timestamp is in the future; it is ignored');
    out.sourceObservedAt = null;
  }
  if (Date.parse(listing.collectedAt) > now + MAX_CLOCK_SKEW_MS) {
    issue('FUTURE_TIMESTAMP', 'ERROR', 'collectedAt', 'Collection time is in the future');
  }

  const packSize = listingPackSize(listing);
  if (!packSize) issue('PACK_SIZE_UNKNOWN', 'INFO', 'variantText', 'Pack size could not be read; the listing is not matched on size');

  return { listing: out, packSize, issues };
}
