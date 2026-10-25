import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

// Two-tone card: top-left sparkle, coloured title, grey description.
export default function Card({ title, subtitle, question, color, onPress, compact }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, compact && styles.compact, pressed && { opacity: 0.8 }]}
    >
      <Text style={styles.spark}>✦·</Text>
      {question ? <Text style={styles.question}>{question}</Text> : null}
      <Text style={[styles.title, { color }, compact && styles.titleCompact, question && { marginTop: 4 }]}>
        {title}
      </Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.cardBottom,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 16,
    minHeight: 118,
  },
  compact: { minHeight: 90, paddingTop: 10, paddingBottom: 12 },
  spark: { fontSize: 11, color: colors.muted, letterSpacing: 1 },
  question: { fontSize: 9.5, color: colors.muted, marginTop: 14 },
  title: { fontSize: 15, fontWeight: '600', lineHeight: 19, marginTop: 30 },
  titleCompact: { fontSize: 13.5, marginTop: 0 },
  subtitle: { fontSize: 10, color: colors.muted, lineHeight: 13.5, marginTop: 6 },
});
