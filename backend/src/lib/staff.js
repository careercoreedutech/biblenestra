// STAFF ACCESS: invited dashboard staff with roles and per-area permissions.
//
// * The owner (ADMIN_PASSWORD sign-in, or any users.role = 'admin' account) has full access, exactly as before.
// * Staff are invited with a one-time link (/admin#invite=<token>; only the SHA-256 of the token is stored), set
//   their own username + password (PBKDF2-SHA256, 100k iterations — the Workers maximum — and a per-user salt) and
//   then sign in on the normal dashboard login. They get a signed `staff_token_…` (lib/ticket.js) carrying their id,
//   role and session version; every request re-reads the account, so disabling, "revoke sessions" (session_version
//   bump) and role changes apply at once.
// * Enforcement is central (lib/auth.js → staffGate): each request path is mapped to an area by ROUTE_AREAS below,
//   GET/HEAD/OPTIONS need 'view', anything else 'manage'. A path with no mapping is owner-only, so a new admin route
//   is closed to staff until someone maps it here.
// * Staff act as the owner's users row inside route handlers (so existing role checks and created-by columns keep
//   working) but every admin_actions row they cause carries staff_id; writes that a handler didn't audit get a
//   generic "staff.request" row (see auth.js).

import { one, q } from './db.js';
import { createStaffToken } from './ticket.js';

export const AREAS = [
  { key: 'overview', label: 'Overview', hint: 'Dashboard stats' },
  { key: 'users', label: 'Users', hint: 'Member accounts, bans, verification, account deletions' },
  { key: 'moderation', label: 'Moderation', hint: 'Reports queue, posts and comments, communities and events, member websites, priests and apostle' },
  { key: 'dating', label: 'Find Love', hint: 'Dating profiles, photos, reports, boosts and settings' },
  { key: 'fundme', label: 'Fund Me', hint: 'Fundraiser approvals, donations, payouts, bank accounts' },
  { key: 'wallets', label: 'Wallets & payments', hint: 'Wallets, ledger, purchases and refunds, Paystack, chat passes, member coins and premium' },
  { key: 'gifts', label: 'Virtual gifts', hint: 'Gift catalogue, sends, earnings, withdrawals' },
  { key: 'memberships', label: 'Memberships', hint: 'Paid channels, plans, promos, lessons, subscribers' },
  { key: 'blog', label: 'Blog', hint: 'Posts, AI generation, schedules' },
  { key: 'library', label: 'Library', hint: 'Audio and books, categories, library reports' },
  { key: 'learn', label: 'Learn', hint: 'Courses, lessons, devotionals' },
  { key: 'contests', label: 'Contests', hint: 'Contests, categories, disputes, organisers, sponsors, votes' },
  { key: 'opportunities', label: 'Opportunities', hint: 'Opportunity sources and directory' },
  { key: 'media', label: 'Videos & Daily Bread', hint: 'YouTube channels, YouTube live, Watch on Today, Daily Bread and videos' },
  { key: 'broadcasts', label: 'Broadcasts & announcements', hint: 'Messages to every inbox, Socials posts, in-app announcements' },
  { key: 'ads', label: 'Ads', hint: 'Ad rules and stats' },
  { key: 'audit', label: 'Audit log', hint: 'Who did what on the dashboard' },
  { key: 'settings', label: 'Settings & secrets', hint: 'Companion search index, demo data, owner-only tools', ownerOnly: true },
  { key: 'staff', label: 'Staff', hint: 'Invites, staff accounts, admin rights', ownerOnly: true },
];
const AREA_KEYS = AREAS.map((a) => a.key);
const OWNER_ONLY = new Set(AREAS.filter((a) => a.ownerOnly).map((a) => a.key));

const all = (level, filter = () => true) => Object.fromEntries(AREA_KEYS.filter(filter).map((k) => [k, level]));
export const ROLES = {
  owner: { label: 'Owner', hint: 'Everything, including staff and settings', permissions: all('manage') },
  finance: { label: 'Finance', hint: 'Fund Me, payouts, wallets, payments and gift withdrawals', permissions: { overview: 'view', fundme: 'manage', wallets: 'manage', gifts: 'manage' } },
  moderator: { label: 'Moderator', hint: 'Users, content moderation and Find Love', permissions: { overview: 'view', users: 'manage', moderation: 'manage', dating: 'manage' } },
  content: { label: 'Content editor', hint: 'Blog, library, learn, contests and opportunities', permissions: { overview: 'view', blog: 'manage', library: 'manage', learn: 'manage', contests: 'manage', opportunities: 'manage' } },
  viewer: { label: 'Viewer', hint: 'View-only on everything except staff and settings', permissions: all('view', (k) => !OWNER_ONLY.has(k)) },
  custom: { label: 'Custom', hint: 'Only the areas you tick', permissions: null },
};
export const ROLE_KEYS = Object.keys(ROLES);

