// DOJAH identity checks (https://docs.dojah.io) — a small adapter used by payout KYC (lib/kyc.js) and the Find Love
// Verified badge (lib/dating.js).
//
// Config (Worker env):
//   DOJAH_APP_ID       the app id (header AppId)
//   DOJAH_SECRET_KEY   the secret key (header Authorization, sent AS-IS: Dojah does not use "Bearer")
//   DOJAH_BASE_URL     optional override. Otherwise https://sandbox.dojah.io when the key starts with 'test_' or
//                      DOJAH_ENV=sandbox, else https://api.dojah.io (production, charged per call).
// Sandbox test values: BVN 22222222222, NIN 70123456789 (sandbox never charges).
//
// Endpoints used:
//   GET  /api/v1/kyc/bvn/full?bvn=      BVN lookup → entity { first_name, middle_name, last_name, … }
//   GET  /api/v1/kyc/nin?nin=           NIN lookup → entity { first_name, middle_name, last_name, … }
//   POST /api/v1/kyc/bvn/verify         { bvn, selfie_image, threshold } → entity.selfie_verification { confidence_value, match }
//   POST /api/v1/kyc/nin/verify         { nin, selfie_image, threshold } → same
// (Validate BVN, GET /api/v1/kyc/bvn?bvn&first_name&last_name&dob, only answers yes/no per field. KYC needs the
// record's name to compare with BOTH the legal name and the bank account name, so it uses the lookups.)
//
// Privacy: this module never logs the ID number, the selfie or the returned photo, and it returns only names (lookup)
// or { match, confidence } (selfie). Callers store only outcomes.
import { ApiError } from './http.js';

export const DOJAH_PRODUCTION = 'https://api.dojah.io';
export const DOJAH_SANDBOX = 'https://sandbox.dojah.io';
const TIMEOUT_MS = 20000;

export const dojahConfigured = (env) => !!(env && String(env.DOJAH_APP_ID || '').trim() && String(env.DOJAH_SECRET_KEY || '').trim());
export const dojahSandbox = (env) => String((env && env.DOJAH_SECRET_KEY) || '').trim().startsWith('test_') || String((env && env.DOJAH_ENV) || '').trim().toLowerCase() === 'sandbox';
/** DOJAH_BASE_URL if set, else the sandbox for test keys / DOJAH_ENV=sandbox, else production. */
export function dojahBaseUrl(env) {
  const own = String((env && env.DOJAH_BASE_URL) || '').trim();
  if (own) return own.replace(/\/+$/, '');
  return dojahSandbox(env) ? DOJAH_SANDBOX : DOJAH_PRODUCTION;
}

function fail(status, code, message, httpStatus) {
  const e = new ApiError(status, code, message);
  e.details = { provider: 'dojah', httpStatus: httpStatus == null ? null : httpStatus };
  return e;
}
/** Dojah HTTP status → a friendly ApiError (the member never sees Dojah's raw message). */
export function dojahError(httpStatus) {
  if (httpStatus === 404) return fail(404, 'ID_NOT_FOUND', 'We couldn’t find a record for that ID number — check it and try again', 404);
  if (httpStatus === 400 || httpStatus === 422) return fail(400, 'ID_CHECK_BAD_INPUT', 'The ID check couldn’t use those details — check the number and try again', httpStatus);
  if (httpStatus === 401 || httpStatus === 403) return fail(503, 'ID_CHECK_UNAVAILABLE', 'The automatic ID check isn’t available right now (service keys)', httpStatus);
  if (httpStatus === 402) return fail(503, 'ID_CHECK_UNAVAILABLE', 'The automatic ID check isn’t available right now (service balance)', httpStatus);
  if (httpStatus === 429) return fail(503, 'ID_CHECK_BUSY', 'The automatic ID check is busy — please try again in a minute', httpStatus);
  return fail(503, 'ID_CHECK_UNAVAILABLE', 'The automatic ID check isn’t available right now', httpStatus);
}

