// WALLET CORE (monetisation stage 1): separate balances, idempotent posts, no negative balances, atomic multi-leg
// operations, the 20/80 gift split, products (admin only), purchase providers (test gating, Play not configured,
// duplicate Play tokens), Dating Plus / VIP cycle benefits once per period, history pagination, admin search + CSV.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { q, one } from '../src/lib/db.js';
import * as W from '../src/lib/wallet.js';
import { runSubscriptionCron, renewSubscription, grantCycleBenefits, getProduct } from '../src/lib/walletStore.js';
import { WALLET_ADMIN_SCRIPT } from '../src/lib/walletAdminPage.js';
import { verifyPaystackSignature, paystackConfigured } from '../src/lib/paystack.js';
import * as Play from '../src/lib/play.js';
import * as Memberships from '../src/lib/memberships.js';

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', WALLET_TEST_PURCHASES: 'true', WALLET_TESTERS: 'tess' };
});
async function call(user, method, path, body, e = env) {
  const h = {};
  if (user) h['X-Dev-User'] = user;
  let b;
  if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${path}`, { method, headers: h, body: b }), e);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (err) { json = text; }
  return { status: res.status, json, headers: res.headers };
}
const ids = {};
let n = 0;
const key = () => `test_key_${Date.now()}_${++n}`;
const bal = (u, w) => W.getBalance(env, ids[u], w);

test('setup: boss is an admin, tess a tester, amy / bob / cal members', async () => {
  for (const u of ['boss', 'tess', 'amy', 'bob', 'cal']) ids[u] = (await call(u, 'GET', '/me')).json.id;
  await q(env, `UPDATE users SET role = 'admin' WHERE id = $1`, [ids.boss]);
  await q(env, `UPDATE users SET handle = 'amy_h' WHERE id = $1`, [ids.amy]);
  assert.ok(!WALLET_ADMIN_SCRIPT.includes('`') && !WALLET_ADMIN_SCRIPT.includes('${'), 'admin script must be a plain string');
});

test('balances are separate per wallet; old Kingdom Coins untouched', async () => {
  const before = (await one(env, 'SELECT coins FROM users WHERE id = $1', [ids.amy])).coins;
  await W.credit(env, { ref: 'seed:amy:dating', userId: ids.amy, wallet: 'dating_coins', amount: 500, kind: 'admin_adjust' });
  await W.credit(env, { ref: 'seed:amy:gift', userId: ids.amy, wallet: 'gift_coins', amount: 3000, kind: 'admin_adjust' });
  const b = await W.getBalances(env, ids.amy);
  assert.equal(b.dating_coins, 500); assert.equal(b.gift_coins, 3000); assert.equal(b.fundme_credits, 0); assert.equal(b.gift_earnings, 0);
  const r = await call('amy', 'GET', '/wallet');
  assert.equal(r.status, 200);
  const card = (w) => r.json.wallets.find((x) => x.wallet === w);
  assert.equal(card('dating_coins').balance, 500);
  assert.equal(card('fundme_credits').giftable, true);
  assert.equal(card('gift_coins').withdrawable, false);
  assert.equal(card('gift_earnings_available').withdrawable, true);
  assert.equal(card('gift_coins').purchasable, true);
  assert.equal(r.json.kingdomCoins.balance, before);
  assert.equal((await one(env, 'SELECT coins FROM users WHERE id = $1', [ids.amy])).coins, before);
  // spending one wallet cannot touch another
  await assert.rejects(W.spend(env, { ref: 'x:fundme1', userId: ids.amy, wallet: 'fundme_credits', amount: 1, kind: 'fundme_publish' }), (e) => e.code === 'INSUFFICIENT_BALANCE');
});

test('idempotent post: the same ref twice has one effect', async () => {
  const a = await W.credit(env, { ref: 'idem:bob:1', userId: ids.bob, wallet: 'fundme_credits', amount: 7, kind: 'purchase' });
  const b = await W.credit(env, { ref: 'idem:bob:1', userId: ids.bob, wallet: 'fundme_credits', amount: 7, kind: 'purchase' });
  assert.equal(a.applied, true); assert.equal(b.applied, false); assert.equal(b.duplicate, true);
  assert.equal(b.entries.length, 1);
  assert.equal(await bal('bob', 'fundme_credits'), 7);
  await assert.rejects(W.spend(env, { ref: 'idem:bob:1', userId: ids.bob, wallet: 'fundme_credits', amount: 1, kind: 'fundme_publish' }), (e) => e.code === 'REF_CONFLICT');
  // concurrent duplicates still apply once
  await Promise.all([1, 2, 3].map(() => W.credit(env, { ref: 'idem:bob:2', userId: ids.bob, wallet: 'fundme_credits', amount: 3, kind: 'purchase' })));
  assert.equal(await bal('bob', 'fundme_credits'), 10);
});

