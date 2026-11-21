// PAYSTACK (paystack.com) — the payment gateway for the whole app (client decision, 2026-11-21): Fund Me donations and
// payouts, AND every in-app purchase (coin / credit / gifting packs, Dating Plus / VIP, Memberships, BibleNestra Plus)
// through lib/paystackCheckout.js. Google Play Billing (lib/play.js) stays in the code, dormant.
//
// Off until the secrets exist:  npx wrangler secret put PAYSTACK_SECRET_KEY   (sk_test_… / sk_live_…)
//                               PAYSTACK_PUBLIC_KEY (pk_…, safe to expose to the web checkout page)
// The Fund Me stage wires these helpers into its donation flow (lib/payments.js provider adapter) and payouts.
// Amounts are minor units (kobo for NGN). Nothing here stores card details — Paystack's hosted page does that.
import { ApiError } from './http.js';

const API = 'https://api.paystack.co';
export const paystackConfigured = (env) => !!(env && (typeof env.__paystackFetch === 'function' || String(env.PAYSTACK_SECRET_KEY || '').trim()));
/** Paystack test keys (sk_test_…): donations made with them are marked is_test, so they never count as real money. */
export const paystackTestMode = (env) => /^sk_test_/.test(String((env && env.PAYSTACK_SECRET_KEY) || '').trim());
export const paystackPublicKey = (env) => (env && String(env.PAYSTACK_PUBLIC_KEY || '').trim()) || null;
/** What Paystack may be used for (documentation + checks in later stages). */
export const PAYSTACK_USES = ['fundme_donation', 'fundme_payout', 'purchase', 'subscription_renewal'];

const notConfigured = () => new ApiError(503, 'PAYMENTS_NOT_CONFIGURED', 'Paystack is not set up yet.');
const hex = (buf) => Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, '0')).join('');

/** Webhook check: X-Paystack-Signature = hex(HMAC-SHA512(PAYSTACK_SECRET_KEY, rawBody)). */
export async function verifyPaystackSignature(rawBody, header, secret) {
  if (!header || !secret) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const expected = hex(await crypto.subtle.sign('HMAC', key, enc.encode(rawBody)));
  const got = String(header).trim().toLowerCase();
  if (got.length !== expected.length) return false;
  let r = 0;
  for (let i = 0; i < got.length; i++) r |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return r === 0;
}

async function call(env, method, path, payload) {
  if (typeof env.__paystackFetch === 'function') return env.__paystackFetch(method, path, payload); // tests / local dev only
  if (!paystackConfigured(env)) throw notConfigured();
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${String(env.PAYSTACK_SECRET_KEY).trim()}`, 'Content-Type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.status) throw new ApiError(502, 'PROVIDER_ERROR', (data && data.message) || 'Paystack request failed');
  return data.data;
}

/** Start a hosted checkout → { url, reference, accessCode }. reference must be unique (use the donation id). */
export async function initializeTransaction(env, { email, amountMinor, currency = 'NGN', reference, callbackUrl, metadata = {} }) {
  const d = await call(env, 'POST', '/transaction/initialize', { email, amount: Number(amountMinor), currency, reference, callback_url: callbackUrl, metadata });
  return { url: d.authorization_url, reference: d.reference, accessCode: d.access_code };
}
/** Server-side verification before anything is recorded → { status: 'success'|'failed'|…, amountMinor, currency, reference, raw }. */
export async function verifyTransaction(env, reference) {
  const d = await call(env, 'GET', `/transaction/verify/${encodeURIComponent(reference)}`);
  return { status: d.status, amountMinor: Number(d.amount), currency: d.currency, reference: d.reference, raw: d };
}

// ─── FUND ME stage 2: payouts to beneficiaries + refunds (used by lib/fundmeMoney.js) ───────────────────────────────
/** Nigerian banks → [{ code, name }]. Needs keys; lib/fundmeMoney.js falls back to a short built-in list without them. */
export async function listBanks(env, { country = 'nigeria', currency = 'NGN' } = {}) {
  const d = await call(env, 'GET', `/bank?country=${encodeURIComponent(country)}&currency=${encodeURIComponent(currency)}&perPage=200`);
  return (Array.isArray(d) ? d : []).filter((b) => b && b.active !== false && b.code).map((b) => ({ code: String(b.code), name: String(b.name) }));
}
/** Resolve-account: the bank's own name for this account → { accountName, accountNumber }. Throws PROVIDER_ERROR if not found. */
export async function resolveAccount(env, { accountNumber, bankCode }) {
  const d = await call(env, 'GET', `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`);
  return { accountName: String(d.account_name || ''), accountNumber: String(d.account_number || accountNumber) };
}
/** Transfer recipient for a NUBAN account → recipient_code (RCP_…). */
export async function createTransferRecipient(env, { name, accountNumber, bankCode, currency = 'NGN' }) {
  const d = await call(env, 'POST', '/transferrecipient', { type: 'nuban', name, account_number: accountNumber, bank_code: bankCode, currency });
  return d.recipient_code;
}
/** Send a payout from the Paystack balance. reference = our payout id (idempotent on Paystack's side). → { transferCode, status } */
export async function initiateTransfer(env, { amountMinor, recipientCode, reference, reason, currency = 'NGN' }) {
  const d = await call(env, 'POST', '/transfer', { source: 'balance', amount: Number(amountMinor), recipient: recipientCode, reference, reason, currency });
  return { transferCode: d.transfer_code, status: d.status, reference: d.reference };
}
/** Full refund of a transaction (by our reference). → { status } */
export async function refundTransaction(env, { reference }) {
  const d = await call(env, 'POST', '/refund', { transaction: reference });
  return { status: d.status || 'pending' };
}

// ─── PURCHASES: card renewals (lib/paystackCheckout.js) ───────────────────────────────────────────────────────────────
/** Charge a saved card (reusable authorisation). reference must be unique. → { status: 'success'|'failed'|…, raw } */
export async function chargeAuthorization(env, { authorizationCode, email, amountMinor, currency = 'NGN', reference, metadata = {} }) {
  const d = await call(env, 'POST', '/transaction/charge_authorization', { authorization_code: authorizationCode, email, amount: Number(amountMinor), currency, reference, metadata });
  return { status: d.status, amountMinor: Number(d.amount), currency: d.currency, reference: d.reference, raw: d };
}
