// MEDIA LIBRARY — platform Audio Library + Christian Books (PDF), personal ("My audio / My books") and
// group (community) uploads, resume positions, reports and the admin dashboard tab.
//
// Public (no sign-in; registered before requireUser):
//   GET  /library/file/<key>[?exp&sig]   stream a file with HTTP Range (206) — open items unsigned, others signed
//   GET  /library/viewer?file=/library/file/…&page=N   pdf.js reader page (used by the app's WebView / iframe)
// Signed in:
//   GET  /library/categories?kind=audio|pdf
//   GET  /library/home?kind=audio|pdf            categories with their first items + featured + recent
//   GET  /library/items?kind&scope=library|mine|user|group&category&q&userId&communityId&cursor&limit
//   GET  /library/items/:id
//   GET  /library/continue?kind                  items with an unfinished resume position
//   GET  /library/my-groups                      communities I belong to (+ whether I may upload there)
//   POST /library/files?kind=audio|pdf           raw body upload → { key, url, sizeBytes, mime }
//   POST /library/items                          create (platform = admins only; group = community owner/admins)
//   PATCH/DELETE /library/items/:id
//   POST /library/items/:id/publish              admins: put a group/personal item into the platform library (or take it out)
//   POST /library/items/:id/report | /play       PUT /library/items/:id/progress
// Admin (/admin/api/library/*): items, categories, reports.
import { Hono } from 'hono';
import { one, q } from '../lib/db.js';
import { ApiError, bad, body, decodeCursor, encodeCursor, forbidden, int, isUuid, notFound, str, uuidParam } from '../lib/http.js';
import { userJson } from '../lib/shape.js';
import {
  AUDIO_TYPES, PDF_TYPES, KINDS, MAX_BYTES, coverUrl, fileUrl, isFileKey, isOpenItem, signKey, slugify, streamObject, verifyKeySig,
} from '../lib/library.js';
import { audit, requireAdmin, registerAdminScript } from './admin.js';
import { LIBRARY_ADMIN_SCRIPT } from '../lib/libraryAdminPage.js';
import { LIBRARY_VIEWER_HTML } from '../lib/libraryViewer.js';

registerAdminScript(LIBRARY_ADMIN_SCRIPT);

const kindParam = (v, fallback = 'audio') => (KINDS.includes(v) ? v : fallback);
const origin = (c) => new URL(c.req.url).origin;
const needBucket = (env) => {
  if (!env.MEDIA) throw new ApiError(500, 'STORAGE_NOT_CONFIGURED', 'Media storage (R2 bucket binding MEDIA) is not configured');
};

const ITEM_SELECT = `
  SELECT m.*, ${userJson('u')} AS owner, cat.name AS category_name, cat.slug AS category_slug,
         co.name AS community_name, p.position AS my_position, p.completed AS my_completed, p.updated_at AS my_progress_at
  FROM media_items m
  JOIN users u ON u.id = m.owner_id
  LEFT JOIN media_categories cat ON cat.id = m.category_id
  LEFT JOIN communities co ON co.id = m.community_id
  LEFT JOIN media_progress p ON p.item_id = m.id AND p.user_id = $1`;

async function memberRole(env, communityId, userId) {
  if (!communityId || !userId) return null;
  const r = await one(env, `SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2 AND status = 'member'`, [communityId, userId]);
  return r ? r.role : null;
}
const canUploadToGroup = (role) => role === 'owner' || role === 'admin';

async function canView(env, me, it) {
  if (me.role === 'admin' || it.owner_id === me.id) return true;
  if (it.status !== 'published') return false;
  if (it.in_library) return true;
  if (it.scope === 'personal') return it.visibility === 'public';
  if (it.scope === 'group') return !!(await memberRole(env, it.community_id, me.id));
  return false;
}
async function canManage(env, me, it) {
  if (me.role === 'admin' || it.owner_id === me.id) return true;
  if (it.scope === 'group') return canUploadToGroup(await memberRole(env, it.community_id, me.id));
  return false;
}

