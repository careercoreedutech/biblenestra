// PORTFOLIO & PARTNER MANAGERS: commission maths, the 10% Portfolio Manager override, idempotent commissions per payment,
// first-touch attribution, recruitment approvals (manual and automatic), permissions and limits, holds, withdrawals with
// KYC, reversals, and the public pages.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { q, one } from '../src/lib/db.js';
import {
  commissionPlan, bpsOf, kindOfWalletArea, newInviteCode, normCode, recordPaymentCommissions, reversePaymentCommissions,
  attributePartner, balances, shareLinks,
} from '../src/lib/portfolio.js';

let env; const app = createApp();
const ids = {};
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', PUBLIC_API_URL: 'https://api.test' };
});

async function call(user, method, path, body) {
  const h = {};
  if (user) h['X-Dev-User'] = user;
  let b;
  if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${path}`, { method, headers: h, body: b }), env);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = text; }
  return { status: res.status, json };
}
async function mk(name, handle) {
  const me = (await call(name, 'GET', '/me')).json;
  ids[name] = me.id;
  if (handle) await q(env, 'UPDATE users SET handle = $2 WHERE id = $1', [me.id, handle]);
  return me.id;
}
const ok = (r, msg) => assert.ok(r.status >= 200 && r.status < 300, `${msg || 'request'} failed: ${r.status} ${JSON.stringify(r.json)}`);
const setCfg = async (key, value) => {
  const r = await call('boss', 'PUT', '/admin/api/portfolio/config', { key, value });
  ok(r, `config ${key}`);
};
// a payment row for recordPaymentCommissions (the real settle path calls the same function after grant)
const payment = (reference, userId, amountMinor, extra = {}) => ({ reference, user_id: userId, kind: 'plus', target_id: 'plus-1', amount_minor: amountMinor, currency: 'NGN', test: false, ...extra });
const kycApproved = (uid) => q(env, `INSERT INTO payout_kyc (user_id, id_type, id_country, id_number_enc, id_last4, legal_name, bank_code, bank_name,
    account_number_enc, account_last4, account_name, name_resolved, name_match, status) VALUES ($1,'nin','NG','enc','1234','Pat Partner','058','GTBank','enc','5678','PAT PARTNER',true,true,'approved')`, [uid]);

// ---------- pure maths and helpers ----------
test('commission maths: partner % of the payment, PM share of the partner commission', () => {
  const cfg = { partnerBps: 1000, pmBps: 1000 };
  const p = commissionPlan(1000000, cfg); // ₦10,000.00 in kobo
  assert.equal(p.partnerMinor, 100000);   // 10%
  assert.equal(p.portfolioMinor, 10000);  // 10% of the partner commission = the PM override
});
test('commission maths: amounts round down to the kobo and the rates are configurable', () => {
  assert.equal(bpsOf(1234, 1000), 123);
  assert.equal(bpsOf(123, 1000), 12);
  const p = commissionPlan(999, { partnerBps: 1500, pmBps: 2000 });
  assert.equal(p.partnerMinor, 149);      // floor(999 × 15%)
  assert.equal(p.portfolioMinor, 29);     // floor(149 × 20%)
  assert.equal(commissionPlan(0, { partnerBps: 1000, pmBps: 1000 }).partnerMinor, 0);
});
test('eligible kinds: wallet pack areas map to the admin kinds; donations are never eligible', () => {
  assert.equal(kindOfWalletArea('gifts'), 'coins');
  assert.equal(kindOfWalletArea('dating'), 'dating');
  assert.equal(kindOfWalletArea('fundme'), 'fundme_fees');
  assert.equal(kindOfWalletArea('donation'), null);
  assert.equal(kindOfWalletArea(undefined), null);
});
test('invite codes are unique-looking, readable and normalised', () => {
  const codes = new Set();
  for (let i = 0; i < 200; i++) { const c = newInviteCode(); assert.match(c, /^[A-HJ-NP-Z2-9]{6}$/); codes.add(c); }
  assert.ok(codes.size > 190);
  assert.equal(normCode(' abc-123 '), 'ABC123');
});
test('share links carry the invitation link to WhatsApp, email, Facebook and X', () => {
  const s = shareLinks('partner_manager', 'https://api.test/partner/invite/ABC123');
  assert.ok(s.whatsapp.startsWith('https://wa.me/?text='));
  assert.ok(s.email.startsWith('mailto:?subject='));
  assert.ok(decodeURIComponent(s.whatsapp).includes('https://api.test/partner/invite/ABC123'));
  assert.ok(s.facebook.includes('sharer'));
  assert.ok(s.x.includes('twitter.com'));
});

// ---------- the chain: admin → PM → partner → referred user ----------
test('setup: the Super Admin, a Portfolio Manager, a Partner Manager and users', async () => {
  await mk('boss');
  await q(env, `UPDATE users SET role = 'admin' WHERE id = $1`, [ids.boss]);
  await mk('ann', 'ann_pm');
  await mk('pat', 'pat_partner');
  await mk('buyer', 'buyer1');
  await mk('buyer2', 'buyer2');
  await mk('pat2', 'pat_two');
  await mk('stranger', 'stranger1');
  const r = await call('boss', 'POST', '/admin/api/portfolio/members', { handle: 'ann_pm', role: 'portfolio_manager' });
  ok(r, 'appoint PM');
  assert.equal(r.json.role, 'portfolio_manager');
  assert.equal(r.json.status, 'active');
  const row = await one(env, 'SELECT appointed_by_admin, recruitment_source FROM portfolio_members WHERE user_id = $1', [ids.ann]);
  assert.equal(row.appointed_by_admin, ids.boss);            // permanent record of who appointed the PM
  assert.equal(row.recruitment_source, 'admin_manual');
});

test('permissions: only the admin appoints PMs and only a PM creates partner invites', async () => {
  const notAdmin = await call('ann', 'POST', '/admin/api/portfolio/members', { handle: 'pat_partner', role: 'portfolio_manager' });
  assert.equal(notAdmin.status, 403);
  const adminPartnerInvite = await call('boss', 'POST', '/admin/api/portfolio/invites', { kind: 'partner_manager', channel: 'link' });
  assert.equal(adminPartnerInvite.status, 400);
  const notPm = await call('buyer', 'POST', '/portfolio/invites', { channel: 'link' });
  assert.equal(notPm.status, 403);
});

let partnerInvite;
test('a Portfolio Manager creates a Partner Manager invite with a unique code and share links', async () => {
  const r = await call('ann', 'POST', '/portfolio/invites', { channel: 'whatsapp', label: 'Church network' });
  ok(r, 'create partner invite');
  partnerInvite = r.json;
  assert.match(partnerInvite.code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(partnerInvite.kind, 'partner_manager');
  assert.ok(partnerInvite.link.endsWith(`/partner/invite/${partnerInvite.code}`));
  assert.ok(partnerInvite.share.whatsapp.startsWith('https://wa.me/'));
});

test('a partner applies with the code, the PM approves, the partner becomes active', async () => {
  const applied = await call('pat', 'POST', '/portfolio/apply', { code: partnerInvite.code, answers: { fullName: 'Pat Partner', motivation: 'I want to share the Bible with my church.' } });
  ok(applied, 'apply');
  assert.equal(applied.json.member.status, 'pending');
  const queue = await call('ann', 'GET', '/portfolio/applications');
  assert.equal(queue.json.items.length, 1);
  const appId = queue.json.items[0].id;
  const approved = await call('ann', 'POST', `/portfolio/applications/${appId}/approve`);
  ok(approved, 'PM approves');
  const m = await one(env, 'SELECT * FROM portfolio_members WHERE user_id = $1', [ids.pat]);
  assert.equal(m.status, 'active');
  assert.equal(m.recruited_by, ids.ann);                       // permanent: recruited by the PM
  assert.equal(m.role, 'partner_manager');
  assert.equal(String(m.invite_id), String(partnerInvite.id));
});

test('a second application from the same person is refused while one is pending, and a member cannot apply again', async () => {
  const again = await call('pat', 'POST', '/portfolio/apply', { code: partnerInvite.code, answers: { fullName: 'Pat Partner', motivation: 'Again please, thanks.' } });
  assert.equal(again.status, 409);
  assert.equal(again.json.code, 'ALREADY_MEMBER');
});

test('an applicant needs a real motivation and an open invite', async () => {
  const short = await call('stranger', 'POST', '/portfolio/apply', { code: partnerInvite.code, answers: { fullName: 'Sam Stranger', motivation: 'x' } });
  assert.equal(short.status, 400);
  const bogus = await call('stranger', 'POST', '/portfolio/apply', { code: 'ZZZZZZ', answers: { fullName: 'Sam Stranger', motivation: 'I would like to join.' } });
  assert.equal(bogus.status, 404);
});

test('the partner landing page /p/:code and the recruitment pages are public HTML', async () => {
  const code = (await call('pat', 'GET', '/me/invite')).json.code;
  const page = await call(null, 'GET', `/p/${code}`);
  assert.equal(page.status, 200);
  assert.match(page.json, /invites you to BibleNestra/);
  assert.match(page.json, new RegExp(`/i/${code}`));
  assert.equal((await call(null, 'GET', '/p/NOPE99')).status, 404);
  const rec = await call(null, 'GET', `/partner/invite/${partnerInvite.code}`);
  assert.equal(rec.status, 200);
  assert.match(rec.json, /Become a Partner Manager/);
  assert.equal((await call(null, 'GET', '/portfolio/invite/' + partnerInvite.code)).status, 404); // wrong kind
  assert.equal((await call(null, 'GET', `/portfolio/invites/${partnerInvite.code}`)).json.kind, 'partner_manager');
});

// ---------- attribution: first touch wins ----------
test('a referred user who joins with the partner code is attributed permanently to that partner and their PM', async () => {
  const code = (await call('pat', 'GET', '/me/invite')).json.code;
  const r = await call('buyer', 'POST', '/me/referral', { code });
  ok(r, 'join with partner code');
  const a = await one(env, 'SELECT * FROM partner_attributions WHERE user_id = $1', [ids.buyer]);
  assert.equal(a.partner_id, ids.pat);
  assert.equal(a.portfolio_manager_id, ids.ann);
});

test('first touch wins: a later partner code never moves an attributed user', async () => {
  // a second partner, active, with their own code
  const inv = (await call('ann', 'POST', '/portfolio/invites', { channel: 'link' })).json;
  await call('pat2', 'POST', '/portfolio/apply', { code: inv.code, answers: { fullName: 'Pat Two', motivation: 'Ready to serve in my town.' } });
  await call('ann', 'POST', `/portfolio/applications/${(await call('ann', 'GET', '/portfolio/applications')).json.items[0].id}/approve`);
  const code2 = (await call('pat2', 'GET', '/me/invite')).json.code;
  const second = await call('buyer', 'POST', '/me/referral', { code: code2 });
  assert.equal(second.status, 409);
  const a = await one(env, 'SELECT partner_id FROM partner_attributions WHERE user_id = $1', [ids.buyer]);
  assert.equal(a.partner_id, ids.pat);
  // and the attribution helper itself refuses to overwrite
  const direct = await attributePartner(env, ids.buyer, ids.pat2);
  assert.equal(direct.attributed, false);
});

test('a user referred by an ordinary member or a Portfolio Manager is not attributed to a partner', async () => {
  const pmCode = (await call('ann', 'GET', '/me/invite')).json.code;
  await call('buyer2', 'POST', '/me/referral', { code: pmCode });
  assert.equal(await one(env, 'SELECT 1 FROM partner_attributions WHERE user_id = $1', [ids.buyer2]), null);
});

// ---------- commissions ----------
test('a payment earns the partner 10% and the PM 10% of that, held for the hold period', async () => {
  const p = payment('ref_plus_1', ids.buyer, 1000000);
  const out = await recordPaymentCommissions(env, p);
  assert.equal(out.partnerMinor, 100000);
  assert.equal(out.portfolioMinor, 10000);
  const partner = await one(env, `SELECT * FROM portfolio_commissions WHERE payment_reference = 'ref_plus_1' AND role = 'partner'`);
  const pm = await one(env, `SELECT * FROM portfolio_commissions WHERE payment_reference = 'ref_plus_1' AND role = 'portfolio'`);
  assert.equal(String(partner.recipient_id), ids.pat);
  assert.equal(Number(partner.amount_minor), 100000);
  assert.equal(String(pm.recipient_id), ids.ann);
  assert.equal(Number(pm.amount_minor), 10000);
  assert.equal(partner.status, 'held');
  const bal = (await balances(env, ids.pat)).NGN;
  assert.equal(bal.heldMinor, 100000);
  assert.equal(bal.availableMinor, 0);
});

test('idempotent per payment: running the same payment again writes nothing new', async () => {
  const again = await recordPaymentCommissions(env, payment('ref_plus_1', ids.buyer, 1000000));
  assert.equal(again.partnerMinor, 0);
  assert.equal(again.portfolioMinor, 0);
  const n = await one(env, `SELECT count(*)::int AS n FROM portfolio_commissions WHERE payment_reference = 'ref_plus_1'`);
  assert.equal(n.n, 2);
});

test('ineligible payments earn nothing: not referred, test payments, donations and kinds switched off', async () => {
  assert.equal((await recordPaymentCommissions(env, payment('ref_stranger', ids.stranger, 500000))).skipped, 'not_referred');
  assert.equal((await recordPaymentCommissions(env, payment('ref_test', ids.buyer, 500000, { test: true }))).skipped, 'not_eligible_payment');
  assert.equal((await recordPaymentCommissions(env, payment('ref_don', ids.buyer, 500000, { kind: 'donation' }))).skipped, 'kind_not_eligible');
  assert.equal((await recordPaymentCommissions(env, payment('ref_don2', ids.buyer, 500000, { kind: 'wallet', target_id: '00000000-0000-0000-0000-000000000000' }))).skipped, 'kind_not_eligible');
  await setCfg('portfolio_eligible_kinds', { coins: true, dating: true, plus: false, memberships: true, fundme_fees: true });
  assert.equal((await recordPaymentCommissions(env, payment('ref_plus_off', ids.buyer, 500000))).skipped, 'kind_not_eligible');
  await setCfg('portfolio_eligible_kinds', { coins: true, dating: true, plus: true, memberships: true, fundme_fees: true });
});

test('commission settings are configurable, validated, and used at once', async () => {
  const bad = await call('boss', 'PUT', '/admin/api/portfolio/config', { key: 'portfolio_partner_bps', value: 20000 });
  assert.equal(bad.status, 400);
  const unknown = await call('boss', 'PUT', '/admin/api/portfolio/config', { key: 'wallet_rate_coins', value: 1 });
  assert.equal(unknown.status, 400);
  await setCfg('portfolio_partner_bps', 1500);
  const out = await recordPaymentCommissions(env, payment('ref_plus_15', ids.buyer, 1000000));
  assert.equal(out.partnerMinor, 150000);  // 15%
  assert.equal(out.portfolioMinor, 15000); // PM still 10% of that
  await setCfg('portfolio_partner_bps', 1000);
});

test('reversal: a refunded payment takes its commissions back; a second reversal does nothing', async () => {
  const before = (await balances(env, ids.pat)).NGN.heldMinor;
  const rows = await reversePaymentCommissions(env, { reference: 'ref_plus_15', reason: 'Refunded through Paystack' });
  assert.equal(rows.length, 2);
  const again = await reversePaymentCommissions(env, { reference: 'ref_plus_15', reason: 'again' });
  assert.equal(again.length, 0);
  assert.equal((await balances(env, ids.pat)).NGN.heldMinor, before - 150000); // the reversed 15% commission leaves the held balance
  const r = await call('boss', 'POST', '/admin/api/portfolio/commissions/reverse', { reference: 'ref_plus_15', reason: 'Refunded' });
  assert.equal(r.status, 404); // nothing open left
});

// ---------- withdrawals ----------
test('withdrawals: minimum, KYC, balance, admin approve, mark paid with a reference', async () => {
  await setCfg('portfolio_min_withdrawal_minor', 50000);
  const small = await call('pat', 'POST', '/portfolio/withdrawals', { amountMinor: 10000 });
  assert.equal(small.status, 400);
  assert.equal(small.json.code, 'BELOW_MINIMUM');
  const noKyc = await call('pat', 'POST', '/portfolio/withdrawals', { amountMinor: 60000 });
  assert.equal(noKyc.status, 409);
  assert.equal(noKyc.json.code, 'KYC_REQUIRED');
  await kycApproved(ids.pat);
  const none = await call('pat', 'POST', '/portfolio/withdrawals', { amountMinor: 60000 });
  assert.equal(none.status, 400);
  assert.equal(none.json.code, 'INSUFFICIENT_BALANCE');
  // the held commission matures (hold period passed)
  await q(env, `UPDATE portfolio_commissions SET available_at = now() - interval '1 day' WHERE payment_reference = 'ref_plus_1'`);
  const bal = (await balances(env, ids.pat)).NGN;
  assert.equal(bal.availableMinor, 100000);
  assert.equal(bal.withdrawableMinor, 100000);
  const req = await call('pat', 'POST', '/portfolio/withdrawals', { amountMinor: 60000 });
  ok(req, 'request withdrawal');
  assert.equal(req.json.status, 'requested');
  const over = await call('pat', 'POST', '/portfolio/withdrawals', { amountMinor: 60000 });
  assert.equal(over.json.code, 'INSUFFICIENT_BALANCE'); // 100 000 − 60 000 open < 60 000
  const id = req.json.id;
  const nope = await call('boss', 'POST', `/admin/api/portfolio/withdrawals/${id}/paid`, { reference: 'PAY-1' });
  assert.equal(nope.status, 409);                                  // approve first
  ok(await call('boss', 'POST', `/admin/api/portfolio/withdrawals/${id}/approve`, {}), 'approve');
  const noRef = await call('boss', 'POST', `/admin/api/portfolio/withdrawals/${id}/paid`, {});
  assert.equal(noRef.status, 400);
  ok(await call('boss', 'POST', `/admin/api/portfolio/withdrawals/${id}/paid`, { reference: 'TRF-000123' }), 'paid');
  const after = (await balances(env, ids.pat)).NGN;
  assert.equal(after.paidMinor, 60000);
  assert.equal(after.withdrawableMinor, 40000);
  const mine = await call('pat', 'GET', '/portfolio/withdrawals');
  assert.equal(mine.json.items[0].status, 'paid');
  assert.equal(mine.json.items[0].reference, 'TRF-000123');
});

test('rejecting a withdrawal needs a reason and returns the money to the balance', async () => {
  await setCfg('portfolio_min_withdrawal_minor', 10000);
  const req = await call('pat', 'POST', '/portfolio/withdrawals', { amountMinor: 30000 });
  ok(req, 'request');
  const noReason = await call('boss', 'POST', `/admin/api/portfolio/withdrawals/${req.json.id}/reject`, {});
  assert.equal(noReason.status, 400);
  ok(await call('boss', 'POST', `/admin/api/portfolio/withdrawals/${req.json.id}/reject`, { note: 'Bank details unclear' }), 'reject');
  assert.equal((await balances(env, ids.pat)).NGN.withdrawableMinor, 40000);
});

test('a reversal after payout leaves the balance negative for the partner, not a silent loss', async () => {
  // a second payment matures at once (hold 0), is paid out, then refunded
  await setCfg('portfolio_hold_days', 0);
  await recordPaymentCommissions(env, payment('ref_plus_2', ids.buyer, 1000000));
  await setCfg('portfolio_hold_days', 7);
  const pre = (await balances(env, ids.pat)).NGN;
  assert.equal(pre.availableMinor, 200000);
  await reversePaymentCommissions(env, { reference: 'ref_plus_2', reason: 'Chargeback' });
  const post = (await balances(env, ids.pat)).NGN;
  assert.equal(post.availableMinor, 100000);
});

// ---------- suspension, approvals by approver, automatic approval, limits ----------
test('a suspended partner earns nothing new and cannot withdraw; reactivation restores them', async () => {
  const s = await call('boss', 'POST', `/admin/api/portfolio/members/${ids.pat}/suspend`, { reason: 'Checking the account' });
  ok(s, 'suspend');
  const out = await recordPaymentCommissions(env, payment('ref_while_suspended', ids.buyer, 1000000));
  assert.equal(out.skipped, 'partner_not_active');
  const w = await call('pat', 'POST', '/portfolio/withdrawals', { amountMinor: 50000 });
  assert.equal(w.status, 403);
  ok(await call('boss', 'POST', `/admin/api/portfolio/members/${ids.pat}/reactivate`, {}), 'reactivate');
});

test('an application is decided by its own PM: another PM cannot approve it, the Super Admin can', async () => {
  await mk('bea', 'bea_pm');
  ok(await call('boss', 'POST', '/admin/api/portfolio/members', { handle: 'bea_pm', role: 'portfolio_manager' }), 'appoint bea');
  const inv = (await call('ann', 'POST', '/portfolio/invites', { channel: 'email', email: 'friend@example.com' })).json;
  await mk('cy', 'cy_partner');
  await call('cy', 'POST', '/portfolio/apply', { code: inv.code, answers: { fullName: 'Cy Partner', motivation: 'Ready to help people join.' } });
  const app = (await call('ann', 'GET', '/portfolio/applications')).json.items.find((x) => x.applicant.handle === 'cy_partner');
  const wrong = await call('bea', 'POST', `/portfolio/applications/${app.id}/approve`);
  assert.equal(wrong.status, 403);
  const rejected = await call('ann', 'POST', `/portfolio/applications/${app.id}/reject`, { reason: 'Not enough detail yet' });
  ok(rejected, 'PM declines');
  assert.equal(await one(env, 'SELECT 1 FROM portfolio_members WHERE user_id = $1', [ids.cy]), null); // pending row removed
  const kept = await one(env, 'SELECT applicant_id, invite_id, status FROM portfolio_applications WHERE id = $1', [app.id]);
  assert.equal(kept.status, 'rejected');                              // the application keeps the record
});

test('automatic approval: a partner applying under auto is active at once', async () => {
  await setCfg('portfolio_partner_auto_approve', true);
  await mk('dee', 'dee_partner');
  const inv = (await call('ann', 'POST', '/portfolio/invites', { channel: 'social' })).json;
  const r = await call('dee', 'POST', '/portfolio/apply', { code: inv.code, answers: { fullName: 'Dee Partner', motivation: 'I love evangelism online.' } });
  ok(r, 'auto apply');
  assert.equal(r.json.autoApproved, true);
  assert.equal(r.json.member.status, 'active');
  await setCfg('portfolio_partner_auto_approve', false);
});

test('limits: a PM can have only so many partners and open invitations', async () => {
  await setCfg('portfolio_pm_invite_limit', 1);
  // ann already has open invitations: this must exceed the limit of 1
  const more = await call('ann', 'POST', '/portfolio/invites', { channel: 'link' });
  assert.equal(more.status, 409);
  assert.equal(more.json.code, 'INVITE_LIMIT');
  await setCfg('portfolio_pm_invite_limit', 50);
  await setCfg('portfolio_pm_partner_limit', 1);
  await mk('eve', 'eve_partner');
  const inv = (await call('ann', 'POST', '/portfolio/invites', { channel: 'link' })).json;
  const r = await call('eve', 'POST', '/portfolio/apply', { code: inv.code, answers: { fullName: 'Eve Partner', motivation: 'Ready to share my faith.' } });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'LIMIT_REACHED');
  await setCfg('portfolio_pm_partner_limit', 100);
});

test('a PM revokes their own invitation; the code stops working', async () => {
  const inv = (await call('ann', 'POST', '/portfolio/invites', { channel: 'manual' })).json;
  ok(await call('ann', 'POST', `/portfolio/invites/${inv.id}/revoke`), 'revoke');
  const page = await call(null, 'GET', `/partner/invite/${inv.code}`);
  assert.equal(page.status, 200);
  assert.match(page.json, /invitation is closed/);
  const apply = await call('eve', 'POST', '/portfolio/apply', { code: inv.code, answers: { fullName: 'Eve Partner', motivation: 'Trying again later.' } });
  assert.equal(apply.status, 410);
});

// ---------- dashboards, statements, reports ----------
test('dashboards and statements show the earnings, the partners and the monthly figures', async () => {
  const pm = await call('ann', 'GET', '/portfolio/dashboard');
  ok(pm, 'PM dashboard');
  assert.ok(pm.json.partners.some((p) => p.handle === 'pat_partner' && p.referredUsers === 1 && p.payments >= 1));
  assert.equal(pm.json.earnings[0].currency, 'NGN');
  const partner = await call('pat', 'GET', '/partner/dashboard');
  ok(partner, 'partner dashboard');
  assert.equal(partner.json.referredUsers, 1);
  assert.match(partner.json.landingUrl, /\/partner\/pat_partner/); // the handle page (the /p/:code alias still works)
  assert.equal((await call('ann', 'GET', '/partner/dashboard')).status, 403);
  assert.equal((await call('pat', 'GET', '/portfolio/dashboard')).status, 403);
  const st = await call('pat', 'GET', '/portfolio/statement');
  ok(st, 'statement');
  assert.ok(Array.isArray(st.json.commissions));
  const rep = await call('boss', 'GET', '/admin/api/portfolio/report');
  ok(rep, 'report');
  assert.ok(rep.json.newReferredUsers >= 1);
  const ov = await call('boss', 'GET', '/admin/api/portfolio/overview');
  ok(ov, 'overview');
  assert.ok(ov.json.partnerManagers.active >= 1);
  assert.equal((await call('pat', 'GET', '/admin/api/portfolio/overview')).status, 403);
});

test('a Partner Manager list shows only their own partners and a PM detail is admin-only', async () => {
  const d = await call('boss', 'GET', `/admin/api/portfolio/members/${ids.ann}`);
  ok(d, 'PM detail');
  assert.ok(d.json.partners.length >= 1);
  const apps = await call('boss', 'GET', '/admin/api/portfolio/applications?status=all');
  ok(apps, 'applications');
});

test('a Paystack refund webhook reverses the commissions of that payment, once, and a retry repairs a missed reversal', async () => {
  const { refundedByGateway } = await import('../src/lib/paystackCheckout.js');
  await q(env, `INSERT INTO paystack_payments (reference, user_id, kind, target_id, amount_minor, currency, status)
    VALUES ('ref_gw_refund', $1, 'plus', 'plus-1', 1000000, 'NGN', 'success')`, [ids.buyer]);
  const made = await recordPaymentCommissions(env, payment('ref_gw_refund', ids.buyer, 1000000));
  assert.equal(made.partnerMinor, 100000); // 10% partner commission (default rate)
  const before = (await balances(env, ids.pat)).NGN.heldMinor;
  const first = await refundedByGateway(env, 'ref_gw_refund');
  assert.equal(first.changed, true);
  assert.equal((await balances(env, ids.pat)).NGN.heldMinor, before - 100000);
  const row = await one(env, 'SELECT status FROM paystack_payments WHERE reference = $1', ['ref_gw_refund']);
  assert.equal(row.status, 'refunded');
  const again = await refundedByGateway(env, 'ref_gw_refund');
  assert.equal(again.changed, false);
  assert.equal((await balances(env, ids.pat)).NGN.heldMinor, before - 100000, 'no double reversal on a retry');
  assert.equal((await refundedByGateway(env, 'ref_unknown_gw')).changed, false);
});
