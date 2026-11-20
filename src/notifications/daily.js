// NOTIFICATIONS: "A moment with God. Every day." — the daily notification types users choose under
// Settings › Notifications. Everything is LOCAL (expo-notifications, scheduled on the phone in its own time
// zone: Date#setHours is local), so it works offline; the next few days are scheduled and topped up every
// time the app opens. Broadcasts are server pushes (the toggle mutes the 'broadcast' kind on the server).
//
// Store: state.dailyMoments = { [type]: { enabled, hour, minute } }  (see DEFAULT_MOMENTS)
//
// Each notification carries data { type: 'moment', moment, target, params } and deep-links via openTarget().
// Platform limits (expo-notifications 0.29 / SDK 52), documented in Settings › Notifications:
//   - Android: gold accent `color` + app icon + BigText body. A per-notification photo is NOT supported for
//     LOCAL notifications (only remote pushes carry an image; shown as the large thumbnail on the right).
//   - iOS: the photo is attached (`attachments`, downloaded to the cache first) and shows as a thumbnail /
//     expanded image. Server pushes with an image on iOS also need a Notification Service Extension.
//   - The OS draws the notification frame, so system notifications can't match the mock pixel for pixel; the
//     in-app notification centre (Activity) does.
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { getChapter, refLabel, verseOfDay } from '../data/bible';
import { DEVOTIONALS } from '../data/seed';
import { useStore } from '../store';
import { imageFor, GOLD } from './imagery';

export const supported = Platform.OS !== 'web';
const PREFIX = 'moment-';
const CHANNEL = 'daily-moments';
// iOS allows 64 pending local notifications per app (shared with pop-ups and reminders) → keep this small there
const DAYS_AHEAD = Platform.OS === 'ios' ? 3 : 7;

export const MOMENT_TYPES = [
  { key: 'scripture', emoji: '📖', title: 'Today’s Scripture', short: 'Morning verse', cta: 'Read Daily Bread', target: 'daily', when: 'Morning', opens: 'Daily Bread' },
  { key: 'prayer', emoji: '🙏', title: 'A Moment of Prayer', short: 'Midday pause', cta: 'Open Prayer', target: 'prayer', when: 'Midday', opens: 'Prayer Wall' },
  { key: 'encouragement', emoji: '❤️', title: 'Words of Encouragement', short: 'A word for your afternoon', cta: 'Be Encouraged', target: 'companion', when: 'Afternoon', opens: 'Scripture Companion' },
  { key: 'devotional', emoji: '🌅', title: 'Daily Devotional', short: 'Evening reflection', cta: 'Read Devotional', target: 'devotional', when: 'Evening', opens: 'Devotionals' },
  { key: 'community', emoji: '👥', title: 'Church Community', short: 'Your group’s conversation', cta: 'Open Community', target: 'community', when: 'Evening', opens: 'your group' },
  { key: 'broadcast', emoji: '📣', title: 'Broadcasts', short: 'Official messages from BibleNestra', cta: 'Open Message', target: 'inbox', when: 'When sent', server: true },
];
export const TYPE = Object.fromEntries(MOMENT_TYPES.map((t) => [t.key, t]));

export const DEFAULT_MOMENTS = {
  scripture: { enabled: true, hour: 7, minute: 0 },
  prayer: { enabled: true, hour: 12, minute: 30 },
  encouragement: { enabled: false, hour: 15, minute: 30 },
  devotional: { enabled: true, hour: 19, minute: 30 },
  community: { enabled: false, hour: 18, minute: 0 },
  broadcast: { enabled: true },
};
export function momentSettings(state) {
  const s = (state && state.dailyMoments) || {};
  const out = {};
  for (const t of MOMENT_TYPES) out[t.key] = { ...DEFAULT_MOMENTS[t.key], ...(s[t.key] || {}) };
  // Broadcast mute lives with the other server notification preferences
  // (users.notify.broadcasts on the server, synced via PUT /me/notify-settings; missing = on)
  out.broadcast.enabled = !(state && state.notifications && state.notifications.broadcasts === false);
  return out;
}

