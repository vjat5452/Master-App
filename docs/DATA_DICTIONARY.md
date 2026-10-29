# LocalStock data dictionary: Milestone 2 additions

Tables and columns added by `002_external_platforms.sql` and `003_vendor_extensions.sql`. The original schema is in `001_init.sql` and summarized in `docs/LOCALSTOCK_CURRENT_ARCHITECTURE.md`.

## Conventions

- **Money** is integer minor units (`BIGINT`, paise) plus a 3-letter `currency` where the table can hold more than one currency.
- **Status and enum columns** are `TEXT` with a `CHECK` list.
- **Keys:** configuration and reference tables use UUIDs, like the rest of the schema. High-volume observation tables use `BIGINT` identity keys.
- **Time on observations:**
  - `source_observed_at` is what the source said. It is NULL when the source said nothing, and is never invented.
  - `collected_at` is when LocalStock fetched the data.
  - `stored_at` is when it was written.
- **Location on observations:** `query_cell` is the geohash of the query location, at most 6 characters (about 1.2 × 0.6 km). A database `CHECK` rejects longer, more precise cells. Exact customer coordinates are not stored with external data.

## Ownership rules

| Data | Authoritative for | Written by |
|---|---|---|
| `seller_offers.price_minor`, `mrp_minor` | That seller's own offer | The seller (API, later CSV import) |
| `warehouse_inventory` | That seller's own warehouse stock | The seller and the order/reservation flow |
| `external_*_observations` | Nothing. They record what a source reported at a time | External collectors only |
| `external_product_mappings` | The link between an external listing and a LocalStock variant | Matcher (rules) and admin reviewers |

External collectors never write to first-party tables, and sellers never write to `external_*` tables. Milestone 3 adds tests that enforce this.

A customer's query location is never a warehouse. A cached observation is never "live".

## Migrations

- Pending migrations are applied with `npm run db:migrate`.
- The newest migration is reverted with `npm run db:migrate:down`. To revert more than one, pass the number: `npm run db:migrate:down -- 2`.
- Each migration may have a matching `NNN_name.down.sql`. `001_init.sql` has none, so it cannot be reverted.
- Pack sizes are filled by `npm run backfill:pack-size -w @localstock/database`. `npm run db:seed` runs it too. Add `-- --all` to recompute every row.

## First-party extensions (`003_vendor_extensions.sql`)

| Table.column | Type | Rule | Purpose |
|---|---|---|---|
| `seller_offers.mrp_minor` | BIGINT NULL | `mrp_minor >= price_minor` | Maximum retail price; the selling price may not exceed it |
| `companies.vendor_type` | TEXT, default `RETAILER` | RETAILER, WHOLESALER, DISTRIBUTOR, BRAND, OTHER | Kind of vendor |
| `companies.contact_phone` | TEXT NULL | 6–20 of digits, space, `()-`, optional `+` | Vendor contact |
| `warehouses.contact_phone` | TEXT NULL | as above | Store contact |
| `warehouses.opening_hours` | JSONB NULL | shape validated by the API | e.g. `{"mon": [["08:00","22:00"]]}` |
| `audit_logs.source_of_change` | TEXT, default `USER` | USER, ADMIN, CSV_IMPORT, SYSTEM | Where an audited change came from |
| `product_variants.pack_quantity` | NUMERIC(12,3) NULL | > 0 | Size of one item in base units |
| `product_variants.pack_unit` | TEXT NULL | g, ml, pcs | Base unit |
| `product_variants.pack_count` | INTEGER NULL | ≥ 1 | Items in the pack |

The three `pack_*` columns are all set or all NULL. Examples:
- "1 kg" is stored as (1000, g, 1).
- "1 l" is stored as (1000, ml, 1).
- "6 x 200 ml" is stored as (200, ml, 6).
- "pack of 4" is stored as (4, pcs, 1).

A NULL size means unknown, and products with an unknown size are never matched on size. The parser is `packages/database/src/domain/pack-size.js`; it is shared by the backfill and, later, by the matcher. In the demo catalogue all 505 variants parse.

## External platform tables (`002_external_platforms.sql`)

