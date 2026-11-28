// MEMBERSHIP HUB (Development Update v1, items 4 / 4.1 / 4.2 / 4.3): a standalone, full-screen Memberships dashboard.
// Discover's Memberships side pushes it. A pushed route hides the main tab bar (App.js renders TabBar only when no route
// is pushed), so the hub has its own bottom navigation and a back button to Discover.
//   Explore          search, categories, Paid / Free filter; a card opens the membership, Subscribe is Paystack there
//   My Memberships   what you have joined (lapsed ones show as lapsed)
//   Create           name, description, cover image, intro video, category, public / private, weekly price (or free),
//                    rules, then publish. Publishing needs the creation fee paid to BibleNestra through Paystack.
//   Manage           creator dashboard: members, active, expired, new this week, renewals, weekly earnings, lists, ledger
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '../components/Icons';
import { Tap, Eyebrow, d, df } from '../design/sanctuary';
import { useNav } from '../navigation';
import { useToast } from '../components/Toast';
import { useApi } from '../api/auth';
import { payWithPaystack, paystackMessage, paystackError } from '../billing/paystack';
import { pickPhotos, uploadImage } from '../api/media';
import { useMembershipCatalog, useMyMemberships, membershipsChanged, friendly } from '../api/memberships';
import { useCreatorPlan, creatorPlanMessage } from '../api/creatorPlans'; // CREATOR PLANS: step 1 of Create, the plan banner
import { PlanPicker, useChoosePlan } from './CreatorPlanScreens'; // CREATOR PLANS
import { MembershipCard, SegmentToggle } from './MembershipScreens';

const TABS = [
  { id: 'explore', label: 'Explore', icon: 'search' },
  { id: 'mine', label: 'My Memberships', icon: 'users' },
  { id: 'create', label: 'Create', icon: 'plus' },
  { id: 'manage', label: 'Manage', icon: 'settings' },
];

