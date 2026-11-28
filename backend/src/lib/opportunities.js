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
// JOBS FEEDS (round 2, see scratch/jobs-integrations.md):
//   himalayas, workingnomads                    → remote jobs (Himalayas filtered to jobs open to Nigeria)
//   myjobmag, hotnigerianjobs, jobzilla         → Nigerian jobs (public RSS)
//   andela, turing, welodata, mercor, invisible → AI/tech companies' official public ATS job boards
//   academicjobsonline, cscuk                   → academic jobs (AJO RSS) and Commonwealth Scholarships (WP REST)
//   weworkremotely, timeshighered, chronicle, academiccareers, naturecareers, sciencecareers
//                                               → OFF by default: their terms need written permission first
//   jooble (JOOBLE_API_KEY), freelancer (FREELANCER_OAUTH_TOKEN) → only run once the key is set
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
/** Full description (Opportunity detail): HTML → readable plain text that keeps paragraphs ("\n\n") and list items ("• ").
 *  Long text is cut at a paragraph boundary near `max` characters. */
export function richText(html, max = 30000) {
  let s = String(html || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  if (/&lt;\/?[a-z]/i.test(s)) s = decodeEntities(s); // entity-encoded markup (&lt;p&gt;) is markup too
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h\d|ul|ol|li|blockquote|tr)\s*>/gi, '\n\n')
    .replace(/<\/?[a-z!][^>]*>/gi, ' ')
    .replace(/<\/?[a-z][^>]*$/i, ' ');
  s = decodeEntities(s).replace(/ /g, ' ');
  const lines = s.split('\n').map((l) => l.replace(/\s+/g, ' ').trim());
  let out = lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n• \n/g, '\n').trim();
  // bullets: one space after the dot, no blank lines between items (a paragraph before a list keeps its gap)
  out = out.replace(/(^|\n)•\s*/g, '$1• ').replace(/(• [^\n]*)\n\n(?=• )/g, '$1\n');
  if (out.length > max) {
    const cut = out.slice(0, max);
    const at = cut.lastIndexOf('\n\n');
    out = `${(at > max * 0.5 ? cut.slice(0, at) : cut.replace(/\s+\S*$/, '')).trim()}…`;
  }
  return out || null;
}
/** Only http(s) links are shown in the app (logos, apply buttons). */
export const httpUrl = (u) => (/^https?:\/\/[^\s]+$/i.test(String(u || '')) ? String(u).slice(0, 2000) : null);
const SECTION_HEAD = /^(key )?(responsibilities|duties|what you(’|')ll do|what you will do|your role|role responsibilities|qualifications|requirements|what we(’|')re looking for|who you are|skills|how to apply|application instructions|instructions|to apply)\b.*$/i;
/** Pulls the usual headed sections out of a plain description: responsibilities, qualifications, instructions. */
export function sectionsFrom(text) {
  const out = { responsibilities: null, qualifications: null, instructions: null };
  if (!text) return out;
  const map = (h) => (/responsib|duties|do$|your role|role responsib/i.test(h) ? 'responsibilities'
    : /qualif|requirement|looking for|who you are/i.test(h) ? 'qualifications'
      : /apply|instruction/i.test(h) ? 'instructions' : null);
  let cur = null;
  const buf = { responsibilities: [], qualifications: [], instructions: [] };
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const head = line.replace(/:$/, '');
    if (SECTION_HEAD.test(head) && head.length <= 80) { cur = map(head); continue; }
    if (cur) buf[cur].push(line);
  }
  for (const k of Object.keys(out)) out[k] = buf[k].length ? buf[k].join('\n').slice(0, 8000) : null;
  return out;
}
/** Full-detail fields for one listing row (GET /opportunities/:id). Missing values are null, and the app hides those rows.
 *  The sources give no separate skills list, so `skills` is null for now (and always hidden). */
export function detailFields(o) {
  const pick = (v) => (v === null || v === undefined || v === '' ? null : v);
  const sec = sectionsFrom(o.description);
  return {
    description: pick(o.description) || pick(o.excerpt),
    responsibilities: sec.responsibilities,
    qualifications: sec.qualifications,
    instructions: sec.instructions,
    skills: null,
    employmentType: pick(o.employment_type),
    logoUrl: httpUrl(o.logo_url),
    applyUrl: httpUrl(o.apply_url) || httpUrl(o.url),
  };
}
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
      description: richText(j.description),
      employment_type: clean(j.job_type, 60),
      logo_url: httpUrl(j.company_logo),
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
      description: richText(j.description),
      logo_url: httpUrl(j.company_logo || j.logo),
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
      description: richText(j.jobDescription || j.jobExcerpt),
      employment_type: Array.isArray(j.jobType) ? clean(j.jobType.join(', '), 60) : null,
      logo_url: httpUrl(j.companyLogo),
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
      description: richText(j.description),
      employment_type: clean((j.job_types || []).join(', '), 60),
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
      description: richText(descHtml),
      tags: cats.filter((c) => c.length <= 40).slice(0, 8),
      deadline: findDeadline(tagValue(it, 'description')),
      posted_at: toIso(tagValue(it, 'pubDate')),
      salary: null,
    };
  });
}