### `external_platforms`

One row per platform.

| Column | Notes |
|---|---|
| `code` | `blinkit`, `zepto`, `instamart`, `bigbasket` (seeded as reference rows, status `DISABLED`) |
| `name` | Display name |
| `is_demo` | True only for a fictional development platform that serves fixture data |
| `status` | ACTIVE, DISABLED |

### `external_sources`

One way of getting data about a platform.

| Column | Notes |
|---|---|
| `platform_id` | The platform this source reports on |
| `code`, `name` | Unique code and display name |
| `access_type` | OFFICIAL_API, PARTNER_API, LICENSED_PROVIDER, PERMITTED_COLLECTION, DEMO_FIXTURE |
| `integration_status` | RESEARCH_REQUIRED (default), ACCESS_REQUESTED, SANDBOX, APPROVED, ACTIVE, DISABLED. `ACTIVE` only after acceptance tests pass against the genuine source |
| `config_reference` | Name of the config/env block that holds credentials. Never the credentials themselves |
| `capabilities` | Declared capabilities, e.g. `{product_search,price}` |

No source rows are created by the migration.

### `external_fulfillment_nodes`

A platform's dark store, stored only when an authorized source identifies it.

| Column | Notes |
|---|---|
| `external_node_id` | Unique per platform |
| `location` | Only if the source supplied coordinates. `CHECK`: a location requires `verification_status` SOURCE_PROVIDED or VERIFIED. Never inferred from a pincode or zone |
| `verification_status` | UNVERIFIED, SOURCE_PROVIDED, VERIFIED |
| `first_seen_at`, `last_seen_at` | |

### `external_listings`

A product as listed on a platform. Unique on (`platform_id`, `external_listing_id`), so several sources reporting on one platform share a listing.

| Column | Notes |
|---|---|
| `first_source_id` | The source that first reported the listing |
| `title`, `brand`, `variant_text` | As reported |
| `pack_quantity`, `pack_unit`, `pack_count` | Parsed like product variants; NULL if unparsed |
| `gtin` | 8–14 digits |
| `identifiers` | Other source identifiers (JSONB) |
| `image_url` | |
| `deep_link` | Only a link the source authorizes us to show |
| `first_seen_at`, `last_seen_at` | |

### `external_product_mappings`

Links an external listing to a LocalStock `product_variants` row.

| Column | Notes |
|---|---|
| `match_method` | GTIN, MANUFACTURER_ID, BRAND_ATTRIBUTES, ATTRIBUTES, FUZZY_CANDIDATE, MANUAL |
| `match_confidence` | 0–1 |
| `match_status` | AUTO_CONFIRMED (rules), CONFIRMED (reviewer), NEEDS_REVIEW, REJECTED |
| `evidence` | What the decision was based on (JSONB) |
| `reviewed_by`, `reviewed_at` | Required when `CONFIRMED` |

Rules enforced by the database:
- `FUZZY_CANDIDATE` can never be `AUTO_CONFIRMED`.
- At most one accepted (AUTO_CONFIRMED or CONFIRMED) mapping per listing.
- A listing with no accepted mapping may still be shown, labelled "not yet mapped".

### `external_collection_jobs`

Work to fetch something from a source.

| Column | Notes |
|---|---|
| `job_type` | CATALOGUE, PRICE, AVAILABILITY, SERVICEABILITY, HEALTH |
| `query_cell`, `listing_id`, `search_query` | What to fetch |
| `priority` | 0–9 |
| `status` | PENDING, QUEUED, RUNNING, SUCCEEDED, FAILED, CANCELLED |
| `dedup_key` | Unique among open jobs (PENDING, QUEUED, RUNNING), so the same work is never queued twice |
| `scheduled_for`, `attempts`, `last_error_code` | |

### `external_collection_runs`

One attempt to talk to a source.

