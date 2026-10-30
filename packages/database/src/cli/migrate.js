import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createPool, migrate, rollback } from '../index.js';

config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)) });

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
  process.exit(1);
}

// `node migrate.js` applies pending migrations; `node migrate.js down [steps]` reverts the
// newest applied ones (default 1).
const [command, stepsArg] = process.argv.slice(2);
if (command && command !== 'down') {
  console.error(`Unknown command "${command}". Usage: migrate.js [down [steps]]`);
  process.exit(1);
}

const pool = createPool(process.env.DATABASE_URL, { max: 1 });
const log = (msg) => console.log(msg);
try {
  if (command === 'down') {
    const reverted = await rollback(pool, { steps: stepsArg ? Number(stepsArg) : 1, log });
    console.log(reverted.length ? `done: ${reverted.length} migration(s) rolled back` : 'nothing to roll back');
  } else {
    const applied = await migrate(pool, { log });
    console.log(applied.length ? `done: ${applied.length} migration(s) applied` : 'database is up to date');
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
