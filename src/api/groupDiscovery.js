// PACKAGE F — Search groups, group listing, join, and the chat-list actions (backend routes/groupDiscovery.js).
export const GROUP_CATEGORIES = [
  'Church', 'Christian community', 'Bible study', 'Prayer', 'Fellowship', 'Youth', 'Women', 'Men',
  'Music and worship', 'Missions', 'Singles', 'Marriage and family', 'Other',
];

const qs = (params) => Object.entries(params)
  .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
  .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v).trim())}`).join('&');

export const searchGroups = (api, filters = {}) => api.request('GET', `/groups/search?${qs(filters)}`);
export const updateListing = (api, convId, listing) => api.request('PATCH', `/conversations/${convId}/listing`, listing);
export const joinGroup = (api, convId) => api.request('POST', `/conversations/${convId}/join`, {});
export const pinChat = (api, convId, pinned) => api.request('POST', `/conversations/${convId}/pin`, { pinned });
export const hideChat = (api, convId) => api.request('POST', `/conversations/${convId}/hide`, {});
export const deleteGroup = (api, convId) => api.request('DELETE', `/conversations/${convId}`);
