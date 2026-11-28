// BOOKS (brief 18): Gutenberg header/footer removal, chapter splitting, catalogue search, in-book search,
// public-domain catalogue rules, and the cached text loader (stubbed source).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripGutenberg, splitChapters, searchCatalogue, searchBookText, loadBookText, bookShape, BOOK_CATALOGUE, BOOK_SECTIONS } from '../src/lib/books.js';

const RAW = `The Project Gutenberg eBook of Test

License text that must not appear.

*** START OF THE PROJECT GUTENBERG EBOOK TEST ***

CHAPTER I

The first paragraph of the work.

CHAPTER II

The second paragraph of the work.
*** END OF THE PROJECT GUTENBERG EBOOK TEST ***
Gutenberg footer that must not appear.`;

test('stripGutenberg removes the licence header and footer and keeps the work', () => {
  const text = stripGutenberg(RAW);
  assert.ok(!text.includes('License text that must not appear'), 'the licence block before the start marker is removed');
  assert.ok(text.includes('The first paragraph of the work.'));
  assert.ok(!text.includes('Gutenberg footer'));
  assert.ok(!text.includes('***'));
});

test('stripGutenberg leaves text without markers unchanged (apart from line endings)', () => {
  assert.equal(stripGutenberg('Line one\r\nLine two'), 'Line one\nLine two');
});

test('splitChapters starts a chapter at each heading and keeps paragraphs whole', () => {
  const chapters = splitChapters(stripGutenberg(RAW));
  assert.deepEqual(chapters.map((c) => c.title), ['CHAPTER I', 'CHAPTER II']);
  assert.deepEqual(chapters[0].paragraphs, ['The first paragraph of the work.']);
});

test('splitChapters with no headings still returns the text', () => {
  const chapters = splitChapters('Only one paragraph here.\n\nAnd another.');
  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].paragraphs.length, 2);
});

test('catalogue: every book is public domain with a Gutenberg number, and sections are known', () => {
  const sectionIds = new Set(BOOK_SECTIONS.map((s) => s.id));
  assert.ok(BOOK_CATALOGUE.length >= 1);
  for (const b of BOOK_CATALOGUE) {
    assert.ok(Number.isInteger(b.gutenbergId) && b.gutenbergId > 0, `${b.id} has a Gutenberg number`);
    assert.match(b.licence, /Public domain/);
    assert.ok(b.sections.every((s) => sectionIds.has(s)), `${b.id} uses known sections`);
    const shape = bookShape(b);
    assert.equal(shape.sourceUrl, `https://www.gutenberg.org/ebooks/${b.gutenbergId}`);
  }
  assert.equal(new Set(BOOK_CATALOGUE.map((b) => b.id)).size, BOOK_CATALOGUE.length, 'ids are unique');
});

test('catalogue search matches title, author and section; empty query returns all', () => {
  assert.equal(searchCatalogue('').length, BOOK_CATALOGUE.length);
  assert.ok(searchCatalogue('bunyan').some((b) => b.id === 'pilgrims-progress'));
  assert.ok(searchCatalogue('martyrs', 'martyrs-church-history').length >= 1);
  assert.equal(searchCatalogue('zzz-no-such-book').length, 0);
  for (const b of searchCatalogue('', 'featured')) assert.ok(b.sections.includes('featured'));
});

test('in-book search returns chapter, paragraph and a snippet; short queries return nothing', () => {
  const chapters = [
    { title: 'One', paragraphs: ['The gate was narrow.', 'Nothing here.'] },
    { title: 'Two', paragraphs: ['Through the gate again.'] },
  ];
  const hits = searchBookText(chapters, 'gate');
  assert.deepEqual(hits.map((h) => [h.chapter, h.paragraph]), [[0, 0], [1, 0]]);
  assert.match(hits[0].snippet, /gate/);
  assert.deepEqual(searchBookText(chapters, 'g'), []);
});

test('loadBookText reads the R2 cache first and fetches Gutenberg only once on a miss', async () => {
  const book = BOOK_CATALOGUE[0];
  const body = `Header\n*** START OF THE PROJECT GUTENBERG EBOOK X ***\n${'Words of the work. '.repeat(200)}\n\nCHAPTER I\n\n${'More words. '.repeat(200)}\n*** END OF THE PROJECT GUTENBERG EBOOK X ***`;
  const store = new Map();
  const env = {
    MEDIA: {
      get: async (k) => (store.has(k) ? { text: async () => store.get(k) } : null),
      put: async (k, v) => { store.set(k, v); },
    },
  };
  let calls = 0;
  env.__fetch = async (url) => { calls += 1; assert.match(url, new RegExp(`/cache/epub/${book.gutenbergId}/`)); return new Response(body, { status: 200 }); };
  const first = await loadBookText(env, book);
  assert.ok(first.chapters.length >= 1);
  assert.ok(!JSON.stringify(first).includes('START OF THE PROJECT'), 'cached text has no Gutenberg markers');
  const second = await loadBookText(env, book);
  assert.equal(second.chapters.length, first.chapters.length);
  assert.equal(calls, 1, 'second read comes from the cache');
});

test('loadBookText reports a readable error when the source is down', async () => {
  const env = { __fetch: async () => new Response('down', { status: 503 }) };
  await assert.rejects(() => loadBookText(env, BOOK_CATALOGUE[0]), /unavailable/);
});
