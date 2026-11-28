// CHAT 7.3 / 7.4 — Group Info, member management, permissions, invite links, join requests, shared media,
// files in chat, forwarding, typing, presence / last-seen privacy and message search.
// Every permission is checked here on the server (lib/chatGroups.js `permissionsFor`).
import { Hono } from 'hono';
import { ApiError, body, str, uuidParam, bad, notFound, forbidden, isUuid } from '../lib/http.js';
import { q, one } from '../lib/db.js';
import { userJson, mediaUrl } from '../lib/shape.js';
import { notifyUser } from '../hub.js';
import { sendNotification } from '../lib/push.js';
import { loadMessage } from '../lib/messages.js';
import {
  RANK, ROLES, SLOW_MODE_STEPS, groupContext, permissionsFor, outranks, systemMessage, settingsOf, addMembersTo,
  touchPresence, presenceShape, fileCategory, URL_RE, extOf,
} from '../lib/chatGroups.js';
import { streamObject } from '../lib/library.js';
import { LIBRARY_VIEWER_HTML } from '../lib/libraryViewer.js';
import { MUTE_DURATIONS, mutedSql, muteShape } from '../lib/chatMute.js'; // CHAT GAPS: timed mute
import { previewsFor, firstLinkUrl } from '../lib/linkPreviews.js'; // CHAT GAPS: link cards in the Links tab
import { groupInviteUrl } from './chatGaps.js'; // CHAT GAPS: /g/<code> landing page that opens the app
import { historyHiddenSql } from '../lib/messages.js'; // MEMBERSHIP GROUPS: "history from join time" for new members
import { membershipSendGuard, pushPlan, shareToExecutive } from '../lib/membershipGroups.js'; // MEMBERSHIP GROUPS: forwards into MASTER CLASS follow the publish rule
import { membershipInvitePreview, membershipInviteJoin } from '../lib/memberships.js'; // MEMBERSHIP GROUPS: invite links grant access the membership way
import { listingShape } from '../lib/groupListing.js'; // PACKAGE F: group search listing (category, place, church, public/private)

const chatGroups = new Hono();
const parse = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);
const NEW_MEMBER_DAYS = 7;
const origin = (c) => new URL(c.req.url).origin;

function groupOnly(ctx) {
  if (ctx.conv.kind !== 'group') throw bad('This only works in groups', 'GROUP_ONLY');
}

async function infoShape(c, ctx, meId) {
  const { conv } = ctx;
  const perms = permissionsFor(ctx);
  const [counts, admins, invite, pending, bans] = await Promise.all([
    one(c.env, 'SELECT COUNT(*)::int AS n FROM conversation_members WHERE conversation_id = $1', [conv.id]),
    q(c.env, `SELECT m.role, ${userJson('u')} AS u FROM conversation_members m JOIN users u ON u.id = m.user_id
       WHERE m.conversation_id = $1 AND m.role IN ('owner','admin','moderator')
       ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.display_name`, [conv.id]),
    perms.canInvite ? one(c.env, 'SELECT code FROM conversation_invites WHERE conversation_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1', [conv.id]) : null,
    perms.canApproveJoins ? one(c.env, `SELECT COUNT(*)::int AS n FROM conversation_join_requests WHERE conversation_id = $1 AND status = 'pending'`, [conv.id]) : null,
    perms.canRemoveMembers ? one(c.env, 'SELECT COUNT(*)::int AS n FROM conversation_bans WHERE conversation_id = $1', [conv.id]) : null, // CHAT GAPS
  ]);
  let other = null;
  if (conv.kind === 'dm') {
    const r = await one(c.env, `SELECT ${userJson('u')} AS u, u.presence_at, u.last_seen_visibility FROM conversation_members m JOIN users u ON u.id = m.user_id
      WHERE m.conversation_id = $1 AND m.user_id <> $2 LIMIT 1`, [conv.id, meId]);
    const mine = await one(c.env, 'SELECT last_seen_visibility FROM users WHERE id = $1', [meId]);
    if (r) other = { ...parse(r.u), presence: presenceShape(r, mine && mine.last_seen_visibility) };
  }
  return {
    id: conv.id,
    kind: conv.kind,
    title: conv.title || (other ? other.displayName : 'Conversation'),
    description: conv.description || '',
    avatarKey: conv.avatar_key || null,
    avatarUrl: conv.avatar_key ? mediaUrl(c.env, origin(c), conv.avatar_key) : null,
    createdAt: new Date(conv.created_at).toISOString(),
    createdBy: conv.created_by || null,
    membersCount: counts ? counts.n : 0,
    // MEMBERSHIP GROUPS: the section of a membership group (MASTER CLASS / EXECUTIVE CLASS), null for other chats
    membershipId: conv.membership_id || null,
    membershipSection: conv.membership_id ? (conv.kind === 'channel' ? 'master' : 'executive') : null,
    myRole: ctx.role,
    ...muteShape(conv.my_muted, conv.my_muted_until), // CHAT GAPS: { muted, mutedUntil } (null = always)
    bannedCount: bans ? bans.n : 0, // CHAT GAPS: admins see "Banned (n)"
    listing: conv.kind === 'group' && !conv.membership_id ? listingShape(conv) : null, // PACKAGE F: Search groups fields
    settings: ctx.settings,
    permissions: perms,
    admins: admins.map((a) => ({ ...parse(a.u), role: a.role })),
    inviteCode: invite ? invite.code : null,
    pendingRequests: pending ? pending.n : 0,
    otherUser: other,
  };
}

// GET /conversations/:id/info — Group Info / contact info header data
chatGroups.get('/conversations/:id/info', async (c) => {
  const me = c.get('user');
  const ctx = await groupContext(c.env, uuidParam(c, 'id'), me.id);
  return c.json(await infoShape(c, ctx, me.id));
});

