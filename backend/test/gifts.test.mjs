// VIRTUAL GIFTS & STARS: catalogue, the 20/80 split (exact integer legs), idempotency, concurrency, contexts (chat / group /
// profile / live / post), the chat 'gift' message, commission changes, earnings states, creator programme + withdrawals,
// purchased coins never withdrawable, admin-only routes, reconciliation and the messages kind constraint.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { q, one } from '../src/lib/db.js';
import * as W from '../src/lib/wallet.js';
import { coinsOf } from '../src/lib/virtualGifts.js';
import { GIFTS_ADMIN_SCRIPT } from '../src/lib/giftsAdminPage.js';

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true' };
});
async function call(user, method, path, body, headers = {}) {
  const h = { ...headers };
  if (user) h['X-Dev-User'] = user;
  let b = body;
  if (body !== undefined && !(body instanceof Uint8Array)) { b = JSON.stringify(body); h['Content-Type'] = h['Content-Type'] || 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${path}`, { method, headers: h, body: b }), env);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (err) { json = text; }
  return { status: res.status, json };
}
const ids = {};
let n = 0;
const key = () => `gk_${Date.now()}_${++n}_${Math.random().toString(36).slice(2, 8)}`;
const bal = (u, w) => W.getBalance(env, ids[u], w);
const platform = async () => Number(((await one(env, `SELECT balance FROM wallet_balances WHERE account = 'platform' AND wallet = 'commission_gift_coins'`)) || { balance: 0 }).balance);
const fund = (u, amount) => W.credit(env, { ref: `seed:${u}:${key()}`, userId: ids[u], wallet: 'gift_coins', amount, kind: 'admin_adjust' });
const send = (u, giftId, context, extra = {}) => call(u, 'POST', '/gifts/send', { giftId, context, idempotencyKey: extra.idempotencyKey || key(), ...extra });
const setCfg = (k, v) => call('boss', 'PUT', '/admin/api/wallet/config', { key: k, value: v });

test('setup: boss admin, members, admin script is a plain string', async () => {
  for (const u of ['boss', 'amy', 'bob', 'cal', 'dee', 'eve', 'fay', 'gus']) ids[u] = (await call(u, 'GET', '/me')).json.id;
  await q(env, `UPDATE users SET role = 'admin' WHERE id = $1`, [ids.boss]);
  assert.ok(!GIFTS_ADMIN_SCRIPT.includes('`') && !GIFTS_ADMIN_SCRIPT.includes('${'), 'admin script must be a plain string');
});

test('catalogue: the 10 client gifts, coin cost derived from the admin conversion rate, per-item override', async () => {
  const r = await call('amy', 'GET', '/gifts/catalogue');
  assert.equal(r.status, 200);
  const by = Object.fromEntries(r.json.items.map((g) => [g.id, g]));
  const expect = { star: 20000, flowers: 50000, heart: 100000, teddy: 150000, love_letter: 250000, diamonds: 500000, crown: 1000000, gold_trophy: 2000000, celebration: 4000000, premium: 10000000 };
  for (const [id, minor] of Object.entries(expect)) { assert.equal(by[id].priceMinor, minor, id); assert.equal(by[id].coins, minor / 100, id); }
  assert.equal(by.crown.tier, 'premium'); assert.equal(by.star.tier, 'standard');
  assert.equal(r.json.rules.commissionPct, 20);
  // rate change → derived costs follow (never hard-coded ₦1 = 1 coin)
  assert.equal((await setCfg('gift_coin_rate', { coins: 2, perMinor: 100, currency: 'NGN' })).status, 200);
  assert.equal((await call('amy', 'GET', '/gifts/catalogue')).json.items.find((g) => g.id === 'star').coins, 400);
  await setCfg('gift_coin_rate', { coins: 1, perMinor: 100, currency: 'NGN' });
  assert.equal(coinsOf({ price_minor: 20050, coins: null }, { coins: 1, perMinor: 100 }), 201); // rounded up
  // per-item override
  assert.equal((await call('boss', 'PATCH', '/admin/api/gifts/catalogue/star', { coins: 150 })).json.coins, 150);
  assert.equal((await call('amy', 'GET', '/gifts/catalogue')).json.items.find((g) => g.id === 'star').coins, 150);
  assert.equal((await call('boss', 'PATCH', '/admin/api/gifts/catalogue/star', { coins: null })).json.coins, 200);
  // admin creates the test items used below
  for (const [id, coins] of [['t2000', 2000], ['t1999', 1999], ['t7', 7], ['t1', 1], ['t300', 300]]) {
    const c = await call('boss', 'POST', '/admin/api/gifts/catalogue', { id, name: `Test ${coins}`, priceMinor: coins * 100, coins, art: 'star' });
    assert.equal(c.status, 201, JSON.stringify(c.json));
  }
});

test('a 2,000-coin gift: sender −2,000, commission +400, recipient +1,600 — one atomic op', async () => {
  await fund('amy', 5000);
  const p0 = await platform();
  const r = await send('amy', 't2000', { type: 'profile', id: ids.bob });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.deepEqual([r.json.split.coins, r.json.split.commission, r.json.split.earnings], [2000, 400, 1600]);
  assert.equal(await bal('amy', 'gift_coins'), 3000);
  assert.equal(r.json.balance, 3000);
  assert.equal(await bal('bob', 'gift_earnings'), 1600);
  assert.equal(await platform() - p0, 400);
  const entries = await q(env, 'SELECT wallet, amount FROM wallet_entries WHERE ref = $1 ORDER BY leg', [r.json.send.ref]);
  assert.deepEqual(entries.map((e) => [e.wallet, Number(e.amount)]), [['gift_coins', -2000], ['gift_earnings', 1600], ['commission_gift_coins', 400]]);
  const row = await one(env, 'SELECT * FROM gift_sends WHERE ref = $1', [r.json.send.ref]);
  assert.equal(row.commission, 400); assert.equal(row.earnings, 1600); assert.equal(row.commission_bps, 2000);
  // gift_earnings is NOT spendable or giftable
  await assert.rejects(W.spend(env, { ref: `x:${key()}`, userId: ids.bob, wallet: 'gift_earnings', amount: 1, kind: 'gift_sent' }), (e) => e.code === 'NOT_SPENDABLE');
});

test('odd amounts: commission rounds down, legs always sum exactly to the gift value', async () => {
  await fund('cal', 10000);
  for (const [gid, coins, comm] of [['t1999', 1999, 399], ['t7', 7, 1], ['t1', 1, 0]]) {
    const before = { s: await bal('cal', 'gift_coins'), r: await bal('dee', 'gift_earnings'), p: await platform() };
    const r = await send('cal', gid, { type: 'profile', id: ids.dee });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.split.commission, comm);
    assert.equal(r.json.split.commission + r.json.split.earnings, coins);
    assert.equal(before.s - (await bal('cal', 'gift_coins')), coins, 'sender charged the full value');
    assert.equal((await bal('dee', 'gift_earnings')) - before.r, coins - comm);
    assert.equal((await platform()) - before.p, comm);
    const sum = await one(env, 'SELECT sum(amount)::int AS s FROM wallet_entries WHERE ref = $1', [r.json.send.ref]);
    assert.equal(sum.s, 0, 'debit + credits = 0');
  }
});

