// MEDIA LIBRARY helpers: signed file links, HTTP Range parsing and the item → API shape.
// Files are streamed from GET /library/file/<key>. Items everyone may see get plain links; group-only and
// private items get a link signed with HMAC (exp + sig query params) so players that can't send an
// Authorization header (web <audio>, the PDF viewer page, expo-av) can still stream them.

const enc = new TextEncoder();
export const SIGN_TTL = 12 * 3600; // seconds a signed link stays valid

export const KINDS = ['audio', 'pdf'];
export const AUDIO_TYPES = {
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac',
  'audio/x-aac': 'aac', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/ogg': 'ogg', 'audio/opus': 'opus',
  'audio/webm': 'webm', 'audio/flac': 'flac', 'audio/x-flac': 'flac',
};
export const PDF_TYPES = { 'application/pdf': 'pdf', 'application/x-pdf': 'pdf' };
// Cloudflare accepts request bodies up to 100 MB on the standard plans
export const MAX_BYTES = { audio: 95 * 1024 * 1024, pdf: 60 * 1024 * 1024 };

const secretOf = (env) => env.MEDIA_SIGNING_SECRET || env.REALTIME_SECRET || env.ADMIN_PASSWORD || 'biblenestra-media-fallback-secret';

function b64url(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function hmac(env, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secretOf(env)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}

export async function signKey(env, key, ttl = SIGN_TTL) {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  return { exp, sig: await hmac(env, `lib:${key}:${exp}`) };
}
export async function verifyKeySig(env, key, exp, sig) {
  const n = Number(exp);
  if (!sig || !Number.isInteger(n) || n < Math.floor(Date.now() / 1000)) return false;
  const want = await hmac(env, `lib:${key}:${n}`);
  if (want.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

export const isFileKey = (k) => typeof k === 'string' && /^lib\/(audio|pdf)\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/.test(k);

/** "bytes=a-b" → { start, end } | null (no/unsupported header) | 'unsatisfiable' */
export function parseRange(h, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec((h || '').trim());
  if (!m) return null;
  let start; let end;
  if (m[1] === '') {
    const n = Number(m[2]); if (!n) return null;
    start = Math.max(0, size - n); end = size - 1;
  } else {
    start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return 'unsatisfiable';
  return { start, end };
}

/** Stream an R2 object with Range support (206 partial responses for seeking in large files). */
export async function streamObject(c, key, { cache = 'public, max-age=86400' } = {}) {
  const head = await c.env.MEDIA.head(key);
  if (!head) return c.json({ error: 'File not found', code: 'NOT_FOUND' }, 404);
  const size = head.size;
  const headers = new Headers({
    'Content-Type': head.httpMetadata?.contentType || 'application/octet-stream',
    'Cache-Control': cache,
    'Accept-Ranges': 'bytes',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
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
}

/** Whether anyone (even signed-out players) may stream this item's file without a signature. */
export const isOpenItem = (it) => it.status === 'published' && (it.in_library || (it.scope === 'personal' && it.visibility === 'public'));

export function coverUrl(env, origin, key) {
  if (!key) return null;
  if (/^https?:\/\//.test(key)) return key;
  const base = (env.PUBLIC_MEDIA_BASE || `${origin}/media`).replace(/\/$/, '');
  return `${base}/${key}`;
}

export async function fileUrl(env, origin, it) {
  const base = `${origin}/library/file/${it.file_key}`;
  if (isOpenItem(it)) return base;
  const { exp, sig } = await signKey(env, it.file_key);
  return `${base}?exp=${exp}&sig=${sig}`;
}

export const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'category';
