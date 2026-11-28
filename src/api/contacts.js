// USERNAME CONTACTS: an EXACT @username match becomes a contact before its chat opens, so that chat skips the free
// chat slots. Server: POST /contacts/by-handle (backend/src/routes/referrals.js). A refusal here (daily cap, switch
// off) is not an error for the user: the chat then opens under the normal free-chat rule. Blocks are still enforced
// by POST /conversations/dm.
export async function linkByHandle(api, person) {
  if (!api || !api.online || !person || person.matchRank !== 0 || !person.handle) return false;
  try {
    await api.request('POST', '/contacts/by-handle', { handle: person.handle, userId: person.id });
    return true;
  } catch (e) {
    return false;
  }
}
