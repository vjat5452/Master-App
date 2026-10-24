import { AppError } from '../shared/errors.js';

// Fixed-window limiter in Redis. Fails open: a Redis outage must not take login or checkout down.
export function rateLimit(redis, logger, { keyPrefix, limit, windowSeconds }) {
  return async (req, res, next) => {
    const window = Math.floor(Date.now() / 1000 / windowSeconds);
    const key = `ratelimit:${keyPrefix}:${req.ip}:${window}`;
    try {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, windowSeconds);
      if (count > limit) {
        res.set('Retry-After', String(windowSeconds));
        return next(new AppError(429, 'RATE_LIMITED', 'Too many requests, slow down'));
      }
    } catch (err) {
      logger.debug('rate limiter unavailable, allowing request', { err: err.message });
    }
    next();
  };
}
