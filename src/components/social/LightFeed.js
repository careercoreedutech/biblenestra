// Light, Facebook-style pieces for the Socials "Feed" segment (the Videos segment keeps the dark reels).
// Parchment canvas, white rounded cards with a soft border/shadow — the visual language of the old Feed
// screen — plus Facebook patterns: composer card, Reels strip, photo grids, counts line + action bar,
// long-press reactions and a ⋯ post menu.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Icon } from '../Icons';
import { colors, fonts, radius, shadow } from '../../theme';
import { alpha } from '../ui';
import { PressScale, FadeInUp, ScaleIn, Pop, Pulse, LiveRing, AnimatedNumber, AnimatedModal, EASE_IN, EASE_OUT } from '../Motion';
import { haptic } from '../Toast';
import { SocialAvatar } from './FeedCard';
import { ND, WHITE, countFormat } from './shared';

// ─── Reactions (long-press Like) ─────────────────────────────────
export const REACTIONS = [
  { key: 'amen', emoji: '🙏', label: 'Amen', color: colors.gold },
  { key: 'love', emoji: '❤️', label: 'Love', color: colors.rose },
  { key: 'praise', emoji: '🙌', label: 'Praise', color: colors.amber },
  { key: 'care', emoji: '😢', label: 'Care', color: colors.sky },
];
export const reactionOf = (key) => REACTIONS.find((r) => r.key === key) || null;

// Badge tint for a post kind, tuned for light cards (gold-light is too pale on white)
function lightKindTint(kind) {
  return (
    {
      Announcement: colors.sky,
      Celebration: colors.gold,
      Reflection: colors.sage,
      Study: colors.lavender,
      Testimony: colors.rose,
      Prayer: colors.teal,
      Question: colors.sky,
      Event: colors.terracotta,
      Greeting: colors.gold,
      Repost: colors.primary,
      Sermons: colors.primary,
      Worship: colors.lavender,
      Testimonies: colors.rose,
      'Bible Study': colors.sage,
      Evangelism: colors.teal,
    }[kind] || colors.gold
  );
}

function KindBadge({ kind }) {
  const tint = lightKindTint(kind);
  return (
    <View style={[styles.kindBadge, { backgroundColor: alpha(tint, 0.1) }]}>
      <Text style={[styles.kindBadgeText, { color: tint }]} numberOfLines={1}>{String(kind || 'Post').toUpperCase()}</Text>
    </View>
  );
}

function VerifiedTick({ size = 14 }) {
  return (
    <View style={[styles.verified, { width: size, height: size, borderRadius: size / 2 }]}>
      <Icon name="check" size={Math.round(size * 0.58)} color={WHITE} strokeWidth={3.4} />
    </View>
  );
}

// Passage chip in the old Feed's style: "John 3 · Open"
export function LightPassageChip({ label, onPress, style }) {
  return (
    <PressScale onPress={onPress} scaleTo={0.95} style={[styles.passage, style]} accessibilityLabel={`Open ${label}`}>
      <Icon name="book" size={13} color={colors.gold} />
      <Text style={styles.passageText} numberOfLines={1}>{label}</Text>
      <View style={styles.passageSep} />
      <Text style={styles.passageCta}>Open</Text>
      <Icon name="chevron-right" size={11} color={colors.muted} strokeWidth={2.6} />
    </PressScale>
  );
}

// Big heart that pops on a double-tapped photo, then floats away
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

// ─── Photo grid, Facebook layouts ────────────────────────────────
// 1 photo: full width · 2: side by side · 3: one big on top + two below · 4+: 2×2 with "+N" on the last tile.
// Single tap opens the full-screen viewer at that photo; double tap likes with a floating heart.
const GAP = 2;
function gridCells(n, w) {
  if (!w || !n) return { H: 0, cells: [] };
  if (n === 1) {
    const H = Math.round(w * 0.86);
    return { H, cells: [{ x: 0, y: 0, w, h: H }] };
  }
  const half = (w - GAP) / 2;
  if (n === 2) {
    const H = Math.round(w * 0.64);
    return { H, cells: [{ x: 0, y: 0, w: half, h: H }, { x: half + GAP, y: 0, w: half, h: H }] };
  }
  if (n === 3) {
    const top = Math.round(w * 0.56);
    const bottom = Math.round(w * 0.38);
    return {
      H: top + GAP + bottom,
      cells: [
        { x: 0, y: 0, w, h: top },
        { x: 0, y: top + GAP, w: half, h: bottom },
        { x: half + GAP, y: top + GAP, w: half, h: bottom },
      ],
    };
  }
  const ch = Math.round(half * 0.92);
  return {
    H: ch * 2 + GAP,
    cells: [
      { x: 0, y: 0, w: half, h: ch },
      { x: half + GAP, y: 0, w: half, h: ch },
      { x: 0, y: ch + GAP, w: half, h: ch },
      { x: half + GAP, y: ch + GAP, w: half, h: ch },
    ],
  };
}

