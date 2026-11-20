import React from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View, Platform } from 'react-native';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { colors, fonts, shadow } from '../theme';

const icons = {
  Today: (c, active) => (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={4.2} stroke={c} strokeWidth={1.9} fill={active ? c : 'none'} fillOpacity={active ? 0.18 : 0} />
      <Path d="M12 2.8v2.1M12 19.1v2.1M2.8 12h2.1M19.1 12h2.1M5.5 5.5 7 7M17 17l1.5 1.5M5.5 18.5 7 17M17 7l1.5-1.5" stroke={active ? colors.gold : c} strokeWidth={1.9} strokeLinecap="round" />
    </Svg>
  ),
  Bible: (c, active) => (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 4.5A2.5 2.5 0 0 1 7.5 2H19v17H7.5A2.5 2.5 0 0 0 5 21.5v-17z"
        stroke={c}
        strokeWidth={1.9}
        strokeLinejoin="round"
        fill={active ? c : 'none'}
        fillOpacity={active ? 0.14 : 0}
      />
      <Path d="M5 21.5A2.5 2.5 0 0 1 7.5 19H19v3H7.5" stroke={c} strokeWidth={1.9} strokeLinejoin="round" />
      <Path d="M12 6v8M9 9h6" stroke={active ? colors.gold : c} strokeWidth={1.9} strokeLinecap="round" />
    </Svg>
  ),
  Discover: (c, active) => (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9.2} stroke={c} strokeWidth={1.9} fill={active ? c : 'none'} fillOpacity={active ? 0.14 : 0} />
      <Path d="M15.8 8.2l-2.1 5.5-5.5 2.1 2.1-5.5 5.5-2.1z" fill={active ? c : 'none'} stroke={c} strokeWidth={1.7} strokeLinejoin="round" />
    </Svg>
  ),
  Socials: (c, active) => (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Rect x={3} y={3.5} width={18} height={17} rx={5} stroke={c} strokeWidth={1.9} fill={active ? c : 'none'} fillOpacity={active ? 0.16 : 0} />
      <Path d="M10.2 8.8l5 3.2-5 3.2V8.8z" fill={c} stroke={c} strokeWidth={1.4} strokeLinejoin="round" />
    </Svg>
  ),
  Profile: (c, active) => (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={8} r={4} stroke={c} strokeWidth={1.9} fill={active ? c : 'none'} fillOpacity={active ? 0.14 : 0} />
      <Path d="M4.5 20.5c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5" stroke={c} strokeWidth={1.9} strokeLinecap="round" />
    </Svg>
  ),
};

export const TABS = ['Today', 'Bible', 'Discover', 'Socials'];

const VARIANTS = {
  light: { page: colors.screen, dock: colors.surface, border: colors.border, on: colors.primary, onLabel: colors.fg, off: colors.faint, pill: colors.primarySoft },
  night: { page: '#101221', dock: '#1A1D33', border: '#272B45', on: '#AEB8FF', onLabel: '#EDE7DB', off: '#6C697D', pill: '#262B4F' },
  sepia: { page: '#EEE2C9', dock: '#F8EFDC', border: '#DCCAA6', on: '#7B4A1C', onLabel: '#3A2D1C', off: '#A38F72', pill: '#E6D3AE' },
  dark: { page: '#000000', dock: 'rgba(28,28,32,0.96)', border: 'rgba(255,255,255,0.10)', on: '#FFFFFF', onLabel: '#FFFFFF', off: 'rgba(255,255,255,0.5)', pill: 'rgba(255,255,255,0.14)' },
};

function Tab({ name, isActive, v, onPress }) {
  const scale = React.useRef(new Animated.Value(isActive ? 1 : 0)).current;
  React.useEffect(() => {
    Animated.spring(scale, { toValue: isActive ? 1 : 0, useNativeDriver: true, friction: 7, tension: 120 }).start();
  }, [isActive]);
  const c = isActive ? v.on : v.off;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={name}
      accessibilityState={{ selected: isActive }}
      style={({ pressed }) => [styles.tab, pressed && { opacity: 0.7 }]}
      onPress={onPress}
    >
      <View style={styles.iconWrap}>
        <Animated.View
          style={[
            styles.indicator,
            { backgroundColor: v.pill, opacity: scale, transform: [{ scaleX: scale.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] },
          ]}
        />
        <Animated.View style={{ zIndex: 1, transform: [{ scale: scale.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1, 1.14, 1] }) }, { translateY: scale.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }] }}>{icons[name](c, isActive)}</Animated.View>
      </View>
      <Text style={[styles.label, { color: isActive ? v.onLabel : v.off }, isActive && styles.activeLabel]} numberOfLines={1}>
        {name}
      </Text>
    </Pressable>
  );
}

// `hidden` (Bible full-screen reading): the bar slides down and its space collapses so the page fills the screen.
export default function TabBar({ active, onChange, variant, hidden }) {
  const v = VARIANTS[variant || (active === 'Socials' ? 'dark' : 'light')] || VARIANTS.light;
  const shown = React.useRef(new Animated.Value(hidden ? 0 : 1)).current;
  const [h, setH] = React.useState(0);
  React.useEffect(() => {
    Animated.timing(shown, { toValue: hidden ? 0 : 1, duration: hidden ? 260 : 300, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [hidden]);
  const bar = (
    <View
      onLayout={(e) => { const hh = e.nativeEvent.layout.height; if (hh && Math.abs(hh - h) > 0.5) setH(hh); }}
      style={[styles.wrap, { backgroundColor: v.page }]}
    >
      <View style={[styles.dock, { backgroundColor: v.dock, borderColor: v.border }]}>
        {TABS.map((name) => (
          <Tab key={name} name={name} isActive={name === active} v={v} onPress={() => onChange(name)} />
        ))}
      </View>
    </View>
  );
  if (hidden === undefined) return bar;
  return (
    <Animated.View
      pointerEvents={hidden ? 'none' : 'auto'}
      accessibilityElementsHidden={!!hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      style={{ overflow: 'hidden', height: h ? shown.interpolate({ inputRange: [0, 1], outputRange: [0, h] }) : hidden ? 0 : undefined }}
    >
      <Animated.View style={{ opacity: shown, transform: [{ translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [h || 82, 0] }) }] }}>
        {bar}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: Platform.OS === 'ios' ? 2 : 10,
  },
  dock: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 30,
    borderWidth: 1,
    height: 66,
    paddingHorizontal: 6,
    ...shadow.md,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  iconWrap: {
    width: 58,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indicator: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 15,
  },
  label: {
    fontFamily: fonts.sans,
    fontSize: 10.5,
    marginTop: 2,
    fontWeight: '500',
    letterSpacing: 0.15,
  },
  activeLabel: {
    fontWeight: '700',
  },
});
