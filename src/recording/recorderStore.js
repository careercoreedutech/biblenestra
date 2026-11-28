// Module-level recorder for Sermon Studio. The expo-av Recording object lives here, not in a screen, so leaving the
// screen (or switching tabs) never stops or loses a take. Screens subscribe to the state and call the actions.
//
// status: idle | starting | recording | paused | saving
// Limits: one hour per take in every mode; a warning is shown five minutes before the end.
// Platform notes: iOS keeps recording in the background (UIBackgroundModes: audio is set in app.json). Android has no
// foreground service in expo-av, so when the app is minimised the take is saved as a partial recording and the user is told.
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { Audio } from 'expo-av';
import { SERMON_RECORDING, MAX_MINUTES, flushPendingUploads } from '../api/recordings';
import { persistTake, addPending, deleteTakeFile } from './pending';

export const MAX_MS = MAX_MINUTES * 60 * 1000;
export const WARN_MS = MAX_MS - 5 * 60 * 1000;
const WAVE_BARS = 28;
const IS_WEB = Platform.OS === 'web';

const initial = {
  status: 'idle',
  ms: 0,
  levels: Array(WAVE_BARS).fill(0),
  error: null, // 'denied' | 'unavailable' | null
  errorMessage: null,
  notice: null, // shown after a take was saved automatically (limit reached, app minimised)
  warning: null, // shown near the one-hour limit
  online: false,
};
let state = { ...initial };
const subs = new Set();
const emit = (patch) => {
  state = { ...state, ...patch };
  subs.forEach((fn) => fn(state));
};

export const getRecorderState = () => state;
export function subscribeRecorder(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

/** React hook: the live recorder state (re-renders on every change). */
export function useRecorder() {
  const [s, set] = useState(state);
  useEffect(() => subscribeRecorder(set), []);
  return s;
}

let rec = null;
let limitMs = MAX_MS; // this take's length limit: the unlocked time left, never more than one hour
let warnMs = WARN_MS;
let meta = { title: '', passage: '', speaker: '', privacy: 'Private' };
let appSub = null;
let warned = false;
let stopping = null;
let startedAt = 0;

/** The screen keeps the title, passage and speaker here so a take saved in the background still has its details. */
export function setRecorderMeta(next) {
  meta = { ...meta, ...next };
}

// Web takes are uploaded straight away (no local copy); native cloud takes are uploaded from the saved file.

export async function requestMicPermission() {
  return requestMic();
}

async function requestMic() {
  if (IS_WEB && typeof navigator !== 'undefined' && navigator.mediaDevices === undefined) {
    return { ok: false, error: 'unavailable', errorMessage: 'This browser cannot access a microphone. Open BibleNestra in a current browser over HTTPS.' };
  }
  try {
    const perm = await Audio.requestPermissionsAsync();
    if (!perm || !perm.granted) {
      return {
        ok: false,
        error: 'denied',
        errorMessage: 'Microphone access was denied. Allow BibleNestra to use the microphone in your device settings, then try again.',
      };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'unavailable', errorMessage: 'No microphone is available on this device.' };
  }
}

function levelFrom(st) {
  // Live input level when the platform reports metering; otherwise a gentle activity pulse.
  if (typeof st.metering === 'number') return Math.max(0, Math.min(1, (st.metering + 60) / 60));
  return 0.25 + 0.2 * Math.abs(Math.sin((st.durationMillis || 0) / 260));
}

function onStatus(st) {
  if (!st || !rec) return;
  const dur = st.durationMillis != null ? st.durationMillis : state.ms;
  const patch = { ms: dur };
  if (st.isRecording) patch.levels = [...state.levels.slice(1), levelFrom(st)];
  if (!warned && dur >= warnMs) {
    warned = true;
    patch.warning = 'Less than five minutes left. This recording saves automatically when the time is up.';
  }
  emit(patch);
  if (dur >= limitMs && state.status === 'recording') {
    // Stop outside the status callback; the take is saved and the user is told why it ended.
    setTimeout(() => { stopRecording({ keep: true, notice: 'The time limit was reached. The recording was saved.' }); }, 0);
  }
}

function onAppState(next) {
  if (next !== 'background' || !rec || state.status === 'saving') return;
  if (Platform.OS === 'android') {
    stopRecording({ keep: true, notice: 'The recording was saved when you left the app. Android stops microphone recording in the background, so tap record to start a new take.' });
  }
}

function attachAppState() {
  if (appSub) return;
  appSub = AppState.addEventListener('change', onAppState);
}
function detachAppState() {
  if (appSub) appSub.remove();
  appSub = null;
}

/** Start a take. Resolves { ok } or { ok:false, error, errorMessage }. */
export async function startRecording({ online, limitMs: allowedMs }) {
  limitMs = Math.min(MAX_MS, Math.max(60000, Number(allowedMs) || MAX_MS));
  warnMs = limitMs > 10 * 60000 ? limitMs - 5 * 60000 : Math.floor(limitMs * 0.8);
  if (state.status !== 'idle') return { ok: false, error: 'busy', errorMessage: 'A recording is already in progress.' };
  emit({ status: 'starting', error: null, errorMessage: null, notice: null, warning: null, ms: 0, levels: initial.levels, online: !!online });
  const perm = await requestMic();
  if (!perm.ok) {
    emit({ status: 'idle', error: perm.error, errorMessage: perm.errorMessage });
    return perm;
  }
  try {
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true, staysActiveInBackground: true });
    const { recording } = await Audio.Recording.createAsync(
      online ? SERMON_RECORDING : Audio.RecordingOptionsPresets.HIGH_QUALITY,
      onStatus,
      200,
    );
    rec = recording;
    warned = false;
    startedAt = Date.now();
    attachAppState();
    emit({ status: 'recording' });
    return { ok: true };
  } catch (e) {
    emit({ status: 'idle', error: 'unavailable', errorMessage: 'The microphone could not be started. Close other apps that use audio and try again.' });
    return { ok: false, error: 'unavailable', errorMessage: state.errorMessage };
  }
}

