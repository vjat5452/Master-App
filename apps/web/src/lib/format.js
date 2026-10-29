const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

const inrWhole = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
/** Shelf-style price: drops ".00" but keeps paise when there are any. */
export const money = (minor) => (minor == null ? '—' : minor % 100 ? inr.format(minor / 100) : inrWhole.format(minor / 100));
export const price = money;
export const toMinor = (rupees) => Math.round(Number(rupees) * 100);

export const distance = (m) => (m == null ? '—' : m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);
export const minutes = (n) => (n == null ? '—' : n < 60 ? `${n} min` : `${Math.floor(n / 60)} h ${n % 60} min`);

export const dateTime = (iso) =>
  iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/** "just now", "4 min ago", "2 h ago", "3 d ago". */
export function ago(iso, now = Date.now()) {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export const attrs = (a) => Object.entries(a ?? {}).map(([k, v]) => `${k}: ${v}`);

export const shortId = (id) => (id ? id.slice(0, 8) : '');

export const title = (s) => (s ?? '').toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

const TONES = {
  CONFIRMED: 'good', SUCCEEDED: 'good', ACTIVE: 'good', OK: 'good', INVENTORY_RESERVED: 'info',
  PENDING_PAYMENT: 'warn', PENDING: 'warn', PENDING_REVIEW: 'warn', PAUSED: 'warn', REFUND_PENDING: 'warn',
  CANCELLED: 'muted', ARCHIVED: 'muted', INACTIVE: 'muted', EXPIRED: 'muted', RELEASED: 'muted',
  PAYMENT_FAILED: 'bad', FAILED: 'bad',
};
export const tone = (status) => TONES[status] ?? 'info';
