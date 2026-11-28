import { isDarkScheme } from '../design/palette';
// MEMBER WEBSITES
//   WebsitesScreen       — the directory of published websites (+ "My websites" for admins / when member submission is on)
//   AddWebsiteScreen     — admins publish a website straight away; members only while website_feed.public_submission is on (then reviewed)
// Brief 11.2: Website Feed is ADMIN-ONLY for now — ordinary users only view / open websites. Role + flag come from GET /me.
//   WebsiteViewerScreen  — the website running inside Bible Nestra (WebView): links, videos, forms and its own ads
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Image, Linking, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Clipboard from 'expo-clipboard';
import { Screen, Button, Notice, Empty } from '../components/ui';
import { Icon } from '../components/Icons';
import { FadeInUp } from '../components/Motion';
import { useToast } from '../components/Toast';
import { colors, fonts, radius } from '../theme';
import { useNav } from '../navigation';
import { d, df, Grad, Tap } from '../design/sanctuary';
import { DScreen, DButton } from '../design/profile/parts';
import { useApi } from '../api/auth';
import { useSync } from '../api/sync';
import { errorMessage } from '../api/client';
import { useWebsites, useMyWebsites, addWebsite, removeWebsite, countOpen } from '../api/websites';
import WebsiteFrame from '../components/WebsiteFrame';

// { isAdmin, canSubmit } from /me — members can submit only when the server flag is on
function useWebsiteRole() {
  const sync = useSync();
  const me = (sync && sync.me) || {};
  const isAdmin = !!me.isAdmin;
  return { isAdmin, canSubmit: isAdmin || !!me.websitePublicSubmission };
}

const STATUS = {
  pending: { label: 'In review', tint: colors.gold },
  approved: { label: 'Live', tint: colors.teal || '#2E7D6B' },
  rejected: { label: 'Not approved', tint: colors.negative || '#B83A3A' },
  hidden: { label: 'Hidden by admin', tint: colors.muted },
};

export function openWebsite(nav, api, w) {
  if (!w || !w.url) return;
  if (w.id && api && api.online) countOpen(api.request, w.id);
  nav.push('WebsiteViewer', { url: w.url, title: w.title, host: w.host });
}

// ---------- a website card (directory + feed strip) ----------
export function WebsiteCard({ site, onPress, compact }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [compact ? styles.miniCard : styles.card, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel={`Open ${site.title}`}>
      {site.image ? (
        <Image source={{ uri: site.image }} style={compact ? styles.miniCover : styles.cover} resizeMode="cover" />
      ) : (
        <View style={[compact ? styles.miniCover : styles.cover, styles.coverEmpty]}><Icon name="globe" size={compact ? 22 : 28} color={colors.primary} /></View>
      )}
      <View style={compact ? styles.miniBody : styles.body}>
        <View style={styles.titleRow}>
          {site.icon ? <Image source={{ uri: site.icon }} style={styles.favicon} /> : null}
          <Text style={styles.title} numberOfLines={1}>{site.title}</Text>
        </View>
        <Text style={styles.host} numberOfLines={1}>{site.host}{site.category ? ` · ${site.category}` : ''}</Text>
        {!compact && site.description ? <Text style={styles.desc} numberOfLines={2}>{site.description}</Text> : null}
        {!compact && site.owner && site.owner.displayName ? <Text style={styles.owner} numberOfLines={1}>By {site.owner.displayName}</Text> : null}
      </View>
    </Pressable>
  );
}

