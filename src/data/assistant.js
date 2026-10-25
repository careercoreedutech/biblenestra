// Local, grounded responders for Bible Chat and Scripture Companion.
// Every answer is built only from passages, commentary and cross-references in the catalog,
// labelled by type (Scripture / Explanation / Commentary / Interpretations / Further study).
// Replace `answerBibleChat` and `companionResults` with a backend call (OpenAI Responses API
// + retrieval, spec §1.7.3) that returns the same shape.

import { COMMENTARY, CROSS_REFS, CHAPTER_TITLES, TEXT, WORD_STUDY, refLabel, searchBible } from './bible';

function verseText(bookId, chapter, verse, translation = 'KJV') {
  const ch = (TEXT[translation] || TEXT.KJV)[`${bookId}:${chapter}`];
  return ch ? ch[verse - 1] : null;
}

const TOPIC_PASSAGES = {
  anxious: [{ bookId: 'PHP', chapter: 4, verses: [6, 7], why: 'Paul gives a direct instruction for anxiety: bring every request to God, and he describes the peace that follows.' }, { bookId: 'PSA', chapter: 23, verses: [4], why: 'A psalm for walking through dark places with God present.' }],
  worry: 'anxious', fear: 'anxious', afraid: 'anxious', stress: 'anxious',
  grief: [{ bookId: 'PSA', chapter: 23, verses: [1, 2, 3, 4], why: 'The shepherd psalm has been read at bedsides and gravesides for centuries; it names the valley without pretending it away.' }, { bookId: 'JHN', chapter: 3, verses: [16], why: 'A reminder of the kind of love God has for the world, including the grieving.' }],
  loss: 'grief', lost: 'grief', sad: 'grief', mourning: 'grief', death: 'grief',
  decision: [{ bookId: 'PHP', chapter: 4, verses: [6, 7], why: 'Decisions are a form of request; this passage invites you to pray them rather than carry them alone.' }, { bookId: 'PSA', chapter: 23, verses: [3], why: 'He leads in right paths. Guidance is part of what a shepherd does.' }],
  job: 'decision', work: 'decision', career: 'decision', choose: 'decision', wisdom: 'decision',
  forgive: [{ bookId: 'ROM', chapter: 8, verses: [1], why: 'Forgiveness starts with knowing you are not condemned.' }, { bookId: 'JHN', chapter: 3, verses: [17], why: 'God\'s purpose was to save, not condemn.' }],
  guilt: 'forgive', shame: 'forgive', condemn: 'forgive',
  doubt: [{ bookId: 'JHN', chapter: 3, verses: [1, 2, 3, 9, 10], why: 'Nicodemus came with honest questions at night. Jesus engaged them.' }, { bookId: 'ROM', chapter: 8, verses: [1, 2], why: 'Assurance for those in Christ.' }],
  faith: 'doubt', believe: 'doubt', question: 'doubt',
  hope: [{ bookId: 'ROM', chapter: 8, verses: [1, 2], why: 'Freedom and life in the Spirit.' }, { bookId: 'PHP', chapter: 4, verses: [4, 13], why: 'Rejoicing and strength that do not depend on circumstances.' }],
  strength: 'hope', tired: 'hope', weak: 'hope', encourage: 'hope',
  marriage: [{ bookId: 'PHP', chapter: 4, verses: [2, 5], why: 'Paul urges two believers to be of one mind and to let gentleness be known.' }, { bookId: 'GEN', chapter: 1, verses: [1], why: 'Creation as the beginning of every covenant.' }],
  family: 'marriage', conflict: 'marriage', relationship: 'marriage',
};

function resolveTopic(text) {
  const t = text.toLowerCase();
  for (const key of Object.keys(TOPIC_PASSAGES)) {
    if (t.includes(key)) {
      let v = TOPIC_PASSAGES[key];
      if (typeof v === 'string') v = TOPIC_PASSAGES[v];
      return { key, passages: v };
    }
  }
  return { key: null, passages: TOPIC_PASSAGES.hope };
}

const CRISIS = ['suicide', 'kill myself', 'end my life', 'self-harm', 'hurt myself', 'abuse', 'abusing', 'overdose', 'emergency'];

