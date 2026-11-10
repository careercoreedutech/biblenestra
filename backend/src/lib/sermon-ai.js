// Sermon recordings → transcript → notes, with Cloudflare Workers AI (binding `AI`).
//
// The work runs in the background (c.executionCtx.waitUntil) in small, resumable steps: one audio chunk or
// one summary call per step, saved to the row's `work` column after each step. A "lease" stops two workers
// processing the same recording; when a worker is cut off (waitUntil has a ~30 s budget after the response)
// the next GET /recordings… picks the work up again from the saved cursor.
//
// No AI binding:  AUTH_DEV_MODE=true → a deterministic FAKE transcriber/notes writer (local dev + tests);
//                 otherwise → the recording is marked `error` with a clear "not configured" message.
import { one, q } from './db.js';
import { detectScriptures, normaliseRef } from './scripture.js';

export const WHISPER_MODEL = '@cf/openai/whisper-large-v3-turbo';
// '@cf/meta/llama-3.1-8b-instruct' was retired from Workers AI; the fp8 build is the same model.
export const NOTES_MODEL_DEFAULT = '@cf/meta/llama-3.1-8b-instruct-fp8';
// Tried in order if the configured model is retired or unknown, so notes keep working.
const NOTES_MODEL_FALLBACKS = ['@cf/meta/llama-3.1-8b-instruct-fp8', '@cf/meta/llama-3.3-70b-instruct-fp8-fast'];
const isModelMissing = (e) => /no such model|model not found|not found|unknown model|deprecated|5007|invalid model/i.test(String((e && e.message) || e || ''));
export const AI_LABEL = 'AI-generated — check against the recording';
export const BUSY_MESSAGE = 'Transcription is busy today — it will finish later';
export const NOT_CONFIGURED = 'Transcription isn’t set up on this server yet (Workers AI binding "AI" is missing). Your audio is safe.';

const CHUNK_BYTES = 4 * 1024 * 1024; // ADTS/MP3 pieces (~4 MB ≈ 15+ min at the app's 32 kbps)
const SINGLE_MAX = 25 * 1024 * 1024; // container formats (m4a / webm / ogg) are sent whole
const WORDS_PER_PART = 2200;          // transcript parts for the summary model's context window
const LEASE_SECONDS = 60;
const BUDGET_MS = 24000;              // stay inside waitUntil's post-response budget
const MAX_ATTEMPTS = 3;
const BUSY_BACKOFF_MIN = 30;

export function aiMode(env) {
  if (env.AI && typeof env.AI.run === 'function') return 'real';
  if (env.AUTH_DEV_MODE === 'true') return 'fake';
  return null;
}

export const isQuotaError = (e) => {
  const m = String((e && (e.message || e)) || '');
  return /\b(3036|3040|429)\b|quota|rate.?limit|daily free allocation|neurons|capacity|too many requests/i.test(m);
};

// ---------- audio helpers ----------
const SAMPLE_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

function skipId3(buf) {
  if (buf.length > 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    return 10 + size;
  }
  return 0;
}

/** Walk whole ADTS frames in `buf` from `start` up to `limit` bytes → { bytes, seconds } */
export function adtsSpan(buf, start, limit) {
  let p = start;
  let seconds = 0;
  while (p + 7 <= buf.length) {
    if (buf[p] !== 0xff || (buf[p + 1] & 0xf6) !== 0xf0) break;
    const len = ((buf[p + 3] & 0x03) << 11) | (buf[p + 4] << 3) | ((buf[p + 5] & 0xe0) >> 5);
    const rate = SAMPLE_RATES[(buf[p + 2] >> 2) & 0x0f] || 44100;
    const blocks = (buf[p + 6] & 0x03) + 1;
    if (len < 7 || p + len > buf.length || p - start + len > limit) break;
    seconds += (1024 * blocks) / rate;
    p += len;
  }
  return { bytes: p - start, seconds };
}

