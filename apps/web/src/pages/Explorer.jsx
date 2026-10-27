import { useEffect, useMemo, useState } from 'react';
import { Activity, KeyRound, Lock, Search, Send, ShieldCheck, Terminal } from 'lucide-react';
import { Alert, Badge, Button, ErrorBox, Field, Json, PageHeader, Panel, Spinner, useSubmit } from '@/components/kit';
import { Input, Textarea } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { API_BASE, get, newIdempotencyKey, rawRequest } from '@/lib/api';
import { useAuth, useDeliveryLocation } from '@/lib/store';
import { cn } from '@/lib/utils';

const METHOD_STYLE = {
  GET: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  POST: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  PATCH: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
};
const Method = ({ m }) => <span className={cn('inline-block w-12 shrink-0 rounded-md py-0.5 text-center font-mono text-[10px] font-bold', METHOD_STYLE[m])}>{m}</span>;

// Every route the API exposes. `auth`: none | user | company | company-manager | admin.
const ENDPOINTS = [
  { g: 'Health', m: 'GET', p: '/health/live', root: true, auth: 'none', d: 'Process is up' },
  { g: 'Health', m: 'GET', p: '/health/ready', root: true, auth: 'none', d: 'Postgres and Redis reachable' },

  { g: 'Auth', m: 'POST', p: '/auth/register', auth: 'none', d: 'Create an account', body: { name: 'New User', email: 'new.user@example.com', password: 'a-long-password' } },
  { g: 'Auth', m: 'POST', p: '/auth/login', auth: 'none', d: 'Exchange credentials for tokens', body: { email: 'customer@localstock.dev', password: 'localstock-dev-password' } },
  { g: 'Auth', m: 'POST', p: '/auth/refresh', auth: 'none', d: 'Rotate refresh token', body: { refreshToken: '<refresh token>' } },
  { g: 'Auth', m: 'POST', p: '/auth/logout', auth: 'none', d: 'Revoke a refresh token', body: { refreshToken: '<refresh token>' } },
  { g: 'Auth', m: 'GET', p: '/users/me', auth: 'user', d: 'Profile and memberships' },

  { g: 'Companies', m: 'POST', p: '/companies', auth: 'user', d: 'Register a company (you become owner)', body: { name: 'My Corner Store', registrationNumber: 'GSTIN-0000' } },
  { g: 'Companies', m: 'GET', p: '/companies', auth: 'user', d: 'Companies you belong to' },
  { g: 'Companies', m: 'GET', p: '/companies/:companyId/members', auth: 'company', d: 'Team members' },
  { g: 'Companies', m: 'POST', p: '/companies/:companyId/members', auth: 'company-manager', d: 'Add a member', body: { email: 'customer@localstock.dev', role: 'STAFF' } },

  { g: 'Warehouses', m: 'GET', p: '/companies/:companyId/warehouses', auth: 'company', d: 'List warehouses' },
  { g: 'Warehouses', m: 'POST', p: '/companies/:companyId/warehouses', auth: 'company-manager', d: 'Create warehouse', body: { name: 'Karol Bagh', address: 'Karol Bagh, Delhi', lat: 28.6519, lng: 77.1909, serviceRadiusKm: 8 } },
  { g: 'Warehouses', m: 'PATCH', p: '/companies/:companyId/warehouses/:warehouseId', auth: 'company-manager', d: 'Update name, radius or status', body: { serviceRadiusKm: 12 } },

  { g: 'Delivery', m: 'GET', p: '/companies/:companyId/delivery-providers', auth: 'company', d: "Seller's own fleet" },
  { g: 'Delivery', m: 'POST', p: '/companies/:companyId/delivery-providers', auth: 'company-manager', d: 'Register seller fleet', body: { name: 'Store Riders', baseFeeMinor: 1500, perKmFeeMinor: 500, speedKmph: 20, pickupMinutes: 15, reliability: 0.85, maxDistanceKm: 10 } },
  { g: 'Delivery', m: 'GET', p: '/delivery/providers', auth: 'user', d: 'Platform couriers' },
  { g: 'Delivery', m: 'POST', p: '/admin/delivery-providers', auth: 'admin', d: 'Add platform courier', body: { name: 'MetroShip', type: 'THIRD_PARTY', baseFeeMinor: 2800, perKmFeeMinor: 700, speedKmph: 28, pickupMinutes: 12, reliability: 0.92, maxDistanceKm: 25 } },

  { g: 'Catalog', m: 'GET', p: '/catalog/categories', auth: 'none', d: 'All categories' },
  { g: 'Catalog', m: 'POST', p: '/catalog/categories', auth: 'admin', d: 'Create category', body: { name: 'Beverages', slug: 'beverages' } },
  { g: 'Catalog', m: 'GET', p: '/catalog/groups/:groupId', auth: 'none', d: 'Group with active variants' },
  { g: 'Catalog', m: 'POST', p: '/catalog/groups', auth: 'admin', d: 'Create product group', body: { categoryId: '<category id>', name: 'Juice', description: 'Packaged juices' } },
  { g: 'Catalog', m: 'GET', p: '/catalog/variants/:variantId', auth: 'none', d: 'One variant' },
  { g: 'Catalog', m: 'POST', p: '/catalog/variants', auth: 'user', d: 'Propose a variant (matching rules apply)', body: { groupId: ':groupId', brand: 'Brand X', name: 'Whole Wheat Bread', attributes: { weight: '400 g' } } },
  { g: 'Catalog', m: 'PATCH', p: '/catalog/variants/:variantId/status', auth: 'admin', d: 'Approve or archive', body: { status: 'ACTIVE' } },

  { g: 'Offers', m: 'GET', p: '/companies/:companyId/offers', auth: 'company', d: "Seller's offers" },
  { g: 'Offers', m: 'POST', p: '/companies/:companyId/offers', auth: 'company-manager', d: 'Create offer', body: { variantId: ':variantId', sellerSku: 'SKU-001', priceMinor: 5400 } },
  { g: 'Offers', m: 'PATCH', p: '/companies/:companyId/offers/:offerId', auth: 'company-manager', d: 'Change price or status', body: { priceMinor: 5300 } },

  { g: 'Inventory', m: 'GET', p: '/companies/:companyId/inventory', auth: 'company', d: 'Stock levels (?warehouseId=)' },
  { g: 'Inventory', m: 'POST', p: '/companies/:companyId/inventory/adjustments', auth: 'company', d: 'Audited stock adjustment', body: { warehouseId: ':warehouseId', offerId: ':offerId', delta: 5, reason: 'RESTOCK', note: 'from explorer' } },

  { g: 'Discovery', m: 'GET', p: '/catalog/search', auth: 'none', d: 'Search with location filtering', query: 'q=bread&lat=:lat&lng=:lng&radiusKm=10&sort=best_value&page=1&limit=20' },
  { g: 'Discovery', m: 'GET', p: '/catalog/variants/:variantId/offers', auth: 'none', d: 'Offers for one variant', query: 'lat=:lat&lng=:lng&radiusKm=10&sort=lowest_price' },

  { g: 'Checkout', m: 'POST', p: '/checkout/quote', auth: 'user', d: 'Advisory allocation quote', body: { location: { lat: ':lat', lng: ':lng' }, items: [{ variantId: ':variantId', quantity: 2 }], preferences: { sort: 'best_value', allowSplit: true, preferSingleWarehouse: true } } },

  { g: 'Orders', m: 'POST', p: '/orders', auth: 'user', d: 'Place order (Idempotency-Key)', idem: true, body: { location: { lat: ':lat', lng: ':lng' }, items: [{ variantId: ':variantId', quantity: 1 }], preferences: { sort: 'best_value' } } },
  { g: 'Orders', m: 'GET', p: '/orders', auth: 'user', d: 'Your recent orders' },
  { g: 'Orders', m: 'GET', p: '/orders/:orderId', auth: 'user', d: 'Order detail' },
  { g: 'Orders', m: 'POST', p: '/orders/:orderId/cancel', auth: 'user', d: 'Cancel a pending order' },

  { g: 'Payments', m: 'POST', p: '/payments/sandbox/:providerPaymentId/simulate', auth: 'user', d: 'Simulate the payment page (dev only)', body: { status: 'SUCCEEDED' } },
  { g: 'Payments', m: 'POST', p: '/payments/webhooks/sandbox', auth: 'none', d: 'Provider webhook (HMAC signed)', webhook: true, body: { eventId: 'evt_manual_1', providerPaymentId: ':providerPaymentId', status: 'SUCCEEDED' } },
];

