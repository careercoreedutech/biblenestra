// Social (round 3): person profiles' posts, comment likes (+ in-app notification), who-reacted lists,
// and the profile image rules used by PUT /me (avatar / banner must be images this user uploaded).
import { Hono } from 'hono';
import { one, q } from '../lib/db.js';
import { bad, decodeCursor, encodeCursor, notFound, uuidParam } from '../lib/http.js';
import { POST_SELECT, mediaUrl, postShape, userJson } from '../lib/shape.js';
import { sendNotification } from '../lib/push.js';

const r = new Hono();
const origin = (c) => new URL(c.req.url).origin;

// Either direction of a block between $1 (me) and the given column
const NOT_BLOCKED = (col) => `NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = ${col}) OR (b.blocker_id = ${col} AND b.blocked_id = $1))`;

const snippet = (t, n = 60) => {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

/**
 * Validate a profile image (avatarUrl / bannerUrl) sent to PUT /me. Accepts the upload key
 * (`img/<my id>/<uuid>.<ext>`) or the URL POST /uploads/image returned for it. Anything else — another
 * user's image, an external URL, a path trick — is rejected. → full media URL to store, or null to clear.
 * `current` (the stored value) is accepted unchanged so clients can resend it.
 */
export async function profileImage(c, value, current, field) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 500) throw bad(`${field} must be an uploaded image`, 'BAD_IMAGE');
  if (current && value === current) return current;
  const me = c.get('user');
  const re = new RegExp(`(?:^|/)(img/${me.id}/[0-9a-f-]{36}\\.(?:jpg|png|webp|heic|heif))$`, 'i');
  const m = value.match(re);
  if (!m) throw bad(`${field}: upload the image with POST /uploads/image first`, 'BAD_IMAGE');
  const key = m[1];
  if (value !== key) {
    // A URL: must point at our media base, with nothing else in front of the key
    const base = mediaUrl(c.env, origin(c), '');
    if (value !== base + key) throw bad(`${field}: upload the image with POST /uploads/image first`, 'BAD_IMAGE');
  }
  if (c.env.MEDIA && typeof c.env.MEDIA.head === 'function') {
    const obj = await c.env.MEDIA.head(key);
    if (!obj) throw bad(`${field}: that upload was not found`, 'BAD_IMAGE');
  }
  return mediaUrl(c.env, origin(c), key);
}

// GET /users/:id/posts — a person's posts and videos (newest first, paginated like /feed)
r.get('/users/:id/posts', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 18, 1), 50);
  const type = c.req.query('type') || 'all';
  if (!['all', 'videos', 'posts'].includes(type)) throw bad('type must be all, videos or posts');
  const owner = await one(c.env, `SELECT id FROM users u WHERE u.id = $2 AND NOT u.banned AND ${NOT_BLOCKED('u.id')}`, [me.id, id]);
  if (!owner) throw notFound('User not found');
  const args = [me.id, id];
  let w = `p.author_id = $2 AND NOT p.removed AND NOT u.banned
    AND NOT EXISTS (SELECT 1 FROM hidden_posts h WHERE h.post_id = p.id AND h.user_id = $1)
    AND (p.video_uid IS NULL OR p.video_status = 'ready' OR p.author_id = $1)`;
  if (type === 'videos') w += ' AND (p.video_uid IS NOT NULL OR p.video_url IS NOT NULL)';
  if (type === 'posts') w += ' AND p.video_uid IS NULL AND p.video_url IS NULL';
  const cur = decodeCursor(c.req.query('cursor'));
  if (cur) { args.push(cur.ts, cur.id); w += ` AND (p.created_at, p.id) < ($${args.length - 1}::timestamptz, $${args.length}::uuid)`; }
  args.push(limit + 1);
  const rows = await q(c.env, `${POST_SELECT} WHERE ${w} ORDER BY p.created_at DESC, p.id DESC LIMIT $${args.length}`, args);
  const more = rows.length > limit;
  const items = rows.slice(0, limit);
  return c.json({ items: items.map((x) => postShape(x, me, c.env, origin(c))), nextCursor: more ? encodeCursor(items[items.length - 1]) : null });
});

