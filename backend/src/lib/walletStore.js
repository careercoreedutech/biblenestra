// WALLET STORE — products (packs + subscriptions), purchases, payment providers and Dating Plus / VIP subscriptions.
// Ledger writes go through lib/wallet.js post(). Contract: scratch/monetisation/wallet-core.md.
//
// PROVIDERS (brief 3.4 — digital goods bought in the app must use the store's billing):
//   'play'     Google Play Billing. verifyStorePurchase() → lib/play.js verifyPlayPurchase() (the ONE Play module, shared
//              with Memberships), which answers PAYMENTS_NOT_CONFIGURED until GOOGLE_PLAY_PACKAGE_NAME +
//              GOOGLE_PLAY_SERVICE_ACCOUNT_JSON exist and the real Google API call is written. Each product carries its Play product id (wallet_products.play_product_id).
//              A purchase token can only ever belong to one purchase row (unique index) → DUPLICATE_PURCHASE_TOKEN.
//   'apple'    Apple IAP — slot only (PAYMENTS_NOT_CONFIGURED).
//   'test'     WALLET_TEST_PURCHASES=true AND (admin OR listed in WALLET_TESTERS by id / handle / dev name).
//              Credits at once, row marked test = true. No money moves.
//   'paystack' NOT for digital goods — refused here (PROVIDER_NOT_ALLOWED). Used by Fund Me donations / payouts.
// activatePurchase() is the ONE place a purchase turns into wallet units or a subscription, only after verification.
// It is idempotent: the ledger ref is 'purchase:<purchase id>'.
import { q, one } from './db.js';
import { ApiError, bad, notFound } from './http.js';
import { post, PURCHASABLE_WALLETS, releaseMaturedEarnings } from './wallet.js';
import { formatPrice } from './memberships.js';
import { isOn, playConfigured, verifyPlayPurchase, testerAllowed, storeMethod, paymentsNotConfigured } from './play.js';
import { paystackConfigured } from './paystack.js';

const parse = (v, d) => (v == null ? d : typeof v === 'string' ? JSON.parse(v) : v);
const listEnv = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
const iso = (d) => (d ? new Date(d).toISOString() : null);
export const AREAS = { fundme: 'Fund Me', dating: 'Find Love', gifts: 'Gifts' };
export const BENEFIT_WALLETS = ['dating_coins', 'dating_boosts', 'gift_coins', 'fundme_credits'];

// ─── products ─────────────────────────────────────────────────────────────────────────────────────────────────────
export function productShape(p) {
  const units = Number(p.units || 0); const bonus = Number(p.bonus_units || 0);
  const price = formatPrice(Number(p.price_minor), p.currency);
  return {
    id: p.id, type: p.type, area: p.area, wallet: p.wallet || null, title: p.title, description: p.description || '',
    units, bonusUnits: bonus, totalUnits: units + bonus,
    priceMinor: Number(p.price_minor), currency: p.currency,
    displayPrice: p.type === 'subscription' ? `${price} / ${p.interval}` : price,
    priceLabel: p.type === 'subscription' ? `${price} / ${p.interval}` : price,
    interval: p.interval || null, tier: Number(p.tier || 0), benefits: parse(p.benefits, {}),
    playProductId: p.play_product_id || null, appleProductId: p.apple_product_id || null,
    active: !!p.active, sortOrder: Number(p.sort_order || 0),
  };
}
export async function listProducts(env, { wallet = null, area = null, type = null, includeInactive = false } = {}) {
  const rows = await q(env, `SELECT * FROM wallet_products WHERE ($1::text IS NULL OR wallet = $1) AND ($2::text IS NULL OR area = $2)
      AND ($3::text IS NULL OR type = $3) AND ($4 OR active) ORDER BY area, type, sort_order, price_minor`, [wallet, area, type, includeInactive]);
  return rows.map(productShape);
}
export const getProduct = (env, id) => one(env, 'SELECT * FROM wallet_products WHERE id = $1', [id]);

