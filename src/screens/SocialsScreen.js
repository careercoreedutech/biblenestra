import React, { useState } from 'react';
import {
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
import { colors, fonts } from '../theme';
import { useStore } from '../store';
import { useNav } from '../navigation';
import { GIFTS } from '../data/seed';
import { Button, Tag, Badge } from '../components/ui';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function SocialsScreen() {
  const { state, dispatch } = useStore();
  const nav = useNav();
  const [activeTab, setActiveTab] = useState('Recommended'); // 'Following' | 'Recommended'
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
      alert(`Insufficient coins. You have ${state.coins} coins, but ${gift.name} costs ${gift.price} coins.`);
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
          <Text style={styles.giftToastText}>🎁 {giftSuccess}</Text>
        </View>
      ) : null}

      {/* Main Full-Screen Vertical Feed List */}
      <FlatList
        data={videos}
        keyExtractor={(item) => item.id}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          const index = Math.round(e.nativeEvent.contentOffset.y / (SCREEN_HEIGHT - 110));
          if (videos[index]) setSelectedVideo(videos[index]);
        }}
        renderItem={({ item }) => {
          const isLiked = item.liked;
          const isFollowing = state.follows?.includes(item.creator.handle);

          return (
            <View style={[styles.videoCard, { backgroundColor: item.bg || '#14201b' }]}>
              {/* Simulated Ambient Video Overlay */}
              <View style={styles.videoPlayerGraphic}>
                <Svg width={54} height={54} viewBox="0 0 24 24" fill="none">
                  <Circle cx={12} cy={12} r={10} stroke="rgba(244, 239, 227, 0.25)" strokeWidth={1.5} />
                  <Path d="M10 8.5l6 3.5-6 3.5V8.5z" fill={colors.gold} />
                </Svg>
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
                        <View style={styles.verifiedDot}>
                          <Text style={{ fontSize: 9, color: colors.primaryFg }}>✓</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.creatorHandle}>{item.creator.handle} · {item.creator.church}</Text>
                  </View>
                  <Pressable
                    onPress={() => dispatch({ type: 'follow', id: item.creator.handle })}
                    style={[styles.followBtn, isFollowing && styles.followBtnActive]}
                  >
                    <Text style={[styles.followBtnText, isFollowing && { color: colors.fg }]}>
                      {isFollowing ? 'Following' : 'Follow'}
                    </Text>
                  </Pressable>
                </View>

                <Text style={styles.captionText}>{item.caption}</Text>

                {item.scripture ? (
                  <Pressable
                    onPress={() => nav.push('Bible', { bookId: 'JHN', chapter: 3 })}
                    style={styles.scripturePill}
                  >
                    <Svg width={12} height={12} viewBox="0 0 24 24" fill="none" style={{ marginRight: 4 }}>
                      <Path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5z" stroke={colors.gold} strokeWidth={2} />
                    </Svg>
                    <Text style={styles.scriptureText}>{item.scripture} · Read Context</Text>
                  </Pressable>
                ) : null}

                <View style={styles.hashtagRow}>
                  {item.hashtags?.map((tag, idx) => (
                    <Text key={idx} style={styles.hashtagText}>{tag}</Text>
                  ))}
                </View>

                {/* Audio Track Row */}
                <View style={styles.soundRow}>
                  <Svg width={12} height={12} viewBox="0 0 24 24" fill="none" style={{ marginRight: 6 }}>
                    <Path d="M9 18V5l12-2v13M9 9l12-2" stroke={colors.sage} strokeWidth={1.8} />
                    <Circle cx={6} cy={18} r={3} stroke={colors.sage} strokeWidth={1.8} />
                    <Circle cx={18} cy={16} r={3} stroke={colors.sage} strokeWidth={1.8} />
                  </Svg>
                  <Text style={styles.soundText} numberOfLines={1}>{item.sound}</Text>
                </View>
              </View>

              {/* Right Side Vertical Interaction Rail */}
              <View style={styles.rightRail}>
                {/* Like Button */}
                <Pressable
                  onPress={() => dispatch({ type: 'likeVideo', id: item.id })}
                  style={styles.railAction}
                >
                  <View style={[styles.railIconCircle, isLiked && { backgroundColor: 'rgba(217, 83, 79, 0.2)' }]}>
                    <Svg width={22} height={22} viewBox="0 0 24 24" fill={isLiked ? colors.negative : 'none'}>
                      <Path
                        d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
                        stroke={isLiked ? colors.negative : colors.fg}
                        strokeWidth={1.8}
                      />
                    </Svg>
                  </View>
                  <Text style={styles.railCount}>{item.likes}</Text>
                </Pressable>

                {/* Comment Button */}
                <Pressable
                  onPress={() => {
                    setSelectedVideo(item);
                    setShowComments(true);
                  }}
                  style={styles.railAction}
                >
                  <View style={styles.railIconCircle}>
                    <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
                      <Path
                        d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
                        stroke={colors.fg}
                        strokeWidth={1.8}
                      />
                    </Svg>
                  </View>
                  <Text style={styles.railCount}>{item.comments?.length || 0}</Text>
                </Pressable>

                {/* Virtual Gifting Button (Coins/Gifts) */}
                <Pressable
                  onPress={() => {
                    setSelectedVideo(item);
                    setShowGiftStore(true);
                  }}
                  style={styles.railAction}
                >
                  <View style={[styles.railIconCircle, { borderColor: colors.gold, backgroundColor: colors.goldFaint }]}>
                    <Text style={{ fontSize: 17 }}>🎁</Text>
                  </View>
                  <Text style={[styles.railCount, { color: colors.gold }]}>
                    {item.gifts || 0}
                  </Text>
                </Pressable>

                {/* Share Button */}
                <Pressable
                  onPress={() => alert(`Shared "${item.caption.slice(0, 30)}..." to Christian Social network!`)}
                  style={styles.railAction}
                >
                  <View style={styles.railIconCircle}>
                    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                      <Path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13" stroke={colors.fg} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                  </View>
                  <Text style={styles.railCount}>{item.shares}</Text>
                </Pressable>

                {/* Repost Button */}
                <Pressable
                  onPress={() => alert('Reposted to your Christian Socials profile!')}
                  style={styles.railAction}
                >
                  <View style={styles.railIconCircle}>
                    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                      <Path d="M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3" stroke={colors.fg} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                  </View>
                  <Text style={styles.railCount}>{item.reposts}</Text>
                </Pressable>
              </View>
            </View>
          );
        }}
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
                <Text style={{ fontSize: 13, marginRight: 4 }}>🪙</Text>
                <Text style={styles.coinBalanceText}>{state.coins} Coins</Text>
              </View>
            </View>

            {/* Gift Options Grid */}
            <View style={styles.giftGrid}>
              {GIFTS.map((g) => (
                <Pressable
                  key={g.id}
                  onPress={() => handleSendGift(g)}
                  style={styles.giftCard}
                >
                  <Text style={styles.giftIconLarge}>{g.icon}</Text>
                  <Text style={styles.giftNameText}>{g.name}</Text>
                  <Text style={styles.giftDescText}>{g.desc}</Text>
                  <View style={styles.giftPricePill}>
                    <Text style={styles.giftPriceText}>🪙 {g.price} coins</Text>
                  </View>
                </Pressable>
              ))}
            </View>

            <View style={styles.refillRow}>
              <Button
                small
                kind="ghost"
                label="＋ Refill 250 Coins ($2.99)"
                onPress={() => {
                  dispatch({ type: 'buyCoins', amount: 250 });
                  alert('Added 250 coins to your balance!');
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
