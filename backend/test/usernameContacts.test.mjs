// USERNAME CONTACTS: an EXACT @username match that the user messages becomes a chat_contacts row (POST
// /contacts/by-handle). Chats with that person skip the free slots. Partial matches keep the 5-chat rule; blocks,
// bans and the daily cap are enforced on the server; CHAT_USERNAME_CONTACTS=false restores the old behaviour.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { q, one } from '../src/lib/db.js';

let env; const app = createApp();
before(async () => { env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true' }; });
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
const id = async (u) => (ids[u] ||= (await call(u, 'GET', '/me')).json.id);
// give a dev user a public handle (stored without the @)
const handle = async (u, h) => { await id(u); await q(env, 'UPDATE users SET handle = $2 WHERE id = $1', [ids[u], h]); };
const dm = async (from, to) => call(from, 'POST', '/conversations/dm', { userId: await id(to) });
const send = async (from, convId, text = 'Hello') => call(from, 'POST', `/conversations/${convId}/messages`, { text });
const byHandle = (user, h, extra = {}) => call(user, 'POST', '/contacts/by-handle', { handle: h, ...extra });
const slots = async (u) => (await one(env, 'SELECT count(*)::int AS n FROM chat_slots WHERE user_id = $1', [await id(u)])).n;
const fillSlots = async (u, prefix) => {
  for (let i = 1; i <= 5; i++) { const c = await dm(u, `${prefix}${i}`); assert.equal(c.status, 201); assert.equal((await send(u, c.json.id)).status, 201); }
  assert.equal(await slots(u), 5);
};

test('an exact @handle contact is exempt from the slot count; the first message goes through', async () => {
  await fillSlots('uc_full', 'uc_fp');
  await handle('uc_ben', 'uc_ben');
  const added = await byHandle('uc_full', '@uc_ben');
  assert.equal(added.status, 201);
  assert.deepEqual([added.json.created, added.json.ok], [true, true]);
  const c = await dm('uc_full', 'uc_ben');
  assert.equal(c.status, 201);
  assert.equal((await send('uc_full', c.json.id, 'Peace be with you')).status, 201);
  assert.equal(await slots('uc_full'), 5, 'no extra slot used');
  const fu = (await call('uc_full', 'GET', `/chat/allowance?userId=${await id('uc_ben')}`)).json.forUser;
  assert.deepEqual([fu.needsSlot, fu.reason], [false, 'contact']);
  // a 6th stranger is still refused
  assert.equal((await dm('uc_full', 'uc_fp6')).status, 403);
});

test('a partial match or another platform user still uses a slot', async () => {
  await handle('uc_ray', 'uc_ray');
  assert.equal((await byHandle('uc_full', 'uc_ra')).status, 404, 'partial text is not an exact match');
  const r = await dm('uc_full', 'uc_ray');
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'CHAT_LIMIT_REACHED');
  // the match is an equality check, so LIKE wildcards never match
  assert.equal((await byHandle('uc_full', 'uc_r%')).status, 404);
  assert.equal((await byHandle('uc_full', 'uc_r_y')).status, 404);
  assert.equal((await byHandle('uc_full', 'uc_ray2')).status, 404);
  assert.equal((await byHandle('uc_full', '')).status, 400);
});

test('blocked users (either direction) and banned accounts cannot be added', async () => {
  await handle('uc_blocked', 'uc_blocked');
  await handle('uc_blocker', 'uc_blocker');
  await q(env, 'INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)', [await id('uc_blocker'), await id('uc_blocked')]);
  assert.equal((await byHandle('uc_blocked', 'uc_blocker')).status, 404, 'I blocked them: not found');
  assert.equal((await byHandle('uc_blocker', 'uc_blocked')).status, 404, 'they blocked me: not found');
  assert.equal((await dm('uc_blocked', 'uc_blocker')).json.code, 'BLOCKED');
  assert.equal(await one(env, 'SELECT 1 AS x FROM chat_contacts WHERE user_id = $1', [await id('uc_blocked')]), null);

  await handle('uc_gone', 'uc_gone');
  await q(env, 'UPDATE users SET banned = true WHERE id = $1', [await id('uc_gone')]);
  assert.equal((await byHandle('uc_full', 'uc_gone')).status, 404);
  assert.equal((await byHandle('uc_ben', 'uc_ben')).status, 400, 'cannot add yourself');
});

test('the daily cap limits new username contacts; re-adding an existing contact is free', async () => {
  await handle('uc_cap', 'uc_cap');
  for (const h of ['uc_c1', 'uc_c2', 'uc_c3']) await handle(h, h);
  env.CHAT_USERNAME_CONTACTS_PER_DAY = '2';
  try {
    assert.equal((await byHandle('uc_cap', 'uc_c1')).status, 201);
    assert.equal((await byHandle('uc_cap', 'uc_c2')).status, 201);
    const again = await byHandle('uc_cap', 'uc_c1');
    assert.equal(again.status, 200);
    assert.equal(again.json.created, false, 'an existing contact does not count again');
    const over = await byHandle('uc_cap', 'uc_c3');
    assert.equal(over.status, 429);
    assert.equal(over.json.code, 'USERNAME_CONTACTS_DAILY_LIMIT');
    assert.equal(await one(env, 'SELECT 1 AS x FROM chat_contacts WHERE user_id = $1 AND contact_id = $2', [await id('uc_cap'), await id('uc_c3')]), null);
    // the cap is per user: another user can still add
    assert.equal((await byHandle('uc_ben', 'uc_c3')).status, 201);
  } finally { delete env.CHAT_USERNAME_CONTACTS_PER_DAY; }
  // default cap is 20 a day: a fresh user can still add one
  await handle('uc_many', 'uc_many');
  assert.equal((await byHandle('uc_many', 'uc_c1')).status, 201);
});

test('the switch off restores the old behaviour: no new contacts and existing ones stop exempting', async () => {
  await fillSlots('uc_sw', 'uc_swp');
  await handle('uc_swb', 'uc_swb');
  await handle('uc_swc', 'uc_swc');
  assert.equal((await byHandle('uc_sw', 'uc_swb')).status, 201);
  env.CHAT_USERNAME_CONTACTS = 'false';
  try {
    const off = await byHandle('uc_sw', 'uc_swc');
    assert.equal(off.status, 403);
    assert.equal(off.json.code, 'USERNAME_CONTACTS_OFF');
    // the row from before the switch is ignored: the normal 5-chat rule applies again
    const r = await dm('uc_sw', 'uc_swb');
    assert.equal(r.status, 403);
    assert.equal(r.json.code, 'CHAT_LIMIT_REACHED');
    assert.equal((await call('uc_sw', 'GET', `/chat/allowance?userId=${await id('uc_swb')}`)).json.forUser.needsSlot, true);
  } finally { delete env.CHAT_USERNAME_CONTACTS; }
  // switched back on: the stored contact exempts again
  assert.equal((await dm('uc_sw', 'uc_swb')).status, 201);
});

test('the "@" prefix and letter case are ignored; a userId, when sent, must be that account', async () => {
  await handle('uc_case', 'uc_case');
  await handle('uc_ben2', 'Uc_Ben2');
  assert.equal((await byHandle('uc_case', '  @@UC_BEN2 ')).status, 201);
  assert.equal((await byHandle('uc_case', 'uc_ben2', { userId: await id('uc_ben') })).status, 404, 'a different account');
  assert.equal((await byHandle('uc_case', 'uc_ben2', { userId: 'not-a-uuid' })).status, 400);
  assert.equal((await byHandle('uc_case', 'uc_ben2', { userId: await id('uc_ben2') })).status, 200, 'already a contact');
});

test('the contact works in both directions: whoever added the other can chat without a slot', async () => {
  await fillSlots('uc_fill', 'uc_fl');
  await handle('uc_asker', 'uc_asker');
  await handle('uc_fill', 'uc_fill');
  assert.equal((await byHandle('uc_asker', 'uc_fill')).status, 201);
  const c = await dm('uc_fill', 'uc_asker');
  assert.equal(c.status, 201, 'the added person, now full, can still reply');
  assert.equal((await send('uc_fill', c.json.id, 'Hi')).status, 201);
  assert.equal(await slots('uc_fill'), 5);
});