| Column | Notes |
|---|---|
| `status` | RUNNING, SUCCEEDED, PARTIAL, FAILED. `completed_at` is set exactly when the status is not RUNNING |
| `items_received`, `items_valid`, `items_rejected`, `observations_written` | Counts |
| `latency_ms`, `request_id` | |
| `error_code` | Fixed taxonomy: SOURCE_NOT_CONFIGURED, UNSUPPORTED, TIMEOUT, RATE_LIMITED, UPSTREAM_ERROR, INVALID_RESPONSE, CIRCUIT_OPEN |
| `error_message` | Sanitized: no payloads, tokens or customer data |

### `external_source_health`

One row per source.

| Column | Notes |
|---|---|
| `health` | HEALTHY, DEGRADED, DOWN, NOT_CONFIGURED, UNKNOWN |
| `circuit_state` | CLOSED, OPEN, HALF_OPEN |
| `last_success_at`, `last_failure_at`, `last_error_code` | |
| `latency_p50_ms`, `error_rate` | `error_rate` is 0–1 |
| `checked_at` | |

### `external_serviceability_observations`

Whether a platform delivers to a cell.

| Column | Notes |
|---|---|
| `query_cell` | Required |
| `status` | SERVICEABLE, NOT_SERVICEABLE, UNKNOWN |
| `fulfillment_node_id` | Only when the source named the node; otherwise NULL, and distance stays unknown |
| `eta_min_minutes`, `eta_max_minutes` | As reported, with min ≤ max |
| `delivery_fee_minor` | Requires `currency` |
| `source_reference` | |

### `external_price_observations`

| Column | Notes |
|---|---|
| `item_price_minor` | Required, ≥ 0 |
| `mrp_minor` | ≥ 0 |
| `currency` | Required |
| `tax_inclusive` | NULL when unknown |
| `delivery_fee_minor`, `platform_fee_minor`, `handling_fee_minor`, `other_fee_minor` | Each NULL when the source did not say |
| `total_cost_completeness` | COMPLETE, PARTIAL, UNKNOWN (default). The known total is computed at read time; a "cheapest" claim needs COMPLETE |

Indexed for "latest price per listing per cell" and for retention by `collected_at`.

### `external_availability_observations`

| Column | Notes |
|---|---|
| `status` | IN_STOCK, OUT_OF_STOCK, NOT_SERVICEABLE, UNKNOWN, FETCH_FAILED. FETCH_FAILED is never converted to OUT_OF_STOCK |
| `serviceability_observation_id` | Links the serviceability answer this was based on |

### `external_offer_observations`

| Column | Notes |
|---|---|
| `offer_type`, `description` | As reported |
| `conditions` | JSONB |
| `valid_from`, `valid_until` | With from ≤ until |

### `external_change_events`

A change detected between two persisted observations.

| Column | Notes |
|---|---|
| `event_id` | Unique |
| `entity_type` | PRICE, AVAILABILITY, SERVICEABILITY, OFFER, LISTING, SOURCE_HEALTH |
| `source_id`, `listing_id`, `query_cell` | What changed and where |
| `old_value`, `new_value` | JSONB |
| `outbox_event_id` | The outbox row that publishes the change (Milestone 8) |

## Later additions

### `seller_offer_price_history` (migration 006)

One row per change of a seller offer's price, MRP or status, written by a trigger on `seller_offers`.

| Column | Notes |
|---|---|
| `offer_id` | The offer |
| `price_minor`, `mrp_minor`, `status` | Values from that moment on |
| `valid_from` | When the change happened |

Existing offers were backfilled at their `created_at`. Feeds the product price graph.

### Products discovered on other platforms (migration 007)

| Column | Notes |
|---|---|
| `product_variants.origin` | `LOCALSTOCK` (catalogue) or `EXTERNAL` (created from an external listing that matched no product) |
| `product_variants.created_from_listing_id` | The listing it was created from |
| `product_variants.group_id` | May be NULL only for EXTERNAL products; an ACTIVE product always has a group |

EXTERNAL products start as `PENDING_REVIEW`. They are searchable and comparable, but sellers cannot list them until an admin classifies and approves them.

The mapping from such a listing uses `match_method = 'NEW_CANONICAL'`. No seller, warehouse or stock row is ever created for them.

## Retention

Retention jobs are planned for Milestone 11. Observations and change events are indexed on `collected_at`/`detected_at` so old rows can be deleted in ranges.
