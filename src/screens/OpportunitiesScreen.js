// OPPORTUNITIES — jobs, remote work, internships, scholarships, fellowships, grants, hackathons, competitions,
// volunteering… imported by the server from trusted outside sources. Users browse / filter / search / save
// and tap through to apply on the ORIGINAL site. Every listing credits its source ("via <source>") and every
// apply button opens item.url — required by the sources' terms.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { Screen, Badge, Button, alpha } from '../components/ui';
import { Icon } from '../components/Icons';
import { colors, fonts, radius, shadow } from '../theme';
import { useStore } from '../store';
import { useToast, haptic } from '../components/Toast';
import { AnimatedModal, FadeInUp, PressScale, ScaleIn, Pop } from '../components/Motion';
import { errorMessage } from '../api/client';
import { useOpportunitiesApi, isWebUrl } from '../api/opportunities';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAds } from '../ads/Ads';
import { NightGlow } from '../components/ui';

// ---------- kinds ----------
export const KIND_META = {
  job: { label: 'Jobs', one: 'Job', icon: 'briefcase', tint: colors.primary },
  remote: { label: 'Remote', one: 'Remote', icon: 'globe', tint: colors.sky },
  internship: { label: 'Internships', one: 'Internship', icon: 'user', tint: colors.teal },
  scholarship: { label: 'Scholarships', one: 'Scholarship', icon: 'book', tint: colors.lavender },
  fellowship: { label: 'Fellowships', one: 'Fellowship', icon: 'users', tint: colors.sage },
  grant: { label: 'Grants', one: 'Grant', icon: 'coin', tint: colors.gold },
  hackathon: { label: 'Hackathons', one: 'Hackathon', icon: 'flame', tint: colors.terracotta },
  competition: { label: 'Competitions', one: 'Competition', icon: 'star', tint: colors.amber },
  volunteer: { label: 'Volunteering', one: 'Volunteer', icon: 'heart', tint: colors.rose },
  event: { label: 'Events', one: 'Event', icon: 'calendar', tint: colors.indigo },
  other: { label: 'Other', one: 'Opportunity', icon: 'compass', tint: colors.slate },
};
const kindMeta = (k) => KIND_META[k] || KIND_META.other;

// JOBS FEEDS: the 7 categories of the Job & Academic Directory (ids match backend/src/lib/jobsDirectory.js)
export const DIR_CATEGORIES = [
  { id: 'intl', label: 'Remote & global', icon: 'globe', tint: colors.sky },
  { id: 'africa', label: 'Nigeria & Africa', icon: 'map-pin', tint: colors.sage },
  { id: 'freelance', label: 'Freelance', icon: 'briefcase', tint: colors.terracotta },
  { id: 'ai', label: 'AI & tech', icon: 'sparkles', tint: colors.indigo },
  { id: 'academic', label: 'Academic', icon: 'book', tint: colors.lavender },
  { id: 'research', label: 'Research', icon: 'search', tint: colors.teal },
  { id: 'funding', label: 'Scholarships', icon: 'coin', tint: colors.gold },
];
const catMeta = (id) => DIR_CATEGORIES.find((g) => g.id === id) || { label: 'Other', icon: 'compass', tint: colors.slate };
const OPEN_TO_LABEL = { nigeria: 'Open to Nigeria', africa: 'Open to Africa', worldwide: 'Worldwide' };

// ---------- dates ----------
const DAY = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parseDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};
const shortDate = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ''}`;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** → { text, urgent, closed } or null */
function deadlineInfo(iso) {
  const d = parseDate(iso);
  if (!d) return null;
  if (d.getTime() < Date.now()) return { text: `Closed ${shortDate(d)}`, urgent: false, closed: true };
  const days = Math.round((startOfDay(d) - startOfDay(new Date())) / DAY);
  const urgent = d.getTime() - Date.now() < 3 * DAY;
  if (days <= 0) return { text: 'Closes today', urgent: true, closed: false };
  if (days === 1) return { text: 'Closes tomorrow', urgent: true, closed: false };
  if (days <= 14) return { text: `Closes in ${days} days`, urgent, closed: false };
  return { text: `Closes ${shortDate(d)}`, urgent: false, closed: false };
}

function postedText(iso) {
  const d = parseDate(iso);
  if (!d) return null;
  const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / DAY);
  if (days <= 0) return 'Posted today';
  if (days === 1) return 'Posted yesterday';
  if (days < 7) return `Posted ${days} days ago`;
  if (days < 30) { const w = Math.floor(days / 7); return `Posted ${w} ${w === 1 ? 'week' : 'weeks'} ago`; }
  return `Posted ${shortDate(d)}`;
}

function updatedText(iso) {
  const d = parseDate(iso);
  if (!d) return null;
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 2) return 'Updated just now';
  if (mins < 60) return `Updated ${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `Updated ${h}h ago`;
  return `Updated ${shortDate(d)}`;
}

const placeText = (it) => [it.location, it.remote && !/remote/i.test(it.location || '') ? 'Remote' : null].filter(Boolean).join(' · ');

const PAGE_STAGGER = 20; // entrance stagger restarts for every page loaded by infinite scroll

const DISCLAIMER ='BibleNestra doesn’t run these listings. Always check details on the original site and never pay to apply.';

// ---------- open links ----------
function useOpenLink() {
  const toast = useToast();
  return useCallback(async (url) => {
    if (!isWebUrl(url)) {
      toast.show('This listing has no valid link', { tone: 'error' });
      return;
    }
    haptic('select');
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch (e) {
      toast.show('Couldn’t open the link', { tone: 'error' });
    }
  }, [toast]);
}

