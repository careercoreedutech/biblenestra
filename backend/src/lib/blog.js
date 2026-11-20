// BLOG — BibleNestra's own blog, served by this Worker (/blog, /blog/<slug>) and written from the admin "Blog" tab.
//   * Posts: simple Markdown bodies (rendered server-side with everything escaped — no raw HTML ever reaches a page),
//     status draft | scheduled | published, source manual | ai.
//   * AI auto-posting: admins create schedules (topics and/or a free prompt, tone, length, posts per run, daily /
//     weekly on chosen weekdays / monthly on a day, time + IANA timezone, auto-publish or save as draft). The 15-minute
//     cron (runBlogCron) claims due schedules (compare-and-set on next_run_at), then writes at most BLOG_CRON_POSTS
//     posts per tick; the rest are picked up by the next tick. Every run is logged in blog_runs.
//   * Scripture accuracy: the model never writes verse text. It writes markers like [[JHN 3:16]]; we validate each
//     against the KJV verse table (verseCounts.js via companion.canonicalRef) and insert the exact KJV text fetched
//     the way the Scripture Companion does. Invalid references are dropped; model-written block quotes are removed.
//   * Safety: a system prompt (no medical / financial / legal promises, no politics, no denominational attacks) plus a
//     pattern check; anything flagged is kept as a draft with a review note, even on auto-publish schedules.
import { one, q } from './db.js';
import { ApiError, bad } from './http.js';
import { canonicalRef, loadChapterText, parseUsfm, refLabel } from './companion.js';
import { isQuotaError } from './exegesis.js';
import { contentHash, localDate, senderConfig, validTimeZone, zonedToUtc } from './broadcasts.js';

export const BLOG_MODEL_DEFAULT = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const MODEL_FALLBACKS = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-70b-instruct', '@cf/meta/llama-3.1-8b-instruct-fp8'];
export const DEFAULT_TZ = 'Africa/Lagos';
export const DEFAULT_AUTHOR = 'BibleNestra';
export const DEFAULT_DISCLAIMER = 'This article was prepared with the help of AI and reviewed by the BibleNestra team. Scripture quotations are from the King James Version.';

export const PRESET_TOPICS = [
  'Prayer', 'Faith', 'Marriage', 'Youth', 'Grief', 'Purpose', 'Forgiveness', 'Book studies', 'Devotional',
  'Hope', 'Worship', 'Family', 'Work & calling', 'Gratitude', 'Peace & anxiety', 'Holy Spirit', 'Salvation', 'Leadership',
];
export const TONES = {
  warm: 'warm and encouraging',
  teaching: 'clear and teaching (like a good Bible-study leader)',
  devotional: 'quiet, reflective and devotional',
  youth: 'friendly and lively for young people (no slang overload)',
  pastoral: 'gentle and pastoral',
};
export const LENGTHS = { short: 450, medium: 750, long: 1100 };
export const FREQUENCIES = ['daily', 'weekly', 'monthly'];
export const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED_SLUGS = new Set(['api', 'topic', 'page', 'feed', 'rss', 'admin']);

const iso = (d) => (d ? new Date(d).toISOString() : null);
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : d; };

// ---------- text helpers ----------
export function slugify(s) {
  const base = String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  let out = base.slice(0, 80).replace(/-+$/, '');
  if (!out || RESERVED_SLUGS.has(out)) out = out ? `${out}-post` : 'post';
  return out;
}

