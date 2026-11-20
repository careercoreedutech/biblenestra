// SCRIPTURE COMPANION + COMMENTARIES: safety first, ≥7 validated verses with exact Bible text, invalid model refs
// dropped, five situations → five different sets, no repeats for the same user, compose parts, no-AI behaviour,
// and the cached commentary endpoint. Workers AI and the Free Use Bible API are mocked.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { THEMES } from '../src/lib/companionIndex.js';
import { refExists } from '../src/lib/verseCounts.js';
import { canonicalRef, detectCrisis, helplinesFor, rankCandidates, parseUsfm, _clearChapterCache } from '../src/lib/companion.js';

const KJV = JSON.parse(readFileSync(new URL('../../src/data/kjv_bible.json', import.meta.url), 'utf8'));
const kjvText = (ref) => {
  const p = parseUsfm(ref);
  const ch = KJV[`${p.bookId}:${p.chapter}`];
  const out = [];
  for (let v = p.vs; v <= p.ve; v++) out.push(ch[v - 1]);
  return out.join(' ');
};

// ---------- Free Use Bible API mock (KJV from the bundled JSON; "BSB" = KJV text with a marker) ----------
const fetched = [];
let bibleDown = false;
const commentaryHits = [];
async function mockFetch(url) {
  const u = String(url);
  fetched.push(u);
  let m = u.match(/\/api\/c\/([\w-]+)\/(\w+)\/(\d+)\.json$/);
  if (m) {
    commentaryHits.push(u);
    if (m[1] === 'barnes' && m[2] === 'JHN' && m[3] === '3') {
      return new Response(JSON.stringify({ chapter: { content: [{ type: 'verse', number: 1, content: ['A man of the Pharisees.'] }, { type: 'verse', number: 16, content: ['For God so loved the world. ', { noteId: 3 }, 'The greatest verse.'] }] } }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }
  m = u.match(/\/api\/(\w+)\/(\w+)\/(\d+)\.json$/);
  if (m && !bibleDown) {
    const [, api, book, ch] = m;
    const verses = KJV[`${book === 'OBA' ? 'OBD' : book}:${ch}`];
    if (!verses || !['eng_kjv', 'BSB'].includes(api)) return new Response('nope', { status: 404 });
    const content = [{ type: 'heading', content: ['Heading'] }, ...verses.map((t, i) => ({ type: 'verse', number: i + 1, content: [{ text: api === 'BSB' ? `[BSB] ${t}` : t }, { noteId: i }, { lineBreak: true }] }))];
    return new Response(JSON.stringify({ chapter: { content } }), { status: 200 });
  }
  return new Response('down', { status: 503 });
}

// ---------- Workers AI mock ----------
const SITUATIONS = {
  sick: { message: 'The doctor says my mother has cancer and the surgery is next week. I am praying for healing.', themes: [{ theme: 'sickness', weight: 1 }, { theme: 'fear', weight: 0.5 }], refs: ['Psalm 41:3', 'Isaiah 38:5', 'Hezekiah 3:16', 'John 99:1', 'Psalm 23:99'] },
  money: { message: 'I lost my job last month, my rent is due and I am scared we will be evicted. I feel like God has abandoned me.', themes: [{ theme: 'finances', weight: 1 }, { theme: 'job', weight: 0.7 }, { theme: 'loneliness', weight: 0.4 }], refs: ['Philippians 4:19', '1 Kings 17:14', 'Psalm 37:25'] },
  grief: { message: 'My father died two weeks ago and I cannot stop crying. The funeral was so hard.', themes: [{ theme: 'grief', weight: 1 }], refs: ['John 11:25', 'Revelation 21:4', '2 Samuel 12:23'] },
  exams: { message: 'My final exams start on Monday and I panic every time I open my books. I am afraid of failing.', themes: [{ theme: 'exams', weight: 1 }, { theme: 'anxiety', weight: 0.6 }], refs: ['James 1:5', 'Daniel 1:17', 'Proverbs 2:6'] },
  marriage: { message: 'My husband and I fight every day and he talks about divorce. I want to save our marriage.', themes: [{ theme: 'marriage', weight: 1 }], refs: ['Ecclesiastes 4:12', '1 Corinthians 13:4-7', 'Ephesians 4:2'] },
};
const aiCalls = [];
const AI = {
  async run(model, input) {
    const p = input.messages[1].content;
    aiCalls.push({ model, prompt: p });
    await new Promise((r) => setTimeout(r, 5));
    if (p.includes('Choose the themes that fit')) {
      const s = Object.values(SITUATIONS).find((x) => p.includes(x.message.slice(0, 30)));
      const crisis = /end my life/.test(p);
      return { response: JSON.stringify({
        themes: s ? s.themes : [{ theme: 'depression', weight: 1 }],
        specifics: ['detail one', 'detail two'],
        summary: 'You are carrying a lot.',
        crisis,
        references: s ? s.refs : ['Psalm 34:18'],
        text: 'FAKE MODEL VERSE TEXT', // must never reach the reply
      }) };
    }
    if (p.includes('Write words of encouragement')) {
      return { choices: [{ message: { content: '```json\n' + JSON.stringify({ encouragement: 'God is near to you.', prayer: 'Lord, hold my mother in surgery. Amen.' }) + '\n```' } }] };
    }
    const refs = [...p.matchAll(/^\d+\. (.+?) — "/gm)].map((x) => x[1]);
    return { response: JSON.stringify({ explanations: refs.map((r) => ({ ref: r, explanation: `Because ${r} speaks to you.` })) }) };
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

// ---------- the curated index ----------
test('curated index: ≥15 references per required theme, every reference exists in the Bible', () => {
  const required = ['sickness', 'finances', 'depression', 'grief', 'fear', 'anxiety', 'loneliness', 'marriage', 'children', 'job', 'exams', 'guilt', 'temptation', 'betrayal', 'gratitude', 'newBeginnings', 'dryness'];
  for (const k of required) {
    assert.ok(THEMES[k], `missing theme ${k}`);
    assert.ok(THEMES[k].refs.length >= 15, `${k} has only ${THEMES[k].refs.length}`);
  }
  for (const [k, t] of Object.entries(THEMES)) {
    for (const ref of t.refs) {
      const p = parseUsfm(ref);
      assert.ok(p && refExists(p.bookId, p.chapter, p.vs, p.ve), `${k}: ${ref} does not exist`);
      assert.ok(kjvText(ref).length > 10, `${k}: ${ref} has no KJV text`);
    }
  }
});

test('reference validation: real ones normalised, invented ones rejected', () => {
  assert.equal(canonicalRef('Psalm 34:18'), 'PSA 34:18');
  assert.equal(canonicalRef('1 Corinthians 13:4-7'), '1CO 13:4-7');
  assert.equal(canonicalRef('PHP 4:6-7'), 'PHP 4:6-7');
  assert.equal(canonicalRef('Hezekiah 3:16'), null);
  assert.equal(canonicalRef('John 99:1'), null);
  assert.equal(canonicalRef('Psalm 23:99'), null);
  assert.equal(canonicalRef('Jude 1:30'), null);
});

test('safety check: crisis signals and country helplines', async () => {
  assert.equal(detectCrisis('I want to end my life').selfHarm, true);
  assert.equal(detectCrisis('My husband beats me').abuse, true);
  assert.equal(detectCrisis('I am worried about exams').any, false);
  assert.equal(helplinesFor('Nigeria').code, 'NG');
  assert.equal(helplinesFor('za').country, 'South Africa');
  assert.equal(helplinesFor('Brazil').code, null);
  assert.match(helplinesFor('Brazil').directory.url, /findahelpline/);

  const r = await call(env, 'safe1', 'POST', '/companion/safety', { message: 'I can’t take it anymore, I want to end my life', country: 'NG' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.crisis);
  assert.equal(r.json.crisis.country, 'Nigeria');
  assert.equal(r.json.crisis.emergency, '112');
  assert.ok(r.json.crisis.lines.some((l) => /SURPIN/.test(l.name)));
  assert.match(r.json.acknowledgement, /help below/);

  const uk = await call(env, 'safe2', 'POST', '/companion/safety', { message: 'my partner hits me and I am not safe at home', country: 'United Kingdom' });
  assert.ok(uk.json.crisis.lines.some((l) => /Domestic Abuse/.test(l.name)));
  const generic = await call(env, 'safe3', 'POST', '/companion/safety', { message: 'I want to kill myself', country: 'Atlantis' });
  assert.equal(generic.json.crisis.code, null);
  assert.ok(generic.json.crisis.directory.url);

  const calm = await call(env, 'safe4', 'POST', '/companion/safety', { message: 'My final exams and WAEC papers start next week and I am nervous' });
  assert.equal(calm.json.crisis, null);
  assert.equal(calm.json.themes[0].theme, 'exams');
});

test('verses: ≥7 scriptures, exact Bible text, invented references dropped, never model text', async () => {
  const r = await call(env, 'sickuser', 'POST', '/companion/verses', { message: SITUATIONS.sick.message, translation: 'KJV' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const v = r.json.verses;
  assert.ok(v.length >= 7, `only ${v.length} verses`);
  for (const x of v) {
    assert.equal(x.text, kjvText(x.ref), `${x.ref} text must match the Bible data exactly`);
    assert.ok(x.label && x.bookId && x.chapter && x.verseStart);
    assert.equal(x.translation, 'KJV');
  }
  const refs = v.map((x) => x.ref);
  assert.ok(!refs.some((x) => /^(JHN 99|PSA 23:99)/.test(x)));
  assert.ok(!JSON.stringify(r.json).includes('FAKE MODEL VERSE TEXT'));
  assert.ok(refs.includes('PSA 41:3'), 'model + index agreement ranks first');
  assert.match(r.json.medicalNote, /medical care/);
  assert.ok(r.json.requestId);
  assert.equal(r.json.crisis, null);

  // compose: three parts in parallel → explanation for every verse + encouragement + prayer
  const parts = await Promise.all(['x1', 'x2', 'p'].map((part) => call(env, 'sickuser', 'POST', '/companion/compose', { requestId: r.json.requestId, message: SITUATIONS.sick.message, part })));
  for (const p of parts) assert.equal(p.status, 200, JSON.stringify(p.json));
  const ex = { ...parts[0].json.explanations, ...parts[1].json.explanations };
  for (const x of v) assert.match(ex[x.ref] || '', /speaks to you/, `no explanation for ${x.ref}`);
  assert.equal(parts[2].json.encouragement, 'God is near to you.');
  assert.match(parts[2].json.prayer, /Amen\.$/);
  const pPrompt = aiCalls.filter((c) => c.prompt.includes('Write words of encouragement')).pop().prompt;
  assert.match(pPrompt, /medical care/, 'sickness → prayer prompt asks to encourage medical care');
  // a repeat is served from the saved reply
  const again = await call(env, 'sickuser', 'POST', '/companion/compose', { requestId: r.json.requestId, message: SITUATIONS.sick.message, part: 'p' });
  assert.equal(again.json.cached, true);
  // someone else can't read it
  const other = await call(env, 'intruder', 'POST', '/companion/compose', { requestId: r.json.requestId, message: 'x y', part: 'p' });
  assert.equal(other.status, 404);
});

test('five different situations → five clearly different verse sets', async () => {
  const sets = {};
  for (const [k, s] of Object.entries(SITUATIONS)) {
    const r = await call(env, `five-${k}`, 'POST', '/companion/verses', { message: s.message, translation: 'KJV' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(r.json.verses.length >= 7, `${k}: ${r.json.verses.length}`);
    sets[k] = new Set(r.json.verses.map((x) => x.ref));
  }
  const keys = Object.keys(sets);
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const shared = [...sets[keys[i]]].filter((x) => sets[keys[j]].has(x));
      assert.ok(shared.length <= 2, `${keys[i]} vs ${keys[j]} share ${shared.join(', ')}`);
    }
  }
});

test('repetition: the same user asking again gets new verses (last ~50 remembered)', async () => {
  const seen = [];
  for (let i = 0; i < 3; i++) {
    const r = await call(env, 'repeat-user', 'POST', '/companion/verses', { message: SITUATIONS.grief.message, translation: 'KJV' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(r.json.verses.length >= 7);
    seen.push(r.json.verses.map((x) => x.ref));
  }
  const overlap = seen[1].filter((x) => seen[0].includes(x));
  assert.equal(overlap.length, 0, `second reply repeated ${overlap.join(', ')}`);
  const overlap3 = seen[2].filter((x) => seen[0].includes(x) || seen[1].includes(x));
  assert.ok(overlap3.length <= 1, `third reply repeated ${overlap3.join(', ')}`);
  // ranking unit: recent verses go to the back, randomness varies near-ties
  const a = rankCandidates({ themes: [{ theme: 'fear', weight: 1 }], references: [] }, new Set(['ISA 41:10']), { random: () => 0 });
  assert.notEqual(a[0].ref, 'ISA 41:10');
  assert.ok(a.slice(0, 8).every((c) => c.ref !== 'ISA 41:10'));
});

test('crisis path: helplines at the top, comforting scripture still follows', async () => {
  const msg = 'I feel like a burden and I want to end my life tonight';
  const r = await call(env, 'crisis-user', 'POST', '/companion/verses', { message: msg, translation: 'KJV', country: 'KE' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.crisis, 'crisis block');
  assert.equal(r.json.crisis.country, 'Kenya');
  assert.ok(r.json.crisis.lines.some((l) => /Befrienders/.test(l.name)));
  assert.ok(r.json.verses.length >= 7);
  assert.ok(r.json.verses.some((v) => (v.themes || []).includes('despair')), 'verses for despair included');

  // abuse inside a marriage: refuge verses lead; never "forbear / forgive / stay together" verses
  const abuse = 'My husband beats me and I am scared. I want to save our marriage but he hits me every week.';
  const a = await call(env, 'abuse-user', 'POST', '/companion/verses', { message: abuse, translation: 'KJV', country: 'ZA' });
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.ok(a.json.crisis && a.json.crisis.lines.some((l) => /GBV/.test(l.name)));
  assert.equal(a.json.themes[0].theme, 'safety');
  assert.ok(!a.json.themes.some((t) => ['marriage', 'guilt', 'betrayal'].includes(t.theme)));
  const unsafe = new Set([...THEMES.marriage.refs, ...THEMES.guilt.refs, ...THEMES.betrayal.refs]);
  assert.ok(a.json.verses.every((v) => !unsafe.has(v.ref)), a.json.verses.map((v) => v.ref).join(', '));
  assert.ok(a.json.verses.length >= 7);
  await call(env, 'abuse-user', 'POST', '/companion/compose', { requestId: a.json.requestId, message: abuse, part: 'p' });
  assert.match(aiCalls[aiCalls.length - 1].prompt, /SAFETY: .*Never suggest they stay with/);
});

test('user’s translation: text comes from that translation, KJV fallback when unavailable', async () => {
  const r = await call(env, 'bsb-user', 'POST', '/companion/verses', { message: SITUATIONS.exams.message, translation: 'BSB', translationApi: 'BSB' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  for (const x of r.json.verses) {
    const p = parseUsfm(x.ref);
    const expected = [];
    for (let n = p.vs; n <= p.ve; n++) expected.push(`[BSB] ${KJV[`${p.bookId}:${p.chapter}`][n - 1]}`);
    assert.equal(x.translation, 'BSB');
    assert.equal(x.text, expected.join(' '));
  }
  const f = await call(env, 'nkjv-user', 'POST', '/companion/verses', { message: SITUATIONS.exams.message, translation: 'XYZ', translationApi: 'xyz_none' });
  assert.equal(f.status, 200);
  assert.ok(f.json.verses.every((x) => x.translation === 'KJV' && x.text === kjvText(x.ref)));
  // Bible data unreachable → no made-up text, a clear error instead
  _clearChapterCache();
  bibleDown = true;
  const down = await call(env, 'down-user', 'POST', '/companion/verses', { message: SITUATIONS.money.message, translation: 'KJV' });
  bibleDown = false;
  assert.equal(down.status, 502);
  assert.equal(down.json.code, 'BIBLE_UNAVAILABLE');
});

test('no AI binding: verses/compose → NOT_CONFIGURED; safety still works; dev stub uses real verses', async () => {
  const r = await call(noAiEnv, 'noai', 'POST', '/companion/verses', { message: SITUATIONS.money.message });
  assert.equal(r.status, 503);
  assert.equal(r.json.code, 'NOT_CONFIGURED');
  const s = await call(noAiEnv, 'noai', 'POST', '/companion/safety', { message: SITUATIONS.money.message });
  assert.equal(s.status, 200);
  const stub = await call(noAiEnv, 'noai', 'POST', '/companion/verses', { message: SITUATIONS.money.message, devStub: true });
  assert.equal(stub.status, 200, JSON.stringify(stub.json));
  assert.ok(stub.json.verses.length >= 7);
  assert.ok(stub.json.verses.every((x) => x.text === kjvText(x.ref)));
  assert.ok(stub.json.themes.some((t) => t.theme === 'finances'));
  const c = await call(noAiEnv, 'noai', 'POST', '/companion/compose', { requestId: stub.json.requestId, message: SITUATIONS.money.message, part: 'p', devStub: true });
  assert.equal(c.status, 200);
  assert.match(c.json.prayer, /Dev stub/);
  const noStub = await call(noAiEnv, 'noai', 'POST', '/companion/compose', { requestId: stub.json.requestId, message: SITUATIONS.money.message, part: 'x1' });
  assert.equal(noStub.json.code, 'NOT_CONFIGURED');
});

// ---------- commentaries ----------
test('commentaries: library list, cached chapter, coverage and unknown ids', async () => {
  const list = await call(env, 'reader', 'GET', '/study/commentaries');
  assert.equal(list.status, 200);
  const ids = list.json.items.map((x) => x.id);
  for (const id of ['matthew-henry', 'jamieson-fausset-brown', 'adam-clarke', 'john-gill', 'barnes', 'keil-delitzsch', 'tyndale', 'catena']) assert.ok(ids.includes(id), id);
  assert.ok(list.json.items.every((x) => x.name && x.author && x.licence));

  const before = commentaryHits.length;
  const a = await call(env, 'reader', 'GET', '/study/commentary/barnes/JHN/3');
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.equal(a.json.cached, false);
  assert.equal(a.json.source.author, 'Albert Barnes');
  assert.deepEqual(a.json.entries.map((e) => e.verse), [1, 16]);
  assert.match(a.json.entries[1].text, /^For God so loved the world\./);
  const b = await call(env, 'reader', 'GET', '/study/commentary/barnes/JHN/3');
  assert.equal(b.json.cached, true);
  assert.equal(commentaryHits.length, before + 1, 'second request served from the server cache');

  const ot = await call(env, 'reader', 'GET', '/study/commentary/barnes/GEN/1');
  assert.deepEqual(ot.json.entries, []); // Barnes covers the NT only — no outbound request
  assert.equal(commentaryHits.length, before + 1);
  assert.equal((await call(env, 'reader', 'GET', '/study/commentary/nope/JHN/3')).status, 404);
  assert.equal((await call(env, 'reader', 'GET', '/study/commentary/barnes/JHN/99')).status, 400);
});
