import booksMeta from './books_meta.json';
import chapterPreviews from './chapter_previews.json';
import kjvBible from './kjv_bible.json';
import { getCachedChapter } from '../bible/loader';

// Bible content catalog and concordance database extracted from mielke.cc/bible.
// Complete 66 Books, 1,189 Chapters, 31,102 Verses of the Authorized King James Version.
// Other translations: see src/bible/catalog.js and src/bible/loader.js.

// The translation catalog lives in src/bible/catalog.js (60 legal translations, 40+ languages).
export { TRANSLATIONS, LICENSE_REQUIRED, TRANSLATION_REGIONS, translationInfo, resolveTranslationId } from '../bible/catalog';

export const BOOKS = booksMeta;

export const CHAPTER_TITLES = {
  ...chapterPreviews,
  'MAT:1': 'The Genealogy and Birth of Jesus Christ',
  'JHN:3': 'You Must Be Born Again · God So Loved the World',
  'PSA:23': 'The Lord Is My Shepherd · Divine Comfort and Provision',
  'GEN:1': 'The Creation of the Heavens and the Earth',
  'PHP:4': 'Rejoice in the Lord Always · Peace That Surpasses Understanding',
  'ROM:8': 'Life in the Spirit · More Than Conquerors',
  'REV:22': 'The River of Life · The Alpha and Omega · The Final Revelation',
};

// KJV ships with the app; other translations are loaded on demand by src/bible/loader.js.
const BIBLE_TEXT = { KJV: kjvBible };

// Verse of the day
export const VERSE_OF_DAY = {
  bookId: 'JHN',
  chapter: 3,
  verse: 16,
  theme: 'Salvation & Divine Love',
  reflection: 'God\'s love is not passive; it is active, sacrificial, and personal. Believing in Him transforms our present and guarantees our eternal future.',
};

// A rotating Verse of the Day (one per calendar day, cycling through the list).
export const DAILY_VERSES = [
  { bookId: 'JHN', chapter: 3, verse: 16, theme: 'God’s love', reflection: 'God’s love is not passive; it gives. Where can you receive that love today instead of trying to earn it?' },
  { bookId: 'PSA', chapter: 23, verse: 1, theme: 'Provision', reflection: 'A shepherd knows what the sheep need before they ask. What are you anxious to have that God may already be providing?' },
  { bookId: 'PHP', chapter: 4, verse: 6, theme: 'Peace in anxiety', reflection: 'Paul turns worry into prayer with thanksgiving. Name one worry and one thing you are thankful for, side by side.' },
  { bookId: 'ROM', chapter: 8, verse: 28, theme: 'Trust', reflection: 'All things work together — not all things are good. Where have you seen God bring good out of something hard?' },
  { bookId: 'ISA', chapter: 40, verse: 31, theme: 'Strength', reflection: 'Waiting on the Lord renews strength. What would it look like to wait well today rather than rush?' },
  { bookId: 'PRO', chapter: 3, verse: 5, theme: 'Guidance', reflection: 'Trusting with all your heart means leaning less on your own understanding. Which decision do you need to hold more loosely?' },
  { bookId: 'JER', chapter: 29, verse: 11, theme: 'Hope', reflection: 'These words were spoken to exiles far from home. God’s plans held even in the waiting. Where do you need that hope?' },
  { bookId: 'MAT', chapter: 11, verse: 28, theme: 'Rest', reflection: 'Jesus invites the weary, not the finished. What burden can you set down in prayer right now?' },
  { bookId: 'JOS', chapter: 1, verse: 9, theme: 'Courage', reflection: 'Courage here rests on presence: “the Lord thy God is with thee.” What step needs courage from you today?' },
  { bookId: 'LAM', chapter: 3, verse: 22, theme: 'Mercy', reflection: 'His compassions fail not — they are new every morning. Let today start fresh, whatever yesterday held.' },
  { bookId: '2CO', chapter: 5, verse: 17, theme: 'New life', reflection: 'In Christ you are a new creation. Which old label do you need to stop wearing?' },
  { bookId: 'GAL', chapter: 5, verse: 22, theme: 'Fruit of the Spirit', reflection: 'Fruit grows slowly and quietly. Which of these would you most like the Spirit to grow in you this week?' },
  { bookId: 'MIC', chapter: 6, verse: 8, theme: 'Faithful living', reflection: 'Do justly, love mercy, walk humbly. Pick one of the three and practise it deliberately today.' },
  { bookId: '1JN', chapter: 4, verse: 19, theme: 'Love', reflection: 'We love because He first loved us. Who could you love well today as an overflow of being loved?' },
];