// PATCH /conversations/:id — { title?, description?, avatarKey? } (admins, or everyone when "edit info: all members")
chatGroups.patch('/conversations/:id', async (c) => {
  const me = c.get('user');
  const convId = uuidParam(c, 'id');
  const ctx = await groupContext(c.env, convId, me.id);
  if (!permissionsFor(ctx).canEditInfo) throw forbidden('Only admins can edit the group info', 'ADMIN_ONLY');
  const b = await body(c);
  const changes = [];
  const sets = [];
  const vals = [convId];
  if (b.title !== undefined) {
    const title = str(b.title, { min: 1, max: 80, field: 'Group name' }).trim();
    if (!title) throw bad('Group name is required');
    if (title !== ctx.conv.title) { vals.push(title); sets.push(`title = $${vals.length}`); changes.push(`changed the group name to “${title}”`); }
  }
  if (b.description !== undefined) {
    const description = str(b.description || '', { max: 500, field: 'Description' });
    if (description !== (ctx.conv.description || '')) { vals.push(description); sets.push(`description = $${vals.length}`); changes.push('changed the group description'); }
  }
  if (b.avatarKey !== undefined) {
    const key = b.avatarKey ? str(b.avatarKey, { max: 300 }) : null;
    // a public image the caller uploaded (POST /uploads/image) or nothing
    if (key && !(key.startsWith(`img/${me.id}/`) && /^[\w./-]+$/.test(key) && !key.includes('..'))) throw bad('Upload the photo first', 'BAD_MEDIA');
    vals.push(key); sets.push(`avatar_key = $${vals.length}`); changes.push(key ? 'changed the group photo' : 'removed the group photo');
  }
  if (sets.length) {
    await q(c.env, `UPDATE conversations SET ${sets.join(', ')} WHERE id = $1`, vals);
    for (const ch of changes) await systemMessage(c.env, convId, me.id, `${me.display_name} ${ch}`, { action: 'info' });
  }
  return c.json(await infoShape(c, await groupContext(c.env, convId, me.id), me.id));
});

// PATCH /conversations/:id/settings — { sendMessages, addMembers, editInfo, approveJoins, slowModeSec } (admins)
chatGroups.patch('/conversations/:id/settings', async (c) => {
  const me = c.get('user');
  const convId = uuidParam(c, 'id');
  const ctx = await groupContext(c.env, convId, me.id);
  groupOnly(ctx);
  if (!permissionsFor(ctx).canChangeSettings) throw forbidden('Only admins can change group settings', 'ADMIN_ONLY');
  const b = await body(c);
  const next = { ...ctx.settings };
  const said = [];
  if (b.sendMessages !== undefined) {
    if (!['all', 'admins'].includes(b.sendMessages)) throw bad('sendMessages is all or admins');
    if (b.sendMessages !== next.sendMessages) said.push(b.sendMessages === 'admins' ? 'allowed only admins to send messages' : 'allowed all members to send messages');
    next.sendMessages = b.sendMessages;
  }
  if (b.addMembers !== undefined) {
    if (!['all', 'admins'].includes(b.addMembers)) throw bad('addMembers is all or admins');
    if (b.addMembers !== next.addMembers) said.push(b.addMembers === 'admins' ? 'allowed only admins to add members' : 'allowed all members to add others');
    next.addMembers = b.addMembers;
  }
  if (b.editInfo !== undefined) {
    if (!['all', 'admins'].includes(b.editInfo)) throw bad('editInfo is all or admins');
    if (b.editInfo !== next.editInfo) said.push(b.editInfo === 'admins' ? 'allowed only admins to edit the group info' : 'allowed all members to edit the group info');
    next.editInfo = b.editInfo;
  }
  if (b.approveJoins !== undefined) {
    if (!!b.approveJoins !== next.approveJoins) said.push(b.approveJoins ? 'turned on admin approval for new members' : 'turned off admin approval for new members');
    next.approveJoins = !!b.approveJoins;
  }
  if (b.slowModeSec !== undefined) {
    const v = Number(b.slowModeSec);
    if (!SLOW_MODE_STEPS.includes(v)) throw bad(`Slow mode is one of ${SLOW_MODE_STEPS.join(', ')} seconds`, 'BAD_SLOW_MODE');
    if (v !== next.slowModeSec) said.push(v ? `turned on slow mode (${v >= 60 ? `${v / 60} min` : `${v}s`})` : 'turned off slow mode');
    next.slowModeSec = v;
  }
  await q(c.env, 'UPDATE conversations SET settings = $2::jsonb WHERE id = $1', [convId, JSON.stringify(next)]);
  for (const s of said) await systemMessage(c.env, convId, me.id, `${me.display_name} ${s}`, { action: 'settings' });
  return c.json({ settings: settingsOf({ settings: next }) });
});

// GET /conversations/:id/members?q= — full member directory (search by name / @handle)
chatGroups.get('/conversations/:id/members', async (c) => {
  const me = c.get('user');
  const convId = uuidParam(c, 'id');
  await groupContext(c.env, convId, me.id);
  const term = String(c.req.query('q') || '').trim().slice(0, 60);
  const like = '%' + term.replace(/[\\%_]/g, (ch) => '\\' + ch) + '%';
  const vis = (await one(c.env, 'SELECT last_seen_visibility FROM users WHERE id = $1', [me.id]))?.last_seen_visibility;
  const rows = await q(c.env, `SELECT m.role, m.joined_at, m.added_by, ab.display_name AS added_by_name,
        u.presence_at, u.last_seen_visibility, ${userJson('u')} AS u
      FROM conversation_members m JOIN users u ON u.id = m.user_id
      LEFT JOIN users ab ON ab.id = m.added_by
      WHERE m.conversation_id = $1 AND ($2 = '' OR u.display_name ILIKE $3 OR u.handle ILIKE $3)
      ORDER BY (m.user_id = $4) DESC, CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'moderator' THEN 2 ELSE 3 END, u.display_name
      LIMIT 500`, [convId, term, like, me.id]);
  const newSince = Date.now() - NEW_MEMBER_DAYS * 864e5;
  return c.json({
    items: rows.map((r) => ({
      ...parse(r.u),
      role: r.role,
      isMe: parse(r.u).id === me.id,
      joinedAt: new Date(r.joined_at).toISOString(),
      isNew: new Date(r.joined_at).getTime() > newSince,
      addedBy: r.added_by ? { id: r.added_by, displayName: r.added_by_name } : null,
      presence: presenceShape(r, vis),
    })),
  });
});

