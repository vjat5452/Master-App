import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, ChevronLeft, ChevronRight, Layers, MapPin, PackageCheck, Search, SearchX, ShieldCheck, ShoppingCart, Sparkles, Store, Truck } from 'lucide-react';
import { Attrs, OfferLine, primaryAttr, ProductArt } from '@/components/product';
import { Button, Empty, ErrorBox, Segmented, Stepper } from '@/components/kit';
import { Card } from '@/components/ui/card';
import { Skeleton, Switch } from '@/components/ui/misc';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { get, qs } from '@/lib/api';
import { money } from '@/lib/format';
import { useAsync, useCart, useDeliveryLocation, useToast } from '@/lib/store';

export const SORTS = [
  { id: 'best_value', label: 'Best value' },
  { id: 'lowest_price', label: 'Lowest price' },
  { id: 'fastest', label: 'Fastest' },
  { id: 'nearest', label: 'Nearest' },
];
const RADII = [2, 5, 10, 20, 50];
const SUGGESTIONS = ['bread', 'milk', 'whole wheat', 'multigrain'];

const FEATURES = [
  { icon: Store, title: 'Every seller, side by side', body: 'One product page lists each nearby seller with price, stock and delivery estimate.' },
  { icon: Layers, title: 'One cart, many warehouses', body: 'The allocation engine plans the cheapest or fastest way to fulfil the whole cart.' },
  { icon: ShieldCheck, title: 'Stock held at checkout', body: 'Placing an order reserves units atomically, so what you pay for is really there.' },
  { icon: Truck, title: 'Hybrid delivery', body: 'Platform fleet, couriers or the seller’s own riders: whichever lands it best.' },
];

export default function Shop() {
  const { location } = useDeliveryLocation();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const sort = params.get('sort') ?? 'best_value';
  const radiusKm = Number(params.get('radiusKm') ?? 10);
  const page = Number(params.get('page') ?? 1);
  const anywhere = params.get('anywhere') === '1';
  const [draft, setDraft] = useState(q);

  const update = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === '' || v == null || v === false) next.delete(k);
      else next.set(k, v === true ? '1' : String(v));
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };

  const { data, error, loading, reload } = useAsync(
    () =>
      get(`/catalog/search${qs({ q, sort, radiusKm, page, limit: 12, ...(anywhere ? {} : { lat: location.lat, lng: location.lng }) })}`, { auth: false }),
    [q, sort, radiusKm, page, anywhere, location.lat, location.lng],
  );

  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  const withStock = data?.items.filter((i) => i.offers.length > 0).length ?? 0;
  const showcase = data?.items.find((i) => i.offers.length > 1) ?? data?.items.find((i) => i.offers.length > 0);

  return (
    <>
      <Hero
        location={location}
        draft={draft}
        setDraft={setDraft}
        onSearch={(term) => update({ q: term.trim() })}
        showcase={showcase}
      />

      <section className="container -mt-10 relative z-10">
        <div className="grid gap-3 rounded-3xl border bg-card/90 p-3 shadow-lift backdrop-blur sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + i * 0.07 }}
              className="flex gap-3 rounded-2xl p-3 transition-colors hover:bg-muted/50"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 text-white shadow-glow">
                <f.icon className="size-5" />
              </span>
              <div>
                <div className="text-sm font-bold">{f.title}</div>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{f.body}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="container py-14" id="products">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-primary">{q ? 'Search results' : 'Available near you'}</div>
            <h2 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">
              {q ? (
                <>
                  Results for <span className="font-display font-normal italic text-primary">“{q}”</span>
                </>
              ) : (
                'Fresh from local warehouses'
              )}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {data ? (
                <>
                  <strong className="text-foreground">{data.total}</strong> product{data.total === 1 ? '' : 's'} · {withStock} with sellers{' '}
                  {anywhere ? 'anywhere' : `within ${radiusKm} km of ${location.label ?? 'you'}`}
                </>
              ) : (
                'Searching…'
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={sort} onValueChange={(v) => update({ sort: v })}>
              <SelectTrigger className="w-40" aria-label="Sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORTS.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Segmented
              value={String(radiusKm)}
              onChange={(v) => update({ radiusKm: v })}
              options={RADII.map((r) => ({ id: String(r), label: `${r} km` }))}
              className={anywhere ? 'pointer-events-none opacity-50' : ''}
            />
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border bg-card px-3 py-2 text-xs font-semibold shadow-sm">
              <Switch checked={anywhere} onCheckedChange={(v) => update({ anywhere: v })} />
              Any location
            </label>
          </div>
        </div>

        <ErrorBox error={error} onRetry={reload} />
        {loading && !data && <ProductGridSkeleton />}
        {data && data.items.length === 0 && (
          <Card>
            <Empty icon={SearchX} title="No products match" action={q && <Button variant="secondary" onClick={() => (setDraft(''), update({ q: '' }))}>Clear search</Button>}>
              Try a different word, or clear the search to browse everything.
            </Empty>
          </Card>
        )}
        {data && data.items.length > 0 && (
          <div className="grid gap-5 transition-opacity sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" style={{ opacity: loading ? 0.6 : 1 }}>
            {data.items.map((item, i) => (
              <ProductCard key={item.variantId} item={item} index={i} />
            ))}
          </div>
        )}

        {data && pages > 1 && (
          <div className="mt-10 flex items-center justify-center gap-3">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => update({ page: page - 1 })}>
              <ChevronLeft /> Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page <strong className="text-foreground">{page}</strong> of {pages}
            </span>
            <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => update({ page: page + 1 })}>
              Next <ChevronRight />
            </Button>
          </div>
        )}
      </section>

      <SellerCta />
    </>
  );
}

