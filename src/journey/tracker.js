// MY SCRIPTURE JOURNEY: the on-device tracker.
//   useJourneyReader({ translation, bookId, chapter })   the Bible reader calls onScroll(...) and narrated(n)
//   enqueueManual({ ... })                               a physical-Bible entry (book, chapter, verses, date)
//   useJourneyFlush()                                    sends the queue when the app opens and when online
//   localTodayVerses()                                   offline total for today (device time)
//   subscribeCounted(fn), subscribeAwarded(fn)           reading events and achievements for the UI
//
// Rules for a verse to count as read:
//  - it stayed on screen for MIN_DWELL_MS (a verse that scrolled past faster is not counted), or
//  - the reader reached the end of the chapter at a normal pace (at least PACE_MS_PER_VERSE per verse on average), or
//  - it is being read aloud (narration counts; the verse counts when the narrator reaches it).
// Each verse counts once per visit to a chapter; a later visit counts it again (a re-read raises the daily total).
// Events are queued in AsyncStorage with a client id and sent in batches. The server dedupes them.
import { useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { syncJourneyEvents, journeyChanged } from '../api/journey';

const QUEUE_KEY = 'journey.queue.v1';
const LOCAL_KEY = 'journey.local.v1';
export const MIN_DWELL_MS = 1200; // a verse must be on screen this long
export const FAST_PX_PER_MS = 1.5; // faster scrolling is a fling, not reading
export const PACE_MS_PER_VERSE = 900; // the end-of-chapter rule: a whole chapter faster than this per verse does not count
const MAX_QUEUE = 5000;
const RUN_DELAY_MS = 2500; // merge verses read close together into one event

let chain = Promise.resolve();
function serial(fn) { chain = chain.then(fn, fn); return chain; }
async function readJson(key, fallback) {
  try { const raw = await AsyncStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; }
}
async function writeJson(key, value) {
  try { await AsyncStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full or unavailable: keep going */ }
}

export function newId(prefix = 'e') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
export function localDayKey(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

// ───────── listeners ─────────
const countedSubs = new Set();
const awardedSubs = new Set();
/** fn({ bookId, chapter, verse, source }) for every verse counted. Returns an unsubscribe. */
export function subscribeCounted(fn) { countedSubs.add(fn); return () => countedSubs.delete(fn); }
/** fn(achievements[]) when the server awards something during a sync. Returns an unsubscribe. */
export function subscribeAwarded(fn) { awardedSubs.add(fn); return () => awardedSubs.delete(fn); }
function emitCounted(info) { countedSubs.forEach((f) => { try { f(info); } catch (e) { /* ignore */ } }); }
function emitAwarded(list) { if (list.length) awardedSubs.forEach((f) => { try { f(list); } catch (e) { /* ignore */ } }); }

// ───────── queue ─────────
/** Adds events to the queue (duplicates by clientId are ignored) and updates the offline day total. */
export function enqueue(events) {
  if (!events.length) return Promise.resolve(0);
  return serial(async () => {
    const q = await readJson(QUEUE_KEY, []);
    const known = new Set(q.map((e) => e.clientId));
    const add = events.filter((e) => !known.has(e.clientId));
    await writeJson(QUEUE_KEY, [...q, ...add].slice(-MAX_QUEUE));
    const local = await readJson(LOCAL_KEY, { days: {} });
    for (const e of add) {
      const k = localDayKey(new Date(e.readAt));
      local.days[k] = (local.days[k] || 0) + e.verseCount;
    }
    const keys = Object.keys(local.days).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - 400))) delete local.days[k];
    await writeJson(LOCAL_KEY, local);
    return add.length;
  });
}

/** Sends the queue. Accepted, duplicate and rejected events leave the queue; a network failure keeps them. */
export function flushJourney(api) {
  return serial(async () => {
    if (!api || !api.online) return 0;
    let sent = 0;
    for (;;) {
      const q = await readJson(QUEUE_KEY, []);
      if (!q.length) break;
      const batch = q.slice(0, 200);
      try {
        const out = await syncJourneyEvents(api, batch);
        emitAwarded(out.awarded || []);
      } catch (e) {
        // 400 means the batch itself is invalid: drop it so it cannot block the queue; anything else waits for the next try
        if (!(e && e.status === 400)) break;
      }
      const done = new Set(batch.map((b) => b.clientId));
      const rest = (await readJson(QUEUE_KEY, [])).filter((x) => !done.has(x.clientId));
      await writeJson(QUEUE_KEY, rest);
      sent += batch.length;
      if (batch.length < 200) break;
    }
    if (sent) journeyChanged();
    return sent;
  });
}

export async function pendingCount() { return (await readJson(QUEUE_KEY, [])).length; }
export async function localTodayVerses() {
  const local = await readJson(LOCAL_KEY, { days: {} });
  return local.days[localDayKey()] || 0;
}

/** A physical-Bible entry: book, chapter, verse range and the date read (device time). */
export function enqueueManual({ translation = 'KJV', bookId, chapter, verseStart, verseEnd, date }) {
  const vs = Number(verseStart);
  const ve = Number(verseEnd ?? verseStart);
  const readAt = new Date(`${date}T12:00:00`).toISOString();
  const ev = {
    clientId: `m${newId('')}`.slice(0, 80),
    source: 'manual', bookId, chapter: Number(chapter), verseStart: vs, verseEnd: ve, verseCount: ve - vs + 1, translation, readAt,
  };
  return enqueue([ev]);
}

