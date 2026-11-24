// MEMBERSHIP GROUPS — MASTER CLASS + EXECUTIVE CLASS: names, publish-only MASTER CLASS (API enforced), automatic
// shared-post references in EXECUTIVE CLASS (one content record, live edits, deletes, comments off), the once-only welcome
// pop-up with custom text, owner protection, per-admin permissions, timed mute, approval-based joining (paid and free),
// invite links, history visibility for new members, per-member notification choices, private groups, bans.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { q, one } from '../src/lib/db.js';
import { DEFAULT_WELCOME } from '../src/lib/membershipGroups.js';
import { MEMBERSHIPS_ADMIN_SCRIPT } from '../src/lib/membershipsAdminPage.js';

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', MEMBERSHIP_TEST_CHECKOUT: 'true' };
});
async function call(user, method, path, body) {
  const h = {};
  if (user) h['X-Dev-User'] = user;
  let b;
  if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${path}`, { method, headers: h, body: b }), env);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = text; }
  return { status: res.status, json };
}
const ids = {};
let mem; let plan; let master; let exec;
const grant = (u) => call('boss', 'POST', `/memberships/manage/${mem.id}/grant`, { userId: ids[u] });
const notifCount = async (user, messageId) => (await one(env, `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND data->>'messageId' = $2`, [ids[user], messageId])).n;
const sharedFor = async (user, sourceId) => {
  const r = await call(user, 'GET', `/conversations/${exec}/messages?limit=50`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.items.find((m) => m.kind === 'shared_post' && m.shared && m.shared.id === sourceId);
};

test('setup: a published group gets MASTER CLASS and EXECUTIVE CLASS', async () => {
  for (const u of ['boss', 'cara', 'ed', 'dan', 'ann', 'ben', 'fay', 'gus', 'hal']) ids[u] = (await call(u, 'GET', '/me')).json.id;
  await q(env, `UPDATE users SET role = 'admin' WHERE id = $1`, [ids.boss]);
  await q(env, `UPDATE users SET handle = 'eddie' WHERE id = $1`, [ids.ed]);
  const r = await call('boss', 'POST', '/memberships/manage', { title: 'School of Prayer', category: 'Prayer', userId: null, ownerUserId: ids.cara });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  mem = r.json;
  plan = (await call('boss', 'POST', `/memberships/manage/${mem.id}/plans`, { name: 'Monthly', priceMinor: 500000, interval: 'month' })).json;
  const pub = await call('boss', 'POST', `/memberships/manage/${mem.id}/publish`);
  assert.equal(pub.status, 200, JSON.stringify(pub.json));
  master = pub.json.channelId; exec = pub.json.communityId;
  assert.equal(pub.json.sections.master.name, 'MASTER CLASS');
  assert.equal(pub.json.sections.executive.name, 'EXECUTIVE CLASS');
  const convs = await q(env, 'SELECT id, title, description FROM conversations WHERE id = ANY($1::uuid[])', [[master, exec]]);
  assert.equal(convs.find((x) => x.id === master).title, 'School of Prayer · MASTER CLASS');
  assert.equal(convs.find((x) => x.id === exec).title, 'School of Prayer · EXECUTIVE CLASS');
  assert.ok(!MEMBERSHIPS_ADMIN_SCRIPT.includes('`') && !MEMBERSHIPS_ADMIN_SCRIPT.includes('${'), 'admin script must be a plain string');
  assert.match(MEMBERSHIPS_ADMIN_SCRIPT, /MASTER CLASS/); assert.match(MEMBERSHIPS_ADMIN_SCRIPT, /EXECUTIVE CLASS/);
});

