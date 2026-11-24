// MEMBERSHIP GROUPS — MASTER CLASS + EXECUTIVE CLASS (Telegram-style "channel + linked discussion group").
//
// Every membership group has two sections, both rows of the existing chat system and both gated by the ONE membership
// (lib/memberships.js syncAccess keeps conversation membership in step with paid / free subscriptions):
//   MASTER CLASS    = memberships.channel_id   (kind 'channel') — the owner and admins with the "publish" permission post.
//                     Members can never post there, not even through the API (membershipSendGuard below).
//   EXECUTIVE CLASS = memberships.community_id (kind 'group')   — members discuss. Every MASTER CLASS post appears here
//                     automatically as a 'shared_post' message: a lightweight reference (messages.shared_from → the
//                     original), never a copy. The original is joined at read time (lib/messages.js MSG_SELECT), so
//                     edits show at once, a delete tombstones the reference, and "comments off" on the original blocks
//                     replies to the reference.
// Admin permissions live in ONE place (membership_admins.permissions) and apply to both sections. Admins also hold the
// chat role 'admin' in both conversations so the chat's own role checks keep working. The owner (memberships.owner_id)
// has every permission and can't be removed or demoted by anyone else (owner changes go through the platform admin
// "Memberships" tab only).
// Per-member state (first join time, welcome pop-up seen, notification choices, admin mute) is membership_member_prefs.
import { q, one } from './db.js';
import { ApiError, bad, forbidden } from './http.js';
import { notifyUser } from '../hub.js';
import { loadMessage, broadcastChange } from './messages.js';
import { isPlatformAdmin } from './play.js';

export const MASTER = 'MASTER CLASS';
export const EXECUTIVE = 'EXECUTIVE CLASS';
export const masterTitle = (title) => `${title} · ${MASTER}`;
export const executiveTitle = (title) => `${title} · ${EXECUTIVE}`;
export const masterDescription = (title) => `Lessons, videos and learning materials for ${title} members`;
export const executiveDescription = (title) => `Ask questions, share ideas and discuss the lessons with other ${title} members`;

const parse = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);

// ---------- admin permissions ----------
export const PERMISSIONS = ['publish', 'deleteMessages', 'pin', 'manageMembers', 'manageSettings', 'inviteMembers'];
export const PERMISSION_LABELS = {
  publish: `Publish in ${MASTER}`,
  deleteMessages: 'Delete messages and posts',
  pin: 'Pin messages',
  manageMembers: 'Manage members (approve, ban, mute)',
  manageSettings: 'Manage group settings',
  inviteMembers: 'Invite members',
};
export const ALL_PERMISSIONS = Object.fromEntries(PERMISSIONS.map((p) => [p, true]));
/** What a new admin gets when the owner doesn't pick (everything except group settings). */
export const DEFAULT_ADMIN_PERMISSIONS = { publish: true, deleteMessages: true, pin: true, manageMembers: true, manageSettings: false, inviteMembers: true };

export function cleanPermissions(v, base = DEFAULT_ADMIN_PERMISSIONS) {
  const src = v && typeof v === 'object' ? v : {};
  return Object.fromEntries(PERMISSIONS.map((p) => [p, src[p] === undefined ? !!base[p] : !!src[p]]));
}

// ---------- group settings ----------
export const DEFAULT_GROUP_SETTINGS = {
  visibility: 'public',    // public: listed in the catalogue · private: only by link
  joinMode: 'open',        // open · approval: an admin approves before someone can join (paid groups: before checkout)
  memberMessaging: 'all',  // who can send in EXECUTIVE CLASS: all members · admins only
  mediaUploads: 'all',     // who can share photos / videos / voice / files in EXECUTIVE CLASS
  memberInvites: 'admins', // who can share the invite link: admins (with the invite permission) · all members
  history: 'all',          // new members see: all · since_join (only messages from their join time)
};
const CHOICES = {
  visibility: ['public', 'private'],
  joinMode: ['open', 'approval'],
  memberMessaging: ['all', 'admins'],
  mediaUploads: ['all', 'admins'],
  memberInvites: ['all', 'admins'],
  history: ['all', 'since_join'],
};
export function groupSettingsOf(m) {
  const s = { ...DEFAULT_GROUP_SETTINGS, ...(parse(m && m.group_settings) || {}) };
  return Object.fromEntries(Object.keys(DEFAULT_GROUP_SETTINGS).map((k) => [k, CHOICES[k].includes(s[k]) ? s[k] : DEFAULT_GROUP_SETTINGS[k]]));
}
/** Partial update → full validated settings (400 on a bad value). */
export function mergeGroupSettings(cur, patch) {
  const next = { ...cur };
  for (const k of Object.keys(DEFAULT_GROUP_SETTINGS)) {
    if (!patch || patch[k] === undefined) continue;
    if (!CHOICES[k].includes(patch[k])) throw bad(`${k} must be one of ${CHOICES[k].join(', ')}`, 'BAD_SETTING');
    next[k] = patch[k];
  }
  return next;
}

