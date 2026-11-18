// YOUTUBE LIVE & COMMENTS
//   youtubePublic  — GET /youtube/live (what's live / upcoming now), GET /youtube/videos/:videoId (watch-screen info)
//   youtubeComments — Bible Nestra's own comment thread per YouTube video (signed-in users; mounted after requireUser)
//   adminYouTubeLive — /admin/api/youtube/live (status, detections, log), "Check now", manual "Send LIVE NOW"
//                      (no API key needed) and "Mark as ended" (admins only)
import { Hono } from 'hono';
import { one, q } from '../lib/db.js';
import { ApiError, bad, body, forbidden, notFound, str, uuidParam } from '../lib/http.js';
import { VIDEO_ID_RE, videoEmbedUrl } from '../lib/youtube.js';
import { announceLive, hasApiKey, liveShape, runYouTubeLiveCheck, videoIdFromLink, YOUTUBE_LIVE_ADMIN_SCRIPT } from '../lib/youtubeLive.js';
import { audit, registerAdminScript, requireAdmin } from './admin.js';

registerAdminScript(YOUTUBE_LIVE_ADMIN_SCRIPT);

const videoParam = (c) => {
  const v = c.req.param('videoId');
  if (!VIDEO_ID_RE.test(v || '')) throw notFound('Video not found');
  return v;
};

// ---------- public ----------
export const youtubePublic = new Hono();

youtubePublic.get('/youtube/live', async (c) => {
  const rows = await q(c.env, `SELECT l.*, ch.avatar_url FROM youtube_live l
      LEFT JOIN youtube_channels ch ON ch.channel_id = l.channel_id
    WHERE (l.status = 'live' OR (l.status = 'upcoming' AND l.scheduled_start > now() - interval '2 hours' AND l.scheduled_start < now() + interval '7 days'))
      AND (ch.id IS NULL OR ch.active)
    ORDER BY (l.status = 'live') DESC, COALESCE(l.actual_start, l.scheduled_start) LIMIT 20`);
  c.header('Cache-Control', 'public, max-age=30');
  return c.json({ items: rows.map((r) => ({ ...liveShape(r), channelAvatar: r.avatar_url || null })) });
});

youtubePublic.get('/youtube/videos/:videoId', async (c) => {
  const videoId = videoParam(c);
  const r = await one(c.env, `SELECT l.*, ch.avatar_url, ch.title AS ch_title FROM youtube_live l
      LEFT JOIN youtube_channels ch ON ch.channel_id = l.channel_id WHERE l.video_id = $1`, [videoId]);
  const count = await one(c.env, 'SELECT count(*)::int AS n FROM youtube_comments WHERE video_id = $1', [videoId]);
  c.header('Cache-Control', 'public, max-age=15');
  return c.json({
    videoId,
    embedUrl: videoEmbedUrl(videoId),
    watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
    broadcast: r ? { ...liveShape(r), channelAvatar: r.avatar_url || null } : null,
    live: !!(r && r.status === 'live'),
    commentCount: count ? count.n : 0,
  });
});

// ---------- comments (signed in) ----------
export const youtubeComments = new Hono();
const PAGE = 30;
const PER_MINUTE = 8;
const MIN_GAP_S = 2;

const commentShape = (r, me) => ({
  id: r.id,
  videoId: r.video_id,
  parentId: r.parent_id,
  text: r.body,
  likes: r.likes_count,
  likedByMe: !!r.liked,
  mine: r.user_id === me.id,
  author: { id: r.user_id, displayName: r.display_name, handle: r.handle, avatarUrl: r.avatar_url, verified: !!r.verified },
  createdAt: new Date(r.created_at).toISOString(),
});
const SELECT = (extraWhere) => `SELECT cm.*, u.display_name, u.handle, u.avatar_url, u.verified,
    EXISTS (SELECT 1 FROM youtube_comment_likes l WHERE l.comment_id = cm.id AND l.user_id = $1) AS liked
  FROM youtube_comments cm JOIN users u ON u.id = cm.user_id WHERE NOT u.banned AND ${extraWhere}`;

