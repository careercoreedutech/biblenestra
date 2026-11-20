// BROADCASTS (brief 11.1 + 7.6): admin messages to every user's inbox, or a post on Socials from the official
// verified account.
//
//   * ONE broadcasts row per send. Inbox fan-out writes broadcast_deliveries (the per-user join, PK (broadcast, user))
//     and the inbox notifications in one INSERT … SELECT per batch of users (keyset by user id). ON CONFLICT DO NOTHING
//     on the join means a retried / overlapping batch can never give anyone a second copy. Pushes are claimed per
//     delivery (pushed_at), so they never go out twice either.
//   * Send Now does the first slice inside the request (BROADCAST_INLINE_USERS, default 2000) and hands the rest to
//     waitUntil and the 15-minute cron (runBroadcastCron), which also sends scheduled and daily-repeating broadcasts.
//   * Duplicate prevention: the composer sends an idempotency key. The same key again returns the original broadcast
//     (no second send); the same key with different content is refused; identical content under a NEW key within
//     DUPLICATE_WINDOW_MIN minutes is refused too.
//   * Sender display name is config: BROADCAST_SENDER_NAME (default "BibleNestra"); optional BROADCAST_SENDER_LOGO_URL.
import { one, q } from './db.js';
import { mediaUrl } from './shape.js';

export const DEFAULT_SENDER = 'BibleNestra';
export const OFFICIAL_CLERK_ID = 'system_official_biblenestra';
export const DUPLICATE_WINDOW_MIN = 10;
const MAX_ATTEMPTS = 5;
const LEASE_SECONDS = 120;

const fetcher = (env) => (env && env.__fetch) || fetch;
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : d; };
const batchSize = (env) => num(env && env.BROADCAST_BATCH, 1000);
const inlineUsers = (env) => num(env && env.BROADCAST_INLINE_USERS, 2000);
const cronUsers = (env) => num(env && env.BROADCAST_CRON_USERS, 50000);

export function senderConfig(env) {
  const name = String((env && env.BROADCAST_SENDER_NAME) || '').trim().slice(0, 60) || DEFAULT_SENDER;
  const logo = String((env && env.BROADCAST_SENDER_LOGO_URL) || '').trim();
  return { name, verified: true, logoUrl: /^https:\/\//i.test(logo) ? logo : null };
}

// ---------- time zones (no library: Intl only, works in Workers and Node) ----------
export function validTimeZone(tz) {
  if (!tz || typeof tz !== 'string' || tz.length > 64) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return false; }
}
function partsIn(utcMs, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = {};
  for (const x of dtf.formatToParts(new Date(utcMs))) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}
