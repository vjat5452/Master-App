import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

loadDotenv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

const schema = z.object({
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  RABBITMQ_URL: z.string().url(),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  RESERVATION_EXPIRY_INTERVAL_MS: z.coerce.number().int().positive().default(15_000),
  RECONCILIATION_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),
});

export function loadConfig(env = process.env) {
  const result = schema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
