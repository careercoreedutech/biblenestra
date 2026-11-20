// Minimal fetch wrapper for the BibleNestra Worker.
// request(method, path, body, opts) → parsed JSON. Non-2xx responses throw an ApiError carrying the
// server's `{ error, code }` (plus `status`); network failures throw code 'NETWORK'.
import { Platform } from 'react-native';
import { notifyChatLimit } from './chatLimitEvents'; // CHAT LIMITS: 403 CHAT_LIMIT_REACHED → upgrade / invite prompt

export class ApiError extends Error {
  constructor(message, { code = 'ERROR', status = 0, data = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.data = data;
  }
}

/**
 * @param {{ apiUrl: string, getToken?: () => Promise<string|null>, devUser?: string }} cfg
 */
export function createRequest({ apiUrl, getToken, devUser }) {
  async function authHeaders() {
    if (devUser) return { 'X-Dev-User': devUser };
    if (getToken) {
      const token = await getToken();
      if (token) return { Authorization: `Bearer ${token}` };
    }
    return {};
  }

  /**
   * @param {string} method
   * @param {string} path   e.g. '/feed?limit=20'
   * @param {any} [body]    plain object → JSON; Blob/ArrayBuffer/FormData → sent as is
   * @param {{ headers?: object, raw?: boolean, timeout?: number }} [opts]
   */
  async function request(method, path, body, opts = {}) {
    // X-TZ-Offset: minutes east of UTC, so the server's "today" (support ads, games) matches the phone's date
    const headers = { Accept: 'application/json', 'X-TZ-Offset': String(-new Date().getTimezoneOffset()), ...(await authHeaders()), ...(opts.headers || {}) };
    let payload;
    if (body !== undefined && body !== null) {
      const isBinary =
        (typeof Blob !== 'undefined' && body instanceof Blob) ||
        (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) ||
        (typeof FormData !== 'undefined' && body instanceof FormData);
      if (isBinary) payload = body;
      else {
        payload = JSON.stringify(body);
        headers['Content-Type'] = 'application/json';
      }
    }
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), opts.timeout || 30000) : null;
    let res;
    try {
      res = await fetch(apiUrl + path, { method, headers, body: payload, signal: ctrl ? ctrl.signal : undefined });
    } catch (e) {
      throw new ApiError(e && e.name === 'AbortError' ? 'The server took too long to answer' : 'Can’t reach BibleNestra — check your connection', { code: 'NETWORK' });
    } finally {
      if (timer) clearTimeout(timer);
    }
    const text = await res.text().catch(() => '');
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
    }
    if (!res.ok) {
      const msg = (data && data.error) || `Request failed (${res.status})`;
      if (data && data.code === 'CHAT_LIMIT_REACHED') notifyChatLimit(data); // CHAT LIMITS (client #27)
      throw new ApiError(msg, { code: (data && data.code) || `HTTP_${res.status}`, status: res.status, data });
    }
    return data;
  }

  request.authHeaders = authHeaders;
  request.apiUrl = apiUrl;
  return request;
}

/** Friendly message for an error thrown by request(). */
export function errorMessage(e, fallback = 'Something went wrong') {
  if (!e) return fallback;
  if (e.code === 'NETWORK') return e.message;
  if (e.code === 'INSUFFICIENT_COINS') return 'Not enough coins';
  return e.message || fallback;
}

export const isWeb = Platform.OS === 'web';
