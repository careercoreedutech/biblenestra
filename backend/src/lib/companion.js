// SCRIPTURE COMPANION: situation → ≥7 relevant scriptures with explanations, encouragement and a prayer.
//
// Pipeline (src/routes/companion.js calls these in three steps so the app can render progressively):
//   1. safety      detectCrisis() — instant keyword check for self-harm/suicide, abuse and danger, plus the
//                  helplines for the user's country (HELPLINES). Needs no AI, answers in milliseconds.
//   2. verses      analyse() — the model extracts themes (several allowed) + specifics + suggested references;
//                  rankCandidates() merges the curated theme index (companionIndex.js) with the suggestions,
//                  skips the user's last ~50 delivered verses and varies the choice among the top candidates;
//                  every reference is validated against the KJV verse table (verseCounts.js) and its EXACT text
//                  is pulled from the Bible data (Free Use Bible API, the same source the app reads) in the
//                  user's translation. Model-written verse text is never used; invalid references are dropped.
//   3. compose     the model writes a per-verse explanation, encouragement and a personalised prayer, in three
//                  parallel parts (x1: verses 1-4, x2: verses 5-8, p: encouragement + prayer) so the first
//                  explanations land quickly — React Native's fetch can't read a streamed body.
import { THEMES, THEME_KEYS, SITUATION_THEMES } from './companionIndex.js';
import { refExists, verseCount } from './verseCounts.js';
import { normaliseRef } from './scripture.js';
import { BOOK_META, parseJsonLoose, isQuotaError } from './exegesis.js';

export const COMPANION_MODEL_DEFAULT = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const MODEL_FALLBACKS = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-70b-instruct', '@cf/meta/llama-3.1-8b-instruct-fp8'];
export const NOT_CONFIGURED_MSG = 'Scripture Companion isn’t set up on this server yet (Workers AI binding "AI" is missing).';
export const BUSY_MSG = 'Scripture Companion is busy right now — please try again in a few minutes.';
export const TARGET_VERSES = 8;
export const MIN_VERSES = 7;
export const RECENT_LIMIT = 50;
export const COMPOSE_PARTS = ['x1', 'x2', 'p'];
export { isQuotaError };

const BIBLE_API = 'https://bible.helloao.org/api';
const fetcher = (env) => (env && env.__fetch) || fetch;

// ---------- 1. safety ----------
// Phrases are matched on a lower-cased, apostrophe-normalised copy of the message.
const CRISIS_SIGNALS = {
  selfHarm: ['suicid', 'kill myself', 'killing myself', 'end my life', 'ending my life', 'end it all', 'take my own life', 'take my life', 'want to die', 'wanna die', 'wish i was dead', 'wish i were dead', 'better off dead', 'better off without me', 'no reason to live', 'not worth living', 'self-harm', 'self harm', 'hurt myself', 'harm myself', 'cut myself', 'cutting myself', 'overdose', 'jump off', 'hang myself', 'don\'t want to live', 'do not want to live', 'don\'t want to be alive'],
  abuse: ['abuse', 'abused', 'abusing', 'abusive', 'beats me', 'beat me', 'hits me', 'hit me', 'slaps me', 'molest', 'raped', 'rape me', 'sexually assault', 'touches me', 'forced me', 'domestic violence', 'trafficked', 'trafficking'],
  danger: ['in danger', 'going to kill me', 'threatening to kill', 'threatened to kill', 'wants to kill me', 'not safe at home', 'unsafe at home', 'kidnap', 'has a gun', 'has a knife', 'emergency', 'being followed', 'stalking me', 'kill him', 'kill her', 'hurt someone'],
};

/** → { selfHarm, abuse, danger, any } */
export function detectCrisis(message) {
  const t = ` ${String(message || '').toLowerCase().replace(/[’‘]/g, '\'').replace(/\s+/g, ' ')} `;
  const hit = (list) => list.some((p) => t.includes(p));
  const out = { selfHarm: hit(CRISIS_SIGNALS.selfHarm), abuse: hit(CRISIS_SIGNALS.abuse), danger: hit(CRISIS_SIGNALS.danger) };
  out.any = out.selfHarm || out.abuse || out.danger;
  return out;
}

