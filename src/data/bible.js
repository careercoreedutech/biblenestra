// Bible content catalog. Public-domain KJV/WEB text is included for a few chapters so the
// reader, search, concordance and compare screens work offline. Licensed translations
// (MSG, NIV, NLT, GNB, AMP, AMP Classic, ESV...) are listed in the catalog but marked
// unavailable until a licensed content feed is connected (see spec §1.5.1).

export const TRANSLATIONS = [
  { id: 'KJV', name: 'King James Version', lang: 'English', available: true, publisher: 'Public domain', offline: true },
  { id: 'WEB', name: 'World English Bible', lang: 'English', available: true, publisher: 'Public domain', offline: true },
  { id: 'MSG', name: 'The Message', lang: 'English', available: false, publisher: 'NavPress', offline: false },
  { id: 'NIV', name: 'New International Version', lang: 'English', available: false, publisher: 'Biblica', offline: false },
  { id: 'NLT', name: 'New Living Translation', lang: 'English', available: false, publisher: 'Tyndale', offline: false },
  { id: 'GNB', name: 'Good News Bible', lang: 'English', available: false, publisher: 'Bible Society', offline: false },
  { id: 'AMP', name: 'Amplified Bible', lang: 'English', available: false, publisher: 'Lockman Foundation', offline: false },
  { id: 'AMPC', name: 'Amplified Classic', lang: 'English', available: false, publisher: 'Lockman Foundation', offline: false },
  { id: 'ESV', name: 'English Standard Version', lang: 'English', available: false, publisher: 'Crossway', offline: false },
  { id: 'NKJV', name: 'New King James Version', lang: 'English', available: false, publisher: 'Thomas Nelson', offline: false },
  { id: 'LSG', name: 'Louis Segond', lang: 'French', available: false, publisher: 'Public domain', offline: false },
  { id: 'RVR', name: 'Reina-Valera 1960', lang: 'Spanish', available: false, publisher: 'Sociedades Bíblicas', offline: false },
  { id: 'YOR', name: 'Bibeli Mimọ (Yoruba)', lang: 'Yoruba', available: false, publisher: 'Bible Society of Nigeria', offline: false },
  { id: 'SWA', name: 'Biblia Habari Njema (Swahili)', lang: 'Swahili', available: false, publisher: 'Bible Society', offline: false },
];

export const BOOKS = [
  { id: 'GEN', name: 'Genesis', testament: 'OT', chapters: 50 },
  { id: 'EXO', name: 'Exodus', testament: 'OT', chapters: 40 },
  { id: 'PSA', name: 'Psalms', testament: 'OT', chapters: 150 },
  { id: 'PRO', name: 'Proverbs', testament: 'OT', chapters: 31 },
  { id: 'ISA', name: 'Isaiah', testament: 'OT', chapters: 66 },
  { id: 'MAT', name: 'Matthew', testament: 'NT', chapters: 28 },
  { id: 'MRK', name: 'Mark', testament: 'NT', chapters: 16 },
  { id: 'LUK', name: 'Luke', testament: 'NT', chapters: 24 },
  { id: 'JHN', name: 'John', testament: 'NT', chapters: 21 },
  { id: 'ROM', name: 'Romans', testament: 'NT', chapters: 16 },
  { id: 'PHP', name: 'Philippians', testament: 'NT', chapters: 4 },
  { id: 'REV', name: 'Revelation', testament: 'NT', chapters: 22 },
];

export const CHAPTER_TITLES = {
  'MAT:1': 'The Genealogy and Birth of Jesus',
  'JHN:3': 'You Must Be Born Again',
  'PSA:23': 'The Lord Is My Shepherd',
  'GEN:1': 'The Creation of the World',
  'PHP:4': 'Rejoice in the Lord Always',
  'ROM:8': 'Life in the Spirit',
};

