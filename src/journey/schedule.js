// MY SCRIPTURE JOURNEY: smart Scripture notifications.
// The chosen books are cut into portions sized from the daily target and delivered at the user's times. Rules:
//  - a rolling plan for the next 3 days, topped up whenever the app opens or the goal changes;
//  - at most goal.notifyPerDay per day, and never more than 6 (the server's cap);
//  - quiet hours are the ones the scripture pop-up uses (state.scripturePop quietFrom / quietTo);
//  - a slot that lands on another pending notification's minute moves 7 minutes later;
//  - delivery mode: 'reading' schedules nothing, 'notifications' and 'both' schedule.
// Each portion is stored with its state: scheduled, then delivered (its time has passed while the app runs), then read
// (a verse of it was counted by the reader, or the user marked it read). Delivered and read are counted separately.
// The tap opens the passage through the scripture pop-up's listener (data.type 'verse'), which routes to the reader.
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BOOKS, getChapter, refLabel } from '../data/bible';
import { resolveTranslationId } from '../bible/catalog';
import { ensurePermission, plannedSlots, supported as popSupported } from '../notifications/scripturePop';
import { subscribeCounted, newId } from './tracker';

const supported = popSupported && Platform.OS !== 'web';
const PORTIONS_KEY = 'journey.portions.v1';
const PREFIX = 'journey-';
const CHANNEL = 'journey-scripture';
const DAYS_AHEAD = 3;
const HARD_CAP = 6;
const DEFAULT_TIMES = ['08:00', '13:00', '19:00'];
const SHIFT_MS = 7 * 60000;

async function readList(key) { try { const r = await AsyncStorage.getItem(key); return r ? JSON.parse(r) : []; } catch (e) { return []; } }
async function writeList(key, v) { try { await AsyncStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* ignore */ } }

/** The verse list for the goal's scope, in Bible order: [{ bookId, chapter, verses }] for every chapter that has text. */
export function scopeChapters(books, translation) {
  const want = books && books.length ? new Set(books) : null;
  const out = [];
  for (const b of BOOKS) {
    if (want && !want.has(b.id)) continue;
    for (let ch = 1; ch <= b.chapters; ch += 1) {
      const verses = getChapter(translation, b.id, ch);
      if (verses && verses.length) out.push({ bookId: b.id, chapter: ch, count: verses.length });
    }
  }
  return out;
}

/** Splits the scope into consecutive chunks of `size` verses, never crossing a chapter. */
export function chunksFrom(chapters, startIndex, startVerse, size, max) {
  const out = [];
  let i = startIndex; let v = startVerse;
  while (i < chapters.length && out.length < max) {
    const c = chapters[i];
    if (v > c.count) { i += 1; v = 1; continue; }
    const end = Math.min(c.count, v + size - 1);
    out.push({ bookId: c.bookId, chapter: c.chapter, verse: v, verseEnd: end, index: i });
    v = end + 1;
    if (v > c.count) { i += 1; v = 1; }
  }
  return { chunks: out, next: { index: i, verse: v } };
}

/** The times the goal delivers at, in local time, for the next days: [{ at (ms), slot }]. */
export function slotTimes(goal, quiet, now = Date.now()) {
  const perDay = Math.min(HARD_CAP, goal.notifyPerDay === undefined ? 3 : goal.notifyPerDay);
  if (perDay <= 0) return [];
  const times = (goal.notifyTimes && goal.notifyTimes.length ? goal.notifyTimes : DEFAULT_TIMES).slice().sort().slice(0, perDay);
  const out = [];
  const base = new Date(now);
  for (let d = 0; d < DAYS_AHEAD; d += 1) {
    for (const t of times) {
      const [hh, mm] = t.split(':').map(Number);
      const when = new Date(base.getFullYear(), base.getMonth(), base.getDate() + d, hh, mm, 0, 0).getTime();
      if (when <= now + 60000) continue;
      if (inQuiet(when, quiet)) continue;
      out.push({ at: when, slot: t });
    }
  }
  return out;
}

