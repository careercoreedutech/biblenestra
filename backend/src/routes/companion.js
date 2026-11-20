// SCRIPTURE COMPANION: the user describes their situation → ≥7 validated scriptures with explanations,
// encouragement and a personalised prayer (pipeline in src/lib/companion.js).
//
// The app calls three steps so something useful is on screen within ~1 s (React Native can't read a streamed body):
//   POST /companion/safety   { message, country? }
//        → { crisis: {title, body, lines, emergency, directory} | null, themes, acknowledgement }        (no AI, instant)
//   POST /companion/verses   { message, translation, translationApi?, country? }
//        → { requestId, verses: [{ ref, label, bookId, chapter, verseStart, verseEnd, translation, text, themes }],
//            themes, specifics, summary, crisis, medicalNote }
//   POST /companion/compose  { requestId, message, part: 'x1' | 'x2' | 'p' }   (the app sends the three parts at once)
//        → x1/x2: { explanations: { [ref]: text } }   p: { encouragement, prayer }
// No AI binding → 503 NOT_CONFIGURED for verses/compose (a local AUTH_DEV_MODE server accepts devStub: true and
// then uses keyword themes + placeholder explanations, with real verses).
import { Hono } from 'hono';
import { body, str, bad, isUuid, notFound, ApiError } from '../lib/http.js';
import { one, q } from '../lib/db.js';
import {
  NOT_CONFIGURED_MSG, BUSY_MSG, RECENT_LIMIT, MIN_VERSES, TARGET_VERSES, COMPOSE_PARTS, MEDICAL_NOTE,
  detectCrisis, crisisBlock, keywordThemes, acknowledgement, analyse, rankCandidates, effectiveThemes, resolveVerses, compose, verseKeys, isQuotaError,
} from '../lib/companion.js';

const companion = new Hono();
const DAILY_LIMIT = 40; // fresh companion replies per user per day

const hasAI = (c) => !!(c.env.AI && typeof c.env.AI.run === 'function');
const useStub = (c, b) => !hasAI(c) && c.env.AUTH_DEV_MODE === 'true' && b.devStub === true;

async function countryFor(c, b, me) {
  const fromBody = typeof b.country === 'string' && b.country.trim() ? b.country.trim().slice(0, 60) : null;
  if (fromBody) return fromBody;
  const row = await one(c.env, 'SELECT country FROM users WHERE id = $1', [me.id]).catch(() => null);
  return (row && row.country) || c.req.header('cf-ipcountry') || null;
}

companion.post('/companion/safety', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const message = str(b.message, { min: 2, max: 4000, field: 'message' });
  const flags = detectCrisis(message);
  const themes = keywordThemes(message);
  const country = flags.any ? await countryFor(c, b, me) : null;
  return c.json({
    crisis: crisisBlock(flags, country),
    themes,
    acknowledgement: acknowledgement(flags, themes),
    medicalNote: themes.some((t) => t.theme === 'sickness') ? MEDICAL_NOTE : null,
  });
});