// ---------- screen ----------
export function OpportunitiesScreen({ params = {} }) {
  const api = useOpportunitiesApi();
  const { state, dispatch } = useStore();
  const toast = useToast();
  const openLink = useOpenLink();
  const ads = useAds();

  const [kind, setKind] = useState(params.kind || 'all'); // 'all' | kind | 'saved'
  const [query, setQuery] = useState('');
  const [q, setQ] = useState(''); // debounced
  const [remoteOnly, setRemoteOnly] = useState(false);
  // JOBS FEEDS: 7 categories, "Open to Africa", one-source filter (from the directory), and the Directory view
  const [view, setView] = useState(params.view === 'directory' ? 'directory' : 'listings');
  const [category, setCategory] = useState(params.category || 'all');
  const [africaOnly, setAfricaOnly] = useState(false);
  const [sourceFilter, setSourceFilter] = useState(null); // { key, name }
  const [directory, setDirectory] = useState(null);
  const [dirLoading, setDirLoading] = useState(false);
  const [dirError, setDirError] = useState(null);

  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(null);
  const [selected, setSelected] = useState(null);

  const reqId = useRef(0);
  const listRef = useRef(null);

  const saved = Array.isArray(state.savedOpportunities) ? state.savedOpportunities : [];
  const savedIds = useMemo(() => new Set(saved.map((s) => s.id)), [saved]);

  // Debounce the search box
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 400);
    return () => clearTimeout(t);
  }, [query]);

  const loadSummary = useCallback(async () => {
    if (!api.online) return;
    try {
      setSummary(await api.summary());
    } catch (e) {
      // non-fatal: chips fall back to "All" and the footer credits whatever sources the items carry
    }
  }, [api]);

  // First page (reset) for the current filters
  const loadFirst = useCallback(async ({ pull = false } = {}) => {
    if (!api.online || kind === 'saved') return;
    const id = ++reqId.current;
    if (pull) setRefreshing(true);
    else { setLoading(true); setItems([]); setCursor(null); setHasMore(false); }
    setError(null);
    try {
      const res = await api.list({ kind, q, remote: remoteOnly, category, africa: africaOnly, source: sourceFilter && sourceFilter.key });
      if (id !== reqId.current) return;
      setItems(res.items);
      setCursor(res.cursor);
      setHasMore(res.hasMore);
    } catch (e) {
      if (id !== reqId.current) return;
      setError(e);
      if (!pull) setItems([]);
      setHasMore(false);
    } finally {
      if (id === reqId.current) { setLoading(false); setRefreshing(false); }
    }
  }, [api, kind, q, remoteOnly, category, africaOnly, sourceFilter]);

  const loadMore = useCallback(async () => {
    if (!api.online || kind === 'saved' || view === 'directory' || !hasMore || !cursor || loading || loadingMore || refreshing) return;
    const id = reqId.current;
    setLoadingMore(true);
    try {
      const res = await api.list({ kind, q, remote: remoteOnly, category, africa: africaOnly, source: sourceFilter && sourceFilter.key, cursor });
      if (id !== reqId.current) return; // filters changed meanwhile
      setItems((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        return prev.concat(res.items.filter((x) => !seen.has(x.id)));
      });
      setCursor(res.cursor);
      setHasMore(res.hasMore);
    } catch (e) {
      if (id === reqId.current) toast.show(`Couldn’t load more: ${errorMessage(e)}`, { tone: 'error' });
    } finally {
      if (id === reqId.current) setLoadingMore(false);
    }
  }, [api, kind, view, q, remoteOnly, category, africaOnly, sourceFilter, cursor, hasMore, loading, loadingMore, refreshing, toast]);

  // JOBS FEEDS: the directory loads once, when first opened
  const loadDirectory = useCallback(async () => {
    if (!api.online) return;
    setDirLoading(true); setDirError(null);
    try { setDirectory(await api.directory()); } catch (e) { setDirError(e); } finally { setDirLoading(false); }
  }, [api]);
  useEffect(() => { if (view === 'directory' && !directory && !dirLoading && !dirError) loadDirectory(); }, [view, directory, dirLoading, dirError, loadDirectory]);

  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { if (view === 'listings') loadFirst(); }, [loadFirst, view]);

  const onRefresh = useCallback(() => {
    if (!api.online || kind === 'saved') return;
    loadSummary();
    loadFirst({ pull: true });
  }, [api.online, kind, loadSummary, loadFirst]);

  const selectKind = (k) => {
    if (k === kind) return;
    haptic('select');
    setKind(k);
    listRef.current?.scrollToOffset?.({ offset: 0, animated: false });
  };

  const toggleSave = useCallback((it) => {
    const list = Array.isArray(state.savedOpportunities) ? state.savedOpportunities : [];
    if (list.some((s) => s.id === it.id)) {
      dispatch({ type: 'set', patch: { savedOpportunities: list.filter((s) => s.id !== it.id) } });
      toast.show('Removed from saved', { icon: 'bookmark' });
    } else {
      dispatch({ type: 'set', patch: { savedOpportunities: [{ ...it, savedAt: new Date().toISOString() }, ...list].slice(0, 200) } });
      toast.show('Saved — find it under Saved', { icon: 'bookmark', haptic: 'success' });
    }
  }, [state.savedOpportunities, dispatch, toast]);

  // Brief 12.2: the detail sheet preloads an interstitial; "Apply on …" shows it, then opens the site in the
  // in-app browser. If no ad opens within ~2 s (or caps / Plus say no ad) we go straight to the site.
  // JOBS FEEDS: the Directory's "Open" buttons go through the same interstitial-then-in-app-browser path.
  useEffect(() => { if (selected || view === 'directory') ads.preloadInterstitial(); }, [selected, view]);
  const proceeding = useRef(false);
  const proceedToUrl = useCallback(async (url, { closeSheet = false } = {}) => {
    if (!isWebUrl(url)) { openLink(url); return; }
    if (proceeding.current) return;
    proceeding.current = true;
    try {
      // full-screen ads can't reliably stack over our own sheet, so slide it away first (the user comes back to the list)
      if (closeSheet) {
        setSelected(null);
        await new Promise((r) => setTimeout(r, 280));
      }
      try {
        await Promise.race([
          ads.showInterstitial({ surface: 'other', placement: 'opportunity', loadTimeoutMs: 2000, skipAfterSec: 3 }),
          new Promise((r) => setTimeout(r, 2000 + 3 * 60 * 1000)), // safety net: never hold the user forever
        ]);
      } catch (e) { /* never block the redirect */ }
      await openLink(url);
      ads.preloadInterstitial(); // ready for the next one
    } finally {
      proceeding.current = false;
    }
  }, [ads, openLink]);
  const proceedToSite = useCallback((it) => { if (it) proceedToUrl(it.url, { closeSheet: true }); }, [proceedToUrl]);

  // Directory → "See listings": jump to the listings view filtered to that source
  const showSourceListings = useCallback((entry) => {
    haptic('select');
    setSourceFilter({ key: entry.sourceKey, name: entry.name });
    setCategory('all'); setKind('all'); setAfricaOnly(false); setRemoteOnly(false); setQuery(''); setQ('');
    setView('listings');
    listRef.current?.scrollToOffset?.({ offset: 0, animated: false });
  }, []);

  const share = async (it) => {
    try {
      await Share.share({ message: `${it.title}${it.org ? ` — ${it.org}` : ''}\n${it.url || ''}\n\nvia ${it.source.name} · found on BibleNestra` });
    } catch (e) {
      toast.show('Sharing isn’t available here', { tone: 'error' });
    }
  };

  // Saved view filters locally (works offline)
  const savedFiltered = useMemo(() => {
    const needle = q.toLowerCase();
    return saved.filter((it) => {
      if (remoteOnly && !it.remote) return false;
      if (africaOnly && !it.openTo) return false;
      if (category !== 'all' && it.category !== category) return false;
      if (!needle) return true;
      return [it.title, it.org, it.location, it.excerpt, ...(it.tags || [])].some((s) => String(s || '').toLowerCase().includes(needle));
    });
  }, [saved, q, remoteOnly, africaOnly, category]);

  // JOBS FEEDS: directory rows (a heading per category, then its platforms), filtered by category + search
  const isDir = view === 'directory';
  const dirRows = useMemo(() => {
    if (!directory) return [];
    const needle = q.toLowerCase();
    const rows = [];
    directory.categories.filter((g) => category === 'all' || g.id === category).forEach((g) => {
      const list = g.items.filter((d) => !needle || `${d.name} ${d.description}`.toLowerCase().includes(needle));
      if (!list.length) return;
      rows.push({ type: 'cat', id: `cat-${g.id}`, cat: g, n: list.length });
      list.forEach((d) => rows.push({ type: 'entry', id: `dir-${d.slug}`, entry: d }));
    });
    return rows;
  }, [directory, category, q]);
  const dirTotal = useMemo(() => (directory ? directory.categories.reduce((n, g) => n + g.items.length, 0) : 0), [directory]);

  const isSaved = kind === 'saved' && !isDir;
  const data = isDir ? dirRows : isSaved ? savedFiltered : api.online ? items : [];

  // Chips: All + kinds with listings + Saved
  const kindChips = useMemo(() => {
    const list = (summary && summary.kinds) || [];
    return list
      .filter((k) => (k.count || 0) > 0)
      .map((k) => ({ id: k.kind, label: k.label || kindMeta(k.kind).label, count: k.count }));
  }, [summary]);
  const totalCount = useMemo(() => kindChips.reduce((n, k) => n + (k.count || 0), 0), [kindChips]);

  // Footer credits: summary.sources, else whatever sources the loaded items carry
  const sources = useMemo(() => {
    if (summary && summary.sources && summary.sources.length) return summary.sources;
    const m = new Map();
    items.concat(saved).forEach((it) => { if (it.source && !m.has(it.source.key)) m.set(it.source.key, it.source); });
    return Array.from(m.values());
  }, [summary, items, saved]);

  // JOBS FEEDS: category chips (counts from the summary in the listings view)
  const categoryChips = useMemo(() => {
    const counts = Object.fromEntries(((summary && summary.categories) || []).map((g) => [g.id, g.count]));
    return DIR_CATEGORIES.map((g) => ({ ...g, count: isDir ? null : counts[g.id] || null }));
  }, [summary, isDir]);
  const selectCategory = (id) => {
    if (id === category) return;
    haptic('select');
    setCategory(id);
    listRef.current?.scrollToOffset?.({ offset: 0, animated: false });
  };
  const switchView = (v) => {
    if (v === view) return;
    haptic('select');
    if (v === 'directory' && kind === 'saved') setKind('all');
    setView(v);
    listRef.current?.scrollToOffset?.({ offset: 0, animated: false });
  };
  const filtersOn = !!(q || remoteOnly || africaOnly || kind !== 'all' || category !== 'all' || sourceFilter);
  const clearFilters = () => { setQuery(''); setQ(''); setRemoteOnly(false); setAfricaOnly(false); setKind('all'); setCategory('all'); setSourceFilter(null); };

  let statusText = '';
  const filterNote = `${remoteOnly ? ' · remote' : ''}${africaOnly ? ' · open to Africa' : ''}`;
  if (isDir && data.length) statusText = `${data.filter((r) => r.type === 'entry').length} platforms${q ? ` for “${q}”` : ''}`;
  else if (isSaved && data.length) statusText = `${data.length} saved ${data.length === 1 ? 'listing' : 'listings'}${q || remoteOnly || africaOnly ? ' · filtered' : ''}`;
  else if (!isSaved && data.length) statusText = `${hasMore ? `${data.length}+` : data.length} ${data.length === 1 ? 'opportunity' : 'opportunities'}${filterNote}${q ? ` for “${q}”` : ''}`;

  // ---------- header / footer / empty ----------
  const header = (
    <View>
      <FadeInUp distance={10} style={styles.hero}>
        <View style={styles.heroGlow} />
        <View style={styles.heroTop}>
          <View style={styles.heroBadge}>
            <Icon name="globe" size={12} color={colors.goldLight} />
            <Text style={styles.heroBadgeText}>Worldwide</Text>
          </View>
          {summary && summary.updatedAt ? <Text style={styles.heroUpdated}>{updatedText(summary.updatedAt)}</Text> : null}
        </View>
        <Text style={styles.heroTitle}>Find your next open door</Text>
        <Text style={styles.heroSub}>Jobs, scholarships, grants, hackathons and more — gathered from trusted sources. Apply directly on the original site.</Text>
        <View style={styles.heroStats}>
          <HeroStat icon="briefcase" text={totalCount ? `${totalCount.toLocaleString()} open` : 'Fresh daily'} />
          <HeroStat icon="shield" text={sources.length ? `${sources.length} sources` : 'Trusted sources'} />
          {summary && summary.openToAfrica ? <HeroStat icon="map-pin" text={`${summary.openToAfrica.toLocaleString()} open to Africa`} /> : null}
          <PressScale onPress={() => { switchView('listings'); selectKind('saved'); }} scaleTo={0.92} hitSlop={6} accessibilityLabel="View saved opportunities" style={styles.heroStat}>
            <Icon name="bookmark" size={13} color={colors.goldLight} />
            <Pop trigger={saved.length} amount={1.3}>
              <Text style={[styles.heroStatText, { color: colors.goldLight, fontWeight: '700' }]}>{saved.length}</Text>
            </Pop>
            <Text style={styles.heroStatText}>saved</Text>
          </PressScale>
        </View>
      </FadeInUp>

      {/* JOBS FEEDS: Listings | Directory */}
      <View style={styles.segment} accessibilityRole="tablist">
        {[['listings', 'Listings', 'briefcase'], ['directory', `Directory${dirTotal ? ` · ${dirTotal}` : ''}`, 'compass']].map(([v, label, icon]) => (
          <PressScale key={v} onPress={() => switchView(v)} scaleTo={0.96} accessibilityRole="tab" accessibilityState={{ selected: view === v }} accessibilityLabel={label} style={[styles.segmentBtn, view === v && styles.segmentBtnOn]}>
            <Icon name={icon} size={13} color={view === v ? colors.fg : colors.muted} />
            <Text style={[styles.segmentText, view === v && styles.segmentTextOn]} numberOfLines={1}>{label}</Text>
          </PressScale>
        ))}
      </View>

      {/* Search */}
      <View style={styles.searchBar}>
        <Icon name="search" size={16} color={colors.muted} />
        <TextInput
          placeholder={isDir ? 'Search 51 job & academic platforms…' : isSaved ? 'Search your saved listings…' : 'Search roles, scholarships, skills…'}
          placeholderTextColor={colors.faint}
          value={query}
          onChangeText={setQuery}
          style={styles.searchInput}
          accessibilityLabel="Search opportunities"
          returnKeyType="search"
          onSubmitEditing={() => setQ(query.trim())}
          autoCorrect={false}
        />
        {query ? (
          <ScaleIn>
            <PressScale onPress={() => { setQuery(''); setQ(''); }} hitSlop={10} scaleTo={0.85} accessibilityLabel="Clear search" style={styles.clearBtn}>
              <Icon name="x" size={11} color={colors.muted} strokeWidth={2.6} />
            </PressScale>
          </ScaleIn>
        ) : null}
      </View>

      {/* JOBS FEEDS: the 7 categories (filter listings and the directory) */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chipRow} keyboardShouldPersistTaps="handled">
        <Chip label="All categories" active={category === 'all'} onPress={() => selectCategory('all')} />
        {categoryChips.map((g) => (
          <Chip key={g.id} label={g.label} icon={g.icon} tint={g.tint} count={g.count} active={category === g.id} onPress={() => selectCategory(g.id)} />
        ))}
      </ScrollView>

      {/* Remote / Open to Africa toggles + kind chips (listings only) */}
      {!isDir ? (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.chipScroll, { marginTop: 8 }]} contentContainerStyle={styles.chipRow} keyboardShouldPersistTaps="handled">
        <PressScale
          onPress={() => { haptic('select'); setAfricaOnly((v) => !v); }}
          scaleTo={0.93}
          accessibilityRole="switch"
          accessibilityState={{ checked: africaOnly }}
          accessibilityLabel="Open to Africa"
          style={[styles.chip, styles.africaChip, africaOnly && styles.africaChipOn]}
        >
          <Icon name={africaOnly ? 'check' : 'map-pin'} size={13} color={africaOnly ? '#FFFFFF' : colors.sage} strokeWidth={africaOnly ? 2.6 : 2} />
          <Text style={[styles.chipText, { color: africaOnly ? '#FFFFFF' : colors.sage, fontWeight: '700' }]}>Open to Africa</Text>
        </PressScale>
        <PressScale
          onPress={() => { haptic('select'); setRemoteOnly((v) => !v); }}
          scaleTo={0.93}
          accessibilityRole="switch"
          accessibilityState={{ checked: remoteOnly }}
          accessibilityLabel="Remote only"
          style={[styles.chip, styles.remoteChip, remoteOnly && styles.remoteChipOn]}
        >
          <Icon name={remoteOnly ? 'check' : 'globe'} size={13} color={remoteOnly ? '#FFFFFF' : colors.sky} strokeWidth={remoteOnly ? 2.6 : 2} />
          <Text style={[styles.chipText, { color: remoteOnly ? '#FFFFFF' : colors.sky, fontWeight: '700' }]}>Remote only</Text>
        </PressScale>
        <View style={styles.chipDivider} />
        <Chip label="All" count={totalCount || null} active={kind === 'all'} onPress={() => selectKind('all')} />
        {kindChips.map((k) => (
          <Chip key={k.id} label={k.label} icon={kindMeta(k.id).icon} tint={kindMeta(k.id).tint} count={k.count} active={kind === k.id} onPress={() => selectKind(k.id)} />
        ))}
        <Chip label="Saved" icon="bookmark" tint={colors.gold} count={saved.length || null} active={isSaved} onPress={() => selectKind('saved')} />
      </ScrollView>
      ) : null}

      {/* JOBS FEEDS: one-source filter set from the directory */}
      {!isDir && sourceFilter ? (
        <View style={styles.sourcePillRow}>
          <PressScale onPress={() => { haptic('select'); setSourceFilter(null); }} scaleTo={0.94} accessibilityRole="button" accessibilityLabel={`Showing listings from ${sourceFilter.name}. Tap to show all sources`} style={styles.sourcePill}>
            <Text style={styles.sourcePillText} numberOfLines={1}>From {sourceFilter.name}</Text>
            <Icon name="x" size={11} color={colors.primary} strokeWidth={2.6} />
          </PressScale>
        </View>
      ) : null}

      {/* Result count / status line */}
      {statusText ? <Text style={styles.resultsCount}>{statusText}</Text> : <View style={{ height: 14 }} />}
      {error && items.length && !isSaved && !isDir ? (
        <View style={styles.inlineError}>
          <Icon name="x" size={12} color={colors.negative} strokeWidth={2.6} />
          <Text style={styles.inlineErrorText} numberOfLines={2}>Couldn’t refresh: {errorMessage(error)}</Text>
        </View>
      ) : null}
    </View>
  );

  let empty = null;
  if (isDir) {
    // JOBS FEEDS: directory states
    if (!api.online) empty = <EmptyCard icon="compass" title="Sign in online to see the directory" body="The Job & Academic Directory lists 51 trusted job, research and scholarship platforms. It needs an online BibleNestra account." />;
    else if (dirLoading || (!directory && !dirError)) empty = <View>{[0, 1, 2].map((i) => <SkeletonCard key={i} />)}</View>;
    else if (dirError) empty = <EmptyCard icon="x" tint={colors.negative} title="Couldn’t load the directory" body={`${errorMessage(dirError, 'Please check your connection.')}`} action="Try again" onAction={loadDirectory} />;
    else empty = <EmptyCard icon="search" title="No matching platforms" body="Try another search or category." action="Clear filters" onAction={clearFilters} />;
  } else if (isSaved) {
    empty = (
      <EmptyCard
        icon="bookmark"
        title={saved.length ? 'No saved matches' : 'Nothing saved yet'}
        body={saved.length ? 'Try a different search, or turn off “Remote only” / “Open to Africa”.' : 'Tap the bookmark on any listing to keep it here — saved listings stay on this device, even offline.'}
        action={saved.length ? 'Clear filters' : api.online ? 'Browse opportunities' : null}
        onAction={() => { if (saved.length) { setQuery(''); setQ(''); setRemoteOnly(false); setAfricaOnly(false); setCategory('all'); } else selectKind('all'); }}
      />
    );
  } else if (!api.online) {
    empty = (
      <EmptyCard
        icon="globe"
        title="Sign in online to see opportunities"
        body="Opportunities are gathered live from trusted sources, so they need an online BibleNestra account. Your saved listings are still available here."
        action={saved.length ? 'View saved' : null}
        onAction={() => selectKind('saved')}
      />
    );
  } else if (loading) {
    empty = (
      <View>
        {[0, 1, 2].map((i) => <SkeletonCard key={i} />)}
      </View>
    );
  } else if (error) {
    empty = (
      <EmptyCard
        icon="x"
        tint={colors.negative}
        title="Couldn’t load opportunities"
        body={`${errorMessage(error, 'Please check your connection.')} Pull down or tap below to try again.`}
        action="Try again"
        onAction={() => { loadSummary(); loadFirst(); }}
      />
    );
  } else {
    empty = (
      <EmptyCard
        icon="search"
        title="No matches"
        body={filtersOn ? 'Try another search or category, or turn off “Remote only” / “Open to Africa”. The Directory also links to 51 platforms you can search directly.' : 'New listings arrive throughout the day — check back soon.'}
        action={filtersOn ? 'Clear filters' : 'Refresh'}
        onAction={() => {
          if (filtersOn) clearFilters(); else onRefresh();
        }}
      />
    );
  }

  const footer = (
    <View style={{ marginTop: 6 }}>
      {loadingMore ? (
        <View style={styles.moreLoading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.moreLoadingText}>Loading more…</Text>
        </View>
      ) : !isSaved && !isDir && api.online && data.length && !hasMore && !loading ? (
        <Text style={styles.endText}>✦  You’ve reached the end</Text>
      ) : null}
      {isDir ? (
        <View style={styles.sourcesBox}>
          <View style={[styles.disclaimerRow, { marginTop: 0 }]}>
            <Icon name="shield" size={13} color={colors.faint} />
            <Text style={styles.disclaimerText}>These platforms are run by other organisations; BibleNestra isn’t affiliated with them. Platforms marked “Live in app” also feed listings into Opportunities. Never pay to apply for a job.</Text>
          </View>
        </View>
      ) : <SourcesFooter sources={sources} onOpen={openLink} />}
    </View>
  );

  const renderItem = ({ item, index }) => {
    // JOBS FEEDS: directory rows
    if (item.type === 'cat') return <DirectoryHeading cat={item.cat} n={item.n} />;
    if (item.type === 'entry') {
      return (
        <DirectoryCard
          entry={item.entry}
          onOpen={() => proceedToUrl(item.entry.url)}
          onListings={item.entry.live && item.entry.listings ? () => showSourceListings(item.entry) : null}
        />
      );
    }
    return (
      <FadeInUp index={Math.min(index % PAGE_STAGGER, 6)} distance={12} duration={360}>
        <OpportunityCard
          item={item}
          saved={savedIds.has(item.id)}
          onPress={() => setSelected(item)}
          onToggleSave={() => toggleSave(item)}
        />
      </FadeInUp>
    );
  };

  return (
    <Screen back title="Opportunities" subtitle="Jobs, scholarships, grants & more from trusted sources" scroll={false} padded={false}>
      <FlatList
        ref={listRef}
        data={data}
        keyExtractor={(it) => it.id}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        contentContainerStyle={styles.listContent}
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        scrollEventThrottle={16}        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        initialNumToRender={8}
        windowSize={11}
        // pull-to-refresh is native-only (react-native-web has no RefreshControl; web uses the empty-state "Refresh")
        refreshControl={api.online && !isSaved && !isDir && Platform.OS !== 'web' ? (
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        ) : undefined}
      />

      <OpportunitySheet
        item={selected}
        saved={selected ? savedIds.has(selected.id) : false}
        onClose={() => setSelected(null)}
        onToggleSave={() => selected && toggleSave(selected)}
        onOpen={openLink}
        onProceed={proceedToSite}
        onShare={share}
      />
      <CareerPrayerCard />
    </Screen>
  );
}

