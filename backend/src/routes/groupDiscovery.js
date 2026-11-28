// PACKAGE F — Search groups (chats), group listing settings, join, and the chat-list actions (pin, remove from my
// list, delete group). Rules: lib/groupListing.js. Membership sections are never listed, joined here, pinned, hidden
// or deleted from the chat list.
//   GET    /groups/search?q=&category=&country=&city=&church=   → listed groups (name, picture, description, place, members)
//   PATCH  /conversations/:id/listing     { listed, visibility, category, country, city, churchName }  (owner/admin)
//   POST   /conversations/:id/join                               → { status: member | requested }
//   POST   /conversations/:id/pin         { pinned }             → my list (any member)
//   POST   /conversations/:id/hide                               → remove from my list (members, not the owner)
//   DELETE /conversations/:id                                     → delete a group for everyone (owner/admin)
import { Hono } from 'hono';
import { body, uuidParam, bad, notFound, forbidden } from '../lib/http.js';
import { q, one } from '../lib/db.js';
import { mediaUrl } from '../lib/shape.js';
import { notifyUser } from '../hub.js';
import { sendNotification } from '../lib/push.js';
import { systemMessage, RANK } from '../lib/chatGroups.js';
import {
  GROUP_CATEGORIES, listingInput, listingShape, joinPath, visibilityOf, listedFor, assertCanDeleteGroup, assertListAction, likePattern,
} from '../lib/groupListing.js';

const groupDiscovery = new Hono();
const origin = (c) => new URL(c.req.url).origin;

async function groupRow(env, convId) {
  return one(env, 'SELECT * FROM conversations WHERE id = $1', [convId]);
}

async function myRole(env, convId, userId) {
  const r = await one(env, 'SELECT role FROM conversation_members WHERE conversation_id = $1 AND user_id = $2', [convId, userId]);
  return r ? r.role : null;
}

// PERSONALISATION: without a search text, groups near the viewer (same country, city or church) come first, then the
// biggest. Interests are not used here: group categories are not the same vocabulary as the topics.
const LOCAL_FIRST = `(COALESCE(c.country = (SELECT u.country FROM users u WHERE u.id = $1) AND c.country <> '', false)::int * 2
  + COALESCE(c.city = (SELECT u.city FROM users u WHERE u.id = $1) AND c.city <> '', false)::int
  + COALESCE(c.church_name = (SELECT u.church FROM users u WHERE u.id = $1) AND c.church_name <> '', false)::int) DESC, `;

