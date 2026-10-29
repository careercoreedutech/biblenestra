import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Screen, Section, Row, Pills, Button, Input, Tag, Badge, Notice, Empty, Divider } from '../components/ui';
import { Toggle } from './PrayerScreen';
import { colors } from '../theme';
import { useStore } from '../store';
import { useNav } from '../navigation';
import { DEVOTIONALS, MEMORY_DECK, COURSES, CHURCHES } from '../data/seed';
import { TRANSLATIONS, getChapter, refLabel } from '../data/bible';

// ---------- Learn ----------
export function LearnScreen({ params = {} }) {
  const nav = useNav();
  const { state, dispatch } = useStore();
  const [tab, setTab] = useState(params.tab || 'Plans');
  const [reveal, setReveal] = useState({});
  return (
    <Screen back title="Learn">
      <Pills items={['Plans', 'Devotionals', 'Memorize', 'Courses', 'Games', 'Badges']} value={tab} onChange={setTab} />
      {tab === 'Plans' ? (
        <View>
          {state.plans.map((p) => (
            <Pressable key={p.id} style={styles.card} onPress={() => nav.push('Plan', { id: p.id })}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={styles.cardTitle}>{p.name}</Text>{p.shared ? <Badge label={`Shared · ${p.participants.length + 1}`} /> : null}</View>
              <View style={styles.bar}><View style={[styles.barFill, { width: `${(p.done / p.days) * 100}%` }]} /></View>
              <Text style={styles.cardMeta}>{p.startsOn ? `Starts ${p.startsOn}` : `Day ${p.done} of ${p.days}`}{state.streaksEnabled && p.streak ? ` · ${p.streak}-day streak` : ''}{p.reminder ? ` · Reminder ${p.reminder}` : ''}</Text>
            </Pressable>
          ))}
          <Divider />
          <Row title="Browse public plans" subtitle="By book, topic, chronology, season, tradition, duration" right="›" />
          <Row title="Create a custom plan" right="›" onPress={() => nav.push('Create', { kind: 'Study' })} />
          <Row title="Sync status" subtitle="Progress writes are atomic; a completed day cannot silently become incomplete." right="Synced" />
        </View>
      ) : null}
      {tab === 'Devotionals' ? DEVOTIONALS.map((d) => (
        <View key={d.id} style={styles.card}>
          <Text style={styles.cardTitle}>{d.title}</Text>
          <Text style={styles.cardMeta}>{d.author} · {d.tradition} · {refLabel(d.passage.bookId, d.passage.chapter)}</Text>
          <Text style={styles.cardBody}>{d.body}</Text>
          <Text style={[styles.cardBody, { color: colors.teal, fontStyle: 'italic' }]}>{d.question}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}><Button small kind="ghost" label="Read passage" onPress={() => nav.push('Bible', d.passage)} /><Button small kind="ghost" label="Listen" /><Button small kind="ghost" label="Discuss" onPress={() => nav.push('Group', { id: 'g2' })} /></View>
        </View>
      )) : null}
      {tab === 'Memorize' ? (
        <View>
          <Notice tint={colors.teal} text="Spaced repetition. Missing a day just moves the card; nothing is lost." />
          {MEMORY_DECK.map((m) => {
            const text = (getChapter('KJV', m.bookId, m.chapter) || [])[m.verse - 1] || '';
            const hidden = text.split(' ').map((w, i) => (reveal[m.id] || i % 3 === 0 ? w : w[0] + '_'.repeat(Math.max(1, w.length - 1)))).join(' ');
            return (
              <View key={m.id} style={styles.card}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={styles.cardTitle}>{m.ref}</Text><Tag label={`Due ${m.due}`} /></View>
                <Text style={[styles.cardBody, { fontSize: 14 }]}>{hidden}</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <Button small kind="ghost" label={reveal[m.id] ? 'Hide words' : 'Reveal'} onPress={() => setReveal({ ...reveal, [m.id]: !reveal[m.id] })} />
                  <Button small kind="ghost" label="First letters" /><Button small kind="ghost" label="Type it" /><Button small kind="ghost" label="Audio" />
                </View>
                <Text style={styles.cardMeta}>Confidence {'●'.repeat(m.confidence)}{'○'.repeat(5 - m.confidence)}</Text>
              </View>
            );
          })}
          <Row title="Group memorization challenge" subtitle="Campus Fellowship · Philippians 4" right="›" />
        </View>
      ) : null}
      {tab === 'Courses' ? COURSES.map((c) => (
        <View key={c.id} style={styles.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={styles.cardTitle}>{c.title}</Text>{c.certificate ? <Badge label="Certificate" tint={colors.yellow} /> : null}</View>
          <Text style={styles.cardMeta}>{c.provider} · {c.level} · {c.mode} · {c.duration}</Text>
          <View style={styles.bar}><View style={[styles.barFill, { width: `${(c.done / c.lessons) * 100}%` }]} /></View>
          <Text style={styles.cardMeta}>{c.done} of {c.lessons} lessons{c.done === c.lessons ? ' · Completed' : ''}</Text>
          <Button small kind="ghost" label={c.done === 0 ? 'Enroll' : c.done === c.lessons ? 'View certificate' : 'Continue lesson ' + (c.done + 1)} style={{ alignSelf: 'flex-start', marginTop: 10 }} onPress={() => nav.push('Lesson', { id: c.id })} />
        </View>
      )) : null}
      {tab === 'Games' ? (
        <View>
          {['Bible trivia', 'Verse completion', 'Character & place identification', 'Book matching', 'Timeline ordering', 'Bible geography', 'Original-language flashcards', 'Memory-verse race'].map((g) => <Row key={g} title={g} subtitle="Solo · family · group · live quiz" right="›" />)}
          <Notice text="Scores and badges are optional and private by default. Every question carries a source reference." />
          <Row title="Child & family mode" subtitle="Child profiles, guardian controls, no open messaging" right="›" onPress={() => nav.push('Profile', { tab: 'Family' })} />
        </View>
      ) : null}
      {tab === 'Badges' ? (
        <View>
          <Row title="Gospel reader" subtitle="Finish a Gospel reading plan · 6 of 21 days" right={<Tag label="In progress" />} />
          <Row title="Small group leader" subtitle="Completed Leading a Small Group" right={<Badge label="Earned" tint={colors.yellow} />} />
          <Row title="Memory 10" subtitle="Memorize 10 verses · 3 of 10" right={<Tag label="In progress" />} />
          <Row title="Hide badges from profile" right={<Toggle value={false} onChange={() => {}} />} />
          <Notice text="Badges are never proof of spiritual maturity, authority, or biblical correctness." />
        </View>
      ) : null}
    </Screen>
  );
}

