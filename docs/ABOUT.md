# About LocalStock

LocalStock is a multi-vendor, multi-warehouse quick-commerce platform. Shoppers set a delivery location, see every nearby seller's price, stock and delivery time for a product, and check out one cart that the allocation engine fulfils from the best mix of warehouses and couriers. Sellers manage warehouses, stock and offers; admins manage the catalog.

## Tech stack

Everything is JavaScript (Node ES modules) in one repository split with npm workspaces.

| Part | Folder | Built with |
|---|---|---|
| REST API | `apps/api` | Express 5, zod (validation), jsonwebtoken (JWT access + rotating refresh tokens, scrypt passwords), pg (plain SQL, no ORM), ioredis |
| Background worker | `apps/worker` | amqplib (RabbitMQ), pg, ioredis. Publishes outbox events, expires stock holds, runs reconciliation, refreshes external sources, checks source health, applies data retention |
| Website | `apps/web` | React 18, Vite, React Router 6, Tailwind CSS 3.4, shadcn/ui on Radix UI, MUI 6 + MUI X Charts (seller/admin), framer-motion, lucide-react, Sonner |
| Database layer | `packages/database` | SQL migrations, connection pool, transaction helpers |
| Allocation engine | `packages/allocation-engine` | Pure JavaScript, no dependencies. Plans warehouses and couriers by cost and ETA |
| Logging | `packages/logger` | Structured JSON logs with redaction of credentials and personal data |
| External sources | `packages/connectors` | Connector contract, resilience (timeouts, rate limits, retries, circuit breaker), disabled platform adapters, licensed-provider adapter, development-only demo source |
| External data | `packages/external-data` | Quality checks, product matching, freshness, observations and change detection, background collection, source health, retention |
| Metrics | `packages/metrics` | Prometheus text format, no dependencies |

Infrastructure services:

| Service | Version | Used for |
|---|---|---|
| PostgreSQL + PostGIS | 16 + 3.4 | Source of truth for catalog, stock, orders and payments; PostGIS does the "sellers within N km" queries |
| Redis | 7 | Search cache and rate limiting (fails open: an outage makes things slower, never wrong) |
| RabbitMQ | 3 | Event bus between the API and the worker (topic exchange `localstock.events`, dead-letter queue) |

Tests use Node's built-in runner (`node:test`) and supertest. Database tests run against a separate `localstock_test` database. Product data and images come from [Open Food Facts](https://world.openfoodfacts.org) (CC BY-SA) and are stored in the repo. Payments use a built-in sandbox and delivery fleets are simulated, so no paid accounts are needed.

## Running it locally

Install **Node.js 20.6+**, **Docker Desktop** (on Windows it needs **WSL 2**) and **Git**. Docker runs PostgreSQL, Redis and RabbitMQ for you from `docker-compose.yml`.

```bash
git clone https://github.com/vjat5452/Master-App.git
cd Master-App
cp .env.example .env          # Windows: copy .env.example .env
npm install
npm run infra:up              # Postgres, Redis, RabbitMQ in Docker
npm run db:migrate
npm run db:seed               # demo users, sellers, warehouses, 505 products
npm run dev:api               # http://localhost:5000
npm run dev:worker
npm run dev:web               # http://localhost:5173
```

Demo logins all use the password `localstock-dev-password` (for example `customer@localstock.dev`). See the README for the full list.

## Deploying online

**Docker is not required in production.** Locally it is only a convenient way to run the three infrastructure services. Online you have two options.

### Option A: managed services (recommended)

Use a hosted service for each piece, so nothing needs Docker:

| Piece | What to run | Example providers |
|---|---|---|
| PostgreSQL with PostGIS | Managed database; enable the `postgis` extension | Neon, Supabase, Render Postgres, AWS RDS, Google Cloud SQL |
| Redis | Managed Redis (a `rediss://` URL works with ioredis) | Upstash, Redis Cloud, Render Key Value |
| RabbitMQ | Managed broker (`amqps://` URL) | CloudAMQP, Amazon MQ |
| API | Always-on Node web service: `npm ci && npm start -w @localstock/api` | Render, Railway, Fly.io, AWS App Runner |
| Worker | Always-on background process: `npm start -w @localstock/worker` | Render Background Worker, Railway, Fly.io |
| Website | Static site: `npm run build:web`, publish `apps/web/dist` | Vercel, Netlify, Cloudflare Pages, Render Static Site |

### Railway (the live demo)

Step-by-step guide: [DEPLOY_RAILWAY.md](DEPLOY_RAILWAY.md).

### Option B: one server with Docker Compose

Rent one VM (DigitalOcean, AWS EC2, Hetzner, …), install Docker, copy `.env` with production secrets, and run:

```bash
docker compose -f docker-compose.yml -f docker-compose.app.yml up -d --build
```

This builds three images (`apps/api/Dockerfile`, `apps/worker/Dockerfile`, `apps/web/Dockerfile`), runs migrations once, then starts the API, the worker and the website on port 8080. The website image is nginx: it serves the site and forwards `/api` and `/health` to the API, so the browser sees one origin. Put a TLS proxy (Caddy, or a cloud load balancer) in front of port 8080. This option is cheaper at small scale, but you manage backups, updates and TLS yourself.

The same images also work on container platforms (Fly.io, Render, AWS ECS, Cloud Run), with managed PostgreSQL, Redis and RabbitMQ from option A.

### Things to set up for any deployment

- **Environment variables:** set everything from `.env.example` on the API and worker. Use real, long random values for `JWT_ACCESS_SECRET` and `PAYMENT_WEBHOOK_SECRET`, `NODE_ENV=production`, and point `DATABASE_URL`, `REDIS_URL` and `RABBITMQ_URL` at the managed services. The API listens on `API_PORT`, so set it to the port your host expects.
- **Migrations:** run `npm run db:migrate` once per release, before the new API version starts. Run `npm run db:seed` only if you want the demo data.
- **Same-origin API:** the website calls the API at the relative path `/api/v1` and the API does not enable CORS. Serve both under one domain: add a rewrite on the static host (for example Vercel/Netlify `/api/*` → `https://<your-api-host>/api/*`) or put both behind one reverse proxy.
- **The worker must always run.** Without it, order events are not published and expired stock holds are not released.
- **Health checks:** point the host's health check at `/health/live` (process up) and use `/health/ready` to see whether Postgres and Redis are reachable. The worker serves `/health/live` on `WORKER_METRICS_PORT` (9100 in its image).
- **Metrics:** set `METRICS_TOKEN` and scrape `/metrics` on the API and `:9100/metrics` on the worker with `Authorization: Bearer <token>`. Without a token, metrics are off in production.
- **Never enable `DEMO_EXTERNAL_FIXTURES` in production.** The API and worker refuse to start with it.

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request:
- unit and HTTP tests;
- database tests against a PostGIS service, after applying, rolling back and re-applying the migrations;
- the website build;
- `npm audit` (fails on high or critical advisories in production dependencies);
- builds of all three images.

## Operating it

[RUNBOOK.md](RUNBOOK.md) covers:
- releases and rollbacks;
- configuration;
- the metrics to alert on;
- data retention;
- what to do for common incidents (events not delivered, dead-lettered messages, a failing external source, stuck jobs).
