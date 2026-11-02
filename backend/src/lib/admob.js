// AdMob rewarded-ad server-side verification (SSV).
// https://developers.google.com/admob/android/ssv — Google signs the callback query string with ECDSA (P-256, SHA-256).
const KEYS_URL = 'https://www.gstatic.com/admob/reward/verifier-keys.json';
let keyCache = { at: 0, keys: new Map() };

function b64ToBytes(b64) {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4));
  return Uint8Array.from(s, (ch) => ch.charCodeAt(0));
}

// DER-encoded ECDSA signature → raw r||s (64 bytes) as WebCrypto expects
export function derToRaw(der) {
  let i = 2;
  if (der[1] & 0x80) i = 2 + (der[1] & 0x7f);
  const read = () => {
    if (der[i] !== 0x02) throw new Error('bad DER');
    const len = der[i + 1];
    let v = der.slice(i + 2, i + 2 + len);
    i += 2 + len;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    const out = new Uint8Array(32); out.set(v, 32 - v.length); return out;
  };
  const r = read(); const s = read();
  const raw = new Uint8Array(64); raw.set(r, 0); raw.set(s, 32); return raw;
}

async function getKey(keyId, fetchImpl = fetch) {
  if (Date.now() - keyCache.at > 12 * 3600 * 1000 || !keyCache.keys.has(String(keyId))) {
    const res = await fetchImpl(KEYS_URL);
    const data = await res.json();
    const keys = new Map();
    for (const k of data.keys || []) {
      keys.set(String(k.keyId), await crypto.subtle.importKey('spki', b64ToBytes(k.base64), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']));
    }
    keyCache = { at: Date.now(), keys };
  }
  return keyCache.keys.get(String(keyId));
}

// Returns the parsed params when the signature is valid, otherwise null.
export async function verifySsv(url, { fetchImpl, keyOverride } = {}) {
  const u = new URL(url);
  const qs = u.search.slice(1);
  const at = qs.indexOf('&signature=');
  if (at < 0) return null;
  const message = qs.slice(0, at);
  const params = u.searchParams;
  const sig = params.get('signature');
  const keyId = params.get('key_id');
  if (!sig || !keyId) return null;
  const key = keyOverride || (await getKey(keyId, fetchImpl));
  if (!key) return null;
  let ok = false;
  try {
    ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(b64ToBytes(sig)), new TextEncoder().encode(message));
  } catch (e) { return null; } // malformed signature
  if (!ok) return null;
  return Object.fromEntries(params.entries());
}