export function verseOfDay(date = new Date()) {
  const start = new Date(date.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((date - start) / 86400000);
  const list = DAILY_VERSES.filter((v) => getChapter('KJV', v.bookId, v.chapter));
  return list[dayOfYear % list.length] || VERSE_OF_DAY;
}

// ---------- Strong's Concordance Database (Restored Required Feature) ----------
export const CONCORDANCE = [
  {
    strong: 'G2424',
    lemma: 'Ἰησοῦς',
    translit: 'Iēsous',
    pronun: 'ee-ay-sooce\'',
    lang: 'Greek',
    part: 'Proper Noun',
    origin: 'Of Hebrew origin [H3091 (Yehoshua)]',
    definition: 'Jesus, the Son of God, the Savior of mankind, God incarnate.',
    meaning: 'Yahweh saves; Jehovah is salvation.',
    count: 917,
    verses: [
      { ref: 'MAT 1:21', bookId: 'MAT', chapter: 1, verse: 21, text: 'And she shall bring forth a son, and thou shalt call his name JESUS: for he shall save his people from their sins.' },
      { ref: 'MAT 1:25', bookId: 'MAT', chapter: 1, verse: 25, text: 'And knew her not till she had brought forth her firstborn son: and he called his name JESUS.' },
      { ref: 'JHN 3:3', bookId: 'JHN', chapter: 3, verse: 3, text: 'Jesus answered and said unto him, Verily, verily, I say unto thee, Except a man be born again, he cannot see the kingdom of God.' },
    ],
  },
  {
    strong: 'G26',
    lemma: 'ἀγάπη',
    translit: 'agapē',
    pronun: 'ag-ah\'-pay',
    lang: 'Greek',
    part: 'Noun Feminine',
    origin: 'From G25 (agapaō)',
    definition: 'Brotherly love, affection, good will, love, benevolence. Unconditional, sacrificial, divine love.',
    meaning: 'Selfless, sacrificial love that chooses the highest good of the beloved.',
    count: 116,
    verses: [
      { ref: 'JHN 3:16', bookId: 'JHN', chapter: 3, verse: 16, text: 'For God so loved [G25] the world, that he gave his only begotten Son...' },
      { ref: 'ROM 8:35', bookId: 'ROM', chapter: 8, verse: 35, text: 'Who shall separate us from the love of Christ? shall tribulation, or distress, or persecution?' },
      { ref: 'ROM 8:39', bookId: 'ROM', chapter: 8, verse: 39, text: 'Nor height, nor depth, nor any other creature, shall be able to separate us from the love of God, which is in Christ Jesus our Lord.' },
    ],
  },
  {
    strong: 'G4102',
    lemma: 'πίστις',
    translit: 'pistis',
    pronun: 'pis\'-tis',
    lang: 'Greek',
    part: 'Noun Feminine',
    origin: 'From G3982 (peithō)',
    definition: 'Conviction of the truth of anything, belief; in the NT, conviction of God and Christ and divine truth with moral trust.',
    meaning: 'Living trust, allegiance, and reliance upon God.',
    count: 244,
    verses: [
      { ref: 'ROM 1:17', bookId: 'ROM', chapter: 1, verse: 17, text: 'The just shall live by faith.' },
      { ref: 'HEB 11:1', bookId: 'HEB', chapter: 11, verse: 1, text: 'Now faith is the substance of things hoped for, the evidence of things not seen.' },
      { ref: 'PHP 3:9', bookId: 'PHP', chapter: 3, verse: 9, text: 'And be found in him, not having mine own righteousness... but that which is through the faith of Christ.' },
    ],
  },
  {
    strong: 'G4151',
    lemma: 'πνεῦμα',
    translit: 'pneuma',
    pronun: 'pnyoo\'-mah',
    lang: 'Greek',
    part: 'Noun Neuter',
    origin: 'From G4154 (pneō)',
    definition: 'A movement of air, wind, breath; the vital principle of life; the Holy Spirit of God.',
    meaning: 'Breath, spirit, the third Person of the Trinity.',
    count: 379,
    verses: [
      { ref: 'MAT 1:18', bookId: 'MAT', chapter: 1, verse: 18, text: '...she was found with child of the Holy Ghost [pneuma].' },
      { ref: 'JHN 3:5', bookId: 'JHN', chapter: 3, verse: 5, text: 'Except a man be born of water and of the Spirit [pneuma], he cannot enter into the kingdom of God.' },
      { ref: 'JHN 3:8', bookId: 'JHN', chapter: 3, verse: 8, text: 'The wind [pneuma] bloweth where it listeth... so is every one that is born of the Spirit.' },
      { ref: 'ROM 8:14', bookId: 'ROM', chapter: 8, verse: 14, text: 'For as many as are led by the Spirit of God, they are the sons of God.' },
    ],
  },
  {
    strong: 'G5485',
    lemma: 'χάρις',
    translit: 'charis',
    pronun: 'khar\'-ece',
    lang: 'Greek',
    part: 'Noun Feminine',
    origin: 'From G5463 (chairō)',
    definition: 'Grace, favor, goodwill, lovingkindness. Especially the unmerited favor of God in salvation.',
    meaning: 'Unearned divine favor, power, and mercy.',
    count: 156,
    verses: [
      { ref: 'ROM 5:1', bookId: 'ROM', chapter: 5, verse: 1, text: 'Therefore being justified by faith, we have peace with God through our Lord Jesus Christ by whom we have access into this grace...' },
      { ref: 'PHP 4:23', bookId: 'PHP', chapter: 4, verse: 23, text: 'The grace of our Lord Jesus Christ be with you all. Amen.' },
    ],
  },
  {
    strong: 'H3068',
    lemma: 'יְהוָה',
    translit: 'Yahweh',
    pronun: 'yah-weh',
    lang: 'Hebrew',
    part: 'Proper Name',
    origin: 'From H1961 (hayah - to exist)',
    definition: 'The proper name of the one true God; the self-existent, eternal, covenant-keeping God.',
    meaning: 'I AM WHO I AM; The Eternal One.',
    count: 6519,
    verses: [
      { ref: 'PSA 23:1', bookId: 'PSA', chapter: 23, verse: 1, text: 'The LORD [Yahweh] is my shepherd; I shall not want.' },
      { ref: 'PSA 23:6', bookId: 'PSA', chapter: 23, verse: 6, text: '...and I will dwell in the house of the LORD [Yahweh] for ever.' },
      { ref: 'GEN 2:4', bookId: 'GEN', chapter: 2, verse: 4, text: '...in the day that the LORD God made the earth and the heavens.' },
    ],
  },
  {
    strong: 'H7965',
    lemma: 'שָׁלוֹם',
    translit: 'shalom',
    pronun: 'shaw-lome\'',
    lang: 'Hebrew',
    part: 'Noun Masculine',
    origin: 'From H7999 (shalam - to be safe/whole)',
    definition: 'Completeness, soundness, welfare, peace, health, prosperity, quiet, tranquility.',
    meaning: 'Divine harmony, wholeness, safety, and restorative peace.',
    count: 237,
    verses: [
      { ref: 'PSA 29:11', bookId: 'PSA', chapter: 29, verse: 11, text: 'The LORD will give strength unto his people; the LORD will bless his people with peace [shalom].' },
      { ref: 'ISA 9:6', bookId: 'ISA', chapter: 9, verse: 6, text: '...The Prince of Peace [Sar Shalom].' },
      { ref: 'ISA 26:3', bookId: 'ISA', chapter: 26, verse: 3, text: 'Thou wilt keep him in perfect peace [shalom shalom], whose mind is stayed on thee.' },
    ],
  },
  {
    strong: 'H2617',
    lemma: 'חֶסֶד',
    translit: 'chesed',
    pronun: 'kheh\'-sed',
    lang: 'Hebrew',
    part: 'Noun Masculine',
    origin: 'From H2616 (chasad)',
    definition: 'Goodness, kindness, steadfast love, mercy, covenant loyalty.',
    meaning: 'God\'s unfailing, enduring covenant love and mercy.',
    count: 248,
    verses: [
      { ref: 'PSA 23:6', bookId: 'PSA', chapter: 23, verse: 6, text: 'Surely goodness and mercy [chesed] shall follow me all the days of my life...' },
      { ref: 'PSA 136:1', bookId: 'PSA', chapter: 136, verse: 1, text: 'O give thanks unto the LORD; for he is good: for his mercy [chesed] endureth for ever.' },
    ],
  },
];

export function searchConcordance(query) {
  if (!query || !query.trim()) return CONCORDANCE;
  const q = query.trim().toLowerCase();
  return CONCORDANCE.filter((c) =>
    c.strong.toLowerCase().includes(q) ||
    c.translit.toLowerCase().includes(q) ||
    c.definition.toLowerCase().includes(q) ||
    c.meaning.toLowerCase().includes(q) ||
    c.lemma.includes(q)
  );
}

// Synchronous: returns the chapter if it's bundled (KJV) or already loaded, otherwise KJV.
// Screens that show a chosen translation should use useChapter() from src/bible/loader.js.
export function getChapter(translation, bookId, chapter) {
  return getCachedChapter(translation, bookId, chapter) || getCachedChapter('KJV', bookId, chapter);
}

export function searchBible(query, translation = 'KJV', scope = 'ALL', limit = 40) {
  if (!query || !query.trim() || query.trim().length < 2) return [];
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const qClean = query.trim().toLowerCase();
  const trText = (translation && BIBLE_TEXT[translation]) || BIBLE_TEXT.KJV;
  const results = [];

  for (const [key, verses] of Object.entries(trText)) {
    const [bookId, chStr] = key.split(':');
    const b = BOOKS.find((x) => x.id === bookId);
    if (!b) continue;
    if (scope === 'OT' && b.testament !== 'OT') continue;
    if (scope === 'NT' && b.testament !== 'NT') continue;
    const chapter = parseInt(chStr, 10);

    for (let i = 0; i < verses.length; i++) {
      const text = verses[i];
      if (!text) continue;
      const lower = text.toLowerCase();
      const matches = words.every((w) => lower.includes(w));
      if (matches) {
        const exact = lower.includes(qClean);
        results.push({
          bookId,
          chapter,
          verse: i + 1,
          text,
          exact,
        });
        if (results.length >= limit) return results;
      }
    }
  }
  return results;
}

export function getStrongExternalUrl(lexicon, number, server = 'biblehub') {
  const isGreek = (lexicon && lexicon.toLowerCase().includes('greek')) || (typeof number === 'string' && number.startsWith('G'));
  const cleanNum = parseInt(String(number).replace(/^[GH]/i, ''), 10);
  if (isNaN(cleanNum)) return null;

  if (server === 'biblehub') {
    return isGreek
      ? `https://biblehub.com/greek/${cleanNum}.htm`
      : `https://biblehub.com/hebrew/${cleanNum}.htm`;
  }
  return isGreek
    ? `https://studybible.info/strongs/G${cleanNum}`
    : `https://studybible.info/strongs/H${cleanNum}`;
}

export function refLabel(bookId, chapter, verse) {
  const b = BOOKS.find((x) => x.id === bookId);
  const name = b ? b.name : bookId;
  if (!chapter) return name;
  if (!verse) return `${name} ${chapter}`;
  return `${name} ${chapter}:${verse}`;
}

export function bookName(bookId) {
  const b = BOOKS.find((x) => x.id === bookId);
  return b ? b.name : bookId;
}

export function availableChapters(bookId) {
  if (bookId) {
    const b = BOOKS.find((x) => x.id === bookId);
    if (b) {
      return Array.from({ length: b.chapters }, (_, i) => ({ bookId, chapter: i + 1 }));
    }
  }
  return [
    { bookId: 'GEN', chapter: 1 },
    { bookId: 'PSA', chapter: 23 },
    { bookId: 'MAT', chapter: 1 },
    { bookId: 'JHN', chapter: 3 },
    { bookId: 'ROM', chapter: 8 },
    { bookId: 'REV', chapter: 22 },
  ];
}

// ---------- Cross-references for frequently read chapters ----------
export const CROSS_REFS = {
  'MAT:1': [
    { ref: 'GEN 12:3', why: 'The promise to Abraham — all nations blessed through his family line.' },
    { ref: '2SA 7:12', why: 'God promises David a lasting throne; Matthew traces Jesus as David’s son.' },
    { ref: 'RUT 4:21', why: 'Boaz, Obed and Jesse — Ruth’s place in the line of David.' },
    { ref: 'ISA 7:14', why: 'The virgin and Immanuel, quoted in Matthew 1:23.' },
    { ref: 'LUK 3:23', why: 'Luke’s genealogy of Jesus, traced back to Adam.' },
  ],
  'JHN:3': [
    { ref: 'NUM 21:8', why: 'The bronze serpent lifted up, which Jesus applies to himself (v14).' },
    { ref: 'EZK 36:26', why: 'A new heart and a new spirit — the background to “born of water and of the Spirit”.' },
    { ref: 'JHN 1:12', why: 'Those who receive him are born of God.' },
    { ref: 'ROM 5:8', why: 'God shows his love in that Christ died for us.' },
    { ref: '1JN 4:9', why: 'God sent his only begotten Son that we might live through him.' },
  ],
  'PSA:23': [
    { ref: 'JHN 10:11', why: 'Jesus: “I am the good shepherd.”' },
    { ref: 'ISA 40:11', why: 'He shall feed his flock like a shepherd.' },
    { ref: 'EZK 34:12', why: 'God promises to seek out and rescue his scattered sheep.' },
    { ref: 'HEB 13:20', why: 'Jesus, the great shepherd of the sheep.' },
  ],
  'PHP:4': [
    { ref: 'MAT 6:34', why: 'Take no thought for the morrow — Jesus on worry.' },
    { ref: '1PE 5:7', why: 'Cast all your care upon him; for he careth for you.' },
    { ref: 'ISA 26:3', why: 'Perfect peace for the mind stayed on God.' },
    { ref: 'COL 3:15', why: 'Let the peace of God rule in your hearts.' },
  ],
  'GEN:1': [
    { ref: 'JHN 1:1', why: 'In the beginning was the Word — creation through Christ.' },
    { ref: 'HEB 11:3', why: 'The worlds were framed by the word of God.' },
    { ref: 'PSA 33:6', why: 'By the word of the LORD were the heavens made.' },
    { ref: 'COL 1:16', why: 'All things were created by him, and for him.' },
  ],
  'ROM:8': [
    { ref: 'JHN 3:17', why: 'God sent not his Son to condemn the world.' },
    { ref: 'GAL 5:16', why: 'Walk in the Spirit — the same contrast of flesh and Spirit.' },
    { ref: 'EPH 1:11', why: 'Predestinated according to the purpose of him who works all things.' },
    { ref: 'PSA 44:22', why: 'Quoted in Romans 8:36 — “for thy sake are we killed all the day long”.' },
  ],
};

// English words in KJV text that point to an entry in CONCORDANCE (used for verse word study)
export const WORD_KEYS = {
  'Iēsous': ['jesus'],
  'agapē': ['love', 'loved', 'loveth', 'charity'],
  'pistis': ['faith', 'believe', 'believeth', 'believed', 'belief'],
  'pneuma': ['spirit', 'ghost'],
  'charis': ['grace', 'favour'],
  'Yahweh': ['lord'],
  'shalom': ['peace'],
  'chesed': ['mercy', 'mercies', 'lovingkindness', 'kindness'],
};

export function parseRef(ref) {
  const m = String(ref || '').trim().match(/^([1-3]?[A-Z]{2,3})\s+(\d+)(?::(\d+))?/);
  if (!m) return null;
  return { bookId: m[1], chapter: Number(m[2]), verse: m[3] ? Number(m[3]) : undefined };
}
