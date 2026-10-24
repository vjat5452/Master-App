import { z } from 'zod';
import { AppError } from './errors.js';

// Parse and normalize request parts before business logic. Parsed values land on req.valid.
export function validate(schemas) {
  return (req, _res, next) => {
    const valid = {};
    for (const part of ['params', 'query', 'body']) {
      if (!schemas[part]) continue;
      const result = schemas[part].safeParse(req[part] ?? {});
      if (!result.success) {
        const issues = result.error.issues.map((i) => ({ path: [part, ...i.path].join('.'), message: i.message }));
        return next(new AppError(400, 'VALIDATION_FAILED', 'Request validation failed', issues));
      }
      valid[part] = result.data;
    }
    req.valid = valid;
    next();
  };
}

export const uuid = z.string().uuid();
export const idParams = (...names) => z.object(Object.fromEntries(names.map((n) => [n, uuid])));
export const point = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
export const pagination = {
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
};
