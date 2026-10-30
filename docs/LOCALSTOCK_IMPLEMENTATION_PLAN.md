# LocalStock: implementation plan (Milestone 1)

File-level plan for the unified first-party + external quick-commerce discovery work, derived from `docs/LOCALSTOCK_GAP_ANALYSIS.md`. Work happens on `feature/unified-external-platform-discovery`, one milestone per commit series. Each milestone ends with: changed files, schema changes, test run and results, known limitations, next milestone.

## Guiding decisions

1. **Reuse existing names.** Vendors stay `companies`, listings stay `seller_offers`, canonical products stay `product_variants`. New external tables use the `external_` prefix. No duplicate first-party tables.
2. **Separate persistence, unified DTO.** External data lives only in `external_*` tables; first-party tables are never written by connectors. The compare API normalizes both into one response shape.
3. **No fabricated live data.** Every platform connector ships as `NOT_CONFIGURED` until authorized access exists. A clearly fictional demo fixture source (`demo-fixture`, display name "Demo Quick-Commerce (fixture data)") exists only for development, is refused in production, and is labelled `DEMO` in every response.
4. **Money in minor units** (`BIGINT` paise) and `currency` text, as today.
5. **Coarse location for external lookups.** Serviceability and caches key on a geohash cell (precision 6, ~1.2 × 0.6 km); exact customer coordinates are not stored with observations.
6. **Existing event convention** `<aggregate>.<PascalEvent>`, new payloads carry `schemaVersion: 1`.
7. **No new runtime dependencies unless needed.** zod, ioredis, amqplib, pg already cover validation, cache, queue and storage. Outbound HTTP uses Node's built-in `fetch` with `AbortSignal.timeout`.

## Milestone 2: Unified domain model and migrations

| File | Change |
|---|---|
| `packages/database/src/migrate.js` | Skip `*.down.sql` on `up`; add `rollback(pool, name)` that runs the matching down file and deletes the `schema_migrations` row |
| `packages/database/src/cli/migrate.js` | `--down <name>` flag |
| `packages/database/migrations/002_external_platforms.sql` (+ `.down.sql`) | `external_platforms`, `external_sources`, `external_fulfillment_nodes`, `external_listings`, `external_product_mappings`, `external_price_observations`, `external_availability_observations`, `external_offer_observations`, `external_serviceability_observations`, `external_collection_jobs`, `external_collection_runs`, `external_source_health`, `external_change_events`; enums via CHECK; indexes on (source, listing), (listing, collected_at DESC), geohash cell |
| `packages/database/migrations/003_vendor_extensions.sql` (+ `.down.sql`) | `seller_offers.mrp_minor` (nullable, `>= price_minor`), `companies.vendor_type`, `companies.contact_phone`, `audit_logs.source_of_change` (default `'USER'`), `product_variants.pack_quantity`, `pack_unit`, `pack_count` (nullable, filled by a backfill parser) |
| `packages/database/src/domain/pack-size.js` | Parse `"500 g"`, `"1 kg"`, `"6 x 200 ml"`, `"1 l"` → `{ quantity, unit: g|ml|pcs, count }` in base units; unknown → null |
| `packages/database/src/cli/backfill-pack-size.js` | One-off backfill for existing variants |
| `packages/database/test/migrations.db.test.js` | Up → down → up round trip on the isolated test DB |
| `packages/database/test/pack-size.test.js` | Unit tests incl. 500 ml ≠ 1 l, multipacks |
| `docs/DATA_DICTIONARY.md` | Every new table/column with ownership rules |

Not in this milestone: any fetching, API or UI.

**Done.** Differences from the table above:
- The CLI takes `down [steps]` (`npm run db:migrate:down`) and always reverts the newest migrations first, instead of a migration name.
- `external_listings` is unique per (platform, listing id), not per source, so two sources reporting on one platform share a listing.
- `warehouses.contact_phone` and `warehouses.opening_hours` were also added (Phase 5 asks for store contact and hours).
- The backfill logic lives in `src/domain/pack-size-backfill.js`, and `npm run db:seed` runs it.

## Milestone 3: Traditional vendor regression verification

