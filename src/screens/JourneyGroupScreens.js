// MY SCRIPTURE JOURNEY: community goals. Families, friends, Bible study groups and churches share one target
// (for example 100,000 verses in a month). Join with an invite code. Screens:
//   JourneyGroupsScreen  your goals, join by code, start a new goal
//   JourneyGroupScreen   combined progress, the leaderboard (with the hide-numbers option), leave
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, Share, Text, View } from 'react-native';
import { Icon } from '../components/Icons';
import { useToast } from '../components/Toast';
import { useNav, useIsFocused } from '../navigation';
import { useApi } from '../api/auth';
import { alpha } from '../components/ui';
import { d, df, Tap, Grad, Eyebrow, SectionTitle, gradients } from '../design/sanctuary';
import { DScreen, DCard, DInput, DLabel, DToggle } from '../design/profile/parts';
import {
  useJourneyGroups, groupProgress, createJourneyGroup, joinJourneyGroup, leaveJourneyGroup, setJourneyPrivacy, journeyChanged,
} from '../api/journey';
import { localDayKey } from '../journey/tracker';

const KINDS = [
  { id: 'family', label: 'Family' }, { id: 'friends', label: 'Friends' }, { id: 'study', label: 'Bible study' },
  { id: 'church', label: 'Church' }, { id: 'other', label: 'Other' },
];
const TARGETS = [10000, 50000, 100000];
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const addDaysKey = (days) => { const t = new Date(); t.setDate(t.getDate() + days); return localDayKey(t); };

function Chip({ label, on, onPress }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!on }}
      style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: on ? d.plum : d.line, backgroundColor: on ? alpha(d.plum, 0.12) : d.paper }}>
      <Text style={{ fontFamily: df.sansMedium, fontSize: 13, color: on ? d.plumDark : d.ink }}>{label}</Text>
    </Pressable>
  );
}

function Bar({ pct }) {
  return (
    <View style={{ height: 10, borderRadius: 5, backgroundColor: d.line, overflow: 'hidden' }}>
      <View style={{ height: 10, width: `${Math.min(100, pct)}%`, backgroundColor: d.plum, borderRadius: 5 }} />
    </View>
  );
}

