-- External quick-commerce platforms (Milestone 2).
--
-- Everything here is an *observation* made by LocalStock about another platform through
-- an authorized source. None of it is authoritative stock or price, and none of it is
-- ever written into the first-party tables (seller_offers, warehouse_inventory, ...).
--
-- Location: observations store only the coarse geohash cell of the query location
-- (`query_cell`, at most 6 characters, about 1.2 x 0.6 km). Exact customer coordinates are
-- never stored here. A fulfillment node has coordinates only if the source supplied them.
--
-- Time: `source_observed_at` is what the source says (NULL if it says nothing; never
-- invented), `collected_at` is when LocalStock fetched it, `stored_at` when it was written.
--
-- High-volume observation tables use BIGINT identity keys; configuration and reference
-- tables use UUIDs like the rest of the schema.

-- ---------------------------------------------------------------- platforms and sources

CREATE TABLE external_platforms (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,49}$'),
  name       TEXT NOT NULL,
  -- Fictional development platform whose data comes from checked-in fixtures.
  is_demo    BOOLEAN NOT NULL DEFAULT false,
  status     TEXT NOT NULL DEFAULT 'DISABLED' CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reference rows only. No source, credential or data exists for these platforms until
-- authorized access is obtained (see docs/platforms/).
INSERT INTO external_platforms (code, name) VALUES
  ('blinkit', 'Blinkit'),
  ('zepto', 'Zepto'),
  ('instamart', 'Swiggy Instamart'),
  ('bigbasket', 'BigBasket');

-- One way of getting data about a platform: its official or partner API, a licensed data
-- provider, permitted collection, or (development only) a fixture file.
CREATE TABLE external_sources (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id        UUID NOT NULL REFERENCES external_platforms(id),
  code               TEXT NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,49}$'),
  name               TEXT NOT NULL,
  access_type        TEXT NOT NULL CHECK (access_type IN (
                       'OFFICIAL_API', 'PARTNER_API', 'LICENSED_PROVIDER', 'PERMITTED_COLLECTION', 'DEMO_FIXTURE')),
  integration_status TEXT NOT NULL DEFAULT 'RESEARCH_REQUIRED' CHECK (integration_status IN (
                       'RESEARCH_REQUIRED', 'ACCESS_REQUESTED', 'SANDBOX', 'APPROVED', 'ACTIVE', 'DISABLED')),
  -- Name of the configuration block / environment prefix that holds credentials.
  -- Never the credentials themselves.
  config_reference   TEXT,
  capabilities       TEXT[] NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX external_sources_platform_idx ON external_sources (platform_id);

-- ---------------------------------------------------------------- nodes and listings

-- A dark store / fulfillment node, stored only when an authorized source identifies it.
-- Coordinates are kept only when the source supplied them; they are never inferred from a
-- pincode or a delivery zone.
CREATE TABLE external_fulfillment_nodes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id         UUID NOT NULL REFERENCES external_platforms(id),
  source_id           UUID NOT NULL REFERENCES external_sources(id),
  external_node_id    TEXT NOT NULL,
  name                TEXT,
  location            GEOGRAPHY(POINT, 4326),
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK (verification_status IN (
                        'UNVERIFIED', 'SOURCE_PROVIDED', 'VERIFIED')),
  first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform_id, external_node_id),
  CHECK (location IS NULL OR verification_status IN ('SOURCE_PROVIDED', 'VERIFIED'))
);
CREATE INDEX external_fulfillment_nodes_location_gix ON external_fulfillment_nodes USING GIST (location);