// text[translation][book:chapter] = [verse strings]
const KJV = {
  'MAT:1': [
    'The book of the generation of Jesus Christ, the son of David, the son of Abraham.',
    'Abraham begat Isaac; and Isaac begat Jacob; and Jacob begat Judas and his brethren;',
    'And Judas begat Phares and Zara of Thamar; and Phares begat Esrom; and Esrom begat Aram;',
    'And Aram begat Aminadab; and Aminadab begat Naasson; and Naasson begat Salmon;',
    'And Salmon begat Booz of Rachab; and Booz begat Obed of Ruth; and Obed begat Jesse;',
    'And Jesse begat David the king; and David the king begat Solomon of her that had been the wife of Urias;',
    'And Solomon begat Roboam; and Roboam begat Abia; and Abia begat Asa;',
    'And Asa begat Josaphat; and Josaphat begat Joram; and Joram begat Ozias;',
    'And Ozias begat Joatham; and Joatham begat Achaz; and Achaz begat Ezekias;',
    'And Ezekias begat Manasses; and Manasses begat Amon; and Amon begat Josias;',
    'And Josias begat Jechonias and his brethren, about the time they were carried away to Babylon:',
    'And after they were brought to Babylon, Jechonias begat Salathiel; and Salathiel begat Zorobabel;',
    'And Zorobabel begat Abiud; and Abiud begat Eliakim; and Eliakim begat Azor;',
    'And Azor begat Sadoc; and Sadoc begat Achim; and Achim begat Eliud;',
    'And Eliud begat Eleazar; and Eleazar begat Matthan; and Matthan begat Jacob;',
    'And Jacob begat Joseph the husband of Mary, of whom was born Jesus, who is called Christ.',
    'So all the generations from Abraham to David are fourteen generations; and from David until the carrying away into Babylon are fourteen generations; and from the carrying away into Babylon unto Christ are fourteen generations.',
    'Now the birth of Jesus Christ was on this wise: When as his mother Mary was espoused to Joseph, before they came together, she was found with child of the Holy Ghost.',
    'Then Joseph her husband, being a just man, and not willing to make her a publick example, was minded to put her away privily.',
    'But while he thought on these things, behold, the angel of the Lord appeared unto him in a dream, saying, Joseph, thou son of David, fear not to take unto thee Mary thy wife: for that which is conceived in her is of the Holy Ghost.',
    'And she shall bring forth a son, and thou shalt call his name JESUS: for he shall save his people from their sins.',
    'Now all this was done, that it might be fulfilled which was spoken of the Lord by the prophet, saying,',
    'Behold, a virgin shall be with child, and shall bring forth a son, and they shall call his name Emmanuel, which being interpreted is, God with us.',
    'Then Joseph being raised from sleep did as the angel of the Lord had bidden him, and took unto him his wife:',
    'And knew her not till she had brought forth her firstborn son: and he called his name JESUS.',
  ],
  'JHN:3': [
    'There was a man of the Pharisees, named Nicodemus, a ruler of the Jews:',
    'The same came to Jesus by night, and said unto him, Rabbi, we know that thou art a teacher come from God: for no man can do these miracles that thou doest, except God be with him.',
    'Jesus answered and said unto him, Verily, verily, I say unto thee, Except a man be born again, he cannot see the kingdom of God.',
    'Nicodemus saith unto him, How can a man be born when he is old? can he enter the second time into his mother\'s womb, and be born?',
    'Jesus answered, Verily, verily, I say unto thee, Except a man be born of water and of the Spirit, he cannot enter into the kingdom of God.',
    'That which is born of the flesh is flesh; and that which is born of the Spirit is spirit.',
    'Marvel not that I said unto thee, Ye must be born again.',
    'The wind bloweth where it listeth, and thou hearest the sound thereof, but canst not tell whence it cometh, and whither it goeth: so is every one that is born of the Spirit.',
    'Nicodemus answered and said unto him, How can these things be?',
    'Jesus answered and said unto him, Art thou a master of Israel, and knowest not these things?',
    'Verily, verily, I say unto thee, We speak that we do know, and testify that we have seen; and ye receive not our witness.',
    'If I have told you earthly things, and ye believe not, how shall ye believe, if I tell you of heavenly things?',
    'And no man hath ascended up to heaven, but he that came down from heaven, even the Son of man which is in heaven.',
    'And as Moses lifted up the serpent in the wilderness, even so must the Son of man be lifted up:',
    'That whosoever believeth in him should not perish, but have eternal life.',
    'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.',
    'For God sent not his Son into the world to condemn the world; but that the world through him might be saved.',
    'He that believeth on him is not condemned: but he that believeth not is condemned already, because he hath not believed in the name of the only begotten Son of God.',
  ],
  'PSA:23': [
    'The LORD is my shepherd; I shall not want.',
    'He maketh me to lie down in green pastures: he leadeth me beside the still waters.',
    'He restoreth my soul: he leadeth me in the paths of righteousness for his name\'s sake.',
    'Yea, though I walk through the valley of the shadow of death, I will fear no evil: for thou art with me; thy rod and thy staff they comfort me.',
    'Thou preparest a table before me in the presence of mine enemies: thou anointest my head with oil; my cup runneth over.',
    'Surely goodness and mercy shall follow me all the days of my life: and I will dwell in the house of the LORD for ever.',
  ],
  'GEN:1': [
    'In the beginning God created the heaven and the earth.',
    'And the earth was without form, and void; and darkness was upon the face of the deep. And the Spirit of God moved upon the face of the waters.',
    'And God said, Let there be light: and there was light.',
    'And God saw the light, that it was good: and God divided the light from the darkness.',
    'And God called the light Day, and the darkness he called Night. And the evening and the morning were the first day.',
  ],
  'PHP:4': [
    'Therefore, my brethren dearly beloved and longed for, my joy and crown, so stand fast in the Lord, my dearly beloved.',
    'I beseech Euodias, and beseech Syntyche, that they be of the same mind in the Lord.',
    'And I intreat thee also, true yokefellow, help those women which laboured with me in the gospel, with Clement also, and with other my fellowlabourers, whose names are in the book of life.',
    'Rejoice in the Lord alway: and again I say, Rejoice.',
    'Let your moderation be known unto all men. The Lord is at hand.',
    'Be careful for nothing; but in every thing by prayer and supplication with thanksgiving let your requests be made known unto God.',
    'And the peace of God, which passeth all understanding, shall keep your hearts and minds through Christ Jesus.',
    'Finally, brethren, whatsoever things are true, whatsoever things are honest, whatsoever things are just, whatsoever things are pure, whatsoever things are lovely, whatsoever things are of good report; if there be any virtue, and if there be any praise, think on these things.',
    'Those things, which ye have both learned, and received, and heard, and seen in me, do: and the God of peace shall be with you.',
    'But I rejoiced in the Lord greatly, that now at the last your care of me hath flourished again; wherein ye were also careful, but ye lacked opportunity.',
    'Not that I speak in respect of want: for I have learned, in whatsoever state I am, therewith to be content.',
    'I know both how to be abased, and I know how to abound: every where and in all things I am instructed both to be full and to be hungry, both to abound and to suffer need.',
    'I can do all things through Christ which strengtheneth me.',
  ],
  'ROM:8': [
    'There is therefore now no condemnation to them which are in Christ Jesus, who walk not after the flesh, but after the Spirit.',
    'For the law of the Spirit of life in Christ Jesus hath made me free from the law of sin and death.',
    'For what the law could not do, in that it was weak through the flesh, God sending his own Son in the likeness of sinful flesh, and for sin, condemned sin in the flesh:',
    'That the righteousness of the law might be fulfilled in us, who walk not after the flesh, but after the Spirit.',
    'For they that are after the flesh do mind the things of the flesh; but they that are after the Spirit the things of the Spirit.',
    'For to be carnally minded is death; but to be spiritually minded is life and peace.',
  ],
};

