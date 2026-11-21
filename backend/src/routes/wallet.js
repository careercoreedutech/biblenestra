// WALLET CORE — HTTP API (monetisation stage 1). Library + rules: lib/wallet.js; contract: scratch/monetisation/wallet-core.md.
//
// Signed in:
//   GET  /wallet                              balances (cards with purchasable / spendable / giftable / withdrawable flags),
//                                             Kingdom Coins (old engagement coins), current dating subscription
//   GET  /wallet/:wallet/history?cursor=      one wallet's ledger (gift_earnings = pending + available + withdrawn)
//   GET  /wallet/products?wallet=&area=&type=&platform=   active packages / plans + payment methods for the Buy sheet
//   POST /wallet/purchase { productId, provider: 'paystack'|'test', idempotencyKey, email? }
//                                             paystack → 202 { checkout: { reference, url } }: open the url, then poll
//                                             GET /payments/paystack/:reference (routes/paystack.js)
//   GET  /wallet/purchases                    my purchases
//   GET  /wallet/subscriptions                current + past dating subscriptions, plans
//   POST /wallet/subscriptions/:id/cancel     renewal off; access until the period ends
// Admin (/admin/api/wallet/*): overview (+ ledger integrity), entries search by user / ref / wallet / type (kind) / dates
// (+CSV), member view, purchases (+refund, CSV), products editor, config, subscriptions (+CSV), manual adjustment
// (reason required, logged in admin_actions). Tab: lib/walletAdminPage.js (with section hooks for later stages).
import { Hono } from 'hono';
import { q, one } from '../lib/db.js';
import { bad, body, int, isUuid, notFound, str } from '../lib/http.js';
import { audit, requireAdmin, registerAdminScript } from './admin.js';
import { playConfigured, PAYMENTS_SOON } from '../lib/play.js';
import {
  WALLETS, USER_WALLETS, KINDS, PLATFORM, getBalances, history, walletCards, rateLimit, adjust, entryShape, walletInfo, isWallet,
  getConfig, setConfig, CONFIG_DEFAULTS, ledgerIntegrity,
} from '../lib/wallet.js';
import {
  AREAS, listProducts, purchaseMethods, createPurchase, testPurchaseAllowed, purchaseShape, currentSubscription, listSubscriptions,
  subscriptionShape, cancelSubscription, createProduct, updateProduct, refundPurchase, runSubscriptionCron, providerStatus, datingEntitlement,
} from '../lib/walletStore.js';
import { WALLET_ADMIN_SCRIPT } from '../lib/walletAdminPage.js';
import { startWalletCheckout, paystackMethod, inAppEnabled } from '../lib/paystackCheckout.js';
import { paystackConfigured } from '../lib/paystack.js';

registerAdminScript(WALLET_ADMIN_SCRIPT);

const KINGDOM_COINS = {
  id: 'kingdom_coins', label: 'Kingdom Coins', unit: 'coin', purchasable: false, spendable: true, giftable: false, withdrawable: false,
  explain: 'Free reward coins you earn from Bible games, watching ads and contests. Spend them on chat passes and job bids. They are separate from the wallets above and can’t be bought or cashed out.',
  flagsText: 'Earned free · Spend',
};

// ---------------------------------------------------------------------------------------------------------------
// Signed-in API
// ---------------------------------------------------------------------------------------------------------------
export const walletApp = new Hono();

walletApp.get('/wallet', async (c) => {
  const me = c.get('user');
  const [balances, u, sub] = await Promise.all([
    getBalances(c.env, me.id), one(c.env, 'SELECT coins FROM users WHERE id = $1', [me.id]), currentSubscription(c.env, me.id),
  ]);
  const held = await q(c.env, "SELECT wallet, balance FROM wallet_balances WHERE account = $1 AND wallet LIKE 'donations%' AND balance > 0", [me.id]);
  const other = Object.fromEntries(held.map((r) => [r.wallet, Number(r.balance)]));
  const dating = await datingEntitlement(c.env, me.id);
  const cfg = await getConfig(c.env);
  return c.json({
    wallets: walletCards(balances),
    boosts: balances.dating_boosts || 0,
    balances,
    fundmeDonations: other, // ledger E balances when this member is a Fund Me beneficiary (minor units)
    kingdomCoins: { ...KINGDOM_COINS, balance: Number((u && u.coins) || 0) },
    subscription: sub,
    dating: { plan: dating.plan, tier: dating.tier, flags: dating.flags, badge: dating.badge },
    rules: { giftCommissionPct: cfg.gift_commission_bps / 100, earningsHoldDays: cfg.earnings_hold_days, withdrawalsEnabled: !!cfg.earnings_withdrawals_enabled },
    payments: { provider: 'paystack', paystackConfigured: paystackConfigured(c.env), playConfigured: playConfigured(c.env), testPurchases: testPurchaseAllowed(c.env, me), message: paystackConfigured(c.env) ? null : PAYMENTS_SOON },
  });
});