/** One call. `path` must not carry the ID number in what gets logged: only `logPath` is ever logged. */
async function dojahRequest(env, method, path, { query = null, body = null, logPath = path, timeoutMs = TIMEOUT_MS } = {}) {
  if (!dojahConfigured(env)) throw fail(503, 'ID_CHECK_NOT_CONFIGURED', 'The automatic ID check isn’t set up');
  const url = new URL(dojahBaseUrl(env) + path);
  if (query) for (const [k, v] of Object.entries(query)) if (v != null && v !== '') url.searchParams.set(k, String(v));
  const headers = { Authorization: String(env.DOJAH_SECRET_KEY).trim(), AppId: String(env.DOJAH_APP_ID).trim(), Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url.toString(), { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
  } catch (e) {
    console.warn('dojah request failed', method, logPath, e && e.name === 'AbortError' ? 'timeout' : 'network');
    throw fail(503, 'ID_CHECK_UNAVAILABLE', 'The automatic ID check isn’t available right now', null);
  } finally { clearTimeout(t); }
  let json = null;
  try { json = await res.json(); } catch (e) { json = null; }
  if (!res.ok) {
    console.warn('dojah error', method, logPath, res.status);
    throw dojahError(res.status);
  }
  if (!json || typeof json !== 'object' || !json.entity || typeof json.entity !== 'object') {
    console.warn('dojah reply without entity', method, logPath, res.status);
    throw fail(503, 'ID_CHECK_UNAVAILABLE', 'The automatic ID check gave an unexpected answer', res.status);
  }
  return json.entity;
}

const s = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 80) : '');
/** Names only (BVN: first_name/middle_name/last_name; NIN: the same, or firstname/middlename/surname). */
function namesOf(e) {
  return {
    firstName: s(e.first_name || e.firstname),
    middleName: s(e.middle_name || e.middlename),
    lastName: s(e.last_name || e.surname || e.lastname),
  };
}
export const fullName = (n) => [n.firstName, n.middleName, n.lastName].filter(Boolean).join(' ');

/** Look up a BVN or NIN record → { firstName, middleName, lastName } (nothing else is returned or kept). */
export async function lookupId(env, idType, idNumber) {
  if (idType === 'bvn') return namesOf(await dojahRequest(env, 'GET', '/api/v1/kyc/bvn/full', { query: { bvn: idNumber }, logPath: '/api/v1/kyc/bvn/full' }));
  if (idType === 'nin') return namesOf(await dojahRequest(env, 'GET', '/api/v1/kyc/nin', { query: { nin: idNumber }, logPath: '/api/v1/kyc/nin' }));
  throw fail(400, 'ID_CHECK_BAD_INPUT', 'Only BVN and NIN can be checked automatically');
}

/** Uint8Array → base64 (no data: prefix). Works in Workers and Node. */
export function toBase64(bytes) {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}

/**
 * Selfie ↔ BVN/NIN photo match. selfie: Uint8Array. threshold 50–100 (Dojah's default 90).
 * → { match: boolean, confidence: number | null } — the record and photo Dojah returns are dropped here.
 */
export async function verifySelfie(env, { idType, idNumber, selfie, threshold = 90 }) {
  if (!['bvn', 'nin'].includes(idType)) throw fail(400, 'ID_CHECK_BAD_INPUT', 'Only BVN and NIN can be checked automatically');
  if (!selfie || !selfie.length) throw fail(400, 'ID_CHECK_BAD_INPUT', 'The selfie is missing');
  const th = Math.min(100, Math.max(50, Math.round(Number(threshold) || 90)));
  const path = `/api/v1/kyc/${idType}/verify`;
  const e = await dojahRequest(env, 'POST', path, { body: { [idType]: idNumber, selfie_image: toBase64(selfie), threshold: th } });
  const sv = e.selfie_verification && typeof e.selfie_verification === 'object' ? e.selfie_verification : {};
  const conf = Number(sv.confidence_value);
  return { match: sv.match === true, confidence: Number.isFinite(conf) ? Math.round(conf * 100) / 100 : null };
}
