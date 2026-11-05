// Loads Bible chapters for any translation in the catalog.
//
// • KJV ships inside the app (instant, offline).
// • Every other translation streams chapter-by-chapter from the Free Use Bible API the first time it
//   is opened and is cached on the device, so a chapter you've read once works offline afterwards.
// • "Download for offline" fetches a whole translation in one request (~2–3 MB gzipped) and stores it
//   book by book.
//
// getCachedChapter() is synchronous (memory only) so existing callers keep working; screens use the
// useChapter() hook, which loads asynchronously and re-renders when the text arrives.
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { BIBLE_API, CACHE_TTL } from './config';
import { TRANSLATIONS, resolveTranslationId, translationInfo } from './catalog';
import BOOKS from '../data/books_meta.json';

const mem = new Map(); // `${tr}:${book}:${ch}` -> string[]
const inflight = new Map();
const listeners = new Set();

const ROOT = FileSystem.documentDirectory ? FileSystem.documentDirectory + 'bibles/' : null; // null on web

function emit() { listeners.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } }); }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

const key = (tr, book, ch) => `${tr}:${book}:${ch}`;

// ---------- text helpers ----------
// Free Use Bible API verse content is an array of strings and inline objects
// ({ noteId }, { text, wordsOfJesus }, { lineBreak }, { heading } …). Keep only the readable text.
function flatten(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content && content.text ? content.text : '';
  return content.map((c) => {
    if (typeof c === 'string') return c;
    if (c && c.noteId !== undefined) return ' '; // footnote marker: the source drops the space around it
    if (!c || c.heading) return '';
    if (c.lineBreak) return ' ';
    if (c.text) return c.text;
    if (c.content) return flatten(c.content);
    return '';
  }).join('');
}

const tidy = (s) => String(s || '')
  .replace(/<S>\d+<\/S>/g, '') // Strong's numbers (bolls format)
  .replace(/<sup>.*?<\/sup>/g, '')
  .replace(/<[^>]+>/g, '')
  .replace(/\s+([,.;:!?»”’)])/g, '$1')
  .replace(/\s{2,}/g, ' ')
  .trim();

// Turns an API chapter (full or "simple" format) into ['verse 1', 'verse 2', …]
export function versesFromChapter(chapter) {
  const out = [];
  const content = (chapter && chapter.content) || [];
  content.forEach((item) => {
    if (!item || item.type !== 'verse' || !item.number) return;
    const text = tidy(item.text !== undefined ? item.text : flatten(item.content));
    const i = item.number - 1;
    out[i] = out[i] ? `${out[i]} ${text}` : text;
  });
  for (let i = 0; i < out.length; i++) if (out[i] === undefined) out[i] = '';
  return out;
}

export function headingFromChapter(chapter) {
  const h = ((chapter && chapter.content) || []).find((c) => c && c.type === 'heading');
  if (!h) return null;
  return tidy(h.text || flatten(h.content));
}