export async function pauseRecording() {
  if (!rec || state.status !== 'recording') return { ok: false };
  try {
    await rec.pauseAsync();
    emit({ status: 'paused' });
    return { ok: true };
  } catch (e) {
    return { ok: false, errorMessage: 'The recording could not be paused.' };
  }
}

export async function resumeRecording() {
  if (!rec || state.status !== 'paused') return { ok: false };
  try {
    await rec.startAsync();
    emit({ status: 'recording' });
    return { ok: true };
  } catch (e) {
    return { ok: false, errorMessage: 'The recording could not be resumed. Stop and save this take, then start again.' };
  }
}

/**
 * Stop the current take. keep=true saves it: the file moves into the documents folder and is recorded as pending
 * (cloud takes stay pending until the upload succeeds; device takes stay in the local list). keep=false deletes it.
 * Resolves the saved take { uri, durationMs, title, passage, speaker, online, savedAt } or null.
 */
export function stopRecording({ keep = true, notice = null } = {}) {
  if (stopping) return stopping;
  if (!rec) return Promise.resolve(null);
  stopping = (async () => {
    const r = rec;
    emit({ status: 'saving' });
    let uri = null;
    let dur = state.ms;
    try {
      const st = await r.getStatusAsync().catch(() => null);
      if (st && st.durationMillis) dur = st.durationMillis;
      await r.stopAndUnloadAsync();
      uri = r.getURI();
    } catch (e) {
      uri = null;
    }
    rec = null;
    detachAppState();
    Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true, staysActiveInBackground: false }).catch(() => {});
    let take = null;
    if (uri && keep) {
      const saved = await persistTake(uri);
      take = {
        uri: saved,
        durationMs: dur,
        title: meta.title,
        passage: meta.passage,
        speaker: meta.speaker,
        privacy: meta.privacy,
        online: state.online,
        savedAt: new Date().toISOString(),
      };
      if (!IS_WEB) await addPending({ ...take, kind: state.online ? 'cloud' : 'local' });
    } else if (uri) {
      deleteTakeFile(uri);
    }
    const failed = keep && !take;
    if (take && take.online && !IS_WEB && meta.request) flushPendingUploads(meta.request).catch(() => {});
    emit({
      status: 'idle',
      ms: 0,
      levels: initial.levels,
      warning: null,
      notice: take ? notice : null,
      errorMessage: failed ? 'The recording couldn’t be saved. Start a new take.' : null,
    });
    return take;
  })();
  return stopping.finally(() => { stopping = null; });
}
