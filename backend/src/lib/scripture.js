// Finds Bible references in free text ("John 3:16", "Romans chapter 8 verse 28", "1 Cor 13:4-7", "Psalm 23")
// and normalises them to the app's USFM ids: { ref: 'JHN 3:16', label: 'John 3:16' } (the app opens them
// with parseRef() from src/data/bible.js).
const BOOKS = [
  ['GEN', 'Genesis', 50, ['gen']], ['EXO', 'Exodus', 40, ['exod', 'ex']], ['LEV', 'Leviticus', 27, ['lev']],
  ['NUM', 'Numbers', 36, ['num']], ['DEU', 'Deuteronomy', 34, ['deut']], ['JOS', 'Joshua', 24, ['josh']],
  ['JDG', 'Judges', 21, ['judg']], ['RUT', 'Ruth', 4, []], ['1SA', '1 Samuel', 31, ['1 sam']], ['2SA', '2 Samuel', 24, ['2 sam']],
  ['1KI', '1 Kings', 22, ['1 kgs']], ['2KI', '2 Kings', 25, ['2 kgs']], ['1CH', '1 Chronicles', 29, ['1 chron', '1 chr']],
  ['2CH', '2 Chronicles', 36, ['2 chron', '2 chr']], ['EZR', 'Ezra', 10, []], ['NEH', 'Nehemiah', 13, ['neh']],
  ['EST', 'Esther', 10, ['esth']], ['JOB', 'Job', 42, []], ['PSA', 'Psalms', 150, ['psalm', 'ps', 'psa']],
  ['PRO', 'Proverbs', 31, ['prov', 'proverb']], ['ECC', 'Ecclesiastes', 12, ['eccl', 'eccles']],
  ['SNG', 'Song of Solomon', 8, ['song of songs', 'songs']], ['ISA', 'Isaiah', 66, ['isa']], ['JER', 'Jeremiah', 52, ['jer']],
  ['LAM', 'Lamentations', 5, ['lam']], ['EZK', 'Ezekiel', 48, ['ezek']], ['DAN', 'Daniel', 12, ['dan']], ['HOS', 'Hosea', 14, []],
  ['JOL', 'Joel', 3, []], ['AMO', 'Amos', 9, []], ['OBD', 'Obadiah', 1, ['obad']], ['JON', 'Jonah', 4, []], ['MIC', 'Micah', 7, []],
  ['NAM', 'Nahum', 3, []], ['HAB', 'Habakkuk', 3, ['hab']], ['ZEP', 'Zephaniah', 3, ['zeph']], ['HAG', 'Haggai', 2, []],
  ['ZEC', 'Zechariah', 14, ['zech']], ['MAL', 'Malachi', 4, ['mal']], ['MAT', 'Matthew', 28, ['matt', 'mt']],
  ['MRK', 'Mark', 16, ['mk']], ['LUK', 'Luke', 24, ['lk']], ['JHN', 'John', 21, ['jn']], ['ACT', 'Acts', 28, ['acts of the apostles']],
  ['ROM', 'Romans', 16, ['rom']], ['1CO', '1 Corinthians', 16, ['1 cor']], ['2CO', '2 Corinthians', 13, ['2 cor']],
  ['GAL', 'Galatians', 6, ['gal']], ['EPH', 'Ephesians', 6, ['eph']], ['PHP', 'Philippians', 4, ['phil']],
  ['COL', 'Colossians', 4, ['col']], ['1TH', '1 Thessalonians', 5, ['1 thess']], ['2TH', '2 Thessalonians', 3, ['2 thess']],
  ['1TI', '1 Timothy', 6, ['1 tim']], ['2TI', '2 Timothy', 4, ['2 tim']], ['TIT', 'Titus', 3, []], ['PHM', 'Philemon', 1, ['philem']],
  ['HEB', 'Hebrews', 13, ['heb']], ['JAS', 'James', 5, ['jas']], ['1PE', '1 Peter', 5, ['1 pet']], ['2PE', '2 Peter', 3, ['2 pet']],
  ['1JN', '1 John', 5, []], ['2JN', '2 John', 1, []], ['3JN', '3 John', 1, []], ['JUD', 'Jude', 1, []], ['REV', 'Revelation', 22, ['revelations', 'rev']],
];

