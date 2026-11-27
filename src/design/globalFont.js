// FIGMA DESIGN: every <Text> / <TextInput> without its own font uses DM Sans, in the file that matches its
// weight. Android can't pick a bold face from one custom family by fontWeight alone, so we choose the file.
import React from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';

const DM = { 100: 'DMSans', 200: 'DMSans', 300: 'DMSans', 400: 'DMSans', 500: 'DMSans-Medium', 600: 'DMSans-SemiBold', 700: 'DMSans-Bold', 800: 'DMSans-ExtraBold', 900: 'DMSans-ExtraBold' };
const PF = { 400: 'Playfair', 500: 'Playfair-SemiBold', 600: 'Playfair-SemiBold', 700: 'Playfair-Bold', 800: 'Playfair-Bold', 900: 'Playfair-Bold' };

function weightOf(w) {
  if (w == null) return 400;
  if (w === 'bold') return 700;
  if (w === 'normal') return 400;
  const n = parseInt(w, 10);
  return Number.isFinite(n) ? n : 400;
}

function fontStyle(style) {
  const flat = StyleSheet.flatten(style) || {};
  const fam = flat.fontFamily;
  const w = weightOf(flat.fontWeight);
  if (!fam || fam === 'DMSans' || fam === 'System') return { fontFamily: DM[w] || 'DMSans', fontWeight: 'normal' };
  if (fam === 'Playfair' && flat.fontWeight != null) return { fontFamily: PF[w] || 'Playfair', fontWeight: 'normal' };
  return null;
}

// A nested <Text> inherits its parent's font (e.g. a verse span inside the reader's serif paragraph), so only
// the outermost Text gets the DM Sans default; nested ones change font only when they set a weight.
const InText = React.createContext(false);

function patch(Comp, isText) {
  const orig = Comp.render;
  if (!orig || Comp.__dmPatched) return;
  Comp.__dmPatched = true;
  Comp.render = function render(props, ref) {
    const nested = React.useContext(InText);
    const flat = nested ? StyleSheet.flatten(props.style) || {} : null;
    const extra = nested && !flat.fontFamily && flat.fontWeight == null ? null : fontStyle(props.style);
    const el = orig.call(this, extra ? { ...props, style: [props.style, extra] } : props, ref);
    return isText && !nested ? <InText.Provider value>{el}</InText.Provider> : el;
  };
}

export function applyDesignFonts() {
  patch(Text, true);
  patch(TextInput, false);
}
