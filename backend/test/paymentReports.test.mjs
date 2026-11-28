// PAYMENT VERIFICATION: report a payment, duplicate references, admin verification and approvals (Paystack check,
// grant-once, manual grant with reason and expiry), the reconciliation job (stubbed Paystack fetch) and invitation links.
// Uses the fake Paystack (dev/fake-paystack.mjs) and a small stub for the reconciliation job. No network, no money.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { makeFakePaystack } from '../dev/fake-paystack.mjs';
import { q, one } from '../src/lib/db.js';
import { settlePayment } from '../src/lib/paystackCheckout.js';
import { reconcilePaystack } from '../src/lib/paystackReconcile.js';
import { PAYMENT_REPORTS_ADMIN_SCRIPT } from '../src/lib/paymentReportsAdminPage.js';

let env; let fake; let fetchFn; const app = createApp();
const SECRET = 'sk_test_fake_secret';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'); // a tiny PNG header, enough for storage
const ids = {}; const S = {};

before(async () => {
  const f = makeFakePaystack();
  fake = f.fake; fetchFn = f.fetchFn;
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', PAYSTACK_SECRET_KEY: SECRET, __paystackFetch: fetchFn, __paystackFake: fake, WALLET_TEST_PURCHASES: 'true' };
});

async function call(user, method, path, body, headers = {}) {
  const h = { ...headers };
  if (user) h['X-Dev-User'] = user;
  let b;
  if (body !== undefined) {
    if (typeof body === 'string' || body instanceof Uint8Array) b = body;
    else { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  }
  const res = await app.fetch(new Request(`http://api.test${path}`, { method, headers: h, body: b, redirect: 'manual' }), env);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = text; }
  return { status: res.status, json, headers: res.headers };
}
const upload = (user) => call(user, 'POST', '/payments/report/receipt', PNG, { 'Content-Type': 'image/png' });
const ageRow = (ref, mins = 10) => q(env, `UPDATE paystack_payments SET created_at = now() - interval '${mins} minutes', updated_at = now() - interval '${mins} minutes' WHERE reference = $1`, [ref]);
async function webhook(evt) {
  const raw = JSON.stringify(evt);
  const sig = crypto.createHmac('sha512', SECRET).update(raw).digest('hex');
  return call(null, 'POST', '/webhooks/paystack', raw, { 'X-Paystack-Signature': sig });
}
/** A Paystack transaction the app never started (paid elsewhere), as the fake Paystack would hold it. */
function paidElsewhere(reference, amountMinor, email = 'payer@example.com') {
  fake.txns.set(reference, { id: 900000 + fake.txns.size, reference, amount: amountMinor, currency: 'NGN', email, metadata: {}, status: 'success', channel: 'bank_transfer', paid_at: new Date().toISOString() });
}
const reportBody = (ref, extra = {}) => ({ reference: ref, amount: '200', method: 'bank_transfer', kind: 'membership', targetId: S.membershipId, planId: S.planId, receiptKey: S.receiptKey, ...extra });
const subOf = (user) => one(env, 'SELECT * FROM membership_subscriptions WHERE membership_id = $1 AND user_id = $2', [S.membershipId, ids[user]]);

test('setup: users, admin, a published membership with a ₦200 plan', async () => {
  for (const u of ['boss', 'ada', 'bola', 'chi', 'dayo', 'efe']) ids[u] = (await call(u, 'GET', '/me')).json.id;
  await q(env, `UPDATE users SET role = 'admin' WHERE id = $1`, [ids.boss]);
  await q(env, `UPDATE users SET handle = 'ada' WHERE id = $1`, [ids.ada]);
  const m = await one(env, `INSERT INTO memberships (slug, title, status, owner_id, headline, description) VALUES ('pay-verify-club', 'Pay Verify Club', 'published', $1, 'x', 'x') RETURNING id`, [ids.boss]);
  const p = await one(env, `INSERT INTO membership_plans (membership_id, name, price_minor, currency, interval, active) VALUES ($1, 'Monthly', 20000, 'NGN', 'month', true) RETURNING id`, [m.id]);
  S.membershipId = m.id; S.planId = p.id;
  assert.ok(!PAYMENT_REPORTS_ADMIN_SCRIPT.includes('`') && !PAYMENT_REPORTS_ADMIN_SCRIPT.includes('${') && !PAYMENT_REPORTS_ADMIN_SCRIPT.includes('\\'), 'admin script must be a plain string');
});

