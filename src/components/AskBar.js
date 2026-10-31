import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors, fonts, radius, shadow } from '../theme';

export default function AskBar({ placeholder = 'Ask anything in scripture…', onSend, initial }) {
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
        <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
          <Path
            d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z"
            stroke={focused ? colors.primary : colors.gold}
            strokeWidth={1.8}
            strokeLinejoin="round"
          />
          <Path d="M19 15l.8 1.9 1.9.8-1.9.8L19 20.4l-.8-1.9-1.9-.8 1.9-.8L19 15z" fill={colors.gold} />
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
        style={({ pressed }) => [styles.sendBtn, hasText ? styles.sendBtnActive : styles.sendBtnDisabled, pressed && { opacity: 0.8 }]}
        accessibilityLabel="Send"
      >
        <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
          <Path
            d="M12 19V5M5 12l7-7 7 7"
            stroke={hasText ? colors.primaryFg : colors.faint}
            strokeWidth={2.4}
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
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 6,
    marginVertical: 8,
    ...shadow.sm,
  },
  containerFocused: { borderColor: colors.primary },
  iconWrapper: { marginRight: 10, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, fontFamily: fonts.sans, fontSize: 14.5, color: colors.fg, paddingVertical: 6 },
  sendBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  sendBtnActive: { backgroundColor: colors.primaryBg },
  sendBtnDisabled: { backgroundColor: colors.raised },
});
