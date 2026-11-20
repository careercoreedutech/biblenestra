// CHAT LIMITS (client #27): free users start ≤ chat.free_platform_slots 1:1 chats; invited friends, replies,
// groups and Care chats don't count; subscribers/admins unlimited; referrals; paywall frequency guard (10.3).
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
const dm = async (from, to) => call(from, 'POST', '/conversations/dm', { userId: await id(to) });
const send = async (from, convId, text = 'Hello') => call(from, 'POST', `/conversations/${convId}/messages`, { text });
const slots = async (u) => (await one(env, 'SELECT count(*)::int AS n FROM chat_slots WHERE user_id = $1', [await id(u)])).n;

test('free user: first message to 5 different people uses 5 slots, the 6th is refused with CHAT_LIMIT_REACHED', async () => {
  const me = await call('free1', 'GET', '/me');
  assert.equal(me.json.premium, false);
  assert.equal(me.json.chatFreeSlots, 5);
  let a = (await call('free1', 'GET', '/chat/allowance')).json;
  assert.deepEqual([a.used, a.limit, a.remaining, a.unlimited], [0, 5, 5, false]);

  const convs = [];
  for (let i = 1; i <= 5; i++) {
    const c = await dm('free1', `p${i}`);
    assert.equal(c.status, 201);
    assert.equal(await slots('free1'), i - 1, 'opening a chat does not use a slot by itself');
    const m = await send('free1', c.json.id, `Hi ${i}`);
    assert.equal(m.status, 201);
    convs.push(c.json.id);
  }
  assert.equal(await slots('free1'), 5);
  a = (await call('free1', 'GET', '/chat/allowance')).json;
  assert.deepEqual([a.used, a.remaining], [5, 0]);

  // re-messaging the same people never uses another slot (idempotent per counterparty)
  for (const c of convs) assert.equal((await send('free1', c, 'again')).status, 201);
  assert.equal(await slots('free1'), 5);
  // a duplicate INSERT of the same counterparty is a no-op at the DB level too
  await q(env, 'INSERT INTO chat_slots (user_id, counterparty_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [ids.free1, ids.p1]);
  assert.equal(await slots('free1'), 5);
  // reopening an existing chat is fine
  assert.equal((await dm('free1', 'p1')).status, 200);

  // 6th new person: refused when opening the chat …
  const six = await dm('free1', 'p6');
  assert.equal(six.status, 403);
  assert.equal(six.json.code, 'CHAT_LIMIT_REACHED');
  assert.equal(six.json.used, 5);
  assert.equal(six.json.limit, 5);
  const fu = (await call('free1', 'GET', `/chat/allowance?userId=${await id('p6')}`)).json.forUser;
  assert.deepEqual([fu.needsSlot, fu.blocked], [true, true]);
});

test('server enforcement on the first message too (a DM opened earlier cannot be used to bypass)', async () => {
  // free2 opens a chat with q6 while it has room, then fills up 5 slots, then tries the old empty chat
  const early = await dm('free2', 'q6');
  for (let i = 1; i <= 5; i++) { const c = await dm('free2', `q${i}`); await send('free2', c.json.id); }
  const r = await send('free2', early.json.id, 'sneaky');
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'CHAT_LIMIT_REACHED');
  assert.equal((await one(env, 'SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1', [early.json.id])).n, 0, 'nothing was sent');
  // a coin gift can't start the chat either
  const g = await call('free2', 'POST', `/conversations/${early.json.id}/coins`, { coins: 1 });
  assert.equal(g.status, 403);
  assert.equal(g.json.code, 'CHAT_LIMIT_REACHED');
});

test('replies to someone who messaged you first do not use a slot (default) — and do when CHAT_REPLIES_USE_SLOT=true', async () => {
  // free1 is full (5/5); stranger messages free1 first; free1 can still reply
  const c = await dm('stranger', 'free1');
  assert.equal((await send('stranger', c.json.id, 'Peace be with you')).status, 201);
  const back = await dm('free1', 'stranger');
  assert.equal(back.status, 200, 'the existing chat opens');
  const reply = await send('free1', c.json.id, 'And with you');
  assert.equal(reply.status, 201);
  assert.equal(await slots('free1'), 5);
  assert.equal((await call('free1', 'GET', `/chat/allowance?userId=${await id('stranger')}`)).json.forUser.reason, 'established');

  // configurable: replies count
  env.CHAT_REPLIES_USE_SLOT = 'true';
  try {
    const c2 = await dm('stranger2', 'free1');
    await send('stranger2', c2.json.id, 'Hello friend');
    const r2 = await send('free1', c2.json.id, 'Hi');
    assert.equal(r2.status, 403);
    assert.equal(r2.json.code, 'CHAT_LIMIT_REACHED');
  } finally { delete env.CHAT_REPLIES_USE_SLOT; }
});

