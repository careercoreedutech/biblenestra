import { Platform } from 'react-native';

export const fonts = {
  serif: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  serifBold: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  sans: Platform.select({ ios: 'System', android: undefined, default: undefined }),
  sansMedium: Platform.select({ ios: 'System', android: undefined, default: undefined }),
  display: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
};

export const colors = {
  // Ground & Elevation — True warm near-black (Taste-Skill Anti-Slop)
  screen: '#0a0908',       // Deep obsidian ground
  surface: '#131210',      // Primary card & sheet surface (one tone step)
  raised: '#1a1816',       // Nested panels, chips, search inputs
  active: '#24211e',       // Pressed / active background
  
  // Clean hairline rules & structural borders (1px)
  border: '#211e1b',       // Card & panel borders
  borderStrong: '#332e29', // Focused input borders & active controls
  rule: '#191715',         // Table & row separators
  tabLine: '#1e1b18',      // Dock top hairline rule

  // Typographic hierarchy (High legibility, serene contrast)
  fg: '#f6f3ee',           // Pure ivory white
  muted: '#9a9187',        // Neutral warm grey (passes 4.5:1)
  faint: '#6e665d',        // Timestamps, captions, metadata
  passage: '#ece5db',      // Refined scripture reader ink
  
  // Inverted primary control tokens (Taste Skill house rule)
  primaryBg: '#f6f3ee',    // Inverted button background
  primaryFg: '#0a0908',    // Inverted button label

  // Data & Sacred Accents (Under 3% pixel budget, reserved for meaningful data)
  gold: '#dfa84a',         // Scripture Gold leaf & active scripture marks
  goldMuted: '#947236',    // Quiet gold for verse numbers
  goldFaint: 'rgba(223, 168, 74, 0.12)', // Subtle tint for scripture badges
  
  positive: '#48b87e',     // Answered prayers, online indicators
  positiveFaint: 'rgba(72, 184, 126, 0.12)',
  
  warning: '#df9438',      // Notices & alerts
  warningFaint: 'rgba(223, 148, 56, 0.12)',

  negative: '#d9534f',     // Deletion & destructive actions
  negativeFaint: 'rgba(217, 83, 79, 0.12)',

  teal: '#46b2a0',         // Topic badges
  lavender: '#a89bc9',     // Historical context badges
  amber: '#df9438',
};
