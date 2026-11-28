// PORTFOLIO & PARTNER MANAGERS (Development Update v1, document A).
//
// Three levels: Super Admin → Portfolio Managers (PM) → Partner Managers (partner) → referred users.
//   • Roles live in portfolio_members (one row per person). recruited_by / appointed_by_admin / invite_id /
//     recruitment_source are written once on joining and never changed: the permanent record of who recruited whom.
//   • Invitations (portfolio_invites) have a unique code. The Super Admin creates PM invites; an active PM creates
//     Partner Manager invites. Share channels: link, email (mailto), WhatsApp, social.
//   • Applications (portfolio_applications): a PM application is decided by the Super Admin; a partner application by
//     the inviting PM (the Super Admin can decide too). Approval is 'manual' or 'auto' (config).
//   • Attribution: a user who joins with a partner's code (their users.invite_code, through the existing referral
//     flow POST /me/referral) is attributed to that partner once, permanently (partner_attributions, first touch wins).
//   • Commissions (portfolio_commissions): on a successful Paystack payment of an eligible kind, the partner earns
//     portfolio_partner_bps (default 10%) of the payment and the partner's PM earns portfolio_pm_bps (default 10%) of
//     that partner commission. Ledgered, idempotent per (payment reference, role), held for portfolio_hold_days,
//     reversible. Donations are never eligible.
//   • Withdrawals: above a minimum, KYC required (lib/kyc.js requireApprovedKyc), paid by hand by an admin who records
//     the reference. Available = matured commissions minus open or paid withdrawals.
//
// Every money amount is in minor units (kobo for NGN), like the rest of the wallet code.
import { q, one } from './db.js';
import { ApiError, bad, notFound, forbidden } from './http.js';
import { getConfig, registerConfig, setConfig } from './wallet.js';
import { requireApprovedKyc, getKyc, kycShape } from './kyc.js';
import { notifyUser } from '../hub.js';

// ─── configuration (admin editable through the Portfolio & Partners tab) ───────────────────────────────────────────
export const ELIGIBLE_KINDS = ['coins', 'dating', 'plus', 'memberships', 'fundme_fees'];
const DEFAULT_ELIGIBLE = { coins: true, dating: true, plus: true, memberships: true, fundme_fees: true };
const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
registerConfig('portfolio_partner_bps', 1000, (v) => int(v, 0, 10000));
registerConfig('portfolio_pm_bps', 1000, (v) => int(v, 0, 10000));
registerConfig('portfolio_hold_days', 7, (v) => int(v, 0, 365));
registerConfig('portfolio_min_withdrawal_minor', 500000, (v) => int(v, 0, 1e12));
registerConfig('portfolio_eligible_kinds', DEFAULT_ELIGIBLE, (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).every((k) => ELIGIBLE_KINDS.includes(k) && typeof v[k] === 'boolean'));
// approval switches are booleans (true = approve automatically, false = manual): string config values are not
// round-tripped by wallet.js getConfig
registerConfig('portfolio_pm_auto_approve', false, (v) => typeof v === 'boolean');
registerConfig('portfolio_partner_auto_approve', false, (v) => typeof v === 'boolean');
registerConfig('portfolio_pm_partner_limit', 100, (v) => int(v, 0, 100000));
registerConfig('portfolio_pm_invite_limit', 50, (v) => int(v, 0, 100000));

export const ROLE_LABEL = { portfolio_manager: 'Portfolio Manager', partner_manager: 'Partner Manager' };
export const ROLE_OF_KIND = { portfolio_manager: 'portfolio_manager', partner_manager: 'partner_manager' };
export const CHANNELS = ['link', 'email', 'whatsapp', 'social', 'manual'];
const DEFAULT_CURRENCY = 'NGN';
const DAY = 86400e3;

export const iso = (d) => (d ? new Date(d).toISOString() : null);
const num = (v) => Number(v || 0);

export async function portfolioConfig(env) {
  const cfg = await getConfig(env);
  return {
    partnerBps: cfg.portfolio_partner_bps,
    pmBps: cfg.portfolio_pm_bps,
    holdDays: cfg.portfolio_hold_days,
    minWithdrawalMinor: cfg.portfolio_min_withdrawal_minor,
    eligibleKinds: { ...DEFAULT_ELIGIBLE, ...(cfg.portfolio_eligible_kinds || {}) },
    pmApproval: cfg.portfolio_pm_auto_approve ? 'auto' : 'manual',
    partnerApproval: cfg.portfolio_partner_auto_approve ? 'auto' : 'manual',
    partnerLimit: cfg.portfolio_pm_partner_limit,
    inviteLimit: cfg.portfolio_pm_invite_limit,
    currency: DEFAULT_CURRENCY,
    raw: cfg,
  };
}

// ─── commission maths (pure, tested) ──────────────────────────────────────────────────────────────────────────────
/** Basis points of an amount, rounded down to the minor unit. */
export const bpsOf = (amountMinor, bps) => Math.floor((Number(amountMinor) * Number(bps)) / 10000);

/**
 * The partner's commission on a payment and the Portfolio Manager's share of it.
 *   partnerMinor   = floor(payment × partnerBps)
 *   portfolioMinor = floor(partnerMinor × pmBps)   — the PM override: 10% of the partner commission by default
 */
export function commissionPlan(baseMinor, { partnerBps, pmBps }) {
  const base = Math.floor(Number(baseMinor));
  if (!Number.isSafeInteger(base) || base < 0) throw new Error('bad payment amount');
  const partnerMinor = bpsOf(base, partnerBps);
  const portfolioMinor = bpsOf(partnerMinor, pmBps);
  return { baseMinor: base, partnerBps, pmBps, partnerMinor, portfolioMinor };
}

/** Which admin "payment kind" a Paystack payment counts as, or null (not eligible by kind: donations and anything else). */
export function kindOfWalletArea(area) {
  return { gifts: 'coins', dating: 'dating', fundme: 'fundme_fees' }[area] || null;
}

/** Eligible payment kind for a paystack_payments row (reads the purchase's product area for wallet packs). */
export async function paymentKindOf(env, p) {
  if (p.kind === 'membership') return 'memberships';
  if (p.kind === 'plus') return 'plus';
  if (p.kind === 'wallet') {
    const row = await one(env, `SELECT pr.area FROM wallet_purchases wp JOIN wallet_products pr ON pr.id = wp.product_id
      WHERE wp.id::text = $1`, [String(p.target_id || '')]);
    return row ? kindOfWalletArea(row.area) : null;
  }
  return null; // donations never earn commission
}

