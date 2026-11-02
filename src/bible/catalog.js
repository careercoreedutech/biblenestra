// Bible translation catalog.
// Every "available" entry is either public domain or published under a licence that allows use in
// commercial apps (most Biblica® Open / Door43 / IRV texts are CC BY-SA 4.0 — attribution required,
// which the reader shows under the chapter). `api` is the translation id on the Free Use Bible API.
import { LICENSED_SOURCES } from './config';

const PD = 'Public domain';
const BIBLICA = 'Biblica® Open · CC BY-SA 4.0';
const IRV = 'Bridge Connectivity Solutions · CC BY-SA 4.0';

// region: used to group the picker
export const TRANSLATIONS = [
  // ---------- English ----------
  { id: 'KJV', api: 'eng_kjv', name: 'King James Version', lang: 'English', region: 'English', licence: PD, year: 1611, bundled: true, badge: 'Offline' },
  { id: 'BSB', api: 'BSB', name: 'Berean Standard Bible', lang: 'English', region: 'English', licence: PD, year: 2022, badge: 'Modern' },
  { id: 'WEB', api: 'ENGWEBP', name: 'World English Bible', lang: 'English', region: 'English', licence: PD, year: 2020, badge: 'Modern' },
  { id: 'LSV', api: 'eng_lsv', name: 'Literal Standard Version', lang: 'English', region: 'English', licence: 'Covenant Press · CC BY-SA 4.0', year: 2020, attribution: 'Literal Standard Version © 2020 Covenant Press. CC BY-SA 4.0.' },
  { id: 'FBV', api: 'eng_fbv', name: 'Free Bible Version', lang: 'English', region: 'English', licence: 'CC BY-SA 4.0', year: 2018, badge: 'Easy read', attribution: 'Free Bible Version © 2018 Dr. Jonathan Gallagher. CC BY-SA 4.0.' },
  { id: 'T4T', api: 'eng_t4t', name: 'Translation for Translators', lang: 'English', region: 'English', licence: 'CC BY-SA 4.0', year: 2017, badge: 'Explained', attribution: 'Translation for Translators © 2008–2017 Ellis W. Deibler, Jr. CC BY-SA 4.0.' },
  { id: 'MSB', api: 'eng_msb', name: 'Majority Standard Bible', lang: 'English', region: 'English', licence: PD, year: 2022 },
  { id: 'ASV', api: 'eng_asv', name: 'American Standard Version', lang: 'English', region: 'English', licence: PD, year: 1901 },
  { id: 'YLT', api: 'eng_ylt', name: "Young's Literal Translation", lang: 'English', region: 'English', licence: PD, year: 1898, badge: 'Literal' },
  { id: 'BBE', api: 'eng_bbe', name: 'Bible in Basic English', lang: 'English', region: 'English', licence: PD, year: 1965, badge: 'Simple' },
  { id: 'DBY', api: 'eng_dby', name: 'Darby Translation', lang: 'English', region: 'English', licence: PD, year: 1890 },
  { id: 'RV', api: 'eng_rv5', name: 'Revised Version', lang: 'English', region: 'English', licence: PD, year: 1885 },
  { id: 'WBS', api: 'eng_wbs', name: 'Webster Bible', lang: 'English', region: 'English', licence: PD, year: 1833 },
  { id: 'GNV', api: 'eng_gnv', name: 'Geneva Bible', lang: 'English', region: 'English', licence: PD, year: 1599 },
  { id: 'DRA', api: 'eng_dra', name: 'Douay-Rheims (Catholic)', lang: 'English', region: 'English', licence: PD, year: 1899 },
  { id: 'WMB', api: 'eng_wmb', name: 'World Messianic Bible', lang: 'English', region: 'English', licence: PD, year: 2020 },

  // ---------- African languages ----------
  { id: 'YOR', api: 'yor_bib', name: 'Bíbélì Mímọ́ Yorùbá Òde-Òní', lang: 'Yorùbá', region: 'African languages', licence: BIBLICA, attribution: 'Yoruba Contemporary Bible © 2009, 2017 Biblica, Inc. CC BY-SA 4.0.' },
  { id: 'IGB', api: 'ibo_bib', name: 'Baịbụlụ Nsọ nʼIgbo Ndị Ugbu a', lang: 'Igbo', region: 'African languages', licence: BIBLICA, attribution: 'Igbo Contemporary Bible © 2020 Biblica, Inc. CC BY-SA 4.0.' },
  { id: 'HAU', api: 'hau_bib', name: 'Littafi Mai Tsarki, Sabon Rai', lang: 'Hausa', region: 'African languages', licence: BIBLICA, attribution: 'Hausa Contemporary Bible © 2009, 2020 Biblica, Inc. CC BY-SA 4.0.' },
  { id: 'SWA', api: 'swh_bib', name: 'Biblia Takatifu, Neno', lang: 'Kiswahili', region: 'African languages', licence: BIBLICA, attribution: 'Kiswahili Contemporary Version © 1984–2015 Biblica, Inc. CC BY-SA 4.0.' },
  { id: 'TWI', api: 'twi_aka', name: 'Twi Bible (Akuapem)', lang: 'Twi', region: 'African languages', licence: BIBLICA, attribution: 'Akuapem Twi Contemporary Bible © 1996, 2020 Biblica, Inc. CC BY-SA 4.0.' },
  { id: 'ASA', api: 'twi_asa', name: 'Twi Bible (Asante)', lang: 'Twi', region: 'African languages', licence: BIBLICA, attribution: 'Asante Twi Contemporary Bible © 1996, 2020 Biblica, Inc. CC BY-SA 4.0.' },
  { id: 'EWE', api: 'ewe_bib', name: 'Biblia Kɔkɔe', lang: 'Éwé', region: 'African languages', licence: BIBLICA, attribution: 'Éwé Contemporary Bible © 1988–2020 Biblica, Inc. CC BY-SA 4.0.' },
  { id: 'LIN', api: 'lin_bib', name: 'Biblia (Lingala)', lang: 'Lingala', region: 'African languages', licence: BIBLICA, attribution: 'Lingala Contemporary Bible © 2020 Biblica, Inc. CC BY-SA 4.0.' },
  { id: 'LUG', api: 'lug_bib', name: 'Bayibuli (Luganda)', lang: 'Luganda', region: 'African languages', licence: BIBLICA, attribution: 'Luganda Contemporary Bible © 1984–2014 Biblica, Inc. CC BY-SA 4.0.' },
  { id: 'NYA', api: 'nya_bib', name: 'Buku Lopatulika (Chichewa)', lang: 'Chichewa', region: 'African languages', licence: BIBLICA, attribution: 'Chichewa Contemporary Bible © 2002, 2016 Biblica, Inc. CC BY-SA 4.0.' },
  { id: 'SNA', api: 'sna_bib', name: 'Bhaibheri (Shona)', lang: 'Shona', region: 'African languages', licence: BIBLICA, attribution: 'Shona Contemporary Bible © 2005, 2018 Biblica, Inc. CC BY-SA 4.0.' },

  // ---------- European languages ----------
  { id: 'LSG', api: 'fra_lsg', name: 'Louis Segond 1910', lang: 'Français', region: 'European languages', licence: PD, year: 1910 },
  { id: 'FDBY', api: 'fra_jnd', name: 'Bible J.N. Darby', lang: 'Français', region: 'European languages', licence: PD, year: 1885 },
  { id: 'RVR', api: 'spa_r09', name: 'Reina-Valera 1909', lang: 'Español', region: 'European languages', licence: PD, year: 1909 },
  { id: 'BES', api: 'spa_bes', name: 'La Biblia en Español Sencillo', lang: 'Español', region: 'European languages', licence: PD, badge: 'Easy read' },
  { id: 'BSL', api: 'por_bsl', name: 'Bíblia Portuguesa Mundial', lang: 'Português', region: 'European languages', licence: PD },
  { id: 'BLJ', api: 'por_blj', name: 'Bíblia Livre', lang: 'Português', region: 'European languages', licence: 'CC BY 4.0', attribution: 'Bíblia Livre © 2018 Diego Santos, Mario Sérgio et al. CC BY 4.0.' },
  { id: 'LUT', api: 'deu_l12', name: 'Lutherbibel 1912', lang: 'Deutsch', region: 'European languages', licence: PD, year: 1912 },
  { id: 'ELB', api: 'deu_elo', name: 'Elberfelder Bibel', lang: 'Deutsch', region: 'European languages', licence: PD, year: 1871 },
  { id: 'RIV', api: 'ita_riv', name: 'Riveduta 1927', lang: 'Italiano', region: 'European languages', licence: PD, year: 1927 },
  { id: 'DIO', api: 'ita_dio', name: 'Diodati', lang: 'Italiano', region: 'European languages', licence: PD, year: 1885 },
  { id: 'SYN', api: 'rus_syn', name: 'Синодальный перевод', lang: 'Русский', region: 'European languages', licence: PD, year: 1876 },
  { id: 'UKR', api: 'ukr_pan', name: 'Біблія Куліша', lang: 'Українська', region: 'European languages', licence: PD, year: 1903 },
  { id: 'UBG', api: 'pol_ubg', name: 'Uwspółcześniona Biblia Gdańska', lang: 'Polski', region: 'European languages', licence: 'CC BY-ND 4.0', attribution: 'Uwspółcześniona Biblia Gdańska © Fundacja Wrota Nadziei.' },
  { id: 'VUL', api: 'lat_clv', name: 'Vulgata Clementina', lang: 'Latina', region: 'European languages', licence: PD, year: 1598 },

  // ---------- Asia & Middle East ----------
  { id: 'SVD', api: 'arb_vdv', name: 'الكتاب المقدس — فاندايك', lang: 'العربية', region: 'Asia & Middle East', licence: PD, rtl: true, year: 1865 },
  { id: 'NAV', api: 'ARBNAV', name: 'كتاب الحياة', lang: 'العربية', region: 'Asia & Middle East', licence: BIBLICA, rtl: true, attribution: 'New Arabic Version (Book of Life) © Biblica, Inc. CC BY-SA 4.0.' },
  { id: 'HEB', api: 'heb_mod', name: 'תנ"ך — Modern Hebrew Bible', lang: 'עברית', region: 'Asia & Middle East', licence: PD, rtl: true },
  { id: 'PBS', api: 'pes_pbs', name: 'Old Persian Version', lang: 'فارسی', region: 'Asia & Middle East', licence: PD, rtl: true },
  { id: 'CUV', api: 'cmn_cuv', name: '和合本 (繁體)', lang: '中文', region: 'Asia & Middle East', licence: PD, year: 1919 },
  { id: 'CUVS', api: 'cmn_cu1', name: '和合本 (简体)', lang: '中文', region: 'Asia & Middle East', licence: PD, year: 1919 },
  { id: 'KOR', api: 'kor_old', name: '성경전서 1910', lang: '한국어', region: 'Asia & Middle East', licence: PD, year: 1910 },
  { id: 'JPN', api: 'jpn_kou', name: '口語訳 (1955)', lang: '日本語', region: 'Asia & Middle East', licence: PD, year: 1955 },
  { id: 'HIN', api: 'HINIRV', name: 'पवित्र बाइबल (IRV)', lang: 'हिन्दी', region: 'Asia & Middle East', licence: IRV, attribution: 'Hindi Indian Revised Version © 2017–2019 Bridge Connectivity Solutions. CC BY-SA 4.0.' },
  { id: 'TAM', api: 'tam_irv', name: 'பரிசுத்த வேதாகமம் (IRV)', lang: 'தமிழ்', region: 'Asia & Middle East', licence: IRV, attribution: 'Tamil Indian Revised Version © 2017, 2019 Bridge Connectivity Solutions. CC BY-SA 4.0.' },
  { id: 'TEL', api: 'tel_irv', name: 'పరిశుద్ధ గ్రంథం (IRV)', lang: 'తెలుగు', region: 'Asia & Middle East', licence: IRV, attribution: 'Telugu Indian Revised Version © Bridge Connectivity Solutions. CC BY-SA 4.0.' },
  { id: 'BEN', api: 'ben_irv', name: 'পবিত্র বাইবেল (IRV)', lang: 'বাংলা', region: 'Asia & Middle East', licence: IRV, attribution: 'Bengali Indian Revised Version © 2018, 2019 Bridge Connectivity Solutions. CC BY-SA 4.0.' },
  { id: 'URD', api: 'urd_irv', name: 'کتاب مقدس (IRV)', lang: 'اردو', region: 'Asia & Middle East', licence: IRV, rtl: true, attribution: 'Urdu Indian Revised Version © 2019 Bridge Connectivity Solutions. CC BY-SA 4.0.' },
  { id: 'TGL', api: 'tgl_bib', name: 'Banal na Bibliya (Contemporary)', lang: 'Tagalog', region: 'Asia & Middle East', licence: BIBLICA, attribution: 'Open Tagalog Contemporary Bible © Biblica, Inc. CC BY-SA 4.0.' },
  { id: 'VIE', api: 'vie_1934', name: 'Kinh Thánh 1934', lang: 'Tiếng Việt', region: 'Asia & Middle East', licence: PD, year: 1934 },
  { id: 'TUR', api: 'tur_ytc', name: 'Kutsal Kitap (Turkish WEB)', lang: 'Türkçe', region: 'Asia & Middle East', licence: 'CC BY-ND 4.0', attribution: 'Turkish WEB © 2023–2025 İsmail Serinken and eBible.org. CC BY-ND 4.0.' },
];

