// Shared message helpers (ROUND 4 — message actions). Used by routes/conversations.js and routes/messages.js.
import { q, one } from './db.js';
import { userJson } from './shape.js';
import { notifyUser } from '../hub.js';

export const EDIT_WINDOW_HOURS = 0.25; // CHAT 7.3: a short window like WhatsApp — 15 minutes
export const MAX_PINS = 3;
export const REACTIONS = ['🙏', '❤️', '🙌', '👍', '😂', '😢', '🔥', '🕊️'];

const parse = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);

// Enriched message select for viewer $1: sender, pinned flag, reaction counts (+ mine), reply preview.
// Messages the viewer deleted "for me" are excluded.
export const MSG_SELECT = `
  SELECT m.*, ${userJson('u')} AS sender,
    EXISTS (SELECT 1 FROM conversation_pins p WHERE p.message_id = m.id) AS pinned,
    (SELECT COALESCE(json_agg(json_build_object('emoji', r.emoji, 'count', r.cnt, 'mine', r.mine) ORDER BY r.cnt DESC, r.emoji), '[]'::json)
       FROM (SELECT emoji, COUNT(*)::int AS cnt, bool_or(user_id = $1) AS mine
               FROM message_reactions WHERE message_id = m.id GROUP BY emoji) r) AS reactions,
    (SELECT json_build_object('id', rm.id, 'senderId', rm.sender_id, 'senderName', ru.display_name,
              'kind', rm.kind, 'text', CASE WHEN rm.deleted THEN '' ELSE rm.body END, 'deleted', rm.deleted)
       FROM messages rm JOIN users ru ON ru.id = rm.sender_id WHERE rm.id = m.reply_to) AS reply
  FROM messages m
  JOIN users u ON u.id = m.sender_id
  WHERE NOT EXISTS (SELECT 1 FROM message_hides h WHERE h.message_id = m.id AND h.user_id = $1)`;

export function messageShape(row, meId) {
  const deleted = !!row.deleted;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    sender: parse(row.sender),
    isMe: row.sender_id === meId,
    kind: row.kind,
    text: deleted ? 'This message was deleted' : row.body, // older app versions show this text as-is
    mediaKey: deleted ? null : row.media_key,
    meta: deleted ? null : parse(row.meta),
    replyTo: row.reply_to,
    reply: parse(row.reply) || null,
    clientId: row.client_id,
    createdAt: new Date(row.created_at).toISOString(),
    editedAt: !deleted && row.edited_at ? new Date(row.edited_at).toISOString() : null,
    deleted,
    deletedByModerator: deleted && !!row.deleted_by && row.deleted_by !== row.sender_id,
    pinned: !deleted && !!row.pinned,
    reactions: deleted ? [] : (parse(row.reactions) || []),
  };
}

export async function loadMessage(env, messageId, meId) {
  const row = await one(env, `${MSG_SELECT} AND m.id = $2`, [meId, messageId]);
  return row ? messageShape(row, meId) : null;
}

export async function membership(env, convId, userId) {
  return one(env, `SELECT role FROM conversation_members WHERE conversation_id = $1 AND user_id = $2`, [convId, userId]);
}

// Group moderators: owner/admin/moderator of the conversation (CHAT 7.4), or owner/admin of the community whose channel it is.
export async function isModerator(env, convId, userId) {
  const r = await one(env,
    `SELECT (
       EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2 AND role IN ('owner','admin','moderator'))
       OR EXISTS (SELECT 1 FROM community_channels cc
                    JOIN community_members cm ON cm.community_id = cc.community_id
                   WHERE cc.conversation_id = $1 AND cm.user_id = $2 AND cm.status = 'member' AND cm.role IN ('owner','admin'))
     ) AS ok`,
    [convId, userId]);
  return !!(r && r.ok);
}

export async function pinsFor(env, convId, meId) {
  const rows = await q(env,
    `SELECT pm.*, ${userJson('pu')} AS sender, p.pinned_at
       FROM conversation_pins p
       JOIN messages pm ON pm.id = p.message_id AND pm.deleted = false
       JOIN users pu ON pu.id = pm.sender_id
      WHERE p.conversation_id = $1
      ORDER BY p.pinned_at DESC LIMIT ${MAX_PINS}`,
    [convId]);
  return rows.map((r) => ({ ...messageShape({ ...r, pinned: true }, meId), pinnedAt: new Date(r.pinned_at).toISOString() }));
}

// Tell every member's devices that a message changed; each device re-fetches GET /messages/:id (shaped for that viewer).
export async function broadcastChange(env, convId, messageId, change, onlyUserId = null) {
  const members = onlyUserId ? [{ user_id: onlyUserId }] : await q(env, `SELECT user_id FROM conversation_members WHERE conversation_id = $1`, [convId]);
  await Promise.all(members.map((m) => notifyUser(env, m.user_id, { type: 'message.changed', conversationId: convId, messageId, change })));
}
