import express, { Router } from 'express';
import { z } from 'zod';
import { withTransaction } from '@localstock/database';
import { authenticate, COMPANY_MANAGERS, requireCompanyRole } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { AppError } from '../../shared/errors.js';
import { validate } from '../../shared/validate.js';
import { applyImport, describePlan, planImport, validateRows } from './catalogue-import.js';
import { CsvError, parseCsv } from './csv.js';

const importQuery = z.object({ dryRun: z.enum(['true', 'false']).default('false').transform((v) => v === 'true') });
const csvBody = express.text({ type: ['text/csv', 'text/plain'], limit: '1mb' });

class InvalidImport extends Error {
  constructor(errors, summary) {
    super('invalid import');
    this.errors = errors;
    this.summary = summary;
  }
}

// dryRun=true reports changes and errors without writing; a real run is all or nothing.
export function createImportsRouter({ pool, config, redis, logger }) {
  const router = Router();
  const limiter = rateLimit(redis, logger, { keyPrefix: 'catalogue-import', limit: 20, windowSeconds: 60 });

  router.post(
    '/companies/:companyId/catalogue-imports',
    authenticate(config),
    limiter,
    requireCompanyRole(pool, COMPANY_MANAGERS),
    csvBody,
    validate({ query: importQuery }),
    async (req, res) => {
      if (typeof req.body !== 'string') {
        throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the CSV file as the request body with Content-Type: text/csv');
      }
      const { dryRun } = req.valid.query;
      const { companyId } = req.membership;

      let csvRows;
      try {
        csvRows = parseCsv(req.body).rows;
      } catch (err) {
        if (err instanceof CsvError) throw new AppError(422, 'IMPORT_INVALID', 'The CSV file could not be read', { errors: [{ line: err.line, message: err.message }] });
        throw err;
      }
      const { rows, errors } = validateRows(csvRows);
      if (errors.length) {
        if (dryRun) return res.json({ dryRun, valid: false, errors, summary: null, rows: [] });
        throw new AppError(422, 'IMPORT_INVALID', 'The file has errors; nothing was imported', { errors });
      }

      if (dryRun) {
        const plan = await planImport(pool, companyId, rows);
        return res.json({ dryRun, valid: plan.errors.length === 0, errors: plan.errors, summary: plan.summary, rows: describePlan(plan) });
      }

      try {
        const plan = await withTransaction(pool, async (client) => {
          const locked = await planImport(client, companyId, rows, { lock: true });
          if (locked.errors.length) throw new InvalidImport(locked.errors, locked.summary);
          await applyImport(client, { companyId, actorUserId: req.user.id, plan: locked });
          return locked;
        });
        res.status(201).json({ dryRun, valid: true, errors: [], summary: plan.summary, rows: describePlan(plan) });
      } catch (err) {
        if (err instanceof InvalidImport) {
          throw new AppError(422, 'IMPORT_INVALID', 'The file has errors; nothing was imported', { errors: err.errors, summary: err.summary });
        }
        throw err;
      }
    },
  );

  return router;
}
