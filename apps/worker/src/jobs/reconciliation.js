// Reports drift only: auto-correcting stock or money is riskier than alerting a human.
const CHECKS = {
  inventoryReservedMismatch: `
    SELECT i.id, i.reserved,
           COALESCE(sum(r.quantity) FILTER (WHERE r.status IN ('ACTIVE', 'CONFIRMED')), 0) AS expected
      FROM warehouse_inventory i
      LEFT JOIN inventory_reservations r ON r.inventory_id = i.id
     GROUP BY i.id, i.reserved
    HAVING i.reserved <> COALESCE(sum(r.quantity) FILTER (WHERE r.status IN ('ACTIVE', 'CONFIRMED')), 0)
     LIMIT 100`,
  confirmedWithoutPayment: `
    SELECT o.id FROM orders o
     WHERE o.status = 'CONFIRMED'
       AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.status = 'SUCCEEDED')
     LIMIT 100`,
  stalePendingPayments: `
    SELECT p.id, p.order_id FROM payments p JOIN orders o ON o.id = p.order_id
     WHERE p.status = 'PENDING' AND o.status IN ('CANCELLED', 'PAYMENT_FAILED')
       AND p.updated_at < now() - interval '1 hour'
     LIMIT 100`,
  stuckRefunds: `
    SELECT id, order_id FROM payments
     WHERE status = 'REFUND_PENDING' AND updated_at < now() - interval '1 day'
     LIMIT 100`,
};

export function createReconciliationJob({ pool, logger }) {
  return async function reconcile() {
    const report = {};
    for (const [name, sql] of Object.entries(CHECKS)) {
      const { rows } = await pool.query(sql);
      report[name] = rows.length;
      if (rows.length > 0) logger.warn('reconciliation mismatch', { check: name, count: rows.length, sample: rows.slice(0, 5) });
    }
    logger.info('reconciliation finished', report);
    return report;
  };
}
