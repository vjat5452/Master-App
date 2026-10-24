-- LocalStock initial schema.
-- Money is stored as integer minor units (paise). Status columns are constrained explicitly;
-- allowed transitions are enforced in domain services.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------- identity

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  platform_role TEXT NOT NULL DEFAULT 'USER' CHECK (platform_role IN ('USER', 'ADMIN')),
  status        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));

CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  replaced_by UUID REFERENCES refresh_tokens(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);

CREATE TABLE companies (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  registration_number TEXT,
  status              TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE company_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  user_id    UUID NOT NULL REFERENCES users(id),
  role       TEXT NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'STAFF')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id)
);
CREATE INDEX company_members_user_idx ON company_members (user_id);

CREATE TABLE customer_addresses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id),
  label       TEXT,
  line1       TEXT NOT NULL,
  city        TEXT NOT NULL,
  postal_code TEXT,
  location    GEOGRAPHY(POINT, 4326) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX customer_addresses_user_idx ON customer_addresses (user_id);

-- ---------------------------------------------------------------- catalog

CREATE TABLE categories (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID REFERENCES categories(id),
  name      TEXT NOT NULL,
  slug      TEXT NOT NULL UNIQUE
);
CREATE INDEX categories_parent_idx ON categories (parent_id);

CREATE TABLE product_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES categories(id),
  name        TEXT NOT NULL,
  description TEXT
);
CREATE INDEX product_groups_category_idx ON product_groups (category_id);

CREATE TABLE product_variants (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       UUID NOT NULL REFERENCES product_groups(id),
  brand          TEXT,
  name           TEXT NOT NULL,
  attributes     JSONB NOT NULL DEFAULT '{}',
  barcode        TEXT,
  -- Normalized brand|name|attributes; identical keys mean the same sellable item.
  normalized_key TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PENDING_REVIEW', 'ARCHIVED')),
  search_vector  TSVECTOR GENERATED ALWAYS AS (
                   to_tsvector('english', coalesce(brand, '') || ' ' || name)
                 ) STORED,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX product_variants_group_idx ON product_variants (group_id);
CREATE UNIQUE INDEX product_variants_barcode_uq ON product_variants (barcode) WHERE barcode IS NOT NULL;
CREATE UNIQUE INDEX product_variants_normalized_key_uq ON product_variants (normalized_key);
CREATE INDEX product_variants_search_gin ON product_variants USING GIN (search_vector);
CREATE INDEX product_variants_name_trgm ON product_variants USING GIN (name gin_trgm_ops);

CREATE TABLE product_images (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id UUID NOT NULL REFERENCES product_variants(id),
  image_url  TEXT NOT NULL
);
CREATE INDEX product_images_variant_idx ON product_images (variant_id);

CREATE TABLE seller_offers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id),
  variant_id  UUID NOT NULL REFERENCES product_variants(id),
  seller_sku  TEXT NOT NULL,
  price_minor BIGINT NOT NULL CHECK (price_minor >= 0),
  status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'ARCHIVED')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, seller_sku),
  UNIQUE (company_id, variant_id)
);
CREATE INDEX seller_offers_active_variant_idx ON seller_offers (variant_id) WHERE status = 'ACTIVE';

-- ---------------------------------------------------------------- warehouses & inventory

