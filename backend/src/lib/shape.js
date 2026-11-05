// SQL fragments and row → API shape converters (see API.md for the shapes).

// A user as JSON built inside SQL. `a` is the users-table alias.
export const userJson = (a) => `json_build_object(
  'id', ${a}.id, 'displayName', ${a}.display_name, 'handle', ${a}.handle, 'avatarUrl', ${a}.avatar_url,
  'headline', ${a}.headline, 'church', ${a}.church, 'kind', ${a}.kind, 'verified', ${a}.verified)`;

// Full post select. $1 must be the current user's id.
export const POST_SELECT = `
  SELECT p.*, ${userJson('u')} AS author,
    EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followee_id = u.id) AS author_followed,
    (SELECT r.reaction FROM reactions r WHERE r.post_id = p.id AND r.user_id = $1) AS my_reaction,
    EXISTS (SELECT 1 FROM saves s WHERE s.post_id = p.id AND s.user_id = $1) AS saved,
    COALESCE((SELECT json_agg(json_build_object('key', m.r2_key, 'width', m.width, 'height', m.height) ORDER BY m.position)
              FROM post_media m WHERE m.post_id = p.id), '[]'::json) AS images
  FROM posts p JOIN users u ON u.id = p.author_id`;

export function mediaUrl(env, origin, key) {
  const base = (env.PUBLIC_MEDIA_BASE || `${origin}/media`).replace(/\/$/, '');
  return `${base}/${key}`;
}

// Video files live in R2 (720p MP4); demo content may point at an external https URL.
export function videoUrls(env, origin, row) {
  const abs = (k) => (!k ? null : k.startsWith('http') ? k : mediaUrl(env, origin, k));
  const url = abs(row.video_url);
  return { url, hls: url /* kept for older app builds */, thumbnail: abs(row.video_thumb) };
}

export function postShape(row, me, env, origin) {
  const hasVideo = !!(row.video_uid || row.video_url);
  return {
    id: row.id,
    author: { ...row.author, isMe: row.author_id === me.id, isFollowing: !!row.author_followed },
    kind: row.kind,
    text: row.body,
    createdAt: new Date(row.created_at).toISOString(),
    passage: row.passage_book ? { bookId: row.passage_book, chapter: row.passage_ch, verse: row.passage_verse || undefined } : null,
    theme: row.theme,
    images: (typeof row.images === 'string' ? JSON.parse(row.images) : row.images || []).map((m) => ({ url: mediaUrl(env, origin, m.key), width: m.width, height: m.height })),
    video: hasVideo ? { uid: row.video_uid, status: row.video_status || 'ready', duration: row.video_duration, category: row.category, ...videoUrls(env, origin, row) } : null,
    likes: row.likes_count, comments: row.comments_count, shares: row.shares_count, views: row.views_count,
    myReaction: row.my_reaction || null,
    saved: !!row.saved,
    mine: row.author_id === me.id,
  };
}

export function meShape(u, extra = {}) {
  return {
    id: u.id, displayName: u.display_name, handle: u.handle, avatarUrl: u.avatar_url, headline: u.headline, bio: u.bio,
    church: u.church, country: u.country, translation: u.translation, kind: u.kind, verified: u.verified, isMe: true,
    bannerUrl: u.banner_url || null,
    coins: u.coins, jobAdCredits: u.job_ad_credits,
    ...extra,
  };
}
