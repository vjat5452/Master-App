import { Router } from 'express';
import { z } from 'zod';
import { withTransaction } from '@localstock/database';
import { authenticate, COMPANY_MANAGERS, requireCompanyRole } from '../../middleware/auth.js';
import { writeAudit } from '../../shared/audit.js';
import { conflict, notFound } from '../../shared/errors.js';
import { validate } from '../../shared/validate.js';

const createCompanyBody = z.object({
  name: z.string().trim().min(2).max(200),
  registrationNumber: z.string().trim().max(100).optional(),
});
const addMemberBody = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(['ADMIN', 'STAFF']),
});

export function createOrganizationsRouter({ pool, config }) {
  const router = Router();
  router.use('/companies', authenticate(config));

  router.post('/companies', validate({ body: createCompanyBody }), async (req, res) => {
    const { name, registrationNumber } = req.valid.body;
    const company = await withTransaction(pool, async (client) => {
      const { rows } = await client.query(
        'INSERT INTO companies (name, registration_number) VALUES ($1, $2) RETURNING id, name, registration_number, status, created_at',
        [name, registrationNumber ?? null],
      );
      await client.query(`INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, 'OWNER')`, [rows[0].id, req.user.id]);
      await writeAudit(client, { actorUserId: req.user.id, companyId: rows[0].id, action: 'company.created', entityType: 'company', entityId: rows[0].id, after: rows[0] });
      return rows[0];
    });
    res.status(201).json({
      id: company.id,
      name: company.name,
      registrationNumber: company.registration_number,
      status: company.status,
      role: 'OWNER',
    });
  });

  router.get('/companies', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.status, m.role
         FROM company_members m JOIN companies c ON c.id = m.company_id
        WHERE m.user_id = $1 ORDER BY c.name`,
      [req.user.id],
    );
    res.json({ items: rows });
  });

  router.post(
    '/companies/:companyId/members',
    requireCompanyRole(pool, COMPANY_MANAGERS),
    validate({ body: addMemberBody }),
    async (req, res) => {
      const { email, role } = req.valid.body;
      const { companyId } = req.membership;
      const member = await withTransaction(pool, async (client) => {
        const { rows: users } = await client.query('SELECT id, name, email FROM users WHERE lower(email) = $1', [email]);
        if (!users[0]) throw notFound('USER_NOT_FOUND', 'No user with that email; they must register first');
        const { rows } = await client.query(
          `INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, $3)
           ON CONFLICT (company_id, user_id) DO NOTHING RETURNING id, role`,
          [companyId, users[0].id, role],
        );
        if (!rows[0]) throw conflict('ALREADY_MEMBER', 'User is already a member of this company');
        await writeAudit(client, { actorUserId: req.user.id, companyId, action: 'member.added', entityType: 'company_member', entityId: rows[0].id, after: { userId: users[0].id, role } });
        return { userId: users[0].id, name: users[0].name, email: users[0].email, role };
      });
      res.status(201).json(member);
    },
  );

  router.get('/companies/:companyId/members', requireCompanyRole(pool), async (req, res) => {
    const { rows } = await pool.query(
      `SELECT u.id AS "userId", u.name, u.email, m.role
         FROM company_members m JOIN users u ON u.id = m.user_id
        WHERE m.company_id = $1 ORDER BY m.created_at`,
      [req.membership.companyId],
    );
    res.json({ items: rows });
  });

  return router;
}