// Helplines (checked against findahelpline.com and the services' own sites, November 2026 — re-check before
// each release). kind: emergency | crisis | abuse | children.
export const HELPLINES = {
  NG: { country: 'Nigeria', emergency: '112', lines: [
    { name: 'SURPIN (Suicide Research & Prevention Initiative)', phone: '0800 078 7746', kind: 'crisis' },
    { name: 'Mentally Aware Nigeria Initiative (MANI)', phone: '0809 111 6264', kind: 'crisis' },
    { name: 'Women Safe House 24-hour crisis line', phone: '+234 812 113 3399', kind: 'abuse' },
    { name: 'WARIF helpline (sexual & gender violence)', phone: '0800 9210 0009', kind: 'abuse' },
    { name: 'Cece Yara 24-hour child helpline', phone: '0800 800 8001', kind: 'children' },
  ] },
  GH: { country: 'Ghana', emergency: '112', lines: [
    { name: 'National Mental Health & Suicide Prevention Helpline', phone: '0800 678 678', kind: 'crisis' },
    { name: 'Ambulance', phone: '193', kind: 'emergency' },
    { name: 'Police', phone: '191', kind: 'emergency' },
  ] },
  KE: { country: 'Kenya', emergency: '999 or 112', lines: [
    { name: 'Befrienders Kenya (suicide prevention)', phone: '+254 722 178 177', kind: 'crisis' },
    { name: 'one2one helpline (mental health, GBV)', phone: '1190', kind: 'crisis' },
    { name: 'COVAW (violence against women)', phone: '0800 720 553', kind: 'abuse' },
    { name: 'National Child Helpline', phone: '116', kind: 'children' },
  ] },
  ZA: { country: 'South Africa', emergency: '112 (mobile) or 10111 (police)', lines: [
    { name: 'SADAG Suicide Crisis Line', phone: '0800 567 567', kind: 'crisis' },
    { name: 'LifeLine South Africa', phone: '0861 322 322', kind: 'crisis' },
    { name: 'GBV Command Centre', phone: '0800 428 428', kind: 'abuse' },
    { name: 'Childline South Africa', phone: '116', kind: 'children' },
  ] },
  US: { country: 'United States', emergency: '911', lines: [
    { name: '988 Suicide & Crisis Lifeline (call or text)', phone: '988', kind: 'crisis' },
    { name: 'Crisis Text Line — text HOME to', phone: '741741', kind: 'crisis', sms: true },
    { name: 'National Domestic Violence Hotline', phone: '1-800-799-7233', kind: 'abuse' },
    { name: 'Childhelp National Child Abuse Hotline', phone: '1-800-422-4453', kind: 'children' },
  ] },
  GB: { country: 'United Kingdom', emergency: '999', lines: [
    { name: 'Samaritans (24/7, free)', phone: '116 123', kind: 'crisis' },
    { name: 'Shout — text SHOUT to', phone: '85258', kind: 'crisis', sms: true },
    { name: 'National Domestic Abuse Helpline', phone: '0808 2000 247', kind: 'abuse' },
    { name: 'Childline', phone: '0800 1111', kind: 'children' },
  ] },
  IN: { country: 'India', emergency: '112', lines: [
    { name: 'Tele-MANAS (government, 24/7)', phone: '14416', kind: 'crisis' },
    { name: 'AASRA', phone: '+91 98204 66726', kind: 'crisis' },
    { name: 'Women Helpline', phone: '181', kind: 'abuse' },
    { name: 'Childline', phone: '1098', kind: 'children' },
  ] },
};
export const GENERIC_HELP = {
  country: null,
  emergency: 'your local emergency number',
  lines: [],
  directory: { name: 'Find a Helpline — free, confidential lines in your country', url: 'https://findahelpline.com' },
};
const COUNTRY_ALIASES = {
  UK: 'GB', NGA: 'NG', GHA: 'GH', KEN: 'KE', ZAF: 'ZA', USA: 'US', GBR: 'GB', IND: 'IN',
  NIGERIA: 'NG', GHANA: 'GH', KENYA: 'KE', 'SOUTH AFRICA': 'ZA', INDIA: 'IN', 'UNITED STATES': 'US', 'UNITED STATES OF AMERICA': 'US', AMERICA: 'US',
  'UNITED KINGDOM': 'GB', 'GREAT BRITAIN': 'GB', BRITAIN: 'GB', ENGLAND: 'GB', SCOTLAND: 'GB', WALES: 'GB', 'NORTHERN IRELAND': 'GB',
};