function lastMp3Sync(buf, from) {
  for (let i = buf.length - 4; i > from; i--) {
    if (buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0 && (buf[i + 2] & 0xf0) !== 0xf0) return i;
  }
  return buf.length;
}

const kindOf = (mime) => (/aac/.test(mime || '') ? 'adts' : /mpeg|mp3/.test(mime || '') ? 'mp3' : 'container');

function toBase64(u8) {
  let s = '';
  const step = 0x8000;
  for (let i = 0; i < u8.length; i += step) s += String.fromCharCode.apply(null, u8.subarray(i, i + step));
  return btoa(s);
}

async function readRange(env, key, offset, length) {
  const obj = await env.MEDIA.get(key, { range: { offset, length } });
  if (!obj) throw new Error('Audio file is missing from storage');
  const body = obj.body;
  if (body instanceof Uint8Array) return body;
  if (body && typeof body.arrayBuffer === 'function') return new Uint8Array(await body.arrayBuffer());
  return new Uint8Array(await new Response(body).arrayBuffer());
}

// ---------- fake (local dev) ----------
const FAKE_LINES = [
  'Good morning church, let us open our Bibles together this morning.',
  'Our text today is John 3:16, for God so loved the world that he gave his only begotten Son.',
  'Notice first that love is the starting point. God did not wait for us to become lovely before he loved us.',
  'The first point is this: God’s love is personal. It is not love for a crowd, it is love for you.',
  'Paul says in Romans 8:28 that all things work together for good to them that love God.',
  'That does not mean all things are good. It means God is at work in all things.',
  'The second point: God’s love is costly. He gave his Son, and a gift that costs nothing is worth little.',
  '“Grace is free to you because it was expensive to him.” Write that down somewhere you will see it this week.',
  'Turn with me to Psalm 23. The Lord is my shepherd, I shall not want.',
  'A shepherd walks ahead of the sheep. Whatever valley you face this week, he has already been there.',
  'The third point: God’s love calls for a response. Believing is trusting your whole weight on him.',
  'In Philippians 4 verse 6 we are told to be careful for nothing, but in everything by prayer and supplication let your requests be made known.',
  'So this week, turn every worry into a prayer. When anxiety knocks, let prayer answer the door.',
  'Reach out to one person who feels forgotten and tell them that God sees them.',
  '“You are never too far for his love to reach.”',
  'Let us pray. Father, thank you for loving us first. Help us to trust you this week. In Jesus’ name, amen.',
];

function fakeSegments(durationSec) {
  const total = Math.max(FAKE_LINES.length * 4, Number(durationSec) || FAKE_LINES.length * 8);
  const step = total / FAKE_LINES.length;
  return FAKE_LINES.map((text, i) => ({ start: Math.round(i * step * 10) / 10, end: Math.round((i + 1) * step * 10) / 10, text }));
}

function fakeNotes(title, transcript) {
  const sentences = transcript.split(/(?<=[.!?”])\s+/).filter(Boolean);
  return {
    title: title && !/^untitled/i.test(title) ? title : 'Loved First: God’s Personal, Costly Love',
    summary: 'The sermon walks through John 3:16, showing that God’s love is personal, costly and calls for a response of trust. It encourages turning worry into prayer and reaching out to people who feel forgotten.',
    mainPoints: sentences.filter((s) => /point/i.test(s)).map((s) => s.replace(/^The (first|second|third) point( is this)?:\s*/i, '')).slice(0, 5),
    quotes: sentences.filter((s) => /^“/.test(s)).map((s) => s.replace(/[“”]/g, '').replace(/\s*Write that down.*$/, '')).slice(0, 4),
    application: ['Turn every worry into a prayer this week (Philippians 4:6).', 'Reach out to one person who feels forgotten.', 'Read Psalm 23 slowly each morning.'],
    prayer: 'Father, thank you for loving us first and at such a cost. Help us to trust you with our whole weight this week, and to carry your love to someone who feels forgotten. In Jesus’ name, amen.',
    scriptures: [],
  };
}

