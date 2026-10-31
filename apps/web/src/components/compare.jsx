// Demo data, unknown distance, partial totals, unconfirmed matches and stale prices are always labelled.
import { useCallback, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  CircleDashed,
  Clock,
  ExternalLink,
  FlaskConical,
  MapPin,
  PlugZap,
  Radio,
  RefreshCw,
  Scale,
  Store,
  Timer,
  Trophy,
} from 'lucide-react';
import { Alert, Badge, Button, ErrorBox, Spinner } from '@/components/kit';
import { compareOffers, RANKING_POLICIES, useChangeStream } from '@/lib/compare';
import { ago, money } from '@/lib/format';
import { useAsync, useAuth } from '@/lib/store';
import { cn } from '@/lib/utils';

const SHOWN = 6;

const POSITIVE_REASONS = {
  BEST_AVAILABLE_VALUE: 'Top pick',
  LOWEST_ITEM_PRICE: 'Lowest price',
  LOWEST_KNOWN_TOTAL: 'Lowest total',
  NEAREST_VERIFIED_STORE: 'Nearest store',
  FASTEST_KNOWN_ETA: 'Fastest',
};

const SOURCE_STATUS = {
  RESPONDED: (s) => `${s.resultCount} result${s.resultCount === 1 ? '' : 's'}${s.fromCache ? ' · cached' : ''}`,
  NOT_CONFIGURED: () => 'not connected',
  FAILED: (s) => (s.error?.code === 'TIMEOUT' ? 'timed out' : 'unavailable'),
  NOT_CACHED: () => 'no recent data',
  UNSUPPORTED: () => 'cannot search',
};

const AVAILABILITY = {
  OUT_OF_STOCK: ['Out of stock', 'bad'],
  NOT_SERVICEABLE: ['Does not deliver here', 'muted'],
  FETCH_FAILED: ['Could not check', 'warn'],
  UNKNOWN: ['Stock unknown', 'muted'],
};

const discount = (p) => (p?.mrpMinor && p.mrpMinor > p.itemPriceMinor ? Math.round((1 - p.itemPriceMinor / p.mrpMinor) * 100) : 0);

function Freshness({ r }) {
  if (r.dataProvenance.isDemo) {
    return (
      <span className="inline-flex items-center gap-0.5 font-semibold text-amber-700 dark:text-gold">
        <FlaskConical className="size-3" /> Demo data, not verified
      </span>
    );
  }
  if (r.sourceType === 'LOCAL_VENDOR') return <span>Live stock</span>;
  const { status, sourceObservedAt, collectedAt } = r.freshness;
  const when = ago(sourceObservedAt ?? collectedAt);
  return (
    <span className={cn('inline-flex items-center gap-0.5', status !== 'FRESH' && 'font-semibold text-amber-700 dark:text-gold')}>
      <Clock className="size-3" />
      {status === 'FRESH' ? `Updated ${when}` : status === 'STALE' ? `May be out of date (${when})` : status === 'EXPIRED' ? `Old data (${when})` : 'Not verified'}
    </span>
  );
}

function PriceBlock({ r }) {
  const p = r.price;
  if (!p) return <div className="text-sm font-bold text-muted-foreground">Price unknown</div>;
  const off = discount(p);
  const fees = p.fees ?? {};
  const knownFees = Object.values(fees).filter((v) => v != null).reduce((a, b) => a + b, 0);
  return (
    <div className="text-right">
      <div className="num text-base font-extrabold">{money(p.itemPriceMinor)}</div>
      {off > 0 && (
        <div className="text-[11px]">
          <span className="text-muted-foreground line-through">{money(p.mrpMinor)}</span> <span className="font-bold text-success">{off}% off</span>
        </div>
      )}
      <div className="text-[10px] leading-tight text-muted-foreground">
        {p.totalCostCompleteness === 'COMPLETE' ? (
          `Total ${money(p.totalKnownCostMinor)}`
        ) : r.sourceType === 'LOCAL_VENDOR' ? (
          'Delivery fee at checkout'
        ) : p.totalKnownCostMinor != null && knownFees > 0 ? (
          <>
            {money(p.totalKnownCostMinor)} with known fees
            <br />
            other fees unknown
          </>
        ) : (
          'Fees unknown'
        )}
      </div>
    </div>
  );
}