test('balances never go negative: concurrent double spend, SQL check, error details', async () => {
  // bob has 10 credits; five concurrent spends of 3 → only three can succeed
  const r = await Promise.allSettled([1, 2, 3, 4, 5].map((i) => W.spend(env, { ref: `dbl:bob:${i}`, userId: ids.bob, wallet: 'fundme_credits', amount: 3, kind: 'fundme_publish' })));
  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 3);
  const fail = r.find((x) => x.status === 'rejected').reason;
  assert.equal(fail.code, 'INSUFFICIENT_BALANCE'); assert.equal(fail.status, 402);
  assert.equal(await bal('bob', 'fundme_credits'), 1);
  try { await W.spend(env, { ref: 'dbl:bob:big', userId: ids.bob, wallet: 'fundme_credits', amount: 5, kind: 'fundme_publish' }); assert.fail('should throw'); }
  catch (e) { assert.deepEqual({ ...e.details, account: undefined }, { wallet: 'fundme_credits', account: undefined, balance: 1, needed: 5, shortBy: 4 }); }
  // the database itself refuses a negative balance, whatever the JS does
  await assert.rejects(q(env, `UPDATE wallet_balances SET balance = -1 WHERE account = $1 AND wallet = 'fundme_credits'`, [ids.bob]));
  // and the ledger is append-only
  await assert.rejects(q(env, 'UPDATE wallet_entries SET amount = 999 WHERE ref = $1', ['idem:bob:1']));
  await assert.rejects(q(env, 'DELETE FROM wallet_entries WHERE ref = $1', ['idem:bob:1']));
});

test('atomic multi-leg: a failing leg leaves nothing behind', async () => {
  const beforeAmy = await W.getBalances(env, ids.amy);
  await assert.rejects(W.post(env, { ref: 'atomic:1', kind: 'gift_sent', legs: [
    { userId: ids.amy, wallet: 'dating_coins', amount: -100 },          // fine on its own
    { userId: ids.cal, wallet: 'gift_earnings', amount: 100 },          // fine on its own
    { userId: ids.amy, wallet: 'fundme_credits', amount: -1 },          // amy has 0 → whole op fails
  ] }), (e) => e.code === 'INSUFFICIENT_BALANCE' && e.details.wallet === 'fundme_credits');
  assert.deepEqual(await W.getBalances(env, ids.amy), beforeAmy);
  assert.equal(await bal('cal', 'gift_earnings'), 0);
  assert.equal(await one(env, `SELECT 1 FROM wallet_ops WHERE ref = 'atomic:1'`), null);
  assert.equal((await q(env, `SELECT 1 FROM wallet_entries WHERE ref = 'atomic:1'`)).length, 0);
  // bad input is rejected before touching the database
  await assert.rejects(W.post(env, { ref: 'atomic:2', kind: 'x_y', legs: [{ userId: ids.amy, wallet: 'nope', amount: 1 }] }), (e) => e.code === 'BAD_WALLET');
  await assert.rejects(W.post(env, { ref: 'atomic:3', kind: 'x_y', legs: [{ userId: ids.amy, wallet: 'gift_coins', amount: 1.5 }] }), (e) => e.code === 'BAD_AMOUNT');
  await assert.rejects(W.post(env, { ref: 'atomic:4', kind: 'x_y', legs: [{ userId: ids.amy, wallet: 'commission_gift_coins', amount: 1 }] }), (e) => e.code === 'BAD_LEG');
});

test('gift 2,000 coins → sender −2,000, commission +400, recipient earnings +1,600 (3-leg post)', async () => {
  assert.deepEqual(W.splitGift(2000, 2000), { coins: 2000, commission: 400, earnings: 1600 });
  assert.deepEqual(W.splitGift(5, 2000), { coins: 5, commission: 1, earnings: 4 });
  const commission0 = Number((await one(env, `SELECT balance FROM wallet_balances WHERE account = 'platform' AND wallet = 'commission_gift_coins'`) || { balance: 0 }).balance);
  const r = await W.postGift(env, { ref: 'gift:test:1', senderId: ids.amy, recipientId: ids.cal, coins: 2000, giftId: 'crown' });
  assert.equal(r.applied, true);
  assert.deepEqual(r.split, { coins: 2000, commission: 400, earnings: 1600, bps: 2000 });
  assert.equal(r.entries.length, 3);
  assert.equal(await bal('amy', 'gift_coins'), 1000);
  assert.equal(await bal('cal', 'gift_earnings'), 1600);
  const com = await one(env, `SELECT balance FROM wallet_balances WHERE account = 'platform' AND wallet = 'commission_gift_coins'`);
  assert.equal(Number(com.balance) - commission0, 400);
  // replay = no effect; self-gift refused; not enough coins refused atomically
  assert.equal((await W.postGift(env, { ref: 'gift:test:1', senderId: ids.amy, recipientId: ids.cal, coins: 2000 })).applied, false);
  await assert.rejects(W.postGift(env, { ref: 'gift:test:2', senderId: ids.amy, recipientId: ids.amy, coins: 10 }), (e) => e.code === 'SELF_TRANSFER');
  await assert.rejects(W.postGift(env, { ref: 'gift:test:3', senderId: ids.amy, recipientId: ids.cal, coins: 2000 }), (e) => e.code === 'INSUFFICIENT_BALANCE');
  assert.equal(await bal('cal', 'gift_earnings'), 1600);
  // earnings release after the hold moves pending → available, once
  const future = new Date(Date.now() + 8 * 86400000);
  assert.equal((await W.releaseMaturedEarnings(env, { now: future })).released, 1);
  assert.equal((await W.releaseMaturedEarnings(env, { now: future })).released, 0);
  assert.equal(await bal('cal', 'gift_earnings'), 0);
  assert.equal(await bal('cal', 'gift_earnings_available'), 1600);
});

