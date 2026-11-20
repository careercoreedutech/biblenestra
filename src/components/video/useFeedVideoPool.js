// FEED VIDEO (client #18 / #19 / #29): a pool of TWO expo-video players shared by every video card in the
// mixed Socials feed (instead of one player per card).
//
//   • the "active" player plays the card that is ≥ ~70% visible (SocialsScreen decides which one);
//   • the other one is loaded with the NEXT video below and kept paused, so its first bytes / first frame are
//     ready when the user scrolls to it (native only — on web a player buffers through its mounted <video>,
//     and the next card's poster already fetched the file's metadata with preload="metadata");
//   • when the feed is hidden (full-screen viewer, Videos tab, another screen) both players drop their
//     source, which frees the hardware decoders the full-screen player needs on Android.
// Cards never create players; only the active card mounts a <VideoView> with the active player.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useVideoPlayer } from 'expo-video';
import { IS_WEB } from './videoUtils';

const setup = (p) => {
  p.loop = true;
  p.muted = true;
  try { p.timeUpdateEventInterval = 0.25; } catch (e) { /* older native */ }
};

/**
 * @param activeKey  feed key of the card that should play (null = none)
 * @param activeUrl  its video URL
 * @param nextUrl    the next video further down (preloaded, paused)
 * @param enabled    false → pause (a sheet / menu is over the feed)
 * @param release    true → drop both sources (feed not on screen)
 * @param muted      the remembered feed mute choice
 * → { activeKey, player, paused, togglePause, setPaused }
 */
export default function useFeedVideoPool({ activeKey, activeUrl, nextUrl, enabled, release, muted }) {
  const a = useVideoPlayer(null, setup);
  const b = useVideoPlayer(null, setup);
  const holds = useRef(new Map()); // player → url it is loaded with
  const [active, setActive] = useState(null); // { key, player }
  const [userPaused, setUserPaused] = useState(false);
  useEffect(() => { setUserPaused(false); }, [activeKey]);

  const load = (p, url) => {
    if ((holds.current.get(p) || null) === (url || null)) return;
    holds.current.set(p, url || null);
    try { p.pause(); } catch (e) { /* released */ }
    try { p.replace(url || null); } catch (e) { /* released */ }
    if (IS_WEB && url) { try { p.pause(); } catch (e) { /* ignore */ } } // web replace() auto-plays mounted views
  };

  useEffect(() => {
    const pool = [a, b];
    if (release) {
      pool.forEach((p) => load(p, null));
      setActive(null);
      return;
    }
    if (!activeUrl) {
      pool.forEach((p) => { try { p.pause(); } catch (e) { /* ignore */ } });
      setActive(null);
      // nothing playing yet: warm up the first video coming into view
      if (!IS_WEB && nextUrl && !pool.some((p) => holds.current.get(p) === nextUrl)) load(b, nextUrl);
      return;
    }
    let cur = pool.find((p) => holds.current.get(p) === activeUrl);
    if (!cur) {
      cur = pool.find((p) => holds.current.get(p) !== nextUrl) || a;
      load(cur, activeUrl);
    }
    const other = cur === a ? b : a;
    try { other.pause(); } catch (e) { /* ignore */ }
    if (!IS_WEB && nextUrl && nextUrl !== activeUrl) load(other, nextUrl);
    setActive((prev) => (prev && prev.key === activeKey && prev.player === cur ? prev : { key: activeKey, player: cur }));
  }, [release, activeKey, activeUrl, nextUrl, a, b]);

  // play / pause the active one
  useEffect(() => {
    if (!active) return;
    const p = active.player;
    try {
      if (enabled && !userPaused) p.play();
      else p.pause();
    } catch (e) { /* released */ }
  }, [active, enabled, userPaused]);

  useEffect(() => {
    [a, b].forEach((p) => { try { p.muted = !!muted; } catch (e) { /* released */ } });
  }, [muted, a, b]);

  const togglePause = useCallback(() => setUserPaused((v) => !v), []);
  return { activeKey: active ? active.key : null, player: active ? active.player : null, paused: userPaused, togglePause, setPaused: setUserPaused };
}
