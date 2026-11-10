// WhatsApp-style chats: message anyone straight away, find people, create groups and channels.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';

let env; const app = createApp();
before(async () => {
  // AUTH_DEV_MODE skipped the old follow-back gate, so the "no acceptance needed" checks below hold with or without it
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true' };
});
async function call(user, method, path, body) {
  const h = { 'X-Dev-User': user };
  let b;
  if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${path}`, { method, headers: h, body: b }), env);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = text; }
  return { status: res.status, json };
}
const ids = {};
const send = (u, conv, text) => call(u, 'POST', `/conversations/${conv}/messages`, { kind: 'text', text, clientId: `c_${Math.random()}` });

test('setup', async () => {
  for (const u of ['amy', 'ben', 'cal', 'dee']) ids[u] = (await call(u, 'GET', '/me')).json.id;
  await call('amy', 'PUT', '/me', { displayName: 'Amy Grace', church: 'Hope Chapel' });
});

test('find believers by name or church; blocked people are hidden', async () => {
  const byName = await call('ben', 'GET', '/people?q=amy');
  assert.equal(byName.status, 200);
  assert.ok(byName.json.items.some((p) => p.id === ids.amy));
  assert.ok((await call('ben', 'GET', '/people?q=Hope Chapel')).json.items.some((p) => p.id === ids.amy));
  assert.ok(!(await call('ben', 'GET', '/people')).json.items.some((p) => p.id === ids.ben)); // not yourself
  await call('dee', 'POST', `/users/${ids.ben}/block`);
  assert.ok(!(await call('ben', 'GET', '/people')).json.items.some((p) => p.id === ids.dee));
});

test('a first message to a stranger goes straight through — no request to accept', async () => {
  const dm = await call('ben', 'POST', '/conversations/dm', { userId: ids.cal });
  assert.equal(dm.status, 201);
  assert.equal(dm.json.canMessage, true);
  assert.equal(dm.json.isRequest, false);
  assert.equal((await send('ben', dm.json.id, 'Hello Cal')).status, 201);
  const calList = (await call('cal', 'GET', '/conversations')).json.items;
  const conv = calList.find((x) => x.id === dm.json.id);
  assert.ok(conv);
  assert.equal(conv.isRequest, false);
  assert.equal(conv.canMessage, true);
  assert.equal((await call('cal', 'GET', '/me/requests')).json.items.length, 0);
  assert.equal((await send('cal', dm.json.id, 'Hi Ben!')).status, 201);
});

test('blocking still stops messages', async () => {
  assert.equal((await call('ben', 'POST', '/conversations/dm', { userId: ids.dee })).status, 403);
});

test('groups: create with members, everyone can talk, admins add people, leaving works', async () => {
  const g = await call('amy', 'POST', '/conversations/group', { title: 'Youth Bible Study', description: 'Fridays', memberIds: [ids.ben, ids.amy, 'not-a-uuid'] });
  assert.equal(g.status, 201);
  const list = (await call('ben', 'GET', '/conversations')).json.items;
  const conv = list.find((x) => x.id === g.json.id);
  assert.equal(conv.kind, 'group');
  assert.equal(conv.title, 'Youth Bible Study');
  assert.equal(conv.membersCount, 2);
  assert.equal(conv.canMessage, true);
  assert.equal((await send('ben', g.json.id, 'See you Friday')).status, 201);
  assert.equal((await call('ben', 'POST', `/conversations/${g.json.id}/members`, { userIds: [ids.cal] })).status, 403);
  assert.equal((await call('amy', 'POST', `/conversations/${g.json.id}/members`, { userIds: [ids.cal] })).json.added, 1);
  assert.equal((await send('cal', g.json.id, 'Thanks for adding me')).status, 201);
  assert.equal((await call('cal', 'POST', `/conversations/${g.json.id}/leave`)).status, 200);
  assert.equal((await send('cal', g.json.id, 'still here?')).status, 403);
  assert.equal((await call('ben', 'POST', `/conversations/${g.json.id}/members`, { userIds: [] })).status, 403);
});

test('channels: only admins post; anyone can find and follow them', async () => {
  const ch = await call('amy', 'POST', '/channels', { title: 'Daily Devotions', description: 'A verse every morning' });
  assert.equal(ch.status, 201);
  assert.equal((await send('amy', ch.json.id, 'Good morning! Psalm 5:3')).status, 201);
  const found = (await call('cal', 'GET', '/channels?q=devotions')).json.items.find((x) => x.id === ch.json.id);
  assert.ok(found);
  assert.equal(found.following, false);
  assert.equal((await call('cal', 'POST', `/channels/${ch.json.id}/follow`)).status, 200);
  const conv = (await call('cal', 'GET', '/conversations')).json.items.find((x) => x.id === ch.json.id);
  assert.equal(conv.kind, 'channel');
  assert.equal(conv.canMessage, false);
  const post = await send('cal', ch.json.id, 'can I post?');
  assert.equal(post.status, 403);
  assert.equal(post.json.code, 'CHANNEL_ADMINS_ONLY');
  assert.equal((await call('cal', 'GET', `/conversations/${ch.json.id}/messages`)).status, 200);
  assert.equal((await call('cal', 'GET', '/channels?q=devotions')).json.items[0].following, true);
});
