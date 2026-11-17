// MEDIA LIBRARY screens — Audio Library + Christian Books (PDF), personal and group uploads.
//   MediaLibrary   hub: Audio | Books, search, continue, featured, categories (Play All), my uploads, my groups
//   MediaList      one list: a category, search results, my uploads, a user's uploads or a group's library
//   MediaUpload    upload audio / PDF (personal, group, or — admins — the platform library) with CoverMaker
//   BookReader     pdf.js reader (pre-roll ad break first), remembers the last page
// Audio plays through the global player (src/audio/Player.js) so it keeps going anywhere in the app.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Screen, Button, Empty, Notice, alpha } from '../components/ui';
import { Icon } from '../components/Icons';
import { colors, fonts, radius, shadow } from '../theme';
import { useNav } from '../navigation';
import { useToast } from '../components/Toast';
import { AnimatedModal, FadeInUp, PressScale } from '../components/Motion';
import { errorMessage } from '../api/client';
import { useLibraryApi, toTrack, fmtDuration, MAX_UPLOAD } from '../api/library';
import { useAudioPlayer } from '../audio/Player';
import { useAdBreaks } from '../ads/AdBreaks';
import { CoverField } from '../components/media/CoverMaker';
import PdfReader from '../components/media/PdfReader';

let AV = null;
try { AV = require('expo-av'); } catch (e) { AV = null; } // eslint-disable-line global-require

const KIND_LABEL = { audio: { one: 'audio', title: 'Audio Library', icon: 'headphones', by: 'Speaker / artist' }, pdf: { one: 'book', title: 'Christian Books', icon: 'book', by: 'Author' } };
const PAGE_KEY = (id) => `bn.lib.page.${id}`;

// ---------- shared bits ----------
function Cover({ uri, size = 56, kind = 'audio', style }) {
  const h = kind === 'pdf' ? Math.round(size * 1.38) : size;
  return (
    <View style={[{ width: size, height: h, borderRadius: kind === 'pdf' ? 6 : 10, backgroundColor: alpha(colors.primary, 0.1), overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, style]}>
      {uri ? <Image source={{ uri }} style={{ width: size, height: h }} resizeMode="cover" /> : <Icon name={kind === 'pdf' ? 'book' : 'headphones'} size={size * 0.38} color={colors.primary} />}
    </View>
  );
}

function SearchBox({ value, onChange, placeholder, onSubmit }) {
  return (
    <View style={styles.search}>
      <Icon name="search" size={16} color={colors.faint} />
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.faint} style={styles.searchInput} returnKeyType="search" onSubmitEditing={onSubmit} />
      {value ? <Pressable onPress={() => onChange('')} hitSlop={8}><Icon name="x" size={14} color={colors.faint} /></Pressable> : null}
    </View>
  );
}

function OfflineNotice() {
  return <Empty title="Sign in to use the library" body="The Audio Library and Christian Books stream from BibleNestra’s servers, so they need an online account." />;
}

/** Plays audio items through the global player; opens books in the reader. */
function useOpenItem() {
  const nav = useNav();
  const player = useAudioPlayer();
  return useCallback((item, list, { category } = {}) => {
    if (item.kind === 'pdf') { nav.push('BookReader', { item }); return; }
    const audio = (list || [item]).filter((x) => x.kind === 'audio');
    const i = Math.max(0, audio.findIndex((x) => x.id === item.id));
    player.playQueue(audio.map(toTrack), i, { category: category || (item.category && item.category.slug) });
  }, [player.playQueue]);
}

