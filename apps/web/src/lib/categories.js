import { get, qs } from './api.js';

// Unknown categories are shown after these with the neutral tint.
export const CATEGORY_STYLE = {
  dairy: { short: 'Dairy, Curd & Ice Cream', tint: 'from-sky-100 to-blue-50 dark:from-sky-500/20 dark:to-blue-500/5' },
  bakery: { short: 'Bread & Biscuits', tint: 'from-amber-100 to-orange-50 dark:from-amber-500/20 dark:to-orange-500/5' },
  snacks: { short: 'Chips & Namkeen', tint: 'from-orange-100 to-yellow-50 dark:from-orange-500/20 dark:to-yellow-500/5' },
  beverages: { short: 'Tea, Coffee & Drinks', tint: 'from-rose-100 to-pink-50 dark:from-rose-500/20 dark:to-pink-500/5' },
  staples: { short: 'Atta, Rice, Oil & Dals', tint: 'from-lime-100 to-yellow-50 dark:from-lime-500/20 dark:to-yellow-500/5' },
  'breakfast-instant': { short: 'Breakfast & Instant Food', tint: 'from-yellow-100 to-amber-50 dark:from-yellow-500/20 dark:to-amber-500/5' },
  'chocolates-sweets': { short: 'Sweet Tooth', tint: 'from-fuchsia-100 to-purple-50 dark:from-fuchsia-500/20 dark:to-purple-500/5' },
  'spices-masalas': { short: 'Masala & Spices', tint: 'from-red-100 to-orange-50 dark:from-red-500/20 dark:to-orange-500/5' },
  'spreads-sauces': { short: 'Sauces, Spreads & Pickles', tint: 'from-emerald-100 to-teal-50 dark:from-emerald-500/20 dark:to-teal-500/5' },
  'health-wellness': { short: 'Health Drinks & Wellness', tint: 'from-teal-100 to-cyan-50 dark:from-teal-500/20 dark:to-cyan-500/5' },
  grocery: { short: 'Daily Grocery', tint: 'from-stone-100 to-neutral-50 dark:from-stone-500/20 dark:to-neutral-500/5' },
};
const ORDER = Object.keys(CATEGORY_STYLE);
const NEUTRAL = { tint: 'from-muted to-background' };

export const styleFor = (slug) => CATEGORY_STYLE[slug] ?? NEUTRAL;

let cache;
/** Leaf categories in storefront order, memoised for the session. */
export function loadCategories() {
  cache ??= get('/catalog/categories', { auth: false })
    .then((r) =>
      r.items
        .filter((c) => !r.items.some((child) => child.parentId === c.id))
        .sort((a, b) => (ORDER.indexOf(a.slug) + 1 || 99) - (ORDER.indexOf(b.slug) + 1 || 99) || a.name.localeCompare(b.name)),
    )
    .catch((err) => {
      cache = undefined;
      throw err;
    });
  return cache;
}

/** One search page, scoped to the delivery location unless `anywhere`. */
export const searchCatalog = ({ q = '', category = '', sort, radiusKm = 20, page = 1, limit = 20, location, anywhere }) =>
  get(
    `/catalog/search${qs({ q, category, sort, radiusKm, page, limit, ...(anywhere || !location ? {} : { lat: location.lat, lng: location.lng }) })}`,
    { auth: false },
  );
