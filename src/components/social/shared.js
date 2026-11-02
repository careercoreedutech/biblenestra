// Shared constants + helpers for the unified Socials experience (feed cards, composer, reels).
import { Platform } from 'react-native';
import { colors } from '../../theme';
import { BOOKS, refLabel } from '../../data/bible';

export const ND = Platform.OS !== 'web'; // native driver where supported
export const WHITE = '#FFFFFF';
export const GLASS = 'rgba(0,0,0,0.38)';
export const GLASS_BORDER = 'rgba(255,255,255,0.16)';
export const ON_DARK_MUTED = 'rgba(255,255,255,0.72)';
export const TEXT_SHADOW = {
  textShadowColor: 'rgba(0,0,0,0.6)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 3,
};

// Social surface palette (immersive night family on the black Socials canvas)
export const SOCIAL = {
  page: '#000000',
  card: colors.night,
  cardRaised: colors.nightRaised,
  line: colors.nightBorder,
  fg: colors.nightFg,
  muted: colors.nightMuted,
  faint: 'rgba(244,239,230,0.45)',
};

// Dark card themes offered for text posts (white serif text sits on these). null = plain post.
export const CONTENT_THEMES = [colors.night, colors.primaryInk, colors.teal, colors.lavender];

// Media library the composer offers (no native picker is bundled — web can also add from device).
export const SAMPLE_VIDEOS = [
  { id: 'sv1', title: 'Sanctuary Worship & Altar', url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', duration: '0:45' },
  { id: 'sv2', title: 'Acoustic Praise Session', url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/friday.mp4', duration: '0:38' },
];

export const SAMPLE_IMAGES = [
  { id: 'si1', title: 'Believers In Prayer', url: 'https://images.unsplash.com/photo-1609234656388-0ff363383899?auto=format&fit=crop&w=900&q=80' },
  { id: 'si2', title: 'Open Scripture Meditation', url: 'https://images.unsplash.com/photo-1504052434569-70ad5836ab65?auto=format&fit=crop&w=900&q=80' },
  { id: 'si3', title: 'Altar Candle of Faith', url: 'https://images.unsplash.com/photo-1603006905003-be475563bc59?auto=format&fit=crop&w=900&q=80' },
  { id: 'si4', title: 'Sunrise Over the Hills', url: 'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?auto=format&fit=crop&w=900&q=80' },
  { id: 'si5', title: 'Worship Night', url: 'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?auto=format&fit=crop&w=900&q=80' },
  { id: 'si6', title: 'Quiet Chapel', url: 'https://images.unsplash.com/photo-1438032005730-c779502df39b?auto=format&fit=crop&w=900&q=80' },
];
export const MAX_PHOTOS = 4;

// "Matthew 1:5", "Psalm 23", "1 John 4:8", "Song of Solomon 2:4" → { bookId, chapter, verse }
const normBook = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function parseScriptureRef(ref) {
  const m = String(ref || '').trim().match(/^(.+?)\s*(\d+)(?:\s*[:.]\s*(\d+))?/);
  if (!m) return null;
  const n = normBook(m[1]);
  if (!n) return null;
  const book =
    BOOKS.find((b) => normBook(b.name) === n || normBook(b.slug) === n || b.id.toLowerCase() === n) ||
    BOOKS.find((b) => normBook(b.name).startsWith(n) || n.startsWith(normBook(b.name)));
  if (!book) return null;
  const chapter = Math.min(Math.max(parseInt(m[2], 10) || 1, 1), book.chapters || 1);
  const verse = m[3] ? parseInt(m[3], 10) : null;
  return verse ? { bookId: book.id, chapter, verse } : { bookId: book.id, chapter };
}

export const passageLabel = (p) => (p ? refLabel(p.bookId, p.chapter, p.verse) : '');

export function formatCount(n) {
  const v = Number(n) || 0;
  if (v >= 1000000) return `${(v / 1000000).toFixed(v >= 10000000 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (v >= 10000) return `${(v / 1000).toFixed(v >= 100000 ? 0 : 1).replace(/\.0$/, '')}K`;
  // Exact below 10K so a like/share visibly changes the number
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
export const countFormat = (n) => formatCount(Math.round(n));

// ─── Time ordering for the mixed feed ────────────────────────────
// Items created in-app carry a timestamp (createdAt, or an id like 'f1730000000000');
// seed items only have a relative label ("3h", "1d", "Just now").
const UNIT = { m: 60e3, min: 60e3, h: 3600e3, hr: 3600e3, d: 86400e3, w: 604800e3 };
export function timestampOf(item, now = Date.now()) {
  if (!item) return 0;
  if (item.createdAt) return Number(item.createdAt) || 0;
  const idNum = String(item.id || '').match(/(\d{12,})/);
  if (idNum) return Number(idNum[1]);
  const t = String(item.time || '').trim().toLowerCase();
  if (!t) return 0;
  if (t === 'just now' || t === 'now') return now;
  if (t === 'yesterday') return now - 86400e3;
  const m = t.match(/^(\d+)\s*(min|m|hr|h|d|w)/);
  if (m) return now - Number(m[1]) * UNIT[m[2]];
  return 0;
}

export function relTime(ts, fallback) {
  if (!ts) return fallback || '';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / 604800)}w`;
}

export function initials(name = '') {
  return String(name).split(' ').filter(Boolean).map((x) => x[0]).slice(0, 2).join('').toUpperCase() || '?';
}

export const AVATAR_TINTS = [colors.primary, colors.sage, colors.rose, colors.lavender, colors.sky, colors.teal, colors.terracotta];
export const tintFor = (name = '') => AVATAR_TINTS[((String(name).charCodeAt(0) || 0) + (String(name).length || 0)) % AVATAR_TINTS.length];

// Badge tint for a post kind
export function kindTint(kind) {
  return (
    {
      Announcement: colors.sky,
      Celebration: colors.goldLight,
      Reflection: colors.sage,
      Study: colors.lavender,
      Testimony: colors.rose,
      Prayer: colors.teal,
      Question: colors.sky,
      Photo: colors.goldLight,
      Video: colors.goldLight,
      Repost: colors.goldLight,
    }[kind] || colors.goldLight
  );
}

// ─── Web-only "add from device": read + downscale photos to persistable JPEG data URLs ───
function downscale(file, max = 1080, quality = 0.78) {
  return new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onerror = () => resolve(null);
      reader.onload = () => {
        const img = new window.Image();
        img.onerror = () => resolve(null);
        img.onload = () => {
          try {
            const s = Math.min(1, max / Math.max(img.width || 1, img.height || 1));
            const c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(img.width * s));
            c.height = Math.max(1, Math.round(img.height * s));
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            resolve(c.toDataURL('image/jpeg', quality));
          } catch (e) {
            resolve(null);
          }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    } catch (e) {
      resolve(null);
    }
  });
}

export const canPickFromDevice = Platform.OS === 'web' && typeof document !== 'undefined';

export function pickDevicePhotos(max = MAX_PHOTOS) {
  if (!canPickFromDevice) return Promise.resolve([]);
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = max > 1;
    input.onchange = async () => {
      const files = Array.from(input.files || []).slice(0, max);
      const urls = await Promise.all(files.map((f) => downscale(f)));
      resolve(urls.filter(Boolean));
    };
    input.click();
  });
}
