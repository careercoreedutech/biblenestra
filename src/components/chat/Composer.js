// CHAT 7.3 — chat composer: "+" attach, growing text box, mic ↔ send, "Typing…" signal, @mention suggestions.
//   <Composer onSend={(text, { mentions }) => …} onAttach onMic onTyping members={[{ id, displayName }]}
//             prefill prefillKey focusKey sendLabel placeholder voice />
// VOICE NOTES (WhatsApp-style): pass `voice` = { recording, paused, ms, levels, start(opts), send(), cancel(), pause(), resume() }
//   phones: press and hold the mic to record · release to send · slide left to cancel · slide up to lock (hands-free,
//           then pause/resume, delete or send). A quick tap shows "Hold to record, release to send".
//   web:    tap the mic to start a hands-free recording (same locked bar).
//   Without `voice`, the mic button just calls onMic (older callers).
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '../Icons';
import { SocialAvatar } from '../social/FeedCard';
import { Waveform } from '../../chat/ChatExtras';
import { colors, fonts, radius } from '../../theme';

let Haptics = null;
try { Haptics = require('expo-haptics'); } catch (e) { Haptics = null; }
const buzz = (kind) => {
  if (!Haptics || Platform.OS === 'web') return;
  try {
    if (kind === 'warn') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    else Haptics.impactAsync(kind === 'heavy' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  } catch (e) { /* no haptics */ }
};
const IS_WEB = Platform.OS === 'web';
const CANCEL_DX = 110; // slide this far left to cancel
const LOCK_DY = 80; // slide this far up to lock
const TAP_MS = 300; // shorter than this is a tap, not a hold
const fmtDur = (ms) => {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// red dot that blinks while recording
function RecDot({ paused }) {
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (paused) { v.setValue(1); return undefined; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 0.25, duration: 520, easing: Easing.inOut(Easing.quad), useNativeDriver: !IS_WEB }),
      Animated.timing(v, { toValue: 1, duration: 520, easing: Easing.inOut(Easing.quad), useNativeDriver: !IS_WEB }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [paused]);
  return <Animated.View style={[styles.recDot, paused && { backgroundColor: colors.faint }, { opacity: v }]} />;
}

const MENTION_RE = /(^|\s)@([^\s@]{0,30})$/;

export const Composer = memo(function Composer({
  placeholder = 'Message', onSend, onAttach, onMic, onTyping, members, prefill, prefillKey, focusKey, sendLabel = 'Send', disabled, micEnabled = true,
  voice,
}) {
  const [text, setText] = useState('');
  const [height, setHeight] = useState(40);
  const picked = useRef(new Map()); // displayName → id, for names chosen from the suggestions
  const inputRef = useRef(null);

  // ---------- VOICE NOTES: hold / slide / lock ----------
  const [phase, setPhase] = useState('idle'); // 'idle' | 'hold' (finger down); "locked" = recording while not held
  const [drag, setDrag] = useState({ dx: 0, dy: 0 });
  const [tapHint, setTapHint] = useState(false);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const hasTextRef = useRef(false);
  const g = useRef({ active: false, startedAt: 0, startP: null });
  useEffect(() => {
    if (!tapHint) return undefined;
    const t = setTimeout(() => setTapHint(false), 2200);
    return () => clearTimeout(t);
  }, [tapHint]);
  const finishHold = async (how) => {
    const s = g.current;
    if (!s.active) return;
    s.active = false;
    setDrag({ dx: 0, dy: 0 });
    const ok = await s.startP;
    const v = voiceRef.current;
    setPhase('idle');
    if (!ok || !v) return;
    if (how === 'lock') { buzz('heavy'); return; } // still recording → the hands-free bar shows
    if (how === 'send') { buzz(); v.send(); return; }
    buzz(how === 'cancel' ? 'warn' : undefined);
    v.cancel();
    if (how === 'tap') setTapHint(true);
  };
  const finishRef = useRef(finishHold);
  finishRef.current = finishHold;
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !!voiceRef.current && !voiceRef.current.recording && !hasTextRef.current,
    onMoveShouldSetPanResponder: () => g.current.active,
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: () => {
      const v = voiceRef.current;
      if (!v) return;
      g.current = { active: true, startedAt: Date.now(), startP: Promise.resolve(v.start({ hold: true })).catch(() => false) };
      setPhase('hold');
      setTapHint(false);
      setDrag({ dx: 0, dy: 0 });
      buzz();
    },
    onPanResponderMove: (e, gs) => {
      if (!g.current.active) return;
      const dx = Math.min(0, gs.dx);
      const dy = Math.min(0, gs.dy);
      if (dx < -CANCEL_DX) { finishRef.current('cancel'); return; }
      if (dy < -LOCK_DY) { finishRef.current('lock'); return; }
      setDrag({ dx, dy });
    },
    onPanResponderRelease: () => finishRef.current(Date.now() - g.current.startedAt < TAP_MS ? 'tap' : 'send'),
    // the system took the touch (a call, the notification shade…): keep the recording, hands-free
    onPanResponderTerminate: () => finishRef.current('lock'),
  }), []);
  const holding = phase === 'hold';
  const locked = !!(voice && voice.recording) && !holding;

  useEffect(() => {
    if (prefillKey == null) return;
    setText(prefill || '');
    setTimeout(() => inputRef.current && inputRef.current.focus(), 60);
  }, [prefillKey]);
  useEffect(() => {
    if (focusKey == null) return;
    setTimeout(() => inputRef.current && inputRef.current.focus(), 60);
  }, [focusKey]);

  const mentionQuery = useMemo(() => {
    if (!members || !members.length) return null;
    const m = text.match(MENTION_RE);
    return m ? m[2].toLowerCase() : null;
  }, [text, members]);
  const suggestions = useMemo(() => (mentionQuery == null ? [] : members
    .filter((p) => (p.displayName || '').toLowerCase().replace(/\s+/g, '').includes(mentionQuery) || (p.handle || '').toLowerCase().startsWith(mentionQuery))
    .slice(0, 6)), [mentionQuery, members]);

  const change = (t) => {
    setText(t);
    if (onTyping) onTyping(!!t.trim());
  };
  const pickMention = (p) => {
    const name = (p.displayName || p.handle || 'member').replace(/\s+/g, '');
    picked.current.set(name.toLowerCase(), p.id);
    setText((t) => t.replace(MENTION_RE, (all, pre) => `${pre}@${name} `));
    if (inputRef.current) inputRef.current.focus();
  };
  const send = () => {
    const t = text.trim();
    if (!t || disabled) return;
    // mentions: names chosen from the list, plus "@Name" typed in full for any member
    const ids = new Set();
    for (const tag of t.match(/@([^\s@.,!?]{1,40})/g) || []) {
      const key = tag.slice(1).toLowerCase();
      if (picked.current.has(key)) ids.add(picked.current.get(key));
      else {
        const hit = (members || []).find((p) => (p.displayName || '').replace(/\s+/g, '').toLowerCase() === key || (p.handle || '').toLowerCase() === key);
        if (hit) ids.add(hit.id);
      }
    }
    onSend && onSend(t, { mentions: [...ids] });
    picked.current.clear();
    setText('');
    setHeight(40);
    if (onTyping) onTyping(false);
  };
  const hasText = !!text.trim();
  hasTextRef.current = hasText;

  // VOICE NOTES: hands-free recording bar (locked by sliding up, started from the + tray, or on web)
  if (locked) {
    return (
      <View style={styles.row}>
        <Pressable onPress={() => { buzz('warn'); voice.cancel(); }} hitSlop={6} style={styles.roundBtn} accessibilityLabel="Delete recording">
          <Icon name="trash" size={18} color={colors.negative || colors.rose} />
        </Pressable>
        <View style={[styles.box, styles.recBox]}>
          <RecDot paused={voice.paused} />
          <Text style={styles.recTime} accessibilityLabel={`Recording ${fmtDur(voice.ms)}`}>{fmtDur(voice.ms)}</Text>
          {voice.levels && voice.levels.length ? (
            <Waveform levels={voice.levels} height={22} color={colors.primary} playedColor={colors.primary} style={styles.liveWave} />
          ) : (
            <Text style={styles.recHint} numberOfLines={1}>{voice.paused ? 'Paused' : 'Recording…'}</Text>
          )}
          <Pressable onPress={voice.paused ? voice.resume : voice.pause} hitSlop={8} style={styles.pauseBtn} accessibilityLabel={voice.paused ? 'Resume recording' : 'Pause recording'}>
            {voice.paused ? <Icon name="mic" size={16} color={colors.negative || colors.rose} /> : <Icon name="pause" size={16} color={colors.fg} />}
          </Pressable>
        </View>
        <Pressable onPress={() => { buzz(); voice.send(); }} style={styles.sendBtn} accessibilityLabel="Send voice message">
          <Icon name="arrow-up-right" size={17} color="#FFFFFF" strokeWidth={2.4} />
        </Pressable>
      </View>
    );
  }
  const cancelP = Math.min(1, -drag.dx / CANCEL_DX);
  const lockP = Math.min(1, -drag.dy / LOCK_DY);

  return (
    <View>
      {suggestions.length ? (
        <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} style={styles.suggest} contentContainerStyle={{ gap: 6, paddingHorizontal: 4 }}>
          {suggestions.map((p) => (
            <Pressable key={p.id} onPress={() => pickMention(p)} style={styles.suggestChip} accessibilityLabel={`Mention ${p.displayName}`}>
              <SocialAvatar name={p.displayName} uri={p.avatarUrl} size={22} />
              <Text style={styles.suggestText} numberOfLines={1}>{p.displayName}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      {tapHint ? <Text style={styles.tapHint}>Hold to record, release to send</Text> : null}
      <View style={styles.row}>
        {holding ? (
          // VOICE NOTES: while the mic is held — timer, live waveform and "‹ Slide to cancel"
          <View style={[styles.box, styles.recBox]}>
            <RecDot />
            <Text style={styles.recTime}>{fmtDur(voice && voice.ms)}</Text>
            {voice && voice.levels && voice.levels.length ? (
              <Waveform levels={voice.levels.slice(-14)} height={20} color={colors.primary} playedColor={colors.primary} style={{ width: 50 }} />
            ) : null}
            <Text style={[styles.slideHint, { opacity: 1 - cancelP * 0.85, transform: [{ translateX: drag.dx * 0.6 }] }]} numberOfLines={1}>‹  Slide to cancel</Text>
          </View>
        ) : null}
        {onAttach && !holding ? (
          <Pressable onPress={onAttach} hitSlop={6} style={styles.roundBtn} accessibilityLabel="Attach a photo, video, document, audio, call or gift">
            <Icon name="plus" size={20} color={colors.muted} />
          </Pressable>
        ) : null}
        <View style={[styles.box, holding && styles.hidden]}>
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={change}
            placeholder={placeholder}
            placeholderTextColor={colors.faint}
            multiline
            onContentSizeChange={(e) => {
              const h = e.nativeEvent.contentSize.height;
              setHeight(!text || !h ? 40 : Math.max(40, Math.min(120, h)));
            }}
            onKeyPress={(e) => {
              // web: Enter sends, Shift+Enter makes a new line
              if (e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey && typeof document !== 'undefined') { e.preventDefault && e.preventDefault(); send(); }
            }}
            style={[styles.input, { height }]}
            accessibilityLabel="Message"
          />
        </View>
        {hasText || !onMic ? (
          <Pressable onPress={send} disabled={!hasText} style={[styles.sendBtn, !hasText && { opacity: 0.45 }]} accessibilityLabel={sendLabel}>
            <Icon name="arrow-up-right" size={17} color="#FFFFFF" strokeWidth={2.4} />
          </Pressable>
        ) : voice && !IS_WEB ? (
          <View style={styles.micWrap}>
            {holding ? (
              <View pointerEvents="none" style={[styles.lockPill, { transform: [{ translateY: drag.dy * 0.5 }], opacity: 0.55 + lockP * 0.45 }]}>
                <Icon name="lock" size={15} color={lockP > 0.6 ? colors.primary : colors.muted} />
                <Icon name="chevron-up" size={14} color={colors.faint} />
              </View>
            ) : null}
            <View
              {...pan.panHandlers}
              style={[styles.sendBtn, holding && styles.micHeld, holding && { transform: [{ translateX: drag.dx }, { translateY: drag.dy }, { scale: 1.45 }] }]}
              accessible
              accessibilityRole="button"
              accessibilityLabel="Hold to record a voice message. Release to send, slide left to cancel, slide up to lock"
              accessibilityActions={[{ name: 'activate' }]}
              onAccessibilityAction={() => voice.start()} // screen readers: double-tap starts a hands-free recording
            >
              <Icon name="mic" size={18} color="#FFFFFF" />
            </View>
          </View>
        ) : (
          <Pressable onPress={voice ? () => voice.start() : onMic} style={[styles.sendBtn, !micEnabled && { opacity: 0.45 }]} accessibilityLabel="Record a voice message">
            <Icon name="mic" size={18} color="#FFFFFF" />
          </Pressable>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  roundBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.raised },
  box: { flex: 1, minWidth: 0, backgroundColor: colors.raised, borderRadius: 20, paddingHorizontal: 14, justifyContent: 'center' },
  input: { fontFamily: fonts.sans, fontSize: 15, color: colors.fg, paddingTop: 10, paddingBottom: 8, outlineStyle: 'none' },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  suggest: { flexGrow: 0, marginBottom: 6 },
  // VOICE NOTES
  hidden: { position: 'absolute', opacity: 0, width: 0, height: 0, overflow: 'hidden' },
  recBox: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingHorizontal: 12, overflow: 'hidden' },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.negative || colors.rose },
  recTime: { fontSize: 14, fontWeight: '700', color: colors.fg, fontVariant: ['tabular-nums'], minWidth: 36 },
  recHint: { flex: 1, fontSize: 13, color: colors.muted },
  liveWave: { flex: 1, minWidth: 0, justifyContent: 'flex-end' },
  pauseBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  slideHint: { flex: 1, textAlign: 'right', fontSize: 13, color: colors.muted },
  micWrap: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', zIndex: 5 },
  micHeld: { backgroundColor: colors.negative || colors.rose },
  lockPill: { position: 'absolute', bottom: 58, alignItems: 'center', gap: 2, width: 34, paddingVertical: 8, borderRadius: 17, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  tapHint: { alignSelf: 'flex-end', fontSize: 12, color: '#FFFFFF', backgroundColor: 'rgba(20,20,20,0.82)', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 6, overflow: 'hidden' },
  suggestChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 4, paddingRight: 10, height: 30, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, maxWidth: 180 },
  suggestText: { fontSize: 13, fontWeight: '600', color: colors.fg },
});
