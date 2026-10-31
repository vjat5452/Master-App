// Adapter for a contracted provider with display rights; endpoints and fields come from a
// mapping file, and it stays disabled unless mapping, URL and key are all present.
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { BaseConnector } from './base-connector.js';
import { AVAILABILITY, CAPABILITIES, ConnectorError, ERROR_CODES } from './contract.js';

const fieldSpec = z.union([
  z.string().min(1), // dotted path, e.g. "pricing.sale"
  z.object({
    path: z.string().min(1).optional(),
    const: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
    unit: z.enum(['rupees', 'paise']).optional(),
    // Unmapped values become the default.
    map: z.record(z.string(), z.string()).optional(),
    default: z.union([z.string(), z.number(), z.null()]).optional(),
  }),
]);

const operationSchema = z.object({
  method: z.enum(['GET', 'POST']).default('GET'),
  // Placeholders: {query} {lat} {lng} {cell} {platform} {listingId}
  path: z.string().startsWith('/'),
  query: z.record(z.string(), z.string()).default({}),
  body: z.record(z.string(), z.string()).optional(),
  itemsPath: z.string().optional(),
  itemPath: z.string().optional(),
});

export const mappingSchema = z.object({
  provider: z.string().min(1),
  // The contract that grants the right to use the data.
  agreementReference: z.string().min(1),
  auth: z.object({ header: z.string().regex(/^[A-Za-z0-9-]+$/), prefix: z.string().default('') }),
  rateLimit: z.object({ ratePerSecond: z.number().positive(), burst: z.number().int().positive().optional() }),
  // Set only if the contract says the mapped fees are all the mandatory charges.
  feesComplete: z.boolean().default(false),
  capabilities: z.partialRecord(z.enum(CAPABILITIES), z.enum(['SUPPORTED', 'UNSUPPORTED', 'UNKNOWN'])),
  operations: z.object({
    product_search: operationSchema.optional(),
    product_details: operationSchema.optional(),
    serviceability: operationSchema.optional(),
    health: operationSchema.optional(),
  }),
  listing: z.object({
    externalListingId: fieldSpec,
    title: fieldSpec,
    brand: fieldSpec.optional(),
    variantText: fieldSpec.optional(),
    gtin: fieldSpec.optional(),
    imageUrl: fieldSpec.optional(),
    deepLink: fieldSpec.optional(),
    itemPrice: fieldSpec,
    mrp: fieldSpec.optional(),
    currency: fieldSpec,
    taxInclusive: fieldSpec.optional(),
    deliveryFee: fieldSpec.optional(),
    platformFee: fieldSpec.optional(),
    handlingFee: fieldSpec.optional(),
    otherFee: fieldSpec.optional(),
    availability: fieldSpec,
    etaMinMinutes: fieldSpec.optional(),
    etaMaxMinutes: fieldSpec.optional(),
    nodeId: fieldSpec.optional(),
    nodeName: fieldSpec.optional(),
    nodeLat: fieldSpec.optional(),
    nodeLng: fieldSpec.optional(),
    sourceObservedAt: fieldSpec.optional(),
  }),
});

export function readPath(obj, path) {
  return path.split('.').reduce((v, key) => (v == null ? undefined : v[key]), obj);
}

function readField(record, spec) {
  if (spec === undefined) return null;
  if (typeof spec === 'string') return readPath(record, spec) ?? null;
  if ('const' in spec && spec.path === undefined) return spec.const;
  let value = spec.path ? readPath(record, spec.path) : undefined;
  if (spec.map) value = value == null ? undefined : spec.map[String(value)];
  if (value === undefined || value === null) return spec.default ?? null;
  return value;
}

function toMinor(value, spec, field) {
  if (value === null || value === undefined) return null;
  const unit = typeof spec === 'object' ? spec.unit ?? 'rupees' : 'rupees';
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new ConnectorError(ERROR_CODES.INVALID_RESPONSE, `${field} is not a number`);
  return unit === 'paise' ? n : Math.round(n * 100);
}

const fill = (template, values) =>
  template.replace(/\{(\w+)\}/g, (_, key) => {
    if (!(key in values)) throw new Error(`unknown placeholder {${key}} in provider mapping`);
    return encodeURIComponent(String(values[key]));
  });

