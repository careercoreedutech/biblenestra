// CREATOR PLANS (client round 3, 2026-11-28): every membership creator is on one plan.
//   free      0 USD / month. Creating is free. Withdrawal fee: plans.free.withdrawalPercent (admin, default 0.5%).
//             Members who JOIN a Free creator's membership see one ad per day per user (see joinAd below).
//   standard  10.24 USD / month. Withdrawal fee 0.3%. No join ads.
//   premium   43.78 USD / month. Withdrawal fee 0.131%. No join ads.
//
// Prices are USD. The Paystack account settles NGN, so a paid plan is charged in NGN at the live USD rate
// (wallet fundme_fx_ngn_per_unit, the same table Fund Me uses), locked on the checkout row. If PAYSTACK_CURRENCIES lists
// USD the plan is charged in USD directly. Money is integer minor units (kobo / cents); the NGN amount is
// Math.round(usdCents × NGN-per-USD), i.e. the nearest kobo.
//
// State per creator (creator_plan_subscriptions, one row per user; no row = Free, never chosen):
//   active paid period in date  → may create and publish; the plan's withdrawal fee applies
//   past_due / expired          → may NOT create or publish new memberships until they renew or switch to Free.
//                                 Existing memberships keep running. Withdrawals use the Free fee.
//   pending_plan_id set         → a downgrade between paid plans, applied when the period ends.
// Upgrades are immediate: the new plan is charged in full for one month from now (no proration).
// Downgrades to Free are immediate. Downgrades between paid plans apply at the end of the period.
//
// Payments: paystack_payments kind 'creator_plan' through the normal settlePayment → grant path (so the partner
// commission hook in portfolio.js fires). Monthly card renewals and bank/USSD reminders reuse the Paystack cron.
//
// Config: registerConfig 'creator_plans' (admin: Memberships tab → Creator plans). Creation fee per membership
// (membershipFees.js) is dormant behind registerConfig 'membership_creation_fee_enabled' (default false).
import { q, one } from './db.js';
import { ApiError, bad } from './http.js';
import { registerConfig, getConfig } from './wallet.js';
import { fxRates } from './fundmeMoney.js';
import { periodFor, exemptionOf } from './membershipAdGate.js';

export const PLAN_IDS = ['free', 'standard', 'premium'];
export const PAID_PLAN_IDS = ['standard', 'premium'];
export const JOIN_AD_FLAG = 'membership_join_ad';
const PERCENT_MAX = 10;

export const DEFAULT_CREATOR_PLANS = {
  enabled: true, // feature switch: off = no plan gating at all (legacy behaviour)
  minWithdrawalMinor: 100000, // smallest withdrawal (kobo when NGN): 1,000 NGN
  joinAd: { enabled: true }, // master switch for the Free-plan join ad
  plans: {
    free: { name: 'Free', priceUsdCents: 0, withdrawalPercent: 0.5, joinAds: true, enabled: true },
    standard: { name: 'Standard', priceUsdCents: 1024, withdrawalPercent: 0.3, joinAds: false, enabled: true },
    premium: { name: 'Premium', priceUsdCents: 4378, withdrawalPercent: 0.131, joinAds: false, enabled: true },
  },
};

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const percentOk = (p) => typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= PERCENT_MAX && Math.abs(p * 1000 - Math.round(p * 1000)) < 1e-9;

/** Validates the whole 'creator_plans' setting (registerConfig refuses a bad value). */
export function checkCreatorPlans(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  if (typeof v.enabled !== 'boolean' || !isInt(v.minWithdrawalMinor, 0, 1e12)) return false;
  if (!v.joinAd || typeof v.joinAd.enabled !== 'boolean') return false;
  if (!v.plans || typeof v.plans !== 'object') return false;
  return PLAN_IDS.every((id) => {
    const p = v.plans[id];
    return !!p && typeof p === 'object' && typeof p.name === 'string' && p.name.trim().length >= 1 && p.name.length <= 40
      && isInt(p.priceUsdCents, 0, 10_000_000) && (id === 'free' ? p.priceUsdCents === 0 : p.priceUsdCents > 0)
      && percentOk(p.withdrawalPercent) && typeof p.joinAds === 'boolean' && typeof p.enabled === 'boolean';
  });
}
registerConfig('creator_plans', DEFAULT_CREATOR_PLANS, checkCreatorPlans);

