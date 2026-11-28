// "Create post" — one composer for Text, Photo(s) and Video.
// Text & photo posts go to the community feed (`post`), videos to the reels (`publishVideo`) — the
// parent screen owns the dispatching; this sheet owns the form.
// Photos / videos come from the device (expo-image-picker). In local mode the sample library stays as a
// fallback; online, only real device media is offered (it's uploaded by the sync layer, src/api/sync.js).
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Icon } from '../Icons';
import { colors, fonts, radius, shadow } from '../../theme';
import { Button, alpha } from '../ui';
import { PressScale, FadeInUp, ScaleIn, Pop, Pulse, AnimatedModal } from '../Motion';
import { haptic, useToast } from '../Toast';
import { API_CONFIG } from '../../api/config';
import { pickPhotos, pickVideo, VIDEO_LIMITS } from '../../api/media';
import { PhotoGrid } from './LightFeed'; // preview uses the exact feed grid (1 / 2 / 3 / 2×2 layouts)
import {
  ND,
  WHITE,
  SAMPLE_IMAGES,
  SAMPLE_VIDEOS,
  MAX_PHOTOS,
  parseScriptureRef,
  passageLabel,
  canPickFromDevice,
  pickDevicePhotos,
} from './shared';
import EmbedLinkPanel from './EmbedLinkPanel'; // POST FROM A LINK
import { TextPostCard, DesignSwatch, DESIGNS, DESIGN_GROUPS, FONTS, CARD_MAX_CHARS, encodeDesign, designStateFrom } from './TextPostCard';

const ONLINE = API_CONFIG.online;
// Text posts default to an image-style card (as the original "Content" composer did)
const DEFAULT_DESIGN = { key: 'midnight', font: 'italic', align: 'center' };

function AlignGlyph({ align, color }) {
  const rows = align === 'left' ? [[4, 20], [4, 15], [4, 18], [4, 12]] : [[4, 20], [7, 17], [5, 19], [8, 16]];
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      {rows.map(([a, b], i) => <Path key={i} d={`M${a} ${5 + i * 4.7}H${b}`} stroke={color} strokeWidth={2.2} strokeLinecap="round" />)}
    </Svg>
  );
}
const fmtSecs = (sec) => {
  const s = Math.round(Number(sec) || 0);
  return s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '';
};

export const COMPOSER_MODES = [
  { id: 'text', label: 'Text', icon: 'type' },
  { id: 'photo', label: 'Photo', icon: 'image' },
  { id: 'video', label: 'Video', icon: 'video' },
];
const TEXT_KINDS = ['Reflection', 'Testimony', 'Prayer', 'Question', 'Celebration', 'Announcement'];
const VIDEO_CATEGORIES = ['Sermons', 'Worship', 'Testimonies', 'Bible Study', 'Evangelism'];

function CloseGlyph({ color = colors.muted, size = 12 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 6l12 12M18 6L6 18" stroke={color} strokeWidth={2.6} strokeLinecap="round" />
    </Svg>
  );
}

