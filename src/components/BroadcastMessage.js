// BROADCASTS (brief 11.1): official messages from the admin team in the Activity inbox.
//   <BroadcastSender>   official logo + sender name + verified badge
//   <BroadcastPreview>  the inbox row content (title, text preview, first image / video poster, link chip)
//   <BroadcastSheet>    the detail view: full text with clickable links, images, video (starts muted), link cards.
//                       Opening it records "opened"; tapping a link records a click (POST /broadcasts/:id/open|click).
import React, { useEffect, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { VIDEO_FILL } from './video/videoUtils';
import { Icon } from './Icons';
import { colors, fonts, radius, shadow } from '../theme';
import { AnimatedModal, PressScale } from './Motion';
import { useApi } from '../api/auth';
import { useToast } from './Toast';

const LOGO = require('../../assets/icon.png');
const URL_RE = /(https?:\/\/[^\s]+)/g;

const logoSource = (sender) => (sender && sender.logoUrl ? { uri: sender.logoUrl } : LOGO);

/** Official logo with a gold verified tick (used as the inbox row avatar). */
export function BroadcastLogo({ sender, size = 42 }) {
  return (
    <View style={{ width: size, height: size }}>
      <Image source={logoSource(sender)} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.primarySoft }} accessibilityIgnoresInvertColors />
      <View style={[styles.tick, { right: -3, bottom: -3 }]}><Icon name="check" size={9} color={colors.night} strokeWidth={3.4} /></View>
    </View>
  );
}

export function BroadcastSender({ sender, sub }) {
  const name = (sender && sender.name) || 'BibleNestra';
  return (
    <View style={styles.senderRow}>
      <Text style={styles.senderName} numberOfLines={1}>{name}</Text>
      <View style={styles.tickInline} accessibilityLabel="Verified"><Icon name="check" size={8} color={colors.night} strokeWidth={3.4} /></View>
      {sub ? <Text style={styles.senderSub} numberOfLines={1}>{sub}</Text> : null}
    </View>
  );
}

/** Text with tappable https:// links. */
function LinkedText({ text, style, onLink, numberOfLines }) {
  const parts = String(text || '').split(URL_RE);
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts.map((p, i) => (/^https?:\/\//.test(p)
        ? <Text key={i} style={styles.inlineLink} onPress={onLink ? () => onLink(p) : undefined} accessibilityRole="link">{p}</Text>
        : <Text key={i}>{p}</Text>))}
    </Text>
  );
}

/** Content of the broadcast row in the inbox. `n` is a mapped notification (kind 'broadcast'). */
export function BroadcastPreview({ n }) {
  const d = n.data || {};
  const media = Array.isArray(d.media) ? d.media : [];
  const first = media[0];
  const thumb = first ? (first.type === 'video' ? first.thumbUrl : first.url) : null;
  const link = Array.isArray(d.links) && d.links[0];
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <BroadcastSender sender={d.sender} />
      {d.title ? <Text style={styles.rowTitle} numberOfLines={2}>{d.title}</Text> : null}
      {d.text ? <Text style={styles.rowBody} numberOfLines={3}>{d.text}</Text> : !d.title ? <Text style={styles.rowBody} numberOfLines={2}>{n.body}</Text> : null}
      {first ? (
        <View style={styles.rowMedia}>
          {thumb ? <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
          {first.type === 'video' ? <View style={styles.playBadge}><Icon name="play" size={16} color="#FFFFFF" fill="#FFFFFF" /></View> : null}
          {media.length > 1 ? <View style={styles.moreBadge}><Text style={styles.moreText}>+{media.length - 1}</Text></View> : null}
        </View>
      ) : null}
      {link ? (
        <View style={styles.linkChip}>
          <Icon name="link" size={11} color={colors.primary} />
          <Text style={styles.linkChipText} numberOfLines={1}>{link.label || link.title || link.host}</Text>
        </View>
      ) : null}
      <Text style={styles.meta}>Official message · {n.time}</Text>
    </View>
  );
}

