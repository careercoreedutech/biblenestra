import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Icon } from '../components/Icons';
import { colors, fonts } from '../theme';
import { useStore } from '../store';
import { useNav } from '../navigation';
import { GIFTS } from '../data/seed';
import { Button, Tag, Badge } from '../components/ui';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const VIDEO_THEMES = ['#0F172A', '#1E1B4B', '#064E3B', '#3B0764', '#1E293B'];

const GIFT_ICONS = {
  g_rose: { name: 'sun', color: colors.rose },
  g_bouquet: { name: 'sparkles', color: colors.forest },
  g_star: { name: 'star', color: colors.gold },
  g_crown: { name: 'cross', color: colors.lavender },
};

function VideoReelItem({
  item,
  index,
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
    <Pressable activeOpacity={0.95} onPress={togglePlayback} style={[styles.videoCard, { backgroundColor: cardBg }]}>
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
          <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="video" size={30} color="#FFFFFF" />
          </View>
          <Text style={styles.ambientCategoryBadge}>{item.category.toUpperCase()}</Text>
          <Text style={styles.ambientDurationText}>{item.duration}</Text>
        </View>
      )}

      {/* Scrim Overlay for high-contrast typography */}
      <View style={styles.videoScrim} pointerEvents="none" />

      {/* Tap Feedback Badge */}
      {showPlayIcon ? (
        <View style={styles.centerPlayBadge} pointerEvents="none">
          <Icon name={isPlaying ? 'play' : 'video'} size={34} color="#FFFFFF" />
        </View>
      ) : null}

      {/* Top Category Badge */}
      <View style={styles.topCategoryOverlay} pointerEvents="none">
        <Text style={styles.ambientCategoryBadge}>{item.category.toUpperCase()}</Text>
        <Text style={styles.ambientDurationText}>{item.duration}</Text>
      </View>

      {/* Bottom Information Overlay (Creator & Caption) */}
      <View style={styles.bottomInfo}>
        <View style={styles.creatorRow}>
          <View style={styles.creatorAvatar}>
            <Text style={styles.creatorAvatarText}>{item.creator.avatar}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Text style={styles.creatorName}>{item.creator.name}</Text>
              {item.creator.verified ? (
                <View style={[styles.verifiedDot, { backgroundColor: colors.forest }]}>
                  <Icon name="check" size={9} color="#FFFFFF" strokeWidth={3} />
                </View>
              ) : null}
            </View>
            <Text style={styles.creatorHandle}>{item.creator.handle} · {item.creator.church}</Text>
          </View>
          <Pressable
            onPress={onFollow}
            style={[styles.followBtn, isFollowing && styles.followBtnActive]}
          >
            <Text style={[styles.followBtnText, isFollowing && { color: colors.fg }]}>
              {isFollowing ? 'Following' : 'Follow'}
            </Text>
          </Pressable>
        </View>

        <Text style={styles.captionText}>{item.caption}</Text>

        {item.scripture ? (
          <Pressable onPress={onOpenBible} style={styles.scripturePill}>
            <Icon name="book" size={12} color={colors.goldLight} />
            <Text style={[styles.scriptureText, { marginLeft: 4 }]}>{item.scripture} · Read Context</Text>
          </Pressable>
        ) : null}

        <View style={styles.hashtagRow}>
          {item.hashtags?.map((tag, idx) => (
            <Text key={idx} style={styles.hashtagText}>{tag}</Text>
          ))}
        </View>

        {/* Audio Track Row */}
        <View style={styles.soundRow}>
          <Icon name="audio" size={12} color="rgba(255, 255, 255, 0.7)" />
          <Text style={[styles.soundText, { marginLeft: 6 }]} numberOfLines={1}>{item.sound}</Text>
        </View>
      </View>

      {/* Right Side Vertical Interaction Rail with Vector Icons */}
      <View style={styles.rightRail}>
        {/* Like Button */}
        <Pressable onPress={onLike} style={styles.railAction}>
          <View style={[styles.railIconCircle, isLiked && { backgroundColor: colors.rose, borderColor: colors.rose }]}>
            <Icon name="heart" size={22} color="#FFFFFF" fill={isLiked ? '#FFFFFF' : 'none'} />
          </View>
          <Text style={styles.railCount}>{item.likes}</Text>
        </Pressable>

        {/* Comment Button */}
        <Pressable onPress={onComment} style={styles.railAction}>
          <View style={styles.railIconCircle}>
            <Icon name="chat" size={20} color="#FFFFFF" />
          </View>
          <Text style={styles.railCount}>{item.comments?.length || 0}</Text>
        </Pressable>

        {/* Virtual Gifting Button */}
        <Pressable onPress={onGift} style={styles.railAction}>
          <View style={[styles.railIconCircle, { borderColor: colors.goldLight, backgroundColor: 'rgba(245, 158, 11, 0.3)' }]}>
            <Icon name="gift" size={20} color={colors.goldLight} />
          </View>
          <Text style={[styles.railCount, { color: colors.goldLight, fontWeight: '700' }]}>
            {item.gifts || 0}
          </Text>
        </Pressable>

        {/* Share Button */}
        <Pressable onPress={onShare} style={styles.railAction}>
          <View style={styles.railIconCircle}>
            <Icon name="share" size={19} color="#FFFFFF" />
          </View>
          <Text style={styles.railCount}>{item.shares}</Text>
        </Pressable>

        {/* Repost Button */}
        <Pressable onPress={onRepost} style={styles.railAction}>
          <View style={styles.railIconCircle}>
            <Icon name="repost" size={19} color="#FFFFFF" />
          </View>
          <Text style={styles.railCount}>{item.reposts || 0}</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

