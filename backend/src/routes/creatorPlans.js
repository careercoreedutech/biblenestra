// CREATOR PLANS routes (signed in). Free / Standard / Premium, creator withdrawals, and the Free-plan join ad.
//   GET  /creator-plan                         → the plan catalogue (USD + NGN charge), my plan, renewal, payment history
//   POST /creator-plan/change  { planId, email } → { status: 'changed' | 'scheduled' | 'checkout', … }
//          Free: immediate. Upgrade or first paid plan / renewing a lapsed one: Paystack checkout (202, then poll the payment).
//          Downgrade between paid plans: scheduled for the end of the period. Same plan again clears a scheduled change.
//   GET  /creator-plan/withdrawals?currency=NGN  → balance, fee for the active plan, minimum, history
//   POST /creator-plan/withdrawals { amountMinor, currency } → a request (KYC approved required)
//   POST /creator-plan/withdrawals/:id/cancel  → cancel a request nobody has picked up
//   GET  /memberships/:id/join-ad              → { due, reason, dayKey, resetsAt } for the signed-in user
//   POST /memberships/:id/join-ad/shown        → records the ad as shown today (only when it was due); { recorded }
import { Hono } from 'hono';
import { q, one } from '../lib/db.js';
import { ApiError, bad, notFound, body, uuidParam } from '../lib/http.js';
import { isPlatformAdmin } from '../lib/play.js';
import { formatPrice } from '../lib/memberships.js';
import {
  PLAN_IDS, PAID_PLAN_IDS, getCreatorPlansConfig, creatorRow, planStateOf, planCardOf, rateContext, quoteFor, setFreePlan, setPendingPlan,
  joinAdFor, recordJoinAdShown,
} from '../lib/creatorPlans.js';
import { startCreatorPlanCheckout } from '../lib/paystackCheckout.js';
import {
  withdrawalOverview, requestWithdrawal, cancelWithdrawal,
} from '../lib/creatorWithdrawals.js';

export const creatorPlans = new Hono();
const origin = (c) => new URL(c.req.url).origin;
const signedIn = (c) => {
  const me = c.get('user');
  if (!me) throw new ApiError(401, 'SIGN_IN', 'Sign in to continue');
  return me;
};

/** The whole plan screen: catalogue, my plan and recent creator-plan payments. */
export async function creatorPlanView(env, userId) {
  const cfg = await getCreatorPlansConfig(env);
  const rate = await rateContext(env);
  const row = await creatorRow(env, userId);
  const st = planStateOf(row);
  const payments = await q(env, `SELECT reference, status, purpose, amount_minor, currency, paid_at, created_at, payload
      FROM paystack_payments WHERE user_id = $1 AND kind = 'creator_plan' ORDER BY created_at DESC LIMIT 30`, [userId]);
  const message = st.canCreate ? null
    : st.reason === 'CREATOR_PLAN_LAPSED' ? 'Your paid plan has ended or the payment failed. Renew it or switch to Free to create new memberships. Your memberships keep running.'
      : 'Choose a plan to create memberships. Free costs nothing.';
  return {
    enabled: !!cfg.enabled,
    plans: PLAN_IDS.map((id) => planCardOf(id, cfg.plans[id], { ...rate, formatPrice })),
    current: {
      planId: st.planId, activePlanId: st.activePlanId, status: st.status, canCreate: st.canCreate, reason: st.reason, message,
      accessUntil: st.accessUntil, renewsOn: st.renewsOn, pendingPlanId: st.pendingPlanId, autoRenew: !!(row && row.auto_renew),
      cardOnFile: !!(row && row.paystack_auth_id),
    },
    payments: payments.map((p) => {
      const pl = p.payload || {};
      return {
        reference: p.reference, status: p.status, purpose: p.purpose, planId: pl.planId || null,
        amountMinor: Number(p.amount_minor), currency: p.currency, displayAmount: formatPrice(Number(p.amount_minor), p.currency),
        paidAt: p.paid_at ? new Date(p.paid_at).toISOString() : null, createdAt: new Date(p.created_at).toISOString(),
      };
    }),
  };
}

creatorPlans.get('/creator-plan', async (c) => c.json(await creatorPlanView(c.env, signedIn(c).id)));

