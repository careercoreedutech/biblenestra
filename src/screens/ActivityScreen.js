// SOCIAL (round 3) — Activity inbox: in-app notifications (comment likes, gifts, …) from GET /me/notifications.
// Tapping a comment like / comment gift opens the post with that comment visible; a profile gift opens the sender.
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../components/Icons';
import { colors, fonts, radius, shadow } from '../theme';
import { Screen, Empty, alpha, Button, Badge } from '../components/ui';
import { FadeInUp, PressScale } from '../components/Motion';
import { useToast } from '../components/Toast';
import { useStore } from '../store';
import { useSync } from '../api/sync';
import { useApi } from '../api/auth';
import { useNav } from '../navigation';
import { mapNotification } from '../api/mappers';
import { SocialAvatar } from '../components/social/FeedCard';
import { isServerId } from '../api/social';
import { BroadcastLogo, BroadcastPreview, BroadcastSheet } from '../components/BroadcastMessage'; // BROADCASTS
import GoldNotificationCard, { GoldPill } from '../components/GoldNotificationCard'; // NOTIFICATIONS: black-and-gold cards
import { deliveredMoments, openTarget } from '../notifications/daily'; // NOTIFICATIONS: today's moments
import { imageFor, GOLD } from '../notifications/imagery'; // NOTIFICATIONS
import { useDailyToday } from '../api/daily'; // NOTIFICATIONS: today's Daily Bread for the Scripture card
import { relTime } from '../components/social/shared'; // NOTIFICATIONS

// NOTIFICATIONS: every inbox kind rendered as a black-and-gold card (emoji-led gold title, white body,
// cinematic image, gold CTA). Behaviour (what a tap opens) stays in open() below.
const GOLD_KIND = {
  comment_like: { emoji: '❤️', title: 'Comment like', cta: 'View comment', image: 'encouragement' },
  gift: { emoji: '🎁', title: 'Gift received', cta: 'View', image: 'encouragement' },
  message: { emoji: '💬', title: 'New message', cta: 'Open Chats', image: 'community' },
  request: { emoji: '💬', title: 'Message request', cta: 'Open Chats', image: 'community' },
  group: { emoji: '👥', title: 'Church Community', cta: 'Open Community', image: 'community' },
  prayer: { emoji: '🙏', title: 'A Moment of Prayer', cta: 'Open Prayer', image: 'prayer' },
  care: { emoji: '🤝', title: 'Christian Care Network', cta: 'Open Care', image: 'prayer' },
  event: { emoji: '📅', title: 'Event', cta: 'Open Calendar', image: 'community' },
  job: { emoji: '💼', title: 'Jobs', cta: 'Open Jobs', image: 'companion' },
  announcement: { emoji: '✨', title: 'BibleNestra', cta: 'Open Today', image: 'scripture' },
  follow: { emoji: '👤', title: 'New follower', cta: null, image: null },
  contest: { emoji: '🏆', title: 'Contest', cta: 'Open Contest', image: 'scripture' },
  battle: { emoji: '🔥', title: 'Bible Battle', cta: 'Open Battle', image: 'scripture' },
  live: { emoji: '🔴', title: 'LIVE NOW', cta: 'Join live service', image: 'broadcast' },
  website: { emoji: '🌐', title: 'Member websites', cta: 'Open Websites', image: 'companion' },
  broadcast: { emoji: '📣', title: 'Official message', cta: 'Read message', image: 'broadcast' },
};
// "🔴 LIVE NOW!" already leads with an emoji → don't add a second one
const startsWithEmoji = (s) => { const cp = String(s || '').trim().codePointAt(0) || 0; return (cp >= 0x2190 && cp <= 0x2bff) || cp >= 0x1f000; };
const lead = (emoji, title) => (startsWithEmoji(title) ? String(title).trim() : `${emoji} ${title}`);
function goldCardFor(n) {
  const g = GOLD_KIND[n.kind] || { emoji: '🔔', title: 'Update', cta: 'Open', image: 'scripture' };
  const d = n.data || {};
  if (n.kind === 'broadcast') {
    const media = Array.isArray(d.media) ? d.media : [];
    const first = media[0];
    const thumb = first ? (first.type === 'video' ? first.thumbUrl : first.url) : null;
    return { title: lead(g.emoji, d.title || n.title || g.title), body: d.text || n.body, cta: g.cta, image: thumb || imageFor('broadcast') };
  }
  if (n.kind === 'prayer' && d.action === 'candle') {
    return { title: `🕯️ ${String(n.title || 'A candle was lit').replace(/\s*🕯️?\s*$/, '')}`, quote: (n.body || '').replace(/^“|”$/g, ''), reflection: 'Someone is standing with you in prayer.', cta: 'Open Prayer', image: imageFor('encouragement') };
  }
  if (n.kind === 'prayer') {
    return { title: lead(g.emoji, n.title || g.title), quote: (n.body || '').replace(/^“|”$/g, ''), reflection: 'Take a moment to pray.', cta: g.cta, image: imageFor('prayer') };
  }
  if (n.kind === 'live') {
    return { title: lead(g.emoji, n.title || g.title), body: n.body, cta: d.action || g.cta, image: d.thumbnail || d.thumbUrl || (d.videoId ? `https://i.ytimg.com/vi/${d.videoId}/hqdefault.jpg` : imageFor('broadcast')) };
  }
  if (n.kind === 'follow') return { title: lead(g.emoji, n.title || g.title), body: n.title ? n.body : null, cta: null, image: null };
  const title = n.title && n.body ? n.title : g.title;
  return { title: lead(g.emoji, title), body: n.body || n.title, cta: g.cta, image: g.image ? imageFor(g.image) : null };
}

