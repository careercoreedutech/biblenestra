// MEMBERSHIP GROUPS — gap fixes: publishers edit MASTER CLASS posts with no time limit, muted / suspended members can't
// gift, forwards into a membership section follow the push plan, search reaches a shared post's original text, suspend /
// unsuspend, promote-to-admin within the promoter's own permissions, the group photo becomes the cover, paged members and
// media, and the default welcome text.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { q, one } from '../src/lib/db.js';
import { DEFAULT_WELCOME, welcomeText } from '../src/lib/membershipGroups.js';
import { resolveContext } from '../src/lib/virtualGifts.js';

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', MEMBERSHIP_TEST_CHECKOUT: 'true' };
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
const ids = {};
let mem; let master; let exec;
const ago = (msgId, interval = '3 days') => q(env, `UPDATE messages SET created_at = now() - interval '${interval}' WHERE id = $1`, [msgId]);
const insertMsg = async (conv, sender, kind, body, extra = {}) => (await one(env,
  `INSERT INTO messages (conversation_id, sender_id, kind, body, media_key) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
  [conv, sender, kind, body, extra.mediaKey || null])).id;

test('setup: a published group with an owner, a publisher-admin, members', async () => {
  for (const u of ['boss', 'cara', 'dan', 'ann', 'ben', 'eve']) ids[u] = (await call(u, 'GET', '/me')).json.id;
  await q(env, `UPDATE users SET role = 'admin' WHERE id = $1`, [ids.boss]);
  const r = await call('boss', 'POST', '/memberships/manage', { title: 'Bible Study', category: 'Prayer', userId: null, ownerUserId: ids.cara });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  mem = r.json;
  await call('boss', 'POST', `/memberships/manage/${mem.id}/plans`, { name: 'Free', priceMinor: 0, interval: 'month' });
  const pub = await call('boss', 'POST', `/memberships/manage/${mem.id}/publish`);
  assert.equal(pub.status, 200, JSON.stringify(pub.json));
  master = pub.json.channelId; exec = pub.json.communityId;
  for (const u of ['dan', 'ann', 'ben', 'eve']) assert.equal((await call('boss', 'POST', `/memberships/manage/${mem.id}/grant`, { userId: ids[u] })).status, 200);
  // eve is an admin who can only manage members and promote (manageMembers)
  const adm = await call('cara', 'POST', `/memberships/${mem.id}/group/admins`, { userId: ids.eve, permissions: { publish: false, deleteMessages: false, pin: false, manageMembers: true, manageSettings: false, inviteMembers: false } });
  assert.equal(adm.status, 201, JSON.stringify(adm.json));
});

// ---------- 1. publishers edit MASTER CLASS posts with no time window ----------
test('publisher edits a MASTER CLASS post and its caption after the 15-minute window', async () => {
  const id = await insertMsg(master, ids.cara, 'text', 'Week one lesson');
  await ago(id);
  const r = await call('cara', 'PATCH', `/messages/${id}`, { text: 'Week one lesson (revised)' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await one(env, 'SELECT body FROM messages WHERE id = $1', [id])).body, 'Week one lesson (revised)');
  const cap = await insertMsg(master, ids.cara, 'image', 'old caption', { mediaKey: `chat/${master}/img_x.jpg` });
  await ago(cap, '2 days');
  const c = await call('cara', 'PATCH', `/messages/${cap}`, { text: 'new caption' });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  assert.equal((await one(env, 'SELECT body FROM messages WHERE id = $1', [cap])).body, 'new caption');
});

test('a normal member keeps the 15-minute rule in EXECUTIVE CLASS, and can’t edit a MASTER CLASS post', async () => {
  const old = await insertMsg(exec, ids.dan, 'text', 'my question');
  await ago(old);
  const r = await call('dan', 'PATCH', `/messages/${old}`, { text: 'edited' });
  assert.equal(r.status, 400); assert.equal(r.json.code, 'EDIT_WINDOW_PASSED');
  const post = await insertMsg(master, ids.cara, 'text', 'lesson two');
  const r2 = await call('dan', 'PATCH', `/messages/${post}`, { text: 'hijack' });
  assert.equal(r2.status, 403, JSON.stringify(r2.json));
});

// ---------- 5. search finds the original text of a shared MASTER CLASS post ----------
test('EXECUTIVE CLASS search finds a MASTER CLASS post by its text', async () => {
  const made = await call('cara', 'POST', `/conversations/${master}/messages`, { text: 'Quartz lesson on Romans' });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const post = made.json.id;
  const refs = await one(env, `SELECT id FROM messages WHERE shared_from = $1`, [post]);
  assert.ok(refs, 'the reference exists');
  const r = await call('dan', 'GET', `/conversations/${exec}/search?q=quartz`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const hit = r.json.items.find((x) => x.id === refs.id);
  assert.ok(hit, 'the shared post is found');
  assert.equal(hit.text, 'Quartz lesson on Romans');
  // a deleted original drops out of search (its reference is a tombstone)
  await q(env, `UPDATE messages SET deleted = true WHERE id = $1`, [post]);
  await q(env, `UPDATE messages SET deleted = true WHERE shared_from = $1`, [post]);
  const gone = await call('dan', 'GET', `/conversations/${exec}/search?q=quartz`);
  assert.equal(gone.json.items.filter((x) => x.id === refs.id).length, 0);
});

// ---------- 6. suspend ----------
test('admin suspends a member: they can read, can’t post or gift, and only an admin lifts it', async () => {
  assert.equal((await call('dan', 'POST', `/conversations/${exec}/messages`, { text: 'hello' })).status, 201);
  const s = await call('cara', 'POST', `/memberships/${mem.id}/group/members/${ids.dan}`, { action: 'suspend' });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  assert.equal(s.json.suspended, true);
  const blocked = await call('dan', 'POST', `/conversations/${exec}/messages`, { text: 'again' });
  assert.equal(blocked.status, 403); assert.equal(blocked.json.code, 'SUSPENDED');
  const read = await call('dan', 'GET', `/conversations/${exec}/messages?limit=5`);
  assert.equal(read.status, 200, 'still reads');
  const list = await call('cara', 'GET', `/memberships/${mem.id}/group/members?filter=muted`);
  assert.equal(list.json.items.find((x) => x.id === ids.dan).suspended, true);
  const perms = await call('dan', 'GET', `/conversations/${exec}/messages?limit=1`);
  assert.equal(perms.json.permissions.canSend, false);
  // gifts: coin gifts (chat) and the send guard used by virtual gifts
  await q(env, 'UPDATE users SET coins = 100 WHERE id = $1', [ids.dan]);
  const coin = await call('dan', 'POST', `/conversations/${exec}/coins`, { coins: 5, toUserId: ids.ann });
  assert.equal(coin.status, 403, JSON.stringify(coin.json)); assert.equal(coin.json.code, 'SUSPENDED');
  await assert.rejects(resolveContext(env, { id: ids.dan }, { type: 'chat', id: exec }, ids.ann), (e) => e.code === 'SUSPENDED');
  // a suspended member can’t be given a timed mute on top (lift first)
  const m = await call('cara', 'POST', `/memberships/${mem.id}/group/members/${ids.dan}`, { action: 'mute', minutes: 5 });
  assert.equal(m.status, 400); assert.equal(m.json.code, 'SUSPENDED');
  // a plain member can’t lift it
  const lift = await call('ann', 'POST', `/memberships/${mem.id}/group/members/${ids.dan}`, { action: 'unsuspend' });
  assert.equal(lift.status, 403); assert.equal(lift.json.code, 'PERMISSION_REQUIRED');
  // an admin with manage-members can
  const u = await call('eve', 'POST', `/memberships/${mem.id}/group/members/${ids.dan}`, { action: 'unsuspend' });
  assert.equal(u.status, 200, JSON.stringify(u.json));
  assert.equal((await call('dan', 'POST', `/conversations/${exec}/messages`, { text: 'back' })).status, 201);
});

// ---------- 7. promote to admin, within the promoter's own permissions ----------
test('an admin with manage-members promotes within their own permissions; the owner stays protected', async () => {
  // eve holds only manageMembers: giving publish is refused
  const nope = await call('eve', 'POST', `/memberships/${mem.id}/group/admins`, { userId: ids.ben, permissions: { publish: true } });
  assert.equal(nope.status, 403); assert.equal(nope.json.code, 'PERMISSION_NOT_HELD');
  // giving only what eve holds works, and a missing permissions block gives just what eve holds
  const ok = await call('eve', 'POST', `/memberships/${mem.id}/group/admins`, { userId: ids.ben, permissions: { manageMembers: true } });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.equal(ok.json.permissions.manageMembers, true); assert.equal(ok.json.permissions.publish, false);
  const dflt = await call('eve', 'POST', `/memberships/${mem.id}/group/admins`, { userId: ids.ann });
  assert.equal(dflt.status, 201, JSON.stringify(dflt.json));
  assert.equal(dflt.json.permissions.publish, false, 'eve cannot give publish, so the default drops it');
  assert.equal(dflt.json.permissions.manageMembers, true);
  // an admin can’t change an existing admin’s permissions (owner only)
  const edit = await call('eve', 'POST', `/memberships/${mem.id}/group/admins`, { userId: ids.ben, permissions: { pin: true } });
  assert.equal(edit.status, 403); assert.equal(edit.json.code, 'OWNER_ONLY');
  // nobody can promote or remove the owner
  assert.equal((await call('eve', 'POST', `/memberships/${mem.id}/group/admins`, { userId: ids.cara })).status, 403);
  assert.equal((await call('eve', 'DELETE', `/memberships/${mem.id}/group/admins/${ids.cara}`)).status, 403);
  // a plain member can’t promote
  const member = await call('dan', 'POST', `/memberships/${mem.id}/group/admins`, { userId: ids.ben });
  assert.equal(member.status, 403); assert.equal(member.json.code, 'PERMISSION_REQUIRED');
  // the owner can still give publish
  assert.equal((await call('cara', 'POST', `/memberships/${mem.id}/group/admins`, { userId: ids.dan, permissions: { publish: true } })).status, 201);
});

// ---------- 3. forwards into a membership section follow the push plan ----------
test('a forward into EXECUTIVE CLASS pushes with the section title and respects a member’s "off"', async () => {
  // ben turns EXECUTIVE CLASS notifications off
  assert.equal((await call('ben', 'PUT', `/memberships/${mem.id}/group/notifications`, { executive: 'off' })).status, 200);
  const src = await insertMsg(exec, ids.dan, 'text', 'Bring your notes on Acts');
  const r = await call('ann', 'POST', `/messages/${src}/forward`, { conversationIds: [exec] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.results[0].ok, true, JSON.stringify(r.json));
  const fwdId = r.json.results[0].message.id;
  const cara = await one(env, `SELECT title FROM notifications WHERE user_id = $1 AND data->>'messageId' = $2`, [ids.cara, fwdId]);
  assert.equal(cara.title, 'EXECUTIVE CLASS · Bible Study');
  const benCount = (await one(env, `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND data->>'messageId' = $2`, [ids.ben, fwdId])).n;
  assert.equal(benCount, 0, 'ben has EXECUTIVE CLASS notifications off');
  const danPush = await one(env, `SELECT title FROM notifications WHERE user_id = $1 AND data->>'messageId' = $2`, [ids.dan, fwdId]);
  assert.equal(danPush.title, 'EXECUTIVE CLASS · Bible Study', 'the sender of the original is notified too, with the section title');
});

// ---------- 8. group photo becomes the cover ----------
test('a new group photo shows as the group cover (group home and catalogue)', async () => {
  const key = `img/${ids.cara}/group-photo.jpg`;
  const r = await call('cara', 'PATCH', `/memberships/${mem.id}/group`, { avatarKey: key });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const home = await call('cara', 'GET', `/memberships/${mem.id}/group`);
  assert.ok(home.json.coverUrl && home.json.coverUrl.endsWith(key), home.json.coverUrl);
  assert.ok(home.json.avatarUrl && home.json.avatarUrl.endsWith(key));
  const row = await one(env, 'SELECT cover_key FROM memberships WHERE id = $1', [mem.id]);
  assert.equal(row.cover_key, key);
});

// ---------- 9. paging ----------
test('members list pages with a cursor and covers everyone once', async () => {
  const all = await call('cara', 'GET', `/memberships/${mem.id}/group/members?limit=200`);
  const total = all.json.items.length;
  assert.ok(total >= 5, `${total} members`);
  let cursor = null; const seen = []; let pages = 0;
  do {
    const path = `/memberships/${mem.id}/group/members?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const r = await call('cara', 'GET', path);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(r.json.items.length <= 2);
    seen.push(...r.json.items.map((x) => x.id));
    cursor = r.json.nextCursor; pages++;
    assert.ok(pages < 20, 'paging ends');
  } while (cursor);
  assert.equal(new Set(seen).size, total, 'every member exactly once');
  assert.equal(seen.length, total);
  assert.equal(seen[0], ids.cara, 'the owner comes first');
  assert.equal((await call('cara', 'GET', `/memberships/${mem.id}/group/members?cursor=garbage`)).status, 400);
});

