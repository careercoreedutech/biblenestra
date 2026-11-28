// PACKAGE F — long-press menu for a chat in the list. Options come from src/chat/chatActions.js.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AnimatedModal } from '../Motion';
import { colors } from '../../theme';
import { d, df } from '../../design/sanctuary';
import { chatActionsFor } from '../../chat/chatActions';

export function ChatActionsSheet({ chat, onClose, onPick }) {
  const items = chat ? chatActionsFor(chat) : [];
  return (
    <AnimatedModal visible={!!chat} onRequestClose={onClose}>
      <View style={styles.sheet}>
        <Text style={styles.title} numberOfLines={1}>{chat ? chat.with : ''}</Text>
        {items.map((it) => (
          <Pressable
            key={it.key}
            onPress={() => { onClose(); onPick(it.key, chat); }}
            style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.raised }]}
            accessibilityRole="button"
            accessibilityLabel={it.label}
          >
            <Text style={[styles.label, it.danger && { color: colors.negative }]}>{it.label}</Text>
          </Pressable>
        ))}
        <Pressable onPress={onClose} style={styles.item} accessibilityRole="button" accessibilityLabel="Cancel">
          <Text style={[styles.label, { color: d.muted }]}>Cancel</Text>
        </Pressable>
      </View>
    </AnimatedModal>
  );
}

const styles = StyleSheet.create({
  sheet: { marginHorizontal: 16, marginBottom: 24, borderRadius: 18, backgroundColor: colors.surface, overflow: 'hidden' },
  title: { paddingHorizontal: 18, paddingVertical: 14, fontSize: 13, fontFamily: df.sansBold, color: d.muted, borderBottomWidth: 1, borderBottomColor: d.line },
  item: { paddingHorizontal: 18, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: d.line },
  label: { fontSize: 16, fontFamily: df.sans, color: d.ink },
});
