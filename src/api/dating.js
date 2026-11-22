// FIND LOVE (online mode) — Christian dating. Server: backend/src/routes/dating.js · notes: scratch/monetisation/dating.md.
//   useDatingHome()                      GET /dating/me → { profile, plan, balances, prices, rules, swipes, likes, boost, counts, options }
//   datingChanged()                      every Find Love hook reloads (call after a swipe / purchase / profile change)
//   dating.*(api, …)                     the calls below (every coin use carries an idempotency key; confirm first in the UI)
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useApi } from './auth';
import { errorMessage, ApiError } from './client';
import { walletChanged, newIdempotencyKey } from './wallet';
import { prepareImage } from './media';

const subs = new Set();
let version = 0;
export function datingChanged() { version += 1; subs.forEach((f) => { try { f(version); } catch (e) { /* ignore */ } }); }
function useVersion() {
  const [v, set] = useState(version);
  useEffect(() => { subs.add(set); return () => { subs.delete(set); }; }, []);
  return v;
}
const memo = new Map();

/** GET with a shared cache; reloads on datingChanged(). */
export function useDatingGet(path) {
  const api = useApi();
  const v = useVersion();
  const [data, setData] = useState(() => (path ? memo.get(path) || null : null));
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(!!(path && memo.get(path)));
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = useCallback(async () => {
    if (!path) return;
    if (!api.online) { setLoaded(true); return; }
    try {
      const d = await api.request('GET', path);
      memo.set(path, d);
      if (alive.current) { setData(d); setError(null); }
    } catch (e) {
      if (alive.current) setError(e);
    } finally {
      if (alive.current) setLoaded(true);
    }
  }, [api.online, path]);
  useEffect(() => { load(); }, [load, v]);
  return { data, error, loaded, reload: load, online: api.online, setData };
}

export const useDatingHome = () => useDatingGet('/dating/me');

const after = (p) => p.then((r) => { datingChanged(); walletChanged(); return r; });
export const dating = {
  saveProfile: (api, body) => after(api.request('PUT', '/dating/profile', body)),
  addPhoto: (api, key) => after(api.request('POST', '/dating/profile/photos', { key })),
  removePhoto: (api, id) => after(api.request('DELETE', `/dating/profile/photos/${id}`)),
  mainPhoto: (api, id) => after(api.request('POST', `/dating/profile/photos/${id}/main`)),
  pause: (api, paused) => after(api.request('POST', '/dating/profile/pause', { paused })),
  deleteProfile: (api) => after(api.request('DELETE', '/dating/profile')),
  discover: (api, limit) => api.request('GET', `/dating/discover${limit ? `?limit=${limit}` : ''}`),
  profile: (api, id) => api.request('GET', `/dating/profiles/${id}`),
  swipe: (api, targetId, action) => api.request('POST', '/dating/swipe', { targetId, action, idempotencyKey: newIdempotencyKey() }),
  undo: (api) => api.request('POST', '/dating/undo'),
  extraSwipes: (api, key) => after(api.request('POST', '/dating/swipes/extra', { idempotencyKey: key })),
  likes: (api) => api.request('GET', '/dating/likes'),
  unlockLikes: (api, key) => after(api.request('POST', '/dating/likes/unlock', { idempotencyKey: key })),
  matches: (api) => api.request('GET', '/dating/matches'),
  unmatch: (api, matchId) => after(api.request('POST', `/dating/matches/${matchId}/unmatch`)),
  requests: (api) => api.request('GET', '/dating/requests'),
  sendRequest: (api, targetId, text, key) => after(api.request('POST', '/dating/requests', { targetId, text, idempotencyKey: key })),
  answerRequest: (api, convId, accept) => after(api.request('POST', `/dating/requests/${convId}/${accept ? 'accept' : 'decline'}`)),
  conversation: (api, convId) => api.request('GET', `/dating/conversations/${convId}`),
  startAd: (api, convId) => api.request('POST', `/dating/conversations/${convId}/ad/start`),
  claimAd: (api, nonce, token) => api.request('POST', '/dating/ads/claim', { nonce, token }),
  bundle: (api, convId, key) => after(api.request('POST', `/dating/conversations/${convId}/bundle`, { idempotencyKey: key })),
  boostStatus: (api) => api.request('GET', '/dating/boost'),
  boost: (api, kind, key, useFreeBoost = true) => after(api.request('POST', '/dating/boost', { kind, idempotencyKey: key, useFreeBoost })),
  block: (api, userId) => after(api.request('POST', '/dating/block', { userId })),
  report: (api, userId, reason, details, block) => after(api.request('POST', '/dating/report', { userId, reason, details, block })),
  // Verified badge (selfie with the code + gesture, and a government ID). The images are private to you and the team.
  verification: (api) => api.request('GET', '/dating/verification'),
  startVerification: (api) => api.request('POST', '/dating/verification/start'),
  uploadVerification: (api, kind, photo) => uploadVerificationImage(api.request, kind, photo),
  // extra: optional { dojahIdType: 'bvn' | 'nin', dojahIdNumber } for the automatic selfie ↔ ID photo check (when offered)
  submitVerification: (api, idType, extra = null) => after(api.request('POST', '/dating/verification/submit', { idType, ...(extra || {}) })),
};

