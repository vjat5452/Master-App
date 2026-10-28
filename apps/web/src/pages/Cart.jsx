import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Calculator, ChevronRight, Fingerprint, Layers, Lock, MapPin, PackageOpen, ReceiptText, Route, ShoppingBag, Sparkles, Timer, Trash2, Truck, Warehouse, Zap } from 'lucide-react';
import { primaryAttr, ProductArt, QtyStepper } from '@/components/product';
import { Alert, Badge, Button, ErrorBox, Empty, Panel, Segmented, useSubmit } from '@/components/kit';
import { Switch } from '@/components/ui/misc';
import { newIdempotencyKey, post } from '@/lib/api';
import { distance, minutes, money, title } from '@/lib/format';
import { useAuth, useCart, useDeliveryLocation, useToast } from '@/lib/store';
import { cn } from '@/lib/utils';

const STRATEGY = {
  SINGLE_WAREHOUSE: 'One warehouse, one delivery',
  WAREHOUSE_PER_LINE: 'Best warehouse per item',
  SPLIT: 'Split across warehouses',
};
const PROVIDER = { PLATFORM_FLEET: 'LocalStock fleet', THIRD_PARTY: 'Third-party courier', SELLER_FLEET: "Seller's own riders" };
const OPTIMISE = [
  { id: 'best_value', label: 'Best value', icon: Sparkles },
  { id: 'lowest_price', label: 'Lowest price', icon: Calculator },
  { id: 'fastest', label: 'Fastest', icon: Truck },
];

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

  // Signed-in shoppers get a live bill: re-quote (debounced) whenever the cart or preferences change,
  // and drop any response that arrives for a cart that has since changed.
  const latest = useRef(bodyKey);
  latest.current = bodyKey;
  const quoting = useSubmit(async () => {
    const forKey = bodyKey;
    const q = await post('/checkout/quote', body);
    if (latest.current === forKey) setQuote(q);
  });
  useEffect(() => {
    setQuote(null);
    if (!user || cart.items.length === 0) return undefined;
    const t = setTimeout(() => quoting.run(), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyKey, user]);

  const names = Object.fromEntries(cart.items.map((i) => [i.variantId, i]));

  const placing = useSubmit(async () => {
    const order = await post('/orders', body, { headers: { 'Idempotency-Key': idem.current.key } });
    const replayed = order.__headers['idempotent-replayed'] === 'true';
    cart.clear();
    toast(replayed ? 'This cart was already ordered; showing that order' : `Order placed: ${money(order.totalMinor)}, awaiting payment`);
    navigate(`/orders/${order.id}`);
  });

  if (cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-md rounded-3xl border bg-card shadow-soft">
        <Empty
          icon={ShoppingBag}
          title="Your cart is empty"
          action={
            <Button asChild size="lg" className="rounded-xl">
              <Link to="/">
                Start shopping <ArrowRight />
              </Link>
            </Button>
          }
        >
          Add something from a nearby seller and we'll plan the fastest, cheapest way to deliver it.
        </Empty>
      </div>
    );
  }

  const estimate = cart.items.reduce((s, i) => s + (i.priceHintMinor ?? 0) * i.quantity, 0);
  const ok = quote?.status === 'OK';

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">My cart</h1>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="size-4 text-primary" /> Delivering to <strong className="text-foreground">{location.label}</strong>
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={cart.clear}>
          <Trash2 /> Clear cart
        </Button>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <div className="overflow-hidden rounded-2xl border bg-card shadow-soft">
            <div className="flex items-center gap-3 border-b bg-accent/40 px-4 py-3.5">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gold text-gold-foreground shadow-sm">
                <Timer className="size-5" />
              </span>
              <div>
                <div className="font-extrabold">
                  {ok ? `Delivery in ${minutes(quote.best.maxEtaMinutes)}` : quoting.busy ? 'Planning your delivery…' : 'Delivery time at checkout'}
                </div>
                <div className="text-xs text-muted-foreground">
                  {ok
                    ? `${quote.best.shipmentCount} shipment${quote.best.shipmentCount > 1 ? 's' : ''} · ${cart.count} item${cart.count === 1 ? '' : 's'}`
                    : `${cart.count} item${cart.count === 1 ? '' : 's'}`}
                </div>
              </div>
            </div>
            <AnimatePresence initial={false}>
              {cart.items.map((i) => (
                <motion.div
                  key={i.variantId}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0"
                >
                  <Link to={`/product/${i.variantId}`} className="shrink-0">
                    <ProductArt names={[i.group, i.name]} src={i.imageUrl} size="md" />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link to={`/product/${i.variantId}`} className="line-clamp-2 text-sm font-bold leading-snug hover:text-primary">
                      {i.brand ? `${i.brand} ${i.name}` : i.name}
                    </Link>
                    <div className="mt-0.5 text-xs text-muted-foreground">{primaryAttr(i.attributes) ?? i.group}</div>
                    <div className="num mt-1 text-sm font-extrabold">{i.priceHintMinor != null ? money(i.priceHintMinor) : '—'}</div>
                  </div>
                  <QtyStepper value={i.quantity} onChange={(q) => cart.setQuantity(i.variantId, q)} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          <Panel icon={Route} title="Delivery preferences" description="The allocation engine plans warehouses and couriers around these">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm font-semibold">Optimise for</span>
                <Segmented value={prefs.sort} onChange={(sort) => setPrefs((p) => ({ ...p, sort }))} options={OPTIMISE} />
              </div>
              <PrefRow
                checked={prefs.allowSplit}
                onChange={(allowSplit) => setPrefs((p) => ({ ...p, allowSplit }))}
                title="Allow splitting an item across warehouses"
                body="Needed when no single warehouse has enough units of one item."
              />
              <PrefRow
                checked={prefs.preferSingleWarehouse}
                onChange={(preferSingleWarehouse) => setPrefs((p) => ({ ...p, preferSingleWarehouse }))}
                title="Prefer a single delivery"
                body="Favour plans that ship everything from one warehouse."
              />
            </div>
          </Panel>

          <AnimatePresence>{quote && <QuoteResult quote={quote} names={names} />}</AnimatePresence>
        </div>

        <div className="space-y-4 lg:sticky lg:top-28">
          <div className="rounded-2xl border bg-card p-4 shadow-soft">
            <h2 className="mb-3 flex items-center gap-1.5 font-extrabold">
              <ReceiptText className="size-4 text-primary" /> Bill details
            </h2>
            <dl className="space-y-2 text-sm">
              <BillRow label="Items total" value={money(ok ? quote.best.itemsCostMinor : estimate)} note={ok ? null : 'est.'} />
              <BillRow
                label={ok ? `Delivery · ${quote.best.shipmentCount} shipment${quote.best.shipmentCount > 1 ? 's' : ''}` : 'Delivery charge'}
                value={ok ? (quote.best.deliveryFeeMinor ? money(quote.best.deliveryFeeMinor) : <span className="font-extrabold text-primary">FREE</span>) : '—'}
              />
              {ok && <BillRow label="Arrives in" value={`~${minutes(quote.best.maxEtaMinutes)}`} />}
              <div className="flex items-center justify-between border-t pt-3 text-base font-black">
                <dt>Grand total</dt>
                <dd className="num">{ok ? money(quote.best.totalLandedCostMinor) : '—'}</dd>
              </div>
            </dl>
            {!user && <p className="mt-3 text-xs text-muted-foreground">Sign in to see delivery charges and arrival time.</p>}
          </div>

          <ErrorBox error={quoting.error} onRetry={() => quoting.run()} />
          <ErrorBox error={placing.error} />

          {!user ? (
            <Button asChild size="lg" block className="h-14 rounded-xl">
              <Link to="/login?next=/cart">
                <Lock /> Sign in to check out
              </Link>
            </Button>
          ) : (
            <button
              type="button"
              disabled={!ok || placing.busy}
              onClick={() => placing.run()}
              className="flex h-14 w-full items-center justify-between rounded-xl bg-primary px-4 text-primary-foreground shadow-glow transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="text-left leading-tight">
                <span className="num block text-base font-black">{ok ? money(quote.best.totalLandedCostMinor) : '…'}</span>
                <span className="text-[10px] font-bold uppercase tracking-wide opacity-80">Total</span>
              </span>
              <span className="flex items-center gap-1 text-base font-extrabold">
                {placing.busy ? 'Placing…' : quoting.busy && !ok ? 'Getting quote…' : 'Place order'} <ChevronRight className="size-5" />
              </span>
            </button>
          )}

          <div className="space-y-2 rounded-2xl border bg-card p-3 text-xs text-muted-foreground">
            <div className="flex gap-2">
              <Zap className="size-3.5 shrink-0 text-primary" /> Prices update live from nearby sellers; the bill reflects the plan above.
            </div>
            <div className="flex gap-2">
              <Lock className="size-3.5 shrink-0 text-primary" /> A quote reserves nothing. Placing the order holds stock for a limited time.
            </div>
            <div className="flex gap-2">
              <Fingerprint className="size-3.5 shrink-0 text-primary" />
              <span>
                Protected by <span className="font-mono text-foreground/80">Idempotency-Key {idem.current.key.slice(0, 13)}…</span>: a double-click can never create a second order.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BillRow({ label, value, note }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">
        {label}
        {note && <span className="ml-1 text-[10px] uppercase">({note})</span>}
      </dt>
      <dd className="num font-semibold">{value}</dd>
    </div>
  );
}

function PrefRow({ checked, onChange, title: heading, body }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border p-4 transition hover:bg-muted/30">
      <span>
        <span className="block text-sm font-bold">{heading}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{body}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function QuoteResult({ quote, names }) {
  if (quote.status !== 'OK') {
    return (
      <Alert tone="warn" title={`This cart can't be delivered here as it stands (${title(quote.reason ?? quote.status)})`}>
        <ul className="mt-1 space-y-1">
          {quote.shortages?.map((s) => (
            <li key={s.variantId}>
              {names[s.variantId]?.name ?? s.variantId}: asked for {s.requested}, {s.available} available ·{' '}
              {s.reason === 'SPLIT_NOT_ALLOWED' ? 'enable splitting to combine warehouses' : 'not enough stock nearby'}
            </li>
          ))}
        </ul>
      </Alert>
    );
  }
  const plans = [quote.best, ...(quote.alternatives ?? [])];
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      <Panel icon={Layers} title="Delivery plans" description={`${plans.length} option${plans.length > 1 ? 's' : ''} evaluated by the allocation engine`} pad={false}>
        <div className="space-y-3 p-4">
          {plans.map((p, idx) => {
            const best = idx === 0;
            return (
              <div key={idx} className={cn('rounded-2xl border p-4 transition', best ? 'border-primary/40 bg-accent/40 ring-2 ring-primary/10' : 'bg-card opacity-90')}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {best ? <Badge kind="good" dot>Selected</Badge> : <Badge kind="muted">Alternative</Badge>}
                    <strong>{STRATEGY[p.strategy] ?? title(p.strategy)}</strong>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <Truck className="size-3.5" /> ~{minutes(p.maxEtaMinutes)}
                    </span>
                    <span className="num font-extrabold">{money(p.totalLandedCostMinor)}</span>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {p.shipments.map((s, n) => (
                    <div key={n} className="rounded-xl border bg-card p-3">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="inline-flex items-center gap-1.5 font-bold">
                          <Warehouse className="size-3.5 text-primary" /> Shipment {n + 1} · {distance(s.distanceMeters)}
                        </span>
                        <span className="text-muted-foreground">{minutes(s.delivery.etaMinutes)}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {PROVIDER[s.delivery.providerType] ?? s.delivery.providerType} · fee {money(s.delivery.feeMinor)}
                      </div>
                      <div className="mt-2 space-y-1 border-t pt-2">
                        {s.lines.map((l, k) => (
                          <div key={k} className="flex justify-between gap-2 text-xs">
                            <span className="inline-flex min-w-0 items-center gap-1">
                              <PackageOpen className="size-3 shrink-0 text-muted-foreground" />
                              <span className="truncate">
                                {l.quantity} × {names[l.variantId]?.name ?? 'item'}
                              </span>
                            </span>
                            <span className="num text-muted-foreground">{money(l.unitPriceMinor * l.quantity)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </motion.div>
  );
}