function ItemRow({ item, list, onMenu, category }) {
  const open = useOpenItem();
  const player = useAudioPlayer();
  const on = item.kind === 'audio' && player.isCurrent(item.id);
  const prog = item.myProgress && !item.myProgress.completed && item.myProgress.position > 0;
  const meta = [item.artist, item.kind === 'audio' ? (item.durationSec ? fmtDuration(item.durationSec) : null) : (item.pages ? `${item.pages} pages` : null)].filter(Boolean).join(' · ');
  return (
    <PressScale scaleTo={0.985} onPress={() => open(item, list, { category })} style={[styles.row, on && styles.rowOn]} accessibilityLabel={`${item.kind === 'pdf' ? 'Read' : 'Play'} ${item.title}`}>
      <Cover uri={item.coverUrl} kind={item.kind} size={item.kind === 'pdf' ? 44 : 56} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowTitle} numberOfLines={2}>{item.title}</Text>
        {meta ? <Text style={styles.rowSub} numberOfLines={1}>{meta}</Text> : null}
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
          {prog ? <Text style={styles.chip}>{item.kind === 'pdf' ? `Page ${Math.round(item.myProgress.position)}` : `Resume ${fmtDuration(item.myProgress.position)}`}</Text> : null}
          {item.scope === 'group' && item.community ? <Text style={styles.chipMuted}>{item.community.name}</Text> : null}
          {item.scope !== 'platform' && item.inLibrary ? <Text style={styles.chipMuted}>In library</Text> : null}
          {item.visibility === 'private' ? <Text style={styles.chipMuted}>Private</Text> : null}
          {item.status === 'hidden' ? <Text style={[styles.chipMuted, { color: colors.rose }]}>Hidden</Text> : null}
        </View>
      </View>
      <View style={[styles.playDot, on && player.playing && { backgroundColor: colors.gold }]}>
        <Icon name={item.kind === 'pdf' ? 'book' : on && player.playing ? 'pause' : 'play'} size={14} color="#fff" />
      </View>
      {onMenu ? <Pressable onPress={() => onMenu(item)} hitSlop={10} style={{ padding: 4 }} accessibilityLabel={`More options for ${item.title}`}><Icon name="more" size={18} color={colors.muted} /></Pressable> : null}
    </PressScale>
  );
}

function ItemMenu({ item, onClose, onChanged, isAdmin }) {
  const lib = useLibraryApi();
  const toast = useToast();
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');
  if (!item) return null;
  const act = async (fn, msg) => {
    try { await fn(); toast.show(msg, { icon: 'check' }); onChanged && onChanged(); onClose(); } catch (e) { toast.show(errorMessage(e), { icon: 'x' }); }
  };
  return (
    <AnimatedModal visible={!!item} onRequestClose={onClose}>
      <View style={styles.sheet}>
        <Text style={styles.sheetTitle} numberOfLines={2}>{item.title}</Text>
        {item.description ? <Text style={styles.sheetBody} numberOfLines={6}>{item.description}</Text> : null}
        {reporting ? (
          <>
            <TextInput value={reason} onChangeText={setReason} placeholder="What’s wrong? (optional)" placeholderTextColor={colors.faint} style={styles.input} maxLength={300} />
            <Button label="Send report" kind="danger" onPress={() => act(() => lib.report(item.id, reason), 'Thanks — our team will review it')} style={{ marginTop: 10 }} />
          </>
        ) : (
          <View style={{ gap: 8, marginTop: 12 }}>
            {isAdmin && !item.inLibrary && item.scope !== 'platform' ? (
              <Button label="Publish to BibleNestra library" onPress={() => act(() => lib.publish(item.id, { inLibrary: true, rightsAttested: item.kind === 'pdf' ? item.rightsAttested : undefined }), 'Published — everyone can find it now')} />
            ) : null}
            {isAdmin && item.inLibrary && item.scope !== 'platform' ? <Button kind="ghost" label="Remove from library (keep in group/profile)" onPress={() => act(() => lib.publish(item.id, { inLibrary: false }), 'Removed from the library')} /> : null}
            {item.canEdit && item.scope === 'personal' ? (
              <Button kind="ghost" label={item.visibility === 'private' ? 'Show on my profile' : 'Make private'} onPress={() => act(() => lib.update(item.id, { visibility: item.visibility === 'private' ? 'public' : 'private' }), 'Saved')} />
            ) : null}
            {item.canEdit ? <Button kind="danger" label="Delete" onPress={() => act(() => lib.remove(item.id), 'Deleted')} /> : null}
            {!item.canEdit ? <Button kind="ghost" label="Report" onPress={() => setReporting(true)} /> : null}
            <Button kind="ghost" label="Close" onPress={onClose} />
          </View>
        )}
      </View>
    </AnimatedModal>
  );
}