export function PhotoGrid({ images = [], onOpen, onDoubleTap, style }) {
  const [w, setW] = useState(0);
  const [hearts, setHearts] = useState([]);
  const lastTap = useRef(0);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const n = images.length;
  const { H, cells } = gridCells(n, w);
  const extra = n - 4;

  const onTap = (i) => {
    const now = Date.now();
    if (now - lastTap.current < 280) {
      clearTimeout(timer.current);
      lastTap.current = 0;
      const c = cells[i] || { x: 0, y: 0, w, h: H };
      setHearts((l) => [...l.slice(-2), { id: `${now}`, x: c.x + c.w / 2, y: c.y + c.h / 2 }]);
      onDoubleTap && onDoubleTap();
      return;
    }
    lastTap.current = now;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onOpen && onOpen(i), 280);
  };

  return (
    <View style={[styles.grid, { height: w ? H : 300 }, style]} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {cells.map((c, i) => (
        <Pressable
          key={`${i}_${String(images[i]).slice(-24)}`}
          onPress={() => onTap(i)}
          style={[styles.gridCell, { left: c.x, top: c.y, width: c.w, height: c.h }]}
          accessibilityLabel={n > 1 ? `Photo ${i + 1} of ${n}` : 'Photo'}
        >
          <Image source={{ uri: images[i] }} style={styles.gridImg} resizeMode="cover" />
          {i === 3 && extra > 0 ? (
            <View style={styles.gridMore} pointerEvents="none">
              <Text style={styles.gridMoreText}>+{extra}</Text>
            </View>
          ) : null}
        </Pressable>
      ))}
      {hearts.map((ht) => (
        <FloatingHeart key={ht.id} x={ht.x} y={ht.y} onDone={() => setHearts((l) => l.filter((x) => x.id !== ht.id))} />
      ))}
    </View>
  );
}