export default function SocialsScreen() {
  const { state, dispatch } = useStore();
  const nav = useNav();
  const [activeTab, setActiveTab] = useState('Recommended'); // 'Following' | 'Recommended'
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [showComments, setShowComments] = useState(false);
  const [showGiftStore, setShowGiftStore] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [giftSuccess, setGiftSuccess] = useState(null);
  const [commentText, setCommentText] = useState('');
  const [replyingTo, setReplyingTo] = useState(null);

  // Video publishing state
  const [newTitle, setNewTitle] = useState('');
  const [newScripture, setNewScripture] = useState('');
  const [newCategory, setNewCategory] = useState('Worship');
  const [newHashtags, setNewHashtags] = useState('#Faith #Grace #Jesus');

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
    if (!newTitle.trim()) return;
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
      videoUrl: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
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
  };

  return (
    <View style={styles.container}>
      {/* Top Floating Feed Switcher & Publish Button */}
      <View style={styles.topBar}>
        <View style={styles.tabContainer}>
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

        <Pressable onPress={() => setShowPublishModal(true)} style={styles.createBtn}>
          <Text style={styles.createBtnText}>＋ Create</Text>
        </Pressable>
      </View>

      {/* Gift Celebration Toast */}
      {giftSuccess ? (
        <View style={styles.giftToast}>
          <Icon name="gift" size={16} color={colors.gold} />
          <Text style={styles.giftToastText}>{giftSuccess}</Text>
        </View>
      ) : null}

      {/* Main Full-Screen Vertical Feed List */}
      <FlatList
        data={activeTab === 'Following' ? (videos.filter((v) => state.follows?.includes(v.creator.handle)).length ? videos.filter((v) => state.follows?.includes(v.creator.handle)) : videos) : videos}
        keyExtractor={(item) => item.id}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          const index = Math.round(e.nativeEvent.contentOffset.y / (SCREEN_HEIGHT - 105));
          setActiveIndex(index);
          if (videos[index]) setSelectedVideo(videos[index]);
        }}
        renderItem={({ item, index }) => (
          <VideoReelItem
            item={item}
            index={index}
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

            {/* Gift Options Grid with Vector Icons */}
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

                    {/* Nested Replies */}
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

            {/* Comment Composer */}
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

      {/* Video Publishing Modal */}
      <Modal visible={showPublishModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.publishSheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Publish Christian Video</Text>
              <Pressable onPress={() => setShowPublishModal(false)} hitSlop={12}>
                <Text style={{ color: colors.muted, fontSize: 16 }}>✕</Text>
              </Pressable>
            </View>

            <ScrollView style={{ flex: 1 }}>
              <Text style={styles.label}>Caption & Key Message</Text>
              <TextInput
                placeholder="What is the Holy Spirit speaking through this video?"
                placeholderTextColor={colors.faint}
                value={newTitle}
                onChangeText={setNewTitle}
                multiline
                style={[styles.input, { minHeight: 70 }]}
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
                {['Sermons', 'Worship', 'Testimonies', 'Bible Study', 'Christian Comedy', 'Evangelism'].map((cat) => (
                  <Pressable
                    key={cat}
                    onPress={() => setNewCategory(cat)}
                    style={[styles.catChip, newCategory === cat && styles.catChipActive]}
                  >
                    <Text style={[styles.catChipText, newCategory === cat && { color: colors.gold, fontWeight: '600' }]}>{cat}</Text>
                  </Pressable>
                ))}
              </ScrollView>

              <Text style={styles.label}>Hashtags</Text>
              <TextInput
                placeholder="#Worship #Jesus #Faith"
                placeholderTextColor={colors.faint}
                value={newHashtags}
                onChangeText={setNewHashtags}
                style={styles.input}
              />

              <Button
                label="Publish to Socials Feed"
                onPress={handlePublish}
                disabled={!newTitle.trim()}
                style={{ marginTop: 20 }}
              />
            </ScrollView>
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
  videoPlayerGraphic: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  topCategoryOverlay: {
    position: 'absolute',
    top: 55,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 10,
  },
  videoScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
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
    paddingHorizontal: 16,
    paddingBottom: 22,
    width: SCREEN_WIDTH - 76,
  },
  creatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  creatorAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  creatorAvatarText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    fontWeight: '700',
    color: colors.fg,
  },
  creatorName: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    fontWeight: '600',
    color: colors.fg,
  },
  verifiedDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.forest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  creatorHandle: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
  },
  followBtn: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  followBtnActive: {
    backgroundColor: colors.raised,
    borderColor: colors.border,
  },
  followBtnText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    fontWeight: '600',
    color: colors.gold,
  },
  captionText: {
    fontFamily: fonts.sans,
    fontSize: 13.5,
    color: colors.fg,
    lineHeight: 19,
    marginBottom: 6,
  },
  scripturePill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(20, 32, 27, 0.85)',
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginBottom: 6,
  },
  scriptureText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: colors.gold,
  },
  hashtagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  hashtagText: {
    fontFamily: fonts.sans,
    fontSize: 11.5,
    color: colors.sage,
  },
  soundRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  soundText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
  },
  rightRail: {
    position: 'absolute',
    right: 12,
    bottom: 24,
    alignItems: 'center',
    gap: 16,
  },
  railAction: {
    alignItems: 'center',
  },
  railIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(20, 32, 27, 0.85)',
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 3,
  },
  railCount: {
    fontFamily: fonts.sans,
    fontSize: 10.5,
    color: colors.fg,
    fontWeight: '600',
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
});