export function helplinesFor(country) {
  const c = String(country || '').trim().toUpperCase();
  const code = COUNTRY_ALIASES[c] || c;
  const h = HELPLINES[code];
  return h ? { code, ...h, directory: GENERIC_HELP.directory } : { code: null, ...GENERIC_HELP };
}

/** The crisis block shown at the top of the reply (null when nothing was detected). */
export function crisisBlock(flags, country) {
  if (!flags || !flags.any) return null;
  const help = helplinesFor(country);
  const kinds = new Set(['crisis', 'emergency']);
  if (flags.abuse || flags.danger) kinds.add('abuse');
  if (flags.abuse) kinds.add('children');
  const title = flags.selfHarm ? 'You matter deeply. Please reach out right now.' : 'Your safety matters. Help is available.';
  const body = flags.selfHarm
    ? 'If you might act on thoughts of ending your life or hurting yourself, call your emergency number now or one of the free, confidential lines below. You don’t have to carry this alone — a trained person will listen.'
    : 'If you are in danger right now, call your emergency number. The lines below are free and confidential, and can help you find safety and support. This app does not replace professional help.';
  return {
    kinds: Object.keys(flags).filter((k) => k !== 'any' && flags[k]),
    title,
    body,
    country: help.country,
    code: help.code,
    emergency: help.emergency,
    lines: help.lines.filter((l) => kinds.has(l.kind)),
    directory: help.directory,
  };
}

// ---------- understanding: instant keyword pass (also the fallback when the model is unavailable) ----------
export function keywordThemes(message) {
  const t = ` ${String(message || '').toLowerCase().replace(/[’‘]/g, '\'').replace(/\s+/g, ' ')} `;
  const scores = [];
  for (const k of THEME_KEYS) {
    if (k === 'hope') continue;
    let s = 0;
    for (const kw of THEMES[k].keywords) {
      // short keywords match whole words; longer ones (stems such as "depress") match anywhere
      const hit = kw.length <= 4 ? new RegExp(`[^a-z]${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^a-z]`).test(t) : t.includes(kw);
      if (hit) s += kw.length > 6 ? 1.2 : 1;
    }
    if (s) scores.push({ theme: k, weight: s });
  }
  scores.sort((a, b) => b.weight - a.weight);
  const top = scores.slice(0, 4);
  const max = top.length ? top[0].weight : 1;
  return top.map((x) => ({ theme: x.theme, weight: Math.round((x.weight / max) * 100) / 100 }));
}

// ---------- understanding: model ----------
const SYSTEM = 'You are a warm, wise and theologically careful Christian pastoral companion. You help people who share what they '
  + 'are going through find Scripture that truly fits their situation. Never invent Bible references. Never quote or write Bible '
  + 'verse text yourself — the app adds the exact text. Do not diagnose or give medical, legal or financial instructions; '
  + 'for illness always encourage proper medical care alongside prayer. Reply with ONE JSON object and nothing else.';

