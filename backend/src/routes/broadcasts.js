// BROADCASTS (brief 11.1 + 7.6)
//   broadcastsApp   — signed-in users: GET /broadcasts/:id, POST /broadcasts/:id/open, POST /broadcasts/:id/click
//                     (read stats; only people the broadcast was delivered to)
//   adminBroadcasts — /admin/api/broadcasts (admins only): list + stats, create (send now / schedule / repeat daily,
//                     idempotent), cancel, pin/unpin the Socials post, link preview, "run scheduler now"
import { Hono } from 'hono';
import { one, q } from '../lib/db.js';
import { ApiError, bad, body, notFound, str, uuidParam } from '../lib/http.js';
import {
  adminShape, contentHash, DUPLICATE_WINDOW_MIN, ensureOfficialAccount, linkPreview, OFFICIAL_CLERK_ID, publicShape,
  runBroadcastCron, senderConfig, startSend, storedMedia, validTimeZone, zonedToUtc,
} from '../lib/broadcasts.js';
import { BROADCASTS_ADMIN_SCRIPT } from '../lib/broadcastsAdminPage.js';
import { audit, registerAdminScript, requireAdmin } from './admin.js';

registerAdminScript(BROADCASTS_ADMIN_SCRIPT);

const origin = (c) => new URL(c.req.url).origin;
const execCtx = (c) => { try { return c.executionCtx; } catch (e) { return null; } };

// ---------- app (signed in) ----------
export const broadcastsApp = new Hono();

async function myDelivery(c) {
  const me = c.get('user');
  const id = uuidParam(c);
  const row = await one(c.env, `SELECT b.*, d.opened_at FROM broadcast_deliveries d JOIN broadcasts b ON b.id = d.broadcast_id
    WHERE d.broadcast_id = $1 AND d.user_id = $2`, [id, me.id]);
  if (!row) throw notFound('Message not found');
  return row;
}

broadcastsApp.get('/broadcasts/:id', async (c) => c.json(publicShape(await myDelivery(c))));

// Opening a broadcast in the app (inbox detail view). Counted once per person; marks its inbox entry read.
broadcastsApp.post('/broadcasts/:id/open', async (c) => {
  const me = c.get('user');
  const b = await myDelivery(c);
  await q(c.env, `WITH o AS (UPDATE broadcast_deliveries SET opened_at = now() WHERE broadcast_id = $1 AND user_id = $2 AND opened_at IS NULL RETURNING 1)
    UPDATE broadcasts SET opened = opened + (SELECT count(*) FROM o) WHERE id = $1`, [b.id, me.id]);
  await q(c.env, `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND kind = 'broadcast' AND read_at IS NULL AND data->>'broadcastId' = $2`, [me.id, b.id]);
  return c.json(publicShape(b));
});

// Tapping a link in a broadcast. Total clicks + people who clicked (capped at 50 per person); also counts as opened.
broadcastsApp.post('/broadcasts/:id/click', async (c) => {
  const me = c.get('user');
  const b = await myDelivery(c);
  const r = await one(c.env, `WITH prev AS (SELECT opened_at, clicked_at, clicks FROM broadcast_deliveries WHERE broadcast_id = $1 AND user_id = $2),
      upd AS (UPDATE broadcast_deliveries SET clicks = clicks + 1, clicked_at = COALESCE(clicked_at, now()), opened_at = COALESCE(opened_at, now())
        WHERE broadcast_id = $1 AND user_id = $2 AND clicks < 50 RETURNING 1)
    UPDATE broadcasts SET link_clicks = link_clicks + (SELECT count(*) FROM upd),
      clickers = clickers + CASE WHEN EXISTS (SELECT 1 FROM upd) AND (SELECT clicked_at FROM prev) IS NULL THEN 1 ELSE 0 END,
      opened = opened + CASE WHEN EXISTS (SELECT 1 FROM upd) AND (SELECT opened_at FROM prev) IS NULL THEN 1 ELSE 0 END
    WHERE id = $1 RETURNING link_clicks`, [b.id, me.id]);
  return c.json({ ok: true, clicks: r ? r.link_clicks : 0 });
});

