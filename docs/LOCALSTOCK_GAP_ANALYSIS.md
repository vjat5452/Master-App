# LocalStock: gap analysis (Milestone 1)

Compares the current repository (`docs/LOCALSTOCK_CURRENT_ARCHITECTURE.md`) with the Master Engineering Prompt for unified first-party vendor + external quick-commerce discovery. Each row says whether the capability is **Implemented**, needs to be **Extended**, must be **Added**, or should **Not change**.

## 1. Concept mapping: blueprint names → existing names

The blueprint says to reuse existing models and naming. LocalStock already has most first-party entities under different names; no duplicate tables should be created.

| Blueprint concept | Existing equivalent | Status |
|---|---|---|
| vendors | `companies` (+ `company_members`) | Implemented; Extend (vendor type, contact, admin approve/suspend endpoint) |
| vendor_warehouses / stores | `warehouses` | Implemented; Extend (contact, hours optional, admin disable) |
| service_areas | `warehouses.service_radius_m` | Implemented as radius; polygons remain a later option (README gap 5) |
| canonical_products | `product_variants` (sellable identity, barcode, `normalized_key`) under `product_groups`/`categories` | Implemented; Extend (parsed pack size/unit) |
| product_variants | `product_variants` | Implemented |
| vendor_products / listings | `seller_offers` (one per company + variant) | Implemented |
| vendor_prices | `seller_offers.price_minor` | Implemented; Extend (MRP; price history is only in `audit_logs`) |
| vendor_offers (discounts/promos) | — | Add (later; not needed for the comparison foundation) |
| inventory | `warehouse_inventory` | Implemented (strong invariants) |
| stock_movements | `inventory_movements` | Implemented |
| vendor_users and permissions | `company_members` roles OWNER/ADMIN/STAFF + `requireCompanyRole` | Implemented |
| audit fields | `audit_logs` table (actor, before/after) | Implemented as a log table; Extend with `source_of_change` |

## 2. Capability gaps by phase

### Phase 1: Domain model, two supply channels

| Capability | Status | Notes |
|---|---|---|
| First-party entities | Implemented | See mapping above |
| `external_platforms`, `external_sources` (access type, authorization status, config reference) | Add | Registry; config holds a reference to env/secret names, never secrets |
| `external_fulfillment_nodes` | Add | Only rows a source verifiably provides; coordinates nullable |
| `external_listings` | Add | Platform listing identity, raw title, parsed variant, identifiers |
| `external_product_mappings` | Add | listing → `product_variants.id`, method, confidence, status, evidence, reviewer |
| `external_price_observations`, `external_availability_observations`, `external_offer_observations`, `external_serviceability_observations` | Add | Append-only, `source_observed_at` / `collected_at` / `stored_at` separate |
| `external_collection_jobs`, `external_collection_runs`, `external_source_health`, `external_change_events` | Add | `external_change_events` can reuse `outbox_events` for publication |
| Unified discovery DTO (`sourceType`, provenance, freshness, `orderCapability`) | Add | Normalize at the service boundary; first-party persistence unchanged |

### Phase 2: Canonical catalogue and matching

| Capability | Status | Notes |
|---|---|---|
| GTIN exact match | Implemented | Unique `barcode`; all 505 seeded variants have one |
| Brand + normalized attributes | Implemented | `variantKey()` |
| Fuzzy title as candidate only, manual review | Implemented for seller-proposed variants | Trigram ≥ 0.6 without a distinguishing attribute → `PENDING_REVIEW` |
| Pack-size / unit normalization (500 ml ≠ 1 l, multipacks) | Add | Attributes are free text (`"500 g"`); need a parser to `{quantity, unit, count}` with g/kg, ml/l, pcs |
| Manufacturer/model identifier | Add (optional) | Not in schema; rarely relevant to grocery |
| Stored `match_method`, `match_confidence`, `match_status`, evidence, reviewer | Add | For external mappings. Existing variant review has no queue endpoint (README gap 1) |
| Admin mapping review queue | Add | `GET /admin/product-mapping/review-queue` |

### Phase 3: Platform access research

| Capability | Status | Notes |
|---|---|---|
| Research record per platform (Blinkit, Zepto, Swiggy Instamart, BigBasket) | Add | `docs/platforms/*.md` + matrix. No access is currently held; every connector starts `RESEARCH_REQUIRED` / `NOT_CONFIGURED` |

