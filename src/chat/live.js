// CHAT 7.3 — fast-changing chat state that must NOT go through the persisted store (it would rewrite AsyncStorage
// on every keystroke): who's typing, read / delivered receipts, presence, my permissions in a conversation.
// Fed by the realtime socket (api/sync.js) and by thread loads / the polling fallback. Components subscribe per chat.
import { useEffect, useState, useSyncExternalStore } from 'react';

const TYPING_MS = 6000;
const state = {
  typing: {},      // convId → { userId: { name, until } }
  receipts: {},    // convId → { readAt, deliveredAt }
  presence: {},    // convId → { online, lastSeenAt, hidden }
  perms: {},       // convId → { permissions, settings, myRole }
};
const listeners = new Set();
let version = 0;
const emit = () => { version += 1; listeners.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } }); };
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const getVersion = () => version;

export const live = {
  setTyping(convId, userId, name, on = true) {
    if (!convId || !userId) return;
    const cur = { ...(state.typing[convId] || {}) };
    if (on) cur[userId] = { name: name || 'Someone', until: Date.now() + TYPING_MS };
    else delete cur[userId];
    state.typing = { ...state.typing, [convId]: cur };
    emit();
  },
  // server snapshot: [{ id, name }] (or names) currently typing
  setTypingList(convId, list) {
    const cur = {};
    (list || []).forEach((t, i) => {
      const id = typeof t === 'string' ? `n${i}_${t}` : t.id;
      cur[id] = { name: typeof t === 'string' ? t : t.name, until: Date.now() + TYPING_MS };
    });
    const prev = state.typing[convId] || {};
    if (!Object.keys(cur).length && !Object.keys(prev).length) return;
    state.typing = { ...state.typing, [convId]: cur };
    emit();
  },
  clearTypingFrom(convId, userId) {
    const cur = state.typing[convId];
    if (!cur || !cur[userId]) return;
    live.setTyping(convId, userId, null, false);
  },
  setReceipts(convId, r) {
    if (!convId || !r) return;
    const prev = state.receipts[convId] || {};
    const pick = (a, b) => (!a ? b || null : !b ? a : a > b ? a : b); // receipts only move forward
    const next = { readAt: pick(prev.readAt, r.readAt), deliveredAt: pick(prev.deliveredAt, r.deliveredAt) };
    if (next.readAt && (!next.deliveredAt || next.deliveredAt < next.readAt)) next.deliveredAt = next.readAt;
    if (next.readAt === prev.readAt && next.deliveredAt === prev.deliveredAt) return;
    state.receipts = { ...state.receipts, [convId]: next };
    emit();
  },
  setPresence(convId, p) {
    if (!convId) return;
    const prev = state.presence[convId];
    if (prev && p && prev.online === p.online && prev.lastSeenAt === p.lastSeenAt && prev.hidden === p.hidden) return;
    state.presence = { ...state.presence, [convId]: p || null };
    emit();
  },
  setPerms(convId, perms) {
    if (!convId || !perms) return;
    state.perms = { ...state.perms, [convId]: perms };
    emit();
  },
  get: () => state,
};

function useLiveSelect(select) {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  return select(state);
}

// Re-render every second while someone types so stale indicators disappear on time.
function useTicker(active) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => set((x) => x + 1), 1500);
    return () => clearInterval(t);
  }, [active]);
}

export function useTypingNames(convId) {
  const map = useLiveSelect((s) => s.typing[convId]);
  const now = Date.now();
  const names = map ? Object.values(map).filter((t) => t.until > now).map((t) => t.name) : [];
  useTicker(names.length > 0);
  return names;
}
export const useReceipts = (convId) => useLiveSelect((s) => s.receipts[convId] || null);
export const usePresence = (convId) => useLiveSelect((s) => s.presence[convId] || null);
export const usePerms = (convId) => useLiveSelect((s) => s.perms[convId] || null);
