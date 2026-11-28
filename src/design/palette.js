// APPEARANCE (dev update v1, item 14): White / Black / Automatic (follows the phone).
// LEAF MODULE: no imports. theme.js (colors) and sanctuary.js (d) import it while they initialise, and
// the boot entry (src/boot/Boot.js) sets the resolved scheme before App is required, so every StyleSheet
// that is created at import time already holds the right palette.
// CLIENT DECISION: White = pure white pages, Black = true black pages, Automatic follows the phone and is the default.
// The orange accent #FF6B1A stays in both. The original ivory values stay in theme.js / sanctuary.js for reference
// and are overridden here at boot (LIGHT_* first, then DARK_* in dark mode).

export const APPEARANCE_KEY = 'appearance';
export const APPEARANCE_OPTIONS = ['light', 'dark', 'system'];
// Automatic: new installs follow the phone. Users who picked nothing keep this default too.
export const APPEARANCE_DEFAULT = 'system';

let resolved = 'light';
export function setResolvedScheme(scheme) { resolved = scheme === 'dark' ? 'dark' : 'light'; }
export function resolvedScheme() { return resolved; }
export function isDarkScheme() { return resolved === 'dark'; }

// Page colours for the two modes (the same keys on both sides).
export const PAGE_LIGHT = '#FFFFFF';
export const PAGE_DARK = '#000000';

// White mode: overrides for theme.js `colors`.
export const LIGHT_COLORS = {
  screen: '#FFFFFF', surface: '#FFFFFF', surfaceWhite: '#FFFFFF', peachTint: '#FFEDE3', raised: '#F4F4F4',
  surfaceRaised: '#F4F4F4', active: '#F4F4F4', sunken: '#F7F7F7',
  border: '#ECECEC', borderStrong: '#D6D6D6', rule: '#E8E8E8', tabLine: '#E8E8E8', glossBorder: '#ECECEC', lineLight: '#E8E8E8',
  fg: '#111111', muted: '#6B6B6B', faint: '#9E9E9E', passage: '#111111', subtle: '#6B6B6B',
  primarySoft: '#FFEDE3', primaryInvertedBg: '#111111', primaryInvertedFg: '#FFFFFF',
  cardGold: '#FBF3DC', cardSage: '#EEF4EA', cardRose: '#FBEDEA', cardLavender: '#F3EEF9', cardSky: '#EEF2F6', cardIndigo: '#FFEDE3',
  shadowColor: '#000000',
};

// Black mode: overrides for theme.js `colors` (applied after LIGHT_COLORS).
export const DARK_COLORS = {
  screen: '#000000', surface: '#111111', surfaceWhite: '#111111', peachTint: '#2A1A10', raised: '#1A1A1A',
  surfaceRaised: '#1A1A1A', active: '#1A1A1A', sunken: '#0A0A0A',
  border: '#262626', borderStrong: '#3A3A3A', rule: '#262626', tabLine: '#262626', glossBorder: '#262626', lineLight: '#262626',
  fg: '#FFFFFF', muted: '#A3A3A3', faint: '#737373', passage: '#FFFFFF', subtle: '#A3A3A3',
  primarySoft: '#2A1A10', primaryInk: '#FF9A53', primaryInvertedBg: '#FFFFFF', primaryInvertedFg: '#000000',
  gold: '#D4A852', goldMuted: '#B88A3C', goldFaint: 'rgba(212,168,82,0.14)', yellow: '#D4A852',
  indigo: '#E08A52', terracotta: '#D9785A', slate: '#9AA6B5', sage: '#8FB39A', teal: '#6FB3AE',
  lavender: '#A893D6', rose: '#E08A9A', amber: '#E0A548', sky: '#7FB2DB',
  cardGold: '#241F12', cardSage: '#18201A', cardRose: '#24171A', cardLavender: '#1E1A24', cardSky: '#161C22', cardIndigo: '#2A1A10',
  positive: '#6FBE8E', warning: '#E0A548', negative: '#E8716F',
  shadowColor: '#000000',
};

// White mode: overrides for sanctuary.js `d`.
export const LIGHT_D = {
  ivory: '#FFFFFF', paper: '#FFFFFF', ink: '#111111', muted: '#6B6B6B', line: '#ECECEC',
  glass: 'rgba(255,255,255,0.78)',
  lavender: '#F3EEF9', sage: '#EEF4EA', gold: '#FBF3DC', rose: '#FBEDEA',
  navBg: 'rgba(17,17,17,0.96)', navOff: '#9E9E9E', navOnBg: '#FFEDE3', navOnText: '#472612',
};

// Black mode: overrides for sanctuary.js `d` (applied after LIGHT_D). The dock stays dark in both modes.
export const DARK_D = {
  ivory: '#000000', paper: '#111111', ink: '#FFFFFF', muted: '#A3A3A3', line: '#262626',
  glass: 'rgba(17,17,17,0.78)',
  plumDark: '#FFD2B0', lavender: '#1E1A24', sage: '#18201A', sageDark: '#B5CB9D',
  gold: '#241F12', goldDark: '#E8C27A', rose: '#24171A', roseDark: '#F0AE98',
  navBg: 'rgba(17,17,17,0.96)', navOff: '#8C8C8C', navOnBg: '#2A1A10', navOnText: '#FFD2B0',
};
