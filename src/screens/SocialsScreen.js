import React, { useState, useEffect, useMemo, useRef, useCallback, createContext, useContext } from 'react';
import {
  Animated,
  BackHandler,
  Dimensions,
  Easing,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  Image,
  useWindowDimensions,
} from 'react-native';
import Svg, { Path, Rect, Defs, LinearGradient, Stop } from 'react-native-svg';
import { Icon } from '../components/Icons';
import { colors, fonts, radius, shadow } from '../theme';
import { useStore } from '../store';
import { useSync } from '../api/sync';
import { useNav, useIsFocused } from '../navigation';
import { PEOPLE, CHANNELS_DATA } from '../data/seed';
import ProfileButton from '../components/ProfileButton';
import { PhotoViewer } from '../components/social/FeedCard';
import { LightPostCard, ComposerCard, ReelsStrip, HubCards, PostMenuSheet, reactionOf } from '../components/social/LightFeed';
import CreatePostSheet from '../components/social/CreatePostSheet';
import { TextPostShareSheet, canShareImage } from '../components/social/TextPostCard';
import { SOCIAL, CONTENT_THEMES, parseScriptureRef, passageLabel, timestampOf, relTime, initials } from '../components/social/shared';
import { setSocialsDark, setSocialsImmersive } from '../ui/chrome';
// SOCIAL (round 3): profile links, comment likes, gifts from comments, who-liked lists, activity inbox
import { useApi } from '../api/auth';
import { splitPosts, mapNotification } from '../api/mappers';
import { toggleCommentLike, getCommentLikers, getPostReactors, isServerId } from '../api/social';
import { useOpenProfile } from '../components/social/profileNav';
import GiftSheet from '../components/social/GiftSheet';
import { FeedNativeAd } from '../ads/AdSlots';
import { MemberWebsitesStrip } from './WebsitesScreens'; // MEMBER WEBSITES
import { AD_RULES } from '../ads/config';
import VideoPager from '../components/video/VideoPager';
import VideoViewer from '../components/video/VideoViewer';
import { toPlayable } from '../components/video/videoUtils';
import useFeedVideoPool from '../components/video/useFeedVideoPool'; // FEED VIDEO: 2 shared players for the mixed feed
import PeopleSheet from '../components/social/PeopleSheet';
import { SocialAvatar } from '../components/social/FeedCard';
import { Button, alpha } from '../components/ui';
import { useToast, haptic } from '../components/Toast';
import { useNarration } from '../audio/Narration';
import { refLabel, verseOfDay, getChapter } from '../data/bible';
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

const WHITE = '#FFFFFF';
const GLASS = 'rgba(0,0,0,0.38)';
const GLASS_BORDER = 'rgba(255,255,255,0.16)';
const ON_DARK_MUTED = 'rgba(255,255,255,0.72)';
const TEXT_SHADOW = {
  textShadowColor: 'rgba(0,0,0,0.6)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 3,
};

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

const GIFT_ICONS = {
  g_rose: { name: 'sun', color: colors.rose },
  g_bouquet: { name: 'sparkles', color: colors.primary },
  g_star: { name: 'star', color: colors.gold },
  g_crown: { name: 'cross', color: colors.lavender },
};

// Creator info, caption and the side actions drawn over a video in the full-screen player (VideoPager).
// The player itself (one shared expo-video player, gestures, controls, ads) lives in src/components/video.
function ReelOverlay({
  item,
  index,
  isActive,
  isPlaying,
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
  onOpenCreator,
}) {
  const isTextPost = false;
  // Creator info + caption ease in whenever this reel becomes the active one
  const infoIn = useRef(new Animated.Value(isActive ? 1 : 0)).current;
  useEffect(() => {
    if (isActive) {
      Animated.timing(infoIn, { toValue: 1, duration: 420, delay: 80, easing: EASE_OUT, useNativeDriver: ND }).start();
    } else {
      Animated.timing(infoIn, { toValue: 0, duration: 180, easing: EASE_IN, useNativeDriver: ND }).start();
    }
  }, [isActive]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Bottom gradient for readability */}
      <View style={styles.bottomGradientScrim} pointerEvents="none">
        <Svg width="100%" height={380} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id={`bottomGrad_${item.id}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#000000" stopOpacity="0" />
              <Stop offset="45%" stopColor="#000000" stopOpacity="0.25" />
              <Stop offset="100%" stopColor="#000000" stopOpacity="0.7" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#bottomGrad_${item.id})`} />
        </Svg>
      </View>
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
          <PressScale onPress={onOpenCreator} disabled={!onOpenCreator} scaleTo={0.9} hitSlop={6} accessibilityLabel={`Open ${item.mine ? 'your' : `${item.creator.name}'s`} profile`}>
            {item.creator && item.creator.avatarUrl ? (
              <Image source={{ uri: item.creator.avatarUrl }} style={styles.creatorAvatar} />
            ) : (
              <View style={styles.creatorAvatar}>
                <Text style={styles.creatorAvatarText}>{item.creator?.avatar}</Text>
              </View>
            )}
          </PressScale>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Pressable onPress={onOpenCreator} disabled={!onOpenCreator} hitSlop={4} style={{ flexShrink: 1 }} accessibilityRole="link">
                <Text style={styles.creatorName} numberOfLines={1}>{item.creator.name}</Text>
              </Pressable>
              {item.creator.verified ? (
                <View style={styles.verifiedDot}>
                  <Icon name="check" size={8} color={colors.night} strokeWidth={3.4} />
                </View>
              ) : null}
            </View>
            <Text style={styles.creatorHandle} numberOfLines={1}>
              {[item.creator.label != null ? item.creator.label : item.creator.handle, item.creator.church].filter(Boolean).join(' · ')}
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
    </View>
  );
}


// ─── Unified Socials ─────────────────────────────────────────────
// Facebook-style: "Feed" is a light news feed (composer, Reels strip, posts with For You · Following ·
// Communities · Events chips); "Videos" is the full-screen dark reels player. Also mounted as a route
// (`Socials` / `Feed`) — then it shows a back button and honours params.tab ('feed' | 'videos' |
// 'following'), params.postId (scroll + highlight) and params.initialVideoId.
const SEGMENTS = [
  { id: 'feed', label: 'Feed', icon: 'home' },
  { id: 'videos', label: 'Videos', icon: 'play' },
];
const FEED_CHIPS = ['For You', 'Following', 'Communities', 'Events'];
const EVENT_KINDS = ['Announcement', 'Celebration', 'Event', 'Greeting'];

