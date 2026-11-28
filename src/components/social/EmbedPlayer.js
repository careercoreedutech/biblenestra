// POST FROM A LINK — plays a YouTube or Facebook video inside a post. Nothing is downloaded: the card shows the
// provider's thumbnail, and on tap the provider's own embed plays (YouTube in the app's player, Facebook in its
// official plugin). Credit chip "via YouTube" / "via Facebook" and an "Open original" action sit under it.
// A play is reported to the existing video counter once, on tap (the embed cannot report real watch time).
import React, { useEffect, useRef, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../Icons';
import YouTubePlayer from '../YouTubePlayer';
import EmbedFrame from '../EmbedFrame';
import { useApi } from '../../api/auth';
import { recordVideoPlay } from '../../api/views';
import { setLiveCount } from './viewCounts';
import { embedCard, youtubeEmbedSrc, facebookPluginSrc } from '../../api/embeds';
import { colors, fonts, radius } from '../../theme';

export function EmbedCredit({ card, onOpen, style }) {
  return (
    <View style={[styles.creditRow, style]}>
      <View style={styles.chip} accessibilityLabel={`Video from ${card.label}`}>
        <Icon name="video" size={12} color={colors.muted} />
        <Text style={styles.chipText} numberOfLines={1}>via {card.label}{card.authorName ? ` · ${card.authorName}` : ''}</Text>
      </View>
      <Pressable onPress={onOpen} hitSlop={8} accessibilityRole="link" accessibilityLabel="Open the original video" style={styles.openBtn}>
        <Text style={styles.openText}>Open original</Text>
        <Icon name="chevron-right" size={12} color={colors.primary} />
      </Pressable>
    </View>
  );
}

/**
 * @param postId   the post id (for the play counter)
 * @param embed    the stored embed object { provider, url, videoId, thumbnailUrl, title, authorName }
 * @param autoplay start playing as soon as the card mounts (the full-screen Reels page)
 */
export default function EmbedPlayer({ postId, embed, autoplay = false, fill = false, style }) {
  const api = useApi();
  const card = embedCard(embed);
  const [started, setStarted] = useState(!!autoplay);
  const reported = useRef(false);

  const open = () => Linking.openURL(card.url).catch(() => {});
  // 3 s is above the server's minimum watch time; a start (tap, or autoplay on a Reels page) counts once
  const report = () => {
    if (reported.current || !postId) return;
    reported.current = true;
    recordVideoPlay(api, postId, 3000)
      .then((r) => { if (r && r.plays != null) setLiveCount('plays', postId, r.plays); })
      .catch(() => { /* counting is best effort */ });
  };
  useEffect(() => { if (autoplay) report(); }, [autoplay, postId]);
  const start = () => { setStarted(true); report(); };
  if (!card) return null;
  const frameStyle = fill ? styles.frameFill : styles.frame;

  return (
    <View style={[fill ? styles.wrapFill : styles.wrap, style]}>
      {started ? (
        <View style={frameStyle}>
          {card.provider === 'youtube' ? (
            <YouTubePlayer embedUrl={youtubeEmbedSrc(embed.videoId)} watchUrl={card.url} autoplay muted={false} style={styles.fill} />
          ) : (
            <EmbedFrame embedUrl={facebookPluginSrc(card.url)} />
          )}
        </View>
      ) : (
        <Pressable onPress={start} style={frameStyle} accessibilityRole="button" accessibilityLabel={`Play ${card.title || card.label + ' video'}`}>
          {card.thumbnailUrl ? <Image source={{ uri: card.thumbnailUrl }} style={styles.fill} resizeMode="cover" /> : <View style={[styles.fill, styles.fallback]} />}
          <View style={styles.scrim} pointerEvents="none" />
          <View style={styles.playWrap} pointerEvents="none">
            <View style={styles.playBtn}><Icon name="play" size={26} color={colors.nightFg} fill={colors.nightFg} /></View>
          </View>
          {card.title ? <Text style={styles.title} numberOfLines={2}>{card.title}</Text> : null}
        </Pressable>
      )}
      <EmbedCredit card={card} onOpen={open} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  wrapFill: { flex: 1, width: '100%' },
  frame: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.night, borderRadius: radius.lg, overflow: 'hidden' },
  frameFill: { flex: 1, width: '100%', backgroundColor: colors.night, overflow: 'hidden' },
  fill: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  fallback: { backgroundColor: colors.nightRaised },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(42,27,18,0.28)' },
  playWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  playBtn: { width: 58, height: 58, borderRadius: 29, backgroundColor: 'rgba(42,27,18,0.7)', alignItems: 'center', justifyContent: 'center', paddingLeft: 4 },
  title: { position: 'absolute', left: 12, right: 12, bottom: 10, color: colors.nightFg, fontFamily: fonts.serifBold, fontSize: 15, lineHeight: 20 },
  creditRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, paddingHorizontal: 10, height: 26, borderRadius: radius.pill, backgroundColor: colors.raised },
  chipText: { fontSize: 11.5, fontWeight: '600', color: colors.muted, flexShrink: 1 },
  openBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  openText: { fontSize: 12.5, fontWeight: '700', color: colors.primary },
});
