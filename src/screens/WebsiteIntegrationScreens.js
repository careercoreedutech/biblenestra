// MEMBER WEBSITE INTEGRATION (brief 19 / 19.1 / 20)
//   WebsiteFeedScreen        — the Website feed: articles imported from member sites and published here
//   WebsiteArticleScreen     — reads one article in the app; labelled native ad slots sit between sections (placed by the server)
//   WebsiteIntegrationScreen — the integration dashboard: connect RSS/WordPress, auto-import and auto-post toggles,
//                              sync now, pause, approval, publication history with retry
//   WebsiteComposerScreen    — write an article, save a draft, submit for approval, publish to the connected WordPress site
import React, { useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, Text, View } from 'react-native';
import { DScreen, DButton, DInput, DToggle } from '../design/profile/parts';
import { d, df, Tap } from '../design/sanctuary';
import { Empty } from '../components/ui';
import { FeedNativeAd } from '../ads/AdSlots';
import { useToast } from '../components/Toast';
import { useNav } from '../navigation';
import { useApi } from '../api/auth';
import { errorMessage } from '../api/client';
import {
  useIntegrations, useIntegrationHistory, useWebsiteFeed, useWebsiteArticle, websiteActions,
} from '../api/websiteSync';

const dateLabel = (iso) => (iso ? new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const isHttps = (u) => typeof u === 'string' && /^https:\/\//i.test(u);

const CONNECTION_STATUS = {
  connected: { label: 'Connected', tint: d.sageDark },
  error: { label: 'Sync failed', tint: '#B33D3D' },
  paused: { label: 'Paused', tint: d.muted },
};

function Chip({ label, tint = d.muted }) {
  return (
    <View style={{ alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: `${tint}1F`, borderWidth: 1, borderColor: `${tint}55` }}>
      <Text style={{ fontFamily: df.sansSemi, fontSize: 11, color: tint }}>{label}</Text>
    </View>
  );
}

function Card({ children, style }) {
  return <View style={[{ backgroundColor: d.paper, borderRadius: 18, padding: 16, marginTop: 12, borderWidth: 1, borderColor: d.line }, style]}>{children}</View>;
}

function Label({ children }) {
  return <Text style={{ fontFamily: df.sansSemi, fontSize: 12, color: d.muted, marginTop: 12, marginBottom: 6, letterSpacing: 0.3 }}>{children}</Text>;
}

function Toggle({ label, hint, value, onChange, disabled }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={{ fontFamily: df.sansSemi, fontSize: 14, color: d.ink }}>{label}</Text>
        {hint ? <Text style={{ fontFamily: df.sans, fontSize: 12, color: d.muted, marginTop: 2 }}>{hint}</Text> : null}
      </View>
      <DToggle value={value} onChange={onChange} disabled={disabled} accessibilityLabel={label} />
    </View>
  );
}

// ---------- the Website feed ----------
export function WebsiteFeedScreen() {
  const nav = useNav();
  const feed = useWebsiteFeed();
  return (
    <DScreen back onBack={() => nav.pop()} title="Website feed" subtitle="Articles from member websites">
      {feed.items === null ? <ActivityIndicator color={d.plum} style={{ marginTop: 30 }} /> : null}
      {feed.error ? <Empty title="Couldn’t load the feed" body={feed.error} action="Try again" onAction={feed.refresh} /> : null}
      {feed.items && !feed.items.length && !feed.error ? (
        <Empty title="No articles yet" body="Articles from connected websites appear here once they are approved." />
      ) : null}
      {(feed.items || []).map((a) => (
        <Pressable key={a.id} onPress={() => nav.push('WebsiteArticle', { id: a.id, title: a.title })} accessibilityRole="button" accessibilityLabel={`Read ${a.title}`}>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {isHttps(a.image) ? <Image source={{ uri: a.image }} style={{ width: '100%', height: 150 }} resizeMode="cover" /> : null}
            <View style={{ padding: 14 }}>
              <Text style={{ fontFamily: df.display, fontSize: 18, color: d.ink }}>{a.title}</Text>
              <Text style={{ fontFamily: df.sans, fontSize: 12, color: d.muted, marginTop: 4 }}>{a.host} · {dateLabel(a.publishedAt || a.createdAt)}</Text>
              {a.excerpt ? <Text numberOfLines={3} style={{ fontFamily: df.sans, fontSize: 14, color: d.ink, marginTop: 8, lineHeight: 20 }}>{a.excerpt}</Text> : null}
            </View>
          </Card>
        </Pressable>
      ))}
      {feed.hasMore ? <DButton small label="Show more" onPress={feed.loadMore} style={{ marginTop: 14, alignSelf: 'center' }} /> : null}
    </DScreen>
  );
}

