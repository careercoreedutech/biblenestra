// LEARN CMS (online mode): Learn › Courses and Learn › Devotionals filled from the admin dashboard, in the
// same card style as before, plus one simple preview screen per lesson / devotional:
//   excerpt in the app → prominent "Continue reading on our blog →" (in-app browser; counts the lesson as read)
//   → "Mark as complete" when they come back → progress bar + "x of y lessons" update (kept on the server).
// Local mode keeps the built-in sample courses/devotionals in MoreScreens.
import React, { useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { Screen, Button, Tag, Badge, Empty, Eyebrow, alpha } from '../components/ui';
import { Icon } from '../components/Icons';
import { colors, fonts, radius, shadow } from '../theme';
import { useNav } from '../navigation';
import { useToast } from '../components/Toast';
import { FadeInUp, PressScale, AnimatedBar } from '../components/Motion';
import { useApi } from '../api/auth';
import { errorMessage } from '../api/client';
import {
  useCourses, useCourse, useDevotionals, cachedDevotional, enrollCourse, completeLesson, uncompleteLesson, readDevotional, openBlog, fmtDay,
} from '../api/learn';

// ---------- building blocks (same look as the Learn screen) ----------
function Tile({ icon = 'book', tint = colors.primary, uri, size = 36 }) {
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size * 0.32, backgroundColor: colors.raised }} accessibilityIgnoresInvertColors />;
  return (
    <View style={[styles.iconBadge, { width: size, height: size, borderRadius: size * 0.32, backgroundColor: alpha(tint, 0.12) }]}>
      <Icon name={icon} size={17} color={tint} />
    </View>
  );
}

function Progress({ value, tint = colors.gold, delay, style }) {
  const pct = Math.max(0, Math.min(1, value || 0));
  return <AnimatedBar progress={pct} delay={delay} style={[styles.bar, style]} fillStyle={{ borderRadius: 3, backgroundColor: tint }} />;
}

function Loading() {
  return <View style={{ paddingVertical: 36, alignItems: 'center' }}><ActivityIndicator color={colors.primary} /></View>;
}

function Problem({ error, onRetry, title = 'Couldn’t load' }) {
  return (
    <FadeInUp style={[styles.emptyCard, { marginTop: 12 }]}>
      <Empty title={title} body={error} action="Try again" onAction={onRetry} />
    </FadeInUp>
  );
}

const lessonLabel = (p) => (!p.enrolled ? 'Enroll' : p.complete ? 'Review course' : `Continue lesson ${p.nextPosition || p.done + 1}`);

// ---------- Learn › Courses ----------
export function LearnCourses() {
  const nav = useNav();
  const api = useApi();
  const toast = useToast();
  const { items, loaded, error, reload } = useCourses();
  const [busy, setBusy] = useState(null);
  if (!loaded) return <Loading />;
  if (error && !items.length) return <Problem error={error} onRetry={reload} />;
  if (!items.length) {
    return (
      <FadeInUp style={[styles.emptyCard, { marginTop: 12 }]}>
        <Empty title="No courses yet" body="New courses appear here as soon as they’re published." />
      </FadeInUp>
    );
  }
  const go = async (c) => {
    const p = c.progress;
    if (!c.lessons.length) { toast.show('Lessons for this course are coming soon', { icon: 'book' }); return; }
    if (!p.enrolled) {
      setBusy(c.id);
      try {
        await enrollCourse(api, c.id);
        toast.show(`Enrolled in ${c.title}`, { icon: 'book', haptic: 'success' });
      } catch (e) {
        toast.show(errorMessage(e, 'Couldn’t enroll — try again'), { tone: 'error', icon: 'x' });
        setBusy(null);
        return;
      }
      setBusy(null);
    }
    const lessonId = (!p.complete && p.nextLessonId) || c.lessons[0].id;
    nav.push('LessonPreview', { courseId: c.id, lessonId });
  };
  return (
    <View>
      {items.map((c, idx) => {
        const p = c.progress;
        const total = p.total || c.lessonCount;
        return (
          <FadeInUp key={c.id} index={idx} style={styles.card}>
            <View style={styles.cardHead}>
              <Tile uri={c.coverUrl} icon={p.complete ? 'star' : c.icon} tint={p.complete ? colors.gold : colors.primary} />
              <View style={{ flex: 1 }}>
                {c.provider ? <Eyebrow tint={colors.muted}>{c.provider}</Eyebrow> : null}
                <Text style={styles.cardTitle}>{c.title}</Text>
              </View>
              {c.certificate ? <Badge label="Certificate" tint={colors.gold} /> : null}
            </View>
            <View style={styles.metaChips}>
              {[c.level, c.formatLabel, c.duration].filter(Boolean).map((x) => <Tag key={x} label={x} />)}
            </View>
            <Progress value={total ? p.done / total : 0} tint={p.complete ? colors.positive : colors.gold} delay={200 + idx * 70} style={{ marginTop: 14 }} />
            <View style={[styles.cardHead, { marginTop: 10 }]}>
              <Text style={[styles.cardMeta, { flex: 1, marginTop: 0 }]}>{p.done} of {total} lessons{p.complete ? ' · Completed' : ''}</Text>
              <Button small kind={!p.enrolled ? 'primary' : 'ghost'} label={busy === c.id ? 'Enrolling…' : lessonLabel(p)} disabled={busy === c.id} onPress={() => go(c)} />
            </View>
          </FadeInUp>
        );
      })}
    </View>
  );
}