/** Take a photo with the camera now (no gallery: the verification selfie must be live). → { uri, width, height, mimeType } | null */
export async function takeLivePhoto({ front = true } = {}) {
  if (Platform.OS !== 'web') {
    const p = await ImagePicker.requestCameraPermissionsAsync();
    if (!p.granted) throw new Error('Allow camera access in Settings to take your verification photo');
  }
  const res = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'], quality: 0.85, allowsEditing: false,
    cameraType: ImagePicker.CameraType ? (front ? ImagePicker.CameraType.front : ImagePicker.CameraType.back) : undefined,
  });
  if (res.canceled || !res.assets || !res.assets[0]) return null;
  const a = res.assets[0];
  return { uri: a.uri, width: a.width || 0, height: a.height || 0, mimeType: a.mimeType || 'image/jpeg' };
}

/** Upload the verification selfie or ID photo (raw JPEG body, like /uploads/image) → { verification }. */
async function uploadVerificationImage(request, kind, photo) {
  const img = await prepareImage(photo);
  const path = `/dating/verification/upload?kind=${kind === 'id' ? 'id' : 'selfie'}`;
  if (Platform.OS === 'web') {
    const blob = await (await fetch(img.uri)).blob();
    return request('POST', path, blob, { headers: { 'Content-Type': img.mimeType || blob.type || 'image/jpeg' }, timeout: 60000 });
  }
  const headers = { ...(await request.authHeaders()), 'Content-Type': img.mimeType || 'image/jpeg', Accept: 'application/json' };
  let res;
  try {
    res = await FileSystem.uploadAsync(request.apiUrl + path, img.uri, { httpMethod: 'POST', uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT, headers });
  } catch (e) {
    throw new ApiError('Couldn’t upload your photo — check your connection', { code: 'NETWORK' });
  }
  let data = null;
  try { data = res.body ? JSON.parse(res.body) : null; } catch (e) { data = null; }
  if (res.status < 200 || res.status >= 300) throw new ApiError((data && data.error) || `Upload failed (${res.status})`, { code: (data && data.code) || `HTTP_${res.status}`, status: res.status });
  return data;
}

export const datingError = (e, fallback) => {
  if (!e) return fallback || 'Something went wrong';
  if (e.code === 'INSUFFICIENT_BALANCE') return e.message || 'Not enough Dating Coins';
  if (e.code === 'RATE_LIMITED') return 'Please wait a moment and try again.';
  return errorMessage(e, fallback);
};

// ---------- labels ----------
export const INTENTION_LABELS = { marriage: 'Marriage-minded', long_term: 'Long-term relationship', friendship_first: 'Friendship first', not_sure: 'Still praying about it' };
export const DENOMINATIONS = ['Anglican', 'Baptist', 'Catholic', 'Methodist', 'Orthodox', 'Pentecostal', 'Presbyterian', 'Seventh-day Adventist', 'Non-denominational', 'Other'];
export const INVOLVEMENT = ['Attends sometimes', 'Attends weekly', 'Serves in ministry', 'Church leader', 'Exploring faith'];
export const PROMPTS = ['My favourite verse is…', 'On Sunday you’ll find me…', 'A perfect first date is…', 'I’m praying for…', 'My friends would describe me as…', 'Worship song on repeat…'];
export const REPORT_REASONS = [
  ['fake', 'Fake profile or scam'], ['inappropriate_photos', 'Inappropriate photos'], ['harassment', 'Harassment or pressure'],
  ['scam', 'Asked for money'], ['underage', 'May be under 18'], ['offensive', 'Offensive messages'], ['other', 'Something else'],
];
export const BOOST_OPTIONS = [
  { kind: 'boost_30m', label: '30 minutes', note: 'A quick lift while you’re online' },
  { kind: 'boost_1h', label: '1 hour', note: 'More people see you this evening' },
  { kind: 'boost_3h', label: '3 hours', note: 'Stay near the top for longer' },
  { kind: 'spotlight_24h', label: 'Spotlight · 24 hours', note: 'Featured near the top for a full day' },
];
export function countdown(secs) {
  const s = Math.max(0, Math.floor(secs || 0));
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
export { newIdempotencyKey };
