// PORTFOLIO & PARTNER MANAGERS (Development Update v1, document A). Logic: lib/portfolio.js.
//   public (before requireUser):
//     GET  /p/:code                       a Partner Manager's personal promotional landing page (HTML)
//     GET  /portfolio/invite/:code        Portfolio Manager recruitment page (HTML): opportunity, duties, commission
//     GET  /partner/invite/:code          Partner Manager recruitment page (HTML)
//     GET  /portfolio/invites/:code       invitation info (JSON) for the app's Apply screen
//   signed in:
//     GET  /portfolio/me                  my role, status, landing link, pending application
//     POST /portfolio/apply               { code, answers } apply with an invitation code
//     GET  /portfolio/dashboard           PM dashboard (earnings, my Partner Managers, invites, applications, withdrawals)
//     GET  /partner/dashboard             Partner Manager dashboard (landing link, referred users, commissions)
//     GET|POST /portfolio/invites         PM: list / create Partner Manager invitations (link, email, WhatsApp, social)
//     POST /portfolio/invites/:id/revoke  PM: revoke an invitation of theirs
//     GET  /portfolio/applications        PM: pending Partner Manager applications to decide
//     POST /portfolio/applications/:id/approve|reject
//     GET  /portfolio/commissions         my commission ledger
//     GET|POST /portfolio/withdrawals     my withdrawals / request one (KYC required)
//     GET  /portfolio/statement?month=    monthly statement
//   admin (role = admin; the staff area "portfolio" in lib/staff.js):
//     /admin/api/portfolio/overview|config|members|partners|invites|applications|withdrawals|commissions|report
import { Hono } from 'hono';
import { body, bad, notFound, forbidden, str } from '../lib/http.js';
import { one, q } from '../lib/db.js';
import { requireAdmin, registerAdminScript, audit } from './admin.js';
import {
  portfolioConfig, meSummary, applyWithInvite, pmDashboard, partnerDashboard, createInvite, inviteShape, revokeInvite,
  publicInviteInfo, decideApplication, applicationShape, requestWithdrawal, decideWithdrawal, withdrawalShape,
  commissionShape, reversePaymentCommissions, statement, overview, report, pmDetail, memberShape, memberOf,
  setMemberStatus, appointMember, partnerRows, activeMember, balances, normCode, reassignPartner,
} from '../lib/portfolio.js';
import {
  networkStats, monthlySeries, partnerNumbers, getLandingProfile, saveLandingProfile, creatorPlansForDisplay, shareText,
  bannerSvg, shareTargets, recordInvitation, invitationList, landingByHandle, recordLandingView, networkMonitor,
} from '../lib/partnerStats.js';
import { setConfig } from '../lib/wallet.js';
import { partnerLandingPage, recruitmentPage, notFoundPage } from '../lib/portfolioPages.js';
import { PORTFOLIO_ADMIN_SCRIPT } from '../lib/portfolioAdminPage.js';

registerAdminScript(PORTFOLIO_ADMIN_SCRIPT); // "Portfolio & Partners" tab of the /admin dashboard

const origin = (c) => (c.env.PUBLIC_API_URL || new URL(c.req.url).origin).replace(/\/$/, '');
const html = (c, page, status = 200) => { c.header('Cache-Control', 'public, max-age=300'); return c.html(page, status); };
const intParam = (c, name = 'id') => {
  const n = Number(c.req.param(name));
  if (!Number.isSafeInteger(n) || n <= 0) throw notFound('Not found');
  return n;
};

// ---------- public ----------
export const portfolioPublic = new Hono();

