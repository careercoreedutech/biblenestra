// Contests: server-side scoring, one attempt, hidden answers, ranking, prize payout exactly once.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', ADS_CLIENT_CLAIM: 'true', ADMIN_PASSWORD: 'test-admin-pass', REALTIME_SECRET: 'test-secret' };
});

async function call(user, method, path, body) {
  const h = {};
  if (user && user.startsWith('admin_token_')) h.Authorization = `Bearer ${user}`;
  else if (user) h['X-Dev-User'] = user;
  let b;
  if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${path}`, { method, headers: h, body: b }), env);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = text; }
  return { status: res.status, json };
}
const sql = (text, params) => env.__db.query(text, params);
const inAnHour = () => new Date(Date.now() + 3600000).toISOString();

let admin; let id; let answerKey;

test('only admins can create; validation', async () => {
  admin = (await call(null, 'POST', '/admin/api/login', { username: 'benjamin', password: 'test-admin-pass' })).json.token;
  assert.ok(admin);
  assert.equal((await call('alice', 'POST', '/admin/api/contests', { title: 'Nope', endsAt: inAnHour(), prizeCoins: [10] })).status, 403);
  assert.equal((await call(admin, 'POST', '/admin/api/contests', { title: 'No prize', endsAt: inAnHour() })).status, 400);
  assert.equal((await call(admin, 'POST', '/admin/api/contests', { title: 'Past', endsAt: new Date(Date.now() - 1000).toISOString(), prizeCoins: [10] })).status, 400);
});

test('create a contest; players see it without answers', async () => {
  const r = await call(admin, 'POST', '/admin/api/contests', { title: 'Advent Challenge', description: 'Test', prizeCoins: [500, 250], prizeText: 'A study Bible', questionCount: 5, secondsPerQuestion: 20, endsAt: inAnHour(), notifyAll: true });
  assert.equal(r.status, 201);
  id = r.json.id;
  assert.equal(r.json.status, 'live');
  assert.deepEqual(r.json.prizeCoins, [500, 250]);
  assert.equal(r.json.questions, undefined);

  const full = await call(admin, 'GET', `/admin/api/contests/${id}`);
  assert.equal(full.json.questions.length, 15); // pool = 3 × questions
  answerKey = Object.fromEntries(full.json.questions.map((x) => [x.id, x.a]));

  const list = await call('alice', 'GET', '/contests');
  const c = list.json.items.find((x) => x.id === id);
  assert.equal(c.myEntry, null);
  assert.equal(c.questions, undefined);
  assert.equal(c.prize_coins, undefined);
  assert.ok((await call('alice', 'GET', '/me/notifications')).json.items.some((n) => n.kind === 'contest'));
});

test('start gives questions without answers, and returns the same ones if repeated', async () => {
  const a = await call('alice', 'POST', `/contests/${id}/start`);
  assert.equal(a.status, 200);
  assert.equal(a.json.questions.length, 5);
  for (const q of a.json.questions) { assert.equal(q.a, undefined); assert.equal(q.correctIndex, undefined); assert.ok(q.question && q.options.length); }
  assert.ok(a.json.remainingSeconds > 0 && a.json.remainingSeconds <= 100);
  const again = await call('alice', 'POST', `/contests/${id}/start`);
  assert.deepEqual(again.json.questions.map((q) => q.id), a.json.questions.map((q) => q.id));
});

const play = async (user, nRight) => {
  const s = await call(user, 'POST', `/contests/${id}/start`);
  assert.equal(s.status, 200);
  const answers = {};
  s.json.questions.forEach((q, i) => { answers[q.id] = i < nRight ? answerKey[q.id] : (answerKey[q.id] + 1) % q.options.length; });
  return call(user, 'POST', `/contests/${id}/submit`, { answers });
};

test('the server does the scoring; one attempt only; review waits for the end', async () => {
  const a = await play('alice', 3);
  assert.equal(a.status, 200);
  assert.equal(a.json.correct, 3);
  assert.equal(a.json.total, 5);
  assert.equal(a.json.place, 1);
  assert.equal((await call('alice', 'POST', `/contests/${id}/start`)).status, 409);
  // submitting again can't change the score
  const cheat = await call('alice', 'POST', `/contests/${id}/submit`, { answers: answerKey });
  assert.equal(cheat.json.correct, 3);
  assert.equal((await call('alice', 'GET', `/contests/${id}/review`)).status, 409);
  // answers for questions you weren't given don't count; rubbish doesn't either
  assert.equal((await call('dan', 'POST', `/contests/${id}/submit`, { answers: {} })).status, 409);
});

test('ranking: most correct first, then fastest; zero scores stay off the board', async () => {
  assert.equal((await play('bob', 5)).json.place, 1);
  await play('cara', 3);
  await play('zero', 0);
  // cara answered the same number as alice but was slower
  const cid = (await call('cara', 'GET', '/me')).json.id;
  await sql('UPDATE contest_entries SET duration_ms = 90000 WHERE contest_id = $1 AND user_id = $2', [id, cid]);
  const b = await call('alice', 'GET', `/contests/${id}/leaderboard`);
  assert.equal(b.status, 200);
  assert.deepEqual(b.json.items.map((x) => [x.place, x.correct]), [[1, 5], [2, 3], [3, 3]]);
  assert.equal(b.json.items[1].isMe, true);
  assert.equal(b.json.items.length, 3);
});

test('an attempt handed in after the timer scores nothing', async () => {
  await call('late', 'POST', `/contests/${id}/start`);
  const lid = (await call('late', 'GET', '/me')).json.id;
  await sql(`UPDATE contest_entries SET started_at = now() - interval '10 minutes' WHERE contest_id = $1 AND user_id = $2`, [id, lid]);
  const r = await call('late', 'POST', `/contests/${id}/submit`, { answers: answerKey });
  assert.equal(r.json.timedOut, true);
  assert.equal(r.json.correct, 0);
});

test('closed contests refuse new players; prizes wait for attempts in progress, then pay once', async () => {
  const before = (await call('bob', 'GET', '/me')).json.coins;
  const beforeAlice = (await call('alice', 'GET', '/me')).json.coins;
  await call('slow', 'POST', `/contests/${id}/start`);
  assert.equal((await call(admin, 'POST', `/admin/api/contests/${id}/end`)).status, 200);
  const closed = await call('newbie', 'POST', `/contests/${id}/start`);
  assert.equal(closed.status, 409);
  assert.equal(closed.json.code, 'CONTEST_NOT_LIVE');

  // still judging: someone may be mid-attempt, so nothing is paid yet
  let c = await call('bob', 'GET', `/contests/${id}`);
  assert.equal(c.json.status, 'judging');
  assert.equal((await call('bob', 'GET', '/me')).json.coins, before);

  await sql(`UPDATE contests SET ends_at = now() - interval '1 hour', starts_at = now() - interval '2 hours' WHERE id = $1`, [id]);
  c = await call('bob', 'GET', `/contests/${id}`);
  assert.equal(c.json.status, 'completed');
  assert.equal(c.json.myEntry.place, 1);
  assert.equal(c.json.myEntry.prizeCoins, 500);
  assert.equal((await call('bob', 'GET', '/me')).json.coins, before + 500);
  assert.equal((await call('alice', 'GET', '/me')).json.coins, beforeAlice + 250);

  // looking again doesn't pay again
  await call('bob', 'GET', `/contests/${id}`);
  await call('alice', 'GET', '/contests');
  assert.equal((await call('bob', 'GET', '/me')).json.coins, before + 500);
  const ledger = await call('bob', 'GET', '/coins/ledger');
  assert.equal(ledger.json.items.filter((x) => x.reason === 'contest_prize').length, 1);
  assert.ok((await call('bob', 'GET', '/me/notifications')).json.items.some((n) => n.kind === 'contest' && /#1/.test(n.title)));

  // answers can be reviewed now
  const review = await call('alice', 'GET', `/contests/${id}/review`);
  assert.equal(review.status, 200);
  assert.equal(review.json.items.length, 5);
  assert.equal(review.json.items.filter((x) => x.myAnswer === x.correctIndex).length, 3);
  assert.ok(review.json.items[0].reference);
});

test('cancelled contests disappear and pay nothing', async () => {
  const r = await call(admin, 'POST', '/admin/api/contests', { title: 'Cancelled one', prizeCoins: [100], questionCount: 5, endsAt: inAnHour() });
  assert.equal((await call(admin, 'POST', `/admin/api/contests/${r.json.id}/cancel`)).status, 200);
  assert.ok(!(await call('alice', 'GET', '/contests')).json.items.some((x) => x.id === r.json.id));
  assert.equal((await call('alice', 'GET', `/contests/${r.json.id}`)).status, 404);
});
