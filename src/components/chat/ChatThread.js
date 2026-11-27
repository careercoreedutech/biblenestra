// CHAT 7.3 — the message list: virtualised (inverted FlatList: opens at the newest message with no scroll jump),
// memoised rows, day separators, grouped consecutive bubbles, system lines ("Grace added Daniel"), swipe right
// to reply, ticks (sending / sent / delivered / read), "Not sent · tap to retry", a live "Typing…" bubble and
// older history when you scroll up.
import React, { forwardRef, memo, useCallback, useImperativeHandle, useMemo, useRef } from 'react';
import { ActivityIndicator, Animated, FlatList, PanResponder, Platform, StyleSheet, Text, View } from 'react-native';
import { colors, radius } from '../../theme';
import { ChatMessage } from './MessageKit';
import { dayLabel, messageStatus, sortThread } from '../../chat/messages';

const GROUP_GAP_MS = 5 * 60e3;
const SWIPE_TRIGGER = 56;

function dayKeyOf(ms) { const d = new Date(ms || Date.now()); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }

// newest-first rows for the inverted list
function buildRows(messages) {
  const list = sortThread(messages);
  const rows = [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i];
    const prev = list[i - 1];
    const next = list[i + 1];
    const sameAsPrev = !!prev && !prev.system && !m.system && prev.senderId === m.senderId && prev.mine === m.mine
      && (m.createdAt || 0) - (prev.createdAt || 0) < GROUP_GAP_MS && dayKeyOf(prev.createdAt) === dayKeyOf(m.createdAt);
    const sameAsNext = !!next && !next.system && !m.system && next.senderId === m.senderId && next.mine === m.mine
      && (next.createdAt || 0) - (m.createdAt || 0) < GROUP_GAP_MS && dayKeyOf(next.createdAt) === dayKeyOf(m.createdAt);
    rows.push({ key: m.id, type: m.system ? 'system' : 'msg', m, first: !sameAsPrev, last: !sameAsNext });
    if (!prev || dayKeyOf(prev.createdAt) !== dayKeyOf(m.createdAt)) {
      rows.push({ key: `day_${dayKeyOf(m.createdAt)}_${m.id}`, type: 'day', label: dayLabel(m.createdAt || Date.now()) });
    }
  }
  return rows;
}

// Swipe right on a bubble → reply (like WhatsApp). Vertical scrolling is never captured.
function SwipeToReply({ enabled, onReply, children }) {
  const x = useRef(new Animated.Value(0)).current;
  const fired = useRef(false);
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => enabled && g.dx > 14 && Math.abs(g.dy) < 10,
    onPanResponderMove: (_, g) => {
      const dx = Math.max(0, Math.min(90, g.dx));
      x.setValue(dx);
      if (dx > SWIPE_TRIGGER && !fired.current) { fired.current = true; }
    },
    onPanResponderRelease: () => {
      if (fired.current && onReply) onReply();
      fired.current = false;
      Animated.spring(x, { toValue: 0, useNativeDriver: Platform.OS !== 'web', bounciness: 6 }).start();
    },
    onPanResponderTerminate: () => { fired.current = false; Animated.spring(x, { toValue: 0, useNativeDriver: Platform.OS !== 'web' }).start(); },
  }), [enabled, onReply]);
  if (!enabled) return children;
  const hint = x.interpolate({ inputRange: [0, SWIPE_TRIGGER], outputRange: [0, 1], extrapolate: 'clamp' });
  return (
    <View>
      <Animated.View pointerEvents="none" aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.swipeHint, { opacity: hint, transform: [{ scale: hint }] }]}>
        <Text style={styles.swipeHintText}>↩</Text>
      </Animated.View>
      <Animated.View style={{ transform: [{ translateX: x }] }} {...pan.panHandlers}>{children}</Animated.View>
    </View>
  );
}

const MessageRow = memo(function MessageRow({ row, isGroup, status, highlighted, animate, handlers, renderContent }) {
  const { m } = row;
  const onLongPress = useCallback(() => handlers.current.onLongPress && handlers.current.onLongPress(m), [m]);
  const onReact = useCallback((e) => handlers.current.onReact && handlers.current.onReact(m, e), [m]);
  const onReply = useCallback(() => handlers.current.onSwipeReply && handlers.current.onSwipeReply(m), [m]);
  const onRetry = useCallback(() => handlers.current.onRetry && handlers.current.onRetry(m), [m]);
  const onOpenReply = useCallback((id) => handlers.current.onOpenReply && handlers.current.onOpenReply(id), []);
  return (
    <View style={{ marginTop: row.first ? 10 : 2 }}>
      <SwipeToReply enabled={!m.deleted && !!handlers.current.onSwipeReply} onReply={onReply}>
        <ChatMessage
          m={m}
          showSender={isGroup && row.first}
          grouped={!row.last}
          animate={animate}
          status={status}
          highlighted={highlighted}
          onLongPress={handlers.current.onLongPress ? onLongPress : undefined}
          onReact={handlers.current.onReact ? onReact : undefined}
          onOpenReply={onOpenReply}
          onRetry={onRetry}
        >
          {renderContent ? renderContent(m) : null}
        </ChatMessage>
      </SwipeToReply>
    </View>
  );
}, (a, b) => a.row.m === b.row.m && a.row.first === b.row.first && a.row.last === b.row.last && a.status === b.status
  && a.highlighted === b.highlighted && a.isGroup === b.isGroup && a.renderContent === b.renderContent);

