// LEARN CMS — courses (ordered lessons with a short in-app excerpt + "Read full lesson" blog link) and
// devotionals (cover, date, excerpt, blog link). Admins write them from the "Courses & Devotionals" tab
// (lib/learnAdminPage.js); the app reads them under Learn › Courses / Devotionals and keeps the reader's
// progress on the server (learn_enrollments, learn_lesson_progress, learn_devotional_reads).
import { bad } from './http.js';
import { mediaUrl } from './shape.js';

export const IMAGE_KEY_RE = /^img\/[\w-]+\/[\w-]+\.(jpg|png|webp|heic|heif)$/;
export const LEVELS = ['Beginner', 'Intermediate', 'Advanced', 'All levels'];
export const FORMATS = { self_study: 'Self-study', live_cohort: 'Live cohort' };
// Icon names the app can draw in the course tile (src/components/Icons.js)
export const COURSE_ICONS = ['book', 'cross', 'star', 'sparkles', 'users', 'globe', 'prayer', 'church', 'mic', 'heart', 'sun', 'quiz', 'calendar', 'headphones'];

const isoDay = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));
const iso = (d) => (d ? new Date(d).toISOString() : null);
export const fileUrl = (env, origin, key) => (!key ? null : /^https:\/\//.test(key) ? key : mediaUrl(env, origin, key));

/** An uploaded image key (POST /uploads/image) or an https image URL; null clears; undefined keeps `cur`. */
export function imageRef(v, cur, field = 'image') {
  if (v === undefined) return cur === undefined ? null : cur;
  if (v === null || v === '') return null;
  const s = String(v).trim();
  if (IMAGE_KEY_RE.test(s)) return s;
  if (/^https:\/\/[^\s]{4,600}$/.test(s)) return s;
  throw bad(`Upload the ${field} or paste an https image link`, 'BAD_IMAGE');
}

/** The blog post link: http(s) only, ≤ 600 chars. */
export function blogUrl(v, { optional = false } = {}) {
  const s = String(v || '').trim();
  if (!s) { if (optional) return null; throw bad('Paste the link to the full post on your blog', 'BAD_URL'); }
  let u;
  try { u = new URL(s); } catch (e) { throw bad('That blog link isn’t a valid web address', 'BAD_URL'); }
  if (!['http:', 'https:'].includes(u.protocol) || s.length > 600) throw bad('Use an http(s) link for the blog post', 'BAD_URL');
  return u.toString();
}

/** Excerpt: plain text, paragraphs separated by blank lines (no HTML is ever rendered). */
export function excerptParagraphs(text) {
  return String(text || '').replace(/\r\n/g, '\n').split(/\n\s*\n/).map((p) => p.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
}

export const lessonShape = (env, origin, r, { full = true } = {}) => ({
  id: r.id,
  courseId: r.course_id,
  position: r.position,
  title: r.title,
  ...(full ? {
    excerpt: r.excerpt || '',
    paragraphs: excerptParagraphs(r.excerpt),
    imageUrl: fileUrl(env, origin, r.image_key),
    imageKey: r.image_key || null,
    blogUrl: r.blog_url,
    readMinutes: r.read_minutes || null,
  } : {}),
});

export const courseShape = (env, origin, r) => ({
  id: r.id,
  title: r.title,
  provider: r.provider,
  icon: r.icon || 'book',
  coverUrl: fileUrl(env, origin, r.cover_key),
  coverKey: r.cover_key || null,
  level: r.level,
  format: r.format,
  formatLabel: FORMATS[r.format] || r.format,
  duration: r.duration || '',
  certificate: !!r.certificate,
  summary: r.summary || '',
  published: !!r.published,
  sortOrder: r.sort_order || 0,
  lessonCount: Number(r.lesson_count || 0),
  updatedAt: iso(r.updated_at),
});

/** Progress of one user in one course, from the completed lesson ids (in lesson order). */
export function courseProgress(lessons, enrolledAt, completedIds) {
  const set = new Set(completedIds || []);
  const done = lessons.filter((l) => set.has(l.id));
  const next = lessons.find((l) => !set.has(l.id)) || null;
  return {
    enrolled: !!enrolledAt || done.length > 0,
    enrolledAt: iso(enrolledAt),
    done: done.length,
    total: lessons.length,
    completed: done.map((l) => l.id),
    complete: lessons.length > 0 && done.length >= lessons.length,
    nextLessonId: next ? next.id : null,
    nextPosition: next ? next.position : null,
  };
}

export const devotionalShape = (env, origin, r) => ({
  id: r.id,
  title: r.title,
  author: r.author || '',
  coverUrl: fileUrl(env, origin, r.cover_key),
  coverKey: r.cover_key || null,
  date: isoDay(r.publish_on_s || r.publish_on),
  excerpt: r.excerpt || '',
  paragraphs: excerptParagraphs(r.excerpt),
  blogUrl: r.blog_url,
  published: !!r.published,
  ...(r.read_at !== undefined ? { read: !!r.read_at, readAt: iso(r.read_at) } : {}),
});
