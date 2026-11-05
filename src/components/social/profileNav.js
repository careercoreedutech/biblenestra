// Tap a person's name / avatar anywhere in Socials → open their profile.
//   const openProfile = useOpenProfile();
//   openProfile({ userId, name, handle, mine })
// Online: server users open UserProfile (GET /users/:id). Local: seed people open the Person screen,
// communities open their group, anyone else gets a profile built from their posts on this device.
// Your own name / avatar opens your Profile.
import { useCallback } from 'react';
import { useNav } from '../../navigation';
import { useStore } from '../../store';
import { useSync } from '../../api/sync';
import { useToast } from '../Toast';
import { PEOPLE } from '../../data/seed';
import { isServerId } from '../../api/social';

export const norm = (s) => String(s || '').toLowerCase().replace(/^(rev|dr|pastor|sister|brother|fr)\.?\s+/i, '').replace(/[^a-z0-9]/g, '');

/** Seed person for a name / handle (local mode) */
export function findSeedPerson(name, handle) {
  const n = norm(name);
  const h = norm(handle);
  return PEOPLE.find((p) => (h && norm(p.username) === h) || (n && norm(p.name) === n)) || null;
}

export function useOpenProfile() {
  const nav = useNav();
  const { state } = useStore();
  const sync = useSync();
  const toast = useToast();
  const me = state.user || {};
  return useCallback((who = {}) => {
    const { userId, name, handle } = who;
    const isMe = who.mine || (userId && me.id && userId === me.id) || (!sync.online && !userId && name && name === me.displayName && !handle);
    if (isMe) { nav.push('Profile'); return; }
    if (sync.online) {
      if (isServerId(userId)) nav.push('UserProfile', { id: userId, name });
      else toast.show(`${name || 'This profile'} isn’t available yet`, { icon: 'user' });
      return;
    }
    const community = (state.communities || []).find((c) => c.name === name);
    if (community) { nav.push('Group', { id: community.id }); return; }
    const p = findSeedPerson(name, handle);
    if (p) { nav.push('Person', { id: p.id }); return; }
    nav.push('UserProfile', { name: name || 'Believer', handle: handle || null });
  }, [nav, sync.online, me.id, me.displayName, state.communities]);
}
