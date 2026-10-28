import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { backfillPackSizes, createPool } from '../index.js';

config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)) });

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
  process.exit(1);
}

// Default: parse variants that have no pack size yet. `--all`: recompute every variant.
const all = process.argv.includes('--all');
const pool = createPool(process.env.DATABASE_URL, { max: 1 });
try {
  const { scanned, parsed, unparsed } = await backfillPackSizes(pool, { all });
  console.log(`pack sizes: ${scanned} variant(s) scanned, ${parsed} parsed, ${unparsed} left unknown`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
