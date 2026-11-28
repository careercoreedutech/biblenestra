// PAYMENT VERIFICATION — "I paid but I'm not admitted" (client brief 6.1–6.3, 2026-11-27). Paystack only.
//
//   1. A member files a report: Paystack reference, amount, method, what it was for, and a receipt screenshot.
//      A receipt never confirms anything. An open report for the same reference blocks a second claim (409).
//   2. Admin queue: checkPaymentReport() asks Paystack (GET /transaction/verify) and shows the real status, amount,
//      currency, customer email, paid_at, and whether the reference was already credited.
//   3. approvePaymentReport(mode 'paystack'): only when Paystack says success, the amount covers the price and the
//      reference is not credited yet. It runs the SAME grant-once path as the webhook (settlePayment).
//      mode 'manual': only when the reference is unknown or unsuccessful. It needs a reason and an expiry date,
//      and it is audit-logged. Money is never granted on the strength of a receipt.
//   4. Single-use membership invitation links (membership_invite_links) for a verified paying user.
//
// Routes: routes/paymentReports.js. Receipts are private R2 objects under rcpt/ (the media route serves img/vid/aud only).
import { q, one } from './db.js';
import { ApiError, bad, notFound, forbidden } from './http.js';
import { paystackConfigured, paystackTestMode, verifyTransaction } from './paystack.js';
import { settlePayment } from './paystackCheckout.js';
import { getProduct } from './walletStore.js';
import { rateLimit } from './wallet.js';
import { activateSubscription, accessUntil, hasAccess, subscriptionOf, syncAccess, ensureConversations, formatPrice } from './memberships.js';
import { randomToken, sha256Hex } from './staff.js';
import { audit } from '../routes/admin.js';

export const METHODS = ['card', 'bank_transfer', 'ussd', 'other'];
export const KINDS = ['membership', 'plus', 'wallet'];
export const RECEIPT_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' };
export const MAX_RECEIPT = 8 * 1024 * 1024;
const REF_RE = /^[A-Za-z0-9._=-]{6,100}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIVE_YEARS = 5 * 365 * 86400e3;
const iso = (d) => (d ? new Date(d).toISOString() : null);

/** Receipt keys are accepted only from their uploader, and only when the object really exists. */
export const receiptKeyFor = (userId, ext) => `rcpt/${userId}/${crypto.randomUUID()}.${ext}`;
export const isOwnReceiptKey = (userId, key) => new RegExp(`^rcpt/${userId}/[0-9a-f-]{36}\\.(jpg|png|webp|heic)$`, 'i').test(String(key || ''));

function toMinor(amount) {
  const n = Number(String(amount ?? '').replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n <= 0 || n > 1e9) throw bad('Enter the amount you paid, in naira', 'BAD_AMOUNT');
  return Math.round(n * 100);
}

/** What the payment was for, and the price it should have cost. Throws 404 when the target is gone. */
export async function resolveTarget(env, kind, targetId, planId) {
  if (kind === 'membership') {
    const m = UUID_RE.test(String(targetId)) ? await one(env, 'SELECT * FROM memberships WHERE id = $1', [targetId]) : null;
    if (!m) throw notFound('Membership not found');
    const plan = planId && UUID_RE.test(String(planId)) ? await one(env, 'SELECT * FROM membership_plans WHERE id = $1 AND membership_id = $2', [planId, m.id]) : null;
    if (!plan) throw bad('Choose the plan you paid for', 'BAD_PLAN');
    return { title: m.title, currency: plan.currency, expectedMinor: Number(plan.price_minor), planId: plan.id };
  }
  if (kind === 'plus') {
    const plan = await one(env, 'SELECT * FROM plus_plans WHERE id = $1', [String(targetId)]);
    if (!plan) throw notFound('BibleNestra Plus plan not found');
    return { title: `BibleNestra Plus · ${plan.label}`, currency: plan.currency, expectedMinor: Number(plan.price_minor), planId: null };
  }
  const product = await getProduct(env, String(targetId));
  if (!product) throw notFound('Package not found');
  return { title: product.title, currency: product.currency, expectedMinor: Number(product.price_minor), planId: null };
}

