// STAFF ACCESS: dashboard invites, staff accounts and roles. Logic + permission map: lib/staff.js · gate: lib/auth.js.
//
// Public (mounted before requireUser; rate limited per IP like the dashboard login):
//   POST /admin/api/staff/invite/check  { token }                       → who the invite is for
//   POST /admin/api/staff/invite/accept { token, username?, password }  → sets the password (single use), then sign in
// Owner only (area 'staff' — only the owner and the built-in Owner role have it):
//   GET   /admin/api/staff                          accounts, open invites, roles and areas
//   POST  /admin/api/staff/invites                  { name, emailNote?, role, permissions?, expiresInHours?, accessDays? }
//   PATCH /admin/api/staff/:id                      { name?, emailNote?, role?, permissions?, accessExpiresAt? }
//   POST  /admin/api/staff/:id/disable | enable | revoke-sessions
//   POST  /admin/api/staff/:id/invite               new one-time link (the old one stops working)
//   POST  /admin/api/staff/:id/invite/revoke        cancel the open link
// Invite links look like <origin>/admin#invite=<token>; the token is in the fragment so it never reaches server logs.
import { Hono } from 'hono';
import { one, q } from '../lib/db.js';
import { bad, body, forbidden, int, notFound, str, uuidParam } from '../lib/http.js';
import { audit, registerAdminScript } from './admin.js';
import { STAFF_ADMIN_SCRIPT } from '../lib/staffAdminPage.js';
import {
  AREAS, ROLES, ROLE_KEYS, USERNAME_RE, hashPassword, loginBlocked, normalizePermissions, passwordProblem,
  permissionsFor, randomToken, recordLoginFailure, sha256Hex,
} from '../lib/staff.js';

registerAdminScript(STAFF_ADMIN_SCRIPT);

const origin = (c) => (c.env.PUBLIC_API_URL || new URL(c.req.url).origin).replace(/\/$/, '');
const inviteLink = (c, token) => `${origin(c)}/admin#invite=${token}`;
const iso = (d) => (d ? new Date(d).toISOString() : null);

function staffShape(s, invite) {
  return {
    id: s.id, name: s.name, emailNote: s.email_note, username: s.username, role: s.role,
    roleLabel: (ROLES[s.role] || {}).label || s.role, permissions: permissionsFor(s),
    status: s.status, hasPassword: !!s.password_hash, lockedUntil: iso(s.locked_until), accessExpiresAt: iso(s.access_expires_at),
    lastLoginAt: iso(s.last_login_at), createdAt: iso(s.created_at),
    invite: invite ? { id: invite.id, expiresAt: iso(invite.expires_at), createdAt: iso(invite.created_at), expired: new Date(invite.expires_at).getTime() < Date.now() } : null,
  };
}

function roleInput(b, cur) {
  const role = b.role !== undefined ? b.role : cur && cur.role;
  if (!ROLE_KEYS.includes(role)) throw bad(`Role must be one of: ${ROLE_KEYS.join(', ')}`, 'BAD_ROLE');
  let permissions = {};
  if (role === 'custom') {
    permissions = normalizePermissions(b.permissions !== undefined ? b.permissions : cur && cur.permissions);
    if (!Object.keys(permissions).length) throw bad('Tick at least one permission for a custom role', 'NO_PERMISSIONS');
  }
  return { role, permissions };
}

async function newInvite(c, staffId, hours) {
  const me = c.get('user');
  await q(c.env, 'UPDATE staff_invites SET revoked_at = now() WHERE staff_id = $1 AND used_at IS NULL AND revoked_at IS NULL', [staffId]);
  const token = randomToken();
  const row = await one(c.env, `INSERT INTO staff_invites (staff_id, token_hash, expires_at, created_by)
    VALUES ($1, $2, now() + make_interval(hours => $3::int), $4) RETURNING *`, [staffId, await sha256Hex(token), hours, me.id]);
  return { id: row.id, token, link: inviteLink(c, token), expiresAt: iso(row.expires_at) };
}

// A live (unused, unrevoked, unexpired) invite by its token
async function liveInvite(env, token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  return one(env, `SELECT i.*, s.name, s.role, s.username, s.status FROM staff_invites i JOIN staff_accounts s ON s.id = i.staff_id
    WHERE i.token_hash = $1 AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()`, [await sha256Hex(token)]);
}

// ---------- public: open and accept an invite ----------
export const staffPublic = new Hono();
const ipOf = (c) => c.req.header('CF-Connecting-IP') || 'unknown';
const LINK_DEAD = { error: 'This invite link has expired, was already used or was cancelled. Ask the owner for a new one.', code: 'INVITE_INVALID' };

