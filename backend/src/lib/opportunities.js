// OPPORTUNITIES importer: pulls listings from outside sources into the `opportunities` table.
// Runs from the Worker cron (every 15 min); each source has its own minimum interval so we never
// hammer anyone. Every listing keeps the original URL and its source name — the sources' terms ask us to
// credit them and send applicants to their page (Remotive, Remote OK and Jobicy say so explicitly).
//
// Sources (all free, no API key):
//   remotive, remoteok, jobicy, arbeitnow       → remote work & jobs (+ internships when tagged)
//   grantsgov                                   → US federal grants (Grants.gov search2 API)
//   devpost                                     → hackathons (Devpost's public listing JSON — unofficial)
//   codeforces                                  → coding competitions (official Codeforces API)
//   opportunitydesk, opportunitiesforyouth, scholars4dev → scholarships, fellowships, grants,
//       competitions, conferences, internships (their public RSS feeds: headline + short excerpt + link)
import { q } from './db.js';

const UA = 'BibleNestra-opportunities/1.0 (+https://biblenestra.app)';
const HOUR = 3600e3;
const MAX_PER_SOURCE = 150;
const FETCH_TIMEOUT_MS = 15000;
const SOURCES_PER_RUN = 3; // keep each cron run short

export const KINDS = ['job', 'remote', 'internship', 'scholarship', 'fellowship', 'grant', 'hackathon', 'competition', 'volunteer', 'event', 'other'];
export const KIND_LABELS = {
  job: 'Jobs', remote: 'Remote work', internship: 'Internships', scholarship: 'Scholarships', fellowship: 'Fellowships',
  grant: 'Grants & funding', hackathon: 'Hackathons', competition: 'Competitions', volunteer: 'Volunteering', event: 'Events & conferences', other: 'More',
};

// ---------- small text helpers ----------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
export function decodeEntities(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => (ENTITIES[n.toLowerCase()] != null ? ENTITIES[n.toLowerCase()] : m));
}
export function plain(html, max = 600) {
  let s = String(html || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/h\d>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  // a description cut off mid-tag, and tags that were entity-encoded (&lt;p&gt;), are removed too
  s = decodeEntities(s.replace(/<[^>]*$/, ' ')).replace(/<\/?[a-z][^>]*>?/gi, ' ').replace(/\s+/g, ' ').trim();
  if (s.length > max) s = `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
  return s;
}
const clean = (s, max = 300) => plain(s, max) || null;
const toIso = (v) => {
  if (v == null || v === '') return null;
  const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const MONTHS = 'january february march april may june july august september october november december'.split(' ');
const MON3 = MONTHS.map((m) => m.slice(0, 3));
// "January 15, 2027" | "15 January 2027" | "Dec 04, 2026" → ISO (end of that day, UTC)
export function parseHumanDate(s) {
  if (!s) return null;
  const t = String(s).toLowerCase();
  let m = t.match(/([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/);
  let day; let mon; let year;
  if (m) { mon = MON3.indexOf(m[1].slice(0, 3)); day = Number(m[2]); year = Number(m[3]); }
  if (!m || mon < 0) {
    m = t.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s+(\d{4})/);
    if (!m) return null;
    day = Number(m[1]); mon = MON3.indexOf(m[2].slice(0, 3)); year = Number(m[3]);
  }
  if (mon < 0 || !day || day > 31 || year < 2000 || year > 2100) return null;
  return new Date(Date.UTC(year, mon, day, 23, 59, 0)).toISOString();
}
// "Deadline: January 15, 2027" / "Application deadline: 30 November 2026" inside a description
export function findDeadline(text) {
  const m = plain(text, 4000).match(/deadline[^:]{0,20}:\s*([^.;|]{6,40})/i);
  return m ? parseHumanDate(m[1]) : null;
}
// "Nov 30 - Dec 04, 2026" / "Oct 30, 2026 - Jan 05, 2027" → the end date
export function periodEnd(s) {
  if (!s) return null;
  const parts = String(s).split(/\s+-\s+/);
  const end = parts[parts.length - 1];
  const yearOnly = (String(s).match(/(\d{4})\s*$/) || [])[1];
  return parseHumanDate(/\d{4}/.test(end) ? end : `${end}, ${yearOnly}`);
}
const lower = (a) => (a || []).map((x) => String(x).toLowerCase());
const hasAny = (list, words) => list.some((t) => words.some((w) => t.includes(w)));

// ---------- source adapters: raw response → normalized items ----------
// item = { source_id, kind, title, org, location, remote, url, excerpt, tags[], deadline, posted_at, salary }

function remotive(data) {
  return (data.jobs || []).map((j) => {
    const type = String(j.job_type || '').toLowerCase();
    return {
      source_id: String(j.id),
      kind: type.includes('intern') ? 'internship' : 'remote',
      title: clean(j.title, 200),
      org: clean(j.company_name, 120),
      location: clean(j.candidate_required_location, 120) || 'Worldwide',
      remote: true,
      url: j.url,
      excerpt: plain(j.description),
      tags: [j.category, ...(j.tags || [])].filter(Boolean).slice(0, 8).map(String),
      deadline: null,
      posted_at: toIso(j.publication_date),
      salary: clean(j.salary, 80),
    };
  });
}

function remoteok(data) {
  return (Array.isArray(data) ? data : []).filter((j) => j && j.id && j.position).map((j) => {
    const tags = lower(j.tags);
    const money = j.salary_min && j.salary_max ? `$${Math.round(j.salary_min / 1000)}k – $${Math.round(j.salary_max / 1000)}k / year` : null;
    return {
      source_id: String(j.id),
      kind: hasAny(tags, ['intern']) ? 'internship' : 'remote',
      title: clean(j.position, 200),
      org: clean(j.company, 120),
      location: clean(j.location, 120) || 'Worldwide',
      remote: true,
      url: j.url || `https://remoteok.com/remote-jobs/${j.slug}`, // their ToS: link back to the Remote OK page
      excerpt: plain(j.description),
      tags: (j.tags || []).slice(0, 8).map(String),
      deadline: null,
      posted_at: toIso(j.date || j.epoch),
      salary: money,
    };
  });
}