export function reportShape(r, { admin = false } = {}) {
  if (!r) return null;
  const out = {
    id: r.id, reference: r.reference, amountMinor: Number(r.amount_minor), currency: r.currency,
    displayAmount: formatPrice(Number(r.amount_minor), r.currency), method: r.method, kind: r.kind, targetId: r.target_id, planId: r.plan_id || null,
    title: r.target_title || null, status: r.status, rejectReason: r.status === 'rejected' ? (r.decision_reason || null) : null,
    createdAt: iso(r.created_at), decidedAt: iso(r.reviewed_at), accessExpiresAt: iso(r.access_expires_at),
  };
  if (admin) {
    Object.assign(out, {
      userId: r.user_id, userName: r.display_name || null, userHandle: r.handle || null, note: r.note || null,
      verification: r.verification || {}, verifiedAt: iso(r.verified_at), decisionMethod: r.decision_method || null,
      decisionReason: r.decision_reason || null, reviewedBy: r.reviewed_by || null, reviewedByStaff: r.reviewed_by_staff || null,
    });
  }
  return out;
}

// ─── member: report a payment ────────────────────────────────────────────────────────────────────────────────────────
/** The member's recent Paystack attempts, to pick from (they prefill the report form). */
export async function reportOptions(env, user) {
  const rows = await q(env, `SELECT reference, kind, target_id, amount_minor, currency, status, created_at, payload FROM paystack_payments
    WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`, [user.id]);
  return rows.map((p) => {
    const payload = typeof p.payload === 'string' ? JSON.parse(p.payload) : (p.payload || {});
    return {
      reference: p.reference, kind: p.kind, targetId: p.target_id, planId: payload.planId || null, title: payload.title || null,
      amountMinor: Number(p.amount_minor), currency: p.currency, status: p.status, createdAt: iso(p.created_at),
    };
  });
}