// ---------- the reader (native ad slots between sections) ----------
// The server places an 'ad' block between paragraphs (interleaveAds); it renders the app's native ad (FeedNativeAd,
// reader variant): labelled "Sponsored", no ads for Plus members, and the slot collapses when no ad loads.

export function WebsiteArticleScreen({ params = {} }) {
  const nav = useNav();
  const { article, error } = useWebsiteArticle(params.id);
  const openSource = () => { if (article && isHttps(article.sourceUrl)) Linking.openURL(article.sourceUrl).catch(() => {}); };
  return (
    <DScreen back onBack={() => nav.pop()} title={article ? article.host || 'Article' : 'Article'} subtitle={article ? dateLabel(article.publishedAt || article.createdAt) : ''}>
      {!article && !error ? <ActivityIndicator color={d.plum} style={{ marginTop: 30 }} /> : null}
      {error ? <Empty title="Article unavailable" body={error} /> : null}
      {article ? (
        <View style={{ marginTop: 6 }}>
          {isHttps(article.image) ? <Image source={{ uri: article.image }} style={{ width: '100%', height: 200, borderRadius: 16 }} resizeMode="cover" /> : null}
          <Text style={{ fontFamily: df.displayBold, fontSize: 28, color: d.ink, marginTop: 14, lineHeight: 34 }}>{article.title}</Text>
          {(article.blocks || []).map((b, i) => {
            if (b.type === 'ad') return <FeedNativeAd key={`ad${i}`} surface="reader" variant="article" />;
            if (b.type === 'heading') return <Text key={`h${i}`} style={{ fontFamily: df.display, fontSize: 21, color: d.ink, marginTop: 22, marginBottom: 6 }}>{b.text}</Text>;
            return <Text key={`p${i}`} style={{ fontFamily: df.sans, fontSize: 16, color: d.ink, lineHeight: 26, marginTop: 10 }}>{b.text}</Text>;
          })}
          {isHttps(article.sourceUrl) ? <DButton small label="Open on the original site" onPress={openSource} style={{ marginTop: 22, alignSelf: 'flex-start' }} /> : null}
        </View>
      ) : null}
    </DScreen>
  );
}

