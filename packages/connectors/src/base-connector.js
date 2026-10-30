import {
  assertShape,
  CAPABILITIES,
  ConnectorError,
  ERROR_CODES,
  listingSchema,
  locationSchema,
  searchResultSchema,
  serviceabilitySchema,
} from './contract.js';
import { locationCell } from './geohash.js';
import { createResiliencePolicy } from './resilience.js';

const noopLogger = { debug() {}, info() {}, warn() {}, error() {} };

/**
 * Base class for every external source. Subclasses implement the `do*` hooks they support;
 * the public methods add the shared rules:
 * - an unconfigured source fails with SOURCE_NOT_CONFIGURED before doing anything;
 * - an operation whose capability is not SUPPORTED fails with UNSUPPORTED (no guessing);
 * - every call runs under the source's resilience policy (timeout, rate limit, retry,
 *   circuit breaker, bounded concurrency);
 * - every result is validated against the contract schema (else INVALID_RESPONSE);
 * - logs carry source, operation, outcome, duration and request id, never the query
 *   location, credentials or payloads.
 */
export class BaseConnector {
  /**
   * @param {object} opts
   * @param {string} opts.code source code, e.g. "demo-quick-commerce-fixture"
   * @param {string} opts.platformCode e.g. "blinkit"
   * @param {string} opts.name display name
   * @param {string} opts.accessType one of ACCESS_TYPES
   * @param {Record<string, 'SUPPORTED'|'UNSUPPORTED'|'UNKNOWN'>} [opts.capabilities]
   * @param {boolean} [opts.isDemo]
   * @param {object} [opts.policy] resilience options (see createResiliencePolicy)
   * @param {object} [opts.logger]
   * @param {() => number} [opts.now]
   */
  constructor({ code, platformCode, name, accessType, capabilities = {}, isDemo = false, policy = {}, logger = noopLogger, now = Date.now }) {
    this.code = code;
    this.platformCode = platformCode;
    this.name = name;
    this.accessType = accessType;
    this.isDemo = isDemo;
    this.capabilities = Object.fromEntries(CAPABILITIES.map((c) => [c, capabilities[c] ?? 'UNKNOWN']));
    this.logger = logger;
    this.now = now;
    this.policy = createResiliencePolicy({
      source: code,
      now,
      ...policy,
      onRetry: ({ attempt, delay, code: errorCode }) => logger.warn('external source retry', { source: code, attempt, delayMs: delay, errorCode }),
    });
  }

  describe() {
    const config = this.validateConfiguration();
    return {
      code: this.code,
      platformCode: this.platformCode,
      name: this.name,
      accessType: this.accessType,
      isDemo: this.isDemo,
      configured: config.ok,
      missing: config.ok ? [] : config.missing,
      capabilities: { ...this.capabilities },
    };
  }

  /** @returns {{ ok: true } | { ok: false, missing: string[], reason: string }} */
  validateConfiguration() {
    return { ok: true };
  }

  async healthCheck() {
    const config = this.validateConfiguration();
    if (!config.ok) return { health: 'NOT_CONFIGURED', reason: config.reason, circuitState: this.policy.circuitState(), checkedAt: this.isoNow() };
    return { health: 'UNKNOWN', reason: 'no health check implemented for this source', circuitState: this.policy.circuitState(), checkedAt: this.isoNow() };
  }

  // Callers (the API) validate input first; bad input here is a programming error.
  async searchProducts(query, location, options = {}) {
    if (typeof query !== 'string' || !query.trim() || query.length > 200) throw new TypeError('query must be 1-200 characters');
    return this.invoke('product_search', 'searchProducts', options, searchResultSchema, (loc, signal) =>
      this.doSearchProducts(query.trim(), loc, options, signal), location);
  }

  // Single-listing lookups resolve to null when the source does not know the listing.
  getProductDetails(externalListingId, location, options = {}) {
    return this.invoke('product_details', 'getProductDetails', options, listingSchema.nullable(), (loc, signal) =>
      this.doGetProductDetails(externalListingId, loc, signal), location);
  }

  /** A fresh observation of one listing, with its price. */
  getPrice(externalListingId, location, options = {}) {
    return this.invoke('price', 'getPrice', options, listingSchema.nullable(), (loc, signal) => this.doGetPrice(externalListingId, loc, signal), location);
  }

  /** A fresh observation of one listing, with its availability. */
  getAvailability(externalListingId, location, options = {}) {
    return this.invoke('availability', 'getAvailability', options, listingSchema.nullable(), (loc, signal) =>
      this.doGetAvailability(externalListingId, loc, signal), location);
  }

  resolveServiceability(location, options = {}) {
    return this.invoke('serviceability', 'resolveServiceability', options, serviceabilitySchema, (loc, signal) =>
      this.doResolveServiceability(loc, signal), location);
  }

  getFulfillmentInfo(location, productContext = {}, options = {}) {
    return this.invoke('fulfillment_node', 'getFulfillmentInfo', options, serviceabilitySchema, (loc, signal) =>
      this.doGetFulfillmentInfo(loc, productContext, signal), location);
  }

  /** Turns one raw source record into a contract listing. Sources override this. */
  normalizeResponse() {
    throw new ConnectorError(ERROR_CODES.UNSUPPORTED, 'this source has no response normalizer', { source: this.code });
  }

  async close() {}

  // ---------------------------------------------------------------- internals

  isoNow() {
    return new Date(this.now()).toISOString();
  }

  async invoke(capability, operation, { requestId } = {}, schema, fn, location) {
    const config = this.validateConfiguration();
    if (!config.ok) throw new ConnectorError(ERROR_CODES.SOURCE_NOT_CONFIGURED, config.reason, { source: this.code });
    if (this.capabilities[capability] !== 'SUPPORTED') {
      throw new ConnectorError(ERROR_CODES.UNSUPPORTED, `${this.name} does not support ${capability}`, { source: this.code });
    }
    const parsed = locationSchema.safeParse(location);
    if (!parsed.success) throw new TypeError('a valid customer location { lat, lng } is required');
    const loc = { ...parsed.data, cell: locationCell(parsed.data) };

    const started = this.now();
    const log = { source: this.code, operation, requestId };
    try {
      const raw = await this.policy.call((signal) => fn(loc, signal));
      const result = assertShape(schema, raw, this.code);
      this.logger.info('external source call', { ...log, outcome: 'ok', durationMs: this.now() - started });
      return result;
    } catch (err) {
      const error =
        err instanceof ConnectorError
          ? err
          : new ConnectorError(ERROR_CODES.UPSTREAM_ERROR, 'unexpected connector failure', { source: this.code, retryable: false });
      this.logger.warn('external source call', { ...log, outcome: 'error', errorCode: error.code, durationMs: this.now() - started });
      if (error !== err) error.cause = err;
      throw error;
    }
  }

  unsupportedHook() {
    throw new ConnectorError(ERROR_CODES.UNSUPPORTED, `${this.name} has no implementation for this operation`, { source: this.code });
  }

  doSearchProducts() {
    return this.unsupportedHook();
  }
  doGetProductDetails() {
    return this.unsupportedHook();
  }
  doGetPrice() {
    return this.unsupportedHook();
  }
  doGetAvailability() {
    return this.unsupportedHook();
  }
  doResolveServiceability() {
    return this.unsupportedHook();
  }
  doGetFulfillmentInfo() {
    return this.unsupportedHook();
  }
}
