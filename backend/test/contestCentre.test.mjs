// CONTEST CENTRE: organizers & approval, creative entries, free voting, judges, results, certificates,
// Hall of Fame, leaderboards, church teams, disputes, AI drafts, live battles, reminders. No payments.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { sendContestReminders } from '../src/lib/contestCron.js';

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', ADS_CLIENT_CLAIM: 'true', ADMIN_PASSWORD: 'pw-admin', REALTIME_SECRET: 'rt' };
});
async function call(user, method, path, body, headers = {}) {
  const h = { ...headers };
  if (user && user.startsWith('admin_token_')) h.Authorization = `Bearer ${user}`;
  else if (user) h['X-Dev-User'] = user;
  let b;
  if (body instanceof Uint8Array || typeof body === 'string') b = body;
  else if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${path}`, { method, headers: h, body: b }), env);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = text; }
  return { status: res.status, json, text };
}
const sql = (t, p) => env.__db.query(t, p);
const inDays = (d) => new Date(Date.now() + d * 86400000).toISOString();
const ids = {};
let admin;

test('setup users and admin', async () => {
  admin = (await call(null, 'POST', '/admin/api/login', { username: 'benjamin', password: 'pw-admin' })).json.token;
  for (const u of ['org', 'ann', 'ben', 'cat', 'dan', 'judy', 'kim']) ids[u] = (await call(u, 'GET', '/me')).json.id;
  await call('kim', 'PUT', '/me', { country: 'Ghana' });
  await call('ann', 'PUT', '/me', { country: 'Nigeria', church: 'Grace Chapel' });
  await call('ben', 'PUT', '/me', { country: 'Nigeria', church: 'Hope Church' });
});

test('categories: listed, and admins can switch one off', async () => {
  const r = await call('ann', 'GET', '/contests/categories');
  assert.equal(r.status, 200);
  assert.ok(r.json.items.length >= 12);
  assert.ok(r.json.items.some((c) => c.id === 'gospel_talent' && c.format === 'submission'));
  assert.equal((await call(admin, 'PATCH', '/admin/api/contest-categories/testimony', { active: false })).json.active, false);
  assert.ok(!(await call('ann', 'GET', '/contests/categories')).json.items.some((c) => c.id === 'testimony'));
  assert.equal((await call(admin, 'POST', '/admin/api/contests', { title: 'Off', contestCategory: 'testimony', prizeCoins: [10], endsAt: inDays(2) })).status, 400);
  await call(admin, 'PATCH', '/admin/api/contest-categories/testimony', { active: true });
});

let contestId;
test('organizers need permission; their contests wait for approval', async () => {
  const payload = { title: 'Verse Art Contest', description: 'Design a verse', contestCategory: 'verse_design', prizeCoins: [300, 150], prizePlaces: ['A framed print'], startsAt: inDays(1),
    endsAt: inDays(2), votingEndsAt: inDays(4), rules: 'Original work only.', judgingCriteria: 'Creativity and faithfulness' };
  assert.equal((await call('org', 'POST', '/contests', payload)).status, 403);
  assert.equal((await call(admin, 'POST', `/admin/api/contest-organizers/${ids.org}`, { canOrganize: true })).json.canOrganize, true);
  const r = await call('org', 'POST', '/contests', payload);
  assert.equal(r.status, 201);
  contestId = r.json.id;
  assert.equal(r.json.status, 'pending_approval');
  assert.equal(r.json.scoring, 'popularity');
  assert.equal(r.json.votingEnabled, true);
  assert.deepEqual(r.json.entryKinds, ['image']);
  assert.ok(!(await call('ann', 'GET', '/contests')).json.items.some((c) => c.id === contestId));
  assert.equal((await call('ann', 'GET', `/contests/${contestId}`)).status, 404);
  assert.ok((await call('org', 'GET', '/organizer/contests')).json.items.some((c) => c.id === contestId));
  const ok = await call(admin, 'POST', `/admin/api/contests/${contestId}/approve`);
  assert.equal(ok.json.status, 'registration_open');
  const seen = (await call('ann', 'GET', '/contests')).json.items.find((c) => c.id === contestId);
  assert.ok(seen);
  assert.equal(seen.paymentsEnabled, false);
});

test('registration: free works; paid contests say payments are not enabled; country rules apply', async () => {
  assert.equal((await call('ann', 'POST', `/contests/${contestId}/register`)).json.registered, true);
  assert.ok((await call('ann', 'GET', '/me/notifications')).json.items.some((n) => n.kind === 'contest' && /registered/i.test(n.title)));
  const paid = await call(admin, 'POST', '/admin/api/contests', { title: 'Paid Quiz', contestCategory: 'bible_knowledge', prizeCoins: [100], endsAt: inDays(1), entryFeeMinor: 20000, questionCount: 5 });
  assert.equal(paid.json.entryFeeMinor, 20000);
  const r = await call('ann', 'POST', `/contests/${paid.json.id}/register`);
  assert.equal(r.status, 402);
  assert.equal(r.json.code, 'PAYMENTS_NOT_ENABLED');
  assert.equal((await call('ann', 'POST', `/contests/${paid.json.id}/start`)).status, 402);
  const local = await call(admin, 'POST', '/admin/api/contests', { title: 'Nigeria Only', contestCategory: 'bible_knowledge', prizeCoins: [100], endsAt: inDays(1), eligibleCountries: ['Nigeria'], questionCount: 5 });
  assert.equal((await call('kim', 'POST', `/contests/${local.json.id}/register`)).json.code, 'NOT_ELIGIBLE');
  assert.equal((await call('ann', 'POST', `/contests/${local.json.id}/register`)).status, 200);
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
let entries = {};
test('creative entries: only while live, own uploads only, edits allowed, others hidden until voting', async () => {
  const early = await call('ann', 'PUT', `/contests/${contestId}/submission`, { kind: 'image', title: 'Too early', mediaKey: 'img/x/y.png' });
  assert.equal(early.json.code, 'SUBMISSIONS_CLOSED');
  await sql(`UPDATE contests SET starts_at = now() - interval '1 hour' WHERE id = $1`, [contestId]);
  for (const u of ['ann', 'ben', 'cat']) {
    const up = await call(u, 'POST', '/uploads/image', PNG, { 'Content-Type': 'image/png' });
    assert.equal(up.status, 201);
    const bad = await call(u, 'PUT', `/contests/${contestId}/submission`, { kind: 'image', title: 'Stolen', mediaKey: `img/${ids.dan}/nope.png` });
    assert.equal(bad.json.code, 'BAD_MEDIA');
    const wrongKind = await call(u, 'PUT', `/contests/${contestId}/submission`, { kind: 'text', title: 'Words', body: 'x'.repeat(40) });
    assert.equal(wrongKind.json.code, 'BAD_KIND');
    const s = await call(u, 'PUT', `/contests/${contestId}/submission`, { kind: 'image', title: `${u} design`, description: 'Psalm 23', mediaKey: up.json.key });
    assert.equal(s.status, 201, JSON.stringify(s.json));
    entries[u] = s.json.id;
  }
  const edit = await call('ann', 'PUT', `/contests/${contestId}/submission`, { kind: 'image', title: 'Ann design v2', mediaKey: (await call('ann', 'POST', '/uploads/image', PNG, { 'Content-Type': 'image/png' })).json.key });
  assert.equal(edit.status, 200);
  assert.equal(edit.json.id, entries.ann);
  const g = await call('dan', 'GET', `/contests/${contestId}/submissions`);
  assert.equal(g.json.galleryOpen, false);
  assert.equal(g.json.items.length, 0);
  assert.equal((await call('dan', 'GET', `/submissions/${entries.ann}`)).status, 404);
  assert.equal((await call('ann', 'GET', `/contests/${contestId}`)).json.mySubmissionId, entries.ann);
});

test('free voting: opens after the deadline, one vote each, no self-votes, admins can reverse', async () => {
  assert.equal((await call('dan', 'POST', `/contests/${contestId}/vote`, { submissionId: entries.ann })).json.code, 'VOTING_CLOSED');
  await sql(`UPDATE contests SET ends_at = now() - interval '1 minute' WHERE id = $1`, [contestId]);
  assert.equal((await call('dan', 'GET', `/contests/${contestId}`)).json.status, 'voting_open');
  assert.equal((await call('ann', 'PUT', `/contests/${contestId}/submission`, { kind: 'image', title: 'late', mediaKey: 'img/x' })).json.code, 'SUBMISSIONS_CLOSED');
  assert.equal((await call('ann', 'POST', `/contests/${contestId}/vote`, { submissionId: entries.ann })).json.code, 'NO_SELF_VOTE');
  const v = await call('dan', 'POST', `/contests/${contestId}/vote`, { submissionId: entries.ben });
  assert.equal(v.json.votes, 1);
  assert.equal((await call('dan', 'POST', `/contests/${contestId}/vote`, { submissionId: entries.cat })).json.code, 'ALREADY_VOTED');
  assert.equal((await call('dan', 'POST', `/contests/${contestId}/vote`, { submissionId: entries.ben })).json.votes, 1); // repeat is harmless
  for (const u of ['ann', 'cat', 'judy', 'kim']) await call(u, 'POST', `/contests/${contestId}/vote`, { submissionId: entries.ben });
  await call('ben', 'POST', `/contests/${contestId}/vote`, { submissionId: entries.ann });
  await call('org', 'POST', `/contests/${contestId}/vote`, { submissionId: entries.cat });
  const g = await call('dan', 'GET', `/contests/${contestId}/submissions`);
  assert.equal(g.json.galleryOpen, true);
  assert.equal(g.json.items[0].id, entries.ben);
  assert.equal(g.json.items[0].votes, 5);
  // the entrant was told (once)
  assert.ok((await call('ben', 'GET', '/me/notifications')).json.items.some((n) => /New votes/.test(n.title)));
  const list = await call(admin, 'GET', `/admin/api/contests/${contestId}/votes`);
  const kimVote = list.json.items.find((x) => x.user.id === ids.kim);
  const rev = await call(admin, 'POST', `/admin/api/contest-votes/${kimVote.id}/reverse`, { reason: 'Suspicious pattern' });
  assert.equal(rev.json.votes, 4);
  assert.equal((await call(admin, 'POST', `/admin/api/contest-votes/${kimVote.id}/reverse`, { reason: 'again' })).status, 404);
});

test('disputes: anyone can report; admins resolve', async () => {
  const d = await call('cat', 'POST', `/contests/${contestId}/disputes`, { reason: 'I think an entry copied someone else', submissionId: entries.ann });
  assert.equal(d.status, 201);
  const open = await call(admin, 'GET', '/admin/api/contest-disputes');
  assert.ok(open.json.items.some((x) => x.id === d.json.id));
  assert.equal((await call(admin, 'POST', `/admin/api/contest-disputes/${d.json.id}`, { status: 'rejected', resolution: 'Checked: the design is original.' })).json.status, 'rejected');
});

test('results: wait for voting to close, then rank by votes, pay coins once, issue certificates', async () => {
  assert.equal((await call('org', 'POST', `/contests/${contestId}/publish`)).json.code, 'NOT_READY');
  assert.equal((await call('ann', 'POST', `/contests/${contestId}/publish`)).status, 403);
  await sql(`UPDATE contests SET voting_ends_at = now() - interval '1 minute' WHERE id = $1`, [contestId]);
  assert.equal((await call('dan', 'GET', `/contests/${contestId}`)).json.status, 'judging');
  const before = (await call('ben', 'GET', '/me')).json.coins;
  const p = await call('org', 'POST', `/contests/${contestId}/publish`);
  assert.equal(p.status, 200, JSON.stringify(p.json));
  assert.equal(p.json.winners, 3);
  assert.equal((await call('org', 'POST', `/contests/${contestId}/publish`)).json.code, 'NOT_READY'); // only once
  assert.equal((await call('ben', 'GET', '/me')).json.coins, before + 300);
  const c = await call('ben', 'GET', `/contests/${contestId}`);
  assert.equal(c.json.status, 'completed');
  assert.match(c.json.myCertificate, /^BN-[A-Z0-9]{8}$/);
  const lb = await call('dan', 'GET', `/contests/${contestId}/leaderboard`);
  assert.deepEqual(lb.json.items.map((x) => [x.place, x.votes]), [[1, 4], [2, 1], [3, 1]]);
  // certificate: listed, verifiable publicly, revocable
  const mine = await call('ben', 'GET', '/me/certificates');
  assert.equal(mine.json.items[0].achievement, '1st place');
  const code = c.json.myCertificate;
  const page = await app.fetch(new Request(`http://api.test/certificates/${code}`), env);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Valid certificate/);
  assert.match(html, /1st place/);
  const js = await (await app.fetch(new Request(`http://api.test/certificates/${code}.json`), env)).json();
  assert.equal(js.valid, true);
  assert.equal((await app.fetch(new Request('http://api.test/certificates/BN-NOPE0000'), env)).status, 404);
  // hall of fame
  const hof = await call('dan', 'GET', '/contests/hall-of-fame');
  const entry = hof.json.items.find((x) => x.id === contestId);
  assert.equal(entry.winners[0].user.id, ids.ben);
  // global leaderboard counts the win
  const g = await call('dan', 'GET', '/leaderboards?period=week');
  assert.equal(g.json.items[0].user.id, ids.ben);
  const byChurch = await call('dan', 'GET', '/leaderboards?by=church');
  assert.ok(byChurch.json.items.some((x) => x.name === 'Hope Church'));
});