/** Validate admin input for a product. Returns DB columns. `existing` = current row when editing. */
export function cleanProduct(b, existing = null) {
  const out = {};
  const has = (k) => b[k] !== undefined;
  if (!existing) {
    if (!/^[a-z0-9][a-z0-9_]{2,60}$/.test(String(b.id || ''))) throw bad('id: 3-61 lowercase letters, digits or _', 'BAD_PRODUCT');
    out.id = b.id;
    if (!['pack', 'subscription'].includes(b.type)) throw bad('type must be pack or subscription', 'BAD_PRODUCT');
    out.type = b.type;
  }
  const type = existing ? existing.type : out.type;
  if (has('area') || !existing) { if (!AREAS[b.area]) throw bad('area must be fundme, dating or gifts', 'BAD_PRODUCT'); out.area = b.area; }
  if (type === 'pack' && (has('wallet') || !existing)) {
    if (!PURCHASABLE_WALLETS.includes(b.wallet)) throw bad(`wallet must be one of ${PURCHASABLE_WALLETS.join(', ')}`, 'BAD_PRODUCT');
    out.wallet = b.wallet;
  }
  if (has('title') || !existing) { const t = String(b.title || '').trim(); if (!t || t.length > 80) throw bad('title: 1-80 characters', 'BAD_PRODUCT'); out.title = t; }
  if (has('description')) out.description = String(b.description || '').slice(0, 600);
  const intField = (k, col, min, max) => {
    if (!has(k)) return;
    const n = Number(b[k]);
    if (!Number.isSafeInteger(n) || n < min || n > max) throw bad(`${k} must be a whole number ${min}-${max}`, 'BAD_PRODUCT');
    out[col] = n;
  };
  intField('units', 'units', type === 'pack' ? 1 : 0, 1e9);
  intField('bonusUnits', 'bonus_units', 0, 1e9);
  intField('priceMinor', 'price_minor', 1, 1e12);
  intField('tier', 'tier', 0, 9);
  intField('sortOrder', 'sort_order', -1000, 100000);
  if (!existing && type === 'pack' && out.units == null) throw bad('units is required for a pack', 'BAD_PRODUCT');
  if (!existing && out.price_minor == null) throw bad('priceMinor is required', 'BAD_PRODUCT');
  if (has('currency')) { if (!/^[A-Z]{3}$/.test(String(b.currency))) throw bad('currency: 3 capital letters', 'BAD_PRODUCT'); out.currency = b.currency; }
  if (type === 'subscription' && (has('interval') || !existing)) { if (!['month', 'year'].includes(b.interval)) throw bad('interval must be month or year', 'BAD_PRODUCT'); out.interval = b.interval; }
  if (has('benefits')) {
    const bn = b.benefits && typeof b.benefits === 'object' ? b.benefits : {};
    const features = Array.isArray(bn.features) ? bn.features.map((s) => String(s).trim().slice(0, 120)).filter(Boolean).slice(0, 30) : [];
    const flags = {};
    for (const [k, v] of Object.entries(bn.flags || {})) if (/^[a-zA-Z][a-zA-Z0-9]{0,40}$/.test(k)) flags[k] = !!v;
    const perCycle = (Array.isArray(bn.perCycle) ? bn.perCycle : []).map((g) => {
      const amt = Number(g && g.amount);
      if (!BENEFIT_WALLETS.includes(g && g.wallet) || !Number.isSafeInteger(amt) || amt <= 0 || amt > 1e7) throw bad('perCycle entries need a wallet and a positive amount', 'BAD_PRODUCT');
      return { wallet: g.wallet, amount: amt };
    }).slice(0, 10);
    out.benefits = JSON.stringify({ badge: bn.badge ? String(bn.badge).slice(0, 20) : null, features, flags, perCycle });
  }
  for (const [k, col] of [['playProductId', 'play_product_id'], ['appleProductId', 'apple_product_id']]) {
    if (!has(k)) continue;
    const v = b[k] == null || b[k] === '' ? null : String(b[k]).trim();
    if (v && !/^[a-z0-9][a-z0-9_.]{1,99}$/.test(v)) throw bad(`${k}: lowercase letters, digits, _ and .`, 'BAD_PRODUCT');
    out[col] = v;
  }
  if (has('active')) out.active = !!b.active;
  return out;
}
export async function createProduct(env, b) {
  const c = cleanProduct(b);
  const cols = Object.keys(c);
  try {
    const row = await one(env, `INSERT INTO wallet_products (${cols.join(',')}) VALUES (${cols.map((k, i) => (k === 'benefits' ? `$${i + 1}::jsonb` : `$${i + 1}`)).join(',')}) RETURNING *`, cols.map((k) => c[k]));
    return productShape(row);
  } catch (e) {
    if (e.code === '23505' || /duplicate key|unique/i.test(String(e.message))) throw new ApiError(409, 'PRODUCT_EXISTS', 'A product with this id or store product id already exists');
    if (e.code === '23514') throw bad('Product is incomplete (packs need a wallet and units; subscriptions an interval)', 'BAD_PRODUCT');
    throw e;
  }
}
export async function updateProduct(env, id, b) {
  const existing = await getProduct(env, id);
  if (!existing) throw notFound('Product not found');
  const c = cleanProduct(b, existing);
  const cols = Object.keys(c);
  if (!cols.length) return productShape(existing);
  try {
    const row = await one(env, `UPDATE wallet_products SET ${cols.map((k, i) => `${k} = $${i + 2}${k === 'benefits' ? '::jsonb' : ''}`).join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`, [id, ...cols.map((k) => c[k])]);
    return productShape(row);
  } catch (e) {
    if (e.code === '23505' || /duplicate key|unique/i.test(String(e.message))) throw new ApiError(409, 'PRODUCT_EXISTS', 'That store product id is used by another product');
    throw e;
  }
}

