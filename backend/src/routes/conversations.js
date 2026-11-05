// Direct messages & conversations routes
import { Hono } from 'hono';
import { body, str, uuidParam, bad, notFound, forbidden, encodeCursor, decodeCursor } from '../lib/http.js';
import { q, one } from '../lib/db.js';
import { userJson } from '../lib/shape.js';
import { notifyUser } from '../hub.js';
import { sendNotification } from '../lib/push.js';
import { MSG_SELECT, messageShape, loadMessage, pinsFor } from '../lib/messages.js';

const conversations = new Hono();

export { messageShape } from '../lib/messages.js';

// GET /conversations — list user conversations with last message + unread count
conversations.get('/conversations', async (c) => {
  const me = c.get('user');
  const rows = await q(c.env,
    `SELECT c.id, c.kind, c.title, c.avatar_key, c.pinned_message_id, c.created_at, c.last_message_at,
            m.role, m.last_read_at, m.muted,
            (SELECT json_build_object(
               'id', msg.id, 'kind', msg.kind, 'body', CASE WHEN msg.deleted THEN 'This message was deleted' ELSE msg.body END,
               'senderId', msg.sender_id, 'createdAt', msg.created_at, 'deleted', msg.deleted
             )
             FROM messages msg WHERE msg.conversation_id = c.id
               AND NOT EXISTS (SELECT 1 FROM message_hides h WHERE h.message_id = msg.id AND h.user_id = $1)
             ORDER BY msg.created_at DESC LIMIT 1) AS last_message,
            (SELECT COUNT(*)::int FROM messages unread
             WHERE unread.conversation_id = c.id
               AND unread.created_at > m.last_read_at
               AND unread.sender_id <> $1
               AND unread.deleted = false) AS unread_count,
            (SELECT ${userJson('other_u')}
             FROM conversation_members other_m
             JOIN users other_u ON other_u.id = other_m.user_id
             WHERE other_m.conversation_id = c.id AND other_m.user_id <> $1
             LIMIT 1) AS other_user,
            (SELECT mr.status FROM message_requests mr
             WHERE mr.conversation_id = c.id AND mr.to_id = $1) AS request_status,
            (SELECT EXISTS (
               SELECT 1 FROM follows f
               JOIN conversation_members om ON om.conversation_id = c.id AND om.user_id <> $1
               WHERE f.follower_id = om.user_id AND f.followee_id = $1
            )) AS other_follows_me,
            (SELECT EXISTS (
               SELECT 1 FROM follows f
               JOIN conversation_members om ON om.conversation_id = c.id AND om.user_id <> $1
               WHERE f.follower_id = $1 AND f.followee_id = om.user_id
            )) AS i_follow_other
     FROM conversations c
     JOIN conversation_members m ON m.conversation_id = c.id AND m.user_id = $1
     ORDER BY c.last_message_at DESC
     LIMIT 50`,
    [me.id]
  );

  const items = rows.map((r) => {
    const otherUser = r.other_user ? (typeof r.other_user === 'string' ? JSON.parse(r.other_user) : r.other_user) : null;
    const lastMsg = r.last_message ? (typeof r.last_message === 'string' ? JSON.parse(r.last_message) : r.last_message) : null;
    return {
      id: r.id,
      kind: r.kind,
      title: r.kind === 'dm' && otherUser ? otherUser.displayName : (r.title || 'Conversation'),
      avatarKey: r.avatar_key,
      otherUser,
      role: r.role,
      muted: !!r.muted,
      unreadCount: r.unread_count || 0,
      isRequest: r.request_status === 'pending',
      requestStatus: r.request_status || null,
      otherFollowsMe: !!r.other_follows_me,
      iFollowOther: !!r.i_follow_other,
      canMessage: r.kind !== 'dm' || !!r.other_follows_me || r.role === 'admin',
      lastMessage: lastMsg ? {
        id: lastMsg.id,
        kind: lastMsg.kind,
        text: lastMsg.body,
        senderId: lastMsg.senderId,
        createdAt: new Date(lastMsg.createdAt).toISOString(),
        deleted: !!lastMsg.deleted,
      } : null,
      lastMessageAt: new Date(r.last_message_at).toISOString(),
    };
  });

  return c.json({ items });
});