const WEB = {
  'MAT:1': [
    'The book of the genealogy of Jesus Christ, the son of David, the son of Abraham.',
    'Abraham became the father of Isaac. Isaac became the father of Jacob. Jacob became the father of Judah and his brothers.',
    'Judah became the father of Perez and Zerah by Tamar. Perez became the father of Hezron. Hezron became the father of Ram.',
    'Ram became the father of Amminadab. Amminadab became the father of Nahshon. Nahshon became the father of Salmon.',
    'Salmon became the father of Boaz by Rahab. Boaz became the father of Obed by Ruth. Obed became the father of Jesse.',
    'Jesse became the father of King David. David the king became the father of Solomon by her who had been Uriah\'s wife.',
  ],
  'JHN:3': [
    'Now there was a man of the Pharisees named Nicodemus, a ruler of the Jews.',
    'He came to Jesus by night and said to him, "Rabbi, we know that you are a teacher come from God, for no one can do these signs that you do, unless God is with him."',
    'Jesus answered him, "Most certainly I tell you, unless one is born anew, he can\'t see God\'s Kingdom."',
  ],
  'PSA:23': [
    'Yahweh is my shepherd; I shall lack nothing.',
    'He makes me lie down in green pastures. He leads me beside still waters.',
    'He restores my soul. He guides me in the paths of righteousness for his name\'s sake.',
    'Even though I walk through the valley of the shadow of death, I will fear no evil, for you are with me. Your rod and your staff, they comfort me.',
    'You prepare a table before me in the presence of my enemies. You anoint my head with oil. My cup runs over.',
    'Surely goodness and loving kindness shall follow me all the days of my life, and I will dwell in Yahweh\'s house forever.',
  ],
  'GEN:1': [
    'In the beginning, God created the heavens and the earth.',
    'The earth was formless and empty. Darkness was on the surface of the deep and God\'s Spirit was hovering over the surface of the waters.',
    'God said, "Let there be light," and there was light.',
  ],
  'PHP:4': [
    'Therefore, my brothers, beloved and longed for, my joy and crown, stand firm in the Lord in this way, my beloved.',
    'I exhort Euodia, and I exhort Syntyche, to think the same way in the Lord.',
    'Yes, I beg you also, true partner, help these women, for they labored with me in the Good News with Clement also, and the rest of my fellow workers, whose names are in the book of life.',
    'Rejoice in the Lord always! Again I will say, "Rejoice!"',
    'Let your gentleness be known to all men. The Lord is at hand.',
    'In nothing be anxious, but in everything, by prayer and petition with thanksgiving, let your requests be made known to God.',
    'And the peace of God, which surpasses all understanding, will guard your hearts and your thoughts in Christ Jesus.',
  ],
  'ROM:8': [
    'There is therefore now no condemnation to those who are in Christ Jesus, who don\'t walk according to the flesh, but according to the Spirit.',
    'For the law of the Spirit of life in Christ Jesus made me free from the law of sin and of death.',
  ],
};

