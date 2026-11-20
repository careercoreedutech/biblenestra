// CHAT 7.3 — chat composer: "+" attach, growing text box, mic ↔ send, "Typing…" signal, @mention suggestions.
//   <Composer onSend={(text, { mentions }) => …} onAttach onMic onTyping members={[{ id, displayName }]}
//             prefill prefillKey focusKey sendLabel placeholder />
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '../Icons';
import { SocialAvatar } from '../social/FeedCard';
import { colors, fonts, radius } from '../../theme';

const MENTION_RE = /(^|\s)@([^\s@]{0,30})$/;

export const Composer = memo(function Composer({
  placeholder = 'Message', onSend, onAttach, onMic, onTyping, members, prefill, prefillKey, focusKey, sendLabel = 'Send', disabled, micEnabled = true,
}) {
  const [text, setText] = useState('');
  const [height, setHeight] = useState(40);
  const picked = useRef(new Map()); // displayName → id, for names chosen from the suggestions
  const inputRef = useRef(null);
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
      <View style={styles.row}>
        {onAttach ? (
          <Pressable onPress={onAttach} hitSlop={6} style={styles.roundBtn} accessibilityLabel="Attach a photo, video, document, audio, call or gift">
            <Icon name="plus" size={20} color={colors.muted} />
          </Pressable>
        ) : null}
        <View style={styles.box}>
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
        ) : (
          <Pressable onPress={onMic} style={[styles.sendBtn, !micEnabled && { opacity: 0.45 }]} accessibilityLabel="Record a voice message">
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
  suggestChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 4, paddingRight: 10, height: 30, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, maxWidth: 180 },
  suggestText: { fontSize: 13, fontWeight: '600', color: colors.fg },
});
