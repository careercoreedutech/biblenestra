// BOOKS (brief 18): the public-domain Books library and its reader.
//   GET    /books/catalogue?section=&q=           sections + books (no text)
//   GET    /books/:id                             one book + its chapter list + my progress
//   GET    /books/:id/chapters/:n                 one chapter's paragraphs (n is the index from the chapter list)
//   GET    /books/:id/search?q=                   find text inside the book
//   GET    /books/:id/progress                    my place in the book
//   PUT    /books/:id/progress                    {chapter, paragraph}
//   GET    /books/:id/bookmarks                   my bookmarks
//   POST   /books/:id/bookmarks                   {chapter, paragraph, label?}
//   DELETE /books/bookmarks/:bookmarkId
// Audio books (brief 18.1) use the existing library items (kind audio, with chapters) — see routes/library.js.
import { Hono } from 'hono';
import { one, q } from '../lib/db.js';
import { ApiError, bad, body, int, notFound, str, uuidParam } from '../lib/http.js';
import { BOOK_SECTIONS, bookById, bookShape, loadBookText, searchBookText, searchCatalogue } from '../lib/books.js';

export const books = new Hono();

const requireBook = (c) => {
  const b = bookById(c.req.param('id'));
  if (!b) throw notFound('Book not found');
  return b;
};

async function textOf(c, b) {
  try {
    return await loadBookText(c.env, b);
  } catch (e) {
    throw new ApiError(503, 'BOOK_UNAVAILABLE', (e && e.message) || 'The book is unavailable right now. Try again later.');
  }
}

books.get('/books/catalogue', (c) => {
  const section = c.req.query('section') || null;
  if (section && !BOOK_SECTIONS.some((s) => s.id === section)) throw bad('Unknown section', 'BAD_SECTION');
  const items = searchCatalogue(c.req.query('q') || '', section).map(bookShape);
  return c.json({ sections: BOOK_SECTIONS, items, featured: items.filter((b) => b.featured) });
});

books.get('/books/bookmarks/mine', async (c) => {
  const rows = await q(c.env, 'SELECT * FROM book_bookmarks WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200', [c.get('user').id]);
  return c.json({ items: rows.map((r) => ({ id: r.id, bookId: r.book_id, chapter: r.chapter, paragraph: r.paragraph, label: r.label || '', createdAt: new Date(r.created_at).toISOString() })) });
});

books.get('/books/:id', async (c) => {
  const b = requireBook(c);
  const me = c.get('user');
  const doc = await textOf(c, b);
  const p = await one(c.env, 'SELECT chapter, paragraph, updated_at FROM book_progress WHERE user_id = $1 AND book_id = $2', [me.id, b.id]);
  const total = doc.chapters.length;
  return c.json({
    ...bookShape(b),
    chapters: doc.chapters.map((ch, i) => ({ index: i, title: ch.title, paragraphs: ch.paragraphs.length })),
    progress: p ? { chapter: p.chapter, paragraph: p.paragraph, percent: total ? Math.round(((p.chapter + 1) / total) * 100) : 0, updatedAt: new Date(p.updated_at).toISOString() } : null,
  });
});

books.get('/books/:id/chapters/:n', async (c) => {
  const b = requireBook(c);
  const n = Number(c.req.param('n'));
  const doc = await textOf(c, b);
  if (!Number.isInteger(n) || n < 0 || n >= doc.chapters.length) throw notFound('Chapter not found');
  const ch = doc.chapters[n];
  return c.json({
    index: n,
    total: doc.chapters.length,
    title: ch.title,
    paragraphs: ch.paragraphs,
    prev: n > 0 ? n - 1 : null,
    next: n < doc.chapters.length - 1 ? n + 1 : null,
  });
});

books.get('/books/:id/search', async (c) => {
  const b = requireBook(c);
  const doc = await textOf(c, b);
  const hits = searchBookText(doc.chapters, c.req.query('q') || '');
  return c.json({ items: hits, truncated: hits.length >= 60 });
});

books.get('/books/:id/progress', async (c) => {
  const b = requireBook(c);
  const p = await one(c.env, 'SELECT chapter, paragraph, updated_at FROM book_progress WHERE user_id = $1 AND book_id = $2', [c.get('user').id, b.id]);
  return c.json({ progress: p ? { chapter: p.chapter, paragraph: p.paragraph, updatedAt: new Date(p.updated_at).toISOString() } : null });
});

books.put('/books/:id/progress', async (c) => {
  const b = requireBook(c);
  const me = c.get('user');
  const data = await body(c);
  const chapter = int(data.chapter, { min: 0, max: 100000, field: 'chapter' });
  const paragraph = int(data.paragraph == null ? 0 : data.paragraph, { min: 0, max: 1000000, field: 'paragraph' });
  await q(c.env, `INSERT INTO book_progress (user_id, book_id, chapter, paragraph, updated_at) VALUES ($1,$2,$3,$4, now())
    ON CONFLICT (user_id, book_id) DO UPDATE SET chapter = EXCLUDED.chapter, paragraph = EXCLUDED.paragraph, updated_at = now()`,
  [me.id, b.id, chapter, paragraph]);
  return c.json({ ok: true, chapter, paragraph });
});

books.get('/books/:id/bookmarks', async (c) => {
  const b = requireBook(c);
  const rows = await q(c.env, 'SELECT * FROM book_bookmarks WHERE user_id = $1 AND book_id = $2 ORDER BY chapter, paragraph', [c.get('user').id, b.id]);
  return c.json({ items: rows.map((r) => ({ id: r.id, bookId: r.book_id, chapter: r.chapter, paragraph: r.paragraph, label: r.label || '', createdAt: new Date(r.created_at).toISOString() })) });
});

books.post('/books/:id/bookmarks', async (c) => {
  const b = requireBook(c);
  const me = c.get('user');
  const data = await body(c);
  const chapter = int(data.chapter, { min: 0, max: 100000, field: 'chapter' });
  const paragraph = int(data.paragraph == null ? 0 : data.paragraph, { min: 0, max: 1000000, field: 'paragraph' });
  const label = str(data.label, { max: 120, optional: true, field: 'Label' }) || null;
  const count = await one(c.env, 'SELECT count(*)::int AS n FROM book_bookmarks WHERE user_id = $1', [me.id]);
  if (count && count.n >= 300) throw bad('You can keep up to 300 bookmarks. Remove some first.', 'LIMIT');
  const row = await one(c.env, 'INSERT INTO book_bookmarks (user_id, book_id, chapter, paragraph, label) VALUES ($1,$2,$3,$4,$5) RETURNING *', [me.id, b.id, chapter, paragraph, label]);
  return c.json({ id: row.id, bookId: row.book_id, chapter: row.chapter, paragraph: row.paragraph, label: row.label || '', createdAt: new Date(row.created_at).toISOString() }, 201);
});

books.delete('/books/bookmarks/:bookmarkId', async (c) => {
  const id = uuidParam(c, 'bookmarkId');
  const res = await q(c.env, 'DELETE FROM book_bookmarks WHERE id = $1 AND user_id = $2 RETURNING id', [id, c.get('user').id]);
  if (!res || !res.length) throw notFound('Bookmark not found');
  return c.json({ ok: true });
});