// ---------- real AI calls ----------
async function whisper(env, base64, prompt) {
  const out = await env.AI.run(WHISPER_MODEL, {
    audio: base64,
    task: 'transcribe',
    vad_filter: true,
    initial_prompt: prompt || 'A Christian sermon. Bible references are written like John 3:16 or Romans 8:28.',
  });
  const segs = Array.isArray(out && out.segments) ? out.segments : [];
  const list = segs.map((s) => ({ start: Number(s.start) || 0, end: Number(s.end) || Number(s.start) || 0, text: String(s.text || '').trim() })).filter((s) => s.text);
  if (!list.length && out && out.text) list.push({ start: 0, end: 0, text: String(out.text).trim() });
  return list;
}

async function chat(env, system, user, maxTokens = 900) {
  const input = {
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    max_tokens: maxTokens,
    temperature: 0.3,
  };
  const models = [...new Set([env.NOTES_MODEL || NOTES_MODEL_DEFAULT, ...NOTES_MODEL_FALLBACKS])];
  let out;
  for (let i = 0; i < models.length; i++) {
    try { out = await env.AI.run(models[i], input); break; } catch (e) {
      if (i < models.length - 1 && isModelMissing(e)) { console.warn('notes model unavailable, trying next', models[i], e && e.message); continue; }
      throw e;
    }
  }
  // Workers AI replies as { response } or, for some models, OpenAI-style { choices: [{ message: { content } }] }
  const choice = out && Array.isArray(out.choices) && out.choices[0] && out.choices[0].message ? out.choices[0].message.content : undefined;
  const r = out && (out.response !== undefined ? out.response : out.result && out.result.response !== undefined ? out.result.response : choice);
  return typeof r === 'string' ? r : r ? JSON.stringify(r) : '';
}

const NOTES_SYSTEM = 'You write faithful sermon notes for a church app. Use only what the preacher said; never invent Bible references or quotes. Reply with one JSON object and nothing else.';
const NOTES_SHAPE = '{"title": string (max 80 chars), "summary": string (2-4 sentences), "mainPoints": string[] (3-7 short points), "scriptures": string[] (Bible references mentioned, e.g. "John 3:16"), "quotes": string[] (up to 4 short memorable sentences quoted exactly), "application": string[] (2-5 practical next steps), "prayer": string (a short closing prayer, 2-4 sentences)}';

function parseJsonLoose(text) {
  if (!text) return null;
  if (typeof text === 'object') return text;
  const s = String(text);
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
}

const strList = (v, n, max = 300) => (Array.isArray(v) ? v : []).map((x) => (typeof x === 'string' ? x : x && (x.text || x.point || x.ref) ? String(x.text || x.point || x.ref) : '')).map((x) => x.trim().slice(0, max)).filter(Boolean).slice(0, n);
const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

export function finishNotes(raw, transcript, fallbackTitle) {
  const n = raw || {};
  const seen = new Set();
  const scriptures = [];
  for (const r of [...detectScriptures(transcript), ...strList(n.scriptures, 20, 60).map(normaliseRef).filter(Boolean)]) {
    if (!seen.has(r.label)) { seen.add(r.label); scriptures.push(r); }
  }
  return {
    title: clip(n.title, 100) || fallbackTitle || 'Sermon notes',
    summary: clip(n.summary, 1200),
    mainPoints: strList(n.mainPoints || n.main_points, 8),
    scriptures: scriptures.slice(0, 20),
    quotes: strList(n.quotes || n.keyQuotes, 5),
    application: strList(n.application || n.nextSteps, 6),
    prayer: clip(n.prayer || n.closingPrayer, 1200),
    label: AI_LABEL,
    generatedAt: new Date().toISOString(),
  };
}

