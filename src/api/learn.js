// LEARN CMS (online mode) — courses, lessons and devotionals written in the admin dashboard, with the reader's
// progress kept on the server. One small shared cache so the Learn list and the lesson preview stay in step
// (marking a lesson complete updates "x of y lessons" on the card underneath straight away).
//   useCourses()            GET /learn/courses            → { items, loaded, error, reload }
//   useCourse(id)           GET /learn/courses/:id        → { course (lessons with excerpts), loaded, error, reload }
//   useDevotionals()        GET /learn/devotionals        → { items, loaded, error, reload }
//   enrollCourse(api, id) · completeLesson(api, lessonId, via) · uncompleteLesson(api, lessonId) · readDevotional(api, id, via)
//   openBlog(url)           in-app browser (Chrome Custom Tabs / SFSafariViewController; a new tab on web)
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import { useApi } from './auth';
import { errorMessage } from './client';
import { colors } from '../theme';

const KEY = 'bn.learn.v1.';
const cache = { courses: null, devotionals: null, course: {} };
const subs = new Set();
const emit = () => subs.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
const persist = (k, v) => { try { AsyncStorage.setItem(KEY + k, JSON.stringify(v)).catch(() => {}); } catch (e) { /* ignore */ } };
async function restore(k) {
  try { const raw = await AsyncStorage.getItem(KEY + k); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}

function useTick() {
  const [, set] = useState(0);
  useEffect(() => { const f = () => set((n) => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
}

function useLoader(slot, path, { persistKey } = {}) {
  const api = useApi();
  useTick();
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(slot.get() != null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const load = useCallback(async () => {
    if (!api.online || !path) { setLoaded(true); return; }
    if (slot.get() == null && persistKey) {
      const stored = await restore(persistKey);
      if (stored && slot.get() == null) { slot.set(stored); emit(); }
    }
    try {
      const r = await api.request('GET', path);
      slot.set(r);
      if (persistKey) persist(persistKey, r);
      emit();
      if (alive.current) setError(null);
    } catch (e) {
      if (alive.current) setError(errorMessage(e, 'Couldn’t load — check your connection'));
    }
    if (alive.current) setLoaded(true);
  }, [api.online, path]);
  useEffect(() => { load(); }, [load]);
  return { data: slot.get(), error, loaded: loaded || slot.get() != null, reload: load, online: api.online };
}

export function useCourses() {
  const r = useLoader({ get: () => cache.courses, set: (v) => { cache.courses = v; } }, '/learn/courses', { persistKey: 'courses' });
  return { ...r, items: (r.data && r.data.items) || [] };
}

export function useCourse(id) {
  const r = useLoader({ get: () => cache.course[id] || null, set: (v) => { cache.course[id] = v; } }, id ? `/learn/courses/${id}` : null);
  return { ...r, course: r.data };
}

export function useDevotionals() {
  const r = useLoader({ get: () => cache.devotionals, set: (v) => { cache.devotionals = v; } }, '/learn/devotionals', { persistKey: 'devotionals' });
  return { ...r, items: (r.data && r.data.items) || [] };
}

/** A cached devotional (from the list) — the preview renders it instantly. */
export const cachedDevotional = (id) => ((cache.devotionals && cache.devotionals.items) || []).find((d) => d.id === id) || null;

function applyProgress(courseId, progress) {
  if (!courseId || !progress) return;
  if (cache.courses && cache.courses.items) {
    cache.courses = { ...cache.courses, items: cache.courses.items.map((c) => (c.id === courseId ? { ...c, progress } : c)) };
    persist('courses', cache.courses);
  }
  if (cache.course[courseId]) cache.course[courseId] = { ...cache.course[courseId], progress };
  emit();
}

export async function enrollCourse(api, courseId) {
  const r = await api.request('POST', `/learn/courses/${courseId}/enroll`);
  applyProgress(courseId, r.progress);
  return r.progress;
}

// Optimistic: the bar moves at once; the server answer (or a rollback on failure) settles it.
export async function completeLesson(api, courseId, lessonId, via = 'button') {
  const before = cache.course[courseId] && cache.course[courseId].progress;
  if (before && !before.completed.includes(lessonId)) {
    const lessons = cache.course[courseId].lessons || [];
    const completed = [...before.completed, lessonId];
    const next = lessons.find((l) => !completed.includes(l.id)) || null;
    applyProgress(courseId, { ...before, enrolled: true, completed, done: completed.length, complete: completed.length >= lessons.length, nextLessonId: next ? next.id : null, nextPosition: next ? next.position : null });
  }
  try {
    const r = await api.request('POST', `/learn/lessons/${lessonId}/complete`, { via });
    applyProgress(courseId, r.progress);
    return r.progress;
  } catch (e) {
    if (before) applyProgress(courseId, before);
    throw e;
  }
}

export async function uncompleteLesson(api, courseId, lessonId) {
  const r = await api.request('DELETE', `/learn/lessons/${lessonId}/complete`);
  applyProgress(courseId, r.progress);
  return r.progress;
}

export async function readDevotional(api, id, via = 'button') {
  const set = (patch) => {
    if (cache.devotionals && cache.devotionals.items) {
      cache.devotionals = { ...cache.devotionals, items: cache.devotionals.items.map((d) => (d.id === id ? { ...d, ...patch } : d)) };
      persist('devotionals', cache.devotionals);
      emit();
    }
  };
  const was = cachedDevotional(id);
  set({ read: true });
  try {
    const d = await api.request('POST', `/learn/devotionals/${id}/read`, { via });
    set(d);
    return d;
  } catch (e) {
    if (was) set({ read: !!was.read });
    throw e;
  }
}

/** Opens the full post in the in-app browser. Returns once it is open (native: when the reader closes it). */
export function openBlog(url) {
  if (!url) return Promise.resolve();
  if (Platform.OS === 'web') {
    try { window.open(url, '_blank', 'noopener'); } catch (e) { /* ignore */ }
    return Promise.resolve();
  }
  return WebBrowser.openBrowserAsync(url, {
    toolbarColor: colors.screen,
    controlsColor: colors.primary,
    secondaryToolbarColor: colors.screen,
    enableBarCollapsing: true,
    showTitle: true,
    dismissButtonStyle: 'close',
  }).catch(() => {});
}

export const fmtDay = (d) => {
  try { return new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); } catch (e) { return d; }
};
