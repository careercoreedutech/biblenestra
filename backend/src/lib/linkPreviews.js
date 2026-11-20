// CHAT GAPS — rich link-preview cards for chat messages.
//   firstLinkUrl(text)                 → the first https:// URL in a message, normalised (or null)
//   ensureLinkPreview(env, url)        → fetch + cache the card in link_previews (TTL); never throws
//   scheduleLinkPreview(c, url, after) → runs ensureLinkPreview after the response (ctx.waitUntil), then `after()`
//   previewsFor(env, urls)             → Map(url → card) of cached, successful previews
// Same SSRF rules as member websites (lib/websites.js): https only, public host names, no IPs / localhost / ports.
// Redirects are followed by hand so every hop is checked against those rules too.
import { q, one } from './db.js';
import { normalizeWebsiteUrl, fetchSiteMeta } from './websites.js';

export const PREVIEW_TTL_DAYS = 7; // a good card is refreshed after a week
export const FAILED_RETRY_HOURS = 12; // a page we couldn't read is tried again after half a day
const MAX_REDIRECTS = 4;
const LINK_RE = /https:\/\/[^\s<>"'`]+/i;

/** The first https URL in the text, cleaned (trailing punctuation dropped), or null when there is none / it isn't allowed. */
export function firstLinkUrl(text) {
  const m = String(text || '').match(LINK_RE);
  if (!m) return null;
  const raw = m[0].replace(/[).,!?;:'"\]]+$/, '');
  try { return normalizeWebsiteUrl(raw).url; } catch (e) { return null; }
}

// fetch that follows redirects itself, refusing any hop that isn't a public https address.
// Returns a small Response-like object ({ ok, url, headers, text }) for fetchSiteMeta.
function safeFetcher(env) {
  const base = (env && env.__fetch) || fetch;
  return async (url, init = {}) => {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await base(current, { ...init, redirect: 'manual' });
      if (res && res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) return null;
        let next;
        try { next = normalizeWebsiteUrl(new URL(loc, current).toString()).url; } catch (e) { return null; }
        current = next;
        continue;
      }
      if (!res) return null;
      return { ok: res.ok, status: res.status, url: current, headers: res.headers, text: () => res.text() };
    }
    return null;
  };
}

const cardOf = (r) => (r && r.status === 'ok' ? {
  url: r.url,
  title: r.title || null,
  description: r.description || null,
  image: r.image || null,
  siteName: r.site_name || null,
} : null);

/** Fetch (or reuse) the preview card for one normalised URL. Returns the card or null. Never throws. */
export async function ensureLinkPreview(env, url) {
  try {
    if (!url) return null;
    const cached = await one(env, `SELECT *, (CASE WHEN status = 'ok' THEN fetched_at > now() - $2::int * interval '1 day'
        ELSE fetched_at > now() - $3::int * interval '1 hour' END) AS fresh FROM link_previews WHERE url = $1`, [url, PREVIEW_TTL_DAYS, FAILED_RETRY_HOURS]);
    if (cached && cached.fresh) return cardOf(cached);
    const meta = await fetchSiteMeta({ ...env, __fetch: safeFetcher(env) }, url);
    let host = null;
    try { host = new URL(meta.finalUrl || url).hostname.replace(/^www\./, ''); } catch (e) { /* keep null */ }
    const ok = !!(meta.title || meta.description || meta.image);
    const row = await one(env, `INSERT INTO link_previews (url, status, title, description, image, site_name, final_url, fetched_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, now())
        ON CONFLICT (url) DO UPDATE SET status = EXCLUDED.status, title = EXCLUDED.title, description = EXCLUDED.description,
          image = EXCLUDED.image, site_name = EXCLUDED.site_name, final_url = EXCLUDED.final_url, fetched_at = now()
        RETURNING *`,
    [url, ok ? 'ok' : 'failed', meta.title ? meta.title.slice(0, 160) : null, meta.description ? meta.description.slice(0, 300) : null,
      meta.image && /^https:\/\//i.test(meta.image) ? meta.image.slice(0, 1000) : null, host, (meta.finalUrl || url).slice(0, 1000)]);
    return cardOf(row);
  } catch (e) {
    return null;
  }
}

/** Is there a usable cached card already? (cheap; used right after sending so a known link shows its card at once) */
export async function cachedPreview(env, url) {
  if (!url) return null;
  const r = await one(env, `SELECT * FROM link_previews WHERE url = $1 AND status = 'ok'`, [url]).catch(() => null);
  return cardOf(r);
}

export async function previewsFor(env, urls) {
  const list = [...new Set((urls || []).filter(Boolean))];
  if (!list.length) return new Map();
  const rows = await q(env, `SELECT * FROM link_previews WHERE url = ANY($1::text[]) AND status = 'ok'`, [list]).catch(() => []);
  return new Map(rows.map((r) => [r.url, cardOf(r)]));
}

/**
 * Run the fetch after the response has gone out (Workers: ctx.waitUntil), so sending never waits for a
 * slow website. Without an execution context (local dev server / tests) it only runs when a fetch stub is
 * configured (env.__fetch) or LINK_PREVIEWS=on, so tests never reach the internet.
 */
export function scheduleLinkPreview(c, url, after) {
  const flag = String(c.env.LINK_PREVIEWS || '').toLowerCase();
  if (!url || flag === 'off') return null;
  let ctx = null;
  try { ctx = c.executionCtx; } catch (e) { ctx = null; } // Hono throws when there is none
  const background = ctx && typeof ctx.waitUntil === 'function';
  if (!background && !c.env.__fetch && flag !== 'on') return null;
  const task = (async () => {
    const card = await ensureLinkPreview(c.env, url);
    if (card && after) await after(card);
  })().catch(() => {});
  if (background) ctx.waitUntil(task);
  return task;
}
