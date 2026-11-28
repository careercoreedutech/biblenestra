// PORTFOLIO MANAGER & PARTNER DASHBOARDS (round 3): the Partner Manager dashboard numbers from real data, the personal
// landing page by handle (/p/:code kept as an alias), tracked invitations, the membership override, creator_plan
// commissions, anti-abuse (self-referral by billing email, idempotent commissions), admin-only reassignment and the
// deactivate / reactivate actions.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { q, one } from '../src/lib/db.js';
import {
  membershipOverrideMinor, inviteStatus, recordPaymentCommissions, balances,
} from '../src/lib/portfolio.js';
import {
  networkStats, monthlySeries, saveLandingProfile, getLandingProfile, renderInviteMessage, shareText, creatorPlansForDisplay,
  bannerSvg, recordInvitation, invitationList, landingByHandle, networkMonitor,
} from '../src/lib/partnerStats.js';

let env; const app = createApp();
const ids = {};
const codes = {};
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
  return { status: res.status, json, type: res.headers.get('content-type') || '', text };
}
async function mk(name, handle) {
  const me = (await call(name, 'GET', '/me')).json;
  ids[name] = me.id;
  if (handle) await q(env, 'UPDATE users SET handle = $2 WHERE id = $1', [me.id, handle]);
  codes[name] = (await call(name, 'GET', '/me/invite')).json.code; // assigns the invite code on first use
  return me.id;
}
const ok = (r, msg) => assert.ok(r.status >= 200 && r.status < 300, `${msg || 'request'} failed: ${r.status} ${JSON.stringify(r.json)}`);

// A paid membership row owned by a creator (the owner is who the override and the 'creators' figures follow).
async function membershipFor(ownerId, slug) {
  const m = await one(env, `INSERT INTO memberships (slug, title, owner_id, status) VALUES ($1, 'Test group', $2, 'published') RETURNING id`, [slug, ownerId]);
  return m.id;
}
async function successPayment(reference, userId, kind, targetId, amountMinor) {
  await q(env, `INSERT INTO paystack_payments (reference, user_id, kind, target_id, amount_minor, currency, status, paid_at)
    VALUES ($1, $2, $3, $4, $5, 'NGN', 'success', now())`, [reference, userId, kind, String(targetId || ''), amountMinor]);
  return { reference, user_id: userId, kind, target_id: String(targetId || ''), amount_minor: amountMinor, currency: 'NGN', test: false };
}

// ---------- pure helpers ----------
test('membership override: BibleNestra take × the override %, rounded down to the kobo', () => {
  // take = the creator's plan withdrawal fee in parts per million: Free 0.5% = 5000 ppm, Standard 0.3% = 3000 ppm
  assert.deepEqual(membershipOverrideMinor(1000000, { takePpm: 5000, membershipCommissionBps: 2500 }), { takeMinor: 5000, amountMinor: 1250 });
  assert.deepEqual(membershipOverrideMinor(1000000, { takePpm: 3000, membershipCommissionBps: 2500 }), { takeMinor: 3000, amountMinor: 750 });
  assert.equal(membershipOverrideMinor(999, { takePpm: 10000, membershipCommissionBps: 1000 }).amountMinor, 0);
});

test('invitation status: open, used up, expired or revoked', () => {
  const now = Date.now();
  assert.equal(inviteStatus({ revoked: false, expires_at: null, max_uses: null, uses: 3 }, now), 'open');
  assert.equal(inviteStatus({ revoked: false, expires_at: null, max_uses: 2, uses: 2 }, now), 'used_up');
  assert.equal(inviteStatus({ revoked: false, expires_at: new Date(now - 1000).toISOString(), max_uses: null, uses: 0 }, now), 'expired');
  assert.equal(inviteStatus({ revoked: true, expires_at: null, max_uses: null, uses: 0 }, now), 'revoked');
});