// Route prefix → area. First match wins; anything under /admin/api/ that matches nothing is owner-only.
// Non-admin paths a staff token may reach are listed here too (the dashboard uses them); every other path is refused.
export const ROUTE_AREAS = [
  [/^\/admin\/api\/me$/, 'self'],
  [/^\/admin\/api\/staff(\/|$)/, 'staff'],
  [/^\/admin\/api\/users\/[^/]+\/role$/, 'staff'], // "Make admin" = full dashboard access
  [/^\/admin\/api\/users\/[^/]+\/(coins|premium)$/, 'wallets'],
  [/^\/admin\/api\/(users|account-deletions)(\/|$)/, 'users'],
  [/^\/admin\/api\/stats$/, 'overview'],
  [/^\/admin\/api\/actions$/, 'audit'],
  [/^\/admin\/api\/(reports|content|communities|events|websites|care)(\/|$)/, 'moderation'],
  [/^\/admin\/api\/(broadcasts|announcements)(\/|$)/, 'broadcasts'],
  [/^\/admin\/api\/fundme(\/|$)/, 'fundme'],
  [/^\/admin\/api\/(wallet|paystack|chat-passes)(\/|$)/, 'wallets'],
  [/^\/admin\/api\/gifts(\/|$)/, 'gifts'],
  [/^\/admin\/api\/dating(\/|$)/, 'dating'],
  [/^\/admin\/api\/blog(\/|$)/, 'blog'],
  [/^\/admin\/api\/library(\/|$)/, 'library'],
  [/^\/admin\/api\/learn(\/|$)/, 'learn'],
  [/^\/admin\/api\/(contests|contest-[a-z-]+)(\/|$)/, 'contests'],
  [/^\/admin\/api\/(opportunities|opportunity-[a-z-]+)(\/|$)/, 'opportunities'],
  [/^\/admin\/api\/(youtube|daily)(\/|$)/, 'media'],
  [/^\/admin\/api\/ads(\/|$)/, 'ads'],
  [/^\/admin\/api\/(companion|seed)(\/|$)/, 'settings'],
  [/^\/memberships\/manage(\/|$)/, 'memberships'],
  [/^\/library\/(items|files)(\/|$)/, 'library'],
  [/^\/uploads(\/|$)/, 'uploads'], // image/video uploads used by several tabs: any 'manage' permission
];

/** The area for a request path: an area key, 'self', 'uploads', or null (owner-only / not for staff). */
export function areaFor(path) {
  for (const [re, area] of ROUTE_AREAS) if (re.test(path)) return area;
  return null;
}
export const levelFor = (method) => (['GET', 'HEAD', 'OPTIONS'].includes(String(method).toUpperCase()) ? 'view' : 'manage');

/** Clean a custom permission map: known, tickable areas only; values 'view' | 'manage'. */
export function normalizePermissions(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const k of AREA_KEYS) {
    if (OWNER_ONLY.has(k)) continue;
    const v = input[k];
    if (v === 'manage' || v === 'view') out[k] = v;
  }
  return out;
}

/** Effective permissions of a staff_accounts row: { area: 'view' | 'manage' }. */
export function permissionsFor(staff) {
  if (!staff) return {};
  if (staff.role === 'custom') return normalizePermissions(staff.permissions);
  return { ...(ROLES[staff.role] ? ROLES[staff.role].permissions : {}) };
}

export function can(perms, area, level) {
  if (area === 'self') return true;
  if (area === 'uploads') return level === 'view' || Object.entries(perms).some(([k, v]) => v === 'manage' && k !== 'overview' && k !== 'audit');
  if (!area) return false;
  const have = perms[area];
  return have === 'manage' || (have === 'view' && level === 'view');
}

/** Is this request allowed for this staff account? Returns { ok, area, level }. */
export function checkRequest(staff, method, path) {
  const area = areaFor(path);
  const level = levelFor(method);
  return { ok: can(permissionsFor(staff), area, level), area, level };
}