const offsetMs = (utcMs, tz) => {
  const p = partsIn(utcMs, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(utcMs / 1000) * 1000;
};
/** 'YYYY-MM-DD' + 'HH:MM' wall-clock time in an IANA zone → Date (UTC instant). DST-safe. */
export function zonedToUtc(date, time, tz) {
  const [y, m, d] = String(date).split('-').map(Number);
  const [hh, mm] = String(time).split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off1 = offsetMs(guess, tz);
  let utc = guess - off1;
  const off2 = offsetMs(utc, tz);
  if (off2 !== off1) {
    const alt = guess - off2;
    // in a spring-forward gap (wall time doesn't exist) keep the later instant, e.g. 02:30 → 03:30
    if (offsetMs(alt, tz) === off2) utc = alt;
  }
  return new Date(utc);
}
/** The local calendar date ('YYYY-MM-DD') of an instant in a zone. */
export function localDate(utc, tz) {
  const p = partsIn(new Date(utc).getTime(), tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}
const addDays = (date, n) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
/** Next daily occurrence after `after` (Date) at local time HH:MM in tz, starting from the day of `from`. */
export function nextDaily(from, localTime, tz, after = new Date()) {
  let day = localDate(from, tz);
  let at = zonedToUtc(addDays(day, 1), localTime, tz);
  for (let i = 0; i < 400 && at <= after; i++) { day = addDays(day, 1); at = zonedToUtc(addDays(day, 1), localTime, tz); }
  return at;
}

// ---------- content ----------
export async function contentHash(obj) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(obj)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const decode = (s) => String(s || '')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (m, n) => { try { return String.fromCodePoint(Number(n)); } catch (e) { return m; } })
  .replace(/\s+/g, ' ').trim();

/** Simple link preview from the page's Open Graph / <title> tags. Best effort: never throws, 4 s timeout. */
export async function linkPreview(env, rawUrl) {
  let u;
  try { u = new URL(String(rawUrl || '').trim()); } catch (e) { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const out = { url: u.toString(), host: u.hostname.replace(/^www\./, ''), title: null, description: null, image: null };
  try {
    const res = await Promise.race([
      fetcher(env)(u.toString(), { headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'Mozilla/5.0 (compatible; BibleNestraLinkPreview/1.0)' }, redirect: 'follow' }),
      new Promise((resolve) => { setTimeout(() => resolve(null), 4000); }),
    ]);
    if (!res || !res.ok || !/html/i.test(res.headers.get('content-type') || 'text/html')) return out;
    const html = (await res.text()).slice(0, 300000);
    const meta = (key) => {
      const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, 'i');
      const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, 'i');
      const m = html.match(re1) || html.match(re2);
      return m ? decode(m[1]) : null;
    };
    const t = html.match(/<title[^>]*>([^<]{1,300})<\/title>/i);
    out.title = (meta('og:title') || meta('twitter:title') || (t ? decode(t[1]) : null) || '').slice(0, 200) || null;
    out.description = (meta('og:description') || meta('description') || meta('twitter:description') || '').slice(0, 300) || null;
    const img = meta('og:image') || meta('twitter:image');
    if (img) { try { const abs = new URL(img, u); if (abs.protocol === 'https:') out.image = abs.toString(); } catch (e) { /* ignore */ } }
  } catch (e) { /* preview is optional */ }
  return out;
}

// ---------- shapes ----------
const iso = (d) => (d ? new Date(d).toISOString() : null);
const json = (v, d) => (v == null ? d : typeof v === 'string' ? JSON.parse(v) : v);

/** What the app shows (inbox row, detail view, notification data). */
export function publicShape(r) {
  return {
    id: r.id,
    target: r.target,
    sender: { name: r.sender_name, verified: true, logoUrl: r.sender_logo || null },
    title: r.title || '',
    text: r.body || '',
    media: json(r.media, []).map((m) => ({ type: m.type, url: m.url, thumbUrl: m.thumbUrl || null, width: m.width || null, height: m.height || null, duration: m.duration || null })),
    links: json(r.links, []),
    sentAt: iso(r.sent_at || r.started_at || r.created_at),
  };
}

export function adminShape(r) {
  return {
    ...publicShape(r),
    status: r.status,
    pin: !!r.pin,
    pinned: !!r.post_pinned_at,
    postId: r.post_id || null,
    postRemoved: !!r.post_removed,
    scheduledAt: iso(r.scheduled_at),
    timezone: r.timezone || null,
    localTime: r.local_time || null,
    repeatDaily: !!r.repeat_daily,
    parentId: r.parent_id || null,
    occurrences: r.occurrences || 0,
    createdAt: iso(r.created_at),
    startedAt: iso(r.started_at),
    sentAt: iso(r.sent_at),
    createdBy: r.created_by_name || null,
    error: r.error || null,
    stats: {
      recipients: r.recipients || 0,
      pushSent: r.push_sent || 0,
      pushFailed: r.push_failed || 0,
      opened: r.opened || 0,
      linkClicks: r.link_clicks || 0,
      clickers: r.clickers || 0,
      postViews: r.post_views || 0,
      postLikes: r.post_likes || 0,
      postComments: r.post_comments || 0,
    },
  };
}

// ---------- official account (author of Socials broadcasts) ----------
export async function ensureOfficialAccount(env) {
  const s = senderConfig(env);
  return one(env, `INSERT INTO users (clerk_id, display_name, handle, kind, verified, avatar_url, headline)
      VALUES ($1, $2, CASE WHEN EXISTS (SELECT 1 FROM users WHERE handle = 'biblenestra') THEN NULL ELSE 'biblenestra' END,
        'channel', true, $3, 'Official account')
    ON CONFLICT (clerk_id) DO UPDATE SET display_name = EXCLUDED.display_name, verified = true, kind = 'channel',
      banned = false, avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url)
    RETURNING *`, [OFFICIAL_CLERK_ID, s.name, s.logoUrl]);
}

