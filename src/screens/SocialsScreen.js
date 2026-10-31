import React, { useState, useEffect, useRef } from 'react';
import {
  Alert,
  Dimensions,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Image,
} from 'react-native';
import Svg, { Path, Circle, Rect, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Icon } from '../components/Icons';
import { colors, fonts } from '../theme';
import { useStore } from '../store';
import { useNav } from '../navigation';
import { GIFTS } from '../data/seed';
import { Button, Tag, Badge } from '../components/ui';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const VIDEO_THEMES = ['#0F172A', '#1E1B4B', '#064E3B', '#3B0764', '#1E293B'];

const SAMPLE_VIDEOS = [
  { id: 'sv1', title: 'Sanctuary Worship & Altar', url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', duration: '0:45' },
  { id: 'sv2', title: 'Acoustic Praise Session', url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/friday.mp4', duration: '0:38' },
];

const SAMPLE_IMAGES = [
  { id: 'si1', title: 'Believers In Prayer', url: 'https://images.unsplash.com/photo-1543807535-eceef0bc6599?auto=format&fit=crop&w=600&q=80' },
  { id: 'si2', title: 'Open Scripture Meditation', url: 'https://images.unsplash.com/photo-1507692049790-de58290a4334?auto=format&fit=crop&w=600&q=80' },
  { id: 'si3', title: 'Altar Candle of Faith', url: 'https://images.unsplash.com/photo-1606293926075-69a00dbfde81?auto=format&fit=crop&w=600&q=80' },
];

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
          <Icon name="video" size={32} color={colors.gold} />
          <Text style={styles.modalPreviewPlaceholderText}>Select a video to preview</Text>
        </View>
      )}
      <View style={styles.modalPreviewScrim} pointerEvents="none" />
      <View style={styles.modalPreviewBadge}>
        <Text style={styles.modalPreviewBadgeText}>LIVE VIDEO PREVIEW</Text>
      </View>
    </View>
  );
}