const KIND = {
  comment_like: { icon: 'heart', tint: colors.rose, label: 'Comment like' },
  gift: { icon: 'gift', tint: colors.gold, label: 'Gift' },
  message: { icon: 'chat', tint: colors.primary, label: 'Message' },
  request: { icon: 'chat', tint: colors.primary, label: 'Request' },
  group: { icon: 'users', tint: colors.sage, label: 'Group' },
  prayer: { icon: 'prayer', tint: colors.lavender, label: 'Prayer' },
  event: { icon: 'calendar', tint: colors.sky, label: 'Event' },
  job: { icon: 'briefcase', tint: colors.sky, label: 'Jobs' },
  announcement: { icon: 'bell', tint: colors.gold, label: 'BibleNestra' }, // ROUND 5
  follow: { icon: 'user', tint: colors.teal, label: 'New follower' },
  contest: { icon: 'star', tint: colors.gold, label: 'Contest' },
  battle: { icon: 'flame', tint: colors.terracotta, label: 'Bible Battle' },
  live: { icon: 'live', tint: colors.rose, label: 'Bible Nestra · Live' }, // YOUTUBE LIVE
  website: { icon: 'link', tint: colors.teal, label: 'Member websites' }, // MEMBER WEBSITES
  broadcast: { icon: 'bell', tint: colors.primary, label: 'Official message' }, // BROADCASTS
};

/** Unread count of the in-app inbox (for header badges). */
export function useUnreadActivity() {
  const { state } = useStore();
  return (state.notificationsList || []).filter((n) => !n.read).length;
}

