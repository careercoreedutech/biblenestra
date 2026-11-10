// CONTEST CENTRE for organizers and judges: my contests, create a contest (with AI question drafts to review),
// manage (participants, entries, judges, sponsors, reports, publish), and the judging screen.
// Organizer contests wait for admin approval; admins publish directly. Payments are not enabled.
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Screen, Section, Button, Empty, Notice, Pills } from '../components/ui';
import { Icon } from '../components/Icons';
import { PressScale } from '../components/Motion';
import { SocialAvatar } from '../components/social/FeedCard';
import { colors, fonts, radius } from '../theme';
import { useNav, useIsFocused } from '../navigation';
import { useToast } from '../components/Toast';
import { useApi } from '../api/auth';
import { errorMessage } from '../api/client';
import { pickPhotos, uploadImage } from '../api/media';
import { ContestCard, STATUS } from './ContestsScreens';

const HOUR = 3600000;
const START_PRESETS = [['Now', 0], ['In 1 hour', HOUR], ['Tomorrow', 24 * HOUR], ['In 3 days', 72 * HOUR], ['In a week', 168 * HOUR]];
const LENGTH_PRESETS = [['1 hour', HOUR], ['1 day', 24 * HOUR], ['3 days', 72 * HOUR], ['1 week', 168 * HOUR], ['2 weeks', 336 * HOUR], ['1 month', 720 * HOUR]];
const VOTING_PRESETS = [['2 days', 48 * HOUR], ['3 days', 72 * HOUR], ['1 week', 168 * HOUR]];

function Field({ label, children, hint }) {
  return <View style={{ marginTop: 12 }}><Text style={styles.label}>{label}</Text>{children}{hint ? <Text style={styles.fine}>{hint}</Text> : null}</View>;
}
function Check({ on, onPress, label }) {
  return (
    <Pressable onPress={onPress} style={styles.checkRow} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
      <View style={[styles.box, on && styles.boxOn]}>{on ? <Icon name="check" size={12} color="#FFFFFF" strokeWidth={3} /> : null}</View>
      <Text style={styles.checkText}>{label}</Text>
    </Pressable>
  );
}

// ---------- my contests ----------
export function ContestOrganizeScreen() {
  const api = useApi();
  const nav = useNav();
  const focused = useIsFocused();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!focused) return;
    api.request('GET', '/organizer/contests').then((r) => setItems(r.items || [])).catch((e) => setError(errorMessage(e, 'Organizer access needed')));
  }, [api, focused]);
  return (
    <Screen back title="Organize contests" subtitle="Create and run contests for your church or community">
      {error ? <Notice tint={colors.negative} text={`${error}. Ask the BibleNestra team to make you an organizer.`} /> : null}
      {items ? <Button label="Create a contest" icon={<Icon name="plus" size={14} color="#FFFFFF" />} onPress={() => nav.push('ContestEditor')} style={{ marginTop: 12 }} /> : null}
      {items && !items.length ? <Empty title="No contests yet" body="Create your first contest. It goes live once an admin approves it." /> : null}
      {!items && !error ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View> : null}
      {(items || []).map((c, i) => <ContestCard key={c.id} c={c} index={i} onPress={() => nav.push('ContestManage', { id: c.id })} />)}
    </Screen>
  );
}