export function PlanScreen({ params }) {
  const nav = useNav();
  const { state, dispatch } = useStore();
  const p = state.plans.find((x) => x.id === params.id);
  return (
    <Screen back title={p.name} subtitle={`Day ${p.done + 1} of ${p.days}`}>
      <View style={styles.bar}><View style={[styles.barFill, { width: `${(p.done / p.days) * 100}%` }]} /></View>
      <Section title="Today's reading">
        <Row title={refLabel(p.today.bookId, p.today.chapter)} subtitle="Tap to read" right="›" onPress={() => nav.push('Bible', p.today)} />
        <Button label="Mark today complete" onPress={() => dispatch({ type: 'planDone', id: p.id })} style={{ marginTop: 12 }} disabled={p.done >= p.days} />
      </Section>
      {p.shared ? (
        <Section title="Reading with">
          {p.participants.map((n) => <Row key={n} title={n} subtitle="Shares progress with you" right={<Tag label="Day 6" />} />)}
          <Row title="Day discussion" subtitle="Private space for this plan" right="›" onPress={() => nav.push('Group', { id: 'g2' })} />
          <Row title="Invite friends" right="›" onPress={() => nav.push('People')} />
        </Section>
      ) : <Section title="Share"><Row title="Invite friends to read with you" subtitle="Choose a shared start date" right="›" onPress={() => nav.push('People')} /></Section>}
      <Section title="Settings">
        <Row title="Reminder" right={p.reminder || 'Off'} />
        <Row title="Catch-up behaviour" right="Skip missed" />
        <Row title="Rest days" right="Sundays" />
        <Row title="Streaks" right={<Toggle value={state.streaksEnabled} onChange={(v) => dispatch({ type: 'set', patch: { streaksEnabled: v } })} />} />
        <Row title="Pause / leave plan" subtitle="Others keep reading" right="›" />
      </Section>
    </Screen>
  );
}

export function LessonScreen({ params }) {
  const nav = useNav();
  const c = COURSES.find((x) => x.id === params.id);
  const [speed, setSpeed] = useState('1×');
  return (
    <Screen back title={c.title} subtitle={`Lesson ${Math.min(c.done + 1, c.lessons)} · ${c.provider}`}>
      <View style={styles.player}><Text style={{ color: colors.muted }}>▷ Lesson player · captions · picture-in-picture · audio-only</Text></View>
      <Pills small items={['0.5×', '0.75×', '1×', '1.25×', '1.5×', '2×']} value={speed} onChange={setSpeed} />
      <Section title="Transcript">
        {[['00:00', 'Welcome back. Today we read Matthew 1 and ask why Matthew begins with a genealogy.'], ['02:14', 'Notice the three sets of fourteen. Fourteen is the numeric value of David\'s name in Hebrew.'], ['05:40', 'Four women appear: Tamar, Rahab, Ruth and the wife of Uriah.']].map(([t, s]) => <Row key={t} title={s} left={<Text style={{ color: colors.muted, fontSize: 9 }}>{t}</Text>} />)}
      </Section>
      <Section title="Teacher notes"><Row title="Open Matthew 1" right="›" onPress={() => nav.push('Bible', { bookId: 'MAT', chapter: 1 })} /><Row title="Discussion prompt" subtitle="Why include the four women?" /><Row title="Assignment" subtitle="Write 200 words on Matthew 1:21" /></Section>
      <Input multiline placeholder="Private reflection (saved to this lesson)" style={{ marginTop: 16 }} />
      <Button label="Mark lesson complete" style={{ marginTop: 14 }} onPress={() => nav.pop()} />
    </Screen>
  );
}

