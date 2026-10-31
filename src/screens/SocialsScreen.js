import React, { useState, useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  Image,
} from 'react-native';
import Svg, { Path, Circle, Rect, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Icon } from '../components/Icons';
import { colors, fonts, radius, shadow } from '../theme';
import { useStore } from '../store';
import { useNav, useIsFocused } from '../navigation';
import { GIFTS } from '../data/seed';
import { Button, Tag, Badge, alpha } from '../components/ui';
import { useToast, haptic } from '../components/Toast';
import { useNarration } from '../audio/Narration';
import { BOOKS, refLabel } from '../data/bible';
import {
  PressScale,
  FadeInUp,
  ScaleIn,
  Pop,
  Burst,
  Pulse,
  LiveRing,
  AnimatedNumber,
  AnimatedModal,
  EASE_OUT,
  EASE_IN,
} from '../components/Motion';

const ND = Platform.OS !== 'web'; // native driver where supported

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// "Matthew 1:5", "Psalm 23", "1 John 4:8", "Song of Solomon 2:4" → { bookId, chapter, verse }
const normBook = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function parseScriptureRef(ref) {
  const m = String(ref || '').trim().match(/^(.+?)\s*(\d+)(?:\s*[:.]\s*(\d+))?/);
  if (!m) return null;
  const n = normBook(m[1]);
  if (!n) return null;
  const book =
    BOOKS.find((b) => normBook(b.name) === n || normBook(b.slug) === n || b.id.toLowerCase() === n) ||
    BOOKS.find((b) => normBook(b.name).startsWith(n) || n.startsWith(normBook(b.name)));
  if (!book) return null;
  const chapter = Math.min(Math.max(parseInt(m[2], 10) || 1, 1), book.chapters || 1);
  const verse = m[3] ? parseInt(m[3], 10) : null;
  return verse ? { bookId: book.id, chapter, verse } : { bookId: book.id, chapter };
}

