// Vercel Web Analytics and Speed Insights see page URLs only. Order and company ids are
// replaced with a placeholder and the query string (search terms, tabs) is dropped before
// anything is sent.
const PRIVATE_SEGMENT = /\/(orders|seller)\/[^/?#]+/g;
// Speed Insights groups measurements by route, so every product page counts as one.
const ROUTE_SEGMENT = /\/(orders|seller|product)\/[^/?#]+/g;

export function redactUrl(url) {
  const u = new URL(url);
  return `${u.origin}${u.pathname.replace(PRIVATE_SEGMENT, '/$1/[id]')}`;
}

export const routeOf = (url) => new URL(url).pathname.replace(ROUTE_SEGMENT, '/$1/[id]');

export const beforeSend = (event) => ({ ...event, url: redactUrl(event.url) });

export const beforeSendVital = (event) => ({ ...event, url: redactUrl(event.url), route: routeOf(event.url) });
