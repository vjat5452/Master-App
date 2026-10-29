// Fans persisted external change events out to live subscribers. One poller per API process
// reads external_change_events (only while someone is subscribed), so clients get what
// LocalStock has detected and stored: a push after detection, not a promise that platforms
// change in real time. Each event is sent at most once per connection; a reconnecting
// client can resume with Last-Event-ID.

const EVENT_SQL = `
  SELECT ce.id, ce.event_id, ce.entity_type, ce.query_cell, ce.old_value, ce.new_value, ce.detected_at,
         s.code AS source_code, s.name AS source_name, p.code AS platform_code, p.is_demo,
         l.external_listing_id, m.variant_id
    FROM external_change_events ce
    JOIN external_sources s ON s.id = ce.source_id
    JOIN external_platforms p ON p.id = s.platform_id
    LEFT JOIN external_listings l ON l.id = ce.listing_id
    LEFT JOIN external_product_mappings m ON m.listing_id = ce.listing_id AND m.match_status IN ('AUTO_CONFIRMED', 'CONFIRMED')`;

const toEvent = (r) => ({
  eventId: r.event_id,
  type: r.entity_type,
  sourceId: r.source_code,
  sourceName: r.source_name,
  platformCode: r.platform_code,
  isDemo: r.is_demo,
  listingId: r.external_listing_id,
  canonicalProductId: r.variant_id,
  cell: r.query_cell,
  oldValue: r.old_value,
  newValue: r.new_value,
  detectedAt: r.detected_at,
});

/** A subscriber wants events for some products and/or within a location cell prefix. */
export const matchesFilter = (event, { variantIds, cell }) =>
  (!variantIds || (event.canonicalProductId && variantIds.has(event.canonicalProductId))) &&
  (!cell || (event.cell && event.cell.startsWith(cell)));

export function createChangeFeed({ pool, logger, pollMs = 2000, maxPerUser = 3, maxTotal = 1000 }) {
  const subscribers = new Set();
  let lastId = null;
  let timer = null;
  let polling = false;

  async function poll() {
    if (polling) return;
    polling = true;
    try {
      if (lastId === null) {
        const { rows } = await pool.query('SELECT coalesce(max(id), 0) AS id FROM external_change_events');
        lastId = Number(rows[0].id);
      }
      const { rows } = await pool.query(`${EVENT_SQL} WHERE ce.id > $1 ORDER BY ce.id LIMIT 500`, [lastId]);
      for (const row of rows) {
        lastId = Number(row.id);
        const event = toEvent(row);
        for (const sub of subscribers) if (matchesFilter(event, sub.filter)) sub.send(event);
      }
    } catch (err) {
      logger.warn('change feed poll failed', { err: err.message });
    } finally {
      polling = false;
    }
  }

  const start = () => {
    if (!timer) timer = setInterval(poll, pollMs);
  };
  const stopIfIdle = () => {
    if (subscribers.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
      lastId = null; // a later subscriber starts from "now"
    }
  };

  return {
    poll,
    size: () => subscribers.size,
    canSubscribe(userId) {
      if (subscribers.size >= maxTotal) return false;
      return [...subscribers].filter((s) => s.userId === userId).length < maxPerUser;
    },

    /**
     * @param {{ userId, filter: { variantIds?: Set<string>, cell?: string }, send: (event) => void, close: () => void, resumeFrom?: string }} sub
     * @returns {Promise<() => void>} unsubscribe
     */
    async subscribe(sub) {
      if (sub.resumeFrom) {
        // Replay what this client missed, then continue live.
        const { rows } = await pool.query(
          `${EVENT_SQL} WHERE ce.id > (SELECT id FROM external_change_events WHERE event_id = $1) ORDER BY ce.id LIMIT 500`,
          [sub.resumeFrom],
        );
        for (const row of rows) {
          const event = toEvent(row);
          if (matchesFilter(event, sub.filter)) sub.send(event);
        }
      }
      if (lastId === null) await poll(); // pin the starting point before going live
      subscribers.add(sub);
      start();
      return () => {
        subscribers.delete(sub);
        stopIfIdle();
      };
    },

    /** Ends every stream (server shutdown). */
    close() {
      for (const sub of subscribers) sub.close();
      subscribers.clear();
      stopIfIdle();
    },
  };
}
