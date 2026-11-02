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
