// STAFF ACCESS: invites, staff sign-in, roles and the central permission gate.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { one, q } from '../src/lib/db.js';
import { areaFor, hashPassword, verifyPassword } from '../src/lib/staff.js';

let env; const app = createApp();
let owner;
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', ADMIN_PASSWORD: 'pw-admin', REALTIME_SECRET: 'rt' };
});
async function call(who, method, path, body, headers = {}) {
  const h = { ...headers };
  if (who && /^(admin|staff)_token_/.test(who)) h.Authorization = `Bearer ${who}`;
  else if (who) h['X-Dev-User'] = who;
  let b;
  if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${path}`, { method, headers: h, body: b }), env);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = text; }
  return { status: res.status, json };
}
const tokenOf = (link) => link.split('#invite=')[1];
const login = (username, password, ip = '10.0.0.1') => call(null, 'POST', '/admin/api/login', { username, password }, { 'CF-Connecting-IP': ip });

async function invite(role, extra = {}) {
  const r = await call(owner, 'POST', '/admin/api/staff/invites', { name: `${role} person`, role, ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json;
}
async function onboard(role, username, extra) {
  const inv = await invite(role, extra);
  const acc = await call(null, 'POST', '/admin/api/staff/invite/accept', { token: tokenOf(inv.invite.link), username, password: 'correct horse battery' });
  assert.equal(acc.status, 200, JSON.stringify(acc.json));
  const l = await login(username, 'correct horse battery');
  assert.equal(l.status, 200, JSON.stringify(l.json));
  return { id: inv.staff.id, token: l.json.token };
}

test('passwords are PBKDF2 hashes, never plain text', async () => {
  const h = await hashPassword('correct horse battery');
  assert.match(h, /^pbkdf2-sha256\$100000\$/);
  assert.ok(!h.includes('correct horse'));
  assert.equal(await verifyPassword('correct horse battery', h), true);
  assert.equal(await verifyPassword('wrong horse battery', h), false);
  assert.notEqual(h, await hashPassword('correct horse battery'), 'per-user salt');
});

test('route map: areas per prefix, unmapped admin routes are owner-only', () => {
  assert.equal(areaFor('/admin/api/fundme/payouts'), 'fundme');
  assert.equal(areaFor('/admin/api/users/abc/role'), 'staff');
  assert.equal(areaFor('/admin/api/users/abc/coins'), 'wallets');
  assert.equal(areaFor('/admin/api/users'), 'users');
  assert.equal(areaFor('/admin/api/contest-disputes'), 'contests');
  assert.equal(areaFor('/memberships/manage/x'), 'memberships');
  assert.equal(areaFor('/admin/api/something-new'), null);
  assert.equal(areaFor('/posts'), null);
});

test('owner admin token still has full access; staff tab and staff API work for the owner', async () => {
  owner = (await login('benjamin', 'pw-admin')).json.token;
  assert.match(owner, /^admin_token_/);
  const me = await call(owner, 'GET', '/admin/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.json.owner, true);
  assert.equal(me.json.permissions, null);
  assert.equal((await call(owner, 'GET', '/admin/api/stats')).status, 200);
  assert.equal((await call(owner, 'GET', '/admin/api/staff')).status, 200);
  const page = await (await app.fetch(new Request('http://api.test/admin'), env)).text();
  assert.ok(page.includes("registerAdminTab('Staff'"));
});

test('invite is created, accepted once, and the person signs in with a staff token', async () => {
  const inv = await invite('moderator', { emailNote: 'mod@example.org', expiresInHours: 48 });
  assert.equal(inv.staff.status, 'invited');
  assert.ok(inv.invite.link.startsWith('http://api.test/admin#invite='));
  const token = tokenOf(inv.invite.link);
  const row = await one(env, 'SELECT token_hash FROM staff_invites WHERE staff_id = $1', [inv.staff.id]);
  assert.notEqual(row.token_hash, token, 'only the hash is stored');

  const chk = await call(null, 'POST', '/admin/api/staff/invite/check', { token });
  assert.equal(chk.status, 200);
  assert.equal(chk.json.roleLabel, 'Moderator');
  assert.equal(chk.json.needsUsername, true);

  assert.equal((await call(null, 'POST', '/admin/api/staff/invite/accept', { token, username: 'mod.one', password: 'short' })).status, 400, 'weak password');
  assert.equal((await call(null, 'POST', '/admin/api/staff/invite/accept', { token, username: 'benjamin', password: 'correct horse battery' })).status, 409, 'owner username is reserved');
  const acc = await call(null, 'POST', '/admin/api/staff/invite/accept', { token, username: 'mod.one', password: 'correct horse battery' });
  assert.equal(acc.status, 200);
  const stored = await one(env, 'SELECT password_hash, status FROM staff_accounts WHERE id = $1', [inv.staff.id]);
  assert.equal(stored.status, 'active');
  assert.ok(stored.password_hash.startsWith('pbkdf2-sha256$') && !stored.password_hash.includes('correct horse'));

  // single use
  assert.equal((await call(null, 'POST', '/admin/api/staff/invite/accept', { token, username: 'mod.two', password: 'another good password' })).status, 410);
  assert.equal((await call(null, 'POST', '/admin/api/staff/invite/check', { token })).status, 410);

  assert.equal((await login('mod.one', 'wrong password!!')).status, 401);
  const l = await login('mod.one', 'correct horse battery');
  assert.equal(l.status, 200);
  assert.match(l.json.token, /^staff_token_/);
  assert.equal(l.json.user.staffRole, 'moderator');
  const me = await call(l.json.token, 'GET', '/admin/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.json.owner, false);
  assert.equal(me.json.staff.username, 'mod.one');
  assert.equal(me.json.permissions.moderation, 'manage');
  assert.equal(me.json.permissions.fundme, undefined);
});

test('an expired invite link cannot be used', async () => {
  const inv = await invite('viewer');
  await q(env, `UPDATE staff_invites SET expires_at = now() - interval '1 minute' WHERE staff_id = $1`, [inv.staff.id]);
  const r = await call(null, 'POST', '/admin/api/staff/invite/accept', { token: tokenOf(inv.invite.link), username: 'late.viewer', password: 'correct horse battery' });
  assert.equal(r.status, 410);
  assert.equal(r.json.code, 'INVITE_INVALID');
  // a resent link replaces it; the owner can also revoke it
  const again = await call(owner, 'POST', `/admin/api/staff/${inv.staff.id}/invite`, {});
  assert.equal(again.status, 200);
  assert.equal((await call(owner, 'POST', `/admin/api/staff/${inv.staff.id}/invite/revoke`, {})).json.revoked, 1);
  assert.equal((await call(null, 'POST', '/admin/api/staff/invite/check', { token: tokenOf(again.json.invite.link) })).status, 410, 'revoked link is dead');
});

test('role blocks forbidden routes (403) and allows permitted ones; actions are logged with the staff id', async () => {
  const fin = await onboard('finance', 'fin.one');
  assert.equal((await call(fin.token, 'GET', '/admin/api/fundme/payouts')).status, 200, 'finance can see payouts');
  assert.equal((await call(fin.token, 'GET', '/admin/api/wallet/overview')).status, 200);
  const blocked = await call(fin.token, 'GET', '/admin/api/users');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.code, 'STAFF_FORBIDDEN');
  assert.equal((await call(fin.token, 'GET', '/admin/api/staff')).status, 403, 'staff management is owner-only');
  assert.equal((await call(fin.token, 'GET', '/admin/api/companion/vectors')).status, 403, 'settings are owner-only');
  const unmapped = await call(fin.token, 'GET', '/admin/api/not-mapped-yet');
  assert.equal(unmapped.status, 403);
  assert.equal(unmapped.json.code, 'OWNER_ONLY');
  assert.equal((await call(fin.token, 'GET', '/posts')).status, 403, 'staff tokens are for the dashboard only');

  const mod = await onboard('moderator', 'mod.two');
  const target = (await call('ann', 'GET', '/me')).json.id;
  const ban = await call(mod.token, 'POST', `/admin/api/users/${target}/ban`, { reason: 'spam' });
  assert.equal(ban.status, 200, JSON.stringify(ban.json));
  assert.equal((await call(mod.token, 'POST', `/admin/api/users/${target}/role`, { role: 'admin' })).status, 403, 'only the owner makes admins');
  const logged = await one(env, `SELECT * FROM admin_actions WHERE staff_id = $1 AND action = 'user.ban'`, [mod.id]);
  assert.ok(logged, 'the ban is attributed to the staff member');
  const log = await call(owner, 'GET', `/admin/api/actions?staff=${mod.id}`);
  assert.ok(log.json.items.length >= 2);
  assert.ok(log.json.items.every((a) => a.staffId === mod.id));
  assert.ok(log.json.items.some((a) => a.admin === 'moderator person (staff)'));
  assert.ok(log.json.staff.some((s) => s.id === mod.id));
  await call(owner, 'POST', `/admin/api/users/${target}/ban`, { banned: false });
});

test('view-only staff can read but not write', async () => {
  const v = await onboard('viewer', 'view.one');
  assert.equal((await call(v.token, 'GET', '/admin/api/users')).status, 200);
  assert.equal((await call(v.token, 'GET', '/admin/api/fundme/payouts')).status, 200);
  const target = (await call('ben', 'GET', '/me')).json.id;
  const w = await call(v.token, 'POST', `/admin/api/users/${target}/verify`, { verified: true });
  assert.equal(w.status, 403);
  assert.equal(w.json.code, 'STAFF_FORBIDDEN');
  assert.equal((await one(env, 'SELECT verified FROM users WHERE id = $1', [target])).verified, false);
  assert.equal((await call(v.token, 'GET', '/admin/api/staff')).status, 403, 'viewer cannot see staff');

  // custom role: exactly the ticked areas
  const cus = await onboard('custom', 'custom.one', { permissions: { blog: 'view', ads: 'manage', staff: 'manage' } });
  assert.equal((await call(cus.token, 'GET', '/admin/api/blog/posts')).status, 200);
  assert.equal((await call(cus.token, 'GET', '/admin/api/ads/config')).status, 200);
  assert.equal((await call(cus.token, 'GET', '/admin/api/staff')).status, 403, 'staff area cannot be ticked');
  assert.equal((await call(cus.token, 'GET', '/admin/api/users')).status, 403);
});

test('disabled accounts and revoked sessions are rejected; role changes apply at once', async () => {
  const s = await onboard('moderator', 'mod.three');
  assert.equal((await call(s.token, 'GET', '/admin/api/users')).status, 200);
  assert.equal((await call(owner, 'PATCH', `/admin/api/staff/${s.id}`, { role: 'finance' })).status, 200);
  assert.equal((await call(s.token, 'GET', '/admin/api/users')).status, 403, 'now finance');
  assert.equal((await call(s.token, 'GET', '/admin/api/fundme/payouts')).status, 200);

  assert.equal((await call(owner, 'POST', `/admin/api/staff/${s.id}/revoke-sessions`, {})).status, 200);
  assert.equal((await call(s.token, 'GET', '/admin/api/me')).status, 401, 'old session is gone');
  const again = (await login('mod.three', 'correct horse battery')).json.token;
  assert.equal((await call(again, 'GET', '/admin/api/me')).status, 200);

  assert.equal((await call(owner, 'POST', `/admin/api/staff/${s.id}/disable`, {})).json.status, 'disabled');
  assert.equal((await call(again, 'GET', '/admin/api/me')).status, 401);
  const l = await login('mod.three', 'correct horse battery');
  assert.equal(l.status, 403);
  assert.equal(l.json.code, 'STAFF_DISABLED');
  assert.equal((await call(owner, 'POST', `/admin/api/staff/${s.id}/enable`, {})).json.status, 'active');
  assert.equal((await login('mod.three', 'correct horse battery')).status, 200);
});

test('repeated wrong passwords lock the account; many failures from one IP are rate limited', async () => {
  await onboard('viewer', 'lock.me');
  for (let i = 0; i < 5; i++) assert.equal((await login('lock.me', 'not the password', '10.0.0.9')).status, 401);
  const locked = await login('lock.me', 'correct horse battery', '10.0.0.9');
  assert.equal(locked.status, 429);
  assert.equal(locked.json.code, 'ACCOUNT_LOCKED');

  for (let i = 0; i < 20; i++) await login('nobody.here', 'whatever password', '10.0.0.77');
  const limited = await login('benjamin', 'pw-admin', '10.0.0.77');
  assert.equal(limited.status, 429);
  assert.equal(limited.json.code, 'RATE_LIMITED');
  assert.equal((await login('benjamin', 'pw-admin', '10.0.0.78')).status, 200, 'other addresses are unaffected');
});
