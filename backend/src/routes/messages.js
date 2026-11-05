// ROUND 4 — message actions for DMs and group channels: view one, edit, delete (for me / for everyone), pin, react.
import { Hono } from 'hono';
import { body, str, uuidParam, bad, notFound, forbidden } from '../lib/http.js';
import { q, one } from '../lib/db.js';
import {
  EDIT_WINDOW_HOURS, MAX_PINS, REACTIONS,
  loadMessage, membership, isModerator, broadcastChange,
} from '../lib/messages.js';

const messages = new Hono();

// Fetch the raw row and check the caller is in the conversation.
async function ownedContext(c) {
  const me = c.get('user');
  const id = uuidParam(c, 'id');
  const msg = await one(c.env,
    `SELECT m.*, cv.kind AS conv_kind FROM messages m JOIN conversations cv ON cv.id = m.conversation_id WHERE m.id = $1`, [id]);
  if (!msg) throw notFound('Message not found');
  const mem = await membership(c.env, msg.conversation_id, me.id);
  if (!mem) throw notFound('Message not found');
  return { me, id, msg };
}

// GET /messages/:id — one message shaped for the caller (devices call this after a message.changed event)
messages.get('/messages/:id', async (c) => {
  const { me, id } = await ownedContext(c);
  const m = await loadMessage(c.env, id, me.id);
  if (!m) throw notFound('Message not found'); // deleted for me
  return c.json(m);
});

// PATCH /messages/:id { text } — edit your own message (text-type messages, within EDIT_WINDOW_HOURS)
messages.patch('/messages/:id', async (c) => {
  const { me, id, msg } = await ownedContext(c);
  if (msg.sender_id !== me.id) throw forbidden('You can only edit your own messages');
  if (msg.deleted) throw bad('This message was deleted', 'MESSAGE_DELETED');
  if (!['text', 'verse', 'prayer'].includes(msg.kind)) throw bad('Only text messages can be edited', 'NOT_EDITABLE');
  if (Date.now() - new Date(msg.created_at).getTime() > EDIT_WINDOW_HOURS * 3600e3) {
    throw bad(`Messages can be edited for ${EDIT_WINDOW_HOURS} hours after sending`, 'EDIT_WINDOW_PASSED');
  }
  const b = await body(c);
  const text = str(b.text, { min: 1, max: 5000, field: 'text' }).trim();
  if (!text) throw bad('Message cannot be empty', 'EMPTY_MESSAGE');
  if (text !== msg.body) {
    await q(c.env, `UPDATE messages SET body = $2, edited_at = now() WHERE id = $1`, [id, text]);
    await broadcastChange(c.env, msg.conversation_id, id, 'edited');
  }
  return c.json(await loadMessage(c.env, id, me.id));
});

// POST /messages/:id/delete { for: 'everyone' | 'me' } — default 'everyone' (older app versions send no body).
//  • everyone: your own message, or any message in a group you moderate. Shows "This message was deleted".
//  • me: hides it only on your devices.
messages.post('/messages/:id/delete', async (c) => {
  const { me, id, msg } = await ownedContext(c);
  const b = await body(c).catch(() => ({}));
  const scope = (b && (b.for || b.scope)) === 'me' ? 'me' : 'everyone';

  if (scope === 'me') {
    await q(c.env, `INSERT INTO message_hides (message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, me.id]);
    await broadcastChange(c.env, msg.conversation_id, id, 'hidden', me.id);
    return c.json({ ok: true, for: 'me' });
  }

  if (msg.sender_id !== me.id) {
    const mod = msg.conv_kind === 'group' && await isModerator(c.env, msg.conversation_id, me.id);
    if (!mod) throw forbidden('You can only delete your own messages for everyone', 'NOT_ALLOWED');
  }
  if (!msg.deleted) {
    await q(c.env,
      `UPDATE messages SET deleted = true, body = '', media_key = NULL, meta = NULL, deleted_by = $2 WHERE id = $1`, [id, me.id]);
    await q(c.env, `DELETE FROM conversation_pins WHERE message_id = $1`, [id]);
    await q(c.env, `DELETE FROM message_reactions WHERE message_id = $1`, [id]);
    await broadcastChange(c.env, msg.conversation_id, id, 'deleted');
  }
  return c.json({ ok: true, for: 'everyone' });
});

// POST /messages/:id/pin { pinned: true|false } — direct chats: either person; groups: moderators only.
messages.post('/messages/:id/pin', async (c) => {
  const { me, id, msg } = await ownedContext(c);
  const b = await body(c).catch(() => ({}));
  const pinned = b && b.pinned === false ? false : true;
  if (msg.conv_kind === 'group' && !(await isModerator(c.env, msg.conversation_id, me.id))) {
    throw forbidden('Only group admins can pin messages', 'ADMIN_ONLY');
  }
  if (pinned) {
    if (msg.deleted) throw bad('Deleted messages cannot be pinned', 'MESSAGE_DELETED');
    await q(c.env,
      `INSERT INTO conversation_pins (conversation_id, message_id, pinned_by) VALUES ($1, $2, $3)
       ON CONFLICT (conversation_id, message_id) DO UPDATE SET pinned_at = now(), pinned_by = $3`,
      [msg.conversation_id, id, me.id]);
    // keep the newest MAX_PINS
    await q(c.env,
      `DELETE FROM conversation_pins WHERE conversation_id = $1 AND message_id NOT IN (
         SELECT message_id FROM conversation_pins WHERE conversation_id = $1 ORDER BY pinned_at DESC LIMIT ${MAX_PINS})`,
      [msg.conversation_id]);
  } else {
    await q(c.env, `DELETE FROM conversation_pins WHERE conversation_id = $1 AND message_id = $2`, [msg.conversation_id, id]);
  }
  await q(c.env, `UPDATE conversations SET pinned_message_id = (
      SELECT message_id FROM conversation_pins WHERE conversation_id = $1 ORDER BY pinned_at DESC LIMIT 1) WHERE id = $1`,
    [msg.conversation_id]);
  await broadcastChange(c.env, msg.conversation_id, id, pinned ? 'pinned' : 'unpinned');
  return c.json({ ok: true, pinned });
});

// POST /messages/:id/react { emoji } — one reaction per person; same emoji again (or emoji null) removes it.
messages.post('/messages/:id/react', async (c) => {
  const { me, id, msg } = await ownedContext(c);
  if (msg.deleted) throw bad('This message was deleted', 'MESSAGE_DELETED');
  const b = await body(c).catch(() => ({}));
  const emoji = b && b.emoji ? String(b.emoji) : null;
  if (emoji && !REACTIONS.includes(emoji)) throw bad('Unsupported reaction', 'BAD_REACTION');
  const cur = await one(c.env, `SELECT emoji FROM message_reactions WHERE message_id = $1 AND user_id = $2`, [id, me.id]);
  let mine = null;
  if (!emoji || (cur && cur.emoji === emoji)) {
    await q(c.env, `DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2`, [id, me.id]);
  } else {
    await q(c.env,
      `INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)
       ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = $3, created_at = now()`, [id, me.id, emoji]);
    mine = emoji;
  }
  await broadcastChange(c.env, msg.conversation_id, id, 'reacted');
  const m = await loadMessage(c.env, id, me.id);
  return c.json({ ok: true, mine, reactions: m ? m.reactions : [] });
});

export default messages;
