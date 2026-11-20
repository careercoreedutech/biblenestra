// Direct messages & conversations routes
import { Hono } from 'hono';
import { ApiError, body, str, uuidParam, bad, notFound, forbidden, encodeCursor, decodeCursor } from '../lib/http.js';
import { q, one } from '../lib/db.js';
import { userJson } from '../lib/shape.js';
import { notifyUser } from '../hub.js';
import { sendNotification } from '../lib/push.js';
import { cleanVoiceMeta } from '../lib/voiceMeta.js'; // VOICE NOTES: waveform + duration validation
import { MSG_SELECT, messageShape, loadMessage, pinsFor } from '../lib/messages.js';
import { mediaUrl } from '../lib/shape.js';
import {
  groupContext, permissionsFor, systemMessage, settingsOf, touchPresence, presenceShape, receiptsFor, markDelivered, typingIn, RANK, addMembersTo,
} from '../lib/chatGroups.js';
import { assertCanStartDm, useSlotForFirstMessage } from '../lib/chatLimits.js'; // CHAT LIMITS (client #27): free users start ≤ 5 platform chats
import { firstLinkUrl, cachedPreview, scheduleLinkPreview } from '../lib/linkPreviews.js'; // CHAT GAPS: link preview cards
import { mutedSql } from '../lib/chatMute.js'; // CHAT GAPS: timed mute (expiry honoured everywhere)
import { broadcastChange } from '../lib/messages.js';

const conversations = new Hono();

export { messageShape } from '../lib/messages.js';

