// PAYMENT VERIFICATION — HTTP. Logic: lib/paymentReports.js · reconciliation cron: lib/paystackReconcile.js.
//
// Public:
//   GET  /membership-invite/:token                 landing page for an admission link (opens the app)
// Signed in:
//   POST /payments/report/receipt                  raw image body (jpeg/png/webp/heic, ≤ 8 MB) → { key } (private)
//   GET  /payments/report-options                  my recent Paystack attempts (to pick from)
//   POST /payments/reports { reference, amount, method, kind, targetId, planId?, receiptKey, note? } → 201 { report }
//   GET  /payments/reports                         my reports and their status
//   GET  /membership-invites/:token/preview        what the link admits to (this account)
//   POST /membership-invites/:token/accept         single-use admission (needs a verified payment here)
// Admin (role admin; staff area "wallets" — see lib/staff.js ROUTE_AREAS):
//   GET  /admin/api/payment-reports?status=pending|approved|rejected|all
//   GET  /admin/api/payment-reports/:id/receipt
//   POST /admin/api/payment-reports/:id/check      ask Paystack (verify API) and store the snapshot
//   POST /admin/api/payment-reports/:id/approve    { mode: 'paystack' | 'manual', reason?, expiresAt? }
//   POST /admin/api/payment-reports/:id/reject     { reason }
//   POST /admin/api/membership-grants              { userId, membershipId, planId, expiresAt, reason } (manual grant)
//   GET  /admin/api/membership-invites?membershipId=
//   POST /admin/api/membership-invites             { membershipId, planId, userId?, expiresInHours?, accessUntil? } → { link }
//   POST /admin/api/membership-invites/:id/revoke
import { Hono } from 'hono';
import { one } from '../lib/db.js';
import { ApiError, bad, body, notFound } from '../lib/http.js';
import { sha256Hex } from '../lib/staff.js';
import { requireAdmin, registerAdminScript } from './admin.js';
import {
  RECEIPT_TYPES, MAX_RECEIPT, receiptKeyFor, reportOptions, createPaymentReport, myReports, listPaymentReports, loadReport, checkPaymentReport,
  approvePaymentReport, rejectPaymentReport, manualMembershipGrant, createMembershipInvite, listMembershipInvites, revokeMembershipInvite,
  previewInvite, acceptInvite,
} from '../lib/paymentReports.js';
import { PAYMENT_REPORTS_ADMIN_SCRIPT } from '../lib/paymentReportsAdminPage.js';

registerAdminScript(PAYMENT_REPORTS_ADMIN_SCRIPT);

const origin = (c) => new URL(c.req.url).origin;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// ─── public: invitation landing page ─────────────────────────────────────────────────────────────────────────────────
export const paymentReportsPublic = new Hono();

