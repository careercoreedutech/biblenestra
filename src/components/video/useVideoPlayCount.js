// PACKAGE F — reports a video play once the viewer has really watched it for a few seconds. Only time while the
// player is playing counts (paused, buffering-at-start and off-screen cards do not), and each mount reports once.
// The server applies the minimum watch time, the per-viewer cooldown and the rate limits; this is just the signal.
import { useEffect, useRef } from 'react';
import { useApi } from '../../api/auth';
import { recordVideoPlay } from '../../api/views';
import { setLiveCount } from '../social/viewCounts'; // the reel and card show the new play total at once

const TICK_MS = 500;

export function useVideoPlayCount(postId, player, live, minWatchMs = 2500) {
  const api = useApi();
  const apiRef = useRef(api);
  apiRef.current = api;
  const sent = useRef(false);
  const watched = useRef(0);

  useEffect(() => {
    sent.current = false;
    watched.current = 0;
  }, [postId]);

  useEffect(() => {
    if (!live || !player || !postId) return undefined;
    const timer = setInterval(() => {
      if (sent.current) return;
      let playing = false;
      try { playing = !!player.playing; } catch (e) { playing = false; }
      if (!playing) return;
      watched.current += TICK_MS;
      if (watched.current >= minWatchMs) {
        sent.current = true;
        recordVideoPlay(apiRef.current, postId, watched.current)
          .then((r) => { if (r && r.plays != null) setLiveCount('plays', postId, r.plays); })
          .catch(() => { /* counting is best effort */ });
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [live, player, postId]);
}
