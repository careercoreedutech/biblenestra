// API shapes (backend/API.md) → the store shapes the existing screens already render.
// Keep every mapper pure: (apiObject, extra?) → store object.
import { absoluteUrl } from './config';
import { colors } from '../theme';
import { passageLabel, initials, relTime } from '../components/social/shared';

export const toMs = (iso) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : Date.now();
};
export const ago = (iso) => relTime(toMs(iso), 'Just now');

/** Follow key used in state.follows for a server user (the Socials screen follows by handle). */
export const followKeyOf = (u) => (u ? '@' + (u.handle || u.id) : null);

function fmtDuration(sec) {
  const s = Math.round(Number(sec) || 0);
  if (!s) return '';
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function reactionFields(p) {
  const r = p.myReaction || null;
  return { liked: !!r, reaction: r && r !== 'like' ? r : null };
}

/** Text / photo post → state.feed item */
export function mapFeedPost(p, prev) {
  const a = p.author || {};
  const images = (p.images || []).map((i) => absoluteUrl(i.url)).filter(Boolean);
  return {
    id: p.id,
    author: a.displayName || 'Believer',
    authorId: a.id || null,
    authorHandle: followKeyOf(a),
    authorSub: a.handle ? '@' + a.handle : a.kind === 'church' ? 'Church' : a.kind === 'community' ? 'Community' : null,
    authorVerified: !!a.verified,
    authorAvatarUrl: a.avatarUrl ? absoluteUrl(a.avatarUrl) : null,
    kind: p.kind || 'Reflection',
    text: p.text || '',
    createdAt: toMs(p.createdAt),
    passage: p.passage || undefined,
    bg: p.theme || undefined,
    images,
    image: images[0],
    likes: p.likes || 0,
    comments: p.comments || 0,
    shares: p.shares || 0,
    views: p.views || 0,
    ...reactionFields(p),
    saved: !!p.saved,
    mine: !!p.mine,
    // keep comments already loaded for this post (they're fetched when the sheet opens)
    commentList: prev && prev.commentList ? prev.commentList : undefined,
    localId: prev && prev.localId ? prev.localId : undefined,
  };
}

/** Video post → state.videos item (the reels + inline video cards) */
export function mapVideoPost(p, prev) {
  const a = p.author || {};
  const v = p.video || {};
  const src = v.url || v.hls; // 720p MP4 in R2
  const ready = v.status === 'ready' && !!src;
  return {
    id: p.id,
    createdAt: toMs(p.createdAt),
    creator: {
      name: a.displayName || 'Creator',
      handle: followKeyOf(a), // follow key ('@handle', or '@<id>' for users without a handle)
      label: a.handle ? '@' + a.handle : '', // what the UI shows under the name
      verified: !!a.verified,
      avatar: initials(a.displayName || 'C'),
      church: a.church || '',
      userId: a.id || null,
      avatarUrl: a.avatarUrl ? absoluteUrl(a.avatarUrl) : null,
    },
    caption: p.text || '',
    scripture: p.passage ? passageLabel(p.passage) : '',
    passage: p.passage || undefined,
    category: v.category || p.category || 'Video',
    hashtags: v.category ? ['#' + String(v.category).replace(/\s+/g, '')] : [],
    duration: fmtDuration(v.duration),
    sound: `Original Audio · ${a.displayName || 'Creator'}`,
    videoUrl: ready ? absoluteUrl(src) : null,
    poster: v.thumbnail ? absoluteUrl(v.thumbnail) : null,
    videoUid: v.uid || null,
    videoStatus: v.status || 'processing',
    processing: !ready && v.status !== 'error',
    videoError: v.status === 'error',
    imageUrl: null,
    bg: colors.night,
    views: p.views || 0,
    likes: p.likes || 0,
    ...reactionFields(p),
    shares: p.shares || 0,
    reposts: 0,
    gifts: prev ? prev.gifts || 0 : 0,
    comments: prev && Array.isArray(prev.comments) ? prev.comments : [],
    commentCount: p.comments || 0,
    saved: !!p.saved,
    mine: !!p.mine,
    localId: prev && prev.localId ? prev.localId : undefined,
  };
}

/** Split a page of posts into feed items and video items. */
export function splitPosts(items, prevFeed = [], prevVideos = []) {
  const pf = new Map(prevFeed.map((x) => [x.id, x]));
  const pv = new Map(prevVideos.map((x) => [x.id, x]));
  const feed = [];
  const videos = [];
  (items || []).forEach((p) => {
    if (p.video) videos.push(mapVideoPost(p, pv.get(p.id)));
    else feed.push(mapFeedPost(p, pf.get(p.id)));
  });
  return { feed, videos };
}

/** Comment list → nested store comments ({ id, from, text, time, replies[] }) */
export function mapComments(items) {
  const byId = new Map();
  const roots = [];
  (items || []).forEach((c) => {
    const au = c.author || {};
    const m = {
      id: c.id, from: au.displayName || 'Believer', text: c.text, time: ago(c.createdAt), likes: c.likes || 0, liked: !!c.likedByMe, replies: [], mine: !!c.mine, parentId: c.parentId || null,
      authorId: au.id || null, avatarUrl: au.avatarUrl ? absoluteUrl(au.avatarUrl) : null, // SOCIAL r3: profile links + comment likes
    };
    byId.set(c.id, m);
  });
  byId.forEach((m) => {
    // replies to replies are flattened under their root comment
    let parent = m.parentId ? byId.get(m.parentId) : null;
    while (parent && parent.parentId && byId.get(parent.parentId)) parent = byId.get(parent.parentId);
    if (parent) parent.replies.push(m);
    else roots.push(m);
  });
  return roots;
}

export function mapPrayer(p) {
  const updates = [...(p.updates || [])]
    .sort((x, y) => toMs(y.createdAt) - toMs(x.createdAt))
    .map((u) => ({ id: u.id, text: u.text, when: ago(u.createdAt) }));
  return {
    id: p.id,
    author: p.anonymous || !p.author ? 'Anonymous' : p.author.displayName,
    authorId: p.author ? p.author.id : null,
    audience: p.audience || 'Public',
    title: p.title,
    body: p.body || '',
    status: p.status || 'active',
    praying: p.praying || 0,
    prayed: !!p.prayed,
    updates,
    created: ago(p.createdAt),
    createdAt: toMs(p.createdAt),
    verse: p.verse || null,
    anonymous: !!p.anonymous,
    mine: !!p.mine,
  };
}

const BID_STATUS = { pending: 'Pending Review', shortlisted: 'Shortlisted', accepted: 'Accepted', declined: 'Declined', withdrawn: 'Withdrawn' };

export function mapJob(j) {
  const c = j.client || {};
  return {
    id: j.id,
    kind: j.kind || 'job',
    title: j.title,
    client: { id: c.id || null, name: c.displayName || 'Client', church: c.church || '', verified: !!c.verified },
    category: j.category || 'Other',
    budget: j.budget || '',
    deadline: j.deadline || 'Flexible',
    skills: j.skills || [],
    description: j.description || '',
    proposalsCount: j.bids || 0,
    status: j.status || 'open',
    posted: ago(j.createdAt),
    createdAt: toMs(j.createdAt),
    mine: !!j.mine,
    myBid: j.myBid || null,
  };
}

export function mapBid(b, me) {
  return {
    id: b.id,
    jobId: b.jobId,
    jobTitle: b.jobTitle || '',
    time: ago(b.createdAt),
    status: BID_STATUS[b.status] || b.status || 'Pending Review',
    applicant: (me && me.displayName) || 'You',
    headline: (me && me.headline) || '',
    bidRate: b.amount || '',
    deliveryTime: b.timeline || 'Flexible',
    coverNote: b.cover || '',
    feeCoins: b.feeCoins || 0,
  };
}

const REASONS = {
  welcome: 'Welcome gift',
  admin_adjustment: 'Adjusted by the BibleNestra team', // ROUND 5
  job_bid: 'Bid on a job',
  job_ads: 'Unlocked by watching ads',
  contest_prize: 'Contest prize',
  game: 'Bible game reward',
  purchase: 'Coin purchase',
  gift: 'Gift',
};
export function mapLedger(items) {
  return (items || []).map((x, i) => ({
    id: 'cl_' + i + '_' + toMs(x.createdAt),
    amount: x.amount,
    reason: REASONS[x.reason] || String(x.reason || 'Coins').replace(/_/g, ' '),
    time: x.createdAt,
  }));
}

/** Me → state.user (merged over the existing on-device profile preferences) */
export function mapMeToUser(me, prevUser = {}) {
  const slug = String(me.displayName || 'friend').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') || 'friend';
  return {
    ...prevUser,
    id: me.id,
    displayName: me.displayName || 'Friend',
    username: me.handle || slug,
    headline: me.headline || prevUser.headline || '',
    bio: me.bio || '',
    country: me.country || '',
    church: { ...(prevUser.church || {}), name: me.church || '', visible: me.church ? (prevUser.church && prevUser.church.name ? prevUser.church.visible !== false : true) : false },
    translation: me.translation || prevUser.translation || 'KJV',
    verified: !!me.verified,
    followers: me.followers || 0,
    following: me.following || 0,
    avatarUrl: me.avatarUrl ? absoluteUrl(me.avatarUrl) : null,
    bannerUrl: me.bannerUrl ? absoluteUrl(me.bannerUrl) : null,
  };
}

// ---------- Phase 2 mappers ----------

export function mapConversation(c, prev) {
  return {
    id: c.id,
    kind: c.kind,
    title: c.title,
    // the chat screens show `with` / `type` (local shape) — SOCIAL r3: DMs opened from a profile
    with: (prev && prev.with) || c.title || (c.otherUser && c.otherUser.displayName) || 'Chat',
    type: (prev && prev.type) || (c.kind === 'dm' ? 'Direct message' : c.kind === 'channel' ? 'Channel' : 'Group chat'),
    description: c.description || '',
    membersCount: c.membersCount || 0,
    communityName: c.communityName || null,
    avatarKey: c.avatarKey,
    otherUser: c.otherUser,
    role: c.role || 'member',
    muted: !!c.muted,
    unreadCount: c.unreadCount || 0,
    isRequest: !!c.isRequest,
    otherFollowsMe: c.otherFollowsMe !== undefined ? !!c.otherFollowsMe : (prev?.otherFollowsMe ?? false),
    iFollowOther: c.iFollowOther !== undefined ? !!c.iFollowOther : (prev?.iFollowOther ?? false),
    canMessage: c.canMessage !== undefined ? !!c.canMessage : (c.kind !== 'dm' || !!c.otherFollowsMe || (prev?.canMessage ?? false)),
    lastMessage: c.lastMessage ? {
      id: c.lastMessage.id,
      kind: c.lastMessage.kind,
      text: c.lastMessage.text,
      senderId: c.lastMessage.senderId,
      time: ago(c.lastMessage.createdAt),
      deleted: !!c.lastMessage.deleted,
    } : null,
    lastMessageAt: toMs(c.lastMessageAt),
    messages: prev?.messages || [],
  };
}

export function mapMessage(m) {
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    sender: m.sender || null,
    isMe: !!m.isMe,
    kind: m.kind,
    text: m.text,
    mediaKey: m.mediaKey,
    meta: m.meta,
    replyTo: m.replyTo,
    createdAt: toMs(m.createdAt),
    time: ago(m.createdAt),
    deleted: !!m.deleted,
  };
}

