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
//   biblenestra://chat/<conversationId>[?title=…] → that chat (CHAT PUSH)
//   biblenestra://portfolio/invite/<code> · biblenestra://partner/invite/<code> → Portfolio & Partners Apply screen
// The "biblenestra" scheme is registered by app.json ("scheme"), so Android routes these to the app.
import { useEffect } from 'react';
import { Linking, Platform } from 'react-native';
import { openTarget } from './daily';
import { openChatFromData } from './push'; // CHAT PUSH
import { parsePortfolioInviteLink, rememberPartnerInvite } from '../portfolio/inviteMemory'; // PORTFOLIO invite links

const KNOWN = ['daily', 'devotional', 'prayer', 'companion', 'community', 'inbox', 'bible', 'listen', 'reading', 'notifications', 'today'];
KNOWN.push('chat'); // CHAT PUSH: biblenestra://chat/<conversationId>

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
      const portfolioCode = parsePortfolioInviteLink(url);
      if (portfolioCode) { rememberPartnerInvite(portfolioCode); nav.push('PortfolioApply', { code: portfolioCode }); return; }
      const link = parseDeepLink(url);
      if (link && link.target === 'chat') { if (link.params.id) openChatFromData(nav, { conversationId: link.params.id, chatTitle: link.params.title }); return; } // CHAT PUSH
      if (link) openTarget(nav, link.target, link.params);
    };
    Linking.getInitialURL().then((url) => {
      if (url && url !== lastInitial) { lastInitial = url; go(url); }
    }).catch(() => {});
    const sub = Linking.addEventListener('url', (e) => go(e && e.url));
    return () => sub.remove();
  }, [!!nav]);
}

// ---------- CHAT GAPS: group invite links opened from outside the app ----------
//   biblenestra://join/<code>   (the "Open in BibleNestra" button on the Worker's /g/<code> landing page)
//   web: …?join=<code>
// → the existing "Join with a link" screen (JoinGroup), prefilled with the code (it shows the preview + Join).
export function parseGroupInviteLink(url) {
  if (!url || typeof url !== 'string') return null;
  const m = /^(?:biblenestra:\/\/|.*\/--\/)(?:join|g)\/([A-Za-z0-9]{6,32})(?:[/?#].*)?$/i.exec(url.trim());
  return m ? m[1] : null;
}

let lastInviteUrl = null; // the cold-start URL is only handled once per process

export function useGroupInviteLinks(nav) {
  useEffect(() => {
    if (!nav) return undefined;
    const open = (code) => { if (code) nav.push('JoinGroup', { code }); };
    if (Platform.OS === 'web') {
      try {
        const code = new URLSearchParams(window.location.search).get('join');
        if (code && /^[A-Za-z0-9]{6,32}$/.test(code) && lastInviteUrl !== code) { lastInviteUrl = code; open(code); }
      } catch (e) { /* no window */ }
      return undefined;
    }
    Linking.getInitialURL().then((url) => {
      const code = parseGroupInviteLink(url);
      if (code && url !== lastInviteUrl) { lastInviteUrl = url; open(code); }
    }).catch(() => {});
    const sub = Linking.addEventListener('url', (e) => open(parseGroupInviteLink(e && e.url)));
    return () => sub.remove();
  }, [!!nav]);
}
