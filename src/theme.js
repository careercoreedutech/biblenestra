import { Platform } from 'react-native';
import { LIGHT_COLORS, DARK_COLORS, isDarkScheme } from './design/palette'; // APPEARANCE (item 14): palette chosen at boot

/*
 * BibleNestra design system — "Sanctuary Paper"
 * Warm parchment canvas, deep ink type, royal indigo for action, burnished gold
 * for scripture accents. Serif (Newsreader) for scripture & headings, the
 * platform sans (SF Pro / Roboto) for interface text.
 *
 * Every screen reads from these tokens, so changing a value here re-skins the app.
 */

// Font files are loaded in App.js (see FONT_ASSETS). If they fail to load the
// platform serif is used instead, so the app never blocks on fonts.
export const FONT_ASSETS = {
  Newsreader: require('@expo-google-fonts/newsreader/400Regular/Newsreader_400Regular.ttf'),
  'Newsreader-Italic': require('@expo-google-fonts/newsreader/400Regular_Italic/Newsreader_400Regular_Italic.ttf'),
  'Newsreader-Medium': require('@expo-google-fonts/newsreader/500Medium/Newsreader_500Medium.ttf'),
  'Newsreader-SemiBold': require('@expo-google-fonts/newsreader/600SemiBold/Newsreader_600SemiBold.ttf'),
  'Newsreader-SemiBoldItalic': require('@expo-google-fonts/newsreader/600SemiBold_Italic/Newsreader_600SemiBold_Italic.ttf'),
  // Extra reading fonts for the Bible reader's font menu
  Lora: require('@expo-google-fonts/lora/400Regular/Lora_400Regular.ttf'),
  Merriweather: require('@expo-google-fonts/merriweather/400Regular/Merriweather_400Regular.ttf'),
  EBGaramond: require('@expo-google-fonts/eb-garamond/400Regular/EBGaramond_400Regular.ttf'),
  Inter: require('@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf'),
  AtkinsonHyperlegible: require('@expo-google-fonts/atkinson-hyperlegible/400Regular/AtkinsonHyperlegible_400Regular.ttf'),
  // FIGMA DESIGN (design-figma): Playfair Display for headings, DM Sans for interface text
  Playfair: require('@expo-google-fonts/playfair-display/400Regular/PlayfairDisplay_400Regular.ttf'),
  'Playfair-Italic': require('@expo-google-fonts/playfair-display/400Regular_Italic/PlayfairDisplay_400Regular_Italic.ttf'),
  'Playfair-SemiBold': require('@expo-google-fonts/playfair-display/600SemiBold/PlayfairDisplay_600SemiBold.ttf'),
  'Playfair-Bold': require('@expo-google-fonts/playfair-display/700Bold/PlayfairDisplay_700Bold.ttf'),
  'Playfair-SemiBoldItalic': require('@expo-google-fonts/playfair-display/600SemiBold_Italic/PlayfairDisplay_600SemiBold_Italic.ttf'),
  DMSans: require('@expo-google-fonts/dm-sans/400Regular/DMSans_400Regular.ttf'),
  'DMSans-Medium': require('@expo-google-fonts/dm-sans/500Medium/DMSans_500Medium.ttf'),
  'DMSans-SemiBold': require('@expo-google-fonts/dm-sans/600SemiBold/DMSans_600SemiBold.ttf'),
  'DMSans-Bold': require('@expo-google-fonts/dm-sans/700Bold/DMSans_700Bold.ttf'),
  'DMSans-ExtraBold': require('@expo-google-fonts/dm-sans/800ExtraBold/DMSans_800ExtraBold.ttf'),
};

const systemSerif = Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia, serif' });

export const fonts = {
  // FIGMA DESIGN: headings in Playfair Display, interface text in DM Sans (scripture keeps the reader font)
  serif: 'Playfair',
  serifItalic: 'Playfair-Italic',
  serifMedium: 'Playfair-SemiBold',
  serifBold: 'Playfair-Bold',
  serifBoldItalic: 'Playfair-SemiBoldItalic',
  display: 'Playfair-Bold',
  sans: 'DMSans',
  sansMedium: 'DMSans-Medium',
  fallbackSerif: systemSerif,
};

