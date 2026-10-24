import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Attrs, emojiFor, OfferLine, ProductTitle } from '../components/product.jsx';
import { Button, Empty, ErrorBox, Spinner, Stepper } from '../components/ui.jsx';
import { get, qs } from '../lib/api.js';
import { money } from '../lib/format.js';
import { useAsync, useCart, useDeliveryLocation, useToast } from '../lib/store.jsx';

export const SORTS = [
  { id: 'best_value', label: 'Best value' },
  { id: 'lowest_price', label: 'Lowest price' },
  { id: 'fastest', label: 'Fastest' },
  { id: 'nearest', label: 'Nearest' },
];
const RADII = [2, 5, 10, 20, 50];
const SUGGESTIONS = ['bread', 'milk', 'whole wheat', 'multigrain'];

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

  return (
    <>
      <section className="hero">
        <h1>Groceries from sellers near {location.label ?? 'you'}</h1>
        <p>Compare every seller's price, stock and delivery time, then check out across warehouses in one order.</p>
        <form
          className="searchbar"
          onSubmit={(e) => {
            e.preventDefault();
            update({ q: draft.trim() });
          }}
        >
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Search products, e.g. whole wheat bread" aria-label="Search" />
          <select value={sort} onChange={(e) => update({ sort: e.target.value })} aria-label="Sort">
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <select value={radiusKm} onChange={(e) => update({ radiusKm: e.target.value })} aria-label="Radius" disabled={anywhere}>
            {RADII.map((r) => (
              <option key={r} value={r}>
                Within {r} km
              </option>
            ))}
          </select>
          <Button type="submit">Search</Button>
        </form>
        <div className="row wrap gap-sm" style={{ marginTop: 12 }}>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              className="chip"
              style={{ cursor: 'pointer', background: 'rgba(255,255,255,.15)', color: '#fff', borderColor: 'rgba(255,255,255,.25)' }}
              onClick={() => {
                setDraft(s);
                update({ q: s });
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </section>

      <div className="row between wrap" style={{ marginBottom: 14 }}>
        <div className="muted">
          {data && (
            <>
              <strong style={{ color: 'var(--text)' }}>{data.total}</strong> product{data.total === 1 ? '' : 's'}
              {q && <> for “{q}”</>} · {withStock} with sellers {anywhere ? 'anywhere' : `within ${radiusKm} km`}
            </>
          )}
        </div>
        <label className="check small muted">
          <input type="checkbox" checked={anywhere} onChange={(e) => update({ anywhere: e.target.checked })} />
          Ignore location (show every seller)
        </label>
      </div>

      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Spinner label="Searching…" />}
      {data && data.items.length === 0 && (
        <Empty icon="🔎" title="No products match">
          Try a different word, or clear the search to browse everything.
        </Empty>
      )}
      {data && data.items.length > 0 && (
        <div className="products" style={{ opacity: loading ? 0.6 : 1, transition: 'opacity .15s' }}>
          {data.items.map((item) => (
            <ProductCard key={item.variantId} item={item} />
          ))}
        </div>
      )}

      {data && pages > 1 && (
        <div className="row" style={{ justifyContent: 'center', marginTop: 22 }}>
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => update({ page: page - 1 })}>
            ← Previous
          </Button>
          <span className="muted small">
            Page {page} of {pages}
          </span>
          <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => update({ page: page + 1 })}>
            Next →
          </Button>
        </div>
      )}
    </>
  );
}

function ProductCard({ item }) {
  const cart = useCart();
  const toast = useToast();
  const [qty, setQty] = useState(1);
  const shown = item.offers.slice(0, 3);
  const from = item.offers.length ? Math.min(...item.offers.map((o) => o.priceMinor)) : null;
  const stock = item.offers.reduce((n, o) => n + o.availableUnits, 0);

  return (
    <article className="card product">
      <div className="product-top">
        <div className="thumb">{emojiFor(item.group, item.name)}</div>
        <div className="stack-sm grow">
          <ProductTitle variantId={item.variantId} brand={item.brand} name={item.name} group={item.group} />
          <Attrs attributes={item.attributes} />
        </div>
      </div>
      <div className="offers">
        {shown.length === 0 && <div className="offer small muted">No seller delivers this here right now.</div>}
        {shown.map((o, i) => (
          <OfferLine key={o.offerId} offer={o} best={i === 0 && item.offers.length > 1} />
        ))}
        {item.offers.length > 3 && <div className="offer small muted">+{item.offers.length - 3} more seller(s)</div>}
      </div>
      <div className="product-foot">
        <div>
          <div className="small faint">{from != null ? 'from' : ''}</div>
          <div className="price" style={{ fontSize: 17 }}>
            {from != null ? money(from) : <span className="muted small">Unavailable</span>}
          </div>
        </div>
        <div className="row gap-sm">
          <Stepper value={qty} onChange={setQty} min={1} max={Math.max(1, Math.min(100, stock))} />
          <Button
            size="sm"
            disabled={!item.offers.length}
            onClick={() => {
              cart.add({ variantId: item.variantId, name: item.name, brand: item.brand, group: item.group, attributes: item.attributes, priceHintMinor: from }, qty);
              toast(`Added ${qty} × ${item.name}`);
              setQty(1);
            }}
          >
            Add
          </Button>
        </div>
      </div>
    </article>
  );
}
