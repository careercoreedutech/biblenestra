// PAYSTACK FOR EVERY PURCHASE (app side). Server: backend/src/lib/paystackCheckout.js + routes/paystack.js.
//
//   payWithPaystack(api, start, { email, onOpened })
//     start(email) → the server's answer to a checkout call:
//       { checkout: { reference, url } }  → opens Paystack's page (card, bank transfer, USSD), waits for it to close,
//                                           then asks GET /payments/paystack/:reference until it is settled
//       anything else (test purchase, free promo) → done at once
//     → { status: 'success' | 'failed' | 'pending' | 'review' | 'abandoned', payment?, result? }
//   checkPayment(api, reference) → payment (re-verified on the server when still pending)
//
// The member's card details only ever go to Paystack's page. Nothing is granted by the app: the server verifies with
// Paystack first, and only once.
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

export const PAYSTACK_RETURN = 'biblenestra://paystack';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const checkPayment = (api, reference) => api.request('GET', `/payments/paystack/${encodeURIComponent(reference)}`).then((r) => r.payment);

const SETTLED = ['success', 'failed', 'review', 'refunded'];

async function poll(api, reference, { tries, every }) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    try {
      last = await checkPayment(api, reference);
      if (SETTLED.includes(last.status)) return last;
    } catch (e) { /* network blip: keep trying */ }
    await sleep(every);
  }
  return last;
}

export async function payWithPaystack(api, start, { email = null, onOpened = null } = {}) {
  const signedIn = /^\S+@\S+\.\S+$/.test(String(api.email || '')) ? api.email : undefined; // Clerk sign-in email
  const r = await start(email || signedIn);
  if (!r || !r.checkout) return { status: 'success', result: r };
  const { reference, url } = r.checkout;
  if (onOpened) onOpened(reference);
  if (Platform.OS === 'web') {
    // a new tab; keep checking for up to 4 minutes while the member pays there
    if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
    const p = await poll(api, reference, { tries: 80, every: 3000 });
    return { status: p ? p.status : 'pending', payment: p, reference, result: r };
  }
  await WebBrowser.openAuthSessionAsync(url, PAYSTACK_RETURN);
  // the page closed (paid, cancelled or the member went back): give Paystack a few seconds to confirm
  const p = await poll(api, reference, { tries: 8, every: 1500 });
  return { status: p ? p.status : 'pending', payment: p, reference, result: r };
}

/** Plain-language result line for a checkout sheet. */
export function paystackMessage(status) {
  if (status === 'success') return null;
  if (status === 'failed') return 'The payment didn’t go through. No money was taken — try again or use another card.';
  if (status === 'review') return 'Your payment arrived and is being checked by our team. You’ll get a notification soon.';
  if (status === 'abandoned') return 'Payment not finished. Nothing was charged.';
  return 'Waiting for Paystack to confirm. Bank transfers can take a minute — tap “I’ve paid, check again”.';
}

export function paystackError(e, fallback = 'Payment failed') {
  const code = e && e.code;
  if (code === 'PAYMENTS_NOT_CONFIGURED') return 'Payments are coming soon — nothing was charged.';
  if (code === 'PAYMENTS_PAUSED') return 'Payments are paused for a moment. Please try again later.';
  if (code === 'ALREADY_SUBSCRIBED') return e.message || 'You already have this plan.';
  if (code === 'RATE_LIMITED') return 'Please wait a moment and try again.';
  return (e && e.message) || fallback;
}