// ---------- push (Expo, chunks of 100; never throws) ----------
async function pushChunked(env, tokens, { title, body, data }) {
  const out = { sent: 0, failed: 0 };
  if (!tokens.length || String(env.PUSH_DISABLED || '') === 'true') return out;
  for (let i = 0; i < tokens.length; i += 100) {
    const chunk = tokens.slice(i, i + 100).map((to) => ({ to, sound: 'default', title, body, data, channelId: 'default' }));
    try {
      const res = await fetcher(env)('https://exp.host/--/api/v2/push/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(chunk),
      });
      const j = await res.json().catch(() => ({}));
      const tickets = Array.isArray(j.data) ? j.data : [];
      for (let k = 0; k < chunk.length; k++) {
        const t = tickets[k];
        if (t && t.status === 'ok') out.sent++;
        else {
          out.failed++;
          if (t && t.details && t.details.error === 'DeviceNotRegistered') await q(env, 'DELETE FROM push_tokens WHERE token = $1', [chunk[k].to]).catch(() => {});
        }
      }
    } catch (e) { out.failed += chunk.length; console.warn('[broadcasts] push chunk failed', e && e.message); }
  }
  return out;
}

// ---------- sending ----------
const notifTitle = (b) => (b.title ? b.title : b.sender_name);
function notifBody(b) {
  const t = String(b.body || '').replace(/\s+/g, ' ').trim();
  if (t) return t.length > 300 ? `${t.slice(0, 297)}…` : t;
  const media = json(b.media, []);
  if (media.some((m) => m.type === 'video')) return 'Shared a video with you';
  if (media.length) return 'Shared a photo with you';
  return 'New message';
}
function notifData(b) {
  const p = publicShape(b);
  return { broadcastId: b.id, sender: p.sender, title: p.title, text: p.text.slice(0, 2000), media: p.media, links: p.links };
}

/** Claim the lease (one worker at a time per broadcast). */
async function claim(env, id) {
  return one(env, `UPDATE broadcasts SET lease_until = now() + make_interval(secs => $2), attempts = attempts + 1
    WHERE id = $1 AND status = 'sending' AND (lease_until IS NULL OR lease_until < now()) RETURNING *`, [id, LEASE_SECONDS]);
}

async function fanOutBatch(env, b, limit) {
  const users = await q(env, `SELECT id FROM users WHERE NOT banned AND clerk_id <> $1 AND ($2::uuid IS NULL OR id > $2::uuid)
    ORDER BY id LIMIT $3`, [OFFICIAL_CLERK_ID, b.fanout_cursor || null, limit]);
  if (!users.length) return { done: true, inserted: 0, pushed: { sent: 0, failed: 0 } };
  const lo = b.fanout_cursor || null;
  const hi = users[users.length - 1].id;
  const ins = await one(env, `WITH fresh AS (
      INSERT INTO broadcast_deliveries (broadcast_id, user_id)
      SELECT $1, u.id FROM users u WHERE NOT u.banned AND u.clerk_id <> $2 AND ($3::uuid IS NULL OR u.id > $3::uuid) AND u.id <= $4::uuid
      ON CONFLICT DO NOTHING RETURNING user_id
    ), notes AS (
      INSERT INTO notifications (user_id, kind, title, body, data)
      SELECT f.user_id, 'broadcast', $5, $6, $7::jsonb FROM fresh f RETURNING 1
    ) SELECT (SELECT count(*) FROM notes)::int AS n`,
  [b.id, OFFICIAL_CLERK_ID, lo, hi, notifTitle(b), notifBody(b), JSON.stringify(notifData(b))]);
  // pushes: claim every not-yet-pushed delivery in this id range (also picks up a range a crashed run left behind)
  const tokens = await q(env, `WITH c AS (
      UPDATE broadcast_deliveries SET pushed_at = now()
      WHERE broadcast_id = $1 AND pushed_at IS NULL AND ($2::uuid IS NULL OR user_id > $2::uuid) AND user_id <= $3::uuid RETURNING user_id
    ) SELECT pt.token FROM push_tokens pt JOIN c ON c.user_id = pt.user_id JOIN users u ON u.id = pt.user_id
      WHERE COALESCE(u.notify->>'broadcasts', 'true') <> 'false'`, [b.id, lo, hi]);
  const s = senderConfig(env);
  const pushed = await pushChunked(env, tokens.map((t) => t.token), {
    title: b.title ? `${b.sender_name || s.name}: ${b.title}` : (b.sender_name || s.name),
    body: notifBody(b).slice(0, 180),
    data: { kind: 'broadcast', type: 'broadcast', broadcastId: b.id },
  });
  await q(env, `UPDATE broadcasts SET fanout_cursor = $2, recipients = recipients + $3, push_sent = push_sent + $4, push_failed = push_failed + $5,
      lease_until = now() + make_interval(secs => $6) WHERE id = $1`, [b.id, hi, ins ? ins.n : 0, pushed.sent, pushed.failed, LEASE_SECONDS]);
  b.fanout_cursor = hi;
  return { done: users.length < limit, inserted: ins ? ins.n : 0, pushed };
}

