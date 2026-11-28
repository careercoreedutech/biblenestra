// HOUSE ADS: BibleNestra's own sponsored image or text ads, uploaded by admins in the Ads tab.
// They show only when AdMob AND the backup network both have no fill (app: src/ads/Ads.js). They are always labelled
// "Sponsored" in the app, count impressions and clicks here, and never grant coins or unlocks (server-verified
// rewards come only from real networks).
//   GET  /ads/house                       public — active house ads (no counts)
//   POST /ads/house/:id/impression        public — counts one impression (active ads only)
//   POST /ads/house/:id/click             public — counts one click (active ads only)
//   GET/POST /admin/api/ads/house         admin — list with counts, create
//   PUT/DELETE /admin/api/ads/house/:id   admin — edit / delete
import { q, one } from './db.js';
import { bad, notFound, isUuid } from './http.js';

export const HOUSE_KINDS = Object.freeze(['image', 'text']);
export const HOUSE_EVENTS = Object.freeze(['impression', 'click']);
const MAX_LINK = 500;

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);

/** http(s) only: a house ad must never open a javascript:, data: or intent: link. */
export function isWebUrl(s) {
  if (typeof s !== 'string' || !s.trim() || s.length > MAX_LINK) return false;
  try {
    const u = new URL(s.trim());
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch (e) {
    return false;
  }
}

/**
 * Validates one house ad. Throws ApiError(400, BAD_HOUSE_AD) naming the field. Returns the clean row fields.
 * Input is a full document (the admin form sends all fields; updates merge the stored row first).
 */
export function normalizeHouseAd(input) {
  if (!isObj(input)) throw bad('house ad must be an object', 'BAD_HOUSE_AD');
  const kind = input.kind;
  if (!HOUSE_KINDS.includes(kind)) throw bad('kind must be "image" or "text"', 'BAD_HOUSE_AD');
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title || title.length > 80) throw bad('title is required (up to 80 characters)', 'BAD_HOUSE_AD');
  const bodyText = input.body == null ? '' : String(input.body).trim();
  if (bodyText.length > 240) throw bad('body can be up to 240 characters', 'BAD_HOUSE_AD');
  const cta = input.cta == null || String(input.cta).trim() === '' ? 'Learn more' : String(input.cta).trim();
  if (cta.length > 24) throw bad('button text can be up to 24 characters', 'BAD_HOUSE_AD');
  if (!isWebUrl(input.linkUrl)) throw bad('link must be a full http:// or https:// address', 'BAD_HOUSE_AD');
  let imageUrl = null;
  if (input.imageUrl != null && String(input.imageUrl).trim() !== '') {
    if (!isWebUrl(input.imageUrl)) throw bad('image must be an uploaded image link', 'BAD_HOUSE_AD');
    imageUrl = String(input.imageUrl).trim();
  }
  if (kind === 'image' && !imageUrl) throw bad('an image ad needs an uploaded image', 'BAD_HOUSE_AD');
  if (input.active !== undefined && typeof input.active !== 'boolean') throw bad('active must be true or false', 'BAD_HOUSE_AD');
  const sort = input.sort == null || input.sort === '' ? 0 : Number(input.sort);
  if (!Number.isInteger(sort) || sort < 0 || sort > 999) throw bad('sort must be a whole number from 0 to 999', 'BAD_HOUSE_AD');
  return {
    kind,
    title,
    body: bodyText,
    cta,
    imageUrl,
    linkUrl: String(input.linkUrl).trim(),
    active: input.active === undefined ? true : input.active,
    sort,
  };
}

const toApi = (r) => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  body: r.body || '',
  cta: r.cta || 'Learn more',
  imageUrl: r.image_url || null,
  linkUrl: r.link_url,
  active: !!r.active,
  sort: Number(r.sort) || 0,
  impressions: Number(r.impressions) || 0,
  clicks: Number(r.clicks) || 0,
  ctr: Number(r.impressions) > 0 ? Math.round((Number(r.clicks) / Number(r.impressions)) * 1000) / 10 : null,
  createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
  updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
});

/** Public shape: what the app needs to draw the ad (no counts). */
const toPublic = (r) => ({
  id: r.id, kind: r.kind, title: r.title, body: r.body || '', cta: r.cta || 'Learn more',
  imageUrl: r.image_url || null, linkUrl: r.link_url,
});

export async function listHouseAds(env) {
  const rows = await q(env, 'SELECT * FROM house_ads ORDER BY sort, created_at DESC', []);
  return rows.map(toApi);
}

export async function listActiveHouseAds(env) {
  const rows = await q(env, 'SELECT * FROM house_ads WHERE active ORDER BY sort, created_at DESC LIMIT 50', []);
  return rows.map(toPublic);
}

export async function getHouseAd(env, id) {
  if (!isUuid(id)) throw notFound('House ad not found');
  const row = await one(env, 'SELECT * FROM house_ads WHERE id = $1', [id]);
  if (!row) throw notFound('House ad not found');
  return toApi(row);
}

export async function createHouseAd(env, admin, input) {
  const v = normalizeHouseAd(input);
  const row = await one(env, `INSERT INTO house_ads (kind, title, body, cta, image_url, link_url, active, sort, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
  [v.kind, v.title, v.body, v.cta, v.imageUrl, v.linkUrl, v.active, v.sort, admin ? admin.id : null]);
  return toApi(row);
}

export async function updateHouseAd(env, id, input) {
  const cur = await getHouseAd(env, id);
  const v = normalizeHouseAd({ ...cur, ...(isObj(input) ? input : {}), imageUrl: isObj(input) && 'imageUrl' in input ? input.imageUrl : cur.imageUrl });
  const row = await one(env, `UPDATE house_ads SET kind = $2, title = $3, body = $4, cta = $5, image_url = $6, link_url = $7,
      active = $8, sort = $9, updated_at = now() WHERE id = $1 RETURNING *`,
  [id, v.kind, v.title, v.body, v.cta, v.imageUrl, v.linkUrl, v.active, v.sort]);
  return toApi(row);
}

export async function deleteHouseAd(env, id) {
  await getHouseAd(env, id); // 404 when missing
  await q(env, 'DELETE FROM house_ads WHERE id = $1', [id]);
  return { ok: true };
}

/**
 * Counts one impression or click on an ACTIVE house ad (atomic increment). Returns { ok } — unknown or inactive ads
 * are not counted and are not an error the app needs to handle.
 */
export async function recordHouseEvent(env, id, type) {
  if (!HOUSE_EVENTS.includes(type)) throw bad('type must be impression or click', 'BAD_HOUSE_EVENT');
  if (!isUuid(id)) return { ok: false };
  const col = type === 'click' ? 'clicks' : 'impressions';
  const row = await one(env, `UPDATE house_ads SET ${col} = ${col} + 1 WHERE id = $1 AND active RETURNING id`, [id]);
  return { ok: !!row };
}
