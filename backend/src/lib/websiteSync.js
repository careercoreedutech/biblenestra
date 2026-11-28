// MEMBER WEBSITE INTEGRATION (brief 19 / 19.1 / 20)
//   • Import: a connected site's RSS/Atom feed (or the WordPress REST API) → new articles in the Website feed.
//     Duplicates are skipped by the item's GUID (or link) per connection. Imports wait for approval when the
//     connection asks for it. The cron (runWebsiteSync) polls connections that have auto-import on.
//   • Publish: an in-app article goes to a connected WordPress site through the REST API with an Application
//     Password (encrypted at rest with the Fund Me AES-GCM helper). Status: draft → pending → approved →
//     publishing → published | failed (retry from failed).
//   • Ads: interleaveAds() places labelled ad slots between paragraphs (never mid-paragraph) with frequency limits.
// Everything here is pure or takes `env`; the network is reached only through env.__fetch (tests stub it).
import { q, one } from './db.js';
import { bad } from './http.js';
import { encryptField, decryptField } from './fundmeMoney.js';
import { normalizeWebsiteUrl } from './websites.js';
import { registerConfig, getConfig } from './wallet.js';

// ---------- configuration (admins change these in the wallet config; nothing is hard-coded) ----------
registerConfig('website_ad_every_paragraphs', 3, (v) => Number.isInteger(v) && v >= 1 && v <= 20);
registerConfig('website_ad_max_per_article', 4, (v) => Number.isInteger(v) && v >= 0 && v <= 10);
registerConfig('website_sync_minutes', 30, (v) => Number.isInteger(v) && v >= 5 && v <= 1440);
registerConfig('website_owner_can_approve', true, (v) => typeof v === 'boolean');
registerConfig('website_publish_requires_approval', true, (v) => typeof v === 'boolean');
registerConfig('website_integration_access', 'admins', (v) => v === 'admins' || v === 'verified' || v === 'members');
export const MAX_CONNECTIONS = 3;

const fetcher = (env) => (env && env.__fetch) || fetch;
const UA = 'BibleNestraBot/1.0 (+website sync)';

// ---------- small text helpers ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export function decodeEntities(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z0-9#]+);/gi, (m, n) => (ENT[n.toLowerCase()] != null ? ENT[n.toLowerCase()] : m));
}
const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, '');
// Entities are decoded before the second tag strip, so an escaped title like "&lt;em&gt;" reads as plain text.
const oneLine = (s) => stripTags(decodeEntities(stripTags(s))).replace(/\s+/g, ' ').trim();

/**
 * HTML → plain paragraphs. Output paragraphs are joined by a blank line; headings are kept as paragraphs that
 * start with "## ". Scripts and styles are dropped and no HTML survives (the app renders plain text only).
 */
export function htmlToBody(html) {
  let raw = String(html || '');
  // Atom often ships escaped markup ("&lt;p&gt;…"): decode it once so the tags can be found and removed.
  if (/&lt;\s*\/?[a-z]/i.test(raw)) raw = decodeEntities(raw);
  let s = raw
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_, t) => `\n\n## ${oneLine(t)}\n\n`)
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|li|blockquote|tr|section|article|figure|ul|ol|pre)>/gi, '\n\n');
  s = decodeEntities(stripTags(s));
  const paras = s.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return paras.join('\n\n');
}