// ---------- admin ----------
export const adminBroadcasts = new Hono();
adminBroadcasts.use('/admin/api/broadcasts', requireAdmin);
adminBroadcasts.use('/admin/api/broadcasts/*', requireAdmin);

const LIST_SELECT = `SELECT b.*, u.display_name AS created_by_name, p.pinned_at AS post_pinned_at, p.removed AS post_removed,
    p.views_count AS post_views, p.likes_count AS post_likes, p.comments_count AS post_comments
  FROM broadcasts b LEFT JOIN users u ON u.id = b.created_by LEFT JOIN posts p ON p.id = b.post_id`;

adminBroadcasts.get('/admin/api/broadcasts', async (c) => {
  const target = c.req.query('target');
  const where = target === 'inbox' || target === 'socials' ? 'WHERE b.target = $1' : target === 'scheduled' ? "WHERE b.status = 'scheduled'" : '';
  const rows = await q(c.env, `${LIST_SELECT} ${where} ORDER BY COALESCE(b.sent_at, b.started_at, b.created_at) DESC LIMIT 100`, where.includes('$1') ? [target] : []);
  const aud = await one(c.env, `SELECT (SELECT count(*) FROM users WHERE NOT banned AND clerk_id <> $1)::int AS users,
      (SELECT count(*) FROM push_tokens pt JOIN users u ON u.id = pt.user_id WHERE NOT u.banned AND COALESCE(u.notify->>'broadcasts', 'true') <> 'false')::int AS devices`, [OFFICIAL_CLERK_ID]);
  return c.json({
    sender: senderConfig(c.env),
    audience: aud,
    duplicateWindowMinutes: DUPLICATE_WINDOW_MIN,
    items: rows.map(adminShape),
  });
});

adminBroadcasts.get('/admin/api/broadcasts/:id', async (c) => {
  const row = await one(c.env, `${LIST_SELECT} WHERE b.id = $1`, [uuidParam(c)]);
  if (!row) throw notFound('Broadcast not found');
  return c.json(adminShape(row));
});

adminBroadcasts.post('/admin/api/broadcasts/link-preview', async (c) => {
  const b = await body(c);
  const p = await linkPreview(c.env, str(b.url, { min: 4, max: 2000, field: 'Link' }));
  if (!p) throw bad('Enter a full link starting with https://', 'BAD_LINK');
  return c.json(p);
});

