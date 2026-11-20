// LEARN CMS — courses + devotionals with "continue reading on our blog"
//   learnApp (signed in):
//     GET    /learn/courses                  → { items: published courses + my progress }
//     GET    /learn/courses/:id              → course + lessons (excerpt, image, blogUrl) + my progress
//     POST   /learn/courses/:id/enroll       → { progress }
//     POST   /learn/lessons/:id/complete     { via: 'blog' | 'button' } → { lessonId, progress }  (enrolls too)
//     DELETE /learn/lessons/:id/complete     → { lessonId, progress }
//     GET    /learn/devotionals              → { items: published devotionals up to today (newest first) + read flag }
//     GET    /learn/devotionals/:id          → devotional
//     POST   /learn/devotionals/:id/read     { via } → devotional
//   adminLearn (admins only): /admin/api/learn/* — courses, ordered lessons, devotionals.
//   Admin tab "Courses & Devotionals": lib/learnAdminPage.js
import { Hono } from 'hono';
import { one, q } from '../lib/db.js';
import { bad, body, int, notFound, str, today, uuidParam } from '../lib/http.js';
import {
  COURSE_ICONS, FORMATS, LEVELS, blogUrl, courseProgress, courseShape, devotionalShape, imageRef, lessonShape,
} from '../lib/learn.js';
import { LEARN_ADMIN_SCRIPT } from '../lib/learnAdminPage.js';
import { audit, registerAdminScript, requireAdmin } from './admin.js';

registerAdminScript(LEARN_ADMIN_SCRIPT);

const origin = (c) => new URL(c.req.url).origin;
const COURSE_COLS = `c.*, (SELECT count(*)::int FROM learn_lessons l WHERE l.course_id = c.id) AS lesson_count`;
const DEV_COLS = `d.*, to_char(d.publish_on, 'YYYY-MM-DD') AS publish_on_s`;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const via = (v) => (v === 'blog' ? 'blog' : 'button');

async function lessonsOf(env, courseId) {
  return q(env, 'SELECT * FROM learn_lessons WHERE course_id = $1 ORDER BY position, created_at', [courseId]);
}
async function progressFor(env, userId, courseId, lessons) {
  const en = await one(env, 'SELECT enrolled_at FROM learn_enrollments WHERE user_id = $1 AND course_id = $2', [userId, courseId]);
  const done = await q(env, 'SELECT lesson_id FROM learn_lesson_progress WHERE user_id = $1 AND course_id = $2', [userId, courseId]);
  return courseProgress(lessons, en ? en.enrolled_at : null, done.map((d) => d.lesson_id));
}
async function publishedCourse(env, id) {
  const row = await one(env, `SELECT ${COURSE_COLS} FROM learn_courses c WHERE c.id = $1 AND c.published`, [id]);
  if (!row) throw notFound('Course not found');
  return row;
}
async function renumber(env, courseId) {
  await q(env, `UPDATE learn_lessons l SET position = r.n FROM (
      SELECT id, row_number() OVER (ORDER BY position, created_at) AS n FROM learn_lessons WHERE course_id = $1
    ) r WHERE l.id = r.id AND l.position <> r.n`, [courseId]);
}

// ---------- app ----------
export const learnApp = new Hono();

learnApp.get('/learn/courses', async (c) => {
  const me = c.get('user');
  const rows = await q(c.env, `SELECT ${COURSE_COLS} FROM learn_courses c WHERE c.published ORDER BY c.sort_order, c.created_at DESC LIMIT 200`);
  if (!rows.length) return c.json({ items: [] });
  const ids = rows.map((r) => r.id);
  const lessons = await q(c.env, 'SELECT id, course_id, position, title FROM learn_lessons WHERE course_id = ANY($1::uuid[]) ORDER BY position, created_at', [ids]);
  const ens = await q(c.env, 'SELECT course_id, enrolled_at FROM learn_enrollments WHERE user_id = $1 AND course_id = ANY($2::uuid[])', [me.id, ids]);
  const done = await q(c.env, 'SELECT course_id, lesson_id FROM learn_lesson_progress WHERE user_id = $1 AND course_id = ANY($2::uuid[])', [me.id, ids]);
  const items = rows.map((r) => {
    const ls = lessons.filter((l) => l.course_id === r.id);
    const en = ens.find((e) => e.course_id === r.id);
    return {
      ...courseShape(c.env, origin(c), r),
      lessons: ls.map((l) => lessonShape(c.env, origin(c), l, { full: false })),
      progress: courseProgress(ls, en ? en.enrolled_at : null, done.filter((d) => d.course_id === r.id).map((d) => d.lesson_id)),
    };
  });
  return c.json({ items });
});

