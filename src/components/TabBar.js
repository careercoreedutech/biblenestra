import React from 'react';
import { Pressable, StyleSheet, Text, View, Platform } from 'react-native';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { colors, fonts } from '../theme';

const TAB_COLORS = {
  Bible: colors.forest,
  Discover: colors.indigo,
  Socials: colors.rose,
  Chats: colors.sky,
  Profile: colors.gold,
};

const icons = {
  Bible: (active) => (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5z"
        stroke={active ? colors.forest : colors.faint}
        strokeWidth={active ? 2.2 : 1.7}
      />
      <Path
        d="M6.5 2H20v4H6.5A2.5 2.5 0 0 0 4 8.5"
        stroke={active ? colors.forest : colors.faint}
        strokeWidth={active ? 2.2 : 1.7}
      />
      <Path
        d="M12 7v7M9.5 9.5h5"
        stroke={active ? colors.gold : colors.faint}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  ),
  Discover: (active) => (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Circle
        cx={12}
        cy={12}
        r={9}
        stroke={active ? colors.indigo : colors.faint}
        strokeWidth={active ? 2.2 : 1.7}
      />
      <Path
        d="M16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z"
        fill={active ? colors.indigo : 'none'}
        stroke={active ? colors.indigo : colors.faint}
        strokeWidth={active ? 2 : 1.7}
        strokeLinejoin="round"
      />
    </Svg>
  ),
  Socials: (active) => (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Rect
        x={3}
        y={3}
        width={18}
        height={18}
        rx={5}
        stroke={active ? colors.rose : colors.faint}
        strokeWidth={active ? 2.2 : 1.7}
      />
      <Path
        d="M10 8.5l6 3.5-6 3.5V8.5z"
        fill={active ? colors.rose : colors.faint}
        stroke={active ? colors.rose : colors.faint}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </Svg>
  ),
  Chats: (active) => (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path
        d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
        fill={active ? colors.skyFaint : 'none'}
        stroke={active ? colors.sky : colors.faint}
        strokeWidth={active ? 2.2 : 1.7}
        strokeLinejoin="round"
      />
    </Svg>
  ),
  Profile: (active) => (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path
        d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"
        stroke={active ? colors.gold : colors.faint}
        strokeWidth={active ? 2.2 : 1.7}
        strokeLinecap="round"
      />
      <Circle
        cx={12}
        cy={7}
        r={4}
        fill={active ? colors.goldFaint : 'none'}
        stroke={active ? colors.gold : colors.faint}
        strokeWidth={active ? 2.2 : 1.7}
      />
    </Svg>
  ),
};

export const TABS = ['Bible', 'Discover', 'Socials', 'Chats', 'Profile'];

export default function TabBar({ active, onChange }) {
  return (
    <View style={styles.dock}>
      {TABS.map((name) => {
        const isActive = name === active;
        const activeColor = TAB_COLORS[name] || colors.forest;
        const labelColor = isActive ? activeColor : colors.muted;

        return (
          <Pressable
            key={name}
            style={({ pressed }) => [
              styles.tab,
              pressed && { opacity: 0.7 },
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
                isActive && [styles.activeLabel, { color: activeColor }],
              ]}
              numberOfLines={1}
            >
              {name}
            </Text>

            {isActive ? (
              <View style={[styles.activePill, { backgroundColor: activeColor }]} />
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
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: colors.tabLine,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 18 : 8,
    height: Platform.OS === 'ios' ? 68 : 58,
    ...Platform.select({
      ios: {
        shadowColor: '#1C1917',
        shadowOffset: { width: 0, height: -3 },
        shadowOpacity: 0.05,
        shadowRadius: 6,
      },
      android: {
        elevation: 6,
      },
    }),
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
    fontWeight: '700',
    color: colors.forest,
  },
  activePill: {
    width: 14,
    height: 2.5,
    borderRadius: 1.5,
    backgroundColor: colors.forest,
    marginTop: 3,
  },
  inactivePlaceholder: {
    height: 2.5,
    marginTop: 3,
  },
});
