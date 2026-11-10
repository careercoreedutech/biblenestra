import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', ADS_CLIENT_CLAIM: 'true', ADMIN_PASSWORD: 'test-admin-pass', REALTIME_SECRET: 'test-realtime-secret' };
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

test('POST /admin/api/seed seeds communities, events, prayers, jobs, wishes and posts', async () => {
  // First make admin user
  // without ADMIN_PASSWORD the login is closed
  const closed = await app.fetch(new Request('http://api.test/admin/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'benjamin', password: 'anything' }) }), { ...env, ADMIN_PASSWORD: undefined, REALTIME_SECRET: undefined });
  assert.equal(closed.status, 503);
  const wrong = await call(null, 'POST', '/admin/api/login', { username: 'benjamin', password: 'nope' });
  assert.equal(wrong.status, 401);
  const adminRes = await call(null, 'POST', '/admin/api/login', { username: 'benjamin', password: 'test-admin-pass' });
  assert.equal(adminRes.status, 200);
  const token = adminRes.json.token;

  const seedRes = await app.fetch(new Request('http://api.test/admin/api/seed', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  }), env);

  const text = await seedRes.text();
  console.log('Seed response:', seedRes.status, text);
  let seedJson; try { seedJson = JSON.parse(text); } catch (e) { seedJson = text; }
  assert.equal(seedRes.status, 200);
  assert.equal(seedJson.ok, true);
  assert.ok(seedJson.seeded);
  assert.equal(seedJson.seeded.communities, 4);
  assert.equal(seedJson.seeded.events, 2);
  assert.equal(seedJson.seeded.prayers, 3);
  assert.equal(seedJson.seeded.jobs, 3);
  assert.equal(seedJson.seeded.wishes, 3);
  assert.equal(seedJson.seeded.posts, 4);

  // Check GET /communities
  const commsRes = await app.fetch(new Request('http://api.test/communities', {
    headers: { Authorization: `Bearer ${token}` }
  }), env);
  const commsJson = await commsRes.json();
  assert.equal(commsRes.status, 200);
  assert.equal(commsJson.items.length, 4);

  // Check GET /events
  const eventsRes = await app.fetch(new Request('http://api.test/events', {
    headers: { Authorization: `Bearer ${token}` }
  }), env);
  const eventsJson = await eventsRes.json();
  assert.equal(eventsRes.status, 200);
  assert.equal(eventsJson.items.length, 2);

  // Check GET /prayers
  const prayersRes = await app.fetch(new Request('http://api.test/prayers', {
    headers: { Authorization: `Bearer ${token}` }
  }), env);
  const prayersJson = await prayersRes.json();
  assert.equal(prayersRes.status, 200);
  assert.equal(prayersJson.items.length, 3);

  // Check GET /jobs
  const jobsRes = await app.fetch(new Request('http://api.test/jobs', {
    headers: { Authorization: `Bearer ${token}` }
  }), env);
  const jobsJson = await jobsRes.json();
  assert.equal(jobsRes.status, 200);
  assert.equal(jobsJson.items.length, 3);

  // Test idempotency: calling seed again does not duplicate or throw
  const seed2Res = await app.fetch(new Request('http://api.test/admin/api/seed', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  }), env);
  assert.equal(seed2Res.status, 200);
  const seed2Json = await seed2Res.json();
  assert.equal(seed2Json.ok, true);
  // Communities should not be re-added
  assert.equal(seed2Json.seeded.communities, 0);
});
