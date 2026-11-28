// Beyond the 66 (src/screens/ExtraBooksScreens.js): an interstitial when a book opens and on every chapter change.
// Admin settings come from GET /ads/config → extras.extraBooks (registerConfig 'ad_extras'): on/off per trigger and the
// minimum gap in seconds, so fast double taps never show two ads. Only this surface bypasses the global frequency caps
// (that is the client's rule: "an ad on every Next chapter"). Plus members never see it: showInterstitial checks that.
// The main 66-book Bible reader is not touched.
import { getExtras } from './remote';

let lastAttemptAt = 0;

/** trigger: 'open' | 'chapter'. Resolves the showInterstitial result, or { shown: false, reason } when skipped. */
export function showExtraBookAd(showInterstitial, trigger) {
  const cfg = getExtras().extraBooks || {};
  if (cfg.enabled === false) return Promise.resolve({ shown: false, reason: 'off' });
  if (trigger === 'open' && cfg.onOpen === false) return Promise.resolve({ shown: false, reason: 'off' });
  if (trigger === 'chapter' && cfg.onChapter === false) return Promise.resolve({ shown: false, reason: 'off' });
  const gapMs = Math.max(0, Number(cfg.minGapSeconds) || 0) * 1000;
  const now = Date.now();
  if (now - lastAttemptAt < gapMs) return Promise.resolve({ shown: false, reason: 'gap' });
  lastAttemptAt = now; // set on the attempt, so a double tap during loading is skipped too
  if (typeof showInterstitial !== 'function') return Promise.resolve({ shown: false, reason: 'no_ads' });
  return Promise.resolve(showInterstitial({ surface: 'other', placement: `beyond66_${trigger}`, ignoreCaps: true, loadTimeoutMs: 8000 }))
    .catch(() => ({ shown: false, reason: 'error' }));
}
