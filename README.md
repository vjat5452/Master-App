# LocalStock

LocalStock is a multi-vendor, multi-warehouse commerce and fulfillment platform. Sellers list standardized product variants and keep stock in several warehouses. Customers compare seller offers by price, availability and delivery estimate. Checkout allocates the cart across warehouses and delivery providers, then reserves stock atomically.

**Stack:** Node.js · Express 5 · PostgreSQL + PostGIS · Redis · RabbitMQ · Zod · Docker

```
apps/
  web/        Vite + React UI (Tailwind CSS, shadcn/ui, Material UI charts): shop, checkout,
              orders, seller hub, admin, API explorer; light and dark themes
  api/        Express modular monolith (auth, organizations, warehouses, catalog, offers,
              inventory, discovery, checkout, orders, payments, delivery)
  worker/     outbox publisher, reservation expiry, reconciliation, idempotent consumers
packages/
  database/   SQL migrations, migration runner, transactional domain helpers
              (reserve/release stock, order state machine, outbox)
  allocation-engine/  pure warehouse + delivery allocation (no Express, no DB)
  logger/     structured JSON logger
docs/adr/     architecture decision records
scripts/      demo walkthrough (PowerShell), k6 load test
```

## Status

| Blueprint phase | State |
|---|---|
| 1–3 Repository, infrastructure, backend foundation | Done: config validation, health and readiness checks, graceful shutdown |
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
npm run db:seed                  # demo sellers, warehouses, providers + 69-product catalog with photos

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
| `seller.c@` … `seller.g@localstock.dev` | Owners of Gurgaon Fresh Bazaar, Dwarka Kirana Co., Rohini SuperMart, East Delhi Grocers, Saket Gourmet Pantry |
| `customer@localstock.dev` | Customer |

The RabbitMQ management UI is at http://localhost:15672 (user `localstock`, password `localstock_dev_password`).

## Tests

```powershell
npm test                                   # unit and HTTP tests, no infrastructure needed
$env:RUN_DB_TESTS='1'; npm run test:db     # concurrency tests in a separate localstock_test database
npm run bench -w @localstock/allocation-engine
k6 run scripts/k6/search.js
```

The database tests check the blueprint's invariants directly: 100 concurrent single-unit reservations against 5 units in stock give exactly 5 successes, and racing releases return stock exactly once.

## API (`/api/v1`)

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register` · `POST /auth/login` · `POST /auth/refresh` · `POST /auth/logout` · `GET /users/me` |
| Companies | `POST /companies` · `GET /companies` · `POST/GET /companies/:id/members` |
| Warehouses | `POST/GET /companies/:id/warehouses` · `PATCH /companies/:id/warehouses/:warehouseId` |
| Delivery | `POST/GET /companies/:id/delivery-providers` (seller fleet) · `POST /admin/delivery-providers` · `GET /delivery/providers` |
| Catalog | `GET/POST /catalog/categories` · `POST /catalog/groups` · `GET /catalog/groups/:id` · `POST /catalog/variants` · `GET /catalog/variants/:id` · `PATCH /catalog/variants/:id/status` |
| Offers | `POST/GET /companies/:id/offers` · `PATCH /companies/:id/offers/:offerId` |
| Inventory | `POST /companies/:id/inventory/adjustments` · `GET /companies/:id/inventory` |
| Discovery | `GET /catalog/search?q&lat&lng&radiusKm&sort&page&limit` · `GET /catalog/variants/:id/offers` |
| Checkout | `POST /checkout/quote` (advisory, reserves nothing) |
| Orders | `POST /orders` (requires an `Idempotency-Key` header) · `GET /orders` · `GET /orders/:id` · `POST /orders/:id/cancel` |
| Payments | `POST /payments/webhooks/sandbox` (HMAC `X-Sandbox-Signature`) · `POST /payments/sandbox/:paymentId/simulate` (outside production only) |

Health checks: `GET /health/live` (the process is up) and `GET /health/ready` (PostgreSQL and Redis are reachable and the process isn't shutting down).

Errors always have this shape: `{ "error": { "code", "message", "details", "requestId" } }`.

## Correctness design

- **No overselling.** Rows are locked in id order, then each one gets a conditional `UPDATE … WHERE on_hand - reserved >= qty`. The table also enforces `CHECK (reserved <= on_hand)`. Redis is never asked whether stock exists.
- **Atomic order placement.** The reservation, order, items, shipments, allocations, reservation records, payment record, outbox event and stored idempotency response all commit in one transaction.
- **Idempotency.** A key is scoped to a user and stores a hash of the request body. A replay returns the stored response, and reusing a key with a different body returns 422.
- **Expiry versus payment race.** Both paths lock the order row first and change reservations with a conditional `ACTIVE →` update, so only one of them can win. A payment that arrives after expiry is moved to `REFUND_PENDING`. Stock is never shipped without a live reservation.
- **Events.** Delivery is at least once (outbox, then RabbitMQ with publisher confirms), and consumers deduplicate through `inbox_events`. Failures retry with exponential backoff and jitter, then go to the dead-letter queue.

See [docs/adr/README.md](docs/adr/README.md) for the reasoning and trade-offs.

## Known gaps and next steps

1. Production hosting for `apps/web`: the dev server proxies to the API, so a deployment needs the same reverse proxy or CORS on the API. There is also no admin endpoint to list variants awaiting review yet.
2. Shipment lifecycle after confirmation: pickup, tracking webhooks, `CONSUMED` reservations and `DISPATCH` movements.
3. Refund execution (the `PaymentRefundRequested` event is emitted, but nothing processes it yet), and re-reserving stock for late payments.
4. Prometheus metrics and Grafana dashboards, AWS deployment, and runbooks.
5. Polygon service areas (warehouses currently use a radius).
6. Refresh tokens in HttpOnly cookies for the browser apps.
