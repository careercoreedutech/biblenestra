// "Who liked" bottom sheet (comment likes, post reactions). Tapping a person opens their profile.
//   <PeopleSheet visible title eyebrow load={async () => people[]} onClose onOpenPerson />
// people: [{ id?, name, handle?, avatarUrl?, headline?, reaction?, isMe? }]
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Icon } from '../Icons';
import { colors, fonts, shadow } from '../../theme';
import { AnimatedModal, FadeInUp, PressScale, ScaleIn } from '../Motion';
import { SocialAvatar } from './FeedCard';
import { reactionOf } from './LightFeed';

export default function PeopleSheet({ visible, title = 'Liked by', eyebrow, load, onClose, onOpenPerson, emptyText = 'No likes yet', footer, rowIcon = 'heart' }) {
  const [state, setState] = useState({ loading: false, items: [], error: null });
  useEffect(() => {
    if (!visible || !load) return undefined;
    let alive = true;
    setState({ loading: true, items: [], error: null });
    Promise.resolve()
      .then(load)
      .then((items) => { if (alive) setState({ loading: false, items: items || [], error: null }); })
      .catch((e) => { if (alive) setState({ loading: false, items: [], error: (e && e.message) || 'Couldn’t load' }); });
    return () => { alive = false; };
  }, [visible, load]);

  return (
    <AnimatedModal visible={!!visible} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Dismiss" />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.head}>
            <View style={{ flex: 1, minWidth: 0 }}>
              {eyebrow ? <Text style={styles.eyebrow} numberOfLines={1}>{eyebrow}</Text> : null}
              <Text style={styles.title} numberOfLines={1}>{title}</Text>
            </View>
            <PressScale onPress={onClose} hitSlop={12} scaleTo={0.88} style={styles.close} accessibilityLabel="Close">
              <Svg width={12} height={12} viewBox="0 0 24 24" fill="none"><Path d="M6 6l12 12M18 6L6 18" stroke={colors.muted} strokeWidth={2.6} strokeLinecap="round" /></Svg>
            </PressScale>
          </View>
          <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
            {state.loading ? (
              <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
            ) : state.error ? (
              <Text style={styles.empty}>{state.error}</Text>
            ) : !state.items.length ? (
              <ScaleIn style={styles.center}>
                <View style={styles.emptyIcon}><Icon name="heart" size={20} color={colors.rose} /></View>
                <Text style={styles.empty}>{emptyText}</Text>
              </ScaleIn>
            ) : state.items.map((p, i) => {
              const r = p.reaction && p.reaction !== 'like' ? reactionOf(p.reaction) : null;
              return (
                <FadeInUp key={p.id || p.name + i} index={i} distance={8} duration={300}>
                  <PressScale onPress={() => onOpenPerson && onOpenPerson(p)} scaleTo={0.98} style={styles.row} accessibilityLabel={`Open ${p.name}'s profile`}>
                    <SocialAvatar name={p.name} uri={p.avatarUrl} size={40} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.name} numberOfLines={1}>{p.isMe ? `${p.name} (you)` : p.name}</Text>
                      {p.handle || p.headline ? <Text style={styles.sub} numberOfLines={1}>{[p.handle, p.headline].filter(Boolean).join(' · ')}</Text> : null}
                    </View>
                    {r ? <Text style={styles.reaction}>{r.emoji}</Text> : rowIcon === 'heart' ? <Icon name="heart" size={15} color={colors.rose} fill="solid" /> : <Icon name="chevron-right" size={15} color={colors.faint} />}
                  </PressScale>
                </FadeInUp>
              );
            })}
            {footer && !state.loading ? <Text style={styles.footer}>{footer}</Text> : null}
          </ScrollView>
        </View>
      </View>
    </AnimatedModal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'transparent', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.screen, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 26, ...shadow.lg },
  grabber: { alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  eyebrow: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase', color: colors.gold, marginBottom: 2 },
  title: { fontFamily: fonts.serifBold, fontSize: 22, lineHeight: 28, letterSpacing: -0.3, color: colors.fg },
  close: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 8, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border },
  name: { fontSize: 14.5, fontWeight: '700', color: colors.fg },
  sub: { fontSize: 12, color: colors.muted, marginTop: 1 },
  reaction: { fontSize: 18 },
  center: { alignItems: 'center', paddingVertical: 28 },
  emptyIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.cardRose, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  empty: { fontSize: 13.5, color: colors.muted, textAlign: 'center' },
  footer: { fontSize: 12.5, color: colors.faint, textAlign: 'center', marginTop: 4 },
});
