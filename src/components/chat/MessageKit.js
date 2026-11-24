// Chat message kit (ROUND 4) — shared by direct chats and group channels.
//   <ChatMessage>          a bubble with reply quote, "Edited", pin mark, reactions; press and hold for actions
//   <MessageActionsSheet>  reactions + Reply · Copy · Edit · Pin · Delete (for me / for everyone)
//   <ComposerBanner>       "Replying to …" / "Editing message" above the composer
//   <PinnedBar>            newest pinned message; tap to jump, cycles through up to 3 pins
//   useMessageActions()    wires all of the above to the store for one thread (scope)
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import { Icon } from '../Icons';
import { AnimatedModal, FadeInUp, PressScale, ScaleIn } from '../Motion';
import { useToast } from '../Toast';
import { alpha } from '../ui';
import { colors, fonts, radius, shadow } from '../../theme';
import { useStore } from '../../store';
import { REACTIONS, canEditMessage, getScopeMsgs, pinnedOf, previewOf } from '../../chat/messages';
import { openLink } from '../EmbedViewer'; // YOUTUBE LIVE: video links open in-app
import { useNav } from '../../navigation';
import { LinkPreviewCard } from './ChatGaps'; // CHAT GAPS: link preview cards
import { GiftBubble } from '../gifts/GiftBubble'; // VIRTUAL GIFTS: kind 'gift' bubble

