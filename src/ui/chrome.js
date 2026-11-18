// Tiny shared flag so a screen can tell App.js whether the surrounding chrome
// (page background, status bar, tab bar) should be dark — used by Socials:
// the Facebook-style feed is light, the full-screen Videos reels are dark.
import { useEffect, useState } from 'react';

let socialsDark = false;
const subs = new Set();

export function setSocialsDark(v) {
  if (socialsDark === !!v) return;
  socialsDark = !!v;
  subs.forEach((fn) => fn(socialsDark));
}

export function useSocialsDark() {
  const [v, setV] = useState(socialsDark);
  useEffect(() => { subs.add(setV); setV(socialsDark); return () => subs.delete(setV); }, []);
  return v;
}

// Immersive mode: the Socials Videos section fills the screen, so App.js hides the tab bar and mini-player.
let socialsImmersive = false;
const immSubs = new Set();
export function setSocialsImmersive(v) {
  if (socialsImmersive === !!v) return;
  socialsImmersive = !!v;
  immSubs.forEach((fn) => fn(socialsImmersive));
}
export function useSocialsImmersive() {
  const [v, setV] = useState(socialsImmersive);
  useEffect(() => { immSubs.add(setV); setV(socialsImmersive); return () => immSubs.delete(setV); }, []);
  return v;
}
