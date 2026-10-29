import { Platform } from 'react-native';

export const fonts = {
  serif: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  serifBold: Platform.select({ ios: 'Georgia-Bold', android: 'serif', default: 'serif' }),
  sans: Platform.select({ ios: 'System', android: undefined, default: undefined }),
  sansMedium: Platform.select({ ios: 'System', android: undefined, default: undefined }),
  display: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
};

export const colors = {
  // Warm Linen & Vintage Editorial Sanctuary Palette (Matching HelloBible+ & The Gazette)
  screen: '#FAF7F2',        // Soothing warm linen / fine book paper
  surface: '#FFFFFF',       // Crisp, elevated card surface
  raised: '#F4EFE6',        // Soft oatmeal / parchment tint for inputs & chips
  surfaceRaised: '#EFE8DC', // Elevated parchment containers
  active: '#ECE4D4',        // Pressed / active tint

  // Hairline borders & rules (1px)
  border: '#E8E1D5',        // Soft warm stone card borders
  borderStrong: '#D6CCBC',  // Active/focused borders
  rule: '#EDE7DC',          // Table and row hairlines
  tabLine: '#E4DDD0',       // Bottom dock border

  // Typographic hierarchy (Editorial Ink)
  fg: '#1C1917',            // Deep editorial ink black
  muted: '#78716C',         // Warm stone grey (accessible 5:1 contrast)
  faint: '#A8A29E',         // Subtle captions, timestamps, metadata
  passage: '#292524',       // Sacred scripture reader ink (warm charcoal)

  // Brand anchors & Action colors
  forest: '#1B4D3E',        // Deep sanctuary forest emerald
  primary: '#1B4D3E',       // Primary action button fill
  primaryBg: '#1B4D3E',     // Primary action background
  primaryFg: '#FFFFFF',     // Crisp white button label
  primaryInvertedBg: '#1C1917',
  primaryInvertedFg: '#FAF7F2',

  // Biblical Gold & Secondary Accents
  gold: '#B8860B',          // Sacred muted biblical gold
  goldLight: '#C59B27',     // Bright gold highlight
  goldMuted: '#8A6D24',     // Subdued gold for verse markers
  goldFaint: 'rgba(184, 134, 11, 0.12)',

  // Vintage Editorial & Category Tints (From PDF Page 1 & 5)
  terracotta: '#B85D36',    // Warm vintage rust / terracotta
  terracottaFaint: 'rgba(184, 93, 54, 0.12)',
  slate: '#546E7A',         // Slate blue for study references
  sage: '#3D7055',          // Sage green for growth & devotionals
  sageFaint: 'rgba(61, 112, 85, 0.12)',
  teal: '#236E60',          // Exegesis & theology
  lavender: '#6B5B95',      // Wisdom & church history
  lavenderFaint: 'rgba(107, 91, 149, 0.12)',
  rose: '#9C3D62',          // Prayer & devotion
  roseFaint: 'rgba(156, 61, 98, 0.12)',
  amber: '#C07818',         // Audio & sermons

  // Soft Pastel Card Tints for "Be Inspired" (PDF Page 1)
  cardGold: '#FDF8EE',
  cardSage: '#EEF6F2',
  cardRose: '#FBF2F4',
  cardLavender: '#F4F2F9',
  cardSky: '#EFF6FA',

  // Status & Notifications
  positive: '#2E7D52',      // Verified, answered, online
  positiveFaint: 'rgba(46, 125, 82, 0.12)',
  warning: '#C67D12',       // Alerts & warnings
  warningFaint: 'rgba(198, 125, 18, 0.12)',
  negative: '#C24138',      // Destructive & reports
  negativeFaint: 'rgba(194, 65, 56, 0.12)',

  // Shadows
  shadowColor: '#1C1917',

  // Compatibility aliases
  accent: '#1B4D3E',
  lineLight: '#EDE7DC',
  yellow: '#B8860B',
  glossBorder: '#E8E1D5',
  subtle: '#78716C',
};