// ---------- small icons ----------
function PinGlyph({ size = 16, color = colors.fg, filled }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M9 3h6l-1 6 4 3v2H6v-2l4-3-1-6z" stroke={color} strokeWidth={1.9} strokeLinejoin="round" fill={filled ? color : 'none'} />
      <Path d="M12 14v7" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
    </Svg>
  );
}
function ReplyGlyph({ size = 16, color = colors.fg }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M10 8L5 12l5 4" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M5.5 12H14a5 5 0 015 5v1" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}
function CopyGlyph({ size = 16, color = colors.fg }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={8} y={8} width={12} height={12} rx={2.5} stroke={color} strokeWidth={1.9} />
      <Path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" stroke={color} strokeWidth={1.9} />
    </Svg>
  );
}
function BanGlyph({ size = 13, color = colors.faint }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 21a9 9 0 100-18 9 9 0 000 18zM5.6 5.6l12.8 12.8" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

const snippet = (m) => (m ? (m.deleted ? 'This message was deleted' : previewOf(m) || 'Message') : '');

// CHAT 7.3: ticks — sending (clock), sent ✓, delivered ✓✓, read ✓✓ (highlighted)
function Ticks({ status, mine }) {
  if (!status) return null;
  const base = mine ? 'rgba(255,255,255,0.7)' : colors.faint;
  if (status === 'sending') return <Icon name="clock" size={10} color={base} />;
  const read = status === 'read';
  const color = read ? (mine ? colors.goldLight : colors.primary) : base;
  return (
    <Svg width={status === 'sent' ? 11 : 15} height={10} viewBox={status === 'sent' ? '0 0 11 10' : '0 0 15 10'} fill="none" accessibilityLabel={status}>
      <Path d="M1 5.5l2.8 2.8L10 2" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
      {status !== 'sent' ? <Path d="M6.5 8.3L13.5 2" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" /> : null}
    </Svg>
  );
}
const STATUS_LABEL = { sending: 'Sending', sent: 'Sent', delivered: 'Delivered', read: 'Read' };

// Message text with tappable links (Google Meet invites, websites)
const URL_RE = /(https?:\/\/[^\s]+|\bmeet\.google\.com\/[a-z-]+)/gi;
function LinkedText({ text, style, linkStyle, onLongPress }) {
  const nav = useNav();
  const parts = String(text).split(URL_RE);
  if (parts.length === 1) return <Text style={style}>{text}</Text>;
  return (
    <Text style={style}>
      {parts.map((p, i) => (i % 2 === 1 ? (
        <Text
          key={i}
          style={linkStyle}
          accessibilityRole="link"
          onLongPress={onLongPress}
          onPress={() => openLink(/^https?:/i.test(p) ? p.replace(/[).,!?]+$/, '') : `https://${p}`, nav)}
        >{p}</Text>
      ) : p))}
    </Text>
  );
}

// ---------- bubble ----------
// FIND LOVE: optional bubble colours for one screen (null everywhere else → the default indigo / white bubbles).
//   { mine: ['#a', '#b'] gradient stops, theirs: '#bg', theirsBorder: '#line' }
export const BubbleTheme = createContext(null);
// status: 'sending'|'sent'|'delivered'|'read'|'failed' (CHAT 7.3; older callers pass nothing → m.status is used)
// grouped: another bubble from the same person follows (tighter corner); animate=false skips the entry animation
export function ChatMessage({ m, showSender, highlighted, onLongPress, onReact, onOpenReply, onLayout, onRetry, status: statusIn, grouped, animate = true, children }) {
  const mine = !!m.mine;
  const status = statusIn !== undefined ? statusIn : (mine ? (m.status === 'failed' ? 'failed' : m.status === 'read' ? 'read' : 'sent') : null);
  const failed = status === 'failed' || m.status === 'failed';
  const Wrap = animate ? FadeInUp : View;
  const wrapProps = animate ? { distance: mine ? 14 : 10, duration: 260 } : {};
  const deletedText = m.deleted
    ? (m.deletedByModerator ? 'Removed by a group admin' : mine ? 'You deleted this message' : 'This message was deleted')
    : null;
  const reactions = m.deleted ? [] : (m.reactions || []);
  const theme = useContext(BubbleTheme);
  const themed = theme && !m.deleted ? (mine ? { backgroundColor: theme.mine[1], borderColor: theme.mine[1], overflow: 'hidden' } : { backgroundColor: theme.theirs, borderColor: theme.theirsBorder }) : null;
  return (
    <View onLayout={onLayout} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '84%' }}>
      <Wrap {...wrapProps}>
        <Pressable
          onLongPress={onLongPress}
          onPress={failed && onRetry ? onRetry : undefined}
          delayLongPress={280}
          accessibilityHint={failed ? 'Not sent. Tap to send again' : 'Press and hold for reply, react, forward, copy, edit, pin or delete. Swipe right to reply'}
          style={({ pressed }) => [
            styles.msg, mine && styles.msgMine, grouped && (mine ? styles.groupedMine : styles.groupedTheirs), m.deleted && styles.msgDeleted, m.deleted && mine && styles.msgDeletedMine,
            themed, failed && styles.msgFailed, highlighted && styles.msgHighlight, pressed && { opacity: 0.92 },
          ]}
        >
          {themed && mine ? <LinearGradient colors={theme.mine} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" /> : null}
          {showSender && !mine && !m.shared ? <Text style={styles.msgFrom}>{m.from}</Text> : null}{/* MEMBERSHIP GROUPS: a shared MASTER CLASS card names its author itself */}
          {m.forwarded && !m.deleted ? <Text style={[styles.fwd, mine && { color: 'rgba(255,255,255,0.75)' }]}>↪ Forwarded</Text> : null}
          {m.reply && !m.deleted ? (
            <Pressable onPress={() => onOpenReply && onOpenReply(m.reply.id)} onLongPress={onLongPress} delayLongPress={280} style={[styles.quote, mine && styles.quoteMine]} accessibilityLabel={`Replying to ${m.reply.from}`}>
              <Text style={[styles.quoteFrom, mine && { color: colors.goldLight }]} numberOfLines={1}>{m.reply.from}</Text>
              <Text style={[styles.quoteText, mine && { color: 'rgba(255,255,255,0.82)' }]} numberOfLines={2}>{m.reply.deleted ? 'This message was deleted' : m.reply.text || 'Message'}</Text>
            </Pressable>
          ) : null}
          {deletedText ? (
            <View style={styles.deletedRow}>
              <BanGlyph color={mine ? 'rgba(255,255,255,0.7)' : colors.faint} />
              <Text style={[styles.deletedText, mine && { color: 'rgba(255,255,255,0.78)' }]}>{deletedText}</Text>
            </View>
          ) : m.vgift ? (
            <GiftBubble vgift={m.vgift} mine={mine} from={m.from} isGroup={!!showSender} /> // VIRTUAL GIFTS: gift bubble with animation
          ) : m.text && !m.gift ? (
            <LinkedText text={m.text} onLongPress={onLongPress} style={[styles.msgText, mine && { color: '#FFFFFF' }]} linkStyle={[styles.link, mine && { color: '#FFFFFF' }]} />
          ) : null}
          {!m.deleted && m.linkPreview ? <LinkPreviewCard preview={m.linkPreview} mine={mine} onLongPress={onLongPress} /> : null}
          {!m.deleted ? children : null}
          <View style={[styles.metaRow, mine && { justifyContent: 'flex-end' }]} accessibilityLabel={mine && status ? STATUS_LABEL[status] || 'Not sent' : undefined}>
            {m.pinned ? <PinGlyph size={10} color={mine ? 'rgba(255,255,255,0.7)' : colors.gold} filled /> : null}
            <Text style={[styles.msgTime, mine && styles.msgTimeMine, failed && styles.failedText]}>
              {failed ? 'Not sent · Tap to retry' : [m.edited && !m.deleted ? 'Edited' : null, m.time].filter(Boolean).join(' · ')}
            </Text>
            {mine && !m.deleted && !failed ? <Ticks status={status} mine={mine} /> : null}
          </View>
        </Pressable>
      </Wrap>
      {reactions.length ? (
        <View style={[styles.reactRow, mine && { alignSelf: 'flex-end' }]}>
          {reactions.map((r) => (
            <PressScale key={r.emoji} onPress={() => onReact && onReact(r.emoji)} scaleTo={0.9} style={[styles.reactChip, r.mine && styles.reactChipMine]} accessibilityLabel={`${r.emoji} ${r.count}${r.mine ? ', yours' : ''}`}>
              <Text style={styles.reactEmoji}>{r.emoji}</Text>
              {r.count > 1 ? <Text style={[styles.reactCount, r.mine && { color: colors.primary }]}>{r.count}</Text> : null}
            </PressScale>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ---------- action sheet ----------
function ActionRow({ icon, label, tint = colors.fg, onPress, sub }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.actRow, pressed && { backgroundColor: colors.raised }]} accessibilityRole="button" accessibilityLabel={label}>
      <View style={[styles.actIcon, tint !== colors.fg && { backgroundColor: alpha(tint, 0.1) }]}>{icon}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.actLabel, { color: tint }]}>{label}</Text>
        {sub ? <Text style={styles.actSub} numberOfLines={2}>{sub}</Text> : null}
      </View>
    </Pressable>
  );
}

export function MessageActionsSheet({ visible, message, canEdit, canPin, canDeleteForEveryone, pinHint, onClose, onReact, onReply, onCopy, onEdit, onTogglePin, onDeleteMe, onDeleteEveryone, onForward, canReply = true, extra = [] }) {
  const [confirm, setConfirm] = useState(false);
  const m = message;
  const close = () => { setConfirm(false); onClose && onClose(); };
  const mineEmoji = m && (m.reactions || []).find((r) => r.mine);
  return (
    <AnimatedModal visible={!!visible && !!m} onRequestClose={close}>
      <View style={styles.overlay}>
        <Pressable style={{ flex: 1 }} onPress={close} accessibilityLabel="Dismiss" />
        {m ? (
          <View style={styles.sheet}>
            <View style={styles.grabber} />
            <View style={styles.preview}>
              <Text style={styles.previewFrom} numberOfLines={1}>{m.mine ? 'You' : m.from}{m.time ? ` · ${m.time}` : ''}</Text>
              <Text style={styles.previewText} numberOfLines={3}>{snippet(m)}</Text>
            </View>
            {confirm ? (
              <ScaleIn from={0.96}>
                <Text style={styles.confirmTitle}>Delete message?</Text>
                {canDeleteForEveryone ? (
                  <ActionRow icon={<Icon name="trash" size={17} color={colors.negative || colors.rose} />} tint={colors.negative || colors.rose} label="Delete for everyone" sub={m.mine ? 'Everyone in this chat will see "This message was deleted".' : 'As a group admin you are removing someone else’s message.'} onPress={() => { close(); onDeleteEveryone(); }} />
                ) : null}
                <ActionRow icon={<Icon name="trash" size={17} color={colors.fg} />} label="Delete for me" sub="Removes it from your devices only." onPress={() => { close(); onDeleteMe(); }} />
                <ActionRow icon={<Icon name="x" size={17} color={colors.muted} />} tint={colors.muted} label="Cancel" onPress={() => setConfirm(false)} />
              </ScaleIn>
            ) : (
              <View>
                {!m.deleted ? (
                  <View style={styles.emojiRow}>
                    {REACTIONS.map((e) => (
                      <PressScale key={e} onPress={() => { close(); onReact(e); }} scaleTo={0.82} style={[styles.emojiBtn, mineEmoji && mineEmoji.emoji === e && styles.emojiBtnOn]} accessibilityLabel={`React ${e}`}>
                        <Text style={styles.emojiText}>{e}</Text>
                      </PressScale>
                    ))}
                  </View>
                ) : null}
                {!m.deleted && canReply ? <ActionRow icon={<ReplyGlyph />} label="Reply" onPress={() => { close(); onReply(); }} /> : null}
                {/* MEMBERSHIP GROUPS: e.g. "Turn comments off" on a MASTER CLASS post */}
                {!m.deleted ? (extra || []).map((x) => <ActionRow key={x.label} icon={<Icon name={x.icon || 'chat'} size={17} color={colors.fg} />} label={x.label} sub={x.sub} onPress={() => { close(); x.onPress(); }} />) : null}
                {!m.deleted && onForward && !m.gift && !m.system ? <ActionRow icon={<Icon name="share" size={17} color={colors.fg} />} label="Forward" onPress={() => { close(); onForward(); }} /> : null}
                {!m.deleted && m.text ? <ActionRow icon={<CopyGlyph />} label="Copy text" onPress={() => { close(); onCopy(); }} /> : null}
                {canEdit ? <ActionRow icon={<Icon name="edit" size={17} color={colors.fg} />} label="Edit" onPress={() => { close(); onEdit(); }} /> : null}
                {!m.deleted && canPin ? (
                  <ActionRow icon={<PinGlyph filled={m.pinned} />} label={m.pinned ? 'Unpin' : 'Pin'} sub={!m.pinned ? pinHint : null} onPress={() => { close(); onTogglePin(); }} />
                ) : null}
                <ActionRow icon={<Icon name="trash" size={17} color={colors.negative || colors.rose} />} tint={colors.negative || colors.rose} label="Delete" onPress={() => setConfirm(true)} />
              </View>
            )}
          </View>
        ) : null}
      </View>
    </AnimatedModal>
  );
}

// ---------- composer banner ----------
export function ComposerBanner({ mode, message, onCancel }) {
  if (!mode || !message) return null;
  return (
    <FadeInUp distance={6} duration={200} style={styles.banner}>
      <View style={styles.bannerBar} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.bannerTitle} numberOfLines={1}>{mode === 'edit' ? 'Editing message' : `Replying to ${message.mine ? 'yourself' : message.from}`}</Text>
        <Text style={styles.bannerText} numberOfLines={1}>{snippet(message)}</Text>
      </View>
      <PressScale onPress={onCancel} hitSlop={10} scaleTo={0.88} style={styles.bannerClose} accessibilityLabel={mode === 'edit' ? 'Cancel editing' : 'Cancel reply'}>
        <Icon name="x" size={13} color={colors.muted} />
      </PressScale>
    </FadeInUp>
  );
}

// ---------- pinned bar ----------
export function PinnedBar({ pins, onOpen, style }) {
  const [i, setI] = useState(0);
  if (!pins || !pins.length) return null;
  const idx = i % pins.length;
  const p = pins[idx];
  const press = () => { onOpen && onOpen(p); setI((x) => x + 1); };
  return (
    <PressScale onPress={press} scaleTo={0.985} style={[styles.pinBar, style]} accessibilityLabel={`Pinned message: ${snippet(p)}. Tap to jump to it.`}>
      <View style={styles.pinIcon}><PinGlyph size={13} color={colors.gold} filled /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.pinLabel}>{pins.length > 1 ? `Pinned · ${idx + 1} of ${pins.length}` : 'Pinned'}</Text>
        <Text style={styles.pinText} numberOfLines={1}>{p.from && !p.mine ? `${p.from}: ` : ''}{snippet(p)}</Text>
      </View>
      <Icon name="chevron-right" size={14} color={colors.faint} />
    </PressScale>
  );
}

