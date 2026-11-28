// PORTFOLIO & PARTNER MANAGERS (round 3): the numbers and tools behind the Partner Manager dashboard, the personal landing
// page, the invitation tracker and the admin monitor. Every figure is computed from the real tables:
//   • invited        partner_invitations sent by the partner (named invitations: email, WhatsApp, Telegram, ...)
//   • registrations  partner_attributions (first-touch, permanent) of the partner
//   • creator        a referred user who owns a membership (memberships.owner_id); active = a published membership
//   • membership     memberships owned by referred users
//   • revenue        successful, non-test Paystack payments of referred users for kind 'membership' or 'creator_plan'
//   • commissions    portfolio_commissions (role partner / membership) via balances() in lib/portfolio.js
import { q, one } from './db.js';
import { bad } from './http.js';
import { getConfig } from './wallet.js';
import { balances, shareLinks, LANDING_ACCENTS, DEFAULT_LANDING_TEMPLATE, iso } from './portfolio.js';

export const INVITE_CHANNELS = ['email', 'whatsapp', 'facebook', 'instagram', 'telegram', 'link', 'other'];
export const DEFAULT_INVITE_MESSAGE = 'Hi {name}, I would love you to join me on BibleNestra. Read the Bible, pray and chat with believers. Join with my link: {link}';
const num = (v) => Number(v || 0);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// ─── network numbers ──────────────────────────────────────────────────────────────────────────────────────────────────
/** All headline numbers of one partner's network, in one round trip plus balances(). */
export async function networkStats(env, partnerId) {
  const c = await one(env, `SELECT
      (SELECT count(*)::int FROM partner_invitations WHERE inviter_id = $1) AS invited,
      (SELECT count(*)::int FROM partner_invitations WHERE inviter_id = $1 AND registered_user_id IS NULL) AS invites_pending,
      (SELECT count(*)::int FROM partner_invitations WHERE inviter_id = $1 AND registered_user_id IS NOT NULL) AS invites_registered,
      (SELECT count(*)::int FROM partner_attributions WHERE partner_id = $1) AS registrations,
      (SELECT count(*)::int FROM partner_landing_views WHERE partner_id = $1) AS landing_views,
      (SELECT count(*)::int FROM memberships m JOIN partner_attributions a ON a.user_id = m.owner_id WHERE a.partner_id = $1) AS memberships_created,
      (SELECT count(DISTINCT a.user_id)::int FROM partner_attributions a JOIN memberships m ON m.owner_id = a.user_id WHERE a.partner_id = $1) AS creators_recruited,
      (SELECT count(DISTINCT a.user_id)::int FROM partner_attributions a JOIN memberships m ON m.owner_id = a.user_id
         WHERE a.partner_id = $1 AND m.status = 'published') AS active_creators`, [partnerId]);
  const rev = await q(env, `SELECT p.currency, COALESCE(sum(p.amount_minor), 0)::bigint AS amount, count(*)::int AS n
      FROM paystack_payments p JOIN partner_attributions a ON a.user_id = p.user_id
     WHERE a.partner_id = $1 AND p.status = 'success' AND NOT p.test AND p.kind IN ('membership', 'creator_plan')
     GROUP BY p.currency`, [partnerId]);
  const bal = await balances(env, partnerId);
  const ngn = bal.NGN || { heldMinor: 0, availableMinor: 0, paidMinor: 0, earnedMinor: 0 };
  const registrations = c.registrations;
  const invited = c.invited;
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
  return {
    invited,
    invitesPending: c.invites_pending,
    invitesRegistered: c.invites_registered,
    registrations,
    creatorsRecruited: c.creators_recruited,
    activeCreators: c.active_creators,
    membershipsCreated: c.memberships_created,
    landingViews: c.landing_views,
    revenue: rev.map((r) => ({ currency: r.currency, amountMinor: num(r.amount), payments: r.n })),
    commissions: {
      currency: 'NGN',
      earnedMinor: num(ngn.earnedMinor),
      pendingMinor: num(ngn.heldMinor),
      approvedMinor: Math.max(0, num(ngn.availableMinor) - num(ngn.paidMinor)),
      paidMinor: num(ngn.paidMinor),
    },
    conversion: {
      visitToRegistration: pct(registrations, c.landing_views),
      inviteToRegistration: pct(c.invites_registered, invited),
    },
  };
}