// Popular translations that are copyrighted. They are listed so readers know they're coming, but the
// text can only be served once the publisher grants a licence (see LICENSED_SOURCES in ./config).
export const LICENSE_REQUIRED = [
  { id: 'TPT', name: 'The Passion Translation', lang: 'English', publisher: 'BroadStreet Publishing' },
  { id: 'NIV', name: 'New International Version', lang: 'English', publisher: 'Biblica' },
  { id: 'ESV', name: 'English Standard Version', lang: 'English', publisher: 'Crossway' },
  { id: 'NLT', name: 'New Living Translation', lang: 'English', publisher: 'Tyndale House' },
  { id: 'NKJV', name: 'New King James Version', lang: 'English', publisher: 'Thomas Nelson' },
  { id: 'AMP', name: 'Amplified Bible', lang: 'English', publisher: 'The Lockman Foundation' },
  { id: 'MSG', name: 'The Message', lang: 'English', publisher: 'NavPress' },
  { id: 'NASB', name: 'New American Standard Bible', lang: 'English', publisher: 'The Lockman Foundation' },
  { id: 'CSB', name: 'Christian Standard Bible', lang: 'English', publisher: 'Holman Bible Publishers' },
  { id: 'NET', name: 'NET Bible', lang: 'English', publisher: 'Biblical Studies Press' },
  { id: 'NRSV', name: 'New Revised Standard Version', lang: 'English', publisher: 'National Council of Churches' },
  { id: 'RV1960', name: 'Reina-Valera 1960', lang: 'Español', publisher: 'Sociedades Bíblicas Unidas' },
  { id: 'NVI', name: 'Nueva Versión Internacional', lang: 'Español', publisher: 'Biblica' },
].map((t) => {
  const src = LICENSED_SOURCES[t.id];
  return src ? { ...t, licensed: true, url: src.url } : t;
});

