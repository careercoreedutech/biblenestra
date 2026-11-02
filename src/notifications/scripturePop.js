// "Scripture pop-ups": local notifications that pop a verse or a prayer on the phone at an interval
// the user chooses, skipping their quiet hours. Works offline (no server needed); the next ~2 days of
// pop-ups are scheduled on the device and topped up every time the app opens.
import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { getChapter, refLabel } from '../data/bible';
import { POP_VERSES, POP_PRAYERS } from './content';

export const supported = Platform.OS !== 'web';
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

if (supported) {
  // Show pop-ups even while the app is open.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

// Small deterministic PRNG so a given slot always gets the same content.
function pick(arr, seed) {
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  x = (x ^ (x >>> 13)) >>> 0; x = Math.imul(x, 0xc2b2ae35) >>> 0; x = (x ^ (x >>> 16)) >>> 0;
  return arr[x % arr.length];
}

export function contentFor(slotTime, kind) {
  const seed = Math.floor(slotTime / 60000);
  const useVerse = kind === 'verses' || (kind === 'both' && pick([true, true, false], seed + 7)); // both → ~2 verses : 1 prayer
  if (useVerse) {
    const ref = pick(POP_VERSES, seed);
    const [bookId, ch, v] = ref.split(':');
    const text = ((getChapter('KJV', bookId, Number(ch)) || [])[Number(v) - 1] || '').trim();
    if (text) {
      return {
        title: `✦ ${refLabel(bookId, Number(ch), Number(v))}`,
        body: text,
        data: { type: 'verse', bookId, chapter: Number(ch), verse: Number(v) },
      };
    }
  }
  return { title: '🙏 A moment of prayer', body: pick(POP_PRAYERS, seed), data: { type: 'prayer' } };
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
    description: 'Verses and prayers at the interval you choose',
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

// Replace every pending pop-up with a fresh schedule. Returns the number scheduled.
export async function reschedule(settings) {
  if (!supported) return 0;
  await cancelAll();
  if (!settings || !settings.enabled) return 0;
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) return 0;
  await ensureChannel();
  const slots = upcomingSlots(settings);
  for (const t of slots) {
    const c = contentFor(t, settings.content || 'both');
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
  const c = contentFor(Date.now(), (settings && settings.content) || 'both');
  await Notifications.scheduleNotificationAsync({
    identifier: `${PREFIX}test-${Date.now()}`,
    content: { title: c.title, body: c.body, data: c.data },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 3, channelId: CHANNEL },
  });
  return true;
}

// Mounted once at the app root: keeps the schedule topped up and opens the verse when a pop-up is tapped.
export function useScripturePop(settings, nav) {
  const sig = settings ? `${settings.enabled}|${settings.every}|${settings.quietFrom}|${settings.quietTo}|${settings.content}` : '';
  useEffect(() => {
    if (!supported) return;
    reschedule(settings).catch(() => {});
  }, [sig]);

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
