// Unified comparison: LocalStock's own sellers plus every enabled external source, queried
// concurrently. Each source is bounded by its own connector timeout and by an overall
// request deadline; a slow or failing source never fails the request. Results are
// normalized into one shape but keep their provenance, freshness and certainty.
import { createHash, randomUUID } from 'node:crypto';
import { ConnectorError, ERROR_CODES, locationCell, withTimeout } from '@localstock/connectors';
import { samePackSize } from '@localstock/database';
import { createMatchingService } from '../matching/matching.service.js';
import { checkListingQuality, listingPackSize } from '../matching/normalize.js';
import { assessFreshness } from './freshness.js';
import { createLocalVendorSource, LOCAL_SOURCE, splitQuery } from './local-vendor-source.js';

const CACHE_PREFIX = 'compare:src';
// Cached source answers are kept until they expire under the freshness policy.
const CACHE_TTL_SECONDS = 3600;
// prefer_fresh reuses a cached answer younger than this instead of calling the source.
const PREFER_FRESH_MAX_AGE_SECONDS = 120;

const FEE_KEYS = ['deliveryFeeMinor', 'platformFeeMinor', 'handlingFeeMinor', 'otherFeeMinor'];

function haversineKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/**
 * Contract listing from a connector -> unified comparison result.
 * @param {object} [extra.match] from the matching service; absent means unmapped
 * @param {object[]} [extra.issues] data-quality issues from checkListingQuality
 */
export function externalResult(connector, listing, { location, now, packSize = listingPackSize(listing), match = null, issues = [] }) {
  const price = listing.price && {
    itemPriceMinor: listing.price.itemPriceMinor,
    mrpMinor: listing.price.mrpMinor,
    currency: listing.price.currency,
    taxInclusive: listing.price.taxInclusive,
    fees: Object.fromEntries(FEE_KEYS.map((k) => [k, listing.price[k]])),
    // Item plus the fees we know, only when at least the fees are partly known; an
    // UNKNOWN total is never presented as a total.
    totalKnownCostMinor:
      listing.price.totalCostCompleteness === 'UNKNOWN'
        ? null
        : listing.price.itemPriceMinor + FEE_KEYS.reduce((sum, k) => sum + (listing.price[k] ?? 0), 0),
    totalCostCompleteness: listing.price.totalCostCompleteness,
  };
  const node = listing.fulfillmentNode;
  const nodeHasCoordinates = node && node.lat !== null && node.lng !== null;
  return {
    sourceType: 'EXTERNAL_PLATFORM',
    sourceId: connector.code,
    sourceName: connector.name,
    platformCode: connector.platformCode,
    listingId: listing.externalListingId,
    // Set only for an accepted mapping (rules or a reviewer); candidates awaiting review
    // are not presented as the product.
    canonicalProductId: match?.matchStatus === 'MATCHED' ? match.canonicalProductId : null,
    matchStatus: match?.matchStatus ?? 'UNMAPPED',
    match: match?.match ?? null,
    product: {
      title: listing.title,
      brand: listing.brand,
      variant: listing.variantText,
      gtin: listing.gtin,
      imageUrl: listing.imageUrl,
      packSize,
    },
    dataQuality: { issues },
    price,
    availability: listing.availability,
    availableUnits: null,
    serviceability: listing.availability === 'NOT_SERVICEABLE' ? 'NOT_SERVICEABLE' : listing.price ? 'SERVICEABLE' : 'UNKNOWN',
    fulfillmentNode: node ? { type: 'EXTERNAL_NODE', id: node.externalNodeId, name: node.name, verification: node.verification } : null,
    // Distance only from coordinates the source supplied; otherwise unknown, never zero.
    distance: nodeHasCoordinates
      ? { km: Math.round(haversineKm(location, node) * 10) / 10, status: 'SOURCE_PROVIDED' }
      : { km: null, status: 'UNKNOWN' },
    eta: listing.eta ? { ...listing.eta, status: 'SOURCE_REPORTED' } : null,
    freshness: assessFreshness(
      { sourceType: 'EXTERNAL', isDemo: connector.isDemo, sourceObservedAt: listing.sourceObservedAt, collectedAt: listing.collectedAt },
      { now },
    ),
    dataProvenance: { sourceType: connector.accessType, isDemo: connector.isDemo, description: connector.isDemo ? 'Demo fixture data, not real prices' : `Reported by ${connector.name}` },
    orderCapability: 'EXTERNAL_PLATFORM',
    deepLink: listing.deepLink,
  };
}

