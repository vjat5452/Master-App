// The contract every external data source implements. A connector reports observations
// about another platform; it never claims more than its source supplied.
import { z } from 'zod';

export const CAPABILITIES = Object.freeze([
  'product_search',
  'product_details',
  'price',
  'availability',
  'serviceability',
  'fulfillment_node',
  'delivery_eta',
  'delivery_fee',
  'offers',
  'webhooks',
]);

// Per capability: SUPPORTED, UNSUPPORTED (the source cannot do it), or UNKNOWN (access
// not researched or not granted yet). Only SUPPORTED operations are ever called.
export const CAPABILITY_STATES = Object.freeze(['SUPPORTED', 'UNSUPPORTED', 'UNKNOWN']);

export const AVAILABILITY = Object.freeze(['IN_STOCK', 'OUT_OF_STOCK', 'NOT_SERVICEABLE', 'UNKNOWN', 'FETCH_FAILED']);
export const SERVICEABILITY = Object.freeze(['SERVICEABLE', 'NOT_SERVICEABLE', 'UNKNOWN']);
export const COST_COMPLETENESS = Object.freeze(['COMPLETE', 'PARTIAL', 'UNKNOWN']);
export const ACCESS_TYPES = Object.freeze(['OFFICIAL_API', 'PARTNER_API', 'LICENSED_PROVIDER', 'PERMITTED_COLLECTION', 'DEMO_FIXTURE']);
export const HEALTH = Object.freeze(['HEALTHY', 'DEGRADED', 'DOWN', 'NOT_CONFIGURED', 'UNKNOWN']);

// Error taxonomy, shared with external_collection_runs.error_code.
export const ERROR_CODES = Object.freeze({
  SOURCE_NOT_CONFIGURED: 'SOURCE_NOT_CONFIGURED',
  UNSUPPORTED: 'UNSUPPORTED',
  TIMEOUT: 'TIMEOUT',
  RATE_LIMITED: 'RATE_LIMITED',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  CIRCUIT_OPEN: 'CIRCUIT_OPEN',
});

const RETRYABLE = new Set([ERROR_CODES.TIMEOUT, ERROR_CODES.RATE_LIMITED, ERROR_CODES.UPSTREAM_ERROR]);

export class ConnectorError extends Error {
  /**
   * @param {keyof ERROR_CODES} code
   * @param {string} message safe to log: no payloads, tokens or customer data
   * @param {{ source?: string, retryAfterMs?: number, status?: number, retryable?: boolean }} [details]
   */
  constructor(code, message, { source, retryAfterMs, status, retryable } = {}) {
    super(message);
    this.name = 'ConnectorError';
    this.code = code;
    this.source = source;
    this.retryAfterMs = retryAfterMs;
    this.status = status;
    this.retryable = retryable ?? RETRYABLE.has(code);
  }
}

export const isRetryable = (err) => err instanceof ConnectorError && err.retryable;

// ---------------------------------------------------------------- normalized output

const minor = z.number().int().min(0);
const isoTime = z.iso.datetime({ offset: true });
const gtin = z.string().regex(/^\d{8,14}$/);

export const priceSchema = z.object({
  itemPriceMinor: minor,
  mrpMinor: minor.nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  taxInclusive: z.boolean().nullable(),
  // Each mandatory fee is null when the source did not say.
  deliveryFeeMinor: minor.nullable(),
  platformFeeMinor: minor.nullable(),
  handlingFeeMinor: minor.nullable(),
  otherFeeMinor: minor.nullable(),
  totalCostCompleteness: z.enum(COST_COMPLETENESS),
});

export const etaSchema = z
  .object({
    minMinutes: z.number().int().min(0).nullable(),
    maxMinutes: z.number().int().min(0).nullable(),
    // Where the estimate came from, e.g. "source", never a guess by LocalStock.
    provenance: z.string().min(1),
  })
  .refine((e) => e.minMinutes == null || e.maxMinutes == null || e.minMinutes <= e.maxMinutes, 'minMinutes > maxMinutes');

// Present only when the source identified the node. Coordinates only if it supplied them.
export const fulfillmentNodeSchema = z
  .object({
    externalNodeId: z.string().min(1),
    name: z.string().nullable(),
    lat: z.number().min(-90).max(90).nullable(),
    lng: z.number().min(-180).max(180).nullable(),
    verification: z.enum(['UNVERIFIED', 'SOURCE_PROVIDED', 'VERIFIED']),
  })
  .refine((n) => (n.lat === null) === (n.lng === null), 'lat and lng go together')
  .refine((n) => n.lat === null || n.verification !== 'UNVERIFIED', 'coordinates need a source-provided or verified node');

export const listingSchema = z.object({
  externalListingId: z.string().min(1),
  title: z.string().min(1),
  brand: z.string().nullable(),
  variantText: z.string().nullable(),
  gtin: gtin.nullable(),
  imageUrl: z.url().nullable(),
  // Only a link the source authorizes us to show.
  deepLink: z.url().nullable(),
  price: priceSchema.nullable(),
  availability: z.enum(AVAILABILITY),
  eta: etaSchema.nullable(),
  fulfillmentNode: fulfillmentNodeSchema.nullable(),
  // What the source said; null when it said nothing (never invented).
  sourceObservedAt: isoTime.nullable(),
  collectedAt: isoTime,
});

export const serviceabilitySchema = z.object({
  status: z.enum(SERVICEABILITY),
  eta: etaSchema.nullable(),
  deliveryFeeMinor: minor.nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  fulfillmentNode: fulfillmentNodeSchema.nullable(),
  sourceObservedAt: isoTime.nullable(),
  collectedAt: isoTime,
});

export const searchResultSchema = z.object({
  items: z.array(listingSchema),
  // Coarse location cell the query was made for (geohash, at most 6 characters).
  queryCell: z.string().regex(/^[0-9b-hjkmnp-z]{1,6}$/).nullable(),
});

/**
 * Validates connector output. Anything that does not match is an INVALID_RESPONSE, so a
 * malformed upstream answer can never be shown as data.
 */
export function assertShape(schema, value, source) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new ConnectorError(ERROR_CODES.INVALID_RESPONSE, `response failed validation at ${first.path.join('.') || '(root)'}: ${first.message}`, { source });
  }
  return result.data;
}

/** Customer location as passed to connectors: coordinates plus the coarse cell. */
export const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
