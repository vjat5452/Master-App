-- Reverts 008_payment_gateway.sql. Gateway payments that never got a provider id get a placeholder.
DROP INDEX IF EXISTS payments_open_gateway_idx;
ALTER TABLE payments
  DROP COLUMN IF EXISTS provider_charge_id,
  DROP COLUMN IF EXISTS provider_refund_id,
  DROP COLUMN IF EXISTS refund_attempted_at,
  DROP COLUMN IF EXISTS last_checked_at;
UPDATE payments SET provider_payment_id = 'unassigned_' || id WHERE provider_payment_id IS NULL;
ALTER TABLE payments ALTER COLUMN provider_payment_id SET NOT NULL;
