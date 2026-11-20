// EXEGESIS: one-tap structured exegesis of a verse range with Cloudflare Workers AI (binding `AI`).
//
// The app asks for the 11 sections in three parts (a, b, c) at once, so each part can appear as soon as its
// model call finishes (React Native's fetch can't read a streamed body). Every part is cached per
// book + chapter + verse range + translation in `exegesis_cache`, so a repeat request is a single DB read.
//
// Inputs to the fixed prompt: the selected verse text (in the reader's translation), the surrounding passage,
// book/author metadata (below) and original-language data — Strong's-tagged KJV + the public-domain
// Thayer / Brown-Driver-Briggs lexicon from bolls.life (the same open source the app's lexicon uses).
import { normaliseRef } from './scripture.js';

export const EXEGESIS_MODEL_DEFAULT = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
// Tried in order if the configured model is retired, unknown or failing.
const MODEL_FALLBACKS = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-70b-instruct', '@cf/meta/llama-3.1-8b-instruct-fp8'];
export const EXEGESIS_LABEL = 'AI-generated — compare with the commentaries';
export const NOT_CONFIGURED_MSG = 'Exegesis isn’t set up on this server yet (Workers AI binding "AI" is missing).';
export const BUSY_MSG = 'Exegesis is busy right now — please try again in a few minutes.';
export const PARTS = ['a', 'b', 'c'];

export const isQuotaError = (e) => /\b(3036|3040|429)\b|quota|rate.?limit|daily free allocation|neurons|capacity|too many requests/i.test(String((e && (e.message || e)) || ''));