/**
 * Whether a result's pack size is the one the customer asked for. EXACT and DIFFERENT need
 * both sizes known; anything else is UNKNOWN (or NOT_REQUESTED when the query has no size).
 */
export function sizeMatch(requested, actual) {
  if (!requested) return 'NOT_REQUESTED';
  if (!actual) return 'UNKNOWN';
  return samePackSize(requested, actual) ? 'EXACT' : 'DIFFERENT';
}

// Deterministic order until the ranking engine (Milestone 9): the requested size first,
// then available, then lowest item price, then source name. Unknown prices sort last.
const SIZE_ORDER = { EXACT: 0, NOT_REQUESTED: 0, UNKNOWN: 1, DIFFERENT: 2 };
const AVAILABILITY_ORDER = { IN_STOCK: 0, UNKNOWN: 1, OUT_OF_STOCK: 2, NOT_SERVICEABLE: 3, FETCH_FAILED: 4 };
function compareResults(a, b) {
  return (
    SIZE_ORDER[a.sizeMatch] - SIZE_ORDER[b.sizeMatch] ||
    AVAILABILITY_ORDER[a.availability] - AVAILABILITY_ORDER[b.availability] ||
    (a.price?.itemPriceMinor ?? Infinity) - (b.price?.itemPriceMinor ?? Infinity) ||
    a.sourceName.localeCompare(b.sourceName) ||
    String(a.listingId).localeCompare(String(b.listingId))
  );
}

const safeError = (err) =>
  err instanceof ConnectorError
    ? { code: err.code, message: err.message }
    : { code: ERROR_CODES.UPSTREAM_ERROR, message: 'The source could not be queried' };

/**
 * @param {{ pool, redis, logger, connectors, config }} deps
 *   connectors: registry from @localstock/connectors
 */