// Header segmented switch with a sliding pill (light on Feed, dark on Videos)
function SegmentSwitch({ value, onChange, light }) {
  const [w, setW] = useState(0);
  const PAD = 3;
  const tabW = w ? (w - PAD * 2) / SEGMENTS.length : 0;
  const x = useRef(new Animated.Value(0)).current;
  const placed = useRef(false);
  useEffect(() => {
    if (!tabW) return;
    const to = PAD + Math.max(0, SEGMENTS.findIndex((s) => s.id === value)) * tabW;
    if (!placed.current) {
      placed.current = true;
      x.setValue(to);
      return;
    }
    Animated.spring(x, { toValue: to, useNativeDriver: ND, speed: 20, bounciness: 6 }).start();
  }, [value, tabW]);
  return (
    <View style={[styles.segRow, light && styles.segRowLight]} onLayout={(e) => setW(e.nativeEvent.layout.width)} accessibilityRole="tablist">
      {tabW ? <Animated.View pointerEvents="none" style={[styles.segPill, light && styles.segPillLight, { width: tabW, transform: [{ translateX: x }] }]} /> : null}
      {SEGMENTS.map((s) => {
        const on = value === s.id;
        const tint = light ? (on ? colors.primary : colors.muted) : on ? colors.night : colors.nightMuted;
        return (
          <Pressable key={s.id} onPress={() => onChange(s.id)} style={styles.segTab} accessibilityRole="tab" accessibilityState={{ selected: on }}>
            <Icon name={s.icon} size={13} color={tint} strokeWidth={on ? 2.4 : 2} />
            <Text style={[styles.segText, on && styles.segTextOn, light && styles.segTextLight, light && on && styles.segTextLightOn]}>{s.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// FEED (virtualised): the general feed is a FlatList. Every cell reports its offset inside the list content
// here, so the 70%-visible video check stays exact (cell offset + the video's y inside its card) while only a
// window of rows is mounted.
const FeedCellCtx = createContext(null);
function FeedCell({ item, onLayout, children, style, cellKey, index, ...rest }) {
  const report = useContext(FeedCellCtx);
  const handle = (e) => {
    if (onLayout) onLayout(e);
    if (report && item) report(item.key, e.nativeEvent.layout);
  };
  return <View {...rest} style={style} onLayout={handle}>{children}</View>;
}
// FlatList window tuned for low-end Android: few rows per batch, ~3 screens above / below kept mounted.
const FEED_WINDOW = Platform.OS === 'android' ? 7 : 9;
const feedKey = (row) => row.key;
// Rows that don't depend on the playing video never re-render while scrolling
const FeedAdRow = React.memo(function FeedAdRow() { return <FeedNativeAd />; });
const FeedHubRow = React.memo(function FeedHubRow({ guildUnread, onGuild, onCorner }) {
  return <HubCards guildUnread={guildUnread} onGuild={onGuild} onCorner={onCorner} />;
}, (a, b) => a.guildUnread === b.guildUnread);

export default function SocialsScreen({ params }) {
  const routeMode = params != null; // pushed as a route (vs. the Socials tab, which gets no params)
  const p = params || {};
  const { state, dispatch, getState } = useStore();
  const sync = useSync(); // online mode: pull-to-refresh, pagination, comments from the API
  const api = useApi();
  const openProfile = useOpenProfile();
  const nav = useNav();
  const toast = useToast();
  const win = useWindowDimensions(); // live size (rotation, desktop resize) — never the module-load size
  // Full-screen video viewer (feed card / reels strip / deep link). Ads run inside the player (useAdBreaks).
  const [videoViewer, setVideoViewer] = useState(null); // { index } | null
  // Collapsing header: hides on scroll down / shows on scroll up (Feed); overlays the Videos player and
  // hides with its controls. Native driver where supported.
  const [headerH, setHeaderH] = useState(0);
  const [videosChrome, setVideosChrome] = useState(true);
  const feedScroll = useRef(new Animated.Value(0)).current;
  const feedHeaderY = useMemo(() => {
    const h = Math.max(1, headerH);
    const y = feedScroll.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolateLeft: 'clamp' });
    return Animated.diffClamp(y, 0, h).interpolate({ inputRange: [0, h], outputRange: [0, -h], extrapolate: 'clamp' });
  }, [headerH]);
  const videoHeaderY = useRef(new Animated.Value(0)).current;
  const headerRef = useRef(null);
  // web: read the header height straight from the DOM too (onLayout can lag behind a re-layout)
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    try {
      const n = headerRef.current;
      const h = n && n.getBoundingClientRect ? Math.round(n.getBoundingClientRect().height) : 0;
      if (h && Math.abs(h - headerH) > 1) setHeaderH(h);
    } catch (e) { /* ignore */ }
  });
  const nar = useNarration();
  const focused = useIsFocused(); // false while another screen is on top — pauses video

  const [segment, setSegment] = useState(p.tab === 'videos' || p.initialVideoId ? 'videos' : 'feed');
  const [chip, setChip] = useState(p.tab === 'following' ? 'Following' : 'For You');
  const [menuKey, setMenuKey] = useState(null); // feed item whose ⋯ menu is open
  const [mainTab, setMainTab] = useState('home'); // 'home' | 'guild' | 'creators'
  const [bodyHeight, setBodyHeight] = useState(SCREEN_HEIGHT - 230);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedId, setSelectedId] = useState(null); // video the gift sheet is for
  const [commentTarget, setCommentTarget] = useState(null); // { src: 'post' | 'video', id }
  const [showGiftStore, setShowGiftStore] = useState(false);
  const [giftTarget, setGiftTarget] = useState(null); // { userId, name, videoId?, postId?, commentId? }
  const [likers, setLikers] = useState(null); // { title, eyebrow, load, footer } — "who liked" sheet
  const [focusComment, setFocusComment] = useState(null); // comment opened from a notification
  const reopenComments = useRef(null); // comments sheet to restore after a gift / likes sheet closes
  const commentScroll = useRef(null);
  const [commentText, setCommentText] = useState('');
  const [replyingTo, setReplyingTo] = useState(null);
  const [composer, setComposer] = useState(null); // null | { mode, bounty?, preset? }
  const [shareCard, setShareCard] = useState(null); // designed text post offered as a share image (native)
  const [cornerCat, setCornerCat] = useState('All');
  const [viewer, setViewer] = useState(null); // { images, start }
  const [highlightKey, setHighlightKey] = useState(null);
  const [visibleVideoKey, setVisibleVideoKey] = useState(null);
  const [nextVideoKey, setNextVideoKey] = useState(null); // FEED VIDEO: the next video below (preloaded)
  const mediaLayouts = useRef({}); // FEED VIDEO: card key → { y, h } of the video inside its card

  const reelsRef = useRef(null);
  const feedRef = useRef(null);
  const layouts = useRef({}); // feed row key → { y, h } inside the feed list content (measured rows)
  const viewableKeys = useRef([]); // FEED: post-row keys the FlatList reports as on screen (viewability)
  const mostlyVisible = useRef(new Set()); // FEED: rows >= 70% visible (list's own check, used until measured)
  const appeared = useRef(new Set()); // FEED: cards that already played their entry animation once
  const scrollY = useRef(0);
  const pendingScroll = useRef(null);

  // Brief celebratory card after publishing a video
  const [published, setPublished] = useState(null);
  useEffect(() => {
    if (!published) return undefined;
    const t = setTimeout(() => setPublished(null), 2000);
    return () => clearTimeout(t);
  }, [published]);

  // Clear a highlight after it has played so the same card can glow again later
  useEffect(() => {
    if (!highlightKey) return undefined;
    const t = setTimeout(() => setHighlightKey(null), 2600);
    return () => clearTimeout(t);
  }, [highlightKey]);

  // Dark chrome (page background, status bar, tab bar) only while the full-screen reels — or the
  // night-themed guild reached from them — are on screen and this screen is focused. Light otherwise.
  // Only the instance that turned it on turns it off, so a covered Socials tab can't clobber a pushed one.
  const wantDark = focused && (mainTab === 'guild' || (mainTab === 'home' && segment === 'videos'));
  const ownsDark = useRef(false);
  useEffect(() => {
    if (wantDark) {
      setSocialsDark(true);
      ownsDark.current = true;
    } else if (ownsDark.current || focused) {
      setSocialsDark(false);
      ownsDark.current = false;
    }
  }, [wantDark, focused]);
  useEffect(() => () => { if (ownsDark.current) setSocialsDark(false); }, []);
  // Immersive Videos: App.js hides the bottom tab bar and mini-player while the Videos section is showing
  const wantImmersive = focused && mainTab === 'home' && segment === 'videos';
  const ownsImmersive = useRef(false);
  useEffect(() => {
    if (wantImmersive) { setSocialsImmersive(true); ownsImmersive.current = true; }
    else if (ownsImmersive.current || focused) { setSocialsImmersive(false); ownsImmersive.current = false; }
  }, [wantImmersive, focused]);
  useEffect(() => () => { if (ownsImmersive.current) setSocialsImmersive(false); }, []);
  // Android back button closes the Videos section (back to the Feed) when Socials is the tab itself
  useEffect(() => {
    if (!wantImmersive || routeMode || videoViewer) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setSegment('feed'); return true; });
    return () => sub.remove();
  }, [wantImmersive, routeMode, videoViewer]);

  // Videos: the overlaid header slides away with the player controls and comes back with them
  const showVideoHeader = segment !== 'videos' || videosChrome;
  useEffect(() => {
    Animated.timing(videoHeaderY, { toValue: showVideoHeader ? 0 : -Math.max(1, headerH) - 8, duration: showVideoHeader ? 220 : 320, easing: showVideoHeader ? EASE_OUT : EASE_IN, useNativeDriver: ND }).start();
  }, [showVideoHeader, headerH]);
  useEffect(() => { setVideosChrome(true); }, [segment]);

  // ─── Data ──────────────────────────────────────────────────────
  const videos = state.videos || [];
  const feed = state.feed || [];
  const follows = state.follows || [];
  const reelVideos = useMemo(() => videos.filter((v) => v.videoUrl), [videos]);
  const communityNames = (state.communities || []).map((c) => c.name);

  const myAvatar = (state.user && state.user.avatarUrl) || null;
  // FEED: one view-model object per store object (cached), so liking one post re-renders one card, not all
  const itemCache = useRef({ comm: undefined, avatar: undefined, map: new WeakMap() });
  const allItems = useMemo(() => {
    const now = Date.now();
    const cache = itemCache.current;
    if (cache.comm !== state.communities || cache.avatar !== myAvatar) {
      cache.map = new WeakMap();
      cache.comm = state.communities;
      cache.avatar = myAvatar;
    }
    const cached = (raw, idx, make) => {
      const hit = cache.map.get(raw);
      if (hit && hit.idx === idx) return hit.item;
      const item = make(raw, idx);
      cache.map.set(raw, { idx, item });
      return item;
    };
    const fromPost = (f) => {
      const ts = timestampOf(f, now);
      const person = PEOPLE.find((x) => x.name === f.author);
      const images = Array.isArray(f.images) && f.images.length ? f.images : f.image ? [f.image] : [];
      return {
        key: 'p_' + f.id,
        src: 'post',
        id: f.id,
        name: f.author || 'Believer',
        verified: !!f.authorVerified || !!(person && person.verified && person.verified.length),
        sub: f.mine ? null : f.authorSub || (person ? person.username : communityNames.includes(f.author) ? 'Community' : null),
        handle: f.authorHandle || null, // online: '@handle' of the server author (followable)
        authorId: f.authorId || null,
        avatarUrl: f.mine ? myAvatar : f.authorAvatarUrl || null,
        time: f.createdAt ? relTime(ts) : f.time,
        ts,
        kind: f.kind || 'Post',
        text: f.text || '',
        images,
        passage: f.passage || null,
        scripture: f.passage ? passageLabel(f.passage) : '',
        quoteBg: f.bg || null,
        likes: f.likes || 0,
        liked: !!f.liked,
        reaction: f.reaction || null,
        comments: f.comments || 0,
        shares: f.shares || 0,
        saved: !!f.saved,
        mine: !!f.mine,
        raw: f,
      };
    };
    const fromVideo = (v, idx) => {
      // Seed reels carry no timestamp — space them between the seed posts
      const ts = timestampOf(v, now) || now - (idx * 5 + 2) * 3600e3;
      const isText = !v.videoUrl && !v.imageUrl && !v.processing && !v.videoStatus;
      return {
        key: 'v_' + v.id,
        src: 'video',
        id: v.id,
        name: (v.creator && v.creator.name) || 'Creator',
        avatarText: v.creator && v.creator.avatar,
        verified: !!(v.creator && v.creator.verified),
        handle: v.creator && v.creator.handle,
        authorId: (v.creator && v.creator.userId) || v.authorId || null,
        avatarUrl: v.mine ? myAvatar : (v.creator && v.creator.avatarUrl) || null,
        sub: v.creator && (v.creator.label != null ? v.creator.label || null : v.creator.handle), // online: '@handle' or nothing
        time: relTime(ts),
        ts,
        kind: v.videoUrl || v.processing ? v.category || 'Video' : v.imageUrl ? 'Photo' : v.category || 'Post',
        text: v.caption || '',
        images: v.imageUrl ? [v.imageUrl] : [],
        videoUrl: v.videoUrl || null,
        duration: v.duration,
        scripture: v.scripture || '',
        quoteBg: isText ? v.bg || colors.night : null,
        likes: Number(v.likes) || 0,
        liked: !!v.liked,
        reaction: v.reaction || null,
        comments: v.commentCount != null ? Math.max(v.commentCount, (v.comments || []).length) : (v.comments || []).length,
        shares: v.shares,
        gifts: v.gifts,
        processing: (!!v.processing || v.videoStatus === 'uploading') && !v.uploadFailed, // online: still uploading / not ready yet
        uploadProgress: v.uploadProgress,
        // FEED VIDEO: failed / interrupted upload (author sees Retry), probe info and the clip's real size
        uploadFailed: !!v.uploadFailed,
        uploadError: v.uploadError || null,
        codec: v.codec || null,
        videoWidth: v.videoWidth || null,
        videoHeight: v.videoHeight || null,
        poster: v.poster || null,
        videoError: !!v.videoError,
        saved: !!v.saved,
        mine: !!v.mine,
        raw: v,
      };
    };
    return [...feed.map((f) => cached(f, 0, fromPost)), ...videos.map((v, i) => cached(v, i, fromVideo))].sort((a, b) => b.ts - a.ts);
  }, [feed, videos, state.communities, myAvatar]);

  const followedPeople = PEOPLE.filter((x) => follows.includes(x.id)).map((x) => x.name);
  const joinedCommunities = (state.communities || []).filter((c) => c.joined === true).map((c) => c.name);
  const joinedChannelNames = (state.channels || CHANNELS_DATA)
    .filter((c) => (state.joinedChannels || []).includes(c.id) || follows.includes(c.id))
    .map((c) => c.name);
  const isFollowed = (it) =>
    it.mine ||
    (it.src === 'video'
      ? follows.includes(it.handle)
      : (it.handle && follows.includes(it.handle)) || followedPeople.includes(it.name) || joinedCommunities.includes(it.name) || joinedChannelNames.includes(it.name));
  // Chips port the old Feed filters: Communities = posts by communities / churches / groups / channels,
  // Events = announcements, celebrations, events and greetings. Hidden posts (⋯ → Hide) are skipped.
  const hidden = state.hiddenPosts || [];
  const allChannelNames = (state.channels || CHANNELS_DATA).map((c) => c.name);
  const isCommunity = (it) => it.src === 'post' && (communityNames.includes(it.name) || allChannelNames.includes(it.name));
  const passesChip = (it, c = chip) =>
    c === 'Following' ? isFollowed(it) : c === 'Communities' ? isCommunity(it) : c === 'Events' ? EVENT_KINDS.includes(it.kind) : true;
  // memoised so the FlatList data (and its rows) only change when the posts / filters do
  const listItems = useMemo(
    () => allItems.filter((it) => !hidden.includes(it.key) && passesChip(it)),
    [allItems, hidden, chip, follows, state.communities, state.channels, state.joinedChannels],
  );
  const listItemsRef = useRef(listItems);
  listItemsRef.current = listItems;
  const itemByKey = useMemo(() => new Map(listItems.map((it) => [it.key, it])), [listItems]);
  const feedItemByKey = useRef(itemByKey);
  feedItemByKey.current = itemByKey;
  const feedRowsRef = useRef([]);

  const activeVideo = videos.find((v) => v.id === selectedId) || reelVideos[activeIndex] || videos[0];

  // ─── Navigation inside the screen ──────────────────────────────
  const scrollFeedTo = (key) => {
    const l = layouts.current[key];
    const list = feedRef.current;
    if (l && list) {
      try { list.scrollToOffset({ offset: Math.max(0, l.y - headerH - 10), animated: true }); } catch (e) {}
      pendingScroll.current = null;
      scrollRetries.current = 0;
    } else {
      // not mounted yet (virtualised): jump near its row; the exact scroll happens when the cell reports its layout
      pendingScroll.current = key;
      const index = feedRowsRef.current.findIndex((r) => r.key === key);
      if (list && index >= 0) {
        try { list.scrollToIndex({ index, viewOffset: headerH + 10, animated: false }); } catch (e) {}
      }
    }
    setHighlightKey(key);
  };
  // scrollToIndex on a row that was never measured: go to the estimate, the cell layout finishes the job
  const scrollRetries = useRef(0);
  const onScrollToIndexFailed = useCallback((info) => {
    try { feedRef.current && feedRef.current.scrollToOffset({ offset: Math.max(0, info.averageItemLength * info.index), animated: false }); } catch (e) {}
    // still not mounted after the estimate → try again a few times while rows render in
    if (scrollRetries.current++ < 4) setTimeout(() => { const k = pendingScroll.current; if (k && !layouts.current[k]) H.current.scrollFeedTo(k); }, 160);
  }, []);

  const goFeedPost = (key) => {
    setMainTab('home');
    setSegment('feed');
    // Your own posts always show in For You / Following; other chips may filter them out
    setChip((c) => (c === 'For You' || c === 'Following' ? c : 'For You'));
    setTimeout(() => scrollFeedTo(key), 60);
  };

  // Tapping a video anywhere opens the full-screen viewer at that clip and it plays straight away
  // (pre-roll / mid-roll ads, if any, are run by the player through useAdBreaks — not here).
  const openReelAt = (videoId) => {
    const idx = reelVideos.findIndex((v) => v.id === videoId);
    if (idx < 0) {
      toast.show('This video isn’t ready to play yet', { icon: 'video' });
      return;
    }
    setActiveIndex(idx);
    setSelectedId(reelVideos[idx].id);
    setMainTab('home');
    setVideoViewer({ index: idx });
  };
  const playableVideos = useMemo(() => reelVideos.map(toPlayable), [reelVideos]);

  // Deep links: Profile → creator video, or a specific post (route mode)
  useEffect(() => {
    if (p.initialVideoId) {
      openReelAt(p.initialVideoId);
      return;
    }
    if (p.postId) {
      let alive = true;
      const go = () => {
        const s = getState();
        const isPost = (s.feed || []).some((f) => f.id === p.postId);
        const isVideo = (s.videos || []).some((v) => v.id === p.postId);
        if (p.tab === 'videos' && isVideo) openReelAt(p.postId);
        else if (isPost || isVideo) {
          if (segment === 'videos') setSegment('feed');
          const key = (isPost ? 'p_' : 'v_') + p.postId;
          const target = allItems.find((it) => it.key === key);
          if (target && !passesChip(target)) setChip('For You');
          setTimeout(() => scrollFeedTo(key), 350);
          // From a notification: open the thread with that comment highlighted
          if (p.commentId) {
            setTimeout(() => {
              if (!alive) return;
              setFocusComment(p.commentId);
              openComments(isPost ? 'post' : 'video', p.postId);
            }, 650);
          }
        } else toast.show('That post is no longer available', { icon: 'socials' });
      };
      const s0 = getState();
      const known = (s0.feed || []).some((f) => f.id === p.postId) || (s0.videos || []).some((v) => v.id === p.postId);
      if (!known && sync.online && isServerId(p.postId)) {
        // Older posts (not on the first feed page) are fetched on demand
        api.request('GET', `/posts/${p.postId}`).then((post) => {
          if (!alive) return;
          const sp = splitPosts([post]);
          if (sp.feed.length) dispatch({ type: 'appendItems', slice: 'feed', items: sp.feed, local: true });
          if (sp.videos.length) dispatch({ type: 'appendItems', slice: 'videos', items: sp.videos, local: true });
          setTimeout(() => { if (alive) go(); }, 60);
        }).catch(() => { if (alive) toast.show('That post is no longer available', { icon: 'socials' }); });
      } else go();
      return () => { alive = false; };
    }
    return undefined;
  }, [p.initialVideoId, p.postId, p.commentId]);

  const switchSegment = (id) => {
    if (id === segment) {
      // Re-tapping the active segment scrolls back to the top
      if (id === 'videos') {
        setActiveIndex(0);
        try { reelsRef.current && reelsRef.current.scrollToOffset({ offset: 0, animated: true }); } catch (e) {}
      } else {
        try { feedRef.current && feedRef.current.scrollToOffset({ offset: 0, animated: true }); } catch (e) {}
      }
      return;
    }
    haptic('select');
    layouts.current = {};
    scrollY.current = 0;
    setVisibleVideoKey(null);
    setSegment(id);
  };

  const switchChip = (c) => {
    if (c === chip) return;
    haptic('select');
    setVisibleVideoKey(null);
    setChip(c);
    try { feedRef.current && feedRef.current.scrollToOffset({ offset: 0, animated: false }); } catch (e) {}
  };

  // FEED VIDEO: which video is >= ~70% visible (only that one autoplays, muted) and which one comes next.
  // Candidates are the rows the FlatList reports as on screen (viewability config below); for those the video
  // itself is measured (cell offset + the video's y inside the card — not the whole card, whose caption /
  // actions would skew it). Until a row is measured the list's own "70% of the row" check stands in.
  const playable = (it) => !!(it && it.videoUrl && !it.processing && !it.uploadFailed);
  const pickVisibleVideo = () => {
    const top = scrollY.current;
    const bottom = top + bodyHeight;
    const byKey = feedItemByKey.current;
    let best = null;
    let bestVis = 0;
    viewableKeys.current.forEach((key) => {
      const it = byKey.get(key);
      if (!playable(it)) return;
      const l = layouts.current[key];
      let vis;
      if (l) {
        const m = mediaLayouts.current[key];
        const vy = m ? l.y + m.y : l.y;
        const vh = m ? m.h : l.h;
        vis = Math.max(0, Math.min(vy + vh, bottom) - Math.max(vy, top)) / Math.max(1, Math.min(vh, bodyHeight));
      } else vis = mostlyVisible.current.has(key) ? 0.7 : 0;
      if (vis > bestVis) { bestVis = vis; best = key; }
    });
    const next = bestVis >= 0.7 ? best : null;
    setVisibleVideoKey((cur) => (cur === next ? cur : next));
    // preload the first video below the playing one (or, when none plays, the next one coming into view)
    const items = listItemsRef.current;
    let from = -1;
    if (next) from = items.findIndex((it) => it.key === next) + 1;
    else if (viewableKeys.current.length) {
      const firstKey = viewableKeys.current[0];
      from = Math.max(0, items.findIndex((it) => it.key === firstKey));
    }
    let after = null;
    if (from >= 0) {
      for (let i = from; i < items.length && i < from + 12; i++) {
        if (playable(items[i]) && items[i].key !== next) { after = items[i].key; break; }
      }
    }
    setNextVideoKey((cur) => (cur === after ? cur : after));
  };
  const onMediaLayout = (key, y, h) => {
    mediaLayouts.current[key] = { y, h };
    pickVisibleVideo();
  };

  // Cell offsets inside the list content, reported by FeedCell (the FlatList CellRendererComponent)
  const onCellLayout = (key, layout) => {
    layouts.current[key] = { y: layout.y, h: layout.height };
    if (pendingScroll.current === key) {
      const k = key;
      setTimeout(() => scrollFeedTo(k), 30);
    }
    pickVisibleVideo();
  };

  // ─── Reels viewability ─────────────────────────────────────────
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 });
  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    if (viewableItems && viewableItems.length > 0) {
      const active = viewableItems[0];
      if (active && active.index !== undefined && active.index !== null) {
        setActiveIndex(active.index);
        if (active.item) setSelectedId(active.item.id);
      }
    }
  });

  // ─── Guild ─────────────────────────────────────────────────────
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
      user: (state.user && state.user.displayName) || 'Believer Creator',
      role: 'Content Creator',
      time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text: guildInput.trim(),
    };
    dispatch({ type: 'set', patch: { guildMessages: { ...guildStore, [guildChannel]: [...guildMessages, newM] } } });
    setGuildInput('');
    haptic('light');
  };

  // ─── Actions ───────────────────────────────────────────────────
  const shareText = async (message, okLabel = 'Shared') => {
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && !navigator.share) throw new Error('no web share');
      const res = await Share.share({ message });
      if (!res || res.action !== Share.dismissedAction) {
        toast.show(okLabel, { icon: 'share', haptic: 'success' });
        return true;
      }
      return false;
    } catch (e) {
      // Web without the Web Share API: fall back to copying the text
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(message);
          toast.show('Copied to clipboard', { icon: 'check', haptic: 'success' });
          return true;
        }
      } catch (err) { /* clipboard blocked */ }
      toast.show('Sharing isn’t available on this device', { tone: 'error' });
      return false;
    }
  };

  const patchVideo = (id, fn) => {
    dispatch({ type: 'set', patch: { videos: (state.videos || []).map((v) => (v.id === id ? { ...v, ...fn(v) } : v)) } });
  };
  const patchPost = (id, fn) => {
    dispatch({ type: 'set', patch: { feed: (state.feed || []).map((f) => (f.id === id ? { ...f, ...fn(f) } : f)) } });
  };

  const openScripture = (ref) => {
    const passage = typeof ref === 'string' ? parseScriptureRef(ref) : ref;
    if (!passage) {
      toast.show(`Couldn’t find “${ref || 'that passage'}”`, { tone: 'error' });
      return;
    }
    nav.push('Bible', passage);
  };

  const listenScripture = (item) => {
    const ref = parseScriptureRef(item && item.scripture);
    if (!ref) {
      toast.show('No scripture to read aloud', { tone: 'error' });
      return;
    }
    if (ref.verse) nar.playVerse(ref.bookId, ref.chapter, ref.verse, { translation: state.translation });
    else nar.playChapter(ref.bookId, ref.chapter, { translation: state.translation });
    toast.show(`Listening to ${refLabel(ref.bookId, ref.chapter, ref.verse)}`, { icon: 'audio', action: { label: 'Player', onPress: () => nar.openPlayer() } });
  };

  // Follow a creator (video) or, online, the author of a post — both are keyed by '@handle'
  const handleFollow = (target) => {
    const handle = target && (target.creator ? target.creator.handle : target.authorHandle || target.handle);
    const name = target && (target.creator ? target.creator.name : target.author || target.name);
    if (!handle) return;
    const was = follows.includes(handle);
    dispatch({ type: 'follow', id: handle });
    toast.show(was ? `Unfollowed ${name}` : `Following ${name}`, {
      icon: was ? 'user' : 'check',
      haptic: was ? 'light' : 'success',
    });
  };

  const handleShareVideo = async (video) => {
    const ref = video.scripture ? ` (${video.scripture})` : '';
    const ok = await shareText(`${video.creator && video.creator.name} on BibleNestra: “${video.caption}”${ref}`);
    if (ok) dispatch({ type: 'sharePost', src: 'video', id: video.id });
  };

  const handleSharePost = async (f, opts = {}) => {
    // Image-style text posts: offer the designed card as an image on native (web shares text / link)
    if (!opts.asText && f && f.bg && f.text && canShareImage) {
      setShareCard(f);
      return false;
    }
    const ok = await shareText(`${f.author}: ${f.text || 'Photo post'}${f.passage ? `\n— ${passageLabel(f.passage)}` : ''}\n\nShared from BibleNestra`);
    if (ok) dispatch({ type: 'sharePost', src: 'post', id: f.id });
    return ok;
  };

  const handleRepost = (video) => {
    const postId = 'rp_' + video.id;
    if (video.reposted) {
      dispatch({ type: 'deletePost', id: postId });
      patchVideo(video.id, (v) => ({ reposted: false, reposts: Math.max(0, (v.reposts || 0) - 1) }));
      toast.show('Repost removed', { icon: 'repost' });
      return;
    }
    const passage = parseScriptureRef(video.scripture);
    dispatch({
      type: 'post',
      post: {
        id: postId,
        createdAt: Date.now(),
        kind: 'Repost',
        text: `Reposted from ${video.creator && video.creator.name}: “${video.caption}”`,
        ...(passage ? { passage } : {}),
      },
    });
    patchVideo(video.id, (v) => ({ reposted: true, reposts: (v.reposts || 0) + 1 }));
    toast.show('Reposted to your feed', { icon: 'repost', haptic: 'success', action: { label: 'View', onPress: () => goFeedPost('p_' + postId) } });
  };

  const likeItem = (it, fromDoubleTap) => {
    if (fromDoubleTap && it.liked) return;
    haptic(it.liked ? 'light' : 'success');
    if (it.liked && it.reaction) {
      // Un-reacting clears the stored reaction too (the plain like actions only flip `liked`)
      dispatch({ type: 'react', src: it.src, id: it.id, reaction: null });
      return;
    }
    if (it.src === 'video') dispatch({ type: 'likeVideo', id: it.id });
    else dispatch({ type: 'like', id: it.id });
  };

  // Long-press reactions (Amen / Love / Praise / Care), persisted on the post or video
  const reactItem = (it, key) => {
    const r = reactionOf(key);
    if (!r) return;
    const same = it.liked && it.reaction === key;
    dispatch({ type: 'react', src: it.src, id: it.id, reaction: same ? null : key });
    haptic(same ? 'light' : 'success');
    if (!same) toast.show(`${r.emoji}  ${r.label}`, { icon: 'heart' });
  };

  const hideItem = (it) => {
    dispatch({ type: 'hidePost', key: it.key, hidden: true });
    toast.show('Post hidden', {
      icon: 'x',
      action: { label: 'Undo', onPress: () => dispatch({ type: 'hidePost', key: it.key, hidden: false }) },
    });
  };

  const saveItem = (it) => {
    dispatch({ type: 'savePost', src: it.src, id: it.id });
    toast.show(it.saved ? 'Removed from saved' : 'Saved', { icon: 'bookmark', haptic: it.saved ? 'light' : 'success' });
  };

  const deleteItem = (it) => {
    if (it.src === 'video') {
      const list = state.videos || [];
      const idx = list.findIndex((v) => v.id === it.id);
      const v = list[idx];
      dispatch({ type: 'deletePost', src: 'video', id: it.id });
      toast.show('Video deleted', {
        icon: 'trash',
        action: { label: 'Undo', onPress: () => dispatch({ type: 'restorePost', src: 'video', item: v, index: idx }) },
      });
      return;
    }
    const list = state.feed || [];
    const idx = list.findIndex((x) => x.id === it.id);
    const f = list[idx];
    dispatch({ type: 'deletePost', src: 'post', id: it.id });
    const repostOf = String((f && f.localId) || it.id);
    if (repostOf.startsWith('rp_')) patchVideo(repostOf.slice(3), (v) => ({ reposted: false, reposts: Math.max(0, (v.reposts || 0) - 1) }));
    toast.show('Post deleted', {
      icon: 'trash',
      action: { label: 'Undo', onPress: () => dispatch({ type: 'restorePost', src: 'post', item: f, index: idx }) },
    });
  };

  const openComments = (src, id) => {
    if (src === 'video') setSelectedId(id);
    setReplyingTo(null);
    setCommentText('');
    setCommentTarget({ src, id });
    if (sync.online) sync.loadComments(src, id); // fresh thread from the server
  };

  const openGifts = (videoId) => {
    setSelectedId(videoId);
    const v = videos.find((x) => x.id === videoId);
    if (!v || !v.creator) return;
    if (v.mine) { toast.show('You can’t send a gift to yourself', { icon: 'gift' }); return; }
    setGiftTarget({ userId: v.authorId || v.creator.userId || null, name: v.creator.name, videoId: v.id, postId: v.id });
    setShowGiftStore(true);
  };

  // ─── Profiles, comment likes & comment gifts (SOCIAL r3) ───────
  const openItemAuthor = (it) => openProfile({ userId: it.authorId, name: it.name, handle: it.handle, mine: it.mine });
  // Modals can't stack on native: close the comments sheet first, restore it after a sub-sheet closes
  const fromComments = (fn) => {
    reopenComments.current = commentTarget;
    setCommentTarget(null);
    setTimeout(fn, 240);
  };
  const restoreComments = () => {
    const t = reopenComments.current;
    reopenComments.current = null;
    if (t) setTimeout(() => setCommentTarget(t), 240);
  };
  const openCommenter = (c) => {
    reopenComments.current = null;
    setCommentTarget(null);
    setTimeout(() => openProfile({ userId: c.authorId, name: c.from, mine: c.mine }), 200);
  };
  const commentSlice = () => (commentTarget && commentTarget.src === 'video' ? ['videos', 'comments'] : ['feed', 'commentList']);
  const patchComment = (postId, commentId, fn) => {
    const [slice, field] = commentSlice();
    const item = (getState()[slice] || []).find((x) => x.id === postId);
    if (!item) return;
    const list = (item[field] || []).map((x) => (x.id === commentId ? fn(x) : x.replies && x.replies.some((r) => r.id === commentId) ? { ...x, replies: x.replies.map((r) => (r.id === commentId ? fn(r) : r)) } : x));
    dispatch({ type: 'patchItem', slice, id: postId, patch: { [field]: list }, local: true });
  };
  const likeComment = async (c) => {
    if (!commentItem) return;
    const postId = commentItem.id;
    const was = !!c.liked;
    haptic(was ? 'light' : 'success');
    patchComment(postId, c.id, (x) => ({ ...x, liked: !was, likes: Math.max(0, (Number(x.likes) || 0) + (was ? -1 : 1)) }));
    if (!sync.online) return;
    if (!isServerId(c.id)) return; // still being posted
    try {
      const r = await toggleCommentLike(api.request, c.id);
      patchComment(postId, c.id, (x) => ({ ...x, liked: !!r.liked, likes: r.likes }));
    } catch (e) {
      patchComment(postId, c.id, (x) => ({ ...x, liked: was, likes: Math.max(0, (Number(x.likes) || 0) + (was ? 1 : -1)) }));
      toast.show(`Couldn’t update your like${e && e.code === 'NETWORK' ? ' — you seem to be offline' : ''}`, { tone: 'error' });
    }
  };
  const meName = (state.user && state.user.displayName) || 'You';
  const localLikers = (liked, total, reaction) => async () => (liked ? [{ id: 'me', name: meName, isMe: true, avatarUrl: myAvatar, reaction }] : []);
  const othersNote = (liked, total) => {
    const others = Math.max(0, (Number(total) || 0) - (liked ? 1 : 0));
    return others ? `${liked ? 'And ' : ''}${others} ${liked ? (others === 1 ? 'other' : 'others') : others === 1 ? 'person' : 'people'}` : null;
  };
  const openCommentLikers = (c) => fromComments(() => setLikers({
    title: `${c.likes || 0} ${(c.likes || 0) === 1 ? 'like' : 'likes'}`,
    eyebrow: `On ${c.mine ? 'your' : `${c.from}'s`} comment`,
    load: sync.online && isServerId(c.id) ? () => getCommentLikers(api.request, c.id) : localLikers(c.liked, c.likes),
    footer: sync.online ? null : othersNote(c.liked, c.likes),
  }));
  const openPostLikers = (it) => setLikers({
    title: `${it.likes} ${it.likes === 1 ? 'reaction' : 'reactions'}`,
    eyebrow: `On ${it.mine ? 'your' : `${it.name}'s`} post`,
    load: sync.online && isServerId(it.id) ? () => getPostReactors(api.request, it.id) : localLikers(it.liked, it.likes, it.reaction),
    footer: sync.online ? null : othersNote(it.liked, it.likes),
  });
  const giftComment = (c) => {
    if (!commentItem) return;
    const postId = commentItem.id;
    fromComments(() => {
      setGiftTarget({ userId: c.authorId || null, name: c.from, postId, commentId: c.id });
      setShowGiftStore(true);
    });
  };
  const closeGifts = () => {
    setShowGiftStore(false);
    restoreComments();
  };

  // Activity inbox badge: refresh the in-app notifications while Socials is on screen (online)
  const unreadActivity = (state.notificationsList || []).filter((n) => !n.read).length;
  useEffect(() => {
    if (!sync.online || !focused) return undefined;
    let alive = true;
    const pull = () => api.request('GET', '/me/notifications?limit=30').then((r) => {
      if (alive) dispatch({ type: 'serverSync', patch: { notificationsList: (r.items || []).map(mapNotification) }, local: true });
    }).catch(() => {});
    pull();
    const t = setInterval(pull, 45000);
    return () => { alive = false; clearInterval(t); };
  }, [sync.online, focused]);

  // Reply · ♥ like (count → who liked) · Gift (not on your own comments)
  const renderCommentBar = (c, root) => {
    const likes = Number(c.likes) || 0;
    const pending = sync.online && !isServerId(c.id);
    return (
      <View style={styles.commentBar}>
        {root ? (
          <PressScale onPress={() => setReplyingTo(c)} hitSlop={8} scaleTo={0.92} accessibilityLabel={`Reply to ${c.from}`}>
            <Text style={[styles.replyActionText, replyingTo && replyingTo.id === c.id && { color: colors.primary }]}>Reply</Text>
          </PressScale>
        ) : null}
        <View style={styles.commentLike}>
          <PressScale onPress={() => likeComment(c)} disabled={pending} hitSlop={8} scaleTo={0.8} accessibilityLabel={c.liked ? 'Unlike comment' : 'Like comment'} accessibilityState={{ selected: !!c.liked }}>
            <Pop trigger={!!c.liked} amount={1.35}>
              <Icon name="heart" size={14} color={c.liked ? colors.rose : colors.muted} fill={c.liked ? colors.rose : 'none'} />
            </Pop>
          </PressScale>
          <Pressable onPress={() => openCommentLikers(c)} disabled={!likes} hitSlop={8} accessibilityLabel={likes ? `${likes} ${likes === 1 ? 'like' : 'likes'} · see who liked` : 'No likes yet'}>
            <AnimatedNumber value={likes} duration={300} style={[styles.commentLikeCount, c.liked && { color: colors.rose }, !likes && { color: colors.faint }]} />
          </Pressable>
        </View>
        {!c.mine ? (
          <PressScale onPress={() => giftComment(c)} disabled={pending} hitSlop={8} scaleTo={0.9} style={styles.commentGift} accessibilityLabel={`Send ${c.from} a gift`}>
            <Icon name="gift" size={13} color={colors.gold} />
            <Text style={styles.commentGiftText}>Gift</Text>
          </PressScale>
        ) : null}
      </View>
    );
  };

  // Comments sheet works for both feed posts and videos
  const commentSrc = commentTarget && commentTarget.src;
  const commentItem = commentTarget
    ? commentSrc === 'video'
      ? videos.find((v) => v.id === commentTarget.id)
      : feed.find((f) => f.id === commentTarget.id)
    : null;
  const commentList = commentItem ? (commentSrc === 'video' ? commentItem.comments || [] : commentItem.commentList || []) : [];
  const shownCount = commentList.reduce((n, c) => n + 1 + ((c.replies && c.replies.length) || 0), 0);
  const commentCount = commentSrc === 'video' ? commentList.length : Math.max((commentItem && commentItem.comments) || 0, shownCount);
  const earlierCount = commentSrc === 'post' ? Math.max(0, commentCount - shownCount) : 0;

  const handleAddComment = () => {
    const text = commentText.trim();
    if (!text || !commentItem) return;
    if (commentSrc === 'video') {
      dispatch({ type: 'commentVideo', id: commentItem.id, text, replyTo: replyingTo ? replyingTo.id : null });
    } else {
      const me = (state.user && state.user.displayName) || 'You';
      const c = { id: (replyingTo ? 'pr' : 'pc') + Date.now(), from: me, text, time: 'Just now', replies: [], mine: true };
      dispatch({ type: 'commentPost', id: commentItem.id, text, comment: c, parentId: replyingTo ? replyingTo.id : null });
    }
    setCommentText('');
    setReplyingTo(null);
    toast.show(replyingTo ? 'Reply posted' : 'Comment posted', { icon: 'chat', haptic: 'success' });
  };

  // Online: pull-to-refresh reloads the feed, videos and counts from the server
  const [pulling, setPulling] = useState(false);
  const pullRefresh = async () => {
    setPulling(true);
    try { await sync.refresh(); } finally { setPulling(false); }
  };

  // ─── Publishing ────────────────────────────────────────────────
  const me = () => ({
    name: (state.user && state.user.displayName) || 'You',
    handle: state.user && state.user.username ? `@${state.user.username}` : '@me',
    verified: true,
    avatar: initials((state.user && state.user.displayName) || 'You'),
    church: (state.user && state.user.church && state.user.church.name) || 'Local Church',
  });

  const openComposer = (mode = 'text', extra = {}) => {
    haptic('light');
    if (mode === 'verse') {
      // Verse quick action: a quote-card post pre-filled with today's verse
      const v = verseOfDay(new Date());
      const line = (getChapter(state.translation, v.bookId, v.chapter) || [])[v.verse - 1];
      const text = typeof line === 'string' ? line : (line && line.text) || '';
      setComposer({ mode: 'text', preset: { verse: { ref: refLabel(v.bookId, v.chapter, v.verse), text: text.trim(), theme: CONTENT_THEMES[0] } } });
      return;
    }
    setComposer({ mode, ...extra });
  };

  const handleCreatePost = (post) => {
    const id = 'f' + Date.now();
    dispatch({ type: 'post', post: { id, createdAt: Date.now(), ...post } });
    setComposer(null);
    goFeedPost('p_' + id);
    const photos = post.images ? post.images.length : 0;
    toast.show(photos ? (photos > 1 ? `${photos} photos shared` : 'Photo shared') : 'Posted to Socials', {
      icon: photos ? 'image' : 'check',
      haptic: 'success',
    });
  };

  const handlePublishVideo = ({ caption, scripture, category, url, duration, upload, passage }) => {
    const id = 'v' + Date.now();
    const newVid = {
      id,
      createdAt: Date.now(),
      creator: me(),
      caption,
      scripture,
      category,
      hashtags: ['#Faith', `#${String(category).replace(/\s+/g, '')}`],
      duration,
      sound: `Original Audio · ${me().name}`,
      videoUrl: url,
      imageUrl: null,
      bg: colors.night,
      // online: the picked file is uploaded to Cloudflare Stream by the sync layer
      ...(upload ? { upload, passage: passage || undefined, videoStatus: 'uploading', uploadProgress: 0 } : {}),
      views: '1',
      likes: 0,
      liked: false,
      shares: 0,
      reposts: 0,
      gifts: 0,
      comments: [],
      mine: true,
    };
    const forBounty = composer && composer.bounty;
    dispatch({ type: 'publishVideo', video: newVid });
    setComposer(null);
    setMainTab('home');
    setSegment('videos');
    setActiveIndex(0);
    setSelectedId(id);
    setTimeout(() => { try { reelsRef.current && reelsRef.current.scrollToOffset({ offset: 0, animated: false }); } catch (e) {} }, 60);
    setPublished({
      key: Date.now(),
      title: forBounty ? 'Submitted' : 'Published',
      label: forBounty ? `Your reel is in for the ${forBounty.price} bounty` : 'Live on Socials for the community',
    });
    toast.show(upload ? 'Uploading your video…' : forBounty ? `Submitted for the ${forBounty.price} bounty` : 'Video published to Socials', {
      icon: 'check',
      haptic: 'success',
      action: { label: 'See in feed', onPress: () => goFeedPost('v_' + id) },
    });
  };

  const visibleCampaigns = cornerCat === 'All' ? CAMPAIGNS : CAMPAIGNS.filter((c) => c.tags.includes(cornerCat));

  const renderChannel = (id, icon, label) => {
    const active = guildChannel === id;
    return (
      <PressScale key={id} onPress={() => openChannel(id)} scaleTo={0.97} style={[styles.channelItem, active && styles.channelItemActive]} accessibilityState={{ selected: active }}>
        {active ? <ScaleIn from={0.2} style={styles.channelActiveBar} /> : null}
        <Icon name={icon} size={15} color={active ? colors.goldLight : colors.nightMuted} />
        <Text style={[styles.channelName, active && styles.channelNameActive]} numberOfLines={1}>{label}</Text>
      </PressScale>
    );
  };

  const renderCategory = (title, unread) => (
    <Pressable onPress={() => setCollapsed((c) => ({ ...c, [title]: !c[title] }))} style={styles.categoryTitleRow} accessibilityLabel={`${collapsed[title] ? 'Expand' : 'Collapse'} ${title}`}>
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

  const userName = (state.user && state.user.displayName) || 'You';
  const darkHead = segment === 'videos';
  // Keep the last composer config while the sheet animates out (no header flicker on close)
  const lastComposer = useRef({});
  if (composer) lastComposer.current = composer;
  const sheetCfg = composer || lastComposer.current;
  const feedPlaying = focused && mainTab === 'home' && segment !== 'videos' && !composer && !commentTarget && !viewer && !showGiftStore && !menuKey && !videoViewer;
  // FEED VIDEO: one tiny pool of players for every inline video; muted by default, the choice is remembered
  const feedMuted = state.feedMuted !== false;
  const urlOf = (key) => { const it = key ? listItems.find((x) => x.key === key) : null; return it ? it.videoUrl || null : null; };
  const pool = useFeedVideoPool({
    activeKey: visibleVideoKey,
    activeUrl: urlOf(visibleVideoKey),
    nextUrl: urlOf(nextVideoKey),
    enabled: feedPlaying,
    release: !focused || mainTab !== 'home' || segment === 'videos' || !!videoViewer,
    muted: feedMuted,
  });
  const toggleFeedMute = () => {
    haptic('select');
    dispatch({ type: 'set', patch: { feedMuted: !feedMuted } });
  };
  // Card callbacks read the latest handlers through this ref, so memoised cards never call stale ones
  const H = useRef({});
  H.current = {
    likeItem, reactItem, openComments, handleShareVideo, handleSharePost, saveItem, handleFollow, openScripture, openReelAt,
    openItemAuthor, openPostLikers, onMediaLayout, toggleFeedMute, pickVisibleVideo, onCellLayout, scrollFeedTo,
    openComposer, switchSegment, openProfile,
    togglePause: pool.togglePause,
    menu: (key) => { haptic('light'); setMenuKey(key); },
    photo: (images, start) => setViewer({ images, start }),
    retry: (id) => dispatch({ type: 'retryVideo', id }),
    discard: (id) => dispatch({ type: 'removeItem', slice: 'videos', id }),
  };
  // stable callback for the FlatList cells (context value must not change every render)
  const onCellLayoutStable = useRef((key, layout) => H.current.onCellLayout(key, layout)).current;
  H.current.onCellLayoutStable = onCellLayoutStable;
  const menuItem = menuKey ? allItems.find((it) => it.key === menuKey) || null : null;
  const closeMenu = () => setMenuKey(null);
  // Run a ⋯ menu action once the sheet has started closing
  const fromMenu = (fn) => () => {
    const it = menuItem;
    setMenuKey(null);
    if (it) setTimeout(() => fn(it), 120);
  };

  const CHIP_EMPTY = {
    'For You': ['Your feed is quiet', 'Be the first to share a word, photo or video with the community.', 'Create a post', () => openComposer('text')],
    Following: ['Nothing from people you follow yet', 'Follow believers, creators or join communities to see their posts here.', 'Find believers', () => nav.push('People')],
    Communities: ['No community posts yet', 'Join a church or study group to see its posts here.', 'Explore communities', () => nav.push('Communities')],
    Events: ['No announcements or celebrations', 'Church announcements, events and celebrations will appear here.', 'Open calendar', () => nav.push('Calendar')],
  };
  const CHIP_INTRO = {
    Following: 'People, creators and communities you follow — plus your own posts.',
    Communities: 'Posts from churches, groups and channels.',
    Events: 'Announcements, events and celebrations.',
  };

  // ─── Feed (light, Facebook-style) ──────────────────────────────
  // FEED (virtualised): the stream is one FlatList. Rows: post cards, the creator hub module and native ads;
  // composer / strips / chip intro are the list header, "load more" / "all caught up" the footer.
  const feedRows = useMemo(() => {
    const rows = [];
    const hubAt = chip === 'For You' ? Math.min(2, listItems.length) : -1;
    listItems.forEach((it, i) => {
      if (i === hubAt) rows.push({ type: 'hub', key: 'hub' });
      rows.push({ type: 'post', key: it.key, it, i });
      // a native ad after every few posts (never after the last one)
      if ((i + 1) % AD_RULES.feedAdEvery === 0 && i < listItems.length - 1) rows.push({ type: 'ad', key: 'ad-' + i });
    });
    if (listItems.length && hubAt === listItems.length) rows.push({ type: 'hub', key: 'hub' });
    return rows;
  }, [listItems, chip]);
  feedRowsRef.current = feedRows;

  const renderCard = (it, i) => {
    // entry animation only the first time a card appears — not every time the list re-mounts it
    const entering = !appeared.current.has(it.key);
    if (entering) appeared.current.add(it.key);
    return (
      <LightPostCard
        item={it}
        index={Math.min(i + 2, 6)}
        entering={entering}
        playing={visibleVideoKey === it.key}
        videoPlayer={pool.activeKey === it.key ? pool.player : null}
        videoPaused={pool.activeKey === it.key ? pool.paused || !feedPlaying : false}
        feedMuted={feedMuted}
        highlight={highlightKey === it.key}
        isFollowing={!!it.handle && follows.includes(it.handle)}
        onLike={(dbl) => H.current.likeItem(it, dbl)}
        onReact={(key) => H.current.reactItem(it, key)}
        onComment={() => H.current.openComments(it.src, it.id)}
        onShare={() => (it.src === 'video' ? H.current.handleShareVideo(it.raw) : H.current.handleSharePost(it.raw))}
        onSave={() => H.current.saveItem(it)}
        onMenu={() => H.current.menu(it.key)}
        onFollow={it.src === 'video' || it.handle ? () => H.current.handleFollow(it.raw) : null}
        onOpenPassage={() => H.current.openScripture(it.passage || it.scripture)}
        onOpenVideo={() => H.current.openReelAt(it.id)}
        onOpenPhoto={(images, start) => H.current.photo(images, start)}
        onOpenAuthor={() => H.current.openItemAuthor(it)}
        onOpenLikes={() => H.current.openPostLikers(it)}
        onTogglePause={() => H.current.togglePause()}
        onToggleMute={() => H.current.toggleFeedMute()}
        onMediaLayout={(y, h) => H.current.onMediaLayout(it.key, y, h)}
        onRetryUpload={it.uploadFailed ? () => H.current.retry(it.id) : undefined}
        onDiscardUpload={it.uploadFailed ? () => H.current.discard(it.id) : undefined}
      />
    );
  };
  // Re-created only when something a row shows changes; memoised cards skip the rest of the work
  const renderFeedRow = useCallback(({ item: row }) => {
    if (row.type === 'hub') return <FeedHubRow guildUnread={guildUnread} onGuild={() => setMainTab('guild')} onCorner={() => setMainTab('creators')} />;
    if (row.type === 'ad') return <FeedAdRow />;
    return renderCard(row.it, row.i);
  }, [visibleVideoKey, pool.activeKey, pool.player, pool.paused, feedPlaying, feedMuted, highlightKey, follows, guildUnread]);
  const feedExtra = useMemo(() => ({}), [visibleVideoKey, pool.activeKey, pool.player, pool.paused, feedPlaying, feedMuted, highlightKey, follows, guildUnread]);

  // Viewability: rows on screen (candidates for autoplay) + rows >= 70% visible (fallback before measuring)
  const onViewRef = useRef(null);
  onViewRef.current = (info) => {
    viewableKeys.current = info.viewableItems
      .filter((v) => v.item && v.item.type === 'post')
      .map((v) => v.item.key);
    pickVisibleVideo();
  };
  const onMostlyRef = useRef(null);
  onMostlyRef.current = (info) => {
    mostlyVisible.current = new Set(info.viewableItems.map((v) => v.key));
    pickVisibleVideo();
  };
  const viewabilityPairs = useRef([
    { viewabilityConfig: { itemVisiblePercentThreshold: 1 }, onViewableItemsChanged: (info) => onViewRef.current(info) },
    { viewabilityConfig: { itemVisiblePercentThreshold: 70 }, onViewableItemsChanged: (info) => onMostlyRef.current(info) },
  ]).current;
  const feedOnScroll = useMemo(() => Animated.event([{ nativeEvent: { contentOffset: { y: feedScroll } } }], {
    useNativeDriver: ND,
    listener: (e) => {
      scrollY.current = e.nativeEvent.contentOffset.y;
      H.current.pickVisibleVideo();
    },
  }), [feedScroll]);
  const onFeedEnd = useCallback(() => {
    // Online: infinite scroll — fetch the next page when nearing the end
    if (sync.online && sync.hasMore && !sync.loadingMore) sync.loadMore();
  }, [sync.online, sync.hasMore, sync.loadingMore, sync.loadMore]);

  // Feed filter chips — part of the collapsing header so they come back on scroll up
  const renderChips = () => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chipRow, styles.chipRowHeader]}>
      {FEED_CHIPS.map((c) => {
        const on = chip === c;
        return (
          <PressScale key={c} onPress={() => switchChip(c)} scaleTo={0.93} style={[styles.chip, on && styles.chipOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{c}</Text>
          </PressScale>
        );
      })}
    </ScrollView>
  );

  // List header (composer, member websites, reels strip / chip intro): memoised so the ~40-tile reels strip is
  // not re-rendered on every scroll-driven state change (active / next video, viewability). Callbacks go
  // through H so they are never stale.
  const feedHeader = useMemo(() => (chip === 'For You' ? (
    <>
      <ComposerCard userName={userName} avatarUri={myAvatar} onOpen={(mode) => H.current.openComposer(mode)} />
      <MemberWebsitesStrip />
      {reelVideos.length ? (
        <ReelsStrip
          videos={reelVideos}
          userName={userName}
          userAvatar={myAvatar}
          onOpen={(id) => H.current.openReelAt(id)}
          onCreate={() => H.current.openComposer('video')}
          onSeeAll={() => H.current.switchSegment('videos')}
          onOpenCreator={(v) => H.current.openProfile({ userId: v.creator && v.creator.userId, name: v.creator && v.creator.name, handle: v.creator && v.creator.handle, mine: v.mine })}
        />
      ) : null}
    </>
  ) : (
    <FadeInUp key={chip} distance={8} style={styles.chipIntro}>
      <Text style={styles.chipIntroText}>{CHIP_INTRO[chip]}</Text>
      <Text style={styles.chipIntroCount}>{listItems.length} {listItems.length === 1 ? 'post' : 'posts'}</Text>
    </FadeInUp>
  )), [chip, userName, myAvatar, reelVideos, listItems.length]);

  const renderFeed = () => {
    const empty = CHIP_EMPTY[chip];
    const moreToLoad = sync.online && sync.hasMore;
    const header = feedHeader;
    const emptyView = (
      <View style={styles.listEmpty}>
        <ScaleIn key={chip} style={styles.feedEmptyIconLight}>
          <Icon name={chip === 'Events' ? 'calendar' : chip === 'Communities' ? 'church' : 'users'} size={24} color={colors.primary} />
        </ScaleIn>
        <FadeInUp delay={90} style={{ alignItems: 'center' }}>
          <Text style={styles.feedEmptyTitleLight}>{empty[0]}</Text>
          <Text style={styles.feedEmptyBodyLight}>{empty[1]}</Text>
          <Button small label={empty[2]} onPress={empty[3]} style={{ marginTop: 16 }} />
        </FadeInUp>
      </View>
    );
    const footer = !listItems.length ? null : moreToLoad ? (
      <PressScale onPress={() => sync.loadMore()} scaleTo={0.97} style={styles.feedEnd} accessibilityLabel="Load more posts">
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={styles.feedEndText}>{sync.loadingMore ? 'Loading more posts…' : 'Load more posts'}</Text>
      </PressScale>
    ) : (
      <View style={styles.feedEnd}>
        <View style={styles.feedEndLine} />
        <View style={styles.feedEndBadge}>
          <Icon name="check" size={11} color={colors.primary} strokeWidth={3} />
        </View>
        <Text style={styles.feedEndText}>You’re all caught up</Text>
        <View style={styles.feedEndLine} />
      </View>
    );
    return (
      <FeedCellCtx.Provider value={H.current.onCellLayoutStable}>
        <Animated.FlatList
          ref={feedRef}
          data={feedRows}
          keyExtractor={feedKey}
          renderItem={renderFeedRow}
          extraData={feedExtra}
          CellRendererComponent={FeedCell}
          ListHeaderComponent={header}
          ListEmptyComponent={emptyView}
          ListFooterComponent={footer}
          style={{ flex: 1, backgroundColor: colors.screen }}
          contentContainerStyle={[styles.feedContent, { paddingTop: headerH }]}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={feedOnScroll}
          viewabilityConfigCallbackPairs={viewabilityPairs}
          onEndReached={onFeedEnd}
          onEndReachedThreshold={1.5}
          onScrollToIndexFailed={onScrollToIndexFailed}
          initialNumToRender={4}
          maxToRenderPerBatch={3}
          updateCellsBatchingPeriod={60}
          windowSize={FEED_WINDOW}
          removeClippedSubviews={Platform.OS === 'android'}
          refreshControl={sync.online ? (
            <RefreshControl refreshing={pulling} onRefresh={pullRefresh} tintColor={colors.primary} colors={[colors.primary]} progressViewOffset={headerH} />
          ) : undefined}
        />
      </FeedCellCtx.Provider>
    );
  };

  // ─── Videos (full-screen reels) ────────────────────────────────
  // Overlay drawn on each video by the shared player (VideoPager / VideoViewer)
  const renderVideoOverlay = (pv, ctx) => {
    const item = (pv && pv.raw) || pv;
    return (
      <ReelOverlay
        item={item}
        isActive={ctx.current}
        isPlaying={ctx.playing}
        isLiked={!!item.liked}
        isFollowing={follows.includes(item.creator && item.creator.handle)}
        onLike={() => { haptic(item.liked ? 'light' : 'success'); dispatch({ type: 'likeVideo', id: item.id }); }}
        onComment={() => openComments('video', item.id)}
        onGift={() => openGifts(item.id)}
        onShare={() => handleShareVideo(item)}
        onRepost={() => handleRepost(item)}
        onFollow={() => handleFollow(item)}
        onOpenBible={() => openScripture(item.scripture)}
        onListen={() => listenScripture(item)}
        onOpenCreator={() => { setVideoViewer(null); openProfile({ userId: item.creator && item.creator.userId, name: item.creator && item.creator.name, handle: item.creator && item.creator.handle, mine: item.mine }); }}
      />
    );
  };
  // double-tap likes (never un-likes)
  const likeFromTap = (pv) => {
    const item = (pv && pv.raw) || pv;
    if (!item) return;
    if (!item.liked) { haptic('success'); dispatch({ type: 'likeVideo', id: item.id }); } else haptic('light');
  };
  const videoSheetOpen = !!commentTarget || showGiftStore || !!likers || !!composer;
  const onPagerIndex = (i) => {
    setActiveIndex(i);
    if (reelVideos[i]) setSelectedId(reelVideos[i].id);
  };

  const renderReels = () => (
    <View style={{ flex: 1, position: 'relative', backgroundColor: '#000' }}>
      {reelVideos.length ? (
        <VideoPager
          testID="videos-tab-pager"
          items={playableVideos}
          index={Math.min(activeIndex, reelVideos.length - 1)}
          onIndexChange={onPagerIndex}
          width={win.width}
          height={bodyHeight}
          active={focused && mainTab === 'home' && segment === 'videos' && !videoViewer}
          paused={videoSheetOpen}
          renderOverlay={renderVideoOverlay}
          onDoubleTap={likeFromTap}
          onChromeChange={setVideosChrome}
          topInset={60}
          keyboard={!videoViewer}
        />
      ) : (
        <View style={[styles.feedEmpty, { height: bodyHeight, paddingTop: 60 }]}>
          <ScaleIn style={styles.feedEmptyIcon}>
            <Icon name="video" size={26} color={colors.goldLight} />
          </ScaleIn>
          <FadeInUp delay={90} style={{ alignItems: 'center' }}>
            <Text style={styles.feedEmptyTitle}>No videos yet</Text>
            <Text style={styles.feedEmptyBody}>Share a sermon clip, worship moment or testimony with the community.</Text>
            <PressScale onPress={() => openComposer('video')} scaleTo={0.95} style={styles.feedEmptyBtn}>
              <Text style={styles.feedEmptyBtnText}>Post a video</Text>
              <Icon name="arrow-right" size={14} color={colors.night} strokeWidth={2.6} />
            </PressScale>
          </FadeInUp>
        </View>
      )}

      {/* Immersive Videos: no header, no pills, no tab bar — just a back arrow over the video */}
      <PressScale
        onPress={() => (routeMode ? nav.pop() : switchSegment('feed'))}
        scaleTo={0.9}
        hitSlop={12}
        style={styles.videosBack}
        accessibilityLabel="Close videos"
        testID="videos-back"
      >
        <Icon name="chevron-left" size={24} color={WHITE} strokeWidth={2.4} />
      </PressScale>

      {/* Publish success: springs in over the new reel, then clears itself */}
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
  );

  return (
    <View style={[styles.container, { backgroundColor: mainTab === 'creators' ? colors.screen : mainTab === 'guild' ? colors.night : segment === 'videos' ? SOCIAL.page : colors.screen }]}>
      {mainTab === 'home' ? (
        <>
          {/* Header: title left · create + profile right · Feed / Videos switch (+ Feed chips).
              Light on Feed (matches the rest of the app); dark and overlaid on the Videos player.
              It floats over the content: hides on scroll down / shows on scroll up (Feed), and hides
              with the player controls (Videos). */}
          <Animated.View
            onLayout={(e) => { const h = Math.round(e.nativeEvent.layout.height); if (h && Math.abs(h - headerH) > 1) setHeaderH(h); }}
            ref={headerRef}
            style={[styles.header, !darkHead && styles.headerLight, darkHead && styles.headerOverlay, styles.headerFloat, { transform: [{ translateY: segment === 'videos' ? videoHeaderY : feedHeaderY }] }, segment === 'videos' && { display: 'none' }]}
            pointerEvents={segment === 'videos' ? 'none' : 'auto'}
            testID="socials-header"
          >
            <View style={styles.headerRow}>
              {routeMode ? (
                <PressScale onPress={() => nav.pop()} scaleTo={0.9} hitSlop={10} style={[styles.headerBack, !darkHead && styles.headerBackLight]} accessibilityLabel="Back">
                  <Icon name="chevron-left" size={20} color={darkHead ? colors.nightFg : colors.fg} strokeWidth={2.2} />
                </PressScale>
              ) : null}
              <View style={{ flex: 1, minWidth: 0 }}>
                {/* Brief 7.2: the header says "Socials" only (no "Community" above it) */}
                <Text style={[styles.headerTitle, !darkHead && { color: colors.fg }]} numberOfLines={1}>Socials</Text>
              </View>
              <PressScale onPress={() => nav.push('Activity')} scaleTo={0.9} hitSlop={6} style={[styles.headerBack, !darkHead && styles.headerBackLight]} accessibilityLabel={unreadActivity ? `Activity, ${unreadActivity} new` : 'Activity'}>
                <Icon name="bell" size={17} color={darkHead ? colors.nightFg : colors.fg} />
                {unreadActivity ? (
                  <ScaleIn key={unreadActivity} style={styles.bellBadge}>
                    <Text style={styles.bellBadgeText}>{unreadActivity > 9 ? '9+' : unreadActivity}</Text>
                  </ScaleIn>
                ) : null}
              </PressScale>
              <PressScale onPress={() => openComposer(segment === 'videos' ? 'video' : 'text')} scaleTo={0.9} hitSlop={6} style={[styles.headerCreate, !darkHead && styles.headerCreateLight]} accessibilityLabel="Create post">
                <Icon name="plus" size={18} color={WHITE} strokeWidth={2.4} />
              </PressScale>
              <ProfileButton size={36} dark={darkHead} />
            </View>
            <SegmentSwitch value={segment} onChange={switchSegment} light={!darkHead} />
            {segment === 'feed' ? renderChips() : null}
          </Animated.View>

          <View
            style={{ flex: 1 }}
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              if (h > 100 && Math.abs(h - bodyHeight) > 2) setBodyHeight(h);
            }}
          >
            {segment === 'videos' ? renderReels() : renderFeed()}
          </View>
        </>
      ) : null}

      {/* CLIP FARM GUILD */}
      {mainTab === 'guild' ? (
        <View style={styles.guildContainer}>
          <View style={styles.guildHeader}>
            <PressScale onPress={() => setMainTab('home')} scaleTo={0.9} style={styles.backToReelsBtn} accessibilityLabel="Back to Socials">
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
            <PressScale style={styles.guildCopyBtn} scaleTo={0.93} onPress={() => shareText(`Join the Clip Farm creator guild on BibleNestra: ${GUILD_INVITE}`, 'Invite link shared')} accessibilityLabel="Share invite link">
              <Text style={styles.guildCopyBtnText}>Invite</Text>
            </PressScale>
          </View>

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
                  onSubmitEditing={handleSendGuildMessage}
                  style={styles.guildTextInput}
                />
                <PressScale onPress={handleSendGuildMessage} disabled={!guildInput.trim()} scaleTo={0.88} style={[styles.guildSendBtn, !guildInput.trim() && { opacity: 0.4 }]} accessibilityLabel="Send">
                  <Icon name="arrow-right" size={16} color={colors.night} strokeWidth={2.6} />
                </PressScale>
              </View>
            </FadeInUp>
          </ScrollView>
        </View>
      ) : null}

      {/* CREATORS CORNER */}
      {mainTab === 'creators' ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.cornerScroll}>
          <FadeInUp distance={8} style={styles.cornerHeader}>
            <PressScale onPress={() => setMainTab('home')} scaleTo={0.9} style={styles.cornerBackBtn} accessibilityLabel="Back to Socials">
              <BackGlyph color={colors.fg} size={17} />
            </PressScale>
            <PressScale style={styles.pitchBtn} scaleTo={0.95} onPress={() => openComposer('video')}>
              <PlusGlyph size={10} />
              <Text style={styles.pitchBtnText}>Submit work</Text>
            </PressScale>
          </FadeInUp>

          <FadeInUp index={1}>
            <Text style={styles.cornerEyebrow}>Trending · 20,732 creators</Text>
            <Text style={styles.cornerMainTitle}>Creators Corner</Text>
            <Text style={styles.cornerIntro}>Paid bounties for editors and storytellers creating faith media. Pick a campaign, submit your reel, earn from escrow.</Text>
          </FadeInUp>

          <FadeInUp index={2}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 18, paddingBottom: 4 }}>
              {CORNER_CATEGORIES.map((cat) => {
                const on = cornerCat === cat;
                return (
                  <PressScale key={cat} onPress={() => { setCornerCat(cat); haptic('select'); }} scaleTo={0.93} style={[styles.cornerCatChip, on && styles.cornerCatChipActive]} accessibilityState={{ selected: on }}>
                    <Text style={[styles.cornerCatChipText, on && styles.cornerCatChipTextActive]}>{cat}</Text>
                  </PressScale>
                );
              })}
            </ScrollView>
          </FadeInUp>

          {visibleCampaigns.length ? (
            visibleCampaigns.map((c, i) => {
              const apply = () => openComposer('video', { bounty: c, preset: { caption: c.submission, category: c.category } });
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
                      <Button label={`Apply for ${c.price} bounty`} onPress={apply} style={{ marginTop: 14 }} />
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

      {/* One composer for text, photo(s) and video */}
      <CreatePostSheet
        visible={!!composer}
        onClose={() => setComposer(null)}
        initialMode={sheetCfg.mode || 'text'}
        bounty={sheetCfg.bounty}
        preset={sheetCfg.preset}
        userName={userName}
        onPost={handleCreatePost}
        onPublishVideo={handlePublishVideo}
      />
      <TextPostShareSheet
        visible={!!shareCard}
        post={shareCard ? { theme: shareCard.bg, text: shareCard.text, passage: shareCard.passage ? passageLabel(shareCard.passage) : '', author: shareCard.author } : null}
        onClose={() => setShareCard(null)}
        onShareText={() => (shareCard ? handleSharePost(shareCard, { asText: true }) : false)}
        onShared={() => shareCard && dispatch({ type: 'sharePost', src: 'post', id: shareCard.id })}
      />

      {/* ⋯ post menu */}
      <PostMenuSheet
        visible={!!menuItem}
        item={menuItem}
        isFollowing={!!(menuItem && menuItem.handle && follows.includes(menuItem.handle))}
        onClose={closeMenu}
        onSave={fromMenu(saveItem)}
        onShare={fromMenu((it) => (it.src === 'video' ? handleShareVideo(it.raw) : handleSharePost(it.raw)))}
        onComment={fromMenu((it) => openComments(it.src, it.id))}
        onHide={fromMenu(hideItem)}
        onDelete={fromMenu(deleteItem)}
        onFollow={fromMenu((it) => handleFollow(it.raw))}
        onOpenVideo={fromMenu((it) => openReelAt(it.id))}
        onGift={fromMenu((it) => openGifts(it.id))}
        onProfile={fromMenu(openItemAuthor)}
      />

      <PhotoViewer visible={!!viewer} images={(viewer && viewer.images) || []} start={(viewer && viewer.start) || 0} onClose={() => setViewer(null)} />

      {/* Virtual gifts (reels, comments) — coins only move on the server when online */}
      {/* Full-screen video viewer — mounted before the sheets so comments / gifts open above it */}
      <VideoViewer
        // iOS can't present a sheet over another modal, so the viewer steps aside while one is open and comes
        // back at the same video / time when it closes (the player remembers the position, no second pre-roll)
        visible={!!videoViewer && playableVideos.length > 0 && !(Platform.OS === 'ios' && videoSheetOpen)}
        items={playableVideos}
        index={videoViewer ? Math.min(videoViewer.index, Math.max(0, playableVideos.length - 1)) : 0}
        onIndexChange={(i) => { onPagerIndex(i); setVideoViewer((v) => (v ? { ...v, index: i } : v)); }}
        onClose={() => setVideoViewer(null)}
        paused={videoSheetOpen || !focused}
        renderOverlay={renderVideoOverlay}
        onDoubleTap={likeFromTap}
      />
      <GiftSheet visible={showGiftStore} target={giftTarget} onClose={closeGifts} />

      {/* Who liked a post / comment */}
      <PeopleSheet
        visible={!!likers}
        title={likers ? likers.title : ''}
        eyebrow={likers ? likers.eyebrow : ''}
        load={likers ? likers.load : null}
        footer={likers ? likers.footer : null}
        onClose={() => { setLikers(null); restoreComments(); }}
        onOpenPerson={(person) => {
          reopenComments.current = null;
          setLikers(null);
          setTimeout(() => openProfile({ userId: person.id, name: person.name, handle: person.followKey, mine: person.isMe }), 200);
        }}
      />

      {/* Comments & replies (feed posts and videos) */}
      <AnimatedModal visible={!!commentTarget} onRequestClose={() => { setCommentTarget(null); setFocusComment(null); }}>
        <View style={styles.modalOverlay}>
          <Pressable style={{ flex: 1 }} onPress={() => { setCommentTarget(null); setFocusComment(null); }} accessibilityLabel="Dismiss" />
          <View style={styles.commentsSheet}>
            <View style={styles.sheetPad}>
              <SheetHead
                eyebrow={commentItem ? `On ${commentSrc === 'video' ? (commentItem.creator && commentItem.creator.name) || 'video' : commentItem.author}'s post` : 'Conversation'}
                title={`${commentCount} ${commentCount === 1 ? 'Comment' : 'Comments'}`}
                onClose={() => setCommentTarget(null)}
              />
            </View>

            <ScrollView ref={commentScroll} style={{ flex: 1 }} contentContainerStyle={styles.sheetScroll} keyboardShouldPersistTaps="handled">
              {earlierCount ? <Text style={styles.commentsNote}>{earlierCount} earlier {earlierCount === 1 ? 'comment' : 'comments'} in this thread</Text> : null}
              {commentList.length ? null : (
                <ScaleIn style={styles.commentsEmpty}>
                  <View style={styles.commentsEmptyIcon}>
                    <Icon name="chat" size={22} color={colors.primary} />
                  </View>
                  <Text style={styles.commentsEmptyTitle}>{earlierCount ? 'Add your voice' : 'Start the conversation'}</Text>
                  <Text style={styles.commentsEmptyText}>Share an encouraging word.</Text>
                </ScaleIn>
              )}
              {commentList.map((c, ci) => {
                const focusHere = focusComment && (c.id === focusComment || (c.replies || []).some((r) => r.id === focusComment));
                return (
                  <View
                    key={c.id}
                    onLayout={focusHere ? (e) => { const y = e.nativeEvent.layout.y; setTimeout(() => { try { commentScroll.current && commentScroll.current.scrollTo({ y: Math.max(0, y - 12), animated: true }); } catch (err) { /* ignore */ } }, 120); } : undefined}
                  >
                    <FadeInUp index={ci} distance={10} duration={340} style={[styles.commentBlock, c.id === focusComment && styles.commentFocus]}>
                      <PressScale onPress={() => openCommenter(c)} scaleTo={0.9} hitSlop={4} accessibilityLabel={`Open ${c.mine ? 'your' : `${c.from}'s`} profile`}>
                        {c.avatarUrl || (c.mine && myAvatar) ? (
                          <SocialAvatar name={c.from} uri={c.avatarUrl || myAvatar} size={34} />
                        ) : (
                          <View style={styles.commentAvatar}>
                            <Text style={styles.commentAvatarText}>{initials(c.from)}</Text>
                          </View>
                        )}
                      </PressScale>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.commentAuthor}>
                          <Text onPress={() => openCommenter(c)} accessibilityRole="link">{c.from}</Text>
                          <Text style={styles.commentTime}>  ·  {c.time}</Text>
                        </Text>
                        <Text style={styles.commentBody}>{c.text}</Text>
                        {renderCommentBar(c, true)}
                        {(c.replies || []).map((r) => (
                          <FadeInUp key={r.id} distance={8} duration={320} style={[styles.replyItem, r.id === focusComment && styles.commentFocus]}>
                            <Text style={styles.replyAuthor}>
                              <Text onPress={() => openCommenter(r)} accessibilityRole="link">{r.from}</Text>
                              <Text style={styles.commentTime}>  ·  {r.time}</Text>
                            </Text>
                            <Text style={styles.replyBody}>{r.text}</Text>
                            {renderCommentBar(r, false)}
                          </FadeInUp>
                        ))}
                      </View>
                    </FadeInUp>
                  </View>
                );
              })}
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
                  placeholder={replyingTo ? `Reply to ${replyingTo.from}...` : 'Add a kind comment…'}
                  placeholderTextColor={colors.faint}
                  value={commentText}
                  onChangeText={setCommentText}
                  onSubmitEditing={handleAddComment}
                  returnKeyType="send"
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

  // ─── Header + segment switch ────────────────────────────────
  header: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    backgroundColor: SOCIAL.page,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    zIndex: 40,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  headerBack: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerEyebrow: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase', color: colors.goldLight, marginBottom: 1 },
  headerTitle: { fontFamily: fonts.display, fontSize: 28, lineHeight: 33, letterSpacing: -0.6, color: colors.nightFg },
  headerCreate: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  segRow: {
    flexDirection: 'row',
    backgroundColor: colors.nightRaised,
    borderRadius: radius.pill,
    padding: 3,
    borderWidth: 1,
    borderColor: colors.nightBorder,
  },
  segPill: { position: 'absolute', top: 3, bottom: 3, left: 0, borderRadius: radius.pill, backgroundColor: colors.nightFg },
  segTab: { flex: 1, height: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  segText: { fontSize: 13, fontWeight: '600', color: colors.nightMuted },
  segTextOn: { color: colors.night, fontWeight: '800' },

  // Light variants (Feed segment)
  headerLight: { backgroundColor: colors.screen, borderBottomColor: colors.border },
  headerFloat: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 40 },
  headerOverlay: { backgroundColor: 'rgba(8,9,20,0.55)', borderBottomColor: 'transparent' },
  chipRowHeader: { paddingHorizontal: 0, paddingTop: 10, paddingBottom: 0 },
  headerBackLight: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  headerCreateLight: { borderColor: colors.primary, ...shadow.sm },
  segRowLight: { backgroundColor: colors.raised, borderColor: colors.border },
  segPillLight: { backgroundColor: colors.surface, ...shadow.sm },
  segTextLight: { color: colors.muted },
  segTextLightOn: { color: colors.primary, fontWeight: '800' },

  // ─── Light feed ─────────────────────────────────────────────
  feedContent: { paddingBottom: 28 },
  chipRow: { gap: 8, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 12 },
  chip: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: colors.fg, borderColor: colors.fg },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.muted },
  chipTextOn: { color: colors.screen, fontWeight: '700' },
  chipIntro: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginHorizontal: 16, marginBottom: 12 },
  chipIntroText: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.muted },
  chipIntroCount: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.gold },
  listEmpty: { alignItems: 'center', paddingHorizontal: 36, paddingTop: 40, paddingBottom: 24 },
  feedEmptyIconLight: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  feedEmptyTitleLight: { fontFamily: fonts.serifBold, fontSize: 20, lineHeight: 25, color: colors.fg, textAlign: 'center', letterSpacing: -0.3 },
  feedEmptyBodyLight: { fontSize: 13.5, lineHeight: 19, color: colors.muted, textAlign: 'center', marginTop: 6 },
  feedEnd: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 28, marginTop: 10 },
  feedEndLine: { flex: 1, height: 1, backgroundColor: colors.border },
  feedEndBadge: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  feedEndText: { fontSize: 12, color: colors.muted, fontWeight: '600' },
  videosBack: { position: 'absolute', top: 10, left: 12, width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.38)', zIndex: 30 },
  reelsTopBar: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 30,
  },
  floatingCornerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: alpha(colors.goldLight, 0.45),
    paddingLeft: 10,
    paddingRight: 7,
    borderRadius: radius.pill,
  },
  commentsNote: { fontSize: 12, color: colors.faint, textAlign: 'center', marginTop: 4, marginBottom: 4 },

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

  // ─── Floating top bar ───────────────────────────────────────
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

  // Gift toast

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
  commentFocus: { backgroundColor: alpha(colors.gold, 0.1), borderRadius: 12, marginHorizontal: -8, paddingHorizontal: 8 },
  commentBar: { flexDirection: 'row', alignItems: 'center', gap: 18, marginTop: 7 },
  commentLike: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  commentLikeCount: { fontSize: 12, fontWeight: '700', color: colors.muted, minWidth: 8 },
  commentGift: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  commentGiftText: { fontSize: 12, fontWeight: '700', color: colors.goldMuted },
  bellBadge: { position: 'absolute', top: -3, right: -3, minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.rose, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.surface },
  bellBadgeText: { fontSize: 9.5, fontWeight: '800', color: WHITE },
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