// ---------- passwords (PBKDF2-SHA256 via WebCrypto) ----------
const enc = new TextEncoder();
const PBKDF2_ITERATIONS = 100000; // Cloudflare Workers refuses more than 100,000
function b64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); }
function unb64(s) { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
/** "pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>" */
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return ['pbkdf2-sha256', PBKDF2_ITERATIONS, b64(salt), b64(hash)].join('$');
}
const DUMMY_SALT = new Uint8Array(16);
export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') {
    await derive(String(password), DUMMY_SALT, PBKDF2_ITERATIONS); // same work either way (no username probing by timing)
    return false;
  }
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > PBKDF2_ITERATIONS) return false;
  const got = await derive(String(password), unb64(parts[2]), iterations);
  return sameBytes(got, unb64(parts[3]));
}
export function passwordProblem(password, username) {
  const p = String(password || '');
  if (p.length < 10) return 'Use at least 10 characters for the password';
  if (p.length > 200) return 'That password is too long';
  if (username && p.toLowerCase().includes(String(username).toLowerCase())) return 'The password can’t contain the username';
  return null;
}
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

// ---------- invite tokens ----------
export function randomToken(bytes = 32) {
  return b64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function sha256Hex(s) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(s))));
  return Array.from(d, (x) => x.toString(16).padStart(2, '0')).join('');
}

export const STAFF_TOKEN_TTL = 12 * 3600; // staff sessions last 12 hours
export const LOCKOUT = { maxFails: 5, minutes: 15 }; // per account
export const IP_FAILS = { max: 20, windowSec: 900 }; // per IP address, failed dashboard sign-ins (owner or staff)

// ---------- dashboard sign-in for staff (called from POST /admin/api/login in routes/admin.js) ----------

const ipKey = (ip) => `admin_login_fail:${String(ip || 'unknown').slice(0, 64)}`;
const ipWindow = () => Math.floor(Date.now() / 1000 / IP_FAILS.windowSec);
/** Too many failed dashboard sign-ins from this address in the current window? (rate_limit_hits, as in lib/wallet.js) */
export async function loginBlocked(env, ip) {
  const r = await one(env, 'SELECT n FROM rate_limit_hits WHERE key = $1 AND window_start = $2', [ipKey(ip), ipWindow()]);
  return !!r && r.n >= IP_FAILS.max;
}
export async function recordLoginFailure(env, ip) {
  await q(env, `INSERT INTO rate_limit_hits (key, window_start, n) VALUES ($1, $2, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET n = rate_limit_hits.n + 1`, [ipKey(ip), ipWindow()]);
}

const fail = (status, code, error) => ({ ok: false, status, code, error });
/** Staff username + password → { ok, token, expiresAt, staff } or { ok: false, status, code, error }. */
export async function staffSignIn(env, secret, username, password) {
  const row = USERNAME_RE.test(username) ? await one(env, 'SELECT * FROM staff_accounts WHERE username = $1', [username]) : null;
  if (!row || !row.password_hash) {
    await verifyPassword(password, null);
    return fail(401, 'INVALID_CREDENTIALS', 'Incorrect username or password');
  }
  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    const mins = Math.max(1, Math.ceil((new Date(row.locked_until).getTime() - Date.now()) / 60000));
    return fail(429, 'ACCOUNT_LOCKED', `Too many wrong passwords — try again in ${mins} minute${mins === 1 ? '' : 's'}`);
  }
  if (!(await verifyPassword(password, row.password_hash))) {
    await q(env, `UPDATE staff_accounts SET
        locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3::int) ELSE locked_until END,
        failed_logins = CASE WHEN failed_logins + 1 >= $2 THEN 0 ELSE failed_logins + 1 END
      WHERE id = $1`, [row.id, LOCKOUT.maxFails, LOCKOUT.minutes]);
    return fail(401, 'INVALID_CREDENTIALS', 'Incorrect username or password');
  }
  if (row.status === 'disabled') return fail(403, 'STAFF_DISABLED', 'This staff account has been disabled');
  if (row.status !== 'active') return fail(401, 'INVALID_CREDENTIALS', 'Incorrect username or password');
  if (row.access_expires_at && new Date(row.access_expires_at).getTime() < Date.now()) return fail(403, 'STAFF_EXPIRED', 'This staff account’s access has ended');
  await q(env, 'UPDATE staff_accounts SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [row.id]);
  const { token, expiresAt } = await createStaffToken(secret, { id: row.id, role: row.role, version: row.session_version }, STAFF_TOKEN_TTL);
  await q(env, `INSERT INTO admin_actions (admin_id, staff_id, action, target_type, target_id, details) VALUES (NULL, $1::uuid, 'staff.login', 'staff', $1::text, $2::jsonb)`,
    [row.id, JSON.stringify({ name: row.name, username: row.username })]);
  return { ok: true, token, expiresAt, staff: row };
}