test('schema migration renames only titles that still end with the old defaults', async () => {
  const a = await one(env, `INSERT INTO conversations (kind, title, membership_id) VALUES ('channel', 'Old Group · Channel', $1) RETURNING id`, [mem.id]);
  const b = await one(env, `INSERT INTO conversations (kind, title, membership_id) VALUES ('group', 'Old Group · Community', $1) RETURNING id`, [mem.id]);
  const keep = await one(env, `INSERT INTO conversations (kind, title, membership_id) VALUES ('group', 'Renamed by hand', $1) RETURNING id`, [mem.id]);
  const plain = await one(env, `INSERT INTO conversations (kind, title) VALUES ('channel', 'Not a membership · Channel') RETURNING id`);
  const fs = await import('node:fs/promises');
  const sql = await fs.readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
  const block = sql.slice(sql.indexOf('-- ---------- MEMBERSHIP GROUPS: MASTER CLASS + EXECUTIVE CLASS ----------'));
  const legacy = await one(env, `INSERT INTO messages (conversation_id, sender_id, kind, body) VALUES ($1, $2, 'text', 'A post from before') RETURNING id`, [master, ids.cara]);
  const joinedLine = await one(env, `INSERT INTO messages (conversation_id, sender_id, kind, body) VALUES ($1, $2, 'system', 'Dan joined the community') RETURNING id`, [exec, ids.dan]);
  await env.__db.pg.exec(block); // idempotent re-run
  await env.__db.pg.exec(sql); // the WHOLE file re-runs on a database that already has shared posts and free members
  const refs = await q(env, 'SELECT conversation_id, body FROM messages WHERE shared_from = $1', [legacy.id]);
  assert.equal(refs.length, 1, 'older posts get exactly one EXECUTIVE CLASS reference'); assert.equal(refs[0].conversation_id, exec); assert.equal(refs[0].body, '');
  assert.equal((await one(env, 'SELECT body FROM messages WHERE id = $1', [joinedLine.id])).body, 'Dan joined EXECUTIVE CLASS 👋');
  await q(env, 'DELETE FROM messages WHERE id = $1', [joinedLine.id]);
  const t = async (id) => (await one(env, 'SELECT title FROM conversations WHERE id = $1', [id])).title;
  assert.equal(await t(a.id), 'Old Group · MASTER CLASS');
  assert.equal(await t(b.id), 'Old Group · EXECUTIVE CLASS');
  assert.equal(await t(keep.id), 'Renamed by hand');
  assert.equal(await t(plain.id), 'Not a membership · Channel');
  await q(env, 'DELETE FROM conversations WHERE id = ANY($1::uuid[])', [[a.id, b.id, keep.id, plain.id]]);
});

test('welcome pop-up: shown once per member per group (server-side), default text with the group name', async () => {
  assert.equal((await grant('dan')).status, 200);
  const home = await call('dan', 'GET', `/memberships/${mem.id}/home`);
  assert.equal(home.status, 200, JSON.stringify(home.json));
  assert.equal(home.json.sections.master.id, master);
  assert.equal(home.json.role, 'member');
  assert.equal(home.json.welcome.text, DEFAULT_WELCOME.replace('{group}', 'School of Prayer'));
  assert.ok(home.json.welcome.text.startsWith('🎉 Welcome to School of Prayer!'));
  const pending = await call('dan', 'GET', '/memberships/welcome');
  assert.equal(pending.json.pending.membershipId, mem.id);
  assert.equal((await call('dan', 'POST', `/memberships/${mem.id}/welcome/seen`)).json.firstTime, true);
  assert.equal((await call('dan', 'GET', `/memberships/${mem.id}/home`)).json.welcome, null, 'only once');
  assert.equal((await call('dan', 'GET', '/memberships/welcome')).json.pending, null, 'once across devices too');
  assert.equal((await call('dan', 'POST', `/memberships/${mem.id}/welcome/seen`)).json.firstTime, false);
  assert.equal((await call('cara', 'GET', `/memberships/${mem.id}/home`)).json.welcome, null, 'the owner never gets it');
  // a system line in EXECUTIVE CLASS
  const sys = await one(env, `SELECT body FROM messages WHERE conversation_id = $1 AND kind = 'system' ORDER BY created_at DESC LIMIT 1`, [exec]);
  assert.match(sys.body, /joined EXECUTIVE CLASS/);
});