// ---------- hook: everything one thread needs ----------
// opts: { scope, canPin, canModerate, isGroup, onSend(text, reply) }
// CHAT 7.3: scrollToId(id) → boolean lets a virtualised list jump to a message; onForward(m) adds "Forward"
export function useMessageActions({ scope, canPin = true, canModerate = false, isGroup = false, onSend, scrollToId, onForward, canReplyTo, extraActions }) {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const [sheetFor, setSheetFor] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [prefillKey, setPrefillKey] = useState(null);
  const [focusKey, setFocusKey] = useState(null);
  const [highlight, setHighlight] = useState(null);
  const positions = useRef({});
  const scrollRef = useRef(null);
  const msgs = getScopeMsgs(state, scope);
  const pins = useMemo(() => pinnedOf(msgs), [msgs]);

  const op = (o) => dispatch({ type: 'msgOp', scope, ...o });
  const current = sheetFor ? msgs.find((m) => m.id === sheetFor) || null : null;

  const jumpTo = useCallback((id) => {
    if (scrollToId) {
      if (!scrollToId(id)) { toast.show('That message is further back in the chat', { icon: 'chat' }); return; }
      setHighlight(id);
      setTimeout(() => setHighlight((h) => (h === id ? null : h)), 1600);
      return;
    }
    const y = positions.current[id];
    if (y == null) { toast.show('That message is further back in the chat', { icon: 'chat' }); return; }
    if (scrollRef.current) scrollRef.current.scrollTo({ y: Math.max(0, y - 80), animated: true });
    setHighlight(id);
    setTimeout(() => setHighlight((h) => (h === id ? null : h)), 1600);
  }, [toast, scrollToId]);

  const open = (m) => {
    setSheetFor(m.id);
    if (!state.chatTipSeen) dispatch({ type: 'set', patch: { chatTipSeen: true } });
  };

  const send = (text, extra) => {
    if (editing) {
      const t = text.trim();
      const orig = msgs.find((m) => m.id === editing);
      setEditing(null);
      if (!orig || orig.deleted) { toast.show('That message can no longer be edited', { tone: 'error' }); return; }
      if (t && t !== orig.text) { op({ id: editing, op: 'edit', text: t }); toast.show('Message edited', { icon: 'edit' }); }
      return;
    }
    const reply = replyTo ? msgs.find((m) => m.id === replyTo) : null;
    setReplyTo(null);
    onSend && onSend(text, reply ? { id: reply.id, from: reply.mine ? 'You' : reply.from, text: reply.text, deleted: !!reply.deleted } : null, extra || {});
  };

  const editTarget = editing ? msgs.find((m) => m.id === editing) : null;
  const replyTarget = replyTo ? msgs.find((m) => m.id === replyTo) : null;
  const canDeleteForEveryone = (m) => !!m && !m.deleted && (m.mine || (isGroup && canModerate));

  const sheet = (
    <MessageActionsSheet
      visible={!!current}
      message={current}
      canEdit={canEditMessage(current)}
      canPin={canPin}
      pinHint={pins.length >= 3 ? 'Up to 3 pins — the oldest pin will be replaced.' : null}
      canDeleteForEveryone={canDeleteForEveryone(current)}
      canReply={!canReplyTo || canReplyTo(current)}
      extra={current && extraActions ? extraActions(current) : []}
      onClose={() => setSheetFor(null)}
      onReact={(e) => current && op({ id: current.id, op: 'react', emoji: e })}
      onReply={() => { if (!current) return; setEditing(null); setReplyTo(current.id); setFocusKey(Date.now()); }}
      onCopy={async () => {
        try { await Clipboard.setStringAsync(current.text || ''); toast.show('Copied', { icon: 'check' }); } catch (e) { toast.show('Couldn’t copy', { tone: 'error' }); }
      }}
      onEdit={() => { if (!current) return; setReplyTo(null); setEditing(current.id); setPrefillKey(Date.now()); }}
      onTogglePin={() => {
        if (!current) return;
        op({ id: current.id, op: current.pinned ? 'unpin' : 'pin' });
        toast.show(current.pinned ? 'Unpinned' : 'Pinned to the top of this chat', { icon: 'check' });
      }}
      onDeleteMe={() => { if (current) { op({ id: current.id, op: 'deleteMe' }); toast.show('Deleted for you', { icon: 'trash' }); } }}
      onDeleteEveryone={() => { if (current) { op({ id: current.id, op: 'delete' }); toast.show('Deleted for everyone', { icon: 'trash' }); } }}
      onForward={onForward ? () => current && onForward(current) : undefined}
    />
  );

  const banner = editTarget
    ? <ComposerBanner mode="edit" message={editTarget} onCancel={() => { setEditing(null); setPrefillKey(Date.now()); }} />
    : replyTarget ? <ComposerBanner mode="reply" message={replyTarget} onCancel={() => setReplyTo(null)} /> : null;

  return {
    msgs,
    pins,
    open,
    sheet,
    banner,
    highlight,
    scrollRef,
    jumpTo,
    tipVisible: !state.chatTipSeen,
    layoutFor: (id) => (e) => { positions.current[id] = e.nativeEvent.layout.y; },
    react: (m, emoji) => op({ id: m.id, op: 'react', emoji }),
    reply: (m) => {
      if (!m || m.deleted) return;
      if (canReplyTo && !canReplyTo(m)) { toast.show('Comments are off for this post', { icon: 'lock' }); return; } // MEMBERSHIP GROUPS
      setEditing(null); setReplyTo(m.id); setFocusKey(Date.now());
    },
    composer: {
      onSend: send,
      prefill: editTarget ? editTarget.text : '',
      prefillKey,
      focusKey,
      sendLabel: editTarget ? 'Save edit' : 'Send',
    },
    editing: !!editTarget,
  };
}

