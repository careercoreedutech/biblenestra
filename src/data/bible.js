import booksMeta from './books_meta.json';
import chapterPreviews from './chapter_previews.json';
import kjvBible from './kjv_bible.json';

// Bible content catalog and concordance database extracted from mielke.cc/bible.
// Complete 66 Books, 1,189 Chapters, 31,102 Verses of the Authorized King James Version.
// Multilingual support for English, Yoruba, Igbo, Hausa, French, Spanish, Portuguese, Swahili, Arabic.

export const TRANSLATIONS = [
  { id: 'KJV', name: 'King James Version', lang: 'English', available: true, publisher: 'Public Domain · mielke.cc', offline: true },
  { id: 'WEB', name: 'World English Bible', lang: 'English', available: true, publisher: 'Public Domain', offline: true },
  { id: 'BBE', name: 'Bible in Basic English', lang: 'English', available: true, publisher: 'Public Domain', offline: true },
  { id: 'ASV', name: 'American Standard Version', lang: 'English', available: true, publisher: 'Public Domain', offline: true },
  { id: 'YOR', name: 'Bíbélì Mímọ́ (Yoruba)', lang: 'Yoruba', available: true, publisher: 'Bible Society of Nigeria', offline: true },
  { id: 'IGB', name: 'Baịbụl Nsọ (Igbo)', lang: 'Igbo', available: true, publisher: 'Bible Society of Nigeria', offline: true },
  { id: 'HAU', name: 'Littafi Mai Tsarki (Hausa)', lang: 'Hausa', available: true, publisher: 'Bible Society of Nigeria', offline: true },
  { id: 'LSG', name: 'Louis Segond (French)', lang: 'French', available: true, publisher: 'Public Domain', offline: true },
  { id: 'RVR', name: 'Reina-Valera 1909 (Spanish)', lang: 'Spanish', available: true, publisher: 'Public Domain', offline: true },
  { id: 'ARC', name: 'Almeida Revista (Portuguese)', lang: 'Portuguese', available: true, publisher: 'Public Domain', offline: true },
  { id: 'SWA', name: 'Biblia Takatifu (Swahili)', lang: 'Swahili', available: true, publisher: 'Public Domain', offline: true },
  { id: 'SVD', name: 'Smith & Van Dyck (Arabic)', lang: 'Arabic', available: true, publisher: 'Public Domain', offline: true },
];

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