learnApp.get('/learn/courses/:id', async (c) => {
  const me = c.get('user');
  const row = await publishedCourse(c.env, uuidParam(c));
  const lessons = await lessonsOf(c.env, row.id);
  return c.json({
    ...courseShape(c.env, origin(c), row),
    lessons: lessons.map((l) => lessonShape(c.env, origin(c), l)),
    progress: await progressFor(c.env, me.id, row.id, lessons),
  });
});

learnApp.post('/learn/courses/:id/enroll', async (c) => {
  const me = c.get('user');
  const row = await publishedCourse(c.env, uuidParam(c));
  await q(c.env, 'INSERT INTO learn_enrollments (user_id, course_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [me.id, row.id]);
  return c.json({ progress: await progressFor(c.env, me.id, row.id, await lessonsOf(c.env, row.id)) });
});

async function lessonForUser(c) {
  const id = uuidParam(c);
  const lesson = await one(c.env, `SELECT l.* FROM learn_lessons l JOIN learn_courses c ON c.id = l.course_id WHERE l.id = $1 AND c.published`, [id]);
  if (!lesson) throw notFound('Lesson not found');
  return lesson;
}

learnApp.post('/learn/lessons/:id/complete', async (c) => {
  const me = c.get('user');
  const lesson = await lessonForUser(c);
  let b = {};
  try { b = (await c.req.json()) || {}; } catch (e) { b = {}; }
  await q(c.env, 'INSERT INTO learn_enrollments (user_id, course_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [me.id, lesson.course_id]);
  // idempotent: re-opening the blog keeps the first completion
  await q(c.env, `INSERT INTO learn_lesson_progress (user_id, lesson_id, course_id, via) VALUES ($1,$2,$3,$4)
    ON CONFLICT (user_id, lesson_id) DO NOTHING`, [me.id, lesson.id, lesson.course_id, via(b.via)]);
  return c.json({ lessonId: lesson.id, progress: await progressFor(c.env, me.id, lesson.course_id, await lessonsOf(c.env, lesson.course_id)) });
});

learnApp.delete('/learn/lessons/:id/complete', async (c) => {
  const me = c.get('user');
  const lesson = await lessonForUser(c);
  await q(c.env, 'DELETE FROM learn_lesson_progress WHERE user_id = $1 AND lesson_id = $2', [me.id, lesson.id]);
  return c.json({ lessonId: lesson.id, progress: await progressFor(c.env, me.id, lesson.course_id, await lessonsOf(c.env, lesson.course_id)) });
});

learnApp.get('/learn/devotionals', async (c) => {
  const me = c.get('user');
  const day = today(c.req.header('X-TZ-Offset'));
  const rows = await q(c.env, `SELECT ${DEV_COLS}, r.read_at FROM learn_devotionals d
      LEFT JOIN learn_devotional_reads r ON r.devotional_id = d.id AND r.user_id = $1
    WHERE d.published AND d.publish_on <= $2::date ORDER BY d.publish_on DESC, d.created_at DESC LIMIT 100`, [me.id, day]);
  return c.json({ items: rows.map((r) => devotionalShape(c.env, origin(c), r)) });
});

async function devotionalForUser(c) {
  const me = c.get('user');
  const id = uuidParam(c);
  const row = await one(c.env, `SELECT ${DEV_COLS}, r.read_at FROM learn_devotionals d
      LEFT JOIN learn_devotional_reads r ON r.devotional_id = d.id AND r.user_id = $1
    WHERE d.id = $2 AND d.published AND d.publish_on <= $3::date`, [me.id, id, today(c.req.header('X-TZ-Offset'))]);
  if (!row) throw notFound('Devotional not found');
  return row;
}

learnApp.get('/learn/devotionals/:id', async (c) => c.json(devotionalShape(c.env, origin(c), await devotionalForUser(c))));

learnApp.post('/learn/devotionals/:id/read', async (c) => {
  const me = c.get('user');
  const row = await devotionalForUser(c);
  let b = {};
  try { b = (await c.req.json()) || {}; } catch (e) { b = {}; }
  await q(c.env, `INSERT INTO learn_devotional_reads (user_id, devotional_id, via) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [me.id, row.id, via(b.via)]);
  return c.json(devotionalShape(c.env, origin(c), await devotionalForUser(c)));
});

// ---------- admin ----------
export const adminLearn = new Hono();
adminLearn.use('/admin/api/learn', requireAdmin);
adminLearn.use('/admin/api/learn/*', requireAdmin);

function courseFields(b, cur = {}) {
  const has = (k) => b[k] !== undefined;
  const level = has('level') ? str(b.level, { min: 1, max: 40, field: 'level' }) : cur.level || 'Beginner';
  const format = has('format') ? String(b.format) : cur.format || 'self_study';
  if (!FORMATS[format]) throw bad('Format must be self_study or live_cohort', 'BAD_FORMAT');
  const icon = has('icon') ? String(b.icon || 'book') : cur.icon || 'book';
  if (!COURSE_ICONS.includes(icon)) throw bad(`Icon must be one of ${COURSE_ICONS.join(', ')}`, 'BAD_ICON');
  return {
    title: has('title') ? str(b.title, { min: 1, max: 120, field: 'title' }) : cur.title,
    provider: has('provider') ? str(b.provider || '', { max: 80, field: 'provider' }) : cur.provider || '',
    icon,
    coverKey: imageRef(b.coverKey !== undefined ? b.coverKey : b.coverUrl, cur.cover_key, 'cover'),
    level,
    format,
    duration: has('duration') ? str(b.duration || '', { max: 40, field: 'duration' }) : cur.duration || '',
    certificate: has('certificate') ? !!b.certificate : !!cur.certificate,
    summary: has('summary') ? str(b.summary || '', { max: 600, field: 'summary' }) : cur.summary || '',
    published: has('published') ? !!b.published : !!cur.published,
    sortOrder: has('sortOrder') ? int(b.sortOrder, { min: -10000, max: 10000, field: 'sortOrder' }) : cur.sort_order || 0,
  };
}
function lessonFields(b, cur = {}) {
  const has = (k) => b[k] !== undefined;
  return {
    title: has('title') ? str(b.title, { min: 1, max: 140, field: 'title' }) : cur.title,
    excerpt: has('excerpt') ? str(b.excerpt || '', { max: 4000, field: 'excerpt' }) : cur.excerpt || '',
    imageKey: imageRef(b.imageKey !== undefined ? b.imageKey : b.imageUrl, cur.image_key, 'lesson image'),
    blogUrl: has('blogUrl') ? blogUrl(b.blogUrl) : cur.blog_url,
    readMinutes: has('readMinutes') ? (b.readMinutes ? int(b.readMinutes, { min: 1, max: 240, field: 'readMinutes' }) : null) : cur.read_minutes || null,
  };
}

async function adminCourse(env, o, row) {
  const lessons = await lessonsOf(env, row.id);
  const stats = await one(env, `SELECT (SELECT count(*)::int FROM learn_enrollments WHERE course_id = $1) AS enrolled,
    (SELECT count(*)::int FROM (SELECT user_id FROM learn_lesson_progress WHERE course_id = $1 GROUP BY user_id HAVING count(*) >= $2) x) AS finished`, [row.id, Math.max(1, lessons.length)]);
  return { ...courseShape(env, o, row), lessons: lessons.map((l) => lessonShape(env, o, l)), stats: { enrolled: stats.enrolled, finished: lessons.length ? stats.finished : 0 } };
}

adminLearn.get('/admin/api/learn', async (c) => {
  const rows = await q(c.env, `SELECT ${COURSE_COLS} FROM learn_courses c ORDER BY c.sort_order, c.created_at DESC LIMIT 300`);
  const courses = [];
  for (const r of rows) courses.push(await adminCourse(c.env, origin(c), r));
  const devs = await q(c.env, `SELECT ${DEV_COLS}, (SELECT count(*)::int FROM learn_devotional_reads x WHERE x.devotional_id = d.id) AS reads
    FROM learn_devotionals d ORDER BY d.publish_on DESC, d.created_at DESC LIMIT 300`);
  return c.json({
    today: today(0), levels: LEVELS, formats: FORMATS, icons: COURSE_ICONS, courses,
    devotionals: devs.map((r) => ({ ...devotionalShape(c.env, origin(c), r), reads: r.reads })),
  });
});

adminLearn.post('/admin/api/learn/courses', async (c) => {
  const me = c.get('user');
  const f = courseFields(await body(c));
  if (!f.title) throw bad('title is required');
  const row = await one(c.env, `INSERT INTO learn_courses (title, provider, icon, cover_key, level, format, duration, certificate, summary, published, sort_order, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
  [f.title, f.provider, f.icon, f.coverKey, f.level, f.format, f.duration, f.certificate, f.summary, f.published, f.sortOrder, me.id]);
  await audit(c.env, me, 'learn.course.create', 'learn_course', row.id, { title: f.title, published: f.published });
  const full = await one(c.env, `SELECT ${COURSE_COLS} FROM learn_courses c WHERE c.id = $1`, [row.id]);
  return c.json(await adminCourse(c.env, origin(c), full), 201);
});

adminLearn.patch('/admin/api/learn/courses/:id', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const cur = await one(c.env, 'SELECT * FROM learn_courses WHERE id = $1', [id]);
  if (!cur) throw notFound('Course not found');
  const f = courseFields(await body(c), cur);
  await q(c.env, `UPDATE learn_courses SET title=$2, provider=$3, icon=$4, cover_key=$5, level=$6, format=$7, duration=$8, certificate=$9,
      summary=$10, published=$11, sort_order=$12, updated_at=now() WHERE id = $1`,
  [id, f.title, f.provider, f.icon, f.coverKey, f.level, f.format, f.duration, f.certificate, f.summary, f.published, f.sortOrder]);
  await audit(c.env, me, 'learn.course.update', 'learn_course', id, { title: f.title, published: f.published });
  const full = await one(c.env, `SELECT ${COURSE_COLS} FROM learn_courses c WHERE c.id = $1`, [id]);
  return c.json(await adminCourse(c.env, origin(c), full));
});

adminLearn.delete('/admin/api/learn/courses/:id', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const row = await one(c.env, 'DELETE FROM learn_courses WHERE id = $1 RETURNING title', [id]);
  if (!row) throw notFound('Course not found');
  await audit(c.env, me, 'learn.course.delete', 'learn_course', id, { title: row.title });
  return c.json({ ok: true });
});

adminLearn.post('/admin/api/learn/courses/:id/lessons', async (c) => {
  const me = c.get('user');
  const courseId = uuidParam(c);
  const course = await one(c.env, 'SELECT id FROM learn_courses WHERE id = $1', [courseId]);
  if (!course) throw notFound('Course not found');
  const b = await body(c);
  if (b.blogUrl === undefined) b.blogUrl = '';
  const f = lessonFields(b);
  if (!f.title) throw bad('title is required');
  const max = await one(c.env, 'SELECT COALESCE(max(position), 0)::int AS n FROM learn_lessons WHERE course_id = $1', [courseId]);
  let position = max.n + 1;
  if (b.position !== undefined) position = Math.min(position, int(b.position, { min: 1, max: 10000, field: 'position' }));
  if (position <= max.n) await q(c.env, 'UPDATE learn_lessons SET position = position + 1 WHERE course_id = $1 AND position >= $2', [courseId, position]);
  const row = await one(c.env, `INSERT INTO learn_lessons (course_id, position, title, excerpt, image_key, blog_url, read_minutes)
    VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [courseId, position, f.title, f.excerpt, f.imageKey, f.blogUrl, f.readMinutes]);
  await q(c.env, 'UPDATE learn_courses SET updated_at = now() WHERE id = $1', [courseId]);
  await audit(c.env, me, 'learn.lesson.create', 'learn_lesson', row.id, { courseId, title: f.title });
  return c.json(lessonShape(c.env, origin(c), row), 201);
});

adminLearn.patch('/admin/api/learn/lessons/:id', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const cur = await one(c.env, 'SELECT * FROM learn_lessons WHERE id = $1', [id]);
  if (!cur) throw notFound('Lesson not found');
  const f = lessonFields(await body(c), cur);
  const row = await one(c.env, `UPDATE learn_lessons SET title=$2, excerpt=$3, image_key=$4, blog_url=$5, read_minutes=$6, updated_at=now()
    WHERE id = $1 RETURNING *`, [id, f.title, f.excerpt, f.imageKey, f.blogUrl, f.readMinutes]);
  await audit(c.env, me, 'learn.lesson.update', 'learn_lesson', id, { title: f.title });
  return c.json(lessonShape(c.env, origin(c), row));
});

adminLearn.delete('/admin/api/learn/lessons/:id', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const row = await one(c.env, 'DELETE FROM learn_lessons WHERE id = $1 RETURNING course_id, title', [id]);
  if (!row) throw notFound('Lesson not found');
  await renumber(c.env, row.course_id);
  await audit(c.env, me, 'learn.lesson.delete', 'learn_lesson', id, { title: row.title });
  return c.json({ ok: true });
});

// Reorder: { lessonIds: [...] } — every lesson of the course, in the new order
adminLearn.put('/admin/api/learn/courses/:id/order', async (c) => {
  const me = c.get('user');
  const courseId = uuidParam(c);
  const b = await body(c);
  const ids = Array.isArray(b.lessonIds) ? b.lessonIds.map(String) : null;
  const lessons = await lessonsOf(c.env, courseId);
  const have = lessons.map((l) => l.id).sort().join(',');
  if (!ids || new Set(ids).size !== ids.length || ids.slice().sort().join(',') !== have) throw bad('Send every lesson id of the course once, in the new order', 'BAD_ORDER');
  for (let i = 0; i < ids.length; i += 1) await q(c.env, 'UPDATE learn_lessons SET position = $2 WHERE id = $1', [ids[i], i + 1]);
  await audit(c.env, me, 'learn.lesson.reorder', 'learn_course', courseId, { count: ids.length });
  return c.json({ lessons: (await lessonsOf(c.env, courseId)).map((l) => lessonShape(c.env, origin(c), l)) });
});

function devotionalFields(b, cur = {}) {
  const has = (k) => b[k] !== undefined;
  let date = cur.publish_on_s || null;
  if (has('date')) {
    date = String(b.date || '').slice(0, 10);
    if (!DATE_RE.test(date) || Number.isNaN(Date.parse(date))) throw bad('Pick a date like 2026-12-25', 'BAD_DATE');
  }
  return {
    title: has('title') ? str(b.title, { min: 1, max: 120, field: 'title' }) : cur.title,
    author: has('author') ? str(b.author || '', { max: 80, field: 'author' }) : cur.author || '',
    coverKey: imageRef(b.coverKey !== undefined ? b.coverKey : b.coverUrl, cur.cover_key, 'cover'),
    date: date || today(0),
    excerpt: has('excerpt') ? str(b.excerpt || '', { max: 4000, field: 'excerpt' }) : cur.excerpt || '',
    blogUrl: has('blogUrl') ? blogUrl(b.blogUrl) : cur.blog_url,
    published: has('published') ? !!b.published : cur.published !== undefined ? !!cur.published : true,
  };
}

adminLearn.post('/admin/api/learn/devotionals', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  if (b.blogUrl === undefined) b.blogUrl = '';
  const f = devotionalFields(b);
  if (!f.title) throw bad('title is required');
  const row = await one(c.env, `INSERT INTO learn_devotionals (title, author, cover_key, publish_on, excerpt, blog_url, published, created_by)
    VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8) RETURNING *, to_char(publish_on, 'YYYY-MM-DD') AS publish_on_s`,
  [f.title, f.author, f.coverKey, f.date, f.excerpt, f.blogUrl, f.published, me.id]);
  await audit(c.env, me, 'learn.devotional.create', 'learn_devotional', row.id, { title: f.title, date: f.date });
  return c.json(devotionalShape(c.env, origin(c), row), 201);
});

adminLearn.patch('/admin/api/learn/devotionals/:id', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const cur = await one(c.env, `SELECT *, to_char(publish_on, 'YYYY-MM-DD') AS publish_on_s FROM learn_devotionals WHERE id = $1`, [id]);
  if (!cur) throw notFound('Devotional not found');
  const f = devotionalFields(await body(c), cur);
  const row = await one(c.env, `UPDATE learn_devotionals SET title=$2, author=$3, cover_key=$4, publish_on=$5::date, excerpt=$6, blog_url=$7, published=$8, updated_at=now()
    WHERE id = $1 RETURNING *, to_char(publish_on, 'YYYY-MM-DD') AS publish_on_s`, [id, f.title, f.author, f.coverKey, f.date, f.excerpt, f.blogUrl, f.published]);
  await audit(c.env, me, 'learn.devotional.update', 'learn_devotional', id, { title: f.title, published: f.published });
  return c.json(devotionalShape(c.env, origin(c), row));
});

adminLearn.delete('/admin/api/learn/devotionals/:id', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const row = await one(c.env, 'DELETE FROM learn_devotionals WHERE id = $1 RETURNING title', [id]);
  if (!row) throw notFound('Devotional not found');
  await audit(c.env, me, 'learn.devotional.delete', 'learn_devotional', id, { title: row.title });
  return c.json({ ok: true });
});
