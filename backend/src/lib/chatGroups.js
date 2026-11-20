// CHAT 7.3 / 7.4 — group roles, permissions, system messages, presence and receipts.
// Used by routes/conversations.js (send / list / thread) and routes/chatGroups.js (Group Info, invites, media…).
import { q, one } from './db.js';
import { forbidden, notFound } from './http.js';
import { notifyUser } from '../hub.js';
import { loadMessage } from './messages.js';

// owner > admin > moderator > member
export const RANK = { member: 0, moderator: 1, admin: 2, owner: 3 };
export const ROLES = ['member', 'moderator', 'admin'];

export const DEFAULT_SETTINGS = { sendMessages: 'all', addMembers: 'admins', editInfo: 'admins', approveJoins: false, slowModeSec: 0 };
export const SLOW_MODE_STEPS = [0, 10, 30, 60, 300, 900, 3600];

const parse = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);

export function settingsOf(conv) {
  const s = { ...DEFAULT_SETTINGS, ...(parse(conv && conv.settings) || {}) };
  return {
    sendMessages: s.sendMessages === 'admins' ? 'admins' : 'all',
    addMembers: s.addMembers === 'all' ? 'all' : 'admins',
    editInfo: s.editInfo === 'all' ? 'all' : 'admins',
    approveJoins: !!s.approveJoins,
    slowModeSec: SLOW_MODE_STEPS.includes(Number(s.slowModeSec)) ? Number(s.slowModeSec) : 0,
  };
}

// The conversation + the caller's membership. Throws 404 when the conversation doesn't exist, 403 when not a member.
export async function groupContext(env, convId, userId, { allowNonMember = false } = {}) {
  const row = await one(env,
    `SELECT c.*, m.role AS my_role, m.muted AS my_muted, m.joined_at AS my_joined_at
       FROM conversations c
       LEFT JOIN conversation_members m ON m.conversation_id = c.id AND m.user_id = $2
      WHERE c.id = $1`, [convId, userId]);
  if (!row) throw notFound('Conversation not found');
  if (!row.my_role && !allowNonMember) throw forbidden('Not a member of this conversation');
  return { conv: row, role: row.my_role || null, rank: row.my_role ? RANK[row.my_role] ?? 0 : -1, settings: settingsOf(row) };
}

// What the caller may do in a group. (DMs: nothing here applies; channels: admins post, owner/admins manage.)
export function permissionsFor(ctx) {
  const { rank, settings, conv } = ctx;
  const isAdmin = rank >= RANK.admin;
  const isMod = rank >= RANK.moderator;
  const isGroup = conv.kind === 'group';
  return {
    isAdmin,
    isModerator: isMod,
    isOwner: rank === RANK.owner,
    canSend: rank >= 0 && (conv.kind === 'channel' ? isAdmin : !isGroup || settings.sendMessages === 'all' || isMod),
    canAddMembers: isGroup && rank >= 0 && (isAdmin || settings.addMembers === 'all'),
    canEditInfo: conv.kind !== 'dm' && rank >= 0 && (isAdmin || (isGroup && settings.editInfo === 'all')),
    canChangeSettings: conv.kind !== 'dm' && isAdmin,
    canInvite: isGroup && rank >= 0 && (isAdmin || settings.addMembers === 'all'),
    canApproveJoins: isGroup && isMod,
    canRemoveMembers: isGroup && isAdmin,
    canPromote: isGroup && isAdmin,
    canPin: conv.kind === 'dm' || isMod,
    canDeleteOthers: conv.kind !== 'dm' && isMod,
  };
}

// Actor may act on target only when they outrank them (owner can act on everyone but themselves).
export const outranks = (actorRole, targetRole) => (RANK[actorRole] ?? -1) > (RANK[targetRole] ?? -1);

/**
 * A system line in the chat ("Grace added Daniel", "Paul left"). Not counted as unread, no push.
 * `meta.system` = { action, actorId, targetIds?, ... }. Members' devices get message.new as usual.
 */
export async function systemMessage(env, convId, actorId, text, system = {}) {
  const row = await one(env,
    `WITH ins AS (
       INSERT INTO messages (conversation_id, sender_id, kind, body, meta)
       VALUES ($1, $2, 'system', $3, $4::jsonb) RETURNING id
     ), up AS (UPDATE conversations SET last_message_at = now() WHERE id = $1)
     SELECT id FROM ins`,
    [convId, actorId, String(text).slice(0, 500), JSON.stringify({ system: { ...system, actorId } })]);
  const msg = await loadMessage(env, row.id, actorId);
  const members = await q(env, 'SELECT user_id FROM conversation_members WHERE conversation_id = $1', [convId]);
  await Promise.all(members.map((m) => notifyUser(env, m.user_id, {
    type: 'message.new', conversationId: convId, message: { ...msg, isMe: m.user_id === actorId },
  }).catch(() => {})));
  return msg;
}

export async function displayName(env, userId) {
  const u = await one(env, 'SELECT display_name FROM users WHERE id = $1', [userId]);
  return (u && u.display_name) || 'Someone';
}

// ---------- presence ----------
export const ONLINE_MS = 70 * 1000;

// Cheap heartbeat: at most one write every 20 s per user.
export async function touchPresence(env, userId) {
  await q(env, `UPDATE users SET presence_at = now() WHERE id = $1 AND (presence_at IS NULL OR presence_at < now() - interval '20 seconds')`, [userId]).catch(() => {});
}