const AUTH_LABEL = { none: 'public', user: 'signed in', company: 'company member', 'company-manager': 'owner/admin', admin: 'platform admin' };
const fullPath = (ep) => (ep.root ? ep.p : `${API_BASE}${ep.p}`);

// Real ids to fill path params and bodies, discovered from the API itself.
async function discoverIds(user, location) {
  const ids = { lat: location.lat, lng: location.lng };
  const company = user?.memberships?.[0];
  const tasks = [
    get('/catalog/search?limit=5', { auth: false }).then(async (r) => {
      const v = r.items[0];
      if (!v) return;
      ids.variantId = v.variantId;
      ids.groupId = (await get(`/catalog/variants/${v.variantId}`, { auth: false })).groupId;
    }),
  ];
  if (user) {
    tasks.push(
      get('/orders').then(async (r) => {
        const o = r.items[0];
        if (!o) return;
        ids.orderId = o.id;
        ids.providerPaymentId = (await get(`/orders/${o.id}`)).payment?.providerPaymentId;
      }),
    );
  }
  if (company) {
    ids.companyId = company.companyId;
    tasks.push(get(`/companies/${company.companyId}/warehouses`).then((r) => (ids.warehouseId = r.items[0]?.id)));
    tasks.push(get(`/companies/${company.companyId}/offers`).then((r) => (ids.offerId = r.items[0]?.id)));
  }
  await Promise.allSettled(tasks);
  return ids;
}