-- A product as listed on an external platform. Identified by the platform's own id, so two
-- sources reporting on the same platform share a listing.
CREATE TABLE external_listings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id         UUID NOT NULL REFERENCES external_platforms(id),
  first_source_id     UUID NOT NULL REFERENCES external_sources(id),
  external_listing_id TEXT NOT NULL,
  title               TEXT NOT NULL,
  brand               TEXT,
  variant_text        TEXT,
  -- Parsed like product_variants.pack_*; NULL when the size could not be parsed.
  pack_quantity       NUMERIC(12, 3) CHECK (pack_quantity > 0),
  pack_unit           TEXT CHECK (pack_unit IN ('g', 'ml', 'pcs')),
  pack_count          INTEGER CHECK (pack_count >= 1),
  gtin                TEXT CHECK (gtin ~ '^\d{8,14}$'),
  identifiers         JSONB NOT NULL DEFAULT '{}',
  image_url           TEXT,
  -- Only a link the source authorizes us to show.
  deep_link           TEXT,
  first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform_id, external_listing_id),
  CHECK ((pack_quantity IS NULL) = (pack_unit IS NULL))
);
CREATE INDEX external_listings_gtin_idx ON external_listings (gtin) WHERE gtin IS NOT NULL;
CREATE INDEX external_listings_title_trgm ON external_listings USING GIN (title gin_trgm_ops);

-- Link from an external listing to a canonical LocalStock variant. Fuzzy title similarity
-- may only propose a candidate; it can never be auto-confirmed.
CREATE TABLE external_product_mappings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id       UUID NOT NULL REFERENCES external_listings(id),
  variant_id       UUID NOT NULL REFERENCES product_variants(id),
  match_method     TEXT NOT NULL CHECK (match_method IN (
                     'GTIN', 'MANUFACTURER_ID', 'BRAND_ATTRIBUTES', 'ATTRIBUTES', 'FUZZY_CANDIDATE', 'MANUAL')),
  match_confidence NUMERIC(4, 3) NOT NULL CHECK (match_confidence BETWEEN 0 AND 1),
  -- AUTO_CONFIRMED by rules, CONFIRMED by a reviewer, NEEDS_REVIEW, or REJECTED.
  match_status     TEXT NOT NULL CHECK (match_status IN ('AUTO_CONFIRMED', 'CONFIRMED', 'NEEDS_REVIEW', 'REJECTED')),
  evidence         JSONB NOT NULL DEFAULT '{}',
  reviewed_by      UUID REFERENCES users(id),
  reviewed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (listing_id, variant_id),
  CHECK (NOT (match_method = 'FUZZY_CANDIDATE' AND match_status = 'AUTO_CONFIRMED')),
  CHECK (match_status <> 'CONFIRMED' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
-- At most one accepted mapping per listing.
CREATE UNIQUE INDEX external_product_mappings_accepted_uq ON external_product_mappings (listing_id)
  WHERE match_status IN ('AUTO_CONFIRMED', 'CONFIRMED');
CREATE INDEX external_product_mappings_variant_idx ON external_product_mappings (variant_id)
  WHERE match_status IN ('AUTO_CONFIRMED', 'CONFIRMED');
CREATE INDEX external_product_mappings_review_idx ON external_product_mappings (created_at)
  WHERE match_status = 'NEEDS_REVIEW';

-- ---------------------------------------------------------------- collection

CREATE TABLE external_collection_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id       UUID NOT NULL REFERENCES external_sources(id),
  job_type        TEXT NOT NULL CHECK (job_type IN ('CATALOGUE', 'PRICE', 'AVAILABILITY', 'SERVICEABILITY', 'HEALTH')),
  query_cell      TEXT CHECK (query_cell ~ '^[0-9b-hjkmnp-z]{1,6}$'),
  listing_id      UUID REFERENCES external_listings(id),
  search_query    TEXT,
  priority        SMALLINT NOT NULL DEFAULT 5 CHECK (priority BETWEEN 0 AND 9),
  status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
                    'PENDING', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  -- Same key = same work; only one open job per key (see the partial index).
  dedup_key       TEXT NOT NULL,
  scheduled_for   TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX external_collection_jobs_open_uq ON external_collection_jobs (dedup_key)
  WHERE status IN ('PENDING', 'QUEUED', 'RUNNING');
CREATE INDEX external_collection_jobs_due_idx ON external_collection_jobs (scheduled_for, priority)
  WHERE status = 'PENDING';

-- One attempt to talk to a source. Error codes are the connector error taxonomy.
CREATE TABLE external_collection_runs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id            UUID NOT NULL REFERENCES external_sources(id),
  job_id               UUID REFERENCES external_collection_jobs(id),
  request_id           TEXT,
  started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at         TIMESTAMPTZ,
  status               TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED')),
  items_received       INTEGER NOT NULL DEFAULT 0 CHECK (items_received >= 0),
  items_valid          INTEGER NOT NULL DEFAULT 0 CHECK (items_valid >= 0),
  items_rejected       INTEGER NOT NULL DEFAULT 0 CHECK (items_rejected >= 0),
  observations_written INTEGER NOT NULL DEFAULT 0 CHECK (observations_written >= 0),
  latency_ms           INTEGER CHECK (latency_ms >= 0),
  error_code           TEXT CHECK (error_code IN (
                         'SOURCE_NOT_CONFIGURED', 'UNSUPPORTED', 'TIMEOUT', 'RATE_LIMITED',
                         'UPSTREAM_ERROR', 'INVALID_RESPONSE', 'CIRCUIT_OPEN')),
  -- Sanitized summary; never raw payloads, tokens or customer data.
  error_message        TEXT,
  CHECK (completed_at IS NULL OR completed_at >= started_at),
  CHECK ((status = 'RUNNING') = (completed_at IS NULL))
);
CREATE INDEX external_collection_runs_source_idx ON external_collection_runs (source_id, started_at DESC);