function ResultRow({ r }) {
  const local = r.sourceType === 'LOCAL_VENDOR';
  const top = r.ranking.reasons.includes('BEST_AVAILABLE_VALUE');
  const unavailable = AVAILABILITY[r.availability];
  const chips = r.ranking.reasons.filter((c) => POSITIVE_REASONS[c] && c !== 'BEST_AVAILABLE_VALUE');
  const eta = r.eta
    ? r.eta.minMinutes != null && r.eta.maxMinutes != null && r.eta.minMinutes !== r.eta.maxMinutes
      ? `${r.eta.minMinutes}–${r.eta.maxMinutes} min`
      : `${r.eta.maxMinutes ?? r.eta.minMinutes} min`
    : null;
  return (
    <li className={cn('flex gap-3 px-4 py-3', top && 'bg-gold/[0.07]', unavailable && r.availability !== 'UNKNOWN' && 'opacity-70')}>
      <span
        className={cn(
          'grid size-9 shrink-0 place-items-center rounded-xl text-sm font-extrabold',
          top ? 'bg-gold text-gold-foreground' : local ? 'bg-primary/10 text-primary' : 'bg-info/10 text-info',
        )}
        title={local ? 'LocalStock seller' : r.sourceName}
      >
        {top ? <Trophy className="size-4" /> : local ? <Store className="size-4" /> : r.sourceName[0]}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-bold">{r.sourceName}</span>
          <Badge kind={local ? 'good' : 'info'}>{local ? 'LocalStock seller' : 'Other platform'}</Badge>
          {r.dataProvenance.isDemo && (
            <Badge kind="gold">
              <FlaskConical /> Demo
            </Badge>
          )}
          {top && <Badge kind="gold">Top pick</Badge>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
          {r.product.variant && <span className="font-semibold text-foreground/80">{r.product.variant}</span>}
          {r.sizeMatch === 'DIFFERENT' && <span className="font-bold text-destructive">Different size</span>}
          {r.sizeMatch === 'UNKNOWN' && <span className="font-semibold text-amber-700 dark:text-gold">Size unclear</span>}
          {!local && r.matchStatus !== 'MATCHED' && (
            <span className="inline-flex items-center gap-0.5 font-semibold text-amber-700 dark:text-gold">
              <CircleDashed className="size-3" /> {r.matchStatus === 'NEEDS_REVIEW' ? 'Match being reviewed' : 'Not confirmed as the same product'}
            </span>
          )}
          {!local && r.matchStatus === 'MATCHED' && <span className="font-semibold text-success">Same product</span>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-muted-foreground">
          {eta ? (
            <span className="inline-flex items-center gap-0.5">
              <Timer className="size-3" /> {r.eta.status === 'ESTIMATED' ? `≈ ${eta}` : eta}
            </span>
          ) : (
            <span className="inline-flex items-center gap-0.5">
              <Timer className="size-3" /> ETA unknown
            </span>
          )}
          <span className="inline-flex items-center gap-0.5">
            <MapPin className="size-3" /> {r.distance.km != null ? `${r.distance.km} km` : 'Distance unknown'}
          </span>
          <Freshness r={r} />
          {unavailable && <Badge kind={unavailable[1]}>{unavailable[0]}</Badge>}
        </div>
        {chips.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {chips.map((c) => (
              <span key={c} className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-bold text-success">
                {POSITIVE_REASONS[c]}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex max-w-[42%] shrink-0 flex-col items-end justify-between gap-1 sm:max-w-none">
        <PriceBlock r={r} />
        {local ? (
          <span className="text-[10px] font-bold text-primary">Order on LocalStock</span>
        ) : r.deepLink ? (
          <a href={r.deepLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[10px] font-bold text-info hover:underline">
            Open on {r.sourceName} <ExternalLink className="size-3" />
          </a>
        ) : (
          <span className="text-[10px] text-muted-foreground">Order in their app</span>
        )}
      </div>
    </li>
  );
}

export function CompareSection({ variant, location, query }) {
  const { user } = useAuth();
  const [policy, setPolicy] = useState('best_value');
  const [refresh, setRefresh] = useState('prefer_fresh');
  const [showAll, setShowAll] = useState(false);
  const [lastLive, setLastLive] = useState(null);
  const compare = useAsync(
    () => compareOffers({ query, location, rankingPolicy: policy, refreshPolicy: refresh }),
    [query, location.lat, location.lng, policy, refresh],
  );

  // Until the product is matched, any change in this area triggers a reload.
  const reloadTimer = useRef();
  const onEvent = useCallback(() => {
    setLastLive(new Date().toISOString());
    clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => compare.reload(), 800);
  }, [compare]);
  const live = useChangeStream({ enabled: Boolean(user) && Boolean(compare.data), variantIds: [variant.id], cell: compare.data?.location.cell, onEvent });

  const data = compare.data;
  const results = useMemo(
    () => (data?.results ?? []).filter((r) => r.sourceType === 'EXTERNAL_PLATFORM' || r.canonicalProductId === variant.id),
    [data, variant.id],
  );
  const external = (data?.sources ?? []).filter((s) => s.sourceType === 'EXTERNAL_PLATFORM');
  const connected = external.filter((s) => s.status !== 'NOT_CONFIGURED');
  const anyExternalResult = results.some((r) => r.sourceType === 'EXTERNAL_PLATFORM');
  const shown = showAll ? results : results.slice(0, SHOWN);

  return (
    <section className="rounded-2xl border bg-card shadow-soft" aria-labelledby="compare-heading">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 id="compare-heading" className="flex items-center gap-1.5 font-extrabold">
            <Scale className="size-4 text-primary" /> Compare across platforms
          </h2>
          <p className="text-[11px] text-muted-foreground">LocalStock sellers and connected platforms near {location.label ?? 'you'}</p>
        </div>
        <div className="flex items-center gap-2">
          {live !== 'off' && (
            <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold', live === 'live' ? 'text-success' : 'text-muted-foreground')} title={lastLive ? `Last update ${ago(lastLive)}` : 'Listening for detected changes'}>
              <Radio className={cn('size-3', live === 'live' && 'animate-pulse')} /> {live === 'live' ? 'Live' : 'Reconnecting'}
            </span>
          )}
          <Button
            size="sm"
            variant="ghost"
            busy={compare.loading && refresh === 'refresh_supported'}
            onClick={() => (refresh === 'refresh_supported' ? compare.reload() : setRefresh('refresh_supported'))}
            title="Ask connected platforms again now"
          >
            <RefreshCw /> Refresh
          </Button>
        </div>
      </div>

      <div className="scrollbar-none flex items-center gap-1.5 overflow-x-auto border-b px-4 py-2.5">
        <span className="mr-1 shrink-0 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Rank by</span>
        {RANKING_POLICIES.map((p) => (
          <button
            key={p.id}
            onClick={() => setPolicy(p.id)}
            className={cn(
              'shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-bold transition',
              policy === p.id ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      <ErrorBox error={compare.error} onRetry={compare.reload} />
      {compare.loading && !data && <Spinner label="Asking sellers and platforms…" />}

      {data && !anyExternalResult && (
        <div className="flex gap-3 px-4 py-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
            <PlugZap className="size-4" />
          </span>
          <div className="text-sm">
            <div className="font-bold">{connected.length ? 'No other platform lists this product nearby' : 'No other platforms connected yet'}</div>
            <p className="text-[12px] text-muted-foreground">
              {connected.length
                ? 'Connected platforms answered, but none had this product for your area.'
                : 'Prices from other quick-commerce apps appear here once LocalStock has authorized access to them. Until then, only LocalStock sellers are compared.'}
            </p>
          </div>
        </div>
      )}

      {data && anyExternalResult && (
        <>
          <ul className={cn('divide-y transition-opacity', compare.loading && 'opacity-60')}>
            {shown.map((r) => (
              <ResultRow key={`${r.sourceId}:${r.listingId}`} r={r} />
            ))}
          </ul>
          {results.length > SHOWN && (
            <button className="w-full border-t px-4 py-2 text-xs font-bold text-primary hover:bg-muted/40" onClick={() => setShowAll((s) => !s)}>
              {showAll ? 'Show fewer' : `Show all ${results.length}`}
            </button>
          )}
        </>
      )}

      {data && (
        <div className="space-y-2 border-t px-4 py-3">
          {data.notices.map((n) => (
            <Alert key={n} tone="info" className="p-2.5 text-[12px]">
              {n}
            </Alert>
          ))}
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="font-bold uppercase tracking-wide text-muted-foreground">Sources</span>
            {data.sources.map((s) => (
              <span
                key={s.sourceId}
                title={s.message ?? s.error?.message ?? ''}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5',
                  s.status === 'RESPONDED' ? 'bg-success/5 text-foreground' : s.status === 'FAILED' ? 'border-destructive/30 text-destructive' : 'text-muted-foreground',
                )}
              >
                <span className={cn('size-1.5 rounded-full', s.status === 'RESPONDED' ? 'bg-success' : s.status === 'FAILED' ? 'bg-destructive' : 'bg-muted-foreground/50')} />
                {s.sourceType === 'LOCAL_VENDOR' ? 'LocalStock sellers' : s.sourceName} · {(SOURCE_STATUS[s.status] ?? (() => s.status))(s)}
              </span>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Ranked: same size first, in stock before out of stock, then {RANKING_POLICIES.find((p) => p.id === policy)?.label.toLowerCase()}. Unknown distance or delivery time never counts as best.{' '}
            {!user && (
              <Link to="/login" className="inline-flex items-center gap-0.5 font-semibold text-primary hover:underline">
                Sign in for live updates <ArrowUpRight className="size-3" />
              </Link>
            )}
          </p>
        </div>
      )}
    </section>
  );
}
