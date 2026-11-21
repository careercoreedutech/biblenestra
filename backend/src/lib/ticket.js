// Short-lived HMAC-signed ticket authentication for WebSockets.
// Tickets expire after 60 seconds.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function b64url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(str) {
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function getHmacKey(secretStr) {
  const rawKey = encoder.encode(secretStr || 'biblenestra-realtime-fallback-secret');
  return crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function createTicket(secret, userId, ttlSeconds = 60) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payloadStr = `${userId}:${exp}`;
  const key = await getHmacKey(secret);
  const sigBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadStr));
  const sigB64 = b64url(sigBuf);
  return b64url(encoder.encode(`${payloadStr}:${sigB64}`));
}

export async function verifyTicket(secret, ticketStr) {
  if (!ticketStr || typeof ticketStr !== 'string') return { valid: false, reason: 'missing_ticket' };
  try {
    const raw = decoder.decode(unb64url(ticketStr));
    const parts = raw.split(':');
    if (parts.length !== 3) return { valid: false, reason: 'malformed_ticket' };
    const [userId, expStr, sigB64] = parts;
    const exp = parseInt(expStr, 10);
    const now = Math.floor(Date.now() / 1000);
    if (Number.isNaN(exp) || exp < now) return { valid: false, reason: 'expired_ticket' };

    const payloadStr = `${userId}:${expStr}`;
    const key = await getHmacKey(secret);
    const sigBytes = unb64url(sigB64);
    const ok = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(payloadStr));
    if (!ok) return { valid: false, reason: 'invalid_signature' };

    return { valid: true, userId };
  } catch (e) {
    return { valid: false, reason: 'verification_failed' };
  }
}

export async function createAdminToken(secret, username = 'benjamin', ttlSeconds = 30 * 86400) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payloadStr = `adm:${username}:${exp}`;
  const key = await getHmacKey(secret);
  const sigBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadStr));
  const sigB64 = b64url(sigBuf);
  return 'admin_token_' + b64url(encoder.encode(`${payloadStr}:${sigB64}`));
}

export async function verifyAdminToken(secret, tokenStr) {
  if (!tokenStr || typeof tokenStr !== 'string' || !tokenStr.startsWith('admin_token_')) {
    return { valid: false, reason: 'invalid_prefix' };
  }
  try {
    const raw = decoder.decode(unb64url(tokenStr.slice('admin_token_'.length)));
    const parts = raw.split(':');
    if (parts.length !== 4) return { valid: false, reason: 'malformed_admin_token' };
    const [prefix, username, expStr, sigB64] = parts;
    if (prefix !== 'adm') return { valid: false, reason: 'bad_prefix' };
    const exp = parseInt(expStr, 10);
    const now = Math.floor(Date.now() / 1000);
    if (Number.isNaN(exp) || exp < now) return { valid: false, reason: 'expired_token' };

    const payloadStr = `adm:${username}:${expStr}`;
    const key = await getHmacKey(secret);
    const sigBytes = unb64url(sigB64);
    const ok = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(payloadStr));
    if (!ok) return { valid: false, reason: 'invalid_signature' };

    return { valid: true, username };
  } catch (e) {
    return { valid: false, reason: 'verification_failed' };
  }
}

// STAFF ACCESS: "staff_token_" + b64url("stf:<staff id>:<role>:<session version>:<exp>:<sig>"). The account is re-read on
// every request (lib/auth.js), so a disabled account or a bumped session version is refused even before exp.
export async function createStaffToken(secret, { id, role, version }, ttlSeconds = 12 * 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payloadStr = `stf:${id}:${role}:${version}:${exp}`;
  const key = await getHmacKey(secret);
  const sigB64 = b64url(await crypto.subtle.sign('HMAC', key, encoder.encode(payloadStr)));
  return { token: 'staff_token_' + b64url(encoder.encode(`${payloadStr}:${sigB64}`)), expiresAt: new Date(exp * 1000).toISOString() };
}

export async function verifyStaffToken(secret, tokenStr) {
  if (!secret || typeof tokenStr !== 'string' || !tokenStr.startsWith('staff_token_')) return { valid: false, reason: 'invalid_prefix' };
  try {
    const parts = decoder.decode(unb64url(tokenStr.slice('staff_token_'.length))).split(':');
    if (parts.length !== 6 || parts[0] !== 'stf') return { valid: false, reason: 'malformed_staff_token' };
    const [, id, role, verStr, expStr, sigB64] = parts;
    const exp = parseInt(expStr, 10);
    if (Number.isNaN(exp) || exp < Math.floor(Date.now() / 1000)) return { valid: false, reason: 'expired_token' };
    const key = await getHmacKey(secret);
    const ok = await crypto.subtle.verify('HMAC', key, unb64url(sigB64), encoder.encode(`stf:${id}:${role}:${verStr}:${expStr}`));
    if (!ok) return { valid: false, reason: 'invalid_signature' };
    return { valid: true, id, role, version: parseInt(verStr, 10) };
  } catch (e) {
    return { valid: false, reason: 'verification_failed' };
  }
}
