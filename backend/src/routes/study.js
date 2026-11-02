// Bible study synchronization routes (notes, highlights, bookmarks, reading plans)
import { Hono } from 'hono';
import { body, str, int, uuidParam, bad, notFound } from '../lib/http.js';
import { q, one } from '../lib/db.js';

const study = new Hono();

// GET /me/study?since=<iso> — fetch updates since timestamp
study.get('/me/study', async (c) => {
  const me = c.get('user');
  const sinceStr = c.req.query('since');
  const since = sinceStr && !Number.isNaN(Date.parse(sinceStr)) ? new Date(sinceStr).toISOString() : new Date(0).toISOString();

  const [notesRows, highlightsRows, bookmarksRows, plansRows] = await Promise.all([
    q(c.env,
      `SELECT id, book_id, chapter, verse, text, scope, created_at, updated_at
       FROM notes WHERE user_id = $1 AND updated_at >= $2 ORDER BY updated_at ASC`,
      [me.id, since]
    ),
    q(c.env,
      `SELECT id, book_id, chapter, verse, color, created_at, updated_at
       FROM highlights WHERE user_id = $1 AND updated_at >= $2 ORDER BY updated_at ASC`,
      [me.id, since]
    ),
    q(c.env,
      `SELECT id, book_id, chapter, verse, label, folder, created_at, updated_at
       FROM bookmarks WHERE user_id = $1 AND updated_at >= $2 ORDER BY updated_at ASC`,
      [me.id, since]
    ),
    q(c.env,
      `SELECT plan_id, day, done_at
       FROM plan_progress WHERE user_id = $1 AND done_at >= $2 ORDER BY done_at ASC`,
      [me.id, since]
    ),
  ]);

  return c.json({
    syncedAt: new Date().toISOString(),
    notes: notesRows.map((n) => ({
      id: n.id,
      bookId: n.book_id,
      chapter: n.chapter,
      verse: n.verse,
      text: n.text,
      scope: n.scope,
      createdAt: new Date(n.created_at).toISOString(),
      updatedAt: new Date(n.updated_at).toISOString(),
    })),
    highlights: highlightsRows.map((h) => ({
      id: h.id,
      bookId: h.book_id,
      chapter: h.chapter,
      verse: h.verse,
      color: h.color,
      createdAt: new Date(h.created_at).toISOString(),
      updatedAt: new Date(h.updated_at).toISOString(),
    })),
    bookmarks: bookmarksRows.map((b) => ({
      id: b.id,
      bookId: b.book_id,
      chapter: b.chapter,
      verse: b.verse,
      label: b.label,
      folder: b.folder,
      createdAt: new Date(b.created_at).toISOString(),
      updatedAt: new Date(b.updated_at).toISOString(),
    })),
    plans: plansRows.map((p) => ({
      planId: p.plan_id,
      day: p.day,
      doneAt: new Date(p.done_at).toISOString(),
    })),
  });
});