test('Fund Me credits can be gifted (not to self); donations ledger E helpers', async () => {
  await W.credit(env, { ref: 'seed:cal:fm', userId: ids.cal, wallet: 'fundme_credits', amount: 15, kind: 'purchase' });
  const t = await W.transfer(env, { ref: 'fmgift:1', fromId: ids.cal, toId: ids.amy, wallet: 'fundme_credits', amount: 5, kindOut: 'fundme_credit_gift_sent', kindIn: 'fundme_credit_gift_received' });
  assert.equal(t.applied, true);
  assert.equal(await bal('cal', 'fundme_credits'), 10); assert.equal(await bal('amy', 'fundme_credits'), 5);
  await assert.rejects(W.transfer(env, { ref: 'fmgift:2', fromId: ids.cal, toId: ids.cal, wallet: 'fundme_credits', amount: 1, kindOut: 'a_b', kindIn: 'a_c' }), (e) => e.code === 'SELF_TRANSFER');
  await assert.rejects(W.transfer(env, { ref: 'fmgift:3', fromId: ids.cal, toId: ids.amy, wallet: 'dating_coins', amount: 1, kindOut: 'a_b', kindIn: 'a_c' }), (e) => e.code === 'NOT_GIFTABLE');
  const d = '00000000-0000-4000-8000-000000000001';
  await W.recordDonationReceived(env, { donationId: d, beneficiaryId: ids.cal, fundraiserId: null, amountMinor: 100000, feeMinor: 5000, currency: 'NGN' });
  assert.equal(await bal('cal', 'donations_held_ngn'), 95000);
  await assert.rejects(W.recordPayoutPaid(env, { payoutId: 'p1x', beneficiaryId: ids.cal, amountMinor: 96000, currency: 'NGN' }), (e) => e.code === 'INSUFFICIENT_BALANCE');
  await W.recordPayoutPaid(env, { payoutId: 'p2x', beneficiaryId: ids.cal, amountMinor: 95000, currency: 'NGN' });
  assert.equal(await bal('cal', 'donations_held_ngn'), 0); assert.equal(await bal('cal', 'donations_paid_ngn'), 95000);
  // the member-facing wallet never lists ledger E as spendable money
  const r = await call('cal', 'GET', '/wallet');
  assert.ok(!r.json.wallets.some((w) => w.wallet.startsWith('donations_')));
});

test('products: seeded client prices; CRUD is admin-only', async () => {
  const r = await call('amy', 'GET', '/wallet/products?wallet=dating_coins');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.products.map((p) => [p.units, p.priceMinor]), [[100, 35000], [250, 70000], [500, 130000], [1000, 250000], [2500, 500000], [5000, 900000], [10000, 1500000]]);
  assert.equal(r.json.products[0].displayPrice, '₦350');
  const fm = await call('amy', 'GET', '/wallet/products?wallet=fundme_credits');
  assert.deepEqual(fm.json.products.map((p) => p.units), [7, 15, 30, 50, 100, 200]);
  const subs = await call('amy', 'GET', '/wallet/products?area=dating&type=subscription');
  assert.deepEqual(subs.json.products.map((p) => [p.id, p.priceMinor]), [['dating_plus_monthly', 150000], ['dating_vip_monthly', 350000]]);
  assert.deepEqual(subs.json.products[1].benefits.perCycle, [{ wallet: 'dating_coins', amount: 300 }, { wallet: 'dating_boosts', amount: 2 }]);

  assert.equal((await call('amy', 'POST', '/admin/api/wallet/products', { id: 'dating_coins_750', type: 'pack', area: 'dating', wallet: 'dating_coins', title: '750', units: 750, priceMinor: 200000 })).status, 403);
  const c = await call('boss', 'POST', '/admin/api/wallet/products', { id: 'dating_coins_750', type: 'pack', area: 'dating', wallet: 'dating_coins', title: '750 Dating Coins', units: 750, bonusUnits: 50, priceMinor: 200000, playProductId: 'bn_dating_coins_750' });
  assert.equal(c.status, 201); assert.equal(c.json.product.totalUnits, 800);
  assert.equal((await call('boss', 'POST', '/admin/api/wallet/products', { id: 'dating_coins_750', type: 'pack', area: 'dating', wallet: 'dating_coins', title: 'dup', units: 1, priceMinor: 1 })).json.code, 'PRODUCT_EXISTS');
  assert.equal((await call('boss', 'POST', '/admin/api/wallet/products', { id: 'bad_pack', type: 'pack', area: 'dating', wallet: 'gift_earnings', title: 'x', units: 1, priceMinor: 1 })).json.code, 'BAD_PRODUCT');
  const u = await call('boss', 'PATCH', '/admin/api/wallet/products/dating_coins_750', { priceMinor: 210000, active: false });
  assert.equal(u.status, 200); assert.equal(u.json.product.active, false);
  assert.ok(!(await call('amy', 'GET', '/wallet/products?wallet=dating_coins')).json.products.some((p) => p.id === 'dating_coins_750'));
  const v = await call('boss', 'PATCH', '/admin/api/wallet/products/dating_vip_monthly', { benefits: { badge: 'VIP', features: ['All Plus'], flags: { vipBadge: true }, perCycle: [{ wallet: 'dating_coins', amount: 300 }, { wallet: 'dating_boosts', amount: 2 }] } });
  assert.equal(v.status, 200);
  assert.ok(await one(env, `SELECT 1 FROM admin_actions WHERE action = 'wallet.product_update' AND target_id = 'dating_coins_750'`));
  // conversion rate is config, not code
  assert.equal((await call('amy', 'PUT', '/admin/api/wallet/config', { key: 'gift_coin_rate', value: { coins: 2, perMinor: 100, currency: 'NGN' } })).status, 403);
  const cfg = await call('boss', 'PUT', '/admin/api/wallet/config', { key: 'gift_coin_rate', value: { coins: 2, perMinor: 100, currency: 'NGN' } });
  assert.equal(cfg.status, 200); assert.deepEqual(cfg.json.value, { coins: 2, perMinor: 100, currency: 'NGN' });
  assert.equal((await call('boss', 'PUT', '/admin/api/wallet/config', { key: 'gift_commission_bps', value: 99999 })).json.code, 'BAD_CONFIG');
});