// GET /groups/search — public-facing search over groups whose admins listed them (never membership sections)
groupDiscovery.get('/groups/search', async (c) => {
  const me = c.get('user');
  const text = String(c.req.query('q') || '').trim().slice(0, 60);
  const category = String(c.req.query('category') || '').trim().slice(0, 40);
  const country = String(c.req.query('country') || '').trim().slice(0, 60);
  const city = String(c.req.query('city') || '').trim().slice(0, 60);
  const church = String(c.req.query('church') || '').trim().slice(0, 80);
  if (category && !GROUP_CATEGORIES.includes(category)) throw bad('Choose a category from the list', 'BAD_CATEGORY');

  const params = [me.id];
  const where = [
    `c.kind = 'group'`, `c.listed`, `c.membership_id IS NULL`,
    `NOT EXISTS (SELECT 1 FROM conversation_bans b WHERE b.conversation_id = c.id AND b.user_id = $1)`,
  ];
  // each "?" in the clause gets the same bound value
  const add = (sql, value) => { params.push(value); where.push(sql.replace(/\?/g, `$${params.length}`)); };
  if (text) add('(c.title ILIKE ? OR c.description ILIKE ? OR c.category ILIKE ? OR c.city ILIKE ? OR c.country ILIKE ? OR c.church_name ILIKE ?)', likePattern(text));
  if (category) add(`c.category = ?`, category);
  if (country) add(`c.country ILIKE ?`, likePattern(country));
  if (city) add(`c.city ILIKE ?`, likePattern(city));
  if (church) add(`c.church_name ILIKE ?`, likePattern(church));

  const rows = await q(c.env, `SELECT c.id, c.title, c.description, c.avatar_key, c.category, c.country, c.city, c.church_name,
        c.settings, c.listed,
        (SELECT COUNT(*)::int FROM conversation_members cm WHERE cm.conversation_id = c.id) AS members_count,
        m.role AS my_role,
        EXISTS (SELECT 1 FROM conversation_join_requests jr WHERE jr.conversation_id = c.id AND jr.user_id = $1 AND jr.status = 'pending') AS my_request
      FROM conversations c
      LEFT JOIN conversation_members m ON m.conversation_id = c.id AND m.user_id = $1
      WHERE ${where.join(' AND ')}
      ORDER BY (m.role IS NOT NULL) DESC, ${text ? '' : LOCAL_FIRST}members_count DESC, c.created_at DESC
      LIMIT 40`, params);

  return c.json({
    items: rows.map((r) => ({
      id: r.id,
      name: r.title || 'Group',
      description: r.description || '',
      avatarUrl: r.avatar_key ? mediaUrl(c.env, origin(c), r.avatar_key) : null,
      category: r.category || null,
      country: r.country || null,
      city: r.city || null,
      churchName: r.church_name || null,
      membersCount: r.members_count,
      visibility: visibilityOf(r),
      joinPath: joinPath(r),
      myRole: r.my_role || null,
      joined: !!r.my_role,
      requested: !!r.my_request,
    })),
  });
});

// PATCH /conversations/:id/listing — group admins decide whether the group is searchable and how it is described
groupDiscovery.patch('/conversations/:id/listing', async (c) => {
  const me = c.get('user');
  const convId = uuidParam(c, 'id');
  const conv = await groupRow(c.env, convId);
  if (!conv) throw notFound('Group not found');
  const role = await myRole(c.env, convId, me.id);
  if (!role) throw forbidden('Not a member of this group');
  if (conv.kind !== 'group' || conv.membership_id) throw bad('Only groups can be listed', 'NOT_A_GROUP');
  if (RANK[role] < RANK.admin) throw forbidden('Only group admins can change this', 'ADMIN_ONLY');
  const input = listingInput(await body(c));
  const settings = { ...(typeof conv.settings === 'string' ? JSON.parse(conv.settings) : conv.settings || {}) };
  if (input.visibility) settings.visibility = input.visibility;
  // Choosing public lists the group by default (unless listed is sent too); admins can unlist it afterwards
  if (input.listed === undefined && input.visibility && input.visibility !== visibilityOf(conv) && listedFor(input.visibility)) input.listed = true;
  const updated = await one(c.env, `UPDATE conversations SET
      listed = COALESCE($2, listed),
      category = CASE WHEN $3::boolean THEN $4 ELSE category END,
      country = CASE WHEN $5::boolean THEN $6 ELSE country END,
      city = CASE WHEN $7::boolean THEN $8 ELSE city END,
      church_name = CASE WHEN $9::boolean THEN $10 ELSE church_name END,
      settings = $11::jsonb
    WHERE id = $1 RETURNING *`, [
    convId,
    input.listed ?? null,
    'category' in input, input.category ?? null,
    'country' in input, input.country ?? null,
    'city' in input, input.city ?? null,
    'churchName' in input, input.churchName ?? null,
    JSON.stringify(settings),
  ]);
  return c.json({ id: convId, listing: listingShape(updated) });
});

