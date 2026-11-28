// APPEARANCE (dev update v1, item 14): Light / Dark / System default.
// LEAF MODULE: no imports. theme.js (colors) and sanctuary.js (d) import it while they initialise, and
// the boot entry (src/boot/Boot.js) sets the resolved scheme before App is required, so every StyleSheet
// that is created at import time already holds the right palette.
// Brand colours stay: the orange accent #FF6B1A and the warm palette (dark = warm browns, not grey).

export const APPEARANCE_KEY = 'appearance';
export const APPEARANCE_OPTIONS = ['light', 'dark', 'system'];
// The default stays 'light' (today's ivory look) until the dark palette is fully covered; change here to 'system'.
export const APPEARANCE_DEFAULT = 'light';

let resolved = 'light';
export function setResolvedScheme(scheme) { resolved = scheme === 'dark' ? 'dark' : 'light'; }
export function resolvedScheme() { return resolved; }
export function isDarkScheme() { return resolved === 'dark'; }

// Overrides for theme.js `colors` in dark mode. Keys not listed keep the light value.
export const DARK_COLORS = {
  screen: '#14100D', surface: '#1E1813', surfaceWhite: '#1E1813', peachTint: '#3A2216', raised: '#2A211A', surfaceRaised: '#32271E',
  active: '#32271E', sunken: '#1A1510',
  border: '#3A2E24', borderStrong: '#4D3D30', rule: '#2A211A', tabLine: '#3A2E24', glossBorder: '#3A2E24', lineLight: '#2A211A',
  fg: '#F3E9DC', muted: '#B8A797', faint: '#8A7A6C', passage: '#E9DECF', subtle: '#B8A797',
  primarySoft: '#3A2216', primaryInk: '#FF9A53', primaryInvertedBg: '#F3E9DC', primaryInvertedFg: '#14100D',
  gold: '#D4A852', goldMuted: '#B88A3C', goldFaint: 'rgba(212,168,82,0.14)', yellow: '#D4A852',
  indigo: '#E08A52', terracotta: '#D9785A', slate: '#9AA6B5', sage: '#8FB39A', teal: '#6FB3AE',
  lavender: '#A893D6', rose: '#E08A9A', amber: '#E0A548', sky: '#7FB2DB',
  cardGold: '#3A2E14', cardSage: '#26301F', cardRose: '#3A221C', cardLavender: '#2E2534', cardSky: '#1B2A36', cardIndigo: '#3A2216',
  positive: '#6FBE8E', warning: '#E0A548', negative: '#E8716F',
  shadowColor: '#000000',
};

// Overrides for sanctuary.js `d` in dark mode.
export const DARK_D = {
  ivory: '#14100D', paper: '#1E1813', ink: '#F3E9DC', muted: '#B8A797', line: '#3A2E24',
  plumDark: '#FFD2B0', lavender: '#2E2534', sage: '#26301F', sageDark: '#B5CB9D',
  gold: '#3A2E14', goldDark: '#E8C27A', rose: '#3A221C', roseDark: '#F0AE98',
  navOnBg: '#3A2216', navOnText: '#FFD2B0',
};
