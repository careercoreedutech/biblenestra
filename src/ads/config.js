// AdMob configuration.
// BibleNestra's own AdMob ids (account ca-app-pub-1100393518413611, app BibleNestra / Android) are used in
// store builds. Testing builds (the preview APKs, development, web) use Google's official TEST ids instead:
// tapping real ads on your own phone can get the AdMob account suspended. Set by eas.json:
//   preview profile    → EXPO_PUBLIC_ADS_MODE=test   (test ads)
//   production profile → EXPO_PUBLIC_ADS_MODE=live   (real ads)
// The AdMob app id lives in app.json → plugins → react-native-google-mobile-ads (androidAppId).
// iOS: still Google's test ids until the iPhone app is added in AdMob.
import { Platform } from 'react-native';

const LIVE_ADS = String(process.env.EXPO_PUBLIC_ADS_MODE || '').trim() === 'live'
  && !(typeof __DEV__ !== 'undefined' && __DEV__);

const LIVE = {
  rewarded: 'ca-app-pub-1100393518413611/1538333909', // Support Rewards
  banner: 'ca-app-pub-1100393518413611/3374159751', // Bible reader banner
  native: 'ca-app-pub-1100393518413611/5496539028', // Feed native
  interstitial: 'ca-app-pub-1100393518413611/7733362113', // Content break
};
const TEST = {
  rewarded: { android: 'ca-app-pub-3940256099942544/5224354917', ios: 'ca-app-pub-3940256099942544/1712485313' },
  banner: { android: 'ca-app-pub-3940256099942544/9214589741', ios: 'ca-app-pub-3940256099942544/2435281174' },
  native: { android: 'ca-app-pub-3940256099942544/2247696110', ios: 'ca-app-pub-3940256099942544/3986624511' },
  interstitial: { android: 'ca-app-pub-3940256099942544/1033173712', ios: 'ca-app-pub-3940256099942544/4411468910' },
};
const unit = (kind) => Platform.select({
  android: LIVE_ADS ? LIVE[kind] : TEST[kind].android,
  ios: TEST[kind].ios,
  default: `test-${kind}`,
});

export const ADS_LIVE = LIVE_ADS;
export const AD_UNITS = {
  rewarded: unit('rewarded'),
  banner: unit('banner'),
  native: unit('native'),
  interstitial: unit('interstitial'),
};

// Product rules for ads (kept in one place so they're easy to tune)
export const AD_RULES = {
  dailySupportAds: 4, // Today: "support us" fire tasks
  gameInterstitialEvery: 4, // games: one ad after every 4th question
  jobBidCost: 20, // coins needed to place a bid
  jobAdsForCoins: 2, // rewarded ads to unlock jobAdCoins (fallback — online the server's /me jobAdsNeeded wins: jobs.bid_required_ads)
  jobAdCoins: 20,
  feedAdEvery: 3, // Socials feed: one native ad card after every 3 posts (overwritten at runtime from the admin "Ads" rules, see ./remote.js)
  videoAdEvery: 3, // Videos: a short ad before every 3rd video opened (not on every one)
};
