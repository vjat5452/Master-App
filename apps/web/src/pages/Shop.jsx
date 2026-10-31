import { useRef } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, ChevronLeft, ChevronRight, Layers, PackageCheck, ShieldCheck, Sparkles, Store, Timer, Truck, Zap } from 'lucide-react';
import { BlurFade, BorderBeam, Marquee, NumberTicker, ShimmerButton, ShinyText, SpotlightCard } from '@/components/fx';
import { QuickCard, QuickCardSkeleton } from '@/components/product';
import { ErrorBox } from '@/components/kit';
import { loadCategories, searchCatalog, styleFor } from '@/lib/categories';
import { useAsync, useDeliveryLocation } from '@/lib/store';
import { cn } from '@/lib/utils';

export const SORTS = [
  { id: 'best_value', label: 'Best value' },
  { id: 'lowest_price', label: 'Lowest price' },
  { id: 'fastest', label: 'Fastest' },
  { id: 'nearest', label: 'Nearest' },
];

const FEATURES = [
  { icon: Store, title: 'Every seller, side by side', body: 'Each product lists every nearby seller with price, stock and ETA.' },
  { icon: Layers, title: 'One cart, many warehouses', body: 'The allocation engine plans the cheapest or fastest way to fulfil it.' },
  { icon: ShieldCheck, title: 'Stock held at checkout', body: 'Orders reserve units atomically, so what you pay for is really there.' },
  { icon: Truck, title: 'Hybrid delivery', body: 'Platform fleet, couriers or the seller’s own riders: whichever is fastest.' },
];

const PROMOS = [
  { slug: 'dairy', title: 'Fresh dairy, every morning', body: 'Milk, curd, paneer and ice cream from sellers near you', bg: 'from-sky-500 to-indigo-600' },
  { slug: 'snacks', title: 'Snack attack sorted', body: 'Chips, namkeen and popcorn at the lowest local price', bg: 'from-orange-500 to-rose-600' },
  { slug: 'staples', title: 'Stock up the kitchen', body: 'Atta, rice, dals and oils compared across warehouses', bg: 'from-emerald-500 to-teal-700' },
];

// Hero collage uses the first hit of each search.
const HERO_QUERIES = ['dairy milk silk', 'maggi masala noodles', 'lays classic salted', 'kool kesar', 'oreo'];

function useShelves(location) {
  return useAsync(async () => {
    const categories = await loadCategories();
    const [all, hero, ...shelves] = await Promise.all([
      searchCatalog({ limit: 1, location }),
      Promise.all(HERO_QUERIES.map((q) => searchCatalog({ q, limit: 1, location }).then((r) => r.items[0]))),
      ...categories.map((c) => searchCatalog({ category: c.slug, limit: 14, location })),
    ]);
    return {
      total: all.total,
      hero: hero.filter((i) => i?.imageUrl),
      shelves: categories.map((c, i) => ({ ...c, items: shelves[i].items, total: shelves[i].total })).filter((s) => s.total > 0),
    };
  }, [location.lat, location.lng]);
}

