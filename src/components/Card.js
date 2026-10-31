import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius, shadow } from '../theme';
import { Icon } from './Icons';
import { alpha } from './ui';
import { PressScale } from './Motion';

export default function Card({ title, subtitle, question, color = colors.gold, onPress, compact, icon, style, right }) {
  return (
    <PressScale onPress={onPress} scaleTo={0.97} style={[styles.touchable, style]}>
      <View style={[styles.card, compact && styles.cardCompact]}>
        {question || icon || right ? (
          <View style={styles.headerRow}>
            {icon ? (
              <View style={[styles.iconBox, { backgroundColor: alpha(color, 0.13) }]}>
                {typeof icon === 'string' ? <Icon name={icon} color={color} size={17} /> : icon}
              </View>
            ) : null}
            {question ? (
              <Text style={[styles.questionText, { color }]} numberOfLines={1}>
                {question}
              </Text>
            ) : <View style={{ flex: 1 }} />}
            {right ? <View style={styles.rightSlot}>{right}</View> : null}
          </View>
        ) : null}

        <View style={styles.body}>
          <Text style={[styles.title, compact ? styles.titleCompact : styles.titleRegular]} numberOfLines={compact ? 2 : 3}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={[styles.subtitle, compact && styles.subtitleCompact]} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  touchable: { flex: 1 },
  pressed: { opacity: 0.88, transform: [{ scale: 0.99 }] },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    minHeight: 124,
    justifyContent: 'space-between',
    overflow: 'hidden',
    ...shadow.sm,
  },
  cardCompact: { minHeight: 96, padding: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 12 },
  iconBox: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  questionText: {
    fontFamily: fonts.sansMedium,
    fontSize: 10.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    flex: 1,
  },
  rightSlot: { marginLeft: 'auto' },
  body: { justifyContent: 'flex-end' },
  title: { fontFamily: fonts.serifBold, color: colors.fg, letterSpacing: -0.2 },
  titleRegular: { fontSize: 17, lineHeight: 22, marginBottom: 4 },
  titleCompact: { fontSize: 15, lineHeight: 19, marginBottom: 3 },
  subtitle: { fontFamily: fonts.sans, fontSize: 12.5, color: colors.muted, lineHeight: 17 },
  subtitleCompact: { fontSize: 11.5, lineHeight: 15.5 },
});
