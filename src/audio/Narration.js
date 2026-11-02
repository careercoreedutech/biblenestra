// Real scripture narration using the device's text-to-speech (expo-speech).
// Reads verse by verse so the reader can highlight the current verse, continues into the next
// chapter, and supports speed, voice, sleep timer and "Reflect" pauses between verses.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { BOOKS, getChapter, bookName } from '../data/bible';
import { ttsLocale } from '../bible/catalog';

let Speech = null;
try { Speech = require('expo-speech'); } catch (e) { Speech = null; }

export const NARRATORS = [
  { id: 'thomas', name: 'Fr. Thomas', style: 'Warm · reflective', initials: 'FT', tint: '#D4A852', pitch: 0.92, rateMul: 0.95 },
  { id: 'amara', name: 'Amara', style: 'Clear · gentle', initials: 'AM', tint: '#8FA7DA', pitch: 1.12, rateMul: 1 },
  { id: 'david', name: 'David', style: 'Deep · steady', initials: 'DV', tint: '#7FB59A', pitch: 0.8, rateMul: 0.92 },
  { id: 'grace', name: 'Grace', style: 'Bright · lively', initials: 'GR', tint: '#E79A9A', pitch: 1.22, rateMul: 1.05 },
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
    if (!Speech || !Speech.getAvailableVoicesAsync) return;
    Speech.getAvailableVoicesAsync()
      .then((vs) => setVoices((vs || []).filter((v) => (v.language || '').toLowerCase().startsWith('en'))))
      .catch(() => {});
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
    const idx = NARRATORS.findIndex((n) => n.id === o.narrator.id);
    const voice = english && o.voices.length ? o.voices[idx % o.voices.length].identifier : undefined;
    setSt((p) => ({ ...p, ...s, verse, total: verses.length, active: true, playing: true }));
    if (!Speech) return;
    Speech.stop();
    Speech.speak(intro + text, {
      rate: Math.max(0.5, Math.min(2, o.rate * o.narrator.rateMul)),
      pitch: o.narrator.pitch,
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

  useEffect(() => () => { clearTimeout(sleepTimer.current); clearTimeout(reflectTimer.current); if (Speech) Speech.stop(); }, []);

  const value = useMemo(() => ({
    ...st,
    available: !!Speech,
    isWeb: Platform.OS === 'web',
    rate, setRate, narrator, setNarrator, sleep, setSleep, reflect, setReflect, music, setMusic,
    playChapter, playVerse, pause, resume, toggle, next, prev, seekVerse, stop: () => stopAll(true),
    playerOpen, openPlayer: () => setPlayerOpen(true), closePlayer: () => setPlayerOpen(false),
  }), [st, rate, narrator, sleep, reflect, music, playerOpen]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNarration() {
  return useContext(Ctx) || { ...IDLE, available: false, toggle() {}, playChapter() {}, playVerse() {}, openPlayer() {}, closePlayer() {} };
}