function SystemRow({ m }) {
  return (
    <View style={styles.sysWrap}>
      <Text style={styles.sysText}>{m.text}</Text>
    </View>
  );
}

function DayRow({ label }) {
  return <View style={styles.dayWrap}><Text style={styles.dayText}>{label}</Text></View>;
}

export function TypingBubble({ names, isGroup }) {
  if (!names || !names.length) return null;
  return (
    <View style={styles.typing} accessibilityLiveRegion="polite">
      <View style={styles.typingDots}>
        <View style={styles.dot} /><View style={[styles.dot, { opacity: 0.7 }]} /><View style={[styles.dot, { opacity: 0.45 }]} />
      </View>
      <Text style={styles.typingText}>{isGroup ? `${names.length === 1 ? names[0] : `${names.length} people`} typing…` : 'typing…'}</Text>
    </View>
  );
}

/**
 * props: messages, isGroup, receipts, typingNames, highlight, header (top of history), loadingOlder,
 *        onLongPress(m), onReact(m, emoji), onOpenReply(id), onSwipeReply(m), onRetry(m), onLoadOlder(), renderContent(m)
 * ref:   scrollToMessage(id) → boolean, scrollToBottom()
 */
export const ChatThread = forwardRef(function ChatThread(props, ref) {
  const { messages, isGroup, receipts, typingNames, highlight, header, loadingOlder, onLoadOlder, renderContent, contentStyle, online = true } = props;
  const listRef = useRef(null);
  const handlers = useRef(props);
  handlers.current = props;
  const rows = useMemo(() => buildRows(messages || []), [messages]);
  // bubbles that appear after the first render glide in; the initial screenful does not (no mount storm)
  const seen = useRef(null);
  if (seen.current === null) seen.current = new Set((messages || []).map((m) => m.id));

  useImperativeHandle(ref, () => ({
    scrollToMessage(id) {
      const index = rows.findIndex((r) => r.m && r.m.id === id);
      if (index < 0 || !listRef.current) return false;
      listRef.current.scrollToIndex({ index, viewPosition: 0.5, animated: true });
      return true;
    },
    scrollToBottom() { if (listRef.current) listRef.current.scrollToOffset({ offset: 0, animated: true }); },
  }), [rows]);

  const renderItem = useCallback(({ item }) => {
    if (item.type === 'day') return <DayRow label={item.label} />;
    if (item.type === 'system') return <SystemRow m={item.m} />;
    const animate = !seen.current.has(item.m.id);
    if (animate) seen.current.add(item.m.id);
    return (
      <MessageRow
        row={item}
        isGroup={isGroup}
        status={online ? messageStatus(item.m, receipts) : (item.m.mine ? (item.m.status === 'failed' ? 'failed' : 'sent') : null)}
        highlighted={highlight === item.m.id}
        animate={animate}
        handlers={handlers}
        renderContent={renderContent}
      />
    );
  }, [isGroup, receipts, highlight, renderContent, online]);

  return (
    <FlatList
      ref={listRef}
      inverted
      data={rows}
      keyExtractor={(r) => r.key}
      renderItem={renderItem}
      extraData={`${receipts && receipts.readAt}|${receipts && receipts.deliveredAt}|${highlight}`}
      style={{ flex: 1 }}
      contentContainerStyle={[styles.content, contentStyle]}
      ListHeaderComponent={<TypingBubble names={typingNames} isGroup={isGroup} />}
      ListFooterComponent={loadingOlder ? <ActivityIndicator style={{ marginVertical: 14 }} color={colors.muted} /> : header || null}
      onEndReached={onLoadOlder}
      onEndReachedThreshold={0.4}
      initialNumToRender={18}
      maxToRenderPerBatch={12}
      windowSize={11}
      removeClippedSubviews={Platform.OS === 'android'}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      showsVerticalScrollIndicator={false}
      onScrollToIndexFailed={(info) => {
        if (!listRef.current) return;
        listRef.current.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
        setTimeout(() => listRef.current && listRef.current.scrollToIndex({ index: info.index, viewPosition: 0.5, animated: true }), 120);
      }}
    />
  );
});

const styles = StyleSheet.create({
  content: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 14 },
  dayWrap: { alignItems: 'center', marginTop: 16, marginBottom: 4 },
  dayText: { fontSize: 11, fontFamily: 'DMSans-SemiBold', color: colors.muted, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, overflow: 'hidden' },
  sysWrap: { alignItems: 'center', marginVertical: 6, paddingHorizontal: 20 },
  sysText: { fontSize: 12, lineHeight: 17, color: colors.muted, textAlign: 'center', backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, overflow: 'hidden' },
  swipeHint: { position: 'absolute', left: 4, top: 0, bottom: 0, justifyContent: 'center' },
  swipeHintText: { fontSize: 18, color: colors.primary, fontFamily: 'DMSans-Bold' },
  typing: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', marginTop: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, borderBottomLeftRadius: 6, paddingVertical: 8, paddingHorizontal: 12 },
  typingDots: { flexDirection: 'row', gap: 3 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.muted },
  typingText: { fontSize: 12.5, color: colors.muted, fontStyle: 'italic' },
});