export const bodyParagraphs = (body) => String(body || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

/** Labelled ad slots between paragraphs. Never inside a paragraph, never right after a heading, never at the very end. */
export function interleaveAds(paragraphs, { every = 3, max = 4 } = {}) {
  const step = Math.max(1, Math.floor(Number(every) || 3));
  const cap = Math.max(0, Math.floor(Number(max) || 0));
  const out = [];
  let textCount = 0;
  let ads = 0;
  const total = paragraphs.length;
  paragraphs.forEach((p, i) => {
    const heading = p.startsWith('## ');
    out.push(heading ? { type: 'heading', text: p.slice(3) } : { type: 'text', text: p });
    if (heading) return;
    textCount += 1;
    const remaining = total - i - 1;
    if (textCount % step === 0 && remaining >= 2 && ads < cap) {
      ads += 1;
      out.push({ type: 'ad', slot: ads });
    }
  });
  return out;
}

// ---------- feeds (RSS 2.0 and Atom) ----------
function blocksOf(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}
function rawField(block, tag) {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!m) return null;
  const c = m[1].match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return c ? c[1] : m[1];
}
function attrOf(block, tag, attr, pick) {
  const re = new RegExp(`<${tag}\\b([^>]*)\\/?>`, 'gi');
  let m;
  let first = null;
  while ((m = re.exec(block))) {
    const a = m[1].match(new RegExp(`\\b${attr}=["']([^"']+)["']`, 'i'));
    if (!a) continue;
    const rel = (m[1].match(/\brel=["']([^"']+)["']/i) || [])[1] || 'alternate';
    if (!first) first = decodeEntities(a[1]);
    if (!pick || pick(rel, m[1])) return decodeEntities(a[1]);
  }
  return pick ? null : first;
}

