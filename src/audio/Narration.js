// Real scripture narration using the device's text-to-speech (expo-speech).
// Reads verse by verse so the reader can highlight the current verse, continues into the next
// chapter, and supports speed, voice, sleep timer and "Reflect" pauses between verses.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { BOOKS, getChapter, bookName } from '../data/bible';
import { ttsLocale } from '../bible/catalog';
import { claimAudio, onAudioClaim } from './focus';
import { assignVoices, voiceCounts } from './voices';

let Speech = null;
try { Speech = require('expo-speech'); } catch (e) { Speech = null; }

// Each narrator uses a real male/female voice installed on the phone (see ./voices.js), preferring its accent.
// pitch stays close to 1 so voices sound natural; fallbackPitch is only used when the phone has no voice of that gender.
export const NARRATORS = [
  { id: 'thomas', name: 'Fr. Thomas', gender: 'male', style: 'Warm · reflective', initials: 'FT', tint: '#D4A852', accents: ['en-gb', 'en-ie', 'en-us'], pitch: 0.96, rateMul: 0.93, fallbackPitch: 0.8 },
  { id: 'david', name: 'David', gender: 'male', style: 'Deep · steady', initials: 'DV', tint: '#7FB59A', accents: ['en-us', 'en-au', 'en-gb'], pitch: 0.9, rateMul: 0.92, fallbackPitch: 0.72 },
  { id: 'samuel', name: 'Pastor Samuel', gender: 'male', style: 'Strong · African English', initials: 'PS', tint: '#C98B5B', accents: ['en-ng', 'en-gh', 'en-ke', 'en-za', 'en-in', 'en-gb'], pitch: 1, rateMul: 0.96, fallbackPitch: 0.85 },
  { id: 'amara', name: 'Amara', gender: 'female', style: 'Clear · gentle', initials: 'AM', tint: '#8FA7DA', accents: ['en-ng', 'en-gh', 'en-ke', 'en-za', 'en-gb', 'en-us'], pitch: 1, rateMul: 0.98, fallbackPitch: 1.12 },
  { id: 'grace', name: 'Grace', gender: 'female', style: 'Bright · lively', initials: 'GR', tint: '#E79A9A', accents: ['en-us', 'en-au'], pitch: 1.04, rateMul: 1.03, fallbackPitch: 1.2 },
  { id: 'esther', name: 'Esther', gender: 'female', style: 'Calm · British', initials: 'ES', tint: '#B79AD8', accents: ['en-gb', 'en-ie', 'en-au', 'en-us'], pitch: 0.98, rateMul: 0.95, fallbackPitch: 1.1 },
];
export const SPEEDS = [0.75, 1, 1.25, 1.5];
export const SLEEP_OPTIONS = ['Off', '10 min', '20 min', 'End of chapter'];

const Ctx = createContext(null);
const IDLE = { active: false, playing: false, bookId: null, chapter: null, verse: 1, total: 0, mode: 'chapter', translation: 'KJV' };

