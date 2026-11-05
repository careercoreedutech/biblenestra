// Authentication: verifies the Clerk session token (Authorization: Bearer …) and loads/creates the
// matching user row. Local development can use X-Dev-User when AUTH_DEV_MODE=true (never in production).
import { verifyToken, createClerkClient } from '@clerk/backend';
import { ApiError } from './http.js';
import { one, q } from './db.js';

async function clerkSubject(c) {
  const env = c.env;
  const h = c.req.header('Authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : null;
  if (token) {
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

export function requireUser() {
  return async (c, next) => {
    const { sub, dev, devName } = await clerkSubject(c);
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
