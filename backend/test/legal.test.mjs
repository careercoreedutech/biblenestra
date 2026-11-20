// LEGAL: /terms, /privacy, /delete-account pages (placeholders from env) and real account deletion.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { q, one } from '../src/lib/db.js';
import { ownedKey } from '../src/lib/accountDeletion.js';
import { renderMarkdown } from '../src/lib/legal.js';

let env; const app = createApp();
const clerkDeleted = [];
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', __deleteClerkUser: async (id) => { clerkDeleted.push(id); } };
});
async function raw(path, e = env) {
  const res = await app.fetch(new Request(`http://api.test${path}`), e);
  return { status: res.status, text: await res.text(), headers: res.headers };
}
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

test('pages render publicly with key headings, no scripts, placeholders shown when env is empty', async () => {
  const want = {
    '/terms': ['Terms of Service', 'Community rules', 'AI features', 'Not an emergency service', 'Coins, gifts and rewards', 'Governing law and disputes'],
    '/privacy': ['Privacy Policy', 'Information we collect', 'How we use your information and our legal bases', 'Who we share information with', 'Children', 'Nigeria (NDPA 2023)'],
    '/delete-account': ['Delete your BibleNestra account', 'What is deleted', 'What may be kept'],
  };
  for (const [path, heads] of Object.entries(want)) {
    const r = await raw(path);
    assert.equal(r.status, 200, path);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
    for (const h of heads) assert.ok(r.text.includes(h), `${path} has "${h}"`);
    assert.ok(!/<script/i.test(r.text), `${path} has no script`);
    assert.ok(r.text.includes('[CONTACT EMAIL]'), `${path} shows the email placeholder`);
    assert.ok(r.text.includes('Last updated'), `${path} has a last-updated date`);
    assert.ok(!/lawyer/i.test(r.text), 'the review note stays in the source');
  }
  assert.ok((await raw('/privacy')).text.includes('[COMPANY LEGAL NAME]'));
  assert.ok((await raw('/terms')).text.includes('[GOVERNING LAW COUNTRY]'));
  assert.equal((await raw('/terms/')).status, 200);
});

test('placeholders are filled (and escaped) from env vars', async () => {
  const e = { ...env, LEGAL_COMPANY_NAME: 'Nestra Media Ltd', LEGAL_CONTACT_EMAIL: 'privacy@biblenestra.com', LEGAL_ADDRESS: '1 Faith Road, Lagos <b>', LEGAL_GOVERNING_LAW: 'Nigeria', LEGAL_EFFECTIVE_DATE: '1 December 2026' };
  const t = (await raw('/terms', e)).text;
  const p = (await raw('/privacy', e)).text;
  assert.ok(t.includes('Nestra Media Ltd') && t.includes('the laws of <strong>Nigeria</strong>'));
  assert.ok(p.includes('<a href="mailto:privacy@biblenestra.com">privacy@biblenestra.com</a>'));
  assert.ok(p.includes('1 Faith Road, Lagos &lt;b&gt;'));
  assert.ok(p.includes('Effective 1 December 2026'));
  for (const ph of ['[COMPANY LEGAL NAME]', '[CONTACT EMAIL]', '[REGISTERED ADDRESS]', '[GOVERNING LAW COUNTRY]', '[EFFECTIVE DATE]']) {
    assert.ok(!t.includes(ph) && !p.includes(ph), `${ph} replaced`);
  }
  const md = renderMarkdown('privacy', {});
  assert.ok(md.startsWith('# Privacy Policy') && md.includes('[CONTACT EMAIL]'));
});

test('owned keys: only this user’s storage keys are ever deleted', () => {
  const id = '11111111-2222-3333-4444-555555555555';
  assert.equal(ownedKey(`img/${id}/a.jpg`, id), `img/${id}/a.jpg`);
  assert.equal(ownedKey(`https://api.test/media/img/${id}/a.jpg`, id), `img/${id}/a.jpg`);
  assert.equal(ownedKey(`lib/pdf/${id}/b.pdf`, id), `lib/pdf/${id}/b.pdf`);
  assert.equal(ownedKey('img/99999999-2222-3333-4444-555555555555/a.jpg', id), null);
  assert.equal(ownedKey(`img/${id}/../x.jpg`, id), null);
  assert.equal(ownedKey('https://example.org/video.mp4', id), null);
  assert.equal(ownedKey('chat/aaaaaaaa-2222-3333-4444-555555555555/voice_x.m4a', id), null);
  assert.equal(ownedKey('chat/aaaaaaaa-2222-3333-4444-555555555555/voice_x.m4a', id, { chat: true }), 'chat/aaaaaaaa-2222-3333-4444-555555555555/voice_x.m4a');
});

test('delete account: auth required, confirmation required, admins refused', async () => {
  assert.equal((await call(null, 'POST', '/me/delete-account', { confirm: 'DELETE' })).status, 401);
  const r = await call('zoe', 'POST', '/me/delete-account', {});
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'CONFIRM_REQUIRED');
  const boss = (await call('boss', 'GET', '/me')).json.id;
  await q(env, `UPDATE users SET role = 'admin' WHERE id = $1`, [boss]);
  const a = await call('boss', 'POST', '/me/delete-account', { confirm: 'DELETE' });
  assert.equal(a.status, 409);
  assert.equal(a.json.code, 'ADMIN_ACCOUNT');
});

