// PAYSTACK FOR EVERY PURCHASE: wallet packs, Dating Plus / VIP (card auto-renew, bank-transfer reminders, declines),
// Memberships, BibleNestra Plus, the in-app switch, webhook replays, amount checks and the return page.
// Uses the fake Paystack in dev/fake-paystack.mjs — no network, no money.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { makeFakePaystack } from '../dev/fake-paystack.mjs';
import { q, one } from '../src/lib/db.js';
import { runPaystackRenewals, runPaystackReminders, settlePayment } from '../src/lib/paystackCheckout.js';
import { PAYSTACK_ADMIN_SCRIPT } from '../src/lib/paystackAdminPage.js';

let env; let fake; const app = createApp();
const SECRET = 'sk_test_fake_secret';
before(async () => {
  const f = makeFakePaystack();
  fake = f.fake;
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', PAYSTACK_SECRET_KEY: SECRET, __paystackFetch: f.fetchFn, __paystackFake: f.fake, WALLET_TEST_PURCHASES: 'true' };
});
async function call(user, method, path, body, headers = {}) {
  const h = { ...headers };
  if (user) h['X-Dev-User'] = user;
  let b;
  if (body !== undefined) { b = typeof body === 'string' ? body : JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${path}`, { method, headers: h, body: b, redirect: 'manual' }), env);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = text; }
  return { status: res.status, json, headers: res.headers };
}
const ids = {};
const pay = (ref, channel = 'card') => call(null, 'GET', `/pay/paystack/fake/${ref}/pay?channel=${channel}`);
const status = (user, ref) => call(user, 'GET', `/payments/paystack/${ref}`);
const age = (ref) => q(env, `UPDATE paystack_payments SET created_at = now() - interval '10 seconds' WHERE reference = $1`, [ref]);
const bal = async (user) => (await call(user, 'GET', '/wallet')).json.balances;
async function webhook(evt) {
  const raw = JSON.stringify(evt);
  const sig = crypto.createHmac('sha512', SECRET).update(raw).digest('hex');
  return call(null, 'POST', '/webhooks/paystack', raw, { 'X-Paystack-Signature': sig });
}

test('setup', async () => {
  for (const u of ['boss', 'ada', 'bola', 'chi', 'dayo', 'efe']) ids[u] = (await call(u, 'GET', '/me')).json.id;
  await q(env, `UPDATE users SET role = 'admin' WHERE id = $1`, [ids.boss]);
  assert.ok(!PAYSTACK_ADMIN_SCRIPT.includes('`') && !PAYSTACK_ADMIN_SCRIPT.includes('${') && !PAYSTACK_ADMIN_SCRIPT.includes('\\'), 'admin script must be a plain string');
});

test('wallet pack: checkout → pay → credited once (poll, return page and webhook replays)', async () => {
  const p = await call('ada', 'GET', '/wallet/products?wallet=dating_coins');
  assert.deepEqual(p.json.methods.map((m) => [m.id, m.available]), [['paystack', true]]);
  assert.match(p.json.methods[0].note, /Card, bank transfer or USSD/);
  // email is needed once, then remembered
  const noMail = await call('ada', 'POST', '/wallet/purchase', { productId: 'dating_coins_250', provider: 'paystack', idempotencyKey: 'k_ada_ps_1' });
  assert.equal(noMail.json.code, 'EMAIL_REQUIRED');
  const r = await call('ada', 'POST', '/wallet/purchase', { productId: 'dating_coins_250', provider: 'paystack', idempotencyKey: 'k_ada_ps_1', email: 'Ada@Example.com' });
  assert.equal(r.status, 202, JSON.stringify(r.json));
  const ref = r.json.checkout.reference;
  assert.match(ref, /^bnw-[a-f0-9]{24}$/);
  assert.match(r.json.checkout.url, /\/pay\/paystack\/fake\//);
  assert.equal(fake.get(ref).amount, 70000); assert.equal(fake.get(ref).email, 'ada@example.com');
  // the same idempotency key returns the same open checkout
  const again = await call('ada', 'POST', '/wallet/purchase', { productId: 'dating_coins_250', provider: 'paystack', idempotencyKey: 'k_ada_ps_1' });
  assert.equal(again.json.checkout.reference, ref);
  // not paid yet → pending, nothing credited
  await age(ref);
  assert.equal((await status('ada', ref)).json.payment.status, 'pending');
  assert.equal((await bal('ada')).dating_coins || 0, 0);
  // someone else can't read it
  assert.equal((await status('bola', ref)).status, 404);
  // pay on the (fake) Paystack page → redirected to our return page → granted
  const back = await pay(ref);
  assert.equal(back.status, 302); assert.match(back.headers.get('location'), /\/pay\/paystack\/return\?reference=/);
  const page = await call(null, 'GET', `/pay/paystack/return?reference=${ref}`);
  assert.match(page.json, /Payment received/); assert.match(page.json, /biblenestra:\/\/paystack\?reference=/);
  assert.equal((await bal('ada')).dating_coins, 250);
  const s = (await status('ada', ref)).json.payment;
  assert.equal(s.status, 'success'); assert.equal(s.channel, 'card'); assert.equal(s.test, true);
  // replays never credit twice
  await call(null, 'GET', `/pay/paystack/return?reference=${ref}`);
  const wh = await webhook({ event: 'charge.success', data: { reference: ref } });
  assert.equal(wh.status, 200); assert.equal(wh.json.purchase, true);
  assert.equal((await bal('ada')).dating_coins, 250);
  const pur = await one(env, 'SELECT * FROM wallet_purchases WHERE provider_ref = $1', [ref]);
  assert.equal(pur.status, 'verified'); assert.equal(pur.provider, 'paystack'); assert.equal(pur.test, true);
  // bad webhook signature is refused
  assert.equal((await call(null, 'POST', '/webhooks/paystack', '{"event":"charge.success"}', { 'X-Paystack-Signature': 'nope' })).status, 400);
});

test('webhook alone settles a payment (member closed the browser)', async () => {
  const r = await call('bola', 'POST', '/wallet/purchase', { productId: 'fundme_credits_7', provider: 'paystack', idempotencyKey: 'k_bola_ps_1', email: 'bola@example.com' });
  const ref = r.json.checkout.reference;
  fake.complete(ref, 'success', 'bank_transfer');
  const wh = await webhook({ event: 'charge.success', data: { reference: ref } });
  assert.equal(wh.json.status, 'success');
  assert.equal((await bal('bola')).fundme_credits, 7);
});

test('declined card and amount mismatch never grant', async () => {
  const r = await call('chi', 'POST', '/wallet/purchase', { productId: 'dating_coins_100', provider: 'paystack', idempotencyKey: 'k_chi_ps_1', email: 'chi@example.com' });
  const ref = r.json.checkout.reference;
  await call(null, 'GET', `/pay/paystack/fake/${ref}/fail`);
  const page = await call(null, 'GET', `/pay/paystack/return?reference=${ref}`);
  assert.match(page.json, /didn’t go through/);
  assert.equal((await bal('chi')).dating_coins || 0, 0);
  // someone tampered: Paystack reports less money than the package costs → review, not granted
  const r2 = await call('chi', 'POST', '/wallet/purchase', { productId: 'dating_coins_100', provider: 'paystack', idempotencyKey: 'k_chi_ps_2' });
  const ref2 = r2.json.checkout.reference;
  fake.complete(ref2, 'success'); fake.get(ref2).amount = 100;
  await age(ref2);
  assert.equal((await status('chi', ref2)).json.payment.status, 'review');
  assert.equal((await bal('chi')).dating_coins || 0, 0);
  // admin sees it in the review queue
  const list = await call('boss', 'GET', '/admin/api/paystack/payments?status=review');
  assert.ok(list.json.items.some((p) => p.reference === ref2 && p.error === 'AMOUNT_MISMATCH'));
});

test('Dating VIP by card: active, auto-renews by card with VIP coins each cycle', async () => {
  const r = await call('dayo', 'POST', '/wallet/purchase', { productId: 'dating_vip_monthly', provider: 'paystack', idempotencyKey: 'k_dayo_vip_1', email: 'dayo@example.com' });
  const ref = r.json.checkout.reference;
  await pay(ref, 'card'); await call(null, 'GET', `/pay/paystack/return?reference=${ref}`);
  const w = await call('dayo', 'GET', '/wallet');
  assert.equal(w.json.dating.plan, 'vip');
  assert.equal(w.json.subscription.provider, 'paystack'); assert.equal(w.json.subscription.autoRenew, true);
  assert.equal(w.json.balances.dating_coins, 300);
  // already on this plan and renewing → can't buy it twice
  assert.equal((await call('dayo', 'POST', '/wallet/purchase', { productId: 'dating_vip_monthly', provider: 'paystack', idempotencyKey: 'k_dayo_vip_2' })).json.code, 'ALREADY_SUBSCRIBED');
  // period ends within a day → the cron charges the saved card
  const sub = await one(env, `SELECT * FROM dating_subscriptions WHERE user_id = $1 AND status = 'active'`, [ids.dayo]);
  await q(env, `UPDATE dating_subscriptions SET current_period_start = now() - interval '29 days', current_period_end = now() + interval '2 hours' WHERE id = $1`, [sub.id]);
  const before1 = await one(env, 'SELECT current_period_end FROM dating_subscriptions WHERE id = $1', [sub.id]);
  const out = await runPaystackRenewals(env);
  assert.equal(out.charged, 1);
  const after = await one(env, 'SELECT * FROM dating_subscriptions WHERE id = $1', [sub.id]);
  assert.ok(new Date(after.current_period_end) > new Date(before1.current_period_end));
  assert.equal(after.renewal_attempts, 0);
  assert.equal((await bal('dayo')).dating_coins, 600);
  // same tick again → nothing charged twice
  assert.equal((await runPaystackRenewals(env)).charged, 0);
  const renewals = await q(env, `SELECT * FROM paystack_payments WHERE user_id = $1 AND purpose = 'renewal'`, [ids.dayo]);
  assert.equal(renewals.length, 1); assert.equal(renewals[0].status, 'success');
});

test('declined renewals: 3 tries, then renewal stops and the member is told', async () => {
  const sub = await one(env, `SELECT * FROM dating_subscriptions WHERE user_id = $1 AND status = 'active'`, [ids.dayo]);
  await q(env, `UPDATE dating_subscriptions SET current_period_end = now() + interval '1 hour' WHERE id = $1`, [sub.id]);
  fake.declineRenewals = true;
  for (let i = 0; i < 3; i++) {
    await runPaystackRenewals(env);
    await q(env, `UPDATE dating_subscriptions SET last_renewal_at = now() - interval '7 hours' WHERE id = $1`, [sub.id]);
  }
  fake.declineRenewals = false;
  const s = await one(env, 'SELECT * FROM dating_subscriptions WHERE id = $1', [sub.id]);
  assert.equal(s.auto_renew, false); assert.equal(s.renewal_attempts, 3);
  const n = await q(env, `SELECT * FROM notifications WHERE user_id = $1 AND title = 'Renewal didn’t go through'`, [ids.dayo]);
  assert.equal(n.length, 1);
  assert.equal((await runPaystackRenewals(env)).charged, 0);
  assert.equal((await bal('dayo')).dating_coins, 600);
});

test('Dating Plus by bank transfer: no auto-renew, reminder 3 days before the end, pay again to extend', async () => {
  const r = await call('efe', 'POST', '/wallet/purchase', { productId: 'dating_plus_monthly', provider: 'paystack', idempotencyKey: 'k_efe_plus_1', email: 'efe@example.com' });
  await pay(r.json.checkout.reference, 'bank_transfer');
  await call(null, 'GET', `/pay/paystack/return?reference=${r.json.checkout.reference}`);
  const w = (await call('efe', 'GET', '/wallet')).json;
  assert.equal(w.dating.plan, 'plus'); assert.equal(w.subscription.autoRenew, false);
  const sub = await one(env, `SELECT * FROM dating_subscriptions WHERE user_id = $1 AND status = 'active'`, [ids.efe]);
  await q(env, `UPDATE dating_subscriptions SET current_period_end = now() + interval '2 days' WHERE id = $1`, [sub.id]);
  assert.ok((await runPaystackReminders(env)).reminded >= 1); // Efe (and Dayo, whose card renewal stopped)
  assert.equal((await runPaystackReminders(env)).reminded, 0); // once per period
  assert.equal((await q(env, `SELECT * FROM notifications WHERE user_id = $1 AND title = 'Your plan ends soon'`, [ids.efe])).length, 1);
  // pays again (not blocked: it doesn't auto-renew) → one more month from the current end
  const end0 = new Date((await one(env, 'SELECT current_period_end FROM dating_subscriptions WHERE id = $1', [sub.id])).current_period_end);
  const r2 = await call('efe', 'POST', '/wallet/purchase', { productId: 'dating_plus_monthly', provider: 'paystack', idempotencyKey: 'k_efe_plus_2' });
  assert.equal(r2.status, 202, JSON.stringify(r2.json));
  await pay(r2.json.checkout.reference, 'ussd');
  await call(null, 'GET', `/pay/paystack/return?reference=${r2.json.checkout.reference}`);
  const s2 = await one(env, 'SELECT * FROM dating_subscriptions WHERE id = $1', [sub.id]);
  assert.ok(new Date(s2.current_period_end).getTime() - end0.getTime() > 27 * 86400e3);
});

test('memberships: Paystack checkout gives access after payment; card renews', async () => {
  const { seedMemberships } = await import('../dev/seed-memberships.mjs');
  const adminId = (await call('admin', 'GET', '/me')).json.id;
  await q(env, `UPDATE users SET role = 'admin' WHERE id = $1`, [adminId]);
  await seedMemberships(env);
  const m = await one(env, `SELECT m.* FROM memberships m JOIN membership_plans p ON p.membership_id = m.id AND p.interval = 'month' WHERE m.status = 'published' LIMIT 1`);
  const plan = await one(env, `SELECT * FROM membership_plans WHERE membership_id = $1 AND interval = 'month'`, [m.id]);
  const cfg = await call('chi', 'GET', `/memberships/${m.id}/checkout?platform=android`);
  assert.deepEqual(cfg.json.methods.map((x) => [x.id, x.available]), [['paystack', true]]);
  const qs = (cfg.json.questions || []).map((x) => (x.required ? 'Grace Chapel' : ''));
  const r = await call('chi', 'POST', `/memberships/${m.id}/checkout`, { planId: plan.id, provider: 'paystack', agree: true, answers: qs, contact: { email: 'chi@example.com' } });
  assert.equal(r.status, 202, JSON.stringify(r.json));
  const ref = r.json.checkout.reference;
  assert.equal(fake.get(ref).amount, Number(plan.price_minor));
  assert.equal((await call('chi', 'GET', `/memberships/${m.id}/home`)).status, 403);
  await pay(ref, 'card'); await call(null, 'GET', `/pay/paystack/return?reference=${ref}`);
  const home = await call('chi', 'GET', `/memberships/${m.id}/home`);
  assert.equal(home.status, 200, JSON.stringify(home.json));
  assert.equal(home.json.access.renews, true); assert.equal(home.json.access.source, 'paystack');
  // renewal by card extends access by a month
  const sub = await one(env, 'SELECT * FROM membership_subscriptions WHERE membership_id = $1 AND user_id = $2', [m.id, ids.chi]);
  await q(env, `UPDATE membership_subscriptions SET expires_at = now() + interval '3 hours' WHERE id = $1`, [sub.id]);
  assert.equal((await runPaystackRenewals(env)).charged, 1);
  const s2 = await one(env, 'SELECT * FROM membership_subscriptions WHERE id = $1', [sub.id]);
  assert.ok(new Date(s2.expires_at).getTime() > Date.now() + 27 * 86400e3);
  // cancel → no more renewals
  await call('chi', 'POST', `/memberships/${m.id}/cancel`);
  assert.equal((await one(env, 'SELECT auto_renew FROM membership_subscriptions WHERE id = $1', [sub.id])).auto_renew, false);
});

test('BibleNestra Plus: plans, checkout, premium on /me, cancel', async () => {
  const p = await call('bola', 'GET', '/plus');
  assert.deepEqual(p.json.plans.map((x) => x.id), ['yearly', 'weekly']);
  assert.equal(p.json.plans[0].priceText, '₦25,000'); assert.match(p.json.plans[0].badge, /^Save \d+%$/);
  assert.equal(p.json.billingEmail, 'bola@example.com');
  assert.equal(p.json.premium, false);
  const r = await call('bola', 'POST', '/plus/checkout', { planId: 'weekly' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  await pay(r.json.checkout.reference, 'card'); await call(null, 'GET', `/pay/paystack/return?reference=${r.json.checkout.reference}`);
  const me = await call('bola', 'GET', '/me');
  assert.equal(me.json.premium, true);
  const plus = (await call('bola', 'GET', '/plus')).json;
  assert.equal(plus.subscription.autoRenew, true); assert.equal(plus.subscription.planId, 'weekly');
  assert.equal((await call('bola', 'POST', '/plus/checkout', { planId: 'weekly' })).json.code, 'ALREADY_SUBSCRIBED');
  const c = await call('bola', 'POST', '/plus/cancel');
  assert.equal(c.json.subscription.status, 'cancelled'); assert.equal(c.json.subscription.hasAccess, true);
  assert.equal((await call('bola', 'GET', '/me')).json.premium, true); // keeps Plus until the week ends
  // admin edits the price
  const e = await call('boss', 'PATCH', '/admin/api/paystack/plus-plans/weekly', { priceMinor: 200000 });
  assert.equal(e.json.items.find((x) => x.id === 'weekly').priceMinor, 200000);
});

test('admin switch pauses all in-app payments at once', async () => {
  assert.equal((await call('ada', 'PUT', '/admin/api/paystack/in-app', { on: false })).status, 403);
  await call('boss', 'PUT', '/admin/api/paystack/in-app', { on: false });
  const p = await call('ada', 'GET', '/wallet/products?wallet=gift_coins');
  assert.equal(p.json.methods[0].available, false); assert.match(p.json.methods[0].note, /Paused/);
  assert.equal((await call('ada', 'POST', '/wallet/purchase', { productId: 'gift_coins_500', provider: 'paystack', idempotencyKey: 'k_ada_paused' })).json.code, 'PAYMENTS_PAUSED');
  assert.equal((await call('ada', 'POST', '/plus/checkout', { planId: 'yearly' })).json.code, 'PAYMENTS_PAUSED');
  await call('boss', 'PUT', '/admin/api/paystack/in-app', { on: true });
  assert.equal((await call('ada', 'GET', '/wallet/products?wallet=gift_coins')).json.methods[0].available, true);
  const ov = await call('boss', 'GET', '/admin/api/paystack/overview');
  assert.equal(ov.json.configured, true); assert.equal(ov.json.testMode, true); assert.match(ov.json.webhookUrl, /\/webhooks\/paystack$/);
});

test('without keys: "coming soon", nothing starts', async () => {
  const saved = { k: env.PAYSTACK_SECRET_KEY, f: env.__paystackFetch };
  delete env.PAYSTACK_SECRET_KEY; delete env.__paystackFetch;
  try {
    const p = await call('ada', 'GET', '/wallet/products?wallet=gift_coins');
    assert.deepEqual(p.json.methods.map((m) => [m.id, m.available, m.note]), [['paystack', false, 'Coming soon']]);
    assert.equal((await call('ada', 'POST', '/plus/checkout', { planId: 'yearly' })).json.code, 'PAYMENTS_NOT_CONFIGURED');
  } finally { env.PAYSTACK_SECRET_KEY = saved.k; env.__paystackFetch = saved.f; }
});

test('a retried grant (applied but not marked done) never extends a plan or credits twice', async () => {
  const snap = async () => ({
    plus: (await q(env, 'SELECT id, current_period_end FROM plus_subscriptions ORDER BY id')).map((r) => `${r.id}:${new Date(r.current_period_end).toISOString()}`),
    members: (await q(env, 'SELECT id, expires_at FROM membership_subscriptions ORDER BY id')).map((r) => `${r.id}:${r.expires_at && new Date(r.expires_at).toISOString()}`),
    promos: (await q(env, 'SELECT id, uses FROM membership_promos ORDER BY id')).map((r) => `${r.id}:${r.uses}`),
    dating: (await q(env, 'SELECT id, current_period_end FROM dating_subscriptions ORDER BY id')).map((r) => `${r.id}:${new Date(r.current_period_end).toISOString()}`),
    ledger: (await one(env, 'SELECT count(*)::int AS n FROM wallet_entries')).n,
  });
  const done = await q(env, `SELECT DISTINCT ON (kind) reference, kind FROM paystack_payments
      WHERE status = 'success' AND purpose IS DISTINCT FROM 'renewal' ORDER BY kind, created_at DESC`);
  assert.deepEqual(done.map((d) => d.kind).sort(), ['membership', 'plus', 'wallet']);
  for (const d of done) {
    const before = await snap();
    // the grant went through but the "done" mark never landed → row stuck in 'processing', re-claimable after 2 minutes
    await q(env, `UPDATE paystack_payments SET status = 'processing', updated_at = now() - interval '3 minutes' WHERE reference = $1`, [d.reference]);
    const r = await settlePayment(env, d.reference);
    assert.equal(r.status, 'success', `${d.kind}: ${JSON.stringify(r)}`);
    assert.deepEqual(await snap(), before, `${d.kind}: a retried grant must not change anything`);
  }
});
