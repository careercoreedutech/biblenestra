// Native: load Google Mobile Ads if the native module exists (EAS/dev builds). In Expo Go it throws → null.
let GMA = null;
try {
  // eslint-disable-next-line global-require
  GMA = require('react-native-google-mobile-ads');
  if (!GMA || !GMA.RewardedAd) GMA = null;
} catch (e) {
  GMA = null;
}
export default GMA;
