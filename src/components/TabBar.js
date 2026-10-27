import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect, Circle } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts } from '../theme';

const icons = {
  Home: (active) => (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3 10.5L12 3l9 7.5v9.5a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1v-9.5z"
        stroke={active ? colors.gold : colors.muted}
        strokeWidth={active ? 2 : 1.6}
        strokeLinejoin="round"
        fill={active ? 'rgba(229, 184, 105, 0.12)' : 'none'}
      />
    </Svg>
  ),
  Discover: (active) => (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Circle
        cx={12}
        cy={12}
        r={9}
        stroke={active ? colors.gold : colors.muted}
        strokeWidth={active ? 2 : 1.6}
      />
      <Path
        d="M16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z"
        stroke={active ? colors.gold : colors.muted}
        strokeWidth={active ? 2 : 1.6}
        strokeLinejoin="round"
        fill={active ? 'rgba(229, 184, 105, 0.18)' : 'none'}
      />
    </Svg>
  ),
  Bible: (active) => (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5z"
        stroke={active ? colors.gold : colors.muted}
        strokeWidth={active ? 2 : 1.6}
        fill={active ? 'rgba(229, 184, 105, 0.12)' : 'none'}
      />
      <Path
        d="M6.5 2H20v4H6.5A2.5 2.5 0 0 0 4 8.5"
        stroke={active ? colors.gold : colors.muted}
        strokeWidth={active ? 2 : 1.6}
      />
      <Path
        d="M12 7v7M9.5 9.5h5"
        stroke={active ? colors.gold : colors.muted}
        strokeWidth={active ? 2 : 1.6}
        strokeLinecap="round"
      />
    </Svg>
  ),
  'God Mode': (active) => (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 2l2.4 6.2L21 9.5l-5 4.3 1.6 6.7L12 17l-5.6 3.5 1.6-6.7-5-4.3 6.6-1.3L12 2z"
        stroke={active ? colors.accent : colors.muted}
        strokeWidth={active ? 2 : 1.6}
        strokeLinejoin="round"
        fill={active ? 'rgba(226, 117, 43, 0.22)' : 'none'}
      />
    </Svg>
  ),
  Prayer: (active) => (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path
        d="M7 20h10M12 20v-8M9 8a3 3 0 0 1 6 0c0 2-2 3.5-3 5-1-1.5-3-3-3-5z"
        stroke={active ? colors.gold : colors.muted}
        strokeWidth={active ? 2 : 1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={active ? 'rgba(229, 184, 105, 0.15)' : 'none'}
      />
    </Svg>
  ),
};

export const TABS = ['Home', 'Discover', 'Bible', 'God Mode', 'Prayer'];

export default function TabBar({ active, onChange }) {
  return (
    <View style={styles.wrapper}>
      {/* Glossy dock glass layer */}
      <LinearGradient
        colors={['rgba(28, 23, 20, 0.98)', 'rgba(14, 12, 11, 0.99)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      {/* Top subtle golden shimmer highlight */}
      <View style={styles.topShimmer} />

      <View style={styles.dock}>
        {TABS.map((name) => {
          const isActive = name === active;
          const isGodMode = name === 'God Mode';
          const labelColor = isActive ? (isGodMode ? colors.accent : colors.gold) : colors.muted;

          return (
            <Pressable
              key={name}
              style={({ pressed }) => [
                styles.tab,
                isActive && styles.activeTab,
                pressed && styles.pressed,
              ]}
              onPress={() => onChange(name)}
            >
              {isActive ? (
                <View style={[styles.activePillGlow, isGodMode && styles.godModeGlow]} />
              ) : null}

              <View style={styles.iconContainer}>
                {icons[name](isActive)}
              </View>

              <Text style={[styles.label, { color: labelColor }, isActive && styles.activeLabel]}>
                {name}
              </Text>

              {isActive ? <View style={[styles.activeIndicator, { backgroundColor: labelColor }]} /> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderTopWidth: 1,
    borderTopColor: colors.glossBorderTop,
    paddingTop: 8,
    paddingBottom: 8,
    backgroundColor: colors.screen,
  },
  topShimmer: {
    position: 'absolute',
    top: 0,
    left: 20,
    right: 20,
    height: 1,
    backgroundColor: 'rgba(246, 216, 146, 0.3)',
  },
  dock: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  tab: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 14,
    minWidth: 58,
    position: 'relative',
  },
  activeTab: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  pressed: {
    opacity: 0.75,
  },
  activePillGlow: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    left: 4,
    right: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(229, 184, 105, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(229, 184, 105, 0.25)',
  },
  godModeGlow: {
    backgroundColor: 'rgba(226, 117, 43, 0.1)',
    borderColor: 'rgba(226, 117, 43, 0.3)',
  },
  iconContainer: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: fonts.sansMedium,
    fontSize: 10.5,
    marginTop: 3,
    letterSpacing: 0.2,
  },
  activeLabel: {
    fontWeight: '700',
  },
  activeIndicator: {
    width: 14,
    height: 2,
    borderRadius: 1,
    marginTop: 3,
  },
});
