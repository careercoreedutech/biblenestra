// EXEGESIS: POST /study/exegesis — one-tap structured exegesis (11 sections), cached per verse range + translation.
//
// Body: { bookId, chapter, verseStart, verseEnd?, translation, text, context?, contextStart?, contextEnd?, part?: 'a'|'b'|'c'|'all' }
//   text     the selected verses in the reader's translation (the app already has them on screen)
//   context  the surrounding passage, for literary context
//   part     the app asks for a, b and c in parallel so sections appear as each finishes; 'all' (default) does all three
// Reply: { ref, passage, sections, parts, cached, model, label, generatedAt }
// No AI binding → 503 NOT_CONFIGURED (local dev can pass devStub: true with AUTH_DEV_MODE=true to get placeholder text).
import { Hono } from 'hono';
import { body, str, int, bad, ApiError } from '../lib/http.js';
import { one } from '../lib/db.js';
import { BOOK_META, PARTS, EXEGESIS_LABEL, NOT_CONFIGURED_MSG, BUSY_MSG, cacheKey, refLabel, generatePart, isQuotaError } from '../lib/exegesis.js';

const exegesis = new Hono();
const DAILY_NEW_LIMIT = 60; // fresh (uncached) parts a user may generate per day

function readRequest(b) {
  const bookId = str(b.bookId, { min: 3, max: 3, field: 'bookId' }).toUpperCase();
  const meta = BOOK_META[bookId];
  if (!meta) throw bad('Unknown book');
  const chapter = int(b.chapter, { min: 1, max: meta.chapters, field: 'chapter' });
  const verseStart = int(b.verseStart, { min: 1, max: 176, field: 'verseStart' });
  const verseEnd = b.verseEnd === undefined || b.verseEnd === null ? verseStart : int(b.verseEnd, { min: verseStart, max: Math.min(176, verseStart + 29), field: 'verseEnd' });
  const translation = str(b.translation || 'KJV', { min: 1, max: 24, field: 'translation' });
  if (!/^[A-Za-z0-9_.-]+$/.test(translation)) throw bad('translation is not valid');
  const text = str(b.text, { min: 1, max: 8000, field: 'text' });
  const context = str(b.context, { max: 12000, field: 'context', optional: true });
  const contextStart = b.contextStart ? int(b.contextStart, { min: 1, max: 176, field: 'contextStart' }) : null;
  const contextEnd = b.contextEnd ? int(b.contextEnd, { min: 1, max: 176, field: 'contextEnd' }) : null;
  return { bookId, chapter, verseStart, verseEnd, translation, text, context, contextStart, contextEnd };
}

exegesis.post('/study/exegesis', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const r = readRequest(b);
  const part = b.part === undefined || b.part === null || b.part === 'all' ? 'all' : String(b.part);
  if (part !== 'all' && !PARTS.includes(part)) throw bad('part must be a, b, c or all');
  const hasAI = !!(c.env.AI && typeof c.env.AI.run === 'function');
  const stub = !hasAI && c.env.AUTH_DEV_MODE === 'true' && b.devStub === true;
  r.stub = stub;
  const key = cacheKey(r);
  const wanted = part === 'all' ? PARTS : [part];
  const label = refLabel(r.bookId, r.chapter, r.verseStart, r.verseEnd);

  let row = await one(c.env, 'SELECT * FROM exegesis_cache WHERE cache_key = $1', [key]);
  const have = (row && row.sections) || {};
  const missing = wanted.filter((p) => !have[p]);

  if (missing.length) {
    if (!hasAI && !stub) throw new ApiError(503, 'NOT_CONFIGURED', NOT_CONFIGURED_MSG);
    const used = await one(c.env, `SELECT count(*)::int AS n FROM exegesis_generations WHERE user_id = $1 AND created_at > now() - interval '1 day'`, [me.id]);
    if (used && used.n + missing.length > DAILY_NEW_LIMIT) throw new ApiError(429, 'LIMIT', 'You’ve reached today’s exegesis limit. Passages already studied still open instantly.');
    let made;
    try {
      made = await Promise.all(missing.map((p) => generatePart(c.env, r, p, { stub })));
    } catch (e) {
      if (isQuotaError(e)) throw new ApiError(503, 'BUSY', BUSY_MSG);
      console.error('exegesis failed', key, e && e.message);
      throw new ApiError(502, 'AI_FAILED', 'The exegesis couldn’t be written just now. Please try again.');
    }
    const patch = Object.fromEntries(made.map((m) => [m.part, m.sections]));
    const model = made[0].model;
    row = await one(c.env, `INSERT INTO exegesis_cache (cache_key, book_id, chapter, verse_start, verse_end, translation, passage_text, sections, model)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
        ON CONFLICT (cache_key) DO UPDATE SET sections = exegesis_cache.sections || EXCLUDED.sections, model = EXCLUDED.model, updated_at = now()
        RETURNING *`,
    [key, r.bookId, r.chapter, r.verseStart, r.verseEnd, r.translation.toUpperCase(), r.text, JSON.stringify(patch), model]);
    for (const m of made) await one(c.env, 'INSERT INTO exegesis_generations (user_id, cache_key, part) VALUES ($1, $2, $3) RETURNING id', [me.id, key, m.part]);
  } else {
    one(c.env, 'UPDATE exegesis_cache SET hits = hits + 1 WHERE cache_key = $1 RETURNING hits', [key]).catch(() => {});
  }

  const sections = {};
  for (const p of wanted) Object.assign(sections, row.sections[p] || {});
  return c.json({
    ref: { bookId: r.bookId, chapter: r.chapter, verseStart: r.verseStart, verseEnd: r.verseEnd, translation: r.translation.toUpperCase(), label },
    passage: { label: `${label} (${r.translation.toUpperCase()})`, text: row.passage_text || r.text },
    sections,
    parts: wanted,
    cached: !missing.length,
    model: row.model,
    label: EXEGESIS_LABEL,
    generatedAt: new Date(row.created_at).toISOString(),
  });
});

export default exegesis;
