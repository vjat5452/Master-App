import { PaymentNotFoundError, settlePayment } from '@localstock/database';
import { notFound } from '../../shared/errors.js';

export function createPaymentsService({ pool }) {
  return {
    // See settlePayment in @localstock/database: deduplicated by event id, serialised with expiry.
    async processEvent(event) {
      try {
        return await settlePayment(pool, event);
      } catch (err) {
        if (err instanceof PaymentNotFoundError) throw notFound('PAYMENT_NOT_FOUND', 'Unknown payment');
        throw err;
      }
    },
  };
}
