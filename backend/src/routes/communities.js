// Communities and group channels routes
import { Hono } from 'hono';
import { body, str, uuidParam, bad, notFound, forbidden } from '../lib/http.js';
import { q, one } from '../lib/db.js';
import { userJson } from '../lib/shape.js';
import { notifyUser } from '../hub.js';
import { sendNotification } from '../lib/push.js';

const communities = new Hono();

const DEFAULT_CHANNELS = ['General', 'Prayer', 'Bible Study', 'Announcements', 'Events'];

// GET /communities — list and search communities
communities.get('/communities', async (c) => {
  const me = c.get('user');
  const query = c.req.query('q')?.trim() || '';
  let rows;
  if (query) {
    rows = await q(c.env,
      `SELECT c.*,
              (SELECT status FROM community_members cm WHERE cm.community_id = c.id AND cm.user_id = $1) AS my_status,
              (SELECT role FROM community_members cm WHERE cm.community_id = c.id AND cm.user_id = $1) AS my_role
       FROM communities c
       WHERE (c.name ILIKE $2 OR c.description ILIKE $2)
       ORDER BY c.members_count DESC, c.created_at DESC LIMIT 50`,
      [me.id, `%${query}%`]
    );
  } else {
    rows = await q(c.env,
      `SELECT c.*,
              (SELECT status FROM community_members cm WHERE cm.community_id = c.id AND cm.user_id = $1) AS my_status,
              (SELECT role FROM community_members cm WHERE cm.community_id = c.id AND cm.user_id = $1) AS my_role
       FROM communities c
       ORDER BY c.members_count DESC, c.created_at DESC LIMIT 50`,
      [me.id]
    );
  }

  // ROUND 4: channels ride along so the app can open group chats without another request
  const ids = rows.map((r) => r.id);
  const chRows = ids.length
    ? await q(c.env, `SELECT id, community_id, name, conversation_id FROM community_channels WHERE community_id = ANY($1::uuid[]) ORDER BY position ASC`, [ids])
    : [];
  const chBy = new Map();
  for (const ch of chRows) {
    if (!chBy.has(ch.community_id)) chBy.set(ch.community_id, []);
    chBy.get(ch.community_id).push({ id: ch.id, name: ch.name, conversationId: ch.conversation_id });
  }

  return c.json({
    items: rows.map((r) => ({
      channels: chBy.get(r.id) || [],
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      privacy: r.privacy,
      avatarKey: r.avatar_key,
      ownerId: r.owner_id,
      membersCount: r.members_count,
      createdAt: new Date(r.created_at).toISOString(),
      myStatus: r.my_status || null,
      myRole: r.my_role || null,
    })),
  });
});