// DELETE /conversations/:id/members/:userId[?ban=1] — admins remove someone below them ("Grace removed Paul");
// CHAT GAPS: ?ban=1 also bans them, so they can't come back through the invite link or a join request.
chatGroups.delete('/conversations/:id/members/:userId', async (c) => {
  const me = c.get('user');
  const convId = uuidParam(c, 'id');
  const targetId = uuidParam(c, 'userId');
  const ctx = await groupContext(c.env, convId, me.id);
  groupOnly(ctx);
  if (targetId === me.id) throw bad('Use “Leave group” to leave', 'USE_LEAVE');
  if (!permissionsFor(ctx).canRemoveMembers) throw forbidden('Only admins can remove members', 'ADMIN_ONLY');
  const target = await one(c.env, `SELECT m.role, u.display_name FROM conversation_members m JOIN users u ON u.id = m.user_id WHERE m.conversation_id = $1 AND m.user_id = $2`, [convId, targetId]);
  if (!target) throw notFound('Not a member');
  if (!outranks(ctx.role, target.role)) throw forbidden('You can’t remove someone with the same or a higher role', 'RANK');
  const ban = ['1', 'true'].includes(String(c.req.query('ban') || '').toLowerCase());
  await q(c.env, 'DELETE FROM conversation_members WHERE conversation_id = $1 AND user_id = $2', [convId, targetId]);
  if (ban) {
    await q(c.env, `INSERT INTO conversation_bans (conversation_id, user_id, banned_by) VALUES ($1, $2, $3)
      ON CONFLICT (conversation_id, user_id) DO UPDATE SET banned_by = EXCLUDED.banned_by, created_at = now()`, [convId, targetId, me.id]);
    await q(c.env, 'DELETE FROM conversation_join_requests WHERE conversation_id = $1 AND user_id = $2', [convId, targetId]);
  }
  await systemMessage(c.env, convId, me.id, `${me.display_name} removed ${target.display_name}`, { action: 'removed', targetIds: [targetId], ...(ban ? { banned: true } : {}) });
  await notifyUser(c.env, targetId, { type: 'conversation.removed', conversationId: convId }).catch(() => {});
  return c.json({ ok: true, banned: ban });
});

// POST /conversations/:id/members/:userId/role — { role: 'admin'|'moderator'|'member' }
//   owner: anyone ↔ admin/moderator/member · admins: members ↔ moderator/admin (not other admins or the owner)
chatGroups.post('/conversations/:id/members/:userId/role', async (c) => {
  const me = c.get('user');
  const convId = uuidParam(c, 'id');
  const targetId = uuidParam(c, 'userId');
  const ctx = await groupContext(c.env, convId, me.id);
  groupOnly(ctx);
  const role = String((await body(c)).role || '');
  if (!ROLES.includes(role)) throw bad('role is admin, moderator or member', 'BAD_ROLE');
  if (!permissionsFor(ctx).canPromote) throw forbidden('Only admins can change roles', 'ADMIN_ONLY');
  if (targetId === me.id) throw bad('You can’t change your own role', 'RANK');
  const target = await one(c.env, `SELECT m.role, u.display_name FROM conversation_members m JOIN users u ON u.id = m.user_id WHERE m.conversation_id = $1 AND m.user_id = $2`, [convId, targetId]);
  if (!target) throw notFound('Not a member');
  if (!outranks(ctx.role, target.role) || RANK[role] > RANK[ctx.role]) throw forbidden('You can’t change the role of someone with the same or a higher role', 'RANK');
  if (target.role !== role) {
    await q(c.env, 'UPDATE conversation_members SET role = $3 WHERE conversation_id = $1 AND user_id = $2', [convId, targetId, role]);
    const what = role === 'member' ? `dismissed ${target.display_name} as ${target.role}` : `made ${target.display_name} ${role === 'admin' ? 'an admin' : 'a moderator'}`;
    await systemMessage(c.env, convId, me.id, `${me.display_name} ${what}`, { action: 'role', targetIds: [targetId], role });
  }
  return c.json({ ok: true, role });
});

// POST /conversations/:id/transfer — { userId }: the owner hands the group over and stays on as an admin
chatGroups.post('/conversations/:id/transfer', async (c) => {
  const me = c.get('user');
  const convId = uuidParam(c, 'id');
  const ctx = await groupContext(c.env, convId, me.id);
  if (ctx.conv.kind === 'dm') throw bad('Only groups and channels have owners');
  if (ctx.role !== 'owner') throw forbidden('Only the owner can transfer ownership', 'OWNER_ONLY');
  const targetId = String((await body(c)).userId || '');
  if (!isUuid(targetId) || targetId === me.id) throw bad('Choose another member', 'BAD_USER');
  const target = await one(c.env, `SELECT u.display_name FROM conversation_members m JOIN users u ON u.id = m.user_id WHERE m.conversation_id = $1 AND m.user_id = $2`, [convId, targetId]);
  if (!target) throw notFound('Not a member');
  await q(c.env, `UPDATE conversation_members SET role = CASE WHEN user_id = $2 THEN 'owner' ELSE 'admin' END
    WHERE conversation_id = $1 AND user_id IN ($2, $3)`, [convId, targetId, me.id]);
  await systemMessage(c.env, convId, me.id, `${me.display_name} made ${target.display_name} the group owner`, { action: 'owner', targetIds: [targetId] });
  return c.json({ ok: true });
});

// ---------- invite links & join requests ----------
const newCode = () => {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((x) => a[x % a.length]).join('');
};

// POST /conversations/:id/invite — { reset? }: the group's current invite link (created on first use)
chatGroups.post('/conversations/:id/invite', async (c) => {
  const me = c.get('user');
  const convId = uuidParam(c, 'id');
  const ctx = await groupContext(c.env, convId, me.id);
  groupOnly(ctx);
  const perms = permissionsFor(ctx);
  if (!perms.canInvite) throw forbidden('Only admins can share the invite link', 'ADMIN_ONLY');
  const b = await body(c).catch(() => ({}));
  if (b && b.reset) {
    if (!perms.isAdmin) throw forbidden('Only admins can reset the invite link', 'ADMIN_ONLY');
    await q(c.env, 'UPDATE conversation_invites SET revoked_at = now() WHERE conversation_id = $1 AND revoked_at IS NULL', [convId]);
  }
  let inv = await one(c.env, 'SELECT code FROM conversation_invites WHERE conversation_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1', [convId]);
  if (!inv) inv = await one(c.env, 'INSERT INTO conversation_invites (code, conversation_id, created_by) VALUES ($1, $2, $3) RETURNING code', [newCode(), convId, me.id]);
  return c.json({ code: inv.code, url: groupInviteUrl(c, inv.code), approveJoins: ctx.settings.approveJoins });
});

