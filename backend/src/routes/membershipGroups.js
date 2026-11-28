// MEMBERSHIP GROUPS — MASTER CLASS + EXECUTIVE CLASS: joining, the welcome pop-up and the owner's / admins' screens.
// Mounted into membershipsApp (routes/memberships.js) before /memberships/:ref. Rules live in lib/membershipGroups.js.
//
//   GET    /memberships/welcome                       → { pending: { membershipId, title, text, coverUrl } | null } (app open)
//   POST   /memberships/:id/welcome/seen              → marks the pop-up seen (server side, so once across devices)
//   POST   /memberships/:id/join                      free groups: join now (201) or ask to join (202, approval groups)
//   POST   /memberships/:id/join-request              approval groups: ask to join (paid groups then check out once approved)
//   GET    /memberships/:id/group                     group overview: sections, my role & permissions, settings, counts
//   PATCH  /memberships/:id/group                     { title, description, avatarKey, settings{}, welcomeMessage } (manage settings)
//   GET    /memberships/:id/group/notifications       · PUT { master: bool, executive: 'all'|'mentions'|'off' } (any member)
//   GET    /memberships/:id/group/members             ?q=&filter=all|admins|muted|banned&limit=&cursor= → { items, nextCursor }
//   POST   /memberships/:id/group/members/:userId     { action: remove|ban|unban|mute|unmute|suspend|unsuspend, minutes } (manage members)
//   GET    /memberships/:id/group/admins              admins + permissions
//   POST   /memberships/:id/group/admins              { userId | handle, permissions } (owner, or manage-members admins: only permissions they hold)
//   PATCH  /memberships/:id/group/admins/:userId      { permissions } (owner / platform admins)
//   DELETE /memberships/:id/group/admins/:userId      (owner / platform admins) — the owner can never be removed or demoted
//   GET    /memberships/:id/group/requests            · POST /memberships/:id/group/requests/:userId { approve } (manage members)
//   POST   /memberships/:id/group/invite              { reset } → { code, url } (invite permission, or members when allowed)
// The group's Media screen uses GET /conversations/:id/media for both sections (no route here).
import { q, one } from '../lib/db.js';
import { bad, body, forbidden, int, isUuid, notFound, str, uuidParam } from '../lib/http.js';
import { userJson, mediaUrl } from '../lib/shape.js';
import { notifyUser } from '../hub.js';
import { sendNotification } from '../lib/push.js';
import { systemMessage } from '../lib/chatGroups.js';
import {
  accessShape, addToConversations, assertMayJoin, cardShape, endSubscription, freePlanOf, hasAccess, isBanned,
  joinFree, joinRequestOf, removeFromConversations, requestToJoin, subscriptionOf,
} from '../lib/memberships.js';
import {
  MASTER, EXECUTIVE, PERMISSIONS, PERMISSION_LABELS, DEFAULT_ADMIN_PERMISSIONS, DEFAULT_WELCOME, actorIn, can, cleanPermissions,
  executiveTitle, groupSettingsOf, masterTitle, mergeGroupSettings, mutedUntilOf, notifyShape, prefsOf, requirePerm, welcomeText,
} from '../lib/membershipGroups.js';
import { groupInviteUrl } from './chatGaps.js';

const parse = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);
const MAX_MUTE_MIN = 30 * 24 * 60;
// A suspension is an indefinite mute: muted_until far in the future, plus membership_member_prefs.suspended (see schema.sql)
const SUSPENDED_UNTIL = new Date('9999-12-31T23:59:59.000Z');

// Paging helpers: ?limit= (default 100, max 200); ?cursor= is opaque (URL-encoded JSON array of the last row's sort keys).
const pageLimit = (c) => Math.min(200, Math.max(1, parseInt(c.req.query('limit') || '100', 10) || 100));
const writeCursor = (keys) => JSON.stringify(keys); // the client sends it back URL-encoded as ?cursor=
const suspendedNow = async (env, membershipId, userId) => !!(await one(env,
  'SELECT 1 AS ok FROM membership_member_prefs WHERE membership_id = $1 AND user_id = $2 AND suspended AND muted_until > now()', [membershipId, userId]));
function readCursor(raw, n) {
  if (!raw) return null;
  try {
    const v = JSON.parse(String(raw));
    if (!Array.isArray(v) || v.length !== n || v.some((x) => x === null || x === undefined)) throw new Error('shape');
    return v;
  } catch (e) {
    throw bad('That page link has expired — start again from the first page', 'BAD_CURSOR');
  }
}

