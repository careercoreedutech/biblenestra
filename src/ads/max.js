// AppLovin MAX: the backup ad network for interstitials (native builds only).
// Used when AdMob has no fill. Config: GET /ads/config → networks.applovin (admin, registerConfig 'ad_networks'),
// with app.json → extra.applovin and EXPO_PUBLIC_APPLOVIN_SDK_KEY as fallbacks. An empty SDK key or unit id means the
// network is skipped silently. In Expo Go and on the web the native module is absent (max.web.js is the stub).
// Rewarded ads do NOT use MAX yet: a reward must be verified on the server (the Worker has no MAX reward callback),
// and the app's coin grants depend on that. Banner and native slots fall back to house ads only.
import Constants from 'expo-constants';
import { getNetworks, logAdEvent, recordFullScreenImpression } from './remote';

let M = null;
try {
  // eslint-disable-next-line global-require
  M = require('react-native-applovin-max');
  if (!M || !M.AppLovinMAX || !M.InterstitialAd) M = null;
} catch (e) {
  M = null;
}

const safe = (fn) => { try { return fn(); } catch (e) { return undefined; } };

function fallbackConfig() {
  const extra = (Constants && Constants.expoConfig && Constants.expoConfig.extra) || {};
  const a = extra.applovin || {};
  return {
    sdkKey: a.sdkKey || process.env.EXPO_PUBLIC_APPLOVIN_SDK_KEY || '',
    interstitialUnitId: a.interstitialUnitId || '',
  };
}

/** The resolved MAX settings. `enabled` is false unless the module, an SDK key and an interstitial unit id are present. */
export function maxSettings() {
  const remote = (getNetworks() && getNetworks().applovin) || {};
  const fb = fallbackConfig();
  const sdkKey = remote.sdkKey || fb.sdkKey;
  const interstitial = remote.interstitialUnitId || fb.interstitialUnitId;
  return { enabled: !!M && remote.enabled !== false && !!sdkKey && !!interstitial, sdkKey, interstitial };
}

let initPromise = null;
function ensureInit(sdkKey) {
  if (!initPromise) initPromise = Promise.resolve().then(() => M.AppLovinMAX.initialize(sdkKey)).catch(() => {});
  return initPromise;
}

// MAX listeners are module-wide: the ad layer runs one full-screen ad at a time (see the busy guard in Ads.js).
function clearListeners(I) {
  ['removeAdLoadedEventListener', 'removeAdLoadFailedEventListener', 'removeAdDisplayedEventListener',
    'removeAdHiddenEventListener', 'removeAdFailedToDisplayEventListener']
    .forEach((fn) => safe(() => I[fn] && I[fn]()));
}

/**
 * One MAX interstitial. Resolves { shown, reason? }: shown false with no reason = no fill (the caller moves on).
 * The timeouts start before the SDK is initialised, so a hung init can never hold the caller.
 */
export function showMaxInterstitial(timeoutMs = 8000) {
  return new Promise((resolve) => {
    const s = maxSettings();
    if (!s.enabled) { resolve({ shown: false, reason: 'unavailable' }); return; }
    const I = M.InterstitialAd;
    const meta = { surface: 'other', placement: 'backup', format: 'interstitial', test: false };
    let done = false;
    let displayed = false;
    const finish = (r) => { if (done) return; done = true; clearListeners(I); resolve(r); };
    setTimeout(() => { if (!displayed) finish({ shown: false, reason: 'timeout' }); }, timeoutMs);
    setTimeout(() => finish({ shown: displayed }), timeoutMs + 180000); // safety net: never hold the caller forever
    logAdEvent('requested', meta);
    ensureInit(s.sdkKey).then(() => {
      if (done) return;
      I.addAdLoadedEventListener(() => {
        if (done) return;
        try { I.showAd(s.interstitial, 'break'); } catch (e) { finish({ shown: false, reason: 'error' }); }
      });
      I.addAdLoadFailedEventListener(() => finish({ shown: false }));
      I.addAdDisplayedEventListener(() => {
        displayed = true;
        recordFullScreenImpression(); // counts toward the frequency caps like any other full-screen ad
        logAdEvent('impression', meta);
      });
      I.addAdClickedEventListener(() => logAdEvent('clicked', meta));
      I.addAdFailedToDisplayEventListener(() => finish({ shown: false }));
      I.addAdHiddenEventListener(() => { if (displayed) logAdEvent('completed', meta); finish({ shown: displayed }); });
      try { I.loadAd(s.interstitial); } catch (e) { finish({ shown: false, reason: 'error' }); }
    });
  });
}
