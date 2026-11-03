// Vercel Web Analytics sees page URLs only. Order and company ids are replaced with a
// placeholder and the query string (search terms, tabs) is dropped before anything is sent.
const PRIVATE_SEGMENT = /\/(orders|seller)\/[^/?#]+/g;

export function redactUrl(url) {
  const u = new URL(url);
  return `${u.origin}${u.pathname.replace(PRIVATE_SEGMENT, '/$1/[id]')}`;
}

export const beforeSend = (event) => ({ ...event, url: redactUrl(event.url) });
