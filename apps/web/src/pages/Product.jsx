import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Attrs, emojiFor } from '../components/product.jsx';
import { Badge, Button, Card, CopyId, Empty, ErrorBox, Spinner, Stepper } from '../components/ui.jsx';
import { get, qs } from '../lib/api.js';
import { distance, minutes, money } from '../lib/format.js';
import { useAsync, useCart, useDeliveryLocation, useToast } from '../lib/store.jsx';
import { SORTS } from './Shop.jsx';

export default function Product() {
  const { variantId } = useParams();
  const { location } = useDeliveryLocation();
  const cart = useCart();
  const toast = useToast();
  const [sort, setSort] = useState('best_value');
  const [radiusKm, setRadiusKm] = useState(20);
  const [qty, setQty] = useState(1);

  const variant = useAsync(async () => {
    const v = await get(`/catalog/variants/${variantId}`, { auth: false });
    const group = await get(`/catalog/groups/${v.groupId}`, { auth: false }).catch(() => null);
    return { ...v, group };
  }, [variantId]);
  const offers = useAsync(
    () => get(`/catalog/variants/${variantId}/offers${qs({ lat: location.lat, lng: location.lng, radiusKm, sort })}`, { auth: false }),
    [variantId, location.lat, location.lng, radiusKm, sort],
  );

  if (variant.loading && !variant.data) return <Spinner />;
  if (variant.error) return <ErrorBox error={variant.error} onRetry={variant.reload} />;
  const v = variant.data;
  const list = offers.data?.offers ?? [];
  const stock = list.reduce((n, o) => n + o.availableUnits, 0);
  const from = list.length ? Math.min(...list.map((o) => o.priceMinor)) : null;
  const siblings = v.group?.variants.filter((s) => s.id !== v.id) ?? [];

  return (
    <div className="stack">
      <div className="small muted">
        <Link to="/">Shop</Link> / {v.groupName} / {v.name}
      </div>
      <div className="split">
        <div className="stack">
          <Card>
            <div className="row" style={{ alignItems: 'flex-start', gap: 20 }}>
              <div className="thumb thumb-lg">{emojiFor(v.groupName, v.name)}</div>
              <div className="stack-sm grow">
                {v.brand && <div className="faint strong">{v.brand}</div>}
                <h1>{v.name}</h1>
                <Attrs attributes={v.attributes} />
                <div className="row wrap small muted" style={{ marginTop: 6 }}>
                  <span>Group: {v.groupName}</span>
                  {v.barcode && <span>· GTIN <span className="mono">{v.barcode}</span></span>}
                  <span>· id <CopyId id={v.id} /></span>
                  <Badge status={v.status} />
                </div>
                {v.group?.description && <p className="muted">{v.group.description}</p>}
              </div>
            </div>
          </Card>

          <Card
            title={`Sellers delivering to ${location.label ?? 'your location'}`}
            actions={
              <div className="row wrap gap-sm">
                <div className="seg">
                  {SORTS.map((s) => (
                    <button key={s.id} className={sort === s.id ? 'on' : ''} onClick={() => setSort(s.id)}>
                      {s.label}
                    </button>
                  ))}
                </div>
                <select className="select" style={{ width: 'auto' }} value={radiusKm} onChange={(e) => setRadiusKm(Number(e.target.value))}>
                  {[5, 10, 20, 50].map((r) => (
                    <option key={r} value={r}>
                      {r} km
                    </option>
                  ))}
                </select>
              </div>
            }
            pad={false}
          >
            <ErrorBox error={offers.error} onRetry={offers.reload} />
            {offers.loading && !offers.data && <Spinner />}
            {offers.data && list.length === 0 && (
              <Empty icon="🚚" title="No seller delivers here">
                Try a larger radius or a different delivery location.
              </Empty>
            )}
            {list.length > 0 && (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Seller</th>
                      <th className="num">Price</th>
                      <th className="num">Nearest warehouse</th>
                      <th className="num">Est. delivery</th>
                      <th className="num">In stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((o, i) => (
                      <tr key={o.offerId}>
                        <td>
                          <span className="strong">{o.sellerName}</span> {i === 0 && list.length > 1 && <Badge kind="good">Best pick</Badge>}
                        </td>
                        <td className="num price">{money(o.priceMinor)}</td>
                        <td className="num">{distance(o.distanceMeters)}</td>
                        <td className="num">{minutes(o.estimatedDeliveryMinutes)}</td>
                        <td className="num">{o.availableUnits}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {siblings.length > 0 && (
            <Card title={`Other ${v.groupName.toLowerCase()} options`}>
              <div className="grid grid-2">
                {siblings.map((s) => (
                  <Link key={s.id} to={`/product/${s.id}`} className="demo-user" style={{ color: 'inherit', textDecoration: 'none' }}>
                    <span style={{ fontSize: 22 }}>{emojiFor(s.groupName, s.name)}</span>
                    <span className="grow">
                      <div className="small faint">{s.brand}</div>
                      <div className="strong">{s.name}</div>
                      <Attrs attributes={s.attributes} />
                    </span>
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="sticky">
          <Card title="Add to cart">
            <div className="stack">
              <div>
                <div className="small faint">{from != null ? 'Best price from' : ''}</div>
                <div style={{ fontSize: 28, fontWeight: 700 }}>{from != null ? money(from) : <span className="muted" style={{ fontSize: 16 }}>Not available here</span>}</div>
                <div className="small muted">
                  {list.length} seller{list.length === 1 ? '' : 's'} · {stock} units nearby
                </div>
              </div>
              <div className="row between">
                <span className="muted">Quantity</span>
                <Stepper value={qty} onChange={setQty} min={1} max={Math.max(1, Math.min(100, stock))} />
              </div>
              <Button
                size="lg"
                className="btn-block"
                disabled={!list.length}
                onClick={() => {
                  cart.add({ variantId: v.id, name: v.name, brand: v.brand, group: v.groupName, attributes: v.attributes, priceHintMinor: from }, qty);
                  toast(`Added ${qty} × ${v.name}`);
                }}
              >
                Add to cart
              </Button>
              <p className="small faint" style={{ margin: 0 }}>
                At checkout the allocation engine picks warehouses and couriers for the whole cart. It may split the order if that's cheaper or faster.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
