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

// Subclasses implement the `do*` hooks; only SUPPORTED capabilities are ever called, and
// logs never include the query location, credentials or payloads.
export class BaseConnector {
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

  getPrice(externalListingId, location, options = {}) {
    return this.invoke('price', 'getPrice', options, listingSchema.nullable(), (loc, signal) => this.doGetPrice(externalListingId, loc, signal), location);
  }

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

  normalizeResponse() {
    throw new ConnectorError(ERROR_CODES.UNSUPPORTED, 'this source has no response normalizer', { source: this.code });
  }

  async close() {}

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