// ─── providers ────────────────────────────────────────────────────────────────────────────────────────────────────
/** 'test' provider: WALLET_TEST_PURCHASES=true AND (platform admin OR listed in WALLET_TESTERS by id / handle / dev name). */
export function testPurchaseAllowed(env, user) {
  return testerAllowed(env, user, { flag: 'WALLET_TEST_PURCHASES', list: 'WALLET_TESTERS' });
}
/** Payment rows for the Buy sheet. Paystack never appears for digital goods. */
export function purchaseMethods(env, user, platform = 'android') {
  const out = [storeMethod(env, platform)];
  if (testPurchaseAllowed(env, user)) out.unshift({ id: 'test', label: 'Test purchase', provider: 'test', available: true, note: 'Admins & testers only · no money moves' });
  return out;
}
export function providerStatus(env) {
  return {
    play: { configured: playConfigured(env), forDigitalGoods: true },
    apple: { configured: false, forDigitalGoods: true },
    test: { configured: isOn(env.WALLET_TEST_PURCHASES), forDigitalGoods: true, testers: listEnv(env.WALLET_TESTERS).length },
    paystack: { configured: paystackConfigured(env), forDigitalGoods: false, usedFor: 'Fund Me donations and payouts (web checkout later)' },
  };
}

/**
 * Verify a store purchase server-side through the shared Play module (lib/play.js → { productId, purchaseToken, orderId,
 * expiresAt, priceMinor, currency, raw }). Fails closed with PAYMENTS_NOT_CONFIGURED until Play is set up.
 */
export async function verifyStorePurchase(env, { product, purchaseToken }) {
  const productId = product.play_product_id;
  if (!productId) throw new ApiError(409, 'NO_STORE_PRODUCT', 'This package is not linked to a Google Play product yet');
  return verifyPlayPurchase(env, { productId, purchaseToken, type: product.type });
}