async function inviteFor(env, code) {
  if (!/^[A-Za-z0-9]{6,32}$/.test(code)) return null;
  return one(env, `SELECT i.code, i.created_by, c.id, c.title, c.description, c.avatar_key, c.settings, c.kind, c.membership_id,
      (SELECT COUNT(*)::int FROM conversation_members m WHERE m.conversation_id = c.id) AS members
    FROM conversation_invites i JOIN conversations c ON c.id = i.conversation_id
    WHERE i.code = $1 AND i.revoked_at IS NULL`, [code]);
}

// GET /invites/:code — preview before joining
chatGroups.get('/invites/:code', async (c) => {
  const me = c.get('user');
  const inv = await inviteFor(c.env, c.req.param('code'));
  if (!inv) throw notFound('This invite link was reset or doesn’t exist');
  // MEMBERSHIP GROUPS: a group's invite link → { kind: 'membership', membershipId, free, ... } (paid ones open the membership page)
  if (inv.membership_id) return c.json(await membershipInvitePreview(c, inv, me));
  const mem = await one(c.env, 'SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2', [inv.id, me.id]);
  const req = await one(c.env, `SELECT status FROM conversation_join_requests WHERE conversation_id = $1 AND user_id = $2`, [inv.id, me.id]);
  const banned = !mem && !!(await one(c.env, 'SELECT 1 FROM conversation_bans WHERE conversation_id = $1 AND user_id = $2', [inv.id, me.id])); // CHAT GAPS
  return c.json({
    banned,
    conversationId: inv.id, title: inv.title, description: inv.description || '', membersCount: inv.members,
    avatarUrl: inv.avatar_key ? mediaUrl(c.env, origin(c), inv.avatar_key) : null,
    approveJoins: settingsOf(inv).approveJoins, isMember: !!mem, requestStatus: req ? req.status : null,
  });
});

// POST /invites/:code/join — join now, or ask the admins when approval is on
chatGroups.post('/invites/:code/join', async (c) => {
  const me = c.get('user');
  const inv = await inviteFor(c.env, c.req.param('code'));
  if (!inv) throw notFound('This invite link was reset or doesn’t exist');
  // MEMBERSHIP GROUPS: free + open → joined; free + approval → request; paid → { status: 'membership' } (open its page)
  if (inv.membership_id) { const r = await membershipInviteJoin(c, inv, me); return c.json(r.body, r.status); }
  if (await one(c.env, 'SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2', [inv.id, me.id])) {
    return c.json({ status: 'member', conversationId: inv.id });
  }
  // someone in the group blocked you (or you them) → no way in through a link
  const owner = await one(c.env, `SELECT 1 FROM conversation_members m JOIN blocks b ON (b.blocker_id = m.user_id AND b.blocked_id = $2)
    WHERE m.conversation_id = $1 AND m.role IN ('owner','admin') LIMIT 1`, [inv.id, me.id]);
  if (owner) throw forbidden('You can’t join this group', 'BLOCKED');
  // CHAT GAPS: banned by an admin → no way back in through the link or a join request
  if (await one(c.env, 'SELECT 1 FROM conversation_bans WHERE conversation_id = $1 AND user_id = $2', [inv.id, me.id])) {
    throw forbidden('An admin removed you from this group, so you can’t join it again', 'BANNED');
  }
  if (settingsOf(inv).approveJoins) {
    await q(c.env, `INSERT INTO conversation_join_requests (conversation_id, user_id) VALUES ($1, $2)
      ON CONFLICT (conversation_id, user_id) DO UPDATE SET status = 'pending', created_at = now(), decided_by = NULL`, [inv.id, me.id]);
    const mods = await q(c.env, `SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND role IN ('owner','admin','moderator')`, [inv.id]);
    for (const m of mods) {
      await notifyUser(c.env, m.user_id, { type: 'group.joinRequest', conversationId: inv.id, userId: me.id }).catch(() => {});
      await sendNotification(c, { userId: m.user_id, kind: 'group', title: inv.title || 'Group', body: `${me.display_name} asked to join`, data: { conversationId: inv.id, threadId: `chat:${inv.id}`, joinRequest: true } });
    }
    return c.json({ status: 'requested', conversationId: inv.id }, 202);
  }
  await q(c.env, 'UPDATE conversation_invites SET uses = uses + 1 WHERE code = $1', [inv.code]);
  // joined through a link: "added by" is whoever created the link
  const creator = await one(c.env, 'SELECT created_by FROM conversation_invites WHERE code = $1', [inv.code]);
  await q(c.env, `INSERT INTO conversation_members (conversation_id, user_id, role, added_by) VALUES ($1, $2, 'member', $3) ON CONFLICT DO NOTHING`, [inv.id, me.id, creator && creator.created_by]);
  await systemMessage(c.env, inv.id, me.id, `${me.display_name} joined using the invite link`, { action: 'joined' });
  return c.json({ status: 'member', conversationId: inv.id }, 201);
});

// GET /conversations/:id/requests — pending join requests (moderators+)
chatGroups.get('/conversations/:id/requests', async (c) => {
  const me = c.get('user');
  const convId = uuidParam(c, 'id');
  const ctx = await groupContext(c.env, convId, me.id);
  if (!permissionsFor(ctx).canApproveJoins) throw forbidden('Only admins can see join requests', 'ADMIN_ONLY');
  const rows = await q(c.env, `SELECT r.created_at, ${userJson('u')} AS u FROM conversation_join_requests r JOIN users u ON u.id = r.user_id
    WHERE r.conversation_id = $1 AND r.status = 'pending' ORDER BY r.created_at`, [convId]);
  return c.json({ items: rows.map((r) => ({ ...parse(r.u), requestedAt: new Date(r.created_at).toISOString() })) });
});

// POST /conversations/:id/requests/:userId — { approve: true|false }
chatGroups.post('/conversations/:id/requests/:userId', async (c) => {
  const me = c.get('user');
  const convId = uuidParam(c, 'id');
  const userId = uuidParam(c, 'userId');
  const ctx = await groupContext(c.env, convId, me.id);
  if (!permissionsFor(ctx).canApproveJoins) throw forbidden('Only admins can approve join requests', 'ADMIN_ONLY');
  const approve = (await body(c)).approve !== false;
  if (approve && await one(c.env, 'SELECT 1 FROM conversation_bans WHERE conversation_id = $1 AND user_id = $2', [convId, userId])) {
    throw forbidden('This person is banned from the group — unban them first', 'BANNED'); // CHAT GAPS
  }
  const req = await one(c.env, `UPDATE conversation_join_requests SET status = $3, decided_by = $4
    WHERE conversation_id = $1 AND user_id = $2 AND status = 'pending' RETURNING user_id`, [convId, userId, approve ? 'approved' : 'declined', me.id]);
  if (!req) throw notFound('No pending request');
  if (approve) {
    await addMembersTo(c, convId, me, [userId], { via: 'approved', sendPush: (n) => sendNotification(c, n) });
    await sendNotification(c, { userId, kind: 'group', title: ctx.conv.title || 'Group', body: 'Your request to join was approved', data: { conversationId: convId, threadId: `chat:${convId}` } });
  }
  return c.json({ ok: true, approved: approve });
});