test('test purchases: only when enabled AND admin / tester; credits once per idempotency key', async () => {
  const body = { productId: 'gift_coins_500', provider: 'test', idempotencyKey: 'k_amy_test_1' };
  assert.equal((await call('amy', 'POST', '/wallet/purchase', body)).json.code, 'TEST_PURCHASES_DISABLED');
  const offEnv = { ...env, WALLET_TEST_PURCHASES: '' };
  assert.equal((await call('boss', 'POST', '/wallet/purchase', { ...body, idempotencyKey: 'k_boss_off_1' }, offEnv)).json.code, 'TEST_PURCHASES_DISABLED');
  const t1 = await call('tess', 'POST', '/wallet/purchase', { ...body, idempotencyKey: 'k_tess_test_1' });
  assert.equal(t1.status, 201); assert.equal(t1.json.purchase.status, 'verified'); assert.equal(t1.json.purchase.test, true);
  assert.equal(t1.json.balances.gift_coins, 500);
  const t2 = await call('tess', 'POST', '/wallet/purchase', { ...body, idempotencyKey: 'k_tess_test_1' });
  assert.equal(t2.status, 200); assert.equal(t2.json.alreadyProcessed, true);
  assert.equal(await bal('tess', 'gift_coins'), 500);
  assert.equal((await call('tess', 'POST', '/wallet/purchase', { productId: 'dating_coins_100', provider: 'test', idempotencyKey: 'k_tess_test_1' })).json.code, 'IDEMPOTENCY_CONFLICT');
  const admin = await call('boss', 'POST', '/wallet/purchase', { productId: 'fundme_credits_7', provider: 'test', idempotencyKey: 'k_boss_test_1' });
  assert.equal(admin.status, 201); assert.equal(admin.json.balances.fundme_credits, 7);
  // Paystack is never used for digital goods
  assert.equal((await call('tess', 'POST', '/wallet/purchase', { ...body, provider: 'paystack', idempotencyKey: 'k_tess_ps_1' })).json.code, 'PROVIDER_NOT_ALLOWED');
  const m = await call('amy', 'GET', '/wallet/products?wallet=gift_coins&platform=android');
  assert.deepEqual(m.json.methods.map((x) => [x.provider, x.available]), [['play', false]]);
  assert.equal(m.json.canPay, false);
  const mt = await call('tess', 'GET', '/wallet/products?wallet=gift_coins');
  assert.equal(mt.json.methods[0].provider, 'test');
});

test('Google Play: not configured → PAYMENTS_NOT_CONFIGURED and nothing credited', async () => {
  const r = await call('amy', 'POST', '/wallet/purchase', { productId: 'dating_coins_100', provider: 'play', idempotencyKey: 'k_amy_play_1', purchaseToken: 'tok_not_configured_123' });
  assert.equal(r.status, 503); assert.equal(r.json.code, 'PAYMENTS_NOT_CONFIGURED');
  assert.equal(await bal('amy', 'dating_coins'), 500);
  const p = await one(env, `SELECT status, error_code FROM wallet_purchases WHERE idempotency_key = 'k_amy_play_1'`);
  assert.deepEqual(p, { status: 'failed', error_code: 'PAYMENTS_NOT_CONFIGURED' });
  assert.equal((await call('amy', 'POST', '/wallet/purchase', { productId: 'dating_coins_100', provider: 'play', idempotencyKey: 'k_amy_play_2' })).json.code, 'BAD_PURCHASE');
});