### Phase 4: Connector framework

| Capability | Status | Notes |
|---|---|---|
| Connector contract, capability declaration, `UNSUPPORTED` results | Add | New shared package so API and worker use one implementation |
| Timeout, bounded concurrency, per-source rate limit, retry with backoff + jitter, circuit breaker, schema validation, error taxonomy, metrics | Add | Backoff helper exists in the worker (`backoffMs`); zod available for schema validation |
| `NotConfiguredConnector` for each platform | Add | Explicit `SOURCE_NOT_CONFIGURED` |
| Local vendor provider adapter | Add | Thin adapter over the existing `findOffers` discovery query, not a scraper |
| Licensed provider adapter | Add (disabled) | Only when a contract exists |
| Demo fixture source | Add (dev only) | Fictional source name, `DEMO` provenance, refused when `NODE_ENV=production` |

### Phase 5: Traditional vendor data management

| Capability | Status | Notes |
|---|---|---|
| Create/update warehouse with coordinates and service radius | Implemented | Address editable only at creation; extend PATCH for address/coordinates |
| Warehouse contact and hours | Add (optional) | Not modelled |
| Add products manually | Implemented | Seller proposes variant, then creates an offer |
| Edit price, status | Implemented | Offer PATCH |
| MRP | Add | `seller_offers.mrp_minor` nullable with `CHECK (mrp_minor >= price_minor)` where set |
| Update stock | Implemented | Adjustments with movement ledger and audit |
| CSV/XLSX import | Add | No import exists; CSV first (no new dependency), XLSX optional |
| Multiple warehouses | Implemented | |
| Admin approve/disable vendors and stores | Extend | `companies.status` exists, no admin endpoint; warehouses only toggled by the vendor |
| Tenant isolation | Implemented | Route check + DB trigger |
| External data cannot overwrite vendor prices/stock | Implemented by construction; must stay so | External data goes to separate tables only; add a regression test |

### Phase 6: Warehouse and geolocation

| Capability | Status | Notes |
|---|---|---|
| Verified first-party coordinates, distance, service check | Implemented | PostGIS `ST_DWithin` + `ST_Distance` |
| External serviceability separate from node identity | Add | Nullable node and distance; `distanceStatus` UNKNOWN when not verified |
| Query location stored with each serviceability observation | Add | Store a coarse cell (geohash ~1.2 km), not exact customer coordinates |
| Manual address/pincode, geocoding confidence | Add (later) | Location is chosen client-side today; no geocoding service |
| Location data minimization | Partial | Customer coordinates are stored only on orders/addresses; logs exclude query strings. Retention policy not defined |

### Phase 7: Data acquisition and freshness

| Capability | Status | Notes |
|---|---|---|
| Scheduled refresh by source/area/demand with dedup and run tracking | Add | Worker has `every()` and RabbitMQ; add a collection queue and job table |
| Customer-triggered concurrent lookup with partial results | Add | Discovery orchestrator |
| Per-source, per-field freshness policy | Add | Config, not one global TTL |
| `source_observed_at` vs `collected_at` vs `stored_at` | Add | |

### Phase 8: Normalization and data quality

| Capability | Status | Notes |
|---|---|---|
| Availability enum incl. `FETCH_FAILED` ≠ `OUT_OF_STOCK` | Add | First-party: in-stock is derived from `on_hand - reserved > 0` |
| Fee breakdown and `total_cost_completeness` | Add | First-party delivery fees exist only at checkout quote time; discovery shows item price + ETA estimate |
| Validation of prices, currency, timestamps, identifiers | Partial | First-party via zod + CHECKs; external needs schema validation per source |
| Raw payload retention controls | Add | Store only when permitted; redact |

### Phase 9: Unified discovery API

| Capability | Status | Notes |
|---|---|---|
| `POST /api/v1/discovery/compare` | Add | Existing `GET /catalog/search` and `/catalog/variants/:id/offers` stay unchanged for the storefront |
| Per-source timeout and partial failure summary | Add | |
| Known distance only from verified coordinates | Implemented for first-party | Keep; external distance null unless node verified |

### Phase 10: Ranking