export function analysePrompt(message) {
  return [
    `What the person shared: """${String(message).slice(0, 2000)}"""`,
    '',
    `Choose the themes that fit (one or more, most important first) from this list only: ${SITUATION_THEMES.map((k) => `${k} (${THEMES[k].label})`).join(', ')}.`,
    'Return JSON with exactly this shape:',
    '{"themes": [{"theme": string (a key from the list), "weight": number 0-1}] (1-4 items),'
      + ' "specifics": string[] (2-5 short concrete details of THEIR situation, e.g. "lost job last week", "fear about rent", "feels abandoned by God"),'
      + ' "summary": string (one sentence in second person reflecting their situation back gently),'
      + ' "crisis": boolean (true only if they mention suicide, self-harm, abuse or being in danger),'
      + ' "references": string[] (8-10 real Bible references like "Psalm 34:18" or "Isaiah 41:10-11" that speak directly to the specifics; prefer less obvious but fitting passages too)}',
  ].join('\n');
}

function replyText(out) {
  const choice = out && Array.isArray(out.choices) && out.choices[0] && out.choices[0].message ? out.choices[0].message.content : undefined;
  return out && (out.response !== undefined ? out.response : out.result && out.result.response !== undefined ? out.result.response : choice);
}

export async function runModel(env, prompt, maxTokens, temperature = 0.4) {
  const input = { messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }], max_tokens: maxTokens, temperature };
  const models = [...new Set([env.COMPANION_MODEL || COMPANION_MODEL_DEFAULT, ...MODEL_FALLBACKS])];
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
      console.warn('companion model failed, trying next', model, e && e.message);
    }
  }
  throw lastErr || new Error('No companion model answered');
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

/** Clean a model analysis → { themes, specifics, summary, crisis, references } */
export function cleanAnalysis(raw, message) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const seen = new Set();
  const themes = (Array.isArray(o.themes) ? o.themes : []).map((x) => {
    const key = typeof x === 'string' ? x : x && x.theme;
    const k = SITUATION_THEMES.find((t) => t.toLowerCase() === String(key || '').trim().toLowerCase());
    if (!k || seen.has(k)) return null;
    seen.add(k);
    const w = Number(x && x.weight);
    return { theme: k, weight: Number.isFinite(w) && w > 0 ? Math.min(1, w) : 0.7 };
  }).filter(Boolean).slice(0, 4);
  const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const specifics = (Array.isArray(o.specifics) ? o.specifics : []).map((s) => str(s, 140)).filter(Boolean).slice(0, 5);
  const references = (Array.isArray(o.references) ? o.references : []).map((s) => (typeof s === 'string' ? s : s && s.ref)).filter((s) => typeof s === 'string').slice(0, 12);
  // keyword themes back up (or stand in for) the model's choice
  const kw = keywordThemes(message);
  for (const k of kw) if (!themes.some((t) => t.theme === k.theme) && themes.length < 4) themes.push({ theme: k.theme, weight: Math.min(0.6, k.weight * 0.6) });
  return { themes, specifics, summary: str(o.summary, 400), crisis: o.crisis === true, references };
}

export async function analyse(env, message, { stub = false, timeoutMs = 7000 } = {}) {
  if (stub) return { ...cleanAnalysis({}, message), model: 'dev-stub' };
  try {
    const { parsed, model } = await withTimeout(runModel(env, analysePrompt(message), 600, 0.3), timeoutMs);
    return { ...cleanAnalysis(parsed, message), model };
  } catch (e) {
    if (isQuotaError(e)) throw e;
    console.warn('companion analysis fell back to keywords', e && e.message);
    return { ...cleanAnalysis({}, message), model: 'keywords' };
  }
}

// ---------- references ----------
const REF_RE = /^([1-3]?[A-Z]{2,3}) (\d+):(\d+)(?:-(\d+))?$/;
/** "PHP 4:6-7" → { bookId, chapter, vs, ve } (structure only) */
export function parseUsfm(ref) {
  const m = REF_RE.exec(String(ref || '').trim());
  if (!m) return null;
  return { bookId: m[1], chapter: Number(m[2]), vs: Number(m[3]), ve: Number(m[4] || m[3]) };
}

