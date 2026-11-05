// In-app time picker (no native module): three snapping wheels — hour · minute · AM/PM — plus quick presets.
// value = { hour: 0-23, minute: 0-59 }; onChange({ hour, minute })
import React, { useEffect, useRef } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PressScale } from './Motion';
import { colors, fonts, radius } from '../theme';
import { haptic } from './Toast';

const ITEM = 44;
const VISIBLE = 5;
const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const AMPM = ['AM', 'PM'];

function Wheel({ items, index, onIndex, render, width, label }) {
  const ref = useRef(null);
  const settle = useRef(null);
  const current = useRef(index);
  const scrolling = useRef(false);
  useEffect(() => {
    if (scrolling.current) return;
    current.current = index;
    const t = setTimeout(() => ref.current && ref.current.scrollTo({ y: index * ITEM, animated: false }), 0);
    return () => clearTimeout(t);
  }, [index]);
  const commit = (y) => {
    const i = Math.max(0, Math.min(items.length - 1, Math.round(y / ITEM)));
    scrolling.current = false;
    if (Platform.OS === 'web' && ref.current) ref.current.scrollTo({ y: i * ITEM, animated: true });
    if (i !== current.current) { current.current = i; haptic('select'); onIndex(i); }
  };
  const onScroll = (e) => {
    const y = e.nativeEvent.contentOffset.y;
    scrolling.current = true;
    clearTimeout(settle.current);
    settle.current = setTimeout(() => commit(y), Platform.OS === 'web' ? 140 : 220);
  };
  return (
    <View style={{ width, height: ITEM * VISIBLE }} accessibilityLabel={label}>
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScroll={onScroll}
        onMomentumScrollEnd={(e) => { clearTimeout(settle.current); commit(e.nativeEvent.contentOffset.y); }}
        contentContainerStyle={{ paddingVertical: ITEM * ((VISIBLE - 1) / 2) }}
      >
        {items.map((it, i) => {
          const on = i === index;
          return (
            <Pressable key={String(it)} style={styles.item} onPress={() => { ref.current && ref.current.scrollTo({ y: i * ITEM, animated: true }); current.current = i; onIndex(i); }} accessibilityRole="button" accessibilityLabel={`${label} ${render(it)}`}>
              <Text style={[styles.itemText, on && styles.itemOn]}>{render(it)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export const TIME_PRESETS = [
  { hour: 6, minute: 0 }, { hour: 7, minute: 0 }, { hour: 12, minute: 0 }, { hour: 18, minute: 0 }, { hour: 20, minute: 0 }, { hour: 21, minute: 30 },
];
const label = (h, m) => `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;

export default function TimeWheel({ value, onChange, presets = TIME_PRESETS }) {
  const h = value.hour;
  const m = value.minute;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const pm = h >= 12;
  const set = (hour12, minute, isPm) => onChange({ hour: (hour12 % 12) + (isPm ? 12 : 0), minute });
  return (
    <View>
      <View style={styles.box}>
        <View pointerEvents="none" style={styles.band} />
        <Wheel label="Hour" width={74} items={HOURS} index={h12 - 1} onIndex={(i) => set(HOURS[i], m, pm)} render={(x) => String(x)} />
        <Text style={styles.colon}>:</Text>
        <Wheel label="Minute" width={74} items={MINUTES} index={m} onIndex={(i) => set(h12, MINUTES[i], pm)} render={(x) => String(x).padStart(2, '0')} />
        <Wheel label="AM or PM" width={74} items={AMPM} index={pm ? 1 : 0} onIndex={(i) => set(h12, m, i === 1)} render={(x) => x} />
      </View>
      {presets && presets.length ? (
        <View style={styles.presets}>
          {presets.map((p) => {
            const on = p.hour === h && p.minute === m;
            return (
              <PressScale key={`${p.hour}:${p.minute}`} scaleTo={0.93} onPress={() => onChange(p)} style={[styles.preset, on && styles.presetOn]} accessibilityRole="button">
                <Text style={[styles.presetText, on && { color: '#FFFFFF' }]}>{label(p.hour, p.minute)}</Text>
              </PressScale>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  band: { position: 'absolute', left: 12, right: 12, top: ITEM * 2, height: ITEM, borderRadius: 12, backgroundColor: colors.primarySoft },
  item: { height: ITEM, alignItems: 'center', justifyContent: 'center' },
  itemText: { fontFamily: fonts.serif, fontSize: 22, color: colors.faint, fontVariant: ['tabular-nums'] },
  itemOn: { fontFamily: fonts.serifBold, fontSize: 26, color: colors.primary },
  colon: { fontFamily: fonts.serifBold, fontSize: 24, color: colors.primary, marginHorizontal: -4, marginTop: -3 },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  preset: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  presetOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  presetText: { fontSize: 12.5, fontWeight: '700', color: colors.fg, fontVariant: ['tabular-nums'] },
});
