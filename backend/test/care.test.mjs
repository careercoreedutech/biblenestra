// PRAYER WALL "Light a Candle" + CHRISTIAN CARE NETWORK (Talk to a Priest, Talk to an Apostle).
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
const noticesFor = (userId) => q(env, `SELECT * FROM notifications WHERE user_id = $1 AND data->>'group' LIKE 'prayer-support:%' ORDER BY created_at`, [userId]);

test('candles: one per user per prayer, toggle, explicit set, counts in list and live endpoint', async () => {
  for (const u of ['poster', 'c1', 'c2', 'c3', 'boss']) ids[u] = (await call(u, 'GET', '/me')).json.id;
  const pr = await call('poster', 'POST', '/prayers', { title: 'Healing for my mother', body: '', audience: 'Public', anonymous: true });
  ids.prayer = pr.json.id;
  assert.equal(pr.json.candles, 0);
  assert.equal(pr.json.lit, false);

  assert.deepEqual((await call('c1', 'POST', `/prayers/${ids.prayer}/candle`)).json, { lit: true, candles: 1 });
  assert.deepEqual((await call('c1', 'POST', `/prayers/${ids.prayer}/candle`, { lit: true })).json, { lit: true, candles: 1 }, 'setting it again is idempotent');
  const dup = await q(env, 'SELECT count(*)::int AS n FROM prayer_candles WHERE prayer_id = $1 AND user_id = $2', [ids.prayer, ids.c1]);
  assert.equal(dup[0].n, 1, 'unique per user + prayer');
  await assert.rejects(q(env, 'INSERT INTO prayer_candles (prayer_id, user_id) VALUES ($1,$2)', [ids.prayer, ids.c1]), 'primary key enforces uniqueness');
  assert.deepEqual((await call('c1', 'POST', `/prayers/${ids.prayer}/candle`)).json, { lit: false, candles: 0 }, 'toggle = undo');
  assert.deepEqual((await call('c1', 'POST', `/prayers/${ids.prayer}/candle`)).json, { lit: true, candles: 1 });
  assert.deepEqual((await call('c2', 'POST', `/prayers/${ids.prayer}/candle`)).json, { lit: true, candles: 2 });

  // praying and candles are separate actions
  assert.deepEqual((await call('c2', 'POST', `/prayers/${ids.prayer}/pray`)).json, { prayed: true, praying: 1 });
  const listed = (await call('c2', 'GET', '/prayers')).json.items.find((x) => x.id === ids.prayer);
  assert.equal(listed.candles, 2); assert.equal(listed.lit, true); assert.equal(listed.prayed, true); assert.equal(listed.praying, 1);
  const live = await call('c3', 'GET', `/prayers/support?ids=${ids.prayer},not-a-uuid`);
  assert.deepEqual(live.json.items, [{ id: ids.prayer, praying: 1, candles: 2, prayed: false, lit: false }]);

  // who lit a candle — the anonymous poster is never revealed, supporters are
  const who = await call('c3', 'GET', `/prayers/${ids.prayer}/supporters?action=candle`);
  assert.equal(who.json.items.length, 2);
  assert.ok(!JSON.stringify(who.json).includes(ids.poster));

  // private prayers: nobody else can light a candle or see the counts
  const priv = await call('poster', 'POST', '/prayers', { title: 'Private one', audience: 'Private' });
  assert.equal((await call('c1', 'POST', `/prayers/${priv.json.id}/candle`)).status, 404);
  assert.deepEqual((await call('c1', 'GET', `/prayers/support?ids=${priv.json.id}`)).json.items, []);
  assert.equal((await call('c1', 'GET', `/prayers/${priv.json.id}/supporters`)).status, 404);
});

