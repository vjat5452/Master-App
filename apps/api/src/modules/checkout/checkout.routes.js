import { Router } from 'express';
import { z } from 'zod';
import { allocate } from '@localstock/allocation-engine';
import { authenticate } from '../../middleware/auth.js';
import { point, validate } from '../../shared/validate.js';
import { loadAllocationInput, presentPlan } from './allocation-input.js';

export const cartBody = z.object({
  location: point,
  items: z
    .array(z.object({ variantId: z.string().uuid(), quantity: z.number().int().min(1).max(100) }))
    .min(1)
    .max(50),
  preferences: z
    .object({
      allowSplit: z.boolean().default(true),
      preferSingleWarehouse: z.boolean().default(true),
      sort: z.enum(['best_value', 'lowest_price', 'fastest']).default('best_value'),
    })
    .prefault({}),
});

export function createCheckoutRouter({ pool, config }) {
  const router = Router();

  // Advisory only: a quote never reserves stock. Reservation happens in POST /orders.
  router.post('/checkout/quote', authenticate(config), validate({ body: cartBody }), async (req, res) => {
    const input = req.valid.body;
    const data = await loadAllocationInput(pool, input, { maxCandidateRadiusKm: config.MAX_CANDIDATE_RADIUS_KM });
    const result = allocate({ items: input.items, ...data, preferences: input.preferences });

    if (result.status !== 'OK') {
      return res.json({ status: result.status, reason: result.reason, shortages: result.shortages, plans: [] });
    }
    res.json({
      status: 'OK',
      best: presentPlan(result.best),
      alternatives: result.plans.slice(1, 5).map(presentPlan),
    });
  });

  return router;
}
