// Minimal Prometheus metrics (text exposition format 0.0.4) without a dependency:
// counters, histograms and gauges whose value is read at scrape time. Label values must
// come from small fixed sets (route patterns, status codes, source codes), never from user
// input, so the number of series stays bounded.

const escapeLabel = (v) => String(v).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
const labelText = (labels) => {
  const entries = Object.entries(labels);
  return entries.length ? `{${entries.map(([k, v]) => `${k}="${escapeLabel(v)}"`).join(',')}}` : '';
};
// Labels are stored sorted by name, so one series always renders the same way.
const canonical = (labels) => Object.fromEntries(Object.entries(labels).sort(([a], [b]) => (a < b ? -1 : 1)));
const keyOf = (labels) => JSON.stringify(Object.entries(canonical(labels)));

export const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export function createRegistry({ prefix = 'localstock_' } = {}) {
  const metrics = [];

  function counter(name, help) {
    const values = new Map();
    const m = {
      inc(labels = {}, by = 1) {
        const k = keyOf(labels);
        const cur = values.get(k);
        values.set(k, { labels: canonical(labels), value: (cur?.value ?? 0) + by });
      },
      async render() {
        const lines = [`# HELP ${prefix}${name} ${help}`, `# TYPE ${prefix}${name} counter`];
        for (const { labels, value } of values.values()) lines.push(`${prefix}${name}${labelText(labels)} ${value}`);
        return lines;
      },
    };
    metrics.push(m);
    return m;
  }

  function histogram(name, help, buckets = DEFAULT_BUCKETS) {
    const series = new Map();
    const m = {
      observe(labels, value) {
        const k = keyOf(labels);
        if (!series.has(k)) series.set(k, { labels: canonical(labels), counts: buckets.map(() => 0), sum: 0, count: 0 });
        const s = series.get(k);
        buckets.forEach((b, i) => {
          if (value <= b) s.counts[i] += 1;
        });
        s.sum += value;
        s.count += 1;
      },
      async render() {
        const lines = [`# HELP ${prefix}${name} ${help}`, `# TYPE ${prefix}${name} histogram`];
        for (const s of series.values()) {
          buckets.forEach((b, i) => lines.push(`${prefix}${name}_bucket${labelText({ ...s.labels, le: b })} ${s.counts[i]}`));
          lines.push(`${prefix}${name}_bucket${labelText({ ...s.labels, le: '+Inf' })} ${s.count}`);
          lines.push(`${prefix}${name}_sum${labelText(s.labels)} ${s.sum}`);
          lines.push(`${prefix}${name}_count${labelText(s.labels)} ${s.count}`);
        }
        return lines;
      },
    };
    metrics.push(m);
    return m;
  }

  /** Gauge read at scrape time: collect() returns [{ labels, value }] or a number. */
  function gauge(name, help, collect) {
    const m = {
      async render() {
        const lines = [`# HELP ${prefix}${name} ${help}`, `# TYPE ${prefix}${name} gauge`];
        let out;
        try {
          out = await collect();
        } catch {
          return lines; // a failing collector must not break the whole scrape
        }
        for (const { labels = {}, value } of typeof out === 'number' ? [{ value: out }] : out) lines.push(`${prefix}${name}${labelText(labels)} ${value}`);
        return lines;
      },
    };
    metrics.push(m);
    return m;
  }

  // Process basics, always present.
  const started = Date.now();
  gauge('process_uptime_seconds', 'Seconds since the process started', () => Math.round((Date.now() - started) / 1000));
  gauge('process_heap_used_bytes', 'V8 heap in use', () => process.memoryUsage().heapUsed);
  gauge('process_rss_bytes', 'Resident set size', () => process.memoryUsage().rss);

  return {
    counter,
    histogram,
    gauge,
    contentType: 'text/plain; version=0.0.4; charset=utf-8',
    async render() {
      const parts = await Promise.all(metrics.map((m) => m.render()));
      return `${parts.flat().join('\n')}\n`;
    },
  };
}

/**
 * Who may read metrics: with a token configured, only requests carrying it; without one,
 * only outside production (so metrics are never accidentally public).
 */
export function metricsAccess({ token, production }) {
  return (authorizationHeader) => {
    if (token) return authorizationHeader === `Bearer ${token}`;
    return !production;
  };
}
