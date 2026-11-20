// EXEGESIS: one-tap structured exegesis from POST /study/exegesis.
// The three parts (a: sections 2-5, b: 6-9, c: 10-11) are requested at once and each is shown as soon as
// it arrives — React Native's fetch can't read a streamed body, so this is how the first sections appear early.
// A repeat request is served from the server cache (and from this in-memory cache within a session).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useApi } from './auth';
import { errorMessage } from './client';

const PARTS = ['a', 'b', 'c'];
const mem = new Map(); // key → { sections, passage, label, model, generatedAt }

// Dev only: ?exegesisStub=1 on the web preview asks a local AUTH_DEV_MODE server (no AI binding) for placeholder text.
function devStub() {
  if (typeof __DEV__ === 'undefined' || !__DEV__ || Platform.OS !== 'web' || typeof window === 'undefined') return false;
  try { return new URLSearchParams(window.location.search).get('exegesisStub') === '1'; } catch (e) { return false; }
}

export const exegesisKey = (p) => `${p.bookId}.${p.chapter}.${p.verseStart}-${p.verseEnd || p.verseStart}.${String(p.translation || 'KJV').toUpperCase()}`;

/**
 * @param {{ bookId, chapter, verseStart, verseEnd, translation, text, context, contextStart, contextEnd } | null} req
 *        null while the verse text is still loading
 * → { online, sections, done: {a,b,c}, errors: {a,b,c}, passage, label, cached, retry }
 */
export function useExegesis(req) {
  const api = useApi();
  const key = req ? exegesisKey(req) : null;
  const hit = key ? mem.get(key) : null;
  const [state, setState] = useState(() => (hit ? { sections: hit.sections, done: { a: true, b: true, c: true }, errors: {}, passage: hit.passage, label: hit.label, cached: true } : { sections: {}, done: {}, errors: {}, passage: null, label: null, cached: false }));
  const [attempt, setAttempt] = useState(0);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    if (!req || !api.online) return undefined;
    const m = mem.get(key);
    if (m && attempt === 0) {
      setState({ sections: m.sections, done: { a: true, b: true, c: true }, errors: {}, passage: m.passage, label: m.label, cached: true });
      return undefined;
    }
    let cancelled = false;
    const t0 = Date.now();
    setState((s) => ({ ...s, errors: {}, done: Object.fromEntries(PARTS.filter((p) => s.done[p]).map((p) => [p, true])) }));
    const body = { ...req, verseEnd: req.verseEnd || req.verseStart, ...(devStub() ? { devStub: true } : {}) };
    const results = {};
    PARTS.forEach((part) => {
      api.request('POST', '/study/exegesis', { ...body, part }, { timeout: 90000 })
        .then((r) => {
          results[part] = r;
          if (cancelled || !alive.current) return;
          setState((s) => ({
            ...s,
            sections: { ...s.sections, ...(r.sections || {}) },
            done: { ...s.done, [part]: true },
            passage: r.passage || s.passage,
            label: r.label || s.label,
            cached: PARTS.filter((p) => results[p]).every((p) => results[p].cached),
            ms: Date.now() - t0,
          }));
          if (PARTS.every((p) => results[p])) {
            const sections = Object.assign({}, ...PARTS.map((p) => results[p].sections || {}));
            mem.set(key, { sections, passage: r.passage, label: r.label });
          }
        })
        .catch((e) => {
          if (cancelled || !alive.current) return;
          setState((s) => ({ ...s, errors: { ...s.errors, [part]: { code: e && e.code, message: errorMessage(e, 'The exegesis couldn’t be written just now.') } } }));
        });
    });
    return () => { cancelled = true; };
  }, [key, api.online, attempt, !!req]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { online: api.online, ...state, retry };
}

/** Plain text of a finished exegesis, in section order (for Copy / Share / Save to notes). */
export function exegesisText(title, passage, s, note) {
  const out = [title, ''];
  const add = (h, body) => { if (body && String(body).trim()) out.push(h.toUpperCase(), String(body).trim(), ''); };
  add('1. Passage', passage ? `${passage.text}\n— ${passage.label}` : '');
  add('2. Historical background', s.historical);
  add('3. Cultural background', s.cultural);
  add('4. Literary context', s.literary);
  add('5. Original language', (s.originalLanguage || []).map((w) => `• ${w.english}${w.original ? ` — ${w.original}` : ''}${w.translit ? ` (${w.translit})` : ''}${w.strong ? ` [${w.strong}]` : ''}: ${w.meaning || ''}`).join('\n'));
  add('6. Meaning of important words and phrases', (s.keyTerms || []).map((k) => `• ${k.term}: ${k.meaning}`).join('\n'));
  add('7. Interpretation of the passage', s.interpretation);
  add('8. Theological significance', s.theology);
  add('9. The author’s intended meaning', s.authorIntent);
  add('10. Relationship to other scriptures', (s.crossReferences || []).map((x) => `• ${x.label}${x.note ? ` — ${x.note}` : ''}`).join('\n'));
  const a = s.application || {};
  add('11. Practical application', [
    a.preaching && a.preaching.length ? `Preaching:\n${a.preaching.map((x) => `• ${x}`).join('\n')}` : '',
    a.teaching && a.teaching.length ? `Teaching:\n${a.teaching.map((x) => `• ${x}`).join('\n')}` : '',
    a.personal && a.personal.length ? `Personal study:\n${a.personal.map((x) => `• ${x}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n'));
  if (note) out.push(`(${note})`);
  return out.join('\n');
}