test('message helpers: placeholders are filled, and the share text does not repeat the link', () => {
  const tpl = 'Hi {name}, join with my code {code}: {link}';
  assert.equal(renderInviteMessage(tpl, { name: 'Sam', code: 'ABC123', link: 'https://x.test/p' }), 'Hi Sam, join with my code ABC123: https://x.test/p');
  assert.equal(shareText(tpl, { name: 'Sam', code: 'ABC123' }), 'Hi Sam, join with my code ABC123:');
});

test('banner image is an SVG in the palette, and the partner name is escaped', () => {
  const svg = bannerSvg({ name: '<script>x</script>', code: 'ABC123', headline: 'invites you', accent: 'gold', link: 'https://x.test/i/ABC123' });
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('#F4D88C'));
  assert.ok(!svg.includes('<script>'));
  assert.ok(svg.includes('Code ABC123'));
});

// ---------- setup: admin → PM → partner → referred users ----------
test('setup: admin, two Portfolio Managers, a partner under Ann, and referred users', async () => {
  await mk('boss');
  await q(env, `UPDATE users SET role = 'admin' WHERE id = $1`, [ids.boss]);
  await mk('ann', 'ann_pm');
  await mk('ben', 'ben_pm');
  await mk('pat', 'pat_partner');
  await mk('pat2', 'pat_two');
  await mk('cara', 'cara_owner');
  await mk('buyer', 'buyer1');
  await mk('buyer2', 'buyer2');
  await mk('stranger', 'stranger1');
  ok(await call('boss', 'POST', '/admin/api/portfolio/members', { handle: 'ann_pm', role: 'portfolio_manager' }), 'appoint ann');
  ok(await call('boss', 'POST', '/admin/api/portfolio/members', { handle: 'ben_pm', role: 'portfolio_manager' }), 'appoint ben');
  ok(await call('boss', 'POST', '/admin/api/portfolio/members', { handle: 'pat_partner', role: 'partner_manager', recruitedBy: ids.ann }), 'appoint pat');
  ok(await call('boss', 'POST', '/admin/api/portfolio/members', { handle: 'pat_two', role: 'partner_manager', recruitedBy: ids.ann }), 'appoint pat2');
  // the referred users join with the partner's code (the existing referral flow attributes them)
  ok(await call('cara', 'POST', '/me/referral', { code: codes.pat }), 'cara joins pat');
  ok(await call('buyer', 'POST', '/me/referral', { code: codes.pat }), 'buyer joins pat');
  const att = await one(env, 'SELECT partner_id, portfolio_manager_id FROM partner_attributions WHERE user_id = $1', [ids.buyer]);
  assert.equal(String(att.partner_id), String(ids.pat));
  assert.equal(String(att.portfolio_manager_id), String(ids.ann));
});

// ---------- landing page ----------
test('the landing page by handle, the /p/:code alias, the banner, and /partner/dashboard are all served', async () => {
  const page = await call(null, 'GET', '/partner/pat_partner');
  assert.equal(page.status, 200);
  assert.match(page.text, /Pat/);
  assert.match(page.text, new RegExp(codes.pat));
  assert.equal((await call(null, 'GET', `/p/${codes.pat}`)).status, 200);
  assert.equal((await call(null, 'GET', '/partner/nobody_here')).status, 404);
  const banner = await call(null, 'GET', '/partner/pat_partner/banner.svg');
  assert.equal(banner.status, 200);
  assert.match(banner.type, /image\/svg\+xml/);
  assert.match(banner.text, new RegExp(codes.pat));
  // the signed-in dashboard path is not shadowed by the handle route
  assert.equal((await call('pat', 'GET', '/partner/dashboard')).status, 200);
  assert.equal((await one(env, 'SELECT count(*)::int AS n FROM partner_landing_views WHERE partner_id = $1', [ids.pat])).n >= 2, true);
});

test('landing handle lookup only finds an active Partner Manager', async () => {
  assert.ok(await landingByHandle(env, 'pat_partner'));
  assert.equal(await landingByHandle(env, 'buyer1'), null);
});