companion.post('/companion/verses', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const message = str(b.message, { min: 2, max: 4000, field: 'message' });
  const translation = str(b.translation || 'KJV', { min: 1, max: 24, field: 'translation' }).toUpperCase();
  const api = str(b.translationApi || (translation === 'KJV' ? 'eng_kjv' : ''), { max: 40, field: 'translationApi' }) || 'eng_kjv';
  if (!/^[A-Za-z0-9_.-]+$/.test(translation) || !/^[A-Za-z0-9_.-]+$/.test(api)) throw bad('translation is not valid');
  const stub = useStub(c, b);
  if (!hasAI(c) && !stub) throw new ApiError(503, 'NOT_CONFIGURED', NOT_CONFIGURED_MSG);

  const used = await one(c.env, `SELECT count(*)::int AS n FROM companion_requests WHERE user_id = $1 AND created_at > now() - interval '1 day'`, [me.id]);
  if (used && used.n >= DAILY_LIMIT) throw new ApiError(429, 'LIMIT', 'You’ve reached today’s Scripture Companion limit. Your earlier replies are still saved on this phone.');

  const flags = detectCrisis(message);
  let analysis;
  try {
    analysis = await analyse(c.env, message, { stub });
  } catch (e) {
    if (isQuotaError(e)) throw new ApiError(503, 'BUSY', BUSY_MSG);
    throw e;
  }
  if (analysis.crisis && !flags.any) flags.selfHarm = flags.any = true; // the model noticed what keywords missed

  const recentRows = await q(c.env, 'SELECT verse_key FROM companion_delivered WHERE user_id = $1 ORDER BY id DESC LIMIT $2', [me.id, RECENT_LIMIT]);
  const recent = new Set(recentRows.map((r) => r.verse_key));
  const random = typeof c.env.__random === 'function' ? c.env.__random : Math.random;
  const candidates = rankCandidates(analysis, recent, { random, crisis: flags });
  analysis.themes = effectiveThemes(analysis.themes, flags);
  const verses = await resolveVerses(c.env, candidates, { api, translation, want: TARGET_VERSES });
  if (verses.length < MIN_VERSES) throw new ApiError(502, 'BIBLE_UNAVAILABLE', 'Scripture couldn’t be loaded just now. Please check your connection and try again.');

  const crisisKinds = ['selfHarm', 'abuse', 'danger'].filter((k) => flags[k]);
  const saved = { themes: analysis.themes, specifics: analysis.specifics, summary: analysis.summary, crisis: flags.any, crisisKinds, model: analysis.model };
  const row = await one(c.env, `INSERT INTO companion_requests (user_id, translation, analysis, verses) VALUES ($1, $2, $3::jsonb, $4::jsonb) RETURNING id`,
    [me.id, translation, JSON.stringify(saved), JSON.stringify(verses)]);
  const keys = verses.flatMap((v) => verseKeys(v.ref));
  for (const k of keys) await q(c.env, 'INSERT INTO companion_delivered (user_id, verse_key) VALUES ($1, $2)', [me.id, k]);
  // keep only the most recent RECENT_LIMIT verses per user
  await q(c.env, `DELETE FROM companion_delivered WHERE user_id = $1 AND id NOT IN (SELECT id FROM companion_delivered WHERE user_id = $1 ORDER BY id DESC LIMIT $2)`, [me.id, RECENT_LIMIT]);

  const country = flags.any ? await countryFor(c, b, me) : null;
  return c.json({
    requestId: row.id,
    verses,
    themes: analysis.themes,
    specifics: analysis.specifics,
    summary: analysis.summary,
    crisis: crisisBlock(flags, country),
    medicalNote: analysis.themes.some((t) => t.theme === 'sickness') ? MEDICAL_NOTE : null,
    model: analysis.model,
  });
});

companion.post('/companion/compose', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  if (!isUuid(b.requestId)) throw bad('requestId is required');
  const part = String(b.part || '');
  if (!COMPOSE_PARTS.includes(part)) throw bad('part must be x1, x2 or p');
  const message = str(b.message, { min: 2, max: 4000, field: 'message' });
  const row = await one(c.env, 'SELECT * FROM companion_requests WHERE id = $1 AND user_id = $2', [b.requestId, me.id]);
  if (!row) throw notFound('That reply has expired — please ask again.');
  if (row.composed && row.composed[part]) return c.json({ part, ...row.composed[part], cached: true });
  const stub = useStub(c, b);
  if (!hasAI(c) && !stub) throw new ApiError(503, 'NOT_CONFIGURED', NOT_CONFIGURED_MSG);
  let made;
  try {
    made = await compose(c.env, part, { message, analysis: row.analysis, verses: row.verses }, { stub });
  } catch (e) {
    if (isQuotaError(e)) throw new ApiError(503, 'BUSY', BUSY_MSG);
    console.error('companion compose failed', part, e && e.message);
    throw new ApiError(502, 'AI_FAILED', 'This part couldn’t be written just now. Please try again.');
  }
  await one(c.env, `UPDATE companion_requests SET composed = composed || $2::jsonb WHERE id = $1 RETURNING id`, [row.id, JSON.stringify({ [part]: made.data })]);
  return c.json({ part, ...made.data, cached: false });
});

export default companion;
