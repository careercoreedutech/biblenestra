// MEMBERSHIP PLATFORM (Development Update v1, items 4 / 4.1 / 4.2 / 4.3): weekly plans (7 days), the creation fee
// (admin settings, paid through Paystack before publishing, exempt for admins and older memberships, lapses back to
// draft), weekly card renewals for the fee and for a weekly plan, and the creator dashboard numbers.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { makeFakePaystack } from '../dev/fake-paystack.mjs';
import { q, one } from '../src/lib/db.js';
import { runPaystackRenewals } from '../src/lib/paystackCheckout.js';
import { accessUntil, planShape, INTERVALS, runMembershipCron } from '../src/lib/memberships.js';
import { feeFor, feeTypeOf, feePeriodEnd, checkCreationFee, lapseCreationFees } from '../src/lib/membershipFees.js';
import { summarizeCreatorStats } from '../src/lib/membershipCreator.js';

const DAY = 86400e3;
let env; let fake; const app = createApp();
const SECRET = 'sk_test_fake_secret';
before(async () => {
  const f = makeFakePaystack();
  fake = f.fake;
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', PAYSTACK_SECRET_KEY: SECRET, __paystackFetch: f.fetchFn, __paystackFake: f.fake, MEMBERSHIPS_PUBLIC_CREATION: 'true' };
});
async function call(user, method, path, body) {
  const h = {};
  if (user) h['X-Dev-User'] = user;
  let b;
  if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${path}`, { method, headers: h, body: b, redirect: 'manual' }), env);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = text; }
  return { status: res.status, json };
}
const pay = (ref) => call(null, 'GET', `/pay/paystack/fake/${ref}/pay?channel=card`);
const payAndReturn = async (ref) => { await pay(ref); await call(null, 'GET', `/pay/paystack/return?reference=${ref}`); };
const ids = {};
let mem; let fanPlan;

// ---------- pure maths ----------
test('weekly plans: 7 days of access, weekly labels', () => {
  assert.ok(INTERVALS.includes('week'));
  const from = new Date('2026-11-27T00:00:00Z');
  assert.equal(accessUntil({ interval: 'week' }, from).getTime() - from.getTime(), 7 * DAY);
  const ps = planShape({ id: 'p', name: 'Weekly', price_minor: 200000, currency: 'NGN', interval: 'week', interval_days: null, active: true, sort_order: 0 });
  assert.equal(ps.periodLabel, '/ week');
  assert.equal(ps.perLabel, 'per week');
  assert.match(ps.accessText, /7 days/);
  assert.equal(accessUntil({ interval: 'month' }, from).getUTCMonth(), 11); // monthly unchanged
});

test('creation fee maths: per type, per category, cycle periods, validation', () => {
  const cfg = { cycle: 'week', currency: 'NGN', free: 0, paid: 500000, categories: { Prayer: 200000 } };
  const paid = [{ price_minor: 200000, active: true }];
  const free = [{ price_minor: 0, active: true }];
  assert.equal(feeTypeOf(paid), 'paid');
  assert.equal(feeTypeOf(free), 'free');
  assert.equal(feeTypeOf([{ price_minor: 200000, active: false }]), 'free'); // inactive plans don't count
  assert.equal(feeFor(cfg, { category: 'Youth', plans: paid }).amountMinor, 500000);
  assert.equal(feeFor(cfg, { category: 'Youth', plans: free }).amountMinor, 0);
  assert.equal(feeFor(cfg, { category: 'Prayer', plans: paid }).amountMinor, 200000); // category wins
  assert.equal(feeFor(cfg, { category: 'Youth', plans: free }).type, 'free');
  assert.equal(feePeriodEnd('week', new Date(0)).getTime(), 7 * DAY);
  assert.equal(feePeriodEnd('one_time', new Date()), null);
  assert.equal(checkCreationFee({ cycle: 'daily', currency: 'NGN', free: 0, paid: 0 }), false);
  assert.equal(checkCreationFee({ cycle: 'week', currency: 'NGN', free: -1, paid: 0 }), false);
  assert.equal(checkCreationFee({ cycle: 'month', currency: 'NGN', free: 0, paid: 500000, categories: { A: 100 } }), true);
});

test('creator dashboard maths: totals, lists, weekly earnings, renewals', () => {
  const now = new Date('2026-11-27T12:00:00Z');
  const d = (days) => new Date(now.getTime() + days * DAY).toISOString();
  const subs = [
    { user_id: 'a', name: 'Ann', status: 'active', started_at: d(-2), expires_at: d(5), source: 'paystack' },
    { user_id: 'b', name: 'Ben', status: 'expired', started_at: d(-30), expires_at: d(-1), source: 'paystack' },
    { user_id: 'c', name: 'Cy', status: 'refunded', started_at: d(-1), expires_at: d(6), source: 'paystack' },
    { user_id: 'd', name: 'Di', status: 'cancelled', started_at: d(-20), expires_at: d(2), source: 'paystack' },
  ];
  const pay1 = (ref, user, purpose, days, status = 'success') => ({ reference: ref, user_id: user, name: user, purpose, status, amount_minor: 200000, currency: 'NGN', channel: 'card', paid_at: status === 'success' ? d(days) : null, created_at: d(days) });
  const payments = [pay1('r1', 'a', 'purchase', -2), pay1('r2', 'd', 'renewal', -1), pay1('r3', 'b', 'purchase', -30), pay1('r4', 'a', 'purchase', -1, 'failed')];
  const s = summarizeCreatorStats({ subs, payments }, now);
  assert.deepEqual(s.totals, { members: 3, activeSubscribers: 2, expired: 1, newSubscriptions7d: 1, renewals7d: 1 });
  assert.equal(s.earnings.weeklyMinor, 400000); // r1 + r2 (r3 is older than a week, r4 failed)
  assert.equal(s.earnings.totalMinor, 600000);
  assert.equal(s.earnings.weeklyPayments, 2);
  assert.deepEqual(s.activeSubscribers.map((x) => x.userId), ['d', 'a']); // soonest expiry first
  assert.deepEqual(s.expiredSubscribers.map((x) => x.userId), ['b']);
  assert.equal(s.renewals.length, 1);
  assert.equal(s.ledger.length, 4);
  assert.equal(s.payouts.mode, 'manual');
});

// ---------- end to end ----------
test('setup', async () => {
  for (const u of ['boss', 'owner', 'fan']) ids[u] = (await call(u, 'GET', '/me')).json.id;
  await q(env, `UPDATE users SET role = 'admin' WHERE id = $1`, [ids.boss]);
});

test('fee settings: admins save them, creators cannot, bad values are refused', async () => {
  assert.equal((await call('boss', 'PUT', '/memberships/manage/fee-settings', { cycle: 'daily' })).status, 400);
  assert.equal((await call('owner', 'PUT', '/memberships/manage/fee-settings', { cycle: 'week', paid: 500000 })).status, 403);
  const ok = await call('boss', 'PUT', '/memberships/manage/fee-settings', { cycle: 'week', currency: 'ngn', free: 0, paid: 500000, categories: { Prayer: 200000 } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.fee.cycle, 'week'); assert.equal(ok.json.fee.paid, 500000); assert.equal(ok.json.fee.currency, 'NGN');
  assert.equal(ok.json.fee.categories.Prayer, 200000);
});

test('creation fee gate: a creator pays before publishing, then publishes', async () => {
  const r = await call('owner', 'POST', '/memberships/manage', { title: 'Night Watch Prayer', category: 'Youth', headline: 'Pray nightly', visibility: 'private', rules: 'Be kind. No spam.' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  mem = r.json;
  assert.equal(mem.visibility, 'private'); assert.equal(mem.rules, 'Be kind. No spam.');
  assert.equal((await one(env, 'SELECT creation_fee_required FROM memberships WHERE id = $1', [mem.id])).creation_fee_required, true);
  const p = await call('owner', 'POST', `/memberships/manage/${mem.id}/plans`, { name: 'Weekly', priceMinor: 200000, interval: 'week' });
  assert.equal(p.status, 201, JSON.stringify(p.json));
  const blocked = await call('owner', 'POST', `/memberships/manage/${mem.id}/publish`);
  assert.equal(blocked.status, 402); assert.equal(blocked.json.code, 'CREATION_FEE_REQUIRED');
  const st = await call('owner', 'GET', `/memberships/manage/${mem.id}/creation-fee`);
  assert.equal(st.json.required, true); assert.equal(st.json.paid, false); assert.equal(st.json.amountMinor, 500000);
  const co = await call('owner', 'POST', `/memberships/manage/${mem.id}/creation-fee/checkout`, { email: 'owner@example.com' });
  assert.equal(co.status, 201, JSON.stringify(co.json));
  assert.match(co.json.checkout.url, /\/pay\/paystack\/fake\//);
  assert.equal(fake.get(co.json.checkout.reference).amount, 500000);
  await payAndReturn(co.json.checkout.reference);
  const paid = await call('owner', 'GET', `/memberships/manage/${mem.id}/creation-fee`);
  assert.equal(paid.json.paid, true); assert.equal(paid.json.status, 'active'); assert.equal(paid.json.cycle, 'week');
  const pub = await call('owner', 'POST', `/memberships/manage/${mem.id}/publish`);
  assert.equal(pub.status, 200, JSON.stringify(pub.json));
  assert.equal(pub.json.status, 'published');
});

test('exempt: platform admins and memberships that existed before the fee pay nothing', async () => {
  const r = await call('boss', 'POST', '/memberships/manage', { title: 'Admin Class', category: 'Bible Study' });
  await call('boss', 'POST', `/memberships/manage/${r.json.id}/plans`, { name: 'Weekly', priceMinor: 200000, interval: 'week' });
  const pub = await call('boss', 'POST', `/memberships/manage/${r.json.id}/publish`);
  assert.equal(pub.status, 200, JSON.stringify(pub.json));
  const legacy = await call('boss', 'POST', '/memberships/manage', { title: 'Old Group', category: 'Prayer' });
  await q(env, 'UPDATE memberships SET owner_id = $2, creation_fee_required = false WHERE id = $1', [legacy.json.id, ids.owner]);
  await call('boss', 'POST', `/memberships/manage/${legacy.json.id}/plans`, { name: 'Weekly', priceMinor: 200000, interval: 'week' });
  const lp = await call('owner', 'POST', `/memberships/manage/${legacy.json.id}/publish`);
  assert.equal(lp.status, 200, JSON.stringify(lp.json));
});

test('a weekly fee that ends unpaid moves the membership back to draft; paying again publishes it', async () => {
  await q(env, `UPDATE membership_creation_fees SET paid_until = now() - interval '1 minute' WHERE membership_id = $1`, [mem.id]);
  assert.equal(await lapseCreationFees(env), 1);
  await runMembershipCron(env); // the membership cron runs the same sweep first
  const m = await one(env, 'SELECT status, fee_lapsed_at FROM memberships WHERE id = $1', [mem.id]);
  assert.equal(m.status, 'draft'); assert.ok(m.fee_lapsed_at);
  assert.equal((await call('owner', 'POST', `/memberships/manage/${mem.id}/publish`)).status, 402);
  assert.equal(await lapseCreationFees(env), 0); // nothing left to lapse
});

test('weekly renewals: the creation fee and a weekly plan both renew for 7 more days', async () => {
  // the fee was paid by card, so its authorisation is saved; put the period near its end
  const fee = await one(env, 'SELECT * FROM membership_creation_fees WHERE membership_id = $1', [mem.id]);
  assert.ok(fee.paystack_auth_id, 'card authorisation saved on the fee payment');
  await q(env, `UPDATE membership_creation_fees SET paid_until = now() + interval '3 hours', status = 'active', auto_renew = true,
    renewal_attempts = 0, last_renewal_at = NULL WHERE membership_id = $1`, [mem.id]);
  await q(env, 'UPDATE memberships SET fee_lapsed_at = NULL WHERE id = $1', [mem.id]);
  assert.equal((await call('owner', 'POST', `/memberships/manage/${mem.id}/publish`)).status, 200);
  // fan subscribes to the weekly plan
  fanPlan = await one(env, `SELECT * FROM membership_plans WHERE membership_id = $1 AND interval = 'week'`, [mem.id]);
  const r = await call('fan', 'POST', `/memberships/${mem.id}/checkout`, { planId: fanPlan.id, provider: 'paystack', agree: true, answers: [], contact: { email: 'fan@example.com' } });
  assert.equal(r.status, 202, JSON.stringify(r.json));
  await payAndReturn(r.json.checkout.reference);
  const sub = await one(env, 'SELECT * FROM membership_subscriptions WHERE membership_id = $1 AND user_id = $2', [mem.id, ids.fan]);
  assert.ok(sub, 'subscription created');
  assert.ok(Math.abs(new Date(sub.expires_at) - new Date(sub.started_at) - 7 * DAY) < 60e3, 'weekly plan gives 7 days');
  // the period ends within a day: the cron charges both saved cards
  await q(env, `UPDATE membership_subscriptions SET expires_at = now() + interval '3 hours' WHERE id = $1`, [sub.id]);
  const out = await runPaystackRenewals(env);
  assert.equal(out.charged, 2);
  const fee2 = await one(env, 'SELECT paid_until FROM membership_creation_fees WHERE membership_id = $1', [mem.id]);
  assert.ok(new Date(fee2.paid_until).getTime() > Date.now() + 6.9 * DAY, 'fee renewed for a week');
  const sub2 = await one(env, 'SELECT expires_at FROM membership_subscriptions WHERE id = $1', [sub.id]);
  assert.ok(new Date(sub2.expires_at).getTime() > Date.now() + 6.9 * DAY, 'subscription renewed for a week');
  assert.equal((await runPaystackRenewals(env)).charged, 0); // same tick again: nothing charged twice
});

test('creator dashboard: totals for the owner only', async () => {
  const s = await call('owner', 'GET', `/memberships/manage/${mem.id}/stats`);
  assert.equal(s.status, 200, JSON.stringify(s.json));
  assert.equal(s.json.totals.activeSubscribers, 1);
  assert.equal(s.json.totals.members, 1);
  assert.equal(s.json.totals.newSubscriptions7d, 1);
  assert.equal(s.json.payouts.mode, 'manual');
  assert.equal((await call('fan', 'GET', `/memberships/manage/${mem.id}/stats`)).status, 403);
});

test('admin monitor: every membership carries its fee status and subscriber counts', async () => {
  const list = await call('boss', 'GET', '/memberships/manage');
  assert.equal(list.status, 200);
  const row = list.json.items.find((x) => x.id === mem.id);
  assert.equal(row.creationFee.required, true); assert.equal(row.creationFee.paid, true);
  assert.equal(row.subscribers.active, 1);
  assert.equal(row.visibility, 'private');
  assert.ok(list.json.items.every((x) => x.creationFee && typeof x.subscribers.active === 'number'));
  assert.equal(fanPlan.interval, 'week');
});
