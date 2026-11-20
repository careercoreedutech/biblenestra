// DEEP LINKS (biblenestra://…): opened by the Android home-screen widgets (and any external link).
//   biblenestra://daily                       → Daily Bread
//   biblenestra://devotional                  → Devotionals
//   biblenestra://prayer                      → Prayer Wall
//   biblenestra://companion                   → Scripture Companion
//   biblenestra://community[/<groupId>]       → the group (or Communities)
//   biblenestra://inbox[?broadcastId=…]       → Activity (notification centre)
//   biblenestra://bible[?bookId=JHN&chapter=3&verse=16]
//   biblenestra://listen                      → audio library
//   biblenestra://reading                     → reading plans
//   biblenestra://notifications               → Settings › Notifications › Daily moments
// The "biblenestra" scheme is registered by app.json ("scheme"), so Android routes these to the app.
import { useEffect } from 'react';
import { Linking, Platform } from 'react-native';
import { openTarget } from './daily';

const KNOWN = ['daily', 'devotional', 'prayer', 'companion', 'community', 'inbox', 'bible', 'listen', 'reading', 'notifications', 'today'];

/** Parse a biblenestra:// (or Expo dev exp://…/--/…) URL into { target, params }, or null. */
export function parseDeepLink(url) {
  if (!url || typeof url !== 'string') return null;
  let rest = null;
  const m = /^biblenestra:\/\/(.*)$/i.exec(url);
  if (m) rest = m[1];
  else {
    const dev = /\/--\/(.*)$/.exec(url); // expo go / dev client
    if (dev) rest = dev[1];
  }
  if (rest == null) return null;
  const [pathPart, query = ''] = rest.split('?');
  const segs = pathPart.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
  const target = (segs[0] || 'today').toLowerCase();
  if (!KNOWN.includes(target)) return null;
  const params = {};
  query.split('&').filter(Boolean).forEach((kv) => {
    const [k, v = ''] = kv.split('=');
    try { params[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { /* skip bad pair */ }
  });
  if (segs[1] && !params.id) params.id = segs[1];
  return { target, params };
}

let lastInitial = null; // the cold-start URL is only handled once per process

export function useDeepLinks(nav) {
  useEffect(() => {
    if (Platform.OS === 'web' || !nav) return undefined;
    const go = (url) => {
      const link = parseDeepLink(url);
      if (link) openTarget(nav, link.target, link.params);
    };
    Linking.getInitialURL().then((url) => {
      if (url && url !== lastInitial) { lastInitial = url; go(url); }
    }).catch(() => {});
    const sub = Linking.addEventListener('url', (e) => go(e && e.url));
    return () => sub.remove();
  }, [!!nav]);
}