youtubeComments.get('/youtube/videos/:videoId/comments', async (c) => {
  const me = c.get('user');
  const videoId = videoParam(c);
  const oldest = c.req.query('sort') === 'oldest';
  const params = [me.id, videoId];
  let where = 'cm.video_id = $2 AND cm.parent_id IS NULL';
  const cur = c.req.query('cursor');
  if (cur) {
    let ts, id;
    try { [ts, id] = atob(cur).split('|'); } catch (e) { /* ignore */ }
    if (ts && !Number.isNaN(Date.parse(ts)) && /^[0-9a-f-]{36}$/i.test(id || '')) {
      params.push(ts, id);
      where += ` AND (cm.created_at, cm.id) ${oldest ? '>' : '<'} ($3::timestamptz, $4::uuid)`;
    }
  }
  const rows = await q(c.env, `${SELECT(where)} ORDER BY cm.created_at ${oldest ? 'ASC' : 'DESC'}, cm.id ${oldest ? 'ASC' : 'DESC'} LIMIT ${PAGE + 1}`, params);
  const hasMore = rows.length > PAGE;
  const top = rows.slice(0, PAGE);
  const replies = top.length
    ? await q(c.env, `${SELECT('cm.parent_id = ANY($2::uuid[])')} ORDER BY cm.created_at, cm.id LIMIT 600`, [me.id, top.map((r) => r.id)])
    : [];
  const byParent = new Map();
  for (const r of replies) { if (!byParent.has(r.parent_id)) byParent.set(r.parent_id, []); byParent.get(r.parent_id).push(commentShape(r, me)); }
  const total = await one(c.env, 'SELECT count(*)::int AS n FROM youtube_comments WHERE video_id = $1', [videoId]);
  const last = top[top.length - 1];
  return c.json({
    items: top.map((r) => ({ ...commentShape(r, me), replies: byParent.get(r.id) || [] })),
    total: total ? total.n : 0,
    cursor: hasMore && last ? btoa(`${new Date(last.created_at).toISOString()}|${last.id}`) : null,
    hasMore,
  });
});

youtubeComments.post('/youtube/videos/:videoId/comments', async (c) => {
  const me = c.get('user');
  const videoId = videoParam(c);
  const b = await body(c);
  const text = str(b.text, { min: 1, max: 1000, field: 'Comment' });
  let parentId = null;
  if (b.parentId) {
    if (!/^[0-9a-f-]{36}$/i.test(String(b.parentId))) throw bad('Unknown comment to reply to');
    const parent = await one(c.env, 'SELECT id, parent_id, video_id FROM youtube_comments WHERE id = $1', [b.parentId]);
    if (!parent || parent.video_id !== videoId) throw notFound('That comment was deleted');
    parentId = parent.parent_id || parent.id; // one level: replies to a reply join the same thread
  }
  const rate = await one(c.env, `SELECT count(*)::int AS n, max(created_at) AS last FROM youtube_comments
    WHERE user_id = $1 AND created_at > now() - interval '60 seconds'`, [me.id]);
  if (rate && (rate.n >= PER_MINUTE || (rate.last && Date.now() - new Date(rate.last).getTime() < MIN_GAP_S * 1000))) {
    throw new ApiError(429, 'SLOW_DOWN', 'You’re commenting very fast — wait a few seconds and try again');
  }
  const row = await one(c.env, 'INSERT INTO youtube_comments (video_id, user_id, parent_id, body) VALUES ($1,$2,$3,$4) RETURNING *', [videoId, me.id, parentId, text]);
  return c.json({ ...commentShape({ ...row, display_name: me.display_name, handle: me.handle, avatar_url: me.avatar_url, verified: me.verified, liked: false }, me), replies: [] }, 201);
});