// ---------- book metadata (traditional authorship noted as such; dates are approximate) ----------
// [id, name, chapters, testament, author, date, genre]
const B = [
  ['GEN', 'Genesis', 50, 'OT', 'Moses (traditional)', 'c. 1440–1400 BC (traditional)', 'Narrative / Torah'],
  ['EXO', 'Exodus', 40, 'OT', 'Moses (traditional)', 'c. 1440–1400 BC (traditional)', 'Narrative / Law'],
  ['LEV', 'Leviticus', 27, 'OT', 'Moses (traditional)', 'c. 1440–1400 BC (traditional)', 'Law'],
  ['NUM', 'Numbers', 36, 'OT', 'Moses (traditional)', 'c. 1440–1400 BC (traditional)', 'Narrative / Law'],
  ['DEU', 'Deuteronomy', 34, 'OT', 'Moses (traditional)', 'c. 1400 BC (traditional)', 'Law / Covenant sermon'],
  ['JOS', 'Joshua', 24, 'OT', 'Joshua (traditional)', 'c. 1400–1370 BC', 'Historical narrative'],
  ['JDG', 'Judges', 21, 'OT', 'Unknown (traditionally Samuel)', 'c. 1050–1000 BC', 'Historical narrative'],
  ['RUT', 'Ruth', 4, 'OT', 'Unknown (traditionally Samuel)', 'c. 1000 BC', 'Narrative'],
  ['1SA', '1 Samuel', 31, 'OT', 'Unknown (Samuel, Nathan, Gad)', 'c. 930 BC', 'Historical narrative'],
  ['2SA', '2 Samuel', 24, 'OT', 'Unknown (Nathan, Gad)', 'c. 930 BC', 'Historical narrative'],
  ['1KI', '1 Kings', 22, 'OT', 'Unknown (traditionally Jeremiah)', 'c. 560–540 BC', 'Historical narrative'],
  ['2KI', '2 Kings', 25, 'OT', 'Unknown (traditionally Jeremiah)', 'c. 560–540 BC', 'Historical narrative'],
  ['1CH', '1 Chronicles', 29, 'OT', 'The Chronicler (traditionally Ezra)', 'c. 450–400 BC', 'Historical narrative'],
  ['2CH', '2 Chronicles', 36, 'OT', 'The Chronicler (traditionally Ezra)', 'c. 450–400 BC', 'Historical narrative'],
  ['EZR', 'Ezra', 10, 'OT', 'Ezra', 'c. 440 BC', 'Historical narrative'],
  ['NEH', 'Nehemiah', 13, 'OT', 'Nehemiah', 'c. 430 BC', 'Historical narrative / Memoir'],
  ['EST', 'Esther', 10, 'OT', 'Unknown', 'c. 460–350 BC', 'Narrative'],
  ['JOB', 'Job', 42, 'OT', 'Unknown', 'Uncertain (setting patriarchal)', 'Wisdom / Poetry'],
  ['PSA', 'Psalms', 150, 'OT', 'David, Asaph, the sons of Korah, Solomon, Moses and others', 'c. 1440–450 BC', 'Poetry / Worship'],
  ['PRO', 'Proverbs', 31, 'OT', 'Solomon, Agur, Lemuel and others', 'c. 970–700 BC', 'Wisdom'],
  ['ECC', 'Ecclesiastes', 12, 'OT', 'The Preacher (traditionally Solomon)', 'c. 935 BC (traditional)', 'Wisdom'],
  ['SNG', 'Song of Solomon', 8, 'OT', 'Solomon (traditional)', 'c. 960 BC (traditional)', 'Poetry'],
  ['ISA', 'Isaiah', 66, 'OT', 'Isaiah son of Amoz', 'c. 740–680 BC', 'Prophecy'],
  ['JER', 'Jeremiah', 52, 'OT', 'Jeremiah (with Baruch)', 'c. 627–580 BC', 'Prophecy'],
  ['LAM', 'Lamentations', 5, 'OT', 'Jeremiah (traditional)', 'c. 586 BC', 'Poetry / Lament'],
  ['EZK', 'Ezekiel', 48, 'OT', 'Ezekiel', 'c. 593–570 BC', 'Prophecy / Apocalyptic'],
  ['DAN', 'Daniel', 12, 'OT', 'Daniel', 'c. 530 BC (traditional)', 'Narrative / Apocalyptic'],
  ['HOS', 'Hosea', 14, 'OT', 'Hosea', 'c. 755–715 BC', 'Prophecy'],
  ['JOL', 'Joel', 3, 'OT', 'Joel', 'Uncertain (9th–5th c. BC)', 'Prophecy'],
  ['AMO', 'Amos', 9, 'OT', 'Amos', 'c. 760 BC', 'Prophecy'],
  ['OBD', 'Obadiah', 1, 'OT', 'Obadiah', 'c. 586 BC', 'Prophecy'],
  ['JON', 'Jonah', 4, 'OT', 'Unknown (about Jonah)', 'c. 760 BC (setting)', 'Narrative / Prophecy'],
  ['MIC', 'Micah', 7, 'OT', 'Micah', 'c. 735–700 BC', 'Prophecy'],
  ['NAM', 'Nahum', 3, 'OT', 'Nahum', 'c. 663–612 BC', 'Prophecy'],
  ['HAB', 'Habakkuk', 3, 'OT', 'Habakkuk', 'c. 605 BC', 'Prophecy'],
  ['ZEP', 'Zephaniah', 3, 'OT', 'Zephaniah', 'c. 630 BC', 'Prophecy'],
  ['HAG', 'Haggai', 2, 'OT', 'Haggai', '520 BC', 'Prophecy'],
  ['ZEC', 'Zechariah', 14, 'OT', 'Zechariah', 'c. 520–480 BC', 'Prophecy / Apocalyptic'],
  ['MAL', 'Malachi', 4, 'OT', 'Malachi', 'c. 430 BC', 'Prophecy'],
  ['MAT', 'Matthew', 28, 'NT', 'Matthew (Levi) the apostle (traditional)', 'c. AD 50–70', 'Gospel'],
  ['MRK', 'Mark', 16, 'NT', 'John Mark (traditional)', 'c. AD 55–65', 'Gospel'],
  ['LUK', 'Luke', 24, 'NT', 'Luke the physician', 'c. AD 60–62', 'Gospel'],
  ['JHN', 'John', 21, 'NT', 'John the apostle (traditional)', 'c. AD 85–95', 'Gospel'],
  ['ACT', 'Acts', 28, 'NT', 'Luke', 'c. AD 62', 'Historical narrative'],
  ['ROM', 'Romans', 16, 'NT', 'Paul', 'c. AD 57', 'Epistle'],
  ['1CO', '1 Corinthians', 16, 'NT', 'Paul', 'c. AD 55', 'Epistle'],
  ['2CO', '2 Corinthians', 13, 'NT', 'Paul', 'c. AD 56', 'Epistle'],
  ['GAL', 'Galatians', 6, 'NT', 'Paul', 'c. AD 48–55', 'Epistle'],
  ['EPH', 'Ephesians', 6, 'NT', 'Paul', 'c. AD 60–62', 'Epistle (prison letter)'],
  ['PHP', 'Philippians', 4, 'NT', 'Paul', 'c. AD 61–62', 'Epistle (prison letter)'],
  ['COL', 'Colossians', 4, 'NT', 'Paul', 'c. AD 60–62', 'Epistle (prison letter)'],
  ['1TH', '1 Thessalonians', 5, 'NT', 'Paul', 'c. AD 50–51', 'Epistle'],
  ['2TH', '2 Thessalonians', 3, 'NT', 'Paul', 'c. AD 51–52', 'Epistle'],
  ['1TI', '1 Timothy', 6, 'NT', 'Paul', 'c. AD 62–64', 'Pastoral epistle'],
  ['2TI', '2 Timothy', 4, 'NT', 'Paul', 'c. AD 66–67', 'Pastoral epistle'],
  ['TIT', 'Titus', 3, 'NT', 'Paul', 'c. AD 63–65', 'Pastoral epistle'],
  ['PHM', 'Philemon', 1, 'NT', 'Paul', 'c. AD 60–62', 'Epistle (personal letter)'],
  ['HEB', 'Hebrews', 13, 'NT', 'Unknown', 'c. AD 60–69', 'Epistle / Sermon'],
  ['JAS', 'James', 5, 'NT', 'James, the Lord’s brother', 'c. AD 45–49', 'Epistle / Wisdom'],
  ['1PE', '1 Peter', 5, 'NT', 'Peter the apostle', 'c. AD 62–64', 'Epistle'],
  ['2PE', '2 Peter', 3, 'NT', 'Peter the apostle', 'c. AD 64–67', 'Epistle'],
  ['1JN', '1 John', 5, 'NT', 'John the apostle (traditional)', 'c. AD 85–95', 'Epistle'],
  ['2JN', '2 John', 1, 'NT', 'John “the elder”', 'c. AD 85–95', 'Epistle'],
  ['3JN', '3 John', 1, 'NT', 'John “the elder”', 'c. AD 85–95', 'Epistle'],
  ['JUD', 'Jude', 1, 'NT', 'Jude, brother of James', 'c. AD 65–80', 'Epistle'],
  ['REV', 'Revelation', 22, 'NT', 'John', 'c. AD 95', 'Apocalyptic / Prophecy'],
];
export const BOOK_META = Object.fromEntries(B.map(([id, name, chapters, testament, author, date, genre], i) => [id, { id, num: i + 1, name, chapters, testament, author, date, genre }]));