// POST /conversations/dm — start or get existing DM conversation with a user
conversations.post('/conversations/dm', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const targetUserId = b.userId;
  if (!targetUserId || targetUserId === me.id) throw bad('Invalid recipient');

  // Check blocks in either direction
  const block = await one(c.env,
    `SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)`,
    [me.id, targetUserId]
  );
  if (block) throw forbidden('You cannot message this user', 'BLOCKED');

  // Verify target user exists
  const targetUser = await one(c.env, `SELECT * FROM users WHERE id = $1`, [targetUserId]);
  if (!targetUser) throw notFound('User not found');

  // Check if DM conversation already exists
  const existing = await one(c.env,
    `SELECT c.id FROM conversations c
     JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = $1
     JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = $2
     WHERE c.kind = 'dm' LIMIT 1`,
    [me.id, targetUserId]
  );
  const otherFollowsMe = await one(c.env, `SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2`, [targetUserId, me.id]);
  const iFollowOther = await one(c.env, `SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2`, [me.id, targetUserId]);

  if (existing) {
    return c.json({
      id: existing.id,
      isNew: false,
      otherFollowsMe: !!otherFollowsMe,
      iFollowOther: !!iFollowOther,
      canMessage: !!otherFollowsMe || me.role === 'admin',
    });
  }

  // Create new DM conversation
  const conv = await one(c.env, `INSERT INTO conversations (kind) VALUES ('dm') RETURNING *`);
  await q(c.env,
    `INSERT INTO conversation_members (conversation_id, user_id, role)
     VALUES ($1, $2, 'member'), ($1, $3, 'member')`,
    [conv.id, me.id, targetUserId]
  );

  // Check mutual follow status: if neither follows the other, create message_request
  const follow = await one(c.env,
    `SELECT 1 FROM follows WHERE (follower_id = $1 AND followee_id = $2) OR (follower_id = $2 AND followee_id = $1) LIMIT 1`,
    [me.id, targetUserId]
  );
  let isRequest = false;
  if (!follow) {
    isRequest = true;
    await q(c.env,
      `INSERT INTO message_requests (from_id, to_id, conversation_id, status)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (from_id, to_id) DO UPDATE SET conversation_id = $3, status = 'pending'`,
      [me.id, targetUserId, conv.id]
    );
    // Send push notification & hub event for message request
    await notifyUser(c.env, targetUserId, { type: 'request.new', from: { id: me.id, displayName: me.display_name }, conversationId: conv.id });
    sendNotification(c, {
      userId: targetUserId,
      kind: 'request',
      title: 'New Message Request',
      body: `${me.display_name} sent you a message request.`,
      data: { conversationId: conv.id, fromId: me.id },
    });
  }

  return c.json({
    id: conv.id,
    isNew: true,
    isRequest,
    otherFollowsMe: !!otherFollowsMe,
    iFollowOther: !!iFollowOther,
    canMessage: !!otherFollowsMe || me.role === 'admin',
  }, 201);
});

// GET /conversations/:id/messages — paginated messages or polling with ?after=
conversations.get('/conversations/:id/messages', async (c) => {
  const me = c.get('user');
  const convId = uuidParam(c, 'id');

  // Verify membership
  const member = await one(c.env, `SELECT * FROM conversation_members WHERE conversation_id = $1 AND user_id = $2`, [convId, me.id]);
  if (!member) throw forbidden('Not a member of this conversation');

  const after = c.req.query('after');
  const cursor = decodeCursor(c.req.query('cursor'));
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '30', 10)));

  let rows;
  if (after) {
    // Polling mode: messages strictly created after timestamp
    const afterDate = new Date(after).toISOString();
    rows = await q(c.env,
      `${MSG_SELECT} AND m.conversation_id = $2 AND m.created_at > $3
       ORDER BY m.created_at ASC LIMIT $4`,
      [me.id, convId, afterDate, limit]
    );
    return c.json({ items: rows.map((r) => messageShape(r, me.id)) });
  }

  // Keyset cursor pagination (newest first)
  if (cursor) {
    rows = await q(c.env,
      `${MSG_SELECT} AND m.conversation_id = $2 AND (m.created_at, m.id) < ($3, $4)
       ORDER BY m.created_at DESC, m.id DESC LIMIT $5`,
      [me.id, convId, cursor.ts, cursor.id, limit + 1]
    );
  } else {
    rows = await q(c.env,
      `${MSG_SELECT} AND m.conversation_id = $2
       ORDER BY m.created_at DESC, m.id DESC LIMIT $3`,
      [me.id, convId, limit + 1]
    );
  }

  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows).map((r) => messageShape(r, me.id));
  const nextCursor = hasMore && items.length > 0 ? encodeCursor(rows[limit - 1]) : null;
  // ROUND 4: pinned messages ride along with the first page
  const pins = cursor ? undefined : await pinsFor(c.env, convId, me.id);
  const myRole = member.role;

  return c.json({ items, cursor: nextCursor, hasMore, pins, myRole });
});