test('receipt upload is private to its uploader and must be an image', async () => {
  const bad = await call('ada', 'POST', '/payments/report/receipt', 'hello', { 'Content-Type': 'text/plain' });
  assert.equal(bad.status, 400); assert.equal(bad.json.code, 'BAD_IMAGE_TYPE');
  const up = await upload('ada');
  assert.equal(up.status, 201, JSON.stringify(up.json));
  assert.match(up.json.key, new RegExp(`^rcpt/${ids.ada}/[0-9a-f-]{36}\\.png$`));
  S.receiptKey = up.json.key;
  // the media route does not serve rcpt/ keys
  const pub = await call(null, 'GET', `/media/${up.json.key}`);
  assert.equal(pub.status, 404);
});

test('a member reports a payment: creates a pending request, a receipt alone confirms nothing', async () => {
  // Ada pays ₦200 by bank transfer; the webhook never arrives and she closes the page
  const co = await call('ada', 'POST', `/memberships/${S.membershipId}/checkout`, { planId: S.planId, agree: true, provider: 'paystack', email: 'ada@example.com' });
  assert.equal(co.status, 202, JSON.stringify(co.json));
  S.ref = co.json.checkout.reference;
  fake.complete(S.ref, 'success', 'bank_transfer'); // the bank transfer completes later
  await ageRow(S.ref);
  const created = await call('ada', 'POST', '/payments/reports', reportBody(S.ref));
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.report.status, 'pending');
  assert.equal(created.json.report.amountMinor, 20000);
  S.reportId = created.json.report.id;
  // still no access: a receipt never grants by itself
  assert.ok(!(await subOf('ada')));
  const mine = await call('ada', 'GET', '/payments/reports');
  assert.equal(mine.json.items[0].status, 'pending');
  const opts = await call('ada', 'GET', '/payments/report-options');
  assert.ok(opts.json.items.some((o) => o.reference === S.ref && o.planId === S.planId));
});

test('validation: bad reference, amount, method, a receipt that is not yours', async () => {
  assert.equal((await call('bola', 'POST', '/payments/reports', reportBody('no good!'))).json.code, 'BAD_REFERENCE');
  assert.equal((await call('bola', 'POST', '/payments/reports', reportBody('bnx-valid-1', { amount: '-5' }))).json.code, 'BAD_AMOUNT');
  assert.equal((await call('bola', 'POST', '/payments/reports', reportBody('bnx-valid-1', { method: 'cheque' }))).json.code, 'BAD_METHOD');
  assert.equal((await call('bola', 'POST', '/payments/reports', reportBody('bnx-valid-1'))).json.code, 'BAD_RECEIPT');
});

test('duplicate claims are blocked: another account, the same account, and a reference already credited', async () => {
  // Bola claims Ada's reference: it belongs to Ada's checkout
  const other = await call('bola', 'POST', '/payments/reports', reportBody(S.ref, { receiptKey: (await upload('bola')).json.key }));
  assert.equal(other.status, 409); assert.equal(other.json.code, 'REFERENCE_IN_USE');
  // Ada sends the same reference twice while the first is open
  const again = await call('ada', 'POST', '/payments/reports', reportBody(S.ref, { receiptKey: S.receiptKey }));
  assert.equal(again.status, 409); assert.equal(again.json.code, 'DUPLICATE_REFERENCE');
  // a reference that is an unknown one, reported twice by two accounts
  const k = (await upload('bola')).json.key;
  assert.equal((await call('chi', 'POST', '/payments/reports', reportBody('CHI-LOOSE-001', { receiptKey: (await upload('chi')).json.key, targetId: S.membershipId }))).status, 201);
  const dup = await call('bola', 'POST', '/payments/reports', reportBody('chi-loose-001', { receiptKey: k }));
  assert.equal(dup.status, 409); assert.equal(dup.json.code, 'DUPLICATE_REFERENCE');
});