function jobicy(data) {
  return (data.jobs || []).map((j) => {
    const level = String(j.jobLevel || '').toLowerCase();
    const money = j.salaryMin && j.salaryMax ? `${j.salaryCurrency || ''} ${j.salaryMin.toLocaleString('en-US')} – ${j.salaryMax.toLocaleString('en-US')}${j.salaryPeriod ? ` / ${j.salaryPeriod}` : ''}`.trim() : null;
    return {
      source_id: String(j.id),
      kind: level.includes('intern') ? 'internship' : 'remote',
      title: clean(j.jobTitle, 200),
      org: clean(j.companyName, 120),
      location: clean(j.jobGeo, 120) || 'Anywhere',
      remote: true,
      url: j.url,
      excerpt: plain(j.jobExcerpt || j.jobDescription),
      tags: [...(j.jobIndustry || []), ...(j.jobType || []), j.jobLevel].filter(Boolean).slice(0, 8).map((t) => decodeEntities(String(t))),
      deadline: null,
      posted_at: toIso(j.pubDate),
      salary: money,
    };
  });
}

function arbeitnow(data) {
  return (data.data || []).map((j) => {
    const types = lower(j.job_types);
    const intern = hasAny(types, ['intern', 'praktikum', 'werkstudent', 'trainee']);
    return {
      source_id: String(j.slug),
      kind: intern ? 'internship' : j.remote ? 'remote' : 'job',
      title: clean(j.title, 200),
      org: clean(j.company_name, 120),
      location: clean(j.location, 120),
      remote: !!j.remote,
      url: j.url,
      excerpt: plain(j.description),
      tags: [...(j.tags || []), ...(j.job_types || [])].slice(0, 8).map(String),
      deadline: null,
      posted_at: toIso(j.created_at),
      salary: null,
    };
  });
}

// Grants.gov dates are MM/DD/YYYY
const usDate = (s) => {
  const m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), 23, 59)).toISOString() : null;
};
function grantsgov(data) {
  return ((data.data || {}).oppHits || []).map((g) => ({
    source_id: String(g.id),
    kind: 'grant',
    title: clean(g.title, 200),
    org: clean(g.agency, 120),
    location: 'United States (federal)',
    remote: false,
    url: `https://www.grants.gov/search-results-detail/${encodeURIComponent(g.id)}`,
    excerpt: [g.number && `Opportunity ${g.number}`, g.agency && `from ${g.agency}`].filter(Boolean).join(' '),
    tags: [g.docType, ...(g.cfdaList || []).map((c) => `CFDA ${c}`)].filter(Boolean).slice(0, 6).map(String),
    deadline: usDate(g.closeDate),
    posted_at: usDate(g.openDate),
    salary: null,
  }));
}