const fill = (str, ids) => str.replace(/:([a-zA-Z]+)/g, (m, k) => (ids[k] != null ? String(ids[k]) : m));
function fillBody(body, ids) {
  // ":lat"/":lng" become numbers; other placeholders become strings.
  return JSON.stringify(body, null, 2).replace(/"(:[a-zA-Z]+)"/g, (m, ph) => {
    const k = ph.slice(1);
    if (ids[k] == null) return m;
    return typeof ids[k] === 'number' ? String(ids[k]) : JSON.stringify(String(ids[k]));
  });
}

async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default function Explorer() {
  const { user } = useAuth();
  const { location } = useDeliveryLocation();
  const [ids, setIds] = useState({ lat: location.lat, lng: location.lng });
  const [discovering, setDiscovering] = useState(true);
  const [sel, setSel] = useState(ENDPOINTS[1]);
  const [path, setPath] = useState('');
  const [query, setQuery] = useState('');
  const [body, setBody] = useState('');
  const [useAuthHeader, setUseAuthHeader] = useState(true);
  const [idemKey, setIdemKey] = useState(newIdempotencyKey());
  const [secret, setSecret] = useState('');
  const [response, setResponse] = useState(null);
  const [showHeaders, setShowHeaders] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let alive = true;
    setDiscovering(true);
    discoverIds(user, location).then((found) => alive && (setIds(found), setDiscovering(false)));
    return () => {
      alive = false;
    };
  }, [user, location]);

  useEffect(() => {
    setPath(fill(fullPath(sel), ids));
    setQuery(sel.query ? fill(sel.query, ids) : '');
    setBody(sel.body ? fillBody(sel.body, ids) : '');
    setUseAuthHeader(sel.auth !== 'none');
    setResponse(null);
  }, [sel, ids]);

  const send = useSubmit(async () => {
    let text = body.trim() ? body : undefined;
    if (text) JSON.parse(text); // surface malformed JSON before sending
    const headers = {};
    if (sel.idem) headers['Idempotency-Key'] = idemKey;
    if (sel.webhook) {
      if (!secret) throw new Error('Enter PAYMENT_WEBHOOK_SECRET from your .env to sign the webhook');
      text = JSON.stringify(JSON.parse(text)); // sign exactly the bytes we send
      headers['X-Sandbox-Signature'] = await hmacHex(secret, text);
    }
    const url = `${path}${query ? `?${query}` : ''}`;
    setResponse({ ...(await rawRequest(sel.m, url, { body: text, headers, auth: useAuthHeader })), url, method: sel.m });
  });

  const groups = useMemo(() => {
    const f = filter.toLowerCase();
    const map = new Map();
    for (const ep of ENDPOINTS) {
      if (f && !`${ep.m} ${ep.p} ${ep.d} ${ep.g}`.toLowerCase().includes(f)) continue;
      if (!map.has(ep.g)) map.set(ep.g, []);
      map.get(ep.g).push(ep);
    }
    return [...map.entries()];
  }, [filter]);

  const unresolved = (path.match(/:[a-zA-Z]+/g) ?? []).concat(body.match(/":[a-zA-Z]+"/g) ?? []);

  return (
    <>
      <PageHeader
        eyebrow="Developers"
        title="API explorer"
        description={`Every LocalStock endpoint, called through the dev proxy with your current session${user ? ` (${user.email})` : ' (signed out)'}. Ids are filled in from live data.`}
      />

      <SmokeTest ids={ids} discovering={discovering} user={user} />

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Panel pad={false} className="lg:sticky lg:top-24">
          <div className="relative border-b p-3">
            <Search className="absolute left-6 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder={`Filter ${ENDPOINTS.length} endpoints…`} value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <div className="max-h-[calc(100vh-220px)] overflow-auto p-2 scrollbar-thin">
            {groups.map(([g, eps]) => (
              <div key={g} className="mb-2">
                <div className="px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{g}</div>
                {eps.map((ep) => (
                  <button
                    key={ep.m + ep.p}
                    onClick={() => setSel(ep)}
                    title={ep.d}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-muted/60',
                      sel === ep && 'bg-accent ring-1 ring-primary/20',
                    )}
                  >
                    <Method m={ep.m} />
                    <code className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{ep.p}</code>
                    {ep.auth === 'admin' ? <ShieldCheck className="size-3.5 text-amber-500" /> : ep.auth !== 'none' && <Lock className="size-3 text-muted-foreground" />}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </Panel>

        <div className="space-y-6">
          <Panel
            title={
              <span className="flex items-center gap-2">
                <Method m={sel.m} /> {sel.d}
              </span>
            }
            actions={<Badge kind={sel.auth === 'none' ? 'muted' : 'info'}>{AUTH_LABEL[sel.auth]}</Badge>}
          >
            <div className="grid gap-4">
              <Field label="Path">
                <Input className="font-mono" value={path} onChange={(e) => setPath(e.target.value)} />
              </Field>
              {(sel.m === 'GET' || sel.query) && (
                <Field label="Query string">
                  <Input className="font-mono" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="key=value&…" />
                </Field>
              )}
              {sel.body && (
                <Field label="JSON body">
                  <Textarea className="font-mono text-xs" rows={Math.min(14, body.split('\n').length + 1)} value={body} onChange={(e) => setBody(e.target.value)} spellCheck={false} />
                </Field>
              )}
              {sel.idem && (
                <Field label="Idempotency-Key" hint="Send twice with the same key: one order, and the replay is flagged in the response headers">
                  <div className="flex gap-2">
                    <Input className="font-mono" value={idemKey} onChange={(e) => setIdemKey(e.target.value)} />
                    <Button type="button" variant="secondary" onClick={() => setIdemKey(newIdempotencyKey())}>
                      <KeyRound /> New key
                    </Button>
                  </div>
                </Field>
              )}
              {sel.webhook && (
                <Field label="Webhook secret" hint="PAYMENT_WEBHOOK_SECRET from .env. The body is signed in your browser with HMAC-SHA256 and never stored.">
                  <Input className="font-mono" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} />
                </Field>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox checked={useAuthHeader} onCheckedChange={(v) => setUseAuthHeader(Boolean(v))} />
                  Send <code className="font-mono text-xs">Authorization: Bearer</code>
                  {!user && <span className="text-muted-foreground">(not signed in)</span>}
                </label>
                <Button busy={send.busy} onClick={() => send.run()}>
                  <Send /> Send request
                </Button>
              </div>
              {unresolved.length > 0 && !discovering && (
                <Alert tone="warn">
                  Fill in {[...new Set(unresolved)].join(', ')}.{' '}
                  {!user ? 'Sign in so the explorer can find your companies and orders.' : 'No matching record was found for your account yet.'}
                </Alert>
              )}
              <ErrorBox error={send.error} />
            </div>
          </Panel>

          {send.busy && !response && <Spinner label="Waiting for the API…" />}
          {response && (
            <Panel
              icon={Terminal}
              title={
                <span className="flex items-center gap-2">
                  <Badge kind={response.ok ? 'good' : response.status >= 500 ? 'bad' : 'warn'}>{response.status}</Badge>
                  <span className="truncate font-mono text-xs font-medium">
                    {response.method} {response.url}
                  </span>
                </span>
              }
              actions={
                <>
                  <span className="num text-xs text-muted-foreground">{response.ms} ms</span>
                  <Button size="sm" variant="ghost" onClick={() => setShowHeaders((s) => !s)}>
                    {showHeaders ? 'Hide' : 'Show'} headers
                  </Button>
                </>
              }
            >
              <div className="grid gap-4">
                {showHeaders && <Json value={response.headers} small />}
                {response.status === 204 ? <div className="text-muted-foreground">204 No Content</div> : <Json value={response.data} />}
              </div>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}

/** Calls every read endpoint that can be resolved for the current user and reports the results. */
function SmokeTest({ ids, discovering, user }) {
  const [results, setResults] = useState(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    const gets = ENDPOINTS.filter((e) => e.m === 'GET');
    const out = [];
    for (const ep of gets) {
      const p = fill(fullPath(ep), ids);
      if (/:[a-zA-Z]/.test(p)) {
        out.push({ ep, skipped: 'no id available' });
        continue;
      }
      if (ep.auth !== 'none' && !user) {
        out.push({ ep, skipped: 'sign in required' });
        continue;
      }
      const q = ep.query ? `?${fill(ep.query, ids)}` : '';
      const r = await rawRequest('GET', p + q, { auth: ep.auth !== 'none' });
      const n = Array.isArray(r.data?.items) ? `${r.data.items.length} items` : Array.isArray(r.data?.offers) ? `${r.data.offers.length} offers` : r.data?.status ?? r.data?.name ?? '';
      out.push({ ep, status: r.status, ok: r.ok, ms: r.ms, summary: n });
      setResults([...out]);
    }
    setResults(out);
    setRunning(false);
  };

  const passed = results?.filter((r) => r.ok).length ?? 0;
  const ran = results?.filter((r) => !r.skipped).length ?? 0;
  return (
    <Panel
      icon={Activity}
      title="Endpoint health check"
      description={results ? undefined : 'Call every read endpoint with real ids for your account'}
      actions={
        <>
          {results && !running && (
            <Badge kind={passed === ran ? 'good' : 'bad'} dot>
              {passed}/{ran} passed
            </Badge>
          )}
          <Button size="sm" busy={running} disabled={discovering} onClick={run}>
            {discovering ? 'Finding ids…' : results ? 'Run again' : 'Call every GET endpoint'}
          </Button>
        </>
      }
      pad={!results}
    >
      {!results && (
        <p className="text-sm text-muted-foreground">
          Calls all {ENDPOINTS.filter((e) => e.m === 'GET').length} read endpoints and shows the status codes. Sign in as a seller to include the company endpoints.
        </p>
      )}
      {results && (
        <Table>
          <TableBody>
            {results.map((r) => (
              <TableRow key={r.ep.p}>
                <TableCell className="w-16">
                  <Method m="GET" />
                </TableCell>
                <TableCell className="font-mono text-xs">{r.ep.p}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.skipped ?? r.summary}</TableCell>
                <TableCell className="num text-right text-xs text-muted-foreground">{r.ms != null && `${r.ms} ms`}</TableCell>
                <TableCell className="text-right">{r.skipped ? <Badge kind="muted">skipped</Badge> : <Badge kind={r.ok ? 'good' : 'bad'}>{r.status}</Badge>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}
