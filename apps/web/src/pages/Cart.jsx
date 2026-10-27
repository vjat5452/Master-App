import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Calculator, Fingerprint, Layers, Lock, MapPin, PackageOpen, Route, ShoppingBag, Sparkles, Trash2, Truck, Warehouse } from 'lucide-react';
import { Attrs, primaryAttr, ProductArt } from '@/components/product';
import { Alert, Badge, Button, ErrorBox, Empty, KV, PageHeader, Panel, Segmented, Stepper, useSubmit } from '@/components/kit';
import { Card } from '@/components/ui/card';
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
      <Card className="mx-auto max-w-xl">
        <Empty
          icon={ShoppingBag}
          title="Your cart is empty"
          action={
            <Button asChild>
              <Link to="/">
                Browse products <ArrowRight />
              </Link>
            </Button>
          }
        >
          Add something from a nearby seller and we'll plan the fastest, cheapest way to deliver it.
        </Empty>
      </Card>
    );
  }

  const estimate = cart.items.reduce((s, i) => s + (i.priceHintMinor ?? 0) * i.quantity, 0);
  const ok = quote?.status === 'OK';

  return (
    <>
      <PageHeader
        eyebrow="Checkout"
        title="Your cart"
        description={
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <MapPin className="size-4 text-primary" /> Delivering to <strong className="text-foreground">{location.label}</strong> · {cart.count} item{cart.count === 1 ? '' : 's'}
          </span>
        }
        actions={
          <Button variant="ghost" onClick={cart.clear}>
            <Trash2 /> Clear cart
          </Button>
        }
      />

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-6">
          <Card className="divide-y overflow-hidden">
            <AnimatePresence initial={false}>
              {cart.items.map((i) => (
                <motion.div
                  key={i.variantId}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex flex-wrap items-center gap-4 p-4 sm:flex-nowrap sm:p-5"
                >
                  <ProductArt names={[i.group, i.name]} size="md" label={primaryAttr(i.attributes)} />
                  <div className="min-w-0 flex-1">
                    {i.brand && <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{i.brand}</div>}
                    <Link to={`/product/${i.variantId}`} className="font-bold hover:text-primary">
                      {i.name}
                    </Link>
                    <Attrs attributes={i.attributes} className="mt-1.5" />
                  </div>
                  <div className="text-right">
                    <div className="num font-extrabold">{i.priceHintMinor != null ? money(i.priceHintMinor * i.quantity) : '—'}</div>
                    {i.priceHintMinor != null && <div className="text-[11px] text-muted-foreground">from {money(i.priceHintMinor)} each</div>}
                  </div>
                  <Stepper value={i.quantity} onChange={(q) => cart.setQuantity(i.variantId, q)} />
                </motion.div>
              ))}
            </AnimatePresence>
          </Card>

          <Panel icon={Route} title="How should we fulfil it?" description="The allocation engine plans warehouses and couriers around these preferences">
            <div className="space-y-5">
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

        <div className="lg:sticky lg:top-24">
          <Card className="overflow-hidden">
            <div className="border-b bg-muted/30 px-6 py-4">
              <h3 className="font-bold">Order summary</h3>
              <p className="text-xs text-muted-foreground">{ok ? 'Live quote from the allocation engine' : 'Get a quote to see delivery fees and arrival time'}</p>
            </div>
            <div className="space-y-5 p-6">
              {ok ? (
                <KV
                  rows={[
                    ['Items', money(quote.best.itemsCostMinor)],
                    [`Delivery · ${quote.best.shipmentCount} shipment${quote.best.shipmentCount > 1 ? 's' : ''}`, money(quote.best.deliveryFeeMinor)],
                    ['Arrives in', `~${minutes(quote.best.maxEtaMinutes)}`],
                    ['Total', money(quote.best.totalLandedCostMinor), true],
                  ]}
                />
              ) : (
                <KV rows={[['Estimated items', money(estimate)], ['Delivery', <span className="text-muted-foreground">calculated at quote</span>]]} />
              )}
              <ErrorBox error={quoting.error} />
              <ErrorBox error={placing.error} />
              {!user ? (
                <Button asChild size="lg" block>
                  <Link to="/login?next=/cart">
                    <Lock /> Sign in to check out
                  </Link>
                </Button>
              ) : (
                <div className="space-y-2.5">
                  <Button variant={ok ? 'secondary' : 'primary'} block busy={quoting.busy} onClick={() => quoting.run()}>
                    <Calculator /> {quote ? 'Refresh quote' : 'Get delivery quote'}
                  </Button>
                  <Button size="lg" variant="gold" block busy={placing.busy} disabled={!ok} onClick={() => placing.run()}>
                    Place order{ok ? ` · ${money(quote.best.totalLandedCostMinor)}` : ''}
                  </Button>
                </div>
              )}
              <div className="space-y-2 rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">
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
          </Card>
        </div>
      </div>
    </>
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