// ─── Inline video: muted autoplay while it's the most visible card; tap opens Videos at this clip ───
function InlineVideo({ item, playing, onOpen }) {
  const [w, setW] = useState(0);
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
  const h = w ? Math.round(Math.min(w * 1.12, 520)) : 400;
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <PressScale onPress={onOpen} scaleTo={0.99} style={[styles.videoBox, { height: h, backgroundColor: item.raw && item.raw.bg ? item.raw.bg : colors.night }]} accessibilityLabel={`Watch video: ${item.text}`}>
        <View style={styles.videoBackdrop}>
          <Icon name="video" size={26} color={alpha(colors.goldLight, 0.7)} />
          {item.scripture ? <Text style={styles.videoBackdropRef}>{item.scripture}</Text> : null}
        </View>
        {item.poster || (item.raw && item.raw.poster) ? (
          <Image source={{ uri: item.poster || item.raw.poster }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : null}
        {item.videoUrl ? (
          <VideoView style={StyleSheet.absoluteFill} player={player} allowsFullscreen={false} allowsPictureInPicture={false} nativeControls={false} contentFit="cover" />
        ) : null}
        <View style={styles.videoScrim} pointerEvents="none">
          <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
            <Defs>
              <LinearGradient id={`lvg_${item.id}`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor="#000000" stopOpacity="0" />
                <Stop offset="100%" stopColor="#000000" stopOpacity="0.66" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill={`url(#lvg_${item.id})`} />
          </Svg>
        </View>
        <View style={styles.videoBadge} pointerEvents="none">
          {playing ? (
            <Pulse min={0.7} max={1.25} duration={800}>
              <View style={styles.videoBadgeDot} />
            </Pulse>
          ) : (
            <View style={styles.videoBadgeDot} />
          )}
          <Text style={styles.videoBadgeText}>{`VIDEO${item.duration ? ` · ${item.duration}` : ''}`}</Text>
        </View>
        <View style={styles.mutedPill} pointerEvents="none">
          <Icon name="volume" size={12} color={WHITE} />
          <Text style={styles.mutedText}>Muted</Text>
        </View>
        <View style={styles.playCircle} pointerEvents="none">
          <Icon name="play" size={24} color={WHITE} />
        </View>
        <View style={styles.videoFoot} pointerEvents="none">
          <Text style={styles.videoFootText}>Watch in Videos</Text>
          <Icon name="arrow-right" size={12} color={colors.goldLight} strokeWidth={2.6} />
        </View>
      </PressScale>
    </View>
  );
}

// Online: a video that's still uploading to / being processed by Cloudflare Stream
function ProcessingVideo({ item }) {
  const uploading = item.uploadProgress != null && item.uploadProgress < 1 && item.raw && item.raw.videoStatus === 'uploading';
  const pct = Math.round((item.uploadProgress || 0) * 100);
  return (
    <View style={[styles.videoBox, styles.processingBox]}>
      <Pulse min={0.9} max={1.08} active={!item.videoError}>
        <View style={styles.processingIcon}>
          <Icon name={item.videoError ? 'x' : 'video'} size={24} color={colors.goldLight} />
        </View>
      </Pulse>
      <Text style={styles.processingTitle}>{item.videoError ? 'This video couldn’t be processed' : uploading ? `Uploading · ${pct}%` : 'Processing your video…'}</Text>
      <Text style={styles.processingSub}>{item.videoError ? 'Try uploading it again' : uploading ? 'Keep the app open until the upload finishes' : 'It will play here as soon as it’s ready'}</Text>
      {uploading ? (
        <View style={styles.processingTrack}><View style={[styles.processingFill, { width: `${Math.max(4, pct)}%` }]} /></View>
      ) : null}
    </View>
  );
}

// Themed text post (dark tint + white serif quote)
function QuoteBlock({ text, bg, passage }) {
  return (
    <View style={[styles.quote, { backgroundColor: bg }]}>
      <Text style={styles.quoteMark}>“</Text>
      <Text style={styles.quoteText}>{text}</Text>
      {passage ? <Text style={styles.quoteRef}>— {passage}</Text> : null}
    </View>
  );
}

// Gold glow around a card we navigated to (deep link / just published)
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

// Small reaction tray that springs up above the Like button
function ReactionPicker({ current, onPick }) {
  return (
    <ScaleIn from={0.6} style={styles.picker}>
      {REACTIONS.map((r, i) => {
        const on = current === r.key;
        return (
          <FadeInUp key={r.key} index={i} distance={10} duration={260} stagger={40}>
            <PressScale onPress={() => onPick(r.key)} scaleTo={0.82} style={[styles.pickerItem, on && { backgroundColor: alpha(r.color, 0.12) }]} accessibilityLabel={`React ${r.label}`}>
              <Text style={styles.pickerEmoji}>{r.emoji}</Text>
              <Text style={[styles.pickerLabel, on && { color: r.color }]}>{r.label}</Text>
            </PressScale>
          </FadeInUp>
        );
      })}
    </ScaleIn>
  );
}

// ─── The light post card ─────────────────────────────────────────
export function LightPostCard({
  item,
  index = 0,
  playing,
  highlight,
  isFollowing,
  onLike,
  onReact,
  onComment,
  onShare,
  onSave,
  onMenu,
  onFollow,
  onOpenPassage,
  onOpenVideo,
  onOpenPhoto,
  onOpenAuthor,
  onOpenLikes,
}) {
  const [expanded, setExpanded] = useState(false);
  const [picker, setPicker] = useState(false);
  const processing = !!item.processing || !!item.videoError;
  const isVideo = !!item.videoUrl && !processing;
  const hasImages = item.images && item.images.length > 0;
  const showText = !!item.text && !item.quoteBg;
  const long = showText && item.text.length > 260;
  const reaction = item.liked ? reactionOf(item.reaction) : null;
  const likeColor = reaction ? reaction.color : item.liked ? colors.rose : colors.muted;
  const comments = Number(item.comments) || 0;
  const shares = Number(item.shares) || 0;
  const likes = Number(item.likes) || 0;
  const showFollow = (item.src === 'video' || !!item.handle) && !item.mine && onFollow && !isFollowing;

  const pick = (key) => {
    setPicker(false);
    onReact && onReact(key);
  };
  useEffect(() => {
    if (!picker) return undefined;
    const t = setTimeout(() => setPicker(false), 5000);
    return () => clearTimeout(t);
  }, [picker]);

  return (
    <FadeInUp index={index} distance={16} style={styles.card}>
      <HighlightRing active={highlight} />

      {/* Author row */}
      <View style={styles.head}>
        <PressScale onPress={onOpenAuthor} disabled={!onOpenAuthor} scaleTo={0.92} accessibilityLabel={item.name}>
          <SocialAvatar name={item.name} label={item.avatarText} uri={item.avatarUrl} size={42} ring={item.mine} />
        </PressScale>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.nameRow}>
            <Pressable onPress={onOpenAuthor} disabled={!onOpenAuthor} hitSlop={4} style={{ flexShrink: 1 }} accessibilityRole="link" accessibilityLabel={`Open ${item.mine ? 'your' : `${item.name}'s`} profile`}>
              <Text style={styles.name} numberOfLines={1}>{item.mine ? `${item.name} (you)` : item.name}</Text>
            </Pressable>
            {item.verified ? <VerifiedTick /> : null}
            {showFollow ? (
              <PressScale onPress={onFollow} hitSlop={8} scaleTo={0.9} accessibilityLabel={`Follow ${item.name}`}>
                <Text style={styles.followLink}>· Follow</Text>
              </PressScale>
            ) : null}
          </View>
          <View style={styles.subRow}>
            <Text style={styles.sub} numberOfLines={1}>{[item.sub, item.time].filter(Boolean).join(' · ')}</Text>
            <Icon name="globe" size={11} color={colors.faint} />
            {hasImages && item.kind === 'Photo' ? null : <KindBadge kind={item.kind} />}
          </View>
        </View>
        <PressScale onPress={onMenu} hitSlop={8} scaleTo={0.86} style={styles.moreBtn} accessibilityLabel="Post options">
          <Icon name="more" size={18} color={colors.muted} />
        </PressScale>
      </View>

      {/* Body */}
      {showText ? (
        <Pressable onPress={long ? () => setExpanded((v) => !v) : undefined} disabled={!long}>
          <Text
            style={[styles.body, !hasImages && !isVideo && item.text.length < 110 && styles.bodyLarge]}
            numberOfLines={long && !expanded ? 5 : undefined}
          >
            {item.text}
          </Text>
          {long ? <Text style={styles.seeMore}>{expanded ? 'See less' : 'See more'}</Text> : null}
        </Pressable>
      ) : null}
      {item.quoteBg ? <QuoteBlock text={item.text} bg={item.quoteBg === colors.night ? colors.nightRaised : item.quoteBg} passage={item.scripture} /> : null}
      {item.scripture && !item.quoteBg ? <LightPassageChip label={item.scripture} onPress={onOpenPassage} style={{ marginTop: showText ? 10 : 2 }} /> : null}

      {/* Media — edge to edge inside the card, like Facebook */}
      {hasImages ? (
        <PhotoGrid
          images={item.images}
          onDoubleTap={() => !item.liked && onLike && onLike(true)}
          onOpen={(i) => onOpenPhoto && onOpenPhoto(item.images, i)}
          style={styles.mediaBleed}
        />
      ) : null}
      {isVideo ? (
        <View style={styles.mediaBleed}>
          <InlineVideo item={item} playing={playing} onOpen={onOpenVideo} />
        </View>
      ) : null}
      {processing ? (
        <View style={styles.mediaBleed}>
          <ProcessingVideo item={item} />
        </View>
      ) : null}

      {/* Counts line */}
      {likes || comments || shares ? (
        <View style={styles.counts}>
          {likes ? (
            <Pressable onPress={onOpenLikes} disabled={!onOpenLikes} hitSlop={6} style={styles.countsLeft} accessibilityLabel={`${likes} ${likes === 1 ? 'like' : 'likes'} · see who liked`}>
              <View style={styles.reactStack}>
                <View style={[styles.reactBubble, { backgroundColor: colors.rose }]}>
                  <Icon name="heart" size={9} color={WHITE} fill={WHITE} strokeWidth={2} />
                </View>
                {reaction && reaction.key !== 'love' ? (
                  <View style={[styles.reactBubble, styles.reactBubbleEmoji]}>
                    <Text style={styles.reactBubbleText}>{reaction.emoji}</Text>
                  </View>
                ) : null}
              </View>
              <AnimatedNumber value={likes} format={countFormat} duration={400} style={styles.countsText} />
            </Pressable>
          ) : (
            <View />
          )}
          <View style={styles.countsRight}>
            {comments ? (
              <Pressable onPress={onComment} hitSlop={6} accessibilityLabel="View comments">
                <Text style={styles.countsText}>{`${countFormat(comments)} ${comments === 1 ? 'comment' : 'comments'}`}</Text>
              </Pressable>
            ) : null}
            {comments && shares ? <Text style={styles.countsText}> · </Text> : null}
            {shares ? <Text style={styles.countsText}>{`${countFormat(shares)} ${shares === 1 ? 'share' : 'shares'}`}</Text> : null}
          </View>
        </View>
      ) : null}

      {/* Action bar */}
      <View style={styles.actions}>
        {picker ? <Pressable style={styles.pickerScrim} onPress={() => setPicker(false)} accessibilityLabel="Close reactions" /> : null}
        <PressScale
          onPress={() => {
            if (picker) { setPicker(false); return; }
            onLike && onLike(false);
          }}
          onLongPress={() => { haptic('select'); setPicker(true); }}
          delayLongPress={320}
          scaleTo={0.9}
          style={styles.action}
          accessibilityLabel={item.liked ? 'Unlike (long-press to react)' : 'Like (long-press to react)'}
        >
          <Pop trigger={`${!!item.liked}_${item.reaction || ''}`} amount={1.35}>
            {reaction ? (
              <Text style={styles.actionEmoji}>{reaction.emoji}</Text>
            ) : (
              <Icon name="heart" size={18} color={likeColor} fill={item.liked ? colors.rose : 'none'} />
            )}
          </Pop>
          <Text style={[styles.actionText, (item.liked || reaction) && { color: likeColor, fontWeight: '700' }]}>{reaction ? reaction.label : 'Like'}</Text>
        </PressScale>
        <PressScale onPress={onComment} scaleTo={0.9} style={styles.action} accessibilityLabel="Comment">
          <Icon name="chat" size={18} color={colors.muted} />
          <Text style={styles.actionText}>Comment</Text>
        </PressScale>
        <PressScale onPress={onShare} scaleTo={0.9} style={styles.action} accessibilityLabel="Share">
          <Icon name="share" size={17} color={colors.muted} />
          <Text style={styles.actionText}>Share</Text>
        </PressScale>
        <PressScale onPress={onSave} scaleTo={0.9} style={styles.action} accessibilityLabel={item.saved ? 'Unsave post' : 'Save post'}>
          <Pop trigger={!!item.saved} amount={1.35}>
            <Icon name="bookmark" size={17} color={item.saved ? colors.primary : colors.muted} fill={item.saved ? colors.primary : 'none'} />
          </Pop>
          <Text style={[styles.actionText, item.saved && { color: colors.primary, fontWeight: '700' }]}>{item.saved ? 'Saved' : 'Save'}</Text>
        </PressScale>
        {picker ? <ReactionPicker current={item.liked ? item.reaction : null} onPick={pick} /> : null}
      </View>
    </FadeInUp>
  );
}

// ─── Composer card: "What's on your heart, Aviral?" ──────────────
export function ComposerCard({ userName, onOpen, avatarUri }) {
  const first = String(userName || 'friend').trim().split(/\s+/)[0] || 'friend';
  const QUICK = [
    { mode: 'photo', icon: 'image', label: 'Photo', tint: colors.sage },
    { mode: 'video', icon: 'video', label: 'Video', tint: colors.rose },
    { mode: 'verse', icon: 'book', label: 'Verse', tint: colors.gold },
  ];
  return (
    <FadeInUp distance={10} style={styles.composer}>
      <PressScale onPress={() => onOpen('text')} scaleTo={0.985} style={styles.composerTop} accessibilityLabel="Create a post">
        <SocialAvatar name={userName} uri={avatarUri} size={40} ring />
        <View style={styles.composerInput}>
          <Text style={styles.composerPlaceholder} numberOfLines={1}>What’s on your heart, {first}?</Text>
        </View>
      </PressScale>
      <View style={styles.composerActions}>
        {QUICK.map((q) => (
          <PressScale key={q.mode} onPress={() => onOpen(q.mode)} scaleTo={0.93} style={styles.composerAction} accessibilityLabel={`New ${q.label.toLowerCase()} post`}>
            <View style={[styles.composerActionIcon, { backgroundColor: alpha(q.tint, 0.12) }]}>
              <Icon name={q.icon} size={15} color={q.tint} />
            </View>
            <Text style={styles.composerActionText}>{q.label}</Text>
          </PressScale>
        ))}
      </View>
    </FadeInUp>
  );
}

// ─── Reels strip: tall 9:16 thumbnails, like Facebook reels/stories ───
const TILE_W = 108;
const TILE_H = Math.round((TILE_W * 16) / 9);

function ReelThumb({ video, onPress, index, onOpenCreator }) {
  // Uploaded videos have a poster image (cheap); older/demo ones use a paused, muted player for the first frame
  const player = useVideoPlayer(video.poster ? null : video.videoUrl || null, (p) => {
    p.muted = true;
    p.loop = false;
  });
  const c = video.creator || {};
  return (
    <FadeInUp index={index} distance={10} duration={360}>
      <PressScale onPress={onPress} scaleTo={0.95} style={[styles.tile, { backgroundColor: video.bg || colors.night }]} accessibilityLabel={`Watch ${c.name || 'reel'}`}>
        <Text style={styles.tileCaption} numberOfLines={5}>{video.caption}</Text>
        {video.poster ? (
          <Image source={{ uri: video.poster }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : video.videoUrl ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <VideoView style={StyleSheet.absoluteFill} player={player} allowsFullscreen={false} allowsPictureInPicture={false} nativeControls={false} contentFit="cover" />
          </View>
        ) : null}
        <View style={styles.tileScrim} pointerEvents="none">
          <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
            <Defs>
              <LinearGradient id={`rt_${video.id}`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor="#000000" stopOpacity="0.28" />
                <Stop offset="38%" stopColor="#000000" stopOpacity="0" />
                <Stop offset="62%" stopColor="#000000" stopOpacity="0" />
                <Stop offset="100%" stopColor="#000000" stopOpacity="0.74" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill={`url(#rt_${video.id})`} />
          </Svg>
        </View>
        {onOpenCreator ? (
          <PressScale onPress={onOpenCreator} scaleTo={0.88} hitSlop={6} style={styles.tileAvatar} accessibilityLabel={`Open ${c.name}'s profile`}>
            <SocialAvatar name={c.name} label={c.avatar} uri={c.avatarUrl} size={30} />
          </PressScale>
        ) : (
          <View style={styles.tileAvatar} pointerEvents="none">
            <SocialAvatar name={c.name} label={c.avatar} uri={c.avatarUrl} size={30} />
          </View>
        )}
        <View style={styles.tileFoot} pointerEvents="none">
          <Text style={styles.tileName} numberOfLines={2}>{c.name}</Text>
          <View style={styles.tileViews}>
            <Icon name="play" size={9} color={WHITE} />
            <Text style={styles.tileViewsText}>{video.views || countFormat(video.likes || 0)}</Text>
          </View>
        </View>
      </PressScale>
    </FadeInUp>
  );
}

export function ReelsStrip({ videos = [], userName, userAvatar, onOpen, onCreate, onSeeAll, onOpenCreator }) {
  return (
    <FadeInUp index={1} distance={10} style={styles.reelsCard}>
      <View style={styles.reelsHead}>
        <View style={styles.reelsTitleRow}>
          <View style={styles.reelsIcon}>
            <Icon name="play" size={12} color={WHITE} />
          </View>
          <Text style={styles.reelsTitle}>Reels</Text>
        </View>
        <PressScale onPress={onSeeAll} hitSlop={8} scaleTo={0.93} style={styles.reelsSeeAll} accessibilityLabel="See all videos">
          <Text style={styles.reelsSeeAllText}>See all</Text>
          <Icon name="chevron-right" size={12} color={colors.primary} strokeWidth={2.6} />
        </PressScale>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.reelsRow}>
        <FadeInUp distance={10} duration={360}>
          <PressScale onPress={onCreate} scaleTo={0.95} style={styles.createTile} accessibilityLabel="Create a reel">
            <View style={styles.createTop}>
              <SocialAvatar name={userName} uri={userAvatar} size={52} />
            </View>
            <View style={styles.createPlus}>
              <Icon name="plus" size={16} color={WHITE} strokeWidth={2.8} />
            </View>
            <Text style={styles.createText}>Create{'\n'}reel</Text>
          </PressScale>
        </FadeInUp>
        {videos.map((v, i) => (
          <ReelThumb key={v.id} video={v} index={i + 1} onPress={() => onOpen(v.id)} onOpenCreator={onOpenCreator ? () => onOpenCreator(v) : undefined} />
        ))}
      </ScrollView>
    </FadeInUp>
  );
}

// ─── Creator hub entry points (guild / Creators Corner) ──────────
export function HubCards({ guildUnread, onGuild, onCorner }) {
  return (
    <FadeInUp distance={12} style={styles.hubRow}>
      <PressScale onPress={onGuild} scaleTo={0.97} style={styles.hubCard} accessibilityLabel="Open Clip Farm guild">
        <View style={[styles.hubIcon, { backgroundColor: colors.night }]}>
          <Text style={styles.hubIconText}>CF</Text>
          {guildUnread ? (
            <ScaleIn style={styles.hubBadge}>
              <Text style={styles.hubBadgeText}>{guildUnread}</Text>
            </ScaleIn>
          ) : null}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.hubTitle} numberOfLines={1}>Clip Farm guild</Text>
          <View style={styles.hubLiveRow}>
            <LiveRing color={colors.positive} size={6} />
            <Text style={styles.hubSub} numberOfLines={1}>210 online</Text>
          </View>
        </View>
      </PressScale>
      <PressScale onPress={onCorner} scaleTo={0.97} style={styles.hubCard} accessibilityLabel="Creators Corner bounties">
        <View style={[styles.hubIcon, { backgroundColor: colors.cardGold }]}>
          <Icon name="sparkles" size={17} color={colors.gold} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.hubTitle} numberOfLines={1}>Creators Corner</Text>
          <Text style={styles.hubSub} numberOfLines={1}>Paid bounties</Text>
        </View>
      </PressScale>
    </FadeInUp>
  );
}

// ─── ⋯ post menu (bottom sheet) ──────────────────────────────────
function MenuRow({ icon, label, sub, onPress, tone, index }) {
  const tint = tone === 'danger' ? colors.negative : colors.fg;
  return (
    <FadeInUp index={index} distance={8} duration={280} stagger={35}>
      <PressScale onPress={onPress} scaleTo={0.98} style={styles.menuRow} accessibilityLabel={label}>
        <View style={[styles.menuIcon, tone === 'danger' && { backgroundColor: colors.negativeFaint }]}>
          <Icon name={icon} size={17} color={tone === 'danger' ? colors.negative : colors.fg} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.menuLabel, { color: tint }]}>{label}</Text>
          {sub ? <Text style={styles.menuSub} numberOfLines={1}>{sub}</Text> : null}
        </View>
      </PressScale>
    </FadeInUp>
  );
}

