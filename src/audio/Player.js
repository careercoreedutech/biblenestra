// Global audio player for the Audio Library (sermons, worship, audio Bible, podcasts, group & personal audio).
// Mounted once (App.js) so playback continues while the user moves anywhere in the app; the shared MiniPlayer
// and the Now Playing sheet read from it. Shares "audio focus" with scripture narration (src/audio/focus.js):
// starting one pauses the other.
//
//   const player = useAudioPlayer();
//   player.playQueue(tracks, startIndex, { category })   tracks: [{ id, title, artist, cover, url, durationSec, category, resumeAt }]
//   player.toggle() / pause() / resume() / next() / prev() / seek(sec) / skip(±sec) / stop() / setRate(r)
//   player.current, player.queue, player.index, player.playing, player.positionSec, player.durationSec
//
// Resume: the position of every item is remembered (AsyncStorage + server progress) when the user pauses,
// skips, leaves or every ~10 s, and playback resumes there next time.
// Ads (src/ads/AdBreaks.js): pre-roll before the first track of a Play / Play All; between tracks every
// plan.betweenEvery tracks — only while the app is in the foreground (in the background we just continue).
// Background playback: staysActiveInBackground + iOS UIBackgroundModes "audio" (app.json).
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAdBreaks } from '../ads/AdBreaks';
import { useLibraryApi } from '../api/library';
import { claimAudio, onAudioClaim } from './focus';

let AV = null;
try { AV = require('expo-av'); } catch (e) { AV = null; } // eslint-disable-line global-require

const POS_KEY = (id) => `bn.lib.pos.${id}`;
export const PLAYER_RATES = [0.75, 1, 1.25, 1.5, 2];
const Ctx = createContext(null);

// Dev web preview only: ?mute=1 starts the player muted (silent testing)
const START_MUTED = (() => {
  try { return Platform.OS === 'web' && typeof __DEV__ !== 'undefined' && __DEV__ && new URLSearchParams(window.location.search).get('mute') === '1'; } catch (e) { return false; }
})();

async function readPos(id) {
  try { const v = JSON.parse((await AsyncStorage.getItem(POS_KEY(id))) || 'null'); return v && typeof v.pos === 'number' ? v : null; } catch (e) { return null; }
}
function writePos(id, pos, done = false) {
  AsyncStorage.setItem(POS_KEY(id), JSON.stringify({ pos, done, at: Date.now() })).catch(() => {});
}

let modeSet = false;
async function ensureAudioMode() {
  if (!AV || !AV.Audio) return;
  try {
    await AV.Audio.setAudioModeAsync({
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
      allowsRecordingIOS: false,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
      interruptionModeIOS: AV.InterruptionModeIOS ? AV.InterruptionModeIOS.DoNotMix : 1,
      interruptionModeAndroid: AV.InterruptionModeAndroid ? AV.InterruptionModeAndroid.DoNotMix : 1,
    });
    modeSet = true;
  } catch (e) { modeSet = Platform.OS === 'web'; }
}