/** Any written reference ("Psalm 34:18", "Isaiah 41:10-11", "PHP 4:6") → canonical "PSA 34:18" / "ISA 41:10-11", or null if it doesn't exist. */
export function canonicalRef(s) {
  const raw = String(s || '').trim();
  let p = parseUsfm(raw.toUpperCase());
  if (!p) {
    const n = normaliseRef(raw);
    if (!n || !/:/.test(n.ref)) return null;
    const range = /:(\d+)\s*[-–]\s*(\d+)/.exec(n.label);
    p = parseUsfm(n.ref);
    if (p && range) p.ve = Number(range[2]);
  }
  if (!p || !BOOK_META[p.bookId]) return null;
  if (p.ve < p.vs) p.ve = p.vs;
  if (p.ve - p.vs > 4) p.ve = p.vs + 4; // keep passages short enough to read on a phone
  if (!refExists(p.bookId, p.chapter, p.vs, Math.min(p.ve, verseCount(p.bookId, p.chapter)))) return null;
  p.ve = Math.min(p.ve, verseCount(p.bookId, p.chapter));
  return p.ve > p.vs ? `${p.bookId} ${p.chapter}:${p.vs}-${p.ve}` : `${p.bookId} ${p.chapter}:${p.vs}`;
}

export function refLabel(ref) {
  const p = parseUsfm(ref);
  if (!p) return ref;
  const b = BOOK_META[p.bookId];
  const name = p.bookId === 'PSA' ? 'Psalm' : b ? b.name : p.bookId;
  return `${name} ${p.chapter}:${p.vs}${p.ve > p.vs ? `-${p.ve}` : ''}`;
}

// The verses a reference covers ("PSA 103:2-3" → ['PSA 103:2', 'PSA 103:3']) — used for repetition checks.
export function verseKeys(ref) {
  const p = parseUsfm(ref);
  if (!p) return [];
  const out = [];
  for (let v = p.vs; v <= p.ve; v++) out.push(`${p.bookId} ${p.chapter}:${v}`);
  return out;
}

// ---------- ranking ----------
const COMMONNESS = new Map();
for (const k of THEME_KEYS) for (const ref of THEMES[k].refs) COMMONNESS.set(ref, (COMMONNESS.get(ref) || 0) + 1);

/**
 * Merge the curated index (by theme weight) with the model's suggestions, skip recent verses and add a little
 * randomness so similar situations still get varied sets. Returns candidates best first, theme-balanced.
 * @param analysis { themes: [{theme, weight}], references: string[] }
 * @param recent   Set of verse keys ("PSA 34:18") delivered to this user lately
 * @param opts     { random: () => number, crisis: flags }
 */
export function rankCandidates(analysis, recent = new Set(), { random = Math.random, crisis = null } = {}) {
  const themes = effectiveThemes(analysis.themes, crisis);
  return rankWith(themes, analysis, recent, random, crisis);
}

/** The themes a reply is built on: crisis themes lead; with abuse/danger, unsafe themes are removed. */
export function effectiveThemes(list, crisis) {
  let themes = [...(list || [])];
  if (crisis && crisis.any) {
    // Crisis first: refuge/hope lead, other themes step back. With abuse or danger, never offer verses about
    // keeping the marriage together, forgiving or submitting — they can be used to keep someone in harm's way.
    const lead = [];
    if (crisis.abuse || crisis.danger) lead.push({ theme: 'safety', weight: 1 });
    if (crisis.selfHarm) lead.push({ theme: 'despair', weight: 1 });
    const unsafe = crisis.abuse || crisis.danger ? ['marriage', 'guilt', 'betrayal', 'temptation', 'children'] : [];
    themes = [...lead, ...themes.filter((t) => !['safety', 'despair', ...unsafe].includes(t.theme)).map((t) => ({ ...t, weight: Math.min(t.weight, 0.4) }))];
  }
  if (!themes.length) themes.push({ theme: 'hope', weight: 1 });
  return themes;
}

