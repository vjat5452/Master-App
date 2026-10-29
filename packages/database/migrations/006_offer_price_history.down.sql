-- Reverts 006_offer_price_history.sql.
DROP TRIGGER IF EXISTS seller_offers_price_history ON seller_offers;
DROP FUNCTION IF EXISTS record_offer_price();
DROP TABLE IF EXISTS seller_offer_price_history;
