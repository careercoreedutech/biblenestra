// NOTIFICATIONS + WIDGETS: the one place for the cinematic photos used by the black-and-gold notification
// cards (in-app notification centre), rich notifications and the Android home-screen widgets.
// All images are royalty-free photos from Unsplash (https://unsplash.com/license — free to use, no
// attribution required) and are already used elsewhere in the app. Swap any URL here to change it everywhere.
const U = (id, w = 900) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=70`;

const IDS = {
  scripture: '1504052434569-70ad5836ab65', // light over an open Bible
  devotional: '1470252649378-9c29740c9fa8', // sunrise over the hills
  prayer: '1609234656388-0ff363383899', // believers in prayer
  encouragement: '1603006905003-be475563bc59', // warm candle glow
  community: '1438032005730-c779502df39b', // quiet chapel
  broadcast: '1501281668745-f7f57925c3b4', // worship night
  companion: '1519681393784-d120267933ba', // starry mountain sky
};

/** Card / notification image for a moment type (falls back to the scripture photo). */
export function imageFor(type, w) {
  return U(IDS[type] || IDS.scripture, w);
}

export const IMAGERY = Object.fromEntries(Object.keys(IDS).map((k) => [k, U(IDS[k])]));

// Black-and-gold palette shared by the notification cards, settings preview and widgets.
export const GOLD = {
  gold: '#D4A852', // titles, references, CTAs
  goldDeep: '#C9A45C', // Android notification accent colour
  goldLine: 'rgba(212,168,82,0.38)', // thin warm border
  goldGlow: 'rgba(212,168,82,0.22)',
  card: 'rgba(14,12,11,0.94)', // dark translucent card
  cardSolid: '#0E0C0B',
  white: '#F7F2E8',
  grey: 'rgba(247,242,232,0.58)',
  faint: 'rgba(247,242,232,0.42)',
};
