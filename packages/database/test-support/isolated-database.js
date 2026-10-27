// Integration tests run against their own database, never the dev one. The target is
// TEST_DATABASE_URL, or DATABASE_URL with "_test" appended to the database name. It is
// created and migrated on demand, and emptied before each run.
import pg from 'pg';
import { createPool, migrate } from '../src/index.js';

const SAFE_NAME = /^[a-z0-9_]+_test$/;

export function testDatabaseUrl(env = process.env) {
  if (env.TEST_DATABASE_URL) return env.TEST_DATABASE_URL;
  if (!env.DATABASE_URL) return undefined;
  const url = new URL(env.DATABASE_URL);
  url.pathname = `/${url.pathname.slice(1)}_test`;
  return url.toString();
}

async function ensureDatabaseExists(url) {
  const name = new URL(url).pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    // The name is checked against SAFE_NAME before we get here, so quoting it is enough.
    if (rowCount === 0) await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }
}

/** Returns a pool on a freshly migrated, empty test database. */
export async function prepareTestDatabase({ max = 20 } = {}) {
  const url = testDatabaseUrl();
  const name = new URL(url).pathname.slice(1);
  if (!SAFE_NAME.test(name)) {
    throw new Error(`Refusing to run database tests against "${name}": the database name must end in "_test".`);
  }

  await ensureDatabaseExists(url);
  const pool = createPool(url, { max });
  await migrate(pool);

  const { rows } = await pool.query(
    `SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename NOT IN ('schema_migrations', 'spatial_ref_sys')`,
  );
  if (rows.length) await pool.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  return pool;
}