youtubeComments.post('/youtube/comments/:id/like', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const b = await c.req.json().catch(() => ({}));
  const cm = await one(c.env, 'SELECT id FROM youtube_comments WHERE id = $1', [id]);
  if (!cm) throw notFound('That comment was deleted');
  const already = await one(c.env, 'SELECT 1 AS x FROM youtube_comment_likes WHERE comment_id = $1 AND user_id = $2', [id, me.id]);
  const want = b && b.liked !== undefined ? !!b.liked : !already;
  if (want && !already) {
    await q(c.env, `WITH ins AS (INSERT INTO youtube_comment_likes (comment_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING comment_id)
      UPDATE youtube_comments SET likes_count = likes_count + 1 WHERE id IN (SELECT comment_id FROM ins)`, [id, me.id]);
  } else if (!want && already) {
    await q(c.env, `WITH del AS (DELETE FROM youtube_comment_likes WHERE comment_id = $1 AND user_id = $2 RETURNING comment_id)
      UPDATE youtube_comments SET likes_count = GREATEST(likes_count - 1, 0) WHERE id IN (SELECT comment_id FROM del)`, [id, me.id]);
  }
  const row = await one(c.env, 'SELECT likes_count FROM youtube_comments WHERE id = $1', [id]);
  return c.json({ id, liked: want, likes: row ? row.likes_count : 0 });
});

youtubeComments.delete('/youtube/comments/:id', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const cm = await one(c.env, 'SELECT * FROM youtube_comments WHERE id = $1', [id]);
  if (!cm) throw notFound('That comment was already deleted');
  const admin = me.role === 'admin';
  if (cm.user_id !== me.id && !admin) throw forbidden('You can only delete your own comments');
  await q(c.env, 'DELETE FROM youtube_comments WHERE id = $1', [id]); // replies go with it (ON DELETE CASCADE)
  if (cm.user_id !== me.id) await audit(c.env, me, 'youtube_comment.delete', 'youtube_comment', id, { videoId: cm.video_id, text: String(cm.body).slice(0, 200) });
  return c.json({ ok: true });
});

youtubeComments.post('/youtube/comments/:id/report', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const b = await c.req.json().catch(() => ({}));
  const reason = str(b && b.reason, { max: 300, optional: true, field: 'reason' });
  const cm = await one(c.env, 'SELECT id, user_id FROM youtube_comments WHERE id = $1', [id]);
  if (!cm) throw notFound('That comment was deleted');
  if (cm.user_id === me.id) throw bad('You can’t report your own comment');
  const dupe = await one(c.env, `SELECT 1 AS x FROM reports WHERE reporter_id = $1 AND target_type = 'youtube_comment' AND target_id = $2`, [me.id, id]);
  if (!dupe) await q(c.env, `INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES ($1,'youtube_comment',$2,$3)`, [me.id, id, reason]);
  return c.json({ ok: true });
});

// ---------- admin ----------
export const adminYouTubeLive = new Hono();
adminYouTubeLive.use('/admin/api/youtube/live', requireAdmin);
adminYouTubeLive.use('/admin/api/youtube/live/*', requireAdmin);