// ───────── reader session (one visit to one chapter) ─────────
function makeSession({ translation, bookId, chapter }) {
  const sid = newId('').slice(0, 20);
  const counted = new Set();
  const pending = new Map(); // verse → first time it was seen on screen
  const runs = { reader: new Map(), narration: new Map() }; // verse → time counted, not yet sent
  const openedAt = Date.now();
  let lastY = null; let lastT = 0; let fastUntil = 0; let ended = false;
  let checkTimer = null; let runTimer = null; let disposed = false;

  function emitRuns() {
    for (const source of Object.keys(runs)) {
      const m = runs[source];
      if (!m.size) continue;
      const times = new Map(m);
      const nums = [...times.keys()].sort((a, b) => a - b);
      m.clear();
      let i = 0;
      while (i < nums.length) {
        let j = i;
        while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j += 1;
        const vs = nums[i]; const ve = nums[j];
        enqueue([{
          clientId: `r${sid}${source === 'narration' ? 'n' : 'r'}${vs}x${ve}`,
          source, bookId, chapter, verseStart: vs, verseEnd: ve, verseCount: ve - vs + 1, translation,
          readAt: new Date(times.get(vs)).toISOString(),
        }]).then(() => flushSoon());
        i = j + 1;
      }
    }
  }
  function scheduleRuns() {
    clearTimeout(runTimer);
    runTimer = setTimeout(emitRuns, RUN_DELAY_MS);
  }
  function count(n, source) {
    if (disposed || counted.has(n) || n < 1) return;
    counted.add(n);
    pending.delete(n);
    runs[source].set(n, Date.now());
    scheduleRuns();
    emitCounted({ bookId, chapter, verse: n, source });
  }
  function check() {
    checkTimer = null;
    const now = Date.now();
    for (const [n, t] of [...pending.entries()]) if (now - t >= MIN_DWELL_MS) count(n, 'reader');
    if (pending.size) checkTimer = setTimeout(check, MIN_DWELL_MS);
  }

  return {
    scroll({ y, height, verseY, verseCount, atEnd }) {
      if (disposed) return;
      const now = Date.now();
      const dt = lastT ? now - lastT : 0;
      const dy = lastY === null ? 0 : y - lastY;
      lastY = y; lastT = now;
      const speed = dt > 0 ? Math.abs(dy) / dt : 0;
      if (speed > FAST_PX_PER_MS) fastUntil = now + 800;
      const top = y - 6; const bottom = y + height * 0.92;
      const visible = new Set();
      for (let n = 1; n <= verseCount; n += 1) {
        const t = verseY[n];
        if (t !== undefined && t >= top && t <= bottom) visible.add(n);
      }
      for (const n of [...pending.keys()]) if (!visible.has(n)) pending.delete(n);
      if (now < fastUntil) {
        for (const n of visible) pending.delete(n);
      } else {
        for (const n of visible) if (!counted.has(n) && !pending.has(n)) pending.set(n, now);
      }
      if (pending.size && !checkTimer) checkTimer = setTimeout(check, MIN_DWELL_MS); // armed once; scrolling does not postpone it
      if (atEnd && !ended && now >= fastUntil) {
        const elapsed = now - openedAt;
        if (elapsed >= verseCount * PACE_MS_PER_VERSE) {
          ended = true;
          for (let n = 1; n <= verseCount; n += 1) count(n, 'reader');
        }
      }
    },
    narrate(n) { if (!disposed) count(n, 'narration'); },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(checkTimer); clearTimeout(runTimer);
      pending.clear();
      emitRuns();
    },
  };
}

/**
 * The Bible reader's hook. Start a session for each chapter; onScroll gets the scroll event, the verse layout map
 * (verse number → y) and the verse count; narrated(n) is called when the narrator reaches verse n.
 */
export function useJourneyReader({ translation, bookId, chapter }) {
  const sessionRef = useRef(null);
  useEffect(() => {
    if (!bookId || !chapter) return undefined;
    sessionRef.current = makeSession({ translation: translation || 'KJV', bookId, chapter });
    return () => { if (sessionRef.current) sessionRef.current.dispose(); sessionRef.current = null; };
  }, [translation, bookId, chapter]);
  return useMemo(() => ({
    onScroll(nativeEvent, verseY, verseCount) {
      const s = sessionRef.current;
      if (!s || !nativeEvent || !verseCount) return;
      const { contentOffset, layoutMeasurement, contentSize } = nativeEvent;
      const y = contentOffset ? contentOffset.y : 0;
      const height = layoutMeasurement ? layoutMeasurement.height : 0;
      const atEnd = !!contentSize && y + height >= contentSize.height - 48;
      s.scroll({ y, height, verseY: verseY || {}, verseCount, atEnd });
    },
    narrated(n) { const s = sessionRef.current; if (s && n) s.narrate(n); },
  }), []);
}

// ───────── sending ─────────
let flushTimer = null;
let currentApi = null;
/** Debounced flush: waits a few seconds so a reading session is sent in one batch. */
export function flushSoon() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { if (currentApi) flushJourney(currentApi).catch(() => {}); }, 4000);
}

/** Mounted once at the app root: sends the queue when the app opens, returns to the foreground, or comes online. */
export function useJourneyFlush(api) {
  useEffect(() => {
    currentApi = api;
    if (api && api.online) flushJourney(api).catch(() => {});
    return undefined;
  }, [api && api.online, api]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && currentApi) flushJourney(currentApi).catch(() => {});
    });
    return () => sub.remove();
  }, []);
}