function UploadVideoPreview({ videoUrl }) {
  const previewPlayer = useVideoPlayer(videoUrl || null, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  return (
    <View style={styles.videoPreview}>
      <View style={styles.videoPreviewPlaceholder}>
        <Icon name="video" size={30} color={colors.goldLight} />
        <Text style={styles.videoPreviewPlaceholderText}>{videoUrl ? 'Loading preview…' : 'Select a video to preview'}</Text>
      </View>
      {videoUrl ? (
        <VideoView style={StyleSheet.absoluteFill} player={previewPlayer} allowsFullscreen={false} allowsPictureInPicture={false} nativeControls={false} contentFit="cover" />
      ) : null}
      <View style={styles.previewBadge}>
        <Pulse min={0.7} max={1.25} duration={800}>
          <View style={styles.previewDot} />
        </Pulse>
        <Text style={styles.previewBadgeText}>LIVE VIDEO PREVIEW</Text>
      </View>
    </View>
  );
}

// Scripture field with a live "found it" / "not found" hint
function ScriptureField({ value, onChange, placeholder }) {
  const p = value.trim() ? parseScriptureRef(value) : null;
  return (
    <>
      <TextInput placeholder={placeholder} placeholderTextColor={colors.faint} value={value} onChangeText={onChange} style={styles.input} />
      {value.trim() ? (
        <FadeInUp key={p ? 'ok' : 'no'} distance={4} duration={220} style={styles.refHint}>
          <Icon name={p ? 'check' : 'x'} size={12} color={p ? colors.positive : colors.negative} strokeWidth={2.6} />
          <Text style={[styles.refHintText, { color: p ? colors.positive : colors.negative }]}>
            {p ? `Links to ${passageLabel(p)}` : 'Couldn’t find that passage — try “John 3:16”'}
          </Text>
        </FadeInUp>
      ) : null}
    </>
  );
}

export default function CreatePostSheet({ visible, onClose, initialMode = 'text', bounty, preset, userName = 'You', onPost, onPublishVideo }) {
  const [mode, setMode] = useState(initialMode);
  const [text, setText] = useState('');
  const [kind, setKind] = useState('Reflection');
  const [design, setDesign] = useState(DEFAULT_DESIGN); // { key, font, align } | null = plain text post
  const [scripture, setScripture] = useState('');
  const toast = useToast();
  const [photos, setPhotos] = useState(ONLINE ? [] : [SAMPLE_IMAGES[0].url]);
  const [devicePhotos, setDevicePhotos] = useState([]); // picked this session
  const [caption, setCaption] = useState('');
  const [videoUrl, setVideoUrl] = useState(ONLINE ? null : SAMPLE_VIDEOS[0].url);
  const [deviceVideo, setDeviceVideo] = useState(null); // { uri, duration, mimeType, name, file? }
  const [category, setCategory] = useState('Worship');
  // POST FROM A LINK: a validated YouTube / Facebook link waiting to be shared (see EmbedLinkPanel)
  const [linkDraft, setLinkDraft] = useState(null);
  const [linkKey, setLinkKey] = useState(0);

  // Re-seed the form each time the sheet opens. A bounty's preset caption is dropped again when the
  // sheet is next opened for a normal post; ordinary drafts are kept between opens.
  const presetUsed = useRef(false);
  useEffect(() => {
    if (!visible) return;
    setMode(bounty ? 'video' : initialMode);
    if (preset && preset.caption != null) {
      setCaption(preset.caption);
      presetUsed.current = true;
    } else if (presetUsed.current) {
      setCaption('');
      presetUsed.current = false;
    }
    if (preset && preset.category) setCategory(preset.category);
    // "Verse" quick action: start a quote-card post from today's verse (never overwrites a draft)
    if (preset && preset.verse) {
      const v = preset.verse;
      setKind('Reflection');
      setDesign(designStateFrom(v.theme) || DEFAULT_DESIGN);
      if (v.text) setText((t) => (t.trim() ? t : v.text));
      if (v.ref) setScripture((s) => (s.trim() ? s : v.ref));
    }
  }, [visible]);

  // Sliding highlight behind the active mode
  const [rowW, setRowW] = useState(0);
  const PAD = 4;
  const tabW = rowW > 0 ? (rowW - PAD * 2 - PAD * (COMPOSER_MODES.length - 1)) / COMPOSER_MODES.length : 0;
  const x = useRef(new Animated.Value(0)).current;
  const placed = useRef(false);
  useEffect(() => {
    if (!tabW) return;
    const i = Math.max(0, COMPOSER_MODES.findIndex((m) => m.id === mode));
    const to = PAD + i * (tabW + PAD);
    if (!placed.current || !visible) {
      placed.current = true;
      x.setValue(to);
      return;
    }
    Animated.spring(x, { toValue: to, useNativeDriver: ND, speed: 20, bounciness: 5 }).start();
  }, [mode, tabW, visible]);

  const library = [...devicePhotos.map((url, i) => ({ id: `dev_${i}`, title: 'From device', url })), ...(ONLINE ? [] : SAMPLE_IMAGES)];
  const togglePhoto = (url) => {
    haptic('select');
    setPhotos((list) => {
      if (list.includes(url)) return list.filter((u) => u !== url);
      if (list.length >= MAX_PHOTOS) return list;
      return [...list, url];
    });
  };
  const addFromDevice = async () => {
    let urls = [];
    try {
      // Web + local mode keeps the downscaling picker (photos are stored on-device as data URLs)
      urls = Platform.OS === 'web' && !ONLINE ? await pickDevicePhotos(MAX_PHOTOS) : (await pickPhotos(MAX_PHOTOS)).map((p) => p.uri);
    } catch (e) {
      toast.show((e && e.message) || 'Couldn’t open your photos', { tone: 'error' });
      return;
    }
    if (!urls.length) return;
    setDevicePhotos((d) => [...urls, ...d].slice(0, 8));
    setPhotos((list) => [...urls, ...list].filter((u, i, a) => a.indexOf(u) === i).slice(0, MAX_PHOTOS));
    haptic('success');
  };

  const chooseVideo = async () => {
    try {
      const v = await pickVideo();
      if (!v) return;
      if (v.duration && v.duration > VIDEO_LIMITS.maxSeconds + 1) {
        toast.show('Videos can be up to 2 hours long', { tone: 'error', icon: 'video' });
        return;
      }
      setDeviceVideo(v);
      setVideoUrl(v.uri);
      haptic('success');
    } catch (e) {
      toast.show((e && e.message) || 'Couldn’t open your videos', { tone: 'error' });
    }
  };

  const reset = () => {
    setLinkDraft(null);
    setLinkKey((k) => k + 1);
    setText('');
    setScripture('');
    setCaption('');
    // the chosen card design is kept for the next post
    setPhotos(ONLINE ? [] : [SAMPLE_IMAGES[0].url]);
    if (ONLINE) { setDeviceVideo(null); setVideoUrl(null); }
  };

  const textLen = text.trim().length;
  const cardFits = textLen <= CARD_MAX_CHARS;
  const canSubmit = linkDraft ? true : mode === 'text' ? !!text.trim() : mode === 'photo' ? photos.length > 0 : !!caption.trim() && !!videoUrl;

  const submit = () => {
    if (!canSubmit) return;
    if (linkDraft) {
      // POST FROM A LINK: posts at once; the server re-checks the link and reads the metadata
      onPost && onPost({ kind: 'Video', text: linkDraft.caption, embed: { provider: linkDraft.provider, url: linkDraft.url, ...(linkDraft.title ? { title: linkDraft.title } : {}) } });
      reset();
      return;
    }
    const passage = parseScriptureRef(scripture);
    if (mode === 'text') {
      const asCard = !!design && cardFits;
      if (design && !cardFits) toast.show('Too long for an image card — shared as a regular text post', { icon: 'type' });
      onPost && onPost({ kind, text: text.trim(), ...(passage ? { passage } : {}), ...(asCard ? { bg: encodeDesign(design) } : {}) });
    } else if (mode === 'photo') {
      onPost && onPost({ kind: 'Photo', text: caption.trim(), images: photos, image: photos[0], ...(passage ? { passage } : {}) });
    } else {
      const fromDevice = deviceVideo && deviceVideo.uri === videoUrl;
      onPublishVideo &&
        onPublishVideo({
          caption: caption.trim(),
          scripture: passage ? passageLabel(passage) : scripture.trim(),
          passage: passage || null,
          category,
          url: videoUrl,
          duration: fromDevice ? fmtSecs(deviceVideo.duration) || '0:30' : (SAMPLE_VIDEOS.find((v) => v.url === videoUrl) || {}).duration || '0:45',
          // online: hand the file to the sync layer for the Cloudflare Stream upload
          ...(ONLINE && fromDevice ? { upload: deviceVideo } : {}),
        });
    }
    reset();
  };

  const submitLabel =
    linkDraft ? 'Share post' : mode === 'text' ? 'Share post' : mode === 'photo' ? (photos.length > 1 ? `Share ${photos.length} photos` : 'Share photo') : bounty ? `Submit for ${bounty.price}` : 'Publish video';

  return (
    <AnimatedModal visible={visible} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Dismiss" />
        <View style={styles.sheet}>
          <View style={styles.pad}>
            <View style={styles.grabber} />
            <View style={styles.head}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.eyebrow}>{bounty ? `Bounty submission · ${bounty.price}` : 'New post'}</Text>
                <Text style={styles.title} numberOfLines={1}>{bounty ? bounty.title : 'Create post'}</Text>
                <Text style={styles.subtitle} numberOfLines={1}>
                  {bounty ? 'Your reel goes to Socials and the campaign owner' : 'Share a word, photos or a video with the community'}
                </Text>
              </View>
              <PressScale onPress={onClose} hitSlop={12} scaleTo={0.88} style={styles.closeBtn} accessibilityLabel="Close">
                <CloseGlyph />
              </PressScale>
            </View>

            {!bounty ? (
              <View style={styles.modeRow} onLayout={(e) => setRowW(e.nativeEvent.layout.width)}>
                {tabW > 0 ? <Animated.View pointerEvents="none" style={[styles.modeIndicator, { width: tabW, transform: [{ translateX: x }] }]} /> : null}
                {COMPOSER_MODES.map((m) => {
                  const on = mode === m.id;
                  return (
                    <Pressable
                      key={m.id}
                      onPress={() => { setMode(m.id); haptic('select'); }}
                      style={[styles.modeTab, on && tabW <= 0 && styles.modeTabActive]}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: on }}
                    >
                      <Pop trigger={on} amount={on ? 1.18 : 1}>
                        <Icon name={m.icon} size={16} color={on ? colors.primary : colors.faint} />
                      </Pop>
                      <Text style={[styles.modeText, on && styles.modeTextActive]}>{m.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            {/* POST FROM A LINK: directly under the Text / Photo / Video tabs */}
            {!bounty ? (
              <View style={{ marginTop: 14 }}>
                <EmbedLinkPanel key={linkKey} online={ONLINE} onChange={setLinkDraft} />
              </View>
            ) : null}
            <FadeInUp key={mode} distance={10} duration={300}>
              {mode === 'text' ? (
                <>
                  <Text style={styles.label}>Type</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bleedContent} style={styles.bleed}>
                    {TEXT_KINDS.map((k) => (
                      <PressScale key={k} onPress={() => setKind(k)} scaleTo={0.93} style={[styles.chip, kind === k && styles.chipActive]} accessibilityState={{ selected: kind === k }}>
                        <Text style={[styles.chipText, kind === k && styles.chipTextActive]}>{k}</Text>
                      </PressScale>
                    ))}
                  </ScrollView>

                  <View style={styles.labelRow}>
                    <Text style={[styles.label, { marginTop: 0, marginBottom: 0 }]}>Your post</Text>
                    {design ? (
                      <Text style={[styles.labelMeta, !cardFits && { color: colors.negative }]}>{textLen}/{CARD_MAX_CHARS}</Text>
                    ) : null}
                  </View>
                  <TextInput
                    placeholder={design ? 'A verse, prayer or word of encouragement…' : 'A verse, reflection, testimony or question…'}
                    placeholderTextColor={colors.faint}
                    value={text}
                    onChangeText={setText}
                    multiline
                    style={[styles.input, styles.inputMulti, { minHeight: 110 }]}
                  />
                  {design && !cardFits ? (
                    <FadeInUp distance={4} duration={220} style={styles.notice}>
                      <Icon name="type" size={14} color={colors.amber || colors.gold} />
                      <Text style={styles.noticeText}>
                        Image cards hold up to {CARD_MAX_CHARS} characters. This will be shared as a regular text post — shorten it to keep the design.
                      </Text>
                    </FadeInUp>
                  ) : null}

                  <Text style={styles.label}>Scripture (optional)</Text>
                  <ScriptureField value={scripture} onChange={setScripture} placeholder="e.g. Romans 8:28" />

                  <Text style={styles.label}>Post as</Text>
                  <View style={styles.segment}>
                    {[['card', 'Image card', 'image'], ['plain', 'Plain text', 'type']].map(([k, l, ic]) => {
                      const on = k === 'card' ? !!design : !design;
                      return (
                        <Pressable
                          key={k}
                          onPress={() => { haptic('select'); setDesign(k === 'card' ? design || DEFAULT_DESIGN : null); }}
                          style={[styles.segBtn, on && styles.segOn]}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on }}
                        >
                          <Icon name={ic} size={14} color={on ? colors.primary : colors.faint} />
                          <Text style={[styles.segText, on && styles.segTextOn]}>{l}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {design ? (
                    <>
                      {/* Live preview — the exact card the feed will show */}
                      <View style={[styles.cardPreviewWrap, !cardFits && { opacity: 0.45 }]}>
                        <TextPostCard
                          theme={encodeDesign(design)}
                          text={text.trim() || 'Your words will appear here as a designed image in the feed.'}
                          passage={parseScriptureRef(scripture) ? passageLabel(parseScriptureRef(scripture)) : ''}
                          style={styles.cardPreview}
                        />
                        <View style={styles.previewBadge} pointerEvents="none">
                          <View style={styles.previewDot} />
                          <Text style={styles.previewBadgeText}>CARD PREVIEW</Text>
                        </View>
                      </View>

                      {DESIGN_GROUPS.map((g) => (
                        <React.Fragment key={g}>
                          <Text style={styles.label}>{g === 'Designs' ? 'Designed backgrounds' : g}</Text>
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.bleedContent, { gap: 4 }]} style={styles.bleed}>
                            {DESIGNS.filter((d) => d.group === g).map((d) => (
                              <DesignSwatch key={d.key} design={d} selected={design.key === d.key} onPress={() => { haptic('select'); setDesign((s) => ({ ...(s || DEFAULT_DESIGN), key: d.key })); }} />
                            ))}
                          </ScrollView>
                        </React.Fragment>
                      ))}

                      <Text style={styles.label}>Font</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bleedContent} style={styles.bleed}>
                        {FONTS.map((f) => {
                          const on = design.font === f.key;
                          return (
                            <PressScale key={f.key} onPress={() => setDesign((s) => ({ ...s, font: f.key }))} scaleTo={0.93} style={[styles.chip, on && styles.chipActive]} accessibilityState={{ selected: on }} accessibilityLabel={`${f.label} font`}>
                              <Text style={[styles.chipText, { fontFamily: f.family, fontSize: 14 }, on && styles.chipTextActive]}>{f.label}</Text>
                            </PressScale>
                          );
                        })}
                      </ScrollView>

                      <Text style={styles.label}>Alignment</Text>
                      <View style={[styles.segment, { alignSelf: 'flex-start', minWidth: 220 }]}>
                        {['center', 'left'].map((a) => {
                          const on = design.align === a;
                          return (
                            <Pressable key={a} onPress={() => setDesign((s) => ({ ...s, align: a }))} style={[styles.segBtn, on && styles.segOn]} accessibilityRole="button" accessibilityLabel={`Align ${a}`} accessibilityState={{ selected: on }}>
                              <AlignGlyph align={a} color={on ? colors.primary : colors.faint} />
                              <Text style={[styles.segText, on && styles.segTextOn]}>{a === 'center' ? 'Centre' : 'Left'}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </>
                  ) : null}
                </>
              ) : null}

              {mode === 'photo' ? (
                <>
                  {/* Live preview — exactly how the post will look in the feed */}
                  <View style={styles.photoPreviewWrap}>
                    {photos.length ? (
                      <View style={styles.gridPreview}>
                        <PhotoGrid key={photos.map((u) => String(u).slice(-18)).join('|')} images={photos} />
                        <View style={styles.previewBadge} pointerEvents="none">
                          <View style={styles.previewDot} />
                          <Text style={styles.previewBadgeText}>PHOTO PREVIEW</Text>
                        </View>
                      </View>
                    ) : (
                      <View style={styles.photoEmpty}>
                        <Icon name="image" size={26} color={colors.goldLight} />
                        <Text style={styles.photoEmptyText}>{ONLINE ? `Add up to ${MAX_PHOTOS} photos from your device` : `Pick up to ${MAX_PHOTOS} photos below`}</Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.labelRow}>
                    <Text style={[styles.label, { marginTop: 0, marginBottom: 0 }]}>Photos</Text>
                    <Text style={styles.labelMeta}>{photos.length}/{MAX_PHOTOS} selected</Text>
                  </View>
                  <View style={styles.grid}>
                    {canPickFromDevice || Platform.OS !== 'web' ? (
                      <PressScale onPress={addFromDevice} scaleTo={0.94} style={[styles.thumb, styles.thumbAdd]} accessibilityLabel="Add photos from this device">
                        <Icon name="plus" size={20} color={colors.primary} strokeWidth={2.4} />
                        <Text style={styles.thumbAddText}>From device</Text>
                      </PressScale>
                    ) : null}
                    {library.map((img) => {
                      const order = photos.indexOf(img.url);
                      const on = order > -1;
                      return (
                        <PressScale key={img.id} onPress={() => togglePhoto(img.url)} scaleTo={0.94} style={[styles.thumb, on && styles.thumbOn]} accessibilityLabel={`${on ? 'Remove' : 'Add'} ${img.title}`} accessibilityState={{ selected: on }}>
                          <Image source={{ uri: img.url }} style={styles.thumbImg} />
                          {on ? (
                            <ScaleIn key={`o_${order}`} style={styles.thumbBadge}>
                              <Text style={styles.thumbBadgeText}>{order + 1}</Text>
                            </ScaleIn>
                          ) : (
                            <View style={styles.thumbRing} />
                          )}
                        </PressScale>
                      );
                    })}
                  </View>

                  <Text style={styles.label}>Caption</Text>
                  <TextInput
                    placeholder="Share the story behind these photos…"
                    placeholderTextColor={colors.faint}
                    value={caption}
                    onChangeText={setCaption}
                    multiline
                    style={[styles.input, styles.inputMulti]}
                  />
                  <Text style={styles.label}>Scripture (optional)</Text>
                  <ScriptureField value={scripture} onChange={setScripture} placeholder="e.g. Psalm 23:1" />
                </>
              ) : null}

              {mode === 'video' ? (
                <>
                  <Text style={styles.label}>Select video</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bleedContent} style={styles.bleed}>
                    <PressScale onPress={chooseVideo} scaleTo={0.94} style={[styles.mediaOption, styles.mediaOptionDevice, deviceVideo && videoUrl === deviceVideo.uri && styles.mediaOptionOn]} accessibilityLabel="Choose a video from this device">
                      <Icon name={deviceVideo ? 'check' : 'plus'} size={15} color={colors.primary} strokeWidth={2.4} />
                      <Text style={[styles.mediaOptionText, styles.mediaOptionTextOn]}>{deviceVideo ? 'Your video' : 'From device'}</Text>
                      {deviceVideo && deviceVideo.duration ? <Text style={styles.mediaOptionMeta}>{fmtSecs(deviceVideo.duration)}</Text> : null}
                    </PressScale>
                    {(ONLINE ? [] : SAMPLE_VIDEOS).map((v) => {
                      const on = videoUrl === v.url;
                      return (
                        <PressScale key={v.id} onPress={() => setVideoUrl(v.url)} scaleTo={0.94} style={[styles.mediaOption, on && styles.mediaOptionOn]} accessibilityState={{ selected: on }}>
                          <Icon name="video" size={15} color={on ? colors.primary : colors.muted} />
                          <Text style={[styles.mediaOptionText, on && styles.mediaOptionTextOn]}>{v.title}</Text>
                          <Text style={styles.mediaOptionMeta}>{v.duration}</Text>
                        </PressScale>
                      );
                    })}
                  </ScrollView>
                  <UploadVideoPreview videoUrl={videoUrl} />

                  <Text style={styles.label}>Caption & key message</Text>
                  <TextInput
                    placeholder="What is the Holy Spirit speaking through this video?"
                    placeholderTextColor={colors.faint}
                    value={caption}
                    onChangeText={setCaption}
                    multiline
                    style={[styles.input, styles.inputMulti]}
                  />
                  <Text style={styles.label}>Scripture (optional)</Text>
                  <ScriptureField value={scripture} onChange={setScripture} placeholder="e.g. Philippians 4:13" />
                  <Text style={styles.label}>Category</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bleedContent} style={styles.bleed}>
                    {VIDEO_CATEGORIES.map((c) => (
                      <PressScale key={c} onPress={() => setCategory(c)} scaleTo={0.93} style={[styles.chip, category === c && styles.chipActive]} accessibilityState={{ selected: category === c }}>
                        <Text style={[styles.chipText, category === c && styles.chipTextActive]}>{c}</Text>
                      </PressScale>
                    ))}
                  </ScrollView>
                </>
              ) : null}
            </FadeInUp>
          </ScrollView>

          {/* Pinned footer so the action is always reachable */}
          <View style={styles.footer}>
            <Text style={styles.footerHint} numberOfLines={1}>
              {linkDraft ? `Posting a ${linkDraft.card.label} video link` : canSubmit
                ? `Posting as ${userName}`
                : mode === 'text'
                ? 'Write something to share'
                : mode === 'photo'
                ? 'Pick at least one photo'
                : !videoUrl
                ? 'Choose a video from your device'
                : 'Add a caption for your video'}
            </Text>
            <Button
              label={submitLabel}
              icon={<Icon name="check" size={15} color={colors.primaryFg} strokeWidth={2.6} />}
              onPress={submit}
              disabled={!canSubmit}
            />
          </View>
        </View>
      </View>
    </AnimatedModal>
  );
}

const THUMB_GAP = 8;

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'transparent', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.screen, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 8, height: '90%', ...shadow.lg },
  pad: { paddingHorizontal: 18 },
  scroll: { paddingHorizontal: 18, paddingBottom: 28 },
  bleed: { marginHorizontal: -18, flexGrow: 0 },
  bleedContent: { gap: 8, paddingHorizontal: 18 },
  grabber: { alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  eyebrow: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase', color: colors.gold, marginBottom: 2 },
  title: { fontFamily: fonts.serifBold, fontSize: 24, lineHeight: 30, letterSpacing: -0.4, color: colors.fg },
  subtitle: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },

  modeRow: { flexDirection: 'row', gap: 4, backgroundColor: colors.raised, padding: 4, borderRadius: radius.md, marginBottom: 2 },
  modeIndicator: { position: 'absolute', top: 4, bottom: 4, left: 0, borderRadius: 10, backgroundColor: colors.surface, ...shadow.sm },
  modeTab: { flex: 1, flexDirection: 'row', justifyContent: 'center', paddingVertical: 10, alignItems: 'center', gap: 7, borderRadius: 10 },
  modeTabActive: { backgroundColor: colors.surface, ...shadow.sm },
  modeText: { fontSize: 13, fontWeight: '500', color: colors.muted },
  modeTextActive: { fontWeight: '700', color: colors.fg },

  label: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: colors.muted, marginTop: 18, marginBottom: 8 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 8 },
  labelMeta: { fontSize: 12, color: colors.faint, fontWeight: '600' },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14.5, color: colors.fg },
  inputMulti: { minHeight: 76, textAlignVertical: 'top', lineHeight: 20 },
  refHint: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 7, paddingHorizontal: 2 },
  refHintText: { fontSize: 12, fontWeight: '600' },

  chip: { paddingHorizontal: 14, height: 34, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.fg, borderColor: colors.fg },
  chipText: { fontSize: 12.5, fontWeight: '500', color: colors.muted },
  chipTextActive: { color: WHITE, fontWeight: '600' },

  // Text post: image-card design controls
  segment: { flexDirection: 'row', gap: 4, backgroundColor: colors.raised, borderRadius: radius.pill, padding: 4 },
  segBtn: { flex: 1, flexDirection: 'row', gap: 7, height: 38, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  segOn: { backgroundColor: colors.surface, ...shadow.sm },
  segText: { fontSize: 13, fontWeight: '500', color: colors.muted },
  segTextOn: { color: colors.fg, fontWeight: '700' },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 8, padding: 10, borderRadius: radius.md, backgroundColor: alpha ? alpha(colors.gold, 0.1) : colors.raised },
  noticeText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: colors.fg },
  cardPreviewWrap: { marginTop: 14, width: '100%', maxWidth: 420, alignSelf: 'center', borderRadius: radius.md, ...shadow.md },
  cardPreview: {},

  photoPreviewWrap: { marginTop: 14 },
  gridPreview: { borderRadius: radius.lg, overflow: 'hidden', position: 'relative' },
  photoEmpty: { height: 270, borderRadius: radius.lg, backgroundColor: colors.night, alignItems: 'center', justifyContent: 'center', gap: 8 },
  photoEmptyText: { fontSize: 12.5, color: colors.nightMuted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: THUMB_GAP },
  thumb: { width: '31.6%', aspectRatio: 1, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.raised, borderWidth: 2, borderColor: 'transparent' },
  thumbOn: { borderColor: colors.primary },
  thumbImg: { width: '100%', height: '100%' },
  thumbAdd: { alignItems: 'center', justifyContent: 'center', gap: 6, borderColor: colors.borderStrong, borderStyle: 'dashed', backgroundColor: colors.surface },
  thumbAddText: { fontSize: 11.5, fontWeight: '600', color: colors.primary },
  thumbBadge: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, borderWidth: 2, borderColor: WHITE, alignItems: 'center', justifyContent: 'center' },
  thumbBadgeText: { color: WHITE, fontSize: 11, fontWeight: '800' },
  thumbRing: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: WHITE, backgroundColor: 'rgba(0,0,0,0.18)' },

  mediaOption: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 13, height: 38, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  mediaOptionOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  mediaOptionDevice: { borderStyle: 'dashed', borderColor: colors.borderStrong },
  mediaOptionText: { fontSize: 12.5, fontWeight: '500', color: colors.muted },
  mediaOptionTextOn: { color: colors.primary, fontWeight: '700' },
  mediaOptionMeta: { fontSize: 11, color: colors.faint },
  videoPreview: { height: 190, borderRadius: radius.lg, overflow: 'hidden', marginTop: 12, backgroundColor: colors.night },
  videoPreviewPlaceholder: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  videoPreviewPlaceholderText: { color: colors.nightMuted, fontSize: 12, marginTop: 8 },
  previewBadge: { position: 'absolute', top: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(21,23,43,0.72)', paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill },
  previewDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.goldLight },
  previewBadgeText: { color: colors.goldLight, fontSize: 9, fontWeight: '700', letterSpacing: 1 },

  footer: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 18, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.screen },
  footerHint: { flex: 1, fontSize: 12.5, color: colors.muted },
});
