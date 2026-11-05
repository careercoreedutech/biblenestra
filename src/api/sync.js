// Sync layer (online / dev-online modes only — in local mode it does nothing).
//
// Incoming: on sign-in, on app foreground and on demand (pull-to-refresh, "Sync now") it loads
//   /me, /feed (+ following), /videos, /prayers, /jobs, /me/bids, /coins/ledger
// and maps them into the existing store shapes (see ./mappers.js).
//
// Outgoing: it registers an effects handler on the store. Screens keep dispatching their usual actions;
// the reducer applies them optimistically and the handler mirrors them to the API, then reconciles with
// the server's answer or rolls back (with a toast) on failure. Server-authoritative flows that need the
// answer before continuing (bids, rewarded-ad credits) are exposed as async methods on useSync().
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, RefreshControl } from 'react-native';
import { colors } from '../theme';
import { useStore } from '../store';
import { useToast } from '../components/Toast';
import { useApi } from './auth';
import { errorMessage } from './client';
import { setAdUserId } from '../ads/Ads';
import { dayKey } from '../data/rhythm';
import { uploadImage, uploadVideo } from './media';
import { RealtimeClient } from './realtime';
import { registerForPushNotificationsAsync } from '../notifications/push';
import {
  splitPosts, mapFeedPost, mapVideoPost, mapComments, mapPrayer, mapJob, mapBid, mapLedger, mapMeToUser, followKeyOf,
  mapConversation, mapMessage, mapCommunity, mapEvent, mapWish, mapNotification, ago,
} from './mappers';
import {
  dmScope, groupScope, getScopeMsgs, mapServerMessage, outgoingBody, scopeConversationId, scopesForConversation,
} from '../chat/messages';

const SyncCtx = createContext(null);
const OFF = {
  online: false,
  mode: 'local',
  status: 'idle',
  realtimeStatus: 'disconnected',
  lastSyncedAt: null,
  hasMore: false,
  loadingMore: false,
  refresh: async () => {},
  loadMore: async () => {},
  loadComments: async () => {},
  placeBid: null,
  creditAd: null,
  sendGift: null,
  loadChatMessages: async () => {},
  loadThread: null,
  markChatRead: async () => {},
  signOut: async () => {},
  me: null,
};
export function useSync() {
  return useContext(SyncCtx) || OFF;
}

/**
 * Online-only pull-to-refresh for a ScrollView: `<ScrollView refreshControl={usePullRefresh()}>`.
 * Returns undefined in local mode.
 */
export function usePullRefresh() {
  const sync = useSync();
  const [pulling, setPulling] = useState(false);
  if (!sync.online) return undefined;
  const onRefresh = async () => {
    setPulling(true);
    try { await sync.refresh(); } finally { setPulling(false); }
  };
  return <RefreshControl refreshing={pulling} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />;
}

const PAGE = 20;
const DELETE_GRACE_MS = 4500; // the "Undo" window of the delete toast
const FOREGROUND_MIN_GAP = 20000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Ids created on the device before the server answered (f…, v…, pr…, job…, rp_…)
const isServerId = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(String(id || ''));
const byNewest = (a, b) => (b.createdAt || 0) - (a.createdAt || 0);
const AUDIENCE = { Public: 'Public', Church: 'Church', Private: 'Private', Community: 'Church' };
const SERVER_PRAYER_STATUS = ['active', 'receiving', 'answered', 'archived'];
// App game ids → the Worker's game ids (backend/src/lib/rules.js `gameIds`)
const SERVER_GAME_ID = { trivia: 'trivia_master', who: 'who_said_it', scramble: 'verse_scramble', chronology: 'timeline_challenge' };

export function SyncProvider({ children }) {
  const api = useApi();
  if (!api.online) return children;
  return <OnlineSync api={api}>{children}</OnlineSync>;
}