async function shape(c, it, me, { manage } = {}) {
  const o = origin(c);
  return {
    id: it.id,
    kind: it.kind,
    scope: it.scope,
    title: it.title,
    artist: it.artist || '',
    description: it.description || '',
    category: it.category_id ? { id: it.category_id, name: it.category_name, slug: it.category_slug } : null,
    community: it.community_id ? { id: it.community_id, name: it.community_name } : null,
    owner: it.owner || null,
    coverUrl: coverUrl(c.env, o, it.cover_key),
    fileUrl: await fileUrl(c.env, o, it),
    mime: it.mime,
    sizeBytes: it.size_bytes != null ? Number(it.size_bytes) : null,
    durationSec: it.duration_sec,
    pages: it.pages,
    visibility: it.visibility,
    inLibrary: !!it.in_library,
    status: it.status,
    featured: !!it.featured,
    rightsAttested: !!it.rights_attested,
    plays: it.plays,
    createdAt: new Date(it.created_at).toISOString(),
    canEdit: manage !== undefined ? manage : (me ? me.role === 'admin' || it.owner_id === me.id : false),
    canPublish: !!(me && me.role === 'admin'),
    myProgress: it.my_position != null ? { position: Number(it.my_position), completed: !!it.my_completed } : null,
  };
}
const shapeAll = (c, rows, me) => Promise.all(rows.map((r) => shape(c, r, me)));

async function loadItem(c, id) {
  const me = c.get('user');
  const it = await one(c.env, `${ITEM_SELECT} WHERE m.id = $2`, [me ? me.id : null, id]);
  if (!it) throw notFound('Item not found');
  return it;
}

function validCover(me, key) {
  if (key === undefined) return undefined;
  if (key === null || key === '') return null;
  if (typeof key !== 'string') throw bad('coverKey must be text');
  // covers are uploaded with POST /uploads/image (img/<userId>/…); admins may reuse any image key
  if (!/^img\/[\w-]+\/[\w-]+\.(jpg|png|webp|heic|heif)$/.test(key)) throw bad('Upload the cover with /uploads/image first', 'BAD_COVER');
  if (me.role !== 'admin' && !key.startsWith(`img/${me.id}/`)) throw forbidden('Use a cover you uploaded');
  return key;
}

async function validCategory(env, kind, id) {
  if (id === undefined) return undefined;
  if (id === null || id === '') return null;
  if (!isUuid(id)) throw bad('Unknown category', 'BAD_CATEGORY');
  const cat = await one(env, 'SELECT id, kind FROM media_categories WHERE id = $1', [id]);
  if (!cat || cat.kind !== kind) throw bad('Unknown category', 'BAD_CATEGORY');
  return cat.id;
}

// ===================================================== public =====================================================
export const libraryPublic = new Hono();