// POST /conversations/:id/messages — send message
conversations.post('/conversations/:id/messages', async (c) => {
  const me = c.get('user');
  const convId = uuidParam(c, 'id');
  const b = await body(c);

  const kind = b.kind || 'text';
  if (!['text', 'image', 'voice', 'verse', 'prayer', 'event'].includes(kind)) throw bad('Invalid message kind');
  const text = str(b.text || '', { max: 5000, optional: true }) || '';
  const mediaKey = b.mediaKey ? str(b.mediaKey, { max: 500 }) : null;
  const meta = b.meta && typeof b.meta === 'object' ? b.meta : null;
  const replyTo = b.replyTo ? String(b.replyTo) : null;
  const clientId = b.clientId ? str(b.clientId, { max: 100 }) : null;

  if (!text && !mediaKey && !meta) throw bad('Message content required', 'EMPTY_MESSAGE');

  // Fetch conversation, membership, other members, and rate limit check in parallel (1 round-trip)
  const [convData, recentCount] = await Promise.all([
    one(c.env, `
      SELECT c.id, c.kind, c.title,
        EXISTS(SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2) AS is_member,
        COALESCE(
          (SELECT json_agg(json_build_object('user_id', cm.user_id, 'muted', cm.muted))
           FROM conversation_members cm WHERE cm.conversation_id = $1 AND cm.user_id <> $2),
          '[]'::json
        ) AS other_members
      FROM conversations c WHERE c.id = $1
    `, [convId, me.id]),
    one(c.env,
      `SELECT COUNT(*)::int AS count FROM messages WHERE sender_id = $1 AND created_at > now() - INTERVAL '1 minute'`,
      [me.id]
    ),
  ]);

  if (!convData || !convData.is_member) throw forbidden('Not a member of this conversation');
  if ((recentCount?.count || 0) >= 30) {
    throw bad('You are sending messages too quickly. Please wait a moment.', 'RATE_LIMITED');
  }

  const otherMembers = (typeof convData.other_members === 'string'
    ? JSON.parse(convData.other_members)
    : convData.other_members) || [];

  // If DM, check recipient block status & follow-back requirement
  if (convData.kind === 'dm' && otherMembers.length > 0) {
    const otherId = otherMembers[0].user_id;
    const isBlocked = await one(c.env,
      `SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)`,
      [me.id, otherId]
    );
    if (isBlocked) throw forbidden('You cannot message this user', 'BLOCKED');

    if (me.role !== 'admin' && c.env.AUTH_DEV_MODE !== 'true') {
      const otherFollowsMe = await one(c.env,
        `SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2`,
        [otherId, me.id]
      );
      const isAccepted = await one(c.env,
        `SELECT 1 FROM message_requests WHERE (from_id = $1 AND to_id = $2 AND status = 'accepted') OR (from_id = $2 AND to_id = $1 AND status = 'accepted')`,
        [me.id, otherId]
      );
      if (!otherFollowsMe && !isAccepted) {
        throw forbidden('This person needs to follow you back before you can message them', 'FOLLOW_BACK_REQUIRED');
      }
    }
  }

  // Idempotency check with clientId
  if (clientId) {
    const existing = await one(c.env,
      `SELECT id FROM messages WHERE conversation_id = $1 AND sender_id = $2 AND client_id = $3`,
      [convId, me.id, clientId]
    );
    if (existing) return c.json(await loadMessage(c.env, existing.id, me.id));
  }

  // ROUND 4: a reply must point at a message in the same conversation
  if (replyTo) {
    const target = /^[0-9a-f-]{36}$/i.test(replyTo)
      ? await one(c.env, `SELECT 1 FROM messages WHERE id = $1 AND conversation_id = $2`, [replyTo, convId])
      : null;
    if (!target) throw bad('The message you replied to is not in this conversation', 'BAD_REPLY');
  }

  // Insert message and touch conversation timestamps in a single atomic CTE query
  const row = await one(c.env,
    `WITH inserted AS (
       INSERT INTO messages (conversation_id, sender_id, kind, body, media_key, meta, reply_to, client_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *
     ),
     up_conv AS (
       UPDATE conversations SET last_message_at = now() WHERE id = $1
     ),
     up_mem AS (
       UPDATE conversation_members SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2
     )
     SELECT i.*, ${userJson('u')} AS sender
     FROM inserted i
     JOIN users u ON u.id = i.sender_id`,
    [convId, me.id, kind, text, mediaKey, meta ? JSON.stringify(meta) : null, replyTo, clientId]
  );

  const formatted = replyTo ? await loadMessage(c.env, row.id, me.id) : messageShape(row, me.id);

  // Notify all other members in parallel
  await Promise.all(
    otherMembers.map(async (m) => {
      await notifyUser(c.env, m.user_id, {
        type: 'message.new',
        conversationId: convId,
        message: formatted,
      });
      if (!m.muted) {
        sendNotification(c, {
          userId: m.user_id,
          kind: convData.kind === 'group' ? 'group' : 'message',
          title: convData.kind === 'group' ? (convData.title || 'Group Message') : me.display_name,
          body: kind === 'image' ? '📷 Photo' : kind === 'voice' ? '🎤 Voice message' : (text.slice(0, 100) || 'New message'),
          data: { conversationId: convId, messageId: row.id },
        });
      }
    })
  );

  return c.json(formatted, 201);
});

