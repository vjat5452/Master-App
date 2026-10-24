import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { validate } from '../../shared/validate.js';
import { createAuthService } from './auth.service.js';

const email = z.string().trim().toLowerCase().email().max(254);
const registerBody = z.object({
  name: z.string().trim().min(1).max(120),
  email,
  password: z.string().min(10, 'Password must be at least 10 characters').max(200),
});
const loginBody = z.object({ email, password: z.string().min(1).max(200) });
const refreshBody = z.object({ refreshToken: z.string().min(20).max(200) });

export function createAuthRouter(deps) {
  const router = Router();
  const service = createAuthService(deps);
  const limiter = rateLimit(deps.redis, deps.logger, { keyPrefix: 'auth', limit: 20, windowSeconds: 60 });

  router.post('/auth/register', limiter, validate({ body: registerBody }), async (req, res) => {
    res.status(201).json(await service.register(req.valid.body));
  });

  router.post('/auth/login', limiter, validate({ body: loginBody }), async (req, res) => {
    res.json(await service.login(req.valid.body));
  });

  router.post('/auth/refresh', limiter, validate({ body: refreshBody }), async (req, res) => {
    res.json(await service.refresh(req.valid.body.refreshToken));
  });

  router.post('/auth/logout', validate({ body: refreshBody }), async (req, res) => {
    await service.logout(req.valid.body.refreshToken);
    res.status(204).end();
  });

  router.get('/users/me', authenticate(deps.config), async (req, res) => {
    res.json(await service.me(req.user.id));
  });

  return router;
}