// PUT /me/study/notes — upsert note
study.put('/me/study/notes', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const id = b.id; // optional client-assigned UUID
  const bookId = str(b.bookId, { min: 2, max: 10, field: 'bookId' });
  const chapter = int(b.chapter, { min: 1, field: 'chapter' });
  const verse = b.verse !== undefined && b.verse !== null ? int(b.verse, { min: 1, field: 'verse' }) : null;
  const text = str(b.text, { min: 1, max: 10000, field: 'text' });
  const scope = b.scope === 'Shared' ? 'Shared' : 'Private';

  let row;
  if (id) {
    row = await one(c.env,
      `INSERT INTO notes (id, user_id, book_id, chapter, verse, text, scope, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (id) DO UPDATE SET text = $6, scope = $7, updated_at = now()
       RETURNING *`,
      [id, me.id, bookId, chapter, verse, text, scope]
    );
  } else {
    row = await one(c.env,
      `INSERT INTO notes (user_id, book_id, chapter, verse, text, scope)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [me.id, bookId, chapter, verse, text, scope]
    );
  }

  return c.json({
    id: row.id,
    bookId: row.book_id,
    chapter: row.chapter,
    verse: row.verse,
    text: row.text,
    scope: row.scope,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  });
});

// DELETE /me/study/notes/:id
study.delete('/me/study/notes/:id', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c, 'id');
  await q(c.env, `DELETE FROM notes WHERE id = $1 AND user_id = $2`, [id, me.id]);
  return c.json({ ok: true, id });
});

// PUT /me/study/highlights — upsert highlight
study.put('/me/study/highlights', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const id = b.id; // optional client-assigned UUID
  const bookId = str(b.bookId, { min: 2, max: 10, field: 'bookId' });
  const chapter = int(b.chapter, { min: 1, field: 'chapter' });
  const verse = int(b.verse, { min: 1, field: 'verse' });
  const color = str(b.color || 'yellow', { max: 30, field: 'color' });

  let row;
  if (id) {
    row = await one(c.env,
      `INSERT INTO highlights (id, user_id, book_id, chapter, verse, color, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (user_id, book_id, chapter, verse) DO UPDATE SET color = $6, updated_at = now()
       RETURNING *`,
      [id, me.id, bookId, chapter, verse, color]
    );
  } else {
    row = await one(c.env,
      `INSERT INTO highlights (user_id, book_id, chapter, verse, color)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, book_id, chapter, verse) DO UPDATE SET color = $5, updated_at = now()
       RETURNING *`,
      [me.id, bookId, chapter, verse, color]
    );
  }

  return c.json({
    id: row.id,
    bookId: row.book_id,
    chapter: row.chapter,
    verse: row.verse,
    color: row.color,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  });
});

// DELETE /me/study/highlights/:id
study.delete('/me/study/highlights/:id', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c, 'id');
  await q(c.env, `DELETE FROM highlights WHERE id = $1 AND user_id = $2`, [id, me.id]);
  return c.json({ ok: true, id });
});

// PUT /me/study/bookmarks — upsert bookmark
study.put('/me/study/bookmarks', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const id = b.id;
  const bookId = str(b.bookId, { min: 2, max: 10, field: 'bookId' });
  const chapter = int(b.chapter, { min: 1, field: 'chapter' });
  const verse = b.verse !== undefined && b.verse !== null ? int(b.verse, { min: 1, field: 'verse' }) : null;
  const label = b.label ? str(b.label, { max: 200 }) : null;
  const folder = b.folder ? str(b.folder, { max: 100 }) : null;

  let row;
  if (id) {
    row = await one(c.env,
      `INSERT INTO bookmarks (id, user_id, book_id, chapter, verse, label, folder, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (id) DO UPDATE SET label = $6, folder = $7, updated_at = now()
       RETURNING *`,
      [id, me.id, bookId, chapter, verse, label, folder]
    );
  } else {
    row = await one(c.env,
      `INSERT INTO bookmarks (user_id, book_id, chapter, verse, label, folder)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [me.id, bookId, chapter, verse, label, folder]
    );
  }

  return c.json({
    id: row.id,
    bookId: row.book_id,
    chapter: row.chapter,
    verse: row.verse,
    label: row.label,
    folder: row.folder,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  });
});

// DELETE /me/study/bookmarks/:id
study.delete('/me/study/bookmarks/:id', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c, 'id');
  await q(c.env, `DELETE FROM bookmarks WHERE id = $1 AND user_id = $2`, [id, me.id]);
  return c.json({ ok: true, id });
});

// PUT /me/study/plans — mark plan day done
study.put('/me/study/plans', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const planId = str(b.planId, { min: 1, max: 100, field: 'planId' });
  const day = int(b.day, { min: 1, field: 'day' });
  const done = b.done !== false;

  if (done) {
    await q(c.env,
      `INSERT INTO plan_progress (user_id, plan_id, day, done_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id, plan_id, day) DO UPDATE SET done_at = now()`,
      [me.id, planId, day]
    );
  } else {
    await q(c.env,
      `DELETE FROM plan_progress WHERE user_id = $1 AND plan_id = $2 AND day = $3`,
      [me.id, planId, day]
    );
  }

  return c.json({ ok: true, planId, day, done });
});

export default study;
