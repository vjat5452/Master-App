-- Razorpay payments (2026-11-02).
-- A gateway payment starts without a provider id: the gateway order is created only when the
-- shopper clicks Pay. provider_payment_id then holds the gateway order id (order_...),
-- provider_charge_id the captured payment (pay_...) and provider_refund_id the refund (rfnd_...).

ALTER TABLE payments ALTER COLUMN provider_payment_id DROP NOT NULL;
ALTER TABLE payments
  ADD COLUMN provider_charge_id  TEXT,
  ADD COLUMN provider_refund_id  TEXT,
  ADD COLUMN refund_attempted_at TIMESTAMPTZ,
  ADD COLUMN last_checked_at     TIMESTAMPTZ;

-- The sync job looks for open gateway payments and refunds still to be sent or confirmed.
CREATE INDEX payments_open_gateway_idx ON payments (provider, status)
  WHERE status IN ('PENDING', 'REFUND_PENDING');