function rankWith(themes, analysis, recent, random, crisis) {
  const byRef = new Map();
  const add = (ref, score, theme, source) => {
    const cur = byRef.get(ref) || { ref, score: 0, themes: [], sources: new Set() };
    cur.score += score;
    if (theme && !cur.themes.includes(theme)) cur.themes.push(theme);
    cur.sources.add(source);
    byRef.set(ref, cur);
  };
  for (const { theme, weight } of themes) {
    const list = (THEMES[theme] || THEMES.hope).refs;
    // verses that sit in many themes (Isaiah 41:10…) are good but generic: damp them so each situation gets its own set
    list.forEach((ref, i) => add(ref, (weight * (1 - (i / list.length) * 0.5)) / (1 + 0.15 * ((COMMONNESS.get(ref) || 1) - 1)), theme, 'index'));
  }
  const top = themes[0].theme;
  const blocked = new Set(crisis && (crisis.abuse || crisis.danger) ? ['marriage', 'guilt', 'betrayal', 'temptation'].flatMap((k) => THEMES[k].refs) : []);
  for (const raw of analysis.references || []) {
    const ref = canonicalRef(raw);
    if (ref && !blocked.has(ref)) add(ref, 0.75, byRef.has(ref) ? null : top, 'model');
  }
  // general hope verses as a last resort so a reply never runs short
  THEMES.hope.refs.forEach((ref, i) => { if (!byRef.has(ref)) add(ref, 0.05 - i * 0.001, 'hope', 'fallback'); });

  const isRecent = (ref) => verseKeys(ref).some((k) => recent.has(k));
  const all = [...byRef.values()].map((c) => ({
    ref: c.ref,
    themes: c.themes,
    model: c.sources.has('model'),
    recent: isRecent(c.ref),
    // agreement between the index and the model is the strongest signal; jitter varies near-ties
    score: c.score + (c.sources.has('model') && c.sources.has('index') ? 0.35 : 0) + random() * 0.3 - (isRecent(c.ref) ? 5 : 0),
  }));
  all.sort((a, b) => b.score - a.score);

  // theme balance: give each named theme a share of the first TARGET slots, then fill by score
  const order = [];
  const used = new Set();
  const usedVerses = new Set();
  const take = (c) => {
    const keys = verseKeys(c.ref);
    if (used.has(c.ref) || keys.some((k) => usedVerses.has(k))) return false;
    used.add(c.ref);
    keys.forEach((k) => usedVerses.add(k));
    order.push(c);
    return true;
  };
  const total = themes.reduce((s, t) => s + t.weight, 0) || 1;
  for (const { theme, weight } of themes) {
    const share = Math.max(1, Math.round((weight / total) * TARGET_VERSES));
    let n = 0;
    for (const c of all) { if (n >= share) break; if (!c.recent && c.themes.includes(theme) && take(c)) n++; }
  }
  for (const c of all) take(c);
  return order;
}

// ---------- verse text from the Bible data ----------
const chapterMem = new Map();
const tidy = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+([,.;:!?»”’)])/g, '$1').replace(/\s{2,}/g, ' ').trim();
function flatten(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((c) => {
    if (typeof c === 'string') return c;
    if (!c || c.noteId !== undefined || c.lineBreak) return ' ';
    if (c.text) return c.poem ? ` ${c.text} ` : c.text; // poetry lines arrive with no space between them
    if (c.content) return flatten(c.content);
    return '';
  }).join('');
}
export function versesFromChapter(chapter) {
  const out = [];
  for (const item of (chapter && chapter.content) || []) {
    if (!item || item.type !== 'verse' || !item.number) continue;
    const text = tidy(item.text !== undefined ? item.text : flatten(item.content));
    const i = item.number - 1;
    out[i] = out[i] ? `${out[i]} ${text}` : text;
  }
  for (let i = 0; i < out.length; i++) if (out[i] === undefined) out[i] = '';
  return out;
}