test('admin queue: only admins; the Paystack check shows the real transaction', async () => {
  assert.equal((await call('ada', 'GET', '/admin/api/payment-reports')).status, 403);
  const q1 = await call('boss', 'GET', '/admin/api/payment-reports?status=pending');
  assert.equal(q1.status, 200);
  const row = q1.json.items.find((r) => r.id === S.reportId);
  assert.ok(row, 'the report is in the pending queue');
  assert.equal(row.reference, S.ref); assert.equal(row.amountMinor, 20000); assert.equal(row.userHandle, 'ada');
  const rc = await call('boss', 'GET', `/admin/api/payment-reports/${S.reportId}/receipt?format=json`);
  assert.equal(rc.status, 200); assert.match(rc.json.dataUrl, /^data:image\/png;base64,/);
  assert.equal((await call('ada', 'GET', `/admin/api/payment-reports/${S.reportId}/receipt?format=json`)).status, 403);
  const chk = await call('boss', 'POST', `/admin/api/payment-reports/${S.reportId}/check`);
  assert.equal(chk.status, 200, JSON.stringify(chk.json));
  const v = chk.json.verification;
  assert.equal(v.found, true); assert.equal(v.gatewayStatus, 'success'); assert.equal(v.paidMinor, 20000); assert.equal(v.paidCurrency, 'NGN');
  assert.equal(v.customerEmail, 'ada@example.com'); assert.equal(v.amountOk, true); assert.equal(v.alreadyCredited, false); assert.equal(v.knownHere, true);
});

test('approval through Paystack grants exactly once (webhook replays and second approvals do not extend)', async () => {
  const ap = await call('boss', 'POST', `/admin/api/payment-reports/${S.reportId}/approve`, { mode: 'paystack' });
  assert.equal(ap.status, 200, JSON.stringify(ap.json));
  assert.equal(ap.json.decision, 'paystack');
  assert.equal(ap.json.report.status, 'approved');
  const sub = await subOf('ada');
  assert.ok(sub && sub.status === 'active', 'access granted');
  assert.equal(sub.applied_payment_refs.filter((r) => r === S.ref).length, 1);
  const expires = new Date(sub.expires_at).getTime();
  // second approval and webhook replay do not grant again
  assert.equal((await call('boss', 'POST', `/admin/api/payment-reports/${S.reportId}/approve`, { mode: 'paystack' })).json.code, 'ALREADY_DECIDED');
  const wh = await webhook({ event: 'charge.success', data: { reference: S.ref } });
  assert.equal(wh.status, 200);
  const again = await settlePayment(env, S.ref);
  assert.equal(again.granted, false);
  const sub2 = await subOf('ada');
  assert.equal(new Date(sub2.expires_at).getTime(), expires, 'the period was not extended twice');
  assert.equal(sub2.applied_payment_refs.filter((r) => r === S.ref).length, 1);
  // a reference already credited cannot be reported again
  const reReport = await call('ada', 'POST', '/payments/reports', reportBody(S.ref, { receiptKey: S.receiptKey }));
  assert.equal(reReport.status, 409); assert.equal(reReport.json.code, 'ALREADY_CREDITED');
  // the membership got its conversations (Channel + Community) on the way in
  const m = await one(env, 'SELECT channel_id, community_id FROM memberships WHERE id = $1', [S.membershipId]);
  assert.ok(m.channel_id && m.community_id);
});

test('paid elsewhere: Paystack approval creates the checkout row and grants for Dayo', async () => {
  paidElsewhere('DAYO-TXN-0001', 20000, 'dayo@example.com');
  const rc = (await upload('dayo')).json.key;
  const r = await call('dayo', 'POST', '/payments/reports', reportBody('DAYO-TXN-0001', { receiptKey: rc }));
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const ap = await call('boss', 'POST', `/admin/api/payment-reports/${r.json.report.id}/approve`, { mode: 'paystack' });
  assert.equal(ap.status, 200, JSON.stringify(ap.json));
  assert.equal(ap.json.decision, 'paystack');
  assert.ok(await one(env, `SELECT 1 AS x FROM paystack_payments WHERE reference = 'DAYO-TXN-0001' AND status = 'success'`));
  assert.ok((await subOf('dayo')).status === 'active');
});