test('judged contests: judges score after the deadline; formula mixes judges and votes', async () => {
  const r = await call(admin, 'POST', '/admin/api/contests', { title: 'Preaching Challenge', contestCategory: 'preaching', prizeCoins: [200], endsAt: inDays(1),
    votingEnabled: true, votingEndsAt: inDays(2), judgeWeight: 70, entryKinds: ['text'], allowSelfVote: false });
  const id = r.json.id;
  assert.equal(r.json.scoring, 'judged');
  await sql(`UPDATE contests SET starts_at = now() - interval '1 hour' WHERE id = $1`, [id]);
  const sA = await call('ann', 'PUT', `/contests/${id}/submission`, { kind: 'text', title: 'Grace', body: 'Grace is the unearned favour of God shown in Christ.' });
  const sB = await call('ben', 'PUT', `/contests/${id}/submission`, { kind: 'text', title: 'Faith', body: 'Faith comes by hearing, and hearing by the word of God.' });
  assert.equal(sA.status, 201);
  assert.equal((await call(admin, 'POST', `/contests/${id}/judges`, { userIds: [ids.judy] })).json.added, 1);
  assert.equal((await call('judy', 'GET', '/judging')).json.items[0].id, id);
  assert.equal((await call('judy', 'POST', `/contests/${id}/scores/${sA.json.id}`, { score: 90 })).json.code, 'JUDGING_CLOSED');
  await sql(`UPDATE contests SET ends_at = now() - interval '1 minute' WHERE id = $1`, [id]);
  assert.equal((await call('dan', 'POST', `/contests/${id}/scores/${sA.json.id}`, { score: 90 })).status, 403);
  await call('judy', 'POST', `/contests/${id}/scores/${sA.json.id}`, { score: 90, comment: 'Clear' });
  await call('judy', 'POST', `/contests/${id}/scores/${sB.json.id}`, { score: 60 });
  for (const u of ['cat', 'dan', 'kim']) await call(u, 'POST', `/contests/${id}/vote`, { submissionId: sB.json.id });
  await sql(`UPDATE contests SET voting_ends_at = now() - interval '1 minute' WHERE id = $1`, [id]);
  await call(admin, 'POST', `/contests/${id}/publish`);
  const lb = await call('dan', 'GET', `/contests/${id}/leaderboard`);
  // A: 0.7*90 + 0.3*0 = 63; B: 0.7*60 + 0.3*100 = 72 → B wins
  assert.deepEqual(lb.json.items.map((x) => [x.title, x.score]), [['Faith', 72], ['Grace', 63]]);
});

