// BOOKS (brief 18 / 18.1)
//   BooksScreen        — the Books library: sections, search, typographic covers, and the audio books (uploaded by the client)
//   BookDetailScreen   — one book: description, licence and source, contents, my bookmarks, Read
//   BookReadScreen     — the in-app reader: chapters, progress, bookmarks, search inside the book
//   AudioBookScreen    — an audio book: play/pause, progress, speed, resume, chapter navigation
// Texts are public domain (Project Gutenberg, licence header/footer removed by the server). Each book shows its source.
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Audio } from 'expo-av';
import { DScreen, DButton, DInput } from '../design/profile/parts';
import { d, df, Tap, Grad } from '../design/sanctuary';
import { Empty } from '../components/ui';
import { useToast } from '../components/Toast';
import { useNav } from '../navigation';
import { useApi } from '../api/auth';
import { errorMessage } from '../api/client';
import { useLibraryApi, toTrack, fmtDuration } from '../api/library';

// Typographic covers: a warm gradient with the title set in the display face (no image files needed).
const COVER_COLORS = [['#2D1D13', '#88451F'], [d.sageDark, '#7C8F52'], [d.plumDark, '#B8643A'], ['#3B3A4A', '#6B6A80'], [d.goldDark, '#B98A2C']];
function TypeCover({ title, author, index = 0, width = 96, height = 136 }) {
  const c = COVER_COLORS[index % COVER_COLORS.length];
  return (
    <Grad colors={c} style={{ width, height, borderRadius: 10, padding: 10, justifyContent: 'space-between' }}>
      <Text numberOfLines={4} style={{ fontFamily: df.display, fontSize: width > 120 ? 20 : 14, color: '#FFF6EA', lineHeight: width > 120 ? 24 : 17 }}>{title}</Text>
      <Text numberOfLines={2} style={{ fontFamily: df.sans, fontSize: 10, color: '#F4D9BD', letterSpacing: 0.4 }}>{author}</Text>
    </Grad>
  );
}

function Chip({ label, on, onPress }) {
  return (
    <Tap onPress={onPress} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: on ? d.plum : d.line, backgroundColor: on ? `${d.plum}18` : 'transparent' }} accessibilityRole="button" accessibilityState={{ selected: !!on }}>
      <Text style={{ fontFamily: df.sansSemi, fontSize: 13, color: on ? d.plum : d.ink }}>{label}</Text>
    </Tap>
  );
}

