// Web build: AppLovin MAX is a native module, so the backup network never has an ad here. Same API as max.js.
export function maxSettings() {
  return { enabled: false, sdkKey: '', interstitial: '' };
}
export function showMaxInterstitial() {
  return Promise.resolve({ shown: false, reason: 'unavailable' });
}