// ---------- the integration dashboard ----------
function HistoryRow({ item, access, onChanged, can }) {
  const toast = useToast();
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const act = async (fn, done) => {
    setBusy(true);
    try {
      const r = await fn(api.request, item.id);
      if (r && r.status === 'failed' && r.error) toast.show(r.error, { tone: 'error' });
      else toast.show(done, { icon: 'check' });
      onChanged();
    } catch (e) { toast.show(errorMessage(e, 'That didn’t work'), { tone: 'error' }); }
    setBusy(false);
  };
  return (
    <View style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: d.line }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: df.sansSemi, fontSize: 14, color: d.ink, paddingRight: 8 }}>{item.title}</Text>
        <Chip label={item.statusLabel} tint={item.status === 'failed' ? '#B33D3D' : item.status === 'published' || item.status === 'approved' ? d.sageDark : d.muted} />
      </View>
      <Text style={{ fontFamily: df.sans, fontSize: 12, color: d.muted, marginTop: 3 }}>
        {item.direction === 'import' ? 'Imported' : 'Published from Bible Nestra'} · {dateLabel(item.createdAt)}
      </Text>
      {item.error ? <Text style={{ fontFamily: df.sans, fontSize: 12, color: '#B33D3D', marginTop: 4 }}>{item.error}</Text> : null}
      {busy ? <ActivityIndicator color={d.plum} style={{ marginTop: 8 }} /> : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {access && item.status === 'pending' ? <DButton small label="Approve" onPress={() => act(websiteActions.approve, 'Approved')} /> : null}
          {can && item.direction === 'publish' && (item.status === 'approved' || item.status === 'failed') ? (
            <DButton small label={item.status === 'failed' ? 'Retry publish' : 'Publish to website'} onPress={() => act(websiteActions.publish, 'Published to your website')} />
          ) : null}
          {access && item.status !== 'hidden' && item.status !== 'published' ? <DButton small label="Hide" onPress={() => act(websiteActions.hide, 'Hidden')} /> : null}
          {item.externalUrl && isHttps(item.externalUrl) ? <DButton small label="View on website" onPress={() => Linking.openURL(item.externalUrl).catch(() => {})} /> : null}
        </View>
      )}
    </View>
  );
}

function ConnectionCard({ conn, open, onToggleOpen, onChanged, access }) {
  const toast = useToast();
  const api = useApi();
  const nav = useNav();
  const hist = useIntegrationHistory(open ? conn.id : null);
  const [busy, setBusy] = useState(false);
  const st = CONNECTION_STATUS[conn.status] || CONNECTION_STATUS.connected;
  const isWp = conn.kind === 'wordpress';
  const run = async (fn, done) => {
    setBusy(true);
    try { await fn(); if (done) toast.show(done, { icon: 'check' }); onChanged(); }
    catch (e) { toast.show(errorMessage(e, 'That didn’t work'), { tone: 'error' }); }
    setBusy(false);
  };
  const patch = (body) => run(() => websiteActions.update(api.request, conn.id, body));
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Text style={{ fontFamily: df.display, fontSize: 19, color: d.ink }}>{conn.host}</Text>
          <Text style={{ fontFamily: df.sans, fontSize: 12, color: d.muted, marginTop: 2 }}>{isWp ? 'WordPress REST API' : 'RSS / Atom feed'} · {conn.lastSyncedAt ? `synced ${dateLabel(conn.lastSyncedAt)}` : 'not synced yet'}</Text>
        </View>
        <Chip label={st.label} tint={st.tint} />
      </View>
      {conn.lastError ? <Text style={{ fontFamily: df.sans, fontSize: 13, color: '#B33D3D', marginTop: 10, lineHeight: 18 }}>{conn.lastError}</Text> : null}
      <Toggle label="Auto-import new articles" hint="Checks the site regularly for new posts." value={conn.autoImport} onChange={(v) => patch({ autoImport: v })} disabled={busy || !access} />
      <Toggle label="Imports need approval" hint="New imports stay hidden until you approve them." value={conn.importRequiresApproval} onChange={(v) => patch({ importRequiresApproval: v })} disabled={busy || !access} />
      {isWp ? <Toggle label="Auto-post approved articles" hint="Publishes an article to your site as soon as it is approved." value={conn.autoPost} onChange={(v) => patch({ autoPost: v })} disabled={busy || !access || !conn.hasCredentials} /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
        <DButton small label="Sync now" disabled={busy || !access} onPress={() => run(() => websiteActions.sync(api.request, conn.id), 'Checked for new articles')} />
        <DButton small label={conn.status === 'paused' ? 'Resume' : 'Pause'} disabled={busy || !access} onPress={() => patch({ paused: conn.status !== 'paused' })} />
        {isWp && conn.hasCredentials ? <DButton small label="Write article" disabled={busy || !access} onPress={() => nav.push('WebsiteComposer', { connectionId: conn.id })} /> : null}
        <DButton small label={open ? 'Hide history' : 'History'} onPress={onToggleOpen} />
        <DButton small label="Remove" disabled={busy || !access} onPress={() => run(() => websiteActions.remove(api.request, conn.id), 'Website disconnected')} />
      </View>
      {open ? (
        <View style={{ marginTop: 10 }}>
          {hist.items === null ? <ActivityIndicator color={d.plum} /> : null}
          {hist.error ? <Text style={{ color: '#B33D3D' }}>{hist.error}</Text> : null}
          {hist.items && !hist.items.length ? <Text style={{ fontFamily: df.sans, fontSize: 13, color: d.muted, paddingVertical: 8 }}>Nothing imported or published yet.</Text> : null}
          {(hist.items || []).map((it) => <HistoryRow key={it.id} item={it} access={access} can={isWp && conn.hasCredentials} onChanged={() => { hist.refresh(); onChanged(); }} />)}
        </View>
      ) : null}
    </Card>
  );
}

