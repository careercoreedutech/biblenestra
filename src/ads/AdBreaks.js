// Ad breaks for content players (video, audio, PDF). SHARED INTERFACE — players call only these functions.
//
//   import { useAdBreaks } from '../ads/AdBreaks';
//   const breaks = useAdBreaks();
//   const plan = breaks.planFor({ kind: 'video', category: 'sermon', durationSec: 1200 });
//     → { enabled, preRoll: 0|1, midRollsAt: [300, 720] (seconds), skipAfterSec: 5, noticeSec: 3 }
//       (audio also has betweenEvery: N → an ad between every N tracks; 0 = never)
//   await breaks.run({ kind: 'video', placement: 'pre' | 'mid' | 'between', contentId, category });
//     → { shown: boolean }   (always resolves; never throws; never blocks content for long)
//
// kinds: 'video' | 'audio' | 'pdf' | 'feed'. The ads system (src/ads/*) decides whether an ad really shows
// (remote rules from the admin dashboard, Plus members, frequency caps) — players must not decide that.
//
// How it decides (see ./rules.js and ./remote.js):
// - Rules come from GET /ads/config (admin "Ads" tab), cached on the device, refreshed every ~10 min and
//   when the app returns to the foreground; built-in defaults until then.
// - No ads for Plus members, when the master switch / the surface is off, for categories the admin
//   disabled, or for YouTube content (pass source: 'youtube' or a 'yt:' contentId — YouTube's terms forbid
//   overlaying ads on its embeds).
// - run() shows a full-screen interstitial (AdMob) or the demo ad (web / Expo Go). It never shows an ad
//   while the app is in the background (e.g. audio continuing on a locked screen), respects the frequency
//   caps, and gives up if no ad has opened within ~15 s, so content is never held up for long.
// - Mid-rolls: show your own "Ad break" notice for plan.noticeSec seconds before calling run().
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAds } from './Ads';
import { computePlan, isYouTube, surfaceAllowed } from './rules';
import { getRules, isAppActive, isPremium, subscribeRules } from './remote';

export { isAppActive };

const LOAD_TIMEOUT_MS = 15000;
const HARD_TIMEOUT_MS = 15000 + 3 * 60 * 1000; // an open ad can play up to a few minutes; then we move on

/** The current plan for a piece of content (pure; uses the cached remote rules). */
export function planFor({ kind, category, durationSec = 0, source, contentId } = {}) {
  try {
    return computePlan(getRules(), { kind, category, durationSec, source, contentId }, { premium: isPremium() });
  } catch (e) {
    return { enabled: false, preRoll: 0, midRollsAt: [], skipAfterSec: 5 };
  }
}

/** Re-renders when the remote rules change; returns them. */
export function useAdRules() {
  const [rules, setRules] = useState(getRules);
  useEffect(() => subscribeRules(setRules), []);
  return rules;
}

const PLACEMENTS = ['pre', 'mid', 'between', 'post'];

export function useAdBreaks() {
  const ads = useAds();
  useAdRules(); // so planFor() results refresh in players when the admin changes the rules
  const run = useCallback(async ({ kind, placement, contentId, category, source } = {}) => {
    try {
      if (!['video', 'audio', 'pdf'].includes(kind)) return { shown: false };
      if (isYouTube({ source, category, contentId })) return { shown: false };
      if (!surfaceAllowed(getRules(), kind, { premium: isPremium(), category, source, contentId })) return { shown: false };
      if (!isAppActive()) return { shown: false };
      const plan = planFor({ kind, category });
      const opts = {
        surface: kind,
        placement: PLACEMENTS.includes(placement) ? placement : 'other',
        skipAfterSec: plan.skipAfterSec,
        loadTimeoutMs: LOAD_TIMEOUT_MS,
      };
      let timer;
      const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ shown: false }), HARD_TIMEOUT_MS); });
      const r = await Promise.race([ads.showInterstitial(opts), timeout]);
      clearTimeout(timer);
      return { shown: !!(r && r.shown) };
    } catch (e) {
      return { shown: false };
    }
  }, [ads]);
  return useMemo(() => ({ planFor, run }), [run]);
}