// POST /conversations/:id/report — { reason }
chatGroups.post('/conversations/:id/report', async (c) => {
  const me = c.get('user');
  const convId = uuidParam(c, 'id');
  await groupContext(c.env, convId, me.id);
  const reason = str((await body(c).catch(() => ({}))).reason || '', { max: 1000, optional: true }) || '';
  await q(c.env, 'INSERT INTO conversation_reports (conversation_id, user_id, reason) VALUES ($1, $2, $3)', [convId, me.id, reason]);
  return c.json({ ok: true }, 201);
});

// PUT /conversations/:id/mute — { muted: bool, duration?: '8h' | '1w' | 'always' } explicit (the older toggle in
// conversations.js stays for old apps). CHAT GAPS: timed mute — no duration = always (what older apps send).
// → { ok, muted, mutedUntil } (mutedUntil null = until unmuted)
chatGroups.put('/conversations/:id/mute', async (c) => {
  const me = c.get('user');
  const convId = uuidParam(c, 'id');
  const b = await body(c);
  const muted = !!b.muted;
  const duration = b.duration == null ? 'always' : String(b.duration);
  if (muted && !Object.prototype.hasOwnProperty.call(MUTE_DURATIONS, duration)) throw bad('duration is 8h, 1w or always', 'BAD_DURATION');
  const ms = muted ? MUTE_DURATIONS[duration] : null;
  const until = ms ? new Date(Date.now() + ms).toISOString() : null;
  const r = await one(c.env, 'UPDATE conversation_members SET muted = $3, muted_until = $4 WHERE conversation_id = $1 AND user_id = $2 RETURNING muted, muted_until', [convId, me.id, muted, until]);
  if (!r) throw notFound('Not a member');
  return c.json({ ok: true, ...muteShape(r.muted, r.muted_until) });
});

// ---------- shared media, links and files ----------
const MEDIA_TABS = ['photos', 'videos', 'docs', 'audio', 'links', 'files'];

// GET /conversations/:id/media?type=photos|videos|docs|audio|links|files&before=<iso>
chatGroups.get('/conversations/:id/media', async (c) => {
  const me = c.get('user');
  const convId = uuidParam(c, 'id');
  await groupContext(c.env, convId, me.id);
  const type = c.req.query('type') || 'photos';
  if (!MEDIA_TABS.includes(type)) throw bad(`type is one of ${MEDIA_TABS.join(', ')}`);
  const before = c.req.query('before');
  const vals = [convId, me.id];
  let where = '';
  if (type === 'photos') where = `m.kind = 'image'`;
  else if (type === 'videos') where = `m.kind = 'video'`;
  else if (type === 'audio') where = `m.kind = 'voice'`;
  else if (type === 'links') where = `m.kind IN ('text','image','video') AND m.body ~* 'https?://'`;
  else where = `m.kind = 'file'`;
  if (before && !Number.isNaN(Date.parse(before))) { vals.push(new Date(before).toISOString()); where += ` AND m.created_at < $${vals.length}`; }
  // paging: ?limit= (default 100, max 200); when a full page came back, nextBefore is the cursor for the next one
  const limit = Math.min(200, Math.max(1, parseInt(c.req.query('limit') || '100', 10) || 100));
  const rows = await q(c.env, `SELECT m.id, m.kind, m.body, m.media_key, m.meta, m.created_at, m.sender_id, u.display_name AS sender_name
      FROM messages m JOIN users u ON u.id = m.sender_id
      WHERE m.conversation_id = $1 AND NOT m.deleted AND ${where}
        AND NOT EXISTS (SELECT 1 FROM message_hides h WHERE h.message_id = m.id AND h.user_id = $2)
        AND NOT ${historyHiddenSql('m', '$2')}
      ORDER BY m.created_at DESC LIMIT ${limit}`, vals);
  const nextBefore = rows.length === limit ? new Date(rows[rows.length - 1].created_at).toISOString() : null;
  let items = rows.map((r) => {
    const meta = parse(r.meta) || {};
    return {
      messageId: r.id, kind: r.kind, mediaKey: r.media_key, meta, text: r.body || '',
      senderId: r.sender_id, senderName: r.sender_name, createdAt: new Date(r.created_at).toISOString(),
      category: r.kind === 'file' ? fileCategory(meta) : type,
    };
  });
  if (type === 'docs' || type === 'files') items = items.filter((x) => x.category === type);
  if (type === 'links') {
    items = items.flatMap((x) => [...new Set((x.text.match(URL_RE) || []).map((u) => u.replace(/[).,!?]+$/, '')))].map((url) => {
      let host = ''; try { host = new URL(url).host; } catch (e) { /* keep empty */ }
      return { ...x, url, host };
    }));
    // CHAT GAPS: the same preview cards the bubbles show (cached ones only — the list never fetches websites)
    const cards = await previewsFor(c.env, items.map((x) => firstLinkUrl(x.url)));
    items = items.map((x) => ({ ...x, preview: cards.get(firstLinkUrl(x.url)) || null }));
  }
  // `before` (and its alias nextBefore) is the cursor for "Load more" — send it back as ?before=
  return c.json({ type, items, before: nextBefore, nextBefore });
});

