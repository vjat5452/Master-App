import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { parseFreshnessConfig } from '@localstock/external-data';

loadDotenv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

const schema = z.object({
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  RABBITMQ_URL: z.string().url(),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  RESERVATION_EXPIRY_INTERVAL_MS: z.coerce.number().int().positive().default(15_000),
  RECONCILIATION_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),
  // Background collection from external sources (only sources that are configured).
  EXTERNAL_REFRESH_INTERVAL_MS: z.coerce.number().int().min(5000).default(60_000),
  EXTERNAL_HEALTH_INTERVAL_MS: z.coerce.number().int().min(10_000).default(300_000),
  EXTERNAL_COLLECTION_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  // Data retention (see @localstock/external-data retention.js).
  EXTERNAL_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  EVENT_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  RETENTION_INTERVAL_MS: z.coerce.number().int().min(60_000).default(3_600_000),
  // Optional HTTP port for /metrics and /health/live. METRICS_TOKEN protects /metrics.
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  WORKER_METRICS_PORT: z.coerce.number().int().positive().optional(),
  METRICS_TOKEN: z.string().min(16).optional(),
  EXTERNAL_FRESHNESS: z
    .string()
    .optional()
    .transform((text, ctx) => {
      try {
        return parseFreshnessConfig(text);
      } catch (err) {
        ctx.addIssue({ code: 'custom', message: err.message });
        return z.NEVER;
      }
    }),
});

export function loadConfig(env = process.env) {
  const result = schema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
