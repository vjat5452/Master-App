import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildConnectorRegistry,
  ConnectorError,
  DemoFixtureConnector,
  ERROR_CODES,
  LicensedProviderConnector,
  loadConnectorConfig,
  loadDemoFixture,
  PLATFORMS,
  platformSearchLinks,
} from '../src/index.js';

const INDIA_GATE = { lat: 28.6129, lng: 77.2295 }; // cell ttnfv2, serviceable in the fixture
const NOIDA = { lat: 28.5706, lng: 77.3261 }; // ttnfx9, serviceable
const GURGAON = { lat: 28.4595, lng: 77.0266 }; // ttncbu, not serviceable
const FIXED_NOW = Date.parse('2026-10-29T10:00:00Z');
const clock = { now: () => FIXED_NOW };

const rejectsWith = (promise, code) => assert.rejects(promise, (err) => err instanceof ConnectorError && err.code === code);

// Registry and platforms

test('by default every platform is present, disabled and returns no data', async () => {
  const registry = buildConnectorRegistry({ env: {}, ...clock });
  assert.deepEqual(registry.list().map((c) => c.platformCode), PLATFORMS.map((p) => p.code));
  assert.deepEqual(registry.enabled(), []);
  for (const connector of registry.list()) {
    const described = connector.describe();
    assert.equal(described.configured, false);
    assert.ok(Object.values(described.capabilities).every((s) => s === 'UNKNOWN'), 'capabilities are unknown, not guessed');
    assert.match(connector.validateConfiguration().reason, /docs\/platforms\//);
    assert.equal((await connector.healthCheck()).health, 'NOT_CONFIGURED');
    await rejectsWith(connector.searchProducts('milk', INDIA_GATE), ERROR_CODES.SOURCE_NOT_CONFIGURED);
    await rejectsWith(connector.resolveServiceability(INDIA_GATE), ERROR_CODES.SOURCE_NOT_CONFIGURED);
    await rejectsWith(connector.getPrice('x', INDIA_GATE), ERROR_CODES.SOURCE_NOT_CONFIGURED);
  }
});

test('enabling a platform without an authorized adapter still returns no data', async () => {
  const registry = buildConnectorRegistry({ env: { ZEPTO_ENABLED: 'true' }, ...clock });
  const zepto = registry.list().find((c) => c.platformCode === 'zepto');
  assert.match(zepto.validateConfiguration().reason, /ZEPTO_ENABLED is true, but no authorized Zepto integration/);
  await rejectsWith(zepto.searchProducts('milk', INDIA_GATE), ERROR_CODES.SOURCE_NOT_CONFIGURED);
});

test('configuration is validated, and demo fixtures are refused in production', () => {
  assert.throws(() => loadConnectorConfig({ BLINKIT_ENABLED: 'yes' }), /BLINKIT_ENABLED/);
  assert.throws(() => loadConnectorConfig({ EXTERNAL_SOURCE_TIMEOUT_MS: '5' }), /EXTERNAL_SOURCE_TIMEOUT_MS/);
  assert.throws(() => loadConnectorConfig({ NODE_ENV: 'production', DEMO_EXTERNAL_FIXTURES: 'true' }), /must not be enabled in production/);
  assert.throws(() => new DemoFixtureConnector({ env: { NODE_ENV: 'production' } }), /development only/);
});

test('an incomplete licensed provider is listed as not configured, with what is missing', () => {
  const registry = buildConnectorRegistry({ env: { LICENSED_PROVIDER_ENABLED: 'true', LICENSED_PROVIDER_CODE: 'acme' }, ...clock });
  const provider = registry.get('licensed-provider');
  assert.equal(provider.describe().configured, false);
  assert.deepEqual(provider.describe().missing, ['LICENSED_PROVIDER_BASE_URL', 'LICENSED_PROVIDER_API_KEY', 'LICENSED_PROVIDER_MAPPING_FILE', 'LICENSED_PROVIDER_PLATFORMS']);
});

test('platform search links point at each platform own search page, encoded', () => {
  const links = platformSearchLinks('Maggi  Masala Noodles 70 g & more');
  assert.deepEqual(links.map((l) => l.platformCode), ['blinkit', 'zepto', 'instamart', 'bigbasket', 'amazon', 'flipkart']);
  assert.equal(links.find((l) => l.platformCode === 'amazon').url, 'https://www.amazon.in/s?k=Maggi%20Masala%20Noodles%2070%20g%20%26%20more');
  assert.equal(links.find((l) => l.platformCode === 'zepto').url, 'https://www.zeptonow.com/search?query=Maggi%20Masala%20Noodles%2070%20g%20%26%20more');
  assert.ok(links.every((l) => l.url.startsWith('https://')));
  assert.deepEqual(links.filter((l) => !l.verified).map((l) => l.platformCode), ['blinkit', 'instamart']);
});

// Demo fixture

test('the demo source is opt-in, fictional and labelled as demo', () => {
  const registry = buildConnectorRegistry({ env: { DEMO_EXTERNAL_FIXTURES: 'true' }, ...clock });
  const demo = registry.enabled();
  assert.equal(demo.length, 1);
  const d = demo[0].describe();
  assert.equal(d.isDemo, true);
  assert.equal(d.accessType, 'DEMO_FIXTURE');
  assert.match(d.name, /fixture data/);
  assert.doesNotMatch(d.name, /blinkit|zepto|instamart|bigbasket/i);
  assert.equal(d.capabilities.fulfillment_node, 'UNSUPPORTED');
  assert.ok(loadDemoFixture().listings.length > 5);
});

test('demo search returns validated listings with honest unknowns', async () => {
  const demo = new DemoFixtureConnector({ env: {}, ...clock });
  const result = await demo.searchProducts('amul taaza milk', INDIA_GATE);
  assert.equal(result.queryCell, 'ttnfv2');
  assert.deepEqual(result.items.map((i) => i.variantText), ['1 l', '500 ml']);
  const [milk] = result.items;
  assert.equal(milk.availability, 'IN_STOCK');
  assert.equal(milk.price.itemPriceMinor, 5400);
  assert.equal(milk.price.platformFeeMinor, null, 'unknown fees stay null');
  assert.equal(milk.price.totalCostCompleteness, 'PARTIAL');
  assert.equal(milk.fulfillmentNode, null, 'no dark store is invented');
  assert.equal(milk.sourceObservedAt, null, 'no source timestamp is invented');
  assert.equal(milk.collectedAt, '2026-10-29T10:00:00.000Z');
  assert.equal(milk.eta.provenance, 'demo fixture');

  const byGtin = await demo.searchProducts('8901262020015', INDIA_GATE);
  assert.equal(byGtin.items[0].title, 'Amul Cheese Slices');
});

test('demo availability depends on the location cell', async () => {
  const demo = new DemoFixtureConnector({ env: {}, ...clock });
  assert.equal((await demo.getAvailability('dqc-1003', INDIA_GATE)).availability, 'IN_STOCK');
  assert.equal((await demo.getAvailability('dqc-1003', NOIDA)).availability, 'OUT_OF_STOCK');
  const far = await demo.getAvailability('dqc-1003', GURGAON);
  assert.equal(far.availability, 'NOT_SERVICEABLE');
  assert.equal(far.price, null, 'no price where the platform does not deliver');
  assert.equal((await demo.resolveServiceability(GURGAON)).status, 'NOT_SERVICEABLE');
  assert.equal((await demo.resolveServiceability(INDIA_GATE)).deliveryFeeMinor, 2500);
  assert.equal(await demo.getProductDetails('does-not-exist', INDIA_GATE), null);
  await rejectsWith(demo.getFulfillmentInfo(INDIA_GATE), ERROR_CODES.UNSUPPORTED);
});

test('connectors reject bad input before calling anything', async () => {
  const demo = new DemoFixtureConnector({ env: {}, ...clock });
  await assert.rejects(demo.searchProducts('', INDIA_GATE), TypeError);
  await assert.rejects(demo.searchProducts('milk', { lat: 200, lng: 0 }), TypeError);
});

// Licensed provider

const MAPPING = {
  provider: 'Example Provider',
  agreementReference: 'TEST-CONTRACT-1',
  auth: { header: 'X-Api-Key' },
  rateLimit: { ratePerSecond: 100 },
  feesComplete: false,
  capabilities: { product_search: 'SUPPORTED', product_details: 'SUPPORTED', price: 'SUPPORTED', availability: 'SUPPORTED' },
  operations: {
    product_search: { path: '/v1/{platform}/search', query: { q: '{query}', cell: '{cell}' }, itemsPath: 'data.items' },
    product_details: { path: '/v1/{platform}/items/{listingId}', query: { cell: '{cell}' }, itemPath: 'item' },
    health: { path: '/v1/health' },
  },
  listing: {
    externalListingId: 'id',
    title: 'name',
    brand: 'brand',
    variantText: 'size',
    gtin: 'ean',
    itemPrice: { path: 'pricing.sale', unit: 'rupees' },
    mrp: { path: 'pricing.mrp', unit: 'rupees' },
    currency: { const: 'INR' },
    deliveryFee: { path: 'fees.delivery', unit: 'paise' },
    availability: { path: 'stock', map: { in_stock: 'IN_STOCK', oos: 'OUT_OF_STOCK' }, default: 'UNKNOWN' },
    sourceObservedAt: 'observed_at',
  },
};

const RECORD = {
  id: 'p-1',
  name: 'Toned Milk',
  brand: 'Amul',
  size: '1 l',
  ean: '8901262150064',
  pricing: { sale: '53.5', mrp: 54 },
  fees: { delivery: 1900 },
  stock: 'in_stock',
  observed_at: '2026-10-29T09:59:00Z',
};

function fakeFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return {
      status: next.status ?? 200,
      ok: (next.status ?? 200) < 300,
      headers: new Map(Object.entries(next.headers ?? {})),
      json: async () => {
        if (next.body === undefined) throw new SyntaxError('no json');
        return next.body;
      },
    };
  };
  return { fetchImpl, calls };
}

