import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { withTransaction } from '@localstock/database';
import { AppError, conflict, notFound } from '../../shared/errors.js';
import { hashPassword, verifyPassword } from './passwords.js';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const invalidRefresh = () => new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired');

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, platformRole: u.platform_role });

export function createAuthService({ pool, config }) {
  // Verifying against a real hash when the email is unknown keeps login timing uniform.
  const dummyHash = hashPassword(randomBytes(16).toString('hex'));

  async function issueTokens(db, user) {
    const accessToken = jwt.sign({ role: user.platform_role }, config.JWT_ACCESS_SECRET, {
      subject: user.id,
      expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
      issuer: 'localstock',
      algorithm: 'HS256',
    });
    const refreshToken = randomBytes(32).toString('base64url');
    const { rows } = await db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + make_interval(days => $3::int)) RETURNING id`,
      [user.id, sha256(refreshToken), config.REFRESH_TOKEN_TTL_DAYS],
    );
    return {
      refreshTokenId: rows[0].id,
      tokens: { accessToken, refreshToken, tokenType: 'Bearer', expiresIn: config.ACCESS_TOKEN_TTL_SECONDS },
    };
  }

  return {
    async register({ name, email, password }) {
      const passwordHash = await hashPassword(password);
      return withTransaction(pool, async (client) => {
        const { rows } = await client.query(
          `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING
           RETURNING id, name, email, platform_role`,
          [name, email, passwordHash],
        );
        if (rows.length === 0) throw conflict('EMAIL_TAKEN', 'An account with this email already exists');
        const { tokens } = await issueTokens(client, rows[0]);
        return { user: publicUser(rows[0]), ...tokens };
      });
    },

    async login({ email, password }) {
      const { rows } = await pool.query(
        'SELECT id, name, email, password_hash, platform_role, status FROM users WHERE lower(email) = lower($1)',
        [email],
      );
      const user = rows[0];
      const valid = await verifyPassword(password, user?.password_hash ?? (await dummyHash));
      if (!user || !valid || user.status !== 'ACTIVE') {
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
      }
      const { tokens } = await issueTokens(pool, user);
      return { user: publicUser(user), ...tokens };
    },

    // Rotating refresh tokens: each use issues a new one. Presenting an already-rotated token
    // means it leaked, so every session of that user is revoked.
    async refresh(refreshToken) {
      const result = await withTransaction(pool, async (client) => {
        const { rows } = await client.query(
          `SELECT t.id, t.user_id, t.expires_at, t.revoked_at, u.name, u.email, u.platform_role, u.status
             FROM refresh_tokens t JOIN users u ON u.id = t.user_id
            WHERE t.token_hash = $1
            FOR UPDATE OF t`,
          [sha256(refreshToken)],
        );
        const row = rows[0];
        if (!row) throw invalidRefresh();
        if (row.revoked_at) {
          await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [row.user_id]);
          return { reuseDetected: true };
        }
        if (row.expires_at < new Date() || row.status !== 'ACTIVE') throw invalidRefresh();

        const user = { id: row.user_id, name: row.name, email: row.email, platform_role: row.platform_role };
        const { tokens, refreshTokenId } = await issueTokens(client, user);
        await client.query('UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2 WHERE id = $1', [row.id, refreshTokenId]);
        return { user: publicUser(user), ...tokens };
      });
      // Thrown after commit so the family revocation above is kept.
      if (result.reuseDetected) throw invalidRefresh();
      return result;
    },

    async logout(refreshToken) {
      await pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [sha256(refreshToken)]);
    },

    async me(userId) {
      const { rows } = await pool.query('SELECT id, name, email, platform_role FROM users WHERE id = $1', [userId]);
      if (!rows[0]) throw notFound('USER_NOT_FOUND', 'User not found');
      const { rows: memberships } = await pool.query(
        `SELECT c.id AS company_id, c.name AS company_name, m.role
           FROM company_members m JOIN companies c ON c.id = m.company_id
          WHERE m.user_id = $1 ORDER BY c.name`,
        [userId],
      );
      return {
        ...publicUser(rows[0]),
        memberships: memberships.map((m) => ({ companyId: m.company_id, companyName: m.company_name, role: m.role })),
      };
    },
  };
}