/** The last 12 months (oldest first): registrations, memberships created, revenue and commissions, per month. */
export async function monthlySeries(env, partnerId, now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)).toISOString();
  const [reg, mem, rev, com] = await Promise.all([
    q(env, `SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS m, count(*)::int AS n FROM partner_attributions
      WHERE partner_id = $1 AND created_at >= $2 GROUP BY 1`, [partnerId, start]),
    q(env, `SELECT to_char(date_trunc('month', m.created_at), 'YYYY-MM') AS m, count(*)::int AS n FROM memberships m
      JOIN partner_attributions a ON a.user_id = m.owner_id WHERE a.partner_id = $1 AND m.created_at >= $2 GROUP BY 1`, [partnerId, start]),
    q(env, `SELECT to_char(date_trunc('month', COALESCE(p.paid_at, p.created_at)), 'YYYY-MM') AS m, COALESCE(sum(p.amount_minor), 0)::bigint AS amount
      FROM paystack_payments p JOIN partner_attributions a ON a.user_id = p.user_id
      WHERE a.partner_id = $1 AND p.status = 'success' AND NOT p.test AND p.kind IN ('membership', 'creator_plan') AND p.created_at >= $2 GROUP BY 1`, [partnerId, start]),
    q(env, `SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS m, COALESCE(sum(amount_minor), 0)::bigint AS amount FROM portfolio_commissions
      WHERE recipient_id = $1 AND role IN ('partner', 'membership') AND status <> 'reversed' AND created_at >= $2 GROUP BY 1`, [partnerId, start]),
  ]);
  const pick = (rows, key) => Object.fromEntries(rows.map((r) => [r.m, num(r[key])]));
  const R = pick(reg, 'n'); const M = pick(mem, 'n'); const V = pick(rev, 'amount'); const C = pick(com, 'amount');
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    months.push({ month: key, registrations: R[key] || 0, memberships: M[key] || 0, revenueMinor: V[key] || 0, commissionMinor: C[key] || 0 });
  }
  return months;
}

/** Partner-level rows for a Portfolio Manager's list: each partner with their own numbers. */
export async function partnerNumbers(env, partnerIds) {
  const out = {};
  for (const id of partnerIds) out[String(id)] = await networkStats(env, id);
  return out;
}

// ─── personal landing page and tools ─────────────────────────────────────────────────────────────────────────────────
/** Profile the partner edits in Settings: photo, display name, intro and the invite message. */
export async function getLandingProfile(env, userId) {
  const row = await one(env, 'SELECT * FROM partner_landing_profiles WHERE user_id = $1', [userId]);
  const u = await one(env, 'SELECT display_name, handle, invite_code FROM users WHERE id = $1', [userId]);
  return {
    displayName: row && row.display_name ? row.display_name : (u ? u.display_name : null),
    intro: row ? row.intro : '',
    photoUrl: row ? row.photo_url || null : null,
    inviteMessage: row && row.invite_message ? row.invite_message : DEFAULT_INVITE_MESSAGE,
    usingDefaultMessage: !(row && row.invite_message),
    handle: u ? u.handle : null,
    code: u ? u.invite_code : null,
  };
}

export async function saveLandingProfile(env, userId, input = {}) {
  const cur = await getLandingProfile(env, userId);
  const text = (v, max, field) => {
    if (v == null) return null;
    const s = String(v).replace(/\s+/g, ' ').trim();
    if (s.length > max) throw bad(`${field} must be ${max} characters or fewer`, 'TOO_LONG');
    return s;
  };
  const displayName = input.displayName === undefined ? cur.displayName : text(input.displayName, 60, 'Display name');
  const intro = input.intro === undefined ? cur.intro : (text(input.intro, 400, 'Intro') || '');
  const message = input.inviteMessage === undefined ? (cur.usingDefaultMessage ? '' : cur.inviteMessage) : (text(input.inviteMessage, 600, 'Invite message') || '');
  if (message && !/\{link\}/.test(message)) throw bad('The invite message must include {link} so people get your link', 'LINK_REQUIRED');
  let photo = input.photoUrl === undefined ? cur.photoUrl : (input.photoUrl ? String(input.photoUrl).trim() : null);
  if (photo && !/^https:\/\/[^\s]{4,490}$/.test(photo)) throw bad('The photo must be an https web address', 'BAD_PHOTO');
  await q(env, `INSERT INTO partner_landing_profiles (user_id, display_name, intro, photo_url, invite_message, updated_at)
      VALUES ($1, $2, $3, $4, $5, now())
    ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name, intro = EXCLUDED.intro,
      photo_url = EXCLUDED.photo_url, invite_message = EXCLUDED.invite_message, updated_at = now()`,
  [userId, displayName || null, intro, photo, message]);
  return getLandingProfile(env, userId);
}

/** The invite message with the partner's name, code and link filled in. */
export function renderInviteMessage(template, { name, code, link }) {
  return String(template || DEFAULT_INVITE_MESSAGE)
    .replace(/\{name\}/g, name || 'there').replace(/\{code\}/g, code || '').replace(/\{link\}/g, link || '');
}