// ---------- Sermon Studio ----------
export function SermonStudioScreen() {
  const nav = useNav();
  const { state, dispatch } = useStore();
  const [rec, setRec] = useState('idle'); // idle | recording | paused
  const [secs, setSecs] = useState(0);
  const [title, setTitle] = useState('');
  const [passage, setPassage] = useState('');
  const [privacy, setPrivacy] = useState('Private');
  const [consent, setConsent] = useState(false);
  const timer = useRef(null);
  useEffect(() => {
    if (rec === 'recording') timer.current = setInterval(() => setSecs((s) => s + 1), 1000);
    else clearInterval(timer.current);
    return () => clearInterval(timer.current);
  }, [rec]);
  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const save = () => {
    dispatch({ type: 'recording', r: { title: title.trim() || 'Untitled recording', speaker: state.user.displayName, passage: passage || '—', duration: fmt(secs), privacy } });
    setRec('idle'); setSecs(0); setTitle(''); setPassage('');
  };
  const statusTint = { transcribed: colors.teal, draft: colors.warning, failed: colors.negative, transcribing: colors.lavender };
  return (
    <Screen back title="Sermon Studio" subtitle="Record · transcribe · search · share safely">
      {!consent ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Before you record</Text>
          <Text style={styles.cardBody}>Recording other people may require their permission under local law. Recordings stay private drafts until you choose what to do with them. The app never publishes automatically.</Text>
          <Button small label="I understand · allow microphone" style={{ alignSelf: 'flex-start', marginTop: 10 }} onPress={() => setConsent(true)} />
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.recTime}>{fmt(secs)}</Text>
          <View style={styles.wave}>{Array.from({ length: 28 }, (_, i) => <View key={i} style={[styles.waveBar, { height: rec === 'recording' ? 6 + ((i * 7 + secs * 13) % 22) : 4 }]} />)}</View>
          <Text style={styles.cardMeta}>Mic: {rec === 'recording' ? 'live' : 'ready'} · Storage: 4.2 GB free</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {rec === 'idle' ? <Button small label="● Record" onPress={() => setRec('recording')} /> : null}
            {rec === 'recording' ? <Button small kind="ghost" label="❚❚ Pause" onPress={() => setRec('paused')} /> : null}
            {rec === 'paused' ? <Button small label="▶ Resume" onPress={() => setRec('recording')} /> : null}
            {rec !== 'idle' ? <Button small kind="ghost" label="■ Stop & save draft" onPress={save} /> : null}
            <Button small kind="ghost" label="Import audio" />
          </View>
          <Input placeholder="Title" value={title} onChangeText={setTitle} style={{ marginTop: 12 }} />
          <Input placeholder="Bible passage (e.g. Matthew 1)" value={passage} onChangeText={setPassage} style={{ marginTop: 8 }} />
          <Pills small items={['Private', 'Selected people', 'Church', 'Public']} value={privacy} onChange={setPrivacy} style={{ marginTop: 8 }} />
        </View>
      )}
      <Section title="Your recordings">
        {state.recordings.map((r) => (
          <View key={r.id} style={styles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={styles.cardTitle}>{r.title}</Text><Badge label={r.status} tint={statusTint[r.status] || colors.muted} /></View>
            <Text style={styles.cardMeta}>{r.speaker} · {r.passage} · {r.duration} · {r.privacy}</Text>
            {r.refs.length ? <Text style={[styles.cardMeta, { color: colors.teal }]}>Detected references (confirm before verified): {r.refs.join(', ')}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <Button small kind="ghost" label="▷ Play" />
              {r.status === 'draft' ? <Button small kind="ghost" label="Transcribe" onPress={() => { dispatch({ type: 'recordingStatus', id: r.id, status: 'transcribing' }); setTimeout(() => dispatch({ type: 'recordingStatus', id: r.id, status: 'transcribed' }), 1500); }} /> : null}
              {r.status === 'failed' ? <Button small label="Retry transcription" onPress={() => { dispatch({ type: 'recordingStatus', id: r.id, status: 'transcribing' }); setTimeout(() => dispatch({ type: 'recordingStatus', id: r.id, status: 'transcribed' }), 1500); }} /> : null}
              {r.status === 'transcribed' ? <Button small kind="ghost" label="Transcript" onPress={() => nav.push('Transcript', { id: r.id })} /> : null}
              <Button small kind="ghost" label="Trim" /><Button small kind="ghost" label="Rename" />
            </View>
            {r.status === 'failed' ? <Text style={[styles.cardMeta, { color: colors.negative }]}>Transcription failed. Your audio is safe and was not deleted.</Text> : null}
          </View>
        ))}
      </Section>
    </Screen>
  );
}

export function TranscriptScreen({ params }) {
  const nav = useNav();
  const { state } = useStore();
  const r = state.recordings.find((x) => x.id === params.id);
  const [tab, setTab] = useState('Transcript');
  return (
    <Screen back title={r.title} subtitle="Transcript · edits never destroy the original">
      <Pills items={['Transcript', 'Summary', 'Outline', 'Questions']} value={tab} onChange={setTab} />
      {tab === 'Transcript' ? [['00:00', 'Good morning church. Open with me to Matthew chapter one.'], ['00:48', 'Matthew does not begin with a birth. He begins with a list of names.'], ['03:10', 'Abraham begat Isaac. Isaac begat Jacob. Every name is a promise kept.'], ['09:32', 'Turn to Luke chapter three, verse twenty-three, and compare.']].map(([t, s]) => <Row key={t} title={s} left={<Text style={{ color: colors.muted, fontSize: 9 }}>{t}</Text>} />) : null}
      {tab === 'Summary' ? <View><Tag label="AI draft · needs your review" tint={colors.amber} /><Text style={styles.cardBody}>Draft summary: the sermon reads Matthew 1 as a record of kept promises, pairing it with Luke 3 and Genesis 22. This summary is generated and is not the sermon itself.</Text></View> : null}
      {tab === 'Outline' ? <View><Tag label="AI draft · needs your review" tint={colors.amber} /><Text style={styles.cardBody}>1. A list of names (Matt 1:1-17){'\n'}2. Four unexpected women{'\n'}3. Emmanuel: God with us (Matt 1:23)</Text></View> : null}
      {tab === 'Questions' ? <View><Tag label="AI draft · needs your review" tint={colors.amber} /><Text style={styles.cardBody}>· Which name in the genealogy surprised you?{'\n'}· What promise has God kept in your family?{'\n'}· What does "God with us" mean this week?</Text></View> : null}
      <Section title="Detected references">{r.refs.map((x) => <Row key={x} title={x} subtitle="Suggestion · confirm to verify" right={<Button small kind="ghost" label="Confirm" />} />)}</Section>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}><Button small kind="ghost" label="Edit transcript" /><Button small kind="ghost" label="Export" /><Button small label="Share…" onPress={() => nav.push('Create', { kind: 'Resource' })} /></View>
      <Notice text="Publishing requires confirming you hold the rights. Private recordings are never publicly searchable." />
    </Screen>
  );
}

