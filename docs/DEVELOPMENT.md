# Development

## Tests

```powershell
npm test                                   # unit and HTTP tests, no infrastructure needed
$env:RUN_DB_TESTS='1'; npm run test:db     # database tests in a separate localstock_test database
npm run bench -w @localstock/allocation-engine
k6 run scripts/k6/search.js
```

The database tests check the core invariants directly: 100 concurrent single-unit reservations
against 5 units in stock give exactly 5 successes, and racing releases return stock exactly once.

### Endpoint smoke test

`scripts/smoke-endpoints.mjs` calls every backend route (89 checks across 58 routes): success
paths, permission and validation failures, the full order and payment flow, CSV import, admin
actions, matching review and the live stream. It creates its own data, so run it against an API
connected to a throwaway database whose name ends in `_smoke`, with the demo source on.

```powershell
docker exec localstock-postgres psql -U localstock -d postgres -c "CREATE DATABASE localstock_smoke"
$env:DATABASE_URL='postgres://localstock:localstock_dev_password@localhost:5432/localstock_smoke'
npm run db:migrate

# API on port 5055, Redis db 1, demo external source enabled
$env:API_PORT='5055'; $env:REDIS_URL='redis://localhost:6379/1'; $env:DEMO_EXTERNAL_FIXTURES='true'
node apps/api/src/server.js

# in another terminal
$env:SMOKE_API='http://localhost:5055'
$env:SMOKE_DATABASE_URL='postgres://localstock:localstock_dev_password@localhost:5432/localstock_smoke'
node scripts/smoke-endpoints.mjs
```

`scripts/demo.ps1` runs a short happy path against the dev API: search, quote, idempotent order,
signed sandbox payment.

## Useful URLs

| Service | URL |
|---|---|
| Web app | http://localhost:5173 |
| API | http://localhost:5000/api/v1 |
| Health | http://localhost:5000/health/ready |
| RabbitMQ management | http://localhost:15672 (user `localstock`, password `localstock_dev_password`) |

## API reference

The full API is described in [openapi.yaml](openapi.yaml). The web app also includes an API explorer at `/explorer`.