test('Google Play (verifier injected): credits once; a token can never be reused', async () => {
  const calls = [];
  const playEnv = { ...env, __playVerifier: async (e, { productId, purchaseToken }) => { calls.push(purchaseToken); return { productId, purchaseToken, orderId: `GPA.${purchaseToken}`, raw: { purchaseState: 0 } }; } };
  const body = { productId: 'dating_coins_250', provider: 'play', idempotencyKey: 'k_bob_play_1', purchaseToken: 'tok_bob_250_abcdef' };
  const a = await call('bob', 'POST', '/wallet/purchase', body, playEnv);
  assert.equal(a.status, 201); assert.equal(a.json.purchase.status, 'verified'); assert.equal(a.json.purchase.orderId, 'GPA.tok_bob_250_abcdef');
  assert.equal(await bal('bob', 'dating_coins'), 250);
  // Play redelivers the same token (new key from the app) → same purchase, no double credit
  const b = await call('bob', 'POST', '/wallet/purchase', { ...body, idempotencyKey: 'k_bob_play_2' }, playEnv);
  assert.equal(b.status, 200); assert.equal(b.json.alreadyProcessed, true);
  assert.equal(await bal('bob', 'dating_coins'), 250);
  // someone else presenting the same token is refused
  const c = await call('cal', 'POST', '/wallet/purchase', { ...body, idempotencyKey: 'k_cal_play_1' }, playEnv);
  assert.equal(c.status, 409); assert.equal(c.json.code, 'DUPLICATE_PURCHASE_TOKEN');
  assert.equal(await bal('cal', 'dating_coins'), 0);
  // the store must confirm the right product
  const wrongEnv = { ...env, __playVerifier: async (e, { purchaseToken }) => ({ productId: 'bn_something_else', purchaseToken }) };
  const w = await call('cal', 'POST', '/wallet/purchase', { productId: 'dating_coins_100', provider: 'play', idempotencyKey: 'k_cal_play_2', purchaseToken: 'tok_cal_wrong_product' }, wrongEnv);
  assert.equal(w.json.code, 'PURCHASE_NOT_VERIFIED');
  assert.equal(await bal('cal', 'dating_coins'), 0);
  // refund takes the units back (admin, logged)
  const pid = a.json.purchase.id;
  const rf = await call('boss', 'POST', `/admin/api/wallet/purchases/${pid}/refund`, { reason: 'Chargeback from Google' });
  assert.equal(rf.status, 200); assert.equal(rf.json.purchase.status, 'refunded');
  assert.equal(await bal('bob', 'dating_coins'), 0);
});

test('Dating VIP: benefits granted once per billing cycle; cancel keeps access to period end', async () => {
  const s = await call('tess', 'POST', '/wallet/purchase', { productId: 'dating_vip_monthly', provider: 'test', idempotencyKey: 'k_tess_vip_1' });
  assert.equal(s.status, 201);
  const sub = s.json.subscription;
  assert.equal(sub.status, 'active'); assert.equal(sub.tier, 2); assert.ok(sub.renewsOn);
  assert.equal(await bal('tess', 'dating_coins'), 300); assert.equal(await bal('tess', 'dating_boosts'), 2);
  assert.equal((await call('tess', 'POST', '/wallet/purchase', { productId: 'dating_vip_monthly', provider: 'test', idempotencyKey: 'k_tess_vip_2' })).json.code, 'ALREADY_SUBSCRIBED');
  // re-granting the same period does nothing
  const row = await one(env, 'SELECT * FROM dating_subscriptions WHERE id = $1', [sub.id]);
  const product = await getProduct(env, 'dating_vip_monthly');
  const g = await grantCycleBenefits(env, { sub: row, product, periodStart: row.current_period_start, periodEnd: row.current_period_end });
  assert.equal(g.granted, false);
  assert.equal(await bal('tess', 'dating_coins'), 300);
  // next cycle (cron simulates billing for test subs) → one more grant, even if the cron runs twice
  const later = new Date(new Date(row.current_period_end).getTime() + 3600000);
  const c1 = await runSubscriptionCron(env, { now: later });
  const c2 = await runSubscriptionCron(env, { now: later });
  assert.equal(c1.renewed, 1); assert.equal(c2.renewed, 0);
  assert.equal(await bal('tess', 'dating_coins'), 600); assert.equal(await bal('tess', 'dating_boosts'), 4);
  assert.equal((await renewSubscription(env, sub.id, { expectStart: row.current_period_start })).renewed, false); // stale renewal ignored
  assert.equal((await q(env, 'SELECT 1 FROM dating_subscription_periods WHERE subscription_id = $1', [sub.id])).length, 2);
  // entitlement + cancel
  const w = await call('tess', 'GET', '/wallet');
  assert.equal(w.json.dating.plan, 'vip'); assert.equal(w.json.dating.badge, 'VIP');
  assert.equal((await call('amy', 'POST', `/wallet/subscriptions/${sub.id}/cancel`)).status, 404);
  const cx = await call('tess', 'POST', `/wallet/subscriptions/${sub.id}/cancel`);
  assert.equal(cx.status, 200); assert.equal(cx.json.subscription.status, 'cancelled'); assert.equal(cx.json.subscription.autoRenew, false);
  assert.equal(cx.json.subscription.hasAccess, true); assert.equal(cx.json.subscription.renewsOn, null);
  const list = await call('tess', 'GET', '/wallet/subscriptions');
  assert.equal(list.json.current.id, sub.id); assert.equal(list.json.plans.length, 2);
  // a cancelled sub is not renewed; it expires at period end
  const end = await one(env, 'SELECT current_period_end FROM dating_subscriptions WHERE id = $1', [sub.id]);
  const c3 = await runSubscriptionCron(env, { now: new Date(new Date(end.current_period_end).getTime() + 1000) });
  assert.equal(c3.renewed, 0); assert.equal(c3.expired, 1);
  assert.equal(await bal('tess', 'dating_coins'), 600);
  assert.equal((await call('tess', 'GET', '/wallet')).json.dating.plan, 'free');
});

