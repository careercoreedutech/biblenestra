// PAYSTACK FOR EVERY PURCHASE — HTTP. Library: lib/paystackCheckout.js.
//
// Public:
//   GET  /pay/paystack/return?reference=       Paystack's callback_url → verify + grant → "Payment received" page
//                                              (redirects to biblenestra://paystack?reference=… so the app's browser closes)
//   GET  /pay/paystack/fake/:reference         LOCAL DEV / TESTS ONLY (env.__paystackFake): a pretend Paystack page
// Signed in:
//   GET  /payments/paystack/:reference         status for the app's poll (re-verifies a pending payment)
//   GET  /payments/paystack                    my recent Paystack payments
//   GET  /plus                                 BibleNestra Plus plans, my plan, payment methods
//   POST /plus/checkout { planId, email, provider: 'paystack'|'test' }   → { checkout: { reference, url } } | { plus } (test)
//   POST /plus/cancel                          renewal off; Plus stays until the period ends
// Admin (/admin/api/paystack/*): overview + switch, payments (search, recheck), Plus plan prices.
// Webhook: POST /webhooks/paystack (and the older /webhooks/fundme/paystack) live in routes/fundme.js and hand
// non-donation charges to settlePayment().
import { Hono } from 'hono';
import { q, one } from '../lib/db.js';
import { bad, body, notFound } from '../lib/http.js';
import { audit, requireAdmin, registerAdminScript } from './admin.js';
import { paystackConfigured, paystackTestMode, paystackPublicKey } from '../lib/paystack.js';
import { getConfig, setConfig, rateLimit } from '../lib/wallet.js';
import { testPurchaseAllowed } from '../lib/walletStore.js';
import {
  settlePayment, paymentStatus, paymentShape, paystackMethod, inAppEnabled, listPlusPlans, livePlus, plusSubShape, startPlusCheckout,
  cancelPlus, testPlus, paystackCurrencies,
} from '../lib/paystackCheckout.js';
import { PAYSTACK_ADMIN_SCRIPT } from '../lib/paystackAdminPage.js';

registerAdminScript(PAYSTACK_ADMIN_SCRIPT);

const origin = (c) => new URL(c.req.url).origin;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function resultPage({ title, text, ok, reference }) {
  const deep = `biblenestra://paystack?reference=${encodeURIComponent(reference || '')}&status=${ok ? 'success' : 'pending'}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · BibleNestra</title>
<style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#FBF8F3;color:#2B2620}
.w{max-width:420px;margin:0 auto;padding:64px 20px;text-align:center}.b{font-weight:700;color:#B5643C;letter-spacing:.3px}
.i{font-size:52px;margin:24px 0 8px}h1{font-size:22px;margin:0 0 8px}p{color:#6B6255;line-height:1.5}
a.btn{display:inline-block;margin-top:18px;background:#B5643C;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600}</style></head>
<body><div class="w"><div class="b">✦ BibleNestra</div><div class="i">${ok ? '✅' : '⏳'}</div><h1>${esc(title)}</h1><p>${esc(text)}</p>
<a class="btn" href="${esc(deep)}">Back to BibleNestra</a></div>
<script>setTimeout(function(){ location.href = ${JSON.stringify(deep)}; }, 1200);</script></body></html>`;
}

// ─── public ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export const paystackPublic = new Hono();

paystackPublic.get('/pay/paystack/return', async (c) => {
  const ref = String(c.req.query('reference') || c.req.query('trxref') || '').slice(0, 100);
  const p = ref ? await one(c.env, 'SELECT * FROM paystack_payments WHERE reference = $1', [ref]) : null;
  if (!p) return c.html(resultPage({ title: 'Payment not found', text: 'We couldn’t find this payment. If you were charged, contact support with your Paystack receipt.', ok: false, reference: ref }), 404);
  let status = p.status;
  if (!['success', 'refunded', 'review'].includes(status)) {
    try { status = (await settlePayment(c.env, ref)).status || status; } catch (e) { /* the webhook finishes it */ }
  }
  if (status === 'success') return c.html(resultPage({ title: 'Payment received', text: 'Thank you! Your purchase is ready in the app.', ok: true, reference: ref }));
  if (c.req.query('cancelled') || status === 'abandoned') return c.html(resultPage({ title: 'Payment cancelled', text: 'No money was taken. You can try again from the app.', ok: false, reference: ref }));
  if (status === 'failed') return c.html(resultPage({ title: 'Payment didn’t go through', text: 'No purchase was made. Please try again or use another payment method.', ok: false, reference: ref }));
  if (status === 'review') return c.html(resultPage({ title: 'We’re checking your payment', text: 'Your payment arrived but needs a quick check by our team. You’ll get a notification soon.', ok: false, reference: ref }));
  return c.html(resultPage({ title: 'Payment processing', text: 'Bank transfers can take a minute. We’ll add your purchase as soon as Paystack confirms it.', ok: false, reference: ref }));
});

