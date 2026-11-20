// TODAY'S JOURNEY + WATCH ON TODAY
//   dailyPublic (no sign-in):
//     GET /daily/today[?date=YYYY-MM-DD]  → { date, bread|null, video|null, videoCount, flags: { autoHighlight } }
//     GET /daily/videos[?date=…]          → { items: blessing videos published on or before the date (newest first) }
//     GET /youtube/latest[?limit=20]      → { items, groups, fetchedAt } latest videos of the channels shown on Today
//   adminDaily (admins only): /admin/api/daily/* (schedule Daily Bread, blessing videos, flag) and
//     /admin/api/youtube/today/* (per-channel feed options, hidden videos, refresh). Admin tabs: see lib/dailyAdminPage.js
import { Hono } from 'hono';
import { one, q } from '../lib/db.js';
import { ApiError, bad, body, notFound, str, today, uuidParam } from '../lib/http.js';
import {
  AUTO_HIGHLIGHT_KEY, DATE_RE, breadShape, getSetting, latestChannelVideos, parseVerseRef, setSetting, videoIdFrom, videoShape,
} from '../lib/dailyBread.js';
import { PLAYLIST_ID_RE } from '../lib/youtube.js';
import { DAILY_ADMIN_SCRIPT } from '../lib/dailyAdminPage.js';
import { audit, registerAdminScript, requireAdmin } from './admin.js';

registerAdminScript(DAILY_ADMIN_SCRIPT);

const origin = (c) => new URL(c.req.url).origin;
const DAY_MS = 86400000;
const BREAD_COLS = `*, to_char(day, 'YYYY-MM-DD') AS day_s`;
const VIDEO_COLS = `*, to_char(publish_on, 'YYYY-MM-DD') AS publish_on_s`;
const IMAGE_KEY_RE = /^img\/[\w-]+\/[\w-]+\.(jpg|png|webp|heic|heif)$/;

/** The viewer's local date: ?date= when it is within a day of the server's (time zones), else the server's */
function dayFor(c) {
  const want = c.req.query('date');
  const server = today(c.req.header('X-TZ-Offset'));
  if (want && DATE_RE.test(want) && Math.abs(Date.parse(want) - Date.parse(today(0))) <= DAY_MS) return want;
  return server;
}

// ---------- public ----------
export const dailyPublic = new Hono();

dailyPublic.get('/daily/today', async (c) => {
  const day = dayFor(c);
  const bread = await one(c.env, `SELECT ${BREAD_COLS} FROM daily_bread WHERE day = $1::date`, [day]);
  const video = await one(c.env, `SELECT ${VIDEO_COLS} FROM blessing_videos WHERE NOT hidden AND publish_on <= $1::date
    ORDER BY publish_on DESC, created_at DESC LIMIT 1`, [day]);
  const count = await one(c.env, 'SELECT count(*)::int AS n FROM blessing_videos WHERE NOT hidden AND publish_on <= $1::date', [day]);
  const autoHighlight = (await getSetting(c.env, AUTO_HIGHLIGHT_KEY, false)) === true;
  c.header('Cache-Control', 'public, max-age=120');
  return c.json({
    date: day,
    bread: breadShape(c.env, origin(c), bread),
    video: video ? videoShape(c.env, origin(c), video) : null,
    videoCount: count ? count.n : 0,
    flags: { autoHighlight },
  });
});

dailyPublic.get('/daily/videos', async (c) => {
  const day = dayFor(c);
  const rows = await q(c.env, `SELECT ${VIDEO_COLS} FROM blessing_videos WHERE NOT hidden AND publish_on <= $1::date
    ORDER BY publish_on DESC, created_at DESC LIMIT 60`, [day]);
  c.header('Cache-Control', 'public, max-age=120');
  return c.json({ date: day, items: rows.map((r) => videoShape(c.env, origin(c), r)) });
});

dailyPublic.get('/youtube/latest', async (c) => {
  const limit = Math.max(1, Math.min(40, Number(c.req.query('limit')) || 20));
  const out = await latestChannelVideos(c.env, { limit });
  c.header('Cache-Control', 'public, max-age=300');
  return c.json(out);
});