// ============================================ hub ============================================
export function MediaLibraryScreen({ params = {} }) {
  const nav = useNav();
  const lib = useLibraryApi();
  const player = useAudioPlayer();
  const [kind, setKind] = useState(params.kind === 'pdf' ? 'pdf' : 'audio');
  const [home, setHome] = useState(null);
  const [cont, setCont] = useState([]);
  const [me, setMe] = useState({ isAdmin: false, items: [] });
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [menu, setMenu] = useState(null);
  const L = KIND_LABEL[kind];

  const load = useCallback(async () => {
    if (!lib.online) return;
    setErr(null);
    try {
      const [h, c, g] = await Promise.all([lib.home(kind), lib.continueList(kind).catch(() => ({ items: [] })), lib.myGroups().catch(() => ({ items: [], isAdmin: false }))]);
      setHome(h); setCont(c.items || []); setMe(g);
    } catch (e) { setErr(errorMessage(e)); }
  }, [lib, kind]);
  useEffect(() => { setHome(null); setResults(null); setQ(''); load(); }, [kind, lib.online]);

  // search (debounced)
  useEffect(() => {
    if (!q.trim()) { setResults(null); return undefined; }
    const t = setTimeout(() => { lib.list({ kind, q: q.trim(), limit: 30 }).then((r) => setResults(r.items)).catch(() => setResults([])); }, 300);
    return () => clearTimeout(t);
  }, [q, kind]);

  if (!lib.online) return <Screen title="Audio & Books" back><OfflineNotice /></Screen>;
  const uploadBtn = (
    <Pressable onPress={() => nav.push('MediaUpload', { kind, scope: 'personal' })} hitSlop={10} accessibilityLabel={`Upload ${L.one}`} style={styles.headBtn}>
      <Icon name="plus" size={18} color={colors.fg} />
    </Pressable>
  );
  return (
    <Screen title="Audio & Books" back right={uploadBtn} refreshControl={undefined}>
      <View style={styles.seg}>
        {[['audio', 'Audio Library', 'headphones'], ['pdf', 'Christian Books', 'book']].map(([k, label, icon]) => (
          <Pressable key={k} onPress={() => setKind(k)} style={[styles.segBtn, kind === k && styles.segOn]} accessibilityRole="tab" accessibilityState={{ selected: kind === k }}>
            <Icon name={icon} size={15} color={kind === k ? colors.fg : colors.muted} />
            <Text style={[styles.segText, kind === k && styles.segTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <SearchBox value={q} onChange={setQ} placeholder={kind === 'pdf' ? 'Search books, authors…' : 'Search sermons, worship, speakers…'} />
      {err ? <Notice text={err} tint={colors.rose} /> : null}

      {results ? (
        <View style={{ marginTop: 14 }}>
          <Text style={styles.h}>{results.length ? `Results for “${q.trim()}”` : 'No matches'}</Text>
          {results.map((it) => <ItemRow key={it.id} item={it} list={results} onMenu={setMenu} />)}
        </View>
      ) : !home ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <>
          {cont.length ? (
            <Section title={kind === 'pdf' ? 'Continue reading' : 'Continue listening'}>
              {cont.slice(0, 4).map((it) => <ItemRow key={it.id} item={it} list={cont} onMenu={setMenu} />)}
            </Section>
          ) : null}
          {home.featured.length ? (
            <Section title="Featured">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 18 }} style={{ marginHorizontal: -2 }}>
                {home.featured.map((it) => <Tile key={it.id} item={it} list={home.featured} />)}
              </ScrollView>
            </Section>
          ) : null}
          {home.categories.map((cat) => (
            <Section
              key={cat.id}
              title={cat.name}
              count={cat.items.length}
              onMore={() => nav.push('MediaList', { kind, scope: 'library', category: cat.id, categorySlug: cat.slug, title: cat.name })}
              onPlayAll={kind === 'audio' && cat.items.length ? async () => {
                // Play All: the whole category, not only the first row
                let all = cat.items;
                try { const r = await lib.list({ kind, scope: 'library', category: cat.id, limit: 50 }); if (r.items.length) all = r.items; } catch (e) { /* use the row */ }
                player.playQueue(all.map(toTrack), 0, { category: cat.slug });
              } : null}
            >
              {cat.items.length ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 18 }}>
                  {cat.items.map((it) => <Tile key={it.id} item={it} list={cat.items} category={cat.slug} />)}
                </ScrollView>
              ) : <Text style={styles.emptyLine}>Nothing here yet.</Text>}
            </Section>
          ))}
          {home.uncategorized.length ? (
            <Section title="More">
              {home.uncategorized.map((it) => <ItemRow key={it.id} item={it} list={home.uncategorized} onMenu={setMenu} />)}
            </Section>
          ) : null}

          <Section title="Yours">
            <EntryRow icon="user" title={kind === 'pdf' ? 'My books' : 'My audio'} sub="Your uploads — shown on your profile unless private" onPress={() => nav.push('MediaList', { kind, scope: 'mine', title: kind === 'pdf' ? 'My books' : 'My audio' })} />
            {me.items.map((g) => (
              <EntryRow key={g.id} icon="users" title={g.name} sub={`${kind === 'pdf' ? g.pdfCount : g.audioCount} ${kind === 'pdf' ? 'books' : 'recordings'} · group only${g.canUpload ? ' · you can upload' : ''}`}
                onPress={() => nav.push('MediaList', { kind, scope: 'group', communityId: g.id, title: g.name, canUpload: g.canUpload })} />
            ))}
            {me.isAdmin ? (
              <EntryRow icon="shield" title={`Add to the ${L.title}`} sub="Admins: publish for every user" onPress={() => nav.push('MediaUpload', { kind, scope: 'platform' })} />
            ) : null}
          </Section>
        </>
      )}
      <ItemMenu item={menu} onClose={() => setMenu(null)} onChanged={load} isAdmin={me.isAdmin} />
    </Screen>
  );
}

