import { AppError } from '../shared/errors.js';

const PG_ERRORS = {
  23505: [409, 'DUPLICATE', 'A record with these values already exists'],
  23503: [409, 'REFERENCE_NOT_FOUND', 'A referenced record does not exist'],
  23514: [409, 'CONSTRAINT_VIOLATION', 'The change violates a business constraint'],
  '22P02': [400, 'INVALID_INPUT', 'Invalid input value'],
};

export function errorHandler(logger) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, _next) => {
    let status = 500;
    let body = { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' };

    if (err instanceof AppError) {
      status = err.status;
      body = { code: err.code, message: err.message, details: err.details };
    } else if (err.type === 'entity.parse.failed') {
      status = 400;
      body = { code: 'MALFORMED_JSON', message: 'Request body is not valid JSON' };
    } else if (err.type === 'entity.too.large') {
      status = 413;
      body = { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' };
    } else if (err.domainCode) {
      status = 409;
      body = { code: err.domainCode, message: err.message, details: err.details };
    } else if (PG_ERRORS[err.code]) {
      const [s, code, message] = PG_ERRORS[err.code];
      status = s;
      body = { code, message, details: err.constraint ? { constraint: err.constraint } : undefined };
    }

    if (status >= 500) logger.error('request failed', { err, requestId: req.id });
    res.status(status).json({ error: { ...body, requestId: req.id } });
  };
}