function InlineVideo({ m }) {
  const [on, setOn] = useState(false);
  const player = useVideoPlayer(on ? m.url : null, (p) => { p.muted = true; p.loop = false; }); // starts muted; unmute with the controls
  useEffect(() => { if (on && player) { try { player.play(); } catch (e) { /* ignore */ } } }, [on, player]);
  const ratio = m.width && m.height ? Math.max(0.6, Math.min(1.8, m.width / m.height)) : 16 / 9;
  return (
    <View style={[styles.video, { aspectRatio: ratio }]}>
      {on ? (
        <VideoView style={VIDEO_FILL} player={player} nativeControls allowsFullscreen allowsPictureInPicture={false} contentFit="contain" />
      ) : (
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setOn(true)} accessibilityRole="button" accessibilityLabel="Play video">
          {m.thumbUrl ? <Image source={{ uri: m.thumbUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
          <View style={styles.bigPlay}><Icon name="play" size={26} color="#FFFFFF" fill="#FFFFFF" /></View>
        </Pressable>
      )}
    </View>
  );
}

/** Full broadcast. `item` = { id, kind, data, time } (the inbox notification) — or null to hide. */
export function BroadcastSheet({ item, onClose }) {
  const api = useApi();
  const toast = useToast();
  const [full, setFull] = useState(null);
  const d = (full || (item && item.data)) || {};
  const id = item && item.data && item.data.broadcastId;

  useEffect(() => {
    setFull(null);
    if (!id) return;
    // record "opened" (once per person on the server) and get the full text
    api.request('POST', `/broadcasts/${id}/open`, {}).then((r) => { if (r && r.id) setFull(r); }).catch(() => {});
  }, [id]);

  const openLink = (url) => {
    if (id) api.request('POST', `/broadcasts/${id}/click`, { url }).catch(() => {});
    Linking.openURL(url).catch(() => toast.show('Couldn’t open that link', { tone: 'error' }));
  };

  const media = Array.isArray(d.media) ? d.media : [];
  const images = media.filter((m) => m.type === 'image');
  const video = media.find((m) => m.type === 'video');
  const links = Array.isArray(d.links) ? d.links : [];

  return (
    <AnimatedModal visible={!!item} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Dismiss" />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.head}>
            <BroadcastLogo sender={d.sender} size={44} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <BroadcastSender sender={d.sender} />
              <Text style={styles.senderSub}>Official message{item && item.time ? ` · ${item.time}` : ''}</Text>
            </View>
            <PressScale onPress={onClose} scaleTo={0.9} hitSlop={8} style={styles.close} accessibilityLabel="Close">
              <Icon name="x" size={16} color={colors.muted} />
            </PressScale>
          </View>
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
            {d.title ? <Text style={styles.title}>{d.title}</Text> : null}
            {d.text ? <LinkedText text={d.text} style={styles.text} onLink={openLink} /> : null}
            {images.map((m, i) => (
              <Image key={`${m.url}-${i}`} source={{ uri: m.url }} style={[styles.image, { aspectRatio: m.width && m.height ? Math.max(0.6, Math.min(1.8, m.width / m.height)) : 4 / 3 }]} resizeMode="cover" />
            ))}
            {video ? <InlineVideo m={video} /> : null}
            {links.map((l, i) => (
              <PressScale key={`${l.url}-${i}`} onPress={() => openLink(l.url)} scaleTo={0.98} style={l.label ? styles.linkBtn : styles.linkCard} accessibilityRole="link" accessibilityLabel={l.label || l.title || l.url}>
                {l.label ? (
                  <Text style={styles.linkBtnText} numberOfLines={1}>{l.label}</Text>
                ) : (
                  <>
                    {l.image ? <Image source={{ uri: l.image }} style={styles.linkImage} resizeMode="cover" /> : null}
                    <View style={{ padding: 12 }}>
                      <Text style={styles.linkTitle} numberOfLines={2}>{l.title || l.url}</Text>
                      {l.description ? <Text style={styles.linkDesc} numberOfLines={2}>{l.description}</Text> : null}
                      <Text style={styles.linkHost} numberOfLines={1}>{l.host || l.url}</Text>
                    </View>
                  </>
                )}
              </PressScale>
            ))}
          </ScrollView>
        </View>
      </View>
    </AnimatedModal>
  );
}

const styles = StyleSheet.create({
  tick: { position: 'absolute', width: 18, height: 18, borderRadius: 9, backgroundColor: colors.goldLight, borderWidth: 2, borderColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  tickInline: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.goldLight, alignItems: 'center', justifyContent: 'center' },
  senderRow: { flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 0 },
  senderName: { fontSize: 14, fontWeight: '800', color: colors.fg, flexShrink: 1 },
  senderSub: { fontSize: 11.5, color: colors.faint, fontWeight: '600', marginTop: 1 },
  rowTitle: { fontSize: 14, fontWeight: '700', color: colors.fg, marginTop: 3 },
  rowBody: { fontSize: 13.5, lineHeight: 19, color: colors.muted, marginTop: 2 },
  rowMedia: { marginTop: 8, height: 120, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  playBadge: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(21,23,43,0.6)', alignItems: 'center', justifyContent: 'center' },
  moreBadge: { position: 'absolute', right: 8, bottom: 8, backgroundColor: 'rgba(21,23,43,0.72)', borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  moreText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  linkChip: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', marginTop: 8, backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, maxWidth: '100%' },
  linkChipText: { fontSize: 12, fontWeight: '700', color: colors.primary, flexShrink: 1 },
  meta: { fontSize: 11.5, color: colors.faint, marginTop: 6, fontWeight: '600' },
  inlineLink: { color: colors.primary, fontWeight: '600', textDecorationLine: 'underline' },
  overlay: { flex: 1, backgroundColor: 'transparent', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.screen, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 22, maxHeight: '90%', ...shadow.lg },
  grabber: { alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  close: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.serifBold, fontSize: 22, lineHeight: 28, color: colors.fg, marginBottom: 6 },
  text: { fontSize: 15.5, lineHeight: 23, color: colors.passage },
  image: { width: '100%', borderRadius: radius.lg, marginTop: 12, backgroundColor: colors.raised },
  video: { width: '100%', borderRadius: radius.lg, marginTop: 12, overflow: 'hidden', backgroundColor: colors.night },
  bigPlay: { position: 'absolute', alignSelf: 'center', top: '50%', marginTop: -28, width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(21,23,43,0.6)', alignItems: 'center', justifyContent: 'center' },
  linkCard: { marginTop: 12, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden', ...shadow.sm },
  linkImage: { width: '100%', height: 150, backgroundColor: colors.raised },
  linkTitle: { fontSize: 14.5, fontWeight: '700', color: colors.fg },
  linkDesc: { fontSize: 13, color: colors.muted, marginTop: 3, lineHeight: 18 },
  linkHost: { fontSize: 11.5, color: colors.faint, marginTop: 5, fontWeight: '600' },
  linkBtn: { marginTop: 12, backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 12, alignItems: 'center' },
  linkBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14.5 },
});
