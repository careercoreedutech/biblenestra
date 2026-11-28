// PERSONALISATION: interests at sign-up and in Profile, and the admin view of the "For you" ranking.
//   GET  /me/interests                    → { topics, interests, country, city, church, denomination }
//   PUT  /me/interests { interests?, country?, city?, church?, denomination? }  (every field optional, skippable)
//   GET  /admin/api/feed-ranking          → the effective ranking settings (admin only; edit them in Wallets & payments › Settings)
import { Hono } from 'hono';
import { one, q } from '../lib/db.js';
import { body, bad, str, isUuid } from '../lib/http.js';
import { TOPICS, TOPIC_IDS, feedRankingConfig, retagBatch } from '../lib/feedRanking.js';
import { FEED_RANKING_ADMIN_SCRIPT } from '../lib/feedRankingAdminPage.js';
import { requireAdmin, registerAdminScript } from './admin.js';

const r = new Hono();
registerAdminScript(FEED_RANKING_ADMIN_SCRIPT);

const shapeInterests = (u) => ({
  topics: TOPICS,
  interests: u.interests || [],
  country: u.country || '',
  city: u.city || '',
  church: u.church || '',
  denomination: u.denomination || '',
});

r.get('/me/interests', async (c) => {
  const u = await one(c.env, 'SELECT interests, country, city, church, denomination FROM users WHERE id = $1', [c.get('user').id]);
  return c.json(shapeInterests(u));
});

r.put('/me/interests', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const fields = {};
  if (b.interests !== undefined) {
    if (!Array.isArray(b.interests)) throw bad('interests must be a list of topic ids', 'BAD_INTERESTS');
    const ids = [...new Set(b.interests.map((x) => String(x)))];
    if (ids.length > 8) throw bad('Pick up to 8 topics', 'TOO_MANY_INTERESTS');
    const unknown = ids.filter((x) => !TOPIC_IDS.includes(x));
    if (unknown.length) throw bad('Unknown topic', 'BAD_INTERESTS');
    fields.interests = ids;
  }
  if (b.country !== undefined) fields.country = str(b.country, { max: 60, optional: true });
  if (b.city !== undefined) fields.city = str(b.city, { max: 60, optional: true });
  if (b.church !== undefined) fields.church = str(b.church, { max: 120, optional: true });
  if (b.denomination !== undefined) fields.denomination = str(b.denomination, { max: 60, optional: true });
  const keys = Object.keys(fields);
  if (keys.length) {
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    await q(c.env, `UPDATE users SET ${sets}, interests_set_at = now(), updated_at = now() WHERE id = $1`, [me.id, ...keys.map((k) => fields[k])]);
  }
  const u = await one(c.env, 'SELECT interests, country, city, church, denomination FROM users WHERE id = $1', [me.id]);
  return c.json(shapeInterests(u));
});

export const adminFeedRanking = new Hono();
adminFeedRanking.get('/admin/api/feed-ranking', requireAdmin, async (c) => {
  return c.json({ config: await feedRankingConfig(c.env), topics: TOPICS });
});

// One batch of the topic backfill (lib/feedRanking.js retagBatch). Call again with `after` = the returned `next` until it is null.
adminFeedRanking.post('/admin/api/feed-ranking/retag', requireAdmin, async (c) => {
  const b = await body(c).catch(() => ({}));
  if (b.after && !isUuid(b.after)) throw bad('after must be a post id');
  const limit = Number(b.limit) || 200;
  return c.json(await retagBatch(c.env, { after: b.after || null, limit }));
});

export default r;