test('candle notices are grouped: one notice updated in place, a new push only after the quiet window', async () => {
  let rows = await noticesFor(ids.poster);
  const candle = rows.filter((n) => n.data.action === 'candle');
  assert.equal(candle.length, 1, 'three candle actions → one grouped notice');
  assert.equal(candle[0].title, '2 people lit a candle for your prayer 🕯️');
  assert.equal(candle[0].kind, 'prayer');
  assert.equal(candle[0].data.prayerId, ids.prayer);
  assert.equal(rows.filter((n) => n.data.action === 'pray').length, 1);
  assert.equal(rows.find((n) => n.data.action === 'pray').title, '1 person is praying for your prayer 🙏');

  // undo + redo does not notify again
  await call('c2', 'POST', `/prayers/${ids.prayer}/candle`);
  await call('c2', 'POST', `/prayers/${ids.prayer}/candle`);
  rows = (await noticesFor(ids.poster)).filter((n) => n.data.action === 'candle');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, '2 people lit a candle for your prayer 🕯️');

  // a third person within the window: same notice, new count, back to unread
  await q(env, 'UPDATE notifications SET read_at = now() WHERE id = $1', [rows[0].id]);
  await call('c3', 'POST', `/prayers/${ids.prayer}/candle`);
  rows = (await noticesFor(ids.poster)).filter((n) => n.data.action === 'candle');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, '3 people lit a candle for your prayer 🕯️');
  assert.equal(rows[0].read_at, null);

  // after the quiet window, the next candle sends a fresh notice
  await q(env, `UPDATE prayer_support_notices SET last_push_at = now() - interval '4 hours' WHERE prayer_id = $1`, [ids.prayer]);
  await call('boss', 'POST', `/prayers/${ids.prayer}/candle`);
  rows = (await noticesFor(ids.poster)).filter((n) => n.data.action === 'candle');
  assert.equal(rows.length, 2);
  assert.equal(rows[1].title, '4 people lit a candle for your prayer 🕯️');

  // lighting a candle on my own prayer never notifies me
  const before = (await noticesFor(ids.poster)).length;
  await call('poster', 'POST', `/prayers/${ids.prayer}/candle`);
  assert.equal((await noticesFor(ids.poster)).length, before);
});

