// Thin fetch wrapper for /api/v1. Holds the token pair, retries once after refreshing on 401,
// and normalizes the API's error shape { error: { code, message, details, requestId } }.

const TOKENS_KEY = 'localstock.tokens';
export const API_BASE = '/api/v1';

export class ApiError extends Error {
  constructor(status, error = {}) {
    super(error.message ?? `Request failed (${status})`);
    this.status = status;
    this.code = error.code ?? 'HTTP_ERROR';
    this.details = error.details;
    this.requestId = error.requestId;
  }
}

function readTokens() {
  try {
    return JSON.parse(localStorage.getItem(TOKENS_KEY)) ?? null;
  } catch {
    return null;
  }
}

let tokens = readTokens();
const listeners = new Set();

export const getTokens = () => tokens;
export const onTokensChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));

export function setTokens(next) {
  tokens = next ? { accessToken: next.accessToken, refreshToken: next.refreshToken } : null;
  try {
    if (tokens) localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
    else localStorage.removeItem(TOKENS_KEY);
  } catch {
    // storage unavailable: tokens live for this tab only
  }
  listeners.forEach((fn) => fn(tokens));
}

// Refresh tokens rotate and reuse revokes every session, so concurrent 401s share one refresh.
let refreshing = null;
function refreshTokens() {
  if (!tokens?.refreshToken) return Promise.resolve(false);
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      });
      if (!res.ok) {
        setTokens(null);
        return false;
      }
      setTokens(await res.json());
      return true;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function send(method, url, { body, headers = {}, auth = true }) {
  const h = { Accept: 'application/json', ...headers };
  if (body !== undefined) h['Content-Type'] ??= 'application/json';
  if (auth && tokens?.accessToken) h.Authorization = `Bearer ${tokens.accessToken}`;
  const started = performance.now();
  const res = await fetch(url, {
    method,
    headers: h,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { res, data, ms: Math.round(performance.now() - started) };
}

/** Low-level call used by the API explorer: never throws on HTTP errors. */
export async function rawRequest(method, url, opts = {}) {
  let out = await send(method, url, opts);
  if (out.res.status === 401 && opts.auth !== false && tokens?.refreshToken && !url.includes('/auth/')) {
    if (await refreshTokens()) out = await send(method, url, opts);
  }
  return {
    status: out.res.status,
    ok: out.res.ok,
    ms: out.ms,
    headers: Object.fromEntries(out.res.headers.entries()),
    data: out.data,
  };
}

export async function api(method, path, opts = {}) {
  const r = await rawRequest(method, `${API_BASE}${path}`, opts);
  if (!r.ok) throw new ApiError(r.status, r.data?.error ?? { message: typeof r.data === 'string' ? r.data : undefined });
  // Headers ride along non-enumerably so they never show up when a response is rendered as JSON.
  return Object.defineProperty({ ...r.data }, '__headers', { value: r.headers });
}

export const get = (path, opts) => api('GET', path, opts);
export const post = (path, body, opts) => api('POST', path, { ...opts, body });
export const patch = (path, body, opts) => api('PATCH', path, { ...opts, body });

export function qs(params) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, v);
  const str = s.toString();
  return str ? `?${str}` : '';
}

export const newIdempotencyKey = () => `web-${crypto.randomUUID()}`;
