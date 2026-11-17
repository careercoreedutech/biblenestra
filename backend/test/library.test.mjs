// MEDIA LIBRARY: uploads, permissions (only admins publish to the platform library, group roles),
// listing/search, private group files (signed links), Range streaming, progress, reports and admin routes.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', REALTIME_SECRET: 'rt-secret' };
  // dev user "boss" is a platform admin
  await env.__db.query(`INSERT INTO users (clerk_id, display_name, role) VALUES ('dev_boss', 'Boss', 'admin')`);
});

async function raw(user, method, p, { body, headers = {} } = {}) {
  const h = { ...headers };
  if (user) h['X-Dev-User'] = user;
  return app.fetch(new Request(`http://api.test${p}`, { method, headers: h, body }), env);
}
async function call(user, method, p, body) {
  const h = {};
  let b;
  if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await raw(user, method, p, { body: b, headers: h });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = text; }
  return { status: res.status, json };
}
const bytes = (n, fill = 7) => new Uint8Array(n).fill(fill);
const pdfBytes = () => { const b = bytes(2000, 32); b.set([0x25, 0x50, 0x44, 0x46, 0x2d], 0); return b; }; // "%PDF-"
async function uploadFile(user, kind, type, data) {
  const res = await raw(user, 'POST', `/library/files?kind=${kind}`, { body: data, headers: { 'Content-Type': type, 'Content-Length': String(data.byteLength) } });
  return { status: res.status, json: await res.json() };
}
const pathOf = (url) => { const u = new URL(url); return u.pathname + u.search; };

let cats; let sermonsId; let platformItem; let communityId;

test('categories are seeded for audio and PDF', async () => {
  const a = await call('alice', 'GET', '/library/categories?kind=audio');
  assert.equal(a.status, 200);
  cats = a.json.items;
  const names = cats.map((x) => x.name);
  for (const n of ['Sermons & Preaching', 'Worship & Songs', 'Audio Bible', 'Podcasts & Teaching', 'Prayer', 'Kids']) assert.ok(names.includes(n), n);
  sermonsId = cats.find((x) => x.slug === 'sermons').id;
  const p = await call('alice', 'GET', '/library/categories?kind=pdf');
  assert.ok(p.json.items.length >= 5);
});

test('file uploads: type checks, PDF magic bytes, signed preview link', async () => {
  assert.equal((await raw(null, 'POST', '/library/files?kind=audio', { body: bytes(10), headers: { 'Content-Type': 'audio/mpeg' } })).status, 401);
  const badType = await uploadFile('alice', 'audio', 'image/png', bytes(10));
  assert.equal(badType.status, 400);
  const notPdf = await raw('alice', 'POST', '/library/files?kind=pdf', { body: bytes(100), headers: { 'Content-Type': 'application/pdf' } }); // no length → buffered + sniffed
  assert.equal(notPdf.status, 400);
  const ok = await uploadFile('alice', 'audio', 'audio/mpeg', bytes(5000));
  assert.equal(ok.status, 201);
  assert.match(ok.json.key, /^lib\/audio\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.mp3$/);
  assert.match(ok.json.url, /\?exp=\d+&sig=/);
  // unattached file: unsigned link is refused, signed link works
  assert.equal((await raw(null, 'GET', `/library/file/${ok.json.key}`)).status, 403);
  assert.equal((await raw(null, 'GET', pathOf(ok.json.url))).status, 200);
  assert.equal((await raw(null, 'GET', `/library/file/${ok.json.key}?exp=9999999999&sig=forged`)).status, 403);
});