test('welcome pop-up: the owner edits the text with a {group} placeholder', async () => {
  const r = await call('cara', 'PATCH', `/memberships/${mem.id}/group`, { welcomeMessage: 'Hello {group} friends! Start in MASTER CLASS.' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.welcomePreview, 'Hello School of Prayer friends! Start in MASTER CLASS.');
  await grant('ann');
  const home = await call('ann', 'GET', `/memberships/${mem.id}/home`);
  assert.equal(home.json.welcome.text, 'Hello School of Prayer friends! Start in MASTER CLASS.');
  await call('ann', 'POST', `/memberships/${mem.id}/welcome/seen`);
  // members can't change it
  assert.equal((await call('dan', 'PATCH', `/memberships/${mem.id}/group`, { welcomeMessage: 'x' })).json.code, 'PERMISSION_REQUIRED');
});

test('members can never post in MASTER CLASS (send and forward), the owner can', async () => {
  const r = await call('dan', 'POST', `/conversations/${master}/messages`, { text: 'Can I post?' });
  assert.equal(r.status, 403); assert.equal(r.json.code, 'MASTER_CLASS_PUBLISHERS_ONLY');
  const img = await call('dan', 'POST', `/conversations/${master}/messages`, { kind: 'image', mediaKey: `chat/${master}/x.jpg` });
  assert.equal(img.status, 403);
  const mine = await call('dan', 'POST', `/conversations/${exec}/messages`, { text: 'A note to forward' });
  assert.equal(mine.status, 201);
  const fwd = await call('dan', 'POST', `/messages/${mine.json.id}/forward`, { conversationIds: [master] });
  assert.equal(fwd.json.results[0].ok, false); assert.equal(fwd.json.results[0].code, 'NOT_ALLOWED');
  const thread = await call('dan', 'GET', `/conversations/${master}/messages`);
  assert.equal(thread.json.permissions.canSend, false);
  assert.equal(thread.json.membershipGroup.sectionTitle, 'MASTER CLASS');
  const own = await call('cara', 'POST', `/conversations/${master}/messages`, { text: 'Week 1 is live 🙏' });
  assert.equal(own.status, 201, JSON.stringify(own.json));
  assert.equal((await call('cara', 'GET', `/conversations/${master}/messages`)).json.permissions.canToggleComments, true);
});

test('a MASTER CLASS post appears in EXECUTIVE CLASS as a reference: one record, live edits, comments off, delete', async () => {
  const body = `Lesson notes ${Date.now()} https://example.com/notes`;
  const post = await call('cara', 'POST', `/conversations/${master}/messages`, { text: body });
  assert.equal(post.status, 201);
  // one content record
  assert.equal((await one(env, 'SELECT count(*)::int AS n FROM messages WHERE body = $1', [body])).n, 1);
  const ref = await one(env, `SELECT * FROM messages WHERE shared_from = $1`, [post.json.id]);
  assert.equal(ref.kind, 'shared_post'); assert.equal(ref.conversation_id, exec);
  assert.equal(ref.body, ''); assert.equal(ref.media_key, null); assert.equal(ref.meta, null);
  // members see it rendered from the original
  let shared = await sharedFor('dan', post.json.id);
  assert.ok(shared, 'reference in EXECUTIVE CLASS');
  assert.equal(shared.text, ''); assert.equal(shared.shared.text, body); assert.equal(shared.shared.commentsOff, false);
  assert.equal(shared.shared.sender.id, ids.cara);
  // chat list preview
  const list = await call('dan', 'GET', '/conversations');
  const row = list.json.items.find((x) => x.id === exec);
  assert.equal(row.lastMessage.text, `📣 MASTER CLASS: ${body}`);
  // edit the original (no 15-minute limit for posts) → the reference shows it at once
  await q(env, `UPDATE messages SET created_at = now() - interval '2 hours' WHERE id = $1`, [post.json.id]);
  const ed = await call('cara', 'PATCH', `/messages/${post.json.id}`, { text: 'Lesson notes (updated)' });
  assert.equal(ed.status, 200, JSON.stringify(ed.json));
  const one1 = await call('dan', 'GET', `/messages/${shared.id}`);
  assert.equal(one1.json.shared.text, 'Lesson notes (updated)'); assert.ok(one1.json.shared.editedAt);
  // members react and reply (comment) on the reference
  assert.equal((await call('dan', 'POST', `/messages/${shared.id}/react`, { emoji: '🙏' })).status, 200);
  const reply = await call('ann', 'POST', `/conversations/${exec}/messages`, { text: 'Thank you!', replyTo: shared.id });
  assert.equal(reply.status, 201, JSON.stringify(reply.json));
  // comments off → replies blocked (even through the API); members can't switch it
  assert.equal((await call('dan', 'POST', `/messages/${post.json.id}/comments`, { enabled: false })).status, 403);
  const off = await call('cara', 'POST', `/messages/${post.json.id}/comments`, { enabled: false });
  assert.equal(off.json.commentsOff, true);
  assert.equal((await call('dan', 'GET', `/messages/${shared.id}`)).json.shared.commentsOff, true);
  const blocked = await call('ann', 'POST', `/conversations/${exec}/messages`, { text: 'One more', replyTo: shared.id });
  assert.equal(blocked.status, 403); assert.equal(blocked.json.code, 'COMMENTS_OFF');
  assert.equal((await call('cara', 'POST', `/messages/${post.json.id}/comments`, { enabled: true })).json.commentsOff, false);
  assert.equal((await call('ann', 'POST', `/conversations/${exec}/messages`, { text: 'One more', replyTo: shared.id })).status, 201);
  // forwarding the reference forwards the original (the reference itself is empty)
  const fw = await call('dan', 'POST', `/messages/${shared.id}/forward`, { conversationIds: [exec] });
  assert.equal(fw.json.results[0].ok, true, JSON.stringify(fw.json)); assert.equal(fw.json.results[0].message.text, 'Lesson notes (updated)');
  // delete the original → the reference is tombstoned
  assert.equal((await call('cara', 'POST', `/messages/${post.json.id}/delete`, { for: 'everyone' })).status, 200);
  const gone = await call('dan', 'GET', `/messages/${shared.id}`);
  assert.equal(gone.json.deleted, true); assert.equal(gone.json.shared, null);
  assert.equal((await one(env, 'SELECT deleted FROM messages WHERE id = $1', [shared.id])).deleted, true);
});

test('admin permissions are enforced per admin and apply to both sections', async () => {
  const add = await call('cara', 'POST', `/memberships/${mem.id}/group/admins`, { handle: 'eddie', permissions: { publish: false, deleteMessages: false, pin: true, manageMembers: true, manageSettings: false, inviteMembers: true } });
  assert.equal(add.status, 201, JSON.stringify(add.json));
  const roles = await q(env, 'SELECT conversation_id, role FROM conversation_members WHERE user_id = $1 AND conversation_id = ANY($2::uuid[])', [ids.ed, [master, exec]]);
  assert.equal(roles.length, 2); assert.ok(roles.every((r) => r.role === 'admin'), 'reuses the chat admin role in both sections');
  // members can't add admins; admins can't either (owner only)
  assert.equal((await call('dan', 'POST', `/memberships/${mem.id}/group/admins`, { userId: ids.ben })).json.code, 'OWNER_ONLY');
  assert.equal((await call('ed', 'POST', `/memberships/${mem.id}/group/admins`, { userId: ids.ben })).json.code, 'OWNER_ONLY');
  // no publish permission
  assert.equal((await call('ed', 'POST', `/conversations/${master}/messages`, { text: 'Admin post' })).json.code, 'MASTER_CLASS_PUBLISHERS_ONLY');
  // no delete permission (someone else's message)
  const dm = await call('dan', 'POST', `/conversations/${exec}/messages`, { text: 'please do not delete me' });
  assert.equal((await call('ed', 'POST', `/messages/${dm.json.id}/delete`, { for: 'everyone' })).json.code, 'NOT_ALLOWED');
  // pin permission yes; members no
  assert.equal((await call('ed', 'POST', `/messages/${dm.json.id}/pin`, { pinned: true })).status, 200);
  assert.equal((await call('dan', 'POST', `/messages/${dm.json.id}/pin`, { pinned: false })).status, 403);
  // no settings permission
  assert.equal((await call('ed', 'PATCH', `/memberships/${mem.id}/group`, { settings: { memberMessaging: 'admins' } })).json.code, 'PERMISSION_REQUIRED');
  // the owner grants publish + delete → both work
  const upd = await call('cara', 'PATCH', `/memberships/${mem.id}/group/admins/${ids.ed}`, { permissions: { publish: true, deleteMessages: true } });
  assert.equal(upd.json.permissions.publish, true); assert.equal(upd.json.permissions.pin, true, 'others kept');
  assert.equal((await call('ed', 'POST', `/conversations/${master}/messages`, { text: 'Admin post' })).status, 201);
  assert.equal((await call('ed', 'POST', `/messages/${dm.json.id}/delete`, { for: 'everyone' })).status, 200);
  const list = await call('cara', 'GET', `/memberships/${mem.id}/group/admins`);
  assert.equal(list.json.owner.id, ids.cara);
  assert.ok(list.json.items.find((a) => a.id === ids.ed && a.permissions.publish));
});

test('the owner can’t be removed, banned, muted or demoted by an admin (group routes and chat routes)', async () => {
  for (const action of ['remove', 'ban', 'mute']) {
    const r = await call('ed', 'POST', `/memberships/${mem.id}/group/members/${ids.cara}`, { action });
    assert.equal(r.status, 403); assert.equal(r.json.code, 'OWNER_PROTECTED', action);
  }
  assert.equal((await call('ed', 'DELETE', `/memberships/${mem.id}/group/admins/${ids.cara}`)).json.code, 'OWNER_PROTECTED');
  assert.equal((await call('boss', 'DELETE', `/memberships/${mem.id}/group/admins/${ids.cara}`)).json.code, 'OWNER_PROTECTED', 'not even a platform admin');
  for (const [method, path, b] of [
    ['POST', `/conversations/${exec}/members/${ids.cara}/role`, { role: 'member' }],
    ['DELETE', `/conversations/${exec}/members/${ids.cara}?ban=1`, undefined],
    ['POST', `/conversations/${master}/transfer`, { userId: ids.ed }],
    ['PATCH', `/conversations/${exec}/settings`, { sendMessages: 'admins' }],
  ]) {
    const r = await call('ed', method, path, b);
    assert.equal(r.status, 403, path); assert.equal(r.json.code, 'MEMBERSHIP_MANAGED', path);
  }
  const roles = await q(env, 'SELECT role FROM conversation_members WHERE user_id = $1 AND conversation_id = ANY($2::uuid[])', [ids.cara, [master, exec]]);
  assert.ok(roles.length === 2 && roles.every((r) => r.role === 'owner'));
  // admins can't act on other admins either; the owner can
  await call('cara', 'POST', `/memberships/${mem.id}/group/admins`, { userId: ids.ben, permissions: { manageMembers: true } });
  assert.equal((await call('ed', 'POST', `/memberships/${mem.id}/group/members/${ids.ben}`, { action: 'mute', minutes: 5 })).json.code, 'OWNER_ONLY');
  assert.equal((await call('cara', 'DELETE', `/memberships/${mem.id}/group/admins/${ids.ben}`)).status, 200);
  assert.equal(await one(env, 'SELECT 1 AS x FROM conversation_members WHERE user_id = $1 AND conversation_id = $2', [ids.ben, exec]), null, 'no subscription → leaves both sections');
});

test('a time-limited mute in EXECUTIVE CLASS blocks sending until it expires', async () => {
  const m = await call('ed', 'POST', `/memberships/${mem.id}/group/members/${ids.dan}`, { action: 'mute', minutes: 30 });
  assert.equal(m.status, 200, JSON.stringify(m.json)); assert.ok(m.json.mutedUntil);
  const r = await call('dan', 'POST', `/conversations/${exec}/messages`, { text: 'hello?' });
  assert.equal(r.status, 403); assert.equal(r.json.code, 'MUTED'); assert.ok(r.json.mutedUntil);
  const th = await call('dan', 'GET', `/conversations/${exec}/messages`);
  assert.equal(th.json.permissions.canSend, false); assert.ok(th.json.membershipGroup.mutedUntil);
  const muted = await call('ed', 'GET', `/memberships/${mem.id}/group/members?filter=muted`);
  assert.deepEqual(muted.json.items.map((x) => x.id), [ids.dan]);
  // time passes
  await q(env, `UPDATE membership_member_prefs SET muted_until = now() - interval '1 second' WHERE user_id = $1`, [ids.dan]);
  assert.equal((await call('dan', 'POST', `/conversations/${exec}/messages`, { text: 'back again' })).status, 201);
  assert.equal((await call('ed', 'GET', `/memberships/${mem.id}/group/members?filter=muted`)).json.items.length, 0);
});

test('notification settings: MASTER CLASS on/off, EXECUTIVE CLASS all / mentions only / off', async () => {
  const set = await call('dan', 'PUT', `/memberships/${mem.id}/group/notifications`, { master: false, executive: 'mentions' });
  assert.deepEqual(set.json, { master: false, executive: 'mentions' });
  assert.equal((await call('dan', 'PUT', `/memberships/${mem.id}/group/notifications`, { executive: 'loud' })).status, 400);
  const post = await call('cara', 'POST', `/conversations/${master}/messages`, { text: 'New lesson: Psalm 23' });
  assert.equal(await notifCount('dan', post.json.id), 0, 'MASTER CLASS off');
  assert.equal(await notifCount('ann', post.json.id), 1, 'default on');
  const inbox = await one(env, `SELECT title, body FROM notifications WHERE user_id = $1 AND data->>'messageId' = $2`, [ids.ann, post.json.id]);
  assert.equal(inbox.title, 'MASTER CLASS · School of Prayer'); assert.match(inbox.body, /New post: New lesson/);
  const plain = await call('ann', 'POST', `/conversations/${exec}/messages`, { text: 'Morning all' });
  assert.equal(await notifCount('dan', plain.json.id), 0, 'mentions only');
  assert.equal(await notifCount('cara', plain.json.id), 1);
  const mention = await call('ann', 'POST', `/conversations/${exec}/messages`, { text: '@dan see this', meta: { mentions: [ids.dan] } });
  assert.equal(await notifCount('dan', mention.json.id), 1, 'a mention gets through');
  await call('cara', 'PUT', `/memberships/${mem.id}/group/notifications`, { executive: 'off' });
  const off = await call('ann', 'POST', `/conversations/${exec}/messages`, { text: '@cara hi', meta: { mentions: [ids.cara] } });
  assert.equal(await notifCount('cara', off.json.id), 0, 'off = nothing');
  const t = await one(env, `SELECT title FROM notifications WHERE user_id = $1 AND data->>'messageId' = $2`, [ids.dan, mention.json.id]);
  assert.equal(t.title, 'EXECUTIVE CLASS · School of Prayer');
});

test('history visibility "from join time" hides older messages from new members only', async () => {
  const old = await call('cara', 'POST', `/conversations/${master}/messages`, { text: 'Old secret lesson' });
  await q(env, `UPDATE messages SET created_at = created_at - interval '5 minutes' WHERE conversation_id = ANY($1::uuid[])`, [[master, exec]]);
  await q(env, `UPDATE membership_member_prefs SET joined_at = joined_at - interval '10 minutes' WHERE membership_id = $1`, [mem.id]); // earlier members joined before all of it
  const r = await call('cara', 'PATCH', `/memberships/${mem.id}/group`, { settings: { history: 'since_join' } });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.settings.history, 'since_join');
  await grant('gus');
  const fresh = await call('cara', 'POST', `/conversations/${master}/messages`, { text: 'Fresh lesson' });
  const gm = await call('gus', 'GET', `/conversations/${master}/messages`);
  assert.equal(gm.status, 200);
  assert.ok(!gm.json.items.some((x) => x.id === old.json.id), 'older post hidden');
  assert.ok(gm.json.items.some((x) => x.id === fresh.json.id), 'new post visible');
  assert.ok(!(await call('gus', 'GET', `/conversations/${exec}/messages?limit=50`)).json.items.some((x) => x.kind === 'shared_post' && x.shared && x.shared.id === old.json.id));
  assert.equal((await call('gus', 'GET', `/messages/${old.json.id}`)).status, 404);
  assert.equal((await call('gus', 'GET', `/conversations/${master}/search?q=secret`)).json.items.length, 0);
  // older members and the owner still see everything
  assert.ok((await call('dan', 'GET', `/conversations/${master}/messages?limit=50`)).json.items.some((x) => x.id === old.json.id));
  assert.ok((await call('cara', 'GET', `/conversations/${master}/messages?limit=50`)).json.items.some((x) => x.id === old.json.id));
  await call('cara', 'PATCH', `/memberships/${mem.id}/group`, { settings: { history: 'all' } });
  assert.ok((await call('gus', 'GET', `/conversations/${master}/messages?limit=50`)).json.items.some((x) => x.id === old.json.id), 'setting back to all');
});