export function mountGroupRoutes(app, { visibleMembership, requireAccess, origin }) {
  /** The group + my place in it. Needs access (member, owner, admin or platform admin). */
  async function groupCtx(c) {
    const me = c.get('user');
    const m = await visibleMembership(c, uuidParam(c));
    if (!m.channel_id || !m.community_id) throw bad('This group opens when it is published', 'NOT_PUBLISHED');
    const actor = await actorIn(c.env, m, me);
    if (!actor.staff) await requireAccess(c, m);
    return { me, m, actor, settings: groupSettingsOf(m) };
  }
  const ownerOnly = (actor) => {
    if (actor.role !== 'owner' && !actor.platformAdmin) throw forbidden('Only the group owner can manage admins', 'OWNER_ONLY');
  };
  const protectOwner = (m, targetId) => {
    if (m.owner_id && m.owner_id === targetId) throw forbidden('The group owner can’t be removed, banned, muted or demoted', 'OWNER_PROTECTED');
  };
  async function targetUser(env, b) {
    if (b.userId && isUuid(b.userId)) return one(env, 'SELECT * FROM users WHERE id = $1', [b.userId]);
    const h = String(b.handle || '').trim().replace(/^@/, '').toLowerCase();
    if (!h) return null;
    return one(env, 'SELECT * FROM users WHERE lower(handle) = $1 OR clerk_id = $2 ORDER BY created_at LIMIT 1', [h, `dev_${h}`]);
  }
  const avatarOf = async (c, m) => {
    const r = await one(c.env, 'SELECT avatar_key FROM conversations WHERE id = $1', [m.community_id]);
    return r && r.avatar_key ? mediaUrl(c.env, origin(c), r.avatar_key) : null;
  };

  // ---------- welcome pop-up ----------
  app.get('/memberships/welcome', async (c) => {
    const me = c.get('user');
    const rows = await q(c.env, `SELECT m.* FROM membership_member_prefs p JOIN memberships m ON m.id = p.membership_id
      JOIN membership_subscriptions s ON s.membership_id = m.id AND s.user_id = p.user_id
      WHERE p.user_id = $1 AND p.welcome_seen_at IS NULL AND m.status = 'published'
        AND s.status IN ('active','trialing','cancelled') AND (s.expires_at IS NULL OR s.expires_at > now())
      ORDER BY p.joined_at DESC LIMIT 1`, [me.id]);
    const m = rows[0];
    if (!m) return c.json({ pending: null });
    return c.json({ pending: { membershipId: m.id, title: m.title, text: welcomeText(m), coverUrl: cardShape(c.env, origin(c), m).coverUrl } });
  });

  app.post('/memberships/:id/welcome/seen', async (c) => {
    const me = c.get('user');
    const id = uuidParam(c);
    const r = await one(c.env, `UPDATE membership_member_prefs SET welcome_seen_at = now() WHERE membership_id = $1 AND user_id = $2 AND welcome_seen_at IS NULL RETURNING 1 AS ok`, [id, me.id]);
    return c.json({ ok: true, firstTime: !!r });
  });

  // ---------- joining ----------
  app.post('/memberships/:id/join', async (c) => {
    const me = c.get('user');
    const m = await visibleMembership(c, uuidParam(c));
    if (m.status !== 'published') throw bad('This group isn’t open to new members', 'NOT_AVAILABLE');
    const plan = await freePlanOf(c.env, m);
    if (!plan) throw bad('This group has a paid membership — choose a plan to join', 'NOT_FREE');
    const out = { membershipId: m.id, channelId: m.channel_id, communityId: m.community_id };
    if (hasAccess(await subscriptionOf(c.env, m.id, me.id))) return c.json({ status: 'member', ...out });
    try {
      await assertMayJoin(c.env, m, me);
    } catch (e) {
      if (e.code !== 'APPROVAL_REQUIRED') throw e;
      const status = await requestToJoin(c, m, me);
      return c.json({ status: status === 'approved' ? 'approved' : 'requested', ...out }, 202);
    }
    const sub = await joinFree(c.env, m, plan, me.id);
    return c.json({ status: 'member', access: accessShape(sub), ...out }, 201);
  });

  app.post('/memberships/:id/join-request', async (c) => {
    const me = c.get('user');
    const m = await visibleMembership(c, uuidParam(c));
    if (m.status !== 'published') throw bad('This group isn’t open to new members', 'NOT_AVAILABLE');
    if (hasAccess(await subscriptionOf(c.env, m.id, me.id))) return c.json({ status: 'member' });
    const status = await requestToJoin(c, m, me);
    return c.json({ status }, status === 'approved' ? 200 : 202);
  });

  // ---------- overview & settings ----------
  async function overview(c, { me, m, actor, settings }) {
    const env = c.env;
    const [members, admins, pending, banned, prefs] = await Promise.all([
      one(env, `SELECT count(*)::int AS n FROM conversation_members WHERE conversation_id = $1`, [m.community_id]),
      one(env, 'SELECT count(*)::int AS n FROM membership_admins WHERE membership_id = $1', [m.id]),
      can(actor, 'manageMembers', settings) ? one(env, `SELECT count(*)::int AS n FROM conversation_join_requests WHERE conversation_id = $1 AND status = 'pending'`, [m.community_id]) : null,
      can(actor, 'manageMembers', settings) ? one(env, 'SELECT count(*)::int AS n FROM conversation_bans WHERE conversation_id = $1', [m.community_id]) : null,
      prefsOf(env, m.id, me.id),
    ]);
    const canSettings = can(actor, 'manageSettings', settings);
    return {
      id: m.id,
      slug: m.slug,
      title: m.title,
      description: m.description || '',
      headline: m.headline || '',
      coverUrl: cardShape(env, origin(c), m).coverUrl,
      avatarUrl: await avatarOf(c, m),
      sections: {
        master: { id: m.channel_id, name: MASTER, title: masterTitle(m.title) },
        executive: { id: m.community_id, name: EXECUTIVE, title: executiveTitle(m.title) },
      },
      me: {
        role: actor.role,
        permissions: Object.fromEntries(PERMISSIONS.map((p) => [p, can(actor, p, settings)])),
        notifications: notifyShape(prefs),
        mutedUntil: mutedUntilOf(prefs),
        suspended: !!(prefs && prefs.suspended && mutedUntilOf(prefs)),
      },
      permissionLabels: PERMISSION_LABELS,
      settings,
      free: !!(await freePlanOf(env, m)),
      welcomeMessage: canSettings ? (m.welcome_message || '') : undefined,
      defaultWelcome: canSettings ? DEFAULT_WELCOME : undefined,
      welcomePreview: canSettings ? welcomeText(m) : undefined,
      counts: { members: members.n, admins: admins.n, pendingRequests: pending ? pending.n : 0, banned: banned ? banned.n : 0 },
    };
  }

  app.get('/memberships/:id/group', async (c) => c.json(await overview(c, await groupCtx(c))));

  app.patch('/memberships/:id/group', async (c) => {
    const ctx = await groupCtx(c);
    const { me, m, actor } = ctx;
    requirePerm(actor, 'manageSettings', ctx.settings);
    const b = await body(c);
    const env = c.env;
    const said = [];
    let title = m.title;
    if (b.title !== undefined) {
      title = str(b.title, { min: 1, max: 120, field: 'Group name' }).trim();
      if (title !== m.title) said.push(`renamed the group to “${title}”`);
    }
    const description = b.description !== undefined ? str(b.description || '', { max: 6000, field: 'Description' }) : m.description;
    let welcome = m.welcome_message;
    if (b.welcomeMessage !== undefined) {
      const w = str(b.welcomeMessage || '', { max: 2000, field: 'Welcome message' }).trim();
      welcome = w && w !== DEFAULT_WELCOME ? w : null;
    }
    const settings = b.settings !== undefined ? mergeGroupSettings(ctx.settings, b.settings) : ctx.settings;
    if (settings.memberMessaging !== ctx.settings.memberMessaging) said.push(settings.memberMessaging === 'admins' ? `allowed only admins to send messages in ${EXECUTIVE}` : `allowed all members to send messages in ${EXECUTIVE}`);
    if (settings.mediaUploads !== ctx.settings.mediaUploads) said.push(settings.mediaUploads === 'admins' ? `allowed only admins to share media in ${EXECUTIVE}` : `allowed all members to share media in ${EXECUTIVE}`);
    await q(env, `UPDATE memberships SET title = $2, description = $3, welcome_message = $4, group_settings = $5::jsonb, updated_at = now() WHERE id = $1`,
      [m.id, title, description, welcome, JSON.stringify(settings)]);
    // keep the two sections in step: names, who can send in EXECUTIVE CLASS, approval flag (Group Info shows it)
    if (title !== m.title) {
      await q(env, 'UPDATE conversations SET title = $2 WHERE id = $1', [m.channel_id, masterTitle(title)]);
      await q(env, 'UPDATE conversations SET title = $2 WHERE id = $1', [m.community_id, executiveTitle(title)]);
    }
    await q(env, `UPDATE conversations SET settings = settings || $2::jsonb WHERE id = $1`,
      [m.community_id, JSON.stringify({ sendMessages: settings.memberMessaging, approveJoins: settings.joinMode === 'approval' })]);
    if (b.avatarKey !== undefined) {
      const key = b.avatarKey ? str(b.avatarKey, { max: 300 }) : null;
      if (key && !(key.startsWith(`img/${me.id}/`) && /^[\w./-]+$/.test(key) && !key.includes('..'))) throw bad('Upload the photo first', 'BAD_MEDIA');
      await q(env, 'UPDATE conversations SET avatar_key = $2 WHERE id = ANY($1::uuid[])', [[m.channel_id, m.community_id], key]);
      // the group's cover (group home + catalogue card) follows the new photo; removing the photo keeps the last cover
      if (key) await q(env, 'UPDATE memberships SET cover_key = $2 WHERE id = $1', [m.id, key]);
      said.push(key ? 'changed the group photo' : 'removed the group photo');
    }
    for (const s of said) await systemMessage(env, m.community_id, me.id, `${me.display_name} ${s}`, { action: 'settings' }).catch(() => {});
    const fresh = await one(env, 'SELECT * FROM memberships WHERE id = $1', [m.id]);
    return c.json(await overview(c, { ...ctx, m: fresh, settings }));
  });

  // ---------- my notification choices ----------
  app.get('/memberships/:id/group/notifications', async (c) => {
    const { me, m } = await groupCtx(c);
    return c.json(notifyShape(await prefsOf(c.env, m.id, me.id)));
  });
  app.put('/memberships/:id/group/notifications', async (c) => {
    const { me, m } = await groupCtx(c);
    const b = await body(c);
    const cur = notifyShape(await prefsOf(c.env, m.id, me.id));
    const master = b.master === undefined ? cur.master : !!b.master;
    const executive = b.executive === undefined ? cur.executive : String(b.executive);
    if (!['all', 'mentions', 'off'].includes(executive)) throw bad('executive is all, mentions or off', 'BAD_SETTING');
    await q(c.env, `INSERT INTO membership_member_prefs (membership_id, user_id, notify_master, notify_executive, welcome_seen_at) VALUES ($1, $2, $3, $4, now())
      ON CONFLICT (membership_id, user_id) DO UPDATE SET notify_master = EXCLUDED.notify_master, notify_executive = EXCLUDED.notify_executive`, [m.id, me.id, master, executive]);
    return c.json({ master, executive });
  });

  // ---------- members ----------
  app.get('/memberships/:id/group/members', async (c) => {
    const { m, actor, settings } = await groupCtx(c);
    const env = c.env;
    const term = String(c.req.query('q') || '').trim().slice(0, 60);
    const like = '%' + term.replace(/[\\%_]/g, (ch) => '\\' + ch) + '%';
    const filter = String(c.req.query('filter') || 'all');
    const manage = can(actor, 'manageMembers', settings);
    if (filter === 'banned') {
      if (!manage) throw forbidden('You need the “Manage members” permission', 'PERMISSION_REQUIRED');
      const limit = pageLimit(c);
      const cur = readCursor(c.req.query('cursor'), 2); // [createdAt, userId]
      const rows = await q(env, `SELECT * FROM (
          SELECT b.created_at, b.user_id AS uid, ${userJson('u')} AS u FROM conversation_bans b JOIN users u ON u.id = b.user_id
          WHERE b.conversation_id = $1 AND ($2 = '' OR u.display_name ILIKE $3 OR u.handle ILIKE $3)
        ) t
        WHERE ($4::timestamptz IS NULL OR (t.created_at, t.uid::text) < ($4::timestamptz, $5::text))
        ORDER BY t.created_at DESC, t.uid DESC LIMIT ${limit + 1}`, [m.community_id, term, like, cur ? cur[0] : null, cur ? cur[1] : null]);
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return c.json({
        items: page.map((r) => ({ ...parse(r.u), role: 'banned', banned: true, bannedAt: new Date(r.created_at).toISOString() })),
        nextCursor: rows.length > limit && last ? writeCursor([new Date(last.created_at).toISOString(), last.uid]) : null,
      });
    }
    // paging: ?limit= (default 100, max 200) and ?cursor= from the previous page's nextCursor (keyset on rank, name, id)
    const limit = pageLimit(c);
    const cur = readCursor(c.req.query('cursor'), 3);
    const rows = await q(env, `SELECT * FROM (
        SELECT (CASE WHEN cm.user_id = $6 THEN 0 WHEN cm.role = 'admin' THEN 1 ELSE 2 END)::int AS rank, u.display_name AS dn, cm.user_id AS uid,
          cm.role, cm.joined_at, p.joined_at AS first_joined_at, p.muted_until, p.suspended, a.permissions,
          s.status AS sub_status, s.expires_at, s.source, ${userJson('u')} AS u
        FROM conversation_members cm JOIN users u ON u.id = cm.user_id
        LEFT JOIN membership_member_prefs p ON p.membership_id = $2 AND p.user_id = cm.user_id
        LEFT JOIN membership_admins a ON a.membership_id = $2 AND a.user_id = cm.user_id
        LEFT JOIN membership_subscriptions s ON s.membership_id = $2 AND s.user_id = cm.user_id
        WHERE cm.conversation_id = $1 AND ($3 = '' OR u.display_name ILIKE $4 OR u.handle ILIKE $4)
          AND ($5 <> 'admins' OR cm.role IN ('owner','admin'))
          AND ($5 <> 'muted' OR p.muted_until > now())
      ) t
      WHERE ($7::int IS NULL OR (t.rank, t.dn, t.uid::text) > ($7::int, $8::text, $9::text))
      ORDER BY t.rank, t.dn, t.uid LIMIT ${limit + 1}`,
    [m.community_id, m.id, term, like, filter, m.owner_id, cur ? cur[0] : null, cur ? cur[1] : null, cur ? cur[2] : null]);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return c.json({
      items: page.map((r) => {
        const u = parse(r.u);
        const role = u.id === m.owner_id ? 'owner' : ['owner', 'admin'].includes(r.role) ? 'admin' : 'member';
        return {
          ...u,
          role,
          joinedAt: new Date(r.first_joined_at || r.joined_at).toISOString(),
          mutedUntil: mutedUntilOf(r),
          suspended: !!(r.suspended && mutedUntilOf(r)),
          permissions: role === 'admin' && r.permissions ? cleanPermissions(parse(r.permissions), {}) : undefined,
          // subscription details only for people who manage members
          membership: manage && r.sub_status ? { status: r.sub_status, expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null, source: r.source } : undefined,
        };
      }),
      nextCursor: rows.length > limit && last ? writeCursor([last.rank, last.dn, last.uid]) : null,
    });
  });

  app.post('/memberships/:id/group/members/:userId', async (c) => {
    const { me, m, actor, settings } = await groupCtx(c);
    const env = c.env;
    const targetId = uuidParam(c, 'userId');
    requirePerm(actor, 'manageMembers', settings);
    protectOwner(m, targetId);
    if (targetId === me.id) throw bad('You can’t do that to yourself', 'SELF');
    const b = await body(c);
    const action = String(b.action || '');
    const target = await one(env, 'SELECT id, display_name FROM users WHERE id = $1', [targetId]);
    if (!target) throw notFound('User not found');
    const isAdmin = !!(await one(env, 'SELECT 1 FROM membership_admins WHERE membership_id = $1 AND user_id = $2', [m.id, targetId]))
      || !!(await one(env, `SELECT 1 FROM conversation_members WHERE conversation_id = ANY($1::uuid[]) AND user_id = $2 AND role IN ('owner','admin')`, [[m.channel_id, m.community_id], targetId]));
    if (isAdmin && actor.role !== 'owner' && !actor.platformAdmin) throw forbidden('Only the group owner can act on another admin', 'OWNER_ONLY');
    const convs = [m.channel_id, m.community_id];
    if (action === 'mute') {
      const minutes = int(b.minutes ?? 60, { min: 1, max: MAX_MUTE_MIN, field: 'minutes' });
      if (await suspendedNow(env, m.id, targetId)) throw bad('This member is suspended — lift the suspension first', 'SUSPENDED');
      const until = new Date(Date.now() + minutes * 60e3);
      await q(env, `INSERT INTO membership_member_prefs (membership_id, user_id, muted_until, muted_by) VALUES ($1, $2, $3, $4)
        ON CONFLICT (membership_id, user_id) DO UPDATE SET muted_until = EXCLUDED.muted_until, muted_by = EXCLUDED.muted_by`, [m.id, targetId, until, me.id]);
      await notifyUser(env, targetId, { type: 'group.muted', membershipId: m.id, conversationId: m.community_id, mutedUntil: until.toISOString() }).catch(() => {});
      return c.json({ ok: true, action, mutedUntil: until.toISOString() });
    }
    if (action === 'unmute') {
      // also lifts a suspension: only admins with "manage members" reach this
      await q(env, 'UPDATE membership_member_prefs SET muted_until = NULL, muted_by = NULL, suspended = false WHERE membership_id = $1 AND user_id = $2', [m.id, targetId]);
      return c.json({ ok: true, action, mutedUntil: null, suspended: false });
    }
    if (action === 'suspend') {
      // an indefinite mute: they can still read; posting in EXECUTIVE CLASS and gifts are blocked until an admin lifts it
      await q(env, `INSERT INTO membership_member_prefs (membership_id, user_id, muted_until, muted_by, suspended) VALUES ($1, $2, $3, $4, true)
        ON CONFLICT (membership_id, user_id) DO UPDATE SET muted_until = EXCLUDED.muted_until, muted_by = EXCLUDED.muted_by, suspended = true`, [m.id, targetId, SUSPENDED_UNTIL, me.id]);
      await notifyUser(env, targetId, { type: 'group.muted', membershipId: m.id, conversationId: m.community_id, mutedUntil: SUSPENDED_UNTIL.toISOString(), suspended: true }).catch(() => {});
      await systemMessage(env, m.community_id, me.id, `${me.display_name} suspended ${target.display_name} from ${EXECUTIVE}`, { action: 'suspended', targetIds: [targetId] }).catch(() => {});
      return c.json({ ok: true, action, suspended: true, mutedUntil: SUSPENDED_UNTIL.toISOString() });
    }
    if (action === 'unsuspend') {
      await q(env, 'UPDATE membership_member_prefs SET muted_until = NULL, muted_by = NULL, suspended = false WHERE membership_id = $1 AND user_id = $2', [m.id, targetId]);
      await systemMessage(env, m.community_id, me.id, `${me.display_name} lifted the suspension of ${target.display_name}`, { action: 'unsuspended', targetIds: [targetId] }).catch(() => {});
      return c.json({ ok: true, action, suspended: false, mutedUntil: null });
    }
    if (action === 'ban') {
      await q(env, 'DELETE FROM membership_admins WHERE membership_id = $1 AND user_id = $2', [m.id, targetId]);
      for (const conv of convs) {
        await q(env, `INSERT INTO conversation_bans (conversation_id, user_id, banned_by) VALUES ($1, $2, $3)
          ON CONFLICT (conversation_id, user_id) DO UPDATE SET banned_by = EXCLUDED.banned_by, created_at = now()`, [conv, targetId, me.id]);
      }
      await q(env, 'DELETE FROM conversation_members WHERE conversation_id = ANY($1::uuid[]) AND user_id = $2', [convs, targetId]);
      await q(env, 'DELETE FROM conversation_join_requests WHERE conversation_id = $1 AND user_id = $2', [m.community_id, targetId]);
      for (const conv of convs) await notifyUser(env, targetId, { type: 'conversation.removed', conversationId: conv }).catch(() => {});
      await systemMessage(env, m.community_id, me.id, `${me.display_name} removed ${target.display_name}`, { action: 'removed', targetIds: [targetId], banned: true }).catch(() => {});
      return c.json({ ok: true, action });
    }
    if (action === 'unban') {
      await q(env, 'DELETE FROM conversation_bans WHERE conversation_id = ANY($1::uuid[]) AND user_id = $2', [convs, targetId]);
      if (hasAccess(await subscriptionOf(env, m.id, targetId))) await addToConversations(env, m, targetId, { quiet: true });
      return c.json({ ok: true, action });
    }
    if (action === 'remove') {
      // ends their membership here (paid time is not refunded by this — platform admins handle refunds); they may join again
      await q(env, 'DELETE FROM membership_admins WHERE membership_id = $1 AND user_id = $2', [m.id, targetId]);
      const sub = await subscriptionOf(env, m.id, targetId);
      if (sub && hasAccess(sub)) await endSubscription(env, m, targetId, 'expired');
      await q(env, 'DELETE FROM conversation_members WHERE conversation_id = ANY($1::uuid[]) AND user_id = $2', [convs, targetId]);
      for (const conv of convs) await notifyUser(env, targetId, { type: 'conversation.removed', conversationId: conv }).catch(() => {});
      await systemMessage(env, m.community_id, me.id, `${me.display_name} removed ${target.display_name}`, { action: 'removed', targetIds: [targetId] }).catch(() => {});
      return c.json({ ok: true, action });
    }
    throw bad('action is remove, ban, unban, mute, unmute, suspend or unsuspend', 'BAD_ACTION');
  });

  // ---------- admins & permissions (owner) ----------
  app.get('/memberships/:id/group/admins', async (c) => {
    const { m } = await groupCtx(c);
    const owner = m.owner_id ? await one(c.env, `SELECT ${userJson('u')} AS u FROM users u WHERE u.id = $1`, [m.owner_id]) : null;
    const rows = await q(c.env, `SELECT a.permissions, a.created_at, ${userJson('u')} AS u FROM membership_admins a JOIN users u ON u.id = a.user_id
      WHERE a.membership_id = $1 ORDER BY a.created_at`, [m.id]);
    return c.json({
      owner: owner ? { ...parse(owner.u), role: 'owner' } : null,
      items: rows.map((r) => ({ ...parse(r.u), role: 'admin', permissions: cleanPermissions(parse(r.permissions), {}), since: new Date(r.created_at).toISOString() })),
      permissions: PERMISSIONS.map((p) => ({ id: p, label: PERMISSION_LABELS[p] })),
    });
  });

  async function setAdminRole(env, m, userId, admin) {
    for (const conv of [m.channel_id, m.community_id]) {
      if (admin) {
        await q(env, `INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1, $2, 'admin')
          ON CONFLICT (conversation_id, user_id) DO UPDATE SET role = CASE WHEN conversation_members.role = 'owner' THEN 'owner' ELSE 'admin' END`, [conv, userId]);
      } else {
        await q(env, `UPDATE conversation_members SET role = 'member' WHERE conversation_id = $1 AND user_id = $2 AND role = 'admin'`, [conv, userId]);
      }
    }
    if (!admin && !hasAccess(await subscriptionOf(env, m.id, userId))) await removeFromConversations(env, m, userId);
  }

  // Promote: the owner, or an admin with "manage members", can make someone an admin — but only with permissions the
  // promoter holds themselves. Only the owner changes an existing admin's permissions (PATCH below).
  app.post('/memberships/:id/group/admins', async (c) => {
    const { me, m, actor, settings } = await groupCtx(c);
    const ownerLike = actor.role === 'owner' || !!actor.platformAdmin;
    if (!ownerLike) requirePerm(actor, 'manageMembers', settings);
    const b = await body(c);
    const u = await targetUser(c.env, b);
    if (!u) throw bad('User not found — search by name or @handle', 'USER_NOT_FOUND');
    protectOwner(m, u.id);
    if (await isBanned(c.env, m, u.id)) throw bad('Unban this person first', 'BANNED');
    if (!ownerLike) {
      const alreadyAdmin = await one(c.env, `SELECT 1 FROM membership_admins WHERE membership_id = $1 AND user_id = $2
        UNION ALL SELECT 1 FROM conversation_members WHERE conversation_id = ANY($3::uuid[]) AND user_id = $2 AND role IN ('owner','admin')`,
      [m.id, u.id, [m.channel_id, m.community_id]]);
      if (alreadyAdmin) throw forbidden('Only the group owner can change an admin’s permissions', 'OWNER_ONLY');
    }
    const base = ownerLike ? DEFAULT_ADMIN_PERMISSIONS : Object.fromEntries(PERMISSIONS.map((p) => [p, !!DEFAULT_ADMIN_PERMISSIONS[p] && !!actor.perms[p]]));
    const perms = cleanPermissions(b.permissions, base);
    if (!ownerLike) {
      const notHeld = PERMISSIONS.find((p) => perms[p] && !actor.perms[p]);
      if (notHeld) throw forbidden(`You can only give permissions you have — you don’t have “${PERMISSION_LABELS[notHeld]}”`, 'PERMISSION_NOT_HELD');
    }
    await q(c.env, `INSERT INTO membership_admins (membership_id, user_id, permissions, added_by) VALUES ($1, $2, $3::jsonb, $4)
      ON CONFLICT (membership_id, user_id) DO UPDATE SET permissions = EXCLUDED.permissions, updated_at = now()`, [m.id, u.id, JSON.stringify(perms), me.id]);
    await setAdminRole(c.env, m, u.id, true);
    await q(c.env, 'INSERT INTO membership_member_prefs (membership_id, user_id, welcome_seen_at) VALUES ($1, $2, now()) ON CONFLICT DO NOTHING', [m.id, u.id]);
    for (const conv of [m.channel_id, m.community_id]) await notifyUser(c.env, u.id, { type: 'conversation.new', conversationId: conv }).catch(() => {});
    await systemMessage(c.env, m.community_id, me.id, `${me.display_name} made ${u.display_name} an admin`, { action: 'role', targetIds: [u.id], role: 'admin' }).catch(() => {});
    await sendNotification(c, { userId: u.id, kind: 'group', title: m.title, body: `${me.display_name} made you an admin of ${m.title}`, data: { membershipId: m.id, conversationId: m.community_id } });
    return c.json({ id: u.id, displayName: u.display_name, role: 'admin', permissions: perms }, 201);
  });

  app.patch('/memberships/:id/group/admins/:userId', async (c) => {
    const { m, actor } = await groupCtx(c);
    ownerOnly(actor);
    const targetId = uuidParam(c, 'userId');
    protectOwner(m, targetId);
    const cur = await one(c.env, 'SELECT permissions FROM membership_admins WHERE membership_id = $1 AND user_id = $2', [m.id, targetId]);
    if (!cur) throw notFound('Not an admin of this group');
    const perms = cleanPermissions((await body(c)).permissions, cleanPermissions(parse(cur.permissions), {}));
    await q(c.env, 'UPDATE membership_admins SET permissions = $3::jsonb, updated_at = now() WHERE membership_id = $1 AND user_id = $2', [m.id, targetId, JSON.stringify(perms)]);
    return c.json({ id: targetId, role: 'admin', permissions: perms });
  });

  app.delete('/memberships/:id/group/admins/:userId', async (c) => {
    const { me, m, actor } = await groupCtx(c);
    const targetId = uuidParam(c, 'userId');
    protectOwner(m, targetId);
    if (targetId !== me.id) ownerOnly(actor); // an admin may step down; only the owner removes others
    const row = await one(c.env, 'DELETE FROM membership_admins WHERE membership_id = $1 AND user_id = $2 RETURNING user_id', [m.id, targetId]);
    const convAdmin = await one(c.env, `SELECT 1 FROM conversation_members WHERE conversation_id = ANY($1::uuid[]) AND user_id = $2 AND role = 'admin'`, [[m.channel_id, m.community_id], targetId]);
    if (!row && !convAdmin) throw notFound('Not an admin of this group');
    await setAdminRole(c.env, m, targetId, false);
    const u = await one(c.env, 'SELECT display_name FROM users WHERE id = $1', [targetId]);
    await systemMessage(c.env, m.community_id, me.id, targetId === me.id ? `${me.display_name} is no longer an admin` : `${me.display_name} dismissed ${(u && u.display_name) || 'someone'} as admin`, { action: 'role', targetIds: [targetId], role: 'member' }).catch(() => {});
    return c.json({ ok: true });
  });

  // ---------- join requests (approval-based groups) ----------
  app.get('/memberships/:id/group/requests', async (c) => {
    const { m, actor, settings } = await groupCtx(c);
    requirePerm(actor, 'manageMembers', settings);
    const rows = await q(c.env, `SELECT r.created_at, ${userJson('u')} AS u FROM conversation_join_requests r JOIN users u ON u.id = r.user_id
      WHERE r.conversation_id = $1 AND r.status = 'pending' ORDER BY r.created_at`, [m.community_id]);
    return c.json({ items: rows.map((r) => ({ ...parse(r.u), requestedAt: new Date(r.created_at).toISOString() })) });
  });

  app.post('/memberships/:id/group/requests/:userId', async (c) => {
    const { me, m, actor, settings } = await groupCtx(c);
    requirePerm(actor, 'manageMembers', settings);
    const userId = uuidParam(c, 'userId');
    const approve = (await body(c)).approve !== false;
    if (approve && await isBanned(c.env, m, userId)) throw forbidden('This person is banned from the group — unban them first', 'BANNED');
    const r = await one(c.env, `UPDATE conversation_join_requests SET status = $3, decided_by = $4
      WHERE conversation_id = $1 AND user_id = $2 AND status = 'pending' RETURNING user_id`, [m.community_id, userId, approve ? 'approved' : 'declined', me.id]);
    if (!r) throw notFound('No pending request');
    let joined = false;
    if (approve) {
      const plan = await freePlanOf(c.env, m);
      if (plan) { await joinFree(c.env, m, plan, userId); joined = true; }
    }
    await sendNotification(c, {
      userId, kind: 'group', title: m.title,
      body: !approve ? 'Your request to join wasn’t approved this time' : joined ? `You’re in! Open ${MASTER} to start` : 'Your request was approved — complete your membership to join',
      data: { membershipId: m.id, ...(joined ? { conversationId: m.channel_id } : {}) },
    });
    await notifyUser(c.env, userId, { type: 'conversation.new', conversationId: m.community_id }).catch(() => {});
    return c.json({ ok: true, approved: approve, joined });
  });

  // ---------- invite link ----------
  app.post('/memberships/:id/group/invite', async (c) => {
    const { me, m, actor, settings } = await groupCtx(c);
    requirePerm(actor, 'inviteMembers', settings);
    const b = await body(c).catch(() => ({}));
    if (b && b.reset) {
      if (!actor.staff) throw forbidden('Only admins can reset the invite link', 'PERMISSION_REQUIRED');
      await q(c.env, 'UPDATE conversation_invites SET revoked_at = now() WHERE conversation_id = $1 AND revoked_at IS NULL', [m.community_id]);
    }
    let inv = await one(c.env, 'SELECT code FROM conversation_invites WHERE conversation_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1', [m.community_id]);
    if (!inv) {
      const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
      const code = [...crypto.getRandomValues(new Uint8Array(12))].map((x) => a[x % a.length]).join('');
      inv = await one(c.env, 'INSERT INTO conversation_invites (code, conversation_id, created_by) VALUES ($1, $2, $3) RETURNING code', [code, m.community_id, me.id]);
    }
    const free = !!(await freePlanOf(c.env, m));
    return c.json({ code: inv.code, url: groupInviteUrl(c, inv.code), free, approveJoins: settings.joinMode === 'approval' });
  });
}