/** Markdown → plain text (for excerpts, SEO descriptions and reading time). */
export function plainText(md) {
  return String(md || '')
    .replace(/\[\[[^\]]*\]\]/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*]|\d+[.)])\s+/gm, '')
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
/** Excerpt from the body: the opening prose paragraphs only (no headings, quotes, lists or verse markers). */
export function autoExcerpt(md, n = 240) {
  const prose = String(md || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/)
    .filter((para) => !/^\s*(#{1,6}\s|>|[-*•]\s|\d+[.)]\s|\[\[)/.test(para));
  return clip(plainText(prose.slice(0, 2).join(' ')), n);
}
export const wordCount = (md) => (plainText(md).match(/\S+/g) || []).length;
export const readingMinutes = (md) => Math.max(1, Math.ceil(wordCount(md) / 200));
export function clip(s, n) {
  const t = String(s || '').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, '')}…`;
}

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function inline(s) {
  let t = esc(s);
  // links: http(s) or site-relative only
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g, (m, label, href) => {
    const ext = /^https?:/.test(href);
    return `<a href="${href}"${ext ? ' rel="noopener nofollow" target="_blank"' : ''}>${label}</a>`;
  });
  t = t.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>');
  t = t.replace(/(^|[^\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<em>$2</em>');
  return t;
}

/** The small Markdown subset we support → safe HTML (all text escaped). # and ## → h2 (the page title is the h1), ### → h3. */
export function renderMarkdown(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = []; let list = null; let quote = [];
  const flushPara = () => { if (para.length) out.push(`<p>${para.map(inline).join(' ')}</p>`); para = []; };
  const flushList = () => { if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; };
  const flushQuote = () => {
    if (!quote.length) return;
    out.push(`<blockquote>${quote.map((l) => (/^—\s/.test(l) ? `<cite>${inline(l)}</cite>` : `<p>${inline(l)}</p>`)).join('')}</blockquote>`);
    quote = [];
  };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) { flushAll(); continue; }
    let m;
    if ((m = /^(#{1,4})\s+(.+)$/.exec(t))) { flushAll(); const lv = Math.max(2, Math.min(4, m[1].length)); out.push(`<h${lv}>${inline(m[2].replace(/\s+#+$/, ''))}</h${lv}>`); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { flushAll(); out.push('<hr>'); continue; }
    if ((m = /^>\s?(.*)$/.exec(t))) { flushPara(); flushList(); if (m[1]) quote.push(m[1]); continue; }
    if ((m = /^[-*•]\s+(.+)$/.exec(t))) { flushPara(); flushQuote(); if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; } list.items.push(m[1]); continue; }
    if ((m = /^\d+[.)]\s+(.+)$/.exec(t))) { flushPara(); flushQuote(); if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; } list.items.push(m[1]); continue; }
    flushList(); flushQuote(); para.push(t);
  }
  flushAll();
  return out.join('\n');
}

// ---------- scripture markers ----------
const MARKER_RE = /\[\[\s*([^\][\n]{3,40}?)\s*\]\]/g;

/**
 * Replace [[BOOK C:V(-V)]] markers with exact KJV text. A marker alone on its line becomes a block quote
 * ("> text" + "> — **John 3:16** (KJV)"); an inline marker becomes the plain reference label. References that don't
 * exist are dropped. With stripModelQuotes, block quotes the writer typed themselves are removed first (the model
 * must never supply verse text). → { body, used: [canonical refs], dropped: [raw] }
 */
export async function resolveVerseMarkers(env, md, { stripModelQuotes = false, api = 'eng_kjv' } = {}) {
  let src = String(md || '').replace(/\r\n?/g, '\n');
  if (stripModelQuotes) src = src.split('\n').filter((l) => !/^\s*>/.test(l)).join('\n');
  const found = new Map(); // raw → canonical | null
  for (const m of src.matchAll(MARKER_RE)) if (!found.has(m[1])) found.set(m[1], canonicalRef(m[1]));
  const texts = new Map();
  await Promise.all([...new Set([...found.values()].filter(Boolean))].map(async (ref) => {
    const p = parseUsfm(ref);
    const verses = await loadChapterText(env, api, p.bookId, p.chapter);
    if (!verses) return;
    const parts = [];
    for (let v = p.vs; v <= p.ve; v++) parts.push(verses[v - 1]);
    if (parts.every(Boolean)) texts.set(ref, parts.join(' ').replace(/\s+/g, ' ').trim());
  }));
  const used = []; const dropped = [];
  const lines = src.split('\n').flatMap((line) => {
    const alone = /^\s*\[\[[^\]]+\]\]\s*$/.test(line);
    if (alone) {
      const raw = line.trim().slice(2, -2).trim();
      const ref = found.get(raw);
      if (!ref) { dropped.push(raw); return []; }
      used.push(ref);
      const text = texts.get(ref);
      return text ? ['', `> “${text}”`, `> — **${refLabel(ref)}** (KJV)`, ''] : ['', `*Read ${refLabel(ref)}.*`, ''];
    }
    return [line.replace(MARKER_RE, (m, raw) => {
      const ref = found.get(raw);
      if (!ref) { dropped.push(raw); return ''; }
      used.push(ref);
      return refLabel(ref);
    }).replace(/\(\s*\)/g, '').replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,;:!?])/g, '$1')];
  });
  const body = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { body, used: [...new Set(used)], dropped: [...new Set(dropped)] };
}

