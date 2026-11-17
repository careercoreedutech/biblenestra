// Pure ad-rule logic (no React, no storage) — used by AdBreaks/remote and easy to reason about.
// The rules document comes from the Worker (GET /ads/config, edited in the admin "Ads" tab); the
// defaults below mirror backend/src/lib/ads.js DEFAULT_AD_CONFIG and are used until the first fetch
// succeeds (and in local mode).

export const DEFAULT_RULES = {
  enabled: true,
  surfaces: { video: true, audio: true, pdf: true, feed: true, reader: true },
  video: {
    preRoll: true,
    midRolls: true,
    skipAfterSec: 5,
    noticeSec: 3,
    minTailSec: 60,
    bands: [
      { fromMin: 0, ads: 1, unit: 'min', positions: [] },
      { fromMin: 4, ads: 1, unit: 'min', positions: [] },
      { fromMin: 8, ads: 2, unit: 'pct', positions: [50] },
      { fromMin: 20, ads: 3, unit: 'min', positions: [5, 12] },
    ],
  },
  audio: { preRoll: true, betweenEvery: 3, skipAfterSec: 5 },
  pdf: { preRoll: true, skipAfterSec: 5 },
  feed: { every: 3 },
  disabledCategories: [],
  caps: { minSecondsBetween: 120, maxPerHour: 6, maxPerDay: 30 },
};

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const num = (v, d, min, max) => {
  const n = Number(v);
  return v !== null && v !== '' && Number.isFinite(n) ? Math.min(Math.max(n, min), max) : d;
};

/** Lenient merge of a server document over the defaults (the server already validated it). */
export function mergeRules(input) {
  const d = DEFAULT_RULES;
  const r = isObj(input) ? input : {};
  const s = isObj(r.surfaces) ? r.surfaces : {};
  const v = isObj(r.video) ? r.video : {};
  const a = isObj(r.audio) ? r.audio : {};
  const p = isObj(r.pdf) ? r.pdf : {};
  const f = isObj(r.feed) ? r.feed : {};
  const c = isObj(r.caps) ? r.caps : {};
  let bands = Array.isArray(v.bands) ? v.bands.filter(isObj).map((b) => ({
    fromMin: num(b.fromMin, 0, 0, 600),
    ads: Math.round(num(b.ads, 0, 0, 6)),
    unit: b.unit === 'pct' ? 'pct' : 'min',
    positions: Array.isArray(b.positions) ? b.positions.map(Number).filter((x) => Number.isFinite(x) && x > 0) : [],
  })).sort((x, y) => x.fromMin - y.fromMin) : [];
  if (!bands.length) bands = d.video.bands;
  return {
    enabled: bool(r.enabled, d.enabled),
    surfaces: Object.fromEntries(Object.keys(d.surfaces).map((k) => [k, bool(s[k], d.surfaces[k])])),
    video: {
      preRoll: bool(v.preRoll, d.video.preRoll),
      midRolls: bool(v.midRolls, d.video.midRolls),
      skipAfterSec: num(v.skipAfterSec, d.video.skipAfterSec, 0, 60),
      noticeSec: num(v.noticeSec, d.video.noticeSec, 0, 10),
      minTailSec: num(v.minTailSec, d.video.minTailSec, 0, 600),
      bands,
    },
    audio: {
      preRoll: bool(a.preRoll, d.audio.preRoll),
      betweenEvery: Math.round(num(a.betweenEvery, d.audio.betweenEvery, 0, 50)),
      skipAfterSec: num(a.skipAfterSec, d.audio.skipAfterSec, 0, 60),
    },
    pdf: { preRoll: bool(p.preRoll, d.pdf.preRoll), skipAfterSec: num(p.skipAfterSec, d.pdf.skipAfterSec, 0, 60) },
    feed: { every: Math.round(num(f.every, d.feed.every, 2, 50)) },
    disabledCategories: Array.isArray(r.disabledCategories) ? r.disabledCategories.map((x) => String(x).trim().toLowerCase()).filter(Boolean) : [],
    caps: {
      minSecondsBetween: num(c.minSecondsBetween, d.caps.minSecondsBetween, 30, 3600),
      maxPerHour: num(c.maxPerHour, d.caps.maxPerHour, 0, 20),
      maxPerDay: num(c.maxPerDay, d.caps.maxPerDay, 0, 100),
    },
  };
}

const SKIP_DEFAULT = 5;
const off = (skipAfterSec = SKIP_DEFAULT) => ({ enabled: false, preRoll: 0, midRollsAt: [], skipAfterSec });