test('priests: apply → pending (not listed) → approve → listed, search + filters, hide / suspend remove it', async () => {
  for (const u of ['frjohn', 'frpaul', 'seeker']) ids[u] = (await call(u, 'GET', '/me')).json.id;
  await q(env, `UPDATE users SET role = 'admin' WHERE id = $1`, [ids.boss]);

  const base = { name: 'John Okafor', parish: 'St. Mary’s Parish', diocese: 'Archdiocese of Lagos', country: 'Nigeria', languages: ['English', 'igbo'], bio: 'Parish priest for 12 years.', referenceNote: 'Ordained 2012. Reference: Chancery office, +234 …' };
  assert.equal((await call('frjohn', 'POST', '/care/priests/apply', base)).json.code, 'NOT_CONFIRMED');
  assert.equal((await call('frjohn', 'POST', '/care/priests/apply', { ...base, confirm: true, referenceNote: 'short' })).status, 400);
  assert.equal((await call('frjohn', 'POST', '/care/priests/apply', { ...base, confirm: true, photoUrl: 'http://x.org/a.jpg' })).json.code, 'BAD_PHOTO');
  const app1 = await call('frjohn', 'POST', '/care/priests/apply', { ...base, confirm: true });
  assert.equal(app1.status, 201, JSON.stringify(app1.json));
  assert.equal(app1.json.status, 'pending');
  assert.equal(app1.json.displayName, 'Rev. Fr. John Okafor');
  assert.deepEqual(app1.json.languages, ['English', 'Igbo']);
  ids.john = app1.json.id;
  const app2 = await call('frpaul', 'POST', '/care/priests/apply', { ...base, name: 'Paul Mensah', country: 'Ghana', languages: ['English', 'French'], availability: 'busy', confirm: true });
  ids.paul = app2.json.id;

  assert.equal((await call('seeker', 'GET', '/care/priests')).json.items.length, 0, 'pending profiles are not listed');
  assert.equal((await call('seeker', 'GET', `/care/priests/${ids.john}`)).status, 404);
  assert.equal((await call('seeker', 'POST', `/care/priests/${ids.john}/message`)).status, 404);
  assert.equal((await call('frjohn', 'GET', '/care/priests/mine')).json.priest.status, 'pending');

  assert.equal((await call('seeker', 'GET', '/admin/api/care/priests')).status, 403);
  assert.equal((await call('seeker', 'POST', `/admin/api/care/priests/${ids.john}/approve`, {})).status, 403);
  const queue = await call('boss', 'GET', '/admin/api/care/priests?status=pending');
  assert.equal(queue.json.items.length, 2);
  assert.match(queue.json.items[0].referenceNote, /Chancery/);
  assert.equal((await call('boss', 'POST', `/admin/api/care/priests/${ids.john}/approve`, {})).json.status, 'approved');
  assert.equal((await call('boss', 'POST', `/admin/api/care/priests/${ids.paul}/approve`, {})).json.status, 'approved');

  const list = await call('seeker', 'GET', '/care/priests');
  assert.equal(list.json.items.length, 2);
  assert.equal(list.json.items[0].name, 'John Okafor', 'available priests first');
  assert.equal(list.json.items[0].verified, true);
  assert.equal(list.json.items[0].referenceNote, undefined, 'reference notes stay private');
  assert.deepEqual(list.json.countries, ['Ghana', 'Nigeria']);
  assert.ok(list.json.languages.includes('French'));
  assert.equal((await call('seeker', 'GET', '/care/priests?country=ghana')).json.items.length, 1);
  assert.equal((await call('seeker', 'GET', '/care/priests?language=igbo')).json.items[0].name, 'John Okafor');
  assert.equal((await call('seeker', 'GET', '/care/priests?q=mensah')).json.items.length, 1);
  assert.equal((await call('seeker', 'GET', '/care/priests?q=nobody')).json.items.length, 0);
  assert.equal((await call('frjohn', 'POST', '/care/priests/apply', { ...base, confirm: true })).json.code, 'ALREADY_LISTED');
  const upd = await call('frjohn', 'PATCH', '/care/priests/mine', { availability: 'away' });
  assert.equal(upd.json.availability, 'away');
  assert.equal(upd.json.status, 'approved', 'availability changes need no re-review');
  assert.ok((await q(env, `SELECT 1 FROM notifications WHERE user_id = $1 AND kind = 'care'`, [ids.frjohn])).length);

  // Message → private DM, labelled for the priest's inbox
  const msg = await call('seeker', 'POST', `/care/priests/${ids.john}/message`);
  assert.equal(msg.status, 201);
  const again = await call('seeker', 'POST', `/care/priests/${ids.john}/message`);
  assert.equal(again.json.id, msg.json.id, 'reopens the same chat');
  assert.equal((await call('frjohn', 'POST', `/care/priests/${ids.john}/message`)).json.code, 'OWN_PROFILE');
  await call('seeker', 'POST', `/conversations/${msg.json.id}/messages`, { text: 'Father, may I ask for confession times?' });
  const inbox = await call('frjohn', 'GET', '/care/inbox?kind=priest');
  assert.equal(inbox.json.items.length, 1);
  assert.equal(inbox.json.items[0].requester.id, ids.seeker);
  assert.equal(inbox.json.items[0].unread, 1);

  // hide and suspend take it out of the directory at once
  await call('boss', 'POST', `/admin/api/care/priests/${ids.paul}/hide`, {});
  await call('boss', 'POST', `/admin/api/care/priests/${ids.john}/suspend`, { reason: 'Reference could not be confirmed' });
  assert.equal((await call('seeker', 'GET', '/care/priests')).json.items.length, 0);
  assert.equal((await call('seeker', 'POST', `/care/priests/${ids.john}/message`)).status, 404);
  assert.equal((await call('frjohn', 'POST', '/care/priests/apply', { ...base, confirm: true })).json.code, 'SUSPENDED');
  // a banned account is never listed, even when approved
  await call('boss', 'POST', `/admin/api/care/priests/${ids.paul}/approve`, {});
  await q(env, 'UPDATE users SET banned = true WHERE id = $1', [ids.frpaul]);
  assert.equal((await call('seeker', 'GET', '/care/priests')).json.items.length, 0);
  await q(env, 'UPDATE users SET banned = false WHERE id = $1', [ids.frpaul]);
});