// POST /conversations/:id/join — a listed group: join straight away, or ask (private, or the group asks for approval)
groupDiscovery.post('/conversations/:id/join', async (c) => {
  const me = c.get('user');
  const convId = uuidParam(c, 'id');
  const conv = await groupRow(c.env, convId);
  if (!conv || conv.kind !== 'group' || conv.membership_id || !conv.listed) throw notFound('Group not found');
  if (await myRole(c.env, convId, me.id)) return c.json({ status: 'member', conversationId: convId });
  if (await one(c.env, 'SELECT 1 FROM conversation_bans WHERE conversation_id = $1 AND user_id = $2', [convId, me.id])) {
    throw forbidden('An admin removed you from this group, so you can’t join it again', 'BANNED');
  }
  const blocked = await one(c.env, `SELECT 1 FROM conversation_members m JOIN blocks b ON (b.blocker_id = m.user_id AND b.blocked_id = $2)
    WHERE m.conversation_id = $1 AND m.role IN ('owner','admin') LIMIT 1`, [convId, me.id]);
  if (blocked) throw forbidden('You can’t join this group', 'BLOCKED');

  if (joinPath(conv) === 'request') {
    await q(c.env, `INSERT INTO conversation_join_requests (conversation_id, user_id) VALUES ($1, $2)
      ON CONFLICT (conversation_id, user_id) DO UPDATE SET status = 'pending', created_at = now(), decided_by = NULL`, [convId, me.id]);
    const mods = await q(c.env, `SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND role IN ('owner','admin','moderator')`, [convId]);
    for (const m of mods) {
      await notifyUser(c.env, m.user_id, { type: 'group.joinRequest', conversationId: convId, userId: me.id }).catch(() => {});
      await sendNotification(c, { userId: m.user_id, kind: 'group', title: conv.title || 'Group', body: `${me.display_name} asked to join`, data: { conversationId: convId, threadId: `chat:${convId}`, joinRequest: true } }).catch(() => {});
    }
    return c.json({ status: 'requested', conversationId: convId }, 202);
  }
  await q(c.env, `INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`, [convId, me.id]);
  await systemMessage(c.env, convId, me.id, `${me.display_name} joined the group`, { action: 'joined' });
  return c.json({ status: 'member', conversationId: convId }, 201);
});

// POST /conversations/:id/pin — { pinned } pins the chat to the top of my list (only for me)
groupDiscovery.post('/conversations/:id/pin', async (c) => {
  const me = c.get('user');
  const convId = uuidParam(c, 'id');
  const conv = await groupRow(c.env, convId);
  const role = await myRole(c.env, convId, me.id);
  assertListAction(conv, role, 'pin');
  const b = await body(c).catch(() => ({}));
  const pinned = b.pinned !== false;
  await q(c.env, 'UPDATE conversation_members SET pinned_at = $3 WHERE conversation_id = $1 AND user_id = $2', [convId, me.id, pinned ? new Date().toISOString() : null]);
  return c.json({ id: convId, pinned });
});

// POST /conversations/:id/hide — remove a group from my list only. It comes back when someone posts there.
groupDiscovery.post('/conversations/:id/hide', async (c) => {
  const me = c.get('user');
  const convId = uuidParam(c, 'id');
  const conv = await groupRow(c.env, convId);
  const role = await myRole(c.env, convId, me.id);
  assertListAction(conv, role, 'hide');
  await q(c.env, 'UPDATE conversation_members SET hidden_at = now() WHERE conversation_id = $1 AND user_id = $2', [convId, me.id]);
  return c.json({ id: convId, hidden: true });
});

// DELETE /conversations/:id — the owner or an admin deletes a group for everyone; members are told and it leaves their lists
groupDiscovery.delete('/conversations/:id', async (c) => {
  const me = c.get('user');
  const convId = uuidParam(c, 'id');
  const conv = await groupRow(c.env, convId);
  if (!conv) throw notFound('Group not found');
  const role = await myRole(c.env, convId, me.id);
  if (!role) throw forbidden('Not a member of this group');
  assertCanDeleteGroup(conv, role);
  const others = await q(c.env, 'SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND user_id <> $2', [convId, me.id]);
  await q(c.env, 'DELETE FROM conversations WHERE id = $1', [convId]);
  for (const m of others) {
    await notifyUser(c.env, m.user_id, { type: 'group.deleted', conversationId: convId }).catch(() => {});
  }
  return c.json({ ok: true, id: convId });
});

export default groupDiscovery;
