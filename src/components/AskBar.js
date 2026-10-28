import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors, fonts } from '../theme';

export default function AskBar({ placeholder = 'Ask anything in scripture...', onSend, initial }) {
  const [text, setText] = useState(initial || '');
  const [focused, setFocused] = useState(false);

  const send = () => {
    if (!text.trim()) return;
    onSend && onSend(text.trim());
    setText('');
  };

  const hasText = Boolean(text.trim());

  return (
    <View style={[styles.container, focused && styles.containerFocused]}>
      <View style={styles.iconWrapper}>
        <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
          <Path
            d="M21 21l-4.35-4.35M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0z"
            stroke={focused ? colors.gold : colors.muted}
            strokeWidth={1.8}
            strokeLinecap="round"
          />
        </Svg>
      </View>

      <TextInput
        value={text}
        onChangeText={setText}
        onSubmitEditing={send}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        style={styles.input}
        returnKeyType="send"
      />

      <Pressable
        onPress={send}
        disabled={!hasText}
        style={({ pressed }) => [
          styles.sendBtn,
          hasText ? styles.sendBtnActive : styles.sendBtnDisabled,
          pressed && { opacity: 0.8 },
        ]}
        accessibilityLabel="Send"
      >
        <Svg width={13} height={13} viewBox="0 0 14 14" fill="none">
          <Path
            d="M2 7h9M7.5 3.5 11 7l-3.5 3.5"
            stroke={hasText ? colors.primaryFg : colors.faint}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginVertical: 8,
  },
  containerFocused: {
    borderColor: colors.borderStrong,
    backgroundColor: colors.raised,
  },
  iconWrapper: {
    marginRight: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.fg,
    paddingVertical: 4,
  },
  sendBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  sendBtnActive: {
    backgroundColor: colors.primaryBg,
  },
  sendBtnDisabled: {
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