// ---------- welcome pop-up ----------
export const DEFAULT_WELCOME = '🎉 Welcome to {group}!\n\nWe are delighted to have you here. You are now part of a community dedicated to learning, growth and sharing valuable knowledge.\n\n'
  + `Visit the ${MASTER} section to access lessons, videos and learning materials.\n\n`
  + `Join the ${EXECUTIVE} to interact with other students, ask questions, share ideas and participate in discussions.\n\n`
  + 'We are excited to have you on this journey. Welcome aboard! 🚀';
export const welcomeText = (m) => String((m && m.welcome_message) || DEFAULT_WELCOME).split('{group}').join((m && m.title) || 'the group');

// ---------- which group / section a conversation belongs to ----------
/** → { m, section: 'master' | 'executive' } for a membership conversation, else null. */
export async function groupOfConversation(env, convId) {
  if (!convId) return null;
  const m = await one(env, 'SELECT m.* FROM conversations c JOIN memberships m ON m.id = c.membership_id WHERE c.id = $1', [convId]);
  if (!m) return null;
  const section = m.channel_id === convId ? 'master' : m.community_id === convId ? 'executive' : null;
  return section ? { m, section } : null;
}

/**
 * The caller's place in a group → { role: 'owner'|'admin'|'member'|'none', staff, all, perms }.
 * Owner and platform admins: every permission. Admins: their membership_admins permissions (a conversation admin with
 * no row, from before this feature, keeps every permission). Members: none of the admin permissions.
 */
export async function actorIn(env, m, user) {
  const uid = user && user.id;
  if (!uid) return { role: 'none', staff: false, all: false, perms: {} };
  if (m.owner_id && m.owner_id === uid) return { role: 'owner', staff: true, all: true, perms: { ...ALL_PERMISSIONS } };
  const conv = await one(env, `SELECT role FROM conversation_members WHERE user_id = $2 AND conversation_id = ANY($1::uuid[])
    ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'moderator' THEN 2 ELSE 3 END LIMIT 1`, [[m.channel_id, m.community_id].filter(Boolean), uid]);
  // platform admins (BibleNestra staff) can always step in; they are never the owner of someone else's group
  if (isPlatformAdmin(user)) return { role: 'admin', staff: true, all: true, perms: { ...ALL_PERMISSIONS }, platformAdmin: true };
  const row = await one(env, 'SELECT permissions FROM membership_admins WHERE membership_id = $1 AND user_id = $2', [m.id, uid]);
  if (row) return { role: 'admin', staff: true, all: false, perms: cleanPermissions(parse(row.permissions), {}) };
  if (conv && ['owner', 'admin'].includes(conv.role)) return { role: 'admin', staff: true, all: true, perms: { ...ALL_PERMISSIONS } };
  return { role: conv ? 'member' : 'none', staff: false, all: false, perms: {} };
}

/** May this actor do `perm`? (members may invite when the group lets every member share the link) */
export function can(actor, perm, settings = DEFAULT_GROUP_SETTINGS) {
  if (!actor) return false;
  if (actor.all || actor.perms[perm]) return true;
  return perm === 'inviteMembers' && actor.role === 'member' && settings.memberInvites === 'all';
}