export default function ActivityScreen({ params = {} }) {
  const [broadcast, setBroadcast] = useState(null); // BROADCASTS: the official message open in the detail sheet
  const nav = useNav();
  const toast = useToast();
  const { state, dispatch } = useStore();
  const sync = useSync();
  const api = useApi();
  const [loading, setLoading] = useState(sync.online);
  const [pulling, setPulling] = useState(false);
  const items = state.notificationsList || [];
  // NOTIFICATIONS: the daily moments that have arrived today/yesterday (local, so they work offline)
  const today = useDailyToday();
  const moments = deliveredMoments(state, Date.now(), { bread: today.data && today.data.bread }).slice(0, 4);

  const load = useCallback(async () => {
    if (!sync.online) return;
    try {
      const r = await api.request('GET', '/me/notifications?limit=50');
      const list = (r.items || []).map(mapNotification);
      dispatch({ type: 'serverSync', patch: { notificationsList: list }, local: true });
      if (list.some((n) => !n.read)) {
        api.request('POST', '/me/notifications/read', {}).catch(() => {});
      }
    } catch (e) {
      toast.show('Couldn’t load your activity', { tone: 'error' });
    } finally {
      setLoading(false);
    }
  }, [sync.online]);

  const latest = React.useRef(items);
  latest.current = items;
  useEffect(() => { load(); }, [load]);
  // Leaving the screen marks everything as read on the device too
  useEffect(() => () => {
    if (sync.online) dispatch({ type: 'serverSync', patch: { notificationsList: (latest.current || []).map((n) => ({ ...n, read: true })) }, local: true });
  }, []);

  // BROADCASTS: a tapped "official message" push opens Activity with { broadcastId } → show that message
  useEffect(() => {
    if (!params.broadcastId) return;
    const hit = items.find((x) => x.kind === 'broadcast' && x.data && x.data.broadcastId === params.broadcastId);
    setBroadcast(hit || { id: params.broadcastId, kind: 'broadcast', data: { broadcastId: params.broadcastId } });
  }, [params.broadcastId, !!items.length]);

  const open = (n) => {
    const d = n.data || {};
    if (n.kind === 'broadcast') { setBroadcast(n); return; } // BROADCASTS: detail sheet (records "opened")
    if (typeof d.screen === 'string' && /^FundMe/.test(d.screen)) { nav.push(d.screen, { id: d.fundraiserId, fundraiserId: d.fundraiserId, donationId: d.donationId }); return; } // FUND ME MONEY: receipts, payouts, credits
    if (/^fundme_/.test(String(n.kind)) && isServerId(d.fundraiserId)) { nav.push('Fundraiser', { id: d.fundraiserId }); return; } // FUND ME
    if ((n.kind === 'comment_like' || n.kind === 'gift') && isServerId(d.postId)) {
      nav.push('Socials', { postId: d.postId, commentId: d.commentId || undefined });
      return;
    }
    if ((n.kind === 'gift' || n.kind === 'follow') && isServerId(d.fromId)) { nav.push('UserProfile', { id: d.fromId, name: d.fromName }); return; }
    if (n.kind === 'message' || n.kind === 'request') { nav.push('ChatList'); return; }
    if (n.kind === 'prayer' && isServerId(d.prayerId)) { nav.push('Prayer', { id: d.prayerId }); return; } // LIGHT A CANDLE: grouped support notices
    if (n.kind === 'care') { nav.push('Care'); return; } // CARE NETWORK: priest verification
    if (n.kind === 'prayer') { nav.push('PrayerWall'); return; }
    if (n.kind === 'event') { nav.push('Calendar'); return; }
    if (n.kind === 'job') { nav.push('Jobs'); return; }
    if (n.kind === 'battle') { if (isServerId(d.battleId)) nav.push('Battle', { id: d.battleId }); else nav.push('Contests', { tab: 'Battles' }); return; }
    if (n.kind === 'contest' && d.submissionId && isServerId(d.submissionId)) { nav.push('ContestEntry', { id: d.submissionId }); return; }
    if (n.kind === 'contest' && d.certificate) { nav.push('Certificate', { code: d.certificate }); return; }
    if (n.kind === 'contest') { if (isServerId(d.contestId)) nav.push('Contest', { id: d.contestId }); else nav.push('Contests'); return; }
    if (n.kind === 'website') { nav.push('Websites'); return; } // MEMBER WEBSITES
    if (n.kind === 'live') { if (d.videoId) nav.push('YouTubeWatch', { videoId: d.videoId, title: d.videoTitle, channelTitle: d.channelTitle, live: true }); else nav.push('Watch'); return; } // YOUTUBE LIVE
    if (n.kind === 'announcement') { nav.reset(); return; } // ROUND 5: back to the tabs (the card is on Today)
  };

  const refresh = async () => { setPulling(true); await load(); setPulling(false); };

  return (
    <Screen back title="Notifications" subtitle="A moment with God · every day" refreshControl={sync.online ? <RefreshControl refreshing={pulling} onRefresh={refresh} tintColor={colors.primary} colors={[colors.primary]} /> : undefined}>
      {/* NOTIFICATIONS: today's moments with God (local daily notifications) */}
      {moments.length ? (
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Today’s moments</Text>
          <PressScale onPress={() => nav.push('NotificationSettings', {})} scaleTo={0.94} hitSlop={8} accessibilityRole="button" accessibilityLabel="Choose notification times">
            <Text style={styles.sectionAction}>Choose times →</Text>
          </PressScale>
        </View>
      ) : null}
      {moments.map((m, i) => (
        <FadeInUp key={m.id} index={i} distance={8} duration={320}>
          <GoldNotificationCard card={m} time={relTime(m.at, 'Just now')} onPress={() => openTarget(nav, m.target, m.params)} />
        </FadeInUp>
      ))}
      {moments.length && items.length ? <Text style={[styles.sectionTitle, { marginTop: 8, marginBottom: 10 }]}>Activity</Text> : null}
      {loading && !items.length ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : !items.length ? (
        moments.length ? null : (
          <View style={styles.emptyBox}>
            <Empty title="No activity yet" body={sync.online ? 'When someone likes your comment or sends you a gift, you’ll see it here.' : 'Activity from other people appears here when you’re signed in online.'} action="Choose daily moments" onAction={() => nav.push('NotificationSettings', {})} />
          </View>
        )
      ) : items.map((n, i) => {
        const from = (n.data && n.data.fromName) || null;
        const isFollow = n.kind === 'follow';
        const fromId = n.data && n.data.fromId;
        const isFollowingThem = fromId ? (state.follows || []).includes(fromId) : false;
        const card = goldCardFor(n);
        const sender = n.kind === 'broadcast' ? ((n.data && n.data.sender && n.data.sender.name) || 'BibleNestra') : from && !isFollow ? from : 'BibleNestra';
        return (
          <FadeInUp key={n.id} index={i + moments.length} distance={8} duration={320}>
            <GoldNotificationCard card={card} time={n.time} unread={!n.read} sender={sender} onPress={() => open(n)}>
              {isFollow && fromId ? (
                isFollowingThem ? (
                  <GoldPill label="Following ✓" filled />
                ) : (
                  <GoldPill
                    label="+ Follow back"
                    onPress={async () => {
                      try {
                        dispatch({ type: 'follow', id: fromId, local: true });
                        await api.request('POST', `/users/${fromId}/follow`, { following: true });
                        toast.show(`Following ${from || 'them'} · You can now chat!`, { icon: 'check', haptic: 'success' });
                        sync.refresh({ quiet: true });
                      } catch (e) {
                        toast.show(`Could not follow back${e && e.message ? `: ${e.message}` : ''}`, { tone: 'error' });
                      }
                    }}
                  />
                )
              ) : null}
            </GoldNotificationCard>
          </FadeInUp>
        );
      })}
      <BroadcastSheet item={broadcast} onClose={() => setBroadcast(null)} />{/* BROADCASTS */}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { paddingVertical: 48, alignItems: 'center' },
  emptyBox: { backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border, paddingVertical: 10, marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 10, ...shadow.sm },
  rowUnread: { borderColor: alpha(colors.primary, 0.32) },
  iconCircle: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  kindBadge: { position: 'absolute', right: -3, bottom: -3, width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  body: { fontSize: 14, lineHeight: 19.5, color: colors.fg },
  meta: { fontSize: 11.5, color: colors.faint, marginTop: 4, fontWeight: '600' },
  liveTitle: { fontSize: 14, fontWeight: '800', color: colors.rose, marginBottom: 2 }, // YOUTUBE LIVE
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary },
  // NOTIFICATIONS: black-and-gold centre
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, marginTop: 2 },
  sectionTitle: { fontFamily: fonts.serifBold, fontSize: 18, color: colors.fg },
  sectionAction: { fontSize: 13, fontWeight: '800', color: colors.gold },
});