paymentReportsPublic.get('/membership-invite/:token', async (c) => {
  const token = c.req.param('token');
  const row = /^[A-Za-z0-9_-]{20,80}$/.test(token)
    ? await one(c.env, `SELECT i.*, m.title FROM membership_invite_links i JOIN memberships m ON m.id = i.membership_id WHERE i.token_hash = $1`, [await sha256Hex(token)])
    : null;
  const open = row && !row.revoked_at && !row.used_at && new Date(row.expires_at) > new Date();
  const title = row ? esc(row.title) : '';
  const deep = `biblenestra://membership-invite?token=${encodeURIComponent(token)}`;
  const msg = !row ? 'This invitation link is not valid.' : open ? `You have been invited to join ${title} on BibleNestra.` : 'This invitation link has expired or was already used. Ask the team for a new one.';
  return c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Membership invitation · BibleNestra</title>
<style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#FBF8F3;color:#2B2620}
.w{max-width:420px;margin:0 auto;padding:64px 20px;text-align:center}h1{font-size:22px;margin:0 0 10px}p{color:#6B6255;line-height:1.5}
a.btn{display:inline-block;margin-top:18px;background:#B5643C;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600}</style></head>
<body><div class="w"><h1>${open ? 'Your invitation' : 'Invitation'}</h1><p>${esc(msg)}</p>${open ? `<a class="btn" href="${esc(deep)}">Open in BibleNestra</a>` : ''}</div></body></html>`);
});

// ─── signed in: report a payment ─────────────────────────────────────────────────────────────────────────────────────
export const paymentReportsApp = new Hono();

paymentReportsApp.post('/payments/report/receipt', async (c) => {
  const me = c.get('user');
  if (!c.env.MEDIA) throw new ApiError(503, 'STORAGE_NOT_CONFIGURED', 'Uploads are not set up yet.');
  const type = (c.req.header('Content-Type') || '').split(';')[0].trim().toLowerCase();
  const ext = RECEIPT_TYPES[type];
  if (!ext) throw bad('Upload a JPEG, PNG, WebP or HEIC screenshot of your receipt', 'BAD_IMAGE_TYPE');
  if (Number(c.req.header('Content-Length') || 0) > MAX_RECEIPT) throw new ApiError(413, 'TOO_LARGE', 'Receipt screenshots must be under 8 MB');
  const buf = await c.req.arrayBuffer();
  if (!buf.byteLength) throw bad('Empty upload');
  if (buf.byteLength > MAX_RECEIPT) throw new ApiError(413, 'TOO_LARGE', 'Receipt screenshots must be under 8 MB');
  const key = receiptKeyFor(me.id, ext);
  // Private: no public cache header; the media route does not serve rcpt/ keys.
  await c.env.MEDIA.put(key, buf, { httpMetadata: { contentType: type } });
  return c.json({ key }, 201);
});

paymentReportsApp.get('/payments/report-options', async (c) => c.json({ items: await reportOptions(c.env, c.get('user')) }));

paymentReportsApp.post('/payments/reports', async (c) => {
  const report = await createPaymentReport(c.env, c.get('user'), await body(c));
  return c.json({ report }, 201);
});

paymentReportsApp.get('/payments/reports', async (c) => c.json({ items: await myReports(c.env, c.get('user')) }));

// ─── signed in: membership invitation links ──────────────────────────────────────────────────────────────────────────
paymentReportsApp.get('/membership-invites/:token/preview', async (c) => c.json(await previewInvite(c.env, c.get('user'), c.req.param('token'))));
paymentReportsApp.post('/membership-invites/:token/accept', async (c) => c.json(await acceptInvite(c.env, c.get('user'), c.req.param('token'))));

// ─── admin ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export const adminPaymentReports = new Hono();
adminPaymentReports.use('/admin/api/payment-reports', requireAdmin);
adminPaymentReports.use('/admin/api/payment-reports/*', requireAdmin);
adminPaymentReports.use('/admin/api/membership-grants', requireAdmin);
adminPaymentReports.use('/admin/api/membership-invites', requireAdmin);
adminPaymentReports.use('/admin/api/membership-invites/*', requireAdmin);

adminPaymentReports.get('/admin/api/payment-reports', async (c) => {
  const s = String(c.req.query('status') || 'pending');
  const status = s === 'all' ? null : ['pending', 'approved', 'rejected'].includes(s) ? s : 'pending';
  return c.json({ items: await listPaymentReports(c.env, { status, limit: Number(c.req.query('limit')) || 50 }) });
});

// The dashboard reads it as JSON (?format=json → data URL): an <img> tag can't send the admin token.
adminPaymentReports.get('/admin/api/payment-reports/:id/receipt', async (c) => {
  const r = await loadReport(c.env, c.req.param('id'));
  if (!c.env.MEDIA) throw notFound('Receipt not found');
  const obj = await c.env.MEDIA.get(r.receipt_key);
  if (!obj) throw notFound('Receipt not found');
  const type = obj.httpMetadata?.contentType || 'image/jpeg';
  if (c.req.query('format') === 'json') {
    const bytes = new Uint8Array(await new Response(obj.body).arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return c.json({ contentType: type, dataUrl: `data:${type};base64,${btoa(bin)}` });
  }
  return new Response(obj.body, { headers: { 'Content-Type': type, 'Cache-Control': 'private, no-store' } });
});

adminPaymentReports.post('/admin/api/payment-reports/:id/check', async (c) => c.json(await checkPaymentReport(c.env, c.req.param('id'))));

adminPaymentReports.post('/admin/api/payment-reports/:id/approve', async (c) => {
  const b = await body(c);
  const mode = b.mode === 'manual' ? 'manual' : 'paystack';
  return c.json(await approvePaymentReport(c.env, c.get('user'), c.req.param('id'), { mode, reason: b.reason, expiresAt: b.expiresAt || null }));
});

adminPaymentReports.post('/admin/api/payment-reports/:id/reject', async (c) => {
  const b = await body(c);
  return c.json({ report: await rejectPaymentReport(c.env, c.get('user'), c.req.param('id'), b.reason) });
});

adminPaymentReports.post('/admin/api/membership-grants', async (c) => c.json(await manualMembershipGrant(c.env, c.get('user'), await body(c))));

adminPaymentReports.get('/admin/api/membership-invites', async (c) => c.json({ items: await listMembershipInvites(c.env, c.req.query('membershipId') || null) }));

adminPaymentReports.post('/admin/api/membership-invites', async (c) => c.json(await createMembershipInvite(c.env, c.get('user'), await body(c), origin(c)), 201));

adminPaymentReports.post('/admin/api/membership-invites/:id/revoke', async (c) => c.json({ invite: await revokeMembershipInvite(c.env, c.get('user'), c.req.param('id')) }));
