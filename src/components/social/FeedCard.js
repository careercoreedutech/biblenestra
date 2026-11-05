// Cards for the unified Socials "For you" / "Following" feed: text posts, photo posts (single or
// swipeable multi-photo) and video posts (muted inline preview that opens the reels player).
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Icon } from '../Icons';
import { colors, fonts, radius } from '../../theme';
import { alpha, Button } from '../ui';
import { PressScale, FadeInUp, Pop, Pulse, AnimatedNumber, AnimatedModal, EASE_IN, EASE_OUT } from '../Motion';
import { ND, WHITE, SOCIAL, countFormat, initials, tintFor, kindTint } from './shared';

// ─── Small pieces ────────────────────────────────────────────────

export function SocialAvatar({ name = '', label, size = 40, ring, uri }) {
  const tint = tintFor(name);
  if (uri) {
    return (
      <Image
        source={{ uri }}
        accessibilityIgnoresInvertColors
        style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: tint }, ring && { borderWidth: 2, borderColor: colors.goldLight }]}
      />
    );
  }
  return (
    <View
      style={[
        { width: size, height: size, borderRadius: size / 2, backgroundColor: tint, alignItems: 'center', justifyContent: 'center' },
        ring && { borderWidth: 2, borderColor: colors.goldLight },
      ]}
    >
      <Text style={{ fontFamily: fonts.serifBold, fontSize: Math.round(size * 0.38), color: WHITE }}>{label || initials(name)}</Text>
    </View>
  );
}

function KindBadge({ kind }) {
  const tint = kindTint(kind);
  return (
    <View style={[styles.kindBadge, { backgroundColor: alpha(tint, 0.16), borderColor: alpha(tint, 0.42) }]}>
      <Text style={[styles.kindBadgeText, { color: tint === colors.goldLight ? colors.goldLight : lighten(tint) }]} numberOfLines={1}>
        {String(kind || 'Post').toUpperCase()}
      </Text>
    </View>
  );
}

// Muted brand hues are too dark for text on night surfaces — blend them toward parchment.
function lighten(hex) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return colors.nightFg;
  const mix = (i) => Math.round(parseInt(h.slice(i, i + 2), 16) * 0.45 + 244 * 0.55);
  return `rgb(${mix(0)},${mix(2)},${mix(4)})`;
}

export function PassagePill({ label, onPress, style }) {
  return (
    <PressScale onPress={onPress} scaleTo={0.95} style={[styles.passagePill, style]} accessibilityLabel={`Read ${label}`}>
      <Icon name="book" size={13} color={colors.goldLight} />
      <Text style={styles.passageText} numberOfLines={1}>{label}</Text>
      <View style={styles.passageSep} />
      <Text style={styles.passageCta}>Open</Text>
      <Icon name="chevron-right" size={11} color={SOCIAL.muted} strokeWidth={2.6} />
    </PressScale>
  );
}

// Big heart that pops where a photo was double-tapped, then floats away.
function FloatingHeart({ x, y, onDone }) {
  const pop = useRef(new Animated.Value(0)).current;
  const out = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.timing(pop, { toValue: 1, duration: 260, easing: Easing.out(Easing.back(2.2)), useNativeDriver: ND }),
      Animated.delay(160),
      Animated.timing(out, { toValue: 1, duration: 340, easing: EASE_IN, useNativeDriver: ND }),
    ]).start(() => onDone && onDone());
  }, []);
  const S = 92;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: x - S / 2,
        top: y - S / 2,
        width: S,
        height: S,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 20,
        opacity: Animated.multiply(pop.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 1, 1] }), out.interpolate({ inputRange: [0, 1], outputRange: [1, 0] })),
        transform: [
          { translateY: out.interpolate({ inputRange: [0, 1], outputRange: [0, -70] }) },
          { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) },
        ],
      }}
    >
      <Icon name="heart" size={80} color={colors.rose} fill={colors.rose} strokeWidth={1.2} />
    </Animated.View>
  );
}

