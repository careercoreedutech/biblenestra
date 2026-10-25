import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors } from '../theme';

export default function AskBar({ placeholder, onSend, initial }) {
  const [text, setText] = useState(initial || '');
  const send = () => {
    if (!text.trim()) return;
    onSend && onSend(text.trim());
    setText('');
  };
  return (
    <View style={styles.row}>
      <TextInput
        value={text}
        onChangeText={setText}
        onSubmitEditing={send}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        style={styles.input}
        returnKeyType="send"
      />
      <Pressable onPress={send} style={styles.send} accessibilityLabel="Send">
        <Svg width={13} height={13} viewBox="0 0 12 12">
          <Path d="M1 6h9M6.5 2.5 10 6l-3.5 3.5" stroke="#fff" strokeWidth={1.5} fill="none" />
        </Svg>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    flex: 1,
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 12,
    color: colors.fg,
  },
  send: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
