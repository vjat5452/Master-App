# LocalStock: current architecture (Milestone 1 baseline)

Audit of the repository at commit `b52a915` (branch `feature/unified-external-platform-discovery`), written before any change for the unified external-platform discovery work. It records what exists today so later milestones extend it instead of rebuilding it.

## 1. Repository and runtime

| Item | Value |
|---|---|
| Layout | npm workspaces: `apps/api`, `apps/worker`, `apps/web`, `packages/database`, `packages/allocation-engine`, `packages/logger` |
| Runtime | Node.js `>=20.6` (verified on 20.18.1, npm 10.8.2), ES modules everywhere |
| Lockfile | `package-lock.json` (single root lockfile) |
| Infrastructure | `docker-compose.yml`: PostGIS 16-3.4, Redis 7, RabbitMQ 3 (management). Infrastructure only, no app images |
| CI | None (no `.github/`) |
| Deployment | No Dockerfiles. `docs/ABOUT.md` describes managed-service and single-VM options |
| API docs | No OpenAPI. `README.md` lists endpoints; the web app has a hand-built API explorer page |
| ADRs | `docs/adr/README.md` (ADR-001 … ADR-009) |

Root scripts: `infra:up/down`, `db:migrate`, `db:seed` (users, companies, warehouses, providers, then the 505-product demo catalog), `dev:api`, `dev:worker`, `dev:web`, `build:web`, `test`, `test:db`.

## 2. Backend (`apps/api`)

Express 5 modular monolith (ADR-001). `src/app.js` mounts the health router at `/` and every module router under `/api/v1`.

**Cross-cutting**

| Concern | Implementation |
|---|---|
| Config | `src/config/env.js`: zod schema, fail-fast at startup. Loaded from root `.env` |
| Validation | `src/shared/validate.js`: `validate({ params, query, body })` with zod; results in `req.valid` |
| Errors | `src/shared/errors.js` (`AppError`, `notFound`, `conflict`, …). Shape `{ error: { code, message, details, requestId } }` |
| Request context | `requestId()` accepts a safe `x-request-id` or generates one; `requestLogger` logs method, path **without query string**, status, duration, user id |
| Auth | `src/middleware/auth.js`: HS256 JWT bearer (`issuer: localstock`), `requirePlatformAdmin`, `requireCompanyRole(pool, roles)` (tenant check; non-members get 404) |
| Rate limiting | `src/middleware/rate-limit.js`: Redis fixed window per IP, fails open |
| Audit | `src/shared/audit.js` → `audit_logs` (actor, company, action, entity, before/after JSON) |
| Geo | `src/shared/geo.js`: `pointSql()` builds a geography point; `estimateDeliveryMinutes()` is a distance heuristic (15 min + road-km at 25 km/h) |
| Cache | `src/infrastructure/cache.js`: ioredis client; `search:version` key used for cache invalidation |

**Modules** (`src/modules/*`)