function devpost(data) {
  return (data.hackathons || []).filter((h) => h && h.id && !h.invite_only).map((h) => {
    const where = (h.displayed_location && h.displayed_location.location) || 'Online';
    const prize = plain(h.prize_amount, 40);
    return {
      source_id: String(h.id),
      kind: 'hackathon',
      title: clean(h.title, 200),
      org: clean(h.organization_name, 120),
      location: where,
      remote: /online/i.test(where),
      url: h.url,
      excerpt: [h.submission_period_dates && `Submissions: ${h.submission_period_dates}.`, h.registrations_count ? `${h.registrations_count.toLocaleString('en-US')} registered.` : null].filter(Boolean).join(' '),
      tags: (h.themes || []).map((t) => t.name).filter(Boolean).slice(0, 6),
      deadline: periodEnd(h.submission_period_dates),
      posted_at: null,
      salary: prize && prize !== '$0' ? `Prizes: ${prize}` : null,
    };
  });
}

function codeforces(data) {
  return (data.result || []).filter((c) => c.phase === 'BEFORE' && c.startTimeSeconds).map((c) => ({
    source_id: String(c.id),
    kind: 'competition',
    title: clean(c.name, 200),
    org: 'Codeforces',
    location: 'Online',
    remote: true,
    url: `https://codeforces.com/contests/${c.id}`,
    excerpt: `Online programming contest (${c.type}). Starts ${new Date(c.startTimeSeconds * 1000).toUTCString().replace(':00 GMT', ' UTC')}, lasts ${Math.round(c.durationSeconds / 60)} minutes. Register on Codeforces before it starts.`,
    tags: ['Programming', c.type].filter(Boolean),
    deadline: toIso(c.startTimeSeconds),
    posted_at: null,
    salary: null,
  }));
}

// RSS (WordPress feeds): kind from the post's categories, deadline from "Deadline: …" in the text.
const RSS_KIND_RULES = [
  ['hackathon', ['hackathon']],
  ['internship', ['internship', 'graduate trainee', 'traineeship']],
  ['fellowship', ['fellowship']],
  ['scholarship', ['scholarship', 'phd', 'postdoc', 'masters', 'undergraduate', 'study abroad', 'bursar']],
  ['grant', ['grant', 'funding', 'fund ', 'accelerator', 'incubat', 'startup']],
  ['competition', ['competition', 'award', 'prize', 'contest', 'challenge']],
  ['volunteer', ['volunteer']],
  ['event', ['conference', 'summit', 'forum', 'workshop', 'training', 'event', 'delegate', 'exchange', 'camp']],
  ['job', ['job', 'vacanc', 'career', 'recruit']],
];
export function kindFromWords(words, fallback = 'other') {
  const list = lower(words);
  for (const [kind, keys] of RSS_KIND_RULES) if (hasAny(list, keys)) return kind;
  return fallback;
}
function tagValue(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '';
}
export function parseRss(xml, { org, fallbackKind = 'other' } = {}) {
  const items = String(xml || '').match(/<item>[\s\S]*?<\/item>/g) || [];
  return items.map((it) => {
    const title = decodeEntities(tagValue(it, 'title'));
    const link = tagValue(it, 'link');
    const guid = tagValue(it, 'guid') || link;
    const cats = [...it.matchAll(/<category>([\s\S]*?)<\/category>/g)].map((m) => decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()));
    const descHtml = tagValue(it, 'description').replace(/<p>The post [\s\S]*$/i, '');
    const excerpt = plain(descHtml).replace(/\s*The post .* (first )?appeared (first )?on .*$/i, '');
    // Generic place tags ("Africa", "Europe") are kept as tags but don't decide the kind
    // the title is the best signal; the post categories decide only when the title says nothing
    const kind = kindFromWords([title], null) || kindFromWords(cats, fallbackKind);
    const remote = /online|virtual|remote/i.test(`${title} ${cats.join(' ')}`);
    return {
      source_id: guid.slice(0, 300),
      kind,
      title: clean(title, 200),
      org,
      location: null,
      remote,
      url: link,
      excerpt,
      tags: cats.filter((c) => c.length <= 40).slice(0, 8),
      deadline: findDeadline(tagValue(it, 'description')),
      posted_at: toIso(tagValue(it, 'pubDate')),
      salary: null,
    };
  });
}

