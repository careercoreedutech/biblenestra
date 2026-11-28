// PACKAGE F — view counts. The server decides what counts (backend lib/videoViews.js: minimum watch time, cooldown,
// author's own plays ignored, rate limits), so the app only reports what it really played.
export const recordVideoPlay = (api, postId, watchedMs) => api.request('POST', `/posts/${postId}/video-view`, { watchedMs: Math.round(watchedMs) });
export const recordPostViews = (api, ids) => api.request('POST', '/posts/views', { ids: (ids || []).slice(0, 50) });
export const postCounts = (api, postId) => api.request('GET', `/posts/${postId}/counts`);