function Section({ title, children, onMore, onPlayAll, count }) {
  return (
    <View style={{ marginTop: 22 }}>
      <View style={styles.secHead}>
        <Text style={styles.h} numberOfLines={1}>{title}</Text>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          {onPlayAll ? (
            <Pressable onPress={onPlayAll} style={styles.playAll} accessibilityLabel={`Play all ${title}`}>
              <Icon name="play" size={12} color="#fff" /><Text style={styles.playAllText}>Play all</Text>
            </Pressable>
          ) : null}
          {onMore && count ? <Pressable onPress={onMore} hitSlop={8}><Text style={styles.more}>See all</Text></Pressable> : null}
        </View>
      </View>
      {children}
    </View>
  );
}

function Tile({ item, list, category }) {
  const open = useOpenItem();
  const player = useAudioPlayer();
  const on = item.kind === 'audio' && player.isCurrent(item.id);
  const w = item.kind === 'pdf' ? 112 : 138;
  return (
    <PressScale scaleTo={0.97} onPress={() => open(item, list, { category })} style={{ width: w }} accessibilityLabel={`${item.kind === 'pdf' ? 'Read' : 'Play'} ${item.title}`}>
      <View>
        <Cover uri={item.coverUrl} kind={item.kind} size={w} style={shadow.sm} />
        {item.kind === 'audio' ? (
          <View style={[styles.tilePlay, on && player.playing && { backgroundColor: colors.gold }]}><Icon name={on && player.playing ? 'pause' : 'play'} size={13} color="#fff" /></View>
        ) : null}
      </View>
      <Text style={styles.tileTitle} numberOfLines={2}>{item.title}</Text>
      {item.artist ? <Text style={styles.tileSub} numberOfLines={1}>{item.artist}</Text> : null}
    </PressScale>
  );
}

function EntryRow({ icon, title, sub, onPress }) {
  return (
    <PressScale scaleTo={0.985} onPress={onPress} style={styles.entry}>
      <View style={styles.entryIcon}><Icon name={icon} size={17} color={colors.primary} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.rowSub} numberOfLines={1}>{sub}</Text>
      </View>
      <Icon name="chevron-right" size={16} color={colors.faint} />
    </PressScale>
  );
}

