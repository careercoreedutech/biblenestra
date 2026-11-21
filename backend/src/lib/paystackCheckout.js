// PAYSTACK CHECKOUT FOR EVERY PURCHASE (client decision 2026-11-21: Paystack for the whole app, not Google Play).
//
// One flow for wallet packs (Fund Me credits, Dating Coins, Gifting Coins), Dating Plus / VIP, Memberships and
// BibleNestra Plus:
//   1. start*Checkout()  → a paystack_payments row (unique reference) + Paystack's hosted page URL (card, bank transfer, USSD)
//   2. the member pays on Paystack's page (we never see card details)
//   3. settlePayment(reference) — from the return page, the app's status poll or the webhook — re-verifies the payment
//      with Paystack (GET /transaction/verify), checks amount + currency, then grants the purchase EXACTLY ONCE
//      (row claimed with status 'processing' first; each grant is idempotent as well).
//   4. a reusable card authorisation is saved (a token, never card numbers) → monthly plans renew automatically
//      (runPaystackRenewals, cron). Bank transfer / USSD can't be charged again, so those plans get a reminder
//      (runPaystackReminders) and the member pays again from the app.
//
// Switches: PAYSTACK_SECRET_KEY (wrangler secret; sk_test_… marks every payment `test`), PAYSTACK_CURRENCIES
// (default NGN), wallet setting `paystack_in_app` (Admin › Wallets & payments › Settings / Paystack): false pauses new
// in-app payments at once without an app update.
import { q, one } from './db.js';
import { ApiError, bad, notFound } from './http.js';
import { paystackConfigured, paystackTestMode, initializeTransaction, verifyTransaction, chargeAuthorization } from './paystack.js';
import { getConfig, registerConfig } from './wallet.js';
import { getProduct, productShape, activatePurchase, liveSubscription, addInterval, grantCycleBenefits, renewSubscription, testPurchaseAllowed } from './walletStore.js';
import { activateSubscription, subscriptionOf, hasAccess, formatPrice } from './memberships.js';

registerConfig('paystack_in_app', true, (v) => typeof v === 'boolean');

const iso = (d) => (d ? new Date(d).toISOString() : null);
const parse = (v, d) => (v == null ? d : typeof v === 'string' ? JSON.parse(v) : v);
export const paystackCurrencies = (env) => String(env.PAYSTACK_CURRENCIES || 'NGN').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,24}$/;
export const PAUSED = 'Payments are paused for a moment. Please try again later.';

// ─── switches + method rows ──────────────────────────────────────────────────────────────────────────────────────────
export async function inAppEnabled(env) {
  const cfg = await getConfig(env);
  return cfg.paystack_in_app !== false;
}
/** The payment row for a checkout sheet. */
export function paystackMethod(env, { inApp = true, currency = 'NGN' } = {}) {
  const configured = paystackConfigured(env);
  const currencyOk = paystackCurrencies(env).includes(String(currency || 'NGN').toUpperCase());
  const available = configured && inApp && currencyOk;
  const note = !configured ? 'Coming soon' : !inApp ? 'Paused — try again later' : !currencyOk ? `Not available in ${currency}` : 'Card, bank transfer or USSD';
  return { id: 'paystack', label: 'Pay with Paystack', provider: 'paystack', available, note, test: configured && paystackTestMode(env) };
}
async function assertCanPay(env, currency) {
  if (!paystackConfigured(env)) throw new ApiError(503, 'PAYMENTS_NOT_CONFIGURED', 'Payments are coming soon.');
  if (!(await inAppEnabled(env))) throw new ApiError(503, 'PAYMENTS_PAUSED', PAUSED);
  if (!paystackCurrencies(env).includes(String(currency).toUpperCase())) throw new ApiError(409, 'CURRENCY_NOT_SUPPORTED', `Payments in ${currency} aren’t available yet`);
}

/** Paystack needs an email for the receipt. Typed once, remembered on users.billing_email. */
export async function billingEmail(env, user, typed) {
  const t = String(typed || '').trim().toLowerCase();
  if (t) {
    if (!EMAIL_RE.test(t)) throw bad('Enter a valid email for your receipt', 'BAD_EMAIL');
    if (t !== user.billing_email) await q(env, 'UPDATE users SET billing_email = $2 WHERE id = $1', [user.id, t]);
    return t;
  }
  const row = await one(env, 'SELECT billing_email FROM users WHERE id = $1', [user.id]);
  if (row && row.billing_email) return row.billing_email;
  throw bad('Enter your email for the payment receipt', 'EMAIL_REQUIRED');
}

