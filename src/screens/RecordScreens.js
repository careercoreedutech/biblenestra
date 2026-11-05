// Record (Sermon Studio) — online mode UI: the server-backed recordings list (used inside SermonStudioScreen)
// and the recording detail screen (audio player · searchable transcript · AI sermon notes).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { Audio } from 'expo-av';
import { Screen, Section, Button, Input, Badge, Empty, Eyebrow, Pills, alpha, NightGlow } from '../components/ui';
import { Icon } from '../components/Icons';
import { PressScale, FadeInUp, ScaleIn, Pulse, AnimatedBar, Shimmer, Pop } from '../components/Motion';
import { colors, fonts, radius, shadow } from '../theme';
import { useNav } from '../navigation';
import { useToast } from '../components/Toast';
import { useApi } from '../api/auth';
import { errorMessage } from '../api/client';
import { parseRef } from '../data/bible';
import { audioSource, fmtClock, notesAsText, STATUS_LABEL, isStaleUpload } from '../api/recordings';

const STATUS_TINT = { uploading: colors.sky, transcribing: colors.lavender, summarising: colors.lavender, ready: colors.teal, error: colors.negative };
const when = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return `Today · ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
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

function StatusChip({ rec }) {
  const stale = isStaleUpload(rec);
  const label = stale ? 'Incomplete' : rec.busy ? 'Waiting' : STATUS_LABEL[rec.status] || rec.status;
  return <Pop trigger={rec.status}><Badge label={label} tint={stale ? colors.negative : rec.busy ? colors.amber : STATUS_TINT[rec.status] || colors.muted} /></Pop>;
}

function Working({ rec, compact }) {
  const text = rec.busy ? rec.error : rec.status === 'summarising' ? 'Writing your sermon notes…' : rec.status === 'uploading' ? 'Waiting for the upload…' : 'Transcribing the recording…';
  return (
    <View style={{ marginTop: compact ? 10 : 0 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pulse active={!rec.busy} min={0.6} max={1.1} duration={600}><View style={[s.dot, { backgroundColor: rec.busy ? colors.amber : colors.lavender }]} /></Pulse>
        <Text style={[s.meta, { marginTop: 0, color: rec.busy ? colors.amber : colors.lavender, flex: 1 }]}>{text}</Text>
      </View>
      {!rec.busy && rec.status !== 'uploading' ? (
        <AnimatedBar progress={rec.status === 'summarising' ? 0.92 : Math.max(0.06, rec.progress || 0.08)} style={s.track} fillStyle={{ backgroundColor: colors.lavender }} />
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
    <Section title="Your recordings" action={items && items.length ? 'Refresh' : undefined} onAction={() => { cloud.refresh(); toast.show('Up to date', { icon: 'check' }); }}>
      {cloud.uploads.map((u) => (
        <ScaleIn key={u.key} from={0.94} style={s.card}>
          <View style={s.head}>
            <View style={[s.iconWrap, { backgroundColor: colors.cardSky }]}><Icon name={u.error ? 'x' : 'download'} size={17} color={u.error ? colors.negative : colors.sky} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.title} numberOfLines={1}>{u.title}</Text>
              <Text style={[s.meta, u.error && { color: colors.negative }]}>{u.error ? u.error : `Uploading · ${Math.round((u.progress || 0) * 100)}%`}</Text>
            </View>
          </View>
          {u.error ? (
            <View style={s.btnRow}>
              <Button small label="Try upload again" onPress={() => cloud.retryUpload(u.key).catch(() => {})} />
              <Button small kind="ghost" label="Dismiss" onPress={() => cloud.dismissUpload(u.key)} />
            </View>
          ) : <AnimatedBar progress={Math.max(0.04, u.progress || 0)} style={s.track} fillStyle={{ backgroundColor: colors.sky }} delay={0} />}
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
                <View style={[s.iconWrap, { backgroundColor: rec.status === 'ready' ? colors.cardSage : colors.cardLavender }]}>
                  <Icon name={rec.status === 'ready' ? 'devotional' : 'mic'} size={17} color={rec.status === 'ready' ? colors.teal : colors.lavender} />
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
                  <Text style={[s.meta, { color: colors.negative, marginTop: 10 }]}>This upload didn’t finish, so there’s no audio to transcribe.</Text>
                  <View style={s.btnRow}><Button small kind="ghost" label="Remove" onPress={() => removeStale(rec)} /></View>
                </View>
              ) : ['uploading', 'transcribing', 'summarising'].includes(rec.status) ? <Working rec={rec} compact /> : null}
              {rec.status === 'error' ? <Text style={[s.meta, { color: colors.negative, marginTop: 10 }]}>{rec.error || 'Something went wrong. Your audio is safe.'}</Text> : null}
              {rec.status === 'error' || rec.busy ? (
                <View style={s.btnRow}><Button small label={rec.busy ? 'Try now' : 'Retry'} onPress={() => retry(rec)} /></View>
              ) : null}
            </PressScale>
          </Enter>
        );
      }) : (
        <ScaleIn from={0.94} style={s.emptyCard}>
          <Empty title="No recordings yet" body="Record a sermon above. When you stop, it uploads privately and you get a transcript and AI sermon notes." />
        </ScaleIn>
      )}
      {cloud.error ? <Text style={[s.meta, { color: colors.negative }]}>{cloud.error}</Text> : null}
    </Section>
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
      <Eyebrow tint={colors.gold}>{title}</Eyebrow>
      {children}
    </FadeInUp>
  );
  return (
    <View>
      <FadeInUp style={s.aiNote}>
        <Icon name="sparkles" size={14} color={colors.gold} />
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
              <Icon name="book" size={13} color={colors.gold} />
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
          <Icon name="check-circle" size={16} color={colors.sage} />
          <Text style={[s.body, { flex: 1, marginTop: 0 }]}>{a}</Text>
        </View>
      )), 5) : null}
      {n.prayer ? (
        <FadeInUp index={6} style={s.prayerCard}>
          <NightGlow />
          <Eyebrow tint={colors.goldLight}>Closing prayer</Eyebrow>
          <Text style={s.prayerText}>{n.prayer}</Text>
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
    return <Screen back title="Recording"><View style={[s.emptyCard, { marginTop: 12 }]}><Empty title="Sign in to get transcripts & notes" body="Recordings are kept on this device in local mode. Sign in to upload them and get a transcript and AI sermon notes." /></View></Screen>;
  }
  if (loadErr) {
    return (
      <Screen back title="Recording">
        <View style={[s.emptyCard, { marginTop: 12 }]}>
          <Empty title={loadErr === 'missing' ? 'Recording not found' : 'Couldn’t load'} body={loadErr === 'missing' ? 'It may have been deleted.' : loadErr} action={loadErr === 'missing' ? 'Back to Sermon Studio' : 'Try again'} onAction={() => (loadErr === 'missing' ? nav.pop() : load())} />
        </View>
      </Screen>
    );
  }
  if (!rec) {
    return <Screen back title="Recording"><View style={s.card}><Shimmer style={{ height: 22, width: '70%', borderRadius: 8 }} /><Shimmer style={{ height: 12, width: '45%', borderRadius: 6, marginTop: 12 }} /></View></Screen>;
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
    <Screen back title={rec.title} subtitle={[when(rec.createdAt), rec.speaker, rec.passage].filter(Boolean).join(' · ')}>
      {/* Player */}
      <ScaleIn from={0.95} style={s.player}>
        <NightGlow />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Pulse active={player.playing} min={0.96} max={1.06} duration={800}>
            <PressScale scaleTo={0.9} onPress={player.toggle} disabled={!rec.hasAudio || player.loading} style={s.playBtn} accessibilityRole="button" accessibilityLabel={player.playing ? 'Pause' : 'Play recording'}>
              <Icon name={player.playing ? 'pause' : 'play'} size={22} color={colors.night} fill={player.playing ? undefined : 'solid'} />
            </PressScale>
          </Pulse>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Eyebrow tint={colors.goldLight}>{player.loading ? 'Loading audio…' : player.playing ? 'Playing' : 'Recording'}</Eyebrow>
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
        {player.error ? <Text style={[s.time, { color: colors.goldLight, marginTop: 6 }]}>{player.error}</Text> : null}
      </ScaleIn>

      {/* Actions */}
      {renaming != null ? (
        <FadeInUp distance={6} style={[s.card, { marginTop: 12 }]}>
          <Input value={renaming} onChangeText={setRenaming} placeholder="Recording title" autoFocus />
          <View style={s.btnRow}>
            <Button small label="Save name" disabled={!renaming.trim() || renaming.trim() === rec.title} onPress={rename} />
            <Button small kind="ghost" label="Cancel" onPress={() => setRenaming(null)} />
          </View>
        </FadeInUp>
      ) : confirmDel ? (
        <FadeInUp distance={6} style={s.confirm}>
          <Text style={[s.title, { color: colors.negative, fontSize: 16 }]}>Delete this recording?</Text>
          <Text style={s.meta}>The audio, transcript and notes are removed from your account. This can’t be undone.</Text>
          <View style={s.btnRow}>
            <Button small label="Delete" onPress={remove} style={{ backgroundColor: colors.negative }} />
            <Button small kind="ghost" label="Cancel" onPress={() => setConfirmDel(false)} />
          </View>
        </FadeInUp>
      ) : (
        <View style={[s.btnRow, { marginTop: 12 }]}>
          {ready ? <Button small label="Share notes" icon={<Icon name="share" size={13} color="#FFFFFF" />} onPress={() => shareText(toast, exportText, 'Notes shared')} /> : null}
          <Button small kind="ghost" label="Rename" icon={<Icon name="edit" size={12} color={colors.fg} />} onPress={() => setRenaming(rec.title)} />
          <Button small kind="ghost" label="Delete" icon={<Icon name="trash" size={12} color={colors.fg} />} onPress={() => setConfirmDel(true)} />
        </View>
      )}

      {/* Processing / error states */}
      {!ready ? (
        <FadeInUp index={1} style={s.card}>
          <View style={s.head}>
            <Text style={[s.title, { flex: 1 }]}>{rec.status === 'error' ? 'Something went wrong' : rec.busy ? 'Waiting to transcribe' : 'Preparing your notes'}</Text>
            <StatusChip rec={rec} />
          </View>
          {rec.status === 'error' ? <Text style={[s.body, { color: colors.negative }]}>{rec.error}</Text> : <Working rec={rec} compact />}
          {!rec.busy && rec.status !== 'error' ? <Text style={s.meta}>This usually takes a minute or two for a 30-minute sermon. You can leave this screen — it keeps going.</Text> : null}
          {rec.status === 'error' || rec.busy ? <View style={s.btnRow}><Button small label={rec.busy ? 'Try now' : 'Retry'} onPress={retry} /></View> : null}
        </FadeInUp>
      ) : null}

      {ready || segments.length ? (
        <View style={{ marginTop: 18 }}>
          {ready && rec.notes ? <Pills items={['Notes', 'Transcript']} value={tab} onChange={setTab} /> : null}
          {tab === 'Notes' && rec.notes ? <NotesView rec={rec} onRef={openRef} /> : (
            <View>
              <View style={s.search}>
                <Icon name="search" size={15} color={colors.muted} />
                <TextInput value={query} onChangeText={setQuery} placeholder="Search the transcript" placeholderTextColor={colors.faint} style={s.searchInput} accessibilityLabel="Search the transcript" />
                {query ? <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search"><Icon name="x" size={14} color={colors.muted} /></Pressable> : null}
              </View>
              {query ? <Text style={[s.meta, { marginTop: 8 }]}>{shown.length} match{shown.length === 1 ? '' : 'es'} · tap a line to play from there</Text> : <Text style={[s.meta, { marginTop: 8 }]}>Tap a line to play from there</Text>}
              <View style={[s.card, { paddingVertical: 4, paddingHorizontal: 0 }]}>
                {shown.length ? shown.map((seg) => {
                  const i = segments.indexOf(seg);
                  const on = i === activeIdx;
                  return (
                    <Pressable key={i} onPress={() => player.seek(seg.start * 1000, true)} style={({ pressed }) => [s.line, i > 0 && s.lineSep, on && s.lineOn, pressed && { backgroundColor: colors.raised }]} accessibilityRole="button" accessibilityLabel={`Play from ${fmtClock(seg.start)}`}>
                      <View style={[s.stamp, on && { backgroundColor: colors.primary }]}><Text style={[s.stampText, on && { color: '#FFFFFF' }]}>{fmtClock(seg.start)}</Text></View>
                      <Text style={[s.lineText, on && { color: colors.fg }]}>{highlight(seg.text, query.trim())}</Text>
                    </Pressable>
                  );
                }) : <Text style={[s.meta, { padding: 16 }]}>No lines match “{query}”.</Text>}
              </View>
            </View>
          )}
        </View>
      ) : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: 16, marginTop: 12, ...shadow.sm },
  emptyCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, ...shadow.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.serifBold, fontSize: 17, lineHeight: 22, color: colors.fg, letterSpacing: -0.2 },
  meta: { fontSize: 12, color: colors.muted, marginTop: 4, lineHeight: 16 },
  summary: { fontSize: 13.5, color: colors.passage, lineHeight: 20, marginTop: 10 },
  body: { fontSize: 14.5, color: colors.passage, lineHeight: 22, marginTop: 8 },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.raised, marginTop: 10, overflow: 'hidden' },
  confirm: { marginTop: 12, padding: 14, borderRadius: radius.lg, borderWidth: 1, borderColor: alpha(colors.negative, 0.3), backgroundColor: alpha(colors.negative, 0.06) },
  player: { backgroundColor: colors.night, borderRadius: radius.lg, padding: 16, marginTop: 12, overflow: 'hidden', ...shadow.md },
  playBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.goldLight, alignItems: 'center', justifyContent: 'center' },
  playerTitle: { fontFamily: fonts.serifBold, fontSize: 18, color: colors.nightFg, marginTop: 2, letterSpacing: -0.2 },
  skip: { height: 32, minWidth: 40, paddingHorizontal: 8, borderRadius: 16, borderWidth: 1, borderColor: colors.nightBorder, alignItems: 'center', justifyContent: 'center' },
  skipText: { color: colors.nightFg, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  seekHit: { height: 26, justifyContent: 'center', marginTop: 12 },
  seekTrack: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.16)', overflow: 'hidden' },
  seekFill: { height: 4, backgroundColor: colors.goldLight },
  seekKnob: { position: 'absolute', top: 7, width: 12, height: 12, borderRadius: 6, backgroundColor: colors.nightFg },
  time: { color: colors.nightMuted, fontSize: 11.5, fontWeight: '600', fontVariant: ['tabular-nums'] },
  aiNote: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, paddingVertical: 9, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: colors.cardGold, borderWidth: 1, borderColor: alpha(colors.gold, 0.25) },
  aiNoteText: { flex: 1, fontSize: 12.5, fontWeight: '600', color: colors.goldMuted },
  notesTitle: { fontFamily: fonts.serifBold, fontSize: 21, lineHeight: 27, color: colors.fg, letterSpacing: -0.4 },
  pointRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 12 },
  pointNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  pointNumText: { fontSize: 11.5, fontWeight: '800', color: colors.primary },
  refWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  refChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.cardGold, borderWidth: 1, borderColor: alpha(colors.gold, 0.22) },
  refText: { fontFamily: fonts.serifBold, fontSize: 14, color: colors.goldMuted },
  quote: { borderLeftWidth: 3, borderLeftColor: colors.goldLight, paddingLeft: 12, marginTop: 12 },
  quoteText: { fontFamily: fonts.serifItalic, fontSize: 16.5, lineHeight: 24, color: colors.passage },
  prayerCard: { backgroundColor: colors.night, borderRadius: radius.lg, padding: 18, marginTop: 12, overflow: 'hidden', ...shadow.md },
  prayerText: { fontFamily: fonts.serifItalic, fontSize: 17, lineHeight: 26, color: colors.nightFg, marginTop: 10 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, paddingHorizontal: 14, height: 44, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, fontSize: 14.5, color: colors.fg, paddingVertical: 0, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null) },
  line: { flexDirection: 'row', gap: 12, paddingVertical: 11, paddingHorizontal: 14, alignItems: 'flex-start' },
  lineSep: { borderTopWidth: 1, borderTopColor: colors.rule },
  lineOn: { backgroundColor: colors.primarySoft },
  stamp: { minWidth: 44, paddingVertical: 3, paddingHorizontal: 6, borderRadius: 6, backgroundColor: colors.raised, alignItems: 'center', marginTop: 1 },
  stampText: { fontSize: 10.5, fontWeight: '700', color: colors.muted, fontVariant: ['tabular-nums'] },
  lineText: { flex: 1, fontFamily: fonts.serif, fontSize: 15.5, lineHeight: 23, color: colors.passage },
  mark: { backgroundColor: alpha(colors.goldLight, 0.4), color: colors.fg },
});
