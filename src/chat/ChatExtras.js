// Private chat extras: photos, voice notes / audio files, Google Meet calls and coin gifts.
//   <ChatImage>        photo bubble content (auth-loaded from /chat/media), tap → <ImageViewer>
//   <AudioBubble>      play / pause + progress + duration for voice notes and audio files
//   <GiftCard>         "🎁 Sent N coins" card for coin gifts
//   <MeetJoin>         "Join video call" button under a message carrying a Google Meet link
//   <AttachTray>       composer "+" menu
//   <RecorderBar>      recording strip (timer, cancel, send) driven by useVoiceRecorder()
//   <CoinGiftSheet>    choose an amount (+ note) to gift
//   <MeetPrompt>       open meet.google.com/new, then paste the meeting link to share it
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Dimensions, Image, Linking, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Audio } from 'expo-av';
import * as Clipboard from 'expo-clipboard';
import { Icon } from '../components/Icons';
import { AnimatedModal, PressScale, ScaleIn } from '../components/Motion';
import { Button, alpha } from '../components/ui';
import { colors, fonts, radius, shadow } from '../theme';
import { resolveChatMedia, useChatMediaSource } from '../api/chatMedia';
import { findMeetLink } from './messages';

const IS_WEB = Platform.OS === 'web';
export const MEET_NEW_URL = 'https://meet.google.com/new';
const fmtDur = (ms) => {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// ---------- photos ----------
export function ChatImage({ image, request, onOpen }) {
  const { source, error } = useChatMediaSource(request, image.key);
  const w = image.width || 4; const h = image.height || 3;
  const ratio = Math.max(0.56, Math.min(1.6, w / h));
  return (
    <Pressable onPress={() => source && onOpen && onOpen(source)} style={[styles.img, { aspectRatio: ratio }]} accessibilityRole="imagebutton" accessibilityLabel="Photo. Tap to view full size">
      {source ? <Image source={source} style={StyleSheet.absoluteFill} resizeMode="cover" /> : (
        <View style={styles.imgWait}>
          {error ? <Text style={styles.imgErr}>Photo unavailable</Text> : <ActivityIndicator color={colors.muted} />}
        </View>
      )}
    </Pressable>
  );
}

export function ImageViewer({ source, onClose }) {
  const { width, height } = Dimensions.get('window');
  return (
    <Modal visible={!!source} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.viewer} onPress={onClose} accessibilityLabel="Close photo">
        {source ? <Image source={source} style={{ width, height: height * 0.86 }} resizeMode="contain" /> : null}
        <View style={styles.viewerClose}><Icon name="x" size={18} color="#FFFFFF" /></View>
      </Pressable>
    </Modal>
  );
}

// ---------- audio ----------
let playing = null; // { sound, stop } — one voice note at a time

export function AudioBubble({ voice, request, mine }) {
  const [st, setSt] = useState({ loading: false, playing: false, pos: 0, dur: voice.durationMs || 0, error: null });
  const sound = useRef(null);
  useEffect(() => () => {
    if (sound.current) { sound.current.unloadAsync().catch(() => {}); if (playing && playing.sound === sound.current) playing = null; }
  }, []);
  const stopSelf = () => { if (sound.current) sound.current.pauseAsync().catch(() => {}); };
  const toggle = async () => {
    try {
      if (sound.current) {
        const s = await sound.current.getStatusAsync();
        if (s.isPlaying) { await sound.current.pauseAsync(); return; }
        if (playing && playing.sound !== sound.current) playing.stop();
        playing = { sound: sound.current, stop: stopSelf };
        if (s.durationMillis && s.positionMillis >= s.durationMillis - 50) await sound.current.setPositionAsync(0);
        await sound.current.playAsync();
        return;
      }
      setSt((x) => ({ ...x, loading: true, error: null }));
      const src = await resolveChatMedia(request, voice.key);
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true }).catch(() => {});
      if (playing) playing.stop();
      const { sound: snd } = await Audio.Sound.createAsync(src, { shouldPlay: true, progressUpdateIntervalMillis: 250 }, (s) => {
        if (!s.isLoaded) return;
        setSt((x) => ({ ...x, loading: false, playing: s.isPlaying, pos: s.positionMillis || 0, dur: s.durationMillis || x.dur }));
        if (s.didJustFinish) setSt((x) => ({ ...x, playing: false, pos: 0 }));
      });
      sound.current = snd;
      playing = { sound: snd, stop: stopSelf };
    } catch (e) {
      setSt((x) => ({ ...x, loading: false, error: 'Couldn’t play this audio' }));
    }
  };
  const fg = mine ? '#FFFFFF' : colors.fg;
  const sub = mine ? 'rgba(255,255,255,0.75)' : colors.muted;
  const pct = st.dur ? Math.min(1, st.pos / st.dur) : 0;
  return (
    <View style={styles.audio}>
      <PressScale onPress={toggle} scaleTo={0.9} style={[styles.playBtn, mine && { backgroundColor: 'rgba(255,255,255,0.2)' }]} accessibilityLabel={st.playing ? 'Pause' : 'Play'}>
        {st.loading ? <ActivityIndicator size="small" color={fg} /> : <Icon name={st.playing ? 'pause' : 'play'} size={16} color={mine ? '#FFFFFF' : colors.primary} />}
      </PressScale>
      <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
        <Text style={[styles.audioTitle, { color: fg }]} numberOfLines={1}>{voice.isFile ? `🎵 ${voice.name || 'Audio'}` : '🎤 Voice message'}</Text>
        <View style={[styles.track, mine && { backgroundColor: 'rgba(255,255,255,0.25)' }]}>
          <View style={[styles.trackFill, { width: `${pct * 100}%` }, mine && { backgroundColor: '#FFFFFF' }]} />
        </View>
        <Text style={[styles.audioTime, { color: sub }]}>{st.error || (st.playing || st.pos ? `${fmtDur(st.pos)} / ${fmtDur(st.dur)}` : st.dur ? fmtDur(st.dur) : 'Tap to play')}</Text>
      </View>
    </View>
  );
}

