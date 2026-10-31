import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DIR = fileURLToPath(new URL('../migrations', import.meta.url));
// Advisory lock id so concurrent migrators (e.g. two deploys) serialize.
const MIGRATION_LOCK_ID = 727274;

// Optional `NNN_name.down.sql` reverses `NNN_name.sql` and is only run by rollback().
const isDown = (f) => f.endsWith('.down.sql');
const downFileFor = (name) => name.replace(/\.sql$/, '.down.sql');

async function withMigrationLock(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    return await fn(client);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
  }
}

async function runInTransaction(client, label, sql, after) {
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await after();
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    err.message = `${label} failed: ${err.message}`;
    throw err;
  }
}

export async function migrate(pool, { dir = DEFAULT_DIR, log = () => {} } = {}) {
  return withMigrationLock(pool, async (client) => {
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql') && !isDown(f)).sort();
    const { rows } = await client.query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));
    const pending = files.filter((f) => !applied.has(f));

    for (const file of pending) {
      const sql = await readFile(join(dir, file), 'utf8');
      await runInTransaction(client, `migration ${file}`, sql, () =>
        client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]),
      );
      log(`applied ${file}`);
    }
    return pending;
  });
}

// Fails before changing anything if any target lacks a .down.sql file.
export async function rollback(pool, { dir = DEFAULT_DIR, steps = 1, log = () => {} } = {}) {
  if (!Number.isInteger(steps) || steps < 1) throw new Error('steps must be a positive integer');
  return withMigrationLock(pool, async (client) => {
    const { rows } = await client.query('SELECT name FROM schema_migrations ORDER BY name DESC LIMIT $1', [steps]);
    const targets = rows.map((r) => r.name);

    for (const name of targets) {
      try {
        await access(join(dir, downFileFor(name)));
      } catch {
        throw new Error(`migration ${name} has no ${downFileFor(name)}; it cannot be rolled back`);
      }
    }

    for (const name of targets) {
      const sql = await readFile(join(dir, downFileFor(name)), 'utf8');
      await runInTransaction(client, `rollback of ${name}`, sql, () =>
        client.query('DELETE FROM schema_migrations WHERE name = $1', [name]),
      );
      log(`rolled back ${name}`);
    }
    return targets;
  });
}
