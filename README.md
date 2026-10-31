# LocalStock

Hyperlocal commerce platform: local sellers list products and stock across their warehouses,
shoppers find what is available near them, compare prices, and order with stock reserved at
checkout.

## Features

- **Location-aware search**: full-text and fuzzy search, filtered to warehouses that deliver to the shopper (PostGIS).
- **Multi-warehouse checkout**: an allocation engine splits a cart across warehouses and delivery providers, ranked by cost and delivery time.
- **No overselling**: stock is reserved atomically in PostgreSQL; orders are idempotent.
- **Reliable events**: transactional outbox, RabbitMQ, and idempotent consumers with retries and a dead-letter queue.
- **Price comparison and history**: price graph per product, and comparison with other platforms through authorized sources only.
- **Seller and admin tools**: warehouses, offers, inventory, CSV import, product matching review, dashboards.

## How it works

```
Web app (React)  ──►  API (Express)  ──►  PostgreSQL + PostGIS   source of truth
                          │                Redis                 cache, rate limits
                          ▼
                 Worker  ◄──►  RabbitMQ                          events, background jobs
```

The API handles requests in a single modular monolith. Each state change is written together
with an outbox event in one transaction; the worker publishes those events to RabbitMQ and runs
background jobs such as reservation expiry and reconciliation. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for diagrams and design decisions.

## Tech stack

Node.js 20 · Express 5 · PostgreSQL 16 + PostGIS · Redis 7 · RabbitMQ 3 · React 18 + Vite · Tailwind CSS · Docker

## Getting started

**Prerequisites:** Node.js 20.6+ and Docker Desktop.

```bash
git clone https://github.com/vjat5452/Master-App.git
cd Master-App
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
npm install

npm run infra:up            # PostgreSQL, Redis, RabbitMQ in Docker
npm run db:migrate
npm run db:seed             # demo sellers, warehouses and a 500-product catalogue
```

Start each in its own terminal:

```bash
npm run dev:api             # http://localhost:5000
npm run dev:worker
npm run dev:web             # http://localhost:5173
```

Open http://localhost:5173 and sign in with a demo account (password `localstock-dev-password`):

| Email | Role |
|---|---|
| `customer@localstock.dev` | Customer |
| `seller.a@localstock.dev` | Seller (FreshMart Noida) |
| `admin@localstock.dev` | Platform admin |

## Tests

```bash
npm test                                    # unit and HTTP tests
RUN_DB_TESTS=1 npm run test:db              # database tests (PowerShell: $env:RUN_DB_TESTS='1'; npm run test:db)
```

The endpoint smoke test, benchmarks and other tooling are described in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Project structure

```
apps/
  api/          REST API (Express modular monolith)
  worker/       outbox publisher, consumers, scheduled jobs
  web/          React frontend
packages/
  database/           migrations and transactional helpers
  allocation-engine/  warehouse and delivery allocation
  connectors/         external platform sources
  external-data/      matching, freshness and collection
  logger/, metrics/   shared utilities
docs/           architecture, decisions, runbook, deployment
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Architecture decision records](docs/adr/README.md)
- [Development and testing](docs/DEVELOPMENT.md)
- [API (OpenAPI)](docs/openapi.yaml)
- [Free deployment guide](docs/DEPLOY_FREE.md)
- [Runbook](docs/RUNBOOK.md)
- [Project status and roadmap](docs/PROJECT_STATUS.md)