export async function myReports(env, user) {
  const rows = await q(env, 'SELECT * FROM payment_reports WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [user.id]);
  const out = [];
  for (const r of rows) {
    const t = await resolveTarget(env, r.kind, r.target_id, r.plan_id).catch(() => null);
    out.push(reportShape({ ...r, target_title: t ? t.title : null }));
  }
  return out;
}

export async function createPaymentReport(env, user, b) {
  const reference = String(b.reference || '').trim();
  if (!REF_RE.test(reference)) throw bad('Enter the transaction reference from your Paystack receipt', 'BAD_REFERENCE');
  const amountMinor = toMinor(b.amount);
  const method = String(b.method || '');
  if (!METHODS.includes(method)) throw bad('Choose how you paid', 'BAD_METHOD');
  const kind = String(b.kind || '');
  if (!KINDS.includes(kind)) throw bad('Choose what the payment was for', 'BAD_KIND');
  const targetId = String(b.targetId || '').slice(0, 80);
  if (!targetId) throw bad('Choose what the payment was for', 'BAD_TARGET');
  const receiptKey = String(b.receiptKey || '');
  if (!isOwnReceiptKey(user.id, receiptKey) || !(await env.MEDIA.head(receiptKey))) throw bad('Upload your receipt screenshot first', 'BAD_RECEIPT');
  const note = String(b.note || '').trim().slice(0, 500) || null;
  const target = await resolveTarget(env, kind, targetId, b.planId);
  await rateLimit(env, `payment_report:${user.id}`, 5, 3600);

  const key = reference.toLowerCase();
  const local = await one(env, 'SELECT * FROM paystack_payments WHERE lower(reference) = $1', [key]);
  if (local && local.user_id !== user.id) throw new ApiError(409, 'REFERENCE_IN_USE', 'This reference is linked to another account. Contact support if you think this is a mistake.');
  if (local && local.status === 'success') throw new ApiError(409, 'ALREADY_CREDITED', 'This payment is already in our records and was applied. Check My memberships. If access is still missing, contact support.');
  const open = await one(env, `SELECT id, user_id FROM payment_reports WHERE reference_key = $1 AND status <> 'rejected'`, [key]);
  if (open) throw new ApiError(409, 'DUPLICATE_REFERENCE', open.user_id === user.id ? 'You already sent this reference. It is waiting for review.' : 'This reference has already been submitted. Contact support if you think this is a mistake.');

  let row;
  try {
    row = await one(env, `INSERT INTO payment_reports (user_id, reference, reference_key, amount_minor, currency, method, kind, target_id, plan_id, receipt_key, note)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [user.id, reference, key, amountMinor, target.currency, method, kind, targetId, target.planId, receiptKey, note]);
  } catch (e) {
    if (e.code === '23505') throw new ApiError(409, 'DUPLICATE_REFERENCE', 'This reference has already been submitted.');
    throw e;
  }
  return reportShape({ ...row, target_title: target.title });
}

// ─── admin: queue, Paystack check, approve / reject, manual grants ──────────────────────────────────────────────────
export async function listPaymentReports(env, { status = 'pending', limit = 50 } = {}) {
  const rows = await q(env, `SELECT r.*, u.display_name, u.handle FROM payment_reports r JOIN users u ON u.id = r.user_id
    WHERE ($1::text IS NULL OR r.status = $1) ORDER BY r.created_at ASC LIMIT $2`, [status || null, Math.min(200, Math.max(1, limit))]);
  const out = [];
  for (const r of rows) {
    const t = await resolveTarget(env, r.kind, r.target_id, r.plan_id).catch(() => null);
    out.push(reportShape({ ...r, target_title: t ? t.title : null }, { admin: true }));
  }
  return out;
}

export async function loadReport(env, id) {
  if (!UUID_RE.test(String(id))) throw notFound('Report not found');
  const r = await one(env, 'SELECT r.*, u.display_name, u.handle FROM payment_reports r JOIN users u ON u.id = r.user_id WHERE r.id = $1', [id]);
  if (!r) throw notFound('Report not found');
  return r;
}

/** Already credited? The local checkout row, or the membership / Plus row already holds this reference. */
async function creditedBefore(env, report, local) {
  if (local && local.status === 'success') return true;
  if (report.kind === 'membership') return !!(await one(env, 'SELECT 1 AS x FROM membership_subscriptions WHERE membership_id = $1 AND $2 = ANY(applied_payment_refs)', [report.target_id, report.reference]));
  if (report.kind === 'plus') return !!(await one(env, 'SELECT 1 AS x FROM plus_subscriptions WHERE $1 = ANY(applied_payment_refs)', [report.reference]));
  return false;
}

/** Asks Paystack about the report's reference (one verify call). → { snapshot, verified } */
export async function checkWithPaystack(env, report) {
  const local = await one(env, 'SELECT * FROM paystack_payments WHERE lower(reference) = $1', [report.reference_key]);
  let v = null; let gatewayError = null;
  if (!paystackConfigured(env)) gatewayError = 'PAYMENTS_NOT_CONFIGURED';
  else { try { v = await verifyTransaction(env, report.reference); } catch (e) { gatewayError = String(e.message || e.code || 'PROVIDER_ERROR').slice(0, 200); } }
  const target = await resolveTarget(env, report.kind, report.target_id, report.plan_id).catch(() => null);
  const expectedMinor = local ? Number(local.amount_minor) : (target ? target.expectedMinor : Number(report.amount_minor));
  const snapshot = {
    checkedAt: new Date().toISOString(),
    found: !!v,
    gatewayStatus: v ? v.status : null,
    gatewayError,
    paidMinor: v ? v.amountMinor : null,
    paidCurrency: v ? v.currency : null,
    paidAt: v && v.raw ? v.raw.paid_at || null : null,
    channel: v && v.raw ? v.raw.channel || null : null,
    customerEmail: v && v.raw && v.raw.customer ? v.raw.customer.email || null : null,
    claimedMinor: Number(report.amount_minor),
    expectedMinor,
    amountOk: !!v && v.amountMinor >= expectedMinor && String(v.currency || '').toUpperCase() === String(report.currency),
    claimInflated: !!v && v.amountMinor < Number(report.amount_minor),
    knownHere: !!local,
    localStatus: local ? local.status : null,
    localUserMatches: local ? local.user_id === report.user_id : null,
    alreadyCredited: await creditedBefore(env, report, local),
    targetTitle: target ? target.title : null,
  };
  await q(env, 'UPDATE payment_reports SET verification = $2::jsonb, verified_at = now(), updated_at = now() WHERE id = $1', [report.id, JSON.stringify(snapshot)]);
  return { snapshot, verified: v };
}

export async function checkPaymentReport(env, reportId) {
  const report = await loadReport(env, reportId);
  const { snapshot } = await checkWithPaystack(env, report);
  return { report: reportShape({ ...(await loadReport(env, reportId)), target_title: snapshot.targetTitle }, { admin: true }), verification: snapshot };
}

/** Access end the payment produced (for the record). */
async function accessEndOf(env, report) {
  if (report.kind === 'membership') {
    const s = await subscriptionOf(env, report.target_id, report.user_id);
    return s && hasAccess(s) ? s.expires_at : null;
  }
  if (report.kind === 'plus') {
    const s = await one(env, `SELECT current_period_end FROM plus_subscriptions WHERE user_id = $1 AND status IN ('active','cancelled','past_due') ORDER BY created_at DESC LIMIT 1`, [report.user_id]);
    return s ? s.current_period_end : null;
  }
  return null;
}

/** The checkout row the grant path needs, created for a verified payment the app never started (paid elsewhere). */
async function ensureCheckoutRow(env, report, target, snapshot) {
  const existing = await one(env, 'SELECT * FROM paystack_payments WHERE reference = $1', [report.reference]);
  if (existing) return existing;
  let targetId = report.target_id;
  let payload = { title: target.title };
  if (report.kind === 'membership') payload = { title: target.title, planId: target.planId, answers: [], contact: { email: snapshot.customerEmail || '' }, promoCode: null, promoId: null };
  if (report.kind === 'wallet') {
    const product = await getProduct(env, report.target_id);
    const wp = await one(env, `INSERT INTO wallet_purchases (user_id, product_id, provider, provider_ref, idempotency_key, amount_minor, currency, units, test)
        VALUES ($1,$2,'paystack',$3,$4,$5,$6,$7,$8) RETURNING id`,
    [report.user_id, product.id, report.reference, `rpt_${report.id}`, Number(product.price_minor), product.currency,
      Number(product.units) + Number(product.bonus_units), paystackTestMode(env) || !!env.__paystackFetch]);
    targetId = wp.id;
    payload = { productId: product.id, title: product.title };
  }
  return one(env, `INSERT INTO paystack_payments (reference, user_id, kind, target_id, amount_minor, currency, email, test, payload)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) RETURNING *`,
  [report.reference, report.user_id, report.kind, String(targetId), target.expectedMinor, target.currency, snapshot.customerEmail || '',
    paystackTestMode(env) || !!env.__paystackFetch, JSON.stringify(payload)]);
}

async function markApproved(env, report, admin, { method, reason = null, expires = null, snapshot = null }) {
  const row = await one(env, `UPDATE payment_reports SET status = 'approved', decision_method = $2, decision_reason = $3, reviewed_by = $4, reviewed_by_staff = $5,
      reviewed_at = now(), access_expires_at = $6, verification = COALESCE($7::jsonb, verification), verified_at = COALESCE(verified_at, now()), updated_at = now()
    WHERE id = $1 AND status = 'pending' RETURNING *`,
  [report.id, method, reason, admin.id, admin.staffId || null, expires ? new Date(expires).toISOString() : null, snapshot ? JSON.stringify(snapshot) : null]);
  if (!row) throw new ApiError(409, 'ALREADY_DECIDED', 'This report was already decided. Refresh the queue.');
  await audit(env, admin, 'payment_report_approve', 'payment_report', report.id, { method, reference: report.reference, reason, expires: iso(expires) });
  return row;
}

/**
 * mode 'paystack' (default): Paystack must say success, the amount must cover the price, and the reference must not be
 * credited yet. Then the webhook's grant-once path runs. A reference that is already credited just closes the report.
 * mode 'manual': unknown or unsuccessful references only, with a reason and an expiry (memberships). Audit-logged.
 */
export async function approvePaymentReport(env, admin, reportId, { mode = 'paystack', reason = '', expiresAt = null } = {}) {
  const report = await loadReport(env, reportId);
  if (report.status !== 'pending') throw new ApiError(409, 'ALREADY_DECIDED', 'This report was already decided. Refresh the queue.');
  const { snapshot, verified } = await checkWithPaystack(env, report);
  if (mode === 'manual') {
    if (report.kind !== 'membership') throw bad('Manual grants are for memberships. Coins and Plus are granted through Paystack only.', 'MANUAL_NOT_SUPPORTED');
    if (snapshot.alreadyCredited) throw new ApiError(409, 'REFERENCE_ALREADY_CREDITED', 'This payment was already credited. Nothing to grant.');
    if (snapshot.found && snapshot.gatewayStatus === 'success') throw new ApiError(409, 'USE_PAYSTACK_APPROVAL', 'Paystack shows this payment as successful. Approve it through Paystack instead.');
    if (snapshot.localUserMatches === false) throw new ApiError(409, 'REFERENCE_IN_USE', 'This reference is linked to another account.');
    const why = String(reason || '').trim();
    if (why.length < 10) throw bad('Write the reason for the manual grant (at least 10 characters)', 'REASON_REQUIRED');
    const until = parseFuture(expiresAt);
    await grantMembershipAccess(env, admin, { userId: report.user_id, membershipId: report.target_id, planId: report.plan_id, until, reason: `Manual grant · ${report.reference} · ${why}` });
    const row = await markApproved(env, report, admin, { method: 'manual', reason: why, expires: until, snapshot });
    return { report: reportShape({ ...row, target_title: snapshot.targetTitle }, { admin: true }), decision: 'manual' };
  }
  if (!snapshot.found || snapshot.gatewayStatus !== 'success') throw new ApiError(409, 'NOT_SUCCESSFUL', 'Paystack does not show this payment as successful. Use “Grant manually” with a reason instead.');
  if (snapshot.localUserMatches === false) throw new ApiError(409, 'REFERENCE_IN_USE', 'This reference is linked to another account.');
  if (!snapshot.amountOk) throw new ApiError(409, 'AMOUNT_MISMATCH', `Paystack shows ${formatPrice(snapshot.paidMinor, snapshot.paidCurrency)}, less than the price. Reject it, or grant manually with a reason.`);
  let decision = 'already_credited';
  if (!snapshot.alreadyCredited) {
    const target = await resolveTarget(env, report.kind, report.target_id, report.plan_id);
    const local = await ensureCheckoutRow(env, report, target, snapshot);
    const r = await settlePayment(env, local.reference, { verified });
    if (r.status !== 'success') throw new ApiError(409, r.error || 'GRANT_FAILED', 'The payment is verified, but access could not be granted yet. Try again in a minute.');
    decision = r.granted ? 'paystack' : 'already_credited';
  }
  const expires = await accessEndOf(env, report);
  const row = await markApproved(env, report, admin, { method: decision, expires, snapshot });
  return { report: reportShape({ ...row, target_title: snapshot.targetTitle }, { admin: true }), decision };
}

export async function rejectPaymentReport(env, admin, reportId, reason) {
  const why = String(reason || '').trim();
  if (why.length < 5) throw bad('Write the reason you are rejecting it (the member sees it)', 'REASON_REQUIRED');
  const report = await loadReport(env, reportId);
  const row = await one(env, `UPDATE payment_reports SET status = 'rejected', decision_method = NULL, decision_reason = $2, reviewed_by = $3, reviewed_by_staff = $4,
      reviewed_at = now(), updated_at = now() WHERE id = $1 AND status = 'pending' RETURNING *`, [report.id, why.slice(0, 500), admin.id, admin.staffId || null]);
  if (!row) throw new ApiError(409, 'ALREADY_DECIDED', 'This report was already decided. Refresh the queue.');
  await audit(env, admin, 'payment_report_reject', 'payment_report', report.id, { reference: report.reference, reason: why.slice(0, 200) });
  return reportShape({ ...row, target_title: null }, { admin: true });
}

function parseFuture(v) {
  const d = v ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime())) throw bad('Set the access expiry date', 'BAD_EXPIRY');
  if (d.getTime() <= Date.now()) throw bad('The expiry date must be in the future', 'BAD_EXPIRY');
  if (d.getTime() > Date.now() + FIVE_YEARS) throw bad('The expiry date can be at most five years away', 'BAD_EXPIRY');
  return d;
}

/** Membership row with its Channel + Community ids (created on first publish; a grant must never skip them). */
export async function withConversations(env, m) {
  if ((m.channel_id && m.community_id) || !m.owner_id) return m;
  return ensureConversations(env, m, { id: m.owner_id });
}

/** Membership access granted by an admin (manual grants and report approvals): audit-logged, conversations joined. */
export async function grantMembershipAccess(env, admin, { userId, membershipId, planId, until, reason }) {
  if (!UUID_RE.test(String(membershipId || '')) || !UUID_RE.test(String(planId || ''))) throw bad('Choose the membership and plan', 'BAD_PLAN');
  if (!UUID_RE.test(String(userId || ''))) throw bad('Choose the user', 'BAD_USER');
  const u = await one(env, 'SELECT id FROM users WHERE id = $1', [userId]);
  if (!u) throw notFound('User not found');
  const plan = await one(env, 'SELECT * FROM membership_plans WHERE id = $1 AND membership_id = $2', [planId, membershipId]);
  if (!plan) throw bad('That plan doesn’t belong to this membership', 'BAD_PLAN');
  let m = await one(env, 'SELECT * FROM memberships WHERE id = $1', [membershipId]);
  if (!m) throw notFound('Membership not found');
  m = await withConversations(env, m);
  const sub = await activateSubscription(env, { membership: m, plan, userId, source: 'admin_grant', until, grantedBy: admin.id, note: String(reason).slice(0, 300) });
  await audit(env, admin, 'membership_grant', 'membership', membershipId, { userId, planId, until: iso(until), reason: String(reason).slice(0, 200) });
  return sub;
}

/** The member an admin means: a user id, or their @handle (the dashboard types handles). */
export async function userIdFrom(env, { userId, handle } = {}) {
  if (userId) {
    if (!UUID_RE.test(String(userId))) throw bad('Invalid user', 'BAD_USER');
    return String(userId);
  }
  const h = String(handle || '').trim().replace(/^@/, '');
  if (!h) throw bad('Choose the user (their @handle)', 'BAD_USER');
  const u = await one(env, 'SELECT id FROM users WHERE lower(handle) = lower($1)', [h]);
  if (!u) throw notFound('No user with that @handle');
  return u.id;
}

/** Admin: grant a membership by hand (the form in Wallets & payments). */
export async function manualMembershipGrant(env, admin, b) {
  const why = String(b.reason || '').trim();
  if (why.length < 10) throw bad('Write the reason for the grant (at least 10 characters)', 'REASON_REQUIRED');
  const until = parseFuture(b.expiresAt);
  const sub = await grantMembershipAccess(env, admin, { userId: await userIdFrom(env, b),membershipId: String(b.membershipId || ''), planId: String(b.planId || ''), until, reason: why });
  return { subscription: { id: sub.id, expiresAt: iso(sub.expires_at), status: sub.status, source: sub.source } };
}

// ─── verified paying users + single-use membership invitation links ────────────────────────────────────────────────
/** A verified paying user: a successful Paystack membership payment, or an approved report, for this membership. */
export async function isVerifiedPayer(env, userId, membershipId) {
  const paid = await one(env, `SELECT 1 AS x FROM paystack_payments WHERE user_id = $1 AND kind = 'membership' AND target_id = $2 AND status = 'success' LIMIT 1`, [userId, String(membershipId)]);
  if (paid) return true;
  return !!(await one(env, `SELECT 1 AS x FROM payment_reports WHERE user_id = $1 AND kind = 'membership' AND target_id = $2 AND status = 'approved' LIMIT 1`, [userId, String(membershipId)]));
}

function inviteShape(r, membershipTitle = null, planName = null) {
  return {
    id: r.id, membershipId: r.membership_id, membershipTitle, planId: r.plan_id, planName, userId: r.user_id || null,
    accessUntil: iso(r.access_until), expiresAt: iso(r.expires_at), usedAt: iso(r.used_at), revokedAt: iso(r.revoked_at), createdAt: iso(r.created_at),
    status: r.revoked_at ? 'revoked' : r.used_at ? 'used' : new Date(r.expires_at) <= new Date() ? 'expired' : 'open',
  };
}

export async function createMembershipInvite(env, admin, b, origin) {
  if (!UUID_RE.test(String(b.membershipId || ''))) throw bad('Choose the membership', 'BAD_MEMBERSHIP');
  if (!UUID_RE.test(String(b.planId || ''))) throw bad('Choose the plan', 'BAD_PLAN');
  const m = await one(env, 'SELECT * FROM memberships WHERE id = $1', [b.membershipId]);
  if (!m || m.status === 'archived') throw notFound('Membership not found');
  const plan = await one(env, 'SELECT * FROM membership_plans WHERE id = $1 AND membership_id = $2', [b.planId, m.id]);
  if (!plan) throw bad('That plan doesn’t belong to this membership', 'BAD_PLAN');
  const userId = b.userId || b.handle ? await userIdFrom(env, b) : null;
  if (userId) {
    if (!(await isVerifiedPayer(env, userId, m.id)))throw new ApiError(409, 'NOT_VERIFIED_PAYER', 'This person has no verified payment for this membership. Verify the payment first.');
  }
  const hours = Math.min(168, Math.max(1, Math.round(Number(b.expiresInHours) || 48)));
  const until = b.accessUntil ? parseFuture(b.accessUntil) : null;
  const token = randomToken(32);
  const row = await one(env, `INSERT INTO membership_invite_links (token_hash, membership_id, plan_id, user_id, access_until, created_by, created_by_staff, expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7, now() + make_interval(hours => $8::int)) RETURNING *`,
  [await sha256Hex(token), m.id, plan.id, userId, until ? until.toISOString() : null, admin.id, admin.staffId || null, hours]);
  await audit(env, admin, 'membership_invite_create', 'membership', m.id, { inviteId: row.id, userId, planId: plan.id, expiresAt: iso(row.expires_at) });
  return { invite: inviteShape(row, m.title, plan.name), link: `${origin}/membership-invite/${token}` };
}

export async function listMembershipInvites(env, membershipId = null) {
  const rows = await q(env, `SELECT i.*, m.title AS membership_title, p.name AS plan_name FROM membership_invite_links i
      JOIN memberships m ON m.id = i.membership_id JOIN membership_plans p ON p.id = i.plan_id
      WHERE ($1::uuid IS NULL OR i.membership_id = $1) ORDER BY i.created_at DESC LIMIT 100`, [UUID_RE.test(String(membershipId || '')) ? membershipId : null]);
  return rows.map((r) => inviteShape(r, r.membership_title, r.plan_name));
}

export async function revokeMembershipInvite(env, admin, id) {
  if (!UUID_RE.test(String(id))) throw notFound('Invite not found');
  const row = await one(env, 'UPDATE membership_invite_links SET revoked_at = now() WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL RETURNING *', [id]);
  if (!row) throw new ApiError(409, 'NOT_REVOCABLE', 'This invite was already used or revoked');
  await audit(env, admin, 'membership_invite_revoke', 'membership', row.membership_id, { inviteId: row.id });
  return inviteShape(row);
}

async function inviteByToken(env, token) {
  const inv = await one(env, 'SELECT * FROM membership_invite_links WHERE token_hash = $1', [await sha256Hex(String(token || ''))]);
  if (!inv) throw notFound('This invitation link is not valid');
  return inv;
}

/** Signed-in preview: what the link admits to and whether this account may use it. */
export async function previewInvite(env, me, token) {
  const inv = await inviteByToken(env, token);
  const m = await one(env, 'SELECT * FROM memberships WHERE id = $1', [inv.membership_id]);
  const plan = await one(env, 'SELECT * FROM membership_plans WHERE id = $1', [inv.plan_id]);
  const forThisAccount = !inv.user_id || inv.user_id === me.id;
  const status = inviteShape(inv).status;
  return {
    membershipTitle: m ? m.title : null, planName: plan ? plan.name : null, status, expiresAt: iso(inv.expires_at),
    forThisAccount, usable: status === 'open' && forThisAccount,
  };
}

/**
 * Single-use admission. The link is claimed atomically first, then access is granted. A failed grant releases the claim.
 * The accepting account must hold a verified payment for this membership (a forwarded link alone admits nobody).
 */
export async function acceptInvite(env, me, token) {
  const inv = await inviteByToken(env, token);
  if (inv.user_id && inv.user_id !== me.id) throw forbidden('This invitation is for someone else', 'NOT_FOR_YOU');
  if (inviteShape(inv).status !== 'open') throw new ApiError(410, 'LINK_EXPIRED', 'This invitation link has expired or was already used');
  if (!(await isVerifiedPayer(env, me.id, inv.membership_id))) throw new ApiError(403, 'NOT_VERIFIED', 'We can’t find a verified payment for this membership on your account. Report your payment first.');
  let m = await one(env, 'SELECT * FROM memberships WHERE id = $1', [inv.membership_id]);
  if (!m || m.status !== 'published') throw bad('This membership isn’t open right now', 'NOT_AVAILABLE');
  const plan = await one(env, 'SELECT * FROM membership_plans WHERE id = $1', [inv.plan_id]);
  const claimed = await one(env, `UPDATE membership_invite_links SET used_at = now(), used_by = $2 WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now() RETURNING id`, [inv.id, me.id]);
  if (!claimed) throw new ApiError(410, 'LINK_EXPIRED', 'This invitation link has expired or was already used');
  try {
    m = await withConversations(env, m);
    if (hasAccess(await subscriptionOf(env, m.id, me.id))) await syncAccess(env, m.id, me.id);
    else await activateSubscription(env, { membership: m, plan, userId: me.id, source: 'admin_grant', until: inv.access_until ? new Date(inv.access_until) : accessUntil(plan, new Date()), grantedBy: inv.created_by, note: 'Admitted with an invitation link' });
  } catch (e) {
    await q(env, 'UPDATE membership_invite_links SET used_at = NULL, used_by = NULL WHERE id = $1', [inv.id]);
    throw e;
  }
  return { status: 'member', membershipId: m.id, slug: m.slug, channelId: m.channel_id, communityId: m.community_id };
}