// POST /communities — create a new community with default channels
communities.post('/communities', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const name = str(b.name, { min: 2, max: 100, field: 'name' });
  let slug = str(b.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''), { min: 2, max: 100, field: 'slug' });
  const description = str(b.description || '', { max: 2000, optional: true }) || '';
  const privacy = b.privacy === 'Private' ? 'Private' : 'Public';
  const avatarKey = b.avatarKey ? str(b.avatarKey, { max: 500 }) : null;

  // Ensure slug uniqueness
  const slugExists = await one(c.env, `SELECT 1 FROM communities WHERE slug = $1`, [slug]);
  if (slugExists) slug = `${slug}-${Math.floor(Math.random() * 10000)}`;

  // Insert community
  const comm = await one(c.env,
    `INSERT INTO communities (name, slug, description, privacy, avatar_key, owner_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [name, slug, description, privacy, avatarKey, me.id]
  );

  // Add owner to members
  await q(c.env,
    `INSERT INTO community_members (community_id, user_id, role, status)
     VALUES ($1, $2, 'owner', 'member')`,
    [comm.id, me.id]
  );

  // Create default channels backed by group conversations
  const channels = [];
  for (let i = 0; i < DEFAULT_CHANNELS.length; i++) {
    const chName = DEFAULT_CHANNELS[i];
    const conv = await one(c.env,
      `INSERT INTO conversations (kind, title) VALUES ('group', $1) RETURNING *`,
      [`${name} - ${chName}`]
    );
    await q(c.env,
      `INSERT INTO conversation_members (conversation_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [conv.id, me.id]
    );
    const channelRow = await one(c.env,
      `INSERT INTO community_channels (community_id, name, conversation_id, position)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [comm.id, chName, conv.id, i]
    );
    channels.push({ id: channelRow.id, name: chName, conversationId: conv.id });
  }

  return c.json({
    id: comm.id,
    name: comm.name,
    slug: comm.slug,
    description: comm.description,
    privacy: comm.privacy,
    avatarKey: comm.avatar_key,
    ownerId: comm.owner_id,
    membersCount: 1,
    channels,
    myStatus: 'member',
    myRole: 'owner',
  }, 201);
});

// GET /communities/:id — community details + channels
communities.get('/communities/:id', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c, 'id');
  const comm = await one(c.env,
    `SELECT c.*,
            (SELECT status FROM community_members cm WHERE cm.community_id = c.id AND cm.user_id = $1) AS my_status,
            (SELECT role FROM community_members cm WHERE cm.community_id = c.id AND cm.user_id = $1) AS my_role
     FROM communities c WHERE c.id = $1`,
    [me.id, id]
  );
  if (!comm) throw notFound('Community not found');

  const channels = await q(c.env,
    `SELECT id, name, conversation_id, position FROM community_channels
     WHERE community_id = $1 ORDER BY position ASC`,
    [id]
  );

  return c.json({
    id: comm.id,
    name: comm.name,
    slug: comm.slug,
    description: comm.description,
    privacy: comm.privacy,
    avatarKey: comm.avatar_key,
    ownerId: comm.owner_id,
    membersCount: comm.members_count,
    createdAt: new Date(comm.created_at).toISOString(),
    myStatus: comm.my_status || null,
    myRole: comm.my_role || null,
    channels: channels.map((ch) => ({ id: ch.id, name: ch.name, conversationId: ch.conversation_id })),
  });
});

// POST /communities/:id/join — join or request to join
communities.post('/communities/:id/join', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c, 'id');
  const comm = await one(c.env, `SELECT * FROM communities WHERE id = $1`, [id]);
  if (!comm) throw notFound('Community not found');

  const existing = await one(c.env, `SELECT * FROM community_members WHERE community_id = $1 AND user_id = $2`, [id, me.id]);
  if (existing?.status === 'banned') throw forbidden('You have been banned from this community');
  if (existing?.status === 'member') return c.json({ ok: true, status: 'member' });

  const status = comm.privacy === 'Private' ? 'requested' : 'member';
  await q(c.env,
    `INSERT INTO community_members (community_id, user_id, role, status)
     VALUES ($1, $2, 'member', $3)
     ON CONFLICT (community_id, user_id) DO UPDATE SET status = $3`,
    [id, me.id, status]
  );

  if (status === 'member') {
    // Add user to all channels in the community
    const channels = await q(c.env, `SELECT conversation_id FROM community_channels WHERE community_id = $1`, [id]);
    for (const ch of channels) {
      await q(c.env,
        `INSERT INTO conversation_members (conversation_id, user_id, role)
         VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
        [ch.conversation_id, me.id]
      );
    }
    await q(c.env, `UPDATE communities SET members_count = members_count + 1 WHERE id = $1`, [id]);
  } else {
    // Notify community owner/admins about request
    await notifyUser(c.env, comm.owner_id, { type: 'community.request', communityId: id, user: { id: me.id, displayName: me.display_name } });
    sendNotification(c, {
      userId: comm.owner_id,
      kind: 'group',
      title: 'Community Join Request',
      body: `${me.display_name} requested to join ${comm.name}.`,
      data: { communityId: id, userId: me.id },
    });
  }

  return c.json({ ok: true, status });
});

// POST /communities/:id/leave — leave community
communities.post('/communities/:id/leave', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c, 'id');
  const mem = await one(c.env, `SELECT * FROM community_members WHERE community_id = $1 AND user_id = $2`, [id, me.id]);
  if (!mem || mem.status !== 'member') return c.json({ ok: true });
  if (mem.role === 'owner') throw bad('Owner cannot leave the community. Transfer ownership first.');

  await q(c.env, `DELETE FROM community_members WHERE community_id = $1 AND user_id = $2`, [id, me.id]);
  const channels = await q(c.env, `SELECT conversation_id FROM community_channels WHERE community_id = $1`, [id]);
  for (const ch of channels) {
    await q(c.env, `DELETE FROM conversation_members WHERE conversation_id = $1 AND user_id = $2`, [ch.conversation_id, me.id]);
  }
  await q(c.env, `UPDATE communities SET members_count = GREATEST(0, members_count - 1) WHERE id = $1`, [id]);
  return c.json({ ok: true });
});