// ---------- the library ----------
export function BooksScreen() {
  const nav = useNav();
  const api = useApi();
  const lib = useLibraryApi();
  const [section, setSection] = useState(null);
  const [query, setQuery] = useState('');
  const [data, setData] = useState(null);
  const [audio, setAudio] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!api.online) { setData({ sections: [], items: [] }); return; }
    const qs = [section ? `section=${section}` : '', query.trim() ? `q=${encodeURIComponent(query.trim())}` : ''].filter(Boolean).join('&');
    api.request('GET', `/books/catalogue${qs ? `?${qs}` : ''}`)
      .then((r) => { setData(r); setError(null); })
      .catch((e) => setError(errorMessage(e, 'Couldn’t load the Books library')));
  }, [api.online, api.request, section, query]);
  useEffect(() => {
    if (!lib.online) return;
    lib.list({ kind: 'audio', category: 'audiobooks', limit: 40 })
      .then((r) => setAudio(r.items || []))
      .catch(() => setAudio([]));
  }, [lib.online]);
  return (
    <DScreen back onBack={() => nav.pop()} title="Books" subtitle="Public-domain Christian classics and audio books">
      <DInput value={query} onChangeText={setQuery} placeholder="Search books or authors" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 12 }}>
        <Chip label="All" on={!section} onPress={() => setSection(null)} />
        {(data && data.sections || []).map((s) => <Chip key={s.id} label={s.name} on={section === s.id} onPress={() => setSection(s.id)} />)}
      </ScrollView>
      {error ? <Empty title="Couldn’t load books" body={error} /> : null}
      {!data && !error ? <ActivityIndicator color={d.plum} style={{ marginTop: 30 }} /> : null}
      {data && !data.items.length ? <Empty title="No books found" body="Try another section or search." /> : null}
      {(data && data.items || []).map((b, i) => (
        <Pressable key={b.id} onPress={() => nav.push('BookDetail', { id: b.id })} accessibilityRole="button" accessibilityLabel={`Open ${b.title}`} style={{ flexDirection: 'row', gap: 14, backgroundColor: d.paper, borderRadius: 16, padding: 12, marginTop: 10, borderWidth: 1, borderColor: d.line }}>
          <TypeCover title={b.title} author={b.author} index={i} />
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <Text style={{ fontFamily: df.display, fontSize: 17, color: d.ink }}>{b.title}</Text>
            <Text style={{ fontFamily: df.sans, fontSize: 13, color: d.muted, marginTop: 2 }}>{b.author}</Text>
            <Text numberOfLines={3} style={{ fontFamily: df.sans, fontSize: 13, color: d.ink, marginTop: 6, lineHeight: 18 }}>{b.description}</Text>
          </View>
        </Pressable>
      ))}
      {audio && audio.length ? (
        <View style={{ marginTop: 22 }}>
          <Text style={{ fontFamily: df.display, fontSize: 20, color: d.ink }}>Audio books</Text>
          {audio.map((it) => (
            <Pressable key={it.id} onPress={() => nav.push('AudioBook', { id: it.id })} accessibilityRole="button" accessibilityLabel={`Play ${it.title}`} style={{ flexDirection: 'row', gap: 14, backgroundColor: d.paper, borderRadius: 16, padding: 12, marginTop: 10, borderWidth: 1, borderColor: d.line, alignItems: 'center' }}>
              {it.coverUrl ? <View style={{ width: 64, height: 64, borderRadius: 10, overflow: 'hidden' }}><Text /></View> : <TypeCover title={it.title} author={it.artist || ''} index={1} width={64} height={64} />}
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: df.sansSemi, fontSize: 15, color: d.ink }}>{it.title}</Text>
                <Text style={{ fontFamily: df.sans, fontSize: 12, color: d.muted, marginTop: 2 }}>{it.artist || 'Audio book'} · {(it.chapters || []).length || 1} chapter{(it.chapters || []).length === 1 ? '' : 's'}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
    </DScreen>
  );
}

// ---------- one book ----------
export function BookDetailScreen({ params = {} }) {
  const nav = useNav();
  const api = useApi();
  const toast = useToast();
  const [book, setBook] = useState(null);
  const [marks, setMarks] = useState([]);
  const [error, setError] = useState(null);
  useEffect(() => {
    api.request('GET', `/books/${params.id}`).then(setBook).catch((e) => setError(errorMessage(e, 'This book is unavailable right now')));
    api.request('GET', `/books/${params.id}/bookmarks`).then((r) => setMarks(r.items || [])).catch(() => {});
  }, [api.request, params.id]);
  const start = (chapter) => nav.push('BookRead', { id: params.id, chapter });
  if (error) return <DScreen back onBack={() => nav.pop()} title="Book"><Empty title="Book unavailable" body={error} /></DScreen>;
  if (!book) return <DScreen back onBack={() => nav.pop()} title="Book"><ActivityIndicator color={d.plum} style={{ marginTop: 30 }} /></DScreen>;
  return (
    <DScreen back onBack={() => nav.pop()} title={book.title} subtitle={book.author}>
      <View style={{ alignItems: 'center', marginTop: 4 }}><TypeCover title={book.title} author={book.author} width={150} height={210} /></View>
      <Text style={{ fontFamily: df.sans, fontSize: 15, color: d.ink, lineHeight: 23, marginTop: 18 }}>{book.description}</Text>
      <Text style={{ fontFamily: df.sans, fontSize: 12, color: d.muted, marginTop: 14, lineHeight: 18 }}>{book.attribution}</Text>
      <Tap onPress={() => nav.push('WebsiteViewer', { url: book.sourceUrl, title: 'Project Gutenberg', host: 'gutenberg.org' })} style={{ marginTop: 4 }}><Text style={{ fontFamily: df.sansSemi, fontSize: 13, color: d.plum }}>Source: Project Gutenberg</Text></Tap>
      <DButton label={book.progress ? `Continue · ${book.progress.percent}%` : 'Start reading'} onPress={() => start(book.progress ? book.progress.chapter : 0)} style={{ marginTop: 18, alignSelf: 'flex-start' }} />
      <Text style={{ fontFamily: df.display, fontSize: 18, color: d.ink, marginTop: 24 }}>Contents</Text>
      {book.chapters.map((c) => (
        <Tap key={c.index} onPress={() => start(c.index)} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: d.line }} accessibilityRole="button">
          <Text style={{ fontFamily: df.sans, fontSize: 14, color: d.ink }}>{c.title}</Text>
        </Tap>
      ))}
      {marks.length ? (<>
        <Text style={{ fontFamily: df.display, fontSize: 18, color: d.ink, marginTop: 24 }}>My bookmarks</Text>
        {marks.map((m) => (
          <Tap key={m.id} onPress={() => start(m.chapter)} style={{ paddingVertical: 10 }} accessibilityRole="button">
            <Text style={{ fontFamily: df.sans, fontSize: 14, color: d.ink }}>{m.label || `Chapter ${m.chapter + 1}`}</Text>
          </Tap>
        ))}
      </>) : null}
    </DScreen>
  );
}