test('group settings: member messaging, media uploads, private visibility', async () => {
  await call('cara', 'PATCH', `/memberships/${mem.id}/group`, { settings: { mediaUploads: 'admins' } });
  const media = await call('ann', 'POST', `/conversations/${exec}/messages`, { kind: 'file', mediaKey: `chat/${exec}/file_x.pdf`, meta: { name: 'x.pdf' } });
  assert.equal(media.status, 403); assert.equal(media.json.code, 'MEDIA_ADMINS_ONLY');
  assert.equal((await call('ann', 'POST', `/conversations/${exec}/messages`, { text: 'text still fine' })).status, 201);
  await call('cara', 'PATCH', `/memberships/${mem.id}/group`, { settings: { memberMessaging: 'admins', mediaUploads: 'all' } });
  assert.equal((await call('ann', 'POST', `/conversations/${exec}/messages`, { text: 'quiet?' })).status, 403);
  assert.equal((await call('ed', 'POST', `/conversations/${exec}/messages`, { text: 'admins still talk' })).status, 201);
  await call('cara', 'PATCH', `/memberships/${mem.id}/group`, { settings: { memberMessaging: 'all' } });
  assert.equal((await call('ann', 'POST', `/conversations/${exec}/messages`, { text: 'open again' })).status, 201);
  assert.equal((await call('cara', 'PATCH', `/memberships/${mem.id}/group`, { settings: { history: 'sometimes' } })).json.code, 'BAD_SETTING');
  // private: out of the catalogue, still reachable directly
  assert.equal((await call('hal', 'GET', '/memberships')).json.total, 1);
  await call('cara', 'PATCH', `/memberships/${mem.id}/group`, { settings: { visibility: 'private' } });
  assert.equal((await call('hal', 'GET', '/memberships')).json.total, 0);
  assert.equal((await call('hal', 'GET', `/memberships/${mem.id}`)).status, 200);
  await call('cara', 'PATCH', `/memberships/${mem.id}/group`, { settings: { visibility: 'public' } });
  // renaming the group renames both sections
  await call('cara', 'PATCH', `/memberships/${mem.id}/group`, { title: 'School of Prayer 2' });
  assert.equal((await one(env, 'SELECT title FROM conversations WHERE id = $1', [exec])).title, 'School of Prayer 2 · EXECUTIVE CLASS');
  await call('cara', 'PATCH', `/memberships/${mem.id}/group`, { title: 'School of Prayer' });
});

