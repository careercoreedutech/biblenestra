import { Platform } from 'react-native';

export const fonts = {
  serif: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  serifBold: Platform.select({ ios: 'Georgia-Bold', android: 'serif', default: 'serif' }),
  sans: Platform.select({ ios: 'System', android: undefined, default: undefined }),
  sansMedium: Platform.select({ ios: 'System', android: undefined, default: undefined }),
  display: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
};

export const colors = {
  // Vibrant, High-Contrast Modern Sanctuary Palette (Clean, Colorful & Premium)
  screen: '#F8FAFC',        // Crisp, bright modern canvas (Slate 50)
  surface: '#FFFFFF',       // Pure white card surfaces with clean contrast
  raised: '#F1F5F9',        // Light slate tint for interactive pills & inputs
  surfaceRaised: '#E2E8F0', // Elevated borders & container fills
  active: '#E2E8F0',        // Pressed / active tint

  // Hairline borders & rules
  border: '#E2E8F0',        // Crisp slate border
  borderStrong: '#CBD5E1',  // Focused borders
  rule: '#F1F5F9',          // Divider rules
  tabLine: '#E2E8F0',       // Bottom dock border

  // Typographic hierarchy (High Contrast Crisp Slate)
  fg: '#0F172A',            // Deep slate black (headings, high-legibility)
  muted: '#475569',         // Crisp slate grey (clear, non-faded text)
  faint: '#94A3B8',         // Subtle timestamps, captions
  passage: '#1E293B',       // Sacred scripture reader ink (rich readable charcoal)

  // Brand anchors & Action colors
  forest: '#059669',        // Vivid sanctuary emerald
  primary: '#059669',       // Primary action button fill
  primaryBg: '#059669',     // Primary action background
  primaryFg: '#FFFFFF',     // Crisp white button label
  primaryInvertedBg: '#0F172A',
  primaryInvertedFg: '#F8FAFC',

  // Vivid Rich Spectrum (Colorful Modern UI)
  indigo: '#4F46E5',        // Electric royal indigo
  gold: '#D97706',          // Radiant warm amber gold
  goldLight: '#F59E0B',     // Bright gold highlight
  goldMuted: '#B45309',     // Subdued gold for verse markers
  goldFaint: 'rgba(217, 119, 6, 0.12)',

  terracotta: '#EA580C',    // Vibrant burnt tangerine
  terracottaFaint: 'rgba(234, 88, 12, 0.12)',
  slate: '#475569',         // Slate blue for study references
  sage: '#10B981',          // Fresh mint / emerald for growth & devotionals
  sageFaint: 'rgba(16, 185, 129, 0.14)',
  teal: '#0D9488',          // Exegesis & theology
  lavender: '#7C3AED',      // Royal violet & church history
  lavenderFaint: 'rgba(124, 58, 237, 0.14)',
  rose: '#E11D48',          // Vibrant rose for prayer & devotion
  roseFaint: 'rgba(225, 29, 72, 0.14)',
  amber: '#D97706',         // Audio & sermons
  sky: '#0284C7',           // Vibrant sky blue
  skyFaint: 'rgba(2, 132, 199, 0.14)',

  // Rich, Saturated Pastel Card Tints for "Be Inspired" & Badges
  cardGold: '#FEF3C7',      // Warm golden glow
  cardSage: '#D1FAE5',      // Fresh energetic emerald
  cardRose: '#FFE4E6',      // Tender rose
  cardLavender: '#EDE9FE',  // Regal violet
  cardSky: '#E0F2FE',       // Pure clear sky

  // Status & Notifications
  positive: '#10B981',      // Verified, answered, online
  positiveFaint: 'rgba(16, 185, 129, 0.14)',
  warning: '#F59E0B',       // Alerts & warnings
  warningFaint: 'rgba(245, 158, 11, 0.14)',
  negative: '#EF4444',      // Destructive & reports
  negativeFaint: 'rgba(239, 68, 68, 0.14)',

  // Shadows
  shadowColor: '#0F172A',

  // Compatibility aliases
  accent: '#059669',
  lineLight: '#F1F5F9',
  yellow: '#D97706',
  glossBorder: '#E2E8F0',
  subtle: '#475569',
};
