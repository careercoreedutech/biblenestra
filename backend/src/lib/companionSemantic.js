// SCRIPTURE COMPANION: meaning search with Workers AI embeddings (no Vectorize index needed).
//
//   build    Each verse in the pool (companionPool.js: curated index + extra comfort/guidance passages) is embedded
//            ONCE as "label. themes. WEB text. KJV text" and stored in Postgres (companion_verse_vectors), int8-
//            quantised + base64 (~1 KB a verse). buildVectors() is idempotent: a verse is re-embedded only when its
//            document text or the model changes. Run in small batches by the admin endpoint and by the cron.
//   query    semanticScores() embeds the person's message and cosine-ranks it against the vectors, which are held
//            in isolate memory for a few minutes. Returns Map(ref → similarity), or null whenever anything is
//            missing (no AI binding, no vectors yet, model error/timeout) — the caller then ranks exactly as before.
// The verse text used for the document is the real Bible text (Free Use Bible API); the model never writes text.
import { THEMES } from './companionIndex.js';
import { POOL, poolRefs, refThemes } from './companionPool.js';
import { loadChapterText, parseUsfm, refLabel } from './companion.js';
import { q } from './db.js';

export const EMBED_MODEL_DEFAULT = '@cf/baai/bge-base-en-v1.5';
// bge models retrieve best when a short query carries this instruction (documents don't).
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';
export const BUILD_BATCH_DEFAULT = 15; // ≤ ~30 Bible chapter fetches + 1 AI call + 3 DB queries per run (fits the free plan's 50 subrequests)
export const BUILD_BATCH_MAX = 150;
const EMBED_CHUNK = 50; // texts per Workers AI call (the API takes up to 100)
const CACHE_MS = 10 * 60 * 1000;
const EMPTY_CACHE_MS = 2 * 60 * 1000;

export const embedModel = (env) => (env && env.COMPANION_EMBED_MODEL) || EMBED_MODEL_DEFAULT;
const hasAI = (env) => !!(env && env.AI && typeof env.AI.run === 'function');

// FNV-1a — enough to notice that a verse's document text changed
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}