test('history: per wallet, newest first, cursor pagination', async () => {
  for (let i = 1; i <= 7; i++) await W.credit(env, { ref: `hist:cal:${i}`, userId: ids.cal, wallet: 'dating_coins', amount: i, kind: 'purchase' });
  const p1 = await call('cal', 'GET', '/wallet/dating_coins/history?limit=3');
  assert.equal(p1.status, 200);
  assert.deepEqual(p1.json.items.map((x) => x.amount), [7, 6, 5]);
  assert.equal(p1.json.items[0].label, 'Bought');
  assert.ok(p1.json.nextCursor);
  const p2 = await call('cal', 'GET', `/wallet/dating_coins/history?limit=3&cursor=${p1.json.nextCursor}`);
  assert.deepEqual(p2.json.items.map((x) => x.amount), [4, 3, 2]);
  const p3 = await call('cal', 'GET', `/wallet/dating_coins/history?limit=3&cursor=${p2.json.nextCursor}`);
  assert.deepEqual(p3.json.items.map((x) => x.amount), [1]); assert.equal(p3.json.nextCursor, null);
  const g = await call('cal', 'GET', '/wallet/gift_earnings/history');
  assert.ok(g.json.items.some((x) => x.kind === 'gift_received' && x.amount === 1600 && x.counterparty.id === ids.amy));
  assert.equal((await call('cal', 'GET', '/wallet/nope/history')).json.code, 'BAD_WALLET');
});

test('admin: search by user / ref / kind / dates, member view, adjustment with reason, CSV, overview', async () => {
  assert.equal((await call('amy', 'GET', '/admin/api/wallet/entries')).status, 403);
  const byHandle = await call('boss', 'GET', '/admin/api/wallet/entries?q=@amy_h&wallet=gift_coins');
  assert.equal(byHandle.status, 200);
  assert.ok(byHandle.json.items.length >= 2 && byHandle.json.items.every((x) => x.account === ids.amy && x.wallet === 'gift_coins'));
  const byRef = await call('boss', 'GET', '/admin/api/wallet/entries?ref=gift:test:1');
  assert.equal(byRef.json.items.length, 3);
  const byKind = await call('boss', 'GET', '/admin/api/wallet/entries?kind=gift_commission');
  assert.ok(byKind.json.items.every((x) => x.kind === 'gift_commission' && x.account === 'platform'));
  const today = new Date().toISOString().slice(0, 10);
  assert.ok((await call('boss', 'GET', `/admin/api/wallet/entries?from=${today}&to=${today}`)).json.items.length > 0);
  assert.equal((await call('boss', 'GET', '/admin/api/wallet/entries?from=2001-01-01&to=2001-01-02')).json.items.length, 0);

  const mv = await call('boss', 'GET', `/admin/api/wallet/user?q=${ids.cal}`);
  assert.equal(mv.status, 200); assert.equal(mv.json.balances.donations_paid_ngn, 95000);
  const noReason = await call('boss', 'POST', '/admin/api/wallet/adjust', { userId: ids.cal, wallet: 'gift_coins', amount: 50, reason: '', idempotencyKey: 'adm_key_0001' });
  assert.equal(noReason.status, 400);
  const adj = await call('boss', 'POST', '/admin/api/wallet/adjust', { userId: ids.cal, wallet: 'gift_coins', amount: 50, reason: 'Goodwill credit for outage', idempotencyKey: 'adm_key_0002' });
  assert.equal(adj.status, 201);
  const again = await call('boss', 'POST', '/admin/api/wallet/adjust', { userId: ids.cal, wallet: 'gift_coins', amount: 50, reason: 'Goodwill credit for outage', idempotencyKey: 'adm_key_0002' });
  assert.equal(again.status, 200); assert.equal(again.json.applied, false);
  assert.equal(await bal('cal', 'gift_coins'), 50);
  assert.equal((await call('boss', 'POST', '/admin/api/wallet/adjust', { userId: ids.cal, wallet: 'gift_coins', amount: -51, reason: 'Too much taken', idempotencyKey: 'adm_key_0003' })).json.code, 'INSUFFICIENT_BALANCE');
  const log = await one(env, `SELECT details FROM admin_actions WHERE action = 'wallet.adjust' AND target_id = $1`, [ids.cal]);
  assert.equal(log.details.reason, 'Goodwill credit for outage');

  const pf = await call('boss', 'GET', '/admin/api/wallet/purchases?status=failed');
  assert.ok(pf.json.items.length >= 1 && pf.json.items.every((p) => p.status === 'failed'));
  const csv = await call('boss', 'GET', '/admin/api/wallet/entries?kind=gift_sent&format=csv');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.json, /^id,created_at,ref/);
  assert.match(csv.json, /gift:test:1/);
  const ov = await call('boss', 'GET', '/admin/api/wallet/overview');
  assert.equal(ov.status, 200);
  assert.ok(ov.json.commission.some((c) => c.wallet === 'commission_gift_coins' && c.total >= 400));
  assert.equal(ov.json.providers.paystack.forDigitalGoods, false);
  assert.ok((await call('boss', 'GET', '/admin/api/wallet/subscriptions?status=expired')).json.items.length >= 1);
});

test('rate limit on purchases; Paystack slot off when unset; signature check', async () => {
  let last;
  for (let i = 0; i < 12; i++) last = await call('amy', 'POST', '/wallet/purchase', { productId: 'gift_coins_500', provider: 'test', idempotencyKey: `k_amy_rl_${i}_xx` });
  assert.equal(last.status, 429); assert.equal(last.json.code, 'RATE_LIMITED');
  assert.equal(paystackConfigured({}), false);
  assert.equal(paystackConfigured({ PAYSTACK_SECRET_KEY: 'sk_test_x' }), true);
  const crypto = await import('node:crypto');
  const raw = '{"event":"charge.success"}';
  const sig = crypto.createHmac('sha512', 'sk_test_x').update(raw).digest('hex');
  assert.equal(await verifyPaystackSignature(raw, sig, 'sk_test_x'), true);
  assert.equal(await verifyPaystackSignature(raw, sig, 'sk_test_y'), false);
});

