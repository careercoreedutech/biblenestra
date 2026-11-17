// Small helpers shared by the video player pieces (src/components/video/*).
import { Image, Platform } from 'react-native';

export const IS_WEB = Platform.OS === 'web';
export const LONG_VIDEO_SEC = 60; // from here on: always-visible scrubber + times, no looping

/** 75 → "1:15", 3725 → "1:02:05" */
export function fmtTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/** "1:02:05" | "2:15" | 135 → seconds (0 when unknown) */
export function parseDuration(d) {
  if (typeof d === 'number') return Number.isFinite(d) ? d : 0;
  if (!d || typeof d !== 'string') return 0;
  const parts = d.split(':').map((x) => Number(x));
  if (!parts.length || parts.some((x) => !Number.isFinite(x))) return 0;
  return parts.reduce((acc, x) => acc * 60 + x, 0);
}

// Poster sizes → orientation (the poster frame has the video's aspect ratio). Cached per URL.
const sizes = new Map();
export function posterSize(uri) {
  if (!uri) return Promise.resolve(null);
  if (sizes.has(uri)) return sizes.get(uri);
  const p = new Promise((resolve) => {
    try {
      Image.getSize(uri, (width, height) => resolve(width && height ? { width, height } : null), () => resolve(null));
    } catch (e) {
      resolve(null);
    }
  });
  sizes.set(uri, p);
  return p;
}

/** A store video item → what the player needs */
export function toPlayable(v) {
  return {
    id: v.id,
    videoUrl: v.videoUrl || null,
    poster: v.poster || null,
    category: v.category || 'Video',
    durationSec: parseDuration(v.durationSec || v.duration),
    raw: v,
  };
}

// expo-video's web <video> is a replaced element: `inset: 0` alone leaves it at its intrinsic size (a 720p
// clip overflows the card, a small one doesn't fill it). Width / height 100% makes it fill on every platform.
export const VIDEO_FILL = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' };
