// BOOKS catalogue (brief 18). Only public-domain works. Every Gutenberg ebook number below was checked by
// fetching the work's own Gutenberg text (title and author lines) on 2026-11-28; the licence is Project Gutenberg's
// public-domain status for the work in the United States. Every author and translator listed died more than 70 years
// ago, so each work is also public domain in countries with a life-plus-70 term (for example Nigeria). Licence wording
// is in every entry. Each book's source page is https://www.gutenberg.org/ebooks/<gutenbergId> (books.js sourceUrl).
const PD = 'Public domain. Text from Project Gutenberg (public-domain edition).';

export const BOOK_SECTIONS = [
  { id: 'featured', name: 'Featured' },
  { id: 'church-history', name: 'Church History' },
  { id: 'christian-biography', name: 'Christian Biography' },
  { id: 'bible-commentaries', name: 'Bible Commentaries' },
  { id: 'theology', name: 'Theology' },
  { id: 'christian-living', name: 'Christian Living' },
  { id: 'devotionals', name: 'Devotionals' },
  { id: 'prayer-books', name: 'Prayer Books' },
  { id: 'christian-classics', name: 'Christian Classics' },
  { id: 'spiritual-growth', name: 'Spiritual Growth' },
  { id: 'martyrs-church-history', name: 'Martyrs & Christian History' },
];