// ---------- JOBS FEEDS (round 2): helpers for the 51-platform integration ----------
// open_to: who can apply, where the data says so → 'nigeria' | 'africa' | 'worldwide' | null (unknown)
const NG_RE = /\bnigeria|\blagos\b|\babuja\b|port harcourt|\bibadan\b|\bkano\b|\benugu\b|\bkaduna\b|\bowerri\b|\buyo\b/i;
const AF_RE = /\bafrica|\bemea\b|\bkenya|\bghana|\begypt|\brwanda|\buganda|\bethiopia|\bsenegal|\bmorocco|\btanzania|\bcameroon|\bzambia|\bzimbabwe|\bbotswana|\bnamibia|\bivory coast|c[ôo]te d.ivoire|\bmalawi|\bmozambique|\btunisia|\balgeria|\bsierra leone|\bliberia|\bgambia|\bbenin\b|\btogo\b/i;
const WW_RE = /\bworld ?wide\b|\banywhere\b|\bglobal(ly)?\b|\ball countries\b|\binternational\b/i;
const NOT_WW_RE = /anywhere in (the )?(us|usa|u\.s\.?|united states|uk|united kingdom|canada|europe|eu|latam|americas|north america)\b/i;
export function openToFrom(text, fallback = null) {
  const t = String(text || '');
  if (NG_RE.test(t)) return 'nigeria';
  if (AF_RE.test(t)) return 'africa';
  if (WW_RE.test(t) && !NOT_WW_RE.test(t)) return 'worldwide';
  return fallback;
}
export const OPEN_TO = ['nigeria', 'africa', 'worldwide'];
const AFRICA_ISO2 = new Set('DZ AO BJ BW BF BI CV CM CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU MA MZ NA NE NG RW ST SN SC SL SO ZA SS SD TZ TG TN UG ZM ZW'.split(' '));
const openToIso2 = (cc) => { const c = String(cc || '').toUpperCase(); return c === 'NG' ? 'nigeria' : AFRICA_ISO2.has(c) ? 'africa' : null; };

const INTERN_RE = /\bintern(ship)?s?\b|graduate trainee|traineeship|\bnysc\b|\bsiwes\b|industrial training/i;
const jobKind = (title, remote) => (INTERN_RE.test(title || '') ? 'internship' : remote ? 'remote' : 'job');
// academic/research titles: PhD studentships → scholarship, postdocs & fellowships → fellowship, else job
const academicKind = (title) => (/\bph\.?d\b|doctoral|studentship/i.test(title || '') && !/post-?doc/i.test(title || '') ? 'scholarship' : /post-?doc|fellow/i.test(title || '') ? 'fellowship' : 'job');
const idFrom = (url, re) => { const m = String(url || '').match(re); return m ? m[1] : null; };
// Every <item …>…</item> block (RSS 2.0 and RSS 1.0/RDF, where items carry rdf:about)
const rssBlocks = (xml) => String(xml || '').match(/<item[\s>][\s\S]*?<\/item>/g) || [];
const txt = (block, tag) => decodeEntities(tagValue(block, tag));
const money = (min, max, cur, per) => {
  if (!min && !max) return null;
  const f = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return `${cur ? `${cur} ` : ''}${min && max && min !== max ? `${f(min)} – ${f(max)}` : f(min || max)}${per ? ` / ${per}` : ''}`;
};

// Himalayas (/jobs/api/search?country=Nigeria): jobs whose locationRestrictions allow Nigeria (empty = worldwide)
function himalayas(data) {
  return (data.jobs || []).filter((j) => j && j.title && (j.applicationLink || j.guid)).map((j) => {
    const places = (j.locationRestrictions || []).map((x) => (typeof x === 'string' ? x : (x && (x.name || x.alpha2)) || '')).filter(Boolean);
    const openTo = !places.length ? 'worldwide' : places.some((p) => /^(nigeria|ng)$/i.test(p)) ? 'nigeria' : openToFrom(places.join(' '), null);
    return {
      source_id: String(j.guid || j.applicationLink),
      kind: /intern/i.test(j.employmentType || '') ? 'internship' : 'remote',
      title: clean(j.title, 200),
      org: clean(j.companyName, 120),
      location: places.length ? clean(places.join(', '), 120) : 'Worldwide',
      remote: true,
      url: j.applicationLink || j.guid, // Himalayas' terms: the apply button must use applicationLink
      excerpt: plain(j.excerpt || j.description),
      description: richText(j.description || j.excerpt),
      tags: [...(j.parentCategories || []), ...(j.seniority || []), j.employmentType].filter(Boolean).slice(0, 8).map((t) => String(t).replace(/-/g, ' ')),
      deadline: toIso(j.expiryDate),
      posted_at: toIso(j.pubDate),
      salary: money(j.minSalary, j.maxSalary, j.currency, j.salaryPeriod === 'annual' ? 'year' : j.salaryPeriod),
      open_to: openTo,
    };
  });
}

// Working Nomads (/api/exposed_jobs/): plain JSON array
function workingnomads(data) {
  return (Array.isArray(data) ? data : []).filter((j) => j && j.url && j.title).map((j) => ({
    source_id: idFrom(j.url, /\/job\/go\/(\d+)/) || j.url,
    kind: jobKind(j.title, true),
    title: clean(j.title, 200),
    org: clean(j.company_name, 120),
    location: clean(j.location, 120) || 'Remote',
    remote: true,
    url: j.url,
    excerpt: plain(j.description),
    description: richText(j.description),
    tags: [j.category_name, ...String(j.tags || '').split(',')].map((t) => String(t || '').trim()).filter(Boolean).slice(0, 8),
    deadline: null,
    posted_at: toIso(j.pub_date),
    salary: null,
    open_to: openToFrom(j.location),
  }));
}

