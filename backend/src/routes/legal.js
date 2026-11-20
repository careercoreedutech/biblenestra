// LEGAL: public pages + account deletion.
//   Public (no sign-in):  GET /terms · GET /privacy · GET /delete-account   (HTML, no scripts; text in lib/legal.js)
//   Signed in:            POST /me/delete-account { confirm: 'DELETE' }  → permanently deletes the caller's account
//   Admin:                GET  /admin/api/account-deletions               → deletion log (no personal data)
//                         POST /admin/api/account-deletions { user: id | '@handle' }  → delete an account (email requests)
//                         POST /admin/api/account-deletions/:id/retry     → retry a failed Clerk login deletion
import { Hono } from 'hono';
import { renderLegalPage } from '../lib/legal.js';
import { deleteAccount, retryLoginDeletion, ACCOUNT_DELETIONS_ADMIN_SCRIPT } from '../lib/accountDeletion.js';
import { body, bad, notFound, str, uuidParam, isUuid } from '../lib/http.js';
import { one, q } from '../lib/db.js';
import { audit, registerAdminScript, requireAdmin } from './admin.js';

registerAdminScript(ACCOUNT_DELETIONS_ADMIN_SCRIPT);

// ---------- public pages ----------
export const legalPublic = new Hono();
const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
for (const slug of ['terms', 'privacy', 'delete-account']) {
  const handler = (c) => {
    c.header('Content-Security-Policy', CSP);
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Cache-Control', 'public, max-age=300');
    return c.html(renderLegalPage(slug, c.env));
  };
  legalPublic.get(`/${slug}`, handler);
  legalPublic.get(`/${slug}/`, handler);
}

// ---------- signed in: delete my account ----------
export const accountDeletion = new Hono();
accountDeletion.post('/me/delete-account', async (c) => {
  const b = await body(c);
  if (String(b.confirm || '').trim().toUpperCase() !== 'DELETE') throw bad('Type DELETE to confirm', 'CONFIRM_REQUIRED');
  const out = await deleteAccount(c.env, c.get('user'), { source: 'app' });
  return c.json({ deleted: true, status: out.status });
});

// ---------- admin ----------
export const adminAccountDeletions = new Hono();
const iso = (d) => (d ? new Date(d).toISOString() : null);

adminAccountDeletions.get('/admin/api/account-deletions', requireAdmin, async (c) => {
  const rows = await q(c.env, 'SELECT * FROM account_deletions ORDER BY requested_at DESC LIMIT 200');
  return c.json({ items: rows.map((r) => ({
    id: r.id, source: r.source, status: r.status, filesDeleted: r.files_deleted, filesFailed: r.files_failed,
    loginDeleted: r.login_deleted, note: r.note, requestedAt: iso(r.requested_at), completedAt: iso(r.completed_at),
  })) });
});

adminAccountDeletions.post('/admin/api/account-deletions', requireAdmin, async (c) => {
  const b = await body(c);
  const who = str(b.user, { min: 1, max: 80, field: 'user' }).trim();
  const target = isUuid(who)
    ? await one(c.env, 'SELECT * FROM users WHERE id = $1', [who])
    : await one(c.env, 'SELECT * FROM users WHERE handle = $1', [who.replace(/^@/, '').toLowerCase()]);
  if (!target) throw notFound('No account with that id or handle');
  const out = await deleteAccount(c.env, target, { source: 'admin' });
  await audit(c.env, c.get('user'), 'account.delete', 'account_deletion', out.id, { status: out.status });
  return c.json({ deleted: true, ...out });
});

adminAccountDeletions.post('/admin/api/account-deletions/:id/retry', requireAdmin, async (c) => {
  const out = await retryLoginDeletion(c.env, uuidParam(c));
  return c.json(out);
});
