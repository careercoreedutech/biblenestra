// POST FROM A LINK — the "Post a video from YouTube or Facebook" row in the Create post sheet, directly under the
// Text / Photo / Video tabs. The user pastes a link, the server validates it and returns a preview (thumbnail,
// title, channel); a caption and "Share post" post it at once as a video that plays the provider's own embed.
// Controlled by the sheet: onChange(embedDraft | null) where embedDraft = { provider, url, title, card, caption }.
import React, { useEffect, useRef, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { Icon } from '../Icons';
import { useApi } from '../../api/auth';
import { embedCard, looksLikeVideoLink } from '../../api/embeds';
import { colors, fonts, radius, shadow } from '../../theme';
import { haptic } from '../Toast';

// Simple platform marks drawn here (no logo artwork copied): a play glyph in a rounded box, and a plain "f"
export function YouTubeMark({ size = 18 }) {
  return (
    <Svg width={size} height={size * 0.72} viewBox="0 0 28 20">
      <Rect x={0} y={0} width={28} height={20} rx={6} fill={colors.negative} />
      <Path d="M11 6l8 4-8 4z" fill={colors.surface} />
    </Svg>
  );
}
export function FacebookMark({ size = 18 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={0} y={0} width={24} height={24} rx={6} fill={colors.slate} />
      <Path d="M13.2 20v-6.4h2.2l.3-2.6h-2.5V9.4c0-.7.2-1.2 1.3-1.2h1.3V5.9c-.2 0-1-.1-1.9-.1-1.9 0-3.2 1.2-3.2 3.3v1.9H8.6v2.6h2.2V20z" fill={colors.surface} />
    </Svg>
  );
}

export default function EmbedLinkPanel({ online = true, onChange }) {
  const api = useApi();
  const [link, setLink] = useState('');
  const [caption, setCaption] = useState('');
  const [card, setCard] = useState(null); // validated preview from the server
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);

  // Ask the server to validate and preview the pasted link (debounced; the newest request wins)
  useEffect(() => {
    const raw = link.trim();
    setError('');
    if (!raw) { setCard(null); return undefined; }
    if (!looksLikeVideoLink(raw)) { setCard(null); return undefined; }
    if (!online) { setCard(null); setError('Video links need an online account'); return undefined; }
    const mine = ++seq.current;
    setBusy(true);
    const t = setTimeout(() => {
      api.request('GET', `/posts/embed-preview?url=${encodeURIComponent(raw)}`)
        .then((e) => { if (mine === seq.current) { setCard(embedCard(e)); setBusy(false); } })
        .catch((e) => {
          if (mine !== seq.current) return;
          setCard(null);
          setBusy(false);
          setError((e && e.message) || 'Paste a YouTube or Facebook video link');
        });
    }, 450);
    return () => clearTimeout(t);
  }, [link, online]);

  // Tell the sheet what would be posted (the server re-validates everything on Share)
  useEffect(() => {
    if (!card) { onChange && onChange(null); return; }
    onChange && onChange({ provider: card.provider, url: card.url, title: card.title || undefined, card, caption: caption.trim() });
  }, [card, caption]);

  const paste = async () => {
    try {
      const s = await Clipboard.getStringAsync();
      if (s) { setLink(s.trim()); haptic('select'); }
    } catch (e) { setError('Couldn’t read the clipboard'); }
  };
  const clear = () => { setLink(''); setCaption(''); setCard(null); setError(''); };

  return (
    <View style={styles.panel}>
      <View style={styles.head}>
        <View style={styles.marks}>
          <YouTubeMark />
          <FacebookMark />
        </View>
        <Text style={styles.title} numberOfLines={1}>Post a video from YouTube or Facebook</Text>
      </View>

      {card ? (
        <View style={styles.preview}>
          <View style={styles.thumbBox}>
            {card.thumbnailUrl ? <Image source={{ uri: card.thumbnailUrl }} style={StyleSheet.absoluteFillObject} resizeMode="cover" /> : (
              <View style={[StyleSheet.absoluteFillObject, styles.thumbFallback]}><Icon name="play" size={22} color={colors.nightFg} fill={colors.nightFg} /></View>
            )}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.previewSource}>{card.label}</Text>
            <Text style={styles.previewTitle} numberOfLines={2}>{card.title || 'Video from ' + card.label}</Text>
            {card.authorName ? <Text style={styles.previewAuthor} numberOfLines={1}>{card.authorName}</Text> : null}
          </View>
          <Pressable onPress={clear} hitSlop={10} accessibilityRole="button" accessibilityLabel="Remove this video link" style={styles.removeBtn}>
            <Icon name="x" size={13} color={colors.muted} strokeWidth={2.4} />
          </Pressable>
        </View>
      ) : (
        <View style={styles.inputRow}>
          <TextInput
            value={link}
            onChangeText={setLink}
            placeholder="Paste a YouTube or Facebook link"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={styles.input}
            accessibilityLabel="Video link"
            editable={online}
          />
          <Pressable onPress={paste} disabled={!online} style={[styles.pasteBtn, !online && { opacity: 0.5 }]} accessibilityRole="button" accessibilityLabel="Paste from clipboard">
            <Text style={styles.pasteText}>Paste</Text>
          </Pressable>
        </View>
      )}

      {busy ? <Text style={styles.hint}>Checking the link…</Text> : null}
      {error ? <Text style={[styles.hint, { color: colors.negative }]}>{error}</Text> : null}

      {card ? (
        <TextInput
          value={caption}
          onChangeText={setCaption}
          placeholder="Add a caption (optional)"
          placeholderTextColor={colors.faint}
          multiline
          style={[styles.input, styles.caption]}
          accessibilityLabel="Caption for the video"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 12, ...shadow.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  marks: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  title: { flex: 1, fontFamily: fonts.serifBold, fontSize: 15, color: colors.fg },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, minWidth: 0, backgroundColor: colors.raised, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.fg },
  caption: { marginTop: 10, minHeight: 44, textAlignVertical: 'top' },
  pasteBtn: { height: 40, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.fg, alignItems: 'center', justifyContent: 'center' },
  pasteText: { color: colors.surface, fontSize: 13, fontWeight: '700' },
  hint: { marginTop: 8, fontSize: 12, color: colors.muted },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumbBox: { width: 96, height: 54, borderRadius: radius.sm || 8, overflow: 'hidden', backgroundColor: colors.night },
  thumbFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.nightRaised },
  previewSource: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: colors.gold },
  previewTitle: { fontSize: 13.5, fontWeight: '700', color: colors.fg, marginTop: 2 },
  previewAuthor: { fontSize: 12, color: colors.muted, marginTop: 2 },
  removeBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
});