walletApp.get('/wallet/products', async (c) => {
  const me = c.get('user');
  const wallet = c.req.query('wallet') || null;
  const area = c.req.query('area') || null;
  const type = c.req.query('type') || null;
  if (wallet && !(WALLETS[wallet] && WALLETS[wallet].purchasable)) throw bad('wallet must be fundme_credits, dating_coins or gift_coins');
  if (area && !AREAS[area]) throw bad('area must be fundme, dating or gifts');
  if (type && !['pack', 'subscription'].includes(type)) throw bad('type must be pack or subscription');
  const platform = ['android', 'ios', 'web'].includes(c.req.query('platform')) ? c.req.query('platform') : 'android';
  const products = await listProducts(c.env, { wallet, area, type });
  const methods = purchaseMethods(c.env, me, platform, { paystack: paystackMethod(c.env, { inApp: await inAppEnabled(c.env), currency: (products[0] && products[0].currency) || 'NGN' }) });
  const canPay = methods.some((m) => m.available);
  return c.json({ products, methods, canPay, message: canPay ? null : PAYMENTS_SOON });
});

walletApp.post('/wallet/purchase', async (c) => {
  const me = c.get('user');
  await rateLimit(c.env, `wallet_purchase:${me.id}`, 10, 60);
  const b = await body(c);
  if (String(b.provider || '') === 'paystack') {
    const r = await startWalletCheckout(c.env, me, { productId: str(b.productId, { min: 1, max: 61, field: 'productId' }), idempotencyKey: b.idempotencyKey, email: b.email, origin: new URL(c.req.url).origin });
    return c.json(r, r.alreadyProcessed ? 200 : 202);
  }
  const r = await createPurchase(c.env, me, {
    productId: str(b.productId, { min: 1, max: 61, field: 'productId' }),
    provider: String(b.provider || ''),
    idempotencyKey: b.idempotencyKey,
    purchaseToken: b.purchaseToken || null,
  });
  const balances = await getBalances(c.env, me.id);
  return c.json({ ...r, balances }, r.alreadyProcessed ? 200 : 201);
});

walletApp.get('/wallet/purchases', async (c) => {
  const me = c.get('user');
  const rows = await q(c.env, `SELECT p.*, w.title AS product_title FROM wallet_purchases p JOIN wallet_products w ON w.id = p.product_id
      WHERE p.user_id = $1 ORDER BY p.created_at DESC LIMIT 50`, [me.id]);
  return c.json({ items: rows.map((r) => purchaseShape(r)) });
});

walletApp.get('/wallet/subscriptions', async (c) => {
  const me = c.get('user');
  const current = await currentSubscription(c.env, me.id);
  const items = await listSubscriptions(c.env, me.id);
  const plans = await listProducts(c.env, { area: 'dating', type: 'subscription' });
  return c.json({ current, items, plans });
});

walletApp.post('/wallet/subscriptions/:id/cancel', async (c) => {
  const me = c.get('user');
  await rateLimit(c.env, `wallet_cancel:${me.id}`, 10, 60);
  if (!isUuid(c.req.param('id'))) throw notFound('Subscription not found');
  const sub = await cancelSubscription(c.env, me.id, c.req.param('id'));
  return c.json({ subscription: sub, note: sub.provider === 'play' ? 'Also cancel in Google Play › Subscriptions so you are not billed again.' : sub.provider === 'paystack' ? 'Your card won’t be charged again. You keep the plan until it ends.' : null });
});

walletApp.get('/wallet/:wallet/history', async (c) => {
  const me = c.get('user');
  const r = await history(c.env, me.id, { wallet: c.req.param('wallet'), cursor: c.req.query('cursor') || null, limit: Number(c.req.query('limit')) || 30 });
  return c.json(r);
});

