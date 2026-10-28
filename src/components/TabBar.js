import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { colors, fonts } from '../theme';

const icons = {
  Home: (active) => (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3 10.5L12 3l9 7.5v9.5a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1v-9.5z"
        stroke={active ? colors.fg : colors.muted}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </Svg>
  ),
  Discover: (active) => (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Circle
        cx={12}
        cy={12}
        r={9}
        stroke={active ? colors.fg : colors.muted}
        strokeWidth={1.6}
      />
      <Path
        d="M16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z"
        stroke={active ? colors.fg : colors.muted}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </Svg>
  ),
  Bible: (active) => (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5z"
        stroke={active ? colors.fg : colors.muted}
        strokeWidth={1.6}
      />
      <Path
        d="M6.5 2H20v4H6.5A2.5 2.5 0 0 0 4 8.5"
        stroke={active ? colors.fg : colors.muted}
        strokeWidth={1.6}
      />
      <Path
        d="M12 7v7M9.5 9.5h5"
        stroke={active ? colors.fg : colors.muted}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </Svg>
  ),
  'God Mode': (active) => (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 2l2.4 6.2L21 9.5l-5 4.3 1.6 6.7L12 17l-5.6 3.5 1.6-6.7-5-4.3 6.6-1.3L12 2z"
        stroke={active ? colors.gold : colors.muted}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </Svg>
  ),
  Prayer: (active) => (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M7 20h10M12 20v-8M9 8a3 3 0 0 1 6 0c0 2-2 3.5-3 5-1-1.5-3-3-3-5z"
        stroke={active ? colors.fg : colors.muted}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  ),
};

export const TABS = ['Home', 'Discover', 'Bible', 'God Mode', 'Prayer'];

export default function TabBar({ active, onChange }) {
  return (
    <View style={styles.dock}>
      {TABS.map((name) => {
        const isActive = name === active;
        const isGodMode = name === 'God Mode';
        const labelColor = isActive ? (isGodMode ? colors.gold : colors.fg) : colors.muted;

        return (
          <Pressable
            key={name}
            style={({ pressed }) => [
              styles.tab,
              pressed && { opacity: 0.75 },
            ]}
            onPress={() => onChange(name)}
          >
            <View style={styles.iconContainer}>
              {icons[name](isActive)}
            </View>

            <Text
              style={[
                styles.label,
                { color: labelColor },
                isActive && styles.activeLabel,
              ]}
              numberOfLines={1}
            >
              {name}
            </Text>

            {isActive ? (
              <View style={[styles.activeDot, { backgroundColor: isGodMode ? colors.gold : colors.fg }]} />
            ) : (
              <View style={styles.inactivePlaceholder} />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: colors.screen,
    borderTopWidth: 1,
    borderTopColor: colors.tabLine,
    paddingTop: 8,
    paddingBottom: 6,
    height: 56,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContainer: {
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: fonts.sans,
    fontSize: 10.5,
    marginTop: 3,
    letterSpacing: 0.1,
  },
  activeLabel: {
    fontFamily: fonts.sansMedium,
    fontWeight: '600',
  },
  activeDot: {
    width: 3.5,
    height: 3.5,
    borderRadius: 2,
    marginTop: 3,
  },
  inactivePlaceholder: {
    height: 3.5,
    marginTop: 3,
  },
});
