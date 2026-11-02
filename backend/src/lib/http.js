// Small helpers for consistent JSON errors and input validation.
export class ApiError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}
export const bad = (msg, code = 'BAD_REQUEST') => new ApiError(400, code, msg);
export const notFound = (what = 'Not found') => new ApiError(404, 'NOT_FOUND', what);
export const forbidden = (msg = 'Not allowed', code = 'FORBIDDEN') => new ApiError(403, code, msg);

export async function body(c) {
  try { return (await c.req.json()) || {}; } catch (e) { throw bad('Body must be JSON'); }
}

export function str(v, { max = 2000, min = 0, field = 'value', optional = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (optional) return null;
    if (min > 0) throw bad(`${field} is required`);
    return '';
  }
  if (typeof v !== 'string') throw bad(`${field} must be text`);
  const t = v.trim();
  if (t.length < min) throw bad(`${field} is too short`);
  if (t.length > max) throw bad(`${field} is too long (max ${max})`);
  return t;
}

export function int(v, { min = 0, max = 1e9, field = 'value', optional = false } = {}) {
  if (v === undefined || v === null) { if (optional) return null; throw bad(`${field} is required`); }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${field} must be a whole number between ${min} and ${max}`);
  return n;
}

export const isUuid = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export function uuidParam(c, name = 'id') {
  const v = c.req.param(name);
  if (!isUuid(v)) throw notFound();
  return v;
}

// Opaque keyset cursor: "<iso timestamp>|<uuid>"
export const encodeCursor = (row) => (row ? btoa(`${new Date(row.created_at).toISOString()}|${row.id}`) : null);
export function decodeCursor(s) {
  if (!s) return null;
  try {
    const [ts, id] = atob(s).split('|');
    if (!isUuid(id) || Number.isNaN(Date.parse(ts))) return null;
    return { ts, id };
  } catch (e) { return null; }
}

// The user's local calendar date (users.tz_offset = minutes east of UTC, sent by the app)
export const today = (tzOffset = 0) => new Date(Date.now() + (Number(tzOffset) || 0) * 60000).toISOString().slice(0, 10);