// Licensed ones the team has configured become normal, selectable translations.
LICENSE_REQUIRED.filter((t) => t.licensed).forEach((t) => {
  TRANSLATIONS.push({ id: t.id, url: t.url, name: t.name, lang: t.lang, region: 'English', licence: `Licensed from ${t.publisher}`, attribution: `${t.name} © ${t.publisher}. Used by permission.` });
});

// Older saves referenced ids we no longer serve.
const ALIASES = { ARC: 'BSL', IBO: 'IGB', NIV: 'KJV', ESV: 'KJV', NLT: 'KJV', NKJV: 'KJV', NASB: 'KJV', AMP: 'KJV', CSB: 'KJV', MSG: 'KJV' };

export function resolveTranslationId(id) {
  if (TRANSLATIONS.some((t) => t.id === id)) return id;
  return ALIASES[id] && TRANSLATIONS.some((t) => t.id === ALIASES[id]) ? ALIASES[id] : 'KJV';
}

export function translationInfo(id) {
  return TRANSLATIONS.find((t) => t.id === resolveTranslationId(id)) || TRANSLATIONS[0];
}

export const TRANSLATION_REGIONS = ['English', 'African languages', 'European languages', 'Asia & Middle East'];

export const LANGUAGE_COUNT = new Set(TRANSLATIONS.map((t) => t.lang)).size;