// ---------- content safety ----------
const UNSAFE = [
  [/\b(stop|quit|throw away)\b[^.]{0,30}\b(medication|medicine|treatment|drugs|tablets)\b/i, 'medical advice'],
  [/\b(guarantee[sd]?|promise[sd]?|will surely)\b[^.]{0,40}\b(heal(ing|ed)?|cure[sd]?|recover(y)?)\b/i, 'healing promise'],
  [/\b(instead of|don.?t need)\b[^.]{0,20}\b(doctors?|hospitals?|medicine)\b/i, 'medical advice'],
  [/\b(guarantee[sd]?|promise[sd]?|will surely)\b[^.]{0,40}\b(wealth|rich|riches|money|profit|financial breakthrough|millionaire)\b/i, 'financial promise'],
  [/\b(sow|seed|give)\b[^.]{0,30}\b(naira|dollars?|cedis|shillings|money|offering)\b[^.]{0,50}\b(hundredfold|multiply|return to you|guaranteed)\b/i, 'prosperity promise'],
  [/\b(invest|crypto|bitcoin|forex|stocks?)\b[^.]{0,40}\b(double|profit|returns?)\b/i, 'financial advice'],
  [/\b(legal advice|you should sue|file a lawsuit)\b/i, 'legal advice'],
  [/\b(vote for|voting for|elect(ed)? (him|her|them))\b/i, 'politics'],
  [/\b(Democrats?|Republicans?|APC|PDP|Labour Party|Tinubu|Atiku|Peter Obi|Trump|Biden|Kamala Harris|Ruto|Raila)\b/, 'politics'],
  [/\b(Catholics?|Protestants?|Pentecostals?|Orthodox|Baptists?|Anglicans?|Methodists?|Adventists?)\b[^.]{0,25}\b(are|is)\b[^.]{0,15}\b(heretics?|deceived|false|wrong|lost|evil|a cult|going to hell|not (real )?christians?)\b/i, 'denominational attack'],
];
/** → list of reasons this text needs a human look (empty = fine). */
export function safetyFlags(text) {
  const s = String(text || '');
  const out = [];
  for (const [re, why] of UNSAFE) if (re.test(s) && !out.includes(why)) out.push(why);
  return out;
}

