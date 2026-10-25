// App state with durable persistence (AsyncStorage). Saves are versioned and show
// a sync status (saved / syncing / failed) as the spec requires (§1.5.8).
import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as seed from '../data/seed';

const KEY = 'biblenestra.state.v1';

const initial = {
  onboarded: false,
  user: seed.USER,
  translation: 'KJV',
  compareWith: ['WEB'],
  lastPosition: { bookId: 'MAT', chapter: 1 },
  recent: [{ bookId: 'MAT', chapter: 1 }, { bookId: 'JHN', chapter: 3 }],
  highlights: [{ id: 'h1', bookId: 'JHN', chapter: 3, verse: 16, color: '#8fe3c3', label: 'Promise', when: 'Yesterday' }],
  notes: [{ id: 'n1', bookId: 'MAT', chapter: 1, verse: 21, text: 'Jesus = "Yahweh saves". The name is the mission.', scope: 'Private', when: 'Mon' }],
  bookmarks: [{ id: 'b1', bookId: 'PSA', chapter: 23, verse: null, folder: 'Comfort', when: 'Sun' }],
  savedAnswers: [],
  savedSearches: ['grace', 'peace'],
  chatHistory: [],
  companionHistory: [],
  prayers: seed.PRAYERS,
  wishes: seed.WISHES,
  communities: seed.COMMUNITIES,
  groupMessages: seed.GROUP_MESSAGES,
  chats: seed.CHATS,
  requests: seed.MESSAGE_REQUESTS,
  plans: seed.PLANS,
  recordings: seed.RECORDINGS,
  feed: seed.FEED,
  rsvps: ['e1'],
  follows: ['p1', 'p5'],
  blocked: [],
  notifications: { push: true, email: false, quietHours: '22:00–07:00', bible: true, groups: true, prayer: true, events: true, safety: true },
  streaksEnabled: true,
  fontSize: 15,
  version: 0,
};

