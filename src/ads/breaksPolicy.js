// Interstitial breaks: the pure rules (no React, no storage, no imports), so they can be reasoned about and tested.
// The server sends the numbers (GET /ads/config → breaks, registerConfig 'ad_breaks'); these defaults mirror
// backend/src/lib/ads.js DEFAULT_BREAK_RULES and are used until the first fetch succeeds.
//
// A break is due after `activeMinutes` of foreground use (see src/ads/breaks.js for the counting). It never comes closer
// than `minGapMinutes` to the previous one, and never more than `maxPerHour` / `maxPerDay` times. `0` for a cap means none.

export const DEFAULT_CLIENT_BREAK_RULES = Object.freeze({
  enabled: true,
  activeMinutes: 5,
  minGapMinutes: 15,
  maxPerHour: 2,
  maxPerDay: 6,
  bookListFirstOpen: true,
});

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const whole = (v, d, min, max) => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isInteger(n) && n >= min && n <= max ? n : d;
};

/** Lenient merge of the server's break rules over the defaults. */
export function mergeBreakRules(input) {
  const d = DEFAULT_CLIENT_BREAK_RULES;
  const o = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : d.enabled,
    activeMinutes: whole(o.activeMinutes, d.activeMinutes, 1, 120),
    minGapMinutes: whole(o.minGapMinutes, d.minGapMinutes, 0, 1440),
    maxPerHour: whole(o.maxPerHour, d.maxPerHour, 0, 20),
    maxPerDay: whole(o.maxPerDay, d.maxPerDay, 0, 100),
    bookListFirstOpen: typeof o.bookListFirstOpen === 'boolean' ? o.bookListFirstOpen : d.bookListFirstOpen,
  };
}

/**
 * Why a break may not be shown right now, or null when it may.
 *   'premium' | 'off' | 'too_soon' | 'hour_cap' | 'day_cap'
 * state.history = times (ms) of breaks already shown. opts: { premium, adsEnabled }.
 */
export function breakBlock(rules, state, now = Date.now(), opts = {}) {
  const r = rules || DEFAULT_CLIENT_BREAK_RULES;
  if (opts.premium) return 'premium';
  if (!r.enabled || opts.adsEnabled === false) return 'off';
  const h = ((state && state.history) || []).filter((t) => now - t < DAY);
  const last = h.length ? Math.max(...h) : 0;
  if (last && now - last < r.minGapMinutes * MIN) return 'too_soon';
  if (h.filter((t) => now - t < HOUR).length >= r.maxPerHour) return 'hour_cap';
  if (h.length >= r.maxPerDay) return 'day_cap';
  return null;
}

/** The earliest time a break could be shown, given the history (now when one is allowed already). */
export function nextBreakAt(rules, state, now = Date.now()) {
  const r = rules || DEFAULT_CLIENT_BREAK_RULES;
  const h = ((state && state.history) || []).filter((t) => now - t < DAY).sort((a, b) => a - b);
  if (!h.length) return now;
  const why = breakBlock(r, { history: h }, now);
  if (why === null) return now;
  const last = h[h.length - 1];
  const gapAt = last + r.minGapMinutes * MIN;
  const inHour = h.filter((t) => now - t < HOUR);
  const hourAt = inHour.length >= r.maxPerHour && inHour.length ? inHour[inHour.length - r.maxPerHour] + HOUR : 0;
  const dayAt = h.length >= r.maxPerDay ? h[h.length - r.maxPerDay] + DAY : 0;
  return Math.max(now, gapAt, hourAt, dayAt);
}

// Screens where a full-screen ad must never appear: reading, recording and sermon notes, prayer, live or video playback,
// and anything about paying or subscribing. The name is the top route's name in App.js ROUTES.
const BLOCKED = new Set([
  // reading and study
  'Bible', 'BookReader', 'ExtraBook', 'Reading', 'Lesson', 'LessonPreview', 'DevotionalPreview', 'Transcript', 'Study',
  // recording and sermon studio
  'SermonStudio', 'RecordingDetail', 'Recording',
  // prayer
  'Prayer', 'PrayerWall', 'PrayerTab', 'PrayerDetail', 'NewPrayer',
  // calls, live and video playback
  'Live', 'Watch', 'YouTubeWatch', 'EmbedViewer', 'BlessingVideos', 'ChannelVideos', 'Battle', 'ContestEntry', 'ContestSubmit',
  // checkout, subscriptions and money
  'Membership', 'MembershipHome', 'Memberships', 'DatingPlans', 'DatingBoost', 'DatingVerify', 'GiftStore', 'GiftEarnings',
  'FundMeCredits', 'FundMeGiftCredits', 'FundMeMoney', 'FundMePayoutAccount', 'PayoutKyc',
]);

/** Is a full-screen ad forbidden on this route name? */
export function isBlockedRoute(name) {
  return BLOCKED.has(String(name || ''));
}