// ─── codes ────────────────────────────────────────────────────────────────────────────────────────────────────────
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I/L, easy to read out
export function newInviteCode(len = 6) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}
export const normCode = (s) => String(s || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

// ─── events (append-only audit) ───────────────────────────────────────────────────────────────────────────────────
export async function logEvent(env, { actor = null, admin = false, action, targetId = null, details = {} }) {
  await q(env, `INSERT INTO portfolio_events (actor_id, actor_admin, action, target_id, details) VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [actor ? actor.id : null, !!admin, action, targetId, JSON.stringify(details)]);
}

async function notify(env, userId, title, body, data = {}) {
  await q(env, `INSERT INTO notifications (user_id, kind, title, body, data) VALUES ($1, 'follow', $2, $3, $4::jsonb)`,
    [userId, title, body, JSON.stringify({ type: 'portfolio', ...data })]).catch(() => {});
  await notifyUser(env, userId, { type: 'portfolio.update', title }).catch(() => {});
}

// ─── members ──────────────────────────────────────────────────────────────────────────────────────────────────────
export const memberOf = (env, userId) => one(env, 'SELECT * FROM portfolio_members WHERE user_id = $1', [userId]);

export async function activeMember(env, userId, role) {
  const m = await memberOf(env, userId);
  if (!m || m.status !== 'active' || (role && m.role !== role)) return null;
  return m;
}

export async function memberShape(env, m) {
  if (!m) return null;
  const u = await one(env, 'SELECT id, display_name, handle, avatar_url, invite_code FROM users WHERE id = $1', [m.user_id]);
  const rec = m.recruited_by ? await one(env, 'SELECT id, display_name, handle FROM users WHERE id = $1', [m.recruited_by]) : null;
  return {
    userId: m.user_id,
    role: m.role,
    roleLabel: ROLE_LABEL[m.role],
    status: m.status,
    displayName: u ? u.display_name : null,
    handle: u ? u.handle : null,
    avatarUrl: u ? u.avatar_url : null,
    recruitedBy: rec ? { id: rec.id, displayName: rec.display_name, handle: rec.handle } : null,
    recruitmentSource: m.recruitment_source,
    appointedByAdmin: !!m.appointed_by_admin,
    inviteId: m.invite_id != null ? String(m.invite_id) : null,
    createdAt: iso(m.created_at),
    approvedAt: iso(m.approved_at),
    suspendedAt: iso(m.suspended_at),
    suspendReason: m.suspend_reason || null,
    code: u ? u.invite_code : null,
  };
}

/** Partner Managers recruited by a PM, with each one's performance. */
export async function partnerRows(env, { pmId = null, status = null, limit = 500 } = {}) {
  const rows = await q(env, `SELECT m.user_id, m.status, m.created_at, m.recruited_by, m.recruitment_source,
        u.display_name, u.handle, u.invite_code,
        (SELECT count(*)::int FROM partner_attributions a WHERE a.partner_id = m.user_id) AS referred,
        (SELECT count(DISTINCT c.payment_reference)::int FROM portfolio_commissions c WHERE c.partner_id = m.user_id AND c.role = 'partner' AND c.status <> 'reversed') AS payments,
        (SELECT COALESCE(sum(c.amount_minor), 0)::bigint FROM portfolio_commissions c WHERE c.recipient_id = m.user_id AND c.role = 'partner' AND c.status <> 'reversed') AS commission_minor,
        (SELECT COALESCE(sum(c.amount_minor), 0)::bigint FROM portfolio_commissions c WHERE c.recipient_id = m.user_id AND c.role = 'partner' AND c.status = 'held') AS held_minor,
        (SELECT COALESCE(sum(c.amount_minor), 0)::bigint FROM portfolio_commissions c WHERE c.recipient_id = m.user_id AND c.role = 'partner' AND c.status = 'available') AS available_minor
      FROM portfolio_members m JOIN users u ON u.id = m.user_id
     WHERE m.role = 'partner_manager' AND ($1::uuid IS NULL OR m.recruited_by = $1::uuid) AND ($2::text IS NULL OR m.status = $2)
     ORDER BY m.created_at DESC LIMIT $3`, [pmId, status, limit]);
  return rows.map((r) => ({
    userId: r.user_id, status: r.status, displayName: r.display_name, handle: r.handle, code: r.invite_code,
    joinedAt: iso(r.created_at), recruitedBy: r.recruited_by, source: r.recruitment_source,
    referredUsers: r.referred, payments: r.payments,
    commissionMinor: num(r.commission_minor), heldMinor: num(r.held_minor), availableMinor: num(r.available_minor),
  }));
}

// ─── balances and withdrawals ─────────────────────────────────────────────────────────────────────────────────────
/** Matured commissions become available as soon as they are read (no cron needed). */
async function matureHeld(env, userId) {
  await q(env, `UPDATE portfolio_commissions SET status = 'available', updated_at = now()
     WHERE recipient_id = $1 AND status = 'held' AND available_at <= now()`, [userId]);
}

/** Per currency: held (waiting), available (withdrawable now), requested/approved (open), paid, earned. */
export async function balances(env, userId) {
  await matureHeld(env, userId);
  const c = await q(env, `SELECT currency,
      COALESCE(sum(amount_minor) FILTER (WHERE status = 'held'), 0)::bigint AS held,
      COALESCE(sum(amount_minor) FILTER (WHERE status = 'available'), 0)::bigint AS available,
      COALESCE(sum(amount_minor) FILTER (WHERE status = 'reversed'), 0)::bigint AS reversed
    FROM portfolio_commissions WHERE recipient_id = $1 GROUP BY currency`, [userId]);
  const w = await q(env, `SELECT currency, status, COALESCE(sum(amount_minor), 0)::bigint AS amount
    FROM portfolio_withdrawals WHERE user_id = $1 GROUP BY currency, status`, [userId]);
  const out = {};
  const slot = (cur) => (out[cur] = out[cur] || { currency: cur, heldMinor: 0, availableMinor: 0, reversedMinor: 0, requestedMinor: 0, paidMinor: 0, withdrawableMinor: 0 });
  for (const r of c) {
    const s = slot(r.currency);
    s.heldMinor = num(r.held); s.availableMinor = num(r.available); s.reversedMinor = num(r.reversed);
  }
  for (const r of w) {
    const s = slot(r.currency);
    if (r.status === 'paid') s.paidMinor = num(r.amount);
    else if (r.status === 'requested' || r.status === 'approved') s.requestedMinor += num(r.amount);
  }
  for (const s of Object.values(out)) {
    // matured commissions, minus money already promised to the member or paid out
    s.withdrawableMinor = Math.max(0, s.availableMinor - s.requestedMinor - s.paidMinor);
    s.earnedMinor = s.heldMinor + s.availableMinor + s.paidMinor + s.requestedMinor;
  }
  return out;
}

export function withdrawalShape(w) {
  return {
    id: String(w.id), amountMinor: num(w.amount_minor), currency: w.currency, status: w.status,
    requestedAt: iso(w.requested_at), decidedAt: iso(w.decided_at), paidAt: iso(w.paid_at),
    note: w.note || null, reference: w.reference || null,
  };
}

export async function requestWithdrawal(env, user, { amountMinor, currency } = {}) {
  const m = await memberOf(env, user.id);
  if (!m) throw forbidden('You are not a Portfolio or Partner Manager', 'NOT_A_MEMBER');
  if (m.status !== 'active') throw forbidden(m.status === 'suspended' ? 'Your account is suspended' : 'Your application is still pending', 'MEMBER_NOT_ACTIVE');
  const amt = Number(amountMinor);
  if (!Number.isSafeInteger(amt) || amt <= 0) throw bad('Enter an amount', 'BAD_AMOUNT');
  const cur = String(currency || DEFAULT_CURRENCY).toUpperCase();
  const cfg = await portfolioConfig(env);
  if (amt < cfg.minWithdrawalMinor) throw bad(`The minimum withdrawal is ${cfg.minWithdrawalMinor}`, 'BELOW_MINIMUM');
  await requireApprovedKyc(env, user.id); // PAYOUT KYC (lib/kyc.js): identity and bank account must be approved first
  await matureHeld(env, user.id);
  // the balance check and the insert are one statement, so two quick requests cannot both take the same money
  const row = await one(env, `INSERT INTO portfolio_withdrawals (user_id, amount_minor, currency, status)
      SELECT $1::uuid, $2::bigint, $3::text, 'requested'
       WHERE $2::bigint <= (
         (SELECT COALESCE(sum(amount_minor), 0) FROM portfolio_commissions WHERE recipient_id = $1::uuid AND currency = $3::text AND status = 'available')
         - (SELECT COALESCE(sum(amount_minor), 0) FROM portfolio_withdrawals WHERE user_id = $1::uuid AND currency = $3::text AND status IN ('requested','approved','paid')))
      RETURNING *`, [user.id, amt, cur]);
  if (!row) throw new ApiError(400, 'INSUFFICIENT_BALANCE', 'That is more than your available balance');
  await notify(env, user.id, 'Withdrawal requested', `We received your request to withdraw ${cur} ${(amt / 100).toFixed(2)}. Our team will review it.`, { screen: 'PortfolioHome' });
  return withdrawalShape(row);
}

export async function decideWithdrawal(env, admin, id, action, { note = null, reference = null } = {}) {
  const w = await one(env, 'SELECT * FROM portfolio_withdrawals WHERE id = $1', [id]);
  if (!w) throw notFound('Withdrawal not found');
  const text = note ? String(note).slice(0, 500) : null;
  if (action === 'approve') {
    if (w.status !== 'requested') throw new ApiError(409, 'WITHDRAWAL_STATE', `This request is ${w.status}`);
    await requireApprovedKyc(env, w.user_id);
    await q(env, `UPDATE portfolio_withdrawals SET status = 'approved', note = COALESCE($2, note), decided_by = $3, decided_by_admin = true, decided_at = now()
      WHERE id = $1 AND status = 'requested'`, [id, text, admin.id]);
  } else if (action === 'reject') {
    if (!['requested', 'approved'].includes(w.status)) throw new ApiError(409, 'WITHDRAWAL_STATE', `This request is ${w.status}`);
    if (!text || text.length < 5) throw bad('Give a reason (at least 5 characters): the member sees it', 'REASON_REQUIRED');
    await q(env, `UPDATE portfolio_withdrawals SET status = 'rejected', note = $2, decided_by = $3, decided_by_admin = true, decided_at = now()
      WHERE id = $1 AND status IN ('requested','approved')`, [id, text, admin.id]);
  } else if (action === 'paid') {
    if (w.status !== 'approved') throw new ApiError(409, 'WITHDRAWAL_STATE', w.status === 'paid' ? 'Already marked paid' : 'Approve the request first');
    const ref = String(reference || '').trim();
    if (ref.length < 3 || ref.length > 120) throw bad('Enter the payment reference', 'REFERENCE_REQUIRED');
    await q(env, `UPDATE portfolio_withdrawals SET status = 'paid', reference = $2, note = COALESCE($3, note), paid_at = now(), decided_by = $4, decided_by_admin = true,
      decided_at = COALESCE(decided_at, now()) WHERE id = $1 AND status = 'approved'`, [id, ref, text, admin.id]);
  } else throw bad('action must be approve, reject or paid');
  await logEvent(env, { actor: admin, admin: true, action: `withdrawal.${action}`, targetId: w.user_id, details: { withdrawalId: String(id), reference, amountMinor: num(w.amount_minor), currency: w.currency } });
  const titles = { approve: 'Withdrawal approved', reject: 'Withdrawal not approved', paid: 'Withdrawal paid' };
  await notify(env, w.user_id, titles[action], action === 'reject' ? text : action === 'paid' ? `Reference: ${reference}` : 'Our team is processing your payment.', { screen: 'PortfolioHome' });
  return withdrawalShape(await one(env, 'SELECT * FROM portfolio_withdrawals WHERE id = $1', [id]));
}

// ─── commissions ──────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Called once from paystackCheckout.settlePayment after a payment was granted. Idempotent: a payment reference yields
 * at most one 'partner' and one 'portfolio' row, however often this runs.
 */
export async function recordPaymentCommissions(env, p) {
  if (!p || !p.reference || !p.user_id || p.test) return { skipped: 'not_eligible_payment' };
  const attr = await one(env, 'SELECT * FROM partner_attributions WHERE user_id = $1', [p.user_id]);
  if (!attr) return { skipped: 'not_referred' };
  const kind = await paymentKindOf(env, p);
  const cfg = await portfolioConfig(env);
  if (!kind || !cfg.eligibleKinds[kind]) return { skipped: 'kind_not_eligible', kind };
  const partner = await activeMember(env, attr.partner_id, 'partner_manager');
  if (!partner) return { skipped: 'partner_not_active' };
  const plan = commissionPlan(Number(p.amount_minor), cfg);
  const pm = attr.portfolio_manager_id ? await activeMember(env, attr.portfolio_manager_id, 'portfolio_manager') : null;
  const availableAt = new Date(Date.now() + cfg.holdDays * DAY).toISOString();
  const currency = String(p.currency || DEFAULT_CURRENCY).toUpperCase();
  const out = { partnerMinor: 0, portfolioMinor: 0, pmId: pm ? pm.user_id : null, plan };
  if (plan.partnerMinor > 0) {
    const r = await one(env, `INSERT INTO portfolio_commissions (payment_reference, role, recipient_id, source_user_id, partner_id, payment_kind,
        base_minor, rate_bps, amount_minor, currency, status, available_at)
      VALUES ($1, 'partner', $2, $3, $2, $4, $5, $6, $7, $8, 'held', $9) ON CONFLICT (payment_reference, role) DO NOTHING RETURNING id`,
    [p.reference, partner.user_id, p.user_id, kind, plan.baseMinor, plan.partnerBps, plan.partnerMinor, currency, availableAt]);
    if (r) out.partnerMinor = plan.partnerMinor;
  }
  if (pm && plan.portfolioMinor > 0) {
    const r = await one(env, `INSERT INTO portfolio_commissions (payment_reference, role, recipient_id, source_user_id, partner_id, payment_kind,
        base_minor, rate_bps, amount_minor, currency, status, available_at)
      VALUES ($1, 'portfolio', $2, $3, $4, $5, $6, $7, $8, $9, 'held', $10) ON CONFLICT (payment_reference, role) DO NOTHING RETURNING id`,
    [p.reference, pm.user_id, p.user_id, partner.user_id, kind, plan.partnerMinor, plan.pmBps, plan.portfolioMinor, currency, availableAt]);
    if (r) out.portfolioMinor = plan.portfolioMinor;
  }
  if (out.partnerMinor) await notify(env, partner.user_id, 'Commission earned', `You earned a commission on a referred member's payment. It becomes withdrawable after ${cfg.holdDays} days.`, { screen: 'PortfolioHome' }).catch(() => {});
  return out;
}

/** Reversal (refund or chargeback): every commission of that payment that is not yet reversed. Ledger-safe: the balance
 *  simply drops by the reversed amount; money already paid out becomes a negative balance that future earnings repay. */
export async function reversePaymentCommissions(env, { reference, actor = null, admin = false, reason = 'Reversed' }) {
  const rows = await q(env, `UPDATE portfolio_commissions SET status = 'reversed', reversed_reason = $2, updated_at = now()
     WHERE payment_reference = $1 AND status <> 'reversed' RETURNING id, role, recipient_id, amount_minor, currency`, [String(reference), String(reason).slice(0, 300)]);
  if (rows.length) await logEvent(env, { actor, admin, action: 'commission.reversed', targetId: rows[0].recipient_id, details: { reference, rows: rows.map((r) => ({ id: String(r.id), role: r.role, amountMinor: num(r.amount_minor), currency: r.currency })) } });
  return rows;
}

export function commissionShape(c) {
  return {
    id: String(c.id), role: c.role, paymentReference: c.payment_reference, kind: c.payment_kind, status: c.status,
    baseMinor: num(c.base_minor), rateBps: c.rate_bps, amountMinor: num(c.amount_minor), currency: c.currency,
    availableAt: iso(c.available_at), createdAt: iso(c.created_at), reversedReason: c.reversed_reason || null,
  };
}

// ─── referral attribution (called from routes/referrals.js POST /me/referral) ─────────────────────────────────────
/** First touch wins: one row per user, never updated. Only an active Partner Manager's code attributes. */
export async function attributePartner(env, userId, inviterId) {
  if (!inviterId || inviterId === userId) return { attributed: false, reason: 'self' };
  const partner = await activeMember(env, inviterId, 'partner_manager');
  if (!partner) return { attributed: false, reason: 'not_partner' };
  const inv = await one(env, 'SELECT invite_code FROM users WHERE id = $1', [inviterId]);
  const r = await one(env, `INSERT INTO partner_attributions (user_id, partner_id, portfolio_manager_id, code) VALUES ($1,$2,$3,$4)
    ON CONFLICT (user_id) DO NOTHING RETURNING user_id`, [userId, inviterId, partner.recruited_by, inv ? inv.invite_code : null]);
  return r ? { attributed: true, partnerId: inviterId, portfolioManagerId: partner.recruited_by } : { attributed: false, reason: 'already_attributed' };
}

// ─── invitations ──────────────────────────────────────────────────────────────────────────────────────────────────
/** Share links for a URL: WhatsApp, email compose (mailto), Facebook and X. No email service is involved. */
export function shareLinks(kind, url) {
  const subject = kind === 'partner_manager' ? 'Join me as a Partner Manager on BibleNestra' : kind === 'portfolio_manager' ? 'Join BibleNestra as a Portfolio Manager' : 'Join me on BibleNestra';
  const text = kind === 'partner_manager'
    ? 'I invite you to become a Partner Manager on BibleNestra. Invite people to the app and earn commissions on their payments.'
    : kind === 'portfolio_manager'
      ? 'I invite you to become a Portfolio Manager on BibleNestra. Recruit Partner Managers and earn commissions on their earnings.'
      : 'Read the Bible, pray and chat with believers on BibleNestra.';
  const enc = encodeURIComponent;
  return {
    link: url,
    whatsapp: `https://wa.me/?text=${enc(`${text} ${url}`)}`,
    email: `mailto:?subject=${enc(subject)}&body=${enc(`${text}\n\n${url}`)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`,
    x: `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}`,
  };
}

export function inviteShape(inv, origin = '') {
  const path = inv.kind === 'partner_manager' ? `/partner/invite/${inv.code}` : `/portfolio/invite/${inv.code}`;
  const url = `${origin}${path}`;
  return {
    id: String(inv.id), code: inv.code, kind: inv.kind, kindLabel: ROLE_LABEL[ROLE_OF_KIND[inv.kind]],
    channel: inv.channel, email: inv.email || null, label: inv.label || null,
    uses: inv.uses, maxUses: inv.max_uses, expiresAt: iso(inv.expires_at), revoked: !!inv.revoked,
    createdAt: iso(inv.created_at), createdByAdmin: !!inv.created_by_admin, portfolioManagerId: inv.portfolio_manager_id || null,
    link: url,
    share: shareLinks(inv.kind, url),
  };
}

export function inviteIsOpen(inv, now = Date.now()) {
  if (!inv || inv.revoked) return false;
  if (inv.expires_at && new Date(inv.expires_at).getTime() < now) return false;
  if (inv.max_uses != null && inv.uses >= inv.max_uses) return false;
  return true;
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,24}$/;

/** Creates an invite. PM invites: Super Admin only. Partner invites: an active PM, within the PM's invite limit. */
export async function createInvite(env, creator, { kind, channel = 'link', email = null, label = null, maxUses = null, expiresInDays = null, byAdmin = false }) {
  if (!ROLE_OF_KIND[kind]) throw bad('kind must be portfolio_manager or partner_manager', 'BAD_KIND');
  if (!CHANNELS.includes(channel)) throw bad('Choose a channel: link, email, whatsapp, social', 'BAD_CHANNEL');
  let mail = null;
  if (email) {
    mail = String(email).trim().toLowerCase();
    if (!EMAIL_RE.test(mail)) throw bad('That email address does not look right', 'BAD_EMAIL');
  }
  const cap = maxUses == null || maxUses === '' ? null : Number(maxUses);
  if (cap != null && (!Number.isInteger(cap) || cap < 1 || cap > 100000)) throw bad('Max uses must be a whole number from 1 to 100000', 'BAD_MAX_USES');
  const days = expiresInDays == null || expiresInDays === '' ? null : Number(expiresInDays);
  if (days != null && (!Number.isInteger(days) || days < 1 || days > 3650)) throw bad('Expiry must be 1 to 3650 days', 'BAD_EXPIRY');
  const expires = days ? new Date(Date.now() + days * DAY).toISOString() : null;
  let pmId = null;
  if (kind === 'partner_manager') {
    if (byAdmin) throw bad('Partner Manager invites are created by a Portfolio Manager', 'PM_ONLY');
    const pm = await activeMember(env, creator.id, 'portfolio_manager');
    if (!pm) throw forbidden('Only an active Portfolio Manager can invite Partner Managers', 'PM_ONLY');
    const cfg = await portfolioConfig(env);
    const open = await one(env, `SELECT count(*)::int AS n FROM portfolio_invites WHERE portfolio_manager_id = $1 AND revoked = false
      AND (expires_at IS NULL OR expires_at > now())`, [creator.id]);
    if (open && open.n >= cfg.inviteLimit) throw new ApiError(409, 'INVITE_LIMIT', `You can have ${cfg.inviteLimit} open invitations at once. Revoke one or wait for one to expire.`);
    pmId = creator.id;
  } else if (!byAdmin) throw forbidden('Only the Super Admin creates Portfolio Manager invites', 'ADMIN_ONLY');
  let inv = null;
  for (let i = 0; i < 6 && !inv; i++) {
    try {
      inv = await one(env, `INSERT INTO portfolio_invites (code, kind, portfolio_manager_id, created_by, created_by_admin, channel, email, label, max_uses, expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [newInviteCode(), kind, pmId, creator.id, !!byAdmin, channel, mail, label ? String(label).slice(0, 120) : null, cap, expires]);
    } catch (e) {
      if (!/unique|duplicate/i.test(String(e.message))) throw e; // code collision → another code
    }
  }
  if (!inv) throw new ApiError(500, 'INVITE_CODE', 'Could not create an invitation, please try again');
  await logEvent(env, { actor: creator, admin: !!byAdmin, action: 'invite.created', targetId: creator.id, details: { code: inv.code, kind, channel } });
  return inv;
}

export async function revokeInvite(env, actor, id, { admin = false } = {}) {
  const inv = await one(env, 'SELECT * FROM portfolio_invites WHERE id = $1', [id]);
  if (!inv) throw notFound('Invitation not found');
  if (!admin && inv.portfolio_manager_id !== actor.id) throw forbidden('That invitation is not yours', 'NOT_YOURS');
  const r = await one(env, 'UPDATE portfolio_invites SET revoked = true WHERE id = $1 RETURNING *', [id]);
  await logEvent(env, { actor, admin, action: 'invite.revoked', targetId: inv.portfolio_manager_id || actor.id, details: { code: inv.code } });
  return r;
}

export async function publicInviteInfo(env, code) {
  const inv = await one(env, 'SELECT i.*, u.display_name AS inviter_name FROM portfolio_invites i LEFT JOIN users u ON u.id = i.portfolio_manager_id WHERE i.code = $1', [normCode(code)]);
  if (!inv) return null;
  const cfg = await portfolioConfig(env);
  return {
    code: inv.code, kind: inv.kind, kindLabel: ROLE_LABEL[ROLE_OF_KIND[inv.kind]], open: inviteIsOpen(inv),
    inviterName: inv.kind === 'partner_manager' ? inv.inviter_name || null : null,
    commission: { partnerPercent: cfg.partnerBps / 100, pmPercent: cfg.pmBps / 100, holdDays: cfg.holdDays, currency: cfg.currency },
    minWithdrawalMinor: cfg.minWithdrawalMinor,
  };
}

// ─── applications ─────────────────────────────────────────────────────────────────────────────────────────────────
function cleanAnswers(a = {}) {
  const s = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
  const out = { fullName: s(a.fullName, 120), phone: s(a.phone, 30), country: s(a.country, 60), city: s(a.city, 60), experience: s(a.experience, 1000), motivation: s(a.motivation, 1000), channels: s(a.channels, 300) };
  if (out.fullName.length < 3) throw bad('Enter your full name', 'BAD_NAME');
  if (out.motivation.length < 10) throw bad('Tell us a little about why you want to join (at least 10 characters)', 'BAD_MOTIVATION');
  return out;
}

async function partnerSlotsUsed(env, pmId, exceptUserId = null) {
  const r = await one(env, `SELECT count(*)::int AS n FROM portfolio_members WHERE recruited_by = $1 AND role = 'partner_manager'
    AND status IN ('pending','active') AND ($2::uuid IS NULL OR user_id <> $2::uuid)`, [pmId, exceptUserId]);
  return r ? r.n : 0;
}

/** A user opens an invite code and applies. Returns the application and the member's status. */
export async function applyWithInvite(env, user, { code, answers } = {}) {
  const inv = await one(env, 'SELECT * FROM portfolio_invites WHERE code = $1', [normCode(code)]);
  if (!inv) throw notFound('That invitation was not found');
  if (!inviteIsOpen(inv)) throw new ApiError(410, 'INVITE_CLOSED', 'This invitation is no longer open');
  const existing = await memberOf(env, user.id);
  if (existing) {
    if (existing.status === 'pending') {
      const app = await one(env, `SELECT * FROM portfolio_applications WHERE applicant_id = $1 AND status = 'pending'`, [user.id]);
      return { application: app ? applicationShape(app) : null, member: await memberShape(env, existing), alreadyApplied: true };
    }
    throw new ApiError(409, 'ALREADY_MEMBER', 'You already have a Portfolio or Partner Manager role');
  }
  let pmId = null;
  if (inv.kind === 'partner_manager') {
    const pm = await activeMember(env, inv.portfolio_manager_id, 'portfolio_manager');
    if (!pm) throw new ApiError(410, 'INVITE_CLOSED', 'The Portfolio Manager who invited you is not active');
    pmId = pm.user_id;
    const cfg = await portfolioConfig(env);
    if (await partnerSlotsUsed(env, pmId) >= cfg.partnerLimit) throw new ApiError(409, 'LIMIT_REACHED', 'This Portfolio Manager has reached their Partner Manager limit');
  }
  const cleaned = cleanAnswers(answers);
  const cfg = await portfolioConfig(env);
  const approval = inv.kind === 'partner_manager' ? cfg.partnerApproval : cfg.pmApproval;
  // claim the invite use first: a full invite never admits a late applicant
  const used = await one(env, `UPDATE portfolio_invites SET uses = uses + 1 WHERE id = $1 AND revoked = false
      AND (max_uses IS NULL OR uses < max_uses) RETURNING id`, [inv.id]);
  if (!used) throw new ApiError(410, 'INVITE_CLOSED', 'This invitation is no longer open');
  let app; let mem;
  try {
    app = await one(env, `INSERT INTO portfolio_applications (invite_id, applicant_id, kind, approver_id, answers)
        VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (applicant_id) WHERE status = 'pending' DO NOTHING RETURNING *`,
    [inv.id, user.id, inv.kind, pmId, JSON.stringify(cleaned)]);
    if (!app) throw new ApiError(409, 'ALREADY_APPLIED', 'You already have an application waiting');
    mem = await one(env, `INSERT INTO portfolio_members (user_id, role, status, recruited_by, appointed_by_admin, recruitment_source, invite_id)
        VALUES ($1,$2,'pending',$3,NULL,$4,$5) ON CONFLICT (user_id) DO NOTHING RETURNING *`,
    [user.id, ROLE_OF_KIND[inv.kind], pmId, `invite:${inv.channel}`, inv.id]);
    if (!mem) throw new ApiError(409, 'ALREADY_MEMBER', 'You already have a Portfolio or Partner Manager role');
  } catch (e) {
    // give the invite use back and drop a half-made application
    await q(env, 'UPDATE portfolio_invites SET uses = GREATEST(uses - 1, 0) WHERE id = $1', [inv.id]).catch(() => {});
    if (app && !mem) await q(env, 'DELETE FROM portfolio_applications WHERE id = $1', [app.id]).catch(() => {});
    throw e;
  }
  await logEvent(env, { actor: user, action: 'application.submitted', targetId: user.id, details: { applicationId: String(app.id), kind: inv.kind, inviteCode: inv.code } });
  if (approval === 'auto') {
    const done = await decideApplication(env, null, app.id, 'approve', { auto: true });
    return { application: done.application, member: done.member, autoApproved: true };
  }
  return { application: applicationShape(app), member: await memberShape(env, mem) };
}

export function applicationShape(a) {
  return {
    id: String(a.id), kind: a.kind, status: a.status, applicantId: a.applicant_id, approverId: a.approver_id || null,
    answers: a.answers || {}, reason: a.reason || null, createdAt: iso(a.created_at), decidedAt: iso(a.decided_at),
    decidedByAdmin: !!a.decided_by_admin,
  };
}

/** Approve or reject a pending application. actor = null for automatic approval. Admins may decide any application. */
export async function decideApplication(env, actor, id, action, { reason = null, auto = false, admin = false } = {}) {
  const app = await one(env, 'SELECT * FROM portfolio_applications WHERE id = $1', [id]);
  if (!app) throw notFound('Application not found');
  if (!auto) {
    const allowed = admin || (actor && app.approver_id && app.approver_id === actor.id && await activeMember(env, actor.id, 'portfolio_manager'));
    if (!allowed) throw forbidden('This application is decided by another approver', 'NOT_YOUR_APPLICATION');
  }
  if (app.status !== 'pending') throw new ApiError(409, 'APPLICATION_STATE', `This application is already ${app.status}`);
  const member = await memberOf(env, app.applicant_id);
  if (action === 'approve') {
    if (app.kind === 'partner_manager' && app.approver_id) {
      const cfg = await portfolioConfig(env);
      if (await partnerSlotsUsed(env, app.approver_id, app.applicant_id) >= cfg.partnerLimit) throw new ApiError(409, 'LIMIT_REACHED', 'This Portfolio Manager has reached their Partner Manager limit');
    }
    const upd = await one(env, `UPDATE portfolio_applications SET status = 'approved', decided_by = $2, decided_by_admin = $3, decided_at = now()
        WHERE id = $1 AND status = 'pending' RETURNING *`, [id, actor ? actor.id : null, !!(admin || auto)]);
    if (!upd) throw new ApiError(409, 'APPLICATION_STATE', 'This application was just decided');
    await q(env, `UPDATE portfolio_members SET status = 'active', approved_by = $2, approved_at = now(), updated_at = now(),
        appointed_by_admin = CASE WHEN $3 AND role = 'portfolio_manager' THEN $2 ELSE appointed_by_admin END
      WHERE user_id = $1 AND status = 'pending'`, [app.applicant_id, actor ? actor.id : null, !!(admin || auto)]);
    await logEvent(env, { actor, admin: !!(admin || auto), action: 'application.approved', targetId: app.applicant_id, details: { applicationId: String(id), kind: app.kind, auto } });
    await notify(env, app.applicant_id, 'Welcome to the team', `Your ${ROLE_LABEL[ROLE_OF_KIND[app.kind]]} application was approved. Open your dashboard in Profile.`, { screen: 'PortfolioHome' });
    return { application: applicationShape(upd), member: await memberShape(env, await memberOf(env, app.applicant_id)) };
  }
  if (action !== 'reject') throw bad('action must be approve or reject');
  const text = String(reason || '').trim().slice(0, 500);
  if (text.length < 3) throw bad('Give a reason (the applicant sees it)', 'REASON_REQUIRED');
  const upd = await one(env, `UPDATE portfolio_applications SET status = 'rejected', reason = $2, decided_by = $3, decided_by_admin = $4, decided_at = now()
      WHERE id = $1 AND status = 'pending' RETURNING *`, [id, text, actor ? actor.id : null, !!admin]);
  if (!upd) throw new ApiError(409, 'APPLICATION_STATE', 'This application was just decided');
  // the pending member row goes; the application keeps the permanent record of who applied, through which invite and who decided
  await q(env, `DELETE FROM portfolio_members WHERE user_id = $1 AND status = 'pending'`, [app.applicant_id]);
  await logEvent(env, { actor, admin: !!admin, action: 'application.rejected', targetId: app.applicant_id, details: { applicationId: String(id), kind: app.kind, reason: text } });
  await notify(env, app.applicant_id, 'Application not approved', text, { screen: 'PortfolioApply' });
  return { application: applicationShape(upd), member: null };
}

/** Super Admin: suspend or reactivate a member. Suspended members earn nothing new and cannot withdraw. */
export async function setMemberStatus(env, admin, userId, action, reason = null) {
  const m = await memberOf(env, userId);
  if (!m) throw notFound('Member not found');
  if (action === 'suspend') {
    if (m.status !== 'active') throw new ApiError(409, 'MEMBER_STATE', `This member is ${m.status}`);
    const text = String(reason || '').trim().slice(0, 300);
    if (text.length < 3) throw bad('Give a reason for the suspension', 'REASON_REQUIRED');
    await q(env, `UPDATE portfolio_members SET status = 'suspended', suspended_at = now(), suspended_by = $2, suspend_reason = $3, updated_at = now() WHERE user_id = $1`, [userId, admin.id, text]);
    await notify(env, userId, 'Account suspended', text, { screen: 'PortfolioHome' });
  } else if (action === 'reactivate') {
    if (m.status !== 'suspended') throw new ApiError(409, 'MEMBER_STATE', `This member is ${m.status}`);
    await q(env, `UPDATE portfolio_members SET status = 'active', updated_at = now() WHERE user_id = $1`, [userId]);
    await notify(env, userId, 'Account reactivated', 'Your Portfolio & Partners account is active again.', { screen: 'PortfolioHome' });
  } else throw bad('action must be suspend or reactivate');
  await logEvent(env, { actor: admin, admin: true, action: action === 'suspend' ? 'member.suspended' : 'member.reactivated', targetId: userId, details: { reason: reason || null } });
  return memberShape(env, await memberOf(env, userId));
}

/** Super Admin: appoint a PM directly, or add a Partner Manager under a PM. Accepts a user id or @handle. */
export async function appointMember(env, admin, { userId = null, handle = null, role = 'portfolio_manager', recruitedBy = null }) {
  if (!ROLE_OF_KIND[role]) throw bad('role must be portfolio_manager or partner_manager', 'BAD_ROLE');
  let u = null;
  if (userId) u = await one(env, 'SELECT id, banned FROM users WHERE id = $1', [userId]);
  else if (handle) u = await one(env, 'SELECT id, banned FROM users WHERE lower(handle) = lower($1)', [String(handle).replace(/^@/, '')]);
  if (!u) throw notFound('No account with that user id or handle. The person must sign up in the app first.');
  if (u.banned) throw bad('That account is suspended', 'BANNED');
  if (await memberOf(env, u.id)) throw new ApiError(409, 'ALREADY_MEMBER', 'That person already has a Portfolio or Partner Manager role');
  let pm = null;
  if (role === 'partner_manager') {
    if (!recruitedBy) throw bad('Choose the Portfolio Manager who recruits this Partner Manager', 'PM_REQUIRED');
    pm = await activeMember(env, recruitedBy, 'portfolio_manager');
    if (!pm) throw bad('That Portfolio Manager is not active', 'PM_NOT_ACTIVE');
    const cfg = await portfolioConfig(env);
    if (await partnerSlotsUsed(env, pm.user_id) >= cfg.partnerLimit) throw new ApiError(409, 'LIMIT_REACHED', 'This Portfolio Manager has reached their Partner Manager limit');
  }
  const row = await one(env, `INSERT INTO portfolio_members (user_id, role, status, appointed_by_admin, recruited_by, recruitment_source, approved_by, approved_at)
      VALUES ($1,$2,'active',$3,$4,$5,$3,now()) RETURNING user_id`,
  [u.id, role, admin.id, pm ? pm.user_id : null, pm ? 'admin_manual_under_pm' : 'admin_manual']);
  await logEvent(env, { actor: admin, admin: true, action: 'member.appointed', targetId: u.id, details: { role, recruitedBy: pm ? pm.user_id : null } });
  await notify(env, u.id, `You are now a ${ROLE_LABEL[role]}`, 'Open Profile to see your Portfolio & Partners dashboard.', { screen: 'PortfolioHome' });
  return memberShape(env, await memberOf(env, row.user_id));
}

// ─── dashboards and statements ────────────────────────────────────────────────────────────────────────────────────
export async function meSummary(env, user, origin = '') {
  const m = await memberOf(env, user.id);
  const pending = await one(env, `SELECT * FROM portfolio_applications WHERE applicant_id = $1 AND status = 'pending'`, [user.id]);
  const cfg = await portfolioConfig(env);
  const code = m ? (await one(env, 'SELECT invite_code FROM users WHERE id = $1', [user.id]))?.invite_code || null : null;
  return {
    member: m ? await memberShape(env, m) : null,
    isPortfolioManager: !!m && m.role === 'portfolio_manager',
    isPartnerManager: !!m && m.role === 'partner_manager',
    isActive: !!m && m.status === 'active',
    pendingApplication: pending ? applicationShape(pending) : null,
    landingUrl: m && m.role === 'partner_manager' && code ? `${origin}/p/${code}` : null,
    commission: { partnerPercent: cfg.partnerBps / 100, pmPercent: cfg.pmBps / 100, holdDays: cfg.holdDays, currency: cfg.currency },
  };
}

export async function pmDashboard(env, user, origin = '') {
  const pm = await activeMember(env, user.id, 'portfolio_manager');
  if (!pm) throw forbidden('Portfolio Managers only', 'PM_ONLY');
  const cfg = await portfolioConfig(env);
  const [bal, partners, invites, applications, withdrawals, slots, attributed] = await Promise.all([
    balances(env, user.id),
    partnerRows(env, { pmId: user.id }),
    q(env, 'SELECT * FROM portfolio_invites WHERE portfolio_manager_id = $1 ORDER BY created_at DESC LIMIT 100', [user.id]),
    q(env, `SELECT a.*, u.display_name, u.handle FROM portfolio_applications a JOIN users u ON u.id = a.applicant_id
        WHERE a.approver_id = $1 AND a.status = 'pending' ORDER BY a.created_at`, [user.id]),
    q(env, 'SELECT * FROM portfolio_withdrawals WHERE user_id = $1 ORDER BY requested_at DESC LIMIT 50', [user.id]),
    partnerSlotsUsed(env, user.id),
    one(env, 'SELECT count(*)::int AS n FROM partner_attributions WHERE portfolio_manager_id = $1', [user.id]),
  ]);
  const kyc = await getKyc(env, user.id);
  return {
    member: await memberShape(env, pm),
    earnings: Object.values(bal),
    partners,
    limits: { partnerLimit: cfg.partnerLimit, partnerSlotsUsed: slots, inviteLimit: cfg.inviteLimit },
    referredUsers: attributed ? attributed.n : 0,
    invites: invites.map((i) => inviteShape(i, origin)),
    applications: applications.map((a) => ({ ...applicationShape(a), applicant: { displayName: a.display_name, handle: a.handle } })),
    withdrawals: withdrawals.map(withdrawalShape),
    kyc: kycShape(kyc),
    minWithdrawalMinor: cfg.minWithdrawalMinor,
    commission: { partnerPercent: cfg.partnerBps / 100, pmPercent: cfg.pmBps / 100, holdDays: cfg.holdDays },
  };
}

export async function partnerDashboard(env, user, origin = '') {
  const pn = await activeMember(env, user.id, 'partner_manager');
  if (!pn) throw forbidden('Partner Managers only', 'PARTNER_ONLY');
  const cfg = await portfolioConfig(env);
  const code = (await one(env, 'SELECT invite_code FROM users WHERE id = $1', [user.id])).invite_code;
  const [bal, counts, recent, withdrawals] = await Promise.all([
    balances(env, user.id),
    one(env, `SELECT (SELECT count(*)::int FROM partner_attributions WHERE partner_id = $1) AS referred,
        (SELECT count(DISTINCT payment_reference)::int FROM portfolio_commissions WHERE partner_id = $1 AND role = 'partner' AND status <> 'reversed') AS payments`, [user.id]),
    q(env, `SELECT * FROM portfolio_commissions WHERE recipient_id = $1 AND role = 'partner' ORDER BY created_at DESC LIMIT 30`, [user.id]),
    q(env, 'SELECT * FROM portfolio_withdrawals WHERE user_id = $1 ORDER BY requested_at DESC LIMIT 30', [user.id]),
  ]);
  const kyc = await getKyc(env, user.id);
  return {
    member: await memberShape(env, pn),
    landingUrl: `${origin}/p/${code}`,
    code,
    share: shareLinks('partner_manager', `${origin}/p/${code}`),
    referredUsers: counts.referred,
    eligiblePayments: counts.payments,
    earnings: Object.values(bal),
    commissions: recent.map(commissionShape),
    withdrawals: withdrawals.map(withdrawalShape),
    kyc: kycShape(kyc),
    minWithdrawalMinor: cfg.minWithdrawalMinor,
    eligibleKinds: cfg.eligibleKinds,
    commission: { partnerPercent: cfg.partnerBps / 100, holdDays: cfg.holdDays },
  };
}

function monthBounds(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)) : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  if (month && !m) throw bad('month must be YYYY-MM', 'BAD_MONTH');
  const start = new Date(d); const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return { label: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`, start: start.toISOString(), end: end.toISOString() };
}
export { monthBounds };

/** Monthly statement for a member: commissions by role and status, withdrawals requested, balances now. */
export async function statement(env, userId, month) {
  const mb = monthBounds(month);
  const [lines, wd, bal] = await Promise.all([
    q(env, `SELECT role, status, currency, count(*)::int AS n, COALESCE(sum(amount_minor), 0)::bigint AS amount
        FROM portfolio_commissions WHERE recipient_id = $1 AND created_at >= $2 AND created_at < $3 GROUP BY role, status, currency ORDER BY role, status`, [userId, mb.start, mb.end]),
    q(env, `SELECT status, currency, count(*)::int AS n, COALESCE(sum(amount_minor), 0)::bigint AS amount
        FROM portfolio_withdrawals WHERE user_id = $1 AND requested_at >= $2 AND requested_at < $3 GROUP BY status, currency`, [userId, mb.start, mb.end]),
    balances(env, userId),
  ]);
  return {
    month: mb.label,
    commissions: lines.map((l) => ({ role: l.role, status: l.status, currency: l.currency, count: l.n, amountMinor: num(l.amount) })),
    withdrawals: wd.map((l) => ({ status: l.status, currency: l.currency, count: l.n, amountMinor: num(l.amount) })),
    balances: Object.values(bal),
    generatedAt: new Date().toISOString(),
  };
}

// ─── admin reporting ──────────────────────────────────────────────────────────────────────────────────────────────
export async function overview(env) {
  const r = await one(env, `SELECT
      (SELECT count(*)::int FROM portfolio_members WHERE role = 'portfolio_manager' AND status = 'active') AS pm_active,
      (SELECT count(*)::int FROM portfolio_members WHERE role = 'portfolio_manager' AND status = 'suspended') AS pm_suspended,
      (SELECT count(*)::int FROM portfolio_members WHERE role = 'partner_manager' AND status = 'active') AS partner_active,
      (SELECT count(*)::int FROM portfolio_members WHERE role = 'partner_manager' AND status = 'pending') AS partner_pending,
      (SELECT count(*)::int FROM portfolio_applications WHERE status = 'pending') AS applications_pending,
      (SELECT count(*)::int FROM partner_attributions) AS referred_users,
      (SELECT COALESCE(sum(amount_minor),0)::bigint FROM portfolio_commissions WHERE status <> 'reversed' AND role = 'partner') AS partner_commissions,
      (SELECT COALESCE(sum(amount_minor),0)::bigint FROM portfolio_commissions WHERE status <> 'reversed' AND role = 'portfolio') AS pm_commissions,
      (SELECT COALESCE(sum(amount_minor),0)::bigint FROM portfolio_withdrawals WHERE status = 'paid') AS paid_out,
      (SELECT count(*)::int FROM portfolio_withdrawals WHERE status IN ('requested','approved')) AS withdrawals_open`);
  return {
    portfolioManagers: { active: r.pm_active, suspended: r.pm_suspended },
    partnerManagers: { active: r.partner_active, pending: r.partner_pending },
    applicationsPending: r.applications_pending,
    referredUsers: r.referred_users,
    commissionsMinor: { partner: num(r.partner_commissions), portfolio: num(r.pm_commissions), paidOut: num(r.paid_out) },
    withdrawalsOpen: r.withdrawals_open,
  };
}

export async function report(env, month) {
  const mb = monthBounds(month);
  const [rows, pmRows, attrib] = await Promise.all([
    q(env, `SELECT role, status, currency, count(*)::int AS n, COALESCE(sum(amount_minor),0)::bigint AS amount, count(DISTINCT payment_reference)::int AS payments
        FROM portfolio_commissions WHERE created_at >= $1 AND created_at < $2 GROUP BY role, status, currency ORDER BY role, status`, [mb.start, mb.end]),
    q(env, `SELECT u.id, u.display_name, u.handle,
        (SELECT count(*)::int FROM partner_attributions a WHERE a.portfolio_manager_id = u.id AND a.created_at >= $1 AND a.created_at < $2) AS referred_new,
        (SELECT COALESCE(sum(c.amount_minor),0)::bigint FROM portfolio_commissions c WHERE c.recipient_id = u.id AND c.role = 'portfolio' AND c.status <> 'reversed' AND c.created_at >= $1 AND c.created_at < $2) AS pm_commission
      FROM portfolio_members m JOIN users u ON u.id = m.user_id WHERE m.role = 'portfolio_manager' ORDER BY pm_commission DESC`, [mb.start, mb.end]),
    one(env, `SELECT count(*)::int AS n FROM partner_attributions WHERE created_at >= $1 AND created_at < $2`, [mb.start, mb.end]),
  ]);
  return {
    month: mb.label,
    commissions: rows.map((r) => ({ role: r.role, status: r.status, currency: r.currency, count: r.n, payments: r.payments, amountMinor: num(r.amount) })),
    newReferredUsers: attrib ? attrib.n : 0,
    portfolioManagers: pmRows.map((p) => ({ userId: p.id, displayName: p.display_name, handle: p.handle, referredNew: p.referred_new, commissionMinor: num(p.pm_commission) })),
    generatedAt: new Date().toISOString(),
  };
}

export async function pmDetail(env, userId) {
  const m = await memberOf(env, userId);
  if (!m || m.role !== 'portfolio_manager') throw notFound('Portfolio Manager not found');
  const [partners, totals, bal] = await Promise.all([
    partnerRows(env, { pmId: userId }),
    one(env, `SELECT (SELECT count(*)::int FROM partner_attributions WHERE portfolio_manager_id = $1) AS referred,
        (SELECT count(DISTINCT payment_reference)::int FROM portfolio_commissions WHERE recipient_id = $1 AND role = 'portfolio' AND status <> 'reversed') AS payments,
        (SELECT COALESCE(sum(amount_minor),0)::bigint FROM portfolio_commissions WHERE recipient_id = $1 AND role = 'portfolio' AND status <> 'reversed') AS commission`, [userId]),
    balances(env, userId),
  ]);
  return {
    member: await memberShape(env, m),
    performance: { partners: partners.length, referredUsers: totals.referred, payments: totals.payments, pmCommissionMinor: num(totals.commission) },
    earnings: Object.values(bal),
    partners,
  };
}