| File | Change |
|---|---|
| `apps/api/test/vendor-flow.db.test.js` | DB-backed (opt-in `RUN_DB_TESTS=1`): register → company → warehouse → variant → offer (with MRP) → inventory adjustment → search finds it at a covered location and not at an uncovered one → order reserves stock |
| `apps/api/test/ownership.db.test.js` | Writing external observations leaves `seller_offers`/`warehouse_inventory` untouched; vendor price change leaves external observations untouched |
| `apps/api/src/modules/offers/offers.routes.js` | Accept and return optional `mrpMinor` |
| `apps/api/src/modules/admin/admin.routes.js` (new) | `PATCH /admin/companies/:id/status`, `PATCH /admin/warehouses/:id/status` (platform admin, audited) |
| `apps/api/src/modules/imports/imports.routes.js` (new) | `POST /companies/:id/catalogue-imports` (CSV: sku, barcode, price, mrp, warehouse, quantity), validated row-by-row, dry-run mode, audited, `source_of_change = 'CSV_IMPORT'` |
| `apps/worker/src/consumers/handlers.js`, `packages/logger/src/index.js` | Stop logging customer email; add `redact()` for known sensitive keys (authorization, cookie, token, password, email, lat/lng) |

**Done.** Additions beyond the table:
- Warehouses accept `contactPhone` and `openingHours`, and companies accept `vendorType` and `contactPhone`.
- New variants get their pack size parsed on creation, and variant responses include `packSize`.
- Admin status changes emit `company.CompanyStatusChanged` / `warehouse.WarehouseStatusChanged`. The worker's search-projection queue now binds `company.#` and `warehouse.#`, so the search cache is invalidated.
- `/admin/companies` lists vendors and `/admin/companies/:id/warehouses` lists a vendor's stores.
- The vendor-flow and ownership DB tests share `apps/api/test-support/db-app.js`. `npm run test:db` now runs the database and API suites.
- XLSX import is not supported (it would need a new dependency); export to CSV instead.
- "Approve" means setting a company to ACTIVE. New companies still start ACTIVE; a pending-approval state would change seller onboarding and needs a product decision.

## Milestone 4: Connector framework and platform access research

| File | Change |
|---|---|
| `packages/connectors/` (new workspace `@localstock/connectors`) | `contract.js` (capabilities enum, `Availability`, error taxonomy: `SOURCE_NOT_CONFIGURED`, `UNSUPPORTED`, `TIMEOUT`, `RATE_LIMITED`, `UPSTREAM_ERROR`, `INVALID_RESPONSE`, `CIRCUIT_OPEN`), `base-connector.js`, `not-configured.js`, `resilience.js` (timeout, token-bucket rate limiter, retry with backoff + jitter for retryable codes only, circuit breaker, bounded concurrency), `registry.js` (builds connectors from config) |
| `packages/connectors/src/platforms/{blinkit,zepto,instamart,bigbasket}.js` | Disabled adapters: declare capabilities as unknown, return `SOURCE_NOT_CONFIGURED`; config validation reports which approved credentials are missing |
| `packages/connectors/src/licensed-provider.js` | Generic adapter for a contracted feed/API, disabled by default; requires base URL, key and a field mapping file |
| `packages/connectors/src/demo-fixture.js` | Development-only fixture source over a checked-in fixture file; throws if `NODE_ENV=production` |
| `packages/connectors/test/*.test.js` | Resilience unit tests (timeouts, retry policy, breaker transitions), registry, not-configured behaviour |
| `docs/platforms/{blinkit,zepto,swiggy-instamart,bigbasket}.md`, `docs/platforms/README.md` | Research record per platform (access method, documentation URL, authorization status, credentials, operations, fields, coverage, rate limits, storage/display rights, limitations, `last_verified_at`, `integration_status`) and a comparison matrix. Only verifiable facts with sources; unknowns stay unknown |
| `.env.example` | Placeholder-only `*_ENABLED=false` and empty credential variables, `EXTERNAL_SOURCE_TIMEOUT_MS`, `EXTERNAL_SEARCH_MAX_CONCURRENCY`, `DEMO_EXTERNAL_FIXTURES` |

**Done.** Differences from the table above:
- The four disabled platform adapters are definitions in one file, `src/platforms.js`, instead of four files. They name no credentials, because no agreement documents any yet.
- `src/geohash.js` lives in this package; Milestone 6 reuses it instead of adding `apps/api/src/shared/geohash.js`.
- The demo fixture lives in `fixtures/demo-quick-commerce.json`. The connector refuses a fixture whose platform name is a real platform's.
- Single-listing lookups return `null` for "the source does not know this listing", rather than an error.
- Research findings are in `docs/platforms/`:
  - Swiggy Instamart has a documented API (Builders Club MCP), but it is user-delegated and restricts "competitive intelligence or benchmarking".
  - BigBasket's terms prohibit collecting listings and prices.
  - Blinkit and Zepto have no public API.
  - No licensed provider found shows upstream authorization.