// Bible reader font menu. 'family' undefined = the phone's own sans font.
export const READER_FONTS = [
  { key: 'Newsreader', label: 'Newsreader', note: 'Default', family: 'Newsreader' },
  { key: 'Lora', label: 'Lora', note: 'Warm serif', family: 'Lora' },
  { key: 'Merriweather', label: 'Merriweather', note: 'Sturdy serif', family: 'Merriweather' },
  { key: 'EBGaramond', label: 'Garamond', note: 'Classic book', family: 'EBGaramond' },
  { key: 'SystemSerif', label: 'Georgia', note: 'Phone serif', family: systemSerif },
  { key: 'Inter', label: 'Inter', note: 'Clean sans', family: 'Inter' },
  { key: 'AtkinsonHyperlegible', label: 'Atkinson', note: 'Easy to read', family: 'AtkinsonHyperlegible' },
  { key: 'System', label: 'System', note: 'Phone default', family: undefined },
];
export function readerFontFamily(key) {
  const f = READER_FONTS.find((x) => x.key === key) || READER_FONTS[0];
  return f.family;
}

export const colors = {
  // Surfaces
  screen: '#F8F1E7',        // warm parchment canvas
  surface: '#FFFAF2',       // cards
  raised: '#F3E9DC',        // inputs, chips, quiet fills
  surfaceRaised: '#EFE3D3', // pressed fills, containers
  active: '#EFE3D3',
  sunken: '#F1E7DA',

  // Lines
  border: '#EADFCE',
  borderStrong: '#DCCDB8',
  rule: '#F0E6D8',
  tabLine: '#EADFCE',

  // Ink
  fg: '#281A11',            // headings & primary text
  muted: '#7C6C60',         // secondary text
  faint: '#A8998B',         // captions, timestamps
  passage: '#2E2016',       // scripture body

  // Brand — FIGMA DESIGN: ember orange on warm ivory (was royal indigo)
  primary: '#FF6B1A',
  primaryBg: '#FF6B1A',
  primaryFg: '#FFFFFF',
  primarySoft: '#FFE9DA',
  primaryInk: '#C24E0E',
  primaryInvertedBg: '#281A11',
  primaryInvertedFg: '#F8F1E7',
  forest: '#FF6B1A',        // legacy alias → primary action colour

  // Night (heroes, player bars, immersive surfaces)
  night: '#2A1B12',
  nightRaised: '#3B2619',
  nightBorder: 'rgba(255,255,255,0.10)',
  nightFg: '#FFF6EC',
  nightMuted: 'rgba(255,246,236,0.68)',

  gold: '#A87A27',
  goldLight: '#D4A852',
  goldMuted: '#8C6620',
  goldFaint: 'rgba(168,122,39,0.12)',

  // Supporting palette (muted, harmonised with parchment)
  indigo: '#8A451F',
  terracotta: '#B45D3A',
  terracottaFaint: 'rgba(180,93,58,0.12)',
  slate: '#56606E',
  sage: '#4E7A5C',
  sageFaint: 'rgba(78,122,92,0.13)',
  teal: '#2C7672',
  lavender: '#6B52A3',
  lavenderFaint: 'rgba(107,82,163,0.12)',
  rose: '#B0475C',
  roseFaint: 'rgba(176,71,92,0.12)',
  amber: '#B7791F',
  sky: '#356D9C',
  skyFaint: 'rgba(53,109,156,0.12)',

  // Soft card tints
  cardGold: '#F8EBC4',
  cardSage: '#E7EAD7',
  cardRose: '#F4D8CB',
  cardLavender: '#F6E4D2',
  cardSky: '#E2EBF3',
  cardIndigo: '#FFE9DA',

  // Status
  positive: '#3E7B57',
  positiveFaint: 'rgba(62,123,87,0.13)',
  warning: '#B7791F',
  warningFaint: 'rgba(183,121,31,0.13)',
  negative: '#B83A3A',
  negativeFaint: 'rgba(184,58,58,0.11)',

  shadowColor: '#362012',

  // Compatibility aliases used across screens
  accent: '#FF6B1A',
  lineLight: '#F0E6D8',
  yellow: '#A87A27',
  glossBorder: '#EADFCE',
  subtle: '#7C6C60',
  surfaceWhite: '#FFFFFF',  // white card fills (light); warm dark card in dark mode
  peachTint: '#FFF2E5',     // pale peach chips (light); warm dark tint in dark mode
};
// APPEARANCE: White (pure white) replaces the ivory values above; Black (true black) replaces both in dark mode.
// Set once at boot, see src/design/palette.js.
Object.assign(colors, LIGHT_COLORS);
if (isDarkScheme()) Object.assign(colors, DARK_COLORS);

