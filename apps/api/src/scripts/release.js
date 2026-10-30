// Release step for hosted deployments (Railway pre-deploy command; deploy/all-in-one.mjs
// imports it at start on Render's free plan):
//   1. apply pending migrations;
//   2. with SEED_DEMO_DATA=true, load the demo sellers, stores and catalogue. The seed
//      scripts skip data that is already there, so this is safe on every deploy.
// Exits non-zero on failure so the platform does not start a release on a broken database.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Asynchronous so a process importing this script (deploy/all-in-one.mjs) keeps serving its
// "starting" responses while the steps run.
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
  // The default demo password is published in the README. On a public deployment it would
  // let anyone sign in as the platform admin, so production requires a strong one.
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
