import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronRight, Layers, MapPin, ShieldCheck, ShoppingCart, Store, Timer, Trophy, Truck } from 'lucide-react';
import { Attrs, primaryAttr, ProductArt } from '@/components/product';
import { RangeSlider } from '@/components/mui/lazy';
import { Badge, Button, CopyId, Empty, ErrorBox, Panel, Reveal, Segmented, Spinner, Stepper } from '@/components/kit';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { get, qs } from '@/lib/api';
import { distance, minutes, money } from '@/lib/format';
import { useAsync, useCart, useDeliveryLocation, useToast } from '@/lib/store';
import { cn } from '@/lib/utils';
import { SORTS } from './Shop.jsx';

const RADIUS_MARKS = [5, 10, 20, 30, 50].map((v) => ({ value: v, label: `${v} km` }));

export default function Product() {
  const { variantId } = useParams();
  const { location } = useDeliveryLocation();
  const cart = useCart();
  const toast = useToast();
  const [sort, setSort] = useState('best_value');
  const [radiusKm, setRadiusKm] = useState(20);
  const [committedRadius, setCommittedRadius] = useState(20);
  const [qty, setQty] = useState(1);

  const variant = useAsync(async () => {
    const v = await get(`/catalog/variants/${variantId}`, { auth: false });
    const group = await get(`/catalog/groups/${v.groupId}`, { auth: false }).catch(() => null);
    return { ...v, group };
  }, [variantId]);
  const offers = useAsync(
    () => get(`/catalog/variants/${variantId}/offers${qs({ lat: location.lat, lng: location.lng, radiusKm: committedRadius, sort })}`, { auth: false }),
    [variantId, location.lat, location.lng, committedRadius, sort],
  );

  if (variant.loading && !variant.data) return <Spinner className="py-32" />;
  if (variant.error) return <ErrorBox error={variant.error} onRetry={variant.reload} />;
  const v = variant.data;
  const list = offers.data?.offers ?? [];
  const stock = list.reduce((n, o) => n + o.availableUnits, 0);
  const from = list.length ? Math.min(...list.map((o) => o.priceMinor)) : null;
  const top = list.length ? Math.max(...list.map((o) => o.priceMinor)) : null;
  const fastest = list.reduce((m, o) => (o.estimatedDeliveryMinutes != null && (m == null || o.estimatedDeliveryMinutes < m) ? o.estimatedDeliveryMinutes : m), null);
  const siblings = v.group?.variants.filter((s) => s.id !== v.id) ?? [];

  return (
    <div className="space-y-8">
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Shop
        </Link>
        <ChevronRight className="size-3.5" />
        <span>{v.groupName}</span>
        <ChevronRight className="size-3.5" />
        <span className="truncate font-semibold text-foreground">{v.name}</span>
      </nav>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-8">
          <Reveal>
            <Card className="grid gap-8 overflow-hidden p-6 sm:grid-cols-[260px_minmax(0,1fr)] sm:p-8">
              <ProductArt names={[v.groupName, v.name]} size="lg" label={primaryAttr(v.attributes)} />
              <div className="flex flex-col gap-4">
                <div>
                  {v.brand && <div className="text-xs font-bold uppercase tracking-[0.16em] text-primary">{v.brand}</div>}
                  <h1 className="mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl">{v.name}</h1>
                  <Attrs attributes={v.attributes} className="mt-3" />
                </div>
                {v.group?.description && <p className="text-muted-foreground">{v.group.description}</p>}
                <div className="grid grid-cols-3 gap-3">
                  <MiniStat icon={Store} label="Sellers" value={offers.data ? list.length : '…'} />
                  <MiniStat icon={Layers} label="Units nearby" value={offers.data ? stock : '…'} />
                  <MiniStat icon={Timer} label="Fastest" value={fastest != null ? `~${minutes(fastest)}` : '—'} />
                </div>
                <div className="mt-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge status={v.status} dot />
                  {v.barcode && (
                    <span className="rounded-md border bg-muted/50 px-1.5 py-0.5 font-mono">GTIN {v.barcode}</span>
                  )}
                  <CopyId id={v.id} />
                </div>
              </div>
            </Card>
          </Reveal>

          <Reveal delay={0.08}>
            <Panel
              icon={MapPin}
              title={`Sellers delivering to ${location.label ?? 'your location'}`}
              description={from != null && top !== from ? `Prices range ${money(from)} to ${money(top)}` : 'Live price, stock and delivery estimates'}
              pad={false}
              actions={<Segmented value={sort} onChange={setSort} options={SORTS} />}
            >
              <div className="border-b px-5 py-4">
                <div className="mb-1 flex items-center justify-between text-xs font-semibold text-muted-foreground">
                  <span>Search radius</span>
                  <span className="num text-foreground">{radiusKm} km</span>
                </div>
                <div className="px-2">
                  <RangeSlider value={radiusKm} onChange={setRadiusKm} onCommit={setCommittedRadius} min={2} max={50} step={1} marks={RADIUS_MARKS} format={(x) => `${x} km`} />
                </div>
              </div>
              <ErrorBox error={offers.error} onRetry={offers.reload} />
              {offers.loading && !offers.data && <Spinner />}
              {offers.data && list.length === 0 && (
                <Empty icon={Truck} title="No seller delivers here yet">
                  Widen the radius or choose a different delivery location.
                </Empty>
              )}
              {list.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Seller</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Nearest warehouse</TableHead>
                      <TableHead className="text-right">Est. delivery</TableHead>
                      <TableHead className="text-right">In stock</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.map((o, i) => {
                      const best = i === 0 && list.length > 1;
                      return (
                        <TableRow key={o.offerId} className={cn(best && 'bg-gold/[0.06] hover:bg-gold/10')}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <span className={cn('grid size-9 place-items-center rounded-xl text-sm font-extrabold', best ? 'bg-gold text-gold-foreground' : 'bg-muted text-muted-foreground')}>
                                {best ? <Trophy className="size-4" /> : o.sellerName[0]}
                              </span>
                              <div>
                                <div className="font-bold">{o.sellerName}</div>
                                {best && <div className="text-[11px] font-semibold text-amber-600 dark:text-gold">Best pick for {SORTS.find((s) => s.id === sort)?.label.toLowerCase()}</div>}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="num text-right text-base font-extrabold">{money(o.priceMinor)}</TableCell>
                          <TableCell className="num text-right text-muted-foreground">{distance(o.distanceMeters)}</TableCell>
                          <TableCell className="num text-right">{minutes(o.estimatedDeliveryMinutes)}</TableCell>
                          <TableCell className="text-right">
                            <Badge kind={o.availableUnits > 5 ? 'good' : 'warn'}>{o.availableUnits}</Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </Panel>
          </Reveal>

          {siblings.length > 0 && (
            <Reveal delay={0.12}>
              <div>
                <h2 className="mb-4 text-xl font-extrabold tracking-tight">Other {v.groupName.toLowerCase()} options</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  {siblings.map((s) => (
                    <Link
                      key={s.id}
                      to={`/product/${s.id}`}
                      className="group flex items-center gap-4 rounded-2xl border bg-card p-3 shadow-soft transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lift"
                    >
                      <ProductArt names={[s.groupName, s.name]} size="md" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{s.brand}</div>
                        <div className="truncate font-bold group-hover:text-primary">{s.name}</div>
                        <Attrs attributes={s.attributes} className="mt-1" />
                      </div>
                      <ChevronRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5" />
                    </Link>
                  ))}
                </div>
              </div>
            </Reveal>
          )}
        </div>

        <Reveal delay={0.05} className="lg:sticky lg:top-24">
          <Card className="overflow-hidden">
            <div className="bg-aurora relative p-6 text-white">
              <div className="bg-grid absolute inset-0" aria-hidden />
              <div className="relative">
                <div className="text-xs font-semibold uppercase tracking-wider text-emerald-100/80">{from != null ? 'Best price from' : 'Availability'}</div>
                <div className="num mt-1 text-4xl font-extrabold tracking-tight">
                  {from != null ? money(from) : <span className="text-xl">Not available here</span>}
                </div>
                <div className="mt-1 text-sm text-emerald-50/80">
                  {list.length} seller{list.length === 1 ? '' : 's'} · {stock} units nearby
                </div>
              </div>
            </div>
            <div className="space-y-4 p-6">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-muted-foreground">Quantity</span>
                <Stepper value={qty} onChange={setQty} min={1} max={Math.max(1, Math.min(100, stock))} />
              </div>
              <Button
                size="lg"
                block
                disabled={!list.length}
                onClick={() => {
                  cart.add({ variantId: v.id, name: v.name, brand: v.brand, group: v.groupName, attributes: v.attributes, priceHintMinor: from }, qty);
                  toast(`Added ${qty} × ${v.name}`);
                }}
              >
                <ShoppingCart /> Add to cart{from != null ? ` · ${money(from * qty)}` : ''}
              </Button>
              <Button asChild variant="secondary" block>
                <Link to="/cart">Go to checkout</Link>
              </Button>
              <ul className="space-y-2.5 border-t pt-4 text-xs text-muted-foreground">
                <li className="flex gap-2">
                  <Layers className="size-4 shrink-0 text-primary" /> Checkout plans the best warehouses and couriers for your whole cart.
                </li>
                <li className="flex gap-2">
                  <ShieldCheck className="size-4 shrink-0 text-primary" /> Stock is reserved the moment you place the order.
                </li>
              </ul>
            </div>
          </Card>
        </Reveal>
      </div>
    </div>
  );
}

function MiniStat({ icon: Icon, label, value }) {
  return (
    <div className="rounded-2xl border bg-muted/30 p-3">
      <Icon className="size-4 text-primary" />
      <div className="num mt-2 text-lg font-extrabold leading-none">{value}</div>
      <div className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
