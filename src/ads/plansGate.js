// Plans page at launch: decides once per cold start whether the BibleNestra Plus page opens before the app.
// Shown to signed-in users without an active Plus subscription. Admin switch and frequency come from GET /ads/config →
// extras.plansPage (registerConfig 'ad_extras'): frequency 'launch' = every cold start, 'daily' = once per calendar day.
// A launch opened by a deep link or a notification skips the page for that launch. Never shown to Plus members.
import { useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getExtras, waitAdsConfig } from './remote';

const DAY_KEY = 'bn.plans.gate.day.v1';
let shownThisLaunch = false; // module state: a cold start (a fresh JS bundle) shows the page at most once

const safeAsync = async (fn) => { try { return await fn(); } catch (e) { return null; } };
const localDay = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

/** Call when the Plans page has been dismissed after it was shown (keeps the 'daily' frequency honest). */
export function markPlansShown() {
  shownThisLaunch = true;
  safeAsync(() => AsyncStorage.setItem(DAY_KEY, localDay()));
}

/** null while deciding, then true (show the page now) or false (skip it for this launch). */
export function usePlansLaunchGate({ ready, onboarded, signedIn, premium }) {
  const [decision, setDecision] = useState(null);
  useEffect(() => {
    if (decision !== null || !ready) return undefined;
    if (!onboarded || !signedIn || premium || shownThisLaunch) { setDecision(false); return undefined; }
    let alive = true;
    (async () => {
      await waitAdsConfig(1500); // the admin's switch and frequency must be known before deciding (cache or network)
      if (!alive) return;
      const cfg = getExtras().plansPage || {};
      if (cfg.enabled === false) { if (alive) setDecision(false); return; }
      // a deep link (biblenestra://…) or a notification that opened the app goes straight to its screen
      // (only the app's own biblenestra:// links count; on the web the page URL is not a deep link)
      const url = Platform.OS === 'web' ? null : await safeAsync(() => Linking.getInitialURL());
      if (typeof url === 'string' && url.startsWith('biblenestra://')) { if (alive) setDecision(false); return; }
      const Notifications = await safeAsync(() => require('expo-notifications'));
      const tapped = Notifications ? await safeAsync(() => Notifications.getLastNotificationResponseAsync()) : null;
      if (tapped) { if (alive) setDecision(false); return; }
      if (cfg.frequency === 'daily') {
        const last = await safeAsync(() => AsyncStorage.getItem(DAY_KEY));
        if (last === localDay()) { if (alive) setDecision(false); return; }
      }
      if (alive) setDecision(true);
    })();
    return () => { alive = false; };
  }, [ready, onboarded, signedIn, premium, decision]);
  return decision;
}