test('plans on the landing page come live from creator_plans (Standard $10.24, Premium $43.78, fee shown)', async () => {
  const plans = await creatorPlansForDisplay(env);
  assert.equal(plans.available, true);
  const std = plans.plans.find((p) => p.name === 'Standard');
  assert.equal(std.priceLabel, '$10.24 / month');
  assert.equal(std.feeLabel, '0.3% withdrawal fee');
  assert.equal(plans.plans.find((p) => p.name === 'Premium').priceLabel, '$43.78 / month');
});

// ---------- profile and invitations ----------
test('partner profile: photo must be https, the invite message must carry the link', async () => {
  await assert.rejects(() => saveLandingProfile(env, ids.pat, { photoUrl: 'http://insecure.test/a.png' }), (e) => e.code === 'BAD_PHOTO');
  await assert.rejects(() => saveLandingProfile(env, ids.pat, { inviteMessage: 'no link here' }), (e) => e.code === 'LINK_REQUIRED');
  const saved = await saveLandingProfile(env, ids.pat, { displayName: 'Pastor Pat', intro: 'Reading the Bible daily.', photoUrl: 'https://cdn.test/pat.jpg', inviteMessage: 'Join me: {link}' });
  assert.equal(saved.displayName, 'Pastor Pat');
  assert.equal(saved.photoUrl, 'https://cdn.test/pat.jpg');
  assert.equal((await getLandingProfile(env, ids.pat)).inviteMessage, 'Join me: {link}');
});

test('tracked invitations: a named invitation becomes successful when that person registers', async () => {
  const r = await call('pat', 'POST', '/partner/invitations', { channel: 'email', email: 'Friend@Example.com', name: 'Friend' });
  assert.equal(r.status, 201);
  assert.match(r.json.share.email, /^mailto:/);
  assert.equal((await call('pat', 'GET', '/partner/invitations')).json.items[0].status, 'pending');
  await mk('friend', 'friend_one');
  await q(env, `UPDATE users SET billing_email = 'friend@example.com' WHERE id = $1`, [ids.friend]);
  ok(await call('friend', 'POST', '/me/referral', { code: codes.pat }), 'friend joins pat');
  const list = (await call('pat', 'GET', '/partner/invitations')).json.items;
  assert.equal(list[0].status, 'registered');
});

test('email invitations need an address, and nobody can invite their own billing email', async () => {
  await assert.rejects(() => recordInvitation(env, { id: ids.pat }, { channel: 'email' }), (e) => e.code === 'EMAIL_REQUIRED');
  await q(env, `UPDATE users SET billing_email = 'pat@example.com' WHERE id = $1`, [ids.pat]);
  await assert.rejects(() => recordInvitation(env, { id: ids.pat }, { channel: 'email', email: 'pat@example.com' }), (e) => e.code === 'SELF_INVITE');
  const inv = await recordInvitation(env, { id: ids.pat }, { channel: 'whatsapp' });
  assert.equal(inv.status, 'pending');
  assert.ok((await invitationList(env, ids.pat)).length >= 2);
});

// ---------- anti-abuse ----------
test('no self-referral by the same billing email, even under a different account', async () => {
  await mk('twin', 'twin_one');
  await q(env, `UPDATE users SET billing_email = 'pat@example.com' WHERE id = $1`, [ids.twin]);
  ok(await call('twin', 'POST', '/me/referral', { code: codes.pat }), 'twin posts the code');
  assert.equal(await one(env, 'SELECT 1 AS x FROM partner_attributions WHERE user_id = $1', [ids.twin]), null);
});

