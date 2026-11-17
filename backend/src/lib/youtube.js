// YouTube without an API key: recent videos come from the channel's public RSS feed, channel ids are
// resolved from the channel page's canonical link. Responses are cached for 15 minutes.
const FEED = (id) => `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(id)}`;
const TTL_MS = 15 * 60 * 1000;
const memo = new Map(); // url → { at, text }

export const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
export const liveEmbedUrl = (channelId) => `https://www.youtube.com/embed/live_stream?channel=${channelId}`;
export const channelUrl = (row) => (row.handle ? `https://www.youtube.com/@${row.handle}` : `https://www.youtube.com/channel/${row.channel_id}`);

const fetcher = (env) => (env && env.__fetch) || fetch;

async function getText(env, url, { cache = true } = {}) {
  const hit = memo.get(url);
  if (cache && hit && Date.now() - hit.at < TTL_MS) return hit.text;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 8000) : null;
  let res;
  try {
    res = await fetcher(env)(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BibleNestraBot/1.0)', 'Accept-Language': 'en', Cookie: 'CONSENT=YES+1' },
      signal: ctrl ? ctrl.signal : undefined,
      cf: { cacheTtl: 900, cacheEverything: true },
    });
  } finally { if (timer) clearTimeout(timer); }
  if (!res.ok) { const e = new Error(`YouTube answered ${res.status}`); e.status = res.status; throw e; }
  const text = await res.text();
  if (cache) {
    if (memo.size > 300) memo.clear();
    memo.set(url, { at: Date.now(), text });
  }
  return text;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodeXml(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
      if (e[0] === '#') {
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
      }
      return ENTITIES[e.toLowerCase()] || m;
    });
}
const tag = (xml, name) => { const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml); return m ? decodeXml(m[1]).trim() : ''; };
const attr = (xml, name, a) => { const m = new RegExp(`<${name}\\s[^>]*?${a}="([^"]*)"`).exec(xml); return m ? decodeXml(m[1]) : ''; };

/** Parse a channel RSS feed → { title, channelId, videos[] } (pure string parsing, no XML library) */
export function parseFeed(xml, limit = 15) {
  const text = String(xml || '');
  const head = text.split('<entry>')[0];
  const videos = [];
  const re = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = re.exec(text)) && videos.length < limit) {
    const e = m[1];
    const videoId = tag(e, 'yt:videoId');
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) continue;
    const link = attr(e, 'link', 'href');
    const views = Number(attr(e, 'media:statistics', 'views'));
    videos.push({
      videoId,
      title: tag(e, 'title') || tag(e, 'media:title'),
      published: tag(e, 'published') || null,
      thumbnail: attr(e, 'media:thumbnail', 'url') || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      description: tag(e, 'media:description').slice(0, 400),
      views: Number.isFinite(views) ? views : null,
      isShort: /\/shorts\//.test(link),
      url: link && /^https:\/\/(www\.)?youtube\.com\//.test(link) ? link : `https://www.youtube.com/watch?v=${videoId}`,
      embedUrl: `https://www.youtube.com/embed/${videoId}?playsinline=1&rel=0&modestbranding=1`,
    });
  }
  return { title: tag(head, 'title'), channelId: tag(head, 'yt:channelId') || null, videos };
}

export async function channelVideos(env, channelId, { cache = true } = {}) {
  const xml = await getText(env, FEED(channelId), { cache });
  return parseFeed(xml);
}

export const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
export const videoEmbedUrl = (videoId) => `https://www.youtube.com/embed/${videoId}?playsinline=1&rel=0&modestbranding=1`;

/** "UC…", "https://youtube.com/channel/UC…", "@handle", "https://www.youtube.com/@handle", "/c/name", "/user/name" */
export function parseChannelInput(input) {
  const s = String(input || '').trim();
  if (!s || s.length > 300) return null;
  if (CHANNEL_ID_RE.test(s)) return { channelId: s };
  if (/^@[\w.-]{2,100}$/.test(s)) return { handle: s.slice(1), page: `https://www.youtube.com/${s}` };
  let u;
  try { u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch (e) { return null; }
  if (!/(^|\.)youtube\.com$/i.test(u.hostname) && !/^youtu\.be$/i.test(u.hostname)) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts[0] === 'channel' && CHANNEL_ID_RE.test(parts[1] || '')) return { channelId: parts[1] };
  if (parts[0] && parts[0].startsWith('@')) return { handle: decodeURIComponent(parts[0].slice(1)), page: `https://www.youtube.com/${parts[0]}` };
  if ((parts[0] === 'c' || parts[0] === 'user') && parts[1]) return { page: `https://www.youtube.com/${parts[0]}/${parts[1]}` };
  return null;
}

/** Read the canonical channel id (+ title, avatar, handle) from a channel page's HTML */
export function parseChannelPage(html) {
  const h = String(html || '');
  const id = (/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})"/.exec(h)
    || /<meta itemprop="(?:identifier|channelId)" content="(UC[A-Za-z0-9_-]{22})"/.exec(h)
    || /"(?:externalId|channelId)":"(UC[A-Za-z0-9_-]{22})"/.exec(h) || [])[1] || null;
  const meta = (p) => { const m = new RegExp(`<meta (?:property|name)="${p}" content="([^"]*)"`).exec(h); return m ? decodeXml(m[1]) : ''; };
  const handle = (/"canonicalBaseUrl":"\/@([\w.-]+)"/.exec(h) || /<link rel="alternate" href="https:\/\/www\.youtube\.com\/@([\w.-]+)"/.exec(h) || [])[1] || null;
  return { channelId: id, title: meta('og:title') || null, avatarUrl: meta('og:image') || null, handle };
}

/** Resolve whatever the admin pasted → { channelId, title, handle, avatarUrl } (throws a friendly Error) */
export async function resolveChannel(env, input) {
  const p = parseChannelInput(input);
  if (!p) throw new Error('Paste a YouTube channel link, an @handle or a channel id (UC…)');
  let info = { channelId: p.channelId || null, title: null, handle: p.handle || null, avatarUrl: null };
  const page = p.page || (p.channelId ? `https://www.youtube.com/channel/${p.channelId}` : null);
  if (page) {
    try {
      const got = parseChannelPage(await getText(env, page, { cache: false }));
      info = { channelId: info.channelId || got.channelId, title: got.title, handle: info.handle || got.handle, avatarUrl: got.avatarUrl };
    } catch (e) {
      if (!info.channelId) throw new Error('Couldn’t open that channel page on YouTube — check the link');
    }
  }
  if (!info.channelId) throw new Error('Couldn’t find the channel id on that page — paste the channel id (UC…) instead');
  try {
    const feed = await channelVideos(env, info.channelId);
    info.title = info.title || feed.title;
  } catch (e) {
    if (!info.title) throw new Error('YouTube has no public feed for that channel id');
  }
  info.title = String(info.title || info.handle || info.channelId).slice(0, 120);
  return info;
}