/** The share message without its link: the share buttons add the link themselves. */
export function shareText(template, vars) {
  return renderInviteMessage(template, { ...vars, link: '' }).replace(/\s+/g, ' ').trim();
}

/**
 * Creator plans for the landing page, read live from the 'creator_plans' config (another agent registers it). When the
 * config is missing or unreadable, the page falls back to plan names only, with no prices.
 */
export async function creatorPlansForDisplay(env) {
  const fallback = { available: false, plans: [{ name: 'Free', priceLabel: 'Free' }, { name: 'Standard', priceLabel: null }, { name: 'Premium', priceLabel: null }] };
  let raw;
  try { raw = (await getConfig(env)).creator_plans; } catch (e) { return fallback; }
  // real shape (lib/creatorPlans.js): { enabled, plans: { free|standard|premium: { name, priceUsdCents, withdrawalPercent, enabled } } }
  const map = raw && typeof raw === 'object' && raw.plans && typeof raw.plans === 'object' ? raw.plans : null;
  if (!map) return fallback;
  const plans = Object.values(map).filter((p) => p && p.enabled !== false && p.name).slice(0, 6).map((p) => {
    const cents = Number(p.priceUsdCents || 0);
    return {
      name: String(p.name).slice(0, 40),
      priceLabel: cents > 0 ? `$${(cents / 100).toFixed(2)} / month` : 'Free',
      feeLabel: Number.isFinite(Number(p.withdrawalPercent)) ? `${Number(p.withdrawalPercent)}% withdrawal fee` : null,
    };
  });
  if (!plans.length) return fallback;
  return { available: true, plans };
}

/** Promo banner as an SVG image (1080 x 1080), in BibleNestra's palette. Shareable as an image file. */
export function bannerSvg({ name, code, headline, accent = 'orange', link }) {
  const first = String(name || 'A partner').split(' ')[0].slice(0, 24);
  const acc = LANDING_ACCENTS[accent] || LANDING_ACCENTS.orange;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
<rect width="1080" height="1080" fill="#F8F1E7"/>
<rect x="60" y="60" width="960" height="960" rx="56" fill="${acc}"/>
<text x="110" y="180" font-family="DM Sans, Arial, sans-serif" font-size="34" font-weight="700" letter-spacing="6" fill="#281A11">BIBLENESTRA</text>
<text x="110" y="420" font-family="Playfair Display, Georgia, serif" font-size="96" font-weight="700" fill="#281A11">${esc(first)}</text>
<text x="110" y="520" font-family="Playfair Display, Georgia, serif" font-size="64" fill="#281A11">${esc(String(headline || DEFAULT_LANDING_TEMPLATE.headline).slice(0, 60))}</text>
<text x="110" y="660" font-family="DM Sans, Arial, sans-serif" font-size="40" fill="#281A11">Read the Bible, pray and chat with believers.</text>
<rect x="110" y="740" width="420" height="96" rx="48" fill="#281A11"/>
<text x="320" y="802" text-anchor="middle" font-family="DM Sans, Arial, sans-serif" font-size="38" font-weight="700" fill="#FFFAF2">Code ${esc(code)}</text>
<text x="110" y="930" font-family="DM Sans, Arial, sans-serif" font-size="30" fill="#281A11">${esc(String(link || '').slice(0, 90))}</text>
</svg>`;
}

// ─── invitations (tracked) ───────────────────────────────────────────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,24}$/;

/** Records an invitation the partner sends. The app opens the share sheet or mailto link; this keeps the record. */
export async function recordInvitation(env, inviter, { channel = 'other', email = null, name = null } = {}) {
  if (!INVITE_CHANNELS.includes(channel)) throw bad('Choose a channel: email, whatsapp, facebook, instagram, telegram, link or other', 'BAD_CHANNEL');
  let mail = null;
  if (email) {
    mail = String(email).trim().toLowerCase();
    if (!EMAIL_RE.test(mail)) throw bad('That email address does not look right', 'BAD_EMAIL');
  }
  if (channel === 'email' && !mail) throw bad('Enter the email address to invite', 'EMAIL_REQUIRED');
  // the same person cannot be invited into their own network
  if (mail) {
    const self = await one(env, 'SELECT 1 AS x FROM users WHERE id = $1 AND lower(billing_email) = $2', [inviter.id, mail]);
    if (self) throw bad('You cannot invite yourself', 'SELF_INVITE');
  }
  const row = await one(env, `INSERT INTO partner_invitations (inviter_id, channel, email, invitee_name)
      VALUES ($1, $2, $3, $4) RETURNING *`, [inviter.id, channel, mail, name ? String(name).slice(0, 120) : null]);
  return invitationShape(row);
}

export function invitationShape(r) {
  return {
    id: String(r.id), channel: r.channel, email: r.email || null, name: r.invitee_name || null,
    status: r.registered_user_id ? 'registered' : 'pending', createdAt: iso(r.created_at), registeredAt: iso(r.registered_at),
  };
}

export async function invitationList(env, partnerId, limit = 100) {
  const rows = await q(env, 'SELECT * FROM partner_invitations WHERE inviter_id = $1 ORDER BY created_at DESC LIMIT $2', [partnerId, limit]);
  return rows.map(invitationShape);
}

/** Share targets for a link and a message: WhatsApp, Facebook, Telegram, Instagram (native share), email (mailto). */
export function shareTargets(url, text) {
  const enc = encodeURIComponent;
  const base = shareLinks('partner_manager', url);
  return {
    link: url,
    whatsapp: `https://wa.me/?text=${enc(`${text} ${url}`)}`,
    facebook: base.facebook,
    telegram: `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`,
    instagram: null, // Instagram has no web share intent: the app uses the native share sheet with the message
    email: `mailto:?subject=${enc('Join me on BibleNestra')}&body=${enc(`${text}\n\n${url}`)}`,
  };
}