// Text-to-speech locale for narration in each language (device voices vary; English is the fallback).
const TTS = {
  English: 'en-US', 'Yorùbá': 'yo-NG', Igbo: 'ig-NG', Hausa: 'ha-NG', Kiswahili: 'sw-KE', Twi: 'ak-GH', 'Éwé': 'ee-GH',
  Lingala: 'ln-CD', Luganda: 'lg-UG', Chichewa: 'ny-MW', Shona: 'sn-ZW', 'Français': 'fr-FR', 'Español': 'es-ES',
  'Português': 'pt-BR', Deutsch: 'de-DE', Italiano: 'it-IT', 'Русский': 'ru-RU', 'Українська': 'uk-UA', Polski: 'pl-PL',
  Latina: 'it-IT', 'العربية': 'ar-SA', 'עברית': 'he-IL', 'فارسی': 'fa-IR', '中文': 'zh-CN', '한국어': 'ko-KR', '日本語': 'ja-JP',
  'हिन्दी': 'hi-IN', 'தமிழ்': 'ta-IN', 'తెలుగు': 'te-IN', 'বাংলা': 'bn-IN', 'اردو': 'ur-PK', Tagalog: 'fil-PH',
  'Tiếng Việt': 'vi-VN', 'Türkçe': 'tr-TR',
};
export function ttsLocale(id) {
  return TTS[translationInfo(id).lang] || 'en-US';
}
