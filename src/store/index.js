// Durable persistence (AsyncStorage) with support for Bible, Socials, Gifting,
// Discover, WhatsApp-style Chat, and Jobs/Tasks Marketplace.
import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as seed from '../data/seed';

const KEY = 'biblenestra.state.v2';

const initial = {
  onboarded: true,
  user: seed.USER,
  coins: seed.USER.coins || 350,
  translation: 'KJV',
  compareWith: ['WEB', 'YOR'],
  lastPosition: { bookId: 'MAT', chapter: 1 },
  recent: [{ bookId: 'MAT', chapter: 1 }, { bookId: 'JHN', chapter: 3 }],
  highlights: [{ id: 'h1', bookId: 'JHN', chapter: 3, verse: 16, color: '#c9a45c', label: 'Promise', when: 'Yesterday' }],
  notes: [{ id: 'n1', bookId: 'MAT', chapter: 1, verse: 21, text: 'Jesus = "Yahweh saves". The name is the mission.', scope: 'Private', when: 'Mon' }],
  bookmarks: [{ id: 'b1', bookId: 'PSA', chapter: 23, verse: null, folder: 'Comfort', when: 'Sun' }],
  savedAnswers: [],
  savedSearches: ['grace', 'peace', 'salvation', 'shalom'],
  chatHistory: [],
  companionHistory: [],
  prayers: seed.PRAYERS,
  communities: seed.COMMUNITIES,
  groupMessages: seed.GROUP_MESSAGES,
  chats: seed.CHATS,
  requests: seed.MESSAGE_REQUESTS,
  plans: seed.PLANS,
  videos: seed.VIDEOS,
  jobs: seed.JOBS,
  proposals: [],
  channels: seed.CHANNELS_DATA,
  wishes: [],
  feed: [],
  vodLiked: false,
  giftTransactions: [
    { id: 'gt1', recipient: 'Grace Adeyemi', giftName: 'Flower Bouquet', coins: 25, time: 'Yesterday' },
  ],
  rsvps: ['e1'],
  follows: ['@pastortunde', '@graceadeyemi', 'ch1'],
  blocked: [],
  notifications: { push: true, email: false, bible: true, groups: true, prayer: true, events: true, gifts: true, jobs: true },
  streaksEnabled: true,
  fontSize: 16,
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
    
    // Prayers
    case 'addPrayer': return bump({ prayers: [{ id: 'pr' + Date.now(), created: 'Just now', praying: 0, updates: [], status: 'active', mine: true, author: a.p.anonymous ? 'Anonymous' : s.user.displayName, ...a.p }, ...s.prayers] });
    case 'pray': return bump({ prayers: s.prayers.map((p) => (p.id === a.id ? { ...p, praying: p.praying + (p.prayed ? -1 : 1), prayed: !p.prayed, status: p.status === 'active' ? 'receiving' : p.status } : p)) });
    case 'prayerStatus': return bump({ prayers: s.prayers.map((p) => (p.id === a.id ? { ...p, status: a.status, updates: a.update ? [{ text: a.update, when: 'Just now' }, ...p.updates] : p.updates } : p)) });

    // Socials & Virtual Gifting
    case 'like': return bump({ vodLiked: !s.vodLiked });
    case 'likeVideo': return bump({
      videos: s.videos.map((v) => (v.id === a.id ? { ...v, likes: v.likes + (v.liked ? -1 : 1), liked: !v.liked } : v)),
    });
    case 'commentVideo': return bump({
      videos: s.videos.map((v) => {
        if (v.id !== a.id) return v;
        const newC = { id: 'c' + Date.now(), from: s.user.displayName, text: a.text, time: 'Just now', likes: 0, replies: [] };
        if (a.replyTo) {
          return {
            ...v,
            comments: v.comments.map((c) => (c.id === a.replyTo ? { ...c, replies: [...c.replies, { id: 'cr' + Date.now(), from: s.user.displayName, text: a.text, time: 'Just now' }] } : c)),
          };
        }
        return { ...v, comments: [newC, ...v.comments] };
      }),
    });
    case 'sendGift': {
      if (s.coins < a.coins) return s;
      const tx = { id: 'gt' + Date.now(), recipient: a.recipient, giftName: a.giftName, coins: a.coins, time: 'Just now' };
      return bump({
        coins: s.coins - a.coins,
        giftTransactions: [tx, ...s.giftTransactions],
        videos: s.videos.map((v) => (v.id === a.videoId ? { ...v, gifts: v.gifts + 1 } : v)),
      });
    }
    case 'buyCoins': return bump({ coins: s.coins + a.amount });
    case 'publishVideo': return bump({ videos: [a.video, ...s.videos] });

    // Jobs & Marketplace
    case 'postJob': return bump({ jobs: [{ id: 'job' + Date.now(), posted: 'Just now', proposalsCount: 0, status: 'open', client: { name: s.user.displayName, church: s.user.church?.name || 'Local Church', verified: true }, ...a.job }, ...s.jobs] });
    case 'applyJob': {
      const prop = { id: 'prop' + Date.now(), jobId: a.jobId, jobTitle: a.jobTitle, time: 'Just now', status: 'Pending Review', ...a.proposal };
      return bump({
        proposals: [prop, ...s.proposals],
        jobs: s.jobs.map((j) => (j.id === a.jobId ? { ...j, proposalsCount: j.proposalsCount + 1 } : j)),
      });
    }

    // Communities & Chats
    case 'join': return bump({ communities: s.communities.map((c) => (c.id === a.id ? { ...c, joined: c.privacy === 'Private' && !c.joined ? 'requested' : !c.joined } : c)) });
    case 'groupMessage': {
      const g = s.groupMessages[a.gid] || {};
      const ch = g[a.channel] || [];
      return bump({ groupMessages: { ...s.groupMessages, [a.gid]: { ...g, [a.channel]: [...ch, { id: 'm' + Date.now(), from: s.user.displayName, mine: true, time: 'Just now', ...a.m }] } } });
    }
    case 'dm': return bump({
      chats: s.chats.map((c) => (c.id === a.cid ? { ...c, last: a.text, time: 'Just now', messages: [...c.messages, { id: 'x' + Date.now(), from: s.user.displayName, mine: true, time: 'Just now', text: a.text, status: 'sent', audio: a.audio || null }] } : c)),
    });
    case 'newChat': return bump({
      chats: [{ id: 'd' + Date.now(), with: a.name, username: a.username || '@user', avatar: a.avatar || a.name.slice(0, 2).toUpperCase(), type: a.kind || 'Direct', last: a.text || 'Started a conversation', time: 'Just now', unread: 0, messages: a.text ? [{ id: 'x' + Date.now(), from: s.user.displayName, mine: true, time: 'Just now', text: a.text, status: 'sent' }] : [] }, ...s.chats],
    });
    case 'request': return bump({
      requests: s.requests.filter((r) => r.id !== a.id),
      chats: a.accept ? [{ id: 'd' + Date.now(), with: a.from, username: '@member', avatar: a.from.slice(0, 2).toUpperCase(), type: 'General', last: a.text, time: 'Just now', unread: 0, messages: [{ id: 'x' + Date.now(), from: a.from, time: 'Just now', text: a.text, status: 'delivered' }] }, ...s.chats] : s.chats,
    });
    case 'planDone': return bump({ plans: s.plans.map((p) => (p.id === a.id ? { ...p, done: Math.min(p.days, p.done + 1), streak: p.streak + 1 } : p)) });
    case 'rsvp': return bump({ rsvps: s.rsvps.includes(a.id) ? s.rsvps.filter((x) => x !== a.id) : [...s.rsvps, a.id] });
    case 'follow': return bump({ follows: s.follows.includes(a.id) ? s.follows.filter((x) => x !== a.id) : [...s.follows, a.id] });
    case 'block': return bump({ blocked: [...s.blocked, a.id] });
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
      } catch (e) { /* Start clean */ }
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
