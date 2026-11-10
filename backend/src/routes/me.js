import { Hono } from 'hono';
import { one, q } from '../lib/db.js';
import { body, bad, notFound, str, uuidParam, today } from '../lib/http.js';
import { meShape, userJson } from '../lib/shape.js';
import { RULES } from '../lib/rules.js';
import { getUserStreak } from '../lib/rhythm.js';
import { profileImage } from './social.js';
import { notifyUser } from '../hub.js';

const r = new Hono();

export async function meResponse(env, userId) {
  const u = await one(env, 'SELECT * FROM users WHERE id = $1', [userId]);
  const userToday = today(u.tz_offset);
  const { streak, bestStreak, graceUsedThisWeek } = await getUserStreak(env, userId, u.tz_offset, u.best_streak);
  const s = await one(env, `SELECT
      (SELECT count(*)::int FROM ad_rewards WHERE user_id = $1 AND purpose = 'support' AND day = $2) AS support_today,
      (SELECT count(*)::int FROM follows WHERE followee_id = $1) AS followers,
      (SELECT count(*)::int FROM follows WHERE follower_id = $1) AS following`, [userId, userToday]);
  return meShape(u, {
    supportAdsToday: Math.min(RULES.supportAdsDaily, s.support_today), supportAdsDaily: RULES.supportAdsDaily,
    jobAdsNeeded: RULES.jobAdsNeeded, bidFee: RULES.bidFee, followers: s.followers, following: s.following,
    adsClientClaim: env.ADS_CLIENT_CLAIM === 'true',
    streak, bestStreak, graceUsedThisWeek,
  });
}

r.get('/me', async (c) => c.json(await meResponse(c.env, c.get('user').id)));

r.put('/me', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const fields = {
    display_name: b.displayName !== undefined ? str(b.displayName, { min: 1, max: 60, field: 'Name' }) : undefined,
    handle: b.handle !== undefined ? (str(b.handle, { max: 30, field: 'Handle', optional: true }) || '').replace(/^@/, '').toLowerCase() || null : undefined,
    // avatar / banner: only images this user uploaded (POST /uploads/image) — see social.js
    avatar_url: b.avatarUrl !== undefined ? await profileImage(c, b.avatarUrl, me.avatar_url, 'avatarUrl') : undefined,
    banner_url: b.bannerUrl !== undefined ? await profileImage(c, b.bannerUrl, me.banner_url, 'bannerUrl') : undefined,
    headline: b.headline !== undefined ? str(b.headline, { max: 120, optional: true }) : undefined,
    bio: b.bio !== undefined ? str(b.bio, { max: 1000, optional: true }) : undefined,
    church: b.church !== undefined ? str(b.church, { max: 120, optional: true }) : undefined,
    country: b.country !== undefined ? str(b.country, { max: 60, optional: true }) : undefined,
    translation: b.translation !== undefined ? str(b.translation, { max: 10, min: 1, field: 'Translation' }) : undefined,
  };
  if (fields.handle && !/^[a-z0-9._]{3,30}$/.test(fields.handle)) throw bad('Handles use 3–30 letters, numbers, dots or underscores', 'BAD_HANDLE');
  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  if (keys.length) {
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    try {
      await q(c.env, `UPDATE users SET ${sets}, updated_at = now() WHERE id = $1`, [me.id, ...keys.map((k) => fields[k])]);
    } catch (e) {
      if (/unique/i.test(e.message)) throw bad('That handle is taken', 'HANDLE_TAKEN');
      throw e;
    }
  }
  return c.json(await meResponse(c.env, me.id));
});

