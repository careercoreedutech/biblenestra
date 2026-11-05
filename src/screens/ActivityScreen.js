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
};

/** Unread count of the in-app inbox (for header badges). */
export function useUnreadActivity() {
  const { state } = useStore();
  return (state.notificationsList || []).filter((n) => !n.read).length;
}

export default function ActivityScreen() {
  const nav = useNav();
  const toast = useToast();
  const { state, dispatch } = useStore();
  const sync = useSync();
  const api = useApi();
  const [loading, setLoading] = useState(sync.online);
  const [pulling, setPulling] = useState(false);
  const items = state.notificationsList || [];

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

  const open = (n) => {
    const d = n.data || {};
    if ((n.kind === 'comment_like' || n.kind === 'gift') && isServerId(d.postId)) {
      nav.push('Socials', { postId: d.postId, commentId: d.commentId || undefined });
      return;
    }
    if ((n.kind === 'gift' || n.kind === 'follow') && isServerId(d.fromId)) { nav.push('UserProfile', { id: d.fromId, name: d.fromName }); return; }
    if (n.kind === 'message' || n.kind === 'request') { nav.push('ChatList'); return; }
    if (n.kind === 'prayer') { nav.push('PrayerWall'); return; }
    if (n.kind === 'event') { nav.push('Calendar'); return; }
    if (n.kind === 'job') { nav.push('Jobs'); return; }
    if (n.kind === 'announcement') { nav.reset(); return; } // ROUND 5: back to the tabs (the card is on Today)
  };

  const refresh = async () => { setPulling(true); await load(); setPulling(false); };

  return (
    <Screen back title="Activity" subtitle="Likes, gifts and replies" refreshControl={sync.online ? <RefreshControl refreshing={pulling} onRefresh={refresh} tintColor={colors.primary} colors={[colors.primary]} /> : undefined}>
      {loading && !items.length ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : !items.length ? (
        <View style={styles.emptyBox}>
          <Empty title="No activity yet" body={sync.online ? 'When someone likes your comment or sends you a gift, you’ll see it here.' : 'Activity from other people appears here when you’re signed in online.'} action="Open Socials" onAction={() => nav.push('Socials', {})} />
        </View>
      ) : items.map((n, i) => {
        const k = KIND[n.kind] || { icon: 'bell', tint: colors.primary, label: 'Update' };
        const from = (n.data && n.data.fromName) || null;
        const isFollow = n.kind === 'follow';
        const fromId = n.data && n.data.fromId;
        const isFollowingThem = fromId ? (state.follows || []).includes(fromId) : false;

        return (
          <FadeInUp key={n.id} index={i} distance={8} duration={320}>
            <PressScale onPress={() => open(n)} scaleTo={0.98} style={[styles.row, !n.read && styles.rowUnread]} accessibilityLabel={n.body}>
              <PressScale
                onPress={() => (isServerId(n.data && n.data.fromId) ? nav.push('UserProfile', { id: n.data.fromId, name: from }) : open(n))}
                scaleTo={0.9}
                hitSlop={4}
                accessibilityLabel={from ? `Open ${from}'s profile` : k.label}
              >
                {from ? <SocialAvatar name={from} size={42} /> : <View style={[styles.iconCircle, { backgroundColor: alpha(k.tint, 0.13) }]}><Icon name={k.icon} size={18} color={k.tint} /></View>}
                {from ? <View style={[styles.kindBadge, { backgroundColor: k.tint }]}><Icon name={k.icon} size={10} color="#FFFFFF" fill={k.icon === 'heart' ? 'solid' : 'none'} /></View> : null}
              </PressScale>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.body} numberOfLines={4}>{n.body || n.title}</Text>
                <Text style={styles.meta}>{k.label} · {n.time}</Text>
              </View>
              {isFollow && fromId ? (
                isFollowingThem ? (
                  <Badge label="Following" tint={colors.primary} />
                ) : (
                  <Button
                    small
                    label="Follow back"
                    icon={<Icon name="plus" size={12} color="#FFFFFF" strokeWidth={2.6} />}
                    onPress={async () => {
                      try {
                        dispatch({ type: 'follow', id: fromId, local: true });
                        await api.request('POST', `/users/${fromId}/follow`);
                        toast.show(`Following ${from || 'them'} · You can now chat!`, { icon: 'check', haptic: 'success' });
                        sync.refresh({ quiet: true });
                      } catch (e) {
                        toast.show('Could not follow back', { tone: 'error' });
                      }
                    }}
                  />
                )
              ) : !n.read ? (
                <View style={styles.dot} />
              ) : null}
            </PressScale>
          </FadeInUp>
        );
      })}
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
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary },
});
