// "Beyond the 66" book texts (deuterocanonical & extra-biblical, public domain).
// The catalogue (names, chapters, credits) ships with the app in src/data/extraBooks.js; each book's text
// is downloaded from the API (/extra-books/<ID>.json) the first time it is opened and then kept on the
// device, so it reads offline afterwards.
import { useEffect, useState } from 'react';
import * as FileSystem from 'expo-file-system';
import { API_CONFIG } from '../api/config';
import { extraBook } from '../data/extraBooks';

const ROOT = FileSystem.documentDirectory ? `${FileSystem.documentDirectory}extra-books/` : null; // null on web
const mem = new Map(); // id → { id, name, translation, chapters: [{ n, verses: [[num, text]] }] }
const inflight = new Map();

// The texts are public: use the configured API, or the production API when the app runs in local mode.
const FALLBACK_API = 'https://biblenestra-api.lightddarkness.workers.dev';
const apiBase = () => (API_CONFIG.apiUrl || process.env.EXPO_PUBLIC_API_URL || FALLBACK_API).replace(/\/+$/, '');

const filePath = (id) => `${ROOT}${id}.json`;

async function readCached(id) {
  if (!ROOT) return null;
  try {
    const info = await FileSystem.getInfoAsync(filePath(id));
    if (!info.exists) return null;
    return JSON.parse(await FileSystem.readAsStringAsync(filePath(id)));
  } catch (e) { return null; }
}

async function writeCached(id, data) {
  if (!ROOT) return;
  try {
    const d = await FileSystem.getInfoAsync(ROOT);
    if (!d.exists) await FileSystem.makeDirectoryAsync(ROOT, { intermediates: true });
    await FileSystem.writeAsStringAsync(filePath(id), JSON.stringify(data));
  } catch (e) { /* caching is best-effort */ }
}

export async function isExtraBookSaved(id) {
  if (mem.has(id)) return true;
  if (!ROOT) return false;
  const info = await FileSystem.getInfoAsync(filePath(id)).catch(() => ({ exists: false }));
  return !!info.exists;
}

/** → the whole book. Memory → device → network. Throws when offline and never downloaded. */
export async function loadExtraBook(id) {
  if (!extraBook(id)) throw new Error('Unknown book');
  if (mem.has(id)) return mem.get(id);
  if (inflight.has(id)) return inflight.get(id);
  const p = (async () => {
    const cached = await readCached(id);
    if (cached && Array.isArray(cached.chapters)) { mem.set(id, cached); return cached; }
    let res;
    try {
      res = await fetch(`${apiBase()}/extra-books/${id}.json`, { headers: { Accept: 'application/json' } });
    } catch (e) {
      throw new Error('You’re offline. Open this book once while connected and it will be saved for offline reading.');
    }
    if (!res.ok) throw new Error(`This book couldn’t be loaded (HTTP ${res.status}).`);
    const data = await res.json();
    if (!data || !Array.isArray(data.chapters)) throw new Error('This book couldn’t be read.');
    mem.set(id, data);
    writeCached(id, data);
    return data;
  })();
  inflight.set(id, p);
  try { return await p; } finally { inflight.delete(id); }
}

/** React hook: { book, loading, error, retry } */
export function useExtraBook(id) {
  const [state, setState] = useState(() => ({ book: mem.get(id) || null, loading: !mem.has(id), error: null }));
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    if (mem.has(id)) { setState({ book: mem.get(id), loading: false, error: null }); return () => { alive = false; }; }
    setState({ book: null, loading: true, error: null });
    loadExtraBook(id)
      .then((book) => { if (alive) setState({ book, loading: false, error: null }); })
      .catch((e) => { if (alive) setState({ book: null, loading: false, error: (e && e.message) || 'Couldn’t load this book' }); });
    return () => { alive = false; };
  }, [id, attempt]);
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}

// Display label for a chapter number (some books have a 0 = preface)
export const chapterLabel = (n) => (n === 0 ? 'Preface' : String(n));
