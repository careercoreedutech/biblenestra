// CHAT 7.3 — one row of the Messages list (memoised: only the chat that changed re-renders).
// ~46 dp circular avatar (online dot for DMs), semibold name, relative time top-right, one-line grey preview
// ("You: …" with ticks, "Grace: …" in groups, "🎤 Voice note (0:42)", live "Typing…"), rounded unread badge.
import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Icon } from '../Icons';
import { SocialAvatar } from '../social/FeedCard';
import { colors } from '../../theme';
import { useTypingNames, useReceipts, usePresence } from '../../chat/live';
import { relTime, typingLabel, messageStatus } from '../../chat/messages';
import { isMutedNow } from './ChatGaps'; // CHAT GAPS: a timed mute that ran out shows as unmuted

const AV = 46;

function MiniTicks({ status }) {
  if (!status || status === 'sending' || status === 'failed') return null;
  const color = status === 'read' ? colors.primary : colors.faint;
  return (
    <Svg width={status === 'sent' ? 12 : 16} height={10} viewBox={status === 'sent' ? '0 0 11 10' : '0 0 15 10'} fill="none" style={{ marginRight: 3 }}>
      <Path d="M1 5.5l2.8 2.8L10 2" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
      {status !== 'sent' ? <Path d="M6.5 8.3L13.5 2" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" /> : null}
    </Svg>
  );
}

export function ChatAvatar({ c, size = AV, online }) {
  if (c.kind === 'group' || c.kind === 'channel') {
    if (c.avatarUrl) return <SocialAvatar name={c.with} uri={c.avatarUrl} size={size} />;
    return (
      <View style={[styles.groupIcon, { width: size, height: size, borderRadius: size / 2 }, c.kind === 'channel' && { backgroundColor: colors.cardGold }]}>
        <Icon name={c.kind === 'channel' ? 'volume' : 'users'} size={Math.round(size * 0.42)} color={c.kind === 'channel' ? colors.gold : colors.primary} />
      </View>
    );
  }
  return (
    <View>
      <SocialAvatar name={c.with} uri={c.otherUser && c.otherUser.avatarUrl} size={size} />
      {online ? <View style={styles.onlineDot} /> : null}
    </View>
  );
}

function ChatListRowInner({ c, onPress, myId }) {
  const typing = useTypingNames(c.id);
  const receipts = useReceipts(c.id);
  const presence = usePresence(c.id);
  const isGroup = c.kind === 'group' || c.kind === 'channel';
  const unread = c.unreadCount || c.unread || 0;
  const lm = c.lastMessage;
  const mineLast = !!lm && !!myId && lm.senderId === myId;
  const at = (lm && lm.createdAt) || c.lastMessageAt || null;
  const time = at ? relTime(at) : (lm && lm.time) || c.time || '';
  const typingText = typingLabel(typing, isGroup);
  let preview = lm ? (lm.deleted ? 'This message was deleted' : lm.text || 'Attachment') : (c.last || (isGroup ? 'No messages yet' : 'Say hello 👋'));
  if (lm && !lm.deleted && lm.kind !== 'system') {
    if (mineLast) preview = `You: ${preview}`;
    else if (isGroup && lm.senderName) preview = `${lm.senderName.split(' ')[0]}: ${preview}`;
  }
  const status = mineLast && lm && lm.kind !== 'system' ? messageStatus({ id: lm.id, mine: true, createdAt: lm.createdAt }, receipts) : null;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.raised }]} accessibilityRole="button" accessibilityLabel={`${c.with}. ${typingText || preview}${unread ? `. ${unread} unread` : ''}`}>
      <ChatAvatar c={c} online={!isGroup && presence && presence.online} />
      <View style={styles.mid}>
        <View style={styles.line}>
          <Text style={styles.name} numberOfLines={1}>{c.with}</Text>
          <Text style={[styles.time, unread && !isMutedNow(c) ? { color: colors.primary, fontWeight: '600' } : null]}>{time}</Text>
        </View>
        <View style={styles.line}>
          {typingText ? (
            <Text style={[styles.preview, styles.typing]} numberOfLines={1}>{typingText}</Text>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 }}>
              {status ? <MiniTicks status={status} /> : null}
              <Text style={[styles.preview, lm && lm.deleted && { fontStyle: 'italic' }]} numberOfLines={1}>{preview}</Text>
            </View>
          )}
          {isMutedNow(c) ? <Icon name="volume" size={13} color={colors.faint} /> : null}
          {unread ? <View style={[styles.badge, isMutedNow(c) && { backgroundColor: colors.faint }]}><Text style={styles.badgeText}>{unread > 99 ? '99+' : unread}</Text></View> : null}
        </View>
      </View>
    </Pressable>
  );
}

export const ChatListRow = memo(ChatListRowInner, (a, b) => a.c === b.c && a.myId === b.myId && a.onPress === b.onPress);

export const CHAT_ROW_HEIGHT = 72;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 13, height: CHAT_ROW_HEIGHT, paddingHorizontal: 16 },
  mid: { flex: 1, minWidth: 0, gap: 3 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontSize: 15.5, fontWeight: '600', color: colors.fg },
  time: { fontSize: 11.5, color: colors.faint },
  preview: { flex: 1, fontSize: 13.5, color: colors.muted },
  typing: { color: colors.primary, fontStyle: 'italic' },
  badge: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 11, fontWeight: '700', color: '#FFFFFF' },
  groupIcon: { backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  onlineDot: { position: 'absolute', right: 1, bottom: 1, width: 12, height: 12, borderRadius: 6, backgroundColor: colors.positive || '#2FA36B', borderWidth: 2, borderColor: colors.surface },
});
