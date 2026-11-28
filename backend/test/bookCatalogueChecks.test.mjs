// BOOKS catalogue checks (brief 18): every section has at least one book, every book is in a known section, Gutenberg
// numbers are unique, each entry carries its licence line, and the entries added with a verified source are present.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOOK_CATALOGUE, BOOK_SECTIONS } from '../src/lib/bookCatalogue.js';

const SECTION_IDS = new Set(BOOK_SECTIONS.map((s) => s.id));

test('every book sits in known sections and carries a public-domain licence line', () => {
  for (const b of BOOK_CATALOGUE) {
    assert.ok(b.sections.length >= 1, `${b.id} has a section`);
    for (const s of b.sections) assert.ok(SECTION_IDS.has(s), `${b.id} → ${s} is a known section`);
    assert.match(b.licence, /Public domain/, `${b.id} licence`);
  }
});

test('Gutenberg numbers and book ids are unique', () => {
  const nums = BOOK_CATALOGUE.map((b) => b.gutenbergId);
  const ids = BOOK_CATALOGUE.map((b) => b.id);
  assert.equal(new Set(nums).size, nums.length);
  assert.equal(new Set(ids).size, ids.length);
});

test('every section that is shown has at least one book', () => {
  for (const s of BOOK_SECTIONS) {
    const n = BOOK_CATALOGUE.filter((b) => b.sections.includes(s.id)).length;
    assert.ok(n >= 1, `${s.name} has at least one book`);
  }
});

test('entries added from a verified Gutenberg source are present with the verified numbers', () => {
  const byId = Object.fromEntries(BOOK_CATALOGUE.map((b) => [b.id, b.gutenbergId]));
  assert.equal(byId['practice-of-the-presence-of-god'], 5657);
  assert.equal(byId['grace-abounding'], 654);
  assert.equal(byId['life-of-john-bunyan'], 1037);
  assert.equal(byId['romans-practical-exposition-gore'], 32673);
  assert.equal(byId['romans-expositors-bible-moule'], 48858);
  assert.equal(byId['smalcald-articles'], 273);
  assert.equal(byId['good-works-luther'], 418);
  assert.equal(byId['augsburg-confession-apology'], 6744);
});
