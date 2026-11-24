// Shared message helpers (ROUND 4 — message actions). Used by routes/conversations.js and routes/messages.js.
import { q, one } from './db.js';
import { userJson } from './shape.js';
import { notifyUser } from '../hub.js';

export const EDIT_WINDOW_HOURS = 0.25; // CHAT 7.3: a short window like WhatsApp — 15 minutes
export const MAX_PINS = 3;
export const REACTIONS = ['🙏', '❤️', '🙌', '👍', '😂', '😢', '🔥', '🕊️'];

const parse = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);

// MEMBERSHIP GROUPS — "message history for new members: only from join time" (memberships.group_settings.history =
// 'since_join'): true when viewer `viewer` is a plain member of a membership section and the message `a` is older than
// their first join (membership_member_prefs.joined_at). Owner / admins always see everything. Used by every message read.
export const historyHiddenSql = (a, viewer) => `EXISTS (SELECT 1 FROM conversations hc
    JOIN memberships hm ON hm.id = hc.membership_id AND hm.group_settings->>'history' = 'since_join'
    JOIN membership_member_prefs hp ON hp.membership_id = hm.id AND hp.user_id = ${viewer}
    JOIN conversation_members hcm ON hcm.conversation_id = hc.id AND hcm.user_id = ${viewer} AND hcm.role = 'member'
   WHERE hc.id = ${a}.conversation_id AND ${a}.created_at < hp.joined_at)`;

// MEMBERSHIP GROUPS — the MASTER CLASS original of a shared post (null for every other message).
export const SHARED_SELECT = (a) => `(SELECT json_build_object('id', s.id, 'conversationId', s.conversation_id, 'kind', s.kind,
       'text', CASE WHEN s.deleted THEN '' ELSE s.body END, 'mediaKey', CASE WHEN s.deleted THEN NULL ELSE s.media_key END,
       'meta', CASE WHEN s.deleted THEN NULL ELSE s.meta END, 'deleted', s.deleted, 'editedAt', s.edited_at, 'createdAt', s.created_at,
       'sender', ${userJson('su')},
       'linkPreview', (SELECT json_build_object('url', lp2.url, 'title', lp2.title, 'description', lp2.description, 'image', lp2.image, 'siteName', lp2.site_name)
                         FROM link_previews lp2 WHERE lp2.url = s.link_url AND lp2.status = 'ok' AND NOT s.deleted))
     FROM messages s JOIN users su ON su.id = s.sender_id WHERE s.id = ${a}.shared_from AND ${a}.kind = 'shared_post')`;

/** The shared original for the app → { id, conversationId, kind, text, mediaKey, meta, sender, commentsOff, ... } */
export function sharedShape(row) {
  if (row.kind !== 'shared_post') return undefined;
  const s = parse(row.shared);
  if (!s) return { deleted: true, commentsOff: true };
  const meta = parse(s.meta) || {};
  return {
    id: s.id,
    conversationId: s.conversationId,
    kind: s.kind,
    text: s.text || '',
    mediaKey: s.mediaKey || null,
    meta: s.deleted ? null : meta,
    sender: s.sender || null,
    createdAt: s.createdAt ? new Date(s.createdAt).toISOString() : null,
    editedAt: s.editedAt ? new Date(s.editedAt).toISOString() : null,
    deleted: !!s.deleted,
    commentsOff: !!s.deleted || !!meta.commentsOff,
    linkPreview: s.linkPreview || null,
  };
}

// Enriched message select for viewer $1: sender, pinned flag, reaction counts (+ mine), reply preview.
// Messages the viewer deleted "for me" are excluded.
export const MSG_SELECT = `
  SELECT m.*, ${userJson('u')} AS sender,
    EXISTS (SELECT 1 FROM conversation_pins p WHERE p.message_id = m.id) AS pinned,
    (SELECT COALESCE(json_agg(json_build_object('emoji', r.emoji, 'count', r.cnt, 'mine', r.mine) ORDER BY r.cnt DESC, r.emoji), '[]'::json)
       FROM (SELECT emoji, COUNT(*)::int AS cnt, bool_or(user_id = $1) AS mine
               FROM message_reactions WHERE message_id = m.id GROUP BY emoji) r) AS reactions,
    (SELECT json_build_object('id', rm.id, 'senderId', rm.sender_id, 'senderName', ru.display_name,
              'kind', rm.kind, 'deleted', rm.deleted,
              -- MEMBERSHIP GROUPS: a reply to a shared post quotes the MASTER CLASS original
              'text', CASE WHEN rm.deleted THEN '' WHEN rm.kind = 'shared_post'
                THEN COALESCE((SELECT CASE WHEN s.deleted THEN '' ELSE s.body END FROM messages s WHERE s.id = rm.shared_from), '') ELSE rm.body END)
       FROM messages rm JOIN users ru ON ru.id = rm.sender_id WHERE rm.id = m.reply_to) AS reply,
    -- CHAT GAPS: cached link-preview card for the first https link (lib/linkPreviews.js)
    (SELECT json_build_object('url', lp.url, 'title', lp.title, 'description', lp.description, 'image', lp.image, 'siteName', lp.site_name)
       FROM link_previews lp WHERE lp.url = m.link_url AND lp.status = 'ok') AS link_preview,
    -- MEMBERSHIP GROUPS: a 'shared_post' in EXECUTIVE CLASS is only a reference; the MASTER CLASS original is joined here
    ${SHARED_SELECT('m')} AS shared
  FROM messages m
  JOIN users u ON u.id = m.sender_id
  WHERE NOT EXISTS (SELECT 1 FROM message_hides h WHERE h.message_id = m.id AND h.user_id = $1)
    AND NOT ${historyHiddenSql('m', '$1')}`;

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
    linkPreview: deleted ? null : (parse(row.link_preview) || null), // CHAT GAPS: { url, title, description, image, siteName }
    ...(row.kind === 'shared_post' ? { shared: deleted ? null : sharedShape(row) } : {}), // MEMBERSHIP GROUPS: the MASTER CLASS original
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
    `SELECT pm.*, ${userJson('pu')} AS sender, p.pinned_at, ${SHARED_SELECT('pm')} AS shared
       FROM conversation_pins p
       JOIN messages pm ON pm.id = p.message_id AND pm.deleted = false
       JOIN users pu ON pu.id = pm.sender_id
      WHERE p.conversation_id = $1 AND NOT ${historyHiddenSql('pm', '$2')}
      ORDER BY p.pinned_at DESC LIMIT ${MAX_PINS}`,
    [convId, meId]);
  return rows.map((r) => ({ ...messageShape({ ...r, pinned: true }, meId), pinnedAt: new Date(r.pinned_at).toISOString() }));
}

// Tell every member's devices that a message changed; each device re-fetches GET /messages/:id (shaped for that viewer).
export async function broadcastChange(env, convId, messageId, change, onlyUserId = null) {
  const members = onlyUserId ? [{ user_id: onlyUserId }] : await q(env, `SELECT user_id FROM conversation_members WHERE conversation_id = $1`, [convId]);
  await Promise.all(members.map((m) => notifyUser(env, m.user_id, { type: 'message.changed', conversationId: convId, messageId, change })));
}
