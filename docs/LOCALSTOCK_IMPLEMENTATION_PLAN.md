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

## Milestone 3: Traditional vendor regression verification

| File | Change |
|---|---|
| `apps/api/test/vendor-flow.db.test.js` | DB-backed (opt-in `RUN_DB_TESTS=1`): register → company → warehouse → variant → offer (with MRP) → inventory adjustment → search finds it at a covered location and not at an uncovered one → order reserves stock |
| `apps/api/test/ownership.db.test.js` | Writing external observations leaves `seller_offers`/`warehouse_inventory` untouched; vendor price change leaves external observations untouched |
| `apps/api/src/modules/offers/offers.routes.js` | Accept and return optional `mrpMinor` |
| `apps/api/src/modules/admin/admin.routes.js` (new) | `PATCH /admin/companies/:id/status`, `PATCH /admin/warehouses/:id/status` (platform admin, audited) |
| `apps/api/src/modules/imports/imports.routes.js` (new) | `POST /companies/:id/catalogue-imports` (CSV: sku, barcode, price, mrp, warehouse, quantity), validated row-by-row, dry-run mode, audited, `source_of_change = 'CSV_IMPORT'` |
| `apps/worker/src/consumers/handlers.js`, `packages/logger/src/index.js` | Stop logging customer email; add `redact()` for known sensitive keys (authorization, cookie, token, password, email, lat/lng) |

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

## Milestone 7: Product matching and data quality

| File | Change |
|---|---|
| `apps/api/src/modules/matching/matcher.js` | Order: GTIN → brand + parsed pack size + normalized name → attribute match → trigram candidates (never auto-merge) → `NEEDS_REVIEW`; records method, confidence, evidence |
| `apps/api/src/modules/matching/normalize.js` | Prices to minor units, currency check, MRP/discount plausibility, availability mapping, timestamp validation |
| `apps/api/src/modules/admin/mapping-review.routes.js` | `GET /admin/product-mapping/review-queue`, `POST …/:mappingId/decision` (also lists `PENDING_REVIEW` variants, closing README gap 1) |
| Tests | 500 ml vs 1 l rejected, multipack vs single rejected, flavour mismatch rejected, GTIN auto-confirmed |

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

## Milestone 9: Ranking and frontend

| File | Change |
|---|---|
| `apps/api/src/modules/discovery/ranking.js` | Configurable weights per policy, deterministic tie-breaks, reason codes (`LOWEST_ITEM_PRICE`, `LOWEST_KNOWN_TOTAL`, `NEAREST_VERIFIED_STORE`, `FASTEST_KNOWN_ETA`, `BEST_AVAILABLE_VALUE`, `FRESHNESS_PENALTY`, `VARIANT_MISMATCH`); unknown distance never 0; unavailable never ranked as available |
| `apps/web/src/pages/Product.jsx`, `apps/web/src/components/compare.jsx` | "Compare across platforms" section: source badge, item price vs known total, freshness, deep link vs LocalStock checkout, unmapped label |
| `apps/web/src/pages/Admin.jsx` (+ `pages/admin/Sources.jsx`, `pages/admin/MappingReview.jsx`) | Source status, last success, error rate, access state, review queue |
| `apps/web/src/pages/seller/Import.jsx` | CSV import with dry-run preview |
| `apps/web/src/App.jsx` | Non-production "demo data" notice |

## Milestone 10: Remaining platform connectors

Only for platforms whose access is approved; each follows the Milestone 5 acceptance steps.

## Milestone 11: Production hardening and deployment

GitHub Actions CI (install, tests, DB tests against a PostGIS service container, `npm audit`), Dockerfiles for API and worker, data retention jobs (observations, serviceability cells), metrics endpoint, `docs/RUNBOOK.md`, updates to `docs/ABOUT.md`.

## Review checkpoint

Per the blueprint, schema and code changes start only after this plan is reviewed. Decisions needed from the project owner before Milestone 2:

1. Approve reusing `companies` / `seller_offers` / `product_variants` instead of new vendor tables.
2. Approve the development-only demo fixture source with a fictional name (no real platform names on fixture data).
3. Confirm which external access, if any, is being pursued for Milestone 5 (official/partner API or a licensed provider).
