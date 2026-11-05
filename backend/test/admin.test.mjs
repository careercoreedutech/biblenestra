// ROUND 5: admin dashboard — stats, users, content, communities & events, announcements.
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
const ids = {};

test('setup: boss is admin, others are users', async () => {
  for (const u of ['boss', 'ann', 'ben', 'cal']) ids[u] = (await call(u, 'GET', '/me')).json.id;
  await q(env, `UPDATE users SET role = 'admin' WHERE id = $1`, [ids.boss]);
  assert.equal((await call('ann', 'GET', '/admin/api/stats')).status, 403, 'non-admins are refused');
  assert.equal((await call('ann', 'GET', '/admin/api/users')).status, 403);
});

test('admin page includes the new tabs', async () => {
  const res = await app.fetch(new Request('http://api.test/admin'), env);
  const html = await res.text();
  for (const t of ['Dashboard', 'Users', 'Content', 'Communities & events', 'Announcements']) assert.ok(html.includes(`'${t}'`), t);
});

test('dashboard stats', async () => {
  await call('ann', 'POST', '/posts', { text: 'Grace and peace to you all' });
  const s = await call('boss', 'GET', '/admin/api/stats');
  assert.equal(s.status, 200);
  assert.ok(s.json.totals.users >= 4);
  assert.ok(s.json.totals.posts >= 1);
  assert.ok(s.json.totals.active24h >= 1, 'last_seen_at is tracked');
  assert.equal(s.json.series.length, 14);
  assert.ok(s.json.series[13].signups >= 4);
  assert.ok(s.json.recentSignups.length >= 4);
});

test('users: search, detail, ban/unban, verify, roles, coins', async () => {
  await call('ben', 'PUT', '/me', { displayName: 'Benjamin Okafor', church: 'Grace Chapel' });
  const found = await call('boss', 'GET', '/admin/api/users?q=okafor');
  assert.equal(found.json.items.length, 1);
  assert.equal(found.json.items[0].id, ids.ben);
  assert.equal((await call('boss', 'GET', '/admin/api/users?q=grace%20chapel')).json.items[0].id, ids.ben);

  const d = await call('boss', 'GET', `/admin/api/users/${ids.ann}`);
  assert.equal(d.status, 200);
  assert.equal(d.json.counts.posts, 1);

  assert.equal((await call('boss', 'POST', `/admin/api/users/${ids.boss}/ban`, {})).status, 400, 'not yourself');
  assert.equal((await call('boss', 'POST', `/admin/api/users/${ids.ben}/ban`, { reason: 'spam' })).status, 200);
  const blocked = await call('ben', 'GET', '/me');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.code, 'BANNED');
  assert.equal((await call('boss', 'GET', '/admin/api/users?filter=banned')).json.items[0].bannedReason, 'spam');
  await call('boss', 'POST', `/admin/api/users/${ids.ben}/ban`, { banned: false });
  assert.equal((await call('ben', 'GET', '/me')).status, 200);

  await call('boss', 'POST', `/admin/api/users/${ids.ann}/verify`, { verified: true });
  assert.equal((await call('boss', 'GET', '/admin/api/users?filter=verified')).json.items[0].id, ids.ann);

  assert.equal((await call('boss', 'POST', `/admin/api/users/${ids.boss}/role`, { role: 'user' })).status, 400, 'not your own rights');
  assert.equal((await call('boss', 'POST', `/admin/api/users/${ids.cal}/role`, { role: 'admin' })).status, 200);
  assert.equal((await call('cal', 'GET', '/admin/api/stats')).status, 200, 'cal is now an admin');
  assert.equal((await call('boss', 'POST', `/admin/api/users/${ids.cal}/ban`, {})).status, 403, 'admins must be demoted first');
  assert.equal((await call('cal', 'POST', `/admin/api/users/${ids.boss}/role`, { role: 'user' })).status, 200);
  assert.equal((await call('cal', 'POST', `/admin/api/users/${ids.cal}/role`, { role: 'user' })).status, 400, 'last admin stays');
  await call('cal', 'POST', `/admin/api/users/${ids.boss}/role`, { role: 'admin' });

  const before = (await call('ann', 'GET', '/me')).json.coins;
  const add = await call('boss', 'POST', `/admin/api/users/${ids.ann}/coins`, { amount: 50, reason: 'Thank-you for testing' });
  assert.equal(add.json.coins, before + 50);
  const ledger = (await call('ann', 'GET', '/coins/ledger')).json.items;
  assert.equal(ledger[0].amount, 50);
  assert.equal(ledger[0].reason, 'admin_adjustment');
  assert.equal((await call('boss', 'POST', `/admin/api/users/${ids.ann}/coins`, { amount: -999999, reason: 'too much' })).json.code, 'INSUFFICIENT_COINS');
  assert.equal((await call('boss', 'POST', `/admin/api/users/${ids.ann}/coins`, { amount: 5 })).status, 400, 'reason required');
});

