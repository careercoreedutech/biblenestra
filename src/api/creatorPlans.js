// CREATOR PLANS API (round 3): Free / Standard / Premium for membership creators, creator withdrawals, and the
// once-a-day join ad for members joining a Free creator's membership. Paid plans pay through Paystack
// (payWithPaystack in src/billing/paystack.js), the same hosted page as every other purchase.
import { useCallback, useEffect, useState } from 'react';
import { useApi } from './auth';

export const getCreatorPlan = (api) => api.request('GET', '/creator-plan');
/** { planId, email? } → { status: 'changed' | 'scheduled' | 'checkout', … } (checkout carries { checkout: { reference, url } }). */
export const changeCreatorPlan = (api, planId, email) => api.request('POST', '/creator-plan/change', { planId, email: email || undefined });
export const getCreatorWithdrawals = (api, currency = 'NGN') => api.request('GET', `/creator-plan/withdrawals?currency=${encodeURIComponent(currency)}`);
export const requestCreatorWithdrawal = (api, amountMinor, currency = 'NGN') => api.request('POST', '/creator-plan/withdrawals', { amountMinor, currency });
export const cancelCreatorWithdrawal = (api, id) => api.request('POST', `/creator-plan/withdrawals/${id}/cancel`, {});

/** Friendly text for the creator-plan error codes. */
export function creatorPlanMessage(e, fallback = 'Something went wrong') {
  const code = e && e.code;
  if (code === 'CREATOR_PLAN_REQUIRED') return 'Choose a creator plan first. Free costs nothing.';
  if (code === 'CREATOR_PLAN_LAPSED') return 'Your paid plan has ended or the payment failed. Renew it or switch to Free to create.';
  if (code === 'ALREADY_ON_PLAN') return 'You are already on this plan.';
  if (code === 'KYC_REQUIRED') return 'Confirm your identity (KYC) before you withdraw.';
  if (code === 'INSUFFICIENT_BALANCE') return e.message || 'That is more than your available balance.';
  if (code === 'BELOW_MINIMUM') return e.message || 'That is below the minimum withdrawal.';
  return (e && e.message) || fallback;
}

/**
 * Join ad (Free-plan creators): asks the server if it is due, shows one interstitial, then reports it shown.
 * Never blocks joining: if no ad fills or anything fails, the join carries on. → { shown, reason }
 */
export async function runJoinAd(api, membershipId, showInterstitial) {
  try {
    const due = await api.request('GET', `/memberships/${membershipId}/join-ad`);
    if (!due || !due.due) return { shown: false, reason: due ? due.reason : 'unknown' };
    const r = typeof showInterstitial === 'function' ? await showInterstitial({ surface: 'membership', placement: 'join', skipAfterSec: 5 }) : null;
    if (!r || !r.shown) return { shown: false, reason: (r && r.reason) || 'no_fill' };
    await api.request('POST', `/memberships/${membershipId}/join-ad/shown`, {});
    return { shown: true };
  } catch (e) {
    return { shown: false, reason: 'error' };
  }
}

/** The creator's plan screen data: { data, error, reload }. */
export function useCreatorPlan() {
  const api = useApi();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const reload = useCallback(() => {
    getCreatorPlan(api).then((d) => { setData(d); setError(null); }).catch((e) => setError(e));
  }, [api]);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, reload };
}