- Registering sources in `external_sources` / `external_source_health` happens in Milestone 8, with the worker.

## Milestone 5: One genuinely authorized external connector

**Blocked on the project owner obtaining access** (official/partner API or a licensed data provider contract with display rights). When available: implement the adapter against the documented contract, save a redacted fixture, contract tests, persist observations, mark the source `ACTIVE` only after acceptance tests pass. Until then the milestone is recorded as blocked and later milestones proceed with the demo fixture source in development.

## Milestone 6: Unified location-based discovery API

| File | Change |
|---|---|
| `apps/api/src/modules/discovery/local-vendor-source.js` | Adapter over the existing `findOffers` query returning the unified DTO (`sourceType: LOCAL_VENDOR`, verified distance, `orderCapability: LOCALSTOCK_CHECKOUT`, ETA marked `ESTIMATED`) |
| `apps/api/src/modules/discovery/compare.service.js` | Orchestrator: validate, run local + enabled connectors concurrently with per-source timeout, collect partial results, `sourceSummary` (requested / responded / failed / notConfigured) |
| `apps/api/src/modules/discovery/compare.routes.js` | `POST /discovery/compare` (zod body per blueprint Part E), rate-limited |
| `apps/api/src/shared/geohash.js` | Encode to cell for cache keys and stored query location |
| `apps/api/test/compare.test.js` | Stubbed sources: timeout doesn't fail the request, `FETCH_FAILED` stays distinct, not-configured counted, unknown distance stays null |
| `docs/openapi.yaml` | OpenAPI 3.1 for the compare API (then extended to existing endpoints) |

**Done.** Differences from the table above:
- Geohash comes from `@localstock/connectors` (Milestone 4), not `apps/api/src/shared/geohash.js`.
- `freshness.js` was added now in a minimal form: per source type and per field, with demo data always UNVERIFIED. Milestone 8 adds per-source configuration.
- Results get `sizeMatch` (EXACT / DIFFERENT / UNKNOWN / NOT_REQUESTED), using the size parsed from the query. Exact sizes are listed first, and a notice flags other sizes.
- Source answers are cached in Redis for an hour, keyed by source, geohash cell and query. `prefer_fresh` reuses answers younger than 2 minutes, and a source that misses the request deadline still fills the cache when it answers.
- External listings stay `UNMAPPED` until the matcher (Milestone 7). Ordering is deterministic (size, availability, price) until the ranking engine (Milestone 9).
- `docs/openapi.yaml` covers the compare endpoint; the other endpoints are added in Milestone 11.

## Milestone 7: Product matching and data quality

| File | Change |
|---|---|
| `apps/api/src/modules/matching/matcher.js` | Order: GTIN → brand + parsed pack size + normalized name → attribute match → trigram candidates (never auto-merge) → `NEEDS_REVIEW`; records method, confidence, evidence |
| `apps/api/src/modules/matching/normalize.js` | Prices to minor units, currency check, MRP/discount plausibility, availability mapping, timestamp validation |
| `apps/api/src/modules/admin/mapping-review.routes.js` | `GET /admin/product-mapping/review-queue`, `POST …/:mappingId/decision` (also lists `PENDING_REVIEW` variants, closing README gap 1) |
| Tests | 500 ml vs 1 l rejected, multipack vs single rejected, flavour mismatch rejected, GTIN auto-confirmed |

**Done.** Differences from the table above:
- `MANUFACTURER_ID` matching is not used: no source supplies manufacturer part numbers.
- GTINs are compared across leading-zero spellings (EAN-8, UPC-12, EAN-13, GTIN-14).
- Within one brand, names that each have words the other lacks ("Kool Kesar" vs "Kool Elaichi") are treated as different variants and never proposed.
- Matching and listing storage happen in `matching.service.js` during comparison, and the stored decision is reused. Sources are registered in `external_sources` on first use as `SANDBOX`, never `ACTIVE`. Price and availability observations are still stored only from Milestone 8.
- Reviewers can CONFIRM a candidate, REJECT any mapping (which also unlinks a wrong automatic match), or link a listing manually. Linking two known, different pack sizes is refused (422 `PACK_SIZE_MISMATCH`).
- `GET /admin/catalog/variants/review-queue` closes README gap 1.
- `extractPackSize()` in `@localstock/database` is shared by query parsing, the matcher and the quality checks.
- Results now carry `match` and `dataQuality`. Implausible prices (above MRP, a discount over 90%, unknown currency) are dropped, and future timestamps are ignored.

