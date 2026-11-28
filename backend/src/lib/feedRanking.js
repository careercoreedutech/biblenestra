// PERSONALISATION: the "For you" feed ranking (client request: everyone should not see the same thing).
//   - Topics: a fixed catalogue (TOPICS). Posts get topics at publish time (tagPost: kind, passage, category,
//     hashtags and a cheap keyword map). Users pick interests at sign-up or in Profile (routes/personalisation.js).
//   - Score (SQL, one query over a bounded candidate pool): relevance (topic overlap with interests), social
//     (followed author), affinity (my reactions/comments on this author), quality (engagement rate with time decay),
//     locality (same country / city / church), freshness (recency decay) and a per-user seeded jitter so two users
//     never get the same order.
//   - Arrangement (pure JS, arrangeFeed): a sliding-window per-author cap, a content-type mix, and ~explorePct of
//     slots filled from outside the viewer's circles.
//   - Pagination: the cursor carries a snapshot time (scores are computed "as of" it, so they do not drift while
//     scrolling) and the last id returned. The ordering is rebuilt from the same snapshot on every page.
// Weights and limits are admin-editable: registerConfig 'feed_ranking' (Admin > Wallets & payments > Settings).
import { q } from './db.js';
import { getConfig, registerConfig } from './wallet.js';

export const TOPICS = [
  { id: 'prayer', label: 'Prayer' },
  { id: 'worship', label: 'Worship' },
  { id: 'bible-study', label: 'Bible study' },
  { id: 'youth', label: 'Youth' },
  { id: 'marriage-family', label: 'Marriage & family' },
  { id: 'healing', label: 'Healing' },
  { id: 'missions', label: 'Missions' },
  { id: 'prophecy', label: 'Prophecy' },
  { id: 'christian-living', label: 'Christian living' },
  { id: 'business-faith', label: 'Business & faith' },
  { id: 'music', label: 'Music' },
  { id: 'sermons', label: 'Sermons' },
  { id: 'testimonies', label: 'Testimonies' },
  { id: 'devotionals', label: 'Devotionals' },
];
export const TOPIC_IDS = TOPICS.map((t) => t.id);

// Cheap keyword rules (case-insensitive). A post carries at most 5 topics.
const KEYWORDS = {
  prayer: /\b(pray|prayer|prayers|intercede|intercession)\b/i,
  worship: /\b(worship|praise|praising)\b/i,
  'bible-study': /\b(bible study|study|exegesis|verse|scripture|passage|greek|hebrew)\b/i,
  youth: /\b(youth|teen|teens|students?|campus)\b/i,
  'marriage-family': /\b(marriage|married|husband|wife|family|families|parenting|children)\b/i,
  healing: /\b(heal|healing|healed|miracle|health)\b/i,
  missions: /\b(mission|missions|missionary|evangelism|evangelise|evangelize|outreach)\b/i,
  prophecy: /\b(prophecy|prophetic|prophet|prophesy|end times)\b/i,
  'christian-living': /\b(holiness|discipleship|disciple|obedience|godly|purity)\b/i,
  'business-faith': /\b(business|career|entrepreneur|workplace)\b/i,
  music: /\b(song|songs|music|choir|hymn)\b/i,
  sermons: /\b(sermon|sermons|preach|preaching)\b/i,
  testimonies: /\b(testimony|testimonies|testify|god did)\b/i,
  devotionals: /\b(devotion|devotional|daily bread|reflection|meditation)\b/i,
};
const KIND_TOPICS = { Prayer: 'prayer', Testimony: 'testimonies', Study: 'bible-study', Sermon: 'sermons', Devotional: 'devotionals', Worship: 'worship' };

