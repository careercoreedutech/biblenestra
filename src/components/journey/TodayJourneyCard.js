// MY SCRIPTURE JOURNEY: the compact card on Today. It sits after the daily rhythm and shortcuts, and opens the dashboard.
import React from 'react';
import { Text, View } from 'react-native';
import { Icon } from '../Icons';
import { d, df, Tap, Grad, gradients } from '../../design/sanctuary';
import { DCard } from '../../design/profile/parts';
import { useNav } from '../../navigation';
import { useJourneyStats } from '../../api/journey';

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

export default function TodayJourneyCard() {
  const nav = useNav();
  const stats = useJourneyStats();
  const s = stats.data;
  const today = s ? s.day.verses : 0;
  const target = s ? s.day.target : 0;
  const line = !s
    ? 'Track the verses you read each day'
    : target
      ? `${fmt(today)} of ${fmt(target)} verses today`
      : `${fmt(today)} verses read today`;
  const streak = s ? s.streak.current : 0;
  return (
    <Tap onPress={() => nav.push('Journey')} style={{ marginTop: 14 }} accessibilityLabel="My Scripture Journey, open dashboard">
      <DCard style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Grad colors={gradients.gold} style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="book" size={20} color="#fff" />
        </Grad>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: df.sansSemi, color: d.ink, fontSize: 15 }}>My Scripture Journey</Text>
          <Text style={{ fontFamily: df.sans, color: d.muted, fontSize: 13, marginTop: 2 }} numberOfLines={1}>
            {line}{streak > 1 ? ` · ${streak}-day streak` : ''}
          </Text>
        </View>
        <Icon name="chevron-right" size={16} color={d.muted} />
      </DCard>
    </Tap>
  );
}
