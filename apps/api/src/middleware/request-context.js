import { randomUUID } from 'node:crypto';

const SAFE_ID = /^[\w.-]{1,128}$/;

export function requestId() {
  return (req, res, next) => {
    const incoming = req.get('x-request-id');
    req.id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
    res.set('x-request-id', req.id);
    next();
  };
}

export function requestLogger(logger) {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      logger.info('request', {
        requestId: req.id,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        durationMs: Number(process.hrtime.bigint() - start) / 1e6,
        userId: req.user?.id,
      });
    });
    next();
  };
}
