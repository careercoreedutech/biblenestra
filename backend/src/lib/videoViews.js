// PACKAGE F — view counting. Two different numbers:
//   • video plays / unique viewers → posts.video_plays_count, posts.video_viewers_count (video_views rows: one per
//     viewer per video). A play counts only after the viewer really watched for video_min_watch_ms, a viewer
//     gets at most one counted play per video_view_cooldown_min, the author's own plays never count, and every
//     IP is rate-limited. Same viewer again after the cooldown → plays +1, unique viewers unchanged.
//   • post views (impressions) → posts.views_count (post_view_log rows), deduped per viewer per post with its own
//     cooldown, so a feed that scrolls past a card 20 times counts once per cooldown window.
// Every knob is an admin setting (registerConfig), nothing is hard-coded.
import { one, q } from './db.js';
import { ApiError, notFound } from './http.js';
import { registerConfig, getConfig, rateLimit } from './wallet.js';

const posInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
registerConfig('video_min_watch_ms', 2500, (v) => posInt(v, 500, 30000));
registerConfig('video_view_cooldown_min', 30, (v) => posInt(v, 1, 1440));
registerConfig('post_view_cooldown_min', 10, (v) => posInt(v, 1, 1440));
registerConfig('view_ip_per_min', 120, (v) => posInt(v, 10, 100000));

/** Viewer key: signed-in users only (the app has no guest device id yet). */
export const viewerKeyOf = (userId) => `u:${userId}`;

export function clientIp(c) {
  const h = (name) => (c.req.header(name) || '').split(',')[0].trim();
  return h('cf-connecting-ip') || h('x-forwarded-for') || h('x-real-ip') || 'unknown';
}

async function ipAllowed(env, ip, cfg) {
  try {
    await rateLimit(env, `view:ip:${ip}`, cfg.view_ip_per_min, 60);
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.status === 429) return false;
    throw e;
  }
}

async function videoCounts(env, postId) {
  return one(env, 'SELECT video_plays_count AS plays, video_viewers_count AS viewers, views_count AS views FROM posts WHERE id = $1', [postId]);
}

/**
 * One video play report from the app (sent once the player has really run for watchedMs).
 * Returns { counted, reason?, plays, viewers } — reason is set when nothing was counted.
 */
export async function recordVideoPlay(env, { postId, userId, watchedMs, ip }) {
  const cfg = await getConfig(env);
  const post = await one(env, 'SELECT id, author_id, video_url, video_uid, embed FROM posts WHERE id = $1 AND NOT removed', [postId]);
  if (!post) throw notFound('Post not found');
  const now = await videoCounts(env, postId);
  const skip = (reason) => ({ counted: false, reason, plays: now.plays, viewers: now.viewers });
  if (!(Number(watchedMs) >= cfg.video_min_watch_ms)) return skip('too_short');
  if (!post.video_uid && !post.video_url && !post.embed) return skip('not_video'); // POST FROM A LINK plays count too
  if (String(post.author_id) === String(userId)) return skip('own_video');
  if (!(await ipAllowed(env, ip, cfg))) return skip('rate_limited');

  const key = viewerKeyOf(userId);
  // Insert the first play, or bump an existing row only once its cooldown has run out. `fresh` = first time ever.
  const hit = await one(env, `INSERT INTO video_views (post_id, viewer_key, plays, last_counted_at) VALUES ($1, $2, 1, now())
      ON CONFLICT (post_id, viewer_key) DO UPDATE SET plays = video_views.plays + 1, last_counted_at = now()
        WHERE video_views.last_counted_at <= now() - make_interval(mins => $3::int)
      RETURNING (xmax = 0) AS fresh`, [postId, key, cfg.video_view_cooldown_min]);
  if (!hit) return skip('cooldown');
  const row = await one(env, `UPDATE posts SET video_plays_count = video_plays_count + 1,
      video_viewers_count = video_viewers_count + $2 WHERE id = $1
    RETURNING video_plays_count AS plays, video_viewers_count AS viewers`, [postId, hit.fresh ? 1 : 0]);
  return { counted: true, plays: row.plays, viewers: row.viewers };
}

/**
 * Post impressions: ids of posts the viewer just saw in a feed. Returns { counted, views: { [id]: total } } for the
 * posts that were counted; posts already counted inside the cooldown are left out.
 */
export async function recordPostViews(env, { ids, userId, ip }) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter((x) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x)))].slice(0, 50);
  if (!list.length) return { counted: 0, views: {} };
  const cfg = await getConfig(env);
  if (!(await ipAllowed(env, ip, cfg))) return { counted: 0, views: {}, reason: 'rate_limited' };
  const rows = await q(env, `WITH cand AS (
        SELECT p.id FROM posts p WHERE p.id = ANY($1::uuid[]) AND NOT p.removed AND p.author_id <> $2
      ),
      seen AS (
        INSERT INTO post_view_log (post_id, viewer_key, hits, last_counted_at)
        SELECT id, $3, 1, now() FROM cand
        ON CONFLICT (post_id, viewer_key) DO UPDATE SET hits = post_view_log.hits + 1, last_counted_at = now()
          WHERE post_view_log.last_counted_at <= now() - make_interval(mins => $4::int)
        RETURNING post_id
      )
      UPDATE posts p SET views_count = p.views_count + 1 FROM seen s WHERE p.id = s.post_id
      RETURNING p.id, p.views_count`, [list, userId, viewerKeyOf(userId), cfg.post_view_cooldown_min]);
  const views = {};
  for (const r of rows) views[r.id] = r.views_count;
  return { counted: rows.length, views };
}

/** Shape the counts for the app: plays, unique viewers and post views (all raw integers; the app formats them). */
export const viewCountsShape = (row) => ({
  videoPlays: Number(row.video_plays_count || 0),
  videoViewers: Number(row.video_viewers_count || 0),
  postViews: Number(row.views_count || 0),
});