// ---------- admin ----------
export const adminDaily = new Hono();
adminDaily.use('/admin/api/daily', requireAdmin);
adminDaily.use('/admin/api/daily/*', requireAdmin);
adminDaily.use('/admin/api/youtube/today', requireAdmin);
adminDaily.use('/admin/api/youtube/today/*', requireAdmin);

const dateParam = (c) => {
  const d = c.req.param('date');
  if (!DATE_RE.test(d || '') || Number.isNaN(Date.parse(d))) throw bad('Use a date like 2026-12-25', 'BAD_DATE');
  return d;
};

adminDaily.get('/admin/api/daily', async (c) => {
  const bread = await q(c.env, `SELECT ${BREAD_COLS} FROM daily_bread WHERE day >= CURRENT_DATE - 30 ORDER BY day LIMIT 400`);
  const videos = await q(c.env, `SELECT ${VIDEO_COLS} FROM blessing_videos ORDER BY publish_on DESC, created_at DESC LIMIT 200`);
  return c.json({
    today: today(0),
    bread: bread.map((r) => breadShape(c.env, origin(c), r)),
    videos: videos.map((r) => videoShape(c.env, origin(c), r)),
    settings: { autoHighlight: (await getSetting(c.env, AUTO_HIGHLIGHT_KEY, false)) === true },
  });
});

adminDaily.get('/admin/api/daily/verse-check', (c) => {
  const v = parseVerseRef(c.req.query('ref'));
  return c.json({ ok: !!v, verse: v });
});

adminDaily.put('/admin/api/daily/bread/:date', async (c) => {
  const me = c.get('user');
  const day = dateParam(c);
  const b = await body(c);
  const v = parseVerseRef(b.ref);
  if (!v) throw bad('Write a verse reference like “Psalm 23:1” or “John 3:16-18”', 'BAD_REF');
  const reflection = str(b.reflection || '', { max: 1500, field: 'reflection' });
  const cur = await one(c.env, 'SELECT image_key FROM daily_bread WHERE day = $1::date', [day]);
  let imageKey = cur ? cur.image_key : null;
  if (b.imageKey === null) imageKey = null;
  else if (b.imageKey !== undefined) {
    if (!IMAGE_KEY_RE.test(String(b.imageKey))) throw bad('Upload the image with /uploads/image first', 'BAD_IMAGE');
    imageKey = String(b.imageKey);
  }
  const row = await one(c.env, `INSERT INTO daily_bread (day, book_id, chapter, verse, verse_end, label, image_key, reflection, created_by)
      VALUES ($1::date,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (day) DO UPDATE SET book_id = EXCLUDED.book_id, chapter = EXCLUDED.chapter, verse = EXCLUDED.verse,
      verse_end = EXCLUDED.verse_end, label = EXCLUDED.label, image_key = EXCLUDED.image_key, reflection = EXCLUDED.reflection, updated_at = now()
    RETURNING ${BREAD_COLS}`, [day, v.bookId, v.chapter, v.verse, v.verseEnd, v.label, imageKey, reflection, me.id]);
  await audit(c.env, me, 'daily.bread.save', 'daily_bread', day, { label: v.label, image: !!imageKey });
  return c.json(breadShape(c.env, origin(c), row));
});

adminDaily.delete('/admin/api/daily/bread/:date', async (c) => {
  const me = c.get('user');
  const day = dateParam(c);
  const row = await one(c.env, 'DELETE FROM daily_bread WHERE day = $1::date RETURNING label', [day]);
  if (!row) throw notFound('Nothing scheduled on that day');
  await audit(c.env, me, 'daily.bread.delete', 'daily_bread', day, { label: row.label });
  return c.json({ ok: true });
});

const publishDate = (v) => {
  const d = String(v || '').slice(0, 10);
  if (!DATE_RE.test(d) || Number.isNaN(Date.parse(d))) throw bad('Pick a publish date', 'BAD_DATE');
  return d;
};