export const TEXT = { KJV, WEB };

export function getChapter(translation, bookId, chapter) {
  const t = TEXT[translation];
  if (!t) return null;
  return t[`${bookId}:${chapter}`] || null;
}

export function bookName(id) {
  const b = BOOKS.find((x) => x.id === id);
  return b ? b.name : id;
}

export function refLabel(bookId, chapter, verse) {
  return `${bookName(bookId)} ${chapter}${verse ? ':' + verse : ''}`;
}

export function availableChapters() {
  return Object.keys(KJV).map((k) => {
    const [bookId, ch] = k.split(':');
    return { bookId, chapter: Number(ch), title: CHAPTER_TITLES[k] || refLabel(bookId, ch) };
  });
}

// Concordance search across a translation (exact word match + related forms).
export function searchBible(query, translation = 'KJV', scope = 'ALL') {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const t = TEXT[translation] || KJV;
  const out = [];
  Object.entries(t).forEach(([key, verses]) => {
    const [bookId, ch] = key.split(':');
    const book = BOOKS.find((b) => b.id === bookId);
    if (scope !== 'ALL' && book && book.testament !== scope) return;
    verses.forEach((v, i) => {
      const lower = v.toLowerCase();
      if (lower.includes(q)) {
        const exact = new RegExp(`\\b${q}\\b`).test(lower);
        out.push({ bookId, chapter: Number(ch), verse: i + 1, text: v, exact, translation });
      }
    });
  });
  return out.sort((a, b) => Number(b.exact) - Number(a.exact));
}

