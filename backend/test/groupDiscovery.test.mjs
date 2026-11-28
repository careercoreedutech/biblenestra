// PACKAGE F — Search groups (listing, filters, join), chat-list actions (pin, remove from my list, delete group),
// and username search on /people (exact and prefix matches, @ ignored, blocks and bans hidden).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';

let env; const app = createApp();
async function call(user, method, path, body) {
  const h = { 'X-Dev-User': user };
  let b;
  if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${path}`, { method, headers: h, body: b }), env);
  return { status: res.status, json: await res.json() };
}
const sql = (t, p = []) => env.__db.query(t, p);
const oneRow = async (t, p = []) => (await sql(t, p))[0];
const ids = {};
let g; // Dawn Prayer Circle

before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true' };
  const names = { gina: ['Gina', 'gina_k'], ada: ['Ada', 'ada_p'], mo: ['Mo', 'mo_s'], ben: ['Ben', 'ben_t'], bad: ['Bad', 'bad_user'] };
  for (const [u, [name, handle]] of Object.entries(names)) {
    ids[u] = (await call(u, 'GET', '/me')).json.id;
    await call(u, 'PUT', '/me', { displayName: name, handle, bio: `${name} loves prayer` });
  }
  const r = await call('gina', 'POST', '/conversations/group', { title: 'Dawn Prayer Circle', description: 'Early morning prayer', memberIds: [ids.ada, ids.mo] });
  g = r.json.id;
  await call('gina', 'POST', `/conversations/${g}/members/${ids.ada}/role`, { role: 'admin' });
});

test('a new group is not listed: search shows nothing until admins list it', async () => {
  const r = await call('ben', 'GET', '/groups/search?q=dawn');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.items, []);
});

test('only owners and admins can change the listing', async () => {
  const r = await call('mo', 'PATCH', `/conversations/${g}/listing`, { listed: true });
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'ADMIN_ONLY');
});

test('listing validates the category and the visibility', async () => {
  assert.equal((await call('gina', 'PATCH', `/conversations/${g}/listing`, { category: 'Nightclub' })).status, 400);
  assert.equal((await call('gina', 'PATCH', `/conversations/${g}/listing`, { visibility: 'secret' })).status, 400);
});

test('the owner lists the group with category, place and church; the info screen shows the listing', async () => {
  const r = await call('gina', 'PATCH', `/conversations/${g}/listing`, {
    listed: true, visibility: 'public', category: 'Prayer', country: 'Nigeria', city: 'Lagos', churchName: 'Grace Chapel',
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.listing, { listed: true, visibility: 'public', category: 'Prayer', country: 'Nigeria', city: 'Lagos', churchName: 'Grace Chapel' });
  const info = await call('gina', 'GET', `/conversations/${g}/info`);
  assert.equal(info.json.listing.city, 'Lagos');
});

test('search finds the group by name, description, church, city and country', async () => {
  for (const q of ['dawn', 'early morning', 'grace chapel', 'lagos', 'nigeria']) {
    const r = await call('ben', 'GET', `/groups/search?q=${encodeURIComponent(q)}`);
    assert.equal(r.json.items.length, 1, `search for ${q}`);
  }
  const [item] = (await call('ben', 'GET', '/groups/search?q=dawn')).json.items;
  assert.equal(item.name, 'Dawn Prayer Circle');
  assert.equal(item.description, 'Early morning prayer');
  assert.equal(item.membersCount, 3);
  assert.equal(item.category, 'Prayer');
  assert.equal(item.joinPath, 'join');
  assert.equal(item.joined, false);
});

test('category and place filters narrow the results', async () => {
  assert.equal((await call('ben', 'GET', '/groups/search?category=Prayer')).json.items.length, 1);
  assert.equal((await call('ben', 'GET', '/groups/search?category=Bible%20study')).json.items.length, 0);
  assert.equal((await call('ben', 'GET', '/groups/search?city=Abuja')).json.items.length, 0);
  assert.equal((await call('ben', 'GET', '/groups/search?church=grace')).json.items.length, 1);
  assert.equal((await call('ben', 'GET', '/groups/search?category=Nightclub')).status, 400);
});

test('a public group joins straight away; a private one needs a request', async () => {
  const joined = await call('ben', 'POST', `/conversations/${g}/join`, {});
  assert.equal(joined.status, 201);
  assert.equal(joined.json.status, 'member');
  const again = await call('ben', 'POST', `/conversations/${g}/join`, {});
  assert.equal(again.json.status, 'member');
  const [item] = (await call('ben', 'GET', '/groups/search?q=dawn')).json.items;
  assert.equal(item.joined, true);

  await call('gina', 'PATCH', `/conversations/${g}/listing`, { visibility: 'private' });
  const asked = await call('bad', 'POST', `/conversations/${g}/join`, {});
  assert.equal(asked.status, 202);
  assert.equal(asked.json.status, 'requested');
});

test('a banned user is not shown in search and cannot join', async () => {
  await sql('INSERT INTO conversation_bans (conversation_id, user_id) VALUES ($1, $2)', [g, ids.bad]);
  const r = await call('bad', 'POST', `/conversations/${g}/join`, {});
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'BANNED');
  assert.equal((await call('bad', 'GET', '/groups/search?q=dawn')).json.items.length, 0);
});

test('a group that is not listed cannot be joined through search', async () => {
  const side = (await call('gina', 'POST', '/conversations/group', { title: 'Private Book Club', memberIds: [] })).json.id;
  assert.equal((await call('ben', 'POST', `/conversations/${side}/join`, {})).status, 404);
});

test('pin moves a chat to the top of my list, only for me', async () => {
  await call('mo', 'POST', `/conversations/${g}/pin`, { pinned: true });
  const list = (await call('mo', 'GET', '/conversations')).json.items;
  assert.equal(list[0].id, g);
  assert.equal(list[0].pinned, true);
  const ada = (await call('ada', 'GET', '/conversations')).json.items.find((c) => c.id === g);
  assert.equal(ada.pinned, false, 'pin is per member');
  await call('mo', 'POST', `/conversations/${g}/pin`, { pinned: false });
  assert.equal((await call('mo', 'GET', '/conversations')).json.items.find((c) => c.id === g).pinned, false);
});

test('remove from my list hides the group for me only; a new message brings it back', async () => {
  assert.equal((await call('mo', 'POST', `/conversations/${g}/hide`, {})).status, 200);
  assert.equal((await call('mo', 'GET', '/conversations')).json.items.some((c) => c.id === g), false);
  assert.equal((await call('ada', 'GET', '/conversations')).json.items.some((c) => c.id === g), true);
  await call('ada', 'POST', `/conversations/${g}/messages`, { kind: 'text', text: 'Pray with me at six', clientId: 'c_hide_1' });
  assert.equal((await call('mo', 'GET', '/conversations')).json.items.some((c) => c.id === g), true);
});

test('the owner cannot remove their own group from the list; they delete it instead', async () => {
  const r = await call('gina', 'POST', `/conversations/${g}/hide`, {});
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'OWNER_HIDE');
});

test('a member cannot delete someone else’s group; an admin can, and everyone else loses it', async () => {
  const denied = await call('mo', 'DELETE', `/conversations/${g}`);
  assert.equal(denied.status, 403);
  assert.equal(denied.json.code, 'ADMIN_ONLY');
  const allowed = await call('ada', 'DELETE', `/conversations/${g}`);
  assert.equal(allowed.status, 200);
  assert.equal((await call('mo', 'GET', `/conversations/${g}/info`)).status, 404);
  assert.equal((await call('mo', 'GET', '/conversations')).json.items.some((c) => c.id === g), false);
  assert.equal((await sql('SELECT COUNT(*)::int AS n FROM messages WHERE conversation_id = $1', [g]))[0].n, 0);
});

test('a direct chat cannot be deleted as a group', async () => {
  const dm = await call('gina', 'POST', '/conversations/dm', { userId: ids.ben });
  const dmId = dm.json.id;
  if (!dmId) return;
  const r = await call('gina', 'DELETE', `/conversations/${dmId}`);
  assert.equal(r.status, 400);
});

test('people search: @ is ignored, an exact username comes first, then prefixes, with bio and no blocked or banned people', async () => {
  await call('gina', 'PUT', '/me', { handle: 'john123', displayName: 'John Okoro', bio: 'Sunday school teacher' });
  await call('ada', 'PUT', '/me', { handle: 'john1234', displayName: 'Johnny' });
  await call('mo', 'PUT', '/me', { handle: 'mo_john', displayName: 'Mo Johnson' });
  const r = await call('ben', 'GET', '/people?q=@john123');
  assert.equal(r.json.items[0].handle, 'john123');
  assert.equal(r.json.items[0].bio, 'Sunday school teacher');
  const plain = await call('ben', 'GET', '/people?q=john123');
  assert.equal(plain.json.items[0].handle, 'john123');
  const prefix = (await call('ben', 'GET', '/people?q=john')).json.items.map((p) => p.handle);
  assert.ok(prefix.includes('john123') && prefix.includes('john1234'), 'usernames starting with the text are found');
  assert.equal(prefix.indexOf('mo_john') > prefix.indexOf('john123'), true, 'username prefix beats a contains match');
  assert.ok(prefix.includes('mo_john'), 'name and handle contains still match');
});

test('people search hides blocked users (both directions) and banned accounts', async () => {
  await call('ben', 'POST', `/users/${ids.ada}/block`, {});
  const r = await call('ben', 'GET', '/people?q=john1234');
  assert.equal(r.json.items.length, 0);
  const mine = await call('mo', 'GET', '/people?q=john1234');
  assert.equal(mine.json.items.length, 1, 'the block only hides the pair');
  await sql('UPDATE users SET banned = true WHERE id = $1', [ids.bad]);
  assert.equal((await call('ben', 'GET', '/people?q=bad_user')).json.items.length, 0);
});

// ---------- GROUP SEARCH: public groups are listed by default (listing follows visibility) ----------
const lantern = (who, title, memberIds = []) => call(who, 'POST', '/conversations/group', { title, description: 'Lantern test', memberIds });
const searchHas = async (q2, id) => (await call('ben', 'GET', `/groups/search?q=${encodeURIComponent(q2)}`)).json.items.some((x) => x.id === id);

test('a public group is listed by default; an admin can still unlist it and list it again', async () => {
  const pub = (await lantern('gina', 'Lantern Public Circle')).json.id;
  assert.equal(await searchHas('Lantern Public', pub), false, 'a private group is not listed');
  const made = await call('gina', 'PATCH', `/conversations/${pub}/listing`, { visibility: 'public' });
  assert.equal(made.status, 200);
  assert.equal(made.json.listing.listed, true, 'choosing public lists it');
  assert.equal(await searchHas('Lantern Public', pub), true);
  await call('gina', 'PATCH', `/conversations/${pub}/listing`, { listed: false });
  assert.equal(await searchHas('Lantern Public', pub), false, 'admin unlisted it');
  // the admin's choice sticks while the visibility stays public
  await call('gina', 'PATCH', `/conversations/${pub}/listing`, { category: 'Prayer' });
  assert.equal(await searchHas('Lantern Public', pub), false);
  await call('gina', 'PATCH', `/conversations/${pub}/listing`, { listed: true });
  assert.equal(await searchHas('Lantern Public', pub), true);
  // going private keeps the admin's listing choice (a listed private group can still be requested through search)
  const priv = await call('gina', 'PATCH', `/conversations/${pub}/listing`, { visibility: 'private' });
  assert.equal(priv.json.listing.listed, true);
  await call('gina', 'PATCH', `/conversations/${pub}/listing`, { listed: false });
});

test('membership sections (MASTER CLASS / EXECUTIVE CLASS) are never listed, even when public', async () => {
  const mem = await oneRow(`INSERT INTO memberships (slug, title, status, owner_id, headline, description) VALUES ('lantern-club', 'Lantern Club', 'published', $1, 'x', 'x') RETURNING id`, [ids.gina]);
  const sec = await oneRow(`INSERT INTO conversations (kind, title, membership_id) VALUES ('group', 'Lantern Club · MASTER CLASS', $1) RETURNING id`, [mem.id]);
  await sql(`UPDATE conversations SET settings = '{"visibility":"public"}'::jsonb, listed = true WHERE id = $1`, [sec.id]);
  assert.equal(await searchHas('Lantern Club', sec.id), false);
  const attempt = await call('ben', 'POST', `/conversations/${sec.id}/join`, {});
  assert.ok([403, 404].includes(attempt.status), 'and it cannot be joined through search');
});

test('the backfill lists existing public groups once; a group an admin unlisted stays unlisted when the schema is re-applied', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const schema = readFileSync(fileURLToPath(new URL('../db/schema.sql', import.meta.url)), 'utf8');
  const start = schema.indexOf('-- ===== GROUP SEARCH: PUBLIC GROUPS LISTED =====');
  const end = schema.indexOf('-- ===== END GROUP SEARCH: PUBLIC GROUPS LISTED =====');
  assert.ok(start > 0 && end > start, 'the backfill block is in the schema');
  const block = schema.slice(start, end);
  const old = await oneRow(`INSERT INTO conversations (kind, title, listed, settings) VALUES ('group', 'Lantern Legacy Public', false, '{"visibility":"public"}'::jsonb) RETURNING id`, []);
  await sql(`DELETE FROM schema_backfills WHERE name = 'public_groups_listed_v1'`); // simulate the first run on an existing database
  await env.__db.pg.exec(block);
  assert.equal(await searchHas('Lantern Legacy', old.id), true, 'existing public group is listed');
  await sql(`UPDATE conversations SET listed = false WHERE id = $1`, [old.id]); // an admin unlists it
  await env.__db.pg.exec(block); // schema re-applied later
  assert.equal(await searchHas('Lantern Legacy', old.id), false, 'the backfill does not run again');
});