// ---------------------------------------------------------------------------------------------------------------
// Admin API
// ---------------------------------------------------------------------------------------------------------------
export const adminWallet = new Hono();
adminWallet.use('/admin/api/wallet/*', requireAdmin);

/** id (uuid) or @handle → users row, or null. 'platform' → { id: 'platform' }. */
async function findUser(env, qs) {
  const s = String(qs || '').trim();
  if (!s) return null;
  if (s.toLowerCase() === PLATFORM) return { id: PLATFORM, display_name: 'BibleNestra (platform)', handle: null, platform: true };
  if (isUuid(s)) return one(env, 'SELECT id, display_name, handle, coins, role FROM users WHERE id = $1', [s]);
  return one(env, 'SELECT id, display_name, handle, coins, role FROM users WHERE lower(handle) = lower($1)', [s.replace(/^@/, '')]);
}
const userOut = (u) => (u ? { id: u.id, displayName: u.display_name, handle: u.handle || null } : null);

function dateParam(v, endOfDay = false) {
  if (!v) return null;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T00:00:00Z`);
    if (endOfDay) d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString();
  }
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw bad('Dates must be YYYY-MM-DD');
  return new Date(t).toISOString();
}

// CSV with spreadsheet-formula protection on text cells
function csv(rows, cols) {
  const cell = (v) => {
    if (v == null) return '';
    let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.map((x) => x[0]).join(','), ...rows.map((r) => cols.map((x) => cell(x[1](r))).join(','))].join('\r\n');
}
function sendCsv(c, name, text) {
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`);
  return c.body(text);
}
const wantCsv = (c) => c.req.query('format') === 'csv';

adminWallet.get('/admin/api/wallet/overview', async (c) => {
  const [walletTotals, purchases, revenue, subs, config, products, integrity] = await Promise.all([
    q(c.env, `SELECT wallet, account = 'platform' AS platform, sum(balance)::text AS total, count(*) FILTER (WHERE balance > 0)::int AS holders
        FROM wallet_balances GROUP BY wallet, account = 'platform' ORDER BY wallet`),
    q(c.env, `SELECT status, count(*)::int AS n FROM wallet_purchases GROUP BY status`),
    q(c.env, `SELECT p.currency, w.area, sum(p.amount_minor)::text AS total, count(*)::int AS n FROM wallet_purchases p JOIN wallet_products w ON w.id = p.product_id
        WHERE p.status = 'verified' AND NOT p.test GROUP BY p.currency, w.area`),
    q(c.env, `SELECT s.product_id, s.status, count(*)::int AS n FROM dating_subscriptions s GROUP BY s.product_id, s.status`),
    getConfig(c.env),
    q(c.env, 'SELECT area, type, count(*) FILTER (WHERE active)::int AS active, count(*)::int AS total FROM wallet_products GROUP BY area, type'),
    ledgerIntegrity(c.env, { limit: 20 }),
  ]);
  const commission = await q(c.env, `SELECT wallet, sum(amount)::text AS total, count(*)::int AS n,
        sum(amount) FILTER (WHERE created_at > now() - interval '30 days')::text AS last30
      FROM wallet_entries WHERE account = 'platform' AND (wallet = 'commission' OR wallet LIKE 'commission\\_%') GROUP BY wallet`);
  return c.json({
    wallets: walletTotals.map((r) => ({ wallet: r.wallet, label: (walletInfo(r.wallet) || {}).label || r.wallet, platform: r.platform, total: Number(r.total || 0), holders: r.holders })),
    purchases: Object.fromEntries(purchases.map((r) => [r.status, r.n])),
    revenue: revenue.map((r) => ({ currency: r.currency, area: r.area, totalMinor: Number(r.total || 0), count: r.n })),
    subscriptions: subs,
    commission: commission.map((r) => ({ wallet: r.wallet, label: (walletInfo(r.wallet) || {}).label || r.wallet, total: Number(r.total || 0), last30: Number(r.last30 || 0), entries: r.n })),
    config, configDefaults: CONFIG_DEFAULTS, products, providers: providerStatus(c.env),
    wallets_registry: Object.fromEntries(USER_WALLETS.concat(walletTotals.map((r) => r.wallet)).map((k) => {
      const v = walletInfo(k) || { label: k };
      return [k, { label: v.label, owner: WALLETS[k] ? 'user' : 'ledger', unit: v.minor ? 'minor' : (v.unit || 'unit'), purchasable: !!v.purchasable }];
    })),
    kinds: KINDS,
    integrity,
    playConfigured: playConfigured(c.env),
  });
});

