// FIND LOVE sub-brand — "Covenant": deep wine and plum heroes, warm blush, burnished gold, over the app's parchment.
// Sits on top of the Sanctuary Paper tokens (src/theme.js); every Find Love component reads from here.
import { Platform } from 'react-native';
import { colors, fonts } from '../../theme';

let Haptics = null;
try { Haptics = require('expo-haptics'); } catch (e) { Haptics = null; }

export const ND = Platform.OS !== 'web'; // native driver where supported

export const love = {
  // hero surfaces
  plum: '#2A0E1C',
  plumRaised: '#3B1528',
  wine: '#6B1F37',
  wineDeep: '#4A1326',
  // accents
  rose: '#B0475C',
  roseBright: '#C9566E',
  roseSoft: '#E7A3AE',
  blush: '#F7E6E2',
  blushDeep: '#EFD2CC',
  blushLine: '#E8CFC8',
  gold: '#B4852F',
  goldBright: '#D9B061',
  goldPale: '#F4E4C0',
  goldInk: '#7A5815',
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
  danger: colors.negative,
  positive: colors.positive,
};

// gradient stops (LinearGradient colors)
export const grad = {
  heart: ['#D35C75', '#9C2C48'],
  wine: ['#7A2540', '#3E1022'],
  plum: ['#3E1529', '#1E0A15'],
  gold: ['#E9C67C', '#B4852F'],
  goldSoft: ['#F8EBCB', '#EED7A2'],
  vip: ['#2B211A', '#0F0B09'],
  rose: ['#C9566E', '#8E2A45'],
  blush: ['#FBEFEC', '#F3DCD6'],
  ring: ['#E9C67C', '#C9566E', '#7A2540'],
  scrim: ['rgba(30,10,21,0)', 'rgba(30,10,21,0.35)', 'rgba(30,10,21,0.9)'],
  scrimTop: ['rgba(30,10,21,0.45)', 'rgba(30,10,21,0)'],
};

export const type = {
  display: { fontFamily: fonts.serifBold, color: love.ink, letterSpacing: -0.3 },
  italic: { fontFamily: fonts.serifItalic },
  boldItalic: { fontFamily: fonts.serifBoldItalic },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.6, textTransform: 'uppercase', color: love.rose },
};

export const lshadow = Platform.select({
  web: {
    sm: { boxShadow: '0 2px 6px rgba(74,19,38,0.08)' },
    md: { boxShadow: '0 10px 28px rgba(74,19,38,0.16), 0 2px 6px rgba(74,19,38,0.08)' },
    glow: { boxShadow: '0 8px 22px rgba(176,71,92,0.38)' },
    gold: { boxShadow: '0 8px 20px rgba(180,133,47,0.35)' },
  },
  default: {
    sm: { shadowColor: '#4A1326', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6, elevation: 2 },
    md: { shadowColor: '#4A1326', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.18, shadowRadius: 18, elevation: 8 },
    glow: { shadowColor: '#B0475C', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.38, shadowRadius: 14, elevation: 8 },
    gold: { shadowColor: '#B4852F', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 6 },
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
