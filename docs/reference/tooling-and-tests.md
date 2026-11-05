# Tooling and tests reference

This page covers the scripts, CI workflows, container and deployment files, and the test suite.
For day-to-day commands, see also [DEVELOPMENT.md](../DEVELOPMENT.md). For the free deployment, see [DEPLOY_FREE.md](../DEPLOY_FREE.md).

## Root `package.json` scripts

The repository is an npm **workspace** (one repository, several packages): `apps/*` and `packages/*`. Node `>=20.6` is required.

| Script | Command | What it does |
|---|---|---|
| `infra:up` | `docker compose up -d` | Starts PostgreSQL+PostGIS, Redis and RabbitMQ locally (see `docker-compose.yml`). |
| `infra:down` | `docker compose down` | Stops them (the database volume is kept). |
| `db:migrate` | `npm run migrate -w @localstock/database` | Applies pending migrations. |
| `db:migrate:down` | `npm run migrate:down -w @localstock/database` | Rolls back migrations; pass a step count after `--`, e.g. `npm run db:migrate:down -- 2`. |
| `db:seed` | API `seed`, then API `seed:catalog`, then database `backfill:pack-size` | Loads demo sellers, stores and catalogue, then parses pack sizes. |
| `dev:api` / `dev:worker` / `dev:web` | `npm run dev -w ...` | Starts that app in watch mode. |
| `build:web` | `npm run build -w @localstock/web` | Builds the website. |
| `test` | `npm test --workspaces --if-present` | Runs `node --test` in every workspace that has a `test` script. |
| `test:db` | `test:db` in `@localstock/database`, then `@localstock/external-data`, then `@localstock/api` | Runs each of those packages' tests with `--test-concurrency=1`. |

---

## scripts/smoke-endpoints.mjs

**Purpose.** An end-to-end smoke test: it calls almost every backend route over real HTTP against a running API, checks
status codes and key response fields, and prints a PASS/FAIL report. It creates its own users, company, store, products,
offers and orders.

