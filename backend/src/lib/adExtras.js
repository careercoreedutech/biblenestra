// AD EXTRAS: the Plans-at-launch page, the Beyond-the-66 ad rules and the backup ad network's ids.
// All three are admin-editable through registerConfig (Admin › Wallets & payments › Settings, JSON) and reach the app
// through GET /ads/config (`extras` and `networks`). Nothing is hard-coded: the defaults below are only used until
// an admin saves a value.
//   ad_extras    { plansPage, extraBooks, houseSkipAfterSec }
//   ad_networks  { applovin: { enabled, sdkKey, interstitialUnitId, rewardedUnitId, bannerUnitId } }
// The backup network is used for interstitials only: rewarded ads need a server-verified reward, which MAX does not have here.
// An empty sdkKey or unit id means the app skips that network silently (AdMob and house ads still work).
import { registerConfig, getConfig } from './wallet.js';

export const DEFAULT_AD_EXTRAS = Object.freeze({
  plansPage: { enabled: true, frequency: 'launch' }, // 'launch' = every cold start, 'daily' = once per calendar day
  extraBooks: { enabled: true, minGapSeconds: 5, onOpen: true, onChapter: true },
  houseSkipAfterSec: 5, // countdown before a house ad can be closed
});

export const DEFAULT_AD_NETWORKS = Object.freeze({
  applovin: { enabled: true, sdkKey: '', interstitialUnitId: '', rewardedUnitId: '', bannerUnitId: '' },
});

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const whole = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const optBool = (v) => v === undefined || typeof v === 'boolean';
const idText = (v) => v === undefined || (typeof v === 'string' && v.length <= 200 && /^[A-Za-z0-9_\-\/]*$/.test(v));

export function checkAdExtras(v) {
  if (!isObj(v)) return false;
  const p = v.plansPage;
  const e = v.extraBooks;
  if (p !== undefined && (!isObj(p) || !optBool(p.enabled) || (p.frequency !== undefined && !['launch', 'daily'].includes(p.frequency)))) return false;
  if (e !== undefined && (!isObj(e) || !optBool(e.enabled) || !optBool(e.onOpen) || !optBool(e.onChapter)
    || (e.minGapSeconds !== undefined && !whole(e.minGapSeconds, 0, 600)))) return false;
  if (v.houseSkipAfterSec !== undefined && !whole(v.houseSkipAfterSec, 0, 30)) return false;
  return true;
}
registerConfig('ad_extras', DEFAULT_AD_EXTRAS, checkAdExtras);

export function normalizeAdExtras(v) {
  const o = checkAdExtras(v) ? (v || {}) : {};
  const d = DEFAULT_AD_EXTRAS;
  return {
    plansPage: { ...d.plansPage, ...(o.plansPage || {}) },
    extraBooks: { ...d.extraBooks, ...(o.extraBooks || {}) },
    houseSkipAfterSec: o.houseSkipAfterSec ?? d.houseSkipAfterSec,
  };
}

export function checkAdNetworks(v) {
  if (!isObj(v)) return false;
  const a = v.applovin;
  if (a === undefined) return true;
  return isObj(a) && optBool(a.enabled) && idText(a.sdkKey) && idText(a.interstitialUnitId)
    && idText(a.rewardedUnitId) && idText(a.bannerUnitId);
}
registerConfig('ad_networks', DEFAULT_AD_NETWORKS, checkAdNetworks);

export function normalizeAdNetworks(v) {
  const o = checkAdNetworks(v) ? (v || {}) : {};
  return { applovin: { ...DEFAULT_AD_NETWORKS.applovin, ...(o.applovin || {}) } };
}

export async function getAdExtras(env) {
  return normalizeAdExtras((await getConfig(env)).ad_extras);
}
export async function getAdNetworks(env) {
  return normalizeAdNetworks((await getConfig(env)).ad_networks);
}
