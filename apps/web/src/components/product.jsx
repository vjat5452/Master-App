import { Apple, Carrot, Coffee, Cookie, Croissant, Droplets, Egg, MapPin, Milk, Minus, Package, Plus, Timer, Trophy, Wheat, Zap } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { attrs, distance, minutes, money, price } from '@/lib/format';
import { useCart } from '@/lib/store';
import { cn } from '@/lib/utils';

// Category artwork: a gradient tile with an icon, so every product has a consistent, polished visual.
const ART = [
  [/bread|bakery|bun|cake|croissant/i, Croissant, 'from-amber-200 via-orange-200 to-rose-200 text-amber-800 dark:from-amber-500/30 dark:via-orange-500/20 dark:to-rose-500/20 dark:text-amber-200'],
  [/milk|dairy|curd|paneer|cheese/i, Milk, 'from-sky-100 via-blue-100 to-indigo-200 text-sky-800 dark:from-sky-500/25 dark:via-blue-500/20 dark:to-indigo-500/25 dark:text-sky-200'],
  [/egg/i, Egg, 'from-yellow-100 via-amber-100 to-orange-100 text-amber-700 dark:from-yellow-500/25 dark:to-orange-500/20 dark:text-yellow-200'],
  [/rice|grain|atta|flour|dal|wheat|multigrain/i, Wheat, 'from-lime-100 via-yellow-100 to-amber-100 text-lime-800 dark:from-lime-500/25 dark:to-amber-500/20 dark:text-lime-200'],
  [/fruit|apple|banana/i, Apple, 'from-rose-100 via-red-100 to-pink-200 text-rose-700 dark:from-rose-500/25 dark:to-pink-500/20 dark:text-rose-200'],
  [/veg|onion|potato|tomato|carrot/i, Carrot, 'from-orange-100 via-amber-100 to-lime-100 text-orange-700 dark:from-orange-500/25 dark:to-lime-500/20 dark:text-orange-200'],
  [/tea|coffee/i, Coffee, 'from-stone-200 via-amber-100 to-orange-100 text-stone-700 dark:from-stone-500/30 dark:to-orange-500/15 dark:text-stone-200'],
  [/oil|ghee/i, Droplets, 'from-yellow-100 via-lime-100 to-emerald-100 text-yellow-800 dark:from-yellow-500/25 dark:to-emerald-500/20 dark:text-yellow-200'],
  [/snack|chips|biscuit|cookie/i, Cookie, 'from-orange-100 via-amber-200 to-yellow-100 text-orange-800 dark:from-orange-500/25 dark:to-yellow-500/20 dark:text-orange-200'],
];
const FALLBACK = [null, Package, 'from-emerald-100 via-teal-100 to-cyan-100 text-emerald-800 dark:from-emerald-500/25 dark:to-cyan-500/20 dark:text-emerald-200'];

export const artFor = (...names) => ART.find(([re]) => names.some((n) => re.test(n ?? ''))) ?? FALLBACK;

/** Product photo when one exists; otherwise (or if it fails to load) category gradient art. */
export function ProductArt({ names, src, size = 'md', label, className }) {
  const [failed, setFailed] = useState(false);
  const [, Icon, gradient] = artFor(...names);
  const dims = {
    sm: 'size-12 rounded-xl',
    md: 'size-16 rounded-2xl',
    lg: 'aspect-square w-full rounded-3xl',
    tile: 'aspect-[4/3] w-full rounded-2xl',
    square: 'aspect-square w-full rounded-xl',
  }[size];
  const icon = { sm: 'size-6', md: 'size-8', lg: 'size-24', tile: 'size-14', square: 'size-12' }[size];
  const pad = { sm: 'p-1', md: 'p-1.5', lg: 'p-8', tile: 'p-4', square: 'p-3' }[size];

  if (src && !failed) {
    return (
      <div className={cn('relative grid shrink-0 place-items-center overflow-hidden bg-white ring-1 ring-inset ring-black/5', dims, className)}>
        <img
          src={src}
          alt={names.filter(Boolean).at(-1) ?? ''}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          // Absolutely positioned so tall images scale to fit instead of stretching the grid row.
          className={cn('absolute inset-0 size-full object-contain mix-blend-multiply', pad)}
        />
        {label && (
          <span className="absolute bottom-2 left-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm backdrop-blur">
            {label}
          </span>
        )}
      </div>
    );
  }
  return (
    <div className={cn('relative grid shrink-0 place-items-center overflow-hidden bg-gradient-to-br', gradient, dims, className)}>
      <div className="absolute -right-6 -top-6 size-24 rounded-full bg-white/40 blur-2xl dark:bg-white/10" />
      <Icon className={cn('relative drop-shadow-sm', icon)} strokeWidth={1.6} />
      {label && (
        <span className="absolute bottom-2 left-2 rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-bold text-foreground/80 shadow-sm backdrop-blur dark:bg-black/40 dark:text-white/90">
          {label}
        </span>
      )}
    </div>
  );
}

