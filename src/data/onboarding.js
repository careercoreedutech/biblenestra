// ONBOARDING — the four value slides (copy, colours, photos) in one place so they're easy to swap.
//
// Photos are bundled (assets/onboarding/*.jpg, 810×1080, 3:4). Each is a studio shot whose plain background
// was recoloured to the slide colour, padded/cropped to 3:4 and faded into that colour at the edges, so the
// person stands straight on the solid colour like the reference; the white rings are drawn into the background
// behind the person (`ringsInPhoto`). To replace one, export a 3:4 JPG whose background is exactly the slide
// `color` (≤200 KB) and keep the file name; drop `ringsInPhoto` and the app draws the rings over the photo instead.
//
// Sources — all Unsplash License (https://unsplash.com/license): free for commercial use in apps, no
// permission or credit required; credit kept here as a courtesy.
//   word       woman reading on her phone, yellow studio wall ... https://unsplash.com/photos/zdvHmS5bXZo  (Karollyne Videira Hubert)
//   companion  woman, open welcoming hands, plain backdrop ...... https://unsplash.com/photos/FJVwEavoFIU  (Ahmed Nasiru)
//   believers  woman laughing on a video call, orange backdrop .. https://unsplash.com/photos/iXCkPO66vzk  (Ahmed Nasiru)
//   daily      woman, eyes closed, Bible held to her heart ...... https://unsplash.com/photos/2p986HgKPe8  (Eye Creator)

export const ONBOARDING_SLIDES = [
  {
    id: 'word',
    color: '#F8BE14', // warm yellow
    title: 'Study the Word',
    body: 'Read, compare translations and dig into commentary and exegesis on every verse.',
    photo: require('../../assets/onboarding/word.jpg'),
    ringsInPhoto: true, // the white rings are drawn into the photo, behind the person
  },
  {
    id: 'companion',
    color: '#3FA2E3', // sky blue
    title: 'Your Scripture Companion',
    body: 'Share what you’re going through and receive verses and a prayer for your moment.',
    photo: require('../../assets/onboarding/companion.jpg'),
    ringsInPhoto: true, // the white rings are drawn into the photo, behind the person
  },
  {
    id: 'believers',
    color: '#F07A35', // warm orange
    title: 'Meet fellow believers',
    body: 'Join communities, chat, and light a candle on the prayer wall for one another.',
    photo: require('../../assets/onboarding/believers.jpg'),
    ringsInPhoto: true, // the white rings are drawn into the photo, behind the person
  },
  {
    id: 'daily',
    color: '#4CAF82', // soft green
    title: 'Daily Bread',
    body: 'Start each day with a devotional, then grow deeper with short guided courses.',
    photo: require('../../assets/onboarding/daily.jpg'),
    ringsInPhoto: true, // the white rings are drawn into the photo, behind the person
  },
];

export const TAGLINE = 'A moment with God. Every day.';

// Shown under the sign-in buttons and in Profile → Account.
// LEGAL: Terms, Privacy Policy and the account-deletion page are served by our Worker (text in
// backend/src/lib/legal.js). Same base URL as the API; the production Worker when no API URL is set (local mode).
const LEGAL_BASE = String(process.env.EXPO_PUBLIC_API_URL || '').trim().replace(/\/+$/, '') || 'https://biblenestra-api.lightddarkness.workers.dev';
export const TERMS_URL = `${LEGAL_BASE}/terms`;
export const PRIVACY_URL = `${LEGAL_BASE}/privacy`;
export const DELETE_ACCOUNT_URL = `${LEGAL_BASE}/delete-account`;