// ---------- directory ----------
export function WebsitesScreen() {
  const nav = useNav();
  const api = useApi();
  const toast = useToast();
  const [cat, setCat] = useState(null);
  const sites = useWebsites({ category: cat });
  const mine = useMyWebsites();
  const { isAdmin, canSubmit } = useWebsiteRole();
  const cats = mine.categories && mine.categories.length ? mine.categories : ['Ministry', 'Church', 'Blog', 'Business', 'Education', 'Media', 'Charity', 'Other'];

  const remove = async (w) => {
    try { await removeWebsite(api.request, w.id); toast.show('Website removed', { icon: 'trash' }); mine.refresh(); sites.refresh(); }
    catch (e) { toast.show(errorMessage(e, 'Couldn’t remove it'), { tone: 'error' }); }
  };

  if (!api.online) {
    return <DScreen back onBack={() => nav.pop()} title="Member websites" subtitle="Trusted destinations" action={null}><Empty title="Sign in to see member websites" body="Member websites need the online version of Bible Nestra." /></DScreen>;
  }
  const canAdd = isAdmin || (canSubmit && (!mine.items || mine.items.filter((w) => w.status !== 'rejected').length < (mine.max || 3)));

  return (
    <DScreen back onBack={() => nav.pop()} title="Member websites" subtitle="Trusted destinations" action={null}>
      <FadeInUp>
        {/* .website-feature: the design's dark feature card, with the real team copy */}
        <Grad colors={['#2D1D13', '#88451F']} style={styles.hero}>
          <Icon name="globe" size={28} color={d.gold} />
          <Text style={styles.heroEyebrow}>{canSubmit && !isAdmin ? 'FROM OUR MEMBERS' : 'CHOSEN BY OUR TEAM'}</Text>
          <Text style={styles.heroTitle}>Visit trusted Christian websites without leaving Bible Nestra</Text>
          <Text style={styles.heroBody}>Every website here was checked by our team. It opens right inside the app.</Text>
          {canAdd ? (
            <Tap onPress={() => nav.push('AddWebsite')} style={styles.heroBtn} accessibilityRole="button" accessibilityLabel={isAdmin ? 'Add website' : 'Add your website'}>
              <Icon name="plus" size={14} color="#FFC29A" />
              <Text style={styles.heroBtnText}>{isAdmin ? 'Add website' : 'Add your website'}</Text>
            </Tap>
          ) : null}
        </Grad>
      </FadeInUp>

      {canSubmit && mine.items && mine.items.length ? (
        <View style={{ marginTop: 6 }}>
          <Text style={styles.section}>{isAdmin ? 'Websites you published' : 'My websites'}</Text>
          {mine.items.map((w) => {
            const s = STATUS[w.status] || STATUS.pending;
            return (
              <View key={w.id} style={styles.mineRow}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.title} numberOfLines={1}>{w.title}</Text>
                  <Text style={styles.host} numberOfLines={1}>{w.host}</Text>
                  {w.status === 'rejected' && w.rejectReason ? <Text style={styles.reason}>{w.rejectReason}</Text> : null}
                  {w.status === 'pending' ? <Text style={styles.reason}>An admin will review it soon. You’ll get a notification.</Text> : null}
                </View>
                <View style={[styles.statusChip, { backgroundColor: `${s.tint}22` }]}><Text style={[styles.statusText, { color: s.tint }]}>{s.label}</Text></View>
                {w.status === 'approved' ? (
                  <Pressable onPress={() => openWebsite(nav, api, w)} hitSlop={8} style={styles.iconBtn} accessibilityLabel={`Open ${w.title}`}><Icon name="arrow-up-right" size={16} color={d.ink} /></Pressable>
                ) : null}
                <Pressable onPress={() => remove(w)} hitSlop={8} style={styles.iconBtn} accessibilityLabel={`Remove ${w.title}`}><Icon name="trash" size={15} color={d.muted} /></Pressable>
              </View>
            );
          })}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
        <Tap onPress={() => nav.push('WebsiteFeed')} style={styles.heroBtn} accessibilityRole="button" accessibilityLabel="Website feed"><Icon name="globe" size={14} color="#FFC29A" /><Text style={styles.heroBtnText}>Website feed</Text></Tap>
        {canSubmit ? <Tap onPress={() => nav.push('WebsiteIntegration')} style={styles.heroBtn} accessibilityRole="button" accessibilityLabel="Connect and publish"><Icon name="link" size={14} color="#FFC29A" /><Text style={styles.heroBtnText}>Connect &amp; publish</Text></Tap> : null}
      </View>

      <Text style={styles.section}>Explore</Text>
      <View style={styles.chips}>
        {[null, ...cats].map((c) => {
          const on = cat === c;
          return (
            <Tap key={c || 'all'} onPress={() => setCat(c)} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{c || 'All'}</Text>
            </Tap>
          );
        })}
      </View>

      <View style={{ marginTop: 12 }}>
        {sites.items === null ? (
          <ActivityIndicator color={d.plum} style={{ marginTop: 30 }} />
        ) : sites.error ? (
          <Empty title="Couldn’t load websites" body={sites.error} action="Try again" onAction={sites.refresh} />
        ) : !sites.items.length ? (
          <Empty title="No websites yet" body={cat ? `No ${cat.toLowerCase()} websites yet.` : (isAdmin ? 'Tap “Add website” to publish the first one.' : 'New websites are added by our team. Check back soon.')} />
        ) : (
          sites.items.map((w) => <WebsiteCard key={w.id} site={w} onPress={() => openWebsite(nav, api, w)} />)
        )}
        {sites.hasMore ? <DButton small label="Show more" onPress={sites.loadMore} style={{ marginTop: 12, alignSelf: 'center' }} /> : null}
      </View>
      <Text style={styles.footer}>Websites are run by their owners, not Bible Nestra. Their own adverts may show. Report anything inappropriate to our team.</Text>
    </DScreen>
  );
}

// ---------- add your website ----------
export function AddWebsiteScreen() {
  const nav = useNav();
  const api = useApi();
  const toast = useToast();
  const mine = useMyWebsites();
  const { isAdmin, canSubmit } = useWebsiteRole();
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [cat, setCat] = useState(null);
  const [own, setOwn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const cats = mine.categories && mine.categories.length ? mine.categories : ['Ministry', 'Church', 'Blog', 'Business', 'Education', 'Media', 'Charity', 'Other'];

  const submit = async () => {
    setErr(null);
    if (!url.trim()) { setErr('Enter your website address'); return; }
    if (!own && !isAdmin) { setErr('Please confirm this is your own website'); return; }
    setBusy(true);
    try {
      await addWebsite(api.request, { url: url.trim(), title: title.trim() || undefined, description: desc.trim() || undefined, category: cat || undefined, owner: true });
      toast.show(isAdmin ? 'Website published' : 'Sent for review · you’ll be notified', { icon: 'check', haptic: 'success' });
      nav.pop();
    } catch (e) { setErr(errorMessage(e, 'Couldn’t add the website')); }
    setBusy(false);
  };

  if (!canSubmit) {
    return <Screen back title="Websites"><Empty title="Only administrators add websites for now" body="You can open every published website from the Websites directory." /></Screen>;
  }

  return (
    <DScreen back onBack={() => nav.pop()} title={isAdmin ? 'Add website' : 'Add your website'} subtitle="Trusted destinations" action={null}>
      <Notice text={isAdmin ? 'Websites you add are published straight away: members see them in the Websites directory and the Socials feed and open them inside Bible Nestra.' : 'Add a website you own, such as your ministry, church, blog or business. Our team checks it first; once approved, members can open it inside Bible Nestra, with its own pages, videos and adverts.'} />
      <Text style={styles.label}>Website address</Text>
      <TextInput value={url} onChangeText={setUrl} placeholder="https://yourministry.org" placeholderTextColor={colors.faint} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={styles.input} accessibilityLabel="Website address" />
      <Text style={styles.label}>Name (optional)</Text>
      <TextInput value={title} onChangeText={setTitle} placeholder="Leave empty to use the website’s own name" placeholderTextColor={colors.faint} maxLength={120} style={styles.input} accessibilityLabel="Name" />
      <Text style={styles.label}>Short description (optional)</Text>
      <TextInput value={desc} onChangeText={setDesc} placeholder="What will members find there?" placeholderTextColor={colors.faint} maxLength={500} multiline style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]} accessibilityLabel="Description" />
      <Text style={styles.label}>Category</Text>
      <View style={styles.chips}>
        {cats.map((c) => {
          const on = cat === c;
          return (
            <Pressable key={c} onPress={() => setCat(on ? null : c)} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{c}</Text>
            </Pressable>
          );
        })}
      </View>
      {isAdmin ? null : <Pressable onPress={() => setOwn(!own)} style={styles.checkRow} accessibilityRole="checkbox" accessibilityState={{ checked: own }}>
        <View style={[styles.checkbox, own && styles.checkboxOn]}>{own ? <Icon name="check" size={13} color="#FFFFFF" strokeWidth={3} /> : null}</View>
        <Text style={styles.checkText}>This is my own website (or I manage it for my church or ministry)</Text>
      </Pressable>}
      {err ? <Text style={styles.error}>{err}</Text> : null}
      <DButton label={busy ? (isAdmin ? 'Publishing…' : 'Sending…') : (isAdmin ? 'Publish website' : 'Send for review')} onPress={submit} disabled={busy} style={{ marginTop: 16 }} />
    </DScreen>
  );
}

