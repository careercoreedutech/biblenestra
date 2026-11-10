// Device media: pick photos / videos (expo-image-picker), shrink photos (expo-image-manipulator),
// compress videos to 720p MP4 on the phone, and upload everything to Cloudflare R2 through the Worker.
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import { ApiError } from './client';
import { compressVideo, makeThumbnail } from './videoTools';

const IS_WEB = Platform.OS === 'web';
const MAX_EDGE = 1600;

async function ensureLibraryPermission() {
  if (IS_WEB) return true;
  const cur = await ImagePicker.getMediaLibraryPermissionsAsync();
  if (cur.granted) return true;
  const req = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!req.granted) throw new Error('Allow photo library access in Settings to share photos and videos');
  return true;
}

/** Pick up to `max` photos. → [{ uri, width, height, mimeType }] ([] when cancelled) */
export async function pickPhotos(max = 4) {
  await ensureLibraryPermission();
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: max > 1,
    selectionLimit: max,
    quality: 0.9,
    orderedSelection: true,
  });
  if (res.canceled || !res.assets) return [];
  return res.assets.slice(0, max).map((a) => ({ uri: a.uri, width: a.width || 0, height: a.height || 0, mimeType: a.mimeType || 'image/jpeg' }));
}

/** Pick one video (≤ 3 min). → { uri, duration (s), mimeType, name, file? } | null */
export async function pickVideo() {
  await ensureLibraryPermission();
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['videos'],
    allowsMultipleSelection: false,
    videoMaxDuration: 180,
    // iOS converts to 720p H.264 while picking (Android is compressed after picking, in uploadVideo)
    videoExportPreset: ImagePicker.VideoExportPreset ? ImagePicker.VideoExportPreset.H264_1280x720 : undefined,
    quality: 1,
  });
  if (res.canceled || !res.assets || !res.assets[0]) return null;
  const a = res.assets[0];
  return {
    uri: a.uri,
    duration: a.duration ? (IS_WEB ? a.duration : a.duration / 1000) : 0, // native reports ms, web reports seconds
    mimeType: a.mimeType || 'video/mp4',
    name: a.fileName || 'video.mp4',
    file: a.file || null, // web: the File object
    width: a.width || 0,
    height: a.height || 0,
  };
}

/** Resize (longest edge ≤ 1600) + JPEG-compress a photo before upload. */
export async function prepareImage(photo) {
  const src = typeof photo === 'string' ? { uri: photo } : photo;
  try {
    let { width = 0, height = 0 } = src;
    if (!width || !height) {
      const probe = await ImageManipulator.manipulateAsync(src.uri, [], {});
      width = probe.width;
      height = probe.height;
    }
    const big = Math.max(width, height) > MAX_EDGE;
    const actions = big ? [{ resize: width >= height ? { width: MAX_EDGE } : { height: MAX_EDGE } }] : [];
    const out = await ImageManipulator.manipulateAsync(src.uri, actions, { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG });
    return { uri: out.uri, width: out.width, height: out.height, mimeType: 'image/jpeg' };
  } catch (e) {
    // Manipulation unavailable (rare) → upload the original
    return { uri: src.uri, width: src.width || 0, height: src.height || 0, mimeType: src.mimeType || 'image/jpeg' };
  }
}

function parseJson(text) {
  try { return text ? JSON.parse(text) : null; } catch (e) { return null; }
}

/** Upload one prepared image → { key, url, width, height } */
export async function uploadImage(request, photo) {
  const img = await prepareImage(photo);
  if (IS_WEB) {
    const blob = await (await fetch(img.uri)).blob();
    const r = await request('POST', '/uploads/image', blob, { headers: { 'Content-Type': img.mimeType || blob.type || 'image/jpeg' }, timeout: 60000 });
    return { ...r, width: img.width, height: img.height };
  }
  const headers = { ...(await request.authHeaders()), 'Content-Type': img.mimeType || 'image/jpeg', Accept: 'application/json' };
  let res;
  try {
    res = await FileSystem.uploadAsync(request.apiUrl + '/uploads/image', img.uri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers,
    });
  } catch (e) {
    throw new ApiError('Couldn’t upload your photo — check your connection', { code: 'NETWORK' });
  }
  const data = parseJson(res.body);
  if (res.status < 200 || res.status >= 300) {
    throw new ApiError((data && data.error) || `Upload failed (${res.status})`, { code: (data && data.code) || `HTTP_${res.status}`, status: res.status });
  }
  return { ...data, width: img.width, height: img.height };
}