// WhatsApp rule: if you hide your last seen you can't see other people's either.
export function presenceShape(u, viewerVisibility = 'everyone') {
  if (!u) return null;
  const hidden = u.last_seen_visibility === 'nobody' || viewerVisibility === 'nobody';
  if (hidden) return { online: false, lastSeenAt: null, hidden: true };
  const at = u.presence_at ? new Date(u.presence_at).getTime() : null;
  return { online: !!at && Date.now() - at < ONLINE_MS, lastSeenAt: at ? new Date(at).toISOString() : null, hidden: false };
}

// ---------- receipts ----------
// For the caller's own messages: everyone else has read / received up to these times (oldest member wins, like WhatsApp).
export async function receiptsFor(env, convId, meId) {
  const r = await one(env,
    `SELECT MIN(last_read_at) AS read_at, MIN(COALESCE(last_delivered_at, last_read_at)) AS delivered_at, COUNT(*)::int AS n
       FROM conversation_members WHERE conversation_id = $1 AND user_id <> $2`, [convId, meId]);
  if (!r || !r.n) return { readAt: null, deliveredAt: null };
  const readAt = r.read_at ? new Date(r.read_at).toISOString() : null;
  let deliveredAt = r.delivered_at ? new Date(r.delivered_at).toISOString() : null;
  if (readAt && (!deliveredAt || deliveredAt < readAt)) deliveredAt = readAt;
  return { readAt, deliveredAt };
}

// Mark everything up to now as delivered to this user; tell senders' devices so ticks turn grey→double.
export async function markDelivered(env, userId, convId = null) {
  const rows = await q(env,
    `UPDATE conversation_members m SET last_delivered_at = now()
      WHERE m.user_id = $1 ${convId ? 'AND m.conversation_id = $2' : ''}
        AND EXISTS (SELECT 1 FROM conversations c WHERE c.id = m.conversation_id
                     AND c.last_message_at > COALESCE(m.last_delivered_at, m.last_read_at))
      RETURNING m.conversation_id`, convId ? [userId, convId] : [userId]);
  for (const r of rows) {
    const others = await q(env, 'SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND user_id <> $2', [r.conversation_id, userId]);
    await Promise.all(others.map((o) => notifyUser(env, o.user_id, { type: 'message.delivered', conversationId: r.conversation_id, userId }).catch(() => {})));
  }
}

// Members currently typing (polling fallback for the realtime 'typing' event)
export async function typingIn(env, convId, meId) {
  const rows = await q(env,
    `SELECT u.id, u.display_name FROM conversation_members m JOIN users u ON u.id = m.user_id
      WHERE m.conversation_id = $1 AND m.user_id <> $2 AND m.typing_at > now() - interval '6 seconds'`, [convId, meId]);
  return rows.map((r) => ({ id: r.id, name: r.display_name }));
}

// ---------- media listing ----------
export const DOC_EXT = ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt', 'ppt', 'pptx', 'xls', 'xlsx', 'csv', 'epub', 'md'];
export const URL_RE = /https?:\/\/[^\s<>"')]+/gi;
export const extOf = (name = '') => (String(name).match(/\.([a-z0-9]{1,8})$/i) || [])[1]?.toLowerCase() || '';
export function fileCategory(meta = {}) {
  const mime = String(meta.mime || '').toLowerCase();
  const ext = extOf(meta.name);
  if (mime === 'application/pdf' || DOC_EXT.includes(ext) || /msword|officedocument|opendocument|text\//.test(mime)) return 'docs';
  return 'files';
}

// "Grace added Daniel", "Grace added Daniel, Ruth and 3 others"
export function namesList(names) {
  if (names.length <= 1) return names[0] || '';
  if (names.length <= 3) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} others`;
}

/**
 * Add people to a group (blocked pairs and banned users are skipped). Writes the "X added Y" system line,
 * tells the new members' devices and sends them a push. → [{ id, name }] actually added.
 */
export async function addMembersTo(c, convId, actor, ids, { via = 'added', sendPush } = {}) {
  if (!ids.length) return [];
  const rows = await q(c.env, `INSERT INTO conversation_members (conversation_id, user_id, role, added_by)
      SELECT $1, u.id, 'member', $3 FROM users u WHERE u.id = ANY($2::uuid[]) AND NOT u.banned
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = u.id AND b.blocked_id = $3) OR (b.blocker_id = $3 AND b.blocked_id = u.id))
      ON CONFLICT DO NOTHING RETURNING user_id`, [convId, ids, actor.id]);
  if (!rows.length) return [];
  const users = await q(c.env, 'SELECT id, display_name FROM users WHERE id = ANY($1::uuid[])', [rows.map((r) => r.user_id)]);
  const added = users.map((u) => ({ id: u.id, name: u.display_name }));
  await q(c.env, `DELETE FROM conversation_join_requests WHERE conversation_id = $1 AND user_id = ANY($2::uuid[])`, [convId, added.map((a) => a.id)]);
  const conv = await one(c.env, 'SELECT title FROM conversations WHERE id = $1', [convId]);
  const text = via === 'link' ? `${added[0].name} joined using the invite link`
    : via === 'approved' ? `${actor.display_name} approved ${namesList(added.map((a) => a.name))}`
      : `${actor.display_name} added ${namesList(added.map((a) => a.name))}`;
  await systemMessage(c.env, convId, actor.id, text, { action: via === 'link' ? 'joined' : 'added', targetIds: added.map((a) => a.id) });
  for (const a of added) {
    await notifyUser(c.env, a.id, { type: 'conversation.new', conversationId: convId }).catch(() => {});
    if (sendPush && via !== 'link') {
      await sendPush({ userId: a.id, kind: 'group', title: conv.title || 'New group', body: `${actor.display_name} added you`, data: { conversationId: convId, threadId: `chat:${convId}` } });
    }
  }
  return added;
}