const httpsOnly = (u) => (typeof u === 'string' && /^https:\/\//i.test(u.trim()) ? u.trim().slice(0, 500) : null);

/**
 * Parse an RSS 2.0 or Atom document into items: { key, guid, link, title, excerpt, html, image, publishedAt }.
 * Items without a secure link are dropped. Throws a readable error when the text is not a feed.
 */
export function parseFeed(xml) {
  const s = String(xml || '');
  const atom = /<feed[\s>]/i.test(s) && !/<rss[\s>]/i.test(s);
  if (!atom && !/<rss[\s>]/i.test(s) && !/<channel[\s>]/i.test(s)) throw new Error('This address is not an RSS or Atom feed');
  const blocks = atom ? blocksOf(s, 'entry') : blocksOf(s, 'item');
  const items = [];
  for (const b of blocks) {
    const id = oneLine(rawField(b, 'guid') || rawField(b, 'id') || '');
    const link = httpsOnly(atom ? attrOf(b, 'link', 'href', (rel) => rel === 'alternate') || attrOf(b, 'link', 'href') : oneLine(rawField(b, 'link') || ''));
    if (!link) continue;
    const title = oneLine(rawField(b, 'title') || '').slice(0, 200) || 'Untitled article';
    const html = rawField(b, 'content:encoded') || rawField(b, 'content') || rawField(b, 'description') || rawField(b, 'summary') || '';
    const excerptSrc = rawField(b, 'description') || rawField(b, 'summary') || html;
    const date = oneLine(rawField(b, 'pubDate') || rawField(b, 'published') || rawField(b, 'updated') || rawField(b, 'dc:date') || '');
    const publishedAt = date && !Number.isNaN(Date.parse(date)) ? new Date(Date.parse(date)).toISOString() : null;
    const image = httpsOnly(attrOf(b, 'enclosure', 'url', null) || attrOf(b, 'media:content', 'url', null) || attrOf(b, 'media:thumbnail', 'url', null) || '');
    items.push({
      key: id || link,
      guid: id || null,
      link,
      title,
      excerpt: oneLine(excerptSrc).slice(0, 300) || null,
      html,
      image,
      publishedAt,
    });
  }
  return items;
}

/** Drop items already known (by key) and repeats inside the same batch. Keeps the order given. */
export function filterNewItems(items, knownKeys) {
  const seen = new Set(knownKeys || []);
  const out = [];
  for (const it of items) {
    if (!it || !it.key || seen.has(it.key)) continue;
    seen.add(it.key);
    out.push(it);
  }
  return out;
}

// ---------- WordPress REST ----------
export function wpBase(siteUrl) {
  const u = new URL(siteUrl);
  return `${u.origin}/wp-json/wp/v2`;
}
function b64utf8(text) {
  const bytes = new TextEncoder().encode(String(text));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
export const basicAuth = (user, appPassword) => `Basic ${b64utf8(`${user}:${String(appPassword).replace(/\s+/g, ' ')}`)}`;

async function http(env, url, init = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    return await fetcher(env)(url, { ...init, redirect: 'follow', signal: ctl.signal, headers: { 'User-Agent': UA, ...(init.headers || {}) } });
  } catch (e) {
    throw new Error('The website could not be reached. Check the address and try again.');
  } finally {
    clearTimeout(timer);
  }
}

/** Is this a WordPress site with the REST API switched on? */
export async function detectWordPress(env, siteUrl) {
  const res = await http(env, `${wpBase(siteUrl)}/posts?per_page=1`, { headers: { Accept: 'application/json' } });
  if (!res.ok) return false;
  const j = await res.json().catch(() => null);
  return Array.isArray(j);
}

/** Checks the application password for the account. Returns true when WordPress accepts it. */
export async function verifyWordPressLogin(env, siteUrl, user, appPassword) {
  const res = await http(env, `${wpBase(siteUrl)}/users/me`, { headers: { Accept: 'application/json', Authorization: basicAuth(user, appPassword) } });
  if (res.status === 401 || res.status === 403) throw bad('WordPress did not accept that user name or application password', 'WP_AUTH');
  if (!res.ok) throw bad(`WordPress answered ${res.status}. Check the site address and that the REST API is on.`, 'WP_HTTP');
  return true;
}

function wpItem(p) {
  const link = httpsOnly(p.link);
  if (!link) return null;
  const html = (p.content && p.content.rendered) || '';
  return {
    key: `wp:${p.id}`,
    guid: `wp:${p.id}`,
    link,
    title: oneLine((p.title && p.title.rendered) || '').slice(0, 200) || 'Untitled article',
    excerpt: oneLine((p.excerpt && p.excerpt.rendered) || html).slice(0, 300) || null,
    html,
    image: null,
    publishedAt: p.date_gmt ? new Date(`${p.date_gmt}Z`).toISOString() : null,
  };
}

export async function fetchWordPressPosts(env, siteUrl, { perPage = 20 } = {}) {
  const res = await http(env, `${wpBase(siteUrl)}/posts?per_page=${Math.min(50, Math.max(1, perPage))}&orderby=date&order=desc`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`WordPress answered ${res.status} when we asked for new posts`);
  const j = await res.json().catch(() => null);
  if (!Array.isArray(j)) throw new Error('WordPress returned something we could not read');
  return j.map(wpItem).filter(Boolean);
}

export async function fetchFeedItems(env, feedUrl) {
  const res = await http(env, feedUrl, { headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8' } });
  if (!res.ok) throw new Error(`The feed answered ${res.status}`);
  return parseFeed(await res.text());
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Plain paragraphs → the HTML WordPress stores ("## " headings become h2). */
export function bodyToWordPressHtml(body) {
  return bodyParagraphs(body).map((p) => (p.startsWith('## ') ? `<h2>${esc(p.slice(3))}</h2>` : `<p>${esc(p)}</p>`)).join('\n');
}

/** Creates the post on the WordPress site. Resolves { externalId, externalUrl }. Throws a readable error. */
export async function publishToWordPress(env, conn, article) {
  if (!conn.wp_username || !conn.wp_password_enc) throw bad('Add your WordPress user name and application password to publish', 'NO_CREDENTIALS');
  const password = await decryptField(env, conn.wp_password_enc);
  const res = await http(env, `${wpBase(conn.site_url)}/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: basicAuth(conn.wp_username, password) },
    body: JSON.stringify({ title: article.title, content: bodyToWordPressHtml(article.body), excerpt: article.excerpt || undefined, status: 'publish' }),
  });
  const j = await res.json().catch(() => null);
  if (res.status === 401 || res.status === 403) throw new Error('WordPress rejected the saved application password. Update it in your integration settings.');
  if (!res.ok || !j || !j.id) throw new Error((j && j.message) || `WordPress answered ${res.status} when publishing`);
  return { externalId: String(j.id), externalUrl: httpsOnly(j.link) || null };
}

// ---------- sync (import) ----------
/** Pulls the connection's latest items and stores the new ones. → { found, added } */
export async function syncConnection(env, conn) {
  const items = conn.kind === 'wordpress' ? await fetchWordPressPosts(env, conn.site_url) : await fetchFeedItems(env, conn.feed_url);
  const keys = items.map((i) => i.key);
  const known = keys.length ? await q(env, 'SELECT source_key FROM website_articles WHERE connection_id = $1 AND source_key = ANY($2::text[])', [conn.id, keys]) : [];
  const fresh = filterNewItems(items, known.map((r) => r.source_key));
  let added = 0;
  for (const it of fresh) {
    const status = conn.import_requires_approval ? 'pending' : 'approved';
    const body = htmlToBody(it.html) || it.excerpt || '';
    const r = await q(env, `INSERT INTO website_articles (connection_id, owner_id, direction, status, title, excerpt, body, source_key, source_url, image_url, published_at)
      VALUES ($1,$2,'import',$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (connection_id, source_key) WHERE source_key IS NOT NULL DO NOTHING RETURNING id`,
    [conn.id, conn.owner_id, status, it.title, it.excerpt, body, it.key, it.link, it.image, it.publishedAt]);
    if (r && r.length) added += 1;
  }
  await q(env, `UPDATE website_connections SET status = 'connected', last_error = NULL, last_synced_at = now(), updated_at = now() WHERE id = $1`, [conn.id]);
  return { found: items.length, added };
}

/** Records a failed sync on the connection and alerts its owner (one alert per new error). */
export async function recordSyncFailure(env, conn, error) {
  const message = String((error && error.message) || error || 'The sync failed').slice(0, 300);
  const prev = await one(env, 'SELECT last_error FROM website_connections WHERE id = $1', [conn.id]);
  await q(env, `UPDATE website_connections SET status = 'error', last_error = $2, last_synced_at = now(), updated_at = now() WHERE id = $1`, [conn.id, message]);
  if (!prev || prev.last_error !== message) {
    await q(env, `INSERT INTO notifications (user_id, kind, title, body, data) VALUES ($1, 'website', $2, $3, $4::jsonb)`,
      [conn.owner_id, 'Website sync failed', `${conn.host}: ${message}`, JSON.stringify({ connectionId: conn.id, route: 'WebsiteIntegrations' })]).catch(() => {});
  }
  return message;
}

/** Cron: poll connections with auto-import on, oldest sync first, at most `limit` per run. */
export async function runWebsiteSync(env, { limit = 10 } = {}) {
  const cfg = await getConfig(env);
  const minutes = Number(cfg.website_sync_minutes) || 30;
  const due = await q(env, `SELECT * FROM website_connections
    WHERE auto_import AND status <> 'paused' AND (last_synced_at IS NULL OR last_synced_at < now() - ($1::int * interval '1 minute'))
    ORDER BY last_synced_at NULLS FIRST LIMIT $2`, [minutes, limit]);
  let ok = 0;
  let failed = 0;
  for (const conn of due) {
    try {
      await syncConnection(env, conn);
      ok += 1;
    } catch (e) {
      failed += 1;
      await recordSyncFailure(env, conn, e);
    }
  }
  return { checked: due.length, ok, failed };
}

// ---------- shaping ----------
export function connectionShape(r) {
  return {
    id: r.id,
    siteUrl: r.site_url,
    host: r.host,
    kind: r.kind,
    feedUrl: r.feed_url || null,
    hasCredentials: !!r.wp_password_enc,
    wpUsername: r.wp_username || null,
    autoImport: !!r.auto_import,
    autoPost: !!r.auto_publish,
    importRequiresApproval: !!r.import_requires_approval,
    status: r.status,
    lastError: r.last_error || null,
    lastSyncedAt: r.last_synced_at ? new Date(r.last_synced_at).toISOString() : null,
  };
}

/** Feed/article status the app shows, with a plain-language label. */
export const ARTICLE_STATUS_LABEL = {
  draft: 'Draft',
  pending: 'Waiting for approval',
  approved: 'Approved',
  publishing: 'Publishing…',
  published: 'Published',
  failed: 'Failed · tap to retry',
  hidden: 'Hidden',
};