/** Topics for a post, from its kind, passage, category, hashtags and text. Deterministic; at most 5. */
export function tagPost({ kind, body, category, passageBook }) {
  const out = new Set();
  const k = KIND_TOPICS[String(kind || '')];
  if (k) out.add(k);
  if (passageBook) out.add('bible-study');
  const cat = String(category || '').toLowerCase().trim();
  if (TOPIC_IDS.includes(cat)) out.add(cat);
  const text = String(body || '');
  // hashtags naming a topic (#prayer, #BibleStudy, #bible-study)
  for (const tag of text.match(/#[\p{L}\p{N}_-]{2,40}/gu) || []) {
    const t = tag.slice(1).toLowerCase().replace(/_/g, '-');
    if (TOPIC_IDS.includes(t)) out.add(t);
    if (t === 'biblestudy') out.add('bible-study');
    if (t === 'marriage' || t === 'family') out.add('marriage-family');
  }
  for (const id of TOPIC_IDS) if (KEYWORDS[id].test(text)) out.add(id);
  return [...out].slice(0, 5);
}

export const FEED_RANKING_DEFAULTS = {
  exploration_pct: 15,        // share of slots filled from outside the viewer's usual circles
  decay_hours: 48,            // freshness decay constant (hours)
  quality_decay_hours: 72,    // engagement-rate decay constant (hours)
  per_author_cap: 2,          // max posts from one author in any window of `window` items
  window: 10,                 // sliding window for the author and content-type caps
  pool_days: 14,              // candidate pool: posts from the last N days ...
  evergreen_max: 100,         // ... plus this many top older posts by engagement ...
  pool_max: 500,              // ... and at most this many candidates are scored
  weights: { relevance: 3, social: 4, affinity: 0.5, quality: 4, locality: 1, freshness: 3, jitter: 1.5 },
};
const WEIGHT_KEYS = Object.keys(FEED_RANKING_DEFAULTS.weights);
const inRange = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** Validates the admin setting. Used by registerConfig, so setConfig refuses a bad value. */
export function checkFeedRanking(v) {
  if (!v || typeof v !== 'object') return false;
  const topOk = inRange(v.exploration_pct, 0, 50) && inRange(v.decay_hours, 1, 1440) && inRange(v.quality_decay_hours, 1, 1440)
    && inRange(v.per_author_cap, 1, 20) && inRange(v.window, 2, 50) && inRange(v.pool_days, 1, 60)
    && inRange(v.evergreen_max, 0, 500) && inRange(v.pool_max, 20, 500);
  const w = v.weights;
  const weightsOk = !!w && typeof w === 'object' && WEIGHT_KEYS.every((k) => w[k] === undefined || inRange(w[k], 0, 100));
  return topOk && weightsOk;
}
registerConfig('feed_ranking', FEED_RANKING_DEFAULTS, checkFeedRanking);

/** The effective config: stored values merged over the defaults (weights merged key by key). */
export async function feedRankingConfig(env) {
  const stored = (await getConfig(env)).feed_ranking || {};
  return { ...FEED_RANKING_DEFAULTS, ...stored, weights: { ...FEED_RANKING_DEFAULTS.weights, ...(stored.weights || {}) } };
}

// The candidate pool, scored in SQL. Parameters:
// $1 viewer  $2 interests  $3 country  $4 city  $5 church  $6 snapshot  $7 pool_days  $8 evergreen  $9 pool_max
// $10..$16 weights (relevance, social, affinity, quality, locality, freshness, jitter)  $17 decay  $18 quality decay
const POOL_SQL = `
WITH cand AS (
  SELECT p.id, p.author_id, p.kind, p.likes_count, p.comments_count, p.views_count, p.video_plays_count,
    p.video_uid, p.video_url, (p.embed IS NOT NULL) AS has_embed, u.country AS a_country, u.city AS a_city, u.church AS a_church,
    EXISTS (SELECT 1 FROM post_media m WHERE m.post_id = p.id) AS has_media,
    (SELECT count(*)::int FROM unnest(p.topics) t WHERE t = ANY($2::text[])) AS overlap,
    EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1::uuid AND f.followee_id = p.author_id) AS followed,
    (SELECT count(*)::int FROM reactions r JOIN posts pp ON pp.id = r.post_id WHERE r.user_id = $1::uuid AND pp.author_id = p.author_id)
      + (SELECT count(*)::int FROM comments c JOIN posts pp ON pp.id = c.post_id WHERE c.author_id = $1::uuid AND pp.author_id = p.author_id) AS aff_n,
    GREATEST(EXTRACT(EPOCH FROM ($6::timestamptz - p.created_at)) / 3600.0, 0) AS age_h
  FROM posts p JOIN users u ON u.id = p.author_id
  WHERE NOT p.removed AND p.pinned_at IS NULL AND NOT u.banned AND p.created_at <= $6::timestamptz
    AND (p.video_uid IS NULL OR p.video_status = 'ready' OR p.author_id = $1::uuid)
    AND NOT EXISTS (SELECT 1 FROM hidden_posts h WHERE h.post_id = p.id AND h.user_id = $1::uuid)
    AND NOT EXISTS (SELECT 1 FROM reports rp WHERE rp.target_type = 'post' AND rp.target_id = p.id AND rp.reporter_id = $1::uuid)
    AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1::uuid AND b.blocked_id = p.author_id) OR (b.blocker_id = p.author_id AND b.blocked_id = $1::uuid))
    AND ($19::boolean = false OR p.video_uid IS NOT NULL OR p.video_url IS NOT NULL OR p.embed IS NOT NULL)
    AND (p.created_at >= $6::timestamptz - make_interval(days => $7::int)
      OR p.id IN (SELECT e.id FROM posts e WHERE NOT e.removed AND e.pinned_at IS NULL AND e.created_at < $6::timestamptz - make_interval(days => $7::int)
                  ORDER BY (e.likes_count + e.comments_count) DESC, e.id LIMIT $8::int))
)
SELECT id, author_id AS author, overlap, followed, aff_n, has_media,
  (video_uid IS NOT NULL OR video_url IS NOT NULL OR has_embed) AS is_video, (kind = 'Prayer') AS is_prayer,
  (
    $10::float8 * LEAST(overlap, 3)
    + $11::float8 * followed::int
    + $12::float8 * LEAST(aff_n, 6)
    + $13::float8 * LEAST((likes_count + comments_count + video_plays_count)::float8 / (views_count + 10), 1.0) * exp(-age_h / $18::float8)
    + $14::float8 * ((COALESCE(a_country, '') <> '' AND a_country = $3::text)::int + (COALESCE(a_city, '') <> '' AND a_city = $4::text)::int * 0.5
                     + (COALESCE(a_church, '') <> '' AND a_church = $5::text)::int * 0.5)
    + $15::float8 * exp(-age_h / $17::float8)
    + $16::float8 * ((('x' || substr(md5(id::text || $1::uuid::text), 1, 8))::bit(32)::bigint)::float8 / 4294967296.0)
  ) AS score
FROM cand
ORDER BY score DESC, id DESC
LIMIT $9::int`;

/** Candidate pool for one viewer, best first. `snapshot` is an ISO time; scores are computed as of it. */
export async function scoredPool(env, viewerId, { interests = [], country = '', city = '', church = '' }, snapshot, cfg, { videosOnly = false } = {}) {
  const w = cfg.weights;
  return q(env, POOL_SQL, [viewerId, interests || [], country || '', city || '', church || '', snapshot, cfg.pool_days, cfg.evergreen_max, cfg.pool_max,
    w.relevance, w.social, w.affinity, w.quality, w.locality, w.freshness, w.jitter, cfg.decay_hours, cfg.quality_decay_hours, !!videosOnly]);
}

const typeOf = (r) => (r.is_video ? 'video' : r.is_prayer ? 'prayer' : r.has_media ? 'image' : 'text');
const isExplore = (r) => !r.followed && r.aff_n === 0 && r.overlap === 0;

/**
 * Orders the scored pool for display (pure). Rows must be sorted best first.
 *  - per-author cap: no author more than `perAuthorCap` times in any `window` consecutive items
 *  - type mix: at most 70% of one content type inside a window
 *  - exploration: about every (100 / explorePct)th slot takes the best outside-circle post, if there is one
 * When a rule cannot be met (a pool with one author only, say), that rule is relaxed so the feed never stalls.
 */
export function arrangeFeed(rows, { window = 10, perAuthorCap = 2, explorePct = 15 } = {}) {
  const queue = rows.slice();
  const out = [];
  const period = explorePct > 0 ? Math.max(2, Math.round(100 / explorePct)) : 0;
  const typeCap = Math.max(1, Math.ceil(window * 0.7));
  const take = (pred) => {
    const i = queue.findIndex(pred);
    return i >= 0 ? queue.splice(i, 1)[0] : null;
  };
  while (queue.length) {
    const rec = out.slice(Math.max(0, out.length - (window - 1)));
    const authorOk = (r) => rec.filter((x) => x.author === r.author).length < perAuthorCap;
    const typeOk = (r) => rec.filter((x) => typeOf(x) === typeOf(r)).length < typeCap;
    // tiers: both caps, then the author cap only (the type mix is best effort), then anything at all
    const tiers = [(r) => authorOk(r) && typeOk(r), (r) => authorOk(r)];
    const wantExplore = period > 0 && out.length % period === period - 1;
    let pick = null;
    if (wantExplore) for (const t of tiers) if (!pick) pick = take((r) => isExplore(r) && t(r));
    for (const t of tiers) if (!pick) pick = take(t);
    if (!pick) pick = take(() => true); // the author cap cannot be met any more: keep the feed going
    out.push(pick);
  }
  return out;
}

// Cursor: base64url JSON { s: snapshot ISO, k: last id returned, i: next index (fallback) }.
export function encodeFeedCursor(c) {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}
export function decodeFeedCursor(s) {
  if (!s) return null;
  try {
    const c = JSON.parse(Buffer.from(String(s), 'base64url').toString('utf8'));
    if (!c || typeof c.s !== 'string' || Number.isNaN(Date.parse(c.s))) return null;
    return { s: c.s, k: typeof c.k === 'string' ? c.k : null, i: Number.isInteger(c.i) && c.i >= 0 ? c.i : 0 };
  } catch (e) { return null; }
}

/** Where to resume: after the last id returned, or the saved index when that id has left the pool. */
export function resumeIndex(ids, cur) {
  if (!cur) return 0;
  if (cur.k) { const at = ids.indexOf(cur.k); if (at >= 0) return at + 1; }
  return Math.min(cur.i, ids.length);
}

/**
 * One batch of the one-off topic backfill for posts published before topics existed (admin "Re-tag posts").
 * Keyset-paged by id over untagged posts only, so it is safe to repeat and to stop and resume:
 * re-running it tags nothing new once every post has been visited. Returns { scanned, tagged, next } where
 * `next` is the id to pass as `after` for the following batch, or null when the table is done.
 */
export async function retagBatch(env, { after = null, limit = 200 } = {}) {
  const n = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const rows = await q(env, `SELECT id, kind, body, category, passage_book FROM posts
    WHERE topics = '{}' AND ($1::uuid IS NULL OR id > $1::uuid) ORDER BY id LIMIT $2::int`, [after, n]);
  let tagged = 0;
  for (const r of rows) {
    const topics = tagPost({ kind: r.kind, body: r.body, category: r.category, passageBook: r.passage_book });
    if (topics.length) {
      await q(env, 'UPDATE posts SET topics = $2 WHERE id = $1', [r.id, topics]);
      tagged += 1;
    }
  }
  return { scanned: rows.length, tagged, next: rows.length === n ? rows[rows.length - 1].id : null };
}