async function loadComment(c, id) {
  const me = c.get('user');
  const row = await one(c.env, `SELECT cm.id, cm.post_id, cm.author_id, cm.body FROM comments cm
      JOIN posts p ON p.id = cm.post_id JOIN users u ON u.id = cm.author_id
      WHERE cm.id = $2 AND NOT p.removed AND NOT u.banned AND ${NOT_BLOCKED('cm.author_id')}`, [me.id, id]);
  if (!row) throw notFound('Comment not found');
  return row;
}

// POST /comments/:id/like — toggle my like → { liked, likes }. Liking someone else's comment notifies them.
r.post('/comments/:id/like', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const cm = await loadComment(c, id);
  const del = await q(c.env, 'DELETE FROM comment_likes WHERE comment_id = $1 AND user_id = $2 RETURNING 1', [id, me.id]);
  let liked = false;
  if (!del.length) {
    const ins = await q(c.env, 'INSERT INTO comment_likes (comment_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1', [id, me.id]);
    liked = true;
    if (ins.length && cm.author_id !== me.id) {
      // One notification per liker per comment (re-liking after an unlike doesn't notify again)
      const seen = await one(c.env, `SELECT 1 FROM notifications WHERE user_id = $1 AND kind = 'comment_like'
          AND data->>'commentId' = $2 AND data->>'fromId' = $3 LIMIT 1`, [cm.author_id, id, me.id]);
      if (!seen) {
        await sendNotification(c, {
          userId: cm.author_id,
          kind: 'comment_like',
          title: `${me.display_name} liked your comment`,
          body: `${me.display_name} liked your comment: “${snippet(cm.body)}”`,
          data: { type: 'comment_like', postId: cm.post_id, commentId: id, fromId: me.id, fromName: me.display_name },
        });
      }
    }
  }
  const n = await one(c.env, 'SELECT count(*)::int AS n FROM comment_likes WHERE comment_id = $1', [id]);
  return c.json({ liked, likes: n.n });
});

// GET /comments/:id/likes — who liked a comment
r.get('/comments/:id/likes', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  await loadComment(c, id);
  const rows = await q(c.env, `SELECT ${userJson('u')} AS u, l.created_at FROM comment_likes l JOIN users u ON u.id = l.user_id
      WHERE l.comment_id = $2 AND NOT u.banned AND ${NOT_BLOCKED('u.id')} ORDER BY l.created_at DESC LIMIT 500`, [me.id, id]);
  return c.json({ items: rows.map((x) => ({ ...x.u, isMe: x.u.id === me.id, likedAt: new Date(x.created_at).toISOString() })), count: rows.length });
});

// GET /posts/:id/reactions — who reacted to a post (likes / amen / love …)
r.get('/posts/:id/reactions', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const post = await one(c.env, 'SELECT id FROM posts WHERE id = $1 AND NOT removed', [id]);
  if (!post) throw notFound('Post not found');
  const rows = await q(c.env, `SELECT ${userJson('u')} AS u, r.reaction FROM reactions r JOIN users u ON u.id = r.user_id
      WHERE r.post_id = $2 AND NOT u.banned AND ${NOT_BLOCKED('u.id')} ORDER BY u.display_name LIMIT 500`, [me.id, id]);
  return c.json({ items: rows.map((x) => ({ ...x.u, isMe: x.u.id === me.id, reaction: x.reaction })) });
});

// GET /users/:id/followers | /users/:id/following — people lists (tap → profile)
for (const [path, join, match] of [['followers', 'f.follower_id', 'f.followee_id'], ['following', 'f.followee_id', 'f.follower_id']]) {
  r.get(`/users/:id/${path}`, async (c) => {
    const me = c.get('user');
    const id = uuidParam(c);
    const owner = await one(c.env, `SELECT id FROM users u WHERE u.id = $2 AND NOT u.banned AND ${NOT_BLOCKED('u.id')}`, [me.id, id]);
    if (!owner) throw notFound('User not found');
    const rows = await q(c.env, `SELECT ${userJson('u')} AS u,
        EXISTS (SELECT 1 FROM follows x WHERE x.follower_id = $1 AND x.followee_id = u.id) AS is_following
      FROM follows f JOIN users u ON u.id = ${join}
      WHERE ${match} = $2 AND NOT u.banned AND ${NOT_BLOCKED('u.id')}
      ORDER BY f.created_at DESC LIMIT 500`, [me.id, id]);
    return c.json({ items: rows.map((x) => ({ ...x.u, isFollowing: x.is_following, isMe: x.u.id === me.id })) });
  });
}

export default r;
