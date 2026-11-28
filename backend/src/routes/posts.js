import { Hono } from 'hono';
import { one, q } from '../lib/db.js';
import { ApiError, bad, body, decodeCursor, encodeCursor, forbidden, int, isUuid, notFound, str, uuidParam } from '../lib/http.js';
import { POST_SELECT, postShape, userJson } from '../lib/shape.js';
import { RULES } from '../lib/rules.js';
import { designFromBody } from '../lib/postDesign.js';
import { buildEmbed, previewEmbed } from '../lib/postEmbeds.js'; // POST FROM A LINK
import { recordPostViews, clientIp } from '../lib/videoViews.js'; // PACKAGE F: deduped post views
import { feedRankingConfig, scoredPool, arrangeFeed, decodeFeedCursor, encodeFeedCursor, resumeIndex, tagPost } from '../lib/feedRanking.js'; // PERSONALISATION

const r = new Hono();
const REACTIONS = ['like', 'amen', 'love', 'praise', 'care'];
const origin = (c) => new URL(c.req.url).origin;

// PERSONALISATION: the ranked "For you" page. Scores are computed as of a snapshot time carried in the cursor, and
// the ordering is rebuilt from that snapshot on each page, so scrolling never repeats or reshuffles posts.
// Also used for the Reels list (videosOnly): same signals, video posts only.
async function forYouPage(c, limit, { videosOnly = false } = {}) {
  const me = c.get('user');
  const cfg = await feedRankingConfig(c.env);
  const prof = await one(c.env, 'SELECT interests, country, city, church FROM users WHERE id = $1', [me.id]);
  const cur = decodeFeedCursor(c.req.query('cursor'));
  const snap = cur ? cur.s : new Date().toISOString();
  const pool = await scoredPool(c.env, me.id, prof || {}, snap, cfg, { videosOnly });
  const ids = arrangeFeed(pool, { window: cfg.window, perAuthorCap: cfg.per_author_cap, explorePct: cfg.exploration_pct }).map((x) => x.id);
  const start = resumeIndex(ids, cur);
  const pageIds = ids.slice(start, start + limit);
  let items = [];
  if (pageIds.length) {
    const rows = await q(c.env, `${POST_SELECT} WHERE p.id = ANY($2::uuid[])`, [me.id, pageIds]);
    const byId = new Map(rows.map((x) => [x.id, x]));
    items = pageIds.map((id) => byId.get(id)).filter(Boolean).map((x) => postShape(x, me, c.env, origin(c)));
  }
  const more = start + limit < ids.length && pageIds.length > 0;
  return { items, nextCursor: more ? encodeFeedCursor({ s: snap, k: pageIds[pageIds.length - 1], i: start + limit }) : null };
}

async function loadPost(c, id) {
  const me = c.get('user');
  const row = await one(c.env, `${POST_SELECT} WHERE p.id = $2 AND NOT p.removed`, [me.id, id]);
  if (!row) throw notFound('Post not found');
  return row;
}

async function page(c, where, params, limit) {
  const me = c.get('user');
  const cur = decodeCursor(c.req.query('cursor'));
  const args = [me.id, ...params];
  let w = `NOT p.removed AND NOT u.banned AND NOT EXISTS (SELECT 1 FROM hidden_posts h WHERE h.post_id = p.id AND h.user_id = $1)
    AND (p.video_uid IS NULL OR p.video_status = 'ready' OR p.author_id = $1) ${where ? `AND ${where}` : ''}`;
  if (cur) { args.push(cur.ts, cur.id); w += ` AND (p.created_at, p.id) < ($${args.length - 1}::timestamptz, $${args.length}::uuid)`; }
  args.push(limit + 1);
  const rows = await q(c.env, `${POST_SELECT} WHERE ${w} ORDER BY p.created_at DESC, p.id DESC LIMIT $${args.length}`, args);
  const more = rows.length > limit;
  const items = rows.slice(0, limit);
  return { items: items.map((x) => postShape(x, me, c.env, origin(c))), nextCursor: more ? encodeCursor(items[items.length - 1]) : null };
}

