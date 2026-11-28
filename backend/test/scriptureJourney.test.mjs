// MY SCRIPTURE JOURNEY: idempotent sync, unique-verse dedupe, offline backlog, day/week/month rollups across time zones,
// streak maths, milestones awarded once, community totals, privacy of hidden numbers, and the route mount.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import {
  localDay, weekStart, monthStart, monthEnd, addDays, streaksFrom, parseEvent, syncEvents, statsFor,
  evaluateAchievements, listAchievements, saveGoal, getGoal, createGroup, joinGroup, leaveGroup,
  groupProgress, setGroupPrivacy, listGroups,
} from '../src/lib/journey.js';

let env; const app = createApp();
const NOW = Date.parse('2026-11-28T12:00:00Z');

before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', ADMIN_PASSWORD: 'pw-admin', REALTIME_SECRET: 'rt' };
});

const rows = async (t, p = []) => { const r = await env.__db.query(t, p); return Array.isArray(r) ? r : r.rows; };
// create (or reuse) a signed-in user through the real auth path, return its id
async function uid(name) {
  await app.fetch(new Request('http://api.test/journey/config', { headers: { 'X-Dev-User': name } }), env);
  return (await rows('SELECT id FROM users WHERE clerk_id = $1', [`dev_${name}`]))[0].id;
}
const ev = (clientId, bookId, chapter, verseStart, verseEnd, readAt, extra = {}) => ({
  clientId, bookId, chapter, verseStart, verseEnd: verseEnd ?? verseStart, readAt, source: 'reader', ...extra,
});
const iso = (s) => new Date(s).toISOString();

// ───────── pure helpers ─────────
test('local day: the same instant is a different day in Lagos and New York', () => {
  const at = '2026-11-27T23:30:00Z';
  assert.equal(localDay(at, 'Africa/Lagos'), '2026-11-28'); // UTC+1
  assert.equal(localDay(at, 'America/New_York'), '2026-11-27'); // UTC-5
  assert.equal(localDay(at, null, 120), '2026-11-28'); // fixed offset fallback
  assert.equal(localDay(at, 'Not/AZone', 0), '2026-11-27');
});

