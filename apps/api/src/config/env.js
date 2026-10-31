import { parseFreshnessConfig } from '@localstock/external-data';
import { parseRankingWeights } from '../modules/discovery/ranking.js';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  API_PORT: z.coerce.number().int().positive().default(5000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  RESERVATION_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  MAX_CANDIDATE_RADIUS_KM: z.coerce.number().positive().default(50),
  PAYMENT_WEBHOOK_SECRET: z.string().min(16),
  // Upper bound for a whole /discovery/compare request; slower sources are reported as TIMEOUT.
  COMPARE_DEADLINE_MS: z.coerce.number().int().min(200).max(30_000).default(5000),
  // Bearer token for GET /metrics. Without it, /metrics only answers outside production.
  METRICS_TOKEN: z.string().min(16).optional(),
  // Sandbox payments under NODE_ENV=production (public demo only); always on outside production.
  ENABLE_SANDBOX_PAYMENTS: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  // Trusted reverse proxies (2 for Vercel -> Render). Set too high, a direct caller can pick
  // the address it is rate-limited under.
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  // Per-policy ranking weights (JSON); see modules/discovery/ranking.js.
  COMPARE_RANKING_WEIGHTS: z
    .string()
    .optional()
    .transform((text, ctx) => {
      try {
        return parseRankingWeights(text);
      } catch (err) {
        ctx.addIssue({ code: 'custom', message: err.message });
        return z.NEVER;
      }
    }),
  // Per-source freshness overrides (JSON); see @localstock/external-data freshness.js.
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

// Fail fast at startup rather than on the first request that needs a missing setting.
export function loadConfig(env = process.env) {
  // Hosting platforms (Railway, Render, Fly) assign the port through PORT.
  const result = schema.safeParse(env.API_PORT === undefined && env.PORT !== undefined ? { ...env, API_PORT: env.PORT } : env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