CREATE TABLE warehouses (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES companies(id),
  name             TEXT NOT NULL,
  address          TEXT,
  location         GEOGRAPHY(POINT, 4326) NOT NULL,
  -- MVP service area: a radius around the warehouse. Polygon areas can be added later.
  service_radius_m INTEGER NOT NULL DEFAULT 10000 CHECK (service_radius_m > 0),
  status           TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX warehouses_location_gix ON warehouses USING GIST (location);
CREATE INDEX warehouses_company_idx ON warehouses (company_id);

CREATE TABLE warehouse_inventory (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  offer_id     UUID NOT NULL REFERENCES seller_offers(id),
  on_hand      INTEGER NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reserved     INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  version      BIGINT NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (reserved <= on_hand),
  UNIQUE (warehouse_id, offer_id)
);
CREATE INDEX warehouse_inventory_offer_idx ON warehouse_inventory (offer_id);

-- Tenant ownership: an offer may only be stocked in a warehouse of the same company.
CREATE FUNCTION enforce_inventory_tenant() RETURNS trigger AS $$
BEGIN
  IF (SELECT company_id FROM warehouses WHERE id = NEW.warehouse_id)
     IS DISTINCT FROM (SELECT company_id FROM seller_offers WHERE id = NEW.offer_id) THEN
    RAISE EXCEPTION 'warehouse and offer belong to different companies' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER warehouse_inventory_tenant
  BEFORE INSERT OR UPDATE OF warehouse_id, offer_id ON warehouse_inventory
  FOR EACH ROW EXECUTE FUNCTION enforce_inventory_tenant();

CREATE TABLE inventory_movements (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id   UUID NOT NULL REFERENCES warehouse_inventory(id),
  on_hand_delta  INTEGER NOT NULL DEFAULT 0,
  reserved_delta INTEGER NOT NULL DEFAULT 0,
  reason         TEXT NOT NULL CHECK (reason IN (
                   'RESTOCK', 'CORRECTION', 'DAMAGE', 'RETURN',
                   'RESERVATION', 'RELEASE', 'EXPIRY', 'DISPATCH')),
  note           TEXT,
  reference_type TEXT,
  reference_id   UUID,
  actor_user_id  UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX inventory_movements_inventory_idx ON inventory_movements (inventory_id, created_at);

-- ---------------------------------------------------------------- delivery

CREATE TABLE delivery_providers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID REFERENCES companies(id),
  name             TEXT NOT NULL,
  type             TEXT NOT NULL CHECK (type IN ('SELLER_FLEET', 'PLATFORM_FLEET', 'THIRD_PARTY')),
  base_fee_minor   BIGINT NOT NULL CHECK (base_fee_minor >= 0),
  per_km_fee_minor BIGINT NOT NULL CHECK (per_km_fee_minor >= 0),
  speed_kmph       INTEGER NOT NULL CHECK (speed_kmph > 0),
  pickup_minutes   INTEGER NOT NULL DEFAULT 10 CHECK (pickup_minutes >= 0),
  reliability      NUMERIC(4, 3) NOT NULL DEFAULT 0.9 CHECK (reliability BETWEEN 0 AND 1),
  max_distance_m   INTEGER NOT NULL CHECK (max_distance_m > 0),
  status           TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Only seller fleets are owned by a company.
  CHECK ((type = 'SELLER_FLEET') = (company_id IS NOT NULL))
);
CREATE INDEX delivery_providers_company_idx ON delivery_providers (company_id);

-- ---------------------------------------------------------------- orders

CREATE TABLE orders (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id        UUID NOT NULL REFERENCES users(id),
  status             TEXT NOT NULL CHECK (status IN (
                       'CREATED', 'PENDING_PAYMENT', 'CONFIRMED', 'PARTIALLY_FULFILLED', 'FULFILLED',
                       'DELIVERED', 'PAYMENT_FAILED', 'CANCELLED', 'PARTIALLY_CANCELLED',
                       'REFUND_PENDING', 'REFUNDED')),
  subtotal_minor     BIGINT NOT NULL CHECK (subtotal_minor >= 0),
  delivery_fee_minor BIGINT NOT NULL DEFAULT 0 CHECK (delivery_fee_minor >= 0),
  total_minor        BIGINT NOT NULL CHECK (total_minor >= 0),
  currency           TEXT NOT NULL DEFAULT 'INR',
  delivery_location  GEOGRAPHY(POINT, 4326) NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX orders_customer_idx ON orders (customer_id, created_at DESC);

CREATE TABLE order_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         UUID NOT NULL REFERENCES orders(id),
  variant_id       UUID NOT NULL REFERENCES product_variants(id),
  offer_id         UUID NOT NULL REFERENCES seller_offers(id),
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_minor BIGINT NOT NULL CHECK (unit_price_minor >= 0)
);
CREATE INDEX order_items_order_idx ON order_items (order_id);

CREATE TABLE shipments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id             UUID NOT NULL REFERENCES orders(id),
  warehouse_id         UUID NOT NULL REFERENCES warehouses(id),
  status               TEXT NOT NULL CHECK (status IN (
                         'PENDING', 'INVENTORY_RESERVED', 'READY_FOR_PICKUP', 'PICKED_UP', 'IN_TRANSIT',
                         'DELIVERED', 'ASSIGNMENT_FAILED', 'DELIVERY_FAILED', 'CANCELLED', 'RETURNED')),
  delivery_provider_id UUID REFERENCES delivery_providers(id),
  delivery_fee_minor   BIGINT NOT NULL DEFAULT 0,
  eta_minutes          INTEGER,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX shipments_order_idx ON shipments (order_id);

CREATE TABLE fulfillment_allocations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id   UUID NOT NULL REFERENCES shipments(id),
  order_item_id UUID NOT NULL REFERENCES order_items(id),
  inventory_id  UUID NOT NULL REFERENCES warehouse_inventory(id),
  quantity      INTEGER NOT NULL CHECK (quantity > 0)
);
CREATE INDEX fulfillment_allocations_shipment_idx ON fulfillment_allocations (shipment_id);

