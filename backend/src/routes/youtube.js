// Public YouTube "Watch" endpoints: curated channels (added by admins) + their recent videos (public RSS, cached 15 min).
import { Hono } from 'hono';
import { one, q } from '../lib/db.js';
import { ApiError, isUuid, notFound } from '../lib/http.js';
import { CHANNEL_ID_RE, channelUrl, channelVideos, liveEmbedUrl } from '../lib/youtube.js';

export const channelShape = (row) => ({
  id: row.id,
  channelId: row.channel_id,
  title: row.title,
  handle: row.handle,
  avatarUrl: row.avatar_url,
  category: row.category,
  featured: row.featured,
  sortOrder: row.sort_order,
  active: row.active,
  url: channelUrl(row),
  liveEmbedUrl: liveEmbedUrl(row.channel_id),
  createdAt: new Date(row.created_at).toISOString(),
});

const r = new Hono();

r.get('/youtube/channels', async (c) => {
  const rows = await q(c.env, 'SELECT * FROM youtube_channels WHERE active ORDER BY featured DESC, sort_order, created_at LIMIT 200');
  c.header('Cache-Control', 'public, max-age=60');
  return c.json({ items: rows.map(channelShape) });
});

r.get('/youtube/channels/:id/videos', async (c) => {
  const id = c.req.param('id');
  let row = null;
  if (isUuid(id)) row = await one(c.env, 'SELECT * FROM youtube_channels WHERE id = $1 AND active', [id]);
  else if (CHANNEL_ID_RE.test(id)) row = await one(c.env, 'SELECT * FROM youtube_channels WHERE channel_id = $1 AND active', [id]);
  if (!row) throw notFound('Channel not found');
  let feed;
  try {
    feed = await channelVideos(c.env, row.channel_id);
  } catch (e) {
    throw new ApiError(502, 'YOUTUBE_UNAVAILABLE', 'YouTube didn’t answer — try again in a minute');
  }
  c.header('Cache-Control', 'public, max-age=300');
  return c.json({ channel: channelShape(row), liveEmbedUrl: liveEmbedUrl(row.channel_id), videos: feed.videos });
});

export default r;
