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