// ─── purchases ────────────────────────────────────────────────────────────────────────────────────────────────────
export function purchaseShape(p) {
  return {
    id: p.id, userId: p.user_id, productId: p.product_id, provider: p.provider, status: p.status, test: !!p.test,
    amountMinor: Number(p.amount_minor), currency: p.currency, displayAmount: formatPrice(Number(p.amount_minor), p.currency),
    priceLabel: formatPrice(Number(p.amount_minor), p.currency),
    units: Number(p.units || 0), orderId: p.order_id || null, errorCode: p.error_code || null,
    createdAt: iso(p.created_at), verifiedAt: iso(p.verified_at),
    ...(p.display_name !== undefined ? { user: { id: p.user_id, name: p.display_name, handle: p.handle || null } } : {}),
    ...(p.product_title !== undefined ? { productTitle: p.product_title } : {}),
  };
}

/**
 * POST /wallet/purchase. Returns { purchase, product, balances?, subscription?, alreadyProcessed }.
 * Errors: PRODUCT_NOT_FOUND 404 · PROVIDER_NOT_ALLOWED 400 · TEST_PURCHASES_DISABLED 403 · PAYMENTS_NOT_CONFIGURED 503 ·
 *         DUPLICATE_PURCHASE_TOKEN 409 · IDEMPOTENCY_CONFLICT 409 · ALREADY_SUBSCRIBED 409 · PURCHASE_NOT_VERIFIED 402
 */
export async function createPurchase(env, user, { productId, provider, idempotencyKey, purchaseToken = null }) {
  const key = String(idempotencyKey || '');
  if (!/^[A-Za-z0-9_\-:.]{8,100}$/.test(key)) throw bad('idempotencyKey: 8-100 letters, digits, - _ : .', 'BAD_IDEMPOTENCY_KEY');
  const product = await getProduct(env, String(productId || ''));
  if (!product || !product.active) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'This package is not available');
  if (provider === 'paystack') throw new ApiError(400, 'PROVIDER_NOT_ALLOWED', 'Coins, credits and subscriptions are bought through Google Play in the app. Paystack is only for Fund Me donations.');
  if (provider === 'apple') throw paymentsNotConfigured();
  if (provider === 'test' && !testPurchaseAllowed(env, user)) throw new ApiError(403, 'TEST_PURCHASES_DISABLED', 'Test purchases are only for admins and testers');
  if (!['test', 'play'].includes(provider)) throw bad('provider must be play (or test for testers)', 'BAD_PROVIDER');
  let token = null;
  if (provider === 'play') {
    token = String(purchaseToken || '');
    if (token.length < 10 || token.length > 4096) throw bad('purchaseToken is required for Google Play', 'BAD_PURCHASE');
  }

  // same idempotency key → same purchase
  let row = await one(env, 'SELECT * FROM wallet_purchases WHERE user_id = $1 AND idempotency_key = $2', [user.id, key]);
  if (row && (row.product_id !== product.id || row.provider !== provider)) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was used for a different purchase');
  if (!row && token) {
    const t = await one(env, 'SELECT * FROM wallet_purchases WHERE provider = $1 AND provider_ref = $2', ['play', token]);
    if (t && t.user_id !== user.id) throw new ApiError(409, 'DUPLICATE_PURCHASE_TOKEN', 'This purchase was already used');
    if (t && t.product_id !== product.id) throw new ApiError(409, 'DUPLICATE_PURCHASE_TOKEN', 'This purchase token belongs to another package');
    row = t; // Play redelivering the same purchase → same row
  }
  if (row && row.status === 'verified') return { purchase: purchaseShape(row), product: productShape(product), alreadyProcessed: true };
  if (row && row.status === 'refunded') throw new ApiError(409, 'PURCHASE_REFUNDED', 'This purchase was refunded');

  if (product.type === 'subscription') {
    const live = await liveSubscription(env, user.id);
    if (live && live.product_id === product.id && live.status === 'active') throw new ApiError(409, 'ALREADY_SUBSCRIBED', 'You already have this plan');
  }

  if (!row) {
    try {
      row = await one(env, `INSERT INTO wallet_purchases (user_id, product_id, provider, provider_ref, idempotency_key, amount_minor, currency, units, test)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (user_id, idempotency_key) DO NOTHING RETURNING *`,
      [user.id, product.id, provider, token, key, product.price_minor, product.currency, Number(product.units) + Number(product.bonus_units), provider === 'test']);
    } catch (e) {
      if (!(e.code === '23505' || /duplicate key|unique/i.test(String(e.message)))) throw e;
      // the same Play token arrived twice at once (two keys): continue with the row that won, if it is this member's
      const t = token ? await one(env, 'SELECT * FROM wallet_purchases WHERE provider = $1 AND provider_ref = $2', ['play', token]) : null;
      if (!t || t.user_id !== user.id || t.product_id !== product.id) throw new ApiError(409, 'DUPLICATE_PURCHASE_TOKEN', 'This purchase was already used');
      row = t;
    }
    if (!row) row = await one(env, 'SELECT * FROM wallet_purchases WHERE user_id = $1 AND idempotency_key = $2', [user.id, key]); // lost a race with a retry
    if (row.status === 'verified') return { purchase: purchaseShape(row), product: productShape(product), alreadyProcessed: true };
  }

  let verified;
  if (provider === 'test') verified = { test: true, orderId: `test:${row.id}`, raw: { test: true, by: user.id } };
  else {
    try { verified = await verifyStorePurchase(env, { product, purchaseToken: token }); } catch (e) {
      await q(env, `UPDATE wallet_purchases SET status = 'failed', error_code = $2, updated_at = now() WHERE id = $1 AND status <> 'verified'`, [row.id, e.code || 'ERROR']);
      throw e;
    }
  }
  try {
    return await activatePurchase(env, { purchase: row, product, verified, user });
  } catch (e) {
    await q(env, `UPDATE wallet_purchases SET status = 'failed', error_code = $2, updated_at = now() WHERE id = $1 AND status = 'pending'`, [row.id, e.code || 'ERROR']);
    throw e;
  }
}