function nativeUpload(url, fileUri, headers, onProgress) {
  const task = FileSystem.createUploadTask(
    url,
    fileUri,
    { httpMethod: 'PUT', uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT, headers },
    (p) => { if (onProgress && p.totalBytesExpectedToSend) onProgress(p.totalBytesSent / p.totalBytesExpectedToSend); },
  );
  return task.uploadAsync();
}

function webPut(url, blob, headers, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText });
    xhr.onerror = () => reject(new ApiError('Video upload failed — check your connection', { code: 'NETWORK' }));
    xhr.send(blob);
  });
}

function check(res, what) {
  if (!res || res.status < 200 || res.status >= 300) {
    const data = res ? parseJson(res.body) : null;
    throw new ApiError((data && data.error) || `${what} failed (${res ? res.status : 'no response'})`, { code: (data && data.code) || 'UPLOAD_FAILED', status: res ? res.status : 0 });
  }
}

/**
 * Compress (720p MP4) → reserve an upload → PUT the file and its poster frame to R2 via the Worker.
 * onProgress(0..1): the first ~30% is compression, the rest is the upload. → { uid }
 */
export async function uploadVideo(request, video, onProgress) {
  const report = (x) => { if (onProgress) onProgress(Math.max(0, Math.min(1, x))); };
  // 1) compress on the phone (no-op on web)
  const prepared = await compressVideo(video.uri, (p) => report(p * 0.3));
  // 2) poster frame from the compressed file
  const thumb = await makeThumbnail(prepared.uri);
  // 3) reserve the upload
  let blob = null;
  let sizeBytes = prepared.sizeBytes;
  if (IS_WEB) {
    blob = video.file || (await (await fetch(prepared.uri)).blob());
    sizeBytes = blob.size;
  }
  const res = await request('POST', '/uploads/video', {
    durationSeconds: video.duration ? Math.round(video.duration * 10) / 10 : undefined,
    width: video.width || undefined,
    height: video.height || undefined,
    sizeBytes: sizeBytes || undefined,
  });
  const auth = await request.authHeaders();
  const tz = { 'X-TZ-Offset': String(-new Date().getTimezoneOffset()) };
  // 4) the video itself
  if (IS_WEB) {
    check(await webPut(res.uploadURL, blob, { ...auth, ...tz, 'Content-Type': 'video/mp4' }, (p) => report(0.3 + p * 0.65)), 'Video upload');
  } else {
    let up;
    try {
      up = await nativeUpload(res.uploadURL, prepared.uri, { ...auth, ...tz, 'Content-Type': 'video/mp4' }, (p) => report(0.3 + p * 0.65));
    } catch (e) {
      throw new ApiError('Video upload failed — check your connection', { code: 'NETWORK' });
    }
    check(up, 'Video upload');
  }
  // 5) the poster frame (best effort — the video still works without it)
  if (thumb) {
    try {
      if (IS_WEB && thumb.blob) await webPut(res.thumbnailURL, thumb.blob, { ...auth, ...tz, 'Content-Type': 'image/jpeg' });
      else if (thumb.uri) await nativeUpload(res.thumbnailURL, thumb.uri, { ...auth, ...tz, 'Content-Type': 'image/jpeg' });
    } catch (e) { /* ignore */ }
  }
  report(1);
  return { uid: res.uid };
}

export const canPickMedia = true;

// ---------- Contest entries: audio (songs, spoken word, sermons) ----------
/** Pick one audio file. → { uri, name, mimeType, size, file? } | null */
export async function pickAudio() {
  // eslint-disable-next-line global-require
  const DocumentPicker = require('expo-document-picker');
  const res = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true, multiple: false });
  if (res.canceled || !res.assets || !res.assets[0]) return null;
  const a = res.assets[0];
  return { uri: a.uri, name: a.name || 'audio', mimeType: a.mimeType || 'audio/mpeg', size: a.size || 0, file: a.file || null };
}

/** Upload a picked audio file (≤ 25 MB) → { key, url } */
export async function uploadAudio(request, audio) {
  const type = /^audio\//.test(audio.mimeType || '') ? audio.mimeType : 'audio/mpeg';
  if (IS_WEB) {
    const blob = audio.file || (await (await fetch(audio.uri)).blob());
    return request('POST', '/uploads/audio', blob, { headers: { 'Content-Type': type }, timeout: 120000 });
  }
  const headers = { ...(await request.authHeaders()), 'Content-Type': type, Accept: 'application/json' };
  let res;
  try {
    res = await FileSystem.uploadAsync(request.apiUrl + '/uploads/audio', audio.uri, { httpMethod: 'POST', uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT, headers });
  } catch (e) {
    throw new ApiError('Couldn’t upload your audio — check your connection', { code: 'NETWORK' });
  }
  check(res, 'Audio upload');
  return parseJson(res.body);
}