const ORDINALS = { first: '1', second: '2', third: '3', i: '1', ii: '2', iii: '3' };
const SMALL = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

// name variant (lower case) → book
const NAME_MAP = new Map();
for (const [id, name, chapters, alts] of BOOKS) {
  const book = { id, name, chapters };
  const variants = [name, ...alts];
  for (const v of variants) {
    const low = v.toLowerCase();
    NAME_MAP.set(low, book);
    const m = /^([123]) (.+)$/.exec(low);
    if (m) {
      const word = { 1: ['first', 'i'], 2: ['second', 'ii'], 3: ['third', 'iii'] }[m[1]];
      for (const w of word) NAME_MAP.set(`${w} ${m[2]}`, book);
      NAME_MAP.set(`${m[1]}${m[2]}`, book);
    }
  }
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NAMES_RE = [...NAME_MAP.keys()].sort((a, b) => b.length - a.length).map((n) => esc(n).replace(/ /g, '\\s+')).join('|');
const NUM = '(?:\\d{1,3}|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[\\s-](?:one|two|three|four|five|six|seven|eight|nine))?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|(?:one|a)\\s+hundred(?:\\s+and)?(?:\\s+\\w+)?)';
// <book> [chapter] N [(:|verse|verses|v.) N [(-|to|through) N]]
const REF_RE = new RegExp(
  `\\b(${NAMES_RE})\\.?\\s+(?:chapter\\s+)?(${NUM})(?:\\s*(?::|,?\\s*verses?|,?\\s*vv?\\.)\\s*(${NUM})(?:\\s*(?:-|–|to|through|and)\\s*(${NUM}))?)?\\b`,
  'gi',
);

function toNumber(s) {
  if (s == null) return null;
  const t = String(s).toLowerCase().trim();
  if (/^\d+$/.test(t)) return Number(t);
  const words = t.replace(/-/g, ' ').split(/\s+/).filter((w) => w !== 'and');
  let n = 0;
  for (const w of words) {
    if (w === 'hundred') n = (n || 1) * 100;
    else if (w === 'a') n += 0;
    else if (SMALL[w] != null) n += SMALL[w];
    else if (TENS[w] != null) n += TENS[w];
    else return null;
  }
  return n || null;
}

function lookupBook(raw) {
  const k = raw.toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '');
  const parts = k.split(' ');
  if (ORDINALS[parts[0]] && parts.length > 1) {
    const alt = `${ORDINALS[parts[0]]} ${parts.slice(1).join(' ')}`;
    if (NAME_MAP.has(alt)) return NAME_MAP.get(alt);
  }
  return NAME_MAP.get(k) || null;
}

/** All distinct references in `text`, in order of first mention. */
export function detectScriptures(text, limit = 30) {
  const out = [];
  const seen = new Set();
  if (!text) return out;
  REF_RE.lastIndex = 0;
  let m;
  while ((m = REF_RE.exec(String(text))) && out.length < limit) {
    const book = lookupBook(m[1]);
    if (!book) continue;
    // single-word names that are also common words ("Job", "Acts", "Mark", "Numbers") need a chapter:verse form
    const ambiguous = ['JOB', 'ACT', 'MRK', 'NUM', 'AMO', 'JUD', 'TIT', 'RUT', 'JOL'].includes(book.id) && !/[A-Z]/.test(m[1][0]);
    const ch = toNumber(m[2]);
    const v = toNumber(m[3]);
    const v2 = toNumber(m[4]);
    if (!ch || ch > book.chapters) continue;
    if (ambiguous && !v) continue;
    if (v != null && (v < 1 || v > 176)) continue;
    const ref = v ? `${book.id} ${ch}:${v}` : `${book.id} ${ch}`;
    const name = book.id === 'PSA' && !/psalms/i.test(m[1]) ? 'Psalm' : book.name;
    const label = v ? `${name} ${ch}:${v}${v2 && v2 > v && v2 - v < 60 ? `-${v2}` : ''}` : `${name} ${ch}`;
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ ref, label });
  }
  return out;
}

/** Parse one reference written by a model or a person ("1 Corinthians 13:4-7") → { ref, label } | null */
export function normaliseRef(s) {
  const r = detectScriptures(String(s || '').slice(0, 80), 1);
  return r[0] || null;
}