// The video goes up first through POST /uploads/video (+ PUT or multipart) as the admin; this publishes it.
adminDaily.post('/admin/api/daily/videos', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const title = str(b.title, { min: 1, max: 120, field: 'title' });
  const description = str(b.description || '', { max: 600, field: 'description' });
  const publishOn = b.publishOn ? publishDate(b.publishOn) : today(0);
  const up = await one(c.env, 'SELECT * FROM video_uploads WHERE uid = $1', [String(b.videoUid || '')]);
  if (!up || up.user_id !== me.id) throw bad('Upload the video first', 'BAD_VIDEO');
  if (up.status !== 'ready' || !up.video_key) throw bad('The video hasn’t finished uploading', 'VIDEO_NOT_READY');
  let thumbKey = up.thumb_key || null;
  if (b.thumbKey) {
    if (!IMAGE_KEY_RE.test(String(b.thumbKey))) throw bad('Upload the thumbnail with /uploads/image first', 'BAD_IMAGE');
    thumbKey = String(b.thumbKey);
  }
  const dur = Number(b.durationSec || up.duration || 0);
  const row = await one(c.env, `INSERT INTO blessing_videos (title, description, video_uid, video_key, thumb_key, duration_sec, width, height, publish_on, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10) RETURNING ${VIDEO_COLS}`,
  [title, description, up.uid, up.video_key, thumbKey, dur > 0 ? Math.round(dur) : null, up.width || null, up.height || null, publishOn, me.id]);
  await audit(c.env, me, 'daily.video.add', 'blessing_video', row.id, { title, publishOn });
  return c.json(videoShape(c.env, origin(c), row), 201);
});

adminDaily.patch('/admin/api/daily/videos/:id', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const cur = await one(c.env, 'SELECT * FROM blessing_videos WHERE id = $1', [id]);
  if (!cur) throw notFound('Video not found');
  const b = await body(c);
  let thumbKey = cur.thumb_key;
  if (b.thumbKey) {
    if (!IMAGE_KEY_RE.test(String(b.thumbKey))) throw bad('Upload the thumbnail with /uploads/image first', 'BAD_IMAGE');
    thumbKey = String(b.thumbKey);
  }
  const next = {
    title: b.title !== undefined ? str(b.title, { min: 1, max: 120, field: 'title' }) : cur.title,
    description: b.description !== undefined ? str(b.description || '', { max: 600, field: 'description' }) : cur.description,
    publishOn: b.publishOn !== undefined ? publishDate(b.publishOn) : null,
    hidden: b.hidden !== undefined ? !!b.hidden : cur.hidden,
  };
  const row = await one(c.env, `UPDATE blessing_videos SET title = $2, description = $3, publish_on = COALESCE($4::date, publish_on), hidden = $5, thumb_key = $6
    WHERE id = $1 RETURNING ${VIDEO_COLS}`, [id, next.title, next.description, next.publishOn, next.hidden, thumbKey]);
  await audit(c.env, me, 'daily.video.update', 'blessing_video', id, next);
  return c.json(videoShape(c.env, origin(c), row));
});

adminDaily.delete('/admin/api/daily/videos/:id', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const row = await one(c.env, 'DELETE FROM blessing_videos WHERE id = $1 RETURNING *', [id]);
  if (!row) throw notFound('Video not found');
  if (c.env.MEDIA) {
    for (const k of [row.video_key, row.thumb_key]) if (k && /^vid\//.test(k)) await c.env.MEDIA.delete(k).catch(() => {});
  }
  await audit(c.env, me, 'daily.video.delete', 'blessing_video', id, { title: row.title });
  return c.json({ ok: true });
});

adminDaily.put('/admin/api/daily/settings', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  if (typeof b.autoHighlight !== 'boolean') throw bad('autoHighlight must be true or false');
  await setSetting(c.env, AUTO_HIGHLIGHT_KEY, b.autoHighlight);
  await audit(c.env, me, 'daily.settings', 'daily_settings', AUTO_HIGHLIGHT_KEY, { value: b.autoHighlight });
  return c.json({ autoHighlight: b.autoHighlight });
});

