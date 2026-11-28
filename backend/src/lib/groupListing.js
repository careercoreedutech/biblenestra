// PACKAGE F — group search listing and chat-list rules (routes/groupDiscovery.js).
// A group appears in "Search groups" only when its admins list it (conversations.listed = true). Membership groups
// (MASTER CLASS / EXECUTIVE CLASS, conversations.membership_id set) are never listed, searched, pinned, hidden or deleted
// from the chat list: they belong to the memberships feature.
import { bad, forbidden } from './http.js';

export const GROUP_CATEGORIES = [
  'Church', 'Christian community', 'Bible study', 'Prayer', 'Fellowship', 'Youth', 'Women', 'Men',
  'Music and worship', 'Missions', 'Singles', 'Marriage and family', 'Other',
];

const parseJ = (v) => (v == null ? {} : typeof v === 'string' ? JSON.parse(v) : v);

/** 'public' | 'private'. Groups start private: an owner has to choose public on purpose. */
export function visibilityOf(conv) {
  return parseJ(conv && conv.settings).visibility === 'public' ? 'public' : 'private';
}

/** Search listing follows visibility: a public group is listed by default, a private one is not. Admins can still unlist. */
export function listedFor(visibility) {
  return visibility === 'public';
}

/** Public groups join straight away unless the group asks for approval; private groups always go through a request. */
export function joinPath(conv) {
  const s = parseJ(conv && conv.settings);
  if (visibilityOf(conv) === 'private') return 'request';
  return s.approveJoins ? 'request' : 'join';
}

const clean = (v, max, field) => {
  if (v == null) return '';
  if (typeof v !== 'string') throw bad(`${field} must be text`, 'BAD_LISTING');
  const t = v.trim().replace(/\s+/g, ' ');
  if (t.length > max) throw bad(`${field} is too long (max ${max} characters)`, 'BAD_LISTING');
  return t;
};

/** Validate the listing fields an admin sets on a group. Missing keys keep their current value (caller merges). */
export function listingInput(b = {}) {
  const out = {};
  if (b.listed !== undefined) {
    if (typeof b.listed !== 'boolean') throw bad('listed must be true or false', 'BAD_LISTING');
    out.listed = b.listed;
  }
  if (b.visibility !== undefined) {
    if (!['public', 'private'].includes(b.visibility)) throw bad('visibility is public or private', 'BAD_LISTING');
    out.visibility = b.visibility;
  }
  if (b.category !== undefined) {
    const c = clean(b.category, 40, 'Category');
    if (c && !GROUP_CATEGORIES.includes(c)) throw bad('Choose a category from the list', 'BAD_LISTING');
    out.category = c || null;
  }
  if (b.country !== undefined) out.country = clean(b.country, 60, 'Country') || null;
  if (b.city !== undefined) out.city = clean(b.city, 60, 'City') || null;
  if (b.churchName !== undefined) out.churchName = clean(b.churchName, 80, 'Church name') || null;
  return out;
}

/** What the app shows for a group's listing (settings card + search result chips). */
export function listingShape(conv) {
  return {
    listed: !!conv.listed,
    visibility: visibilityOf(conv),
    category: conv.category || null,
    country: conv.country || null,
    city: conv.city || null,
    churchName: conv.church_name || null,
  };
}

/** Delete a group for everyone: owners and admins only, never a membership section, never a DM or a channel. */
export function assertCanDeleteGroup(conv, role) {
  if (!conv || conv.kind !== 'group') throw bad('Only groups can be deleted this way', 'NOT_A_GROUP');
  if (conv.membership_id) throw forbidden('This is a membership section. Manage it from its membership.', 'MEMBERSHIP_GROUP');
  if (role !== 'owner' && role !== 'admin') throw forbidden('Only the group owner or an admin can delete this group', 'ADMIN_ONLY');
}

/** Pin, mute and "remove from my list" are about my own list: any member, group or channel or DM, but not membership sections. */
export function assertListAction(conv, role, action) {
  if (!conv) throw bad('Chat not found', 'NOT_FOUND');
  if (!role) throw forbidden('Not a member of this chat', 'FORBIDDEN');
  if (conv.membership_id) throw forbidden('Membership sections stay in their membership', 'MEMBERSHIP_GROUP');
  if (action === 'hide' && role === 'owner') throw forbidden('The owner can’t remove this group from their list. Delete it instead.', 'OWNER_HIDE');
  if (action === 'hide' && conv.kind === 'dm') throw bad('Chats with one person can’t be removed from the list', 'NOT_A_GROUP');
}

export const likePattern = (s) => '%' + String(s).replace(/[\\%_]/g, (ch) => '\\' + ch) + '%';
