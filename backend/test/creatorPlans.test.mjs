// CREATOR PLANS (client round 3): Free / Standard / Premium. FX price maths, withdrawal fee maths and rounding, plan
// gating of creation, paid checkout, expiry and renewal, upgrade / downgrade, the once-per-day join ad across several
// Free-plan groups (Africa/Lagos day), creator withdrawals (KYC, balance, fee, bank charge), and the admin config.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { makeFakePaystack } from '../dev/fake-paystack.mjs';
import { q, one } from '../src/lib/db.js';
import { periodFor } from '../src/lib/membershipAdGate.js';
import { runPaystackRenewals, runPaystackReminders } from '../src/lib/paystackCheckout.js';
import { lapseCreationFees } from '../src/lib/membershipFees.js';
import {
  DEFAULT_CREATOR_PLANS, checkCreatorPlans, ppmOf, withdrawalFee, priceQuote, planStateOf, addMonth,
  sweepCreatorPlans, joinAdFor, recordJoinAdShown, applyCreatorPlanPayment,
} from '../src/lib/creatorPlans.js';
import { withdrawalBreakdown, nextStatus, creatorBalance } from '../src/lib/creatorWithdrawals.js';
import { setConfig } from '../src/lib/wallet.js';

const DAY = 86400e3;
let env; let fake; const app = createApp();
const SECRET = 'sk_test_fake_secret';
const ids = {};
const mem = {};