// We Work Remotely RSS ("Company: Title", <region>, <expires_at>) — OFF until WWR gives written permission
function weworkremotely(xml) {
  return rssBlocks(xml).map((it) => {
    const raw = txt(it, 'title');
    const i = raw.indexOf(': ');
    const region = txt(it, 'region');
    const link = tagValue(it, 'link');
    return {
      source_id: tagValue(it, 'guid') || link,
      kind: jobKind(raw, true),
      title: clean(i > 0 ? raw.slice(i + 2) : raw, 200),
      org: i > 0 ? clean(raw.slice(0, i), 120) : null,
      location: clean(region, 120) || 'Remote',
      remote: true,
      url: link,
      excerpt: plain(tagValue(it, 'description')),
      description: richText(tagValue(it, 'description')),
      tags: [txt(it, 'category'), txt(it, 'type')].filter(Boolean),
      deadline: toIso(tagValue(it, 'expires_at')),
      posted_at: toIso(tagValue(it, 'pubDate')),
      salary: null,
      open_to: openToFrom(region),
    };
  });
}

// MyJobMag (/jobsxml_by_categories.xml): Nigerian jobs with company, location and sometimes an expiry date
function myjobmag(xml) {
  return rssBlocks(xml).map((it) => {
    const link = tagValue(it, 'link');
    const title = txt(it, 'position') || txt(it, 'title');
    const location = txt(it, 'location');
    return {
      source_id: idFrom(link, /[?&]id=(\d+)/) || tagValue(it, 'guid') || link,
      kind: jobKind(title, /remote/i.test(`${title} ${location}`)),
      title: clean(title, 200),
      org: clean(txt(it, 'company'), 120),
      location: location && !/^all$/i.test(location) ? clean(`${location}, Nigeria`, 120) : 'Nigeria',
      remote: /remote/i.test(`${title} ${location}`),
      url: link,
      excerpt: plain(tagValue(it, 'description')),
      description: richText(tagValue(it, 'description')),
      tags: [txt(it, 'industry')].filter(Boolean),
      deadline: toIso(tagValue(it, 'expiryDate')),
      posted_at: toIso(tagValue(it, 'pubDate')),
      salary: null,
      open_to: 'nigeria',
    };
  });
}