adminWallet.get('/admin/api/wallet/entries', async (c) => {
  const qs = c.req.query('q');
  let account = null;
  if (qs) {
    const u = await findUser(c.env, qs);
    if (!u) return wantCsv(c) ? sendCsv(c, 'wallet-entries', 'id\r\n') : c.json({ items: [], nextCursor: null, user: null });
    account = u.id;
  }
  const ref = c.req.query('ref') ? String(c.req.query('ref')).trim().slice(0, 200) : null;
  const wallet = c.req.query('wallet') || null;
  const kind = c.req.query('kind') || c.req.query('type') || null; // "type" = the entry kind (spec §16 wording)
  if (wallet && !isWallet(wallet)) throw bad('Unknown wallet');
  const from = dateParam(c.req.query('from'));
  const to = dateParam(c.req.query('to'), true);
  const cursor = /^\d{1,19}$/.test(c.req.query('cursor') || '') ? c.req.query('cursor') : null;
  const limit = wantCsv(c) ? 5000 : 50;
  const like = ref ? `${ref.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
  const rows = await q(c.env, `SELECT e.*, u.display_name, u.handle, cp.display_name AS cp_name, cp.handle AS cp_handle
      FROM wallet_entries e LEFT JOIN users u ON u.id = e.user_id LEFT JOIN users cp ON cp.id = e.counterparty_id
      WHERE ($1::text IS NULL OR e.account = $1) AND ($2::text IS NULL OR e.ref LIKE $3 OR e.related_id = $2)
        AND ($4::text IS NULL OR e.wallet = $4) AND ($5::text IS NULL OR e.kind = $5)
        AND ($6::timestamptz IS NULL OR e.created_at >= $6) AND ($7::timestamptz IS NULL OR e.created_at < $7)
        AND ($8::bigint IS NULL OR e.id < $8::bigint)
      ORDER BY e.id DESC LIMIT $9`, [account, ref, like, wallet, kind, from, to, cursor, limit + 1]);
  const items = rows.slice(0, limit).map((r) => ({ ...entryShape(r), account: r.account, user: r.user_id ? userOut(r) : r.account === PLATFORM ? { id: PLATFORM, displayName: 'BibleNestra (platform)' } : null }));
  if (wantCsv(c)) {
    return sendCsv(c, 'wallet-entries', csv(items, [
      ['id', (r) => r.id], ['created_at', (r) => r.createdAt], ['ref', (r) => r.ref], ['account', (r) => r.account],
      ['user', (r) => (r.user ? r.user.displayName : '')], ['handle', (r) => (r.user && r.user.handle) || ''], ['wallet', (r) => r.wallet],
      ['kind', (r) => r.kind], ['amount', (r) => r.amount], ['balance_after', (r) => r.balanceAfter],
      ['counterparty', (r) => (r.counterparty ? r.counterparty.id : '')], ['related_type', (r) => r.relatedType || ''], ['related_id', (r) => r.relatedId || ''],
      ['meta', (r) => r.meta],
    ]));
  }
  return c.json({ items, nextCursor: rows.length > limit ? items[items.length - 1].id : null });
});

adminWallet.get('/admin/api/wallet/user', async (c) => {
  const u = await findUser(c.env, c.req.query('q'));
  if (!u) throw notFound('No member with that id or handle');
  if (u.platform) {
    const rows = await q(c.env, `SELECT wallet, balance FROM wallet_balances WHERE account = 'platform' ORDER BY wallet`);
    return c.json({ user: { id: PLATFORM, displayName: u.display_name }, platform: true, balances: Object.fromEntries(rows.map((r) => [r.wallet, Number(r.balance)])) });
  }
  const held = await q(c.env, 'SELECT wallet, balance FROM wallet_balances WHERE account = $1 AND NOT (wallet = ANY($2::text[]))', [u.id, USER_WALLETS]);
  const [balances0, subs, purchases] = await Promise.all([
    getBalances(c.env, u.id),
    listSubscriptions(c.env, u.id),
    q(c.env, `SELECT * FROM wallet_purchases WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`, [u.id]),
  ]);
  return c.json({
    user: userOut(u), kingdomCoins: Number(u.coins || 0), balances: { ...balances0, ...Object.fromEntries(held.map((r) => [r.wallet, Number(r.balance)])) },
    subscriptions: subs,
    purchases: purchases.map((p) => purchaseShape(p)),
  });
});

adminWallet.get('/admin/api/wallet/purchases', async (c) => {
  const status = c.req.query('status') || null;
  const provider = c.req.query('provider') || null;
  if (status && !['pending', 'verified', 'failed', 'refunded'].includes(status)) throw bad('Bad status');
  let userId = null;
  if (c.req.query('q')) {
    const u = await findUser(c.env, c.req.query('q'));
    if (!u) return wantCsv(c) ? sendCsv(c, 'wallet-purchases', 'id\r\n') : c.json({ items: [], nextCursor: null });
    userId = u.id;
  }
  const ref = c.req.query('ref') ? String(c.req.query('ref')).trim() : null;
  const from = dateParam(c.req.query('from'));
  const to = dateParam(c.req.query('to'), true);
  const before = c.req.query('before') && !Number.isNaN(Date.parse(c.req.query('before'))) ? new Date(c.req.query('before')).toISOString() : null;
  const limit = wantCsv(c) ? 5000 : 50;
  const rows = await q(c.env, `SELECT p.*, u.display_name, u.handle, w.title, w.area FROM wallet_purchases p
      LEFT JOIN users u ON u.id = p.user_id JOIN wallet_products w ON w.id = p.product_id
      WHERE ($1::text IS NULL OR p.status = $1) AND ($2::text IS NULL OR p.provider = $2) AND ($3::uuid IS NULL OR p.user_id = $3)
        AND ($4::text IS NULL OR p.id::text = $4 OR p.provider_ref = $4 OR p.order_id = $4)
        AND ($5::timestamptz IS NULL OR p.created_at >= $5) AND ($6::timestamptz IS NULL OR p.created_at < $6)
        AND ($7::timestamptz IS NULL OR p.created_at < $7)
      ORDER BY p.created_at DESC LIMIT $8`, [status, provider, userId, ref, from, to, before, limit + 1]);
  const items = rows.slice(0, limit).map((r) => ({ ...purchaseShape(r), title: r.title, area: r.area, user: userOut(r.user_id ? { id: r.user_id, display_name: r.display_name, handle: r.handle } : null), providerRef: r.provider_ref ? `${String(r.provider_ref).slice(0, 12)}…` : null }));
  if (wantCsv(c)) {
    return sendCsv(c, 'wallet-purchases', csv(items, [
      ['id', (r) => r.id], ['created_at', (r) => r.createdAt], ['verified_at', (r) => r.verifiedAt || ''], ['user_id', (r) => (r.user ? r.user.id : '')],
      ['handle', (r) => (r.user && r.user.handle) || ''], ['product', (r) => r.productId], ['area', (r) => r.area], ['provider', (r) => r.provider],
      ['status', (r) => r.status], ['test', (r) => (r.test ? 'yes' : 'no')], ['amount_minor', (r) => r.amountMinor], ['currency', (r) => r.currency],
      ['units', (r) => r.units], ['order_id', (r) => r.orderId || ''], ['error', (r) => r.errorCode || ''],
    ]));
  }
  return c.json({ items, nextCursor: rows.length > limit ? items[items.length - 1].createdAt : null });
});

adminWallet.post('/admin/api/wallet/purchases/:id/refund', async (c) => {
  const me = c.get('user');
  if (!isUuid(c.req.param('id'))) throw notFound();
  const b = await body(c);
  const reason = str(b.reason, { min: 5, max: 500, field: 'reason' });
  const p = await refundPurchase(c.env, { purchaseId: c.req.param('id'), actorId: me.id, reason });
  await audit(c.env, me, 'wallet.purchase_refund', 'wallet_purchase', p.id, { reason, productId: p.productId, units: p.units });
  return c.json({ purchase: p });
});

adminWallet.get('/admin/api/wallet/products', async (c) => {
  return c.json({ items: await listProducts(c.env, { includeInactive: true, area: c.req.query('area') || null, type: c.req.query('type') || null }) });
});
adminWallet.post('/admin/api/wallet/products', async (c) => {
  const me = c.get('user');
  const p = await createProduct(c.env, await body(c));
  await audit(c.env, me, 'wallet.product_create', 'wallet_product', p.id, { priceMinor: p.priceMinor, units: p.units, type: p.type });
  return c.json({ product: p }, 201);
});
adminWallet.patch('/admin/api/wallet/products/:id', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const p = await updateProduct(c.env, c.req.param('id'), b);
  await audit(c.env, me, 'wallet.product_update', 'wallet_product', p.id, { changes: b });
  return c.json({ product: p });
});

adminWallet.get('/admin/api/wallet/config', async (c) => c.json({ config: await getConfig(c.env), defaults: CONFIG_DEFAULTS }));
adminWallet.put('/admin/api/wallet/config', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const key = str(b.key, { min: 2, max: 61, field: 'key' });
  const config = await setConfig(c.env, key, b.value, me.id);
  await audit(c.env, me, 'wallet.config', 'wallet_config', key, { value: b.value });
  return c.json({ key, value: config[key], config });
});

adminWallet.get('/admin/api/wallet/subscriptions', async (c) => {
  await runSubscriptionCron(c.env);
  const status = c.req.query('status') || null;
  if (status && !['active', 'cancelled', 'past_due', 'expired', 'refunded'].includes(status)) throw bad('Bad status');
  const rows = await q(c.env, `SELECT s.*, p.title, p.tier, p.benefits, p.interval, p.price_minor, p.currency, p.play_product_id, u.display_name, u.handle FROM dating_subscriptions s
      JOIN wallet_products p ON p.id = s.product_id LEFT JOIN users u ON u.id = s.user_id
      WHERE ($1::text IS NULL OR s.status = $1) ORDER BY s.created_at DESC LIMIT $2`, [status, wantCsv(c) ? 5000 : 100]);
  const items = rows.map((s) => ({ ...subscriptionShape(s, c.env), user: userOut(s.user_id ? { id: s.user_id, display_name: s.display_name, handle: s.handle } : null) }));
  if (wantCsv(c)) {
    return sendCsv(c, 'dating-subscriptions', csv(items, [
      ['id', (r) => r.id], ['user_id', (r) => (r.user ? r.user.id : '')], ['handle', (r) => (r.user && r.user.handle) || ''], ['plan', (r) => r.productId],
      ['status', (r) => r.status], ['provider', (r) => r.provider], ['test', (r) => (r.test ? 'yes' : 'no')], ['auto_renew', (r) => (r.autoRenew ? 'yes' : 'no')],
      ['period_start', (r) => r.currentPeriodStart], ['period_end', (r) => r.currentPeriodEnd], ['cancelled_at', (r) => r.cancelledAt || ''],
    ]));
  }
  return c.json({ items });
});

adminWallet.post('/admin/api/wallet/adjust', async (c) => {
  const me = c.get('user');
  await rateLimit(c.env, `wallet_adjust:${me.id}`, 30, 60);
  const b = await body(c);
  const u = await findUser(c.env, b.userId || b.q);
  if (!u || u.platform) throw notFound('No member with that id or handle');
  const wallet = String(b.wallet || '');
  if (!USER_WALLETS.includes(wallet)) throw bad('Choose one of the member wallets');
  const amount = int(b.amount, { min: -1e9, max: 1e9, field: 'amount' });
  if (amount === 0) throw bad('amount must not be 0');
  const reason = str(b.reason, { min: 5, max: 500, field: 'reason' });
  const key = str(b.idempotencyKey, { min: 8, max: 100, field: 'idempotencyKey' });
  if (!/^[A-Za-z0-9_\-.]+$/.test(key)) throw bad('Bad idempotencyKey');
  const r = await adjust(c.env, { adminId: me.id, userId: u.id, wallet, amount, reason, ref: `admin_adjust:${key}` });
  if (r.applied) await audit(c.env, me, 'wallet.adjust', 'user', u.id, { wallet, amount, reason, ref: r.ref });
  return c.json({ ...r, user: userOut(u) }, r.applied ? 201 : 200);
});

export default walletApp;
