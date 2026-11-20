// LEGAL: real account deletion (Google Play / GDPR / NDPA "right to erasure").
//
// deleteAccount(env, user, { source }) does, in this order:
//   1. refuses admin accounts (would orphan the platform library etc.) and owners of fundraisers that have taken
//      real (non-test) money — those go through support so payment/tax records are handled properly;
//   2. collects the R2 files this person uploaded (from the database rows + a prefix listing on real R2);
//   3. DELETE FROM users — every table references users ON DELETE CASCADE (their content, messages, likes, coins,
//      tokens…) or ON DELETE SET NULL (admin/reviewer columns, donations they gave to other people's fundraisers);
//   4. deletes the files from R2 (best effort, counted);
//   5. deletes the sign-in account at Clerk (best effort; if it fails the Clerk id is kept on the log row ONLY until an
//      admin retries — see retryLoginDeletion);
//   6. writes one account_deletions row with no personal data (dates, source, counts).
// The database goes first on purpose: if a later step fails, the person's data is already gone; a surviving Clerk
// login would only ever re-create an empty profile.
import { createClerkClient } from '@clerk/backend';
import { ApiError } from './http.js';
import { one, q } from './db.js';

const OWN_PREFIXES = ['img', 'aud', 'voice', 'vid', 'doc', 'rec', 'lib/audio', 'lib/pdf'];
const MAX_FILES = 5000; // bound the work per request (a Worker request has a time budget)

/** Turns a stored value (R2 key, /media/<key> path or full media URL) into a key this user may delete, or null. */
export function ownedKey(value, userId, { chat = false } = {}) {
  if (typeof value !== 'string' || !value) return null;
  let k = value.trim();
  const m = k.match(/\/(?:media|chat\/media|library\/file)\/(.+)$/);
  if (m) k = m[1];
  else if (/^https?:/i.test(k)) return null; // an external URL (demo content), not our storage
  k = k.replace(/^\/+/, '').split('?')[0];
  try { k = decodeURIComponent(k); } catch (e) { return null; }
  if (k.includes('..')) return null;
  const id = String(userId).toLowerCase();
  for (const p of OWN_PREFIXES) if (k.startsWith(`${p}/${id}/`) && !k.slice(p.length + id.length + 2).includes('/')) return k;
  if (chat && /^chat\/[0-9a-f-]{36}\/[^/]+$/i.test(k)) return k; // chat attachments the person SENT
  return null;
}

async function collectKeys(env, userId) {
  const own = await q(env, `SELECT k FROM (
      SELECT pm.r2_key AS k FROM post_media pm JOIN posts p ON p.id = pm.post_id WHERE p.author_id = $1
      UNION ALL SELECT video_url FROM posts WHERE author_id = $1
      UNION ALL SELECT video_thumb FROM posts WHERE author_id = $1
      UNION ALL SELECT video_key FROM video_uploads WHERE user_id = $1
      UNION ALL SELECT thumb_key FROM video_uploads WHERE user_id = $1
      UNION ALL SELECT r2_key FROM recordings WHERE user_id = $1
      UNION ALL SELECT file_key FROM media_items WHERE owner_id = $1
      UNION ALL SELECT cover_key FROM media_items WHERE owner_id = $1
      UNION ALL SELECT fm.r2_key FROM fundraiser_media fm JOIN fundraisers f ON f.id = fm.fundraiser_id WHERE f.owner_id = $1
      UNION ALL SELECT main_image_key FROM fundraisers WHERE owner_id = $1
      UNION ALL SELECT avatar_url FROM users WHERE id = $1
      UNION ALL SELECT banner_url FROM users WHERE id = $1
    ) x WHERE k IS NOT NULL`, [userId]);
  const sent = await q(env, 'SELECT media_key AS k FROM messages WHERE sender_id = $1 AND media_key IS NOT NULL', [userId]);
  const keys = new Set();
  for (const r of own) { const k = ownedKey(r.k, userId); if (k) keys.add(k); }
  for (const r of sent) { const k = ownedKey(r.k, userId, { chat: true }); if (k) keys.add(k); }
  // Real R2 can list by prefix: also catches files never linked to a row (fundraiser story images, old avatars…).
  const bucket = env.MEDIA;
  if (bucket && typeof bucket.list === 'function') {
    for (const p of OWN_PREFIXES) {
      let cursor;
      do {
        const page = await bucket.list({ prefix: `${p}/${userId}/`, cursor, limit: 1000 });
        for (const o of page.objects || []) keys.add(o.key);
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor && keys.size < MAX_FILES);
      if (keys.size >= MAX_FILES) break;
    }
  }
  return [...keys].slice(0, MAX_FILES);
}