// ---------- the source list ----------
const getJson = (url) => ({ url, parse: (t) => JSON.parse(t) });
export const SOURCES = [
  { key: 'remotive', name: 'Remotive', site: 'https://remotive.com', kinds: ['remote', 'internship'], everyH: 6, ...getJson('https://remotive.com/api/remote-jobs?limit=150'), adapt: remotive },
  { key: 'remoteok', name: 'Remote OK', site: 'https://remoteok.com', kinds: ['remote'], everyH: 6, ...getJson('https://remoteok.com/api'), adapt: remoteok },
  { key: 'jobicy', name: 'Jobicy', site: 'https://jobicy.com', kinds: ['remote', 'internship'], everyH: 6, ...getJson('https://jobicy.com/api/v2/remote-jobs?count=100'), adapt: jobicy },
  { key: 'arbeitnow', name: 'Arbeitnow', site: 'https://www.arbeitnow.com', kinds: ['job', 'remote', 'internship'], everyH: 6, ...getJson('https://www.arbeitnow.com/api/job-board-api'), adapt: arbeitnow },
  {
    key: 'grantsgov', name: 'Grants.gov', site: 'https://www.grants.gov', kinds: ['grant'], everyH: 12,
    url: 'https://api.grants.gov/v1/api/search2', method: 'POST', body: { rows: 100, oppStatuses: 'forecasted|posted', sortBy: 'openDate|desc' },
    parse: (t) => JSON.parse(t), adapt: grantsgov,
  },
  { key: 'devpost', name: 'Devpost', site: 'https://devpost.com/hackathons', kinds: ['hackathon'], everyH: 6, ...getJson('https://devpost.com/api/hackathons?status[]=open&status[]=upcoming'), adapt: devpost },
  { key: 'codeforces', name: 'Codeforces', site: 'https://codeforces.com/contests', kinds: ['competition'], everyH: 12, ...getJson('https://codeforces.com/api/contest.list?gym=false'), adapt: codeforces },
  { key: 'opportunitydesk', name: 'Opportunity Desk', site: 'https://opportunitydesk.org', kinds: ['scholarship', 'fellowship', 'grant', 'competition', 'event', 'internship'], everyH: 3, url: 'https://opportunitydesk.org/feed/', parse: (t) => t, adapt: (x) => parseRss(x, { org: null, fallbackKind: 'other' }) },
  { key: 'opportunitiesforyouth', name: 'Opportunities for Youth', site: 'https://opportunitiesforyouth.org', kinds: ['scholarship', 'fellowship', 'event', 'volunteer', 'competition', 'internship'], everyH: 3, url: 'https://opportunitiesforyouth.org/feed/', parse: (t) => t, adapt: (x) => parseRss(x, { org: null, fallbackKind: 'other' }) },
  { key: 'scholars4dev', name: 'Scholars4Dev', site: 'https://www.scholars4dev.com', kinds: ['scholarship', 'fellowship'], everyH: 6, url: 'https://www.scholars4dev.com/feed/', parse: (t) => t, adapt: (x) => parseRss(x, { org: null, fallbackKind: 'scholarship' }) },
];
export const sourceByKey = (k) => SOURCES.find((s) => s.key === k);