r.get('/feed', async (c) => {
  const filter = c.req.query('filter') || 'forYou';
  const limit = Math.min(Number(c.req.query('limit')) || 20, 50);
  const where = {
    forYou: 'p.pinned_at IS NULL', // BROADCASTS: pinned posts are shown on top instead (below)
    following: '(p.author_id = $1 OR p.author_id IN (SELECT followee_id FROM follows WHERE follower_id = $1))',
    communities: "u.kind IN ('church','community','channel')",
    events: `p.kind IN (${RULES.eventKinds.map((k) => `'${k}'`).join(',')})`,
  }[filter];
  if (where === undefined) throw bad('Unknown filter');
  // PERSONALISATION: For you is ranked per viewer (lib/feedRanking.js); Following, communities and events stay newest first
  const res = filter === 'forYou' ? await forYouPage(c, limit) : await page(c, where, [], limit);
  // BROADCASTS: posts pinned by an admin (official account) sit on top of the first "For you" page
  if (filter === 'forYou' && !c.req.query('cursor')) {
    const me = c.get('user');
    const pinned = await q(c.env, `${POST_SELECT} WHERE p.pinned_at IS NOT NULL AND NOT p.removed AND NOT u.banned
      AND NOT EXISTS (SELECT 1 FROM hidden_posts h WHERE h.post_id = p.id AND h.user_id = $1) ORDER BY p.pinned_at DESC LIMIT 3`, [me.id]);
    res.items = [...pinned.map((x) => postShape(x, me, c.env, origin(c))), ...res.items];
  }
  return c.json(res);
});

// PERSONALISATION: Reels are ranked for the viewer (same signals as For you). ?order=newest keeps the old newest-first list.
r.get('/videos', async (c) => {
  const limit = Math.min(Number(c.req.query('limit')) || 10, 30);
  if (c.req.query('order') === 'newest') return c.json(await page(c, '(p.video_uid IS NOT NULL OR p.video_url IS NOT NULL OR p.embed IS NOT NULL)', [], limit));
  return c.json(await forYouPage(c, limit, { videosOnly: true }));
});

// POST FROM A LINK: validated preview for the composer (GET /posts/embed-preview?url=…). Registered before /posts/:id.
r.get('/posts/embed-preview', async (c) => c.json(await previewEmbed(c.env, c.req.query('url'))));

r.get('/posts/:id', async (c) => c.json(postShape(await loadPost(c, uuidParam(c)), c.get('user'), c.env, origin(c))));

r.post('/posts', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const kind = str(b.kind || 'Reflection', { max: 30, field: 'kind' });
  const text = str(b.text, { max: 5000, field: 'Text' });
  const images = Array.isArray(b.images) ? b.images.slice(0, 10) : [];
  const videoUid = b.videoUid ? str(b.videoUid, { max: 64, field: 'videoUid' }) : null;
  // POST FROM A LINK: a YouTube / Facebook embed (validated against the allow-list in lib/postEmbeds.js)
  const embed = b.embed != null ? await buildEmbed(c.env, b.embed) : null;
  if (embed && (images.length || videoUid)) throw bad('A video link cannot be combined with photos or an upload', 'BAD_EMBED');
  if (!text && !images.length && !videoUid && !embed) throw bad('Write something, or add a photo or video', 'EMPTY_POST');
  for (const m of images) {
    if (!m || typeof m.key !== 'string' || !m.key.startsWith(`img/${me.id}/`)) throw bad('Upload images with POST /uploads/image first', 'BAD_IMAGE');
  }
  let video = null;
  if (videoUid) {
    video = await one(c.env, 'SELECT * FROM video_uploads WHERE uid = $1 AND user_id = $2', [videoUid, me.id]);
    if (!video) throw bad('Unknown video — upload it with POST /uploads/video first', 'BAD_VIDEO');
    // FEED VIDEO: a retried publish (the app lost the first response) returns the post already made — never a duplicate
    const existing = await one(c.env, 'SELECT id, removed FROM posts WHERE video_uid = $1 AND author_id = $2', [videoUid, me.id]);
    if (existing && !existing.removed) return c.json(postShape(await loadPost(c, existing.id), me, c.env, origin(c)), 200);
    if (existing) throw bad('That video was already posted and deleted — upload it again', 'VIDEO_USED');
    if (video.status === 'abandoned') throw bad('That upload never finished — upload the video again', 'UPLOAD_ABANDONED');
  }
  const p = b.passage && typeof b.passage === 'object' ? b.passage : null;
  if (p && !/^[1-3A-Z]{3}$/.test(String(p.bookId || ''))) throw bad('passage.bookId must be a book id like JHN');
  // Image-style text card design (allow-listed); photo / video posts never carry one
  const theme = images.length || videoUid || embed ? null : designFromBody(b, text);
  const row = await one(c.env, `INSERT INTO posts (author_id, kind, body, passage_book, passage_ch, passage_verse, theme, category, video_uid, video_status, video_duration, video_url, video_thumb, video_codec, video_faststart, video_width, video_height, embed)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb) RETURNING id`, [
    me.id, kind, text,
    p ? p.bookId : null, p ? int(p.chapter, { min: 1, max: 150, field: 'chapter' }) : null, p && p.verse ? int(p.verse, { min: 1, max: 176, field: 'verse' }) : null,
    theme, str(b.category, { max: 40, optional: true }),
    videoUid, video ? (video.status === 'ready' ? 'ready' : 'uploading') : null, video ? video.duration : null,
    video ? video.video_key : null, video ? video.thumb_key : null,
    video ? video.codec || null : null, video && video.faststart != null ? video.faststart : null, video ? video.width : null, video ? video.height : null,
    embed ? JSON.stringify(embed) : null,
  ]);
  for (let i = 0; i < images.length; i++) {
    const m = images[i];
    await q(c.env, 'INSERT INTO post_media (post_id, position, r2_key, width, height) VALUES ($1,$2,$3,$4,$5)',
      [row.id, i, m.key, Number.isFinite(m.width) ? Math.round(m.width) : null, Number.isFinite(m.height) ? Math.round(m.height) : null]);
  }
  // PERSONALISATION: topics for the For you ranking (cheap rules; see lib/feedRanking.js tagPost)
  const topics = tagPost({ kind, body: text, category: b.category, passageBook: p ? p.bookId : null });
  if (topics.length) await q(c.env, 'UPDATE posts SET topics = $2 WHERE id = $1', [row.id, topics]);
  return c.json(postShape(await loadPost(c, row.id), me, c.env, origin(c)), 201);
});

