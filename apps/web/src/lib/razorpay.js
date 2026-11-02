import { post } from '@/lib/api';

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
let loading = null;

function loadCheckout() {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = CHECKOUT_SRC;
    script.async = true;
    script.onload = () => resolve(window.Razorpay);
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error('The Razorpay checkout could not be loaded. Check your connection and try again.'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

// Opens the Razorpay checkout for an order. Resolves with the server's verdict once the shopper
// pays, or with { outcome: 'DISMISSED' } if they close the window. A failed attempt does not end
// the payment: Razorpay lets the shopper retry in the same window.
export async function payWithRazorpay(order, { onAttemptFailed } = {}) {
  const [Razorpay, session] = await Promise.all([loadCheckout(), post(`/orders/${order.id}/payment/razorpay`)]);
  return new Promise((resolve, reject) => {
    const checkout = new Razorpay({
      key: session.keyId,
      order_id: session.razorpayOrderId,
      amount: session.amountMinor,
      currency: session.currency,
      name: 'LocalStock',
      description: `Order ${order.id.slice(0, 8)}`,
      timeout: session.timeoutSeconds,
      theme: { color: '#059669' },
      handler: (r) =>
        post(`/orders/${order.id}/payment/razorpay/verify`, {
          razorpayOrderId: r.razorpay_order_id,
          razorpayPaymentId: r.razorpay_payment_id,
          razorpaySignature: r.razorpay_signature,
        }).then(resolve, reject),
      modal: { ondismiss: () => resolve({ outcome: 'DISMISSED' }) },
    });
    checkout.on('payment.failed', (r) => onAttemptFailed?.(r.error?.description ?? 'The payment attempt failed'));
    checkout.open();
  });
}
