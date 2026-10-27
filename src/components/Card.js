import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts } from '../theme';

export default function Card({ title, subtitle, question, color = colors.gold, onPress, compact, icon, style }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.touchable,
        pressed && styles.pressed,
        style,
      ]}
    >
      <View style={[styles.cardContainer, compact && styles.compactContainer]}>
        {/* Glossy gradient background */}
        <LinearGradient
          colors={['#251e1a', '#171311']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />

        {/* Glossy top specular light reflection */}
        <LinearGradient
          colors={['rgba(255, 255, 255, 0.12)', 'rgba(255, 255, 255, 0.0)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 0.5 }}
          style={styles.glossOverlay}
        />

        {/* Header row: sparkle/icon and optional category/question */}
        <View style={styles.headerRow}>
          <View style={[styles.sparkBadge, { borderColor: color + '44', backgroundColor: color + '15' }]}>
            <Text style={[styles.spark, { color }]}>{icon || '✦'}</Text>
          </View>
          {question ? (
            <View style={styles.questionBadge}>
              <Text style={styles.questionText} numberOfLines={1}>{question}</Text>
            </View>
          ) : null}
        </View>

        {/* Content */}
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

        {/* Accent glow corner indicator */}
        <View style={[styles.cornerPill, { backgroundColor: color }]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  touchable: {
    flex: 1,
  },
  pressed: {
    opacity: 0.88,
    transform: [{ scale: 0.985 }],
  },
  cardContainer: {
    borderRadius: 18,
    paddingHorizontal: 15,
    paddingTop: 15,
    paddingBottom: 16,
    minHeight: 136,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.glossBorder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 4,
    justifyContent: 'space-between',
  },
  compactContainer: {
    minHeight: 98,
    paddingTop: 12,
    paddingBottom: 12,
    paddingHorizontal: 13,
    borderRadius: 15,
  },
  glossOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 48,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sparkBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spark: {
    fontSize: 12,
    fontWeight: '700',
  },
  questionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  questionText: {
    fontSize: 10,
    color: colors.muted,
    fontFamily: fonts.sansMedium,
    letterSpacing: 0.3,
  },
  body: {
    marginTop: 'auto',
  },
  title: {
    color: colors.fg,
    letterSpacing: -0.2,
  },
  titleRegular: {
    fontFamily: fonts.serifBold,
    fontSize: 16,
    lineHeight: 21,
  },
  titleCompact: {
    fontFamily: fonts.serifBold,
    fontSize: 14,
    lineHeight: 18,
  },
  subtitle: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
    lineHeight: 15,
    marginTop: 4,
  },
  subtitleCompact: {
    fontSize: 10.5,
    lineHeight: 14,
    marginTop: 2,
  },
  cornerPill: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 24,
    height: 2,
    borderTopLeftRadius: 2,
    opacity: 0.6,
  },
});
