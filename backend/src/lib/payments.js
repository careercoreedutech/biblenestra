// Fund Me payment-provider adapters.
//
// Every provider implements:
//   name                                   'test' | 'stripe' | 'paystack'
//   createCheckout(donation, fundraiser, env, ctx) → { url, providerRef }
//        ctx = { origin, successUrl, cancelUrl, payoutAccount }   (payoutAccount only for real providers)
//   handleWebhook(request, env) → { providerRef, status } | { ignored: true }
//        status: 'succeeded' | 'failed' | 'refunded'
//
// Which provider is active is decided by env (see activeProvider):
//   PAYMENTS_MODE=test    → TestProvider: a Worker-served fake checkout page (/pay/test/:ref) with
//                           "Simulate successful payment" / "Simulate failure" buttons. NO real money. Never
//                           set this in production — anyone can complete a test checkout.
//   PAYMENTS_MODE=stripe  → StripeConnectProvider, only when STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are set
//                           AND the fundraiser owner has finished Stripe Connect onboarding
//                           (fundme_payout_accounts row with charges_enabled). NOT ACTIVE YET — no keys exist.
//   unset                 → no provider: the app and the public page show "Donations open soon".
//
// TODO (Paystack, for NGN): implement PaystackProvider with the same interface —
//   createCheckout: POST https://api.paystack.co/transaction/initialize { email, amount (kobo), currency,
//     reference: donation.id, callback_url, subaccount: <owner's Paystack subaccount code>,
//     transaction_charge / bearer for the platform fee } → { url: data.authorization_url, providerRef: data.reference }
//   handleWebhook: verify X-Paystack-Signature = hex(HMAC-SHA512(PAYSTACK_SECRET_KEY, rawBody)),
//     map event 'charge.success' → succeeded, 'charge.failed' → failed, 'refund.processed' → refunded,
//     providerRef = data.reference.
//   Paystack requires a donor email; the donate form would need an email field when this provider is used.

import { FUNDME } from './rules.js';

const enc = new TextEncoder();

function randomRef(prefix) {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  return prefix + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function platformFee(amountMinor) {
  const bps = Number(FUNDME.platformFeeBps) || 0;
  return Math.max(0, Math.floor((amountMinor * bps) / 10000));
}

// ---------------------------------------------------------------------------------------------
// Test provider — demo only. The "checkout" is a page on this Worker.
// ---------------------------------------------------------------------------------------------
export const TestProvider = {
  name: 'test',
  needsPayoutAccount: false,
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
// Stripe Connect (Checkout + destination charges). NOT ACTIVE until the owner adds keys and the
// fundraiser owners complete Connect onboarding. Written against Stripe's documented REST API; it
// cannot be live-tested here (no keys). The webhook signature check is covered by tests.
// ---------------------------------------------------------------------------------------------
const STRIPE_API = 'https://api.stripe.com/v1';

// Stripe expects application/x-www-form-urlencoded with bracketed keys.
function formEncode(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') formEncode(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out.join('&');
}

const hex = (buf) => Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, '0')).join('');

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function hmacSha256Hex(secret, payload) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
}

/** Verifies a `Stripe-Signature` header (t=…,v1=…) over the raw body. Returns true/false. */
export async function verifyStripeSignature(rawBody, header, secret, toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000)) {
  if (!header || !secret) return false;
  const parts = String(header).split(',').map((p) => p.trim().split('='));
  const t = Number((parts.find(([k]) => k === 't') || [])[1]);
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!Number.isFinite(t) || !sigs.length) return false;
  if (Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = await hmacSha256Hex(secret, `${t}.${rawBody}`);
  return sigs.some((s) => timingSafeEqual(s, expected));
}

export const StripeConnectProvider = {
  name: 'stripe',
  needsPayoutAccount: true,
  async createCheckout(donation, fundraiser, env, ctx) {
    if (!ctx.payoutAccount) {
      const e = new Error('This fundraiser can’t accept card payments yet');
      e.code = 'OWNER_NOT_ONBOARDED';
      throw e;
    }
    const fee = platformFee(Number(donation.amount_minor));
    const params = {
      mode: 'payment',
      success_url: ctx.successUrl,
      cancel_url: ctx.cancelUrl,
      client_reference_id: donation.id,
      line_items: {
        0: {
          quantity: 1,
          price_data: {
            currency: String(fundraiser.currency).toLowerCase(),
            unit_amount: Number(donation.amount_minor),
            product_data: { name: `Donation — ${String(fundraiser.title).slice(0, 200)}` },
          },
        },
      },
      payment_intent_data: {
        // destination charge: funds settle in the owner's connected account, platform keeps application_fee_amount
        transfer_data: { destination: ctx.payoutAccount },
        application_fee_amount: fee > 0 ? fee : undefined,
        metadata: { donation_id: donation.id, fundraiser_id: fundraiser.id },
      },
      metadata: { donation_id: donation.id, fundraiser_id: fundraiser.id },
    };
    const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': `donation_${donation.id}`,
      },
      body: formEncode(params),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url || !data.id) {
      const e = new Error((data.error && data.error.message) || 'Stripe checkout could not be created');
      e.code = 'PROVIDER_ERROR';
      throw e;
    }
    return { url: data.url, providerRef: data.id };
  },
  async handleWebhook(request, env) {
    const raw = await request.text();
    const ok = await verifyStripeSignature(raw, request.headers.get('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET);
    if (!ok) return { invalid: true };
    let evt;
    try { evt = JSON.parse(raw); } catch (e) { return { invalid: true }; }
    const obj = (evt.data && evt.data.object) || {};
    switch (evt.type) {
      case 'checkout.session.completed':
        // card payments are paid immediately; delayed methods finish with async_payment_succeeded
        return obj.payment_status === 'paid' ? { providerRef: obj.id, status: 'succeeded' } : { ignored: true };
      case 'checkout.session.async_payment_succeeded':
        return { providerRef: obj.id, status: 'succeeded' };
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired':
        return { providerRef: obj.id, status: 'failed' };
      // TODO: refunds arrive as charge.refunded (keyed by payment_intent, not the session id) — store the
      // payment_intent on completion before mapping refunds back to donations.
      default:
        return { ignored: true };
    }
  },
};

const PROVIDERS = { test: TestProvider, stripe: StripeConnectProvider };
export const providerByName = (name) => PROVIDERS[name] || null;

/** The provider new donations use, or null when donations aren't open yet. */
export function activeProvider(env) {
  const mode = String(env.PAYMENTS_MODE || '').trim().toLowerCase();
  if (mode === 'test') return TestProvider;
  if (mode === 'stripe' && env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET) return StripeConnectProvider;
  return null;
}
