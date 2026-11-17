// Builds the "Beyond the 66" library (deuterocanonical & extra-biblical books) from the Scrollmapper
// project (github.com/scrollmapper/bible_databases_deuterocanonical), pinned to one commit.
//
// Only texts in PUBLIC-DOMAIN translations are included (KJV Apocrypha 1611, R. H. Charles, Ante-Nicene
// Fathers, Lost Books of the Bible 1926, etc.). Texts in modern copyrighted translations (Dead Sea Scrolls
// renderings, Gad the Seer 2015, Testament of Job, Apocalypse of Elijah, …) are deliberately left out.
//
//   node scripts/gen_extra_books.mjs
// writes:
//   backend/public/extra-books/<id>.json   one file per book: { id, name, chapters: [{ n, verses: [[number, text], …] }] }
//     (the original chapter and verse numbers are kept — some books have a chapter 0 preface, start at
//      chapter 10 (Additions to Esther) or skip a verse — so references match printed editions)
//   src/data/extraBooks.js                 the catalogue the app shows (no text, just names and counts)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMMIT = '271173ef8be658239edcb4fc753cd39d2b2731d3';
const RAW = `https://raw.githubusercontent.com/scrollmapper/bible_databases_deuterocanonical/${COMMIT}/sources/en`;
const OUT = path.join(ROOT, 'backend', 'public', 'extra-books');
const CATALOGUE = path.join(ROOT, 'src', 'data', 'extraBooks.js');

const KJVA = 'King James Version Apocrypha (1611)';
const CHARLES = 'R. H. Charles et al., Apocrypha and Pseudepigrapha (1913)';
const T12 = 'R. H. Charles, Testaments of the Twelve Patriarchs (1908)';
const LOST = 'The Lost Books of the Bible (1926)';
const ANF = 'Ante-Nicene Fathers (1886)';

