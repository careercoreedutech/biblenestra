// CREATOR WITHDRAWALS (creator plans, item 3): a creator asks to take out what their memberships have earned.
//   earned     successful, non-test Paystack membership payments for the creator's memberships (refunds drop out)
//   available  earned − withdrawals that are requested, approved or paid
//   fee        BibleNestra's withdrawal fee, from the creator's ACTIVE plan at request time (creatorPlans.js):
//              Free uses plans.free.withdrawalPercent, Standard 0.3%, Premium 0.131%. Integer maths, half-up to the minor unit.
//   bank charge  gateway / bank charges, recorded by the admin when marking paid. Shown on its own line, never mixed with the fee.
//   net        gross − fee − bank charge, set when paid.
// KYC: requireApprovedKyc (lib/kyc.js) before a request. Payouts are manual: the admin approves, pays outside the app,
// then marks it paid with the reference. Rejecting or cancelling gives the amount back to the available balance.
import { q, one, tx } from './db.js';
import { ApiError, bad, notFound } from './http.js';
import { requireApprovedKyc } from './kyc.js';
import { getCreatorPlansConfig, creatorPlanState, withdrawalFee, ppmOf } from './creatorPlans.js';
import { formatPrice } from './memberships.js';

export const WITHDRAWAL_STATUSES = ['requested', 'approved', 'paid', 'rejected', 'cancelled'];
const HOLDS = ['requested', 'approved', 'paid'];
const TRANSITIONS = {
  approve: { from: ['requested'], to: 'approved' },
  reject: { from: ['requested', 'approved'], to: 'rejected', reason: true },
  paid: { from: ['approved'], to: 'paid' },
  cancel: { from: ['requested'], to: 'cancelled' },
};

/** Pure: the breakdown the creator sees for an amount. */
export function withdrawalBreakdown({ grossMinor, ppm, bankChargeMinor = null }) {
  const fee = withdrawalFee(grossMinor, ppm);
  const bank = bankChargeMinor == null ? null : Number(bankChargeMinor);
  return {
    grossMinor: Number(grossMinor),
    feeMinor: fee,
    feePercent: ppm / 10000,
    bankChargeMinor: bank,
    netMinor: bank == null ? null : Number(grossMinor) - fee - bank,
  };
}

const ACTION_LABEL = { approve: 'approved', reject: 'rejected', paid: 'marked paid', cancel: 'cancelled' };
/** Pure: the next status for an admin action, or throws 409. */
export function nextStatus(action, current) {
  const t = TRANSITIONS[action];
  if (!t) throw bad('Unknown withdrawal action', 'BAD_ACTION');
  if (!t.from.includes(current)) throw new ApiError(409, 'BAD_STATE', `This withdrawal is ${current} and cannot be ${ACTION_LABEL[action]} now`);
  return t.to;
}

/** Earned, held and available for one currency. */
export async function creatorBalance(env, userId, currency = 'NGN') {
  const cur = String(currency).toUpperCase();
  const e = await one(env, `SELECT COALESCE(SUM(p.amount_minor), 0) AS minor FROM paystack_payments p
      JOIN memberships m ON m.id::text = p.target_id
     WHERE p.kind = 'membership' AND p.status = 'success' AND NOT p.test AND m.owner_id = $1 AND p.currency = $2`, [userId, cur]);
  const h = await one(env, `SELECT COALESCE(SUM(gross_minor), 0) AS minor FROM creator_withdrawals
     WHERE user_id = $1 AND currency = $2 AND status = ANY($3::text[])`, [userId, cur, HOLDS]);
  const earned = Number(e.minor);
  const held = Number(h.minor);
  return { currency: cur, earnedMinor: earned, heldMinor: held, availableMinor: Math.max(0, earned - held) };
}

/** Shape for the app: one withdrawal with its fee and bank charge lines. */
export function withdrawalShape(w, formatMoney = formatPrice) {
  const bank = w.bank_charge_minor == null ? null : Number(w.bank_charge_minor);
  return {
    id: w.id, status: w.status, currency: w.currency, planId: w.plan_id,
    grossMinor: Number(w.gross_minor), feeMinor: Number(w.fee_minor), feePercent: Number(w.fee_percent),
    bankChargeMinor: bank, netMinor: w.net_minor == null ? null : Number(w.net_minor),
    grossText: formatMoney(Number(w.gross_minor), w.currency), feeText: formatMoney(Number(w.fee_minor), w.currency),
    bankChargeText: bank == null ? null : formatMoney(bank, w.currency),
    netText: w.net_minor == null ? null : formatMoney(Number(w.net_minor), w.currency),
    reference: w.reference || null, note: w.note || null,
    requestedAt: w.created_at ? new Date(w.created_at).toISOString() : null,
    paidAt: w.paid_at ? new Date(w.paid_at).toISOString() : null,
  };
}

/** The creator's withdrawal screen: balance, the fee that applies now, the minimum and history. */
export async function withdrawalOverview(env, userId, currency = 'NGN') {
  const cfg = await getCreatorPlansConfig(env);
  const st = await creatorPlanState(env, userId);
  const plan = cfg.plans[st.activePlanId];
  const items = await q(env, 'SELECT * FROM creator_withdrawals WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100', [userId]);
  return {
    balance: await creatorBalance(env, userId, currency),
    activePlanId: st.activePlanId,
    feePercent: Number(plan.withdrawalPercent),
    minWithdrawalMinor: cfg.minWithdrawalMinor,
    items: items.map((w) => withdrawalShape(w)),
    payouts: { mode: 'manual', note: 'BibleNestra pays approved withdrawals outside the app. The fee is BibleNestra’s own; gateway and bank charges are shown separately.' },
  };
}