async function readInput(c, b) {
  const me = c.get('user');
  const target = b.target === 'socials' ? 'socials' : b.target === 'inbox' ? 'inbox' : null;
  if (!target) throw bad('Choose “Broadcast to All Users” or “Broadcast to Socials”', 'BAD_TARGET');
  const title = str(b.title, { max: 120, optional: true, field: 'Title' }) || '';
  const text = str(b.text, { max: 5000, optional: true, field: 'Message' }) || '';
  // media
  const rawMedia = Array.isArray(b.media) ? b.media : [];
  const media = [];
  let videos = 0; let images = 0;
  for (const m of rawMedia) {
    if (!m || (m.type !== 'image' && m.type !== 'video')) throw bad('Attachments must be images or videos', 'BAD_MEDIA');
    if (m.type === 'image') {
      if (typeof m.key !== 'string' || !m.key.startsWith(`img/${me.id}/`) || m.key.includes('..')) throw bad('Upload images with POST /uploads/image first', 'BAD_IMAGE');
      images++;
      media.push(storedMedia(c.env, origin(c), m));
    } else {
      const v = await one(c.env, 'SELECT * FROM video_uploads WHERE uid = $1 AND user_id = $2', [String(m.uid || ''), me.id]);
      if (!v || v.status !== 'ready' || !v.video_key) throw bad('That video hasn’t finished uploading', 'BAD_VIDEO');
      videos++;
      media.push(storedMedia(c.env, origin(c), m, v));
    }
  }
  if (videos > 1) throw bad('Attach at most one video', 'TOO_MANY_VIDEOS');
  if (target === 'inbox' && images > 4) throw bad('Attach at most 4 images to an inbox message', 'TOO_MANY_IMAGES');
  if (target === 'socials' && images > 10) throw bad('Attach at most 10 images', 'TOO_MANY_IMAGES');
  if (target === 'socials' && images && videos) throw bad('A Socials post has either photos or one video, not both', 'MIXED_MEDIA');
  // links (previews fetched once, now)
  const rawLinks = Array.isArray(b.links) ? b.links.filter((l) => l && String(l.url || '').trim()) : [];
  if (rawLinks.length > 3) throw bad('Add at most 3 links', 'TOO_MANY_LINKS');
  const links = [];
  for (const l of rawLinks) {
    let u;
    try { u = new URL(String(l.url).trim()); } catch (e) { throw bad(`“${String(l.url).slice(0, 60)}” isn’t a full link (start it with https://)`, 'BAD_LINK'); }
    if (!/^https?:$/.test(u.protocol)) throw bad('Links must start with https://', 'BAD_LINK');
    const label = str(l.label, { max: 40, optional: true, field: 'Link button text' }) || null;
    const pv = l.preview === false ? null : await linkPreview(c.env, u.toString());
    links.push({ url: u.toString(), label, host: u.hostname.replace(/^www\./, ''), title: pv && pv.title, description: pv && pv.description, image: pv && pv.image });
  }
  if (!text && !media.length && !title) throw bad('Write a message or attach a photo or video', 'EMPTY');
  // when
  let schedule = null;
  if (b.schedule && typeof b.schedule === 'object') {
    const s = b.schedule;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s.date || ''))) throw bad('Pick a date for the schedule', 'BAD_SCHEDULE');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(s.time || ''))) throw bad('Pick a time (HH:MM) for the schedule', 'BAD_SCHEDULE');
    if (!validTimeZone(s.timezone)) throw bad('Pick a valid time zone', 'BAD_TIMEZONE');
    const at = zonedToUtc(s.date, s.time, s.timezone);
    if (Number.isNaN(at.getTime())) throw bad('Pick a valid date and time', 'BAD_SCHEDULE');
    if (at.getTime() < Date.now() - 60e3) throw bad('That time has already passed — pick a time in the future or use Send now', 'IN_THE_PAST');
    if (at.getTime() > Date.now() + 366 * 86400e3) throw bad('Schedule at most a year ahead', 'TOO_FAR');
    schedule = { at, timezone: s.timezone, localTime: s.time, repeatDaily: !!s.repeatDaily };
  }
  const pin = target === 'socials' && !!b.pin;
  return { target, title, text, media, links, pin, schedule };
}