/** Verses of one chapter in a Free Use Bible API translation (e.g. 'eng_kjv'), memoised. null on failure. */
export async function loadChapterText(env, api, bookId, chapter) {
  const k = `${api}/${bookId}/${chapter}`;
  if (chapterMem.has(k)) return chapterMem.get(k);
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = ctrl ? setTimeout(() => ctrl.abort(), 4000) : null;
  try {
    // the app's id for Obadiah is OBD; the Free Use Bible API calls it OBA
    const r = await fetcher(env)(`${BIBLE_API}/${api}/${bookId === 'OBD' ? 'OBA' : bookId}/${chapter}.json`, { headers: { Accept: 'application/json' }, signal: ctrl ? ctrl.signal : undefined });
    if (!r.ok) return null;
    const data = await r.json();
    const verses = versesFromChapter(data && data.chapter);
    if (!verses.length) return null;
    if (chapterMem.size > 600) chapterMem.delete(chapterMem.keys().next().value);
    chapterMem.set(k, verses);
    return verses;
  } catch (e) { return null; } finally { if (t) clearTimeout(t); }
}
export function _clearChapterCache() { chapterMem.clear(); }

/**
 * Validate candidates in order and attach the exact text in the user's translation (falling back to KJV when that
 * translation's text can't be loaded). Drops anything that doesn't exist or has no text. Stops at `want`.
 */
export async function resolveVerses(env, candidates, { api = 'eng_kjv', translation = 'KJV', want = TARGET_VERSES } = {}) {
  const out = [];
  const queue = candidates.filter((c) => canonicalRef(c.ref) === c.ref);
  // fetch in small parallel batches until we have enough
  const size = want + 2;
  for (let i = 0; i < queue.length && out.length < want; i += size) {
    const batch = queue.slice(i, i + size);
    const done = await Promise.all(batch.map(async (c) => {
      const p = parseUsfm(c.ref);
      let tr = translation;
      let verses = await loadChapterText(env, api, p.bookId, p.chapter);
      if (!verses && api !== 'eng_kjv') { verses = await loadChapterText(env, 'eng_kjv', p.bookId, p.chapter); tr = 'KJV'; }
      if (!verses) return null;
      const parts = [];
      for (let v = p.vs; v <= p.ve; v++) parts.push(verses[v - 1]);
      if (parts.some((x) => !x)) return null; // the reference doesn't exist in this text
      return { ref: c.ref, label: refLabel(c.ref), bookId: p.bookId, chapter: p.chapter, verseStart: p.vs, verseEnd: p.ve, translation: tr, text: parts.join(' '), themes: c.themes, suggested: !!c.model };
    }));
    for (const d of done) if (d && out.length < want && !out.some((o) => o.ref === d.ref)) out.push(d);
  }
  return out;
}

// ---------- 3. compose ----------
export function composePrompt(part, { message, analysis, verses }) {
  const head = [
    `What the person shared: """${String(message).slice(0, 2000)}"""`,
    analysis && analysis.specifics && analysis.specifics.length ? `Key details: ${analysis.specifics.join('; ')}` : '',
    analysis && analysis.themes && analysis.themes.length ? `Themes: ${analysis.themes.map((t) => (THEMES[t.theme] || {}).label || t.theme).join(', ')}` : '',
  ].filter(Boolean);
  const medical = analysis && analysis.themes && analysis.themes.some((t) => t.theme === 'sickness');
  const crisis = analysis && analysis.crisis;
  const kinds = (analysis && analysis.crisisKinds) || [];
  if (kinds.includes('abuse') || kinds.includes('danger')) {
    head.push('SAFETY: they may be experiencing abuse or danger. Their safety comes first. Never suggest they stay with, submit to, '
      + 'reconcile with or forgive an abuser now, and never imply the abuse is their fault. Encourage them to reach a safe place and the helplines shown.');
  }
  if (part === 'p') {
    head.push(`Scriptures chosen for them: ${verses.map((v) => v.label).join(', ')}`);
    head.push('', 'Write words of encouragement grounded in these scriptures and a personalised prayer for this person, naming their actual situation (not generic).'
      + (medical ? ' Because illness is involved, gently encourage them to keep getting proper medical care and to follow their doctor’s advice alongside prayer.' : '')
      + (crisis ? ' They may be in crisis: be very gentle, tell them their life matters, and urge them to contact the helplines shown or someone they trust today.' : '')
      + ' Return JSON: {"encouragement": string (2 short paragraphs, second person, warm, hopeful, no clichés), "prayer": string (a first-person prayer they can pray, 120-180 words, ending with "Amen.")}');
    return head.join('\n');
  }
  head.push('', 'For each scripture below, explain in 2-3 sentences how it speaks to THIS person’s situation (refer to their details; do not re-quote the verse).');
  verses.forEach((v, i) => head.push(`${i + 1}. ${v.label} — "${v.text}"`));
  head.push('Return JSON: {"explanations": [{"ref": string (exactly as given, e.g. "' + verses[0].label + '"), "explanation": string}] (one per scripture, same order)}');
  return head.join('\n');
}

