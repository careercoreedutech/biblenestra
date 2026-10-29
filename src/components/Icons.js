import React from 'react';
import Svg, { Path, Circle, Rect, G } from 'react-native-svg';

export function Icon({ name, size = 20, color = '#0F172A', strokeWidth = 2, fill = 'none' }) {
  switch (name) {
    case 'book':
    case 'bible':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill}>
          <Path
            d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v15H6.5a2.5 2.5 0 0 0-2.5 2.5z"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      );

    case 'compass':
    case 'discover':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill}>
          <Circle cx="12" cy="12" r="10" stroke={color} strokeWidth={strokeWidth} />
          <Path
            d="M16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill={fill === 'none' ? 'none' : color}
          />
        </Svg>
      );

    case 'video':
    case 'socials':
    case 'play':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill}>
          <Rect x="2" y="2" width="20" height="20" rx="5" stroke={color} strokeWidth={strokeWidth} />
          <Path d="M10 8l6 4-6 4V8z" fill={color} />
        </Svg>
      );

    case 'chat':
    case 'message':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill}>
          <Path
            d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      );

    case 'user':
    case 'profile':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill}>
          <Path
            d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Circle cx="12" cy="7" r="4" stroke={color} strokeWidth={strokeWidth} />
        </Svg>
      );

    case 'heart':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill}>
          <Path
            d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      );

    case 'share':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill}>
          <Circle cx="18" cy="5" r="3" stroke={color} strokeWidth={strokeWidth} />
          <Circle cx="6" cy="12" r="3" stroke={color} strokeWidth={strokeWidth} />
          <Circle cx="18" cy="19" r="3" stroke={color} strokeWidth={strokeWidth} />
          <Path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98" stroke={color} strokeWidth={strokeWidth} />
        </Svg>
      );

    case 'gift':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill}>
          <Path d="M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zm0 0h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );

    case 'repost':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill}>
          <Path d="M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );

    case 'coin':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill}>
          <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={strokeWidth} />
          <Circle cx="12" cy="12" r="6" stroke={color} strokeWidth={strokeWidth * 0.75} strokeDasharray="2 2" />
          <Path d="M12 8v8M10 10h4M10 14h4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
        </Svg>
      );

    case 'church':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill}>
          <Path d="M12 2v4M10 4h4M12 6L4 12v10h16V12L12 6zM10 22v-6h4v6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );

    case 'prayer':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill}>
          <Path d="M12 3v4M8 5l2 2M16 5l-2 2M9 12a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0v-6zM7 16a5 5 0 0 0 10 0" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );

    case 'sparkles':
    case 'star':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill}>
          <Path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );

    case 'bookmark':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill}>
          <Path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );

    case 'highlight':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill}>
          <Path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );

    case 'mic':
    case 'audio':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill}>
          <Path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" stroke={color} strokeWidth={strokeWidth} />
          <Path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
        </Svg>
      );

    case 'volume':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill}>
          <Path d="M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );

    case 'search':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill}>
          <Circle cx="11" cy="11" r="8" stroke={color} strokeWidth={strokeWidth} />
          <Path d="M21 21l-4.35-4.35" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
        </Svg>
      );

    case 'check':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill}>
          <Path d="M20 6L9 17l-5-5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );

    case 'calendar':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill}>
          <Rect x="3" y="4" width="18" height="18" rx="2" ry="2" stroke={color} strokeWidth={strokeWidth} />
          <Path d="M16 2v4M8 2v4M3 10h18" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
        </Svg>
      );

    case 'users':
    case 'community':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill}>
          <Path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
          <Circle cx="9" cy="7" r="4" stroke={color} strokeWidth={strokeWidth} />
          <Path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
        </Svg>
      );

    case 'chevron-down':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill}>
          <Path d="M6 9l6 6 6-6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );

    case 'chevron-right':
    case 'arrow-right':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill}>
          <Path d="M9 18l6-6-6-6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );

    case 'cross':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill}>
          <Path d="M12 2v20M7 8h10" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
        </Svg>
      );

    case 'briefcase':
    case 'jobs':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill}>
          <Rect x="2" y="7" width="20" height="14" rx="2" stroke={color} strokeWidth={strokeWidth} />
          <Path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" stroke={color} strokeWidth={strokeWidth} />
        </Svg>
      );

    case 'signal':
    case 'live':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill}>
          <Path d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
        </Svg>
      );

    case 'shield':
    case 'quiz':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill}>
          <Path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );

    case 'sun':
    case 'devotional':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill}>
          <Circle cx="12" cy="12" r="5" stroke={color} strokeWidth={strokeWidth} />
          <Path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
        </Svg>
      );

    default:
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill}>
          <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={strokeWidth} />
        </Svg>
      );
  }
}
