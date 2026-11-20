// SCRIPTURE COMPANION meaning search: the extra verse pool is valid; verse vectors are built only by an admin,
// idempotently; once built, embeddings influence the chosen verses; with no vectors / no AI / a failing embedding
// model the reply is ranked by themes exactly as before; the abuse filter and no-repeat rule still hold.
// Workers AI is mocked: embeddings are deterministic hashed bag-of-words vectors, so texts that share words are close.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { q } from '../src/lib/db.js';
import { THEMES } from '../src/lib/companionIndex.js';
import { EXTRA_REFS, POOL } from '../src/lib/companionPool.js';
import { canonicalRef, parseUsfm, rankCandidates, verseKeys } from '../src/lib/companion.js';
import { packVector, unpackVector, companionVectorsCron, _clearVectorCache } from '../src/lib/companionSemantic.js';

const KJV = JSON.parse(readFileSync(new URL('../../src/data/kjv_bible.json', import.meta.url), 'utf8'));
const kjvText = (ref) => {
  const p = parseUsfm(ref);
  const out = [];
  for (let v = p.vs; v <= p.ve; v++) out.push(KJV[`${p.bookId}:${p.chapter}`][v - 1]);
  return out.join(' ');
};

// Free Use Bible API mock: KJV only (the WEB fetch 404s, so documents fall back to KJV text alone)
async function mockFetch(url) {
  const m = String(url).match(/\/api\/(\w+)\/(\w+)\/(\d+)\.json$/);
  if (m && m[1] === 'eng_kjv') {
    const verses = KJV[`${m[2] === 'OBA' ? 'OBD' : m[2]}:${m[3]}`];
    if (verses) return new Response(JSON.stringify({ chapter: { content: verses.map((t, i) => ({ type: 'verse', number: i + 1, content: [t] })) } }), { status: 200 });
  }
  return new Response('nope', { status: 404 });
}

// ---------- Workers AI mock ----------
const DIMS = 256;
const STOP = new Set('the and that this with have for not but are was were shall unto them they thee thou thy will from your you which when what there their into upon also hath said been more than like sentence represent searching relevant passages'.split(' '));
function bow(text) {
  const v = new Array(DIMS).fill(0);
  for (let w of String(text).toLowerCase().split(/[^a-z]+/)) {
    if (w.length < 4 || STOP.has(w)) continue;
    w = w.replace(/(es|s)$/, '');
    let h = 7;
    for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % DIMS] += 1;
  }
  v[DIMS - 1] += 0.01; // never all-zero
  return v;
}
const FIG = 'Our harvest failed completely: the fig tree did not blossom, there is no fruit on the vines, the olive crop failed, the fields yield no food and the flock is cut off from the fold. How do I still trust God?';
const ABUSE = 'My husband beats me. I still want to save our marriage, husbands should love their wives and the two are one flesh, so I forgive him and cleave to him.';
const stats = { embedCalls: 0, embedTexts: 0, embedFail: false, maxBatch: 0 };
const AI = {
  async run(model, input) {
    if (input.text) {
      stats.embedCalls++;
      stats.embedTexts += input.text.length;
      stats.maxBatch = Math.max(stats.maxBatch, input.text.length);
      if (stats.embedFail) throw new Error('embedding model down');
      return { shape: [input.text.length, DIMS], data: input.text.map(bow) };
    }
    const p = input.messages[1].content;
    if (p.includes('Choose the themes that fit')) {
      const themes = p.includes('fig tree') ? [{ theme: 'finances', weight: 1 }] : p.includes('husband beats') ? [{ theme: 'marriage', weight: 1 }] : [{ theme: 'depression', weight: 1 }];
      return { response: JSON.stringify({ themes, specifics: ['x'], summary: 'You are carrying a lot.', crisis: false, references: [] }) };
    }
    return { response: '{}' };
  },
};

