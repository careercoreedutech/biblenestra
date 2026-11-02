// Photos and videos are stored in Cloudflare R2 (bucket binding MEDIA) and served from GET /media/<key>
// (or from a public bucket / custom domain set in PUBLIC_MEDIA_BASE).
// Videos are compressed to 720p H.264 MP4 on the phone before upload, so R2 only has to store and serve them.
import { Hono } from 'hono';
import { one, q } from '../lib/db.js';
import { ApiError, bad, body, forbidden, int, notFound } from '../lib/http.js';

const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' };
const VOICE_TYPES = {
  'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a', 'audio/mp4': 'm4a', 'audio/aac': 'aac',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/webm': 'webm'
};
const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_VOICE = 5 * 1024 * 1024; // 5 MB for voice notes
export const VIDEO_RULES = { maxSeconds: 180, maxBytes: 95 * 1024 * 1024 }; // Cloudflare accepts request bodies up to 100 MB

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

// Voice note upload for chat (m4a / aac <= 5 MB)
uploads.post('/uploads/voice', async (c) => {
  const me = c.get('user');
  needBucket(c.env);
  const type = (c.req.header('Content-Type') || '').split(';')[0].trim().toLowerCase();
  const ext = VOICE_TYPES[type] || 'm4a';
  const len = Number(c.req.header('Content-Length') || 0);
  if (len > MAX_VOICE) throw new ApiError(413, 'TOO_LARGE', 'Voice notes must be under 5 MB');
  const buf = await c.req.arrayBuffer();
  if (!buf.byteLength) throw bad('Empty voice upload');
  if (buf.byteLength > MAX_VOICE) throw new ApiError(413, 'TOO_LARGE', 'Voice notes must be under 5 MB');

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
    throw bad(`Videos can be up to ${VIDEO_RULES.maxSeconds / 60} minutes long`, 'TOO_LONG');
  }
  if (b.sizeBytes && Number(b.sizeBytes) > VIDEO_RULES.maxBytes) throw new ApiError(413, 'TOO_LARGE', 'This video is too large — try a shorter clip');
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
    maxBytes: VIDEO_RULES.maxBytes,
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
  if (len > VIDEO_RULES.maxBytes) throw new ApiError(413, 'TOO_LARGE', 'This video is too large — try a shorter clip');
  const key = `vid/${up.user_id}/${up.uid}.mp4`;
  await c.env.MEDIA.put(key, stream, { httpMetadata: { contentType: 'video/mp4', cacheControl: 'public, max-age=31536000, immutable' } });
  await q(c.env, `UPDATE video_uploads SET status = 'ready', video_key = $2, size_bytes = $3 WHERE uid = $1`, [up.uid, key, len]);
  await q(c.env, `UPDATE posts SET video_url = $2, video_status = 'ready' WHERE video_uid = $1`, [up.uid, key]);
  return c.json({ uid: up.uid, url: `${mediaBase(c)}/${key}`, status: 'ready' });
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
  if (!/^(img|vid)\/[\w./-]+$/.test(key) || key.includes('..')) return c.notFound();
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

