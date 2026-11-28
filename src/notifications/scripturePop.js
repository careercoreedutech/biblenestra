// "Scripture pop-ups": local notifications that pop a scripture, a prayer or an encouragement on the phone at an
// interval the user chooses, skipping their quiet hours. Works offline once scheduled; the next ~2 days of pop-ups are
// planned on the device and topped up every time the app opens.
//
// Categories, in this order: Scriptures → Prayers → Encouragement. The chosen categories rotate in that order, one per slot.
// Access: the 'scripture_pop' unlock (server: GET /unlocks; spend 4 coins or watch 4 ads, 24 hours). The scheduler only
// plans slots that fall before the unlock expires, so pop-ups stop on their own when the unlock runs out, and nothing
// is planned at all while locked. useScripturePop() re-plans when the unlock changes, and once more at the expiry.
import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { getChapter, refLabel } from '../data/bible';
import { POP_VERSES, POP_PRAYERS, POP_ENCOURAGEMENTS } from './content';
import { useUnlocks } from '../api/unlocks';

export const supported = Platform.OS !== 'web';
export const UNLOCK_FEATURE = 'scripture_pop';
const PREFIX = 'scripture-pop-';
const CHANNEL = 'scripture-pop';
const MAX_PENDING = 40; // iOS allows 64 pending local notifications per app

export const FREQUENCIES = [
  { every: 30, label: 'Every 30 min' },
  { every: 60, label: 'Every hour' },
  { every: 120, label: 'Every 2 hours' },
  { every: 180, label: 'Every 3 hours' },
  { every: 360, label: 'Every 6 hours' },
  { every: 720, label: 'Twice a day' },
];

// The three categories, in the order they rotate.
export const CATEGORIES = [
  { id: 'verses', label: 'Scriptures' },
  { id: 'prayers', label: 'Prayers' },
  { id: 'encouragement', label: 'Encouragement' },
];

if (supported) {
  // Show pop-ups even while the app is open.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

/**
 * The categories in use, in CATEGORIES order. settings.categories is the list from the screen. Older settings only had
 * `content` ('both' | 'verses' | 'prayers'); 'both' now means all three.
 */
export function categoriesOf(settings) {
  let ids;
  if (settings && Array.isArray(settings.categories)) ids = settings.categories;
  else if (settings && settings.content === 'verses') ids = ['verses'];
  else if (settings && settings.content === 'prayers') ids = ['prayers'];
  else ids = CATEGORIES.map((c) => c.id);
  const out = CATEGORIES.map((c) => c.id).filter((id) => ids.includes(id));
  return out.length ? out : CATEGORIES.map((c) => c.id);
}

/** The category of the n-th pop-up (rotation in CATEGORIES order). */
export const kindForSlot = (cats, n) => cats[n % cats.length];

// Small deterministic PRNG so a given slot always gets the same content.
function pick(arr, seed) {
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  x = (x ^ (x >>> 13)) >>> 0; x = Math.imul(x, 0xc2b2ae35) >>> 0; x = (x ^ (x >>> 16)) >>> 0;
  return arr[x % arr.length];
}

// Prayers that name a time of day only go out at that time, in the phone's own time zone
// (Date#getHours is local). "this morning … tonight" counts as morning.
function partOfDay(hour) {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}
function prayerFits(text, part) {
  const t = text.toLowerCase();
  if (/this morning|first thought/.test(t)) return part === 'morning';
  if (/afternoon/.test(t)) return part === 'afternoon';
  if (/as evening|this evening/.test(t)) return part === 'evening';
  if (/tonight/.test(t)) return part === 'evening' || part === 'night';
  return true;
}
export function prayersFor(slotTime) {
  const part = partOfDay(new Date(slotTime).getHours());
  return POP_PRAYERS.filter((p) => prayerFits(p, part));
}

const kjvVerse = (bookId, ch, v) => ((getChapter('KJV', bookId, Number(ch)) || [])[Number(v) - 1] || '').trim();

/**
 * The pop-up for one slot. kind: 'verses' | 'prayers' | 'encouragement' (or a list: the category for this time of day).
 * Returns { kind, title, body, data, verseText?, ref? }. Tapping opens the verse (scriptures, encouragement) or the Prayer Wall.
 */
export function contentFor(slotTime, kind = 'verses') {
  const seed = Math.floor(slotTime / 60000);
  const k = Array.isArray(kind) ? kindForSlot(kind, Math.floor(slotTime / 60000)) : kind;
  if (k === 'prayers') {
    return { kind: 'prayers', title: '🙏 A moment of prayer', body: pick(prayersFor(slotTime), seed), data: { type: 'prayer' } };
  }
  if (k === 'encouragement') {
    const e = pick(POP_ENCOURAGEMENTS, seed);
    const [bookId, ch, v] = e.ref.split(':');
    return {
      kind: 'encouragement',
      title: `💛 Encouragement · ${refLabel(bookId, Number(ch), Number(v))}`,
      body: e.text,
      verseText: kjvVerse(bookId, ch, v),
      ref: e.ref,
      data: { type: 'verse', bookId, chapter: Number(ch), verse: Number(v), kind: 'encouragement' },
    };
  }
  // scriptures
  const ref = pick(POP_VERSES, seed);
  const [bookId, ch, v] = ref.split(':');
  const text = kjvVerse(bookId, ch, v);
  if (text) {
    return {
      kind: 'verses',
      title: `✦ ${refLabel(bookId, Number(ch), Number(v))}`,
      body: text,
      verseText: text,
      ref,
      data: { type: 'verse', bookId, chapter: Number(ch), verse: Number(v) },
    };
  }
  return { kind: 'prayers', title: '🙏 A moment of prayer', body: pick(prayersFor(slotTime), seed), data: { type: 'prayer' } };
}

function inQuiet(date, from, to) {
  const h = date.getHours() + date.getMinutes() / 60;
  if (from === to) return false;
  return from < to ? h >= from && h < to : h >= from || h < to; // wraps past midnight
}

// Upcoming pop-up times from now, skipping quiet hours
export function upcomingSlots(settings, count = MAX_PENDING, now = Date.now()) {
  const step = Math.max(15, settings.every || 180) * 60000;
  const out = [];
  let t = Math.ceil((now + 60000) / step) * step; // align to the interval grid
  let guard = 0;
  while (out.length < count && guard < 2000) {
    guard += 1;
    const d = new Date(t);
    if (!inQuiet(d, settings.quietFrom, settings.quietTo)) out.push(t);
    t += step;
  }
  return out;
}

export async function ensurePermission() {
  if (!supported) return false;
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted || cur.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return true;
  const req = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true } });
  return !!req.granted;
}