export function licensedProviderConfig(env) {
  const missing = [];
  if (env.LICENSED_PROVIDER_ENABLED !== 'true') missing.push('LICENSED_PROVIDER_ENABLED=true');
  for (const key of ['LICENSED_PROVIDER_CODE', 'LICENSED_PROVIDER_BASE_URL', 'LICENSED_PROVIDER_API_KEY', 'LICENSED_PROVIDER_MAPPING_FILE', 'LICENSED_PROVIDER_PLATFORMS']) {
    if (!env[key]) missing.push(key);
  }
  return {
    missing,
    code: env.LICENSED_PROVIDER_CODE,
    name: env.LICENSED_PROVIDER_NAME || env.LICENSED_PROVIDER_CODE,
    baseUrl: env.LICENSED_PROVIDER_BASE_URL,
    apiKey: env.LICENSED_PROVIDER_API_KEY,
    mappingFile: env.LICENSED_PROVIDER_MAPPING_FILE,
    platforms: (env.LICENSED_PROVIDER_PLATFORMS ?? '').split(',').map((p) => p.trim()).filter(Boolean),
  };
}

export class LicensedProviderConnector extends BaseConnector {
  constructor({ platformCode, provider, fetchImpl = globalThis.fetch, policy = {}, ...opts }) {
    const problems = [];
    let mapping = null;
    try {
      mapping = mappingSchema.parse(provider.mapping ?? JSON.parse(readFileSync(provider.mappingFile, 'utf8')));
    } catch (err) {
      problems.push(`valid mapping file (${err instanceof z.ZodError ? err.issues[0].path.join('.') + ': ' + err.issues[0].message : 'unreadable'})`);
    }
    let baseUrl = null;
    try {
      baseUrl = new URL(provider.baseUrl);
      if (baseUrl.protocol !== 'https:') problems.push('https base URL');
    } catch {
      problems.push('valid base URL');
    }
    if (!provider.apiKey) problems.push('API key');

    super({
      ...opts,
      code: `${provider.code}-${platformCode}`,
      platformCode,
      name: `${provider.name} (${platformCode})`,
      accessType: 'LICENSED_PROVIDER',
      capabilities: mapping?.capabilities ?? {},
      policy: { ...policy, ...(mapping ? { ratePerSecond: mapping.rateLimit.ratePerSecond, burst: mapping.rateLimit.burst } : {}) },
    });
    this.mapping = mapping;
    this.baseUrl = baseUrl;
    this.apiKey = provider.apiKey;
    this.problems = problems;
    this.fetchImpl = fetchImpl;
  }

  validateConfiguration() {
    if (this.problems.length) return { ok: false, missing: [...this.problems], reason: `Licensed provider ${this.name} is not configured: missing ${this.problems.join(', ')}` };
    return { ok: true };
  }

  async healthCheck() {
    const base = await super.healthCheck();
    if (base.health === 'NOT_CONFIGURED' || !this.mapping.operations.health) return base;
    const started = this.now();
    try {
      await this.policy.call((signal) => this.request(this.mapping.operations.health, {}, signal));
      return { health: 'HEALTHY', latencyMs: this.now() - started, circuitState: this.policy.circuitState(), checkedAt: this.isoNow() };
    } catch (err) {
      return { health: 'DOWN', errorCode: err.code ?? ERROR_CODES.UPSTREAM_ERROR, circuitState: this.policy.circuitState(), checkedAt: this.isoNow() };
    }
  }

  async request(op, values, signal) {
    const url = new URL(fill(op.path, values), this.baseUrl);
    for (const [k, v] of Object.entries(op.query)) url.searchParams.set(k, decodeURIComponent(fill(v, values)));
    const headers = { accept: 'application/json', [this.mapping.auth.header]: `${this.mapping.auth.prefix}${this.apiKey}` };
    let body;
    if (op.body) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(Object.fromEntries(Object.entries(op.body).map(([k, v]) => [k, decodeURIComponent(fill(v, values))])));
    }