function provider(responses, overrides = {}) {
  const { fetchImpl, calls } = fakeFetch(responses);
  const connector = new LicensedProviderConnector({
    platformCode: 'blinkit',
    provider: { code: 'example', name: 'Example', baseUrl: 'https://provider.example', apiKey: 'secret-key', mapping: MAPPING, ...overrides },
    fetchImpl,
    policy: { retries: 2, baseBackoffMs: 1, maxBackoffMs: 2 },
    ...clock,
  });
  return { connector, calls };
}

test('licensed provider maps a documented response into the contract', async () => {
  const { connector, calls } = provider([{ body: { data: { items: [RECORD] } } }]);
  assert.equal(connector.code, 'example-blinkit');
  const result = await connector.searchProducts('toned milk', INDIA_GATE);
  const [item] = result.items;
  assert.equal(item.price.itemPriceMinor, 5350);
  assert.equal(item.price.mrpMinor, 5400);
  assert.equal(item.price.deliveryFeeMinor, 1900);
  assert.equal(item.price.totalCostCompleteness, 'PARTIAL', 'not every mandatory fee is known');
  assert.equal(item.availability, 'IN_STOCK');
  assert.equal(item.sourceObservedAt, '2026-10-29T09:59:00Z');

  const { url, init } = calls[0];
  assert.equal(url, 'https://provider.example/v1/blinkit/search?q=toned+milk&cell=ttnfv2');
  assert.doesNotMatch(url, /28\.6|77\.2/, 'only the coarse cell is sent when the mapping asks for it');
  assert.equal(init.headers['X-Api-Key'], 'secret-key');
  assert.equal(init.redirect, 'error', 'never follow redirects with the key');
});