// ============================================ list ============================================
export function MediaListScreen({ params = {} }) {
  const nav = useNav();
  const lib = useLibraryApi();
  const player = useAudioPlayer();
  const kind = params.kind === 'pdf' ? 'pdf' : 'audio';
  const scope = params.scope || 'library';
  const [items, setItems] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState(null);
  const [menu, setMenu] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const base = { kind, scope, category: params.category, communityId: params.communityId, userId: params.userId };
  const load = useCallback(async (more = false) => {
    setErr(null);
    try {
      const r = await lib.list({ ...base, q: q.trim(), cursor: more ? cursor : undefined, limit: 30 });
      setItems((cur) => (more && cur ? [...cur, ...r.items] : r.items));
      setCursor(r.cursor);
    } catch (e) { setErr(errorMessage(e)); setItems((cur) => cur || []); }
  }, [lib, q, cursor, params.category, params.communityId, scope]);
  useEffect(() => { if (lib.online) { const t = setTimeout(() => load(false), q ? 300 : 0); return () => clearTimeout(t); } return undefined; }, [q, lib.online]);
  useEffect(() => { if (lib.online) lib.myGroups().then((g) => setIsAdmin(!!g.isAdmin)).catch(() => {}); }, [lib.online]);
  if (!lib.online) return <Screen title={params.title || 'Library'} back><OfflineNotice /></Screen>;
  const canUpload = scope === 'mine' || (scope === 'group' && params.canUpload);
  const right = canUpload ? (
    <Pressable onPress={() => nav.push('MediaUpload', { kind, scope: scope === 'mine' ? 'personal' : 'group', communityId: params.communityId, communityName: params.title })} hitSlop={10} style={styles.headBtn} accessibilityLabel="Upload">
      <Icon name="plus" size={18} color={colors.fg} />
    </Pressable>
  ) : null;
  const audio = (items || []).filter((x) => x.kind === 'audio');
  return (
    <Screen title={params.title || KIND_LABEL[kind].title} subtitle={scope === 'group' ? 'Group library · members only' : scope === 'mine' ? 'Your uploads' : undefined} back right={right}>
      <SearchBox value={q} onChange={setQ} placeholder="Search this list" />
      {kind === 'audio' && audio.length > 1 ? (
        <Button label={`Play all · ${audio.length}`} icon={<Icon name="play" size={13} color="#fff" />} onPress={() => player.playQueue(audio.map(toTrack), 0, { category: params.categorySlug })} style={{ marginTop: 12 }} />
      ) : null}
      {err ? <Notice text={err} tint={colors.rose} /> : null}
      {!items ? <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} /> : items.length ? (
        <View style={{ marginTop: 10 }}>
          {items.map((it) => <ItemRow key={it.id} item={it} list={items} onMenu={setMenu} category={params.categorySlug} />)}
          {cursor ? <Button kind="ghost" label="Load more" onPress={() => load(true)} style={{ marginTop: 10 }} /> : null}
        </View>
      ) : (
        <Empty
          title={q ? 'No matches' : scope === 'group' ? 'This group’s library is empty' : scope === 'mine' ? `You haven’t uploaded any ${kind === 'pdf' ? 'books' : 'audio'} yet` : 'Nothing here yet'}
          body={canUpload ? (scope === 'group' ? 'Add recordings for your members — they stay inside the group.' : 'Share sermons, songs and teaching on your profile.') : undefined}
          action={canUpload ? 'Upload' : undefined}
          onAction={() => nav.push('MediaUpload', { kind, scope: scope === 'mine' ? 'personal' : 'group', communityId: params.communityId, communityName: params.title })}
        />
      )}
      <ItemMenu item={menu} onClose={() => setMenu(null)} onChanged={() => load(false)} isAdmin={isAdmin} />
    </Screen>
  );
}

// ============================================ upload ============================================
async function probeDuration(asset) {
  try {
    if (Platform.OS === 'web') {
      return await new Promise((resolve) => {
        const a = document.createElement('audio');
        a.preload = 'metadata'; a.muted = true;
        const src = asset.file ? URL.createObjectURL(asset.file) : asset.uri;
        a.onloadedmetadata = () => { resolve(Number.isFinite(a.duration) ? Math.round(a.duration) : null); if (asset.file) URL.revokeObjectURL(src); };
        a.onerror = () => resolve(null);
        a.src = src;
      });
    }
    if (!AV) return null;
    const { sound, status } = await AV.Audio.Sound.createAsync({ uri: asset.uri }, { shouldPlay: false, isMuted: true, volume: 0 });
    const d = status && status.durationMillis ? Math.round(status.durationMillis / 1000) : null;
    sound.unloadAsync().catch(() => {});
    return d;
  } catch (e) { return null; }
}