// Paystack references allow only letters, digits, - . = (no underscores).
const newReference = (kind) => `bn${kind[0]}-${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;

export function paymentShape(p) {
  if (!p) return null;
  return {
    reference: p.reference, kind: p.kind, purpose: p.purpose, targetId: p.target_id, status: p.status, test: !!p.test,
    amountMinor: Number(p.amount_minor), currency: p.currency, displayAmount: formatPrice(Number(p.amount_minor), p.currency),
    channel: p.channel || null, error: p.error || null, createdAt: iso(p.created_at), paidAt: iso(p.paid_at),
    title: parse(p.payload, {}).title || null,
    ...(p.display_name !== undefined ? { user: { id: p.user_id, name: p.display_name, handle: p.handle || null } } : {}),
  };
}

/** Creates the payment row and asks Paystack for the hosted page. → { reference, url, payment } */
async function openCheckout(env, { user, kind, targetId, amountMinor, currency, email, payload = {}, origin, reference = null }) {
  const ref = reference || newReference(kind);
  const p = await one(env, `INSERT INTO paystack_payments (reference, user_id, kind, target_id, amount_minor, currency, email, test, payload)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) RETURNING *`,
  [ref, user.id, kind, String(targetId), amountMinor, currency, email, paystackTestMode(env) || !!env.__paystackFetch, JSON.stringify(payload)]);
  try {
    const r = await initializeTransaction(env, {
      email, amountMinor, currency, reference: ref, callbackUrl: `${origin}/pay/paystack/return`,
      metadata: { kind, targetId: String(targetId), userId: user.id, title: payload.title || null, cancel_action: `${origin}/pay/paystack/return?reference=${ref}&cancelled=1` },
    });
    await q(env, `UPDATE paystack_payments SET payload = payload || $2::jsonb WHERE id = $1`, [p.id, JSON.stringify({ url: r.url })]);
    return { reference: ref, url: r.url, payment: paymentShape(p) };
  } catch (e) {
    await q(env, `UPDATE paystack_payments SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`, [p.id, e.code || 'PROVIDER_ERROR']);
    throw e;
  }
}

// ─── 1. start ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Wallet pack or Dating Plus / VIP. Same idempotencyKey → the same open checkout. */
export async function startWalletCheckout(env, user, { productId, idempotencyKey, email, origin }) {
  const key = String(idempotencyKey || '');
  if (!/^[A-Za-z0-9_\-:.]{8,100}$/.test(key)) throw bad('idempotencyKey: 8-100 letters, digits, - _ : .', 'BAD_IDEMPOTENCY_KEY');
  const product = await getProduct(env, String(productId || ''));
  if (!product || !product.active) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'This package is not available');
  await assertCanPay(env, product.currency);
  const mail = await billingEmail(env, user, email);
  if (product.type === 'subscription') {
    const live = await liveSubscription(env, user.id);
    if (live && live.product_id === product.id && live.status === 'active' && live.auto_renew) throw new ApiError(409, 'ALREADY_SUBSCRIBED', 'You already have this plan — it renews automatically');
  }
  const old = await one(env, 'SELECT * FROM wallet_purchases WHERE user_id = $1 AND idempotency_key = $2', [user.id, key]);
  if (old) {
    if (old.product_id !== product.id || old.provider !== 'paystack') throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was used for a different purchase');
    const p = await one(env, 'SELECT * FROM paystack_payments WHERE reference = $1', [old.provider_ref]);
    if (p && p.status === 'success') return { purchase: { id: old.id, status: old.status }, product: productShape(product), payment: paymentShape(p), alreadyProcessed: true };
    if (p && p.status === 'pending' && parse(p.payload, {}).url) return { purchase: { id: old.id, status: old.status }, product: productShape(product), checkout: { reference: p.reference, url: parse(p.payload, {}).url } };
    throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Start a new purchase');
  }
  const reference = newReference('wallet');
  const row = await one(env, `INSERT INTO wallet_purchases (user_id, product_id, provider, provider_ref, idempotency_key, amount_minor, currency, units, test)
      VALUES ($1,$2,'paystack',$3,$4,$5,$6,$7,$8) RETURNING *`,
  [user.id, product.id, reference, key, product.price_minor, product.currency, Number(product.units) + Number(product.bonus_units), paystackTestMode(env) || !!env.__paystackFetch]);
  try {
    const co = await openCheckout(env, { user, kind: 'wallet', targetId: row.id, amountMinor: Number(product.price_minor), currency: product.currency, email: mail, origin, reference, payload: { productId: product.id, title: product.title } });
    return { purchase: { id: row.id, status: row.status }, product: productShape(product), checkout: { reference: co.reference, url: co.url } };
  } catch (e) {
    await q(env, `UPDATE wallet_purchases SET status = 'failed', error_code = $2, updated_at = now() WHERE id = $1`, [row.id, e.code || 'ERROR']);
    throw e;
  }
}

/** Membership plan. price = the quote (after promo). A free total (100% promo) activates without Paystack. */
export async function startMembershipCheckout(env, user, { membership, plan, price, promo, answers, contact, email, origin }) {
  await assertCanPay(env, plan.currency);
  const mail = await billingEmail(env, user, email || (contact && contact.email));
  const payload = { title: membership.title || membership.name || 'Membership', planId: plan.id, answers, contact, promoCode: price.promoCode, promoId: promo ? promo.id : null };
  if (!price.totalMinor) {
    if (promo) {
      const used = await one(env, `UPDATE membership_promos SET uses = uses + 1 WHERE id = $1 AND (max_uses IS NULL OR uses < max_uses) RETURNING id`, [promo.id]);
      if (!used) throw bad('That promo code has been used up', 'BAD_PROMO');
    }
    const sub = await activateSubscription(env, { membership, plan, userId: user.id, source: 'paystack', answers, contact, promoCode: price.promoCode, amountMinor: 0, currency: plan.currency });
    return { free: true, subscription: sub };
  }
  const co = await openCheckout(env, { user, kind: 'membership', targetId: membership.id, amountMinor: price.totalMinor, currency: plan.currency, email: mail, origin, payload });
  return { checkout: { reference: co.reference, url: co.url } };
}

/** BibleNestra Plus plan. */
export async function startPlusCheckout(env, user, { planId, email, origin }) {
  const plan = await one(env, 'SELECT * FROM plus_plans WHERE id = $1 AND active', [String(planId || '')]);
  if (!plan) throw bad('Choose a plan', 'BAD_PLAN');
  await assertCanPay(env, plan.currency);
  const live = await livePlus(env, user.id);
  if (live && live.plan_id === plan.id && live.status === 'active' && live.auto_renew && new Date(live.current_period_end) > new Date()) {
    throw new ApiError(409, 'ALREADY_SUBSCRIBED', 'You already have this plan — it renews automatically');
  }
  const mail = await billingEmail(env, user, email);
  const co = await openCheckout(env, { user, kind: 'plus', targetId: plan.id, amountMinor: Number(plan.price_minor), currency: plan.currency, email: mail, origin, payload: { title: `BibleNestra Plus · ${plan.label}` } });
  return { checkout: { reference: co.reference, url: co.url } };
}

// ─── 2. settle (return page, status poll, webhook, renewal) ───────────────────────────────────────────────────────────
function gatewayOf(raw = {}) {
  return { gatewayId: raw.id != null ? String(raw.id) : null, paidAt: raw.paid_at || raw.paidAt || raw.transaction_date || null, gatewayFeesMinor: raw.fees != null ? Number(raw.fees) : null };
}

/** Save a reusable card authorisation → its id (or null for bank transfer / USSD / non-reusable cards). */
async function saveAuthorization(env, userId, email, raw = {}) {
  const a = raw.authorization || {};
  if (!userId || !a.reusable || !a.authorization_code || (a.channel && a.channel !== 'card')) return null;
  const sig = String(a.signature || a.authorization_code);
  const row = await one(env, `INSERT INTO paystack_authorizations (user_id, authorization_code, signature, email, card_type, last4, bank, exp_month, exp_year)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (user_id, signature) DO UPDATE SET authorization_code = EXCLUDED.authorization_code, email = EXCLUDED.email, active = true, updated_at = now()
    RETURNING id`, [userId, String(a.authorization_code), sig, email || (raw.customer && raw.customer.email) || '', a.card_type || a.brand || null, a.last4 || null, a.bank || null, a.exp_month || null, a.exp_year || null]);
  return row.id;
}

/**
 * Verify with Paystack (unless `verified` is given — the server-to-server charge answer of a renewal) and grant once.
 * → { found, status, payment, granted }
 */
export async function settlePayment(env, reference, { verified = null } = {}) {
  let p = await one(env, 'SELECT * FROM paystack_payments WHERE reference = $1', [String(reference || '')]);
  if (!p) return { found: false };
  // 'processing' is another settle in flight — unless it's been stuck over 2 minutes (grant applied but the "done" mark
  // never landed): then retry; the grants are guarded so an applied payment is never applied twice.
  const stuck = p.status === 'processing' && Date.now() - new Date(p.updated_at).getTime() > 2 * 60e3;
  if (['success', 'refunded', 'review', 'processing'].includes(p.status) && !stuck) return { found: true, status: p.status, payment: paymentShape(p), granted: false };
  const v = verified || await verifyTransaction(env, p.reference);
  if (v.status !== 'success') {
    const to = v.status === 'failed' ? 'failed' : v.status === 'abandoned' && Date.now() - new Date(p.created_at).getTime() > 30 * 60e3 ? 'abandoned' : null;
    if (to && to !== p.status) p = await one(env, `UPDATE paystack_payments SET status = $2, updated_at = now() WHERE id = $1 AND status = $3 RETURNING *`, [p.id, to, p.status]) || p;
    return { found: true, status: to || p.status, gatewayStatus: v.status, payment: paymentShape(p), granted: false };
  }
  if (Number(v.amountMinor) < Number(p.amount_minor) || String(v.currency || '').toUpperCase() !== String(p.currency).toUpperCase()) {
    const r = await one(env, `UPDATE paystack_payments SET status = 'review', error = 'AMOUNT_MISMATCH', gateway = $2::jsonb, updated_at = now() WHERE id = $1 RETURNING *`,
      [p.id, JSON.stringify({ ...gatewayOf(v.raw), paidMinor: v.amountMinor, paidCurrency: v.currency })]);
    return { found: true, status: 'review', payment: paymentShape(r), granted: false };
  }
  // claim (only one settle may grant; a stuck 'processing' row is re-claimable after 2 minutes)
  const claimed = await one(env, `UPDATE paystack_payments SET status = 'processing', updated_at = now() WHERE id = $1
      AND (status IN ('pending','failed','abandoned') OR (status = 'processing' AND updated_at < now() - interval '2 minutes')) RETURNING *`, [p.id]);
  if (!claimed) {
    const now = await one(env, 'SELECT * FROM paystack_payments WHERE id = $1', [p.id]);
    return { found: true, status: now.status, payment: paymentShape(now), granted: false };
  }
  const raw = v.raw || {};
  const channel = raw.channel || (raw.authorization && raw.authorization.channel) || null;
  try {
    const authId = await saveAuthorization(env, claimed.user_id, claimed.email, raw);
    await grant(env, claimed, { authId, raw });
    const done = await one(env, `UPDATE paystack_payments SET status = 'success', paid_at = COALESCE(paid_at, now()), channel = $2, gateway = $3::jsonb, error = NULL, updated_at = now()
        WHERE id = $1 RETURNING *`, [claimed.id, channel, JSON.stringify(gatewayOf(raw))]);
    if (claimed.user_id) await notify(env, claimed.user_id, 'payment', 'Payment received ✅', `${parse(claimed.payload, {}).title || 'Your purchase'} · ${formatPrice(Number(claimed.amount_minor), claimed.currency)}`, { reference: claimed.reference, kind: claimed.kind });
    return { found: true, status: 'success', payment: paymentShape(done), granted: true };
  } catch (e) {
    // The member paid but we could not grant: 4xx business errors go to admin review (refund or grant by hand),
    // anything else goes back to pending so the next poll / webhook retries.
    const to = e.status && e.status < 500 ? 'review' : 'pending';
    const r = await one(env, `UPDATE paystack_payments SET status = $2, error = $3, channel = $4, gateway = $5::jsonb, updated_at = now() WHERE id = $1 RETURNING *`,
      [claimed.id, to, String(e.code || e.message || 'ERROR').slice(0, 200), channel, JSON.stringify(gatewayOf(raw))]);
    if (to === 'pending') throw e;
    return { found: true, status: to, payment: paymentShape(r), granted: false, error: e.code };
  }
}

async function grant(env, p, { authId, raw }) {
  const payload = parse(p.payload, {});
  const renewal = p.purpose === 'renewal';
  const verified = { orderId: p.reference, raw: { reference: p.reference, channel: raw.channel || null, gatewayId: raw.id || null } };
  if (p.kind === 'wallet') {
    const purchase = await one(env, 'SELECT * FROM wallet_purchases WHERE id = $1', [p.target_id]);
    if (!purchase) throw new ApiError(404, 'PURCHASE_NOT_FOUND', 'Purchase not found');
    const product = await getProduct(env, purchase.product_id);
    // Retry after a grant that succeeded but wasn't marked done: this payment was already applied → don't extend again
    if (!renewal && purchase.status === 'verified') return { alreadyApplied: true }; // one purchase row per payment
    if (renewal) {
      const r = await renewSubscription(env, p.subscription_id, { purchaseId: purchase.id, expectStart: payload.expectStart || null });
      await q(env, `UPDATE wallet_purchases SET status = 'verified', verified_at = COALESCE(verified_at, now()), order_id = $2, updated_at = now() WHERE id = $1`, [purchase.id, p.reference]);
      await q(env, `UPDATE dating_subscriptions SET renewal_attempts = 0, last_renewal_at = NULL, updated_at = now() WHERE id = $1`, [p.subscription_id]);
      return r;
    }
    if (product.type === 'subscription') {
      const live = await liveSubscription(env, purchase.user_id);
      if (live && live.product_id === product.id && ['active', 'past_due', 'cancelled'].includes(live.status)) {
        // paying again for the plan they have (bank transfer / USSD renewal, or resuming) → one more period
        const start = new Date(Math.max(Date.now(), new Date(live.current_period_end).getTime()));
        const end = addInterval(start, product.interval);
        const s = await one(env, `UPDATE dating_subscriptions SET status = 'active', provider = 'paystack', auto_renew = $3, paystack_auth_id = COALESCE($2, paystack_auth_id),
            cancelled_at = NULL, current_period_start = $4, current_period_end = $5, renewal_attempts = 0, updated_at = now() WHERE id = $1 RETURNING *`,
        [live.id, authId, !!authId, start.toISOString(), end.toISOString()]);
        await grantCycleBenefits(env, { sub: s, product, periodStart: start, periodEnd: end, purchaseId: purchase.id });
        await q(env, `UPDATE wallet_purchases SET status = 'verified', verified_at = COALESCE(verified_at, now()), order_id = $2, updated_at = now() WHERE id = $1`, [purchase.id, p.reference]);
        return s;
      }
      const r = await activatePurchase(env, { purchase, product, verified });
      await q(env, `UPDATE dating_subscriptions SET auto_renew = $2, paystack_auth_id = $3, updated_at = now()
          WHERE user_id = $1 AND product_id = $4 AND status = 'active'`, [purchase.user_id, !!authId, authId, product.id]);
      return r;
    }
    return activatePurchase(env, { purchase, product, verified });
  }
  if (p.kind === 'membership') {
    const membership = await one(env, 'SELECT * FROM memberships WHERE id = $1', [p.target_id]);
    const plan = membership && payload.planId ? await one(env, 'SELECT * FROM membership_plans WHERE id = $1 AND membership_id = $2', [payload.planId, membership.id]) : null;
    if (!membership || !plan) throw new ApiError(404, 'PLAN_NOT_FOUND', 'This membership plan no longer exists');
    const cur = await subscriptionOf(env, membership.id, p.user_id);
    if (cur && (cur.applied_payment_refs || []).includes(p.reference)) return cur; // this payment was already applied (retry) → don't extend again
    if (!renewal && payload.promoId) {
      await q(env, `UPDATE membership_promos SET uses = uses + 1 WHERE id = $1`, [payload.promoId]); // paid already: count it even if just used up
    }
    const sub = await activateSubscription(env, {
      membership, plan, userId: p.user_id, source: 'paystack',
      answers: renewal && cur ? parse(cur.answers, []) : payload.answers || [],
      contact: renewal && cur ? parse(cur.contact, {}) : payload.contact || {},
      promoCode: renewal ? null : payload.promoCode || null,
      amountMinor: Number(p.amount_minor), currency: p.currency, checkoutKey: p.reference, appliedRef: p.reference,
    });
    const renews = !!authId && plan.interval !== 'one_time';
    await q(env, `UPDATE membership_subscriptions SET auto_renew = CASE WHEN $2 THEN true WHEN $4 THEN auto_renew ELSE false END,
        paystack_auth_id = COALESCE($3, paystack_auth_id), renewal_attempts = 0, last_renewal_at = NULL WHERE id = $1`, [sub.id, renews, authId, renewal]);
    return sub;
  }
  if (p.kind === 'plus') {
    const plan = await one(env, 'SELECT * FROM plus_plans WHERE id = $1', [p.target_id]);
    if (!plan) throw new ApiError(404, 'PLAN_NOT_FOUND', 'This Plus plan no longer exists');
    return activatePlus(env, { userId: p.user_id, plan, provider: 'paystack', test: !!p.test, authId, amountMinor: Number(p.amount_minor), currency: p.currency, renewalOf: renewal ? p.subscription_id : null, paymentRef: p.reference });
  }
  throw new ApiError(400, 'BAD_KIND', 'Unknown payment kind');
}

/** Status for the app's poll after the Paystack page closes. Re-verifies a pending payment (≥ 3 s old). */
export async function paymentStatus(env, user, reference) {
  const p = await one(env, 'SELECT * FROM paystack_payments WHERE reference = $1 AND user_id = $2', [String(reference || ''), user.id]);
  if (!p) throw notFound('Payment not found');
  if (['pending', 'abandoned', 'failed'].includes(p.status) && paystackConfigured(env) && Date.now() - new Date(p.created_at).getTime() > 3000) {
    try { const r = await settlePayment(env, p.reference); if (r.payment) return r.payment; } catch (e) { /* webhook will finish it */ }
  }
  return paymentShape(await one(env, 'SELECT * FROM paystack_payments WHERE id = $1', [p.id]));
}

export async function refundedByGateway(env, reference) {
  const p = await one(env, `UPDATE paystack_payments SET status = 'refunded', updated_at = now() WHERE reference = $1 AND status <> 'refunded' RETURNING *`, [String(reference || '')]);
  if (!p) return { changed: false };
  if (p.kind === 'wallet') {
    const { refundPurchase } = await import('./walletStore.js');
    try { await refundPurchase(env, { purchaseId: p.target_id, reason: 'Refunded through Paystack' }); } catch (e) { /* admin sees it in the ledger */ }
  }
  return { changed: true, kind: p.kind };
}

// ─── BibleNestra Plus ───────────────────────────────────────────────────────────────────────────────────────────────
const PLUS_LIVE = ['active', 'cancelled', 'past_due'];
export const livePlus = (env, userId) => one(env, `SELECT s.*, p.label, p.interval, p.price_minor AS plan_price_minor, p.currency AS plan_currency
  FROM plus_subscriptions s JOIN plus_plans p ON p.id = s.plan_id WHERE s.user_id = $1 AND s.status = ANY($2::text[])`, [userId, PLUS_LIVE]);
const addPlusInterval = (d, interval) => (interval === 'week' ? new Date(new Date(d).getTime() + 7 * 86400e3) : addInterval(d, interval));

export function plusPlanShape(p, all = []) {
  const weekly = all.find((x) => x.interval === 'week' && x.active && x.currency === p.currency);
  let badge = null;
  if (weekly && p.interval === 'year') {
    const save = Math.round((1 - Number(p.price_minor) / (Number(weekly.price_minor) * 52)) * 100);
    if (save > 0) badge = `Save ${save}%`;
  }
  const price = formatPrice(Number(p.price_minor), p.currency);
  return {
    id: p.id, label: p.label, priceMinor: Number(p.price_minor), currency: p.currency, interval: p.interval,
    priceText: price, perText: `a ${p.interval}`, note: p.note || (p.interval === 'year' ? `Just ${formatPrice(Math.round(Number(p.price_minor) / 52 / 100) * 100, p.currency)} a week` : null),
    badge, active: !!p.active, sortOrder: Number(p.sort_order || 0),
  };
}
export async function listPlusPlans(env, { includeInactive = false } = {}) {
  const rows = await q(env, 'SELECT * FROM plus_plans WHERE ($1 OR active) ORDER BY sort_order, price_minor', [includeInactive]);
  return rows.map((r) => plusPlanShape(r, rows));
}
export function plusSubShape(s) {
  if (!s) return null;
  const end = new Date(s.current_period_end);
  const hasAccess = PLUS_LIVE.includes(s.status) && end.getTime() > Date.now();
  return {
    id: s.id, planId: s.plan_id, label: s.label || s.plan_id, status: s.status, provider: s.provider, test: !!s.test, autoRenew: !!s.auto_renew,
    currentPeriodEnd: iso(s.current_period_end), hasAccess, renewsOn: hasAccess && s.auto_renew && s.status === 'active' ? iso(end) : null,
    accessUntil: hasAccess ? iso(end) : null,
    displayPrice: s.amount_minor ? `${formatPrice(Number(s.amount_minor), s.currency)} / ${s.interval || 'period'}` : null,
  };
}

/** Start or extend Plus and mirror it onto users.premium / premium_until (what GET /me and chat limits read). */
export async function activatePlus(env, { userId, plan, provider, test = false, authId = null, amountMinor = null, currency = null, renewalOf = null, paymentRef = null }) {
  const live = await livePlus(env, userId);
  if (paymentRef && live && (live.applied_payment_refs || []).includes(paymentRef)) return live; // this payment was already applied (retry) → don't extend again
  let s;
  if (live && (renewalOf || new Date(live.current_period_end) > new Date())) { // renewal, or buying again while active → one more period from the end
    const start = new Date(Math.max(Date.now(), new Date(live.current_period_end).getTime()));
    const end = addPlusInterval(start, plan.interval);
    s = await one(env, `UPDATE plus_subscriptions SET plan_id = $2, status = 'active', provider = $3, auto_renew = CASE WHEN $4::uuid IS NOT NULL THEN true WHEN $9 THEN auto_renew ELSE false END,
        paystack_auth_id = COALESCE($4, paystack_auth_id), amount_minor = $5, currency = $6, current_period_start = $7, current_period_end = $8,
        renewal_attempts = 0, last_renewal_at = NULL, cancelled_at = NULL, applied_payment_refs = CASE WHEN $10::text IS NULL THEN applied_payment_refs ELSE array_append(applied_payment_refs, $10::text) END, updated_at = now() WHERE id = $1 RETURNING *`,
    [live.id, plan.id, provider, authId, amountMinor, currency, start.toISOString(), end.toISOString(), !!renewalOf, paymentRef]);
  } else {
    if (live) await q(env, `UPDATE plus_subscriptions SET status = 'expired', auto_renew = false, updated_at = now() WHERE id = $1`, [live.id]);
    const start = new Date();
    const end = addPlusInterval(start, plan.interval);
    s = await one(env, `INSERT INTO plus_subscriptions (user_id, plan_id, status, provider, auto_renew, test, paystack_auth_id, amount_minor, currency, current_period_start, current_period_end, applied_payment_refs)
        VALUES ($1,$2,'active',$3,$4,$5,$6,$7,$8,$9,$10,$11::text[]) RETURNING *`,
    [userId, plan.id, provider, !!authId, !!test, authId, amountMinor, currency, start.toISOString(), end.toISOString(), paymentRef ? [paymentRef] : []]);
  }
  await q(env, `UPDATE users SET premium = true,
      premium_until = CASE WHEN premium AND premium_until IS NULL THEN NULL ELSE GREATEST(COALESCE(premium_until, $2::timestamptz), $2::timestamptz) END WHERE id = $1`,
  [userId, new Date(s.current_period_end).toISOString()]);
  return s;
}

export async function cancelPlus(env, userId) {
  const s = await one(env, `UPDATE plus_subscriptions SET status = 'cancelled', auto_renew = false, cancelled_at = now(), updated_at = now()
      WHERE user_id = $1 AND status IN ('active','past_due') RETURNING id`, [userId]);
  if (!s) throw bad('You don’t have an active Plus plan', 'NOT_ACTIVE');
  return plusSubShape(await livePlus(env, userId));
}

/** Test purchase of Plus (admins / testers with WALLET_TEST_PURCHASES) — no money moves. */
export async function testPlus(env, user, planId) {
  if (!testPurchaseAllowed(env, user)) throw new ApiError(403, 'TEST_PURCHASES_DISABLED', 'Test purchases are only for admins and testers');
  const plan = await one(env, 'SELECT * FROM plus_plans WHERE id = $1 AND active', [String(planId || '')]);
  if (!plan) throw bad('Choose a plan', 'BAD_PLAN');
  return activatePlus(env, { userId: user.id, plan, provider: 'test', test: true, amountMinor: Number(plan.price_minor), currency: plan.currency });
}

// ─── 3. renewals + reminders (cron) ─────────────────────────────────────────────────────────────────────────────────
async function notify(env, userId, kind, title, body, data = {}) {
  try { await q(env, 'INSERT INTO notifications (user_id, kind, title, body, data) VALUES ($1,$2,$3,$4,$5)', [userId, kind, title, body, JSON.stringify(data)]); } catch (e) { /* inbox is best effort */ }
}
const dateText = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });

/** Charges saved cards for subscriptions ending within 24 h. Up to 3 tries, 6 h apart; then renewal stops and we tell them. */
export async function runPaystackRenewals(env, { now = new Date(), limit = 50 } = {}) {
  if (!paystackConfigured(env)) return { charged: 0 };
  const soon = new Date(now.getTime() + 24 * 3600e3).toISOString();
  const retry = new Date(now.getTime() - 6 * 3600e3).toISOString();
  const pick = (table, end) => `${table}.status = 'active' AND ${table}.auto_renew AND ${table}.paystack_auth_id IS NOT NULL AND ${table}.${end} <= $1
      AND ${table}.renewal_attempts < 3 AND (${table}.last_renewal_at IS NULL OR ${table}.last_renewal_at < $2)`;
  const jobs = [];
  for (const s of await q(env, `SELECT dating_subscriptions.*, w.price_minor, w.currency, w.title, w.units, w.bonus_units FROM dating_subscriptions JOIN wallet_products w ON w.id = dating_subscriptions.product_id
      WHERE dating_subscriptions.provider = 'paystack' AND ${pick('dating_subscriptions', 'current_period_end')} LIMIT $3`, [soon, retry, limit])) {
    jobs.push({ table: 'dating_subscriptions', s, kind: 'wallet', amountMinor: Number(s.price_minor), currency: s.currency, title: s.title });
  }
  for (const s of await q(env, `SELECT membership_subscriptions.*, p.price_minor, p.currency AS plan_currency, p.interval, m.title FROM membership_subscriptions
      JOIN membership_plans p ON p.id = membership_subscriptions.plan_id JOIN memberships m ON m.id = membership_subscriptions.membership_id
      WHERE membership_subscriptions.source = 'paystack' AND p.interval <> 'one_time' AND ${pick('membership_subscriptions', 'expires_at')} LIMIT $3`, [soon, retry, limit])) {
    jobs.push({ table: 'membership_subscriptions', s, kind: 'membership', amountMinor: Number(s.price_minor), currency: s.plan_currency, title: s.title || 'Membership' });
  }
  for (const s of await q(env, `SELECT plus_subscriptions.*, p.price_minor, p.currency AS plan_currency, p.label FROM plus_subscriptions JOIN plus_plans p ON p.id = plus_subscriptions.plan_id
      WHERE plus_subscriptions.provider = 'paystack' AND ${pick('plus_subscriptions', 'current_period_end')} LIMIT $3`, [soon, retry, limit])) {
    jobs.push({ table: 'plus_subscriptions', s, kind: 'plus', amountMinor: Number(s.price_minor), currency: s.plan_currency, title: `BibleNestra Plus · ${s.label}` });
  }
  let charged = 0; let failed = 0;
  for (const j of jobs) {
    const r = await renewOne(env, j, now).catch((e) => { console.error('paystack renewal failed', j.table, j.s.id, e && e.message); return { ok: false }; });
    if (r.ok) charged++; else failed++;
  }
  return { charged, failed };
}

async function renewOne(env, { table, s, kind, amountMinor, currency, title }, now) {
  // mark the attempt first, so two cron ticks never charge the same cycle twice
  const marked = await one(env, `UPDATE ${table} SET last_renewal_at = $2, renewal_attempts = renewal_attempts + 1 WHERE id = $1
      AND (last_renewal_at IS NULL OR last_renewal_at < $3) RETURNING renewal_attempts`, [s.id, now.toISOString(), new Date(now.getTime() - 6 * 3600e3).toISOString()]);
  if (!marked) return { ok: false };
  const auth = await one(env, 'SELECT * FROM paystack_authorizations WHERE id = $1 AND active', [s.paystack_auth_id]);
  if (!auth) return stopRenewal(env, table, s, title, 'The saved card is no longer available.');
  const end = new Date(table === 'membership_subscriptions' ? s.expires_at : s.current_period_end);
  const reference = `bnr-${String(s.id).replace(/-/g, '').slice(0, 12)}-${end.getTime()}-${marked.renewal_attempts}`;
  let targetId = kind === 'membership' ? s.membership_id : kind === 'plus' ? s.plan_id : null;
  const payload = { title, renewal: true, planId: kind === 'membership' ? s.plan_id : undefined, expectStart: kind === 'wallet' ? iso(s.current_period_start) : undefined };
  if (kind === 'wallet') {
    const wp = await one(env, `INSERT INTO wallet_purchases (user_id, product_id, provider, provider_ref, idempotency_key, amount_minor, currency, units, test)
        VALUES ($1,$2,'paystack',$3,$3,$4,$5,0,$6) RETURNING id`, [s.user_id, s.product_id, reference, amountMinor, currency, !!s.test || paystackTestMode(env)]);
    targetId = wp.id;
  }
  await q(env, `INSERT INTO paystack_payments (reference, user_id, kind, purpose, target_id, subscription_id, amount_minor, currency, email, test, payload)
      VALUES ($1,$2,$3,'renewal',$4,$5,$6,$7,$8,$9,$10::jsonb)`,
  [reference, s.user_id, kind, String(targetId), s.id, amountMinor, currency, auth.email, paystackTestMode(env) || !!env.__paystackFetch, JSON.stringify(payload)]);
  let r;
  try {
    r = await chargeAuthorization(env, { authorizationCode: auth.authorization_code, email: auth.email, amountMinor, currency, reference, metadata: { kind, renewal: true, subscriptionId: s.id } });
  } catch (e) {
    r = { status: 'failed', raw: { message: e.message } };
  }
  if (r.status === 'success') {
    await settlePayment(env, reference, { verified: r });
    return { ok: true };
  }
  if (r.status === 'failed') {
    await q(env, `UPDATE paystack_payments SET status = 'failed', error = $2, updated_at = now() WHERE reference = $1`, [reference, String((r.raw && (r.raw.gateway_response || r.raw.message)) || 'Card declined').slice(0, 200)]);
    if (kind === 'wallet') await q(env, `UPDATE wallet_purchases SET status = 'failed', error_code = 'CARD_DECLINED', updated_at = now() WHERE id = $1`, [targetId]);
    if (marked.renewal_attempts >= 3) return stopRenewal(env, table, s, title, 'We couldn’t charge your card.');
    return { ok: false };
  }
  return { ok: false }; // pending (bank OTP etc.): the webhook settles it
}

async function stopRenewal(env, table, s, title, why) {
  await q(env, `UPDATE ${table} SET auto_renew = false, updated_at = now() WHERE id = $1`, [s.id]);
  await notify(env, s.user_id, 'payment', 'Renewal didn’t go through', `${why} ${title} won’t renew automatically. Open the app to pay again and keep access.`, { subscriptionId: s.id });
  return { ok: false };
}

/** 3 days before a plan that doesn't renew by card ends: one reminder per period. */
export async function runPaystackReminders(env, { now = new Date() } = {}) {
  const until = new Date(now.getTime() + 3 * 86400e3).toISOString();
  const nowIso = now.toISOString();
  let sent = 0;
  const each = async (rows, endCol, titleOf) => {
    for (const s of rows) {
      const ok = await one(env, `UPDATE ${s.__t} SET reminded_for = ${endCol} WHERE id = $1 AND reminded_for IS DISTINCT FROM ${endCol} RETURNING id`, [s.id]);
      if (!ok) continue;
      await notify(env, s.user_id, 'payment', 'Your plan ends soon', `${titleOf(s)} ends on ${dateText(s[endCol])}. Open the app to renew and keep access.`, { subscriptionId: s.id });
      sent++;
    }
  };
  const tag = (t) => (rows) => rows.map((r) => ({ ...r, __t: t }));
  await each(tag('dating_subscriptions')(await q(env, `SELECT s.*, w.title FROM dating_subscriptions s JOIN wallet_products w ON w.id = s.product_id
      WHERE s.provider = 'paystack' AND s.status = 'active' AND NOT s.auto_renew AND s.current_period_end BETWEEN $1 AND $2 AND s.reminded_for IS DISTINCT FROM s.current_period_end`, [nowIso, until])), 'current_period_end', (s) => s.title);
  await each(tag('membership_subscriptions')(await q(env, `SELECT s.*, m.title FROM membership_subscriptions s JOIN memberships m ON m.id = s.membership_id
      WHERE s.source = 'paystack' AND s.status = 'active' AND NOT s.auto_renew AND s.expires_at BETWEEN $1 AND $2 AND s.reminded_for IS DISTINCT FROM s.expires_at`, [nowIso, until])), 'expires_at', (s) => s.title || 'Your membership');
  await each(tag('plus_subscriptions')(await q(env, `SELECT s.*, p.label FROM plus_subscriptions s JOIN plus_plans p ON p.id = s.plan_id
      WHERE s.provider = 'paystack' AND s.status = 'active' AND NOT s.auto_renew AND s.current_period_end BETWEEN $1 AND $2 AND s.reminded_for IS DISTINCT FROM s.current_period_end`, [nowIso, until])), 'current_period_end', (s) => `BibleNestra Plus (${s.label})`);
  return { reminded: sent };
}

/** Ends Plus periods that are over. users.premium_until already stops access on time. */
export async function expirePlus(env, { now = new Date() } = {}) {
  const r = await q(env, `UPDATE plus_subscriptions SET status = 'expired', auto_renew = false, updated_at = now()
      WHERE status IN ('active','cancelled','past_due') AND current_period_end <= $1::timestamptz - interval '1 day' RETURNING id`, [now.toISOString()]);
  return { expired: r.length };
}

export async function runPaystackCron(env) {
  const renew = await runPaystackRenewals(env);
  const remind = await runPaystackReminders(env);
  const plus = await expirePlus(env);
  return { ...renew, ...remind, plusExpired: plus.expired };
}
