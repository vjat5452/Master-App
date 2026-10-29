-- Price history of LocalStock sellers' offers, for price graphs (2026-10-29).
-- A trigger records every change of price, MRP or status, whatever made it (seller API,
-- CSV import, scripts), so the history cannot drift from the offers themselves.

CREATE TABLE seller_offer_price_history (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  offer_id    UUID NOT NULL REFERENCES seller_offers(id) ON DELETE CASCADE,
  price_minor BIGINT NOT NULL CHECK (price_minor >= 0),
  mrp_minor   BIGINT,
  status      TEXT NOT NULL,
  valid_from  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX seller_offer_price_history_offer_idx ON seller_offer_price_history (offer_id, valid_from DESC);

CREATE FUNCTION record_offer_price() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.price_minor IS DISTINCT FROM OLD.price_minor
     OR NEW.mrp_minor IS DISTINCT FROM OLD.mrp_minor
     OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO seller_offer_price_history (offer_id, price_minor, mrp_minor, status)
    VALUES (NEW.id, NEW.price_minor, NEW.mrp_minor, NEW.status);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER seller_offers_price_history
  AFTER INSERT OR UPDATE OF price_minor, mrp_minor, status ON seller_offers
  FOR EACH ROW EXECUTE FUNCTION record_offer_price();

-- Existing offers: their current price is known only from when they were created, so
-- history starts there.
INSERT INTO seller_offer_price_history (offer_id, price_minor, mrp_minor, status, valid_from)
SELECT id, price_minor, mrp_minor, status, created_at FROM seller_offers;