CREATE TABLE inventory_reservations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID NOT NULL REFERENCES orders(id),
  inventory_id UUID NOT NULL REFERENCES warehouse_inventory(id),
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  status       TEXT NOT NULL CHECK (status IN ('ACTIVE', 'CONFIRMED', 'CONSUMED', 'EXPIRED', 'RELEASED')),
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX inventory_reservations_order_idx ON inventory_reservations (order_id);
CREATE INDEX inventory_reservations_inventory_idx ON inventory_reservations (inventory_id);
CREATE INDEX inventory_reservations_active_expiry_idx
  ON inventory_reservations (expires_at) WHERE status = 'ACTIVE';

CREATE TABLE payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID NOT NULL REFERENCES orders(id),
  provider            TEXT NOT NULL,
  provider_payment_id TEXT NOT NULL,
  amount_minor        BIGINT NOT NULL CHECK (amount_minor >= 0),
  status              TEXT NOT NULL CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUND_PENDING', 'REFUNDED')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_payment_id)
);
CREATE INDEX payments_order_idx ON payments (order_id);

CREATE TABLE idempotency_keys (
  user_id         UUID NOT NULL REFERENCES users(id),
  key             TEXT NOT NULL,
  request_hash    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS', 'COMPLETED')),
  response_status INTEGER,
  response_body   JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE order_status_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES orders(id),
  from_status   TEXT,
  to_status     TEXT NOT NULL,
  source        TEXT NOT NULL,
  actor_user_id UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX order_status_history_order_idx ON order_status_history (order_id, created_at);

-- ---------------------------------------------------------------- reliability

CREATE TABLE outbox_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type     TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id   UUID NOT NULL,
  payload        JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at   TIMESTAMPTZ,
  attempts       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX outbox_events_unpublished_idx ON outbox_events (created_at) WHERE published_at IS NULL;

CREATE TABLE inbox_events (
  consumer     TEXT NOT NULL,
  message_id   UUID NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, message_id)
);

CREATE TABLE webhook_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    TEXT NOT NULL,
  event_id    TEXT NOT NULL,
  payload     JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);

CREATE TABLE audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id),
  company_id    UUID REFERENCES companies(id),
  action        TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     UUID,
  before        JSONB,
  after         JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_company_idx ON audit_logs (company_id, created_at);
