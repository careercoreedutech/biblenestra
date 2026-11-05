// Product rules shared with the app (keep in sync with src/ads/config.js AD_RULES in the app).
export const RULES = {
  supportAdsDaily: 4,   // Today → 4 🔥 support ads
  jobAdsNeeded: 5,      // Jobs → watch 5 ads …
  jobAdCoins: 20,       // … to unlock 20 coins
  bidFee: 20,           // coins to place a bid
  gameCoinsPerCorrect: 5,
  gameMaxQuestions: 20,
  gameIds: ['trivia_master', 'who_said_it', 'verse_scramble', 'timeline_challenge'],
  gameAliases: { trivia: 'trivia_master', who: 'who_said_it', scramble: 'verse_scramble', chronology: 'timeline_challenge' },
  eventKinds: ['Announcement', 'Event', 'Celebration', 'Greeting'],
  creatorGiftShare: 0.70, // 70% of gift coins credited to creator
};

export const GIFTS = [
  { id: 'g_rose', name: 'Rose', price: 5, icon: 'heart', desc: 'Affordable everyday appreciation' },
  { id: 'g_bouquet', name: 'Flower Bouquet', price: 25, icon: 'sparkles', desc: 'A more expressive thank-you gift' },
  { id: 'g_star', name: 'Golden Star', price: 100, icon: 'star', desc: 'Premium appreciation gift' },
  { id: 'g_crown', name: 'Royal Crown', price: 500, icon: 'coin', desc: 'High-value creator-support gift' },
];
export const GIFT_MAP = new Map(GIFTS.map((g) => [g.id, g]));

// Fund Me (round 3): donation limits in minor units per currency, preset buttons, platform fee (basis points).
export const FUNDME = {
  platformFeeBps: 0, // 0 = no platform fee (e.g. 250 = 2.5%, taken as a Stripe application fee)
  currencies: {
    GBP: { min: 100, max: 1000000, goalMax: 100000000, presets: [1000, 2500, 5000, 10000] },
    USD: { min: 100, max: 1000000, goalMax: 100000000, presets: [1000, 2500, 5000, 10000] },
    EUR: { min: 100, max: 1000000, goalMax: 100000000, presets: [1000, 2500, 5000, 10000] },
    NGN: { min: 50000, max: 500000000, goalMax: 50000000000, presets: [200000, 500000, 1000000, 2500000] },
  },
  donationsPer10Min: 10, // per signed-in user / per IP
};
