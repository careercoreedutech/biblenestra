// SOCIAL (round 3) API helpers: person profiles, comment likes, who-liked lists, profile images.
// Every helper takes the authed `request` from useApi() (online / dev-online modes only).
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import { absoluteUrl } from './config';
import { uploadImage } from './media';
import { splitPosts } from './mappers';

const IS_WEB = Platform.OS === 'web';
export const isServerId = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ''));

/** A server user (GET /users/:id or a userJson object) → the profile shape the profile screens render. */
export function mapPerson(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.displayName || 'Believer',
    handle: u.handle ? '@' + u.handle : null,
    followKey: '@' + (u.handle || u.id),
    avatarUrl: u.avatarUrl ? absoluteUrl(u.avatarUrl) : null,
    bannerUrl: u.bannerUrl ? absoluteUrl(u.bannerUrl) : null,
    headline: u.headline || '',
    bio: u.bio || '',
    church: u.church || '',
    country: u.country || '',
    kind: u.kind || 'person',
    verified: !!u.verified,
    followers: u.followers || 0,
    following: u.following || 0,
    posts: u.posts || 0,
    isFollowing: !!u.isFollowing,
    isMe: !!u.isMe,
    blocked: !!u.blocked,
    reaction: u.reaction || null,
  };
}

export const getPerson = async (request, id) => mapPerson(await request('GET', `/users/${id}`));

/** → { feed, videos, nextCursor } in the store shapes (mapFeedPost / mapVideoPost) */
export async function getPersonPosts(request, id, cursor) {
  const r = await request('GET', `/users/${id}/posts?limit=18${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
  const { feed, videos } = splitPosts(r.items || []);
  const order = new Map((r.items || []).map((p, i) => [p.id, i]));
  return { feed, videos, order, nextCursor: r.nextCursor || null };
}

export const toggleCommentLike = (request, commentId) => request('POST', `/comments/${commentId}/like`);
export async function getCommentLikers(request, commentId) {
  const r = await request('GET', `/comments/${commentId}/likes`);
  return (r.items || []).map(mapPerson);
}
export async function getPostReactors(request, postId) {
  const r = await request('GET', `/posts/${postId}/reactions`);
  return (r.items || []).map(mapPerson);
}

export async function getFollowList(request, userId, which) {
  const r = await request('GET', `/users/${userId}/${which === 'following' ? 'following' : 'followers'}`);
  return (r.items || []).map(mapPerson);
}

/** Open (or create) a DM with a server user → conversation id */
export async function openDm(request, userId) {
  const r = await request('POST', '/conversations/dm', { userId });
  return r.id;
}

// ─── Profile images ─────────────────────────────────────────────
async function ensureLibrary() {
  if (IS_WEB) return;
  const cur = await ImagePicker.getMediaLibraryPermissionsAsync();
  if (cur.granted) return;
  const req = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!req.granted) throw new Error('Allow photo library access in Settings to change your photo');
}

/** Center-crop to an exact aspect ratio and size (works on web, iOS and Android). */
async function cropTo(asset, ratio, outWidth) {
  let { width = 0, height = 0 } = asset;
  if (!width || !height) {
    const probe = await ImageManipulator.manipulateAsync(asset.uri, [], {});
    width = probe.width;
    height = probe.height;
  }
  let cw = width;
  let ch = Math.round(width / ratio);
  if (ch > height) { ch = height; cw = Math.round(height * ratio); }
  const crop = { originX: Math.max(0, Math.round((width - cw) / 2)), originY: Math.max(0, Math.round((height - ch) / 2)), width: cw, height: ch };
  const w = Math.min(outWidth, cw);
  return ImageManipulator.manipulateAsync(asset.uri, [{ crop }, { resize: { width: w, height: Math.round(w / ratio) } }], {
    compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: IS_WEB,
  });
}

/**
 * Pick a profile photo ('avatar' → square 640px) or banner ('banner' → 3:1, 1500×500).
 * → { uri, width, height, mimeType, dataUrl? } or null when cancelled.
 */
export async function pickProfileImage(kind) {
  await ensureLibrary();
  const banner = kind === 'banner';
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    // Native cropper: square for photos everywhere; Android also honours 3:1 for banners (iOS crops below)
    allowsEditing: !IS_WEB && (!banner || Platform.OS === 'android'),
    aspect: banner ? [3, 1] : [1, 1],
    quality: 0.9,
  });
  if (res.canceled || !res.assets || !res.assets[0]) return null;
  const out = await cropTo(res.assets[0], banner ? 3 : 1, banner ? 1500 : 640);
  return {
    uri: out.uri,
    width: out.width,
    height: out.height,
    mimeType: 'image/jpeg',
    dataUrl: out.base64 ? `data:image/jpeg;base64,${out.base64}` : null,
  };
}

/** Online: upload → key accepted by PUT /me (avatarUrl / bannerUrl). */
export async function uploadProfileImage(request, img) {
  const r = await uploadImage(request, img);
  return { key: r.key, url: absoluteUrl(r.url) };
}

/** Local mode: keep a copy that survives cache clean-ups → uri to save in the store. */
export async function persistLocalImage(img, kind) {
  if (IS_WEB) return img.dataUrl || img.uri;
  try {
    const dir = `${FileSystem.documentDirectory}profile/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    const to = `${dir}${kind}_${Date.now()}.jpg`;
    await FileSystem.copyAsync({ from: img.uri, to });
    return to;
  } catch (e) {
    return img.uri;
  }
}