export function PostMenuSheet({ visible, item, isFollowing, onClose, onSave, onShare, onHide, onDelete, onFollow, onOpenVideo, onGift, onComment, onProfile }) {
  // Keep the last item while the sheet animates out
  const last = useRef(null);
  if (item) last.current = item;
  const it = item || last.current;
  const rows = [];
  if (it) {
    rows.push({ icon: 'bookmark', label: it.saved ? 'Remove from saved' : 'Save post', sub: it.saved ? 'Take it out of your saved items' : 'Find it later in your saved items', onPress: onSave });
    rows.push({ icon: 'share', label: 'Share', sub: 'Send it to a friend or another app', onPress: onShare });
    rows.push({ icon: 'chat', label: 'Comment', sub: 'Join the conversation', onPress: onComment });
    if (onProfile) rows.push({ icon: 'user', label: it.mine ? 'View your profile' : `View ${it.name}'s profile`, sub: it.mine ? 'Your posts, photo and details' : 'Their posts, videos and details', onPress: onProfile });
    if (it.src !== 'video' && it.handle && !it.mine) {
      // online: follow the author of a text / photo post
      rows.push({ icon: isFollowing ? 'user' : 'users', label: isFollowing ? `Unfollow ${it.name}` : `Follow ${it.name}`, sub: isFollowing ? 'Stop seeing their posts in Following' : 'See their posts in Following', onPress: onFollow });
    }
    if (it.src === 'video') {
      if (it.videoUrl && !it.processing) rows.push({ icon: 'play', label: 'Watch in Videos', sub: 'Full screen with sound', onPress: onOpenVideo });
      if (!it.mine) {
        rows.push({ icon: isFollowing ? 'user' : 'users', label: isFollowing ? `Unfollow ${it.name}` : `Follow ${it.name}`, sub: isFollowing ? 'Stop seeing their posts in Following' : 'See their posts in Following', onPress: onFollow });
        rows.push({ icon: 'gift', label: 'Send a gift', sub: 'Bless this creator with coins', onPress: onGift });
      }
    }
    if (!it.mine) rows.push({ icon: 'x', label: 'Hide post', sub: 'See fewer posts like this', onPress: onHide });
    if (it.mine) rows.push({ icon: 'trash', label: it.src === 'video' ? 'Delete video' : 'Delete post', sub: 'You can undo this right after', onPress: onDelete, tone: 'danger' });
  }
  return (
    <AnimatedModal visible={visible} onRequestClose={onClose}>
      <View style={styles.menuOverlay}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Dismiss" />
        <View style={styles.menuSheet}>
          <View style={styles.grabber} />
          {it ? (
            <View style={styles.menuHead}>
              <SocialAvatar name={it.name} label={it.avatarText} size={34} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.menuEyebrow}>Post options</Text>
                <Text style={styles.menuTitle} numberOfLines={1}>{it.mine ? 'Your post' : it.name}</Text>
              </View>
              <PressScale onPress={onClose} hitSlop={12} scaleTo={0.88} style={styles.menuClose} accessibilityLabel="Close">
                <Icon name="x" size={14} color={colors.muted} strokeWidth={2.6} />
              </PressScale>
            </View>
          ) : null}
          <View style={styles.menuCard}>
            {rows.map((r, i) => (
              <View key={r.label}>
                {i ? <View style={styles.menuDivider} /> : null}
                <MenuRow {...r} index={i} />
              </View>
            ))}
          </View>
        </View>
      </View>
    </AnimatedModal>
  );
}

