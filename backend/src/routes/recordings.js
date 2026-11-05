// Sermon Studio "Record": private sermon recordings → transcript (Workers AI Whisper) → AI sermon notes.
// Audio lives in R2 under rec/<userId>/<id>.<ext> and is only served to its owner (GET /recordings/:id/audio).
import { Hono } from 'hono';
import { one, q } from '../lib/db.js';
import { ApiError, bad, body, notFound, str, uuidParam } from '../lib/http.js';
import { aiMode, background, pump, BUSY_MESSAGE, NOT_CONFIGURED } from '../lib/sermon-ai.js';

export const RECORDING_RULES = { maxSeconds: 60 * 60, maxBytes: 50 * 1024 * 1024 };
const AUDIO_TYPES = {
  'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/aacp': 'aac', 'audio/x-aac': 'aac',
  'audio/webm': 'webm', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/ogg': 'ogg',
};
const MAX_PER_USER = 200;

const r = new Hono();

const iso = (d) => (d ? new Date(d).toISOString() : null);
function shape(row, { full = false } = {}) {
  const work = row.work || {};
  const out = {
    id: row.id,
    title: row.title,
    speaker: row.speaker,
    passage: row.passage,
    duration: row.duration,
    sizeBytes: row.size_bytes,
    status: row.status,
    error: row.error,
    busy: row.error === BUSY_MESSAGE,
    progress: row.status === 'transcribing' ? Number(work.progress) || 0 : row.status === 'ready' ? 1 : null,
    hasAudio: !!row.r2_key && row.status !== 'uploading',
    audioPath: `/recordings/${row.id}/audio`,
    summary: row.notes ? row.notes.summary || null : null,
    notesTitle: row.notes ? row.notes.title || null : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
  if (full) {
    out.transcript = row.transcript || '';
    out.segments = Array.isArray(row.segments) ? row.segments : [];
    out.notes = row.notes || null;
  }
  return out;
}

async function own(c) {
  const row = await one(c.env, 'SELECT * FROM recordings WHERE id = $1 AND user_id = $2', [uuidParam(c), c.get('user').id]);
  if (!row) throw notFound('Recording not found');
  return row;
}

// Resume background work that stalled (worker cut off, or a quota back-off that has passed).
const STALLED = `status IN ('transcribing','summarising') AND (lease_until IS NULL OR lease_until < now())
  AND (next_attempt_at IS NULL OR next_attempt_at < now())`;
function resume(c, rows) {
  for (const row of rows) background(c, pump(c.env, row.id));
}

// Step 1: create the recording + get an upload URL (the app then PUTs the audio there)
r.post('/recordings', async (c) => {
  const me = c.get('user');
  if (!c.env.MEDIA) throw new ApiError(500, 'STORAGE_NOT_CONFIGURED', 'Media storage (R2 bucket binding MEDIA) is not configured');
  const b = await body(c);
  const title = str(b.title, { max: 200, field: 'title' }) || 'Untitled recording';
  const duration = b.durationSeconds == null ? null : Number(b.durationSeconds);
  if (duration !== null && (!Number.isFinite(duration) || duration < 0)) throw bad('durationSeconds must be a number');
  if (duration !== null && duration > RECORDING_RULES.maxSeconds + 5) throw bad('Recordings can be up to 60 minutes long', 'TOO_LONG');
  if (b.sizeBytes != null && Number(b.sizeBytes) > RECORDING_RULES.maxBytes) throw new ApiError(413, 'TOO_LARGE', 'Recordings must be under 50 MB');
  const count = await one(c.env, 'SELECT COUNT(*)::int AS n FROM recordings WHERE user_id = $1', [me.id]);
  if (count.n >= MAX_PER_USER) throw bad('You have reached the recordings limit — delete some old ones first', 'LIMIT');
  const row = await one(c.env, `INSERT INTO recordings (user_id, title, speaker, passage, duration) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [
    me.id, title, str(b.speaker, { max: 120, optional: true, field: 'speaker' }), str(b.passage, { max: 120, optional: true, field: 'passage' }), duration,
  ]);
  const origin = new URL(c.req.url).origin;
  return c.json({ ...shape(row), method: 'PUT', uploadURL: `${origin}/recordings/${row.id}/upload`, maxBytes: RECORDING_RULES.maxBytes }, 201);
});

// Step 2: the audio itself (Content-Type: audio/m4a | audio/aac | audio/webm …, Content-Length required)
r.put('/recordings/:id/upload', async (c) => {
  const row = await own(c);
  if (row.status !== 'uploading' && row.status !== 'error') throw bad('This recording was already uploaded', 'ALREADY_UPLOADED');
  const type = (c.req.header('Content-Type') || '').split(';')[0].trim().toLowerCase();
  const ext = AUDIO_TYPES[type];
  if (!ext) throw bad('Upload the recording as m4a, aac, webm, mp3 or ogg audio', 'BAD_AUDIO_TYPE');
  const len = Number(c.req.header('Content-Length') || 0);
  if (!len) throw new ApiError(411, 'LENGTH_REQUIRED', 'Content-Length is required');
  if (len > RECORDING_RULES.maxBytes) throw new ApiError(413, 'TOO_LARGE', 'Recordings must be under 50 MB');
  const key = `rec/${row.user_id}/${row.id}.${ext}`;
  await c.env.MEDIA.put(key, c.req.raw.body, { httpMetadata: { contentType: type === 'video/webm' ? 'audio/webm' : type, cacheControl: 'private, max-age=0' } });
  const mode = aiMode(c.env);
  const next = await one(c.env, `UPDATE recordings SET r2_key = $2, mime = $3, size_bytes = $4, status = $5, error = $6,
      segments = '[]'::jsonb, transcript = NULL, notes = NULL, work = '{}'::jsonb, lease_until = NULL, next_attempt_at = NULL, updated_at = now()
      WHERE id = $1 RETURNING *`, [row.id, key, type === 'video/webm' ? 'audio/webm' : type, len, mode ? 'transcribing' : 'error', mode ? null : NOT_CONFIGURED]);
  if (mode) background(c, pump(c.env, row.id));
  return c.json(shape(next));
});

r.get('/recordings', async (c) => {
  const me = c.get('user');
  const rows = await q(c.env, 'SELECT * FROM recordings WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 200', [me.id]);
  const stalled = await q(c.env, `SELECT id FROM recordings WHERE user_id = $1 AND ${STALLED} LIMIT 3`, [me.id]);
  resume(c, stalled);
  return c.json({ items: rows.map((x) => shape(x)), ai: aiMode(c.env) || 'off' });
});

r.get('/recordings/:id', async (c) => {
  const row = await own(c);
  const stalled = await one(c.env, `SELECT id FROM recordings WHERE id = $1 AND ${STALLED}`, [row.id]);
  if (stalled) resume(c, [stalled]);
  return c.json(shape(row, { full: true }));
});

// Owner-only audio with HTTP Range support (seeking)
r.get('/recordings/:id/audio', async (c) => {
  const row = await own(c);
  if (!row.r2_key || !c.env.MEDIA) throw notFound('No audio for this recording');
  const head = await c.env.MEDIA.head(row.r2_key);
  if (!head) throw notFound('No audio for this recording');
  const size = head.size;
  const headers = new Headers({ 'Content-Type': row.mime || head.httpMetadata?.contentType || 'audio/mp4', 'Cache-Control': 'private, no-store', 'Accept-Ranges': 'bytes' });
  const m = /^bytes=(\d*)-(\d*)$/.exec(c.req.header('Range') || '');
  if (m) {
    let start; let end;
    if (m[1] === '') { const n = Number(m[2]); start = Math.max(0, size - n); end = size - 1; } else { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1); }
    if (!(start <= end) || start >= size) { headers.set('Content-Range', `bytes */${size}`); return new Response(null, { status: 416, headers }); }
    const obj = await c.env.MEDIA.get(row.r2_key, { range: { offset: start, length: end - start + 1 } });
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    headers.set('Content-Length', String(end - start + 1));
    return new Response(obj.body, { status: 206, headers });
  }
  const obj = await c.env.MEDIA.get(row.r2_key);
  headers.set('Content-Length', String(size));
  return new Response(obj.body, { status: 200, headers });
});

// Retry transcription / notes now (after an error or a "busy today" back-off)
r.post('/recordings/:id/retry', async (c) => {
  const row = await own(c);
  if (!row.r2_key || row.status === 'uploading') throw bad('Upload the audio first', 'NOT_UPLOADED');
  if (row.status === 'ready') return c.json(shape(row, { full: true }));
  if (!aiMode(c.env)) throw new ApiError(501, 'AI_NOT_CONFIGURED', NOT_CONFIGURED);
  const status = row.transcript && row.transcript.trim() && (row.status === 'summarising' || (row.work || {}).phase === 'notes') ? 'summarising' : 'transcribing';
  const work = { ...(row.work || {}), attempts: 0 };
  const next = await one(c.env, `UPDATE recordings SET status = $2, error = NULL, next_attempt_at = NULL, work = $3::jsonb, updated_at = now()
      WHERE id = $1 RETURNING *`, [row.id, status, JSON.stringify(work)]);
  background(c, pump(c.env, row.id));
  return c.json(shape(next, { full: true }));
});

r.patch('/recordings/:id', async (c) => {
  const row = await own(c);
  const b = await body(c);
  const title = str(b.title, { min: 1, max: 200, field: 'title' });
  const next = await one(c.env, 'UPDATE recordings SET title = $2, updated_at = now() WHERE id = $1 RETURNING *', [row.id, title]);
  return c.json(shape(next));
});

r.delete('/recordings/:id', async (c) => {
  const row = await own(c);
  await q(c.env, 'DELETE FROM recordings WHERE id = $1', [row.id]);
  if (row.r2_key && c.env.MEDIA && typeof c.env.MEDIA.delete === 'function') {
    await c.env.MEDIA.delete(row.r2_key).catch(() => {});
  }
  return c.json({ ok: true });
});

export default r;
