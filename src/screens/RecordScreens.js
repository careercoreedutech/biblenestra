import { isDarkScheme } from '../design/palette';
// Record (Sermon Studio) — online mode UI: the server-backed recordings list (used inside SermonStudioScreen)
// and the recording detail screen (audio player · searchable transcript · AI sermon notes).
// Look: the design's Sermon Studio / Recorder language (paper cards, plum accents, dark hero player) on the design kit.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { Audio } from 'expo-av';
import { Empty, alpha } from '../components/ui';
import { Icon } from '../components/Icons';
import { PressScale, FadeInUp, ScaleIn, Pulse, AnimatedBar, Shimmer, Pop } from '../components/Motion';
import { useNav } from '../navigation';
import { useToast } from '../components/Toast';
import { useApi } from '../api/auth';
import { errorMessage } from '../api/client';
import { parseRef } from '../data/bible';
import { audioSource, fmtClock, notesAsText, STATUS_LABEL, isStaleUpload } from '../api/recordings';
import { d, df, Grad, Tap, Eyebrow, SectionTitle, gradients } from '../design/sanctuary';
import { DScreen, DInput, DTabs } from '../design/profile/parts';
import { colors } from '../theme'; // APPEARANCE (item 14): palette tokens

const STATUS_TINT = { uploading: '#4F7CA8', transcribing: d.roseDark, summarising: d.roseDark, ready: d.sageDark, error: '#B33D3D' };
const WORKING_TINT = '#B0701C';
const when = (iso) => {
  if (!iso) return '';
  const dt = new Date(iso);
  const today = new Date();
  if (dt.toDateString() === today.toDateString()) return `Today · ${dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  return dt.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
};

async function shareText(toast, message, done) {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && !navigator.share) {
    try { await navigator.clipboard.writeText(message); toast.show('Notes copied to the clipboard', { icon: 'link' }); } catch (e) { toast.show('Sharing isn’t available in this browser', { tone: 'error', icon: 'share' }); }
    return;
  }
  try {
    const res = await Share.share({ message });
    if (res && res.action !== Share.dismissedAction && done) toast.show(done, { icon: 'share' });
  } catch (e) { toast.show('Sharing isn’t available on this device', { tone: 'error', icon: 'share' }); }
}

/** Design button: plum pill (primary), outlined (ghost) or red (danger), small size. */
function Btn({ label, onPress, ghost, danger, icon, style, disabled }) {
  const text = danger ? '#FFFFFF' : ghost ? d.ink : '#FFFFFF';
  return (
    <Tap
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[s.btn, ghost ? s.btnGhost : danger ? s.btnDanger : s.btnPrimary, disabled && { opacity: 0.45 }, style]}
    >
      {icon}
      <Text style={[s.btnText, { color: text }]}>{label}</Text>
    </Tap>
  );
}

/** Small status tag (design .tag). */
function Tag({ label, tint }) {
  return (
    <View style={[s.tag, { backgroundColor: alpha(tint, 0.14), borderColor: alpha(tint, 0.35) }]}>
      <Text style={[s.tagText, { color: tint }]}>{label}</Text>
    </View>
  );
}

/** Page shell for this file: design page with back arrow. */
function Page({ title, subtitle, children }) {
  const nav = useNav();
  return <DScreen title={title} subtitle={subtitle} back onBack={() => nav.pop()}>{children}</DScreen>;
}

function StatusChip({ rec }) {
  const stale = isStaleUpload(rec);
  const label = stale ? 'Incomplete' : rec.busy ? 'Waiting' : STATUS_LABEL[rec.status] || rec.status;
  return <Pop trigger={rec.status}><Tag label={label} tint={stale ? '#B33D3D' : rec.busy ? WORKING_TINT : STATUS_TINT[rec.status] || d.muted} /></Pop>;
}

function Working({ rec, compact }) {
  const text = rec.busy ? rec.error : rec.status === 'summarising' ? 'Writing your sermon notes…' : rec.status === 'uploading' ? 'Waiting for the upload…' : 'Transcribing the recording…';
  return (
    <View style={{ marginTop: compact ? 10 : 0 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pulse active={!rec.busy} min={0.6} max={1.1} duration={600}><View style={[s.dot, { backgroundColor: rec.busy ? WORKING_TINT : d.plum }]} /></Pulse>
        <Text style={[s.meta, { marginTop: 0, color: rec.busy ? WORKING_TINT : d.plumDark, flex: 1 }]}>{text}</Text>
      </View>
      {!rec.busy && rec.status !== 'uploading' ? (
        <AnimatedBar progress={rec.status === 'summarising' ? 0.92 : Math.max(0.06, rec.progress || 0.08)} style={s.track} fillStyle={{ backgroundColor: d.plum }} />
      ) : null}
    </View>
  );
}

/** "Your recordings" (online): server list + in-flight uploads. `cloud` comes from useCloudRecordings(). */
export function CloudRecordingList({ cloud, seen }) {
  const nav = useNav();
  const toast = useToast();
  const items = cloud.items;
  const removeStale = async (rec) => {
    cloud.removeLocal(rec.id);
    try { await cloud.request('DELETE', `/recordings/${rec.id}`); toast.show('Removed', { icon: 'trash' }); } catch (e) { cloud.refresh(); toast.show(errorMessage(e, 'Couldn’t remove it'), { tone: 'error', icon: 'x' }); }
  };
  const retry = async (rec) => {
    cloud.patchLocal(rec.id, { error: null, busy: false });
    try { const r = await cloud.request('POST', `/recordings/${rec.id}/retry`); cloud.patchLocal(rec.id, r); toast.show('Trying again…', { icon: 'mic' }); }
    catch (e) { cloud.refresh(); toast.show(errorMessage(e, 'Couldn’t retry right now'), { tone: 'error', icon: 'x' }); }
  };
  return (
    <View>
      <SectionTitle
        eyebrow="Library"
        title="Your recordings"
        link={items && items.length ? 'Refresh' : undefined}
        onLink={() => { cloud.refresh(); toast.show('Up to date', { icon: 'check' }); }}
      />
      {cloud.uploads.map((u) => (
        <ScaleIn key={u.key} from={0.94} style={s.card}>
          <View style={s.head}>
            <View style={[s.iconWrap, { backgroundColor: (isDarkScheme() ? '#1B2A36' : '#DDE6EE') }]}><Icon name={u.error ? 'x' : 'download'} size={17} color={u.error ? '#B33D3D' : '#4F7CA8'} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.title} numberOfLines={1}>{u.title}</Text>
              <Text style={[s.meta, u.error && { color: '#B33D3D' }]}>{u.error ? u.error : `Uploading · ${Math.round((u.progress || 0) * 100)}%`}</Text>
            </View>
          </View>
          {u.error ? (
            <View style={s.btnRow}>
              <Btn small label="Try upload again" onPress={() => cloud.retryUpload(u.key).catch(() => {})} />
              <Btn ghost label="Dismiss" onPress={() => cloud.dismissUpload(u.key)} />
            </View>
          ) : <AnimatedBar progress={Math.max(0.04, u.progress || 0)} style={s.track} fillStyle={{ backgroundColor: '#4F7CA8' }} delay={0} />}
        </ScaleIn>
      ))}
      {items == null ? (
        <View style={s.card}><Shimmer style={{ height: 16, width: '60%', borderRadius: 6 }} /><Shimmer style={{ height: 12, width: '40%', borderRadius: 6, marginTop: 10 }} /></View>
      ) : items.length ? items.map((rec, i) => {
        const Enter = seen && !seen.has(rec.id) ? ScaleIn : FadeInUp;
        return (
          <Enter key={rec.id} index={i + 2} from={0.92}>
            <PressScale scaleTo={0.985} onPress={() => nav.push('RecordingDetail', { id: rec.id })} accessibilityRole="button" accessibilityLabel={`Open ${rec.title}`} style={s.card}>
              <View style={s.head}>
                <View style={[s.iconWrap, { backgroundColor: rec.status === 'ready' ? d.sage : d.lavender }]}>
                  <Icon name={rec.status === 'ready' ? 'devotional' : 'mic'} size={17} color={rec.status === 'ready' ? d.sageDark : d.roseDark} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.title} numberOfLines={2}>{rec.title}</Text>
                  <Text style={s.meta} numberOfLines={1}>{[when(rec.createdAt), rec.duration ? fmtClock(rec.duration) : null, rec.passage].filter(Boolean).join(' · ')}</Text>
                </View>
                <StatusChip rec={rec} />
              </View>
              {rec.status === 'ready' && rec.summary ? <Text style={s.summary} numberOfLines={2}>{rec.summary}</Text> : null}
              {isStaleUpload(rec) ? (
                <View>
                  <Text style={[s.meta, { color: '#B33D3D', marginTop: 10 }]}>This upload didn’t finish, so there’s no audio to transcribe.</Text>
                  <View style={s.btnRow}><Btn ghost small label="Remove" onPress={() => removeStale(rec)} /></View>
                </View>
              ) : ['uploading', 'transcribing', 'summarising'].includes(rec.status) ? <Working rec={rec} compact /> : null}
              {rec.status === 'error' ? <Text style={[s.meta, { color: '#B33D3D', marginTop: 10 }]}>{rec.error || 'Something went wrong. Your audio is safe.'}</Text> : null}
              {rec.status === 'error' || rec.busy ? (
                <View style={s.btnRow}><Btn small label={rec.busy ? 'Try now' : 'Retry'} onPress={() => retry(rec)} /></View>
              ) : null}
            </PressScale>
          </Enter>
        );
      }) : (
        <ScaleIn from={0.94} style={s.emptyCard}>
          <Empty title="No recordings yet" body="Record a sermon above. When you stop, it uploads privately and you get a transcript and AI sermon notes." />
        </ScaleIn>
      )}
      {cloud.error ? <Text style={[s.meta, { color: '#B33D3D' }]}>{cloud.error}</Text> : null}
    </View>
  );
}

// ---------- detail ----------
function usePlayer(request, rec) {
  const soundRef = useRef(null);
  const [st, setSt] = useState({ loaded: false, loading: false, playing: false, pos: 0, dur: (rec && rec.duration ? rec.duration * 1000 : 0), error: null });
  const objectUrl = useRef(null);
  useEffect(() => () => {
    if (soundRef.current) soundRef.current.unloadAsync().catch(() => {});
    if (objectUrl.current && typeof URL !== 'undefined') URL.revokeObjectURL(objectUrl.current);
  }, []);
  const load = async (startMs = 0, play = true) => {
    if (soundRef.current) return soundRef.current;
    setSt((x) => ({ ...x, loading: true, error: null }));
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true, staysActiveInBackground: true }).catch(() => {});
      const src = await audioSource(request, rec);
      if (src.uri.startsWith('blob:')) objectUrl.current = src.uri;
      const { sound } = await Audio.Sound.createAsync(src, { shouldPlay: play, positionMillis: startMs, progressUpdateIntervalMillis: 250 }, (p) => {
        if (!p.isLoaded) { if (p.error) setSt((x) => ({ ...x, playing: false, error: 'This audio couldn’t be played' })); return; }
        setSt((x) => ({ ...x, loaded: true, loading: false, playing: p.isPlaying, pos: p.positionMillis || 0, dur: p.durationMillis || x.dur }));
        if (p.didJustFinish) sound.setPositionAsync(0).catch(() => {});
      });
      soundRef.current = sound;
      return sound;
    } catch (e) {
      setSt((x) => ({ ...x, loading: false, error: e && e.code && e.code !== 'ERROR' ? errorMessage(e, 'This audio couldn’t be played') : 'This audio couldn’t be played on this device' }));
      return null;
    }
  };
  const toggle = async () => {
    const snd = soundRef.current || (await load(st.pos, true));
    if (!snd || !soundRef.current) return;
    if (st.playing) await snd.pauseAsync().catch(() => {}); else if (st.loaded) await snd.playAsync().catch(() => {});
  };
  const seek = async (ms, play = true) => {
    const target = Math.max(0, ms);
    setSt((x) => ({ ...x, pos: target }));
    const snd = soundRef.current || (await load(target, play));
    if (!snd) return;
    await snd.setPositionAsync(target).catch(() => {});
    if (play) await snd.playAsync().catch(() => {});
  };
  return { ...st, toggle, seek };
}

function Bar({ pos, dur, onSeek }) {
  const [w, setW] = useState(0);
  const pct = dur ? Math.min(1, pos / dur) : 0;
  return (
    <Pressable onLayout={(e) => setW(e.nativeEvent.layout.width)} onPress={(e) => { if (w && dur) onSeek((e.nativeEvent.locationX / w) * dur); }} style={s.seekHit} accessibilityLabel="Seek">
      <View style={s.seekTrack}><View style={[s.seekFill, { width: `${pct * 100}%` }]} /></View>
      <View style={[s.seekKnob, { left: Math.max(0, pct * w - 6) }]} />
    </Pressable>
  );
}

function highlight(text, query) {
  if (!query) return text;
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return text;
  return [text.slice(0, i), <Text key="m" style={s.mark}>{text.slice(i, i + query.length)}</Text>, text.slice(i + query.length)];
}

function NotesView({ rec, onRef }) {
  const n = rec.notes || {};
  const block = (title, children, i) => (
    <FadeInUp index={i} style={s.card}>
      <Eyebrow>{title}</Eyebrow>
      {children}
    </FadeInUp>
  );
  return (
    <View>
      <FadeInUp style={s.aiNote}>
        <Icon name="sparkles" size={14} color={d.goldDark} />
        <Text style={s.aiNoteText}>{n.label || 'AI-generated — check against the recording'}</Text>
      </FadeInUp>
      {n.title || n.summary ? block('Summary', (
        <View>
          {n.title ? <Text style={[s.notesTitle, { marginTop: 8 }]}>{n.title}</Text> : null}
          {n.summary ? <Text style={s.body}>{n.summary}</Text> : null}
        </View>
      ), 1) : null}
      {(n.mainPoints || []).length ? block('Main points', n.mainPoints.map((p, i) => (
        <View key={i} style={s.pointRow}>
          <View style={s.pointNum}><Text style={s.pointNumText}>{i + 1}</Text></View>
          <Text style={[s.body, { flex: 1, marginTop: 0 }]}>{p}</Text>
        </View>
      )), 2) : null}
      {(n.scriptures || []).length ? block('Scriptures mentioned', (
        <View style={s.refWrap}>
          {n.scriptures.map((r) => (
            <PressScale key={r.label} scaleTo={0.93} onPress={() => onRef(r)} style={s.refChip} accessibilityRole="button" accessibilityLabel={`Open ${r.label}`}>
              <Icon name="book" size={13} color={d.plum} />
              <Text style={s.refText}>{r.label}</Text>
            </PressScale>
          ))}
        </View>
      ), 3) : null}
      {(n.quotes || []).length ? block('Key quotes', n.quotes.map((qt, i) => (
        <View key={i} style={s.quote}><Text style={s.quoteText}>“{qt}”</Text></View>
      )), 4) : null}
      {(n.application || []).length ? block('Application · next steps', n.application.map((a, i) => (
        <View key={i} style={s.pointRow}>
          <Icon name="check-circle" size={16} color={d.sageDark} />
          <Text style={[s.body, { flex: 1, marginTop: 0 }]}>{a}</Text>
        </View>
      )), 5) : null}
      {n.prayer ? (
        <FadeInUp index={6} style={s.prayerCard}>
          <Grad colors={gradients.ink} style={s.prayerInner}>
            <Eyebrow light>Closing prayer</Eyebrow>
            <Text style={s.prayerText}>{n.prayer}</Text>
          </Grad>
        </FadeInUp>
      ) : null}
    </View>
  );
}

export function RecordingDetailScreen({ params = {} }) {
  const nav = useNav();
  const toast = useToast();
  const api = useApi();
  const [rec, setRec] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [tab, setTab] = useState('Notes');
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);

  const load = async () => {
    try { const r = await api.request('GET', `/recordings/${params.id}`); setRec(r); setLoadErr(null); return r; }
    catch (e) { setLoadErr(e.status === 404 ? 'missing' : errorMessage(e, 'Couldn’t load this recording')); return null; }
  };
  useEffect(() => { if (api.online && params.id) load(); }, [params.id]);
  const working = rec && ['uploading', 'transcribing', 'summarising'].includes(rec.status) && !rec.busy && !isStaleUpload(rec);
  useEffect(() => {
    if (!working) return undefined;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [working]);
  useEffect(() => { if (rec && rec.status === 'ready' && !rec.notes) setTab('Transcript'); }, [rec && rec.status]);

  const player = usePlayer(api.request, rec);
  const segments = (rec && rec.segments) || [];
  const shown = useMemo(() => (query.trim() ? segments.filter((x) => x.text.toLowerCase().includes(query.trim().toLowerCase())) : segments), [segments, query]);
  const activeIdx = useMemo(() => {
    const t = player.pos / 1000;
    let idx = -1;
    segments.forEach((x, i) => { if (x.start <= t + 0.05) idx = i; });
    return player.loaded ? idx : -1;
  }, [player.pos, player.loaded, segments]);

  if (!api.online) {
    return <Page title="Recording"><View style={[s.emptyCard, { marginTop: 12 }]}><Empty title="Sign in to get transcripts & notes" body="Recordings are kept on this device in local mode. Sign in to upload them and get a transcript and AI sermon notes." /></View></Page>;
  }
  if (loadErr) {
    return (
      <Page title="Recording">
        <View style={[s.emptyCard, { marginTop: 12 }]}>
          <Empty title={loadErr === 'missing' ? 'Recording not found' : 'Couldn’t load'} body={loadErr === 'missing' ? 'It may have been deleted.' : loadErr} action={loadErr === 'missing' ? 'Back to Sermon Studio' : 'Try again'} onAction={() => (loadErr === 'missing' ? nav.pop() : load())} />
        </View>
      </Page>
    );
  }
  if (!rec) {
    return <Page title="Recording"><View style={s.card}><Shimmer style={{ height: 22, width: '70%', borderRadius: 8 }} /><Shimmer style={{ height: 12, width: '45%', borderRadius: 6, marginTop: 12 }} /></View></Page>;
  }

  const openRef = (r) => { const p = parseRef(r.ref); if (p) nav.push('Bible', p); };
  const retry = async () => {
    try { setRec(await api.request('POST', `/recordings/${rec.id}/retry`)); toast.show('Trying again…', { icon: 'mic' }); }
    catch (e) { toast.show(errorMessage(e, 'Couldn’t retry right now'), { tone: 'error', icon: 'x' }); }
  };
  const rename = async () => {
    const title = renaming.trim();
    const prev = rec;
    setRec({ ...rec, title }); setRenaming(null);
    try { await api.request('PATCH', `/recordings/${rec.id}`, { title }); toast.show('Recording renamed', { icon: 'edit' }); }
    catch (e) { setRec(prev); toast.show(errorMessage(e, 'Couldn’t rename'), { tone: 'error', icon: 'x' }); }
  };
  const remove = async () => {
    try { await api.request('DELETE', `/recordings/${rec.id}`); toast.show('Recording deleted', { icon: 'trash' }); nav.pop(); }
    catch (e) { setConfirmDel(false); toast.show(errorMessage(e, 'Couldn’t delete'), { tone: 'error', icon: 'x' }); }
  };
  const ready = rec.status === 'ready';
  const exportText = ready ? notesAsText(rec) : null;

  return (
    <Page title={rec.title} subtitle={[when(rec.createdAt), rec.speaker, rec.passage].filter(Boolean).join(' · ')}>
      {/* Player */}
      <ScaleIn from={0.95} style={s.playerWrap}>
        <Grad colors={gradients.hero} style={s.player}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Pulse active={player.playing} min={0.96} max={1.06} duration={800}>
              <PressScale scaleTo={0.9} onPress={player.toggle} disabled={!rec.hasAudio || player.loading} style={s.playBtn} accessibilityRole="button" accessibilityLabel={player.playing ? 'Pause' : 'Play recording'}>
                <Icon name={player.playing ? 'pause' : 'play'} size={22} color={d.plumDark} fill={player.playing ? undefined : 'solid'} />
              </PressScale>
            </Pulse>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Eyebrow light>{player.loading ? 'Loading audio…' : player.playing ? 'Playing' : 'Recording'}</Eyebrow>
              <Text style={s.playerTitle} numberOfLines={1}>{rec.title}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <PressScale scaleTo={0.9} onPress={() => player.seek(player.pos - 15000, player.playing)} style={s.skip} accessibilityLabel="Back 15 seconds"><Text style={s.skipText}>−15</Text></PressScale>
              <PressScale scaleTo={0.9} onPress={() => player.seek(player.pos + 15000, player.playing)} style={s.skip} accessibilityLabel="Forward 15 seconds"><Text style={s.skipText}>+15</Text></PressScale>
            </View>
          </View>
          <Bar pos={player.pos} dur={player.dur || (rec.duration || 0) * 1000} onSeek={(ms) => player.seek(ms, player.playing)} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={s.time}>{fmtClock(player.pos / 1000)}</Text>
            <Text style={s.time}>{player.dur ? fmtClock(player.dur / 1000) : rec.duration ? fmtClock(rec.duration) : '--:--'}</Text>
          </View>
          {player.error ? <Text style={[s.time, { color: d.gold, marginTop: 6 }]}>{player.error}</Text> : null}
        </Grad>
      </ScaleIn>

      {/* Actions */}
      {renaming != null ? (
        <FadeInUp distance={6} style={[s.card, { marginTop: 12 }]}>
          <DInput value={renaming} onChangeText={setRenaming} placeholder="Recording title" autoFocus />
          <View style={s.btnRow}>
            <Btn small label="Save name" disabled={!renaming.trim() || renaming.trim() === rec.title} onPress={rename} />
            <Btn ghost label="Cancel" onPress={() => setRenaming(null)} />
          </View>
        </FadeInUp>
      ) : confirmDel ? (
        <FadeInUp distance={6} style={s.confirm}>
          <Text style={[s.title, { color: '#B33D3D', fontSize: 16 }]}>Delete this recording?</Text>
          <Text style={s.meta}>The audio, transcript and notes are removed from your account. This can’t be undone.</Text>
          <View style={s.btnRow}>
            <Btn small danger label="Delete" onPress={remove} />
            <Btn ghost label="Cancel" onPress={() => setConfirmDel(false)} />
          </View>
        </FadeInUp>
      ) : (
        <View style={[s.btnRow, { marginTop: 12 }]}>
          {ready ? <Btn small label="Share notes" icon={<Icon name="share" size={13} color="#FFFFFF" />} onPress={() => shareText(toast, exportText, 'Notes shared')} /> : null}
          <Btn ghost label="Rename" icon={<Icon name="edit" size={12} color={d.ink} />} onPress={() => setRenaming(rec.title)} />
          <Btn ghost label="Delete" icon={<Icon name="trash" size={12} color={d.ink} />} onPress={() => setConfirmDel(true)} />
        </View>
      )}

      {/* Processing / error states */}
      {!ready ? (
        <FadeInUp index={1} style={s.card}>
          <View style={s.head}>
            <Text style={[s.title, { flex: 1 }]}>{rec.status === 'error' ? 'Something went wrong' : rec.busy ? 'Waiting to transcribe' : 'Preparing your notes'}</Text>
            <StatusChip rec={rec} />
          </View>
          {rec.status === 'error' ? <Text style={[s.body, { color: '#B33D3D' }]}>{rec.error}</Text> : <Working rec={rec} compact />}
          {!rec.busy && rec.status !== 'error' ? <Text style={s.meta}>This usually takes a minute or two for a 30-minute sermon. You can leave this screen — it keeps going.</Text> : null}
          {rec.status === 'error' || rec.busy ? <View style={s.btnRow}><Btn small label={rec.busy ? 'Try now' : 'Retry'} onPress={retry} /></View> : null}
        </FadeInUp>
      ) : null}

      {ready || segments.length ? (
        <View style={{ marginTop: 18 }}>
          {ready && rec.notes ? <DTabs items={['Notes', 'Transcript']} value={tab} onChange={setTab} /> : null}
          {tab === 'Notes' && rec.notes ? <NotesView rec={rec} onRef={openRef} /> : (
            <View>
              <View style={s.search}>
                <Icon name="search" size={15} color={d.muted} />
                <TextInput value={query} onChangeText={setQuery} placeholder="Search the transcript" placeholderTextColor={d.muted} style={s.searchInput} accessibilityLabel="Search the transcript" />
                {query ? <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search"><Icon name="x" size={14} color={d.muted} /></Pressable> : null}
              </View>
              {query ? <Text style={[s.meta, { marginTop: 8 }]}>{shown.length} match{shown.length === 1 ? '' : 'es'} · tap a line to play from there</Text> : <Text style={[s.meta, { marginTop: 8 }]}>Tap a line to play from there</Text>}
              <View style={[s.card, { paddingVertical: 4, paddingHorizontal: 0 }]}>
                {shown.length ? shown.map((seg) => {
                  const i = segments.indexOf(seg);
                  const on = i === activeIdx;
                  return (
                    <Pressable key={i} onPress={() => player.seek(seg.start * 1000, true)} style={({ pressed }) => [s.line, i > 0 && s.lineSep, on && s.lineOn, pressed && { backgroundColor: d.lavender }]} accessibilityRole="button" accessibilityLabel={`Play from ${fmtClock(seg.start)}`}>
                      <View style={[s.stamp, on && { backgroundColor: d.plum }]}><Text style={[s.stampText, on && { color: '#FFFAF2' }]}>{fmtClock(seg.start)}</Text></View>
                      <Text style={[s.lineText, on && { color: d.ink }]}>{highlight(seg.text, query.trim())}</Text>
                    </Pressable>
                  );
                }) : <Text style={[s.meta, { padding: 16 }]}>No lines match “{query}”.</Text>}
              </View>
            </View>
          )}
        </View>
      ) : null}
    </Page>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: d.paper, borderWidth: 1, borderColor: d.line, borderRadius: 18, padding: 16, marginTop: 12, shadowColor: colors.fg, shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  emptyCard: { backgroundColor: d.paper, borderWidth: 1, borderColor: d.line, borderRadius: 18 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: df.displayBold, fontSize: 17, lineHeight: 22, color: d.ink, letterSpacing: -0.2 },
  meta: { fontFamily: df.sans, fontSize: 12, color: d.muted, marginTop: 4, lineHeight: 16 },
  summary: { fontFamily: df.sans, fontSize: 13.5, color: (isDarkScheme() ? '#CDBBA6' : '#5A4636'), lineHeight: 20, marginTop: 10 },
  body: { fontFamily: df.sans, fontSize: 14.5, color: (isDarkScheme() ? '#D8C7B6' : '#4A3A30'), lineHeight: 22, marginTop: 8 },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 36, paddingHorizontal: 14, borderRadius: 999 },
  btnPrimary: { backgroundColor: d.plum },
  btnGhost: { backgroundColor: d.glass, borderWidth: 1, borderColor: d.line },
  btnDanger: { backgroundColor: '#B33D3D' },
  btnText: { fontFamily: df.sansBold, fontSize: 12 },
  tag: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  tagText: { fontFamily: df.sansBold, fontSize: 10.5, letterSpacing: 0.4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  track: { height: 4, borderRadius: 2, backgroundColor: d.lavender, marginTop: 10, overflow: 'hidden' },
  confirm: { marginTop: 12, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: alpha('#B33D3D', 0.3), backgroundColor: alpha('#B33D3D', 0.06) },
  playerWrap: { borderRadius: 22, overflow: 'hidden', marginTop: 12, shadowColor: colors.fg, shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 4 },
  player: { borderRadius: 22, padding: 18 },
  playBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: d.gold, alignItems: 'center', justifyContent: 'center' },
  playerTitle: { fontFamily: df.displayBold, fontSize: 18, color: '#FFF2E5', marginTop: 2, letterSpacing: -0.2 },
  skip: { height: 32, minWidth: 40, paddingHorizontal: 8, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,242,229,0.3)', alignItems: 'center', justifyContent: 'center' },
  skipText: { color: '#FFF2E5', fontSize: 12, fontFamily: df.sansBold, fontVariant: ['tabular-nums'] },
  seekHit: { height: 26, justifyContent: 'center', marginTop: 12 },
  seekTrack: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)', overflow: 'hidden' },
  seekFill: { height: 4, backgroundColor: d.gold },
  seekKnob: { position: 'absolute', top: 7, width: 12, height: 12, borderRadius: 6, backgroundColor: colors.peachTint },
  time: { color: 'rgba(255,242,229,0.72)', fontSize: 11.5, fontFamily: df.sansBold, fontVariant: ['tabular-nums'] },
  aiNote: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 14, backgroundColor: (isDarkScheme() ? '#3A2E14' : '#FBF0D2'), borderWidth: 1, borderColor: alpha(d.gold, 0.4) },
  aiNoteText: { flex: 1, fontFamily: df.sansSemi, fontSize: 12.5, color: d.goldDark },
  notesTitle: { fontFamily: df.displayBold, fontSize: 21, lineHeight: 27, color: d.ink, letterSpacing: -0.4 },
  pointRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 12 },
  pointNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: d.lavender, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  pointNumText: { fontFamily: df.sansHeavy, fontSize: 11.5, color: d.plum },
  refWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  refChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: (isDarkScheme() ? '#3A2E14' : '#FBF0D2'), borderWidth: 1, borderColor: alpha(d.gold, 0.4) },
  refText: { fontFamily: df.displayBold, fontSize: 14, color: d.goldDark },
  quote: { borderLeftWidth: 3, borderLeftColor: d.plum, paddingLeft: 12, marginTop: 12 },
  quoteText: { fontFamily: df.displayItalic, fontSize: 16.5, lineHeight: 24, color: (isDarkScheme() ? '#D8C7B6' : '#4A3A30') },
  prayerCard: { borderRadius: 22, overflow: 'hidden', marginTop: 12 },
  prayerInner: { borderRadius: 22, padding: 18 },
  prayerText: { fontFamily: df.displayItalic, fontSize: 17, lineHeight: 26, color: '#FFF2E5', marginTop: 10 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, paddingHorizontal: 14, height: 44, borderRadius: 999, backgroundColor: d.paper, borderWidth: 1, borderColor: d.line },
  searchInput: { flex: 1, fontFamily: df.sans, fontSize: 14.5, color: d.ink, paddingVertical: 0, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null) },
  line: { flexDirection: 'row', gap: 12, paddingVertical: 11, paddingHorizontal: 14, alignItems: 'flex-start' },
  lineSep: { borderTopWidth: 1, borderTopColor: d.line },
  lineOn: { backgroundColor: d.lavender },
  stamp: { minWidth: 44, paddingVertical: 3, paddingHorizontal: 6, borderRadius: 6, backgroundColor: d.ivory, alignItems: 'center', marginTop: 1 },
  stampText: { fontSize: 10.5, fontFamily: df.sansBold, color: d.muted, fontVariant: ['tabular-nums'] },
  lineText: { flex: 1, fontFamily: df.display, fontSize: 15.5, lineHeight: 23, color: (isDarkScheme() ? '#D8C7B6' : '#4A3A30') },
  mark: { backgroundColor: alpha(d.gold, 0.5), color: d.ink },
});
