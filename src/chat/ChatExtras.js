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
import { ActivityIndicator, Dimensions, Image, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video'; // CHAT 7.4: videos in chat
import PdfReader from '../components/media/PdfReader'; // CHAT 7.4: in-app PDF reader
import { Audio } from 'expo-av';
import * as Clipboard from 'expo-clipboard';
import { Icon } from '../components/Icons';
import { AnimatedModal, PressScale, ScaleIn } from '../components/Motion';
import { Button, alpha } from '../components/ui';
import { colors, fonts, radius, shadow } from '../theme';
import { resolveChatMedia, useChatMediaSource, chatMediaLink, downloadChatFile } from '../api/chatMedia';
import { findMeetLink, fmtBytes } from './messages';

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
  const [rate, setRate] = useState(1); // CHAT 7.3: 1× / 1.5× / 2×
  const sound = useRef(null);
  const cycleRate = () => {
    const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
    setRate(next);
    if (sound.current) sound.current.setRateAsync(next, true).catch(() => {});
  };
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
      const { sound: snd } = await Audio.Sound.createAsync(src, { shouldPlay: true, rate, shouldCorrectPitch: true, progressUpdateIntervalMillis: 250 }, (s) => {
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
      <Pressable onPress={cycleRate} hitSlop={6} style={[styles.rateBtn, mine && { backgroundColor: 'rgba(255,255,255,0.2)' }]} accessibilityLabel={`Playback speed ${rate} times`}>
        <Text style={[styles.rateText, { color: fg }]}>{rate}×</Text>
      </Pressable>
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
  rateBtn: { minWidth: 34, height: 22, paddingHorizontal: 6, borderRadius: 11, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  rateText: { fontSize: 11, fontWeight: '700' },

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

// ---------- CHAT 7.4: documents / files, videos, in-app viewers, upload progress, forward ----------
const DOC_ICON = { pdf: 'PDF', doc: 'DOC', docx: 'DOC', ppt: 'PPT', pptx: 'PPT', xls: 'XLS', xlsx: 'XLS', csv: 'CSV', txt: 'TXT', zip: 'ZIP', epub: 'EPUB' };
const extOf = (name = '') => ((String(name).match(/\.([a-z0-9]{1,6})$/i) || [])[1] || '').toLowerCase();
export const isPdf = (f) => !!f && (/pdf/i.test(f.mime || '') || extOf(f.name) === 'pdf');

export function FileBubble({ file, mine, onOpen, onDownload }) {
  const ext = extOf(file.name);
  const label = DOC_ICON[ext] || (ext ? ext.toUpperCase().slice(0, 4) : 'FILE');
  const red = colors.negative || colors.rose;
  return (
    <Pressable onPress={onOpen} style={[xs.file, mine && xs.fileMine]} accessibilityRole="button" accessibilityLabel={`${file.name}. Tap to open`}>
      <View style={[xs.fileIcon, ext === 'pdf' && { backgroundColor: alpha(red, 0.14) }]}>
        <Text style={[xs.fileExt, ext === 'pdf' && { color: red }]}>{label}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[xs.fileName, mine && { color: '#FFFFFF' }]} numberOfLines={2}>{file.name}</Text>
        <Text style={[xs.fileMeta, mine && { color: 'rgba(255,255,255,0.7)' }]}>{[fmtBytes(file.size), isPdf(file) ? 'Tap to read' : 'Tap to open'].filter(Boolean).join(' · ')}</Text>
      </View>
      {onDownload ? (
        <Pressable onPress={onDownload} hitSlop={8} style={[xs.dlBtn, mine && { backgroundColor: 'rgba(255,255,255,0.2)' }]} accessibilityLabel={`Download ${file.name}`}>
          <Icon name="download" size={15} color={mine ? '#FFFFFF' : colors.primary} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

export function VideoBubble({ video, onOpen }) {
  return (
    <Pressable onPress={onOpen} style={xs.vid} accessibilityRole="button" accessibilityLabel="Video. Tap to play">
      <View style={xs.vidPlay}><Icon name="play" size={22} color="#FFFFFF" /></View>
      <Text style={xs.vidMeta} numberOfLines={1}>{['🎥', video.name, fmtBytes(video.size)].filter(Boolean).join(' ')}</Text>
    </Pressable>
  );
}

export function UploadBubble({ upload, mine }) {
  const pct = Math.round((upload.progress || 0) * 100);
  return (
    <View style={xs.up}>
      <Text style={[xs.fileName, mine && { color: '#FFFFFF' }]} numberOfLines={1}>{upload.label || 'Uploading…'}</Text>
      <View style={[styles.track, mine && { backgroundColor: 'rgba(255,255,255,0.25)' }]}>
        <View style={[styles.trackFill, { width: `${Math.max(4, pct)}%` }, mine && { backgroundColor: '#FFFFFF' }]} />
      </View>
      <Text style={[xs.fileMeta, mine && { color: 'rgba(255,255,255,0.7)' }]}>{upload.failed ? 'Upload failed' : `${pct}%`}</Text>
    </View>
  );
}

function VideoPlayerView({ uri }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = false; });
  return <VideoView player={player} style={{ width: '100%', height: '100%' }} contentFit="contain" nativeControls allowsFullscreen />;
}

/**
 * Full-screen viewer for chat media. item = { kind: 'image'|'video'|'pdf'|'file'|'audio', key, name, mime }
 * Images: auth-loaded; videos stream from a signed link; PDFs open in the in-app pdf.js reader (the same one the
 * media library uses — WebView on phones, iframe on web); audio uses the voice-note player; other files offer Download.
 */
export function ChatMediaViewer({ item, request, onClose }) {
  const [src, setSrc] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    setSrc(null); setErr(null);
    if (!item) return undefined;
    let alive = true;
    (async () => {
      try {
        if (item.kind === 'image') {
          const s = await resolveChatMedia(request, item.key);
          if (alive) setSrc(s);
        } else if (item.kind === 'video' || item.kind === 'pdf') {
          const l = await chatMediaLink(request, item.key);
          if (alive) setSrc({ uri: item.kind === 'pdf' ? l.viewerUrl : l.url });
        } else if (alive) setSrc({ uri: null });
      } catch (e) { if (alive) setErr('Couldn’t open this file'); }
    })();
    return () => { alive = false; };
  }, [item && item.key]);
  if (!item) return null;
  const download = () => downloadChatFile(request, item.key, item.name).catch(() => setErr('Couldn’t download this file'));
  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={xs.mv}>
        <View style={xs.mvBar}>
          <Pressable onPress={onClose} style={xs.mvBtn} accessibilityLabel="Close"><Icon name="x" size={18} color="#FFFFFF" /></Pressable>
          <Text style={xs.mvTitle} numberOfLines={1}>{item.name || (item.kind === 'image' ? 'Photo' : item.kind === 'video' ? 'Video' : 'File')}</Text>
          {item.kind !== 'audio' ? (
            <Pressable onPress={download} style={xs.mvBtn} accessibilityLabel="Download"><Icon name="download" size={17} color="#FFFFFF" /></Pressable>
          ) : <View style={xs.mvBtn} />}
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          {err ? <Text style={xs.mvMsg}>{err}</Text> : !src ? <ActivityIndicator color="#FFFFFF" /> : null}
          {src && !err && item.kind === 'image' ? <Image source={src} style={{ width: '100%', height: '100%' }} resizeMode="contain" /> : null}
          {src && !err && item.kind === 'video' ? <VideoPlayerView uri={src.uri} /> : null}
          {src && !err && item.kind === 'pdf' ? <PdfReader url={src.uri} style={{ flex: 1, alignSelf: 'stretch' }} onError={(m) => setErr(m)} /> : null}
          {src && !err && item.kind === 'audio' ? (
            <View style={xs.mvAudio}><AudioBubble voice={{ key: item.key, name: item.name, isFile: !!item.isFile, durationMs: item.durationMs }} request={request} /></View>
          ) : null}
          {src && !err && item.kind === 'file' ? (
            <View style={{ alignItems: 'center', gap: 14, paddingHorizontal: 30 }}>
              <Text style={xs.mvMsg}>{item.name}</Text>
              <Button label="Download" icon={<Icon name="download" size={14} color="#FFFFFF" />} onPress={download} />
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

// Forward to up to 5 chats (like WhatsApp)
export function ForwardSheet({ message, chats, request, onClose, onDone }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (message) { setPicked([]); setQ(''); setBusy(false); } }, [message && message.id]);
  const list = (chats || []).filter((c) => /^[0-9a-f-]{36}$/i.test(c.id) && c.canMessage !== false && (c.with || '').toLowerCase().includes(q.toLowerCase())).slice(0, 60);
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 5 ? p : [...p, id]));
  const send = async () => {
    if (!picked.length || busy) return;
    setBusy(true);
    try {
      const r = await request('POST', `/messages/${message.id}/forward`, { conversationIds: picked });
      if (onDone) onDone(r.results || []);
      onClose();
    } catch (e) { setBusy(false); if (onDone) onDone(null, e); }
  };
  return (
    <AnimatedModal visible={!!message} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Dismiss" />
        <View style={[styles.sheet, { maxHeight: '78%' }]}>
          <View style={styles.grabber} />
          <Text style={styles.sheetTitle}>Forward to…</Text>
          <TextInput value={q} onChangeText={setQ} placeholder="Search chats" placeholderTextColor={colors.faint} style={[styles.input, styles.inputBox]} />
          <ScrollView style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled">
            {list.map((c) => {
              const on = picked.includes(c.id);
              return (
                <Pressable key={c.id} onPress={() => toggle(c.id)} style={xs.fwdRow} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={c.with}>
                  <Text style={xs.fwdName} numberOfLines={1}>{c.with}</Text>
                  <Text style={xs.fwdKind}>{c.kind === 'group' ? 'Group' : c.kind === 'channel' ? 'Channel' : ''}</Text>
                  <View style={[xs.check, on && xs.checkOn]}>{on ? <Icon name="check" size={12} color="#FFFFFF" strokeWidth={3} /> : null}</View>
                </Pressable>
              );
            })}
            {!list.length ? <Text style={styles.hint}>No chats found</Text> : null}
          </ScrollView>
          <Button label={busy ? 'Forwarding…' : picked.length ? `Forward to ${picked.length}` : 'Choose up to 5 chats'} disabled={!picked.length || busy} onPress={send} />
        </View>
      </View>
    </AnimatedModal>
  );
}

const xs = StyleSheet.create({
  file: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 220, maxWidth: 280, padding: 8, borderRadius: 12, backgroundColor: colors.raised, marginVertical: 2 },
  fileMine: { backgroundColor: 'rgba(255,255,255,0.14)' },
  fileIcon: { width: 40, height: 46, borderRadius: 8, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  fileExt: { fontSize: 10.5, fontWeight: '800', color: colors.primary, letterSpacing: 0.5 },
  fileName: { fontSize: 13.5, fontWeight: '600', color: colors.fg },
  fileMeta: { fontSize: 11.5, color: colors.muted, marginTop: 2 },
  dlBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  vid: { width: 230, maxWidth: '100%', aspectRatio: 16 / 10, borderRadius: 12, backgroundColor: '#111216', alignItems: 'center', justifyContent: 'center', marginVertical: 2, overflow: 'hidden' },
  vidPlay: { width: 50, height: 50, borderRadius: 25, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
  vidMeta: { position: 'absolute', left: 8, right: 8, bottom: 6, fontSize: 11, color: 'rgba(255,255,255,0.85)' },
  up: { minWidth: 200, gap: 6, paddingVertical: 2 },
  mv: { flex: 1, backgroundColor: '#0D0E12' },
  mvBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 40, paddingHorizontal: 12, paddingBottom: 10 },
  mvBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  mvTitle: { flex: 1, color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  mvMsg: { color: 'rgba(255,255,255,0.8)', fontSize: 14, textAlign: 'center' },
  mvAudio: { width: '86%', backgroundColor: colors.surface, borderRadius: 16, padding: 14 },
  fwdRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  fwdName: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.fg },
  fwdKind: { fontSize: 12, color: colors.muted },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
});