function ConnectForm({ max, count, onDone }) {
  const toast = useToast();
  const api = useApi();
  const [kind, setKind] = useState('rss');
  const [siteUrl, setSiteUrl] = useState('');
  const [feedUrl, setFeedUrl] = useState('');
  const [username, setUsername] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [autoImport, setAutoImport] = useState(true);
  const [busy, setBusy] = useState(false);
  const full = count >= max;
  const submit = async () => {
    if (!siteUrl.trim()) { toast.show('Enter your website address', { tone: 'error' }); return; }
    setBusy(true);
    try {
      const body = { kind, siteUrl: siteUrl.trim(), autoImport };
      if (kind === 'rss' && feedUrl.trim()) body.feedUrl = feedUrl.trim();
      if (kind === 'wordpress') { body.username = username.trim(); body.appPassword = appPassword; }
      const r = await websiteActions.connect(api.request, body);
      const failed = r.sync && r.sync.error;
      toast.show(failed ? `Connected, but the first sync failed: ${failed}` : `Connected ${r.connection.host}${r.sync ? ` · ${r.sync.added} new` : ''}`, { icon: failed ? 'x' : 'check', tone: failed ? 'error' : undefined });
      setSiteUrl(''); setFeedUrl(''); setUsername(''); setAppPassword('');
      onDone();
    } catch (e) { toast.show(errorMessage(e, 'Couldn’t connect this website'), { tone: 'error' }); }
    setBusy(false);
  };
  return (
    <Card>
      <Text style={{ fontFamily: df.display, fontSize: 19, color: d.ink }}>Connect a website</Text>
      <Text style={{ fontFamily: df.sans, fontSize: 13, color: d.muted, marginTop: 4, lineHeight: 18 }}>
        Imports bring new articles into the Website feed. To publish from Bible Nestra, use a WordPress site with an application password. Passwords are stored encrypted.
      </Text>
      <Label>Type</Label>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[['rss', 'RSS / Atom feed'], ['wordpress', 'WordPress']].map(([k, label]) => (
          <Tap key={k} onPress={() => setKind(k)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: kind === k ? d.plum : d.line, backgroundColor: kind === k ? `${d.plum}18` : 'transparent' }} accessibilityRole="button" accessibilityState={{ selected: kind === k }}>
            <Text style={{ fontFamily: df.sansSemi, fontSize: 13, color: kind === k ? d.plum : d.ink }}>{label}</Text>
          </Tap>
        ))}
      </View>
      <Label>Website address</Label>
      <DInput value={siteUrl} onChangeText={setSiteUrl} placeholder="https://yourwebsite.org" autoCapitalize="none" keyboardType="url" />
      {kind === 'rss' ? (<>
        <Label>Feed address (optional)</Label>
        <DInput value={feedUrl} onChangeText={setFeedUrl} placeholder="https://yourwebsite.org/feed" autoCapitalize="none" keyboardType="url" />
      </>) : (<>
        <Label>WordPress user name</Label>
        <DInput value={username} onChangeText={setUsername} placeholder="your username" autoCapitalize="none" />
        <Label>Application password</Label>
        <DInput value={appPassword} onChangeText={setAppPassword} placeholder="xxxx xxxx xxxx xxxx" autoCapitalize="none" secureTextEntry />
        <Text style={{ fontFamily: df.sans, fontSize: 12, color: d.muted, marginTop: 6, lineHeight: 17 }}>
          In WordPress: Users, Profile, Application Passwords. Create one called Bible Nestra and paste it here.
        </Text>
      </>)}
      <Toggle label="Auto-import new articles" value={autoImport} onChange={setAutoImport} disabled={busy} />
      <DButton label={busy ? 'Connecting…' : 'Connect website'} disabled={busy || full} onPress={submit} style={{ marginTop: 16, alignSelf: 'flex-start' }} />
      {full ? <Text style={{ fontFamily: df.sans, fontSize: 12, color: d.muted, marginTop: 8 }}>You can connect up to {max} websites.</Text> : null}
    </Card>
  );
}