function splitWords(text, size) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const parts = [];
  for (let i = 0; i < words.length; i += size) parts.push(words.slice(i, i + size).join(' '));
  return parts.length ? parts : [''];
}

// ---------- the pipeline ----------
async function save(env, id, patch) {
  const cols = Object.keys(patch);
  const sets = cols.map((k, i) => `${k} = $${i + 2}${['segments', 'notes', 'work'].includes(k) ? '::jsonb' : ''}`);
  const vals = cols.map((k) => (['segments', 'notes', 'work'].includes(k) && patch[k] !== null ? JSON.stringify(patch[k]) : patch[k]));
  return one(env, `UPDATE recordings SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`, [id, ...vals]);
}

async function transcribeStep(env, row, mode) {
  const work = row.work || {};
  const segments = Array.isArray(row.segments) ? row.segments : [];
  if (mode === 'fake') {
    const segs = fakeSegments(row.duration);
    return save(env, row.id, { segments: segs, transcript: segs.map((s) => s.text).join(' '), status: 'summarising', work: { phase: 'notes' }, error: null });
  }
  const size = Number(row.size_bytes) || 0;
  const kind = kindOf(row.mime);
  const chunkBytes = Number(env.TRANSCRIBE_CHUNK_BYTES) || CHUNK_BYTES;
  let offset = Number(work.offset) || 0;
  let piece;
  let seconds = null;
  if (kind === 'container') {
    if (size > SINGLE_MAX) {
      return save(env, row.id, { status: 'error', error: 'This recording is too large to transcribe in one piece. Try recording in shorter parts (under ~60 minutes at normal quality).' });
    }
    piece = await readRange(env, row.r2_key, 0, size);
    offset = 0;
  } else {
    if (offset === 0) {
      const head = await readRange(env, row.r2_key, 0, Math.min(size, 16 * 1024));
      offset = skipId3(head);
    }
    const buf = await readRange(env, row.r2_key, offset, Math.min(chunkBytes, size - offset));
    if (kind === 'adts') {
      const span = adtsSpan(buf, 0, chunkBytes);
      if (span.bytes > 0) { piece = buf.subarray(0, span.bytes); seconds = span.seconds; } else piece = buf;
    } else {
      const cut = offset + buf.length >= size ? buf.length : lastMp3Sync(buf, buf.length >> 1);
      piece = buf.subarray(0, cut);
      if (row.duration && size) seconds = (row.duration * piece.length) / size;
    }
  }
  const base = Number(work.offsetSec) || 0;
  const prev = segments.length ? segments[segments.length - 1].text : '';
  const got = await whisper(env, toBase64(piece), prev ? `A Christian sermon. ${prev.slice(-200)}` : null);
  const shifted = got.map((s) => ({ start: Math.round((s.start + base) * 10) / 10, end: Math.round((s.end + base) * 10) / 10, text: s.text }));
  const all = [...segments, ...shifted];
  const nextOffset = kind === 'container' ? size : offset + piece.length;
  const lastEnd = shifted.length ? shifted[shifted.length - 1].end : base;
  const done = nextOffset >= size || piece.length === 0;
  const transcript = all.map((s) => s.text).join(' ');
  if (done) {
    if (!transcript.trim()) return save(env, row.id, { status: 'error', segments: all, transcript: '', error: 'No speech was found in this recording.' });
    return save(env, row.id, { segments: all, transcript, status: 'summarising', work: { phase: 'notes' }, error: null });
  }
  return save(env, row.id, {
    segments: all, transcript,
    work: { phase: 'transcribe', offset: nextOffset, offsetSec: seconds != null ? base + seconds : lastEnd, progress: Math.min(0.99, nextOffset / size), attempts: 0 },
    error: null,
  });
}