test('approval-based joining: a paid subscriber is approved before checkout', async () => {
  await call('cara', 'PATCH', `/memberships/${mem.id}/group`, { settings: { joinMode: 'approval' } });
  env.MEMBERSHIP_TESTERS = 'fay';
  const co = { planId: plan.id, provider: 'test', agree: true };
  const first = await call('fay', 'POST', `/memberships/${mem.id}/checkout`, co);
  assert.equal(first.status, 403); assert.equal(first.json.code, 'APPROVAL_REQUIRED');
  const page = await call('fay', 'GET', `/memberships/${mem.id}`);
  assert.equal(page.json.joinMode, 'approval'); assert.equal(page.json.joinRequest, null);
  assert.equal((await call('fay', 'POST', `/memberships/${mem.id}/join-request`)).json.status, 'pending');
  assert.equal((await call('fay', 'POST', `/memberships/${mem.id}/checkout`, co)).json.requestStatus, 'pending');
  assert.equal((await call('dan', 'GET', `/memberships/${mem.id}/group/requests`)).json.code, 'PERMISSION_REQUIRED');
  const reqs = await call('ed', 'GET', `/memberships/${mem.id}/group/requests`);
  assert.deepEqual(reqs.json.items.map((x) => x.id), [ids.fay]);
  const ok = await call('ed', 'POST', `/memberships/${mem.id}/group/requests/${ids.fay}`, { approve: true });
  assert.equal(ok.json.approved, true); assert.equal(ok.json.joined, false, 'paid: approved, then they pay');
  const paid = await call('fay', 'POST', `/memberships/${mem.id}/checkout`, co);
  assert.equal(paid.status, 200, JSON.stringify(paid.json)); assert.equal(paid.json.access.active, true);
  assert.equal((await call('fay', 'GET', `/conversations/${exec}/messages`)).status, 200);
  delete env.MEMBERSHIP_TESTERS;
  await call('cara', 'PATCH', `/memberships/${mem.id}/group`, { settings: { joinMode: 'open' } });
});