export function companionResults(message, translation = 'KJV') {
  const lower = message.toLowerCase();
  const crisis = CRISIS.some((w) => lower.includes(w));
  const { key, passages } = resolveTopic(message);
  const results = passages.map((p) => ({
    ref: `${refLabel(p.bookId, p.chapter)}:${p.verses[0]}${p.verses.length > 1 ? '-' + p.verses[p.verses.length - 1] : ''}`,
    bookId: p.bookId, chapter: p.chapter, verses: p.verses, translation,
    text: p.verses.map((v) => verseText(p.bookId, p.chapter, v, translation)).filter(Boolean).join(' '),
    why: p.why,
  }));
  return {
    crisis,
    acknowledgment: crisis
      ? 'Thank you for telling me. What you are carrying sounds heavy, and you should not carry it alone right now.'
      : key
        ? 'Thank you for sharing that. Here are a few passages that others have found helpful in a similar place. They may not speak to every part of your situation.'
        : 'Thank you for sharing. Here are a few passages about hope and strength that may be a starting point.',
    passages: results,
    reflections: ['Which line in these passages feels closest to where you are?', 'What would it look like to bring this to God as a request today?'],
    nextSteps: ['Continue in Bible Chat', 'Save these passages', 'Record a private reflection', 'Find a community', 'Talk to a trusted person'],
  };
}

export function answerBibleChat(question, context, translation = 'KJV') {
  const q = question.toLowerCase();
  const blocks = [];
  const key = context ? `${context.bookId}:${context.chapter}` : null;

  // Word study request
  const word = Object.keys(WORD_STUDY).find((w) => q.includes(w));
  if (word && (q.includes('mean') || q.includes('word') || q.includes('greek') || q.includes('hebrew') || q.includes('original'))) {
    const w = WORD_STUDY[word];
    blocks.push({ type: 'Explanation', text: `"${word}" in the original ${w.lang} is ${w.original} (${w.translit}, ${w.strongs}). Lexical range: ${w.meaning}. Grammar: ${w.grammar}.` });
    blocks.push({ type: 'Explanation', text: `In context: ${w.contextNote}` });
    blocks.push({ type: 'Further study', text: 'Open the Word Study panel on this passage to see every occurrence of the lemma.' });
    return blocks;
  }

  // Topic search ("which passages discuss ...")
  if (q.startsWith('which') || q.includes('passages') || q.includes('where does the bible')) {
    const term = q.replace(/which passages (discuss|talk about|mention)?|where does the bible (say|talk) about|passages about|\?/g, '').trim().split(' ').pop();
    const hits = searchBible(term, translation).slice(0, 4);
    if (hits.length) {
      hits.forEach((h) => blocks.push({ type: 'Scripture', ref: refLabel(h.bookId, h.chapter, h.verse), bookId: h.bookId, chapter: h.chapter, verse: h.verse, text: h.text, translation }));
      blocks.push({ type: 'Further study', text: `Search the concordance for "${term}" to see every occurrence in ${translation}.` });
      return blocks;
    }
  }

  // Passage-anchored answers
  if (context && key) {
    const verses = (TEXT[translation] || TEXT.KJV)[key] || [];
    const vmatch = q.match(/verse (\d+)|v(\d+)|:(\d+)/);
    const vnum = vmatch ? Number(vmatch[1] || vmatch[2] || vmatch[3]) : null;
    if (q.includes('summar') || q.includes('too long')) {
      blocks.push({ type: 'Explanation', text: `${CHAPTER_TITLES[key] || refLabel(context.bookId, context.chapter)} in brief: ${summaries[key] || 'This chapter contains ' + verses.length + ' verses.'}` });
    } else if (q.includes('today') || q.includes('simple') || q.includes('plain') || q.includes('language')) {
      const v = vnum && verses[vnum - 1] ? verses[vnum - 1] : verses[0];
      blocks.push({ type: 'Scripture', ref: refLabel(context.bookId, context.chapter, vnum || 1), bookId: context.bookId, chapter: context.chapter, verse: vnum || 1, text: v, translation });
      blocks.push({ type: 'Explanation', text: plain[key] || 'In plain terms: ' + v });
      blocks.push({ type: 'Further study', text: 'Compare with the World English Bible (WEB) for a modern-language rendering.' });
    } else if (q.includes('hidden') || q.includes('meaning') || q.includes('why')) {
      (COMMENTARY[key] || []).forEach((c) => blocks.push({ type: 'Commentary', source: c.source, tradition: c.tradition, text: c.text }));
      if (interpretations[key]) blocks.push({ type: 'Interpretations', text: interpretations[key] });
      if (!blocks.length) blocks.push({ type: 'Explanation', text: 'No licensed commentary is loaded for this chapter yet. Cross-references are listed below.' });
      (CROSS_REFS[key] || []).forEach((x) => blocks.push({ type: 'Further study', text: `${x.ref}: ${x.why}` }));
    } else if (q.includes('apply') || q.includes('now what') || q.includes('life')) {
      blocks.push({ type: 'Explanation', text: applications[key] || 'Read the chapter slowly and note one instruction, one promise, and one example to follow.' });
      blocks.push({ type: 'Further study', text: 'Create a private study note or add this chapter to a reading plan.' });
    } else if (vnum && verses[vnum - 1]) {
      blocks.push({ type: 'Scripture', ref: refLabel(context.bookId, context.chapter, vnum), bookId: context.bookId, chapter: context.chapter, verse: vnum, text: verses[vnum - 1], translation });
      (COMMENTARY[key] || []).slice(0, 1).forEach((c) => blocks.push({ type: 'Commentary', source: c.source, tradition: c.tradition, text: c.text }));
    } else {
      blocks.push({ type: 'Explanation', text: `You are reading ${CHAPTER_TITLES[key] || refLabel(context.bookId, context.chapter)}. ${summaries[key] || ''}` });
      (COMMENTARY[key] || []).slice(0, 1).forEach((c) => blocks.push({ type: 'Commentary', source: c.source, tradition: c.tradition, text: c.text }));
      blocks.push({ type: 'Further study', text: 'Try: "Summarize", "Explain verse 16 in today\'s language", "What does begat mean in Greek?"' });
    }
    return blocks;
  }

  // No context: general
  const hits = searchBible(q.split(' ').filter((w) => w.length > 4)[0] || 'love', translation).slice(0, 3);
  if (hits.length) {
    blocks.push({ type: 'Explanation', text: 'Here are passages related to your question. Open one to make it the context for this conversation.' });
    hits.forEach((h) => blocks.push({ type: 'Scripture', ref: refLabel(h.bookId, h.chapter, h.verse), bookId: h.bookId, chapter: h.chapter, verse: h.verse, text: h.text, translation }));
  } else {
    blocks.push({ type: 'Explanation', text: 'I can only answer from passages and commentary in your library. Try opening a chapter first, or ask "which passages discuss peace?".' });
  }
  return blocks;
}

