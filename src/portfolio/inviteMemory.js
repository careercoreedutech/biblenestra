// PORTFOLIO INVITES: remembers that this device opened a Partner or Portfolio Manager invite. Only people who did
// see "Become a partner" in Profile; active members keep their dashboard row (PortfolioProfileRows).
//   biblenestra://portfolio/invite/<code>  and  biblenestra://partner/invite/<code>  → Apply screen (deepLinks.js)
// Storage is per device (AsyncStorage; localStorage on web). Any failure is treated as "not remembered".
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'bn.portfolioInvite.v1';
const listeners = new Set();

/** Parse a portfolio or partner invite deep link into its code, or null. */
export function parsePortfolioInviteLink(url) {
  if (!url || typeof url !== 'string') return null;
  const m = /^(?:biblenestra:\/\/|.*\/--\/)(?:portfolio|partner)\/invite\/([A-Za-z0-9]{4,32})(?:[/?#].*)?$/i.exec(url.trim());
  return m ? m[1].toUpperCase() : null;
}

/** Store an opened invite code (called from a deep link or a valid code typed on the Apply screen). */
export async function rememberPartnerInvite(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return;
  try { await AsyncStorage.setItem(KEY, JSON.stringify({ code: c, at: new Date().toISOString() })); } catch (e) { /* not stored */ }
  listeners.forEach((fn) => fn(true));
}

export async function hasRememberedPartnerInvite() {
  try { const raw = await AsyncStorage.getItem(KEY); return !!(raw && JSON.parse(raw).code); } catch (e) { return false; }
}

/** true once this device has opened an invite; false otherwise (also while loading, so the row never flashes). */
export function usePartnerInviteOpened() {
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    let alive = true;
    const fn = (v) => { if (alive) setOpened(v); };
    listeners.add(fn);
    hasRememberedPartnerInvite().then((v) => { if (alive) setOpened(v); });
    return () => { alive = false; listeners.delete(fn); };
  }, []);
  return opened;
}
