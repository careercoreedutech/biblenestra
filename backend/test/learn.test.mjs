// LEARN CMS: admin creates courses (ordered lessons with excerpt + blog link) and devotionals; readers see only
// published content, enrol, complete lessons (via the blog link or "Mark as complete"), and the progress
// ("x of y lessons", next lesson) is kept per user on the server.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { q } from '../src/lib/db.js';
import { excerptParagraphs, courseProgress } from '../src/lib/learn.js';

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true' };
});
async function call(user, method, path, body) {
  const h = {};
  if (user) h['X-Dev-User'] = user;
  let b;
  if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${path}`, { method, headers: h, body: b }), env);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = text; }
  return { status: res.status, json };
}
const day = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ids = {};
let course; let lessons = [];

test('setup: boss is an admin', async () => {
  for (const u of ['boss', 'ann', 'ben']) ids[u] = (await call(u, 'GET', '/me')).json.id;
  await q(env, `UPDATE users SET role = 'admin' WHERE id = $1`, [ids.boss]);
});

test('helpers: paragraphs split on blank lines; progress counts lessons in order', () => {
  assert.deepEqual(excerptParagraphs('One\nline\n\n  Two  \r\n\r\nThree'), ['One\nline', 'Two', 'Three']);
  const ls = [{ id: 'a', position: 1 }, { id: 'b', position: 2 }, { id: 'c', position: 3 }];
  const p = courseProgress(ls, null, ['b', 'x']);
  assert.equal(p.done, 1); assert.equal(p.total, 3); assert.equal(p.nextLessonId, 'a'); assert.equal(p.enrolled, true); assert.equal(p.complete, false);
});

test('only admins can manage courses', async () => {
  assert.equal((await call('ann', 'GET', '/admin/api/learn')).status, 403);
  assert.equal((await call('ann', 'POST', '/admin/api/learn/courses', { title: 'Nope' })).status, 403);
});

test('admin creates a course (draft) with validation', async () => {
  assert.equal((await call('boss', 'POST', '/admin/api/learn/courses', { title: '' })).status, 400);
  assert.equal((await call('boss', 'POST', '/admin/api/learn/courses', { title: 'X', format: 'weekly' })).json.code, 'BAD_FORMAT');
  assert.equal((await call('boss', 'POST', '/admin/api/learn/courses', { title: 'X', coverKey: 'javascript:alert(1)' })).json.code, 'BAD_IMAGE');
  const r = await call('boss', 'POST', '/admin/api/learn/courses', {
    title: 'Reading the Gospels Well', provider: 'Nairobi Bible Institute', level: 'Beginner', format: 'self_study',
    duration: '4 weeks', certificate: true, icon: 'book', coverKey: 'https://images.example.com/gospels.jpg',
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  course = r.json;
  assert.equal(course.published, false, 'courses start as drafts');
  assert.equal(course.formatLabel, 'Self-study');
  assert.equal(course.certificate, true);
  assert.equal(course.coverUrl, 'https://images.example.com/gospels.jpg');
});

test('admin adds ordered lessons (excerpt + optional image + blog URL) and reorders them', async () => {
  assert.equal((await call('boss', 'POST', `/admin/api/learn/courses/${course.id}/lessons`, { title: 'No link' })).json.code, 'BAD_URL');
  assert.equal((await call('boss', 'POST', `/admin/api/learn/courses/${course.id}/lessons`, { title: 'Bad link', blogUrl: 'ftp://x.org/a' })).json.code, 'BAD_URL');
  for (const [i, t] of ['Why four Gospels?', 'Reading Mark', 'Reading Luke'].entries()) {
    const r = await call('boss', 'POST', `/admin/api/learn/courses/${course.id}/lessons`, {
      title: t, excerpt: `Paragraph one of ${t}.\n\nParagraph two.`, blogUrl: `https://blog.biblenestra.example/gospels/${i + 1}`,
      ...(i === 0 ? { imageKey: 'https://images.example.com/l1.jpg', readMinutes: 6 } : {}),
    });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.position, i + 1);
    lessons.push(r.json);
  }
  assert.deepEqual(lessons[0].paragraphs, ['Paragraph one of Why four Gospels?.', 'Paragraph two.']);
  assert.equal(lessons[0].imageUrl, 'https://images.example.com/l1.jpg');
  // move "Reading Luke" before "Reading Mark"
  const bad = await call('boss', 'PUT', `/admin/api/learn/courses/${course.id}/order`, { lessonIds: [lessons[0].id] });
  assert.equal(bad.json.code, 'BAD_ORDER');
  const r = await call('boss', 'PUT', `/admin/api/learn/courses/${course.id}/order`, { lessonIds: [lessons[0].id, lessons[2].id, lessons[1].id] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.lessons.map((l) => l.title), ['Why four Gospels?', 'Reading Luke', 'Reading Mark']);
  lessons = r.json.lessons;
  const edit = await call('boss', 'PATCH', `/admin/api/learn/lessons/${lessons[1].id}`, { title: 'Reading Luke slowly' });
  assert.equal(edit.json.title, 'Reading Luke slowly');
  assert.equal(edit.json.blogUrl, 'https://blog.biblenestra.example/gospels/3', 'untouched fields are kept');
});

