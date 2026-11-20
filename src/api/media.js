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

/** Pick one video (any length up to VIDEO_LIMITS.maxSeconds — never trimmed). → { uri, duration (s), mimeType, name, file? } | null */
export async function pickVideo() {
  await ensureLibraryPermission();
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['videos'],
    allowsMultipleSelection: false,
    allowsEditing: false, // the editor would let the system trim the clip
    // no videoMaxDuration: on iOS it trims / refuses longer clips
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

// Fallbacks only — the server's POST /uploads/video response (backend VIDEO_RULES) is the source of truth.
export const VIDEO_LIMITS = {
  maxSeconds: 2 * 60 * 60, // 2 hours
  maxBytes: 2 * 1024 * 1024 * 1024, // 2 GB
  singlePutMaxBytes: 95 * 1024 * 1024,
  partSize: 10 * 1024 * 1024,
};
const PART_RETRIES = 4;

function pickLimits(res) {
  const out = {};
  ['maxSeconds', 'maxBytes', 'singlePutMaxBytes', 'partSize'].forEach((k) => {
    if (res && Number(res[k]) > 0) out[k] = Number(res[k]);
  });
  return out;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Native: copy bytes [start, start + len) of a file into a temporary file (expo-file-system can only upload whole files)
async function sliceToTempFile(fileUri, start, len, n) {
  const b64 = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64, position: start, length: len });
  const tmp = `${FileSystem.cacheDirectory}vidpart_${Date.now()}_${n}.bin`;
  await FileSystem.writeAsStringAsync(tmp, b64, { encoding: FileSystem.EncodingType.Base64 });
  return tmp;
}

/**
 * R2 multipart upload through the Worker: start → PUT each part (retrying a failed part a few times) → complete.
 * Never trims anything: every byte of the file is sent. onProgress(0..1) covers the whole transfer.
 */
async function multipartUpload({ res, limits, sizeBytes, blob, fileUri, headers, onProgress }) {
  const json = (r) => parseJson(r.body) || {};
  const call = async (method, url, body) => {
    const r = await fetch(url, { method, headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.text() };
  };
  let start;
  try {
    start = await call('POST', res.multipartURL);
  } catch (e) {
    throw new ApiError('Video upload failed — check your connection', { code: 'NETWORK' });
  }
  check(start, 'Video upload');
  const { uploadId, partSize: serverPart } = json(start);
  const partSize = Number(serverPart) || limits.partSize;
  const base = `${res.multipartURL}/${encodeURIComponent(uploadId)}`;
  const count = Math.max(1, Math.ceil(sizeBytes / partSize));
  const parts = [];
  let doneBytes = 0;
  try {
    for (let n = 1; n <= count; n += 1) {
      const from = (n - 1) * partSize;
      const len = Math.min(partSize, sizeBytes - from);
      const url = `${base}/parts/${n}`;
      const partHeaders = { ...headers, 'Content-Type': 'application/octet-stream' };
      const progress = (p) => onProgress && onProgress((doneBytes + len * p) / sizeBytes);
      let result = null;
      let lastErr = null;
      for (let attempt = 0; attempt < PART_RETRIES && !result; attempt += 1) {
        if (attempt) await wait(1000 * 2 ** (attempt - 1)); // 1 s, 2 s, 4 s
        let tmp = null;
        try {
          let r;
          if (IS_WEB) {
            r = await webPut(url, blob.slice(from, from + len), partHeaders, progress);
          } else {
            tmp = await sliceToTempFile(fileUri, from, len, n);
            r = await nativeUpload(url, tmp, partHeaders, progress);
          }
          if (r && r.status >= 200 && r.status < 300) result = json(r);
          else {
            lastErr = r;
            if (r && r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) break; // not worth retrying
          }
        } catch (e) {
          lastErr = e;
        } finally {
          if (tmp) FileSystem.deleteAsync(tmp, { idempotent: true }).catch(() => {});
        }
      }
      if (!result || !result.etag) {
        if (lastErr && lastErr.status) check(lastErr, 'Video upload');
        throw new ApiError('Video upload failed — check your connection and try again', { code: 'NETWORK' });
      }
      parts.push({ partNumber: n, etag: result.etag });
      doneBytes += len;
      if (onProgress) onProgress(doneBytes / sizeBytes);
    }
    let fin = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        fin = await call('POST', `${base}/complete`, { parts });
        if (fin && fin.status < 500) break;
      } catch (e) { fin = null; }
      await wait(1500);
    }
    check(fin, 'Video upload');
    return json(fin);
  } catch (e) {
    call('DELETE', base).catch(() => {}); // free the stored parts
    throw e;
  }
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
  const limits = { ...VIDEO_LIMITS, ...pickLimits(res) };
  if (sizeBytes && sizeBytes > limits.maxBytes) throw new ApiError('This video is too large (the limit is 2 GB)', { code: 'TOO_LARGE', status: 413 });
  // 4) the video itself — big files in parts (Workers take at most ~100 MB per request), small ones in one PUT
  const multipart = !!res.multipartURL && sizeBytes > limits.singlePutMaxBytes;
  let done = null; // FEED VIDEO: the server's probe ({ codec, faststart, warnings }) comes back with the last request
  if (multipart) {
    done = await multipartUpload({ res, limits, sizeBytes, blob, fileUri: prepared.uri, headers: { ...auth, ...tz }, onProgress: (p) => report(0.3 + p * 0.65) });
  } else if (IS_WEB) {
    const put = await webPut(res.uploadURL, blob, { ...auth, ...tz, 'Content-Type': 'video/mp4' }, (p) => report(0.3 + p * 0.65));
    check(put, 'Video upload');
    done = parseJson(put.body);
  } else {
    let up;
    try {
      up = await nativeUpload(res.uploadURL, prepared.uri, { ...auth, ...tz, 'Content-Type': 'video/mp4' }, (p) => report(0.3 + p * 0.65));
    } catch (e) {
      throw new ApiError('Video upload failed — check your connection', { code: 'NETWORK' });
    }
    check(up, 'Video upload');
    done = parseJson(up.body);
  }
  // 5) the poster frame (best effort — the video still works without it)
  if (thumb) {
    try {
      if (IS_WEB && thumb.blob) await webPut(res.thumbnailURL, thumb.blob, { ...auth, ...tz, 'Content-Type': 'image/jpeg' });
      else if (thumb.uri) await nativeUpload(res.thumbnailURL, thumb.uri, { ...auth, ...tz, 'Content-Type': 'image/jpeg' });
    } catch (e) { /* ignore */ }
  }
  report(1);
  return { uid: res.uid, codec: (done && done.codec) || null, faststart: done ? done.faststart : null, warnings: (done && done.warnings) || [] };
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
