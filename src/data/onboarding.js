// ONBOARDING — the three value slides (copy, colours, photos) in one place so they're easy to swap.
//
// Photos: Unsplash (https://unsplash.com/license — free for commercial use in apps, no permission or credit
// required; credit kept here as a courtesy). To use your own, replace `photo` with any https image URL
// (portrait-friendly, the person roughly centred) or a bundled asset via require('../../assets/…').
// A regular photo is shown as a tall arch on the slide colour. For the exact reference look (the person cut out
// straight onto the colour) supply a transparent PNG and add `cutout: true` to that slide.
//   1  young man reading his Bible ............ https://unsplash.com/photos/Bj7kQwsuXG8
//   2  young woman, eyes closed, headphones ... https://unsplash.com/photos/Mwa8-6H9QPk  (Yohan Marion)
//   3  hands joined together ................. https://unsplash.com/photos/Q6KzWe-lq9Y
const unsplash = (id, w = 1000) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&crop=faces&w=${w}&q=72`;

export const ONBOARDING_SLIDES = [
  {
    id: 'word',
    color: '#F4B731', // warm yellow
    title: 'Study the Word deeply',
    body: 'Read, compare translations and explore commentary, exegesis and word study in one place.',
    photo: unsplash('1642762307490-7f5f7c9ed94a'),
    focus: 'center', // where to keep the face when cropping: 'top' | 'center' | 'bottom'
  },
  {
    id: 'season',
    color: '#3FA2E3', // sky blue
    title: 'Encouragement for every season',
    body: 'Share what you’re going through and receive scriptures and a prayer for your situation.',
    photo: unsplash('1668092834733-60f7c0d567a1'),
    focus: 'center',
  },
  {
    id: 'believers',
    color: '#F07A35', // warm orange
    title: 'Meet fellow believers',
    body: 'Join Christian communities, pray together and grow alongside people of faith worldwide.',
    photo: unsplash('1655720359248-eeace8c709c5'),
    focus: 'center',
  },
];

export const TAGLINE = 'A moment with God. Every day.';

// Shown under the sign-in buttons. Point these at the real pages before release.
export const TERMS_URL = 'https://biblenestra.com/terms';
export const PRIVACY_URL = 'https://biblenestra.com/privacy';
