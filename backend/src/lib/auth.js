// Authentication: verifies the Clerk session token (Authorization: Bearer …) and loads/creates the
// matching user row. Local development can use X-Dev-User when AUTH_DEV_MODE=true (never in production).
import { verifyToken, createClerkClient } from '@clerk/backend';
import { ApiError, isUuid } from './http.js';
import { one, q } from './db.js';
import { verifyAdminToken, verifyStaffToken } from './ticket.js';
import { checkRequest, permissionsFor } from './staff.js';

async function clerkSubject(c) {
  const env = c.env;
  const h = c.req.header('Authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : null;
  if (token) {
    if (token.startsWith('staff_token_')) { // STAFF ACCESS: invited dashboard staff (lib/staff.js)
      const check = await verifyStaffToken(env.REALTIME_SECRET || env.ADMIN_PASSWORD, token);
      if (check.valid && isUuid(check.id)) return { sub: 'staff', dev: false, staffId: check.id, staffVersion: check.version };
      throw new ApiError(401, 'INVALID_TOKEN', 'Staff session expired — please sign in again');
    }
    if (token.startsWith('admin_token_')) {
      const secret = env.REALTIME_SECRET || env.ADMIN_PASSWORD;
      const check = secret ? await verifyAdminToken(secret, token) : { valid: false };
      if (check.valid) {
        return { sub: 'admin', dev: false, isAdmin: true, username: check.username };
      }
      throw new ApiError(401, 'INVALID_TOKEN', 'Admin session expired — please sign in again');
    }
    if (!env.CLERK_SECRET_KEY && !env.CLERK_JWT_KEY) throw new ApiError(500, 'AUTH_NOT_CONFIGURED', 'Clerk keys are not configured on the server');
    try {
      const payload = await verifyToken(token, {
        secretKey: env.CLERK_SECRET_KEY,
        jwtKey: env.CLERK_JWT_KEY || undefined, // networkless verification when set
        authorizedParties: env.CLERK_AUTHORIZED_PARTIES ? env.CLERK_AUTHORIZED_PARTIES.split(',').map((s) => s.trim()) : undefined,
      });
      return { sub: payload.sub, dev: false };
    } catch (e) {
      throw new ApiError(401, 'INVALID_TOKEN', 'Your session has expired — please sign in again');
    }
  }
  const dev = c.req.header('X-Dev-User');
  if (dev && env.AUTH_DEV_MODE === 'true') {
    if (!/^[\w.-]{1,40}$/.test(dev)) throw new ApiError(400, 'BAD_DEV_USER', 'Invalid dev user');
    return { sub: `dev_${dev}`, dev: true, devName: dev };
  }
  throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in');
}

// Best-effort profile from Clerk for brand-new users (name + avatar)
async function clerkProfile(env, sub) {
  if (!env.CLERK_SECRET_KEY) return {};
  try {
    const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
    const u = await clerk.users.getUser(sub);
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || (u.emailAddresses?.[0]?.emailAddress || '').split('@')[0];
    return { name: name || null, avatar: u.imageUrl || null };
  } catch (e) { return {}; }
}

// The owner's users row (what the ADMIN_PASSWORD sign-in acts as)
async function ownerRow(env) {
  let admin = await one(env, "SELECT * FROM users WHERE role = 'admin' LIMIT 1");
  if (!admin) {
    admin = await one(env, `INSERT INTO users (clerk_id, display_name, handle, role) VALUES ('admin', 'Benjamin', 'benjamin', 'admin') ON CONFLICT (clerk_id) DO UPDATE SET role = 'admin' RETURNING *`);
  }
  return admin;
}

// STAFF ACCESS: the central permission gate. The account is re-read on every request (disable / revoke sessions /
// role changes apply at once); the path → area map and the view/manage rule live in lib/staff.js. Allowed requests
// run as the owner's users row (so existing admin checks keep working) tagged with staffId; audit() writes that into
// admin_actions.staff_id, and a successful write that no handler audited gets a generic "staff.request" row.
async function staffRequest(c, next, subj) {
  const env = c.env;
  const staff = await one(env, 'SELECT * FROM staff_accounts WHERE id = $1', [subj.staffId]);
  if (!staff || staff.session_version !== subj.staffVersion) throw new ApiError(401, 'INVALID_TOKEN', 'This session has ended — please sign in again');
  if (staff.status === 'disabled') throw new ApiError(403, 'STAFF_DISABLED', 'This staff account has been disabled');
  if (staff.status !== 'active') throw new ApiError(401, 'INVALID_TOKEN', 'Please sign in again');
  if (staff.access_expires_at && new Date(staff.access_expires_at).getTime() < Date.now()) throw new ApiError(403, 'STAFF_EXPIRED', 'This staff account’s access has ended');
  const chk = checkRequest(staff, c.req.method, c.req.path);
  if (!chk.ok) {
    throw new ApiError(403, chk.area ? 'STAFF_FORBIDDEN' : 'OWNER_ONLY', !chk.area ? 'Only the owner can use this'
      : chk.level === 'manage' ? 'Your staff role can only view this area' : 'Your staff role can’t open this area');
  }
  const owner = await ownerRow(env);
  const user = { ...owner, staffId: staff.id, staffName: staff.name, staffRole: staff.role };
  c.set('user', user);
  c.set('staff', { id: staff.id, name: staff.name, username: staff.username, role: staff.role, permissions: permissionsFor(staff), area: chk.area, level: chk.level });
  await next();
  if (chk.level === 'manage' && !user.__audited && c.res && c.res.status < 400) {
    await q(env, `INSERT INTO admin_actions (admin_id, staff_id, action, target_type, target_id, details) VALUES ($1, $2, 'staff.request', 'route', $3, $4::jsonb)`,
      [owner.id, staff.id, c.req.path.slice(0, 300), JSON.stringify({ method: c.req.method, area: chk.area, status: c.res.status, staff: staff.name })]).catch(() => {});
  }
}

export function requireUser() {
  return async (c, next) => {
    const subj = await clerkSubject(c);
    const { sub, dev, devName } = subj;
    if (sub === 'staff') return staffRequest(c, next, subj);
    if (sub === 'admin') {
      c.set('user', await ownerRow(c.env));
      await next();
      return;
    }
    let user = await one(c.env, 'SELECT * FROM users WHERE clerk_id = $1', [sub]);
    if (!user) {
      const p = dev ? { name: devName.charAt(0).toUpperCase() + devName.slice(1) } : await clerkProfile(c.env, sub);
      user = await one(c.env,
        `INSERT INTO users (clerk_id, display_name, avatar_url) VALUES ($1, $2, $3)
         ON CONFLICT (clerk_id) DO NOTHING RETURNING *`, [sub, p.name || 'Friend', p.avatar || null]);
      if (user) await q(c.env, `INSERT INTO coin_ledger (user_id, amount, reason) VALUES ($1, $2, 'welcome')`, [user.id, user.coins]);
      else user = await one(c.env, 'SELECT * FROM users WHERE clerk_id = $1', [sub]); // created concurrently
    }
    if (user.banned) throw new ApiError(403, 'BANNED', 'This account has been suspended');
    const tz = Number(c.req.header('X-TZ-Offset'));
    if (Number.isInteger(tz) && tz >= -840 && tz <= 840 && tz !== user.tz_offset) {
      await q(c.env, 'UPDATE users SET tz_offset = $2 WHERE id = $1', [user.id, tz]);
      user.tz_offset = tz;
    }
    // ROUND 5: "last seen" for the admin dashboard's active-user counts — written at most every 10 minutes
    if (!user.last_seen_at || Date.now() - new Date(user.last_seen_at).getTime() > 10 * 60e3) {
      const touch = q(c.env, 'UPDATE users SET last_seen_at = now() WHERE id = $1', [user.id]).catch(() => {});
      try { c.executionCtx.waitUntil(touch); } catch (e) { await touch; } // no executionCtx in tests / local dev
    }
    c.set('user', user);
    await next();
  };
}
