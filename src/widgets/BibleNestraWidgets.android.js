// WIDGETS (Android only): the four BibleNestra home-screen widgets, rendered from JSX by
// react-native-android-widget into RemoteViews. Dark background with photo imagery, gold accents, white
// serif text; every tap deep-links into the app (biblenestra://…, handled by src/notifications/deepLinks.js).
//   DailyScripture      small  (2×2)  verse + gold reference + "Read More →"          → Daily Bread
//   PrayerOfTheDay      medium (4×2)  🙏 Today's Prayer + one-line prayer + photo      → Prayer Wall
//   ReadingProgress     medium (4×2)  📖 My Bible Journey · Day x of y · gold bar      → today's chapter
//   SpiritualCompanion  large  (4×4)  ✨ 4 gold-outlined tiles: Read Bible · Pray · Listen · Community
import React from 'react';
import { FlexWidget, ImageWidget, OverlapWidget, SvgWidget, TextWidget } from 'react-native-android-widget';
import { DEEP } from './widgetData';
import { imageFor } from '../notifications/imagery';

const GOLD = '#D4A852';
const WHITE = '#F7F2E8';
const GREY = '#F7F2E8A0';
const BG = '#0E0C0B';
const SERIF = 'Newsreader_500Medium'; // bundled into android/app/src/main/assets/fonts by the config plugin
const SERIF_ITALIC = 'Newsreader_500Medium_Italic';
const R = 22;

const open = (uri) => ({ clickAction: 'OPEN_URI', clickActionData: { uri } });

const svg = (paths) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${GOLD}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const ICONS = {
  book: svg('<path d="M12 6.5C10.3 5.2 7.9 4.6 4 4.6v13.6c3.9 0 6.3.6 8 1.9 1.7-1.3 4.1-1.9 8-1.9V4.6c-3.9 0-6.3.6-8 1.9z"/><path d="M12 6.5v13.6"/>'),
  pray: svg('<path d="M12 3c1.6 1.8 2.4 3.2 2.4 4.4a2.4 2.4 0 0 1-4.8 0C9.6 6.2 10.4 4.8 12 3z"/><rect x="8.5" y="12" width="7" height="8.5" rx="1.6"/><path d="M12 10v2M6 20.5h12"/>'),
  listen: svg('<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3.5" y="13.5" width="4.5" height="7" rx="1.8"/><rect x="16" y="13.5" width="4.5" height="7" rx="1.8"/>'),
  community: svg('<circle cx="9" cy="8.2" r="3.6"/><path d="M2.8 19.5c.9-3.1 3.3-4.8 6.2-4.8s5.3 1.7 6.2 4.8"/><path d="M15.5 4.9a3.6 3.6 0 0 1 0 6.6M17.8 14.9c1.7.7 2.9 2.2 3.4 4.6"/>'),
};

function Photo({ uri, width, height }) {
  return <ImageWidget image={uri} imageWidth={width} imageHeight={height} radius={R} />;
}

function GoldPill({ label, uri }) {
  return (
    <FlexWidget {...open(uri)} style={{ backgroundColor: GOLD, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 }}>
      <TextWidget text={label} style={{ fontSize: 12, color: '#15120E', fontWeight: '700' }} />
    </FlexWidget>
  );
}

const frame = { height: 'match_parent', width: 'match_parent', borderRadius: R, borderWidth: 1, borderColor: '#D4A85266' };

