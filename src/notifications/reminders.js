// Reminders + Daily Bible Verse — LOCAL notifications scheduled on the phone with expo-notifications
// (no Firebase, works offline). Online mode also keeps a copy on the server (GET/PUT/DELETE /me/reminders)
// so reminders come back on a new phone; scheduling always happens on the device.
//
// Store: state.reminders = [{ id, purpose, kind, hour, minute, repeat, days, date, target, passage, enabled, updatedAt, dirty? }]
//        state.dailyVerse = { enabled, hour, minute }
//        state.reminderTombstones = [id] (deleted while offline, removed from the server on the next sync)
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { getChapter, refLabel, verseOfDay } from '../data/bible';
import { useStore } from '../store';
import { useApi } from '../api/auth';

export const supported = Platform.OS !== 'web';
const PREFIX = 'reminder-';
const VERSE_PREFIX = 'daily-verse-';
const CHANNEL = 'reminders';
const VERSE_DAYS = 14;
export const DEFAULT_VERSE = { enabled: false, hour: 6, minute: 0 };

export const KINDS = [
  { kind: 'bible', label: 'Read the Bible', icon: 'book', target: 'Bible' },
  { kind: 'pray', label: 'Pray', icon: 'prayer', target: 'PrayerWall' },
  { kind: 'call', label: 'Call someone', icon: 'users', target: 'Today' },
  { kind: 'study', label: 'Study a Bible chapter', icon: 'bookmark', target: 'Bible' },
  { kind: 'other', label: 'Something else', icon: 'sparkles', target: 'Today' },
];
export const TARGETS = [
  { id: 'Bible', label: 'Bible' },
  { id: 'PrayerWall', label: 'Prayer' },
  { id: 'Today', label: 'Today' },
];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const fmtTime = (h, m) => {
  const ap = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, '0')} ${ap}`;
};
export const dateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromKey = (k, h = 0, m = 0) => { const [y, mo, d] = k.split('-').map(Number); return new Date(y, mo - 1, d, h, m, 0, 0); };

export function repeatLabel(r) {
  if (r.repeat === 'once') {
    if (!r.date) return 'Once';
    const d = fromKey(r.date);
    const today = new Date(); const tmr = new Date(); tmr.setDate(today.getDate() + 1);
    if (dateKey(d) === dateKey(today)) return 'Today only';
    if (dateKey(d) === dateKey(tmr)) return 'Tomorrow only';
    return `Once · ${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}`;
  }
  if (r.repeat === 'weekdays') return 'Weekdays';
  if (r.repeat === 'days') {
    const ds = [...(r.days || [])].sort();
    if (ds.length === 7) return 'Every day';
    if (ds.join() === '0,6') return 'Weekends';
    return ds.map((d) => DAY_SHORT[d]).join(' · ');
  }
  return 'Every day';
}

/** Next time this reminder fires (ms) or null */
export function nextFire(r, now = Date.now()) {
  if (!r.enabled) return null;
  if (r.repeat === 'once') {
    if (!r.date) return null;
    const t = fromKey(r.date, r.hour, r.minute).getTime();
    return t > now ? t : null;
  }
  const days = r.repeat === 'weekdays' ? [1, 2, 3, 4, 5] : r.repeat === 'days' ? r.days || [] : [0, 1, 2, 3, 4, 5, 6];
  for (let i = 0; i < 8; i++) {
    const d = new Date(now); d.setDate(d.getDate() + i); d.setHours(r.hour, r.minute, 0, 0);
    if (d.getTime() > now && days.includes(d.getDay())) return d.getTime();
  }
  return null;
}

export function whenLabel(t) {
  if (!t) return '';
  const d = new Date(t); const n = new Date(); const tmr = new Date(); tmr.setDate(n.getDate() + 1);
  const day = dateKey(d) === dateKey(n) ? 'Today' : dateKey(d) === dateKey(tmr) ? 'Tomorrow' : d.toLocaleDateString([], { weekday: 'long' });
  return `${day} · ${fmtTime(d.getHours(), d.getMinutes())}`;
}

export function reminderContent(r) {
  const passage = r.passage && r.passage.bookId ? refLabel(r.passage.bookId, r.passage.chapter) : null;
  const icon = { bible: '📖', pray: '🙏', call: '📞', study: '✦', other: '⏰' }[r.kind] || '⏰';
  const body = {
    bible: 'Time to open your Bible. Tap to continue reading.',
    pray: 'Take a quiet moment with God. Tap to open the prayer wall.',
    call: 'You asked to be reminded. A short call can mean a lot.',
    study: passage ? `Tap to open ${passage}.` : 'Tap to open your Bible study.',
    other: 'Your BibleNestra reminder.',
  }[r.kind] || 'Your BibleNestra reminder.';
  return { title: `${icon} ${r.purpose}`, body, data: { type: 'reminder', id: r.id, target: r.target || 'Today', passage: r.passage || null } };
}

export function verseFor(date, translation = 'KJV') {
  const v = verseOfDay(date);
  const text = ((getChapter(translation, v.bookId, v.chapter) || [])[v.verse - 1] || '').trim();
  return { ...v, text, label: refLabel(v.bookId, v.chapter, v.verse) };
}
export function verseContent(date, translation) {
  const v = verseFor(date, translation);
  return { title: `✦ Verse of the day · ${v.label}`, body: v.text || v.reflection, data: { type: 'dailyVerse', bookId: v.bookId, chapter: v.chapter, verse: v.verse } };
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
    name: 'Reminders & daily verse',
    description: 'Your reminders and the daily Bible verse at the time you choose',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 160, 80, 160],
    lightColor: '#C9A45C',
  });
}

async function cancelPrefix(prefix) {
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(pending.filter((n) => String(n.identifier).startsWith(prefix)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
}

function triggersFor(r) {
  const base = { channelId: CHANNEL };
  const T = Notifications.SchedulableTriggerInputTypes;
  if (r.repeat === 'once') {
    const t = nextFire(r);
    return t ? [{ ...base, type: T.DATE, date: new Date(t) }] : [];
  }
  if (r.repeat === 'daily') return [{ ...base, type: T.DAILY, hour: r.hour, minute: r.minute }];
  const days = r.repeat === 'weekdays' ? [1, 2, 3, 4, 5] : r.days || [];
  return days.map((d) => ({ ...base, type: T.WEEKLY, weekday: d + 1, hour: r.hour, minute: r.minute })); // expo: 1 = Sunday
}

export async function rescheduleReminders(list) {
  if (!supported) return 0;
  await cancelPrefix(PREFIX);
  const on = (list || []).filter((r) => r.enabled);
  if (!on.length) return 0;
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) return 0;
  await ensureChannel();
  let n = 0;
  for (const r of on) {
    const c = reminderContent(r);
    const triggers = triggersFor(r);
    for (let i = 0; i < triggers.length; i++) {
      // eslint-disable-next-line no-await-in-loop
      await Notifications.scheduleNotificationAsync({ identifier: `${PREFIX}${r.id}-${i}`, content: { title: c.title, body: c.body, data: c.data, sound: true }, trigger: triggers[i] });
      n += 1;
    }
  }
  return n;
}

/** Schedule one verse notification per day for the next ~14 days (topped up every time the app opens). */
export async function rescheduleDailyVerse(settings, translation = 'KJV') {
  if (!supported) return 0;
  await cancelPrefix(VERSE_PREFIX);
  if (!settings || !settings.enabled) return 0;
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) return 0;
  await ensureChannel();
  const now = Date.now();
  let n = 0;
  for (let i = 0; i <= VERSE_DAYS; i++) {
    const d = new Date(); d.setDate(d.getDate() + i); d.setHours(settings.hour, settings.minute, 0, 0);
    if (d.getTime() <= now + 30000) continue;
    const c = verseContent(d, translation);
    // eslint-disable-next-line no-await-in-loop
    await Notifications.scheduleNotificationAsync({ identifier: `${VERSE_PREFIX}${dateKey(d)}`, content: { title: c.title, body: c.body, data: c.data, sound: true }, trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: d, channelId: CHANNEL } });
    n += 1;
    if (n >= VERSE_DAYS) break;
  }
  return n;
}

export async function sendTestNotification(content) {
  if (!supported) return false;
  if (!(await ensurePermission())) return false;
  await ensureChannel();
  await Notifications.scheduleNotificationAsync({
    identifier: `${PREFIX}test-${Date.now()}`,
    content: { title: content.title, body: content.body, data: content.data },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 3, channelId: CHANNEL },
  });
  return true;
}

// ---------- server copy (online) ----------
const clean = (r) => ({ id: r.id, purpose: r.purpose, kind: r.kind, hour: r.hour, minute: r.minute, repeat: r.repeat, days: r.days || [], date: r.date || null, target: r.target, passage: r.passage || null, enabled: r.enabled !== false });
export const pushReminder = (request, r) => request('PUT', `/me/reminders/${r.id}`, clean(r));
export const deleteReminderRemote = (request, id) => request('DELETE', `/me/reminders/${id}`);
export const pushDailyVerse = (request, dv) => request('PUT', '/me/reminders', { dailyVerse: { enabled: !!dv.enabled, hour: dv.hour, minute: dv.minute } });

/** Merge the server copy with this phone's (local unsynced edits win; deletions made offline are replayed). */
export async function syncReminders(request, getState, dispatch) {
  const s0 = getState();
  for (const id of s0.reminderTombstones || []) {
    // eslint-disable-next-line no-await-in-loop
    try { await deleteReminderRemote(request, id); } catch (e) { if (e.status !== 404) return; }
  }
  const server = await request('GET', '/me/reminders');
  const s = getState();
  const local = s.reminders || [];
  const byId = new Map((server.items || []).map((x) => [x.id, x]));
  const dirty = local.filter((x) => x.dirty);
  for (const d of dirty) byId.set(d.id, d);
  const merged = [...byId.values()].map((x) => ({ ...x, dirty: false }));
  for (const d of dirty) {
    // eslint-disable-next-line no-await-in-loop
    try { await pushReminder(request, d); } catch (e) { merged.find((x) => x.id === d.id).dirty = true; }
  }
  let dailyVerse = server.dailyVerse || DEFAULT_VERSE;
  if (s.dailyVerse && s.dailyVerse.dirty) {
    try { dailyVerse = (await pushDailyVerse(request, s.dailyVerse)).dailyVerse; } catch (e) { dailyVerse = s.dailyVerse; }
  }
  dispatch({ type: 'set', patch: { reminders: merged, dailyVerse: { ...DEFAULT_VERSE, ...dailyVerse, dirty: !!(dailyVerse && dailyVerse.dirty) }, reminderTombstones: [] } });
}

// ---------- mounted once at the app root ----------
export function useReminders(nav) {
  const { state, dispatch, ready, getState } = useStore();
  const api = useApi();
  const reminders = ready ? state.reminders || [] : null;
  const dv = ready ? { ...DEFAULT_VERSE, ...(state.dailyVerse || {}) } : null;
  const translation = (state && state.translation) || 'KJV';
  const sig = reminders ? reminders.map((r) => `${r.id}|${r.enabled}|${r.hour}:${r.minute}|${r.repeat}|${(r.days || []).join('')}|${r.date}|${r.purpose}|${r.target}`).join(';') : null;
  const vsig = dv ? `${dv.enabled}|${dv.hour}:${dv.minute}|${translation}` : null;

  useEffect(() => { if (supported && sig != null) rescheduleReminders(reminders).catch(() => {}); }, [sig]);
  useEffect(() => { if (supported && vsig != null) rescheduleDailyVerse(dv, translation).catch(() => {}); }, [vsig]);

  // Online: pull the server copy once per app start (reminders come back on a new phone)
  const synced = useRef(false);
  useEffect(() => {
    if (!ready || !api.online || synced.current) return;
    synced.current = true;
    syncReminders(api.request, getState, dispatch).catch(() => {});
  }, [ready, api.online]);

  // Tapping a reminder opens the relevant screen
  useEffect(() => {
    if (!supported || !nav) return undefined;
    const handled = new Set();
    const open = (resp) => {
      const n = resp && resp.notification;
      const d = n && n.request.content.data;
      if (!d || (d.type !== 'reminder' && d.type !== 'dailyVerse')) return;
      const key = `${n.request.identifier}|${n.date}`;
      if (handled.has(key)) return;
      handled.add(key);
      if (d.type === 'dailyVerse') nav.push('Bible', { bookId: d.bookId, chapter: d.chapter, verse: d.verse });
      else if (d.target === 'Bible') nav.push('Bible', d.passage && d.passage.bookId ? { bookId: d.passage.bookId, chapter: d.passage.chapter } : {});
      else if (d.target === 'PrayerWall') nav.push('PrayerWall');
      else nav.push('Today');
    };
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    Notifications.getLastNotificationResponseAsync().then(open).catch(() => {});
    return () => sub.remove();
  }, [!!nav]);
}