/**
 * THE one place a verified purchase becomes wallet units / a subscription. Idempotent (ledger ref purchase:<id>).
 * Later: the Play RTDN webhook calls this for renewals / redeliveries after verifyStorePurchase().
 */
export async function activatePurchase(env, { purchase, product, verified, user = null }) {
  const userId = purchase.user_id;
  let subscription = null;
  if (product.type === 'pack') {
    const units = Number(product.units) + Number(product.bonus_units);
    await post(env, {
      ref: `purchase:${purchase.id}`, kind: purchase.test ? 'test_purchase' : 'purchase', actorId: userId,
      meta: { productId: product.id, provider: purchase.provider },
      legs: [{ userId, wallet: product.wallet, amount: units, relatedType: 'purchase', relatedId: purchase.id, meta: { productId: product.id, title: product.title } }],
    });
  } else {
    subscription = await startSubscription(env, { userId, product, purchase, verified });
  }
  const row = await one(env, `UPDATE wallet_purchases SET status = 'verified', verified_at = COALESCE(verified_at, now()), order_id = COALESCE($2, order_id),
      raw = $3::jsonb, error_code = NULL, updated_at = now() WHERE id = $1 RETURNING *`,
  [purchase.id, verified.orderId || null, JSON.stringify(verified.raw || {})]);
  return { purchase: purchaseShape(row), product: productShape(product), subscription, alreadyProcessed: false };
}

/** Refund / chargeback: marks the purchase refunded and takes the units back (may fail with INSUFFICIENT_BALANCE if spent). */
export async function refundPurchase(env, { purchaseId, actorId = null, reason = '' }) {
  const p = await one(env, 'SELECT * FROM wallet_purchases WHERE id = $1', [purchaseId]);
  if (!p) throw notFound('Purchase not found');
  if (p.status !== 'verified') throw bad('Only verified purchases can be refunded', 'BAD_STATUS');
  const product = await getProduct(env, p.product_id);
  if (product.type === 'pack' && Number(p.units) > 0) {
    await post(env, { ref: `purchase_reversal:${p.id}`, kind: 'purchase_reversal', actorId, meta: { reason },
      legs: [{ userId: p.user_id, wallet: product.wallet, amount: -Number(p.units), relatedType: 'purchase', relatedId: p.id }] });
  } else if (product.type === 'subscription') {
    await q(env, `UPDATE dating_subscriptions SET status = 'refunded', auto_renew = false, ended_at = now(), updated_at = now()
      WHERE user_id = $1 AND product_id = $2 AND status IN ('active','cancelled','past_due')`, [p.user_id, p.product_id]);
  }
  return purchaseShape(await one(env, `UPDATE wallet_purchases SET status = 'refunded', updated_at = now() WHERE id = $1 RETURNING *`, [p.id]));
}