export function AudioPlayerProvider({ children }) {
  const breaks = useAdBreaks();
  const lib = useLibraryApi();
  const [queue, setQueue] = useState([]);
  const [index, setIndex] = useState(-1);
  const [st, setSt] = useState({ playing: false, buffering: false, positionSec: 0, durationSec: 0, error: null, loading: false, adBreak: false });
  const [rate, setRateState] = useState(1);
  const [muted, setMuted] = useState(START_MUTED);
  const [sheetOpen, setSheetOpen] = useState(false);

  const sound = useRef(null);
  const gen = useRef(0);
  const qRef = useRef([]);
  const iRef = useRef(-1);
  const posRef = useRef(0);
  const playingRef = useRef(false);
  const durRef = useRef(0);
  const lastSaved = useRef({ local: 0, server: 0 });
  const sinceAd = useRef(0);
  const plan = useRef(null);
  const ctxRef = useRef({});
  const opts = useRef({ rate, muted });
  opts.current = { rate, muted };
  ctxRef.current = { breaks, lib };

  const track = () => qRef.current[iRef.current] || null;

  const persist = useCallback((force = false, done = false) => {
    const t = track();
    if (!t) return;
    const pos = done ? 0 : posRef.current;
    const now = Date.now();
    if (force || done || now - lastSaved.current.local > 10000) { writePos(t.id, pos, done); lastSaved.current.local = now; }
    if (ctxRef.current.lib.online && !t.local && (force || done || now - lastSaved.current.server > 30000)) {
      ctxRef.current.lib.saveProgress(t.id, Math.round(pos), done);
      lastSaved.current.server = now;
    }
  }, []);

  const unload = useCallback(async () => {
    const s = sound.current;
    sound.current = null;
    if (s) { try { s.setOnPlaybackStatusUpdate(null); await s.unloadAsync(); } catch (e) { /* already gone */ } }
  }, []);

  const onStatus = useCallback((myGen) => (status) => {
    if (myGen !== gen.current) return;
    if (!status.isLoaded) {
      if (status.error) setSt((p) => ({ ...p, playing: false, buffering: false, loading: false, error: 'This audio couldn’t be played' }));
      return;
    }
    posRef.current = (status.positionMillis || 0) / 1000;
    playingRef.current = !!status.isPlaying;
    if (status.durationMillis) durRef.current = status.durationMillis / 1000;
    setSt((p) => ({ ...p, playing: !!status.isPlaying, buffering: !!status.isBuffering && !status.isPlaying, positionSec: posRef.current, durationSec: durRef.current || p.durationSec, loading: false, error: null }));
    if (status.isPlaying) persist(false);
    if (status.didJustFinish && !status.isLooping) finished(myGen); // eslint-disable-line no-use-before-define
  }, []);

  const load = useCallback(async (i, { autoplay = true } = {}) => {
    const t = qRef.current[i];
    if (!t || !AV) return;
    const my = ++gen.current;
    await unload();
    iRef.current = i; setIndex(i);
    posRef.current = 0; durRef.current = t.durationSec || 0;
    setSt({ playing: false, buffering: true, positionSec: 0, durationSec: t.durationSec || 0, error: null, loading: true, adBreak: false });
    claimAudio('library');
    if (!modeSet) await ensureAudioMode();
    let resume = t.resumeAt || 0;
    const saved = await readPos(t.id);
    if (saved) resume = saved.done ? 0 : saved.pos;
    if (my !== gen.current) return;
    try {
      const { sound: s, status } = await AV.Audio.Sound.createAsync(
        { uri: t.url },
        { shouldPlay: false, progressUpdateIntervalMillis: 500, rate: opts.current.rate, shouldCorrectPitch: true, isMuted: opts.current.muted },
        onStatus(my),
      );
      if (my !== gen.current) { s.unloadAsync().catch(() => {}); return; }
      sound.current = s;
      const dur = status && status.durationMillis ? status.durationMillis / 1000 : t.durationSec || 0;
      if (resume > 5 && (!dur || resume < dur - 10)) { await s.setPositionAsync(Math.floor(resume * 1000)); posRef.current = resume; }
      if (autoplay) { claimAudio('library'); await s.playAsync(); }
      if (ctxRef.current.lib.online && !t.local) ctxRef.current.lib.played(t.id, { durationSec: dur || undefined });
    } catch (e) {
      if (my === gen.current) setSt((p) => ({ ...p, playing: false, buffering: false, loading: false, error: 'This audio couldn’t be loaded — check your connection' }));
    }
  }, []);

  const finished = useCallback(async (myGen) => {
    persist(true, true);
    const nextI = iRef.current + 1;
    const nextT = qRef.current[nextI];
    if (!nextT) { setSt((p) => ({ ...p, playing: false })); return; }
    sinceAd.current += 1;
    const every = plan.current && plan.current.enabled !== false ? plan.current.betweenEvery : 0;
    // Between-track ad break only in the foreground; in the background just keep listening.
    if (every && sinceAd.current >= every && AppState.currentState === 'active') {
      sinceAd.current = 0;
      setSt((p) => ({ ...p, adBreak: true }));
      try { await ctxRef.current.breaks.run({ kind: 'audio', placement: 'between', contentId: nextT.id, category: nextT.category || undefined }); } catch (e) { /* continue */ }
      if (myGen !== gen.current) return; // user changed track during the break
    }
    load(nextI);
  }, []);

  /** Start a queue (Play / Play All). Runs the pre-roll ad break before the first track. */
  const playQueue = useCallback(async (tracks, start = 0, { category } = {}) => {
    const list = (tracks || []).filter((t) => t && t.url);
    if (!list.length) return;
    const startAt = Math.max(0, Math.min(list.length - 1, start));
    const cur = track();
    // tapping the item that is already loaded just plays / pauses it
    if (cur && cur.id === list[startAt].id && sound.current) {
      qRef.current = list; setQueue(list); iRef.current = startAt; setIndex(startAt);
      toggle(); // eslint-disable-line no-use-before-define (called later, after the render defined it)
      return;
    }
    persist(true);
    const my = ++gen.current;
    await unload();
    claimAudio('library');
    qRef.current = list; setQueue(list);
    iRef.current = startAt; setIndex(startAt);
    sinceAd.current = 0;
    const cat = category || list[startAt].category || undefined;
    plan.current = ctxRef.current.breaks.planFor({ kind: 'audio', category: cat });
    if (plan.current && plan.current.enabled !== false) {
      setSt({ playing: false, buffering: true, positionSec: 0, durationSec: list[startAt].durationSec || 0, error: null, loading: true, adBreak: true });
      try { await ctxRef.current.breaks.run({ kind: 'audio', placement: 'pre', contentId: list[startAt].id, category: cat }); } catch (e) { /* continue */ }
      if (my !== gen.current) return;
    }
    gen.current = my; // load() increments again
    load(startAt);
  }, []);

  const pause = useCallback(async () => {
    const s = sound.current;
    if (!s) return;
    try { await s.pauseAsync(); } catch (e) { /* ignore */ }
    persist(true);
  }, []);

  const resume = useCallback(async () => {
    const s = sound.current;
    if (!s) { if (track()) load(iRef.current); return; }
    claimAudio('library');
    try {
      if (durRef.current && posRef.current >= durRef.current - 0.5) await s.setPositionAsync(0);
      await s.playAsync();
    } catch (e) { /* ignore */ }
  }, []);

  const toggle = useCallback(() => (playingRef.current ? pause() : resume()), []);

  const next = useCallback(() => { if (iRef.current < qRef.current.length - 1) { persist(true); load(iRef.current + 1); } }, []);
  const prev = useCallback(async () => {
    if (posRef.current > 5 || iRef.current <= 0) { if (sound.current) await sound.current.setPositionAsync(0).catch(() => {}); return; }
    persist(true); load(iRef.current - 1);
  }, []);
  const seek = useCallback(async (sec) => {
    const s = sound.current;
    if (!s) return;
    const to = Math.max(0, Math.min(durRef.current || sec, sec));
    posRef.current = to;
    setSt((p) => ({ ...p, positionSec: to }));
    await s.setPositionAsync(Math.floor(to * 1000)).catch(() => {});
    persist(true);
  }, []);
  const skip = useCallback((d) => seek(posRef.current + d), []);
  const playAt = useCallback((i) => { if (qRef.current[i]) { persist(true); load(i); } }, []);

  const stop = useCallback(async () => {
    persist(true);
    gen.current += 1;
    await unload();
    qRef.current = []; iRef.current = -1;
    setQueue([]); setIndex(-1); setSheetOpen(false);
    setSt({ playing: false, buffering: false, positionSec: 0, durationSec: 0, error: null, loading: false, adBreak: false });
  }, []);

  const setRate = useCallback((r) => {
    setRateState(r);
    if (sound.current) sound.current.setRateAsync(r, true).catch(() => {});
  }, []);
  const toggleMute = useCallback(() => {
    setMuted((m) => { const v = !m; if (sound.current) sound.current.setIsMutedAsync(v).catch(() => {}); return v; });
  }, []);

  // Narration (or anything else) took the audio focus → pause, keep our place
  useEffect(() => onAudioClaim((who) => { if (who !== 'library' && sound.current) pause(); }), []);

  // Save the position when the app goes to the background / closes
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s !== 'active') persist(true); });
    return () => sub.remove();
  }, []);
  useEffect(() => () => { persist(true); unload(); }, []);

  // Dev web preview: window.__bnPlayer lets automated checks drive the player silently
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof __DEV__ === 'undefined' || !__DEV__ || typeof window === 'undefined') return undefined;
    window.__bnPlayer = { state: () => ({ queue: qRef.current.map((t) => t.title), index: iRef.current, pos: posRef.current, dur: durRef.current }), mute: () => { if (!opts.current.muted) toggleMute(); } };
    return () => { delete window.__bnPlayer; };
  }, []);

  const current = queue[index] || null;
  const value = useMemo(() => ({
    available: !!AV,
    active: !!current,
    current, queue, index,
    ...st,
    rate, setRate, rates: PLAYER_RATES, muted, toggleMute,
    playQueue, toggle, pause, resume, next, prev, seek, skip, playAt, stop,
    hasNext: index < queue.length - 1, hasPrev: index > 0,
    isCurrent: (id) => !!current && current.id === id,
    sheetOpen, openSheet: () => setSheetOpen(true), closeSheet: () => setSheetOpen(false),
  }), [current, queue, index, st, rate, muted, sheetOpen]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const NOOP = () => {};
export function useAudioPlayer() {
  return useContext(Ctx) || {
    available: false, active: false, current: null, queue: [], index: -1, playing: false, positionSec: 0, durationSec: 0, rates: PLAYER_RATES, rate: 1,
    playQueue: NOOP, toggle: NOOP, pause: NOOP, resume: NOOP, next: NOOP, prev: NOOP, seek: NOOP, skip: NOOP, playAt: NOOP, stop: NOOP, setRate: NOOP, toggleMute: NOOP,
    isCurrent: () => false, openSheet: NOOP, closeSheet: NOOP, sheetOpen: false,
  };
}