test('insufficient balance: 402, nothing written; self-gift refused; inactive gift refused', async () => {
  const before = await bal('eve', 'gift_coins');
  const r = await send('eve', 'crown', { type: 'profile', id: ids.bob });
  assert.equal(r.status, 402); assert.equal(r.json.code, 'INSUFFICIENT_BALANCE'); assert.equal(r.json.wallet, 'gift_coins'); assert.equal(r.json.needed, 10000);
  assert.equal(await bal('eve', 'gift_coins'), before);
  assert.equal((await one(env, 'SELECT count(*)::int AS n FROM gift_sends WHERE sender_id = $1', [ids.eve])).n, 0);
  await fund('eve', 1000);
  const self = await send('eve', 'star', { type: 'profile', id: ids.eve });
  assert.equal(self.status, 400); assert.equal(self.json.code, 'SELF_GIFT');
  await call('boss', 'PATCH', '/admin/api/gifts/catalogue/t300', { active: false });
  const off = await send('eve', 't300', { type: 'profile', id: ids.bob });
  assert.equal(off.json.code, 'GIFT_INACTIVE');
  assert.ok(!(await call('eve', 'GET', '/gifts/catalogue')).json.items.some((g) => g.id === 't300'));
  await call('boss', 'PATCH', '/admin/api/gifts/catalogue/t300', { active: true });
  assert.equal(await bal('eve', 'gift_coins'), 1000);
  // admin accounts are not eligible recipients by default
  assert.equal((await send('eve', 'star', { type: 'profile', id: ids.boss })).json.code, 'RECIPIENT_NOT_ELIGIBLE');
});

