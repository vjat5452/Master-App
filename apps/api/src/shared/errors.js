export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have permission for this action') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (code, message) => new AppError(404, code, message);
export const conflict = (code, message, details) => new AppError(409, code, message, details);
