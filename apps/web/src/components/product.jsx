import { Link } from 'react-router-dom';
import { attrs, distance, minutes, money } from '../lib/format.js';

const EMOJI = [
  [/bread|bakery|bun|cake/i, '🍞'],
  [/milk|dairy|curd|paneer|cheese/i, '🥛'],
  [/egg/i, '🥚'],
  [/rice|grain|atta|flour|dal/i, '🌾'],
  [/fruit|apple|banana/i, '🍎'],
  [/veg|onion|potato|tomato/i, '🥕'],
  [/tea|coffee/i, '☕'],
  [/oil|ghee/i, '🫒'],
  [/snack|chips|biscuit/i, '🍪'],
];
export const emojiFor = (...names) => EMOJI.find(([re]) => names.some((n) => re.test(n ?? '')))?.[1] ?? '📦';

export function Attrs({ attributes }) {
  const list = attrs(attributes);
  if (!list.length) return null;
  return (
    <div className="row wrap gap-sm">
      {list.map((a) => (
        <span key={a} className="chip">
          {a}
        </span>
      ))}
    </div>
  );
}

export function OfferLine({ offer, best }) {
  return (
    <div className={`offer ${best ? 'best' : ''}`}>
      <div className="strong" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {offer.sellerName} {best && <span className="badge badge-good" style={{ marginLeft: 4 }}>Best pick</span>}
      </div>
      <div className="price">{money(offer.priceMinor)}</div>
      <div className="small muted">
        {offer.distanceMeters != null ? `${distance(offer.distanceMeters)} away · ` : ''}~{minutes(offer.estimatedDeliveryMinutes)}
      </div>
      <div className="small faint right">{offer.availableUnits} in stock</div>
    </div>
  );
}

export function ProductTitle({ variantId, brand, name, group }) {
  return (
    <div className="grow">
      {brand && <div className="small faint strong">{brand}</div>}
      <Link to={`/product/${variantId}`} className="product-name">
        {name}
      </Link>
      {group && <div className="small muted">{group}</div>}
    </div>
  );
}
