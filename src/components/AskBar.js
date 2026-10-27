import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts } from '../theme';

export default function AskBar({ placeholder = 'Ask anything...', onSend, initial }) {
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
      <LinearGradient
        colors={focused ? ['#28201a', '#1a1411'] : ['#201915', '#14100e']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      {/* Top subtle highlight */}
      <View style={styles.topBorderShimmer} />

      {/* Spark icon indicator */}
      <View style={styles.sparkWrapper}>
        <Text style={[styles.sparkIcon, focused && { color: colors.gold }]}>✦</Text>
      </View>

      <TextInput
        value={text}
        onChangeText={setText}
        onSubmitEditing={send}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        style={styles.input}
        returnKeyType="send"
      />

      <Pressable
        onPress={send}
        disabled={!hasText}
        style={({ pressed }) => [
          styles.sendBtn,
          hasText && styles.sendBtnActive,
          pressed && { opacity: 0.8 },
        ]}
        accessibilityLabel="Send"
      >
        <LinearGradient
          colors={hasText ? ['#f5d58a', '#e2752b'] : ['#362c26', '#221a15']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <Svg width={14} height={14} viewBox="0 0 14 14" fill="none">
          <Path
            d="M2 7h9M7.5 3.5 11 7l-3.5 3.5"
            stroke={hasText ? '#0e0c0b' : colors.muted}
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
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.glossBorder,
    overflow: 'hidden',
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 5,
    minHeight: 52,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 3,
  },
  containerFocused: {
    borderColor: 'rgba(229, 184, 105, 0.45)',
    shadowColor: colors.accent,
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  topBorderShimmer: {
    position: 'absolute',
    top: 0,
    left: 14,
    right: 14,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  sparkWrapper: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sparkIcon: {
    fontSize: 14,
    color: colors.muted,
  },
  input: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 13.5,
    color: colors.fg,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnActive: {
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 4,
  },
});
