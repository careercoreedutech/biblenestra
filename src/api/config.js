// Backend configuration — decides which "mode" the app runs in.
//
//   local       no API URL → everything stays on this device (the original behaviour)
//   online      API URL + Clerk publishable key → Clerk sign-in required, data comes from the API
//   dev-online  API URL + a dev user id (development builds only) → talks to a Worker running with
//               AUTH_DEV_MODE=true using the `X-Dev-User` header instead of a Clerk token
//
// Metro inlines EXPO_PUBLIC_* variables when the bundler starts, so for the web preview we also accept
// a URL override:  http://localhost:8081/?api=http://localhost:8787&devUser=alice
// (web + __DEV__ only — it can never switch a production build). Native dev builds can set
// EXPO_PUBLIC_DEV_USER instead. A dev user is ignored in production builds.
import { Platform } from 'react-native';

const DEV = typeof __DEV__ !== 'undefined' && __DEV__;

function webOverride() {
  if (!DEV || Platform.OS !== 'web' || typeof window === 'undefined' || !window.location) return {};
  try {
    const q = new URLSearchParams(window.location.search);
    const api = q.get('api');
    const devUser = q.get('devUser');
    // `?api=local` forces local mode even when env vars are set
    if (api === 'local' || api === 'off') return { forceLocal: true };
    return { api: api || null, devUser: devUser || null };
  } catch (e) {
    return {};
  }
}

const trimSlash = (u) => String(u || '').trim().replace(/\/+$/, '');

function resolveConfig() {
  const o = webOverride();
  const envApi = process.env.EXPO_PUBLIC_API_URL;
  const envClerk = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const envDevUser = process.env.EXPO_PUBLIC_DEV_USER;

  const apiUrl = o.forceLocal ? '' : trimSlash(o.api || envApi);
  const clerkKey = String(envClerk || '').trim();
  // Dev user: only ever honoured in development bundles.
  const devUser = DEV ? String(o.devUser || envDevUser || '').trim() : '';

  let mode = 'local';
  if (apiUrl && devUser) mode = 'dev-online';
  else if (apiUrl && clerkKey) mode = 'online';
  else if (apiUrl && DEV) {
    // An API URL without a Clerk key (and no dev user) can't authenticate — stay local, but say why.
    // eslint-disable-next-line no-console
    console.warn('[api] EXPO_PUBLIC_API_URL is set but there is no EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY or dev user — running in local mode.');
  }

  return {
    mode,
    online: mode !== 'local',
    apiUrl: mode === 'local' ? '' : apiUrl,
    clerkKey: mode === 'online' ? clerkKey : '',
    devUser: mode === 'dev-online' ? devUser : '',
  };
}

export const API_CONFIG = resolveConfig();

export const MODE_LABEL = { local: 'Local', online: 'Online', 'dev-online': 'Online (dev)' };

/** Absolute URL for a path or URL returned by the API (e.g. `/media/abc.jpg`). */
export function absoluteUrl(u) {
  if (!u) return u;
  if (/^(https?:|data:|blob:|file:)/i.test(u)) return u;
  return API_CONFIG.apiUrl + (u.startsWith('/') ? u : '/' + u);
}