export default function Shop() {
  const [params] = useSearchParams();
  const { location } = useDeliveryLocation();
  const { data, error, reload } = useShelves(location);

  // Old links used /?q=; search now lives on its own page.
  if (params.get('q')) return <Navigate to={`/search?${params}`} replace />;

  const items = data?.shelves.flatMap((s) => s.items) ?? [];
  const sellers = new Set(items.flatMap((i) => i.offers.map((o) => o.sellerName))).size;
  const etas = items.flatMap((i) => i.offers.map((o) => o.estimatedDeliveryMinutes)).filter((m) => m != null);
  const brands = [...new Set(items.map((i) => i.brand).filter(Boolean))];

  return (
    <div className="pb-10">
      <section className="container pt-5">
        <Hero total={data?.total} sellers={sellers} fastest={etas.length ? Math.min(...etas) : null} picks={data?.hero ?? []} location={location} />
      </section>

      <section className="container mt-4 grid gap-3 md:grid-cols-3">
        {PROMOS.map((p, i) => (
          <PromoCard key={p.slug} promo={p} index={i} shelf={data?.shelves.find((s) => s.slug === p.slug)} />
        ))}
      </section>

      <section className="container mt-10" id="categories">
        <SectionTitle eyebrow="Explore" title="Shop by category" />
        <ErrorBox error={error} onRetry={reload} />
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-11">
          {data
            ? data.shelves.map((s, i) => <CategoryTile key={s.id} shelf={s} index={i} />)
            : Array.from({ length: 11 }, (_, i) => <div key={i} className="aspect-[4/5] animate-pulse rounded-2xl bg-muted" />)}
        </div>
      </section>

      {brands.length > 0 && (
        <section className="mt-10 border-y bg-card py-4">
          <Marquee duration={50} repeat={3}>
            {brands.map((b) => (
              <Link
                key={b}
                to={`/search?q=${encodeURIComponent(b)}`}
                className="whitespace-nowrap rounded-full border bg-background px-4 py-1.5 text-sm font-bold text-foreground/70 transition hover:border-primary/40 hover:text-primary"
              >
                {b}
              </Link>
            ))}
          </Marquee>
        </section>
      )}

      <div className="container mt-10 space-y-10">
        {data
          ? data.shelves.map((s) => <Shelf key={s.id} shelf={s} />)
          : Array.from({ length: 3 }, (_, i) => (
              <div key={i}>
                <div className="mb-4 h-7 w-56 animate-pulse rounded bg-muted" />
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                  {Array.from({ length: 6 }, (_, j) => (
                    <QuickCardSkeleton key={j} />
                  ))}
                </div>
              </div>
            ))}
      </div>

      <section className="container mt-14">
        <div className="grid gap-3 rounded-3xl border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => (
            <BlurFade key={f.title} delay={i * 0.06} className="flex gap-3 rounded-2xl p-3 transition-colors hover:bg-muted/60">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-primary">
                <f.icon className="size-5" />
              </span>
              <div>
                <div className="text-sm font-extrabold">{f.title}</div>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{f.body}</p>
              </div>
            </BlurFade>
          ))}
        </div>
      </section>

      <SellerCta />
    </div>
  );
}

function SectionTitle({ eyebrow, title, action }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        {eyebrow && <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-primary">{eyebrow}</div>}
        <h2 className="text-xl font-black tracking-tight sm:text-2xl">{title}</h2>
      </div>
      {action}
    </div>
  );
}

