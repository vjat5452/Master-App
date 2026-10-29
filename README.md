# LocalStock

LocalStock is a multi-vendor, multi-warehouse commerce and fulfillment platform. Sellers list standardized product variants and keep stock in several warehouses. Customers compare seller offers by price, availability and delivery estimate. Checkout allocates the cart across warehouses and delivery providers, then reserves stock atomically.

**Stack:** Node.js Â· Express 5 Â· PostgreSQL + PostGIS Â· Redis Â· RabbitMQ Â· Zod Â· Docker

```
apps/
  web/        Vite + React UI (Tailwind CSS, shadcn/ui, Material UI charts, effects after Magic UI /
              React Bits / Aceternity UI): quick-commerce storefront, category browse, checkout,
              orders, seller hub, admin, API explorer; light and dark themes
  api/        Express modular monolith (auth, organizations, warehouses, catalog, offers,
              inventory, discovery, checkout, orders, payments, delivery)
  worker/     outbox publisher, reservation expiry, reconciliation, idempotent consumers,
              external refresh scheduler and collector, source health checks
packages/
  database/   SQL migrations, migration runner, transactional domain helpers
              (reserve/release stock, order state machine, outbox)
  allocation-engine/  pure warehouse + delivery allocation (no Express, no DB)
  logger/     structured JSON logger (redacts credentials and personal data)
  connectors/ external platform sources: connector contract, resilience (timeout, rate limit,
              retry, circuit breaker), disabled platform adapters, licensed-provider adapter,
              development-only demo fixture source
  external-data/  shared by API and worker: quality checks, product matching, freshness,
              demand, observations and change detection, collector, scheduler, health
docs/platforms/  platform access research (all RESEARCH_REQUIRED: no authorized access yet)
docs/ABOUT.md tech stack, required software and how to deploy online
docs/DATA_DICTIONARY.md  external-platform tables, vendor extensions and data ownership rules
docs/adr/     architecture decision records
scripts/      demo walkthrough (PowerShell), k6 load test
```

## Status

| Blueprint phase | State |
|---|---|
| 1â€“3 Repository, infrastructure, backend foundation | Done: config validation, health and readiness checks, graceful shutdown |
| 4 Identity and tenancy | Done: scrypt passwords, JWT access tokens plus rotating refresh tokens with reuse detection, company roles |
| 5 Catalog and sellers | Done: categories, groups, variants with barcode and normalized matching plus a review queue, offers |
| 6 Warehouse inventory | Done: PostGIS warehouses, audited adjustments, movement ledger, tenant trigger |
| 7 Discovery | Done: full-text and trigram search, service-area filtering, offer sorting, Redis cache |
| 8 Allocation | Done: staged heuristic, delivery feasibility, scoring, tests, micro-benchmark |
| 9 Checkout | Done: Idempotency-Key, atomic multi-row reservations, orders and shipments, sandbox payments |
| 10 Reliability | Done: outbox and inbox, publisher confirms, retries with a dead-letter queue, expiry job, reconciliation |
| 11 Delivery | Partial: provider model, quoting and assignment at checkout. Live tracking events are not built yet |
| 12 Production readiness | Not started: Prometheus/Grafana, AWS, runbooks. The k6 script exists |
| Frontends (customer web, seller and admin dashboards) | Done (`apps/web`, Vite + React, Tailwind CSS + shadcn/ui, Material UI for charts, stepper and slider): shop, cart and checkout, orders and sandbox payment, seller hub with dashboards, admin console, API explorer |

## Run locally (Windows PowerShell)

Prerequisites: Node.js 20.6 or later, and Docker Desktop.

```powershell
Copy-Item .env.example .env      # dev-only secrets
npm install
npm run infra:up                 # PostGIS, Redis, RabbitMQ (docker compose)
npm run db:migrate
npm run db:seed                  # demo sellers, warehouses, providers + 500-product catalog with photos

npm run dev:api                  # http://localhost:5000
npm run dev:worker               # in a second terminal
npm run dev:web                  # http://localhost:5173 (proxies /api and /health to the API)

.\scripts\demo.ps1               # search -> quote -> order (idempotent) -> pay
```

The seeded users all have the password `localstock-dev-password`:

| Email | Role |
|---|---|
| `admin@localstock.dev` | Platform admin |
| `seller.a@localstock.dev` | Owner of FreshMart Noida |
| `seller.b@localstock.dev` | Owner of Daily Needs Delhi |
| `seller.c@` â€¦ `seller.g@localstock.dev` | Owners of Gurgaon Fresh Bazaar, Dwarka Kirana Co., Rohini SuperMart, East Delhi Grocers, Saket Gourmet Pantry |
| `customer@localstock.dev` | Customer |

The RabbitMQ management UI is at http://localhost:15672 (user `localstock`, password `localstock_dev_password`).

## Tests

```powershell
npm test                                   # unit and HTTP tests, no infrastructure needed
$env:RUN_DB_TESTS='1'; npm run test:db     # database and HTTP tests in a separate localstock_test database
npm run bench -w @localstock/allocation-engine
k6 run scripts/k6/search.js
```

The database tests check the blueprint's invariants directly: 100 concurrent single-unit reservations against 5 units in stock give exactly 5 successes, and racing releases return stock exactly once.

