export const ORDER_TRANSITIONS = Object.freeze({
  CREATED: ['PENDING_PAYMENT', 'CANCELLED'],
  PENDING_PAYMENT: ['CONFIRMED', 'PAYMENT_FAILED', 'CANCELLED', 'REFUND_PENDING'],
  CONFIRMED: ['PARTIALLY_FULFILLED', 'FULFILLED', 'CANCELLED', 'PARTIALLY_CANCELLED', 'REFUND_PENDING'],
  PARTIALLY_FULFILLED: ['FULFILLED', 'PARTIALLY_CANCELLED'],
  FULFILLED: ['DELIVERED'],
  // A payment can succeed after the order was cancelled or expired; the money must go back.
  CANCELLED: ['REFUND_PENDING'],
  PAYMENT_FAILED: ['REFUND_PENDING'],
  PARTIALLY_CANCELLED: ['REFUND_PENDING'],
  REFUND_PENDING: ['REFUNDED'],
  DELIVERED: [],
  REFUNDED: [],
});

export class IllegalTransitionError extends Error {
  constructor(from, to, reason = 'transition not allowed') {
    super(`Illegal order transition ${from} -> ${to}: ${reason}`);
    this.name = 'IllegalTransitionError';
    this.domainCode = 'ILLEGAL_TRANSITION';
    this.details = { from, to };
  }
}

// Compare-and-set on the current status, then record history. Run inside a transaction.
export async function transitionOrder(client, { orderId, from, to, source, actorUserId = null }) {
  if (!ORDER_TRANSITIONS[from]?.includes(to)) throw new IllegalTransitionError(from, to);

  const { rowCount } = await client.query(
    'UPDATE orders SET status = $3, updated_at = now() WHERE id = $1 AND status = $2',
    [orderId, from, to],
  );
  if (rowCount === 0) throw new IllegalTransitionError(from, to, 'order status changed concurrently');

  await client.query(
    `INSERT INTO order_status_history (order_id, from_status, to_status, source, actor_user_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [orderId, from, to, source, actorUserId],
  );
}
