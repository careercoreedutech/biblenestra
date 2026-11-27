// EXEGESIS: one tap from the verse toolbar → a full structured exegesis (11 sections, always in this order).
// No questions, no chat. Sections appear as each part arrives; repeat visits load from the server cache.
import React, { useMemo } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Svg, { Path, Rect } from 'react-native-svg';
import { Button, Empty, Notice, NightGlow } from '../components/ui';
import { KitScreen } from '../design/bible/parts';
import { d } from '../design/sanctuary';
import { FadeInUp, Shimmer } from '../components/Motion';
import { Icon } from '../components/Icons';
import { useToast } from '../components/Toast';
import { useNav } from '../navigation';
import { useStore } from '../store';
import { useChapter } from '../bible/loader';
import { resolveTranslationId } from '../bible/catalog';
import { refLabel, parseRef } from '../data/bible';
import { useExegesis, exegesisText } from '../api/exegesis';
import { colors, fonts, radius, shadow } from '../theme';

const AI_NOTE = 'AI-generated — compare with the commentaries';

const SECTIONS = [
  { n: 1, key: 'passage', title: 'Passage', part: null },
  { n: 2, key: 'historical', title: 'Historical background', part: 'a' },
  { n: 3, key: 'cultural', title: 'Cultural background', part: 'a' },
  { n: 4, key: 'literary', title: 'Literary context', part: 'a' },
  { n: 5, key: 'originalLanguage', title: 'Original language', part: 'a' },
  { n: 6, key: 'keyTerms', title: 'Meaning of important words and phrases', part: 'b' },
  { n: 7, key: 'interpretation', title: 'Interpretation of the passage', part: 'b' },
  { n: 8, key: 'theology', title: 'Theological significance', part: 'b' },
  { n: 9, key: 'authorIntent', title: 'The author’s intended meaning', part: 'b' },
  { n: 10, key: 'crossReferences', title: 'Relationship to other scriptures', part: 'c' },
  { n: 11, key: 'application', title: 'Practical application', part: 'c' },
];