// Hot Nigerian Jobs (/feed/rss.xml): title + text excerpt + link; place is in the text ("located in Ibadan, Oyo State")
function hotnigerianjobs(xml) {
  return rssBlocks(xml).map((it) => {
    const link = tagValue(it, 'link');
    const title = txt(it, 'title');
    const desc = plain(tagValue(it, 'description'), 4000);
    const where = (desc.match(/located (?:in|at) ([^.;]{3,60})[.;]/i) || [])[1];
    const m = title.match(/^(.*?) at (.+)$/);
    return {
      source_id: idFrom(link, /\/hotjobs\/(\d+)\//) || link,
      kind: jobKind(title, /remote/i.test(title)),
      title: clean(title, 200),
      org: m ? clean(m[2], 120) : null,
      location: where ? clean(`${where}, Nigeria`, 120) : 'Nigeria',
      remote: /remote/i.test(title),
      url: link,
      excerpt: plain(desc, 600),
      description: richText(desc),
      tags: [],
      deadline: null,
      posted_at: toIso(tagValue(it, 'pubDate')),
      salary: null,
      open_to: 'nigeria',
    };
  });
}

// Jobzilla (/feed): pubDate is "YYYY-MM-DD HH:MM:SS" Lagos time
const lagosTime = (s) => (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(String(s).trim()) ? toIso(`${String(s).trim().replace(' ', 'T')}+01:00`) : toIso(s));
function jobzilla(xml) {
  return rssBlocks(xml).map((it) => {
    const link = tagValue(it, 'link');
    const title = txt(it, 'title');
    const m = title.match(/^(.*?) at (.+)$/);
    return {
      source_id: idFrom(link, /-(\d+)\/?$/) || tagValue(it, 'guid') || link,
      kind: jobKind(title, /remote/i.test(title)),
      title: clean(title, 200),
      org: m ? clean(m[2], 120) : null,
      location: 'Nigeria',
      remote: /remote/i.test(title),
      url: link,
      excerpt: plain(tagValue(it, 'description')),
      description: richText(tagValue(it, 'description')),
      tags: [],
      deadline: null,
      posted_at: lagosTime(tagValue(it, 'pubDate')),
      salary: null,
      open_to: 'nigeria',
    };
  });
}

// Greenhouse public Job Board API (boards-api.greenhouse.io/v1/boards/<token>/jobs?content=true)
function greenhouse(data, { org } = {}) {
  return (data.jobs || []).filter((j) => j && j.id && j.absolute_url).map((j) => {
    const loc = (j.location && j.location.name) || '';
    const remote = /remote|anywhere/i.test(loc);
    return {
      source_id: String(j.id),
      kind: jobKind(j.title, remote),
      title: clean(j.title, 200),
      org: clean(j.company_name || org, 120),
      location: clean(loc, 120),
      remote,
      url: j.absolute_url,
      excerpt: plain(j.content),
      description: richText(j.content),
      tags: (j.departments || []).map((d) => d && d.name).filter(Boolean).slice(0, 4),
      deadline: toIso(j.application_deadline),
      posted_at: toIso(j.first_published || j.updated_at),
      salary: null,
      open_to: openToFrom(loc, remote && /anywhere|worldwide|global/i.test(loc) ? 'worldwide' : null),
    };
  });
}

// Ashby public Job Posting API (api.ashbyhq.com/posting-api/job-board/<name>)
function ashby(data, { org, remoteOnly = false } = {}) {
  return (data.jobs || []).filter((j) => j && j.id && j.jobUrl && j.isListed !== false && (!remoteOnly || j.isRemote)).map((j) => {
    const where = [j.location, ...(j.secondaryLocations || []).map((s) => s && s.location)].filter(Boolean).join(', ');
    const country = j.address && j.address.postalAddress && j.address.postalAddress.addressCountry;
    return {
      source_id: String(j.id),
      kind: /intern/i.test(j.employmentType || '') ? 'internship' : jobKind(j.title, !!j.isRemote),
      title: clean(j.title, 200),
      org,
      location: clean(where || country, 120),
      remote: !!j.isRemote,
      url: j.jobUrl,
      excerpt: plain(j.descriptionPlain || j.descriptionHtml),
      description: richText(j.descriptionHtml || j.descriptionPlain),
      employment_type: clean(j.employmentType, 60),
      apply_url: httpUrl(j.applyUrl),
      tags: [j.department, j.team, j.employmentType].filter(Boolean).slice(0, 4),
      deadline: null,
      posted_at: toIso(j.publishedAt),
      salary: clean(j.compensation && j.compensation.scrapeableCompensationSalarySummary, 80),
      open_to: openToFrom(`${where} ${country || ''}`),
    };
  });
}

// Lever public Postings API (api.lever.co/v0/postings/<company>?mode=json)
function lever(data, { org } = {}) {
  return (Array.isArray(data) ? data : []).filter((j) => j && j.id && j.hostedUrl).map((j) => {
    const cat = j.categories || {};
    const places = cat.allLocations && cat.allLocations.length ? cat.allLocations.join(', ') : cat.location || '';
    const remote = j.workplaceType === 'remote' || /remote/i.test(cat.commitment || '');
    return {
      source_id: String(j.id),
      kind: jobKind(j.text, remote),
      title: clean(j.text, 200),
      org,
      location: clean(places, 120),
      remote,
      url: j.hostedUrl,
      excerpt: plain(j.descriptionPlain || j.description),
      description: richText(j.description || j.descriptionPlain),
      apply_url: httpUrl(j.applyUrl),
      tags: [cat.team, cat.commitment].filter(Boolean),
      deadline: null,
      posted_at: toIso(j.createdAt),
      salary: null,
      open_to: openToIso2(j.country) || openToFrom(places),
    };
  });
}

// Academic Jobs Online (RSS 1.0 with ads:* fields: university, country, deadline, apply link)
function academicjobsonline(xml) {
  return rssBlocks(xml).map((it) => {
    const link = tagValue(it, 'link');
    const title = txt(it, 'title');
    const country = tagValue(it, 'ads:Country');
    const place = [txt(it, 'ads:City'), country].filter(Boolean).join(', ');
    return {
      source_id: tagValue(it, 'ads:ID') || link,
      kind: academicKind(title),
      title: clean(title, 200),
      org: clean([txt(it, 'ads:Univ') || txt(it, 'dc:creator'), txt(it, 'ads:Dept')].filter(Boolean).join(' · '), 160),
      location: clean(place, 120),
      remote: false,
      url: link,
      excerpt: plain(tagValue(it, 'description'), 400), // short summary only — full ad stays on AJO
      tags: txt(it, 'ads:Disciplines').split(';').map((s) => s.trim()).filter(Boolean).slice(0, 6),
      deadline: toIso(tagValue(it, 'ads:Deadline')),
      posted_at: toIso(tagValue(it, 'dc:date') || tagValue(it, 'ads:PostDate')),
      salary: null,
      open_to: openToIso2(country),
    };
  });
}

// Madgex job boards (Nature Careers, Science Careers, THE unijobs, Chronicle): "Employer: Title"; the
// description is "salary:\n\nEmployer:\n text…\nLocation". All OFF until the publisher gives permission.
export function madgex(xml) {
  return rssBlocks(xml).map((it) => {
    const raw = txt(it, 'title');
    const i = raw.indexOf(': ');
    const org = i > 0 ? raw.slice(0, i).trim() : null;
    const title = i > 0 ? raw.slice(i + 2) : raw;
    const lines = decodeEntities(tagValue(it, 'description').replace(/<[^>]+>/g, ' ')).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    let salary = null; let location = null;
    if (lines.length >= 3 && /:$/.test(lines[0])) salary = lines.shift().replace(/:$/, '');
    if (org && lines[0] && lines[0].replace(/:$/, '').toLowerCase() === org.toLowerCase()) lines.shift();
    if (lines.length >= 2) location = lines.pop();
    const link = decodeEntities(tagValue(it, 'link'));
    return {
      source_id: idFrom(link, /\/(?:job|listing)\/(\d+)\//) || link.split('?')[0],
      kind: academicKind(title),
      title: clean(title, 200),
      org: clean(org, 120),
      location: clean(location, 120),
      remote: /remote/i.test(`${title} ${location || ''}`),
      url: link,
      excerpt: plain(lines.join(' '), 400),
      tags: [],
      deadline: null,
      posted_at: toIso(tagValue(it, 'pubDate')),
      salary: salary && !/^competitive/i.test(salary) ? clean(salary, 80) : null,
      open_to: openToFrom(location),
    };
  });
}

// AcademicCareers.com RSS (Smart Job Board): first description line is the location; dc:creator the employer
function academiccareers(xml) {
  return rssBlocks(xml).map((it) => {
    const link = tagValue(it, 'link');
    const title = txt(it, 'title');
    const lines = decodeEntities(tagValue(it, 'description')).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const location = lines[0] && !/</.test(lines[0]) ? lines[0] : null;
    return {
      source_id: idFrom(link, /\/job\/(\d+)\//) || link,
      kind: academicKind(title),
      title: clean(title, 200),
      org: clean(txt(it, 'dc:creator'), 120),
      location: clean(location, 120),
      remote: false,
      url: link,
      excerpt: plain(lines.slice(2).join(' '), 400),
      tags: [],
      deadline: null,
      posted_at: toIso(tagValue(it, 'pubDate')),
      salary: null,
      open_to: openToFrom(location),
    };
  });
}

// Commonwealth Scholarships (WordPress REST: /wp-json/wp/v2/cscukscholarships) — evergreen programme pages
function cscuk(data) {
  return (Array.isArray(data) ? data : []).filter((p) => p && p.id && p.link).map((p) => {
    const title = plain(p.title && p.title.rendered, 200);
    return {
      source_id: String(p.id),
      kind: /fellow/i.test(title) ? 'fellowship' : 'scholarship',
      title: clean(title, 200),
      org: 'Commonwealth Scholarship Commission in the UK',
      location: 'United Kingdom',
      remote: false,
      url: p.link,
      excerpt: plain(p.excerpt && p.excerpt.rendered).replace(/\s*The post .* appeared first on .*$/i, '') || 'UK-funded award for citizens of eligible Commonwealth countries, including Nigeria. See eligibility and dates on the CSC website.',
      tags: ['Commonwealth', 'United Kingdom'],
      deadline: null,
      posted_at: toIso(p.modified || p.date),
      salary: null,
      open_to: 'africa',
    };
  });
}

// Jooble REST API (key-gated: JOOBLE_API_KEY) → { totalCount, jobs: [{ id, title, location, snippet, salary, source, type, link, company, updated }] }
function jooble(data) {
  return (data.jobs || []).filter((j) => j && j.id != null && j.link && j.title).map((j) => {
    const remote = /remote|work from home/i.test(`${j.title} ${j.location} ${j.type}`);
    return {
      source_id: String(j.id),
      kind: jobKind(j.title, remote),
      title: clean(j.title, 200),
      org: clean(j.company, 120),
      location: clean(j.location, 120),
      remote,
      url: j.link,
      excerpt: plain(j.snippet),
      tags: [j.type, j.source].filter(Boolean).slice(0, 3).map(String),
      deadline: null,
      posted_at: toIso(j.updated),
      salary: clean(j.salary, 80),
      open_to: openToFrom(j.location, 'nigeria'),
    };
  });
}

// Freelancer.com projects API (key-gated: FREELANCER_OAUTH_TOKEN) → { result: { projects: [...] } }
function freelancer(data) {
  const list = (data && data.result && data.result.projects) || [];
  return list.filter((p) => p && p.id && p.seo_url && p.title).map((p) => {
    const cur = (p.currency && p.currency.code) || '';
    const b = p.budget || {};
    return {
      source_id: String(p.id),
      kind: 'remote',
      title: clean(p.title, 200),
      org: null,
      location: 'Online (freelance)',
      remote: true,
      url: `https://www.freelancer.com/projects/${p.seo_url}`,
      excerpt: plain(p.preview_description || p.description),
      tags: ['Freelance', ...(p.jobs || []).map((x) => x && x.name).filter(Boolean)].slice(0, 8),
      deadline: p.time_submitted && p.bidperiod ? toIso((p.time_submitted + p.bidperiod * 86400) * 1000) : null,
      posted_at: toIso(p.time_submitted),
      salary: money(b.minimum, b.maximum, cur, p.type === 'hourly' ? 'hour' : 'project'),
      open_to: 'worldwide',
    };
  });
}

// ---------- the source list ----------
// category → the 7 directory categories (lib/jobsDirectory.js). Optional per source:
//   needsEnv: 'ENV_NAME'  — key-gated: never fetched (and never shown) until that env var is set
//   defaultOff: true      — the feed's terms need written permission: OFF until an admin switches it on
//   maxAgeDays            — undated listings older than this are removed (default 45)
//   request(env)          — builds { url, method, body, headers } (keyed sources); urls: [...] fetches several pages
const getJson = (url) => ({ url, parse: (t) => JSON.parse(t) });
const xmlFeed = (url, adapt) => ({ url, parse: (t) => t, adapt });
export const SOURCES = [
  { key: 'remotive', name: 'Remotive', category: 'intl', site: 'https://remotive.com', kinds: ['remote', 'internship'], everyH: 6, ...getJson('https://remotive.com/api/remote-jobs?limit=150'), adapt: remotive },
  { key: 'remoteok', name: 'Remote OK', category: 'intl', site: 'https://remoteok.com', kinds: ['remote'], everyH: 6, ...getJson('https://remoteok.com/api'), adapt: remoteok },
  { key: 'jobicy', name: 'Jobicy', category: 'intl', site: 'https://jobicy.com', kinds: ['remote', 'internship'], everyH: 6, ...getJson('https://jobicy.com/api/v2/remote-jobs?count=100'), adapt: jobicy },
  { key: 'arbeitnow', name: 'Arbeitnow', category: 'intl', site: 'https://www.arbeitnow.com', kinds: ['job', 'remote', 'internship'], everyH: 6, ...getJson('https://www.arbeitnow.com/api/job-board-api'), adapt: arbeitnow },
  {
    key: 'grantsgov', name: 'Grants.gov', category: 'funding', site: 'https://www.grants.gov', kinds: ['grant'], everyH: 12,
    url: 'https://api.grants.gov/v1/api/search2', method: 'POST', body: { rows: 100, oppStatuses: 'forecasted|posted', sortBy: 'openDate|desc' },
    parse: (t) => JSON.parse(t), adapt: grantsgov,
  },
  { key: 'devpost', name: 'Devpost', category: 'ai', site: 'https://devpost.com/hackathons', kinds: ['hackathon'], everyH: 6, ...getJson('https://devpost.com/api/hackathons?status[]=open&status[]=upcoming'), adapt: devpost },
  { key: 'codeforces', name: 'Codeforces', category: 'ai', site: 'https://codeforces.com/contests', kinds: ['competition'], everyH: 12, ...getJson('https://codeforces.com/api/contest.list?gym=false'), adapt: codeforces },
  { key: 'opportunitydesk', name: 'Opportunity Desk', category: 'funding', site: 'https://opportunitydesk.org', kinds: ['scholarship', 'fellowship', 'grant', 'competition', 'event', 'internship'], everyH: 3, url: 'https://opportunitydesk.org/feed/', parse: (t) => t, adapt: (x) => parseRss(x, { org: null, fallbackKind: 'other' }) },
  { key: 'opportunitiesforyouth', name: 'Opportunities for Youth', category: 'funding', site: 'https://opportunitiesforyouth.org', kinds: ['scholarship', 'fellowship', 'event', 'volunteer', 'competition', 'internship'], everyH: 3, url: 'https://opportunitiesforyouth.org/feed/', parse: (t) => t, adapt: (x) => parseRss(x, { org: null, fallbackKind: 'other' }) },
  { key: 'scholars4dev', name: 'Scholars4Dev', category: 'funding', site: 'https://www.scholars4dev.com', kinds: ['scholarship', 'fellowship'], everyH: 6, url: 'https://www.scholars4dev.com/feed/', parse: (t) => t, adapt: (x) => parseRss(x, { org: null, fallbackKind: 'scholarship' }) },

  // ---- JOBS FEEDS (round 2): public feeds/APIs we may use now (terms: credit the source + link to the original) ----
  {
    key: 'himalayas', name: 'Himalayas', category: 'intl', site: 'https://himalayas.app/jobs', kinds: ['remote', 'internship'], everyH: 12,
    urls: [1, 2, 3].map((p) => `https://himalayas.app/jobs/api/search?country=Nigeria&page=${p}`), parse: (t) => JSON.parse(t), adapt: himalayas,
  },
  { key: 'workingnomads', name: 'Working Nomads', category: 'intl', site: 'https://www.workingnomads.com/jobs', kinds: ['remote', 'internship'], everyH: 12, ...getJson('https://www.workingnomads.com/api/exposed_jobs/'), adapt: workingnomads },
  { key: 'myjobmag', name: 'MyJobMag', category: 'africa', site: 'https://www.myjobmag.com', kinds: ['job', 'internship', 'remote'], everyH: 3, ...xmlFeed('https://www.myjobmag.com/jobsxml_by_categories.xml', myjobmag), maxAgeDays: 30 },
  { key: 'hotnigerianjobs', name: 'Hot Nigerian Jobs', category: 'africa', site: 'https://www.hotnigerianjobs.com', kinds: ['job', 'internship', 'remote'], everyH: 3, ...xmlFeed('https://www.hotnigerianjobs.com/feed/rss.xml', hotnigerianjobs), maxAgeDays: 30 },
  { key: 'jobzilla', name: 'Jobzilla', category: 'africa', site: 'https://www.jobzilla.ng', kinds: ['job', 'internship', 'remote'], everyH: 3, ...xmlFeed('https://www.jobzilla.ng/feed', jobzilla), maxAgeDays: 30 },
  // AI / tech companies: their official public ATS job-board APIs (Greenhouse, Ashby, Lever) — open jobs only
  { key: 'andela', name: 'Andela', category: 'ai', site: 'https://www.andela.com', kinds: ['job', 'remote', 'internship'], everyH: 24, ...getJson('https://api.ashbyhq.com/posting-api/job-board/andela?includeCompensation=true'), adapt: (d) => ashby(d, { org: 'Andela' }), maxAgeDays: 365 },
  { key: 'turing', name: 'Turing', category: 'ai', site: 'https://www.turing.com', kinds: ['job', 'remote', 'internship'], everyH: 24, ...getJson('https://boards-api.greenhouse.io/v1/boards/turing/jobs?content=true'), adapt: (d) => greenhouse(d, { org: 'Turing' }), maxAgeDays: 365 },
  { key: 'welodata', name: 'Welo Data', category: 'ai', site: 'https://www.welodata.ai', kinds: ['job', 'remote', 'internship'], everyH: 24, ...getJson('https://api.lever.co/v0/postings/weloglobal?mode=json&department=Welo%20Data%20-%20AI%20Services'), adapt: (d) => lever(d, { org: 'Welo Data' }), maxAgeDays: 3650 },
  { key: 'mercor', name: 'Mercor', category: 'ai', site: 'https://www.mercor.com', kinds: ['remote', 'internship'], everyH: 24, ...getJson('https://api.ashbyhq.com/posting-api/job-board/mercor?includeCompensation=true'), adapt: (d) => ashby(d, { org: 'Mercor', remoteOnly: true }), maxAgeDays: 365 },
  { key: 'invisible', name: 'Invisible', category: 'ai', site: 'https://www.invisible.co', kinds: ['job', 'remote', 'internship'], everyH: 24, ...getJson('https://boards-api.greenhouse.io/v1/boards/invisibletech/jobs?content=true'), adapt: (d) => greenhouse(d, { org: 'Invisible Technologies' }), maxAgeDays: 365 },
  { key: 'academicjobsonline', name: 'Academic Jobs Online', category: 'academic', site: 'https://academicjobsonline.org', kinds: ['job', 'fellowship', 'scholarship'], everyH: 12, ...xmlFeed('https://academicjobsonline.org/ajo?joblist-0-0-0-----rss--', academicjobsonline), maxAgeDays: 120 },
  { key: 'cscuk', name: 'Commonwealth Scholarships', category: 'funding', site: 'https://cscuk.fcdo.gov.uk', kinds: ['scholarship', 'fellowship'], everyH: 72, ...getJson('https://cscuk.fcdo.gov.uk/wp-json/wp/v2/cscukscholarships?per_page=20&_fields=id,date,modified,link,title,excerpt'), adapt: cscuk, maxAgeDays: 3650 },

  // ---- feeds whose terms/robots need written permission first: OFF until an admin switches them on ----
  { key: 'weworkremotely', name: 'We Work Remotely', category: 'intl', site: 'https://weworkremotely.com', kinds: ['remote', 'internship'], everyH: 12, defaultOff: true, ...xmlFeed('https://weworkremotely.com/remote-jobs.rss', weworkremotely) },
  { key: 'timeshighered', name: 'Times Higher Education Jobs', category: 'academic', site: 'https://www.timeshighereducation.com/unijobs/', kinds: ['job', 'fellowship', 'scholarship'], everyH: 12, defaultOff: true, ...xmlFeed('https://www.timeshighereducation.com/unijobs/jobsrss/?keywords=africa', madgex) },
  { key: 'chronicle', name: 'Chronicle Jobs', category: 'academic', site: 'https://jobs.chronicle.com', kinds: ['job', 'fellowship', 'scholarship'], everyH: 12, defaultOff: true, ...xmlFeed('https://jobs.chronicle.com/jobsrss/?keywords=africa', madgex) },
  { key: 'academiccareers', name: 'Academic Careers', category: 'academic', site: 'https://academiccareers.com', kinds: ['job', 'fellowship', 'scholarship'], everyH: 12, defaultOff: true, ...xmlFeed('https://academiccareers.com/feeds/rss.xml', academiccareers) },
  { key: 'naturecareers', name: 'Nature Careers', category: 'research', site: 'https://www.nature.com/naturecareers', kinds: ['job', 'fellowship', 'scholarship'], everyH: 12, defaultOff: true, ...xmlFeed('https://www.nature.com/naturecareers/jobsrss/', madgex) },
  { key: 'sciencecareers', name: 'Science Careers', category: 'research', site: 'https://jobs.sciencecareers.org', kinds: ['job', 'fellowship', 'scholarship'], everyH: 12, defaultOff: true, ...xmlFeed('https://jobs.sciencecareers.org/jobsrss/', madgex) },

  // ---- key-gated: only run when the client adds the key/token as a Worker secret ----
  {
    key: 'jooble', name: 'Jooble', category: 'intl', site: 'https://ng.jooble.org', kinds: ['job', 'remote', 'internship'], everyH: 6, needsEnv: 'JOOBLE_API_KEY', maxAgeDays: 30,
    // free plan: 100 requests/day per key — this source makes 4/day
    request: (env) => ({
      url: `https://${env.JOOBLE_HOST || 'ng.jooble.org'}/api/${encodeURIComponent(env.JOOBLE_API_KEY)}`,
      method: 'POST',
      body: { keywords: env.JOOBLE_KEYWORDS || '', location: env.JOOBLE_LOCATION || 'Nigeria', page: '1' },
    }),
    parse: (t) => JSON.parse(t), adapt: jooble,
  },
  {
    key: 'freelancer', name: 'Freelancer', category: 'freelance', site: 'https://www.freelancer.com', kinds: ['remote'], everyH: 6, needsEnv: 'FREELANCER_OAUTH_TOKEN',
    request: (env) => ({
      url: 'https://www.freelancer.com/api/projects/0.1/projects/active/?limit=50&compact=true&full_description=true&job_details=true',
      headers: { 'freelancer-oauth-v1': env.FREELANCER_OAUTH_TOKEN },
    }),
    parse: (t) => JSON.parse(t), adapt: freelancer,
  },
];
export const sourceByKey = (k) => SOURCES.find((s) => s.key === k);
export const sourcesInCategory = (cat) => SOURCES.filter((s) => s.category === cat).map((s) => s.key);
/** Is this source allowed to run / show? row = its opportunity_sources row (or undefined). */
export function sourceActive(env, s, row) {
  if (!s) return false;
  if (s.needsEnv && !(env && env[s.needsEnv])) return false;
  if (row && row.enabled === false) return false;
  if (s.defaultOff && !(row && row.admin_on)) return false; // admin_on is set only by an admin switching it on
  return true;
}
/** The keys of every source that may run/show right now (one small query). */
export async function activeSourceKeys(env) {
  const rows = await q(env, `SELECT key, enabled, admin_on FROM opportunity_sources`);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  return SOURCES.filter((s) => sourceActive(env, s, byKey[s.key])).map((s) => s.key);
}

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

// One or more requests per source: request(env) for keyed sources, urls[] for paged ones, else url
function requestsFor(src, env) {
  if (src.request) return [].concat(src.request(env || {}));
  return (src.urls || [src.url]).map((url) => ({ url, method: src.method, body: src.body }));
}

async function fetchText(req, fetchImpl) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    const res = await fetchImpl(req.url, {
      method: req.method || 'GET',
      headers: { 'User-Agent': UA, Accept: 'application/json, application/rss+xml, text/xml;q=0.9, */*;q=0.5', ...(req.body ? { 'Content-Type': 'application/json' } : {}), ...(req.headers || {}) },
      body: req.body ? JSON.stringify(req.body) : undefined,
      signal: ctl ? ctl.signal : undefined,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { if (timer) clearTimeout(timer); }
}

/** Upserts one source's items in a single statement. → number of rows written */
export async function saveItems(env, source, items) {
  if (!items.length) return 0;
  const rows = items.map((x) => ({ ...x, source, tags: (x.tags || []).map((t) => String(t).slice(0, 40)), open_to: OPEN_TO.includes(x.open_to) ? x.open_to : null }));
  const r = await q(env, `
    INSERT INTO opportunities (source, source_id, kind, title, org, location, remote, url, excerpt, tags, deadline, posted_at, salary, open_to,
      description, employment_type, logo_url, apply_url)
    SELECT x.source, x.source_id, x.kind, x.title, x.org, x.location, COALESCE(x.remote, false), x.url, x.excerpt, COALESCE(x.tags, '{}'), x.deadline, x.posted_at, x.salary, x.open_to,
      x.description, x.employment_type, x.logo_url, x.apply_url
    FROM json_to_recordset($1::json) AS x(source text, source_id text, kind text, title text, org text, location text, remote boolean,
      url text, excerpt text, tags text[], deadline timestamptz, posted_at timestamptz, salary text, open_to text,
      description text, employment_type text, logo_url text, apply_url text)
    ON CONFLICT (source, source_id) DO UPDATE SET
      kind = EXCLUDED.kind, title = EXCLUDED.title, org = EXCLUDED.org, location = EXCLUDED.location, remote = EXCLUDED.remote,
      url = EXCLUDED.url, excerpt = EXCLUDED.excerpt, tags = EXCLUDED.tags, deadline = EXCLUDED.deadline,
      posted_at = COALESCE(EXCLUDED.posted_at, opportunities.posted_at), salary = EXCLUDED.salary, open_to = EXCLUDED.open_to,
      description = EXCLUDED.description, employment_type = EXCLUDED.employment_type, logo_url = EXCLUDED.logo_url, apply_url = EXCLUDED.apply_url, updated_at = now()
    RETURNING id`, [JSON.stringify(rows)]);
  return r.length;
}

/** Imports one source now (records success/failure in opportunity_sources). → { key, count } or { key, error } */
export async function importSource(env, key, { fetchImpl = fetch } = {}) {
  const src = sourceByKey(key);
  if (!src) throw new Error(`Unknown source ${key}`);
  // key-gated sources never touch the network without their key
  if (src.needsEnv && !(env && env[src.needsEnv])) return { key, error: `${src.needsEnv} is not set`, skipped: true };
  await q(env, `INSERT INTO opportunity_sources (key, last_run_at) VALUES ($1, now())
    ON CONFLICT (key) DO UPDATE SET last_run_at = now()`, [key]);
  try {
    const raw = [];
    for (const req of requestsFor(src, env)) raw.push(src.parse(await fetchText(req, fetchImpl))); // eslint-disable-line no-await-in-loop
    const items = validItems(raw.flatMap((r) => src.adapt(r)));
    const count = await saveItems(env, key, items);
    // listings without a date are dated when we first see them, so 'newest first' still makes sense
    if (items.some((x) => !x.posted_at)) {
      await q(env, `UPDATE opportunities SET posted_at = created_at WHERE source = $1 AND posted_at IS NULL`, [key]);
    }
    await q(env, `UPDATE opportunity_sources SET last_ok_at = now(), last_error = NULL, last_count = $2 WHERE key = $1`, [key, count]);
    return { key, count };
  } catch (e) {
    let msg = String((e && e.message) || e).slice(0, 300);
    if (src.needsEnv && env[src.needsEnv]) msg = msg.split(String(env[src.needsEnv])).join('***'); // never log a key
    await q(env, `UPDATE opportunity_sources SET last_error = $2 WHERE key = $1`, [key, msg]);
    console.error('[opportunities] import failed', key, msg);
    return { key, error: msg };
  }
}

export const DEFAULT_MAX_AGE_DAYS = 45;
export const STALE_DAYS = 21; // a listing its source hasn't returned for this long has been taken down
/** Removes listings whose deadline has passed, that are old and undated (per-source maxAgeDays, default 45),
 *  or that their feed stopped returning STALE_DAYS ago. */
export async function pruneOpportunities(env) {
  const ages = JSON.stringify(SOURCES.filter((s) => s.maxAgeDays).map((s) => ({ k: s.key, d: s.maxAgeDays })));
  const r = await q(env, `DELETE FROM opportunities o
    WHERE (o.deadline IS NOT NULL AND o.deadline < now() - interval '1 day')
       OR (o.deadline IS NULL AND COALESCE(o.posted_at, o.created_at) < now() - make_interval(days =>
             COALESCE((SELECT (e->>'d')::int FROM json_array_elements($1::json) e WHERE e->>'k' = o.source), ${DEFAULT_MAX_AGE_DAYS})))
       OR o.updated_at < now() - interval '${STALE_DAYS} days'
    RETURNING id`, [ages]);
  return r.length;
}

/** Cron entry: imports the sources that are due (oldest first, a few per run), then prunes. */
export async function runOpportunityCron(env, { fetchImpl = fetch, now = Date.now(), limit = SOURCES_PER_RUN } = {}) {
  const state = await q(env, `SELECT key, enabled, admin_on, last_run_at FROM opportunity_sources`);
  const byKey = Object.fromEntries(state.map((s) => [s.key, s]));
  const due = SOURCES
    .filter((s) => sourceActive(env, s, byKey[s.key])) // skips switched-off, permission-pending and key-less sources
    .filter((s) => { const last = byKey[s.key] && byKey[s.key].last_run_at; return !last || now - new Date(last).getTime() >= s.everyH * HOUR; })
    .sort((a, b) => new Date((byKey[a.key] || {}).last_run_at || 0) - new Date((byKey[b.key] || {}).last_run_at || 0))
    .slice(0, limit);
  const results = [];
  for (const s of due) results.push(await importSource(env, s.key, { fetchImpl })); // eslint-disable-line no-await-in-loop
  let pruned = 0;
  try { pruned = await pruneOpportunities(env); } catch (e) { console.error('[opportunities] prune failed', e && e.message); }
  return { results, pruned };
}

export const _adapters = {
  remotive, remoteok, jobicy, arbeitnow, grantsgov, devpost, codeforces,
  himalayas, workingnomads, weworkremotely, myjobmag, hotnigerianjobs, jobzilla, greenhouse, ashby, lever, academicjobsonline, madgex, academiccareers, cscuk, jooble, freelancer,
};