export function JourneyGroupsScreen() {
  const nav = useNav();
  const api = useApi();
  const toast = useToast();
  const focused = useIsFocused();
  const groups = useJourneyGroups();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState('family');
  const [target, setTarget] = useState(100000);
  const [startsOn, setStartsOn] = useState(localDayKey());
  const [endsOn, setEndsOn] = useState(addDaysKey(30));
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);

  useEffect(() => { if (focused) groups.reload(); }, [focused]);

  const join = async () => {
    const c = code.trim().toUpperCase();
    if (c.length < 6) { toast.show('Enter the invite code', { icon: 'link' }); return; }
    setBusy(true);
    try {
      const r = await joinJourneyGroup(api, c);
      setCode('');
      toast.show('You joined the goal', { icon: 'check', haptic: 'success' });
      nav.push('JourneyGroup', { id: r.id });
    } catch (e) {
      toast.show((e && e.message) || 'That code did not work', { icon: 'link' });
    } finally { setBusy(false); }
  };

  const create = async () => {
    if (name.trim().length < 2) { toast.show('Give the goal a name', { icon: 'users' }); return; }
    setBusy(true);
    try {
      const r = await createJourneyGroup(api, { name: name.trim(), kind, target, startsOn, endsOn });
      setCreated(r);
      setName('');
      toast.show('Goal created. Share the invite code.', { icon: 'check', haptic: 'success' });
    } catch (e) {
      toast.show((e && e.message) || 'Could not create the goal', { icon: 'users' });
    } finally { setBusy(false); }
  };

  const inviteText = (c) => `Join my Scripture goal on BibleNestra. Invite code: ${c}. https://biblenestra.com`;
  const shareInvite = (c) => Linking.openURL(`https://wa.me/?text=${encodeURIComponent(inviteText(c))}`).catch(() => Share.share({ message: inviteText(c) }).catch(() => {}));

  return (
    <DScreen title="Community goals" subtitle="Read together" back onBack={() => nav.pop()}>
      <SectionTitle eyebrow="Your goals" title="Shared targets" />
      {groups.loaded === false ? <ActivityIndicator color={d.plum} /> : null}
      {(groups.data && groups.data.items || []).map((g) => (
        <Tap key={g.id} onPress={() => nav.push('JourneyGroup', { id: g.id })} style={{ marginBottom: 10 }} accessibilityLabel={g.name}>
          <DCard style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Grad colors={gradients.gold} style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="users" size={18} color="#fff" />
            </Grad>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: df.sansSemi, color: d.ink, fontSize: 15 }}>{g.name}</Text>
              <Text style={{ fontFamily: df.sans, color: d.muted, fontSize: 12, marginTop: 2 }}>
                {fmt(g.target)} verses · {g.startsOn} to {g.endsOn} · {g.members} {g.members === 1 ? 'member' : 'members'} · {g.status}{g.completed ? ' · reached' : ''}
              </Text>
            </View>
            <Icon name="chevron-right" size={16} color={d.muted} />
          </DCard>
        </Tap>
      ))}
      {groups.data && !groups.data.items.length ? <DCard><Text style={{ fontFamily: df.sans, color: d.muted, fontSize: 13 }}>No shared goals yet. Start one for your family, study group or church, or join with a code.</Text></DCard> : null}

      <SectionTitle eyebrow="Join" title="Have an invite code?" />
      <DCard style={{ gap: 10 }}>
        <DLabel>Invite code</DLabel>
        <DInput value={code} onChangeText={(v) => setCode(v.toUpperCase())} autoCapitalize="characters" placeholder="For example 7KQ2MX9P" accessibilityLabel="Invite code" />
        <Tap onPress={join} disabled={busy} accessibilityLabel="Join goal">
          <View style={{ borderRadius: 999, paddingVertical: 13, alignItems: 'center', backgroundColor: d.plum }}>
            <Text style={{ fontFamily: df.sansSemi, color: '#fff' }}>Join</Text>
          </View>
        </Tap>
      </DCard>

      <SectionTitle eyebrow="Start" title="Create a community goal" />
      <DCard style={{ gap: 10 }}>
        <DLabel>Name</DLabel>
        <DInput value={name} onChangeText={setName} placeholder="The Okafor family reading" accessibilityLabel="Goal name" />
        <DLabel>Who is it for</DLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {KINDS.map((x) => <Chip key={x.id} label={x.label} on={kind === x.id} onPress={() => setKind(x.id)} />)}
        </View>
        <DLabel>Verses in total</DLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {TARGETS.map((t) => <Chip key={t} label={fmt(t)} on={target === t} onPress={() => setTarget(t)} />)}
        </View>
        <DInput value={String(target)} onChangeText={(v) => setTarget(Number(String(v).replace(/[^0-9]/g, '')) || 0)} keyboardType="number-pad" accessibilityLabel="Target verses" />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}><DLabel>Starts</DLabel><DInput value={startsOn} onChangeText={setStartsOn} accessibilityLabel="Start date" /></View>
          <View style={{ flex: 1 }}><DLabel>Ends</DLabel><DInput value={endsOn} onChangeText={setEndsOn} accessibilityLabel="End date" /></View>
        </View>
        <Tap onPress={create} disabled={busy} accessibilityLabel="Create goal">
          <Grad colors={gradients.orange} style={{ borderRadius: 999, paddingVertical: 13, alignItems: 'center' }}>
            <Text style={{ fontFamily: df.sansSemi, color: '#fff' }}>{busy ? 'Working…' : 'Create goal'}</Text>
          </Grad>
        </Tap>
        {created ? (
          <Tap onPress={() => shareInvite(created.inviteCode)} accessibilityLabel="Share invite on WhatsApp">
            <View style={{ borderRadius: 999, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: d.line }}>
              <Text style={{ fontFamily: df.sansSemi, color: d.ink }}>Invite code {created.inviteCode} · share on WhatsApp</Text>
            </View>
          </Tap>
        ) : null}
      </DCard>
      <View style={{ height: 24 }} />
    </DScreen>
  );
}