test('disqualified participants drop off and lose their entry', async () => {
  const r = await call(admin, 'POST', '/admin/api/contests', { title: 'Writing Prize', contestCategory: 'christian_writing', prizeCoins: [50], endsAt: inDays(1) });
  await sql(`UPDATE contests SET starts_at = now() - interval '1 hour' WHERE id = $1`, [r.json.id]);
  await call('cat', 'PUT', `/contests/${r.json.id}/submission`, { kind: 'text', title: 'Copied', body: 'This text was copied from a book word for word.' });
  assert.equal((await call(admin, 'POST', `/contests/${r.json.id}/disqualify`, { userId: ids.cat, reason: 'Plagiarism' })).json.disqualified, true);
  assert.equal((await call('cat', 'PUT', `/contests/${r.json.id}/submission`, { kind: 'text', title: 'Again', body: 'Trying to submit again after being removed.' })).json.code, 'DISQUALIFIED');
  const m = await call(admin, 'GET', `/contests/${r.json.id}/manage`);
  assert.equal(m.json.submissions[0].disqualified, true);
  assert.equal(m.json.revenue.paymentsEnabled, false);
});

test('Church vs Church: register for your church; teams ranked by their best members', async () => {
  const ch1 = await call('ann', 'POST', '/communities', { name: 'Grace Chapel Test' });
  const ch2 = await call('ben', 'POST', '/communities', { name: 'Hope Church Test' });
  const r = await call(admin, 'POST', '/admin/api/contests', { title: 'Church Cup', contestCategory: 'church_vs_church', prizeCoins: [100], endsAt: inDays(1), questionCount: 5 });
  assert.equal(r.json.teamMode, 'church');
  const id = r.json.id;
  assert.equal((await call('ann', 'POST', `/contests/${id}/start`)).json.code, 'CHURCH_REQUIRED');
  assert.equal((await call('ann', 'POST', `/contests/${id}/register`, { communityId: ch2.json.id })).json.code, 'NOT_A_MEMBER');
  await call('ann', 'POST', `/contests/${id}/register`, { communityId: ch1.json.id });
  await call('ben', 'POST', `/contests/${id}/register`, { communityId: ch2.json.id });
  const full = await call(admin, 'GET', `/admin/api/contests/${id}`);
  const key = Object.fromEntries(full.json.questions.map((x) => [x.id, x.a]));
  for (const [u, right] of [['ann', 4], ['ben', 2]]) {
    const s = await call(u, 'POST', `/contests/${id}/start`);
    const answers = {}; s.json.questions.forEach((x, i) => { answers[x.id] = i < right ? key[x.id] : (key[x.id] + 1) % x.options.length; });
    await call(u, 'POST', `/contests/${id}/submit`, { answers });
  }
  const lb = await call('dan', 'GET', `/contests/${id}/leaderboard?by=church`);
  assert.deepEqual(lb.json.items.map((x) => [x.name, x.points]), [['Grace Chapel Test', 4], ['Hope Church Test', 2]]);
});

