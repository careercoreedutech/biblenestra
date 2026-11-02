// In-app study data: public-domain commentaries, Strong's-tagged KJV words and the Strong's lexicon
// (Thayer's Greek + Brown-Driver-Briggs Hebrew). Everything is fetched once, cached on the device,
// and rendered inside the app — no links out to other websites.
import { useEffect, useState } from 'react';
import * as FileSystem from 'expo-file-system';
import { BIBLE_API, LEXICON_API } from './config';
import BOOKS from '../data/books_meta.json';

export const COMMENTARIES = [
  { id: 'matthew-henry', name: 'Matthew Henry', short: 'Henry', about: 'Devotional & practical · 1706', licence: 'Public domain' },
  { id: 'jamieson-fausset-brown', name: 'Jamieson-Fausset-Brown', short: 'JFB', about: 'Verse-by-verse, concise · 1871', licence: 'Public domain' },
  { id: 'adam-clarke', name: 'Adam Clarke', short: 'Clarke', about: 'Historical & linguistic · 1831', licence: 'Public domain' },
  { id: 'john-gill', name: 'John Gill', short: 'Gill', about: 'Expository, Hebrew & rabbinic background · 1763', licence: 'Public domain' },
  { id: 'tyndale', name: 'Tyndale Open Study Notes', short: 'Tyndale', about: 'Modern study notes', licence: 'Tyndale House · CC BY-SA 4.0' },
  { id: 'keil-delitzsch', name: 'Keil & Delitzsch', short: 'K&D', about: 'Old Testament scholarship · 1866', licence: 'Public domain', otOnly: true },
  { id: 'john-calvin', name: 'John Calvin', short: 'Calvin', about: 'Reformation commentaries · 1550s', licence: 'Public domain' },
];

const mem = new Map();
const ROOT = FileSystem.documentDirectory ? FileSystem.documentDirectory + 'study/' : null;

async function cached(name, loader) {
  if (mem.has(name)) return mem.get(name);
  const path = ROOT ? ROOT + name.replace(/[^\w.-]/g, '_') + '.json' : null;
  if (path) {
    try {
      const info = await FileSystem.getInfoAsync(path);
      if (info.exists) { const v = JSON.parse(await FileSystem.readAsStringAsync(path)); mem.set(name, v); return v; }
    } catch (e) { /* re-fetch */ }
  }
  const v = await loader();
  mem.set(name, v);
  if (path) {
    FileSystem.makeDirectoryAsync(ROOT, { intermediates: true }).catch(() => {})
      .then(() => FileSystem.writeAsStringAsync(path, JSON.stringify(v))).catch(() => {});
  }
  return v;
}

