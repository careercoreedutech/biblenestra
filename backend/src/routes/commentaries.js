// COMMENTARIES (public): the commentary library and one chapter of one commentary, cached on the server.
//   GET /study/commentaries                         → { items: [{ id, name, author, short, year, about, licence, tradition, books }] }
//   GET /study/commentary/:id/:book/:chapter        → { source, bookId, chapter, entries: [{ verse, text }], cached }
// Public-domain / openly licensed text only (see src/lib/commentaries.js). The first request for a chapter fetches it
// from the Free Use Bible API; later ones are a single DB read. Responses carry a long Cache-Control.
import { Hono } from 'hono';
import { bad, notFound, ApiError } from '../lib/http.js';
import { one } from '../lib/db.js';
import { BOOK_META } from '../lib/exegesis.js';
import { COMMENTARY_SOURCES, SOURCE_BY_ID, covers, fetchCommentaryChapter } from '../lib/commentaries.js';

export const commentariesPublic = new Hono();

commentariesPublic.get('/study/commentaries', (c) => {
  c.header('Cache-Control', 'public, max-age=86400');
  return c.json({ items: COMMENTARY_SOURCES });
});

commentariesPublic.get('/study/commentary/:id/:book/:chapter', async (c) => {
  const src = SOURCE_BY_ID[c.req.param('id')];
  if (!src) throw notFound('Unknown commentary');
  const bookId = String(c.req.param('book') || '').toUpperCase();
  const meta = BOOK_META[bookId];
  if (!meta) throw bad('Unknown book');
  const chapter = Number(c.req.param('chapter'));
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > meta.chapters) throw bad('chapter is out of range');
  const source = { id: src.id, name: src.name, author: src.author, licence: src.licence };
  if (!covers(src, bookId)) return c.json({ source, bookId, chapter, entries: [], cached: true });

  const key = `${src.id}/${bookId}/${chapter}`;
  const row = await one(c.env, 'SELECT entries FROM commentary_cache WHERE cache_key = $1', [key]);
  if (row) {
    one(c.env, 'UPDATE commentary_cache SET hits = hits + 1 WHERE cache_key = $1 RETURNING hits', [key]).catch(() => {});
    c.header('Cache-Control', 'public, max-age=604800');
    return c.json({ source, bookId, chapter, entries: row.entries, cached: true });
  }
  const entries = await fetchCommentaryChapter(c.env, src.id, bookId, chapter);
  if (entries === null) throw new ApiError(502, 'SOURCE_UNAVAILABLE', 'The commentary couldn’t be loaded just now. Please try again.');
  await one(c.env, `INSERT INTO commentary_cache (cache_key, entries) VALUES ($1, $2::jsonb)
      ON CONFLICT (cache_key) DO UPDATE SET entries = EXCLUDED.entries RETURNING cache_key`, [key, JSON.stringify(entries)]);
  c.header('Cache-Control', 'public, max-age=604800');
  return c.json({ source, bookId, chapter, entries, cached: false });
});
