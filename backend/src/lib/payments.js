// Fund Me payment-provider adapters (donations only — never coins, credits, gifts or subscriptions).
//
// Client spec §3: donations are paid to BibleNestra's own gateway account and held until verified and paid out.
// They never go straight to the beneficiary. (The earlier Stripe Connect destination-charge adapter did exactly that,
// so it was retired in monetisation stage 2.)
//
// Every provider implements:
//   name                                   'test' | 'paystack'
//   needsEmail                             the donor must give an email (Paystack receipts)
//   createCheckout(donation, fundraiser, env, ctx) → { url, providerRef }
//        ctx = { origin, successUrl, cancelUrl, returnUrl, email }
//   handleWebhook(request, env) → { providerRef, status } | { ignored: true }      (test provider only; Paystack's
//        webhook is handled in routes/fundme.js because it re-verifies through the API before anything is recorded)
//
// Which provider is used (lib/fundmeMoney.js pickProvider):
//   PAYSTACK_SECRET_KEY set → PaystackProvider (hosted checkout, NGN). Off when unset.
//   PAYMENTS_MODE=test      → TestProvider for everyone (local dev only — never set in production).
//   tester (WALLET_TEST_PURCHASES=true AND admin or in WALLET_TESTERS) asking for provider 'test' → TestProvider,
//                             even when Paystack is on (same gate as the wallet core's test purchases).
//   none                    → "Donations aren't switched on yet".
import { paystackConfigured, initializeTransaction } from './paystack.js';

const enc = new TextEncoder();

function randomRef(prefix) {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  return prefix + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------------------------
// Test provider — demo only. The "checkout" is a page on this Worker. No money moves.
// ---------------------------------------------------------------------------------------------
export const TestProvider = {
  name: 'test',
  needsEmail: false,
  async createCheckout(donation, fundraiser, env, ctx) {
    const providerRef = randomRef('test_');
    return { providerRef, url: `${ctx.origin}/pay/test/${providerRef}` };
  },
  // Body: { ref, status: 'succeeded' | 'failed' } (sent by the buttons on /pay/test/:ref)
  async handleWebhook(request) {
    let b = {};
    try { b = await request.json(); } catch (e) { b = {}; }
    const ref = typeof b.ref === 'string' && /^test_[0-9a-f]{36}$/.test(b.ref) ? b.ref : null;
    const status = ['succeeded', 'failed'].includes(b.status) ? b.status : null;
    if (!ref || !status) return { ignored: true, error: 'Bad test webhook' };
    return { providerRef: ref, status };
  },
};

// ---------------------------------------------------------------------------------------------
// Paystack (hosted checkout). The reference is the donation id, so a retry can't create a second charge record.
// ---------------------------------------------------------------------------------------------
export const PaystackProvider = {
  name: 'paystack',
  needsEmail: true,
  async createCheckout(donation, fundraiser, env, ctx) {
    const r = await initializeTransaction(env, {
      email: ctx.email,
      amountMinor: Number(donation.amount_minor),
      currency: fundraiser.currency,
      reference: donation.id,
      callbackUrl: ctx.returnUrl,
      metadata: { donation_id: donation.id, fundraiser_id: fundraiser.id, purpose: 'fundme_donation' },
    });
    return { url: r.url, providerRef: r.reference || donation.id };
  },
};

const hex = (buf) => Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, '0')).join('');

export async function hmacSha256Hex(secret, payload) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
}

const PROVIDERS = { test: TestProvider, paystack: PaystackProvider };
export const providerByName = (name) => PROVIDERS[name] || null;

/** The provider new donations use by default, or null when donations aren't switched on. */
export function activeProvider(env) {
  if (paystackConfigured(env)) return PaystackProvider;
  if (String(env.PAYMENTS_MODE || '').trim().toLowerCase() === 'test') return TestProvider;
  return null;
}
