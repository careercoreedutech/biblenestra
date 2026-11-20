// BibleNestra logo — a flat open book in our orange/gold with a white cross on the right page and wave bands
// beneath in the onboarding slide colours (yellow, blue, green) — and the logo-only splash shown while the
// app really starts (fonts, saved state, intro flag, Clerk session). No timers here: the splash is visible
// exactly as long as that work takes. The same drawing is rendered to assets/splash-white.png for the
// native splash (keep them in sync).
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

export const SPLASH_BG = '#FFFFFF';

// Shared path data (also used to render the native splash PNG)
export const LOGO_PATHS = {
  leftPage: 'M60 34C47 25 29 22 10 25v50c19-3 37 0 50 9z',
  rightPage: 'M60 34c13-9 31-12 50-9v50c-19-3-37 0-50 9z',
  spine: 'M60 34v50',
  band1: 'M10 84c19-3 37 0 50 9 13-9 31-12 50-9',
  band2: 'M10 94c19-3 37 0 50 9 13-9 31-12 50-9',
  band3: 'M10 104c19-3 37 0 50 9 13-9 31-12 50-9',
};
export const LOGO_COLORS = { left: '#F5A524', right: '#F07A35', spine: '#D9621F', band1: '#F8BE14', band2: '#3FA2E3', band3: '#4CAF82' };

export function BrandLogo({ size = 96 }) {
  const P = LOGO_PATHS;
  const C = LOGO_COLORS;
  return (
    <Svg width={size} height={size} viewBox="0 9 120 120" accessibilityLabel="BibleNestra">
      {/* pages */}
      <Path d={P.leftPage} fill={C.left} />
      <Path d={P.rightPage} fill={C.right} />
      <Path d={P.spine} stroke={C.spine} strokeWidth={2} strokeLinecap="round" />
      {/* white cross on the right page */}
      <Rect x={81} y={36} width={7} height={34} rx={1.5} fill="#FFFFFF" />
      <Rect x={73} y={45} width={23} height={7} rx={1.5} fill="#FFFFFF" />
      {/* wave bands under the pages */}
      <Path d={P.band1} stroke={C.band1} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Path d={P.band2} stroke={C.band2} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Path d={P.band3} stroke={C.band3} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

export function SplashView() {
  return (
    <View style={styles.splash} accessibilityLabel="BibleNestra is starting">
      <BrandLogo size={168} />
    </View>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: SPLASH_BG },
});