test('licensed provider: unmapped availability is UNKNOWN, missing listing is null', async () => {
  const { connector } = provider([{ body: { item: { ...RECORD, stock: 'weird' } } }, { status: 404 }]);
  assert.equal((await connector.getAvailability('p-1', INDIA_GATE)).availability, 'UNKNOWN');
  assert.equal(await connector.getProductDetails('missing', INDIA_GATE), null);
});

test('licensed provider: 429 and 5xx are retried, 401 and bad data are not', async () => {
  const ok = { body: { data: { items: [RECORD] } } };
  let p = provider([{ status: 429, headers: { 'retry-after': '0' } }, { status: 503 }, ok]);
  assert.equal((await p.connector.searchProducts('milk', INDIA_GATE)).items.length, 1);
  assert.equal(p.calls.length, 3);

  p = provider([{ status: 401 }, ok]);
  await rejectsWith(p.connector.searchProducts('milk', INDIA_GATE), ERROR_CODES.UPSTREAM_ERROR);
  assert.equal(p.calls.length, 1);

  p = provider([{ body: { data: { items: [{ ...RECORD, pricing: { sale: -5 } }] } } }, ok]);
  await rejectsWith(p.connector.searchProducts('milk', INDIA_GATE), ERROR_CODES.INVALID_RESPONSE);
  assert.equal(p.calls.length, 1);

  p = provider([{ body: { unexpected: true } }]);
  await rejectsWith(p.connector.searchProducts('milk', INDIA_GATE), ERROR_CODES.INVALID_RESPONSE);

  p = provider([{ status: 200 }]);
  await rejectsWith(p.connector.searchProducts('milk', INDIA_GATE), ERROR_CODES.INVALID_RESPONSE);
});

