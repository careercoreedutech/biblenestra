// PACKAGE F — view counting endpoints (rules in lib/videoViews.js).
//   POST /posts/:id/video-view   { watchedMs }  → { counted, reason?, plays, viewers }   (a video really played)
//   POST /posts/views            { ids: [...] } → { counted, views: { [postId]: total } } (post cards seen in a feed)
import { Hono } from 'hono';
import { body, uuidParam, bad, notFound } from '../lib/http.js';
import { recordVideoPlay, recordPostViews, clientIp, viewCountsShape } from '../lib/videoViews.js';
import { one } from '../lib/db.js';

const views = new Hono();

views.post('/posts/:id/video-view', async (c) => {
  const me = c.get('user');
  const b = await body(c).catch(() => ({}));
  const watchedMs = Number(b.watchedMs);
  if (!Number.isFinite(watchedMs) || watchedMs < 0 || watchedMs > 24 * 3600 * 1000) throw bad('watchedMs must be a number of milliseconds', 'BAD_WATCHED');
  const r = await recordVideoPlay(c.env, { postId: uuidParam(c), userId: me.id, watchedMs, ip: clientIp(c) });
  return c.json(r);
});

views.post('/posts/views', async (c) => {
  const me = c.get('user');
  const b = await body(c).catch(() => ({}));
  const r = await recordPostViews(c.env, { ids: b.ids, userId: me.id, ip: clientIp(c) });
  return c.json(r);
});

// GET /posts/:id/counts — video plays, unique viewers and post views (overlay + post card numbers)
views.get('/posts/:id/counts', async (c) => {
  const row = await one(c.env, 'SELECT video_plays_count, video_viewers_count, views_count FROM posts WHERE id = $1 AND NOT removed', [uuidParam(c)]);
  if (!row) throw notFound('Post not found');
  return c.json(viewCountsShape(row));
});

export default views;
