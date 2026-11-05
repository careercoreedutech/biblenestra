// ROUND 4: message actions — edit, delete for me / everyone, pin, react, reply — in DMs and group channels.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { q } from '../src/lib/db.js';

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', ADS_CLIENT_CLAIM: 'true' };
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
const send = (u, conv, text, extra = {}) => call(u, 'POST', `/conversations/${conv}/messages`, { text, ...extra });
const page = async (u, conv) => (await call(u, 'GET', `/conversations/${conv}/messages`)).json;

const ids = {}; let dm;
test('setup: users + DM', async () => {
  for (const u of ['ma', 'mb', 'mc', 'md']) ids[u] = (await call(u, 'GET', '/me')).json.id;
  dm = (await call('ma', 'POST', '/conversations/dm', { userId: ids.mb })).json.id;
  assert.ok(dm);
});

test('edit: own text message only, marks editedAt, rejects empty / others / old', async () => {
  const m = (await send('ma', dm, 'Hi')).json;
  const e = await call('ma', 'PATCH', `/messages/${m.id}`, { text: 'Hi Esther' });
  assert.equal(e.status, 200);
  assert.equal(e.json.text, 'Hi Esther');
  assert.ok(e.json.editedAt);
  const seen = (await page('mb', dm)).items.find((x) => x.id === m.id);
  assert.equal(seen.text, 'Hi Esther');
  assert.ok(seen.editedAt);
  assert.equal((await call('mb', 'PATCH', `/messages/${m.id}`, { text: 'hack' })).status, 403);
  assert.equal((await call('ma', 'PATCH', `/messages/${m.id}`, { text: '   ' })).status, 400);
  assert.equal((await call('md', 'PATCH', `/messages/${m.id}`, { text: 'x' })).status, 404, 'outsiders cannot see it');
  await q(env, `UPDATE messages SET created_at = now() - interval '25 hours' WHERE id = $1`, [m.id]);
  const old = await call('ma', 'PATCH', `/messages/${m.id}`, { text: 'late' });
  assert.equal(old.status, 400);
  assert.equal(old.json.code, 'EDIT_WINDOW_PASSED');
});

