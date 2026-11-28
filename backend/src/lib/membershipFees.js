// MEMBERSHIP CREATION FEE (Development Update v1, item 4.2): users who create a membership pay BibleNestra a fee
// through Paystack before it can be published. The amount, cycle and per-type amounts are admin settings
// (registerConfig 'membership_creation_fee'), nothing is hard-coded here.
//
//   cycle  one_time → paid once, the membership stays published for good
//          week / month → paid per period; the card renews automatically (runPaystackRenewals in paystackCheckout.js),
//                         bank / USSD get reminders. If the period ends unpaid, the membership is moved back to draft
//                         (lapseCreationFees, run from the membership cron) and it is published again after paying.
//   amount chosen per membership: categories[category] when set, otherwise paid (has a plan priced above 0) or free.
//   Memberships created by platform admins and every membership that existed before this feature are exempt
//   (memberships.creation_fee_required = false).
import { q, one } from './db.js';
import { ApiError } from './http.js';
import { registerConfig, getConfig } from './wallet.js';

export const FEE_CYCLES = ['one_time', 'week', 'month'];
export const DEFAULT_CREATION_FEE = { cycle: 'one_time', currency: 'NGN', free: 0, paid: 0, categories: {} };
const isMinor = (v) => Number.isInteger(v) && v >= 0 && v <= 1e12;
export const checkCreationFee = (v) => !!v && typeof v === 'object'
  && FEE_CYCLES.includes(v.cycle)
  && /^[A-Z]{3}$/.test(String(v.currency || ''))
  && isMinor(v.free) && isMinor(v.paid)
  && (v.categories == null || (typeof v.categories === 'object' && Object.values(v.categories).every(isMinor)));
registerConfig('membership_creation_fee', DEFAULT_CREATION_FEE, checkCreationFee);

/** free | paid, from the plans: paid when any active plan costs more than 0. */
export function feeTypeOf(plans = []) {
  return plans.some((p) => p.active !== false && Number(p.price_minor) > 0) ? 'paid' : 'free';
}

/** The fee for a membership with this category and these plans → { amountMinor, cycle, currency, type }. Pure. */
export function feeFor(cfg, { category, plans = [] }) {
  const c = { ...DEFAULT_CREATION_FEE, ...(cfg || {}) };
  const type = feeTypeOf(plans);
  const override = c.categories && c.categories[category];
  const amountMinor = Number(override != null ? override : type === 'paid' ? c.paid : c.free);
  return { amountMinor, cycle: c.cycle, currency: c.currency, type };
}

/** End of one fee period starting at `from`. one_time → null (never ends). */
export function feePeriodEnd(cycle, from) {
  const d = new Date(new Date(from).getTime());
  if (cycle === 'week') return new Date(d.getTime() + 7 * 86400e3);
  if (cycle === 'month') { d.setUTCMonth(d.getUTCMonth() + 1); return d; }
  return null;
}

export async function getCreationFeeConfig(env) {
  return (await getConfig(env)).membership_creation_fee;
}

export async function creationFeeRow(env, membershipId) {
  return one(env, 'SELECT * FROM membership_creation_fees WHERE membership_id = $1', [membershipId]);
}

/** Paid and in date. */
export function feeIsActive(row, now = new Date()) {
  if (!row || row.status !== 'active') return false;
  return !row.paid_until || new Date(row.paid_until).getTime() > now.getTime();
}

/** What the creator sees: the fee for this membership and whether it is paid. */
export async function creationFeeStatus(env, m, plans, now = new Date()) {
  const cfg = await getCreationFeeConfig(env);
  const fee = feeFor(cfg, { category: m.category, plans });
  const row = await creationFeeRow(env, m.id);
  const active = feeIsActive(row, now);
  const required = !!m.creation_fee_required && fee.amountMinor > 0;
  return {
    required,
    amountMinor: fee.amountMinor,
    currency: fee.currency,
    cycle: fee.cycle,
    type: fee.type,
    paid: active || !required,
    status: row ? row.status : 'unpaid',
    paidUntil: row && row.paid_until ? new Date(row.paid_until).toISOString() : null,
    autoRenew: !!(row && row.auto_renew),
    lapsedAt: m.fee_lapsed_at ? new Date(m.fee_lapsed_at).toISOString() : null,
  };
}

/** Publishing gate: throws 402 CREATION_FEE_REQUIRED until the creation fee is paid (exempt memberships pass). */
export async function assertCreationFeePaid(env, m, plans, now = new Date()) {
  const s = await creationFeeStatus(env, m, plans, now);
  if (s.paid) return s;
  const e = new ApiError(402, 'CREATION_FEE_REQUIRED', `Pay the creation fee of ${s.currency} ${(s.amountMinor / 100).toLocaleString('en')} to publish this membership`);
  e.details = { amountMinor: s.amountMinor, currency: s.currency, cycle: s.cycle };
  throw e;
}

/**
 * Grants a paid creation fee (purchase or card renewal). Called once per payment from paystackCheckout.js grant(),
 * which claims the payment first, so it never runs twice for one reference.
 */
export async function applyCreationFee(env, { membershipId, userId, cycle, amountMinor, currency, authId = null, reference, now = new Date() }) {
  if (!FEE_CYCLES.includes(cycle)) throw new ApiError(400, 'BAD_CYCLE', 'Unknown creation fee cycle');
  const cur = await creationFeeRow(env, membershipId);
  const base = feeIsActive(cur, now) && cur.paid_until ? new Date(cur.paid_until) : now;
  const end = feePeriodEnd(cycle, base);
  const renews = !!authId && cycle !== 'one_time';
  const row = await one(env, `INSERT INTO membership_creation_fees
      (membership_id, user_id, cycle, amount_minor, currency, paid_until, status, paystack_auth_id, auto_renew, renewal_attempts, last_renewal_at, reminded_for, paid_reference, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8,0,NULL,NULL,$9,now())
    ON CONFLICT (membership_id) DO UPDATE SET user_id = EXCLUDED.user_id, cycle = EXCLUDED.cycle, amount_minor = EXCLUDED.amount_minor,
      currency = EXCLUDED.currency, paid_until = EXCLUDED.paid_until, status = 'active',
      paystack_auth_id = COALESCE(EXCLUDED.paystack_auth_id, membership_creation_fees.paystack_auth_id),
      auto_renew = EXCLUDED.auto_renew, renewal_attempts = 0, last_renewal_at = NULL, reminded_for = NULL,
      paid_reference = EXCLUDED.paid_reference, updated_at = now()
    RETURNING *`,
  [membershipId, userId, cycle, amountMinor, currency, end ? end.toISOString() : null, authId, renews, reference]);
  await q(env, 'UPDATE memberships SET fee_lapsed_at = NULL, updated_at = now() WHERE id = $1', [membershipId]);
  return row;
}

/**
 * A paid period that ended without renewal: the fee lapses and the membership goes back to draft (the creator can
 * pay and publish again). Only memberships that carry a fee are touched. → number of memberships moved to draft.
 */
export async function lapseCreationFees(env, now = new Date()) {
  const rows = await q(env, `WITH lapsed AS (
      UPDATE membership_creation_fees SET status = 'lapsed', auto_renew = false, updated_at = now()
       WHERE status = 'active' AND paid_until IS NOT NULL AND paid_until <= $1 RETURNING membership_id)
    UPDATE memberships m SET status = 'draft', fee_lapsed_at = $1, updated_at = now()
      FROM lapsed WHERE m.id = lapsed.membership_id AND m.status = 'published' RETURNING m.id`, [now.toISOString()]);
  return rows.length;
}
