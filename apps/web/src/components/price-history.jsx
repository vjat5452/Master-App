// Price graph for a product and the "open on other apps" menu.
import { ChevronDown, ExternalLink, FlaskConical, LineChart as LineChartIcon, TrendingDown, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, ErrorBox, Spinner } from '@/components/kit';
import { PriceLines } from '@/components/mui/lazy';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { get, qs } from '@/lib/api';
import { money } from '@/lib/format';
import { useAsync } from '@/lib/store';
import { cn } from '@/lib/utils';

const RANGES = [7, 30, 90];
const shortDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export function PriceHistory({ variantId, location }) {
  const [days, setDays] = useState(30);
  const history = useAsync(
    () => get(`/catalog/variants/${variantId}/price-history${qs({ days, lat: location.lat, lng: location.lng })}`, { auth: false }),
    [variantId, days, location.lat, location.lng],
  );
  const data = history.data;
  const s = data?.summary;

  return (
    <section className="rounded-2xl border bg-card shadow-soft" aria-labelledby="price-history-heading">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <h2 id="price-history-heading" className="flex items-center gap-1.5 font-extrabold">
          <LineChartIcon className="size-4 text-primary" /> Price history
        </h2>
        <div className="flex rounded-lg border bg-muted/40 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setDays(r)}
              className={cn('rounded-md px-2 py-1 text-[11px] font-bold transition', days === r ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
            >
              {r} days
            </button>
          ))}
        </div>
      </div>
      <ErrorBox error={history.error} onRetry={history.reload} />
      {history.loading && !data && <Spinner label="Loading prices…" />}
      {data && data.series.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">No prices recorded for this product in the last {days} days.</p>}
      {data && data.series.length > 0 && (
        <div className={cn('px-2 pt-2 transition-opacity', history.loading && 'opacity-60')}>
          <PriceLines dates={data.dates.map(shortDate)} series={data.series.map((x) => ({ label: x.isDemo && !/fixture|demo/i.test(x.label) ? `${x.label} (demo)` : x.label, values: x.points.map((p) => p.priceMinor) }))} format={money} />
        </div>
      )}
      {s && (
        <div className="grid grid-cols-2 gap-2 border-t px-4 py-3 text-xs">
          <div className="flex items-center gap-2">
            <TrendingDown className="size-4 text-success" />
            <div>
              <div className="num font-extrabold">{money(s.lowest.priceMinor)}</div>
              <div className="text-muted-foreground">
                Lowest · {shortDate(s.lowest.date)} · {s.lowest.source}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <TrendingUp className="size-4 text-destructive" />
            <div>
              <div className="num font-extrabold">{money(s.highest.priceMinor)}</div>
              <div className="text-muted-foreground">
                Highest · {shortDate(s.highest.date)} · {s.highest.source}
              </div>
            </div>
          </div>
        </div>
      )}
      {data?.series.some((x) => x.isDemo) && (
        <p className="flex items-center gap-1 border-t px-4 py-2 text-[11px] font-semibold text-amber-700 dark:text-gold">
          <FlaskConical className="size-3" /> Lines marked demo use fixture data, not real prices.
        </p>
      )}
      {data && <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">{data.notes.join(' ')}</p>}
    </section>
  );
}

/** Dropdown with each platform's own page for this product, opened in a new tab. */
export function PlatformLinks({ variantId, className }) {
  const links = useAsync(() => get(`/catalog/variants/${variantId}/platform-links`, { auth: false }), [variantId]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" className={className} disabled={!links.data}>
          Check on other apps <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Opens the app's own page in a new tab</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {links.data?.links.map((l) => (
          <DropdownMenuItem key={l.platformCode} asChild>
            <a href={l.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <span className="grid size-6 place-items-center rounded-md bg-info/10 text-[11px] font-extrabold text-info">{l.name[0]}</span>
                {l.kind === 'LISTING' ? `View on ${l.name}` : `Search on ${l.name}`}
              </span>
              <span className="flex items-center gap-1">
                {l.kind === 'LISTING' && <Badge kind="good">Listing</Badge>}
                <ExternalLink className="size-3.5 text-muted-foreground" />
              </span>
            </a>
          </DropdownMenuItem>
        ))}
        {links.error && <div className="p-2 text-xs text-destructive">{links.error.message}</div>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