// Local dev / tests: env.__paystackFake (dev/fake-paystack.mjs) stands in for Paystack's hosted page.
paystackPublic.get('/pay/paystack/fake/:reference', (c) => {
  const fake = c.env.__paystackFake;
  if (!fake) throw notFound('Not found');
  const t = fake.get(c.req.param('reference'));
  if (!t) throw notFound('Unknown test payment');
  const base = `/pay/paystack/fake/${encodeURIComponent(t.reference)}/`;
  const amount = `${t.currency} ${(t.amount / 100).toLocaleString('en-NG')}`;
  return c.html(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Test Paystack</title>
<style>body{font-family:system-ui,sans-serif;background:#F4F6F8;margin:0}.w{max-width:380px;margin:40px auto;background:#fff;border-radius:14px;padding:24px;box-shadow:0 2px 12px #0001}
.t{font-size:12px;color:#B54708;background:#FEF0C7;border-radius:6px;padding:6px 8px;margin-bottom:14px}a{display:block;text-align:center;margin-top:10px;padding:12px;border-radius:8px;text-decoration:none;font-weight:600}
.p{background:#0BA4DB;color:#fff}.c{background:#eee;color:#333}.f{background:#fee;color:#b42318}</style></head><body><div class="w">
<div class="t">LOCAL TEST PAYMENT — no money moves</div><div>${esc(t.email)}</div><h2>Pay ${esc(amount)}</h2><div style="color:#667">${esc((t.metadata && t.metadata.title) || '')}</div>
<a class="p" href="${base}pay?channel=card">Pay with card</a><a class="p" href="${base}pay?channel=bank_transfer">Pay with bank transfer</a>
<a class="f" href="${base}fail">Card declined</a><a class="c" href="${esc((t.metadata && t.metadata.cancel_action) || '/')}">Cancel</a></div></body></html>`);
});
paystackPublic.get('/pay/paystack/fake/:reference/:outcome', (c) => {
  const fake = c.env.__paystackFake;
  if (!fake) throw notFound('Not found');
  const t = fake.complete(c.req.param('reference'), c.req.param('outcome') === 'pay' ? 'success' : 'failed', c.req.query('channel') || 'card');
  if (!t) throw notFound('Unknown test payment');
  return c.redirect(`${t.callback_url}?reference=${encodeURIComponent(t.reference)}`, 302);
});

// ─── signed in ──────────────────────────────────────────────────────────────────────────────────────────────────────
export const paystackApp = new Hono();

paystackApp.get('/payments/paystack', async (c) => {
  const me = c.get('user');
  const rows = await q(c.env, 'SELECT * FROM paystack_payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [me.id]);
  return c.json({ items: rows.map(paymentShape) });
});
paystackApp.get('/payments/paystack/:reference', async (c) => {
  const me = c.get('user');
  await rateLimit(c.env, `paystack_status:${me.id}`, 60, 60);
  return c.json({ payment: await paymentStatus(c.env, me, c.req.param('reference')) });
});

paystackApp.get('/plus', async (c) => {
  const me = c.get('user');
  const [plans, live, inApp, u] = await Promise.all([listPlusPlans(c.env), livePlus(c.env, me.id), inAppEnabled(c.env), one(c.env, 'SELECT premium, premium_until, billing_email FROM users WHERE id = $1', [me.id])]);
  const methods = [paystackMethod(c.env, { inApp, currency: (plans[0] && plans[0].currency) || 'NGN' })];
  if (testPurchaseAllowed(c.env, me)) methods.unshift({ id: 'test', label: 'Test purchase', provider: 'test', available: true, note: 'Admins & testers only · no money moves' });
  return c.json({
    plans, subscription: plusSubShape(live), methods, canPay: methods.some((m) => m.available),
    premium: !!(u && u.premium && (!u.premium_until || new Date(u.premium_until) > new Date())),
    premiumUntil: u && u.premium_until ? new Date(u.premium_until).toISOString() : null,
    billingEmail: (u && u.billing_email) || null,
  });
});
paystackApp.post('/plus/checkout', async (c) => {
  const me = c.get('user');
  await rateLimit(c.env, `plus_checkout:${me.id}`, 10, 60);
  const b = await body(c);
  if (String(b.provider || 'paystack') === 'test') {
    const s = await testPlus(c.env, me, b.planId);
    return c.json({ subscription: plusSubShape(await livePlus(c.env, me.id)) || plusSubShape(s), premium: true }, 201);
  }
  const r = await startPlusCheckout(c.env, me, { planId: b.planId, email: b.email, origin: origin(c) });
  return c.json(r, 201);
});
paystackApp.post('/plus/cancel', async (c) => {
  const me = c.get('user');
  return c.json({ subscription: await cancelPlus(c.env, me.id) });
});

// ─── admin ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export const adminPaystack = new Hono();
adminPaystack.use('/admin/api/paystack/*', requireAdmin);

adminPaystack.get('/admin/api/paystack/overview', async (c) => {
  const cfg = await getConfig(c.env);
  const totals = await q(c.env, `SELECT kind, status, test, count(*)::int AS n, COALESCE(sum(amount_minor),0)::bigint AS minor, currency
      FROM paystack_payments GROUP BY kind, status, test, currency ORDER BY kind, status`);
  const renewing = await one(c.env, `SELECT
      (SELECT count(*) FROM dating_subscriptions WHERE provider = 'paystack' AND status = 'active')::int AS dating,
      (SELECT count(*) FROM membership_subscriptions WHERE source = 'paystack' AND status = 'active')::int AS memberships,
      (SELECT count(*) FROM plus_subscriptions WHERE provider = 'paystack' AND status = 'active')::int AS plus,
      (SELECT count(*) FROM paystack_payments WHERE status = 'review')::int AS review`);
  return c.json({
    configured: paystackConfigured(c.env), testMode: paystackTestMode(c.env), publicKey: paystackPublicKey(c.env),
    currencies: paystackCurrencies(c.env), inApp: cfg.paystack_in_app !== false,
    webhookUrl: `${origin(c)}/webhooks/paystack`, callbackUrl: `${origin(c)}/pay/paystack/return`,
    totals: totals.map((t) => ({ ...t, minor: Number(t.minor) })), active: renewing,
  });
});
adminPaystack.put('/admin/api/paystack/in-app', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  if (typeof b.on !== 'boolean') throw bad('on must be true or false');
  await setConfig(c.env, 'paystack_in_app', b.on, me.id);
  await audit(c.env, me, 'paystack_in_app', 'config', 'paystack_in_app', { on: b.on });
  return c.json({ inApp: b.on });
});
adminPaystack.get('/admin/api/paystack/payments', async (c) => {
  const s = String(c.req.query('q') || '').trim();
  const status = c.req.query('status') || null;
  const kind = c.req.query('kind') || null;
  const rows = await q(c.env, `SELECT p.*, u.display_name, u.handle FROM paystack_payments p LEFT JOIN users u ON u.id = p.user_id
      WHERE ($1::text IS NULL OR p.status = $1) AND ($2::text IS NULL OR p.kind = $2)
        AND ($3 = '' OR p.reference = $3 OR lower(u.handle) = lower(ltrim($3, '@')) OR p.user_id::text = $3 OR p.email = lower($3))
      ORDER BY p.created_at DESC LIMIT 100`, [status, kind, s]);
  return c.json({ items: rows.map(paymentShape) });
});
adminPaystack.post('/admin/api/paystack/payments/:reference/recheck', async (c) => {
  const me = c.get('user');
  const ref = c.req.param('reference');
  const p = await one(c.env, 'SELECT * FROM paystack_payments WHERE reference = $1', [ref]);
  if (!p) throw notFound('Payment not found');
  if (p.status === 'review') await q(c.env, `UPDATE paystack_payments SET status = 'pending', updated_at = now() WHERE id = $1`, [p.id]); // try the grant again
  const r = await settlePayment(c.env, ref);
  await audit(c.env, me, 'paystack_recheck', 'paystack_payment', ref, { status: r.status });
  return c.json(r);
});
adminPaystack.get('/admin/api/paystack/plus-plans', async (c) => c.json({ items: await listPlusPlans(c.env, { includeInactive: true }) }));
adminPaystack.patch('/admin/api/paystack/plus-plans/:id', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const cur = await one(c.env, 'SELECT * FROM plus_plans WHERE id = $1', [c.req.param('id')]);
  if (!cur) throw notFound('Plan not found');
  const price = b.priceMinor !== undefined ? Number(b.priceMinor) : Number(cur.price_minor);
  if (!Number.isInteger(price) || price < 100 || price > 1e11) throw bad('priceMinor must be a whole number of kobo (≥ 100)');
  const label = b.label !== undefined ? String(b.label).trim().slice(0, 40) : cur.label;
  if (!label) throw bad('label is required');
  const active = b.active !== undefined ? !!b.active : cur.active;
  const note = b.note !== undefined ? (String(b.note).trim().slice(0, 80) || null) : cur.note;
  await q(c.env, 'UPDATE plus_plans SET price_minor = $2, label = $3, active = $4, note = $5, updated_at = now() WHERE id = $1', [cur.id, price, label, active, note]);
  await audit(c.env, me, 'plus_plan_update', 'plus_plan', cur.id, { priceMinor: price, label, active });
  return c.json({ items: await listPlusPlans(c.env, { includeInactive: true }) });
});
