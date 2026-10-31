// Minimal structured JSON logger. One line per entry so logs are machine-parseable.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export const REDACTED = '[REDACTED]';

// Keys are normalized (case, "_", "-"); SECRET_PARTS match as substrings, PERSONAL_KEYS exactly.
const SECRET_PARTS = ['password', 'passwd', 'secret', 'token', 'authorization', 'cookie', 'apikey', 'privatekey', 'signature', 'credential'];
const PERSONAL_KEYS = new Set(['email', 'phone', 'contactphone', 'lat', 'lng', 'latitude', 'longitude', 'location', 'address', 'line1', 'line2']);
const MAX_DEPTH = 6;

const normalizeKey = (key) => key.toLowerCase().replace(/[_-]/g, '');

export function isSensitiveKey(key) {
  const k = normalizeKey(key);
  return PERSONAL_KEYS.has(k) || SECRET_PARTS.some((part) => k.includes(part));
}

export function redact(value, depth = 0) {
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out = {};
  for (const [key, v] of Object.entries(value)) out[key] = isSensitiveKey(key) ? REDACTED : redact(v, depth + 1);
  return out;
}

function serialize(fields = {}) {
  const out = { ...fields };
  if (out.err instanceof Error) {
    out.err = { name: out.err.name, message: out.err.message, code: out.err.code, stack: out.err.stack };
  }
  return redact(out);
}

export function createLogger({ level = 'info', base = {} } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  const write = (lvl, msg, fields) => {
    if (LEVELS[lvl] < threshold) return;
    const entry = { time: new Date().toISOString(), level: lvl, msg, ...redact(base), ...serialize(fields) };
    const stream = lvl === 'error' || lvl === 'warn' ? process.stderr : process.stdout;
    stream.write(JSON.stringify(entry) + '\n');
  };

  return {
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
    child: (extra) => createLogger({ level, base: { ...base, ...extra } }),
  };
}