test('AI quiz generator: organizers only; without AI it drafts from the question bank', async () => {
  assert.equal((await call('dan', 'POST', '/contests/ai-questions', { book: 'Genesis', count: 3 })).status, 403);
  const r = await call('org', 'POST', '/contests/ai-questions', { book: 'Genesis', count: 3, difficulty: 'easy' });
  assert.equal(r.status, 200);
  assert.equal(r.json.needsReview, true);
  assert.ok(r.json.items.length >= 1);
  assert.ok(r.json.items.every((x) => x.options.length >= 2 && Number.isInteger(x.correctIndex)));
  // reviewed questions can be used for a quiz
  const custom = Array.from({ length: 5 }, (_, i) => ({ question: `Custom question number ${i + 1}?`, options: ['Yes', 'No'], correctIndex: 0, reference: 'Genesis 1:1' }));
  const c = await call('org', 'POST', '/contests', { title: 'Genesis Quiz', contestCategory: 'bible_knowledge', prizeCoins: [10], endsAt: inDays(1), questionCount: 5, customQuestions: custom });
  assert.equal(c.status, 201);
  assert.equal(c.json.category, 'custom');
});

test('organizer tools: edits lock after the start, pause and cancel notify players', async () => {
  const r = await call('org', 'POST', '/contests', { title: 'Memory Sprint', contestCategory: 'scripture_memory', prizeCoins: [10], startsAt: inDays(1), endsAt: inDays(2), questionCount: 5, registrationOpensAt: new Date().toISOString() });
  await call(admin, 'POST', `/admin/api/contests/${r.json.id}/approve`);
  assert.equal((await call('org', 'PATCH', `/contests/${r.json.id}`, { participantLimit: 50 })).status, 200);
  await call('dan', 'POST', `/contests/${r.json.id}/register`);
  assert.equal((await call('dan', 'PATCH', `/contests/${r.json.id}`, { title: 'Hacked' })).status, 403);
  assert.equal((await call('org', 'POST', `/contests/${r.json.id}/pause`)).json.status, 'paused');
  assert.equal((await call('dan', 'GET', `/contests/${r.json.id}`)).json.status, 'paused');
  await call('org', 'POST', `/contests/${r.json.id}/cancel`);
  assert.ok((await call('dan', 'GET', '/me/notifications')).json.items.some((n) => /cancelled/.test(n.title)));
  assert.equal((await call('dan', 'GET', `/contests/${r.json.id}`)).status, 404);
});

