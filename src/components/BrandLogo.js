// BibleNestra logo — an open book with a cross, in the warm brand colours — and the logo-only splash
// shown while the app really starts (fonts, saved state, intro flag, Clerk session). No timers here:
// the splash is visible exactly as long as that work takes.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

export const SPLASH_BG = '#FFFFFF';

export function BrandLogo({ size = 96 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120" accessibilityLabel="BibleNestra">
      <Defs>
        <LinearGradient id="bnPage" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#F2B23E" />
          <Stop offset="1" stopColor="#E07B2C" />
        </LinearGradient>
        <LinearGradient id="bnCross" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#C2551F" />
          <Stop offset="1" stopColor="#9E3F17" />
        </LinearGradient>
      </Defs>
      {/* cross rising from the spine */}
      <Path d="M56 10h8v18h14v8H64v28h-8V36H42v-8h14z" fill="url(#bnCross)" />
      {/* left page */}
      <Path d="M58 66C47 58 31 55 12 57v41c19-2 35 1 46 9z" fill="url(#bnPage)" />
      {/* right page */}
      <Path d="M62 66c11-8 27-11 46-9v41c-19-2-35 1-46 9z" fill="url(#bnPage)" />
      {/* page lines */}
      <Path d="M22 68c11-.6 21 1.2 29 5M22 78c11-.6 21 1.2 29 5M98 68c-11-.6-21 1.2-29 5M98 78c-11-.6-21 1.2-29 5" stroke="#FFFFFF" strokeOpacity={0.55} strokeWidth={2.4} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

export function SplashView() {
  return (
    <View style={styles.splash} accessibilityLabel="BibleNestra is starting">
      <BrandLogo size={104} />
    </View>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: SPLASH_BG },
});
