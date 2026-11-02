import { Hono } from 'hono';
import { one, q } from '../lib/db.js';
import { ApiError, bad, body, decodeCursor, encodeCursor, forbidden, int, isUuid, notFound, str, uuidParam } from '../lib/http.js';
import { POST_SELECT, postShape, userJson } from '../lib/shape.js';
import { RULES } from '../lib/rules.js';

const r = new Hono();
const REACTIONS = ['like', 'amen', 'love', 'praise', 'care'];
const origin = (c) => new URL(c.req.url).origin;

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
    forYou: '',
    following: '(p.author_id = $1 OR p.author_id IN (SELECT followee_id FROM follows WHERE follower_id = $1))',
    communities: "u.kind IN ('church','community','channel')",
    events: `p.kind IN (${RULES.eventKinds.map((k) => `'${k}'`).join(',')})`,
  }[filter];
  if (where === undefined) throw bad('Unknown filter');
  return c.json(await page(c, where, [], limit));
});

r.get('/videos', async (c) => {
  const limit = Math.min(Number(c.req.query('limit')) || 10, 30);
  return c.json(await page(c, '(p.video_uid IS NOT NULL OR p.video_url IS NOT NULL)', [], limit));
});

r.get('/posts/:id', async (c) => c.json(postShape(await loadPost(c, uuidParam(c)), c.get('user'), c.env, origin(c))));

r.post('/posts', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const kind = str(b.kind || 'Reflection', { max: 30, field: 'kind' });
  const text = str(b.text, { max: 5000, field: 'Text' });
  const images = Array.isArray(b.images) ? b.images.slice(0, 10) : [];
  const videoUid = b.videoUid ? str(b.videoUid, { max: 64, field: 'videoUid' }) : null;
  if (!text && !images.length && !videoUid) throw bad('Write something, or add a photo or video', 'EMPTY_POST');
  for (const m of images) {
    if (!m || typeof m.key !== 'string' || !m.key.startsWith(`img/${me.id}/`)) throw bad('Upload images with POST /uploads/image first', 'BAD_IMAGE');
  }
  let video = null;
  if (videoUid) {
    video = await one(c.env, 'SELECT * FROM video_uploads WHERE uid = $1 AND user_id = $2', [videoUid, me.id]);
    if (!video) throw bad('Unknown video — upload it with POST /uploads/video first', 'BAD_VIDEO');
  }
  const p = b.passage && typeof b.passage === 'object' ? b.passage : null;
  if (p && !/^[1-3A-Z]{3}$/.test(String(p.bookId || ''))) throw bad('passage.bookId must be a book id like JHN');
  const row = await one(c.env, `INSERT INTO posts (author_id, kind, body, passage_book, passage_ch, passage_verse, theme, category, video_uid, video_status, video_duration, video_url, video_thumb)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`, [
    me.id, kind, text,
    p ? p.bookId : null, p ? int(p.chapter, { min: 1, max: 150, field: 'chapter' }) : null, p && p.verse ? int(p.verse, { min: 1, max: 176, field: 'verse' }) : null,
    str(b.theme, { max: 30, optional: true }), str(b.category, { max: 40, optional: true }),
    videoUid, video ? (video.status === 'ready' ? 'ready' : 'uploading') : null, video ? video.duration : null,
    video ? video.video_key : null, video ? video.thumb_key : null,
  ]);
  for (let i = 0; i < images.length; i++) {
    const m = images[i];
    await q(c.env, 'INSERT INTO post_media (post_id, position, r2_key, width, height) VALUES ($1,$2,$3,$4,$5)',
      [row.id, i, m.key, Number.isFinite(m.width) ? Math.round(m.width) : null, Number.isFinite(m.height) ? Math.round(m.height) : null]);
  }
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

r.post('/posts/:id/view', async (c) => {
  const row = await one(c.env, 'UPDATE posts SET views_count = views_count + 1 WHERE id = $1 AND NOT removed RETURNING views_count', [uuidParam(c)]);
  if (!row) throw notFound('Post not found');
  return c.json({ views: row.views_count });
});

const commentShape = (x, me) => ({ id: x.id, postId: x.post_id, parentId: x.parent_id, author: x.author, text: x.body, createdAt: new Date(x.created_at).toISOString(), mine: x.author_id === me.id });

r.get('/posts/:id/comments', async (c) => {
  const me = c.get('user');
  const rows = await q(c.env, `SELECT c.*, ${userJson('u')} AS author FROM comments c JOIN users u ON u.id = c.author_id
      WHERE c.post_id = $1 AND NOT u.banned ORDER BY c.created_at LIMIT 500`, [uuidParam(c)]);
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