export const primaryAttr = (attributes) => Object.values(attributes ?? {})[0];

export function Attrs({ attributes, className }) {
  const list = attrs(attributes);
  if (!list.length) return null;
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {list.map((a) => (
        <span key={a} className="rounded-full border bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {a}
        </span>
      ))}
    </div>
  );
}

export function OfferLine({ offer, best }) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 transition-colors',
        best ? 'border-gold/40 bg-gold/[0.07]' : 'border-transparent bg-muted/40',
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 truncate text-sm font-semibold">
          {best && <Trophy className="size-3.5 shrink-0 text-amber-500" />}
          <span className="truncate">{offer.sellerName}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          {offer.distanceMeters != null && (
            <span className="inline-flex items-center gap-0.5">
              <MapPin className="size-3" />
              {distance(offer.distanceMeters)}
            </span>
          )}
          <span className="inline-flex items-center gap-0.5">
            <Timer className="size-3" />~{minutes(offer.estimatedDeliveryMinutes)}
          </span>
          <span>· {offer.availableUnits} left</span>
        </div>
      </div>
      <div className="num shrink-0 text-sm font-extrabold">{money(offer.priceMinor)}</div>
    </div>
  );
}

/** Cheapest price, total stock and fastest ETA across a search item's offers. */
export function summarize(item) {
  const from = item.offers.length ? Math.min(...item.offers.map((o) => o.priceMinor)) : null;
  const stock = item.offers.reduce((n, o) => n + o.availableUnits, 0);
  const eta = item.offers.reduce((m, o) => (o.estimatedDeliveryMinutes != null && (m == null || o.estimatedDeliveryMinutes < m) ? o.estimatedDeliveryMinutes : m), null);
  return { from, stock, eta };
}

/** Quick-commerce ADD control: an outlined button that becomes a −/+ stepper bound to the cart. */
export function AddButton({ item, className, size = 'sm' }) {
  const cart = useCart();
  const { from, stock } = summarize(item);
  const qty = cart.items.find((i) => i.variantId === item.variantId)?.quantity ?? 0;
  const max = Math.max(1, Math.min(100, stock));
  const big = size === 'lg';
  const add = () =>
    cart.add({ variantId: item.variantId, name: item.name, brand: item.brand, group: item.group, attributes: item.attributes, imageUrl: item.imageUrl, priceHintMinor: from }, 1);

  return (
    <div className={cn('relative', big ? 'h-11 w-36' : 'h-9 w-[76px]', className)}>
      <AnimatePresence initial={false} mode="popLayout">
        {qty === 0 ? (
          <motion.button
            key="add"
            type="button"
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.85, opacity: 0 }}
            whileTap={{ scale: 0.92 }}
            disabled={!item.offers.length}
            onClick={add}
            className={cn(
              'absolute inset-0 rounded-lg border-[1.5px] border-primary bg-primary/[0.06] font-extrabold uppercase tracking-wide text-primary shadow-sm transition-colors hover:bg-primary/10',
              'disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground',
              big ? 'text-sm' : 'text-[13px]',
            )}
          >
            Add
          </motion.button>
        ) : (
          <motion.div
            key="stepper"
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.85, opacity: 0 }}
            className="absolute inset-0 flex items-center justify-between rounded-lg bg-primary text-primary-foreground shadow-glow"
          >
            <button type="button" aria-label="Remove one" onClick={() => cart.setQuantity(item.variantId, qty - 1)} className="grid h-full w-8 place-items-center rounded-l-lg transition hover:bg-black/10">
              <Minus className="size-3.5" strokeWidth={3} />
            </button>
            <motion.span key={qty} initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className={cn('num font-extrabold', big ? 'text-base' : 'text-sm')}>
              {qty}
            </motion.span>
            <button
              type="button"
              aria-label="Add one"
              disabled={qty >= max}
              onClick={() => cart.setQuantity(item.variantId, qty + 1)}
              className="grid h-full w-8 place-items-center rounded-r-lg transition hover:bg-black/10 disabled:opacity-40"
            >
              <Plus className="size-3.5" strokeWidth={3} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Compact shelf card: photo, ETA chip, name, pack size, price and ADD. */
