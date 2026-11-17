// BEYOND THE 66: every catalogued book has a text file, the files match the catalogue, and the API serves them.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket, makeAssets } from '../dev/local-env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, '..', 'public');
const DIR = path.join(PUBLIC, 'extra-books');
// the catalogue is app code (ESM); read its JSON literal so the test doesn't depend on the app bundler
const catSrc = fs.readFileSync(path.join(here, '..', '..', 'src', 'data', 'extraBooks.js'), 'utf8');
const BOOKS = JSON.parse(catSrc.match(/export const EXTRA_BOOKS = (\[[\s\S]*?\]);\n/)[1]);
const COLLECTIONS = JSON.parse(catSrc.match(/export const EXTRA_COLLECTIONS = (\[[\s\S]*?\]);\n/)[1]);

let env; const app = createApp();
before(async () => { env = { __db: await makeDb(null), MEDIA: makeBucket(null), ASSETS: makeAssets(PUBLIC), AUTH_DEV_MODE: 'true' }; });
const get = (p) => app.fetch(new Request(`http://api.test${p}`), env);

test('catalogue and files agree', () => {
  assert.ok(BOOKS.length >= 50);
  const ids = new Set();
  for (const b of BOOKS) {
    assert.ok(!ids.has(b.id), `unique id ${b.id}`); ids.add(b.id);
    assert.ok(COLLECTIONS.some((c) => c.id === b.collection), `${b.id} collection`);
    assert.ok(b.translation && b.name && b.note, `${b.id} credit + note`);
    const f = JSON.parse(fs.readFileSync(path.join(DIR, `${b.id}.json`), 'utf8'));
    assert.deepEqual(f.chapters.map((c) => c.n), b.chapters, `${b.id} chapter numbers`);
    const verses = f.chapters.reduce((n, c) => n + c.verses.length, 0);
    assert.equal(verses, b.verses, `${b.id} verse count`);
    for (const c of f.chapters) for (const [n, t] of c.verses) {
      assert.ok(Number.isInteger(n) && n >= 0, `${b.id} ${c.n}:${n} number`);
      assert.ok(t && !/\*\*|\[\d+:\d+\]/.test(t), `${b.id} ${c.n}:${n} clean text`);
    }
  }
  // nothing that isn't in the catalogue (e.g. a copyrighted text) is published
  for (const f of fs.readdirSync(DIR)) assert.ok(ids.has(f.replace(/\.json$/, '')), `stray file ${f}`);
});

test('API serves a book publicly with caching and CORS', async () => {
  const res = await get('/extra-books/1EN.json');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /json/);
  assert.match(res.headers.get('cache-control'), /max-age/);
  const j = await res.json();
  assert.equal(j.name, '1 Enoch');
  assert.match(j.chapters[0].verses[0][1], /blessing of Enoch/);
  assert.equal((await get('/extra-books/NOPE.json')).status, 404);
  assert.equal((await get('/extra-books/..%2Fx.json')).status, 404);
  assert.equal((await get('/extra-books/1en.json')).status, 404);
});