// ---------- create ----------
export function ContestEditorScreen() {
  const api = useApi();
  const nav = useNav();
  const toast = useToast();
  const [cats, setCats] = useState([]);
  const [topics, setTopics] = useState({});
  const [f, setF] = useState({
    contestCategory: 'bible_knowledge', title: '', description: '', category: 'mixed', questionCount: '10', secondsPerQuestion: '20',
    coins: ['300', '150', '75'], prizeText: '', start: 0, length: 72 * HOUR, voting: 72 * HOUR, scoring: null, votingEnabled: true, judgeWeight: '70',
    rules: '', eligibility: '', submissionRequirements: '', judgingCriteria: '', participantLimit: '', countries: '', certificatesFor: 'winners', allowEdits: true, bannerUrl: null, bannerPreview: null,
  });
  const [ai, setAi] = useState({ book: 'Genesis', difficulty: 'medium', count: '5', busy: false });
  const [custom, setCustom] = useState([]);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => { api.request('GET', '/contests/categories').then((r) => { setCats(r.items || []); setTopics(r.topics || {}); }).catch(() => {}); }, [api]);
  const cat = cats.find((x) => x.id === f.contestCategory) || { format: 'quiz', scoring: 'skill', kinds: [] };
  const isQuiz = cat.format === 'quiz';
  const scoring = f.scoring || cat.scoring;

  const draftQuestions = async () => {
    setAi((a) => ({ ...a, busy: true }));
    try {
      const r = await api.request('POST', '/contests/ai-questions', { book: ai.book, difficulty: ai.difficulty, count: Number(ai.count) || 5 });
      setCustom((list) => [...list, ...r.items.map((x) => ({ ...x, keep: true }))]);
      toast.show(`${r.items.length} draft questions added — check each one`, { icon: 'sparkles' });
    } catch (e) { toast.show(errorMessage(e, 'Couldn’t draft questions'), { tone: 'error', icon: 'x' }); }
    setAi((a) => ({ ...a, busy: false }));
  };
  const banner = async () => {
    try { const [p] = await pickPhotos(1); if (!p) return; const r = await uploadImage(api.request, p); set('bannerUrl', r.key); set('bannerPreview', p.uri); }
    catch (e) { toast.show(errorMessage(e, 'Upload failed'), { tone: 'error' }); }
  };
  const save = async () => {
    setSaving(true);
    const startsAt = new Date(Date.now() + f.start);
    const endsAt = new Date(startsAt.getTime() + f.length);
    const kept = custom.filter((x) => x.keep);
    const payload = {
      contestCategory: f.contestCategory, title: f.title.trim(), description: f.description.trim(), prizeText: f.prizeText.trim(),
      prizeCoins: f.coins.map((x) => Number(x) || 0), startsAt: f.start ? startsAt.toISOString() : undefined, endsAt: endsAt.toISOString(),
      rules: f.rules, eligibility: f.eligibility, certificatesFor: f.certificatesFor, bannerUrl: f.bannerUrl || undefined,
      participantLimit: f.participantLimit ? Number(f.participantLimit) : undefined,
      eligibleCountries: f.countries.split(',').map((x) => x.trim()).filter(Boolean),
    };
    if (isQuiz) {
      Object.assign(payload, { category: f.category, questionCount: Number(f.questionCount) || 10, secondsPerQuestion: Number(f.secondsPerQuestion) || 20 });
      if (kept.length) payload.customQuestions = kept.map((x) => ({ question: x.question, options: x.options, correctIndex: x.correctIndex, reference: x.reference }));
    } else {
      Object.assign(payload, { scoring, votingEnabled: scoring === 'popularity' ? true : f.votingEnabled, judgeWeight: Number(f.judgeWeight), submissionRequirements: f.submissionRequirements,
        judgingCriteria: f.judgingCriteria, allowEdits: f.allowEdits, votingEndsAt: new Date(endsAt.getTime() + f.voting).toISOString() });
    }
    try {
      const c = await api.request('POST', '/contests', payload);
      toast.show(c.status === 'pending_approval' ? 'Sent for approval' : 'Contest published', { icon: 'check', haptic: 'success' });
      nav.replace('ContestManage', { id: c.id });
    } catch (e) { toast.show(errorMessage(e, 'Couldn’t create the contest'), { tone: 'error', icon: 'x' }); }
    setSaving(false);
  };

  return (
    <Screen back title="New contest">
      <Field label="Type of contest">
        <Pills small items={cats.map((x) => x.label)} value={cat.label} onChange={(l) => { const c = cats.find((x) => x.label === l); if (c) setF((x) => ({ ...x, contestCategory: c.id, scoring: null })); }} />
        {cat.description ? <Text style={styles.fine}>{cat.description}</Text> : null}
      </Field>
      <Field label="Title"><TextInput value={f.title} onChangeText={(v) => set('title', v)} maxLength={100} placeholder="e.g. Easter Bible Challenge" placeholderTextColor={colors.faint} style={styles.input} /></Field>
      <Field label="Description"><TextInput value={f.description} onChangeText={(v) => set('description', v)} maxLength={2000} multiline placeholder="What is this contest about?" placeholderTextColor={colors.faint} style={[styles.input, { minHeight: 70 }]} /></Field>
      <Field label="Banner (optional)">
        <Button kind="ghost" small label={f.bannerUrl ? 'Change banner' : 'Upload banner'} icon={<Icon name="image" size={14} color={colors.primary} />} onPress={banner} />
        {f.bannerPreview ? <Text style={styles.ok}>✓ Banner uploaded</Text> : null}
      </Field>

      {isQuiz ? (
        <Section title="Questions">
          <Field label="Question topic (from the BibleNestra bank)">
            <Pills small items={Object.values(topics)} value={topics[f.category]} onChange={(l) => set('category', Object.keys(topics).find((k) => topics[k] === l))} />
          </Field>
          <View style={styles.two}>
            <Field label="Questions"><TextInput value={f.questionCount} onChangeText={(v) => set('questionCount', v.replace(/\D/g, ''))} keyboardType="number-pad" style={styles.input} /></Field>
            <Field label="Seconds each"><TextInput value={f.secondsPerQuestion} onChangeText={(v) => set('secondsPerQuestion', v.replace(/\D/g, ''))} keyboardType="number-pad" style={styles.input} /></Field>
          </View>
          <View style={styles.aiBox}>
            <Text style={styles.aiTitle}>✦ AI question drafts</Text>
            <Text style={styles.fine}>Generate questions from a Bible book, then check every one. Unticked drafts are ignored. If you keep any, they replace the bank questions.</Text>
            <View style={styles.two}>
              <Field label="Book"><TextInput value={ai.book} onChangeText={(v) => setAi((a) => ({ ...a, book: v }))} style={styles.input} /></Field>
              <Field label="How many"><TextInput value={ai.count} onChangeText={(v) => setAi((a) => ({ ...a, count: v.replace(/\D/g, '') }))} keyboardType="number-pad" style={styles.input} /></Field>
            </View>
            <Pills small items={['easy', 'medium', 'hard']} value={ai.difficulty} onChange={(v) => setAi((a) => ({ ...a, difficulty: v }))} style={{ marginTop: 8 }} />
            <Button small label={ai.busy ? 'Drafting…' : 'Draft questions'} disabled={ai.busy} onPress={draftQuestions} style={{ marginTop: 10 }} />
          </View>
          {custom.map((x, i) => (
            <View key={i} style={[styles.draft, !x.keep && { opacity: 0.5 }]}>
              <Check on={x.keep} onPress={() => setCustom((l) => l.map((y, j) => (j === i ? { ...y, keep: !y.keep } : y)))} label={`${i + 1}. ${x.question}`} />
              {x.options.map((o, k) => (
                <Pressable key={k} onPress={() => setCustom((l) => l.map((y, j) => (j === i ? { ...y, correctIndex: k } : y)))} accessibilityRole="radio" accessibilityState={{ selected: x.correctIndex === k }}>
                  <Text style={[styles.draftOpt, x.correctIndex === k && { color: colors.positive, fontWeight: '700' }]}>{x.correctIndex === k ? '✓ ' : '   '}{o}</Text>
                </Pressable>
              ))}
              {x.reference ? <Text style={styles.ref}>{x.reference}</Text> : null}
            </View>
          ))}
          {custom.length ? <Text style={styles.fine}>{custom.filter((x) => x.keep).length} questions kept. You need at least {f.questionCount || 10}. Tap an option to mark the right answer.</Text> : null}
        </Section>
      ) : (
        <Section title="Entries and scoring">
          <Text style={styles.fine}>Accepted: {(cat.kinds || []).join(', ')}</Text>
          <Field label="How winners are chosen">
            <Pills small items={['Judges', 'Community votes']} value={scoring === 'judged' ? 'Judges' : 'Community votes'} onChange={(l) => set('scoring', l === 'Judges' ? 'judged' : 'popularity')} />
          </Field>
          {scoring === 'judged' ? (
            <View>
              <Check on={f.votingEnabled} onPress={() => set('votingEnabled', !f.votingEnabled)} label="Also let the community vote (free, one vote each)" />
              {f.votingEnabled ? <Field label="Judges’ share of the score (%)" hint="The rest comes from votes."><TextInput value={f.judgeWeight} onChangeText={(v) => set('judgeWeight', v.replace(/\D/g, ''))} keyboardType="number-pad" style={styles.input} /></Field> : null}
              <Field label="Judging criteria"><TextInput value={f.judgingCriteria} onChangeText={(v) => set('judgingCriteria', v)} multiline placeholder="e.g. Faithfulness to scripture 40%, creativity 30%, quality 30%" placeholderTextColor={colors.faint} style={[styles.input, { minHeight: 60 }]} /></Field>
            </View>
          ) : null}
          <Field label="What should people submit?"><TextInput value={f.submissionRequirements} onChangeText={(v) => set('submissionRequirements', v)} multiline placeholder="e.g. A 2-minute song based on a Psalm" placeholderTextColor={colors.faint} style={[styles.input, { minHeight: 60 }]} /></Field>
          <Check on={f.allowEdits} onPress={() => set('allowEdits', !f.allowEdits)} label="Let people edit their entry until the deadline" />
        </Section>
      )}

      <Section title="Dates">
        <Field label="Starts"><Pills small items={START_PRESETS.map((x) => x[0])} value={(START_PRESETS.find((x) => x[1] === f.start) || [])[0]} onChange={(l) => set('start', START_PRESETS.find((x) => x[0] === l)[1])} /></Field>
        <Field label={isQuiz ? 'Runs for' : 'Entries open for'}><Pills small items={LENGTH_PRESETS.map((x) => x[0])} value={(LENGTH_PRESETS.find((x) => x[1] === f.length) || [])[0]} onChange={(l) => set('length', LENGTH_PRESETS.find((x) => x[0] === l)[1])} /></Field>
        {!isQuiz && (scoring === 'popularity' || f.votingEnabled) ? <Field label="Voting lasts"><Pills small items={VOTING_PRESETS.map((x) => x[0])} value={(VOTING_PRESETS.find((x) => x[1] === f.voting) || [])[0]} onChange={(l) => set('voting', VOTING_PRESETS.find((x) => x[0] === l)[1])} /></Field> : null}
      </Section>

      <Section title="Prizes">
        <Text style={styles.fine}>Coins for 1st, 2nd, 3rd (leave 0 for none). Describe any other prize below.</Text>
        <View style={styles.two}>
          {f.coins.map((v, i) => <Field key={i} label={['1st', '2nd', '3rd'][i]}><TextInput value={v} onChangeText={(t) => set('coins', f.coins.map((x, j) => (j === i ? t.replace(/\D/g, '') : x)))} keyboardType="number-pad" style={styles.input} /></Field>)}
        </View>
        <Field label="Other prize (optional)"><TextInput value={f.prizeText} onChangeText={(v) => set('prizeText', v)} maxLength={200} placeholder="e.g. A study Bible for the winner" placeholderTextColor={colors.faint} style={styles.input} /></Field>
        <Check on={f.certificatesFor === 'all'} onPress={() => set('certificatesFor', f.certificatesFor === 'all' ? 'winners' : 'all')} label="Give every participant a certificate (winners always get one)" />
      </Section>

      <Section title="Rules and eligibility">
        <Field label="Rules"><TextInput value={f.rules} onChangeText={(v) => set('rules', v)} multiline style={[styles.input, { minHeight: 70 }]} /></Field>
        <Field label="Who can enter"><TextInput value={f.eligibility} onChangeText={(v) => set('eligibility', v)} placeholder="e.g. Youth aged 13–25" placeholderTextColor={colors.faint} style={styles.input} /></Field>
        <View style={styles.two}>
          <Field label="Participant limit"><TextInput value={f.participantLimit} onChangeText={(v) => set('participantLimit', v.replace(/\D/g, ''))} keyboardType="number-pad" placeholder="No limit" placeholderTextColor={colors.faint} style={styles.input} /></Field>
          <Field label="Countries (comma separated)"><TextInput value={f.countries} onChangeText={(v) => set('countries', v)} placeholder="Everywhere" placeholderTextColor={colors.faint} style={styles.input} /></Field>
        </View>
        <Notice text="Entry is free. Paid entry and paid votes aren’t available yet." />
      </Section>
      <Button label={saving ? 'Saving…' : 'Create contest'} disabled={saving || f.title.trim().length < 3} onPress={save} style={{ marginTop: 18 }} />
      <Text style={styles.fine}>Organizer contests go live after a BibleNestra admin approves them.</Text>
    </Screen>
  );
}