test('content: remove/restore posts and prayers, delete comments, resolves reports', async () => {
  const p = (await call('ben', 'POST', '/posts', { text: 'Buy followers cheap' })).json;
  await call('ann', 'POST', '/reports', { targetType: 'post', targetId: p.id, reason: 'spam' });
  const reported = await call('boss', 'GET', '/admin/api/content/posts?status=reported');
  assert.equal(reported.json.items[0].id, p.id);
  assert.equal(reported.json.items[0].openReports, 1);
  assert.equal((await call('boss', 'GET', '/admin/api/content/posts?q=followers')).json.items.length, 1);
  assert.equal((await call('boss', 'GET', `/admin/api/content/posts?authorId=${ids.ann}`)).json.items.every((x) => x.author.id === ids.ann), true);

  assert.equal((await call('boss', 'POST', `/admin/api/content/posts/${p.id}/remove`)).status, 200);
  assert.equal((await call('ann', 'GET', `/posts/${p.id}`)).status, 404, 'gone from the app');
  assert.equal((await call('boss', 'GET', '/admin/api/reports')).json.items.filter((r) => r.targetId === p.id).length, 0, 'report resolved');
  await call('boss', 'POST', `/admin/api/content/posts/${p.id}/restore`);
  assert.equal((await call('ann', 'GET', `/posts/${p.id}`)).status, 200);

  const cm = (await call('ann', 'POST', `/posts/${p.id}/comments`, { text: 'rude comment' })).json;
  const cid = cm.id || (cm.comment && cm.comment.id);
  assert.ok(cid);
  const listed = (await call('boss', 'GET', '/admin/api/content/comments?q=rude')).json.items[0];
  assert.equal(listed.postId, p.id);
  assert.equal((await call('boss', 'POST', `/admin/api/content/comments/${listed.id}/remove`)).status, 200);
  assert.equal((await call('ann', 'GET', `/posts/${p.id}`)).json.commentsCount ?? 0, 0);
  assert.equal((await call('boss', 'POST', `/admin/api/content/comments/${listed.id}/restore`)).status, 400);

  const pr = (await call('cal', 'POST', '/prayers', { title: 'Healing for my aunt', body: '' })).json;
  await call('boss', 'POST', `/admin/api/content/prayers/${pr.id}/remove`);
  assert.equal((await call('boss', 'GET', '/admin/api/content/prayers?status=removed')).json.items[0].id, pr.id);
  await call('boss', 'POST', `/admin/api/content/prayers/${pr.id}/restore`);
  assert.equal((await call('boss', 'GET', '/admin/api/content/prayers?status=removed')).json.items.length, 0);
  assert.equal((await call('boss', 'GET', '/admin/api/content/bogus')).status, 404);
});

test('communities: detail works, verify, hide, transfer owner, delete', async () => {
  const comm = (await call('ann', 'POST', '/communities', { name: 'Lagos Young Adults' })).json;
  await call('ben', 'POST', `/communities/${comm.id}/join`);
  assert.equal((await call('cal', 'GET', `/communities/${comm.id}`)).status, 200, 'detail endpoint (was always 404)');

  await call('boss', 'PATCH', `/admin/api/communities/${comm.id}`, { verified: true });
  assert.equal((await call('cal', 'GET', '/communities')).json.items.find((x) => x.id === comm.id).verified, true);

  await call('boss', 'PATCH', `/admin/api/communities/${comm.id}`, { hidden: true });
  assert.ok(!(await call('dee', 'GET', '/communities')).json.items.some((x) => x.id === comm.id), 'hidden from non-members');
  assert.equal((await call('dee', 'POST', `/communities/${comm.id}/join`)).status, 404);
  assert.equal((await call('dee', 'GET', `/communities/${comm.id}`)).status, 404);
  assert.equal((await call('boss', 'GET', `/communities/${comm.id}`)).status, 200, 'admins can still open it');
  assert.ok((await call('ben', 'GET', '/communities')).json.items.some((x) => x.id === comm.id), 'members still see it');
  assert.equal((await call('boss', 'GET', '/admin/api/communities?filter=hidden')).json.items[0].id, comm.id);
  await call('boss', 'PATCH', `/admin/api/communities/${comm.id}`, { hidden: false });

  const members = (await call('boss', 'GET', `/admin/api/communities/${comm.id}/members`)).json.items;
  assert.equal(members.length, 2);
  assert.equal((await call('boss', 'POST', `/admin/api/communities/${comm.id}/owner`, { userId: ids.cal })).status, 400, 'must be a member');
  assert.equal((await call('boss', 'POST', `/admin/api/communities/${comm.id}/owner`, { userId: ids.ben })).status, 200);
  const after = (await call('boss', 'GET', `/admin/api/communities/${comm.id}/members`)).json.items;
  assert.equal(after.find((m) => m.id === ids.ben).role, 'owner');
  assert.equal(after.find((m) => m.id === ids.ann).role, 'admin');
  const general = (await call('ben', 'GET', '/communities')).json.items.find((x) => x.id === comm.id).channels[0].conversationId;
  const m = (await call('ann', 'POST', `/conversations/${general}/messages`, { text: 'hello' })).json;
  assert.equal((await call('ben', 'POST', `/messages/${m.id}/pin`, {})).status, 200, 'new owner can moderate channels');

  assert.equal((await call('boss', 'DELETE', `/admin/api/communities/${comm.id}`, { confirmName: 'wrong' })).json.code, 'CONFIRM_NAME');
  assert.equal((await call('boss', 'DELETE', `/admin/api/communities/${comm.id}`, { confirmName: 'Lagos Young Adults' })).status, 200);
  assert.ok(!(await call('ann', 'GET', '/communities')).json.items.some((x) => x.id === comm.id));
  assert.equal((await q(env, 'SELECT COUNT(*)::int AS n FROM conversations WHERE id = $1', [general]))[0].n, 0, 'channel conversations deleted too');
});