## Milestone 8: Background refresh, Redis, RabbitMQ and real-time feed

| File | Change |
|---|---|
| `apps/worker/src/messaging/topology.js` | Add `localstock.external-collection` (priority queue) and `localstock.external-health`; bindings `external_collection.#`, `external_price.#`, `external_availability.#` |
| `apps/worker/src/jobs/external-refresh-scheduler.js` | Enqueue refresh jobs per (source, cell, product) by demand and permitted cadence; dedup via Redis `SET NX` lock |
| `apps/worker/src/consumers/external-collector.js` | Run connector, validate, persist observations + run row, detect changes, write outbox events in the same transaction |
| `apps/worker/src/jobs/source-health.js` | Periodic `healthCheck()` → `external_source_health`, `external_source.HealthChanged` event |
| `apps/api/src/modules/discovery/freshness.js` | Per-source, per-field policy (`FRESH`, `STALE`, `EXPIRED`, `UNVERIFIED`) |
| `apps/api/src/modules/realtime/stream.routes.js` | `GET /discovery/stream` (SSE, authenticated), pushes persisted change events for subscribed product/cell |
| Tests | Consumer idempotency for new handlers, change detection, freshness policy |

**Done.** Differences from the table above:
- **New shared package.** Matching, quality, freshness and listing storage moved from the API into `packages/external-data`, so the worker can use them. It also holds the collector, scheduler, health job, demand tracker, observation store and compare cache; the worker only wires it to RabbitMQ and timers. `normalizeText` moved to `@localstock/database`.
- **Migration `004_collection_jobs.sql`** (reversible): adds a `SEARCH` job type (one query in one location cell from one source) and indexes for the cadence check and stuck-job recovery.
- **Duplicate work** is prevented by the existing partial unique index on open jobs, not a Redis `SET NX` lock. A job's database row is its state: claiming it is atomic, so a redelivered message is a no-op.
- **Retryable failures** are rescheduled with backoff (up to 3 attempts). Jobs stuck in RUNNING for over 10 minutes are re-queued.
- **Demand** is hourly Redis sorted sets of { normalized query, location cell }, recorded by `/discovery/compare` only when a configured external source exists. No customer identifier or exact location is stored.
- **Background collection queries the centre of the cell**, never a customer's coordinates.
- **Change events:**
  - Price and availability changes (compared with the previous observation for the same listing and cell), serviceability flips and source-health changes become `external_change_events` rows, plus outbox events (`external_price.PriceChanged`, `external_availability.AvailabilityChanged`, `external_serviceability.ServiceabilityChanged`, `external_source.HealthChanged`, `external_collection.CollectionFailed`), all with `schemaVersion: 1`.
  - "Observed" events are not published, to avoid noise.
  - Change events invalidate the source's cached comparison answers for that cell, via the `localstock.external-changes` queue.
- **Source registration.** Unconfigured sources are registered as RESEARCH_REQUIRED, configured ones as SANDBOX; nothing is set to ACTIVE automatically.
- **Freshness** is configurable per source with `EXTERNAL_FRESHNESS`, which also sets each source's minimum refresh interval.
- **SSE** polls stored change events (only while someone is subscribed) instead of consuming RabbitMQ in the API. It supports `Last-Event-ID` resume, a per-user stream limit, and a heartbeat, and streams are closed on shutdown.

## Milestone 9: Ranking and frontend