export const radius = { xs: 6, sm: 10, md: 14, lg: 18, xl: 24, pill: 999 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 };

// Soft, warm elevation (ignored props are harmless on each platform)
export const shadow = {
  sm: Platform.select({
    web: { boxShadow: '0 1px 2px rgba(59,47,30,0.06), 0 1px 1px rgba(59,47,30,0.04)' },
    default: { shadowColor: '#362012', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 1 },
  }),
  md: Platform.select({
    web: { boxShadow: '0 6px 18px rgba(59,47,30,0.08), 0 1px 3px rgba(59,47,30,0.05)' },
    default: { shadowColor: '#362012', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 3 },
  }),
  lg: Platform.select({
    web: { boxShadow: '0 14px 34px rgba(54,32,18,0.18)' },
    default: { shadowColor: '#362012', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.18, shadowRadius: 22, elevation: 8 },
  }),
};

export const type = {
  eyebrow: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase' },
  display: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36, letterSpacing: -0.6, color: colors.fg },
  title: { fontFamily: fonts.serifBold, fontSize: 22, lineHeight: 28, letterSpacing: -0.3, color: colors.fg },
  heading: { fontFamily: fonts.serifBold, fontSize: 18, lineHeight: 24, letterSpacing: -0.2, color: colors.fg },
  body: { fontSize: 14, lineHeight: 20, color: colors.fg },
  caption: { fontSize: 12, lineHeight: 16, color: colors.muted },
};

// Reader themes for the Bible reader (stored as state.readerTheme)
export const readerThemes = {
  paper: {
    key: 'paper', label: 'Paper', dark: false,
    bg: '#FFFFFF', surface: '#FFFFFF', chip: '#FFFFFF', border: '#ECECEC', borderStrong: '#D6D6D6',
    fg: '#111111', passage: '#111111', muted: '#6B6B6B', faint: '#9E9E9E',
    accent: '#FF6B1A', accentSoft: '#FFEDE3', gold: '#A87A27', sel: '#FBF3DC', raised: '#F4F4F4',
  },
  sepia: {
    key: 'sepia', label: 'Sepia', dark: false,
    bg: '#EEE2C9', surface: '#F8EFDC', chip: '#F8EFDC', border: '#DCCAA6', borderStrong: '#CDB78E',
    fg: '#3A2D1C', passage: '#3A2D1C', muted: '#7A6650', faint: '#A38F72',
    accent: '#7B4A1C', accentSoft: '#E6D3AE', gold: '#94661C', sel: '#E4CFA2', raised: '#E6D7B8',
  },
  night: {
    key: 'night', label: 'Night', dark: true,
    bg: '#000000', surface: '#111111', chip: '#111111', border: '#262626', borderStrong: '#3A3A3A',
    fg: '#FFFFFF', passage: '#E5E5E5', muted: '#A3A3A3', faint: '#737373',
    accent: '#FF9A53', accentSoft: '#2A1A10', gold: '#D4A852', sel: 'rgba(212,168,82,0.17)', raised: '#1A1A1A',
  },
};

export const lineSpacings = { Compact: 1.45, Comfortable: 1.62, Relaxed: 1.85 };