test('reminders: sent once per person per contest', async () => {
  const r = await call(admin, 'POST', '/admin/api/contests', { title: 'Reminder Quiz', contestCategory: 'bible_knowledge', prizeCoins: [10], startsAt: new Date(Date.now() + 30 * 60000).toISOString(), endsAt: inDays(1), questionCount: 5, registrationOpensAt: new Date().toISOString() });
  await call('ben', 'POST', `/contests/${r.json.id}/register`);
  const first = await sendContestReminders(env);
  assert.ok(first >= 1);
  assert.equal(await sendContestReminders(env), 0);
  assert.ok((await call('ben', 'GET', '/me/notifications')).json.items.some((n) => /Starting soon: Reminder Quiz/.test(n.title)));
});

test('audio uploads for entries are public media', async () => {
  const up = await call('ann', 'POST', '/uploads/audio', new Uint8Array([1, 2, 3, 4]), { 'Content-Type': 'audio/mpeg' });
  assert.equal(up.status, 201);
  assert.match(up.json.key, /^aud\//);
  assert.equal((await app.fetch(new Request(`http://api.test/media/${up.json.key}`), env)).status, 200);
  assert.equal((await call('ann', 'POST', '/uploads/audio', new Uint8Array([1]), { 'Content-Type': 'text/plain' })).status, 400);
});

test('live battles: quick match, server-timed answers, winner, rematch', async () => {
  const w = await call('ann', 'POST', '/battles/queue');
  assert.equal(w.json.status, 'waiting');
  const m = await call('ben', 'POST', '/battles/queue');
  assert.equal(m.json.id, w.json.id);
  assert.equal(m.json.status, 'active');
  assert.equal(m.json.phase, 'countdown');
  const id = m.json.id;
  assert.equal((await call('ann', 'POST', `/battles/${id}/answer`, { index: 0, option: 0 })).json.code, 'TOO_LATE');
  // jump the clock to question 0
  await sql(`UPDATE battles SET starts_at = now() - interval '1 second' WHERE id = $1`, [id]);
  const s = await call('ann', 'GET', `/battles/${id}`);
  assert.equal(s.json.phase, 'question');
  assert.equal(s.json.current.index, 0);
  assert.equal(s.json.current.correctIndex, undefined);
  const qs = (await sql('SELECT questions FROM battles WHERE id = $1', [id]))[0].questions;
  const right = qs[0].a;
  assert.equal((await call('ann', 'POST', `/battles/${id}/answer`, { index: 0, option: right })).json.locked, true);
  assert.equal((await call('ann', 'POST', `/battles/${id}/answer`, { index: 0, option: right })).json.code, 'ALREADY_ANSWERED');
  await call('ben', 'POST', `/battles/${id}/answer`, { index: 0, option: (right + 1) % qs[0].o.length });
  assert.equal((await call('ann', 'POST', `/battles/${id}/answer`, { index: 1, option: 0 })).json.code, 'TOO_LATE');
  assert.equal((await call('dan', 'GET', `/battles/${id}`)).status, 403);
  // fast-forward to the end
  await sql(`UPDATE battles SET starts_at = now() - interval '10 minutes' WHERE id = $1`, [id]);
  const end = await call('ann', 'GET', `/battles/${id}`);
  assert.equal(end.json.phase, 'finished');
  assert.equal(end.json.winner, 'me');
  assert.ok(end.json.myScore >= 100);
  assert.equal(end.json.review.length, 8);
  assert.equal((await call('ben', 'GET', `/battles/${id}`)).json.winner, 'opponent');
  const hist = await call('ann', 'GET', '/battles');
  assert.equal(hist.json.stats.wins, 1);
  const re = await call('ben', 'POST', `/battles/${id}/rematch`);
  assert.equal(re.json.invited, true);
  assert.ok((await call('ann', 'GET', '/me/notifications')).json.items.some((n) => n.kind === 'battle'));
  assert.equal((await call('cat', 'POST', `/battles/${re.json.id}/accept`)).status, 403);
  assert.equal((await call('ann', 'POST', `/battles/${re.json.id}/accept`)).json.status, 'active');
});