test('delete account: data, files and login are removed; others keep theirs; log has no personal data', async () => {
  const sam = (await call('sam', 'GET', '/me')).json.id;
  const ann = (await call('ann', 'GET', '/me')).json.id;
  await call('sam', 'PUT', '/me', { displayName: 'Sam Deleteme', handle: 'samdel', bio: 'hello' });
  const post = await call('sam', 'POST', '/posts', { text: 'A testimony from Sam' });
  assert.ok(post.status < 300, JSON.stringify(post.json));
  const annPost = await call('ann', 'POST', '/posts', { text: 'Ann stays' });
  await call('sam', 'POST', '/prayers', { title: 'Pray for my exams' });
  await call('sam', 'POST', `/users/${ann}/follow`);
  // files: one own upload linked as the avatar, one belonging to someone else
  const samKey = `img/${sam}/00000000-0000-0000-0000-000000000001.jpg`;
  const annKey = `img/${ann}/00000000-0000-0000-0000-000000000002.jpg`;
  await env.MEDIA.put(samKey, Buffer.from('x'));
  await env.MEDIA.put(annKey, Buffer.from('y'));
  await q(env, 'UPDATE users SET avatar_url = $2 WHERE id = $1', [sam, samKey]);
  await q(env, 'UPDATE users SET avatar_url = $2 WHERE id = $1', [ann, annKey]);

  const del = await call('sam', 'POST', '/me/delete-account', { confirm: 'delete' });
  assert.equal(del.status, 200, JSON.stringify(del.json));
  assert.equal(del.json.deleted, true);
  assert.equal(del.json.status, 'done');

  assert.equal(await one(env, 'SELECT 1 FROM users WHERE id = $1', [sam]), null);
  assert.equal((await one(env, 'SELECT count(*)::int AS n FROM posts WHERE author_id = $1', [sam])).n, 0);
  assert.equal((await one(env, 'SELECT count(*)::int AS n FROM prayers WHERE author_id = $1', [sam])).n, 0);
  assert.equal((await one(env, 'SELECT count(*)::int AS n FROM follows WHERE follower_id = $1', [sam])).n, 0);
  assert.equal((await one(env, 'SELECT count(*)::int AS n FROM coin_ledger WHERE user_id = $1', [sam])).n, 0);
  assert.equal(await env.MEDIA.head(samKey), null, 'own file deleted');
  assert.ok(await env.MEDIA.head(annKey), 'other people’s files untouched');
  assert.ok(await one(env, 'SELECT 1 FROM posts WHERE id = $1', [annPost.json.id]), 'other people’s posts untouched');
  assert.deepEqual(clerkDeleted, [], 'dev users have no Clerk login to delete');

  const log = await one(env, 'SELECT * FROM account_deletions ORDER BY requested_at DESC LIMIT 1');
  assert.equal(log.source, 'app');
  assert.equal(log.files_deleted, 1);
  assert.equal(log.pending_login_id, null);
  assert.ok(!JSON.stringify(log).includes('samdel') && !JSON.stringify(log).includes(sam));

  // signing in again with the same login starts a brand-new, empty account
  const again = (await call('sam', 'GET', '/me')).json;
  assert.notEqual(again.id, sam);
});

test('delete account: real Clerk logins are deleted; a failure is logged for an admin retry', async () => {
  const id = (await call('kim', 'GET', '/me')).json.id;
  // make it look like a Clerk-backed account (dev auth can't sign in as it now, so an admin deletes it)
  await q(env, `UPDATE users SET clerk_id = 'user_kim123' WHERE id = $1`, [id]);
  let fail = true;
  env.__deleteClerkUser = async (cid) => { if (fail) throw new Error('clerk down'); clerkDeleted.push(cid); };
  const del = await call('boss', 'POST', '/admin/api/account-deletions', { user: id });
  assert.equal(del.status, 200, JSON.stringify(del.json));
  assert.equal(del.json.status, 'partial');
  assert.equal(del.json.loginDeleted, false);
  const list = await call('boss', 'GET', '/admin/api/account-deletions');
  const item = list.json.items.find((x) => x.id === del.json.id);
  assert.equal(item.loginDeleted, false);
  assert.equal(item.source, 'admin');
  assert.equal(item.pendingLoginId, undefined, 'the Clerk id is never sent to the dashboard');
  fail = false;
  const retry = await call('boss', 'POST', `/admin/api/account-deletions/${del.json.id}/retry`, {});
  assert.equal(retry.status, 200);
  assert.deepEqual(clerkDeleted, ['user_kim123']);
  const row = await one(env, 'SELECT * FROM account_deletions WHERE id = $1', [del.json.id]);
  assert.equal(row.status, 'done');
  assert.equal(row.pending_login_id, null);
  assert.equal(row.note, null);
  // members can't use the admin routes
  assert.equal((await call('ann', 'GET', '/admin/api/account-deletions')).status, 403);
  assert.equal((await call('ann', 'POST', '/admin/api/account-deletions', { user: '@ann' })).status, 403);
});
