// Chat media (photos, voice notes, audio files) and coin gifts for private chats.
// Uploads go to the Worker scoped to one conversation (X-Conversation-Id), so the files are served from
// GET /chat/media/<key> — members only, which is why viewing them needs the auth header:
//   native → Image / expo-av sources carry `headers`
//   web    → fetch with the header, then show a blob: URL (cached per key for the session)
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { useEffect, useState } from 'react';
import { ApiError } from './client';
import { prepareImage } from './media';

const IS_WEB = Platform.OS === 'web';
export const MAX_CHAT_AUDIO = 20 * 1024 * 1024;

function parseJson(text) {
  try { return text ? JSON.parse(text) : null; } catch (e) { return null; }
}

// POST a local file (uri / web File) as the raw request body → parsed JSON
async function postFile(request, path, { uri, file, type, convId, what }) {
  if (IS_WEB) {
    const blob = file || (await (await fetch(uri)).blob());
    return request('POST', path, blob, { headers: { 'Content-Type': type || blob.type || 'application/octet-stream', 'X-Conversation-Id': convId }, timeout: 120000 });
  }
  const headers = { ...(await request.authHeaders()), 'Content-Type': type, 'X-Conversation-Id': convId, Accept: 'application/json' };
  let res;
  try {
    res = await FileSystem.uploadAsync(request.apiUrl + path, uri, { httpMethod: 'POST', uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT, headers });
  } catch (e) {
    throw new ApiError(`Couldn’t upload your ${what} — check your connection`, { code: 'NETWORK' });
  }
  const data = parseJson(res.body);
  if (res.status < 200 || res.status >= 300) {
    throw new ApiError((data && data.error) || `Upload failed (${res.status})`, { code: (data && data.code) || `HTTP_${res.status}`, status: res.status });
  }
  return data;
}

/** Resize + upload one photo into a chat → { key, url, width, height } */
export async function uploadChatImage(request, convId, photo) {
  const img = await prepareImage(photo);
  const r = await postFile(request, '/uploads/chat-image', { uri: img.uri, type: img.mimeType || 'image/jpeg', convId, what: 'photo' });
  return { ...r, width: img.width, height: img.height };
}