/** The stored setting merged over the defaults (so a partly filled value still works). */
export async function getCreatorPlansConfig(env) {
  const cfg = (await getConfig(env)).creator_plans;
  return checkCreatorPlans(cfg) ? cfg : DEFAULT_CREATOR_PLANS;
}


// ─── pure maths ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** Withdrawal percent (0.131 = 0.131%) → parts per million, exact integer (0.131% = 1310 ppm). */
export const ppmOf = (percent) => Math.round(Number(percent) * 10000);

/**
 * BibleNestra's withdrawal fee on a gross amount, in minor units. Half-up to the nearest minor unit, computed in BigInt:
 * fee = floor((gross × ppm + 500000) / 1000000). Pure.
 */
export function withdrawalFee(grossMinor, ppm) {
  const g = BigInt(Math.trunc(Number(grossMinor)));
  return Number((g * BigInt(Math.trunc(Number(ppm))) + 500000n) / 1000000n);
}

/** A plan's price in its charge currency. USD when `usdChargeable`, otherwise NGN at ngnPerUsd, rounded to the kobo. Pure. */
export function priceQuote(plan, { ngnPerUsd, usdChargeable = false }) {
  const usdCents = Number(plan.priceUsdCents);
  if (usdChargeable) return { usdCents, currency: 'USD', amountMinor: usdCents, fxRate: 1 };
  const rate = Number(ngnPerUsd);
  if (!(rate > 0)) throw new ApiError(503, 'FX_UNAVAILABLE', 'The exchange rate is not available right now. Try again shortly.');
  return { usdCents, currency: 'NGN', amountMinor: Math.round(usdCents * rate), fxRate: rate };
}

/** One month later (calendar month, UTC). */
export function addMonth(d) {
  const x = new Date(new Date(d).getTime());
  const day = x.getUTCDate();
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(day, lastDay)); // 31 Jan + 1 month = 28/29 Feb, never 3 March
  return x;
}

/**
 * The creator's plan state from their row (null = never chose a plan). Pure.
 *   → { planId, status, canCreate, reason, activePlanId, accessUntil, renewsOn, pendingPlanId, paid }
 * activePlanId is the plan that counts right now (fee, join ads): a lapsed paid plan counts as Free.
 */
export function planStateOf(row, now = new Date()) {
  if (!row) {
    return { planId: null, status: 'none', canCreate: false, reason: 'CREATOR_PLAN_REQUIRED', activePlanId: 'free', accessUntil: null, renewsOn: null, pendingPlanId: null, paid: false };
  }
  const pendingPlanId = row.pending_plan_id || null;
  if (row.plan_id === 'free') {
    return { planId: 'free', status: 'active', canCreate: true, reason: null, activePlanId: 'free', accessUntil: null, renewsOn: null, pendingPlanId, paid: false };
  }
  const end = row.current_period_end ? new Date(row.current_period_end) : null;
  const inDate = row.status === 'active' && !!end && end.getTime() > now.getTime();
  if (inDate) {
    return {
      planId: row.plan_id, status: 'active', canCreate: true, reason: null, activePlanId: row.plan_id,
      accessUntil: end.toISOString(), renewsOn: row.auto_renew ? end.toISOString() : null, pendingPlanId, paid: true,
    };
  }
  return {
    planId: row.plan_id, status: row.status === 'past_due' ? 'past_due' : 'expired', canCreate: false,
    reason: 'CREATOR_PLAN_LAPSED', activePlanId: 'free', accessUntil: end ? end.toISOString() : null, renewsOn: null, pendingPlanId, paid: false,
  };
}

// ─── DB state ────────────────────────────────────────────────────────────────────────────────────────────────────────
export const creatorRow = (env, userId) => one(env, 'SELECT * FROM creator_plan_subscriptions WHERE user_id = $1', [userId]);
export async function creatorPlanState(env, userId, now = new Date()) {
  return planStateOf(await creatorRow(env, userId), now);
}

/**
 * Gate for creating or publishing a membership. Platform admins are exempt; so is everyone while the feature is off.
 * Throws 403 CREATOR_PLAN_REQUIRED (no plan chosen yet) or 402 CREATOR_PLAN_LAPSED (paid plan ended or failed).
 */