export function mapCommunity(c) {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    description: c.description || '',
    privacy: c.privacy || 'Public',
    avatarKey: c.avatarKey,
    ownerId: c.ownerId,
    membersCount: c.membersCount || 1,
    // ROUND 4: fields the community screens render (server communities don't have them yet)
    members: c.membersCount || 1,
    category: c.category || 'Community',
    region: c.region || 'Global',
    language: c.language || 'English',
    verified: !!c.verified,
    rules: c.rules || 'Be kind, pray for one another and keep conversations about faith and fellowship.',
    myStatus: c.myStatus || null,
    myRole: c.myRole || null,
    channels: (c.channels || []).map((ch) => ({
      id: ch.id,
      name: ch.name,
      conversationId: ch.conversationId,
    })),
  };
}

export function mapEvent(e) {
  return {
    id: e.id,
    communityId: e.communityId,
    communityName: e.communityName,
    hostId: e.hostId,
    host: e.host,
    isHost: !!e.isHost,
    title: e.title,
    description: e.description || '',
    startsAt: toMs(e.startsAt),
    endsAt: toMs(e.endsAt),
    location: e.location || '',
    onlineUrl: e.onlineUrl || '',
    coverKey: e.coverKey,
    myRsvp: e.myRsvp || null,
    goingCount: e.goingCount || 0,
    interestedCount: e.interestedCount || 0,
  };
}

export function mapWish(w) {
  return {
    id: w.id,
    // The API sends author as a user object; the UI shows a plain name string.
    author: w.anonymous ? 'Anonymous Believer' : (w.author?.displayName || 'Believer'),
    title: w.title,
    body: w.body,
    category: w.category || 'Personal',
    visibility: w.visibility || 'Public',
    anonymous: !!w.anonymous,
    candlesCount: w.candlesCount || 0,
    amenCount: w.amenCount || 0,
    litCandle: !!w.litCandle,
    amened: !!w.amened,
    isMine: !!w.isMine,
    mine: !!w.isMine,
    createdAt: toMs(w.createdAt),
    time: ago(w.createdAt),
  };
}

export function mapNotification(n) {
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    data: n.data || {},
    read: !!n.read,
    createdAt: toMs(n.createdAt),
    time: ago(n.createdAt),
  };
}