/** Upload a recorded voice note or a picked audio file into a chat → { key, url } */
export async function uploadChatAudio(request, convId, audio) {
  if (audio.size && audio.size > MAX_CHAT_AUDIO) throw new ApiError('Audio files can be up to 20 MB', { code: 'TOO_LARGE' });
  let type = (audio.mimeType || '').split(';')[0];
  if (!/^audio\//.test(type) && type !== 'video/webm') type = IS_WEB ? '' : 'audio/m4a';
  return postFile(request, '/uploads/voice', { uri: audio.uri, file: audio.file, type, convId, what: audio.isFile ? 'audio' : 'voice note' });
}

/** POST /conversations/:id/coins → { coinsRemaining, message } */
export function sendChatCoins(request, convId, { coins, note, toUserId }) {
  return request('POST', `/conversations/${convId}/coins`, { coins, note: note || undefined, toUserId, clientId: `gift_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` });
}

// ---------- viewing ----------
export function chatMediaUrl(apiUrl, key) {
  if (!key) return null;
  if (/^https?:|^blob:|^file:/.test(key)) return key;
  return key.startsWith('chat/') ? `${apiUrl}/chat/media/${key}` : `${apiUrl}/media/${key}`;
}

const webCache = new Map(); // key → Promise<blob url>

/** Resolve a playable / displayable source for a chat media key. → { uri, headers? } | null */
export async function resolveChatMedia(request, key) {
  const url = chatMediaUrl(request.apiUrl, key);
  if (!url) return null;
  if (!key.startsWith('chat/')) return { uri: url };
  if (IS_WEB) {
    if (!webCache.has(key)) {
      webCache.set(key, (async () => {
        const res = await fetch(url, { headers: await request.authHeaders() });
        if (!res.ok) throw new ApiError(`Couldn’t load media (${res.status})`, { code: `HTTP_${res.status}`, status: res.status });
        return URL.createObjectURL(await res.blob());
      })().catch((e) => { webCache.delete(key); throw e; }));
    }
    return { uri: await webCache.get(key) };
  }
  return { uri: url, headers: await request.authHeaders() };
}

/** React hook: { source, error } for an image key */
export function useChatMediaSource(request, key) {
  const [state, setState] = useState({ source: null, error: null });
  useEffect(() => {
    let alive = true;
    if (!key || !request) return undefined;
    resolveChatMedia(request, key)
      .then((source) => { if (alive) setState({ source, error: null }); })
      .catch((e) => { if (alive) setState({ source: null, error: e }); });
    return () => { alive = false; };
  }, [key, request]);
  return state;
}

// ---------- CHAT 7.4: documents, any file and videos (with upload progress) ----------
export const MAX_CHAT_FILE = 50 * 1024 * 1024;
export const MAX_CHAT_VIDEO = 95 * 1024 * 1024;

/** Pick any file (documents, PDFs, slides…) or a video → { uri, name, mimeType, size, file } | null */
export async function pickChatFile({ video = false } = {}) {
  // eslint-disable-next-line global-require
  const DocumentPicker = require('expo-document-picker');
  const res = await DocumentPicker.getDocumentAsync({ type: video ? 'video/*' : '*/*', copyToCacheDirectory: true, multiple: false });
  if (res.canceled || !res.assets || !res.assets[0]) return null;
  const a = res.assets[0];
  return { uri: a.uri, name: a.name || (video ? 'video.mp4' : 'file'), mimeType: a.mimeType || (a.file && a.file.type) || 'application/octet-stream', size: a.size || (a.file && a.file.size) || 0, file: a.file || null };
}

/**
 * Upload a picked file into a chat → { key, url, size, mime, name, kind: 'file'|'video' }.
 * onProgress(0..1) is called while it uploads (XHR on web, an upload task on phones).
 */
export async function uploadChatFile(request, convId, f, onProgress) {
  const isVideo = /^video\//.test(f.mimeType || '');
  const max = isVideo ? MAX_CHAT_VIDEO : MAX_CHAT_FILE;
  if (f.size && f.size > max) throw new ApiError(isVideo ? 'Videos can be up to 95 MB' : 'Files can be up to 50 MB', { code: 'TOO_LARGE' });
  const url = `${request.apiUrl}/uploads/chat-file`;
  const headers = { ...(await request.authHeaders()), 'Content-Type': f.mimeType || 'application/octet-stream', 'X-Conversation-Id': convId, 'X-File-Name': encodeURIComponent(f.name || 'file'), Accept: 'application/json' };
  if (IS_WEB) {
    const blob = f.file || (await (await fetch(f.uri)).blob());
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      Object.entries(headers).forEach(([k, v]) => { if (v) xhr.setRequestHeader(k, v); });
      xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      xhr.onload = () => {
        const data = parseJson(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new ApiError((data && data.error) || `Upload failed (${xhr.status})`, { code: (data && data.code) || `HTTP_${xhr.status}`, status: xhr.status }));
      };
      xhr.onerror = () => reject(new ApiError('Couldn’t upload — check your connection', { code: 'NETWORK' }));
      xhr.send(blob);
    });
  }
  let res;
  try {
    const task = FileSystem.createUploadTask(url, f.uri, { httpMethod: 'POST', uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT, headers },
      (p) => { if (onProgress && p.totalBytesExpectedToSend) onProgress(p.totalBytesSent / p.totalBytesExpectedToSend); });
    res = await task.uploadAsync();
  } catch (e) {
    throw new ApiError('Couldn’t upload — check your connection', { code: 'NETWORK' });
  }
  const data = parseJson(res && res.body);
  if (!res || res.status < 200 || res.status >= 300) throw new ApiError((data && data.error) || `Upload failed (${res && res.status})`, { code: (data && data.code) || 'UPLOAD_FAILED', status: res && res.status });
  return data;
}

/** A signed 2-hour link for a chat file → { url, viewerUrl (PDFs), expiresAt } (cached for an hour) */
const linkCache = new Map();
export async function chatMediaLink(request, key) {
  const hit = linkCache.get(key);
  if (hit && hit.until > Date.now()) return hit.link;
  const link = await request('GET', `/chat/media-link?key=${encodeURIComponent(key)}`);
  linkCache.set(key, { link, until: Date.now() + 3600e3 });
  return link;
}

/** Save / open a chat file: web downloads it, phones hand the signed link to the system browser (download manager). */
export async function downloadChatFile(request, key, name) {
  const link = await chatMediaLink(request, key);
  const dl = `${link.url}&download=1&name=${encodeURIComponent(name || 'file')}`;
  if (IS_WEB) {
    const a = document.createElement('a');
    a.href = dl; a.download = name || 'file'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    return true;
  }
  // eslint-disable-next-line global-require
  const WebBrowser = require('expo-web-browser');
  await WebBrowser.openBrowserAsync(dl);
  return true;
}
