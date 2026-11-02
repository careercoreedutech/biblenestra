// Where Bible text, commentaries and the Strong's lexicon come from.
//
// Out of the box the app reads from two free, open, CORS-enabled services:
//   • Free Use Bible API (https://bible.helloao.org) — 1,000+ translations whose licences allow
//     use in apps, plus public-domain commentaries (Matthew Henry, JFB, Clarke, Gill, Keil-Delitzsch…).
//   • bolls.life — Strong's-tagged text and the public-domain Thayer / Brown-Driver-Briggs lexicon.
//
// For production we recommend mirroring the data on your own backend/CDN (both sources are open:
// https://github.com/HelloAOLab/bible-api) and pointing these URLs at it. Nothing else needs to change.

export const BIBLE_API = 'https://bible.helloao.org/api';
export const LEXICON_API = 'https://bolls.life';

// Copyrighted translations (NIV, ESV, NLT, TPT, NKJV, AMP, MSG…) need a written licence from their
// publisher before they can be shown in an app — especially one with ads. Once you hold a licence and
// serve the text from your backend, add an entry here and the translation becomes selectable.
// The URL may use {book} (USFM id, e.g. JHN), {bookNum} (1–66) and {chapter}. The response must be
// either an array of verse strings, or { verses: [...] }, or the bolls format [{ verse, text }].
//
// Example:
//   TPT: { url: 'https://api.your-backend.com/bibles/TPT/{book}/{chapter}.json' },
export const LICENSED_SOURCES = {
};

// How long a cached chapter is trusted before a background refresh (ms). Text rarely changes.
export const CACHE_TTL = 1000 * 60 * 60 * 24 * 90;