function inQuiet(ms, quiet) {
  if (!quiet || quiet.quietFrom === undefined || quiet.quietTo === undefined) return false;
  const date = new Date(ms);
  const h = date.getHours() + date.getMinutes() / 60;
  const { quietFrom: from, quietTo: to } = quiet;
  if (from === to) return false;
  return from < to ? h >= from && h < to : h >= from || h < to;
}

const minuteKey = (ms) => Math.floor(ms / 60000);

/** Moves a time 7 minutes later while another notification already sits on the same minute. */
export function avoidCollisions(at, taken, quiet) {
  let t = at;
  for (let i = 0; i < 4 && taken.has(minuteKey(t)); i += 1) t += SHIFT_MS;
  if (inQuiet(t, quiet)) return null;
  return t;
}

function excerptFor(translation, bookId, chapter, verse, verseEnd) {
  const tr = resolveTranslationId(translation || 'KJV');
  const arr = getChapter(tr, bookId, chapter) || [];
  const text = arr.slice(verse - 1, verseEnd).map((t) => String(t).trim()).join(' ');
  return text.length > 150 ? `${text.slice(0, 147).trim()}…` : text;
}

/**
 * Plans and schedules the rolling notifications. goal: the server's goal view. quiet: { quietFrom, quietTo } from the
 * scripture pop-up settings. Returns the number of notifications scheduled.
 */
export async function reschedule(goal, quiet, now = Date.now()) {
  if (!supported || !goal || !goal.set) return 0;
  const portions = await readList(PORTIONS_KEY);
  const key = JSON.stringify([goal.books, goal.translation]);
  const current = portions.filter((p) => p.scopeKey === key);
  // delivered: planned and already past (the app was running or opened after the time)
  for (const p of current) if (p.status === 'scheduled' && p.at <= now) p.status = 'delivered';

  // cancel our previous schedule, then plan again
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(pending.filter((n) => String(n.identifier).startsWith(PREFIX)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
  if (goal.delivery === 'reading') { await writeList(PORTIONS_KEY, portions); return 0; }
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) { await writeList(PORTIONS_KEY, portions); return 0; }

  const taken = new Set();
  for (const n of pending) {
    const t = n.trigger && (n.trigger.date || n.trigger.value);
    if (!String(n.identifier).startsWith(PREFIX) && t) taken.add(minuteKey(typeof t === 'number' ? t : new Date(t).getTime()));
  }
  // scripture pop-up slots are another channel: do not stack on them either
  const pops = popSettingsOf(quiet);
  if (pops) for (const t of plannedSlots(pops, Infinity, now)) taken.add(minuteKey(t));

  const perDay = Math.min(HARD_CAP, goal.notifyPerDay === undefined ? 3 : goal.notifyPerDay);
  const slots = slotTimes({ ...goal, notifyPerDay: perDay }, quiet, now);
  const chapters = scopeChapters(goal.books, goal.translation);
  const dailyTarget = goal.dailyTarget > 0 ? goal.dailyTarget : 0;
  const perSlot = dailyTarget ? Math.max(1, Math.ceil(dailyTarget / Math.max(1, perDay))) : 10;

  // continue after the last portion already planned for this scope
  const last = current.reduce((acc, p) => (p.index !== undefined && (acc === null || p.index > acc.index || (p.index === acc.index && p.verseEnd > acc.verseEnd)) ? p : acc), null);
  let cursor = last ? { index: last.index, verse: last.verseEnd + 1 } : { index: 0, verse: 1 };
  // portions planned earlier but not yet due keep their times; the cursor moved past them already
  const keep = current.filter((p) => p.status !== 'read');
  const future = keep.filter((p) => p.at > now);
  const used = new Set(future.map((p) => p.at));

  let count = 0;
  const plan = [];
  for (const s of slots) {
    if (used.has(s.at)) continue;
    const { chunks, next } = chunksFrom(chapters, cursor.index, cursor.verse, perSlot, 1);
    if (!chunks.length) break;
    const at = avoidCollisions(s.at, taken, quiet);
    if (at === null) continue;
    taken.add(minuteKey(at));
    const c = chunks[0];
    cursor = next;
    plan.push({ id: newId('p'), at, scopeKey: key, bookId: c.bookId, chapter: c.chapter, verse: c.verse, verseEnd: c.verseEnd, index: c.index, status: 'scheduled', translation: goal.translation || 'KJV' });
  }
  const all = [...portions.filter((p) => p.scopeKey !== key), ...current.filter((p) => p.status === 'read' || p.status === 'delivered'), ...future, ...plan];
  await writeList(PORTIONS_KEY, all.slice(-400));

  await ensureChannel();
  for (const p of [...future, ...plan]) {
    if (p.at <= now) continue;
    const excerpt = excerptFor(p.translation, p.bookId, p.chapter, p.verse, p.verseEnd);
    const ref = p.verseEnd > p.verse ? `${refLabel(p.bookId, p.chapter, p.verse)}-${p.verseEnd}` : refLabel(p.bookId, p.chapter, p.verse);
    // eslint-disable-next-line no-await-in-loop
    await Notifications.scheduleNotificationAsync({
      identifier: `${PREFIX}${p.id}`,
      content: {
        title: `✦ ${ref}`,
        body: excerpt || 'Your reading portion for today is ready.',
        data: { type: 'verse', bookId: p.bookId, chapter: p.chapter, verse: p.verse, kind: 'journey', portion: p.id },
        sound: false,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(p.at), channelId: CHANNEL },
    });
    count += 1;
  }
  return count;
}

function popSettingsOf(quiet) {
  if (!quiet || !quiet.enabled) return null;
  return quiet;
}

async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: 'Scripture reading plan',
    description: 'Your daily reading portions, at the times you chose',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 120],
    lightColor: '#C9A45C',
  });
}

