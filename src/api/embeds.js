// POST FROM A LINK — client helpers. The server validates every link (backend/src/lib/postEmbeds.js) and returns
// the preview card; these helpers only build what the app plays and credits. Nothing is downloaded: the provider's
// own embed is played in-app.

export const EMBED_PROVIDER_LABEL = { youtube: 'YouTube', facebook: 'Facebook' };

/** Quick shape check before asking the server (the server still decides) */
export function looksLikeVideoLink(raw) {
  const s = String(raw || '').trim();
  return s.length > 0 && s.length <= 500 && /^https?:\/\/[^\s]+$/i.test(s);
}

/** YouTube's official embed (the in-app player) */
export const youtubeEmbedSrc = (videoId) => `https://www.youtube.com/embed/${videoId}?playsinline=1&rel=0&modestbranding=1`;

/** Facebook's official video plugin for the canonical video URL */
export const facebookPluginSrc = (url) => `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=false`;

/** Stored embed → the picture and title a card shows, whatever the provider */
export function embedCard(embed) {
  if (!embed) return null;
  return {
    provider: embed.provider,
    label: EMBED_PROVIDER_LABEL[embed.provider] || 'Video',
    title: embed.title || null,
    authorName: embed.authorName || null,
    thumbnailUrl: embed.thumbnailUrl || null,
    url: embed.url,
  };
}
