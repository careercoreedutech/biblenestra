// AdMob configuration.
// These are Google's official TEST ids — they always serve test ads and are safe during development.
// Before publishing, replace them with your own ids from https://admob.google.com
// (and replace the app ids in app.json → plugins → react-native-google-mobile-ads).
import { Platform } from 'react-native';

export const AD_UNITS = {
  rewarded: Platform.select({
    android: 'ca-app-pub-3940256099942544/5224354917',
    ios: 'ca-app-pub-3940256099942544/1712485313',
    default: 'test-rewarded',
  }),
  banner: Platform.select({
    android: 'ca-app-pub-3940256099942544/9214589741',
    ios: 'ca-app-pub-3940256099942544/2435281174',
    default: 'test-banner',
  }),
  native: Platform.select({
    android: 'ca-app-pub-3940256099942544/2247696110',
    ios: 'ca-app-pub-3940256099942544/3986624511',
    default: 'test-native',
  }),
  interstitial: Platform.select({
    android: 'ca-app-pub-3940256099942544/1033173712',
    ios: 'ca-app-pub-3940256099942544/4411468910',
    default: 'test-interstitial',
  }),
};

// Product rules for ads (kept in one place so they're easy to tune)
export const AD_RULES = {
  dailySupportAds: 4, // Today: "support us" fire tasks
  gameInterstitialEvery: 4, // games: one ad after every 4th question
  jobBidCost: 20, // coins needed to place a bid
  jobAdsForCoins: 5, // rewarded ads to unlock jobAdCoins
  jobAdCoins: 20,
  feedAdEvery: 3, // Socials feed: one native ad card after every 3 posts (overwritten at runtime from the admin "Ads" rules, see ./remote.js)
  videoAdEvery: 3, // Videos: a short ad before every 3rd video opened (not on every one)
};
