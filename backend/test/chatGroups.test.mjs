// CHAT 7.3 / 7.4 — group roles & permissions, invite links, join approval, system messages, shared media,
// files in chat, forwarding, typing, receipts, presence privacy and search.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true' };
});
async function raw(user, method, path, { body, headers = {} } = {}) {
  const h = { 'X-Dev-User': user, ...headers };
  let b = body;
  if (body !== undefined && !(body instanceof Uint8Array)) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${path}`, { method, headers: h, body: b }), env);
  const ct = res.headers.get('Content-Type') || '';
  if (!ct.includes('json')) return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()), headers: res.headers };
  return { status: res.status, json: await res.json() };
}
const call = (u, m, p, body) => raw(u, m, p, { body });
const send = (u, conv, text, extra = {}) => call(u, 'POST', `/conversations/${conv}/messages`, { kind: 'text', text, clientId: `c_${Math.random()}`, ...extra });
const msgs = async (u, conv) => (await call(u, 'GET', `/conversations/${conv}/messages?limit=50`)).json;
const ids = {};
let g;

test('setup: grace creates a group with daniel and paul', async () => {
  for (const u of ['grace', 'daniel', 'paul', 'ruth', 'silas', 'tim']) ids[u] = (await call(u, 'GET', '/me')).json.id;
  for (const [u, n] of [['grace', 'Grace'], ['daniel', 'Daniel'], ['paul', 'Paul'], ['ruth', 'Ruth'], ['silas', 'Silas'], ['tim', 'Tim']]) await call(u, 'PUT', '/me', { displayName: n });
  const r = await call('grace', 'POST', '/conversations/group', { title: 'Youth Choir', description: 'Sunday 4pm', memberIds: [ids.daniel, ids.paul] });
  assert.equal(r.status, 201);
  g = r.json.id;
});

test('system messages: created + "Grace added Daniel and Paul"; not unread, not reactable', async () => {
  const items = (await msgs('daniel', g)).items;
  const sys = items.filter((m) => m.kind === 'system').map((m) => m.text);
  assert.ok(sys.some((t) => /Grace created the group/.test(t)));
  assert.ok(sys.includes('Grace added Daniel and Paul'));
  const conv = (await call('paul', 'GET', '/conversations')).json.items.find((c) => c.id === g);
  assert.equal(conv.unreadCount, 0, 'system lines are not unread');
  const sysId = items.find((m) => m.kind === 'system').id;
  assert.equal((await call('daniel', 'POST', `/messages/${sysId}/react`, { emoji: '🙏' })).status, 400);
  assert.equal((await send('daniel', g, 'x', { meta: { system: { action: 'added' } } })).json.code, 'BAD_META');
});

test('Group Info: member count, admins, full member list with role badges and "added by"', async () => {
  const info = (await call('daniel', 'GET', `/conversations/${g}/info`)).json;
  assert.equal(info.membersCount, 3);
  assert.equal(info.myRole, 'member');
  assert.equal(info.title, 'Youth Choir');
  assert.deepEqual(info.admins.map((a) => [a.displayName, a.role]), [['Grace', 'owner']]);
  assert.equal(info.permissions.canAddMembers, false);
  assert.equal(info.inviteCode, null, 'members do not see the invite link by default');
  const members = (await call('daniel', 'GET', `/conversations/${g}/members`)).json.items;
  assert.equal(members.length, 3);
  assert.equal(members[0].isMe, true);
  const paul = members.find((m) => m.id === ids.paul);
  assert.equal(paul.role, 'member');
  assert.equal(paul.addedBy.displayName, 'Grace');
  assert.equal(paul.isNew, true);
  assert.equal((await call('daniel', 'GET', `/conversations/${g}/members?q=pau`)).json.items.length, 1);
  assert.equal((await call('ruth', 'GET', `/conversations/${g}/members`)).status, 403, 'outsiders cannot list members');
});

test('roles: owner promotes admin/moderator; admins cannot touch other admins or the owner', async () => {
  assert.equal((await call('daniel', 'POST', `/conversations/${g}/members/${ids.paul}/role`, { role: 'admin' })).status, 403);
  assert.equal((await call('grace', 'POST', `/conversations/${g}/members/${ids.daniel}/role`, { role: 'admin' })).status, 200);
  assert.equal((await call('daniel', 'POST', `/conversations/${g}/members/${ids.paul}/role`, { role: 'moderator' })).status, 200);
  assert.equal((await call('daniel', 'POST', `/conversations/${g}/members/${ids.grace}/role`, { role: 'member' })).status, 403);
  assert.equal((await call('grace', 'POST', `/conversations/${g}/members/${ids.paul}/role`, { role: 'owner' })).status, 400);
  const sys = (await msgs('paul', g)).items.filter((m) => m.kind === 'system').map((m) => m.text);
  assert.ok(sys.includes('Grace made Daniel an admin'));
  assert.ok(sys.includes('Daniel made Paul a moderator'));
  const info = (await call('paul', 'GET', `/conversations/${g}/info`)).json;
  assert.deepEqual(info.admins.map((a) => a.role), ['owner', 'admin', 'moderator']);
  assert.equal(info.permissions.isModerator, true);
  assert.equal(info.permissions.canRemoveMembers, false);
});

test('moderators can delete others’ messages and pin; members cannot', async () => {
  const m = (await send('daniel', g, 'hello choir')).json;
  assert.equal((await call('ruth', 'POST', `/messages/${m.id}/pin`, { pinned: true })).status, 404);
  assert.equal((await call('paul', 'POST', `/messages/${m.id}/pin`, { pinned: true })).status, 200);
  const spam = (await send('grace', g, 'oops')).json;
  assert.equal((await call('paul', 'POST', `/messages/${spam.id}/delete`, { for: 'everyone' })).status, 200);
});

test('add members: admins add (system line + added by); settings can open it to everyone', async () => {
  assert.equal((await call('paul', 'POST', `/conversations/${g}/members`, { userIds: [ids.ruth] })).status, 403);
  const r = await call('daniel', 'POST', `/conversations/${g}/members`, { userIds: [ids.ruth] });
  assert.equal(r.json.added, 1);
  const ruth = (await call('grace', 'GET', `/conversations/${g}/members`)).json.items.find((m) => m.id === ids.ruth);
  assert.equal(ruth.addedBy.displayName, 'Daniel');
  assert.ok((await msgs('ruth', g)).items.some((m) => m.text === 'Daniel added Ruth'));
  // members can't change settings
  assert.equal((await call('ruth', 'PATCH', `/conversations/${g}/settings`, { addMembers: 'all' })).status, 403);
  assert.equal((await call('grace', 'PATCH', `/conversations/${g}/settings`, { addMembers: 'all' })).json.settings.addMembers, 'all');
  assert.equal((await call('ruth', 'POST', `/conversations/${g}/members`, { userIds: [ids.silas] })).json.added, 1);
  await call('grace', 'PATCH', `/conversations/${g}/settings`, { addMembers: 'admins' });
});

test('remove: admins remove members ("Grace removed Silas"); admins cannot remove the owner', async () => {
  assert.equal((await call('ruth', 'DELETE', `/conversations/${g}/members/${ids.silas}`)).status, 403);
  assert.equal((await call('daniel', 'DELETE', `/conversations/${g}/members/${ids.grace}`)).status, 403);
  assert.equal((await call('grace', 'DELETE', `/conversations/${g}/members/${ids.silas}`)).status, 200);
  assert.equal((await send('silas', g, 'still here?')).status, 403);
  assert.ok((await msgs('grace', g)).items.some((m) => m.text === 'Grace removed Silas'));
});

test('permissions: only admins send; edit info; slow mode — all enforced on the server', async () => {
  await call('grace', 'PATCH', `/conversations/${g}/settings`, { sendMessages: 'admins' });
  assert.equal((await send('ruth', g, 'can I talk?')).json.code, 'ADMINS_ONLY_SEND');
  assert.equal((await send('paul', g, 'moderators can')).status, 201);
  const ruthConv = (await call('ruth', 'GET', '/conversations')).json.items.find((c) => c.id === g);
  assert.equal(ruthConv.canMessage, false);
  await call('grace', 'PATCH', `/conversations/${g}/settings`, { sendMessages: 'all', slowModeSec: 30 });
  assert.equal((await send('ruth', g, 'first')).status, 201);
  assert.equal((await send('ruth', g, 'second')).json.code, 'SLOW_MODE');
  assert.equal((await send('daniel', g, 'admins skip slow mode')).status, 201);
  assert.equal((await send('daniel', g, 'again')).status, 201);
  assert.equal((await call('grace', 'PATCH', `/conversations/${g}/settings`, { slowModeSec: 7 })).status, 400);
  await call('grace', 'PATCH', `/conversations/${g}/settings`, { slowModeSec: 0 });
  // edit info
  assert.equal((await call('ruth', 'PATCH', `/conversations/${g}`, { title: 'Hijacked' })).status, 403);
  const ed = await call('daniel', 'PATCH', `/conversations/${g}`, { title: 'Youth Choir 2026', description: 'Sundays' });
  assert.equal(ed.json.title, 'Youth Choir 2026');
  assert.ok((await msgs('ruth', g)).items.some((m) => m.text === 'Daniel changed the group name to “Youth Choir 2026”'));
  assert.equal((await call('daniel', 'PATCH', `/conversations/${g}`, { avatarKey: `img/${ids.grace}/x.jpg` })).json.code, 'BAD_MEDIA');
});

test('invite links: admins get a link; joining adds you; reset kills the old link; approval mode queues requests', async () => {
  assert.equal((await call('ruth', 'POST', `/conversations/${g}/invite`)).status, 403);
  const inv = (await call('daniel', 'POST', `/conversations/${g}/invite`)).json;
  assert.match(inv.code, /^[A-Za-z0-9]{12}$/);
  assert.equal((await call('daniel', 'POST', `/conversations/${g}/invite`)).json.code, inv.code, 'stable until reset');
  const prev = (await call('tim', 'GET', `/invites/${inv.code}`)).json;
  assert.equal(prev.title, 'Youth Choir 2026');
  assert.equal(prev.isMember, false);
  const j = await call('tim', 'POST', `/invites/${inv.code}/join`);
  assert.equal(j.json.status, 'member');
  assert.ok((await msgs('tim', g)).items.some((m) => m.text === 'Tim joined using the invite link'));
  const reset = (await call('grace', 'POST', `/conversations/${g}/invite`, { reset: true })).json;
  assert.notEqual(reset.code, inv.code);
  assert.equal((await call('silas', 'GET', `/invites/${inv.code}`)).status, 404);
  // approval on → silas asks, a moderator approves
  await call('grace', 'PATCH', `/conversations/${g}/settings`, { approveJoins: true });
  const ask = await call('silas', 'POST', `/invites/${reset.code}/join`);
  assert.equal(ask.status, 202);
  assert.equal(ask.json.status, 'requested');
  assert.equal((await send('silas', g, 'let me in')).status, 403);
  assert.equal((await call('ruth', 'GET', `/conversations/${g}/requests`)).status, 403);
  const reqs = (await call('paul', 'GET', `/conversations/${g}/requests`)).json.items;
  assert.deepEqual(reqs.map((r) => r.id), [ids.silas]);
  assert.equal((await call('grace', 'GET', `/conversations/${g}/info`)).json.pendingRequests, 1);
  assert.equal((await call('paul', 'POST', `/conversations/${g}/requests/${ids.silas}`, { approve: true })).status, 200);
  assert.equal((await send('silas', g, 'thanks!')).status, 201);
  assert.ok((await msgs('silas', g)).items.some((m) => m.text === 'Paul approved Silas'));
});

test('leave: "Paul left"; transfer ownership keeps the old owner as admin', async () => {
  await call('paul', 'POST', `/conversations/${g}/leave`);
  assert.ok((await msgs('grace', g)).items.some((m) => m.text === 'Paul left'));
  assert.equal((await call('daniel', 'POST', `/conversations/${g}/transfer`, { userId: ids.ruth })).status, 403);
  assert.equal((await call('grace', 'POST', `/conversations/${g}/transfer`, { userId: ids.daniel })).status, 200);
  const info = (await call('grace', 'GET', `/conversations/${g}/info`)).json;
  assert.equal(info.myRole, 'admin');
  assert.equal(info.admins[0].id, ids.daniel);
  assert.equal(info.admins[0].role, 'owner');
});

test('files in chat + shared media tabs: photos, videos, docs, audio, links, other files', async () => {
  const pdf = await raw('ruth', 'POST', '/uploads/chat-file', { body: new Uint8Array([37, 80, 68, 70]), headers: { 'Content-Type': 'application/pdf', 'X-Conversation-Id': g, 'X-File-Name': encodeURIComponent('Song sheet.pdf') } });
  assert.equal(pdf.status, 201);
  assert.equal(pdf.json.kind, 'file');
  assert.ok(pdf.json.key.startsWith(`chat/${g}/file_`) && pdf.json.key.endsWith('.pdf'));
  assert.equal((await send('ruth', g, '', { kind: 'file', mediaKey: pdf.json.key, meta: { name: 'Song sheet.pdf', mime: 'application/pdf', size: 4 } })).status, 201);
  const zip = await raw('ruth', 'POST', '/uploads/chat-file', { body: new Uint8Array([80, 75]), headers: { 'Content-Type': 'application/zip', 'X-Conversation-Id': g, 'X-File-Name': 'slides.zip' } });
  await send('ruth', g, '', { kind: 'file', mediaKey: zip.json.key, meta: { name: 'slides.zip', mime: 'application/zip' } });
  const vid = await raw('ruth', 'POST', '/uploads/chat-file', { body: new Uint8Array([0, 0, 0, 24]), headers: { 'Content-Type': 'video/mp4', 'X-Conversation-Id': g, 'X-File-Name': 'clip.mp4' } });
  assert.equal(vid.json.kind, 'video');
  await send('ruth', g, 'rehearsal', { kind: 'video', mediaKey: vid.json.key, meta: { name: 'clip.mp4' } });
  const img = await raw('ruth', 'POST', '/uploads/chat-image', { body: new Uint8Array([137, 80, 78, 71]), headers: { 'Content-Type': 'image/png', 'X-Conversation-Id': g } });
  await send('ruth', g, '', { kind: 'image', mediaKey: img.json.key, meta: { width: 1, height: 1 } });
  const voice = await raw('ruth', 'POST', '/uploads/voice', { body: new Uint8Array([1, 2]), headers: { 'Content-Type': 'audio/m4a', 'X-Conversation-Id': g } });
  await send('ruth', g, '', { kind: 'voice', mediaKey: voice.json.key, meta: { durationMs: 42000 } });
  await send('ruth', g, 'Lyrics at https://example.org/hymn?id=4. See you');
  assert.equal((await raw('ruth', 'POST', '/uploads/chat-file', { body: new Uint8Array([1]), headers: { 'Content-Type': 'application/octet-stream', 'X-Conversation-Id': g, 'X-File-Name': 'run.exe' } })).status, 400);
  assert.equal((await raw('eve', 'POST', '/uploads/chat-file', { body: new Uint8Array([1]), headers: { 'Content-Type': 'application/pdf', 'X-Conversation-Id': g, 'X-File-Name': 'a.pdf' } })).status, 403);

  const tab = async (t) => (await call('tim', 'GET', `/conversations/${g}/media?type=${t}`)).json.items;
  assert.deepEqual((await tab('docs')).map((x) => x.meta.name), ['Song sheet.pdf']);
  assert.deepEqual((await tab('files')).map((x) => x.meta.name), ['slides.zip']);
  assert.equal((await tab('videos')).length, 1);
  assert.equal((await tab('photos')).length, 1);
  assert.equal((await tab('audio'))[0].meta.durationMs, 42000);
  const links = await tab('links');
  assert.equal(links[0].url, 'https://example.org/hymn?id=4');
  assert.equal(links[0].host, 'example.org');
  const counts = (await call('tim', 'GET', `/conversations/${g}/media/counts`)).json;
  assert.deepEqual(counts, { photos: 1, videos: 1, docs: 1, audio: 1, links: 1, files: 1 });
  // members can open the file; the list preview names it
  assert.equal((await raw('tim', 'GET', `/chat/media/${pdf.json.key}`)).status, 200);
  assert.equal((await call('eve', 'GET', `/conversations/${g}/media?type=docs`)).status, 403);
  const list = (await call('tim', 'GET', '/conversations')).json.items.find((c) => c.id === g);
  assert.equal(list.lastMessage.text, 'Lyrics at https://example.org/hymn?id=4. See you');
});

test('chat list previews: "🎤 Voice note (0:42)" and file names', async () => {
  const dm = (await call('ruth', 'POST', '/conversations/dm', { userId: ids.tim })).json.id;
  const voice = await raw('ruth', 'POST', '/uploads/voice', { body: new Uint8Array([1, 2]), headers: { 'Content-Type': 'audio/m4a', 'X-Conversation-Id': dm } });
  await send('ruth', dm, '', { kind: 'voice', mediaKey: voice.json.key, meta: { durationMs: 42000 } });
  assert.equal((await call('tim', 'GET', '/conversations')).json.items.find((c) => c.id === dm).lastMessage.text, '🎤 Voice note (0:42)');
});

test('forward: copies text and media into other chats (marked forwarded); not into chats you can’t post in', async () => {
  const dm = (await call('tim', 'POST', '/conversations/dm', { userId: ids.daniel })).json.id;
  const doc = (await call('tim', 'GET', `/conversations/${g}/media?type=docs`)).json.items[0];
  const r = await call('tim', 'POST', `/messages/${doc.messageId}/forward`, { conversationIds: [dm] });
  assert.equal(r.status, 200);
  const res = r.json.results[0];
  assert.equal(res.ok, true);
  assert.equal(res.message.meta.forwarded, true);
  assert.ok(res.message.mediaKey.startsWith(`chat/${dm}/`), 'the file is copied into the target chat');
  assert.equal((await raw('daniel', 'GET', `/chat/media/${res.message.mediaKey}`)).status, 200);
  const ch = (await call('grace', 'POST', '/channels', { title: 'Announcements' })).json.id;
  await call('tim', 'POST', `/channels/${ch}/follow`);
  const r2 = await call('tim', 'POST', `/messages/${doc.messageId}/forward`, { conversationIds: [ch] });
  assert.equal(r2.json.results[0].ok, false);
});

test('receipts, typing and presence (with last-seen privacy)', async () => {
  const dm = (await call('ruth', 'POST', '/conversations/dm', { userId: ids.silas })).json.id;
  const m = (await send('ruth', dm, 'are you there?')).json;
  // silas hasn't fetched anything yet → not delivered
  let r = (await msgs('ruth', dm)).receipts;
  assert.ok(!r.deliveredAt || r.deliveredAt < m.createdAt);
  await call('silas', 'GET', '/conversations'); // the app fetched the list → delivered
  r = (await msgs('ruth', dm)).receipts;
  assert.ok(r.deliveredAt >= m.createdAt, 'delivered');
  assert.ok(r.readAt < m.createdAt, 'not read yet');
  await call('silas', 'POST', `/conversations/${dm}/read`);
  r = (await msgs('ruth', dm)).receipts;
  assert.ok(r.readAt >= m.createdAt, 'read');
  // typing
  await call('silas', 'POST', `/conversations/${dm}/typing`, { typing: true });
  assert.deepEqual((await msgs('ruth', dm)).typing.map((t) => t.name), ['Silas']);
  assert.deepEqual((await call('ruth', 'GET', '/conversations')).json.items.find((c) => c.id === dm).typing, ['Silas']);
  await send('silas', dm, 'yes!');
  assert.equal((await msgs('ruth', dm)).typing.length, 0, 'sending clears typing');
  // presence + privacy
  const p = (await msgs('ruth', dm)).presence;
  assert.equal(p.online, true);
  assert.equal((await call('silas', 'PUT', '/me/chat-privacy', { lastSeen: 'nobody' })).json.lastSeen, 'nobody');
  const hidden = (await msgs('ruth', dm)).presence;
  assert.equal(hidden.hidden, true);
  assert.equal(hidden.lastSeenAt, null);
  // you can't see others' last seen while yours is hidden
  assert.equal((await call('silas', 'GET', `/users/${ids.ruth}/presence`)).json.hidden, true);
  await call('silas', 'PUT', '/me/chat-privacy', { lastSeen: 'everyone' });
  assert.equal((await call('silas', 'GET', `/users/${ids.ruth}/presence`)).json.online, true);
});

test('search within a chat and across chats; mute per chat; report', async () => {
  const across = (await call('ruth', 'GET', '/chats/search?q=lyrics')).json.items;
  assert.equal(across.length, 1);
  assert.equal(across[0].chatTitle, 'Youth Choir 2026');
  assert.equal((await call('ruth', 'GET', `/conversations/${g}/search?q=song sheet`)).json.items[0].kind, 'file');
  assert.equal((await call('eve', 'GET', `/conversations/${g}/search?q=lyrics`)).status, 403);
  assert.equal((await call('eve', 'GET', '/chats/search?q=lyrics')).json.items.length, 0, 'never leaks other chats');
  assert.equal((await call('tim', 'PUT', `/conversations/${g}/mute`, { muted: true })).json.muted, true);
  assert.equal((await call('tim', 'GET', `/conversations/${g}/info`)).json.muted, true);
  assert.equal((await call('tim', 'POST', `/conversations/${g}/report`, { reason: 'spam' })).status, 201);
});

test('@mentions notify even when the chat is muted', async () => {
  await send('daniel', g, '@Tim can you sing alto?', { meta: { mentions: [ids.tim] } });
  const notes = (await call('tim', 'GET', '/me/notifications')).json;
  const items = notes.items || notes;
  assert.ok(items.some((n) => /mentioned you/.test(n.body || '')));
});

test('signed links: members get a 2-hour link (+ pdf viewer); tampered or foreign links fail', async () => {
  const doc = (await call('tim', 'GET', `/conversations/${g}/media?type=docs`)).json.items[0];
  const link = (await call('tim', 'GET', `/chat/media-link?key=${encodeURIComponent(doc.mediaKey)}`)).json;
  assert.ok(link.viewerUrl.includes('/chat/viewer?file='));
  const path = link.url.replace('http://api.test', '');
  const ok = await app.fetch(new Request(`http://api.test${path}`), env); // no auth header
  assert.equal(ok.status, 200);
  assert.deepEqual([...new Uint8Array(await ok.arrayBuffer())], [37, 80, 68, 70]);
  const dl = await app.fetch(new Request(`http://api.test${path}&download=1&name=${encodeURIComponent('Song sheet.pdf')}`), env);
  assert.match(dl.headers.get('Content-Disposition'), /attachment; filename="Song sheet.pdf"/);
  const bad = await app.fetch(new Request(`http://api.test${path.replace(/sig=./, 'sig=0')}`), env);
  assert.equal(bad.status, 403);
  assert.equal((await call('eve', 'GET', `/chat/media-link?key=${encodeURIComponent(doc.mediaKey)}`)).status, 403);
  const viewer = await app.fetch(new Request(`http://api.test/chat/viewer?file=x`), env);
  const html = await viewer.text();
  assert.ok(html.includes(String.raw`\/chat\/file\/chat\/`) && !html.includes(String.raw`\/library\/file\/lib\/pdf\/`));
});