test('drafts are invisible to readers; publishing shows the course under Learn › Courses', async () => {
  assert.deepEqual((await call('ann', 'GET', '/learn/courses')).json.items, []);
  assert.equal((await call('ann', 'GET', `/learn/courses/${course.id}`)).status, 404);
  assert.equal((await call('ann', 'POST', `/learn/lessons/${lessons[0].id}/complete`, {})).status, 404);
  await call('boss', 'PATCH', `/admin/api/learn/courses/${course.id}`, { published: true });
  const list = await call('ann', 'GET', '/learn/courses');
  assert.equal(list.json.items.length, 1);
  const it = list.json.items[0];
  assert.equal(it.provider, 'Nairobi Bible Institute');
  assert.equal(it.lessonCount, 3);
  assert.equal(it.lessons[0].excerpt, undefined, 'the list carries lesson titles only');
  assert.deepEqual({ enrolled: it.progress.enrolled, done: it.progress.done, total: it.progress.total }, { enrolled: false, done: 0, total: 3 });
  assert.equal(it.progress.nextPosition, 1);
});

test('enrol, complete via the blog link and via the button; progress is per user and idempotent', async () => {
  const en = await call('ann', 'POST', `/learn/courses/${course.id}/enroll`);
  assert.equal(en.json.progress.enrolled, true);
  assert.equal(en.json.progress.done, 0);
  const a = await call('ann', 'POST', `/learn/lessons/${lessons[0].id}/complete`, { via: 'blog' });
  assert.equal(a.json.progress.done, 1);
  assert.equal(a.json.progress.nextLessonId, lessons[1].id);
  assert.equal(a.json.progress.nextPosition, 2);
  const again = await call('ann', 'POST', `/learn/lessons/${lessons[0].id}/complete`, { via: 'button' });
  assert.equal(again.json.progress.done, 1, 'opening the blog twice counts once');
  const row = await q(env, 'SELECT via FROM learn_lesson_progress WHERE user_id = $1 AND lesson_id = $2', [ids.ann, lessons[0].id]);
  assert.equal(row[0].via, 'blog', 'first completion is kept');
  await call('ann', 'POST', `/learn/lessons/${lessons[1].id}/complete`, { via: 'button' });
  const done = await call('ann', 'POST', `/learn/lessons/${lessons[2].id}/complete`);
  assert.equal(done.json.progress.done, 3);
  assert.equal(done.json.progress.complete, true);
  assert.equal(done.json.progress.nextLessonId, null);
  const detail = await call('ann', 'GET', `/learn/courses/${course.id}`);
  assert.equal(detail.json.lessons.length, 3);
  assert.equal(detail.json.lessons[0].blogUrl, 'https://blog.biblenestra.example/gospels/1');
  assert.equal(detail.json.progress.done, 3);
  // ben sees his own (empty) progress; completing a lesson enrols him
  const ben = await call('ben', 'GET', '/learn/courses');
  assert.equal(ben.json.items[0].progress.done, 0);
  assert.equal(ben.json.items[0].progress.enrolled, false);
  const b1 = await call('ben', 'POST', `/learn/lessons/${lessons[1].id}/complete`, { via: 'blog' });
  assert.equal(b1.json.progress.enrolled, true);
  assert.equal(b1.json.progress.nextPosition, 1, 'next is the first unread lesson');
  // undo
  const undo = await call('ann', 'DELETE', `/learn/lessons/${lessons[2].id}/complete`);
  assert.equal(undo.json.progress.done, 2);
  const stats = (await call('boss', 'GET', '/admin/api/learn')).json.courses[0].stats;
  assert.deepEqual(stats, { enrolled: 2, finished: 0 });
});

