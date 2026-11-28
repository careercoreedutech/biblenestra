// CHAT LIMITS + REFERRALS + PAYWALL GUARD (client #27, brief 7.5 / 10.3). Rules live in lib/chatLimits.js.
//   public:  GET  /i/:code                 invite landing page (opens biblenestra://invite/<code>, else the store)
//            GET  /invite/:code            { inviter } preview for the app's "you were invited by…" card
//   app:     GET  /me/invite               my code + link + who joined via me + who invited me
//            POST /me/referral { code }    attach "invited by" once (permanent), within REFERRAL_CLAIM_DAYS of sign-up
//            GET  /chat/allowance[?userId] counter for the new-chat flow (+ whether messaging userId uses a slot)
//            GET  /paywall/eligibility?placement=…   may the subscription prompt be shown now?
//            POST /paywall/impression { placement }  record a showing (capped per local day; idempotent-ish via cap)
//            POST /chat/pass { idempotencyKey }      CHAT WEEK PASS: spend coins on 7 days of extra new chats
//   admin:   PUT  /admin/api/users/:id/premium { premium, until? }  set subscriber status (no billing yet)
//            GET  /admin/api/chat-passes             CHAT WEEK PASS: purchase log ("Chat passes" admin tab)
import { Hono } from 'hono';
import { ApiError, body, bad, notFound, forbidden, str, uuidParam, today, isUuid } from '../lib/http.js';
import { one, q } from '../lib/db.js';
import { userJson } from '../lib/shape.js';
import { notifyUser } from '../hub.js';
import {
  chatAllowance, slotNeed, ensureInviteCode, normalizeCode, referralClaimDays,
  isSubscriber, isAdmin, paywallMaxPerDay, REQUESTED_PLACEMENTS,
  buyWeekPass, weekPassOffer,
} from '../lib/chatLimits.js';
import { requireAdmin, registerAdminScript } from './admin.js';
import { attributePartner } from '../lib/portfolio.js'; // PORTFOLIO & PARTNER MANAGERS: partner attribution (first touch)
import { CHAT_PASS_ADMIN_SCRIPT } from '../lib/chatPassAdminPage.js';

registerAdminScript(CHAT_PASS_ADMIN_SCRIPT); // CHAT WEEK PASS: "Chat passes" admin tab

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const PLAY_URL = (env, code) => `${(env && env.PLAY_STORE_URL) || 'https://play.google.com/store/apps/details?id=com.biblenestra.app'}&referrer=${encodeURIComponent(`invite=${code}`)}`;
const inviteLink = (c, code) => `${(c.env.PUBLIC_API_URL || new URL(c.req.url).origin).replace(/\/$/, '')}/i/${code}`;

// ---------- public ----------
export const referralsPublic = new Hono();

referralsPublic.get('/invite/:code', async (c) => {
  const code = normalizeCode(c.req.param('code'));
  const u = code ? await one(c.env, `SELECT ${userJson('u')} AS u FROM users u WHERE u.invite_code = $1 AND NOT u.banned`, [code]) : null;
  if (!u) throw notFound('That invite code was not found');
  return c.json({ code, inviter: u.u });
});

