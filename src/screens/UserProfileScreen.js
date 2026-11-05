// SOCIAL (round 3) — a person's social profile: banner, avatar, bio, follower counts, Follow / Message / Gift,
// and their posts & videos (grid or list). Opened by tapping a name / avatar anywhere in Socials.
//   Online: route 'UserProfile' { id } → GET /users/:id + GET /users/:id/posts (paginated)
//   Local:  route 'UserProfile' { name, handle } → a profile built from their posts on this device
//           (seed people open the Person screen, which embeds <PersonSocial/> from this file).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Dimensions, Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { Icon } from '../components/Icons';
import { colors, fonts, radius, shadow } from '../theme';
import { Screen, Button, Empty, alpha, NightGlow } from '../components/ui';
import { FadeInUp, PressScale, ScaleIn, Pop, AnimatedNumber } from '../components/Motion';
import { useToast } from '../components/Toast';
import { useStore } from '../store';
import { useSync } from '../api/sync';
import { useApi } from '../api/auth';
import { useNav } from '../navigation';
import { SocialAvatar } from '../components/social/FeedCard';
import GiftSheet from '../components/social/GiftSheet';
import { getPerson, getPersonPosts, openDm, isServerId, getFollowList } from '../api/social';
import PeopleSheet from '../components/social/PeopleSheet';
import { useOpenProfile, norm } from '../components/social/profileNav';
import { timestampOf, relTime, passageLabel, formatCount } from '../components/social/shared';

const W = Math.min(Dimensions.get('window').width, 560);
const TILE = Math.floor((W - 36 - 6) / 3);

// ─── post → tile/list item ─────────────────────────────────────────
export function toProfileItem(x, src) {
  if (src === 'video') {
    const isText = !x.videoUrl && !x.imageUrl && !x.processing && !x.videoStatus;
    return {
      key: 'v_' + x.id, src, id: x.id, ts: timestampOf(x), raw: x,
      kind: x.videoUrl || x.processing ? x.category || 'Video' : x.imageUrl ? 'Photo' : x.category || 'Post',
      text: x.caption || '', image: x.poster || x.imageUrl || null, video: !!x.videoUrl || !!x.processing,
      bg: isText ? x.bg || colors.night : colors.night, scripture: x.scripture || '',
      likes: Number(x.likes) || 0, comments: x.commentCount != null ? x.commentCount : (x.comments || []).length,
      views: x.views, time: x.time,
    };
  }
  const images = Array.isArray(x.images) && x.images.length ? x.images : x.image ? [x.image] : [];
  return {
    key: 'p_' + x.id, src: 'post', id: x.id, ts: timestampOf(x), raw: x, kind: x.kind || 'Post',
    text: x.text || '', image: images[0] || null, images, video: false, bg: x.bg || null,
    scripture: x.passage ? passageLabel(x.passage) : '', likes: Number(x.likes) || 0, comments: Number(x.comments) || 0, time: x.time,
  };
}

function GridGlyph({ color }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      {[[3, 3], [13.5, 3], [3, 13.5], [13.5, 13.5]].map(([x, y]) => <Rect key={`${x}${y}`} x={x} y={y} width={7.5} height={7.5} rx={1.6} stroke={color} strokeWidth={2} />)}
    </Svg>
  );
}
function ListGlyph({ color }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Path d="M4 6h16M4 12h16M4 18h10" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  );
}

