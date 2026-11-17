// Photos and videos are stored in Cloudflare R2 (bucket binding MEDIA) and served from GET /media/<key>
// (or from a public bucket / custom domain set in PUBLIC_MEDIA_BASE).
// Videos are compressed to 720p H.264 MP4 on the phone before upload, so R2 only has to store and serve them.
import { Hono } from 'hono';
import { one, q } from '../lib/db.js';
import { ApiError, bad, body, forbidden, int, notFound } from '../lib/http.js';
import { mediaUrl } from '../lib/shape.js';

const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' };
const VOICE_TYPES = {
  'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a', 'audio/mp4': 'm4a', 'audio/aac': 'aac',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/webm': 'webm',
  // audio files shared into a chat
  'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/x-aac': 'aac', 'audio/flac': 'flac', 'audio/x-flac': 'flac',
  'audio/opus': 'opus', 'audio/3gpp': '3gp', 'audio/amr': 'amr', 'video/webm': 'webm'
};
const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_VOICE = 20 * 1024 * 1024; // voice notes and audio files shared in chats
// Video limits — the ONE place they live (the app reads them from the POST /uploads/video response).
// Cloudflare Workers accept request bodies up to 100 MB, so anything bigger than singlePutMaxBytes goes up
// as an R2 multipart upload (parts of partBytes; R2 needs every part but the last to be >= 5 MiB and equal-sized).
// Videos are never trimmed or cut — these limits only refuse files that are too long / too big.
export const VIDEO_RULES = {
  maxSeconds: 2 * 60 * 60, // 2 hours
  maxBytes: 2 * 1024 * 1024 * 1024, // 2 GB
  singlePutMaxBytes: 95 * 1024 * 1024, // one PUT request (Worker body limit is 100 MB)
  partBytes: 10 * 1024 * 1024, // multipart part size (a 2 GB video is ~205 parts)
  minPartBytes: 5 * 1024 * 1024, // R2 minimum for every part except the last
  maxParts: 10000,
};

const needBucket = (env) => {
  if (!env.MEDIA) throw new ApiError(500, 'STORAGE_NOT_CONFIGURED', 'Media storage (R2 bucket binding MEDIA) is not configured');
};
const mediaBase = (c) => (c.env.PUBLIC_MEDIA_BASE || `${new URL(c.req.url).origin}/media`).replace(/\/$/, '');

// ---------- authenticated ----------
export const uploads = new Hono();