function formatCount(n) {
  const v = Number(n) || 0;
  if (v >= 1000000) return `${(v / 1000000).toFixed(v >= 10000000 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (v >= 10000) return `${(v / 1000).toFixed(v >= 100000 ? 0 : 1).replace(/\.0$/, '')}K`;
  // Exact below 10K so a like/share visibly changes the number
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Creators Corner bounty campaigns (filterable by category chip)
const CORNER_CATEGORIES = ['All', 'Ministry Media', 'Sermon Clips', 'Evangelism', 'Freelance'];
const CAMPAIGNS = [
  {
    id: 'cc1',
    title: 'Creators Corner',
    tagline: 'Unlock Your Creative Potential',
    desc: 'Produce top-tier viral Christian reels, sermon shorts, and gospel media. High escrow rewards for verified editors.',
    price: '$875.00',
    rating: '4.96 (24)',
    image: 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?auto=format&fit=crop&w=600&q=80',
    tags: ['Ministry Media', 'Sermon Clips', 'Freelance'],
    submission: 'Creators Corner Submission',
    category: 'Sermons',
  },
  {
    id: 'cc2',
    title: 'Global Campaign Lead',
    tagline: 'Direct Multi-Channel Evangelism',
    desc: 'Lead video creators and distribute faith content to reach 1M+ views across YouTube, Instagram, and TikTok.',
    price: '$1,297.00',
    rating: '5.0 (38)',
    image: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=600&q=80',
    tags: ['Ministry Media', 'Evangelism'],
    submission: 'Global Campaign Submission',
    category: 'Evangelism',
  },
];

// Clip Farm guild channels: id → seed messages
const GUILD_SEED = {
  '#ggv-support-chat': [
    { id: 'gs1', user: 'GGV Support', role: 'Moderator', time: '08:12 AM', text: 'Need help with payouts or escrow? Post your question here and a moderator will reply.' },
  ],
  '#announcements': [
    { id: 'ga1', user: 'Shepherds Benjamin', role: 'Guild Founder', time: 'Yesterday', text: 'New this week: the Global Campaign Lead bounty ($1,297) is open. Read the rules before submitting.' },
  ],
  '#discord-invite': [
    { id: 'gi1', user: 'Clip Farm Bot', role: 'Bot', time: 'Pinned', text: 'Invite friends with discord.gg/clipfarm — every creator who joins gets the starter template pack.' },
  ],
  '#faq': [
    { id: 'gf1', user: 'Clip Farm Bot', role: 'Bot', time: 'Pinned', text: 'Q: How are rewards paid? A: Funds sit in escrow and release once the campaign owner approves your clip.' },
  ],
  '#campaign-announcements': [
    { id: 'gc1', user: 'Shepherds Benjamin', role: 'Guild Founder', time: 'Mon', text: 'Sermon Clips campaign: 30–60s vertical edits, captions burned in, scripture reference on screen.' },
  ],
  '#global-rules': [
    { id: 'gr1', user: 'Clip Farm Bot', role: 'Bot', time: 'Pinned', text: 'Be kind, credit original speakers, no reuploads of copyrighted worship tracks.' },
  ],
  '#content-rewards': [
    { id: 'm1', user: 'Shepherds Benjamin', role: 'Guild Founder', time: '09:28 AM', text: 'Welcome creators to Clip Farm! Check out the active $875 and $1,297 content reward campaigns below.' },
    { id: 'm2', user: 'Grace Adeyemi', role: 'Video Editor', time: '09:34 AM', text: 'Just finished editing 4 sermon reels for the Sunday broadcast! Ready to upload.' },
    { id: 'm3', user: 'Caleb Motion', role: 'VFX / Motion', time: '09:41 AM', text: 'Amen! The new 4K lower-thirds and kinetic typography templates are now available for all editors.' },
  ],
};
const GUILD_INVITE = 'https://discord.gg/clipfarm';

// Immersive feed backdrops (night family — only visible behind text posts / while video loads)
const VIDEO_THEMES = [colors.night, colors.nightRaised, colors.primaryInk];

// Dark card themes offered for text posts (white serif text sits on these)
const CONTENT_THEMES = [colors.night, colors.primaryInk, colors.teal, colors.lavender];

const WHITE = '#FFFFFF';
const GLASS = 'rgba(0,0,0,0.38)';
const GLASS_BORDER = 'rgba(255,255,255,0.16)';
const ON_DARK_MUTED = 'rgba(255,255,255,0.72)';
const TEXT_SHADOW = {
  textShadowColor: 'rgba(0,0,0,0.6)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 3,
};

const SAMPLE_VIDEOS = [
  { id: 'sv1', title: 'Sanctuary Worship & Altar', url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', duration: '0:45' },
  { id: 'sv2', title: 'Acoustic Praise Session', url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/friday.mp4', duration: '0:38' },
];

const SAMPLE_IMAGES = [
  { id: 'si1', title: 'Believers In Prayer', url: 'https://images.unsplash.com/photo-1609234656388-0ff363383899?auto=format&fit=crop&w=600&q=80' },
  { id: 'si2', title: 'Open Scripture Meditation', url: 'https://images.unsplash.com/photo-1504052434569-70ad5836ab65?auto=format&fit=crop&w=600&q=80' },
  { id: 'si3', title: 'Altar Candle of Faith', url: 'https://images.unsplash.com/photo-1603006905003-be475563bc59?auto=format&fit=crop&w=600&q=80' },
];

// Small local glyphs not covered by the shared icon set
function CloseGlyph({ color = colors.muted, size = 12 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 6l12 12M18 6L6 18" stroke={color} strokeWidth={2.6} strokeLinecap="round" />
    </Svg>
  );
}

function BackGlyph({ color = WHITE, size = 14 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M15 18l-6-6 6-6" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function PlusGlyph({ color = WHITE, size = 12 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 5v14M5 12h14" stroke={color} strokeWidth={2.8} strokeLinecap="round" />
    </Svg>
  );
}

function PauseGlyph({ color = WHITE, size = 30 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="6.5" y="5" width="3.6" height="14" rx="1.2" fill={color} />
      <Rect x="13.9" y="5" width="3.6" height="14" rx="1.2" fill={color} />
    </Svg>
  );
}

// ─── Local motion pieces ──────────────────────────────────────

// Big heart that pops where the reel was double-tapped, then floats up and fades.
function FloatingHeart({ x, y, tilt, onDone }) {
  const pop = useRef(new Animated.Value(0)).current;
  const out = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.timing(pop, { toValue: 1, duration: 280, easing: Easing.out(Easing.back(2.2)), useNativeDriver: ND }),
      Animated.delay(170),
      Animated.timing(out, { toValue: 1, duration: 380, easing: EASE_IN, useNativeDriver: ND }),
    ]).start(() => onDone && onDone());
  }, []);
  const SIZE = 104;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: x - SIZE / 2,
        top: y - SIZE / 2,
        width: SIZE,
        height: SIZE,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 25,
        opacity: Animated.multiply(
          pop.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' }),
          out.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
        ),
        transform: [
          { translateY: out.interpolate({ inputRange: [0, 1], outputRange: [0, -90] }) },
          { rotate: `${tilt}deg` },
          { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) },
          { scale: out.interpolate({ inputRange: [0, 1], outputRange: [1, 1.3] }) },
        ],
      }}
    >
      <View style={Platform.OS === 'ios' ? styles.floatingHeartShadow : null}>
        <Icon name="heart" size={88} color={colors.rose} fill={colors.rose} strokeWidth={1.2} />
      </View>
    </Animated.View>
  );
}

// Centre badge after a single tap: springs in, holds, fades out.
function TapBadge({ playing, onDone }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.spring(a, { toValue: 1, useNativeDriver: ND, speed: 24, bounciness: 8 }),
      Animated.delay(380),
      Animated.timing(a, { toValue: 2, duration: 260, easing: EASE_IN, useNativeDriver: ND }),
    ]).start(() => onDone && onDone());
  }, []);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.centerPlayBadge,
        {
          opacity: a.interpolate({ inputRange: [0, 0.3, 1, 2], outputRange: [0, 1, 1, 0] }),
          transform: [{ scale: a.interpolate({ inputRange: [0, 1, 2], outputRange: [0.6, 1, 1.15] }) }],
        },
      ]}
    >
      {playing ? <Icon name="play" size={30} color={WHITE} /> : <PauseGlyph />}
    </Animated.View>
  );
}

// Record-style disc that turns while the active reel plays; it eases to a stop and resumes from the same angle.
function SpinningDisc({ spinning, children, style }) {
  const rot = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!spinning) {
      rot.stopAnimation();
      return undefined;
    }
    let stopped = false;
    const PERIOD = 5200;
    const run = () => {
      rot.stopAnimation((v) => {
        const from = (v || 0) % 1;
        rot.setValue(from);
        Animated.timing(rot, { toValue: 1, duration: Math.max(60, (1 - from) * PERIOD), easing: Easing.linear, useNativeDriver: ND })
          .start(({ finished }) => {
            if (finished && !stopped) {
              rot.setValue(0);
              run();
            }
          });
      });
    };
    run();
    return () => {
      stopped = true;
      rot.stopAnimation();
    };
  }, [spinning]);
  return (
    <Animated.View style={[style, { transform: [{ rotate: rot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }]}>
      {children}
    </Animated.View>
  );
}

// Chevron that rotates when a guild category collapses/expands
function TurnChevron({ collapsed }) {
  const a = useRef(new Animated.Value(collapsed ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: collapsed ? 1 : 0, duration: 200, easing: EASE_OUT, useNativeDriver: ND }).start();
  }, [collapsed]);
  return (
    <Animated.View style={{ transform: [{ rotate: a.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-90deg'] }) }] }}>
      <Icon name="chevron-down" size={10} color={colors.nightMuted} strokeWidth={2.6} />
    </Animated.View>
  );
}

const countFormat = (n) => formatCount(Math.round(n));

// Parchment bottom-sheet header: grabber, gold eyebrow, serif title, round close
function SheetHead({ eyebrow, title, subtitle, onClose, right }) {
  return (
    <View>
      <View style={styles.grabber} />
      <View style={styles.sheetHeader}>
        <View style={{ flex: 1, minWidth: 0 }}>
          {eyebrow ? <Text style={styles.sheetEyebrow}>{eyebrow}</Text> : null}
          <Text style={styles.sheetTitle} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={styles.sheetSubtitle}>{subtitle}</Text> : null}
        </View>
        {right || null}
        {onClose ? (
          <PressScale onPress={onClose} hitSlop={12} scaleTo={0.88} style={styles.sheetCloseBtn} accessibilityLabel="Close">
            <CloseGlyph />
          </PressScale>
        ) : null}
      </View>
    </View>
  );
}

function UploadVideoPreview({ videoUrl }) {
  const previewPlayer = useVideoPlayer(videoUrl || null, (p) => {
    p.loop = true;
    p.play();
    p.muted = true;
  });

  return (
    <View style={styles.modalPreviewBox}>
      {videoUrl ? (
        <VideoView
          style={StyleSheet.absoluteFill}
          player={previewPlayer}
          allowsFullscreen={false}
          allowsPictureInPicture={false}
          nativeControls={false}
          contentFit="cover"
        />
      ) : (
        <View style={styles.modalPreviewPlaceholder}>
          <Icon name="video" size={30} color={colors.goldLight} />
          <Text style={styles.modalPreviewPlaceholderText}>Select a video to preview</Text>
        </View>
      )}
      <View style={styles.modalPreviewScrim} pointerEvents="none" />
      <View style={styles.modalPreviewBadge}>
        <Pulse min={0.7} max={1.25} duration={800}>
          <View style={styles.modalPreviewDot} />
        </Pulse>
        <Text style={styles.modalPreviewBadgeText}>LIVE VIDEO PREVIEW</Text>
      </View>
    </View>
  );
}

const PUBLISH_MODES = [
  { id: 'upload_videos', label: 'Upload Videos', icon: 'video' },
  { id: 'post_video', label: 'Post a Video', icon: 'play' },
  { id: 'upload_images', label: 'Upload Images', icon: 'sparkles' },
  { id: 'post_content', label: 'Post a Content', icon: 'highlight' },
];

const GIFT_ICONS = {
  g_rose: { name: 'sun', color: colors.rose },
  g_bouquet: { name: 'sparkles', color: colors.primary },
  g_star: { name: 'star', color: colors.gold },
  g_crown: { name: 'cross', color: colors.lavender },
};

function VideoReelItem({
  item,
  index,
  itemHeight,
  isActive,
  isLiked,
  isFollowing,
  onLike,
  onComment,
  onGift,
  onShare,
  onRepost,
  onFollow,
  onOpenBible,
  onListen,
}) {
  const isTextPost = !item.videoUrl && !item.imageUrl && item.duration === 'Text Post';
  const cardBg = isTextPost && item.bg ? item.bg : VIDEO_THEMES[index % VIDEO_THEMES.length];
  const [isPlaying, setIsPlaying] = useState(true);
  const [tapBadge, setTapBadge] = useState(null); // { key, playing }
  const [hearts, setHearts] = useState([]); // floating double-tap hearts
  const cardRef = useRef(null);
  const lastTap = useRef(0);
  const tapTimer = useRef(null);
  const h = itemHeight || (SCREEN_HEIGHT - 105);

  // Creator info + caption ease in whenever this reel becomes the active one
  const infoIn = useRef(new Animated.Value(isActive ? 0 : 0)).current;
  useEffect(() => {
    if (isActive) {
      Animated.timing(infoIn, { toValue: 1, duration: 420, delay: 80, easing: EASE_OUT, useNativeDriver: ND }).start();
    } else {
      Animated.timing(infoIn, { toValue: 0, duration: 180, easing: EASE_IN, useNativeDriver: ND }).start();
    }
  }, [isActive]);

  useEffect(() => () => clearTimeout(tapTimer.current), []);

  const player = useVideoPlayer(item.videoUrl || null, (p) => {
    p.loop = true;
    if (isActive) {
      p.play();
    }
  });

  useEffect(() => {
    if (!player) return;
    try {
      if (isActive) {
        player.play();
        setIsPlaying(true);
      } else {
        player.pause();
        setIsPlaying(false);
      }
    } catch (e) {}
  }, [isActive, player]);

  const togglePlayback = () => {
    if (!player || !item.videoUrl) return;
    try {
      if (player.playing) {
        player.pause();
        setIsPlaying(false);
        setTapBadge({ key: Date.now(), playing: false });
      } else {
        player.play();
        setIsPlaying(true);
        setTapBadge({ key: Date.now(), playing: true });
      }
    } catch (e) {}
  };

  const spawnHeart = (x, y) => {
    const id = `${Date.now()}_${Math.random()}`;
    const tilt = Math.round(Math.random() * 30 - 15);
    setHearts((list) => [...list.slice(-3), { id, x, y, tilt }]);
  };

  // TikTok-style: double-tap anywhere likes (never un-likes) with a big heart; single tap toggles playback.
  const onCardPress = (e) => {
    const now = Date.now();
    const ne = (e && e.nativeEvent) || {};
    if (now - lastTap.current < 300) {
      clearTimeout(tapTimer.current);
      lastTap.current = 0;
      const fallback = () => spawnHeart(SCREEN_WIDTH / 2, h * 0.42);
      if (typeof ne.pageX === 'number' && cardRef.current && cardRef.current.measureInWindow) {
        try {
          cardRef.current.measureInWindow((cx, cy, cw, ch) => {
            const x = ne.pageX - (cx || 0);
            const y = ne.pageY - (cy || 0);
            if (Number.isFinite(x) && Number.isFinite(y) && y > 0 && y < (ch || h)) {
              spawnHeart(Math.min(Math.max(x, 60), SCREEN_WIDTH - 60), Math.min(Math.max(y, 80), (ch || h) - 80));
            } else fallback();
          });
        } catch (err) { fallback(); }
      } else fallback();
      if (!isLiked) onLike();
      else haptic('light');
      return;
    }
    lastTap.current = now;
    clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(togglePlayback, 300);
  };

  return (
    <Pressable
      ref={cardRef}
      onPress={onCardPress}
      style={[
        styles.videoCard,
        { backgroundColor: cardBg, height: h }
      ]}
    >
      {/* Video Player */}
      {item.videoUrl ? (
        <VideoView
          style={StyleSheet.absoluteFill}
          player={player}
          allowsFullscreen={false}
          allowsPictureInPicture={false}
          nativeControls={false}
          contentFit="cover"
        />
      ) : item.imageUrl ? (
        <Image source={{ uri: item.imageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : isTextPost ? (
        <View style={styles.textPostWrap}>
          <Text style={styles.textPostQuote}>“</Text>
          <Text style={styles.textPostBody} numberOfLines={9}>{item.caption}</Text>
          {item.scripture ? <Text style={styles.textPostRef}>— {item.scripture}</Text> : null}
        </View>
      ) : (
        <View style={styles.videoPlayerGraphic}>
          <View style={styles.ambientIconRing}>
            <Icon name="video" size={28} color={colors.goldLight} />
          </View>
          <Text style={styles.ambientCategoryBadge}>{String(item.category || '').toUpperCase()}</Text>
          <Text style={styles.ambientDurationText}>{item.duration}</Text>
        </View>
      )}

      {/* Top Gradient for header clarity */}
      <View style={styles.topGradientScrim} pointerEvents="none">
        <Svg width="100%" height={130} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id={`topGrad_${index}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#000000" stopOpacity="0.6" />
              <Stop offset="60%" stopColor="#000000" stopOpacity="0.2" />
              <Stop offset="100%" stopColor="#000000" stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#topGrad_${index})`} />
        </Svg>
      </View>

      {/* Deep Bottom Gradient for crystal-clear readability */}
      <View style={styles.bottomGradientScrim} pointerEvents="none">
        <Svg width="100%" height={380} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id={`bottomGrad_${index}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#000000" stopOpacity="0" />
              <Stop offset="40%" stopColor="#000000" stopOpacity="0.3" />
              <Stop offset="78%" stopColor="#000000" stopOpacity="0.72" />
              <Stop offset="100%" stopColor="#000000" stopOpacity="0.9" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#bottomGrad_${index})`} />
        </Svg>
      </View>

      {/* Tap feedback (play / pause) */}
      {tapBadge ? (
        <TapBadge key={tapBadge.key} playing={tapBadge.playing} onDone={() => setTapBadge(null)} />
      ) : null}

      {/* Double-tap hearts */}
      {hearts.map((ht) => (
        <FloatingHeart
          key={ht.id}
          x={ht.x}
          y={ht.y}
          tilt={ht.tilt}
          onDone={() => setHearts((list) => list.filter((x) => x.id !== ht.id))}
        />
      ))}

      {/* Bottom Information Overlay (Creator & Caption) - PINNED TO BOTTOM */}
      <Animated.View
        style={[
          styles.bottomInfo,
          {
            opacity: infoIn.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
            transform: [{ translateY: infoIn.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
          },
        ]}
        pointerEvents="box-none"
      >
        {/* Category eyebrow */}
        <View style={styles.categoryBadgePill}>
          <Text style={styles.categoryBadgeText}>{String(item.category || 'Post').toUpperCase()}</Text>
        </View>

        {/* Creator Row */}
        <View style={styles.creatorRow}>
          <View style={styles.creatorAvatar}>
            <Text style={styles.creatorAvatarText}>{item.creator?.avatar}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Text style={styles.creatorName} numberOfLines={1}>{item.creator.name}</Text>
              {item.creator.verified ? (
                <View style={styles.verifiedDot}>
                  <Icon name="check" size={8} color={colors.night} strokeWidth={3.4} />
                </View>
              ) : null}
            </View>
            <Text style={styles.creatorHandle} numberOfLines={1}>
              {item.creator.handle} · {item.creator.church}
            </Text>
          </View>

          {item.mine ? null : (
            <Pop trigger={isFollowing} amount={1.12}>
              <PressScale
                onPress={onFollow}
                scaleTo={0.92}
                style={[styles.followBtn, isFollowing && styles.followBtnActive]}
                accessibilityLabel={isFollowing ? `Unfollow ${item.creator.name}` : `Follow ${item.creator.name}`}
              >
                {isFollowing ? <Icon name="check" size={11} color={WHITE} strokeWidth={3} /> : <PlusGlyph color={colors.night} size={10} />}
                <Text style={[styles.followBtnText, isFollowing && styles.followBtnTextActive]}>
                  {isFollowing ? 'Following' : 'Follow'}
                </Text>
              </PressScale>
            </Pop>
          )}
        </View>

        {/* Caption (text posts already show it full-size above) */}
        {!isTextPost ? (
          <Text style={styles.captionText} numberOfLines={3}>
            {item.caption}
          </Text>
        ) : null}

        {/* Scripture Context Pill */}
        {item.scripture ? (
          <PressScale onPress={onOpenBible} scaleTo={0.96} style={styles.scripturePill} accessibilityLabel={`Read ${item.scripture} in context`}>
            <Icon name="book" size={13} color={colors.goldLight} />
            <Text style={styles.scriptureText}>{item.scripture}</Text>
            <View style={styles.scriptureSep} />
            <Text style={styles.scriptureCta}>Read context</Text>
            <Icon name="chevron-right" size={11} color={ON_DARK_MUTED} strokeWidth={2.6} />
          </PressScale>
        ) : null}

        {/* Hashtags */}
        {item.hashtags?.length ? (
          <View style={styles.hashtagRow}>
            {item.hashtags.map((tag, idx) => (
              <Text key={idx} style={styles.hashtagText}>{tag}</Text>
            ))}
          </View>
        ) : null}

        {/* Audio Track Ticker */}
        <View style={styles.soundRow}>
          <Icon name="audio" size={12} color={ON_DARK_MUTED} />
          <Text style={styles.soundText} numberOfLines={1}>{item.sound}</Text>
        </View>
      </Animated.View>

      {/* Right Side Vertical Interaction Rail - PINNED TO BOTTOM RIGHT */}
      <View style={styles.rightRail} pointerEvents="box-none">
        {/* Like Button */}
        <PressScale onPress={onLike} scaleTo={0.88} style={styles.railAction} accessibilityLabel={isLiked ? 'Unlike' : 'Like'}>
          <Pop trigger={isLiked} amount={1.32}>
            <View style={[styles.railIconCircle, isLiked && styles.railIconCircleLiked]}>
              <Icon name="heart" size={22} color={isLiked ? colors.rose : WHITE} fill={isLiked ? colors.rose : 'none'} />
            </View>
          </Pop>
          <AnimatedNumber value={Number(item.likes) || 0} format={countFormat} duration={420} style={styles.railCount} />
        </PressScale>

        {/* Comment Button */}
        <PressScale onPress={onComment} scaleTo={0.88} style={styles.railAction} accessibilityLabel="Comments">
          <Pop trigger={item.comments?.length || 0} amount={1.18}>
            <View style={styles.railIconCircle}>
              <Icon name="chat" size={20} color={WHITE} />
            </View>
          </Pop>
          <AnimatedNumber value={item.comments?.length || 0} format={countFormat} duration={420} style={styles.railCount} />
        </PressScale>

        {/* Virtual Gifting Button */}
        <PressScale onPress={onGift} scaleTo={0.88} style={styles.railAction} accessibilityLabel="Send a gift">
          <View style={styles.railBurstWrap}>
            <Pop trigger={item.gifts} amount={1.3}>
              <View style={[styles.railIconCircle, styles.railIconCircleGift]}>
                <Icon name="gift" size={20} color={colors.goldLight} />
              </View>
            </Pop>
            <Burst trigger={item.gifts} radius={40} count={10} />
          </View>
          <AnimatedNumber value={Number(item.gifts) || 0} format={countFormat} duration={520} style={[styles.railCount, { color: colors.goldLight }]} />
        </PressScale>

        {/* Share Button */}
        <PressScale onPress={onShare} scaleTo={0.88} style={styles.railAction} accessibilityLabel="Share">
          <Pop trigger={item.shares} amount={1.2}>
            <View style={styles.railIconCircle}>
              <Icon name="share" size={19} color={WHITE} />
            </View>
          </Pop>
          <AnimatedNumber value={Number(item.shares) || 0} format={countFormat} duration={420} style={styles.railCount} />
        </PressScale>

        {/* Repost Button */}
        <PressScale onPress={onRepost} scaleTo={0.88} style={styles.railAction} accessibilityLabel={item.reposted ? 'Undo repost' : 'Repost'}>
          <Pop trigger={!!item.reposted} amount={1.25}>
            <View style={[styles.railIconCircle, item.reposted && styles.railIconCircleReposted]}>
              <Icon name="repost" size={19} color={item.reposted ? colors.goldLight : WHITE} />
            </View>
          </Pop>
          <AnimatedNumber
            value={Number(item.reposts) || 0}
            format={countFormat}
            duration={420}
            style={[styles.railCount, item.reposted && { color: colors.goldLight }]}
          />
        </PressScale>

        {/* Disc: listen to the post's scripture read aloud — turns while this reel plays */}
        {item.scripture ? (
          <PressScale onPress={onListen} scaleTo={0.9} style={styles.musicDiscPress} accessibilityLabel="Listen to scripture">
            <SpinningDisc spinning={isActive && isPlaying} style={styles.musicDiscBox}>
              <View style={styles.musicDiscGroove} />
              <View style={styles.musicDiscSheen} />
            </SpinningDisc>
            <View style={styles.musicDiscInner} pointerEvents="none">
              <Icon name="audio" size={12} color={WHITE} />
            </View>
          </PressScale>
        ) : null}
      </View>
    </Pressable>
  );
}

export default function SocialsScreen({ params = {} }) {
  const { state, dispatch } = useStore();
  const nav = useNav();
  const toast = useToast();
  const nar = useNarration();
  const focused = useIsFocused(); // false while another screen is on top — pauses video
  const [mainTab, setMainTab] = useState('reels'); // 'reels' | 'guild' | 'creators'
  const [activeTab, setActiveTab] = useState('Recommended'); // 'Following' | 'Recommended'
  const [containerHeight, setContainerHeight] = useState(SCREEN_HEIGHT - 105);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [showComments, setShowComments] = useState(false);
  const [showGiftStore, setShowGiftStore] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [giftNotice, setGiftNotice] = useState(null); // inline feedback inside the gift sheet
  const [commentText, setCommentText] = useState('');
  const [replyingTo, setReplyingTo] = useState(null);
  const [cornerCat, setCornerCat] = useState('All');
  const [bounty, setBounty] = useState(null); // campaign the next submission is for

  const flatListRef = useRef(null);

  // Sliding underline under Following | For You
  const [tabLayouts, setTabLayouts] = useState({});
  const underlineX = useRef(new Animated.Value(0)).current;
  const underlinePlaced = useRef(false);
  const UNDERLINE_W = 18;
  const onFeedTabLayout = (key, e) => {
    const { x, width } = e.nativeEvent.layout;
    setTabLayouts((l) => (l[key] && l[key].x === x && l[key].width === width ? l : { ...l, [key]: { x, width } }));
  };
  useEffect(() => {
    const l = tabLayouts[activeTab];
    if (!l) return;
    const to = l.x + l.width / 2 - UNDERLINE_W / 2;
    if (!underlinePlaced.current) {
      underlinePlaced.current = true;
      underlineX.setValue(to);
      return;
    }
    Animated.spring(underlineX, { toValue: to, useNativeDriver: ND, speed: 18, bounciness: 7 }).start();
  }, [activeTab, tabLayouts]);

  // Brief celebratory card after publishing
  const [published, setPublished] = useState(null); // { key, label }
  useEffect(() => {
    if (!published) return undefined;
    const t = setTimeout(() => setPublished(null), 2000);
    return () => clearTimeout(t);
  }, [published]);

  // Opened from Profile → Creator with a specific video: jump to it once.
  useEffect(() => {
    if (!params.initialVideoId) return;
    const idx = (state.videos || []).findIndex((v) => v.id === params.initialVideoId);
    if (idx > 0) {
      setActiveIndex(idx);
      setTimeout(() => { try { flatListRef.current && flatListRef.current.scrollToIndex({ index: idx, animated: false }); } catch (e) {} }, 50);
    }
  }, [params.initialVideoId]);

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 60,
  });

  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    if (viewableItems && viewableItems.length > 0) {
      const active = viewableItems[0];
      if (active && active.index !== undefined && active.index !== null) {
        setActiveIndex(active.index);
        if (active.item) setSelectedId(active.item.id);
      }
    }
  });

  // Multi-Media Publishing State
  const [publishMode, setPublishMode] = useState('upload_videos'); // 'upload_videos' | 'post_video' | 'upload_images' | 'post_content'
  const [newTitle, setNewTitle] = useState('');
  const [newScripture, setNewScripture] = useState('');
  const [newCategory, setNewCategory] = useState('Worship');
  const [newHashtags, setNewHashtags] = useState('#Faith #Grace #Jesus');
  const [selectedMediaUrl, setSelectedMediaUrl] = useState(SAMPLE_VIDEOS[0].url);
  const [selectedImageUrl, setSelectedImageUrl] = useState(SAMPLE_IMAGES[0].url);
  const [textContent, setTextContent] = useState('');
  const [contentTheme, setContentTheme] = useState(CONTENT_THEMES[0]);

  const closeGifts = () => { setShowGiftStore(false); setGiftNotice(null); };
  const closePublish = () => { setShowPublishModal(false); setBounty(null); };

  // Publish sheet: sliding highlight behind the active mode tab
  const [modeRowW, setModeRowW] = useState(0);
  const MODE_PAD = 4;
  const modeTabW = modeRowW > 0 ? (modeRowW - MODE_PAD * 2 - MODE_PAD * (PUBLISH_MODES.length - 1)) / PUBLISH_MODES.length : 0;
  const modeX = useRef(new Animated.Value(0)).current;
  const modePlaced = useRef(false);
  useEffect(() => {
    if (!modeTabW) return;
    const i = Math.max(0, PUBLISH_MODES.findIndex((m) => m.id === publishMode));
    const to = MODE_PAD + i * (modeTabW + MODE_PAD);
    if (!modePlaced.current || !showPublishModal) {
      modePlaced.current = true;
      modeX.setValue(to);
      return;
    }
    Animated.spring(modeX, { toValue: to, useNativeDriver: ND, speed: 20, bounciness: 5 }).start();
  }, [publishMode, modeTabW, showPublishModal]);

  // Clip Farm guild — messages per channel persist in the store
  const [guildChannel, setGuildChannel] = useState('#content-rewards');
  const [guildInput, setGuildInput] = useState('');
  const [collapsed, setCollapsed] = useState({});
  const guildStore = state.guildMessages || {};
  const guildMessages = guildStore[guildChannel] || GUILD_SEED[guildChannel] || [];
  const guildSeen = state.guildSeen || [];
  const guildUnread = guildSeen.includes('#announcements') ? 0 : 1;

  const openChannel = (id) => {
    setGuildChannel(id);
    if (!guildSeen.includes(id)) dispatch({ type: 'set', patch: { guildSeen: [...guildSeen, id] } });
  };

  const handleSendGuildMessage = () => {
    if (!guildInput.trim()) return;
    const now = new Date();
    const newM = {
      id: 'm_' + Date.now(),
      user: state.user?.displayName || 'Believer Creator',
      role: 'Content Creator',
      time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text: guildInput.trim(),
    };
    dispatch({ type: 'set', patch: { guildMessages: { ...guildStore, [guildChannel]: [...guildMessages, newM] } } });
    setGuildInput('');
    haptic('light');
  };

  const shareText = async (message, okLabel = 'Shared') => {
    try {
      const res = await Share.share({ message });
      if (!res || res.action !== Share.dismissedAction) {
        toast.show(okLabel, { icon: 'share', haptic: 'success' });
        return true;
      }
      return false;
    } catch (e) {
      // Web without the Web Share API: fall back to copying the text
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(message);
          toast.show('Copied to clipboard', { icon: 'check' });
          return true;
        }
      } catch (err) { /* clipboard blocked */ }
      toast.show('Sharing isn’t available on this device', { tone: 'error' });
      return false;
    }
  };

  const videos = state.videos || [];
  const followedVideos = videos.filter((v) => state.follows?.includes(v.creator?.handle));
  const filteredVideos = activeTab === 'Following' ? followedVideos : videos;
  const activeVideo = videos.find((v) => v.id === selectedId) || filteredVideos[activeIndex] || videos[0];

  const patchVideo = (id, fn) => {
    dispatch({ type: 'set', patch: { videos: (state.videos || []).map((v) => (v.id === id ? { ...v, ...fn(v) } : v)) } });
  };

  const scrollToTop = () => {
    setActiveIndex(0);
    try { flatListRef.current?.scrollToOffset({ offset: 0, animated: false }); } catch (e) {}
  };

  const switchFeedTab = (tab) => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    setSelectedId(null);
    scrollToTop();
  };

  const openScripture = (item) => {
    const ref = parseScriptureRef(item?.scripture);
    if (!ref) {
      toast.show(`Couldn’t find “${item?.scripture || 'that passage'}”`, { tone: 'error' });
      return;
    }
    nav.push('Bible', ref);
  };

  const listenScripture = (item) => {
    const ref = parseScriptureRef(item?.scripture);
    if (!ref) {
      toast.show('No scripture to read aloud', { tone: 'error' });
      return;
    }
    if (ref.verse) nar.playVerse(ref.bookId, ref.chapter, ref.verse, { translation: state.translation });
    else nar.playChapter(ref.bookId, ref.chapter, { translation: state.translation });
    toast.show(`Listening to ${refLabel(ref.bookId, ref.chapter, ref.verse)}`, { icon: 'audio', action: { label: 'Player', onPress: () => nar.openPlayer() } });
  };

  const handleFollow = (item) => {
    const handle = item.creator?.handle;
    if (!handle) return;
    const was = state.follows?.includes(handle);
    dispatch({ type: 'follow', id: handle });
    toast.show(was ? `Unfollowed ${item.creator.name}` : `Following ${item.creator.name}`, {
      icon: was ? 'user' : 'check',
      haptic: was ? 'light' : 'success',
    });
  };

  const handleShare = async (item) => {
    const ref = item.scripture ? ` (${item.scripture})` : '';
    const ok = await shareText(`${item.creator?.name} on BibleNestra: “${item.caption}”${ref}`);
    if (ok) patchVideo(item.id, (v) => ({ shares: (v.shares || 0) + 1 }));
  };

  const handleRepost = (item) => {
    const postId = 'rp_' + item.id;
    if (item.reposted) {
      dispatch({ type: 'deletePost', id: postId });
      patchVideo(item.id, (v) => ({ reposted: false, reposts: Math.max(0, (v.reposts || 0) - 1) }));
      toast.show('Repost removed', { icon: 'repost' });
      return;
    }
    const passage = parseScriptureRef(item.scripture);
    dispatch({
      type: 'post',
      post: {
        id: postId,
        kind: 'Repost',
        text: `Reposted from ${item.creator?.name}: “${item.caption}”`,
        ...(passage ? { passage } : {}),
      },
    });
    patchVideo(item.id, (v) => ({ reposted: true, reposts: (v.reposts || 0) + 1 }));
    toast.show('Reposted to your feed', { icon: 'repost', haptic: 'success', action: { label: 'View', onPress: () => nav.push('Feed') } });
  };

  const buyCoins = (amount = 250) => {
    dispatch({ type: 'buyCoins', amount });
    setGiftNotice({ tone: 'ok', text: `+${amount} coins added to your balance` });
    toast.show(`+${amount} coins added`, { icon: 'coin', haptic: 'success' });
  };

  const handleSendGift = (gift) => {
    if (!activeVideo) return;
    if ((state.coins || 0) < gift.price) {
      const need = gift.price - (state.coins || 0);
      setGiftNotice({ tone: 'error', text: `You need ${need} more coins for ${gift.name}.`, need });
      toast.show(`Not enough coins for ${gift.name}`, { tone: 'error', action: { label: 'Buy 250', onPress: () => buyCoins(250) } });
      return;
    }
    dispatch({
      type: 'sendGift',
      videoId: activeVideo.id,
      giftName: gift.name,
      recipient: activeVideo.creator.name,
      coins: gift.price,
    });
    setShowGiftStore(false);
    setGiftNotice(null);
    toast.show(`Sent ${gift.name} to ${activeVideo.creator.name}`, { icon: 'gift', haptic: 'success' });
  };

  const handleAddComment = () => {
    if (!commentText.trim() || !activeVideo) return;
    dispatch({
      type: 'commentVideo',
      id: activeVideo.id,
      text: commentText.trim(),
      replyTo: replyingTo ? replyingTo.id : null,
    });
    setCommentText('');
    setReplyingTo(null);
    haptic('success');
  };

  const me = () => ({
    name: state.user?.displayName || 'You',
    handle: state.user?.username ? `@${state.user.username}` : '@me',
    verified: true,
    avatar: (state.user?.displayName || 'You').slice(0, 2).toUpperCase(),
    church: state.user?.church?.name || 'Local Church',
  });

  const afterPublish = (newItem, message, viewAction) => {
    dispatch({ type: 'publishVideo', video: newItem });
    setShowPublishModal(false);
    setMainTab('reels');
    setActiveTab('Recommended');
    setSelectedId(newItem.id);
    setNewTitle('');
    setNewScripture('');
    setTextContent('');
    scrollToTop();
    const forBounty = bounty;
    setBounty(null);
    setPublished({
      key: Date.now(),
      title: forBounty ? 'Submitted' : 'Published',
      label: forBounty ? `Your reel is in for the ${forBounty.price} bounty` : 'Live on Socials for the community',
    });
    toast.show(forBounty ? `Submitted for the ${forBounty.price} bounty` : message, {
      icon: 'check',
      haptic: 'success',
      ...(viewAction ? { action: viewAction } : {}),
    });
  };

  const handlePublish = () => {
    if (publishMode === 'post_content') {
      if (!textContent.trim()) {
        toast.show('Write your message first', { tone: 'error' });
        return;
      }
      const scripture = newScripture.trim();
      const passage = parseScriptureRef(scripture);
      const newPost = {
        id: 'v' + Date.now(),
        creator: me(),
        caption: textContent.trim(),
        scripture: passage ? refLabel(passage.bookId, passage.chapter, passage.verse) : scripture,
        category: 'Devotional',
        hashtags: ['#Faith', '#Devotion'],
        duration: 'Text Post',
        sound: `Faith Word · ${me().name}`,
        videoUrl: null,
        bg: contentTheme,
        views: '1',
        likes: 0,
        liked: false,
        shares: 0,
        reposts: 0,
        gifts: 0,
        comments: [],
        mine: true,
      };
      // Text / verse posts also land in the community feed
      dispatch({ type: 'post', post: { kind: 'Reflection', text: textContent.trim(), ...(passage ? { passage } : {}) } });
      afterPublish(newPost, 'Faith post published', { label: 'View in feed', onPress: () => nav.push('Feed') });
      return;
    }

    if (!newTitle.trim()) {
      toast.show('Add a caption first', { tone: 'error' });
      return;
    }

    const isImage = publishMode === 'upload_images';
    const scripture = newScripture.trim();
    const passage = parseScriptureRef(scripture);
    const newVid = {
      id: 'v' + Date.now(),
      creator: me(),
      caption: newTitle.trim(),
      scripture: passage ? refLabel(passage.bookId, passage.chapter, passage.verse) : scripture,
      category: isImage ? 'Photo' : newCategory,
      hashtags: newHashtags.split(' ').filter(Boolean).map((h) => (h.startsWith('#') ? h : `#${h}`)),
      duration: isImage ? 'Photo' : (SAMPLE_VIDEOS.find((v) => v.url === selectedMediaUrl)?.duration || '0:45'),
      sound: `Original Audio · ${me().name}`,
      videoUrl: isImage ? null : selectedMediaUrl,
      imageUrl: isImage ? selectedImageUrl : null,
      bg: colors.night,
      views: '1',
      likes: 0,
      liked: false,
      shares: 0,
      reposts: 0,
      gifts: 0,
      comments: [],
      mine: true,
    };
    afterPublish(newVid, isImage ? 'Photo published to Socials' : 'Video published to Socials');
  };

  const visibleCampaigns = cornerCat === 'All' ? CAMPAIGNS : CAMPAIGNS.filter((c) => c.tags.includes(cornerCat));

  const renderChannel = (id, icon, label) => {
    const active = guildChannel === id;
    return (
      <PressScale
        key={id}
        onPress={() => openChannel(id)}
        scaleTo={0.97}
        style={[styles.channelItem, active && styles.channelItemActive]}
        accessibilityState={{ selected: active }}
      >
        {active ? <ScaleIn from={0.2} style={styles.channelActiveBar} /> : null}
        <Icon name={icon} size={15} color={active ? colors.goldLight : colors.nightMuted} />
        <Text style={[styles.channelName, active && styles.channelNameActive]} numberOfLines={1}>{label}</Text>
      </PressScale>
    );
  };

  const renderCategory = (title, unread) => (
    <Pressable
      onPress={() => setCollapsed((c) => ({ ...c, [title]: !c[title] }))}
      style={styles.categoryTitleRow}
      accessibilityLabel={`${collapsed[title] ? 'Expand' : 'Collapse'} ${title}`}
    >
      <Text style={styles.categoryTitle}>{title}</Text>
      <TurnChevron collapsed={!!collapsed[title]} />
      <View style={{ flex: 1 }} />
      {unread ? (
        <ScaleIn style={styles.unreadPill}>
          <Text style={styles.unreadPillText}>{unread}</Text>
        </ScaleIn>
      ) : null}
    </Pressable>
  );

  const GUILD_GROUPS = [
    { title: 'Support', channels: [['#ggv-support-chat', 'message', "ggv's support chat"]] },
    { title: 'Announcements', unread: guildUnread, channels: [['#announcements', 'volume', 'Announcements']] },
    { title: 'Home', channels: [['#discord-invite', 'community', 'discord.gg/clipfarm'], ['#faq', 'bookmark', 'FAQ & Rules']] },
    {
      title: 'Campaigns & Bounties',
      channels: [
        ['#campaign-announcements', 'signal', 'Campaign Announcements'],
        ['#global-rules', 'shield', 'Global Campaign Rules'],
        ['#content-rewards', 'coin', 'Content Rewards ($875 & $1,297)'],
      ],
    },
  ];

  return (
    <View
      style={[styles.container, mainTab !== 'creators' && { backgroundColor: mainTab === 'guild' ? colors.night : '#000000' }]}
      onLayout={(e) => {
        const h = e.nativeEvent.layout.height;
        if (h > 100 && Math.abs(h - containerHeight) > 2) {
          setContainerHeight(h);
        }
      }}
    >
      {/* TAB 1: REELS VERTICAL VIDEO FEED (Edge-to-Edge Full Screen) */}
      {mainTab === 'reels' ? (
        <View style={{ flex: 1, position: 'relative' }}>
          {/* Floating Edge-to-Edge Glass Top Bar (Pure Minimalist Mobile Experience) */}
          <View style={styles.floatingTopBar} pointerEvents="box-none">
            {/* Left: Guild Shortcut Pill */}
            <PressScale onPress={() => setMainTab('guild')} scaleTo={0.93} style={styles.floatingGuildPill} accessibilityLabel="Open Clip Farm guild">
              <View style={styles.onlineDotWrap}>
                <LiveRing color={colors.goldLight} size={6} />
              </View>
              <Text style={styles.floatingGuildText}>Guild</Text>
              {guildUnread ? (
                <ScaleIn style={styles.guildNavBadge}>
                  <Text style={styles.guildNavBadgeText}>{guildUnread}</Text>
                </ScaleIn>
              ) : null}
            </PressScale>

            {/* Center: Following | For You with a sliding underline */}
            <View style={styles.reelsSubBarCapsule}>
              <Pressable
                onPress={() => switchFeedTab('Following')}
                onLayout={(e) => onFeedTabLayout('Following', e)}
                style={styles.feedTab}
                accessibilityState={{ selected: activeTab === 'Following' }}
              >
                <Text style={[styles.feedTabText, activeTab === 'Following' && styles.feedTabTextActive]}>
                  Following
                </Text>
              </Pressable>
              <View style={styles.tabDivider} />
              <Pressable
                onPress={() => switchFeedTab('Recommended')}
                onLayout={(e) => onFeedTabLayout('Recommended', e)}
                style={styles.feedTab}
                accessibilityState={{ selected: activeTab === 'Recommended' }}
              >
                <Text style={[styles.feedTabText, activeTab === 'Recommended' && styles.feedTabTextActive]}>
                  For You
                </Text>
              </Pressable>
              <Animated.View
                pointerEvents="none"
                style={[styles.feedTabIndicator, { opacity: tabLayouts.Recommended ? 1 : 0, transform: [{ translateX: underlineX }] }]}
              />
            </View>

            {/* Right: Creators & Post Actions */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <PressScale
                onPress={() => setMainTab('creators')}
                scaleTo={0.9}
                style={styles.floatingCornerBtn}
                accessibilityLabel="Creators Corner"
              >
                <Icon name="sparkles" size={15} color={colors.goldLight} />
              </PressScale>
              <PressScale onPress={() => { setBounty(null); setShowPublishModal(true); }} scaleTo={0.93} style={styles.floatingCreateBtn} accessibilityLabel="Create a post">
                <PlusGlyph size={11} />
                <Text style={styles.floatingCreateText}>Post</Text>
              </PressScale>
            </View>
          </View>

          <FlatList
            ref={flatListRef}
            data={filteredVideos}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            snapToInterval={containerHeight}
            snapToAlignment="start"
            decelerationRate="fast"
            disableIntervalMomentum={true}
            bounces={false}
            getItemLayout={(data, index) => ({
              length: containerHeight,
              offset: containerHeight * index,
              index,
            })}
            viewabilityConfig={viewabilityConfig.current}
            onViewableItemsChanged={onViewableItemsChanged.current}
            renderItem={({ item, index }) => (
              <VideoReelItem
                item={item}
                index={index}
                itemHeight={containerHeight}
                isActive={index === activeIndex && focused}
                isLiked={item.liked}
                isFollowing={state.follows?.includes(item.creator.handle)}
                onLike={() => dispatch({ type: 'likeVideo', id: item.id })}
                onComment={() => {
                  setSelectedId(item.id);
                  setReplyingTo(null);
                  setShowComments(true);
                }}
                onGift={() => {
                  setSelectedId(item.id);
                  setGiftNotice(null);
                  setShowGiftStore(true);
                }}
                onShare={() => handleShare(item)}
                onRepost={() => handleRepost(item)}
                onFollow={() => handleFollow(item)}
                onOpenBible={() => openScripture(item)}
                onListen={() => listenScripture(item)}
              />
            )}
            ListEmptyComponent={
              <View style={[styles.feedEmpty, { height: containerHeight }]}>
                <ScaleIn key={activeTab} style={styles.feedEmptyIcon}>
                  <Icon name="users" size={26} color={colors.goldLight} />
                </ScaleIn>
                <FadeInUp key={`t_${activeTab}`} delay={90} style={{ alignItems: 'center' }}>
                  <Text style={styles.feedEmptyTitle}>
                    {activeTab === 'Following' ? 'No one followed yet' : 'Nothing here yet'}
                  </Text>
                  <Text style={styles.feedEmptyBody}>
                    {activeTab === 'Following'
                      ? 'Follow pastors, worship leaders and creators from For You — their posts will show up here.'
                      : 'Be the first to share a reel, photo or devotional with the community.'}
                  </Text>
                  <PressScale
                    onPress={() => (activeTab === 'Following' ? switchFeedTab('Recommended') : setShowPublishModal(true))}
                    scaleTo={0.95}
                    style={styles.feedEmptyBtn}
                  >
                    <Text style={styles.feedEmptyBtnText}>{activeTab === 'Following' ? 'Discover creators' : 'Create a post'}</Text>
                    <Icon name="arrow-right" size={14} color={colors.night} strokeWidth={2.6} />
                  </PressScale>
                </FadeInUp>
              </View>
            }
          />

          {/* Publish success: springs in over the new post, then clears itself */}
          {published ? (
            <View style={styles.publishedWrap} pointerEvents="none">
              <ScaleIn key={published.key} style={styles.publishedCard}>
                <View style={styles.publishedIconWrap}>
                  <View style={styles.publishedIcon}>
                    <Icon name="check" size={22} color={colors.night} strokeWidth={3} />
                  </View>
                  <Burst trigger={published.key} radius={44} count={12} />
                </View>
                <Text style={styles.publishedTitle}>{published.title}</Text>
                <Text style={styles.publishedBody} numberOfLines={2}>{published.label}</Text>
              </ScaleIn>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* TAB 2: CLIP FARM DISCORD GUILD (Matching Client Screenshot) */}
      {mainTab === 'guild' ? (
        <View style={styles.guildContainer}>
          {/* Guild Header */}
          <View style={styles.guildHeader}>
            <PressScale
              onPress={() => setMainTab('reels')}
              scaleTo={0.9}
              style={styles.backToReelsBtn}
              accessibilityLabel="Back to Reels"
            >
              <BackGlyph color={colors.nightFg} size={17} />
            </PressScale>
            <View style={styles.guildLogoCircle}>
              <Text style={styles.guildLogoText}>CF</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.guildName} numberOfLines={1}>Clip Farm</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 }}>
                <View style={styles.guildOnlineDot}>
                  <LiveRing color={colors.goldLight} size={6} />
                </View>
                <Text style={styles.guildMeta} numberOfLines={1}>210 online · ★ 4.57 (5,163)</Text>
              </View>
            </View>
            <PressScale
              style={styles.guildCopyBtn}
              scaleTo={0.93}
              onPress={() => shareText(`Join the Clip Farm creator guild on BibleNestra: ${GUILD_INVITE}`, 'Invite link shared')}
              accessibilityLabel="Share invite link"
            >
              <Text style={styles.guildCopyBtnText}>Invite</Text>
            </PressScale>
          </View>

          {/* Channels & Chat */}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
            {GUILD_GROUPS.map((g, gi) => (
              <FadeInUp key={g.title} index={gi} distance={10} style={styles.channelCategory}>
                {renderCategory(g.title, g.unread)}
                {!collapsed[g.title] ? (
                  <FadeInUp distance={6} duration={240}>
                    {g.channels.map(([id, icon, label]) => renderChannel(id, icon, label))}
                  </FadeInUp>
                ) : null}
              </FadeInUp>
            ))}

            {/* Interactive Guild Chat Stream */}
            <FadeInUp index={GUILD_GROUPS.length} distance={12} style={styles.guildChatBox}>
              <View style={styles.guildChatHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Pulse min={0.8} max={1.15} duration={1100}>
                    <View style={styles.guildLiveDot} />
                  </Pulse>
                  <Text style={styles.guildChatEyebrow}>Live creator stream</Text>
                </View>
                <FadeInUp key={`title_${guildChannel}`} distance={6} duration={260}>
                  <Text style={styles.guildChatTitle}>{guildChannel}</Text>
                </FadeInUp>
              </View>

              {/* Keyed by channel so switching channels re-runs the staggered entrance */}
              <View key={guildChannel}>
              {guildMessages.map((m, mi) => (
                <FadeInUp key={m.id} index={mi} distance={10} duration={340} stagger={45} style={styles.guildMessageRow}>
                  <View style={styles.guildAvatar}>
                    <Text style={styles.guildAvatarText}>{m.user[0]}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Text style={styles.guildMessageAuthor}>{m.user}</Text>
                      <View style={styles.guildRoleBadge}>
                        <Text style={styles.guildRoleText}>{m.role}</Text>
                      </View>
                      <Text style={styles.guildMessageTime}>{m.time}</Text>
                    </View>
                    <Text style={styles.guildMessageBody}>{m.text}</Text>
                  </View>
                </FadeInUp>
              ))}
              </View>

              <View style={styles.guildInputRow}>
                <TextInput
                  placeholder={`Message ${guildChannel}...`}
                  placeholderTextColor="rgba(244,239,230,0.4)"
                  value={guildInput}
                  onChangeText={setGuildInput}
                  style={styles.guildTextInput}
                />
                <PressScale
                  onPress={handleSendGuildMessage}
                  disabled={!guildInput.trim()}
                  scaleTo={0.88}
                  style={[styles.guildSendBtn, !guildInput.trim() && { opacity: 0.4 }]}
                  accessibilityLabel="Send"
                >
                  <Icon name="arrow-right" size={16} color={colors.night} strokeWidth={2.6} />
                </PressScale>
              </View>
            </FadeInUp>
          </ScrollView>
        </View>
      ) : null}

      {/* TAB 3: CREATORS CORNER */}
      {mainTab === 'creators' ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.cornerScroll}>
          <FadeInUp distance={8} style={styles.cornerHeader}>
            <PressScale
              onPress={() => setMainTab('reels')}
              scaleTo={0.9}
              style={styles.cornerBackBtn}
              accessibilityLabel="Back to Reels"
            >
              <BackGlyph color={colors.fg} size={17} />
            </PressScale>
            <PressScale
              style={styles.pitchBtn}
              scaleTo={0.95}
              onPress={() => { setBounty(null); setShowPublishModal(true); }}
            >
              <PlusGlyph size={10} />
              <Text style={styles.pitchBtnText}>Submit work</Text>
            </PressScale>
          </FadeInUp>

          <FadeInUp index={1}>
            <Text style={styles.cornerEyebrow}>Trending · 20,732 creators</Text>
            <Text style={styles.cornerMainTitle}>Creators Corner</Text>
            <Text style={styles.cornerIntro}>
              Paid bounties for editors and storytellers creating faith media. Pick a campaign, submit your reel, earn from escrow.
            </Text>
          </FadeInUp>

          {/* Category Chips (filter campaigns) */}
          <FadeInUp index={2}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 18, paddingBottom: 4 }}>
              {CORNER_CATEGORIES.map((cat) => {
                const on = cornerCat === cat;
                return (
                  <PressScale
                    key={cat}
                    onPress={() => { setCornerCat(cat); haptic('select'); }}
                    scaleTo={0.93}
                    style={[styles.cornerCatChip, on && styles.cornerCatChipActive]}
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.cornerCatChipText, on && styles.cornerCatChipTextActive]}>{cat}</Text>
                  </PressScale>
                );
              })}
            </ScrollView>
          </FadeInUp>

          {visibleCampaigns.length ? (
            visibleCampaigns.map((c, i) => {
              const apply = () => {
                setBounty(c);
                setNewTitle(c.submission);
                setNewCategory(c.category);
                setPublishMode('upload_videos');
                setShowPublishModal(true);
              };
              return (
                // Keyed by filter so switching category re-runs the entrance
                <FadeInUp key={`${cornerCat}_${c.id}`} index={i + 3} distance={18} style={{ marginTop: i === 0 ? 18 : 16 }}>
                  <PressScale onPress={apply} scaleTo={0.98} style={styles.cornerCard} accessibilityLabel={`${c.title}: ${c.tagline}, ${c.price} bounty`}>
                    <Image source={{ uri: c.image }} style={styles.cornerCardImg} />
                    <View style={styles.cornerPriceBadge}>
                      <Icon name="coin" size={12} color={colors.goldLight} />
                      <Text style={styles.cornerPriceText}>{c.price}</Text>
                    </View>
                    <View style={styles.cornerCardBody}>
                      <View style={styles.cornerCardTopRow}>
                        <Text style={styles.cornerCardTitle}>{c.title}</Text>
                        <View style={styles.cornerRatingRow}>
                          <Icon name="star" size={11} color={colors.gold} fill={colors.gold} />
                          <Text style={styles.cornerCardRating}>{c.rating}</Text>
                        </View>
                      </View>
                      <Text style={styles.cornerCardTagline}>{c.tagline}</Text>
                      <Text style={styles.cornerCardDesc}>{c.desc}</Text>
                      <View style={styles.cornerTagRow}>
                        {c.tags.map((t) => (
                          <View key={t} style={[styles.cornerTag, t === cornerCat && styles.cornerTagOn]}>
                            <Text style={[styles.cornerTagText, t === cornerCat && styles.cornerTagTextOn]}>{t}</Text>
                          </View>
                        ))}
                      </View>
                      <Button
                        label={`Apply for ${c.price} bounty`}
                        onPress={apply}
                        style={{ marginTop: 14 }}
                      />
                    </View>
                  </PressScale>
                </FadeInUp>
              );
            })
          ) : (
            <ScaleIn key={cornerCat} style={styles.cornerEmpty}>
              <View style={styles.cornerEmptyIcon}>
                <Icon name="briefcase" size={22} color={colors.muted} />
              </View>
              <Text style={styles.cornerEmptyTitle}>No {cornerCat} campaigns right now</Text>
              <Text style={styles.cornerEmptyBody}>New bounties are announced in the Clip Farm guild.</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <Button small kind="ghost" label="Show all" onPress={() => setCornerCat('All')} />
                <Button small label="Open guild" onPress={() => { setMainTab('guild'); openChannel('#campaign-announcements'); }} />
              </View>
            </ScaleIn>
          )}
        </ScrollView>
      ) : null}

      {/* Multi-Media Publishing Suite Modal (Post content, Post video, Upload images, Upload videos) */}
      <AnimatedModal visible={showPublishModal} onRequestClose={closePublish}>
        <View style={styles.modalOverlay}>
          <Pressable style={{ flex: 1 }} onPress={closePublish} accessibilityLabel="Dismiss" />
          <View style={styles.publishSheet}>
            <View style={styles.sheetPad}>
              <SheetHead
                eyebrow={bounty ? `Bounty submission · ${bounty.price}` : 'New post'}
                title={bounty ? bounty.title : 'Create & Upload to Socials'}
                subtitle={bounty ? 'Your reel is published to Socials and sent to the campaign owner' : 'Post content, videos & photos with live preview'}
                onClose={closePublish}
              />

              {/* 4 Mode Selector: Post Content | Post Video | Upload Images | Upload Videos */}
              <View style={styles.publishModeRow} onLayout={(e) => setModeRowW(e.nativeEvent.layout.width)}>
                {modeTabW > 0 ? (
                  <Animated.View
                    pointerEvents="none"
                    style={[styles.publishModeIndicator, { width: modeTabW, transform: [{ translateX: modeX }] }]}
                  />
                ) : null}
                {PUBLISH_MODES.map((m) => {
                  const on = publishMode === m.id;
                  return (
                    <Pressable
                      key={m.id}
                      onPress={() => setPublishMode(m.id)}
                      style={[styles.publishModeTab, on && modeTabW <= 0 && styles.publishModeTabActive]}
                      accessibilityState={{ selected: on }}
                    >
                      <Pop trigger={on} amount={on ? 1.18 : 1}>
                        <Icon name={m.icon} size={15} color={on ? colors.primary : colors.faint} />
                      </Pop>
                      <Text style={[styles.publishModeText, on && styles.publishModeTextActive]} numberOfLines={1}>
                        {m.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.sheetScroll} keyboardShouldPersistTaps="handled">
              <FadeInUp key={publishMode} distance={10} duration={300}>
              {/* MODE 1 & 2: UPLOAD VIDEOS & POST VIDEO (WITH LIVE VIDEO PREVIEW) */}
              {publishMode === 'upload_videos' || publishMode === 'post_video' ? (
                <>
                  <Text style={styles.label}>Select video to upload</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {SAMPLE_VIDEOS.map((v) => {
                      const on = selectedMediaUrl === v.url;
                      return (
                        <PressScale
                          key={v.id}
                          onPress={() => setSelectedMediaUrl(v.url)}
                          scaleTo={0.94}
                          style={[styles.mediaOptionCard, on && styles.mediaOptionCardActive]}
                        >
                          <Icon name="video" size={15} color={on ? colors.primary : colors.muted} />
                          <Text style={[styles.mediaOptionText, on && styles.mediaOptionTextActive]}>
                            {v.title}
                          </Text>
                          <Text style={styles.mediaOptionMeta}>{v.duration}</Text>
                        </PressScale>
                      );
                    })}
                  </ScrollView>

                  {/* LIVE VIDEO PREVIEW PLAYER */}
                  <UploadVideoPreview videoUrl={selectedMediaUrl} />

                  <Text style={styles.label}>Caption & key message</Text>
                  <TextInput
                    placeholder="What is the Holy Spirit speaking through this video?"
                    placeholderTextColor={colors.faint}
                    value={newTitle}
                    onChangeText={setNewTitle}
                    multiline
                    style={[styles.input, styles.inputMulti]}
                  />

                  <Text style={styles.label}>Scripture reference</Text>
                  <TextInput
                    placeholder="e.g. Philippians 4:13"
                    placeholderTextColor={colors.faint}
                    value={newScripture}
                    onChangeText={setNewScripture}
                    style={styles.input}
                  />

                  <Text style={styles.label}>Category</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {['Sermons', 'Worship', 'Testimonies', 'Bible Study', 'Evangelism'].map((cat) => (
                      <PressScale
                        key={cat}
                        onPress={() => setNewCategory(cat)}
                        scaleTo={0.93}
                        style={[styles.catChip, newCategory === cat && styles.catChipActive]}
                        accessibilityState={{ selected: newCategory === cat }}
                      >
                        <Text style={[styles.catChipText, newCategory === cat && styles.catChipTextActive]}>{cat}</Text>
                      </PressScale>
                    ))}
                  </ScrollView>

                  <Button
                    label="Publish video to Socials feed"
                    icon={<Icon name="check" size={15} color={colors.primaryFg} strokeWidth={2.6} />}
                    onPress={handlePublish}
                    disabled={!newTitle.trim()}
                    style={{ marginTop: 22 }}
                  />
                </>
              ) : null}

              {/* MODE 3: UPLOAD IMAGES (WITH LIVE PHOTO PREVIEW) */}
              {publishMode === 'upload_images' ? (
                <>
                  <Text style={styles.label}>Select photo to upload</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {SAMPLE_IMAGES.map((img) => {
                      const on = selectedImageUrl === img.url;
                      return (
                        <PressScale
                          key={img.id}
                          onPress={() => setSelectedImageUrl(img.url)}
                          scaleTo={0.94}
                          style={[styles.mediaOptionCard, on && styles.mediaOptionCardActive]}
                        >
                          <Icon name="sparkles" size={15} color={on ? colors.primary : colors.muted} />
                          <Text style={[styles.mediaOptionText, on && styles.mediaOptionTextActive]}>
                            {img.title}
                          </Text>
                        </PressScale>
                      );
                    })}
                  </ScrollView>

                  {/* LIVE IMAGE PREVIEW */}
                  <View style={styles.imagePreviewBox}>
                    <FadeInUp key={selectedImageUrl} distance={0} duration={320} style={StyleSheet.absoluteFill}>
                      <Image source={{ uri: selectedImageUrl }} style={styles.imagePreviewImg} />
                    </FadeInUp>
                    <View style={styles.modalPreviewBadge}>
                      <View style={styles.modalPreviewDot} />
                      <Text style={styles.modalPreviewBadgeText}>PHOTO PREVIEW</Text>
                    </View>
                  </View>

                  <Text style={styles.label}>Photo caption</Text>
                  <TextInput
                    placeholder="Share the inspiration behind this photo..."
                    placeholderTextColor={colors.faint}
                    value={newTitle}
                    onChangeText={setNewTitle}
                    multiline
                    style={[styles.input, styles.inputMulti]}
                  />

                  <Text style={styles.label}>Scripture reference</Text>
                  <TextInput
                    placeholder="e.g. Psalm 23:1"
                    placeholderTextColor={colors.faint}
                    value={newScripture}
                    onChangeText={setNewScripture}
                    style={styles.input}
                  />

                  <Button
                    label="Publish photo to Socials feed"
                    icon={<Icon name="check" size={15} color={colors.primaryFg} strokeWidth={2.6} />}
                    onPress={handlePublish}
                    disabled={!newTitle.trim()}
                    style={{ marginTop: 22 }}
                  />
                </>
              ) : null}

              {/* MODE 4: POST A CONTENT (TEXT / DEVOTIONAL) */}
              {publishMode === 'post_content' ? (
                <>
                  <Text style={styles.label}>Card theme</Text>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    {CONTENT_THEMES.map((color) => (
                      <PressScale
                        key={color}
                        onPress={() => setContentTheme(color)}
                        scaleTo={0.88}
                        style={[styles.themeRing, contentTheme === color && styles.themeRingActive]}
                        accessibilityLabel="Card theme"
                        accessibilityState={{ selected: contentTheme === color }}
                      >
                        <Pop trigger={contentTheme === color} amount={contentTheme === color ? 1.15 : 1}>
                          <View style={[styles.themePill, { backgroundColor: color }]} />
                        </Pop>
                      </PressScale>
                    ))}
                  </View>

                  <View style={[styles.contentPreviewCard, { backgroundColor: contentTheme }]}>
                    <Text style={styles.contentPreviewQuote}>“</Text>
                    <Text style={styles.contentPreviewCardText}>
                      {textContent.trim() || 'Your devotional message or testimony will appear formatted like this in believers’ feeds.'}
                    </Text>
                    <Text style={styles.contentPreviewCardRef}>
                      {newScripture.trim() ? `— ${newScripture}` : '— Scripture'}
                    </Text>
                  </View>

                  <Text style={styles.label}>Devotion / faith testimony</Text>
                  <TextInput
                    placeholder="Share what the Lord has done or a Scripture meditation..."
                    placeholderTextColor={colors.faint}
                    value={textContent}
                    onChangeText={setTextContent}
                    multiline
                    style={[styles.input, styles.inputMulti, { minHeight: 100 }]}
                  />

                  <Text style={styles.label}>Scripture reference</Text>
                  <TextInput
                    placeholder="e.g. Romans 8:28"
                    placeholderTextColor={colors.faint}
                    value={newScripture}
                    onChangeText={setNewScripture}
                    style={styles.input}
                  />

                  <Button
                    label="Publish faith post to feed"
                    icon={<Icon name="check" size={15} color={colors.primaryFg} strokeWidth={2.6} />}
                    onPress={handlePublish}
                    disabled={!textContent.trim()}
                    style={{ marginTop: 22 }}
                  />
                </>
              ) : null}
              </FadeInUp>
            </ScrollView>
          </View>
        </View>
      </AnimatedModal>

      {/* Virtual Gifts Store Modal */}
      <AnimatedModal visible={showGiftStore} onRequestClose={closeGifts}>
        <View style={styles.modalOverlay}>
          <Pressable style={{ flex: 1 }} onPress={closeGifts} accessibilityLabel="Dismiss" />
          <View style={styles.giftModalSheet}>
            <SheetHead
              eyebrow={activeVideo?.creator?.name ? `For ${activeVideo.creator.name}` : 'Gifts'}
              title="Send Virtual Gift"
              subtitle="Bless and support Christian creators"
              right={
                <Pop trigger={state.coins} amount={1.12}>
                  <View style={styles.coinBalanceBadge}>
                    <Icon name="coin" size={14} color={colors.gold} />
                    <AnimatedNumber value={state.coins || 0} style={styles.coinBalanceText} />
                  </View>
                </Pop>
              }
            />

            <View style={styles.giftGrid}>
              {GIFTS.map((g, gi) => {
                const iconMeta = GIFT_ICONS[g.id] || { name: 'sparkles', color: colors.gold };
                const short = g.price > (state.coins || 0);
                return (
                  <FadeInUp key={g.id} index={gi} distance={12} duration={340}>
                    <PressScale
                      onPress={() => handleSendGift(g)}
                      accessibilityLabel={`Send ${g.name}`}
                      scaleTo={0.95}
                      style={[styles.giftCard, short && styles.giftCardShort]}
                    >
                      <View style={[styles.giftIconCircle, { backgroundColor: alpha(iconMeta.color, 0.12) }]}>
                        <Icon name={iconMeta.name} size={22} color={iconMeta.color} />
                      </View>
                      <Text style={styles.giftNameText}>{g.name}</Text>
                      <Text style={styles.giftDescText} numberOfLines={2}>{g.desc}</Text>
                      <View style={styles.giftPricePill}>
                        <Icon name="coin" size={12} color={colors.gold} />
                        <Text style={styles.giftPriceText}>{g.price} coins</Text>
                      </View>
                    </PressScale>
                  </FadeInUp>
                );
              })}
            </View>

            {giftNotice ? (
              <ScaleIn key={giftNotice.text} from={0.92} style={[styles.giftNotice, giftNotice.tone === 'error' ? styles.giftNoticeError : styles.giftNoticeOk]}>
                <Icon
                  name={giftNotice.tone === 'error' ? 'coin' : 'check'}
                  size={14}
                  color={giftNotice.tone === 'error' ? colors.negative : colors.primary}
                  strokeWidth={2.4}
                />
                <Text style={[styles.giftNoticeText, giftNotice.tone === 'error' && { color: colors.negative }]}>{giftNotice.text}</Text>
              </ScaleIn>
            ) : null}

            <View style={styles.refillRow}>
              <Button
                small
                kind={giftNotice?.tone === 'error' ? 'primary' : 'ghost'}
                label="Buy 250 coins · $2.99"
                icon={<Icon name="coin" size={14} color={giftNotice?.tone === 'error' ? colors.goldLight : colors.gold} />}
                onPress={() => buyCoins(250)}
              />
              <Button small kind="ghost" label="Close" onPress={closeGifts} />
            </View>
          </View>
        </View>
      </AnimatedModal>

      {/* Comments & Replies Modal */}
      <AnimatedModal visible={showComments} onRequestClose={() => setShowComments(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={{ flex: 1 }} onPress={() => setShowComments(false)} accessibilityLabel="Dismiss" />
          <View style={styles.commentsSheet}>
            <View style={styles.sheetPad}>
              <SheetHead
                eyebrow="Conversation"
                title={`${activeVideo?.comments?.length || 0} Comments`}
                onClose={() => setShowComments(false)}
              />
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.sheetScroll} keyboardShouldPersistTaps="handled">
              {activeVideo?.comments?.length ? null : (
                <ScaleIn style={styles.commentsEmpty}>
                  <View style={styles.commentsEmptyIcon}>
                    <Icon name="chat" size={22} color={colors.primary} />
                  </View>
                  <Text style={styles.commentsEmptyTitle}>Start the conversation</Text>
                  <Text style={styles.commentsEmptyText}>Be the first to share an encouraging word.</Text>
                </ScaleIn>
              )}
              {activeVideo?.comments?.map((c, ci) => (
                <FadeInUp key={c.id} index={ci} distance={10} duration={340} style={styles.commentBlock}>
                  <View style={styles.commentAvatar}>
                    <Text style={styles.commentAvatarText}>{c.from.slice(0, 2).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.commentAuthor}>{c.from}<Text style={styles.commentTime}>  ·  {c.time}</Text></Text>
                    <Text style={styles.commentBody}>{c.text}</Text>
                    <PressScale onPress={() => setReplyingTo(c)} hitSlop={8} scaleTo={0.92} style={{ marginTop: 6, alignSelf: 'flex-start' }} accessibilityLabel={`Reply to ${c.from}`}>
                      <Text style={[styles.replyActionText, replyingTo?.id === c.id && { color: colors.primary }]}>Reply</Text>
                    </PressScale>

                    {c.replies?.map((r) => (
                      <FadeInUp key={r.id} distance={8} duration={320} style={styles.replyItem}>
                        <Text style={styles.replyAuthor}>{r.from}<Text style={styles.commentTime}>  ·  {r.time}</Text></Text>
                        <Text style={styles.replyBody}>{r.text}</Text>
                      </FadeInUp>
                    ))}
                  </View>
                </FadeInUp>
              ))}
            </ScrollView>

            <View style={styles.commentFooter}>
              {replyingTo ? (
                <FadeInUp key={replyingTo.id} distance={6} duration={220} style={styles.replyingBar}>
                  <Text style={styles.replyingText} numberOfLines={1}>Replying to <Text style={{ fontWeight: '700' }}>{replyingTo.from}</Text></Text>
                  <Pressable onPress={() => setReplyingTo(null)} hitSlop={10} accessibilityLabel="Cancel reply">
                    <CloseGlyph color={colors.primary} size={10} />
                  </Pressable>
                </FadeInUp>
              ) : null}

              <View style={styles.commentInputRow}>
                <TextInput
                  placeholder={replyingTo ? `Reply to ${replyingTo.from}...` : "Add thoughtful Christian comment..."}
                  placeholderTextColor={colors.faint}
                  value={commentText}
                  onChangeText={setCommentText}
                  style={styles.commentInput}
                />
                <Button small label="Post" onPress={handleAddComment} disabled={!commentText.trim()} />
              </View>
            </View>
          </View>
        </View>
      </AnimatedModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.screen,
  },

  // ─── Reel card ──────────────────────────────────────────────
  videoCard: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT - 105,
    justifyContent: 'space-between',
    position: 'relative',
    overflow: 'hidden',
  },
  topGradientScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 130,
    zIndex: 2,
  },
  bottomGradientScrim: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 380,
    zIndex: 2,
  },
  videoPlayerGraphic: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  ambientIconRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: alpha(colors.goldLight, 0.12),
    borderWidth: 1,
    borderColor: alpha(colors.goldLight, 0.35),
    alignItems: 'center',
    justifyContent: 'center',
  },
  ambientCategoryBadge: {
    fontSize: 10.5,
    letterSpacing: 1.8,
    color: colors.goldLight,
    fontWeight: '700',
  },
  ambientDurationText: {
    fontSize: 11.5,
    color: colors.nightMuted,
  },
  centerPlayBadge: {
    position: 'absolute',
    top: '45%',
    left: '50%',
    marginLeft: -34,
    marginTop: -34,
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 15,
  },

  // Creator block
  bottomInfo: {
    position: 'absolute',
    bottom: 22,
    left: 16,
    right: 78,
    zIndex: 10,
  },
  categoryBadgePill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: alpha(colors.goldLight, 0.16),
    borderWidth: 1,
    borderColor: alpha(colors.goldLight, 0.38),
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: radius.pill,
    marginBottom: 10,
  },
  categoryBadgeText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: colors.goldLight,
    letterSpacing: 1.3,
  },
  creatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  creatorAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  creatorAvatarText: {
    fontSize: 13,
    fontWeight: '700',
    color: WHITE,
    letterSpacing: 0.3,
  },
  creatorName: {
    flexShrink: 1,
    fontSize: 15.5,
    fontWeight: '700',
    color: WHITE,
    letterSpacing: -0.1,
    ...TEXT_SHADOW,
  },
  verifiedDot: {
    width: 15,
    height: 15,
    borderRadius: 7.5,
    backgroundColor: colors.goldLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  creatorHandle: {
    fontSize: 12,
    color: ON_DARK_MUTED,
    marginTop: 2,
    ...TEXT_SHADOW,
  },
  followBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: WHITE,
    paddingHorizontal: 13,
    height: 30,
    borderRadius: radius.pill,
  },
  followBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderColor: 'rgba(255,255,255,0.32)',
  },
  followBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.night,
  },
  followBtnTextActive: {
    color: WHITE,
  },
  captionText: {
    fontSize: 14,
    color: WHITE,
    lineHeight: 20,
    marginBottom: 10,
    ...TEXT_SHADOW,
  },
  scripturePill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.42)',
    borderWidth: 1,
    borderColor: alpha(colors.goldLight, 0.45),
    paddingLeft: 10,
    paddingRight: 9,
    height: 30,
    borderRadius: radius.pill,
    marginBottom: 10,
  },
  scriptureText: {
    fontFamily: fonts.serifBold,
    fontSize: 13.5,
    color: colors.goldLight,
  },
  scriptureSep: {
    width: 1,
    height: 12,
    backgroundColor: 'rgba(255,255,255,0.22)',
    marginHorizontal: 1,
  },
  scriptureCta: {
    fontSize: 11.5,
    fontWeight: '600',
    color: ON_DARK_MUTED,
  },
  hashtagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 8,
    rowGap: 2,
    marginBottom: 10,
  },
  hashtagText: {
    fontSize: 12.5,
    color: WHITE,
    fontWeight: '700',
    ...TEXT_SHADOW,
  },
  soundRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  soundText: {
    flexShrink: 1,
    fontSize: 12,
    color: ON_DARK_MUTED,
  },

  // Action rail
  rightRail: {
    position: 'absolute',
    right: 12,
    bottom: 22,
    alignItems: 'center',
    gap: 14,
    zIndex: 12,
  },
  railAction: {
    alignItems: 'center',
  },
  railIconCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  railIconCircleLiked: {
    backgroundColor: alpha(colors.rose, 0.22),
    borderColor: alpha(colors.rose, 0.6),
  },
  railIconCircleGift: {
    backgroundColor: alpha(colors.goldLight, 0.16),
    borderColor: alpha(colors.goldLight, 0.55),
  },
  railBurstWrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingHeartShadow: {
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  railCount: {
    fontSize: 11.5,
    color: WHITE,
    fontWeight: '700',
    ...TEXT_SHADOW,
  },
  musicDiscPress: {
    width: 46,
    height: 46,
    marginTop: 4,
  },
  musicDiscBox: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.night,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  musicDiscGroove: {
    position: 'absolute',
    top: 5,
    left: 5,
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  musicDiscSheen: {
    position: 'absolute',
    top: 2.5,
    left: 17,
    width: 10,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: alpha(colors.goldLight, 0.85),
  },
  musicDiscInner: {
    position: 'absolute',
    top: 10,
    left: 10,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primary,
    borderWidth: 1.5,
    borderColor: colors.goldLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  musicDiscText: {
    fontSize: 8.5,
    fontWeight: '800',
    color: WHITE,
  },

  // ─── Floating top bar ───────────────────────────────────────
  floatingTopBar: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 30,
  },
  floatingGuildPill: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 32,
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    paddingLeft: 10,
    paddingRight: 6,
    borderRadius: radius.pill,
  },
  onlineDotWrap: {
    marginRight: 7,
  },
  floatingGuildText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: WHITE,
    marginRight: 5,
  },
  guildNavBadge: {
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: colors.rose,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  guildNavBadgeText: {
    color: WHITE,
    fontSize: 9.5,
    fontWeight: '800',
  },
  reelsSubBarCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 32,
    paddingHorizontal: 10,
  },
  feedTab: {
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingTop: 2,
    paddingBottom: 6,
  },
  feedTabText: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.62)',
    ...TEXT_SHADOW,
  },
  feedTabTextActive: {
    color: WHITE,
    fontWeight: '800',
  },
  feedTabIndicator: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    width: 18,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: colors.goldLight,
  },
  tabDivider: {
    width: 1,
    height: 12,
    marginTop: -2,
    backgroundColor: 'rgba(255,255,255,0.3)',
    marginHorizontal: 4,
  },
  floatingCornerBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: alpha(colors.goldLight, 0.45),
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingCreateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 32,
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    paddingHorizontal: 12,
    borderRadius: radius.pill,
  },
  floatingCreateText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: WHITE,
  },

  // Gift toast
  giftToast: {
    position: 'absolute',
    top: 58,
    alignSelf: 'center',
    zIndex: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.night,
    borderWidth: 1,
    borderColor: alpha(colors.goldLight, 0.45),
    paddingLeft: 6,
    paddingRight: 14,
    paddingVertical: 6,
    borderRadius: radius.pill,
    ...shadow.lg,
  },
  giftToastIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.goldLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  giftToastText: {
    fontSize: 12.5,
    color: colors.nightFg,
    fontWeight: '600',
  },

  // ─── Sheets (parchment) ─────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'transparent', // AnimatedModal draws the dim layer
    justifyContent: 'flex-end',
  },
  giftModalSheet: {
    backgroundColor: colors.screen,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 22,
    maxHeight: '82%',
    ...shadow.lg,
  },
  commentsSheet: {
    backgroundColor: colors.screen,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 8,
    height: '68%',
    ...shadow.lg,
  },
  publishSheet: {
    backgroundColor: colors.screen,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 8,
    height: '88%',
    ...shadow.lg,
  },
  sheetPad: {
    paddingHorizontal: 18,
  },
  sheetScroll: {
    paddingHorizontal: 18,
    paddingBottom: 36,
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 4.5,
    borderRadius: 3,
    backgroundColor: colors.borderStrong,
    marginBottom: 12,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  sheetEyebrow: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    color: colors.gold,
    marginBottom: 2,
  },
  sheetTitle: {
    fontFamily: fonts.serifBold,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.3,
    color: colors.fg,
  },
  sheetSubtitle: {
    fontSize: 12.5,
    color: colors.muted,
    marginTop: 2,
  },
  sheetCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Gifts
  coinBalanceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.cardGold,
    paddingHorizontal: 11,
    height: 30,
    borderRadius: radius.pill,
  },
  coinBalanceText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.goldMuted,
  },
  giftGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 2,
  },
  giftCard: {
    width: (SCREEN_WIDTH - 46) / 2,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
    ...shadow.sm,
  },
  giftIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  giftNameText: {
    fontFamily: fonts.serifBold,
    fontSize: 16,
    letterSpacing: -0.2,
    color: colors.fg,
  },
  giftDescText: {
    fontSize: 11.5,
    lineHeight: 15,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 3,
    minHeight: 30,
  },
  giftPricePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.cardGold,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    marginTop: 10,
  },
  giftPriceText: {
    fontSize: 11.5,
    color: colors.goldMuted,
    fontWeight: '700',
  },
  refillRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 18,
  },

  // Comments
  commentsEmpty: {
    alignItems: 'center',
    paddingVertical: 36,
    gap: 8,
  },
  commentsEmptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  commentsEmptyTitle: {
    fontFamily: fonts.serifBold,
    fontSize: 18,
    letterSpacing: -0.2,
    color: colors.fg,
  },
  commentsEmptyText: {
    fontSize: 13,
    color: colors.muted,
  },
  commentBlock: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  commentAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentAvatarText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
  },
  commentAuthor: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.fg,
  },
  commentTime: {
    fontWeight: '400',
    color: colors.faint,
    fontSize: 12,
  },
  commentBody: {
    fontSize: 14,
    color: colors.passage,
    marginTop: 3,
    lineHeight: 20,
  },
  replyActionText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
  },
  replyItem: {
    marginTop: 10,
    paddingLeft: 12,
    paddingVertical: 2,
    borderLeftWidth: 2,
    borderLeftColor: colors.borderStrong,
  },
  replyAuthor: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.fg,
  },
  replyBody: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.muted,
    marginTop: 2,
  },
  commentFooter: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 18,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.screen,
  },
  replyingBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    marginBottom: 8,
  },
  replyingText: {
    flex: 1,
    fontSize: 12,
    color: colors.primary,
  },
  commentInputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  commentInput: {
    flex: 1,
    height: 42,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    fontSize: 14,
    color: colors.fg,
  },

  // Publish form
  label: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.muted,
    marginTop: 18,
    marginBottom: 8,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14.5,
    color: colors.fg,
  },
  inputMulti: {
    minHeight: 76,
    textAlignVertical: 'top',
    lineHeight: 20,
  },
  catChip: {
    paddingHorizontal: 14,
    height: 34,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  catChipActive: {
    backgroundColor: colors.fg,
    borderColor: colors.fg,
  },
  catChipText: {
    fontSize: 12.5,
    fontWeight: '500',
    color: colors.muted,
  },
  catChipTextActive: {
    color: WHITE,
    fontWeight: '600',
  },
  publishModeRow: {
    flexDirection: 'row',
    gap: 4,
    backgroundColor: colors.raised,
    padding: 4,
    borderRadius: radius.md,
    marginBottom: 2,
  },
  publishModeIndicator: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 0,
    borderRadius: 10,
    backgroundColor: colors.surface,
    ...shadow.sm,
  },
  publishModeTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    gap: 4,
    borderRadius: 10,
  },
  publishModeTabActive: {
    backgroundColor: colors.surface,
    ...shadow.sm,
  },
  publishModeText: {
    fontSize: 10.5,
    fontWeight: '500',
    color: colors.muted,
  },
  publishModeTextActive: {
    fontWeight: '700',
    color: colors.fg,
  },
  modalPreviewBox: {
    height: 170,
    borderRadius: radius.lg,
    overflow: 'hidden',
    position: 'relative',
    marginTop: 12,
    backgroundColor: colors.night,
  },
  modalPreviewPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalPreviewPlaceholderText: {
    color: colors.nightMuted,
    fontSize: 12,
    marginTop: 8,
  },
  modalPreviewScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  modalPreviewBadge: {
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
  },
  modalPreviewDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.goldLight,
  },
  modalPreviewBadgeText: {
    color: colors.goldLight,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
  },
  mediaOptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 13,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  mediaOptionCardActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  mediaOptionText: {
    fontSize: 12.5,
    fontWeight: '500',
    color: colors.muted,
  },
  mediaOptionTextActive: {
    color: colors.primary,
    fontWeight: '700',
  },
  mediaOptionMeta: {
    fontSize: 11,
    color: colors.faint,
  },
  imagePreviewBox: {
    height: 190,
    borderRadius: radius.lg,
    overflow: 'hidden',
    position: 'relative',
    marginTop: 12,
    backgroundColor: colors.raised,
  },
  imagePreviewImg: {
    width: '100%',
    height: '100%',
  },
  themeRing: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  themeRingActive: {
    borderColor: colors.gold,
  },
  themePill: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  contentPreviewCard: {
    paddingHorizontal: 22,
    paddingTop: 14,
    paddingBottom: 20,
    borderRadius: radius.lg,
    marginTop: 14,
    minHeight: 140,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contentPreviewQuote: {
    fontFamily: fonts.serifBold,
    fontSize: 38,
    lineHeight: 38,
    color: colors.goldLight,
    marginBottom: -4,
  },
  contentPreviewCardText: {
    color: WHITE,
    fontFamily: fonts.serifItalic,
    fontSize: 17,
    lineHeight: 24,
    textAlign: 'center',
  },
  contentPreviewCardRef: {
    color: colors.goldLight,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginTop: 12,
  },

  // ─── Guild (night) ──────────────────────────────────────────
  guildContainer: {
    flex: 1,
    backgroundColor: colors.night,
  },
  guildHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.nightRaised,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.nightBorder,
  },
  backToReelsBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  guildLogoCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.goldLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guildLogoText: {
    color: colors.night,
    fontFamily: fonts.serifBold,
    fontSize: 16,
    letterSpacing: -0.3,
  },
  guildName: {
    color: colors.nightFg,
    fontFamily: fonts.serifBold,
    fontSize: 18,
    letterSpacing: -0.2,
  },
  guildMeta: {
    color: colors.nightMuted,
    fontSize: 11.5,
  },
  guildOnlineDot: {
    marginRight: 2,
  },
  guildLiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.goldLight,
  },
  guildCopyBtn: {
    height: 30,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 12,
    borderRadius: radius.pill,
  },
  guildCopyBtnText: {
    color: colors.nightFg,
    fontSize: 11.5,
    fontWeight: '600',
  },
  channelCategory: {
    paddingHorizontal: 14,
    paddingTop: 18,
  },
  categoryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 6,
    marginBottom: 4,
  },
  categoryTitle: {
    color: colors.nightMuted,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },
  unreadPill: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.rose,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  unreadPillText: {
    color: WHITE,
    fontSize: 10,
    fontWeight: '700',
  },
  channelItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 38,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    marginTop: 2,
    overflow: 'hidden',
  },
  channelItemActive: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  channelActiveBar: {
    position: 'absolute',
    left: 0,
    top: 9,
    bottom: 9,
    width: 3,
    borderRadius: 2,
    backgroundColor: colors.goldLight,
  },
  channelName: {
    flex: 1,
    color: colors.nightMuted,
    fontSize: 14,
  },
  channelNameActive: {
    color: colors.nightFg,
    fontWeight: '600',
  },
  guildChatBox: {
    marginHorizontal: 14,
    marginTop: 22,
    backgroundColor: colors.nightRaised,
    borderRadius: radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.nightBorder,
  },
  guildChatHeader: {
    borderBottomWidth: 1,
    borderBottomColor: colors.nightBorder,
    paddingBottom: 12,
    marginBottom: 14,
  },
  guildChatEyebrow: {
    color: colors.goldLight,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },
  guildChatTitle: {
    color: colors.nightFg,
    fontFamily: fonts.serifBold,
    fontSize: 20,
    letterSpacing: -0.3,
    marginTop: 3,
  },
  guildMessageRow: {
    flexDirection: 'row',
    gap: 11,
    marginBottom: 16,
  },
  guildAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guildAvatarText: {
    color: WHITE,
    fontWeight: '700',
    fontSize: 13,
  },
  guildMessageAuthor: {
    color: colors.nightFg,
    fontSize: 13,
    fontWeight: '700',
  },
  guildRoleBadge: {
    backgroundColor: alpha(colors.goldLight, 0.16),
    paddingHorizontal: 7,
    paddingVertical: 1.5,
    borderRadius: radius.pill,
  },
  guildRoleText: {
    color: colors.goldLight,
    fontSize: 9.5,
    fontWeight: '700',
  },
  guildMessageTime: {
    color: 'rgba(244,239,230,0.42)',
    fontSize: 10.5,
  },
  guildMessageBody: {
    color: 'rgba(244,239,230,0.86)',
    fontSize: 13.5,
    marginTop: 3,
    lineHeight: 19,
  },
  guildInputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.nightBorder,
    paddingTop: 12,
    marginTop: 2,
  },
  guildTextInput: {
    flex: 1,
    height: 42,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: colors.nightBorder,
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    color: colors.nightFg,
    fontSize: 13.5,
  },
  guildSendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.goldLight,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ─── Creators Corner (parchment) ───────────────────────────
  cornerScroll: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 48,
  },
  cornerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  cornerBackBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cornerEyebrow: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    color: colors.gold,
  },
  cornerMainTitle: {
    fontFamily: fonts.serifBold,
    fontSize: 26,
    lineHeight: 31,
    letterSpacing: -0.5,
    color: colors.fg,
  },
  cornerIntro: {
    fontSize: 13.5,
    lineHeight: 19,
    color: colors.muted,
    marginTop: 12,
    marginBottom: 16,
  },
  pitchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 34,
    backgroundColor: colors.primary,
    paddingHorizontal: 13,
    borderRadius: radius.pill,
    ...shadow.sm,
  },
  pitchBtnText: {
    color: WHITE,
    fontSize: 12.5,
    fontWeight: '600',
  },
  cornerCatChip: {
    paddingHorizontal: 14,
    height: 34,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cornerCatChipActive: {
    backgroundColor: colors.fg,
    borderColor: colors.fg,
  },
  cornerCatChipText: {
    fontSize: 12.5,
    fontWeight: '500',
    color: colors.muted,
  },
  cornerCatChipTextActive: {
    color: WHITE,
    fontWeight: '600',
  },
  cornerCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  cornerCardImg: {
    width: '100%',
    height: 160,
    backgroundColor: colors.raised,
  },
  cornerPriceBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(21,23,43,0.82)',
    paddingHorizontal: 11,
    height: 28,
    borderRadius: radius.pill,
  },
  cornerPriceText: {
    color: colors.nightFg,
    fontSize: 13,
    fontWeight: '700',
  },
  cornerCardBody: {
    padding: 16,
  },
  cornerCardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cornerCardTitle: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    color: colors.gold,
  },
  cornerRatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cornerCardRating: {
    color: colors.muted,
    fontSize: 11.5,
    fontWeight: '600',
  },
  cornerCardTagline: {
    fontFamily: fonts.serifBold,
    fontSize: 20,
    lineHeight: 25,
    letterSpacing: -0.3,
    color: colors.fg,
    marginTop: 6,
  },
  cornerCardDesc: {
    fontSize: 13.5,
    color: colors.muted,
    marginTop: 6,
    lineHeight: 19,
  },
  // ─── v4: text / image posts, empty states, notices ─────────
  textPostWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 30,
    paddingBottom: 140,
  },
  textPostQuote: {
    fontFamily: fonts.serifBold,
    fontSize: 64,
    lineHeight: 64,
    color: colors.goldLight,
    marginBottom: -6,
  },
  textPostBody: {
    fontFamily: fonts.serifMedium,
    fontSize: 24,
    lineHeight: 33,
    letterSpacing: -0.3,
    color: WHITE,
  },
  textPostRef: {
    marginTop: 16,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    color: colors.goldLight,
  },
  railIconCircleReposted: {
    backgroundColor: alpha(colors.goldLight, 0.18),
    borderColor: alpha(colors.goldLight, 0.6),
  },
  publishedWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 40,
  },
  publishedCard: {
    alignItems: 'center',
    width: 236,
    paddingVertical: 22,
    paddingHorizontal: 18,
    borderRadius: 22,
    backgroundColor: colors.nightRaised,
    borderWidth: 1,
    borderColor: alpha(colors.goldLight, 0.35),
    ...shadow.lg,
  },
  publishedIconWrap: {
    position: 'relative',
    width: 96,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  publishedIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.goldLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  publishedTitle: {
    marginTop: 8,
    fontFamily: fonts.serifBold,
    fontSize: 21,
    letterSpacing: -0.3,
    color: colors.nightFg,
  },
  publishedBody: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    color: colors.nightMuted,
  },
  feedEmpty: {
    width: SCREEN_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    backgroundColor: colors.night,
  },
  feedEmptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: alpha(colors.goldLight, 0.12),
    borderWidth: 1,
    borderColor: alpha(colors.goldLight, 0.35),
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  feedEmptyTitle: {
    fontFamily: fonts.serifBold,
    fontSize: 24,
    letterSpacing: -0.4,
    color: colors.nightFg,
    textAlign: 'center',
  },
  feedEmptyBody: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    color: colors.nightMuted,
    textAlign: 'center',
  },
  feedEmptyBtn: {
    marginTop: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    paddingHorizontal: 20,
    borderRadius: radius.pill,
    backgroundColor: colors.goldLight,
  },
  feedEmptyBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.night,
  },
  cornerTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12,
  },
  cornerTag: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.raised,
  },
  cornerTagText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
  },
  cornerTagOn: {
    backgroundColor: colors.primarySoft,
  },
  cornerTagTextOn: {
    color: colors.primary,
  },
  cornerEmptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cornerEmpty: {
    marginTop: 18,
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cornerEmptyTitle: {
    marginTop: 10,
    fontFamily: fonts.serifBold,
    fontSize: 18,
    letterSpacing: -0.2,
    color: colors.fg,
    textAlign: 'center',
  },
  cornerEmptyBody: {
    marginTop: 4,
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
  },
  giftCardShort: {
    opacity: 0.55,
  },
  giftNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  giftNoticeError: {
    backgroundColor: colors.negativeFaint,
  },
  giftNoticeOk: {
    backgroundColor: colors.primarySoft,
  },
  giftNoticeText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
});