// Glass badge used on media (mirrors the composer's "PHOTO PREVIEW" badge the owner likes)
function MediaBadge({ label, live }) {
  return (
    <View style={styles.mediaBadge} pointerEvents="none">
      {live ? (
        <Pulse min={0.7} max={1.25} duration={800}>
          <View style={styles.mediaBadgeDot} />
        </Pulse>
      ) : (
        <View style={styles.mediaBadgeDot} />
      )}
      <Text style={styles.mediaBadgeText}>{label}</Text>
    </View>
  );
}

// ─── Photo gallery: rounded media box, swipe between photos, double-tap to like, tap to view ───
export function ImageGallery({ images = [], height, onDoubleTap, onOpen, badge = 'PHOTO', style }) {
  const [w, setW] = useState(0);
  const [page, setPage] = useState(0);
  const [hearts, setHearts] = useState([]);
  const lastTap = useRef(0);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const many = images.length > 1;
  const h = height || (w ? Math.round(w * (many ? 1 : 1.05)) : 300);

  const onTap = (e, i) => {
    const now = Date.now();
    const ne = (e && e.nativeEvent) || {};
    if (now - lastTap.current < 280) {
      clearTimeout(timer.current);
      lastTap.current = 0;
      const x = typeof ne.locationX === 'number' ? ne.locationX : w / 2;
      const y = typeof ne.locationY === 'number' ? ne.locationY : h / 2;
      setHearts((l) => [...l.slice(-2), { id: `${now}`, x: Math.min(Math.max(x, 50), (w || 300) - 50), y: Math.min(Math.max(y, 50), h - 50) }]);
      onDoubleTap && onDoubleTap();
      return;
    }
    lastTap.current = now;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onOpen && onOpen(i), 280);
  };

  return (
    <View style={[styles.mediaBox, { height: h }, style]} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w ? (
        many ? (
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={(e) => {
              const p = Math.round(e.nativeEvent.contentOffset.x / w);
              if (p !== page) setPage(p);
            }}
          >
            {images.map((uri, i) => (
              <Pressable key={`${i}_${String(uri).slice(-24)}`} onPress={(e) => onTap(e, i)} style={{ width: w, height: h }} accessibilityLabel={`Photo ${i + 1} of ${images.length}`}>
                <Image source={{ uri }} style={styles.mediaImg} resizeMode="cover" />
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          <Pressable onPress={(e) => onTap(e, 0)} style={StyleSheet.absoluteFill} accessibilityLabel="Photo">
            <Image source={{ uri: images[0] }} style={styles.mediaImg} resizeMode="cover" />
          </Pressable>
        )
      ) : null}
      {badge ? <MediaBadge label={badge} /> : null}
      {many ? (
        <>
          <View style={styles.counterPill} pointerEvents="none">
            <Text style={styles.counterText}>{page + 1}/{images.length}</Text>
          </View>
          <View style={styles.dotsRow} pointerEvents="none">
            {images.map((_, i) => (
              <View key={i} style={[styles.dot, i === page && styles.dotOn]} />
            ))}
          </View>
        </>
      ) : null}
      {hearts.map((ht) => (
        <FloatingHeart key={ht.id} x={ht.x} y={ht.y} onDone={() => setHearts((l) => l.filter((x) => x.id !== ht.id))} />
      ))}
    </View>
  );
}

// Full-screen photo viewer
export function PhotoViewer({ images = [], start = 0, visible, onClose }) {
  const [w, setW] = useState(0);
  const [page, setPage] = useState(start);
  const ref = useRef(null);
  useEffect(() => {
    if (!visible) return;
    setPage(start);
    if (w) setTimeout(() => { try { ref.current && ref.current.scrollTo({ x: start * w, animated: false }); } catch (e) {} }, 0);
  }, [visible, start, w]);
  return (
    <AnimatedModal visible={visible} onRequestClose={onClose} full dim="rgba(0,0,0,0.94)">
      <View style={styles.viewer} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        {w ? (
          <ScrollView
            ref={ref}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / w))}
          >
            {images.map((uri, i) => (
              <Pressable key={i} onPress={onClose} style={{ width: w, flex: 1, justifyContent: 'center' }}>
                <Image source={{ uri }} style={{ width: w, height: '78%' }} resizeMode="contain" />
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        <View style={styles.viewerTop}>
          <Text style={styles.viewerCount}>{images.length > 1 ? `${page + 1} of ${images.length}` : 'Photo'}</Text>
          <PressScale onPress={onClose} scaleTo={0.88} hitSlop={12} style={styles.viewerClose} accessibilityLabel="Close photo">
            <Icon name="x" size={16} color={WHITE} strokeWidth={2.4} />
          </PressScale>
        </View>
      </View>
    </AnimatedModal>
  );
}

// ─── Inline video preview: muted autoplay while it's the visible card; tap opens the reels player ───
function InlineVideo({ item, playing, onOpen, height }) {
  const player = useVideoPlayer(item.videoUrl || null, (p) => {
    p.loop = true;
    p.muted = true;
  });
  useEffect(() => {
    try {
      if (playing) player.play();
      else player.pause();
    } catch (e) {}
  }, [playing, player]);

  return (
    <PressScale onPress={onOpen} scaleTo={0.985} style={[styles.mediaBox, styles.videoBox, { height }]} accessibilityLabel={`Play video: ${item.text}`}>
      {/* Night backdrop with the post's scripture while the stream warms up */}
      <View style={styles.videoBackdrop}>
        <Icon name="video" size={26} color={alpha(colors.goldLight, 0.7)} />
        {item.scripture ? <Text style={styles.videoBackdropRef}>{item.scripture}</Text> : null}
      </View>
      {item.videoUrl ? (
        <VideoView style={StyleSheet.absoluteFill} player={player} allowsFullscreen={false} allowsPictureInPicture={false} nativeControls={false} contentFit="cover" />
      ) : null}
      <View style={styles.videoScrim} pointerEvents="none">
        <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id={`vg_${item.id}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#000000" stopOpacity="0" />
              <Stop offset="100%" stopColor="#000000" stopOpacity="0.78" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#vg_${item.id})`} />
        </Svg>
      </View>
      <MediaBadge label={`VIDEO${item.duration ? ` · ${item.duration}` : ''}`} live={playing} />
      <View style={styles.mutedPill} pointerEvents="none">
        <Icon name="volume" size={12} color={WHITE} />
        <Text style={styles.mutedText}>Muted</Text>
      </View>
      <View style={styles.playCircle} pointerEvents="none">
        <Icon name="play" size={24} color={WHITE} />
      </View>
      <View style={styles.videoFoot} pointerEvents="none">
        <Text style={styles.videoFootTitle} numberOfLines={2}>{item.text}</Text>
        <View style={styles.videoFootCta}>
          <Text style={styles.videoFootCtaText}>Watch with sound</Text>
          <Icon name="arrow-right" size={12} color={colors.goldLight} strokeWidth={2.6} />
        </View>
      </View>
    </PressScale>
  );
}

// Quote-style card for themed text posts
function QuoteCard({ text, bg, passage }) {
  return (
    <View style={[styles.quoteCard, { backgroundColor: bg === colors.night ? colors.nightRaised : bg }]}>
      <Text style={styles.quoteMark}>“</Text>
      <Text style={styles.quoteText}>{text}</Text>
      {passage ? <Text style={styles.quoteRef}>— {passage}</Text> : null}
    </View>
  );
}

// Brief gold glow around a card we navigated to (deep link / just published)
function HighlightRing({ active }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) return;
    a.setValue(0);
    Animated.sequence([
      Animated.timing(a, { toValue: 1, duration: 320, easing: EASE_OUT, useNativeDriver: ND }),
      Animated.delay(1400),
      Animated.timing(a, { toValue: 0, duration: 700, easing: EASE_IN, useNativeDriver: ND }),
    ]).start();
  }, [active]);
  return <Animated.View pointerEvents="none" style={[styles.highlightRing, { opacity: a }]} />;
}