export function refLabel(bookId, chapter, vs, ve) {
  const b = BOOK_META[bookId];
  const name = bookId === 'PSA' ? 'Psalm' : b ? b.name : bookId;
  return `${name} ${chapter}:${vs}${ve && ve > vs ? `-${ve}` : ''}`;
}

export const cacheKey = (r) => `${r.bookId}.${r.chapter}.${r.verseStart}-${r.verseEnd}.${r.translation.toUpperCase()}${r.stub ? '.stub' : ''}`;

// ---------- original-language data (bolls.life: Strong's-tagged KJV + BDB/Thayer lexicon) ----------
const LEXICON_API = 'https://bolls.life';
const fetcher = (env) => (env && env.__fetch) || fetch;
const STOP = new Set('a an and are as at be but by for from had has have he her him his i in into is it its me my not of on or our shall she so that the their them then there these they this thou thee thy to unto was we were which who whom will with ye you your yea also all upon hath doth did do came come said saith say went'.split(' '));

async function getJson(env, url, ms) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
  try {
    const r = await fetcher(env)(url, { headers: { Accept: 'application/json' }, signal: ctrl ? ctrl.signal : undefined });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; } finally { if (t) clearTimeout(t); }
}

const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** Up to `max` key words of the range with Strong's numbers and lexicon glosses. Never throws; [] on failure. */
export async function lookupOriginalLanguage(env, r, max = 6) {
  const meta = BOOK_META[r.bookId];
  if (!meta) return [];
  const prefix = meta.testament === 'OT' ? 'H' : 'G';
  const chapter = await getJson(env, `${LEXICON_API}/get-chapter/KJV/${meta.num}/${r.chapter}/`, 3500);
  if (!Array.isArray(chapter)) return [];
  const picks = [];
  const seen = new Set();
  for (const v of chapter) {
    if (!v || v.verse < r.verseStart || v.verse > r.verseEnd) continue;
    const txt = String(v.text || '').replace(/<(?!\/?S>)[^>]+>/g, '');
    const re = /([^<]*?)((?:<S>\d+<\/S>\s*)+)/g;
    let m;
    while ((m = re.exec(txt))) {
      const english = m[1].replace(/[^A-Za-z' -]/g, ' ').trim().split(/\s+/).slice(-2).join(' ');
      const num = (m[2].match(/\d+/) || [])[0];
      const last = english.split(' ').pop().toLowerCase();
      if (!num || !english || STOP.has(last) || last.length < 3) continue;
      const code = prefix + Number(num);
      if (seen.has(code)) continue;
      seen.add(code);
      picks.push({ english, strong: code });
    }
  }
  // longer English words first (content words), then keep verse order among the chosen ones
  const chosen = [...picks].sort((a, b) => b.english.length - a.english.length).slice(0, max);
  const order = new Map(picks.map((p, i) => [p.strong, i]));
  chosen.sort((a, b) => order.get(a.strong) - order.get(b.strong));
  const defs = await Promise.all(chosen.map((p) => getJson(env, `${LEXICON_API}/dictionary-definition/BDBT/${p.strong}/`, 3500)));
  return chosen.map((p, i) => {
    const arr = Array.isArray(defs[i]) ? defs[i] : [];
    const e = arr.find((x) => x && x.topic === p.strong) || arr[0] || {};
    return {
      english: p.english,
      strong: p.strong,
      lemma: e.lexeme || '',
      translit: e.transliteration || '',
      gloss: String(e.short_definition || '').slice(0, 160),
      definition: stripHtml(e.definition).slice(0, 400),
    };
  });
}

// ---------- prompt ----------
const SYSTEM = 'You are a careful, scholarly Bible exegete writing for preachers, teachers and serious students. '
  + 'Write in clear English. Ground every claim in the text, its historical setting and the original languages; '
  + 'where Christian traditions differ, say so briefly and fairly. Never invent Bible references, quotations or Strong’s numbers. '
  + 'Do not ask the reader questions. Reply with ONE JSON object and nothing else.';

const SHAPES = {
  a: '{"historical": string (2 paragraphs: author, date, original audience, situation and events behind the passage), '
    + '"cultural": string (1-2 paragraphs: customs, social, religious and geographical background that illuminate the passage), '
    + '"literary": string (1-2 paragraphs: genre, the book’s structure and where this passage sits, how the surrounding verses frame it), '
    + '"originalLanguage": [ {"english": string, "original": string (Hebrew/Greek word), "translit": string, "strong": string (e.g. "G26"), "meaning": string (1-2 sentences)} ] (3-6 key words)}',
  b: '{"keyTerms": [ {"term": string (a word or phrase from the passage), "meaning": string (1-3 sentences)} ] (3-6 items), '
    + '"interpretation": string (2-3 paragraphs: a clause-by-clause explanation of what the passage says), '
    + '"theology": string (1-2 paragraphs: what it teaches about God, Christ, salvation, the church, etc.), '
    + '"authorIntent": string (1 paragraph: what the human author meant his first readers to understand and do)}',
  c: '{"crossReferences": [ {"ref": string (a real Bible reference like "Romans 5:8"), "note": string (one sentence on how it relates)} ] (5-8 items), '
    + '"application": {"preaching": string[] (2-3 sermon angles or outline points), "teaching": string[] (2-3 points for a Bible study or class), "personal": string[] (2-3 points for personal reflection and obedience)}}',
};

export function buildPrompt(r, part, lexicon) {
  const meta = BOOK_META[r.bookId] || {};
  const lines = [
    `Passage: ${refLabel(r.bookId, r.chapter, r.verseStart, r.verseEnd)} (${r.translation})`,
    `Text: """${r.text}"""`,
  ];
  if (r.context) lines.push(`Surrounding passage (${refLabel(r.bookId, r.chapter, r.contextStart || 1, r.contextEnd || r.verseEnd)}): """${r.context}"""`);
  lines.push(`Book: ${meta.name} — ${meta.testament === 'OT' ? 'Old' : 'New'} Testament, ${meta.genre}. Author: ${meta.author}. Date: ${meta.date}.`);
  if (part === 'a' || part === 'b') {
    if (lexicon && lexicon.length) {
      lines.push(`Original-language data (Strong’s-tagged KJV with the Brown-Driver-Briggs / Thayer lexicon):\n${lexicon.map((w) => `- "${w.english}" → ${w.strong} ${w.lemma}${w.translit ? ` (${w.translit})` : ''}: ${w.gloss}${w.definition ? ` — ${w.definition.slice(0, 220)}` : ''}`).join('\n')}`);
    } else {
      lines.push(`Original language: ${meta.testament === 'OT' ? 'Hebrew (Aramaic in parts of Daniel and Ezra)' : 'Koine Greek'}. Only give Strong’s numbers you are sure of.`);
    }
  }
  const which = { a: 'sections 2-5 (historical background, cultural background, literary context, original language)', b: 'sections 6-9 (meaning of important words and phrases, interpretation, theological significance, the author’s intended meaning)', c: 'sections 10-11 (relationship to other scriptures, practical application)' }[part];
  lines.push(`\nWrite ${which} of a full exegesis of this passage. Return JSON with exactly this shape:\n${SHAPES[part]}`);
  return lines.join('\n');
}

// ---------- model call ----------
function replyText(out) {
  // Workers AI replies as { response } (string, or an object in JSON mode) or OpenAI-style { choices: [{ message: { content } }] }
  const choice = out && Array.isArray(out.choices) && out.choices[0] && out.choices[0].message ? out.choices[0].message.content : undefined;
  const r = out && (out.response !== undefined ? out.response : out.result && out.result.response !== undefined ? out.result.response : choice);
  return r;
}

export function parseJsonLoose(text) {
  if (!text) return null;
  if (typeof text === 'object') return text;
  const s = String(text).replace(/```(?:json)?/gi, '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch (e) {
    try { return JSON.parse(s.slice(a, b + 1).replace(/,\s*([}\]])/g, '$1')); } catch (e2) { return null; }
  }
}

async function runModel(env, prompt, maxTokens) {
  const input = { messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }], max_tokens: maxTokens, temperature: 0.3 };
  const models = [...new Set([env.EXEGESIS_MODEL || EXEGESIS_MODEL_DEFAULT, ...MODEL_FALLBACKS])];
  let lastErr;
  for (const model of models) {
    try {
      const out = await env.AI.run(model, input);
      const parsed = parseJsonLoose(replyText(out));
      if (parsed) return { parsed, model };
      lastErr = new Error('Model reply was not JSON');
    } catch (e) {
      if (isQuotaError(e)) throw e;
      lastErr = e;
      console.warn('exegesis model failed, trying next', model, e && e.message);
    }
  }
  throw lastErr || new Error('No exegesis model answered');
}

// ---------- cleaning ----------
const txt = (v, n = 4000) => (typeof v === 'string' ? v.trim().slice(0, n) : Array.isArray(v) ? v.filter((x) => typeof x === 'string').join('\n\n').trim().slice(0, n) : '');
const list = (v, n, map) => (Array.isArray(v) ? v : []).map(map).filter(Boolean).slice(0, n);
const strs = (v, n) => list(v, n, (x) => (typeof x === 'string' ? x.trim().slice(0, 500) : x && typeof x.text === 'string' ? x.text.trim().slice(0, 500) : '')).filter(Boolean);
const STRONG_RE = /^[GH]\d{1,4}$/;

export function cleanPart(part, raw, lexicon) {
  const o = raw || {};
  if (part === 'a') {
    let words = list(o.originalLanguage || o.original_language || o.words, 8, (w) => {
      if (!w || typeof w !== 'object') return null;
      const strong = String(w.strong || w.strongs || '').toUpperCase().replace(/\s/g, '');
      return { english: txt(w.english, 80), original: txt(w.original || w.lemma, 80), translit: txt(w.translit || w.transliteration, 80), strong: STRONG_RE.test(strong) ? strong : '', meaning: txt(w.meaning || w.definition, 600) };
    }).filter((w) => w.english || w.original);
    // fill lexicon facts (lemma / transliteration) from the dataset when the model left them out
    const byStrong = new Map((lexicon || []).map((l) => [l.strong, l]));
    words = words.map((w) => { const l = byStrong.get(w.strong); return l ? { ...w, original: w.original || l.lemma, translit: w.translit || l.translit } : w; });
    if (!words.length && lexicon && lexicon.length) words = lexicon.map((l) => ({ english: l.english, original: l.lemma, translit: l.translit, strong: l.strong, meaning: l.gloss }));
    return { historical: txt(o.historical || o.historicalBackground), cultural: txt(o.cultural || o.culturalBackground), literary: txt(o.literary || o.literaryContext), originalLanguage: words };
  }
  if (part === 'b') {
    return {
      keyTerms: list(o.keyTerms || o.key_terms || o.words, 8, (k) => (k && typeof k === 'object' && (k.term || k.word) ? { term: txt(k.term || k.word, 120), meaning: txt(k.meaning || k.explanation, 700) } : null)),
      interpretation: txt(o.interpretation, 6000),
      theology: txt(o.theology || o.theologicalSignificance),
      authorIntent: txt(o.authorIntent || o.author_intent || o.intendedMeaning),
    };
  }
  const refs = [];
  const seen = new Set();
  for (const x of Array.isArray(o.crossReferences || o.cross_references) ? (o.crossReferences || o.cross_references) : []) {
    const raw = typeof x === 'string' ? x : x && x.ref;
    const n = normaliseRef(raw);
    if (!n || seen.has(n.label)) continue;
    seen.add(n.label);
    refs.push({ ref: n.ref, label: n.label, note: txt(x && x.note, 400) });
    if (refs.length >= 10) break;
  }
  const app = o.application && typeof o.application === 'object' && !Array.isArray(o.application) ? o.application : {};
  return {
    crossReferences: refs,
    application: { preaching: strs(app.preaching, 5), teaching: strs(app.teaching, 5), personal: strs(app.personal || app.personalStudy, 5) },
  };
}

// ---------- dev stub (AUTH_DEV_MODE only, never with a real AI binding) ----------
export function stubPart(part, r) {
  const ref = refLabel(r.bookId, r.chapter, r.verseStart, r.verseEnd);
  if (part === 'a') return {
    historical: `[Dev stub] Historical background for ${ref}. This placeholder shows where the author, date, audience and situation will be described once Workers AI is connected.`,
    cultural: '[Dev stub] Customs, social and religious setting of the first readers.',
    literary: '[Dev stub] Genre, structure of the book and how the surrounding verses frame this passage.',
    originalLanguage: [{ english: 'love', original: 'ἀγαπάω', translit: 'agapaō', strong: 'G25', meaning: 'To love, to have a preference for, to wish well to.' }, { english: 'good', original: 'ἀγαθός', translit: 'agathos', strong: 'G18', meaning: 'Good, beneficial, of good constitution or nature.' }],
  };
  if (part === 'b') return {
    keyTerms: [{ term: 'all things', meaning: '[Dev stub] Explanation of an important phrase.' }],
    interpretation: '[Dev stub] Clause-by-clause interpretation of the passage.',
    theology: '[Dev stub] What the passage teaches about God and salvation.',
    authorIntent: '[Dev stub] What the author meant his first readers to understand.',
  };
  return {
    crossReferences: [{ ref: 'GEN 50:20', label: 'Genesis 50:20', note: '[Dev stub] God works evil intentions for good.' }, { ref: 'EPH 1:11', label: 'Ephesians 1:11', note: '[Dev stub] He works all things after the counsel of his will.' }],
    application: { preaching: ['[Dev stub] Sermon angle'], teaching: ['[Dev stub] Study point'], personal: ['[Dev stub] Reflection'] },
  };
}

/** Generate one part with the model (or the dev stub). */
export async function generatePart(env, r, part, { stub = false } = {}) {
  if (stub) return { part, sections: stubPart(part, r), model: 'dev-stub' };
  const lexicon = part === 'a' || part === 'b' ? await lookupOriginalLanguage(env, r).catch(() => []) : [];
  const { parsed, model } = await runModel(env, buildPrompt(r, part, lexicon), part === 'b' ? 1600 : 1300);
  return { part, sections: cleanPart(part, parsed, lexicon), model };
}

export const SECTION_ORDER = [
  ['passage', 'Passage'],
  ['historical', 'Historical background'],
  ['cultural', 'Cultural background'],
  ['literary', 'Literary context'],
  ['originalLanguage', 'Original language'],
  ['keyTerms', 'Meaning of important words and phrases'],
  ['interpretation', 'Interpretation of the passage'],
  ['theology', 'Theological significance'],
  ['authorIntent', 'The author’s intended meaning'],
  ['crossReferences', 'Relationship to other scriptures'],
  ['application', 'Practical application'],
];
