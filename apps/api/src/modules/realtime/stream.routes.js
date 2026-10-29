import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { AppError } from '../../shared/errors.js';
import { validate } from '../../shared/validate.js';

const HEARTBEAT_MS = 25_000;

const streamQuery = z
  .object({
    // Comma-separated LocalStock product variant ids (up to 50).
    variantIds: z
      .string()
      .optional()
      .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined))
      .pipe(z.array(z.string().uuid()).min(1).max(50).optional()),
    // Geohash cell prefix (1-6 characters), e.g. the cell returned by /discovery/compare.
    cell: z.string().regex(/^[0-9b-hjkmnp-z]{1,6}$/).optional(),
  })
  .refine((q) => q.variantIds || q.cell, 'Subscribe by variantIds and/or cell');

/**
 * GET /discovery/stream: server-sent events with external price, availability,
 * serviceability and source-health changes that LocalStock has detected and stored.
 * Authenticated; at most a few streams per user.
 */
export function createStreamRouter({ config, changeFeed }) {
  const router = Router();

  router.get('/discovery/stream', authenticate(config), validate({ query: streamQuery }), async (req, res) => {
    if (!changeFeed.canSubscribe(req.user.id)) {
      throw new AppError(429, 'TOO_MANY_STREAMS', 'Too many open streams; close one first');
    }
    const { variantIds, cell } = req.valid.query;

    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(`retry: 5000\n: subscribed\n\n`);

    const send = (event) => res.write(`id: ${event.eventId}\nevent: change\ndata: ${JSON.stringify(event)}\n\n`);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    let unsubscribe = () => {};
    const end = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.on('close', end);

    unsubscribe = await changeFeed.subscribe({
      userId: req.user.id,
      filter: { variantIds: variantIds && new Set(variantIds), cell },
      send,
      close: () => {
        end();
        res.end();
      },
      resumeFrom: /^[0-9a-f-]{36}$/i.test(req.get('last-event-id') ?? '') ? req.get('last-event-id') : undefined,
    });
    if (res.writableEnded || req.destroyed) unsubscribe();
  });

  return router;
}