creatorPlans.post('/creator-plan/change', async (c) => {
  const me = signedIn(c);
  const b = await body(c);
  const planId = String(b.planId || '');
  if (!PLAN_IDS.includes(planId)) throw bad('Choose Free, Standard or Premium', 'BAD_PLAN');
  const cfg = await getCreatorPlansConfig(c.env);
  if (!cfg.plans[planId].enabled) throw bad('That plan is not available right now', 'PLAN_DISABLED');
  const row = await creatorRow(c.env, me.id);
  const st = planStateOf(row);
  if (planId === 'free') {
    if (st.planId === 'free') throw new ApiError(409, 'ALREADY_ON_PLAN', 'You are already on Free');
    await setFreePlan(c.env, me.id); // immediate: no refund, auto-renew off
    return c.json({ status: 'changed', ...(await creatorPlanView(c.env, me.id)) });
  }
  const inPaid = st.canCreate && PAID_PLAN_IDS.includes(st.planId);
  if (inPaid && st.planId === planId) {
    if (!st.pendingPlanId) throw new ApiError(409, 'ALREADY_ON_PLAN', 'You are already on this plan');
    await setPendingPlan(c.env, me.id, null); // cancels the scheduled change
    return c.json({ status: 'changed', ...(await creatorPlanView(c.env, me.id)) });
  }
  if (inPaid && cfg.plans[planId].priceUsdCents < cfg.plans[st.planId].priceUsdCents) {
    await setPendingPlan(c.env, me.id, planId); // downgrade between paid plans: at the end of the period
    return c.json({ status: 'scheduled', effectiveAt: st.accessUntil, ...(await creatorPlanView(c.env, me.id)) });
  }
  // upgrade (immediate, full month, no proration), a first paid plan, or renewing a lapsed one
  const quote = await quoteFor(c.env, planId);
  const r = await startCreatorPlanCheckout(c.env, me, {
    planId, amountMinor: quote.amountMinor, currency: quote.currency, fxRate: quote.fxRate, email: b.email, origin: origin(c),
    title: `Creator plan · ${cfg.plans[planId].name}`,
  });
  return c.json({ status: 'checkout', ...r, charge: { amountMinor: quote.amountMinor, currency: quote.currency, fxRate: quote.fxRate, usdCents: quote.usdCents } }, 202);
});

creatorPlans.get('/creator-plan/withdrawals', async (c) => {
  const me = signedIn(c);
  return c.json(await withdrawalOverview(c.env, me.id, String(c.req.query('currency') || 'NGN').toUpperCase()));
});

creatorPlans.post('/creator-plan/withdrawals', async (c) => {
  const me = signedIn(c);
  const b = await body(c);
  return c.json(await requestWithdrawal(c.env, me, { amountMinor: Number(b.amountMinor), currency: b.currency || 'NGN' }), 201);
});

creatorPlans.post('/creator-plan/withdrawals/:id/cancel', async (c) => {
  const me = signedIn(c);
  return c.json(await cancelWithdrawal(c.env, me, uuidParam(c)));
});

/** A membership a viewer may open: published, or its owner / a platform admin. */
async function visibleMembership(c) {
  const me = c.get('user');
  const m = await one(c.env, 'SELECT * FROM memberships WHERE id = $1', [uuidParam(c)]);
  if (!m) throw notFound('Membership not found');
  if (m.status === 'published' || isPlatformAdmin(me) || (m.owner_id && me && m.owner_id === me.id)) return m;
  throw notFound('Membership not found');
}

creatorPlans.get('/memberships/:id/join-ad', async (c) => {
  const m = await visibleMembership(c);
  return c.json(await joinAdFor(c.env, c.get('user'), m));
});

creatorPlans.post('/memberships/:id/join-ad/shown', async (c) => {
  const me = signedIn(c);
  const m = await visibleMembership(c);
  const due = await joinAdFor(c.env, me, m);
  if (!due.due) return c.json({ recorded: false, reason: due.reason, dayKey: due.dayKey, resetsAt: due.resetsAt });
  const recorded = await recordJoinAdShown(c.env, me.id);
  return c.json({ recorded, reason: recorded ? 'recorded' : 'shown_today', dayKey: due.dayKey, resetsAt: due.resetsAt });
});
