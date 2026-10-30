import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from '../../middleware/rate-limit.js';
import { AppError } from '../../shared/errors.js';
import { validate } from '../../shared/validate.js';
import { createCompareService } from './compare.service.js';
import { POLICIES } from './ranking.js';

const compareBody = z.object({
  query: z.string().trim().min(1).max(200),
  location: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }),
  radiusKm: z.number().positive().max(50).default(5),
  includeLocalVendors: z.boolean().default(true),
  // Omitted: every platform LocalStock knows about.
  platforms: z.array(z.string().regex(/^[a-z0-9-]{2,50}$/)).max(10).optional(),
  // cache_only: never call sources. prefer_fresh: reuse a recent answer, else call.
  // refresh_supported: call every enabled source (still within its rate limit).
  refreshPolicy: z.enum(['cache_only', 'prefer_fresh', 'refresh_supported']).default('prefer_fresh'),
  limit: z.number().int().min(1).max(50).default(20),
  // Weighted ordering after the hard rules (size, availability); see ranking.js.
  rankingPolicy: z.enum(POLICIES).default('best_value'),
});

// POST /discovery/compare: public, like catalog search. Only public offer data is returned.
export function createCompareRouter(deps) {
  const router = Router();
  const service = createCompareService(deps);
  const limiter = rateLimit(deps.redis, deps.logger, { keyPrefix: 'compare', limit: 60, windowSeconds: 60 });

  router.post('/discovery/compare', limiter, validate({ body: compareBody }), async (req, res) => {
    const body = req.valid.body;
    if (body.platforms) {
      const known = new Set(service.platformCodes());
      const unknown = body.platforms.filter((p) => !known.has(p));
      if (unknown.length) {
        throw new AppError(400, 'UNKNOWN_PLATFORM', `Unknown platform(s): ${unknown.join(', ')}`, { known: [...known] });
      }
    }
    res.json(await service.compare(body, { requestId: req.id }));
  });

  return router;
}