adminYouTubeLive.get('/admin/api/youtube/live', async (c) => {
  const channels = await q(c.env, `SELECT ch.*,
      (SELECT row_to_json(l) FROM youtube_live l WHERE l.channel_id = ch.channel_id AND l.status IN ('live','upcoming')
        ORDER BY (l.status = 'live') DESC, l.scheduled_start LIMIT 1) AS live,
      (SELECT max(COALESCE(l.actual_start, l.scheduled_start)) FROM youtube_live l WHERE l.channel_id = ch.channel_id) AS last_broadcast
    FROM youtube_channels ch WHERE ch.active ORDER BY ch.featured DESC, ch.sort_order, ch.created_at`);
  const detections = await q(c.env, 'SELECT * FROM youtube_live ORDER BY detected_at DESC LIMIT 50');
  const runs = await q(c.env, 'SELECT * FROM youtube_live_runs ORDER BY ran_at DESC LIMIT 20');
  // quota estimate: first run reads every channel's ~15 feed videos once; afterwards only new uploads + tracked broadcasts
  const perRun = Math.max(1, Math.ceil((channels.length * 2 + 5) / 50));
  return c.json({
    apiKey: hasApiKey(c.env),
    quota: { perRun, perDay: perRun * 96, dailyFree: 10000 },
    channels: channels.map((ch) => {
      const live = ch.live ? (typeof ch.live === 'string' ? JSON.parse(ch.live) : ch.live) : null;
      return { id: ch.id, channelId: ch.channel_id, title: ch.title, avatarUrl: ch.avatar_url, live: live ? liveShape(live) : null, lastBroadcastAt: ch.last_broadcast ? new Date(ch.last_broadcast).toISOString() : null };
    }),
    detections: detections.map(liveShape),
    runs: runs.map((r) => ({ ranAt: new Date(r.ran_at).toISOString(), trigger: r.trigger, channels: r.channels, checked: r.checked, apiCalls: r.api_calls, live: r.live, notified: r.notified, error: r.error })),
  });
});

// Manual "LIVE NOW" (works without the YouTube API key): the admin picks an approved channel and pastes the
// live stream's link. Each live stream is announced once; a second send is refused.
adminYouTubeLive.post('/admin/api/youtube/live/manual', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const channel = await one(c.env, 'SELECT * FROM youtube_channels WHERE channel_id = $1 AND active', [String(b.channelId || '')]);
  if (!channel) throw bad('Choose one of the active channels (add channels in the YouTube channels tab)', 'UNKNOWN_CHANNEL');
  const videoId = videoIdFromLink(b.link);
  if (!videoId) throw bad('Paste the YouTube link of the live stream — for example https://youtube.com/live/… or https://youtu.be/…', 'BAD_LINK');
  const title = str(b.title, { max: 200, optional: true, field: 'Title' });
  const r = await announceLive(c.env, { channel, videoId, title });
  if (r.alreadySent) {
    const x = r.alreadySent;
    throw new ApiError(409, 'ALREADY_SENT', `This live stream was already announced (${x.recipients || 0} recipient${x.recipients === 1 ? '' : 's'}). Each live stream is announced only once.`);
  }
  await audit(c.env, me, 'youtube.live_manual', 'youtube_live', videoId, { channel: channel.title, recipients: r.recipients, pushed: r.pushed || 0 });
  const row = await one(c.env, 'SELECT * FROM youtube_live WHERE video_id = $1', [videoId]);
  return c.json({ ...liveShape(row), recipients: r.recipients, pushSent: r.pushed || 0 }, 201);
});

// The service is over: take it out of the app's "Live now" list.
adminYouTubeLive.post('/admin/api/youtube/live/:videoId/end', async (c) => {
  const me = c.get('user');
  const videoId = videoParam(c);
  const row = await one(c.env, `UPDATE youtube_live SET status = 'ended', actual_end = COALESCE(actual_end, now()), updated_at = now()
    WHERE video_id = $1 AND status <> 'ended' RETURNING *`, [videoId]);
  if (!row) throw notFound('That stream isn’t live or upcoming');
  await audit(c.env, me, 'youtube.live_end', 'youtube_live', videoId, { channel: row.channel_title });
  return c.json(liveShape(row));
});

adminYouTubeLive.post('/admin/api/youtube/live/check', async (c) => {
  const me = c.get('user');
  const r = await runYouTubeLiveCheck(c.env, { trigger: 'admin', force: true });
  await audit(c.env, me, 'youtube.live_check', 'youtube_live', null, { checked: r.checked, live: r.live, notified: r.notified, skipped: r.skipped || null });
  return c.json(r);
});