// ---------- manage ----------
export function ContestManageScreen({ params = {} }) {
  const api = useApi();
  const nav = useNav();
  const toast = useToast();
  const focused = useIsFocused();
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [people, setPeople] = useState([]);
  const [sponsor, setSponsor] = useState({ name: '', linkUrl: '', contribution: '' });
  const load = useCallback(async () => {
    try { setD(await api.request('GET', `/contests/${params.id}/manage`)); setError(null); } catch (e) { setError(errorMessage(e, 'Couldn’t load')); }
  }, [api, params.id]);
  useEffect(() => { if (focused) load(); }, [load, focused]);
  useEffect(() => {
    if (q.trim().length < 2) { setPeople([]); return undefined; }
    const t = setTimeout(() => api.request('GET', `/people?q=${encodeURIComponent(q.trim())}`).then((r) => setPeople((r.items || []).slice(0, 5))).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [q, api]);
  const run = async (method, path, b, msg) => {
    try { await api.request(method, path, b); if (msg) toast.show(msg, { icon: 'check' }); load(); return true; }
    catch (e) { toast.show(errorMessage(e, 'Couldn’t do that'), { tone: 'error', icon: 'x' }); return false; }
  };
  if (!d) return <Screen back title="Manage contest">{error ? <Notice tint={colors.negative} text={error} /> : <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View>}</Screen>;
  const c = d.contest;
  const base = `/contests/${c.id}`;
  const settled = c.status === 'completed';
  const s = STATUS[c.status] || {};
  return (
    <Screen back title={c.title} subtitle={`Manage · ${s.label || c.status}`}>
      <View style={styles.stats}>
        {[['Registered', d.registrations.length], ['Entries', c.format === 'quiz' ? c.participants : d.submissions.length], ['Votes', d.votes ? d.votes.valid : 0], ['Reports', d.disputes.filter((x) => x.status === 'open').length]].map(([k, v]) => (
          <View key={k} style={styles.stat}><Text style={styles.statNum}>{v}</Text><Text style={styles.statLabel}>{k}</Text></View>
        ))}
      </View>
      <Notice text="Revenue: paid entry and paid votes aren’t enabled, so there’s nothing to pay out." />
      <View style={styles.actions}>
        <Button kind="ghost" small label="Open player view" onPress={() => nav.push('Contest', { id: c.id })} />
        {!settled && c.status !== 'cancelled' ? (c.paused
          ? <Button kind="ghost" small label="Resume" onPress={() => run('POST', `${base}/resume`, undefined, 'Resumed')} />
          : <Button kind="ghost" small label="Pause" onPress={() => run('POST', `${base}/pause`, undefined, 'Paused')} />) : null}
        {!settled && ['voting_open', 'judging'].includes(c.status) && c.format === 'submission' ? <Button small label="Publish results" onPress={() => run('POST', `${base}/publish`, undefined, 'Results published')} /> : null}
        {!settled && c.status !== 'cancelled' ? <Button kind="danger" small label="Cancel contest" onPress={() => run('POST', `${base}/cancel`, undefined, 'Contest cancelled')} /> : null}
      </View>

      {c.format === 'submission' ? (
        <Section title={`Entries (${d.submissions.length})`}>
          {!d.submissions.length ? <Text style={styles.muted}>No entries yet.</Text> : null}
          {d.submissions.map((x) => (
            <View key={x.id} style={styles.row}>
              <SocialAvatar name={x.user ? x.user.displayName : '?'} uri={x.user && x.user.avatarUrl} size={34} />
              <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => nav.push('ContestEntry', { id: x.id })}>
                <Text style={styles.name} numberOfLines={1}>{x.title}</Text>
                <Text style={styles.meta} numberOfLines={1}>{x.user ? x.user.displayName : ''} · {x.kind} · {x.votes || 0} votes{x.judgeAverage !== null ? ` · judges ${x.judgeAverage} (${x.judgeCount})` : ''}{x.disqualified ? ' · DISQUALIFIED' : ''}</Text>
              </Pressable>
              {!settled && x.user ? <Button kind="ghost" small label={x.disqualified ? 'Reinstate' : 'Disqualify'} onPress={() => run('POST', `${base}/disqualify`, { userId: x.user.id, reason: x.disqualified ? 'Reinstated by organizer' : 'Breaks the contest rules', disqualified: !x.disqualified }, x.disqualified ? 'Reinstated' : 'Disqualified')} /> : null}
            </View>
          ))}
        </Section>
      ) : null}

      <Section title={`Participants (${d.registrations.length})`}>
        {!d.registrations.length ? <Text style={styles.muted}>Nobody has registered yet.</Text> : null}
        {d.registrations.slice(0, 100).map((r) => (
          <View key={r.user.id} style={styles.row}>
            <SocialAvatar name={r.user.displayName} uri={r.user.avatarUrl} size={30} />
            <Text style={[styles.name, { flex: 1 }]} numberOfLines={1}>{r.user.displayName}{r.church ? ` · ${r.church}` : ''}{r.disqualified ? ' · disqualified' : ''}</Text>
            {!settled && c.format === 'quiz' ? <Button kind="ghost" small label={r.disqualified ? 'Reinstate' : 'Disqualify'} onPress={() => run('POST', `${base}/disqualify`, { userId: r.user.id, reason: r.disqualified ? 'Reinstated by organizer' : 'Breaks the contest rules', disqualified: !r.disqualified })} /> : null}
          </View>
        ))}
      </Section>

      {c.format === 'submission' ? (
        <Section title="Judges">
          {d.judges.map((j) => (
            <View key={j.id} style={styles.row}>
              <SocialAvatar name={j.displayName} uri={j.avatarUrl} size={30} />
              <Text style={[styles.name, { flex: 1 }]}>{j.displayName}</Text>
              {!settled ? <Button kind="ghost" small label="Remove" onPress={() => run('DELETE', `${base}/judges/${j.id}`, undefined, 'Judge removed')} /> : null}
            </View>
          ))}
          {!settled ? (
            <View>
              <TextInput value={q} onChangeText={setQ} placeholder="Add a judge: search by name" placeholderTextColor={colors.faint} style={styles.input} />
              {people.map((u) => (
                <View key={u.id} style={styles.row}>
                  <SocialAvatar name={u.displayName} uri={u.avatarUrl} size={30} />
                  <Text style={[styles.name, { flex: 1 }]} numberOfLines={1}>{u.displayName}</Text>
                  <Button small label="Add" onPress={async () => { if (await run('POST', `${base}/judges`, { userIds: [u.id] }, 'Judge added')) setQ(''); }} />
                </View>
              ))}
            </View>
          ) : null}
        </Section>
      ) : null}

      <Section title="Sponsors">
        {d.sponsors.map((sp) => <Text key={sp.id} style={styles.body}>• {sp.name}{sp.contribution ? ` — ${sp.contribution}` : ''}{sp.approved ? '' : ' (awaiting admin approval)'}</Text>)}
        {!settled ? (
          <View>
            <TextInput value={sponsor.name} onChangeText={(v) => setSponsor((x) => ({ ...x, name: v }))} placeholder="Sponsor name" placeholderTextColor={colors.faint} style={styles.input} />
            <TextInput value={sponsor.contribution} onChangeText={(v) => setSponsor((x) => ({ ...x, contribution: v }))} placeholder="What they give (optional)" placeholderTextColor={colors.faint} style={styles.input} />
            <TextInput value={sponsor.linkUrl} onChangeText={(v) => setSponsor((x) => ({ ...x, linkUrl: v }))} placeholder="https:// link (optional)" autoCapitalize="none" placeholderTextColor={colors.faint} style={styles.input} />
            <Button small label="Add sponsor" disabled={sponsor.name.trim().length < 2} onPress={async () => { if (await run('POST', `${base}/sponsors`, { name: sponsor.name.trim(), contribution: sponsor.contribution.trim(), linkUrl: sponsor.linkUrl.trim() || undefined }, 'Sponsor added')) setSponsor({ name: '', linkUrl: '', contribution: '' }); }} style={{ marginTop: 8 }} />
          </View>
        ) : null}
      </Section>

      <Section title="Reports and appeals">
        {!d.disputes.length ? <Text style={styles.muted}>No reports.</Text> : null}
        {d.disputes.map((x) => (
          <View key={x.id} style={styles.dispute}>
            <Text style={styles.name}>{x.user.displayName} · {x.status}</Text>
            <Text style={styles.body}>{x.reason}</Text>
            {x.resolution ? <Text style={styles.meta}>Resolution: {x.resolution}</Text> : null}
          </View>
        ))}
        <Text style={styles.fine}>Reports are resolved by the BibleNestra team.</Text>
      </Section>
    </Screen>
  );
}

// ---------- judging ----------
function ScoreCard({ s, mine, onSave }) {
  const nav = useNav();
  const [score, setScore] = useState(mine ? String(mine.score) : '');
  const [comment, setComment] = useState(mine ? mine.comment || '' : '');
  return (
    <View style={styles.dispute}>
      <Pressable onPress={() => nav.push('ContestEntry', { id: s.id })} accessibilityRole="button">
        <Text style={styles.name}>{s.title}</Text>
        <Text style={styles.meta}>{s.user ? s.user.displayName : ''} · {s.kind} · tap to view</Text>
      </Pressable>
      <View style={styles.two}>
        <TextInput value={score} onChangeText={(v) => setScore(v.replace(/\D/g, '').slice(0, 3))} keyboardType="number-pad" placeholder="0–100" placeholderTextColor={colors.faint} style={[styles.input, { width: 90 }]} accessibilityLabel="Score out of 100" />
        <TextInput value={comment} onChangeText={setComment} placeholder="Comment (optional)" placeholderTextColor={colors.faint} style={[styles.input, { flex: 1 }]} />
      </View>
      <Button small label={mine ? 'Update score' : 'Save score'} disabled={score === '' || Number(score) > 100} onPress={() => onSave(s, Number(score), comment)} style={{ marginTop: 8 }} />
    </View>
  );
}
export function ContestJudgeScreen({ params = {} }) {
  const api = useApi();
  const nav = useNav();
  const toast = useToast();
  const [list, setList] = useState(null);
  const [data, setData] = useState(null);
  const load = useCallback(async () => {
    try {
      if (!params.id) { setList((await api.request('GET', '/judging')).items || []); return; }
      const [c, subs, mine] = await Promise.all([api.request('GET', `/contests/${params.id}`), api.request('GET', `/contests/${params.id}/submissions`), api.request('GET', `/contests/${params.id}/my-scores`)]);
      setData({ c, subs: subs.items || [], mine: Object.fromEntries((mine.items || []).map((x) => [x.submissionId, x])) });
    } catch (e) { toast.show(errorMessage(e, 'Couldn’t load'), { tone: 'error' }); }
  }, [api, params.id]);
  useEffect(() => { load(); }, [load]);
  if (!params.id) {
    return (
      <Screen back title="Judging">
        {!list ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View> : null}
        {list && !list.length ? <Empty title="Nothing to judge" body="Organizers can invite you to judge their contests." /> : null}
        {(list || []).map((c, i) => <ContestCard key={c.id} c={c} index={i} onPress={() => nav.push('ContestJudge', { id: c.id })} />)}
      </Screen>
    );
  }
  if (!data) return <Screen back title="Judging"><View style={styles.loading}><ActivityIndicator color={colors.primary} /></View></Screen>;
  const open = ['voting_open', 'judging'].includes(data.c.status);
  const save = async (s, score, comment) => {
    try { await api.request('POST', `/contests/${data.c.id}/scores/${s.id}`, { score, comment }); toast.show('Score saved', { icon: 'check' }); load(); }
    catch (e) { toast.show(errorMessage(e, 'Couldn’t save'), { tone: 'error', icon: 'x' }); }
  };
  const done = Object.keys(data.mine).length;
  return (
    <Screen back title="Judging" subtitle={data.c.title}>
      {data.c.judgingCriteria ? <Notice text={`Criteria: ${data.c.judgingCriteria}`} /> : null}
      {!open ? <Notice tint={colors.amber} text={data.c.status === 'completed' ? 'Results are published; scores are final.' : 'Judging opens when submissions close.'} /> : null}
      <Text style={styles.muted}>{done} of {data.subs.length} entries scored. Score each entry from 0 to 100. Other judges can’t see your scores.</Text>
      {open ? data.subs.filter((s) => !s.mine).map((s) => <ScoreCard key={s.id} s={s} mine={data.mine[s.id]} onSave={save} />) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: 24, alignItems: 'center' },
  label: { fontSize: 12.5, fontWeight: '700', color: colors.muted, marginBottom: 4 },
  fine: { marginTop: 6, fontSize: 12, lineHeight: 17, color: colors.faint },
  muted: { marginTop: 8, fontSize: 13, lineHeight: 18, color: colors.muted },
  body: { marginTop: 4, fontSize: 14, lineHeight: 20, color: colors.passage },
  ok: { marginTop: 6, fontSize: 13, fontWeight: '700', color: colors.positive },
  input: { marginTop: 6, borderRadius: radius.md, backgroundColor: colors.raised, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.fg },
  two: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 12 },
  box: { width: 20, height: 20, borderRadius: 6, borderWidth: 2, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  boxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkText: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.fg },
  aiBox: { marginTop: 14, padding: 14, borderRadius: radius.lg, backgroundColor: colors.cardLavender },
  aiTitle: { fontFamily: fonts.serifBold, fontSize: 16, color: colors.fg },
  draft: { marginTop: 10, padding: 12, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  draftOpt: { marginTop: 6, marginLeft: 30, fontSize: 13.5, color: colors.fg },
  ref: { marginTop: 6, marginLeft: 30, fontSize: 12, fontWeight: '700', color: colors.gold },
  stats: { flexDirection: 'row', gap: 8, marginTop: 12 },
  stat: { flex: 1, padding: 12, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  statNum: { fontFamily: fonts.serifBold, fontSize: 22, color: colors.fg },
  statLabel: { fontSize: 11.5, color: colors.muted },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  name: { fontSize: 14, fontWeight: '600', color: colors.fg },
  meta: { marginTop: 1, fontSize: 12, color: colors.muted },
  dispute: { marginTop: 8, padding: 12, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
});
