// Shared pieces for the Jobs, Calendar, Communities and Live study screens, in the Figma design's language
// (src/design/sanctuary.js tokens). Nothing here owns data: callers pass real values in.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { d, df, Tap } from '../sanctuary';
import { Icon } from '../../components/Icons';
import { useNav } from '../../navigation';
import { colors } from '../../theme'; // APPEARANCE (item 14): palette tokens

const DIRECTORY_TABS = [
  { label: 'Communities', route: 'Communities' },
  { label: 'Find Believers', route: 'People' },
  { label: 'Wishes', route: 'Wishes' },
];

/** The design's .segment: a three-way switch between the community directory routes. */
export function DirectorySegment({ active }) {
  const nav = useNav();
  return (
    <View style={s.segment} accessibilityRole="tablist">
      {DIRECTORY_TABS.map((t) => {
        const on = t.label === active;
        return (
          <Tap
            key={t.route}
            onPress={on ? undefined : () => nav.replace(t.route)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t.label}
            style={[s.segBtn, on && s.segBtnOn]}
          >
            <Text style={[s.segText, on && s.segTextOn]} numberOfLines={1}>{t.label}</Text>
          </Tap>
        );
      })}
    </View>
  );
}

const WEEK = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/**
 * The design's .calendar-month grid for one month. `dotDays` is a Set of day numbers (1-31)
 * that have real events; those days get a plum dot. `selectedDay` is highlighted when given.
 */
export function MonthGrid({ year, month, dotDays, selectedDay, onSelectDay, label, onPrev, onNext }) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // Monday first, like the design
  const total = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < offset; i += 1) cells.push(null);
  for (let day = 1; day <= total; day += 1) cells.push(day);
  while (cells.length % 7) cells.push(null);
  const rows = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return (
    <View style={s.month}>
      <View style={s.monthHead}>
        <Tap onPress={onPrev} disabled={!onPrev} accessibilityLabel="Previous month" style={s.navBtn}>
          <Icon name="chevron-left" size={16} color={d.ink} />
        </Tap>
        <Text style={s.monthTitle}>{label}</Text>
        <Tap onPress={onNext} disabled={!onNext} accessibilityLabel="Next month" style={s.navBtn}>
          <Icon name="chevron-right" size={16} color={d.ink} />
        </Tap>
      </View>
      <View style={s.weekRow}>
        {WEEK.map((w, i) => <Text key={`${w}${i}`} style={s.weekText}>{w}</Text>)}
      </View>
      {rows.map((row, ri) => (
        <View key={ri} style={s.gridRow}>
          {row.map((day, ci) => {
            if (!day) return <View key={ci} style={s.cell} />;
            const hasDot = !!dotDays && dotDays.has(day);
            const on = selectedDay === day;
            const inner = (
              <>
                <Text style={[s.dayText, on && s.dayTextOn]}>{day}</Text>
                {hasDot ? <View style={[s.dot, on && s.dotOn]} /> : null}
              </>
            );
            return onSelectDay ? (
              <Tap key={ci} onPress={() => onSelectDay(day)} style={[s.cell, on && s.cellOn]} accessibilityLabel={`Day ${day}`}>
                {inner}
              </Tap>
            ) : (
              <View key={ci} style={[s.cell, on && s.cellOn]}>{inner}</View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  segment: { flexDirection: 'row', backgroundColor: d.paper, borderWidth: 1, borderColor: d.line, borderRadius: 16, padding: 4, marginTop: 4, marginBottom: 14 },
  segBtn: { flex: 1, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  segBtnOn: { backgroundColor: d.ink },
  segText: { fontFamily: df.sansBold, fontSize: 12, color: d.muted },
  segTextOn: { color: d.paper },

  month: { backgroundColor: d.paper, borderWidth: 1, borderColor: d.line, borderRadius: 22, padding: 14, marginBottom: 6 },
  monthHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  monthTitle: { fontFamily: df.displayBold, fontSize: 18, color: d.ink },
  navBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: d.line, alignItems: 'center', justifyContent: 'center' },
  weekRow: { flexDirection: 'row', marginBottom: 4 },
  weekText: { flex: 1, textAlign: 'center', fontFamily: df.sansBold, fontSize: 10, color: d.muted, letterSpacing: 0.6 },
  gridRow: { flexDirection: 'row' },
  cell: { flex: 1, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  cellOn: { backgroundColor: d.plum },
  dayText: { fontFamily: df.sansMedium, fontSize: 13, color: d.ink },
  dayTextOn: { color: '#FFFFFF' },
  dot: { position: 'absolute', bottom: 4, width: 4, height: 4, borderRadius: 2, backgroundColor: d.plum },
  dotOn: { backgroundColor: colors.surfaceWhite },
});