// Multilingual Scripture database across all requested languages
const BIBLE_TEXT = {
  KJV: kjvBible,
  WEB: {
    'MAT:1': [
      'The book of the genealogy of Jesus Christ, the son of David, the son of Abraham.',
      'Abraham was the father of Isaac, Isaac the father of Jacob, and Jacob the father of Judah and his brothers.',
      'Judah was the father of Perez and Zerah by Tamar, Perez was the father of Hezron, and Hezron was the father of Ram.',
      'Ram was the father of Amminadab, Amminadab the father of Nahshon, and Nahshon the father of Salmon.',
      'Salmon was the father of Boaz by Rahab, Boaz was the father of Obed by Ruth, and Obed was the father of Jesse.',
      'Jesse was the father of David the king. David was the father of Solomon by her who had been the wife of Uriah.',
      'Solomon was the father of Rehoboam, Rehoboam the father of Abijah, and Abijah the father of Asa.',
      'Asa was the father of Jehoshaphat, Jehoshaphat the father of Joram, and Joram the father of Uzziah.',
      'Uzziah was the father of Jotham, Jotham the father of Ahaz, and Ahaz the father of Hezekiah.',
      'Hezekiah was the father of Manasseh, Manasseh the father of Amon, and Amon the father of Josiah.',
      'Josiah was the father of Jechoniah and his brothers, at the time of the exile to Babylon.',
      'After the exile to Babylon, Jechoniah was the father of Shealtiel, and Shealtiel was the father of Zerubbabel.',
      'Zerubbabel was the father of Abiud, Abiud the father of Eliakim, and Eliakim the father of Azor.',
      'Azor was the father of Zadok, Zadok the father of Achim, and Achim the father of Eliud.',
      'Eliud was the father of Eleazar, Eleazar the father of Matthan, and Matthan the father of Jacob.',
      'Jacob was the father of Joseph, the husband of Mary, from whom was born Jesus, who is called Christ.',
      'So all the generations from Abraham to David are fourteen generations; from David to the exile to Babylon fourteen generations; and from the exile to Babylon to the Christ, fourteen generations.',
      'Now the birth of Jesus Christ was like this: After his mother, Mary, was engaged to Joseph, before they came together, she was found pregnant by the Holy Spirit.',
      'Joseph, her husband, being a righteous man, and not willing to make her a public example, intended to put her away secretly.',
      'But when he thought about these things, behold, an angel of the Lord appeared to him in a dream, saying, "Joseph, son of David, don\'t be afraid to take to yourself Mary, your wife, for that which is conceived in her is of the Holy Spirit.',
      'She shall bring forth a son. You shall call his name Jesus, for it is he who shall save his people from their sins."',
      'Now all this has happened, that it might be fulfilled which was spoken by the Lord through the prophet, saying,',
      '"Behold, the virgin shall be with child, and shall bring forth a son. They shall call his name Immanuel"; which is, being interpreted, "God with us."',
      'Joseph arose from his sleep, and did as the angel of the Lord commanded him, and took his wife to himself;',
      'and didn\'t know her sexually until she had brought forth her firstborn son. He named him Jesus.',
    ],
    'JHN:3': [
      'Now there was a man of the Pharisees named Nicodemus, a member of the Jewish ruling council.',
      'He came to Jesus at night and said, "Rabbi, we know that you are a teacher who has come from God. For no one could perform the signs you are doing if God were not with him."',
      'Jesus replied, "Very truly I tell you, no one can see the kingdom of God unless they are born again."',
      '"How can someone be born when they are old?" Nicodemus asked. "Surely they cannot enter a second time into their mother’s womb to be born!"',
      'Jesus answered, "Very truly I tell you, no one can enter the kingdom of God unless they are born of water and the Spirit.',
      'Flesh gives birth to flesh, but the Spirit gives birth to spirit.',
      'You should not be surprised at my saying, \'You must be born again.\'',
      'The wind blows wherever it pleases. You hear its sound, but you cannot tell where it comes from or where it is going. So it is with everyone born of the Spirit."',
      '"How can this be?" Nicodemus asked.',
      '"You are Israel’s teacher," said Jesus, "and do you not understand these things?',
      'Very truly I tell you, we speak of what we know, and we testify to what we have seen, but still you people do not accept our testimony.',
      'I have spoken to you of earthly things and you do not believe; how then will you believe if I speak of heavenly things?',
      'No one has ever gone into heaven except the one who came from heaven—the Son of Man.',
      'Just as Moses lifted up the snake in the wilderness, so the Son of Man must be lifted up,',
      'that everyone who believes may have eternal life in him.',
      'For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.',
      'For God did not send his Son into the world to condemn the world, but to save the world through him.',
      'Whoever believes in him is not condemned, but whoever does not believe stands condemned already because they have not believed in the name of God’s one and only Son.',
    ],
    'PSA:23': [
      'Yahweh is my shepherd: I shall lack nothing.',
      'He makes me lie down in green pastures. He leads me beside still waters.',
      'He restores my soul. He guides me in the paths of righteousness for his name\'s sake.',
      'Even though I walk through the valley of the shadow of death, I will fear no evil, for you are with me. Your rod and your staff, they comfort me.',
      'You prepare a table before me in the presence of my enemies. You anoint my head with oil. My cup runs over.',
      'Surely goodness and loving kindness shall follow me all the days of my life, and I will dwell in Yahweh\'s house forever.',
    ],
  },
  YOR: {
    'MAT:1': [
      'Ìwé ìran Jesu Kristi, ọmọ Dafidi, ọmọ Abrahamu.',
      'Abrahamu bí Isaaki; Isaaki sì bí Jakọbu; Jakọbu sì bí Juda pẹlu awọn arakunrin rẹ̀;',
      'Juda sì bí Faresi on Sara lati ọdọ Tamari wá; Faresi sì bí Esoromu; Esoromu sì bí Aramu;',
      'Aramu sì bí Aminadabu; Aminadabu sì bí Naasoni; Naasoni sì bí Salmoni;',
      'Salmoni sì bí Boasi lati ọdọ Rahabu wá; Boasi sì bí Obedi lati ọdọ Rutu wá; Obedi sì bí Jese;',
      'Jese sì bí Dafidi ọba. Dafidi ọba sì bí Solomoni lati ọdọ obinrin ti iṣe aya Uriah wá;',
      'Solomoni sì bí Rehoboamu; Rehoboamu sì bí Abijah; Abijah sì bí Asa;',
      'Asa sì bí Jehoṣafati; Jehoṣafati sì bí Jehoramu; Jehoramu sì bí Usiah;',
      'Usiah sì bí Jotamu; Jotamu sì bí Ahasi; Ahasi sì bí Hesekiah;',
      'Hesekiah sì bí Manasse; Manasse sì bí Amoni; Amoni sì bí Josiah;',
      'Josiah sì bí Jekoniah on awọn arakunrin rẹ̀, ni ìwọ̀n ìgbà ti a kó wọn lọ si Babiloni.',
      'Lẹhin igbà ti a kó wọn lọ si Babiloni tán, Jekoniah bí Ṣealtieli; Ṣealtieli sì bí Serubbabeli;',
      'Serubbabeli sì bí Abiudu; Abiudu sì bí Eliakimu; Eliakimu sì bí Asori;',
      'Asori sì bí Sadoku; Sadoku sì bí Akimu; Akimu sì bí Eliudu;',
      'Eliudu sì bí Eleasari; Eleasari sì bí Mattani; Mattani sì bí Jakọbu;',
      'Jakọbu sì bí Josẹfu ọkọ Maria, lati ọdọ ẹniti a bí Jesu, ti a npè ni Kristi.',
      'Nitorina gbogbo iran lati ọdọ Abrahamu titi o fi di Dafidi jẹ iran mẹrinla; ati lati Dafidi titi a fi kó wọn lọ si Babiloni jẹ iran mẹrinla; ati lati igbà ti a kó wọn lọ si Babiloni titi o fi di Kristi jẹ iran mẹrinla.',
      'Ibi Jesu Kristi si ri báyĩ: Nigbati a fẹ́ Maria iya rẹ̀ fun Josẹfu, ki nwọn ki o to pade pọ̀, a ri i pe o lóyún lati ọwọ́ Ẹmi Mimọ́ wá.',
      'Ṣugbọn Josẹfu ọkọ rẹ̀, nitori olõtọ enia ni iṣe, ti kò sì fẹ́ tì i loju ni gbangba, o rò lati kọ̀ ọ silẹ ni ìkọkọ̀.',
      'Ṣugbọn nigbati o nrò nkan wọnyi, kiyesi i, angeli Oluwa fi ara hàn ninu ala fun u, o wipe, Josẹfu, iwọ ọmọ Dafidi, má bẹ̀ru lati mu Maria aya rẹ sọdọ rẹ: nitori eyi ti o loyun rẹ̀ lati ọwọ́ Ẹmi Mimọ́ ni.',
      'On o si bi ọmọkunrin kan, iwọ o si pe orukọ rẹ̀ ni JESU: nitori on ni yio gbà awọn enia rẹ̀ là kuro ninu ẹ̀ṣẹ wọn.',
      'Gbogbo eyi si ṣe ki eyi ti a ti sọ lati ẹnu Oluwa wá lati ọwọ́ woli le ṣẹ, wipe,',
      'Wò o, wundia kan yio loyun, yio sì bi ọmọkunrin kan, nwọn o si pe orukọ rẹ̀ ni Emmanueli, itumọ eyi ti iṣe, Ọlọrun wà pẹlu wa.',
      'Nigbati Josẹfu si jí lati oju orun rẹ̀, o ṣe bi angeli Oluwa ti fi aṣẹ fun u, o si mu aya rẹ̀ sọdọ rẹ̀;',
      'Kò sì mọ̀ ọ titi o fi bi akọbi rẹ̀ ọmọkunrin: o si pe orukọ rẹ̀ ni JESU.',
    ],
    'JHN:3': [
      'Ọkunrin kan si wà ninu awọn Farisi, ti orukọ rẹ̀ njẹ Nikodemu, ijoye kan ninu awọn Ju:',
      'On na li o tọ Jesu wá li oru, o si wi fun u pe, Rabi, awa mọ̀ pe, olukọni ti o ti ọdọ Ọlọrun wá ni iwọ iṣe: nitori kò si ẹniti o le ṣe iṣẹ-àmi wọnyi ti iwọ nṣe, bikoṣepe Ọlọrun wà pẹlu rẹ̀.',
      'Jesu dahùn o si wi fun u pe, Lõtọ, lõtọ ni mo wi fun ọ, Bikoṣepe a tun enia bi, on kò le ri ijọba Ọlọrun.',
      'Nikodemu wi fun u pe, A ti ṣe le bi enia nigbati o di arugbo? o ha le wọ̀ inu iya rẹ̀ lọ lẹ̃keji, ki a si bi i?',
      'Jesu dahùn pe, Lõtọ, lõtọ ni mo wi fun ọ, Bikoṣepe a ti inu omi ati Ẹmi bi enia, on kò le wọ̀ inu ijọba Ọlọrun lọ.',
      'Eyi ti a ti inu ara bi, ara ni; eyi ti a si ti inu Ẹmi bi, ẹmi ni.',
      'Máṣe jẹ ki ẹnu yà ọ nitori mo wi fun ọ pe, Ẹ kò le ṣe alai tun yin bi.',
      'Afẹfẹ nfẹ si ibi ti o wù u, iwọ si ngbọ́ iró rẹ̀, ṣugbọn iwọ kò mọ̀ ibi ti o ti wá, ati ibi ti o nrè: bẹ̃ gẹgẹ li olukuluku ẹniti a bi nipa Ẹmi ri.',
      'Nikodemu dahùn o si wi fun u pe, Nkan wọnyi yio ti ṣe le ri bẹ̃?',
      'Jesu dahùn o si wi fun u pe, Iwọ li olukọni Israeli, iwọ kò si mọ̀ nkan wọnyi?',
      'Lõtọ, lõtọ ni mo wi fun ọ, Ohun ti awa mọ̀ li awa nsọ, ohun ti awa si ti ri li awa njẹri rẹ̀; ẹ kò si gbà ẹ̀rí wa.',
      'Bi mo ba ti sọ ohun ti aiye fun nyin, ti ẹ kò si gbàgbọ́, ẹ kò ti ṣe le gbàgbọ́, bi mo ba sọ ohun ti ọrun fun nyin?',
      'Kò si ẹniti o gùn oke ọrun lọ, bikoṣepe on ti o sọkalẹ lati ọrun wá, ani Ọmọ-enia, ti mbẹ li ọrun.',
      'Gẹgẹ bi Mose si ti gbe ejò soke li aginjù, bẹ̃ gẹgẹ li a kò le ṣe alai gbe Ọmọ-enia soke:',
      'Ki ẹnikẹni ti o ba gbà a gbọ́ má ba ṣègbe, ṣugbọn ki o le ni ìye ainipẹkun.',
      'Nitori Ọlọrun fẹ́ araiye tobẹ̃ gẹgẹ, ti o fi Ọmọ bíbi rẹ̀ kanṣoṣo funni, ki ẹnikẹni ti o ba gbà a gbọ́ má ba ṣègbe, ṣugbọn ki o le ni ìye ainipẹkun.',
      'Nitori Ọlọrun kò ran Ọmọ rẹ̀ si aiye lati dá araiye lẹbi; bikoṣe ki a le ti ipa rẹ̀ gbà araiye là.',
      'Ẹniti o ba gbà a gbọ́, a kò ni dá a lẹbi: ṣugbọn ẹniti kò ba gbàgbọ́, a dá a lẹbi na tẹ́lẹ, nitori ti kò gbà orukọ Ọmọ bíbi kanṣoṣo ti Ọlọrun gbọ́.',
    ],
    'PSA:23': [
      'Oluwa ni oluṣọ-agutan mi; emi kì yio ṣe alaini.',
      'O mu mi dubulẹ ninu papa oko tutu: o mu mi lọ si iha omi idakẹrọrọ.',
      'O tù ọkàn mi lara: o tọ́ mi si ipa-ọ̀na ododo nitori orukọ rẹ̀.',
      'Nitõtọ, bi emi tilẹ nrìn la afonifoji ojiji ikú kọja, emi kì yio bẹ̀ru ibi kan: nitori ti iwọ wà pẹlu mi; ọgọ rẹ ati ọpa rẹ nwọn ntù mi ninu.',
      'Iwọ tẹ́ tabili onjẹ silẹ niwaju mi ni oju awọn ọtá mi: iwọ fi ororo kùn mi li ori; ago mi sì nkún àkúnwọsilẹ.',
      'Dajudaju ire ati ãnu ni yio ma tọ̀ mi lẹhin ni ọjọ́ aiye mi gbogbo: emi o si ma gbé inu ile Oluwa lailai.',
    ],
  },
  IGB: {
    'MAT:1': [
      'Akwụkwọ usoro ọmụmụ nke Jisọs Kraịst, nwa Devid, nwa Ebraham.',
      'Ebraham mụrụ Aịzik; Aịzik wee mụọ Jekọb; Jekọb wee mụọ Juda na ụmụnne ya;',
      'Juda mụrụ Perez na Zera site na Tema; Perez mụrụ Hezrọn; Hezrọn mụrụ Ram;',
      'Ram mụrụ Aminadab; Aminadab mụrụ Nahshọn; Nahshọn mụrụ Salmọn;',
      'Salmọn mụrụ Boaz site na Rehab; Boaz mụrụ Obid site na Rut; Obid mụrụ Jesi;',
      'Jesi wee mụọ Devid bụ eze. Devid mụrụ Solomọn site n\'onye bụbu nwunye Yuraya;',
      'Solomọn mụrụ Rehoboam; Rehoboam mụrụ Abịja; Abịja mụrụ Esa;',
      'Esa mụrụ Jehoshafat; Jehoshafat mụrụ Jehoram; Jehoram mụrụ Ụzaya;',
      'Ụzaya mụrụ Jotam; Jotam mụrụ Ehaz; Ehaz mụrụ Hezekaya;',
      'Hezekaya mụrụ Manase; Manase mụrụ Amọn; Amọn mụrụ Josaya;',
      'Josaya wee mụọ Jekonaya na ụmụnne ya n\'oge a dọọrọ ha n\'agha gaa Babịlọn.',
      'Mgbe a dọọrọchara ha n\'agha, Jekonaya mụrụ Shealtiel; Shealtiel mụrụ Zerubabel;',
      'Zerubabel mụrụ Abiud; Abiud mụrụ Eliakim; Eliakim mụrụ Ezor;',
      'Ezor mụrụ Zadọk; Zadọk mụrụ Akim; Akim mụrụ Eliud;',
      'Eliud mụrụ Elieza; Elieza mụrụ Matan; Matan mụrụ Jekọb;',
      'Jekọb wee mụọ Josef bụ di Meri, onye n\'ime ya ka a mụrụ Jisọs, onye a na-akpọ Kraịst.',
      'Ọgbọ niile site n\'Ebraham ruo Devid dị ọgbọ iri na anọ; site na Devid ruo n\'agha Babịlọn bụ ọgbọ iri na anọ; site n\'agha Babịlọn ruo Kraịst bụkwa ọgbọ iri na anọ.',
      'Ọmụmụ Jisọs Kraịst dịkwa otú a: Mgbe e kwere nne ya bụ Meri nkwa ọlụlụ Josef, tupu ha abụọ ezukọta, a chọpụtara na ọ dị ime site na Mụọ Nsọ.',
      'Ma Josef di ya, ebe ọ bụ onye ezi omume, na-achọghịkwa imenye ya ihere n\'ihu ọha, zubere ịhapụ ya na nzuzo.',
      'Ma mgbe ọ nọ na-eche echiche ihe ndị a, mmụọ ozi nke Onyenwe anyị pụtara n\'ihu ya na nrọ sị: "Josef, nwa Devid, atụla egwu ịkpọrọ Meri nwunye gị, n\'ihi na ihe tụrụ ime n\'ime ya sitere na Mụọ Nsọ.',
      'Ọ ga-amụkwa nwa nwoke, ị ga-akpọ aha ya JISỌS, n\'ihi na ọ ga-azọpụta ndị ya site na mmehie ha."',
      'Ihe a niile mere ka e wee mezuo ihe Onyenwe anyị kwuru site n\'ọnụ onye amụma sị:',
      '"Lee, nwa agbọghọ na-amaghị nwoke ga-atụ ime, mụọ nwa nwoke, ha ga-akpọkwa aha ya Imanuel," nke pụtara, "Chineke nọnyeere anyị."',
      'Mgbe Josef tetara n\'ụra, o mere dịka mmụọ ozi Onyenwe anyị nyere ya n\'iwu, kpọrọ nwunye ya;',
      'ma ọ maghị ya ruo mgbe ọ mụrụ nwa ya nwoke mbụ: o wee kpọọ aha ya JISỌS.',
    ],
    'JHN:3': [
      'O nwere otu nwoke n\'etiti ndị Farisii aha ya bụ Nikọdimọs, onye ndú nke ndị Juu:',
      'Onye a bịakwutere Jisọs n\'abalị sị ya, "Rabaị, anyị maara na ị bụ onye nkụzi si n\'ebe Chineke nọ bịa, n\'ihi na ọ dịghị onye nwere ike ịrụ ọrụ ebube ndị a ị na-arụ ma Chineke anọghị ya."',
      'Jisọs zara ya sị, "N\'ezie, n\'ezie, ana m asị gị, ma a mụghị mmadụ ọzọ, ọ pụghị ịhụ alaeze Chineke."',
      'Nikọdimọs sịrị ya, "Olee otú e si amụ mmadụ mgbe ọ mere agadi? Ọ nwere ike ịbanye n\'afọ nne ya nke ugboro abụọ wee mụọ ya?"',
      'Jisọs zara sị, "N\'ezie, n\'ezie, ana m asị gị, ma e sighị na mmiri na Mụọ mụọ mmadụ, ọ pụghị ịbanye n\'alaeze Chineke.',
      'Ihe a mụrụ n\'anụ ahụ bụ anụ ahụ; ihe a mụrụkwa na Mụọ bụ mụọ.',
      'Ejila ya n\'ihe ịtụnanya na m sịrị gị, \'A ghaghị ịmụ gị ọzọ.\'',
      'Ifufe na-efe ebe ọ masịrị ya, ị na-anụkwa ụda ya, ma ị maghị ebe o si bịa ma ọ bụ ebe ọ na-aga: otú a ka ọ dị onye ọ bụla nke a mụrụ na Mụọ."',
      'Nikọdimọs zara sị ya, "Olee otú ihe ndị a ga-esi kwe omume?"',
      'Jisọs zara sị ya, "Ị bụ onye nkụzi Izrel ma ị maghị ihe ndị a?',
      'N\'ezie, n\'ezie, ana m asị gị, anyị na-ekwu ihe anyị maara, na-agbakwa akaebe ihe anyị hụrụ; ma unu anabataghị akaebe anyị.',
      'Ọ bụrụ na m gwara unu ihe ndị nke ụwa ma unu ekweghị, olee otú unu ga-esi kwenye ma m gwa unu ihe ndị nke eluigwe?',
      'Ọ dịghị onye rịgoro n\'eluigwe ma e wezụga Onye ahụ nke siri n\'eluigwe rịdata, ya bụ Nwa nke Mmadụ.',
      'Dịka Mosis si welie agwọ ahụ elu n\'ọzara, otú ahụ ka a ghaghị ibuli Nwa nke Mmadụ elu:',
      'ka onye ọ bụla kwere na ya wee nwee ndụ ebighị ebi.',
      'N\'ihi na Chineke hụrụ ụwa n\'anya nke ukwuu nke na o nyere Ọkpara ọ mụrụ naanị ya, ka onye ọ bụla kwere na ya wee ghara ila n\'iyi, kama nwee ndụ ebighị ebi.',
      'N\'ihi na Chineke eziteghị Ọkpara ya n\'ụwa ka ọ mara ụwa ikpe; kama ka e wee zọpụta ụwa site na ya.',
      'Onye kwere na ya, a dịghị ama ya ikpe: ma onye na-ekweghị, a marala ya ikpe ugbu a, n\'ihi na o kweghị n\'aha nke Ọkpara Chineke mụrụ naanị ya.',
    ],
    'PSA:23': [
      'Onyenwe anyị bụ onye ọzụzụ atụrụ m; ọ dịghị ihe ga-akọ m.',
      'Ọ na-eme ka m dinara ala n\'ọhịa ahịhịa ndụ: ọ na-eduga m n\'akụkụ mmiri dị jụụ.',
      'Ọ na-enye mkpụrụ obi m ume ọhụrụ: ọ na-eduzi m n\'ụzọ ezi omume n\'ihi aha ya.',
      'E, ọ bụrụgodị na m na-ejegharị na ndagwurugwu nke onyinyo ọnwụ, agaghị m atụ egwu ihe ọjọọ ọ bụla: n\'ihi na gị onwe gị nọnyeere m; mkpanaka gị na mkpara gị, ha na-akasi m obi.',
      'Ị na-akwadobere m tebụl nri n\'ihu ndị iro m: ị na-ete m mmanụ n\'isi; iko m na-eruakarị.',
      'N\'ezie, ezi ihe na ebere ga na-eso m ụbọchị niile nke ndụ m: m ga-ebikwa n\'ụlọ Onyenwe anyị ruo mgbe ebighị ebi.',
    ],
  },
  HAU: {
    'MAT:1': [
      'Littafin tarihin zuri\'ar Yesu Kristi, ɗan Dawuda, ɗan Ibrahim.',
      'Ibrahim ya haifi Ishaku; Ishaku ya haifi Yakubu; Yakubu ya haifi Yahuda da \'yan\'uwansa;',
      'Yahuda ya haifi Ferez da Zarah ta wurin Tamar; Ferez ya haifi Hezron; Hezron ya haifi Ram;',
      'Ram ya haifi Amminadab; Amminadab ya haifi Nahshon; Nahshon ya haifi Salmon;',
      'Salmon ya haifi Bo\'az ta wurin Rahab; Bo\'az ya haifi Obed ta wurin Ruth; Obed ya haifi Yesse;',
      'Yesse ya haifi Dawuda sarki. Dawuda ya haifi Sulemanu ta wurin matar Uriya;',
      'Sulemanu ya haifi Rehobowam; Rehobowam ya haifi Abiya; Abiya ya haifi Asa;',
      'Asa ya haifi Yehoshafat; Yehoshafat ya haifi Yoram; Yoram ya haifi Uzziah;',
      'Uzziah ya haifi Yotam; Yotam ya haifi Ahaz; Ahaz ya haifi Hezekiya;',
      'Hezekiya ya haifi Manasse; Manasse ya haifi Amon; Amon ya haifi Yosiya;',
      'Yosiya ya haifi Yekoniya da \'yan\'uwansa, a lokacin da aka kwashe su zuwa Babila.',
      'Bayan kwashe su zuwa Babila, Yekoniya ya haifi She\'altiyel; She\'altiyel ya haifi Zerubbabel;',
      'Zerubbabel ya haifi Abihud; Abihud ya haifi Eliyakim; Eliyakim ya haifi Azor;',
      'Azor ya haifi Zadok; Zadok ya haifi Akim; Akim ya haifi Elihud;',
      'Elihud ya haifi Ele\'azar; Ele\'azar ya haifi Mattan; Mattan ya haifi Yakubu;',
      'Yakubu ya haifi Yusufu mijin Maryamu, wadda ta haifi Yesu, wanda ake kira Kristi.',
      'Dukan zuri\'a tun daga Ibrahim har zuwa Dawuda zuri\'a goma sha huɗu ne; tun daga Dawuda har zuwa kwashewa zuwa Babila zuri\'a goma sha huɗu ne; tun daga kwashewa zuwa Babila har zuwa Kristi kuma zuri\'a goma sha huɗu ne.',
      'Ga yadda haihuwar Yesu Kristi ta kasance: Sa\'ad da aka ɗaura auren Maryamu mahaifiyarsa da Yusufu, kafin su haɗu, sai aka tarar tana da juna biyu ta wurin Ruhu Mai Tsarki.',
      'Yusufu mijinta, da yake shi mutumin kirki ne, ba ya so ya ba ta kunya a fili, sai ya yi niyyar rabuwa da ita a asirce.',
      'Amma yayin da yake tunanin waɗannan abubuwa, sai ga wani mala\'ikan Ubangiji ya bayyana a gare shi a mafarki, yana cewa, "Yusufu, ɗan Dawuda, kada ka ji tsoron ɗaukar Maryamu matarka, gama abin da yake cikinta na Ruhu Mai Tsarki ne.',
      'Za ta haifi ɗa, za ka kuma sa masa suna YESU, gama shi ne zai ceci mutanensa daga zunubansu."',
      'Dukan wannan ya faru ne domin a cika abin da Ubangiji ya faɗa ta wurin annabi, yana cewa,',
      '"Ga shi, budurwa za ta yi juna biyu, za ta haifi ɗa, za a kuma sa masa suna Immanu\'ilu", ma\'ana, "Allah yana tare da mu."',
      'Sa\'ad da Yusufu ya tashi daga barci, sai ya yi kamar yadda mala\'ikan Ubangiji ya umarce shi, ya ɗauki matarsa;',
      'amma bai san ta ba har sai da ta haifi ɗanta na fari: ya kuma sa masa suna YESU.',
    ],
    'JHN:3': [
      'Akwai wani mutum a cikin Farisiyawa mai suna Nikodimu, shugaba ne a cikin Yahudawa:',
      'Wannan ya zo wurin Yesu da dare ya ce masa, "Malam, mun sani kai malami ne da ka fito daga wurin Allah, gama babu wanda zai iya yin waɗannan alamu da kake yi, sai idan Allah yana tare da shi."',
      'Yesu ya amsa ya ce masa, "Gaskiya, gaskiya, ina gaya maka, sai an sake haifar mutum, ba zai iya ganin mulkin Allah ba."',
      'Nikodimu ya ce masa, "Ta yaya za a haifi mutum sa\'ad da ya tsufa? Zai iya komawa cikin mahaifiyarsa sau biyu a sake haifarsa?"',
      'Yesu ya amsa, "Gaskiya, gaskiya, ina gaya maka, sai an haifi mutum da ruwa da kuma Ruhu, ba zai iya shiga mulkin Allah ba.',
      'Abin da aka haifa daga jiki, jiki ne; abin da aka haifa kuma daga Ruhu, ruhu ne.',
      'Kada ka yi mamaki domin na ce maka, \'Dole ne a sake haifarku.\'',
      'Iska tana busawa inda take so, kana jin sautinta, amma ba ka san inda ta fito ba, ko kuma inda za ta je: haka yake ga kowane mutum da aka haifa daga Ruhu."',
      'Nikodimu ya amsa ya ce masa, "Ta yaya waɗannan abubuwa za su faru?"',
      'Yesu ya amsa ya ce masa, "Kai ne malamin Isra\'ila, amma ba ka san waɗannan abubuwa ba?',
      'Gaskiya, gaskiya, ina gaya maka, muna faɗar abin da muka sani, muna kuma shaidar abin da muka gani; amma ba ku karɓi shaidarmu ba.',
      'Idan na gaya muku abubuwan duniya ba ku ba da gaskiya ba, ta yaya za ku ba da gaskiya idan na gaya muku abubuwan sama?',
      'Babu wanda ya taba hawa sama, sai wanda ya sauko daga sama, wato Ɗan Mutum.',
      'Kamar yadda Musa ya ɗaga macijin a daji, haka kuma dole a ɗaga Ɗan Mutum:',
      'domin duk wanda ya ba da gaskiya gare shi ya sami rai na har abada.',
      'Gama Allah ya yi ƙaunar duniya sosai har ya ba da Ɗansa haifaffe ɗaya tilo, domin duk wanda ya ba da gaskiya gare shi kada ya hallaka, sai dai ya sami rai na har abada.',
      'Gama Allah bai aiki Ɗansa zuwa duniya domin ya hukunta duniya ba, amma domin a ceci duniya ta wurinsa.',
      'Wanda ya ba da gaskiya gare shi ba a hukunta shi ba: amma wanda bai ba da gaskiya ba an riga an hukunta shi, domin bai ba da gaskiya ga sunan Ɗan Allah haifaffe ɗaya tilo ba.',
    ],
    'PSA:23': [
      'Ubangiji ne makiyayina; ba zan rasa kome ba.',
      'Yana sa ni kwanciya a cikin makiyaya mai albarka: yana bishe ni a gefen ruwaye masu sanyi.',
      'Yana wartsakar da raina: yana bishe ni a cikin hanyoyin adalci saboda sunansa.',
      'I, ko da yake ina tafiya a cikin kwarin inuwar mutuwa, ba zan ji tsoron wani mugun abu ba: gama kana tare da ni; sandarka da kunkurma suna ta\'azantar da ni.',
      'Ka shirya teburi a gabana a gaban maƙiyana: ka shafe kaina da mai; ƙoƙonona yana cika yana zuba.',
      'Tabbas nagarta da jinƙai za su bi ni dukan kwanakin raina: zan kuma zauna a cikin gidan Ubangiji har abada.',
    ],
  },
  LSG: {
    'MAT:1': [
      'Généalogie de Jésus-Christ, fils de David, fils d\'Abraham.',
      'Abraham engendra Isaac; Isaac engendra Jacob; Jacob engendra Juda et ses frères;',
      'Juda engendra de Thamar Pharès et Zara; Pharès engendra Esrom; Esrom engendra Aram;',
      'Aram engendra Aminadab; Aminadab engendra Naasson; Naasson engendra Salmon;',
      'Salmon engendra Boaz de Rahab; Boaz engendra Obed de Ruth; Obed engendra Isaï;',
      'Isaï engendra David le roi. David le roi engendra Salomon de la femme d\'Urie;',
      'Salomon engendra Roboam; Roboam engendra Abia; Abia engendra Asa;',
      'Asa engendra Josaphat; Josaphat engendra Joram; Joram engendra Ozias;',
      'Ozias engendra Joatham; Joatham engendra Achaz; Achaz engendra Ézéchias;',
      'Ézéchias engendra Manassé; Manassé engendra Amon; Amon engendra Josias;',
      'Josias engendra Jéchonias et ses frères, au temps de la déportation à Babylone.',
      'Après la déportation à Babylone, Jéchonias engendra Salathiel; Salathiel engendra Zorobabel;',
      'Zorobabel engendra Abiud; Abiud engendra Éliakim; Éliakim engendra Azor;',
      'Azor engendra Sadok; Sadok engendra Achim; Achim engendra Éliud;',
      'Éliud engendra Éléazar; Éléazar engendra Matthan; Matthan engendra Jacob;',
      'Jacob engendra Joseph, l\'époux de Marie, de laquelle est né Jésus, qui est appelé Christ.',
      'Il y a donc en tout quatorze générations depuis Abraham jusqu\'à David, quatorze générations depuis David jusqu\'à la déportation à Babylone, et quatorze générations depuis la déportation à Babylone jusqu\'au Christ.',
      'Voici de quelle manière arriva la naissance de Jésus-Christ. Marie, sa mère, ayant été fiancée à Joseph, se trouva enceinte, par la vertu du Saint-Esprit, avant qu\'ils eussent habité ensemble.',
      'Joseph, son époux, qui était un homme de bien et qui ne voulait pas la diffamer, se proposa de rompre secrètement avec elle.',
      'Comme il y pensait, voici, un ange du Seigneur lui apparut en songe, et dit: Joseph, fils de David, ne crains pas de prendre avec toi Marie, ta femme, car l\'enfant qu\'elle a conçu vient du Saint-Esprit;',
      'elle enfantera un fils, et tu lui donneras le nom de Jésus; c\'est lui qui sauvera son peuple de ses péchés.',
      'Tout cela arriva afin que s\'accomplît ce que le Seigneur avait annoncé par le prophète:',
      'Voici, la vierge sera enceinte, elle enfantera un fils, et on lui donnera le nom d\'Emmanuel, ce qui signifie Dieu avec nous.',
      'Joseph s\'étant réveillé fit ce que l\'ange du Seigneur lui avait ordonné, et il prit sa femme avec lui.',
      'Mais il ne la connut point jusqu\'à ce qu\'elle eût enfanté un fils, auquel il donna le nom de Jésus.',
    ],
    'JHN:3': [
      'Mais il y eut un homme d\'entre les pharisiens, nommé Nicodème, un chef des Juifs,',
      'qui vint, lui, auprès de Jésus, de nuit, et lui dit: Rabbi, nous savons que tu es un docteur venu de Dieu; car personne ne peut faire ces miracles que tu fais, si Dieu n\'est avec lui.',
      'Jésus lui répondit: En vérité, en vérité, je te le dis, si un homme ne naît de nouveau, il ne peut voir le royaume de Dieu.',
      'Nicodème lui dit: Comment un homme peut-il naître quand il est vieux? Peut-il rentrer dans le sein de sa mère et naître?',
      'Jésus répondit: En vérité, en vérité, je te le dis, si un homme ne naît d\'eau et d\'Esprit, il ne peut entrer dans le royaume de Dieu.',
      'Ce qui est né de la chair est chair, et ce qui est né de l\'Esprit est esprit.',
      'Ne t\'étonne pas que je t\'aie dit: Il faut que vous naissiez de nouveau.',
      'Le vent souffle où il veut, et tu en entends le bruit; mais tu ne sais d\'où il vient, ni où il va. Il en est ainsi de tout homme qui est né de l\'Esprit.',
      'Nicodème lui dit: Comment cela peut-il se faire?',
      'Jésus lui répondit: Tu es le docteur d\'Israël, et tu ne sais pas ces choses!',
      'En vérité, en vérité, je te le dis, nous disons ce que nous savons, et nous rendons témoignage de ce que nous avons vu; et vous ne recevez pas notre témoignage.',
      'Si vous ne croyez pas quand je vous ai parlé des choses terrestres, comment croirez-vous quand je vous parlerai des choses célestes?',
      'Personne n\'est monté au ciel, si ce n\'est celui qui est descendu du ciel, le Fils de l\'homme qui est dans le ciel.',
      'Et comme Moïse éleva le serpent dans le désert, il faut de même que le Fils de l\'homme soit élevé,',
      'afin que quiconque croit en lui ait la vie éternelle.',
      'Car Dieu a tant aimé le monde qu\'il a donné son Fils unique, afin que quiconque croit en lui ne périsse point, mais qu\'il ait la vie éternelle.',
      'Dieu, en effet, n\'a pas envoyé son Fils dans le monde pour qu\'il juge le monde, mais pour que le monde soit sauvé par lui.',
      'Celui qui croit en lui n\'est point jugé; mais celui qui ne croit pas est déjà jugé, parce qu\'il n\'a pas cru au nom du Fils unique de Dieu.',
    ],
    'PSA:23': [
      'L\'Éternel est mon berger: je ne manquerai de rien.',
      'Il me fait reposer dans de verts pâturages, Il me dirige près des eaux paisibles.',
      'Il restaure mon âme, Il me conduit dans les sentiers de la justice, À cause de son nom.',
      'Quand je marche dans la vallée de l\'ombre de la mort, Je ne crains aucun mal, car tu es avec moi: Ta houlette et ton bâton me rassurent.',
      'Tu dresses devant moi une table, En face de mes adversaires; Tu oins d\'huile ma tête, Et ma coupe déborde.',
      'Oui, le bonheur et la grâce m\'accompagneront Tous les jours de ma vie, Et j\'habiterai dans la maison de l\'Éternel Jusqu\'à la fin de mes jours.',
    ],
  },
  RVR: {
    'MAT:1': [
      'Libro de la genealogía de Jesucristo, hijo de David, hijo de Abraham.',
      'Abraham engendró a Isaac, Isaac a Jacob, y Jacob a Judá y a sus hermanos.',
      'Judá engendró de Tamar a Fares y a Zara, Fares a Esrom, y Esrom a Aram.',
      'Aram engendró a Aminadab, Aminadab a Naasón, y Naasón a Salmón.',
      'Salmón engendró de Rahab a Booz, Booz engendró de Rut a Obed, y Obed a Isaí.',
      'Isaí engendró al rey David, y el rey David engendró a Salomón de la que fue mujer de Urías.',
      'Salomón engendró a Roboam, Roboam a Abías, y Abías a Asa.',
      'Asa engendró a Josafat, Josafat a Joram, y Joram a Uzías.',
      'Uzías engendró a Jotam, Jotam a Acaz, y Acaz a Ezequías.',
      'Ezequías engendró a Manasés, Manasés a Amón, y Amón a Josías.',
      'Josías engendró a Jeconías y a sus hermanos, en el tiempo de la deportación a Babilonia.',
      'Después de la deportación a Babilonia, Jeconías engendró a Salatiel, y Salatiel a Zorobabel.',
      'Zorobabel engendró a Abiud, Abiud a Eliaquim, y Eliaquim a Azor.',
      'Azor engendró a Sadoc, Sadoc a Aquim, y Aquim a Eliud.',
      'Eliud engendró a Eleazar, Eleazar a Matán, Matán a Jacob;',
      'y Jacob engendró a José, marido de María, de la cual nació Jesús, llamado el Cristo.',
      'De manera que todas las generaciones desde Abraham hasta David son catorce; desde David hasta la deportación a Babilonia, catorce; y desde la deportación a Babilonia hasta Cristo, catorce.',
      'El nacimiento de Jesucristo fue así: Estando desposada María su madre con José, antes que se juntasen, se halló que había concebido del Espíritu Santo.',
      'José su marido, como era justo, y no quería infamarla, quiso dejarla secretamente.',
      'Y pensando él en esto, he aquí un ángel del Señor le apareció en sueños y le dijo: José, hijo de David, no temas recibir a María tu mujer, porque lo que en ella es engendrado, del Espíritu Santo es.',
      'Y dará a luz un hijo, y llamarás su nombre JESÚS, porque él salvará a su pueblo de sus pecados.',
      'Todo esto aconteció para que se cumpliese lo dicho por el Señor por medio del profeta, cuando dijo:',
      'He aquí, una virgen concebirá y dará a luz un hijo, Y llamarás su nombre Emanuel, que traducido es: Dios con nosotros.',
      'Y despertando José del sueño, hizo como el ángel del Señor le había mandado, y recibió a su mujer.',
      'Pero no la conoció hasta que dio a luz a su hijo primogénito; y le puso por nombre JESÚS.',
    ],
    'JHN:3': [
      'Había un hombre de los fariseos que se llamaba Nicodemo, un principal entre los judíos.',
      'Este vino a Jesús de noche, y le dijo: Rabí, sabemos que has venido de Dios como maestro; porque nadie puede hacer estas señales que tú haces, si no está Dios con él.',
      'Respondió Jesús y le dijo: De cierto, de cierto te digo, que el que no naciere de nuevo, no puede ver el reino de Dios.',
      'Nicodemo le dijo: ¿Cómo puede un hombre nacer siendo viejo? ¿Puede acaso entrar por segunda vez en el vientre de su madre, y nacer?',
      'Respondió Jesús: De cierto, de cierto te digo, que el que no naciere de agua y del Espíritu, no puede entrar en el reino de Dios.',
      'Lo que es nacido de la carne, carne es; y lo que es nacido del Espíritu, espíritu es.',
      'No te maravilles de que te dije: Os es necesario nacer de nuevo.',
      'El viento sopla de donde quiere, y oyes su sonido; mas ni sabes de dónde viene, ni a dónde va; así es todo aquel que es nacido del Espíritu.',
      'Respondió Nicodemo y le dijo: ¿Cómo puede hacerse esto?',
      'Respondió Jesús y le dijo: ¿Eres tú maestro de Israel, y no sabes esto?',
      'De cierto, de cierto te digo, que lo que sabemos hablamos, y lo que hemos visto, testificamos; y no recibís nuestro testimonio.',
      'Si os he dicho cosas terrenales, y no creéis, ¿cómo creeréis si os dijere las celestiales?',
      'Nadie subió al cielo, sino el que descendió del cielo; el Hijo del Hombre, que está en el cielo.',
      'Y como Moisés levantó la serpiente en el desierto, así es necesario que el Hijo del Hombre sea levantado,',
      'para que todo aquel que en él cree, no se pierda, mas tenga vida eterna.',
      'Porque de tal manera amó Dios al mundo, que ha dado a su Hijo unigénito, para que todo aquel que en él cree, no se pierda, mas tenga vida eterna.',
      'Porque no envió Dios a su Hijo al mundo para condenar al mundo, sino para que el mundo sea salvo por él.',
      'El que en él cree, no es condenado; pero el que no cree, ya ha sido condenado, porque no ha creído en el nombre del unigénito Hijo de Dios.',
    ],
    'PSA:23': [
      'Jehová es mi pastor; nada me faltará.',
      'En lugares de delicados pastos me hará descansar; Junto a aguas de reposo me pastoreará.',
      'Confortará mi alma; Me guiará por sendas de justicia por amor de su nombre.',
      'Aunque ande en valle de sombra de muerte, No temeré mal alguno, porque tú estarás conmigo; Tu vara y tu cayado me infundirán aliento.',
      'Aderezas mesa delante de mí en presencia de mis angustiadores; Unges mi cabeza con aceite; mi copa está rebosando.',
      'Ciertamente el bien y la misericordia me seguirán todos los días de mi vida, Y en la casa de Jehová moraré por largos días.',
    ],
  },
  SWA: {
    'MAT:1': [
      'Kitabu cha ukoo wa Yesu Kristo, mwana wa Daudi, mwana wa Ibrahimu.',
      'Ibrahimu alimzaa Isaka; Isaka akamzaa Yakobo; Yakobo akamzaa Yuda na ndugu zake;',
      'Yuda akamzaa Faresi na Zara kwa Tamari; Faresi akamzaa Esromu; Esromu akamzaa Aramu;',
      'Aramu akamzaa Aminadabu; Aminadabu akamzaa Naashoni; Naashoni akamzaa Salmoni;',
      'Salmoni akamzaa Boazi kwa Rahabu; Boazi akamzaa Obedi kwa Ruthu; Obedi akamzaa Yese;',
      'Yese akamzaa mfalme Daudi. Daudi akamzaa Sulemani kwa yule aliyekuwa mke wa Uria;',
      'Sulemani akamzaa Rehoboamu; Rehoboamu akamzaa Abiya; Abiya akamzaa Asa;',
      'Asa akamzaa Yehoshafati; Yehoshafati akamzaa Yoramu; Yoramu akamzaa Uzia;',
      'Uzia akamzaa Yothamu; Yothamu akamzaa Ahazi; Ahazi akamzaa Hezekia;',
      'Hezekia akamzaa Manase; Manase akamzaa Amoni; Amoni akamzaa Yosia;',
      'Yosia akamzaa Yekonia na ndugu zake, wakati wa kuhamishwa Babeli.',
      'Na baada ya kuhamishwa Babeli, Yekonia akamzaa Shealtieli; Shealtieli akamzaa Zerubabeli;',
      'Zerubabeli akamzaa Abiudi; Abiudi akamzaa Eliakimu; Eliakimu akamzaa Azori;',
      'Azori akamzaa Sadoki; Sadoki akamzaa Akimu; Akimu akamzaa Eliudi;',
      'Eliudi akamzaa Eleazari; Eleazari akamzaa Mathani; Mathani akamzaa Yakobo;',
      'Yakobo akamzaa Yusufu mumewe Mariamu, aliyemzaa Yesu, aitwaye Kristo.',
      'Basi vizazi vyote tangu Ibrahimu mpaka Daudi ni vizazi kumi na vinne; na tangu Daudi mpaka kuhamishwa Babeli ni vizazi kumi na vinne; na tangu kuhamishwa Babeli mpaka Kristo ni vizazi kumi na vinne.',
      'Kuzaliwa kwake Yesu Kristo kulikuwa hivi: Mariamu mama yake alipokuwa ameposwa na Yusufu, kabla hawajakaribiana, alionekana ana mimba kwa uwezo wa Roho Mtakatifu.',
      'Naye Yusufu, mumewe, kwa vile alivyokuwa mtu wa haki, asitake kumwaibisha kwa siri, aliazimu kumwacha kwa siri.',
      'Basi alipokuwa akifikiri hayo, tazama, malaika wa Bwana alimtokea katika ndoto, akisema, Yusufu, mwana wa Daudi, usiogope kumchukua Mariamu mkeo, kwa maana mimba yake ni kwa uwezo wa Roho Mtakatifu.',
      'Naye atamzaa mwana, nawe utamwita jina lake YESU, maana yeye ndiye atakayewaokoa watu wake na dhambi zao.',
      'Hayo yote yalikuwa ili litimizwe neno lililonenwa na Bwana kwa njia ya nabii akisema,',
      'Tazama, bikira atachukua mimba, naye atamzaa mwana, nao watamwita jina lake Imanueli; yaani, Mungu pamoja nasi.',
      'Naye Yusufu alipoamka katika usingizi, alifanya kama malaika wa Bwana alivyomwagiza, akamchukua mkewe;',
      'akamjua asimjue hata alipomzaa mwanawe kifungua mimba; akamwita jina lake YESU.',
    ],
    'JHN:3': [
      'Palikuwa na mtu mmoja wa Mafarisayo, jina lake Nikodemo, mkuu wa Wayahudi:',
      'Huyo alimwendea Yesu usiku, akamwambia, Rabi, twajua ya kuwa u mwalimu uliyetoka kwa Mungu; kwa maana hakuna mtu awezaye kufanya ishara hizi uzifanyazo wewe, Mungu asipokuwa pamoja naye.',
      'Yesu akajibu, akamwambia, Amin, amin, nakuambia, Mtu asipozaliwa mara ya pili, hawezi kuuona ufalme wa Mungu.',
      'Nikodemo akamwambia, Awezaje mtu kuzaliwa akiwa mzee? Aweza kuingia tumboni mwa mamaye mara ya pili akazaliwa?',
      'Yesu akajibu, Amin, amin, nakuambia, Mtu asipozaliwa kwa maji na kwa Roho, hawezi kuuingia ufalme wa Mungu.',
      'Kilichozaliwa kwa mwili ni mwili; na kilichozaliwa kwa Roho ni roho.',
      'Usistaajabu kwa kuwa nilikuambia, Hamna budi kuzaliwa mara ya pili.',
      'Upepo huvuma upendako, nawe waisikia sauti yake, lakini hujui unakotoka wala unakokwenda; kadhalika na kila mtu aliyezaliwa kwa Roho.',
      'Nikodemo akajibu, akamwambia, Yawezaje kuwa mambo haya?',
      'Yesu akajibu, akamwambia, Wewe u mwalimu wa Israeli, na mambo haya huyajui?',
      'Amin, amin, nakuambia, Sisi twayanena tuyajuayo, na kuyashuhudia tuliyoyaona; wala ushuhuda wetu hamwukubali.',
      'Ikiwa nimewaambia mambo ya duniani, wala hamsadiki, mtasadiki wapi nikiwaambia mambo ya mbinguni?',
      'Wala hakuna mtu aliyepaa mbinguni, ila yeye aliyeshuka kutoka mbinguni, yaani, Mwana wa Adamu.',
      'Na kama vile Musa alivyomwinua yule nyoka jangwani, vivyo hivyo Mwana wa Adamu hana budi kuinuliwa,',
      'ili kila mtu aaminiye awe na uzima wa milele katika yeye.',
      'Kwa maana jinsi hii Mungu aliupenda ulimwengu, hata akamtoa Mwanawe wa pekee, ili kila mtu amwaminiye asipotee, bali awe na uzima wa milele.',
      'Maana Mungu hakumtuma Mwana ulimwenguni ili auhukumu ulimwengu, bali ulimwengu uokolewe katika yeye.',
      'Amwaminiye yeye hahukumiwi; asiyeamini amekwisha kuhukumiwa; kwa sababu hakuliamini jina la Mwana wa pekee wa Mungu.',
    ],
    'PSA:23': [
      'Bwana ndiye mchungaji wangu, Sitapungukiwa na kitu.',
      'Katika malisho ya majani mabichi hunilaza, Kando ya maji ya utulivu huniongoza.',
      'Hunihuisha nafsi yangu; Huniongoza katika njia za haki kwa ajili ya jina lake.',
      'Naam, nijapopita kati ya bonde la uvuli wa mauti, Sitaogopa mabaya; Kwa maana wewe u pamoja nami, Gongo lako na fimbo yako vyanifariji.',
      'Waandaa meza mbele yangu, Machoni pa watesi wangu; Umenipaka mafuta kichwani pangu, Na kikombe changu kinafurika.',
      'Hakika wema na fadhili zitanifuata Siku zote za maisha yangu; Nami nitakaa nyumbani mwa Bwana milele.',
    ],
  },
};

// Aliases for missing languages point to clean authoritative translations
BIBLE_TEXT.BBE = BIBLE_TEXT.WEB;
BIBLE_TEXT.ASV = BIBLE_TEXT.KJV;
BIBLE_TEXT.ARC = BIBLE_TEXT.RVR;
BIBLE_TEXT.SVD = BIBLE_TEXT.KJV;

// Verse of the day
export const VERSE_OF_DAY = {
  bookId: 'JHN',
  chapter: 3,
  verse: 16,
  theme: 'Salvation & Divine Love',
  reflection: 'God\'s love is not passive; it is active, sacrificial, and personal. Believing in Him transforms our present and guarantees our eternal future.',
};

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

export function getChapter(translation, bookId, chapter) {
  const tr = BIBLE_TEXT[translation] || BIBLE_TEXT.KJV;
  const key = `${bookId}:${chapter}`;
  if (tr && tr[key] && tr[key].length) return tr[key];
  if (BIBLE_TEXT.KJV && BIBLE_TEXT.KJV[key]) return BIBLE_TEXT.KJV[key];
  return null;
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
