// Minimal structured JSON logger. One line per entry so logs are machine-parseable.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function serialize(fields = {}) {
  const out = { ...fields };
  if (out.err instanceof Error) {
    out.err = { name: out.err.name, message: out.err.message, code: out.err.code, stack: out.err.stack };
  }
  return out;
}

export function createLogger({ level = 'info', base = {} } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  const write = (lvl, msg, fields) => {
    if (LEVELS[lvl] < threshold) return;
    const entry = { time: new Date().toISOString(), level: lvl, msg, ...base, ...serialize(fields) };
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