adminBroadcasts.post('/admin/api/broadcasts', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const key = str(b.idempotencyKey, { min: 8, max: 100, field: 'idempotencyKey' });
  const input = await readInput(c, b);
  const hash = await contentHash({
    target: input.target, title: input.title, text: input.text, pin: input.pin,
    media: input.media.map((m) => m.key), links: input.links.map((l) => [l.url, l.label]),
    when: input.schedule ? [input.schedule.at.toISOString(), input.schedule.repeatDaily] : 'now',
  });

  // 1. same idempotency key → the original broadcast (a retry or a double click), never a second send
  const prior = await one(c.env, `${LIST_SELECT} WHERE b.idem_key = $1`, [key]);
  if (prior) {
    if (prior.content_hash !== hash) throw new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', 'This send was already used for a different message — reload the composer and try again');
    return c.json({ ...adminShape(prior), duplicate: true });
  }
  // 2. identical content sent moments ago under another key → refuse
  const dupe = await one(c.env, `SELECT id, created_at FROM broadcasts WHERE content_hash = $1 AND parent_id IS NULL AND status <> 'cancelled' AND status <> 'failed'
    AND created_at > now() - make_interval(mins => $2) ORDER BY created_at DESC LIMIT 1`, [hash, DUPLICATE_WINDOW_MIN]);
  if (dupe) {
    const mins = Math.max(1, Math.round((Date.now() - new Date(dupe.created_at).getTime()) / 60000));
    const e = new ApiError(409, 'DUPLICATE_CONTENT', `An identical broadcast was created ${mins} min ago, so this one was not sent again. Change the message, or wait ${DUPLICATE_WINDOW_MIN} minutes to repeat it.`);
    throw e;
  }
  const s = senderConfig(c.env);
  if (input.target === 'socials') await ensureOfficialAccount(c.env);
  const sch = input.schedule;
  const row = await one(c.env, `INSERT INTO broadcasts (target, status, title, body, media, links, pin, sender_name, sender_logo, idem_key, content_hash, created_by,
      scheduled_at, timezone, local_time, repeat_daily, started_at)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
    ON CONFLICT (idem_key) DO NOTHING RETURNING *`, [
    input.target, sch ? 'scheduled' : 'sending', input.title, input.text, JSON.stringify(input.media), JSON.stringify(input.links), input.pin,
    s.name, s.logoUrl, key, hash, me.id,
    sch ? sch.at.toISOString() : null, sch ? sch.timezone : null, sch ? sch.localTime : null, sch ? sch.repeatDaily : false, sch ? null : new Date().toISOString(),
  ]);
  if (!row) { // lost a race with the same key
    const again = await one(c.env, `${LIST_SELECT} WHERE b.idem_key = $1`, [key]);
    return c.json({ ...adminShape(again), duplicate: true });
  }
  let run = null;
  if (!sch) run = await startSend(c.env, row.id, execCtx(c));
  await audit(c.env, me, sch ? 'broadcast.schedule' : 'broadcast.send', 'broadcast', row.id, {
    target: input.target, title: input.title, text: input.text.slice(0, 200), scheduledAt: sch ? sch.at.toISOString() : null, repeatDaily: sch ? sch.repeatDaily : false,
  });
  const fresh = await one(c.env, `${LIST_SELECT} WHERE b.id = $1`, [row.id]);
  return c.json({ ...adminShape(fresh), duplicate: false, finished: run ? !!run.done : false }, 201);
});

// Cancel a scheduled (or daily-repeating) broadcast. Messages already delivered stay delivered.
adminBroadcasts.post('/admin/api/broadcasts/:id/cancel', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const row = await one(c.env, `UPDATE broadcasts SET status = 'cancelled' WHERE id = $1 AND status = 'scheduled' RETURNING *`, [id]);
  if (!row) throw bad('Only scheduled broadcasts can be cancelled', 'NOT_SCHEDULED');
  await audit(c.env, me, 'broadcast.cancel', 'broadcast', id, { title: row.title });
  return c.json(adminShape(await one(c.env, `${LIST_SELECT} WHERE b.id = $1`, [id])));
});

// Pin / unpin the Socials post of a broadcast.
adminBroadcasts.patch('/admin/api/broadcasts/:id', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const b = await body(c);
  const row = await one(c.env, 'SELECT * FROM broadcasts WHERE id = $1', [id]);
  if (!row) throw notFound('Broadcast not found');
  if (b.pinned !== undefined) {
    if (!row.post_id) throw bad('Only a published Socials broadcast can be pinned', 'NO_POST');
    await q(c.env, 'UPDATE posts SET pinned_at = CASE WHEN $2 THEN COALESCE(pinned_at, now()) ELSE NULL END WHERE id = $1', [row.post_id, !!b.pinned]);
    await audit(c.env, me, b.pinned ? 'broadcast.pin' : 'broadcast.unpin', 'broadcast', id, { postId: row.post_id });
  }
  return c.json(adminShape(await one(c.env, `${LIST_SELECT} WHERE b.id = $1`, [id])));
});

// Run the scheduler now (the cron does this every 15 minutes).
adminBroadcasts.post('/admin/api/broadcasts/run', async (c) => {
  const r = await runBroadcastCron(c.env);
  return c.json(r);
});