export function MediaUploadScreen({ params = {} }) {
  const nav = useNav();
  const lib = useLibraryApi();
  const toast = useToast();
  const kind = params.kind === 'pdf' ? 'pdf' : 'audio';
  const scope = params.scope || 'personal';
  const L = KIND_LABEL[kind];
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [desc, setDesc] = useState('');
  const [cats, setCats] = useState([]);
  const [cat, setCat] = useState(null);
  const [cover, setCover] = useState(null);
  const [isPrivate, setPrivate] = useState(false);
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => { if (lib.online) lib.categories(kind).then((r) => setCats(r.items)).catch(() => {}); }, [kind, lib.online]);

  const pick = async () => {
    setErr(null);
    try {
      const DocumentPicker = require('expo-document-picker'); // eslint-disable-line global-require
      const res = await DocumentPicker.getDocumentAsync({ type: kind === 'pdf' ? 'application/pdf' : 'audio/*', copyToCacheDirectory: true, multiple: false });
      if (res.canceled || !res.assets || !res.assets[0]) return;
      const a = res.assets[0];
      const f = { uri: a.uri, name: a.name || L.one, mimeType: a.mimeType, size: a.size || (a.file && a.file.size) || 0, file: a.file || null };
      if (f.size > MAX_UPLOAD[kind]) { setErr(`That file is too large — up to ${Math.round(MAX_UPLOAD[kind] / 1048576)} MB`); return; }
      setFile(f);
      if (!title) setTitle(f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim());
      if (kind === 'audio') probeDuration(f).then((d) => setFile((cur) => (cur && cur.uri === f.uri ? { ...cur, durationSec: d } : cur)));
    } catch (e) { setErr('Couldn’t open the file picker'); }
  };

  const submit = async () => {
    if (!file) { setErr(`Choose ${kind === 'pdf' ? 'a PDF' : 'an audio file'} first`); return; }
    if (!title.trim()) { setErr('Add a title'); return; }
    if (kind === 'pdf' && !rights) { setErr('Please confirm you have the right to share this book'); return; }
    setErr(null);
    try {
      let coverKey = null;
      if (cover && cover.uri) { setBusy('Uploading cover…'); coverKey = await lib.uploadCover(cover.uri); }
      setBusy('Uploading… 0%');
      const up = await lib.uploadFile(kind, file, (p) => setBusy(`Uploading… ${Math.round(p * 100)}%`));
      setBusy('Saving…');
      await lib.create({
        kind, scope, communityId: params.communityId, fileKey: up.key, title: title.trim(), artist: artist.trim(), description: desc.trim(),
        categoryId: cat, coverKey, durationSec: file.durationSec || undefined, visibility: isPrivate ? 'private' : 'public', rightsAttested: rights,
      });
      toast.show(scope === 'platform' ? 'Published — available to everyone now' : scope === 'group' ? 'Added to the group library' : 'Uploaded to your profile', { icon: 'check', haptic: 'success' });
      nav.pop();
    } catch (e) { setErr(errorMessage(e)); }
    setBusy(null);
  };

  if (!lib.online) return <Screen title="Upload" back><OfflineNotice /></Screen>;
  const where = scope === 'platform' ? `the ${L.title} (everyone)` : scope === 'group' ? `${params.communityName || 'the group'} (members only)` : 'your profile';
  return (
    <Screen title={kind === 'pdf' ? 'Upload a book' : 'Upload audio'} subtitle={`To ${where}`} back>
      <PressScale onPress={pick} style={styles.filePick} accessibilityLabel="Choose file">
        <Icon name={kind === 'pdf' ? 'book' : 'music'} size={22} color={colors.primary} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.rowTitle} numberOfLines={1}>{file ? file.name : kind === 'pdf' ? 'Choose a PDF' : 'Choose an audio file'}</Text>
          <Text style={styles.rowSub}>{file ? [file.size ? `${(file.size / 1048576).toFixed(1)} MB` : null, file.durationSec ? fmtDuration(file.durationSec) : null].filter(Boolean).join(' · ') : kind === 'pdf' ? 'PDF up to 60 MB' : 'MP3, M4A, AAC, WAV, OGG or FLAC · up to 95 MB'}</Text>
        </View>
        <Text style={styles.more}>{file ? 'Change' : 'Browse'}</Text>
      </PressScale>

      <Text style={styles.label}>Title</Text>
      <TextInput value={title} onChangeText={setTitle} style={styles.input} placeholder={kind === 'pdf' ? 'Book title' : 'e.g. Grace that holds — Romans 8'} placeholderTextColor={colors.faint} maxLength={160} />
      <Text style={styles.label}>{L.by}</Text>
      <TextInput value={artist} onChangeText={setArtist} style={styles.input} placeholder={kind === 'pdf' ? 'Author' : 'Pastor, choir, artist…'} placeholderTextColor={colors.faint} maxLength={120} />
      <Text style={styles.label}>Description</Text>
      <TextInput value={desc} onChangeText={setDesc} style={[styles.input, { height: 90, paddingTop: 10, textAlignVertical: 'top' }]} multiline placeholder="What is it about?" placeholderTextColor={colors.faint} maxLength={4000} />
      <Text style={styles.label}>Category</Text>
      <View style={styles.chips}>
        {cats.map((c) => (
          <Pressable key={c.id} onPress={() => setCat(cat === c.id ? null : c.id)} style={[styles.catChip, cat === c.id && styles.catChipOn]}>
            <Text style={[styles.catChipText, cat === c.id && { color: '#fff' }]}>{c.name}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.label}>Cover</Text>
      <CoverField value={cover} onChange={setCover} title={title} subtitle={artist} />
      {scope === 'personal' ? (
        <Pressable onPress={() => setPrivate(!isPrivate)} style={styles.check}>
          <View style={[styles.box, isPrivate && styles.boxOn]}>{isPrivate ? <Icon name="check" size={12} color="#fff" strokeWidth={3} /> : null}</View>
          <Text style={styles.checkText}>Private — only I can see this (not shown on my profile)</Text>
        </Pressable>
      ) : null}
      {kind === 'pdf' ? (
        <Pressable onPress={() => setRights(!rights)} style={[styles.check, styles.rightsBox]}>
          <View style={[styles.box, rights && styles.boxOn]}>{rights ? <Icon name="check" size={12} color="#fff" strokeWidth={3} /> : null}</View>
          <Text style={styles.checkText}>I confirm this book is in the public domain, or that I have the author’s / publisher’s permission to share it for free. I won’t upload copyrighted books without permission.</Text>
        </Pressable>
      ) : null}
      {scope === 'group' ? <Text style={styles.note}>Group uploads stay inside the group. Only BibleNestra admins can publish them to the public library.</Text> : null}
      {err ? <Notice text={err} tint={colors.rose} /> : null}
      <Button label={busy || (scope === 'platform' ? 'Upload & publish' : 'Upload')} disabled={!!busy} onPress={submit} style={{ marginTop: 18 }} />
    </Screen>
  );
}