| Module | Endpoints | Notes |
|---|---|---|
| auth | `POST /auth/register|login|refresh|logout`, `GET /users/me` | scrypt passwords, rotating refresh tokens with reuse detection |
| organizations | `POST/GET /companies`, `POST/GET /companies/:id/members` | A "vendor" is a `company`; roles OWNER/ADMIN/STAFF |
| warehouses | `POST/GET /companies/:id/warehouses`, `PATCH …/:warehouseId` | PostGIS point + service radius; audited |
| delivery | `GET /companies/:id/delivery-providers`, `POST /companies/:id/delivery-providers`, `POST /admin/delivery-providers`, `GET /delivery/providers` | Seller fleet / platform fleet / third party (simulated, ADR-007) |
| catalog | `GET/POST /catalog/categories`, `POST /catalog/groups`, `GET /catalog/groups/:id`, `GET/POST /catalog/variants`, `PATCH /catalog/variants/:id/status` | Variant matching: barcode → normalized key → trigram similarity flags `PENDING_REVIEW` (`product-matching.js`) |
| offers | `POST/GET /companies/:id/offers`, `PATCH …/:offerId` | One offer per (company, variant); price in paise; audited; emits `OfferCreated/OfferUpdated` |
| inventory | `POST /companies/:id/inventory/adjustments`, `GET /companies/:id/inventory` | Conditional update that never drops below reserved; movement ledger; audit; `InventoryChanged` event |
| discovery | `GET /catalog/search`, `GET /catalog/variants/:id/offers` | Full-text + trigram search, category filter, PostGIS service-area filter, offer sorting, Redis cache (30 s, version-keyed) |
| checkout | `POST /checkout/quote` | Calls the allocation engine; advisory, reserves nothing |
| orders | `POST /orders` (Idempotency-Key), `GET /orders`, `GET /orders/:id`, `POST /orders/:id/cancel` | Atomic multi-row reservation, shipments, allocations, payment record and outbox in one transaction |
| payments | `POST /payments/webhooks/sandbox` (HMAC), `POST /payments/sandbox/:id/simulate` (non-production) | Sandbox provider only |
| health | `GET /health/live`, `GET /health/ready` | Ready checks Postgres + Redis and the shutdown flag |

## 3. Data model (`packages/database/migrations/001_init.sql`)

Single forward-only migration. Runner `packages/database/src/migrate.js` applies every `*.sql` file in name order inside a transaction under an advisory lock and records it in `schema_migrations`. There are no down migrations.

Money is integer minor units (`BIGINT`, paise). Statuses use `CHECK` constraints.

| Area | Tables |
|---|---|
| Identity | `users` (platform_role USER/ADMIN), `refresh_tokens`, `companies` (ACTIVE/SUSPENDED), `company_members`, `customer_addresses` (geography point) |
| Catalog | `categories` (tree), `product_groups` (category → group), `product_variants` (brand, name, `attributes` JSONB, unique `barcode`, unique `normalized_key`, status ACTIVE/PENDING_REVIEW/ARCHIVED, generated `search_vector`, trigram index), `product_images` |
| Commerce | `seller_offers` (company, variant, sku, `price_minor`, status) |
| Stock | `warehouses` (geography point, `service_radius_m`, status), `warehouse_inventory` (`on_hand`, `reserved`, `CHECK reserved <= on_hand`, version; tenant trigger), `inventory_movements` (reasons incl. RESERVATION/RELEASE/EXPIRY) |
| Delivery | `delivery_providers` (type, fees, speed, reliability, max distance; seller fleet must belong to a company) |
| Orders | `orders`, `order_items`, `shipments`, `fulfillment_allocations`, `inventory_reservations`, `payments`, `idempotency_keys`, `order_status_history` |
| Reliability | `outbox_events`, `inbox_events`, `webhook_events`, `audit_logs` |

Extensions: `pgcrypto`, `postgis`, `pg_trgm`.

Seeded demo data (local database): 7 companies, 13 warehouses, 6 delivery providers, 11 categories, 33 product groups, 505 variants (all with a GTIN barcode), 2,407 offers, 3,507 inventory rows. Product identities and photos come from Open Food Facts; **prices and stock are generated demo values** for fictional sellers.

Observed attribute shape: one free-text key per variant, e.g. `{"weight": "500 g"}`, `{"volume": "60 ml"}`. Pack size is not parsed into a numeric quantity and unit.

## 4. Worker (`apps/worker`)