export async function assertCreatorCanCreate(env, { userId, exempt = false }, now = new Date()) {
  if (exempt) return null;
  const cfg = await getCreatorPlansConfig(env);
  if (!cfg.enabled) return null;
  const st = await creatorPlanState(env, userId, now);
  if (st.canCreate) return st;
  if (st.reason === 'CREATOR_PLAN_REQUIRED') {
    throw new ApiError(403, 'CREATOR_PLAN_REQUIRED', 'Choose a creator plan (Free, Standard or Premium) before you create a membership.');
  }
  throw new ApiError(402, 'CREATOR_PLAN_LAPSED', 'Your paid creator plan has ended or the payment failed. Renew it or switch to Free to create memberships. Existing memberships keep running.');
}

/** Paid creators' rows keep the same shape the app reads (GET /creator-plan). */
export function planCardOf(id, plan, { ngnPerUsd, usdChargeable, formatPrice }) {
  const quote = priceQuote(plan, { ngnPerUsd, usdChargeable });
  return {
    id, name: plan.name, priceUsdCents: plan.priceUsdCents,
    priceUsdText: plan.priceUsdCents ? formatPrice(plan.priceUsdCents, 'USD') : 'Free',
    charge: plan.priceUsdCents ? { currency: quote.currency, amountMinor: quote.amountMinor, displayAmount: formatPrice(quote.amountMinor, quote.currency), fxRate: quote.fxRate } : null,
    withdrawalPercent: Number(plan.withdrawalPercent), withdrawalPpm: ppmOf(plan.withdrawalPercent),
    joinAds: !!plan.joinAds, enabled: !!plan.enabled,
  };
}

/** The live rate and charge mode for quotes. */
export async function rateContext(env) {
  const cfg = await getConfig(env);
  const cur = String(env.PAYSTACK_CURRENCIES || 'NGN').split(',').map((s) => s.trim().toUpperCase());
  return { ngnPerUsd: fxRates(cfg).USD, usdChargeable: cur.includes('USD') };
}

/** Quote for one paid plan at the current rate: { amountMinor, currency, fxRate, usdCents }. */
export async function quoteFor(env, planId) {
  const cfg = await getCreatorPlansConfig(env);
  const plan = cfg.plans[planId];
  if (!plan || !PAID_PLAN_IDS.includes(planId) || !plan.enabled) throw bad('Choose Standard or Premium', 'BAD_PLAN');
  return priceQuote(plan, await rateContext(env));
}

/** Free: no row → a row on Free. Immediate; cancels auto-renew and any pending change. */
export async function setFreePlan(env, userId) {
  return one(env, `INSERT INTO creator_plan_subscriptions (user_id, plan_id, status, auto_renew, pending_plan_id, current_period_end)
    VALUES ($1, 'free', 'active', false, NULL, NULL)
    ON CONFLICT (user_id) DO UPDATE SET plan_id = 'free', status = 'active', auto_renew = false, pending_plan_id = NULL,
      current_period_end = NULL, renewal_attempts = 0, last_renewal_at = NULL, reminded_for = NULL, updated_at = now()
    RETURNING *`, [userId]);
}

/** A downgrade between paid plans: applied when the paid period ends. */
export async function setPendingPlan(env, userId, planId) {
  return one(env, `UPDATE creator_plan_subscriptions SET pending_plan_id = $2, updated_at = now() WHERE user_id = $1 RETURNING *`, [userId, planId]);
}

/**
 * A paid plan was paid (purchase, upgrade, lapsed renew) or a renewal charge succeeded. Called once per payment from
 * paystackCheckout.js grant(), which claims the payment first. A renewal extends the period from its end; anything
 * else starts a month from now.
 */