// The personal landing page, shared by /partner/:username (handle) and /p/:code (the older invite-code alias).
async function landingResponse(c, p) {
  const cfg = await portfolioConfig(c.env);
  const profile = await getLandingProfile(c.env, p.id);
  const plans = await creatorPlansForDisplay(c.env);
  const base = origin(c);
  const landing = p.handle ? `${base}/partner/${p.handle}` : `${base}/p/${p.invite_code}`;
  await recordLandingView(c.env, p.id);
  return html(c, partnerLandingPage({
    name: profile.displayName || p.display_name, handle: p.handle, intro: profile.intro, photoUrl: profile.photoUrl,
    code: p.invite_code, origin: base, cfg, template: cfg.landingTemplate, plans, playUrl: c.env.PLAY_STORE_URL || null,
    landingUrl: landing, bannerUrl: `${base}/partner/${p.handle || p.invite_code}/banner.svg`,
    shares: shareTargets(landing, shareText(profile.inviteMessage, { name: 'there', code: p.invite_code })), // visitors are not the partner: no name
  }));
}

// Single-segment names under /partner/ that belong to signed-in routes: the public page passes them on.
const PARTNER_RESERVED = new Set(['dashboard', 'profile', 'invitations', 'report', 'tools', 'stats']);

portfolioPublic.get('/p/:code', async (c) => {
  const code = normCode(c.req.param('code'));
  const p = code ? await one(c.env, `SELECT u.id, u.display_name, u.handle, u.invite_code FROM users u
      JOIN portfolio_members m ON m.user_id = u.id WHERE u.invite_code = $1 AND m.role = 'partner_manager' AND m.status = 'active' AND NOT u.banned`, [code]) : null;
  if (!p) return html(c, notFoundPage('This link is not available any more.'), 404);
  return landingResponse(c, p);
});

portfolioPublic.get('/partner/:username', async (c, next) => {
  const username = c.req.param('username');
  if (PARTNER_RESERVED.has(username.toLowerCase())) return next();
  const p = await landingByHandle(c.env, username);
  if (!p) return html(c, notFoundPage('This link is not available any more.'), 404);
  return landingResponse(c, p);
});