referralsPublic.get('/i/:code', async (c) => {
  const code = normalizeCode(c.req.param('code'));
  const u = code ? await one(c.env, 'SELECT display_name FROM users WHERE invite_code = $1 AND NOT banned', [code]) : null;
  const name = u ? u.display_name : null;
  const deep = `biblenestra://invite/${code}`;
  const play = PLAY_URL(c.env, code);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Join me on BibleNestra</title>
<meta property="og:title" content="${esc(name ? `${name} invited you to BibleNestra` : 'Join BibleNestra')}">
<meta property="og:description" content="Read the Bible, pray together and chat with believers. Friends you invite can always chat with you for free.">
<style>
:root{--bg:#F6F4EF;--card:#fff;--fg:#1E2235;--muted:#6B6F82;--primary:#3B4BA8;--gold:#B8862F}
@media (prefers-color-scheme:dark){:root{--bg:#12131C;--card:#1C1E2B;--fg:#F1F0EC;--muted:#A3A6B6;--primary:#8C9BFF;--gold:#E2BC6A}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center}
.card{background:var(--card);max-width:420px;margin:16px;padding:28px 22px;border-radius:24px;box-shadow:0 10px 30px rgba(0,0,0,.08);text-align:center}
h1{font-family:Georgia,serif;font-size:26px;line-height:1.2;margin:8px 0}
p{color:var(--muted);margin:8px 0 18px}
.code{display:inline-block;letter-spacing:3px;font-weight:700;font-size:22px;padding:8px 16px;border-radius:12px;border:1.5px dashed var(--gold);color:var(--gold);margin-bottom:18px}
a.btn{display:block;padding:14px;border-radius:999px;background:var(--primary);color:#fff;text-decoration:none;font-weight:700;margin-top:10px}
a.ghost{background:transparent;color:var(--primary);border:1.5px solid var(--primary)}
small{display:block;color:var(--muted);margin-top:14px}
</style></head><body><div class="card">
<div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:var(--gold);font-weight:700">BibleNestra</div>
<h1>${esc(name ? `${name} invited you` : 'You are invited')}</h1>
<p>Read the Bible, pray together and chat with believers. Friends who invite each other can always chat for free.</p>
${code ? `<div class="code">${esc(code)}</div>` : ''}
<a class="btn" href="${esc(deep)}">Open in the app</a>
<a class="btn ghost" href="${esc(play)}">Get BibleNestra on Google Play</a>
<small>New here? After installing, enter the code <b>${esc(code)}</b> under Chats › Invite friends › “Have an invite code?” within ${referralClaimDays(c.env)} days of signing up.</small>
</div></body></html>`;
  return c.html(html);
});

// ---------- signed in ----------
export const referrals = new Hono();

referrals.get('/me/invite', async (c) => {
  const me = c.get('user');
  const code = await ensureInviteCode(c.env, me.id);
  const [joined, inviter, fresh] = await Promise.all([
    q(c.env, `SELECT ${userJson('u')} AS u, u.referred_at FROM users u WHERE u.referred_by = $1 AND NOT u.banned ORDER BY u.referred_at DESC NULLS LAST LIMIT 200`, [me.id]),
    one(c.env, `SELECT ${userJson('i')} AS u FROM users me JOIN users i ON i.id = me.referred_by WHERE me.id = $1`, [me.id]),
    one(c.env, 'SELECT created_at, referred_by FROM users WHERE id = $1', [me.id]),
  ]);
  const days = referralClaimDays(c.env);
  const canRedeem = !fresh.referred_by && Date.now() - new Date(fresh.created_at).getTime() <= days * 86400e3;
  return c.json({
    code,
    link: inviteLink(c, code),
    deepLink: `biblenestra://invite/${code}`,
    joined: joined.map((r) => ({ ...r.u, joinedAt: r.referred_at ? new Date(r.referred_at).toISOString() : null })),
    invitedBy: inviter ? inviter.u : null,
    canRedeem,
    claimDays: days,
  });
});

referrals.post('/me/referral', async (c) => {
  const me = c.get('user');
  const code = normalizeCode((await body(c)).code);
  if (!code) throw bad('Enter an invite code', 'INVALID_CODE');
  const inviter = await one(c.env, 'SELECT id, display_name, referred_by FROM users WHERE invite_code = $1 AND NOT banned', [code]);
  if (!inviter) throw notFound('That invite code was not found');
  if (inviter.id === me.id) throw bad("That's your own invite code", 'SELF_REFERRAL');
  const cur = await one(c.env, 'SELECT referred_by, created_at FROM users WHERE id = $1', [me.id]);
  if (cur.referred_by) {
    if (cur.referred_by === inviter.id) return c.json({ ok: true, already: true, invitedBy: inviter.id });
    throw new ApiError(409, 'ALREADY_REFERRED', 'You already joined with an invite');
  }
  if (inviter.referred_by === me.id) throw bad('You invited this person — you are already invited contacts', 'ALREADY_CONTACTS');
  const days = referralClaimDays(c.env);
  if (Date.now() - new Date(cur.created_at).getTime() > days * 86400e3) {
    throw bad(`Invite codes can be entered within ${days} days of signing up`, 'REFERRAL_WINDOW_CLOSED');
  }
  // permanent: only ever set once (WHERE referred_by IS NULL)
  const set = await q(c.env, 'UPDATE users SET referred_by = $2, referred_at = now() WHERE id = $1 AND referred_by IS NULL RETURNING 1', [me.id, inviter.id]);
  if (!set.length) throw new ApiError(409, 'ALREADY_REFERRED', 'You already joined with an invite');
  await attributePartner(c.env, me.id, inviter.id).catch(() => {}); // PORTFOLIO: a Partner Manager's code attributes this user to them, permanently (first touch)
  await q(c.env, `INSERT INTO notifications (user_id, kind, title, body, data) VALUES ($1, 'follow', $2, $3, $4::jsonb)`,
    [inviter.id, `${me.display_name} joined with your invite 🎉`, 'Invited friends can always chat with you — no limits.', JSON.stringify({ type: 'referral', fromId: me.id })]).catch(() => {});
  await notifyUser(c.env, inviter.id, { type: 'referral.joined', from: { id: me.id, displayName: me.display_name } }).catch(() => {});
  return c.json({ ok: true, invitedBy: inviter.id, inviterName: inviter.display_name }, 201);
});

referrals.get('/chat/allowance', async (c) => {
  const me = c.get('user');
  const out = await chatAllowance(c.env, me);
  const other = c.req.query('userId');
  if (other && isUuid(other) && other !== me.id) {
    const conv = await one(c.env, `SELECT c.id FROM conversations c
       JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = $1
       JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = $2
       WHERE c.kind = 'dm' LIMIT 1`, [me.id, other]);
    const need = await slotNeed(c.env, me, other, conv && conv.id);
    out.forUser = { userId: other, needsSlot: need.needsSlot, reason: need.reason, blocked: need.needsSlot && !out.unlimited && out.remaining <= 0 };
  }
  return c.json(out);
});

const placementOf = (v) => {
  const p = str(v || 'app_open', { max: 40, field: 'placement' }) || 'app_open';
  if (!/^[a-z0-9_]{1,40}$/.test(p)) throw bad('Unknown placement', 'BAD_PLACEMENT');
  return p;
};

async function paywallState(env, user, placement) {
  const day = today(user.tz_offset);
  const max = paywallMaxPerDay(env);
  const r = await one(env, 'SELECT count(*)::int AS n FROM paywall_impressions WHERE user_id = $1 AND day = $2', [user.id, day]);
  const shownToday = r ? r.n : 0;
  const lastShownAt = user.paywall_last_shown_at ? new Date(user.paywall_last_shown_at).toISOString() : null;
  if (isAdmin(user)) return { show: false, reason: 'admin', shownToday, max, lastShownAt, day }; // admins: no chat limits, no paywall
  if (isSubscriber(user)) return { show: false, reason: 'subscriber', shownToday, max, lastShownAt, day };
  if (REQUESTED_PLACEMENTS.has(placement)) return { show: true, reason: 'requested', shownToday, max, lastShownAt, day };
  if (shownToday >= max) return { show: false, reason: 'cap', shownToday, max, lastShownAt, day };
  return { show: true, reason: 'ok', shownToday, max, lastShownAt, day };
}

referrals.get('/paywall/eligibility', async (c) => {
  const me = c.get('user');
  const s = await paywallState(c.env, me, placementOf(c.req.query('placement')));
  delete s.day;
  return c.json(s);
});

referrals.post('/paywall/impression', async (c) => {
  const me = c.get('user');
  const placement = placementOf((await body(c)).placement);
  const s = await paywallState(c.env, me, placement);
  if (!s.show) { delete s.day; return c.json({ recorded: false, ...s }); }
  const cap = REQUESTED_PLACEMENTS.has(placement) ? 1000 : s.max;
  // count check + insert in one statement, so two racing app-open prompts can't both pass the cap
  const ins = await q(c.env, `INSERT INTO paywall_impressions (user_id, day, placement)
      SELECT $1, $2, $3 WHERE (SELECT count(*) FROM paywall_impressions WHERE user_id = $1 AND day = $2) < $4 RETURNING shown_at`,
  [me.id, s.day, placement, cap]);
  if (!ins.length) return c.json({ recorded: false, show: false, reason: 'cap', shownToday: s.shownToday, max: s.max, lastShownAt: s.lastShownAt });
  await q(c.env, 'UPDATE users SET paywall_last_shown_at = $2 WHERE id = $1', [me.id, ins[0].shown_at]);
  return c.json({ recorded: true, show: true, reason: s.reason, shownToday: s.shownToday + 1, max: s.max, lastShownAt: new Date(ins[0].shown_at).toISOString() });
});

// CHAT WEEK PASS: spend coins → 7 days of extra new chats. idempotencyKey (8–100 chars, made once per purchase tap
// by the app) makes retries safe: the same key never charges twice and returns the original purchase.
referrals.post('/chat/pass', async (c) => {
  const me = c.get('user');
  const key = str((await body(c)).idempotencyKey, { min: 8, max: 100, field: 'idempotencyKey' });
  const r = await buyWeekPass(c.env, me, key);
  return c.json({ ...r, passOffer: weekPassOffer(c.env) }, r.replay ? 200 : 201);
});

// ---------- admin ----------
export const adminReferrals = new Hono();

// CHAT WEEK PASS purchase log (read-only, newest first). Price/size are Worker vars, not editable here.
adminReferrals.get('/admin/api/chat-passes', requireAdmin, async (c) => {
  const before = parseInt(c.req.query('before') || '', 10);
  const rows = await q(c.env, `SELECT p.id, p.coins, p.extra_slots, p.expires_at, p.extended, p.created_at,
        u.id AS user_id, u.display_name, u.handle
      FROM chat_passes p JOIN users u ON u.id = p.user_id
      WHERE ($1::bigint IS NULL OR p.id < $1) ORDER BY p.id DESC LIMIT 50`, [Number.isInteger(before) ? before : null]);
  const t = await one(c.env, `SELECT count(*)::int AS n, COALESCE(sum(coins), 0)::int AS coins,
        count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS n7,
        (SELECT count(*)::int FROM users WHERE chat_pass_until > now()) AS active
      FROM chat_passes`);
  return c.json({
    offer: weekPassOffer(c.env),
    totals: { purchases: t.n, coinsSpent: t.coins, purchases7d: t.n7, activePasses: t.active },
    items: rows.map((r) => ({
      id: String(r.id), coins: r.coins, extraSlots: r.extra_slots === -1 ? null : r.extra_slots, extended: r.extended,
      expiresAt: new Date(r.expires_at).toISOString(), createdAt: new Date(r.created_at).toISOString(),
      user: { id: r.user_id, displayName: r.display_name, handle: r.handle },
    })),
  });
});

adminReferrals.put('/admin/api/users/:id/premium', async (c) => {
  if (c.get('user').role !== 'admin') throw forbidden('Admins only', 'ADMIN_ONLY');
  const id = uuidParam(c);
  const b = await body(c);
  const premium = b.premium === true;
  let until = null;
  if (premium && b.until) {
    const d = new Date(b.until);
    if (Number.isNaN(d.getTime())) throw bad('until must be a date', 'BAD_DATE');
    until = d.toISOString();
  }
  const row = await one(c.env, 'UPDATE users SET premium = $2, premium_until = $3, updated_at = now() WHERE id = $1 RETURNING id, premium, premium_until', [id, premium, until]);
  if (!row) throw notFound('User not found');
  return c.json({ id: row.id, premium: row.premium, premiumUntil: row.premium_until ? new Date(row.premium_until).toISOString() : null });
});