test('deleting a lesson renumbers the rest and drops its progress', async () => {
  assert.equal((await call('boss', 'DELETE', `/admin/api/learn/lessons/${lessons[0].id}`)).status, 200);
  const d = await call('ann', 'GET', `/learn/courses/${course.id}`);
  assert.deepEqual(d.json.lessons.map((l) => l.position), [1, 2]);
  assert.equal(d.json.progress.done, 1);
  assert.equal(d.json.progress.total, 2);
});

test('devotionals: admin CMS, scheduled dates, read flag per user', async () => {
  assert.equal((await call('ann', 'POST', '/admin/api/learn/devotionals', { title: 'x', blogUrl: 'https://a.b/c' })).status, 403);
  assert.equal((await call('boss', 'POST', '/admin/api/learn/devotionals', { title: 'No link' })).json.code, 'BAD_URL');
  const now = await call('boss', 'POST', '/admin/api/learn/devotionals', {
    title: 'Peace That Guards', author: 'Grace Chapel', date: day(0), excerpt: 'Paul writes from prison.\n\nRejoice.', blogUrl: 'https://blog.biblenestra.example/peace', coverKey: 'https://images.example.com/peace.jpg',
  });
  assert.equal(now.status, 201, JSON.stringify(now.json));
  assert.equal(now.json.date, day(0));
  await call('boss', 'POST', '/admin/api/learn/devotionals', { title: 'Tomorrow', date: day(2), blogUrl: 'https://blog.biblenestra.example/t' });
  const hidden = await call('boss', 'POST', '/admin/api/learn/devotionals', { title: 'Hidden', date: day(-1), published: false, blogUrl: 'https://blog.biblenestra.example/h' });
  const list = await call('ann', 'GET', '/learn/devotionals');
  assert.deepEqual(list.json.items.map((d) => d.title), ['Peace That Guards'], 'future and hidden devotionals are not shown');
  assert.equal(list.json.items[0].read, false);
  assert.deepEqual(list.json.items[0].paragraphs, ['Paul writes from prison.', 'Rejoice.']);
  assert.equal((await call('ann', 'GET', `/learn/devotionals/${hidden.json.id}`)).status, 404);
  const r = await call('ann', 'POST', `/learn/devotionals/${now.json.id}/read`, { via: 'blog' });
  assert.equal(r.json.read, true);
  assert.equal((await call('ben', 'GET', '/learn/devotionals')).json.items[0].read, false);
  const e = await call('boss', 'PATCH', `/admin/api/learn/devotionals/${hidden.json.id}`, { published: true });
  assert.equal(e.json.published, true);
  assert.equal((await call('ann', 'GET', '/learn/devotionals')).json.items.length, 2);
  const adm = await call('boss', 'GET', '/admin/api/learn');
  assert.equal(adm.json.devotionals.find((d) => d.id === now.json.id).reads, 1);
});

test('admin page includes the Courses & Devotionals tab', async () => {
  const res = await app.fetch(new Request('http://api.test/admin'), env);
  const html = await res.text();
  assert.match(html, /Courses & Devotionals/);
});

test('deleting a course removes it for readers', async () => {
  assert.equal((await call('boss', 'DELETE', `/admin/api/learn/courses/${course.id}`)).status, 200);
  assert.deepEqual((await call('ann', 'GET', '/learn/courses')).json.items, []);
});