export function DailyScriptureWidget({ verse, width = 160, height = 160 }) {
  return (
    <OverlapWidget {...open(DEEP.daily)} style={{ height: 'match_parent', width: 'match_parent', backgroundColor: BG, borderRadius: R }}>
      <Photo uri={verse.image} width={width} height={height} />
      <FlexWidget
        {...open(DEEP.daily)}
        style={{ ...frame, padding: 12, flexDirection: 'column', justifyContent: 'space-between', backgroundGradient: { from: '#0E0C0BF2', to: '#0E0C0B40', orientation: 'BOTTOM_TOP' } }}
      >
        <TextWidget text="📖  DAILY SCRIPTURE" style={{ fontSize: 10, color: GOLD, fontWeight: '700', letterSpacing: 0.08 }} />
        <FlexWidget style={{ flexDirection: 'column', width: 'match_parent' }}>
          <TextWidget text={`“${verse.text}”`} maxLines={height < 150 ? 3 : 5} truncate="END" style={{ fontSize: 14, color: WHITE, fontFamily: SERIF_ITALIC }} />
          <TextWidget text={verse.reference} maxLines={1} style={{ fontSize: 11.5, color: GOLD, fontWeight: '700', marginTop: 4 }} />
        </FlexWidget>
        <GoldPill label="Read More →" uri={DEEP.daily} />
      </FlexWidget>
    </OverlapWidget>
  );
}

export function PrayerOfTheDayWidget({ prayer, width = 320, height = 150 }) {
  const photoW = Math.round(width * 0.42);
  return (
    <OverlapWidget {...open(DEEP.prayer)} style={{ height: 'match_parent', width: 'match_parent', backgroundColor: BG, borderRadius: R }}>
      <FlexWidget style={{ height: 'match_parent', width: 'match_parent', flexDirection: 'row', justifyContent: 'flex-end' }}>
        <ImageWidget image={prayer.image} imageWidth={photoW} imageHeight={height} radius={R} />
      </FlexWidget>
      <FlexWidget
        {...open(DEEP.prayer)}
        style={{ ...frame, padding: 14, flexDirection: 'column', justifyContent: 'space-between', backgroundGradient: { from: '#0E0C0BFF', to: '#0E0C0B1A', orientation: 'LEFT_RIGHT' } }}
      >
        <TextWidget text="🙏  Today’s Prayer" style={{ fontSize: 12.5, color: GOLD, fontWeight: '700' }} />
        <TextWidget text={prayer.text} maxLines={3} truncate="END" style={{ fontSize: 15, color: WHITE, fontFamily: SERIF, marginRight: photoW * 0.55 }} />
        <GoldPill label="Pray Now →" uri={DEEP.prayer} />
      </FlexWidget>
    </OverlapWidget>
  );
}

export function ReadingProgressWidget({ progress, width = 320 }) {
  const barW = Math.max(60, width - 28);
  const fill = Math.max(progress.pct > 0 ? 6 : 0, Math.round(barW * progress.pct));
  return (
    <OverlapWidget {...open(progress.uri)} style={{ height: 'match_parent', width: 'match_parent', backgroundColor: BG, borderRadius: R }}>
      <FlexWidget
        {...open(progress.uri)}
        style={{ ...frame, padding: 14, flexDirection: 'column', justifyContent: 'space-between', backgroundGradient: { from: '#1A1712', to: BG, orientation: 'TL_BR' } }}
      >
        <TextWidget text="📖  My Bible Journey" style={{ fontSize: 12.5, color: GOLD, fontWeight: '700' }} />
        <FlexWidget style={{ flexDirection: 'column', width: 'match_parent' }}>
          <TextWidget text={progress.empty ? 'Begin your journey' : `Day ${progress.day} of ${progress.days}`} style={{ fontSize: 20, color: WHITE, fontFamily: SERIF }} />
          <TextWidget text={progress.name} maxLines={1} truncate="END" style={{ fontSize: 11.5, color: GREY, marginTop: 1 }} />
        </FlexWidget>
        <FlexWidget style={{ flexDirection: 'column', width: 'match_parent' }}>
          <FlexWidget style={{ width: barW, height: 6, borderRadius: 3, backgroundColor: '#F7F2E826', flexDirection: 'row' }}>
            {fill > 0 ? <FlexWidget style={{ width: fill, height: 6, borderRadius: 3, backgroundColor: GOLD }} /> : <FlexWidget style={{ width: 1, height: 6 }} />}
          </FlexWidget>
          <FlexWidget style={{ flexDirection: 'row', justifyContent: 'space-between', width: 'match_parent', marginTop: 6 }}>
            <TextWidget text={progress.empty ? 'Pick a plan in Learn' : `${progress.done} of ${progress.days} days completed`} style={{ fontSize: 11, color: GREY }} />
            <TextWidget {...open(progress.uri)} text="Continue Reading →" style={{ fontSize: 12, color: GOLD, fontWeight: '700' }} />
          </FlexWidget>
        </FlexWidget>
      </FlexWidget>
    </OverlapWidget>
  );
}

