# Project status

| Area | State |
|---|---|
| Repository, infrastructure, backend foundation | Done: config validation, health and readiness checks, graceful shutdown |
| Identity and tenancy | Done: scrypt passwords, JWT access tokens plus rotating refresh tokens with reuse detection, company roles |
| Catalog and sellers | Done: categories, groups, variants with barcode and normalized matching plus a review queue, offers |
| Warehouse inventory | Done: PostGIS warehouses, audited adjustments, movement ledger, tenant trigger |
| Discovery | Done: full-text and trigram search, service-area filtering, offer sorting, Redis cache |
| Allocation | Done: staged heuristic, delivery feasibility, scoring, tests, micro-benchmark |
| Checkout | Done: Idempotency-Key, atomic multi-row reservations, orders and shipments, sandbox payments |
| Reliability | Done: outbox and inbox, publisher confirms, retries with a dead-letter queue, expiry job, reconciliation |
| Delivery | Partial: provider model, quoting and assignment at checkout. Live tracking events are not built yet |
| Production readiness | Mostly done: CI (GitHub Actions), Dockerfiles for API, worker and website, Prometheus metrics, data retention, [runbook](RUNBOOK.md), free public deployment ([guide](DEPLOY_FREE.md)). Not yet: Grafana dashboards. A k6 script exists |
| External platform discovery | Built behind authorized access only: connector framework, compare API, matching and review, background collection, live feed, comparison UI, price history. No platform is connected yet ([why](platforms/README.md)) |
| Frontends | Done (`apps/web`): shop, cart and checkout, orders and sandbox payment, seller hub with dashboards, admin console, API explorer |

## Known gaps and next steps

1. Shipment lifecycle after confirmation: pickup, tracking webhooks, `CONSUMED` reservations and `DISPATCH` movements.
2. Refund execution (the `PaymentRefundRequested` event is emitted, but nothing processes it yet), and re-reserving stock for late payments.
3. Grafana dashboards and alert rules from the metrics listed in the runbook.
4. Polygon service areas (warehouses currently use a radius).
5. Refresh tokens in HttpOnly cookies for the browser apps.