// GET /conversations/:id/media/counts — how many of each (tab badges)
chatGroups.get('/conversations/:id/media/counts', async (c) => {
  const me = c.get('user');
  const convId = uuidParam(c, 'id');
  await groupContext(c.env, convId, me.id);
  const rows = await q(c.env, `SELECT m.kind, m.meta, m.body FROM messages m WHERE m.conversation_id = $1 AND NOT m.deleted AND (m.kind IN ('image','video','voice','file') OR m.body ~* 'https?://')
    AND NOT ${historyHiddenSql('m', '$2')}`, [convId, me.id]);
  const counts = { photos: 0, videos: 0, docs: 0, audio: 0, links: 0, files: 0 };
  for (const r of rows) {
    if (r.kind === 'image') counts.photos++;
    else if (r.kind === 'video') counts.videos++;
    else if (r.kind === 'voice') counts.audio++;
    else if (r.kind === 'file') counts[fileCategory(parse(r.meta) || {})]++;
    if (/https?:\/\//i.test(r.body || '')) counts.links++;
  }
  return c.json(counts);
});

// ---------- files & videos in chat ----------
const MAX_FILE = 50 * 1024 * 1024;
const MAX_CHAT_VIDEO = 95 * 1024 * 1024; // one Worker request
const BLOCKED_EXT = ['exe', 'bat', 'cmd', 'com', 'scr', 'msi', 'vbs', 'js', 'jar', 'ps1', 'sh', 'apk', 'dll'];
const VIDEO_TYPES = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/3gpp': '3gp', 'video/x-m4v': 'm4v' };

// POST /uploads/chat-file — raw body; headers X-Conversation-Id, X-File-Name, Content-Type → { key, url, size, mime, name, kind }
chatGroups.post('/uploads/chat-file', async (c) => {
  const me = c.get('user');
  if (!c.env.MEDIA) throw new ApiError(500, 'STORAGE_NOT_CONFIGURED', 'Media storage is not configured');
  const convId = c.req.header('X-Conversation-Id') || c.req.query('conversationId');
  if (!isUuid(convId)) throw bad('X-Conversation-Id is required');
  const mem = await one(c.env, 'SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2', [convId, me.id]);
  if (!mem) throw forbidden('Not a member of this chat');
  const rawName = decodeURIComponent(c.req.header('X-File-Name') || 'file').replace(/[\\/\0]/g, '_').slice(0, 120) || 'file';
  const mime = (c.req.header('Content-Type') || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  const isVideo = !!VIDEO_TYPES[mime];
  const ext = isVideo ? VIDEO_TYPES[mime] : (extOf(rawName) || 'bin');
  if (BLOCKED_EXT.includes(ext)) throw bad('That kind of file can’t be shared in chats', 'BAD_TYPE');
  const max = isVideo ? MAX_CHAT_VIDEO : MAX_FILE;
  const len = Number(c.req.header('Content-Length') || 0);
  if (len > max) throw new ApiError(413, 'TOO_LARGE', isVideo ? 'Videos can be up to 95 MB' : 'Files can be up to 50 MB');
  const buf = await c.req.arrayBuffer();
  if (!buf.byteLength) throw bad('Empty upload');
  if (buf.byteLength > max) throw new ApiError(413, 'TOO_LARGE', isVideo ? 'Videos can be up to 95 MB' : 'Files can be up to 50 MB');
  const key = `chat/${convId}/${isVideo ? 'vid' : 'file'}_${crypto.randomUUID()}.${ext}`;
  await c.env.MEDIA.put(key, buf, { httpMetadata: { contentType: mime, cacheControl: 'private, max-age=31536000, immutable', contentDisposition: `inline; filename="${rawName.replace(/"/g, '')}"` } });
  return c.json({ key, url: `${origin(c)}/chat/media/${key}`, size: buf.byteLength, mime, name: rawName, kind: isVideo ? 'video' : 'file' }, 201);
});

// ---------- forward ----------
// POST /messages/:id/forward — { conversationIds[] } (up to 5, like WhatsApp). Media is copied into each chat.
chatGroups.post('/messages/:id/forward', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c, 'id');
  let src = await one(c.env, 'SELECT * FROM messages WHERE id = $1', [id]);
  if (!src || src.deleted) throw notFound('Message not found');
  if (!(await one(c.env, 'SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2', [src.conversation_id, me.id]))) throw notFound('Message not found');
  // MEMBERSHIP GROUPS: forwarding a shared post forwards its MASTER CLASS original (the reference itself is empty)
  if (src.kind === 'shared_post') {
    src = src.shared_from ? await one(c.env, 'SELECT * FROM messages WHERE id = $1', [src.shared_from]) : null;
    if (!src || src.deleted) throw notFound('This post was deleted');
  }
  if (src.kind === 'system') throw bad('System messages can’t be forwarded', 'NOT_ALLOWED');
  const meta0 = parse(src.meta) || {};
  if (meta0.gift) throw bad('Coin gifts can’t be forwarded', 'NOT_ALLOWED');
  if (src.kind === 'gift' || meta0.vgift) throw bad('Gifts can’t be forwarded', 'NOT_ALLOWED'); // VIRTUAL GIFTS: a forwarded copy would look like a new paid gift
  const b = await body(c);
  const targets = [...new Set((Array.isArray(b.conversationIds) ? b.conversationIds : []).map(String).filter(isUuid))].slice(0, 5);
  if (!targets.length) throw bad('Choose a chat', 'NO_TARGET');
  const out = [];
  for (const convId of targets) {
    const ctx = await groupContext(c.env, convId, me.id).catch(() => null);
    // MEMBERSHIP GROUPS: same rules as sending (MASTER CLASS publishers only, EXECUTIVE CLASS settings / mute)
    const mg = ctx ? await membershipSendGuard(c.env, convId, me, { kind: src.kind }).catch(() => false) : null;
    // (mg: false = the guard refused; null = not a membership section; otherwise the group context)
    if (!ctx || mg === false || (!mg && !permissionsFor(ctx).canSend)) { out.push({ conversationId: convId, ok: false, code: 'NOT_ALLOWED' }); continue; }
    if (ctx.conv.kind === 'dm') {
      const blocked = await one(c.env, `SELECT 1 FROM conversation_members m JOIN blocks b ON (b.blocker_id = m.user_id AND b.blocked_id = $2) OR (b.blocker_id = $2 AND b.blocked_id = m.user_id)
        WHERE m.conversation_id = $1 AND m.user_id <> $2`, [convId, me.id]);
      if (blocked) { out.push({ conversationId: convId, ok: false, code: 'BLOCKED' }); continue; }
    }
    let mediaKey = src.media_key;
    if (mediaKey && mediaKey.startsWith('chat/') && c.env.MEDIA) {
      const obj = await c.env.MEDIA.get(mediaKey);
      if (obj) {
        const nk = `chat/${convId}/${mediaKey.split('/').pop().replace(/^(\w+?)_[\w-]+/, `$1_${crypto.randomUUID()}`)}`;
        await c.env.MEDIA.put(nk, await new Response(obj.body).arrayBuffer(), { httpMetadata: obj.httpMetadata || {} });
        mediaKey = nk;
      } else mediaKey = null;
    }
    if (['image', 'voice', 'video', 'file'].includes(src.kind) && !mediaKey) { out.push({ conversationId: convId, ok: false, code: 'MEDIA_GONE' }); continue; }
    const meta = { ...meta0, forwarded: true };
    delete meta.mentions;
    const row = await one(c.env, `WITH ins AS (
        INSERT INTO messages (conversation_id, sender_id, kind, body, media_key, meta, link_url) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) RETURNING id
      ), up AS (UPDATE conversations SET last_message_at = now() WHERE id = $1),
      um AS (UPDATE conversation_members SET last_read_at = now(), last_sent_at = now() WHERE conversation_id = $1 AND user_id = $2)
      SELECT id FROM ins`, [convId, me.id, src.kind, src.body, mediaKey, JSON.stringify(meta), src.link_url || null]);
    const msg = await loadMessage(c.env, row.id, me.id);
    if (mg && mg.section === 'master') await shareToExecutive(c.env, mg.m, { id: row.id, sender_id: me.id, kind: src.kind }); // MEMBERSHIP GROUPS
    const others = await q(c.env, `SELECT user_id, ${mutedSql('m')} AS muted FROM conversation_members m WHERE conversation_id = $1 AND user_id <> $2`, [convId, me.id]); // CHAT GAPS: timed mute
    // MEMBERSHIP GROUPS: the same push plan as a new message (MASTER CLASS / EXECUTIVE CLASS title, each member's choice)
    const mgPush = mg ? await pushPlan(c.env, mg, others.map((o) => o.user_id)) : null;
    for (const o of others) {
      await notifyUser(c.env, o.user_id, { type: 'message.new', conversationId: convId, message: { ...msg, isMe: false } }).catch(() => {});
      if (mgPush) {
        const choice = mgPush.plan.get(o.user_id) || 'all';
        if (choice === 'all' && !o.muted) {
          await sendNotification(c, { userId: o.user_id, kind: 'group', title: mgPush.title, body: mg.section === 'master' ? `📣 New post: ${(src.body || 'Attachment').slice(0, 90)}` : `↪ Forwarded: ${(src.body || 'Attachment').slice(0, 90)}`, data: { conversationId: convId, messageId: row.id, threadId: `chat:${convId}`, membershipId: mg.m.id, section: mg.section } });
        }
        continue;
      }
      if (!o.muted) await sendNotification(c, { userId: o.user_id, kind: ctx.conv.kind === 'group' ? 'group' : 'message', title: ctx.conv.kind === 'dm' ? me.display_name : (ctx.conv.title || 'Group'), body: `↪ Forwarded: ${(src.body || 'Attachment').slice(0, 90)}`, data: { conversationId: convId, messageId: row.id, threadId: `chat:${convId}` } });
    }
    out.push({ conversationId: convId, ok: true, message: msg });
  }
  return c.json({ results: out });
});