test('react: one reaction per person, toggle off, counts and mine', async () => {
  const m = (await send('ma', dm, 'Pray for me')).json;
  let r = await call('mb', 'POST', `/messages/${m.id}/react`, { emoji: '🙏' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.reactions, [{ emoji: '🙏', count: 1, mine: true }]);
  await call('ma', 'POST', `/messages/${m.id}/react`, { emoji: '🙏' });
  r = await call('mb', 'POST', `/messages/${m.id}/react`, { emoji: '❤️' });
  assert.equal(r.json.reactions.length, 2, 'mb switched to a heart');
  const forA = (await call('ma', 'GET', `/messages/${m.id}`)).json.reactions;
  assert.deepEqual(forA.find((x) => x.emoji === '🙏'), { emoji: '🙏', count: 1, mine: true });
  assert.deepEqual(forA.find((x) => x.emoji === '❤️'), { emoji: '❤️', count: 1, mine: false });
  r = await call('mb', 'POST', `/messages/${m.id}/react`, { emoji: '❤️' });
  assert.equal(r.json.mine, null, 'same emoji again removes it');
  assert.equal((await call('mb', 'POST', `/messages/${m.id}/react`, { emoji: '💩' })).status, 400);
});

test('reply: preview of the quoted message; must be in the same conversation', async () => {
  const q1 = (await send('mb', dm, 'What chapter tonight?')).json;
  const a = await send('ma', dm, 'John 3', { replyTo: q1.id });
  assert.equal(a.status, 201);
  assert.equal(a.json.reply.id, q1.id);
  assert.equal(a.json.reply.text, 'What chapter tonight?');
  const other = (await call('mc', 'POST', '/conversations/dm', { userId: ids.ma })).json.id;
  const elsewhere = (await send('mc', other, 'elsewhere')).json;
  assert.equal((await send('ma', dm, 'x', { replyTo: elsewhere.id })).status, 400);
});

test('pin: either person in a DM, pins listed with the first page, max 3', async () => {
  const ms = [];
  for (let i = 0; i < 4; i++) ms.push((await send('ma', dm, `pin ${i}`)).json);
  assert.equal((await call('mb', 'POST', `/messages/${ms[0].id}/pin`, { pinned: true })).status, 200);
  for (let i = 1; i < 4; i++) await call('ma', 'POST', `/messages/${ms[i].id}/pin`, {});
  const p = await page('mb', dm);
  assert.equal(p.pins.length, 3);
  assert.deepEqual(p.pins.map((x) => x.text), ['pin 3', 'pin 2', 'pin 1'], 'oldest pin dropped');
  assert.equal(p.items.find((x) => x.id === ms[3].id).pinned, true);
  await call('ma', 'POST', `/messages/${ms[3].id}/pin`, { pinned: false });
  assert.equal((await page('ma', dm)).pins.length, 2);
});

test('delete for me hides only for me; delete for everyone is sender-only in DMs', async () => {
  const m = (await send('mb', dm, 'secret-ish')).json;
  assert.equal((await call('ma', 'POST', `/messages/${m.id}/delete`, { for: 'me' })).status, 200);
  assert.ok(!(await page('ma', dm)).items.some((x) => x.id === m.id));
  assert.equal((await call('ma', 'GET', `/messages/${m.id}`)).status, 404);
  assert.ok((await page('mb', dm)).items.some((x) => x.id === m.id), 'still there for mb');
  assert.equal((await call('ma', 'POST', `/messages/${m.id}/delete`, { for: 'everyone' })).status, 403);

  const n = (await send('ma', dm, 'oops wrong chat')).json;
  await call('mb', 'POST', `/messages/${n.id}/react`, { emoji: '😂' });
  await call('mb', 'POST', `/messages/${n.id}/pin`, {});
  assert.equal((await call('ma', 'POST', `/messages/${n.id}/delete`, {})).status, 200, 'no body = for everyone');
  const seen = (await call('mb', 'GET', `/messages/${n.id}`)).json;
  assert.equal(seen.deleted, true);
  assert.equal(seen.pinned, false);
  assert.deepEqual(seen.reactions, []);
  assert.equal(seen.deletedByModerator, false);
  assert.ok(!(await page('mb', dm)).pins.some((x) => x.id === n.id));
  assert.equal((await call('ma', 'PATCH', `/messages/${n.id}`, { text: 'back' })).status, 400);
  assert.equal((await call('mb', 'POST', `/messages/${n.id}/react`, { emoji: '🙏' })).status, 400);
});

test('groups: channels listed; admins pin and remove any message; members cannot', async () => {
  const comm = (await call('ma', 'POST', '/communities', { name: 'Round Four Fellowship' })).json;
  await call('mb', 'POST', `/communities/${comm.id}/join`);
  await call('mc', 'POST', `/communities/${comm.id}/join`);
  const listed = (await call('mb', 'GET', '/communities')).json.items.find((x) => x.id === comm.id);
  assert.equal(listed.channels.length, 5);
  const general = listed.channels.find((x) => x.name === 'General').conversationId;

  const mcMsg = (await send('mc', general, 'Hello all')).json;
  const mine = (await send('mb', general, 'Hi from mb')).json;
  assert.equal((await call('mb', 'POST', `/messages/${mcMsg.id}/pin`, {})).status, 403, 'members cannot pin in groups');
  assert.equal((await call('mb', 'POST', `/messages/${mcMsg.id}/delete`, { for: 'everyone' })).status, 403);
  assert.equal((await call('mb', 'PATCH', `/messages/${mine.id}`, { text: 'Hi from mb (edited)' })).status, 200);
  assert.equal((await call('mb', 'POST', `/messages/${mcMsg.id}/react`, { emoji: '🙌' })).status, 200, 'members can react');

  assert.equal((await call('ma', 'POST', `/messages/${mcMsg.id}/pin`, {})).status, 200, 'owner pins');
  const pg = await page('mc', general);
  assert.equal(pg.pins[0].id, mcMsg.id);
  assert.equal(pg.myRole, 'member');

  // promote mb to community admin → can moderate
  await call('ma', 'POST', `/communities/${comm.id}/members/${ids.mb}`, { action: 'promote' });
  const del = await call('mb', 'POST', `/messages/${mcMsg.id}/delete`, { for: 'everyone' });
  assert.equal(del.status, 200);
  const gone = (await call('mc', 'GET', `/messages/${mcMsg.id}`)).json;
  assert.equal(gone.deleted, true);
  assert.equal(gone.deletedByModerator, true);
  assert.equal((await page('mc', general)).pins.length, 0);

  assert.equal((await call('md', 'GET', `/messages/${mine.id}`)).status, 404, 'non-members see nothing');
  // legacy pin endpoint only accepts this community's channels
  assert.equal((await call('ma', 'POST', `/communities/${comm.id}/pin`, { conversationId: dm, messageId: mine.id })).status, 404);
  assert.equal((await call('ma', 'POST', `/communities/${comm.id}/pin`, { conversationId: general, messageId: mine.id })).status, 200);
  assert.equal((await page('mb', general)).pins[0].id, mine.id);
});