// POST /conversations/:id/read — mark conversation as read
conversations.post('/conversations/:id/read', async (c) => {
  const me = c.get('user');
  const convId = uuidParam(c, 'id');
  await q(c.env,
    `UPDATE conversation_members SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2`,
    [convId, me.id]
  );
  const others = await q(c.env, `SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND user_id <> $2`, [convId, me.id]);
  for (const o of others) {
    await notifyUser(c.env, o.user_id, { type: 'message.read', conversationId: convId, userId: me.id, readAt: new Date().toISOString() });
  }
  return c.json({ ok: true });
});

// POST /conversations/:id/mute — toggle mute
conversations.post('/conversations/:id/mute', async (c) => {
  const me = c.get('user');
  const convId = uuidParam(c, 'id');
  const updated = await one(c.env,
    `UPDATE conversation_members SET muted = NOT muted WHERE conversation_id = $1 AND user_id = $2 RETURNING muted`,
    [convId, me.id]
  );
  if (!updated) throw notFound('Not a member');
  return c.json({ ok: true, muted: updated.muted });
});

// POST /messages/:id/delete moved to routes/messages.js (ROUND 4: delete for me / for everyone, moderators)

// Message Requests
conversations.get('/me/requests', async (c) => {
  const me = c.get('user');
  const rows = await q(c.env,
    `SELECT mr.from_id, mr.to_id, mr.conversation_id, mr.status, mr.created_at,
            ${userJson('u')} AS from_user,
            (SELECT json_build_object('body', msg.body, 'createdAt', msg.created_at)
             FROM messages msg WHERE msg.conversation_id = mr.conversation_id AND msg.deleted = false
             ORDER BY msg.created_at DESC LIMIT 1) AS last_message
     FROM message_requests mr
     JOIN users u ON u.id = mr.from_id
     WHERE mr.to_id = $1 AND mr.status = 'pending'
     ORDER BY mr.created_at DESC`,
    [me.id]
  );
  return c.json({
    items: rows.map((r) => ({
      fromId: r.from_id,
      conversationId: r.conversation_id,
      status: r.status,
      createdAt: new Date(r.created_at).toISOString(),
      fromUser: r.from_user ? (typeof r.from_user === 'string' ? JSON.parse(r.from_user) : r.from_user) : null,
      lastMessage: r.last_message ? (typeof r.last_message === 'string' ? JSON.parse(r.last_message) : r.last_message) : null,
    })),
  });
});

conversations.post('/me/requests/:fromId/accept', async (c) => {
  const me = c.get('user');
  const fromId = uuidParam(c, 'fromId');
  await q(c.env, `UPDATE message_requests SET status = 'accepted' WHERE from_id = $1 AND to_id = $2`, [fromId, me.id]);
  await notifyUser(c.env, fromId, { type: 'request.accepted', by: me.id });
  return c.json({ ok: true, status: 'accepted' });
});

conversations.post('/me/requests/:fromId/decline', async (c) => {
  const me = c.get('user');
  const fromId = uuidParam(c, 'fromId');
  await q(c.env, `UPDATE message_requests SET status = 'declined' WHERE from_id = $1 AND to_id = $2`, [fromId, me.id]);
  return c.json({ ok: true, status: 'declined' });
});

conversations.post('/me/requests/:fromId/block', async (c) => {
  const me = c.get('user');
  const fromId = uuidParam(c, 'fromId');
  await q(c.env, `INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [me.id, fromId]);
  await q(c.env, `UPDATE message_requests SET status = 'blocked' WHERE from_id = $1 AND to_id = $2`, [fromId, me.id]);
  return c.json({ ok: true, status: 'blocked' });
});

// Blocks
conversations.post('/users/:id/block', async (c) => {
  const me = c.get('user');
  const targetId = uuidParam(c, 'id');
  if (targetId === me.id) throw bad('Cannot block yourself');
  await q(c.env, `INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [me.id, targetId]);
  return c.json({ ok: true, blocked: true });
});

conversations.delete('/users/:id/block', async (c) => {
  const me = c.get('user');
  const targetId = uuidParam(c, 'id');
  await q(c.env, `DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2`, [me.id, targetId]);
  return c.json({ ok: true, blocked: false });
});

export default conversations;