// ---------- the website inside the app ----------
export function WebsiteViewerScreen({ params = {} }) {
  const nav = useNav();
  const toast = useToast();
  const frame = useRef(null);
  const url = typeof params.url === 'string' && /^https:\/\//i.test(params.url) ? params.url : null;
  const [nav2, setNav2] = useState({ url, title: params.title || '', canGoBack: false, canGoForward: false });
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(null);
  const [menu, setMenu] = useState(false);
  const isWeb = Platform.OS === 'web';

  // Android back: go back inside the website first, then close the viewer
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (menu) { setMenu(false); return true; }
      if (nav2.canGoBack && frame.current) { frame.current.goBack(); return true; }
      nav.pop();
      return true;
    });
    return () => sub.remove();
  }, [nav2.canGoBack, menu]);

  const current = nav2.url || url;
  let host = params.host || '';
  try { host = new URL(current).hostname.replace(/^www\./, ''); } catch (e) { /* keep */ }
  const openOutside = () => { setMenu(false); if (current) WebBrowser.openBrowserAsync(current).catch(() => Linking.openURL(current).catch(() => {})); };
  const share = async () => { setMenu(false); try { await Share.share({ message: `${nav2.title || params.title || host}\n${current}` }); } catch (e) { /* ignore */ } };
  const copy = async () => { setMenu(false); try { await Clipboard.setStringAsync(current); toast.show('Link copied', { icon: 'link' }); } catch (e) { /* ignore */ } };

  if (!url) return <Screen back title="Website"><Empty title="This website can’t be opened" /></Screen>;

  return (
    <View style={styles.viewer}>
      <View style={styles.bar}>
        <Pressable onPress={() => nav.pop()} hitSlop={10} style={styles.barBtn} accessibilityLabel="Close website"><Icon name="x" size={19} color={colors.fg} /></Pressable>
        <Pressable onPress={() => frame.current && frame.current.goBack()} disabled={!nav2.canGoBack} hitSlop={8} style={[styles.barBtn, !nav2.canGoBack && { opacity: 0.3 }]} accessibilityLabel="Back"><Icon name="chevron-left" size={20} color={colors.fg} /></Pressable>
        <View style={{ flex: 1, minWidth: 0, paddingHorizontal: 6 }}>
          <Text style={styles.barTitle} numberOfLines={1}>{nav2.title || params.title || host}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name="lock" size={10} color={colors.muted} />
            <Text style={styles.barHost} numberOfLines={1}>{host}</Text>
          </View>
        </View>
        <Pressable onPress={() => { setFailed(null); frame.current && frame.current.reload(); }} hitSlop={8} style={styles.barBtn} accessibilityLabel="Reload"><Icon name="repost" size={17} color={colors.fg} /></Pressable>
        <Pressable onPress={() => setMenu(!menu)} hitSlop={8} style={styles.barBtn} accessibilityLabel="More"><Icon name="more" size={19} color={colors.fg} /></Pressable>
      </View>
      {progress > 0 && progress < 1 ? <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} /></View> : <View style={styles.progressTrack} />}
      {isWeb ? (
        <Pressable onPress={openOutside} style={styles.webNote}><Text style={styles.webNoteText}>Website not showing? Some sites only open in their own tab. Tap to open it in a new tab.</Text></Pressable>
      ) : null}
      <View style={{ flex: 1 }}>
        {failed ? (
          <View style={styles.failBox}>
            <Icon name="globe" size={30} color={colors.muted} />
            <Text style={styles.failTitle}>This website couldn’t be opened</Text>
            <Text style={styles.failBody}>{failed}</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <Button small label="Try again" onPress={() => { setFailed(null); frame.current && frame.current.reload(); }} />
              <Button small kind="ghost" label="Open in browser" onPress={openOutside} />
            </View>
          </View>
        ) : (
          <WebsiteFrame
            ref={frame}
            url={url}
            onNav={(s) => setNav2((p) => ({ ...p, ...s, title: s.title && !/^https?:\/\//.test(s.title) ? s.title : p.title }))}
            onProgress={setProgress}
            onLoaded={() => setProgress(1)}
            onFail={(m) => setFailed(m)}
          />
        )}
      </View>
      {menu ? (
        <>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenu(false)} accessibilityLabel="Close menu" />
          <View style={styles.menu}>
            <Pressable onPress={openOutside} style={styles.menuItem}><Icon name="arrow-up-right" size={15} color={colors.fg} /><Text style={styles.menuText}>Open in browser</Text></Pressable>
            <Pressable onPress={share} style={styles.menuItem}><Icon name="share" size={15} color={colors.fg} /><Text style={styles.menuText}>Share website</Text></Pressable>
            <Pressable onPress={copy} style={styles.menuItem}><Icon name="link" size={15} color={colors.fg} /><Text style={styles.menuText}>Copy link</Text></Pressable>
            {nav2.canGoForward ? <Pressable onPress={() => { setMenu(false); frame.current && frame.current.goForward(); }} style={styles.menuItem}><Icon name="chevron-right" size={15} color={colors.fg} /><Text style={styles.menuText}>Forward</Text></Pressable> : null}
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: 25, padding: 23, marginBottom: 14 },
  heroEyebrow: { marginTop: 28, color: '#F4BE98', fontSize: 9, letterSpacing: 1.2, fontFamily: df.sansHeavy },
  heroTitle: { color: '#FFFFFF', fontFamily: df.display, fontSize: 27, lineHeight: 30, marginTop: 8 },
  heroBody: { color: '#D8C3B5', fontFamily: df.sans, fontSize: 11, lineHeight: 16, marginTop: 8 },
  heroBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 18, alignSelf: 'flex-start' },
  heroBtnText: { color: '#FFC29A', fontFamily: df.sansBold, fontSize: 11 },
  section: { fontFamily: df.displayBold, fontSize: 20, color: d.ink, marginTop: 28, marginBottom: 13 },
  card: { backgroundColor: d.paper, borderRadius: 20, borderWidth: 1, borderColor: d.line, overflow: 'hidden', marginTop: 12 },
  cover: { width: '100%', aspectRatio: 1.91, backgroundColor: d.lavender },
  coverEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: d.lavender },
  body: { padding: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  favicon: { width: 18, height: 18, borderRadius: 4 },
  title: { fontSize: 13, fontFamily: df.display, color: d.ink, flexShrink: 1 },
  host: { fontSize: 9, fontFamily: df.sans, color: d.muted, marginTop: 3 },
  desc: { fontSize: 10.5, fontFamily: df.sans, color: d.ink, marginTop: 6, lineHeight: 16 },
  owner: { fontSize: 9, fontFamily: df.sans, color: d.muted, marginTop: 6 },
  miniCard: { width: 210, backgroundColor: d.paper, borderRadius: 16, borderWidth: 1, borderColor: d.line, overflow: 'hidden', marginRight: 10 },
  miniCover: { width: '100%', height: 96, backgroundColor: d.lavender },
  miniBody: { padding: 10 },
  mineRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 17, backgroundColor: d.paper, borderWidth: 1, borderColor: d.line, marginBottom: 8 },
  statusChip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  statusText: { fontSize: 10, fontFamily: df.sansBold },
  reason: { fontSize: 10, fontFamily: df.sans, color: d.muted, marginTop: 4 },
  iconBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: d.paper, borderWidth: 1, borderColor: d.line },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { paddingVertical: 9, paddingHorizontal: 13, borderRadius: 10, backgroundColor: d.paper, borderWidth: 1, borderColor: d.line },
  chipOn: { backgroundColor: d.plum, borderColor: d.plum },
  chipText: { fontSize: 11, fontFamily: df.sansBold, color: d.muted },
  chipTextOn: { color: '#FFFFFF' },
  footer: { fontSize: 10, fontFamily: df.sans, color: d.muted, lineHeight: 15, marginTop: 22 },
  label: { marginTop: 18, marginBottom: 8, fontSize: 10, fontFamily: df.sansBold, color: (isDarkScheme() ? '#CDBBA6' : '#4C3D32') },
  input: { height: 52, borderWidth: 1, borderColor: d.line, backgroundColor: d.paper, borderRadius: 14, paddingHorizontal: 14, fontSize: 12, fontFamily: df.sans, color: d.ink },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.borderStrong || colors.border, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkText: { flex: 1, fontSize: 13.5, color: colors.fg, lineHeight: 19 },
  error: { color: colors.negative || '#B83A3A', fontSize: 13, marginTop: 12 },
  viewer: { flex: 1, backgroundColor: colors.surface },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, backgroundColor: colors.surface },
  barBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  barTitle: { fontSize: 14.5, fontWeight: '700', color: colors.fg },
  barHost: { fontSize: 11.5, color: colors.muted },
  progressTrack: { height: 2, backgroundColor: 'transparent' },
  progressFill: { height: 2, backgroundColor: colors.primary },
  webNote: { paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.raised },
  webNoteText: { fontSize: 12, color: colors.muted },
  failBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  failTitle: { fontSize: 17, fontWeight: '700', color: colors.fg, marginTop: 12 },
  failBody: { fontSize: 13.5, color: colors.muted, marginTop: 6, textAlign: 'center' },
  menu: { position: 'absolute', top: 52, right: 10, backgroundColor: colors.surface, borderRadius: 14, paddingVertical: 6, minWidth: 190, borderWidth: 1, borderColor: colors.border, elevation: 8, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11 },
  menuText: { fontSize: 14, color: colors.fg },
});

// ---------- strip for the Socials feed (hidden when there are no approved websites) ----------
export function MemberWebsitesStrip() {
  const nav = useNav();
  const api = useApi();
  const sites = useWebsites();
  if (!api.online || !sites.items || !sites.items.length) return null;
  return (
    <View style={stripStyles.wrap}>
      <View style={stripStyles.head}>
        <Text style={stripStyles.title}>Member websites</Text>
        <Pressable onPress={() => nav.push('Websites')} hitSlop={8} accessibilityRole="button"><Text style={stripStyles.all}>See all</Text></Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12 }}>
        {sites.items.slice(0, 10).map((w) => <WebsiteCard key={w.id} site={w} compact onPress={() => openWebsite(nav, api, w)} />)}
      </ScrollView>
    </View>
  );
}

const stripStyles = StyleSheet.create({
  wrap: { backgroundColor: colors.surface, paddingVertical: 12, marginVertical: 6 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, marginBottom: 10 },
  title: { fontSize: 15, fontWeight: '800', color: colors.fg },
  all: { fontSize: 13, fontWeight: '700', color: colors.primary },
});