export function WebsiteIntegrationScreen() {
  const nav = useNav();
  const integ = useIntegrations();
  const [open, setOpen] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const access = !!integ.access;
  return (
    <DScreen back onBack={() => nav.pop()} title="Website integration" subtitle="Import and publish with your website">
      {!integ.online ? <Empty title="Sign in to connect a website" body="Website connections need the online version of Bible Nestra." /> : null}
      {integ.online && !access && integ.items ? <Empty title="Coming soon" body="Connecting websites is for administrators for now. Ask the team if you would like to connect yours." /> : null}
      {integ.items === null && integ.online ? <ActivityIndicator color={d.plum} style={{ marginTop: 30 }} /> : null}
      {integ.error ? <Empty title="Couldn’t load your websites" body={integ.error} action="Try again" onAction={integ.refresh} /> : null}
      {(integ.alerts || []).map((a) => (
        <Card key={a.connectionId} style={{ borderColor: '#B33D3D66' }}>
          <Text style={{ fontFamily: df.sansBold, fontSize: 13, color: '#B33D3D' }}>Sync failed · {a.host}</Text>
          <Text style={{ fontFamily: df.sans, fontSize: 13, color: d.ink, marginTop: 4, lineHeight: 18 }}>{a.message}</Text>
        </Card>
      ))}
      {access ? (
        <View style={{ marginTop: 6 }}>
          <Tap onPress={() => nav.push('WebsiteFeed')} style={{ paddingVertical: 10 }} accessibilityRole="button"><Text style={{ fontFamily: df.sansSemi, fontSize: 14, color: d.plum }}>Open the Website feed</Text></Tap>
          <DButton small label={showForm ? 'Close' : 'Connect a website'} onPress={() => setShowForm((x) => !x)} />
        </View>
      ) : null}
      {showForm && access ? <ConnectForm max={integ.max || 3} count={(integ.items || []).length} onDone={() => { setShowForm(false); integ.refresh(); }} /> : null}
      {(integ.items || []).map((c) => (
        <ConnectionCard key={c.id} conn={c} access={access} open={open === c.id} onToggleOpen={() => setOpen(open === c.id ? null : c.id)} onChanged={integ.refresh} />
      ))}
      {access && integ.items && !integ.items.length && !showForm ? <Empty title="No websites connected" body="Connect your website to import its articles, or publish from Bible Nestra." /> : null}
    </DScreen>
  );
}