staffPublic.post('/admin/api/staff/invite/check', async (c) => {
  if (await loginBlocked(c.env, ipOf(c))) return c.json({ error: 'Too many attempts — please wait a few minutes', code: 'RATE_LIMITED' }, 429);
  const b = await c.req.json().catch(() => ({}));
  const inv = await liveInvite(c.env, b.token);
  if (!inv || inv.status === 'disabled') { await recordLoginFailure(c.env, ipOf(c)); return c.json(LINK_DEAD, 410); }
  return c.json({ name: inv.name, role: inv.role, roleLabel: (ROLES[inv.role] || {}).label || inv.role, username: inv.username, needsUsername: !inv.username, expiresAt: iso(inv.expires_at) });
});

staffPublic.post('/admin/api/staff/invite/accept', async (c) => {
  const env = c.env;
  if (await loginBlocked(env, ipOf(c))) return c.json({ error: 'Too many attempts — please wait a few minutes', code: 'RATE_LIMITED' }, 429);
  const b = await c.req.json().catch(() => ({}));
  const inv = await liveInvite(env, b.token);
  if (!inv || inv.status === 'disabled') { await recordLoginFailure(env, ipOf(c)); return c.json(LINK_DEAD, 410); }
  let username = inv.username;
  if (!username) {
    username = String(b.username || '').trim().toLowerCase();
    if (!USERNAME_RE.test(username)) return c.json({ error: 'Username: 3–32 characters, lower-case letters, numbers, dots, dashes or underscores, starting with a letter or number', code: 'BAD_USERNAME' }, 400);
    const ownerName = String(env.ADMIN_USERNAME || 'benjamin').trim().toLowerCase();
    if (username === ownerName || await one(env, 'SELECT 1 FROM staff_accounts WHERE username = $1 AND id <> $2', [username, inv.staff_id])) {
      return c.json({ error: 'That username is taken', code: 'USERNAME_TAKEN' }, 409);
    }
  }
  const password = typeof b.password === 'string' ? b.password : '';
  const problem = passwordProblem(password, username);
  if (problem) return c.json({ error: problem, code: 'WEAK_PASSWORD' }, 400);
  const hash = await hashPassword(password);
  // Single use: only one request can flip used_at on a live invite
  const used = await one(env, `UPDATE staff_invites SET used_at = now() WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now() RETURNING id`, [inv.id]);
  if (!used) return c.json(LINK_DEAD, 410);
  const row = await one(env, `UPDATE staff_accounts SET username = $2, password_hash = $3,
      status = CASE WHEN status = 'disabled' THEN status ELSE 'active' END,
      session_version = session_version + 1, failed_logins = 0, locked_until = NULL, updated_at = now()
    WHERE id = $1 RETURNING *`, [inv.staff_id, username, hash]);
  await q(env, `INSERT INTO admin_actions (admin_id, staff_id, action, target_type, target_id, details) VALUES (NULL, $1::uuid, 'staff.invite_accepted', 'staff', $1::text, $2::jsonb)`,
    [row.id, JSON.stringify({ name: row.name, username })]);
  return c.json({ ok: true, username, name: row.name });
});

// ---------- owner: manage staff ----------
export const adminStaff = new Hono();

async function loadStaff(c) {
  const id = uuidParam(c);
  const me = c.get('user');
  if (me.staffId && me.staffId === id) throw forbidden('You can’t change your own staff account here', 'SELF');
  const row = await one(c.env, 'SELECT * FROM staff_accounts WHERE id = $1', [id]);
  if (!row) throw notFound('Staff account not found');
  return row;
}

adminStaff.get('/admin/api/staff', async (c) => {
  const rows = await q(c.env, 'SELECT * FROM staff_accounts ORDER BY (status = \'disabled\'), created_at DESC');
  const invites = await q(c.env, `SELECT DISTINCT ON (staff_id) * FROM staff_invites WHERE used_at IS NULL AND revoked_at IS NULL
    ORDER BY staff_id, created_at DESC`);
  const byStaff = new Map(invites.map((i) => [i.staff_id, i]));
  return c.json({
    items: rows.map((s) => staffShape(s, byStaff.get(s.id))),
    roles: ROLE_KEYS.map((k) => ({ key: k, label: ROLES[k].label, hint: ROLES[k].hint, permissions: ROLES[k].permissions })),
    areas: AREAS.map((a) => ({ key: a.key, label: a.label, hint: a.hint, ownerOnly: !!a.ownerOnly })),
  });
});