export function createCompareService({
  pool,
  redis,
  logger,
  connectors,
  config,
  localSource = createLocalVendorSource({ pool }),
  matching = createMatchingService({ pool }),
}) {
  const deadlineMs = config.COMPARE_DEADLINE_MS;

  const cacheKey = (connector, query, cell) =>
    `${CACHE_PREFIX}:${connector.code}:${cell}:${createHash('sha1').update(query.trim().toLowerCase()).digest('hex')}`;

  async function readCache(key) {
    try {
      const hit = await redis.get(key);
      return hit ? JSON.parse(hit) : null;
    } catch (err) {
      logger.debug('compare cache unavailable', { err: err.message });
      return null;
    }
  }

  function writeCache(key, value) {
    Promise.resolve()
      .then(() => redis.set(key, JSON.stringify(value), 'EX', CACHE_TTL_SECONDS))
      .catch(() => {});
  }

  async function querySource(connector, { query, location, cell, refreshPolicy, limit, requestId, now }) {
    const base = { sourceId: connector.code, sourceName: connector.name, platformCode: connector.platformCode, sourceType: 'EXTERNAL_PLATFORM', isDemo: connector.isDemo };
    const setup = connector.validateConfiguration();
    if (!setup.ok) return { ...base, status: 'NOT_CONFIGURED', message: setup.reason, results: [] };
    if (connector.capabilities.product_search !== 'SUPPORTED') return { ...base, status: 'UNSUPPORTED', message: 'Source cannot search products', results: [] };

    const key = cacheKey(connector, query, cell);
    // Quality checks, then matching against the canonical catalogue. Matching failures
    // leave results unmapped; they never fail the source.
    const toResults = async (items) => {
      const entries = items.map((listing) => ({ ...checkListingQuality(listing, { now }) }));
      let matches = new Map();
      try {
        matches = await matching.resolve(connector, entries);
      } catch (err) {
        logger.warn('external listing matching failed', { source: connector.code, requestId, err: err.message });
      }
      return entries.map(({ listing, packSize, issues }) =>
        externalResult(connector, listing, { location, now, packSize, issues, match: matches.get(listing.externalListingId) }),
      );
    };

    if (refreshPolicy !== 'refresh_supported') {
      const cached = await readCache(key);
      const ageSeconds = cached ? (now - Date.parse(cached.collectedAt)) / 1000 : Infinity;
      if (cached && (refreshPolicy === 'cache_only' || ageSeconds < PREFER_FRESH_MAX_AGE_SECONDS)) {
        return { ...base, status: 'RESPONDED', fromCache: true, results: await toResults(cached.items) };
      }
      if (refreshPolicy === 'cache_only') return { ...base, status: 'NOT_CACHED', message: 'No cached answer for this query and area', results: [] };
    }

    const started = Date.now();
    // The connector keeps running past the deadline; a late answer still fills the cache.
    const call = connector.searchProducts(query, location, { limit, requestId }).then((result) => {
      writeCache(key, { collectedAt: new Date().toISOString(), items: result.items });
      return result;
    });
    let result;
    try {
      result = await withTimeout(() => call, deadlineMs, { source: connector.code });
    } catch (err) {
      call.catch(() => {}); // already reported; avoid an unhandled rejection from the late call
      return { ...base, status: 'FAILED', error: safeError(err), durationMs: Date.now() - started, results: [] };
    }
    const durationMs = Date.now() - started;
    return { ...base, status: 'RESPONDED', fromCache: false, durationMs, results: await toResults(result.items) };
  }

  async function queryLocal({ query, location, radiusKm, limit, now, requestId }) {
    const base = { sourceId: LOCAL_SOURCE.code, sourceName: LOCAL_SOURCE.name, platformCode: null, sourceType: 'LOCAL_VENDOR', isDemo: false };
    const started = Date.now();
    try {
      const results = await withTimeout(() => localSource.search({ query, location, radiusKm, limit, now }), deadlineMs, { source: LOCAL_SOURCE.code });
      return { ...base, status: 'RESPONDED', fromCache: false, durationMs: Date.now() - started, results };
    } catch (err) {
      logger.error('local vendor comparison failed', { err, requestId });
      return { ...base, status: 'FAILED', error: safeError(err), durationMs: Date.now() - started, results: [] };
    }
  }

  return {
    /** Platform codes callers may ask for. */
    platformCodes: () => [...new Set(connectors.list().map((c) => c.platformCode))],

    async compare({ query, location, radiusKm, includeLocalVendors, platforms, refreshPolicy, limit }, { requestId = randomUUID() } = {}) {
      const now = Date.now();
      const loc = { lat: location.latitude, lng: location.longitude };
      const cell = locationCell(loc);
      const wanted = new Set(platforms ?? connectors.list().map((c) => c.platformCode));
      const sources = connectors.list().filter((c) => wanted.has(c.platformCode));

      const tasks = sources.map((c) => querySource(c, { query, location: loc, cell, refreshPolicy, limit, requestId, now }));
      if (includeLocalVendors) tasks.unshift(queryLocal({ query, location: loc, radiusKm, limit, now, requestId }));
      const answers = await Promise.all(tasks);

      const { packSize: requestedSize } = splitQuery(query);
      const results = answers
        .flatMap((a) => a.results)
        .map((r) => ({ ...r, sizeMatch: sizeMatch(requestedSize, r.product.packSize) }))
        .sort(compareResults);
      const sourceList = answers.map(({ results: r, ...meta }) => ({ ...meta, resultCount: r.length }));
      const count = (...statuses) => sourceList.filter((s) => statuses.includes(s.status)).length;
      const notices = [];
      if (results.some((r) => r.dataProvenance.isDemo)) notices.push('Includes demo fixture data. These are not real prices or stock.');
      if (results.some((r) => r.sourceType === 'EXTERNAL_PLATFORM' && r.matchStatus !== 'MATCHED')) {
        notices.push('Some external listings are not yet confirmed as the same product as a LocalStock product; compare them carefully.');
      }
      if (results.some((r) => r.dataQuality?.issues.some((i) => i.severity === 'ERROR'))) {
        notices.push('Some source values failed data-quality checks and are shown as unknown.');
      }

      if (requestedSize && results.some((r) => r.sizeMatch === 'DIFFERENT')) {
        notices.push('Some results are a different pack size from the one searched for; they are listed after exact matches.');
      }

      return {
        requestId,
        query,
        requestedPackSize: requestedSize,
        // The coarse cell only; exact coordinates are not echoed back or stored.
        location: { cell, radiusKm },
        refreshPolicy,
        generatedAt: new Date(now).toISOString(),
        results,
        sources: sourceList,
        sourceSummary: {
          requested: sourceList.length,
          responded: count('RESPONDED'),
          failed: count('FAILED'),
          notConfigured: count('NOT_CONFIGURED'),
          unsupported: count('UNSUPPORTED'),
          notCached: count('NOT_CACHED'),
        },
        notices,
      };
    },
  };
}