export default OpportunitiesScreen;

/** Entry card used by Jobs and Discover → opens the Opportunities screen. */
export function OpportunitiesEntryCard({ onPress, style }) {
  const chips = ['job', 'scholarship', 'grant', 'hackathon'];
  return (
    <PressScale onPress={onPress} scaleTo={0.98} accessibilityRole="button" accessibilityLabel="Open Opportunities worldwide" style={[styles.entry, style]}>
      <View style={styles.heroGlow} />
      <View style={styles.entryRow}>
        <View style={styles.entryIcon}>
          <Icon name="globe" size={20} color={colors.goldLight} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.entryEyebrow}>New · from trusted sources</Text>
          <Text style={styles.entryTitle}>Opportunities worldwide</Text>
          <Text style={styles.entrySub}>Jobs, scholarships, grants, hackathons & more</Text>
        </View>
        <View style={styles.entryArrow}>
          <Icon name="arrow-right" size={15} color={colors.night} strokeWidth={2.4} />
        </View>
      </View>
      <View style={styles.entryChips}>
        {chips.map((k) => (
          <View key={k} style={styles.entryChip}>
            <Icon name={kindMeta(k).icon} size={11} color={colors.goldLight} />
            <Text style={styles.entryChipText}>{kindMeta(k).label}</Text>
          </View>
        ))}
      </View>
    </PressScale>
  );
}

