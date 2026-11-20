// EXEGESIS: one tap → 11 structured sections; cache per verse range + translation; model fallback; no-AI errors.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { buildPrompt, cleanPart, parseJsonLoose, lookupOriginalLanguage, SECTION_ORDER } from '../src/lib/exegesis.js';

// bolls.life mock: Strong's-tagged Romans 8:28 + two lexicon entries
const TAGGED = [{ verse: 28, text: 'And<S>1161</S> we know<S>1492</S> that<S>3754</S> all things<S>3956</S> work together<S>4903</S> for<S>1519</S> good<S>18</S> to them that love<S>25</S> God<S>2316</S>' }];
const LEX = {
  G25: [{ topic: 'G25', lexeme: 'ἀγαπάω', transliteration: 'agapaō', short_definition: 'to love', definition: '<b>to love</b>, to welcome, to entertain' }],
  G4903: [{ topic: 'G4903', lexeme: 'συνεργέω', transliteration: 'synergeō', short_definition: 'to work together', definition: 'to work together, help' }],
};
const fetched = [];
async function mockFetch(url) {
  const u = String(url);
  fetched.push(u);
  if (u.includes('/get-chapter/KJV/45/8/')) return new Response(JSON.stringify(TAGGED), { status: 200 });
  const m = u.match(/BDBT\/(G\d+)\//);
  if (m) return new Response(JSON.stringify(LEX[m[1]] || []), { status: 200 });
  return new Response('[]', { status: 404 });
}

const REPLIES = {
  a: { historical: 'Paul wrote Romans from Corinth around AD 57.', cultural: 'Roman believers faced hardship.', literary: 'Romans 8 closes the argument of chapters 5-8.',
    originalLanguage: [{ english: 'love', original: 'ἀγαπάω', translit: 'agapaō', strong: 'G25', meaning: 'Covenant love.' }, { english: 'work together', strong: 'G4903', meaning: 'Cooperate.' }] },
  b: { keyTerms: [{ term: 'all things', meaning: 'Every circumstance.' }], interpretation: 'God works in every circumstance for the good of believers.', theology: 'Providence.', authorIntent: 'Assurance for suffering believers.' },
  c: { crossReferences: [{ ref: 'Genesis 50:20', note: 'Joseph.' }, { ref: 'Ephesians 1:11', note: 'Purpose.' }, { ref: 'Not a ref', note: 'x' }, { ref: 'Gen 50:20', note: 'dup' }],
    application: { preaching: ['God is at work'], teaching: ['Study providence'], personal: ['Trust him'] } },
};
const calls = [];
let failFirstModel = false;
const AI = {
  async run(model, input) {
    calls.push({ model, prompt: input.messages[1].content });
    if (failFirstModel && model === '@cf/meta/llama-3.3-70b-instruct-fp8-fast') throw new Error('5007: No such model');
    const p = input.messages[1].content;
    const part = p.includes('sections 2-5') ? 'a' : p.includes('sections 6-9') ? 'b' : 'c';
    await new Promise((r) => setTimeout(r, 30));
    // one model replies OpenAI-style, one as a fenced JSON string
    if (part === 'b') return { choices: [{ message: { content: JSON.stringify(REPLIES.b) } }] };
    return { response: '```json\n' + JSON.stringify(REPLIES[part]) + '\n```' };
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
const ROM828 = { bookId: 'ROM', chapter: 8, verseStart: 28, translation: 'KJV', text: 'And we know that all things work together for good to them that love God…', context: 'For I reckon that the sufferings of this present time…' };

test('one request → all 11 sections, in order, with tappable cross-references', async () => {
  const r = await call(env, 'preacher', 'POST', '/study/exegesis', ROM828);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.cached, false);
  assert.equal(r.json.ref.label, 'Romans 8:28');
  assert.match(r.json.passage.label, /Romans 8:28 \(KJV\)/);
  assert.match(r.json.passage.text, /all things work together/);
  const s = r.json.sections;
  for (const [k] of SECTION_ORDER.slice(1)) assert.ok(s[k] && (typeof s[k] === 'string' ? s[k].length : Object.keys(s[k]).length || s[k].length), `missing ${k}`);
  assert.equal(s.originalLanguage[1].original, 'συνεργέω', 'lemma filled from the lexicon dataset');
  assert.deepEqual(s.crossReferences.map((x) => x.ref), ['GEN 50:20', 'EPH 1:11']); // invalid + duplicate dropped
  assert.deepEqual(s.application.personal, ['Trust him']);
  assert.match(r.json.label, /AI-generated/);
  assert.equal(calls.length, 3, 'three parallel parts');
  // prompt carries verse, context, book metadata and Strong's data
  const pa = calls.find((c) => c.prompt.includes('sections 2-5')).prompt;
  assert.match(pa, /Romans 8:28 \(KJV\)/);
  assert.match(pa, /Surrounding passage/);
  assert.match(pa, /Author: Paul/);
  assert.match(pa, /G25 ἀγαπάω \(agapaō\)/);
  assert.ok(fetched.some((u) => u.includes('/get-chapter/KJV/45/8/')));
});

test('second request for the same range + translation is served from cache (< 500 ms, no model call)', async () => {
  const before = calls.length;
  const t0 = Date.now();
  const r = await call(env, 'someone-else', 'POST', '/study/exegesis', ROM828);
  const ms = Date.now() - t0;
  assert.equal(r.status, 200);
  assert.equal(r.json.cached, true);
  assert.equal(calls.length, before);
  assert.ok(ms < 500, `took ${ms} ms`);
  assert.equal(r.json.sections.interpretation, REPLIES.b.interpretation);
  // a different translation is a different cache entry
  const r2 = await call(env, 'preacher', 'POST', '/study/exegesis', { ...ROM828, translation: 'WEB', text: 'We know that all things work together for good…', part: 'c' });
  assert.equal(r2.json.cached, false);
  assert.deepEqual(r2.json.parts, ['c']);
  assert.ok(r2.json.sections.crossReferences && !r2.json.sections.historical, 'only the requested part');
});

test('parts requested separately are merged into one cache row', async () => {
  const base = { ...ROM828, verseStart: 26, verseEnd: 27 };
  const [a, b] = await Promise.all([call(env, 'u1', 'POST', '/study/exegesis', { ...base, part: 'a' }), call(env, 'u1', 'POST', '/study/exegesis', { ...base, part: 'b' })]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  const before = calls.length;
  const c = await call(env, 'u1', 'POST', '/study/exegesis', { ...base, part: 'c' });
  assert.equal(calls.length, before + 1);
  const all = await call(env, 'u1', 'POST', '/study/exegesis', base);
  assert.equal(all.json.cached, true);
  assert.ok(all.json.sections.historical && all.json.sections.theology && all.json.sections.application);
  assert.equal(c.json.ref.label, 'Romans 8:26-27');
});

test('falls back to the next model when the first is retired', async () => {
  failFirstModel = true;
  const before = calls.length;
  const r = await call(env, 'u2', 'POST', '/study/exegesis', { ...ROM828, bookId: 'JHN', chapter: 3, verseStart: 16, part: 'b' });
  failFirstModel = false;
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.model, '@cf/meta/llama-3.1-70b-instruct');
  assert.equal(calls.length - before, 2);
});

test('validation and no-AI behaviour', async () => {
  assert.equal((await call(env, 'u3', 'POST', '/study/exegesis', { ...ROM828, bookId: 'XYZ' })).status, 400);
  assert.equal((await call(env, 'u3', 'POST', '/study/exegesis', { ...ROM828, chapter: 17 })).status, 400);
  assert.equal((await call(env, 'u3', 'POST', '/study/exegesis', { ...ROM828, verseEnd: 20 })).status, 400);
  assert.equal((await call(env, 'u3', 'POST', '/study/exegesis', { ...ROM828, text: '' })).status, 400);
  assert.equal((await call(env, 'u3', 'POST', '/study/exegesis', { ...ROM828, part: 'z' })).status, 400);
  // no binding: a clear NOT_CONFIGURED for anything not cached…
  const nc = await call(noAiEnv, 'u3', 'POST', '/study/exegesis', { ...ROM828, verseStart: 1 });
  assert.equal(nc.status, 503);
  assert.equal(nc.json.code, 'NOT_CONFIGURED');
  // …but cached passages still open
  const cached = await call(noAiEnv, 'u3', 'POST', '/study/exegesis', ROM828);
  assert.equal(cached.status, 200);
  // dev stub (AUTH_DEV_MODE only) for testing the screen locally; cached separately from real text
  const st = await call(noAiEnv, 'u3', 'POST', '/study/exegesis', { ...ROM828, verseStart: 1, devStub: true });
  assert.equal(st.status, 200);
  assert.equal(st.json.model, 'dev-stub');
  assert.match(st.json.sections.historical, /Dev stub/);
  const prod = await call({ ...noAiEnv, AUTH_DEV_MODE: 'false' }, 'u3', 'POST', '/study/exegesis', { ...ROM828, verseStart: 2, devStub: true });
  assert.equal(prod.status, 401, 'outside dev mode the stub is unreachable (and so is X-Dev-User)');
  // signed-in only
  const anon = await app.fetch(new Request('http://api.test/study/exegesis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ROM828) }), env);
  assert.equal(anon.status, 401);
});

test('quota errors become a friendly BUSY', async () => {
  const busyEnv = { ...env, AI: { run: async () => { throw new Error('3036: daily free allocation exceeded'); } } };
  const r = await call(busyEnv, 'u4', 'POST', '/study/exegesis', { ...ROM828, verseStart: 3 });
  assert.equal(r.status, 503);
  assert.equal(r.json.code, 'BUSY');
});

test('helpers: loose JSON, cleaning, prompt without lexicon, lexicon lookup failure is harmless', async () => {
  assert.deepEqual(parseJsonLoose('Sure! {"a": [1,2,],}'), { a: [1, 2] });
  assert.equal(parseJsonLoose('no json'), null);
  const a = cleanPart('a', { originalLanguage: [{ english: 'x', strong: 'bogus' }] }, []);
  assert.equal(a.originalLanguage[0].strong, '');
  const fromLex = cleanPart('a', {}, [{ english: 'love', strong: 'G25', lemma: 'ἀγαπάω', translit: 'agapaō', gloss: 'to love' }]);
  assert.equal(fromLex.originalLanguage[0].strong, 'G25');
  const p = buildPrompt({ bookId: 'GEN', chapter: 1, verseStart: 1, verseEnd: 1, translation: 'KJV', text: 'In the beginning' }, 'a', []);
  assert.match(p, /Hebrew/);
  assert.match(p, /Moses/);
  const none = await lookupOriginalLanguage({ __fetch: async () => { throw new Error('offline'); } }, { bookId: 'GEN', chapter: 1, verseStart: 1, verseEnd: 1 });
  assert.deepEqual(none, []);
});
