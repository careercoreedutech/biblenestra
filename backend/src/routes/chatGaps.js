// CHAT GAPS — group invite links that open the app from outside, and group bans.
//   public:  GET /g/:code              landing page for a group invite: "Open in BibleNestra" (biblenestra://join/<code>)
//                                      + Google Play fallback. GET /join/:code (links shared before) shows the same page.
//   app:     GET    /conversations/:id/bans           banned people (admins)
//            DELETE /conversations/:id/bans/:userId   unban (admins) — they may use the invite link again
// Removing with a ban is DELETE /conversations/:id/members/:userId?ban=1 (routes/chatGroups.js), which also
// enforces the ban on POST /invites/:code/join and join-request approval.
import { Hono } from 'hono';
import { uuidParam, notFound, forbidden } from '../lib/http.js';
import { q, one } from '../lib/db.js';
import { userJson, mediaUrl } from '../lib/shape.js';
import { groupContext, permissionsFor } from '../lib/chatGroups.js';

const parse = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const CODE_RE = /^[A-Za-z0-9]{6,32}$/;
const PACKAGE = 'com.biblenestra.app';
const playUrl = (env) => (env && env.PLAY_STORE_URL) || `https://play.google.com/store/apps/details?id=${PACKAGE}`;
const apiOrigin = (c) => (c.env.PUBLIC_API_URL || new URL(c.req.url).origin).replace(/\/$/, '');

/** The shareable https link for a group invite code (served by this Worker). */
export const groupInviteUrl = (c, code) => `${apiOrigin(c)}/g/${code}`;

// ---------- public landing page ----------
export const chatGapsPublic = new Hono();

async function landing(c) {
  const code = String(c.req.param('code') || '');
  const inv = CODE_RE.test(code) ? await one(c.env, `SELECT c.title, c.description, c.avatar_key,
      (SELECT COUNT(*)::int FROM conversation_members m WHERE m.conversation_id = c.id) AS members
    FROM conversation_invites i JOIN conversations c ON c.id = i.conversation_id
    WHERE i.code = $1 AND i.revoked_at IS NULL AND c.kind = 'group'`, [code]) : null;
  const deep = `biblenestra://join/${code}`;
  const play = playUrl(c.env);
  // Android Chrome: an intent:// link opens the app when installed and otherwise falls through to the Play Store
  const intent = `intent://join/${code}#Intent;scheme=biblenestra;package=${PACKAGE};S.browser_fallback_url=${encodeURIComponent(play)};end`;
  const title = inv ? inv.title || 'A BibleNestra group' : 'Invite link not found';
  const avatar = inv && inv.avatar_key ? mediaUrl(c.env, new URL(c.req.url).origin, inv.avatar_key) : null;
  c.header('Cache-Control', 'no-store');
  c.header('X-Robots-Tag', 'noindex');
  c.header('Referrer-Policy', 'no-referrer');
  return c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(inv ? `Join ${title} on BibleNestra` : 'BibleNestra')}</title>
<meta property="og:title" content="${esc(inv ? `Join “${title}” on BibleNestra` : 'BibleNestra')}">
<meta property="og:description" content="${esc(inv ? `${inv.members} member${inv.members === 1 ? '' : 's'} · tap to open the group invite in BibleNestra.` : 'This invite link was reset or doesn’t exist.')}">
<style>
:root{--bg:#F6F4EF;--card:#fff;--fg:#1E2235;--muted:#6B6F82;--primary:#3B4BA8;--gold:#B8862F}
@media (prefers-color-scheme:dark){:root{--bg:#12131C;--card:#1C1E2B;--fg:#F1F0EC;--muted:#A3A6B6;--primary:#8C9BFF;--gold:#E2BC6A}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center}
.card{background:var(--card);max-width:420px;width:calc(100% - 32px);margin:16px;padding:28px 22px;border-radius:24px;box-shadow:0 10px 30px rgba(0,0,0,.08);text-align:center;box-sizing:border-box}
.av{width:84px;height:84px;border-radius:42px;object-fit:cover;background:var(--bg);display:block;margin:6px auto 4px}
h1{font-family:Georgia,serif;font-size:26px;line-height:1.2;margin:8px 0;overflow-wrap:anywhere}
p{color:var(--muted);margin:8px 0 18px;overflow-wrap:anywhere}
a.btn{display:block;padding:14px;border-radius:999px;background:var(--primary);color:#fff;text-decoration:none;font-weight:700;margin-top:10px}
a.ghost{background:transparent;color:var(--primary);border:1.5px solid var(--primary)}
small{display:block;color:var(--muted);margin-top:14px}
code{font-weight:700;letter-spacing:1px;color:var(--gold)}
</style></head><body><div class="card">
<div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:var(--gold);font-weight:700">BibleNestra group invite</div>
${avatar ? `<img class="av" src="${esc(avatar)}" alt="">` : ''}
<h1>${esc(title)}</h1>
${inv ? `<p>${inv.members} member${inv.members === 1 ? '' : 's'}${inv.description ? ` · ${esc(String(inv.description).slice(0, 200))}` : ''}</p>
<a class="btn" id="open" href="${esc(deep)}">Open in BibleNestra</a>
<a class="btn ghost" href="${esc(play)}">Get BibleNestra on Google Play</a>
<small>Already have the app? You can also open Chats › Join with a link and enter the code <code>${esc(code)}</code>.</small>`
    : '<p>This invite link was reset or doesn’t exist. Ask the group admin for a new link.</p>'}
</div>
${inv ? `<script>if (/Android/i.test(navigator.userAgent)) document.getElementById('open').href = ${JSON.stringify(intent).replace(/</g, '\\u003c')};</script>` : ''}
</body></html>`, inv ? 200 : 404);
}
chatGapsPublic.get('/g/:code', landing);
chatGapsPublic.get('/join/:code', landing); // invite links shared before /g/ existed

// ---------- bans (signed in) ----------
export const chatGaps = new Hono();

async function adminCtx(c) {
  const me = c.get('user');
  const convId = uuidParam(c, 'id');
  const ctx = await groupContext(c.env, convId, me.id);
  if (!permissionsFor(ctx).canRemoveMembers) throw forbidden('Only group admins can manage bans', 'ADMIN_ONLY');
  return { me, convId };
}

chatGaps.get('/conversations/:id/bans', async (c) => {
  const { convId } = await adminCtx(c);
  const rows = await q(c.env, `SELECT b.created_at, bb.display_name AS banned_by_name, b.banned_by, ${userJson('u')} AS u
      FROM conversation_bans b JOIN users u ON u.id = b.user_id LEFT JOIN users bb ON bb.id = b.banned_by
      WHERE b.conversation_id = $1 ORDER BY b.created_at DESC LIMIT 500`, [convId]);
  return c.json({
    items: rows.map((r) => ({
      ...parse(r.u),
      bannedAt: new Date(r.created_at).toISOString(),
      bannedBy: r.banned_by ? { id: r.banned_by, displayName: r.banned_by_name } : null,
    })),
  });
});

chatGaps.delete('/conversations/:id/bans/:userId', async (c) => {
  const { convId } = await adminCtx(c);
  const r = await one(c.env, 'DELETE FROM conversation_bans WHERE conversation_id = $1 AND user_id = $2 RETURNING user_id', [convId, uuidParam(c, 'userId')]);
  if (!r) throw notFound('Not banned');
  return c.json({ ok: true });
});