// ---------- content ----------
const PRAYER_VERSES = ['1PE:5:7', 'PHP:4:6', 'MAT:11:28', 'PSA:55:22', 'PSA:62:1', 'JER:33:3', 'MRK:11:24', 'HEB:4:16', 'PSA:46:10', 'ISA:26:3'];
const ENCOURAGE_VERSES = ['ISA:41:10', 'DEU:31:8', 'JOS:1:9', 'HEB:13:5', 'ISA:43:2', 'ZEP:3:17', 'PSA:34:18', 'ROM:8:28', '2CO:12:9', 'MAT:28:20', 'ISA:40:31', 'LAM:3:22'];
const PRAYER_LINES = ['Let your heart find rest in Him.', 'Bring Him what you are carrying right now.', 'Pause, breathe and pray.', 'He is near to all who call on Him.', 'A quiet minute with God changes the day.'];
const ENCOURAGEMENTS = [
  'You are not forgotten. God is with you always.',
  'You are loved more than you know.',
  'Your story isn’t over — God is still writing it.',
  'Rest. He is holding what you cannot carry.',
  'Strength for today, bright hope for tomorrow.',
  'You were made on purpose, for a purpose.',
];
const REFLECTIONS = ['Take a moment to reflect.', 'Breathe, and let it settle in your heart.', 'Carry this word with you today.', 'Pause here for a quiet minute.'];

const dayIndex = (d) => Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(2024, 0, 1)) / 86400000);
const pickDay = (arr, d, salt = 0) => arr[(((dayIndex(d) + salt) % arr.length) + arr.length) % arr.length];

function verseText(bookId, chapter, verse) {
  try { return (((getChapter('KJV', bookId, chapter) || [])[verse - 1]) || '').trim(); } catch (e) { return ''; }
}
function verseFromRef(ref) {
  const [bookId, ch, v] = ref.split(':');
  const chapter = Number(ch); const verse = Number(v);
  return { bookId, chapter, verse, text: verseText(bookId, chapter, verse), label: refLabel(bookId, chapter, verse) };
}
function firstWithText(list, d, salt) {
  for (let i = 0; i < list.length; i++) {
    const v = verseFromRef(pickDay(list, d, salt + i));
    if (v.text) return v;
  }
  return null;
}
const trimTo = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s || '');

/**
 * Content of one moment on a given day. `ctx` may carry { bread } (today's admin Daily Bread) and
 * { group } (the community to open). Returns the card model used by notifications, the in-app centre and widgets.
 */
export function momentContent(type, date = new Date(), ctx = {}) {
  const t = TYPE[type] || TYPE.scripture;
  const base = { type: t.key, emoji: t.emoji, title: `${t.emoji} ${t.title}`, cta: t.cta, target: t.target, params: {}, image: imageFor(t.key), reflection: pickDay(REFLECTIONS, date, t.key.length) };
  if (t.key === 'scripture') {
    const b = ctx.bread;
    if (b && b.bookId) {
      const text = verseText(b.bookId, b.chapter, b.verse);
      return { ...base, quote: text || b.reflection || '', reference: `${b.label || refLabel(b.bookId, b.chapter, b.verse)} (KJV)`, image: b.imageUrl || base.image, params: {} };
    }
    const v = verseOfDay(date);
    const text = verseText(v.bookId, v.chapter, v.verse);
    return { ...base, quote: text || v.reflection || '', reference: `${refLabel(v.bookId, v.chapter, v.verse)} (KJV)` };
  }
  if (t.key === 'prayer') {
    const v = firstWithText(PRAYER_VERSES, date, 3);
    return { ...base, quote: v ? v.text : 'Cast all your care upon him; for he careth for you.', reference: v ? `${v.label} (KJV)` : '1 Peter 5:7 (KJV)', reflection: pickDay(PRAYER_LINES, date) };
  }
  if (t.key === 'encouragement') {
    const v = firstWithText(ENCOURAGE_VERSES, date, 5);
    return { ...base, lead: pickDay(ENCOURAGEMENTS, date), quote: v ? v.text : '', reference: v ? `${v.label} (KJV)` : '', reflection: 'Let this truth hold you today.' };
  }
  if (t.key === 'devotional') {
    const d = pickDay(DEVOTIONALS, date);
    const passage = d && d.passage ? refLabel(d.passage.bookId, d.passage.chapter) : '';
    return { ...base, quote: d ? d.title : 'Faith Beyond What You See', reference: passage, reflection: trimTo(d ? d.question || d.body : '', 90) || base.reflection, params: d ? { id: d.id } : {} };
  }
  if (t.key === 'community') {
    const g = ctx.group;
    return { ...base, quote: g ? `${g.name} is active. Join the conversation!` : 'Your church group is active. Join the conversation!', reference: '', reflection: 'Encourage someone today.', params: g ? { id: g.id } : {} };
  }
  return { ...base, quote: ctx.text || 'A message from BibleNestra', reference: '' };
}