// ---------- coin gift ----------
export function GiftCard({ gift, mine, from }) {
  return (
    <View style={[styles.gift, mine && styles.giftMine]}>
      <Text style={styles.giftEmoji}>🎁</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.giftTitle, mine && { color: '#FFFFFF' }]}>{mine ? `You sent ${gift.coins} coin${gift.coins === 1 ? '' : 's'}` : `${from || 'They'} sent you ${gift.coins} coin${gift.coins === 1 ? '' : 's'}`}</Text>
        {gift.note ? <Text style={[styles.giftNote, mine && { color: 'rgba(255,255,255,0.85)' }]}>“{gift.note}”</Text> : null}
        {mine && gift.toName ? <Text style={[styles.giftNote, { color: 'rgba(255,255,255,0.7)' }]}>to {gift.toName}</Text> : null}
      </View>
    </View>
  );
}

// ---------- Google Meet ----------
export function MeetJoin({ text, mine }) {
  const link = findMeetLink(text);
  if (!link) return null;
  return (
    <PressScale onPress={() => Linking.openURL(link).catch(() => {})} scaleTo={0.96} style={[styles.meetBtn, mine && styles.meetBtnMine]} accessibilityRole="link" accessibilityLabel="Join video call">
      <Icon name="video" size={15} color={mine ? colors.primary : '#FFFFFF'} />
      <Text style={[styles.meetBtnText, mine && { color: colors.primary }]}>Join video call</Text>
    </PressScale>
  );
}

export function MeetPrompt({ visible, onClose, onShare }) {
  const [link, setLink] = useState('');
  const [opened, setOpened] = useState(false);
  useEffect(() => { if (visible) { setLink(''); setOpened(false); } }, [visible]);
  const valid = findMeetLink(link);
  const openMeet = () => { setOpened(true); Linking.openURL(MEET_NEW_URL).catch(() => {}); };
  const paste = async () => {
    try { const t = await Clipboard.getStringAsync(); if (t) setLink(t.trim()); } catch (e) { /* ignore */ }
  };
  return (
    <AnimatedModal visible={visible} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Dismiss" />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <Text style={styles.sheetTitle}>Start a video call</Text>
          <Text style={styles.sheetSub}>1. Open Google Meet to create a meeting.{'\n'}2. Copy the meeting link and paste it here to share it in this chat.</Text>
          <Button label={opened ? 'Open Google Meet again' : 'Open Google Meet'} kind={opened ? 'ghost' : 'primary'} icon={<Icon name="video" size={14} color={opened ? colors.primary : '#FFFFFF'} />} onPress={openMeet} />
          <View style={styles.inputRow}>
            <TextInput
              value={link}
              onChangeText={setLink}
              placeholder="Paste your Meet link (meet.google.com/…)"
              placeholderTextColor={colors.faint}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
            <Pressable onPress={paste} style={styles.pasteBtn} accessibilityLabel="Paste from clipboard"><Text style={styles.pasteText}>Paste</Text></Pressable>
          </View>
          {link && !valid ? <Text style={styles.hint}>That doesn’t look like a Google Meet link yet.</Text> : null}
          <Button label="Share link in chat" disabled={!valid} onPress={() => { onShare(valid); onClose(); }} />
        </View>
      </View>
    </AnimatedModal>
  );
}