export function NarrationProvider({ children }) {
  const [st, setSt] = useState(IDLE);
  const [rate, setRate] = useState(1);
  const [narrator, setNarrator] = useState(NARRATORS[0]);
  const [sleep, setSleepState] = useState('Off');
  const [reflect, setReflect] = useState(false);
  const [music, setMusic] = useState('None');
  const [playerOpen, setPlayerOpen] = useState(false);
  const [voices, setVoices] = useState([]);

  const gen = useRef(0); // invalidates callbacks from stopped utterances
  const stRef = useRef(st);
  const opts = useRef({ rate, narrator, reflect, sleep, voices });
  const sleepTimer = useRef(null);
  const reflectTimer = useRef(null);
  stRef.current = st;
  opts.current = { rate, narrator, reflect, sleep, voices };

  useEffect(() => {
    if (!Speech || !Speech.getAvailableVoicesAsync) return undefined;
    // Android's speech engine often reports no voices until it has started up — try a few times.
    let tries = 0;
    let timer;
    const load = () => {
      Speech.getAvailableVoicesAsync()
        .then((vs) => {
          const en = (vs || []).filter((v) => (v.language || '').toLowerCase().replace('_', '-').startsWith('en'));
          if (en.length) setVoices(en);
          else if (++tries < 5) timer = setTimeout(load, 1500);
        })
        .catch(() => { if (++tries < 5) timer = setTimeout(load, 1500); });
    };
    load();
    return () => clearTimeout(timer);
  }, []);

  const versesFor = (s) => getChapter(s.translation, s.bookId, s.chapter) || [];

  const speakVerse = useCallback((s, verse) => {
    const my = ++gen.current;
    clearTimeout(reflectTimer.current);
    const verses = versesFor(s);
    const text = verses[verse - 1];
    if (!text) return;
    const locale = ttsLocale(s.translation);
    const english = locale.startsWith('en');
    const intro = english && verse === 1 && s.mode === 'chapter' ? `${bookName(s.bookId)}, chapter ${s.chapter}. ` : '';
    const o = opts.current;
    // the narrator's own male/female voice on this phone (English text only; other languages use the device default)
    const pick = english ? assignVoices(NARRATORS, o.voices)[o.narrator.id] : null;
    const voice = pick ? pick.voice : undefined;
    const pitch = pick ? pick.pitch : 1;
    setSt((p) => ({ ...p, ...s, verse, total: verses.length, active: true, playing: true }));
    claimAudio('narration'); // pauses the library player (one sound at a time)
    if (!Speech) return;
    Speech.stop();
    Speech.speak(intro + text, {
      rate: Math.max(0.5, Math.min(2, o.rate * o.narrator.rateMul)),
      pitch,
      voice,
      language: locale,
      onDone: () => {
        if (my !== gen.current) return;
        const wait = opts.current.reflect ? 4000 : 120;
        reflectTimer.current = setTimeout(() => {
          if (my !== gen.current) return;
          advance(s, verse);
        }, wait);
      },
      onError: () => { if (my === gen.current) setSt((p) => ({ ...p, playing: false })); },
    });
  }, []);

  const advance = useCallback((s, verse) => {
    const total = versesFor(s).length;
    if (s.mode === 'verse' || (s.endVerse && verse >= s.endVerse)) { stopAll(true); return; }
    if (verse < total) { speakVerse(s, verse + 1); return; }
    if (opts.current.sleep === 'End of chapter') { stopAll(false); setSleepState('Off'); return; }
    // continue into the next chapter / book
    const b = BOOKS.findIndex((x) => x.id === s.bookId);
    const book = BOOKS[b];
    let next = null;
    if (book && s.chapter < book.chapters) next = { ...s, chapter: s.chapter + 1 };
    else if (BOOKS[b + 1]) next = { ...s, bookId: BOOKS[b + 1].id, chapter: 1 };
    if (next && versesFor(next).length) speakVerse(next, 1);
    else stopAll(false);
  }, []);

  const stopAll = useCallback((clear = true) => {
    gen.current += 1;
    clearTimeout(reflectTimer.current);
    if (Speech) Speech.stop();
    setSt((p) => (clear ? IDLE : { ...p, playing: false }));
  }, []);

  const playChapter = useCallback((bookId, chapter, { translation = 'KJV', fromVerse = 1 } = {}) => {
    speakVerse({ bookId, chapter, translation, mode: 'chapter', endVerse: null }, fromVerse);
  }, []);

  const playVerse = useCallback((bookId, chapter, verse, { translation = 'KJV' } = {}) => {
    speakVerse({ bookId, chapter, translation, mode: 'verse', endVerse: verse }, verse);
  }, []);

  const pause = useCallback(() => {
    gen.current += 1;
    clearTimeout(reflectTimer.current);
    if (Speech) Speech.stop();
    setSt((p) => ({ ...p, playing: false }));
  }, []);

  const resume = useCallback(() => {
    const s = stRef.current;
    if (!s.active) return;
    speakVerse(s, s.verse);
  }, []);

  const toggle = useCallback(() => (stRef.current.playing ? pause() : resume()), []);
  const next = useCallback(() => { const s = stRef.current; if (s.active) advance({ ...s, mode: 'chapter' }, s.verse); }, []);
  const prev = useCallback(() => { const s = stRef.current; if (s.active) speakVerse(s, Math.max(1, s.verse - 1)); }, []);
  const seekVerse = useCallback((v) => { const s = stRef.current; if (s.active) speakVerse(s, Math.max(1, Math.min(s.total, v))); }, []);

  const setSleep = useCallback((v) => {
    clearTimeout(sleepTimer.current);
    setSleepState(v);
    const mins = v === '10 min' ? 10 : v === '20 min' ? 20 : 0;
    if (mins) sleepTimer.current = setTimeout(() => { pause(); setSleepState('Off'); }, mins * 60000);
  }, []);

  // Re-speak the current verse when voice or speed changes mid-playback
  useEffect(() => {
    const s = stRef.current;
    if (s.active && s.playing) speakVerse(s, s.verse);
  }, [rate, narrator]);

  // Another source (the library player) started: pause narration but keep its place
  useEffect(() => onAudioClaim((who) => { if (who !== 'narration' && stRef.current.playing) pause(); }), []);

  useEffect(() => () => { clearTimeout(sleepTimer.current); clearTimeout(reflectTimer.current); if (Speech) Speech.stop(); }, []);

  const value = useMemo(() => ({
    ...st,
    available: !!Speech,
    isWeb: Platform.OS === 'web',
    voiceInfo: assignVoices(NARRATORS, voices), voiceCounts: voiceCounts(voices),
    rate, setRate, narrator, setNarrator, sleep, setSleep, reflect, setReflect, music, setMusic,
    playChapter, playVerse, pause, resume, toggle, next, prev, seekVerse, stop: () => stopAll(true),
    playerOpen, openPlayer: () => setPlayerOpen(true), closePlayer: () => setPlayerOpen(false),
  }), [st, rate, narrator, sleep, reflect, music, playerOpen, voices]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNarration() {
  return useContext(Ctx) || { ...IDLE, available: false, toggle() {}, playChapter() {}, playVerse() {}, openPlayer() {}, closePlayer() {} };
}
