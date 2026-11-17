// MEDIA LIBRARY API — platform Audio Library, Christian Books (PDF), personal and group uploads.
// See backend/src/routes/library.js for the contract. Online mode only (local mode shows a sign-in notice).
import { useMemo } from 'react';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { useApi } from './auth';
import { ApiError } from './client';
import { uploadImage } from './media';

const IS_WEB = Platform.OS === 'web';
export const MAX_UPLOAD = { audio: 95 * 1024 * 1024, pdf: 60 * 1024 * 1024 };

const AUDIO_EXT = { mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/opus', flac: 'audio/flac', webm: 'audio/webm' };
const SERVER_AUDIO = ['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/x-aac', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/ogg', 'audio/opus', 'audio/webm', 'audio/flac', 'audio/x-flac'];

/** Best Content-Type for a picked file (pickers often report generic or missing types). */
export function mimeFor(kind, asset) {
  if (kind === 'pdf') return 'application/pdf';
  const t = String((asset && asset.mimeType) || '').split(';')[0].toLowerCase();
  if (SERVER_AUDIO.includes(t)) return t;
  const ext = String((asset && asset.name) || (asset && asset.uri) || '').split('?')[0].split('.').pop().toLowerCase();
  return AUDIO_EXT[ext] || 'audio/mpeg';
}

function parse(text) { try { return text ? JSON.parse(text) : null; } catch (e) { return null; } }

/** Upload a picked audio/PDF file → { key, url, sizeBytes, mime }. onProgress(0..1). */
export async function uploadLibraryFile(request, kind, asset, onProgress) {
  if (asset.size && asset.size > MAX_UPLOAD[kind]) throw new ApiError(`Files can be up to ${Math.round(MAX_UPLOAD[kind] / 1048576)} MB`, { code: 'TOO_LARGE' });
  const type = mimeFor(kind, asset);
  const url = `${request.apiUrl}/library/files?kind=${kind}`;
  const headers = { ...(await request.authHeaders()), 'Content-Type': type, Accept: 'application/json' };
  if (IS_WEB) {
    const blob = asset.file || (await (await fetch(asset.uri)).blob());
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      Object.keys(headers).forEach((k) => xhr.setRequestHeader(k, headers[k]));
      xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      xhr.onload = () => {
        const d = parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(d);
        else reject(new ApiError((d && d.error) || `Upload failed (${xhr.status})`, { code: (d && d.code) || `HTTP_${xhr.status}`, status: xhr.status }));
      };
      xhr.onerror = () => reject(new ApiError('Couldn’t upload — check your connection', { code: 'NETWORK' }));
      xhr.send(blob);
    });
  }
  let res;
  try {
    const task = FileSystem.createUploadTask(url, asset.uri, { httpMethod: 'POST', uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT, headers },
      (p) => { if (onProgress && p.totalBytesExpectedToSend) onProgress(p.totalBytesSent / p.totalBytesExpectedToSend); });
    res = await task.uploadAsync();
  } catch (e) {
    throw new ApiError('Couldn’t upload — check your connection', { code: 'NETWORK' });
  }
  const d = parse(res && res.body);
  if (!res || res.status < 200 || res.status >= 300) throw new ApiError((d && d.error) || `Upload failed (${res && res.status})`, { code: (d && d.code) || 'UPLOAD_FAILED', status: res && res.status });
  return d;
}

/** Upload a cover image (local uri / data: uri on web) → key */
export async function uploadCover(request, uri) {
  const r = await uploadImage(request, { uri });
  return r.key;
}

export function useLibraryApi() {
  const api = useApi();
  const request = api.request;
  return useMemo(() => {
    const qs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    return {
      online: !!api.online,
      request,
      apiUrl: request ? request.apiUrl : '',
      categories: (kind) => request('GET', `/library/categories?kind=${kind}`),
      home: (kind) => request('GET', `/library/home?kind=${kind}`),
      list: (p) => request('GET', `/library/items?${qs(p)}`),
      item: (id) => request('GET', `/library/items/${id}`),
      continueList: (kind) => request('GET', `/library/continue?kind=${kind}`),
      myGroups: () => request('GET', '/library/my-groups'),
      create: (b) => request('POST', '/library/items', b),
      update: (id, b) => request('PATCH', `/library/items/${id}`, b),
      remove: (id) => request('DELETE', `/library/items/${id}`),
      publish: (id, b) => request('POST', `/library/items/${id}/publish`, b || {}),
      report: (id, reason) => request('POST', `/library/items/${id}/report`, { reason }),
      played: (id, b) => request('POST', `/library/items/${id}/play`, b || {}).catch(() => null),
      saveProgress: (id, position, completed = false) => request('PUT', `/library/items/${id}/progress`, { position, completed }).catch(() => null),
      uploadFile: (kind, asset, onProgress) => uploadLibraryFile(request, kind, asset, onProgress),
      uploadCover: (uri) => uploadCover(request, uri),
      /** URL of the pdf.js reader page for a book */
      viewerUrl: (item, page = 1) => {
        const u = String(item.fileUrl || '');
        const path = u.startsWith(request.apiUrl) ? u.slice(request.apiUrl.length) : u.replace(/^https?:\/\/[^/]+/, '');
        return `${request.apiUrl}/library/viewer?file=${encodeURIComponent(path)}&page=${page}`;
      },
    };
  }, [api.online, request]);
}

export function fmtDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}

/** Library item → player track */
export const toTrack = (it) => ({
  id: it.id, title: it.title, artist: it.artist || (it.owner && it.owner.displayName) || '', cover: it.coverUrl || null,
  url: it.fileUrl, durationSec: it.durationSec || 0, category: it.category ? it.category.slug : null, categoryName: it.category ? it.category.name : null,
  resumeAt: it.myProgress && !it.myProgress.completed ? it.myProgress.position : 0,
});