// ─── Dating Plus / VIP subscriptions ──────────────────────────────────────────────────────────────────────────────
const LIVE = ['active', 'cancelled', 'past_due'];
export function addInterval(date, interval = 'month') {
  const d = new Date(date);
  if (interval === 'year') d.setUTCFullYear(d.getUTCFullYear() + 1); else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}
export const liveSubscription = (env, userId) => one(env, `SELECT s.*, p.title, p.tier, p.benefits, p.interval, p.price_minor, p.currency, p.play_product_id
  FROM dating_subscriptions s JOIN wallet_products p ON p.id = s.product_id WHERE s.user_id = $1 AND s.status = ANY($2::text[])`, [userId, LIVE]);

export function subscriptionShape(s, env = {}) {
  const end = s.current_period_end ? new Date(s.current_period_end) : null;
  const hasAccess = LIVE.includes(s.status) && !!end && end.getTime() > Date.now();
  const pkg = env.GOOGLE_PLAY_PACKAGE_NAME;
  return {
    id: s.id, productId: s.product_id, title: s.title || s.product_id, tier: Number(s.tier || 0), status: s.status, provider: s.provider, test: !!s.test,
    autoRenew: !!s.auto_renew, currentPeriodStart: iso(s.current_period_start), currentPeriodEnd: iso(s.current_period_end),
    cancelledAt: iso(s.cancelled_at), endedAt: iso(s.ended_at), hasAccess,
    renewsOn: hasAccess && s.auto_renew && s.status === 'active' ? iso(s.current_period_end) : null,
    accessUntil: hasAccess ? iso(s.current_period_end) : null,
    displayPrice: s.price_minor != null ? `${formatPrice(Number(s.price_minor), s.currency)} / ${s.interval || 'month'}` : null,
    benefits: parse(s.benefits, {}),
    manageUrl: s.provider === 'play' ? `https://play.google.com/store/account/subscriptions${s.play_product_id && pkg ? `?sku=${encodeURIComponent(s.play_product_id)}&package=${encodeURIComponent(pkg)}` : ''}` : null,
  };
}

/** Grant the per-cycle benefits (VIP: 300 Dating Coins + 2 boosts) once per (subscription, period_start). */
export async function grantCycleBenefits(env, { sub, product, periodStart, periodEnd, purchaseId = null }) {
  const startIso = new Date(periodStart).toISOString();
  const perCycle = (parse(product.benefits, {}).perCycle || []).filter((g) => BENEFIT_WALLETS.includes(g.wallet) && g.amount > 0);
  const ref = perCycle.length ? `subcycle:${sub.id}:${new Date(periodStart).getTime()}` : null;
  await q(env, `INSERT INTO dating_subscription_periods (subscription_id, period_start, period_end, purchase_id, grant_ref)
      VALUES ($1, $2, $3, $4, $5) ON CONFLICT (subscription_id, period_start) DO NOTHING`, [sub.id, startIso, new Date(periodEnd).toISOString(), purchaseId, ref]);
  if (!ref) return { granted: false, ref: null };
  const r = await post(env, { ref, kind: 'subscription_bonus', meta: { subscriptionId: sub.id, productId: product.id, periodStart: startIso },
    legs: perCycle.map((g) => ({ userId: sub.user_id, wallet: g.wallet, amount: g.amount, relatedType: 'subscription', relatedId: sub.id, meta: { productId: product.id, periodStart: startIso } })) });
  return { granted: r.applied, ref };
}