CREATE TABLE external_source_health (
  source_id       UUID PRIMARY KEY REFERENCES external_sources(id),
  health          TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (health IN ('HEALTHY', 'DEGRADED', 'DOWN', 'NOT_CONFIGURED', 'UNKNOWN')),
  circuit_state   TEXT NOT NULL DEFAULT 'CLOSED' CHECK (circuit_state IN ('CLOSED', 'OPEN', 'HALF_OPEN')),
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  last_error_code TEXT,
  latency_p50_ms  INTEGER CHECK (latency_p50_ms >= 0),
  error_rate      NUMERIC(5, 4) CHECK (error_rate BETWEEN 0 AND 1),
  checked_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- observations

-- Whether a platform delivers to a location cell, and what it said about ETA and fee there.
CREATE TABLE external_serviceability_observations (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  platform_id         UUID NOT NULL REFERENCES external_platforms(id),
  source_id           UUID NOT NULL REFERENCES external_sources(id),
  run_id              UUID REFERENCES external_collection_runs(id),
  query_cell          TEXT NOT NULL CHECK (query_cell ~ '^[0-9b-hjkmnp-z]{1,6}$'),
  status              TEXT NOT NULL CHECK (status IN ('SERVICEABLE', 'NOT_SERVICEABLE', 'UNKNOWN')),
  -- Set only when the source named the node; NULL when only serviceability is known.
  fulfillment_node_id UUID REFERENCES external_fulfillment_nodes(id),
  eta_min_minutes     INTEGER CHECK (eta_min_minutes >= 0),
  eta_max_minutes     INTEGER CHECK (eta_max_minutes >= 0),
  delivery_fee_minor  BIGINT CHECK (delivery_fee_minor >= 0),
  currency            CHAR(3) CHECK (currency ~ '^[A-Z]{3}$'),
  source_reference    TEXT,
  source_observed_at  TIMESTAMPTZ,
  collected_at        TIMESTAMPTZ NOT NULL,
  stored_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (eta_min_minutes IS NULL OR eta_max_minutes IS NULL OR eta_min_minutes <= eta_max_minutes),
  CHECK (delivery_fee_minor IS NULL OR currency IS NOT NULL)
);
CREATE INDEX external_serviceability_cell_idx ON external_serviceability_observations (platform_id, query_cell, collected_at DESC);

CREATE TABLE external_price_observations (
  id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  listing_id              UUID NOT NULL REFERENCES external_listings(id),
  source_id               UUID NOT NULL REFERENCES external_sources(id),
  run_id                  UUID REFERENCES external_collection_runs(id),
  query_cell              TEXT CHECK (query_cell ~ '^[0-9b-hjkmnp-z]{1,6}$'),
  fulfillment_node_id     UUID REFERENCES external_fulfillment_nodes(id),
  item_price_minor        BIGINT NOT NULL CHECK (item_price_minor >= 0),
  mrp_minor               BIGINT CHECK (mrp_minor >= 0),
  currency                CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  tax_inclusive           BOOLEAN,
  -- Mandatory charges, each NULL when the source did not say.
  delivery_fee_minor      BIGINT CHECK (delivery_fee_minor >= 0),
  platform_fee_minor      BIGINT CHECK (platform_fee_minor >= 0),
  handling_fee_minor      BIGINT CHECK (handling_fee_minor >= 0),
  other_fee_minor         BIGINT CHECK (other_fee_minor >= 0),
  total_cost_completeness TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (total_cost_completeness IN ('COMPLETE', 'PARTIAL', 'UNKNOWN')),
  source_observed_at      TIMESTAMPTZ,
  collected_at            TIMESTAMPTZ NOT NULL,
  stored_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX external_price_observations_latest_idx ON external_price_observations (listing_id, query_cell, collected_at DESC);
CREATE INDEX external_price_observations_collected_idx ON external_price_observations (collected_at);

CREATE TABLE external_availability_observations (
  id                           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  listing_id                   UUID NOT NULL REFERENCES external_listings(id),
  source_id                    UUID NOT NULL REFERENCES external_sources(id),
  run_id                       UUID REFERENCES external_collection_runs(id),
  query_cell                   TEXT CHECK (query_cell ~ '^[0-9b-hjkmnp-z]{1,6}$'),
  fulfillment_node_id          UUID REFERENCES external_fulfillment_nodes(id),
  serviceability_observation_id BIGINT REFERENCES external_serviceability_observations(id),
  -- FETCH_FAILED is never the same thing as OUT_OF_STOCK.
  status                       TEXT NOT NULL CHECK (status IN (
                                 'IN_STOCK', 'OUT_OF_STOCK', 'NOT_SERVICEABLE', 'UNKNOWN', 'FETCH_FAILED')),
  source_observed_at           TIMESTAMPTZ,
  collected_at                 TIMESTAMPTZ NOT NULL,
  stored_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX external_availability_observations_latest_idx ON external_availability_observations (listing_id, query_cell, collected_at DESC);
CREATE INDEX external_availability_observations_collected_idx ON external_availability_observations (collected_at);

CREATE TABLE external_offer_observations (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  listing_id         UUID NOT NULL REFERENCES external_listings(id),
  source_id          UUID NOT NULL REFERENCES external_sources(id),
  run_id             UUID REFERENCES external_collection_runs(id),
  query_cell         TEXT CHECK (query_cell ~ '^[0-9b-hjkmnp-z]{1,6}$'),
  offer_type         TEXT NOT NULL,
  description        TEXT,
  conditions         JSONB NOT NULL DEFAULT '{}',
  valid_from         TIMESTAMPTZ,
  valid_until        TIMESTAMPTZ,
  source_observed_at TIMESTAMPTZ,
  collected_at       TIMESTAMPTZ NOT NULL,
  stored_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from <= valid_until)
);
CREATE INDEX external_offer_observations_latest_idx ON external_offer_observations (listing_id, collected_at DESC);

-- A detected change between two persisted observations. Published through the outbox.
CREATE TABLE external_change_events (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id        UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('PRICE', 'AVAILABILITY', 'SERVICEABILITY', 'OFFER', 'LISTING', 'SOURCE_HEALTH')),
  source_id       UUID NOT NULL REFERENCES external_sources(id),
  listing_id      UUID REFERENCES external_listings(id),
  query_cell      TEXT CHECK (query_cell ~ '^[0-9b-hjkmnp-z]{1,6}$'),
  old_value       JSONB,
  new_value       JSONB NOT NULL,
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  outbox_event_id UUID REFERENCES outbox_events(id)
);
CREATE INDEX external_change_events_listing_idx ON external_change_events (listing_id, detected_at DESC);
CREATE INDEX external_change_events_detected_idx ON external_change_events (detected_at);
