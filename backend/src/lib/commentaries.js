// COMMENTARIES: public-domain / openly licensed commentaries served by the Free Use Bible API
// (https://bible.helloao.org/api/available_commentaries.json, checked November 2026) with a server-side cache.
// books: null = all 66 books; otherwise the USFM ids the commentary covers (so the app only offers it where it has notes).
// licence: as stated by the source (helloao licenseUrl / CrossWire module "Distribution License"); see
// scratch/licensing-list.md for the full table.
const NT = ['MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHP', 'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN', '3JN', 'JUD', 'REV'];
const OT_ALL = ['GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO', 'OBD', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL'];
const GOSPELS = ['MAT', 'MRK', 'LUK', 'JHN'];
const without = (list, drop) => list.filter((b) => !drop.includes(b));
const PD = 'Public domain';

export const COMMENTARY_SOURCES = [
  { id: 'matthew-henry', name: 'Matthew Henry’s Commentary', author: 'Matthew Henry', short: 'Henry', year: 1706, about: 'Devotional & practical', licence: PD, tradition: 'Protestant', books: without([...OT_ALL, ...NT], ['SNG']) },
  { id: 'jamieson-fausset-brown', name: 'Jamieson-Fausset-Brown Commentary', author: 'Robert Jamieson, A. R. Fausset & David Brown', short: 'JFB', year: 1871, about: 'Verse-by-verse, concise', licence: PD, tradition: 'Protestant', books: null },
  { id: 'adam-clarke', name: 'Adam Clarke’s Commentary', author: 'Adam Clarke', short: 'Clarke', year: 1831, about: 'Historical & linguistic', licence: PD, tradition: 'Methodist', books: null },
  { id: 'john-gill', name: 'John Gill’s Exposition', author: 'John Gill', short: 'Gill', year: 1763, about: 'Expository, Hebrew & rabbinic background', licence: PD, tradition: 'Baptist', books: null },
  { id: 'barnes', name: 'Barnes’ Notes on the New Testament', author: 'Albert Barnes', short: 'Barnes', year: 1834, about: 'Clear, practical notes', licence: PD, tradition: 'Presbyterian', books: NT },
  { id: 'keil-delitzsch', name: 'Keil & Delitzsch Old Testament Commentary', author: 'C. F. Keil & Franz Delitzsch', short: 'K&D', year: 1866, about: 'Old Testament scholarship', licence: PD, tradition: 'Lutheran', books: OT_ALL },
  { id: 'john-calvin', name: 'Calvin’s Commentaries', author: 'John Calvin', short: 'Calvin', year: 1550, about: 'Reformation commentaries', licence: PD, tradition: 'Reformed', books: ['GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'PSA', 'ISA', 'JER', 'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO', 'OBD', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL', ...without(NT, ['2JN', '3JN', 'REV'])] },
  { id: 'tyndale', name: 'Tyndale Open Study Notes', author: 'Tyndale House Publishers', short: 'Tyndale', year: 2017, about: 'Modern study notes', licence: 'CC BY-SA 4.0 (Tyndale House)', tradition: 'Evangelical', books: without([...OT_ALL, ...NT], ['JDG']) },
  { id: 'catena', name: 'Catena Aurea', author: 'Thomas Aquinas (compiling the Church Fathers)', short: 'Aquinas', year: 1264, about: 'The Fathers on the Gospels', licence: PD, tradition: 'Catholic', books: GOSPELS },
  { id: 'geneva', name: 'Geneva Bible Notes', author: 'Geneva Bible translators', short: 'Geneva', year: 1599, about: 'Reformation study notes', licence: 'Public domain (1599 text)', tradition: 'Reformed', books: without([...OT_ALL, ...NT], ['JDG', 'JON', 'PHM']) },
  { id: 'pnt', name: 'The People’s New Testament', author: 'B. W. Johnson', short: 'PNT', year: 1891, about: 'Plain notes for every reader', licence: PD, tradition: 'Restoration', books: without(NT, ['PHM']) },
  { id: 'tfg', name: 'The Fourfold Gospel', author: 'J. W. McGarvey & P. Y. Pendleton', short: 'Fourfold', year: 1914, about: 'Harmony of the Gospels and Acts', licence: PD, tradition: 'Restoration', books: [...GOSPELS, 'ACT', '1CO'] },
  { id: 'burkitt', name: 'Burkitt’s Expository Notes', author: 'William Burkitt', short: 'Burkitt', year: 1700, about: 'Practical New Testament notes', licence: PD, tradition: 'Anglican', books: NT },
  { id: 'abbott', name: 'Illustrated New Testament', author: 'Lyman Abbott', short: 'Abbott', year: 1878, about: 'Explanatory notes', licence: PD, tradition: 'Congregationalist', books: NT },
  { id: 'scofield', name: 'Scofield Reference Notes (1917)', author: 'C. I. Scofield', short: 'Scofield', year: 1917, about: 'Reference notes', licence: PD, tradition: 'Dispensational', books: null },
  { id: 'luther', name: 'Luther’s Commentary (selected passages)', author: 'Martin Luther', short: 'Luther', year: 1535, about: 'Selected passages', licence: PD, tradition: 'Lutheran', books: ['GEN', 'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO', 'OBD', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL', ...without(NT, ['2JN', '3JN'])] },
  { id: 'lightfoot', name: 'Lightfoot’s Commentary from the Talmud and Hebraica', author: 'John Lightfoot', short: 'Lightfoot', year: 1658, about: 'Jewish background to the Gospels', licence: PD, tradition: 'Puritan', books: GOSPELS },
];

export const SOURCE_BY_ID = Object.fromEntries(COMMENTARY_SOURCES.map((s) => [s.id, s]));
export const covers = (src, bookId) => !src.books || src.books.includes(bookId);

const BIBLE_API = 'https://bible.helloao.org/api';
const fetcher = (env) => (env && env.__fetch) || fetch;
const apiBook = (b) => (b === 'OBD' ? 'OBA' : b);

const strip = (s) => String(s || '').replace(/\r/g, '').replace(/<[^>]+>/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
function flat(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return (content && (content.text || (content.content && flat(content.content)))) || '';
  return content.map((c) => (typeof c === 'string' ? c : c && c.noteId === undefined ? (c.text || (c.content ? flat(c.content) : '')) : ' ')).join('');
}

/** → [{ verse: number|null, text }] (verse null = chapter introduction), or null when the source has nothing. */
export async function fetchCommentaryChapter(env, id, bookId, chapter) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = ctrl ? setTimeout(() => ctrl.abort(), 8000) : null;
  try {
    const r = await fetcher(env)(`${BIBLE_API}/c/${id}/${apiBook(bookId)}/${chapter}.json`, { headers: { Accept: 'application/json' }, signal: ctrl ? ctrl.signal : undefined });
    if (r.status === 404) return [];
    if (!r.ok) return null;
    const data = await r.json();
    const out = [];
    for (const c of (data && data.chapter && data.chapter.content) || []) {
      const text = strip(c.text !== undefined ? c.text : flat(c.content));
      if (text) out.push({ verse: c.type === 'verse' ? c.number : null, text });
    }
    return out;
  } catch (e) { return null; } finally { if (t) clearTimeout(t); }
}
