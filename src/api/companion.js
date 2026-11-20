// SCRIPTURE COMPANION: situation → ≥7 scriptures + explanations + encouragement + prayer (backend/src/routes/companion.js).
// React Native's fetch can't read a streamed body, so the reply is built progressively from parallel requests:
//   safety (instant, no AI: crisis help + acknowledgement) ‖ verses (themes → validated scriptures)
//   → then compose x1 ‖ x2 ‖ p (explanations for verses 1-4, 5-8, encouragement + prayer).
// Verse TEXT shown is always the app's own Bible data for the reader's translation (loadChapter); the server's copy
// (from the same Free Use Bible API) is only a fallback while that chapter can't be loaded.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useApi } from './auth';
import { errorMessage } from './client';
import { loadChapter } from '../bible/loader';
import { translationInfo } from '../data/bible';

const PARTS = ['x1', 'x2', 'p'];

// Dev only: ?companionStub=1 on the web preview asks a local AUTH_DEV_MODE server (no AI binding) for placeholder
// explanations — the verses themselves are still real.
function devStub() {
  if (typeof __DEV__ === 'undefined' || !__DEV__ || Platform.OS !== 'web' || typeof window === 'undefined') return false;
  try { return new URLSearchParams(window.location.search).get('companionStub') === '1'; } catch (e) { return false; }
}

/** Replace each verse's text with the app's Bible data for that translation; drop any reference with no text. */
export async function withLocalText(verses, translation) {
  const out = await Promise.all((verses || []).map(async (v) => {
    try {
      const ch = await loadChapter(v.translation === translation ? translation : v.translation, v.bookId, v.chapter);
      const parts = [];
      for (let n = v.verseStart; n <= (v.verseEnd || v.verseStart); n++) parts.push(ch && ch[n - 1]);
      if (parts.every(Boolean)) return { ...v, text: parts.join(' ') };
    } catch (e) { /* offline for this translation: keep the server's copy of the same text */ }
    return v.text ? v : null;
  }));
  return out.filter(Boolean);
}

/**
 * → { phase, safety, verses, themes, crisis, medicalNote, explanations, encouragement, prayer, done, errors, ask, retry, reset, restore }
 * phase: 'idle' | 'loading' | 'ready' | 'error'
 */
export function useCompanion({ translation = 'KJV', country = '' } = {}) {
  const api = useApi();
  const [s, setS] = useState({ phase: 'idle' });
  const alive = useRef(true);
  const run = useRef(0);
  const last = useRef(null);
  useEffect(() => () => { alive.current = false; }, []);
  const set = (id, fn) => { if (alive.current && id === run.current) setS(fn); };

  const composeAll = useCallback((id, requestId, message, onlyParts = PARTS) => {
    const stub = devStub();
    onlyParts.forEach((part) => {
      api.request('POST', '/companion/compose', { requestId, message, part, ...(stub ? { devStub: true } : {}) }, { timeout: 90000 })
        .then((r) => set(id, (st) => ({
          ...st,
          explanations: r.explanations ? { ...st.explanations, ...r.explanations } : st.explanations,
          encouragement: r.encouragement !== undefined ? r.encouragement : st.encouragement,
          prayer: r.prayer !== undefined ? r.prayer : st.prayer,
          done: { ...st.done, [part]: true },
          errors: { ...st.errors, [part]: null },
        })))
        .catch((e) => set(id, (st) => ({ ...st, errors: { ...st.errors, [part]: { code: e && e.code, message: errorMessage(e, 'This part couldn’t be written just now.') } } })));
    });
  }, [api]);

  const ask = useCallback((message) => {
    const id = ++run.current;
    last.current = message;
    const t0 = Date.now();
    const stub = devStub();
    const info = translationInfo(translation);
    setS({ phase: 'loading', message, explanations: {}, done: {}, errors: {}, t0 });
    api.request('POST', '/companion/safety', { message, country: country || undefined })
      .then((r) => set(id, (st) => ({ ...st, safety: r, crisis: st.crisis || r.crisis, medicalNote: st.medicalNote || r.medicalNote, firstMs: st.firstMs || Date.now() - t0 })))
      .catch(() => {});
    api.request('POST', '/companion/verses', { message, translation: info.id, translationApi: info.api || undefined, country: country || undefined, ...(stub ? { devStub: true } : {}) }, { timeout: 60000 })
      .then(async (r) => {
        const verses = await withLocalText(r.verses, info.id);
        set(id, (st) => ({
          ...st,
          phase: 'ready',
          requestId: r.requestId,
          verses,
          themes: r.themes || [],
          summary: r.summary || '',
          crisis: r.crisis || st.crisis,
          medicalNote: r.medicalNote || st.medicalNote,
          versesMs: Date.now() - t0,
        }));
        composeAll(id, r.requestId, message);
      })
      .catch((e) => set(id, (st) => ({ ...st, phase: 'error', error: { code: e && e.code, message: errorMessage(e, 'Scripture couldn’t be found just now.') } })));
  }, [api, translation, country, composeAll]);

  const retry = useCallback(() => {
    if (s.phase === 'error' || !s.requestId) { if (last.current) ask(last.current); return; }
    const failed = PARTS.filter((p) => s.errors && s.errors[p]);
    if (failed.length) composeAll(run.current, s.requestId, s.message, failed);
  }, [s, ask, composeAll]);

  const reset = useCallback(() => { run.current++; setS({ phase: 'idle' }); }, []);
  // Re-open a saved reply from this phone's private history (no network).
  const restore = useCallback((saved) => {
    run.current++;
    setS({ phase: 'ready', restored: true, done: { x1: true, x2: true, p: true }, errors: {}, explanations: {}, ...saved });
  }, []);

  return { online: api.online, ...s, ask, retry, reset, restore };
}

/** Plain text of a reply, for Copy / Share. */
export function companionText(r) {
  const out = ['Scripture Companion — BibleNestra', ''];
  (r.verses || []).forEach((v, i) => {
    out.push(`${i + 1}. ${v.label} (${v.translation})`, `“${v.text}”`);
    const e = r.explanations && r.explanations[v.ref];
    if (e) out.push(e);
    out.push('');
  });
  if (r.encouragement) out.push('ENCOURAGEMENT', r.encouragement, '');
  if (r.prayer) out.push('A PRAYER FOR YOU', r.prayer);
  return out.join('\n');
}
