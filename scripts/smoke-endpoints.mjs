// End-to-end check of every backend endpoint against a running API.
//
//   SMOKE_API=http://localhost:5055 SMOKE_DATABASE_URL=postgres://.../localstock_smoke node scripts/smoke-endpoints.mjs
//
// It creates all of its own data (admin, seller, customer, catalogue, store, stock,
// orders) so it must point at a throwaway database: SMOKE_DATABASE_URL is only used to
// promote the test admin, and must name a database ending in "_smoke". The API should run
// with DEMO_EXTERNAL_FIXTURES=true so the comparison and matching flows have a source.
// Exits non-zero if any check fails.
import { createHmac, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import pg from 'pg';

config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const BASE = process.env.SMOKE_API ?? 'http://localhost:5055';
const DB_URL = process.env.SMOKE_DATABASE_URL;
if (!DB_URL || !/_smoke$/.test(new URL(DB_URL).pathname)) {
  console.error('Set SMOKE_DATABASE_URL to a throwaway database whose name ends in "_smoke".');
  process.exit(2);
}
const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET;
const PASSWORD = 'smoke-test-password-123';
const tag = randomUUID().slice(0, 6);
const LOC = { lat: 28.6129, lng: 77.2295 }; // India Gate
const FAR = { lat: 19.076, lng: 72.8777 }; // Mumbai

const results = [];
const seen = new Set();
// If a step crashes, still print what ran so far.
let reported = false;
process.on('exit', () => {
  if (!reported) printReport();
});

async function call(method, path, { token, body, headers = {}, raw } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  let payload;
  if (raw !== undefined) payload = raw;
  else if (body !== undefined) {
    h['content-type'] ??= 'application/json';
    payload = JSON.stringify(body);
  }
  // Health and metrics live at the root; everything else under /api/v1.
  const url = /^\/(health|metrics)/.test(path) ? `${BASE}${path}` : `${BASE}/api/v1${path}`;
  const res = await fetch(url, { method, headers: h, body: payload });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}

/** One check: the route (as a pattern), what was tested, the expected status and extra assertions. */
async function check(route, label, expected, fn, assert = () => true) {
  const [method, pattern] = route.split(' ');
  seen.add(route);
  let r;
  let ok = false;
  let note = '';
  try {
    r = await fn();
    ok = r.status === expected;
    if (ok) {
      const extra = await assert(r);
      if (extra !== true) {
        ok = false;
        note = typeof extra === 'string' ? extra : 'assertion failed';
      }
    } else {
      note = `got ${r.status}: ${JSON.stringify(r.data?.error ?? r.data)?.slice(0, 160)}`;
    }
  } catch (err) {
    note = `threw: ${err.stack?.split('\n').slice(0, 2).join(' ')}`;
  }
  results.push({ method, pattern, label, expected, status: r?.status, ok, note });
  return r;
}

const must = (cond, msg) => (cond ? true : msg);

// ---------------------------------------------------------------- health and metrics

await check('GET /health/live', 'process up', 200, () => call('GET', '/health/live'));
await check('GET /health/ready', 'Postgres and Redis reachable', 200, () => call('GET', '/health/ready'), (r) => must(r.data.status === 'ready', 'not ready'));
await check('GET /metrics', 'Prometheus text (non-production)', 200, () => call('GET', '/metrics'), (r) => must(String(r.data).includes('localstock_http_requests_total'), 'no request counter'));

// ---------------------------------------------------------------- auth

const reg = async (name) => {
  const r = await call('POST', '/auth/register', { body: { name, email: `${name.toLowerCase()}-${tag}@smoke.test`, password: PASSWORD } });
  return r;
};
const adminReg = await check('POST /auth/register', 'register a user', 201, () => reg('Admin'), (r) => must(r.data.accessToken && r.data.refreshToken, 'no tokens'));
await check('POST /auth/register', 'duplicate email rejected', 409, () => reg('Admin'));
await check('POST /auth/register', 'invalid body rejected', 400, () => call('POST', '/auth/register', { body: { name: '', email: 'x', password: '1' } }));

const db = new pg.Client({ connectionString: DB_URL });
await db.connect();
await db.query(`UPDATE users SET platform_role = 'ADMIN' WHERE email = $1`, [`admin-${tag}@smoke.test`]);
const login = (email, password = PASSWORD) => call('POST', '/auth/login', { body: { email, password } });
const adminLogin = await check('POST /auth/login', 'log in (admin)', 200, () => login(`admin-${tag}@smoke.test`), (r) => must(r.data.accessToken, 'no token'));
await check('POST /auth/login', 'wrong password rejected', 401, () => login(`admin-${tag}@smoke.test`, 'wrong-password-123'));
const ADMIN = adminLogin.data.accessToken;

const seller = (await reg('Seller')).data;
const customer = (await reg('Customer')).data;
const staff = (await reg('Staff')).data;
const SELLER = seller.accessToken;
const CUSTOMER = customer.accessToken;

const throwaway = (await reg('Rotate')).data;
const rotated = await check('POST /auth/refresh', 'rotate refresh token', 200, () => call('POST', '/auth/refresh', { body: { refreshToken: throwaway.refreshToken } }), (r) => must(r.data.refreshToken !== throwaway.refreshToken, 'not rotated'));
await check('POST /auth/refresh', 'reusing a rotated token is refused', 401, () => call('POST', '/auth/refresh', { body: { refreshToken: throwaway.refreshToken } }));
await check('POST /auth/logout', 'log out', 204, () => call('POST', '/auth/logout', { body: { refreshToken: rotated.data.refreshToken } }));
await check('GET /users/me', 'current user', 200, () => call('GET', '/users/me', { token: SELLER }), (r) => must(r.data.email === `seller-${tag}@smoke.test`, 'wrong user'));
await check('GET /users/me', 'no token rejected', 401, () => call('GET', '/users/me'));

// ---------------------------------------------------------------- catalogue (admin)

await check('GET /catalog/categories', 'list categories', 200, () => call('GET', '/catalog/categories'));
const category = await check('POST /catalog/categories', 'create category (admin)', 201, () =>
  call('POST', '/catalog/categories', { token: ADMIN, body: { name: `Smoke Dairy ${tag}`, slug: `smoke-dairy-${tag}` } }),
);
await check('POST /catalog/categories', 'non-admin refused', 403, () => call('POST', '/catalog/categories', { token: SELLER, body: { name: 'x', slug: `x-${tag}` } }));
const group = await check('POST /catalog/groups', 'create group (admin)', 201, () =>
  call('POST', '/catalog/groups', { token: ADMIN, body: { categoryId: category.data.id, name: 'Milk' } }),
);
await check('GET /catalog/groups/:groupId', 'read group', 200, () => call('GET', `/catalog/groups/${group.data.id}`));

const variant = async (body) => call('POST', '/catalog/variants', { token: SELLER, body: { groupId: group.data.id, ...body } });
// Real GTINs of the demo fixture products, so the comparison can match them.
const milk = await check('POST /catalog/variants', 'propose a product', 201, () =>
  variant({ brand: 'Amul', name: 'Taaza Toned Milk', attributes: { volume: '1 l' }, barcode: '8901262150064' }),
  (r) => must(r.data.variant.packSize?.quantity === 1000, 'pack size not parsed'),
);
await check('POST /catalog/variants', 'same barcode returns the existing product', 200, () =>
  variant({ brand: 'Amul', name: 'Taaza Toned Milk', attributes: { volume: '1 l' }, barcode: '8901262150064' }),
  (r) => must(r.data.match === 'BARCODE', 'not matched by barcode'),
);
const similar = (await variant({ brand: 'Amul', name: 'Taaza Toned Milk Fresh', attributes: { volume: '1 l' } })).data;
const cheese = (await variant({ brand: 'Amul', name: 'Cheese Slices Classic', attributes: { weight: '200 g' } })).data.variant;
const buttermilk = (await variant({ brand: 'Amul', name: 'Masti Buttermilk Multipack', attributes: { flavour: 'spiced' } })).data.variant;
const halfLitre = (await variant({ brand: 'Amul', name: 'Lite Milk', attributes: { volume: '500 ml' } })).data.variant;
await check('GET /catalog/variants/:variantId', 'read product', 200, () => call('GET', `/catalog/variants/${milk.data.variant.id}`));
await check('GET /admin/catalog/variants/review-queue', 'possible duplicate awaits review', 200, () => call('GET', '/admin/catalog/variants/review-queue', { token: ADMIN }), (r) =>
  must(similar.variant.status === 'PENDING_REVIEW' && r.data.items.some((v) => v.id === similar.variant.id), 'duplicate not queued'),
);
await check('PATCH /catalog/variants/:variantId/status', 'admin archives the duplicate', 200, () =>
  call('PATCH', `/catalog/variants/${similar.variant.id}/status`, { token: ADMIN, body: { status: 'ARCHIVED' } }),
  (r) => must(r.data.status === 'ARCHIVED', 'not archived'),
);

// ---------------------------------------------------------------- company, members, store, fleet

const company = await check('POST /companies', 'register a company', 201, () =>
  call('POST', '/companies', { token: SELLER, body: { name: `Smoke Mart ${tag}`, vendorType: 'RETAILER', contactPhone: '+91 98100 12345' } }),
);
const CO = company.data.id;
await check('GET /companies', 'list my companies', 200, () => call('GET', '/companies', { token: SELLER }), (r) => must(r.data.items.some((c) => c.id === CO), 'missing'));
await check('POST /companies/:companyId/members', 'add staff member', 201, () =>
  call('POST', `/companies/${CO}/members`, { token: SELLER, body: { email: `staff-${tag}@smoke.test`, role: 'STAFF' } }),
);
await check('POST /companies/:companyId/members', 'duplicate member refused', 409, () =>
  call('POST', `/companies/${CO}/members`, { token: SELLER, body: { email: `staff-${tag}@smoke.test`, role: 'STAFF' } }),
);
await check('GET /companies/:companyId/members', 'list members', 200, () => call('GET', `/companies/${CO}/members`, { token: SELLER }), (r) => must(r.data.items.length === 2, 'expected 2 members'));
await check('GET /companies/:companyId/members', 'non-member gets 404', 404, () => call('GET', `/companies/${CO}/members`, { token: CUSTOMER }));

const store = await check('POST /companies/:companyId/warehouses', 'create a store', 201, () =>
  call('POST', `/companies/${CO}/warehouses`, {
    token: SELLER,
    body: { name: 'Main store', address: 'Rajpath', lat: LOC.lat + 0.01, lng: LOC.lng, serviceRadiusKm: 8, openingHours: { mon: [['08:00', '22:00']] } },
  }),
);
const WH = store.data.id;
await check('GET /companies/:companyId/warehouses', 'list stores', 200, () => call('GET', `/companies/${CO}/warehouses`, { token: SELLER }));
await check('PATCH /companies/:companyId/warehouses/:warehouseId', 'update store contact', 200, () =>
  call('PATCH', `/companies/${CO}/warehouses/${WH}`, { token: SELLER, body: { contactPhone: '011 2345 6789' } }),
  (r) => must(r.data.contactPhone === '011 2345 6789', 'not updated'),
);
await check('PATCH /companies/:companyId/warehouses/:warehouseId', 'staff cannot edit stores', 403, () =>
  call('PATCH', `/companies/${CO}/warehouses/${WH}`, { token: staff.accessToken, body: { name: 'x' } }),
);
await check('POST /companies/:companyId/delivery-providers', 'register own delivery fleet', 201, () =>
  call('POST', `/companies/${CO}/delivery-providers`, { token: SELLER, body: { name: 'Smoke Riders', baseFeeMinor: 2000, perKmFeeMinor: 500, speedKmph: 25, maxDistanceKm: 15 } }),
);
await check('GET /companies/:companyId/delivery-providers', 'list own fleet', 200, () => call('GET', `/companies/${CO}/delivery-providers`, { token: SELLER }));
await check('POST /admin/delivery-providers', 'add platform courier (admin)', 201, () =>
  call('POST', '/admin/delivery-providers', { token: ADMIN, body: { name: 'Smoke Courier', type: 'THIRD_PARTY', baseFeeMinor: 5000, perKmFeeMinor: 800, speedKmph: 20, maxDistanceKm: 10 } }),
);
await check('GET /delivery/providers', 'list available couriers', 200, () => call('GET', '/delivery/providers', { token: CUSTOMER }));

// ---------------------------------------------------------------- offers, stock, import

const offer = await check('POST /companies/:companyId/offers', 'list a product with MRP', 201, () =>
  call('POST', `/companies/${CO}/offers`, { token: SELLER, body: { variantId: milk.data.variant.id, sellerSku: 'SM-MILK-1L', priceMinor: 5200, mrpMinor: 5600 } }),
);
const OFFER = offer.data.id;
await check('POST /companies/:companyId/offers', 'price above MRP refused', 400, () =>
  call('POST', `/companies/${CO}/offers`, { token: SELLER, body: { variantId: cheese.id, sellerSku: 'SM-X', priceMinor: 6000, mrpMinor: 5000 } }),
);
await check('GET /companies/:companyId/offers', 'list offers', 200, () => call('GET', `/companies/${CO}/offers`, { token: SELLER }));
await check('PATCH /companies/:companyId/offers/:offerId', 'change price', 200, () =>
  call('PATCH', `/companies/${CO}/offers/${OFFER}`, { token: SELLER, body: { priceMinor: 5100 } }),
  (r) => must(r.data.priceMinor === 5100 && r.data.mrpMinor === 5600, 'wrong values'),
);
await check('PATCH /companies/:companyId/offers/:offerId', 'raise price above MRP refused', 422, () =>
  call('PATCH', `/companies/${CO}/offers/${OFFER}`, { token: SELLER, body: { priceMinor: 9000 } }),
);
await check('POST /companies/:companyId/inventory/adjustments', 'restock', 201, () =>
  call('POST', `/companies/${CO}/inventory/adjustments`, { token: SELLER, body: { warehouseId: WH, offerId: OFFER, delta: 20, reason: 'RESTOCK' } }),
  (r) => must(r.data.available === 20, 'wrong stock'),
);
await check('GET /companies/:companyId/inventory', 'list stock', 200, () => call('GET', `/companies/${CO}/inventory`, { token: SELLER }));

const csv = (rows) => call('POST', `/companies/${CO}/catalogue-imports?dryRun=${rows.dry}`, { token: SELLER, raw: rows.text, headers: { 'content-type': 'text/csv' } });
const importText = `sku,variant_id,price,mrp,warehouse,quantity\nSM-CHEESE,${cheese.id},140,150,Main store,15\n`;
await check('POST /companies/:companyId/catalogue-imports', 'CSV dry run', 200, () => csv({ dry: true, text: importText }), (r) =>
  must(r.data.valid && r.data.summary.offersCreated === 1, 'dry run not valid'),
);
await check('POST /companies/:companyId/catalogue-imports', 'CSV import', 201, () => csv({ dry: false, text: importText }), (r) => must(r.data.summary.stockChanged === 1, 'stock not set'));
await check('POST /companies/:companyId/catalogue-imports', 'invalid CSV imports nothing', 422, () => csv({ dry: false, text: 'sku,barcode,price\nX,123,abc\n' }));

// ---------------------------------------------------------------- discovery

await check('GET /catalog/search', 'search finds the offer near the store', 200, () =>
  call('GET', `/catalog/search?q=taaza&lat=${LOC.lat}&lng=${LOC.lng}&radiusKm=10`),
  (r) => must(r.data.items.find((i) => i.variantId === milk.data.variant.id)?.offers.length === 1, 'offer not found'),
);
await check('GET /catalog/search', 'no offers far away', 200, () => call('GET', `/catalog/search?q=taaza&lat=${FAR.lat}&lng=${FAR.lng}`), (r) =>
  must(r.data.items.every((i) => i.offers.length === 0), 'offer leaked to a far location'),
);
await check('GET /catalog/variants/:variantId/offers', 'offers for one product', 200, () =>
  call('GET', `/catalog/variants/${milk.data.variant.id}/offers?lat=${LOC.lat}&lng=${LOC.lng}`),
  (r) => must(r.data.offers.length === 1, 'expected 1 offer'),
);

await check('GET /catalog/variants/:variantId/price-history', 'price graph data', 200, () =>
  call('GET', `/catalog/variants/${milk.data.variant.id}/price-history?days=7&lat=${LOC.lat}&lng=${LOC.lng}`),
  (r) => must(r.data.series.find((s) => s.key === 'localstock')?.points.at(-1).priceMinor === 5100, 'today should show the current price'),
);
await check('GET /catalog/variants/:variantId/platform-links', 'links to each platform search page', 200, () =>
  call('GET', `/catalog/variants/${milk.data.variant.id}/platform-links`),
  (r) => must(r.data.links.length === 6 && r.data.links.every((l) => l.url.startsWith('https://')), 'expected 6 https links'),
);

const compare = (query, extra = {}) =>
  call('POST', '/discovery/compare', { body: { query, location: { latitude: LOC.lat, longitude: LOC.lng }, refreshPolicy: 'refresh_supported', ...extra } });
const cmp = await check('POST /discovery/compare', 'compare local seller and sources', 200, () => compare('Amul taaza toned milk 1 litre'), (r) => {
  const local = r.data.results.find((x) => x.sourceType === 'LOCAL_VENDOR' && x.listingId === OFFER);
  const demo = r.data.results.find((x) => x.sourceType === 'EXTERNAL_PLATFORM' && x.product.variant === '1 l');
  const notConfigured = r.data.sources.filter((s) => s.status === 'NOT_CONFIGURED').length;
  return (
    must(local?.distance.status === 'VERIFIED', 'local result missing') === true &&
    must(demo?.matchStatus === 'MATCHED' && demo.canonicalProductId === milk.data.variant.id, 'demo listing not matched by GTIN') === true &&
    must(demo.distance.km === null && demo.freshness.status === 'UNVERIFIED', 'demo shown as verified') === true &&
    must(notConfigured === 6, `expected 6 not-configured platforms, got ${notConfigured}`) === true &&
    must(r.data.results[0].rank === 1 && Array.isArray(r.data.results[0].ranking.reasons), 'no ranking')
  );
});
await check('POST /discovery/compare', 'unknown platform rejected', 400, () => compare('milk', { platforms: ['myntra'] }));

// Listings for review: "Cheese Slices Classic" (ours) vs "Cheese Slices" (demo) -> needs review.
await compare('amul cheese slices');
await compare('amul buttermilk');

const stream = await (async () => {
  const controller = new AbortController();
  const res = await fetch(`${BASE}/api/v1/discovery/stream?cell=${cmp.data.location.cell}`, { headers: { authorization: `Bearer ${CUSTOMER}` }, signal: controller.signal });
  const reader = res.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  controller.abort();
  return { status: res.status, data: first, headers: res.headers };
})();
await check('GET /discovery/stream', 'live feed opens (SSE)', 200, async () => stream, (r) =>
  must(r.headers.get('content-type').startsWith('text/event-stream') && r.data.includes(': subscribed'), 'not an event stream'),
);
await check('GET /discovery/stream', 'filter required', 400, () => call('GET', '/discovery/stream', { token: CUSTOMER }));

// ---------------------------------------------------------------- checkout, orders, payments

const cart = { location: LOC, items: [{ variantId: milk.data.variant.id, quantity: 2 }] };
await check('POST /checkout/quote', 'quote a cart', 200, () => call('POST', '/checkout/quote', { token: CUSTOMER, body: cart }), (r) => must(r.data.status === 'OK', `quote ${r.data.status}`));
const key = `smoke-${randomUUID()}`;
const order = await check('POST /orders', 'place an order', 201, () => call('POST', '/orders', { token: CUSTOMER, body: cart, headers: { 'idempotency-key': key } }));
await check('POST /orders', 'same Idempotency-Key replays the same order', 201, () => call('POST', '/orders', { token: CUSTOMER, body: cart, headers: { 'idempotency-key': key } }), (r) =>
  must(r.data.id === order.data.id && r.headers.get('idempotent-replayed') === 'true', 'not replayed'),
);
await check('POST /orders', 'Idempotency-Key required', 400, () => call('POST', '/orders', { token: CUSTOMER, body: cart }));
await check('POST /companies/:companyId/inventory/adjustments', 'stock cannot drop below reserved', 409, () =>
  call('POST', `/companies/${CO}/inventory/adjustments`, { token: SELLER, body: { warehouseId: WH, offerId: OFFER, delta: -19, reason: 'CORRECTION' } }),
);
await check('GET /orders', 'list my orders', 200, () => call('GET', '/orders', { token: CUSTOMER }), (r) => must((r.data.items ?? r.data).some?.((o) => o.id === order.data.id) ?? true, 'order missing'));
await check('GET /orders/:orderId', 'read my order', 200, () => call('GET', `/orders/${order.data.id}`, { token: CUSTOMER }));
await check('GET /orders/:orderId', "another user's order is hidden", 404, () => call('GET', `/orders/${order.data.id}`, { token: SELLER }));

const paymentId = order.data.payment?.providerPaymentId ?? order.data.payments?.[0]?.providerPaymentId;
await check('POST /payments/sandbox/:providerPaymentId/simulate', 'pay (sandbox)', 200, () =>
  call('POST', `/payments/sandbox/${paymentId}/simulate`, { token: CUSTOMER, body: { status: 'SUCCEEDED' } }),
);
await check('GET /orders/:orderId', 'order confirmed after payment', 200, () => call('GET', `/orders/${order.data.id}`, { token: CUSTOMER }), (r) => must(r.data.status === 'CONFIRMED', `status ${r.data.status}`));

const order2 = (await call('POST', '/orders', { token: CUSTOMER, body: { ...cart, items: [{ variantId: milk.data.variant.id, quantity: 1 }] }, headers: { 'idempotency-key': `smoke-${randomUUID()}` } })).data;
const order3 = (await call('POST', '/orders', { token: CUSTOMER, body: { ...cart, items: [{ variantId: milk.data.variant.id, quantity: 1 }] }, headers: { 'idempotency-key': `smoke-${randomUUID()}` } })).data;
await check('POST /orders/:orderId/cancel', 'cancel an unpaid order', 200, () => call('POST', `/orders/${order2.id}/cancel`, { token: CUSTOMER }), (r) => must(r.data.status === 'CANCELLED', `status ${r.data.status}`));
const pay3 = order3.payment?.providerPaymentId ?? order3.payments?.[0]?.providerPaymentId;
const webhookBody = JSON.stringify({ eventId: `evt_${randomUUID()}`, providerPaymentId: pay3, status: 'FAILED' });
await check('POST /payments/webhooks/sandbox', 'signed webhook (payment failed)', 200, () =>
  call('POST', '/payments/webhooks/sandbox', { raw: webhookBody, headers: { 'content-type': 'application/json', 'x-sandbox-signature': createHmac('sha256', WEBHOOK_SECRET).update(webhookBody).digest('hex') } }),
);
await check('POST /payments/webhooks/sandbox', 'bad signature rejected', 401, () =>
  call('POST', '/payments/webhooks/sandbox', { raw: webhookBody, headers: { 'content-type': 'application/json', 'x-sandbox-signature': 'deadbeef' } }),
);

// ---------------------------------------------------------------- admin: vendors and stores

await check('GET /admin/companies', 'list vendors', 200, () => call('GET', '/admin/companies', { token: ADMIN }), (r) => must(r.data.items.some((c) => c.id === CO), 'vendor missing'));
await check('GET /admin/companies', 'non-admin refused', 403, () => call('GET', '/admin/companies', { token: SELLER }));
await check('PATCH /admin/companies/:companyId/status', 'suspend vendor', 200, () => call('PATCH', `/admin/companies/${CO}/status`, { token: ADMIN, body: { status: 'SUSPENDED', reason: 'smoke test' } }));
await check('GET /catalog/variants/:variantId/offers', 'suspended vendor leaves search', 200, () =>
  call('GET', `/catalog/variants/${milk.data.variant.id}/offers?lat=${LOC.lat}&lng=${LOC.lng}`),
  (r) => must(r.data.offers.length === 0, 'still listed'),
);
await check('PATCH /admin/companies/:companyId/status', 'restore vendor', 200, () => call('PATCH', `/admin/companies/${CO}/status`, { token: ADMIN, body: { status: 'ACTIVE' } }));
await check('GET /admin/companies/:companyId/warehouses', "vendor's stores", 200, () => call('GET', `/admin/companies/${CO}/warehouses`, { token: ADMIN }));
await check('PATCH /admin/warehouses/:warehouseId/status', 'disable store', 200, () => call('PATCH', `/admin/warehouses/${WH}/status`, { token: ADMIN, body: { status: 'INACTIVE' } }));
await check('PATCH /admin/warehouses/:warehouseId/status', 'enable store', 200, () => call('PATCH', `/admin/warehouses/${WH}/status`, { token: ADMIN, body: { status: 'ACTIVE' } }));

// ---------------------------------------------------------------- admin: external sources and matching

await check('GET /admin/external-platforms', 'platforms and sources', 200, () => call('GET', '/admin/external-platforms', { token: ADMIN }), (r) => {
  const all = r.data.items.flatMap((p) => p.sources);
  return must(all.filter((s) => !s.configured).length === 6 && all.some((s) => s.code === 'demo-quick-commerce-fixture' && s.configured), 'unexpected source states');
});
await check('GET /admin/external-sources/:code/runs', 'collection runs', 200, () => call('GET', '/admin/external-sources/blinkit-official/runs', { token: ADMIN }));
await check('POST /admin/external-sources/:code/test-connection', 'health check of a disabled platform', 200, () =>
  call('POST', '/admin/external-sources/blinkit-official/test-connection', { token: ADMIN }),
  (r) => must(r.data.health === 'NOT_CONFIGURED', r.data.health),
);
await check('PATCH /admin/external-sources/:code/status', 'record access requested', 200, () =>
  call('PATCH', '/admin/external-sources/blinkit-official/status', { token: ADMIN, body: { integrationStatus: 'ACCESS_REQUESTED', note: 'smoke test' } }),
);
await check('PATCH /admin/external-sources/:code/status', 'demo source can never be ACTIVE', 422, () =>
  call('PATCH', '/admin/external-sources/demo-quick-commerce-fixture/status', { token: ADMIN, body: { integrationStatus: 'ACTIVE', note: 'passed all acceptance tests' } }),
);

const queue = await check('GET /admin/product-mapping/review-queue', 'match review queue', 200, () => call('GET', '/admin/product-mapping/review-queue', { token: ADMIN }), (r) =>
  must(r.data.items.some((i) => i.candidates.some((c) => c.variant.id === cheese.id)), 'cheese candidate not queued'),
);
const cheeseItem = queue.data.items.find((i) => i.candidates.some((c) => c.variant.id === cheese.id));
await check('POST /admin/product-mapping/:mappingId/decision', 'confirm a candidate', 200, () =>
  call('POST', `/admin/product-mapping/${cheeseItem.candidates.find((c) => c.variant.id === cheese.id).mappingId}/decision`, { token: ADMIN, body: { decision: 'CONFIRM' } }),
);
const { rows: [multipack] } = await db.query(`SELECT id FROM external_listings WHERE external_listing_id = 'dqc-1007'`);
await check('POST /admin/product-mapping/listings/:listingId/manual', 'different pack size refused', 422, () =>
  call('POST', `/admin/product-mapping/listings/${multipack.id}/manual`, { token: ADMIN, body: { variantId: halfLitre.id } }),
);
// The 6-pack matched no catalogue product, so a product was created from it.
const { rows: [created] } = await db.query(
  `SELECT m.id, m.variant_id FROM external_product_mappings m WHERE m.listing_id = $1 AND m.match_method = 'NEW_CANONICAL'`,
  [multipack.id],
);
await check('GET /catalog/search', 'product found only on another platform is searchable', 200, () => call('GET', `/catalog/search?q=buttermilk`), (r) => {
  const item = r.data.items.find((i) => i.variantId === created?.variant_id);
  return must(item?.origin === 'EXTERNAL' && item.offers.length === 0, 'discovered product missing or has offers');
});
await check('PATCH /catalog/variants/:variantId', 'admin enriches and classifies it', 200, () =>
  call('PATCH', `/catalog/variants/${created.variant_id}`, { token: ADMIN, body: { groupId: group.data.id, name: 'Masti Spiced Buttermilk Multipack' } }),
  (r) => must(r.data.groupId === group.data.id && r.data.origin === 'EXTERNAL', 'not classified'),
);
await check('POST /admin/product-mapping/listings/:listingId/manual', 'already linked: reject first', 409, () =>
  call('POST', `/admin/product-mapping/listings/${multipack.id}/manual`, { token: ADMIN, body: { variantId: buttermilk.id } }),
);
await call('POST', `/admin/product-mapping/${created.id}/decision`, { token: ADMIN, body: { decision: 'REJECT' } });
await check('POST /admin/product-mapping/listings/:listingId/manual', 'manual link (size unknown on one side)', 201, () =>
  call('POST', `/admin/product-mapping/listings/${multipack.id}/manual`, { token: ADMIN, body: { variantId: buttermilk.id, note: 'smoke test' } }),
);

await db.end();

// ---------------------------------------------------------------- report

reported = true;
printReport();

function printReport() {
const ROUTES = [
  'GET /health/live', 'GET /health/ready', 'GET /metrics',
  'POST /auth/register', 'POST /auth/login', 'POST /auth/refresh', 'POST /auth/logout', 'GET /users/me',
  'POST /companies', 'GET /companies', 'POST /companies/:companyId/members', 'GET /companies/:companyId/members',
  'POST /companies/:companyId/warehouses', 'GET /companies/:companyId/warehouses', 'PATCH /companies/:companyId/warehouses/:warehouseId',
  'POST /companies/:companyId/delivery-providers', 'GET /companies/:companyId/delivery-providers', 'POST /admin/delivery-providers', 'GET /delivery/providers',
  'GET /catalog/categories', 'POST /catalog/categories', 'POST /catalog/groups', 'GET /catalog/groups/:groupId', 'POST /catalog/variants',
  'GET /catalog/variants/:variantId', 'PATCH /catalog/variants/:variantId/status', 'PATCH /catalog/variants/:variantId',
  'POST /companies/:companyId/offers', 'GET /companies/:companyId/offers', 'PATCH /companies/:companyId/offers/:offerId',
  'POST /companies/:companyId/inventory/adjustments', 'GET /companies/:companyId/inventory', 'POST /companies/:companyId/catalogue-imports',
  'GET /catalog/search', 'GET /catalog/variants/:variantId/offers', 'POST /discovery/compare', 'GET /discovery/stream',
  'GET /catalog/variants/:variantId/price-history', 'GET /catalog/variants/:variantId/platform-links',
  'POST /checkout/quote', 'POST /orders', 'GET /orders', 'GET /orders/:orderId', 'POST /orders/:orderId/cancel',
  'POST /payments/sandbox/:providerPaymentId/simulate', 'POST /payments/webhooks/sandbox',
  'GET /admin/companies', 'PATCH /admin/companies/:companyId/status', 'GET /admin/companies/:companyId/warehouses', 'PATCH /admin/warehouses/:warehouseId/status',
  'GET /admin/external-platforms', 'GET /admin/external-sources/:code/runs', 'POST /admin/external-sources/:code/test-connection', 'PATCH /admin/external-sources/:code/status',
  'GET /admin/product-mapping/review-queue', 'POST /admin/product-mapping/:mappingId/decision', 'POST /admin/product-mapping/listings/:listingId/manual',
  'GET /admin/catalog/variants/review-queue',
];

const width = Math.max(...results.map((r) => `${r.method} ${r.pattern}`.length));
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${`${r.method} ${r.pattern}`.padEnd(width)}  ${String(r.status).padEnd(3)}  ${r.label}${r.note ? `  <- ${r.note}` : ''}`);
}
const missing = ROUTES.filter((route) => !seen.has(route));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed across ${seen.size} routes.`);
if (missing.length) console.log(`Routes not exercised: ${missing.join(', ')}`);
process.exitCode = failed.length || missing.length ? 1 : 0;
}