r.delete('/posts/:id', async (c) => {
  const res = await q(c.env, 'UPDATE posts SET removed = true WHERE id = $1 AND author_id = $2 AND NOT removed RETURNING id', [uuidParam(c), c.get('user').id]);
  if (!res.length) throw forbidden('You can only delete your own posts');
  return c.json({ ok: true });
});

r.post('/posts/:id/react', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const b = await body(c);
  const reaction = b.reaction === null ? null : String(b.reaction || 'like');
  if (reaction !== null && !REACTIONS.includes(reaction)) throw bad('Unknown reaction');
  await loadPost(c, id);
  // Adjust the counter by the change (keeps counts that were imported/seeded without reaction rows)
  let row;
  if (reaction === null) {
    row = await one(c.env, `WITH del AS (DELETE FROM reactions WHERE post_id = $1 AND user_id = $2 RETURNING 1)
        UPDATE posts SET likes_count = GREATEST(likes_count - (SELECT count(*) FROM del), 0) WHERE id = $1 RETURNING likes_count`, [id, me.id]);
  } else {
    row = await one(c.env, `WITH prev AS (SELECT 1 FROM reactions WHERE post_id = $1 AND user_id = $2),
        up AS (INSERT INTO reactions (post_id, user_id, reaction) VALUES ($1,$2,$3)
               ON CONFLICT (post_id, user_id) DO UPDATE SET reaction = EXCLUDED.reaction RETURNING 1)
        UPDATE posts SET likes_count = likes_count + CASE WHEN EXISTS (SELECT 1 FROM prev) THEN 0 ELSE 1 END
        WHERE id = $1 RETURNING likes_count`, [id, me.id, reaction]);
  }
  return c.json({ myReaction: reaction, likes: row.likes_count });
});

r.post('/posts/:id/save', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  await loadPost(c, id);
  const del = await q(c.env, 'DELETE FROM saves WHERE post_id = $1 AND user_id = $2 RETURNING 1', [id, me.id]);
  if (!del.length) await q(c.env, 'INSERT INTO saves (post_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, me.id]);
  return c.json({ saved: !del.length });
});

