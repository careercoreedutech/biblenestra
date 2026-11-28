// POST FROM A LINK (dev update v1). A video from YouTube or Facebook is never downloaded or re-hosted: a post keeps
// only the provider, the canonical watch URL and display text, and the app plays the provider's own embed.
//   parseEmbedUrl(raw)        → { provider, videoId, url } | null   (exact allow-list; anything else is null)
//   buildEmbed(env, input)    → the stored embed object, validated (YouTube metadata fetched server-side, cached)
//   previewEmbed(env, raw)    → the same object for the composer's preview card
// Stored shape: { provider: 'youtube' | 'facebook', url, videoId, thumbnailUrl, title, authorName }
import { bad } from './http.js';

export const EMBED_PROVIDERS = ['youtube', 'facebook'];
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const FB_NUM = /^[0-9]{5,30}$/;
const FB_SLUG = /^[A-Za-z0-9._-]{1,120}$/;
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const FB_HOSTS = new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'fb.watch']);
const MAX_URL = 500;
const TTL_MS = 6 * 60 * 60 * 1000;
const memo = new Map(); // canonical YouTube url → { at, meta }

const yt = (id) => ({ provider: 'youtube', videoId: id, url: `https://www.youtube.com/watch?v=${id}` });
const fb = (id, url) => ({ provider: 'facebook', videoId: id, url });

/** Exact allow-list. Accepts https/http only, no credentials, no ports, no other hosts or paths. */
export function parseEmbedUrl(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s || s.length > MAX_URL || /\s/.test(s)) return null;
  let u;
  try { u = new URL(s); } catch (e) { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);

  if (YT_HOSTS.has(host)) {
    if (parts.length === 1 && parts[0] === 'watch') {
      const id = u.searchParams.get('v') || '';
      return YT_ID.test(id) ? yt(id) : null;
    }
    if (parts.length === 2 && parts[0] === 'shorts' && YT_ID.test(parts[1])) return yt(parts[1]);
    return null;
  }
  if (host === 'youtu.be') {
    return parts.length === 1 && YT_ID.test(parts[0]) ? yt(parts[0]) : null;
  }
  if (FB_HOSTS.has(host)) {
    if (host === 'fb.watch') {
      return parts.length === 1 && FB_SLUG.test(parts[0]) ? fb(parts[0], `https://fb.watch/${parts[0]}/`) : null;
    }
    if (parts.length === 1 && parts[0] === 'watch') {
      const id = u.searchParams.get('v') || '';
      return FB_NUM.test(id) ? fb(id, `https://www.facebook.com/watch/?v=${id}`) : null;
    }
    if (parts.length === 2 && parts[0] === 'reel' && FB_NUM.test(parts[1])) {
      return fb(parts[1], `https://www.facebook.com/reel/${parts[1]}/`);
    }
    // /{page}/videos/{id}  or  /{page}/videos/{slug}/{id}
    const last = parts[parts.length - 1] || '';
    if ((parts.length === 3 || parts.length === 4) && FB_SLUG.test(parts[0]) && parts[1] === 'videos'
      && FB_NUM.test(last) && (parts.length === 3 || FB_SLUG.test(parts[2]))) {
      return fb(last, `https://www.facebook.com/${parts.join('/')}/`);
    }
    return null;
  }
  return null;
}

/** Plain display text: control characters removed, trimmed, capped */
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) || null;

const fetcher = (env) => (env && env.__fetch) || fetch;

/** YouTube title and channel name from the public oEmbed endpoint (no API key). Cached 6 hours. */
export async function youtubeMeta(env, canonicalUrl, videoId) {
  const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`; // fixed host: the only thumbnail source we trust
  const hit = memo.get(canonicalUrl);
  if (hit && Date.now() - hit.at < TTL_MS) return { ...hit.meta, thumbnailUrl };
  let meta = { title: null, authorName: null };
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 6000) : null;
  try {
    const res = await fetcher(env)(`https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`, {
      headers: { Accept: 'application/json' }, signal: ctrl ? ctrl.signal : undefined,
    });
    if (res.ok) {
      const j = await res.json();
      meta = { title: clean(j.title, 160), authorName: clean(j.author_name, 80) };
    }
  } catch (e) { /* metadata is optional: the card falls back to the link */ } finally { if (timer) clearTimeout(timer); }
  if (memo.size > 500) memo.clear();
  memo.set(canonicalUrl, { at: Date.now(), meta });
  return { ...meta, thumbnailUrl };
}

/** Validate a provider/url pair and return the stored embed object. The videoId always comes from the URL. */
export async function buildEmbed(env, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('embed must be an object', 'BAD_EMBED');
  const p = parseEmbedUrl(input.url);
  if (!p) throw bad('Paste a YouTube or Facebook video link', 'BAD_EMBED');
  if (input.provider != null && input.provider !== p.provider) throw bad('That link is not from the chosen provider', 'BAD_EMBED');
  if (p.provider === 'youtube') {
    const m = await youtubeMeta(env, p.url, p.videoId);
    return { provider: 'youtube', url: p.url, videoId: p.videoId, thumbnailUrl: m.thumbnailUrl, title: m.title, authorName: m.authorName };
  }
  // Facebook has no public oEmbed without an app token: keep the URL and the title the author typed (optional)
  return { provider: 'facebook', url: p.url, videoId: p.videoId, thumbnailUrl: null, title: clean(input.title, 160), authorName: null };
}

/** Composer preview: the same object as buildEmbed, from a pasted link alone */
export async function previewEmbed(env, raw) {
  return buildEmbed(env, { url: raw });
}
