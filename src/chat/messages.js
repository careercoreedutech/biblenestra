// Shared chat message logic for direct chats and group channels (ROUND 4: message actions).
// Pure functions only (no React) — used by the store reducer, the sync layer and the chat screens.
//
// A "scope" says where a thread's messages live in the store:
//   'dm:<chatId>'            → state.chats[i].messages
//   'grp:<groupId>:<channel>' → state.groupMessages[groupId][channel]

export const REACTIONS = ['🙏', '❤️', '🙌', '👍', '😂', '😢', '🔥', '🕊️'];
export const EDIT_WINDOW_MS = 15 * 60e3; // CHAT 7.3: short edit window (matches backend/src/lib/messages.js)
export const MAX_PINS = 3;

export const isServerId = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ''));

export const dmScope = (chatId) => `dm:${chatId}`;
export const groupScope = (gid, channel) => `grp:${gid}:${channel}`;

export function parseScope(scope = '') {
  if (scope.startsWith('dm:')) return { kind: 'dm', chatId: scope.slice(3) };
  if (scope.startsWith('grp:')) {
    const rest = scope.slice(4);
    const i = rest.indexOf(':');
    return { kind: 'grp', gid: rest.slice(0, i), channel: rest.slice(i + 1) };
  }
  return { kind: 'none' };
}

export function getScopeMsgs(s, scope) {
  const p = parseScope(scope);
  if (p.kind === 'dm') return ((s.chats || []).find((c) => c.id === p.chatId) || {}).messages || [];
  if (p.kind === 'grp') return ((s.groupMessages || {})[p.gid] || {})[p.channel] || [];
  return [];
}