// id, Scrollmapper slug, display name, collection, translation, one-line note
const BOOKS = [
  // ---- Deuterocanonical: in Catholic and Orthodox Bibles (the "Apocrypha" of the 1611 KJV) ----
  ['TOB', 'book-of-tobit', 'Tobit', 'deutero', KJVA, 'A faithful family in exile, the angel Raphael and God’s care.'],
  ['JDT', 'book-of-judith', 'Judith', 'deutero', KJVA, 'A widow’s courage saves her people.'],
  ['ESG', 'greek-esther', 'Additions to Esther', 'deutero', KJVA, 'The Greek additions, including the prayers of Mordecai and Esther.'],
  ['WIS', 'wisdom-of-solomon', 'Wisdom of Solomon', 'deutero', KJVA, 'Wisdom, righteousness and the hope of immortality.'],
  ['SIR', 'book-of-sirach', 'Sirach (Ecclesiasticus)', 'deutero', KJVA, 'Proverbs and counsel from Jesus son of Sirach.'],
  ['BAR', '1-baruch', 'Baruch', 'deutero', KJVA, 'Confession and hope from Jeremiah’s scribe.'],
  ['AZA', 'azar', 'Prayer of Azariah & Song of the Three', 'deutero', KJVA, 'The prayer and hymn from the fiery furnace (Daniel 3).'],
  ['SUS', 'susanna', 'Susanna', 'deutero', KJVA, 'Daniel defends an innocent woman.'],
  ['BEL', 'bel-and-the-dragon', 'Bel and the Dragon', 'deutero', KJVA, 'Daniel exposes the idols of Babylon.'],
  ['1MA', '1-maccabees', '1 Maccabees', 'deutero', KJVA, 'The Maccabean revolt and the rededication of the Temple.'],
  ['2MA', '2-maccabees', '2 Maccabees', 'deutero', KJVA, 'Martyrs, miracles and the defence of the faith.'],
  ['1ES', '1-esdras', '1 Esdras', 'deutero', KJVA, 'The return from exile and the rebuilding of the Temple.'],
  ['2ES', '2-esdras', '2 Esdras', 'deutero', KJVA, 'Ezra’s visions of judgement and the end of the age.'],
  ['MAN', 'prayer-of-manasseh', 'Prayer of Manasseh', 'deutero', KJVA, 'A king’s prayer of repentance.'],

  // ---- Old Testament pseudepigrapha: ancient Jewish writings outside the canon ----
  ['1EN', '1-enoch', '1 Enoch', 'pseudo', 'R. H. Charles (1917)', 'Quoted in Jude 14–15; in the Ethiopian Orthodox Bible.'],
  ['2EN', '2-enoch', '2 Enoch (Secrets of Enoch)', 'pseudo', 'W. R. Morfill & R. H. Charles (1896)', 'Enoch’s journey through the heavens.'],
  ['JUB', 'book-of-jubilees', 'Jubilees', 'pseudo', 'R. H. Charles (1917)', 'Genesis retold in jubilee periods; in the Ethiopian Orthodox Bible.'],
  ['JSH', 'book-of-jasher', 'Jasher', 'pseudo', 'J. H. Parry & Co. (1887)', 'A retelling from Creation to the Judges (named in Joshua 10:13).'],
  ['TRU', 'testament-of-reuben', 'Testament of Reuben', 'testaments', T12, 'On pride and purity.'],
  ['TSI', 'testament-of-simeon', 'Testament of Simeon', 'testaments', T12, 'On envy.'],
  ['TLE', 'testament-of-levi', 'Testament of Levi', 'testaments', T12, 'On priesthood and the heavens.'],
  ['TJU', 'testament-of-judah', 'Testament of Judah', 'testaments', T12, 'On courage, greed and kingship.'],
  ['TIS', 'testament-of-issachar', 'Testament of Issachar', 'testaments', T12, 'On simplicity of heart.'],
  ['TZE', 'testament-of-zebulun', 'Testament of Zebulun', 'testaments', T12, 'On compassion and mercy.'],
  ['TDA', 'testament-of-dan', 'Testament of Dan', 'testaments', T12, 'On anger and lying.'],
  ['TNA', 'testament-of-naphtali', 'Testament of Naphtali', 'testaments', T12, 'On natural goodness.'],
  ['TGA', 'testament-of-gad', 'Testament of Gad', 'testaments', T12, 'On hatred.'],
  ['TAS', 'testament-of-asher', 'Testament of Asher', 'testaments', T12, 'On the two ways.'],
  ['TJO', 'testament-of-joseph', 'Testament of Joseph', 'testaments', T12, 'On self-control and forgiveness.'],
  ['TBE', 'testament-of-benjamin', 'Testament of Benjamin', 'testaments', T12, 'On a pure mind.'],
  ['PSS', 'psalms-of-solomon', 'Psalms of Solomon', 'pseudo', 'G. B. Gray in R. H. Charles (1913)', 'Eighteen psalms of longing for the Messiah.'],
  ['ODE', 'odes-of-solomon', 'Odes of Solomon', 'pseudo', 'J. Rendel Harris (1911)', 'An early Christian hymnbook.'],
  ['PS151', 'five-psalms-of-david', 'Five Psalms of David (Psalms 151–155)', 'pseudo', 'W. Wright (1887)', 'Psalm 151 is in Orthodox Bibles.'],
  ['ASI', 'ascension-of-isaiah', 'Ascension of Isaiah', 'pseudo', 'R. H. Charles (1900)', 'Isaiah’s martyrdom and vision of the seven heavens.'],
  ['TMO', 'assumption-of-moses', 'Testament of Moses', 'pseudo', 'R. H. Charles (1897)', 'Moses’ farewell words to Joshua (compare Jude 9).'],
  ['2BA', '2-baruch', '2 Baruch', 'pseudo', 'R. H. Charles (1896)', 'Baruch’s visions after the fall of Jerusalem.'],
  ['3BA', '3-baruch', '3 Baruch', 'pseudo', 'H. M. Hughes in R. H. Charles (1913)', 'Baruch is shown the five heavens.'],
  ['4BA', '4-baruch', '4 Baruch (Rest of the Words of Baruch)', 'pseudo', ANF, 'Jeremiah, Baruch and Abimelech in the exile.'],
  ['TAB', 'testament-of-abraham', 'Testament of Abraham', 'pseudo', ANF, 'Abraham’s heavenly journey before his death.'],
  ['APA', 'apocalypse-of-abraham', 'Apocalypse of Abraham', 'pseudo', 'G. H. Box (1919)', 'Abraham turns from idols and sees heavenly visions.'],
  ['TSO', 'testament-of-solomon', 'Testament of Solomon', 'pseudo', 'F. C. Conybeare (1898)', 'Solomon, the Temple and the spirits he bound.'],
  ['JAS', 'joseph-and-asenath', 'Joseph and Asenath', 'pseudo', 'E. W. Brooks (1918)', 'The conversion of Joseph’s Egyptian wife.'],
  ['AHI', 'wisdom-of-ahikar', 'Wisdom of Ahikar', 'pseudo', 'Conybeare, Harris & Lewis (1913)', 'Proverbs of a wise counsellor (named in Tobit).'],
  ['1AE', '1-adam-and-eve', '1 Adam and Eve', 'pseudo', 'S. C. Malan (1882)', 'Adam and Eve’s life after Eden.'],
  ['2AE', '2-adam-and-eve', '2 Adam and Eve', 'pseudo', 'S. C. Malan (1882)', 'Their descendants to the time of Enoch.'],
  ['REC', 'history-of-the-rechabites', 'History of the Rechabites', 'pseudo', ANF, 'Zosimus visits the blessed Rechabites.'],
  ['SED', 'apocalypse-of-sedrach', 'Apocalypse of Sedrach', 'pseudo', ANF, 'On love, and Sedrach’s dialogue with God.'],

  // ---- Early Christian writings: read by the early church, outside the New Testament ----
  ['1HE', '1-hermas', 'Shepherd of Hermas: Visions', 'christian', LOST, 'Visions given to Hermas, a Roman Christian.'],
  ['2HE', '2-hermas', 'Shepherd of Hermas: Commands', 'christian', LOST, 'The twelve commandments of the Shepherd.'],
  ['3HE', '3-hermas', 'Shepherd of Hermas: Similitudes', 'christian', LOST, 'Parables of the Shepherd.'],
  ['BARN', 'epistle-of-barnabas', 'Epistle of Barnabas', 'christian', LOST, 'An early letter on Christ and the Scriptures.'],
  ['NIC', 'gospel-of-nicodemus', 'Gospel of Nicodemus (Acts of Pilate)', 'christian', LOST, 'Christ’s trial and the descent into hell.'],
  ['APE', 'apocalypse-of-peter', 'Apocalypse of Peter', 'christian', 'M. R. James (1924)', 'Visions of heaven and hell given to Peter.'],
];