/** Minor units → "₦5,000" (NGN) or "USD 5.00". */
export function moneyLabel(minor, currency = 'NGN') {
  const n = Number(minor || 0) / 100;
  const cur = String(currency || 'NGN').toUpperCase();
  if (cur === 'NGN') return `₦${n.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
  return `${cur} ${n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Pays the creation fee for a membership through Paystack (the same hosted page as every other purchase).
 * → 'success' (also when nothing is due) or the Paystack status to show.
 */
export async function payCreationFee(api, membershipId) {
  const r = await payWithPaystack(api, (mail) => api.request('POST', `/memberships/manage/${membershipId}/creation-fee/checkout`, { email: mail }), { email: null });
  return r.status;
}

// ---------------------------------------------------------------------------------------------------------------
export function MembershipHubScreen({ params = {} }) {
  const nav = useNav();
  const [tab, setTab] = useState(params.tab || 'explore');
  return (
    <View style={s.page}>
      <View style={s.header}>
        <Tap onPress={() => nav.pop()} accessibilityRole="button" accessibilityLabel="Back to Discover" style={s.back}>
          <Icon name="chevron-left" size={18} color={d.ink} />
          <Text style={s.backText}>Discover</Text>
        </Tap>
        <Text style={s.headerTitle}>Memberships</Text>
        <View style={{ width: 92 }} />
      </View>

      <View style={{ flex: 1 }}>
        {tab === 'explore' ? <ExploreTab nav={nav} /> : null}
        {tab === 'mine' ? <MineTab nav={nav} /> : null}
        {tab === 'create' ? <CreateTab onPublished={() => setTab('manage')} /> : null}
        {tab === 'manage' ? <ManageTab /> : null}
      </View>

      <View style={s.bottomNav} accessibilityRole="tablist">
        {TABS.map((t) => {
          const on = tab === t.id;
          return (
            <Pressable key={t.id} onPress={() => setTab(t.id)} accessibilityRole="tab" accessibilityState={{ selected: on }} style={s.navItem}>
              <Icon name={t.icon} size={20} color={on ? d.navOnText : d.navOff} />
              <Text style={[s.navText, { color: on ? d.navOnText : d.navOff }]} numberOfLines={1}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Explore
// ---------------------------------------------------------------------------------------------------------------
const PRICE_FILTERS = [{ id: 'all', label: 'All' }, { id: 'paid', label: 'Paid' }, { id: 'free', label: 'Free' }];

function ExploreTab({ nav }) {
  const [category, setCategory] = useState('All');
  const [price, setPrice] = useState('all');
  const [query, setQuery] = useState('');
  const cat = useMembershipCatalog({ category, sort: 'trending' });
  const needle = query.trim().toLowerCase();
  const items = cat.items
    .filter((m) => (price === 'all' ? true : price === 'paid' ? Number(m.fromPriceMinor) > 0 : !(Number(m.fromPriceMinor) > 0)))
    .filter((m) => !needle || `${m.title} ${m.headline || ''} ${m.category || ''}`.toLowerCase().includes(needle));

  if (!cat.online) return <Notice text="Memberships need a connection to BibleNestra. Sign in to browse." />;
  return (
    <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Eyebrow>Explore</Eyebrow>
      <Text style={s.h1}>Find your community</Text>

      <View style={s.search}>
        <Icon name="search" size={16} color={d.muted} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search memberships" placeholderTextColor={d.muted} style={s.searchInput} accessibilityLabel="Search memberships" />
      </View>

      <Chips items={(cat.categories || []).map((c) => c.name)} value={category} onChange={setCategory} />
      <View style={{ marginTop: 10 }}>
        <SegmentToggle value={price} onChange={setPrice} options={PRICE_FILTERS.map((p) => ({ id: p.id, label: p.label }))} />
      </View>

      <Text style={s.count}>{items.length} {items.length === 1 ? 'membership' : 'memberships'}</Text>
      {!cat.loaded ? <ActivityIndicator color={d.plum} style={{ marginVertical: 30 }} /> : null}
      {cat.loaded && cat.error && !items.length ? <Notice text={friendly(cat.error, 'Couldn’t load memberships')} action="Try again" onAction={cat.reload} /> : null}
      {cat.loaded && !cat.error && !items.length ? <Notice text="No memberships match. Try another category or filter." /> : null}

      <View style={{ gap: 14, marginTop: 6 }}>
        {items.map((m, i) => (
          <MembershipCard key={m.id} m={m} index={i} onPress={() => nav.push('Membership', { id: m.id, title: m.title })} />
        ))}
      </View>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// My Memberships
// ---------------------------------------------------------------------------------------------------------------
function MineTab({ nav }) {
  const mine = useMyMemberships();
  return (
    <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
      <Eyebrow>My Memberships</Eyebrow>
      <Text style={s.h1}>Communities you joined</Text>
      {!mine.loaded ? <ActivityIndicator color={d.plum} style={{ marginVertical: 30 }} /> : null}
      {mine.loaded && !mine.items.length ? <Notice text="You haven’t joined a membership yet. Explore to find one." /> : null}
      <View style={{ gap: 12, marginTop: 8 }}>
        {mine.items.map((m) => {
          const active = !!(m.access && m.access.active);
          return (
            <Pressable key={m.id} onPress={() => nav.push('Membership', { id: m.id, title: m.title })} accessibilityRole="button" style={s.card}>
              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle} numberOfLines={1}>{m.title}</Text>
                <Text style={s.cardMeta}>{active ? (m.access.expiresAt ? `Access until ${new Date(m.access.expiresAt).toLocaleDateString('en-GB')}` : 'Active') : 'Lapsed. Renew to get access again.'}</Text>
              </View>
              <View style={[s.pill, { backgroundColor: active ? d.sage : d.rose }]}>
                <Text style={[s.pillText, { color: active ? d.sageDark : d.roseDark }]}>{active ? 'Active' : 'Lapsed'}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------------------------------------------
function CreateTab({ onPublished }) {
  const api = useApi();
  const toast = useToast();
  const cat = useMembershipCatalog({ category: 'All', sort: 'trending' });
  const categories = (cat.categories || []).map((c) => c.name).filter((n) => n && n !== 'All');
  const [title, setTitle] = useState('');
  const [headline, setHeadline] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [visibility, setVisibility] = useState('public');
  const [free, setFree] = useState(false);
  const [weekly, setWeekly] = useState('');
  const [rules, setRules] = useState('');
  const [video, setVideo] = useState('');
  const [cover, setCover] = useState(null); // { uri, key }
  const [draftId, setDraftId] = useState(null); // created but not yet published (re-publish doesn't duplicate it)
  const [feeDue, setFeeDue] = useState(null); // { amountMinor, currency, cycle }
  const [busy, setBusy] = useState(false);
  // CREATOR PLANS: step 1 is the plan. The form opens once the creator can create (Free, or a paid plan in date).
  const plan = useCreatorPlan();
  const choosing = useChoosePlan(plan.reload);
  const [showPicker, setShowPicker] = useState(false);
  const needsPlan = !!plan.data && !plan.data.current.canCreate;
  const pickerOpen = needsPlan || showPicker;
  const showForm = !needsPlan && (!!plan.data || !!plan.error);

  const pickCover = async () => {
    try {
      const [photo] = await pickPhotos(1);
      if (!photo) return;
      setBusy(true);
      const r = await uploadImage(api.request, { uri: photo.uri });
      setCover({ uri: photo.uri, key: r.key });
    } catch (e) { toast.show(friendly(e, 'Couldn’t add that picture'), { tone: 'error' }); }
    setBusy(false);
  };

  const create = async () => {
    const body = {
      title: title.trim(), headline: headline.trim(), description: description.trim(), category: category || categories[0] || 'Bible Study',
      visibility, rules: rules.trim(), introVideoUrl: video.trim() || null, coverKey: cover ? cover.key : null,
    };
    const m = await api.request('POST', '/memberships/manage', body);
    const priceMinor = free ? 0 : Math.round(Number(weekly || 0) * 100);
    await api.request('POST', `/memberships/manage/${m.id}/plans`, { name: 'Weekly', priceMinor, interval: 'week' });
    return m.id;
  };

  const publish = async (id) => {
    try {
      await api.request('POST', `/memberships/manage/${id}/publish`);
      toast.show('Published. It’s now in Explore.', { icon: 'check' });
      membershipsChanged();
      setDraftId(null); setFeeDue(null);
      onPublished();
    } catch (e) {
      if (e.code === 'CREATION_FEE_REQUIRED') {
        setFeeDue(await api.request('GET', `/memberships/manage/${id}/creation-fee`).catch(() => ({ amountMinor: 0, currency: 'NGN', cycle: 'one_time' })));
        toast.show('Pay the creation fee to publish', { icon: 'clock' });
        return;
      }
      throw e;
    }
  };

  const submit = async () => {
    if (busy) return;
    if (!title.trim()) { toast.show('Give your membership a name', { tone: 'error' }); return; }
    if (!free && !(Number(weekly) > 0)) { toast.show('Enter a weekly price, or choose Free', { tone: 'error' }); return; }
    if (!rules.trim()) { toast.show('Add a few rules for members', { tone: 'error' }); return; }
    setBusy(true);
    try {
      const id = draftId || await create();
      setDraftId(id);
      await publish(id);
    } catch (e) {
      const planErr = e.code === 'CREATOR_PLAN_REQUIRED' || e.code === 'CREATOR_PLAN_LAPSED'; // CREATOR PLANS
      if (planErr) plan.reload();
      toast.show(planErr ? creatorPlanMessage(e) : friendly(e, 'Couldn’t publish yet'), { tone: 'error' });
    }
    setBusy(false);
  };

  const payAndPublish = async () => {
    setBusy(true);
    try {
      const status = await payCreationFee(api, draftId);
      if (status !== 'success') { toast.show(paystackMessage(status), { icon: 'clock', duration: 5000 }); setBusy(false); return; }
      await publish(draftId);
    } catch (e) { toast.show(paystackError(e), { tone: 'error' }); }
    setBusy(false);
  };

  return (
    <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Eyebrow>Create</Eyebrow>
      <Text style={s.h1}>Start a membership</Text>
      <Text style={s.lead}>Members subscribe weekly. Choose your creator plan first: Free costs nothing to create, Standard and Premium lower your withdrawal fee.</Text>

      {/* CREATOR PLANS: step 1 (the plan) and the plan banner that replaced the creation fee banner */}
      <View style={s.stepBox}>
        <Text style={s.stepTitle}>{needsPlan ? 'Step 1 · Choose your creator plan' : 'Step 1 · Your creator plan'}</Text>
        {!plan.data ? <Text style={s.lead}>{plan.error ? creatorPlanMessage(plan.error, 'Couldn’t load your plan') : 'Loading your plan…'}</Text> : null}
        {plan.data && !pickerOpen ? (
          <Tap onPress={() => setShowPicker(true)} accessibilityRole="button" style={s.planRow}>
            <Text style={s.feeTopText}>{`${(plan.data.plans.find((p) => p.id === plan.data.current.activePlanId) || { name: 'Free' }).name} · ${(plan.data.plans.find((p) => p.id === plan.data.current.activePlanId) || { withdrawalPercent: 0.5 }).withdrawalPercent}% withdrawal fee · ${(plan.data.plans.find((p) => p.id === plan.data.current.activePlanId) || { joinAds: true }).joinAds ? 'ads when members join' : 'ad-free joining'}`}</Text>
            <Text style={s.linkText}>Change plan</Text>
          </Tap>
        ) : null}
        {plan.data && pickerOpen ? <PlanPicker plans={plan.data.plans} current={plan.data.current} busy={choosing.busy} onChoose={(id) => choosing.choose(id)} /> : null}
      </View>

      {showForm ? (<>
      <Field label="Name"><TextInput style={s.input} value={title} onChangeText={setTitle} placeholder="e.g. Night Watch Prayer" placeholderTextColor={d.muted} maxLength={120} /></Field>
      <Field label="Short line"><TextInput style={s.input} value={headline} onChangeText={setHeadline} placeholder="What members get, in one line" placeholderTextColor={d.muted} maxLength={200} /></Field>
      <Field label="Description"><TextInput style={[s.input, s.multi]} value={description} onChangeText={setDescription} multiline placeholder="Who it is for and what happens inside" placeholderTextColor={d.muted} maxLength={6000} /></Field>

      <Field label="Cover image">
        <Pressable onPress={pickCover} accessibilityRole="button" style={s.coverBox}>
          {cover ? <Text style={s.coverText}>Picture added. Tap to change it.</Text> : <Text style={s.coverText}>Tap to add a cover picture</Text>}
        </Pressable>
      </Field>
      <Field label="Intro video link (optional)"><TextInput style={s.input} value={video} onChangeText={setVideo} placeholder="https://…" placeholderTextColor={d.muted} autoCapitalize="none" /></Field>

      <Field label="Category">
        <Chips items={categories} value={category || categories[0]} onChange={setCategory} includeAll={false} />
      </Field>

      <Field label="Who can find it">
        <SegmentToggle value={visibility} onChange={setVisibility} options={[{ id: 'public', label: 'Public' }, { id: 'private', label: 'Private (by link)' }]} />
      </Field>

      <Field label="Weekly price">
        <SegmentToggle value={free ? 'free' : 'paid'} onChange={(v) => setFree(v === 'free')} options={[{ id: 'paid', label: 'Paid' }, { id: 'free', label: 'Free' }]} />
        {!free ? (
          <View style={s.priceRow}>
            <Text style={s.priceCur}>₦</Text>
            <TextInput style={[s.input, { flex: 1 }]} value={weekly} onChangeText={(v) => setWeekly(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0 per week" placeholderTextColor={d.muted} accessibilityLabel="Weekly price in naira" />
          </View>
        ) : null}
      </Field>

      <Field label="Rules for members"><TextInput style={[s.input, s.multi]} value={rules} onChangeText={setRules} multiline placeholder="e.g. Be respectful. No promotions." placeholderTextColor={d.muted} maxLength={4000} /></Field>

      {feeDue && draftId ? (
        <View style={s.feeBox}>
          <Text style={s.feeTitle}>Creation fee to publish</Text>
          <Text style={s.feeText}>
            {feeDue.amountMinor ? `${moneyLabel(feeDue.amountMinor, feeDue.currency)} ${feeDue.cycle === 'week' ? 'every week' : feeDue.cycle === 'month' ? 'every month' : 'once'}` : 'No fee'}. Paid to BibleNestra on Paystack. Your membership is published as soon as it’s paid.
          </Text>
          <Tap onPress={payAndPublish} accessibilityRole="button" style={[s.primary, busy && { opacity: 0.6 }]} disabled={busy}>
            <Text style={s.primaryText}>Pay creation fee and publish</Text>
          </Tap>
        </View>
      ) : (
        <Tap onPress={submit} accessibilityRole="button" style={[s.primary, busy && { opacity: 0.6 }]} disabled={busy}>
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.primaryText}>Publish membership</Text>}
        </Tap>
      )}
      </>) : null}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Manage: creator dashboard for the memberships you own
// ---------------------------------------------------------------------------------------------------------------
function ManageTab() {
  const nav = useNav(); // CREATOR PLANS: links to My creator plan and Withdraw earnings
  const api = useApi();
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);
  const load = () => api.request('GET', '/memberships/manage').then((r) => { setItems(r.items || []); setError(null); }).catch((e) => setError(e));
  useEffect(() => { load(); }, []);

  if (error && !items) return <Notice text={friendly(error, 'Only creators can see this. Create a membership to get a dashboard.')} />;
  if (!items) return <ActivityIndicator color={d.plum} style={{ marginVertical: 40 }} />;
  const mine = items; // the server returns only your own memberships (all of them for platform admins)
  return (
    <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
      <Eyebrow>Manage</Eyebrow>
      <Text style={s.h1}>Your memberships</Text>
      <View style={s.planLinks}>
        <Tap onPress={() => nav.push('CreatorPlan')} accessibilityRole="button" style={s.planLink}><Text style={s.planLinkText}>My creator plan</Text></Tap>
        <Tap onPress={() => nav.push('CreatorWithdraw')} accessibilityRole="button" style={s.planLink}><Text style={s.planLinkText}>Withdraw earnings</Text></Tap>
      </View>
      {!mine.length ? <Notice text="You haven’t created a membership yet. Use Create to start one." /> : null}
      {mine.map((m) => {
        const open = openId === m.id;
        const fee = m.creationFee || {};
        // CREATOR PLANS: the per-membership fee is dormant by default; show it only when an admin has turned it on
        const feeLine = !fee.required ? null : fee.paid ? `Creation fee paid (${fee.cycle === 'one_time' ? 'once' : fee.cycle})` : `Creation fee due: ${moneyLabel(fee.amountMinor, fee.currency)}`;
        return (
          <View key={m.id} style={s.card2}>
            <View style={s.rowBetween}>
              <Text style={[s.cardTitle, { flex: 1 }]} numberOfLines={1}>{m.title}</Text>
              <View style={[s.pill, { backgroundColor: m.status === 'published' ? d.sage : d.lavender }]}>
                <Text style={[s.pillText, { color: m.status === 'published' ? d.sageDark : d.plumDark }]}>{m.status}</Text>
              </View>
            </View>
            {feeLine || fee.lapsedAt ? <Text style={s.cardMeta}>{feeLine}{fee.lapsedAt ? ' · lapsed, pay again to publish' : ''}</Text> : null}
            <Text style={s.cardMeta}>{m.subscribers ? `${m.subscribers.active} active · ${m.subscribers.total} total` : ''}</Text>
            <View style={s.rowWrap}>
              <Tap onPress={() => setOpenId(open ? null : m.id)} accessibilityRole="button" style={s.ghost}>
                <Text style={s.ghostText}>{open ? 'Hide dashboard' : 'Open dashboard'}</Text>
              </Tap>
              {fee.required && !fee.paid ? (
                <Tap onPress={async () => {
                  try {
                    const status = await payCreationFee(api, m.id);
                    if (status === 'success') { toast.show('Creation fee paid', { icon: 'check' }); load(); }
                    else toast.show(paystackMessage(status), { icon: 'clock', duration: 5000 });
                  } catch (e) { toast.show(paystackError(e), { tone: 'error' }); }
                }} accessibilityRole="button" style={s.ghost}>
                  <Text style={s.ghostText}>Pay creation fee</Text>
                </Tap>
              ) : null}
            </View>
            {open ? <CreatorDashboard membershipId={m.id} currency={fee.currency || 'NGN'} /> : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

function CreatorDashboard({ membershipId, currency }) {
  const api = useApi();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let alive = true;
    api.request('GET', `/memberships/manage/${membershipId}/stats`).then((r) => { if (alive) setData(r); }).catch((e) => { if (alive) setErr(e); });
    return () => { alive = false; };
  }, [membershipId]);
  if (err) return <Text style={s.cardMeta}>{friendly(err, 'Couldn’t load the dashboard')}</Text>;
  if (!data) return <ActivityIndicator color={d.plum} style={{ marginVertical: 14 }} />;
  const t = data.totals;
  const cur = data.currency || currency;
  const tiles = [
    ['Members', t.members], ['Active subscribers', t.activeSubscribers], ['Expired', t.expired],
    ['New this week', t.newSubscriptions7d], ['Renewals this week', t.renewals7d], ['Earned this week', moneyLabel(data.earnings.weeklyMinor, cur)],
  ];
  return (
    <View style={{ marginTop: 14, gap: 14 }}>
      <View style={s.tiles}>
        {tiles.map(([label, value]) => (
          <View key={label} style={s.tile}>
            <Text style={s.tileValue}>{value}</Text>
            <Text style={s.tileLabel}>{label}</Text>
          </View>
        ))}
      </View>
      <Text style={s.cardMeta}>Total earned: {moneyLabel(data.earnings.totalMinor, cur)}. {data.payouts.note}</Text>
      <ListBlock title="Active subscribers" rows={data.activeSubscribers} right={(r) => (r.expiresAt ? `until ${new Date(r.expiresAt).toLocaleDateString('en-GB')}` : '')} empty="No active subscribers yet." />
      <ListBlock title="Expired" rows={data.expiredSubscribers} right={(r) => (r.expiresAt ? `ended ${new Date(r.expiresAt).toLocaleDateString('en-GB')}` : '')} empty="Nobody has expired." />
      <ListBlock title="Recent renewals" rows={data.renewals} right={(r) => moneyLabel(r.amountMinor, r.currency)} empty="No renewals yet." />
      <ListBlock title="Payments ledger" rows={data.ledger} right={(r) => `${moneyLabel(r.amountMinor, r.currency)} · ${r.purpose}`} empty="No payments yet." />
    </View>
  );
}

function ListBlock({ title, rows = [], right, empty }) {
  return (
    <View style={s.block}>
      <Text style={s.blockTitle}>{title}</Text>
      {!rows.length ? <Text style={s.cardMeta}>{empty}</Text> : rows.slice(0, 50).map((r, i) => (
        <View key={(r.userId || r.reference || '') + i} style={s.listRow}>
          <Text style={[s.cardTitle, { flex: 1, fontSize: 14 }]} numberOfLines={1}>{r.name}{r.handle ? `  @${r.handle}` : ''}</Text>
          <Text style={s.cardMeta} numberOfLines={1}>{right(r)}</Text>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// shared bits
// ---------------------------------------------------------------------------------------------------------------
function Field({ label, children }) {
  return (
    <View style={{ marginTop: 16 }}>
      <Text style={s.label}>{label}</Text>
      <View style={{ marginTop: 6 }}>{children}</View>
    </View>
  );
}

function Chips({ items, value, onChange, includeAll = true }) {
  const list = includeAll ? ['All', ...items.filter((x) => x !== 'All')] : items;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
      {list.map((name) => {
        const on = (value || 'All') === name;
        return (
          <Pressable key={name} onPress={() => onChange(name)} accessibilityRole="button" accessibilityState={{ selected: on }}
            style={[s.chip, on && { backgroundColor: d.plum, borderColor: d.plum }]}>
            <Text style={[s.chipText, on && { color: '#FFFFFF' }]}>{name}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function Notice({ text, action, onAction }) {
  return (
    <View style={s.notice}>
      <Text style={s.noticeText}>{text}</Text>
      {action ? <Pressable onPress={onAction} accessibilityRole="button"><Text style={s.noticeAction}>{action}</Text></Pressable> : null}
    </View>
  );
}

const s = StyleSheet.create({
  stepBox: { padding: 14, borderRadius: 16, borderWidth: 1, borderColor: d.line, backgroundColor: d.paper, marginBottom: 16, gap: 10 }, // CREATOR PLANS
  stepTitle: { fontFamily: df.display, fontSize: 18, color: d.ink },
  planRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  linkText: { fontFamily: df.sansSemi, color: d.plum, fontSize: 13 },
  planLinks: { flexDirection: 'row', gap: 10, marginTop: 10 },
  planLink: { flex: 1, borderRadius: 14, borderWidth: 1, borderColor: d.line, backgroundColor: d.paper, paddingVertical: 12, alignItems: 'center' },
  planLinkText: { fontFamily: df.sansSemi, color: d.ink, fontSize: 13 },
  page: { flex: 1, backgroundColor: d.ivory },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, backgroundColor: d.ivory },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 92, minHeight: 40 },
  backText: { fontFamily: df.sansSemi, fontSize: 15, color: d.ink },
  headerTitle: { fontFamily: df.display, fontSize: 20, color: d.ink },
  scroll: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40, gap: 4 },
  h1: { fontFamily: df.display, fontSize: 26, color: d.ink, marginTop: 4 },
  lead: { fontFamily: df.sans, fontSize: 14, color: d.muted, marginTop: 6, lineHeight: 20 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, backgroundColor: d.paper, borderColor: d.line, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, height: 44 },
  searchInput: { flex: 1, fontFamily: df.sans, fontSize: 15, color: d.ink },
  count: { fontFamily: df.sans, fontSize: 13, color: d.muted, marginTop: 14, marginBottom: 6 },
  chip: { paddingHorizontal: 14, height: 34, borderRadius: 17, borderWidth: 1, borderColor: d.line, backgroundColor: d.paper, justifyContent: 'center' },
  chipText: { fontFamily: df.sansSemi, fontSize: 13, color: d.ink },
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: d.paper, borderColor: d.line, borderWidth: 1, borderRadius: 16, padding: 14 },
  card2: { backgroundColor: d.paper, borderColor: d.line, borderWidth: 1, borderRadius: 16, padding: 14, marginTop: 12, gap: 6 },
  cardTitle: { fontFamily: df.sansBold, fontSize: 16, color: d.ink },
  cardMeta: { fontFamily: df.sans, fontSize: 12, color: d.muted },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillText: { fontFamily: df.sansSemi, fontSize: 11 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  ghost: { paddingHorizontal: 14, height: 36, borderRadius: 18, borderWidth: 1, borderColor: d.line, justifyContent: 'center' },
  ghostText: { fontFamily: df.sansSemi, fontSize: 13, color: d.ink },
  label: { fontFamily: df.sansSemi, fontSize: 13, color: d.ink },
  input: { backgroundColor: d.paper, borderColor: d.line, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, height: 46, fontFamily: df.sans, fontSize: 15, color: d.ink },
  multi: { height: 110, paddingTop: 12, textAlignVertical: 'top' },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  priceCur: { fontFamily: df.sansBold, fontSize: 18, color: d.ink },
  coverBox: { height: 110, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: d.line, backgroundColor: d.paper, alignItems: 'center', justifyContent: 'center' },
  coverText: { fontFamily: df.sans, fontSize: 14, color: d.muted },
  primary: { marginTop: 22, height: 52, borderRadius: 26, backgroundColor: d.plum, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontFamily: df.sansBold, fontSize: 15, color: '#FFFFFF' },
  feeBox: { marginTop: 22, padding: 16, borderRadius: 16, backgroundColor: d.lavender, gap: 8 },
  feeTitle: { fontFamily: df.display, fontSize: 18, color: d.plumDark },
  feeText: { fontFamily: df.sans, fontSize: 13, color: d.plumDark, lineHeight: 19 },
  feeTop: { padding: 14, borderRadius: 16, backgroundColor: d.lavender, marginBottom: 16 },
  feeTopText: { fontFamily: df.sansBold, fontSize: 14, color: d.plumDark, lineHeight: 20 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { width: '31%', flexGrow: 1, backgroundColor: d.ivory, borderRadius: 12, padding: 10, borderColor: d.line, borderWidth: 1 },
  tileValue: { fontFamily: df.sansBold, fontSize: 16, color: d.ink },
  tileLabel: { fontFamily: df.sans, fontSize: 11, color: d.muted, marginTop: 2 },
  block: { gap: 6 },
  blockTitle: { fontFamily: df.sansSemi, fontSize: 14, color: d.ink, marginTop: 6 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomColor: d.line, borderBottomWidth: 1 },
  notice: { marginTop: 16, padding: 16, borderRadius: 14, backgroundColor: d.paper, borderColor: d.line, borderWidth: 1, gap: 6 },
  noticeText: { fontFamily: df.sans, fontSize: 14, color: d.muted, lineHeight: 20 },
  noticeAction: { fontFamily: df.sansBold, fontSize: 14, color: d.plum },
  bottomNav: { flexDirection: 'row', backgroundColor: d.navBg, paddingVertical: 8, paddingHorizontal: 6, borderTopLeftRadius: 0 },
  navItem: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: 4 },
  navText: { fontFamily: df.sansSemi, fontSize: 11 },
});
