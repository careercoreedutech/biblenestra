// CREATOR PLANS admin (Memberships tab → Creator plans / Creator withdrawals). Staff areas: lib/staff.js maps
// /admin/api/creator-* to 'memberships' (view to read, manage to change).
//   GET  /admin/api/creator-plans                    → { config, creationFeeEnabled, rate, creators: [...] }
//   PUT  /admin/api/creator-plans  { enabled, minWithdrawalMinor, joinAd, plans, creationFeeEnabled } → same shape
//   GET  /admin/api/creator-plans/creators?plan=&status=  → creators with plan, status and period end
//   GET  /admin/api/creator-withdrawals?status=requested  → the withdrawals queue
//   POST /admin/api/creator-withdrawals/:id/approve | /reject { reason } | /cancel | /paid { bankChargeMinor, reference }
import { Hono } from 'hono';
import { q } from '../lib/db.js';
import { bad, body, uuidParam } from '../lib/http.js';
import { requirePermission, audit } from './admin.js';
import { setConfig, getConfig } from '../lib/wallet.js';
import { fxRates } from '../lib/fundmeMoney.js';
import { checkCreatorPlans, getCreatorPlansConfig, PLAN_IDS, planStateOf, ppmOf } from '../lib/creatorPlans.js';
import { listWithdrawalsForAdmin, actOnWithdrawal } from '../lib/creatorWithdrawals.js';

export const adminCreatorPlans = new Hono();

async function settings(env) {
  const cfg = await getConfig(env);
  const plans = await getCreatorPlansConfig(env);
  return {
    config: plans,
    creationFeeEnabled: cfg.membership_creation_fee_enabled === true,
    rate: { ngnPerUsd: fxRates(cfg).USD, usdChargeable: String(env.PAYSTACK_CURRENCIES || 'NGN').toUpperCase().includes('USD') },
    planIds: PLAN_IDS,
    ppm: Object.fromEntries(PLAN_IDS.map((id) => [id, ppmOf(plans.plans[id].withdrawalPercent)])),
    creators: await creatorList(env, {}),
  };
}

/** Creators with their plan and state. Filters: plan (free|standard|premium), status (active|past_due|expired|none). */
export async function creatorList(env, { plan = null, status = null } = {}) {
  const rows = await q(env, `SELECT u.id, u.display_name, u.handle, s.plan_id, s.status, s.pending_plan_id, s.current_period_end, s.auto_renew,
      s.paystack_auth_id IS NOT NULL AS card_on_file,
      (SELECT COUNT(*) FROM memberships m WHERE m.owner_id = u.id) AS memberships
    FROM users u JOIN creator_plan_subscriptions s ON s.user_id = u.id
    WHERE ($1::text IS NULL OR s.plan_id = $1) ORDER BY s.updated_at DESC LIMIT 300`, [plan || null]);
  const out = rows.map((r) => {
    const st = planStateOf({ plan_id: r.plan_id, status: r.status, pending_plan_id: r.pending_plan_id, current_period_end: r.current_period_end, auto_renew: r.auto_renew, paystack_auth_id: r.card_on_file ? 'x' : null });
    return {
      userId: r.id, name: r.display_name || 'Creator', handle: r.handle || null, planId: r.plan_id, status: st.status, canCreate: st.canCreate,
      pendingPlanId: r.pending_plan_id || null, renewsOn: st.renewsOn, accessUntil: st.accessUntil, autoRenew: !!r.auto_renew,
      cardOnFile: !!r.card_on_file, memberships: Number(r.memberships || 0),
    };
  });
  return status ? out.filter((x) => x.status === status) : out;
}

/** Validates the admin's PUT body into the stored setting. Throws 400 BAD_CONFIG on anything wrong. */
export function mergeCreatorPlans(current, input = {}) {
  const next = {
    enabled: input.enabled === undefined ? current.enabled : input.enabled,
    minWithdrawalMinor: input.minWithdrawalMinor === undefined ? current.minWithdrawalMinor : Number(input.minWithdrawalMinor),
    joinAd: input.joinAd === undefined ? current.joinAd : { enabled: !!(input.joinAd && input.joinAd.enabled) },
    plans: {},
  };
  for (const id of PLAN_IDS) {
    const cur = current.plans[id];
    const p = input.plans && input.plans[id] ? input.plans[id] : {};
    next.plans[id] = {
      name: p.name === undefined ? cur.name : String(p.name).trim(),
      priceUsdCents: p.priceUsdCents === undefined ? cur.priceUsdCents : Number(p.priceUsdCents),
      withdrawalPercent: p.withdrawalPercent === undefined ? cur.withdrawalPercent : Number(p.withdrawalPercent),
      joinAds: p.joinAds === undefined ? cur.joinAds : !!p.joinAds,
      enabled: p.enabled === undefined ? cur.enabled : !!p.enabled,
    };
  }
  if (!checkCreatorPlans(next)) throw bad('Check the plan values: prices in cents (Free 0, paid plans above 0), withdrawal % from 0 to 10 with at most 3 decimals, names up to 40 letters', 'BAD_CONFIG');
  return next;
}

adminCreatorPlans.get('/admin/api/creator-plans', requirePermission('memberships', 'view'), async (c) => c.json(await settings(c.env)));

adminCreatorPlans.put('/admin/api/creator-plans', requirePermission('memberships', 'manage'), async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const cur = await getCreatorPlansConfig(c.env);
  const next = mergeCreatorPlans(cur, b);
  await setConfig(c.env, 'creator_plans', next, me.id);
  if (b.creationFeeEnabled !== undefined) await setConfig(c.env, 'membership_creation_fee_enabled', !!b.creationFeeEnabled, me.id);
  await audit(c.env, me, 'creator_plans.update', 'wallet_config', 'creator_plans', { enabled: next.enabled, plans: PLAN_IDS.map((id) => [id, next.plans[id].priceUsdCents, next.plans[id].withdrawalPercent]) });
  return c.json(await settings(c.env));
});

adminCreatorPlans.get('/admin/api/creator-plans/creators', requirePermission('memberships', 'view'), async (c) => {
  const plan = c.req.query('plan') || null;
  const status = c.req.query('status') || null;
  return c.json({ items: await creatorList(c.env, { plan: PLAN_IDS.includes(plan) ? plan : null, status }) });
});

adminCreatorPlans.get('/admin/api/creator-withdrawals', requirePermission('memberships', 'view'), async (c) => {
  const status = c.req.query('status') || null;
  return c.json({ items: await listWithdrawalsForAdmin(c.env, { status }) });
});

for (const action of ['approve', 'reject', 'cancel', 'paid']) {
  adminCreatorPlans.post(`/admin/api/creator-withdrawals/:id/${action}`, requirePermission('memberships', 'manage'), async (c) => {
    const me = c.get('user');
    const b = await body(c);
    const w = await actOnWithdrawal(c.env, me.id, uuidParam(c), action, {
      bankChargeMinor: b.bankChargeMinor === undefined ? 0 : Number(b.bankChargeMinor), reference: b.reference, reason: b.reason,
    });
    await audit(c.env, me, `creator_withdrawal.${action}`, 'creator_withdrawal', w.id, { status: w.status, grossMinor: w.grossMinor, feeMinor: w.feeMinor });
    return c.json(w);
  });
}
