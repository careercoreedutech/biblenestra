// MY SCRIPTURE JOURNEY: server calls and hooks. Server: backend/src/routes/journey.js + lib/journey.js.
//   useJourneyStats()        GET /journey/stats (day, week, month, unique, streak, calendar, books, continue)
//   useJourneyGoal()         GET /journey/goal
//   saveJourneyGoal(api, p)  PUT /journey/goal
//   useJourneyConfig()       GET /journey/config (presets, notification cap)
//   syncJourneyEvents(api, events)   POST /journey/events/sync (idempotent)
//   useJourneyGroups(), groupProgress(api, id), createJourneyGroup, joinJourneyGroup, leaveJourneyGroup, setJourneyPrivacy
//   fetchAchievements(api), markAchievementsSeen(api, ids)
// Only the server decides totals, streaks and awards. The app keeps a local queue of events until the server accepts them.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from './auth';

export const journeyZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch (e) { return undefined; }
};
export const journeyOffset = () => -new Date().getTimezoneOffset();

const subs = new Set();
let version = 0;
/** Any change (a sync, a goal save, a new achievement) reloads the journey hooks. */
export function journeyChanged() { version += 1; subs.forEach((f) => { try { f(version); } catch (e) { /* ignore */ } }); }
function useVersion() {
  const [v, set] = useState(version);
  useEffect(() => { subs.add(set); return () => { subs.delete(set); }; }, []);
  return v;
}

/** Shared loader: keeps the last good answer so screens open with something on screen. */
function useServerData(path, key) {
  const api = useApi();
  const v = useVersion();
  const memo = useRef({});
  const [data, setData] = useState(memo.current[key] || null);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(!!memo.current[key]);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const load = useCallback(async () => {
    if (!api.online) { setLoaded(true); return null; }
    try {
      const d = await api.request('GET', path);
      memo.current[key] = d;
      if (alive.current) { setData(d); setError(null); }
      return d;
    } catch (e) {
      if (alive.current) setError(e);
      return null;
    } finally {
      if (alive.current) setLoaded(true);
    }
  }, [api.online, path, key]);
  useEffect(() => { load(); }, [load, v]);
  return { data, error, loaded, reload: load, online: api.online };
}

/** Dashboard numbers for the signed-in user, in the phone's time zone. */
export function useJourneyStats() {
  // a string (not a function) so the loader's dependencies stay stable between renders
  const q = new URLSearchParams();
  const z = journeyZone();
  if (z) q.set('tz', z);
  q.set('tzOffset', String(journeyOffset()));
  return useServerData(`/journey/stats?${q.toString()}`, 'stats');
}

export function useJourneyGoal() { return useServerData('/journey/goal', 'goal'); }
export function useJourneyConfig() { return useServerData('/journey/config', 'config'); }
export function useJourneyGroups() { return useServerData('/journey/groups', 'groups'); }

export async function saveJourneyGoal(api, patch) {
  const out = await api.request('PUT', '/journey/goal', patch);
  journeyChanged();
  return out.goal;
}

/** Sends queued events. Returns { accepted, duplicates, rejected, awarded }. Safe to repeat (clientId is idempotent). */
export async function syncJourneyEvents(api, events) {
  const out = await api.request('POST', '/journey/events/sync', { tz: journeyZone(), tzOffset: journeyOffset(), events });
  journeyChanged();
  return out;
}

export async function fetchAchievements(api) { return api.request('GET', '/journey/achievements'); }
export async function markAchievementsSeen(api, ids) { return api.request('POST', '/journey/achievements/seen', { ids }); }

export async function groupProgress(api, id) { return api.request('GET', `/journey/groups/${encodeURIComponent(id)}`); }
export async function createJourneyGroup(api, body) { const out = await api.request('POST', '/journey/groups', body); journeyChanged(); return out; }
export async function joinJourneyGroup(api, code) { const out = await api.request('POST', '/journey/groups/join', { code }); journeyChanged(); return out; }
export async function leaveJourneyGroup(api, id) { const out = await api.request('POST', `/journey/groups/${encodeURIComponent(id)}/leave`); journeyChanged(); return out; }
export async function setJourneyPrivacy(api, id, hideNumbers) {
  return api.request('PUT', `/journey/groups/${encodeURIComponent(id)}/privacy`, { hideNumbers });
}
