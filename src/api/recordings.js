// Record (Sermon Studio) — online mode: upload recordings to the API, which transcribes them and writes
// AI sermon notes in the background (Workers AI). Local mode never calls anything here.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { useApi } from './auth';
import { ApiError, errorMessage } from './client';

const IS_WEB = Platform.OS === 'web';
export const MAX_MINUTES = 60;

// Small files so an hour fits comfortably (≈ 15 MB at 32 kbps mono): Whisper resamples to 16 kHz anyway.
// Android writes ADTS AAC (.aac), which the server can split into pieces for long sermons.
export const SERMON_RECORDING = {
  isMeteringEnabled: true,
  android: {
    extension: '.aac',
    outputFormat: Audio.AndroidOutputFormat ? Audio.AndroidOutputFormat.AAC_ADTS : 6,
    audioEncoder: Audio.AndroidAudioEncoder ? Audio.AndroidAudioEncoder.AAC : 3,
    sampleRate: 22050,
    numberOfChannels: 1,
    bitRate: 32000,
  },
  ios: {
    extension: '.m4a',
    outputFormat: Audio.IOSOutputFormat ? Audio.IOSOutputFormat.MPEG4AAC : 'aac ',
    audioQuality: Audio.IOSAudioQuality ? Audio.IOSAudioQuality.MEDIUM : 64,
    sampleRate: 22050,
    numberOfChannels: 1,
    bitRate: 32000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: 'audio/webm', bitsPerSecond: 32000 },
};

const mimeFor = (uri, blobType) => {
  if (blobType) return blobType.split(';')[0];
  if (/\.aac($|\?)/i.test(uri)) return 'audio/aac';
  if (/\.webm($|\?)/i.test(uri)) return 'audio/webm';
  if (/\.mp3($|\?)/i.test(uri)) return 'audio/mpeg';
  return 'audio/m4a';
};

function parse(text) { try { return text ? JSON.parse(text) : null; } catch (e) { return null; } }

// Weak mobile connections drop uploads often: retry network failures and server hiccups (5xx) a few times.
const RETRIES = 3;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const retryable = (e) => !e || !e.status || e.status >= 500 || e.code === 'NETWORK' || e.code === 'TIMEOUT';
async function withRetry(fn) {
  let last;
  for (let i = 0; i < RETRIES; i++) {
    try { return await fn(i); } catch (e) {
      last = e;
      if (!retryable(e) || i === RETRIES - 1) break;
      await wait(1500 * (i + 1));
    }
  }
  throw last;
}

/**
 * Create the recording on the server and upload the audio. Works without a mounted screen (so a take
 * saved while leaving the studio still uploads). → recording (status 'transcribing')
 */
export async function uploadRecording(request, { uri, durationMs, title, passage, speaker }, onProgress) {
  if (!uri) throw new ApiError('There is no audio to upload', { code: 'NO_AUDIO' });
  if (durationMs && durationMs > (MAX_MINUTES * 60 + 5) * 1000) throw new ApiError('Recordings can be up to 60 minutes long', { code: 'TOO_LONG' });
  let blob = null;
  let size = 0;
  if (IS_WEB) {
    blob = await (await fetch(uri)).blob();
    size = blob.size;
  } else {
    const info = await FileSystem.getInfoAsync(uri).catch(() => null);
    size = (info && info.size) || 0;
  }
  const type = mimeFor(uri, blob && blob.type);
  const rec = await withRetry(() => request('POST', '/recordings', {
    title: (title || '').trim() || 'Untitled recording',
    passage: passage && passage !== '—' ? passage : undefined,
    speaker: speaker || undefined,
    durationSeconds: durationMs ? Math.round(durationMs / 100) / 10 : undefined,
    sizeBytes: size || undefined,
  }));
  const headers = { ...(await request.authHeaders()), 'Content-Type': type, 'X-TZ-Offset': String(-new Date().getTimezoneOffset()) };
  const putOnce = async () => {
  let res;
  if (IS_WEB) {
    res = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', rec.uploadURL);
      Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
      xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText });
      xhr.onerror = () => reject(new ApiError('Upload failed — check your connection', { code: 'NETWORK' }));
      xhr.send(blob);
    });
  } else {
    const task = FileSystem.createUploadTask(rec.uploadURL, uri, { httpMethod: 'PUT', uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT, headers },
      (p) => { if (onProgress && p.totalBytesExpectedToSend) onProgress(p.totalBytesSent / p.totalBytesExpectedToSend); });
    try { res = await task.uploadAsync(); } catch (e) { throw new ApiError('Upload failed — check your connection', { code: 'NETWORK' }); }
  }
  const data = parse(res && res.body);
  if (!res || res.status < 200 || res.status >= 300) {
    throw new ApiError((data && data.error) || `Upload failed (${res ? res.status : 'no response'})`, { code: (data && data.code) || 'UPLOAD_FAILED', status: res ? res.status : 0 });
  }
  return data;
  };
  return withRetry(putOnce);
}