async function startSubscription(env, { userId, product, purchase, verified }) {
  const now = new Date();
  const live = await liveSubscription(env, userId);
  if (live && live.product_id === product.id) {
    if (live.status === 'active') return subscriptionShape(live, env); // redelivery
    // cancelled / past_due, same plan → resume with a fresh paid period
    const end = verified.expiresAt ? new Date(verified.expiresAt) : addInterval(now, product.interval);
    const s = await one(env, `UPDATE dating_subscriptions SET status = 'active', auto_renew = true, cancelled_at = NULL, current_period_start = $2,
        current_period_end = $3, updated_at = now() WHERE id = $1 RETURNING *`, [live.id, now.toISOString(), end.toISOString()]);
    await grantCycleBenefits(env, { sub: s, product, periodStart: now, periodEnd: end, purchaseId: purchase.id });
    return subscriptionShape({ ...s, ...pick(product) }, env);
  }
  if (live) { // switching plan (Plus ⇄ VIP): the old one ends now. Google Play handles proration for real purchases.
    await q(env, `UPDATE dating_subscriptions SET status = 'expired', auto_renew = false, ended_at = now(), updated_at = now() WHERE id = $1`, [live.id]);
  }
  const end = verified.expiresAt ? new Date(verified.expiresAt) : addInterval(now, product.interval);
  let s;
  try {
    s = await one(env, `INSERT INTO dating_subscriptions (user_id, product_id, status, provider, purchase_token, auto_renew, test, current_period_start, current_period_end)
        VALUES ($1,$2,'active',$3,$4,true,$5,$6,$7) RETURNING *`,
    [userId, product.id, purchase.provider, purchase.provider === 'play' ? purchase.provider_ref : null, !!purchase.test, now.toISOString(), end.toISOString()]);
  } catch (e) {
    // dating_subs_live: one live subscription per member. A concurrent activation of the same purchase won the race.
    if (!(e.code === '23505' || /duplicate key|unique/i.test(String(e.message)))) throw e;
    const won = await liveSubscription(env, userId);
    if (won && won.product_id === product.id) return subscriptionShape(won, env);
    throw new ApiError(409, 'ALREADY_SUBSCRIBED', 'You already have a Find Love plan');
  }
  await grantCycleBenefits(env, { sub: s, product, periodStart: now, periodEnd: end, purchaseId: purchase.id });
  return subscriptionShape({ ...s, ...pick(product) }, env);
}
const pick = (p) => ({ title: p.title, tier: p.tier, benefits: p.benefits, interval: p.interval, price_minor: p.price_minor, currency: p.currency, play_product_id: p.play_product_id });

/**
 * Advance a subscription by one paid billing cycle and grant that cycle's benefits. Idempotent: the period only moves
 * if it still starts at `expectStart` (defaults to the current start), and the grant is keyed by the new period start.
 * Called by the cron for test subscriptions, and later by the Play RTDN handler after verification.
 */
export async function renewSubscription(env, subId, { periodEnd = null, purchaseId = null, expectStart = null } = {}) {
  const cur = await one(env, 'SELECT * FROM dating_subscriptions WHERE id = $1', [subId]);
  if (!cur || cur.status !== 'active' || !cur.auto_renew) return { renewed: false };
  const product = await getProduct(env, cur.product_id);
  const start = new Date(cur.current_period_end);
  const end = periodEnd ? new Date(periodEnd) : addInterval(start, product.interval);
  const s = await one(env, `UPDATE dating_subscriptions SET current_period_start = $2, current_period_end = $3, updated_at = now()
      WHERE id = $1 AND current_period_start = $4 RETURNING *`, [subId, start.toISOString(), end.toISOString(), new Date(expectStart || cur.current_period_start).toISOString()]);
  if (!s) return { renewed: false };
  const g = await grantCycleBenefits(env, { sub: s, product, periodStart: start, periodEnd: end, purchaseId });
  return { renewed: true, granted: g.granted, periodStart: iso(start), periodEnd: iso(end) };
}