// ─── landing page data ───────────────────────────────────────────────────────────────────────────────────────────────
/** Public: the landing page of an active Partner Manager, by handle or by invite code. Null when not available. */
export async function landingByHandle(env, handle) {
  const h = String(handle || '').replace(/^@/, '').trim();
  if (!h) return null;
  return one(env, `SELECT u.id, u.display_name, u.handle, u.invite_code, u.avatar_url FROM users u
      JOIN portfolio_members m ON m.user_id = u.id
     WHERE lower(u.handle) = lower($1) AND m.role = 'partner_manager' AND m.status = 'active' AND NOT u.banned`, [h]);
}

export async function recordLandingView(env, partnerId) {
  await q(env, 'INSERT INTO partner_landing_views (partner_id) VALUES ($1)', [partnerId]).catch(() => {});
}

// ─── admin monitor ───────────────────────────────────────────────────────────────────────────────────────────────────
/** Super Admin: every referral, network subscription and commission, with who recruited whom. */
export async function networkMonitor(env) {
  const [totals, referrals, payments, commissions] = await Promise.all([
    one(env, `SELECT
        (SELECT count(*)::int FROM partner_attributions) AS referrals,
        (SELECT count(*)::int FROM partner_attributions a JOIN memberships m ON m.owner_id = a.user_id) AS creators_recruited,
        (SELECT count(*)::int FROM partner_invitations) AS invitations,
        (SELECT count(*)::int FROM partner_invitations WHERE registered_user_id IS NOT NULL) AS invitations_registered`),
    q(env, `SELECT a.user_id, a.partner_id, a.portfolio_manager_id, a.created_at, u.display_name, u.handle,
        p.display_name AS partner_name, p.handle AS partner_handle, pm.display_name AS pm_name
      FROM partner_attributions a JOIN users u ON u.id = a.user_id LEFT JOIN users p ON p.id = a.partner_id
      LEFT JOIN users pm ON pm.id = a.portfolio_manager_id ORDER BY a.created_at DESC LIMIT 100`),
    q(env, `SELECT pp.reference, pp.kind, pp.amount_minor, pp.currency, pp.paid_at, u.handle, a.partner_id, p.display_name AS partner_name
      FROM paystack_payments pp JOIN partner_attributions a ON a.user_id = pp.user_id JOIN users u ON u.id = pp.user_id
      LEFT JOIN users p ON p.id = a.partner_id
     WHERE pp.status = 'success' AND NOT pp.test AND pp.kind IN ('membership', 'creator_plan') ORDER BY pp.created_at DESC LIMIT 100`),
    q(env, `SELECT role, status, currency, count(*)::int AS n, COALESCE(sum(amount_minor), 0)::bigint AS amount
      FROM portfolio_commissions GROUP BY role, status, currency ORDER BY role, status`),
  ]);
  return {
    totals: { referrals: totals.referrals, creatorsRecruited: totals.creators_recruited, invitations: totals.invitations, invitationsRegistered: totals.invitations_registered },
    referrals: referrals.map((r) => ({
      userId: r.user_id, handle: r.handle, displayName: r.display_name, partnerId: r.partner_id, partnerName: r.partner_name || null,
      partnerHandle: r.partner_handle || null, portfolioManagerName: r.pm_name || null, createdAt: iso(r.created_at),
    })),
    subscriptions: payments.map((p) => ({
      reference: p.reference, kind: p.kind, amountMinor: num(p.amount_minor), currency: p.currency, paidAt: iso(p.paid_at),
      payerHandle: p.handle || null, partnerName: p.partner_name || null,
    })),
    commissions: commissions.map((c) => ({ role: c.role, status: c.status, currency: c.currency, count: c.n, amountMinor: num(c.amount) })),
  };
}