| Part | File | Behaviour |
|---|---|---|
| Topology | `src/messaging/topology.js` | Topic exchange `localstock.events`, routing key `<aggregateType>.<EventType>` (e.g. `offer.OfferUpdated`); DLX `localstock.dlx` → `localstock.dead-letter`; queues `localstock.notifications` (`order.#`) and `localstock.search-projection` (`inventory.#`, `offer.#`) |
| Outbox publisher | `src/jobs/outbox-publisher.js` | `FOR UPDATE SKIP LOCKED`, publisher confirms, then marks published (at-least-once) |
| Consumers | `src/consumers/run-consumer.js` | Inbox dedup in the same transaction as effects; retry with exponential backoff + jitter (max 5), then dead-letter |
| Handlers | `src/consumers/handlers.js` | Notifications (simulated, logs a template), search projection (bumps `search:version`) |
| Jobs | `src/jobs/scheduler.js` (`every()`, non-overlapping), reservation expiry, reconciliation |

Event payloads carry no schema version field.

## 5. Shared packages

- `packages/database`: `createPool`, `withTransaction`, `enqueueEvent` (outbox), `recordMovement`, reservation/order domain helpers, `test-support/isolated-database.js` (creates and empties a `*_test` database).
- `packages/allocation-engine`: pure staged heuristic (single warehouse → per line → split), delivery feasibility and scoring (ADR-008); benchmark in `bench/`.
- `packages/logger`: JSON lines, levels, `child()`. No field redaction.

## 6. Frontend (`apps/web`)

Vite + React 18 SPA, React Router 6, Tailwind 3.4 + shadcn/ui (Radix), MUI (lazy, seller/admin charts), framer-motion effects. Calls the API at the relative path `/api/v1` (dev server proxy).

| Route | Purpose |
|---|---|
| `/`, `/search`, `/c/:slug` | Quick-commerce storefront: shelves per category, search, category browse |
| `/product/:variantId` | Product page with seller list (price, ETA estimate, distance, stock), radius and sort |
| `/cart` | Cart with live auto-quote, delivery preferences, plans, place order |
| `/orders`, `/orders/:id` | Order history and detail with sandbox payment |
| `/seller`, `/seller/:companyId` | Seller hub: warehouses, offers, inventory, delivery fleet, members, dashboards |
| `/admin` | Platform admin: categories, groups, variant status, delivery providers |
| `/explorer` | API explorer |

Delivery location is chosen by the customer (map/location modal) and kept in `localStorage`.

## 7. Search and geolocation flow (today)

1. Client sends `GET /catalog/search?q&category&lat&lng&radiusKm&sort&page&limit`.
2. Variants matched by `websearch_to_tsquery` OR trigram similarity, optional category.
3. For the page of variants, offers are joined to inventory rows with available stock in ACTIVE warehouses of ACTIVE companies, filtered by `ST_DWithin(warehouse, customer, LEAST(service_radius_m, radius))`.
4. Distance = distance to the nearest qualifying warehouse (verified coordinates); ETA = heuristic estimate.
5. Offers sorted by price, ETA or a fixed 0.6/0.4 price/ETA score.
6. Result cached in Redis for 30 s under a version key bumped by offer/inventory events.

## 8. Fulfillment and order flow (today)

Quote (allocation engine, advisory) → `POST /orders` with Idempotency-Key → one transaction locks inventory rows in id order, reserves, writes order/items/shipments/allocations/reservations/payment/outbox → sandbox payment webhook confirms or the expiry job releases → events to RabbitMQ → consumers.

## 9. Tests and baseline (2026-10-28)

| Suite | Command | Result |
|---|---|---|
| API HTTP + matching | `npm test` (api) | 20 / 20 pass |
| Worker scheduler | `npm test` (worker) | 3 / 3 pass |
| Allocation engine | `npm test` (allocation-engine) | 12 / 12 pass |
| Database concurrency | `RUN_DB_TESTS=1 npm run test:db` | 2 / 2 pass (skipped unless `RUN_DB_TESTS=1`) |
| End-to-end smoke | `scripts/demo.ps1` | Pass: search → quote → idempotent order → signed sandbox payment → CONFIRMED |

Total: 39 automated tests, 0 failures. No frontend tests, no e2e browser tests, no CI.