export function requirePerm(actor, perm, settings) {
  if (!can(actor, perm, settings)) {
    throw forbidden(`You need the “${PERMISSION_LABELS[perm] || perm}” permission for this`, 'PERMISSION_REQUIRED');
  }
}

// ---------- per-member prefs ----------
/** Creates the member's prefs row on first join (joined_at = first join, never moved by renewals). */
export async function ensurePrefs(env, membershipId, userId) {
  await q(env, `INSERT INTO membership_member_prefs (membership_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [membershipId, userId]);
}
export async function prefsOf(env, membershipId, userId) {
  return one(env, 'SELECT * FROM membership_member_prefs WHERE membership_id = $1 AND user_id = $2', [membershipId, userId]);
}
export function notifyShape(p) {
  return { master: p ? p.notify_master !== false : true, executive: (p && p.notify_executive) || 'all' };
}
const mutedUntilOf = (p) => (p && p.muted_until && new Date(p.muted_until).getTime() > Date.now() ? new Date(p.muted_until).toISOString() : null);
export { mutedUntilOf };

// ---------- the chat hooks ----------
/**
 * POST /conversations/:id/messages (and forwards): the group rules on top of the chat's own checks. Throws 403 when
 * the caller may not send this here. → { m, section, actor, settings } for a membership conversation, else null.
 *   MASTER CLASS: the "publish" permission (owner always). Members never.
 *   EXECUTIVE CLASS (members): "who can send" + "media uploads" settings, an admin's time-limited mute, and no reply to
 *   a shared post whose comments are off (that one applies to everyone).
 */
export async function membershipSendGuard(env, convId, user, { kind = 'text', replyTo = null } = {}) {
  const g = await groupOfConversation(env, convId);
  if (!g) return null;
  const actor = await actorIn(env, g.m, user);
  const settings = groupSettingsOf(g.m);
  if (g.section === 'master') {
    if (!can(actor, 'publish', settings)) {
      throw forbidden(`Only the group owner and admins who can publish post in ${MASTER}. Join the discussion in ${EXECUTIVE}.`, 'MASTER_CLASS_PUBLISHERS_ONLY');
    }
  } else if (!actor.staff) {
    if (settings.memberMessaging === 'admins') throw forbidden(`Only admins can send messages in ${EXECUTIVE} right now`, 'ADMINS_ONLY_SEND');
    if (['image', 'voice', 'video', 'file'].includes(kind) && settings.mediaUploads === 'admins') {
      throw forbidden(`Only admins can share photos, videos, voice notes and files in ${EXECUTIVE}`, 'MEDIA_ADMINS_ONLY');
    }
    const until = mutedUntilOf(await prefsOf(env, g.m.id, user.id));
    if (until) {
      const e = new ApiError(403, 'MUTED', `An admin muted you in ${EXECUTIVE} until ${new Date(until).toUTCString().replace(/:\d\d GMT$/, ' GMT')}`);
      e.details = { mutedUntil: until };
      throw e;
    }
  }
  if (replyTo && g.section === 'executive' && /^[0-9a-f-]{36}$/i.test(String(replyTo))) {
    const t = await one(env, `SELECT s.meta FROM messages r JOIN messages s ON s.id = r.shared_from
      WHERE r.id = $1 AND r.conversation_id = $2 AND r.kind = 'shared_post'`, [replyTo, convId]);
    if (t && (parse(t.meta) || {}).commentsOff) throw forbidden('Comments are turned off for this post', 'COMMENTS_OFF');
  }
  return { ...g, actor, settings };
}

/**
 * Who gets a push for a new message in a group section → Map(userId → 'all' | 'mentions' | 'off'), plus the
 * notification title. MASTER CLASS: notify_master on/off. EXECUTIVE CLASS: all / mentions only / off.
 */
export async function pushPlan(env, g, userIds) {
  const rows = userIds.length ? await q(env, 'SELECT user_id, notify_master, notify_executive FROM membership_member_prefs WHERE membership_id = $1 AND user_id = ANY($2::uuid[])', [g.m.id, userIds]) : [];
  const by = new Map(rows.map((r) => [r.user_id, r]));
  const plan = new Map();
  for (const id of userIds) {
    const p = by.get(id);
    plan.set(id, g.section === 'master' ? (p && p.notify_master === false ? 'off' : 'all') : ((p && p.notify_executive) || 'all'));
  }
  return { plan, title: g.section === 'master' ? `${MASTER} · ${g.m.title}` : `${EXECUTIVE} · ${g.m.title}` };
}

/** Every MASTER CLASS post appears in EXECUTIVE CLASS as a reference (no copied body, media or meta). → shared id */
export async function shareToExecutive(env, m, source) {
  if (!m.community_id || !source || source.kind === 'system') return null;
  const row = await one(env, `WITH ins AS (
      INSERT INTO messages (conversation_id, sender_id, kind, body, shared_from) VALUES ($1, $2, 'shared_post', '', $3) RETURNING id
    ), up AS (UPDATE conversations SET last_message_at = now() WHERE id = $1)
    SELECT id FROM ins`, [m.community_id, source.sender_id, source.id]);
  const members = await q(env, 'SELECT user_id FROM conversation_members WHERE conversation_id = $1', [m.community_id]);
  const msg = await loadMessage(env, row.id, source.sender_id);
  await Promise.all(members.map((x) => notifyUser(env, x.user_id, {
    type: 'message.new', conversationId: m.community_id, message: { ...msg, isMe: x.user_id === source.sender_id },
  }).catch(() => {})));
  return row.id;
}

/** The original changed (edited / comments on-off / link card): every device showing a reference re-fetches it. */
export async function refreshShared(env, sourceId, change = 'edited') {
  const refs = await q(env, `SELECT id, conversation_id FROM messages WHERE shared_from = $1 AND NOT deleted`, [sourceId]);
  for (const r of refs) await broadcastChange(env, r.conversation_id, r.id, change).catch(() => {});
  return refs.length;
}

/** The original was deleted for everyone: its references become tombstones ("This post was deleted"). */
export async function tombstoneShared(env, sourceId, byUserId) {
  const refs = await q(env, `UPDATE messages SET deleted = true, deleted_by = $2 WHERE shared_from = $1 AND NOT deleted RETURNING id, conversation_id`, [sourceId, byUserId || null]);
  for (const r of refs) {
    await q(env, 'DELETE FROM conversation_pins WHERE message_id = $1', [r.id]);
    await broadcastChange(env, r.conversation_id, r.id, 'deleted').catch(() => {});
  }
  return refs.length;
}

/**
 * What the caller may do in a membership section — merged into GET /conversations/:id/messages `permissions`, so the
 * app's composer, long-press sheet and pin bar follow the group rules. → null for other conversations.
 */
export async function threadPermissions(env, convId, user) {
  const g = await groupOfConversation(env, convId);
  if (!g) return null;
  const actor = await actorIn(env, g.m, user);
  const settings = groupSettingsOf(g.m);
  const prefs = await prefsOf(env, g.m.id, user.id);
  const mutedUntil = g.section === 'executive' && !actor.staff ? mutedUntilOf(prefs) : null;
  const master = g.section === 'master';
  const canSend = master ? can(actor, 'publish', settings) : (actor.staff || (settings.memberMessaging === 'all' && !mutedUntil));
  return {
    group: { membershipId: g.m.id, section: g.section, title: g.m.title, sectionTitle: master ? MASTER : EXECUTIVE, role: actor.role, mutedUntil },
    permissions: {
      canSend,
      canSendMedia: canSend && (master || actor.staff || settings.mediaUploads === 'all'),
      canPin: can(actor, 'pin', settings),
      canDeleteOthers: can(actor, 'deleteMessages', settings),
      canToggleComments: master && can(actor, 'publish', settings),
      isModerator: actor.staff,
      isAdmin: actor.staff,
      isOwner: actor.role === 'owner',
      canAddMembers: false,
      canInvite: can(actor, 'inviteMembers', settings),
      canEditInfo: can(actor, 'manageSettings', settings),
      canChangeSettings: can(actor, 'manageSettings', settings),
      canApproveJoins: can(actor, 'manageMembers', settings),
      canRemoveMembers: can(actor, 'manageMembers', settings),
      canPromote: actor.role === 'owner' || !!actor.platformAdmin,
    },
  };
}