// Chat-list / push preview for messages that have no text of their own
const KIND_PREVIEW = { image: '📷 Photo', voice: '🎤 Voice message', video: '🎥 Video', file: '📄 Document' };
const fmtSecs = (ms) => { const t = Math.max(0, Math.round((ms || 0) / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
// One-line preview for the chat list and pushes: "🎤 Voice note (0:42)", "📄 Notes.pdf", "🎥 Video"…
export function previewText(kind, text, meta) {
  const m = meta || {};
  if (kind === 'voice') return m.file ? `🎵 ${m.name || 'Audio'}` : `🎤 Voice note${m.durationMs ? ` (${fmtSecs(m.durationMs)})` : ''}`;
  if (kind === 'file') return `📄 ${m.name || 'Document'}`;
  if (kind === 'image') return text || '📷 Photo';
  if (kind === 'video') return text ? `🎥 ${text}` : '🎥 Video';
  return text || KIND_PREVIEW[kind] || '';
}
const MAX_CHAT_GIFT = 10000;
// A media message may only point at this chat's uploads (or the sender's own public uploads)
const mediaKeyOk = (key, convId, meId) => {
  if (key.includes('..')) return false;
  const file = (prefix) => key.startsWith(prefix) && /^[\w.-]+$/.test(key.slice(prefix.length));
  return file(`chat/${convId}/`) || ['img', 'aud', 'voice'].some((d) => file(`${d}/${meId}/`));
};

// GET /conversations — list user conversations with last message + unread count
conversations.get('/conversations', async (c) => {
  const me = c.get('user');
  // CHAT 7.3: opening the list = online + everything delivered to this device (double grey ticks for senders)
  await touchPresence(c.env, me.id);
  await markDelivered(c.env, me.id);
  const meVis = (await one(c.env, 'SELECT last_seen_visibility FROM users WHERE id = $1', [me.id]))?.last_seen_visibility || 'everyone';
  const rows = await q(c.env,
    `SELECT c.id, c.kind, c.title, c.avatar_key, c.pinned_message_id, c.created_at, c.last_message_at,
            c.description, c.is_public, c.settings,
            (SELECT COALESCE(json_agg(tu.display_name), '[]'::json) FROM conversation_members tm JOIN users tu ON tu.id = tm.user_id
              WHERE tm.conversation_id = c.id AND tm.user_id <> $1 AND tm.typing_at > now() - interval '6 seconds') AS typing,
            (SELECT json_build_object('presence_at', pu.presence_at, 'last_seen_visibility', pu.last_seen_visibility)
               FROM conversation_members pm JOIN users pu ON pu.id = pm.user_id
              WHERE c.kind = 'dm' AND pm.conversation_id = c.id AND pm.user_id <> $1 LIMIT 1) AS other_presence,
            (SELECT MIN(rm.last_read_at) FROM conversation_members rm WHERE rm.conversation_id = c.id AND rm.user_id <> $1) AS others_read_at,
            (SELECT MIN(COALESCE(rm.last_delivered_at, rm.last_read_at)) FROM conversation_members rm WHERE rm.conversation_id = c.id AND rm.user_id <> $1) AS others_delivered_at,
            (SELECT COUNT(*)::int FROM conversation_members cnt WHERE cnt.conversation_id = c.id) AS members_count,
            (SELECT co.name FROM community_channels cc JOIN communities co ON co.id = cc.community_id WHERE cc.conversation_id = c.id LIMIT 1) AS community_name,
            m.role, m.last_read_at, ${mutedSql('m')} AS muted, m.muted_until,
            (SELECT json_build_object(
               'id', msg.id, 'kind', msg.kind, 'body', CASE WHEN msg.deleted THEN 'This message was deleted' ELSE msg.body END,
               'senderId', msg.sender_id, 'createdAt', msg.created_at, 'deleted', msg.deleted,
               'meta', CASE WHEN msg.deleted THEN NULL ELSE msg.meta END,
               'senderName', (SELECT su.display_name FROM users su WHERE su.id = msg.sender_id)
             )
             FROM messages msg WHERE msg.conversation_id = c.id
               AND NOT EXISTS (SELECT 1 FROM message_hides h WHERE h.message_id = msg.id AND h.user_id = $1)
             ORDER BY msg.created_at DESC LIMIT 1) AS last_message,
            (SELECT COUNT(*)::int FROM messages unread
             WHERE unread.conversation_id = c.id
               AND unread.created_at > m.last_read_at
               AND unread.sender_id <> $1
               AND unread.kind <> 'system'
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
    const parseJ = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);
    const settings = settingsOf(r);
    const perms = permissionsFor({ conv: r, rank: RANK[r.role] ?? 0, settings });
    return {
      id: r.id,
      kind: r.kind,
      title: r.kind === 'dm' && otherUser ? otherUser.displayName : (r.title || 'Conversation'),
      avatarKey: r.avatar_key,
      avatarUrl: r.avatar_key ? mediaUrl(c.env, new URL(c.req.url).origin, r.avatar_key) : null,
      otherUser,
      // CHAT 7.3: live "Typing…" in the list, online / last seen (privacy-aware), read receipt for my last message
      typing: parseJ(r.typing) || [],
      presence: r.kind === 'dm' ? presenceShape(parseJ(r.other_presence), meVis) : null,
      receipts: {
        readAt: r.others_read_at ? new Date(r.others_read_at).toISOString() : null,
        deliveredAt: r.others_delivered_at ? new Date(r.others_delivered_at).toISOString() : null,
      },
      settings,
      role: r.role,
      muted: !!r.muted,
      mutedUntil: r.muted && r.muted_until ? new Date(r.muted_until).toISOString() : null, // CHAT GAPS: timed mute
      unreadCount: r.unread_count || 0,
      isRequest: r.request_status === 'pending',
      requestStatus: r.request_status || null,
      otherFollowsMe: !!r.other_follows_me,
      iFollowOther: !!r.i_follow_other,
      // WhatsApp-style: anyone can message anyone (blocks still apply); in a channel only its admins post
      canMessage: perms.canSend,
      description: r.description || '',
      isPublic: r.is_public !== false,
      membersCount: r.members_count || 0,
      communityName: r.community_name || null,
      lastMessage: lastMsg ? {
        id: lastMsg.id,
        kind: lastMsg.kind,
        text: lastMsg.deleted ? lastMsg.body : previewText(lastMsg.kind, lastMsg.body, lastMsg.meta),
        senderId: lastMsg.senderId,
        senderName: lastMsg.senderName || null,
        durationMs: lastMsg.meta && lastMsg.meta.durationMs ? lastMsg.meta.durationMs : undefined,
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
      canMessage: true,
    });
  }

  // CHAT LIMITS: a free user with no free slot left can't open a NEW chat with a non-invited user (403 CHAT_LIMIT_REACHED)
  await assertCanStartDm(c.env, me, targetUserId, null);

  // Create new DM conversation
  const conv = await one(c.env, `INSERT INTO conversations (kind) VALUES ('dm') RETURNING *`);
  await q(c.env,
    `INSERT INTO conversation_members (conversation_id, user_id, role)
     VALUES ($1, $2, 'member'), ($1, $3, 'member')`,
    [conv.id, me.id, targetUserId]
  );

  // No message requests: a first message goes straight through (the recipient can still block)
  const isRequest = false;

  return c.json({
    id: conv.id,
    isNew: true,
    isRequest,
    otherFollowsMe: !!otherFollowsMe,
    iFollowOther: !!iFollowOther,
    canMessage: true,
  }, 201);
});

// GET /conversations/:id/messages — paginated messages or polling with ?after=
conversations.get('/conversations/:id/messages', async (c) => {
  const me = c.get('user');
  const convId = uuidParam(c, 'id');

  // Verify membership
  const member = await one(c.env, `SELECT * FROM conversation_members WHERE conversation_id = $1 AND user_id = $2`, [convId, me.id]);
  if (!member) throw forbidden('Not a member of this conversation');

  // CHAT 7.3: reading a thread = online + delivered
  await touchPresence(c.env, me.id);
  await markDelivered(c.env, me.id, convId);
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
  // CHAT GAPS: links whose card isn't cached yet (sent while the fetch failed, or before this feature) are fetched
  // in the background on read — at most 3 per page; the devices hear message.changed when a card is ready.
  if (!cursor) {
    const missing = new Map();
    for (const r of rows) if (r.link_url && !r.link_preview && !r.deleted && missing.size < 3) missing.set(r.link_url, [...(missing.get(r.link_url) || []), r.id]);
    for (const [url, msgIds] of missing) {
      scheduleLinkPreview(c, url, () => Promise.all(msgIds.map((mid) => broadcastChange(c.env, convId, mid, 'linkPreview').catch(() => {}))));
    }
  }
  const nextCursor = hasMore && items.length > 0 ? encodeCursor(rows[limit - 1]) : null;
  // ROUND 4: pinned messages ride along with the first page
  const pins = cursor ? undefined : await pinsFor(c.env, convId, me.id);
  const myRole = member.role;
  if (cursor) return c.json({ items, cursor: nextCursor, hasMore, myRole });

  // CHAT 7.3 / 7.4: the first page also carries receipts (ticks), who's typing, the other person's presence (DMs)
  // and what I may do here (group permissions) — so the 5 s polling fallback keeps all of it fresh too.
  const ctx = await groupContext(c.env, convId, me.id);
  const permissions = permissionsFor(ctx);
  const [receipts, typing] = await Promise.all([receiptsFor(c.env, convId, me.id), typingIn(c.env, convId, me.id)]);
  let presence = null;
  if (ctx.conv.kind === 'dm') {
    const other = await one(c.env, `SELECT u.presence_at, u.last_seen_visibility FROM conversation_members m JOIN users u ON u.id = m.user_id
      WHERE m.conversation_id = $1 AND m.user_id <> $2 LIMIT 1`, [convId, me.id]);
    const mine = await one(c.env, 'SELECT last_seen_visibility FROM users WHERE id = $1', [me.id]);
    presence = presenceShape(other, mine && mine.last_seen_visibility);
  }
  return c.json({ items, cursor: nextCursor, hasMore, pins, myRole, receipts, typing, presence, permissions, settings: ctx.settings });
});

// POST /conversations/:id/messages — send message
conversations.post('/conversations/:id/messages', async (c) => {
  const me = c.get('user');
  const convId = uuidParam(c, 'id');
  const b = await body(c);

  const kind = b.kind || 'text';
  if (!['text', 'image', 'voice', 'verse', 'prayer', 'event', 'video', 'file'].includes(kind)) throw bad('Invalid message kind');
  const text = str(b.text || '', { max: 5000, optional: true }) || '';
  const mediaKey = b.mediaKey ? str(b.mediaKey, { max: 500 }) : null;
  const rawMeta = b.meta && typeof b.meta === 'object' ? b.meta : null;
  const meta = kind === 'voice' ? cleanVoiceMeta(rawMeta) : rawMeta; // VOICE NOTES: duration + waveform levels (lib/voiceMeta.js)
  const replyTo = b.replyTo ? String(b.replyTo) : null;
  const clientId = b.clientId ? str(b.clientId, { max: 100 }) : null;

  if (!text && !mediaKey && !meta) throw bad('Message content required', 'EMPTY_MESSAGE');
  if (['image', 'voice', 'video', 'file'].includes(kind) && !mediaKey) throw bad('Attach the uploaded file (mediaKey)', 'MEDIA_REQUIRED');
  if (meta && meta.system) throw bad('Not allowed', 'BAD_META');
  if (mediaKey && !mediaKeyOk(mediaKey, convId, me.id)) throw bad('That file does not belong to this chat', 'BAD_MEDIA');
  // coin gifts only come from POST /conversations/:id/coins
  if (meta && meta.gift) throw bad('Send coins with the gift button', 'BAD_META');

  // Fetch conversation, membership, other members, and rate limit check in parallel (1 round-trip)
  const [convData, recentCount] = await Promise.all([
    one(c.env, `
      SELECT c.id, c.kind, c.title,
        EXISTS(SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2) AS is_member,
        COALESCE(
          (SELECT json_agg(json_build_object('user_id', cm.user_id, 'muted', ${mutedSql('cm')}))
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
  if (convData.kind === 'channel') {
    const mine = await one(c.env, 'SELECT role FROM conversation_members WHERE conversation_id = $1 AND user_id = $2', [convId, me.id]);
    if (!mine || !['owner', 'admin'].includes(mine.role)) throw forbidden('Only the channel’s admins can post here', 'CHANNEL_ADMINS_ONLY');
  }
  // CHAT 7.4: group permissions — "only admins can send" and slow mode (admins & moderators are exempt)
  if (convData.kind === 'group') {
    const gctx = await groupContext(c.env, convId, me.id);
    const perms = permissionsFor(gctx);
    if (!perms.canSend) throw forbidden('Only admins can send messages in this group', 'ADMINS_ONLY_SEND');
    const slow = gctx.settings.slowModeSec;
    if (slow && !perms.isModerator) {
      const last = await one(c.env, `SELECT EXTRACT(EPOCH FROM (now() - last_sent_at))::float AS ago FROM conversation_members WHERE conversation_id = $1 AND user_id = $2`, [convId, me.id]);
      if (last && last.ago != null && last.ago < slow) {
        throw bad(`Slow mode is on — you can send again in ${Math.ceil(slow - last.ago)}s`, 'SLOW_MODE');
      }
    }
  }
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

    // follow-back is no longer required to message someone
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

  // CHAT LIMITS: the free user's first message of a new 1:1 chat uses a slot (idempotent; 403 CHAT_LIMIT_REACHED when none left)
  if (convData.kind === 'dm' && otherMembers.length > 0) await useSlotForFirstMessage(c.env, me, convId, otherMembers[0].user_id);

  // CHAT GAPS: remember the first https link; its preview card is fetched after the response (never slows sending)
  const linkUrl = firstLinkUrl(text);

  // Insert message and touch conversation timestamps in a single atomic CTE query
  const row = await one(c.env,
    `WITH inserted AS (
       INSERT INTO messages (conversation_id, sender_id, kind, body, media_key, meta, reply_to, client_id, link_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *
     ),
     up_conv AS (
       UPDATE conversations SET last_message_at = now() WHERE id = $1
     ),
     up_mem AS (
       UPDATE conversation_members SET last_read_at = now(), last_sent_at = now(), typing_at = NULL WHERE conversation_id = $1 AND user_id = $2
     )
     SELECT i.*, ${userJson('u')} AS sender
     FROM inserted i
     JOIN users u ON u.id = i.sender_id`,
    [convId, me.id, kind, text, mediaKey, meta ? JSON.stringify(meta) : null, replyTo, clientId, linkUrl]
  );

  const formatted = replyTo ? await loadMessage(c.env, row.id, me.id) : messageShape(row, me.id);
  if (linkUrl) {
    // a link someone already shared shows its card at once; a new one gets it a moment later (message.changed)
    const known = await cachedPreview(c.env, linkUrl);
    if (known) formatted.linkPreview = known;
    else scheduleLinkPreview(c, linkUrl, () => broadcastChange(c.env, convId, row.id, 'linkPreview').catch(() => {}));
  }

  // CHAT 7.4: @mentions (meta.mentions = [userId]) reach people even when they muted the chat, like WhatsApp/Telegram
  const mentioned = new Set(meta && Array.isArray(meta.mentions) ? meta.mentions.map(String) : []);
  const preview = previewText(kind, text, meta).slice(0, 100) || 'New message';
  const isGroupish = convData.kind !== 'dm';
  // Notify all other members in parallel
  await Promise.all(
    otherMembers.map(async (m) => {
      await notifyUser(c.env, m.user_id, {
        type: 'message.new',
        conversationId: convId,
        message: { ...formatted, isMe: false }, // shaped for the recipient
      });
      const isMention = mentioned.has(m.user_id);
      if (!m.muted || isMention) {
        // awaited: an un-awaited inbox insert can be dropped once the response has been sent.
        // data.threadId groups a chat's pushes together on the device (one conversation = one group).
        await sendNotification(c, {
          userId: m.user_id,
          kind: convData.kind === 'group' ? 'group' : 'message',
          title: isGroupish ? (convData.title || 'Group Message') : me.display_name,
          body: isMention ? `${me.display_name} mentioned you: ${preview}` : isGroupish ? `${me.display_name}: ${preview}` : preview,
          data: { conversationId: convId, messageId: row.id, threadId: `chat:${convId}`, ...(isMention ? { mention: true } : {}) },
        });
      }
    })
  );

  return c.json(formatted, 201);
});

// POST /conversations/:id/coins — { coins, note?, toUserId?, clientId? }: gift platform coins to someone in this chat.
// DMs: the other person. Groups: toUserId (a member). The whole amount moves (no platform cut), and the
// debit, credit, both ledger rows and the "🎁 Sent N coins" chat message happen in ONE statement, so a
// failed balance check changes nothing.
conversations.post('/conversations/:id/coins', async (c) => {
  const me = c.get('user');
  const convId = uuidParam(c, 'id');
  const b = await body(c);
  const coins = Number(b.coins);
  if (!Number.isInteger(coins) || coins < 1 || coins > MAX_CHAT_GIFT) throw bad(`Send between 1 and ${MAX_CHAT_GIFT} coins`, 'BAD_AMOUNT');
  const note = str(b.note || '', { max: 200, optional: true, field: 'note' }) || '';
  const clientId = b.clientId ? str(b.clientId, { max: 100 }) : null;

  const conv = await one(c.env, `SELECT c.kind, c.title,
      EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = c.id AND user_id = $2) AS is_member
    FROM conversations c WHERE c.id = $1`, [convId, me.id]);
  if (!conv || !conv.is_member) throw forbidden('Not a member of this conversation');
  if (conv.kind === 'channel') throw bad('Coins can be gifted in private chats and groups', 'NOT_ALLOWED');

  let toId;
  if (conv.kind === 'dm') {
    const other = await one(c.env, 'SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND user_id <> $2 LIMIT 1', [convId, me.id]);
    toId = other && other.user_id;
  } else {
    toId = b.toUserId && /^[0-9a-f-]{36}$/i.test(String(b.toUserId)) ? String(b.toUserId) : null;
    if (toId && !(await one(c.env, 'SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2', [convId, toId]))) toId = null;
  }
  if (!toId || toId === me.id) throw bad('Choose someone in this chat to gift', 'BAD_RECIPIENT');
  const recipient = await one(c.env, 'SELECT id, display_name FROM users WHERE id = $1 AND NOT banned', [toId]);
  if (!recipient) throw notFound('Recipient not found');
  const blocked = await one(c.env, 'SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)', [me.id, toId]);
  if (blocked) throw forbidden('You cannot gift this user', 'BLOCKED');

  // a retried request (same clientId) never charges twice
  if (clientId) {
    const existing = await one(c.env, 'SELECT id FROM messages WHERE conversation_id = $1 AND sender_id = $2 AND client_id = $3', [convId, me.id, clientId]);
    if (existing) {
      const bal = await one(c.env, 'SELECT coins FROM users WHERE id = $1', [me.id]);
      return c.json({ ok: true, duplicate: true, coinsRemaining: bal.coins, message: await loadMessage(c.env, existing.id, me.id) });
    }
  }

  // CHAT LIMITS: a coin gift as the first message of a new 1:1 chat uses a slot too (no slot-free way to start a chat)
  if (conv.kind === 'dm') await useSlotForFirstMessage(c.env, me, convId, toId);
  const text = `🎁 Sent ${coins} coin${coins === 1 ? '' : 's'}${note ? ` — ${note}` : ''}`;
  const meta = { gift: { coins, toUserId: toId, toName: recipient.display_name, note: note || null } };
  const row = await one(c.env,
    `WITH debit AS (
       UPDATE users SET coins = coins - $1 WHERE id = $2 AND coins >= $1 RETURNING coins
     ),
     credit AS (
       UPDATE users SET coins = coins + $1 WHERE id = $3 AND EXISTS (SELECT 1 FROM debit) RETURNING id
     ),
     msg AS (
       INSERT INTO messages (conversation_id, sender_id, kind, body, meta, client_id)
       SELECT $4, $2, 'text', $5, $6::jsonb, $7 WHERE EXISTS (SELECT 1 FROM debit)
       RETURNING id
     ),
     ledger AS (
       INSERT INTO coin_ledger (user_id, amount, reason, ref)
       SELECT $2, -$1::int, 'chat_gift_sent', msg.id::text FROM msg
       UNION ALL
       SELECT $3, $1::int, 'chat_gift_received', msg.id::text FROM msg
     ),
     up_conv AS (
       UPDATE conversations SET last_message_at = now() WHERE id = $4 AND EXISTS (SELECT 1 FROM debit)
     ),
     up_mem AS (
       UPDATE conversation_members SET last_read_at = now() WHERE conversation_id = $4 AND user_id = $2 AND EXISTS (SELECT 1 FROM debit)
     )
     SELECT d.coins AS coins_left, (SELECT id FROM msg) AS message_id FROM debit d`,
    [coins, me.id, toId, convId, text, JSON.stringify(meta), clientId]);
  if (!row) throw new ApiError(402, 'INSUFFICIENT_COINS', 'You do not have enough coins for this gift');

  const message = await loadMessage(c.env, row.message_id, me.id);
  const forThem = await loadMessage(c.env, row.message_id, toId);
  const others = await q(c.env, 'SELECT user_id, muted FROM conversation_members WHERE conversation_id = $1 AND user_id <> $2', [convId, me.id]);
  await Promise.all(others.map(async (m) => {
    await notifyUser(c.env, m.user_id, { type: 'message.new', conversationId: convId, message: m.user_id === toId ? forThem : { ...forThem, isMe: false } });
  }));
  // the receiver's balance updates live (the app's gift.received handler) and they get a push
  await notifyUser(c.env, toId, { type: 'gift.received', from: { id: me.id, displayName: me.display_name }, gift: { name: 'coin gift' }, coins, conversationId: convId });
  await sendNotification(c, {
    userId: toId,
    kind: 'gift',
    title: '🎁 You received coins!',
    body: `${me.display_name} sent you ${coins} coin${coins === 1 ? '' : 's'}${note ? `: “${note.slice(0, 60)}”` : ''}`,
    data: { type: 'chat_gift', conversationId: convId, messageId: row.message_id, fromId: me.id, coins },
  });

  return c.json({ ok: true, coinsRemaining: row.coins_left, coinsGiven: coins, message }, 201);
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
    `UPDATE conversation_members SET muted = NOT (muted AND (muted_until IS NULL OR muted_until > now())), muted_until = NULL
      WHERE conversation_id = $1 AND user_id = $2 RETURNING muted`, // CHAT GAPS: an expired timed mute counts as unmuted
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


// ---------- WhatsApp-style: people search, groups, channels ----------
const cleanIds = (v, me) => [...new Set((Array.isArray(v) ? v : []).map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x) && x !== me))].slice(0, 255);

// GET /people?q= — find believers to message (by name, @handle or church)
conversations.get('/people', async (c) => {
  const me = c.get('user');
  const term = String(c.req.query('q') || '').trim().slice(0, 60);
  const like = '%' + term.replace(/[\\%_]/g, (ch) => '\\' + ch) + '%';
  const rows = await q(c.env, `SELECT ${userJson('u')} AS u,
      EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followee_id = u.id) AS is_following
    FROM users u
    WHERE u.id <> $1 AND NOT u.banned
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = $1))
      AND ($2 = '' OR u.display_name ILIKE $3 OR u.handle ILIKE $3 OR u.church ILIKE $3)
    ORDER BY u.last_seen_at DESC NULLS LAST, u.created_at DESC
    LIMIT 40`, [me.id, term, like]);
  return c.json({ items: rows.map((r) => ({ ...r.u, isFollowing: !!r.is_following })) });
});

// POST /conversations/group — { title, description?, memberIds[] }: you become its owner
conversations.post('/conversations/group', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const title = str(b.title, { min: 1, max: 80, field: 'Group name' });
  const description = str(b.description || '', { max: 500, field: 'Description' });
  const ids = cleanIds(b.memberIds, me.id);
  const conv = await one(c.env, `INSERT INTO conversations (kind, title, description, created_by) VALUES ('group', $1, $2, $3) RETURNING *`, [title, description, me.id]);
  await q(c.env, `INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1, $2, 'owner')`, [conv.id, me.id]);
  // CHAT 7.4: "Grace created the group", then "Grace added Daniel and Ruth" (members remember who added them)
  await systemMessage(c.env, conv.id, me.id, `${me.display_name} created the group “${title}”`, { action: 'created' });
  if (ids.length) await addMembersTo(c, conv.id, me, ids, { sendPush: (n) => sendNotification(c, n) });
  return c.json({ id: conv.id, kind: 'group', title }, 201);
});

// POST /conversations/:id/members — { userIds[] }: admins add people (or every member when the group allows it)
conversations.post('/conversations/:id/members', async (c) => {
  const me = c.get('user');
  const convId = uuidParam(c, 'id');
  const mine = await one(c.env, `SELECT m.role, c.kind FROM conversation_members m JOIN conversations c ON c.id = m.conversation_id WHERE m.conversation_id = $1 AND m.user_id = $2`, [convId, me.id]);
  if (!mine || mine.kind !== 'group') throw forbidden('Only group admins can add people', 'ADMIN_ONLY');
  const ctx = await groupContext(c.env, convId, me.id);
  if (!permissionsFor(ctx).canAddMembers) throw forbidden('Only group admins can add people', 'ADMIN_ONLY');
  const ids = cleanIds((await body(c)).userIds, me.id);
  const added = await addMembersTo(c, convId, me, ids, { sendPush: (n) => sendNotification(c, n) });
  return c.json({ added: added.length, members: added });
});

// POST /conversations/:id/leave — leave a group or unfollow a channel
conversations.post('/conversations/:id/leave', async (c) => {
  const me = c.get('user');
  const convId = uuidParam(c, 'id');
  const conv = await one(c.env, 'SELECT kind FROM conversations WHERE id = $1', [convId]);
  if (!conv || conv.kind === 'dm') throw bad('Only groups and channels can be left');
  const left = await one(c.env, 'DELETE FROM conversation_members WHERE conversation_id = $1 AND user_id = $2 RETURNING role', [convId, me.id]);
  // a group or channel never keeps zero owners
  await q(c.env, `UPDATE conversation_members SET role = 'owner' WHERE conversation_id = $1 AND user_id = (
      SELECT user_id FROM conversation_members WHERE conversation_id = $1 ORDER BY (role = 'admin') DESC, (role = 'moderator') DESC, joined_at LIMIT 1)
    AND NOT EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND role = 'owner')`, [convId]);
  // CHAT 7.4: "Paul left" (groups only — channel followers come and go quietly)
  if (left && conv.kind === 'group') await systemMessage(c.env, convId, me.id, `${me.display_name} left`, { action: 'left' });
  return c.json({ ok: true });
});

// POST /channels — { title, description? }: a broadcast channel; only its admins post, anyone can follow
conversations.post('/channels', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const title = str(b.title, { min: 1, max: 80, field: 'Channel name' });
  const description = str(b.description || '', { max: 500, field: 'Description' });
  const conv = await one(c.env, `INSERT INTO conversations (kind, title, description, created_by, is_public) VALUES ('channel', $1, $2, $3, true) RETURNING *`, [title, description, me.id]);
  await q(c.env, `INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1, $2, 'owner')`, [conv.id, me.id]);
  return c.json({ id: conv.id, kind: 'channel', title }, 201);
});

// GET /channels?q= — public channels to follow
conversations.get('/channels', async (c) => {
  const me = c.get('user');
  const term = String(c.req.query('q') || '').trim().slice(0, 60);
  const like = '%' + term.replace(/[\\%_]/g, (ch) => '\\' + ch) + '%';
  const rows = await q(c.env, `SELECT c.id, c.title, c.description, c.last_message_at,
      (SELECT COUNT(*)::int FROM conversation_members m WHERE m.conversation_id = c.id) AS followers,
      EXISTS (SELECT 1 FROM conversation_members m WHERE m.conversation_id = c.id AND m.user_id = $1) AS following
    FROM conversations c
    WHERE c.kind = 'channel' AND c.is_public AND ($2 = '' OR c.title ILIKE $3 OR c.description ILIKE $3)
    ORDER BY followers DESC, c.last_message_at DESC LIMIT 50`, [me.id, term, like]);
  return c.json({ items: rows.map((r) => ({ id: r.id, title: r.title, description: r.description || '', followers: r.followers, following: !!r.following, lastMessageAt: new Date(r.last_message_at).toISOString() })) });
});

// POST /channels/:id/follow — join a public channel as a reader
conversations.post('/channels/:id/follow', async (c) => {
  const me = c.get('user');
  const convId = uuidParam(c, 'id');
  const conv = await one(c.env, `SELECT id FROM conversations WHERE id = $1 AND kind = 'channel' AND is_public`, [convId]);
  if (!conv) throw notFound('Channel not found');
  await q(c.env, `INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`, [convId, me.id]);
  return c.json({ following: true });
});

export default conversations;
