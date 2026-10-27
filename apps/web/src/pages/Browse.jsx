import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Loader2, SearchX } from 'lucide-react';
import { BlurFade } from '@/components/fx';
import { Button, Empty, ErrorBox } from '@/components/kit';
import { QuickCard, QuickCardSkeleton } from '@/components/product';
import { Switch } from '@/components/ui/misc';
import { loadCategories, searchCatalog, styleFor } from '@/lib/categories';
import { useAsync, useDeliveryLocation } from '@/lib/store';
import { cn } from '@/lib/utils';
import { SORTS } from './Shop.jsx';

const PAGE = 30;

/** Category listing (/c/:slug) and search results (/search?q=), with "load more" paging. */
export default function Browse() {
  const { slug } = useParams();
  const [params, setParams] = useSearchParams();
  const { location } = useDeliveryLocation();
  const q = params.get('q') ?? '';
  const category = slug ?? params.get('category') ?? '';
  const sort = params.get('sort') ?? 'best_value';
  const anywhere = params.get('anywhere') === '1';

  const { data: categories } = useAsync(loadCategories, []);
  const current = categories?.find((c) => c.slug === category);

  const set = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v ? next.set(k, v === true ? '1' : v) : next.delete(k);
    setParams(next, { replace: true });
  };

  const key = JSON.stringify([q, category, sort, anywhere, location.lat, location.lng]);
  const [state, setState] = useState({ key: null, items: [], total: 0, page: 0, loading: true, error: null });
  const seq = useRef(0);

  const load = async (page, reset) => {
    const mine = ++seq.current;
    setState((s) => ({ ...(reset ? { items: [], total: 0, page: 0 } : s), key, loading: true, error: null }));
    try {
      const r = await searchCatalog({ q, category, sort, page, limit: PAGE, location, anywhere });
      if (mine !== seq.current) return;
      setState((s) => ({ key, items: reset ? r.items : [...s.items, ...r.items], total: r.total, page, loading: false, error: null }));
    } catch (error) {
      if (mine === seq.current) setState((s) => ({ ...s, loading: false, error }));
    }
  };

  useEffect(() => {
    load(1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const deliverable = state.items.filter((i) => i.offers.length).length;
  const heading = q ? (
    <>
      Results for <span className="text-primary">“{q}”</span>
      {current && <span className="text-muted-foreground"> in {current.name}</span>}
    </>
  ) : (
    current?.name ?? 'All products'
  );

  return (
    <div className="container grid grid-cols-[minmax(0,1fr)] gap-6 py-6 lg:grid-cols-[230px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-[92px] lg:h-[calc(100vh-110px)]">
        <nav className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:mx-0 lg:h-full lg:flex-col lg:gap-0.5 lg:overflow-y-auto lg:rounded-2xl lg:border lg:bg-card lg:p-2">
          <SideLink to={q ? `/search?q=${encodeURIComponent(q)}` : '/search'} active={!category} label={q ? 'All results' : 'All products'} />
          {categories?.map((c) => (
            <SideLink
              key={c.id}
              to={q ? `/search?q=${encodeURIComponent(q)}&category=${c.slug}` : `/c/${c.slug}`}
              active={c.slug === category}
              label={c.name}
              tint={styleFor(c.slug).tint}
            />
          ))}
        </nav>
      </aside>

      <section className="min-w-0">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{heading}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {state.key === key && !state.loading ? (
                <>
                  <strong className="text-foreground">{state.total}</strong> product{state.total === 1 ? '' : 's'}
                  {!anywhere && ` · ${deliverable} of ${state.items.length} shown deliver to ${location.label ?? 'you'}`}
                </>
              ) : (
                'Loading…'
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-xl border bg-card p-1 shadow-sm">
              {SORTS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => set({ sort: s.id === 'best_value' ? '' : s.id })}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-xs font-bold transition',
                    sort === s.id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border bg-card px-3 py-2 text-xs font-bold shadow-sm">
              <Switch checked={anywhere} onCheckedChange={(v) => set({ anywhere: v })} />
              Any location
            </label>
          </div>
        </div>

        <ErrorBox error={state.error} onRetry={() => load(Math.max(1, state.page), state.page <= 1)} />

        {state.key === key && !state.loading && state.items.length === 0 && !state.error && (
          <div className="rounded-3xl border bg-card">
            <Empty
              icon={SearchX}
              title={q ? `Nothing matches “${q}”` : 'No products here yet'}
              action={
                <Button asChild variant="secondary">
                  <Link to="/">Back to the store</Link>
                </Button>
              }
            >
              Search matches every word you type, so try fewer or simpler words.
            </Empty>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {state.items.map((item, i) => (
            <BlurFade key={item.variantId} delay={(i % PAGE) * 0.015} y={8}>
              <QuickCard item={item} className="h-full" />
            </BlurFade>
          ))}
          {state.loading && state.items.length === 0 && Array.from({ length: 10 }, (_, i) => <QuickCardSkeleton key={i} />)}
        </div>

        {state.items.length > 0 && state.items.length < state.total && (
          <div className="mt-8 flex justify-center">
            <Button variant="secondary" size="lg" onClick={() => load(state.page + 1)} disabled={state.loading} className="min-w-48 rounded-xl">
              {state.loading ? <Loader2 className="animate-spin" /> : null}
              Show more ({state.total - state.items.length} left)
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

function SideLink({ to, active, label, tint }) {
  return (
    <Link
      to={to}
      className={cn(
        'relative flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-xl border px-3 py-2 text-sm font-semibold transition lg:border-transparent',
        active ? 'border-primary/40 bg-accent font-extrabold text-accent-foreground' : 'bg-card text-muted-foreground hover:bg-muted hover:text-foreground lg:bg-transparent',
      )}
    >
      {active && <span className="absolute inset-y-2 left-0 hidden w-1 rounded-full bg-primary lg:block" />}
      <span className={cn('hidden size-7 shrink-0 rounded-lg bg-gradient-to-br lg:block', tint ?? 'from-primary/30 to-accent')} />
      {label}
    </Link>
  );
}