const COLLECTIONS = [
  { id: 'deutero', name: 'Deuterocanonical books', note: 'In Catholic and Orthodox Bibles, and the Apocrypha of the original 1611 King James Bible.' },
  { id: 'pseudo', name: 'Ancient Jewish writings', note: 'Writings from before and around the time of Jesus. 1 Enoch and Jubilees are in the Ethiopian Orthodox Bible.' },
  { id: 'testaments', name: 'Testaments of the Twelve Patriarchs', note: 'The farewell words of Jacob’s twelve sons.' },
  { id: 'christian', name: 'Early Christian writings', note: 'Read by the early church but not part of the New Testament.' },
];

const tidy = (s) => String(s || '')
  .replace(/\*\*\[\d+:\d+\]\*\*/g, '')
  .replace(/\*\*|__/g, '')
  .replace(/[ \t]*\n[ \t]*/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

fs.mkdirSync(OUT, { recursive: true });
const cat = [];
let totalVerses = 0;
let totalBytes = 0;
for (const [id, slug, name, collection, translation, note] of BOOKS) {
  // eslint-disable-next-line no-await-in-loop
  const res = await fetch(`${RAW}/${slug}/${slug}.json`);
  if (!res.ok) throw new Error(`${slug}: HTTP ${res.status}`);
  // eslint-disable-next-line no-await-in-loop
  const data = await res.json();
  const chapters = [];
  for (const b of data.books || []) {
    for (const c of b.chapters || []) {
      // a few source verses carry the next verse inside them ("… heart. *[70:3] And they …"): split those out
      const verses = [];
      for (const v of c.verses || []) {
        // split() with two capture groups gives [text, chapter, verse, text, chapter, verse, text, …]
        const parts = String(v.text || '').split(/\*{0,2}\[(\d+):(\d+)\]\*{0,2}/);
        verses.push([Number(v.verse) || 0, tidy(parts[0])]);
        for (let i = 1; i + 2 < parts.length; i += 3) verses.push([Number(parts[i + 1]), tidy(parts[i + 2])]);
      }
      for (let i = verses.length - 1; i >= 0; i--) if (!verses[i][1]) verses.splice(i, 1);
      if (verses.length) chapters.push({ n: Number(c.chapter) || 0, verses });
    }
  }
  if (!chapters.length) throw new Error(`${slug}: no text`);
  const verses = chapters.reduce((n, c) => n + c.verses.length, 0);
  totalVerses += verses;
  const json = JSON.stringify({ id, name, translation, source: `scrollmapper/${slug}`, chapters });
  totalBytes += json.length;
  fs.writeFileSync(path.join(OUT, `${id}.json`), json);
  cat.push({ id, name, collection, translation, note, chapters: chapters.map((c) => c.n), verses });
  console.log(id.padEnd(6), String(chapters.length).padStart(3), 'ch', String(verses).padStart(5), 'v', name);
}

const header = `// GENERATED by scripts/gen_extra_books.mjs from github.com/scrollmapper/bible_databases_deuterocanonical
// (commit ${COMMIT.slice(0, 7)}). Do not edit by hand. Public-domain translations only.
// The text of each book is served by the API at /extra-books/<id>.json and cached on the device.
`;
fs.writeFileSync(CATALOGUE, `${header}
export const EXTRA_COLLECTIONS = ${JSON.stringify(COLLECTIONS, null, 2)};

// chapters = the chapter numbers in reading order
export const EXTRA_BOOKS = ${JSON.stringify(cat)};

export const extraBook = (id) => EXTRA_BOOKS.find((b) => b.id === id) || null;
`);
console.log(`\n${cat.length} books, ${totalVerses} verses, ${(totalBytes / 1024 / 1024).toFixed(1)} MB of text`);