test('weeks start on Monday and months roll over in the user zone', () => {
  assert.equal(weekStart('2026-11-29'), '2026-11-23'); // Sunday belongs to the week that began the Monday before
  assert.equal(weekStart('2026-11-30'), '2026-11-30');
  assert.equal(monthStart('2026-12-01'), '2026-12-01');
  assert.equal(monthEnd('2026-02-10'), '2026-02-28');
  assert.equal(monthEnd('2028-02-10'), '2028-02-29');
  // 30 Nov 23:30 UTC is 1 Dec in Lagos: it belongs to December there, to November in New York
  assert.equal(localDay('2026-11-30T23:30:00Z', 'Africa/Lagos').slice(0, 7), '2026-12');
  assert.equal(localDay('2026-11-30T23:30:00Z', 'America/New_York').slice(0, 7), '2026-11');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('streak maths: a run ending yesterday still counts, gaps break it, longest is kept', () => {
  const days = ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-26', '2026-11-27'];
  assert.deepEqual(streaksFrom(days, '2026-11-28'), { current: 2, longest: 3 }); // yesterday + the day before
  assert.deepEqual(streaksFrom(days, '2026-11-27'), { current: 2, longest: 3 }); // today counted
  assert.deepEqual(streaksFrom(days, '2026-11-29'), { current: 0, longest: 3 }); // a missed day breaks it
  assert.deepEqual(streaksFrom([], '2026-11-28'), { current: 0, longest: 0 });
  assert.deepEqual(streaksFrom(['2026-02-27', '2026-02-28', '2026-03-01'], '2026-03-01'), { current: 3, longest: 3 }); // leap year
});

test('event parsing: verses must exist in the KJV versification; the bad ones are rejected with a reason', () => {
  const good = parseEvent(ev('abcd-1', 'JHN', 3, 16, 17, iso(NOW - 1000)), NOW);
  assert.equal(good.ev.verseCount, 2);
  assert.equal(parseEvent(ev('abcd-2', 'JHN', 3, 37, 37, iso(NOW)), NOW).reason, 'BAD_REFERENCE');
  assert.equal(parseEvent(ev('abcd-3', 'constructor', 1, 1, 1, iso(NOW)), NOW).reason, 'BAD_REFERENCE');
  assert.equal(parseEvent(ev('abcd-4', 'JHN', 3, 16, 16, iso(NOW + 3600e3)), NOW).reason, 'FUTURE');
  assert.equal(parseEvent(ev('abcd-5', 'JHN', 3, 16, 16, iso(NOW - 900 * 86400e3)), NOW).reason, 'TOO_OLD');
  assert.equal(parseEvent(ev('x', 'JHN', 3, 16, 16, iso(NOW)), NOW).reason, 'BAD_CLIENT_ID');
});

// ───────── goals ─────────
test('goal: presets are not forced, the books and zone are validated, unknown keys are not stored', async () => {
  const u = await uid('sj_goal');
  let g = await saveGoal(env, u, { dailyTarget: 200, books: ['JHN', 'PSA'], translation: 'niv', timezone: 'Africa/Lagos', delivery: 'both' });
  assert.equal(g.dailyTarget, 200);
  assert.equal(g.translation, 'NIV');
  g = await saveGoal(env, u, { weeklyTarget: 1400 }); // partial update keeps the rest
  assert.equal(g.dailyTarget, 200);
  assert.equal(g.weeklyTarget, 1400);
  await assert.rejects(saveGoal(env, u, { books: ['constructor'] }), { code: 'BAD_GOAL' });
  await assert.rejects(saveGoal(env, u, { timezone: 'Mars/Olympus' }), { code: 'BAD_GOAL' });
  await assert.rejects(saveGoal(env, u, { dailyTarget: 1e9 }), { code: 'BAD_GOAL' });
  await assert.rejects(saveGoal(env, u, { notifyPerDay: 7 }), { code: 'BAD_GOAL' }); // hard cap of 6
  assert.equal((await getGoal(env, u)).daily_target, 200);
});

// ───────── sync, dedupe, offline backlog ─────────
test('idempotent sync: sending the same batch twice stores nothing new the second time', async () => {
  const u = await uid('sj_idem');
  const batch = [ev('idem-0001', 'GEN', 1, 1, 5, iso(NOW - 3600e3)), ev('idem-0002', 'GEN', 1, 6, 10, iso(NOW - 3000e3))];
  const a = await syncEvents(env, u, { tz: 'UTC', events: batch }, NOW);
  const b = await syncEvents(env, u, { tz: 'UTC', events: batch }, NOW);
  assert.equal(a.accepted, 2);
  assert.equal(a.duplicates, 0);
  assert.equal(b.accepted, 0);
  assert.equal(b.duplicates, 2);
  assert.equal((await rows('SELECT count(*)::int AS n FROM journey_events WHERE user_id = $1', [u]))[0].n, 2);
  assert.equal((await rows('SELECT count(*)::int AS n FROM journey_verses WHERE user_id = $1', [u]))[0].n, 10);
});

test('duplicate client ids inside one batch count once', async () => {
  const u = await uid('sj_dupbatch');
  const r = await syncEvents(env, u, { tz: 'UTC', events: [ev('same-0001', 'JHN', 1, 1, 1, iso(NOW)), ev('same-0001', 'JHN', 1, 1, 1, iso(NOW))] }, NOW);
  assert.equal(r.accepted, 1);
  assert.equal(r.duplicates, 1);
});

test('unique dedupe: overlapping ranges cover each verse once, while totals keep re-reads', async () => {
  const u = await uid('sj_unique');
  await syncEvents(env, u, { tz: 'UTC', events: [ev('uniq-0001', 'PSA', 23, 1, 6, iso(NOW - 7200e3))] }, NOW);
  await syncEvents(env, u, { tz: 'UTC', events: [ev('uniq-0002', 'PSA', 23, 4, 6, iso(NOW - 3600e3))] }, NOW); // re-read 4-6
  const s = await statsFor(env, u, { tz: 'UTC' }, NOW);
  assert.equal(s.totals.verses, 9); // every verse read, re-reads included
  assert.equal(s.totals.uniqueVerses, 6); // six different verses
  assert.equal(s.day.verses, 9);
  assert.equal(s.day.unique, 6);
  const psa = s.books.find((b) => b.bookId === 'PSA');
  assert.equal(psa.versesUnique, 6);
  assert.equal(psa.chaptersCompleted, 1); // Psalm 23 has six verses and all six are read
});

test('offline backlog: a late-synced earlier read moves the verse to its real first day', async () => {
  const u = await uid('sj_backlog');
  // read on the 27th, synced on the 28th
  await syncEvents(env, u, { tz: 'UTC', events: [ev('late-0002', 'ROM', 8, 28, 28, iso('2026-11-26T09:00:00Z'))] }, NOW);
  // the same verse read on the 20th, synced later: the earlier day wins
  await syncEvents(env, u, { tz: 'UTC', events: [ev('late-0001', 'ROM', 8, 28, 28, iso('2026-11-20T09:00:00Z'))] }, NOW);
  const r = await rows("SELECT first_day::text AS d FROM journey_verses WHERE user_id = $1 AND book = 'ROM' AND chapter = 8 AND verse = 28", [u]);
  assert.equal(r[0].d, '2026-11-20');
});

test('timezone rollups: an event at 23:30 UTC lands on the next day in Lagos and the same day in New York', async () => {
  const u = await uid('sj_zone');
  const at = '2026-11-27T23:30:00Z';
  await syncEvents(env, u, { tz: 'Africa/Lagos', events: [ev('zone-lag', 'MAT', 5, 1, 10, at)] }, Date.parse(at) + 60e3);
  const lagos = await statsFor(env, u, { tz: 'Africa/Lagos' }, Date.parse('2026-11-27T23:40:00Z'));
  assert.equal(lagos.today, '2026-11-28');
  assert.equal(lagos.day.verses, 10); // Lagos: the 28th
  const ny = await statsFor(env, u, { tz: 'America/New_York' }, Date.parse('2026-11-27T23:40:00Z'));
  assert.equal(ny.today, '2026-11-27');
  assert.equal(ny.day.verses, 0); // the read was stored on the 28th Lagos day, so New York's 27th is empty
  assert.equal(ny.week.verses, 10); // both fall in the same Monday-start week
  assert.equal(ny.month.verses, 10);
});

test('the per-day cap stops inflation: verses beyond it are rejected, not counted', async () => {
  const u = await uid('sj_cap');
  const events = [];
  for (let i = 0; i < 120; i += 1) events.push(ev(`cap-${String(i).padStart(4, '0')}`, 'PSA', 119, 1, 176, iso(NOW - (120 - i) * 1000)));
  const r = await syncEvents(env, u, { tz: 'UTC', events }, NOW);
  // the default cap is 20,000 verses a day: 113 events of 176 fit (19,888); the rest are rejected
  assert.equal(r.accepted, 113);
  assert.equal(r.rejected.filter((x) => x.reason === 'DAILY_CAP').length, 7);
  const s = await statsFor(env, u, { tz: 'UTC' }, NOW);
  assert.equal(s.day.verses, 113 * 176);
});

// ───────── achievements ─────────
test('milestones are awarded once: daily goal, streak and verse milestones', async () => {
  const u = await uid('sj_ach');
  await saveGoal(env, u, { dailyTarget: 50, timezone: 'UTC' });
  const on = (clientId, day, verseStart, verseEnd) => ev(clientId, 'PSA', 119, verseStart, verseEnd, iso(`${day}T10:00:00Z`));
  const a1 = await syncEvents(env, u, { tz: 'UTC', events: [on('ach-26', '2026-11-26', 1, 30), on('ach-27', '2026-11-27', 1, 50)] }, NOW);
  assert.ok(a1.awarded.some((a) => a.kind === 'daily_goal' && a.ref === '2026-11-27'));
  assert.ok(!a1.awarded.some((a) => a.kind === 'daily_goal' && a.ref === '2026-11-26'));
  // the 28th (today): a short day, then the streak reaches 3 (26th, 27th, 28th)
  const a2 = await syncEvents(env, u, { tz: 'UTC', events: [on('ach-28', '2026-11-28', 1, 10)] }, NOW);
  assert.ok(a2.awarded.some((a) => a.kind === 'streak' && a.ref === '3'));
  // syncing again and evaluating again awards nothing new
  const again = await evaluateAchievements(env, u, { today: '2026-11-28', days: ['2026-11-27', '2026-11-28'] }, NOW);
  assert.equal(again.length, 0);
  const all = await listAchievements(env, u);
  assert.equal(all.filter((a) => a.kind === 'daily_goal' && a.ref === '2026-11-27').length, 1);
  assert.ok(all.every((a) => a.message && a.title));
  const s = await rows("SELECT count(*)::int AS n FROM journey_achievements WHERE user_id = $1 AND kind = 'streak' AND ref = '3'", [u]);
  assert.equal(s[0].n, 1);
});

test('verse milestones: crossing 1,000 awards once; achievements can be marked seen', async () => {
  const u = await uid('sj_milestone');
  for (let i = 0; i < 6; i += 1) {
    // one chapter (176 verses) per event, each synced separately
    await syncEvents(env, u, { tz: 'UTC', events: [ev(`ms-${i}`, 'PSA', 119, 1, 176, iso(NOW - (6 - i) * 60e3))] }, NOW);
  }
  const v = await rows("SELECT ref FROM journey_achievements WHERE user_id = $1 AND kind = 'verses' ORDER BY ref", [u]);
  assert.deepEqual(v.map((x) => x.ref), ['1000']); // 1,056 verses: 1,000 reached, 5,000 not
  const list = await listAchievements(env, u);
  assert.equal(list.find((a) => a.kind === 'verses').message, 'You have read 1,000 verses.');
  assert.equal(list.every((a) => !a.seen), true);
  await env.__db.query('UPDATE journey_achievements SET seen_at = now() WHERE user_id = $1', [u]);
  assert.equal((await listAchievements(env, u)).every((a) => a.seen), true);
});

// ───────── community goals ─────────
test('community totals, ranking, completion awarded once to each member, and the invite code', async () => {
  const owner = await uid('sj_owner');
  const mate = await uid('sj_mate');
  const g = await createGroup(env, owner, { name: 'Family Reading', kind: 'family', target: 300, startsOn: '2026-11-01', endsOn: '2026-11-30' });
  assert.match(g.inviteCode, /^[A-Z2-9]{8}$/);
  const j = await joinGroup(env, mate, g.inviteCode.toLowerCase());
  assert.equal(j.id, g.id);
  await joinGroup(env, mate, g.inviteCode); // joining twice is harmless
  await syncEvents(env, owner, { tz: 'UTC', events: [ev('grp-o1', 'PSA', 23, 1, 6, iso('2026-11-10T09:00:00Z'))] }, Date.parse('2026-11-10T10:00:00Z'));
  await syncEvents(env, mate, { tz: 'UTC', events: [ev('grp-m1', 'PSA', 119, 1, 176, iso('2026-11-12T09:00:00Z'))] }, Date.parse('2026-11-12T10:00:00Z'));
  let p = await groupProgress(env, owner, g.id, Date.parse('2026-11-20T00:00:00Z'));
  assert.equal(p.total, 182);
  assert.equal(p.pct, 61);
  assert.equal(p.reached, false);
  assert.equal(p.leaderboard[0].verses, 176);
  assert.equal(p.leaderboard[0].isYou, false);
  // reach the target: 300 total
  await syncEvents(env, mate, { tz: 'UTC', events: [ev('grp-m2', 'PSA', 119, 1, 118, iso('2026-11-13T09:00:00Z'))] }, Date.parse('2026-11-13T10:00:00Z'));
  p = await groupProgress(env, owner, g.id, Date.parse('2026-11-20T00:00:00Z'));
  assert.equal(p.total, 300);
  assert.equal(p.reached, true);
  assert.equal(p.pct, 100);
  assert.equal(p.awarded.length, 1); // the owner sees their own award
  // reading the goal again does not award again
  const p2 = await groupProgress(env, mate, g.id, Date.parse('2026-11-20T00:00:00Z'));
  assert.equal(p2.awarded.length, 0);
  const counts = await rows("SELECT count(*)::int AS n FROM journey_achievements WHERE kind = 'community_goal' AND ref = $1", [g.id]);
  assert.equal(counts[0].n, 2); // one per member, not one per view
  // progress only counts reads inside the window
  const outside = await syncEvents(env, mate, { tz: 'UTC', events: [ev('grp-old', 'GEN', 1, 1, 1, iso('2026-10-20T09:00:00Z'))] }, Date.parse('2026-10-20T10:00:00Z'));
  assert.equal(outside.accepted, 1);
  p = await groupProgress(env, owner, g.id, Date.parse('2026-11-20T00:00:00Z'));
  assert.equal(p.total, 300);
});

test('privacy: a member who hides numbers shows no count or rank to others, still counts in the total, and sees own number', async () => {
  const owner = await uid('sj_pv_owner');
  const shy = await uid('sj_pv_shy');
  const g = await createGroup(env, owner, { name: 'Church Study', kind: 'church', target: 1000, startsOn: '2026-11-01', endsOn: '2026-11-30' });
  await joinGroup(env, shy, g.inviteCode);
  await syncEvents(env, owner, { tz: 'UTC', events: [ev('pv-o', 'JHN', 3, 1, 36, iso('2026-11-05T09:00:00Z'))] }, Date.parse('2026-11-05T10:00:00Z'));
  await syncEvents(env, shy, { tz: 'UTC', events: [ev('pv-s', 'JHN', 1, 1, 51, iso('2026-11-06T09:00:00Z'))] }, Date.parse('2026-11-06T10:00:00Z'));
  assert.equal(await setGroupPrivacy(env, shy, g.id, true), true);
  const fromOwner = await groupProgress(env, owner, g.id, Date.parse('2026-11-20T00:00:00Z'));
  const hidden = fromOwner.leaderboard.find((r) => r.hidden);
  assert.ok(hidden, 'the hidden member is listed');
  assert.equal(hidden.verses, null);
  assert.equal(hidden.rank, null);
  assert.equal(fromOwner.leaderboard.some((r) => r.verses === 51), false, 'the hidden count never reaches the other members');
  assert.equal(fromOwner.total, 36 + 51); // the total still includes them
  const fromShy = await groupProgress(env, shy, g.id, Date.parse('2026-11-20T00:00:00Z'));
  assert.equal(fromShy.yourVerses, 51);
  assert.equal(fromShy.leaderboard.find((r) => r.isYou).verses, 51);
  // the owner cannot leave their own goal; a member can
  await assert.rejects(leaveGroup(env, owner, g.id), { code: 'OWNER_CANNOT_LEAVE' });
  await leaveGroup(env, shy, g.id);
  assert.equal((await listGroups(env, shy)).length, 0);
  assert.equal((await listGroups(env, owner))[0].inviteCode, g.inviteCode);
  await assert.rejects(groupProgress(env, shy, g.id), { status: 404 });
});

test('routes: config is public to the app; unknown goals are 404; the sync endpoint answers in JSON', async () => {
  const res = await app.fetch(new Request('http://api.test/journey/config', { headers: { 'X-Dev-User': 'sj_route' } }), env);
  const cfg = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(cfg.presets, [50, 100, 200, 500, 1000]);
  assert.equal(cfg.maxPushPerDay, 6);
  const bad = await app.fetch(new Request('http://api.test/journey/groups/00000000-0000-4000-8000-000000000000', { headers: { 'X-Dev-User': 'sj_route' } }), env);
  assert.equal(bad.status, 404);
  const sync = await app.fetch(new Request('http://api.test/journey/events/sync', {
    method: 'POST', headers: { 'X-Dev-User': 'sj_route', 'Content-Type': 'application/json' },
    body: JSON.stringify({ tz: 'Africa/Lagos', events: [{ clientId: 'route-0001', bookId: 'JHN', chapter: 3, verseStart: 16, readAt: new Date().toISOString() }] }),
  }), env);
  const out = await sync.json();
  assert.equal(sync.status, 200);
  assert.equal(out.accepted, 1);
  const stats = await app.fetch(new Request('http://api.test/journey/stats?tz=Africa/Lagos', { headers: { 'X-Dev-User': 'sj_route' } }), env);
  const s = await stats.json();
  assert.equal(s.totals.verses, 1);
  assert.equal(s.continueFrom.bookId, 'JHN');
});
