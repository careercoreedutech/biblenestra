import React from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View, Platform } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';

// Lucide icons used by the design: Home, BookOpen, Compass, UsersRound
const svg = (c, paths) => <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">{paths}</Svg>;
const icons = {
  Today: (c) => svg(c, <><Path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" stroke={c} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" /><Path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" stroke={c} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" /></>),
  Bible: (c) => svg(c, <><Path d="M12 7v14" stroke={c} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" /><Path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" stroke={c} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" /></>),
  Discover: (c) => svg(c, <><Circle cx={12} cy={12} r={10} stroke={c} strokeWidth={1.9} /><Path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z" stroke={c} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" /></>),
  Socials: (c) => svg(c, <><Path d="M18 21a8 8 0 0 0-16 0" stroke={c} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" /><Circle cx={10} cy={8} r={5} stroke={c} strokeWidth={1.9} /><Path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3" stroke={c} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" /></>),
};

export const TABS = ['Today', 'Bible', 'Discover', 'Socials'];

// FIGMA DESIGN (.bottom-nav): a dark floating dock; the active tab opens into a light pill with its label,
// and an orange + in the middle opens Create.
const D = { dock: 'rgba(46,29,18,0.96)', off: '#BFAE9F', onBg: '#FFF2E5', onText: '#472612', plum: '#FF6B1A' };

function Tab({ name, isActive, onPress }) {
  const open = React.useRef(new Animated.Value(isActive ? 1 : 0)).current;
  React.useEffect(() => {
    Animated.timing(open, { toValue: isActive ? 1 : 0, duration: 250, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [isActive]);
  return (
    <Animated.View style={{ flex: open.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }) }}>
      <Pressable
        accessibilityRole="tab"
        accessibilityLabel={name}
        accessibilityState={{ selected: isActive }}
        onPress={onPress}
        style={({ pressed }) => [styles.tab, isActive && { backgroundColor: D.onBg }, pressed && { transform: [{ scale: 0.98 }] }]}
      >
        <View style={styles.iconWrap}>{icons[name](isActive ? D.plum : D.off, false)}</View>
        {isActive ? <Text style={styles.label} numberOfLines={1}>{name}</Text> : null}
      </Pressable>
    </Animated.View>
  );
}

// `hidden` (Bible full-screen reading): the bar slides down and its space collapses so the page fills the screen.
export default function TabBar({ active, onChange, onCreate, hidden }) {
  const shown = React.useRef(new Animated.Value(hidden ? 0 : 1)).current;
  const [h, setH] = React.useState(0);
  React.useEffect(() => {
    Animated.timing(shown, { toValue: hidden ? 0 : 1, duration: hidden ? 260 : 300, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [hidden]);
  const tab = (name) => <Tab key={name} name={name} isActive={name === active} onPress={() => onChange(name)} />;
  const bar = (
    <View
      onLayout={(e) => { const hh = e.nativeEvent.layout.height; if (hh && Math.abs(hh - h) > 0.5) setH(hh); }}
      style={[styles.wrap, { backgroundColor: '#F8F1E7' }]}
    >
      <View style={styles.dock}>
        {TABS.slice(0, 2).map(tab)}
        <Pressable accessibilityLabel="Create" onPress={onCreate} style={({ pressed }) => [styles.create, pressed && { transform: [{ scale: 0.95 }] }]}>
          <Svg width={22} height={22} viewBox="0 0 24 24" fill="none"><Path d="M12 5v14M5 12h14" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" /></Svg>
        </Pressable>
        {TABS.slice(2).map(tab)}
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
  wrap: { paddingHorizontal: 14, paddingTop: 6, paddingBottom: Platform.OS === 'ios' ? 2 : 12 },
  dock: {
    flexDirection: 'row', alignItems: 'center', height: 66, padding: 7, borderRadius: 22,
    borderWidth: 1, borderColor: 'rgba(91,57,35,0.13)', backgroundColor: D.dock,
    shadowColor: '#362012', shadowOpacity: 0.25, shadowRadius: 19, shadowOffset: { width: 0, height: 16 }, elevation: 12,
  },
  tab: { height: 52, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, paddingHorizontal: 4, overflow: 'hidden' },
  iconWrap: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: 'DMSans-ExtraBold', fontSize: 10, color: D.onText, paddingRight: 6 },
  create: {
    width: 48, height: 48, marginHorizontal: 4, borderRadius: 16, backgroundColor: D.plum, alignItems: 'center', justifyContent: 'center',
    shadowColor: D.plum, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 8 }, elevation: 8,
  },
});