async function deleteFiles(env, keys) {
  const bucket = env.MEDIA;
  if (!bucket || typeof bucket.delete !== 'function' || !keys.length) return { deleted: 0, failed: 0 };
  let deleted = 0; let failed = 0;
  const bulk = typeof bucket.list === 'function'; // real R2: delete() takes up to 1000 keys at once
  if (bulk) {
    for (let i = 0; i < keys.length; i += 1000) {
      const chunk = keys.slice(i, i + 1000);
      try { await bucket.delete(chunk); deleted += chunk.length; } catch (e) { failed += chunk.length; }
    }
  } else {
    for (const k of keys) {
      try { await bucket.delete(k); deleted++; } catch (e) { failed++; }
    }
  }
  return { deleted, failed };
}

/** Deletes the Clerk user. Returns true when done or not applicable (dev users), false on failure. */
async function deleteLogin(env, clerkId) {
  if (!clerkId || clerkId.startsWith('dev_') || clerkId === 'admin') return true;
  try {
    if (typeof env.__deleteClerkUser === 'function') { await env.__deleteClerkUser(clerkId); return true; } // tests
    if (!env.CLERK_SECRET_KEY) return false;
    const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
    await clerk.users.deleteUser(clerkId);
    return true;
  } catch (e) {
    // already gone at Clerk counts as done
    if (e && (e.status === 404 || (Array.isArray(e.errors) && e.errors.some((x) => x && x.code === 'resource_not_found')))) return true;
    console.error('[account deletion] Clerk delete failed', e && e.message);
    return false;
  }
}

export async function deleteAccount(env, user, { source = 'app' } = {}) {
  if (!user || !user.id) throw new ApiError(404, 'NOT_FOUND', 'Account not found');
  if (user.role === 'admin' || user.clerk_id === 'admin') {
    throw new ApiError(409, 'ADMIN_ACCOUNT', 'Admin accounts can’t be deleted here. Remove the admin role first, then delete the account.');
  }
  const paid = await one(env, `SELECT 1 FROM donations d JOIN fundraisers f ON f.id = d.fundraiser_id
      WHERE f.owner_id = $1 AND d.status = 'succeeded' AND d.provider <> 'test' LIMIT 1`, [user.id]);
  if (paid) {
    throw new ApiError(409, 'FUNDRAISER_HAS_DONATIONS', 'One of your fundraisers has received donations, so we need to close it with you first. Please contact support to delete your account.');
  }

  const keys = await collectKeys(env, user.id);
  // Donations this person gave to OTHER people's fundraisers stay (the owner's totals and records), but without
  // their name or message. (donor_id itself is set to NULL by the foreign key.)
  await q(env, `UPDATE donations SET donor_name = NULL, message = NULL, anonymous = true WHERE donor_id = $1`, [user.id]);
  await q(env, 'DELETE FROM users WHERE id = $1', [user.id]);
  const files = await deleteFiles(env, keys);
  const loginDeleted = await deleteLogin(env, user.clerk_id);
  const status = loginDeleted && !files.failed ? 'done' : 'partial';
  const note = [
    files.failed ? `${files.failed} file(s) could not be deleted from storage` : '',
    loginDeleted ? '' : 'sign-in account could not be deleted at Clerk — retry from the dashboard',
  ].filter(Boolean).join('; ') || null;
  const row = await one(env, `INSERT INTO account_deletions (source, status, files_deleted, files_failed, login_deleted, pending_login_id, note, completed_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, now()) RETURNING id`,
  [source, status, files.deleted, files.failed, loginDeleted, loginDeleted ? null : user.clerk_id, note]);
  return { id: row.id, status, filesDeleted: files.deleted, filesFailed: files.failed, loginDeleted };
}