// ---------- typing, presence, last-seen privacy ----------
// POST /conversations/:id/typing — { typing: true|false } (call at most every ~3 s while typing)
chatGroups.post('/conversations/:id/typing', async (c) => {
  const me = c.get('user');
  const convId = uuidParam(c, 'id');
  const typing = (await body(c).catch(() => ({}))).typing !== false;
  const r = await one(c.env, `UPDATE conversation_members SET typing_at = ${typing ? 'now()' : 'NULL'} WHERE conversation_id = $1 AND user_id = $2 RETURNING 1 AS ok`, [convId, me.id]);
  if (!r) throw forbidden('Not a member of this conversation');
  await touchPresence(c.env, me.id);
  const others = await q(c.env, 'SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND user_id <> $2', [convId, me.id]);
  await Promise.all(others.map((o) => notifyUser(c.env, o.user_id, { type: 'typing', conversationId: convId, userId: me.id, name: me.display_name, typing }).catch(() => {})));
  return c.json({ ok: true });
});

// POST /me/presence — heartbeat while the app is open
chatGroups.post('/me/presence', async (c) => {
  await touchPresence(c.env, c.get('user').id);
  return c.json({ ok: true });
});

// GET/PUT /me/chat-privacy — { lastSeen: 'everyone' | 'nobody' }
chatGroups.get('/me/chat-privacy', async (c) => {
  const r = await one(c.env, 'SELECT last_seen_visibility FROM users WHERE id = $1', [c.get('user').id]);
  return c.json({ lastSeen: (r && r.last_seen_visibility) || 'everyone' });
});
chatGroups.put('/me/chat-privacy', async (c) => {
  const v = (await body(c)).lastSeen;
  if (!['everyone', 'nobody'].includes(v)) throw bad('lastSeen is everyone or nobody');
  await q(c.env, 'UPDATE users SET last_seen_visibility = $2 WHERE id = $1', [c.get('user').id, v]);
  return c.json({ lastSeen: v });
});

// GET /users/:id/presence — online / last seen for a profile header
chatGroups.get('/users/:id/presence', async (c) => {
  const me = c.get('user');
  const u = await one(c.env, 'SELECT presence_at, last_seen_visibility FROM users WHERE id = $1', [uuidParam(c, 'id')]);
  if (!u) throw notFound('User not found');
  const mine = await one(c.env, 'SELECT last_seen_visibility FROM users WHERE id = $1', [me.id]);
  return c.json(presenceShape(u, mine && mine.last_seen_visibility));
});