// ============================================ reader ============================================
export function BookReaderScreen({ params = {} }) {
  const nav = useNav();
  const lib = useLibraryApi();
  const breaks = useAdBreaks();
  const [item, setItem] = useState(params.item || null);
  const [ready, setReady] = useState(false);
  const [startPage, setStartPage] = useState(1);
  const [page, setPage] = useState(null);
  const [err, setErr] = useState(null);
  const saveT = useRef(null);
  const latest = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // fresh copy: signed link + server-side last page
        const it = lib.online ? await lib.item(params.id || (params.item && params.item.id)) : params.item;
        if (!alive) return;
        setItem(it);
        let p = it.myProgress && it.myProgress.position ? Math.round(it.myProgress.position) : 1;
        try { const local = Number(await AsyncStorage.getItem(PAGE_KEY(it.id))); if (local > 0 && !(it.myProgress && it.myProgress.position)) p = local; } catch (e) { /* none */ }
        setStartPage(Math.max(1, p));
        // Ad break before opening the book (never blocks for long; continues if no ad is shown)
        await breaks.run({ kind: 'pdf', placement: 'pre', contentId: it.id, category: it.category ? it.category.slug : undefined });
        if (alive) setReady(true);
      } catch (e) { if (alive) setErr(errorMessage(e)); }
    })();
    return () => { alive = false; };
  }, []);

  const save = (p, pages) => {
    if (!item) return;
    latest.current = { p, pages };
    clearTimeout(saveT.current);
    saveT.current = setTimeout(() => {
      AsyncStorage.setItem(PAGE_KEY(item.id), String(p)).catch(() => {});
      if (lib.online) lib.saveProgress(item.id, p, pages ? p >= pages : false);
    }, 1200);
  };
  useEffect(() => () => {
    clearTimeout(saveT.current);
    const l = latest.current;
    if (l && item) { AsyncStorage.setItem(PAGE_KEY(item.id), String(l.p)).catch(() => {}); if (lib.online) lib.saveProgress(item.id, l.p, l.pages ? l.p >= l.pages : false); }
  }, [item]);

  const url = useMemo(() => (item && ready ? lib.viewerUrl(item, startPage) : null), [item, ready, startPage]);
  return (
    <View style={{ flex: 1, backgroundColor: '#2B2A33' }}>
      <View style={styles.readerBar}>
        <Pressable onPress={() => nav.pop()} hitSlop={12} style={styles.readerBack} accessibilityLabel="Back">
          <Icon name="chevron-left" size={20} color={colors.nightFg} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.readerTitle} numberOfLines={1}>{item ? item.title : 'Book'}</Text>
          <Text style={styles.readerSub} numberOfLines={1}>{[item && item.artist, page ? `Page ${page.p} of ${page.pages}` : null].filter(Boolean).join(' · ')}</Text>
        </View>
      </View>
      {err ? <View style={{ padding: 24 }}><Text style={{ color: colors.nightFg }}>{err}</Text></View> : !url ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.goldLight} /><Text style={styles.readerSub}>Opening…</Text></View>
      ) : (
        <PdfReader
          url={url}
          onReady={(p, pages) => { setPage({ p, pages }); if (lib.online && item && !item.pages) lib.played(item.id, { pages }); else if (lib.online && item) lib.played(item.id, {}); }}
          onPage={(p, pages) => { setPage({ p, pages }); save(p, pages); }}
          onError={(m) => setErr(m)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  headBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  seg: { flexDirection: 'row', backgroundColor: colors.raised, borderRadius: radius.pill, padding: 3, marginBottom: 12 },
  segBtn: { flex: 1, height: 38, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  segOn: { backgroundColor: colors.surface, ...shadow.sm },
  segText: { fontSize: 13.5, fontWeight: '700', color: colors.muted },
  segTextOn: { color: colors.fg },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 14, height: 44 },
  searchInput: { flex: 1, fontSize: 15, color: colors.fg, height: 44, outlineStyle: 'none' },
  h: { fontFamily: fonts.serifBold, fontSize: 19, color: colors.fg, flexShrink: 1 },
  secHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 10 },
  more: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  playAll: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.primary, paddingHorizontal: 12, height: 30, borderRadius: radius.pill },
  playAllText: { color: '#fff', fontWeight: '800', fontSize: 12.5 },
  emptyLine: { color: colors.faint, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: 8 },
  rowOn: { borderColor: colors.gold, backgroundColor: colors.cardGold },
  rowTitle: { fontSize: 14.5, fontWeight: '700', color: colors.fg },
  rowSub: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  chip: { fontSize: 11, fontWeight: '700', color: colors.gold, backgroundColor: colors.goldFaint, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, overflow: 'hidden' },
  chipMuted: { fontSize: 11, fontWeight: '700', color: colors.muted, backgroundColor: colors.raised, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, overflow: 'hidden' },
  playDot: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  tilePlay: { position: 'absolute', right: 8, bottom: 8, width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  tileTitle: { fontSize: 13.5, fontWeight: '700', color: colors.fg, marginTop: 8 },
  tileSub: { fontSize: 12, color: colors.muted, marginTop: 1 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: 8 },
  entryIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  sheet: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 20, margin: 16, ...shadow.lg },
  sheetTitle: { fontFamily: fonts.serifBold, fontSize: 19, color: colors.fg },
  sheetBody: { color: colors.muted, fontSize: 13.5, lineHeight: 19, marginTop: 8 },
  label: { fontSize: 11, fontWeight: '800', color: colors.muted, letterSpacing: 1.1, textTransform: 'uppercase', marginTop: 18, marginBottom: 8 },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, height: 46, color: colors.fg, fontSize: 15, marginTop: 4 },
  filePick: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.borderStrong, backgroundColor: colors.surface },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catChip: { paddingHorizontal: 12, height: 32, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, justifyContent: 'center' },
  catChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  catChipText: { fontSize: 13, fontWeight: '700', color: colors.fg },
  check: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 16 },
  rightsBox: { padding: 12, borderRadius: radius.md, backgroundColor: colors.cardGold },
  box: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, marginTop: 1 },
  boxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkText: { flex: 1, fontSize: 13, color: colors.fg, lineHeight: 18 },
  note: { fontSize: 12.5, color: colors.muted, marginTop: 14, lineHeight: 17 },
  readerBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: colors.night },
  readerBack: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  readerTitle: { color: colors.nightFg, fontWeight: '700', fontSize: 15 },
  readerSub: { color: colors.nightMuted, fontSize: 12, marginTop: 1 },
});