test('concurrency: parallel gifts that only one balance can cover → exactly one succeeds, all legs consistent', async () => {
  const dan = (await call('dan', 'GET', '/me')).json.id; ids.dan = dan;
  const eve = (await call('eve', 'GET', '/me')).json.id; ids.eve = eve;
  await W.credit(env, { ref: 'seed:dan:gift', userId: dan, wallet: 'gift_coins', amount: 1500, kind: 'admin_adjust' });
  const com0 = Number((await one(env, `SELECT balance FROM wallet_balances WHERE account = 'platform' AND wallet = 'commission_gift_coins'`)).balance);
  const r = await Promise.allSettled([1, 2, 3, 4, 5, 6].map((i) => W.postGift(env, { ref: `gift:race:${i}`, senderId: dan, recipientId: eve, coins: 1000 })));
  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
  assert.ok(r.filter((x) => x.status === 'rejected').every((x) => x.reason.code === 'INSUFFICIENT_BALANCE'));
  assert.equal(await bal('dan', 'gift_coins'), 500);
  assert.equal(await bal('eve', 'gift_earnings'), 800);
  const com1 = Number((await one(env, `SELECT balance FROM wallet_balances WHERE account = 'platform' AND wallet = 'commission_gift_coins'`)).balance);
  assert.equal(com1 - com0, 200);
  // failed attempts left no op rows and no entries behind
  assert.equal((await q(env, `SELECT 1 FROM wallet_ops WHERE ref LIKE 'gift:race:%'`)).length, 1);
  assert.equal((await q(env, `SELECT 1 FROM wallet_entries WHERE ref LIKE 'gift:race:%'`)).length, 3);
});

test('idempotency under parallel duplicate refs: the same multi-leg gift sent 8 times at once applies once', async () => {
  await W.credit(env, { ref: 'seed:dan:gift2', userId: ids.dan, wallet: 'gift_coins', amount: 1000, kind: 'admin_adjust' });
  const before = { dan: await bal('dan', 'gift_coins'), eve: await bal('eve', 'gift_earnings') };
  const r = await Promise.all(Array.from({ length: 8 }, () => W.postGift(env, { ref: 'gift:dup:1', senderId: ids.dan, recipientId: ids.eve, coins: 500 })));
  assert.equal(r.filter((x) => x.applied).length, 1);
  assert.ok(r.filter((x) => !x.applied).every((x) => x.duplicate && x.entries.length === 3));
  assert.equal(await bal('dan', 'gift_coins'), before.dan - 500);
  assert.equal(await bal('eve', 'gift_earnings'), before.eve + 400);
  // the same purchase request (same idempotency key) fired in parallel → one purchase row, one credit
  const body = { productId: 'dating_coins_500', provider: 'test', idempotencyKey: 'k_tess_par_1' };
  const before2 = await bal('tess', 'dating_coins');
  const rs = await Promise.all([1, 2, 3, 4].map(() => call('tess', 'POST', '/wallet/purchase', body)));
  assert.ok(rs.every((x) => x.status === 200 || x.status === 201), JSON.stringify(rs.map((x) => x.json)));
  assert.equal(await bal('tess', 'dating_coins'), before2 + 500);
  assert.equal((await q(env, `SELECT 1 FROM wallet_purchases WHERE idempotency_key = 'k_tess_par_1'`)).length, 1);
  // a Dating Plus purchase fired in parallel → one live subscription
  const sb = { productId: 'dating_plus_monthly', provider: 'test', idempotencyKey: 'k_boss_plus_par' };
  const ss = await Promise.all([1, 2, 3].map(() => call('boss', 'POST', '/wallet/purchase', sb)));
  assert.ok(ss.every((x) => x.status === 200 || x.status === 201), JSON.stringify(ss.map((x) => x.json)));
  assert.equal((await q(env, `SELECT 1 FROM dating_subscriptions WHERE user_id = $1 AND status = 'active'`, [ids.boss])).length, 1);
});