const summaries = {
  'MAT:1': 'Matthew opens with a genealogy in three sets of fourteen generations (Abraham to David, David to the exile, the exile to Christ), then tells of Jesus\' birth: Mary found with child by the Holy Spirit, Joseph reassured by an angel, and the name Jesus ("he shall save his people from their sins") alongside Emmanuel, "God with us".',
  'JHN:3': 'Nicodemus visits Jesus by night. Jesus tells him he must be born again, of water and the Spirit. The chapter climaxes in John 3:16: God loved the world and gave his Son so that believers would not perish.',
  'PSA:23': 'David describes the Lord as a shepherd who provides rest, guidance, protection in the darkest valley, and a table of abundance, ending with the promise of dwelling in God\'s house forever.',
  'GEN:1': 'God creates the heavens and the earth, speaking light into being on the first day.',
  'PHP:4': 'Paul urges unity, rejoicing, prayer instead of anxiety, right thinking, and contentment in every circumstance through Christ who strengthens him.',
  'ROM:8': 'No condemnation for those in Christ; the law of the Spirit of life sets us free.',
};
const plain = {
  'MAT:1': 'In today\'s language: this is Jesus\' family tree, listed to show he descends from Abraham and King David, exactly as the promises said the Messiah would.',
  'JHN:3': 'In today\'s language: a religious leader comes to Jesus privately. Jesus says the only way into God\'s kingdom is a brand-new start that only God\'s Spirit can give.',
  'PSA:23': 'In today\'s language: God looks after me like a shepherd looks after sheep. I have what I need, I can rest, and even in the worst places I am not alone.',
  'PHP:4': 'In today\'s language: do not let worry run you. Tell God what you need, say thank you, and his peace will stand guard over you.',
  'GEN:1': 'In today\'s language: at the very beginning God made everything, and the first thing he spoke into being was light.',
  'ROM:8': 'In today\'s language: if you belong to Christ, you are not under judgment. The Spirit has set you free.',
};
const interpretations = {
  'MAT:1': 'Christians read the four women in the genealogy differently: some see them as examples of Gentile inclusion, others as examples of irregular circumstances through which God still worked. Both readings are common.',
  'JHN:3': '"Born of water and the Spirit" is read by some traditions as a reference to baptism, by others as natural birth followed by spiritual birth, and by others as a single cleansing-and-renewing work of the Spirit (echoing Ezekiel 36).',
  'PSA:23': 'Some read the "house of the LORD" as the temple and this life; others as eternal life with God. The psalm supports both readings.',
};
const applications = {
  'MAT:1': 'Your story, with its irregularities, can still be part of what God is doing. Note one place where God has worked through something unexpected in your life.',
  'JHN:3': 'Bring your real questions to Jesus, even at night. Write one honest question as a private note today.',
  'PSA:23': 'Name the valley you are in. Then name one way God has provided this week.',
  'PHP:4': 'Turn one worry into one prayer with thanks attached. Try it right now in the Prayer tab.',
  'GEN:1': 'Begin something today by asking God to speak light into it.',
  'ROM:8': 'If you are carrying condemnation, verse 1 is addressed to you.',
};
