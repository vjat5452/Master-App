import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createPool, migrate } from '../index.js';

config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)) });

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
  process.exit(1);
}

const pool = createPool(process.env.DATABASE_URL, { max: 1 });
try {
  const applied = await migrate(pool, { log: (msg) => console.log(msg) });
  console.log(applied.length ? `done: ${applied.length} migration(s) applied` : 'database is up to date');
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
