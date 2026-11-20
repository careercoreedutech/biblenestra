// FEED VIDEO (client #18 / #19 / #29, section 7.1): what the server can check about an uploaded MP4 without
// transcoding it, and the sweep that marks uploads that never finished.
//
// probeMp4: walks the top-level MP4 boxes with a few tiny R2 range reads and reports
//   codec     — 'h264' | 'hevc' | 'av1' | 'vp9' | 'mpeg4' | 'other' | null (not an MP4 we could read).
//               HEVC (H.265, iPhone "High Efficiency") does not decode on many Android phones.
//   faststart — true when the index ("moov") comes before the media data ("mdat"), so a player can start
//               after the first few hundred KB; false = the whole file must be fetched / range-seeked first.
// sweepAbandonedUploads: reservations still 'uploading' after N hours (app closed, network lost, a PUT that
//   never arrived) → 'abandoned'; their R2 multipart upload is aborted (frees the stored parts) and any post
//   already made for them is set to video_status 'error' so the uploader sees "couldn't be processed" + retry
//   instead of a video that silently never appears.
import { q } from './db.js';

const MAX_BOXES = 64;
const MAX_MOOV_READ = 8 * 1024 * 1024; // a 2 h clip's moov is a few MB; the sample description is near its start

async function readRange(bucket, key, offset, length) {
  if (length <= 0) return new Uint8Array(0);
  const o = await bucket.get(key, { range: { offset, length } });
  if (!o) return null;
  const ab = typeof o.arrayBuffer === 'function' ? await o.arrayBuffer() : await new Response(o.body).arrayBuffer();
  return new Uint8Array(ab);
}

const u32 = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const fourcc = (b, i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);

// Video sample-entry fourccs (inside moov/trak/mdia/minf/stbl/stsd) → codec family
const CODECS = { avc1: 'h264', avc3: 'h264', hvc1: 'hevc', hev1: 'hevc', dvh1: 'hevc', dvhe: 'hevc', av01: 'av1', vp09: 'vp9', mp4v: 'mpeg4' };

export function codecIn(buf) {
  if (!buf || !buf.length) return null;
  let best = null;
  let at = Infinity;
  for (const [cc, codec] of Object.entries(CODECS)) {
    for (let i = 0; i + 4 <= buf.length; i++) {
      if (buf[i] === cc.charCodeAt(0) && buf[i + 1] === cc.charCodeAt(1) && buf[i + 2] === cc.charCodeAt(2) && buf[i + 3] === cc.charCodeAt(3)) {
        if (i < at) { at = i; best = codec; }
        break;
      }
    }
  }
  return best || 'other';
}

/** → { codec, faststart } (nulls when the file isn't an MP4 we can read; never throws) */
export async function probeMp4(bucket, key, size) {
  const out = { codec: null, faststart: null };
  try {
    if (!bucket || !size) return out;
    let off = 0;
    let seenMdat = false;
    let moov = null;
    for (let i = 0; i < MAX_BOXES && off + 8 <= size; i++) {
      const h = await readRange(bucket, key, off, Math.min(16, size - off));
      if (!h || h.length < 8) break;
      let len = u32(h, 0);
      const type = fourcc(h, 4);
      let hdr = 8;
      if (len === 1) {
        if (h.length < 16) break;
        len = u32(h, 8) * 2 ** 32 + u32(h, 12);
        hdr = 16;
      } else if (len === 0) len = size - off;
      if (len < hdr || !/^[\x20-\x7e]{4}$/.test(type)) break; // not a box → not an MP4
      if (i === 0 && type !== 'ftyp' && type !== 'moov' && type !== 'free' && type !== 'wide') break;
      if (type === 'moov') { moov = { off, len }; out.faststart = !seenMdat; break; }
      if (type === 'mdat') seenMdat = true;
      off += len;
    }
    if (moov) out.codec = codecIn(await readRange(bucket, key, moov.off, Math.min(moov.len, MAX_MOOV_READ, size - moov.off)));
  } catch (e) {
    /* best effort: the upload still counts */
  }
  return out;
}

/** Mark stale 'uploading' reservations abandoned. → { abandoned, posts } */
export async function sweepAbandonedUploads(env, { olderThanHours = 24, limit = 50, userId = null } = {}) {
  const hours = Math.max(0, Number(olderThanHours) || 0);
  const args = [hours, Math.max(1, Math.min(500, Number(limit) || 50))];
  if (userId) args.push(userId);
  const rows = await q(env, `SELECT uid, user_id, multipart_id FROM video_uploads
    WHERE status = 'uploading' AND created_at <= now() - ($1::int * interval '1 hour') ${userId ? 'AND user_id = $3' : ''}
    ORDER BY created_at LIMIT $2`, args);
  let posts = 0;
  for (const r of rows) {
    if (r.multipart_id && env.MEDIA && typeof env.MEDIA.resumeMultipartUpload === 'function') {
      try { await env.MEDIA.resumeMultipartUpload(`vid/${r.user_id}/${r.uid}.mp4`, r.multipart_id).abort(); } catch (e) { /* already gone */ }
    }
    await q(env, `UPDATE video_uploads SET status = 'abandoned', abandoned_at = now() WHERE uid = $1 AND status = 'uploading'`, [r.uid]);
    const p = await q(env, `UPDATE posts SET video_status = 'error' WHERE video_uid = $1 AND video_status <> 'ready' RETURNING id`, [r.uid]);
    posts += p.length;
  }
  return { abandoned: rows.length, posts };
}

// Run the global sweep at most once per isolate every SWEEP_EVERY_MS, piggy-backing on upload traffic
// (no extra cron trigger needed; scheduled() can also call sweepAbandonedUploads directly).
const SWEEP_EVERY_MS = 10 * 60 * 1000;
let lastSweep = 0;
export function maybeSweep(c) {
  const now = Date.now();
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  const job = sweepAbandonedUploads(c.env).catch(() => {});
  try { if (c.executionCtx && c.executionCtx.waitUntil) c.executionCtx.waitUntil(job); } catch (e) { /* tests: no execution context */ }
}