const fmtSecs = (ms) => { const t = Math.max(0, Math.round((ms || 0) / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
// CHAT 7.3: one-line preview — "🎤 Voice note (0:42)", "📄 Notes.pdf", "🎥 Video"
export const previewOf = (m) => (m.deleted ? 'This message was deleted' : m.shared ? sharedPreviewOf(m.shared) : m.text || (m.passage ? 'Shared a passage' : m.image ? '📷 Photo'
  : m.video ? '🎥 Video' : m.file ? `📄 ${m.file.name || 'Document'}`
    : m.voice ? (m.voice.isFile ? `🎵 ${m.voice.name || 'Audio'}` : `🎤 Voice note${m.voice.durationMs ? ` (${fmtSecs(m.voice.durationMs)})` : ''}`) : m.audio ? 'Voice message' : ''));

// MEMBERSHIP GROUPS: a MASTER CLASS post shared into EXECUTIVE CLASS — "📣 MASTER CLASS: Week 2 is live"
function sharedPreviewOf(sh) {
  if (!sh || sh.deleted) return 'This post was deleted';
  const k = sh.kind;
  const name = (sh.meta && sh.meta.name) || '';
  const what = sh.text || (k === 'image' ? '📷 Photo' : k === 'video' ? '🎥 Video' : k === 'file' ? `📄 ${name || 'Document'}` : k === 'voice' ? (sh.meta && sh.meta.file ? `🎵 ${name || 'Audio'}` : '🎤 Voice note') : 'New post');
  return `📣 MASTER CLASS: ${what}`;
}

// Google Meet links in messages ("Start a video call") — tappable to join
export const MEET_LINK_RE = /https?:\/\/meet\.google\.com\/[a-z]{3,4}-[a-z]{4}-[a-z]{3,4}(\?[^\s]*)?/i;
export function findMeetLink(text = '') {
  const m = String(text || '').match(MEET_LINK_RE);
  if (m) return m[0];
  const bare = String(text || '').match(/\bmeet\.google\.com\/[a-z]{3,4}-[a-z]{4}-[a-z]{3,4}\b/i);
  return bare ? `https://${bare[0]}` : null;
}

// Returns a store patch that writes `msgs` (and optional extra chat fields) into the scope.
export function scopePatch(s, scope, msgsIn, chatExtra = {}) {
  const p = parseScope(scope);
  // CHAT 7.3: the device cache keeps the newest 1000 messages per thread (older ones reload from the server)
  const msgs = msgsIn && msgsIn.length > 1000 ? msgsIn.slice(-1000) : msgsIn;
  if (p.kind === 'dm') {
    const list = s.chats || [];
    const exists = list.some((c) => c.id === p.chatId);
    if (!exists) {
      const lastMsg = msgs[msgs.length - 1];
      const newChat = {
        id: p.chatId,
        with: chatExtra.with || 'Direct message',
        type: 'Direct message',
        messages: msgs,
        last: lastMsg ? previewOf(lastMsg) : '',
        time: 'Just now',
        unread: 0,
        ...chatExtra,
      };
      return { chats: [newChat, ...list] };
    }
    return {
      chats: list.map((c) => {
        if (c.id !== p.chatId) return c;
        const lastMsg = msgs[msgs.length - 1];
        return { ...c, messages: msgs, ...(lastMsg ? { last: previewOf(lastMsg) } : {}), ...chatExtra };
      }),
    };
  }
  if (p.kind === 'grp') {
    const g = (s.groupMessages || {})[p.gid] || {};
    return { groupMessages: { ...(s.groupMessages || {}), [p.gid]: { ...g, [p.channel]: msgs } } };
  }
  return {};
}

// Server conversation id behind a scope (null in local mode / for device-only threads).
export function scopeConversationId(s, scope) {
  const p = parseScope(scope);
  if (p.kind === 'dm') return isServerId(p.chatId) ? p.chatId : null;
  if (p.kind === 'grp') {
    const g = (s.communities || []).find((c) => c.id === p.gid);
    const ch = g && (g.channels || []).find((x) => x.name === p.channel);
    return ch && isServerId(ch.conversationId) ? ch.conversationId : null;
  }
  return null;
}

// Every scope that shows a server conversation (a channel can be open as a group and in the chat list).
export function scopesForConversation(s, convId) {
  const out = [];
  if ((s.chats || []).some((c) => c.id === convId)) out.push(dmScope(convId));
  for (const g of s.communities || []) {
    for (const ch of g.channels || []) if (ch.conversationId === convId) out.push(groupScope(g.id, ch.name));
  }
  if (!out.length && isServerId(convId)) {
    out.push(dmScope(convId));
  }
  return out;
}

export function fmtClock(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const now = new Date();
  const hm = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return hm;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday ${hm}`;
  if (now - d < 6 * 864e5) return `${d.toLocaleDateString([], { weekday: 'short' })} ${hm}`;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

// Server message → the shape the chat screens render.
export function mapServerMessage(m, prev) {
  const createdAt = Date.parse(m.createdAt) || Date.now();
  const meta = m.meta || {};
  return {
    id: m.id,
    from: m.isMe ? 'You' : (m.sender && m.sender.displayName) || 'Friend',
    senderId: m.senderId,
    avatarUrl: m.sender && m.sender.avatarUrl,
    mine: !!m.isMe,
    createdAt,
    time: fmtClock(createdAt),
    kind: m.kind,
    text: m.deleted ? '' : m.text,
    passage: !m.deleted && meta.passage ? meta.passage : undefined,
    prayer: !m.deleted && m.kind === 'prayer' ? true : undefined,
    event: !m.deleted && m.kind === 'event' ? (meta.event || true) : undefined,
    // chat media + coin gifts
    image: !m.deleted && m.kind === 'image' && m.mediaKey ? { key: m.mediaKey, width: meta.width || 0, height: meta.height || 0 } : undefined,
    voice: !m.deleted && m.kind === 'voice' && m.mediaKey ? { key: m.mediaKey, durationMs: meta.durationMs || 0, name: meta.name || null, isFile: !!meta.file, waveform: Array.isArray(meta.waveform) ? meta.waveform : null } : undefined, // VOICE NOTES: + waveform
    // CHAT 7.4: documents / any file, videos, system lines ("Grace added Daniel"), forwarded, @mentions
    file: !m.deleted && m.kind === 'file' && m.mediaKey ? { key: m.mediaKey, name: meta.name || 'Document', mime: meta.mime || '', size: meta.size || 0 } : undefined,
    video: !m.deleted && m.kind === 'video' && m.mediaKey ? { key: m.mediaKey, name: meta.name || 'Video', size: meta.size || 0, width: meta.width || 0, height: meta.height || 0, durationMs: meta.durationMs || 0 } : undefined,
    system: m.kind === 'system' ? true : undefined,
    forwarded: !m.deleted && meta.forwarded ? true : undefined,
    mentions: !m.deleted && Array.isArray(meta.mentions) ? meta.mentions : undefined,
    gift: !m.deleted && meta.gift ? { coins: meta.gift.coins || 0, toUserId: meta.gift.toUserId, toName: meta.gift.toName || '', note: meta.gift.note || null } : undefined,
    vgift: !m.deleted && m.kind === 'gift' && meta.vgift ? meta.vgift : undefined, // VIRTUAL GIFTS: Gifting Coin gift bubble (components/gifts/GiftBubble)
    praying: prev ? prev.praying : undefined,
    prayedByMe: prev ? prev.prayedByMe : undefined,
    status: prev && prev.status === 'read' ? 'read' : 'sent',
    edited: !!m.editedAt,
    deleted: !!m.deleted,
    deletedByModerator: !!m.deletedByModerator,
    pinned: !!m.pinned,
    pinnedAt: m.pinnedAt ? Date.parse(m.pinnedAt) : prev ? prev.pinnedAt : undefined,
    reactions: m.reactions || [],
    linkPreview: !m.deleted && m.linkPreview ? m.linkPreview : undefined, // CHAT GAPS: { url, title, description, image, siteName }
    reply: m.reply ? { id: m.reply.id, from: m.reply.senderName || 'Message', text: m.reply.text, deleted: !!m.reply.deleted } : null,
    // MEMBERSHIP GROUPS: the MASTER CLASS original behind a shared post (rendered by components/chat/SharedPost)
    shared: !m.deleted && m.kind === 'shared_post' ? (m.shared || { deleted: true, commentsOff: true }) : undefined,
    commentsOff: !m.deleted && meta.commentsOff ? true : undefined, // a MASTER CLASS post with comments switched off
  };
}

// Merge a server page (oldest→newest) with what's on screen, keeping just-sent messages still in flight.
export function mergeServerPage(current, serverMsgs) {
  const byId = new Map(current.map((m) => [m.id, m]));
  const mapped = serverMsgs.map((m) => mapServerMessage(m, byId.get(m.id)));
  const ids = new Set(mapped.map((m) => m.id));
  // CHAT 7.3: a local message whose server copy arrived (same clientId) is replaced; failed ones stay until retried
  const delivered = new Set(serverMsgs.map((m) => m.clientId).filter(Boolean));
  const recent = Date.now() - 2 * 60e3;
  const pending = current.filter((m) => !isServerId(m.id) && m.mine && !ids.has(m.id) && !delivered.has(m.id)
    && (m.status === 'failed' || (m.createdAt || 0) > recent));
  // keep older history already on the device (loaded by scrolling up / cached) below the newest page
  const oldest = mapped.length ? Math.min(...mapped.map((m) => m.createdAt || 0)) : 0;
  const older = mapped.length && serverMsgs.length >= 50
    ? current.filter((m) => isServerId(m.id) && !ids.has(m.id) && (m.createdAt || 0) < oldest)
    : [];
  return [...older, ...mapped, ...pending];
}

export function upsertMessage(list, msg, localId) {
  const i = list.findIndex((m) => m.id === msg.id || (localId && m.id === localId));
  if (i === -1) return [...list, msg];
  const next = list.slice();
  next[i] = { ...list[i], ...msg };
  // the server echo can arrive twice (send response + realtime) — drop duplicates
  return next.filter((m, j) => j === i || m.id !== msg.id);
}

// MEMBERSHIP GROUPS: a publisher's MASTER CLASS post (text, or a media caption) can be edited any time, as the server allows.
// Everyone else: their own text messages within the 15-minute window.
export function canEditMessage(m, { publisher = false } = {}) {
  if (!m || !m.mine || m.deleted) return false;
  if (publisher) return !m.system && ['text', 'image', 'video', 'file', 'voice'].includes(m.kind || 'text');
  if (m.audio || m.gift || m.image || m.voice || m.file || m.video || m.system || m.forwarded || (m.kind && !['text', 'verse', 'prayer'].includes(m.kind))) return false;
  if (!m.text) return false;
  return !m.createdAt || Date.now() - m.createdAt < EDIT_WINDOW_MS;
}

// Optimistic message operation. op: 'edit' | 'delete' | 'deleteMe' | 'pin' | 'unpin' | 'react'
export function applyMessageOp(list, { id, op, text, emoji }) {
  if (op === 'deleteMe') return list.filter((m) => m.id !== id);
  if (op === 'pin') {
    const out = list.map((m) => (m.id === id ? { ...m, pinned: true, pinnedAt: Date.now() } : m));
    const pinned = out.filter((m) => m.pinned).sort((a, b) => (b.pinnedAt || 0) - (a.pinnedAt || 0));
    const keep = new Set(pinned.slice(0, MAX_PINS).map((m) => m.id));
    return out.map((m) => (m.pinned && !keep.has(m.id) ? { ...m, pinned: false } : m));
  }
  return list.map((m) => {
    if (m.id !== id) return m;
    if (op === 'edit') return { ...m, text, edited: true };
    if (op === 'delete') return { ...m, deleted: true, text: '', passage: undefined, prayer: undefined, event: undefined, audio: null, image: undefined, voice: undefined, gift: undefined, pinned: false, reactions: [] };
    if (op === 'unpin') return { ...m, pinned: false };
    if (op === 'react') {
      const rs = (m.reactions || []).map((r) => ({ ...r }));
      const prevMine = rs.find((r) => r.mine);
      if (prevMine) { prevMine.count -= 1; prevMine.mine = false; }
      if (emoji && (!prevMine || prevMine.emoji !== emoji)) {
        const r = rs.find((x) => x.emoji === emoji);
        if (r) { r.count += 1; r.mine = true; } else rs.push({ emoji, count: 1, mine: true });
      }
      return { ...m, reactions: rs.filter((r) => r.count > 0).sort((a, b) => b.count - a.count) };
    }
    return m;
  });
}

export const pinnedOf = (list) => list.filter((m) => m.pinned && !m.deleted).sort((a, b) => (b.pinnedAt || 0) - (a.pinnedAt || 0));

// What to send to POST /conversations/:id/messages for a local message.
export function outgoingBody(m) {
  const body = { kind: 'text', text: m.text || '', clientId: m.id };
  if (m.passage) { body.kind = 'verse'; body.meta = { passage: m.passage }; }
  else if (m.prayer) body.kind = 'prayer';
  else if (m.event) { body.kind = 'event'; body.meta = { event: m.event === true ? {} : m.event }; }
  if (m.reply && isServerId(m.reply.id)) body.replyTo = m.reply.id;
  if (m.mentions && m.mentions.length) body.meta = { ...(body.meta || {}), mentions: m.mentions }; // CHAT 7.4: @mentions
  return body;
}

// ---------- CHAT 7.3: ordering, ticks, times ----------
// Server messages by time, then the ones still sending / failed at the bottom in the order they were written.
export function sortThread(list) {
  const sent = []; const pending = [];
  for (const m of list || []) (isServerId(m.id) ? sent : pending).push(m);
  sent.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  return pending.length ? [...sent, ...pending] : sent;
}

// 'sending' | 'failed' | 'sent' | 'delivered' | 'read' for my own messages (null for others').
// receipts = { readAt, deliveredAt } — the oldest other member's (from the server).
export function messageStatus(m, receipts) {
  if (!m || !m.mine || m.system) return null;
  if (m.status === 'failed') return 'failed';
  if (!isServerId(m.id) || m.status === 'sending') return 'sending';
  const at = m.createdAt || 0;
  const r = receipts || {};
  if (r.readAt && Date.parse(r.readAt) >= at - 1000) return 'read';
  if (r.deliveredAt && Date.parse(r.deliveredAt) >= at - 1000) return 'delivered';
  if (m.status === 'read') return 'read';
  return 'sent';
}

// Chat-list time: "now", "5m", "14:20", "Yesterday", "Tue", "3 weeks ago", "2 months ago"
export function relTime(ms) {
  if (!ms) return '';
  const d = new Date(ms); const now = new Date();
  const diff = now - d;
  if (diff < 60e3) return 'now';
  if (diff < 3600e3) return `${Math.floor(diff / 60e3)}m`;
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  const days = Math.floor(diff / 864e5);
  if (days < 7) return d.toLocaleDateString([], { weekday: 'short' });
  if (days < 30) { const w = Math.floor(days / 7); return w === 1 ? 'a week ago' : `${w} weeks ago`; }
  if (days < 365) { const mo = Math.floor(days / 30); return mo === 1 ? 'a month ago' : `${mo} months ago`; }
  const yr = Math.floor(days / 365); return yr === 1 ? 'a year ago' : `${yr} years ago`;
}

// Day separators inside a thread: "Today", "Yesterday", "Monday", "12 March 2026"
export function dayLabel(ms) {
  const d = new Date(ms || Date.now()); const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  if (now - d < 6 * 864e5) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

// "online", "last seen 5m ago", "last seen yesterday at 14:20"
export function presenceLabel(p) {
  if (!p || p.hidden) return '';
  if (p.online) return 'online';
  if (!p.lastSeenAt) return '';
  const t = Date.parse(p.lastSeenAt); const diff = Date.now() - t;
  if (diff < 3600e3) return `last seen ${Math.max(1, Math.floor(diff / 60e3))}m ago`;
  const d = new Date(t); const now = new Date();
  const hm = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `last seen today at ${hm}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `last seen yesterday at ${hm}`;
  return `last seen ${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}`;
}

export function typingLabel(names, isGroup) {
  const n = (names || []).filter(Boolean);
  if (!n.length) return '';
  if (!isGroup) return 'Typing…';
  if (n.length === 1) return `${n[0]} is typing…`;
  if (n.length === 2) return `${n[0]} and ${n[1]} are typing…`;
  return `${n.length} people are typing…`;
}

export const fmtBytes = (b) => (!b ? '' : b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`);
