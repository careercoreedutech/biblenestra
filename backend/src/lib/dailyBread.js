// TODAY'S JOURNEY — Daily Bread (a scheduled verse of the day + admin image + optional reflection), blessing
// videos (admin uploads, played full screen in the app), the 'daily_journey.auto_highlight' flag, and
// WATCH ON TODAY (latest videos from the admin-connected YouTube channels, aggregated from their public RSS
// feeds — no API key — and cached in the database for ~30 minutes).
import { one, q } from './db.js';
import { mediaUrl } from './shape.js';
import { normaliseRef } from './scripture.js';
import { channelVideos, playlistVideos } from './youtube.js';

export const AUTO_HIGHLIGHT_KEY = 'daily_journey.auto_highlight';
export const LATEST_TTL_MS = 30 * 60 * 1000;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isoDay = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));
const fileUrl = (env, origin, key) => (!key ? null : /^https:\/\//.test(key) ? key : mediaUrl(env, origin, key));

/** "Psalm 23:1", "John 3:16-18", "PSA 23:1" → { bookId, chapter, verse, verseEnd, label } | null */
export function parseVerseRef(input) {
  const s = String(input || '').trim();
  if (!s || s.length > 60) return null;
  const hit = normaliseRef(s);
  if (!hit) return null;
  const m = /^([1-3]?[A-Z]{2,3}) (\d+)(?::(\d+))?$/.exec(hit.ref);
  if (!m || !m[3]) return null; // a verse is required (not just a chapter)
  const end = /-(\d+)$/.exec(hit.label);
  const verse = Number(m[3]);
  const verseEnd = end && Number(end[1]) > verse ? Number(end[1]) : null;
  return { bookId: m[1], chapter: Number(m[2]), verse, verseEnd, label: hit.label };
}

export const breadShape = (env, origin, r) => (!r ? null : {
  date: isoDay(r.day_s || r.day),
  ref: `${r.book_id} ${r.chapter}:${r.verse}${r.verse_end ? `-${r.verse_end}` : ''}`,
  bookId: r.book_id,
  chapter: r.chapter,
  verse: r.verse,
  verseEnd: r.verse_end || null,
  label: r.label,
  imageUrl: fileUrl(env, origin, r.image_key),
  imageKey: r.image_key || null,
  reflection: r.reflection || '',
  updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
});

export const videoShape = (env, origin, r) => ({
  id: r.id,
  title: r.title,
  description: r.description || '',
  videoUrl: fileUrl(env, origin, r.video_key),
  poster: fileUrl(env, origin, r.thumb_key),
  durationSec: r.duration_sec || null,
  width: r.width || null,
  height: r.height || null,
  publishOn: isoDay(r.publish_on_s || r.publish_on),
  hidden: !!r.hidden,
  createdAt: new Date(r.created_at).toISOString(),
});

export async function getSetting(env, key, fallback) {
  const r = await one(env, 'SELECT value FROM daily_settings WHERE key = $1', [key]);
  return r ? r.value : fallback;
}
export async function setSetting(env, key, value) {
  await q(env, `INSERT INTO daily_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [key, JSON.stringify(value)]);
}

// ---------- WATCH ON TODAY ----------
const chMini = (ch) => ({ id: ch.id, channelId: ch.channel_id, title: ch.title, handle: ch.handle || null, avatarUrl: ch.avatar_url || null });
const signature = (channels) => channels.map((ch) => [ch.id, ch.today_source, ch.today_playlist_id || '', ch.today_shorts ? 1 : 0].join(':')).join('|');
const slimVideo = (v) => ({ videoId: v.videoId, title: v.title, published: v.published, thumbnail: v.thumbnail, isShort: !!v.isShort, url: v.url });

/**
 * Latest videos from the active channels shown on Today.
 * → { items: [video + channel] (newest first, at most `perChannel` from one channel), groups: [{ channel, videos }], fetchedAt }
 * The feeds are re-read when the cache is older than LATEST_TTL_MS, when the channel set / options change, or with force.
 * A channel whose feed fails keeps its previous videos.
 */
export async function latestChannelVideos(env, { force = false, limit = 20, perChannel = 4 } = {}) {
  const channels = await q(env, `SELECT * FROM youtube_channels WHERE active AND show_on_today
    ORDER BY featured DESC, sort_order, created_at LIMIT 30`);
  const sig = signature(channels);
  const cached = await one(env, 'SELECT data, fetched_at FROM youtube_latest_cache WHERE id = 1');
  let data = cached ? cached.data : null;
  let fetchedAt = cached ? new Date(cached.fetched_at) : null;
  const fresh = data && data.sig === sig && fetchedAt && Date.now() - fetchedAt.getTime() < LATEST_TTL_MS;
  if (!fresh || force) {
    const oldGroups = new Map(((data && data.groups) || []).map((g) => [g.channelId, g]));
    const groups = await Promise.all(channels.map(async (ch) => {
      try {
        const usePlaylist = ch.today_source === 'playlist' && ch.today_playlist_id;
        const feed = usePlaylist
          ? await playlistVideos(env, ch.today_playlist_id, { cache: !force })
          : await channelVideos(env, ch.channel_id, { cache: !force });
        const videos = feed.videos.filter((v) => ch.today_shorts || !v.isShort).slice(0, 15).map(slimVideo);
        return { channelId: ch.id, videos };
      } catch (e) {
        const old = oldGroups.get(ch.id);
        return { channelId: ch.id, videos: old ? old.videos : [], error: true };
      }
    }));
    data = { sig, groups };
    fetchedAt = new Date();
    await q(env, `INSERT INTO youtube_latest_cache (id, data, fetched_at) VALUES (1, $1::jsonb, now())
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, fetched_at = now()`, [JSON.stringify(data)]);
  }
  const hidden = new Set((await q(env, 'SELECT video_id FROM youtube_hidden_videos')).map((r) => r.video_id));
  const byId = new Map(channels.map((ch) => [ch.id, ch]));
  const groups = (data.groups || [])
    .filter((g) => byId.has(g.channelId))
    .map((g) => ({ channel: chMini(byId.get(g.channelId)), videos: g.videos.filter((v) => !hidden.has(v.videoId)) }))
    .filter((g) => g.videos.length);
  const pool = [];
  for (const g of groups) g.videos.slice(0, perChannel).forEach((v) => pool.push({ ...v, channel: g.channel }));
  pool.sort((a, z) => String(z.published || '').localeCompare(String(a.published || '')));
  return { items: pool.slice(0, limit), groups, fetchedAt: fetchedAt ? fetchedAt.toISOString() : null };
}

/** Pull an 11-char video id out of whatever the admin pasted (id, watch link, youtu.be, shorts, live) */
export function videoIdFrom(input) {
  const s = String(input || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = /(?:v=|youtu\.be\/|\/shorts\/|\/live\/|\/embed\/)([A-Za-z0-9_-]{11})/.exec(s);
  return m ? m[1] : null;
}