// ─── The card ────────────────────────────────────────────────────
export default function FeedCard({
  item,
  index = 0,
  playing,
  highlight,
  isFollowing,
  onLike,
  onComment,
  onShare,
  onSave,
  onDelete,
  onFollow,
  onOpenPassage,
  onOpenVideo,
  onGift,
  onOpenPhoto,
}) {
  const [confirm, setConfirm] = useState(false);
  const isVideo = !!item.videoUrl;
  const hasImages = item.images && item.images.length > 0;
  const showText = !!item.text && !item.quoteBg && !isVideo;

  return (
    <FadeInUp index={index} distance={16} style={styles.card}>
      <HighlightRing active={highlight} />
      {/* Author row */}
      <View style={styles.head}>
        <SocialAvatar name={item.name} label={item.avatarText} size={40} ring={item.mine} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>{item.mine ? `${item.name} (you)` : item.name}</Text>
            {item.verified ? (
              <View style={styles.verified}>
                <Icon name="check" size={8} color={colors.night} strokeWidth={3.4} />
              </View>
            ) : null}
          </View>
          <Text style={styles.sub} numberOfLines={1}>{[item.sub, item.time].filter(Boolean).join(' · ')}</Text>
        </View>
        {item.src === 'video' && !item.mine && onFollow ? (
          <Pop trigger={!!isFollowing} amount={1.1}>
            <PressScale onPress={onFollow} scaleTo={0.92} style={[styles.followBtn, isFollowing && styles.followBtnOn]} accessibilityLabel={isFollowing ? `Unfollow ${item.name}` : `Follow ${item.name}`}>
              <Text style={[styles.followText, isFollowing && styles.followTextOn]}>{isFollowing ? 'Following' : 'Follow'}</Text>
            </PressScale>
          </Pop>
        ) : hasImages && item.kind === 'Photo' ? null : (
          <KindBadge kind={item.kind} />
        )}
        {item.mine ? (
          <PressScale onPress={() => setConfirm((c) => !c)} hitSlop={8} scaleTo={0.88} style={styles.iconBtn} accessibilityLabel="Delete post">
            <Icon name="trash" size={15} color={confirm ? colors.rose : SOCIAL.muted} />
          </PressScale>
        ) : null}
      </View>

      {/* Body */}
      {showText ? <Text style={[styles.body, !hasImages && item.text.length < 120 && styles.bodyLarge]}>{item.text}</Text> : null}
      {item.quoteBg ? <QuoteCard text={item.text} bg={item.quoteBg} passage={item.scripture} /> : null}
      {hasImages ? (
        <ImageGallery images={item.images} onDoubleTap={() => !item.liked && onLike && onLike(true)} onOpen={(i) => onOpenPhoto && onOpenPhoto(item.images, i)} style={{ marginTop: showText ? 12 : 4 }} />
      ) : null}
      {isVideo ? <InlineVideoSized item={item} playing={playing} onOpen={onOpenVideo} /> : null}

      {item.scripture && !item.quoteBg ? <PassagePill label={item.scripture} onPress={onOpenPassage} style={{ marginTop: 12 }} /> : null}

      {confirm ? (
        <FadeInUp distance={8} duration={260} style={styles.confirmBox}>
          <Text style={styles.confirmText}>Delete this post? It will be removed from everyone's feed.</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <Button small kind="danger" label="Delete" onPress={() => { setConfirm(false); onDelete && onDelete(); }} style={{ flex: 1 }} />
            <Button small kind="ghost" label="Cancel" onPress={() => setConfirm(false)} style={{ flex: 1 }} />
          </View>
        </FadeInUp>
      ) : null}

      {/* Actions */}
      <View style={styles.actions}>
        <PressScale onPress={() => onLike && onLike()} scaleTo={0.88} hitSlop={6} style={styles.action} accessibilityLabel={item.liked ? 'Unlike' : 'Like'}>
          <Pop trigger={!!item.liked} amount={1.4}>
            <Icon name="heart" size={18} color={item.liked ? colors.rose : SOCIAL.muted} fill={item.liked ? colors.rose : 'none'} />
          </Pop>
          <AnimatedNumber value={Number(item.likes) || 0} format={countFormat} duration={400} style={[styles.actionText, item.liked && { color: '#E07A8E' }]} />
        </PressScale>
        <PressScale onPress={onComment} scaleTo={0.88} hitSlop={6} style={styles.action} accessibilityLabel="Comments">
          <Pop trigger={item.comments} amount={1.2}>
            <Icon name="chat" size={18} color={SOCIAL.muted} />
          </Pop>
          <AnimatedNumber value={Number(item.comments) || 0} format={countFormat} duration={400} style={styles.actionText} />
        </PressScale>
        <PressScale onPress={onShare} scaleTo={0.88} hitSlop={6} style={styles.action} accessibilityLabel="Share">
          <Icon name="share" size={17} color={SOCIAL.muted} />
          {item.src === 'video' ? (
            <AnimatedNumber value={Number(item.shares) || 0} format={countFormat} duration={400} style={styles.actionText} />
          ) : (
            <Text style={styles.actionText}>Share</Text>
          )}
        </PressScale>
        {item.src === 'video' && !item.mine && onGift ? (
          <PressScale onPress={onGift} scaleTo={0.88} hitSlop={6} style={styles.action} accessibilityLabel="Send a gift">
            <Pop trigger={item.gifts} amount={1.3}>
              <Icon name="gift" size={17} color={colors.goldLight} />
            </Pop>
            <AnimatedNumber value={Number(item.gifts) || 0} format={countFormat} duration={400} style={[styles.actionText, { color: colors.goldLight }]} />
          </PressScale>
        ) : null}
        <PressScale onPress={onSave} scaleTo={0.88} hitSlop={6} style={[styles.action, { marginLeft: 'auto', marginRight: 0 }]} accessibilityLabel={item.saved ? 'Unsave post' : 'Save post'}>
          <Pop trigger={!!item.saved} amount={1.35}>
            <Icon name="bookmark" size={17} color={item.saved ? colors.goldLight : SOCIAL.muted} fill={item.saved ? colors.goldLight : 'none'} />
          </Pop>
          <Text style={[styles.actionText, item.saved && { color: colors.goldLight }]}>{item.saved ? 'Saved' : 'Save'}</Text>
        </PressScale>
      </View>
    </FadeInUp>
  );
}

