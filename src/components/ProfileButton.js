// Avatar button shown at the top-right of the main screens; opens the Profile.
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, shadow } from '../theme';
import { useStore } from '../store';
import { useNav } from '../navigation';
import { PressScale } from './Motion';

export default function ProfileButton({ size = 38, dark = false, style }) {
  const { state } = useStore();
  const nav = useNav();
  const name = (state.user && state.user.displayName) || 'You';
  const unread = (state.requests || []).length;
  return (
    <PressScale
      onPress={() => nav.push('Profile')}
      scaleTo={0.9}
      hitSlop={8}
      accessibilityLabel="Open your profile"
      style={[styles.ring, { width: size, height: size, borderRadius: size / 2 }, dark && styles.ringDark, style]}
    >
      {state.user && state.user.avatarUrl ? (
        <Image source={{ uri: state.user.avatarUrl }} style={[styles.avatar, { width: size - 6, height: size - 6, borderRadius: (size - 6) / 2 }]} />
      ) : (
        <View style={[styles.avatar, { width: size - 6, height: size - 6, borderRadius: (size - 6) / 2 }]}>
          <Text style={[styles.initial, { fontSize: size * 0.44 }]}>{name.charAt(0).toUpperCase()}</Text>
        </View>
      )}
      {unread ? <View style={styles.dot} /> : null}
    </PressScale>
  );
}

const styles = StyleSheet.create({
  ring: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, ...shadow.sm },
  ringDark: { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.2)' },
  avatar: { backgroundColor: colors.cardGold, alignItems: 'center', justifyContent: 'center' },
  initial: { fontFamily: fonts.serifBold, color: colors.goldMuted },
  dot: { position: 'absolute', top: 0, right: 0, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.rose, borderWidth: 2, borderColor: colors.surface },
});
