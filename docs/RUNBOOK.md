# LocalStock runbook

How to deploy, watch and repair LocalStock in production. For the stack and hosting options see [ABOUT.md](ABOUT.md); for external platform access see [platforms/README.md](platforms/README.md).

## Components

| Component | Runs as | Health | Must always run |
|---|---|---|---|
| API (`apps/api`) | `node apps/api/src/server.js`, image `apps/api/Dockerfile` | `GET /health/live`, `GET /health/ready` (PostgreSQL + Redis) | Yes |
| Worker (`apps/worker`) | `node apps/worker/src/worker.js`, image `apps/worker/Dockerfile` | `GET :9100/health/live` when `WORKER_METRICS_PORT` is set | Yes |
| Website (`apps/web`) | Static files; image `apps/web/Dockerfile` (nginx, forwards `/api` and `/health`) | `GET /` | Yes |
| PostgreSQL 16 + PostGIS 3.4 | Managed or container | `pg_isready` | Yes |
| Redis 7 | Managed or container | `PING` | Yes (failure degrades: no cache, rate limits off) |
| RabbitMQ 3 | Managed or container | management UI / `rabbitmq-diagnostics ping` | Yes (failure delays events, never loses them) |

Run **one or more API instances** and **one or more worker instances**. Workers share work safely: the outbox uses `SKIP LOCKED`, consumers deduplicate through `inbox_events`, and collection jobs are claimed atomically.

## Releasing

1. CI must be green: unit tests, database tests (including migration rollback), web build, dependency audit and image builds (`.github/workflows/ci.yml`).
2. **Migrate first**, with the new API image:
   - Container: `docker run --rm --env-file <prod.env> localstock-api node packages/database/src/cli/migrate.js`
   - From source: `npm run db:migrate`

   Migrations are forward-compatible with the running version: they are additive, and new columns are nullable or have defaults.
3. Deploy the API, then the worker, then the website. Every component must be on the same release before external-data features are used.
4. Check:
   - `/health/ready` returns 200;
   - the worker log shows `worker started`;
   - the website loads.

**Rolling back a release:** redeploy the previous images. Only roll back a migration if it is incompatible with the previous code, because rolling back can delete data:
- `npm run db:migrate:down` (newest one) or `npm run db:migrate:down -- <n>`;
- each migration has a `.down.sql`, and `001_init.sql` cannot be reverted.

## Configuration

All settings are environment variables; `.env.example` lists every one with its default.

**Required in production**
- `NODE_ENV=production`
- `DATABASE_URL`, `REDIS_URL`, `RABBITMQ_URL`
- `JWT_ACCESS_SECRET` (≥ 32 random characters)
- `PAYMENT_WEBHOOK_SECRET` (≥ 16)

**Recommended**
- `METRICS_TOKEN`: without it `/metrics` answers 404 in production.
- `WORKER_METRICS_PORT=9100`: worker metrics and health. The image sets this.

**Never in production**
- `DEMO_EXTERNAL_FIXTURES=true`: the API and worker refuse to start with it.
- For the website, build with `VITE_DEMO_NOTICE=off` only when the data is real.

**External sources:** every platform connector stays disabled whatever the flags say, until an authorized adapter exists. A licensed provider needs every `LICENSED_PROVIDER_*` setting, including a mapping file with an `agreementReference`.

## Monitoring

Both processes expose Prometheus metrics. Send `Authorization: Bearer $METRICS_TOKEN`.

| Metric | Source | Alert when |
|---|---|---|
| `localstock_http_requests_total{route,status}` | API | 5xx rate > 1% for 5 min |
| `localstock_http_request_duration_seconds` | API | p95 > 1 s on `/api/v1/catalog/search` or `/api/v1/orders` |
| `localstock_compare_source_results_total{source,status,cache}` | API | a configured source mostly `FAILED` for 15 min |
| `localstock_change_feed_subscribers` | API | (capacity planning) |
| `localstock_outbox_unpublished_events`, `localstock_outbox_oldest_unpublished_seconds` | worker | oldest > 60 s: events are not being published |
| `localstock_rabbitmq_queue_messages{queue}` | worker | `localstock.dead-letter` > 0; any other queue growing for 10 min |
| `localstock_collection_jobs{status}` | worker | `RUNNING` stays high, or `FAILED` grows quickly |
| `localstock_collection_jobs_total{source,status}` | worker | (refresh throughput per source) |
| `localstock_external_source_health{source,health}` | worker | a source you rely on is `DOWN` or `DEGRADED` |

