import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { colors } from '../theme';

const icons = {
  Home: (c) => (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.6}>
      <Path d="M3 11 12 4l9 7v9H3z" />
      <Path d="M10 20v-6h4v6" />
    </Svg>
  ),
  Discover: (c) => (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.6}>
      <Rect x={4} y={3} width={16} height={18} rx={2} />
      <Path d="M8 8h8M8 12h8M8 16h5" />
    </Svg>
  ),
  Bible: (c) => (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.6}>
      <Path d="M3 5h7a3 3 0 0 1 2 1 3 3 0 0 1 2-1h7v14h-7a3 3 0 0 0-2 1 3 3 0 0 0-2-1H3z" />
      <Path d="M12 6v14" />
    </Svg>
  ),
  'God Mode': (c) => (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.6}>
      <Path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />
      <Path d="M19 15l.8 2 2.2.8-2.2.8L19 21l-.8-2.4L16 17.8l2.2-.8z" />
    </Svg>
  ),
  Prayer: (c) => (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.6}>
      <Path d="M9 20v-6a3 3 0 0 1 3-3 3 3 0 0 1 3 3v6" />
      <Path d="M9 11V5l3-2 3 2v6" />
    </Svg>
  ),
};

export const TABS = ['Home', 'Discover', 'Bible', 'God Mode', 'Prayer'];

export default function TabBar({ active, onChange }) {
  return (
    <View style={styles.bar}>
      {TABS.map((name) => {
        const c = name === active ? colors.accent : colors.muted;
        return (
          <Pressable key={name} style={styles.tab} onPress={() => onChange(name)}>
            {icons[name](c)}
            <Text style={[styles.label, { color: c }]}>{name}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 10,
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderTopColor: colors.tabLine,
    backgroundColor: colors.screen,
  },
  tab: { alignItems: 'center', gap: 4, minWidth: 54 },
  label: { fontSize: 10 },
});
