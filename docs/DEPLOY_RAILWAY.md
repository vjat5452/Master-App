# Deploying LocalStock on Railway

The live demo runs as seven Railway services in one project: three databases from Railway templates, and the website, API and worker built from this repository's Dockerfiles.

| Service | Source | Public? |
|---|---|---|
| `PostGIS` | Railway template [PostGIS](https://railway.com/deploy/postgis) (`postgis/postgis` image; **plain Postgres will not work**, the schema needs the PostGIS extension) | No |
| `Redis` | Railway Redis database | No |
| `RabbitMQ` | Railway RabbitMQ template | No |
| `api` | This repo, config file `/deploy/railway/api.json` | No (reached through `web`) |
| `worker` | This repo, config file `/deploy/railway/worker.json` | No |
| `web` | This repo, config file `/deploy/railway/web.json` | **Yes**: the only public domain |

The website's nginx serves the site and forwards `/api` and `/health` to the API over Railway's private network. The browser sees one domain, and the API needs no CORS.

## 1. Create the project and databases

1. Create a Railway project.
2. Add the databases:
   - **PostGIS**: `+ New` → `Template` → search "PostGIS" → deploy. Use one based on the official `postgis/postgis` image.
   - **Redis**: `+ New` → `Database` → `Redis`.
   - **RabbitMQ**: `+ New` → `Template` → "RabbitMQ".
3. Rename the services `PostGIS`, `Redis` and `RabbitMQ`, so the variable references below work as written.
4. Open each one's **Variables** tab and note the variable that holds its connection URL. Postgres and Redis normally expose `DATABASE_URL` and `REDIS_URL`; for RabbitMQ, use whichever variable holds the `amqp://` URL.

## 2. Add the three app services

For each of `api`, `worker` and `web`:
1. `+ New` → `GitHub Repo` → this repository, branch `main`.
2. Rename the service (`api`, `worker`, `web`).
3. **Settings → Config-as-code**: set the Railway config file path to `/deploy/railway/api.json`, `/deploy/railway/worker.json` or `/deploy/railway/web.json`.
   - If the setting is not available, set the service variable `RAILWAY_DOCKERFILE_PATH` to `apps/api/Dockerfile`, `apps/worker/Dockerfile` or `apps/web/Dockerfile`.
   - Then, for `api`, set the pre-deploy command to `node apps/api/src/scripts/release.js` and the health check to `/health/ready` by hand.

## 3. Variables

Generate secrets locally with:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**api**

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `5000` (fixed, so `web` can reach it) |
| `DATABASE_URL` | `${{PostGIS.DATABASE_URL}}` |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` |
| `JWT_ACCESS_SECRET` | a generated secret (64 hex characters) |
| `PAYMENT_WEBHOOK_SECRET` | another generated secret |
| `SEED_DEMO_DATA` | `true`: loads the demo sellers, stores and 505 products on first deploy (safe to keep: it never duplicates) |
| `SEED_PASSWORD` | **required with demo data**: 16+ characters. It is the password of every demo account, including the platform admin (`admin@localstock.dev`), so keep it private. |
| `ENABLE_SANDBOX_PAYMENTS` | `true`, so visitors can try checkout with the sandbox "pay" button (no real money) |
| `METRICS_TOKEN` | optional; enables `/metrics` with this bearer token |

**worker**

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `${{PostGIS.DATABASE_URL}}` |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` |
| `RABBITMQ_URL` | `${{RabbitMQ.<its amqp URL variable>}}` |

**web**

| Variable | Value |
|---|---|
| `API_UPSTREAM` | `http://${{api.RAILWAY_PRIVATE_DOMAIN}}:5000` |
| `VITE_DEMO_NOTICE` | `on` (keeps the "Demo environment" banner; used at build time) |

**Never set `DEMO_EXTERNAL_FIXTURES=true`.** The API and worker refuse to start with it in production. The comparison then lists the real platforms as "not connected", which is the truth.

## 4. Deploy and open

1. Deploy `api` first. Its pre-deploy step runs the migrations and seeds the demo data, so watch its deploy log for `release: done`.
2. Then deploy `worker` and `web`.
3. On `web`: **Settings → Networking → Generate Domain**. That URL is the live site.

Check:
- `https://<web domain>/health/ready` returns `{"status":"ready",...}`.
- The shop loads. Set the delivery location to India Gate: the demo sellers are in Delhi and Noida.
- Sign in as `customer@localstock.dev` with your `SEED_PASSWORD` and place an order. Pay with the sandbox button.

## Notes

- **Cost.** These services run continuously (the worker must always run), so this needs a paid Railway plan. Usage is billed per resource.
- **Releases.** A push to `main` redeploys the services whose watch paths changed. Migrations run before each API release (`release.js`). See [RUNBOOK.md](RUNBOOK.md) for monitoring, retention and incidents.
- **Logins.** The demo accounts are listed in the README; on this deployment they use `SEED_PASSWORD`, not the README's development password.