// ─── Styles ──────────────────────────────────────────────────────
const CARD_PAD = 14;
const eyebrow = { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase' };

const styles = StyleSheet.create({
  processingBox: { height: 260, backgroundColor: colors.night, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  processingIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(212,168,82,0.35)', alignItems: 'center', justifyContent: 'center' },
  processingTitle: { marginTop: 14, fontFamily: fonts.serifBold, fontSize: 18, color: colors.nightFg, textAlign: 'center' },
  processingSub: { marginTop: 4, fontSize: 12.5, color: colors.nightMuted, textAlign: 'center' },
  processingTrack: { marginTop: 16, width: '70%', height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  processingFill: { height: 4, borderRadius: 2, backgroundColor: colors.goldLight },
  card: {
    marginHorizontal: 12,
    marginBottom: 12,
    paddingHorizontal: CARD_PAD,
    paddingTop: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  highlightRing: { position: 'absolute', top: -1, left: -1, right: -1, bottom: -1, borderRadius: radius.lg, borderWidth: 2, borderColor: colors.gold },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  name: { flexShrink: 1, fontSize: 14.5, fontWeight: '700', color: colors.fg, letterSpacing: -0.1 },
  verified: { backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  followLink: { fontSize: 13, fontWeight: '700', color: colors.primary },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  sub: { flexShrink: 1, fontSize: 12, color: colors.faint },
  kindBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill, maxWidth: 120, marginLeft: 2 },
  kindBadgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.7 },
  moreBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginRight: -6 },

  body: { fontSize: 15, lineHeight: 22, color: colors.fg },
  bodyLarge: { fontFamily: fonts.serif, fontSize: 18, lineHeight: 26, color: colors.passage, letterSpacing: -0.1 },
  seeMore: { fontSize: 13.5, fontWeight: '700', color: colors.muted, marginTop: 2 },

  passage: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    backgroundColor: colors.cardGold,
    borderWidth: 1,
    borderColor: alpha(colors.gold, 0.22),
    paddingLeft: 10,
    paddingRight: 9,
    height: 30,
    borderRadius: radius.pill,
    maxWidth: '100%',
  },
  passageText: { fontFamily: fonts.serifBold, fontSize: 13.5, color: colors.goldMuted, flexShrink: 1 },
  passageSep: { width: 1, height: 12, backgroundColor: alpha(colors.gold, 0.3) },
  passageCta: { fontSize: 11.5, fontWeight: '700', color: colors.muted },

  quote: { borderRadius: radius.md, paddingHorizontal: 22, paddingTop: 16, paddingBottom: 22, alignItems: 'center', minHeight: 150, justifyContent: 'center' },
  quoteMark: { fontFamily: fonts.serifBold, fontSize: 40, lineHeight: 40, color: colors.goldLight, marginBottom: -4 },
  quoteText: { fontFamily: fonts.serifItalic, fontSize: 19, lineHeight: 27, color: WHITE, textAlign: 'center' },
  quoteRef: { color: colors.goldLight, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginTop: 12 },

  // Media bleeds to the card edges (inside the 1px border)
  mediaBleed: { marginHorizontal: -CARD_PAD, marginTop: 12 },
  grid: { position: 'relative', backgroundColor: colors.raised, overflow: 'hidden' },
  gridCell: { position: 'absolute', overflow: 'hidden', backgroundColor: colors.raised },
  gridImg: { width: '100%', height: '100%' },
  gridMore: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  gridMoreText: { color: WHITE, fontSize: 30, fontWeight: '700' },

  videoBox: { overflow: 'hidden', position: 'relative' },
  videoBackdrop: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 8 },
  videoBackdropRef: { fontFamily: fonts.serifBold, fontSize: 15, color: colors.goldLight },
  videoScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%' },
  videoBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(21,23,43,0.72)',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  videoBadgeDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.goldLight },
  videoBadgeText: { color: colors.goldLight, fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  mutedPill: { position: 'absolute', top: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(21,23,43,0.72)', paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill },
  mutedText: { color: WHITE, fontSize: 10.5, fontWeight: '600' },
  playCircle: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -30,
    marginTop: -30,
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
  videoFoot: { position: 'absolute', left: 14, bottom: 14, flexDirection: 'row', alignItems: 'center', gap: 6 },
  videoFootText: { fontSize: 12.5, fontWeight: '700', color: colors.goldLight },

  counts: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10, paddingBottom: 8, gap: 10 },
  countsLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  countsRight: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  countsText: { fontSize: 12.5, color: colors.muted },
  reactStack: { flexDirection: 'row' },
  reactBubble: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.surface },
  reactBubbleEmoji: { backgroundColor: colors.cardGold, marginLeft: -5 },
  reactBubbleText: { fontSize: 9.5, lineHeight: 12 },

  actions: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.rule, marginHorizontal: -6, paddingVertical: 3, position: 'relative' },
  action: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 40, borderRadius: radius.sm },
  actionText: { fontSize: 12.5, fontWeight: '600', color: colors.muted },
  actionEmoji: { fontSize: 16, lineHeight: 20 },

  // Tapping anywhere on the card closes the reaction tray (it also closes itself after a few seconds)
  pickerScrim: { position: 'absolute', top: -1200, left: -20, right: -20, bottom: -20, zIndex: 29 },
  picker: {
    position: 'absolute',
    left: 0,
    bottom: 44,
    zIndex: 30,
    flexDirection: 'row',
    gap: 2,
    padding: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.md,
  },
  pickerItem: { width: 54, alignItems: 'center', paddingTop: 5, paddingBottom: 4, borderRadius: 22 },
  pickerEmoji: { fontSize: 24, lineHeight: 30 },
  pickerLabel: { fontSize: 10, fontWeight: '700', color: colors.muted, marginTop: 1 },

  // Composer
  composer: {
    marginHorizontal: 12,
    marginBottom: 12,
    padding: 12,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  composerTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  composerInput: {
    flex: 1,
    height: 42,
    borderRadius: radius.pill,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    paddingHorizontal: 15,
  },
  composerPlaceholder: { fontSize: 14.5, color: colors.muted },
  composerActions: { flexDirection: 'row', marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.rule },
  composerAction: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 36, borderRadius: radius.pill },
  composerActionIcon: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  composerActionText: { fontSize: 13, fontWeight: '700', color: colors.fg },

  // Reels strip
  reelsCard: {
    marginHorizontal: 12,
    marginBottom: 12,
    paddingTop: 12,
    paddingBottom: 12,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  reelsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, marginBottom: 10 },
  reelsTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reelsIcon: { width: 22, height: 22, borderRadius: 7, backgroundColor: colors.rose, alignItems: 'center', justifyContent: 'center', paddingLeft: 1 },
  reelsTitle: { fontFamily: fonts.serifBold, fontSize: 18, lineHeight: 23, color: colors.fg, letterSpacing: -0.3 },
  reelsSeeAll: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 4 },
  reelsSeeAllText: { fontSize: 13, fontWeight: '700', color: colors.primary },
  reelsRow: { gap: 8, paddingHorizontal: 12 },
  tile: { width: TILE_W, height: TILE_H, borderRadius: 14, overflow: 'hidden', position: 'relative', justifyContent: 'center' },
  tileCaption: { fontFamily: fonts.serifItalic, fontSize: 12.5, lineHeight: 17, color: 'rgba(244,239,230,0.75)', paddingHorizontal: 10, textAlign: 'center' },
  tileScrim: { ...StyleSheet.absoluteFillObject },
  tileAvatar: { position: 'absolute', top: 8, left: 8, borderRadius: 18, borderWidth: 2.5, borderColor: colors.primary, padding: 0 },
  tileFoot: { position: 'absolute', left: 8, right: 8, bottom: 8 },
  tileName: { fontSize: 12, lineHeight: 15, fontWeight: '700', color: WHITE, textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  tileViews: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  tileViewsText: { fontSize: 10.5, fontWeight: '700', color: 'rgba(255,255,255,0.88)' },
  createTile: { width: TILE_W, height: TILE_H, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  createTop: { width: '100%', height: TILE_H * 0.6, backgroundColor: colors.cardIndigo, alignItems: 'center', justifyContent: 'center' },
  createPlus: {
    marginTop: -16,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    borderWidth: 3,
    borderColor: colors.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createText: { fontSize: 12, lineHeight: 15, fontWeight: '700', color: colors.fg, textAlign: 'center', marginTop: 6 },

  // Hub cards
  hubRow: { flexDirection: 'row', gap: 8, marginHorizontal: 12, marginBottom: 12 },
  hubCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 10,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  hubIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  hubIconText: { fontFamily: fonts.serifBold, fontSize: 13, color: colors.goldLight },
  hubLiveRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1 },
  hubTitle: { fontSize: 12.5, fontWeight: '700', color: colors.fg },
  hubSub: { fontSize: 11, color: colors.muted, marginTop: 1 },
  hubBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: colors.rose,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hubBadgeText: { fontSize: 10, lineHeight: 12, fontWeight: '800', color: WHITE },

  // Menu sheet
  menuOverlay: { flex: 1, backgroundColor: 'transparent', justifyContent: 'flex-end' },
  menuSheet: {
    backgroundColor: colors.screen,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 26,
    ...shadow.lg,
  },
  grabber: { alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: 12 },
  menuHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12, paddingHorizontal: 2 },
  menuEyebrow: { ...eyebrow, color: colors.gold },
  menuTitle: { fontFamily: fonts.serifBold, fontSize: 19, lineHeight: 24, color: colors.fg, letterSpacing: -0.3 },
  menuClose: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  menuCard: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', ...shadow.sm },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
  menuIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  menuLabel: { fontSize: 14.5, fontWeight: '700' },
  menuSub: { fontSize: 12, color: colors.muted, marginTop: 1 },
  menuDivider: { height: 1, backgroundColor: colors.rule, marginLeft: 60 },
});