export const BOOK_CATALOGUE = [
  {
    id: 'pilgrims-progress', gutenbergId: 131, featured: true,
    title: 'The Pilgrim’s Progress', author: 'John Bunyan', translator: null,
    description: 'The allegory of Christian’s journey from the City of Destruction to the Celestial City.',
    sections: ['featured', 'christian-classics'], licence: PD,
  },
  {
    id: 'foxes-book-of-martyrs', gutenbergId: 22400, featured: true,
    title: 'Fox’s Book of Martyrs', author: 'John Foxe', translator: null,
    description: 'The accounts of Christians who suffered and died for their faith, from the early church to the Reformation.',
    sections: ['featured', 'martyrs-church-history'], licence: PD,
  },
  {
    id: 'confessions-augustine', gutenbergId: 77585, featured: false,
    title: 'Confessions', author: 'Augustine of Hippo', translator: 'E. B. Pusey',
    description: 'Augustine’s account of his restless search, his conversion and his prayers to God.',
    sections: ['church-history', 'christian-classics'], licence: PD,
  },
  {
    id: 'following-of-christ', gutenbergId: 60377, featured: true,
    title: 'The Following of Christ', author: 'Thomas à Kempis', translator: 'Richard Challoner',
    description: 'Four books of devotional counsel on humility, the inner life and union with Christ.',
    sections: ['featured', 'devotionals', 'christian-classics'], licence: PD,
  },
  {
    id: 'humility-murray', gutenbergId: 57121, featured: false,
    title: 'Humility: The Beauty of Holiness', author: 'Andrew Murray', translator: null,
    description: 'Short chapters on humility as the root of every Christian grace.',
    sections: ['christian-living', 'spiritual-growth'], licence: PD,
  },
  {
    id: 'saints-everlasting-rest', gutenbergId: 58135, featured: false,
    title: 'The Saint’s Everlasting Rest', author: 'Richard Baxter', translator: null,
    description: 'A classic meditation on the rest that awaits believers in heaven, to strengthen the heart now.',
    sections: ['spiritual-growth', 'christian-classics'], licence: PD,
  },
  {
    id: 'around-the-wicket-gate', gutenbergId: 60669, featured: false,
    title: 'Around the Wicket Gate', author: 'C. H. Spurgeon', translator: null,
    description: 'Spurgeon’s short, plain-spoken counsel for those who are beginning the Christian life.',
    sections: ['devotionals', 'christian-living'], licence: PD,
  },
  {
    id: 'power-through-prayer', gutenbergId: 65115, featured: false,
    title: 'Power Through Prayer', author: 'E. M. Bounds', translator: null,
    description: 'Bounds on prayer as the source of spiritual power in the life of the believer and the church.',
    sections: ['prayer-books', 'spiritual-growth'], licence: PD,
  },
  {
    id: 'ministry-of-intercession', gutenbergId: 29296, featured: false,
    title: 'The Ministry of Intercession', author: 'Andrew Murray', translator: null,
    description: 'A plea for more prayer, and for prayer on behalf of others.',
    sections: ['prayer-books'], licence: PD,
  },
  {
    id: 'lord-teach-us-to-pray', gutenbergId: 26709, featured: false,
    title: 'Lord, Teach Us to Pray', author: 'Andrew Murray', translator: null,
    description: 'Andrew Murray’s guide to the Lord’s Prayer and to a life of prayer.',
    sections: ['prayer-books', 'spiritual-growth'], licence: PD,
  },
  {
    id: 'holy-in-christ', gutenbergId: 26990, featured: false,
    title: 'Holy in Christ', author: 'Andrew Murray', translator: null,
    description: 'Murray on living in Christ and being made holy through union with him.',
    sections: ['spiritual-growth', 'christian-living'], licence: PD,
  },
  {
    id: 'purpose-in-prayer', gutenbergId: 66112, featured: false,
    title: 'Purpose in Prayer', author: 'E. M. Bounds', translator: null,
    description: 'Bounds on praying with a clear purpose and a steady heart.',
    sections: ['prayer-books'], licence: PD,
  },
  {
    id: 'gleanings-among-the-sheaves', gutenbergId: 42657, featured: false,
    title: 'Gleanings among the Sheaves', author: 'C. H. Spurgeon', translator: null,
    description: 'Spurgeon’s short reflections on the harvest of grace, for daily reading.',
    sections: ['devotionals'], licence: PD,
  },
  // Added 2026-11-28. Each Gutenberg number was verified by reading the work's own text header (Title, Author,
  // Language, Translator lines) from the Project Gutenberg mirror. Source page: https://www.gutenberg.org/ebooks/<number>.
  // Translators and authors here all died before 1950, so each translation is also public domain in life-plus-70 countries.
  {
    id: 'practice-of-the-presence-of-god', gutenbergId: 5657, featured: false,
    title: 'The Practice of the Presence of God', author: 'Brother Lawrence', translator: null,
    description: 'The conversations and letters of Brother Lawrence on living in constant awareness of God in ordinary work.',
    sections: ['spiritual-growth', 'devotionals'], licence: PD,
  },
  {
    id: 'grace-abounding', gutenbergId: 654, featured: false,
    title: 'Grace Abounding to the Chief of Sinners', author: 'John Bunyan', translator: null,
    description: 'John Bunyan’s own account of his conversion, his struggles and the grace that met him.',
    sections: ['christian-biography', 'christian-classics'], licence: PD,
  },
  {
    id: 'life-of-john-bunyan', gutenbergId: 1037, featured: false,
    title: 'The Life of John Bunyan', author: 'Edmund Venables', translator: null,
    description: 'A biography of the Bedford preacher and author of The Pilgrim’s Progress.',
    sections: ['christian-biography'], licence: PD,
  },
  {
    id: 'smalcald-articles', gutenbergId: 273, featured: false,
    title: 'The Smalcald Articles', author: 'Martin Luther', translator: 'F. Bente',
    description: 'Luther’s confession of the chief articles of the Christian faith, written for a council of the church.',
    sections: ['theology'], licence: PD,
  },
  {
    id: 'good-works-luther', gutenbergId: 418, featured: false,
    title: 'A Treatise on Good Works', author: 'Martin Luther', translator: 'Johann Michael Reu',
    description: 'Luther on faith, the Ten Commandments and the good works that flow from a living faith.',
    sections: ['theology', 'christian-living'], licence: PD,
  },
  {
    id: 'augsburg-confession-apology', gutenbergId: 6744, featured: false,
    title: 'The Apology of the Augsburg Confession', author: 'Philipp Melanchthon', translator: 'F. Bente and W. H. T. Dau',
    description: 'Melanchthon’s defence of the Augsburg Confession, the foundational statement of Lutheran belief.',
    sections: ['theology'], licence: PD,
  },
  {
    id: 'romans-practical-exposition-gore', gutenbergId: 32673, featured: false,
    title: 'St. Paul’s Epistle to the Romans: A Practical Exposition (Vol. I)', author: 'Charles Gore', translator: null,
    description: 'Charles Gore’s practical exposition of Paul’s letter to the Romans, chapter by chapter, for reading and prayer.',
    sections: ['bible-commentaries'], licence: PD,
  },
  {
    id: 'romans-expositors-bible-moule', gutenbergId: 48858, featured: false,
    title: 'The Epistle of St Paul to the Romans (The Expositor’s Bible)', author: 'H. C. G. Moule', translator: null,
    description: 'Bishop Moule’s expository commentary on Romans, from The Expositor’s Bible series.',
    sections: ['bible-commentaries'], licence: PD,
  },
];
