import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';

export default function Card({ title, subtitle, question, color = colors.gold, onPress, compact, icon, style, right }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.touchable,
        pressed && styles.pressed,
        style,
      ]}
    >
      <View style={[styles.card, compact && styles.cardCompact]}>
        {/* Top meta row */}
        {(question || icon) ? (
          <View style={styles.headerRow}>
            {icon ? (
              <View style={styles.iconBox}>
                {typeof icon === 'string' ? (
                  <Text style={[styles.iconText, { color }]}>{icon}</Text>
                ) : (
                  icon
                )}
              </View>
            ) : null}

            {question ? (
              <Text style={styles.questionText} numberOfLines={1}>
                {question}
              </Text>
            ) : null}

            {right ? <View style={styles.rightSlot}>{right}</View> : null}
          </View>
        ) : null}

        {/* Content body */}
        <View style={styles.body}>
          <Text
            style={[
              styles.title,
              compact ? styles.titleCompact : styles.titleRegular,
            ]}
            numberOfLines={compact ? 2 : 3}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              style={[styles.subtitle, compact && styles.subtitleCompact]}
              numberOfLines={2}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>

        {/* Quiet indicator line at the bottom */}
        <View style={[styles.indicator, { backgroundColor: color }]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  touchable: {
    flex: 1,
  },
  pressed: {
    opacity: 0.82,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    minHeight: 120,
    justifyContent: 'space-between',
    overflow: 'hidden',
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  cardCompact: {
    minHeight: 92,
    padding: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 14,
  },
  questionText: {
    fontFamily: fonts.sansMedium,
    fontSize: 10.5,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    flex: 1,
  },
  rightSlot: {
    marginLeft: 'auto',
  },
  body: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    fontFamily: fonts.serifBold,
    color: colors.fg,
    letterSpacing: -0.2,
    lineHeight: 20,
  },
  titleRegular: {
    fontSize: 15,
    marginBottom: 4,
  },
  titleCompact: {
    fontSize: 13.5,
    lineHeight: 18,
    marginBottom: 3,
  },
  subtitle: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
    lineHeight: 16,
  },
  subtitleCompact: {
    fontSize: 11,
    color: colors.muted,
    lineHeight: 15,
  },
  indicator: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3.5,
  },
});