r.post('/posts/:id/hide', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const b = await body(c).catch(() => ({}));
  const hide = b.hidden !== false;
  if (hide) await q(c.env, 'INSERT INTO hidden_posts (post_id, user_id) SELECT id, $2 FROM posts WHERE id = $1 ON CONFLICT DO NOTHING', [id, me.id]);
  else await q(c.env, 'DELETE FROM hidden_posts WHERE post_id = $1 AND user_id = $2', [id, me.id]);
  return c.json({ hidden: hide });
});

r.post('/posts/:id/share', async (c) => {
  const row = await one(c.env, 'UPDATE posts SET shares_count = shares_count + 1 WHERE id = $1 AND NOT removed RETURNING shares_count', [uuidParam(c)]);
  if (!row) throw notFound('Post not found');
  return c.json({ shares: row.shares_count });
});

// PACKAGE F: post views are deduped per viewer (lib/videoViews.js); this route used to add 1 on every call
r.post('/posts/:id/view', async (c) => {
  const me = c.get('user');
  const r2 = await recordPostViews(c.env, { ids: [uuidParam(c)], userId: me.id, ip: clientIp(c) });
  const id = uuidParam(c);
  const row = r2.views[id] != null ? { views_count: r2.views[id] } : await one(c.env, 'SELECT views_count FROM posts WHERE id = $1 AND NOT removed', [id]);
  if (!row) throw notFound('Post not found');
  return c.json({ views: row.views_count });
});

const commentShape = (x, me) => ({ id: x.id, postId: x.post_id, parentId: x.parent_id, author: x.author, text: x.body, createdAt: new Date(x.created_at).toISOString(), mine: x.author_id === me.id, likes: x.likes_count || 0, likedByMe: !!x.liked_by_me });

r.get('/posts/:id/comments', async (c) => {
  const me = c.get('user');
  const rows = await q(c.env, `SELECT c.*, ${userJson('u')} AS author,
      (SELECT count(*)::int FROM comment_likes l WHERE l.comment_id = c.id) AS likes_count,
      EXISTS (SELECT 1 FROM comment_likes l WHERE l.comment_id = c.id AND l.user_id = $2) AS liked_by_me
      FROM comments c JOIN users u ON u.id = c.author_id
      WHERE c.post_id = $1 AND NOT u.banned ORDER BY c.created_at LIMIT 500`, [uuidParam(c), me.id]);
  return c.json({ items: rows.map((x) => commentShape(x, me)) });
});

r.post('/posts/:id/comments', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const b = await body(c);
  const text = str(b.text, { min: 1, max: 2000, field: 'Comment' });
  const parentId = b.parentId || null;
  if (parentId && !isUuid(parentId)) throw bad('Bad parentId');
  await loadPost(c, id);
  const row = await one(c.env, `WITH ins AS (
      INSERT INTO comments (post_id, author_id, parent_id, body)
      SELECT $1, $2, $3, $4 WHERE $3::uuid IS NULL OR EXISTS (SELECT 1 FROM comments WHERE id = $3 AND post_id = $1)
      RETURNING *), bump AS (UPDATE posts SET comments_count = comments_count + 1 WHERE id = $1 AND EXISTS (SELECT 1 FROM ins))
    SELECT ins.*, ${userJson('u')} AS author FROM ins JOIN users u ON u.id = ins.author_id`, [id, me.id, parentId, text]);
  if (!row) throw bad('Reply target not found');
  return c.json(commentShape(row, me), 201);
});

r.delete('/comments/:id', async (c) => {
  const row = await one(c.env, `WITH del AS (DELETE FROM comments WHERE id = $1 AND author_id = $2 RETURNING post_id)
      UPDATE posts SET comments_count = GREATEST(comments_count - 1, 0) WHERE id IN (SELECT post_id FROM del) RETURNING id`, [uuidParam(c), c.get('user').id]);
  if (!row) throw forbidden('You can only delete your own comments');
  return c.json({ ok: true });
});

r.post('/reports', async (c) => {
  const b = await body(c);
  const type = str(b.targetType, { min: 1, max: 20, field: 'targetType' });
  if (!['post', 'comment', 'user', 'prayer', 'job'].includes(type)) throw bad('Unknown targetType');
  if (!isUuid(b.targetId)) throw bad('Bad targetId');
  await q(c.env, 'INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES ($1,$2,$3,$4)', [c.get('user').id, type, b.targetId, str(b.reason, { max: 500, optional: true })]);
  return c.json({ ok: true });
});

export default r;