export async function applyCreatorPlanPayment(env, { userId, planId, amountMinor, currency, fxRate = null, authId = null, renewal = false, reference = null, now = new Date() }) {
  if (!PAID_PLAN_IDS.includes(planId)) throw new ApiError(400, 'BAD_PLAN', 'Unknown creator plan');
  const cur = await creatorRow(env, userId);
  // A payment reference counts once: a retried settle must never add a second month (the period is extended by one month per payment).
  if (reference && cur && cur.last_payment_ref === reference) return cur;
  const curEnd = cur && cur.current_period_end ? new Date(cur.current_period_end) : null;
  const base = renewal && curEnd && curEnd.getTime() > now.getTime() ? curEnd : now;
  const end = addMonth(base);
  const card = !!authId || (renewal && !!(cur && cur.paystack_auth_id));
  return one(env, `INSERT INTO creator_plan_subscriptions (user_id, plan_id, status, pending_plan_id, current_period_end, auto_renew, paystack_auth_id,
      amount_minor, currency, fx_rate, renewal_attempts, last_renewal_at, reminded_for, last_payment_ref)
    VALUES ($1, $2, 'active', NULL, $3, $4, $5, $6, $7, $8, 0, NULL, NULL, $9)
    ON CONFLICT (user_id) DO UPDATE SET plan_id = EXCLUDED.plan_id, status = 'active', pending_plan_id = NULL,
      current_period_end = EXCLUDED.current_period_end, auto_renew = EXCLUDED.auto_renew,
      paystack_auth_id = COALESCE(EXCLUDED.paystack_auth_id, creator_plan_subscriptions.paystack_auth_id),
      amount_minor = EXCLUDED.amount_minor, currency = EXCLUDED.currency, fx_rate = EXCLUDED.fx_rate,
      renewal_attempts = 0, last_renewal_at = NULL, reminded_for = NULL, last_payment_ref = EXCLUDED.last_payment_ref, updated_at = now()
    RETURNING *`, [userId, planId, end.toISOString(), card, authId, amountMinor, currency, fxRate, reference]);
}

/**
 * Cron: paid periods that ended. A pending downgrade to Free starts now; a paid plan that ended unpaid expires
 * (no new memberships until renewed or switched to Free). Returns counts.
 */
export async function sweepCreatorPlans(env, now = new Date()) {
  const freed = await q(env, `UPDATE creator_plan_subscriptions SET plan_id = 'free', status = 'active', current_period_end = NULL,
      pending_plan_id = NULL, auto_renew = false, updated_at = now()
    WHERE plan_id <> 'free' AND pending_plan_id = 'free' AND current_period_end <= $1 RETURNING id`, [now.toISOString()]);
  const expired = await q(env, `UPDATE creator_plan_subscriptions SET status = 'expired', auto_renew = false, updated_at = now()
    WHERE plan_id <> 'free' AND status IN ('active','past_due') AND current_period_end <= $1 RETURNING id`, [now.toISOString()]);
  return { freed: freed.length, expired: expired.length };
}

// ─── join ad (Free-plan creators) ────────────────────────────────────────────────────────────────────────────────────
/**
 * Whether the join ad is due for this user and membership. Shown at most once per day per USER ACCOUNT, across every
 * Free-plan membership. The day runs from Africa/Lagos midnight (periodFor 'daily'). Pure apart from the DB reads.
 * → { due, reason, dayKey, resetsAt }
 */
export async function joinAdFor(env, user, m, now = new Date()) {
  const { key, end } = periodFor('daily', now);
  const dayKey = key.slice(2);
  const base = { due: false, reason: null, dayKey, resetsAt: end.toISOString() };
  const cfg = await getCreatorPlansConfig(env);
  if (!cfg.enabled || !cfg.joinAd.enabled) return { ...base, reason: 'off' };
  if (!user || !m) return { ...base, reason: 'signed_out' };
  const st = m.owner_id ? await creatorPlanState(env, m.owner_id, now) : { activePlanId: 'free' };
  if (st.activePlanId !== 'free') return { ...base, reason: 'paid_creator' };
  if (!cfg.plans.free.joinAds) return { ...base, reason: 'off' };
  const exempt = await exemptionOf(env, m, user, now); // platform admin, owner, group admin, Plus
  if (exempt) return { ...base, reason: `exempt:${exempt}` };
  const shown = await one(env, 'SELECT 1 AS x FROM user_daily_flags WHERE user_id = $1 AND flag_key = $2 AND day_key = $3', [user.id, JOIN_AD_FLAG, dayKey]);
  if (shown) return { ...base, reason: 'shown_today' };
  return { ...base, due: true, reason: 'due' };
}

/** Records that the join ad was shown today. Idempotent: returns true only the first time today. */
export async function recordJoinAdShown(env, userId, now = new Date()) {
  const dayKey = periodFor('daily', now).key.slice(2);
  const row = await one(env, `INSERT INTO user_daily_flags (user_id, flag_key, day_key) VALUES ($1, $2, $3)
    ON CONFLICT (user_id, flag_key, day_key) DO NOTHING RETURNING user_id`, [userId, JOIN_AD_FLAG, dayKey]);
  return !!row;
}