// ---------- Learn › Devotionals ----------
export function LearnDevotionals() {
  const nav = useNav();
  const { items, loaded, error, reload } = useDevotionals();
  if (!loaded) return <Loading />;
  if (error && !items.length) return <Problem error={error} onRetry={reload} />;
  if (!items.length) {
    return (
      <FadeInUp style={[styles.emptyCard, { marginTop: 12 }]}>
        <Empty title="No devotionals yet" body="New devotionals appear here on their publish date." />
      </FadeInUp>
    );
  }
  return (
    <View>
      {items.map((d, idx) => (
        <FadeInUp key={d.id} index={idx} style={styles.card}>
          <PressScale scaleTo={0.985} onPress={() => nav.push('DevotionalPreview', { id: d.id })} accessibilityRole="button" accessibilityLabel={`Read ${d.title}`}>
            {d.coverUrl ? <Image source={{ uri: d.coverUrl }} style={styles.devCover} resizeMode="cover" /> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: d.coverUrl ? 12 : 0 }}>
              <Eyebrow style={{ flex: 1 }}>{fmtDay(d.date)}</Eyebrow>
              {d.read ? <Badge label="Read" tint={colors.positive} /> : null}
            </View>
            <Text style={[styles.cardTitleLg, { marginTop: 6 }]}>{d.title}</Text>
            {d.author ? <Text style={styles.cardMeta}>By {d.author}</Text> : null}
            {d.paragraphs[0] ? <Text style={[styles.cardBody, { marginTop: 12 }]} numberOfLines={3}>{d.paragraphs[0]}</Text> : null}
          </PressScale>
          <View style={styles.btnRow}>
            <Button small label="Read devotional" onPress={() => nav.push('DevotionalPreview', { id: d.id })} icon={<Icon name="book" size={14} color="#FFFFFF" />} />
          </View>
        </FadeInUp>
      ))}
    </View>
  );
}

// ---------- shared preview body ----------
function Excerpt({ imageUrl, paragraphs }) {
  return (
    <View>
      {imageUrl ? <Image source={{ uri: imageUrl }} style={styles.heroImg} resizeMode="cover" /> : null}
      {paragraphs.map((p, i) => <Text key={i} style={styles.para}>{p}</Text>)}
      {paragraphs.length ? <View style={styles.fadeHint}><Text style={styles.fadeHintText}>…the full piece continues on our blog</Text></View> : null}
    </View>
  );
}

function BlogButton({ onPress }) {
  return (
    <PressScale onPress={onPress} scaleTo={0.97} style={styles.blogBtn} accessibilityRole="link" accessibilityLabel="Continue reading on our blog">
      <Text style={styles.blogBtnText}>Continue reading on our blog</Text>
      <Icon name="arrow-right" size={17} color="#FFFFFF" strokeWidth={2.3} />
    </PressScale>
  );
}