async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: 'Scripture pop-ups',
    description: 'Scriptures, prayers and encouragement at the interval you choose',
    importance: Notifications.AndroidImportance.HIGH, // heads-up "pop" on screen
    vibrationPattern: [0, 120],
    lightColor: '#C9A45C',
  });
}

export async function cancelAll() {
  if (!supported) return;
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(pending.filter((n) => String(n.identifier).startsWith(PREFIX)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
}

/**
 * The slots that will be planned: upcoming times that are before `until` (the unlock's expiry, ms). Locked or expired
 * (until <= now) → none. Exported so the screen shows exactly what the scheduler will do.
 */
export function plannedSlots(settings, until = Infinity, now = Date.now()) {
  if (!settings || !settings.enabled) return [];
  if (!(until > now)) return [];
  return upcomingSlots(settings, MAX_PENDING, now).filter((t) => t < until);
}

// Replace every pending pop-up with a fresh schedule. until = unlock expiry (ms), 0/undefined = locked → nothing is planned.
// Returns the number scheduled.
export async function reschedule(settings, { until = 0 } = {}) {
  if (!supported) return 0;
  await cancelAll();
  if (!settings || !settings.enabled) return 0;
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) return 0;
  const slots = plannedSlots(settings, until);
  if (!slots.length) return 0;
  await ensureChannel();
  const cats = categoriesOf(settings);
  for (let i = 0; i < slots.length; i += 1) {
    const t = slots[i];
    const c = contentFor(t, kindForSlot(cats, i));
    // eslint-disable-next-line no-await-in-loop
    await Notifications.scheduleNotificationAsync({
      identifier: `${PREFIX}${t}`,
      content: { title: c.title, body: c.body, data: c.data, sound: false },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(t), channelId: CHANNEL },
    });
  }
  return slots.length;
}

export async function sendTest(settings) {
  if (!supported) return false;
  if (!(await ensurePermission())) return false;
  await ensureChannel();
  const c = contentFor(Date.now(), categoriesOf(settings)[0]);
  await Notifications.scheduleNotificationAsync({
    identifier: `${PREFIX}test-${Date.now()}`,
    content: { title: c.title, body: c.body, data: c.data },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 3, channelId: CHANNEL },
  });
  return true;
}

/** The scripture_pop unlock from GET /unlocks: { known, until (ms, 0 when locked) }. */
export function useScriptureUnlock() {
  const { data, reload, loaded } = useUnlocks();
  const f = data && data.catalogue ? data.catalogue[UNLOCK_FEATURE] : null;
  const until = f && f.unlocked && f.until ? new Date(f.until).getTime() : 0;
  return { known: !!f, loaded, until, unlocked: until > Date.now(), reload, entry: f };
}

// Mounted once at the app root: keeps the schedule topped up, follows the unlock, and opens the verse when a pop-up is tapped.
export function useScripturePop(settings, nav) {
  const { known, until, reload } = useScriptureUnlock();
  const sig = settings ? `${settings.enabled}|${settings.every}|${settings.quietFrom}|${settings.quietTo}|${settings.content}|${(settings.categories || []).join(',')}` : '';

  useEffect(() => {
    if (!supported) return;
    // the first unlock answer may not be in yet (offline or loading): keep whatever is already scheduled
    if (settings && !known) return;
    reschedule(settings, { until }).catch(() => {});
  }, [sig, until, known]);

  // the unlock runs out while the app is open: plan again (locked → cancelled) and refresh the screen's state
  useEffect(() => {
    if (!until) return undefined;
    const ms = Math.min(until - Date.now() + 1500, 2147483000);
    const t = setTimeout(() => { reload(); }, Math.max(1000, ms));
    return () => clearTimeout(t);
  }, [until]);

  useEffect(() => {
    if (!supported || !nav) return undefined;
    const open = (resp) => {
      const d = resp && resp.notification && resp.notification.request.content.data;
      if (!d) return;
      if (d.type === 'verse') nav.push('Bible', { bookId: d.bookId, chapter: d.chapter, verse: d.verse });
      else if (d.type === 'prayer') nav.push('PrayerWall');
    };
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    Notifications.getLastNotificationResponseAsync().then(open).catch(() => {});
    return () => sub.remove();
  }, [!!nav]);
}