test('idempotent: the same key twice (and concurrently) charges once; same key for another gift → 409', async () => {
  await fund('fay', 2000);
  const k = key();
  const a = await send('fay', 'star', { type: 'profile', id: ids.gus }, { idempotencyKey: k });
  const b = await send('fay', 'star', { type: 'profile', id: ids.gus }, { idempotencyKey: k });
  assert.equal(a.status, 201); assert.equal(b.status, 200); assert.equal(b.json.duplicate, true); assert.equal(b.json.send.id, a.json.send.id);
  assert.equal(await bal('fay', 'gift_coins'), 1800);
  const k2 = key();
  const all = await Promise.all([1, 2, 3].map(() => send('fay', 'star', { type: 'profile', id: ids.gus }, { idempotencyKey: k2 })));
  assert.ok(all.every((r) => r.status === 201 || r.status === 200), JSON.stringify(all.map((r) => r.json)));
  assert.equal(await bal('fay', 'gift_coins'), 1600);
  assert.equal((await one(env, 'SELECT count(*)::int AS n FROM gift_sends WHERE sender_id = $1', [ids.fay])).n, 2);
  assert.equal((await send('fay', 'flowers', { type: 'profile', id: ids.gus }, { idempotencyKey: k })).json.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal((await call('fay', 'POST', '/gifts/send', { giftId: 'star', context: { type: 'profile', id: ids.gus } })).json.code, 'BAD_IDEMPOTENCY_KEY');
});

test('concurrent sends cannot overdraw the Gifting Coin wallet', async () => {
  await fund('gus', 1000);
  const r = await Promise.allSettled([1, 2, 3, 4, 5].map(() => send('gus', 't300', { type: 'profile', id: ids.amy })));
  const ok = r.filter((x) => x.value.status === 201).length;
  assert.equal(ok, 3);
  assert.ok(r.filter((x) => x.value.status === 402).length === 2);
  assert.equal(await bal('gus', 'gift_coins'), 100);
  assert.equal((await W.ledgerIntegrity(env)).ok, true);
});

let dm; let group;
test('chat context: gift message in the conversation, members only, groups need a member recipient', async () => {
  dm = (await call('amy', 'POST', '/conversations/dm', { userId: ids.cal })).json.id;
  const r = await send('amy', 'heart', { type: 'chat', id: dm }, { note: 'Praying for you' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.send.recipient.id, ids.cal);
  assert.equal(r.json.message.kind, 'gift');
  assert.equal(r.json.message.meta.vgift.giftId, 'heart');
  const page = await call('cal', 'GET', `/conversations/${dm}/messages`);
  const m = page.json.items.find((x) => x.id === r.json.message.id);
  assert.ok(m, 'the gift message is in the conversation'); assert.equal(m.kind, 'gift'); assert.equal(m.meta.vgift.note, 'Praying for you');
  assert.ok(m.text.includes('Heart'));
  // edit / forward refused; reacting works
  assert.equal((await call('amy', 'PATCH', `/messages/${m.id}`, { text: 'changed' })).json.code, 'NOT_EDITABLE');
  assert.equal((await call('amy', 'POST', `/messages/${m.id}/forward`, { conversationIds: [dm] })).json.code, 'NOT_ALLOWED');
  assert.equal((await call('cal', 'POST', `/messages/${m.id}/react`, { emoji: '🙏' })).status, 200);
  // a stranger can't gift in someone else's chat
  await fund('eve', 2000);
  const nm = await send('eve', 'star', { type: 'chat', id: dm });
  assert.equal(nm.status, 403); assert.equal(nm.json.code, 'NOT_A_MEMBER');
  // DM recipient must be the other member
  assert.equal((await send('amy', 'star', { type: 'chat', id: dm }, { recipientId: ids.bob })).json.code, 'BAD_RECIPIENT');
  // groups: choose a member
  group = (await call('amy', 'POST', '/conversations/group', { title: 'Gift group', memberIds: [ids.bob, ids.dee] })).json.id;
  assert.equal((await send('amy', 'star', { type: 'chat', id: group })).json.code, 'BAD_RECIPIENT');
  assert.equal((await send('amy', 'star', { type: 'chat', id: group }, { recipientId: ids.gus })).json.code, 'BAD_RECIPIENT');
  const g = await send('amy', 'star', { type: 'chat', id: group }, { recipientId: ids.dee });
  assert.equal(g.status, 201); assert.equal(g.json.send.recipient.id, ids.dee);
  assert.ok((await call('bob', 'GET', `/conversations/${group}/messages`)).json.items.some((x) => x.kind === 'gift'));
  // blocked people can't be gifted
  await call('gus', 'POST', `/users/${ids.eve}/block`);
  assert.equal((await send('eve', 'star', { type: 'profile', id: ids.gus })).json.code, 'BLOCKED');
});

test('live context: only while live, always to the host; post context: to the author', async () => {
  const live = await call('bob', 'POST', '/live-sessions', { title: 'Evening worship' });
  assert.equal(live.status, 201);
  assert.ok((await call('amy', 'GET', '/live-sessions')).json.items.some((s) => s.id === live.json.id));
  const r = await send('amy', 'star', { type: 'live', id: live.json.id });
  assert.equal(r.status, 201); assert.equal(r.json.send.recipient.id, ids.bob);
  assert.equal((await send('amy', 'star', { type: 'live', id: live.json.id }, { recipientId: ids.cal })).json.code, 'BAD_RECIPIENT');
  const feed = await call('cal', 'GET', `/live-sessions/${live.json.id}`);
  assert.equal(feed.json.gifts.length, 1);
  assert.equal((await call('amy', 'POST', `/live-sessions/${live.json.id}/end`)).status, 403); // only the host
  await call('bob', 'POST', `/live-sessions/${live.json.id}/end`);
  const ended = await send('amy', 'star', { type: 'live', id: live.json.id });
  assert.equal(ended.status, 400); assert.equal(ended.json.code, 'LIVE_ENDED');
  const post = (await call('dee', 'POST', '/posts', { text: 'Thank you Lord for today' })).json;
  const pg = await send('amy', 'star', { type: 'post', id: post.id });
  assert.equal(pg.status, 201); assert.equal(pg.json.send.recipient.id, ids.dee);
  assert.equal((await send('amy', 'star', { type: 'nowhere', id: post.id })).json.code, 'BAD_CONTEXT');
  // a gift limited to some contexts
  await call('boss', 'PATCH', '/admin/api/gifts/catalogue/t300', { contexts: ['chat'] });
  assert.equal((await send('amy', 't300', { type: 'profile', id: ids.bob })).json.code, 'GIFT_NOT_ALLOWED_HERE');
  await call('boss', 'PATCH', '/admin/api/gifts/catalogue/t300', { contexts: ['chat', 'profile', 'live', 'post'] });
});

test('commission % change applies only to new gifts', async () => {
  const old = await one(env, 'SELECT * FROM gift_sends ORDER BY created_at LIMIT 1');
  assert.equal((await setCfg('gift_commission_bps', 2500)).status, 200);
  await fund('amy', 2000);
  const r = await send('amy', 't2000', { type: 'profile', id: ids.cal });
  assert.deepEqual([r.json.split.commission, r.json.split.earnings, r.json.split.bps], [500, 1500, 2500]);
  const again = await one(env, 'SELECT * FROM gift_sends WHERE id = $1', [old.id]);
  assert.equal(again.commission, old.commission); assert.equal(again.commission_bps, 2000);
  await setCfg('gift_commission_bps', 2000);
});

test('histories, profile wall, earnings summary', async () => {
  const h = await call('amy', 'GET', '/gifts/history?dir=sent');
  assert.equal(h.status, 200);
  assert.ok(h.json.items.length >= 5); assert.ok(h.json.items.every((x) => x.direction === 'sent'));
  const rx = await call('bob', 'GET', '/gifts/history?dir=received');
  assert.ok(rx.json.items.some((x) => x.coins === 2000 && x.earnings === 1600));
  const wall = await call('cal', 'GET', `/gifts/wall/${ids.bob}`);
  assert.ok(wall.json.total >= 2); assert.ok(wall.json.gifts.some((g) => g.id === 't2000'));
  assert.ok(wall.json.recent.every((x) => x.context.type !== 'chat'), 'private chat gifts are not listed on the wall');
  const e = await call('bob', 'GET', '/gifts/earnings');
  assert.equal(e.json.balances.pending, await bal('bob', 'gift_earnings'));
  assert.equal(e.json.canWithdraw, false); assert.equal(e.json.withdrawBlocked.code, 'WITHDRAWALS_CLOSED');
  assert.ok(e.json.rules.explain.join(' ').includes('keeps 20%'));
});

test('withdrawals: closed switch, approval, hold period, minimum, admin queue (approve → paid; reject returns coins)', async () => {
  // bob has 1600+ pending earnings
  assert.equal((await call('bob', 'POST', '/gifts/withdrawals', { coins: 1000, idempotencyKey: key() })).json.code, 'WITHDRAWALS_CLOSED');
  await setCfg('earnings_withdrawals_enabled', true);
  await setCfg('earnings_min_withdrawal', 500);
  assert.equal((await call('bob', 'POST', '/gifts/withdrawals', { coins: 1000, idempotencyKey: key() })).json.code, 'NOT_APPROVED');
  const app1 = await call('bob', 'POST', '/gifts/programme', { legalName: 'Bob Builder', bankName: 'GTBank', accountName: 'Bob Builder', accountNumber: '0123456789' });
  assert.equal(app1.status, 201); assert.equal(app1.json.programme.status, 'pending'); assert.equal(app1.json.programme.accountNumber, '•••• 6789');
  assert.equal((await call('bob', 'POST', `/admin/api/gifts/programme/${ids.bob}`, { status: 'approved' })).status, 403);
  assert.equal((await call('boss', 'POST', `/admin/api/gifts/programme/${ids.bob}`, { status: 'approved' })).status, 200);
  // earnings are still pending (hold period) → nothing available
  const pend = await call('bob', 'POST', '/gifts/withdrawals', { coins: 1000, idempotencyKey: key() });
  assert.equal(pend.status, 402); assert.equal(pend.json.code, 'INSUFFICIENT_BALANCE');
  // the core cron releases matured earnings
  await W.releaseMaturedEarnings(env, { now: new Date(Date.now() + 30 * 86400e3) });
  const avail = await bal('bob', 'gift_earnings_available');
  assert.ok(avail >= 1600);
  assert.equal((await call('bob', 'POST', '/gifts/withdrawals', { coins: 100, idempotencyKey: key() })).json.code, 'BELOW_MINIMUM');
  const k = key();
  const w = await call('bob', 'POST', '/gifts/withdrawals', { coins: 1000, idempotencyKey: k });
  assert.equal(w.status, 201, JSON.stringify(w.json)); assert.equal(w.json.withdrawal.status, 'requested'); assert.equal(w.json.withdrawal.payoutMinor, 100000);
  assert.equal((await call('bob', 'POST', '/gifts/withdrawals', { coins: 1000, idempotencyKey: k })).json.duplicate, true);
  assert.equal(await bal('bob', 'gift_earnings_withdrawing'), 1000);
  assert.equal(await bal('bob', 'gift_earnings_available'), avail - 1000);
  assert.equal((await call('bob', 'POST', '/gifts/withdrawals', { coins: 500, idempotencyKey: key() })).json.code, 'WITHDRAWAL_OPEN');
  const id = w.json.withdrawal.id;
  assert.equal((await call('boss', 'POST', `/admin/api/gifts/withdrawals/${id}/paid`, { reference: 'TRF-1' })).json.code, 'WITHDRAWAL_STATE');
  assert.equal((await call('boss', 'POST', `/admin/api/gifts/withdrawals/${id}/approve`)).json.status, 'approved');
  const paid = await call('boss', 'POST', `/admin/api/gifts/withdrawals/${id}/paid`, { reference: 'TRF-0001' });
  assert.equal(paid.json.status, 'paid'); assert.equal(paid.json.reference, 'TRF-0001');
  assert.equal(await bal('bob', 'gift_earnings_withdrawing'), 0);
  assert.equal(await bal('bob', 'gift_earnings_withdrawn'), 1000);
  assert.equal((await call('boss', 'POST', `/admin/api/gifts/withdrawals/${id}/reject`, { note: 'too late now' })).json.code, 'WITHDRAWAL_STATE');
  // reject returns the coins to available
  const w2 = await call('bob', 'POST', '/gifts/withdrawals', { coins: 500, idempotencyKey: key() });
  assert.equal((await call('boss', 'POST', `/admin/api/gifts/withdrawals/${w2.json.withdrawal.id}/reject`, { note: 'Bank details do not match' })).json.status, 'rejected');
  assert.equal(await bal('bob', 'gift_earnings_withdrawing'), 0);
  assert.equal(await bal('bob', 'gift_earnings_available'), avail - 1000);
  assert.equal((await W.ledgerIntegrity(env)).ok, true);
});

test('purchased Gifting Coins are never withdrawable', async () => {
  await fund('fay', 50000);
  await call('fay', 'POST', '/gifts/programme', { legalName: 'Fay Faith', bankName: 'Access', accountName: 'Fay Faith', accountNumber: '9876543210' });
  await call('boss', 'POST', `/admin/api/gifts/programme/${ids.fay}`, { status: 'approved' });
  const coins = await bal('fay', 'gift_coins');
  const r = await call('fay', 'POST', '/gifts/withdrawals', { coins: 5000, idempotencyKey: key() });
  assert.equal(r.status, 402); assert.equal(r.json.code, 'INSUFFICIENT_BALANCE'); assert.equal(r.json.wallet, 'gift_earnings_available');
  assert.equal(await bal('fay', 'gift_coins'), coins);
  const card = (await call('fay', 'GET', '/wallet')).json.wallets.find((x) => x.wallet === 'gift_coins');
  assert.equal(card.withdrawable, false);
  await setCfg('earnings_withdrawals_enabled', false);
});

test('admin-only routes; catalogue art upload goes to R2', async () => {
  for (const [m, p] of [['GET', '/admin/api/gifts/catalogue'], ['GET', '/admin/api/gifts/sends'], ['GET', '/admin/api/gifts/commission'], ['GET', '/admin/api/gifts/withdrawals'],
    ['GET', '/admin/api/gifts/programme'], ['GET', '/admin/api/gifts/earnings'], ['POST', '/admin/api/gifts/catalogue'], ['PATCH', '/admin/api/gifts/catalogue/star']]) {
    const r = await call('amy', m, p, m === 'GET' ? undefined : {});
    assert.equal(r.status, 403, `${m} ${p}`);
  }
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  const up = await call('boss', 'POST', '/admin/api/gifts/catalogue/crown/art?slot=animation', png, { 'Content-Type': 'image/gif' });
  assert.equal(up.status, 201, JSON.stringify(up.json));
  assert.ok(/^img\/gifts\/crown\/.+\.gif$/.test(up.json.animationKey));
  assert.ok(await env.MEDIA.head(up.json.animationKey));
  assert.equal((await call('boss', 'POST', '/admin/api/gifts/catalogue/crown/art', png, { 'Content-Type': 'image/svg+xml' })).json.code, 'BAD_IMAGE_TYPE');
  const s = await call('boss', 'GET', `/admin/api/gifts/sends?q=${ids.amy}&role=sent`);
  assert.ok(s.json.items.length >= 5 && s.json.items.every((x) => x.sender.id === ids.amy));
  const byRef = await call('boss', 'GET', `/admin/api/gifts/sends?ref=${encodeURIComponent(s.json.items[0].ref)}`);
  assert.equal(byRef.json.items.length, 1);
  const earn = await call('boss', 'GET', '/admin/api/gifts/earnings');
  assert.ok(earn.json.items.some((x) => x.user.id === ids.bob && x.balances.withdrawn === 1000));
});

test('commission ledger reconciles with gift rows and the wallet core integrity check', async () => {
  const r = await call('boss', 'GET', '/admin/api/gifts/commission?group=month');
  assert.equal(r.status, 200);
  assert.equal(r.json.reconciliation.ok, true, JSON.stringify(r.json.reconciliation));
  assert.equal(r.json.integrity.ok, true);
  const rows = await one(env, 'SELECT sum(commission)::int AS c FROM gift_sends');
  assert.equal(r.json.periods.reduce((a, p) => a + p.commission, 0), rows.c);
  assert.ok(r.json.perGift.some((g) => g.gift_id === 't2000'));
  const day = await call('boss', 'GET', '/admin/api/gifts/commission?group=day');
  assert.equal(day.json.group, 'day');
});

test('messages kind constraint keeps every earlier kind and adds gift', async () => {
  const c = await one(env, `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'messages_kind_check'`);
  for (const k of ['text', 'image', 'voice', 'verse', 'prayer', 'event', 'video', 'file', 'system', 'gift']) assert.ok(c.d.includes(`'${k}'`), k);
  // ordinary sends can't create a gift bubble
  const r = await call('amy', 'POST', `/conversations/${dm}/messages`, { kind: 'gift', text: 'fake' });
  assert.equal(r.status, 400);
});