before(async () => {
  const f = makeFakePaystack();
  fake = f.fake;
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', PAYSTACK_SECRET_KEY: SECRET, __paystackFetch: f.fetchFn, __paystackFake: f.fake, MEMBERSHIPS_PUBLIC_CREATION: 'true', MEMBERSHIP_TEST_CHECKOUT: 'true' };
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
const userId = async (u) => (await call(u, 'GET', '/me')).json.id;
const payAndReturn = async (ref) => {
  await call(null, 'GET', `/pay/paystack/fake/${ref}/pay?channel=card`);
  await call(null, 'GET', `/pay/paystack/return?reference=${ref}`);
};
const row = (uid) => one(env, 'SELECT * FROM creator_plan_subscriptions WHERE user_id = $1', [uid]);

// ---------- pure maths ----------
test('FX: NGN at the live USD rate, rounded to the kobo; USD when PAYSTACK_CURRENCIES lists it', () => {
  const std = DEFAULT_CREATOR_PLANS.plans.standard; // 1024 cents
  const prem = DEFAULT_CREATOR_PLANS.plans.premium; // 4378 cents
  const a = priceQuote(std, { ngnPerUsd: 1500 });
  assert.deepEqual([a.currency, a.amountMinor, a.fxRate], ['NGN', 1536000, 1500]); // 10.24 USD = 15,360 NGN = 1,536,000 kobo
  assert.equal(priceQuote(prem, { ngnPerUsd: 1523.47 }).amountMinor, Math.round(4378 * 1523.47));
  const usd = priceQuote(std, { ngnPerUsd: 1500, usdChargeable: true });
  assert.deepEqual([usd.currency, usd.amountMinor], ['USD', 1024]);
  assert.throws(() => priceQuote(std, { ngnPerUsd: 0 }), (e) => e.code === 'FX_UNAVAILABLE' && e.status === 503);
});

test('withdrawal fee: integer maths with a half-up rounding rule, percent → ppm exactly', () => {
  assert.equal(ppmOf(0.131), 1310);
  assert.equal(ppmOf(0.3), 3000);
  assert.equal(ppmOf(0.5), 5000);
  assert.equal(withdrawalFee(100000, 3000), 300); // 0.3% of 1,000 NGN
  assert.equal(withdrawalFee(100000, 1310), 131);
  assert.equal(withdrawalFee(100, 5000), 1); // 0.5 of a kobo rounds up
  assert.equal(withdrawalFee(99, 5000), 0); // 0.495 rounds down
  assert.equal(withdrawalFee(1234567, 1310), 1617); // 1617.22577 → 1617
  assert.equal(withdrawalFee(10000000000, 1310), 13100000); // exact, no float drift
  const b = withdrawalBreakdown({ grossMinor: 100000, ppm: 3000, bankChargeMinor: 2000 });
  assert.deepEqual([b.feeMinor, b.netMinor, b.feePercent], [300, 97700, 0.3]);
  assert.equal(withdrawalBreakdown({ grossMinor: 100000, ppm: 3000 }).netMinor, null); // net is set when paid
});

test('creator_plans validation: the defaults pass; bad prices, percents and names are refused', () => {
  assert.equal(checkCreatorPlans(DEFAULT_CREATOR_PLANS), true);
  const with_ = (patch) => ({ ...DEFAULT_CREATOR_PLANS, plans: { ...DEFAULT_CREATOR_PLANS.plans, ...patch } });
  assert.equal(checkCreatorPlans(with_({ free: { ...DEFAULT_CREATOR_PLANS.plans.free, priceUsdCents: 500 } })), false); // Free is always 0
  assert.equal(checkCreatorPlans(with_({ standard: { ...DEFAULT_CREATOR_PLANS.plans.standard, priceUsdCents: 0 } })), false); // paid plans cost more than 0
  assert.equal(checkCreatorPlans(with_({ premium: { ...DEFAULT_CREATOR_PLANS.plans.premium, withdrawalPercent: 0.1305 } })), false); // 4 decimals
  assert.equal(checkCreatorPlans(with_({ premium: { ...DEFAULT_CREATOR_PLANS.plans.premium, withdrawalPercent: 11 } })), false);
  assert.equal(checkCreatorPlans(with_({ standard: { ...DEFAULT_CREATOR_PLANS.plans.standard, name: '' } })), false);
  assert.equal(checkCreatorPlans({ ...DEFAULT_CREATOR_PLANS, enabled: 'yes' }), false);
});

test('plan state: no row, Free, paid in date, lapsed, past due; the active plan counts for fees and join ads', () => {
  const now = new Date('2026-11-28T12:00:00Z');
  const inDate = new Date(now.getTime() + 10 * DAY).toISOString();
  assert.deepEqual([planStateOf(null).canCreate, planStateOf(null).reason], [false, 'CREATOR_PLAN_REQUIRED']);
  assert.equal(planStateOf({ plan_id: 'free', status: 'active' }, now).canCreate, true);
  const p = planStateOf({ plan_id: 'premium', status: 'active', current_period_end: inDate, auto_renew: true }, now);
  assert.deepEqual([p.canCreate, p.activePlanId, p.renewsOn === inDate], [true, 'premium', true]);
  const expired = planStateOf({ plan_id: 'standard', status: 'active', current_period_end: new Date(now.getTime() - DAY).toISOString() }, now);
  assert.deepEqual([expired.canCreate, expired.status, expired.reason, expired.activePlanId], [false, 'expired', 'CREATOR_PLAN_LAPSED', 'free']);
  const due = planStateOf({ plan_id: 'standard', status: 'past_due', current_period_end: inDate }, now);
  assert.deepEqual([due.canCreate, due.status, due.activePlanId], [false, 'past_due', 'free']); // a failed payment blocks at once
  assert.equal(planStateOf({ plan_id: 'premium', status: 'active', current_period_end: inDate, pending_plan_id: 'standard' }, now).pendingPlanId, 'standard');
});

test('month maths: a month later, clamped to the month end; Lagos day boundary', () => {
  assert.equal(addMonth(new Date('2027-01-31T10:00:00Z')).toISOString(), '2027-02-28T10:00:00.000Z');
  assert.equal(addMonth(new Date('2028-01-31T00:00:00Z')).toISOString(), '2028-02-29T00:00:00.000Z');
  assert.equal(periodFor('daily', new Date('2026-11-28T22:59:00Z')).key, 'd:2026-11-28'); // 23:59 Lagos
  assert.equal(periodFor('daily', new Date('2026-11-28T23:01:00Z')).key, 'd:2026-11-29'); // 00:01 Lagos
});

test('withdrawal status moves: only the allowed transitions', () => {
  assert.equal(nextStatus('approve', 'requested'), 'approved');
  assert.equal(nextStatus('paid', 'approved'), 'paid');
  assert.equal(nextStatus('reject', 'approved'), 'rejected');
  assert.equal(nextStatus('cancel', 'requested'), 'cancelled');
  assert.throws(() => nextStatus('paid', 'requested'), (e) => e.status === 409);
  assert.throws(() => nextStatus('approve', 'paid'), (e) => e.status === 409);
  assert.throws(() => nextStatus('explode', 'requested'), (e) => e.status === 400);
});

// ---------- end to end ----------
test('setup', async () => {
  for (const u of ['boss', 'zara', 'yusuf', 'fan1', 'fan2']) ids[u] = await userId(u);
  await q(env, `UPDATE users SET role = 'admin' WHERE id = $1`, [ids.boss]);
});

test('gating: a creator must choose a plan before creating; Free lets them create, then create more', async () => {
  const blocked = await call('zara', 'POST', '/memberships/manage', { title: 'Zara Prayer Circle' });
  assert.equal(blocked.status, 403, JSON.stringify(blocked.json));
  assert.equal(blocked.json.code, 'CREATOR_PLAN_REQUIRED');
  const pick = await call('zara', 'POST', '/creator-plan/change', { planId: 'free' });
  assert.equal(pick.status, 200, JSON.stringify(pick.json));
  assert.equal(pick.json.status, 'changed');
  assert.equal(pick.json.current.canCreate, true);
  const first = await call('zara', 'POST', '/memberships/manage', { title: 'Zara Prayer Circle', category: 'Prayer' });
  assert.equal(first.status, 201, JSON.stringify(first.json));
  mem.z1 = first.json.id;
  mem.z2 = (await call('zara', 'POST', '/memberships/manage', { title: 'Zara Bible Study', category: 'Bible Study' })).json.id;
  mem.z3 = (await call('zara', 'POST', '/memberships/manage', { title: 'Zara Youth Night', category: 'Youth' })).json.id;
  assert.ok(mem.z2 && mem.z3);
  assert.equal((await call('zara', 'POST', '/creator-plan/change', { planId: 'free' })).json.code, 'ALREADY_ON_PLAN');
});

test('join ad, Free creators: once per day per user across every Free group, reset at Lagos midnight', async () => {
  const membership = (id) => one(env, 'SELECT * FROM memberships WHERE id = $1', [id]);
  const fan1 = { id: ids.fan1 };
  const morning = new Date('2026-12-02T08:00:00Z'); // 09:00 Lagos
  const evening = new Date('2026-12-02T22:30:00Z'); // 23:30 Lagos, same day
  const nextDay = new Date('2026-12-02T23:30:00Z'); // 00:30 Lagos, next day
  const m1 = await membership(mem.z1);
  const m2 = await membership(mem.z2);
  const m3 = await membership(mem.z3);
  assert.equal((await joinAdFor(env, fan1, m1, morning)).due, true);
  assert.equal((await recordJoinAdShown(env, ids.fan1, morning)), true);
  assert.equal((await joinAdFor(env, fan1, m2, morning)).reason, 'shown_today'); // second group the same day: no ad
  assert.equal((await joinAdFor(env, fan1, m3, evening)).reason, 'shown_today'); // third group, still the same Lagos day
  assert.equal((await recordJoinAdShown(env, ids.fan1, evening)), false); // a repeat report changes nothing
  assert.equal((await joinAdFor(env, { id: ids.fan2 }, m1, morning)).due, true); // another account has its own
  assert.equal((await joinAdFor(env, fan1, m1, nextDay)).due, true); // resets at Lagos midnight
  const own = await joinAdFor(env, { id: ids.zara }, m1, morning);
  assert.deepEqual([own.due, own.reason], [false, 'exempt:owner']); // the creator never sees their own ad
});

test('join ad over HTTP: GET says due, POST records it once', async () => {
  await call('zara', 'POST', `/memberships/manage/${mem.z1}/plans`, { name: 'Free', priceMinor: 0, currency: 'NGN', interval: 'one_time' });
  const pub = await call('zara', 'POST', `/memberships/manage/${mem.z1}/publish`, {});
  assert.equal(pub.status, 200, JSON.stringify(pub.json)); // published, so members can see it
  const today = await call('fan2', 'GET', `/memberships/${mem.z1}/join-ad`);
  assert.equal(today.status, 200, JSON.stringify(today.json));
  assert.equal(today.json.due, true);
  const shown = await call('fan2', 'POST', `/memberships/${mem.z1}/join-ad/shown`, {});
  assert.equal(shown.status, 200);
  assert.equal(shown.json.recorded, true);
  const again = await call('fan2', 'POST', `/memberships/${mem.z1}/join-ad/shown`, {});
  assert.equal(again.json.recorded, false);
  assert.equal((await call('fan2', 'GET', `/memberships/${mem.z1}/join-ad`)).json.due, false);
});

test('paid plan: Standard is charged in NGN at the locked rate, then the creator can create; no join ad', async () => {
  const up = await call('yusuf', 'POST', '/creator-plan/change', { planId: 'standard', email: 'yusuf@example.test' });
  assert.equal(up.status, 202, JSON.stringify(up.json));
  assert.equal(up.json.status, 'checkout');
  assert.ok(up.json.checkout.url);
  assert.equal(up.json.charge.amountMinor, Math.round(1024 * up.json.charge.fxRate));
  await payAndReturn(up.json.checkout.reference);
  const r = await row(ids.yusuf);
  assert.equal(r.plan_id, 'standard');
  assert.equal(r.status, 'active');
  const days = (new Date(r.current_period_end).getTime() - Date.now()) / DAY;
  assert.ok(days > 27 && days < 32, `a month of access, got ${days}`);
  const made = await call('yusuf', 'POST', '/memberships/manage', { title: 'Yusuf Study Group', category: 'Bible Study' });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  mem.y1 = made.json.id;
  assert.equal((await joinAdFor(env, { id: ids.fan1 }, await one(env, 'SELECT * FROM memberships WHERE id = $1', [mem.y1]), new Date())).reason, 'paid_creator');
  const pay = await call('yusuf', 'GET', '/creator-plan');
  assert.equal(pay.json.payments[0].planId, 'standard');
  assert.equal(pay.json.payments[0].status, 'success');
});

test('upgrade is immediate (checkout); a downgrade between paid plans waits for the period end; same plan clears it', async () => {
  const up = await call('yusuf', 'POST', '/creator-plan/change', { planId: 'premium', email: 'yusuf@example.test' });
  assert.equal(up.status, 202);
  await payAndReturn(up.json.checkout.reference);
  assert.equal((await row(ids.yusuf)).plan_id, 'premium');
  const down = await call('yusuf', 'POST', '/creator-plan/change', { planId: 'standard' });
  assert.equal(down.status, 200, JSON.stringify(down.json));
  assert.equal(down.json.status, 'scheduled');
  let r = await row(ids.yusuf);
  assert.deepEqual([r.plan_id, r.pending_plan_id], ['premium', 'standard']); // still Premium until the period ends
  const undo = await call('yusuf', 'POST', '/creator-plan/change', { planId: 'premium' });
  assert.equal(undo.json.status, 'changed');
  r = await row(ids.yusuf);
  assert.equal(r.pending_plan_id, null);
});

test('renewal: a card renews a month later at the price of the plan in force; Premium price follows the rate', async () => {
  const r = await row(ids.yusuf);
  assert.ok(r.paystack_auth_id, 'the card was saved on the checkout');
  assert.equal(r.auto_renew, true);
  const soon = new Date(Date.now() + 3600e3); // inside the 24 h window
  await q(env, `UPDATE creator_plan_subscriptions SET current_period_end = $2 WHERE user_id = $1`, [ids.yusuf, soon.toISOString()]);
  const out = await runPaystackRenewals(env, { now: new Date() });
  assert.equal(out.charged, 1, JSON.stringify(out));
  await new Promise((res) => setTimeout(res, 50));
  const after = await row(ids.yusuf);
  const gained = (new Date(after.current_period_end).getTime() - soon.getTime()) / DAY;
  assert.ok(gained > 27 && gained < 32, `renewed for a month, got ${gained}`);
  assert.equal(after.plan_id, 'premium');
  assert.equal(after.renewal_attempts, 0);
});

test('expiry: an unpaid paid plan blocks new memberships (existing ones keep running) until renewed or switched to Free', async () => {
  await q(env, `UPDATE creator_plan_subscriptions SET current_period_end = $2, auto_renew = false WHERE user_id = $1`, [ids.yusuf, new Date(Date.now() - DAY).toISOString()]);
  const swept = await sweepCreatorPlans(env);
  assert.ok(swept.expired >= 1);
  assert.equal((await row(ids.yusuf)).status, 'expired');
  const blocked = await call('yusuf', 'POST', '/memberships/manage', { title: 'Yusuf Second Group' });
  assert.equal(blocked.status, 402, JSON.stringify(blocked.json));
  assert.equal(blocked.json.code, 'CREATOR_PLAN_LAPSED');
  const still = await call('yusuf', 'GET', `/memberships/manage/${mem.y1}`);
  assert.equal(still.status, 200); // the existing membership is untouched
  assert.equal((await call('yusuf', 'POST', '/creator-plan/change', { planId: 'free' })).json.status, 'changed');
  assert.equal((await call('yusuf', 'POST', '/memberships/manage', { title: 'Yusuf Second Group' })).status, 201);
});

test('a pending downgrade to Free starts when the paid period ends', async () => {
  await q(env, `UPDATE creator_plan_subscriptions SET plan_id = 'standard', status = 'active', current_period_end = $2, pending_plan_id = 'free', auto_renew = false WHERE user_id = $1`,
    [ids.zara, new Date(Date.now() - 60e3).toISOString()]);
  const swept = await sweepCreatorPlans(env);
  assert.ok(swept.freed >= 1);
  const r = await row(ids.zara);
  assert.deepEqual([r.plan_id, r.pending_plan_id, r.current_period_end], ['free', null, null]);
});

test('withdrawals: KYC, minimum, balance, the active plan fee, bank charge kept apart, admin approve and mark paid', async () => {
  // a paid membership payment for Yusuf's group (10,000 NGN), counted into the balance
  await q(env, `INSERT INTO paystack_payments (reference, user_id, kind, purpose, target_id, amount_minor, currency, status, test, paid_at)
    VALUES ('bn-test-ym1', $1, 'membership', 'purchase', $2, 1000000, 'NGN', 'success', false, now())`, [ids.fan1, mem.y1]);
  const noKyc = await call('yusuf', 'POST', '/creator-plan/withdrawals', { amountMinor: 500000, currency: 'NGN' });
  assert.equal(noKyc.status, 409);
  assert.equal(noKyc.json.code, 'KYC_REQUIRED');
  await q(env, `INSERT INTO payout_kyc (user_id, id_type, id_number_enc, id_last4, legal_name, bank_code, bank_name, account_number_enc, account_last4, account_name, status)
    VALUES ($1, 'nin', 'enc', '1234', 'Yusuf Test Creator', '058', 'Test Bank', 'enc', '5678', 'Yusuf Test Creator', 'approved')`, [ids.yusuf]);
  const low = await call('yusuf', 'POST', '/creator-plan/withdrawals', { amountMinor: 50000, currency: 'NGN' });
  assert.equal(low.status, 400);
  assert.equal(low.json.code, 'BELOW_MINIMUM');
  const bal = await creatorBalance(env, ids.yusuf, 'NGN');
  assert.equal(bal.availableMinor, 1000000);
  const over = await call('yusuf', 'POST', '/creator-plan/withdrawals', { amountMinor: 1000001, currency: 'NGN' });
  assert.equal(over.json.code, 'INSUFFICIENT_BALANCE');
  const req = await call('yusuf', 'POST', '/creator-plan/withdrawals', { amountMinor: 500000, currency: 'NGN' });
  assert.equal(req.status, 201, JSON.stringify(req.json));
  assert.equal(req.json.planId, 'free'); // Yusuf's paid plan lapsed: the Free fee applies
  assert.equal(req.json.feeMinor, 2500); // 0.5% of 5,000 NGN
  const hold = await call('yusuf', 'POST', '/creator-plan/withdrawals', { amountMinor: 600000, currency: 'NGN' });
  assert.equal(hold.json.code, 'INSUFFICIENT_BALANCE'); // 500,000 is held by the request
  const adminPaid = await call('boss', 'POST', `/admin/api/creator-withdrawals/${req.json.id}/paid`, { bankChargeMinor: 1000, reference: 'TRF-1' });
  assert.equal(adminPaid.json.code, 'BAD_STATE'); // must be approved first
  assert.equal((await call('boss', 'POST', `/admin/api/creator-withdrawals/${req.json.id}/approve`, {})).json.status, 'approved');
  assert.equal((await call('boss', 'POST', `/admin/api/creator-withdrawals/${req.json.id}/paid`, { bankChargeMinor: 1000 })).status, 400); // reference needed
  const paid = await call('boss', 'POST', `/admin/api/creator-withdrawals/${req.json.id}/paid`, { bankChargeMinor: 1000, reference: 'TRF-1' });
  assert.equal(paid.status, 200, JSON.stringify(paid.json));
  assert.equal(paid.json.status, 'paid');
  assert.equal(paid.json.bankChargeMinor, 1000);
  assert.equal(paid.json.netMinor, 500000 - 2500 - 1000); // gross − BibleNestra fee − bank charge
  const overview = await call('yusuf', 'GET', '/creator-plan/withdrawals');
  assert.equal(overview.json.balance.availableMinor, 500000);
  assert.equal(overview.json.items[0].feeText.length > 0, true);
});

test('withdrawals on Free: the 0.5% Free fee; a requested withdrawal can be cancelled by the creator', async () => {
  await q(env, `INSERT INTO paystack_payments (reference, user_id, kind, purpose, target_id, amount_minor, currency, status, test, paid_at)
    VALUES ('bn-test-zm1', $1, 'membership', 'purchase', $2, 400000, 'NGN', 'success', false, now())`, [ids.fan2, mem.z1]);
  await q(env, `INSERT INTO payout_kyc (user_id, id_type, id_number_enc, id_last4, legal_name, bank_code, bank_name, account_number_enc, account_last4, account_name, status)
    VALUES ($1, 'nin', 'enc', '1234', 'Zara Test Creator', '058', 'Test Bank', 'enc', '9999', 'Zara Test Creator', 'approved')`, [ids.zara]);
  const req = await call('zara', 'POST', '/creator-plan/withdrawals', { amountMinor: 200000, currency: 'NGN' });
  assert.equal(req.status, 201, JSON.stringify(req.json));
  assert.equal(req.json.feeMinor, 1000); // 0.5% of 2,000 NGN
  const cancel = await call('zara', 'POST', `/creator-plan/withdrawals/${req.json.id}/cancel`, {});
  assert.equal(cancel.json.status, 'cancelled');
  assert.equal((await creatorBalance(env, ids.zara)).availableMinor, 400000 - 0); // the cancelled amount is back
});

test('the old per-membership creation fee is dormant: a due fee is not charged, nothing lapses, no reminder', async () => {
  const auth = await one(env, `INSERT INTO paystack_authorizations (user_id, authorization_code, signature, email)
    VALUES ($1, 'AUTH_dormant_fee', 'SIG_dormant_fee', 'zara@example.test')
    ON CONFLICT (user_id, signature) DO UPDATE SET active = true RETURNING id`, [ids.zara]);
  await q(env, `INSERT INTO membership_creation_fees (membership_id, user_id, cycle, amount_minor, currency, paid_until, status, paystack_auth_id, auto_renew)
    VALUES ($1, $2, 'week', 500000, 'NGN', $3, 'active', $4, true)`, [mem.z2, ids.zara, new Date(Date.now() + 12 * 3600e3).toISOString(), auth.id]);
  const now = new Date();
  await runPaystackRenewals(env, { now });
  await runPaystackReminders(env, { now });
  const fee = await one(env, 'SELECT * FROM membership_creation_fees WHERE membership_id = $1', [mem.z2]);
  assert.equal(fee.renewal_attempts, 0, 'not charged');
  assert.equal(fee.last_renewal_at, null);
  assert.equal(fee.reminded_for, null, 'no reminder');
  assert.equal(fee.status, 'active');
  assert.equal(await lapseCreationFees(env, new Date(Date.now() + 3 * DAY)), 0, 'nothing lapses to draft');
});

test('three declined card renewals put the paid plan into past_due: no new memberships (402) until renewed or Free', async () => {
  ids.ivo = await userId('ivo');
  const up = await call('ivo', 'POST', '/creator-plan/change', { planId: 'standard', email: 'ivo@example.test' });
  assert.equal(up.status, 202, JSON.stringify(up.json));
  await payAndReturn(up.json.checkout.reference);
  assert.equal((await row(ids.ivo)).auto_renew, true);
  fake.declineRenewals = true;
  try {
    const base = Date.now();
    for (let k = 0; k < 3; k++) {
      const now = new Date(base + k * 7 * 3600e3); // each retry is past the 6 h spacing
      await q(env, 'UPDATE creator_plan_subscriptions SET current_period_end = $2 WHERE user_id = $1', [ids.ivo, new Date(now.getTime() + 3600e3).toISOString()]);
      await runPaystackRenewals(env, { now });
    }
  } finally {
    fake.declineRenewals = false;
  }
  const r = await row(ids.ivo);
  assert.equal(r.status, 'past_due');
  assert.equal(r.renewal_attempts, 3);
  assert.equal(r.auto_renew, false);
  const blocked = await call('ivo', 'POST', '/memberships/manage', { title: 'Ivo Group' });
  assert.equal(blocked.status, 402, JSON.stringify(blocked.json));
  assert.equal(blocked.json.code, 'CREATOR_PLAN_LAPSED');
  const paid = await call('ivo', 'POST', '/creator-plan/change', { planId: 'standard', email: 'ivo@example.test' });
  assert.equal(paid.status, 202, 'renewing by checkout is allowed while past due');
});

test('a payment reference counts once: a retried settle does not add a second month', async () => {
  const applied = { userId: ids.ivo, planId: 'premium', amountMinor: 1, currency: 'NGN', fxRate: 1500, reference: 'bn-idem-test-1' };
  const first = await applyCreatorPlanPayment(env, applied);
  const again = await applyCreatorPlanPayment(env, applied);
  assert.equal(new Date(again.current_period_end).getTime(), new Date(first.current_period_end).getTime());
  const next = await applyCreatorPlanPayment(env, { ...applied, reference: 'bn-idem-test-2', renewal: true });
  const gained = (new Date(next.current_period_end).getTime() - new Date(first.current_period_end).getTime()) / DAY;
  assert.ok(gained > 27 && gained < 32, `a different payment adds one month, got ${gained}`);
});

test('two simultaneous withdrawals that together exceed the balance: only one succeeds', async () => {
  const before = await creatorBalance(env, ids.zara, 'NGN');
  assert.ok(before.availableMinor >= 400000, `zara has ${before.availableMinor}`);
  const ask = () => call('zara', 'POST', '/creator-plan/withdrawals', { amountMinor: 300000, currency: 'NGN' });
  const [a, b] = await Promise.all([ask(), ask()]);
  const codes = [a.status, b.status].sort();
  assert.deepEqual(codes, [201, 409], JSON.stringify([a.json, b.json]));
  const loser = a.status === 409 ? a : b;
  assert.equal(loser.json.code, 'INSUFFICIENT_BALANCE');
  const after = await creatorBalance(env, ids.zara, 'NGN');
  assert.equal(after.heldMinor - before.heldMinor, 300000, 'exactly one request is held');
  // cancel the one that went through so the later tests see the balance they expect
  const winner = a.status === 201 ? a : b;
  await call('zara', 'POST', `/creator-plan/withdrawals/${winner.json.id}/cancel`, {});
});

test('admin config: staff-visible to admins only, bad values refused, a plan price change takes effect', async () => {
  assert.equal((await call('fan1', 'GET', '/admin/api/creator-plans')).status, 403);
  const get = await call('boss', 'GET', '/admin/api/creator-plans');
  assert.equal(get.status, 200, JSON.stringify(get.json));
  assert.equal(get.json.config.plans.standard.priceUsdCents, 1024);
  assert.equal((await call('boss', 'PUT', '/admin/api/creator-plans', { plans: { premium: { withdrawalPercent: 11 } } })).status, 400);
  const ok = await call('boss', 'PUT', '/admin/api/creator-plans', { plans: { standard: { priceUsdCents: 1100, name: 'Standard' } }, joinAd: { enabled: false } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.config.plans.standard.priceUsdCents, 1100);
  assert.equal(ok.json.config.joinAd.enabled, false);
  assert.equal(ok.json.ppm.premium, 1310);
  const quote = await call('zara', 'POST', '/creator-plan/change', { planId: 'standard', email: 'zara@example.test' });
  assert.equal(quote.status, 202);
  assert.equal(quote.json.charge.amountMinor, Math.round(1100 * quote.json.charge.fxRate));
  assert.equal((await joinAdFor(env, { id: ids.fan2 }, await one(env, 'SELECT * FROM memberships WHERE id = $1', [mem.z1]), new Date('2026-12-05T09:00:00Z'))).reason, 'off');
  await setConfig(env, 'creator_plans', DEFAULT_CREATOR_PLANS, ids.boss);
  assert.equal((await call('boss', 'GET', '/admin/api/creator-withdrawals?status=requested')).status, 200);
});