export function JourneyGroupScreen({ params }) {
  const nav = useNav();
  const api = useApi();
  const toast = useToast();
  const focused = useIsFocused();
  const id = params && params.id;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [hide, setHide] = useState(false);

  const load = async () => {
    if (!id) return;
    try {
      const r = await groupProgress(api, id);
      setData(r);
      setHide(!!r.yourHideNumbers);
      setError(null);
    } catch (e) { setError(e); }
  };
  useEffect(() => { if (focused) load(); }, [focused, id]);

  const togglePrivacy = async (v) => {
    setHide(v);
    try { await setJourneyPrivacy(api, id, v); toast.show(v ? 'Your numbers are hidden from others' : 'Your numbers are visible to the group', { icon: 'eye' }); load(); } catch (e) { setHide(!v); }
  };
  const leave = async () => {
    try { await leaveJourneyGroup(api, id); journeyChanged(); nav.pop(); } catch (e) { toast.show((e && e.message) || 'Could not leave', { icon: 'users' }); }
  };
  const invite = () => Linking.openURL(`https://wa.me/?text=${encodeURIComponent(`Read with us on BibleNestra. Join "${data.name}" with invite code ${data.inviteCode}. https://biblenestra.com`)}`).catch(() => {});

  if (!data) {
    return <DScreen title="Community goal" subtitle="Read together" back onBack={() => nav.pop()}>{error ? <DCard><Text style={{ fontFamily: df.sans, color: d.muted }}>This goal could not be opened.</Text></DCard> : <ActivityIndicator color={d.plum} style={{ marginTop: 40 }} />}</DScreen>;
  }
  return (
    <DScreen title={data.name} subtitle={`${data.kind} · ${data.status}`} back onBack={() => nav.pop()}>
      <DCard style={{ gap: 12 }}>
        <Eyebrow>Combined progress</Eyebrow>
        <Text style={{ fontFamily: df.displayBold, fontSize: 30, color: d.ink }}>{fmt(data.total)} <Text style={{ fontSize: 15, color: d.muted, fontFamily: df.sans }}>of {fmt(data.target)} verses</Text></Text>
        <Bar pct={data.pct} />
        <Text style={{ fontFamily: df.sans, color: d.muted, fontSize: 13 }}>
          {data.reached ? 'Reached. Well done, everyone.' : `${fmt(data.target - data.total)} verses to go`} · {data.startsOn} to {data.endsOn}
        </Text>
        <Text style={{ fontFamily: df.sans, color: d.muted, fontSize: 13 }}>Your verses: {fmt(data.yourVerses)}</Text>
      </DCard>

      <SectionTitle eyebrow="Members" title="Leaderboard" />
      <DCard style={{ gap: 10 }}>
        {data.leaderboard.map((r, i) => (
          <View key={`${r.name}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ width: 26, fontFamily: df.sansSemi, color: d.muted }}>{r.rank ? `${r.rank}` : '·'}</Text>
            <Text style={{ flex: 1, fontFamily: df.sansMedium, color: d.ink }}>{r.name}{r.isYou ? ' (you)' : ''}{r.role === 'owner' ? ' · creator' : ''}</Text>
            <Text style={{ fontFamily: df.sans, color: r.hidden ? d.muted : d.ink }}>{r.hidden ? 'hidden' : fmt(r.verses)}</Text>
          </View>
        ))}
      </DCard>

      <SectionTitle eyebrow="Privacy" title="Your numbers" />
      <DCard style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={{ fontFamily: df.sansSemi, color: d.ink }}>Hide my personal numbers</Text>
            <Text style={{ fontFamily: df.sans, color: d.muted, fontSize: 12, marginTop: 2 }}>Your verses still count toward the shared total. Others see your name only.</Text>
          </View>
          <DToggle value={hide} onChange={togglePrivacy} accessibilityLabel="Hide my personal numbers" />
        </View>
      </DCard>

      <View style={{ gap: 10, marginTop: 14 }}>
        {data.role === 'owner' ? (
          <Tap onPress={invite} accessibilityLabel="Invite people on WhatsApp">
            <View style={{ borderRadius: 999, paddingVertical: 13, alignItems: 'center', borderWidth: 1, borderColor: d.plum }}>
              <Text style={{ fontFamily: df.sansSemi, color: d.plum }}>Invite code {data.inviteCode} · share on WhatsApp</Text>
            </View>
          </Tap>
        ) : (
          <Tap onPress={leave} accessibilityLabel="Leave this goal">
            <View style={{ borderRadius: 999, paddingVertical: 13, alignItems: 'center', borderWidth: 1, borderColor: d.line }}>
              <Text style={{ fontFamily: df.sansSemi, color: d.muted }}>Leave this goal</Text>
            </View>
          </Tap>
        )}
      </View>
      <View style={{ height: 24 }} />
    </DScreen>
  );
}

export default JourneyGroupsScreen;
