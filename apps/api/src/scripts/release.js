// Usage: node apps/api/src/scripts/release.js  (migrates; seeds demo data if SEED_DEMO_DATA=true)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Async so deploy/all-in-one.mjs, which imports this, keeps serving while the steps run.
const step = async (label, script) => {
  console.log(`release: ${label}`);
  const status = await new Promise((resolve) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL(script, import.meta.url))], { stdio: 'inherit' });
    child.on('error', () => resolve(1));
    child.on('exit', (code) => resolve(code ?? 1));
  });
  if (status !== 0) {
    console.error(`release: ${label} failed (exit ${status})`);
    process.exit(status);
  }
};

await step('migrate', '../../../../packages/database/src/cli/migrate.js');
if (process.env.SEED_DEMO_DATA === 'true') {
  // The default demo password is public (README), so production requires a strong one.
  const password = process.env.SEED_PASSWORD ?? '';
  if (process.env.NODE_ENV === 'production' && (password.length < 16 || password === 'localstock-dev-password')) {
    console.error('release: SEED_PASSWORD must be set to a strong password (16+ characters) to seed demo accounts in production');
    process.exit(1);
  }
  await step('seed demo sellers and stores', './seed.js');
  await step('seed demo catalogue', './seed-catalog.js');
  await step('parse pack sizes', '../../../../packages/database/src/cli/backfill-pack-size.js');
}
console.log('release: done');