| Capability | Status | Notes |
|---|---|---|
| Configurable scoring with reason codes | Extend | `sortOffers` uses a fixed 0.6/0.4 price/ETA weighting and no reason codes; the allocation engine has its own checkout scoring (unchanged) |
| Unknown distance ≠ 0, unavailable never ranked as available, missing fees reduce "cheapest" certainty | Add | Current `sortOffers` treats a null ETA as 0; acceptable today (first-party always has an ETA estimate when located) but the new ranker must not |

### Phase 11: Events and real-time

| Capability | Status | Notes |
|---|---|---|
| Transactional outbox, idempotent consumers, retry, DLQ | Implemented | Reuse for external events |
| Event naming | Extend | Existing convention is `<aggregate>.<PascalEvent>` (e.g. `offer.OfferUpdated`). Blueprint names map to e.g. `external_price.PriceChanged`; keep the existing convention |
| Versioned event schemas | Add | Add `schemaVersion` to new payloads; existing events unchanged |
| SSE/WebSocket push | Add | None today |

### Phase 12: Cache and jobs

| Capability | Status | Notes |
|---|---|---|
| Redis search cache with version invalidation | Implemented | |
| Latest observation cache, source health, dedup locks | Add | Keys must use geohash cell, not raw coordinates |
| Job priorities, per-source concurrency | Add | |

### Phase 13: Frontend

| Capability | Status | Notes |
|---|---|---|
| Storefront, product, cart, seller hub, admin | Implemented | Preserve design system |
| Source badges, freshness ("updated X ago"), known-total labels, deep-link vs checkout | Add | Product page comparison section |
| Admin: source configuration, connector status, last success, error rate, mapping review queue | Add | New admin tab |
| Vendor: CSV import, update history | Add | Update history can read `audit_logs` |
| Demo-data labelling | Add | Seeded seller prices/stock are generated; the UI should show a "demo data" notice outside production |

### Phase 14: Security, privacy, operations

| Capability | Status | Notes |
|---|---|---|
| AuthN/Z, tenant isolation, validation, rate limiting, request timeouts on DB | Implemented | Outbound HTTP timeouts are new (connectors) |
| Safe logs / PII redaction | Extend | Logger has no redaction; notification handler logs customer email (`handlers.js`). Add a redaction helper and stop logging email |
| Secrets via environment | Implemented | Add placeholder-only connector variables to `.env.example` |
| Source terms/permissions registry | Add | Part of `external_sources` + `docs/platforms` |
| Retention policies | Add | Observations and serviceability query cells |
| Dependency checks, CI | Add | No CI exists; `npm audit` in a workflow |

### Phase 15–16: Tests and deliverables

| Item | Status |
|---|---|
| Regression tests for vendor flows | Partial (HTTP validation/auth tests, DB concurrency tests, demo script). Add DB-backed tests for vendor onboarding → warehouse → offer → inventory |
| OpenAPI document | Add |
| Migrations reversible where practical | Extend: runner is forward-only; add `*.down.sql` companions and teach the runner to skip them on `up` |
| Runbook, setup guide | Partial (`README.md`, `docs/ABOUT.md`); add operations runbook |

## 3. What should not change

- Reservation and order invariants: `reserveInventory`, row locking order, `CHECK (reserved <= on_hand)`, tenant trigger, idempotency keys, expiry/payment race handling (ADR-005).
- Outbox/inbox mechanics and topology names (ADR-006); new queues are additive.
- Allocation engine and checkout quote/order flow; external platforms are never allocated or ordered through LocalStock.
- Existing public endpoints and their response shapes (`/catalog/search`, `/catalog/variants/:id/offers`, seller endpoints). The new compare API is additive.
- Money in integer minor units; PostgreSQL as source of truth; Redis fail-open.

## 4. External dependency blockers

| Blocker | Impact |
|---|---|
| No authorized access to Blinkit, Zepto, Swiggy Instamart or BigBasket data is held | Milestone 5 ("one genuinely authorized connector") cannot be completed until the owner obtains access (official/partner API or licensed provider contract). Connectors ship as `NOT_CONFIGURED` |
| Display/redistribution rights for any licensed data | Must be confirmed per source before external prices are shown publicly |
| Geocoding provider for manual address/pincode entry | Optional; needed only for Phase 6 manual addresses |
