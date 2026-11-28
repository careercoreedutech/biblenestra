// PACKAGE F — what the long-press menu on a chat in the list offers. Pure (no React Native) so it can be reasoned about
// and tested alone. The server enforces the same rules (backend lib/groupListing.js): delete is owner/admin only,
// membership sections never get delete / remove / leave here, and the owner cannot remove their own group from the list.
export function chatActionsFor(c) {
  const role = c.myRole || c.role || null;
  const isGroup = c.kind === 'group';
  const isChannel = c.kind === 'channel';
  const inMembership = !!c.membershipId;
  const items = [{ key: 'pin', label: c.pinned ? 'Unpin' : 'Pin to top' }];
  // Mute for a set time, or always; Unmute while the chat is muted. The server keeps the timed mute (PUT /conversations/:id/mute)
  items.push({ key: 'mute_8h', label: 'Mute for 8 hours' }, { key: 'mute_1w', label: 'Mute for 1 week' }, { key: 'mute_always', label: 'Mute always' });
  if (c.muted) items.push({ key: 'unmute', label: 'Unmute' });
  if (isGroup && !inMembership) {
    if (role === 'owner' || role === 'admin') items.push({ key: 'manage', label: 'Manage group' });
    if (role === 'owner' || role === 'admin') items.push({ key: 'delete', label: 'Delete group', danger: true });
    if (role && role !== 'owner') items.push({ key: 'hide', label: 'Remove from my list' });
    if (role) items.push({ key: 'leave', label: 'Leave group', danger: true });
  }
  if (isChannel && role && role !== 'owner') items.push({ key: 'leave', label: 'Unfollow channel', danger: true });
  return items;
}

/** Copy for the delete confirmation: says what happens to everyone, and that it cannot be undone. */
export function deleteConfirmText(c) {
  return {
    title: `Delete “${c.with || 'this group'}”?`,
    body: 'The group and all its messages are deleted for everyone in it. Members are told. This can’t be undone.',
  };
}