async function getJson(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

const strip = (s) => String(s || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
function flat(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return (content && (content.text || (content.content && flat(content.content)))) || '';
  return content.map((c) => (typeof c === 'string' ? c : c && c.noteId === undefined ? (c.text || (c.content ? flat(c.content) : '')) : ' ')).join('');
}

// -> [{ verse: number|null, text }] — verse null means an introduction to the chapter
export function loadCommentary(id, book, chapter) {
  return cached(`c_${id}_${book}_${chapter}`, async () => {
    const data = await getJson(`${BIBLE_API}/c/${id}/${book}/${chapter}.json`);
    const out = [];
    ((data.chapter && data.chapter.content) || []).forEach((c) => {
      const text = strip(c.text !== undefined ? c.text : flat(c.content));
      if (!text) return;
      out.push({ verse: c.type === 'verse' ? c.number : null, text });
    });
    return out;
  });
}

// ---------- Strong's ----------
const bookNum = (book) => BOOKS.findIndex((b) => b.id === book) + 1;
const isOT = (book) => (BOOKS.find((b) => b.id === book) || {}).testament === 'OT';

// KJV verse split into words with their Strong's numbers: [[{ w, s: 'G26' | null }, …], …]
export function loadTaggedChapter(book, chapter) {
  return cached(`kjvs_${book}_${chapter}`, async () => {
    const data = await getJson(`${LEXICON_API}/get-chapter/KJV/${bookNum(book)}/${chapter}/`);
    const prefix = isOT(book) ? 'H' : 'G';
    const verses = [];
    data.forEach((v) => {
      const words = [];
      const re = /([^<]*?)((?:<S>\d+<\/S>\s*)+)|([^<]+)$/g;
      const txt = String(v.text || '').replace(/<(?!\/?S>)[^>]+>/g, '');
      let m;
      while ((m = re.exec(txt)) && m[0]) {
        if (m[3] !== undefined) {
          const tail = m[3].trim();
          if (tail && /^[^A-Za-z]+$/.test(tail) && words.length) words[words.length - 1].w += tail;
          else if (tail) words.push({ w: tail, s: null });
          continue;
        }
        const nums = (m[2].match(/\d+/g) || []);
        const raw = m[1].trim();
        const lead = (raw.match(/^[^A-Za-z]+/) || [''])[0].trim(); // punctuation carried over from the previous word
        const w = raw.slice(lead.length).trim();
        if (lead && words.length) words[words.length - 1].w += lead;
        if (w) words.push({ w, s: prefix + nums[0], all: nums.map((n) => prefix + n) });
      }
      verses[v.verse - 1] = words;
    });
    return verses;
  });
}

// One lexicon entry by Strong's number, e.g. 'G26' or 'H430'
export function loadStrong(code) {
  const c = String(code || '').toUpperCase().replace(/\s/g, '');
  return cached(`s_${c}`, async () => {
    const arr = await getJson(`${LEXICON_API}/dictionary-definition/BDBT/${encodeURIComponent(c)}/`);
    const e = (arr || []).find((x) => x.topic === c) || (arr || [])[0];
    if (!e) return null;
    return normalise(e);
  });
}

// Search the lexicon by English word, transliteration or Strong's number
export function searchLexicon(q) {
  const s = String(q || '').trim();
  if (!s) return Promise.resolve([]);
  if (/^[GH]\d{1,4}$/i.test(s)) return loadStrong(s).then((e) => (e ? [e] : []));
  return cached(`q_${s.toLowerCase()}`, async () => {
    const arr = await getJson(`${LEXICON_API}/dictionary-definition/BDBT/${encodeURIComponent(s)}/`);
    return (arr || []).slice(0, 40).map(normalise);
  });
}

function normalise(e) {
  return {
    strong: e.topic,
    lang: e.topic && e.topic[0] === 'H' ? 'Hebrew' : 'Greek',
    lemma: e.lexeme,
    translit: e.transliteration,
    pronun: e.pronunciation,
    gloss: e.short_definition,
    html: e.definition || '',
  };
}

// ---------- tiny HTML → rich text for lexicon definitions ----------
// Returns blocks: [{ type: 'p' | 'li', depth, parts: [{ text, b, i, link }] }]
export function parseDefinition(html) {
  const blocks = [];
  let cur = { type: 'p', depth: 0, parts: [] };
  const flush = () => { if (cur.parts.some((p) => p.text.trim())) blocks.push(cur); };
  const st = { b: 0, i: 0, link: null, depth: 0 };
  const tokens = String(html).replace(/\r|\n/g, ' ').split(/(<[^>]+>)/g);
  tokens.forEach((tok) => {
    if (!tok) return;
    if (tok[0] === '<') {
      const t = tok.toLowerCase();
      if (/^<p\b/.test(t) || /^<br/.test(t) || /^<\/p>/.test(t)) { flush(); cur = { type: 'p', depth: st.depth, parts: [] }; return; }
      if (/^<li\b/.test(t)) { flush(); cur = { type: 'li', depth: st.depth, parts: [] }; return; }
      if (/^<ol\b|^<ul\b/.test(t)) { flush(); st.depth += 1; cur = { type: 'p', depth: st.depth, parts: [] }; return; }
      if (/^<\/ol>|^<\/ul>/.test(t)) { flush(); st.depth = Math.max(0, st.depth - 1); cur = { type: 'p', depth: st.depth, parts: [] }; return; }
      if (/^<b\b|^<strong/.test(t)) { st.b += 1; return; }
      if (/^<\/b>|^<\/strong/.test(t)) { st.b = Math.max(0, st.b - 1); return; }
      if (/^<i\b|^<em/.test(t)) { st.i += 1; return; }
      if (/^<\/i>|^<\/em/.test(t)) { st.i = Math.max(0, st.i - 1); return; }
      const a = tok.match(/href=["']?S:([GH]\d+)/i);
      if (/^<a\b/.test(t)) { st.link = a ? a[1].toUpperCase() : null; return; }
      if (/^<\/a>/.test(t)) { st.link = null; return; }
      return; // other tags (<el>, <he>, <font>…) are ignored, their text kept
    }
    const text = tok.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    if (!text) return;
    cur.parts.push({ text, b: st.b > 0, i: st.i > 0, link: st.link });
  });
  flush();
  // trim leading "- " bullets the source uses as separators
  blocks.forEach((bl) => { if (bl.parts[0]) bl.parts[0].text = bl.parts[0].text.replace(/^\s*-\s*/, ''); });
  // The header (original word, transliteration, phonetic) is already shown above the definition.
  return blocks.filter((bl) => {
    const t = bl.parts.map((p) => p.text).join('').trim();
    return t && !/^(Original|Transliteration|Phonetic)\s*:/i.test(t);
  });
}

// ---------- hooks ----------
export function useAsync(fn, deps) {
  const [st, setSt] = useState({ data: null, loading: true, error: null });
  useEffect(() => {
    let alive = true;
    setSt((s) => ({ ...s, loading: true, error: null }));
    fn().then((data) => alive && setSt({ data, loading: false, error: null }))
      .catch((e) => alive && setSt({ data: null, loading: false, error: e.message || 'offline' }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return st;
}
