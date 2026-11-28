import React from 'react';
import Svg, { Path, Circle, Rect } from 'react-native-svg';

/*
 * BibleNestra icon set — 24px grid, round caps/joins, single stroke weight.
 * <Icon name="book" size={20} color={colors.fg} strokeWidth={1.9} fill="none" />
 * Pass fill="solid" (or any colour) to get the filled variant where one exists.
 */

const ALIASES = {
  bible: 'book',
  discover: 'compass',
  socials: 'video',
  message: 'chat',
  profile: 'user',
  community: 'users',
  jobs: 'briefcase',
  signal: 'live',
  devotional: 'sun',
  audio: 'headphones',
  swap: 'repost',
  close: 'x',
  add: 'plus',
  'more-horizontal': 'more',
};

// Each entry: (c, sw, filled) => array of SVG children
const GLYPHS = {
  book: (c, sw, f) => [
    <Path key="a" d="M12 6.5C10.3 5.2 7.9 4.6 4 4.6v13.6c3.9 0 6.3.6 8 1.9 1.7-1.3 4.1-1.9 8-1.9V4.6c-3.9 0-6.3.6-8 1.9z" stroke={c} strokeWidth={sw} strokeLinejoin="round" fill={f ? c : 'none'} fillOpacity={f ? 0.16 : 0} />,
    <Path key="b" d="M12 6.5v13.6" stroke={c} strokeWidth={sw} strokeLinecap="round" />,
  ],
  compass: (c, sw, f) => [
    <Circle key="a" cx={12} cy={12} r={9} stroke={c} strokeWidth={sw} />,
    <Path key="b" d="M15.6 8.4l-2 5.2-5.2 2 2-5.2 5.2-2z" stroke={c} strokeWidth={sw} strokeLinejoin="round" fill={f ? c : 'none'} />,
  ],
  video: (c, sw, f) => [
    <Rect key="a" x={3} y={4} width={18} height={16} rx={4.5} stroke={c} strokeWidth={sw} fill={f ? c : 'none'} fillOpacity={f ? 0.16 : 0} />,
    <Path key="b" d="M10 9.2v5.6l4.8-2.8L10 9.2z" fill={c} stroke={c} strokeWidth={1.2} strokeLinejoin="round" />,
  ],
  play: (c, sw, f) => [<Path key="a" d="M7.5 5.2v13.6c0 .8.9 1.3 1.5.8l10-6.8c.6-.4.6-1.2 0-1.6L9 4.4c-.6-.5-1.5 0-1.5.8z" stroke={c} strokeWidth={sw} strokeLinejoin="round" fill={f ? c : 'none'} />],
  eye: (c, sw) => [<Path key="a" d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" stroke={c} strokeWidth={sw} strokeLinejoin="round" />, <Path key="b" d="M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5z" stroke={c} strokeWidth={sw} />],
  pause: (c, sw) => [
    <Rect key="a" x={6.5} y={5} width={3.5} height={14} rx={1.2} fill={c} />,
    <Rect key="b" x={14} y={5} width={3.5} height={14} rx={1.2} fill={c} />,
  ],
  chat: (c, sw, f) => [<Path key="a" d="M20 11.6c0 4.2-3.6 7.4-8 7.4-1.2 0-2.3-.2-3.3-.6L4 19.8l1.2-3.7C4.4 14.8 4 13.3 4 11.6 4 7.4 7.6 4.2 12 4.2s8 3.2 8 7.4z" stroke={c} strokeWidth={sw} strokeLinejoin="round" fill={f ? c : 'none'} fillOpacity={f ? 0.16 : 0} />],
  user: (c, sw, f) => [
    <Circle key="a" cx={12} cy={8} r={4} stroke={c} strokeWidth={sw} fill={f ? c : 'none'} fillOpacity={f ? 0.16 : 0} />,
    <Path key="b" d="M4.5 20c1.2-3.5 4-5.3 7.5-5.3s6.3 1.8 7.5 5.3" stroke={c} strokeWidth={sw} strokeLinecap="round" />,
  ],
  users: (c, sw) => [
    <Circle key="a" cx={9} cy={8.2} r={3.6} stroke={c} strokeWidth={sw} />,
    <Path key="b" d="M2.8 19.5c.9-3.1 3.3-4.8 6.2-4.8s5.3 1.7 6.2 4.8" stroke={c} strokeWidth={sw} strokeLinecap="round" />,
    <Path key="c" d="M15.5 4.9a3.6 3.6 0 0 1 0 6.6M17.8 14.9c1.7.7 2.9 2.2 3.4 4.6" stroke={c} strokeWidth={sw} strokeLinecap="round" />,
  ],
  heart: (c, sw, f) => [<Path key="a" d="M12 20s-7.5-4.5-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.5 12 20 12 20z" stroke={c} strokeWidth={sw} strokeLinejoin="round" fill={f ? c : 'none'} />],
  share: (c, sw) => [
    <Path key="a" d="M12 15V3.8M7.5 8 12 3.5 16.5 8" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />,
    <Path key="b" d="M8 11.5H6.5A1.5 1.5 0 0 0 5 13v6a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6a1.5 1.5 0 0 0-1.5-1.5H16" stroke={c} strokeWidth={sw} strokeLinecap="round" />,
  ],
  gift: (c, sw, f) => [
    <Rect key="a" x={3.5} y={8.5} width={17} height={4} rx={1.2} stroke={c} strokeWidth={sw} fill={f ? c : 'none'} fillOpacity={f ? 0.16 : 0} />,
    <Path key="b" d="M5 12.5v6.2A1.3 1.3 0 0 0 6.3 20h11.4a1.3 1.3 0 0 0 1.3-1.3v-6.2M12 8.5V20" stroke={c} strokeWidth={sw} strokeLinecap="round" />,
    <Path key="c" d="M12 8.5S10.8 4 8.4 4a2.1 2.1 0 0 0 0 4.2M12 8.5S13.2 4 15.6 4a2.1 2.1 0 0 1 0 4.2" stroke={c} strokeWidth={sw} strokeLinecap="round" />,
  ],
  repost: (c, sw) => [
    <Path key="a" d="M17 3.5 20 6.5l-3 3" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />,
    <Path key="b" d="M4 11.5V10a3.5 3.5 0 0 1 3.5-3.5H20" stroke={c} strokeWidth={sw} strokeLinecap="round" />,
    <Path key="c" d="M7 20.5 4 17.5l3-3" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />,
    <Path key="d" d="M20 12.5V14a3.5 3.5 0 0 1-3.5 3.5H4" stroke={c} strokeWidth={sw} strokeLinecap="round" />,
  ],
  coin: (c, sw, f) => [
    <Circle key="a" cx={12} cy={12} r={8.5} stroke={c} strokeWidth={sw} fill={f ? c : 'none'} fillOpacity={f ? 0.16 : 0} />,
    <Path key="b" d="M12 7.8v8.4M9.6 10h4.8" stroke={c} strokeWidth={sw} strokeLinecap="round" />,
  ],
  church: (c, sw, f) => [
    <Path key="a" d="M12 2.8v3.6M10.4 4.4h3.2" stroke={c} strokeWidth={sw} strokeLinecap="round" />,
    <Path key="b" d="M6 20.5V11l6-4.6 6 4.6v9.5z" stroke={c} strokeWidth={sw} strokeLinejoin="round" fill={f ? c : 'none'} fillOpacity={f ? 0.16 : 0} />,
    <Path key="c" d="M10 20.5v-4a2 2 0 0 1 4 0v4M3.5 20.5h17" stroke={c} strokeWidth={sw} strokeLinecap="round" />,
  ],
  prayer: (c, sw, f) => [
    // candle flame
    <Path key="a" d="M12 3c1.6 1.8 2.4 3.2 2.4 4.4a2.4 2.4 0 0 1-4.8 0C9.6 6.2 10.4 4.8 12 3z" stroke={c} strokeWidth={sw} strokeLinejoin="round" fill={f ? c : 'none'} />,
    <Rect key="b" x={8.5} y={12} width={7} height={8.5} rx={1.6} stroke={c} strokeWidth={sw} />,
    <Path key="c" d="M12 10v2M6 20.5h12" stroke={c} strokeWidth={sw} strokeLinecap="round" />,
  ],
  flame: (c, sw, f) => [
    <Path key="a" d="M12 21.5c3.9 0 6.8-2.8 6.8-6.6 0-3.6-2.5-6-4.2-8.3-.3 1.9-1.3 3.2-2.5 3.4.5-2.9-.4-5.8-2.8-7.9-.3 3.5-2.1 5.6-3.5 7.4-1.2 1.6-1.6 3.3-1.6 5.4 0 3.8 3 6.6 7.8 6.6z" stroke={c} strokeWidth={sw} strokeLinejoin="round" fill={f ? c : 'none'} />,
    <Path key="b" d="M12 19.2c-1.5 0-2.6-1-2.6-2.4 0-1.3.9-2.2 1.7-3.1.3.9.8 1.4 1.5 1.5-.1-1.1.3-2.1 1.1-2.9.4 1.5 1.3 2.3 1.3 3.8 0 1.7-1.3 3.1-3 3.1z" fill={f ? '#FFFFFF' : 'none'} fillOpacity={0.55} stroke={f ? 'none' : c} strokeWidth={sw * 0.8} strokeLinejoin="round" />,
  ],
  sparkles: (c, sw, f) => [
    <Path key="a" d="M10.5 3.5l1.6 4.6 4.6 1.6-4.6 1.6-1.6 4.6-1.6-4.6-4.6-1.6 4.6-1.6 1.6-4.6z" stroke={c} strokeWidth={sw} strokeLinejoin="round" fill={f ? c : 'none'} />,
    <Path key="b" d="M18 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" fill={c} />,
  ],
  star: (c, sw, f) => [<Path key="a" d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7L12 16.6l-5.1 2.7 1-5.7-4.1-4 5.7-.8L12 3.6z" stroke={c} strokeWidth={sw} strokeLinejoin="round" fill={f ? c : 'none'} />],
  bookmark: (c, sw, f) => [<Path key="a" d="M6.5 4.5A1.5 1.5 0 0 1 8 3h8a1.5 1.5 0 0 1 1.5 1.5V21L12 17.2 6.5 21V4.5z" stroke={c} strokeWidth={sw} strokeLinejoin="round" fill={f ? c : 'none'} />],
  highlight: (c, sw) => [
    <Path key="a" d="M14.5 4.5l5 5L9 20H4v-5L14.5 4.5z" stroke={c} strokeWidth={sw} strokeLinejoin="round" />,
    <Path key="b" d="M12.5 6.5l5 5" stroke={c} strokeWidth={sw} />,
  ],
  edit: (c, sw) => [
    <Path key="a" d="M15.5 4.5l4 4L8.5 19.5H4.5v-4L15.5 4.5z" stroke={c} strokeWidth={sw} strokeLinejoin="round" />,
  ],
  mic: (c, sw, f) => [
    <Rect key="a" x={9} y={3} width={6} height={11} rx={3} stroke={c} strokeWidth={sw} fill={f ? c : 'none'} />,
    <Path key="b" d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" stroke={c} strokeWidth={sw} strokeLinecap="round" />,
  ],
  headphones: (c, sw) => [
    <Path key="a" d="M4 15v-3a8 8 0 0 1 16 0v3" stroke={c} strokeWidth={sw} strokeLinecap="round" />,
    <Rect key="b" x={3.5} y={13.5} width={4.5} height={7} rx={1.8} stroke={c} strokeWidth={sw} />,
    <Rect key="c" x={16} y={13.5} width={4.5} height={7} rx={1.8} stroke={c} strokeWidth={sw} />,
  ],
  volume: (c, sw) => [
    <Path key="a" d="M4 9.5h3l4.5-4v13l-4.5-4H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z" stroke={c} strokeWidth={sw} strokeLinejoin="round" />,
    <Path key="b" d="M15.5 9a4 4 0 0 1 0 6M18.2 6.5a7.5 7.5 0 0 1 0 11" stroke={c} strokeWidth={sw} strokeLinecap="round" />,
  ],
  search: (c, sw) => [
    <Circle key="a" cx={11} cy={11} r={6.5} stroke={c} strokeWidth={sw} />,
    <Path key="b" d="M16 16l4 4" stroke={c} strokeWidth={sw} strokeLinecap="round" />,
  ],
  download: (c, sw) => [
    <Path key="a" d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />,
    <Path key="b" d="M5 19.5h14" stroke={c} strokeWidth={sw} strokeLinecap="round" />,
  ],
  check: (c, sw) => [<Path key="a" d="M5 12.5l4.5 4.5L19 7.5" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />],
  'check-circle': (c, sw, f) => [
    <Circle key="a" cx={12} cy={12} r={9} stroke={c} strokeWidth={sw} fill={f ? c : 'none'} fillOpacity={f ? 0.16 : 0} />,
    <Path key="b" d="M8 12.3l2.7 2.7L16 9.6" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />,
  ],
  calendar: (c, sw) => [
    <Rect key="a" x={3.5} y={5} width={17} height={15.5} rx={3} stroke={c} strokeWidth={sw} />,
    <Path key="b" d="M3.5 10h17M8 3v4M16 3v4" stroke={c} strokeWidth={sw} strokeLinecap="round" />,
  ],
  'chevron-down': (c, sw) => [<Path key="a" d="M6 9l6 6 6-6" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />],
  'chevron-up': (c, sw) => [<Path key="a" d="M6 15l6-6 6 6" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />],
  'chevron-right': (c, sw) => [<Path key="a" d="M9 6l6 6-6 6" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />],
  'chevron-left': (c, sw) => [<Path key="a" d="M15 6l-6 6 6 6" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />],
  'arrow-right': (c, sw) => [<Path key="a" d="M4.5 12h15M13.5 6l6 6-6 6" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />],
  'arrow-up-right': (c, sw) => [<Path key="a" d="M7 17L17 7M8.5 7H17v8.5" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />],
  cross: (c, sw) => [<Path key="a" d="M12 3v18M6.5 8.5h11" stroke={c} strokeWidth={sw} strokeLinecap="round" />],
  briefcase: (c, sw, f) => [
    <Rect key="a" x={3} y={7} width={18} height={13} rx={2.8} stroke={c} strokeWidth={sw} fill={f ? c : 'none'} fillOpacity={f ? 0.16 : 0} />,
    <Path key="b" d="M8.5 7V5.5A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.5 1.5V7M3 12.5h18" stroke={c} strokeWidth={sw} strokeLinecap="round" />,
  ],
  live: (c, sw) => [
    <Circle key="a" cx={12} cy={12} r={2.2} fill={c} />,
    <Path key="b" d="M8.2 15.8a5.4 5.4 0 0 1 0-7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.3 18.7a9.5 9.5 0 0 1 0-13.4M18.7 5.3a9.5 9.5 0 0 1 0 13.4" stroke={c} strokeWidth={sw} strokeLinecap="round" />,
  ],
  shield: (c, sw, f) => [<Path key="a" d="M12 3.2 19 6v5.4c0 4.4-3 8-7 9.4-4-1.4-7-5-7-9.4V6l7-2.8z" stroke={c} strokeWidth={sw} strokeLinejoin="round" fill={f ? c : 'none'} fillOpacity={f ? 0.16 : 0} />],
  quiz: (c, sw) => [
    <Circle key="a" cx={12} cy={12} r={9} stroke={c} strokeWidth={sw} />,
    <Path key="b" d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.7" stroke={c} strokeWidth={sw} strokeLinecap="round" />,
    <Circle key="c" cx={12} cy={17} r={1.1} fill={c} />,
  ],
  sun: (c, sw) => [
    <Circle key="a" cx={12} cy={12} r={4} stroke={c} strokeWidth={sw} />,
    <Path key="b" d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" stroke={c} strokeWidth={sw} strokeLinecap="round" />,
  ],
  moon: (c, sw, f) => [<Path key="a" d="M19.5 14.2A7.8 7.8 0 0 1 9.8 4.5a7.8 7.8 0 1 0 9.7 9.7z" stroke={c} strokeWidth={sw} strokeLinejoin="round" fill={f ? c : 'none'} />],
  type: (c, sw) => [
    <Path key="a" d="M3 18.5 7.5 6.5l4.5 12M4.6 14.5h5.8" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />,
    <Path key="b" d="M17.5 11a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM20.5 10.5v8" stroke={c} strokeWidth={sw} strokeLinecap="round" />,
  ],
  plus: (c, sw) => [<Path key="a" d="M12 5v14M5 12h14" stroke={c} strokeWidth={sw} strokeLinecap="round" />],
  x: (c, sw) => [<Path key="a" d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke={c} strokeWidth={sw} strokeLinecap="round" />],
  more: (c) => [
    <Circle key="a" cx={5.5} cy={12} r={1.6} fill={c} />,
    <Circle key="b" cx={12} cy={12} r={1.6} fill={c} />,
    <Circle key="c" cx={18.5} cy={12} r={1.6} fill={c} />,
  ],
  bell: (c, sw, f) => [
    <Path key="a" d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15l1.5-2z" stroke={c} strokeWidth={sw} strokeLinejoin="round" fill={f ? c : 'none'} fillOpacity={f ? 0.16 : 0} />,
    <Path key="b" d="M10 21h4" stroke={c} strokeWidth={sw} strokeLinecap="round" />,
  ],
  settings: (c, sw) => [
    <Path key="a" d="M4 7h10M18 7h2M4 17h2M10 17h10" stroke={c} strokeWidth={sw} strokeLinecap="round" />,
    <Circle key="b" cx={16} cy={7} r={2.2} stroke={c} strokeWidth={sw} />,
    <Circle key="c" cx={8} cy={17} r={2.2} stroke={c} strokeWidth={sw} />,
  ],
  home: (c, sw, f) => [<Path key="a" d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-5.5H9v5.5H5.5A1.5 1.5 0 0 1 4 19v-8.5z" stroke={c} strokeWidth={sw} strokeLinejoin="round" fill={f ? c : 'none'} fillOpacity={f ? 0.16 : 0} />],
  globe: (c, sw) => [
    <Circle key="a" cx={12} cy={12} r={9} stroke={c} strokeWidth={sw} />,
    <Path key="b" d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9S14.5 18.4 12 21c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z" stroke={c} strokeWidth={sw} strokeLinejoin="round" />,
  ],
  lock: (c, sw) => [
    <Rect key="a" x={5} y={10.5} width={14} height={10} rx={2.5} stroke={c} strokeWidth={sw} />,
    <Path key="b" d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" stroke={c} strokeWidth={sw} strokeLinecap="round" />,
  ],
  trash: (c, sw) => [<Path key="a" d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12a1.6 1.6 0 0 0 1.6 1.5h6.2a1.6 1.6 0 0 0 1.6-1.5l.8-12" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />],
  image: (c, sw) => [
    <Rect key="a" x={3.5} y={4.5} width={17} height={15} rx={3} stroke={c} strokeWidth={sw} />,
    <Circle key="b" cx={9} cy={9.5} r={1.7} stroke={c} strokeWidth={sw} />,
    <Path key="c" d="M4 17l4.5-4.2 3.5 3 3-2.6 5 4.3" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />,
  ],
  music: (c, sw) => [
    <Path key="a" d="M9 18V5.5l11-2V16" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />,
    <Circle key="b" cx={6.5} cy={18} r={2.5} stroke={c} strokeWidth={sw} />,
    <Circle key="c" cx={17.5} cy={16} r={2.5} stroke={c} strokeWidth={sw} />,
  ],
  filter: (c, sw) => [<Path key="a" d="M4 6h16M7 12h10M10.5 18h3" stroke={c} strokeWidth={sw} strokeLinecap="round" />],
  clock: (c, sw) => [
    <Circle key="a" cx={12} cy={12} r={9} stroke={c} strokeWidth={sw} />,
    <Path key="b" d="M12 7.5V12l3 2" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />,
  ],
  'map-pin': (c, sw) => [
    <Path key="a" d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" stroke={c} strokeWidth={sw} strokeLinejoin="round" />,
    <Circle key="b" cx={12} cy={10} r={2.3} stroke={c} strokeWidth={sw} />,
  ],
  link: (c, sw) => [
    <Path key="a" d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" stroke={c} strokeWidth={sw} strokeLinecap="round" />,
  ],
  quote: (c) => [<Path key="a" d="M5 17.5c0-4.5 1.5-8 5-10l.8 1.3c-1.9 1.4-2.8 3-2.9 4.7H10v4H5zm9 0c0-4.5 1.5-8 5-10l.8 1.3c-1.9 1.4-2.8 3-2.9 4.7H19v4h-5z" fill={c} />],
};

export const ICON_NAMES = Object.keys(GLYPHS).concat(Object.keys(ALIASES));

export function Icon({ name, size = 20, color = '#1C1915', strokeWidth = 1.9, fill = 'none' }) {
  const key = ALIASES[name] || name;
  const draw = GLYPHS[key];
  const filled = fill && fill !== 'none';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {draw ? draw(color, strokeWidth, filled) : <Circle cx={12} cy={12} r={3} fill={color} />}
    </Svg>
  );
}

export default Icon;