// ---------- pieces ----------
function HeroStat({ icon, text }) {
  return (
    <View style={styles.heroStat}>
      <Icon name={icon} size={13} color={colors.goldLight} />
      <Text style={styles.heroStatText}>{text}</Text>
    </View>
  );
}

function Chip({ label, icon, tint = colors.primary, count, active, onPress }) {
  return (
    <PressScale onPress={onPress} scaleTo={0.93} accessibilityRole="button" accessibilityState={{ selected: !!active }} accessibilityLabel={`${label}${count ? `, ${count}` : ''}`} style={[styles.chip, active && styles.chipActive]}>
      {icon ? <Icon name={icon} size={13} color={active ? '#FFFFFF' : tint} /> : null}
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
      {count ? (
        <View style={[styles.chipCount, active && styles.chipCountActive]}>
          <Text style={[styles.chipCountText, active && { color: '#FFFFFF' }]}>{count > 999 ? `${Math.floor(count / 1000)}k+` : count}</Text>
        </View>
      ) : null}
    </PressScale>
  );
}

function SaveButton({ saved, onPress, size = 34 }) {
  return (
    <PressScale
      onPress={onPress}
      hitSlop={8}
      scaleTo={0.85}
      accessibilityRole="button"
      accessibilityLabel={saved ? 'Remove from saved' : 'Save opportunity'}
      style={[styles.saveBtn, { width: size, height: size, borderRadius: size / 2 }, saved && styles.saveBtnOn]}
    >
      <Pop trigger={saved} amount={1.25}>
        <Icon name="bookmark" size={15} color={saved ? colors.goldMuted : colors.muted} fill={saved ? 'solid' : undefined} />
      </Pop>
    </PressScale>
  );
}