async function publishToSocials(env, b) {
  const official = await ensureOfficialAccount(env);
  const media = json(b.media, []);
  const links = json(b.links, []);
  let text = String(b.body || '');
  if (b.title && !text.startsWith(b.title)) text = text ? `${b.title}\n\n${text}` : b.title;
  for (const l of links) if (!text.includes(l.url)) text += `${text ? '\n' : ''}${l.label ? `${l.label}: ` : ''}${l.url}`;
  text = text.slice(0, 5000);
  const video = media.find((m) => m.type === 'video');
  const images = media.filter((m) => m.type === 'image');
  const kind = video ? 'Video' : 'Announcement';
  const post = await one(env, `INSERT INTO posts (author_id, kind, body, video_status, video_duration, video_url, video_thumb, pinned_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
  [official.id, kind, text, video ? 'ready' : null, video ? video.duration || null : null, video ? video.key : null, video ? video.thumbKey || null : null, b.pin ? new Date().toISOString() : null]);
  if (!video) {
    for (let i = 0; i < images.length; i++) {
      const m = images[i];
      await q(env, 'INSERT INTO post_media (post_id, position, r2_key, width, height) VALUES ($1,$2,$3,$4,$5)', [post.id, i, m.key, m.width || null, m.height || null]);
    }
  }
  // a daily-repeating pinned broadcast keeps only its newest post on top
  if (b.pin && b.parent_id) {
    await q(env, `UPDATE posts SET pinned_at = NULL WHERE id IN (SELECT post_id FROM broadcasts WHERE parent_id = $1 AND id <> $2 AND post_id IS NOT NULL)`, [b.parent_id, b.id]);
  }
  return post.id;
}

/**
 * Work on one 'sending' broadcast until it is done or maxUsers recipients were handled in this call.
 * → { id, done, recipients, pushed, busy? }
 */
export async function processBroadcast(env, id, { maxUsers = Infinity } = {}) {
  const b = await claim(env, id);
  if (!b) return { id, busy: true, done: false };
  try {
    if (b.target === 'socials') {
      const postId = b.post_id || await publishToSocials(env, b);
      await q(env, `UPDATE broadcasts SET post_id = $2, status = 'sent', sent_at = now(), lease_until = NULL, error = NULL WHERE id = $1`, [id, postId]);
      return { id, done: true, postId };
    }
    const size = batchSize(env);
    let handled = 0; let inserted = 0; let sent = 0;
    for (;;) {
      const r = await fanOutBatch(env, b, size);
      inserted += r.inserted; sent += r.pushed.sent;
      handled += size;
      if (r.done) {
        await q(env, `UPDATE broadcasts SET status = 'sent', sent_at = now(), lease_until = NULL, error = NULL WHERE id = $1`, [id]);
        return { id, done: true, recipients: inserted, pushed: sent };
      }
      if (handled >= maxUsers) {
        await q(env, 'UPDATE broadcasts SET lease_until = NULL, attempts = 0 WHERE id = $1', [id]); // more to do — next worker continues
        return { id, done: false, recipients: inserted, pushed: sent };
      }
    }
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 500);
    await q(env, `UPDATE broadcasts SET lease_until = NULL, error = $2, status = CASE WHEN attempts >= $3 THEN 'failed' ELSE status END WHERE id = $1`, [id, msg, MAX_ATTEMPTS]).catch(() => {});
    console.warn('[broadcasts] send failed', id, msg);
    return { id, done: false, error: msg };
  }
}

/** Send now: the first slice inline, the rest in the background (waitUntil) and by the cron. */
export async function startSend(env, id, executionCtx) {
  const r = await processBroadcast(env, id, { maxUsers: inlineUsers(env) });
  if (!r.done && !r.error && executionCtx && typeof executionCtx.waitUntil === 'function') {
    executionCtx.waitUntil(processBroadcast(env, id).catch(() => {}));
  }
  return r;
}

/**
 * Cron (every 15 min): start due scheduled broadcasts, create today's copy of daily-repeating ones, and continue
 * fan-outs that are still running. → { started, repeated, continued, errors[] }
 */
export async function runBroadcastCron(env) {
  const out = { started: 0, repeated: 0, continued: 0, errors: [] };
  // 1. one-off scheduled broadcasts that are due
  const due = await q(env, `UPDATE broadcasts SET status = 'sending', started_at = now()
    WHERE id IN (SELECT id FROM broadcasts WHERE status = 'scheduled' AND NOT repeat_daily AND scheduled_at <= now() ORDER BY scheduled_at LIMIT 20)
      AND status = 'scheduled' RETURNING id`);
  out.started = due.length;
  // 2. daily repeats: claim by moving scheduled_at forward (compare-and-set), then send a copy
  const templates = await q(env, `SELECT * FROM broadcasts WHERE status = 'scheduled' AND repeat_daily AND scheduled_at <= now() ORDER BY scheduled_at LIMIT 20`);
  for (const t of templates) {
    try {
      const next = nextDaily(t.scheduled_at, t.local_time, t.timezone);
      const won = await one(env, `UPDATE broadcasts SET scheduled_at = $2, occurrences = occurrences + 1 WHERE id = $1 AND scheduled_at <= now() AND status = 'scheduled' RETURNING id`,
        [t.id, next.toISOString()]);
      if (!won) continue;
      await one(env, `INSERT INTO broadcasts (target, status, title, body, media, links, pin, sender_name, sender_logo, content_hash, created_by, parent_id, scheduled_at, timezone, local_time, started_at)
        SELECT target, 'sending', title, body, media, links, pin, $2, $3, content_hash, created_by, id, $4::timestamptz, timezone, local_time, now()
        FROM broadcasts WHERE id = $1 RETURNING id`, [t.id, senderConfig(env).name, senderConfig(env).logoUrl, t.scheduled_at]);
      out.repeated++;
    } catch (e) { out.errors.push(`repeat ${t.id}: ${e && e.message}`); }
  }
  // 3. everything that is sending (new, or left over from an earlier run / request)
  const sending = await q(env, `SELECT id FROM broadcasts WHERE status = 'sending' AND (lease_until IS NULL OR lease_until < now()) ORDER BY started_at NULLS FIRST LIMIT 20`);
  let budget = cronUsers(env);
  for (const s of sending) {
    if (budget <= 0) break;
    const r = await processBroadcast(env, s.id, { maxUsers: budget });
    if (r.error) out.errors.push(`${s.id}: ${r.error}`);
    if (!r.busy) out.continued++;
    budget -= r.recipients || 1;
  }
  return out;
}

/** Media from the composer → stored form (absolute URLs computed now, while the request origin is known). */
export function storedMedia(env, origin, m, video) {
  if (m.type === 'image') {
    return { type: 'image', key: m.key, url: mediaUrl(env, origin, m.key), width: Number.isFinite(m.width) ? Math.round(m.width) : null, height: Number.isFinite(m.height) ? Math.round(m.height) : null };
  }
  return {
    type: 'video', uid: video.uid, key: video.video_key, url: mediaUrl(env, origin, video.video_key),
    thumbKey: video.thumb_key || null, thumbUrl: video.thumb_key ? mediaUrl(env, origin, video.thumb_key) : null,
    duration: video.duration || null, width: video.width || null, height: video.height || null,
  };
}