test('apostle: "coming soon" until configured; chat opens directly, labelled, one-time greeting, apostle inbox', async () => {
  ids.apostle = (await call('apostle', 'GET', '/me')).json.id;
  await q(env, `UPDATE users SET handle = 'theapostle' WHERE id = $1`, [ids.apostle]);
  assert.deepEqual((await call('seeker', 'GET', '/care/apostle')).json, { available: false });
  assert.equal((await call('seeker', 'POST', '/care/apostle/chat')).json.code, 'APOSTLE_UNAVAILABLE');
  assert.equal((await call('seeker', 'GET', '/care')).json.apostle.available, false);

  // env fallback
  env.APOSTLE_USER_ID = ids.apostle;
  assert.equal((await call('seeker', 'GET', '/care/apostle')).json.available, true);
  delete env.APOSTLE_USER_ID;

  // admin setting (by @handle) with a custom greeting
  assert.equal((await call('seeker', 'PUT', '/admin/api/care/apostle', { user: '@theapostle' })).status, 403);
  assert.equal((await call('boss', 'PUT', '/admin/api/care/apostle', { user: '@nobody-here' })).json.code, 'USER_NOT_FOUND');
  const saved = await call('boss', 'PUT', '/admin/api/care/apostle', { user: '@theapostle', title: 'Apostle Benjamin', greeting: 'Grace and peace to you. I will reply soon.', autoReply: true });
  assert.equal(saved.json.userId, ids.apostle);
  const summary = (await call('seeker', 'GET', '/care')).json;
  assert.equal(summary.apostle.available, true);
  assert.equal(summary.apostle.name, 'Apostle Benjamin');

  const chat = await call('seeker', 'POST', '/care/apostle/chat');
  assert.equal(chat.status, 201, JSON.stringify(chat.json));
  assert.equal(chat.json.label, 'Talk to an Apostle');
  const msgs = (await call('seeker', 'GET', `/conversations/${chat.json.id}/messages`)).json;
  const list = msgs.items || msgs.messages || msgs;
  assert.equal(list.length, 1, 'greeting sent once');
  assert.equal(list[0].text || list[0].body, 'Grace and peace to you. I will reply soon.');
  const again = await call('seeker', 'POST', '/care/apostle/chat');
  assert.equal(again.json.id, chat.json.id);
  const msgs2 = (await call('seeker', 'GET', `/conversations/${chat.json.id}/messages`)).json;
  assert.equal((msgs2.items || msgs2.messages || msgs2).length, 1, 'no second greeting');
  assert.ok((await q(env, `SELECT 1 FROM notifications WHERE user_id = $1 AND title = 'Talk to an Apostle'`, [ids.apostle])).length === 1);

  // an ordinary DM to the same account is not labelled
  const plain = await call('c1', 'POST', '/conversations/dm', { userId: ids.apostle });
  await call('c1', 'POST', `/conversations/${plain.json.id}/messages`, { text: 'hello' });
  const inbox = await call('apostle', 'GET', '/care/inbox?kind=apostle');
  assert.equal(inbox.json.items.length, 1);
  assert.equal(inbox.json.items[0].requester.id, ids.seeker);
  assert.equal((await call('apostle', 'GET', '/care')).json.isApostle, true);
  assert.equal((await call('apostle', 'POST', '/care/apostle/chat')).json.code, 'IS_APOSTLE');
  assert.equal((await call('seeker', 'GET', '/care/inbox?kind=apostle')).json.items.length, 0, 'only the addressee sees the inbox');

  // auto-reply off → no greeting for the next person
  await call('boss', 'PUT', '/admin/api/care/apostle', { autoReply: false });
  const c2 = await call('c2', 'POST', '/care/apostle/chat');
  const m2 = (await call('c2', 'GET', `/conversations/${c2.json.id}/messages`)).json;
  assert.equal((m2.items || m2.messages || m2).length, 0);
  const admin = await call('boss', 'GET', '/admin/api/care/apostle');
  assert.equal(admin.json.conversations.length, 2);
  assert.equal(admin.json.source, 'settings');

  // cleared → coming soon again
  await call('boss', 'PUT', '/admin/api/care/apostle', { user: '' });
  assert.equal((await call('seeker', 'GET', '/care/apostle')).json.available, false);
});
