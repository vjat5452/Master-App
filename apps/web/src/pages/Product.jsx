import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BadgeIndianRupee, ChevronRight, Layers, MapPin, ShieldCheck, Store, Timer, Trophy, Truck, Zap } from 'lucide-react';
import { CompareSection } from '@/components/compare';
import { PlatformLinks, PriceHistory } from '@/components/price-history';
import { BlurFade } from '@/components/fx';
import { AddButton, primaryAttr, ProductArt } from '@/components/product';
import { CopyId, Empty, ErrorBox, Spinner } from '@/components/kit';
import { get, qs } from '@/lib/api';
import { loadCategories, searchCatalog } from '@/lib/categories';
import { distance, minutes, money } from '@/lib/format';
import { useAsync, useDeliveryLocation } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Shelf, SORTS } from './Shop.jsx';

const RADII = [5, 10, 20, 30, 50];

const PROMISES = [
  { icon: Zap, title: 'Superfast delivery', body: 'From the nearest warehouse that has it in stock.' },
  { icon: BadgeIndianRupee, title: 'Every seller compared', body: 'Live prices from all nearby sellers, side by side.' },
  { icon: ShieldCheck, title: 'Stock held at checkout', body: 'Units are reserved the moment you place the order.' },
];

export default function Product() {
  const { variantId } = useParams();
  const { location } = useDeliveryLocation();
  const [sort, setSort] = useState('best_value');
  const [radiusKm, setRadiusKm] = useState(20);

  const variant = useAsync(async () => {
    const v = await get(`/catalog/variants/${variantId}`, { auth: false });
    const group = await get(`/catalog/groups/${v.groupId}`, { auth: false }).catch(() => null);
    return { ...v, group };
  }, [variantId]);
  const offers = useAsync(
    () => get(`/catalog/variants/${variantId}/offers${qs({ lat: location.lat, lng: location.lng, radiusKm, sort })}`, { auth: false }),
    [variantId, location.lat, location.lng, radiusKm, sort],
  );
  const categories = useAsync(loadCategories, []);
  const category = categories.data?.find((c) => c.id === variant.data?.group?.categoryId);
  const similar = useAsync(
    async () => {
      if (!category) return null;
      const r = await searchCatalog({ category: category.slug, limit: 16, location });
      return { ...category, total: r.total, items: r.items.filter((i) => i.variantId !== variantId) };
    },
    [category?.slug, variantId, location.lat, location.lng],
  );

  if (variant.loading && !variant.data) return <Spinner className="py-32" />;
  if (variant.error) return <ErrorBox error={variant.error} onRetry={variant.reload} />;
  const v = variant.data;
  const list = offers.data?.offers ?? [];
  const stock = list.reduce((n, o) => n + o.availableUnits, 0);
  const from = list.length ? Math.min(...list.map((o) => o.priceMinor)) : null;
  const top = list.length ? Math.max(...list.map((o) => o.priceMinor)) : null;
  const fastest = list.reduce((m, o) => (o.estimatedDeliveryMinutes != null && (m == null || o.estimatedDeliveryMinutes < m) ? o.estimatedDeliveryMinutes : m), null);
  const pack = primaryAttr(v.attributes);
  const item = { variantId: v.id, name: v.name, brand: v.brand, group: v.groupName, attributes: v.attributes, imageUrl: v.imageUrl, offers: list };
  const details = [
    ['Brand', v.brand],
    ...Object.entries(v.attributes ?? {}).map(([k, val]) => [k[0].toUpperCase() + k.slice(1), val]),
    ['Type', v.groupName],
    ['Barcode (GTIN)', v.barcode],
  ].filter(([, val]) => val);

  return (
    <div className="space-y-12">
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-8 lg:grid-cols-2 lg:gap-12">
        {/* Photo */}
        <BlurFade className="lg:sticky lg:top-28">
          <div className="relative rounded-3xl border bg-white p-4 shadow-soft sm:p-10">
            <ProductArt names={[v.groupName, v.name]} src={v.imageUrl} size="lg" className="ring-0 max-sm:aspect-[4/3]" />
            {list.length > 1 && (
              <span className="absolute left-4 top-4 rounded-md bg-info px-2 py-1 text-[11px] font-extrabold uppercase tracking-wide text-white shadow-sm">
                {list.length} sellers
              </span>
            )}
          </div>
        </BlurFade>

        {/* Buy box */}
        <BlurFade delay={0.05} className="min-w-0 space-y-6">
          <nav className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Link to="/" className="hover:text-primary">
              Home
            </Link>
            <ChevronRight className="size-3 shrink-0" />
            {category && (
              <>
                <Link to={`/c/${category.slug}`} className="shrink-0 hover:text-primary">
                  {category.name}
                </Link>
                <ChevronRight className="size-3 shrink-0" />
              </>
            )}
            <span className="truncate text-foreground">{v.name}</span>
          </nav>

          <div>
            <h1 className="text-2xl font-black leading-tight tracking-tight sm:text-3xl">{v.brand ? `${v.brand} ${v.name}` : v.name}</h1>
            <div className={cn('mt-3 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-extrabold uppercase tracking-wide', fastest != null ? 'bg-muted text-foreground/80' : 'bg-destructive/10 text-destructive')}>
              {fastest != null ? (
                <>
                  <Zap className="size-3.5 fill-gold text-gold" /> {fastest} mins
                </>
              ) : offers.data ? (
                'Not deliverable here'
              ) : (
                'Checking sellers…'
              )}
            </div>
            {v.brand && (
              <Link to={`/search?q=${encodeURIComponent(v.brand)}`} className="mt-3 flex w-fit items-center gap-1 text-sm font-bold text-primary hover:underline">
                View all by {v.brand} <ChevronRight className="size-4" />
              </Link>
            )}
          </div>

          <div className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border bg-card p-4 shadow-soft">
            <div>
              {pack && <div className="text-sm font-semibold text-muted-foreground">{pack}</div>}
              <div className="num text-2xl font-black">{from != null ? money(from) : '—'}</div>
              <div className="text-[11px] text-muted-foreground">
                {from != null && top !== from ? `Lowest of ${list.length} sellers · up to ${money(top)}` : 'Inclusive of all taxes'}
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <AddButton item={item} size="lg" />
              <PlatformLinks variantId={v.id} />
            </div>
          </div>

          <div className="rounded-2xl border bg-card shadow-soft">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
              <h2 className="flex items-center gap-1.5 font-extrabold">
                <MapPin className="size-4 text-primary" /> Sellers near {location.label ?? 'you'}
              </h2>
              <div className="flex rounded-lg border bg-muted/40 p-0.5">
                {SORTS.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSort(s.id)}
                    className={cn('rounded-md px-2 py-1 text-[11px] font-bold transition', sort === s.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="scrollbar-none flex items-center gap-1.5 overflow-x-auto border-b px-4 py-2.5">
              <span className="mr-1 shrink-0 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Within</span>
              {RADII.map((r) => (
                <button
                  key={r}
                  onClick={() => setRadiusKm(r)}
                  className={cn(
                    'shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-bold transition',
                    radiusKm === r ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground',
                  )}
                >
                  {r} km
                </button>
              ))}
            </div>
            <ErrorBox error={offers.error} onRetry={offers.reload} />
            {offers.loading && !offers.data && <Spinner />}
            {offers.data && list.length === 0 && (
              <Empty icon={Truck} title="No seller delivers here yet">
                Widen the radius or choose a different delivery location.
              </Empty>
            )}
            <ul className={cn('divide-y transition-opacity', offers.loading && 'opacity-60')}>
              {list.map((o, i) => {
                const best = i === 0 && list.length > 1;
                return (
                  <li key={o.offerId} className={cn('flex items-center gap-3 px-4 py-3', best && 'bg-gold/[0.07]')}>
                    <span className={cn('grid size-9 shrink-0 place-items-center rounded-xl text-sm font-extrabold', best ? 'bg-gold text-gold-foreground' : 'bg-muted text-muted-foreground')}>
                      {best ? <Trophy className="size-4" /> : o.sellerName[0]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold">{o.sellerName}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-0.5">
                          <Timer className="size-3" /> {minutes(o.estimatedDeliveryMinutes)}
                        </span>
                        <span className="inline-flex items-center gap-0.5">
                          <MapPin className="size-3" /> {distance(o.distanceMeters)}
                        </span>
                        <span className={cn(o.availableUnits <= 5 && 'font-bold text-amber-600 dark:text-gold')}>
                          {o.availableUnits <= 5 ? `Only ${o.availableUnits} left` : `${o.availableUnits} in stock`}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="num font-extrabold">{money(o.priceMinor)}</div>
                      {best && <div className="text-[10px] font-bold text-amber-600 dark:text-gold">{SORTS.find((s) => s.id === sort)?.label}</div>}
                    </div>
                  </li>
                );
              })}
            </ul>
            {list.length > 0 && (
              <p className="flex gap-2 border-t px-4 py-3 text-[11px] text-muted-foreground">
                <Layers className="size-3.5 shrink-0 text-primary" />
                You don't pick a seller: checkout plans the best warehouses and couriers for your whole cart ({stock} units nearby).
              </p>
            )}
          </div>

          <CompareSection variant={v} location={location} query={[v.brand, v.name, pack].filter(Boolean).join(' ')} />

          <PriceHistory variantId={v.id} location={location} />

          <div className="grid gap-3 sm:grid-cols-3">
            {PROMISES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex gap-3 rounded-2xl border bg-card p-3 sm:flex-col sm:gap-2">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-primary">
                  <Icon className="size-4" />
                </span>
                <div>
                  <div className="text-sm font-extrabold">{title}</div>
                  <div className="text-[11px] text-muted-foreground">{body}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border bg-card p-4 shadow-soft">
            <h2 className="font-extrabold">Product details</h2>
            {v.group?.description && <p className="mt-2 text-sm text-muted-foreground">{v.group.description}</p>}
            <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
              {details.map(([k, val]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-semibold">{val}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-3 flex items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
              <Store className="size-3.5" /> Variant <CopyId id={v.id} />
            </div>
          </div>
        </BlurFade>
      </div>

      {similar.data?.items.length > 0 && <Shelf shelf={{ ...similar.data, name: 'Similar products' }} />}
    </div>
  );
}
