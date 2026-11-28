import { isDarkScheme } from '../design/palette';
// CONTEST CENTRE for organizers and judges: my contests, create a contest (with AI question drafts to review),
// manage (participants, entries, judges, sponsors, reports, publish), and the judging screen.
// Organizer contests wait for admin approval; admins publish directly. Payments are not enabled.
// Look: the design's Contest Centre pages (paper cards, plum actions, ivory sheets) on the design kit.
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Empty, Notice } from '../components/ui';
import { Icon } from '../components/Icons';
import { SocialAvatar } from '../components/social/FeedCard';
import { colors } from '../theme';
import { useNav, useIsFocused } from '../navigation';
import { useToast } from '../components/Toast';
import { useApi } from '../api/auth';
import { errorMessage } from '../api/client';
import { pickPhotos, uploadImage } from '../api/media';
import { ContestCard, STATUS } from './ContestsScreens';
import { d as tok, df } from '../design/sanctuary';
import { DInput } from '../design/profile/parts';
import { Screen, Section, Button, Pills } from '../design/contests/parts';

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
      {!items && !error ? <View style={styles.loading}><ActivityIndicator color={tok.plum} /></View> : null}
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
  const set = (key, v) => setF((x) => ({ ...x, [key]: v }));
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
        <Pills items={cats.map((x) => x.label)} value={cat.label} onChange={(l) => { const c = cats.find((x) => x.label === l); if (c) setF((x) => ({ ...x, contestCategory: c.id, scoring: null })); }} />
        {cat.description ? <Text style={styles.fine}>{cat.description}</Text> : null}
      </Field>
      <Field label="Title"><DInput value={f.title} onChangeText={(v) => set('title', v)} maxLength={100} placeholder="e.g. Easter Bible Challenge" /></Field>
      <Field label="Description"><DInput value={f.description} onChangeText={(v) => set('description', v)} maxLength={2000} multiline placeholder="What is this contest about?" style={{ minHeight: 70 }} /></Field>
      <Field label="Banner (optional)">
        <Button kind="ghost" label={f.bannerUrl ? 'Change banner' : 'Upload banner'} icon={<Icon name="image" size={14} color={tok.plum} />} onPress={banner} />
        {f.bannerPreview ? <Text style={styles.ok}>✓ Banner uploaded</Text> : null}
      </Field>

      {isQuiz ? (
        <Section title="Questions">
          <Field label="Question topic (from the BibleNestra bank)">
            <Pills items={Object.values(topics)} value={topics[f.category]} onChange={(l) => set('category', Object.keys(topics).find((key) => topics[key] === l))} />
          </Field>
          <View style={styles.two}>
            <Field label="Questions"><DInput value={f.questionCount} onChangeText={(v) => set('questionCount', v.replace(/\D/g, ''))} keyboardType="number-pad" /></Field>
            <Field label="Seconds each"><DInput value={f.secondsPerQuestion} onChangeText={(v) => set('secondsPerQuestion', v.replace(/\D/g, ''))} keyboardType="number-pad" /></Field>
          </View>
          <View style={styles.aiBox}>
            <Text style={styles.aiTitle}>✦ AI question drafts</Text>
            <Text style={styles.fine}>Generate questions from a Bible book, then check every one. Unticked drafts are ignored. If you keep any, they replace the bank questions.</Text>
            <View style={styles.two}>
              <Field label="Book"><DInput value={ai.book} onChangeText={(v) => setAi((a) => ({ ...a, book: v }))} /></Field>
              <Field label="How many"><DInput value={ai.count} onChangeText={(v) => setAi((a) => ({ ...a, count: v.replace(/\D/g, '') }))} keyboardType="number-pad" /></Field>
            </View>
            <Pills items={['easy', 'medium', 'hard']} value={ai.difficulty} onChange={(v) => setAi((a) => ({ ...a, difficulty: v }))} style={{ marginTop: 8 }} />
            <Button small label={ai.busy ? 'Drafting…' : 'Draft questions'} disabled={ai.busy} onPress={draftQuestions} style={{ marginTop: 10 }} />
          </View>
          {custom.map((x, i) => (
            <View key={i} style={[styles.draft, !x.keep && { opacity: 0.5 }]}>
              <Check on={x.keep} onPress={() => setCustom((l) => l.map((y, j) => (j === i ? { ...y, keep: !y.keep } : y)))} label={`${i + 1}. ${x.question}`} />
              {x.options.map((o, key) => (
                <Pressable key={key} onPress={() => setCustom((l) => l.map((y, j) => (j === i ? { ...y, correctIndex: key } : y)))} accessibilityRole="radio" accessibilityState={{ selected: x.correctIndex === key }}>
                  <Text style={[styles.draftOpt, x.correctIndex === key && { color: colors.positive, fontFamily: df.sansBold }]}>{x.correctIndex === key ? '✓ ' : '   '}{o}</Text>
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
            <Pills items={['Judges', 'Community votes']} value={scoring === 'judged' ? 'Judges' : 'Community votes'} onChange={(l) => set('scoring', l === 'Judges' ? 'judged' : 'popularity')} />
          </Field>
          {scoring === 'judged' ? (
            <View>
              <Check on={f.votingEnabled} onPress={() => set('votingEnabled', !f.votingEnabled)} label="Also let the community vote (free, one vote each)" />
              {f.votingEnabled ? <Field label="Judges’ share of the score (%)" hint="The rest comes from votes."><DInput value={f.judgeWeight} onChangeText={(v) => set('judgeWeight', v.replace(/\D/g, ''))} keyboardType="number-pad" /></Field> : null}
              <Field label="Judging criteria"><DInput value={f.judgingCriteria} onChangeText={(v) => set('judgingCriteria', v)} multiline placeholder="e.g. Faithfulness to scripture 40%, creativity 30%, quality 30%" style={{ minHeight: 60 }} /></Field>
            </View>
          ) : null}
          <Field label="What should people submit?"><DInput value={f.submissionRequirements} onChangeText={(v) => set('submissionRequirements', v)} multiline placeholder="e.g. A 2-minute song based on a Psalm" style={{ minHeight: 60 }} /></Field>
          <Check on={f.allowEdits} onPress={() => set('allowEdits', !f.allowEdits)} label="Let people edit their entry until the deadline" />
        </Section>
      )}

      <Section title="Dates">
        <Field label="Starts"><Pills items={START_PRESETS.map((x) => x[0])} value={(START_PRESETS.find((x) => x[1] === f.start) || [])[0]} onChange={(l) => set('start', START_PRESETS.find((x) => x[0] === l)[1])} /></Field>
        <Field label={isQuiz ? 'Runs for' : 'Entries open for'}><Pills items={LENGTH_PRESETS.map((x) => x[0])} value={(LENGTH_PRESETS.find((x) => x[1] === f.length) || [])[0]} onChange={(l) => set('length', LENGTH_PRESETS.find((x) => x[0] === l)[1])} /></Field>
        {!isQuiz && (scoring === 'popularity' || f.votingEnabled) ? <Field label="Voting lasts"><Pills items={VOTING_PRESETS.map((x) => x[0])} value={(VOTING_PRESETS.find((x) => x[1] === f.voting) || [])[0]} onChange={(l) => set('voting', VOTING_PRESETS.find((x) => x[0] === l)[1])} /></Field> : null}
      </Section>

      <Section title="Prizes">
        <Text style={styles.fine}>Coins for 1st, 2nd, 3rd (leave 0 for none). Describe any other prize below.</Text>
        <View style={styles.two}>
          {f.coins.map((v, i) => <Field key={i} label={['1st', '2nd', '3rd'][i]}><DInput value={v} onChangeText={(t) => set('coins', f.coins.map((x, j) => (j === i ? t.replace(/\D/g, '') : x)))} keyboardType="number-pad" /></Field>)}
        </View>
        <Field label="Other prize (optional)"><DInput value={f.prizeText} onChangeText={(v) => set('prizeText', v)} maxLength={200} placeholder="e.g. A study Bible for the winner" /></Field>
        <Check on={f.certificatesFor === 'all'} onPress={() => set('certificatesFor', f.certificatesFor === 'all' ? 'winners' : 'all')} label="Give every participant a certificate (winners always get one)" />
      </Section>

      <Section title="Rules and eligibility">
        <Field label="Rules"><DInput value={f.rules} onChangeText={(v) => set('rules', v)} multiline style={{ minHeight: 70 }} /></Field>
        <Field label="Who can enter"><DInput value={f.eligibility} onChangeText={(v) => set('eligibility', v)} placeholder="e.g. Youth aged 13–25" /></Field>
        <View style={styles.two}>
          <Field label="Participant limit"><DInput value={f.participantLimit} onChangeText={(v) => set('participantLimit', v.replace(/\D/g, ''))} keyboardType="number-pad" placeholder="No limit" /></Field>
          <Field label="Countries (comma separated)"><DInput value={f.countries} onChangeText={(v) => set('countries', v)} placeholder="Everywhere" /></Field>
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
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [people, setPeople] = useState([]);
  const [sponsor, setSponsor] = useState({ name: '', linkUrl: '', contribution: '' });
  const load = useCallback(async () => {
    try { setData(await api.request('GET', `/contests/${params.id}/manage`)); setError(null); } catch (e) { setError(errorMessage(e, 'Couldn’t load')); }
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
  if (!data) return <Screen back title="Manage contest">{error ? <Notice tint={colors.negative} text={error} /> : <View style={styles.loading}><ActivityIndicator color={tok.plum} /></View>}</Screen>;
  const c = data.contest;
  const base = `/contests/${c.id}`;
  const settled = c.status === 'completed';
  const s = STATUS[c.status] || {};
  return (
    <Screen back title={c.title} subtitle={`Manage · ${s.label || c.status}`}>
      <View style={styles.stats}>
        {[['Registered', data.registrations.length], ['Entries', c.format === 'quiz' ? c.participants : data.submissions.length], ['Votes', data.votes ? data.votes.valid : 0], ['Reports', data.disputes.filter((x) => x.status === 'open').length]].map(([key, v]) => (
          <View key={key} style={styles.stat}><Text style={styles.statNum}>{v}</Text><Text style={styles.statLabel}>{key}</Text></View>
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
        <Section title={`Entries (${data.submissions.length})`}>
          {!data.submissions.length ? <Text style={styles.muted}>No entries yet.</Text> : null}
          {data.submissions.map((x) => (
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

      <Section title={`Participants (${data.registrations.length})`}>
        {!data.registrations.length ? <Text style={styles.muted}>Nobody has registered yet.</Text> : null}
        {data.registrations.slice(0, 100).map((r) => (
          <View key={r.user.id} style={styles.row}>
            <SocialAvatar name={r.user.displayName} uri={r.user.avatarUrl} size={30} />
            <Text style={[styles.name, { flex: 1 }]} numberOfLines={1}>{r.user.displayName}{r.church ? ` · ${r.church}` : ''}{r.disqualified ? ' · disqualified' : ''}</Text>
            {!settled && c.format === 'quiz' ? <Button kind="ghost" small label={r.disqualified ? 'Reinstate' : 'Disqualify'} onPress={() => run('POST', `${base}/disqualify`, { userId: r.user.id, reason: r.disqualified ? 'Reinstated by organizer' : 'Breaks the contest rules', disqualified: !r.disqualified })} /> : null}
          </View>
        ))}
      </Section>

      {c.format === 'submission' ? (
        <Section title="Judges">
          {data.judges.map((j) => (
            <View key={j.id} style={styles.row}>
              <SocialAvatar name={j.displayName} uri={j.avatarUrl} size={30} />
              <Text style={[styles.name, { flex: 1 }]}>{j.displayName}</Text>
              {!settled ? <Button kind="ghost" small label="Remove" onPress={() => run('DELETE', `${base}/judges/${j.id}`, undefined, 'Judge removed')} /> : null}
            </View>
          ))}
          {!settled ? (
            <View>
              <DInput value={q} onChangeText={setQ} placeholder="Add a judge: search by name" />
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
        {data.sponsors.map((sp) => <Text key={sp.id} style={styles.body}>• {sp.name}{sp.contribution ? ` — ${sp.contribution}` : ''}{sp.approved ? '' : ' (awaiting admin approval)'}</Text>)}
        {!settled ? (
          <View>
            <DInput value={sponsor.name} onChangeText={(v) => setSponsor((x) => ({ ...x, name: v }))} placeholder="Sponsor name" />
            <DInput value={sponsor.contribution} onChangeText={(v) => setSponsor((x) => ({ ...x, contribution: v }))} placeholder="What they give (optional)" />
            <DInput value={sponsor.linkUrl} onChangeText={(v) => setSponsor((x) => ({ ...x, linkUrl: v }))} placeholder="https:// link (optional)" autoCapitalize="none" />
            <Button small label="Add sponsor" disabled={sponsor.name.trim().length < 2} onPress={async () => { if (await run('POST', `${base}/sponsors`, { name: sponsor.name.trim(), contribution: sponsor.contribution.trim(), linkUrl: sponsor.linkUrl.trim() || undefined }, 'Sponsor added')) setSponsor({ name: '', linkUrl: '', contribution: '' }); }} style={{ marginTop: 8 }} />
          </View>
        ) : null}
      </Section>

      <Section title="Reports and appeals">
        {!data.disputes.length ? <Text style={styles.muted}>No reports.</Text> : null}
        {data.disputes.map((x) => (
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
        <DInput value={score} onChangeText={(v) => setScore(v.replace(/\D/g, '').slice(0, 3))} keyboardType="number-pad" placeholder="0–100" style={{ width: 90 }} accessibilityLabel="Score out of 100" />
        <DInput value={comment} onChangeText={setComment} placeholder="Comment (optional)" style={{ flex: 1 }} />
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
        {!list ? <View style={styles.loading}><ActivityIndicator color={tok.plum} /></View> : null}
        {list && !list.length ? <Empty title="Nothing to judge" body="Organizers can invite you to judge their contests." /> : null}
        {(list || []).map((c, i) => <ContestCard key={c.id} c={c} index={i} onPress={() => nav.push('ContestJudge', { id: c.id })} />)}
      </Screen>
    );
  }
  if (!data) return <Screen back title="Judging"><View style={styles.loading}><ActivityIndicator color={tok.plum} /></View></Screen>;
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
  label: { fontFamily: df.sansBold, fontSize: 12.5, color: tok.muted, marginBottom: 4 },
  fine: { marginTop: 6, fontFamily: df.sans, fontSize: 12, lineHeight: 17, color: tok.muted },
  muted: { marginTop: 8, fontFamily: df.sans, fontSize: 13, lineHeight: 18, color: tok.muted },
  body: { marginTop: 4, fontFamily: df.sans, fontSize: 14, lineHeight: 20, color: (isDarkScheme() ? '#D8C7B6' : '#4A3A30') },
  ok: { marginTop: 6, fontFamily: df.sansBold, fontSize: 13, color: tok.sageDark },
  two: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 12 },
  box: { width: 20, height: 20, borderRadius: 6, borderWidth: 2, borderColor: (isDarkScheme() ? '#4D3D30' : '#D9C7B0'), alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  boxOn: { backgroundColor: tok.plum, borderColor: tok.plum },
  checkText: { flex: 1, fontFamily: df.sans, fontSize: 14, lineHeight: 20, color: tok.ink },
  aiBox: { marginTop: 14, padding: 16, borderRadius: 22, backgroundColor: tok.lavender },
  aiTitle: { fontFamily: df.displayBold, fontSize: 16, color: tok.ink },
  draft: { marginTop: 10, padding: 14, borderRadius: 18, backgroundColor: tok.paper, borderWidth: 1, borderColor: tok.line },
  draftOpt: { marginTop: 6, marginLeft: 30, fontFamily: df.sans, fontSize: 13.5, color: tok.ink },
  ref: { marginTop: 6, marginLeft: 30, fontFamily: df.sansBold, fontSize: 12, color: tok.plum },
  stats: { flexDirection: 'row', gap: 8, marginTop: 12 },
  stat: { flex: 1, padding: 12, borderRadius: 18, backgroundColor: tok.paper, borderWidth: 1, borderColor: tok.line, alignItems: 'center' },
  statNum: { fontFamily: df.displayBold, fontSize: 22, color: tok.ink },
  statLabel: { fontFamily: df.sans, fontSize: 11.5, color: tok.muted },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tok.line },
  name: { fontFamily: df.sansSemi, fontSize: 14, color: tok.ink },
  meta: { marginTop: 1, fontFamily: df.sans, fontSize: 12, color: tok.muted },
  dispute: { marginTop: 8, padding: 14, borderRadius: 18, backgroundColor: tok.paper, borderWidth: 1, borderColor: tok.line },
});
