// BOOKS (brief 18): public-domain Christian books read inside the app.
//   • Texts come from Project Gutenberg (public-domain works only; every entry in bookCatalogue.js has its ebook number
//     and licence, checked against Gutenberg's catalogue).
//   • Gutenberg's licence header and footer are removed before a text is stored or shown (their terms for redistribution);
//     the reader keeps the public-domain attribution and the source link.
//   • A text is fetched once, cleaned, split into chapters and cached in R2 (MEDIA) under books/<id>.json.
//   • Progress and bookmarks are per user (book_progress, book_bookmarks).
import { BOOK_SECTIONS, BOOK_CATALOGUE } from './bookCatalogue.js';

export { BOOK_SECTIONS, BOOK_CATALOGUE };

const GUTENBERG_TEXT_URL = (n) => `https://www.gutenberg.org/cache/epub/${n}/pg${n}.txt`;
const START_RE = /\*\*\*\s*START OF (?:THIS|THE) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*/i;
const END_RE = /\*\*\*\s*END OF (?:THIS|THE) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*/i;
const HEADING_RE = /^(?:CHAPTER|Chapter|BOOK|Book|PART|Part|SECTION|Section)\s+[0-9IVXLCDMivxlcdm]+\b.{0,100}$/;
const MAX_PARAGRAPHS_PER_PART = 120;

/** Removes the Project Gutenberg licence header and footer. The text between the markers is the work itself. */
export function stripGutenberg(raw) {
  let text = String(raw || '').replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  const start = START_RE.exec(text);
  if (start) text = text.slice(start.index + start[0].length);
  const end = END_RE.exec(text);
  if (end) text = text.slice(0, end.index);
  return text.trim();
}

/**
 * Cleaned text → chapters [{ title, paragraphs[] }]. Chapter headings ("CHAPTER IV") start a chapter. Very long
 * chapters are split into parts so a reader never has to load a whole book at once.
 */
export function splitChapters(text) {
  const chapters = [];
  let current = { title: 'Beginning', lines: [] };
  const flush = () => {
    const body = current.lines.join('\n').trim();
    if (body) chapters.push({ title: current.title, body });
  };
  for (const line of String(text || '').split('\n')) {
    const t = line.trim();
    if (t.length > 0 && t.length < 120 && HEADING_RE.test(t)) {
      flush();
      current = { title: t, lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  flush();
  const out = [];
  for (const ch of chapters) {
    const paragraphs = ch.body.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
    if (!paragraphs.length) continue;
    const parts = Math.ceil(paragraphs.length / MAX_PARAGRAPHS_PER_PART);
    for (let i = 0; i < parts; i += 1) {
      const slice = paragraphs.slice(i * MAX_PARAGRAPHS_PER_PART, (i + 1) * MAX_PARAGRAPHS_PER_PART);
      out.push({ title: parts > 1 ? `${ch.title} (${i + 1}/${parts})` : ch.title, paragraphs: slice });
    }
  }
  return out.length ? out : [{ title: 'Text', paragraphs: [String(text || '').trim()].filter(Boolean) }];
}

export const bookById = (id) => BOOK_CATALOGUE.find((b) => b.id === id) || null;

/** Public shape for the app (no text). */
export const bookShape = (b) => ({
  id: b.id,
  title: b.title,
  author: b.author,
  translator: b.translator || null,
  description: b.description,
  sections: b.sections,
  featured: !!b.featured,
  gutenbergId: b.gutenbergId,
  licence: b.licence,
  sourceUrl: `https://www.gutenberg.org/ebooks/${b.gutenbergId}`,
  attribution: `Public domain. Text from Project Gutenberg, ebook #${b.gutenbergId}.`,
});

/** Catalogue search (title, author, section). Empty query returns everything. */
export function searchCatalogue(query, section) {
  const needle = String(query || '').trim().toLowerCase();
  return BOOK_CATALOGUE.filter((b) => {
    if (section && !b.sections.includes(section)) return false;
    if (!needle) return true;
    return `${b.title} ${b.author} ${b.translator || ''} ${b.sections.join(' ')}`.toLowerCase().includes(needle);
  });
}

/** Search inside a book's chapters. → [{ chapter, paragraph, snippet }] (at most `limit`). */
export function searchBookText(chapters, query, limit = 60) {
  const needle = String(query || '').trim().toLowerCase();
  if (needle.length < 2) return [];
  const hits = [];
  chapters.forEach((ch, ci) => {
    ch.paragraphs.forEach((p, pi) => {
      if (hits.length >= limit) return;
      const at = p.toLowerCase().indexOf(needle);
      if (at < 0) return;
      const from = Math.max(0, at - 60);
      const snippet = `${from > 0 ? '…' : ''}${p.slice(from, at + needle.length + 80)}${at + needle.length + 80 < p.length ? '…' : ''}`;
      hits.push({ chapter: ci, paragraph: pi, title: ch.title, snippet });
    });
  });
  return hits;
}

/**
 * Returns the cleaned, chaptered text for a book. Reads the R2 cache first; on a miss fetches Gutenberg once.
 * Throws a readable Error when the source cannot be reached (the route turns it into a 503).
 */
export async function loadBookText(env, book) {
  const key = `books/${book.gutenbergId}.json`;
  if (env.MEDIA) {
    const cached = await env.MEDIA.get(key).catch(() => null);
    if (cached) return JSON.parse(await cached.text());
  }
  const fetcher = (env && env.__fetch) || fetch;
  const res = await fetcher(GUTENBERG_TEXT_URL(book.gutenbergId), { headers: { 'User-Agent': 'BibleNestraBot/1.0 (books reader)' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`The book source is unavailable right now (${res.status})`);
  const cleaned = stripGutenberg(await res.text());
  if (cleaned.length < 2000) throw new Error('The book text could not be read');
  const doc = { id: book.id, gutenbergId: book.gutenbergId, chapters: splitChapters(cleaned), fetchedAt: new Date().toISOString() };
  if (env.MEDIA) await env.MEDIA.put(key, JSON.stringify(doc), { httpMetadata: { contentType: 'application/json' } }).catch(() => {});
  return doc;
}