/** Turn auto-renew off; access stays until current_period_end. Play subscriptions must also be cancelled in Google Play (manageUrl). */
export async function cancelSubscription(env, userId, subId) {
  const s = await one(env, `UPDATE dating_subscriptions SET status = 'cancelled', auto_renew = false, cancelled_at = now(), updated_at = now()
      WHERE id = $1 AND user_id = $2 AND status IN ('active','past_due') RETURNING id`, [subId, userId]);
  if (!s) {
    const any = await one(env, 'SELECT status FROM dating_subscriptions WHERE id = $1 AND user_id = $2', [subId, userId]);
    if (!any) throw notFound('Subscription not found');
    if (any.status === 'cancelled') return mySubscription(env, userId, subId);
    throw bad('This subscription has already ended', 'NOT_ACTIVE');
  }
  return mySubscription(env, userId, subId);
}
async function mySubscription(env, userId, subId) {
  const r = await one(env, `SELECT s.*, p.title, p.tier, p.benefits, p.interval, p.price_minor, p.currency, p.play_product_id FROM dating_subscriptions s
      JOIN wallet_products p ON p.id = s.product_id WHERE s.id = $1 AND s.user_id = $2`, [subId, userId]);
  return subscriptionShape(r, env);
}
export async function listSubscriptions(env, userId) {
  const rows = await q(env, `SELECT s.*, p.title, p.tier, p.benefits, p.interval, p.price_minor, p.currency, p.play_product_id FROM dating_subscriptions s
      JOIN wallet_products p ON p.id = s.product_id WHERE s.user_id = $1 ORDER BY (s.status = ANY($2::text[])) DESC, s.created_at DESC LIMIT 20`, [userId, LIVE]);
  return rows.map((r) => subscriptionShape(r, env));
}

/** For the Find Love stage: { plan: 'free'|'plus'|'vip', tier, flags, badge, subscription }. */
export async function datingEntitlement(env, userId) {
  const live = await liveSubscription(env, userId);
  const shaped = live ? subscriptionShape(live, env) : null;
  if (!shaped || !shaped.hasAccess) return { plan: 'free', tier: 0, flags: {}, badge: null, subscription: shaped };
  const b = shaped.benefits || {};
  return { plan: shaped.tier >= 2 ? 'vip' : 'plus', tier: shaped.tier, flags: b.flags || {}, badge: b.badge || null, subscription: shaped };
}

/** Cron: renew TEST subscriptions whose period ended (simulated billing), expire ended ones. Play renewals arrive via RTDN (later). */
export async function runSubscriptionCron(env, { now = new Date(), limit = 200 } = {}) {
  const due = await q(env, `SELECT id, current_period_start FROM dating_subscriptions WHERE test AND status = 'active' AND auto_renew AND current_period_end <= $1 ORDER BY current_period_end LIMIT $2`, [now.toISOString(), limit]);
  let renewed = 0;
  for (const d of due) {
    // catch up cycle by cycle (a dev server that slept for months)
    for (let i = 0; i < 24; i++) {
      const r = await renewSubscription(env, d.id);
      if (!r.renewed) break;
      renewed++;
      if (new Date(r.periodEnd) > now) break;
    }
  }
  const ended = await q(env, `UPDATE dating_subscriptions SET status = 'expired', ended_at = now(), updated_at = now()
      WHERE (status = 'cancelled' AND current_period_end <= $1) OR (status IN ('active','past_due') AND NOT test AND current_period_end <= $1::timestamptz - interval '3 days')
      RETURNING id`, [now.toISOString()]);
  return { renewed, expired: ended.length };
}

/** The member's live dating subscription (shaped) or null. */
export async function currentSubscription(env, userId) {
  const s = await liveSubscription(env, userId);
  return s ? subscriptionShape(s, env) : null;
}

/** Scheduled every cron tick (index.js): test-subscription renewals + expiry, gift earnings release after the hold. */
export async function runWalletCron(env) {
  const subs = await runSubscriptionCron(env);
  const earnings = await releaseMaturedEarnings(env);
  return { ...subs, ...earnings };
}