// ---------- network numbers ----------
test('the partner dashboard counts registrations, creators, memberships and revenue from real rows', async () => {
  const mid = await membershipFor(ids.cara, 'cara-group');
  const before = await networkStats(env, ids.pat);
  assert.equal(before.registrations, 3);                    // cara, buyer, friend
  assert.equal(before.creatorsRecruited, 1);                // cara owns a membership
  assert.equal(before.activeCreators, 1);
  assert.equal(before.membershipsCreated, 1);
  // a referred user's paid membership subscription and a creator-plan payment count as revenue
  await successPayment('ref_sub_1', ids.buyer, 'membership', mid, 500000);
  await successPayment('ref_plan_1', ids.cara, 'creator_plan', null, 300000);
  await successPayment('ref_stranger_sub', ids.stranger, 'membership', mid, 999999);   // not referred: excluded
  const after = await networkStats(env, ids.pat);
  assert.deepEqual(after.revenue, [{ currency: 'NGN', amountMinor: 800000, payments: 2 }]);
  assert.ok(after.landingViews >= 2);
  assert.equal(after.conversion.visitToRegistration > 0, true);
  const res = await call('pat', 'GET', '/partner/dashboard');
  assert.equal(res.json.stats.registrations, 3);
  assert.equal(res.json.monthly.length, 12);
});

test('monthly analytics: twelve months, oldest first, with this month filled in', async () => {
  const months = await monthlySeries(env, ids.pat);
  assert.equal(months.length, 12);
  assert.ok(months[11].registrations >= 1);
  assert.ok(months[0].month < months[11].month);
});

// ---------- commissions: creator_plan kind, the membership override, idempotency, self-referral ----------
test('creator_plan payments are commissionable by default; a repeat never double-pays', async () => {
  const cfg = await call('boss', 'GET', '/admin/api/portfolio/config');
  assert.equal(cfg.json.eligibleKinds.creator_plan, true);
  const p = await successPayment('ref_comm_plan', ids.buyer, 'creator_plan', null, 1000000);
  const first = await recordPaymentCommissions(env, p);
  assert.equal(first.partnerMinor, 100000);     // 10% of the payment
  assert.equal(first.portfolioMinor, 10000);    // the PM's 10% of that
  const again = await recordPaymentCommissions(env, p);
  assert.equal(again.partnerMinor, 0);
  assert.equal(again.portfolioMinor, 0);
  const rows = await one(env, `SELECT count(*)::int AS n FROM portfolio_commissions WHERE payment_reference = 'ref_comm_plan'`);
  assert.equal(rows.n, 2);
});

test('membership override is off by default and then pays the partner of a referred creator', async () => {
  const mid = await one(env, `SELECT id FROM memberships WHERE slug = 'cara-group'`);
  const off = await recordPaymentCommissions(env, await successPayment('ref_mem_off', ids.buyer2, 'membership', mid.id, 500000));
  assert.ok(!off.membershipMinor);             // not referred and override off: nothing credited
  ok(await call('boss', 'PUT', '/admin/api/portfolio/config', { key: 'portfolio_membership_commission_bps', value: 2500 }), 'turn the override on');
  const p = await successPayment('ref_mem_on', ids.buyer2, 'membership', mid.id, 500000);
  const on = await recordPaymentCommissions(env, p);
  // Cara is on Free (0.5%): BibleNestra's take is 2,500 kobo of the 500,000 subscription; 25% of that is the commission
  assert.equal(on.membershipMinor, 625);
  const row = await one(env, `SELECT role, recipient_id, amount_minor FROM portfolio_commissions WHERE payment_reference = 'ref_mem_on' AND role = 'membership'`);
  assert.equal(String(row.recipient_id), String(ids.pat));
  assert.equal(Number(row.amount_minor), 625);
  assert.equal((await recordPaymentCommissions(env, p)).membershipMinor, 0);   // idempotent per payment
});

test('no commission for a creator buying their own membership', async () => {
  const mid = await one(env, `SELECT id FROM memberships WHERE slug = 'cara-group'`);
  const own = await recordPaymentCommissions(env, await successPayment('ref_mem_own', ids.cara, 'membership', mid.id, 500000));
  assert.equal(own.membershipMinor, 0);
  // Cara is a referred user, so her own purchase still earns the ordinary partner commission, but no membership override
  assert.equal(await one(env, `SELECT 1 AS x FROM portfolio_commissions WHERE payment_reference = 'ref_mem_own' AND role = 'membership'`), null);
});