test('amount below the price is refused by Paystack approval, and a rejection can be reported again', async () => {
  paidElsewhere('EFE-TXN-0001', 10000, 'efe@example.com');
  const r = await call('efe', 'POST', '/payments/reports', reportBody('EFE-TXN-0001', { amount: '100', receiptKey: (await upload('efe')).json.key }));
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const ap = await call('boss', 'POST', `/admin/api/payment-reports/${r.json.report.id}/approve`, { mode: 'paystack' });
  assert.equal(ap.status, 409); assert.equal(ap.json.code, 'AMOUNT_MISMATCH');
  const short = await call('boss', 'POST', `/admin/api/payment-reports/${r.json.report.id}/reject`, { reason: 'x' });
  assert.equal(short.json.code, 'REASON_REQUIRED');
  const rej = await call('boss', 'POST', `/admin/api/payment-reports/${r.json.report.id}/reject`, { reason: 'Paystack shows ₦100 paid, not ₦200' });
  assert.equal(rej.status, 200); assert.equal(rej.json.report.status, 'rejected'); assert.match(rej.json.report.rejectReason, /100/);
  const mine = await call('efe', 'GET', '/payments/reports');
  assert.equal(mine.json.items[0].status, 'rejected');
  // rejected claims do not block a corrected one
  const fixed = await call('efe', 'POST', '/payments/reports', reportBody('EFE-TXN-0001', { amount: '100', receiptKey: (await upload('efe')).json.key, planId: S.planId }));
  assert.equal(fixed.status, 201);
});

test('manual grant: only for unknown or unsuccessful references, needs a reason and an expiry, and is audit-logged', async () => {
  // Chi's reference is unknown to Paystack
  const r = await call('chi', 'POST', '/payments/reports', reportBody('CHI-UNKNOWN-9', { receiptKey: (await upload('chi')).json.key }));
  assert.equal(r.status, 201, JSON.stringify(r.json));
  S.chiReport = r.json.report.id;
  const notSuccess = await call('boss', 'POST', `/admin/api/payment-reports/${S.chiReport}/approve`, { mode: 'paystack' });
  assert.equal(notSuccess.status, 409); assert.equal(notSuccess.json.code, 'NOT_SUCCESSFUL');
  const noReason = await call('boss', 'POST', `/admin/api/payment-reports/${S.chiReport}/approve`, { mode: 'manual', reason: 'short', expiresAt: new Date(Date.now() + 864e5).toISOString() });
  assert.equal(noReason.json.code, 'REASON_REQUIRED');
  const past = await call('boss', 'POST', `/admin/api/payment-reports/${S.chiReport}/approve`, { mode: 'manual', reason: 'Bank statement shows the transfer', expiresAt: '2001-01-01' });
  assert.equal(past.json.code, 'BAD_EXPIRY');
  const expiry = new Date(Date.now() + 30 * 864e5).toISOString();
  const ok = await call('boss', 'POST', `/admin/api/payment-reports/${S.chiReport}/approve`, { mode: 'manual', reason: 'Bank statement shows the transfer', expiresAt: expiry });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.decision, 'manual');
  const sub = await subOf('chi');
  assert.equal(sub.source, 'admin_grant'); assert.equal(sub.granted_by, ids.boss);
  assert.equal(new Date(sub.expires_at).toISOString(), expiry);
  const log = await one(env, `SELECT count(*)::int AS n FROM admin_actions WHERE action = 'membership_grant' AND target_id = $1`, [S.membershipId]);
  assert.ok(log.n >= 1, 'manual grant is audit-logged');
  // a manual grant is refused when Paystack says the payment succeeded
  paidElsewhere('CHI-SUCCESS-2', 20000);
  const r2 = await call('chi', 'POST', '/payments/reports', reportBody('CHI-SUCCESS-2', { receiptKey: (await upload('chi')).json.key }));
  const refused = await call('boss', 'POST', `/admin/api/payment-reports/${r2.json.report.id}/approve`, { mode: 'manual', reason: 'Trying a manual route here', expiresAt: expiry });
  assert.equal(refused.status, 409); assert.equal(refused.json.code, 'USE_PAYSTACK_APPROVAL');
});