export function composeSlice(part, verses) {
  if (part === 'x1') return verses.slice(0, 4);
  if (part === 'x2') return verses.slice(4);
  return verses;
}

export function cleanCompose(part, raw, verses) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : Array.isArray(v) ? v.filter((x) => typeof x === 'string').join('\n\n').trim().slice(0, n) : '');
  if (part === 'p') return { encouragement: str(o.encouragement, 1600), prayer: str(o.prayer, 1600) };
  const list = Array.isArray(o.explanations) ? o.explanations : [];
  const out = {};
  verses.forEach((v, i) => {
    const byRef = list.find((x) => x && typeof x === 'object' && canonicalRef(x.ref) === v.ref);
    const e = byRef || list[i];
    const text = typeof e === 'string' ? e : e && (e.explanation || e.text);
    if (typeof text === 'string' && text.trim()) out[v.ref] = text.trim().slice(0, 900);
  });
  return { explanations: out };
}

export function stubCompose(part, { verses, analysis }) {
  if (part === 'p') {
    const medical = analysis && analysis.themes && analysis.themes.some((t) => t.theme === 'sickness');
    return {
      encouragement: `[Dev stub] Words of encouragement, written for what you shared, appear here once Workers AI is connected.${medical ? ' Please keep following your doctor’s advice and getting proper medical care alongside prayer.' : ''}`,
      prayer: '[Dev stub] Lord, You see exactly where I am today… (a personalised prayer appears here). Amen.',
    };
  }
  return { explanations: Object.fromEntries(verses.map((v) => [v.ref, `[Dev stub] How ${v.label} speaks to your situation (${(v.themes || []).map((t) => (THEMES[t] || {}).label || t).join(', ') || 'hope'}).`])) };
}

export async function compose(env, part, ctx, { stub = false } = {}) {
  const verses = composeSlice(part, ctx.verses);
  if (part !== 'p' && !verses.length) return { part, data: { explanations: {} }, model: 'none' };
  if (stub) return { part, data: stubCompose(part, { ...ctx, verses }), model: 'dev-stub' };
  const { parsed, model } = await runModel(env, composePrompt(part, { ...ctx, verses }), part === 'p' ? 700 : 900, 0.6);
  return { part, data: cleanCompose(part, parsed, verses), model };
}

// Acknowledgement line shown instantly (before the model has read the message).
export function acknowledgement(flags, themes) {
  if (flags && flags.selfHarm) return 'Thank you for trusting me with this. What you’re carrying sounds unbearably heavy, and you don’t have to carry it alone. Please look at the help below first — then here are words from God for you.';
  if (flags && flags.any) return 'Thank you for telling me. Your safety matters most — please see the help below. God sees you, and here is His word for you.';
  const t = themes && themes[0] && THEMES[themes[0].theme];
  if (themes && themes.some((x) => x.theme === 'gratitude')) return 'What a joy to hear! Let’s give thanks together — here is Scripture to celebrate with you.';
  return t ? `Thank you for sharing this with me. I’m gathering Scripture for you on ${t.label.toLowerCase()}…` : 'Thank you for sharing this with me. I’m gathering Scripture for you…';
}

export const MEDICAL_NOTE = 'God often heals through doctors, nurses and medicine. Please keep getting proper medical care and follow your doctor’s advice alongside prayer.';