function OpportunityCard({ item, saved, onPress, onToggleSave }) {
  const meta = kindMeta(item.kind);
  const dl = deadlineInfo(item.deadline);
  const posted = !dl ? postedText(item.postedAt) : null;
  const place = placeText(item);
  // The save button is a sibling of the card's pressable (not nested): nested <button>s are invalid on web.
  return (
    <View style={styles.cardWrap}>
    <PressScale onPress={onPress} scaleTo={0.985} accessibilityRole="button" accessibilityLabel={`${item.title}${item.org ? ` at ${item.org}` : ''}, via ${item.source.name}`} style={styles.card}>
      <View style={styles.cardTop}>
        <View style={[styles.kindIcon, { backgroundColor: alpha(meta.tint, 0.12) }]}>
          <Icon name={meta.icon} size={15} color={meta.tint} />
        </View>
        <Badge label={meta.one} tint={meta.tint} />
        {item.remote && item.kind !== 'remote' ? <Badge label="Remote" tint={colors.sky} /> : null}
        {item.openTo ? <Badge label={OPEN_TO_LABEL[item.openTo]} tint={colors.sage} /> : null}
        <View style={{ flex: 1 }} />
        <View style={{ width: 34, height: 34 }} />
      </View>

      <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
      {item.org ? <Text style={styles.cardOrg} numberOfLines={1}>{item.org}</Text> : null}

      <View style={styles.metaWrap}>
        {place ? (
          <View style={styles.metaItem}>
            <Icon name="map-pin" size={12} color={colors.faint} />
            <Text style={styles.metaText} numberOfLines={1}>{place}</Text>
          </View>
        ) : null}
        {item.salary ? (
          <View style={styles.metaItem}>
            <Icon name="coin" size={12} color={colors.gold} />
            <Text style={[styles.metaText, styles.salaryText]} numberOfLines={1}>{item.salary}</Text>
          </View>
        ) : null}
      </View>

      {item.excerpt ? <Text style={styles.cardExcerpt} numberOfLines={2}>{item.excerpt}</Text> : null}

      <View style={styles.cardFooter}>
        {dl ? (
          <View style={[styles.datePill, dl.urgent && styles.datePillUrgent, dl.closed && styles.datePillClosed]}>
            <Icon name="clock" size={12} color={dl.urgent ? colors.negative : dl.closed ? colors.faint : colors.muted} />
            <Text style={[styles.dateText, dl.urgent && { color: colors.negative, fontWeight: '700' }, dl.closed && { color: colors.faint }]} numberOfLines={1}>{dl.text}</Text>
          </View>
        ) : posted ? (
          <Text style={styles.postedText} numberOfLines={1}>{posted}</Text>
        ) : <View />}
        <View style={{ flex: 1 }} />
        {/* JOBS FEEDS: source badge — every listing credits where it came from */}
        <View style={styles.viaBadge}>
          <Text style={styles.viaText} numberOfLines={1}>via <Text style={styles.viaName}>{item.source.name}</Text></Text>
          <Icon name="arrow-up-right" size={12} color={colors.primary} strokeWidth={2.2} />
        </View>
      </View>
    </PressScale>
    <View style={styles.cardSave}>
      <SaveButton saved={saved} onPress={onToggleSave} />
    </View>
    </View>
  );
}

