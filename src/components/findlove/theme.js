// FIND LOVE sub-brand — "Covenant": deep wine and plum heroes, warm blush, burnished gold, over the app's parchment.
// Sits on top of the Sanctuary Paper tokens (src/theme.js); every Find Love component reads from here.
import { Platform } from 'react-native';
import { colors, fonts } from '../../theme';
import { isDarkScheme } from '../../design/palette';

let Haptics = null;
try { Haptics = require('expo-haptics'); } catch (e) { Haptics = null; }

export const ND = Platform.OS !== 'web'; // native driver where supported

const DARK = isDarkScheme();
// Dark variant: warm espresso and cocoa heroes, lifted just enough off the dark screen to read as surfaces.
export const love = {
  // hero surfaces
  plum: DARK ? '#1A1A1A' : '#2D1B10',
  plumRaised: DARK ? '#1A1A1A' : '#3C2518',
  wine: DARK ? '#7A3D1C' : '#8A451F',
  wineDeep: DARK ? '#111111' : '#3C2518',
  // accents
  rose: '#ED5C12', // orange accent (kit: d.plum)
  roseBright: '#FF9A53',
  roseSoft: DARK ? '#C9885A' : '#F7B98A',
  blush: DARK ? '#2A1A10' : '#FBF3DC',
  blushDeep: DARK ? '#24171A' : '#FBEDEA',
  blushLine: DARK ? '#333333' : '#ECECEC',
  gold: DARK ? '#D4A852' : '#A66D22',
  goldBright: DARK ? '#E8C27A' : '#F4D88C',
  goldPale: DARK ? '#241F12' : '#FBF3DC',
  goldInk: DARK ? '#F0CF8A' : '#6F4A12',
  // ink on dark
  onDark: '#FBF3EC',
  onDarkMuted: 'rgba(251,243,236,0.72)',
  onDarkFaint: 'rgba(251,243,236,0.45)',
  // parchment (app tokens)
  paper: colors.screen,
  card: colors.surface,
  ink: colors.fg,
  muted: colors.muted,
  faint: colors.faint,
  line: colors.border,
  pass: '#8A8178',
  dangerSoft: DARK ? '#3A221C' : '#F8E1DF',
  danger: colors.negative,
  positive: colors.positive,
};

// gradient stops (LinearGradient colors)
export const grad = {
  heart: ['#FF8B3D', '#ED5C12'],
  wine: ['#8A451F', '#2D1B10'],
  plum: ['#3C2518', '#2D1B10'],
  gold: ['#E4D18E', '#A66D22'],
  goldSoft: DARK ? ['#241F12', '#2E2612'] : ['#FBF3DC', '#F4D88C'],
  vip: ['#2B211A', '#0F0B09'],
  rose: ['#FF9A53', '#C4501A'],
  blush: DARK ? ['#111111', '#2A1A10'] : ['#FFFFFF', '#FBEDEA'],
  ring: ['#E4D18E', '#FF9A53', '#8A451F'],
  scrim: ['rgba(40,26,17,0)', 'rgba(40,26,17,0.35)', 'rgba(40,26,17,0.9)'],
  scrimTop: ['rgba(40,26,17,0.45)', 'rgba(40,26,17,0)'],
};

export const type = {
  display: { fontFamily: fonts.serifBold, color: love.ink, letterSpacing: -0.3 },
  italic: { fontFamily: fonts.serifItalic },
  boldItalic: { fontFamily: fonts.serifBoldItalic },
  eyebrow: { fontFamily: 'DMSans-Bold', fontSize: 10, lineHeight: 12, letterSpacing: 1.7, textTransform: 'uppercase', color: DARK ? '#FF9A53' : '#FF6B1A' },
};

export const lshadow = Platform.select({
  web: {
    sm: { boxShadow: '0 2px 6px rgba(60,37,24,0.08)' },
    md: { boxShadow: '0 10px 28px rgba(60,37,24,0.16), 0 2px 6px rgba(60,37,24,0.08)' },
    glow: { boxShadow: '0 8px 22px rgba(237,92,18,0.38)' },
    gold: { boxShadow: '0 8px 20px rgba(166,109,34,0.35)' },
  },
  default: {
    sm: { shadowColor: '#3C2518', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6, elevation: 2 },
    md: { shadowColor: '#3C2518', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.18, shadowRadius: 18, elevation: 8 },
    glow: { shadowColor: '#ED5C12', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.38, shadowRadius: 14, elevation: 8 },
    gold: { shadowColor: '#A66D22', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 6 },
  },
});

/** Gentle haptics (no-op on web or when the module is missing). kind: 'light' | 'medium' | 'heavy' | 'success' | 'select' */
export function haptic(kind = 'light') {
  if (!Haptics || Platform.OS === 'web') return;
  try {
    if (kind === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else if (kind === 'select') Haptics.selectionAsync();
    else Haptics.impactAsync(kind === 'heavy' ? Haptics.ImpactFeedbackStyle.Heavy : kind === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
  } catch (e) { /* ignore */ }
}

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;
export const firstPhoto = (p) => (p && p.photos && p.photos[0] ? p.photos[0].url : null);