// ---------- Create ----------
export function CreateScreen({ params = {} }) {
  const nav = useNav();
  const { state, dispatch } = useStore();
  const kinds = ['Post', 'Prayer request', 'Wish', 'Study', 'Event', 'Sermon recording', 'Resource', 'Group', 'Live stream'];
  const [kind, setKind] = useState(params.kind || 'Post');
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [audience, setAudience] = useState('Connections');
  const [cat, setCat] = useState('Prayer & spiritual growth');
  const [responses, setResponses] = useState(['Prayer', 'Encouragement']);
  const submit = () => {
    if (kind === 'Post') { dispatch({ type: 'post', post: { kind: 'Reflection', text } }); nav.replace('Feed'); }
    else if (kind === 'Wish') { dispatch({ type: 'addWish', w: { title, body: text, category: cat, visibility: audience, responses } }); nav.replace('Wishes'); }
    else if (kind === 'Prayer request') nav.replace('NewPrayer');
    else if (kind === 'Sermon recording') nav.replace('SermonStudio');
    else nav.pop();
  };
  return (
    <Screen back title="Create">
      <Pills small items={kinds} value={kind} onChange={setKind} />
      {kind === 'Prayer request' ? <Button label="Open prayer composer" onPress={() => nav.replace('NewPrayer')} style={{ marginTop: 16 }} /> : null}
      {kind === 'Sermon recording' ? <Button label="Open Sermon Studio" onPress={() => nav.replace('SermonStudio')} style={{ marginTop: 16 }} /> : null}
      {kind === 'Post' ? <Input multiline placeholder="Verse, reflection, testimony, question, or announcement" value={text} onChangeText={setText} style={{ marginTop: 14, minHeight: 120 }} /> : null}
      {kind === 'Wish' ? (
        <View style={{ gap: 10, marginTop: 14 }}>
          <Input placeholder="What do you hope for?" value={title} onChangeText={setTitle} />
          <Input multiline placeholder="Tell people a little more" value={text} onChangeText={setText} />
          <Text style={styles.label}>Category</Text>
          <Pills small items={['Prayer & spiritual growth', 'Encouragement', 'Education', 'Family & relationships', 'Employment & career', 'Ministry / community project', 'Mentor / collaborator', 'Practical assistance']} value={cat} onChange={setCat} />
          <Text style={styles.label}>How people can respond</Text>
          <Pills small items={['Prayer', 'Encouragement', 'Advice', 'Resources', 'Mentor connection', 'Group invitation', 'Private message']} value={responses} onChange={(r) => setResponses(responses.includes(r) ? responses.filter((x) => x !== r) : [...responses, r])} />
        </View>
      ) : null}
      {kind === 'Study' ? (
        <View style={{ gap: 10, marginTop: 14 }}>
          <Input placeholder="Study title" value={title} onChangeText={setTitle} />
          <Text style={styles.label}>Blocks</Text>
          {['📖 Bible passage', '✎ Explanation', '❓ Question', '▶ Video', '🖼 Image', '🎧 Audio', '🙏 Prayer prompt', '📊 Poll', '📝 Assignment'].map((b) => <Row key={b} title={b} right="＋" />)}
          <Notice text="AI-suggested questions stay drafts until you review them." />
        </View>
      ) : null}
      {kind === 'Event' || kind === 'Live stream' ? (
        <View style={{ gap: 10, marginTop: 14 }}>
          <Input placeholder={kind + ' title'} value={title} onChangeText={setTitle} />
          <Input placeholder="Date & time (time zone: Africa/Lagos)" />
          <Input placeholder={kind === 'Event' ? 'Venue or online link' : 'Related Bible passage'} />
          <Row title="Registration & capacity" right="Open" /><Row title="Recurrence" right="None" /><Row title="Recording consent notice" right={<Toggle value onChange={() => {}} />} />
        </View>
      ) : null}
      {kind === 'Resource' ? <View style={{ marginTop: 14 }}><Input placeholder="Resource title" value={title} onChangeText={setTitle} /><Row title="Source, author, rights holder, license" subtitle="Required before publishing" right="›" /><Row title="I confirm I hold the rights to share this" right={<Toggle value={false} onChange={() => {}} />} /></View> : null}
      {kind === 'Group' ? <View style={{ marginTop: 14, gap: 10 }}><Input placeholder="Group name" value={title} onChangeText={setTitle} /><Input multiline placeholder="Description" value={text} onChangeText={setText} /><Text style={styles.label}>Visibility</Text><Pills small items={['Public', 'Discoverable private', 'Invite-only', 'Hidden']} value={audience} onChange={setAudience} /><Row title="Join approval" right="Required" /><Row title="Membership questions" right="›" /><Row title="Channels" right="General, Prayer, Bible Study" /></View> : null}
      {kind === 'Post' || kind === 'Wish' ? (
        <Section title="Audience">
          <Pills small items={['Private', 'Selected people', 'Selected community', 'Connections', 'Public']} value={audience} onChange={setAudience} />
          <Row title="Comments" right={<Toggle value onChange={() => {}} />} />
        </Section>
      ) : null}
      {kind !== 'Prayer request' && kind !== 'Sermon recording' ? <Button label={kind === 'Post' ? 'Publish' : kind === 'Wish' ? 'Share wish' : 'Create ' + kind.toLowerCase()} onPress={submit} style={{ marginTop: 20 }} disabled={kind === 'Post' ? !text.trim() : kind === 'Wish' ? !title.trim() : false} /> : null}
    </Screen>
  );
}