function OpportunitySheet({ item, saved, onClose, onToggleSave, onOpen, onProceed, onShare }) {
  // keep the last item while the sheet animates closed
  const last = useRef(item);
  if (item) last.current = item;
  const it = item || last.current;
  if (!it) return null;
  const meta = kindMeta(it.kind);
  const dl = deadlineInfo(it.deadline);
  const posted = postedText(it.postedAt);
  const place = placeText(it);
  const applyVerb = ['job', 'remote', 'internship', 'scholarship', 'fellowship', 'grant', 'hackathon', 'competition', 'volunteer'].includes(it.kind) ? 'Apply' : 'View';
  const btnLabel = dl && dl.closed ? `View on ${it.source.name}` : `${applyVerb} on ${it.source.name}`;

  return (
    <AnimatedModal visible={!!item} onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Dismiss" />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Badge label={meta.one} tint={meta.tint} />
                {it.remote ? <Badge label="Remote" tint={colors.sky} /> : null}
                {it.openTo ? <Badge label={OPEN_TO_LABEL[it.openTo]} tint={colors.sage} /> : null}
              </View>
              <Text style={styles.sheetTitle}>{it.title}</Text>
              {it.org ? <Text style={styles.sheetOrg}>{it.org}</Text> : null}
            </View>
            <PressScale onPress={onClose} hitSlop={12} scaleTo={0.88} accessibilityLabel="Close" style={styles.closeBtn}>
              <Icon name="x" size={14} color={colors.fg} strokeWidth={2.4} />
            </PressScale>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
            {/* Facts */}
            <View style={styles.factsBox}>
              {place ? <Fact icon="map-pin" label="Location" value={place} /> : null}
              {it.salary ? <Fact icon="coin" label={it.kind === 'scholarship' || it.kind === 'grant' || it.kind === 'fellowship' ? 'Award' : 'Pay'} value={it.salary} /> : null}
              {dl ? <Fact icon="clock" label="Deadline" value={dl.text} urgent={dl.urgent} /> : null}
              {posted ? <Fact icon="calendar" label="Posted" value={posted.replace(/^Posted (\w)/, (_, c) => c.toUpperCase())} /> : null}
              {it.openTo ? <Fact icon="globe" label="Who" value={it.openTo === 'worldwide' ? 'Open worldwide' : OPEN_TO_LABEL[it.openTo]} /> : null}
              {it.category ? <Fact icon={catMeta(it.category).icon} label="Area" value={catMeta(it.category).label} /> : null}
              <Fact icon="link" label="Source" value={it.source.name} last />
            </View>

            {dl && dl.closed ? (
              <View style={styles.closedNote}>
                <Icon name="clock" size={13} color={colors.warning} />
                <Text style={styles.closedNoteText}>The deadline shown has passed. Check the original listing — it may have been extended or re-opened.</Text>
              </View>
            ) : null}

            {it.excerpt ? (
              <>
                <Text style={styles.sheetLabel}>About this opportunity</Text>
                <Text style={styles.sheetBody}>{it.excerpt}</Text>
                <Text style={styles.sheetHint}>This is a summary. The full description and how to apply are on {it.source.name}.</Text>
              </>
            ) : null}

            {it.tags && it.tags.length ? (
              <>
                <Text style={styles.sheetLabel}>Tags</Text>
                <View style={styles.tagsRow}>
                  {it.tags.map((t, i) => (
                    <View key={`${t}-${i}`} style={styles.tagChip}><Text style={styles.tagText}>{t}</Text></View>
                  ))}
                </View>
              </>
            ) : null}

            {/* Source credit */}
            <PressScale onPress={() => onOpen(it.source.url || it.url)} scaleTo={0.98} accessibilityRole="link" accessibilityLabel={`Listing via ${it.source.name}`} style={styles.creditBox}>
              <View style={styles.creditIcon}><Icon name="globe" size={15} color={colors.primary} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.creditTitle}>Listing via {it.source.name}</Text>
                <Text style={styles.creditSub} numberOfLines={1}>{hostOf(it.url) || hostOf(it.source.url) || 'Original site'}</Text>
              </View>
              <Icon name="arrow-up-right" size={14} color={colors.primary} strokeWidth={2.2} />
            </PressScale>

            <View style={styles.safetyNote}>
              <Icon name="shield" size={14} color={colors.gold} />
              <Text style={styles.safetyText}>{DISCLAIMER}</Text>
            </View>
          </ScrollView>

          {/* Actions */}
          <View style={styles.sheetActions}>
            <SaveButton saved={saved} onPress={onToggleSave} size={46} />
            <PressScale onPress={() => onShare(it)} hitSlop={6} scaleTo={0.88} accessibilityLabel="Share" style={styles.shareBtn}>
              <Icon name="share" size={16} color={colors.fg} />
            </PressScale>
            <PressScale
              onPress={() => (onProceed ? onProceed(it) : onOpen(it.url))}
              disabled={!it.url}
              scaleTo={0.96}
              accessibilityRole="link"
              accessibilityLabel={btnLabel}
              style={[styles.applyBtn, !it.url && { opacity: 0.4 }]}
            >
              <Text style={styles.applyBtnText} numberOfLines={1}>{btnLabel}</Text>
              <Icon name="arrow-up-right" size={15} color={colors.primaryFg} strokeWidth={2.4} />
            </PressScale>
          </View>
        </View>
      </View>
    </AnimatedModal>
  );
}

function hostOf(url) {
  if (!isWebUrl(url)) return null;
  const m = /^https?:\/\/([^/?#]+)/i.exec(url.trim());
  return m ? m[1].replace(/^www\./i, '') : null;
}

function Fact({ icon, label, value, urgent, last }) {
  return (
    <View style={[styles.fact, !last && styles.factDivider]}>
      <Icon name={icon} size={14} color={urgent ? colors.negative : colors.muted} />
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={[styles.factValue, urgent && { color: colors.negative }]} numberOfLines={2}>{value}</Text>
    </View>
  );
}

function SourcesFooter({ sources, onOpen }) {
  return (
    <View style={styles.sourcesBox}>
      {sources.length ? (
        <Text style={styles.sourcesText}>
          <Text style={styles.sourcesLead}>Listings come from: </Text>
          {sources.map((s, i) => (
            <Text key={s.key || s.name}>
              <Text
                style={s.url ? styles.sourceLink : styles.sourceName}
                onPress={s.url ? () => onOpen(s.url) : undefined}
                accessibilityRole={s.url ? 'link' : undefined}
              >
                {s.name}
              </Text>
              {i < sources.length - 1 ? ', ' : '.'}
            </Text>
          ))}
        </Text>
      ) : null}
      <View style={[styles.disclaimerRow, !sources.length && { marginTop: 0 }]}>
        <Icon name="shield" size={13} color={colors.faint} />
        <Text style={styles.disclaimerText}>{DISCLAIMER}</Text>
      </View>
    </View>
  );
}

// ---------- JOBS FEEDS: Job & Academic Directory ----------
function DirectoryHeading({ cat, n }) {
  const m = catMeta(cat.id);
  return (
    <View style={styles.dirHeading}>
      <View style={[styles.kindIcon, { backgroundColor: alpha(m.tint, 0.12) }]}>
        <Icon name={m.icon} size={15} color={m.tint} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.dirHeadingTitle}>{cat.label} <Text style={styles.dirHeadingCount}>· {n}</Text></Text>
        {cat.blurb ? <Text style={styles.dirHeadingBlurb}>{cat.blurb}</Text> : null}
      </View>
    </View>
  );
}

function DirectoryCard({ entry, onOpen, onListings }) {
  // Open is a sibling of the listings chip (no nested buttons on web)
  return (
    <View style={styles.dirCard}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.dirName} numberOfLines={1}>{entry.name}</Text>
        {entry.description ? <Text style={styles.dirDesc} numberOfLines={3}>{entry.description}</Text> : null}
        <View style={styles.dirMetaRow}>
          <Text style={styles.dirHost} numberOfLines={1}>{hostOf(entry.url) || ''}</Text>
          {entry.live ? (
            onListings ? (
              <PressScale onPress={onListings} scaleTo={0.94} accessibilityRole="button" accessibilityLabel={`See ${entry.listings} listings from ${entry.name} in the app`} style={styles.liveChip}>
                <View style={styles.liveDot} />
                <Text style={styles.liveChipText}>Live in app · {entry.listings}</Text>
              </PressScale>
            ) : (
              <View style={styles.liveChip}><View style={styles.liveDot} /><Text style={styles.liveChipText}>Live in app</Text></View>
            )
          ) : null}
        </View>
      </View>
      <PressScale onPress={onOpen} scaleTo={0.92} accessibilityRole="link" accessibilityLabel={`Open ${entry.name}`} style={styles.dirOpenBtn}>
        <Text style={styles.dirOpenText}>Open</Text>
        <Icon name="arrow-up-right" size={13} color={colors.primaryFg} strokeWidth={2.4} />
      </PressScale>
    </View>
  );
}