Logs are JSON lines on stdout/stderr, with a `requestId` on every API request (it is echoed in `x-request-id` and in error bodies). Passwords, tokens, cookies, emails, phone numbers, addresses and coordinates are redacted by the logger.

## Data retention

The worker deletes in small batches every `RETENTION_INTERVAL_MS` (default 1 hour):

| Data | Kept for | Setting |
|---|---|---|
| External price/availability/offer/serviceability observations, change events, collection runs, finished jobs | 90 days | `EXTERNAL_RETENTION_DAYS` |
| Published outbox events, processed inbox records | 30 days | `EVENT_RETENTION_DAYS` |
| Demand counters (Redis) | 4 hours | fixed |
| Cached comparison answers (Redis) | 1 hour | fixed |

Kept indefinitely:
- external listings and product mappings (reviewers' decisions);
- unpublished outbox events;
- anything still referenced by newer rows.

Orders, payments and audit logs are business records and are not touched.

## Incidents

### Orders stay `PENDING_PAYMENT` / events are not delivered
1. Check `localstock_outbox_oldest_unpublished_seconds`. If it is growing, the worker is down or cannot reach RabbitMQ: check the worker log for `rabbitmq not reachable` and RabbitMQ health.
2. The worker exits when the broker connection drops, and the supervisor restarts it. Nothing is lost: unpublished rows stay in `outbox_events` until sent.

### Messages in `localstock.dead-letter`
1. These failed 5 times. Inspect them in the RabbitMQ UI and look up `messageId` in the worker log (`message failed permanently`).
2. Fix the cause, then move them back to their original queue (management UI "Move messages", or a shovel). Consumers are idempotent, so replaying is safe.

### Stock looks wrong
1. The worker's reconciliation job logs `reconciliation mismatch` with a sample.
2. Never edit `warehouse_inventory.reserved` by hand. Reservations are released by expiry or cancellation.
3. Sellers correct `on_hand` through inventory adjustments or a CSV import; both are audited.

### An external source is `DOWN` or its circuit is `OPEN`
1. Admin → External sources → **Test** shows the source's own health answer. **Runs** shows the recent error codes:
   - `TIMEOUT` / `UPSTREAM_ERROR`: the provider is slow or failing.
   - `RATE_LIMITED`: lower `ratePerSecond` in its mapping, or raise `minRefreshSeconds`.
   - `INVALID_RESPONSE`: the provider changed its format; update the mapping file.
   - A credentials error (401/403): rotate the key.
2. The comparison keeps working without it: the source is reported as failed, and nothing is shown as live.
3. To stop using a source, unset its configuration (it becomes NOT_CONFIGURED) and set its status to DISABLED.

### Collection jobs stuck
- Jobs `RUNNING` for more than 10 minutes are re-queued automatically.
- Retryable failures back off up to 3 attempts, then become `FAILED`.

### Too many items in Match review
- Common causes: a source without GTINs, or with unusual size text.
- Confirm or reject in Admin → Match review. Rejections are remembered, and a rejected product is never proposed again for that listing.

### Redis down
- Search and comparison work uncached, and rate limits fail open.
- Live streams continue (they read PostgreSQL).
- Restore Redis; no data needs repair.

## Making an external source live

Follow the Milestone 5 acceptance steps in `docs/LOCALSTOCK_IMPLEMENTATION_PLAN.md`:
1. Get a written agreement (or official API access) covering display.
2. Configure credentials in the secret store, never in the repository.
3. Test against the sandbox and save a redacted fixture.
4. Validate the fields, persist observations, and compare them with the source.
5. Only then set the status to ACTIVE (Admin → External sources → **Status**), with a note describing the evidence.

## Secrets rotation

- `JWT_ACCESS_SECRET`: rotating it signs every user out; refresh tokens stay valid, so clients recover by refreshing.
- `PAYMENT_WEBHOOK_SECRET`: rotate together with the provider configuration.
- Provider API keys: update `LICENSED_PROVIDER_API_KEY`, restart the API and worker, then use **Test** to confirm.