/** Body text for a system notification: quoted verse, reference, reflective line and CTA. */
export function notificationBody(c) {
  const lines = [];
  if (c.lead) lines.push(c.lead);
  if (c.quote) lines.push(c.type === 'community' ? c.quote : `“${c.quote}”`);
  if (c.reference) lines.push(c.reference);
  lines.push(`${c.reflection} ${c.cta} →`);
  return lines.join('\n');
}

function joinedGroup(state) {
  return ((state && state.communities) || []).find((g) => g.joined === true) || null;
}

// ---------- scheduling ----------
async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: 'Daily moments with God',
    description: 'Today’s Scripture, prayer, encouragement, devotional and community at the times you choose',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 140, 80, 140],
    lightColor: GOLD.goldDeep,
  });
}

export async function ensurePermission() {
  if (!supported) return false;
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted || (cur.ios && cur.ios.status === Notifications.IosAuthorizationStatus.PROVISIONAL)) return true;
  const req = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true } });
  return !!req.granted;
}

// iOS: local notifications can carry an image attachment, but it must be a local file → cache it once.
const iosFiles = new Map();
async function iosAttachment(url, key) {
  if (Platform.OS !== 'ios' || !url) return null;
  try {
    if (iosFiles.has(url)) return iosFiles.get(url);
    // eslint-disable-next-line global-require
    const FileSystem = require('expo-file-system');
    const dest = `${FileSystem.cacheDirectory}moment-${key}.jpg`;
    const info = await FileSystem.getInfoAsync(dest);
    const uri = info.exists ? dest : (await FileSystem.downloadAsync(url, dest)).uri;
    const att = [{ identifier: `img-${key}`, url: uri, type: 'public.jpeg', typeHint: 'public.jpeg' }];
    iosFiles.set(url, att);
    return att;
  } catch (e) { return null; }
}

async function contentInput(c) {
  const att = await iosAttachment(c.image, c.type);
  return {
    title: c.title,
    body: notificationBody(c),
    data: { type: 'moment', moment: c.type, target: c.target, params: c.params || {}, image: c.image },
    sound: true,
    color: GOLD.goldDeep, // Android: gold accent on the small icon / app name
    ...(att ? { attachments: att } : {}),
  };
}

async function cancelPrefix() {
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(pending.filter((n) => String(n.identifier).startsWith(PREFIX)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
}

const dkey = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

/** The local times each enabled moment fires in the next `days` days (exported for tests / the settings preview). */
export function upcomingMoments(settings, now = Date.now(), days = DAYS_AHEAD) {
  const out = [];
  for (const t of MOMENT_TYPES) {
    const s = settings[t.key];
    if (t.server || !s || !s.enabled) continue;
    for (let i = 0; i <= days; i++) {
      const d = new Date(now); d.setDate(d.getDate() + i); d.setHours(s.hour, s.minute, 0, 0);
      if (d.getTime() > now + 30000) out.push({ type: t.key, date: d });
      if (out.filter((x) => x.type === t.key).length >= days) break;
    }
  }
  return out.sort((a, b) => a.date - b.date);
}

/** Replace every pending daily moment with a fresh schedule. Returns how many were scheduled. */
export async function rescheduleMoments(state) {
  if (!supported) return 0;
  await cancelPrefix();
  const settings = momentSettings(state);
  const slots = upcomingMoments(settings);
  if (!slots.length) return 0;
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted && !(perm.ios && perm.ios.status === Notifications.IosAuthorizationStatus.PROVISIONAL)) return 0;
  await ensureChannel();
  const group = joinedGroup(state);
  let n = 0;
  for (const s of slots) {
    if (s.type === 'community' && !group) continue; // nothing to open
    const c = momentContent(s.type, s.date, { group });
    // eslint-disable-next-line no-await-in-loop
    const content = await contentInput(c);
    // eslint-disable-next-line no-await-in-loop
    await Notifications.scheduleNotificationAsync({
      identifier: `${PREFIX}${s.type}-${dkey(s.date)}`,
      content,
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: s.date, channelId: CHANNEL },
    });
    n += 1;
  }
  return n;
}

