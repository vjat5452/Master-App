// Builds the real API against the isolated *_test database (see
// @localstock/database/test-support) for DB-backed HTTP tests. Redis is an in-memory stand-in.
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import jwt from 'jsonwebtoken';
import { createLogger } from '@localstock/logger';
import { prepareTestDatabase, testDatabaseUrl } from '@localstock/database/test-support';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';

loadDotenv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

export const dbTestsEnabled = process.env.RUN_DB_TESTS === '1' && Boolean(testDatabaseUrl());

function memoryRedis() {
  const store = new Map();
  return {
    ping: async () => 'PONG',
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => {
      store.set(k, v);
      return 'OK';
    },
    incr: async (k) => {
      const next = Number(store.get(k) ?? 0) + 1;
      store.set(k, String(next));
      return next;
    },
    expire: async () => 1,
    // Search results are cached by version; tests clear it to read fresh data.
    flush: () => store.clear(),
  };
}

/** @param {{ connectors?: object }} [opts] external source registry (default: all disabled) */
export async function createTestApi({ connectors } = {}) {
  const pool = await prepareTestDatabase({ max: 10 });
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: testDatabaseUrl(),
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: 'test-secret-that-is-at-least-32-characters-long',
    PAYMENT_WEBHOOK_SECRET: 'test-webhook-secret',
  });
  const redis = memoryRedis();
  const app = createApp({ config, logger: createLogger({ level: 'silent' }), pool, redis, state: { shuttingDown: false }, connectors });

  const one = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);

  async function createUser(role = 'USER') {
    const tag = randomUUID().slice(0, 8);
    const user = await one(`INSERT INTO users (name, email, password_hash, platform_role) VALUES ($1, $2, 'x', $3) RETURNING id`, [
      `user ${tag}`,
      `${tag}@test.local`,
      role,
    ]);
    const token = jwt.sign({ role }, config.JWT_ACCESS_SECRET, { subject: user.id, issuer: 'localstock', expiresIn: 600 });
    return { id: user.id, auth: `Bearer ${token}` };
  }

  async function createGroup() {
    const tag = randomUUID().slice(0, 8);
    const category = await one(`INSERT INTO categories (name, slug) VALUES ('Dairy', $1) RETURNING id`, [`dairy-${tag}`]);
    return one(`INSERT INTO product_groups (category_id, name) VALUES ($1, 'Milk') RETURNING id`, [category.id]);
  }

  return { pool, app, redis, one, createUser, createGroup };
}