const styles = StyleSheet.create({
  msg: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 18, borderBottomLeftRadius: 6,
    paddingVertical: 8, paddingHorizontal: 12,
  },
  msgMine: { backgroundColor: colors.primary, borderColor: colors.primary, borderBottomLeftRadius: 18, borderBottomRightRadius: 6 },
  msgDeleted: { backgroundColor: colors.raised, borderColor: colors.border, shadowOpacity: 0, elevation: 0 },
  msgDeletedMine: { backgroundColor: alpha(colors.primary, 0.55), borderColor: 'transparent' },
  msgHighlight: { borderColor: colors.gold, borderWidth: 2 },
  msgFrom: { fontSize: 11.5, color: colors.gold, fontWeight: '700', marginBottom: 3 },
  groupedTheirs: { borderBottomLeftRadius: 18 },
  groupedMine: { borderBottomRightRadius: 18 },
  msgFailed: { borderColor: colors.negative || colors.rose, borderWidth: 1.5 },
  failedText: { color: colors.negative || colors.rose, fontWeight: '700' },
  fwd: { fontSize: 11, fontStyle: 'italic', color: colors.muted, marginBottom: 2 },
  msgText: { fontSize: 14.5, lineHeight: 20, color: colors.fg },
  link: { textDecorationLine: 'underline', color: colors.primary, fontWeight: '600' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 },
  msgTime: { fontSize: 10.5, color: colors.faint },
  msgTimeMine: { color: 'rgba(255,255,255,0.66)', textAlign: 'right' },
  deletedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  deletedText: { fontSize: 13.5, fontStyle: 'italic', color: colors.muted },
  quote: { borderLeftWidth: 3, borderLeftColor: colors.gold, backgroundColor: colors.raised, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 9, marginBottom: 6 },
  quoteMine: { backgroundColor: 'rgba(255,255,255,0.13)', borderLeftColor: colors.goldLight },
  quoteFrom: { fontSize: 11.5, fontWeight: '700', color: colors.gold },
  quoteText: { fontSize: 12.5, lineHeight: 17, color: colors.muted, marginTop: 1 },
  reactRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: -6, marginHorizontal: 8 },
  reactChip: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 2, ...shadow.sm },
  reactChipMine: { borderColor: alpha(colors.primary, 0.5), backgroundColor: colors.primarySoft },
  reactEmoji: { fontSize: 13 },
  reactCount: { fontSize: 11, fontWeight: '700', color: colors.muted },

  overlay: { flex: 1, backgroundColor: 'transparent', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.screen, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 26, ...shadow.lg },
  grabber: { alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: 12 },
  preview: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 12, marginHorizontal: 4, marginBottom: 12 },
  previewFrom: { fontSize: 11.5, fontWeight: '700', color: colors.gold, marginBottom: 3 },
  previewText: { fontSize: 14, lineHeight: 19, color: colors.fg },
  emojiRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 6, paddingVertical: 5, marginHorizontal: 4, marginBottom: 8 },
  emojiBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  emojiBtnOn: { backgroundColor: colors.primarySoft },
  emojiText: { fontSize: 21 },
  actRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 8, borderRadius: radius.md },
  actIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  actLabel: { fontSize: 15, fontWeight: '600' },
  actSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  confirmTitle: { fontFamily: fonts.serifBold, fontSize: 20, color: colors.fg, marginHorizontal: 8, marginBottom: 6 },

  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: 8, paddingHorizontal: 10, marginBottom: 2 },
  bannerBar: { width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: colors.gold },
  bannerTitle: { fontSize: 12, fontWeight: '700', color: colors.primary },
  bannerText: { fontSize: 12.5, color: colors.muted, marginTop: 1 },
  bannerClose: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },

  pinBar: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 14, marginTop: 10, borderRadius: radius.md, paddingVertical: 9, paddingHorizontal: 12, borderWidth: 1, borderColor: alpha(colors.gold, 0.28), backgroundColor: colors.cardGold },
  pinIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: alpha(colors.gold, 0.14), alignItems: 'center', justifyContent: 'center' },
  pinLabel: { fontSize: 9.5, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: colors.gold },
  pinText: { fontSize: 13, color: colors.fg, marginTop: 1 },
});
