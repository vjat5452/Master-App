# Architecture decision records

Each record gives the context, the decision, the alternatives, the consequences and what would make us revisit it. When a decision is superseded, add a new record and leave the old one in place.

## ADR-001: Start with a modular monolith

- **Context:** One small team, an evolving domain, and the need to debug end-to-end flows easily.
- **Decision:** One Express API with module folders (`apps/api/src/modules/*`) plus a separate worker process. Both share one PostgreSQL database.
- **Alternatives:** Microservices per domain. Rejected because of distributed transactions, deployment overhead and harder local development.
- **Consequences:** Module boundaries are a convention, so keep cross-module calls to exported service functions. Shared transactional helpers live in `packages/database`.
- **Revisit when:** Team ownership boundaries or measured scaling needs justify extracting inventory or orders.

## ADR-002: PostgreSQL is the source of truth

- **Decision:** All stock, order and payment state lives in PostgreSQL, guarded by constraints (`CHECK (reserved <= on_hand)`, unique keys and a tenant trigger) and by transactions. PostGIS handles geospatial filtering.
- **Revisit when:** A measured availability or throughput requirement can't be met by this topology (read replicas included).

## ADR-003: Redis is a cache, not an authority

- **Decision:** Redis holds search results (with a version-key invalidation scheme) and rate-limit counters. Every Redis call fails open: an outage makes the API slower, not wrong.
- **Never relax:** Redis is never consulted to decide whether stock can be reserved.

## ADR-004: RabbitMQ for asynchronous events

- **Decision:** A topic exchange `localstock.events` with routing key `<aggregate>.<Event>`. Each consumer has a durable queue and dead-letters to `localstock.dead-letter`.
- **Revisit when:** Throughput, replay or retention needs outgrow the broker.

## ADR-005: Atomic SQL reservations

- **Decision:** Lock the needed rows with `SELECT … ORDER BY id FOR UPDATE` (deterministic order, so no deadlocks), then run a conditional `UPDATE … WHERE on_hand - reserved >= qty` on each row and check every row count. The whole order is written in the same transaction.
- **Alternatives:** Optimistic `version` checks, which retry heavily under contention. Redis decrement, which offers no durable truth.
- **Revisit when:** Measured hot-row contention needs a different approach, such as sharded stock buckets, that keeps the invariant.

## ADR-006: Transactional outbox and idempotent consumers

- **Decision:** Business changes and their `outbox_events` row commit together. The worker publishes with publisher confirms and `FOR UPDATE SKIP LOCKED`. Consumers record `(consumer, message_id)` in `inbox_events` in the same transaction as their effects.
- **Guarantee:** Delivery is at least once, and each business effect happens exactly once. We never claim exactly-once delivery.

## ADR-007: Hybrid delivery provider abstraction

- **Decision:** Seller fleet, platform fleet and third-party providers are rows with one pricing and ETA model. A seller fleet can only carry its own company's shipments, which is enforced in the allocation engine and by a table CHECK. Fleets are simulated in the MVP.
- **Revisit when:** Integrating a real provider. Put its API behind `getQuote`, `createDelivery`, `cancelDelivery` and `trackDelivery`.

## ADR-008: Staged allocation heuristic

- **Decision:** The stages are A (one warehouse), B (one warehouse per line) and C (split quantities). Delivery quotes are attached to every plan, and plans are ranked by normalized landed cost, the slowest shipment's ETA, shipment count and risk.
- **Limitations:** This is a heuristic, not a proven optimum. Stage B uses greedy set cover, and stage C fills from preferred warehouses first.
- **Revisit when:** Benchmarks (`npm run bench -w @localstock/allocation-engine`) show unacceptable latency, or an exact solver such as OR-Tools finds materially better plans on small instances.

## ADR-009: Separate variant, seller offer and inventory

- **Decision:** `product_variants` holds identity, `seller_offers` holds commerce (one per company and variant), and `warehouse_inventory` holds stock. Matching uses the barcode first, then a normalized brand, name and attributes key. Similar names without a distinguishing attribute go to `PENDING_REVIEW` and are never merged silently.
