// SOCIAL (round 3): person posts, comment likes + notifications, who-liked lists, profile images, gifts from comments.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', ADS_CLIENT_CLAIM: 'true' };
});

async function call(user, method, path, body, headers = {}) {
  const h = { ...headers };
  if (user) h['X-Dev-User'] = user;
  let b;
  if (body instanceof Uint8Array || typeof body === 'string') b = body;
  else if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${path}`, { method, headers: h, body: b }), env);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = text; }
  return { status: res.status, json };
}
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const upload = (user) => call(user, 'POST', '/uploads/image', PNG, { 'Content-Type': 'image/png' });
const notifs = async (user) => (await call(user, 'GET', '/me/notifications')).json.items;

let ids = {};
test('setup social users', async () => {
  for (const u of ['sa', 'sb', 'sc']) ids[u] = (await call(u, 'GET', '/me')).json.id;
  assert.ok(ids.sa && ids.sb && ids.sc);
});

test('GET /users/:id/posts — paginated, excludes removed / hidden / blocked', async () => {
  const made = [];
  for (let i = 0; i < 5; i++) made.push((await call('sa', 'POST', '/posts', { text: `Post ${i}` })).json.id);
  await call('sa', 'DELETE', `/posts/${made[0]}`);
  await call('sb', 'POST', `/posts/${made[1]}/hide`, {});
  const p1 = await call('sb', 'GET', `/users/${ids.sa}/posts?limit=2`);
  assert.equal(p1.status, 200);
  assert.equal(p1.json.items.length, 2);
  assert.ok(p1.json.nextCursor);
  assert.equal(p1.json.items[0].author.id, ids.sa);
  assert.ok('myReaction' in p1.json.items[0] && 'likes' in p1.json.items[0], 'same post shape as /feed');
  const p2 = await call('sb', 'GET', `/users/${ids.sa}/posts?limit=2&cursor=${encodeURIComponent(p1.json.nextCursor)}`);
  const all = [...p1.json.items, ...p2.json.items].map((x) => x.id);
  assert.equal(all.length, 3, 'removed + hidden posts are excluded');
  assert.ok(!all.includes(made[0]) && !all.includes(made[1]));
  assert.equal(p2.json.nextCursor, null);
  assert.equal((await call('sb', 'GET', `/users/${ids.sa}/posts?type=bogus`)).status, 400);
  assert.equal((await call('sb', 'GET', `/users/${ids.sa}/posts?type=videos`)).json.items.length, 0);
  assert.equal((await call('sb', 'GET', '/users/not-a-uuid/posts')).status, 404);
  assert.equal((await call(null, 'GET', `/users/${ids.sa}/posts`)).status, 401);
  // blocked → hidden both ways
  assert.ok((await call('sc', 'POST', `/users/${ids.sa}/block`, {})).status < 300);
  assert.equal((await call('sc', 'GET', `/users/${ids.sa}/posts`)).status, 404);
  assert.equal((await call('sa', 'GET', `/users/${ids.sc}/posts`)).status, 404);
  assert.equal((await call('sa', 'GET', `/users/${ids.sc}`)).status, 404, 'a blocker is not visible to the person they blocked');
  await call('sc', 'DELETE', `/users/${ids.sa}/block`);
  assert.equal((await call('sc', 'GET', `/users/${ids.sa}/posts`)).status, 200);
  const prof = await call('sb', 'GET', `/users/${ids.sa}`);
  assert.equal(prof.json.posts, 4);
  assert.equal(prof.json.isMe, false);
  assert.ok('bannerUrl' in prof.json && 'bio' in prof.json);
});

test('comment likes: toggle, counts, likedByMe, who-liked, notification (no self / no unlike)', async () => {
  const post = (await call('sa', 'POST', '/posts', { text: 'Grace and peace' })).json.id;
  const cm = (await call('sb', 'POST', `/posts/${post}/comments`, { text: 'Amen to this beautiful word from the Psalms today' })).json;
  const before = (await notifs('sb')).length;
  const l1 = await call('sa', 'POST', `/comments/${cm.id}/like`);
  assert.deepEqual(l1.json, { liked: true, likes: 1 });
  const n1 = await notifs('sb');
  assert.equal(n1.length, before + 1);
  assert.equal(n1[0].kind, 'comment_like');
  assert.match(n1[0].body, /^Sa liked your comment: “Amen to this/);
  assert.equal(n1[0].data.postId, post);
  assert.equal(n1[0].data.commentId, cm.id);
  // list shows count + likedByMe
  const listA = (await call('sa', 'GET', `/posts/${post}/comments`)).json.items[0];
  assert.equal(listA.likes, 1);
  assert.equal(listA.likedByMe, true);
  const listB = (await call('sb', 'GET', `/posts/${post}/comments`)).json.items[0];
  assert.equal(listB.likedByMe, false);
  // who liked
  const who = await call('sb', 'GET', `/comments/${cm.id}/likes`);
  assert.equal(who.json.count, 1);
  assert.equal(who.json.items[0].id, ids.sa);
  assert.equal(who.json.items[0].displayName, 'Sa');
  // unlike → no notification; re-like → still only one notification
  assert.deepEqual((await call('sa', 'POST', `/comments/${cm.id}/like`)).json, { liked: false, likes: 0 });
  assert.equal((await call('sa', 'POST', `/comments/${cm.id}/like`)).json.likes, 1);
  assert.equal((await notifs('sb')).length, before + 1);
  // self-like: counted, no notification
  const selfBefore = (await notifs('sb')).length;
  assert.deepEqual((await call('sb', 'POST', `/comments/${cm.id}/like`)).json, { liked: true, likes: 2 });
  assert.equal((await notifs('sb')).length, selfBefore);
  // bad ids / removed post
  assert.equal((await call('sa', 'POST', '/comments/nope/like')).status, 404);
  assert.equal((await call('sa', 'POST', '/comments/00000000-0000-4000-8000-000000000000/like')).status, 404);
  assert.equal((await call(null, 'POST', `/comments/${cm.id}/like`)).status, 401);
  await call('sa', 'DELETE', `/posts/${post}`);
  assert.equal((await call('sc', 'POST', `/comments/${cm.id}/like`)).status, 404);
});

test('who reacted to a post', async () => {
  const post = (await call('sa', 'POST', '/posts', { text: 'React to me' })).json.id;
  await call('sb', 'POST', `/posts/${post}/react`, { reaction: 'amen' });
  const r = await call('sa', 'GET', `/posts/${post}/reactions`);
  assert.equal(r.status, 200);
  assert.equal(r.json.items.length, 1);
  assert.equal(r.json.items[0].id, ids.sb);
  assert.equal(r.json.items[0].reaction, 'amen');
});

test('profile images: only my own uploads, returned in /me and /users/:id', async () => {
  const mine = await upload('sa');
  assert.equal(mine.status, 201);
  const theirs = await upload('sb');
  // key form
  const r1 = await call('sa', 'PUT', '/me', { avatarUrl: mine.json.key });
  assert.equal(r1.status, 200);
  assert.equal(r1.json.avatarUrl, mine.json.url);
  // url form + banner
  const banner = await upload('sa');
  const r2 = await call('sa', 'PUT', '/me', { bannerUrl: banner.json.url, bio: 'Loves the Psalms' });
  assert.equal(r2.json.bannerUrl, banner.json.url);
  assert.equal(r2.json.avatarUrl, mine.json.url, 'avatar unchanged');
  // resend unchanged values is fine
  assert.equal((await call('sa', 'PUT', '/me', { avatarUrl: r2.json.avatarUrl, bannerUrl: r2.json.bannerUrl })).status, 200);
  // someone else's upload, external URLs, path tricks, unknown keys → rejected
  for (const bad of [theirs.json.key, theirs.json.url, 'https://evil.example/x.png', `https://evil.example/media/${mine.json.key}`,
    `img/${ids.sa}/../${theirs.json.key}`, `img/${ids.sa}/00000000-0000-4000-8000-000000000000.png`, 42]) {
    const r = await call('sa', 'PUT', '/me', { avatarUrl: bad });
    assert.equal(r.status, 400, `rejects ${bad}`);
    assert.equal(r.json.code, 'BAD_IMAGE');
    assert.equal((await call('sa', 'PUT', '/me', { bannerUrl: bad })).status, 400);
  }
  const prof = await call('sb', 'GET', `/users/${ids.sa}`);
  assert.equal(prof.json.avatarUrl, mine.json.url);
  assert.equal(prof.json.bannerUrl, banner.json.url);
  assert.equal(prof.json.bio, 'Loves the Psalms');
  // clearing
  const cl = await call('sa', 'PUT', '/me', { bannerUrl: null });
  assert.equal(cl.json.bannerUrl, null);
});

