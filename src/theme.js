import { Platform } from 'react-native';

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
};

const systemSerif = Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia, serif' });

export const fonts = {
  serif: 'Newsreader',
  serifItalic: 'Newsreader-Italic',
  serifMedium: 'Newsreader-Medium',
  serifBold: 'Newsreader-SemiBold',
  serifBoldItalic: 'Newsreader-SemiBoldItalic',
  display: 'Newsreader-SemiBold',
  sans: Platform.select({ ios: 'System', android: undefined, default: undefined }),
  sansMedium: Platform.select({ ios: 'System', android: undefined, default: undefined }),
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
  screen: '#F6F2EA',        // warm parchment canvas
  surface: '#FFFFFF',       // cards
  raised: '#F0EBE1',        // inputs, chips, quiet fills
  surfaceRaised: '#E9E2D5', // pressed fills, containers
  active: '#E9E2D5',
  sunken: '#EDE7DC',

  // Lines
  border: '#E7DFD1',
  borderStrong: '#D6CBB8',
  rule: '#EFE9DE',
  tabLine: '#E7DFD1',

  // Ink
  fg: '#1C1915',            // headings & primary text
  muted: '#6B6255',         // secondary text
  faint: '#A1978A',         // captions, timestamps
  passage: '#2A251E',       // scripture body

  // Brand — royal indigo + burnished gold
  primary: '#2E3A87',
  primaryBg: '#2E3A87',
  primaryFg: '#FFFFFF',
  primarySoft: '#E7E9F5',
  primaryInk: '#232C6B',
  primaryInvertedBg: '#1C1915',
  primaryInvertedFg: '#F6F2EA',
  forest: '#2E3A87',        // legacy alias → primary action colour

  // Night (heroes, player bars, immersive surfaces)
  night: '#15172B',
  nightRaised: '#20233D',
  nightBorder: 'rgba(255,255,255,0.10)',
  nightFg: '#F4EFE6',
  nightMuted: 'rgba(244,239,230,0.66)',

  gold: '#A87A27',
  goldLight: '#D4A852',
  goldMuted: '#8C6620',
  goldFaint: 'rgba(168,122,39,0.12)',

  // Supporting palette (muted, harmonised with parchment)
  indigo: '#3F4BA8',
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
  cardGold: '#F5EBD7',
  cardSage: '#E4ECE2',
  cardRose: '#F5E3E2',
  cardLavender: '#ECE6F3',
  cardSky: '#E2EBF3',
  cardIndigo: '#E7E9F5',

  // Status
  positive: '#3E7B57',
  positiveFaint: 'rgba(62,123,87,0.13)',
  warning: '#B7791F',
  warningFaint: 'rgba(183,121,31,0.13)',
  negative: '#B83A3A',
  negativeFaint: 'rgba(184,58,58,0.11)',

  shadowColor: '#3B2F1E',

  // Compatibility aliases used across screens
  accent: '#2E3A87',
  lineLight: '#EFE9DE',
  yellow: '#A87A27',
  glossBorder: '#E7DFD1',
  subtle: '#6B6255',
};

export const radius = { xs: 6, sm: 10, md: 14, lg: 18, xl: 24, pill: 999 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 };

// Soft, warm elevation (ignored props are harmless on each platform)
export const shadow = {
  sm: Platform.select({
    web: { boxShadow: '0 1px 2px rgba(59,47,30,0.06), 0 1px 1px rgba(59,47,30,0.04)' },
    default: { shadowColor: '#3B2F1E', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 1 },
  }),
  md: Platform.select({
    web: { boxShadow: '0 6px 18px rgba(59,47,30,0.08), 0 1px 3px rgba(59,47,30,0.05)' },
    default: { shadowColor: '#3B2F1E', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 3 },
  }),
  lg: Platform.select({
    web: { boxShadow: '0 14px 34px rgba(21,23,43,0.18)' },
    default: { shadowColor: '#15172B', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.18, shadowRadius: 22, elevation: 8 },
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
    bg: '#F6F2EA', surface: '#FFFFFF', chip: '#FFFFFF', border: '#E7DFD1', borderStrong: '#D6CBB8',
    fg: '#1C1915', passage: '#2A251E', muted: '#6B6255', faint: '#A1978A',
    accent: '#2E3A87', accentSoft: '#E7E9F5', gold: '#A87A27', sel: '#F5EBD7', raised: '#F0EBE1',
  },
  sepia: {
    key: 'sepia', label: 'Sepia', dark: false,
    bg: '#EEE2C9', surface: '#F8EFDC', chip: '#F8EFDC', border: '#DCCAA6', borderStrong: '#CDB78E',
    fg: '#3A2D1C', passage: '#3A2D1C', muted: '#7A6650', faint: '#A38F72',
    accent: '#7B4A1C', accentSoft: '#E6D3AE', gold: '#94661C', sel: '#E4CFA2', raised: '#E6D7B8',
  },
  night: {
    key: 'night', label: 'Night', dark: true,
    bg: '#101221', surface: '#1A1D33', chip: '#1A1D33', border: '#272B45', borderStrong: '#343957',
    fg: '#EDE7DB', passage: '#D9D2C4', muted: '#9C98AA', faint: '#6C697D',
    accent: '#AEB8FF', accentSoft: '#262B4F', gold: '#D4A852', sel: 'rgba(212,168,82,0.17)', raised: '#22263F',
  },
};

export const lineSpacings = { Compact: 1.45, Comfortable: 1.62, Relaxed: 1.85 };