test('free group: open join, approval join, invite links (free joins, paid opens the membership page)', async () => {
  const f = (await call('boss', 'POST', '/memberships/manage', { title: 'Free Bible Circle', ownerUserId: ids.cara })).json;
  await call('boss', 'POST', `/memberships/manage/${f.id}/plans`, { name: 'Free', priceMinor: 0, interval: 'one_time' });
  const pub = (await call('boss', 'POST', `/memberships/manage/${f.id}/publish`)).json;
  assert.equal((await call('hal', 'GET', `/memberships/${f.id}`)).json.free, true);
  // paid group can't be joined for free
  assert.equal((await call('hal', 'POST', `/memberships/${mem.id}/join`)).json.code, 'NOT_FREE');
  // invite link (owner) → free + open joins straight away
  const inv = await call('cara', 'POST', `/memberships/${f.id}/group/invite`, {});
  assert.equal(inv.status, 200, JSON.stringify(inv.json)); assert.match(inv.json.url, /\/g\//);
  const prev = await call('hal', 'GET', `/invites/${inv.json.code}`);
  assert.equal(prev.json.kind, 'membership'); assert.equal(prev.json.free, true); assert.equal(prev.json.membershipId, f.id);
  const join = await call('hal', 'POST', `/invites/${inv.json.code}/join`);
  assert.equal(join.status, 201, JSON.stringify(join.json)); assert.equal(join.json.status, 'member');
  const sub = await one(env, 'SELECT source, status FROM membership_subscriptions WHERE membership_id = $1 AND user_id = $2', [f.id, ids.hal]);
  assert.equal(sub.source, 'free');
  assert.equal((await call('hal', 'GET', `/conversations/${pub.communityId}/messages`)).status, 200);
  // members can't share the link unless the group allows it
  assert.equal((await call('hal', 'POST', `/memberships/${f.id}/group/invite`, {})).json.code, 'PERMISSION_REQUIRED');
  await call('cara', 'PATCH', `/memberships/${f.id}/group`, { settings: { memberInvites: 'all', joinMode: 'approval' } });
  assert.equal((await call('hal', 'POST', `/memberships/${f.id}/group/invite`, {})).status, 200);
  // approval: free join becomes a request; approving joins them
  const ask = await call('gus', 'POST', `/memberships/${f.id}/join`);
  assert.equal(ask.status, 202); assert.equal(ask.json.status, 'requested');
  const appr = await call('cara', 'POST', `/memberships/${f.id}/group/requests/${ids.gus}`, { approve: true });
  assert.equal(appr.json.joined, true);
  assert.equal((await call('gus', 'GET', `/memberships/${f.id}/home`)).status, 200);
  // paid group's link → open the membership page, no access granted
  const pinv = await call('cara', 'POST', `/memberships/${mem.id}/group/invite`, {});
  const pp = await call('hal', 'GET', `/invites/${pinv.json.code}`);
  assert.equal(pp.json.kind, 'membership'); assert.equal(pp.json.free, false);
  const pj = await call('hal', 'POST', `/invites/${pinv.json.code}/join`);
  assert.equal(pj.status, 200); assert.equal(pj.json.status, 'membership'); assert.equal(pj.json.membershipId, mem.id);
  assert.equal((await call('hal', 'GET', `/conversations/${exec}/messages`)).json.code, 'MEMBERSHIP_REQUIRED');
});

test('members list, search, ban (both sections, no way back by paying) and unban', async () => {
  const all = await call('ed', 'GET', `/memberships/${mem.id}/group/members`);
  assert.equal(all.json.items[0].id, ids.cara); assert.equal(all.json.items[0].role, 'owner');
  assert.ok(all.json.items.find((x) => x.id === ids.ed).role === 'admin');
  const s = await call('dan', 'GET', `/memberships/${mem.id}/group/members?q=ann`);
  assert.deepEqual(s.json.items.map((x) => x.id), [ids.ann]);
  assert.equal(s.json.items[0].membership, undefined, 'members don’t see subscription details');
  assert.equal((await call('dan', 'POST', `/memberships/${mem.id}/group/members/${ids.ann}`, { action: 'ban' })).json.code, 'PERMISSION_REQUIRED');
  assert.equal((await call('ed', 'POST', `/memberships/${mem.id}/group/members/${ids.ann}`, { action: 'ban' })).status, 200);
  assert.equal((await call('ann', 'GET', `/conversations/${exec}/messages`)).status, 403);
  assert.equal((await call('ann', 'GET', `/conversations/${master}/messages`)).status, 403);
  env.MEMBERSHIP_TESTERS = 'ann';
  assert.equal((await call('ann', 'POST', `/memberships/${mem.id}/checkout`, { planId: plan.id, provider: 'test', agree: true })).json.code, 'BANNED');
  delete env.MEMBERSHIP_TESTERS;
  assert.deepEqual((await call('ed', 'GET', `/memberships/${mem.id}/group/members?filter=banned`)).json.items.map((x) => x.id), [ids.ann]);
  assert.equal((await call('ed', 'POST', `/memberships/${mem.id}/group/members/${ids.ann}`, { action: 'unban' })).status, 200);
  assert.equal((await call('ann', 'GET', `/conversations/${exec}/messages`)).status, 200, 'still subscribed → back in');
  // overview for the app
  const ov = await call('dan', 'GET', `/memberships/${mem.id}/group`);
  assert.equal(ov.json.sections.master.name, 'MASTER CLASS'); assert.equal(ov.json.me.role, 'member');
  assert.equal(ov.json.me.permissions.publish, false); assert.equal(ov.json.welcomeMessage, undefined);
});