test('groups, channels and Care network chats never use slots', async () => {
  // full free1 creates a group with new people and posts there
  const g = await call('free1', 'POST', '/conversations/group', { title: 'Bible study', memberIds: [await id('g1'), await id('g2')] });
  assert.equal(g.status, 201);
  assert.equal((await send('free1', g.json.id, 'Welcome!')).status, 201);
  const ch = await call('free1', 'POST', '/channels', { title: 'Daily light' });
  assert.equal((await send('free1', ch.json.id, 'Verse of the day')).status, 201);
  assert.equal(await slots('free1'), 5);

  // Talk to an Apostle: configure the apostle, open the chat, write — free and unlimited
  const apostleId = await id('apostle');
  await q(env, `INSERT INTO care_settings (key, value) VALUES ('apostle', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify({ userId: apostleId, autoReply: false })]);
  const ap = await call('free1', 'POST', '/care/apostle/chat');
  assert.ok([200, 201].includes(ap.status), JSON.stringify(ap.json));
  assert.equal((await send('free1', ap.json.id, 'Please pray for me')).status, 201);
  assert.equal(await slots('free1'), 5);
});

test('referrals: invite code, permanent referred_by, invited contacts chat without limit', async () => {
  const inv = (await call('inviter', 'GET', '/me/invite')).json;
  assert.match(inv.code, /^[A-Z2-9]{8}$/);
  assert.ok(inv.link.endsWith(`/i/${inv.code}`));
  assert.equal(inv.deepLink, `biblenestra://invite/${inv.code}`);
  assert.equal((await call('inviter', 'GET', '/me/invite')).json.code, inv.code, 'stable');

  // public landing page + preview
  const page = await app.fetch(new Request(`http://api.test/i/${inv.code.toLowerCase()}`), env);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes(`biblenestra://invite/${inv.code}`));
  assert.ok(html.includes('Inviter invited you'));
  assert.equal((await call(null, 'GET', `/invite/${inv.code}`)).json.inviter.displayName, 'Inviter');
  assert.equal((await call(null, 'GET', '/invite/NOPE1234')).status, 404);

  assert.equal((await call('inviter', 'POST', '/me/referral', { code: inv.code })).json.code, 'SELF_REFERRAL');
  assert.equal((await call('newbie', 'POST', '/me/referral', { code: 'ZZZZZZZZ' })).status, 404);
  const ok = await call('newbie', 'POST', '/me/referral', { code: ` ${inv.code.toLowerCase()} ` });
  assert.equal(ok.status, 201);
  assert.equal((await call('newbie', 'POST', '/me/referral', { code: inv.code })).json.already, true, 'same code again is fine');
  const other = (await call('someone', 'GET', '/me/invite')).json.code;
  const again = await call('newbie', 'POST', '/me/referral', { code: other });
  assert.equal(again.status, 409);
  assert.equal(again.json.code, 'ALREADY_REFERRED');
  assert.equal((await one(env, 'SELECT referred_by FROM users WHERE id = $1', [await id('newbie')])).referred_by, await id('inviter'), 'permanent');
  // the reverse claim is pointless and refused
  const newbieCode = (await call('newbie', 'GET', '/me/invite')).json.code;
  assert.equal((await call('inviter', 'POST', '/me/referral', { code: newbieCode })).json.code, 'ALREADY_CONTACTS');

  // inviter sees who joined; newbie sees who invited them
  const after = (await call('inviter', 'GET', '/me/invite')).json;
  assert.deepEqual(after.joined.map((u) => u.id), [await id('newbie')]);
  assert.equal((await call('newbie', 'GET', '/me/invite')).json.invitedBy.id, await id('inviter'));
  assert.equal((await call('newbie', 'GET', '/me/invite')).json.canRedeem, false);

  // claim window: an old account can't attach a code
  await q(env, `UPDATE users SET created_at = now() - interval '30 days' WHERE id = $1`, [await id('oldtimer')]);
  assert.equal((await call('oldtimer', 'POST', '/me/referral', { code: inv.code })).json.code, 'REFERRAL_WINDOW_CLOSED');

  // fill the inviter's 5 slots, then the invited contact is still free both ways
  for (let i = 1; i <= 5; i++) { const c = await dm('inviter', `r${i}`); await send('inviter', c.json.id); }
  assert.equal((await dm('inviter', 'r6')).json.code, 'CHAT_LIMIT_REACHED');
  const c = await dm('inviter', 'newbie');
  assert.equal(c.status, 201);
  assert.equal((await send('inviter', c.json.id, 'Welcome!')).status, 201);
  assert.equal(await slots('inviter'), 5);
  assert.equal((await call('inviter', 'GET', `/chat/allowance?userId=${await id('newbie')}`)).json.forUser.reason, 'invited');
  // the invitee starting chats with the inviter doesn't use a slot either
  assert.equal(await slots('newbie'), 0);
});

