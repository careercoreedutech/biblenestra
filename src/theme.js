import { Platform } from 'react-native';

export const fonts = {
  serif: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  serifBold: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  sans: Platform.select({ ios: 'System', android: undefined, default: undefined }),
  sansMedium: Platform.select({ ios: 'System', android: undefined, default: undefined }),
  display: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
};

export const colors = {
  // Distinctive Brand Colors (Forest Emerald & Warm Ivory - Copyright Safe)
  screen: '#0c1411',        // Deep verdant sanctuary charcoal
  surface: '#14201b',       // Rich forest slate surface
  raised: '#1b2b25',        // Elevated containers, inputs, chips
  active: '#243931',        // Pressed / active highlights
  
  // Hairline borders & rules (1px)
  border: '#22362e',        // Structural card borders
  borderStrong: '#345246',  // Active/focused borders
  rule: '#182621',          // Table and row hairlines
  tabLine: '#1b2b25',       // Bottom dock border

  // Typographic hierarchy (Serene high-legibility ivory)
  fg: '#f4efe3',            // Pure warm ivory
  muted: '#94a69e',         // Refined sage grey (passes 4.5:1)
  faint: '#64756e',         // Timestamps, captions, metadata
  passage: '#ece6d8',       // Sacred scripture reader ink

  // Brand anchors & Action colors
  forest: '#173d32',        // Deep forest brand anchor
  primaryBg: '#1d4f40',     // Forest green primary action fill
  primaryFg: '#f4efe3',     // Ivory button label
  primaryInvertedBg: '#f4efe3',
  primaryInvertedFg: '#0c1411',

  // Biblical Gold & Secondary Accents
  gold: '#c9a45c',          // Muted biblical gold leaf
  goldMuted: '#8a703d',     // Subdued gold for verse markers
  goldFaint: 'rgba(201, 164, 92, 0.15)',

  // Secondary elements & status
  slate: '#7a8eaa',         // Slate blue for secondary indicators
  sage: '#a3c4b5',          // Sage green for tags
  teal: '#46a38e',          // Topics & exegesis
  lavender: '#9e9bbd',      // Historical context
  
  positive: '#3da374',      // Verified, answered, online
  positiveFaint: 'rgba(61, 163, 116, 0.15)',
  
  warning: '#d99738',       // Alerts & warnings
  warningFaint: 'rgba(217, 151, 56, 0.15)',

  negative: '#d9534f',      // Destructive & reports
  negativeFaint: 'rgba(217, 83, 79, 0.15)',
};