// Original-language sample entries (licensed Strong's-style data would replace this).
export const WORD_STUDY = {
  love: { original: 'ἀγάπη', translit: 'agapē', lang: 'Greek', strongs: 'G26', lemma: 'ἀγάπη', meaning: 'love, goodwill, benevolence; self-giving love', grammar: 'noun, feminine', contextNote: 'In John 3:16 the verb form ἠγάπησεν (ēgapēsen) describes a completed act of love directed at the world.' },
  shepherd: { original: 'רֹעֶה', translit: 'roʿeh', lang: 'Hebrew', strongs: 'H7462', lemma: 'רָעָה', meaning: 'to pasture, tend, graze; a shepherd', grammar: 'participle, masculine', contextNote: 'Psalm 23:1 uses the participle as a title for Yahweh: the one who tends.' },
  begat: { original: 'ἐγέννησεν', translit: 'egennēsen', lang: 'Greek', strongs: 'G1080', lemma: 'γεννάω', meaning: 'to beget, to become the father of', grammar: 'verb, aorist active', contextNote: 'Matthew 1 repeats the aorist to mark each generation as a completed link in the line.' },
  peace: { original: 'εἰρήνη', translit: 'eirēnē', lang: 'Greek', strongs: 'G1515', lemma: 'εἰρήνη', meaning: 'peace, harmony, tranquility, security', grammar: 'noun, feminine', contextNote: 'Philippians 4:7 describes a peace that guards, a military image of protection.' },
  light: { original: 'אוֹר', translit: 'ʾôr', lang: 'Hebrew', strongs: 'H216', lemma: 'אוֹר', meaning: 'light, illumination, daylight', grammar: 'noun, common', contextNote: 'Genesis 1:3: light is created before the sun, emphasizing God as its source.' },
};

export const COMMENTARY = {
  'MAT:1': [
    { source: 'Matthew Henry\'s Commentary (public domain)', tradition: 'Reformed / Nonconformist', text: 'The genealogy of Christ is given to show that he came of the stock of Abraham, to whom the promise was made, and of David, in whom the kingdom was settled. Observe how the line runs through both the great and the obscure, including Tamar, Rahab, Ruth and Bathsheba, showing that grace does not run in the blood.' },
    { source: 'Jamieson, Fausset & Brown (public domain)', tradition: 'Evangelical', text: 'Three groups of fourteen generations: from Abraham to David, from David to the captivity, and from the captivity to Christ. The arrangement is a memory aid and a theological statement that history moves toward the Messiah.' },
  ],
  'JHN:3': [
    { source: 'Matthew Henry\'s Commentary (public domain)', tradition: 'Reformed / Nonconformist', text: 'Nicodemus came by night, perhaps from fear, perhaps for quiet. Christ meets his curiosity with the one necessity: a new birth from above, a change not of outward religion but of the whole person.' },
  ],
  'PSA:23': [
    { source: 'Charles Spurgeon, Treasury of David (public domain)', tradition: 'Baptist', text: 'The position of this Psalm is worthy of notice: it follows the twenty-second, which is the Psalm of the Cross. There are no green pastures until we have passed through the valley of the shadow of the Cross.' },
  ],
  'PHP:4': [
    { source: 'Matthew Henry\'s Commentary (public domain)', tradition: 'Reformed / Nonconformist', text: 'The remedy for anxiety is prayer with thanksgiving. We cannot be careful for nothing unless we are prayerful in everything.' },
  ],
};

export const CROSS_REFS = {
  'MAT:1': [{ ref: 'Luke 3:23-38', why: 'Luke\'s genealogy, traced through Nathan rather than Solomon.' }, { ref: 'Genesis 22:18', why: 'The promise to Abraham that all nations would be blessed through his seed.' }, { ref: 'Isaiah 7:14', why: 'The Emmanuel prophecy quoted in verse 23.' }],
  'JHN:3': [{ ref: 'Numbers 21:8-9', why: 'The bronze serpent lifted up in the wilderness.' }, { ref: 'Romans 5:8', why: 'God demonstrates his love while we were sinners.' }],
  'PSA:23': [{ ref: 'John 10:11', why: 'Jesus as the good shepherd.' }, { ref: 'Ezekiel 34:11-16', why: 'God himself will search for his sheep.' }],
  'PHP:4': [{ ref: 'Matthew 6:25-34', why: 'Do not be anxious about tomorrow.' }, { ref: '1 Peter 5:7', why: 'Cast all your anxiety on him.' }],
  'GEN:1': [{ ref: 'John 1:1-5', why: 'The Word present at creation; light shining in darkness.' }],
  'ROM:8': [{ ref: 'John 3:17-18', why: 'Not condemned for those who believe.' }],
};

export const VERSE_OF_DAY = { bookId: 'PHP', chapter: 4, verse: 6, reflection: 'What is one request you can hand over to God today, with thanks attached?', prayer: 'Lord, I bring my worries to you. Keep my heart and mind in your peace.' };