// ---------- the reader ----------
export function BookReadScreen({ params = {} }) {
  const nav = useNav();
  const api = useApi();
  const toast = useToast();
  const [index, setIndex] = useState(Number(params.chapter) || 0);
  const [chapter, setChapter] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState(null);
  const [bookTitle, setBookTitle] = useState('');
  useEffect(() => {
    let alive = true;
    setChapter(null); setError(null);
    api.request('GET', `/books/${params.id}/chapters/${index}`)
      .then((r) => { if (alive) setChapter(r); })
      .catch((e) => { if (alive) setError(errorMessage(e, 'This chapter is unavailable right now')); });
    // Remember where I am (the server keeps one place per book).
    api.request('PUT', `/books/${params.id}/progress`, { chapter: index, paragraph: 0 }).catch(() => {});
    return () => { alive = false; };
  }, [api.request, params.id, index]);
  useEffect(() => {
    api.request('GET', `/books/${params.id}`).then((b) => setBookTitle(b.title)).catch(() => {});
  }, [api.request, params.id]);
  const bookmark = async () => {
    try {
      await api.request('POST', `/books/${params.id}/bookmarks`, { chapter: index, paragraph: 0, label: chapter ? chapter.title : undefined });
      toast.show('Bookmark added', { icon: 'bookmark' });
    } catch (e) { toast.show(errorMessage(e, 'Couldn’t add the bookmark'), { tone: 'error' }); }
  };
  const find = async () => {
    if (q.trim().length < 2) { toast.show('Type at least two letters to search', { tone: 'error' }); return; }
    try {
      const r = await api.request('GET', `/books/${params.id}/search?q=${encodeURIComponent(q.trim())}`);
      setHits(r.items || []);
    } catch (e) { toast.show(errorMessage(e, 'Search failed'), { tone: 'error' }); }
  };
  return (
    <DScreen back onBack={() => nav.pop()} title={bookTitle || 'Reading'} subtitle={chapter ? `${index + 1} of ${chapter.total}` : ''}>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
        <DInput value={q} onChangeText={setQ} placeholder="Find in this book" style={{ flex: 1 }} onSubmitEditing={find} returnKeyType="search" />
        <DButton small label="Find" onPress={find} />
      </View>
      {hits ? (
        <View style={{ marginTop: 10 }}>
          <Text style={{ fontFamily: df.sans, fontSize: 13, color: d.muted }}>{hits.length ? `${hits.length} match${hits.length === 1 ? '' : 'es'}` : 'No matches'}</Text>
          {hits.map((h, i) => (
            <Tap key={i} onPress={() => { setIndex(h.chapter); setHits(null); }} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: d.line }} accessibilityRole="button">
              <Text style={{ fontFamily: df.sansSemi, fontSize: 12, color: d.plum }}>{h.title}</Text>
              <Text style={{ fontFamily: df.sans, fontSize: 13, color: d.ink, marginTop: 2 }}>{h.snippet}</Text>
            </Tap>
          ))}
        </View>
      ) : null}
      {error ? <Empty title="Chapter unavailable" body={error} /> : null}
      {!chapter && !error ? <ActivityIndicator color={d.plum} style={{ marginTop: 30 }} /> : null}
      {chapter ? (
        <View style={{ marginTop: 14 }}>
          <Text style={{ fontFamily: df.display, fontSize: 22, color: d.ink, marginBottom: 6 }}>{chapter.title}</Text>
          {chapter.paragraphs.map((p, i) => <Text key={i} style={{ fontFamily: df.sans, fontSize: 17, color: d.ink, lineHeight: 27, marginTop: 12 }}>{p}</Text>)}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 24, gap: 8 }}>
            <DButton small label="Previous" disabled={chapter.prev == null} onPress={() => setIndex(chapter.prev)} />
            <DButton small label="Bookmark" onPress={bookmark} />
            <DButton small label="Next" disabled={chapter.next == null} onPress={() => setIndex(chapter.next)} />
          </View>
          <Text style={{ fontFamily: df.sans, fontSize: 12, color: d.muted, marginTop: 18, lineHeight: 18 }}>Public domain. Text from Project Gutenberg. Their licence header and footer have been removed.</Text>
        </View>
      ) : null}
    </DScreen>
  );
}