function reducer(s, a) {
  const bump = (patch) => ({ ...s, ...patch, version: s.version + 1 });
  switch (a.type) {
    case 'hydrate': return { ...s, ...a.state };
    case 'set': return bump(a.patch);
    case 'onboard': return bump({ onboarded: true, user: { ...s.user, ...a.user }, translation: a.user.translation || s.translation });
    case 'position': return bump({ lastPosition: a.pos, recent: [a.pos, ...s.recent.filter((r) => !(r.bookId === a.pos.bookId && r.chapter === a.pos.chapter))].slice(0, 8) });
    case 'highlight': {
      const exists = s.highlights.find((h) => h.bookId === a.h.bookId && h.chapter === a.h.chapter && h.verse === a.h.verse);
      if (exists && exists.color === a.h.color) return bump({ highlights: s.highlights.filter((h) => h.id !== exists.id) });
      const rest = s.highlights.filter((h) => !(h.bookId === a.h.bookId && h.chapter === a.h.chapter && h.verse === a.h.verse));
      return bump({ highlights: [{ id: 'h' + Date.now(), when: 'Now', ...a.h }, ...rest] });
    }
    case 'note': return bump({ notes: [{ id: 'n' + Date.now(), when: 'Now', scope: 'Private', ...a.n }, ...s.notes] });
    case 'deleteNote': return bump({ notes: s.notes.filter((n) => n.id !== a.id) });
    case 'bookmark': {
      const exists = s.bookmarks.find((b) => b.bookId === a.b.bookId && b.chapter === a.b.chapter && (b.verse || null) === (a.b.verse || null));
      if (exists) return bump({ bookmarks: s.bookmarks.filter((b) => b.id !== exists.id) });
      return bump({ bookmarks: [{ id: 'b' + Date.now(), when: 'Now', folder: 'Saved', ...a.b }, ...s.bookmarks] });
    }
    case 'saveAnswer': return bump({ savedAnswers: [{ id: 'sa' + Date.now(), when: 'Now', ...a.a }, ...s.savedAnswers] });
    case 'saveSearch': return bump({ savedSearches: [a.q, ...s.savedSearches.filter((x) => x !== a.q)].slice(0, 10) });
    case 'chat': return bump({ chatHistory: a.history });
    case 'companion': return bump({ companionHistory: [a.entry, ...s.companionHistory].slice(0, 20) });
    case 'addPrayer': return bump({ prayers: [{ id: 'pr' + Date.now(), created: 'Now', praying: 0, updates: [], status: 'active', mine: true, author: a.p.anonymous ? 'Anonymous' : s.user.displayName, ...a.p }, ...s.prayers] });
    case 'pray': return bump({ prayers: s.prayers.map((p) => (p.id === a.id ? { ...p, praying: p.praying + (p.prayed ? -1 : 1), prayed: !p.prayed, status: p.status === 'active' ? 'receiving' : p.status } : p)) });
    case 'prayerStatus': return bump({ prayers: s.prayers.map((p) => (p.id === a.id ? { ...p, status: a.status, updates: a.update ? [{ text: a.update, when: 'Now' }, ...p.updates] : p.updates } : p)) });
    case 'addWish': return bump({ wishes: [{ id: 'w' + Date.now(), author: s.user.displayName, replies: 0, mine: true, ...a.w }, ...s.wishes] });
    case 'join': return bump({ communities: s.communities.map((c) => (c.id === a.id ? { ...c, joined: c.privacy === 'Private' && !c.joined ? 'requested' : !c.joined } : c)) });
    case 'groupMessage': {
      const g = s.groupMessages[a.gid] || {};
      const ch = g[a.channel] || [];
      return bump({ groupMessages: { ...s.groupMessages, [a.gid]: { ...g, [a.channel]: [...ch, { id: 'm' + Date.now(), from: s.user.displayName, mine: true, time: 'Now', ...a.m }] } } });
    }
    case 'dm': return bump({ chats: s.chats.map((c) => (c.id === a.cid ? { ...c, last: a.text, time: 'Now', messages: [...c.messages, { id: 'x' + Date.now(), from: s.user.displayName, mine: true, time: 'Now', text: a.text }] } : c)) });
    case 'newChat': return bump({ chats: [{ id: 'd' + Date.now(), with: a.name, type: a.kind || 'General', last: a.text || 'New conversation', time: 'Now', unread: 0, messages: a.text ? [{ id: 'x' + Date.now(), from: s.user.displayName, mine: true, time: 'Now', text: a.text }] : [] }, ...s.chats] });
    case 'request': return bump({ requests: s.requests.filter((r) => r.id !== a.id), chats: a.accept ? [{ id: 'd' + Date.now(), with: a.from, type: 'General', last: a.text, time: 'Now', unread: 0, messages: [{ id: 'x' + Date.now(), from: a.from, time: 'Now', text: a.text }] }, ...s.chats] : s.chats });
    case 'planDone': return bump({ plans: s.plans.map((p) => (p.id === a.id ? { ...p, done: Math.min(p.days, p.done + 1), streak: p.streak + 1 } : p)) });
    case 'rsvp': return bump({ rsvps: s.rsvps.includes(a.id) ? s.rsvps.filter((x) => x !== a.id) : [...s.rsvps, a.id] });
    case 'follow': return bump({ follows: s.follows.includes(a.id) ? s.follows.filter((x) => x !== a.id) : [...s.follows, a.id] });
    case 'block': return bump({ blocked: [...s.blocked, a.id] });
    case 'recording': return bump({ recordings: [{ id: 'rc' + Date.now(), status: 'draft', privacy: 'Private', refs: [], ...a.r }, ...s.recordings] });
    case 'recordingStatus': return bump({ recordings: s.recordings.map((r) => (r.id === a.id ? { ...r, status: a.status } : r)) });
    case 'post': return bump({ feed: [{ id: 'f' + Date.now(), author: s.user.displayName, time: 'Now', likes: 0, comments: 0, ...a.post }, ...s.feed] });
    case 'like': return bump({ feed: s.feed.map((f) => (f.id === a.id ? { ...f, likes: f.likes + (f.liked ? -1 : 1), liked: !f.liked } : f)) });
    case 'user': return bump({ user: { ...s.user, ...a.user } });
    case 'reset': return { ...initial, version: s.version + 1 };
    default: return s;
  }
}

const Ctx = createContext(null);

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const [ready, setReady] = useState(false);
  const [sync, setSync] = useState({ status: 'saved', at: null });
  const lastSaved = useRef(0);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) dispatch({ type: 'hydrate', state: JSON.parse(raw) });
      } catch (e) { /* start fresh; nothing is lost because nothing was saved yet */ }
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!ready || state.version === lastSaved.current) return;
    const v = state.version;
    setSync({ status: 'syncing', at: sync.at });
    AsyncStorage.setItem(KEY, JSON.stringify(state))
      .then(() => { lastSaved.current = v; setSync({ status: 'saved', at: new Date() }); })
      .catch(() => setSync({ status: 'failed', at: sync.at, retry: () => dispatch({ type: 'set', patch: {} }) }));
  }, [state.version, ready]);

  const value = useMemo(() => ({ state, dispatch, ready, sync }), [state, ready, sync]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  return useContext(Ctx);
}