adminStaff.post('/admin/api/staff/invites', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const name = str(b.name, { min: 1, max: 80, field: 'Name' });
  const emailNote = str(b.emailNote, { max: 200, optional: true, field: 'Email note' });
  const { role, permissions } = roleInput(b);
  const hours = b.expiresInHours == null ? 72 : int(b.expiresInHours, { min: 1, max: 720, field: 'Invite expiry (hours)' });
  const accessDays = b.accessDays == null || b.accessDays === '' ? null : int(b.accessDays, { min: 1, max: 3650, field: 'Access days' });
  const row = await one(c.env, `INSERT INTO staff_accounts (name, email_note, role, permissions, access_expires_at, created_by)
    VALUES ($1, $2, $3, $4::jsonb, CASE WHEN $5::int IS NULL THEN NULL ELSE now() + make_interval(days => $5::int) END, $6) RETURNING *`,
    [name, emailNote, role, JSON.stringify(permissions), accessDays, me.id]);
  const invite = await newInvite(c, row.id, hours);
  await audit(c.env, me, 'staff.invite', 'staff', row.id, { name, role, expiresAt: invite.expiresAt });
  const inv = await one(c.env, 'SELECT * FROM staff_invites WHERE id = $1', [invite.id]);
  return c.json({ staff: staffShape(row, inv), invite }, 201);
});

adminStaff.patch('/admin/api/staff/:id', async (c) => {
  const me = c.get('user');
  const cur = await loadStaff(c);
  const b = await body(c);
  const name = b.name !== undefined ? str(b.name, { min: 1, max: 80, field: 'Name' }) : cur.name;
  const emailNote = b.emailNote !== undefined ? str(b.emailNote, { max: 200, optional: true, field: 'Email note' }) : cur.email_note;
  const { role, permissions } = b.role !== undefined || b.permissions !== undefined ? roleInput(b, cur) : { role: cur.role, permissions: cur.permissions };
  let access = cur.access_expires_at;
  if (b.accessExpiresAt !== undefined) {
    if (b.accessExpiresAt === null || b.accessExpiresAt === '') access = null;
    else if (Number.isNaN(Date.parse(b.accessExpiresAt))) throw bad('accessExpiresAt must be a date');
    else access = new Date(b.accessExpiresAt).toISOString();
  }
  const row = await one(c.env, `UPDATE staff_accounts SET name = $2, email_note = $3, role = $4, permissions = $5::jsonb, access_expires_at = $6, updated_at = now()
    WHERE id = $1 RETURNING *`, [cur.id, name, emailNote, role, JSON.stringify(permissions || {}), access]);
  await audit(c.env, me, role !== cur.role || JSON.stringify(permissions || {}) !== JSON.stringify(cur.permissions || {}) ? 'staff.role' : 'staff.update', 'staff', cur.id,
    { name, from: cur.role, role, permissions: role === 'custom' ? permissions : undefined });
  return c.json(staffShape(row));
});

adminStaff.post('/admin/api/staff/:id/:action{disable|enable|revoke-sessions}', async (c) => {
  const me = c.get('user');
  const cur = await loadStaff(c);
  const action = c.req.param('action');
  const sql = action === 'disable' ? `status = 'disabled', session_version = session_version + 1`
    : action === 'enable' ? `status = CASE WHEN password_hash IS NULL THEN 'invited' ELSE 'active' END, failed_logins = 0, locked_until = NULL`
    : 'session_version = session_version + 1';
  const row = await one(c.env, `UPDATE staff_accounts SET ${sql}, updated_at = now() WHERE id = $1 RETURNING *`, [cur.id]);
  await audit(c.env, me, `staff.${action.replace('-', '_')}`, 'staff', cur.id, { name: cur.name });
  return c.json(staffShape(row));
});

adminStaff.post('/admin/api/staff/:id/invite', async (c) => {
  const me = c.get('user');
  const cur = await loadStaff(c);
  if (cur.status === 'disabled') throw bad('Enable this account before sending a new link', 'DISABLED');
  const b = await c.req.json().catch(() => ({}));
  const hours = b.expiresInHours == null ? 72 : int(b.expiresInHours, { min: 1, max: 720, field: 'Invite expiry (hours)' });
  const invite = await newInvite(c, cur.id, hours);
  await audit(c.env, me, cur.password_hash ? 'staff.reset_link' : 'staff.invite_resend', 'staff', cur.id, { name: cur.name, expiresAt: invite.expiresAt });
  return c.json({ invite });
});

adminStaff.post('/admin/api/staff/:id/invite/revoke', async (c) => {
  const me = c.get('user');
  const cur = await loadStaff(c);
  const r = await q(c.env, 'UPDATE staff_invites SET revoked_at = now() WHERE staff_id = $1 AND used_at IS NULL AND revoked_at IS NULL RETURNING id', [cur.id]);
  await audit(c.env, me, 'staff.invite_revoke', 'staff', cur.id, { name: cur.name, links: r.length });
  return c.json({ ok: true, revoked: r.length });
});