// ---------- audio books ----------
// Resume is stored through the library progress endpoint as one number: chapter index × 100000 + whole seconds.
const encodePos = (chapter, sec) => chapter * 100000 + Math.floor(sec);
const decodePos = (pos) => ({ chapter: Math.floor(Number(pos) / 100000), sec: Number(pos) % 100000 });
const SPEEDS = [1, 1.25, 1.5, 2];

export function AudioBookScreen({ params = {} }) {
  const nav = useNav();
  const lib = useLibraryApi();
  const toast = useToast();
  const [item, setItem] = useState(null);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [speed, setSpeed] = useState(1);
  const soundRef = useRef(null);
  const lastSave = useRef(0);
  const chapters = item ? (item.chapters && item.chapters.length ? item.chapters : [{ index: 1, title: item.title, url: item.fileUrl }]) : [];

  useEffect(() => {
    lib.item(params.id).then((it) => {
      setItem(it);
      const saved = it.myProgress && it.myProgress.position ? decodePos(it.myProgress.position) : null;
      if (saved && saved.chapter < ((it.chapters && it.chapters.length) || 1)) { setCurrent(saved.chapter); setPos(saved.sec * 1000); }
    }).catch((e) => toast.show(errorMessage(e, 'Couldn’t open this audio book'), { tone: 'error' }));
    return () => { if (soundRef.current) soundRef.current.unloadAsync().catch(() => {}); };
  }, [params.id]);

  useEffect(() => {
    if (!chapters.length) return undefined;
    let alive = true;
    (async () => {
      if (soundRef.current) { await soundRef.current.unloadAsync().catch(() => {}); soundRef.current = null; }
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true }).catch(() => {});
      const ch = chapters[current];
      const { sound } = await Audio.Sound.createAsync({ uri: ch.url }, { shouldPlay: false, rate: speed, shouldCorrectPitch: true, positionMillis: pos }, (st) => {
        if (!st.isLoaded || !alive) return;
        setPlaying(st.isPlaying);
        setDur(st.durationMillis || 0);
        setPos(st.positionMillis || 0);
        if (st.didJustFinish) {
          if (current < chapters.length - 1) setCurrent(current + 1); else setPlaying(false);
        }
        if (st.isPlaying && Date.now() - lastSave.current > 15000 && item) {
          lastSave.current = Date.now();
          lib.saveProgress(item.id, encodePos(current, (st.positionMillis || 0) / 1000), false);
        }
      });
      if (!alive) { sound.unloadAsync().catch(() => {}); return; }
      soundRef.current = sound;
      setPos(0);
    })().catch(() => toast.show('This chapter couldn’t be played', { tone: 'error' }));
    return () => { alive = false; };
  }, [current, item && item.id]);

  const toggle = async () => {
    const s = soundRef.current;
    if (!s) return;
    if (playing) await s.pauseAsync(); else await s.playAsync();
    if (item) lib.saveProgress(item.id, encodePos(current, pos / 1000), false);
  };
  const setRate = async (r) => {
    setSpeed(r);
    if (soundRef.current) await soundRef.current.setRateAsync(r, true).catch(() => {});
  };
  const seek = async (ms) => { if (soundRef.current) await soundRef.current.setPositionAsync(Math.max(0, ms)).catch(() => {}); };

  if (!item) return <DScreen back onBack={() => nav.pop()} title="Audio book"><ActivityIndicator color={d.plum} style={{ marginTop: 30 }} /></DScreen>;
  const ch = chapters[current] || chapters[0];
  return (
    <DScreen back onBack={() => nav.pop()} title={item.title} subtitle={item.artist || 'Audio book'}>
      <View style={{ alignItems: 'center', marginTop: 4 }}><TypeCover title={item.title} author={item.artist || ''} index={1} width={180} height={180} /></View>
      <Text style={{ fontFamily: df.sansSemi, fontSize: 15, color: d.ink, textAlign: 'center', marginTop: 16 }}>{ch.title}</Text>
      <Text style={{ fontFamily: df.sans, fontSize: 12, color: d.muted, textAlign: 'center', marginTop: 4 }}>{fmtDuration(pos / 1000)} / {fmtDuration(dur / 1000)}</Text>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: d.line, marginTop: 12, overflow: 'hidden' }}>
        <Pressable onPress={(e) => seek((e.nativeEvent.locationX / 300) * dur)} accessibilityLabel="Seek" style={{ width: '100%', height: 6 }}>
          <View style={{ width: `${dur ? Math.min(100, (pos / dur) * 100) : 0}%`, height: 6, backgroundColor: d.plum }} />
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 14, marginTop: 18 }}>
        <DButton small label="Back 15s" onPress={() => seek(pos - 15000)} />
        <DButton label={playing ? 'Pause' : 'Play'} onPress={toggle} />
        <DButton small label="Forward 30s" onPress={() => seek(pos + 30000)} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 16 }}>
        {SPEEDS.map((r) => <Chip key={r} label={`${r}×`} on={speed === r} onPress={() => setRate(r)} />)}
      </View>
      {chapters.length > 1 ? (<>
        <Text style={{ fontFamily: df.display, fontSize: 18, color: d.ink, marginTop: 26 }}>Chapters</Text>
        {chapters.map((c, i) => (
          <Tap key={c.index} onPress={() => { setPos(0); setCurrent(i); }} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: d.line, flexDirection: 'row', justifyContent: 'space-between' }} accessibilityRole="button" accessibilityState={{ selected: i === current }}>
            <Text style={{ fontFamily: i === current ? df.sansBold : df.sans, fontSize: 14, color: i === current ? d.plum : d.ink }}>{c.title}</Text>
            {c.durationSec ? <Text style={{ fontFamily: df.sans, fontSize: 12, color: d.muted }}>{fmtDuration(c.durationSec)}</Text> : null}
          </Tap>
        ))}
      </>) : null}
    </DScreen>
  );
}