function Tile({ it, index, onPress }) {
  const showViews = it.video && Number(it.views) > 0;
  return (
    <FadeInUp index={Math.min(index, 9)} distance={8} duration={320}>
      <PressScale onPress={onPress} scaleTo={0.96} style={[styles.tile, { backgroundColor: it.image ? colors.night : it.bg || colors.cardIndigo }]} accessibilityLabel={`Open ${it.kind.toLowerCase()}: ${it.text.slice(0, 40)}`}>
        {it.image ? <Image source={{ uri: it.image }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : (
          <View style={styles.tileTextWrap}>
            <Text style={[styles.tileQuote, { color: it.bg ? colors.goldLight : colors.gold }]}>“</Text>
            <Text style={[styles.tileText, { color: it.bg ? colors.nightFg : colors.fg }]} numberOfLines={4}>{it.text || it.scripture}</Text>
          </View>
        )}
        {it.video ? (
          <View style={styles.tilePlay}><Icon name="play" size={11} color="#FFFFFF" fill="solid" /></View>
        ) : it.images && it.images.length > 1 ? (
          <View style={styles.tilePlay}><Icon name="image" size={11} color="#FFFFFF" /></View>
        ) : null}
        <View style={styles.tileFoot}>
          <Icon name={showViews ? 'play' : 'heart'} size={10} color="#FFFFFF" fill="solid" />
          <Text style={styles.tileFootText}>{showViews ? formatCount(it.views) : formatCount(it.likes)}</Text>
        </View>
      </PressScale>
    </FadeInUp>
  );
}

function ListRow({ it, index, onPress }) {
  const when = it.ts ? relTime(it.ts) : it.time;
  return (
    <FadeInUp index={Math.min(index, 9)} distance={10} duration={340}>
      <PressScale onPress={onPress} scaleTo={0.98} style={styles.listRow} accessibilityLabel={`Open ${it.kind.toLowerCase()}`}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.listMeta}>
            <Text style={styles.listKind}>{String(it.kind).toUpperCase()}</Text>
            {when ? <Text style={styles.listTime}>· {when}</Text> : null}
          </View>
          {it.text ? <Text style={styles.listText} numberOfLines={3}>{it.text}</Text> : null}
          {it.scripture ? <Text style={styles.listRef} numberOfLines={1}>{it.scripture}</Text> : null}
          <View style={styles.listCounts}>
            <Icon name="heart" size={12} color={colors.rose} fill="solid" />
            <Text style={styles.listCount}>{formatCount(it.likes)}</Text>
            <Icon name="chat" size={12} color={colors.muted} />
            <Text style={styles.listCount}>{formatCount(it.comments)}</Text>
          </View>
        </View>
        {it.image ? (
          <View style={styles.listThumb}>
            <Image source={{ uri: it.image }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            {it.video ? <View style={styles.listThumbPlay}><Icon name="play" size={12} color="#FFFFFF" fill="solid" /></View> : null}
          </View>
        ) : it.video ? (
          <View style={[styles.listThumb, { backgroundColor: colors.night, alignItems: 'center', justifyContent: 'center' }]}><Icon name="play" size={16} color={colors.goldLight} fill="solid" /></View>
        ) : null}
      </PressScale>
    </FadeInUp>
  );
}

/** Posts & videos of one person: grid / list toggle, tap → open in Socials. */
export function PostsSection({ items, loading, hasMore, onMore, onOpen, name, title = 'Posts & videos' }) {
  const [view, setView] = useState('grid');
  return (
    <View style={{ marginTop: 22 }}>
      <View style={styles.postsHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>{items.length ? `${items.length}${hasMore ? '+' : ''} shared` : 'Shared'}</Text>
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
        <View style={styles.viewToggle}>
          {[['grid', GridGlyph, 'Grid view'], ['list', ListGlyph, 'List view']].map(([k, G, label]) => (
            <PressScale key={k} onPress={() => setView(k)} scaleTo={0.9} style={[styles.viewBtn, view === k && styles.viewBtnOn]} accessibilityLabel={label} accessibilityState={{ selected: view === k }}>
              <G color={view === k ? colors.primary : colors.muted} />
            </PressScale>
          ))}
        </View>
      </View>
      {loading && !items.length ? (
        <View style={styles.loadingBox}><ActivityIndicator color={colors.primary} /></View>
      ) : !items.length ? (
        <View style={styles.emptyBox}><Empty title="No posts yet" body={`When ${name || 'they'} share reflections, photos or videos, they’ll appear here.`} /></View>
      ) : view === 'grid' ? (
        <View key="grid" style={styles.grid}>{items.map((it, i) => <Tile key={it.key} it={it} index={i} onPress={() => onOpen(it)} />)}</View>
      ) : (
        <View key="list">{items.map((it, i) => <ListRow key={it.key} it={it} index={i} onPress={() => onOpen(it)} />)}</View>
      )}
      {hasMore ? (
        <PressScale onPress={onMore} scaleTo={0.97} style={styles.more} accessibilityLabel="Load more posts">
          {loading ? <ActivityIndicator size="small" color={colors.primary} /> : <Icon name="chevron-down" size={14} color={colors.primary} />}
          <Text style={styles.moreText}>{loading ? 'Loading…' : 'Load more'}</Text>
        </PressScale>
      ) : null}
    </View>
  );
}

/** Banner + avatar + name block shared by profile headers. */
export function ProfileHero({ name, handle, avatarUrl, bannerUrl, verified, headline, meta, bio, children, avatarLabel, onEdit }) {
  return (
    <FadeInUp distance={10} style={styles.hero}>
      <View style={styles.banner}>
        {bannerUrl ? <Image source={{ uri: bannerUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel="Profile banner" /> : <><NightGlow /><Text style={styles.bannerMark}>✦</Text></>}
        {onEdit ? (
          <PressScale onPress={onEdit} scaleTo={0.9} hitSlop={8} style={styles.bannerEdit} accessibilityLabel="Edit profile">
            <Icon name="edit" size={15} color={colors.fg} />
          </PressScale>
        ) : null}
      </View>
      <ScaleIn delay={120} from={0.7} style={styles.avatarRing}>
        <SocialAvatar name={name} label={avatarLabel} uri={avatarUrl} size={88} />
      </ScaleIn>
      <View style={styles.heroBody}>
        <View style={styles.nameRow}>
          <Text style={styles.heroName} numberOfLines={2}>{name}</Text>
          {verified ? <View style={styles.tick}><Icon name="check" size={9} color="#FFFFFF" strokeWidth={3.4} /></View> : null}
        </View>
        {handle ? <Text style={styles.heroHandle}>{handle}</Text> : null}
        {headline ? <Text style={styles.heroHeadline}>{headline}</Text> : null}
        {meta ? <Text style={styles.heroMeta}>{meta}</Text> : null}
        {bio ? <Text style={styles.heroBio}>{bio}</Text> : null}
        {children}
      </View>
    </FadeInUp>
  );
}

function Stat({ value, label, index, onPress }) {
  return (
    <FadeInUp index={index} delay={140} style={styles.stat}>
      <PressScale onPress={onPress} disabled={!onPress} scaleTo={0.94} style={{ alignItems: 'center' }} accessibilityLabel={`${value || 0} ${label}`}>
        <AnimatedNumber value={value || 0} style={styles.statValue} format={(n) => formatCount(Math.round(n))} />
        <Text style={styles.statLabel}>{label}</Text>
      </PressScale>
    </FadeInUp>
  );
}

/** Followers / Following people list for a server user (tap a person → their profile). */
export function FollowListSheet({ userId, which, name, onClose }) {
  const api = useApi();
  const openProfile = useOpenProfile();
  const load = useCallback(() => getFollowList(api.request, userId, which), [userId, which]);
  return (
    <PeopleSheet
      visible={!!which}
      title={which === 'following' ? 'Following' : 'Followers'}
      eyebrow={name || ''}
      load={which ? load : null}
      emptyText={which === 'following' ? 'Not following anyone yet' : 'No followers yet'}
      rowIcon="chevron"
      onClose={onClose}
      onOpenPerson={(p) => { onClose(); setTimeout(() => openProfile({ userId: p.id, name: p.name, mine: p.isMe }), 200); }}
    />
  );
}

// Make sure a post shown on a profile exists in the store, then open it in Socials.
function useOpenPost() {
  const { state, dispatch } = useStore();
  const nav = useNav();
  return (it) => {
    const slice = it.src === 'video' ? 'videos' : 'feed';
    if (!(state[slice] || []).some((x) => x.id === it.id)) dispatch({ type: 'appendItems', slice, items: [it.raw], local: true });
    if (it.src === 'video' && it.raw.videoUrl) nav.push('Socials', { initialVideoId: it.id });
    else nav.push('Socials', { postId: it.id });
  };
}

/** Local mode: this person's posts on the device (by name / handle). */
function useLocalItems(name, handle) {
  const { state } = useStore();
  return useMemo(() => {
    const n = norm(name);
    const feed = (state.feed || []).filter((f) => !f.mine && norm(f.author) === n).map((f) => toProfileItem(f, 'post'));
    const vids = (state.videos || []).filter((v) => !v.mine && v.creator && (norm(v.creator.name) === n || (handle && v.creator.handle === handle))).map((v) => toProfileItem(v, 'video'));
    const now = Date.now();
    return [...feed, ...vids].sort((a, b) => (b.ts || timestampOf(b.raw, now)) - (a.ts || timestampOf(a.raw, now)));
  }, [state.feed, state.videos, name, handle]);
}

/**
 * Local-mode extras for the seed Person screen (DiscoverScreen PersonScreen): Gift button + posts grid.
 */
export function PersonSocial({ person }) {
  const [gift, setGift] = useState(false);
  const openPost = useOpenPost();
  const items = useLocalItems(person.name, null);
  return (
    <View>
      <FadeInUp index={1} style={{ alignItems: 'center', marginTop: 14 }}>
        <Button small kind="ghost" label="Send a gift" icon={<Icon name="gift" size={13} color={colors.rose} />} onPress={() => setGift(true)} />
      </FadeInUp>
      <PostsSection items={items} onOpen={openPost} name={person.name} />
      <GiftSheet visible={gift} target={{ name: person.name }} onClose={() => setGift(false)} subtitle={`Bless ${person.name} with coins`} />
    </View>
  );
}

export default function UserProfileScreen({ params = {} }) {
  const nav = useNav();
  const toast = useToast();
  const { state, dispatch } = useStore();
  const sync = useSync();
  const api = useApi();
  const online = sync.online && isServerId(params.id);
  const [person, setPerson] = useState(null);
  const [error, setError] = useState(null);
  const [posts, setPosts] = useState({ items: [], cursor: null, loading: true, more: false });
  const [gift, setGift] = useState(false);
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState(null); // 'followers' | 'following'
  const openPost = useOpenPost();
  const localItems = useLocalItems(params.name, params.handle);

  const loadPosts = useCallback(async (cursor) => {
    setPosts((p) => ({ ...p, loading: true }));
    try {
      const r = await getPersonPosts(api.request, params.id, cursor);
      const items = [...r.feed.map((f) => toProfileItem(f, 'post')), ...r.videos.map((v) => toProfileItem(v, 'video'))]
        .sort((a, b) => r.order.get(a.id) - r.order.get(b.id));
      setPosts((p) => ({ items: cursor ? [...p.items, ...items.filter((x) => !p.items.some((y) => y.key === x.key))] : items, cursor: r.nextCursor, more: !!r.nextCursor, loading: false }));
    } catch (e) {
      setPosts((p) => ({ ...p, loading: false }));
      if (!cursor) toast.show('Couldn’t load their posts', { tone: 'error' });
    }
  }, [params.id]);

  useEffect(() => {
    if (!online) return;
    let alive = true;
    getPerson(api.request, params.id)
      .then((p) => { if (alive) setPerson(p); })
      .catch((e) => { if (alive) setError(e && e.status === 404 ? 'notfound' : (e && e.message) || 'error'); });
    loadPosts(null);
    return () => { alive = false; };
  }, [params.id, online]);

  // ─── Local (device) profile ─────────────────────────────────────
  if (!online) {
    if (sync.online && !params.name) {
      return <Screen back title="Profile"><Empty title="Profile unavailable" body="This person’s profile couldn’t be found." action="Back" onAction={() => nav.pop()} /></Screen>;
    }
    const name = params.name || 'Believer';
    const following = !!params.handle && (state.follows || []).includes(params.handle);
    const sample = localItems[0] && localItems[0].raw;
    const church = sample && sample.creator ? sample.creator.church : '';
    const verified = !!(sample && (sample.authorVerified || (sample.creator && sample.creator.verified)));
    return (
      <Screen back title={name} subtitle={params.handle || 'Profile'}>
        <ProfileHero name={name} handle={params.handle} verified={verified} meta={church} avatarLabel={sample && sample.creator ? sample.creator.avatar : undefined}>
          <View style={styles.actions}>
            {params.handle ? (
              <Pop trigger={following} amount={1.08}>
                <Button small kind={following ? 'ghost' : 'primary'} label={following ? 'Following' : 'Follow'} icon={following ? <Icon name="check" size={12} color={colors.primary} strokeWidth={2.6} /> : null}
                  onPress={() => { dispatch({ type: 'follow', id: params.handle }); toast.show(following ? `Unfollowed ${name}` : `Following ${name}`, { icon: following ? 'user' : 'check', haptic: following ? 'light' : 'success' }); }} />
              </Pop>
            ) : null}
            <Button small kind="ghost" label="Message" icon={<Icon name="chat" size={13} color={colors.primary} />} onPress={() => nav.push('Chat', { to: name, userId: params.id || params.userId })} />
            <Button small kind="ghost" label="Gift" icon={<Icon name="gift" size={13} color={colors.rose} />} onPress={() => setGift(true)} />
          </View>
        </ProfileHero>
        <PostsSection items={localItems} onOpen={openPost} name={name} />
        <GiftSheet visible={gift} target={{ name }} onClose={() => setGift(false)} subtitle={`Bless ${name} with coins`} />
      </Screen>
    );
  }

  // ─── Online profile ─────────────────────────────────────────────
  if (error) {
    return (
      <Screen back title={params.name || 'Profile'}>
        <Empty title={error === 'notfound' ? 'Profile unavailable' : 'Couldn’t load this profile'} body={error === 'notfound' ? 'This account may be private, blocked or no longer available.' : error} action="Back" onAction={() => nav.pop()} />
      </Screen>
    );
  }
  if (!person) {
    return <Screen back title={params.name || 'Profile'}><View style={styles.loadingBox}><ActivityIndicator color={colors.primary} /></View></Screen>;
  }

  const toggleFollow = async () => {
    const want = !person.isFollowing;
    setPerson((p) => ({ ...p, isFollowing: want, followers: Math.max(0, p.followers + (want ? 1 : -1)) }));
    const key = person.followKey;
    const has = (state.follows || []).includes(key);
    if (has !== want) dispatch({ type: 'follow', id: key, local: true });
    try {
      const r = await api.request('POST', `/users/${person.id}/follow`);
      if (!!r.following !== want) {
        setPerson((p) => ({ ...p, isFollowing: !!r.following, followers: Math.max(0, p.followers + (r.following ? 1 : -1)) }));
        dispatch({ type: 'follow', id: key, local: true });
      }
      toast.show(r.following ? `Following ${person.name}` : `Unfollowed ${person.name}`, { icon: r.following ? 'check' : 'user', haptic: r.following ? 'success' : 'light' });
    } catch (e) {
      setPerson((p) => ({ ...p, isFollowing: !want, followers: Math.max(0, p.followers + (want ? -1 : 1)) }));
      if (has !== want) dispatch({ type: 'follow', id: key, local: true });
      toast.show(`Couldn’t update follow${e && e.message ? ` — ${e.message}` : ''}`, { tone: 'error' });
    }
  };

  const message = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const cid = await openDm(api.request, person.id);
      await sync.refresh({ quiet: true });
      nav.push('Chat', { id: cid, to: person.name, userId: person.id });
    } catch (e) {
      toast.show(e && e.code === 'BLOCKED' ? 'You can’t message this person' : `Couldn’t open a chat${e && e.message ? ` — ${e.message}` : ''}`, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const meta = [person.church, person.country].filter(Boolean).join('  ·  ');
  return (
    <Screen back title={person.name} subtitle={person.handle || (person.kind !== 'person' ? person.kind[0].toUpperCase() + person.kind.slice(1) : 'Profile')}>
      <ProfileHero name={person.name} handle={person.handle} avatarUrl={person.avatarUrl} bannerUrl={person.bannerUrl} verified={person.verified} headline={person.headline} meta={meta} bio={person.bio}
        onEdit={person.isMe ? () => nav.push('EditProfile') : undefined}>
        <View style={styles.stats}>
          <Stat value={person.posts} label="Posts" index={0} />
          <View style={styles.statRule} />
          <Stat value={person.followers} label="Followers" index={1} onPress={() => setList('followers')} />
          <View style={styles.statRule} />
          <Stat value={person.following} label="Following" index={2} onPress={() => setList('following')} />
        </View>
        {person.isMe ? (
          <View style={styles.actions}>
            <Button small label="Edit profile" icon={<Icon name="edit" size={13} color="#FFFFFF" />} onPress={() => nav.push('EditProfile')} />
          </View>
        ) : (
          <View style={styles.actions}>
            <Pop trigger={person.isFollowing} amount={1.08}>
              <Button small kind={person.isFollowing ? 'ghost' : 'primary'} label={person.isFollowing ? 'Following' : 'Follow'}
                icon={person.isFollowing ? <Icon name="check" size={12} color={colors.primary} strokeWidth={2.6} /> : <Icon name="plus" size={12} color="#FFFFFF" strokeWidth={2.6} />}
                onPress={toggleFollow} />
            </Pop>
            <Button small kind="ghost" label={busy ? 'Opening…' : 'Message'} disabled={busy || person.blocked} icon={<Icon name="chat" size={13} color={colors.primary} />} onPress={message} />
            <Button small kind="ghost" label="Gift" icon={<Icon name="gift" size={13} color={colors.rose} />} onPress={() => setGift(true)} />
          </View>
        )}
      </ProfileHero>
      <PostsSection items={posts.items} loading={posts.loading} hasMore={posts.more} onMore={() => loadPosts(posts.cursor)} onOpen={openPost} name={person.name} />
      <GiftSheet visible={gift} target={{ userId: person.id, name: person.name }} onClose={() => setGift(false)} subtitle={`Bless ${person.name} with coins`} />
      <FollowListSheet userId={person.id} which={list} name={person.name} onClose={() => setList(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', ...shadow.md },
  banner: { height: 118, backgroundColor: colors.night, overflow: 'hidden' },
  bannerMark: { position: 'absolute', top: 14, left: 16, color: colors.goldLight, fontSize: 13, opacity: 0.8 },
  bannerEdit: { position: 'absolute', top: 10, right: 10, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center', ...shadow.sm },
  avatarRing: { alignSelf: 'center', marginTop: -48, padding: 4, borderRadius: 52, backgroundColor: colors.surface, ...shadow.sm },
  heroBody: { alignItems: 'center', paddingHorizontal: 18, paddingTop: 8, paddingBottom: 20 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' },
  heroName: { fontFamily: fonts.display, fontSize: 28, lineHeight: 34, color: colors.fg, letterSpacing: -0.6, textAlign: 'center', flexShrink: 1 },
  tick: { width: 16, height: 16, borderRadius: 8, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  heroHandle: { fontSize: 13, color: colors.muted, marginTop: 1 },
  heroHeadline: { fontSize: 14, color: colors.fg, marginTop: 8, textAlign: 'center', lineHeight: 19 },
  heroMeta: { fontSize: 12.5, color: colors.muted, marginTop: 4, textAlign: 'center' },
  heroBio: { fontFamily: fonts.serifItalic, fontSize: 15.5, lineHeight: 22, color: colors.passage, textAlign: 'center', marginTop: 12, paddingHorizontal: 4 },
  stats: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', marginTop: 16, paddingVertical: 12, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.rule },
  stat: { flex: 1, alignItems: 'center' },
  statRule: { width: 1, height: 26, backgroundColor: colors.rule },
  statValue: { fontFamily: fonts.serifBold, fontSize: 20, color: colors.fg, letterSpacing: -0.3 },
  statLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.faint, marginTop: 1 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 16, justifyContent: 'center', flexWrap: 'wrap' },
  postsHead: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 12 },
  eyebrow: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase', color: colors.gold },
  sectionTitle: { fontFamily: fonts.serifBold, fontSize: 21, color: colors.fg, letterSpacing: -0.3, marginTop: 1 },
  viewToggle: { flexDirection: 'row', backgroundColor: colors.raised, borderRadius: radius.pill, padding: 3, gap: 2 },
  viewBtn: { width: 36, height: 30, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  viewBtnOn: { backgroundColor: colors.surface, ...shadow.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 3, borderRadius: 14, overflow: 'hidden' },
  tile: { width: TILE, height: Math.round(TILE * 1.28), overflow: 'hidden', backgroundColor: colors.night },
  tileTextWrap: { flex: 1, padding: 10, justifyContent: 'center' },
  tileQuote: { fontFamily: fonts.serifBold, fontSize: 26, lineHeight: 26 },
  tileText: { fontFamily: fonts.serif, fontSize: 12.5, lineHeight: 16.5 },
  tilePlay: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.42)', alignItems: 'center', justifyContent: 'center' },
  tileFoot: { position: 'absolute', left: 6, bottom: 6, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.42)', borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 3 },
  tileFootText: { color: '#FFFFFF', fontSize: 10.5, fontWeight: '700' },
  listRow: { flexDirection: 'row', gap: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 14, marginBottom: 10, ...shadow.sm },
  listMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  listKind: { fontSize: 10, fontWeight: '800', letterSpacing: 1.1, color: colors.gold },
  listTime: { fontSize: 11.5, color: colors.faint },
  listText: { fontSize: 14, lineHeight: 20, color: colors.fg, marginTop: 5 },
  listRef: { fontSize: 12, color: colors.primary, fontWeight: '600', marginTop: 5 },
  listCounts: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  listCount: { fontSize: 12, color: colors.muted, fontWeight: '600', marginRight: 8 },
  listThumb: { width: 74, height: 74, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.raised },
  listThumbPlay: { position: 'absolute', top: 26, left: 26, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  loadingBox: { paddingVertical: 40, alignItems: 'center' },
  emptyBox: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, paddingVertical: 8 },
  more: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12, paddingVertical: 10 },
  moreText: { fontSize: 13, fontWeight: '700', color: colors.primary },
});
