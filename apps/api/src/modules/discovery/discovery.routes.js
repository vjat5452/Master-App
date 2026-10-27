import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from '../../middleware/rate-limit.js';
import { pagination, validate } from '../../shared/validate.js';
import { createDiscoveryService } from './discovery.service.js';

const locationQuery = {
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().positive().max(50).default(10),
  sort: z.enum(['best_value', 'lowest_price', 'fastest', 'nearest']).default('best_value'),
};
const requireBoth = (q) => (q.lat == null) === (q.lng == null);

const searchQuery = z
  .object({
    q: z.string().trim().max(200).default(''),
    category: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{0,100}$/).default(''),
    ...locationQuery,
    ...pagination,
  })
  .refine(requireBoth, 'lat and lng must be provided together');
const offersQuery = z.object(locationQuery).refine(requireBoth, 'lat and lng must be provided together');

export function createDiscoveryRouter(deps) {
  const router = Router();
  const service = createDiscoveryService(deps);
  const limiter = rateLimit(deps.redis, deps.logger, { keyPrefix: 'search', limit: 300, windowSeconds: 60 });

  router.get('/catalog/search', limiter, validate({ query: searchQuery }), async (req, res) => {
    res.json(await service.search(req.valid.query));
  });

  router.get(
    '/catalog/variants/:variantId/offers',
    validate({ params: z.object({ variantId: z.string().uuid() }), query: offersQuery }),
    async (req, res) => {
      res.json(await service.variantOffers({ variantId: req.valid.params.variantId, ...req.valid.query }));
    },
  );

  return router;
}