| File | Change |
|---|---|
| `apps/api/src/modules/discovery/ranking.js` | Configurable weights per policy, deterministic tie-breaks, reason codes (`LOWEST_ITEM_PRICE`, `LOWEST_KNOWN_TOTAL`, `NEAREST_VERIFIED_STORE`, `FASTEST_KNOWN_ETA`, `BEST_AVAILABLE_VALUE`, `FRESHNESS_PENALTY`, `VARIANT_MISMATCH`); unknown distance never 0; unavailable never ranked as available |
| `apps/web/src/pages/Product.jsx`, `apps/web/src/components/compare.jsx` | "Compare across platforms" section: source badge, item price vs known total, freshness, deep link vs LocalStock checkout, unmapped label |
| `apps/web/src/pages/Admin.jsx` (+ `pages/admin/Sources.jsx`, `pages/admin/MappingReview.jsx`) | Source status, last success, error rate, access state, review queue |
| `apps/web/src/pages/seller/Import.jsx` | CSV import with dry-run preview |
| `apps/web/src/App.jsx` | Non-production "demo data" notice |

**Done.** Differences from the table above:
- **Ranking hard rules** come before any weighting: the requested pack size first, an unreadable size next, a different size last; within each, available before unavailable. Weights apply after that.
- **Weights** (price, ETA, distance, freshness, match) are configurable per policy with `COMPARE_RANKING_WEIGHTS`. The defaults are placeholders pending a product decision.
- **Reason codes:** extra codes were added: `UNAVAILABLE`, `INCOMPLETE_TOTAL`, `UNKNOWN_DISTANCE`, `UNCONFIRMED_PRODUCT`.
  - "Lowest", "nearest" and "fastest" reasons are only given among available results of the requested size.
  - `LOWEST_KNOWN_TOTAL` needs a COMPLETE total.
- **Admin source endpoints** were added (from blueprint Part E): `GET /admin/external-platforms`, `/admin/external-sources/:code/runs`, `test-connection` and `status`. ACTIVE is refused for unconfigured and demo sources and needs an evidence note.
- **Frontend:**
  - The compare section is `components/compare.jsx`, used on the product page. It shows LocalStock sellers of this product plus external results, ranked by the API, with labels for every uncertainty.
  - Live updates come from `/discovery/stream`, for signed-in users, read with `fetch` because `EventSource` cannot send an Authorization header.
  - The admin Sources and Match review tabs are in `pages/admin/`. The variant moderation queue now uses the server-side review queue instead of browser storage.
  - The seller Import tab is new, and MRP was added to the Offers screen.
  - A demo notice is shown outside production builds; `VITE_DEMO_NOTICE=on|off` overrides it.
- **Not built:** an admin screen for vendor and store suspension (the Milestone 3 API exists). It is a small follow-up.

## Milestone 10: Remaining platform connectors

Only for platforms whose access is approved; each follows the Milestone 5 acceptance steps.

## Milestone 11: Production hardening and deployment

GitHub Actions CI (install, tests, DB tests against a PostGIS service container, `npm audit`), Dockerfiles for API and worker, data retention jobs (observations, serviceability cells), metrics endpoint, `docs/RUNBOOK.md`, updates to `docs/ABOUT.md`.

**Done.** Differences from the plan above:
- **CI** also runs migrations up, down 4 and up again against PostGIS before the database tests, builds the website, and builds all three images. `npm audit` fails on high or critical advisories in production dependencies. Two moderate React Router advisories concern server-side rendering, which this app does not use.
- **A website image was added**, alongside the API and worker images: nginx serving the build and forwarding `/api` and `/health`, for same-origin hosting. `docker-compose.app.yml` runs everything from the images, with a one-shot migrate step. This was verified locally: migrations, healthy containers, search through nginx, and metrics closed in production without a token.
- **Retention** (`packages/external-data/src/retention.js`, hourly) also covers published outbox and processed inbox rows. It deletes in batches and keeps rows still referenced. Migration `005_retention_indexes.sql` (reversible) adds the indexes it needs.
- **Metrics** are a dependency-free package (`packages/metrics`) used by the API (`/metrics`) and the worker (optional `WORKER_METRICS_PORT`, which also serves `/health/live`). Route labels are route patterns, never raw URLs. Metrics need `METRICS_TOKEN` in production.
- **Not done:** Grafana dashboards, alert rules as code, and a specific cloud deployment. The runbook lists the metrics and thresholds to alert on.

## Review checkpoint

Per the blueprint, schema and code changes start only after this plan is reviewed. Decisions needed from the project owner before Milestone 2:

1. Approve reusing `companies` / `seller_offers` / `product_variants` instead of new vendor tables.
2. Approve the development-only demo fixture source with a fictional name (no real platform names on fixture data).
3. Confirm which external access, if any, is being pursued for Milestone 5 (official/partner API or a licensed provider).