async function summariseStep(env, row, mode) {
  const work = row.work || {};
  const transcript = row.transcript || '';
  if (mode === 'fake') {
    return save(env, row.id, { notes: finishNotes(fakeNotes(row.title, transcript), transcript, row.title), status: 'ready', work: {}, error: null });
  }
  const parts = splitWords(transcript, WORDS_PER_PART);
  const partials = Array.isArray(work.partials) ? work.partials : [];
  if (parts.length > 1 && partials.length < parts.length) {
    const i = partials.length;
    const text = await chat(env, 'You condense one part of a sermon transcript into faithful notes. Use only what was said.',
      `Part ${i + 1} of ${parts.length} of a sermon transcript:\n"""${parts[i]}"""\n\nWrite concise notes: the main points, any Bible references mentioned (exactly as said), up to 3 memorable sentences quoted exactly, and any practical applications.`, 600);
    return save(env, row.id, { work: { phase: 'notes', partials: [...partials, text], attempts: 0 } });
  }
  const source = parts.length > 1 ? `Notes from each part of the sermon, in order:\n${partials.map((p, i) => `--- Part ${i + 1} ---\n${p}`).join('\n')}` : `Sermon transcript:\n"""${parts[0]}"""`;
  const reply = await chat(env, NOTES_SYSTEM, `${source}\n\nReturn sermon notes as JSON with this shape: ${NOTES_SHAPE}`, 1100);
  const parsed = parseJsonLoose(reply) || { summary: String(reply || '').slice(0, 1200) };
  return save(env, row.id, { notes: finishNotes(parsed, transcript, row.title), status: 'ready', work: {}, error: null });
}

/** Process a recording until it is done, an error stops it, or the time budget runs out. */
export async function pump(env, id, budgetMs = BUDGET_MS) {
  const mode = aiMode(env);
  let row = await one(env, `UPDATE recordings SET lease_until = now() + make_interval(secs => $2)
      WHERE id = $1 AND status IN ('transcribing','summarising') AND (lease_until IS NULL OR lease_until < now())
      RETURNING *`, [id, LEASE_SECONDS]);
  if (!row) return null;
  const started = Date.now();
  try {
    if (!mode) {
      return await save(env, id, { status: 'error', error: NOT_CONFIGURED, lease_until: null });
    }
    while (row && (row.status === 'transcribing' || row.status === 'summarising') && Date.now() - started < budgetMs) {
      try {
        row = row.status === 'transcribing' ? await transcribeStep(env, row, mode) : await summariseStep(env, row, mode);
        // keep the lease alive while we work
        await q(env, `UPDATE recordings SET lease_until = now() + make_interval(secs => $2) WHERE id = $1`, [id, LEASE_SECONDS]);
      } catch (e) {
        if (isQuotaError(e)) {
          // Daily free allocation used up / capacity: keep the status, say so kindly, resume later.
          row = await save(env, id, { error: BUSY_MESSAGE, next_attempt_at: new Date(Date.now() + BUSY_BACKOFF_MIN * 60000).toISOString() });
          break;
        }
        const attempts = (Number((row.work || {}).attempts) || 0) + 1;
        console.error('recording pipeline step failed', id, e && e.message);
        if (attempts >= MAX_ATTEMPTS) {
          row = await save(env, id, { status: 'error', error: row.status === 'summarising' ? 'The transcript is ready, but the notes couldn’t be written. Tap retry to try again.' : 'Transcription failed. Your audio is safe — tap retry to try again.', work: { ...(row.work || {}), attempts } });
        } else {
          row = await save(env, id, { work: { ...(row.work || {}), attempts } });
        }
        break;
      }
    }
  } finally {
    await q(env, 'UPDATE recordings SET lease_until = NULL WHERE id = $1', [id]).catch(() => {});
  }
  return row;
}

/** Run `p` after the response (Workers) or just let it run (Node dev server / tests). */
export function background(c, p) {
  const safe = Promise.resolve(p).catch((e) => console.error('background task failed', e && e.message));
  try { c.executionCtx.waitUntil(safe); } catch (e) { /* no ExecutionContext outside Workers */ }
  return safe;
}