**How to run.** See [DEVELOPMENT.md](../DEVELOPMENT.md#endpoint-smoke-test). In short:

- Start the API (for example on port 5055) connected to a throw-away database whose name ends in `_smoke`, with
  `DEMO_EXTERNAL_FIXTURES=true` so the demo external source is available.
- Run `node scripts/smoke-endpoints.mjs` with:
  - `SMOKE_API`: API base URL (default `http://localhost:5055`);
  - `SMOKE_DATABASE_URL`: the same database. The script refuses to run (exit code 2) unless its name ends in `_smoke`,
    because it writes to the database directly;
  - `PAYMENT_WEBHOOK_SECRET`: read from the environment or `.env`; used to sign the sandbox webhook.

**Direct database access.** It promotes the first registered user to `platform_role = 'ADMIN'`, looks up the demo listing
`dqc-1007` in `external_listings`, and reads `external_product_mappings` to find the product created from it.

**What it exercises, in order.** Health and metrics; registration, login, refresh-token rotation and reuse, logout,
current user; categories, groups and product proposals (barcode match, duplicate review, archive); companies, members,
stores, delivery providers; offers with MRP and price changes; stock adjustments; CSV catalogue import (dry run, real
run, invalid file); search near and far; offers per product; price history; platform links; external comparison
(`/discovery/compare`) and the live stream (SSE); checkout quote; idempotent order placement; sandbox payment; cancel; signed and
badly signed sandbox webhooks; admin vendor and store controls; external sources admin; product-mapping review, manual links and pack-size refusal.

Functions defined in the file:

### `async function call(method, path, { token, body, headers = {}, raw } = {})`

- Sends one HTTP request with `fetch`. Paths starting with `/health` or `/metrics` go to the base URL; all others get
  `/api/v1` in front. Adds `Authorization: Bearer <token>` if `token` is given. Sends `raw` as-is, or `body` as JSON.
- **Returns.** `{ status, data, headers }`, where `data` is parsed JSON, the raw text if it is not JSON, or `null`.

### `async function check(route, label, expected, fn, assert = () => true)`

- Runs `fn()` (which returns a `call` result), passes if the status equals `expected` **and** `assert(result)` returns
  exactly `true`. If `assert` returns a string, that string becomes the failure note. A thrown error is caught and noted.
- Records the route as "seen" and pushes a result row.
- **Returns.** The response (or `undefined` if `fn` threw).

### `const must = (cond, msg)`

Returns `true` if `cond` is truthy, otherwise `msg`. Used inside `assert` callbacks.

### Small helpers

`reg(name)` registers `<name>-<tag>@smoke.test`; `login(email, password)` logs in; `variant(body)` proposes a product in
the smoke group; `csv(rows)` posts a CSV import (`rows.dry` sets `dryRun`); `compare(query, extra)` posts a comparison at
the India Gate test location. `tag` is a random 6-character id so repeated runs do not clash.

### `function printReport()`

Prints one line per check (`PASS`/`FAIL`, method and route, status, label, note), then the pass count and any route in its
built-in `ROUTES` list that was never exercised. Sets the exit code to 1 if any check failed or any route was missed,
else 0. A `process.on('exit')` handler calls it if the script crashes part-way, so partial results are still shown.

## scripts/k6/search.js

**Purpose.** A load test for the search endpoint using [k6](https://k6.io) (a separate load-testing tool, not an npm package).

- **Run.** `BASE_URL=http://localhost:5000 k6 run scripts/k6/search.js` (default base URL `http://localhost:5000`).
- **Load shape (`options.stages`).** Ramp to 20 virtual users over 30 s, to 50 over 1 min, then down to 0 over 30 s.
- **Pass criteria (`options.thresholds`).** Fewer than 1% failed requests, and 95th-percentile response time under 300 ms.
- **`export default function ()`.** Each virtual user, in a loop: picks a random query from `bread`, `whole wheat bread`,
  `milk`, `multigrain`; calls `GET /api/v1/catalog/search?q=...&lat=28.6129&lng=77.2295&radiusKm=20&page=1&limit=20`;
  checks the status is 200 and the response has an `items` array; sleeps 1 second.

---

## .github/workflows/ci.yml

**Purpose.** Continuous integration on GitHub Actions. Runs on pushes to `main` and `feature/**`, and on pull requests.
A newer run on the same branch cancels the older one. The token has read-only repository access.

| Job | What it does |
|---|---|
| `test` (Unit and HTTP tests) | Node 20, `npm ci`, `npm test`. Database tests are skipped here because `RUN_DB_TESTS` is not set. |
| `db-test` (Database tests) | Starts a `postgis/postgis:16-3.4` service. Sets `RUN_DB_TESTS=1` and `DATABASE_URL` (tests derive and use `localstock_test` from it). Runs `npm run db:migrate`, then `npm run db:migrate:down -- 6`, then `npm run db:migrate` again (to prove the down files work), then `npm run test:db`. |
| `web` (Web build) | `npm ci`, `npm run build:web`. |
| `audit` (Dependency audit) | `npm audit --omit=dev --audit-level=high`: fails on high or critical advisories in production dependencies. |
| `images` (Container images) | After `test` passes, builds the API, worker and web Docker images (not pushed anywhere). |

Note: with eight migrations, the `db-test` step's rollback of 6 steps reverts `008` to `003` and keeps
`001` and `002`. Raise the number when adding migrations if the new ones should be rolled back too.

## .github/workflows/keep-awake.yml

**Purpose.** Render's free plan puts the backend to sleep after 15 minutes without traffic. This workflow pings
`https://localstock-api.onrender.com/health/live` (with `curl --fail`, a 120 s timeout and 2 retries) so the demo stays awake during the day.

- **Schedule.** Cron `*/10 4-12 * * *` (UTC): every 10 minutes from 04:00 to 12:50 UTC, which is 09:30 to 18:20 IST.
  It can also be started by hand (`workflow_dispatch`).
- **Why not all day.** The file's comment explains that the worker keeps the Neon database busy while the backend is awake,
  and staying awake all day would use about 186 of Neon's 100 free compute-hours a month.
- **Unreliable, so only a backup.** GitHub delays and drops scheduled runs on free repositories (on 3 and 4 Nov 2026 it ran
  twice a day instead of about 54 times). The main pinger is a cron-job.org job with the same URL and window; setup is in
  [DEPLOY_FREE.md](../DEPLOY_FREE.md#keep-the-backend-awake-cron-joborg).

---

## docker-compose.yml

**Purpose.** Local infrastructure for development (`npm run infra:up`). It does not run the apps themselves.

| Service | Image | Ports | Notes |
|---|---|---|---|
| `postgres` (container `localstock-postgres`) | `postgis/postgis:16-3.4` | 5432 | Database `localstock`, user `localstock`, password `localstock_dev_password`. Data kept in the `localstock_pgdata` volume. Health check `pg_isready`. |
| `redis` (container `localstock-redis`) | `redis:7-alpine` | 6379 | Health check `redis-cli ping`. |
| `rabbitmq` (container `localstock-rabbitmq`) | `rabbitmq:3-management` | 5672 (AMQP), 15672 (management web UI) | User `localstock`, password `localstock_dev_password`. Health check `rabbitmq-diagnostics -q ping`. |

These passwords are for local development only.

## Dockerfiles

All Dockerfiles are built **from the repository root** (`docker build -f <path> .`). The three Node images use the same
two-stage pattern:

1. A `deps` stage on `node:20.18-alpine` copies the root `package.json`, `package-lock.json` and **every** workspace's
   `package.json` (so `npm ci` can verify the lockfile), then installs only the production dependencies of the target
   workspace(s) with `npm ci --omit=dev --ignore-scripts`.
2. A final stage on `node:20.18-alpine` with `NODE_ENV=production` copies the installed `node_modules`, the `packages`
   folder and the app's own folder, and runs as the unprivileged `node` user.

| File | Contents and start command |
|---|---|
| `apps/api/Dockerfile` | API only. `API_PORT=5000`, exposes 5000. Health check fetches `/health/live`. Runs `node apps/api/src/server.js`. Migrations are run separately with the same image: `node packages/database/src/cli/migrate.js`. |
| `apps/worker/Dockerfile` | Worker only. `WORKER_METRICS_PORT=9100`, exposes 9100; the metrics server's `/health/live` is used for the container health check. Runs `node apps/worker/src/worker.js`. |
| `apps/web/Dockerfile` | Builds the website with Vite (`npm run build -w @localstock/web`; build argument `VITE_DEMO_NOTICE`, set to `off` for a deployment with real sellers), then serves the static files with `nginx:1.27-alpine`. `nginx.conf.template` forwards `/api` and `/health` to `API_UPSTREAM` (default `http://api:5000`). Listens on `PORT` (default 8080). |
| `deploy/render/Dockerfile` | API and worker in one container for Render's free plan. Installs both workspaces' dependencies, copies `apps/api`, `apps/worker` and `deploy/all-in-one.mjs`, and runs `node deploy/all-in-one.mjs` (migrations, optional demo seeding, then API and worker in one process; see [worker.md](worker.md#deployall-in-onemjs)). |

## render.yaml

**Purpose.** A Render "Blueprint": a file that tells Render which services to create. It describes the free demo backend.

- **`localstock-api`**: a free Docker web service in the `singapore` region (same region as Neon and CloudAMQP, because
  the API makes many small queries; the region cannot be changed later). Built from `deploy/render/Dockerfile`, deployed
  from the `main` branch on every commit, health check path `/health/ready`.
  Environment variables:
  - `NODE_ENV=production`, `SEED_DEMO_DATA=true`, `ENABLE_SANDBOX_PAYMENTS=true`, `TRUST_PROXY=2` (Vercel's proxy, then Render's load balancer);
  - `DATABASE_URL`, `RABBITMQ_URL`, `SEED_PASSWORD`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`: `sync: false`,
    meaning they are typed in by hand when the Blueprint is created (Razorpay keys may be left unset to keep sandbox payments);
  - `REDIS_URL`: taken from the `localstock-redis` service's connection string;
  - `JWT_ACCESS_SECRET`, `PAYMENT_WEBHOOK_SECRET`: random values generated by Render.
- **`localstock-redis`**: a free Render Key Value instance (Redis-compatible) in `singapore`, with an empty IP allow list (`ipAllowList: []`).

PostgreSQL (Neon) and RabbitMQ (CloudAMQP) are external free services, and the website is deployed separately on Vercel.

---

## Tests

### Tools and layout

- Tests use Node's built-in test runner (`node:test`), run with `node --test`. With no file arguments, it finds the test
  files in the package it runs in. API HTTP tests use `supertest`.
- Each package keeps its tests in its own `test/` folder.
- Files named `*.db.test.js`, plus `packages/database/test/reservation.concurrency.test.js`, need PostgreSQL. They are
  **skipped** unless `RUN_DB_TESTS=1` is set **and** a test database URL can be worked out (`TEST_DATABASE_URL`, or
  `DATABASE_URL` with `_test` appended to the database name; see `testDatabaseUrl` in
  [packages-core.md](packages-core.md#packagesdatabasetest-supportisolated-databasejs)).
- Database tests never touch your development database. `prepareTestDatabase` refuses any database whose name does not
  end in `_test`, creates it if needed, migrates it, and **empties every table** before a test file uses it.
- API database tests use `apps/api/test-support/db-app.js` (`createTestApi`), which builds the real Express app on the
  test database with an in-memory stand-in for Redis.

### Running them

Unit and HTTP tests (no infrastructure needed):

```powershell
npm test
```

Database tests (start the infrastructure first with `npm run infra:up`, and make sure `.env` has `DATABASE_URL`):

```powershell
$env:RUN_DB_TESTS='1'; npm run test:db
```

On macOS or Linux: `RUN_DB_TESTS=1 npm run test:db`.

**Database tests must run with concurrency 1.** All of them share the one `*_test` database, and each file empties every
table when it starts. If two files ran in parallel, one would delete the other's data mid-test. The `test:db` scripts
pass `--test-concurrency=1` for this reason. If you run a database test file by hand, run one file at a time, e.g.
`node --test --test-concurrency=1 apps/api/test/razorpay.db.test.js` (with `RUN_DB_TESTS=1` set).

`npm run test:db` covers `@localstock/database`, `@localstock/external-data` and `@localstock/api`. Because `node --test`
runs every test file in those packages, their unit tests run again as part of it.

Other checks: `npm run bench -w @localstock/allocation-engine` (allocator benchmark), `k6 run scripts/k6/search.js`
(load test), `node scripts/smoke-endpoints.mjs` (end-to-end smoke test).

### Every test file

Unit and HTTP tests (run by `npm test`):

| File | What it covers |
|---|---|
| `apps/api/test/app.test.js` | HTTP basics without a database: liveness, readiness failure as 503, request ids, validation errors, malformed JSON, authentication and admin-role checks, 404 for non-members, tampered tokens, required `Idempotency-Key`, webhook signature rejection, search parameter validation, route-pattern metrics, metrics access in production, JSON 404. |
| `apps/api/test/catalogue-import.test.js` | CSV parser (quotes, CRLF, BOM, blank lines, broken quoting), rupees-to-paise conversion, row normalisation and error reporting, row limit, store contact and opening-hours validation. |
| `apps/api/test/compare.test.js` | The comparison service: source timeouts and failures, error hiding, disabled platforms, distance only from source coordinates, known totals, result ordering, pack-size ranking, refresh policies, sharing identical in-flight comparisons, demo labelling, request validation, query splitting, freshness states. |
| `apps/api/test/product-matching.test.js` | Variant identity keys (pack size, formatting, brand, attributes), password hashing, idempotency request hashing. |
| `apps/api/test/ranking.test.js` | Comparison ranking: availability first, size rules before price, unknown distance, "lowest known total", policies and staleness penalties, deterministic ties, weight validation. |
| `apps/worker/test/scheduler.test.js` | `every()`: runs never overlap, `stop()` waits, a failing job keeps being scheduled; `backoffMs` grows and is capped. |
| `packages/allocation-engine/test/allocate.test.js` | The allocator: single-warehouse preference, documented example cases, splitting only when needed and allowed, one warehouse per line, seller fleets, fallback to later stages, sort orders, slowest-shipment ETA, `preferSingleWarehouse=false`, line merging and determinism, invalid input. |
| `packages/connectors/test/connectors.test.js` | External connectors: disabled by default, configuration validation, demo fixtures refused in production, licensed-provider mapping, retries, health checks, platform search links, logs free of location, query and keys. |
| `packages/connectors/test/resilience.test.js` | Resilience helpers: timeout, backoff, retry with `Retry-After`, token bucket, circuit breaker, semaphore, combined policy, geohash encoding. |
| `packages/database/test/pack-size.test.js` | `parsePackSize`, multipacks, refusing to guess, size equality, `extractPackSize` from text, `packSizeFromAttributes`. |
| `packages/external-data/test/collection-units.test.js` | Freshness overrides, change detection, health derivation, demand counting, job keys and priorities, compare-cache invalidation. |
| `packages/external-data/test/matcher.test.js` | Listing-to-product matching rules (GTIN, brand + size + name, pack-size and flavour conflicts, review vs automatic, fuzzy proposals, rejected candidates) and listing quality checks (implausible prices, future timestamps, pack size from title). |
| `packages/logger/test/redact.test.js` | Redaction of credentials and personal data at any depth, harmless keys left visible, no input mutation, logger output redacted. |
| `packages/metrics/test/metrics.test.js` | Counter, histogram and gauge rendering in Prometheus format; `metricsAccess` rules. |
| `packages/payments/test/razorpay.test.js` | Checkout and webhook signature checks, test-key-only settings, client authentication and error reporting (with a fake `fetch`). |

Database tests (skipped unless `RUN_DB_TESTS=1`; run by `npm run test:db`):

| File | What it covers |
|---|---|
| `packages/database/test/migrations.db.test.js` | Migrations roll back and re-apply cleanly; `001` cannot be rolled back; schema rules for external data; MRP and pack-size constraints. |
| `packages/database/test/reservation.concurrency.test.js` | 100 concurrent requests for 1 unit against 5 in stock give exactly 5 successes; racing releases return stock exactly once. |
| `packages/external-data/test/collection.db.test.js` | Demand becomes one queued job per source; the collector stores observations and is idempotent; changes become change and outbox events; failure and retry handling; unconfigured sources; stuck-job recovery; health records; seller data untouched. |
| `packages/external-data/test/retention.db.test.js` | The retention job deletes old external data and processed events, and keeps recent, open and still-referenced rows. |
| `apps/api/test/checkout-safety.db.test.js` | A late payment is refunded even before the expiry job runs; an in-time payment confirms; idempotency-key takeover; concurrent refresh-token use and reuse of old rotated tokens. |
| `apps/api/test/external-discovery.db.test.js` | Products found only on other platforms are created once, kept separate by pack size, and cannot be sold until an admin classifies them. |
| `apps/api/test/matching.db.test.js` | Matching by GTIN or attributes, stored decisions, the review queue and admin confirmation, pack-size refusal, manual links and rejection, seller-proposed variants awaiting review. |
| `apps/api/test/ownership.db.test.js` | External observations and vendor prices and stock never change each other; no trigger or cascade links the two sets of tables. |
| `apps/api/test/price-history.db.test.js` | Price changes are recorded and graphed as the lowest active price per day; other platforms only for confirmed listings per location cell; platform links. |
| `apps/api/test/razorpay.db.test.js` | Razorpay flow with a fake client: order created once on first Pay click, checkout callback signature and paid-order checks, webhooks, amount mismatch, sync job confirmation, late payment refunded exactly once, no payment start for an order whose stock is about to be released. |
| `apps/api/test/sources.db.test.js` | Admin external-sources API: admin only, real access state, test connection, `ACTIVE` refused for unconfigured and demo sources, audited status changes. |
| `apps/api/test/stream.db.test.js` | The live change stream (SSE): login and filter required, area-scoped delivery, resume after `Last-Event-ID`, per-user stream limit. |
| `apps/api/test/vendor-flow.db.test.js` | Vendor journey: company, store, product, offer with MRP, stock visible only in the service area, order reserves stock, CSV import atomicity, comparison API distances, admin suspend and restore with audit. |