test('licensed provider refuses unsafe or incomplete configuration', async () => {
  const insecure = provider([], { baseUrl: 'http://provider.example' }).connector;
  assert.deepEqual(insecure.validateConfiguration().missing, ['https base URL']);
  await rejectsWith(insecure.searchProducts('milk', INDIA_GATE), ERROR_CODES.SOURCE_NOT_CONFIGURED);

  const noKey = provider([], { apiKey: '' }).connector;
  assert.deepEqual(noKey.validateConfiguration().missing, ['API key']);

  const badMapping = provider([], { mapping: { ...MAPPING, agreementReference: undefined } }).connector;
  assert.match(badMapping.validateConfiguration().missing[0], /agreementReference/);
});

test('licensed provider config loads its mapping file and splits per platform', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ls-mapping-'));
  const file = join(dir, 'mapping.json');
  writeFileSync(file, JSON.stringify(MAPPING));
  const registry = buildConnectorRegistry({
    env: {
      LICENSED_PROVIDER_ENABLED: 'true',
      LICENSED_PROVIDER_CODE: 'example',
      LICENSED_PROVIDER_NAME: 'Example',
      LICENSED_PROVIDER_BASE_URL: 'https://provider.example',
      LICENSED_PROVIDER_API_KEY: 'k',
      LICENSED_PROVIDER_MAPPING_FILE: file,
      LICENSED_PROVIDER_PLATFORMS: 'blinkit, zepto',
    },
    ...clock,
  });
  assert.deepEqual(registry.enabled().map((c) => c.code), ['example-blinkit', 'example-zepto']);
  assert.ok(registry.describe().every((d) => !JSON.stringify(d).includes('"k"')), 'describe() never exposes the key');
});

test('licensed provider health check uses the documented health operation', async () => {
  let p = provider([{ body: { ok: true } }]);
  assert.equal((await p.connector.healthCheck()).health, 'HEALTHY');
  p = provider([{ status: 500 }, { status: 500 }, { status: 500 }]);
  const health = await p.connector.healthCheck();
  assert.equal(health.health, 'DOWN');
  assert.equal(health.errorCode, ERROR_CODES.UPSTREAM_ERROR);
});

test('connector logs never contain the location, query or key', async () => {
  const lines = [];
  const logger = { info: (msg, f) => lines.push(JSON.stringify({ msg, ...f })), warn: (msg, f) => lines.push(JSON.stringify({ msg, ...f })) };
  const { fetchImpl } = fakeFetch([{ status: 503 }, { body: { data: { items: [RECORD] } } }]);
  const connector = new LicensedProviderConnector({
    platformCode: 'blinkit',
    provider: { code: 'example', name: 'Example', baseUrl: 'https://provider.example', apiKey: 'secret-key', mapping: MAPPING },
    fetchImpl,
    policy: { baseBackoffMs: 1, maxBackoffMs: 1 },
    logger,
    ...clock,
  });
  await connector.searchProducts('toned milk', INDIA_GATE, { requestId: 'req-1' });
  const all = lines.join('\n');
  assert.match(all, /"requestId":"req-1"/);
  assert.match(all, /external source retry/);
  for (const secret of ['secret-key', '28.6129', '77.2295', 'ttnfv2', 'toned milk']) assert.ok(!all.includes(secret), `log leaked ${secret}`);
});
