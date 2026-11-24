// MEMBERSHIP GROUPS — a MASTER CLASS post as it appears in EXECUTIVE CLASS (Telegram's linked-discussion card).
// The server sends only a reference (message kind 'shared_post'); `shared` is the original, joined at read time, so an
// edit shows here at once and a deleted post shows a tombstone. Members discuss it by replying to the card.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../Icons';
import { colors, radius } from '../../theme';
import { ChatImage, AudioBubble, FileBubble, VideoBubble, isPdf } from '../../chat/ChatExtras';
import { LinkPreviewCard } from './ChatGaps';
import { downloadChatFile } from '../../api/chatMedia';

export function SharedPost({ shared, mine, request, onView, onOpenMaster }) {
  const s = shared || { deleted: true };
  if (s.deleted) {
    return (
      <View style={[styles.card, styles.gone]}>
        <Icon name="volume" size={13} color={colors.faint} />
        <Text style={styles.goneText}>This MASTER CLASS post was deleted</Text>
      </View>
    );
  }
  const meta = s.meta || {};
  const image = s.kind === 'image' && s.mediaKey ? { key: s.mediaKey, width: meta.width || 0, height: meta.height || 0 } : null;
  const video = s.kind === 'video' && s.mediaKey ? { key: s.mediaKey, name: meta.name || 'Video', size: meta.size || 0, width: meta.width || 0, height: meta.height || 0, durationMs: meta.durationMs || 0 } : null;
  const file = s.kind === 'file' && s.mediaKey ? { key: s.mediaKey, name: meta.name || 'Document', mime: meta.mime || '', size: meta.size || 0 } : null;
  const voice = s.kind === 'voice' && s.mediaKey ? { key: s.mediaKey, durationMs: meta.durationMs || 0, name: meta.name || null, isFile: !!meta.file, waveform: Array.isArray(meta.waveform) ? meta.waveform : null } : null;
  const by = (s.sender && s.sender.displayName) || 'MASTER CLASS';
  return (
    <View style={styles.card}>
      <Pressable onPress={onOpenMaster} style={styles.head} accessibilityRole="button" accessibilityLabel={`MASTER CLASS post by ${by}. Open MASTER CLASS`}>
        <View style={styles.badge}><Icon name="volume" size={11} color={colors.gold} /></View>
        <Text style={styles.label} numberOfLines={1}>MASTER CLASS</Text>
        <Text style={styles.by} numberOfLines={1}>· {by}</Text>
        {s.editedAt ? <Text style={styles.edited}>edited</Text> : null}
      </Pressable>
      {image ? <ChatImage image={image} request={request} onOpen={() => onView && onView({ kind: 'image', key: image.key, name: 'Photo' })} /> : null}
      {video ? <VideoBubble video={video} onOpen={() => onView && onView({ kind: 'video', key: video.key, name: video.name })} /> : null}
      {file ? (
        <FileBubble
          file={file}
          mine={mine}
          onOpen={() => onView && onView({ kind: isPdf(file) ? 'pdf' : 'file', key: file.key, name: file.name, mime: file.mime })}
          onDownload={() => downloadChatFile(request, file.key, file.name).catch(() => {})}
        />
      ) : null}
      {voice ? <AudioBubble voice={voice} request={request} mine={mine} /> : null}
      {s.text ? <Text style={styles.text} selectable>{s.text}</Text> : null}
      {s.linkPreview ? <LinkPreviewCard preview={s.linkPreview} mine={false} style={{ marginTop: 6 }} /> : null}
      <View style={styles.foot}>
        <Icon name={s.commentsOff ? 'lock' : 'chat'} size={11} color={s.commentsOff ? colors.faint : colors.primary} />
        <Text style={[styles.footText, s.commentsOff && { color: colors.faint }]}>{s.commentsOff ? 'Comments are off for this post' : 'Swipe or tap Reply to comment'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { minWidth: 220, maxWidth: 300, borderLeftWidth: 3, borderLeftColor: colors.gold, paddingLeft: 10, paddingVertical: 2, gap: 6 },
  gone: { flexDirection: 'row', alignItems: 'center', gap: 6, borderLeftColor: colors.border },
  goneText: { fontSize: 13, color: colors.faint, fontStyle: 'italic' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  badge: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.cardGold, alignItems: 'center', justifyContent: 'center' },
  label: { flexShrink: 0, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, color: colors.gold },
  by: { flex: 1, minWidth: 0, fontSize: 12, color: colors.muted, fontWeight: '600' },
  edited: { fontSize: 11, color: colors.faint, marginLeft: 'auto' },
  text: { fontSize: 15, lineHeight: 21, color: colors.fg },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 6, marginTop: 2 },
  footText: { fontSize: 11.5, color: colors.primary, fontWeight: '600' },
  radius: { borderRadius: radius.md },
});
