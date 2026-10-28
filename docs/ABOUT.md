# About LocalStock

LocalStock is a multi-vendor, multi-warehouse quick-commerce platform. Shoppers set a delivery location, see every nearby seller's price, stock and delivery time for a product, and check out one cart that the allocation engine fulfils from the best mix of warehouses and couriers. Sellers manage warehouses, stock and offers; admins manage the catalog.

## Tech stack

Everything is JavaScript (Node ES modules) in one repository split with npm workspaces.

| Part | Folder | Built with |
|---|---|---|
| REST API | `apps/api` | Express 5, zod (validation), jsonwebtoken (JWT access + rotating refresh tokens, scrypt passwords), pg (plain SQL, no ORM), ioredis |
| Background worker | `apps/worker` | amqplib (RabbitMQ), pg, ioredis. Publishes outbox events, expires stock holds, runs reconciliation |
| Website | `apps/web` | React 18, Vite, React Router 6, Tailwind CSS 3.4, shadcn/ui on Radix UI, MUI 6 + MUI X Charts (seller/admin), framer-motion, lucide-react, Sonner |
| Database layer | `packages/database` | SQL migrations, connection pool, transaction helpers |
| Allocation engine | `packages/allocation-engine` | Pure JavaScript, no dependencies. Plans warehouses and couriers by cost and ETA |
| Logging | `packages/logger` | Structured JSON logs |

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

### Option B: one server with Docker Compose

Rent one VM (DigitalOcean, AWS EC2, Hetzner, …), install Docker, and run the same `docker-compose.yml` plus the API, worker and a reverse proxy (Nginx or Caddy) serving the built website. This is cheaper at small scale but you manage backups, updates and TLS yourself. Dockerfiles for the API and worker would need to be added for this option.

### Things to set up for any deployment

- **Environment variables:** set everything from `.env.example` on the API and worker. Use real, long random values for `JWT_ACCESS_SECRET` and `PAYMENT_WEBHOOK_SECRET`, `NODE_ENV=production`, and point `DATABASE_URL`, `REDIS_URL` and `RABBITMQ_URL` at the managed services. The API listens on `API_PORT`, so set it to the port your host expects.
- **Migrations:** run `npm run db:migrate` once per release, before the new API version starts. Run `npm run db:seed` only if you want the demo data.
- **Same-origin API:** the website calls the API at the relative path `/api/v1` and the API does not enable CORS. Serve both under one domain: add a rewrite on the static host (for example Vercel/Netlify `/api/*` → `https://<your-api-host>/api/*`) or put both behind one reverse proxy.
- **The worker must always run.** Without it, order events are not published and expired stock holds are not released.
- **Health checks:** point the host's health check at `/health/live` (process up) and use `/health/ready` to see whether Postgres and Redis are reachable.