test('subscribers and admins are unlimited; an expired subscription is not', async () => {
  await q(env, `UPDATE users SET premium = true, premium_until = NULL WHERE id = $1`, [await id('plus')]);
  for (let i = 1; i <= 7; i++) {
    const c = await dm('plus', `s${i}`);
    assert.equal(c.status, 201);
    assert.equal((await send('plus', c.json.id)).status, 201);
  }
  assert.equal(await slots('plus'), 0);
  const a = (await call('plus', 'GET', '/chat/allowance')).json;
  assert.equal(a.unlimited, true); assert.equal(a.subscriber, true); assert.equal(a.remaining, null);
  assert.equal((await call('plus', 'GET', '/me')).json.premium, true);

  // admin-set premium through the admin API (no billing yet)
  await q(env, `UPDATE users SET role = 'admin' WHERE id = $1`, [await id('boss')]);
  for (let i = 1; i <= 6; i++) { const c = await dm('boss', `b${i}`); assert.equal((await send('boss', c.json.id)).status, 201); }
  assert.equal(await slots('boss'), 0, 'admins unlimited');
  const until = new Date(Date.now() - 1000).toISOString();
  const set = await call('boss', 'PUT', `/admin/api/users/${await id('lapsed')}/premium`, { premium: true, until });
  assert.equal(set.status, 200);
  assert.equal((await call('lapsed', 'GET', '/me')).json.premium, false, 'expired trial = free');
  assert.equal((await call('free1', 'PUT', `/admin/api/users/${await id('lapsed')}/premium`, { premium: true })).status, 403);

  // the limit is remote config
  env.CHAT_FREE_PLATFORM_SLOTS = '1';
  try {
    const c = await dm('tiny', 't1'); assert.equal((await send('tiny', c.json.id)).status, 201);
    assert.equal((await dm('tiny', 't2')).json.limit, 1);
  } finally { delete env.CHAT_FREE_PLATFORM_SLOTS; }
});

test('paywall frequency guard: ≤ paywall.max_impressions_per_day interruptive showings, never for subscribers', async () => {
  let e = (await call('pw', 'GET', '/paywall/eligibility?placement=app_open')).json;
  assert.deepEqual([e.show, e.shownToday, e.max, e.lastShownAt], [true, 0, 2, null]);
  const r1 = (await call('pw', 'POST', '/paywall/impression', { placement: 'app_open' })).json;
  assert.equal(r1.recorded, true); assert.equal(r1.shownToday, 1); assert.ok(r1.lastShownAt);
  assert.equal((await call('pw', 'POST', '/paywall/impression', { placement: 'after_task' })).json.recorded, true);
  const r3 = (await call('pw', 'POST', '/paywall/impression', { placement: 'app_open' })).json;
  assert.deepEqual([r3.recorded, r3.show, r3.reason], [false, false, 'cap']);
  e = (await call('pw', 'GET', '/paywall/eligibility?placement=app_open')).json;
  assert.deepEqual([e.show, e.reason, e.shownToday], [false, 'cap', 2]);
  // the chat-limit prompt answers a user action: always shown (and counted)
  const lim = (await call('pw', 'POST', '/paywall/impression', { placement: 'chat_limit' })).json;
  assert.deepEqual([lim.recorded, lim.reason], [true, 'requested']);
  assert.ok((await one(env, 'SELECT paywall_last_shown_at FROM users WHERE id = $1', [await id('pw')])).paywall_last_shown_at);
  // next local day → allowed again
  await q(env, `UPDATE paywall_impressions SET day = day - 1 WHERE user_id = $1`, [ids.pw]);
  assert.equal((await call('pw', 'GET', '/paywall/eligibility?placement=app_open')).json.show, true);
  // remote config
  env.PAYWALL_MAX_IMPRESSIONS_PER_DAY = '0';
  try { assert.equal((await call('pw', 'GET', '/paywall/eligibility')).json.show, false); } finally { delete env.PAYWALL_MAX_IMPRESSIONS_PER_DAY; }
  // subscribers: never
  const s = (await call('plus', 'POST', '/paywall/impression', { placement: 'chat_limit' })).json;
  assert.deepEqual([s.recorded, s.show, s.reason], [false, false, 'subscriber']);
  assert.equal((await call('pw', 'GET', '/paywall/eligibility?placement=Bad-One')).status, 400);
});