// ---------- admin: reassignment, deactivate, monitor ----------
test('only the admin reassigns a partner; the change is logged and future commissions follow the new PM', async () => {
  assert.equal((await call('ann', 'POST', `/admin/api/portfolio/members/${ids.pat}/reassign`, { pmId: ids.ben })).status, 403);
  assert.equal((await call('boss', 'POST', `/admin/api/portfolio/members/${ids.pat}/reassign`, { pmId: ids.buyer })).status, 400);
  const moved = await call('boss', 'POST', `/admin/api/portfolio/members/${ids.pat}/reassign`, { pmId: ids.ben });
  ok(moved, 'reassign');
  assert.equal(String(moved.json.recruitedBy.id), String(ids.ben));
  const ev = await one(env, `SELECT details FROM portfolio_events WHERE action = 'partner.reassigned' AND target_id = $1`, [ids.pat]);
  assert.equal(String(ev.details.from), String(ids.ann));
  assert.equal(String(ev.details.to), String(ids.ben));
  const p = await recordPaymentCommissions(env, await successPayment('ref_after_move', ids.buyer, 'plus', 'plus-1', 1000000));
  assert.equal(String(p.pmId), String(ids.ben));
});

test('a Portfolio Manager sees only their own partners', async () => {
  assert.equal((await call('ann', 'GET', `/portfolio/partners/${ids.pat}`)).status, 404); // pat moved to ben: not visible to ann
  const mine = await call('ben', 'GET', `/portfolio/partners/${ids.pat}`);
  ok(mine, 'ben sees pat');
  assert.equal(mine.json.performance.invited >= 1, true);
  const dash = await call('ben', 'GET', '/portfolio/dashboard');
  assert.ok(dash.json.partners.every((p) => p.performance && typeof p.performance.registrations === 'number'));
  assert.ok(dash.json.invites !== undefined);
});

test('deactivate is final until an admin reactivates; the member is suspended with a timestamp', async () => {
  ok(await call('boss', 'POST', `/admin/api/portfolio/members/${ids.pat2}/deactivate`, { reason: 'Left the network' }), 'deactivate');
  const row = await one(env, 'SELECT status, deactivated_at FROM portfolio_members WHERE user_id = $1', [ids.pat2]);
  assert.equal(row.status, 'suspended');
  assert.ok(row.deactivated_at);
  ok(await call('boss', 'POST', `/admin/api/portfolio/members/${ids.pat2}/reactivate`, {}), 'reactivate');
  const back = await one(env, 'SELECT status, deactivated_at FROM portfolio_members WHERE user_id = $1', [ids.pat2]);
  assert.equal(back.status, 'active');
  assert.equal(back.deactivated_at, null);
});

test('admin monitor lists referrals, network subscriptions and commissions', async () => {
  const m = await networkMonitor(env);
  assert.ok(m.totals.referrals >= 3);
  assert.ok(m.referrals.some((r) => r.handle === 'buyer1'));
  assert.ok(m.subscriptions.some((s) => s.reference === 'ref_sub_1'));
  assert.ok(m.commissions.some((c) => c.role === 'membership'));
  const r = await call('boss', 'GET', '/admin/api/portfolio/monitor');
  assert.equal(r.status, 200);
  assert.equal((await call('ann', 'GET', '/admin/api/portfolio/monitor')).status, 403);
});

test('the admin config accepts only valid landing templates and override percentages', async () => {
  assert.equal((await call('boss', 'PUT', '/admin/api/portfolio/config', { key: 'portfolio_membership_commission_bps', value: 10001 })).status, 400);
  assert.equal((await call('boss', 'PUT', '/admin/api/portfolio/config', { key: 'portfolio_landing_template', value: { headline: 'x', benefits: [], accent: '#123456' } })).status, 400);
  const good = await call('boss', 'PUT', '/admin/api/portfolio/config', { key: 'portfolio_landing_template', value: { headline: 'invites you to BibleNestra', benefits: ['Pray together'], accent: 'sage' } });
  ok(good, 'valid template');
  assert.equal(good.json.landingTemplate.accent, 'sage');
});
