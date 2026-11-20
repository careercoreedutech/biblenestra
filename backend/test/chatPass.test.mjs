// CHAT WEEK PASS: admins exempt from chat limits; free users who hit the limit spend coins on a 7-day pass of
// extra new chats (atomic, idempotent, stackable); expiry restores the limit; premium unaffected.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { q, one } from '../src/lib/db.js';
import { creditPurchasedCoins } from '../src/lib/coinPurchases.js';

let env; const app = createApp();
before(async () => { env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', CHAT_FREE_PLATFORM_SLOTS: '2' }; });
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
const start = async (from, to) => { const c = await dm(from, to); if (c.status >= 300) return c; return send(from, c.json.id); };
const setCoins = async (u, n) => q(env, 'UPDATE users SET coins = $2 WHERE id = $1', [await id(u), n]);
const coins = async (u) => (await one(env, 'SELECT coins FROM users WHERE id = $1', [await id(u)])).coins;
const ledger = async (u) => q(env, `SELECT amount, ref FROM coin_ledger WHERE user_id = $1 AND reason = 'chat_week_pass'`, [await id(u)]);
const buy = (u, key) => call(u, 'POST', '/chat/pass', { idempotencyKey: key });
const fill = async (u, prefix, n) => { for (let i = 1; i <= n; i++) assert.equal((await start(u, `${prefix}${i}`)).status, 201); };

test('admins are fully exempt: no slots, no paywall, unlimited new chats, no pass to buy', async () => {
  await id('chief');
  await q(env, `UPDATE users SET role = 'admin' WHERE id = $1`, [ids.chief]);
  await fill('chief', 'ac', 6);
  assert.equal((await one(env, 'SELECT count(*)::int AS n FROM chat_slots WHERE user_id = $1', [ids.chief])).n, 0);
  const a = (await call('chief', 'GET', '/chat/allowance')).json;
  assert.deepEqual([a.unlimited, a.admin, a.remaining, a.passOffer], [true, true, null, null]);
  const pw = (await call('chief', 'GET', '/paywall/eligibility?placement=app_open')).json;
  assert.deepEqual([pw.show, pw.reason], [false, 'admin']);
  const imp = (await call('chief', 'POST', '/paywall/impression', { placement: 'chat_limit' })).json;
  assert.deepEqual([imp.recorded, imp.reason], [false, 'admin']);
  const b = await buy('chief', 'admin-key-1');
  assert.equal(b.status, 409); assert.equal(b.json.code, 'PASS_NOT_NEEDED');
});

test('limit error and allowance carry the pass offer and the balance', async () => {
  await fill('fa', 'fa_p', 2);
  const r = await dm('fa', 'fa_p3');
  assert.equal(r.status, 403); assert.equal(r.json.code, 'CHAT_LIMIT_REACHED');
  assert.deepEqual(r.json.passOffer, { coins: 100, extraSlots: 10, unlimited: false, days: 7 });
  assert.equal(r.json.pass, null);
  const a = (await call('fa', 'GET', '/chat/allowance')).json;
  assert.equal(a.coins, 50, 'welcome coins');
  assert.deepEqual([a.used, a.limit, a.remaining, a.pass], [2, 2, 0, null]);
});

test('insufficient coins: refused with balance and price, nothing charged', async () => {
  await setCoins('fa', 40);
  const r = await buy('fa', 'fa-key-0001');
  assert.equal(r.status, 402);
  assert.deepEqual([r.json.code, r.json.balance, r.json.price], ['INSUFFICIENT_COINS', 40, 100]);
  assert.equal(await coins('fa'), 40);
  assert.equal((await ledger('fa')).length, 0);
  assert.equal((await one(env, 'SELECT count(*)::int AS n FROM chat_passes WHERE user_id = $1', [ids.fa])).n, 0);
  assert.equal((await call('fa', 'POST', '/chat/pass', {})).status, 400, 'idempotencyKey required');
});

test('purchase with enough coins → ledger row, 7-day pass, extra new chats; idempotent retry charges once', async () => {
  await setCoins('fa', 250);
  const r = await buy('fa', 'fa-key-0002');
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.coins, 150); assert.equal(r.json.replay, false);
  const until = Date.parse(r.json.pass.until);
  assert.ok(Math.abs(until - (Date.now() + 7 * 86400e3)) < 60e3, 'expires in 7 days');
  assert.deepEqual([r.json.pass.extra, r.json.pass.used, r.json.pass.remaining], [10, 0, 10]);
  const led = await ledger('fa');
  assert.equal(led.length, 1); assert.equal(led[0].amount, -100); assert.equal(led[0].ref, r.json.purchase.id);
  // app ledger shows it with a clear reason
  const items = (await call('fa', 'GET', '/coins/ledger')).json;
  assert.ok(JSON.stringify(items).includes('chat_week_pass'));

  // retry with the same key (e.g. network dropped) → same purchase, no second charge
  const again = await buy('fa', 'fa-key-0002');
  assert.equal(again.status, 200);
  assert.equal(again.json.replay, true); assert.equal(again.json.purchase.id, r.json.purchase.id);
  assert.equal(await coins('fa'), 150);
  assert.equal((await ledger('fa')).length, 1);

  // the 3rd new chat now works through the pass; free count stays at the limit
  assert.equal((await start('fa', 'fa_p3')).status, 201);
  const a = (await call('fa', 'GET', '/chat/allowance')).json;
  assert.deepEqual([a.used, a.limit, a.pass.used, a.pass.remaining, a.remaining], [2, 2, 1, 9, 9]);
  assert.equal((await one(env, 'SELECT via_pass FROM chat_slots WHERE user_id = $1 AND counterparty_id = $2', [ids.fa, await id('fa_p3')])).via_pass, true);
  // re-messaging doesn't use more of the pass
  const c = await dm('fa', 'fa_p3'); assert.equal(c.status, 200); await send('fa', c.json.id, 'again');
  assert.equal((await call('fa', 'GET', '/chat/allowance')).json.pass.used, 1);
});

test('pass extra chats run out → limited again until another pass', async () => {
  env.CHAT_WEEK_PASS_EXTRA_SLOTS = '1';
  try {
    await setCoins('fb', 300);
    await fill('fb', 'fb_p', 2);
    assert.equal((await buy('fb', 'fb-key-0001')).status, 201);
    assert.equal((await start('fb', 'fb_p3')).status, 201);
    const r = await dm('fb', 'fb_p4');
    assert.equal(r.status, 403);
    assert.equal(r.json.pass.remaining, 0);
  } finally { delete env.CHAT_WEEK_PASS_EXTRA_SLOTS; }
});

test('stacking: buying while active extends from the current expiry and adds extra chats', async () => {
  const before = (await call('fa', 'GET', '/chat/allowance')).json.pass;
  const r = await buy('fa', 'fa-key-0003');
  assert.equal(r.status, 201);
  assert.equal(Date.parse(r.json.pass.until) - Date.parse(before.until), 7 * 86400e3, 'extended from current expiry, not from now');
  assert.equal(r.json.pass.startedAt, before.startedAt, 'same chain');
  assert.deepEqual([r.json.pass.extra, r.json.pass.used, r.json.pass.remaining], [20, 1, 19]);
  assert.equal(await coins('fa'), 50);
  assert.equal((await one(env, 'SELECT extended FROM chat_passes WHERE id = $1', [r.json.purchase.id])).extended, true);
});

test('expiry restores the normal limit; chats already started stay open', async () => {
  await q(env, `UPDATE users SET chat_pass_until = now() - interval '1 second' WHERE id = $1`, [ids.fa]);
  const a = (await call('fa', 'GET', '/chat/allowance')).json;
  assert.deepEqual([a.pass, a.remaining], [null, 0]);
  const r = await dm('fa', 'fa_p9');
  assert.equal(r.status, 403); assert.equal(r.json.code, 'CHAT_LIMIT_REACHED');
  // the chat started through the (now expired) pass still works both ways
  const c = await dm('fa', 'fa_p3');
  assert.equal(c.status, 200);
  assert.equal((await send('fa', c.json.id, 'Still here')).status, 201);
  assert.equal((await send('fa_p3', c.json.id, 'Amen')).status, 201);
  // a new purchase after expiry starts a fresh chain from now with its own 10 extra chats
  await setCoins('fa', 100);
  const n = await buy('fa', 'fa-key-0004');
  assert.equal(n.status, 201);
  assert.ok(Math.abs(Date.parse(n.json.pass.until) - (Date.now() + 7 * 86400e3)) < 60e3);
  assert.deepEqual([n.json.pass.extra, n.json.pass.used], [10, 0]);
  assert.equal((await start('fa', 'fa_p9')).status, 201);
});

test('premium users are unaffected: unlimited, no offer, cannot buy a pass', async () => {
  await id('prem');
  await q(env, 'UPDATE users SET premium = true, premium_until = NULL WHERE id = $1', [ids.prem]);
  await fill('prem', 'pr', 4);
  const a = (await call('prem', 'GET', '/chat/allowance')).json;
  assert.deepEqual([a.unlimited, a.subscriber, a.passOffer, a.pass], [true, true, null, null]);
  const b = await buy('prem', 'prem-key-001');
  assert.equal(b.status, 409); assert.equal(b.json.code, 'PASS_NOT_NEEDED');
  assert.equal(await coins('prem'), 50);
});

test('price and grant are remote config; "unlimited" pass', async () => {
  env.CHAT_WEEK_PASS_COINS = '30'; env.CHAT_WEEK_PASS_EXTRA_SLOTS = 'unlimited';
  try {
    await fill('fc', 'fc_p', 2);
    const r = await buy('fc', 'fc-key-0001');
    assert.equal(r.status, 201);
    assert.deepEqual(r.json.passOffer, { coins: 30, extraSlots: null, unlimited: true, days: 7 });
    assert.equal(r.json.coins, 20);
    assert.equal(r.json.pass.unlimited, true);
    await fill('fc', 'fc_q', 4);
    assert.equal((await call('fc', 'GET', '/chat/allowance')).json.remaining, null);
  } finally { delete env.CHAT_WEEK_PASS_COINS; delete env.CHAT_WEEK_PASS_EXTRA_SLOTS; }
});

test('admin purchase log', async () => {
  assert.equal((await call('fa', 'GET', '/admin/api/chat-passes')).status, 403);
  const d = (await call('chief', 'GET', '/admin/api/chat-passes')).json;
  assert.equal(d.totals.purchases, 5);
  assert.equal(d.items[0].user.id, await id('fc'), 'newest first');
  assert.equal(d.offer.coins, 100);
  const page = await app.fetch(new Request('http://api.test/admin'), env);
  assert.ok((await page.text()).includes("registerAdminTab('Chat passes'"));
});

test('Play Billing hook credits coins once per purchase token', async () => {
  const uid = await id('payer');
  const a = await creditPurchasedCoins(env, uid, 500, { purchaseToken: 'tok-123', productId: 'coins_500' });
  assert.deepEqual(a, { credited: true, coins: 550 });
  const b = await creditPurchasedCoins(env, uid, 500, { purchaseToken: 'tok-123', productId: 'coins_500' });
  assert.deepEqual(b, { credited: false, coins: 550 });
});