test('alsoRun: business writes commit with the ledger or not at all', async () => {
  await q(env, 'CREATE TABLE IF NOT EXISTS t_wallet_also (id text PRIMARY KEY, status text NOT NULL)');
  await q(env, `INSERT INTO t_wallet_also (id, status) VALUES ('fr1', 'draft'), ('fr2', 'draft')`);
  await W.credit(env, { ref: 'seed:eve:fm', userId: ids.eve, wallet: 'fundme_credits', amount: 1, kind: 'purchase' });
  const publish = (id) => W.spend(env, { ref: `fundme_publish:${id}`, userId: ids.eve, wallet: 'fundme_credits', amount: 1, kind: 'fundme_publish', relatedType: 'fundraiser', relatedId: id,
    alsoRun: [[`UPDATE t_wallet_also SET status = 'live' WHERE id = $1 AND status = 'draft'`, [id]]] });
  assert.equal((await publish('fr1')).applied, true);
  assert.equal((await one(env, `SELECT status FROM t_wallet_also WHERE id = 'fr1'`)).status, 'live');
  assert.equal((await publish('fr1')).applied, false); // retry: no second deduction
  assert.equal(await bal('eve', 'fundme_credits'), 0);
  await assert.rejects(publish('fr2'), (e) => e.code === 'INSUFFICIENT_BALANCE'); // no credit → not published either
  assert.equal((await one(env, `SELECT status FROM t_wallet_also WHERE id = 'fr2'`)).status, 'draft');
  // a failing business statement rolls the ledger back too
  await W.credit(env, { ref: 'seed:eve:fm2', userId: ids.eve, wallet: 'fundme_credits', amount: 1, kind: 'purchase' });
  await assert.rejects(W.spend(env, { ref: 'fundme_publish:bad', userId: ids.eve, wallet: 'fundme_credits', amount: 1, kind: 'fundme_publish', alsoRun: [['INSERT INTO t_wallet_also (id, status) VALUES ($1, NULL)', ['x']]] }));
  assert.equal(await bal('eve', 'fundme_credits'), 1);
  assert.equal(await one(env, `SELECT 1 FROM wallet_ops WHERE ref = 'fundme_publish:bad'`), null);
});

test('input guards, registerKind, ledger integrity, schema guards', async () => {
  await assert.rejects(W.postGift(env, { ref: 'gift:neg', senderId: ids.dan, recipientId: ids.eve, coins: -50 }), (e) => e.code === 'BAD_AMOUNT');
  await assert.rejects(W.postGift(env, { ref: 'gift:zero', senderId: ids.dan, recipientId: ids.eve, coins: 0 }), (e) => e.code === 'BAD_AMOUNT');
  await assert.rejects(W.recordPayoutPaid(env, { payoutId: 'neg1', beneficiaryId: ids.cal, amountMinor: -5, currency: 'NGN' }), (e) => e.code === 'BAD_AMOUNT');
  await assert.rejects(W.spend(env, { ref: 'x:earn', userId: ids.cal, wallet: 'gift_earnings', amount: 1, kind: 'x_y' }), (e) => e.code === 'NOT_SPENDABLE');
  await assert.rejects(W.credit(env, { ref: 'x:ghost', userId: '00000000-0000-4000-8000-00000000dead', wallet: 'gift_coins', amount: 1, kind: 'x_y' }), (e) => e.code === 'UNKNOWN_USER');
  W.registerKind('super_like', 'Super Like');
  await W.credit(env, { ref: 'seed:eve:dc', userId: ids.eve, wallet: 'dating_coins', amount: 50, kind: 'purchase' });
  await W.spend(env, { ref: 'super_like:eve:1', userId: ids.eve, wallet: 'dating_coins', amount: 10, kind: 'super_like' });
  const h = await call('eve', 'GET', '/wallet/dating_coins/history');
  assert.equal(h.json.items[0].label, 'Super Like'); assert.equal(h.json.items[0].balanceAfter, 40);
  const ig = await W.ledgerIntegrity(env);
  assert.equal(ig.ok, true, JSON.stringify(ig.mismatches)); assert.ok(ig.checked > 10);
  assert.equal((await call('boss', 'GET', '/admin/api/wallet/overview')).json.integrity.ok, true);
  // Paystack can never be the provider of a digital-goods purchase, even by a direct insert
  await assert.rejects(q(env, `INSERT INTO wallet_purchases (user_id, product_id, provider, idempotency_key, amount_minor, currency) VALUES ($1, 'gift_coins_500', 'paystack', 'k_ps_direct_1', 1, 'NGN')`, [ids.amy]));
});

test('one shared Play module: wallet store and Memberships use the same verification', async () => {
  assert.equal(Memberships.verifyPlayPurchase, Play.verifyPlayPurchase);
  assert.equal(Memberships.playConfigured, Play.playConfigured);
  await assert.rejects(Play.verifyPlayPurchase({}, { productId: 'p', purchaseToken: 't' }), (e) => e.code === 'PAYMENTS_NOT_CONFIGURED');
  // even with the env vars set, verification fails closed until the Google API call is implemented
  await assert.rejects(Play.verifyPlayPurchase({ GOOGLE_PLAY_PACKAGE_NAME: 'x', GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: '{}' }, { productId: 'p', purchaseToken: 't' }), (e) => e.code === 'PAYMENTS_NOT_CONFIGURED');
  assert.deepEqual(Play.storeMethod({}, 'android'), { id: 'play', label: 'Google Play', provider: 'play', available: false, note: 'Coming soon' });
  assert.equal(Play.storeMethod({}, 'ios').provider, 'apple');
  const tester = { id: 'u1', handle: 'tess', role: 'member' };
  assert.equal(Play.testerAllowed({ WALLET_TEST_PURCHASES: 'true', WALLET_TESTERS: 'tess' }, tester, { flag: 'WALLET_TEST_PURCHASES', list: 'WALLET_TESTERS' }), true);
  assert.equal(Play.testerAllowed({ WALLET_TEST_PURCHASES: '', WALLET_TESTERS: 'tess' }, tester, { flag: 'WALLET_TEST_PURCHASES', list: 'WALLET_TESTERS' }), false);
  assert.equal(Memberships.testCheckoutAllowed({ MEMBERSHIP_TEST_CHECKOUT: 'true' }, { id: 'a', role: 'admin' }), true);
});