// ---------- admin: Watch on Today ----------
const todayChannelShape = (r) => ({
  id: r.id, channelId: r.channel_id, title: r.title, handle: r.handle, avatarUrl: r.avatar_url, active: r.active,
  source: r.today_source || 'uploads', playlistId: r.today_playlist_id || null, shorts: r.today_shorts !== false, showOnToday: r.show_on_today !== false,
});

adminDaily.get('/admin/api/youtube/today', async (c) => {
  const channels = await q(c.env, 'SELECT * FROM youtube_channels ORDER BY active DESC, featured DESC, sort_order, created_at');
  const hidden = await q(c.env, 'SELECT video_id, title, created_at FROM youtube_hidden_videos ORDER BY created_at DESC LIMIT 300');
  let latest = { items: [], groups: [], fetchedAt: null };
  try { latest = await latestChannelVideos(c.env, { limit: 30 }); } catch (e) { /* shown as empty */ }
  return c.json({
    channels: channels.map(todayChannelShape),
    hidden: hidden.map((h) => ({ videoId: h.video_id, title: h.title, hiddenAt: new Date(h.created_at).toISOString() })),
    latest,
  });
});

adminDaily.patch('/admin/api/youtube/today/channels/:id', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const cur = await one(c.env, 'SELECT * FROM youtube_channels WHERE id = $1', [id]);
  if (!cur) throw notFound('Channel not found');
  const b = await body(c);
  const source = b.source !== undefined ? String(b.source) : cur.today_source;
  if (!['uploads', 'playlist'].includes(source)) throw bad('Source must be uploads or playlist');
  let playlistId = b.playlistId !== undefined ? String(b.playlistId || '').trim() : cur.today_playlist_id || '';
  const m = /[?&]list=([A-Za-z0-9_-]+)/.exec(playlistId);
  if (m) playlistId = m[1];
  if (playlistId && !PLAYLIST_ID_RE.test(playlistId)) throw bad('Paste a YouTube playlist link or id (PL…)', 'BAD_PLAYLIST');
  if (source === 'playlist' && !playlistId) throw bad('Add the playlist link to show a playlist', 'BAD_PLAYLIST');
  const shorts = b.shorts !== undefined ? !!b.shorts : cur.today_shorts;
  const showOnToday = b.showOnToday !== undefined ? !!b.showOnToday : cur.show_on_today;
  const row = await one(c.env, `UPDATE youtube_channels SET today_source = $2, today_playlist_id = $3, today_shorts = $4, show_on_today = $5
    WHERE id = $1 RETURNING *`, [id, source, playlistId || null, shorts, showOnToday]);
  await audit(c.env, me, 'youtube.today.update', 'youtube_channel', id, { source, playlistId: playlistId || null, shorts, showOnToday });
  return c.json(todayChannelShape(row));
});

adminDaily.post('/admin/api/youtube/today/hidden', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const videoId = videoIdFrom(b.video || b.videoId);
  if (!videoId) throw bad('Paste the YouTube link or video id', 'BAD_VIDEO');
  const title = b.title ? str(b.title, { max: 200, field: 'title' }) : null;
  await q(c.env, `INSERT INTO youtube_hidden_videos (video_id, title, hidden_by) VALUES ($1,$2,$3) ON CONFLICT (video_id) DO NOTHING`, [videoId, title, me.id]);
  await audit(c.env, me, 'youtube.today.hide', 'youtube_video', videoId, { title });
  return c.json({ ok: true, videoId }, 201);
});

adminDaily.delete('/admin/api/youtube/today/hidden/:videoId', async (c) => {
  const me = c.get('user');
  const videoId = videoIdFrom(c.req.param('videoId'));
  if (!videoId) throw notFound('Video not found');
  await q(c.env, 'DELETE FROM youtube_hidden_videos WHERE video_id = $1', [videoId]);
  await audit(c.env, me, 'youtube.today.unhide', 'youtube_video', videoId, {});
  return c.json({ ok: true });
});

adminDaily.post('/admin/api/youtube/today/refresh', async (c) => {
  try {
    return c.json(await latestChannelVideos(c.env, { force: true, limit: 30 }));
  } catch (e) {
    throw new ApiError(502, 'YOUTUBE_UNAVAILABLE', 'YouTube didn’t answer — try again in a minute');
  }
});