## API (`/api/v1`)

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register` Â· `POST /auth/login` Â· `POST /auth/refresh` Â· `POST /auth/logout` Â· `GET /users/me` |
| Companies | `POST /companies` Â· `GET /companies` Â· `POST/GET /companies/:id/members` |
| Warehouses | `POST/GET /companies/:id/warehouses` Â· `PATCH /companies/:id/warehouses/:warehouseId` |
| Delivery | `POST/GET /companies/:id/delivery-providers` (seller fleet) Â· `POST /admin/delivery-providers` Â· `GET /delivery/providers` |
| Catalog | `GET/POST /catalog/categories` Â· `POST /catalog/groups` Â· `GET /catalog/groups/:id` Â· `POST /catalog/variants` Â· `GET /catalog/variants/:id` Â· `PATCH /catalog/variants/:id/status` |
| Offers | `POST/GET /companies/:id/offers` Â· `PATCH /companies/:id/offers/:offerId` |
| Inventory | `POST /companies/:id/inventory/adjustments` Â· `GET /companies/:id/inventory` |
| Discovery | `GET /catalog/search?q&category&lat&lng&radiusKm&sort&page&limit` Â· `GET /catalog/variants/:id/offers` |
| Checkout | `POST /checkout/quote` (advisory, reserves nothing) |
| Orders | `POST /orders` (requires an `Idempotency-Key` header) Â· `GET /orders` Â· `GET /orders/:id` Â· `POST /orders/:id/cancel` |
| Payments | `POST /payments/webhooks/sandbox` (HMAC `X-Sandbox-Signature`) Â· `POST /payments/sandbox/:paymentId/simulate` (outside production only) |
| Compare | `POST /discovery/compare`: LocalStock sellers and enabled external sources side by side, with partial results, freshness and provenance (contract in [docs/openapi.yaml](docs/openapi.yaml)) Â· `GET /discovery/stream?variantIds&cell` (authenticated server-sent events of detected external changes) |
| Catalogue import | `POST /companies/:id/catalogue-imports?dryRun=true\|false` (body `text/csv`, owners and admins only) |
| Admin | `GET /admin/companies?status` Â· `PATCH /admin/companies/:id/status` Â· `GET /admin/companies/:id/warehouses` Â· `PATCH /admin/warehouses/:id/status` |
| Product matching review (admin) | `GET /admin/product-mapping/review-queue` Â· `POST /admin/product-mapping/:mappingId/decision` (`CONFIRM` / `REJECT`) Â· `POST /admin/product-mapping/listings/:listingId/manual` Â· `GET /admin/catalog/variants/review-queue` |

**Catalogue import CSV.** Columns: `sku`, `barcode` or `variant_id`, `price`, and optionally `mrp`, `warehouse`, `quantity`.
- `price` and `mrp` are in rupees, e.g. `45.50`. A blank `mrp` keeps the current one.
- `warehouse` is a store name or id. `quantity` sets the on-hand count; it is not added to it.
- Products must already be in the catalogue.
- A dry run shows what would change. Otherwise the whole file is applied in one transaction, or nothing is applied if any row has an error.
- Every change is audited with `source_of_change = CSV_IMPORT`.

Health checks: `GET /health/live` (the process is up) and `GET /health/ready` (PostgreSQL and Redis are reachable and the process isn't shutting down).

Errors always have this shape: `{ "error": { "code", "message", "details", "requestId" } }`.

## Correctness design

- **No overselling.** Rows are locked in id order, then each one gets a conditional `UPDATE â€¦ WHERE on_hand - reserved >= qty`. The table also enforces `CHECK (reserved <= on_hand)`. Redis is never asked whether stock exists.
- **Atomic order placement.** The reservation, order, items, shipments, allocations, reservation records, payment record, outbox event and stored idempotency response all commit in one transaction.
- **Idempotency.** A key is scoped to a user and stores a hash of the request body. A replay returns the stored response, and reusing a key with a different body returns 422.
- **Expiry versus payment race.** Both paths lock the order row first and change reservations with a conditional `ACTIVE â†’` update, so only one of them can win. A payment that arrives after expiry is moved to `REFUND_PENDING`. Stock is never shipped without a live reservation.
- **Events.** Delivery is at least once (outbox, then RabbitMQ with publisher confirms), and consumers deduplicate through `inbox_events`. Failures retry with exponential backoff and jitter, then go to the dead-letter queue.

See [docs/adr/README.md](docs/adr/README.md) for the reasoning and trade-offs.

## Known gaps and next steps

1. Production hosting for `apps/web`: the dev server proxies to the API, so a deployment needs the same reverse proxy or CORS on the API.
2. Shipment lifecycle after confirmation: pickup, tracking webhooks, `CONSUMED` reservations and `DISPATCH` movements.
3. Refund execution (the `PaymentRefundRequested` event is emitted, but nothing processes it yet), and re-reserving stock for late payments.
4. Prometheus metrics and Grafana dashboards, AWS deployment, and runbooks.
5. Polygon service areas (warehouses currently use a radius).
6. Refresh tokens in HttpOnly cookies for the browser apps.
