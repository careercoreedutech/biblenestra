// FIND LOVE example profiles — PRESENTATION ONLY. These five illustrated people are not members: they are never sent to the
// server, never part of the swipe stack, and their cards have no like / pass / message / match handlers. Every card is
// labelled "Example profile". Portraits are drawn with react-native-svg (no photographs of real people).
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, LinearGradient as SvgLinear, Path, Rect, Stop } from 'react-native-svg';
import { Icon } from '../Icons';
import { fonts } from '../../theme';
import { love, lshadow } from './theme';
import { LoveChip } from './parts';
import { colors } from '../../theme'; // APPEARANCE (item 14): palette tokens

export const EXAMPLE_PROFILES = [
  {
    id: 'example-grace', firstName: 'Grace', age: 27, city: 'Lagos', country: 'Nigeria', denomination: 'Anglican',
    churchInvolvement: 'Attends weekly', intentionLabel: 'Marriage-minded', interests: ['Worship', 'Cooking', 'Reading'],
    bio: 'Choir alto on Sundays, hospital pharmacist on weekdays. I want a home full of songs and a husband who prays out loud.',
    portrait: { gender: 'woman', skin: '#8A5A3B', hair: '#1F1410', style: 'long', top: '#7A2E4A', bg: ['#F7DCD2', '#E7B7AA'] },
  },
  {
    id: 'example-daniel', firstName: 'Daniel', age: 29, city: 'Abuja', country: 'Nigeria', denomination: 'Baptist',
    churchInvolvement: 'Serves in ministry', intentionLabel: 'Long-term relationship', interests: ['Youth ministry', 'Sports', 'Travel'],
    bio: 'I lead the youth Bible study on Wednesdays. Looking for someone who laughs easily and is patient with my bad jokes.',
    portrait: { gender: 'man', skin: '#6B4329', hair: '#150D0A', style: 'short', top: '#2F4A3A', bg: ['#E3EDE2', '#C4D8C2'] },
  },
  {
    id: 'example-esther', firstName: 'Esther', age: 25, city: 'Accra', country: 'Ghana', denomination: 'Presbyterian',
    churchInvolvement: 'Exploring faith', intentionLabel: 'Friendship first', interests: ['Art', 'Hiking', 'Photography'],
    bio: 'I paint in the mornings and take long walks in the evenings. Faith is new to me and I would love to grow in it with someone.',
    portrait: { gender: 'woman', skin: '#5C3A26', hair: '#0E0908', style: 'bun', top: '#C9854F', bg: ['#F3E6D2', '#E6CFAE'] },
  },
  {
    id: 'example-samuel', firstName: 'Samuel', age: 31, city: 'Nairobi', country: 'Kenya', denomination: 'Methodist',
    churchInvolvement: 'Attends sometimes', intentionLabel: 'Marriage-minded', interests: ['Music', 'Coffee', 'Mentoring'],
    bio: 'Engineer by day, drummer for the Sunday band when I can. I want to build something lasting, with God at the centre.',
    portrait: { gender: 'man', skin: '#7B4F32', hair: '#120B09', style: 'short', top: '#3D3A6B', bg: ['#E6E3F0', '#CFC9E3'] },
  },
  {
    id: 'example-ruth', firstName: 'Ruth', age: 24, city: 'Kumasi', country: 'Ghana', denomination: 'Pentecostal',
    churchInvolvement: 'Serves in ministry', intentionLabel: 'Marriage-minded', interests: ['Missions', 'Dance', 'Fashion'],
    bio: 'I lead the women’s prayer group and teach dance to kids on Saturdays. Looking for a man who loves the Lord before anything.',
    portrait: { gender: 'woman', skin: '#4A2D1C', hair: '#0A0605', style: 'curly', top: '#A4475A', bg: ['#F9E3DF', '#EFC7C0'] },
  },
];

