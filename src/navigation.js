// Minimal stack navigator: no native deps, preserves back behaviour and deep links
// (nav.push('Bible', { bookId, chapter, verse })).
// Popped screens are kept briefly (marked `leaving`) so they can animate out before unmounting.
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

export const EXIT_MS = 280;
const NavCtx = createContext(null);
let seq = 0;
const entry = (name, params) => ({ name, params, key: `${name}-${Date.now()}-${seq++}` });

export function NavProvider({ children }) {
  const [rendered, setRendered] = useState([]);
  const timers = useRef([]);

  const live = (s) => s.filter((e) => !e.leaving);

  const push = useCallback((name, params = {}) => setRendered((s) => [...s, entry(name, params)]), []);

  const pop = useCallback(() => {
    setRendered((s) => {
      const idx = s.map((e) => !e.leaving).lastIndexOf(true);
      if (idx < 0) return s;
      const key = s[idx].key;
      timers.current.push(setTimeout(() => setRendered((cur) => cur.filter((e) => e.key !== key)), EXIT_MS));
      return s.map((e, i) => (i === idx ? { ...e, leaving: true } : e));
    });
  }, []);

  const reset = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setRendered([]);
  }, []);

  const replace = useCallback((name, params = {}) => setRendered((s) => {
    const l = live(s);
    const drop = l[l.length - 1];
    return [...s.filter((e) => e !== drop), entry(name, params)];
  }), []);

  const stack = useMemo(() => live(rendered), [rendered]);
  const value = useMemo(() => ({ stack, rendered, push, pop, reset, replace }), [stack, rendered, push, pop, reset, replace]);
  return <NavCtx.Provider value={value}>{children}</NavCtx.Provider>;
}

export function useNav() {
  return useContext(NavCtx);
}

// Whether the screen calling this is the visible top layer (used to pause media under other screens)
export const FocusCtx = createContext(true);
export function useIsFocused() {
  return useContext(FocusCtx);
}
