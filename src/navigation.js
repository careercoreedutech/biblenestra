// Minimal stack navigator: no native deps, preserves back behaviour and deep links
// (nav.push('Bible', { bookId, chapter, verse })).
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

const NavCtx = createContext(null);

export function NavProvider({ children }) {
  const [stack, setStack] = useState([]);
  const push = useCallback((name, params = {}) => setStack((s) => [...s, { name, params, key: name + Date.now() }]), []);
  const pop = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  const reset = useCallback(() => setStack([]), []);
  const replace = useCallback((name, params = {}) => setStack((s) => [...s.slice(0, -1), { name, params, key: name + Date.now() }]), []);
  const value = useMemo(() => ({ stack, push, pop, reset, replace }), [stack, push, pop, reset, replace]);
  return <NavCtx.Provider value={value}>{children}</NavCtx.Provider>;
}

export function useNav() {
  return useContext(NavCtx);
}