function Hero({ total, sellers, fastest, picks: floats, location }) {
  return (
    <div className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-emerald-600 via-green-700 to-emerald-900 text-white shadow-lift">
      <div className="bg-grid absolute inset-0 opacity-60" aria-hidden />
      <div className="absolute -right-24 -top-24 size-80 rounded-full bg-yellow-300/30 blur-3xl" aria-hidden />
      <div className="absolute -bottom-32 left-1/3 size-96 rounded-full bg-emerald-300/20 blur-3xl" aria-hidden />
      <BorderBeam size={260} duration={10} from="#fde047" to="#86efac" />

      <div className="relative grid items-center gap-8 px-6 py-9 sm:px-10 lg:grid-cols-[1.1fr_0.9fr] lg:py-12">
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}>
          <div className="inline-flex items-center gap-2 rounded-full bg-black/20 px-3 py-1 text-xs font-bold ring-1 ring-white/15 backdrop-blur">
            <Sparkles className="size-3.5 text-yellow-300" />
            <ShinyText className="text-yellow-100">Every local seller · one checkout</ShinyText>
          </div>
          <h1 className="mt-4 text-[34px] font-black leading-[1.02] tracking-tight sm:text-5xl lg:text-[56px]">
            Groceries in <span className="text-yellow-300">minutes</span>,
            <br />
            at the best local price.
          </h1>
          <p className="mt-4 max-w-lg text-[15px] text-emerald-50/85 sm:text-base">
            We compare every nearby store's price, stock and rider ETA for {location.label ?? 'you'}, then deliver your whole cart in one order.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <ShimmerButton background="#facc15" className="text-[15px] !text-yellow-950" onClick={() => document.getElementById('categories')?.scrollIntoView({ behavior: 'smooth' })}>
              Start shopping <ArrowRight className="size-4" />
            </ShimmerButton>
            <Link to="/seller" className="rounded-full px-4 py-3 text-sm font-bold text-white/90 ring-1 ring-white/25 transition hover:bg-white/10">
              Sell on LocalStock
            </Link>
          </div>
          <div className="mt-7 flex flex-wrap gap-2.5">
            <HeroStat icon={PackageCheck} label="products">
              {total != null ? <NumberTicker value={total} /> : '…'}
            </HeroStat>
            <HeroStat icon={Store} label="sellers nearby">
              <NumberTicker value={sellers} />
            </HeroStat>
            <HeroStat icon={Timer} label="fastest ETA">
              {fastest != null ? (
                <>
                  <NumberTicker value={fastest} /> min
                </>
              ) : (
                '—'
              )}
            </HeroStat>
          </div>
        </motion.div>

        <div className="relative hidden h-[320px] lg:block" aria-hidden>
          {floats.map((p, i) => (
            <motion.div
              key={`${p.variantId}-${i}`}
              initial={{ opacity: 0, scale: 0.7, rotate: 0 }}
              animate={{ opacity: 1, scale: 1, rotate: [-8, 6, -4, 8, -6][i] }}
              transition={{ delay: 0.15 + i * 0.08, type: 'spring', damping: 14 }}
              className="absolute rounded-3xl bg-white shadow-2xl shadow-black/25"
              style={
                [
                  { left: '6%', top: '2%', width: 168, height: 168 },
                  { right: '4%', top: 0, width: 150, height: 150 },
                  { left: '33%', top: '28%', width: 190, height: 190, zIndex: 10 },
                  { left: '2%', bottom: 0, width: 132, height: 132 },
                  { right: '8%', bottom: 0, width: 150, height: 150 },
                ][i]
              }
            >
              <div className="absolute inset-3 animate-float" style={{ animationDelay: `${i * 0.7}s` }}>
                <img src={p.imageUrl} alt="" className="absolute inset-0 size-full object-contain mix-blend-multiply" />
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HeroStat({ icon: Icon, label, children }) {
  return (
    <div className="flex items-center gap-2.5 rounded-2xl bg-white/10 px-3.5 py-2 ring-1 ring-white/15 backdrop-blur">
      <Icon className="size-4 text-yellow-300" />
      <div className="leading-tight">
        <div className="text-lg font-black">{children}</div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-50/70">{label}</div>
      </div>
    </div>
  );
}

function PromoCard({ promo, shelf, index }) {
  const pics = (shelf?.items ?? []).filter((i) => i.imageUrl).slice(0, 3);
  return (
    <BlurFade delay={index * 0.08}>
      <Link to={`/c/${promo.slug}`} className="block">
        <SpotlightCard className={cn('group h-full rounded-3xl bg-gradient-to-br p-5 text-white shadow-soft transition hover:shadow-lift', promo.bg)}>
          <div className="relative flex min-h-[132px] items-center justify-between gap-3">
            <div className="max-w-[60%]">
              <h3 className="text-lg font-black leading-tight">{promo.title}</h3>
              <p className="mt-1.5 text-xs text-white/85">{promo.body}</p>
              <span className="mt-4 inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-extrabold text-black/80 transition group-hover:gap-2">
                Order now <ChevronRight className="size-3.5" />
              </span>
            </div>
            <div className="relative h-28 w-28 shrink-0">
              {pics.map((p, i) => (
                <img
                  key={p.variantId}
                  src={p.imageUrl}
                  alt=""
                  className={cn(
                    'absolute size-16 rounded-2xl bg-white object-contain p-1.5 shadow-lg transition-transform duration-500',
                    ['right-0 top-0 rotate-6 group-hover:rotate-12', 'bottom-0 left-0 -rotate-6 group-hover:-rotate-12', 'bottom-2 right-3 z-10 group-hover:scale-110'][i],
                  )}
                />
              ))}
            </div>
          </div>
        </SpotlightCard>
      </Link>
    </BlurFade>
  );
}

function CategoryTile({ shelf, index }) {
  const { tint, short } = styleFor(shelf.slug);
  const pics = shelf.items.filter((i) => i.imageUrl).slice(0, 4);
  return (
    <BlurFade delay={Math.min(index, 10) * 0.03}>
      <Link to={`/c/${shelf.slug}`} className="group block text-center">
        <div className={cn('grid aspect-square grid-cols-2 gap-1 rounded-2xl bg-gradient-to-b p-2.5 transition duration-300 group-hover:-translate-y-1 group-hover:shadow-lift', tint)}>
          {pics.map((p) => (
            <div key={p.variantId} className="grid place-items-center overflow-hidden rounded-lg bg-white/80 p-1 dark:bg-white/90">
              <img src={p.imageUrl} alt="" loading="lazy" className="size-full object-contain mix-blend-multiply" />
            </div>
          ))}
        </div>
        <div className="mt-2 line-clamp-2 text-xs font-bold leading-tight text-foreground/85 group-hover:text-primary">{short ?? shelf.name}</div>
      </Link>
    </BlurFade>
  );
}

export function Shelf({ shelf }) {
  const scroller = useRef(null);
  const nudge = (dir) => scroller.current?.scrollBy({ left: dir * scroller.current.clientWidth * 0.8, behavior: 'smooth' });
  return (
    <BlurFade as="section">
      <SectionTitle
        title={shelf.name}
        action={
          <div className="flex items-center gap-1.5">
            <Link to={`/c/${shelf.slug}`} className="mr-1 text-sm font-extrabold text-primary hover:underline">
              See all {shelf.total}
            </Link>
            <ArrowButton onClick={() => nudge(-1)} label="Scroll left" icon={ChevronLeft} />
            <ArrowButton onClick={() => nudge(1)} label="Scroll right" icon={ChevronRight} />
          </div>
        }
      />
      <div ref={scroller} className="scrollbar-none -mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
        {shelf.items.map((item) => (
          <QuickCard key={item.variantId} item={item} className="w-[158px] shrink-0 snap-start sm:w-[176px]" />
        ))}
        <Link
          to={`/c/${shelf.slug}`}
          className="grid w-[150px] shrink-0 snap-start place-items-center rounded-2xl border border-dashed bg-card text-center text-sm font-extrabold text-primary transition hover:border-primary/50 hover:bg-accent"
        >
          <span>
            See all
            <br />
            <span className="text-xs font-semibold text-muted-foreground">{shelf.total} products</span>
          </span>
        </Link>
      </div>
    </BlurFade>
  );
}

function ArrowButton({ onClick, label, icon: Icon }) {
  return (
    <button onClick={onClick} aria-label={label} className="hidden size-8 place-items-center rounded-full border bg-card shadow-sm transition hover:border-primary/40 hover:text-primary sm:grid">
      <Icon className="size-4" />
    </button>
  );
}

function SellerCta() {
  return (
    <section className="container mt-12">
      <div className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-zinc-900 via-emerald-950 to-zinc-900 px-8 py-10 text-white shadow-lift sm:px-12">
        <div className="bg-grid absolute inset-0" aria-hidden />
        <BorderBeam size={200} duration={12} />
        <div className="relative flex flex-wrap items-center justify-between gap-8">
          <div className="max-w-xl">
            <div className="inline-flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.18em] text-yellow-300">
              <Zap className="size-4 fill-yellow-300" /> For sellers
            </div>
            <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Turn every warehouse into a dark store.</h2>
            <p className="mt-3 text-emerald-50/75">
              List against the shared catalog, keep stock in as many warehouses as you run, and let checkout route each order to the right one, with your own riders or ours.
            </p>
          </div>
          <ShimmerButton as={Link} to="/seller" background="hsl(146 78% 32%)" className="text-[15px]">
            Open the seller hub <ArrowRight className="size-4" />
          </ShimmerButton>
        </div>
      </div>
    </section>
  );
}
