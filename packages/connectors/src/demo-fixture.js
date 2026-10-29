// Development-only source that serves a checked-in fixture under a fictional platform name,
// so the comparison flow can be built before any authorized access exists. It refuses to
// run in production, marks itself isDemo, and its results carry no source timestamp.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { BaseConnector } from './base-connector.js';

export const DEMO_FIXTURE_PATH = fileURLToPath(new URL('../fixtures/demo-quick-commerce.json', import.meta.url));

const fixtureSchema = z.object({
  platform: z.object({ code: z.string(), name: z.string().regex(/fixture data/i, 'the demo platform name must say it is fixture data') }),
  source: z.object({ code: z.string(), name: z.string() }),
  serviceableCellPrefixes: z.array(z.string().min(1)),
  serviceability: z.object({
    eta: z.object({ minMinutes: z.number().int(), maxMinutes: z.number().int() }),
    currency: z.string(),
    deliveryFeeMinor: z.number().int(),
    handlingFeeMinor: z.number().int(),
  }),
  listings: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      brand: z.string().nullable(),
      variantText: z.string().nullable(),
      gtin: z.string().nullable(),
      priceMinor: z.number().int(),
      mrpMinor: z.number().int().nullable(),
      outOfStockCells: z.array(z.string()).optional(),
    }),
  ),
});

// Real platform names may never appear as the demo platform.
const REAL_PLATFORMS = /blinkit|zepto|instamart|swiggy|bigbasket|amazon|flipkart|jiomart|dunzo/i;

export function loadDemoFixture(path = DEMO_FIXTURE_PATH) {
  const fixture = fixtureSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  if (REAL_PLATFORMS.test(fixture.platform.name) || REAL_PLATFORMS.test(fixture.platform.code)) {
    throw new Error('the demo fixture must use a fictional platform name');
  }
  return fixture;
}

export class DemoFixtureConnector extends BaseConnector {
  constructor({ env = process.env, fixturePath, ...opts } = {}) {
    if (env.NODE_ENV === 'production') throw new Error('The demo fixture source is for development only and cannot run in production');
    const fixture = loadDemoFixture(fixturePath);
    super({
      ...opts,
      code: fixture.source.code,
      platformCode: fixture.platform.code,
      name: fixture.platform.name,
      accessType: 'DEMO_FIXTURE',
      isDemo: true,
      capabilities: {
        product_search: 'SUPPORTED',
        product_details: 'SUPPORTED',
        price: 'SUPPORTED',
        availability: 'SUPPORTED',
        serviceability: 'SUPPORTED',
        delivery_eta: 'SUPPORTED',
        delivery_fee: 'SUPPORTED',
        fulfillment_node: 'UNSUPPORTED',
        offers: 'UNSUPPORTED',
        webhooks: 'UNSUPPORTED',
      },
    });
    this.fixture = fixture;
  }

  async healthCheck() {
    return { health: 'HEALTHY', reason: 'fixture file loaded (demo data)', circuitState: this.policy.circuitState(), checkedAt: this.isoNow() };
  }

  serviceable(cell) {
    return this.fixture.serviceableCellPrefixes.some((p) => cell.startsWith(p));
  }

  eta() {
    return { ...this.fixture.serviceability.eta, provenance: 'demo fixture' };
  }

  /** Fixture record -> contract listing for a location cell. */
  normalizeResponse(raw, cell) {
    const s = this.fixture.serviceability;
    const serviceable = this.serviceable(cell);
    return {
      externalListingId: raw.id,
      title: raw.title,
      brand: raw.brand,
      variantText: raw.variantText,
      gtin: raw.gtin,
      imageUrl: null,
      deepLink: null,
      // Prices are location-specific, so none is given where the platform does not deliver.
      price: serviceable
        ? {
            itemPriceMinor: raw.priceMinor,
            mrpMinor: raw.mrpMinor,
            currency: s.currency,
            taxInclusive: null,
            deliveryFeeMinor: s.deliveryFeeMinor,
            platformFeeMinor: null,
            handlingFeeMinor: s.handlingFeeMinor,
            otherFeeMinor: null,
            // Platform fee is unknown, so the total is only partly known.
            totalCostCompleteness: 'PARTIAL',
          }
        : null,
      availability: !serviceable ? 'NOT_SERVICEABLE' : raw.outOfStockCells?.includes(cell) ? 'OUT_OF_STOCK' : 'IN_STOCK',
      eta: serviceable ? this.eta() : null,
      fulfillmentNode: null,
      sourceObservedAt: null,
      collectedAt: this.isoNow(),
    };
  }

  findListing(id) {
    return this.fixture.listings.find((l) => l.id === id);
  }

  listingOrNull(id, cell) {
    const raw = this.findListing(id);
    if (!raw) return null;
    return this.normalizeResponse(raw, cell);
  }

  async doSearchProducts(query, location, { limit = 20 } = {}) {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    const items = this.fixture.listings
      .filter((l) => l.gtin === query || tokens.every((t) => `${l.brand ?? ''} ${l.title} ${l.variantText ?? ''}`.toLowerCase().includes(t)))
      .slice(0, limit)
      .map((l) => this.normalizeResponse(l, location.cell));
    return { items, queryCell: location.cell };
  }

  async doGetProductDetails(id, location) {
    return this.listingOrNull(id, location.cell);
  }

  async doGetPrice(id, location) {
    return this.listingOrNull(id, location.cell);
  }

  async doGetAvailability(id, location) {
    return this.listingOrNull(id, location.cell);
  }

  async doResolveServiceability(location) {
    const serviceable = this.serviceable(location.cell);
    const s = this.fixture.serviceability;
    return {
      status: serviceable ? 'SERVICEABLE' : 'NOT_SERVICEABLE',
      eta: serviceable ? this.eta() : null,
      deliveryFeeMinor: serviceable ? s.deliveryFeeMinor : null,
      currency: serviceable ? s.currency : null,
      fulfillmentNode: null,
      sourceObservedAt: null,
      collectedAt: this.isoNow(),
    };
  }
}