// GET /communities/:id/members — list members
communities.get('/communities/:id/members', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c, 'id');
  const rows = await q(c.env,
    `SELECT cm.role, cm.status, cm.joined_at, ${userJson('u')} AS user
     FROM community_members cm
     JOIN users u ON u.id = cm.user_id
     WHERE cm.community_id = $1
     ORDER BY CASE cm.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, cm.joined_at ASC`,
    [id]
  );
  return c.json({
    items: rows.map((r) => ({
      role: r.role,
      status: r.status,
      joinedAt: new Date(r.joined_at).toISOString(),
      user: typeof r.user === 'string' ? JSON.parse(r.user) : r.user,
    })),
  });
});

// POST /communities/:id/members/:userId — admin approval/role change
communities.post('/communities/:id/members/:userId', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c, 'id');
  const targetUserId = uuidParam(c, 'userId');
  const b = await body(c);

  // Verify caller is admin or owner
  const myMem = await one(c.env, `SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2 AND status = 'member'`, [id, me.id]);
  if (!myMem || !['owner', 'admin'].includes(myMem.role)) throw forbidden('Admin access required');

  const action = b.action; // 'approve' | 'decline' | 'promote' | 'demote' | 'ban' | 'remove'
  if (!action) throw bad('Action required');

  if (action === 'approve') {
    await q(c.env, `UPDATE community_members SET status = 'member' WHERE community_id = $1 AND user_id = $2`, [id, targetUserId]);
    const channels = await q(c.env, `SELECT conversation_id FROM community_channels WHERE community_id = $1`, [id]);
    for (const ch of channels) {
      await q(c.env,
        `INSERT INTO conversation_members (conversation_id, user_id, role)
         VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
        [ch.conversation_id, targetUserId]
      );
    }
    await q(c.env, `UPDATE communities SET members_count = members_count + 1 WHERE id = $1`, [id]);
    await notifyUser(c.env, targetUserId, { type: 'community.approved', communityId: id });
    return c.json({ ok: true, status: 'member' });
  }

  if (action === 'decline' || action === 'remove') {
    await q(c.env, `DELETE FROM community_members WHERE community_id = $1 AND user_id = $2`, [id, targetUserId]);
    const channels = await q(c.env, `SELECT conversation_id FROM community_channels WHERE community_id = $1`, [id]);
    for (const ch of channels) {
      await q(c.env, `DELETE FROM conversation_members WHERE conversation_id = $1 AND user_id = $2`, [ch.conversation_id, targetUserId]);
    }
    await q(c.env, `UPDATE communities SET members_count = GREATEST(0, members_count - 1) WHERE id = $1`, [id]);
    return c.json({ ok: true });
  }

  if (action === 'promote' && myMem.role === 'owner') {
    await q(c.env, `UPDATE community_members SET role = 'admin' WHERE community_id = $1 AND user_id = $2`, [id, targetUserId]);
    return c.json({ ok: true, role: 'admin' });
  }

  if (action === 'demote' && myMem.role === 'owner') {
    await q(c.env, `UPDATE community_members SET role = 'member' WHERE community_id = $1 AND user_id = $2`, [id, targetUserId]);
    return c.json({ ok: true, role: 'member' });
  }

  throw bad('Invalid action');
});

// POST /communities/:id/pin — pin a message in a channel
communities.post('/communities/:id/pin', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c, 'id');
  const b = await body(c);
  const myMem = await one(c.env, `SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2 AND status = 'member'`, [id, me.id]);
  if (!myMem || !['owner', 'admin'].includes(myMem.role)) throw forbidden('Admin access required');

  const convId = b.conversationId;
  const messageId = b.messageId || null;
  // the conversation must be one of this community's channels
  const ch = await one(c.env, `SELECT 1 FROM community_channels WHERE community_id = $1 AND conversation_id = $2`, [id, convId]);
  if (!ch) throw notFound('Channel not found');
  if (messageId) {
    const msg = await one(c.env, `SELECT 1 FROM messages WHERE id = $1 AND conversation_id = $2 AND deleted = false`, [messageId, convId]);
    if (!msg) throw notFound('Message not found');
    await q(c.env, `INSERT INTO conversation_pins (conversation_id, message_id, pinned_by) VALUES ($1, $2, $3)
                    ON CONFLICT (conversation_id, message_id) DO UPDATE SET pinned_at = now()`, [convId, messageId, me.id]);
  } else {
    await q(c.env, `DELETE FROM conversation_pins WHERE conversation_id = $1`, [convId]);
  }
  await q(c.env, `UPDATE conversations SET pinned_message_id = $1 WHERE id = $2`, [messageId, convId]);
  return c.json({ ok: true, pinnedMessageId: messageId });
});

export default communities;