test('events: list and remove with notifications', async () => {
  const ev = (await call('ann', 'POST', '/events', { title: 'Friday prayer night', startsAt: new Date(Date.now() + 864e5).toISOString() })).json;
  await call('ben', 'POST', `/events/${ev.id}/rsvp`, { status: 'going' });
  const up = (await call('boss', 'GET', '/admin/api/events?when=upcoming')).json.items;
  assert.equal(up.find((x) => x.id === ev.id).going, 2, 'host + ben');
  const del = await call('boss', 'DELETE', `/admin/api/events/${ev.id}`, { reason: 'Venue unavailable' });
  assert.equal(del.json.notified, 2);
  const n = (await call('ben', 'GET', '/me/notifications')).json.items.find((x) => /Friday prayer night/.test(x.title));
  assert.ok(n, 'RSVP got a notice');
  assert.equal(n.body, 'Venue unavailable');
});

test('announcements: create, schedule, turn off, notify all, validation', async () => {
  const a = await call('boss', 'POST', '/admin/api/announcements', { title: 'Advent reading plan starts Sunday', body: 'Join us', kind: 'event', verseRef: 'Isaiah 9:6', linkUrl: 'https://biblenestra.app/advent', notifyAll: true });
  assert.equal(a.status, 201);
  assert.ok(a.json.notified >= 4);
  const live = (await call('ann', 'GET', '/announcements')).json.items;
  assert.equal(live[0].title, 'Advent reading plan starts Sunday');
  assert.equal(live[0].verseRef, 'Isaiah 9:6');
  assert.ok((await call('ann', 'GET', '/me/notifications')).json.items.some((x) => x.title === 'Advent reading plan starts Sunday'));

  await call('boss', 'POST', '/admin/api/announcements', { title: 'Later', startsAt: new Date(Date.now() + 864e5).toISOString() });
  assert.ok(!(await call('ann', 'GET', '/announcements')).json.items.some((x) => x.title === 'Later'), 'scheduled ones wait');

  const u = await call('boss', 'POST', '/admin/api/announcements', { title: 'Server maintenance tonight', kind: 'urgent' });
  assert.equal((await call('ann', 'GET', '/announcements')).json.items[0].title, 'Server maintenance tonight', 'urgent first');
  const off = await call('boss', 'PATCH', `/admin/api/announcements/${u.json.id}`, { active: false });
  assert.equal(off.status, 200);
  const edited = await call('boss', 'PATCH', `/admin/api/announcements/${a.json.id}`, { title: 'Advent plan starts Sunday' });
  assert.equal(edited.json.verseRef, 'Isaiah 9:6', 'editing keeps the other fields');
  assert.equal(edited.json.linkUrl, 'https://biblenestra.app/advent');
  assert.ok(!(await call('ann', 'GET', '/announcements')).json.items.some((x) => x.id === u.json.id));

  assert.equal((await call('boss', 'POST', '/admin/api/announcements', { title: 'x', linkUrl: 'javascript:alert(1)' })).status, 400);
  assert.equal((await call('boss', 'POST', '/admin/api/announcements', { title: 'x', startsAt: '2030-01-02', endsAt: '2030-01-01' })).status, 400);
  assert.equal((await call('ann', 'POST', '/admin/api/announcements', { title: 'hack' })).status, 403);
  assert.equal((await call('boss', 'DELETE', `/admin/api/announcements/${u.json.id}`)).status, 200);
  const log = (await call('boss', 'GET', '/admin/api/actions')).json.items.map((x) => x.action);
  for (const act of ['announcement.create', 'announcement.delete', 'community.delete', 'event.delete', 'user.ban', 'user.coins', 'content.remove']) assert.ok(log.includes(act), act);
});