function Hero({ location, draft, setDraft, onSearch, showcase }) {
  return (
    <section className="bg-aurora relative overflow-hidden text-white">
      <div className="bg-grid absolute inset-0" aria-hidden />
      <div className="container relative grid items-center gap-12 pb-24 pt-14 lg:grid-cols-[1.15fr_0.85fr] lg:pb-32 lg:pt-20">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}>
          <div className="glass inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold text-emerald-50">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-300 opacity-70" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-300" />
            </span>
            Delivering to {location.label ?? 'your location'}
          </div>
          <h1 className="mt-6 text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            Every local seller.
            <br />
            <span className="text-gradient font-display text-[1.12em] font-normal italic">One checkout.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base text-emerald-50/80 sm:text-lg">
            Compare every nearby seller's price, stock and delivery time, then check out across warehouses in a single order.
          </p>

          <form
            className="glass mt-8 flex max-w-xl items-center gap-2 rounded-2xl p-2 shadow-2xl shadow-black/20"
            onSubmit={(e) => {
              e.preventDefault();
              onSearch(draft);
              document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            <Search className="ml-2 size-5 shrink-0 text-emerald-100/70" />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Search products, e.g. whole wheat bread"
              aria-label="Search"
              className="h-11 min-w-0 flex-1 bg-transparent text-[15px] text-white placeholder:text-emerald-50/50 focus:outline-none"
            />
            <Button type="submit" variant="gold" size="lg" className="h-11 rounded-xl">
              Search
            </Button>
          </form>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs text-emerald-50/60">Popular:</span>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-emerald-50/90 transition hover:border-white/30 hover:bg-white/15"
                onClick={() => {
                  setDraft(s);
                  onSearch(s);
                  document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' });
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24, rotate: 1.5 }}
          animate={{ opacity: 1, y: 0, rotate: 0 }}
          transition={{ duration: 0.8, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
          className="hidden lg:block"
        >
          {showcase ? <LiveComparison item={showcase} /> : <Skeleton className="h-80 w-full rounded-3xl bg-white/10" />}
        </motion.div>
      </div>
    </section>
  );
}

/** Real offers for one product, framed as the "why LocalStock" moment in the hero. */
function LiveComparison({ item }) {
  const offers = item.offers.slice(0, 3);
  return (
    <div className="relative">
      <div className="absolute -inset-6 rounded-[2rem] bg-emerald-400/20 blur-3xl" aria-hidden />
      <div className="glass relative animate-float rounded-3xl p-5 shadow-2xl shadow-black/30">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-100/80">
            <Sparkles className="size-3.5 text-amber-200" /> Live comparison
          </span>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-50">
            {item.offers.length} seller{item.offers.length === 1 ? '' : 's'}
          </span>
        </div>
        <Link to={`/product/${item.variantId}`} className="mt-4 flex items-center gap-4 rounded-2xl bg-white/95 p-3 text-foreground shadow-lg transition hover:scale-[1.01] dark:bg-card">
          <ProductArt names={[item.group, item.name]} size="md" />
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{item.brand}</div>
            <div className="truncate font-bold">{item.name}</div>
            <Attrs attributes={item.attributes} className="mt-1" />
          </div>
        </Link>
        <div className="mt-3 space-y-2">
          {offers.map((o, i) => (
            <div key={o.offerId} className={`flex items-center justify-between rounded-xl px-3 py-2.5 ${i === 0 ? 'bg-amber-300/20 ring-1 ring-amber-200/40' : 'bg-white/5'}`}>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{o.sellerName}</div>
                <div className="text-[11px] text-emerald-50/70">
                  {o.estimatedDeliveryMinutes != null ? `~${o.estimatedDeliveryMinutes} min` : 'delivery estimate at checkout'} · {o.availableUnits} in stock
                </div>
              </div>
              <div className="flex items-center gap-2">
                {i === 0 && <span className="rounded-full bg-amber-300 px-2 py-0.5 text-[10px] font-extrabold text-amber-950">BEST</span>}
                <span className="num text-sm font-extrabold">{money(o.priceMinor)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProductCard({ item, index }) {
  const cart = useCart();
  const toast = useToast();
  const [qty, setQty] = useState(1);
  const shown = item.offers.slice(0, 2);
  const from = item.offers.length ? Math.min(...item.offers.map((o) => o.priceMinor)) : null;
  const stock = item.offers.reduce((n, o) => n + o.availableUnits, 0);
  const fastest = item.offers.reduce((m, o) => (o.estimatedDeliveryMinutes != null && (m == null || o.estimatedDeliveryMinutes < m) ? o.estimatedDeliveryMinutes : m), null);

  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.04, duration: 0.4 }}
      className="group flex flex-col overflow-hidden rounded-3xl border bg-card shadow-soft transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-lift"
    >
      <Link to={`/product/${item.variantId}`} className="relative block p-3 pb-0">
        <ProductArt names={[item.group, item.name]} size="tile" label={primaryAttr(item.attributes)} className="transition-transform duration-500 group-hover:scale-[1.03]" />
        {item.offers.length > 1 && (
          <span className="absolute right-5 top-5 rounded-full bg-card/90 px-2 py-0.5 text-[10px] font-bold shadow-sm backdrop-blur">
            {item.offers.length} sellers
          </span>
        )}
        {fastest != null && (
          <span className="absolute left-5 top-5 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground shadow-sm">
            <Truck className="size-3" /> ~{fastest} min
          </span>
        )}
      </Link>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          {item.brand && <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{item.brand}</div>}
          <Link to={`/product/${item.variantId}`} className="line-clamp-1 text-[15px] font-bold tracking-tight hover:text-primary">
            {item.name}
          </Link>
          <div className="text-xs text-muted-foreground">{item.group}</div>
        </div>
        <div className="space-y-1.5">
          {shown.length === 0 && (
            <div className="flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
              <MapPin className="size-3.5" /> No seller delivers here right now
            </div>
          )}
          {shown.map((o, i) => (
            <OfferLine key={o.offerId} offer={o} best={i === 0 && item.offers.length > 1} />
          ))}
        </div>
        <div className="mt-auto flex items-end justify-between gap-2 pt-1">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{from != null ? 'from' : ''}</div>
            <div className="num text-xl font-extrabold tracking-tight">{from != null ? money(from) : <span className="text-sm font-semibold text-muted-foreground">Unavailable</span>}</div>
          </div>
          <div className="flex items-center gap-1.5">
            <Stepper size="sm" value={qty} onChange={setQty} min={1} max={Math.max(1, Math.min(100, stock))} />
            <Button
              size="sm"
              disabled={!item.offers.length}
              onClick={() => {
                cart.add({ variantId: item.variantId, name: item.name, brand: item.brand, group: item.group, attributes: item.attributes, priceHintMinor: from }, qty);
                toast(`Added ${qty} × ${item.name}`);
                setQty(1);
              }}
            >
              <ShoppingCart /> Add
            </Button>
          </div>
        </div>
      </div>
    </motion.article>
  );
}

function ProductGridSkeleton() {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="space-y-3 rounded-3xl border bg-card p-3">
          <Skeleton className="aspect-[4/3] w-full rounded-2xl" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </div>
  );
}

function SellerCta() {
  return (
    <section className="container pb-6">
      <div className="bg-aurora relative overflow-hidden rounded-[2rem] px-8 py-12 text-white shadow-lift sm:px-12">
        <div className="bg-grid absolute inset-0" aria-hidden />
        <div className="relative flex flex-wrap items-center justify-between gap-8">
          <div className="max-w-xl">
            <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-emerald-200">
              <PackageCheck className="size-4" /> For sellers
            </div>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
              Turn every warehouse into a <span className="font-display font-normal italic text-amber-200">storefront.</span>
            </h2>
            <p className="mt-3 text-emerald-50/80">
              List against the shared catalog, keep stock in as many warehouses as you run, and let checkout route each order to the right one, with your own riders or ours.
            </p>
          </div>
          <Button asChild variant="gold" size="lg">
            <Link to="/seller">
              Open the seller hub <ArrowRight />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