test('gift from a comment: coins move on the server, recipient notified, context checked', async () => {
  const post = (await call('sa', 'POST', '/posts', { text: 'Gift post' })).json.id;
  const cm = (await call('sb', 'POST', `/posts/${post}/comments`, { text: 'Praying with you' })).json;
  const own = (await call('sa', 'POST', `/posts/${post}/comments`, { text: 'Thanks!' })).json;
  const aBefore = (await call('sa', 'GET', '/me')).json.coins;
  const bBefore = (await call('sb', 'GET', '/me')).json.coins;
  const g = await call('sa', 'POST', '/gifts', { toUserId: ids.sb, giftId: 'g_rose', postId: post, commentId: cm.id });
  assert.equal(g.status, 201);
  assert.equal(g.json.coinsRemaining, aBefore - 5);
  assert.equal((await call('sb', 'GET', '/me')).json.coins, bBefore + g.json.coinsGiven);
  const n = (await notifs('sb')).find((x) => x.kind === 'gift');
  assert.ok(n);
  assert.match(n.body, /for your comment “Praying with you”/);
  assert.equal(n.data.commentId, cm.id);
  assert.equal(n.data.postId, post);
  // comment must belong to the recipient (not my own comment, not someone else's)
  assert.equal((await call('sa', 'POST', '/gifts', { toUserId: ids.sb, giftId: 'g_rose', commentId: own.id })).json.code, 'BAD_COMMENT');
  assert.equal((await call('sc', 'POST', '/gifts', { toUserId: ids.sa, giftId: 'g_rose', commentId: cm.id })).json.code, 'BAD_COMMENT');
  assert.equal((await call('sa', 'POST', '/gifts', { toUserId: ids.sb, giftId: 'g_rose', commentId: 'x' })).status, 400);
  assert.equal((await call('sa', 'POST', '/gifts', { toUserId: 'not-a-uuid', giftId: 'g_rose' })).status, 404);
  // insufficient coins → 402, nothing moves
  const poor = await call('sc', 'POST', '/gifts', { toUserId: ids.sb, giftId: 'g_crown', commentId: cm.id });
  assert.equal(poor.status, 402);
  assert.equal(poor.json.code, 'INSUFFICIENT_COINS');
  // profile gift (no post/comment context) still works; device-only post ids are ignored
  assert.equal((await call('sb', 'POST', '/gifts', { toUserId: ids.sa, giftId: 'g_rose', postId: 'v123' })).status, 201);
});

test('followers / following lists', async () => {
  await call('sb', 'POST', `/users/${ids.sa}/follow`);
  await call('sc', 'POST', `/users/${ids.sa}/follow`);
  const f = await call('sb', 'GET', `/users/${ids.sa}/followers`);
  assert.equal(f.status, 200);
  assert.deepEqual(f.json.items.map((x) => x.id).sort(), [ids.sb, ids.sc].sort());
  assert.equal(f.json.items.find((x) => x.id === ids.sb).isMe, true);
  const g = await call('sa', 'GET', `/users/${ids.sb}/following`);
  assert.ok(g.json.items.some((x) => x.id === ids.sa && x.isFollowing === false));
  // blocked people drop out of lists
  await call('sa', 'POST', `/users/${ids.sc}/block`, {});
  assert.ok(!(await call('sa', 'GET', `/users/${ids.sa}/followers`)).json.items.some((x) => x.id === ids.sc));
  await call('sa', 'DELETE', `/users/${ids.sc}/block`);
  assert.equal((await call('sa', 'GET', '/users/bad/followers')).status, 404);
});
