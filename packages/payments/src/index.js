export { createRazorpayGateway, PROVIDER as RAZORPAY } from './gateway.js';
export { createRazorpayClient, RazorpayError, verifyCheckoutSignature, verifyWebhookSignature } from './razorpay.js';

// Config shared by the API and the worker. Only test keys are accepted: this build takes no real money.
export function razorpaySettings(env) {
  const keyId = env.RAZORPAY_KEY_ID?.trim();
  const keySecret = env.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId && !keySecret) return null;
  if (!keyId || !keySecret) throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set together');
  if (!keyId.startsWith('rzp_test_')) throw new Error('Only Razorpay test keys (rzp_test_...) are supported');
  return { keyId, keySecret, webhookSecret: env.RAZORPAY_WEBHOOK_SECRET?.trim() || null };
}
