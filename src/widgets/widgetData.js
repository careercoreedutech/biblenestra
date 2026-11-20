// WIDGETS: what the Android home-screen widgets show (pure — no native code, safe on every platform).
//   verse    the day's verse: the admin's Daily Bread when cached for today, else the app's verse of the day
//   prayer   a one-line prayer of the day
//   progress the active reading plan ("Day 12 of 30")
// The widgets read the app's persisted store + the Daily Bread cache from AsyncStorage (the widget task runs
// headless, without the React tree), so they work offline and refresh daily.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getChapter, refLabel, verseOfDay } from '../data/bible';
import { POP_PRAYERS } from '../notifications/content';
import { imageFor } from '../notifications/imagery';

export const DEEP = {
  daily: 'biblenestra://daily',
  prayer: 'biblenestra://prayer',
  bible: 'biblenestra://bible',
  listen: 'biblenestra://listen',
  community: 'biblenestra://community',
  companion: 'biblenestra://companion',
  reading: 'biblenestra://reading',
};

const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayIndex = (d) => Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(2024, 0, 1)) / 86400000);
const SHORT_PRAYERS = POP_PRAYERS.filter((p) => p.length <= 72);
const FALLBACK_PRAYER = 'Lord, give me peace and strength today.';

function text(bookId, chapter, verse) {
  try { return (((getChapter('KJV', bookId, chapter) || [])[verse - 1]) || '').trim(); } catch (e) { return ''; }
}

export function widgetVerse(bread, now = new Date()) {
  if (bread && bread.bookId) {
    const t = text(bread.bookId, bread.chapter, bread.verse);
    return { text: t || bread.reflection || '', reference: bread.label || refLabel(bread.bookId, bread.chapter, bread.verse), image: bread.imageUrl || imageFor('scripture', 700) };
  }
  const v = verseOfDay(now);
  return { text: text(v.bookId, v.chapter, v.verse) || v.reflection || '', reference: refLabel(v.bookId, v.chapter, v.verse), image: imageFor('devotional', 700) };
}

export function widgetPrayer(now = new Date()) {
  const list = SHORT_PRAYERS.length ? SHORT_PRAYERS : [FALLBACK_PRAYER];
  return { text: list[dayIndex(now) % list.length] || FALLBACK_PRAYER, image: imageFor('prayer', 600) };
}

export function widgetProgress(state, now = new Date()) {
  const today = localDate(now);
  const plans = ((state && state.plans) || []).filter((p) => p && p.days && !(p.startsOn && p.startsOn > today));
  const plan = plans.find((p) => p.done > 0 && p.done < p.days) || plans.find((p) => p.done < p.days) || plans[0] || null;
  if (!plan) {
    const pos = (state && state.lastPosition) || { bookId: 'JHN', chapter: 1 };
    return { name: 'Start a reading plan', day: 0, days: 0, done: 0, pct: 0, uri: `${DEEP.bible}?bookId=${pos.bookId}&chapter=${pos.chapter}`, empty: true };
  }
  const done = Math.max(0, Math.min(plan.days, plan.done || 0));
  const p = plan.today && plan.today.bookId ? plan.today : null;
  return {
    name: plan.name,
    day: Math.max(1, Math.min(plan.days, done || 1)),
    days: plan.days,
    done,
    pct: plan.days ? done / plan.days : 0,
    uri: p ? `${DEEP.bible}?bookId=${p.bookId}&chapter=${p.chapter}` : DEEP.reading,
  };
}

/** Everything the widgets need, read from device storage (used by the headless widget task). */
export async function loadWidgetData(storeKey, now = new Date()) {
  let state = null;
  let bread = null;
  try { const raw = await AsyncStorage.getItem(storeKey); state = raw ? JSON.parse(raw) : null; } catch (e) { state = null; }
  try {
    const raw = await AsyncStorage.getItem('bn.today.daily'); // written by src/api/daily.js (Daily Bread cache)
    const entry = raw ? JSON.parse(raw) : null;
    if (entry && entry.data && entry.data.date === localDate(now)) bread = entry.data.bread || null;
  } catch (e) { bread = null; }
  return { verse: widgetVerse(bread, now), prayer: widgetPrayer(now), progress: widgetProgress(state, now) };
}
