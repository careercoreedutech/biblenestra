// PAYSTACK RECONCILIATION (every 15 minutes, from the scheduled handler in index.js). Why it exists: a payment is granted
// only when something asks Paystack about it: the webhook, the return page, or the app's status poll. A bank transfer or
// USSD payment that completes after the member closed the page, with a webhook that never arrived, stayed pending for good.
// This job re-verifies recent unfinished Paystack transactions with GET /transaction/verify and grants the ones that
// succeeded, through the same settlePayment() path (grant-once). API calls are capped per run (wallet setting
// paystack_reconcile_max, default 10, at most 50). Rows younger than 2 minutes are left to the webhook.
import { q } from './db.js';
import { getConfig, registerConfig } from './wallet.js';
import { paystackConfigured } from './paystack.js';
import { settlePayment } from './paystackCheckout.js';

registerConfig('paystack_reconcile_max', 10, (v) => Number.isInteger(v) && v >= 1 && v <= 50);

export async function reconcilePaystack(env, { limit = null } = {}) {
  if (!paystackConfigured(env)) return { checked: 0, granted: 0, failed: 0 };
  const cfg = await getConfig(env);
  const max = Math.min(50, Math.max(1, Number(limit) || Number(cfg.paystack_reconcile_max) || 10));
  // Unfinished rows from the last 3 days: pending (initialized, not paid yet), failed or abandoned (a later attempt on the
  // same reference can still succeed), and processing rows stuck over 2 minutes (a grant that never finished).
  const rows = await q(env, `SELECT reference FROM paystack_payments
     WHERE (status IN ('pending','failed','abandoned') OR (status = 'processing' AND updated_at < now() - interval '2 minutes'))
       AND created_at < now() - interval '2 minutes' AND created_at > now() - interval '3 days'
     ORDER BY random() LIMIT $1`, [max]);
  let granted = 0; let failed = 0;
  for (const r of rows) {
    try {
      const res = await settlePayment(env, r.reference);
      if (res.granted) granted++;
    } catch (e) {
      failed++;
      console.error('paystack reconcile failed', r.reference, e && (e.code || e.message));
    }
  }
  return { checked: rows.length, granted, failed };
}