// ---------- lesson preview ----------
export function LessonPreviewScreen({ params = {} }) {
  const nav = useNav();
  const api = useApi();
  const toast = useToast();
  const { course, loaded, error, reload } = useCourse(params.courseId);
  const [lessonId, setLessonId] = useState(params.lessonId);
  const [busy, setBusy] = useState(false);
  if (!course) {
    return (
      <Screen back title="Lesson">
        {!loaded ? <Loading /> : <Problem error={error || 'This course isn’t available any more.'} onRetry={reload} title="Lesson not found" />}
      </Screen>
    );
  }
  const lessons = course.lessons || [];
  const lesson = lessons.find((l) => l.id === lessonId) || lessons[0];
  const p = course.progress;
  if (!lesson) {
    return <Screen back title={course.title}><Problem error="Lessons for this course are coming soon." onRetry={reload} title="No lessons yet" /></Screen>;
  }
  const done = p.completed.includes(lesson.id);
  const idx = lessons.indexOf(lesson);
  const next = lessons[idx + 1] || null;
  const total = lessons.length;

  const complete = async (via) => {
    if (done) return;
    try {
      const np = await completeLesson(api, course.id, lesson.id, via);
      if (via === 'button') toast.show(np.complete ? `${course.title} complete!` : `Lesson ${lesson.position} complete · ${np.done} of ${np.total} lessons`, { icon: 'check', haptic: 'success' });
    } catch (e) {
      toast.show(errorMessage(e, 'Couldn’t save your progress — try again'), { tone: 'error', icon: 'x' });
    }
  };
  const readOnBlog = () => {
    openBlog(lesson.blogUrl); // open first (popup blockers on web), then count it as read
    complete('blog');
  };
  const undo = async () => {
    setBusy(true);
    try { await uncompleteLesson(api, course.id, lesson.id); } catch (e) { toast.show(errorMessage(e, 'Couldn’t update'), { tone: 'error', icon: 'x' }); }
    setBusy(false);
  };

  return (
    <Screen back title={course.title} subtitle={`Lesson ${lesson.position} of ${total}${course.provider ? ` · ${course.provider}` : ''}`}>
      <FadeInUp key={lesson.id} distance={10}>
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Eyebrow style={{ flex: 1 }}>Lesson {lesson.position}{lesson.readMinutes ? ` · ${lesson.readMinutes} min read` : ''}</Eyebrow>
            {done ? <Badge label="Completed" tint={colors.positive} /> : null}
          </View>
          <Text style={[styles.cardTitleLg, { marginTop: 6, fontSize: 23, lineHeight: 29 }]}>{lesson.title}</Text>
          <View style={{ marginTop: 6 }}><Excerpt imageUrl={lesson.imageUrl} paragraphs={lesson.paragraphs} /></View>
          <BlogButton onPress={readOnBlog} />
          {done ? (
            <View style={[styles.btnRow, { justifyContent: 'space-between', alignItems: 'center' }]}>
              <Text style={[styles.cardMeta, { marginTop: 0, flex: 1 }]}>Marked as read</Text>
              <Button small kind="ghost" label="Mark as unread" disabled={busy} onPress={undo} />
            </View>
          ) : (
            <Button kind="ghost" label="Mark as complete" style={{ marginTop: 10 }} onPress={() => complete('button')} icon={<Icon name="check" size={15} color={colors.fg} strokeWidth={2.4} />} />
          )}
        </View>
      </FadeInUp>

      <FadeInUp index={1} style={styles.card}>
        <View style={styles.cardHead}>
          <Tile uri={course.coverUrl} icon={p.complete ? 'star' : course.icon} tint={p.complete ? colors.gold : colors.primary} />
          <View style={{ flex: 1 }}>
            {course.provider ? <Eyebrow tint={colors.muted}>{course.provider}</Eyebrow> : null}
            <Text style={styles.cardTitle}>{course.title}</Text>
          </View>
          {course.certificate ? <Badge label="Certificate" tint={colors.gold} /> : null}
        </View>
        <Progress value={total ? p.done / total : 0} tint={p.complete ? colors.positive : colors.gold} style={{ marginTop: 14 }} />
        <Text style={styles.cardMeta}>{p.done} of {total} lessons{p.complete ? ' · Completed' : ''}</Text>
        <View style={{ marginTop: 10 }}>
          {lessons.map((l) => {
            const on = l.id === lesson.id;
            const ok = p.completed.includes(l.id);
            return (
              <PressScale key={l.id} scaleTo={0.98} onPress={() => setLessonId(l.id)} style={[styles.lessonRow, on && styles.lessonRowOn]} accessibilityRole="button" accessibilityLabel={`Lesson ${l.position}: ${l.title}${ok ? ', completed' : ''}`}>
                <View style={[styles.lessonDot, ok && styles.lessonDotDone]}>
                  {ok ? <Icon name="check" size={12} color="#FFFFFF" strokeWidth={3} /> : <Text style={styles.lessonNum}>{l.position}</Text>}
                </View>
                <Text style={[styles.lessonTitle, on && { color: colors.fg, fontWeight: '700' }]} numberOfLines={2}>{l.title}</Text>
              </PressScale>
            );
          })}
        </View>
      </FadeInUp>

      {next ? (
        <Button kind={done ? 'primary' : 'ghost'} label={`Next: Lesson ${next.position}`} style={{ marginTop: 16 }} onPress={() => setLessonId(next.id)} icon={<Icon name="arrow-right" size={15} color={done ? '#FFFFFF' : colors.fg} strokeWidth={2.2} />} />
      ) : p.complete ? (
        <Button label="Back to courses" style={{ marginTop: 16 }} onPress={() => nav.pop()} />
      ) : null}
    </Screen>
  );
}

