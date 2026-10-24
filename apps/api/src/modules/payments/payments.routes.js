import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { AppError, notFound } from '../../shared/errors.js';
import { validate } from '../../shared/validate.js';
import { createPaymentsService } from './payments.service.js';

const SIGNATURE_HEADER = 'x-sandbox-signature';

const webhookBody = z.object({
  eventId: z.string().min(1).max(200),
  providerPaymentId: z.string().min(1).max(200),
  status: z.enum(['SUCCEEDED', 'FAILED']),
});
const simulateBody = z.object({ status: z.enum(['SUCCEEDED', 'FAILED']) });

export const signSandboxPayload = (secret, rawBody) => createHmac('sha256', secret).update(rawBody).digest('hex');

function verifySignature(secret) {
  return (req, _res, next) => {
    const expected = Buffer.from(signSandboxPayload(secret, req.rawBody ?? Buffer.alloc(0)));
    const given = Buffer.from(req.get(SIGNATURE_HEADER) ?? '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return next(new AppError(401, 'INVALID_SIGNATURE', 'Webhook signature verification failed'));
    }
    next();
  };
}

export function createPaymentsRouter(deps) {
  const { pool, config } = deps;
  const router = Router();
  const service = createPaymentsService(deps);

  router.post(
    '/payments/webhooks/sandbox',
    rateLimit(deps.redis, deps.logger, { keyPrefix: 'webhook', limit: 600, windowSeconds: 60 }),
    verifySignature(config.PAYMENT_WEBHOOK_SECRET),
    validate({ body: webhookBody }),
    async (req, res) => {
      const body = req.valid.body;
      res.json(await service.processEvent({ provider: 'sandbox', ...body, payload: body }));
    },
  );

  // Development helper standing in for the provider's checkout page: the customer "pays" and
  // the sandbox delivers a webhook through the same verified code path.
  if (config.NODE_ENV !== 'production') {
    router.post('/payments/sandbox/:providerPaymentId/simulate', authenticate(config), validate({ body: simulateBody }), async (req, res) => {
      const { providerPaymentId } = req.params;
      const { rows } = await pool.query(
        `SELECT 1 FROM payments p JOIN orders o ON o.id = p.order_id
          WHERE p.provider = 'sandbox' AND p.provider_payment_id = $1 AND o.customer_id = $2`,
        [providerPaymentId, req.user.id],
      );
      if (!rows[0]) throw notFound('PAYMENT_NOT_FOUND', 'Unknown payment');
      const event = { eventId: `evt_${randomUUID()}`, providerPaymentId, status: req.valid.body.status };
      res.json({ event, result: await service.processEvent({ provider: 'sandbox', ...event, payload: event }) });
    });
  }

  return router;
}
