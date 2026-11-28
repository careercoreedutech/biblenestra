// WEBSITE INTEGRATION, ADMIN DASHBOARD (brief 19.1 / 20): connections with status and alerts, the import approval
// queue, the publish queue (approve, retry, failure reason), the who-may-connect setting, and the staff area mapping.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { ROUTE_AREAS } from '../src/lib/staff.js';

let env; const app = createApp();
let ownerId; let connId; let importPending; let importPending2; let publishFailed;

before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', REALTIME_SECRET: 'rt-secret' };
  await env.__db.query(`INSERT INTO users (clerk_id, display_name, role) VALUES ('dev_boss', 'Boss', 'admin')`);
  await env.__db.query(`INSERT INTO users (clerk_id, display_name, role) VALUES ('dev_owner', 'Olu Member', 'user')`);
  ownerId = (await env.__db.query(`SELECT id FROM users WHERE clerk_id = 'dev_owner'`))[0].id;
  const conn = await env.__db.query(`INSERT INTO website_connections (owner_id, site_url, host, kind, feed_url, status, last_error, last_synced_at)
    VALUES ($1, 'https://example.org', 'example.org', 'rss', 'https://example.org/feed.xml', 'error', 'Feed not reachable', now()) RETURNING id`, [ownerId]);
  connId = conn[0].id;
  const wp = await env.__db.query(`INSERT INTO website_connections (owner_id, site_url, host, kind, status)
    VALUES ($1, 'https://wp.example.org', 'wp.example.org', 'wordpress', 'connected') RETURNING id`, [ownerId]);
  const wpId = wp[0].id;
  importPending = (await env.__db.query(`INSERT INTO website_articles (connection_id, owner_id, direction, status, title, body, source_key)
    VALUES ($1, $2, 'import', 'pending', 'Imported post awaiting approval', 'Body text', 'guid-1') RETURNING id`, [connId, ownerId]))[0].id;
  importPending2 = (await env.__db.query(`INSERT INTO website_articles (connection_id, owner_id, direction, status, title, body, source_key)
    VALUES ($1, $2, 'import', 'pending', 'Imported post to hide', 'Body text', 'guid-2') RETURNING id`, [connId, ownerId]))[0].id;
  publishFailed = (await env.__db.query(`INSERT INTO website_articles (connection_id, owner_id, direction, status, title, body, error, attempts)
    VALUES ($1, $2, 'publish', 'failed', 'Written in the app', 'Body text', 'WordPress rejected the password', 1) RETURNING id`, [wpId, ownerId]))[0].id;
});

async function call(user, method, p, body) {
  const h = { 'X-Dev-User': user };
  let b;
  if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${p}`, { method, headers: h, body: b }), env);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = text; }
  return { status: res.status, json };
}

test('only administrators reach the integration dashboard', async () => {
  const r = await call('owner', 'GET', '/admin/api/website-integrations');
  assert.equal(r.status, 403);
  const q = await call('owner', 'GET', '/admin/api/website-articles?direction=import&status=pending');
  assert.equal(q.status, 403);
});

test('admin sees every connection with its status, last sync and failed-sync alerts', async () => {
  const r = await call('boss', 'GET', '/admin/api/website-integrations');
  assert.equal(r.status, 200);
  const rss = r.json.items.find((c) => c.id === connId);
  assert.equal(rss.status, 'error');
  assert.equal(rss.lastError, 'Feed not reachable');
  assert.ok(rss.lastSyncedAt);
  assert.equal(rss.owner.displayName, 'Olu Member');
  assert.equal(rss.pendingImports, 2);
  assert.equal(r.json.items.length, 2);
  assert.equal(r.json.alerts.length, 1);
  assert.equal(r.json.alerts[0].host, 'example.org');
  assert.equal(r.json.settings.integrationAccess, 'admins');
});

test('import approval queue: approve one article, hide another, both leave the pending queue', async () => {
  const list = await call('boss', 'GET', '/admin/api/website-articles?direction=import&status=pending');
  assert.equal(list.status, 200);
  assert.equal(list.json.items.length, 2);
  const ok = await call('boss', 'POST', `/admin/api/website-articles/${importPending}/approve`);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.status, 'approved');
  const hide = await call('boss', 'POST', `/admin/api/website-articles/${importPending2}/hide`);
  assert.equal(hide.status, 200);
  const left = await call('boss', 'GET', '/admin/api/website-articles?direction=import&status=pending');
  assert.equal(left.json.items.length, 0);
  const again = await call('boss', 'POST', `/admin/api/website-articles/${importPending}/approve`);
  assert.equal(again.status, 400, 'an approved article cannot be approved twice');
  const bad = await call('boss', 'GET', '/admin/api/website-articles?direction=import&status=nonsense');
  assert.equal(bad.status, 400);
});

test('publish queue shows the failure reason and retry publishes again (and records the failure)', async () => {
  const list = await call('boss', 'GET', '/admin/api/website-articles?direction=publish&status=pending,approved,publishing,failed');
  assert.equal(list.status, 200);
  const row = list.json.items.find((a) => a.id === publishFailed);
  assert.equal(row.status, 'failed');
  assert.equal(row.error, 'WordPress rejected the password');
  env.__fetch = async () => new Response('nope', { status: 500 });
  const retry = await call('boss', 'POST', `/admin/api/website-articles/${publishFailed}/publish`);
  delete env.__fetch;
  assert.equal(retry.status, 200);
  assert.equal(retry.json.status, 'failed', 'the WordPress call fails again, and the reason is kept');
  assert.ok(retry.json.error);
  assert.equal(retry.json.attempts, 2);
});

test('the who-may-connect setting is validated and takes effect (verified members)', async () => {
  const bad = await call('boss', 'PUT', '/admin/api/website-integrations/settings', { integrationAccess: 'everyone' });
  assert.equal(bad.status, 400);
  const saved = await call('boss', 'PUT', '/admin/api/website-integrations/settings', { integrationAccess: 'verified', syncMinutes: 45, ownerCanApprove: false });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.settings.integrationAccess, 'verified');
  assert.equal(saved.json.settings.syncMinutes, 45);
  assert.equal(saved.json.settings.ownerCanApprove, false);
  const badMins = await call('boss', 'PUT', '/admin/api/website-integrations/settings', { syncMinutes: 2 });
  assert.equal(badMins.status, 400);

  // an unverified member is refused, a verified member may connect
  const plain = await call('carl', 'GET', '/website-integrations');
  assert.equal(plain.json.access, false);
  await call('vera', 'GET', '/me'); // creates the account on first sign-in
  await env.__db.query(`UPDATE users SET verified = true WHERE clerk_id = 'dev_vera'`);
  const verified = await call('vera', 'GET', '/website-integrations');
  assert.equal(verified.json.access, true);

  await call('boss', 'PUT', '/admin/api/website-integrations/settings', { integrationAccess: 'admins' });
});

test('admin-only write paths for the integration are mapped to the moderation staff area', () => {
  const area = (p) => (ROUTE_AREAS.find(([re]) => re.test(p)) || [])[1];
  assert.equal(area('/admin/api/website-integrations'), 'moderation');
  assert.equal(area('/admin/api/website-integrations/abc/sync'), 'moderation');
  assert.equal(area('/admin/api/website-integrations/settings'), 'moderation');
  assert.equal(area('/admin/api/website-articles'), 'moderation');
  assert.equal(area('/admin/api/website-articles/abc/approve'), 'moderation');
});