/** A creator asks for a payout. → the withdrawal shape. */
export async function requestWithdrawal(env, user, { amountMinor, currency = 'NGN' }) {
  const amt = Number(amountMinor);
  if (!Number.isInteger(amt) || amt <= 0) throw bad('Enter the amount to withdraw', 'BAD_AMOUNT');
  const cur = String(currency || 'NGN').toUpperCase();
  const cfg = await getCreatorPlansConfig(env);
  if (amt < cfg.minWithdrawalMinor) throw bad(`The smallest withdrawal is ${formatPrice(cfg.minWithdrawalMinor, cur)}`, 'BELOW_MINIMUM');
  await requireApprovedKyc(env, user.id);
  const st = await creatorPlanState(env, user.id);
  const ppm = ppmOf(cfg.plans[st.activePlanId].withdrawalPercent);
  const b = withdrawalBreakdown({ grossMinor: amt, ppm });
  // Race-free: one transaction takes a per-creator advisory lock (statement 1); statement 2 then reads a fresh snapshot,
  // so it sees any request committed while we waited, and inserts only if the balance still covers the amount.
  // The guard is in the same INSERT … SELECT … WHERE as the portfolio withdrawal. Two requests cannot both succeed.
  const [, rows] = await tx(env, [
    ['SELECT pg_advisory_xact_lock(hashtext($1))', [`creator_withdrawal:${user.id}`]],
    [`INSERT INTO creator_withdrawals (user_id, currency, gross_minor, fee_minor, fee_percent, plan_id, status)
      SELECT $1::uuid, $2::text, $3::bigint, $4::bigint, $5::numeric, $6::text, 'requested'
       WHERE $3::bigint <= (
         (SELECT COALESCE(SUM(p.amount_minor), 0) FROM paystack_payments p JOIN memberships m ON m.id::text = p.target_id
           WHERE p.kind = 'membership' AND p.status = 'success' AND NOT p.test AND m.owner_id = $1::uuid AND p.currency = $2::text)
         - (SELECT COALESCE(SUM(gross_minor), 0) FROM creator_withdrawals
           WHERE user_id = $1::uuid AND currency = $2::text AND status = ANY(ARRAY['requested','approved','paid']::text[])))
      RETURNING *`, [user.id, cur, amt, b.feeMinor, b.feePercent, st.activePlanId]],
  ]);
  const row = rows && rows[0];
  if (!row) {
    const bal = await creatorBalance(env, user.id, cur);
    throw new ApiError(409, 'INSUFFICIENT_BALANCE', `You can withdraw up to ${formatPrice(bal.availableMinor, cur)}`);
  }
  return withdrawalShape(row);
}

/** The creator cancels a request nobody has picked up. */
export async function cancelWithdrawal(env, user, id) {
  const w = await one(env, 'SELECT * FROM creator_withdrawals WHERE id = $1 AND user_id = $2', [id, user.id]);
  if (!w) throw notFound('Withdrawal not found');
  const to = nextStatus('cancel', w.status);
  return withdrawalShape(await one(env, 'UPDATE creator_withdrawals SET status = $2, updated_at = now() WHERE id = $1 RETURNING *', [w.id, to]));
}

/** Admin queue. */
export async function listWithdrawalsForAdmin(env, { status = null } = {}) {
  const rows = await q(env, `SELECT w.*, u.display_name AS creator_name, u.handle AS creator_handle
      FROM creator_withdrawals w JOIN users u ON u.id = w.user_id
     WHERE ($1::text IS NULL OR w.status = $1) ORDER BY w.created_at DESC LIMIT 300`, [status || null]);
  return rows.map((r) => ({ ...withdrawalShape(r), creator: { id: r.user_id, name: r.creator_name || 'Creator', handle: r.creator_handle || null } }));
}

/** Admin: approve / reject / cancel / paid (paid takes the bank charge and the reference). */
export async function actOnWithdrawal(env, adminId, id, action, { bankChargeMinor = 0, reference = null, reason = null } = {}) {
  const w = await one(env, 'SELECT * FROM creator_withdrawals WHERE id = $1', [id]);
  if (!w) throw notFound('Withdrawal not found');
  const to = nextStatus(action, w.status);
  if (action === 'paid') {
    const bank = Number(bankChargeMinor);
    if (!Number.isInteger(bank) || bank < 0 || bank > Number(w.gross_minor) - Number(w.fee_minor)) throw bad('Bank charge must be a whole amount that fits the withdrawal', 'BAD_BANK_CHARGE');
    const net = Number(w.gross_minor) - Number(w.fee_minor) - bank;
    const ref = String(reference || '').trim().slice(0, 120);
    if (!ref) throw bad('Enter the bank or transfer reference', 'REFERENCE_REQUIRED');
    return withdrawalShape(await one(env, `UPDATE creator_withdrawals SET status = 'paid', bank_charge_minor = $2, net_minor = $3, reference = $4,
        paid_at = now(), reviewed_by = $5, reviewed_at = now(), updated_at = now() WHERE id = $1 RETURNING *`, [w.id, bank, net, ref, adminId]));
  }
  return withdrawalShape(await one(env, `UPDATE creator_withdrawals SET status = $2, note = COALESCE($3, note), reviewed_by = $4, reviewed_at = now(), updated_at = now()
     WHERE id = $1 RETURNING *`, [w.id, to, reason ? String(reason).slice(0, 300) : null, adminId]));
}
