import { Apple, Carrot, Coffee, Cookie, Croissant, Droplets, Egg, MapPin, Milk, Package, Timer, Trophy, Wheat } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { attrs, distance, minutes, money } from '@/lib/format';
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
  const dims = { sm: 'size-12 rounded-xl', md: 'size-16 rounded-2xl', lg: 'aspect-square w-full rounded-3xl', tile: 'aspect-[4/3] w-full rounded-2xl' }[size];
  const icon = { sm: 'size-6', md: 'size-8', lg: 'size-24', tile: 'size-14' }[size];
  const pad = { sm: 'p-1', md: 'p-1.5', lg: 'p-8', tile: 'p-4' }[size];

  if (src && !failed) {
    return (
      <div className={cn('relative grid shrink-0 place-items-center overflow-hidden bg-white ring-1 ring-inset ring-black/5', dims, className)}>
        <img
          src={src}
          alt={names.filter(Boolean).at(-1) ?? ''}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className={cn('size-full object-contain mix-blend-multiply', pad)}
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