let env; let noAiEnv; const app = createApp();
before(async () => {
  const db = await makeDb(null);
  env = { __db: db, MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', AI, __fetch: mockFetch };
  noAiEnv = { __db: db, MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', __fetch: mockFetch };
});
async function call(e, user, method, path, body) {
  const h = { 'X-Dev-User': user };
  let b;
  if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${path}`, { method, headers: h, body: b }), e);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (err) { json = text; }
  return { status: res.status, json };
}
const verses = (user, message, e = env) => call(e, user, 'POST', '/companion/verses', { message, translation: 'KJV' });
// verses that must never be offered with abuse/danger (as in companion.test.mjs, plus the extra pool's)
const UNSAFE = new Set([...POOL].filter(([, ts]) => ts.some((k) => ['marriage', 'guilt', 'betrayal', 'temptation'].includes(k))).map(([r]) => r));

test('extra pool: every reference exists, is canonical, has KJV text and doesn’t duplicate the index', () => {
  const indexKeys = new Set(Object.values(THEMES).flatMap((t) => t.refs.flatMap(verseKeys)));
  const seen = new Set();
  for (const [theme, refs] of Object.entries(EXTRA_REFS)) {
    assert.ok(THEMES[theme], `unknown theme ${theme}`);
    for (const ref of refs) {
      assert.equal(canonicalRef(ref), ref, `${theme}: ${ref} is not a valid reference`);
      assert.ok(kjvText(ref).length > 10, `${ref} has no KJV text`);
      assert.ok(!seen.has(ref), `${ref} listed twice`);
      seen.add(ref);
      assert.ok(!verseKeys(ref).some((k) => indexKeys.has(k)), `${ref} overlaps the curated index`);
    }
  }
  assert.ok(POOL.size >= 400 && POOL.size <= 600, `pool size ${POOL.size}`);
});

test('vector packing keeps cosine similarity', () => {
  const a = bow('the Lord is my shepherd I shall not want'); const b = bow('the Lord my shepherd green pastures');
  const cos = (x, y) => { let d = 0, nx = 0, ny = 0; for (let i = 0; i < x.length; i++) { d += x[i] * y[i]; nx += x[i] ** 2; ny += y[i] ** 2; } return d / Math.sqrt(nx * ny); };
  const pa = unpackVector(packVector(a)); const pb = unpackVector(packVector(b));
  assert.ok(Math.abs(cos(a, b) - cos(Array.from(pa), Array.from(pb))) < 0.02);
});

test('before vectors exist: theme ranking, no embedding call; build endpoint is admin-only', async () => {
  const r = await verses('plain-user', FIG);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.ranking, 'themes');
  assert.ok(r.json.verses.length >= 7);
  assert.equal(stats.embedCalls, 0, 'no AI spend while vectors are missing');
  assert.ok(!r.json.verses.some((v) => v.ref === 'HAB 3:17-18'));

  assert.equal((await call(env, 'not-admin', 'GET', '/admin/api/companion/vectors')).status, 403);
  assert.equal((await call(env, 'not-admin', 'POST', '/admin/api/companion/vectors/build', {})).status, 403);
  const id = (await call(env, 'vec-admin', 'GET', '/me')).json.id;
  await q(env, `UPDATE users SET role = 'admin' WHERE id = $1`, [id]);
  const s = await call(env, 'vec-admin', 'GET', '/admin/api/companion/vectors');
  assert.equal(s.status, 200, JSON.stringify(s.json));
  assert.deepEqual({ total: s.json.total, built: s.json.built, ready: s.json.ready }, { total: POOL.size, built: 0, ready: false });
  assert.equal(s.json.model, '@cf/baai/bge-base-en-v1.5');
  assert.equal((await call(noAiEnv, 'vec-admin', 'POST', '/admin/api/companion/vectors/build', {})).json.code, 'NOT_CONFIGURED');
});

test('admin build: batched, resumable, idempotent; cron fills the rest', async () => {
  const first = await call(env, 'vec-admin', 'POST', '/admin/api/companion/vectors/build', {});
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(first.json.built, 15, 'default batch');
  assert.equal(first.json.remaining, POOL.size - 15);
  const big = await call(env, 'vec-admin', 'POST', '/admin/api/companion/vectors/build', { limit: 150 });
  assert.equal(big.json.built, 150);
  assert.ok(stats.maxBatch <= 50, 'embedding calls are chunked');
  // the cron builds 15 at a time while anything is missing
  const cron = await companionVectorsCron(env);
  assert.equal(cron.built, 15);
  let last;
  for (let i = 0; i < 10; i++) {
    last = (await call(env, 'vec-admin', 'POST', '/admin/api/companion/vectors/build', { limit: 150 })).json;
    if (!last.remaining) break;
  }
  assert.equal(last.remaining, 0);
  assert.deepEqual(last.failed, []);
  const texts = stats.embedTexts;
  const again = await call(env, 'vec-admin', 'POST', '/admin/api/companion/vectors/build', { limit: 150 });
  assert.equal(again.json.built, 0, 'nothing is re-embedded');
  assert.equal(stats.embedTexts, texts);
  const done = await companionVectorsCron(env);
  assert.equal(done.remaining, 0);
  assert.equal(stats.embedTexts, texts, 'cron does nothing once built');
  const rows = await q(env, 'SELECT count(*)::int AS n, min(dims) AS d FROM companion_verse_vectors');
  assert.equal(rows[0].n, POOL.size);
  assert.equal(rows[0].d, DIMS);
});

test('meaning search influences the verses (exact Bible text still)', async () => {
  const r = await verses('fig-user', FIG);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.ranking, 'semantic');
  const refs = r.json.verses.map((v) => v.ref);
  assert.ok(refs.includes('HAB 3:17-18'), `the closest passage by meaning is chosen: ${refs.join(', ')}`);
  assert.ok(r.json.verses.length >= 7);
  for (const v of r.json.verses) assert.equal(v.text, kjvText(v.ref));
  // the same analysis without meaning search never reaches it
  const plain = rankCandidates({ themes: [{ theme: 'finances', weight: 1 }], references: [] }, new Set(), { random: () => 0.5 }).slice(0, 8).map((c) => c.ref);
  assert.ok(!plain.includes('HAB 3:17-18'));
  // unit: a meaning match outside the named themes takes one of the reserved slots, tagged with its own themes
  const sem = new Map([...POOL.keys()].map((ref, i) => [ref, ref === 'ISA 26:4' ? 0.9 : 0.3 + (i % 7) * 0.01]));
  const ranked = rankCandidates({ themes: [{ theme: 'exams', weight: 1 }], references: [] }, new Set(), { random: () => 0.5, semantic: sem });
  const hit = ranked.slice(0, 8).find((c) => c.ref === 'ISA 26:4');
  assert.ok(hit && hit.semantic && hit.themes.includes('hope'));
});

test('abuse filter still applies with meaning search', async () => {
  const before = stats.embedCalls;
  const a = await call(env, 'abuse-sem', 'POST', '/companion/verses', { message: ABUSE, translation: 'KJV', country: 'ZA' });
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.equal(a.json.ranking, 'semantic');
  assert.equal(stats.embedCalls, before + 1);
  assert.ok(a.json.crisis);
  assert.equal(a.json.themes[0].theme, 'safety');
  assert.ok(a.json.verses.length >= 7);
  assert.ok(a.json.verses.every((v) => !UNSAFE.has(v.ref)), a.json.verses.map((v) => v.ref).join(', '));
  // unit: even a perfect meaning match from an unsafe theme is never added
  const sem = new Map([['EPH 5:25', 0.99], ['PRO 18:22', 0.98], ['PSA 32:7', 0.5], ['PSA 9:9', 0.4]]);
  const ranked = rankCandidates({ themes: [{ theme: 'marriage', weight: 1 }], references: [] }, new Set(), { random: () => 0.5, crisis: { abuse: true, any: true }, semantic: sem });
  assert.ok(ranked.every((c) => !UNSAFE.has(c.ref)));
  assert.ok(!ranked.some((c) => ['EPH 5:25', 'PRO 18:22'].includes(c.ref)));
  assert.ok(ranked.slice(0, 8).some((c) => c.ref === 'PSA 32:7'));
});

test('no-repeat still holds with meaning search', async () => {
  const seen = [];
  for (let i = 0; i < 2; i++) {
    const r = await verses('fig-repeat', FIG);
    assert.equal(r.status, 200);
    assert.equal(r.json.ranking, 'semantic');
    assert.ok(r.json.verses.length >= 7);
    seen.push(r.json.verses.flatMap((v) => verseKeys(v.ref)));
  }
  assert.ok(seen[0].includes('HAB 3:17'));
  const overlap = seen[1].filter((k) => seen[0].includes(k));
  assert.equal(overlap.length, 0, `second reply repeated ${overlap.join(', ')}`);
});

test('fallbacks: embedding failure, no AI binding, switched off → theme ranking, still ≥7 verses', async () => {
  stats.embedFail = true;
  const r = await verses('fallback-1', FIG);
  stats.embedFail = false;
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.ranking, 'themes');
  assert.ok(r.json.verses.length >= 7);

  const stub = await call(noAiEnv, 'fallback-2', 'POST', '/companion/verses', { message: FIG, devStub: true });
  assert.equal(stub.status, 200, JSON.stringify(stub.json));
  assert.equal(stub.json.ranking, 'themes');
  assert.ok(stub.json.verses.length >= 7);

  const off = await verses('fallback-3', FIG, { ...env, COMPANION_SEMANTIC: 'off' });
  assert.equal(off.json.ranking, 'themes');

  // a different embedding model has no vectors yet → themes, and no query embedding is spent
  _clearVectorCache();
  const calls = stats.embedCalls;
  const other = await verses('fallback-4', FIG, { ...env, COMPANION_EMBED_MODEL: '@cf/baai/bge-small-en-v1.5' });
  assert.equal(other.json.ranking, 'themes');
  assert.equal(stats.embedCalls, calls);
});
