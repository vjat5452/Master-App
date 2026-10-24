import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { AppError } from '../../shared/errors.js';
import { idParams, validate } from '../../shared/validate.js';
import { cartBody } from '../checkout/checkout.routes.js';
import { createOrdersService } from './orders.service.js';

const IDEMPOTENCY_KEY = /^[\w-]{8,128}$/;

export function createOrdersRouter(deps) {
  const router = Router();
  const service = createOrdersService(deps);
  const auth = authenticate(deps.config);
  const limiter = rateLimit(deps.redis, deps.logger, { keyPrefix: 'checkout', limit: 30, windowSeconds: 60 });

  router.post('/orders', auth, limiter, validate({ body: cartBody }), async (req, res) => {
    const key = req.get('idempotency-key');
    if (!key || !IDEMPOTENCY_KEY.test(key)) {
      throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key header (8-128 characters: letters, digits, _ or -)');
    }
    const result = await service.createOrder(req.user.id, key, req.valid.body);
    if (result.replayed) res.set('Idempotent-Replayed', 'true');
    res.status(result.status).json(result.body);
  });

  router.get('/orders', auth, async (req, res) => {
    res.json(await service.listOrders(req.user.id));
  });

  router.get('/orders/:orderId', auth, validate({ params: idParams('orderId') }), async (req, res) => {
    res.json(await service.getOrder(req.user.id, req.valid.params.orderId));
  });

  router.post('/orders/:orderId/cancel', auth, validate({ params: idParams('orderId') }), async (req, res) => {
    res.json(await service.cancelOrder(req.user.id, req.valid.params.orderId));
  });

  return router;
}
