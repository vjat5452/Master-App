import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Attrs, emojiFor } from '../components/product.jsx';
import { Badge, Button, Card, Empty, ErrorBox, Stepper, useSubmit } from '../components/ui.jsx';
import { newIdempotencyKey, post } from '../lib/api.js';
import { distance, minutes, money, title } from '../lib/format.js';
import { useAuth, useCart, useDeliveryLocation, useToast } from '../lib/store.jsx';

const STRATEGY = {
  SINGLE_WAREHOUSE: 'One warehouse, one delivery',
  WAREHOUSE_PER_LINE: 'Best warehouse per item',
  SPLIT: 'Split across warehouses',
};
const PROVIDER = { PLATFORM_FLEET: 'LocalStock fleet', THIRD_PARTY: 'Third-party courier', SELLER_FLEET: "Seller's own riders" };

export default function Cart() {
  const cart = useCart();
  const { user } = useAuth();
  const { location } = useDeliveryLocation();
  const toast = useToast();
  const navigate = useNavigate();
  const [prefs, setPrefs] = useState({ sort: 'best_value', allowSplit: true, preferSingleWarehouse: true });
  const [quote, setQuote] = useState(null);

  const body = useMemo(
    () => ({
      location: { lat: location.lat, lng: location.lng },
      items: cart.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
      preferences: prefs,
    }),
    [location.lat, location.lng, cart.items, prefs],
  );
  const bodyKey = JSON.stringify(body);

  // One Idempotency-Key per distinct cart: retrying the same cart can never create two orders.
  const idem = useRef({ for: null, key: null });
  if (idem.current.for !== bodyKey) idem.current = { for: bodyKey, key: newIdempotencyKey() };

  useEffect(() => setQuote(null), [bodyKey]);

  const names = Object.fromEntries(cart.items.map((i) => [i.variantId, i]));

  const quoting = useSubmit(async () => setQuote(await post('/checkout/quote', body)));
  const placing = useSubmit(async () => {
    const order = await post('/orders', body, { headers: { 'Idempotency-Key': idem.current.key } });
    const replayed = order.__headers['idempotent-replayed'] === 'true';
    cart.clear();
    toast(replayed ? 'This cart was already ordered; showing that order' : `Order placed: ${money(order.totalMinor)}, awaiting payment`);
    navigate(`/orders/${order.id}`);
  });

  if (cart.items.length === 0) {
    return (
      <Card>
        <Empty icon="🛒" title="Your cart is empty">
          <Link to="/">Browse products</Link> and add something from a nearby seller.
        </Empty>
      </Card>
    );
  }

  const estimate = cart.items.reduce((s, i) => s + (i.priceHintMinor ?? 0) * i.quantity, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Cart & checkout</h1>
          <p>
            Delivering to <strong>{location.label}</strong> · {cart.count} item{cart.count === 1 ? '' : 's'}
          </p>
        </div>
        <Button variant="ghost" onClick={cart.clear}>
          Clear cart
        </Button>
      </div>

      <div className="split">
        <div className="stack">
          <Card pad={false}>
            {cart.items.map((i) => (
              <div key={i.variantId} className="row" style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
                <div className="thumb">{emojiFor(i.group, i.name)}</div>
                <div className="grow stack-sm">
                  <div>
                    {i.brand && <span className="small faint strong">{i.brand} · </span>}
                    <Link to={`/product/${i.variantId}`} className="product-name">
                      {i.name}
                    </Link>
                  </div>
                  <Attrs attributes={i.attributes} />
                </div>
                <div className="right small muted nowrap">{i.priceHintMinor != null && <>from {money(i.priceHintMinor)}</>}</div>
                <Stepper value={i.quantity} onChange={(q) => cart.setQuantity(i.variantId, q)} />
              </div>
            ))}
          </Card>

          <Card title="Fulfillment preferences">
            <div className="stack">
              <div className="row wrap between">
                <span className="muted">Optimise for</span>
                <div className="seg">
                  {[
                    ['best_value', 'Best value'],
                    ['lowest_price', 'Lowest price'],
                    ['fastest', 'Fastest'],
                  ].map(([id, label]) => (
                    <button key={id} className={prefs.sort === id ? 'on' : ''} onClick={() => setPrefs((p) => ({ ...p, sort: id }))}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="check">
                <input type="checkbox" checked={prefs.allowSplit} onChange={(e) => setPrefs((p) => ({ ...p, allowSplit: e.target.checked }))} />
                <span>
                  <strong>Allow splitting an item across warehouses</strong>
                  <div className="small muted">Needed when no single warehouse has enough units of one item.</div>
                </span>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={prefs.preferSingleWarehouse}
                  onChange={(e) => setPrefs((p) => ({ ...p, preferSingleWarehouse: e.target.checked }))}
                />
                <span>
                  <strong>Prefer a single delivery</strong>
                  <div className="small muted">Favour plans that ship everything from one warehouse.</div>
                </span>
              </label>
            </div>
          </Card>

          {quote && <QuoteResult quote={quote} names={names} />}
        </div>

        <div className="sticky stack">
          <Card title="Summary">
            <div className="stack">
              {quote?.status === 'OK' ? (
                <dl className="kv" style={{ margin: 0 }}>
                  <dt>Items</dt>
                  <dd>{money(quote.best.itemsCostMinor)}</dd>
                  <dt>Delivery ({quote.best.shipmentCount} shipment{quote.best.shipmentCount > 1 ? 's' : ''})</dt>
                  <dd>{money(quote.best.deliveryFeeMinor)}</dd>
                  <dt>Arrives in</dt>
                  <dd>~{minutes(quote.best.maxEtaMinutes)}</dd>
                  <dt className="total-row">Total</dt>
                  <dd className="total-row">{money(quote.best.totalLandedCostMinor)}</dd>
                </dl>
              ) : (
                <dl className="kv" style={{ margin: 0 }}>
                  <dt>Estimated items</dt>
                  <dd>{money(estimate)}</dd>
                  <dt>Delivery</dt>
                  <dd className="muted">get a quote</dd>
                </dl>
              )}
              <ErrorBox error={quoting.error} />
              <ErrorBox error={placing.error} />
              {!user ? (
                <Link className="btn btn-primary btn-lg btn-block" to="/login?next=/cart">
                  Sign in to check out
                </Link>
              ) : (
                <>
                  <Button variant={quote?.status === 'OK' ? 'secondary' : 'primary'} className="btn-block" busy={quoting.busy} onClick={() => quoting.run()}>
                    {quote ? 'Refresh quote' : 'Get delivery quote'}
                  </Button>
                  <Button
                    size="lg"
                    className="btn-block"
                    busy={placing.busy}
                    disabled={quote?.status !== 'OK'}
                    onClick={() => placing.run()}
                  >
                    Place order{quote?.status === 'OK' ? ` · ${money(quote.best.totalLandedCostMinor)}` : ''}
                  </Button>
                </>
              )}
              <p className="small faint" style={{ margin: 0 }}>
                A quote reserves nothing. Placing the order reserves stock for a limited time and sends{' '}
                <span className="mono">Idempotency-Key {idem.current.key.slice(0, 13)}…</span>, so a double-click can never create a second order.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function QuoteResult({ quote, names }) {
  if (quote.status !== 'OK') {
    return (
      <div className="alert alert-warn">
        <strong>This cart can't be delivered to this location as it stands ({title(quote.reason ?? quote.status)}).</strong>
        {quote.shortages?.map((s) => (
          <div key={s.variantId}>
            {names[s.variantId]?.name ?? s.variantId}: asked for {s.requested}, {s.available} available ·{' '}
            {s.reason === 'SPLIT_NOT_ALLOWED' ? 'enable splitting to combine warehouses' : 'not enough stock nearby'}
          </div>
        ))}
      </div>
    );
  }
  const plans = [quote.best, ...(quote.alternatives ?? [])];
  return (
    <Card title="Delivery plans" actions={<span className="small faint">{plans.length} option{plans.length > 1 ? 's' : ''} evaluated</span>}>
      <div className="stack">
        {plans.map((p, idx) => (
          <div key={idx} className={`plan ${idx === 0 ? 'best' : ''}`}>
            <div className="row between wrap">
              <div className="row gap-sm">
                {idx === 0 ? <Badge kind="good">Selected</Badge> : <Badge kind="muted">Alternative</Badge>}
                <strong>{STRATEGY[p.strategy] ?? title(p.strategy)}</strong>
              </div>
              <div className="row gap-sm small">
                <span className="muted">~{minutes(p.maxEtaMinutes)}</span>
                <span className="price" style={{ fontSize: 15 }}>
                  {money(p.totalLandedCostMinor)}
                </span>
              </div>
            </div>
            <div className="stack-sm" style={{ marginTop: 10 }}>
              {p.shipments.map((s, n) => (
                <div key={n} className="shipment">
                  <div className="row between wrap small">
                    <strong>
                      Shipment {n + 1} · {distance(s.distanceMeters)} away
                    </strong>
                    <span className="muted">
                      {PROVIDER[s.delivery.providerType] ?? s.delivery.providerType} · {money(s.delivery.feeMinor)} · {minutes(s.delivery.etaMinutes)}
                    </span>
                  </div>
                  {s.lines.map((l, k) => (
                    <div key={k} className="row between small" style={{ marginTop: 4 }}>
                      <span>
                        {l.quantity} × {names[l.variantId]?.name ?? 'item'}
                      </span>
                      <span className="muted">{money(l.unitPriceMinor * l.quantity)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