function EmptyCard({ icon, title, body, action, onAction, tint = colors.primary }) {
  return (
    <ScaleIn from={0.96} style={styles.emptyCard}>
      <View style={[styles.emptyIcon, { backgroundColor: alpha(tint, 0.1) }]}>
        <Icon name={icon} size={20} color={tint} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
      {action ? <Button small kind="ghost" label={action} style={{ marginTop: 14 }} onPress={onAction} /> : null}
    </ScaleIn>
  );
}

function SkeletonCard() {
  return (
    <View style={[styles.card, { opacity: 0.75, marginBottom: 12 }]}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <View style={[styles.sk, { width: 30, height: 30, borderRadius: 15 }]} />
        <View style={[styles.sk, { width: 70, height: 16, borderRadius: 8 }]} />
      </View>
      <View style={[styles.sk, { width: '85%', height: 18, marginTop: 14 }]} />
      <View style={[styles.sk, { width: '45%', height: 12, marginTop: 8 }]} />
      <View style={[styles.sk, { width: '95%', height: 11, marginTop: 14 }]} />
      <View style={[styles.sk, { width: '70%', height: 11, marginTop: 6 }]} />
    </View>
  );
}

// ---------- styles ----------
const EYEBROW = { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase' };

const styles = StyleSheet.create({
  listContent: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 56 },

  // Hero
  hero: {
    backgroundColor: colors.night,
    borderRadius: radius.lg,
    padding: 18,
    overflow: 'hidden',
    ...shadow.md,
  },
  heroGlow: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    right: -70,
    top: -90,
    backgroundColor: alpha(colors.goldLight, 0.16),
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  heroBadgeText: { ...EYEBROW, fontSize: 9.5, color: colors.nightFg },
  heroUpdated: { fontSize: 11, color: colors.nightMuted },
  heroTitle: { color: colors.nightFg, fontFamily: fonts.serifBold, fontSize: 24, lineHeight: 29, letterSpacing: -0.4, marginTop: 14 },
  heroSub: { color: colors.nightMuted, fontSize: 13, lineHeight: 18.5, marginTop: 5 },
  heroStats: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 14,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.nightBorder,
  },
  heroStat: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  heroStatText: { color: colors.nightFg, fontSize: 11.5, fontWeight: '500' },

  // Entry card (Jobs / Discover)
  entry: { backgroundColor: colors.night, borderRadius: radius.lg, padding: 16, overflow: 'hidden', ...shadow.md },
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  entryIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(212,168,82,0.18)', alignItems: 'center', justifyContent: 'center' },
  entryEyebrow: { ...EYEBROW, fontSize: 9.5, color: colors.goldLight },
  entryTitle: { color: colors.nightFg, fontFamily: fonts.serifBold, fontSize: 19, lineHeight: 23, letterSpacing: -0.3, marginTop: 2 },
  entrySub: { color: colors.nightMuted, fontSize: 12.5, marginTop: 2 },
  entryArrow: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.goldLight, alignItems: 'center', justifyContent: 'center' },
  entryChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  entryChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.10)' },
  entryChipText: { fontSize: 11, color: colors.nightFg, fontWeight: '600' },

  // Search & chips
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    height: 46,
    marginTop: 14,
    ...shadow.sm,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.fg, paddingVertical: 0, ...Platform.select({ web: { outlineStyle: 'none' }, default: {} }) },
  clearBtn: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  chipScroll: { marginHorizontal: -18, marginTop: 12 },
  chipRow: { gap: 8, paddingHorizontal: 18, paddingVertical: 2, alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 13,
    height: 36,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.fg, borderColor: colors.fg },
  chipText: { fontFamily: fonts.sansMedium, fontSize: 12.5, fontWeight: '500', color: colors.muted },
  chipTextActive: { color: '#FFFFFF', fontWeight: '700' },
  chipCount: { minWidth: 20, paddingHorizontal: 6, height: 18, borderRadius: 9, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  chipCountActive: { backgroundColor: 'rgba(255,255,255,0.18)' },
  chipCountText: { fontSize: 10.5, fontWeight: '700', color: colors.muted },
  remoteChip: { borderColor: alpha(colors.sky, 0.35), backgroundColor: colors.cardSky },
  remoteChipOn: { backgroundColor: colors.sky, borderColor: colors.sky },
  chipDivider: { width: 1, height: 20, backgroundColor: colors.borderStrong, marginHorizontal: 2 },
  resultsCount: { ...EYEBROW, color: colors.muted, marginTop: 16, marginBottom: 10 },
  inlineError: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10, padding: 10, borderRadius: radius.md, backgroundColor: colors.negativeFaint },
  inlineErrorText: { flex: 1, fontSize: 12.5, color: colors.negative, fontWeight: '600' },

  // Card
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 16,
    ...shadow.sm,
  },
  cardWrap: { position: 'relative', marginBottom: 12 },
  cardSave: { position: 'absolute', top: 16, right: 16 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  kindIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  saveBtn: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.raised },
  saveBtnOn: { backgroundColor: colors.cardGold },
  cardTitle: { fontFamily: fonts.serifBold, fontSize: 18, lineHeight: 23.5, letterSpacing: -0.3, color: colors.fg, marginTop: 10 },
  cardOrg: { fontSize: 13, color: colors.fg, fontWeight: '600', marginTop: 3 },
  metaWrap: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 4, marginTop: 8 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '100%' },
  metaText: { fontSize: 12.5, color: colors.muted, flexShrink: 1 },
  salaryText: { color: colors.goldMuted, fontWeight: '700' },
  cardExcerpt: { fontSize: 13.5, color: colors.muted, lineHeight: 19.5, marginTop: 10 },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderStrong,
  },
  datePill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.raised, flexShrink: 1 },
  datePillUrgent: { backgroundColor: colors.negativeFaint },
  datePillClosed: { backgroundColor: colors.sunken },
  dateText: { fontSize: 11.5, color: colors.muted, fontWeight: '600' },
  postedText: { fontSize: 11.5, color: colors.faint, flexShrink: 1 },
  viaText: { fontSize: 11.5, color: colors.faint, flexShrink: 1, textAlign: 'right' },
  viaName: { color: colors.primary, fontWeight: '700' },
  // JOBS FEEDS
  viaBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.primarySoft, flexShrink: 1, maxWidth: '62%' },
  segment: { flexDirection: 'row', gap: 4, padding: 4, marginTop: 14, borderRadius: radius.pill, backgroundColor: colors.raised },
  segmentBtn: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 36, paddingHorizontal: 10, borderRadius: radius.pill },
  segmentBtnOn: { backgroundColor: colors.surface, ...shadow.sm },
  segmentText: { flexShrink: 1, fontSize: 12.5, fontWeight: '600', color: colors.muted },
  segmentTextOn: { color: colors.fg, fontWeight: '700' },
  africaChip: { borderColor: alpha(colors.sage, 0.4), backgroundColor: alpha(colors.sage, 0.08) },
  africaChipOn: { backgroundColor: colors.sage, borderColor: colors.sage },
  sourcePillRow: { flexDirection: 'row', marginTop: 10 },
  sourcePill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 30, borderRadius: radius.pill, backgroundColor: colors.primarySoft, maxWidth: '100%' },
  sourcePillText: { fontSize: 12.5, fontWeight: '700', color: colors.primaryInk, flexShrink: 1 },
  dirHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 10, marginBottom: 10 },
  dirHeadingTitle: { fontFamily: fonts.serifBold, fontSize: 18, color: colors.fg, letterSpacing: -0.2 },
  dirHeadingCount: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.faint, fontWeight: '600' },
  dirHeadingBlurb: { fontSize: 12.5, color: colors.muted, lineHeight: 17.5, marginTop: 2 },
  dirCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: 14, marginBottom: 10, ...shadow.sm },
  dirName: { fontSize: 15.5, fontWeight: '700', color: colors.fg },
  dirDesc: { fontSize: 13, color: colors.muted, lineHeight: 18.5, marginTop: 3 },
  dirMetaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  dirHost: { fontSize: 11.5, color: colors.faint, flexShrink: 1 },
  liveChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: alpha(colors.sage, 0.12) },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.sage },
  liveChipText: { fontSize: 11, fontWeight: '700', color: colors.sage },
  dirOpenBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 36, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.primaryBg },
  dirOpenText: { fontSize: 13, fontWeight: '700', color: colors.primaryFg },

  // Footer
  moreLoading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 14 },
  moreLoadingText: { fontSize: 12.5, color: colors.muted },
  endText: { textAlign: 'center', fontSize: 12, color: colors.faint, paddingVertical: 12 },
  sourcesBox: {
    marginTop: 10,
    padding: 14,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
  },
  sourcesText: { fontSize: 12.5, lineHeight: 19, color: colors.muted },
  sourcesLead: { fontWeight: '700', color: colors.fg },
  sourceLink: { color: colors.primary, fontWeight: '600', textDecorationLine: 'underline' },
  sourceName: { color: colors.fg, fontWeight: '600' },
  disclaimerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 10 },
  disclaimerText: { flex: 1, fontSize: 11.5, lineHeight: 17, color: colors.faint },

  // Empty / skeleton
  emptyCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingVertical: 28,
    paddingHorizontal: 24,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 14,
    marginBottom: 6,
    ...shadow.sm,
  },
  emptyIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontFamily: fonts.serifBold, fontSize: 18, color: colors.fg, marginTop: 12, textAlign: 'center' },
  emptyBody: { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 19, marginTop: 4, maxWidth: 290 },
  sk: { backgroundColor: colors.raised, borderRadius: 6 },

  // Sheet
  modalOverlay: { flex: 1, backgroundColor: 'transparent', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.screen,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 8,
    height: '86%',
    ...shadow.lg,
  },
  grabber: { alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: 10 },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 18, paddingBottom: 14 },
  sheetTitle: { fontFamily: fonts.serifBold, fontSize: 22, lineHeight: 27, letterSpacing: -0.3, color: colors.fg, marginTop: 8 },
  sheetOrg: { fontSize: 14, color: colors.muted, fontWeight: '600', marginTop: 3 },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  factsBox: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    ...shadow.sm,
  },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11 },
  factDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderStrong },
  factLabel: { ...EYEBROW, fontSize: 9.5, color: colors.faint, width: 74 },
  factValue: { flex: 1, fontSize: 13.5, color: colors.fg, fontWeight: '600', textAlign: 'right' },
  closedNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 12, padding: 11, borderRadius: radius.md, backgroundColor: colors.warningFaint },
  closedNoteText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: colors.fg },
  sheetLabel: { ...EYEBROW, color: colors.muted, marginTop: 20, marginBottom: 8 },
  sheetBody: { fontSize: 14.5, lineHeight: 22, color: colors.passage },
  sheetHint: { fontSize: 12, color: colors.faint, marginTop: 8, fontStyle: 'italic' },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tagChip: { backgroundColor: colors.raised, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  tagText: { fontSize: 12, color: colors.fg, fontWeight: '500' },
  creditBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 20,
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
  },
  creditIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  creditTitle: { fontSize: 14, fontWeight: '700', color: colors.primaryInk },
  creditSub: { fontSize: 12, color: colors.primary, marginTop: 1 },
  safetyNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    marginTop: 12,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: alpha(colors.gold, 0.08),
    borderWidth: 1,
    borderColor: alpha(colors.gold, 0.18),
  },
  safetyText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: colors.muted },
  sheetActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderStrong,
    backgroundColor: colors.screen,
  },
  applyBtn: {
    flex: 1,
    minWidth: 0,
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryBg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 18,
    ...shadow.sm,
  },
  applyBtnText: { flexShrink: 1, fontFamily: fonts.sansMedium, fontSize: 14, fontWeight: '700', color: colors.primaryFg },
  shareBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

