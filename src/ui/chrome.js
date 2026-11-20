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

// Bible full-screen reading: while true (Bible tab open, reader idle) App.js slides the tab bar away;
// the reader's small arrow handle sets it back to false, and the reader hides it again after a few
// seconds or as soon as the text scrolls.
let bibleImmersive = false;
const bibleSubs = new Set();
export function setBibleImmersive(v) {
  if (bibleImmersive === !!v) return;
  bibleImmersive = !!v;
  bibleSubs.forEach((fn) => fn(bibleImmersive));
}
export function useBibleImmersive() {
  const [v, setV] = useState(bibleImmersive);
  useEffect(() => { bibleSubs.add(setV); setV(bibleImmersive); return () => bibleSubs.delete(setV); }, []);
  return v;
}