let gid = 0;
/** Illustrated bust: shoulders, neck, face and hair in a few styles, with a small gold cross on a chain. */
export function ExamplePortrait({ portrait, height = 170 }) {
  const [id] = useState(() => `ep${++gid}`);
  const p = portrait;
  const hairBack = p.style === 'long' ? (
    <Path d="M56 104 C44 56 70 30 100 30 C130 30 156 56 144 104 L150 158 C128 168 112 156 100 146 C88 156 72 168 50 158 Z" fill={p.hair} />
  ) : p.style === 'curly' ? (
    <React.Fragment>
      <Circle cx="62" cy="70" r="20" fill={p.hair} /><Circle cx="138" cy="70" r="20" fill={p.hair} />
      <Circle cx="70" cy="110" r="18" fill={p.hair} /><Circle cx="130" cy="110" r="18" fill={p.hair} />
      <Circle cx="100" cy="46" r="34" fill={p.hair} />
    </React.Fragment>
  ) : null;
  const hairTop = p.style === 'short' ? (
    <Path d="M64 88 C60 54 78 40 100 40 C124 40 142 54 137 88 C131 70 118 62 100 62 C84 62 70 70 64 88 Z" fill={p.hair} />
  ) : p.style === 'bun' ? (
    <React.Fragment>
      <Circle cx="100" cy="30" r="17" fill={p.hair} />
      <Path d="M64 84 C60 52 78 40 100 40 C124 40 142 52 137 84 C128 68 116 62 100 62 C84 62 72 68 64 84 Z" fill={p.hair} />
    </React.Fragment>
  ) : p.style === 'long' ? (
    <Path d="M64 82 C70 58 92 52 110 54 C126 56 136 68 138 82 C124 70 102 66 64 82 Z" fill={p.hair} />
  ) : p.style === 'curly' ? (
    <Path d="M66 84 C68 62 84 52 100 52 C118 52 132 62 134 84 C122 72 110 68 100 68 C88 68 76 72 66 84 Z" fill={p.hair} />
  ) : null;
  return (
    <Svg width="100%" height={height} viewBox="0 0 200 200" preserveAspectRatio="xMidYMin slice" accessibilityIgnoresInvertColors>
      <Defs>
        <SvgLinear id={`${id}bg`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={p.bg[0]} /><Stop offset="1" stopColor={p.bg[1]} />
        </SvgLinear>
      </Defs>
      <Rect x="0" y="0" width="200" height="200" fill={`url(#${id}bg)`} />
      <Circle cx="150" cy="44" r="26" fill="#FFFFFF" opacity="0.28" />
      {hairBack}
      <Path d={p.gender === 'man' ? 'M30 200 C30 150 60 132 100 132 C140 132 170 150 170 200 Z' : 'M34 200 C34 152 62 134 100 134 C138 134 166 152 166 200 Z'} fill={p.top} />
      <Rect x="88" y="110" width="24" height="30" rx="10" fill={p.skin} />
      <Path d="M90 150 L100 166 L110 150" fill="none" stroke="#C9A54A" strokeWidth="1.6" />
      <Path d="M100 160 L100 172 M96 164 L104 164" stroke="#C9A54A" strokeWidth="2" strokeLinecap="round" />
      <Ellipse cx="100" cy="92" rx="36" ry="42" fill={p.skin} />
      {hairTop}
      <Circle cx="86" cy="96" r="2.8" fill="#2A1A14" />
      <Circle cx="114" cy="96" r="2.8" fill="#2A1A14" />
      <Circle cx="78" cy="110" r="6" fill="#E8837A" opacity="0.25" />
      <Circle cx="122" cy="110" r="6" fill="#E8837A" opacity="0.25" />
      <Path d="M89 118 Q100 126 111 118" fill="none" stroke="#7A3B3B" strokeWidth="2.4" strokeLinecap="round" />
    </Svg>
  );
}

/** One static example card. No handlers: it cannot be liked, passed, messaged or matched. */
export function ExampleCard({ profile, width = 252, height = 340 }) {
  const where = [profile.city, profile.country].filter(Boolean).join(', ');
  return (
    <View style={[s.card, lshadow.md, { width, height }]} accessible accessibilityRole="text"
      accessibilityLabel={`Example profile: ${profile.firstName}, ${profile.age}, ${where}. Not a real member.`}>
      <View style={s.portrait}>
        <ExamplePortrait portrait={profile.portrait} height={170} />
        <View style={s.tag} pointerEvents="none"><Icon name="sparkles" size={11} color={love.goldBright} /><Text style={s.tagText}>Example profile</Text></View>
      </View>
      <View style={s.body}>
        <Text style={s.name} numberOfLines={1}>{profile.firstName}<Text style={s.age}>{`  ${profile.age}`}</Text></Text>
        <View style={s.row}><Icon name="map-pin" size={12} color={love.rose} /><Text style={s.meta} numberOfLines={1}>{where}</Text></View>
        <View style={s.chips}>
          {profile.denomination ? <LoveChip icon="cross" label={profile.denomination} tone="rose" /> : null}
          {profile.intentionLabel ? <LoveChip icon="heart" label={profile.intentionLabel} tone="rose" /> : null}
        </View>
        <Text style={s.bio} numberOfLines={2}>{profile.bio}</Text>
        <Text style={s.disclaimer}>Sample profile for illustration. Not a member.</Text>
      </View>
    </View>
  );
}

/** A horizontal row of example profiles with a clear label. Used on the Find Love intro and the empty Discover state. */
export function ExampleStrip({ title = 'Example profiles', note = 'These are illustrations, not members. Real people appear here once they join.', style }) {
  return (
    <View style={[{ marginTop: 18 }, style]}>
      <View style={s.head}>
        <Text style={s.headTitle}>{title}</Text>
        <Text style={s.headNote}>{note}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.strip}>
        {EXAMPLE_PROFILES.map((p) => <ExampleCard key={p.id} profile={p} />)}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  head: { paddingHorizontal: 18, marginBottom: 10 },
  headTitle: { fontFamily: fonts.display, fontSize: 19, color: love.goldBright },
  headNote: { marginTop: 3, fontSize: 12, lineHeight: 17, color: love.roseSoft },
  strip: { paddingHorizontal: 18, gap: 12, paddingBottom: 6 },
  card: { borderRadius: 22, backgroundColor: colors.surface, overflow: 'hidden', borderWidth: 1, borderColor: love.blushLine },
  portrait: { height: 170, overflow: 'hidden', backgroundColor: colors.cardLavender },
  tag: { position: 'absolute', top: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(40,26,17,0.72)' },
  tagText: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.3, color: '#FFFFFF' },
  body: { flex: 1, padding: 14, gap: 5 },
  name: { fontFamily: fonts.display, fontSize: 22, color: love.ink },
  age: { fontSize: 15, color: love.faint },
  row: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  meta: { fontSize: 12.5, color: love.faint, flexShrink: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  bio: { fontSize: 13, lineHeight: 18, color: love.ink, marginTop: 2 },
  disclaimer: { marginTop: 'auto', fontSize: 10.5, color: love.faint },
});