test('manual membership grant form: by @handle, plan must belong to the membership, expiry required', async () => {
  const expiry = new Date(Date.now() + 10 * 864e5).toISOString();
  const bad = await call('boss', 'POST', '/admin/api/membership-grants', { handle: 'ada', membershipId: S.membershipId, planId: '00000000-0000-4000-8000-000000000000', expiresAt: expiry, reason: 'Support request, reviewed' });
  assert.equal(bad.status, 400);
  const noExp = await call('boss', 'POST', '/admin/api/membership-grants', { handle: 'ada', membershipId: S.membershipId, planId: S.planId, reason: 'Support request, reviewed' });
  assert.equal(noExp.json.code, 'BAD_EXPIRY');
  const ok = await call('boss', 'POST', '/admin/api/membership-grants', { handle: '@ada', membershipId: S.membershipId, planId: S.planId, expiresAt: expiry, reason: 'Support request, reviewed' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal((await subOf('ada')).source, 'admin_grant');
});

test('membership invitation links: verified payer only, single-use, bound to one user, expiring, revocable', async () => {
  // Chi is verified (manual approval), Bola is not
  const notVerified = await call('boss', 'POST', '/admin/api/membership-invites', { membershipId: S.membershipId, planId: S.planId, userId: ids.bola });
  assert.equal(notVerified.json.code, 'NOT_VERIFIED_PAYER');
  const bound = await call('boss', 'POST', '/admin/api/membership-invites', { membershipId: S.membershipId, planId: S.planId, userId: ids.chi, expiresInHours: 24 });
  assert.equal(bound.status, 201, JSON.stringify(bound.json));
  const tokenChi = bound.json.link.split('/membership-invite/')[1];
  assert.ok(tokenChi && tokenChi.length >= 40);
  // the landing page opens the app
  const page = await call(null, 'GET', `/membership-invite/${tokenChi}`);
  assert.equal(page.status, 200); assert.match(page.json, /biblenestra:\/\/membership-invite\?token=/);
  // not for someone else
  assert.equal((await call('ada', 'POST', `/membership-invites/${tokenChi}/accept`)).json.code, 'NOT_FOR_YOU');
  const pv = await call('ada', 'GET', `/membership-invites/${tokenChi}/preview`);
  assert.equal(pv.json.forThisAccount, false); assert.equal(pv.json.usable, false);
  // Chi accepts: admitted once
  const acc = await call('chi', 'POST', `/membership-invites/${tokenChi}/accept`);
  assert.equal(acc.status, 200, JSON.stringify(acc.json));
  assert.equal(acc.json.status, 'member');
  assert.equal((await subOf('chi')).status, 'active');
  assert.equal((await call('chi', 'POST', `/membership-invites/${tokenChi}/accept`)).status, 410);
  assert.equal((await call(null, 'GET', `/membership-invite/${tokenChi}`)).status, 200);
  // an unbound link needs a verified payment on the accepting account
  const open = await call('boss', 'POST', '/admin/api/membership-invites', { membershipId: S.membershipId, planId: S.planId, expiresInHours: 48 });
  const tokenOpen = open.json.link.split('/membership-invite/')[1];
  assert.equal((await call('bola', 'POST', `/membership-invites/${tokenOpen}/accept`)).json.code, 'NOT_VERIFIED');
  assert.equal((await call('dayo', 'POST', `/membership-invites/${tokenOpen}/accept`)).status, 200); // Dayo is verified (paid elsewhere)
  // a revoked link cannot be used
  const rv = await call('boss', 'POST', '/admin/api/membership-invites', { membershipId: S.membershipId, planId: S.planId, expiresInHours: 48 });
  const rvId = rv.json.invite.id; const tokenRv = rv.json.link.split('/membership-invite/')[1];
  assert.equal((await call('boss', 'POST', `/admin/api/membership-invites/${rvId}/revoke`)).status, 200);
  assert.equal((await call('dayo', 'POST', `/membership-invites/${tokenRv}/accept`)).status, 410);
  // an expired link cannot be used
  const ex = await call('boss', 'POST', '/admin/api/membership-invites', { membershipId: S.membershipId, planId: S.planId, expiresInHours: 1 });
  await q(env, `UPDATE membership_invite_links SET expires_at = now() - interval '1 minute' WHERE id = $1`, [ex.json.invite.id]);
  assert.equal((await call('dayo', 'POST', `/membership-invites/${ex.json.link.split('/membership-invite/')[1]}/accept`)).status, 410);
  // invite admin is for admins only
  assert.equal((await call('ada', 'POST', '/admin/api/membership-invites', { membershipId: S.membershipId, planId: S.planId })).status, 403);
});

test('reconciliation: stubbed Paystack grants what succeeded, never twice, and respects the per-run cap', async () => {
  // three unfinished rows for Bola, all 10 minutes old
  const refs = ['bnw-recon-aaaa0001', 'bnw-recon-bbbb0002', 'bnw-recon-cccc0003'];
  for (const ref of refs) {
    await q(env, `INSERT INTO paystack_payments (reference, user_id, kind, target_id, amount_minor, currency, email, test, payload, created_at, updated_at)
      VALUES ($1,$2,'membership',$3,20000,'NGN','bola@example.com',true,$4::jsonb, now() - interval '10 minutes', now() - interval '10 minutes')`,
    [ref, ids.bola, S.membershipId, JSON.stringify({ title: 'Pay Verify Club', planId: S.planId, answers: [], contact: {}, promoCode: null, promoId: null })]);
  }
  const calls = [];
  const stubFetch = async (method, path, payload) => {
    calls.push(path);
    const ref = decodeURIComponent(path.split('/').pop());
    if (ref === 'bnw-recon-bbbb0002') return { status: 'abandoned', amount: 20000, currency: 'NGN', reference: ref, customer: { email: 'bola@example.com' } };
    if (ref.startsWith('bnw-recon-')) return { status: 'success', amount: 20000, currency: 'NGN', reference: ref, channel: 'bank_transfer', paid_at: new Date().toISOString(), customer: { email: 'bola@example.com' } };
    throw new Error('unexpected ' + path);
  };
  const stubEnv = { ...env, __paystackFetch: stubFetch };
  // cap: at most 2 Paystack calls in one run
  const first = await reconcilePaystack(stubEnv, { limit: 2 });
  assert.equal(first.checked, 2);
  assert.ok(calls.length <= 2, 'API calls are capped');
  // run until nothing is left unfinished; every succeeded row is granted exactly once
  for (let i = 0; i < 5; i++) await reconcilePaystack(stubEnv, { limit: 5 });
  for (const ref of refs.filter((r) => r !== 'bnw-recon-bbbb0002')) {
    assert.equal((await one(env, 'SELECT status FROM paystack_payments WHERE reference = $1', [ref])).status, 'success', ref);
  }
  // Paystack says abandoned, but the row is under 30 minutes old: it stays pending and is re-checked next run
  assert.equal((await one(env, 'SELECT status FROM paystack_payments WHERE reference = $1', ['bnw-recon-bbbb0002'])).status, 'pending');
  const sub = await subOf('bola');
  assert.equal(sub.applied_payment_refs.filter((r) => r.startsWith('bnw-recon-')).length, 2, 'two successes applied, once each');
  // a finished row is no longer picked up
  const before = calls.length;
  const after = await reconcilePaystack(stubEnv, { limit: 10 });
  assert.equal(after.checked, 1); // only the abandoned one is still unfinished
  assert.equal(calls.length, before + 1);
  // with no Paystack configured the job does nothing
  assert.deepEqual(await reconcilePaystack({ ...env, __paystackFetch: undefined, PAYSTACK_SECRET_KEY: '' }), { checked: 0, granted: 0, failed: 0 });
});