/** Marks scheduled portions read when the reader counts a verse inside them. */
export async function markReadFromReader({ bookId, chapter, verse }) {
  const portions = await readList(PORTIONS_KEY);
  let changed = false;
  for (const p of portions) {
    if (p.status === 'read' || p.bookId !== bookId || p.chapter !== chapter) continue;
    if (verse >= p.verse && verse <= p.verseEnd) { p.status = 'read'; changed = true; }
  }
  if (changed) await writeList(PORTIONS_KEY, portions);
}

/** Marks one portion as read (the "I read it" button). */
export async function markPortionRead(id) {
  const portions = await readList(PORTIONS_KEY);
  for (const p of portions) if (p.id === id) p.status = 'read';
  await writeList(PORTIONS_KEY, portions);
}

/** Counts for the dashboard: { scheduled, delivered, read, upcoming: [...] }. */
export async function portionSummary(now = Date.now()) {
  const portions = await readList(PORTIONS_KEY);
  for (const p of portions) if (p.status === 'scheduled' && p.at <= now) p.status = 'delivered';
  const upcoming = portions.filter((p) => p.status === 'scheduled' && p.at > now).sort((a, b) => a.at - b.at).slice(0, 6);
  return {
    scheduled: upcoming.length,
    delivered: portions.filter((p) => p.status === 'delivered').length,
    read: portions.filter((p) => p.status === 'read').length,
    upcoming,
    recent: portions.filter((p) => p.status !== 'scheduled').sort((a, b) => b.at - a.at).slice(0, 8),
  };
}

// Mounted once at the app root: keeps the rolling plan fresh and records reading from the reader.
export function useJourneyNotifications(goal, quiet) {
  const sig = goal && goal.set ? JSON.stringify([goal.books, goal.translation, goal.dailyTarget, goal.delivery, goal.notifyTimes, goal.notifyPerDay, quiet && [quiet.quietFrom, quiet.quietTo, quiet.enabled]]) : '';
  useEffect(() => {
    if (!supported || !goal || !goal.set) return;
    reschedule(goal, quiet).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  useEffect(() => {
    if (!supported) return undefined;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && goal && goal.set) reschedule(goal, quiet).catch(() => {});
    });
    const unsub = subscribeCounted((info) => { markReadFromReader(info).catch(() => {}); });
    return () => { sub.remove(); unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  useEffect(() => { if (supported) ensurePermission().catch(() => {}); }, []);
}