// ---------- search ----------
// GET /chats/search?q= — messages across all my chats; GET /conversations/:id/search?q= — within one chat
async function searchMessages(c, convId) {
  const me = c.get('user');
  const term = String(c.req.query('q') || '').trim().slice(0, 80);
  if (term.length < 2) return c.json({ items: [] });
  const like = '%' + term.replace(/[\\%_]/g, (ch) => '\\' + ch) + '%';
  const vals = [me.id, like];
  if (convId) vals.push(convId);
  // MEMBERSHIP GROUPS: a MASTER CLASS post shared into EXECUTIVE CLASS is only a reference (empty body), so the search
  // also matches the original's text / file name (s = the original; the reference is what the chat shows)
  const rows = await q(c.env, `SELECT m.id, m.conversation_id, m.kind, m.body, m.meta, m.created_at, m.sender_id, u.display_name AS sender_name,
        cv.kind AS conv_kind, cv.title,
        s.body AS orig_body, s.kind AS orig_kind, s.meta AS orig_meta,
        (SELECT ou.display_name FROM conversation_members om JOIN users ou ON ou.id = om.user_id
          WHERE cv.kind = 'dm' AND om.conversation_id = cv.id AND om.user_id <> $1 LIMIT 1) AS other_name
      FROM messages m
      JOIN conversation_members me_m ON me_m.conversation_id = m.conversation_id AND me_m.user_id = $1
      JOIN conversations cv ON cv.id = m.conversation_id
      JOIN users u ON u.id = m.sender_id
      LEFT JOIN messages s ON s.id = m.shared_from AND NOT s.deleted
      WHERE NOT m.deleted AND m.kind <> 'system'
        AND (m.body ILIKE $2 OR (m.kind = 'file' AND m.meta->>'name' ILIKE $2)
          OR (s.id IS NOT NULL AND (s.body ILIKE $2 OR (s.kind = 'file' AND s.meta->>'name' ILIKE $2))))
        ${convId ? 'AND m.conversation_id = $3' : ''}
        AND NOT EXISTS (SELECT 1 FROM message_hides h WHERE h.message_id = m.id AND h.user_id = $1)
        AND NOT ${historyHiddenSql('m', '$1')}
      ORDER BY m.created_at DESC LIMIT 60`, vals);
  return c.json({
    items: rows.map((r) => ({
      // a shared reference shows (and is searched as) its original's text
      id: r.id, conversationId: r.conversation_id, kind: r.kind === 'shared_post' && r.orig_kind ? r.orig_kind : r.kind,
      text: r.body || r.orig_body || (parse(r.meta) || {}).name || (parse(r.orig_meta) || {}).name || '',
      senderId: r.sender_id, senderName: r.sender_name, isMe: r.sender_id === me.id,
      chatTitle: r.conv_kind === 'dm' ? (r.other_name || 'Direct message') : (r.title || 'Group'), chatKind: r.conv_kind,
      createdAt: new Date(r.created_at).toISOString(),
    })),
  });
}
chatGroups.get('/chats/search', (c) => searchMessages(c, null));
chatGroups.get('/conversations/:id/search', async (c) => {
  const convId = uuidParam(c, 'id');
  await groupContext(c.env, convId, c.get('user').id);
  return searchMessages(c, convId);
});

export default chatGroups;

// ---------- signed links for chat files: in-app PDF viewer, video streaming, downloads ----------
// GET /chat/media-link?key=chat/<conv>/<file> (members only) → { url, viewerUrl?, expiresAt }
// The link works without the auth header for 2 hours, so phones can stream videos, open the pdf.js
// viewer in a WebView and hand downloads to the system browser.

const LINK_TTL = 2 * 3600;
const enc = new TextEncoder();
async function chatSig(env, key, exp) {
  const secret = env.REALTIME_SECRET || env.MEDIA_SIGNING_SECRET || 'biblenestra-chat-media-fallback';
  const k = await crypto.subtle.importKey('raw', enc.encode(`chat-media:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(`${key}:${exp}`)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const CHAT_KEY_RE = /^chat\/[0-9a-f-]{36}\/[\w.-]+$/;

chatGroups.get('/chat/media-link', async (c) => {
  const me = c.get('user');
  const key = String(c.req.query('key') || '');
  if (!CHAT_KEY_RE.test(key) || key.includes('..')) throw bad('Bad file key');
  const convId = key.split('/')[1];
  if (!(await one(c.env, 'SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2', [convId, me.id]))) throw forbidden('Not a member of this chat');
  const exp = Math.floor(Date.now() / 1000) + LINK_TTL;
  const path = `/chat/file/${key}?exp=${exp}&sig=${await chatSig(c.env, key, exp)}`;
  const isPdf = /\.pdf$/i.test(key);
  return c.json({
    url: `${origin(c)}${path}`,
    viewerUrl: isPdf ? `${origin(c)}/chat/viewer?file=${encodeURIComponent(path)}` : null,
    expiresAt: new Date(exp * 1000).toISOString(),
  });
});

// Public (registered before sign-in): signed file stream + the pdf.js viewer pointed at chat files
export const chatPublic = new Hono();
chatPublic.get('/chat/file/*', async (c) => {
  if (!c.env.MEDIA) return c.notFound();
  const key = decodeURIComponent(new URL(c.req.url).pathname.replace(/^\/chat\/file\//, ''));
  if (!CHAT_KEY_RE.test(key) || key.includes('..')) return c.notFound();
  const exp = Number(c.req.query('exp'));
  const sig = String(c.req.query('sig') || '');
  if (!Number.isInteger(exp) || exp < Math.floor(Date.now() / 1000) || sig !== await chatSig(c.env, key, exp)) {
    return c.json({ error: 'This link has expired', code: 'LINK_EXPIRED' }, 403);
  }
  if (c.req.query('download')) {
    const head = await c.env.MEDIA.head(key);
    const res = await streamObject(c, key, { cache: 'private, max-age=3600' });
    const name = (head && head.httpMetadata && /filename="([^"]+)"/.exec(head.httpMetadata.contentDisposition || '')) || null;
    const headers = new Headers(res.headers);
    const asked = String(c.req.query('name') || '').replace(/[^\w .()-]/g, '_').slice(0, 120);
    headers.set('Content-Disposition', `attachment; filename="${asked || (name ? name[1] : key.split('/').pop())}"`);
    return new Response(res.body, { status: res.status, headers });
  }
  return streamObject(c, key, { cache: 'private, max-age=3600' });
});
// same pdf.js page as the media library, allowed to open /chat/file/… links
const CHAT_VIEWER_HTML = LIBRARY_VIEWER_HTML.split(String.raw`\/library\/file\/lib\/pdf\/`).join(String.raw`\/chat\/file\/chat\/`);
chatPublic.get('/chat/viewer', (c) => {
  c.header('Cache-Control', 'public, max-age=600');
  c.header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; worker-src 'self' blob: https://cdnjs.cloudflare.com; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data: https://cdnjs.cloudflare.com");
  c.header('Referrer-Policy', 'no-referrer');
  return c.html(CHAT_VIEWER_HTML);
});