test('only admins publish to the platform library; PDFs need the rights attestation', async () => {
  const f = await uploadFile('alice', 'audio', 'audio/mpeg', bytes(3000));
  const denied = await call('alice', 'POST', '/library/items', { kind: 'audio', scope: 'platform', fileKey: f.json.key, title: 'Nope' });
  assert.equal(denied.status, 403);
  assert.equal(denied.json.code, 'NOT_ADMIN');
  // someone else's file key can't be attached
  const stolen = await call('boss', 'POST', '/library/items', { kind: 'audio', scope: 'platform', fileKey: f.json.key, title: 'Stolen' });
  assert.equal(stolen.status, 403);

  const af = await uploadFile('boss', 'audio', 'audio/mpeg', bytes(100000, 3));
  const cover = await raw('boss', 'POST', '/uploads/image', { body: bytes(50), headers: { 'Content-Type': 'image/jpeg' } });
  const coverKey = (await cover.json()).key;
  const made = await call('boss', 'POST', '/library/items', {
    kind: 'audio', scope: 'platform', fileKey: af.json.key, title: 'Grace that holds', artist: 'Pastor Ruth', description: 'Sunday sermon on Romans 8', categoryId: sermonsId, coverKey, durationSec: 1800, featured: true,
  });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  platformItem = made.json;
  assert.equal(platformItem.inLibrary, true);
  assert.equal(platformItem.category.name, 'Sermons & Preaching');
  assert.match(platformItem.coverUrl, /\/media\/img\//);
  assert.ok(!/sig=/.test(platformItem.fileUrl), 'published library files are open links');
  // same file twice → 409
  assert.equal((await call('boss', 'POST', '/library/items', { kind: 'audio', scope: 'platform', fileKey: af.json.key, title: 'Again' })).status, 409);

  const pf = await uploadFile('boss', 'pdf', 'application/pdf', pdfBytes());
  assert.equal(pf.status, 201);
  const noRights = await call('boss', 'POST', '/library/items', { kind: 'pdf', scope: 'platform', fileKey: pf.json.key, title: 'Pilgrim’s Progress', artist: 'John Bunyan' });
  assert.equal(noRights.status, 400);
  assert.equal(noRights.json.code, 'RIGHTS_REQUIRED');
  const book = await call('boss', 'POST', '/library/items', { kind: 'pdf', scope: 'platform', fileKey: pf.json.key, title: 'Pilgrim’s Progress', artist: 'John Bunyan', rightsAttested: true, rightsNote: 'Public domain (1678)' });
  assert.equal(book.status, 201);
  assert.equal(book.json.kind, 'pdf');
});

test('library listing, home, category filter and search are visible to every user', async () => {
  const home = await call('carol', 'GET', '/library/home?kind=audio');
  assert.equal(home.status, 200);
  const sermons = home.json.categories.find((x) => x.slug === 'sermons');
  assert.equal(sermons.items.length, 1);
  assert.equal(home.json.featured[0].title, 'Grace that holds');
  const byCat = await call('carol', 'GET', '/library/items?kind=audio&category=sermons');
  assert.equal(byCat.json.items.length, 1);
  const search = await call('carol', 'GET', '/library/items?kind=audio&q=ruth');
  assert.equal(search.json.items.length, 1);
  assert.equal((await call('carol', 'GET', '/library/items?kind=audio&q=zzz')).json.items.length, 0);
  assert.equal((await call('carol', 'GET', '/library/items?kind=pdf')).json.items[0].artist, 'John Bunyan');
  const cats2 = await call('carol', 'GET', '/library/categories?kind=audio');
  assert.equal(cats2.json.items.find((x) => x.slug === 'sermons').count, 1);
});

test('Range streaming: 206 partial content, suffix ranges, 416 and HEAD', async () => {
  const p = pathOf(platformItem.fileUrl);
  const full = await raw(null, 'GET', p);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  assert.equal(full.headers.get('content-length'), '100000');
  const part = await raw(null, 'GET', p, { headers: { Range: 'bytes=100-199' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 100-199/100000');
  assert.equal((await part.arrayBuffer()).byteLength, 100);
  const open = await raw(null, 'GET', p, { headers: { Range: 'bytes=99990-' } });
  assert.equal(open.status, 206);
  assert.equal((await open.arrayBuffer()).byteLength, 10);
  const suffix = await raw(null, 'GET', p, { headers: { Range: 'bytes=-500' } });
  assert.equal(suffix.headers.get('content-range'), 'bytes 99500-99999/100000');
  assert.equal((await raw(null, 'GET', p, { headers: { Range: 'bytes=200000-' } })).status, 416);
  const head = await raw(null, 'HEAD', p);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '100000');
  assert.equal((await raw(null, 'GET', '/library/file/lib/audio/../../etc/passwd')).status, 404);
});

test('group audio: owner/admins upload, members listen, outsiders cannot; admins can publish it', async () => {
  const comm = await call('gary', 'POST', '/communities', { name: 'Grace Choir', description: 'Our choir', privacy: 'Private' });
  assert.equal(comm.status, 201, JSON.stringify(comm.json));
  communityId = comm.json.id;
  // dave joins as a member
  const u = await call('dave', 'GET', '/me');
  const daveId = u.json.id || (u.json.user && u.json.user.id);
  await env.__db.query(`INSERT INTO community_members (community_id, user_id, role, status) VALUES ($1, $2, 'member', 'member')`, [communityId, daveId]);

  const df = await uploadFile('dave', 'audio', 'audio/mp4', bytes(2000));
  const memberTry = await call('dave', 'POST', '/library/items', { kind: 'audio', scope: 'group', communityId, fileKey: df.json.key, title: 'Rehearsal' });
  assert.equal(memberTry.status, 403);
  assert.equal(memberTry.json.code, 'NOT_GROUP_ADMIN');

  const gf = await uploadFile('gary', 'audio', 'audio/mp4', bytes(4000));
  const made = await call('gary', 'POST', '/library/items', { kind: 'audio', scope: 'group', communityId, fileKey: gf.json.key, title: 'Choir practice — Amazing Grace' });
  assert.equal(made.status, 201);
  const item = made.json;
  assert.equal(item.inLibrary, false);
  assert.match(item.fileUrl, /sig=/, 'group files get signed links');
  // promoted community admin can upload too
  await env.__db.query(`UPDATE community_members SET role = 'admin' WHERE community_id = $1 AND user_id = $2`, [communityId, daveId]);
  const df2 = await uploadFile('dave', 'audio', 'audio/mp4', bytes(2000));
  assert.equal((await call('dave', 'POST', '/library/items', { kind: 'audio', scope: 'group', communityId, fileKey: df2.json.key, title: 'Alto part' })).status, 201);

  const asMember = await call('dave', 'GET', `/library/items?kind=audio&scope=group&communityId=${communityId}`);
  assert.equal(asMember.json.items.length, 2);
  const outsider = await call('carol', 'GET', `/library/items?kind=audio&scope=group&communityId=${communityId}`);
  assert.equal(outsider.status, 403);
  assert.equal((await call('carol', 'GET', `/library/items/${item.id}`)).status, 404);
  // the unsigned file link is refused; the signed one streams
  assert.equal((await raw(null, 'GET', `/library/file/${gf.json.key}`)).status, 403);
  assert.equal((await raw(null, 'GET', pathOf(item.fileUrl), { headers: { Range: 'bytes=0-9' } })).status, 206);
  // not in the platform library
  assert.ok(!(await call('carol', 'GET', '/library/items?kind=audio')).json.items.some((x) => x.id === item.id));

  // the group owner can't publish it to the platform; an admin can
  assert.equal((await call('gary', 'POST', `/library/items/${item.id}/publish`, {})).status, 403);
  const pub = await call('boss', 'POST', `/library/items/${item.id}/publish`, { categoryId: cats.find((x) => x.slug === 'worship').id });
  assert.equal(pub.status, 200);
  assert.equal(pub.json.inLibrary, true);
  assert.ok((await call('carol', 'GET', '/library/items?kind=audio&category=worship')).json.items.some((x) => x.id === item.id));
  assert.equal((await raw(null, 'GET', `/library/file/${gf.json.key}`)).status, 200, 'now an open link');

  const groups = await call('dave', 'GET', '/library/my-groups');
  const g = groups.json.items.find((x) => x.id === communityId);
  assert.equal(g.canUpload, true);
  assert.equal(g.audioCount, 2);
});

test('personal audio: public on the profile, private only for the owner, not in the library', async () => {
  const f1 = await uploadFile('erin', 'audio', 'audio/mpeg', bytes(1000));
  const pub = await call('erin', 'POST', '/library/items', { kind: 'audio', fileKey: f1.json.key, title: 'My testimony' });
  assert.equal(pub.status, 201);
  assert.equal(pub.json.scope, 'personal');
  const f2 = await uploadFile('erin', 'audio', 'audio/mpeg', bytes(1000));
  const priv = await call('erin', 'POST', '/library/items', { kind: 'audio', fileKey: f2.json.key, title: 'Voice journal', visibility: 'private' });
  assert.match(priv.json.fileUrl, /sig=/);
  const mine = await call('erin', 'GET', '/library/items?kind=audio&scope=mine');
  assert.equal(mine.json.items.length, 2);
  const erinId = pub.json.owner.id;
  const seen = await call('carol', 'GET', `/library/items?kind=audio&scope=user&userId=${erinId}`);
  assert.deepEqual(seen.json.items.map((x) => x.title), ['My testimony']);
  assert.equal((await call('carol', 'GET', `/library/items/${priv.json.id}`)).status, 404);
  assert.ok(!(await call('carol', 'GET', '/library/items?kind=audio')).json.items.some((x) => x.owner.id === erinId));
  // others can't edit or delete it
  assert.equal((await call('carol', 'PATCH', `/library/items/${pub.json.id}`, { title: 'Hacked' })).status, 403);
  assert.equal((await call('carol', 'DELETE', `/library/items/${pub.json.id}`)).status, 403);
  const ed = await call('erin', 'PATCH', `/library/items/${pub.json.id}`, { title: 'My testimony (2026)', featured: true });
  assert.equal(ed.json.title, 'My testimony (2026)');
  assert.equal(ed.json.featured, false, 'only admins can feature');
  assert.equal((await call('erin', 'DELETE', `/library/items/${priv.json.id}`)).status, 200);
  assert.equal(await env.MEDIA.head(f2.json.key), null, 'file removed from storage');
});

test('progress, continue listening and play counts', async () => {
  const put = await call('carol', 'PUT', `/library/items/${platformItem.id}/progress`, { position: 321.5 });
  assert.equal(put.status, 200);
  const it = await call('carol', 'GET', `/library/items/${platformItem.id}`);
  assert.equal(it.json.myProgress.position, 321.5);
  const cont = await call('carol', 'GET', '/library/continue?kind=audio');
  assert.equal(cont.json.items[0].id, platformItem.id);
  await call('carol', 'PUT', `/library/items/${platformItem.id}/progress`, { position: 0, completed: true });
  assert.equal((await call('carol', 'GET', '/library/continue?kind=audio')).json.items.length, 0);
  await call('carol', 'POST', `/library/items/${platformItem.id}/play`, { durationSec: 999 });
  const after = await call('carol', 'GET', `/library/items/${platformItem.id}`);
  assert.equal(after.json.plays, 1);
  assert.equal(after.json.durationSec, 1800, 'known duration is kept');
});

test('reports reach the admin tab; hiding removes the item from the library', async () => {
  assert.equal((await call('carol', 'POST', `/library/items/${platformItem.id}/report`, { reason: 'Wrong speaker' })).status, 200);
  assert.equal((await call('carol', 'GET', '/admin/api/library/reports')).status, 403);
  const reps = await call('boss', 'GET', '/admin/api/library/reports');
  assert.equal(reps.json.items.length, 1);
  assert.equal(reps.json.items[0].item.id, platformItem.id);
  const res = await call('boss', 'POST', `/admin/api/library/reports/${reps.json.items[0].id}/resolve`, { action: 'hide' });
  assert.equal(res.json.resolution, 'hidden');
  assert.ok(!(await call('carol', 'GET', '/library/items?kind=audio')).json.items.some((x) => x.id === platformItem.id));
  assert.equal((await raw(null, 'GET', pathOf(platformItem.fileUrl))).status, 403, 'hidden files stop streaming');
  const hidden = await call('boss', 'GET', '/admin/api/library/items?kind=audio&view=hidden');
  assert.equal(hidden.json.items.length, 1);
  await call('boss', 'PATCH', `/library/items/${platformItem.id}`, { status: 'published' });
  assert.ok((await call('carol', 'GET', '/library/items?kind=audio')).json.items.some((x) => x.id === platformItem.id));
});

test('admin categories: create, rename, hide, delete; admin page includes the tab', async () => {
  assert.equal((await call('carol', 'POST', '/admin/api/library/categories', { kind: 'audio', name: 'Youth' })).status, 403);
  const c = await call('boss', 'POST', '/admin/api/library/categories', { kind: 'audio', name: 'Youth' });
  assert.equal(c.status, 201);
  assert.equal(c.json.slug, 'youth');
  assert.equal((await call('boss', 'POST', '/admin/api/library/categories', { kind: 'audio', name: 'Youth' })).status, 409);
  const hid = await call('boss', 'PATCH', `/admin/api/library/categories/${c.json.id}`, { active: false, name: 'Youth Nights' });
  assert.equal(hid.json.active, false);
  assert.ok(!(await call('carol', 'GET', '/library/categories?kind=audio')).json.items.some((x) => x.id === c.json.id));
  assert.equal((await call('boss', 'DELETE', `/admin/api/library/categories/${c.json.id}`)).status, 200);
  const list = await call('boss', 'GET', '/admin/api/library/items?kind=audio&view=all');
  assert.ok(list.json.items.length >= 3);
  const page = await raw(null, 'GET', '/admin');
  assert.match(await page.text(), /Audio & Books/);
});

test('PDF viewer page is served with a CSP and pinned pdf.js', async () => {
  const res = await raw(null, 'GET', '/library/viewer?file=/library/file/x');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy') || '', /cdnjs\.cloudflare\.com/);
  const html = await res.text();
  assert.match(html, /pdf\.js\/3\.11\.174\/pdf\.min\.js/);
});