const GIFT_ICONS = {
  g_rose: { name: 'sun', color: colors.rose },
  g_bouquet: { name: 'sparkles', color: colors.forest },
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
}) {
  const cardBg = VIDEO_THEMES[index % VIDEO_THEMES.length];
  const [isPlaying, setIsPlaying] = useState(true);
  const [showPlayIcon, setShowPlayIcon] = useState(false);

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
    if (!player) return;
    try {
      if (player.playing) {
        player.pause();
        setIsPlaying(false);
      } else {
        player.play();
        setIsPlaying(true);
      }
      setShowPlayIcon(true);
      setTimeout(() => setShowPlayIcon(false), 800);
    } catch (e) {}
  };

  return (
    <Pressable
      activeOpacity={0.95}
      onPress={togglePlayback}
      style={[
        styles.videoCard,
        { backgroundColor: cardBg, height: itemHeight || (SCREEN_HEIGHT - 105) }
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
      ) : (
        <View style={styles.videoPlayerGraphic}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="video" size={32} color="#FFFFFF" />
          </View>
          <Text style={styles.ambientCategoryBadge}>{item.category.toUpperCase()}</Text>
          <Text style={styles.ambientDurationText}>{item.duration}</Text>
        </View>
      )}

      {/* Top Gradient for header clarity */}
      <View style={styles.topGradientScrim} pointerEvents="none">
        <Svg width="100%" height={120} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id={`topGrad_${index}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#000000" stopOpacity="0.75" />
              <Stop offset="60%" stopColor="#000000" stopOpacity="0.25" />
              <Stop offset="100%" stopColor="#000000" stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#topGrad_${index})`} />
        </Svg>
      </View>

      {/* Deep Bottom Gradient for crystal-clear readability */}
      <View style={styles.bottomGradientScrim} pointerEvents="none">
        <Svg width="100%" height={340} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id={`bottomGrad_${index}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#000000" stopOpacity="0" />
              <Stop offset="35%" stopColor="#000000" stopOpacity="0.35" />
              <Stop offset="75%" stopColor="#000000" stopOpacity="0.8" />
              <Stop offset="100%" stopColor="#000000" stopOpacity="0.95" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#bottomGrad_${index})`} />
        </Svg>
      </View>

      {/* Tap Feedback Badge */}
      {showPlayIcon ? (
        <View style={styles.centerPlayBadge} pointerEvents="none">
          <Icon name={isPlaying ? 'play' : 'video'} size={34} color="#FFFFFF" />
        </View>
      ) : null}

      {/* Bottom Information Overlay (Creator & Caption) - PINNED TO BOTTOM */}
      <View style={styles.bottomInfo} pointerEvents="box-none">
        {/* Creator Row */}
        <View style={styles.creatorRow}>
          <View style={styles.creatorAvatar}>
            <Text style={styles.creatorAvatarText}>{item.creator.avatar}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={styles.creatorName} numberOfLines={1}>{item.creator.name}</Text>
              {item.creator.verified ? (
                <View style={styles.verifiedDot}>
                  <Icon name="check" size={9} color="#FFFFFF" strokeWidth={3} />
                </View>
              ) : null}
              <View style={styles.categoryBadgePill}>
                <Text style={styles.categoryBadgeText}>{item.category.toUpperCase()}</Text>
              </View>
            </View>
            <Text style={styles.creatorHandle} numberOfLines={1}>
              {item.creator.handle} · {item.creator.church}
            </Text>
          </View>

          <Pressable
            onPress={onFollow}
            style={[styles.followBtn, isFollowing && styles.followBtnActive]}
          >
            <Text style={[styles.followBtnText, isFollowing && styles.followBtnTextActive]}>
              {isFollowing ? 'Following' : '+ Follow'}
            </Text>
          </Pressable>
        </View>

        {/* Caption */}
        <Text style={styles.captionText} numberOfLines={3}>
          {item.caption}
        </Text>

        {/* Scripture Context Pill */}
        {item.scripture ? (
          <Pressable onPress={onOpenBible} style={styles.scripturePill}>
            <Icon name="book" size={13} color="#FBBF24" />
            <Text style={styles.scriptureText}>{item.scripture} · Read Context ›</Text>
          </Pressable>
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
          <Icon name="audio" size={12} color="rgba(255, 255, 255, 0.85)" />
          <Text style={styles.soundText} numberOfLines={1}>{item.sound}</Text>
        </View>
      </View>

      {/* Right Side Vertical Interaction Rail - PINNED TO BOTTOM RIGHT */}
      <View style={styles.rightRail} pointerEvents="box-none">
        {/* Like Button */}
        <Pressable onPress={onLike} style={styles.railAction}>
          <View style={[styles.railIconCircle, isLiked && styles.railIconCircleLiked]}>
            <Icon name="heart" size={22} color={isLiked ? '#F43F5E' : '#FFFFFF'} fill={isLiked ? '#F43F5E' : 'none'} />
          </View>
          <Text style={styles.railCount}>{item.likes}</Text>
        </Pressable>

        {/* Comment Button */}
        <Pressable onPress={onComment} style={styles.railAction}>
          <View style={styles.railIconCircle}>
            <Icon name="chat" size={20} color="#FFFFFF" />
          </View>
          <Text style={styles.railCount}>{item.comments?.length || 2}</Text>
        </Pressable>

        {/* Virtual Gifting Button */}
        <Pressable onPress={onGift} style={styles.railAction}>
          <View style={[styles.railIconCircle, styles.railIconCircleGift]}>
            <Icon name="gift" size={20} color="#FBBF24" />
          </View>
          <Text style={[styles.railCount, { color: '#FDE68A' }]}>
            {item.gifts || 42}
          </Text>
        </Pressable>

        {/* Share Button */}
        <Pressable onPress={onShare} style={styles.railAction}>
          <View style={styles.railIconCircle}>
            <Icon name="share" size={19} color="#FFFFFF" />
          </View>
          <Text style={styles.railCount}>{item.shares || 312}</Text>
        </Pressable>

        {/* Repost Button */}
        <Pressable onPress={onRepost} style={styles.railAction}>
          <View style={styles.railIconCircle}>
            <Icon name="swap" size={18} color="#FFFFFF" />
          </View>
          <Text style={styles.railCount}>{item.reposts || 0}</Text>
        </Pressable>

        {/* Rotating Music Disc (TikTok / Reels Signature UI) */}
        <View style={styles.musicDiscBox}>
          <View style={styles.musicDiscInner}>
            <Text style={styles.musicDiscText}>{item.creator.avatar}</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

export default function SocialsScreen() {
  const { state, dispatch } = useStore();
  const nav = useNav();
  const [mainTab, setMainTab] = useState('reels'); // 'reels' | 'guild' | 'creators'
  const [activeTab, setActiveTab] = useState('Recommended'); // 'Following' | 'Recommended'
  const [containerHeight, setContainerHeight] = useState(SCREEN_HEIGHT - 105);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [showComments, setShowComments] = useState(false);
  const [showGiftStore, setShowGiftStore] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [giftSuccess, setGiftSuccess] = useState(null);
  const [commentText, setCommentText] = useState('');
  const [replyingTo, setReplyingTo] = useState(null);

  const flatListRef = useRef(null);

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 60,
  });

  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    if (viewableItems && viewableItems.length > 0) {
      const active = viewableItems[0];
      if (active && active.index !== undefined && active.index !== null) {
        setActiveIndex(active.index);
        if (active.item) setSelectedVideo(active.item);
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
  const [contentTheme, setContentTheme] = useState('#0F172A');

  // Clip Farm Discord Guild State (Matching Client Screenshot)
  const [guildChannel, setGuildChannel] = useState('#content-rewards');
  const [guildInput, setGuildInput] = useState('');
  const [guildMessages, setGuildMessages] = useState([
    { id: 'm1', user: 'Shepherds Benjamin', role: 'Guild Founder', time: '09:28 AM', text: 'Welcome creators to Clip Farm! Check out the active $875 and $1,297 content reward campaigns below.' },
    { id: 'm2', user: 'Grace Adeyemi', role: 'Video Editor', time: '09:34 AM', text: 'Just finished editing 4 sermon reels for the Sunday broadcast! Ready to upload.' },
    { id: 'm3', user: 'Caleb Motion', role: 'VFX / Motion', time: '09:41 AM', text: 'Amen! The new 4K lower-thirds and kinetic typography templates are now available for all editors.' },
  ]);

  const handleSendGuildMessage = () => {
    if (!guildInput.trim()) return;
    const newM = {
      id: 'm_' + Date.now(),
      user: state.user?.displayName || 'Believer Creator',
      role: 'Content Creator',
      time: 'Just now',
      text: guildInput.trim(),
    };
    setGuildMessages((prev) => [...prev, newM]);
    setGuildInput('');
  };

  const videos = state.videos || [];
  const activeVideo = selectedVideo || videos[0];

  const handleSendGift = (gift) => {
    if (state.coins < gift.price) {
      Alert.alert('Notice', `Insufficient coins. You have ${state.coins} coins, but ${gift.name} costs ${gift.price} coins.`);
      return;
    }
    dispatch({
      type: 'sendGift',
      videoId: activeVideo.id,
      giftName: gift.name,
      recipient: activeVideo.creator.name,
      coins: gift.price,
    });
    setGiftSuccess(`Sent ${gift.name} to ${activeVideo.creator.name}!`);
    setTimeout(() => setGiftSuccess(null), 3000);
    setShowGiftStore(false);
  };

  const handleAddComment = () => {
    if (!commentText.trim()) return;
    dispatch({
      type: 'commentVideo',
      id: activeVideo.id,
      text: commentText.trim(),
      replyTo: replyingTo ? replyingTo.id : null,
    });
    setCommentText('');
    setReplyingTo(null);
  };

  const handlePublish = () => {
    if (publishMode === 'post_content') {
      if (!textContent.trim()) {
        Alert.alert('Required', 'Please enter your message.');
        return;
      }
      const newPost = {
        id: 'v' + Date.now(),
        creator: {
          name: state.user.displayName,
          handle: state.user.username ? `@${state.user.username}` : '@user',
          verified: true,
          avatar: state.user.displayName.slice(0, 2).toUpperCase(),
          church: state.user.church?.name || 'Local Church',
        },
        caption: textContent.trim(),
        scripture: newScripture.trim() || 'Philippians 4:13',
        category: 'Devotional',
        hashtags: ['#Faith', '#Devotion'],
        duration: 'Text Post',
        sound: `Faith Word · ${state.user.displayName}`,
        videoUrl: null,
        bg: contentTheme,
        views: '1',
        likes: 1,
        liked: true,
        shares: 0,
        reposts: 0,
        gifts: 0,
        comments: [],
      };
      dispatch({ type: 'publishVideo', video: newPost });
      setSelectedVideo(newPost);
      setShowPublishModal(false);
      setTextContent('');
      setMainTab('reels');
      Alert.alert('Published', 'Your faith post is live in the Socials feed!');
      return;
    }

    if (!newTitle.trim()) {
      Alert.alert('Required', 'Please enter a caption.');
      return;
    }

    const newVid = {
      id: 'v' + Date.now(),
      creator: {
        name: state.user.displayName,
        handle: state.user.username ? `@${state.user.username}` : '@user',
        verified: true,
        avatar: state.user.displayName.slice(0, 2).toUpperCase(),
        church: state.user.church?.name || 'Local Church',
      },
      caption: newTitle.trim(),
      scripture: newScripture.trim() || 'John 3:16',
      category: newCategory,
      hashtags: newHashtags.split(' ').map((h) => (h.startsWith('#') ? h : `#${h}`)),
      duration: '0:45',
      sound: `Original Audio · ${state.user.displayName}`,
      videoUrl: (publishMode === 'upload_images' ? null : selectedMediaUrl),
      bg: '#1b382d',
      views: '1',
      likes: 1,
      liked: true,
      shares: 0,
      reposts: 0,
      gifts: 0,
      comments: [],
    };
    dispatch({ type: 'publishVideo', video: newVid });
    setSelectedVideo(newVid);
    setShowPublishModal(false);
    setNewTitle('');
    setNewScripture('');
    setMainTab('reels');
    Alert.alert('Success', `${publishMode === 'upload_images' ? 'Image Post' : 'Video Reel'} published to Socials feed!`);
  };

  const filteredVideos = activeTab === 'Following'
    ? (videos.filter((v) => state.follows?.includes(v.creator.handle)).length ? videos.filter((v) => state.follows?.includes(v.creator.handle)) : videos)
    : videos;

  return (
    <View
      style={styles.container}
      onLayout={(e) => {
        const h = e.nativeEvent.layout.height;
        if (h > 100 && Math.abs(h - containerHeight) > 2) {
          setContainerHeight(h);
        }
      }}
    >
      {/* Gift Celebration Toast */}
      {giftSuccess ? (
        <View style={styles.giftToast}>
          <Icon name="gift" size={16} color={colors.gold} />
          <Text style={styles.giftToastText}>{giftSuccess}</Text>
        </View>
      ) : null}

      {/* TAB 1: REELS VERTICAL VIDEO FEED (Edge-to-Edge Full Screen) */}
      {mainTab === 'reels' ? (
        <View style={{ flex: 1, position: 'relative' }}>
          {/* Floating Edge-to-Edge Glass Top Bar (Pure Minimalist Mobile Experience) */}
          <View style={styles.floatingTopBar} pointerEvents="box-none">
            {/* Left: Guild Shortcut Pill */}
            <Pressable onPress={() => setMainTab('guild')} style={styles.floatingGuildPill}>
              <View style={styles.onlineDot} />
              <Text style={styles.floatingGuildText}>Guild</Text>
              <View style={styles.guildNavBadge}>
                <Text style={styles.guildNavBadgeText}>1</Text>
              </View>
            </Pressable>

            {/* Center: Minimalist Following | For You */}
            <View style={styles.reelsSubBarCapsule}>
              <Pressable onPress={() => setActiveTab('Following')} style={styles.feedTab}>
                <Text style={[styles.feedTabText, activeTab === 'Following' && styles.feedTabTextActive]}>
                  Following
                </Text>
                {activeTab === 'Following' ? <View style={styles.feedTabUnderline} /> : null}
              </Pressable>
              <Text style={styles.tabDivider}>|</Text>
              <Pressable onPress={() => setActiveTab('Recommended')} style={styles.feedTab}>
                <Text style={[styles.feedTabText, activeTab === 'Recommended' && styles.feedTabTextActive]}>
                  For You
                </Text>
                {activeTab === 'Recommended' ? <View style={styles.feedTabUnderline} /> : null}
              </Pressable>
            </View>

            {/* Right: Creators & Post Actions */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Pressable onPress={() => setMainTab('creators')} style={styles.floatingCornerBtn}>
                <Icon name="sparkles" size={14} color="#FBBF24" />
              </Pressable>
              <Pressable onPress={() => setShowPublishModal(true)} style={styles.floatingCreateBtn}>
                <Text style={styles.floatingCreateText}>＋ Post</Text>
              </Pressable>
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
                isActive={index === activeIndex}
                isLiked={item.liked}
                isFollowing={state.follows?.includes(item.creator.handle)}
                onLike={() => dispatch({ type: 'likeVideo', id: item.id })}
                onComment={() => {
                  setSelectedVideo(item);
                  setShowComments(true);
                }}
                onGift={() => {
                  setSelectedVideo(item);
                  setShowGiftStore(true);
                }}
                onShare={() => Alert.alert('Share', `Shared "${item.caption.slice(0, 30)}..." to Christian Social network!`)}
                onRepost={() => Alert.alert('Repost', 'Reposted to your Christian Socials profile!')}
                onFollow={() => dispatch({ type: 'follow', id: item.creator.handle })}
                onOpenBible={() => nav.push('Bible', { bookId: 'JHN', chapter: 3 })}
              />
            )}
          />
        </View>
      ) : null}

      {/* TAB 2: CLIP FARM DISCORD GUILD (Matching Client Screenshot) */}
      {mainTab === 'guild' ? (
        <View style={styles.guildContainer}>
          {/* Guild Header matching media_1793370117109_8c40ff13.png */}
          <View style={styles.guildHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Pressable
                onPress={() => setMainTab('reels')}
                style={styles.backToReelsBtn}
              >
                <Text style={styles.backToReelsText}>‹ Reels</Text>
              </Pressable>
              <View style={styles.guildLogoCircle}>
                <Text style={styles.guildLogoText}>CF</Text>
              </View>
              <View>
                <Text style={styles.guildName}>Clip Farm</Text>
                <Text style={styles.guildMeta}>★ 4.57 (5,163) · 210 online</Text>
              </View>
            </View>
            <Pressable
              style={styles.guildCopyBtn}
              onPress={() => Alert.alert('Copied', 'discord.gg/clipfarm link copied!')}
            >
              <Text style={styles.guildCopyBtnText}>Copy link</Text>
            </Pressable>
          </View>

          {/* Discord Channels & Chat Split View */}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
            {/* Channel Category: Support */}
            <View style={styles.channelCategory}>
              <Text style={styles.categoryTitle}>SUPPORT ▾</Text>
              <Pressable
                onPress={() => setGuildChannel('#ggv-support-chat')}
                style={[styles.channelItem, guildChannel === '#ggv-support-chat' && styles.channelItemActive]}
              >
                <Text style={styles.channelHash}>✉</Text>
                <Text style={[styles.channelName, guildChannel === '#ggv-support-chat' && styles.channelNameActive]}>ggv's support chat</Text>
              </Pressable>
            </View>

            {/* Channel Category: Announcements */}
            <View style={styles.channelCategory}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.categoryTitle}>ANNOUNCEMENTS ▾</Text>
                <View style={styles.unreadPill}>
                  <Text style={styles.unreadPillText}>1</Text>
                </View>
              </View>
              <Pressable
                onPress={() => setGuildChannel('#announcements')}
                style={[styles.channelItem, guildChannel === '#announcements' && styles.channelItemActive]}
              >
                <Text style={styles.channelHash}>📢</Text>
                <Text style={[styles.channelName, guildChannel === '#announcements' && styles.channelNameActive]}>Announcements</Text>
              </Pressable>
            </View>

            {/* Channel Category: Home */}
            <View style={styles.channelCategory}>
              <Text style={styles.categoryTitle}>HOME ▾</Text>
              <Pressable
                onPress={() => setGuildChannel('#discord-invite')}
                style={[styles.channelItem, guildChannel === '#discord-invite' && styles.channelItemActive]}
              >
                <Text style={styles.channelHash}>🌐</Text>
                <Text style={[styles.channelName, guildChannel === '#discord-invite' && styles.channelNameActive]}>discord.gg/clipfarm</Text>
              </Pressable>
              <Pressable
                onPress={() => setGuildChannel('#faq')}
                style={[styles.channelItem, guildChannel === '#faq' && styles.channelItemActive]}
              >
                <Text style={styles.channelHash}>❓</Text>
                <Text style={[styles.channelName, guildChannel === '#faq' && styles.channelNameActive]}>FAQ & Rules</Text>
              </Pressable>
            </View>

            {/* Channel Category: Campaigns & Rewards (Matching Screenshot) */}
            <View style={styles.channelCategory}>
              <Text style={styles.categoryTitle}>CAMPAIGNS & BOUNTIES ▾</Text>
              <Pressable
                onPress={() => setGuildChannel('#campaign-announcements')}
                style={[styles.channelItem, guildChannel === '#campaign-announcements' && styles.channelItemActive]}
              >
                <Text style={styles.channelHash}>🎯</Text>
                <Text style={[styles.channelName, guildChannel === '#campaign-announcements' && styles.channelNameActive]}>Campaign Announcements</Text>
              </Pressable>
              <Pressable
                onPress={() => setGuildChannel('#global-rules')}
                style={[styles.channelItem, guildChannel === '#global-rules' && styles.channelItemActive]}
              >
                <Text style={styles.channelHash}>✓</Text>
                <Text style={[styles.channelName, guildChannel === '#global-rules' && styles.channelNameActive]}>Global Campaign Rules</Text>
              </Pressable>
              <Pressable
                onPress={() => setGuildChannel('#content-rewards')}
                style={[styles.channelItem, guildChannel === '#content-rewards' && styles.channelItemActive]}
              >
                <Text style={styles.channelHash}>💰</Text>
                <Text style={[styles.channelName, guildChannel === '#content-rewards' && styles.channelNameActive]}>Content Rewards ($875 & $1,297)</Text>
              </Pressable>
            </View>

            {/* Interactive Guild Chat Stream */}
            <View style={styles.guildChatBox}>
              <View style={styles.guildChatHeader}>
                <Text style={styles.guildChatTitle}>{guildChannel}</Text>
                <Text style={styles.guildChatSub}>Live Creator Discord Stream</Text>
              </View>

              {guildMessages.map((m) => (
                <View key={m.id} style={styles.guildMessageRow}>
                  <View style={styles.guildAvatar}>
                    <Text style={styles.guildAvatarText}>{m.user[0]}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={styles.guildMessageAuthor}>{m.user}</Text>
                      <View style={styles.guildRoleBadge}>
                        <Text style={styles.guildRoleText}>{m.role}</Text>
                      </View>
                      <Text style={styles.guildMessageTime}>{m.time}</Text>
                    </View>
                    <Text style={styles.guildMessageBody}>{m.text}</Text>
                  </View>
                </View>
              ))}

              <View style={styles.guildInputRow}>
                <TextInput
                  placeholder={`Message ${guildChannel}...`}
                  placeholderTextColor={colors.faint}
                  value={guildInput}
                  onChangeText={setGuildInput}
                  style={styles.guildTextInput}
                />
                <Button small label="Send" onPress={handleSendGuildMessage} disabled={!guildInput.trim()} />
              </View>
            </View>
          </ScrollView>
        </View>
      ) : null}

      {/* TAB 3: CREATORS CORNER (Matching Client Screenshot) */}
      {mainTab === 'creators' ? (
        <ScrollView style={{ flex: 1, padding: 14 }} contentContainerStyle={{ paddingBottom: 36 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Pressable
                onPress={() => setMainTab('reels')}
                style={styles.backToReelsBtn}
              >
                <Text style={styles.backToReelsText}>‹ Reels</Text>
              </Pressable>
              <View>
                <Text style={styles.cornerMainTitle}>Creators Corner</Text>
                <Text style={styles.cornerSubtitle}>20,732 total · Trending</Text>
              </View>
            </View>
            <Pressable
              style={styles.pitchBtn}
              onPress={() => setShowPublishModal(true)}
            >
              <Text style={styles.pitchBtnText}>＋ Submit Work</Text>
            </Pressable>
          </View>

          {/* Category Chips matching screenshot */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 16 }}>
            {['All', 'Entertainment', 'Fitness', 'E-Commerce', 'AI', 'Freelance', 'Ministry Media'].map((cat) => (
              <View key={cat} style={styles.cornerCatChip}>
                <Text style={styles.cornerCatChipText}>{cat}</Text>
              </View>
            ))}
          </ScrollView>

          {/* Card 1: Creators Corner $875.00 */}
          <View style={styles.cornerCard}>
            <Image
              source={{ uri: 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?auto=format&fit=crop&w=600&q=80' }}
              style={styles.cornerCardImg}
            />
            <View style={styles.cornerPriceBadge}>
              <Text style={styles.cornerPriceText}>$875.00</Text>
            </View>
            <View style={styles.cornerCardBody}>
              <Text style={styles.cornerCardTitle}>CREATORS CORNER</Text>
              <Text style={styles.cornerCardRating}>★ 4.96 (24)</Text>
              <Text style={styles.cornerCardTagline}>Unlock Your Creative Potential</Text>
              <Text style={styles.cornerCardDesc}>
                Produce top-tier viral Christian reels, sermon shorts, and gospel media. High escrow rewards for verified editors.
              </Text>
              <Button
                label="Apply for $875.00 Bounty →"
                onPress={() => {
                  setNewTitle('Creators Corner Submission');
                  setShowPublishModal(true);
                }}
                style={{ marginTop: 12 }}
              />
            </View>
          </View>

          {/* Card 2: Kingdom Media Lead $1,297.00 */}
          <View style={[styles.cornerCard, { marginTop: 16 }]}>
            <Image
              source={{ uri: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=600&q=80' }}
              style={styles.cornerCardImg}
            />
            <View style={[styles.cornerPriceBadge, { backgroundColor: colors.forest }]}>
              <Text style={styles.cornerPriceText}>$1,297.00</Text>
            </View>
            <View style={styles.cornerCardBody}>
              <Text style={styles.cornerCardTitle}>GLOBAL CAMPAIGN LEAD</Text>
              <Text style={styles.cornerCardRating}>★ 5.0 (38)</Text>
              <Text style={styles.cornerCardTagline}>Direct Multi-Channel Evangelism</Text>
              <Text style={styles.cornerCardDesc}>
                Lead video creators and distribute faith content to reach 1M+ views across YouTube, Instagram, and TikTok.
              </Text>
              <Button
                label="Apply for $1,297.00 Bounty →"
                onPress={() => {
                  setNewTitle('Global Campaign Submission');
                  setShowPublishModal(true);
                }}
                style={{ marginTop: 12 }}
              />
            </View>
          </View>
        </ScrollView>
      ) : null}

      {/* Multi-Media Publishing Suite Modal (Post content, Post video, Upload images, Upload videos) */}
      <Modal visible={showPublishModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.publishSheet}>
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>Create & Upload to Socials</Text>
                <Text style={styles.sheetSubtitle}>Post content, videos & photos with live preview</Text>
              </View>
              <Pressable onPress={() => setShowPublishModal(false)} hitSlop={12}>
                <Text style={{ color: colors.muted, fontSize: 18, fontWeight: '700' }}>✕</Text>
              </Pressable>
            </View>

            {/* 4 Mode Selector: Post Content | Post Video | Upload Images | Upload Videos */}
            <View style={styles.publishModeRow}>
              {[
                { id: 'upload_videos', label: 'Upload Videos', icon: 'video' },
                { id: 'post_video', label: 'Post a Video', icon: 'play' },
                { id: 'upload_images', label: 'Upload Images', icon: 'sparkles' },
                { id: 'post_content', label: 'Post a Content', icon: 'edit' },
              ].map((m) => (
                <Pressable
                  key={m.id}
                  onPress={() => setPublishMode(m.id)}
                  style={[styles.publishModeTab, publishMode === m.id && styles.publishModeTabActive]}
                >
                  <Text style={[styles.publishModeText, publishMode === m.id && styles.publishModeTextActive]}>
                    {m.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 20 }}>
              {/* MODE 1 & 2: UPLOAD VIDEOS & POST VIDEO (WITH LIVE VIDEO PREVIEW) */}
              {publishMode === 'upload_videos' || publishMode === 'post_video' ? (
                <>
                  <Text style={styles.label}>Select Video to Upload</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, marginVertical: 6 }}>
                    {SAMPLE_VIDEOS.map((v) => (
                      <Pressable
                        key={v.id}
                        onPress={() => setSelectedMediaUrl(v.url)}
                        style={[styles.mediaOptionCard, selectedMediaUrl === v.url && styles.mediaOptionCardActive]}
                      >
                        <Icon name="video" size={16} color={selectedMediaUrl === v.url ? colors.gold : colors.muted} />
                        <Text style={[styles.mediaOptionText, selectedMediaUrl === v.url && { color: colors.gold, fontWeight: '700' }]}>
                          {v.title}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>

                  {/* LIVE VIDEO PREVIEW PLAYER (Solves 'Mo place to upload videos here sir') */}
                  <UploadVideoPreview videoUrl={selectedMediaUrl} />

                  <Text style={styles.label}>Caption & Key Message</Text>
                  <TextInput
                    placeholder="What is the Holy Spirit speaking through this video?"
                    placeholderTextColor={colors.faint}
                    value={newTitle}
                    onChangeText={setNewTitle}
                    multiline
                    style={[styles.input, { minHeight: 65 }]}
                  />

                  <Text style={styles.label}>Scripture Reference</Text>
                  <TextInput
                    placeholder="e.g. Philippians 4:13"
                    placeholderTextColor={colors.faint}
                    value={newScripture}
                    onChangeText={setNewScripture}
                    style={styles.input}
                  />

                  <Text style={styles.label}>Category</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginVertical: 6 }}>
                    {['Sermons', 'Worship', 'Testimonies', 'Bible Study', 'Evangelism'].map((cat) => (
                      <Pressable
                        key={cat}
                        onPress={() => setNewCategory(cat)}
                        style={[styles.catChip, newCategory === cat && styles.catChipActive]}
                      >
                        <Text style={[styles.catChipText, newCategory === cat && { color: colors.gold, fontWeight: '600' }]}>{cat}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>

                  <Button
                    label="✓ Publish Video to Socials Feed"
                    onPress={handlePublish}
                    disabled={!newTitle.trim()}
                    style={{ marginTop: 16 }}
                  />
                </>
              ) : null}

              {/* MODE 3: UPLOAD IMAGES (WITH LIVE PHOTO PREVIEW) */}
              {publishMode === 'upload_images' ? (
                <>
                  <Text style={styles.label}>Select Photo to Upload</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, marginVertical: 6 }}>
                    {SAMPLE_IMAGES.map((img) => (
                      <Pressable
                        key={img.id}
                        onPress={() => setSelectedImageUrl(img.url)}
                        style={[styles.mediaOptionCard, selectedImageUrl === img.url && styles.mediaOptionCardActive]}
                      >
                        <Icon name="sparkles" size={16} color={selectedImageUrl === img.url ? colors.gold : colors.muted} />
                        <Text style={[styles.mediaOptionText, selectedImageUrl === img.url && { color: colors.gold, fontWeight: '700' }]}>
                          {img.title}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>

                  {/* LIVE IMAGE PREVIEW */}
                  <View style={styles.imagePreviewBox}>
                    <Image source={{ uri: selectedImageUrl }} style={styles.imagePreviewImg} />
                    <View style={styles.modalPreviewBadge}>
                      <Text style={styles.modalPreviewBadgeText}>PHOTO PREVIEW</Text>
                    </View>
                  </View>

                  <Text style={styles.label}>Photo Caption</Text>
                  <TextInput
                    placeholder="Share the inspiration behind this photo..."
                    placeholderTextColor={colors.faint}
                    value={newTitle}
                    onChangeText={setNewTitle}
                    multiline
                    style={[styles.input, { minHeight: 65 }]}
                  />

                  <Text style={styles.label}>Scripture Reference</Text>
                  <TextInput
                    placeholder="e.g. Psalm 23:1"
                    placeholderTextColor={colors.faint}
                    value={newScripture}
                    onChangeText={setNewScripture}
                    style={styles.input}
                  />

                  <Button
                    label="✓ Publish Photo to Socials Feed"
                    onPress={handlePublish}
                    disabled={!newTitle.trim()}
                    style={{ marginTop: 16 }}
                  />
                </>
              ) : null}

              {/* MODE 4: POST A CONTENT (TEXT / DEVOTIONAL) */}
              {publishMode === 'post_content' ? (
                <>
                  <Text style={styles.label}>Card Theme Color</Text>
                  <View style={{ flexDirection: 'row', gap: 10, marginVertical: 8 }}>
                    {['#0F172A', '#1E1B4B', '#064E3B', '#3B0764'].map((color) => (
                      <Pressable
                        key={color}
                        onPress={() => setContentTheme(color)}
                        style={[styles.themePill, { backgroundColor: color }, contentTheme === color && styles.themePillActive]}
                      />
                    ))}
                  </View>

                  <View style={[styles.contentPreviewCard, { backgroundColor: contentTheme }]}>
                    <Text style={styles.contentPreviewCardText}>
                      {textContent.trim() || 'Your devotional message or testimony will appear formatted like this in believers’ feeds.'}
                    </Text>
                    <Text style={styles.contentPreviewCardRef}>
                      {newScripture.trim() ? `— ${newScripture}` : '— Scripture'}
                    </Text>
                  </View>

                  <Text style={styles.label}>Devotion / Faith Testimony</Text>
                  <TextInput
                    placeholder="Share what the Lord has done or a Scripture meditation..."
                    placeholderTextColor={colors.faint}
                    value={textContent}
                    onChangeText={setTextContent}
                    multiline
                    style={[styles.input, { minHeight: 90 }]}
                  />

                  <Text style={styles.label}>Scripture Reference</Text>
                  <TextInput
                    placeholder="e.g. Romans 8:28"
                    placeholderTextColor={colors.faint}
                    value={newScripture}
                    onChangeText={setNewScripture}
                    style={styles.input}
                  />

                  <Button
                    label="✓ Publish Faith Post to Feed"
                    onPress={handlePublish}
                    disabled={!textContent.trim()}
                    style={{ marginTop: 16 }}
                  />
                </>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Virtual Gifts Store Modal */}
      <Modal visible={showGiftStore} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.giftModalSheet}>
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>Send Virtual Gift</Text>
                <Text style={styles.sheetSubtitle}>Bless and support Christian creators</Text>
              </View>
              <View style={styles.coinBalanceBadge}>
                <Icon name="coin" size={16} color={colors.gold} />
                <Text style={styles.coinBalanceText}>{state.coins} Coins</Text>
              </View>
            </View>

            <View style={styles.giftGrid}>
              {GIFTS.map((g) => {
                const iconMeta = GIFT_ICONS[g.id] || { name: 'sparkles', color: colors.gold };
                return (
                  <Pressable
                    key={g.id}
                    onPress={() => handleSendGift(g)}
                    style={styles.giftCard}
                  >
                    <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: iconMeta.color + '18', alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}>
                      <Icon name={iconMeta.name} size={24} color={iconMeta.color} />
                    </View>
                    <Text style={styles.giftNameText}>{g.name}</Text>
                    <Text style={styles.giftDescText}>{g.desc}</Text>
                    <View style={styles.giftPricePill}>
                      <Icon name="coin" size={12} color={colors.gold} />
                      <Text style={styles.giftPriceText}>{g.price} coins</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.refillRow}>
              <Button
                small
                kind="ghost"
                label="＋ Refill 250 Coins ($2.99)"
                onPress={() => {
                  dispatch({ type: 'buyCoins', amount: 250 });
                  Alert.alert('Success', 'Added 250 coins to your balance!');
                }}
              />
              <Button small kind="ghost" label="Close" onPress={() => setShowGiftStore(false)} />
            </View>
          </View>
        </View>
      </Modal>

      {/* Comments & Replies Modal */}
      <Modal visible={showComments} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.commentsSheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>
                {activeVideo?.comments?.length || 0} Comments
              </Text>
              <Pressable onPress={() => setShowComments(false)} hitSlop={12}>
                <Text style={{ color: colors.muted, fontSize: 16 }}>✕</Text>
              </Pressable>
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }}>
              {activeVideo?.comments?.map((c) => (
                <View key={c.id} style={styles.commentBlock}>
                  <View style={styles.commentAvatar}>
                    <Text style={styles.commentAvatarText}>{c.from.slice(0, 2).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.commentAuthor}>{c.from} · <Text style={{ color: colors.faint }}>{c.time}</Text></Text>
                    <Text style={styles.commentBody}>{c.text}</Text>
                    <Pressable onPress={() => setReplyingTo(c)} style={{ marginTop: 4 }}>
                      <Text style={styles.replyActionText}>Reply</Text>
                    </Pressable>

                    {c.replies?.map((r) => (
                      <View key={r.id} style={styles.replyItem}>
                        <Text style={styles.replyAuthor}>{r.from} · <Text style={{ color: colors.faint }}>{r.time}</Text></Text>
                        <Text style={styles.replyBody}>{r.text}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </ScrollView>

            {replyingTo ? (
              <View style={styles.replyingBar}>
                <Text style={styles.replyingText}>Replying to {replyingTo.from}</Text>
                <Pressable onPress={() => setReplyingTo(null)}>
                  <Text style={{ color: colors.muted }}>✕</Text>
                </Pressable>
              </View>
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
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.screen,
  },
  topBar: {
    position: 'absolute',
    top: 10,
    left: 16,
    right: 16,
    zIndex: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tabContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(12, 20, 17, 0.75)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  feedTab: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignItems: 'center',
  },
  feedTabText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.muted,
  },
  feedTabTextActive: {
    fontFamily: fonts.sansMedium,
    fontWeight: '700',
    color: colors.fg,
  },
  feedTabUnderline: {
    width: 14,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.gold,
    marginTop: 2,
  },
  tabDivider: {
    color: colors.borderStrong,
    marginHorizontal: 4,
  },
  createBtn: {
    backgroundColor: colors.primaryBg,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  createBtnText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    fontWeight: '600',
    color: colors.primaryFg,
  },
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
    height: 120,
    zIndex: 2,
  },
  bottomGradientScrim: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 360,
    zIndex: 2,
  },
  videoPlayerGraphic: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  videoScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
  },
  centerPlayBadge: {
    position: 'absolute',
    top: '45%',
    left: '50%',
    marginLeft: -32,
    marginTop: -32,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 15,
  },
  ambientCategoryBadge: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 2,
    color: colors.gold,
    fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  ambientDurationText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
  },
  bottomInfo: {
    position: 'absolute',
    bottom: 20,
    left: 14,
    right: 76,
    zIndex: 10,
  },
  categoryBadgePill: {
    backgroundColor: 'rgba(245, 158, 11, 0.25)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.45)',
    paddingHorizontal: 7,
    paddingVertical: 1.5,
    borderRadius: 8,
  },
  categoryBadgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 9.5,
    fontWeight: '800',
    color: '#FBBF24',
    letterSpacing: 0.8,
  },
  creatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  creatorAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.forest,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 3,
  },
  creatorAvatarText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  creatorName: {
    fontFamily: fonts.sansMedium,
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  verifiedDot: {
    width: 15,
    height: 15,
    borderRadius: 7.5,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  creatorHandle: {
    fontFamily: fonts.sans,
    fontSize: 11.5,
    color: 'rgba(255, 255, 255, 0.85)',
    marginTop: 1,
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  followBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.5)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
  },
  followBtnActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    borderColor: '#10B981',
  },
  followBtnText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11.5,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  followBtnTextActive: {
    color: '#10B981',
  },
  captionText: {
    fontFamily: fonts.sans,
    fontSize: 13.5,
    color: '#FFFFFF',
    lineHeight: 19.5,
    marginBottom: 8,
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  scripturePill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.45)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    marginBottom: 8,
  },
  scriptureText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11.5,
    fontWeight: '700',
    color: '#FBBF24',
    marginLeft: 5,
  },
  hashtagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  hashtagText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11.5,
    color: '#34D399',
    fontWeight: '600',
  },
  soundRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  soundText: {
    fontFamily: fonts.sans,
    fontSize: 11.5,
    color: 'rgba(255, 255, 255, 0.9)',
  },
  rightRail: {
    position: 'absolute',
    right: 12,
    bottom: 20,
    alignItems: 'center',
    gap: 14,
    zIndex: 12,
  },
  railAction: {
    alignItems: 'center',
  },
  railIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 3,
  },
  railIconCircleLiked: {
    backgroundColor: 'rgba(244, 63, 94, 0.3)',
    borderColor: '#F43F5E',
  },
  railIconCircleGift: {
    backgroundColor: 'rgba(245, 158, 11, 0.3)',
    borderColor: '#FBBF24',
  },
  railCount: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  musicDiscBox: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#0F172A',
    borderWidth: 2,
    borderColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  musicDiscInner: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#047857',
    alignItems: 'center',
    justifyContent: 'center',
  },
  musicDiscText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  giftToast: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    zIndex: 30,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.gold,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  giftToastText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.gold,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  giftModalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    maxHeight: '65%',
  },
  commentsSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    height: '60%',
  },
  publishSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    height: '70%',
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
    paddingBottom: 10,
  },
  sheetTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 15,
    fontWeight: '600',
    color: colors.fg,
  },
  sheetSubtitle: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
  },
  coinBalanceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.raised,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.gold,
  },
  coinBalanceText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    fontWeight: '700',
    color: colors.gold,
  },
  giftGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginVertical: 10,
  },
  giftCard: {
    width: (SCREEN_WIDTH - 56) / 2,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  giftIconLarge: {
    fontSize: 28,
    marginBottom: 4,
  },
  giftNameText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    fontWeight: '600',
    color: colors.fg,
  },
  giftDescText: {
    fontFamily: fonts.sans,
    fontSize: 10,
    color: colors.muted,
    textAlign: 'center',
    marginVertical: 4,
  },
  giftPricePill: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: 4,
  },
  giftPriceText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: colors.gold,
    fontWeight: '600',
  },
  refillRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
  },
  commentBlock: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  commentAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentAvatarText: {
    fontFamily: fonts.sansMedium,
    fontSize: 10,
    color: colors.fg,
  },
  commentAuthor: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    fontWeight: '600',
    color: colors.fg,
  },
  commentBody: {
    fontFamily: fonts.sans,
    fontSize: 12.5,
    color: colors.passage,
    marginTop: 2,
    lineHeight: 17,
  },
  replyActionText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.gold,
  },
  replyItem: {
    backgroundColor: colors.raised,
    padding: 8,
    borderRadius: 8,
    marginTop: 6,
    borderLeftWidth: 2,
    borderLeftColor: colors.borderStrong,
  },
  replyAuthor: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    fontWeight: '600',
    color: colors.fg,
  },
  replyBody: {
    fontFamily: fonts.sans,
    fontSize: 11.5,
    color: colors.muted,
    marginTop: 1,
  },
  replyingBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: colors.raised,
    borderRadius: 6,
    marginBottom: 6,
  },
  replyingText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
  },
  commentInputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
  },
  commentInput: {
    flex: 1,
    backgroundColor: colors.raised,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 7,
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.fg,
  },
  label: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.muted,
    marginTop: 10,
    marginBottom: 4,
  },
  input: {
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.fg,
  },
  catChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  catChipActive: {
    borderColor: colors.gold,
    backgroundColor: colors.surface,
  },
  catChipText: {
    fontFamily: fonts.sans,
    fontSize: 11.5,
    color: colors.muted,
  },

  // Edge-to-Edge Floating Top Navigation Bar (Pure Mobile Reels Experience)
  floatingTopBar: {
    position: 'absolute',
    top: 10,
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
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
    marginRight: 5,
  },
  floatingGuildText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
    marginRight: 4,
  },
  floatingCornerBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingCreateBtn: {
    backgroundColor: '#059669',
    borderWidth: 1,
    borderColor: '#10B981',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
  },
  floatingCreateText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  backToReelsBtn: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    marginRight: 6,
  },
  backToReelsText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11.5,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  guildNavBadge: {
    backgroundColor: '#F43F5E',
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  guildNavBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
  },
  reelsSubBarCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    paddingHorizontal: 16,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  feedTab: {
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  feedTabText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.65)',
  },
  feedTabTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  feedTabUnderline: {
    width: 14,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#10B981',
    marginTop: 2,
  },
  tabDivider: {
    color: 'rgba(255, 255, 255, 0.25)',
    fontSize: 12,
    marginHorizontal: 4,
  },

  // Discord-style Clip Farm Guild Styles
  guildContainer: {
    flex: 1,
    backgroundColor: '#1E1F22',
  },
  guildHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#2B2D31',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1F2023',
  },
  guildLogoCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#22C55E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  guildLogoText: {
    color: '#FFFFFF',
    fontFamily: fonts.serifBold,
    fontSize: 17,
    fontWeight: '800',
  },
  guildName: {
    color: '#FFFFFF',
    fontFamily: fonts.sansMedium,
    fontSize: 15,
    fontWeight: '700',
  },
  guildMeta: {
    color: '#94A3B8',
    fontFamily: fonts.sans,
    fontSize: 11,
    marginTop: 2,
  },
  guildCopyBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  guildCopyBtnText: {
    color: '#E2E8F0',
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    fontWeight: '600',
  },

  channelCategory: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
  },
  categoryTitle: {
    color: '#94A3B8',
    fontFamily: fonts.sansMedium,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  unreadPill: {
    backgroundColor: colors.rose,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  unreadPillText: {
    color: '#FFFFFF',
    fontSize: 9.5,
    fontWeight: '700',
  },
  channelItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 6,
    marginTop: 4,
  },
  channelItemActive: {
    backgroundColor: '#35373C',
  },
  channelHash: {
    color: '#94A3B8',
    fontSize: 14,
  },
  channelName: {
    color: '#94A3B8',
    fontFamily: fonts.sans,
    fontSize: 13,
  },
  channelNameActive: {
    color: '#FFFFFF',
    fontFamily: fonts.sansMedium,
    fontWeight: '600',
  },

  guildChatBox: {
    marginHorizontal: 12,
    marginTop: 14,
    backgroundColor: '#2B2D31',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#383A40',
  },
  guildChatHeader: {
    borderBottomWidth: 1,
    borderBottomColor: '#383A40',
    paddingBottom: 8,
    marginBottom: 10,
  },
  guildChatTitle: {
    color: '#FFFFFF',
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    fontWeight: '700',
  },
  guildChatSub: {
    color: '#94A3B8',
    fontFamily: fonts.sans,
    fontSize: 10.5,
    marginTop: 2,
  },
  guildMessageRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  guildAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.forest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guildAvatarText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  guildMessageAuthor: {
    color: '#FFFFFF',
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    fontWeight: '700',
  },
  guildRoleBadge: {
    backgroundColor: 'rgba(217, 119, 6, 0.25)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  guildRoleText: {
    color: colors.gold,
    fontSize: 9,
    fontWeight: '700',
  },
  guildMessageTime: {
    color: '#64748B',
    fontSize: 9.5,
  },
  guildMessageBody: {
    color: '#E2E8F0',
    fontFamily: fonts.sans,
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  guildInputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#383A40',
    paddingTop: 8,
    marginTop: 6,
  },
  guildTextInput: {
    flex: 1,
    backgroundColor: '#383A40',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    color: '#FFFFFF',
    fontFamily: fonts.sans,
    fontSize: 12.5,
  },

  // Creators Corner Marketplace Styles
  cornerMainTitle: {
    fontFamily: fonts.serifBold,
    fontSize: 18,
    color: colors.fg,
  },
  cornerSubtitle: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.gold,
    marginTop: 2,
    fontWeight: '600',
  },
  pitchBtn: {
    backgroundColor: colors.forest,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  pitchBtnText: {
    color: '#FFFFFF',
    fontFamily: fonts.sansMedium,
    fontSize: 11.5,
    fontWeight: '700',
  },
  cornerCatChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cornerCatChipText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
  },
  cornerCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  cornerCardImg: {
    width: '100%',
    height: 140,
    backgroundColor: colors.raised,
  },
  cornerPriceBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: colors.gold,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  cornerPriceText: {
    color: '#1A1405',
    fontFamily: fonts.sansMedium,
    fontSize: 12.5,
    fontWeight: '800',
  },
  cornerCardBody: {
    padding: 14,
  },
  cornerCardTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 15,
    fontWeight: '800',
    color: colors.fg,
    letterSpacing: 0.5,
  },
  cornerCardRating: {
    color: colors.gold,
    fontFamily: fonts.sans,
    fontSize: 11,
    marginTop: 2,
  },
  cornerCardTagline: {
    fontFamily: fonts.serifBold,
    fontSize: 13,
    color: colors.fg,
    marginTop: 4,
  },
  cornerCardDesc: {
    fontFamily: fonts.sans,
    fontSize: 11.5,
    color: colors.muted,
    marginTop: 4,
    lineHeight: 16,
  },

  // Multi-Media Publish Modal Styles
  publishModeRow: {
    flexDirection: 'row',
    gap: 6,
    marginVertical: 10,
    backgroundColor: colors.raised,
    padding: 4,
    borderRadius: 10,
  },
  publishModeTab: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    borderRadius: 7,
  },
  publishModeTabActive: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  publishModeText: {
    fontFamily: fonts.sans,
    fontSize: 10.5,
    color: colors.muted,
  },
  publishModeTextActive: {
    fontFamily: fonts.sansMedium,
    fontWeight: '700',
    color: colors.fg,
  },

  modalPreviewBox: {
    height: 150,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    marginVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#0F172A',
  },
  modalPreviewPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalPreviewPlaceholderText: {
    color: colors.muted,
    fontFamily: fonts.sans,
    fontSize: 11,
    marginTop: 6,
  },
  modalPreviewScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
  },
  modalPreviewBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  modalPreviewBadgeText: {
    color: colors.gold,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  mediaOptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  mediaOptionCardActive: {
    borderColor: colors.gold,
    backgroundColor: colors.surface,
  },
  mediaOptionText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
  },

  imagePreviewBox: {
    height: 150,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    marginVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  imagePreviewImg: {
    width: '100%',
    height: '100%',
  },

  themePill: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  themePillActive: {
    borderColor: colors.gold,
  },
  contentPreviewCard: {
    padding: 16,
    borderRadius: 12,
    marginVertical: 10,
    minHeight: 110,
    justifyContent: 'center',
  },
  contentPreviewCardText: {
    color: '#FFFFFF',
    fontFamily: fonts.serif,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  contentPreviewCardRef: {
    color: colors.gold,
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 8,
  },
});