/** YouTube embeds must never get our ads (YouTube terms) — callers may pass source:'youtube' or a 'yt:' id. */
export function isYouTube({ source, category, contentId } = {}) {
  return String(source || '').toLowerCase() === 'youtube' || String(category || '').toLowerCase() === 'youtube'
    || /^(yt|youtube)[:_]/i.test(String(contentId || ''));
}

/** Is a surface allowed at all (master switch, surface flag, Plus, category list, YouTube)? */
export function surfaceAllowed(rules, kind, { premium = false, category, source, contentId } = {}) {
  if (premium || !rules || !rules.enabled) return false;
  if (!rules.surfaces || !rules.surfaces[kind]) return false;
  if (isYouTube({ source, category, contentId })) return false;
  const cat = String(category || '').trim().toLowerCase();
  if (cat && (rules.disabledCategories || []).includes(cat)) return false;
  return true;
}

/** Mid-roll times (seconds) for a video of durationSec under the given rules. */
export function videoMidRolls(rules, durationSec) {
  const v = rules.video;
  const dur = Math.max(0, Number(durationSec) || 0);
  if (!dur || !v.midRolls) return [];
  const band = bandFor(rules, dur);
  const count = Math.max(0, band.ads - 1);
  if (!count) return [];
  let pos = band.positions.slice(0, count).map((p) => (band.unit === 'pct' ? (dur * p) / 100 : p * 60));
  if (pos.length < count) pos = Array.from({ length: count }, (_, i) => (dur * (i + 1)) / (count + 1));
  const out = [];
  pos.filter((s) => s >= 30 && s <= dur - v.minTailSec).sort((a, b) => a - b).forEach((s) => {
    if (!out.length || s - out[out.length - 1] >= 60) out.push(Math.round(s)); // at least a minute apart
  });
  return out;
}

function bandFor(rules, dur) {
  let band = rules.video.bands[0];
  rules.video.bands.forEach((b) => { if (dur >= b.fromMin * 60) band = b; });
  return band;
}

/**
 * The ad plan for one piece of content. Shape is the shared AdBreaks interface:
 *   { enabled, preRoll: 0|1, midRollsAt: [sec…], betweenEvery?, skipAfterSec, noticeSec? }
 */
export function computePlan(rules, { kind, category, durationSec = 0, source, contentId } = {}, { premium = false } = {}) {
  const r = rules || DEFAULT_RULES;
  const section = (r[kind] && r[kind].skipAfterSec !== undefined) ? r[kind].skipAfterSec : SKIP_DEFAULT;
  if (!surfaceAllowed(r, kind, { premium, category, source, contentId })) {
    const p = off(section);
    if (kind === 'audio') p.betweenEvery = 0;
    return p;
  }
  if (kind === 'video') {
    const dur = Math.max(0, Number(durationSec) || 0);
    const band = bandFor(r, dur);
    const preRoll = r.video.preRoll && band.ads > 0 ? 1 : 0;
    const midRollsAt = videoMidRolls(r, dur);
    return { enabled: !!(preRoll || midRollsAt.length), preRoll, midRollsAt, skipAfterSec: r.video.skipAfterSec, noticeSec: r.video.noticeSec };
  }
  if (kind === 'audio') {
    const preRoll = r.audio.preRoll ? 1 : 0;
    const betweenEvery = r.audio.betweenEvery || 0;
    return { enabled: !!(preRoll || betweenEvery), preRoll, midRollsAt: [], betweenEvery, skipAfterSec: r.audio.skipAfterSec };
  }
  if (kind === 'pdf') {
    const preRoll = r.pdf.preRoll ? 1 : 0;
    return { enabled: !!preRoll, preRoll, midRollsAt: [], skipAfterSec: r.pdf.skipAfterSec };
  }
  if (kind === 'feed') return { enabled: true, preRoll: 0, midRollsAt: [], betweenEvery: r.feed.every, skipAfterSec: SKIP_DEFAULT };
  if (kind === 'reader') return { enabled: true, preRoll: 0, midRollsAt: [], skipAfterSec: SKIP_DEFAULT };
  return off();
}

/** Frequency caps for full-screen ads. history = impression timestamps (ms). Returns null if allowed, else a reason. */
export function capBlock(rules, history, now = Date.now()) {
  const c = (rules || DEFAULT_RULES).caps;
  const list = (history || []).filter((t) => now - t < 86400000);
  const last = list.length ? Math.max(...list) : 0;
  if (last && now - last < c.minSecondsBetween * 1000) return 'too_soon';
  if (list.filter((t) => now - t < 3600000).length >= c.maxPerHour) return 'hour_cap';
  if (list.length >= c.maxPerDay) return 'day_cap';
  return null;
}