// ---------- schedules: when do they run ----------
const addDays = (date, n) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const weekdayOf = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();
const daysInMonth = (date) => { const [y, m] = date.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

/** Does the schedule run on this local calendar date? */
export function runsOn(s, date) {
  if (s.frequency === 'weekly') return (s.weekdays || []).includes(weekdayOf(date));
  if (s.frequency === 'monthly') return Number(date.slice(8, 10)) === Math.min(s.monthDay || 1, daysInMonth(date));
  return true; // daily
}

/** The next run strictly after `after` (UTC Date), in the schedule's timezone at its local time. DST-safe. */
export function nextRunAt(s, after = new Date()) {
  const tz = validTimeZone(s.timezone) ? s.timezone : DEFAULT_TZ;
  const time = TIME_RE.test(s.timeOfDay || '') ? s.timeOfDay : '08:00';
  let day = addDays(localDate(after, tz), -1);
  for (let i = 0; i < 800; i++, day = addDays(day, 1)) {
    if (!runsOn(s, day)) continue;
    const at = zonedToUtc(day, time, tz);
    if (at > after) return at;
  }
  return null;
}

/** Topic for the n-th post of a schedule (rotates through its topics so consecutive posts differ). */
export function topicFor(s, cursor) {
  const t = s.topics || [];
  if (!t.length) return null;
  const n = Number(cursor) || 0;
  return t[((n % t.length) + t.length) % t.length];
}

export function scheduleFromRow(r) {
  return {
    id: r.id,
    name: r.name,
    topics: Array.isArray(r.topics) ? r.topics : [],
    prompt: r.prompt || '',
    tone: r.tone || 'warm',
    length: r.length || 'medium',
    postsPerRun: r.posts_per_run || 1,
    frequency: r.frequency || 'daily',
    weekdays: Array.isArray(r.weekdays) ? r.weekdays.map(Number) : [],
    monthDay: r.month_day || 1,
    timeOfDay: r.time_of_day || '08:00',
    timezone: r.timezone || DEFAULT_TZ,
    publishMode: r.publish_mode || 'draft',
    notify: !!r.notify,
    active: !!r.active,
    nextRunAt: iso(r.next_run_at),
    lastRunAt: iso(r.last_run_at),
    pending: r.pending || 0,
    topicCursor: r.topic_cursor || 0,
    createdAt: iso(r.created_at),
  };
}

export function describeSchedule(s) {
  const when = s.frequency === 'weekly' ? `Weekly on ${(s.weekdays || []).slice().sort().map((d) => WEEKDAY_NAMES[d]).join(', ') || '—'}`
    : s.frequency === 'monthly' ? `Monthly on day ${s.monthDay}` : 'Daily';
  return `${when} at ${s.timeOfDay} (${s.timezone}) · ${s.postsPerRun} post${s.postsPerRun === 1 ? '' : 's'} per run · ${s.publishMode === 'publish' ? 'auto-publish' : 'drafts for review'}`;
}

/** Validate an admin's schedule input (b = request body, cur = existing shape) → shape-like object. */
export function scheduleInput(b, cur = null) {
  const has = (k) => b[k] !== undefined;
  const c = cur || { name: '', topics: [], prompt: '', tone: 'warm', length: 'medium', postsPerRun: 1, frequency: 'daily', weekdays: [1], monthDay: 1, timeOfDay: '08:00', timezone: DEFAULT_TZ, publishMode: 'draft', notify: false, active: true };
  const name = has('name') ? String(b.name || '').trim() : c.name;
  if (!name || name.length > 80) throw bad('Give the schedule a name (up to 80 characters)', 'BAD_NAME');
  let topics = c.topics;
  if (has('topics')) {
    if (!Array.isArray(b.topics)) throw bad('topics must be a list', 'BAD_TOPICS');
    const seen = new Set();
    topics = b.topics.map((t) => String(t || '').trim().replace(/\s+/g, ' ').slice(0, 60)).filter((t) => {
      const k = t.toLowerCase(); if (!t || seen.has(k)) return false; seen.add(k); return true;
    }).slice(0, 30);
  }
  const prompt = has('prompt') ? String(b.prompt || '').trim().slice(0, 1500) : c.prompt;
  if (!topics.length && !prompt) throw bad('Pick at least one topic or describe what to write about', 'NO_TOPIC');
  const tone = has('tone') ? String(b.tone) : c.tone;
  if (!TONES[tone]) throw bad(`Tone must be one of ${Object.keys(TONES).join(', ')}`, 'BAD_TONE');
  const length = has('length') ? String(b.length) : c.length;
  if (!LENGTHS[length]) throw bad('Length must be short, medium or long', 'BAD_LENGTH');
  const postsPerRun = has('postsPerRun') ? Number(b.postsPerRun) : c.postsPerRun;
  if (!Number.isInteger(postsPerRun) || postsPerRun < 1 || postsPerRun > 5) throw bad('Posts per run must be 1 to 5', 'BAD_COUNT');
  const frequency = has('frequency') ? String(b.frequency) : c.frequency;
  if (!FREQUENCIES.includes(frequency)) throw bad('Frequency must be daily, weekly or monthly', 'BAD_FREQUENCY');
  let weekdays = has('weekdays') ? b.weekdays : c.weekdays;
  if (!Array.isArray(weekdays)) throw bad('weekdays must be a list of 0–6 (Sunday = 0)', 'BAD_WEEKDAYS');
  weekdays = [...new Set(weekdays.map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
  if (frequency === 'weekly' && !weekdays.length) throw bad('Choose at least one weekday', 'BAD_WEEKDAYS');
  const monthDay = has('monthDay') ? Number(b.monthDay) : c.monthDay;
  if (!Number.isInteger(monthDay) || monthDay < 1 || monthDay > 31) throw bad('Day of the month must be 1 to 31', 'BAD_MONTH_DAY');
  const timeOfDay = has('timeOfDay') ? String(b.timeOfDay || '') : c.timeOfDay;
  if (!TIME_RE.test(timeOfDay)) throw bad('Time must look like 08:00', 'BAD_TIME');
  const timezone = has('timezone') ? String(b.timezone || '').trim() || DEFAULT_TZ : c.timezone;
  if (!validTimeZone(timezone)) throw bad('Unknown timezone — use a name like Africa/Lagos', 'BAD_TIMEZONE');
  const publishMode = has('publishMode') ? String(b.publishMode) : c.publishMode;
  if (!['draft', 'publish'].includes(publishMode)) throw bad('publishMode must be draft or publish', 'BAD_MODE');
  return {
    name, topics, prompt, tone, length, postsPerRun, frequency, weekdays: weekdays.length ? weekdays : [1], monthDay, timeOfDay, timezone, publishMode,
    notify: has('notify') ? !!b.notify : c.notify,
    active: has('active') ? !!b.active : c.active,
  };
}

// ---------- posts ----------
export const LIVE = `(p.status = 'published' OR (p.status = 'scheduled' AND p.publish_at <= now()))`;

export function postShape(r, { base = '', mediaUrlFor = null, full = true } = {}) {
  const cover = !r.cover_key ? null : /^https:\/\//.test(r.cover_key) ? r.cover_key : mediaUrlFor ? mediaUrlFor(r.cover_key) : null;
  const live = r.status === 'published' || (r.status === 'scheduled' && r.publish_at && new Date(r.publish_at) <= new Date());
  return {
    id: r.id,
    slug: r.slug,
    url: `${base}/blog/${r.slug}`,
    title: r.title,
    excerpt: r.excerpt || '',
    coverUrl: cover,
    coverKey: r.cover_key || null,
    topic: r.topic || null,
    tags: Array.isArray(r.tags) ? r.tags : [],
    status: r.status,
    live,
    publishAt: iso(r.publish_at),
    publishedAt: iso(r.published_at || (live ? r.publish_at : null)),
    author: r.author || DEFAULT_AUTHOR,
    source: r.source,
    scheduleId: r.schedule_id || null,
    seoDescription: r.seo_description || '',
    readingMinutes: r.reading_minutes || 1,
    views: r.views || 0,
    reviewNote: r.review_note || null,
    updatedAt: iso(r.updated_at),
    createdAt: iso(r.created_at),
    ...(full ? { body: r.body || '' } : {}),
  };
}

export async function uniqueSlug(env, wanted, exceptId = null) {
  const base = slugify(wanted);
  const rows = await q(env, `SELECT slug FROM blog_posts WHERE (slug = $1 OR slug LIKE $2) AND ($3::uuid IS NULL OR id <> $3::uuid)`, [base, `${base}-%`, exceptId]);
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Insert a post; picks a unique slug (retrying on a unique-violation race). p = column values. */
export async function insertPost(env, p) {
  let slug = await uniqueSlug(env, p.slug || p.title);
  for (let i = 0; i < 4; i++) {
    const row = await one(env, `INSERT INTO blog_posts (slug, title, excerpt, body, cover_key, topic, tags, status, publish_at, published_at, author, source,
        schedule_id, run_id, seo_description, reading_minutes, review_note, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT (slug) DO NOTHING RETURNING *`, [
      slug, p.title, p.excerpt || '', p.body || '', p.coverKey || null, p.topic || null, JSON.stringify(p.tags || []), p.status || 'draft',
      p.publishAt || null, p.status === 'published' ? (p.publishedAt || new Date().toISOString()) : null, p.author || DEFAULT_AUTHOR, p.source || 'manual',
      p.scheduleId || null, p.runId || null, p.seoDescription || '', readingMinutes(p.body), p.reviewNote || null, p.createdBy || null,
    ]);
    if (row) return row;
    slug = `${slugify(p.slug || p.title)}-${Math.random().toString(36).slice(2, 6)}`;
  }
  throw new ApiError(409, 'SLUG_TAKEN', 'Could not find a free link for this post — change the slug');
}

export async function getSettings(env) {
  const r = await one(env, 'SELECT * FROM blog_settings WHERE id = 1');
  return {
    disclaimer: !!(r && r.disclaimer),
    disclaimerText: (r && r.disclaimer_text) || DEFAULT_DISCLAIMER,
    authorName: (r && r.author_name) || DEFAULT_AUTHOR,
  };
}

// ---------- AI writing ----------
const SYSTEM = [
  'You write articles for the BibleNestra blog, read by Christians of every church background (many in Africa).',
  'Write in clear, warm English. Be biblically orthodox and broadly Christian: Jesus Christ is Lord and Saviour, Scripture is trustworthy, salvation is by grace through faith.',
  'Rules you must always follow:',
  '- Never write out the words of a Bible verse yourself. To quote Scripture, put the reference ALONE on its own line in double square brackets with the 3-letter book code, e.g. [[JHN 3:16]] or [[PSA 23:1-3]] — the exact verse text is inserted for you. Use 2 to 5 such references, only ones you are sure exist. Book codes: GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBD JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV.',
  '- No medical, financial or legal advice or promises (never promise healing, wealth or outcomes; encourage people to see doctors and qualified advisers alongside prayer).',
  '- No politics, politicians or parties. Never criticise or mock any church, denomination or religion.',
  '- No made-up stories presented as true, no statistics, no quotes from real people.',
  '- Be encouraging and practical: end with a short prayer or a reflection question.',
].join('\n');

const FORMAT = [
  'Reply in exactly this format (no extra commentary before or after):',
  'TITLE: <a fresh, specific title, max 80 characters>',
  'EXCERPT: <one or two sentences that make people want to read, max 220 characters>',
  'SEO: <search description, max 155 characters>',
  'TAGS: <2 to 4 short tags, comma separated>',
  'BODY:',
  '<the article in simple Markdown: short paragraphs, 2–4 "## " subheadings, optional "- " lists, **bold** sparingly; no title heading at the top>',
].join('\n');

export function buildPrompt({ topic, prompt, tone, words, recentTitles = [], avoidTitle = null, source = null }) {
  const parts = [];
  if (source) parts.push(source);
  if (topic) parts.push(`Topic: ${topic}.`);
  if (prompt) parts.push(`${topic ? 'Extra guidance from the editor' : 'What to write about'}: ${prompt}`);
  parts.push(`Tone: ${TONES[tone] || TONES.warm}. Length: about ${words} words.`);
  if (topic && recentTitles.length) parts.push('Take a different angle from the recent articles listed below.');
  if (recentTitles.length) parts.push(`Recent titles on the blog (do NOT reuse or closely copy any of these):\n${recentTitles.slice(0, 40).map((t) => `- ${t}`).join('\n')}`);
  if (avoidTitle) parts.push(`Your previous title "${avoidTitle}" was already used. Choose a clearly different title and angle.`);
  parts.push(FORMAT);
  return parts.join('\n\n');
}

function replyText(out) {
  const choice = out && Array.isArray(out.choices) && out.choices[0] && out.choices[0].message ? out.choices[0].message.content : undefined;
  const r = out && (out.response !== undefined ? out.response : out.result && out.result.response !== undefined ? out.result.response : choice);
  return typeof r === 'string' ? r : r && typeof r === 'object' ? JSON.stringify(r) : '';
}

/** Parse the model's reply (our labelled format, or JSON as a fallback) → { title, excerpt, seo, tags, body } | null */
export function parseArticle(text) {
  let s = String(text || '').replace(/^```[a-z]*\n?|```$/gim, '').trim();
  if (!s) return null;
  if (s.startsWith('{')) {
    try {
      const o = JSON.parse(s);
      if (o && o.title && o.body) return { title: String(o.title), excerpt: String(o.excerpt || ''), seo: String(o.seo || o.seoDescription || ''), tags: Array.isArray(o.tags) ? o.tags.map(String) : [], body: String(o.body) };
    } catch (e) { /* fall through */ }
  }
  const field = (name) => { const m = new RegExp(`^\\s*\\**${name}\\**\\s*:\\s*(.+)$`, 'im').exec(s); return m ? m[1].trim().replace(/^\*+|\*+$/g, '').trim() : ''; };
  let title = field('TITLE');
  const bm = /^\s*\**BODY\**\s*:\s*\n?/im.exec(s);
  let body = bm ? s.slice(bm.index + bm[0].length) : '';
  if (!bm) { // no labels: take a leading "# Title" and the rest as body
    const h = /^#\s+(.+)$/m.exec(s);
    if (!h) return null;
    title = title || h[1];
    body = s.slice(h.index + h[0].length);
  }
  title = title.replace(/^["“']|["”']$/g, '').trim();
  body = body.trim().replace(new RegExp(`^#{1,2}\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n`, 'i'), '').trim();
  if (!title || !body) return null;
  return { title, excerpt: field('EXCERPT'), seo: field('SEO'), tags: field('TAGS').split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean), body };
}

export const normTitle = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function runModel(env, prompt, maxTokens, temperature) {
  const input = { messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }], max_tokens: maxTokens, temperature };
  const models = [...new Set([env.BLOG_MODEL || BLOG_MODEL_DEFAULT, ...MODEL_FALLBACKS])];
  let lastErr;
  for (const model of models) {
    try {
      const out = await env.AI.run(model, input);
      const parsed = parseArticle(replyText(out));
      if (parsed && wordCount(parsed.body) >= 80) return { parsed, model };
      lastErr = new Error('The model reply was not a usable article');
    } catch (e) {
      if (isQuotaError(e)) throw e;
      lastErr = e;
      console.warn('blog model failed, trying next', model, e && e.message);
    }
  }
  throw lastErr || new Error('No model answered');
}

export async function recentTitles(env, n = 60) {
  return (await q(env, 'SELECT title FROM blog_posts ORDER BY created_at DESC LIMIT $1', [n])).map((r) => r.title);
}

/**
 * Write one article with Workers AI. → { title, excerpt, seoDescription, tags, body, model, used, dropped, flags }
 * Retries once with a hotter temperature when the title duplicates a recent one.
 */
export async function writeArticle(env, { topic = null, prompt = '', tone = 'warm', length = 'medium', source = null } = {}) {
  if (!env.AI || typeof env.AI.run !== 'function') throw new ApiError(503, 'AI_NOT_CONFIGURED', 'AI writing isn’t set up on this server (Workers AI binding "AI" is missing).');
  const words = LENGTHS[length] || LENGTHS.medium;
  const titles = await recentTitles(env);
  const seen = new Set(titles.map(normTitle));
  let avoid = null; let got = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await runModel(env, buildPrompt({ topic, prompt, tone, words, recentTitles: titles, avoidTitle: avoid, source }), Math.min(3000, Math.round(words * 2.2) + 200), attempt ? 0.95 : 0.75);
    if (!seen.has(normTitle(r.parsed.title))) { got = r; break; }
    avoid = r.parsed.title;
  }
  if (!got) throw new ApiError(409, 'DUPLICATE_TITLE', `The AI kept repeating an existing title (“${avoid}”)`);
  const { parsed, model } = got;
  const v = await resolveVerseMarkers(env, parsed.body, { stripModelQuotes: true });
  const title = clip(parsed.title, 120);
  const excerpt = clip(parsed.excerpt || autoExcerpt(v.body), 240);
  return {
    title,
    excerpt,
    seoDescription: clip(parsed.seo || excerpt, 160),
    tags: parsed.tags.map((t) => t.slice(0, 30)).slice(0, 6),
    body: v.body,
    model,
    used: v.used,
    dropped: v.dropped,
    flags: safetyFlags(`${title}\n${excerpt}\n${v.body}`),
  };
}

// ---------- notifications (optional per schedule) ----------
/**
 * When a schedule has "send a notification" on, queue ONE inbox broadcast for its newly published post (the existing
 * broadcast cron delivers it). notified_at makes this happen at most once per post.
 */
export async function maybeNotify(env, post) {
  if (!post || !post.schedule_id) return false;
  const s = await one(env, 'SELECT notify, base_url FROM blog_schedules WHERE id = $1', [post.schedule_id]);
  const base = String(env.BLOG_BASE_URL || (s && s.base_url) || '').replace(/\/$/, '');
  if (!s || !s.notify || !base) return false;
  const won = await one(env, 'UPDATE blog_posts SET notified_at = now() WHERE id = $1 AND notified_at IS NULL RETURNING id', [post.id]);
  if (!won) return false;
  const url = `${base}/blog/${post.slug}`;
  const sender = senderConfig(env);
  const title = clip(`New on the blog: ${post.title}`, 120);
  const text = clip(post.excerpt || '', 400);
  const links = [{ url, label: 'Read the article', host: new URL(url).host, title: post.title, description: text }];
  await one(env, `INSERT INTO broadcasts (target, status, title, body, links, sender_name, sender_logo, content_hash, scheduled_at)
    VALUES ('inbox', 'scheduled', $1, $2, $3::jsonb, $4, $5, $6, now()) RETURNING id`,
  [title, text, JSON.stringify(links), sender.name, sender.logoUrl || null, await contentHash({ blogPost: post.id })]);
  return true;
}

// ---------- runs ----------
async function bumpRun(env, runId, { made = 0, failed = 0, postId = null, error = null, note = null }) {
  if (!runId) return;
  await q(env, `UPDATE blog_runs SET made = made + $2, failed = failed + $3,
      post_ids = CASE WHEN $4::text IS NULL THEN post_ids ELSE post_ids || to_jsonb($4::text) END,
      error = COALESCE($5, error), notes = CASE WHEN $6::text IS NULL THEN notes ELSE notes || to_jsonb($6::text) END,
      status = CASE WHEN made + $2 + failed + $3 >= wanted THEN (CASE WHEN made + $2 >= wanted THEN 'success' WHEN made + $2 > 0 THEN 'partial' ELSE 'failed' END) ELSE 'running' END,
      finished_at = CASE WHEN made + $2 + failed + $3 >= wanted THEN now() ELSE NULL END
    WHERE id = $1`, [runId, made, failed, postId, error, note]);
}

export const runShape = (r) => ({
  id: r.id, scheduleId: r.schedule_id, scheduleName: r.schedule_name || null, trigger: r.trigger, status: r.status,
  wanted: r.wanted, made: r.made, failed: r.failed, postIds: r.post_ids || [], error: r.error || null, notes: r.notes || [],
  startedAt: iso(r.started_at), finishedAt: iso(r.finished_at),
});

/**
 * Start a run of schedule row `s` now (pending = posts_per_run). Cron runs pass { nextRun, expectNext } so the
 * claim is a compare-and-set on next_run_at. → run row | null when another run is in progress (or the cron lost).
 */
export async function startRun(env, s, trigger, { nextRun, expectNext } = {}) {
  const runId = crypto.randomUUID();
  const won = trigger === 'cron'
    ? await one(env, `UPDATE blog_schedules SET pending = posts_per_run, pending_run_id = $2, last_run_at = now(), next_run_at = $3::timestamptz, updated_at = now()
        WHERE id = $1 AND pending = 0 AND next_run_at = $4::timestamptz RETURNING *`, [s.id, runId, nextRun ? nextRun.toISOString() : null, new Date(expectNext).toISOString()])
    : await one(env, `UPDATE blog_schedules SET pending = posts_per_run, pending_run_id = $2, last_run_at = now(), updated_at = now()
        WHERE id = $1 AND pending = 0 RETURNING *`, [s.id, runId]);
  if (!won) return null;
  return one(env, `INSERT INTO blog_runs (id, schedule_id, trigger, status, wanted) VALUES ($1,$2,$3,'running',$4) RETURNING *`, [runId, s.id, trigger, won.posts_per_run]);
}

/** Write ONE post for a claimed slot of schedule row `s` (topic chosen by `cursor`). → post row (+ .flags) */
export async function writeForSchedule(env, s, cursor) {
  const sch = scheduleFromRow(s);
  const topic = topicFor(sch, cursor);
  const art = await writeArticle(env, { topic, prompt: sch.prompt, tone: sch.tone, length: sch.length });
  const settings = await getSettings(env);
  const publish = sch.publishMode === 'publish' && !art.flags.length;
  const row = await insertPost(env, {
    title: art.title, excerpt: art.excerpt, body: art.body, topic: topic || 'Devotional', tags: art.tags,
    status: publish ? 'published' : 'draft', author: settings.authorName, source: 'ai', scheduleId: s.id, runId: s.pending_run_id,
    seoDescription: art.seoDescription,
    reviewNote: art.flags.length ? `Held for review: ${art.flags.join(', ')}` : sch.publishMode === 'publish' ? null : 'AI draft — review and publish',
  });
  if (publish) await maybeNotify(env, row).catch((e) => console.warn('[blog] notify failed', e && e.message));
  row.flags = art.flags;
  row.dropped = art.dropped;
  return row;
}

/**
 * Generate posts for schedules that have pending slots, at most `budget` posts. Each slot is claimed atomically
 * (pending - 1, topic_cursor + 1) so overlapping workers never write the same slot twice. A quota error gives the
 * slot back and stops (the next tick resumes). → { made, failed, quota }
 */
export async function workPending(env, { budget = 2, scheduleId = null } = {}) {
  const out = { made: 0, failed: 0, quota: false, posts: [] };
  while (budget > 0) {
    const s = await one(env, `UPDATE blog_schedules SET pending = pending - 1, topic_cursor = topic_cursor + 1
      WHERE id = (SELECT id FROM blog_schedules WHERE pending > 0 AND ($1::uuid IS NULL OR id = $1::uuid) ORDER BY last_run_at NULLS FIRST, id LIMIT 1)
        AND pending > 0 RETURNING *, topic_cursor - 1 AS used_cursor`, [scheduleId]);
    if (!s) break;
    budget--;
    try {
      const post = await writeForSchedule(env, s, s.used_cursor);
      out.made++; out.posts.push(post);
      await bumpRun(env, s.pending_run_id, { made: 1, postId: post.id, note: post.flags.length ? `“${post.title}” held for review (${post.flags.join(', ')})` : post.dropped && post.dropped.length ? `“${post.title}”: dropped invalid references ${post.dropped.join(', ')}` : null });
    } catch (e) {
      if (isQuotaError(e)) {
        await q(env, 'UPDATE blog_schedules SET pending = pending + 1, topic_cursor = topic_cursor - 1 WHERE id = $1', [s.id]);
        await bumpRun(env, s.pending_run_id, { error: 'Workers AI daily limit reached — will continue on the next run' });
        out.quota = true;
        break;
      }
      out.failed++;
      console.warn('[blog] post failed', e && e.message);
      await bumpRun(env, s.pending_run_id, { failed: 1, error: String((e && e.message) || e).slice(0, 300) });
    }
  }
  return out;
}

/** Publish scheduled posts whose time has come (and queue their optional notification). */
export async function publishDue(env) {
  const rows = await q(env, `UPDATE blog_posts SET status = 'published', published_at = publish_at, updated_at = now()
    WHERE status = 'scheduled' AND publish_at <= now() RETURNING *`);
  for (const r of rows) await maybeNotify(env, r).catch((e) => console.warn('[blog] notify failed', e && e.message));
  return rows.length;
}

/**
 * Cron (every 15 min): publish due scheduled posts, claim due schedules (next_run_at moves forward with a
 * compare-and-set, so a run starts once), then write at most BLOG_CRON_POSTS (default 2) posts.
 */
export async function runBlogCron(env, { now = new Date() } = {}) {
  const out = { published: 0, started: 0, made: 0, failed: 0, errors: [] };
  try { out.published = await publishDue(env); } catch (e) { out.errors.push(`publish: ${e && e.message}`); }
  const due = await q(env, `SELECT * FROM blog_schedules WHERE active AND pending = 0 AND next_run_at IS NOT NULL AND next_run_at <= $1::timestamptz
    ORDER BY next_run_at LIMIT 10`, [now.toISOString()]);
  for (const s of due) {
    try {
      const next = nextRunAt(scheduleFromRow(s), now);
      const run = await startRun(env, s, 'cron', { nextRun: next, expectNext: s.next_run_at });
      if (run) out.started++;
    } catch (e) { out.errors.push(`start ${s.id}: ${e && e.message}`); }
  }
  const w = await workPending(env, { budget: num(env.BLOG_CRON_POSTS, 2) });
  out.made = w.made; out.failed = w.failed;
  if (out.published || out.started || out.made || out.failed || out.errors.length) console.log('[blog]', JSON.stringify(out));
  return out;
}