// ---------- devotional preview ----------
export function DevotionalPreviewScreen({ params = {} }) {
  const nav = useNav();
  const api = useApi();
  const toast = useToast();
  const { items, loaded, error, reload } = useDevotionals();
  const d = items.find((x) => x.id === params.id) || cachedDevotional(params.id);
  if (!d) {
    return (
      <Screen back title="Devotional">
        {!loaded ? <Loading /> : <Problem error={error || 'This devotional isn’t available any more.'} onRetry={reload} title="Devotional not found" />}
      </Screen>
    );
  }
  const markRead = async (via) => {
    if (d.read) return;
    try {
      await readDevotional(api, d.id, via);
      if (via === 'button') toast.show('Marked as read', { icon: 'check', haptic: 'success' });
    } catch (e) {
      toast.show(errorMessage(e, 'Couldn’t save — try again'), { tone: 'error', icon: 'x' });
    }
  };
  return (
    <Screen back title="Devotional" subtitle={fmtDay(d.date)}>
      <FadeInUp style={styles.card}>
        {d.coverUrl ? <Image source={{ uri: d.coverUrl }} style={[styles.heroImg, { marginTop: 0, marginBottom: 12 }]} resizeMode="cover" /> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Eyebrow style={{ flex: 1 }}>{fmtDay(d.date)}</Eyebrow>
          {d.read ? <Badge label="Read" tint={colors.positive} /> : null}
        </View>
        <Text style={[styles.cardTitleLg, { marginTop: 6, fontSize: 23, lineHeight: 29 }]}>{d.title}</Text>
        {d.author ? <Text style={styles.cardMeta}>By {d.author}</Text> : null}
        <View style={{ marginTop: 4 }}><Excerpt paragraphs={d.paragraphs} /></View>
        <BlogButton onPress={() => { openBlog(d.blogUrl); markRead('blog'); }} />
        {d.read ? null : (
          <Button kind="ghost" label="Mark as complete" style={{ marginTop: 10 }} onPress={() => markRead('button')} icon={<Icon name="check" size={15} color={colors.fg} strokeWidth={2.4} />} />
        )}
      </FadeInUp>
      <Button kind="ghost" label="More devotionals" style={{ marginTop: 16 }} onPress={() => nav.pop()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: 16, marginTop: 12, ...shadow.sm },
  emptyCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, ...shadow.sm },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardTitle: { fontFamily: fonts.serifBold, fontSize: 17, lineHeight: 22, color: colors.fg, letterSpacing: -0.2, marginTop: 1 },
  cardTitleLg: { fontFamily: fonts.serifBold, fontSize: 20, lineHeight: 25, color: colors.fg, letterSpacing: -0.3 },
  cardMeta: { fontFamily: fonts.sans, fontSize: 12, color: colors.muted, marginTop: 8, lineHeight: 16 },
  cardBody: { fontFamily: fonts.sans, fontSize: 14, color: colors.passage, lineHeight: 21, marginTop: 8 },
  metaChips: { flexDirection: 'row', gap: 6, marginTop: 12, flexWrap: 'wrap' },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 14, flexWrap: 'wrap' },
  iconBadge: { alignItems: 'center', justifyContent: 'center' },
  bar: { overflow: 'hidden', backgroundColor: colors.raised, height: 6, borderRadius: 3 },
  devCover: { width: '100%', aspectRatio: 2, borderRadius: radius.md, backgroundColor: colors.raised },
  heroImg: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius.md, backgroundColor: colors.raised, marginTop: 10 },
  para: { fontFamily: fonts.serif, fontSize: 16.5, lineHeight: 26, color: colors.passage, marginTop: 12 },
  fadeHint: { marginTop: 10 },
  fadeHintText: { fontFamily: fonts.serifItalic, fontSize: 14, color: colors.muted },
  blogBtn: { marginTop: 18, height: 52, borderRadius: radius.pill, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, ...shadow.sm },
  blogBtnText: { color: '#FFFFFF', fontSize: 15.5, fontWeight: '700', letterSpacing: -0.1 },
  lessonRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, paddingHorizontal: 8, borderRadius: radius.md },
  lessonRowOn: { backgroundColor: colors.raised },
  lessonDot: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  lessonDotDone: { backgroundColor: colors.positive, borderColor: colors.positive },
  lessonNum: { fontSize: 11.5, fontWeight: '700', color: colors.muted },
  lessonTitle: { flex: 1, fontSize: 14, lineHeight: 19, color: colors.muted },
});
