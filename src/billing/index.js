// BibleNestra Plus — paid through Paystack (card, bank transfer, USSD), client decision 2026-11-21.
// Server: GET /plus (plans + my plan + payment methods), POST /plus/checkout, POST /plus/cancel
// (backend/src/routes/paystack.js). Prices are set by admins (Admin › Wallets & payments › Paystack) and come from the
// server; PLANS below is only the offline fallback shown before the server answers.
// Paid by card → renews automatically until cancelled. Bank transfer / USSD → no auto-renew, a reminder before it ends.
// When Plus is active the server sets users.premium / premium_until; GET /me → the sync layer sets state.premium.
import { useCallback, useEffect, useState } from 'react';
import { payWithPaystack } from './paystack';

export const PLANS = [
  { id: 'yearly', label: 'Yearly', priceText: '₦25,000', perText: 'a year', note: 'Just ₦481 a week', badge: 'Save 68%' },
  { id: 'weekly', label: 'Weekly', priceText: '₦1,500', perText: 'a week', note: 'Billed every week' },
];

/** GET /plus → { plans, subscription, methods, canPay, premium, premiumUntil, billingEmail } (null offline). */
export function usePlus(api) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    if (!api || !api.online) return;
    try { setData(await api.request('GET', '/plus')); setError(null); } catch (e) { setError(e); }
  }, [api && api.online]);
  useEffect(() => { load(); }, [load]);
  return { data, error, reload: load, plans: (data && data.plans && data.plans.length ? data.plans : PLANS) };
}

export function billingReady(plus) {
  return !!(plus && plus.methods && plus.methods.some((m) => m.available));
}

export class BillingNotReady extends Error {
  constructor(message = 'Subscriptions open soon') {
    super(message);
    this.code = 'BILLING_NOT_READY';
  }
}

/**
 * Pays for a plan. provider 'test' (admins / testers) activates at once with no money.
 * → { status: 'success' | 'failed' | 'pending' | 'review' | 'abandoned' }
 */
export async function buy(api, plan, { provider = 'paystack', email = null } = {}) {
  if (!api || !api.online) throw new BillingNotReady('Sign in to subscribe');
  return payWithPaystack(api, (mail) => api.request('POST', '/plus/checkout', { planId: plan.id, provider, email: mail }), { email });
}

/** Re-reads Plus from the server (new phone, reinstall). → true when Plus is active. */
export async function restore(api) {
  if (!api || !api.online) throw new BillingNotReady('Sign in to restore');
  const d = await api.request('GET', '/plus');
  return !!d.premium;
}

export const cancelPlus = (api) => api.request('POST', '/plus/cancel');