test('media pages with a cursor', async () => {
  const bulk = [];
  for (let i = 0; i < 5; i++) bulk.push(insertMsg(exec, ids.ann, 'image', `pic ${i}`, { mediaKey: `chat/${exec}/img_${i}.jpg` }));
  await Promise.all(bulk);
  await q(env, `UPDATE messages SET created_at = now() - (interval '1 minute' * id_rank) FROM (SELECT id AS mid, row_number() OVER (ORDER BY created_at) AS id_rank FROM messages WHERE conversation_id = $1 AND kind = 'image') r WHERE messages.id = r.mid`, [exec]);
  const total = (await call('ann', 'GET', `/conversations/${exec}/media?type=photos&limit=200`)).json.items.length;
  assert.equal(total, 5);
  let before = null; let got = 0; let pages = 0;
  do {
    const r = await call('ann', 'GET', `/conversations/${exec}/media?type=photos&limit=2${before ? `&before=${encodeURIComponent(before)}` : ''}`);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(r.json.items.length <= 2);
    got += r.json.items.length; before = r.json.nextBefore; pages++;
    assert.ok(pages < 10);
  } while (before);
  assert.equal(got, 5);
});

// ---------- 10. default welcome text is the client's text ----------
test('the default welcome text is the client’s wording, with {group} for the name', () => {
  const client = '🎉 Welcome to {group}!\n\nWe are delighted to have you here. You are now part of a community dedicated to learning, growth and sharing valuable knowledge.\n\n'
    + 'Visit the MASTER CLASS section to access lessons, videos and learning materials.\n\n'
    + 'Join the EXECUTIVE CLASS to interact with other students, ask questions, share ideas and participate in discussions.\n\n'
    + 'We are excited to have you on this journey. Welcome aboard! 🚀';
  assert.equal(DEFAULT_WELCOME, client);
  assert.equal(welcomeText({ title: 'Bible Study', welcome_message: null }), client.replace('{group}', 'Bible Study'));
});
