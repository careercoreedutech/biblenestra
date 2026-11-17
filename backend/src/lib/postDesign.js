// Image-style text posts ("designed" text cards). A post's design is stored in posts.theme as
// "<background>.<font>.<align>" (e.g. "dawn.italic.center"). Older app builds sent a plain
// "#RRGGBB" colour, which is still accepted and returned unchanged.
// Keep these lists in sync with src/components/social/TextPostCard.js (DESIGNS / FONTS / ALIGNS).
import { bad } from './http.js';

export const DESIGN_KEYS = [
  'midnight', 'royal', 'teal', 'lavender', 'charcoal', 'wine',
  'dawn', 'sea', 'olive', 'rose', 'sunset', 'glory', 'meadow', 'dusk',
  'starlight', 'parchment', 'scroll', 'linen', 'rays', 'waves', 'cross', 'psalm',
];
export const DESIGN_FONTS = ['classic', 'italic', 'bold', 'garamond', 'modern'];
export const DESIGN_ALIGNS = ['center', 'left'];
export const CARD_MAX_CHARS = 280; // longer text is posted as a normal text post

const HEX = /^#[0-9a-fA-F]{6}$/;

/** "dawn.italic.center" | "#15172B" → { key, font, align } | { color } | null (never throws) */
export function parseDesign(theme) {
  if (!theme || typeof theme !== 'string') return null;
  if (HEX.test(theme)) return { color: theme };
  const [key, font, align] = theme.split('.');
  if (!DESIGN_KEYS.includes(key)) return null;
  return {
    key,
    font: DESIGN_FONTS.includes(font) ? font : 'italic',
    align: DESIGN_ALIGNS.includes(align) ? align : 'center',
  };
}

/**
 * Validate a POST /posts body's design. Accepts `design: { key, font?, align? }` or the legacy
 * `theme` string. Returns the value to store in posts.theme, or null for a plain post.
 * Text longer than a card holds is stored as a plain text post (design dropped).
 */
export function designFromBody(b, text) {
  let theme = null;
  if (b.design && typeof b.design === 'object') {
    const { key, font = 'italic', align = 'center' } = b.design;
    if (!DESIGN_KEYS.includes(key)) throw bad('Unknown design', 'BAD_DESIGN');
    if (!DESIGN_FONTS.includes(font)) throw bad('Unknown design font', 'BAD_DESIGN');
    if (!DESIGN_ALIGNS.includes(align)) throw bad('Unknown design alignment', 'BAD_DESIGN');
    theme = `${key}.${font}.${align}`;
  } else if (b.theme !== undefined && b.theme !== null && b.theme !== '') {
    if (typeof b.theme !== 'string') throw bad('theme must be text', 'BAD_DESIGN');
    const t = b.theme.trim();
    const d = parseDesign(t);
    if (!d) throw bad('Unknown design', 'BAD_DESIGN');
    // normalise "dawn" → "dawn.italic.center"; legacy colours stay as sent
    theme = d.color ? d.color : `${d.key}.${d.font}.${d.align}`;
  }
  if (theme && (!text || text.length > CARD_MAX_CHARS)) return null;
  return theme;
}