// ---------- composer "+" tray ----------
export function AttachTray({ visible, items, onClose }) {
  return (
    <AnimatedModal visible={visible} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Dismiss" />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.trayGrid}>
            {items.map((it) => (
              <PressScale key={it.label} onPress={() => { onClose(); setTimeout(it.onPress, 250); }} scaleTo={0.92} style={[styles.trayItem, it.disabled && { opacity: 0.45 }]} accessibilityLabel={it.label}>
                <View style={[styles.trayIcon, { backgroundColor: alpha(it.tint || colors.primary, 0.12) }]}>
                  <Icon name={it.icon} size={21} color={it.tint || colors.primary} />
                </View>
                <Text style={styles.trayLabel} numberOfLines={2}>{it.label}</Text>
              </PressScale>
            ))}
          </View>
          {items.some((it) => it.disabled) ? <Text style={styles.hint}>Photos, voice notes and coin gifts need you to be signed in online.</Text> : null}
        </View>
      </View>
    </AnimatedModal>
  );
}

// ---------- voice recording ----------
const MAX_RECORD_MS = 10 * 60 * 1000;

export function useVoiceRecorder({ onError } = {}) {
  const rec = useRef(null);
  const [state, setState] = useState({ recording: false, ms: 0 });
  useEffect(() => () => { if (rec.current) rec.current.stopAndUnloadAsync().catch(() => {}); }, []);
  const start = async () => {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) { onError && onError('Allow microphone access to record voice messages'); return false; }
      if (playing) playing.stop();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY, (s) => {
        setState((x) => ({ ...x, ms: s.durationMillis || 0 }));
        if ((s.durationMillis || 0) >= MAX_RECORD_MS && rec.current) rec.current.pauseAsync().catch(() => {});
      }, 250);
      rec.current = recording;
      setState({ recording: true, ms: 0 });
      return true;
    } catch (e) {
      onError && onError('Couldn’t start the microphone');
      return false;
    }
  };
  // → { uri, durationMs, mimeType } | null
  const stop = async (keep = true) => {
    const r = rec.current;
    rec.current = null;
    setState({ recording: false, ms: 0 });
    if (!r) return null;
    let durationMs = 0;
    try { const s = await r.getStatusAsync(); durationMs = s.durationMillis || 0; } catch (e) { /* ignore */ }
    try { await r.stopAndUnloadAsync(); } catch (e) { /* already stopped */ }
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true }).catch(() => {});
    const uri = r.getURI();
    if (!keep || !uri) return null;
    if (durationMs < 700) { onError && onError('Hold on — that voice message was too short'); return null; }
    return { uri, durationMs, mimeType: IS_WEB ? '' : 'audio/m4a' };
  };
  return { ...state, start, stop };
}

export function RecorderBar({ ms, onCancel, onSend }) {
  return (
    <ScaleIn from={0.96} style={styles.recBar}>
      <View style={styles.recDot} />
      <Text style={styles.recTime}>{fmtDur(ms)}</Text>
      <Text style={styles.recHint} numberOfLines={1}>Recording voice message…</Text>
      <Pressable onPress={onCancel} style={styles.recCancel} accessibilityLabel="Cancel recording"><Icon name="trash" size={16} color={colors.negative || colors.rose} /></Pressable>
      <Pressable onPress={onSend} style={styles.recSend} accessibilityLabel="Send voice message"><Icon name="arrow-up-right" size={16} color="#FFFFFF" /></Pressable>
    </ScaleIn>
  );
}

// ---------- coin gift sheet ----------
const AMOUNTS = [5, 10, 25, 50, 100];