uploads.post('/uploads/image', async (c) => {
  const me = c.get('user');
  needBucket(c.env);
  const type = (c.req.header('Content-Type') || '').split(';')[0].trim().toLowerCase();
  const ext = IMAGE_TYPES[type];
  if (!ext) throw bad('Upload a JPEG, PNG, WebP or HEIC image', 'BAD_IMAGE_TYPE');
  const len = Number(c.req.header('Content-Length') || 0);
  if (len > MAX_IMAGE) throw new ApiError(413, 'TOO_LARGE', 'Images must be under 10 MB');
  const buf = await c.req.arrayBuffer();
  if (!buf.byteLength) throw bad('Empty upload');
  if (buf.byteLength > MAX_IMAGE) throw new ApiError(413, 'TOO_LARGE', 'Images must be under 10 MB');
  const key = `img/${me.id}/${crypto.randomUUID()}.${ext}`;
  await c.env.MEDIA.put(key, buf, { httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' } });
  return c.json({ key, url: `${mediaBase(c)}/${key}` }, 201);
});

// Contest entries: audio (songs, spoken word, sermons) up to 25 MB, public like photos and videos
const AUDIO_TYPES = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/webm': 'webm' };
const MAX_AUDIO = 25 * 1024 * 1024;
uploads.post('/uploads/audio', async (c) => {
  const me = c.get('user');
  needBucket(c.env);
  const type = (c.req.header('Content-Type') || '').split(';')[0].trim().toLowerCase();
  const ext = AUDIO_TYPES[type];
  if (!ext) throw bad('Upload an audio file (MP3, M4A, AAC, WAV or OGG)', 'BAD_TYPE');
  const len = Number(c.req.header('Content-Length') || 0);
  if (len > MAX_AUDIO) throw new ApiError(413, 'TOO_LARGE', 'Audio must be under 25 MB');
  const buf = await c.req.arrayBuffer();
  if (!buf.byteLength) throw bad('Empty upload');
  if (buf.byteLength > MAX_AUDIO) throw new ApiError(413, 'TOO_LARGE', 'Audio must be under 25 MB');
  const key = `aud/${me.id}/${crypto.randomUUID()}.${ext}`;
  await c.env.MEDIA.put(key, buf, { httpMetadata: { contentType: type } });
  return c.json({ key, url: mediaUrl(c.env, new URL(c.req.url).origin, key) }, 201);
});

// Voice notes and audio files for chat (<= 20 MB). With X-Conversation-Id the file is private to that chat.
uploads.post('/uploads/voice', async (c) => {
  const me = c.get('user');
  needBucket(c.env);
  let type = (c.req.header('Content-Type') || '').split(';')[0].trim().toLowerCase();
  // unknown or generic types are stored as m4a (what the app records); anything that isn't audio is refused
  if (type && type !== 'application/octet-stream' && !VOICE_TYPES[type] && !type.startsWith('audio/')) throw bad('Upload an audio file (M4A, MP3, AAC, WAV, OGG or WebM)', 'BAD_TYPE');
  if (!type || type === 'application/octet-stream') type = 'audio/m4a';
  const ext = VOICE_TYPES[type] || 'm4a';
  const len = Number(c.req.header('Content-Length') || 0);
  if (len > MAX_VOICE) throw new ApiError(413, 'TOO_LARGE', 'Audio must be under 20 MB');
  const buf = await c.req.arrayBuffer();
  if (!buf.byteLength) throw bad('Empty voice upload');
  if (buf.byteLength > MAX_VOICE) throw new ApiError(413, 'TOO_LARGE', 'Audio must be under 20 MB');

  const convId = c.req.header('X-Conversation-Id') || c.req.query('conversationId');
  let key;
  if (convId) {
    const mem = await one(c.env, `SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2`, [convId, me.id]);
    if (!mem) throw forbidden('Not a member of this chat');
    key = `chat/${convId}/voice_${crypto.randomUUID()}.${ext}`;
  } else {
    key = `voice/${me.id}/${crypto.randomUUID()}.${ext}`;
  }

  await c.env.MEDIA.put(key, buf, { httpMetadata: { contentType: type || 'audio/m4a', cacheControl: 'private, max-age=31536000, immutable' } });
  const origin = new URL(c.req.url).origin;
  const url = key.startsWith('chat/') ? `${origin}/chat/media/${key}` : `${mediaBase(c)}/${key}`;
  return c.json({ key, url }, 201);
});

// Chat image upload (scoped to conversation)
uploads.post('/uploads/chat-image', async (c) => {
  const me = c.get('user');
  needBucket(c.env);
  const type = (c.req.header('Content-Type') || '').split(';')[0].trim().toLowerCase();
  const ext = IMAGE_TYPES[type];
  if (!ext) throw bad('Upload a JPEG, PNG, WebP or HEIC image', 'BAD_IMAGE_TYPE');
  const len = Number(c.req.header('Content-Length') || 0);
  if (len > MAX_IMAGE) throw new ApiError(413, 'TOO_LARGE', 'Images must be under 10 MB');
  const buf = await c.req.arrayBuffer();
  if (!buf.byteLength) throw bad('Empty upload');
  if (buf.byteLength > MAX_IMAGE) throw new ApiError(413, 'TOO_LARGE', 'Images must be under 10 MB');

  const convId = c.req.header('X-Conversation-Id') || c.req.query('conversationId');
  let key;
  if (convId) {
    const mem = await one(c.env, `SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2`, [convId, me.id]);
    if (!mem) throw forbidden('Not a member of this chat');
    key = `chat/${convId}/img_${crypto.randomUUID()}.${ext}`;
  } else {
    key = `img/${me.id}/${crypto.randomUUID()}.${ext}`;
  }

  await c.env.MEDIA.put(key, buf, { httpMetadata: { contentType: type, cacheControl: 'private, max-age=31536000, immutable' } });
  const origin = new URL(c.req.url).origin;
  const url = key.startsWith('chat/') ? `${origin}/chat/media/${key}` : `${mediaBase(c)}/${key}`;
  return c.json({ key, url }, 201);
});

// Step 1: reserve an upload. The app then PUTs the MP4 to uploadURL (and the poster JPEG to thumbnailURL),
// and finally creates the post with POST /posts { videoUid }.
uploads.post('/uploads/video', async (c) => {
  const me = c.get('user');
  needBucket(c.env);
  const b = await body(c).catch(() => ({}));
  const duration = b.durationSeconds ? Number(b.durationSeconds) : null; // 0 / missing = unknown
  if (duration !== null && (!Number.isFinite(duration) || duration < 0 || duration > VIDEO_RULES.maxSeconds + 1)) {
    throw bad(`Videos can be up to ${VIDEO_RULES.maxSeconds / 3600} hours long`, 'TOO_LONG');
  }
  if (b.sizeBytes && Number(b.sizeBytes) > VIDEO_RULES.maxBytes) throw new ApiError(413, 'TOO_LARGE', 'This video is too large (the limit is 2 GB)');
  const uid = crypto.randomUUID().replace(/-/g, '');
  await q(c.env, 'INSERT INTO video_uploads (uid, user_id, duration, width, height) VALUES ($1, $2, $3, $4, $5)', [
    uid, me.id, duration, b.width ? int(Math.round(b.width), { max: 10000, field: 'width' }) : null, b.height ? int(Math.round(b.height), { max: 10000, field: 'height' }) : null,
  ]);
  const origin = new URL(c.req.url).origin;
  return c.json({
    uid,
    method: 'PUT',
    uploadURL: `${origin}/uploads/video/${uid}`,
    thumbnailURL: `${origin}/uploads/video/${uid}/thumbnail`,
    // big files: POST multipartURL → PUT …/parts/<n> (partSize bytes each) → POST …/complete
    multipartURL: `${origin}/uploads/video/${uid}/multipart`,
    maxBytes: VIDEO_RULES.maxBytes,
    maxSeconds: VIDEO_RULES.maxSeconds,
    singlePutMaxBytes: VIDEO_RULES.singlePutMaxBytes,
    partSize: VIDEO_RULES.partBytes,
  }, 201);
});

async function ownUpload(c) {
  const row = await one(c.env, 'SELECT * FROM video_uploads WHERE uid = $1', [c.req.param('uid')]);
  if (!row) throw notFound('Upload not found');
  if (row.user_id !== c.get('user').id) throw forbidden('Not your upload');
  return row;
}

// Body → something R2.put accepts with a known length (streams straight through in Workers)
function streamBody(c) {
  const len = Number(c.req.header('Content-Length') || 0);
  if (!len) throw new ApiError(411, 'LENGTH_REQUIRED', 'Content-Length is required');
  return { len, stream: c.req.raw.body };
}

// Step 2: the MP4 itself (Content-Type: video/mp4)
uploads.put('/uploads/video/:uid', async (c) => {
  const up = await ownUpload(c);
  const type = (c.req.header('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!['video/mp4', 'video/quicktime'].includes(type)) throw bad('Upload the compressed MP4 (video/mp4)', 'BAD_VIDEO_TYPE');
  const { len, stream } = streamBody(c);
  if (len > VIDEO_RULES.singlePutMaxBytes) throw new ApiError(413, 'USE_MULTIPART', 'Large videos must be sent in parts (multipartURL)');
  const key = videoKey(up);
  await c.env.MEDIA.put(key, stream, { httpMetadata: VIDEO_HTTP_META });
  return c.json(await markVideoReady(c, up, key, len));
});

const videoKey = (up) => `vid/${up.user_id}/${up.uid}.mp4`;
const VIDEO_HTTP_META = { contentType: 'video/mp4', cacheControl: 'public, max-age=31536000, immutable' };
async function markVideoReady(c, up, key, size) {
  await q(c.env, `UPDATE video_uploads SET status = 'ready', video_key = $2, size_bytes = $3 WHERE uid = $1`, [up.uid, key, size]);
  await q(c.env, `UPDATE posts SET video_url = $2, video_status = 'ready' WHERE video_uid = $1`, [up.uid, key]);
  return { uid: up.uid, url: `${mediaBase(c)}/${key}`, status: 'ready', sizeBytes: size };
}

// ---------- multipart: videos bigger than one Worker request ----------
// 1) POST /uploads/video/:uid/multipart → { uploadId, partSize, minPartSize, maxParts }
// 2) PUT  /uploads/video/:uid/multipart/:uploadId/parts/:n (n = 1, 2, …; raw bytes with Content-Length) → { partNumber, etag }
//    A failed part is simply sent again with the same n — the last copy wins.
// 3) POST /uploads/video/:uid/multipart/:uploadId/complete { parts: [{ partNumber, etag }] } → { uid, url, status: 'ready' }
//    DELETE /uploads/video/:uid/multipart/:uploadId aborts and frees the stored parts.
const mpUpload = (c, up) => {
  const id = c.req.param('uploadId');
  if (!id || id.length > 1024) throw bad('Bad uploadId', 'BAD_UPLOAD_ID');
  return c.env.MEDIA.resumeMultipartUpload(videoKey(up), id);
};

uploads.post('/uploads/video/:uid/multipart', async (c) => {
  needBucket(c.env);
  const up = await ownUpload(c);
  if (typeof c.env.MEDIA.createMultipartUpload !== 'function') throw new ApiError(501, 'MULTIPART_UNAVAILABLE', 'Large uploads are not supported by this storage');
  const mp = await c.env.MEDIA.createMultipartUpload(videoKey(up), { httpMetadata: VIDEO_HTTP_META });
  return c.json({
    uploadId: mp.uploadId,
    partSize: VIDEO_RULES.partBytes,
    minPartSize: VIDEO_RULES.minPartBytes,
    maxParts: VIDEO_RULES.maxParts,
    maxBytes: VIDEO_RULES.maxBytes,
  }, 201);
});

uploads.put('/uploads/video/:uid/multipart/:uploadId/parts/:n', async (c) => {
  const up = await ownUpload(c);
  const n = Number(c.req.param('n'));
  if (!Number.isInteger(n) || n < 1 || n > VIDEO_RULES.maxParts) throw bad('Part numbers run from 1 to 10000', 'BAD_PART');
  const { len, stream } = streamBody(c);
  if (len > VIDEO_RULES.singlePutMaxBytes) throw new ApiError(413, 'PART_TOO_LARGE', 'Each part must be under 95 MB');
  if ((n - 1) * VIDEO_RULES.minPartBytes >= VIDEO_RULES.maxBytes) throw new ApiError(413, 'TOO_LARGE', 'This video is too large (the limit is 2 GB)');
  let part;
  try {
    part = await mpUpload(c, up).uploadPart(n, stream);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(400, 'PART_FAILED', 'That part could not be stored — send it again');
  }
  return c.json({ partNumber: part.partNumber, etag: part.etag });
});

uploads.post('/uploads/video/:uid/multipart/:uploadId/complete', async (c) => {
  const up = await ownUpload(c);
  const b = await body(c).catch(() => ({}));
  const parts = Array.isArray(b.parts) ? b.parts : [];
  if (!parts.length || parts.length > VIDEO_RULES.maxParts) throw bad('List the uploaded parts', 'BAD_PARTS');
  const clean = parts
    .map((p) => ({ partNumber: Number(p && p.partNumber), etag: String((p && p.etag) || '') }))
    .sort((a, z) => a.partNumber - z.partNumber);
  if (clean.some((p, i) => p.partNumber !== i + 1 || !p.etag)) throw bad('Parts must be numbered 1, 2, 3… with their etags', 'BAD_PARTS');
  try {
    await mpUpload(c, up).complete(clean);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(400, 'COMPLETE_FAILED', 'The upload could not be put together — a part is missing or too small');
  }
  const key = videoKey(up);
  const head = await c.env.MEDIA.head(key);
  if (!head) throw new ApiError(500, 'COMPLETE_FAILED', 'The upload could not be put together');
  if (head.size > VIDEO_RULES.maxBytes) {
    await c.env.MEDIA.delete(key);
    throw new ApiError(413, 'TOO_LARGE', 'This video is too large (the limit is 2 GB)');
  }
  return c.json(await markVideoReady(c, up, key, head.size));
});

uploads.delete('/uploads/video/:uid/multipart/:uploadId', async (c) => {
  const up = await ownUpload(c);
  try { await mpUpload(c, up).abort(); } catch (e) { /* already gone */ }
  return c.json({ ok: true });
});

// Step 2b (optional): the poster image (Content-Type: image/jpeg)
uploads.put('/uploads/video/:uid/thumbnail', async (c) => {
  const up = await ownUpload(c);
  const type = (c.req.header('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!IMAGE_TYPES[type]) throw bad('Upload a JPEG, PNG or WebP thumbnail', 'BAD_IMAGE_TYPE');
  const buf = await c.req.arrayBuffer();
  if (!buf.byteLength || buf.byteLength > 2 * 1024 * 1024) throw bad('Thumbnails must be under 2 MB');
  const key = `vid/${up.user_id}/${up.uid}.${IMAGE_TYPES[type]}`;
  await c.env.MEDIA.put(key, buf, { httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' } });
  await q(c.env, 'UPDATE video_uploads SET thumb_key = $2 WHERE uid = $1', [up.uid, key]);
  await q(c.env, 'UPDATE posts SET video_thumb = $2 WHERE video_uid = $1', [up.uid, key]);
  return c.json({ url: `${mediaBase(c)}/${key}` });
});

// ---------- public: media with HTTP Range support (needed for video seeking / iOS playback) ----------
export const media = new Hono();

function parseRange(h, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(h || '');
  if (!m) return null;
  let start; let end;
  if (m[1] === '') { // suffix: last N bytes
    const n = Number(m[2]); if (!n) return null;
    start = Math.max(0, size - n); end = size - 1;
  } else {
    start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return 'unsatisfiable';
  return { start, end };
}

media.get('/media/*', async (c) => {
  if (!c.env.MEDIA) return c.notFound();
  const key = decodeURIComponent(new URL(c.req.url).pathname.replace(/^\/media\//, ''));
  if (!/^(img|vid|aud)\/[\w./-]+$/.test(key) || key.includes('..')) return c.notFound();
  const head = await c.env.MEDIA.head(key);
  if (!head) return c.notFound();
  const size = head.size;
  const headers = new Headers({
    'Content-Type': head.httpMetadata?.contentType || 'application/octet-stream',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Accept-Ranges': 'bytes',
  });
  if (head.httpEtag) headers.set('ETag', head.httpEtag);
  const range = parseRange(c.req.header('Range'), size);
  if (range === 'unsatisfiable') {
    headers.set('Content-Range', `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  if (c.req.method === 'HEAD') { headers.set('Content-Length', String(size)); return new Response(null, { status: 200, headers }); }
  if (range) {
    const obj = await c.env.MEDIA.get(key, { range: { offset: range.start, length: range.end - range.start + 1 } });
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    headers.set('Content-Length', String(range.end - range.start + 1));
    return new Response(obj.body, { status: 206, headers });
  }
  const obj = await c.env.MEDIA.get(key);
  headers.set('Content-Length', String(size));
  return new Response(obj.body, { status: 200, headers });
});

// ---------- authenticated: chat media (accessible only by conversation members) ----------
export const chatMedia = new Hono();

chatMedia.get('/chat/media/*', async (c) => {
  if (!c.env.MEDIA) return c.notFound();
  const me = c.get('user');
  const key = decodeURIComponent(new URL(c.req.url).pathname.replace(/^\/chat\/media\//, ''));
  if (!/^chat\/[\w.-]+\/[\w.-]+$/.test(key) || key.includes('..')) return c.notFound();

  const convId = key.split('/')[1];
  const mem = await one(c.env, `SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2`, [convId, me.id]);
  if (!mem) throw forbidden('Not a member of this chat');

  const head = await c.env.MEDIA.head(key);
  if (!head) return c.notFound();
  const size = head.size;
  const headers = new Headers({
    'Content-Type': head.httpMetadata?.contentType || 'application/octet-stream',
    'Cache-Control': 'private, max-age=31536000, immutable',
    'Accept-Ranges': 'bytes',
  });
  if (head.httpEtag) headers.set('ETag', head.httpEtag);
  const range = parseRange(c.req.header('Range'), size);
  if (range === 'unsatisfiable') {
    headers.set('Content-Range', `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  if (c.req.method === 'HEAD') { headers.set('Content-Length', String(size)); return new Response(null, { status: 200, headers }); }
  if (range) {
    const obj = await c.env.MEDIA.get(key, { range: { offset: range.start, length: range.end - range.start + 1 } });
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    headers.set('Content-Length', String(range.end - range.start + 1));
    return new Response(obj.body, { status: 206, headers });
  }
  const obj = await c.env.MEDIA.get(key);
  headers.set('Content-Length', String(size));
  return new Response(obj.body, { status: 200, headers });
});

