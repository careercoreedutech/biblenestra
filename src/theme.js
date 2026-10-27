import { Platform } from 'react-native';

export const fonts = {
  serif: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  serifBold: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  sans: Platform.select({ ios: 'System', android: undefined, default: undefined }),
  sansMedium: Platform.select({ ios: 'System', android: undefined, default: undefined }),
  display: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
};

export const colors = {
  // Ultra-luxurious warm obsidian & velvet dark tones
  screen: '#0e0c0b',
  sheet: '#171311',
  sheetGlass: 'rgba(23, 19, 17, 0.94)',
  cardTop: '#231d19',
  cardBottom: '#181412',
  cardSurface: '#1c1714',
  cardGloss: 'rgba(255, 255, 255, 0.05)',
  input: '#15110f',
  inputBorder: 'rgba(255, 255, 255, 0.1)',
  
  // Sleek glass borders & highlights
  line: 'rgba(255, 255, 255, 0.08)',
  lineLight: 'rgba(255, 255, 255, 0.14)',
  glossBorder: 'rgba(255, 255, 255, 0.16)',
  glossBorderTop: 'rgba(255, 255, 255, 0.22)',
  tabLine: 'rgba(255, 255, 255, 0.06)',

  // Typographic hierarchy
  fg: '#faf6f0',          // Pure crystalline ivory
  muted: '#a39688',       // Refined neutral beige
  subtle: '#6d6257',      // Secondary subtle
  passage: '#e8e0d5',     // Elegant book reader ivory

  // Royal & Divine Accents
  accent: '#e2752b',      // Divine Warm Amber
  accentGlow: 'rgba(226, 117, 43, 0.25)',
  gold: '#e5b869',        // Scripture Gold Leaf
  goldLight: '#f6d892',
  goldGlow: 'rgba(229, 184, 105, 0.25)',
  
  // Celestial secondary highlights
  teal: '#5eead4',        // Celestial Cyan/Teal
  lavender: '#c4b5fd',    // Royal Lavender
  amber: '#f59e0b',       // Warm Sacred Amber
  yellow: '#fde047',      // Golden Sunlight
  rose: '#fda4af',        // Grace Rose
};

// Gradient sets for LinearGradient
export const gradients = {
  card: ['#241e1a', '#171311'],
  cardGloss: ['rgba(255, 255, 255, 0.08)', 'rgba(255, 255, 255, 0.01)'],
  gold: ['#f6d892', '#d49b45'],
  accent: ['#eb823b', '#cc5c18'],
  teal: ['#6ee7b7', '#2dd4bf'],
  lavender: ['#d8b4fe', '#a855f7'],
  dock: ['rgba(22, 18, 16, 0.96)', 'rgba(14, 12, 11, 0.98)'],
  verseHero: ['#28201a', '#171311'],
};