// Keep only well-formed items (http(s) url, a title, a known kind)
export function validItems(items) {
  const seen = new Set();
  return (items || []).filter((x) => {
    if (!x || !x.source_id || !x.title || !/^https?:\/\//i.test(x.url || '') || !KINDS.includes(x.kind)) return false;
    if (seen.has(x.source_id)) return false;
    seen.add(x.source_id);
    return true;
  }).slice(0, MAX_PER_SOURCE);
}

async function fetchText(src, fetchImpl) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    const res = await fetchImpl(src.url, {
      method: src.method || 'GET',
      headers: { 'User-Agent': UA, Accept: 'application/json, application/rss+xml, text/xml;q=0.9, */*;q=0.5', ...(src.body ? { 'Content-Type': 'application/json' } : {}) },
      body: src.body ? JSON.stringify(src.body) : undefined,
      signal: ctl ? ctl.signal : undefined,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { if (timer) clearTimeout(timer); }
}

/** Upserts one source's items in a single statement. → number of rows written */
export async function saveItems(env, source, items) {
  if (!items.length) return 0;
  const rows = items.map((x) => ({ ...x, source, tags: (x.tags || []).map((t) => String(t).slice(0, 40)) }));
  const r = await q(env, `
    INSERT INTO opportunities (source, source_id, kind, title, org, location, remote, url, excerpt, tags, deadline, posted_at, salary)
    SELECT x.source, x.source_id, x.kind, x.title, x.org, x.location, COALESCE(x.remote, false), x.url, x.excerpt, COALESCE(x.tags, '{}'), x.deadline, x.posted_at, x.salary
    FROM json_to_recordset($1::json) AS x(source text, source_id text, kind text, title text, org text, location text, remote boolean,
      url text, excerpt text, tags text[], deadline timestamptz, posted_at timestamptz, salary text)
    ON CONFLICT (source, source_id) DO UPDATE SET
      kind = EXCLUDED.kind, title = EXCLUDED.title, org = EXCLUDED.org, location = EXCLUDED.location, remote = EXCLUDED.remote,
      url = EXCLUDED.url, excerpt = EXCLUDED.excerpt, tags = EXCLUDED.tags, deadline = EXCLUDED.deadline,
      posted_at = COALESCE(EXCLUDED.posted_at, opportunities.posted_at), salary = EXCLUDED.salary, updated_at = now()
    RETURNING id`, [JSON.stringify(rows)]);
  return r.length;
}

/** Imports one source now (records success/failure in opportunity_sources). → { key, count } or { key, error } */
export async function importSource(env, key, { fetchImpl = fetch } = {}) {
  const src = sourceByKey(key);
  if (!src) throw new Error(`Unknown source ${key}`);
  await q(env, `INSERT INTO opportunity_sources (key, last_run_at) VALUES ($1, now())
    ON CONFLICT (key) DO UPDATE SET last_run_at = now()`, [key]);
  try {
    const raw = src.parse(await fetchText(src, fetchImpl));
    const items = validItems(src.adapt(raw));
    const count = await saveItems(env, key, items);
    // listings without a date are dated when we first see them, so 'newest first' still makes sense
    if (items.some((x) => !x.posted_at)) {
      await q(env, `UPDATE opportunities SET posted_at = created_at WHERE source = $1 AND posted_at IS NULL`, [key]);
    }
    await q(env, `UPDATE opportunity_sources SET last_ok_at = now(), last_error = NULL, last_count = $2 WHERE key = $1`, [key, count]);
    return { key, count };
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 300);
    await q(env, `UPDATE opportunity_sources SET last_error = $2 WHERE key = $1`, [key, msg]);
    console.error('[opportunities] import failed', key, msg);
    return { key, error: msg };
  }
}

/** Removes listings whose deadline has passed, or that are old and undated. */
export async function pruneOpportunities(env) {
  const r = await q(env, `DELETE FROM opportunities
    WHERE (deadline IS NOT NULL AND deadline < now() - interval '1 day')
       OR (deadline IS NULL AND COALESCE(posted_at, created_at) < now() - interval '45 days')
    RETURNING id`);
  return r.length;
}

/** Cron entry: imports the sources that are due (oldest first, a few per run), then prunes. */
export async function runOpportunityCron(env, { fetchImpl = fetch, now = Date.now(), limit = SOURCES_PER_RUN } = {}) {
  const state = await q(env, `SELECT key, enabled, last_run_at FROM opportunity_sources`);
  const byKey = Object.fromEntries(state.map((s) => [s.key, s]));
  const due = SOURCES
    .filter((s) => !byKey[s.key] || byKey[s.key].enabled)
    .filter((s) => { const last = byKey[s.key] && byKey[s.key].last_run_at; return !last || now - new Date(last).getTime() >= s.everyH * HOUR; })
    .sort((a, b) => new Date((byKey[a.key] || {}).last_run_at || 0) - new Date((byKey[b.key] || {}).last_run_at || 0))
    .slice(0, limit);
  const results = [];
  for (const s of due) results.push(await importSource(env, s.key, { fetchImpl })); // eslint-disable-line no-await-in-loop
  let pruned = 0;
  try { pruned = await pruneOpportunities(env); } catch (e) { console.error('[opportunities] prune failed', e && e.message); }
  return { results, pruned };
}

export const _adapters = { remotive, remoteok, jobicy, arbeitnow, grantsgov, devpost, codeforces };