export function CoinGiftSheet({ visible, name, balance = 0, onClose, onSend, onEarn }) {
  const [amount, setAmount] = useState(10);
  const [custom, setCustom] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (visible) { setAmount(10); setCustom(''); setNote(''); setBusy(false); } }, [visible]);
  const value = custom ? parseInt(custom, 10) || 0 : amount;
  const short = value > balance;
  const send = async () => {
    if (!value || value < 1 || short || busy) return;
    setBusy(true);
    const ok = await onSend(value, note.trim());
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <AnimatedModal visible={visible} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Dismiss" />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <Text style={styles.sheetTitle}>Gift coins to {name}</Text>
          <Text style={styles.sheetSub}>Your balance: <Text style={{ fontWeight: '700', color: colors.gold }}>{balance} coins</Text>. {name} receives the full amount.</Text>
          <View style={styles.amounts}>
            {AMOUNTS.map((a) => (
              <PressScale key={a} onPress={() => { setAmount(a); setCustom(''); }} scaleTo={0.92} style={[styles.amount, !custom && amount === a && styles.amountOn, a > balance && { opacity: 0.4 }]} accessibilityLabel={`${a} coins`}>
                <Text style={[styles.amountText, !custom && amount === a && { color: '#FFFFFF' }]}>{a}</Text>
              </PressScale>
            ))}
          </View>
          <TextInput value={custom} onChangeText={(t) => setCustom(t.replace(/[^0-9]/g, '').slice(0, 5))} placeholder="Other amount" placeholderTextColor={colors.faint} keyboardType="number-pad" style={[styles.input, styles.inputBox]} />
          <TextInput value={note} onChangeText={(t) => setNote(t.slice(0, 200))} placeholder="Add a note (optional)" placeholderTextColor={colors.faint} style={[styles.input, styles.inputBox]} />
          {short ? (
            <View style={{ gap: 8 }}>
              <Text style={styles.hint}>You need {value - balance} more coin{value - balance === 1 ? '' : 's'}.</Text>
              {onEarn ? <Button kind="ghost" label="Get more coins" onPress={() => { onClose(); onEarn(); }} /> : null}
            </View>
          ) : null}
          <Button label={busy ? 'Sending…' : `Send ${value || 0} coin${value === 1 ? '' : 's'}`} disabled={!value || short || busy} icon={<Icon name="gift" size={14} color="#FFFFFF" />} onPress={send} />
        </View>
      </View>
    </AnimatedModal>
  );
}

const styles = StyleSheet.create({
  img: { width: 230, maxWidth: '100%', borderRadius: 12, overflow: 'hidden', backgroundColor: colors.raised, marginTop: 2, marginBottom: 2 },
  imgWait: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  imgErr: { fontSize: 12, color: colors.muted },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  viewerClose: { position: 'absolute', top: 44, right: 18, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },

  audio: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 210, paddingVertical: 2 },
  playBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  audioTitle: { fontSize: 13, fontWeight: '600' },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.raised, overflow: 'hidden' },
  trackFill: { height: 4, borderRadius: 2, backgroundColor: colors.primary },
  audioTime: { fontSize: 11 },

  gift: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 190, paddingVertical: 4, paddingHorizontal: 2 },
  giftMine: {},
  giftEmoji: { fontSize: 28 },
  giftTitle: { fontSize: 14.5, fontWeight: '700', color: colors.fg },
  giftNote: { fontSize: 12.5, color: colors.muted, marginTop: 2 },

  meetBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 8, paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.primary },
  meetBtnMine: { backgroundColor: '#FFFFFF' },
  meetBtnText: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },

  overlay: { flex: 1, backgroundColor: 'transparent', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.screen, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 28, gap: 12, ...shadow.lg },
  grabber: { alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: 4 },
  sheetTitle: { fontFamily: fonts.serifBold, fontSize: 21, color: colors.fg },
  sheetSub: { fontSize: 13.5, lineHeight: 19, color: colors.muted },
  hint: { fontSize: 12.5, color: colors.muted, textAlign: 'center' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingLeft: 12, paddingRight: 6 },
  input: { flex: 1, fontFamily: fonts.sans, fontSize: 14.5, color: colors.fg, paddingVertical: 11 },
  inputBox: { flex: 0, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12 },
  pasteBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.raised },
  pasteText: { fontSize: 12.5, fontWeight: '700', color: colors.primary },

  trayGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14, paddingTop: 6 },
  trayItem: { width: '31%', alignItems: 'center', gap: 7 },
  trayIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  trayLabel: { fontSize: 12.5, fontWeight: '600', color: colors.fg, textAlign: 'center' },

  recBar: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, paddingLeft: 16, paddingRight: 6, paddingVertical: 6, marginVertical: 8, ...shadow.sm },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.negative || colors.rose },
  recTime: { fontSize: 14, fontWeight: '700', color: colors.fg, fontVariant: ['tabular-nums'] },
  recHint: { flex: 1, fontSize: 13, color: colors.muted },
  recCancel: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.raised },
  recSend: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },

  amounts: { flexDirection: 'row', gap: 8 },
  amount: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  amountOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  amountText: { fontSize: 15, fontWeight: '700', color: colors.fg },
});