/** Admin: retry deleting a Clerk login that failed earlier; clears the stored id once it succeeds. */
export async function retryLoginDeletion(env, logId) {
  const row = await one(env, 'SELECT * FROM account_deletions WHERE id = $1', [logId]);
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Deletion record not found');
  if (!row.pending_login_id) return { ok: true, already: true };
  const ok = await deleteLogin(env, row.pending_login_id);
  if (!ok) throw new ApiError(502, 'CLERK_FAILED', 'Clerk could not delete the login yet. Check CLERK_SECRET_KEY and try again.');
  await q(env, `UPDATE account_deletions SET login_deleted = true, pending_login_id = NULL,
      status = CASE WHEN files_failed = 0 THEN 'done' ELSE status END, note = NULLIF(regexp_replace(COALESCE(note, ''), ';? ?sign-in account could not be deleted at Clerk — retry from the dashboard', ''), '') WHERE id = $1`, [logId]);
  return { ok: true };
}

export const ACCOUNT_DELETIONS_ADMIN_SCRIPT = `
(function(){
if (!window.registerAdminTab) return;
function when(s){ if (!s) return '—'; return new Date(s).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
window.registerAdminTab('Deletions', function(box, ctx){
  var h = ctx.h, api = ctx.api, toast = ctx.toast;
  box.appendChild(h('h2', { class: 'serif', text: 'Account deletions' }));
  box.appendChild(h('p', { class: 'sub', text: 'People delete their own account in the app (Profile → Account → Delete my account). For requests that arrive by email, check the request really comes from the account’s sign-in email, then delete it here by user id or @handle. Records hold no personal details.' }));
  var row = h('div', { class: 'row', style: 'margin-bottom:12px' });
  var input = h('input', { placeholder: 'User id or @handle', style: 'flex:1;min-width:200px' });
  var go = h('button', { class: 'btn small', text: 'Delete account…' });
  row.appendChild(input); row.appendChild(go); box.appendChild(row);
  var list = h('div'); box.appendChild(list);
  go.onclick = async function(){
    var who = (input.value || '').trim(); if (!who) return;
    if (!window.confirm('Permanently delete ' + who + ' and all of their content? This cannot be undone.')) return;
    try { await api('POST', '/admin/api/account-deletions', { user: who }); toast('Account deleted'); input.value = ''; load(); }
    catch (e) { toast(e.message, true); }
  };
  async function load(){
    list.innerHTML = '';
    var d; try { d = await api('GET', '/admin/api/account-deletions'); } catch (e) { list.appendChild(h('div', { class: 'card empty', text: e.message })); return; }
    if (!d.items.length) { list.appendChild(h('div', { class: 'card empty', text: 'No deletions yet.' })); return; }
    d.items.forEach(function(it){
      var card = h('div', { class: 'card', style: 'margin-bottom:8px' });
      card.appendChild(h('div', { text: when(it.completedAt || it.requestedAt) + ' · ' + (it.source === 'admin' ? 'by an admin' : 'in the app') + ' · ' + (it.status === 'done' ? 'Done' : 'Needs attention') }));
      card.appendChild(h('div', { class: 'sub', text: it.filesDeleted + ' file(s) deleted' + (it.filesFailed ? ', ' + it.filesFailed + ' failed' : '') + ' · login ' + (it.loginDeleted ? 'deleted' : 'NOT deleted') + (it.note ? ' · ' + it.note : '') }));
      if (!it.loginDeleted) {
        var b = h('button', { class: 'btn small ghost', text: 'Retry login deletion' });
        b.onclick = async function(){ try { await api('POST', '/admin/api/account-deletions/' + it.id + '/retry', {}); toast('Done'); load(); } catch (e) { toast(e.message, true); } };
        card.appendChild(b);
      }
      list.appendChild(card);
    });
  }
  load();
});
})();
`;