// ---------- write and publish ----------
export function WebsiteComposerScreen({ params = {} }) {
  const nav = useNav();
  const toast = useToast();
  const api = useApi();
  const integ = useIntegrations();
  const wp = (integ.items || []).filter((c) => c.kind === 'wordpress' && c.hasCredentials);
  const [connectionId, setConnectionId] = useState(params.connectionId || null);
  const [articleId, setArticleId] = useState(null);
  const [status, setStatus] = useState(null);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const chosen = connectionId || (wp[0] && wp[0].id);

  const save = async () => {
    if (!title.trim() || !text.trim()) { toast.show('Add a title and the article', { tone: 'error' }); return null; }
    const body = { title: title.trim(), body: text.trim(), excerpt: summary.trim() || undefined };
    if (articleId) return websiteActions.updateArticle(api.request, articleId, body);
    return websiteActions.createArticle(api.request, { connectionId: chosen, ...body });
  };
  const runWith = async (fn, done) => {
    setBusy(true);
    try {
      const saved = await save();
      if (!saved) { setBusy(false); return; }
      setArticleId(saved.id); setStatus(saved);
      if (fn) {
        const r = await fn(saved.id);
        setStatus(r);
        if (r.status === 'failed') toast.show(r.error || 'Publishing failed. Retry when ready.', { tone: 'error' });
        else toast.show(done, { icon: 'check', haptic: 'success' });
      } else toast.show('Draft saved', { icon: 'check' });
    } catch (e) { toast.show(errorMessage(e, 'Couldn’t save the article'), { tone: 'error' }); }
    setBusy(false);
  };

  if (!integ.online) return <DScreen back onBack={() => nav.pop()} title="Write article" subtitle=""><Empty title="Sign in to write for your website" body="Articles are published from the online version of Bible Nestra." /></DScreen>;
  return (
    <DScreen back onBack={() => nav.pop()} title="Write article" subtitle="Save, submit for approval, publish">
      {!wp.length && integ.items ? <Empty title="No WordPress website ready" body="Connect a WordPress site with an application password to publish from here." action="Connect a website" onAction={() => nav.replace('WebsiteIntegration')} /> : null}
      {wp.length ? (
        <Card>
          <Label>Website</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {wp.map((c) => (
              <Tap key={c.id} onPress={() => setConnectionId(c.id)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: chosen === c.id ? d.plum : d.line }} accessibilityRole="button" accessibilityState={{ selected: chosen === c.id }}>
                <Text style={{ fontFamily: df.sansSemi, fontSize: 13, color: chosen === c.id ? d.plum : d.ink }}>{c.host}</Text>
              </Tap>
            ))}
          </View>
          <Label>Title</Label>
          <DInput value={title} onChangeText={setTitle} placeholder="Article title" />
          <Label>Summary (optional)</Label>
          <DInput value={summary} onChangeText={setSummary} placeholder="One or two sentences" />
          <Label>Article</Label>
          <DInput value={text} onChangeText={setText} placeholder="Write your article. Leave a blank line between paragraphs. Start a line with ## for a heading." multiline style={{ minHeight: 200, textAlignVertical: 'top' }} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
            <DButton small label="Save draft" disabled={busy} onPress={() => runWith(null)} />
            <DButton small label="Submit for approval" disabled={busy || !(status === null || ['draft', 'failed'].includes(status.status))} onPress={() => runWith((id) => websiteActions.submit(api.request, id), 'Submitted for approval')} />
            <DButton small label={status && status.status === 'failed' ? 'Retry publish' : 'Publish to website'} disabled={busy || !status || !['approved', 'failed'].includes(status.status)} onPress={() => runWith((id) => websiteActions.publish(api.request, id), 'Published to your website')} />
          </View>
          {status ? <Text style={{ fontFamily: df.sans, fontSize: 13, color: d.muted, marginTop: 12 }}>Status: {status.statusLabel}{status.error ? ` · ${status.error}` : ''}</Text> : null}
          {busy ? <ActivityIndicator color={d.plum} style={{ marginTop: 10 }} /> : null}
        </Card>
      ) : null}
    </DScreen>
  );
}