libraryPublic.on(['GET', 'HEAD'], '/library/file/*', async (c) => {
  if (!c.env.MEDIA) return c.notFound();
  const key = decodeURIComponent(new URL(c.req.url).pathname.replace(/^\/library\/file\//, ''));
  if (!isFileKey(key)) return c.notFound();
  const signed = await verifyKeySig(c.env, key, c.req.query('exp'), c.req.query('sig'));
  if (!signed) {
    const it = await one(c.env, 'SELECT scope, visibility, in_library, status FROM media_items WHERE file_key = $1', [key]);
    if (!it || !isOpenItem(it)) return c.json({ error: 'This file is private', code: 'FORBIDDEN' }, 403);
  }
  return streamObject(c, key, { cache: signed ? 'private, max-age=3600' : 'public, max-age=86400' });
});

libraryPublic.get('/library/viewer', (c) => {
  c.header('Cache-Control', 'public, max-age=600');
  c.header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; worker-src 'self' blob: https://cdnjs.cloudflare.com; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data: https://cdnjs.cloudflare.com");
  c.header('Referrer-Policy', 'no-referrer');
  return c.html(LIBRARY_VIEWER_HTML);
});

// ===================================================== signed in =====================================================
export const library = new Hono();

library.get('/library/categories', async (c) => {
  const kind = kindParam(c.req.query('kind'));
  const rows = await q(c.env, `SELECT cat.*, (SELECT COUNT(*)::int FROM media_items m WHERE m.category_id = cat.id AND m.in_library AND m.status = 'published') AS count
    FROM media_categories cat WHERE cat.kind = $1 AND cat.active ORDER BY cat.sort_order, cat.name`, [kind]);
  return c.json({ items: rows.map(catShape) });
});

const catShape = (r) => ({ id: r.id, kind: r.kind, name: r.name, slug: r.slug, icon: r.icon, sortOrder: r.sort_order, active: r.active, count: r.count != null ? Number(r.count) : undefined });

library.get('/library/home', async (c) => {
  const me = c.get('user');
  const kind = kindParam(c.req.query('kind'));
  const cats = await q(c.env, 'SELECT * FROM media_categories WHERE kind = $1 AND active ORDER BY sort_order, name', [kind]);
  const rows = await q(c.env, `SELECT * FROM (
      SELECT x.*, row_number() OVER (PARTITION BY x.category_id ORDER BY x.featured DESC, x.created_at DESC) AS rn FROM (${ITEM_SELECT}
        WHERE m.kind = $2 AND m.in_library AND m.status = 'published') x
    ) y WHERE rn <= 12 ORDER BY featured DESC, created_at DESC`, [me.id, kind]);
  const items = await shapeAll(c, rows, me);
  const byCat = new Map();
  for (const it of items) { const k = it.category ? it.category.id : 'none'; if (!byCat.has(k)) byCat.set(k, []); byCat.get(k).push(it); }
  const featured = items.filter((x) => x.featured).slice(0, 8);
  const recentRows = await q(c.env, `${ITEM_SELECT} WHERE m.kind = $2 AND m.in_library AND m.status = 'published' ORDER BY m.created_at DESC LIMIT 12`, [me.id, kind]);
  return c.json({
    kind,
    featured,
    recent: await shapeAll(c, recentRows, me),
    categories: cats.map((cat) => ({ ...catShape(cat), items: byCat.get(cat.id) || [] })),
    uncategorized: byCat.get('none') || [],
  });
});

library.get('/library/items', async (c) => {
  const me = c.get('user');
  const kind = kindParam(c.req.query('kind'));
  const scope = c.req.query('scope') || 'library';
  const limit = Math.min(50, Math.max(1, Number(c.req.query('limit')) || 20));
  const params = [me.id, kind];
  const where = ['m.kind = $2'];
  if (scope === 'library') where.push(`m.in_library AND m.status = 'published'`);
  else if (scope === 'mine') where.push(`m.owner_id = $1 AND m.scope = 'personal'`);
  else if (scope === 'user') {
    const uid = c.req.query('userId');
    if (!isUuid(uid)) throw bad('userId is required');
    params.push(uid);
    where.push(`m.owner_id = $${params.length} AND m.scope = 'personal'`);
    if (uid !== me.id && me.role !== 'admin') where.push(`m.visibility = 'public' AND m.status = 'published'`);
  } else if (scope === 'group') {
    const cid = c.req.query('communityId');
    if (!isUuid(cid)) throw bad('communityId is required');
    if (me.role !== 'admin' && !(await memberRole(c.env, cid, me.id))) throw forbidden('Join this group to see its library', 'NOT_MEMBER');
    params.push(cid);
    where.push(`m.scope = 'group' AND m.community_id = $${params.length}`);
    const role = await memberRole(c.env, cid, me.id);
    if (me.role !== 'admin' && !canUploadToGroup(role)) where.push(`(m.status = 'published' OR m.owner_id = $1)`);
  } else throw bad('Unknown scope');
  const cat = c.req.query('category');
  if (cat) {
    params.push(cat);
    where.push(isUuid(cat) ? `m.category_id = $${params.length}` : `cat.slug = $${params.length}`);
  }
  const term = (c.req.query('q') || '').trim().slice(0, 80);
  if (term) {
    params.push(`%${term.replace(/[%_\\]/g, (x) => `\\${x}`)}%`);
    const p = `$${params.length}`;
    where.push(`(m.title ILIKE ${p} OR m.artist ILIKE ${p} OR m.description ILIKE ${p} OR cat.name ILIKE ${p})`);
  }
  const cur = decodeCursor(c.req.query('cursor'));
  if (cur) {
    params.push(cur.ts, cur.id);
    where.push(`(m.created_at, m.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
  }
  const rows = await q(c.env, `${ITEM_SELECT} WHERE ${where.join(' AND ')} ORDER BY m.created_at DESC, m.id DESC LIMIT ${limit + 1}`, params);
  const page = rows.slice(0, limit);
  return c.json({ items: await shapeAll(c, page, me), cursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null, hasMore: rows.length > limit });
});

library.get('/library/continue', async (c) => {
  const me = c.get('user');
  const kind = kindParam(c.req.query('kind'));
  const rows = await q(c.env, `${ITEM_SELECT} WHERE m.kind = $2 AND p.user_id = $1 AND NOT p.completed AND p.position > 0
    ORDER BY p.updated_at DESC LIMIT 12`, [me.id, kind]);
  const visible = [];
  for (const r of rows) if (await canView(c.env, me, r)) visible.push(r); // eslint-disable-line no-await-in-loop
  return c.json({ items: await shapeAll(c, visible, me) });
});

library.get('/library/my-groups', async (c) => {
  const me = c.get('user');
  const rows = await q(c.env, `SELECT co.id, co.name, co.avatar_key, cm.role,
      (SELECT COUNT(*)::int FROM media_items m WHERE m.community_id = co.id AND m.kind = 'audio' AND m.status = 'published') AS audio_count,
      (SELECT COUNT(*)::int FROM media_items m WHERE m.community_id = co.id AND m.kind = 'pdf' AND m.status = 'published') AS pdf_count
    FROM community_members cm JOIN communities co ON co.id = cm.community_id
    WHERE cm.user_id = $1 AND cm.status = 'member' ORDER BY co.name`, [me.id]);
  return c.json({
    isAdmin: me.role === 'admin', // the app shows "Publish to library" / platform uploads only to admins
    userId: me.id,
    items: rows.map((r) => ({
      id: r.id, name: r.name, avatarUrl: coverUrl(c.env, origin(c), r.avatar_key), role: r.role,
      canUpload: canUploadToGroup(r.role) || me.role === 'admin', audioCount: r.audio_count, pdfCount: r.pdf_count,
    })),
  });
});

library.get('/library/items/:id', async (c) => {
  const me = c.get('user');
  const it = await loadItem(c, uuidParam(c));
  if (!(await canView(c.env, me, it))) throw notFound('Item not found');
  return c.json(await shape(c, it, me, { manage: await canManage(c.env, me, it) }));
});

// Raw upload (Content-Type = the file's type). Streams straight into R2.
library.post('/library/files', async (c) => {
  const me = c.get('user');
  needBucket(c.env);
  const kind = kindParam(c.req.query('kind'), null);
  if (!kind) throw bad('kind must be audio or pdf');
  const type = (c.req.header('Content-Type') || '').split(';')[0].trim().toLowerCase();
  const ext = kind === 'audio' ? AUDIO_TYPES[type] : PDF_TYPES[type];
  if (!ext) throw bad(kind === 'audio' ? 'Upload an audio file (MP3, M4A, AAC, WAV, OGG or FLAC)' : 'Upload a PDF file', 'BAD_TYPE');
  const max = MAX_BYTES[kind];
  const mb = Math.round(max / 1024 / 1024);
  const len = Number(c.req.header('Content-Length') || 0);
  if (len > max) throw new ApiError(413, 'TOO_LARGE', `Files can be up to ${mb} MB`);
  let data; let size = len;
  if (len && c.req.raw.body) data = c.req.raw.body;
  else {
    data = await c.req.arrayBuffer();
    size = data.byteLength;
    if (size > max) throw new ApiError(413, 'TOO_LARGE', `Files can be up to ${mb} MB`);
  }
  if (!size) throw bad('Empty upload');
  if (kind === 'pdf' && data instanceof ArrayBuffer) {
    const head = new Uint8Array(data.slice(0, 5));
    if (String.fromCharCode(...head) !== '%PDF-') throw bad('That file is not a PDF', 'BAD_TYPE');
  }
  const key = `lib/${kind}/${me.id}/${crypto.randomUUID()}.${ext}`;
  await c.env.MEDIA.put(key, data, { httpMetadata: { contentType: kind === 'pdf' ? 'application/pdf' : type } });
  const { exp, sig } = await signKey(c.env, key);
  return c.json({ key, url: `${origin(c)}/library/file/${key}?exp=${exp}&sig=${sig}`, sizeBytes: size, mime: kind === 'pdf' ? 'application/pdf' : type }, 201);
});

library.post('/library/items', async (c) => {
  const me = c.get('user');
  needBucket(c.env);
  const b = await body(c);
  const kind = kindParam(b.kind, null);
  if (!kind) throw bad('kind must be audio or pdf');
  const scope = ['platform', 'personal', 'group'].includes(b.scope) ? b.scope : 'personal';
  const isAdmin = me.role === 'admin';
  let communityId = null;
  if (scope === 'platform' && !isAdmin) throw forbidden('Only admins can publish to the BibleNestra library', 'NOT_ADMIN');
  if (scope === 'group') {
    if (!isUuid(b.communityId)) throw bad('communityId is required');
    const comm = await one(c.env, 'SELECT id FROM communities WHERE id = $1', [b.communityId]);
    if (!comm) throw notFound('Group not found');
    if (!isAdmin && !canUploadToGroup(await memberRole(c.env, comm.id, me.id))) throw forbidden('Only the group owner and group admins can add to its library', 'NOT_GROUP_ADMIN');
    communityId = comm.id;
  }
  const fileKey = b.fileKey;
  if (!isFileKey(fileKey) || !fileKey.startsWith(`lib/${kind}/`)) throw bad('Upload the file with POST /library/files first', 'BAD_FILE');
  if (!fileKey.startsWith(`lib/${kind}/${me.id}/`)) throw forbidden('Use a file you uploaded');
  const head = await c.env.MEDIA.head(fileKey);
  if (!head) throw bad('The uploaded file was not found — upload it again', 'BAD_FILE');
  if (await one(c.env, 'SELECT 1 FROM media_items WHERE file_key = $1', [fileKey])) throw new ApiError(409, 'DUPLICATE', 'This file is already in the library');
  const title = str(b.title, { min: 1, max: 160, field: 'Title' });
  const artist = str(b.artist, { max: 120, optional: true, field: kind === 'pdf' ? 'Author' : 'Speaker / artist' });
  const description = str(b.description, { max: 4000, optional: true, field: 'Description' }) || '';
  const categoryId = await validCategory(c.env, kind, b.categoryId);
  const coverKey = validCover(me, b.coverKey);
  const rights = !!b.rightsAttested;
  if (kind === 'pdf' && !rights) throw bad('Confirm the book is public domain or that you have permission to share it', 'RIGHTS_REQUIRED');
  const durationSec = b.durationSec ? int(Math.round(Number(b.durationSec)), { min: 0, max: 48 * 3600, field: 'durationSec' }) : null;
  const pages = b.pages ? int(Number(b.pages), { min: 0, max: 100000, field: 'pages' }) : null;
  const visibility = scope === 'personal' && b.visibility === 'private' ? 'private' : 'public';
  const inLibrary = scope === 'platform';
  const row = await one(c.env, `INSERT INTO media_items (kind, scope, owner_id, community_id, category_id, title, artist, description, cover_key, file_key, mime,
      size_bytes, duration_sec, pages, visibility, in_library, featured, rights_attested, rights_note, published_by, published_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id`, [
    kind, scope, me.id, communityId, categoryId || null, title, artist, description, coverKey || null, fileKey, head.httpMetadata?.contentType || (kind === 'pdf' ? 'application/pdf' : 'audio/mpeg'),
    head.size, durationSec, pages, visibility, inLibrary, inLibrary && !!b.featured, rights, str(b.rightsNote, { max: 500, optional: true, field: 'Rights note' }),
    inLibrary ? me.id : null, inLibrary ? new Date().toISOString() : null,
  ]);
  if (scope === 'platform') await audit(c.env, me, 'library.create', 'media_item', row.id, { kind, title });
  const it = await loadItem(c, row.id);
  return c.json(await shape(c, it, me, { manage: true }), 201);
});

library.patch('/library/items/:id', async (c) => {
  const me = c.get('user');
  const it = await loadItem(c, uuidParam(c));
  if (!(await canManage(c.env, me, it))) throw forbidden('You can’t edit this item');
  const b = await body(c);
  const isAdmin = me.role === 'admin';
  const next = {
    title: b.title !== undefined ? str(b.title, { min: 1, max: 160, field: 'Title' }) : it.title,
    artist: b.artist !== undefined ? str(b.artist, { max: 120, optional: true, field: 'Artist' }) : it.artist,
    description: b.description !== undefined ? str(b.description, { max: 4000, optional: true, field: 'Description' }) || '' : it.description,
    category_id: b.categoryId !== undefined ? await validCategory(c.env, it.kind, b.categoryId) : it.category_id,
    cover_key: b.coverKey !== undefined ? validCover(me, b.coverKey) : it.cover_key,
    visibility: b.visibility !== undefined && it.scope === 'personal' ? (b.visibility === 'private' ? 'private' : 'public') : it.visibility,
    featured: b.featured !== undefined && isAdmin ? !!b.featured : it.featured,
    status: b.status !== undefined && isAdmin ? (b.status === 'hidden' ? 'hidden' : 'published') : it.status,
    duration_sec: b.durationSec !== undefined ? int(Math.round(Number(b.durationSec) || 0), { min: 0, max: 48 * 3600, field: 'durationSec' }) : it.duration_sec,
    pages: b.pages !== undefined ? int(Number(b.pages) || 0, { min: 0, max: 100000, field: 'pages' }) : it.pages,
  };
  await q(c.env, `UPDATE media_items SET title=$2, artist=$3, description=$4, category_id=$5, cover_key=$6, visibility=$7, featured=$8, status=$9,
      duration_sec=$10, pages=$11, updated_at=now() WHERE id=$1`,
  [it.id, next.title, next.artist, next.description, next.category_id, next.cover_key, next.visibility, next.featured, next.status, next.duration_sec, next.pages]);
  if (isAdmin && it.owner_id !== me.id) await audit(c.env, me, 'library.update', 'media_item', it.id, { title: next.title, status: next.status, featured: next.featured });
  const fresh = await loadItem(c, it.id);
  return c.json(await shape(c, fresh, me, { manage: true }));
});

library.delete('/library/items/:id', async (c) => {
  const me = c.get('user');
  const it = await loadItem(c, uuidParam(c));
  if (!(await canManage(c.env, me, it))) throw forbidden('You can’t delete this item');
  await q(c.env, 'DELETE FROM media_items WHERE id = $1', [it.id]);
  if (c.env.MEDIA) await c.env.MEDIA.delete(it.file_key).catch(() => {});
  if (me.role === 'admin' && it.owner_id !== me.id) await audit(c.env, me, 'library.delete', 'media_item', it.id, { title: it.title, scope: it.scope });
  return c.json({ ok: true });
});

// Admins only: bring a group / personal item into the platform library (or take it back out).
library.post('/library/items/:id/publish', async (c) => {
  const me = c.get('user');
  if (me.role !== 'admin') throw forbidden('Only admins can publish to the BibleNestra library', 'NOT_ADMIN');
  const it = await loadItem(c, uuidParam(c));
  const b = await body(c).catch(() => ({}));
  const on = b.inLibrary === undefined ? true : !!b.inLibrary;
  if (it.scope === 'platform' && !on) throw bad('Platform items are always in the library — hide or delete it instead');
  if (on && it.kind === 'pdf' && !it.rights_attested && !b.rightsAttested) throw bad('Confirm the book is public domain or permitted before publishing', 'RIGHTS_REQUIRED');
  const categoryId = b.categoryId !== undefined ? await validCategory(c.env, it.kind, b.categoryId) : it.category_id;
  await q(c.env, `UPDATE media_items SET in_library = $2, category_id = $3, rights_attested = rights_attested OR $4, status = CASE WHEN $2 THEN 'published' ELSE status END,
      published_by = CASE WHEN $2 THEN $5::uuid ELSE published_by END, published_at = CASE WHEN $2 THEN now() ELSE published_at END, updated_at = now() WHERE id = $1`,
  [it.id, on, categoryId, !!b.rightsAttested, me.id]);
  await audit(c.env, me, on ? 'library.publish' : 'library.unpublish', 'media_item', it.id, { title: it.title, scope: it.scope });
  return c.json(await shape(c, await loadItem(c, it.id), me, { manage: true }));
});

library.post('/library/items/:id/report', async (c) => {
  const me = c.get('user');
  const it = await loadItem(c, uuidParam(c));
  if (!(await canView(c.env, me, it))) throw notFound('Item not found');
  const b = await body(c).catch(() => ({}));
  const reason = str(b.reason, { max: 500, optional: true, field: 'reason' });
  await q(c.env, `INSERT INTO media_reports (item_id, reporter_id, reason) VALUES ($1, $2, $3)
    ON CONFLICT (item_id, reporter_id) DO UPDATE SET reason = EXCLUDED.reason, created_at = now(), resolved_at = NULL, resolution = NULL`, [it.id, me.id, reason]);
  return c.json({ ok: true });
});

library.post('/library/items/:id/play', async (c) => {
  const me = c.get('user');
  const it = await loadItem(c, uuidParam(c));
  if (!(await canView(c.env, me, it))) throw notFound('Item not found');
  const b = await body(c).catch(() => ({}));
  const d = Number(b.durationSec);
  const dur = Number.isFinite(d) && d > 0 && d < 48 * 3600 ? Math.round(d) : null;
  const pages = Number.isInteger(Number(b.pages)) && Number(b.pages) > 0 && Number(b.pages) < 100000 ? Number(b.pages) : null;
  await q(c.env, `UPDATE media_items SET plays = plays + 1, duration_sec = COALESCE(duration_sec, $2), pages = COALESCE(pages, $3) WHERE id = $1`, [it.id, dur, pages]);
  return c.json({ ok: true });
});

library.put('/library/items/:id/progress', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const b = await body(c);
  const pos = Number(b.position);
  if (!Number.isFinite(pos) || pos < 0 || pos > 1e7) throw bad('position must be a number');
  const it = await one(c.env, 'SELECT * FROM media_items WHERE id = $1', [id]);
  if (!it || !(await canView(c.env, me, it))) throw notFound('Item not found');
  await q(c.env, `INSERT INTO media_progress (user_id, item_id, position, completed) VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id, item_id) DO UPDATE SET position = EXCLUDED.position, completed = EXCLUDED.completed, updated_at = now()`, [me.id, id, pos, !!b.completed]);
  return c.json({ ok: true });
});

// ===================================================== admin =====================================================
export const adminLibrary = new Hono();
adminLibrary.use('/admin/api/library/*', requireAdmin);

adminLibrary.get('/admin/api/library/items', async (c) => {
  const me = c.get('user');
  const kind = kindParam(c.req.query('kind'));
  const view = c.req.query('view') || 'library';
  const params = [me.id, kind];
  const where = ['m.kind = $2'];
  if (view === 'library') where.push('m.in_library');
  else if (view === 'community') where.push(`m.scope <> 'platform' AND NOT m.in_library`);
  else if (view === 'hidden') where.push(`m.status = 'hidden'`);
  const term = (c.req.query('q') || '').trim().slice(0, 80);
  if (term) { params.push(`%${term}%`); where.push(`(m.title ILIKE $${params.length} OR m.artist ILIKE $${params.length})`); }
  const rows = await q(c.env, `SELECT x.*, (SELECT COUNT(*)::int FROM media_reports r WHERE r.item_id = x.id AND r.resolved_at IS NULL) AS open_reports
    FROM (${ITEM_SELECT} WHERE ${where.join(' AND ')} ORDER BY m.created_at DESC LIMIT 200) x`, params);
  const items = await Promise.all(rows.map(async (r) => ({ ...(await shape(c, r, me, { manage: true })), openReports: r.open_reports })));
  return c.json({ items });
});

adminLibrary.get('/admin/api/library/categories', async (c) => {
  const kind = kindParam(c.req.query('kind'));
  const rows = await q(c.env, `SELECT cat.*, (SELECT COUNT(*)::int FROM media_items m WHERE m.category_id = cat.id) AS count
    FROM media_categories cat WHERE kind = $1 ORDER BY sort_order, name`, [kind]);
  return c.json({ items: rows.map(catShape) });
});

adminLibrary.post('/admin/api/library/categories', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const kind = kindParam(b.kind, null);
  if (!kind) throw bad('kind must be audio or pdf');
  const name = str(b.name, { min: 1, max: 60, field: 'Name' });
  const slug = slugify(b.slug || name);
  if (await one(c.env, 'SELECT 1 FROM media_categories WHERE kind = $1 AND slug = $2', [kind, slug])) throw new ApiError(409, 'DUPLICATE', 'A category with that name already exists');
  const row = await one(c.env, `INSERT INTO media_categories (kind, name, slug, icon, sort_order)
    VALUES ($1, $2, $3, $4, COALESCE($5, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM media_categories WHERE kind = $1))) RETURNING *`,
  [kind, name, slug, str(b.icon, { max: 30, optional: true, field: 'icon' }), b.sortOrder == null ? null : int(b.sortOrder, { min: -1000, max: 1000, field: 'sortOrder' })]);
  await audit(c.env, me, 'library.category.create', 'media_category', row.id, { kind, name });
  return c.json(catShape(row), 201);
});

adminLibrary.patch('/admin/api/library/categories/:id', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const cur = await one(c.env, 'SELECT * FROM media_categories WHERE id = $1', [id]);
  if (!cur) throw notFound('Category not found');
  const b = await body(c);
  const row = await one(c.env, 'UPDATE media_categories SET name = $2, icon = $3, sort_order = $4, active = $5 WHERE id = $1 RETURNING *', [
    id,
    b.name !== undefined ? str(b.name, { min: 1, max: 60, field: 'Name' }) : cur.name,
    b.icon !== undefined ? str(b.icon, { max: 30, optional: true, field: 'icon' }) : cur.icon,
    b.sortOrder !== undefined ? int(b.sortOrder, { min: -1000, max: 1000, field: 'sortOrder' }) : cur.sort_order,
    b.active !== undefined ? !!b.active : cur.active,
  ]);
  await audit(c.env, me, 'library.category.update', 'media_category', id, { name: row.name, active: row.active });
  return c.json(catShape(row));
});

adminLibrary.delete('/admin/api/library/categories/:id', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const row = await one(c.env, 'DELETE FROM media_categories WHERE id = $1 RETURNING name', [id]);
  if (!row) throw notFound('Category not found');
  await audit(c.env, me, 'library.category.delete', 'media_category', id, { name: row.name });
  return c.json({ ok: true });
});

adminLibrary.get('/admin/api/library/reports', async (c) => {
  const me = c.get('user');
  const rows = await q(c.env, `SELECT r.id AS report_id, r.reason, r.created_at AS reported_at, ru.display_name AS reporter_name, x.*
    FROM media_reports r JOIN users ru ON ru.id = r.reporter_id
    JOIN LATERAL (${ITEM_SELECT.replace('$1', 'NULL::uuid')} WHERE m.id = r.item_id) x ON true
    WHERE r.resolved_at IS NULL ORDER BY r.created_at DESC LIMIT 100`);
  const items = await Promise.all(rows.map(async (r) => ({
    id: r.report_id, reason: r.reason, reporter: r.reporter_name, createdAt: new Date(r.reported_at).toISOString(),
    item: await shape(c, r, me, { manage: true }),
  })));
  return c.json({ items });
});

adminLibrary.post('/admin/api/library/reports/:id/resolve', async (c) => {
  const me = c.get('user');
  const rep = await one(c.env, 'SELECT * FROM media_reports WHERE id = $1', [uuidParam(c)]);
  if (!rep) throw notFound('Report not found');
  const b = await body(c).catch(() => ({}));
  const action = b.action === 'hide' ? 'hidden' : 'dismissed';
  if (action === 'hidden') await q(c.env, `UPDATE media_items SET status = 'hidden', updated_at = now() WHERE id = $1`, [rep.item_id]);
  await q(c.env, `UPDATE media_reports SET resolved_at = now(), resolution = $2, resolved_by = $3 WHERE item_id = $1 AND resolved_at IS NULL`, [rep.item_id, action, me.id]);
  await audit(c.env, me, `library.report.${action}`, 'media_item', rep.item_id, { reportId: rep.id });
  return c.json({ ok: true, resolution: action });
});