// ---------- Brief 12.4: opening prayer for "Christian Career & Opportunities Worldwide" ----------
// Shown when the user opens Opportunities (or the Jobs marketplace), at most once per day (date kept on the device).
export const CAREER_PRAYER = 'May the Lord open doors of global opportunities for you. May He connect you with the right people, grant you favour and establish you in the career you desire. May your dream job become a testimony. In Jesus’ name, Amen.';
const PRAYER_KEY = 'bn.careerPrayer.lastShown';
const localDay = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export function CareerPrayerCard() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      let last = null;
      try { last = await AsyncStorage.getItem(PRAYER_KEY); } catch (e) { /* storage unavailable → show it */ }
      if (alive && last !== localDay()) setVisible(true);
    })();
    return () => { alive = false; };
  }, []);
  const close = () => {
    haptic('success');
    setVisible(false);
    AsyncStorage.setItem(PRAYER_KEY, localDay()).catch(() => {});
  };
  return (
    <AnimatedModal visible={visible} onRequestClose={close}>
      <View style={prayerStyles.overlay}>
        <View style={prayerStyles.card} accessibilityRole="alert">
          <NightGlow intensity={1.1} />
          <View style={prayerStyles.icon}><Text style={prayerStyles.iconText}>🙏</Text></View>
          <Text style={prayerStyles.eyebrow}>A prayer for your career</Text>
          <Text style={prayerStyles.body}>“{CAREER_PRAYER}”</Text>
          <ScaleIn delay={250} style={{ alignSelf: 'stretch' }}>
            <PressScale onPress={close} scaleTo={0.96} accessibilityRole="button" accessibilityLabel="Amen, continue" style={prayerStyles.btn}>
              <Text style={prayerStyles.btnText}>Amen 🙏 Continue</Text>
            </PressScale>
          </ScaleIn>
        </View>
      </View>
    </AnimatedModal>
  );
}

const prayerStyles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 22 },
  card: { width: '100%', maxWidth: 400, borderRadius: 28, backgroundColor: colors.night, paddingHorizontal: 24, paddingTop: 26, paddingBottom: 22, alignItems: 'center', overflow: 'hidden', ...shadow.md },
  icon: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(212,168,82,0.18)', alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 28 },
  eyebrow: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.3, textTransform: 'uppercase', color: colors.goldLight, marginTop: 14 },
  body: { fontFamily: fonts.serifItalic, fontSize: 18, lineHeight: 27, color: colors.nightFg, textAlign: 'center', marginTop: 12 },
  btn: { marginTop: 22, height: 52, borderRadius: 26, backgroundColor: colors.goldLight, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 16, fontWeight: '800', color: colors.night },
});
