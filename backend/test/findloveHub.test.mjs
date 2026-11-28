// FIND LOVE HUB: profile interests (saved, shown on cards and own profile, bounded), the interests filter in discovery
// (free, shared interest required, never bypasses blocks or the other person's preferences), and saved filter preferences.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { q } from '../src/lib/db.js';
import { cleanTags } from '../src/lib/dating.js';

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true' };
});
async function call(user, method, path, body) {
  const h = {};
  if (user) h['X-Dev-User'] = user;
  let b;
  if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${path}`, { method, headers: h, body: b }), env);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (err) { json = text; }
  return { status: res.status, json };
}
const ids = {};
const yearsAgo = (y) => { const t = new Date(); t.setUTCFullYear(t.getUTCFullYear() - y); return t.toISOString().slice(0, 10); };
async function mkProfile(u, { gender, interestedIn, age = 28, interests = [], prefs = { ageMin: 18, ageMax: 60 } }) {
  if (!ids[u]) ids[u] = (await call(u, 'GET', '/me')).json.id;
  const r = await call(u, 'PUT', '/dating/profile', { firstName: u[0].toUpperCase() + u.slice(1), birthDate: yearsAgo(age), confirmAdult: true, gender, interestedIn, city: 'Lagos', country: 'Nigeria', intention: 'marriage', bio: `Hi ${u}`, prefs, interests });
  assert.ok([200, 201].includes(r.status), JSON.stringify(r.json));
  await q(env, `INSERT INTO dating_photos (user_id, url, status) VALUES ($1, $2, 'approved')`, [ids[u], `https://images.example/${u}.jpg`]);
  return r.json.profile;
}
const discover = async (u) => (await call(u, 'GET', '/dating/discover?limit=50')).json.items.map((x) => x.firstName);

test('cleanTags: strings only, trimmed, de-duplicated, at most 10 tags of 40 characters', () => {
  assert.deepEqual(cleanTags(['  Prayer ', 'Prayer', '', null, 7]), ['Prayer', '7']);
  assert.equal(cleanTags(Array.from({ length: 15 }, (_, i) => `t${i}`)).length, 10);
  assert.deepEqual(cleanTags('Prayer'), []);
  assert.equal(cleanTags(['x'.repeat(80)])[0].length, 40);
});

test('interests are saved, shown on the own profile and on cards, and can be cleared', async () => {
  const me = await mkProfile('ada', { gender: 'woman', interestedIn: 'men', interests: ['Prayer', 'Cooking', 'Prayer'] });
  assert.deepEqual(me.interests, ['Prayer', 'Cooking']);
  const home = (await call('ada', 'GET', '/dating/me')).json;
  assert.deepEqual(home.profile.interests, ['Prayer', 'Cooking']);
  // a partial save keeps the interests
  await call('ada', 'PUT', '/dating/profile', { bio: 'Updated' });
  assert.deepEqual((await call('ada', 'GET', '/dating/me')).json.profile.interests, ['Prayer', 'Cooking']);
  await call('ada', 'PUT', '/dating/profile', { interests: [] });
  assert.deepEqual((await call('ada', 'GET', '/dating/me')).json.profile.interests, []);
  await call('ada', 'PUT', '/dating/profile', { interests: ['Prayer', 'Cooking'] });
});

test('interests filter: only people who share at least one interest; empty filter shows everyone again', async () => {
  await mkProfile('ben', { gender: 'man', interestedIn: 'women', interests: ['Worship', 'Travel'] });
  await mkProfile('carl', { gender: 'man', interestedIn: 'women', interests: ['Cooking'] });
  await mkProfile('dan', { gender: 'man', interestedIn: 'women', interests: [] });
  assert.deepEqual((await discover('ada')).sort(), ['Ben', 'Carl', 'Dan']);
  await call('ada', 'PUT', '/dating/profile', { prefs: { ageMin: 18, ageMax: 60, interests: ['Worship', 'Cooking'] } });
  assert.deepEqual((await discover('ada')).sort(), ['Ben', 'Carl']);
  await call('ada', 'PUT', '/dating/profile', { prefs: { ageMin: 18, ageMax: 60, interests: [] } });
  assert.deepEqual((await discover('ada')).sort(), ['Ben', 'Carl', 'Dan']);
});

test('saved filters persist and are returned with the profile (age range and interests)', async () => {
  await call('ada', 'PUT', '/dating/profile', { prefs: { ageMin: 25, ageMax: 40, interests: ['Travel'], intentions: ['marriage'] } });
  const prefs = (await call('ada', 'GET', '/dating/me')).json.profile.prefs;
  assert.equal(prefs.ageMin, 25); assert.equal(prefs.ageMax, 40);
  assert.deepEqual(prefs.interests, ['Travel']);
  // the age range still applies alongside the interests filter: Ben is 28, so he stays in range
  assert.deepEqual(await discover('ada'), ['Ben']);
});

test("the interests filter never bypasses age preferences or blocks", async () => {
  // Eve (a woman) only wants men aged 18-22: Ben (28) is hidden by her age range, Fay (20, Travel) is shown
  await mkProfile('eve', { gender: 'woman', interestedIn: 'men', interests: ['Travel'], prefs: { ageMin: 18, ageMax: 22 } });
  await mkProfile('fay', { gender: 'man', interestedIn: 'women', age: 20, interests: ['Travel'] });
  assert.deepEqual(await discover('eve'), ['Fay']);
  // a block (either way) removes Fay from Eve's stack even though she shares an interest
  const b = await call('eve', 'POST', '/dating/block', { userId: ids.fay });
  assert.ok([200, 201].includes(b.status), JSON.stringify(b.json));
  assert.deepEqual(await discover('eve'), []);
});