    let res;
    try {
      // redirect: 'error' so the key is never sent to another host.
      res = await this.fetchImpl(url, { method: op.method, headers, body, signal, redirect: 'error' });
    } catch (err) {
      if (signal?.aborted) throw new ConnectorError(ERROR_CODES.TIMEOUT, 'request aborted after timeout', { source: this.code });
      throw new ConnectorError(ERROR_CODES.UPSTREAM_ERROR, `network error: ${err.name}`, { source: this.code });
    }
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after'));
      throw new ConnectorError(ERROR_CODES.RATE_LIMITED, 'provider rate limit (429)', {
        source: this.code,
        status: 429,
        retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
      });
    }
    if (res.status >= 500) throw new ConnectorError(ERROR_CODES.UPSTREAM_ERROR, `provider error (${res.status})`, { source: this.code, status: res.status });
    if (res.status === 401 || res.status === 403) {
      throw new ConnectorError(ERROR_CODES.UPSTREAM_ERROR, `provider rejected the credentials (${res.status})`, { source: this.code, status: res.status, retryable: false });
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new ConnectorError(ERROR_CODES.UPSTREAM_ERROR, `provider refused the request (${res.status})`, { source: this.code, status: res.status, retryable: false });
    try {
      return await res.json();
    } catch {
      throw new ConnectorError(ERROR_CODES.INVALID_RESPONSE, 'provider response is not JSON', { source: this.code });
    }
  }

  values(location, extra = {}) {
    return { lat: location.lat, lng: location.lng, cell: location.cell, platform: this.platformCode, ...extra };
  }

  normalizeResponse(record) {
    const m = this.mapping.listing;
    const f = (name) => readField(record, m[name]);
    const fees = ['deliveryFee', 'platformFee', 'handlingFee', 'otherFee'].map((name) => toMinor(f(name), m[name], name));
    const known = fees.filter((v) => v !== null).length;
    const itemPrice = toMinor(f('itemPrice'), m.itemPrice, 'itemPrice');
    const availability = f('availability');
    const nodeId = f('nodeId');
    const nodeLat = f('nodeLat');
    const nodeLng = f('nodeLng');
    const str = (v) => (v === null || v === undefined || v === '' ? null : String(v));
    const int = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

    return {
      externalListingId: str(f('externalListingId')),
      title: str(f('title')),
      brand: str(f('brand')),
      variantText: str(f('variantText')),
      gtin: str(f('gtin')),
      imageUrl: str(f('imageUrl')),
      deepLink: str(f('deepLink')),
      price:
        itemPrice === null
          ? null
          : {
              itemPriceMinor: itemPrice,
              mrpMinor: toMinor(f('mrp'), m.mrp, 'mrp'),
              currency: str(f('currency')),
              taxInclusive: typeof f('taxInclusive') === 'boolean' ? f('taxInclusive') : null,
              deliveryFeeMinor: fees[0],
              platformFeeMinor: fees[1],
              handlingFeeMinor: fees[2],
              otherFeeMinor: fees[3],
              totalCostCompleteness: this.mapping.feesComplete && known === 4 ? 'COMPLETE' : known > 0 ? 'PARTIAL' : 'UNKNOWN',
            },
      availability: AVAILABILITY.includes(availability) ? availability : 'UNKNOWN',
      eta:
        f('etaMinMinutes') === null && f('etaMaxMinutes') === null
          ? null
          : { minMinutes: int(f('etaMinMinutes')), maxMinutes: int(f('etaMaxMinutes')), provenance: `licensed provider ${this.mapping.provider}` },
      fulfillmentNode:
        nodeId === null
          ? null
          : {
              externalNodeId: String(nodeId),
              name: str(f('nodeName')),
              lat: nodeLat === null || nodeLng === null ? null : Number(nodeLat),
              lng: nodeLat === null || nodeLng === null ? null : Number(nodeLng),
              verification: nodeLat === null || nodeLng === null ? 'UNVERIFIED' : 'SOURCE_PROVIDED',
            },
      sourceObservedAt: str(f('sourceObservedAt')),
      collectedAt: this.isoNow(),
    };
  }

  async doSearchProducts(query, location, { limit = 20 } = {}, signal) {
    const op = this.mapping.operations.product_search;
    if (!op) return this.unsupportedHook();
    const json = await this.request(op, this.values(location, { query }), signal);
    const items = op.itemsPath ? readPath(json, op.itemsPath) : json;
    if (!Array.isArray(items)) throw new ConnectorError(ERROR_CODES.INVALID_RESPONSE, 'search response has no item list', { source: this.code });
    return { items: items.slice(0, limit).map((r) => this.normalizeResponse(r)), queryCell: location.cell };
  }

  async doGetProductDetails(listingId, location, signal) {
    const op = this.mapping.operations.product_details;
    if (!op) return this.unsupportedHook();
    const json = await this.request(op, this.values(location, { listingId }), signal);
    if (json === null) return null;
    return this.normalizeResponse(op.itemPath ? readPath(json, op.itemPath) : json);
  }

  // The details operation also carries price and availability.
  doGetPrice(listingId, location, signal) {
    return this.doGetProductDetails(listingId, location, signal);
  }

  doGetAvailability(listingId, location, signal) {
    return this.doGetProductDetails(listingId, location, signal);
  }
}