/** Send one moment now (in ~3 s) so the user can see how it looks. */
export async function sendTestMoment(type, state) {
  if (!supported) return false;
  if (!(await ensurePermission())) return false;
  await ensureChannel();
  const c = momentContent(type, new Date(), { group: joinedGroup(state) });
  await Notifications.scheduleNotificationAsync({
    identifier: `${PREFIX}test-${type}-${Date.now()}`,
    content: await contentInput(c),
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 3, channelId: CHANNEL },
  });
  return true;
}

/** Moments that have already "arrived" today and yesterday (newest first) — shown in the in-app centre. */
export function deliveredMoments(state, now = Date.now(), ctx = {}) {
  const settings = momentSettings(state);
  const group = joinedGroup(state);
  const out = [];
  for (let back = 0; back <= 1; back++) {
    for (const t of MOMENT_TYPES) {
      const s = settings[t.key];
      if (t.server || !s.enabled || (t.key === 'community' && !group)) continue;
      const d = new Date(now); d.setDate(d.getDate() - back); d.setHours(s.hour, s.minute, 0, 0);
      if (d.getTime() > now) continue;
      const c = momentContent(t.key, d, { group, bread: back === 0 ? ctx.bread : null });
      out.push({ ...c, id: `${PREFIX}${t.key}-${dkey(d)}`, at: d.getTime() });
    }
  }
  return out.sort((a, b) => b.at - a.at);
}

// ---------- deep links ----------
/** Open the screen a notification / widget / card points at. */
export function openTarget(nav, target, params = {}) {
  if (!nav) return;
  const p = params || {};
  switch (target) {
    case 'daily': nav.push('DailyVerse', {}); break;
    case 'devotional': nav.push('Learn', { tab: 'Devotionals', ...(p.id ? { devotionalId: p.id } : {}) }); break;
    case 'prayer': nav.push('PrayerWall', {}); break;
    case 'companion': nav.push('Companion', {}); break;
    case 'community': if (p.id) nav.push('Group', { id: p.id }); else nav.push('Communities', {}); break;
    case 'inbox': nav.push('Activity', p.broadcastId ? { broadcastId: p.broadcastId } : {}); break;
    case 'bible': nav.push('Bible', p.bookId ? { bookId: p.bookId, chapter: Number(p.chapter) || 1, ...(p.verse ? { verse: Number(p.verse) } : {}) } : {}); break;
    case 'listen': nav.push('MediaLibrary', {}); break;
    case 'reading': nav.push('Learn', { tab: 'Plans' }); break;
    case 'notifications': nav.push('NotificationSettings', {}); break;
    case 'today': default: nav.reset(); break;
  }
}

// ---------- mounted once at the app root ----------
export function useDailyMoments(nav) {
  const { state, ready } = useStore();
  const settings = ready ? momentSettings(state) : null;
  const group = ready ? joinedGroup(state) : null;
  const day = new Date().toDateString();
  const sig = settings
    ? `${MOMENT_TYPES.map((t) => `${t.key}:${settings[t.key].enabled}:${settings[t.key].hour}:${settings[t.key].minute}`).join('|')}|${group ? group.id : ''}|${day}`
    : null;
  const latest = useRef(state);
  latest.current = state;
  useEffect(() => {
    if (!supported || sig == null) return;
    rescheduleMoments(latest.current).catch(() => {});
  }, [sig]);

  // Tapping a daily moment opens its screen
  useEffect(() => {
    if (!supported || !nav) return undefined;
    const handled = new Set();
    const open = (resp) => {
      const n = resp && resp.notification;
      const d = n && n.request && n.request.content && n.request.content.data;
      if (!d || d.type !== 'moment') return;
      const key = `${n.request.identifier}|${n.date}`;
      if (handled.has(key)) return;
      handled.add(key);
      openTarget(nav, d.target, d.params || {});
    };
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    Notifications.getLastNotificationResponseAsync().then(open).catch(() => {});
    return () => sub.remove();
  }, [!!nav]);
}