// Portrait-ish video box sized from the card width
function InlineVideoSized(props) {
  const [w, setW] = useState(0);
  return (
    <View style={{ marginTop: 4 }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <InlineVideo {...props} height={w ? Math.round(w * 1.18) : 380} />
    </View>
  );
}

const eyebrow = { fontSize: 9.5, fontWeight: '700', letterSpacing: 1.2 };

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 12,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 6,
    borderRadius: 20,
    backgroundColor: SOCIAL.card,
    borderWidth: 1,
    borderColor: SOCIAL.line,
  },
  highlightRing: {
    position: 'absolute',
    top: -1,
    left: -1,
    right: -1,
    bottom: -1,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.goldLight,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  name: { flexShrink: 1, fontSize: 14.5, fontWeight: '700', color: SOCIAL.fg, letterSpacing: -0.1 },
  verified: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.goldLight, alignItems: 'center', justifyContent: 'center' },
  sub: { fontSize: 12, color: SOCIAL.faint, marginTop: 2 },
  kindBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1, maxWidth: 140 },
  kindBadgeText: { ...eyebrow, letterSpacing: 0.9 },
  iconBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  followBtn: { height: 28, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: SOCIAL.fg, alignItems: 'center', justifyContent: 'center' },
  followBtnOn: { backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  followText: { fontSize: 12, fontWeight: '700', color: colors.night },
  followTextOn: { color: SOCIAL.fg },

  body: { fontSize: 15, lineHeight: 22, color: SOCIAL.fg },
  bodyLarge: { fontFamily: fonts.serif, fontSize: 17.5, lineHeight: 25, letterSpacing: -0.1 },

  // Media
  mediaBox: { borderRadius: radius.lg, overflow: 'hidden', position: 'relative', backgroundColor: colors.nightRaised },
  mediaImg: { width: '100%', height: '100%' },
  mediaBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(21,23,43,0.72)',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
    zIndex: 5,
  },
  mediaBadgeDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.goldLight },
  mediaBadgeText: { color: colors.goldLight, fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  counterPill: { position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(21,23,43,0.72)', paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill },
  counterText: { color: WHITE, fontSize: 11, fontWeight: '700' },
  dotsRow: { position: 'absolute', bottom: 10, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.45)' },
  dotOn: { width: 16, backgroundColor: WHITE },

  videoBox: { backgroundColor: colors.night },
  videoBackdrop: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 8 },
  videoBackdropRef: { fontFamily: fonts.serifBold, fontSize: 15, color: colors.goldLight },
  videoScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' },
  mutedPill: { position: 'absolute', top: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(21,23,43,0.72)', paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill },
  mutedText: { color: WHITE, fontSize: 10.5, fontWeight: '600' },
  playCircle: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -30,
    marginTop: -42,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(0,0,0,0.42)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 3,
  },
  videoFoot: { position: 'absolute', left: 14, right: 14, bottom: 14 },
  videoFootTitle: { fontSize: 14.5, lineHeight: 20, fontWeight: '600', color: WHITE, textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  videoFootCta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  videoFootCtaText: { fontSize: 12, fontWeight: '700', color: colors.goldLight },

  quoteCard: { borderRadius: radius.lg, paddingHorizontal: 22, paddingTop: 16, paddingBottom: 22, alignItems: 'center', minHeight: 150, justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  quoteMark: { fontFamily: fonts.serifBold, fontSize: 40, lineHeight: 40, color: colors.goldLight, marginBottom: -4 },
  quoteText: { fontFamily: fonts.serifItalic, fontSize: 19, lineHeight: 27, color: WHITE, textAlign: 'center' },
  quoteRef: { color: colors.goldLight, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginTop: 12 },

  passagePill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    backgroundColor: alpha(colors.goldLight, 0.08),
    borderWidth: 1,
    borderColor: alpha(colors.goldLight, 0.4),
    paddingLeft: 10,
    paddingRight: 9,
    height: 30,
    borderRadius: radius.pill,
    maxWidth: '100%',
  },
  passageText: { fontFamily: fonts.serifBold, fontSize: 13.5, color: colors.goldLight, flexShrink: 1 },
  passageSep: { width: 1, height: 12, backgroundColor: 'rgba(255,255,255,0.2)' },
  passageCta: { fontSize: 11.5, fontWeight: '600', color: SOCIAL.muted },

  confirmBox: { marginTop: 12, padding: 12, borderRadius: radius.md, backgroundColor: alpha(colors.rose, 0.12), borderWidth: 1, borderColor: alpha(colors.rose, 0.35) },
  confirmText: { fontSize: 13, lineHeight: 18, color: SOCIAL.fg },

  actions: { flexDirection: 'row', alignItems: 'center', marginTop: 8, paddingTop: 4 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, marginRight: 18 },
  actionText: { fontSize: 12.5, fontWeight: '600', color: SOCIAL.muted },

  viewer: { flex: 1, backgroundColor: '#000000' },
  viewerTop: { position: 'absolute', top: Platform.OS === 'ios' ? 54 : 18, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  viewerCount: { color: WHITE, fontSize: 13, fontWeight: '700' },
  viewerClose: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
});