export function QuickCard({ item, className }) {
  const { from, eta } = summarize(item);
  const pack = primaryAttr(item.attributes);
  return (
    <article className={cn('group relative flex flex-col rounded-2xl border bg-card p-2.5 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-lift', className)}>
      <Link to={`/product/${item.variantId}`} className="relative block">
        <ProductArt names={[item.group, item.name]} src={item.imageUrl} size="square" className="transition-transform duration-500 group-hover:scale-[1.04]" />
        {item.offers.length > 1 && (
          <span className="absolute left-1.5 top-1.5 rounded-md bg-info px-1.5 py-0.5 text-[9.5px] font-extrabold uppercase tracking-wide text-white shadow-sm">
            {item.offers.length} sellers
          </span>
        )}
      </Link>
      <div className={cn('mt-2 inline-flex w-fit items-center gap-1 rounded-md px-1.5 py-0.5 text-[9.5px] font-extrabold uppercase tracking-wide', eta != null ? 'bg-muted text-foreground/80' : 'bg-destructive/10 text-destructive')}>
        {eta != null ? (
          <>
            <Zap className="size-3 fill-gold text-gold" /> {eta} mins
          </>
        ) : (
          'Not deliverable here'
        )}
      </div>
      <Link to={`/product/${item.variantId}`} className="mt-1.5 line-clamp-2 min-h-[2.4rem] text-[13px] font-bold leading-tight tracking-tight hover:text-primary">
        {item.brand ? `${item.brand} ${item.name}` : item.name}
      </Link>
      <div className="mt-0.5 truncate text-xs text-muted-foreground">{pack ?? item.group}</div>
      <div className="mt-auto flex items-end justify-between gap-2 pt-3">
        <div className="min-w-0">
          <div className="num text-[15px] font-extrabold leading-none">{from != null ? price(from) : '—'}</div>
          {item.offers.length > 1 && <div className="mt-1 text-[10px] font-semibold text-muted-foreground">lowest of {item.offers.length}</div>}
        </div>
        <AddButton item={item} />
      </div>
    </article>
  );
}

export function QuickCardSkeleton() {
  return (
    <div className="space-y-2 rounded-2xl border bg-card p-2.5">
      <div className="aspect-square w-full animate-pulse rounded-xl bg-muted" />
      <div className="h-3 w-14 animate-pulse rounded bg-muted" />
      <div className="h-4 w-full animate-pulse rounded bg-muted" />
      <div className="h-3 w-10 animate-pulse rounded bg-muted" />
      <div className="flex justify-between pt-2">
        <div className="h-5 w-10 animate-pulse rounded bg-muted" />
        <div className="h-9 w-[76px] animate-pulse rounded-lg bg-muted" />
      </div>
    </div>
  );
}

export function ProductTitle({ variantId, brand, name, group }) {
  return (
    <div className="min-w-0 flex-1">
      {brand && <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{brand}</div>}
      <Link to={`/product/${variantId}`} className="line-clamp-2 font-bold leading-snug tracking-tight hover:text-primary">
        {name}
      </Link>
      {group && <div className="text-xs text-muted-foreground">{group}</div>}
    </div>
  );
}