export default function ExegesisScreen({ params = {} }) {
  const nav = useNav();
  const toast = useToast();
  const { state, dispatch } = useStore();
  const { bookId, chapter } = params;
  const verseStart = params.verseStart || params.verse || 1;
  const verseEnd = Math.max(verseStart, params.verseEnd || verseStart);
  const wanted = resolveTranslationId(params.translation || state.translation);
  const ch = useChapter(wanted, bookId, chapter);
  // the reader's translation when it's loaded; KJV if it can't be (offline / still streaming and failed)
  const usable = ch.verses ? { verses: ch.verses, tr: wanted } : !ch.loading && ch.fallback ? { verses: ch.fallback, tr: 'KJV' } : null;
  const title = refLabel(bookId, chapter, verseStart) + (verseEnd > verseStart ? `-${verseEnd}` : '');

  const req = useMemo(() => {
    if (!usable || !bookId) return null;
    const vs = usable.verses;
    const pick = (a, b) => vs.slice(a - 1, b).map((t, i) => (b > a ? `${a + i} ${t}` : t)).join(' ').trim();
    const text = verseEnd > verseStart ? pick(verseStart, verseEnd) : (vs[verseStart - 1] || '');
    const cs = Math.max(1, verseStart - 6);
    const ce = Math.min(vs.length, verseEnd + 6);
    const context = vs.slice(cs - 1, ce).map((t, i) => `${cs + i} ${t}`).join(' ');
    if (!text) return null;
    return { bookId, chapter, verseStart, verseEnd, translation: usable.tr, text: text.slice(0, 8000), context: context.slice(0, 12000), contextStart: cs, contextEnd: ce };
  }, [usable && usable.tr, usable && usable.verses, bookId, chapter, verseStart, verseEnd]);

  const ex = useExegesis(req);
  const s = ex.sections || {};
  const passage = ex.passage || (req ? { label: `${title} (${req.translation})`, text: req.text } : null);
  const allDone = ex.done.a && ex.done.b && ex.done.c;
  const errs = Object.values(ex.errors || {});
  const notConfigured = errs.find((e) => e.code === 'NOT_CONFIGURED');
  const fullText = () => exegesisText(`Exegesis — ${title}`, passage, s, ex.label || AI_NOTE);

  const copy = async () => {
    try { await Clipboard.setStringAsync(fullText()); toast.show('Exegesis copied', { icon: 'check' }); } catch (e) { toast.show('Couldn’t copy', { tone: 'error' }); }
  };
  const share = async () => {
    try { await Share.share({ message: fullText() }); } catch (e) { toast.show('Sharing isn’t available here', { tone: 'error' }); }
  };
  const save = () => {
    dispatch({ type: 'note', n: { bookId, chapter, verse: verseStart, text: fullText().slice(0, 9500) } });
    toast.show('Saved to your notes', { icon: 'highlight', action: { label: 'Library', onPress: () => nav.push('Library') } });
  };
  const commentaries = () => nav.push('Study', { bookId, chapter, verse: verseStart, tab: 'Commentary' });

  if (!ex.online) {
    return (
      <KitScreen title="Exegesis" subtitle={title}>
        <Empty
          title="Exegesis needs a connection"
          body="Exegesis is written by BibleNestra’s study assistant on our servers, so it needs the online app. The commentaries, cross-references and lexicon work right here meanwhile."
          action="Open commentaries"
          onAction={commentaries}
        />
      </KitScreen>
    );
  }

  const body = (sec) => {
    if (sec.key === 'passage') {
      return passage ? (
        <View style={styles.passageBox}><NightGlow />
          <Text style={styles.quoteMark}>“</Text>
          <Text style={styles.passageText}>{passage.text}</Text>
          <Text style={styles.passageRef}>{passage.label}</Text>
        </View>
      ) : <Skeleton lines={2} />;
    }
    if (!ex.done[sec.part]) {
      const err = ex.errors[sec.part];
      if (err) return <PartError err={err} onRetry={ex.retry} />;
      return <Skeleton lines={sec.key === 'interpretation' ? 5 : 3} />;
    }
    const v = s[sec.key];
    if (sec.key === 'originalLanguage') {
      if (!v || !v.length) return <Text style={styles.para}>No original-language notes for this passage.</Text>;
      return v.map((w, i) => (
        <View key={i} style={styles.wordRow}>
          <View style={styles.wordHead}>
            <Text style={styles.wordEnglish}>{w.english}</Text>
            {w.original ? <Text style={styles.wordOriginal}>{w.original}</Text> : null}
            {w.translit ? <Text style={styles.wordTranslit}>{w.translit}</Text> : null}
            {w.strong ? (
              <Pressable onPress={() => nav.push('Concordance', { strong: w.strong, bookId, chapter, verse: verseStart })} style={styles.strongTag} accessibilityLabel={`Strong’s ${w.strong}`}>
                <Text style={styles.strongText}>{w.strong}</Text>
              </Pressable>
            ) : null}
          </View>
          {w.meaning ? <Text style={styles.wordMeaning}>{w.meaning}</Text> : null}
        </View>
      ));
    }
    if (sec.key === 'keyTerms') {
      if (!v || !v.length) return <Text style={styles.para}>—</Text>;
      return v.map((k, i) => (
        <Text key={i} style={styles.bullet}><Text style={styles.termBold}>{k.term}. </Text>{k.meaning}</Text>
      ));
    }
    if (sec.key === 'crossReferences') {
      if (!v || !v.length) return <Text style={styles.para}>No cross-references were found for this passage.</Text>;
      return v.map((x, i) => (
        <Pressable key={i} onPress={() => { const r = parseRef(x.ref); if (r) nav.push('Bible', r); }} style={({ pressed }) => [styles.xref, pressed && { opacity: 0.7 }]} accessibilityRole="link" accessibilityLabel={`Open ${x.label}`}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.xrefLabel}>{x.label}</Text>
            {x.note ? <Text style={styles.xrefNote}>{x.note}</Text> : null}
          </View>
          <Icon name="chevron-right" size={16} color={colors.faint} />
        </Pressable>
      ));
    }
    if (sec.key === 'application') {
      const a = v || {};
      const groups = [['For preaching', a.preaching], ['For teaching', a.teaching], ['For personal study', a.personal]].filter(([, l]) => l && l.length);
      if (!groups.length) return <Text style={styles.para}>—</Text>;
      return groups.map(([h, l]) => (
        <View key={h} style={{ marginBottom: 8 }}>
          <Text style={styles.subHead}>{h}</Text>
          {l.map((x, i) => <Text key={i} style={styles.bullet}>•  {x}</Text>)}
        </View>
      ));
    }
    const paras = String(v || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    if (!paras.length) return <Text style={styles.para}>—</Text>;
    return paras.map((p, i) => <Text key={i} style={styles.para}>{p}</Text>);
  };

  return (
    <KitScreen title="Exegesis" subtitle={title}>
      <View style={styles.aiNote}>
        <Icon name="sparkles" size={14} color={colors.gold} />
        <Text style={styles.aiNoteText}>{ex.label || AI_NOTE}</Text>
        <Pressable onPress={commentaries} hitSlop={8}><Text style={styles.aiNoteLink}>Commentaries</Text></Pressable>
      </View>

      {notConfigured ? <Notice text="Exegesis isn’t switched on for this server yet. Passages someone has already studied will still open." /> : null}

      <View style={styles.actions}>
        {[
          { k: 'copy', label: 'Copy', icon: <CopyGlyph />, onPress: copy },
          { k: 'share', label: 'Share', icon: <Icon name="share" size={16} color={colors.primary} />, onPress: share },
          { k: 'save', label: 'Save to notes', icon: <Icon name="highlight" size={16} color={colors.primary} />, onPress: save },
        ].map((a) => (
          <Pressable key={a.k} disabled={!allDone} onPress={a.onPress} style={({ pressed }) => [styles.actionBtn, !allDone && { opacity: 0.45 }, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={a.label}>
            {a.icon}
            <Text style={styles.actionText}>{a.label}</Text>
          </Pressable>
        ))}
      </View>
      {!allDone && !errs.length ? <Text style={styles.progress}>Writing the exegesis… sections appear as they’re ready.</Text> : null}

      {SECTIONS.map((sec, i) => (
        <FadeInUp key={sec.key} index={i} distance={8} duration={320} stagger={30} style={styles.section}>
          <View style={styles.secHead}>
            <View style={styles.secNum}><Text style={styles.secNumText}>{sec.n}</Text></View>
            <Text style={styles.secTitle}>{sec.title}</Text>
          </View>
          {body(sec)}
        </FadeInUp>
      ))}

      <Text style={styles.footer}>{AI_NOTE}. Original-language data: Strong’s-tagged KJV with the Brown-Driver-Briggs and Thayer lexicons (public domain).</Text>
      <Button kind="ghost" label="Compare with the commentaries" onPress={commentaries} style={{ marginTop: 12, marginBottom: 24 }} />
    </KitScreen>
  );
}

function Skeleton({ lines = 3 }) {
  return (
    <View style={{ gap: 8, paddingVertical: 4 }}>
      {Array.from({ length: lines }, (_, i) => <Shimmer key={i} style={{ height: 12, width: i === lines - 1 ? '62%' : '100%' }} />)}
    </View>
  );
}

function PartError({ err, onRetry }) {
  const msg = err.code === 'NOT_CONFIGURED' ? 'Not available on this server yet.' : err.message;
  return (
    <View style={styles.errBox}>
      <Text style={styles.errText}>{msg}</Text>
      {err.code !== 'NOT_CONFIGURED' ? <Pressable onPress={onRetry} hitSlop={8}><Text style={styles.retry}>Try again</Text></Pressable> : null}
    </View>
  );
}

export function CopyGlyph({ color = colors.primary }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Rect x={9} y={9} width={11} height={11} rx={2.5} stroke={color} strokeWidth={1.9} />
      <Path d="M15 9V6.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15H9" stroke={color} strokeWidth={1.9} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  aiNote: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(168,122,39,0.09)', borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9, marginTop: 4 },
  aiNoteText: { flex: 1, fontSize: 12.5, color: colors.fg },
  aiNoteLink: { fontSize: 12.5, fontWeight: '700', color: colors.primary },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 40, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  actionText: { fontSize: 12.5, fontWeight: '700', color: colors.primary },
  progress: { fontSize: 12, color: colors.muted, marginTop: 10, textAlign: 'center' },
  section: { backgroundColor: d.paper, borderRadius: 20, borderWidth: 1, borderColor: d.line, padding: 16, marginTop: 12 },
  secHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  secNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  secNumText: { fontSize: 12, fontWeight: '800', color: colors.primary },
  secTitle: { flex: 1, fontFamily: fonts.serifBold, fontSize: 17.5, color: colors.fg, letterSpacing: -0.2 },
  para: { fontFamily: fonts.serif, fontSize: 15.5, lineHeight: 24, color: colors.passage, marginBottom: 8 },
  bullet: { fontFamily: fonts.serif, fontSize: 15, lineHeight: 23, color: colors.passage, marginBottom: 6 },
  termBold: { fontFamily: fonts.serifBold, color: colors.fg },
  subHead: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: colors.gold, marginBottom: 6, marginTop: 2 },
  passageBox: { overflow: 'hidden', backgroundColor: '#3C2518', borderRadius: 20, padding: 16 },
  quoteMark: { fontFamily: fonts.serifBold, fontSize: 34, lineHeight: 34, color: colors.goldLight, marginBottom: -6 },
  passageText: { fontFamily: fonts.serif, fontSize: 17, lineHeight: 26, color: colors.nightFg },
  passageRef: { fontSize: 12, fontWeight: '700', color: colors.goldLight, marginTop: 10, letterSpacing: 0.4 },
  wordRow: { paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderStrong },
  wordHead: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  wordEnglish: { fontSize: 14.5, fontWeight: '700', color: colors.fg },
  wordOriginal: { fontSize: 16, color: colors.primary },
  wordTranslit: { fontFamily: fonts.serifItalic, fontSize: 14, color: colors.muted },
  strongTag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, backgroundColor: colors.raised },
  strongText: { fontSize: 11.5, fontWeight: '800', color: colors.gold, letterSpacing: 0.4 },
  wordMeaning: { fontFamily: fonts.serif, fontSize: 14.5, lineHeight: 21, color: colors.passage, marginTop: 4 },
  xref: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderStrong },
  xrefLabel: { fontSize: 14.5, fontWeight: '700', color: colors.primary },
  xrefNote: { fontSize: 13, lineHeight: 19, color: colors.muted, marginTop: 2 },
  errBox: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.raised, borderRadius: radius.sm, padding: 10 },
  errText: { flex: 1, fontSize: 13, color: colors.muted },
  retry: { fontSize: 13, fontWeight: '700', color: colors.primary },
  footer: { fontSize: 11, color: colors.faint, textAlign: 'center', marginTop: 18, lineHeight: 16 },
});
