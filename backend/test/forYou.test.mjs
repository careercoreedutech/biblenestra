// PERSONALISATION: the ranked "For you" feed, interests, blocks, caps, cursor pagination and the Following tab.
// Run: npm test (node:test). Uses the in-memory Postgres (PGlite) that the other API tests use.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb } from '../dev/local-env.mjs';
import { arrangeFeed, tagPost, checkFeedRanking, encodeFeedCursor, decodeFeedCursor, resumeIndex, FEED_RANKING_DEFAULTS } from '../src/lib/feedRanking.js';

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), AUTH_DEV_MODE: 'true' };
});

async function call(user, method, path, body) {
  const h = {};
  if (user) h['X-Dev-User'] = user;
  let b;
  if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${path}`, { method, headers: h, body: b }), env);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = text; }
  return { status: res.status, json };
}
const db = (text, params) => env.__db.query(text, params);

// Creates a user (dev auth makes the row on first request) and returns its id
async function user(dev) {
  const r = await call(dev, 'GET', '/me');
  assert.equal(r.status, 200);
  return r.json.id;
}

// Authors: 6 people, each posts text with a topic word. Returns postId -> author dev name
const AUTHORS = ['fa1', 'fa2', 'fa3', 'fa4', 'fa5', 'fa6'];
const TEXTS = [
  'A prayer for the nation today, pray with me',
  'Worship night was amazing, praise God',
  'Bible study on the Greek words in John 1',
  'Youth camp testimony: God did a miracle',
  'Marriage and family devotion this morning',
  'Sermon on missions and outreach',
];
const postAuthor = new Map();

test('setup: users, interests, and a pool of posts from six authors', async () => {
  for (const a of AUTHORS) await user(a);
  for (const v of ['fv_pray', 'fv_music', 'fv_new1', 'fv_new2', 'fv_block', 'fv_cap']) await user(v);
  // each author writes 6 posts, spread over the topics
  for (let round = 0; round < 6; round++) {
    for (let i = 0; i < AUTHORS.length; i++) {
      const r = await call(AUTHORS[i], 'POST', '/posts', { kind: 'Reflection', text: `${TEXTS[(i + round) % TEXTS.length]} #${round}` });
      assert.equal(r.status, 201);
      postAuthor.set(r.json.id, AUTHORS[i]);
    }
  }
  // a heavy author for the per-author cap
  for (let i = 0; i < 9; i++) {
    const r = await call('fa_heavy', 'POST', '/posts', { kind: 'Reflection', text: `Heavy author post number ${i}` });
    postAuthor.set(r.json.id, 'fa_heavy');
  }
  assert.ok(postAuthor.size >= 45);
});

test('interests are stored, validated, and editable later', async () => {
  const bad = await call('fv_pray', 'PUT', '/me/interests', { interests: ['not-a-topic'] });
  assert.equal(bad.status, 400);
  const ok = await call('fv_pray', 'PUT', '/me/interests', { interests: ['prayer', 'healing'], country: 'NG', city: 'Ibadan' });
  assert.equal(ok.status, 200);
  assert.deepEqual([...ok.json.interests].sort(), ['healing', 'prayer']);
  const got = await call('fv_pray', 'GET', '/me/interests');
  assert.equal(got.json.city, 'Ibadan');
  assert.ok(got.json.topics.length >= 14);
  // skippable: an empty PUT keeps the rest
  await call('fv_music', 'PUT', '/me/interests', { interests: ['music'] });
});

test('two different users get different orderings', async () => {
  await call('fv_pray', 'PUT', '/me/interests', { interests: ['prayer', 'healing'] });
  const a = await call('fv_pray', 'GET', '/feed?limit=30');
  const b = await call('fv_music', 'GET', '/feed?limit=30');
  const ia = a.json.items.map((x) => x.id);
  const ib = b.json.items.map((x) => x.id);
  assert.ok(ia.length > 10);
  assert.notDeepEqual(ia, ib);
});

test('interest matching ranks a matching post first', async () => {
  // a viewer interested in prophecy; no setup post uses that topic, so this post is the only match and should come first
  await user('fv_prophecy');
  await call('fv_prophecy', 'PUT', '/me/interests', { interests: ['prophecy'] });
  const m = await call('fa_heavy', 'POST', '/posts', { kind: 'Reflection', text: 'Prophecy study this weekend on the end times' });
  assert.equal(m.status, 201);
  const r = await call('fv_prophecy', 'GET', '/feed?limit=20');
  assert.equal(r.json.items[0].id, m.json.id);
  const stored = await db('SELECT topics FROM posts WHERE id = $1', [m.json.id]);
  assert.ok(stored[0].topics.includes('prophecy'));
});