function Tile({ label, icon, uri, size }) {
  return (
    <FlexWidget
      {...open(uri)}
      style={{ flex: 1, height: 'match_parent', marginHorizontal: 4, borderRadius: 16, borderWidth: 1, borderColor: GOLD, backgroundColor: '#0E0C0BB3', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
    >
      <SvgWidget svg={ICONS[icon]} style={{ width: size, height: size }} />
      <TextWidget text={label} style={{ fontSize: 12.5, color: WHITE, fontFamily: SERIF, marginTop: 6 }} />
    </FlexWidget>
  );
}

export function SpiritualCompanionWidget({ verse, width = 320, height = 320 }) {
  const icon = Math.max(22, Math.min(34, Math.round(width / 11)));
  return (
    <OverlapWidget {...open(DEEP.companion)} style={{ height: 'match_parent', width: 'match_parent', backgroundColor: BG, borderRadius: R }}>
      <Photo uri={imageFor('companion', 800)} width={width} height={height} />
      <FlexWidget style={{ ...frame, padding: 12, flexDirection: 'column', backgroundGradient: { from: '#0E0C0BE6', to: '#0E0C0B8C', orientation: 'BOTTOM_TOP' } }}>
        <FlexWidget {...open(DEEP.companion)} style={{ flexDirection: 'column', width: 'match_parent', paddingHorizontal: 4 }}>
          <TextWidget text="✨  Your Spiritual Companion" style={{ fontSize: 14, color: GOLD, fontWeight: '700' }} />
          <TextWidget text={`“${verse.text}”`} maxLines={2} truncate="END" style={{ fontSize: 13, color: WHITE, fontFamily: SERIF_ITALIC, marginTop: 6 }} />
          <TextWidget text={verse.reference} maxLines={1} style={{ fontSize: 11, color: GOLD, marginTop: 2 }} />
        </FlexWidget>
        <FlexWidget style={{ flex: 1, flexDirection: 'row', width: 'match_parent', marginTop: 10 }}>
          <Tile label="Read Bible" icon="book" uri={DEEP.bible} size={icon} />
          <Tile label="Pray" icon="pray" uri={DEEP.prayer} size={icon} />
        </FlexWidget>
        <FlexWidget style={{ flex: 1, flexDirection: 'row', width: 'match_parent', marginTop: 8 }}>
          <Tile label="Listen" icon="listen" uri={DEEP.listen} size={icon} />
          <Tile label="Community" icon="community" uri={DEEP.community} size={icon} />
        </FlexWidget>
      </FlexWidget>
    </OverlapWidget>
  );
}

export const WIDGET_NAMES = ['DailyScripture', 'PrayerOfTheDay', 'ReadingProgress', 'SpiritualCompanion'];

/** The JSX for one widget instance (`info` from the widget task: { widgetName, width, height }). */
export function renderBibleNestraWidget(info, data) {
  const width = Math.round(info.width || 0) || undefined;
  const height = Math.round(info.height || 0) || undefined;
  switch (info.widgetName) {
    case 'DailyScripture': return <DailyScriptureWidget verse={data.verse} width={width} height={height} />;
    case 'PrayerOfTheDay': return <PrayerOfTheDayWidget prayer={data.prayer} width={width} height={height} />;
    case 'ReadingProgress': return <ReadingProgressWidget progress={data.progress} width={width} height={height} />;
    case 'SpiritualCompanion': return <SpiritualCompanionWidget verse={data.verse} width={width} height={height} />;
    default: return <DailyScriptureWidget verse={data.verse} width={width} height={height} />;
  }
}
