// Cross-platform comparison (POST /discovery/compare) and its live change feed
// (GET /discovery/stream, server-sent events). EventSource cannot send an Authorization
// header, so the stream is read with fetch.
import { useEffect, useRef, useState } from 'react';
import { API_BASE, getTokens, post } from './api';

export const RANKING_POLICIES = [
  { id: 'best_value', label: 'Best value' },
  { id: 'lowest_price', label: 'Lowest price' },
  { id: 'fastest', label: 'Fastest' },
  { id: 'nearest', label: 'Nearest' },
];

export const compareOffers = ({ query, location, rankingPolicy = 'best_value', refreshPolicy = 'prefer_fresh', radiusKm = 20 }) =>
  post(
    '/discovery/compare',
    { query, location: { latitude: location.lat, longitude: location.lng }, radiusKm, rankingPolicy, refreshPolicy, limit: 20 },
    { auth: false },
  );

/**
 * Calls onEvent for each change LocalStock detects for these products/area while mounted.
 * Needs a signed-in user; reconnects after drops and resumes with Last-Event-ID.
 * @returns {'off'|'connecting'|'live'}
 */
export function useChangeStream({ enabled, variantIds = [], cell, onEvent }) {
  const [state, setState] = useState('off');
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const key = `${enabled}|${variantIds.join(',')}|${cell ?? ''}`;

  useEffect(() => {
    if (!enabled || (!variantIds.length && !cell)) {
      setState('off');
      return undefined;
    }
    const controller = new AbortController();
    let lastEventId;
    let retry;

    const params = new URLSearchParams();
    if (variantIds.length) params.set('variantIds', variantIds.join(','));
    if (cell) params.set('cell', cell);

    async function connect() {
      setState('connecting');
      try {
        const headers = { Accept: 'text/event-stream', Authorization: `Bearer ${getTokens()?.accessToken}` };
        if (lastEventId) headers['Last-Event-ID'] = lastEventId;
        const res = await fetch(`${API_BASE}/discovery/stream?${params}`, { headers, signal: controller.signal });
        if (res.status === 401 || res.status === 403) return setState('off');
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
        setState('live');
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          let at;
          while ((at = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, at);
            buffer = buffer.slice(at + 2);
            const id = block.match(/^id: (.+)$/m)?.[1];
            const data = block.match(/^data: (.+)$/m)?.[1];
            if (id) lastEventId = id;
            if (data) handler.current?.(JSON.parse(data));
          }
        }
      } catch (err) {
        if (controller.signal.aborted) return undefined;
      }
      if (!controller.signal.aborted) {
        setState('connecting');
        retry = setTimeout(connect, 5000);
      }
      return undefined;
    }
    connect();
    return () => {
      controller.abort();
      clearTimeout(retry);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