test('blocked users are excluded from For you', async () => {
  const viewer = await user('fv_block');
  const target = await user('fa2');
  await db('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [viewer, target]);
  const r = await call('fv_block', 'GET', '/feed?limit=50');
  const authors = r.json.items.map((x) => x.author && x.author.id);
  assert.ok(!authors.includes(target), 'blocked author must not appear');
  assert.ok(r.json.items.length > 0);
});

test('the per-author cap holds in every window of the feed', async () => {
  const r = await call('fv_cap', 'GET', '/feed?limit=50');
  const authors = r.json.items.map((x) => x.author && x.author.id);
  const counts = new Map();
  for (const a of authors) counts.set(a, (counts.get(a) || 0) + 1);
  // the heavy author has 9 posts; with a cap of 2 per window of 10, no window shows 3 of them while other authors are still waiting
  const cap = FEED_RANKING_DEFAULTS.per_author_cap;
  const win = FEED_RANKING_DEFAULTS.window;
  // near the end of a short pool only capped authors can be left, so the rule is checked over the first 30 positions
  for (let i = 0; i + win <= Math.min(30, authors.length); i++) {
    const seg = authors.slice(i, i + win);
    for (const a of new Set(seg)) {
      assert.ok(seg.filter((x) => x === a).length <= cap, `author ${a} exceeds the cap in window ${i}`);
    }
  }
});

test('cursor pagination has no duplicates and returns every candidate once', async () => {
  const seen = [];
  let cursor = null;
  for (let page = 0; page < 40; page++) {
    const r = await call('fv_new1', 'GET', `/feed?limit=7${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    assert.equal(r.status, 200);
    seen.push(...r.json.items.map((x) => x.id));
    cursor = r.json.nextCursor;
    if (!cursor) break;
  }
  assert.equal(new Set(seen).size, seen.length, 'no post shown twice');
  assert.ok(seen.length >= 45, `expected the whole pool, got ${seen.length}`);
});

test('cold start: new users with no interests get varied, different feeds', async () => {
  const a = await call('fv_new1', 'GET', '/feed?limit=20');
  const b = await call('fv_new2', 'GET', '/feed?limit=20');
  assert.notDeepEqual(a.json.items.map((x) => x.id), b.json.items.map((x) => x.id));
  const authorsA = new Set(a.json.items.map((x) => x.author && x.author.id));
  assert.ok(authorsA.size >= 4, 'a cold-start page mixes several authors');
});

test('the Following tab stays chronological and only shows people I follow', async () => {
  const viewer = await user('fv_follow');
  const followee = await user('fa3');
  await db('INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [viewer, followee]);
  const r = await call('fv_follow', 'GET', '/feed?filter=following&limit=50');
  assert.equal(r.status, 200);
  const times = r.json.items.map((x) => Date.parse(x.createdAt));
  for (let i = 1; i < times.length; i++) assert.ok(times[i - 1] >= times[i], 'newest first');
  for (const it of r.json.items) assert.ok(it.author.id === followee || it.author.id === viewer, 'only followed people');
});

// ---- pure helpers ----

test('tagPost: kinds, passages, categories, hashtags and keywords', () => {
  assert.deepEqual(tagPost({ kind: 'Prayer', body: '' }), ['prayer']);
  assert.ok(tagPost({ kind: 'Reflection', body: 'my #BibleStudy notes' }).includes('bible-study'));
  assert.ok(tagPost({ kind: 'Video', body: 'the sermon', category: 'Sermons' }).includes('sermons'));
  assert.ok(tagPost({ kind: 'Reflection', body: '', passageBook: 'JHN' }).includes('bible-study'));
  assert.deepEqual(tagPost({ kind: 'Reflection', body: 'nothing relevant here' }), []);
  assert.ok(tagPost({ kind: 'Reflection', body: 'worship and praise and prayer and healing and music and youth and missions and prophecy' }).length <= 5);
});

test('arrangeFeed: caps authors, mixes types and injects exploration', () => {
  const rows = [];
  for (let i = 0; i < 40; i++) {
    rows.push({ id: `a${i}`, author: i < 30 ? 'hot' : `x${i}`, overlap: 0, followed: false, aff_n: 0, is_video: i % 3 === 0, is_prayer: false, has_media: false, score: 100 - i });
  }
  const out = arrangeFeed(rows, { window: 10, perAuthorCap: 2, explorePct: 15 });
  assert.equal(out.length, rows.length);
  assert.equal(new Set(out.map((x) => x.id)).size, rows.length, 'a permutation, no duplicates');
  // while other authors are still waiting, no window of 10 holds more than 2 posts from 'hot'
  const lastOther = out.reduce((m, x, i) => (x.author !== 'hot' ? i : m), -1);
  for (let i = 0; i + 10 <= lastOther + 1; i++) {
    assert.ok(out.slice(i, i + 10).filter((x) => x.author === 'hot').length <= 2, `cap broken in window ${i}`);
  }
  // exploration: a post from outside the circles shows up within the first period
  assert.ok(out.slice(0, 8).some((x) => x.author !== 'hot'));
});

test('arrangeFeed: a single-author pool still fills (the rule relaxes)', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, author: 'only', overlap: 0, followed: true, aff_n: 1, score: 10 - i }));
  assert.equal(arrangeFeed(rows, { window: 10, perAuthorCap: 2, explorePct: 15 }).length, 12);
});

test('cursor round trip and resume index', () => {
  const c = { s: new Date().toISOString(), k: 'abc', i: 7 };
  assert.deepEqual(decodeFeedCursor(encodeFeedCursor(c)), c);
  assert.equal(decodeFeedCursor('not-a-cursor'), null);
  assert.equal(resumeIndex(['a', 'b', 'c'], { s: 'x', k: 'b', i: 0 }), 2);
  assert.equal(resumeIndex(['a', 'b'], { s: 'x', k: 'gone', i: 1 }), 1);
  assert.equal(resumeIndex(['a'], null), 0);
});

test('feed_ranking admin setting validation', () => {
  assert.equal(checkFeedRanking(FEED_RANKING_DEFAULTS), true);
  assert.equal(checkFeedRanking({ ...FEED_RANKING_DEFAULTS, exploration_pct: 90 }), false);
  assert.equal(checkFeedRanking({ ...FEED_RANKING_DEFAULTS, weights: { relevance: -1 } }), false);
});

test('re-tag backfill: admin only, batched, tags untagged posts, and a second run tags nothing new', async () => {
  const author = await user('fa4');
  await user('fv_plain');
  const old = await db(`INSERT INTO posts (author_id, kind, body) VALUES ($1, 'Reflection', 'Our prayer night was powerful'),
    ($1, 'Reflection', 'Plain thoughts with no topic words') RETURNING id`, [author]);
  assert.equal((await call('fv_plain', 'POST', '/admin/api/feed-ranking/retag', { limit: 2 })).status, 403);
  await user('fv_admin');
  await db(`UPDATE users SET role = 'admin' WHERE clerk_id = 'dev_fv_admin'`);
  let after = null; let total = 0; let batches = 0;
  do {
    const r = await call('fv_admin', 'POST', '/admin/api/feed-ranking/retag', { after, limit: 2 });
    assert.equal(r.status, 200);
    total += r.json.tagged; after = r.json.next; batches += 1;
  } while (after && batches < 100);
  assert.equal(after, null);
  assert.ok(total >= 1);
  const tagged = await db('SELECT topics FROM posts WHERE id = $1', [old[0].id]);
  assert.ok(tagged[0].topics.includes('prayer'));
  // a second full pass finds nothing new to tag
  const again = await call('fv_admin', 'POST', '/admin/api/feed-ranking/retag', { limit: 500 });
  assert.equal(again.json.tagged, 0);
  assert.equal((await call('fv_admin', 'POST', '/admin/api/feed-ranking/retag', { after: 'nope' })).status, 400);
});

test('Reels: the videos list is ranked for the viewer and holds only video posts', async () => {
  await user('fv_reels');
  await call('fv_reels', 'PUT', '/me/interests', { interests: ['prophecy'] });
  const v = await db(`INSERT INTO posts (author_id, kind, body, video_url, topics) VALUES ((SELECT id FROM users WHERE clerk_id = 'dev_fa5'),
    'Video', 'Prophecy teaching on the end times', 'https://cdn.example.com/prophecy.mp4', ARRAY['prophecy']) RETURNING id`);
  await db(`INSERT INTO posts (author_id, kind, body, video_url) VALUES ((SELECT id FROM users WHERE clerk_id = 'dev_fa5'),
    'Video', 'Music video', 'https://cdn.example.com/music.mp4')`);
  const r = await call('fv_reels', 'GET', '/videos?limit=10');
  assert.equal(r.status, 200);
  assert.ok(r.json.items.length >= 2);
  assert.equal(r.json.items[0].id, v[0].id, 'the prophecy video matches the interest and comes first');
  const plain = await db(`SELECT id FROM posts WHERE video_url IS NULL AND video_uid IS NULL`);
  const plainIds = new Set(plain.map((x) => x.id));
  assert.ok(r.json.items.every((x) => !plainIds.has(x.id)), 'no text-only posts in Reels');
});

test('Groups: with no search text, groups in the viewer\'s country come first', async () => {
  const owner = await db(`SELECT id FROM users WHERE clerk_id = 'dev_fa6'`);
  await db(`INSERT INTO conversations (kind, title, listed, country, created_by) VALUES ('group', 'London prayer circle', true, 'GB', $1),
    ('group', 'Lagos prayer circle', true, 'NG', $1)`, [owner[0].id]);
  await user('fv_lagos');
  await call('fv_lagos', 'PUT', '/me/interests', { country: 'NG' });
  const r = await call('fv_lagos', 'GET', '/groups/search');
  assert.equal(r.status, 200);
  const names = r.json.items.map((x) => x.name);
  assert.ok(names.indexOf('Lagos prayer circle') >= 0 && names.indexOf('Lagos prayer circle') < names.indexOf('London prayer circle'));
});
