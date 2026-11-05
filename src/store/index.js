// Durable persistence (AsyncStorage) with support for Bible, Socials, Gifting,
// Discover, WhatsApp-style Chat, and Jobs/Tasks Marketplace.
//
// Online mode (src/api): the server-backed slices (feed, videos, prayers, jobs, proposals, bids, coins,
// coinLog, supportAds, jobAdCredits, user identity) start empty and are filled by the sync layer, and are
// persisted under a separate key so they never mix with the on-device data of local mode. User actions
// still go through the reducer first (optimistic); the sync layer registers an "effects" handler via
// `registerEffects` that mirrors each action to the API and reconciles / rolls back.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as seed from '../data/seed';
import { seedRhythm } from '../data/rhythm';
import { applyMessageOp, fmtClock, getScopeMsgs, mergeServerPage, scopePatch, upsertMessage } from '../chat/messages';
import { API_CONFIG } from '../api/config';

const ONLINE = API_CONFIG.online;
export const STORE_KEY = ONLINE ? 'biblenestra.state.v2.online' : 'biblenestra.state.v2';
const KEY = STORE_KEY;

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
  wishes: seed.WISHES,
  feed: seed.FEED,
  recordings: [],
  joinedChannels: [],
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
  readerTheme: 'paper',
  lineSpacing: 'Comfortable',
  rhythm: seedRhythm(),
  bestStreak: 21,
  reflections: [],
  // v6
  supportAds: { date: '', count: 0 }, // Today "support us" fire tasks (resets daily)
  jobAdCredits: 0, // rewarded ads watched toward the next coin unlock (Jobs)
  coinLog: [], // { id, amount (+/-), reason, time }
  bids: {}, // jobId -> { coins, paidWith: 'coins'|'ads', time }
  gameStats: {}, // gameId -> { date, played, correct, best }
  scripturePop: { enabled: false, every: 180, quietFrom: 22, quietTo: 7, content: 'both', translation: 'KJV' },
  downloadedTranslations: ['KJV'],
  version: 0,
};

// Online mode: start the server-backed slices empty (no demo content, no demo coins) until the first sync.
const ONLINE_BLANK = {
  user: { ...seed.USER, id: null, displayName: 'Friend', username: 'friend', headline: '', country: '', church: { name: '', visible: false }, coins: 0 },
  coins: 0,
  feed: [],
  videos: [],
  prayers: [],
  jobs: [],
  proposals: [],
  bids: {},
  coinLog: [],
  follows: [],
  supportAds: { date: '', count: 0 },
  jobAdCredits: 0,
  giftTransactions: [],
  account: null, // { id, email, lastSyncedAt }
  // Server-backed slices in online mode: start empty, no seed demo data
  communities: [],
  groupMessages: {},
  chats: [],
  requests: [],
  wishes: [],
  rsvps: [],
  highlights: [],
  notes: [],
  bookmarks: [],
  reflections: [],
  rhythm: {},
  bestStreak: 0,
  channels: [],
  joinedChannels: [],
};
if (ONLINE) Object.assign(initial, ONLINE_BLANK);

// Helpers for the item-level actions used by the sync layer
const sliceOf = (a) => a.slice || (a.src === 'video' ? 'videos' : 'feed');
const mapItem = (list, id, fn) => (list || []).map((x) => (x.id === id ? fn(x) : x));