portfolioPublic.get('/partner/:username/banner.svg', async (c) => {
  const username = c.req.param('username');
  // by handle first, then by invite code (the /p/:code alias)
  const p = (await landingByHandle(c.env, username))
    || await one(c.env, `SELECT u.id, u.display_name, u.handle, u.invite_code FROM users u JOIN portfolio_members m ON m.user_id = u.id
        WHERE u.invite_code = $1 AND m.role = 'partner_manager' AND m.status = 'active' AND NOT u.banned`, [normCode(username)]);
  if (!p) return html(c, notFoundPage('This link is not available any more.'), 404);
  const cfg = await portfolioConfig(c.env);
  const profile = await getLandingProfile(c.env, p.id);
  const svg = bannerSvg({ name: profile.displayName || p.display_name, code: p.invite_code, headline: cfg.landingTemplate.headline, accent: cfg.landingTemplate.accent, link: `${origin(c)}/i/${p.invite_code}` });
  return c.body(svg, 200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
});

portfolioPublic.get('/portfolio/invite/:code', async (c) => {
  const info = await publicInviteInfo(c.env, c.req.param('code'));
  if (!info || info.kind !== 'portfolio_manager') return html(c, notFoundPage('This invitation is not valid.'), 404);
  const cfg = await portfolioConfig(c.env);
  return html(c, recruitmentPage({ kind: 'portfolio_manager', info, cfg, origin: origin(c), playUrl: c.env.PLAY_STORE_URL || null }));
});

portfolioPublic.get('/partner/invite/:code', async (c) => {
  const info = await publicInviteInfo(c.env, c.req.param('code'));
  if (!info || info.kind !== 'partner_manager') return html(c, notFoundPage('This invitation is not valid.'), 404);
  const cfg = await portfolioConfig(c.env);
  return html(c, recruitmentPage({ kind: 'partner_manager', info, cfg, origin: origin(c), playUrl: c.env.PLAY_STORE_URL || null }));
});

portfolioPublic.get('/portfolio/invites/:code', async (c) => {
  const info = await publicInviteInfo(c.env, c.req.param('code'));
  if (!info) throw notFound('That invitation was not found');
  return c.json(info);
});

// ---------- signed in ----------
export const portfolio = new Hono();

portfolio.get('/portfolio/me', async (c) => c.json(await meSummary(c.env, c.get('user'), origin(c))));

portfolio.post('/portfolio/apply', async (c) => {
  const b = await body(c);
  const r = await applyWithInvite(c.env, c.get('user'), { code: str(b.code, { max: 40, field: 'code' }), answers: b.answers || {} });
  return c.json(r, r.alreadyApplied ? 200 : 201);
});

portfolio.get('/portfolio/dashboard', async (c) => {
  const d = await pmDashboard(c.env, c.get('user'), origin(c));
  // each Partner Manager's own numbers: invitations, registrations, creators, revenue, commissions
  const perf = await partnerNumbers(c.env, d.partners.map((p) => p.userId));
  return c.json({ ...d, partners: d.partners.map((p) => ({ ...p, performance: perf[String(p.userId)] || null })) });
});

// A Portfolio Manager's view of one of their own Partner Managers. Other Portfolio Managers get 403.
portfolio.get('/portfolio/partners/:userId', async (c) => {
  const me = c.get('user');
  if (!(await activeMember(c.env, me.id, 'portfolio_manager'))) throw forbidden('Portfolio Managers only', 'PM_ONLY');
  const pn = await memberOf(c.env, c.req.param('userId'));
  if (!pn || pn.role !== 'partner_manager' || String(pn.recruited_by) !== String(me.id)) throw notFound('Partner Manager not found');
  const rows = await partnerRows(c.env, { pmId: me.id });
  const row = rows.find((r) => String(r.userId) === String(pn.user_id)) || null;
  return c.json({ partner: row, performance: await networkStats(c.env, pn.user_id) });
});

portfolio.get('/partner/dashboard', async (c) => {
  const d = await partnerDashboard(c.env, c.get('user'), origin(c));
  const me = c.get('user');
  return c.json({ ...d, stats: await networkStats(c.env, me.id), monthly: await monthlySeries(c.env, me.id), tools: { landingUrl: d.landingUrl, shareLinks: d.share } });
});

// Partner Manager: landing profile (Settings), invitations (tracked), the tools and the performance report.
portfolio.get('/partner/profile', async (c) => {
  if (!(await activeMember(c.env, c.get('user').id, 'partner_manager'))) throw forbidden('Partner Managers only', 'PARTNER_ONLY');
  return c.json(await getLandingProfile(c.env, c.get('user').id));
});

portfolio.put('/partner/profile', async (c) => {
  if (!(await activeMember(c.env, c.get('user').id, 'partner_manager'))) throw forbidden('Partner Managers only', 'PARTNER_ONLY');
  const b = await body(c);
  return c.json(await saveLandingProfile(c.env, c.get('user').id, {
    displayName: b.displayName, intro: b.intro, photoUrl: b.photoUrl, inviteMessage: b.inviteMessage,
  }));
});

portfolio.get('/partner/invitations', async (c) => {
  if (!(await activeMember(c.env, c.get('user').id, 'partner_manager'))) throw forbidden('Partner Managers only', 'PARTNER_ONLY');
  return c.json({ items: await invitationList(c.env, c.get('user').id) });
});

portfolio.post('/partner/invitations', async (c) => {
  const me = c.get('user');
  if (!(await activeMember(c.env, me.id, 'partner_manager'))) throw forbidden('Partner Managers only', 'PARTNER_ONLY');
  const b = await body(c);
  const inv = await recordInvitation(c.env, me, { channel: b.channel || 'other', email: b.email || null, name: b.name || null });
  const profile = await getLandingProfile(c.env, me.id);
  const landing = profile.handle ? `${origin(c)}/partner/${profile.handle}` : `${origin(c)}/p/${profile.code}`;
  const text = shareText(profile.inviteMessage, { name: b.name || 'there', code: profile.code });
  // message = the text with the link, ready for the native share sheet (Instagram, other apps)
  return c.json({ invitation: inv, share: shareTargets(landing, text), message: `${text} ${landing}` }, 201);
});

portfolio.get('/partner/tools', async (c) => {
  const me = c.get('user');
  if (!(await activeMember(c.env, me.id, 'partner_manager'))) throw forbidden('Partner Managers only', 'PARTNER_ONLY');
  const profile = await getLandingProfile(c.env, me.id);
  const cfg = await portfolioConfig(c.env);
  const landing = profile.handle ? `${origin(c)}/partner/${profile.handle}` : `${origin(c)}/p/${profile.code}`;
  const text = shareText(profile.inviteMessage, { name: 'there', code: profile.code });
  return c.json({
    code: profile.code,
    landingUrl: landing,
    joinUrl: `${origin(c)}/i/${profile.code}`,
    inviteMessage: profile.inviteMessage,
    shares: shareTargets(landing, text),
    banner: { url: `${origin(c)}/partner/${profile.handle || profile.code}/banner.svg`, headline: cfg.landingTemplate.headline },
    // text templates for promotion: the partner copies them into WhatsApp, Instagram or Telegram
    templates: [
      { id: 'invite', title: 'Personal invitation', text },
      { id: 'story', title: 'Short story', text: `I have been reading the Bible on BibleNestra and it has become part of my daily prayer. Join me with my link: ${landing}` },
      { id: 'creator', title: 'For creators', text: `Want to share Bible study with your community? Start a free membership on BibleNestra. Join with my link: ${landing}` },
    ],
  });
});

portfolio.get('/partner/report', async (c) => {
  const me = c.get('user');
  if (!(await activeMember(c.env, me.id, 'partner_manager'))) throw forbidden('Partner Managers only', 'PARTNER_ONLY');
  const st = await statement(c.env, me.id, c.req.query('month') || null);
  return c.json({ ...st, stats: await networkStats(c.env, me.id), monthly: await monthlySeries(c.env, me.id) });
});

portfolio.get('/portfolio/invites', async (c) => {
  const me = c.get('user');
  const rows = await q(c.env, 'SELECT * FROM portfolio_invites WHERE portfolio_manager_id = $1 ORDER BY created_at DESC LIMIT 200', [me.id]);
  return c.json({ items: rows.map((r) => inviteShape(r, origin(c))) });
});

portfolio.post('/portfolio/invites', async (c) => {
  const b = await body(c);
  const inv = await createInvite(c.env, c.get('user'), {
    kind: 'partner_manager', channel: b.channel || 'link', email: b.email || null, label: b.label || null,
    maxUses: b.maxUses ?? null, expiresInDays: b.expiresInDays ?? null, byAdmin: false,
  });
  return c.json(inviteShape(inv, origin(c)), 201);
});

portfolio.post('/portfolio/invites/:id/revoke', async (c) => {
  const r = await revokeInvite(c.env, c.get('user'), intParam(c));
  return c.json(inviteShape(r, origin(c)));
});

portfolio.get('/portfolio/applications', async (c) => {
  const me = c.get('user');
  if (!(await activeMember(c.env, me.id, 'portfolio_manager'))) return c.json({ items: [] });
  const rows = await q(c.env, `SELECT a.*, u.display_name, u.handle FROM portfolio_applications a JOIN users u ON u.id = a.applicant_id
      WHERE a.approver_id = $1 AND a.status = 'pending' ORDER BY a.created_at`, [me.id]);
  return c.json({ items: rows.map((a) => ({ ...applicationShape(a), applicant: { displayName: a.display_name, handle: a.handle } })) });
});

portfolio.post('/portfolio/applications/:id/:action', async (c) => {
  const action = c.req.param('action');
  if (!['approve', 'reject'].includes(action)) throw notFound('Not found');
  const b = await body(c).catch(() => ({}));
  const r = await decideApplication(c.env, c.get('user'), intParam(c), action, { reason: b.reason || null });
  return c.json(r);
});

portfolio.get('/portfolio/commissions', async (c) => {
  const me = c.get('user');
  const before = Number(c.req.query('before'));
  const rows = await q(c.env, `SELECT * FROM portfolio_commissions WHERE recipient_id = $1 AND ($2::bigint IS NULL OR id < $2)
      ORDER BY id DESC LIMIT 50`, [me.id, Number.isSafeInteger(before) && before > 0 ? before : null]);
  return c.json({ balances: Object.values(await balances(c.env, me.id)), items: rows.map(commissionShape), nextBefore: rows.length === 50 ? String(rows[rows.length - 1].id) : null });
});

portfolio.get('/portfolio/withdrawals', async (c) => {
  const rows = await q(c.env, 'SELECT * FROM portfolio_withdrawals WHERE user_id = $1 ORDER BY requested_at DESC LIMIT 100', [c.get('user').id]);
  return c.json({ items: rows.map(withdrawalShape) });
});

portfolio.post('/portfolio/withdrawals', async (c) => {
  const b = await body(c);
  const w = await requestWithdrawal(c.env, c.get('user'), { amountMinor: Number(b.amountMinor), currency: b.currency || null });
  return c.json(w, 201);
});

portfolio.get('/portfolio/statement', async (c) => {
  const me = c.get('user');
  return c.json(await statement(c.env, me.id, c.req.query('month') || null));
});

// ---------- admin ----------
export const adminPortfolio = new Hono();
adminPortfolio.use('/admin/api/portfolio', requireAdmin);
adminPortfolio.use('/admin/api/portfolio/*', requireAdmin);

const ADMIN_KEYS = ['portfolio_partner_bps', 'portfolio_pm_bps', 'portfolio_hold_days', 'portfolio_min_withdrawal_minor', 'portfolio_eligible_kinds',
  'portfolio_pm_auto_approve', 'portfolio_partner_auto_approve', 'portfolio_pm_partner_limit', 'portfolio_pm_invite_limit',
  'portfolio_membership_commission_bps', 'portfolio_landing_template'];

adminPortfolio.get('/admin/api/portfolio/overview', async (c) => c.json(await overview(c.env)));

adminPortfolio.get('/admin/api/portfolio/config', async (c) => {
  const cfg = await portfolioConfig(c.env);
  return c.json({ ...cfg, raw: undefined, keys: ADMIN_KEYS });
});

adminPortfolio.put('/admin/api/portfolio/config', async (c) => {
  const admin = c.get('user');
  const b = await body(c);
  if (!ADMIN_KEYS.includes(b.key)) throw bad('Unknown setting', 'BAD_CONFIG');
  await setConfig(c.env, b.key, b.value, admin.id);
  await audit(c.env, admin, 'portfolio.config', 'portfolio', b.key, { value: b.value });
  return c.json(await portfolioConfig(c.env));
});

adminPortfolio.get('/admin/api/portfolio/members', async (c) => {
  const role = c.req.query('role');
  const status = c.req.query('status');
  const term = String(c.req.query('q') || '').replace(/^@/, '').trim().slice(0, 60);
  const rows = await q(c.env, `SELECT m.user_id FROM portfolio_members m JOIN users u ON u.id = m.user_id
      WHERE ($1::text IS NULL OR m.role = $1) AND ($2::text IS NULL OR m.status = $2)
        AND ($3::text = '' OR lower(u.handle) LIKE '%' || lower($3) || '%' OR lower(u.display_name) LIKE '%' || lower($3) || '%')
      ORDER BY m.created_at DESC LIMIT 300`, [role || null, status || null, term]);
  const items = [];
  for (const r of rows) items.push(await memberShape(c.env, await memberOf(c.env, r.user_id)));
  return c.json({ items });
});

adminPortfolio.post('/admin/api/portfolio/members', async (c) => {
  const admin = c.get('user');
  const b = await body(c);
  const m = await appointMember(c.env, admin, {
    userId: b.userId ? str(b.userId, { max: 60, field: 'userId' }) : null,
    handle: b.handle ? str(b.handle, { max: 40, field: 'handle' }) : null,
    role: b.role || 'portfolio_manager',
    recruitedBy: b.recruitedBy || null,
  });
  await audit(c.env, admin, 'portfolio.member.appointed', 'user', m.userId, { role: m.role });
  return c.json(m, 201);
});

adminPortfolio.post('/admin/api/portfolio/members/:id/:action', async (c, next) => {
  const admin = c.get('user');
  const action = c.req.param('action');
  if (action === 'reassign') return next(); // the dedicated reassign route below
  if (!['suspend', 'deactivate', 'reactivate'].includes(action)) throw notFound('Not found');
  const b = await body(c).catch(() => ({}));
  const id = c.req.param('id');
  const m = await setMemberStatus(c.env, admin, id, action, b.reason || null);
  await audit(c.env, admin, `portfolio.member.${action}`, 'user', id, { reason: b.reason || null });
  return c.json(m);
});

// Super Admin only (this whole route group is admin-only): move a Partner Manager to another Portfolio Manager. Logged.
adminPortfolio.post('/admin/api/portfolio/members/:id/reassign', async (c) => {
  const admin = c.get('user');
  const b = await body(c);
  const id = c.req.param('id');
  if (admin.role !== 'admin') throw forbidden('Only the Super Admin can reassign a partner', 'ADMIN_ONLY'); // explicit, on top of requireAdmin
  const m = await reassignPartner(c.env, admin, id, str(b.pmId, { max: 60, field: 'pmId' }));
  await audit(c.env, admin, 'portfolio.partner.reassigned', 'user', id, { pmId: b.pmId });
  return c.json(m);
});

adminPortfolio.get('/admin/api/portfolio/monitor', async (c) => c.json(await networkMonitor(c.env)));

adminPortfolio.get('/admin/api/portfolio/members/:id', async (c) => {
  const id = c.req.param('id');
  const m = await memberOf(c.env, id);
  if (!m) throw notFound('Member not found');
  if (m.role === 'portfolio_manager') return c.json(await pmDetail(c.env, id));
  return c.json({ member: await memberShape(c.env, m), earnings: Object.values(await balances(c.env, id)), performance: await networkStats(c.env, id) });
});

adminPortfolio.get('/admin/api/portfolio/partners', async (c) => {
  const pm = c.req.query('pm') || null;
  const status = c.req.query('status') || null;
  return c.json({ items: await partnerRows(c.env, { pmId: pm, status, limit: 500 }) });
});

adminPortfolio.get('/admin/api/portfolio/invites', async (c) => {
  const rows = await q(c.env, 'SELECT * FROM portfolio_invites ORDER BY created_at DESC LIMIT 200');
  return c.json({ items: rows.map((r) => inviteShape(r, origin(c))) });
});

adminPortfolio.post('/admin/api/portfolio/invites', async (c) => {
  const admin = c.get('user');
  const b = await body(c);
  if (b.kind && b.kind !== 'portfolio_manager') throw bad('Partner Manager invites are created by Portfolio Managers', 'PM_ONLY');
  const inv = await createInvite(c.env, admin, {
    kind: 'portfolio_manager', channel: b.channel || 'link', email: b.email || null, label: b.label || null,
    maxUses: b.maxUses ?? null, expiresInDays: b.expiresInDays ?? null, byAdmin: true,
  });
  await audit(c.env, admin, 'portfolio.invite.created', 'portfolio_invite', inv.code, { channel: inv.channel });
  return c.json(inviteShape(inv, origin(c)), 201);
});

adminPortfolio.post('/admin/api/portfolio/invites/:id/revoke', async (c) => {
  const admin = c.get('user');
  const r = await revokeInvite(c.env, admin, intParam(c), { admin: true });
  await audit(c.env, admin, 'portfolio.invite.revoked', 'portfolio_invite', r.code, {});
  return c.json(inviteShape(r, origin(c)));
});

adminPortfolio.get('/admin/api/portfolio/applications', async (c) => {
  const status = c.req.query('status') || 'pending';
  const rows = await q(c.env, `SELECT a.*, u.display_name, u.handle, pm.display_name AS approver_name FROM portfolio_applications a
      JOIN users u ON u.id = a.applicant_id LEFT JOIN users pm ON pm.id = a.approver_id
      WHERE ($1::text = 'all' OR a.status = $1) ORDER BY a.created_at DESC LIMIT 300`, [status]);
  return c.json({ items: rows.map((a) => ({ ...applicationShape(a), applicant: { displayName: a.display_name, handle: a.handle }, approverName: a.approver_name || 'Super Admin' })) });
});

adminPortfolio.post('/admin/api/portfolio/applications/:id/:action', async (c) => {
  const admin = c.get('user');
  const action = c.req.param('action');
  if (!['approve', 'reject'].includes(action)) throw notFound('Not found');
  const b = await body(c).catch(() => ({}));
  const r = await decideApplication(c.env, admin, intParam(c), action, { reason: b.reason || null, admin: true });
  await audit(c.env, admin, `portfolio.application.${action}`, 'portfolio_application', c.req.param('id'), { reason: b.reason || null });
  return c.json(r);
});

adminPortfolio.get('/admin/api/portfolio/withdrawals', async (c) => {
  const status = c.req.query('status') || null;
  const rows = await q(c.env, `SELECT w.*, u.display_name, u.handle FROM portfolio_withdrawals w JOIN users u ON u.id = w.user_id
      WHERE ($1::text IS NULL OR w.status = $1) ORDER BY w.requested_at DESC LIMIT 300`, [status]);
  return c.json({ items: rows.map((w) => ({ ...withdrawalShape(w), member: { displayName: w.display_name, handle: w.handle, userId: w.user_id } })) });
});

adminPortfolio.post('/admin/api/portfolio/withdrawals/:id/:action', async (c) => {
  const admin = c.get('user');
  const action = c.req.param('action');
  if (!['approve', 'reject', 'paid'].includes(action)) throw notFound('Not found');
  const b = await body(c).catch(() => ({}));
  const r = await decideWithdrawal(c.env, admin, intParam(c), action, { note: b.note || null, reference: b.reference || null });
  await audit(c.env, admin, `portfolio.withdrawal.${action}`, 'portfolio_withdrawal', c.req.param('id'), { reference: b.reference || null });
  return c.json(r);
});

adminPortfolio.get('/admin/api/portfolio/commissions', async (c) => {
  const ref = c.req.query('reference') || null;
  const rows = await q(c.env, `SELECT c.*, u.display_name, u.handle FROM portfolio_commissions c JOIN users u ON u.id = c.recipient_id
      WHERE ($1::text IS NULL OR c.payment_reference = $1) ORDER BY c.id DESC LIMIT 200`, [ref]);
  return c.json({ items: rows.map((r) => ({ ...commissionShape(r), recipient: { displayName: r.display_name, handle: r.handle } })) });
});

adminPortfolio.post('/admin/api/portfolio/commissions/reverse', async (c) => {
  const admin = c.get('user');
  const b = await body(c);
  const reference = str(b.reference, { min: 3, max: 120, field: 'reference' });
  const reason = str(b.reason, { min: 5, max: 300, field: 'reason' });
  const rows = await reversePaymentCommissions(c.env, { reference, actor: admin, admin: true, reason });
  if (!rows.length) throw notFound('No open commissions for that payment');
  await audit(c.env, admin, 'portfolio.commission.reversed', 'payment_reference', reference, { reason, rows: rows.length });
  return c.json({ reversed: rows.length });
});

adminPortfolio.get('/admin/api/portfolio/report', async (c) => c.json(await report(c.env, c.req.query('month') || null)));