// ---------- storage ----------
async function readFile(path) {
  if (!ROOT) return null;
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    return JSON.parse(await FileSystem.readAsStringAsync(path));
  } catch (e) { return null; }
}
async function writeFile(path, data) {
  if (!ROOT) return;
  try {
    const dir = path.slice(0, path.lastIndexOf('/') + 1);
    const d = await FileSystem.getInfoAsync(dir);
    if (!d.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    await FileSystem.writeAsStringAsync(path, JSON.stringify(data));
  } catch (e) { /* storage full or unavailable — reading still works online */ }
}
const chapterPath = (tr, book, ch) => `${ROOT}${tr}/${book}/${ch}.json`;
const bookPath = (tr, book) => `${ROOT}${tr}/${book}.book.json`;

// ---------- bundled KJV ----------
let KJV = null;
function kjv() {
  // eslint-disable-next-line global-require
  if (!KJV) KJV = require('../data/kjv_bible.json');
  return KJV;
}

// ---------- public API ----------
export function getCachedChapter(trId, book, ch) {
  const tr = resolveTranslationId(trId);
  if (tr === 'KJV') return kjv()[`${book}:${ch}`] || null;
  return mem.get(key(tr, book, ch)) || null;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function bookNumber(book) { return BOOKS.findIndex((b) => b.id === book) + 1; }

async function fetchChapter(info, book, ch) {
  if (info.url) {
    // A licensed translation served by your own backend
    const url = info.url.replace('{book}', book).replace('{bookNum}', String(bookNumber(book))).replace('{chapter}', String(ch));
    const data = await fetchJson(url);
    const arr = Array.isArray(data) ? data : data.verses || [];
    return arr.map((v) => tidy(typeof v === 'string' ? v : v.text));
  }
  const data = await fetchJson(`${BIBLE_API}/${info.api}/${book}/${ch}.json`);
  return versesFromChapter(data.chapter);
}

// Returns verses for any translation: memory → device → network. Throws if offline and never cached.
export async function loadChapter(trId, book, ch) {
  const tr = resolveTranslationId(trId);
  if (tr === 'KJV') return getCachedChapter('KJV', book, ch);
  const k = key(tr, book, ch);
  if (mem.has(k)) return mem.get(k);
  if (inflight.has(k)) return inflight.get(k);
  const p = (async () => {
    const info = translationInfo(tr);
    // 1) a whole-book file from "Download for offline"
    const bookFile = await readFile(bookPath(tr, book));
    if (bookFile && bookFile[ch]) { mem.set(k, bookFile[ch]); return bookFile[ch]; }
    // 2) a chapter cached on an earlier visit
    const cached = await readFile(chapterPath(tr, book, ch));
    if (cached && cached.v && Date.now() - (cached.t || 0) < CACHE_TTL) { mem.set(k, cached.v); return cached.v; }
    // 3) the network
    try {
      const verses = await fetchChapter(info, book, ch);
      if (!verses.length) throw new Error('empty');
      mem.set(k, verses);
      writeFile(chapterPath(tr, book, ch), { t: Date.now(), v: verses });
      emit();
      return verses;
    } catch (e) {
      if (cached && cached.v) { mem.set(k, cached.v); return cached.v; } // stale is better than nothing
      throw e;
    }
  })();
  inflight.set(k, p);
  try { return await p; } finally { inflight.delete(k); }
}

// Warm the cache for the next chapter so swiping feels instant.
export function prefetchChapter(trId, book, ch) {
  loadChapter(trId, book, ch).catch(() => {});
}

// React hook used by the reader, compare view, study screen…
export function useChapter(trId, book, ch) {
  const tr = resolveTranslationId(trId);
  const [state, setState] = useState(() => {
    const v = getCachedChapter(tr, book, ch);
    return { verses: v, loading: !v, error: null };
  });
  useEffect(() => {
    let alive = true;
    const v = getCachedChapter(tr, book, ch);
    if (v) { setState({ verses: v, loading: false, error: null }); return () => { alive = false; }; }
    setState({ verses: null, loading: true, error: null });
    loadChapter(tr, book, ch)
      .then((verses) => { if (alive) setState({ verses, loading: false, error: null }); })
      .catch((e) => { if (alive) setState({ verses: null, loading: false, error: e.message || 'offline' }); });
    return () => { alive = false; };
  }, [tr, book, ch]);
  return { ...state, translation: tr, fallback: !state.verses && !state.loading ? getCachedChapter('KJV', book, ch) : null };
}

// ---------- offline downloads ----------
export async function isDownloaded(trId) {
  const tr = resolveTranslationId(trId);
  if (tr === 'KJV') return true;
  if (!ROOT) return false;
  const info = await FileSystem.getInfoAsync(`${ROOT}${tr}/complete.flag`).catch(() => ({ exists: false }));
  return !!info.exists;
}

// Downloads the whole translation and saves it book by book. onProgress(0..1)
export async function downloadTranslation(trId, onProgress = () => {}) {
  const tr = resolveTranslationId(trId);
  const info = translationInfo(tr);
  if (tr === 'KJV') { onProgress(1); return true; }
  if (info.url) throw new Error('Offline download for licensed translations is served by your backend.');
  onProgress(0.05);
  const data = await fetchJson(`${BIBLE_API}/${info.api}/complete.simple.json`);
  onProgress(0.45);
  const books = data.books || [];
  for (let i = 0; i < books.length; i++) {
    const b = books[i];
    const byChapter = {};
    (b.chapters || []).forEach((c) => {
      const chap = c.chapter || c;
      const verses = versesFromChapter(chap);
      byChapter[chap.number] = verses;
      mem.set(key(tr, b.id, chap.number), verses);
    });
    // eslint-disable-next-line no-await-in-loop
    await writeFile(bookPath(tr, b.id), byChapter);
    onProgress(0.45 + 0.55 * ((i + 1) / books.length));
  }
  if (ROOT) await FileSystem.writeAsStringAsync(`${ROOT}${tr}/complete.flag`, String(Date.now())).catch(() => {});
  emit();
  return true;
}

// The whole text of a downloaded translation as { 'GEN:1': [verse, …] } (used by full-Bible search),
// or null when it isn't stored on this device. KJV is bundled, so it's always available.
export async function readDownloadedText(trId) {
  const tr = resolveTranslationId(trId);
  if (tr === 'KJV') return kjv();
  if (!(await isDownloaded(tr))) return null;
  const out = {};
  for (let i = 0; i < BOOKS.length; i++) {
    // eslint-disable-next-line no-await-in-loop
    const byChapter = await readFile(bookPath(tr, BOOKS[i].id));
    if (!byChapter) return null;
    Object.keys(byChapter).forEach((ch) => { out[`${BOOKS[i].id}:${ch}`] = byChapter[ch]; });
  }
  return out;
}

export async function removeDownload(trId) {
  const tr = resolveTranslationId(trId);
  if (!ROOT || tr === 'KJV') return;
  await FileSystem.deleteAsync(`${ROOT}${tr}/`, { idempotent: true }).catch(() => {});
  [...mem.keys()].filter((k) => k.startsWith(tr + ':')).forEach((k) => mem.delete(k));
  emit();
}

export const canDownload = Platform.OS !== 'web';
export { TRANSLATIONS };

// Several translations of the same chapter at once (compare view).
export function useChapters(ids, book, ch) {
  const sig = ids.join(',');
  const [, force] = useState(0);
  useEffect(() => {
    let alive = true;
    ids.forEach((id) => {
      if (!getCachedChapter(id, book, ch)) loadChapter(id, book, ch).then(() => alive && force((n) => n + 1)).catch(() => alive && force((n) => n + 1));
    });
    return () => { alive = false; };
  }, [sig, book, ch]);
  return ids.map((id) => ({ id: resolveTranslationId(id), verses: getCachedChapter(id, book, ch) }));
}
