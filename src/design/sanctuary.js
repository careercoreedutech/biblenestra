// FIGMA DESIGN KIT ("Project Document Analysis" Figma Make file, Nov 2026).
// Same tokens, fonts and building blocks as the design's index.css, written for React Native.
// Screens built in this style import from here, so the look stays identical everywhere.
import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon } from '../components/Icons';
import { useStore } from '../store';
import { useNav } from '../navigation';

// :root tokens
export const d = {
  ivory: '#F8F1E7', // page
  paper: '#FFFAF2', // cards
  ink: '#281A11',
  muted: '#7C6C60',
  line: '#EADFCE',
  plum: '#FF6B1A', // the orange accent (named "plum" in the design)
  plumDark: '#5A2E18',
  lavender: '#F6E4D2',
  sage: '#E7EAD7',
  sageDark: '#4B5B35',
  gold: '#F4D88C',
  goldDark: '#6F4A12',
  rose: '#F4D8CB',
  roseDark: '#8A4027',
  navBg: 'rgba(46,29,18,0.96)',
  navOff: '#BFAE9F',
  navOnBg: '#FFF2E5',
  navOnText: '#472612',
};

export const df = {
  display: 'Playfair-SemiBold',
  displayBold: 'Playfair-Bold',
  displayItalic: 'Playfair-SemiBoldItalic',
  sans: 'DMSans',
  sansMedium: 'DMSans-Medium',
  sansSemi: 'DMSans-SemiBold',
  sansBold: 'DMSans-Bold',
  sansHeavy: 'DMSans-ExtraBold',
};

export const images = {
  chapel: require('../../assets/design/chapel-dawn.jpg'),
  fellowship: require('../../assets/design/fellowship-prayer.jpg'),
  scriptureStudy: require('../../assets/design/scripture-study.jpg'),
  companion: require('../../assets/design/companion-reflection.jpg'),
};

// Full-bleed photo style. On the web a local image otherwise keeps its pixel size inside absoluteFill.
export const fillImage = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' };

// Gradients used by the design (linear-gradient(145deg, …))
export const gradients = {
  hero: ['#422819', '#8A451F', '#E36A1F'], // verse-hero
  orange: ['#FF9A53', '#ED5C12'],
  gold: ['#E4D18E', '#A66D22'],
  ink: ['#5B3924', '#291B12'],
  step: ['#FF8B3D', '#EF5B10'],
  profile: ['#3B2417', '#8D471F'],
};
const G145 = { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } };

export function Grad({ colors, style, children, locations }) {
  return <LinearGradient colors={colors} locations={locations} {...G145} style={style}>{children}</LinearGradient>;
}

/** Press feedback used everywhere in the design: scale(.98). */
export function Tap({ style, children, onPress, ...rest }) {
  return (
    <Pressable onPress={onPress} {...rest} style={({ pressed }) => [typeof style === 'function' ? style({ pressed }) : style, pressed && { transform: [{ scale: 0.98 }], opacity: 0.95 }]}>
      {children}
    </Pressable>
  );
}

export function Eyebrow({ children, light, style }) {
  return <Text style={[k.eyebrow, light && { color: 'rgba(255,255,255,0.72)' }, style]}>{children}</Text>;
}

/** The orange-dotted square avatar at the top right (.profile-shortcut). */
export function ProfileShortcut() {
  const { state } = useStore();
  const nav = useNav();
  const name = String((state.user && state.user.displayName) || 'You').trim();
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || 'Y';
  return (
    <Tap onPress={() => nav.push('Profile')} accessibilityLabel="Open your profile" hitSlop={8}>
      <Grad colors={gradients.profile} style={k.profile}>
        {state.user && state.user.avatarUrl ? <Image source={{ uri: state.user.avatarUrl }} style={{ width: 42, height: 42, borderRadius: 14 }} /> : <Text style={k.profileText}>{initials}</Text>}
      </Grad>
      <View style={k.profileDot} />
    </Tap>
  );
}

export function IconButton({ icon, onPress, label, dot }) {
  return (
    <Tap onPress={onPress} accessibilityLabel={label} style={k.iconButton} hitSlop={6}>
      <Icon name={icon} size={19} color={d.ink} />
      {dot ? <View style={k.iconDot} /> : null}
    </Tap>
  );
}

/** .page-header: small uppercase subtitle over a Playfair title, with the profile shortcut (or an action) on the right. */
export function PageHeader({ title, subtitle, back, onBack, action }) {
  return (
    <View style={k.header}>
      <View style={k.headerTitle}>
        {back ? <IconButton icon="chevron-left" onPress={onBack} label="Back" /> : null}
        <View style={{ flexShrink: 1 }}>
          {subtitle ? <Text style={k.headerSub} numberOfLines={1}>{subtitle}</Text> : null}
          <Text style={k.headerH1} numberOfLines={1}>{title}</Text>
        </View>
      </View>
      {action === undefined ? <ProfileShortcut /> : action}
    </View>
  );
}

/** .section-title */
export function SectionTitle({ eyebrow, title, link, onLink }) {
  return (
    <View style={k.section}>
      <View style={{ flexShrink: 1 }}>
        {eyebrow ? <Text style={k.sectionEyebrow}>{eyebrow}</Text> : null}
        <Text style={k.sectionH2}>{title}</Text>
      </View>
      {link ? (
        <Tap onPress={onLink} style={k.sectionLink} hitSlop={8}>
          <Text style={k.sectionLinkText}>{link}</Text>
          <Icon name="chevron-right" size={15} color={d.plum} />
        </Tap>
      ) : null}
    </View>
  );
}

export const k = StyleSheet.create({
  screen: { flex: 1, backgroundColor: d.ivory },
  scroll: { paddingHorizontal: 18, paddingBottom: 40 },
  eyebrow: { color: d.plum, fontSize: 10, lineHeight: 12, letterSpacing: 1.7, fontFamily: df.sansBold, textTransform: 'uppercase' },
  header: { height: 84, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 11, flexShrink: 1, minWidth: 0 },
  headerSub: { color: d.muted, textTransform: 'uppercase', letterSpacing: 1.3, fontSize: 9, fontFamily: df.sansBold, marginBottom: 2 },
  headerH1: { fontFamily: df.displayBold, fontSize: 22, lineHeight: 26, letterSpacing: -0.4, color: d.ink },
  profile: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  profileText: { color: '#fff', fontSize: 9, fontFamily: df.sansHeavy },
  profileDot: { position: 'absolute', width: 11, height: 11, right: -2, top: -2, backgroundColor: d.plum, borderWidth: 2, borderColor: d.ivory, borderRadius: 6 },
  iconButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: d.line, backgroundColor: 'rgba(255,255,255,0.78)', borderRadius: 21 },
  iconDot: { position: 'absolute', width: 9, height: 9, right: 7, top: 7, borderRadius: 5, borderWidth: 2, borderColor: d.ivory, backgroundColor: '#D3566F' },
  section: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 28, marginBottom: 13, marginHorizontal: 1 },
  sectionEyebrow: { color: d.plum, fontSize: 9, fontFamily: df.sansHeavy, letterSpacing: 1.3, textTransform: 'uppercase', marginBottom: 4 },
  sectionH2: { fontFamily: df.displayBold, fontSize: 20, lineHeight: 25, color: d.ink },
  sectionLink: { flexDirection: 'row', alignItems: 'center' },
  sectionLinkText: { color: d.plum, fontSize: 11, fontFamily: df.sansBold },
  card: { backgroundColor: d.paper, borderWidth: 1, borderColor: d.line },
});