function OnlineSync({ api, children }) {
  const { dispatch, registerEffects, getState, ready } = useStore();
  const toast = useToast();
  const [status, setStatus] = useState('idle'); // idle | syncing | error
  const [error, setError] = useState(null);
  const [me, setMe] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [realtimeStatus, setRealtimeStatus] = useState('disconnected');
  const rtClientRef = useRef(null);

  useEffect(() => {
    if (!api.online) return;
    const client = new RealtimeClient({ request, apiUrl: api.apiUrl });
    rtClientRef.current = client;

    client.onStatusChange((st) => setRealtimeStatus(st));

    client.onEvent((ev) => {
      if (ev.type === 'message.new') {
        // ROUND 4: a conversation can be open as a direct chat and/or a group channel — update every place it shows.
        const msg = ev.message;
        const s = getState();
        const scopes = scopesForConversation(s, ev.conversationId);
        if (!scopes.length) { refresh({ quiet: true }); return; }
        for (const scope of scopes) {
          const prevMsg = getScopeMsgs(s, scope).find((m) => m.id === msg.id);
          local({ type: 'msgUpsert', scope, message: mapServerMessage(msg, prevMsg), unreadBump: !msg.isMe && !prevMsg && scope.startsWith('dm:') });
        }
      } else if (ev.type === 'message.changed') {
        // edited / deleted / pinned / reacted — fetch the message as this viewer sees it
        const s = getState();
        const scopes = scopesForConversation(s, ev.conversationId);
        if (!scopes.length) return;
        request('GET', `/messages/${ev.messageId}`)
          .then((m) => {
            const cur = getState();
            for (const scope of scopes) {
              if (!getScopeMsgs(cur, scope).some((x) => x.id === m.id)) continue;
              local({ type: 'msgUpsert', scope, message: mapServerMessage(m, getScopeMsgs(cur, scope).find((x) => x.id === m.id)) });
              if (ev.change === 'pinned') local({ type: 'msgOp', scope, id: m.id, op: 'pin' }); // keep max-3 order locally
            }
          })
          .catch((e) => {
            if (e && e.status === 404) for (const scope of scopes) local({ type: 'msgRemove', scope, id: ev.messageId });
          });
      } else if (ev.type === 'gift.received') {
        const s = getState();
        local({
          type: 'serverSync',
          patch: {
            coins: (s.coins || 0) + (ev.coins || 0),
          },
        });
        refreshLedger();
        toastRef.current.show(`🎁 ${ev.from?.displayName || 'Someone'} sent you a ${ev.gift?.name || 'Gift'}! (+${ev.coins} coins)`, { icon: 'gift', haptic: 'success', duration: 4000 });
      } else if (ev.type === 'request.new') {
        refresh({ quiet: true });
        toastRef.current.show(`New message request from ${ev.from?.displayName || 'a believer'}`, { icon: 'chat' });
      }
    });

    client.connect();

    return () => {
      client.disconnect();
    };
  }, [api.apiUrl, api.online]);

  const req = useRef(api.request);
  req.current = api.request;
  const request = useMemo(() => {
    // stable wrapper that always uses the latest authed request, and keeps its helpers (used by uploads)
    const fn = (...args) => req.current(...args);
    fn.authHeaders = (...args) => req.current.authHeaders(...args);
    Object.defineProperty(fn, 'apiUrl', { get: () => req.current.apiUrl });
    return fn;
  }, []);
  const meRef = useRef(null);
  const cursor = useRef(null);
  const syncing = useRef(null);
  const lastSync = useRef(0);
  const pendingDeletes = useRef({}); // item id → timeout
  const handles = useRef({}); // follow key (@handle) → user id
  const offlineRhythmQueue = useRef(new Map()); // day -> { steps, reflection }
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const local = (a) => dispatch({ ...a, local: true });
  const fail = (e, msg) => toastRef.current.show(`${msg}${e && e.code === 'NETWORK' ? ' — you seem to be offline' : ''}`, { tone: 'error', icon: 'x' });

  const rememberHandles = (feed, videos) => {
    feed.forEach((f) => {
      if (f.authorHandle && f.authorId) handles.current[f.authorHandle] = f.authorId;
      if (f.author && f.authorId) handles.current[f.author] = f.authorId;
    });
    videos.forEach((v) => {
      if (v.creator && v.creator.handle && v.creator.userId) handles.current[v.creator.handle] = v.creator.userId;
      if (v.creator && v.creator.name && v.creator.userId) handles.current[v.creator.name] = v.creator.userId;
    });
  };

  const applyMe = useCallback((m) => {
    meRef.current = m;
    setMe(m);
    setAdUserId(m.id);
    registerForPushNotificationsAsync(request);
    const s = getState();
    local({
      type: 'serverSync',
      patch: {
        user: mapMeToUser(m, s.user),
        coins: m.coins,
        jobAdCredits: m.jobAdCredits,
        supportAds: { date: dayKey(new Date()), count: m.supportAdsToday || 0 },
      },
    });
  }, []);

  const refreshLedger = useCallback(async () => {
    try {
      const l = await request('GET', '/coins/ledger');
      local({ type: 'serverSync', patch: { coinLog: mapLedger(l.items) } });
    } catch (e) { /* non-critical */ }
  }, []);

  // ───────────── full refresh ─────────────
  const refresh = useCallback(async ({ quiet } = {}) => {
    if (syncing.current) return syncing.current;
    const run = (async () => {
      setStatus('syncing');
      try {
        let m = await request('GET', '/me');
        const s0 = getState();
        // A different account signed in on this device → drop the previous account's server data
        if (s0.account && s0.account.id && s0.account.id !== m.id) local({ type: 'signOut' });
        // First sign-in with Clerk: take the display name from the Clerk profile
        if (api.clerkName && (!s0.account || !s0.account.namePushed) && (m.displayName === 'Friend' || !m.displayName)) {
          try { m = await request('PUT', '/me', { displayName: api.clerkName }); } catch (e) { /* keep default */ }
        }
        applyMe(m);
        const [feedR, videosR, followR, prayersR, jobsR, bidsR, ledgerR, convsR, reqsR, commsR, eventsR, wishesR, studyR, notifsR, rhythmR, annR] = await Promise.allSettled([
          request('GET', `/feed?limit=${PAGE}`),
          request('GET', '/videos?limit=10'),
          request('GET', '/me/following'),
          request('GET', '/prayers'),
          request('GET', '/jobs'),
          request('GET', '/me/bids'),
          request('GET', '/coins/ledger'),
          request('GET', '/conversations'),
          request('GET', '/me/requests'),
          request('GET', '/communities'),
          request('GET', '/events'),
          request('GET', '/wishes'),
          request('GET', '/me/study'),
          request('GET', '/me/notifications'),
          request('GET', '/me/rhythm'),
          request('GET', '/announcements'), // ROUND 5
        ]);
        const s = getState();
        const patch = {};
        if (feedR.status === 'fulfilled') {
          const page = feedR.value;
          const { feed, videos } = splitPosts(page.items, s.feed, s.videos);
          let allVideos = videos;
          if (videosR.status === 'fulfilled') {
            const extra = splitPosts(videosR.value.items, s.feed, s.videos).videos;
            const seen = new Set(allVideos.map((v) => v.id));
            allVideos = [...allVideos, ...extra.filter((v) => !seen.has(v.id))];
          }
          // Keep posts still being created on this device (not on the server yet)
          const pendingFeed = (s.feed || []).filter((f) => !isServerId(f.id));
          const pendingVideos = (s.videos || []).filter((v) => !isServerId(v.id));
          patch.feed = [...pendingFeed, ...feed];
          patch.videos = [...pendingVideos, ...allVideos].sort(byNewest);
          rememberHandles(feed, allVideos);
          cursor.current = page.nextCursor;
          setHasMore(!!page.nextCursor);
        }
        if (followR.status === 'fulfilled') {
          const keys = new Set();
          // everyone I follow (GET /me/following returns users)
          (followR.value.items || []).forEach((u) => {
            if (u && u.id) {
              const k = followKeyOf(u);
              keys.add(k);
              handles.current[k] = u.id;
            }
          });
          // channels / local ids stay; user handles come from the server
          patch.follows = [...(s.follows || []).filter((k) => !String(k).startsWith('@')), ...keys];
        }
        if (prayersR.status === 'fulfilled') {
          const pending = (s.prayers || []).filter((p) => !isServerId(p.id));
          const prevP = new Map((s.prayers || []).map((x) => [x.id, x]));
          patch.prayers = [...pending, ...(prayersR.value.items || []).map((x) => {
            const old = prevP.get(x.id);
            // keep the device id a just-posted prayer was opened with, and the device-only 'updated' label
            return { ...mapPrayer(x), localId: old ? old.localId : undefined, ...(old && old.status === 'updated' && x.status === 'active' ? { status: 'updated' } : {}) };
          })];
        }
        if (jobsR.status === 'fulfilled') {
          const pending = (s.jobs || []).filter((j) => !isServerId(j.id));
          const prevJ = new Map((s.jobs || []).map((x) => [x.id, x]));
          const jobs = (jobsR.value.items || []).map((x) => ({ ...mapJob(x), localId: prevJ.get(x.id) ? prevJ.get(x.id).localId : undefined }));
          patch.jobs = [...pending, ...jobs];
        }
        if (bidsR.status === 'fulfilled') {
          const items = bidsR.value.items || [];
          patch.proposals = items.map((b) => mapBid(b, m));
          patch.bids = Object.fromEntries(items.map((b) => [b.jobId, { coins: b.feeCoins || 0, time: b.createdAt }]));
        }
        if (ledgerR.status === 'fulfilled') patch.coinLog = mapLedger(ledgerR.value.items);
        if (convsR.status === 'fulfilled') {
          const convMap = new Map((s.chats || []).map((c) => [c.id, c]));
          patch.chats = (convsR.value.items || []).map((c) => {
            if (c.otherUser && c.otherUser.id) {
              if (c.otherUser.displayName) handles.current[c.otherUser.displayName] = c.otherUser.id;
              if (c.otherUser.handle) handles.current[c.otherUser.handle] = c.otherUser.id;
            }
            return mapConversation(c, convMap.get(c.id));
          });
        }
        if (reqsR.status === 'fulfilled') {
          patch.requests = (reqsR.value.items || []).map((r) => {
            if (r.fromUser && r.fromUser.displayName && r.fromId) {
              handles.current[r.fromUser.displayName] = r.fromId;
              if (r.fromUser.handle) handles.current[r.fromUser.handle] = r.fromId;
            }
            return {
              id: r.fromId,
              from: r.fromUser?.displayName || 'Believer',
              time: ago(r.createdAt),
              text: r.lastMessage?.body || 'Sent you a message request',
              category: 'Direct',
            };
          });
        }
        if (commsR.status === 'fulfilled') {
          patch.communities = (commsR.value.items || []).map((c) => ({
            ...mapCommunity(c),
            joined: c.myStatus === 'member' ? true : c.myStatus === 'requested' ? 'requested' : false,
          }));
        }
        if (eventsR.status === 'fulfilled') {
          patch.events = (eventsR.value.items || []).map(mapEvent);
          patch.rsvps = (eventsR.value.items || []).filter((e) => e.myRsvp === 'going').map((e) => e.id);
        }
        if (wishesR.status === 'fulfilled') {
          patch.wishes = (wishesR.value.items || []).map(mapWish);
        }
        if (studyR.status === 'fulfilled') {
          const st = studyR.value;
          if (st.notes) patch.notes = st.notes.map((n) => ({ id: n.id, bookId: n.bookId, chapter: n.chapter, verse: n.verse, text: n.text, scope: n.scope, when: ago(n.updatedAt) }));
          if (st.highlights) patch.highlights = st.highlights.map((h) => ({ id: h.id, bookId: h.bookId, chapter: h.chapter, verse: h.verse, color: h.color, when: ago(h.updatedAt) }));
          if (st.bookmarks) patch.bookmarks = st.bookmarks.map((b) => ({ id: b.id, bookId: b.bookId, chapter: b.chapter, verse: b.verse, label: b.label, folder: b.folder, when: ago(b.updatedAt) }));
        }
        if (notifsR.status === 'fulfilled') {
          patch.notificationsList = (notifsR.value.items || []).map(mapNotification);
        }
        if (annR.status === 'fulfilled') patch.announcements = annR.value.items || []; // ROUND 5
        if (rhythmR.status === 'fulfilled') {
          const rData = rhythmR.value;
          const currentRhythm = { ...(s.rhythm || {}) };
          const serverDaysMap = new Map((rData.days || []).map((x) => [x.day, x.steps || []]));

          for (const item of rData.days || []) {
            const existing = currentRhythm[item.day] || [];
            currentRhythm[item.day] = Array.from(new Set([...existing, ...(item.steps || [])]));
          }
          patch.rhythm = currentRhythm;

          const reflectionsMap = new Map();
          (Array.isArray(s.reflections) ? s.reflections : []).forEach((r) => {
            if (r && r.day) reflectionsMap.set(r.day, r);
          });
          for (const item of rData.days || []) {
            if (item.reflection) {
              reflectionsMap.set(item.day, {
                day: item.day,
                text: item.reflection,
                updatedAt: item.updatedAt,
              });
            }
          }
          patch.reflections = Array.from(reflectionsMap.values());
          if (rData.bestStreak) {
            patch.bestStreak = Math.max(s.bestStreak || 0, rData.bestStreak);
          }

          // Offline retry: retry any offline-queued days
          if (offlineRhythmQueue.current.size > 0) {
            for (const [qDay, qData] of Array.from(offlineRhythmQueue.current.entries())) {
              try {
                await request('PUT', `/me/rhythm/${qDay}`, qData);
                offlineRhythmQueue.current.delete(qDay);
              } catch (err) {
                if (err && err.code !== 'NETWORK') offlineRhythmQueue.current.delete(qDay);
              }
            }
          }

          // Offline catch-up: check past 7 days up to today if local steps missing from server
          const nowD = new Date();
          for (let i = 0; i <= 7; i += 1) {
            const pastD = new Date(nowD.getTime() - i * 86400000);
            const checkKey = dayKey(pastD);
            const localSteps = (s.rhythm || {})[checkKey] || [];
            const serverSteps = serverDaysMap.get(checkKey) || [];
            if (localSteps.some((st) => !serverSteps.includes(st))) {
              request('PUT', `/me/rhythm/${checkKey}`, { steps: localSteps }).catch(() => {});
            }
          }
        }
        const now = new Date().toISOString();
        patch.account = { ...(getState().account || {}), id: m.id, lastSyncedAt: now, namePushed: true };
        local({ type: 'serverSync', patch });
        lastSync.current = Date.now();
        const failed = [feedR, prayersR, jobsR].filter((r) => r.status === 'rejected');
        if (failed.length) throw failed[0].reason;
        setError(null);
        setStatus('idle');
      } catch (e) {
        setError(errorMessage(e, 'Sync failed'));
        setStatus('error');
        if (!quiet) fail(e, 'Couldn’t sync with BibleNestra');
      } finally {
        syncing.current = null;
      }
    })();
    syncing.current = run;
    return run;
  }, [api.clerkName]);

  // First sync once the persisted store is loaded, then on every return to the foreground
  useEffect(() => {
    if (!ready) return undefined;
    refresh({ quiet: false });
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active' && Date.now() - lastSync.current > FOREGROUND_MIN_GAP) refresh({ quiet: true });
    });
    return () => sub.remove();
  }, [ready]);

  // ───────────── pagination ─────────────
  const loadMore = useCallback(async () => {
    if (!cursor.current || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await request('GET', `/feed?limit=${PAGE}&cursor=${encodeURIComponent(cursor.current)}`);
      const s = getState();
      const { feed, videos } = splitPosts(page.items, s.feed, s.videos);
      rememberHandles(feed, videos);
      if (feed.length) local({ type: 'appendItems', slice: 'feed', items: feed });
      if (videos.length) local({ type: 'appendItems', slice: 'videos', items: videos });
      cursor.current = page.nextCursor;
      setHasMore(!!page.nextCursor);
    } catch (e) {
      fail(e, 'Couldn’t load more posts');
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore]);

  // ───────────── comments ─────────────
  const loadComments = useCallback(async (src, id) => {
    if (!isServerId(id)) return;
    try {
      const r = await request('GET', `/posts/${id}/comments`);
      const list = mapComments(r.items);
      const count = (r.items || []).length;
      if (src === 'video') local({ type: 'patchItem', slice: 'videos', id, patch: { comments: list, commentCount: count } });
      else local({ type: 'patchItem', slice: 'feed', id, patch: { commentList: list, comments: count } });
    } catch (e) {
      fail(e, 'Couldn’t load comments');
    }
  }, []);

  // ───────────── helpers for effects ─────────────
  const findItem = (s, slice, id) => (s[slice] || []).find((x) => x.id === id || x.localId === id) || null;
  const rollbackItem = (slice, prevItem) => { if (prevItem) local({ type: 'replaceItem', slice, id: prevItem.id, item: prevItem }); };
  const reconcileReaction = (slice, id, r) => local({ type: 'patchItem', slice, id, patch: { likes: r.likes, liked: !!r.myReaction, reaction: r.myReaction && r.myReaction !== 'like' ? r.myReaction : null } });

  const pollVideo = async (id) => {
    for (let i = 0; i < 24; i += 1) {
      await wait(i < 4 ? 3000 : 6000);
      try {
        const p = await request('GET', `/posts/${id}`);
        const cur = findItem(getState(), 'videos', id);
        if (!cur) return;
        if (p.video && (p.video.status === 'ready' || p.video.status === 'error')) {
          local({ type: 'replaceItem', slice: 'videos', id, item: mapVideoPost(p, cur) });
          if (p.video.status === 'ready') toastRef.current.show('Your video is ready', { icon: 'video', haptic: 'success' });
          else toastRef.current.show('Your video couldn’t be processed', { tone: 'error' });
          return;
        }
      } catch (e) { /* keep polling */ }
    }
  };

  // ───────────── outgoing effects ─────────────
  // ROUND 4: send a just-dispatched local message to its conversation and swap in the server copy.
  const sendThreadMessage = (scope, convId, localId) => {
    const s = getState();
    const list = getScopeMsgs(s, scope);
    const m = localId ? list.find((x) => x.id === localId) : list[list.length - 1];
    if (!m) return;
    request('POST', `/conversations/${convId}/messages`, outgoingBody(m))
      .then((res) => local({ type: 'msgUpsert', scope, localId: m.id, message: mapServerMessage(res, m) }))
      .catch((e) => {
        const cur = getScopeMsgs(getState(), scope).find((x) => x.id === m.id);
        if (cur) local({ type: 'msgUpsert', scope, localId: m.id, message: { ...cur, status: 'failed' } });
        fail(e, `Message not sent: ${errorMessage(e)}`);
      });
  };

  const effects = useCallback((a, prev, next) => {
    const run = (fn) => { fn().catch(() => {}); };
    switch (a.type) {
      // Likes & reactions — feed posts use 'like', videos 'likeVideo', long-press reactions 'react'
      case 'like':
      case 'likeVideo':
      case 'react': {
        const slice = a.type === 'likeVideo' || a.src === 'video' ? 'videos' : 'feed';
        if (a.type === 'like' && !(prev.feed || []).some((f) => f.id === a.id)) return; // demo VOD like
        const before = findItem(prev, slice, a.id);
        const after = findItem(next, slice, a.id);
        if (!after || !isServerId(after.id)) return;
        const reaction = after.liked ? after.reaction || 'like' : null;
        run(async () => {
          try { reconcileReaction(slice, after.id, await request('POST', `/posts/${after.id}/react`, { reaction })); } catch (e) { rollbackItem(slice, before); fail(e, 'Couldn’t save your reaction'); }
        });
        return;
      }
      case 'savePost': {
        const slice = a.src === 'video' ? 'videos' : 'feed';
        const before = findItem(prev, slice, a.id);
        if (!before || !isServerId(before.id)) return;
        run(async () => {
          try {
            const r = await request('POST', `/posts/${before.id}/save`);
            local({ type: 'patchItem', slice, id: before.id, patch: { saved: !!r.saved } });
          } catch (e) { rollbackItem(slice, before); fail(e, 'Couldn’t update saved'); }
        });
        return;
      }
      case 'hidePost': {
        const id = String(a.key || '').replace(/^[pv]_/, '');
        if (!isServerId(id)) return;
        run(async () => {
          try { await request('POST', `/posts/${id}/hide`, { hidden: a.hidden !== false }); } catch (e) { local({ type: 'hidePost', key: a.key, hidden: a.hidden === false }); fail(e, 'Couldn’t hide that post'); }
        });
        return;
      }
      case 'sharePost': {
        const slice = a.src === 'video' ? 'videos' : 'feed';
        if (!isServerId(a.id)) return;
        run(async () => {
          try {
            const r = await request('POST', `/posts/${a.id}/share`);
            local({ type: 'patchItem', slice, id: a.id, patch: { shares: r.shares } });
          } catch (e) { /* a share counter isn't worth an error toast */ }
        });
        return;
      }
      case 'deletePost': {
        const slice = a.src === 'video' ? 'videos' : 'feed';
        const item = findItem(prev, slice, a.id);
        if (!item || !isServerId(item.id)) return;
        // Wait out the Undo window before deleting on the server
        clearTimeout(pendingDeletes.current[item.id]);
        pendingDeletes.current[item.id] = setTimeout(() => {
          delete pendingDeletes.current[item.id];
          run(async () => {
            try { await request('DELETE', `/posts/${item.id}`); } catch (e) {
              local({ type: 'restorePost', src: a.src, item, index: 0 });
              fail(e, 'Couldn’t delete that post');
            }
          });
        }, DELETE_GRACE_MS);
        return;
      }
      case 'restorePost': {
        const id = a.item && a.item.id;
        if (id && pendingDeletes.current[id]) { clearTimeout(pendingDeletes.current[id]); delete pendingDeletes.current[id]; }
        return;
      }
      case 'post': {
        const tempId = a.post && a.post.id ? a.post.id : (next.feed[0] && next.feed[0].id);
        const draft = findItem(next, 'feed', tempId);
        if (!draft) return;
        run(async () => {
          try {
            const images = [];
            for (const img of draft.images || []) {
              // eslint-disable-next-line no-await-in-loop
              const up = await uploadImage(request, img);
              images.push({ key: up.key, width: up.width || null, height: up.height || null });
            }
            const body = { kind: draft.kind || 'Reflection', text: draft.text || '' };
            if (draft.passage) body.passage = draft.passage;
            if (draft.bg) body.theme = draft.bg;
            if (images.length) body.images = images;
            const p = await request('POST', '/posts', body);
            local({ type: 'replaceItem', slice: 'feed', id: tempId, item: { ...mapFeedPost(p), localId: tempId } });
          } catch (e) {
            local({ type: 'removeItem', slice: 'feed', id: tempId });
            fail(e, e && e.code !== 'NETWORK' && e.message ? `Couldn’t share your post: ${e.message}` : 'Couldn’t share your post');
          }
        });
        return;
      }
      case 'publishVideo': {
        const v = a.video;
        if (!v || !v.upload) return; // sample-library videos (local mode) only
        const tempId = v.id;
        run(async () => {
          try {
            let last = 0;
            local({ type: 'patchItem', slice: 'videos', id: tempId, patch: { uploadProgress: 0, videoStatus: 'uploading' } });
            const { uid } = await uploadVideo(request, v.upload, (p) => {
              if (p - last >= 0.05 || p === 1) {
                last = p;
                local({ type: 'patchItem', slice: 'videos', id: tempId, patch: { uploadProgress: p } });
              }
            });
            const body = { kind: 'Video', text: v.caption || '', videoUid: uid, category: v.category || 'Video' };
            if (v.passage) body.passage = v.passage;
            const p = await request('POST', '/posts', body);
            const cur = findItem(getState(), 'videos', tempId);
            const mapped = { ...mapVideoPost(p, cur), localId: tempId };
            local({ type: 'replaceItem', slice: 'videos', id: tempId, item: mapped });
            if (mapped.processing) pollVideo(p.id);
          } catch (e) {
            local({ type: 'removeItem', slice: 'videos', id: tempId });
            fail(e, `Couldn’t publish your video${e && e.message ? `: ${e.message}` : ''}`);
          }
        });
        return;
      }
      case 'commentPost':
      case 'commentVideo': {
        const src = a.type === 'commentVideo' ? 'video' : 'post';
        if (!isServerId(a.id)) return;
        const slice = src === 'video' ? 'videos' : 'feed';
        const before = findItem(prev, slice, a.id);
        const parentId = a.type === 'commentVideo' ? a.replyTo : a.parentId;
        run(async () => {
          try {
            await request('POST', `/posts/${a.id}/comments`, { text: a.text || (a.comment && a.comment.text), ...(parentId && isServerId(parentId) ? { parentId } : {}) });
            await loadComments(src, a.id);
          } catch (e) { rollbackItem(slice, before); fail(e, 'Couldn’t post your comment'); }
        });
        return;
      }
      case 'follow': {
        const key = a.id;
        const userId = handles.current[key];
        if (!userId) return; // channels and other local follows
        const want = (next.follows || []).includes(key);
        run(async () => {
          try {
            const r = await request('POST', `/users/${userId}/follow`);
            if (!!r.following !== want) local({ type: 'follow', id: key }); // server says otherwise → match it
          } catch (e) { local({ type: 'follow', id: key }); fail(e, 'Couldn’t update follow'); }
        });
        return;
      }
      case 'addPrayer': {
        const draft = next.prayers && next.prayers[0];
        if (!draft || isServerId(draft.id)) return;
        run(async () => {
          try {
            const p = await request('POST', '/prayers', {
              title: draft.title || (draft.body || '').slice(0, 80) || 'Prayer request',
              body: draft.body || '',
              audience: AUDIENCE[draft.audience] || 'Public',
              anonymous: !!draft.anonymous,
              ...(draft.verse ? { verse: draft.verse } : {}),
            });
            local({ type: 'replaceItem', slice: 'prayers', id: draft.id, item: { ...mapPrayer(p), audience: draft.audience, localId: draft.id } });
          } catch (e) { local({ type: 'removeItem', slice: 'prayers', id: draft.id }); fail(e, 'Couldn’t post your prayer'); }
        });
        return;
      }
      case 'pray': {
        const before = findItem(prev, 'prayers', a.id);
        if (!before || !isServerId(before.id)) return;
        run(async () => {
          try {
            const r = await request('POST', `/prayers/${a.id}/pray`);
            local({ type: 'patchItem', slice: 'prayers', id: a.id, patch: { prayed: !!r.prayed, praying: r.praying } });
          } catch (e) { rollbackItem('prayers', before); fail(e, 'Couldn’t record your prayer'); }
        });
        return;
      }
      case 'prayerStatus': {
        const before = findItem(prev, 'prayers', a.id);
        // Only the author can post updates on the server; others' encouragements stay on this device.
        if (!before || !before.mine || !isServerId(before.id)) return;
        const body = {};
        if (a.update) body.text = a.update;
        if (SERVER_PRAYER_STATUS.includes(a.status) && a.status !== before.status) body.status = a.status;
        if (!Object.keys(body).length) return;
        run(async () => {
          try {
            const p = await request('POST', `/prayers/${a.id}/updates`, body);
            const keep = findItem(getState(), 'prayers', a.id);
            // 'updated' is a device-only status label; keep it if that's what the screen set
            local({ type: 'replaceItem', slice: 'prayers', id: a.id, item: { ...mapPrayer(p), status: keep && keep.status === 'updated' && p.status === 'active' ? 'updated' : p.status, audience: before.audience, localId: before.localId } });
          } catch (e) { rollbackItem('prayers', before); fail(e, 'Couldn’t update your prayer'); }
        });
        return;
      }
      case 'postJob': {
        const draft = next.jobs && next.jobs[0];
        if (!draft || isServerId(draft.id)) return;
        run(async () => {
          try {
            const j = await request('POST', '/jobs', {
              kind: draft.kind, title: draft.title, description: draft.description, category: draft.category,
              budget: draft.budget, deadline: draft.deadline, skills: draft.skills || [],
            });
            local({ type: 'replaceItem', slice: 'jobs', id: draft.id, item: { ...mapJob(j), localId: draft.id } });
          } catch (e) { local({ type: 'removeItem', slice: 'jobs', id: draft.id }); fail(e, `Couldn’t publish your listing: ${errorMessage(e)}`); }
        });
        return;
      }
      case 'gameResult': {
        run(async () => {
          try {
            const r = await request('POST', '/games/results', {
              gameId: SERVER_GAME_ID[a.gameId] || a.gameId,
              day: a.date,
              correct: a.correct || 0,
              total: Math.min(20, Math.max(a.total || 0, a.correct || 0, 1)),
            });
            local({ type: 'serverSync', patch: { coins: r.coins } }); // the server decides the reward
            refreshLedger();
          } catch (e) {
            fail(e, 'Couldn’t save your game result');
            // undo any coins the screen added optimistically
            try { applyMe(await request('GET', '/me')); } catch (err) { /* offline */ }
          }
        });
        return;
      }
      case 'user': {
        const u = a.user || {};
        const body = {};
        if (u.displayName != null) body.displayName = u.displayName;
        if (u.username != null) body.handle = u.username;
        if (u.headline != null) body.headline = u.headline;
        if (u.bio != null) body.bio = u.bio;
        if (u.country != null) body.country = u.country;
        if (u.church && u.church.name != null) body.church = u.church.name;
        if (u.translation != null) body.translation = u.translation;
        if (!Object.keys(body).length) return;
        run(async () => {
          try { applyMe(await request('PUT', '/me', body)); } catch (e) { local({ type: 'serverSync', patch: { user: prev.user } }); fail(e, `Couldn’t update your profile: ${errorMessage(e)}`); }
        });
        return;
      }
      case 'dm': {
        const cid = a.cid;
        if (!isServerId(cid)) return;
        sendThreadMessage(dmScope(cid), cid, a.localId);
        return;
      }
      case 'groupMessage': {
        // ROUND 4: group channels are server conversations when the community comes from the server
        const scope = groupScope(a.gid, a.channel);
        const convId = scopeConversationId(next, scope);
        if (!convId) return;
        sendThreadMessage(scope, convId, a.localId);
        return;
      }
      case 'msgOp': {
        const convId = scopeConversationId(next, a.scope);
        if (!convId || !isServerId(a.id)) return; // device-only thread or message still sending
        const before = getScopeMsgs(prev, a.scope);
        const rollback = (e, what) => { local({ type: 'msgSet', scope: a.scope, messages: before, merge: false }); fail(e, `${what}: ${errorMessage(e)}`); };
        run(async () => {
          try {
            if (a.op === 'edit') await request('PATCH', `/messages/${a.id}`, { text: a.text });
            else if (a.op === 'delete') await request('POST', `/messages/${a.id}/delete`, { for: 'everyone' });
            else if (a.op === 'deleteMe') await request('POST', `/messages/${a.id}/delete`, { for: 'me' });
            else if (a.op === 'pin' || a.op === 'unpin') await request('POST', `/messages/${a.id}/pin`, { pinned: a.op === 'pin' });
            else if (a.op === 'react') {
              const r = await request('POST', `/messages/${a.id}/react`, { emoji: a.emoji });
              const cur = getScopeMsgs(getState(), a.scope).find((m) => m.id === a.id);
              if (cur) local({ type: 'msgUpsert', scope: a.scope, message: { ...cur, reactions: r.reactions || [] } });
            }
          } catch (e) {
            const what = { edit: 'Couldn’t edit the message', delete: 'Couldn’t delete the message', deleteMe: 'Couldn’t delete the message', pin: 'Couldn’t pin the message', unpin: 'Couldn’t unpin the message', react: 'Couldn’t add your reaction' }[a.op] || 'Couldn’t update the message';
            rollback(e, what);
          }
        });
        return;
      }
      case 'newChat': {
        const target = a.name;
        run(async () => {
          try {
            const convId = a.cid || a.id;
            if (convId && isServerId(convId)) {
              if (a.text) {
                await request('POST', `/conversations/${convId}/messages`, {
                  kind: 'text',
                  text: a.text,
                  clientId: 'c_' + Date.now(),
                });
              }
              refresh({ quiet: true });
              return;
            }
            const uid = a.userId || handles.current['@' + target] || handles.current[target];
            if (uid) {
              const res = await request('POST', '/conversations/dm', { userId: uid });
              if (res && res.id) {
                if (a.text) {
                  await request('POST', `/conversations/${res.id}/messages`, {
                    kind: 'text',
                    text: a.text,
                    clientId: 'c_' + Date.now(),
                  });
                }
                refresh({ quiet: true });
              }
            }
          } catch (e) {
            fail(e, 'Could not start conversation');
          }
        });
        return;
      }
      case 'request': {
        const fromId = a.id;
        run(async () => {
          try {
            await request('POST', `/me/requests/${fromId}/${a.accept ? 'accept' : 'decline'}`);
            refresh({ quiet: true });
          } catch (e) {
            fail(e, 'Could not respond to request');
          }
        });
        return;
      }
      case 'join': {
        const commId = a.id;
        if (!isServerId(commId)) return;
        run(async () => {
          try {
            await request('POST', `/communities/${commId}/join`);
          } catch (e) {
            fail(e, 'Could not update community membership');
          }
        });
        return;
      }
      case 'rsvp': {
        const evId = a.id;
        if (!isServerId(evId)) return;
        const want = (next.rsvps || []).includes(evId);
        run(async () => {
          try {
            await request('POST', `/events/${evId}/rsvp`, { status: want ? 'going' : 'no' });
          } catch (e) {
            fail(e, 'Could not update RSVP');
          }
        });
        return;
      }
      case 'addWish': {
        const w = a.w || {};
        run(async () => {
          try {
            await request('POST', '/wishes', {
              title: w.title,
              body: w.body,
              category: w.category || 'Personal',
              visibility: w.visibility || 'Public',
              anonymous: !!w.anonymous,
            });
            refresh({ quiet: true });
          } catch (e) {
            fail(e, 'Could not post wish');
          }
        });
        return;
      }
      case 'lightCandle': {
        const wid = a.id;
        if (!isServerId(wid)) return;
        run(async () => {
          try {
            await request('POST', `/wishes/${wid}/candle`);
          } catch (e) {
            fail(e, 'Could not light candle');
          }
        });
        return;
      }
      case 'amenWish': {
        const wid = a.id;
        if (!isServerId(wid)) return;
        run(async () => {
          try {
            await request('POST', `/wishes/${wid}/amen`);
          } catch (e) {
            fail(e, 'Could not pray Amen');
          }
        });
        return;
      }
      case 'planDone': {
        const pid = a.id;
        run(async () => {
          try {
            await request('PUT', '/me/study/plans', { planId: pid, day: a.day || 1, done: true });
          } catch (e) {
            // non critical
          }
        });
        return;
      }
      case 'highlight': {
        const h = a.h || {};
        run(async () => {
          try {
            await request('PUT', '/me/study/highlights', {
              bookId: h.bookId,
              chapter: h.chapter,
              verse: h.verse,
              color: h.color,
            });
          } catch (e) {
            // offline fallback
          }
        });
        return;
      }
      case 'note': {
        const n = a.n || {};
        run(async () => {
          try {
            await request('PUT', '/me/study/notes', {
              bookId: n.bookId,
              chapter: n.chapter,
              verse: n.verse,
              text: n.text,
              scope: n.scope || 'Private',
            });
          } catch (e) {
            // offline fallback
          }
        });
        return;
      }
      case 'deleteNote': {
        const nid = a.id;
        if (isServerId(nid)) {
          run(async () => {
            try {
              await request('DELETE', `/me/study/notes/${nid}`);
            } catch (e) {
              // offline fallback
            }
          });
        }
        return;
      }
      case 'bookmark': {
        const b = a.b || {};
        run(async () => {
          try {
            await request('PUT', '/me/study/bookmarks', {
              bookId: b.bookId,
              chapter: b.chapter,
              verse: b.verse,
              label: b.label,
              folder: b.folder,
            });
          } catch (e) {
            // offline fallback
          }
        });
        return;
      }
      case 'block': {
        const targetId = a.id;
        if (!isServerId(targetId)) return;
        run(async () => {
          try {
            await request('POST', `/users/${targetId}/block`);
          } catch (e) {
            fail(e, 'Could not block user');
          }
        });
        return;
      }
      case 'set': {
        if (a.patch && a.patch.notifications) {
          run(async () => {
            try {
              await request('PUT', '/me/notify-settings', a.patch.notifications);
            } catch (e) {
              // non-critical
            }
          });
        }
        if (a.patch && a.patch.rhythm) {
          const rhythmPatch = a.patch.rhythm;
          const days = Object.keys(rhythmPatch);
          for (const d of days) {
            const prevSteps = (prev.rhythm && prev.rhythm[d]) || [];
            const nextSteps = rhythmPatch[d] || [];
            const hasReflection = a.patch.reflection && a.patch.reflection.day === d;
            if (nextSteps.length !== prevSteps.length || hasReflection || nextSteps.some((st) => !prevSteps.includes(st))) {
              run(async () => {
                const body = { steps: nextSteps };
                if (hasReflection) {
                  body.reflection = a.patch.reflection.text;
                }
                try {
                  const res = await request('PUT', `/me/rhythm/${d}`, body);
                  offlineRhythmQueue.current.delete(d);
                  if (res && res.bestStreak) {
                    local({
                      type: 'serverSync',
                      patch: {
                        bestStreak: Math.max(getState().bestStreak || 0, res.bestStreak),
                      },
                    });
                  }
                } catch (e) {
                  // If network offline, queue for retry on reconnect
                  if (e && e.code === 'NETWORK') {
                    offlineRhythmQueue.current.set(d, body);
                  } else {
                    fail(e, 'Couldn’t sync rhythm step');
                  }
                }
              });
            }
          }
        }
        return;
      }
      case 'sendGift': {
        const video = prev.videos.find((v) => v.id === a.videoId);
        const creatorId = video?.authorId || handles.current[video?.creator?.handle];
        if (!creatorId) return;
        run(async () => {
          try {
            const giftObj = a.giftId ? { id: a.giftId } : { id: 'g_rose' };
            const res = await request('POST', '/gifts', {
              toUserId: creatorId,
              giftId: giftObj.id,
              postId: a.videoId,
            });
            local({
              type: 'serverSync',
              patch: {
                coins: res.coinsRemaining,
              },
            });
            refreshLedger();
          } catch (e) {
            fail(e, e.message || 'Could not send gift');
          }
        });
        return;
      }
      case 'buyCoins': {
        local({ type: 'serverSync', patch: { coins: prev.coins } });
        setTimeout(() => toastRef.current.show('Coin purchases are coming soon — earn coins from games and ads', { icon: 'coin', duration: 3600 }), 60);
        return;
      }
      default:
    }
  }, []);

  useEffect(() => registerEffects(effects), [effects]);

  // ───────────── server-authoritative flows ─────────────
  /** Place a bid (server charges the bid fee). Throws ApiError (INSUFFICIENT_COINS / ALREADY_BID …). */
  const placeBid = useCallback(async (job, { cover, amount, timeline }) => {
    const r = await request('POST', `/jobs/${job.id}/bids`, { cover, amount, timeline });
    const s = getState();
    const bid = r.bid || {};
    local({
      type: 'serverSync',
      patch: {
        coins: r.coins,
        bids: { ...(s.bids || {}), [job.id]: { coins: bid.feeCoins || 0, time: bid.createdAt || new Date().toISOString() } },
        proposals: [mapBid({ ...bid, jobTitle: bid.jobTitle || job.title }, meRef.current), ...(s.proposals || []).filter((p) => p.jobId !== job.id)],
        jobs: (s.jobs || []).map((j) => (j.id === job.id ? { ...j, proposalsCount: (j.proposalsCount || 0) + 1, myBid: bid } : j)),
      },
    });
    refreshLedger();
    return r;
  }, []);

  /**
   * Credit a rewarded ad that just finished. Demo/dev servers accept a client claim; production waits
   * for AdMob's server-side verification and polls /me. → { supportAdsToday, jobAdCredits, coins, unlocked }
   */
  const creditAd = useCallback(async (purpose) => {
    const before = meRef.current || {};
    let out = null;
    if (before.adsClientClaim) {
      out = await request('POST', '/ads/claim', { purpose });
    } else {
      for (let i = 0; i < 3; i += 1) {
        await wait(1500);
        try {
          const m = await request('GET', '/me');
          const changed = purpose === 'support' ? m.supportAdsToday !== before.supportAdsToday : m.jobAdCredits !== before.jobAdCredits || m.coins !== before.coins;
          out = { supportAdsToday: m.supportAdsToday, jobAdCredits: m.jobAdCredits, coins: m.coins, unlocked: purpose === 'job' && m.coins > before.coins ? m.coins - before.coins : undefined };
          applyMe(m);
          if (changed) break;
        } catch (e) { /* retry */ }
      }
      if (!out) throw new Error('We couldn’t confirm that ad yet — it will show up shortly');
    }
    const m = { ...(meRef.current || {}), supportAdsToday: out.supportAdsToday, jobAdCredits: out.jobAdCredits, coins: out.coins };
    meRef.current = m;
    setMe(m);
    local({ type: 'serverSync', patch: { coins: out.coins, jobAdCredits: out.jobAdCredits, supportAds: { date: dayKey(new Date()), count: out.supportAdsToday || 0 } } });
    if (out.unlocked) refreshLedger();
    return out;
  }, []);

  const signOut = useCallback(async () => {
    Object.values(pendingDeletes.current).forEach(clearTimeout);
    pendingDeletes.current = {};
    setAdUserId(null);
    local({ type: 'signOut' });
    await api.signOut();
  }, [api.signOut]);

  const sendGift = useCallback(async ({ toUserId, giftId, postId, commentId }) => {
    const res = await request('POST', '/gifts', { toUserId, giftId, postId, ...(commentId ? { commentId } : {}) });
    local({
      type: 'serverSync',
      patch: {
        coins: res.coinsRemaining,
      },
    });
    refreshLedger();
    return res;
  }, []);

  const loadChatMessages = useCallback(async (conversationId, after) => {
    const url = after
      ? `/conversations/${conversationId}/messages?after=${encodeURIComponent(after)}`
      : `/conversations/${conversationId}/messages`;
    return request('GET', url);
  }, []);

  // ROUND 4: load a thread's newest page (+ pins and my role) into the store.
  const loadThread = useCallback(async (scope, conversationId) => {
    const res = await request('GET', `/conversations/${conversationId}/messages?limit=50`);
    const items = (res.items || []).slice().reverse();
    const pins = res.pins || [];
    const pinAt = new Map(pins.map((p) => [p.id, Date.parse(p.pinnedAt) || 0]));
    const withPins = items.map((m) => (pinAt.has(m.id) ? { ...m, pinnedAt: new Date(pinAt.get(m.id)).toISOString() } : m));
    local({ type: 'msgSet', scope, messages: withPins });
    return { myRole: res.myRole || 'member', pins, hasMore: !!res.hasMore };
  }, []);

  const markChatRead = useCallback(async (conversationId) => {
    try {
      await request('POST', `/conversations/${conversationId}/read`);
    } catch (e) {
      // non-critical
    }
  }, []);

  const state = getState();
  const value = useMemo(() => ({
    online: true,
    mode: api.mode,
    email: api.email,
    status,
    realtimeStatus,
    error,
    lastSyncedAt: (state.account && state.account.lastSyncedAt) || null,
    me,
    hasMore,
    loadingMore,
    refresh,
    loadMore,
    loadComments,
    placeBid,
    creditAd,
    sendGift,
    loadChatMessages,
    loadThread,
    markChatRead,
    signOut,
  }), [api.mode, api.email, status, realtimeStatus, error, me, hasMore, loadingMore, state.account && state.account.lastSyncedAt]);

  return <SyncCtx.Provider value={value}>{children}</SyncCtx.Provider>;
}