r.post('/me/push-token', async (c) => {
  const b = await body(c);
  const token = str(b.token, { min: 10, max: 300, field: 'token' });
  await q(c.env, `INSERT INTO push_tokens (user_id, token, platform) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [c.get('user').id, token, str(b.platform, { max: 20, optional: true })]);
  return c.json({ ok: true });
});

r.get('/users/:id', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const row = await one(c.env, `SELECT ${userJson('u')} AS u, u.bio, u.country, u.banner_url,
      (SELECT count(*)::int FROM posts p WHERE p.author_id = u.id AND NOT p.removed) AS posts_count,
      EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = $2 AND b.blocked_id = u.id) AS blocked_by_me,
      (SELECT count(*)::int FROM follows WHERE followee_id = u.id) AS followers,
      (SELECT count(*)::int FROM follows WHERE follower_id = u.id) AS following,
      EXISTS (SELECT 1 FROM follows WHERE follower_id = $2 AND followee_id = u.id) AS is_following
    FROM users u WHERE u.id = $1 AND NOT u.banned
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = u.id AND b.blocked_id = $2)`, [id, me.id]);
  if (!row) throw notFound('User not found');
  return c.json({ ...row.u, bio: row.bio, country: row.country, bannerUrl: row.banner_url, posts: row.posts_count, blocked: row.blocked_by_me,
    followers: row.followers, following: row.following, isFollowing: row.is_following, isMe: id === me.id });
});

r.post('/users/:id/follow', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  if (id === me.id) throw bad("You can't follow yourself");
  // Optional body { following: true|false } sets the state explicitly (safe to repeat);
  // without it the call toggles, as before.
  let want = null;
  try { const b = await c.req.json(); if (typeof b?.following === 'boolean') want = b.following; } catch { /* no body */ }
  if (want === false) {
    await q(c.env, 'DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2', [me.id, id]);
    return c.json({ following: false });
  }
  if (want === true) {
    const already = await one(c.env, 'SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2', [me.id, id]);
    if (already) return c.json({ following: true, isMutual: !!(await one(c.env, 'SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2', [id, me.id])) });
  } else {
    const del = await q(c.env, 'DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2 RETURNING 1', [me.id, id]);
    if (del.length) return c.json({ following: false });
  }
  const ins = await q(c.env, `INSERT INTO follows (follower_id, followee_id) SELECT $1, id FROM users WHERE id = $2 RETURNING 1`, [me.id, id]);
  if (!ins.length) throw notFound('User not found');

  // Check if target user also follows me (mutual follow)
  const isMutual = await one(c.env, `SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2`, [id, me.id]);

  const title = isMutual ? `${me.display_name} followed you back!` : `${me.display_name} started following you`;
  const bodyText = isMutual ? `You both follow each other. You can now chat!` : `Follow them back to unlock direct messaging.`;

  await q(c.env, `INSERT INTO notifications (user_id, kind, title, body, data) VALUES ($1, 'follow', $2, $3, $4::jsonb)`,
    [id, title, bodyText, JSON.stringify({ fromId: me.id, fromName: me.display_name, isMutual: !!isMutual })]
  );

  await notifyUser(c.env, id, {
    type: 'follow.new',
    from: { id: me.id, displayName: me.display_name, handle: me.handle, avatarUrl: me.avatar_url },
    isMutual: !!isMutual,
  });

  return c.json({ following: true, isMutual: !!isMutual });
});

r.get('/me/following', async (c) => {
  const rows = await q(c.env, `SELECT ${userJson('u')} AS u FROM follows f JOIN users u ON u.id = f.followee_id
      WHERE f.follower_id = $1 AND NOT u.banned ORDER BY f.created_at DESC LIMIT 1000`, [c.get('user').id]);
  return c.json({ items: rows.map((x) => ({ ...x.u, isFollowing: true })) });
});

r.get('/coins/ledger', async (c) => {
  const rows = await q(c.env, `SELECT amount, reason, ref, created_at FROM coin_ledger WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100`, [c.get('user').id]);
  return c.json({ items: rows.map((x) => ({ amount: x.amount, reason: x.reason, ref: x.ref, createdAt: new Date(x.created_at).toISOString() })) });
});

export default r;