// ---------- vectors ----------
/** unit-normalise → int8 + base64 */
export function packVector(vec) {
  let n = 0;
  for (const x of vec) n += x * x;
  n = Math.sqrt(n) || 1;
  let max = 0;
  for (const x of vec) max = Math.max(max, Math.abs(x / n));
  const scale = max / 127 || 1;
  const bytes = new Uint8Array(vec.length);
  for (let i = 0; i < vec.length; i++) bytes[i] = (Math.round(vec[i] / n / scale) + 256) % 256;
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
/** base64 int8 → Float32Array of unit length */
export function unpackVector(b64) {
  const bin = atob(b64);
  const out = new Float32Array(bin.length);
  let n = 0;
  for (let i = 0; i < bin.length; i++) { const b = bin.charCodeAt(i); out[i] = b > 127 ? b - 256 : b; n += out[i] * out[i]; }
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
}

/** Workers AI embeddings → array of number[] (one per text). Throws on a bad reply. */
export async function embed(env, texts) {
  const out = await env.AI.run(embedModel(env), { text: texts });
  const data = (out && (out.data || (out.result && out.result.data))) || null;
  if (!Array.isArray(data) || data.length !== texts.length || !data.every((v) => Array.isArray(v) || ArrayBuffer.isView(v))) throw new Error('embedding reply had no vectors');
  return data.map((v) => Array.from(v));
}

// ---------- the document embedded for each verse ----------
const WEB_API = 'ENGWEBP'; // World English Bible: modern wording matches how people describe their lives
async function passage(env, api, ref) {
  const p = parseUsfm(ref);
  const verses = await loadChapterText(env, api, p.bookId, p.chapter);
  if (!verses) return '';
  const parts = [];
  for (let v = p.vs; v <= p.ve; v++) parts.push(verses[v - 1]);
  return parts.every(Boolean) ? parts.join(' ') : '';
}
export async function verseDocument(env, ref) {
  const [kjv, web] = await Promise.all([passage(env, 'eng_kjv', ref), passage(env, WEB_API, ref)]);
  if (!kjv && !web) return null;
  const themes = refThemes(ref).map((k) => (THEMES[k] || {}).label).filter(Boolean).join(', ');
  return [`${refLabel(ref)}.`, themes ? `${themes}.` : '', web, kjv].filter(Boolean).join(' ').slice(0, 1800);
}

// ---------- build (admin endpoint + cron) ----------
async function builtRows(env, model) {
  return q(env, 'SELECT ref, doc_hash FROM companion_verse_vectors WHERE model = $1', [model]);
}

export async function vectorStatus(env) {
  const model = embedModel(env);
  const rows = await builtRows(env, model);
  const have = new Set(rows.map((r) => r.ref));
  const total = POOL.size;
  const built = poolRefs().filter((r) => have.has(r)).length;
  return { model, total, built, remaining: total - built, ready: built > 0 };
}

/**
 * Embed up to `limit` verses of the pool that have no vector yet for the current model. Idempotent and resumable:
 * rows are keyed by (ref, model); call again until remaining = 0. `reset: true` first deletes this model's vectors
 * (use after changing the verse documents) — meaning search then falls back to themes until rebuilt.
 * → { model, built, unchanged, failed, total, remaining }
 */
export async function buildVectors(env, { limit = BUILD_BATCH_DEFAULT, reset = false } = {}) {
  if (!hasAI(env)) throw new Error('Workers AI binding "AI" is missing');
  const model = embedModel(env);
  const n = Math.max(1, Math.min(BUILD_BATCH_MAX, Number(limit) || BUILD_BATCH_DEFAULT));
  if (reset) { await q(env, 'DELETE FROM companion_verse_vectors WHERE model = $1', [model]); _clearVectorCache(); }
  const rows = await builtRows(env, model);
  const have = new Map(rows.map((r) => [r.ref, r.doc_hash]));
  const refs = poolRefs();
  const todo = refs.filter((r) => !have.has(r));
  const batch = todo.slice(0, n);
  const docs = await Promise.all(batch.map(async (ref) => ({ ref, doc: await verseDocument(env, ref) })));
  const ok = docs.filter((d) => d.doc);
  const fresh = ok.filter((d) => have.get(d.ref) !== hash(`${model}|${d.doc}`));
  let built = 0;
  for (let i = 0; i < fresh.length; i += EMBED_CHUNK) {
    const chunk = fresh.slice(i, i + EMBED_CHUNK);
    const vecs = await embed(env, chunk.map((d) => d.doc));
    const params = [];
    const values = chunk.map((d, j) => {
      params.push(d.ref, model, vecs[j].length, hash(`${model}|${d.doc}`), packVector(vecs[j]));
      const b = j * 5;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, now())`;
    });
    await q(env, `INSERT INTO companion_verse_vectors (ref, model, dims, doc_hash, vec, updated_at) VALUES ${values.join(', ')}
      ON CONFLICT (ref, model) DO UPDATE SET dims = EXCLUDED.dims, doc_hash = EXCLUDED.doc_hash, vec = EXCLUDED.vec, updated_at = now()`, params);
    built += chunk.length;
  }
  if (built) _clearVectorCache();
  const nowHave = new Set([...have.keys(), ...fresh.map((d) => d.ref)]);
  return {
    model,
    built,
    unchanged: ok.length - fresh.length,
    failed: batch.filter((r) => !ok.some((d) => d.ref === r)),
    total: refs.length,
    remaining: refs.filter((r) => !nowHave.has(r)).length,
  };
}

/** Cron: a small batch while anything is missing; a single cheap query once everything is built. */
export async function companionVectorsCron(env) {
  if (!hasAI(env)) return null;
  const s = await vectorStatus(env);
  if (!s.remaining) return s;
  return buildVectors(env, { limit: BUILD_BATCH_DEFAULT });
}

// ---------- query ----------
let mem = null; // { model, at, items: [{ ref, vec: Float32Array }], dims }
export function _clearVectorCache() { mem = null; }

async function loadVectors(env, model) {
  const now = Date.now();
  if (mem && mem.model === model && now - mem.at < (mem.items.length ? CACHE_MS : EMPTY_CACHE_MS)) return mem;
  const rows = await q(env, 'SELECT ref, dims, vec FROM companion_verse_vectors WHERE model = $1', [model]);
  const items = rows.filter((r) => POOL.has(r.ref)).map((r) => ({ ref: r.ref, vec: unpackVector(r.vec) })).filter((x) => x.vec.length);
  const dims = items.length ? items[0].vec.length : 0;
  mem = { model, at: now, dims, items: items.filter((x) => x.vec.length === dims) };
  return mem;
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

/** Map(ref → cosine similarity) for the person's message, or null (caller falls back to theme ranking). Never throws. */
export async function semanticScores(env, message, { timeoutMs = 2500 } = {}) {
  if (!hasAI(env) || env.COMPANION_SEMANTIC === 'off') return null;
  try {
    const model = embedModel(env);
    const store = await withTimeout(loadVectors(env, model), timeoutMs);
    if (!store.items.length) return null; // not built yet — don't spend an AI call
    const [raw] = await withTimeout(embed(env, [`${QUERY_PREFIX}${String(message).slice(0, 2000)}`]), timeoutMs);
    if (raw.length !== store.dims) return null; // model changed under us; the cron will rebuild
    let n = 0;
    for (const x of raw) n += x * x;
    n = Math.sqrt(n) || 1;
    const qv = Float32Array.from(raw, (x) => x / n);
    const out = new Map();
    for (const { ref, vec } of store.items) {
      let d = 0;
      for (let i = 0; i < qv.length; i++) d += qv[i] * vec[i];
      out.set(ref, d);
    }
    return out;
  } catch (e) {
    console.warn('companion meaning search unavailable, using themes only', e && e.message);
    return null;
  }
}