function reducer(s, a) {
  const bump = (patch) => ({ ...s, ...patch, version: s.version + 1 });
  switch (a.type) {
    case 'hydrate': {
      // Older saves had empty feed/wishes; keep the starter content in that case.
      const st = a.state || {};
      if (ONLINE) return { ...s, ...st, wishes: st.wishes && st.wishes.length ? st.wishes : s.wishes };
      return { ...s, ...st, feed: st.feed && st.feed.length ? st.feed : s.feed, wishes: st.wishes && st.wishes.length ? st.wishes : s.wishes };
    }
    case 'set': return bump(a.patch);
    // ---- sync layer (online mode) ----
    case 'serverSync': return bump(a.patch);
    case 'replaceItem': return bump({ [a.slice]: mapItem(s[a.slice], a.id, () => a.item) });
    case 'patchItem': return bump({ [a.slice]: mapItem(s[a.slice], a.id, (x) => ({ ...x, ...a.patch })) });
    case 'removeItem': return bump({ [a.slice]: (s[a.slice] || []).filter((x) => x.id !== a.id) });
    case 'appendItems': {
      // pagination: add items that aren't already in the slice
      const have = new Set((s[a.slice] || []).map((x) => x.id));
      return bump({ [a.slice]: [...(s[a.slice] || []), ...a.items.filter((x) => !have.has(x.id))] });
    }
    // ---- semantic social actions (same behaviour in local mode; mirrored to the API online) ----
    case 'react': {
      // reaction: null (clear) | 'like' (plain like) | 'amen' | 'love' | 'praise' | 'care'
      return bump({
        [sliceOf(a)]: mapItem(s[sliceOf(a)], a.id, (x) => {
          const on = !!a.reaction;
          const likes = Math.max(0, (Number(x.likes) || 0) + (on && !x.liked ? 1 : !on && x.liked ? -1 : 0));
          return { ...x, liked: on, reaction: on && a.reaction !== 'like' ? a.reaction : null, likes };
        }),
      });
    }
    case 'hidePost': {
      const list = s.hiddenPosts || [];
      return bump({ hiddenPosts: a.hidden === false ? list.filter((k) => k !== a.key) : [...list.filter((k) => k !== a.key), a.key] });
    }
    case 'sharePost': return bump({ [sliceOf(a)]: mapItem(s[sliceOf(a)], a.id, (x) => ({ ...x, shares: (Number(x.shares) || 0) + 1 })) });
    case 'restorePost': {
      const key = sliceOf(a);
      const list = (s[key] || []).filter((x) => x.id !== a.item.id);
      const i = Math.max(0, Math.min(a.index == null ? 0 : a.index, list.length));
      return bump({ [key]: [...list.slice(0, i), a.item, ...list.slice(i)] });
    }
    case 'commentPost': {
      // a.comment = { id, from, text, time, replies: [] }; a.parentId → reply
      return bump({
        feed: mapItem(s.feed, a.id, (f) => ({
          ...f,
          comments: (f.comments || 0) + 1,
          commentList: a.parentId
            ? (f.commentList || []).map((c) => (c.id === a.parentId ? { ...c, replies: [...(c.replies || []), a.comment] } : c))
            : [...(f.commentList || []), a.comment],
        })),
      });
    }
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
    case 'like':
      if (a.id && (s.feed || []).some((f) => f.id === a.id)) {
        return bump({ feed: s.feed.map((f) => (f.id === a.id ? { ...f, liked: !f.liked, likes: (f.likes || 0) + (f.liked ? -1 : 1) } : f)) });
      }
      return bump({ vodLiked: !s.vodLiked });

    // Feed posts
    case 'post': return bump({ feed: [{ id: 'f' + Date.now(), author: s.user.displayName, time: 'Just now', likes: 0, comments: 0, mine: true, ...a.post }, ...(s.feed || [])] });
    case 'savePost': return bump({ [sliceOf(a)]: (s[sliceOf(a)] || []).map((f) => (f.id === a.id ? { ...f, saved: !f.saved } : f)) });
    case 'deletePost': return bump({ [sliceOf(a)]: (s[sliceOf(a)] || []).filter((f) => f.id !== a.id && f.localId !== a.id) });

    // Wishes (prayer wishes / candles)
    case 'addWish': return bump({ wishes: [{ id: 'w' + Date.now(), author: s.user.displayName, time: 'Just now', candles: 0, amen: 0, responses: ['Prayer'], visibility: 'Public', category: 'Prayer', mine: true, ...a.w, title: a.w.title || (a.w.body || '').slice(0, 48), body: a.w.body || a.w.text || '' }, ...(s.wishes || [])] });
    case 'lightCandle': return bump({ wishes: (s.wishes || []).map((w) => (w.id === a.id ? { ...w, lit: !w.lit, candles: (w.candles || 0) + (w.lit ? -1 : 1) } : w)) });
    case 'amenWish': return bump({ wishes: (s.wishes || []).map((w) => (w.id === a.id ? { ...w, amened: !w.amened, amen: (w.amen || 0) + (w.amened ? -1 : 1) } : w)) });

    // Sermon Studio recordings
    case 'recording': return bump({ recordings: [{ id: 'rec' + Date.now(), status: 'draft', created: new Date().toISOString(), ...a.r }, ...(s.recordings || [])] });
    case 'recordingStatus': return bump({ recordings: (s.recordings || []).map((r) => (r.id === a.id ? { ...r, status: a.status, ...(a.patch || {}) } : r)) });
    case 'renameRecording': return bump({ recordings: (s.recordings || []).map((r) => (r.id === a.id ? { ...r, title: a.title } : r)) });
    case 'deleteRecording': return bump({ recordings: (s.recordings || []).filter((r) => r.id !== a.id) });

    // Notes
    case 'editNote': return bump({ notes: s.notes.map((n) => (n.id === a.id ? { ...n, text: a.text, when: 'Edited' } : n)) });

    // Channels
    case 'joinChannel': return bump({ joinedChannels: (s.joinedChannels || []).includes(a.id) ? s.joinedChannels.filter((x) => x !== a.id) : [...(s.joinedChannels || []), a.id] });
    case 'likeVideo': return bump({
      videos: s.videos.map((v) => (v.id === a.id ? { ...v, likes: v.likes + (v.liked ? -1 : 1), liked: !v.liked } : v)),
    });
    case 'commentVideo': return bump({
      videos: s.videos.map((v) => {
        if (v.id !== a.id) return v;
        const newC = { id: a.tempId || 'c' + Date.now(), from: s.user.displayName, text: a.text, time: 'Just now', likes: 0, replies: [], mine: true };
        if (a.replyTo) {
          return {
            ...v,
            commentCount: v.commentCount != null ? v.commentCount + 1 : undefined,
            comments: (v.comments || []).map((c) => (c.id === a.replyTo ? { ...c, replies: [...(c.replies || []), { id: a.tempId || 'cr' + Date.now(), from: s.user.displayName, text: a.text, time: 'Just now', mine: true }] } : c)),
          };
        }
        return { ...v, commentCount: v.commentCount != null ? v.commentCount + 1 : undefined, comments: [newC, ...(v.comments || [])] };
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
    case 'buyCoins': return bump({ coins: s.coins + a.amount, coinLog: [{ id: 'cl' + Date.now(), amount: a.amount, reason: a.reason || 'Coin purchase', time: new Date().toISOString() }, ...(s.coinLog || [])].slice(0, 60) });
    // v6 — coins economy & ads
    case 'earnCoins': return bump({ coins: s.coins + a.amount, coinLog: [{ id: 'cl' + Date.now(), amount: a.amount, reason: a.reason || 'Reward', time: new Date().toISOString() }, ...(s.coinLog || [])].slice(0, 60) });
    case 'spendCoins': {
      if (s.coins < a.amount) return s;
      return bump({ coins: s.coins - a.amount, coinLog: [{ id: 'cl' + Date.now(), amount: -a.amount, reason: a.reason || 'Spent', time: new Date().toISOString() }, ...(s.coinLog || [])].slice(0, 60) });
    }
    case 'supportAd': {
      const today = a.date;
      const cur = s.supportAds && s.supportAds.date === today ? s.supportAds.count : 0;
      return bump({ supportAds: { date: today, count: Math.min(4, cur + 1) } });
    }
    case 'jobAdCredit': {
      // one rewarded ad watched; every `need` ads converts to `coins`
      const n = (s.jobAdCredits || 0) + 1;
      if (n >= a.need) {
        return bump({ jobAdCredits: 0, coins: s.coins + a.coins, coinLog: [{ id: 'cl' + Date.now(), amount: a.coins, reason: 'Unlocked by watching ads', time: new Date().toISOString() }, ...(s.coinLog || [])].slice(0, 60) });
      }
      return bump({ jobAdCredits: n });
    }
    case 'placeBid': {
      if (a.coins && s.coins < a.coins) return s;
      return bump({
        coins: s.coins - (a.coins || 0),
        bids: { ...(s.bids || {}), [a.jobId]: { coins: a.coins || 0, time: new Date().toISOString() } },
        coinLog: a.coins ? [{ id: 'cl' + Date.now(), amount: -a.coins, reason: 'Bid on a job', time: new Date().toISOString() }, ...(s.coinLog || [])].slice(0, 60) : s.coinLog,
      });
    }
    case 'gameResult': {
      const prev = (s.gameStats || {})[a.gameId] || {};
      return bump({ gameStats: { ...(s.gameStats || {}), [a.gameId]: { date: a.date, played: (prev.played || 0) + 1, correct: (prev.correct || 0) + a.correct, best: Math.max(prev.best || 0, a.score || 0) } } });
    }
    case 'scripturePop': return bump({ scripturePop: { ...(s.scripturePop || {}), ...a.patch } });
    case 'downloadedTranslation': return bump({ downloadedTranslations: Array.from(new Set([...(s.downloadedTranslations || ['KJV']), a.code])) });
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
      return bump({ groupMessages: { ...s.groupMessages, [a.gid]: { ...g, [a.channel]: [...ch, { id: a.localId || 'm' + Date.now(), from: s.user.displayName, mine: true, time: fmtClock(Date.now()), createdAt: Date.now(), ...a.m }] } } });
    }
    case 'dm': {
      const exists = (s.chats || []).some((c) => c.id === a.cid);
      const newMsg = { id: a.localId || 'x' + Date.now(), from: s.user.displayName, mine: true, time: fmtClock(Date.now()), createdAt: Date.now(), text: a.text, status: 'sent', audio: a.audio || null, reply: a.reply || null };
      if (!exists) {
        return bump({
          chats: [{
            id: a.cid,
            with: a.with || 'Direct message',
            type: 'Direct message',
            last: a.text,
            time: 'Just now',
            unread: 0,
            messages: [newMsg],
          }, ...(s.chats || [])],
        });
      }
      return bump({
        chats: (s.chats || []).map((c) => (c.id === a.cid ? { ...c, last: a.text, time: 'Just now', messages: [...(c.messages || []), newMsg] } : c)),
      });
    }
    // ROUND 4 — message actions (DMs + group channels). `scope` comes from src/chat/messages.js.
    case 'msgOp': {
      const list = getScopeMsgs(s, a.scope);
      if (!list.some((m) => m.id === a.id)) return s;
      return bump(scopePatch(s, a.scope, applyMessageOp(list, a)));
    }
    case 'msgSet': return bump(scopePatch(s, a.scope, a.merge === false ? a.messages : mergeServerPage(getScopeMsgs(s, a.scope), a.messages)));
    case 'msgUpsert': {
      const list = getScopeMsgs(s, a.scope);
      return bump(scopePatch(s, a.scope, upsertMessage(list, a.message, a.localId), a.unreadBump ? { unread: ((s.chats.find((c) => `dm:${c.id}` === a.scope) || {}).unread || 0) + 1, time: 'Just now' } : {}));
    }
    case 'msgRemove': return bump(scopePatch(s, a.scope, getScopeMsgs(s, a.scope).filter((m) => m.id !== a.id)));
    case 'newChat': {
      const newId = a.cid || a.id || ('d' + Date.now());
      return bump({
        chats: [{
          id: newId,
          with: a.name,
          username: a.username || '@user',
          avatar: a.avatar || (a.name ? a.name.slice(0, 2).toUpperCase() : 'ME'),
          type: a.kind || 'Direct message',
          last: a.text || 'Started a conversation',
          time: 'Just now',
          unread: 0,
          messages: a.text ? [{ id: 'x' + Date.now(), from: s.user.displayName, mine: true, time: 'Just now', text: a.text, status: 'sent' }] : []
        }, ...s.chats.filter((c) => c.id !== newId)],
      });
    }
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
    case 'signOut': {
      // Online sign-out: drop the account's server data (local Bible notes etc. stay on the device)
      return { ...s, ...ONLINE_BLANK, hiddenPosts: [], version: s.version + 1 };
    }
    default: return s;
  }
}

const Ctx = createContext(null);

export function StoreProvider({ children }) {
  const [state, rawDispatch] = useReducer(reducer, initial);
  const [ready, setReady] = useState(false);
  // Always-current state (updated synchronously on every dispatch) + the online effects handler.
  const stateRef = useRef(initial);
  const effectsRef = useRef(null);
  const dispatch = useCallback((a) => {
    if (!a) return;
    const prev = stateRef.current;
    const next = reducer(prev, a);
    stateRef.current = next;
    rawDispatch(a);
    // `a.local` marks actions that must not be mirrored to the server (e.g. reconciliation from it)
    if (effectsRef.current && !a.local && next !== prev) {
      try { effectsRef.current(a, prev, next); } catch (e) { /* effects never break the UI */ }
    }
  }, []);
  const registerEffects = useCallback((fn) => {
    effectsRef.current = fn;
    return () => { if (effectsRef.current === fn) effectsRef.current = null; };
  }, []);
  const getState = useCallback(() => stateRef.current, []);
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

  const value = useMemo(() => ({ state, dispatch, ready, sync, registerEffects, getState }), [state, ready, sync]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  return useContext(Ctx);
}
