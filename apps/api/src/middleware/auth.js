import jwt from 'jsonwebtoken';
import { AppError, forbidden, unauthorized } from '../shared/errors.js';

export const COMPANY_ROLES = Object.freeze(['OWNER', 'ADMIN', 'STAFF']);
export const COMPANY_MANAGERS = Object.freeze(['OWNER', 'ADMIN']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function authenticate(config) {
  return (req, _res, next) => {
    const [scheme, token] = (req.get('authorization') ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) return next(unauthorized());
    try {
      const payload = jwt.verify(token, config.JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: 'localstock' });
      req.user = { id: payload.sub, platformRole: payload.role };
      next();
    } catch {
      next(new AppError(401, 'INVALID_TOKEN', 'Access token is invalid or expired'));
    }
  };
}

export function requirePlatformAdmin(req, _res, next) {
  next(req.user?.platformRole === 'ADMIN' ? undefined : forbidden());
}

// Tenant check for every /companies/:companyId route. Non-members get 404 so company ids
// cannot be probed.
export function requireCompanyRole(pool, roles = COMPANY_ROLES) {
  return async (req, _res, next) => {
    const { companyId } = req.params;
    if (!UUID_RE.test(companyId ?? '')) return next(new AppError(400, 'VALIDATION_FAILED', 'Invalid companyId'));

    const { rows } = await pool.query(
      `SELECT m.role FROM company_members m
         JOIN companies c ON c.id = m.company_id
        WHERE m.company_id = $1 AND m.user_id = $2 AND c.status = 'ACTIVE'`,
      [companyId, req.user.id],
    );
    if (rows.length === 0) return next(new AppError(404, 'COMPANY_NOT_FOUND', 'Company not found'));
    if (!roles.includes(rows[0].role)) return next(forbidden());

    req.membership = { companyId, role: rows[0].role };
    next();
  };
}