// ---------- Profile & settings ----------
export function ProfileScreen({ params = {} }) {
  const nav = useNav();
  const { state, dispatch, sync } = useStore();
  const u = state.user;
  const [tab, setTab] = useState(params.tab || 'Profile');
  const set = (patch) => dispatch({ type: 'user', user: patch });
  const myProposals = (state.proposals || []).filter((p) => p.userId === u.username || p.userId === 'user');
  const myVideos = (state.videos || []).filter((v) => v.creator?.username === u.username || v.creator?.name === u.displayName);

  return (
    <Screen back={nav.stack.length > 0} title={u.displayName} subtitle={`@${u.username} · ${u.profileVisibility}`}>
      <Pills
        small
        items={['Profile', 'Wallet & Gifts', 'Creator', 'Jobs', 'Study', 'Privacy', 'Account']}
        value={tab}
        onChange={setTab}
      />
      {tab === 'Profile' ? (
        <View>
          <View style={{ alignItems: 'center', marginTop: 14 }}>
            <View style={[styles.avatar, { width: 68, height: 68, borderRadius: 34, backgroundColor: colors.raised, borderColor: colors.gold, borderWidth: 2 }]}>
              <Text style={{ color: colors.gold, fontSize: 24, fontWeight: '700' }}>{u.displayName[0]}</Text>
            </View>
            <Text style={[styles.cardTitle, { fontSize: 20, marginTop: 10 }]}>{u.displayName}</Text>
            <Text style={styles.cardMeta}>{u.headline} · {u.country} · {u.languages.join(', ')}</Text>
            {u.church.visible ? <Text style={[styles.cardMeta, { color: colors.teal, marginTop: 4 }]}>⛪ {u.church.name}</Text> : null}

            {/* Quick Stats Banner */}
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 14, width: '100%', justifyContent: 'center' }}>
              <View style={styles.statBox}>
                <Text style={styles.statValue}>🪙 {state.coins || 0}</Text>
                <Text style={styles.statLabel}>Kingdom Coins</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statValue}>{state.bookmarks?.length || 0}</Text>
                <Text style={styles.statLabel}>Bookmarks</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statValue}>{state.highlights?.length || 0}</Text>
                <Text style={styles.statLabel}>Highlights</Text>
              </View>
            </View>
          </View>

          <Section title="Kingdom Wallet & Support">
            <Row
              title="Virtual Coin Balance"
              subtitle="Use coins to send virtual gifts & support Christian creators"
              right={`🪙 ${state.coins || 0} Coins`}
              onPress={() => setTab('Wallet & Gifts')}
            />
          </Section>

          <Section title="Availability for chat">
            <Pills small items={['Available now', 'Selected times', 'Message requests', 'Not accepting']} value={{ now: 'Available now', times: 'Selected times', requests: 'Message requests', none: 'Not accepting' }[u.availability]} onChange={(v) => set({ availability: { 'Available now': 'now', 'Selected times': 'times', 'Message requests': 'requests', 'Not accepting': 'none' }[v] })} />
            <Text style={styles.label}>I accept</Text>
            <Pills small items={['General chat', 'Bible study', 'Prayer', 'Professional', 'Mentoring', 'Care / support']} value={u.acceptsChat} onChange={(v) => set({ acceptsChat: u.acceptsChat.includes(v) ? u.acceptsChat.filter((x) => x !== v) : [...u.acceptsChat, v] })} />
          </Section>
          <Section title="Professional profile">
            <Row title="Headline & testimony" right="›" /><Row title="Christian skills" subtitle="Teaching, worship, discipleship" right="›" /><Row title="Professional skills" subtitle="Technology, Design, Audio" right="›" /><Row title="Experience, education, certifications" right="›" /><Row title="Portfolio" right="›" /><Row title="Verification" subtitle="Identity · Church affiliation · Licence · Education" right={<Badge label="Identity" tint={colors.gold} />} /><Row title="Open to opportunities" right={<Toggle value={false} onChange={() => {}} />} />
          </Section>
          <Section title="Memberships">{state.communities.filter((c) => c.joined === true).map((c) => <Row key={c.id} title={c.name} right="›" onPress={() => nav.push('Group', { id: c.id })} />)}</Section>
        </View>
      ) : null}

      {tab === 'Wallet & Gifts' ? (
        <View style={{ marginTop: 12 }}>
          <View style={[styles.card, { alignItems: 'center', borderColor: colors.gold, borderWidth: 1.5 }]}>
            <Text style={{ fontSize: 32 }}>🪙</Text>
            <Text style={{ fontFamily: fonts.serifBold, fontSize: 26, color: colors.gold, marginTop: 4 }}>{state.coins || 0} Coins</Text>
            <Text style={styles.cardMeta}>Kingdom Virtual Currency Balance</Text>
            <Text style={[styles.cardBody, { textAlign: 'center', marginTop: 8 }]}>
              Gift Christian evangelists, ministries, worship artists, and teachers on Socials.
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <Button small label="＋ Add 100 Coins" onPress={() => dispatch({ type: 'buyCoins', amount: 100 })} />
              <Button small kind="ghost" label="＋ Add 500 Coins" onPress={() => dispatch({ type: 'buyCoins', amount: 500 })} />
            </View>
          </View>

          <Section title="Gifts Sent & Received">
            {state.giftTransactions && state.giftTransactions.length ? (
              state.giftTransactions.map((tx) => (
                <Row
                  key={tx.id}
                  title={`${tx.giftName} sent`}
                  subtitle={new Date(tx.timestamp).toLocaleTimeString()}
                  right={`-${tx.cost} Coins`}
                />
              ))
            ) : (
              <Notice text="You haven't sent any gifts yet. Watch short videos on Socials and bless your favorite creators!" />
            )}
          </Section>
        </View>
      ) : null}

      {tab === 'Creator' ? (
        <View style={{ marginTop: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={styles.cardTitle}>My Ministry Videos</Text>
            <Button small label="＋ Upload Short" onPress={() => nav.push('Socials')} />
          </View>
          {myVideos.length ? (
            myVideos.map((v) => (
              <Row
                key={v.id}
                title={v.caption}
                subtitle={`${v.views} views · ${v.likes} likes · ${v.giftsCount || 0} gifts`}
                right="▶"
                onPress={() => nav.push('Socials', { initialVideoId: v.id })}
              />
            ))
          ) : (
            <Notice text="You haven't posted any ministry videos yet. Tap 'Upload Short' in Socials to share gospel reflections and testimonies." />
          )}
        </View>
      ) : null}

      {tab === 'Jobs' ? (
        <View style={{ marginTop: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={styles.cardTitle}>My Marketplace Activity</Text>
            <Button small label="Post Work" onPress={() => nav.push('Jobs')} />
          </View>
          <Section title="Submitted Proposals">
            {myProposals.length ? (
              myProposals.map((pr) => (
                <Row
                  key={pr.id}
                  title={`Applied for ${pr.jobTitle || 'Gig'}`}
                  subtitle={`Rate: ${pr.bidRate} · Delivery: ${pr.deliveryDays} days`}
                  right={<Badge label={pr.status.toUpperCase()} tint={colors.gold} />}
                />
              ))
            ) : (
              <Notice text="No active proposals submitted. Browse jobs and tasks in the marketplace!" />
            )}
          </Section>
        </View>
      ) : null}
      {tab === 'Study' ? (
        <View>
          <Section title="Translation">
            <Pills small items={TRANSLATIONS.filter((t) => t.available).map((t) => t.id)} value={state.translation} onChange={(t) => dispatch({ type: 'set', patch: { translation: t } })} />
          </Section>
          <Section title="Study presets">
            {u.presets.map((p) => <Row key={p.name} title={p.name} subtitle={`${p.translation} · ${p.layout}${p.audio ? ' · Audio' : ''}${p.reminder ? ' · ' + p.reminder : ''}`} right={u.preset === p.name ? <Badge label="Active" /> : null} onPress={() => { set({ preset: p.name }); dispatch({ type: 'set', patch: { translation: p.translation } }); }} />)}
          </Section>
          <Section title="Reading">
            <Row title="Font size" right={<View style={{ flexDirection: 'row', gap: 10 }}><Pressable onPress={() => dispatch({ type: 'set', patch: { fontSize: Math.max(12, state.fontSize - 1) } })}><Text style={{ color: colors.accent }}>A−</Text></Pressable><Text style={{ color: colors.fg }}>{state.fontSize}</Text><Pressable onPress={() => dispatch({ type: 'set', patch: { fontSize: Math.min(24, state.fontSize + 1) } })}><Text style={{ color: colors.accent }}>A+</Text></Pressable></View>} />
            <Row title="Original-language depth" right="Basic" /><Row title="Commentary traditions" right="All" /><Row title="Audio playback speed" right="1.0×" /><Row title="Downloads" subtitle="KJV, WEB · 12 MB · encrypted" right="›" /><Row title="Data-saving mode" right={<Toggle value={false} onChange={() => {}} />} />
          </Section>
          <Section title="Interests"><Pills small items={['Gospels', 'Leadership', 'Prayer', 'Youth', 'Marriage', 'Missions', 'Career', 'Doctrine', 'New believer']} value={u.interests} onChange={(i) => set({ interests: u.interests.includes(i) ? u.interests.filter((x) => x !== i) : [...u.interests, i] })} /></Section>
        </View>
      ) : null}
      {tab === 'Privacy' ? (
        <View>
          <Section title="Profile visibility"><Pills small items={['public', 'limited', 'community-only', 'connections-only', 'private']} value={u.profileVisibility} onChange={(v) => set({ profileVisibility: v })} /></Section>
          <Section title="Discoverable by">
            {Object.keys(u.discoverable).map((k) => <Row key={k} title={k[0].toUpperCase() + k.slice(1)} right={<Toggle value={u.discoverable[k]} onChange={(v) => set({ discoverable: { ...u.discoverable, [k]: v } })} />} />)}
            <Row title="Show church affiliation on profile" right={<Toggle value={u.church.visible} onChange={(v) => set({ church: { ...u.church, visible: v } })} />} />
            <Row title="Online / last seen" right={<Toggle value={false} onChange={() => {}} />} />
          </Section>
          <Section title="Bible Chat & Scripture Companion">
            <Row title="Remember my study topics" right={<Toggle value onChange={() => {}} />} />
            <Row title="Use my messages for personalization" subtitle="Off by default. Never used for ads." right={<Toggle value={false} onChange={() => {}} />} />
            <Row title="Delete chat history" right="›" onPress={() => dispatch({ type: 'chat', history: [] })} />
            <Row title="Delete Companion history" right="›" onPress={() => dispatch({ type: 'set', patch: { companionHistory: [] } })} />
          </Section>
          <Section title="Data"><Row title="Export my data" right="›" /><Row title="Blocked accounts" right={String(state.blocked.length)} /><Row title="Consent & AI use" subtitle="How AI, memory and human review work" right="›" /></Section>
        </View>
      ) : null}
      {tab === 'Notifications' ? (
        <View>
          {[['push', 'Push'], ['email', 'Email'], ['bible', 'Bible reminders & plan progress'], ['groups', 'Group messages, mentions, replies'], ['prayer', 'Prayer responses'], ['events', 'Events, livestreams, celebrations'], ['safety', 'Safety & security (always on)']].map(([k, l]) => <Row key={k} title={l} right={<Toggle value={state.notifications[k]} onChange={(v) => k !== 'safety' && dispatch({ type: 'set', patch: { notifications: { ...state.notifications, [k]: v } } })} />} />)}
          <Row title="Quiet hours" right={state.notifications.quietHours} /><Row title="Digest frequency" right="Daily" /><Row title="Preview privacy" subtitle="Hide message text on lock screen" right={<Toggle value onChange={() => {}} />} />
        </View>
      ) : null}
      {tab === 'Family' ? (
        <View>
          <Notice tint={colors.teal} text="Child profiles have age bands, guardian controls, safe downloads, no open direct messaging, and no public discovery." />
          <Row title="Add a child profile" right="›" /><Row title="Screen-time reminders" right="Off" /><Row title="Content & progress visibility" right="›" />
          <Row title="Bible stories, trivia, memory-match, coloring" subtitle="Age-appropriate activities" right="›" onPress={() => nav.push('Learn', { tab: 'Games' })} />
        </View>
      ) : null}
      {tab === 'Account' ? (
        <View>
          <Row title="Sync status" subtitle={sync.at ? 'Last successful sync ' + sync.at.toLocaleTimeString() : 'Saved locally'} right={<Badge label={sync.status} tint={sync.status === 'failed' ? colors.negative : colors.teal} />} />
          <Row title="Backup & restore" subtitle="Verified backup before updates and migrations" right="›" />
          <Row title="Sessions & devices" right="›" /><Row title="Change password" right="›" /><Row title="Subscriptions & ad-free" subtitle="Ads never interrupt Scripture, prayer, audio or search" right="›" />
          <Row title="Redo onboarding" right="›" onPress={() => dispatch({ type: 'set', patch: { onboarded: false } })} />
          <Row title="Deactivate or delete account" right="›" />
          <Button kind="danger" label="Reset local data" style={{ marginTop: 20 }} onPress={() => { dispatch({ type: 'reset' }); nav.reset(); }} />
        </View>
      ) : null}
    </Screen>
  );
}

// ---------- Onboarding ----------
export function OnboardingScreen() {
  const { state, dispatch } = useStore();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(state.user.displayName);
  const [translation, setTranslation] = useState('KJV');
  const [interests, setInterests] = useState(['Gospels', 'Prayer']);
  const [churchQ, setChurchQ] = useState('');
  const [church, setChurch] = useState(null);
  const [disc, setDisc] = useState({ people: true, professionals: false, communities: true, churches: true });
  const [offer, setOffer] = useState(['Prayer']);
  const matches = churchQ.length > 1 ? CHURCHES.filter((c) => (c.name + c.location).toLowerCase().includes(churchQ.toLowerCase())) : [];
  const steps = ['Welcome', 'Bible', 'Church', 'Connect', 'Done'];
  const finish = () => dispatch({ type: 'onboard', user: { displayName: name || 'Friend', translation, interests, church: church ? { name: church.name, visible: true } : state.user.church, discoverable: disc, acceptsChat: offer } });
  return (
    <Screen title="BibleNestra" subtitle={`Step ${step + 1} of ${steps.length} · skippable`} right={<Pressable onPress={finish}><Text style={{ color: colors.muted, fontSize: 11 }}>Skip</Text></Pressable>}>
      {step === 0 ? (
        <View style={{ alignItems: 'center', marginTop: 30 }}>
          <Text style={styles.spark}>✦·</Text>
          <Text style={styles.h1}>Welcome</Text>
          <Text style={styles.sub}>One connected place for Bible study, prayer, community and care. You control what you reveal.</Text>
          <Input placeholder="What should we call you?" value={name} onChangeText={setName} style={{ marginTop: 24, alignSelf: 'stretch' }} />
        </View>
      ) : null}
      {step === 1 ? (
        <View>
          <Text style={[styles.h1, { marginTop: 20 }]}>Your Bible</Text>
          <Text style={styles.sub}>Pick a default translation. You can switch any time without losing your place.</Text>
          <Section title="Translation"><Pills small items={TRANSLATIONS.filter((t) => t.lang === 'English').map((t) => t.id)} value={translation} onChange={(t) => TRANSLATIONS.find((x) => x.id === t).available && setTranslation(t)} /><Text style={styles.cardMeta}>MSG, NIV, NLT, GNB, AMP and AMP Classic appear once licensed for your region.</Text></Section>
          <Section title="Study interests"><Pills small items={['Gospels', 'Psalms', 'Doctrine', 'Prayer', 'Worship', 'Leadership', 'Marriage', 'Parenting', 'Youth', 'Missions', 'Evangelism', 'Career', 'New believer']} value={interests} onChange={(i) => setInterests(interests.includes(i) ? interests.filter((x) => x !== i) : [...interests, i])} /></Section>
          <Section title="Reminders"><Row title="Daily devotional" right={<Toggle value onChange={() => {}} />} /><Row title="Reading reminder" right="06:30" /><Row title="Audio narration" right={<Toggle value onChange={() => {}} />} /></Section>
        </View>
      ) : null}
      {step === 2 ? (
        <View>
          <Text style={[styles.h1, { marginTop: 20 }]}>What is the name of your church?</Text>
          <Text style={styles.sub}>Optional. We will never attach you to a church just because the names are similar.</Text>
          <Input placeholder="Start typing a church or ministry name" value={churchQ} onChangeText={(t) => { setChurchQ(t); setChurch(null); }} style={{ marginTop: 18 }} />
          {matches.map((c) => <Row key={c.id} title={c.name} subtitle={`${c.location} · ${c.tradition} · ${c.members} members · ${c.join === 'auto' ? 'Joins automatically' : c.join === 'approval' ? 'Requires approval' : 'Invite only'}`} right={c.verified ? <Badge label="Verified" /> : <Tag label="Unverified" />} onPress={() => { setChurch(c); setChurchQ(c.name); }} tint={church && church.id === c.id ? colors.teal : undefined} />)}
          {churchQ.length > 1 && !matches.length ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Can't find your church?</Text>
              <View style={{ gap: 6, marginTop: 8 }}>
                <Button small kind="ghost" label="Add it for verification (no public listing yet)" onPress={() => setChurch({ id: 'manual', name: churchQ })} />
                <Button small kind="ghost" label="Invite a church administrator" />
                <Button small kind="ghost" label="Continue without joining" onPress={() => setStep(3)} />
              </View>
            </View>
          ) : null}
          {church ? <Notice tint={colors.teal} text={church.join === 'auto' ? `You'll join ${church.name} automatically.` : church.join === 'approval' ? `A membership request will be sent to ${church.name}.` : church.id === 'manual' ? `${church.name} will be reviewed before any public listing is created.` : `${church.name} is invite-only. Ask an administrator for a code.`} /> : null}
        </View>
      ) : null}
      {step === 3 ? (
        <View>
          <Text style={[styles.h1, { marginTop: 20 }]}>Connect on your terms</Text>
          <Section title="Who can discover you">{Object.keys(disc).map((k) => <Row key={k} title={k[0].toUpperCase() + k.slice(1)} right={<Toggle value={disc[k]} onChange={(v) => setDisc({ ...disc, [k]: v })} />} />)}</Section>
          <Section title="I'd like to offer or receive"><Pills small items={['Prayer', 'Mentoring', 'Encouragement', 'Bible study', 'Pastoral care', 'Counseling', 'Professional collaboration']} value={offer} onChange={(o) => setOffer(offer.includes(o) ? offer.filter((x) => x !== o) : [...offer, o])} /></Section>
          <Notice text="Sensitive answers are optional. You can change all of this later in Profile → Privacy." />
        </View>
      ) : null}
      {step === 4 ? (
        <View style={{ alignItems: 'center', marginTop: 30 }}>
          <Text style={styles.spark}>✦·</Text>
          <Text style={styles.h1}>You're set, {name || 'friend'}.</Text>
          <Text style={styles.sub}>Reading in {translation}{church ? ` · ${church.name}` : ''}. Everything here can be changed later.</Text>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 28 }}>
        {step > 0 ? <Button kind="ghost" label="Back" onPress={() => setStep(step - 1)} /> : null}
        <Button label={step === steps.length - 1 ? 'Start' : 'Continue'} style={{ flex: 1 }} onPress={() => (step === steps.length - 1 ? finish() : setStep(step + 1))} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 16, marginTop: 12 },
  cardTitle: { fontFamily: fonts.sansMedium, fontSize: 14.5, fontWeight: '600', color: colors.fg },
  cardMeta: { fontFamily: fonts.sans, fontSize: 11, color: colors.muted, marginTop: 4 },
  cardBody: { fontFamily: fonts.sans, fontSize: 12.5, color: colors.passage, lineHeight: 18, marginTop: 8 },
  bar: { height: 4, backgroundColor: colors.raised, borderRadius: 2, marginTop: 10, overflow: 'hidden' },
  barFill: { height: 4, backgroundColor: colors.gold, borderRadius: 2 },
  label: { fontFamily: fonts.sans, fontSize: 11, color: colors.muted, marginTop: 6 },
  player: { height: 180, backgroundColor: colors.surface, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 12, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
  recTime: { fontFamily: fonts.sansMedium, fontSize: 34, fontWeight: '700', color: colors.fg, textAlign: 'center', fontVariant: ['tabular-nums'] },
  wave: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, height: 36, marginTop: 10 },
  waveBar: { width: 3, borderRadius: 1.5, backgroundColor: colors.gold },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  h1: { fontFamily: fonts.sansMedium, fontSize: 21, fontWeight: '600', color: colors.fg, textAlign: 'center', letterSpacing: -0.3 },
  sub: { fontFamily: fonts.sans, fontSize: 12.5, color: colors.muted, marginTop: 5, textAlign: 'center', lineHeight: 18 },
  spark: { fontSize: 14, color: colors.gold, letterSpacing: 1 },
  statBox: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center', minWidth: 90 },
  statValue: { fontFamily: fonts.serifBold, fontSize: 16, color: colors.fg },
  statLabel: { fontFamily: fonts.sans, fontSize: 10, color: colors.muted, marginTop: 2 },
});