/** An expo-av source for the owner-only audio route (native sends auth headers; web uses a blob URL). */
export async function audioSource(request, rec) {
  const url = request.apiUrl + rec.audioPath;
  const headers = await request.authHeaders();
  if (!IS_WEB) return { uri: url, headers };
  const res = await fetch(url, { headers });
  if (!res.ok) throw new ApiError('Couldn’t load the audio', { code: `HTTP_${res.status}`, status: res.status });
  return { uri: URL.createObjectURL(await res.blob()) };
}

// An upload that never finished (app closed mid-upload) — offered for deletion instead of spinning forever
export const isStaleUpload = (r) => r && r.status === 'uploading' && Date.now() - new Date(r.createdAt).getTime() > 15 * 60 * 1000;
const pending = (r) => r && ((r.status === 'uploading' && !isStaleUpload(r)) || r.status === 'transcribing' || r.status === 'summarising');

/** Server-backed list of the user's recordings (polls while any is still being processed). */
export function useCloudRecordings() {
  const api = useApi();
  const [items, setItems] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [uploads, setUploads] = useState([]); // [{ key, title, progress, error }]
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const refresh = useCallback(async () => {
    if (!api.online) return;
    try {
      const r = await api.request('GET', '/recordings');
      if (alive.current) { setItems(r.items || []); setError(null); }
    } catch (e) {
      if (alive.current) { setError(errorMessage(e, 'Couldn’t load your recordings')); setItems((x) => x || []); }
    }
  }, [api.online, api.request]);

  useEffect(() => { refresh(); }, [refresh]);
  const busy = (items || []).some((r) => pending(r) && !r.busy);
  useEffect(() => {
    if (!busy) return undefined;
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [busy, refresh]);

  const upload = useCallback(async (take) => {
    const key = `up${Date.now()}`;
    setUploads((u) => [{ key, title: take.title || 'Untitled recording', progress: 0 }, ...u]);
    try {
      const rec = await uploadRecording(api.request, take, (p) => alive.current && setUploads((u) => u.map((x) => (x.key === key ? { ...x, progress: p } : x))));
      if (alive.current) {
        setUploads((u) => u.filter((x) => x.key !== key));
        setItems((list) => [rec, ...(list || []).filter((x) => x.id !== rec.id)]);
      }
      return rec;
    } catch (e) {
      if (alive.current) setUploads((u) => u.map((x) => (x.key === key ? { ...x, error: errorMessage(e, 'Upload failed'), take } : x)));
      throw e;
    }
  }, [api.request]);

  const dismissUpload = (key) => setUploads((u) => u.filter((x) => x.key !== key));
  const retryUpload = async (key) => {
    const u = uploads.find((x) => x.key === key);
    if (!u || !u.take) return null;
    dismissUpload(key);
    return upload(u.take);
  };
  const patchLocal = (id, patch) => setItems((list) => (list || []).map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const removeLocal = (id) => setItems((list) => (list || []).filter((x) => x.id !== id));

  return { online: api.online, request: api.request, items, error, uploads, refresh, upload, dismissUpload, retryUpload, patchLocal, removeLocal };
}

export const STATUS_LABEL = { uploading: 'Uploading', transcribing: 'Transcribing…', summarising: 'Writing notes…', ready: 'Notes ready', error: 'Needs attention' };

export function fmtClock(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Plain-text export of a recording's notes (for the Share sheet). */
export function notesAsText(rec) {
  const n = rec.notes || {};
  const lines = [n.title || rec.title, rec.speaker ? `${rec.speaker}` : null, ''];
  if (n.summary) lines.push(n.summary, '');
  if ((n.mainPoints || []).length) { lines.push('Main points'); n.mainPoints.forEach((p, i) => lines.push(`${i + 1}. ${p}`)); lines.push(''); }
  if ((n.scriptures || []).length) { lines.push('Scriptures', n.scriptures.map((s) => s.label).join(' · '), ''); }
  if ((n.quotes || []).length) { lines.push('Key quotes'); n.quotes.forEach((qt) => lines.push(`“${qt}”`)); lines.push(''); }
  if ((n.application || []).length) { lines.push('Next steps'); n.application.forEach((a) => lines.push(`• ${a}`)); lines.push(''); }
  if (n.prayer) lines.push('Closing prayer', n.prayer, '');
  lines.push(`(${n.label || 'AI-generated — check against the recording'} · BibleNestra)`);
  return lines.filter((l) => l !== null).join('\n');
}
