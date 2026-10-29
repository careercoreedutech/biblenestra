// Seed data for communities, people, prayers, calendar, plans, chats,
// Christian short-videos, virtual gifts, jobs/tasks marketplace, and channels.

export const USER = {
  id: 'me',
  displayName: 'Glen',
  username: 'glen.a',
  headline: 'Youth leader · Software engineer',
  country: 'Nigeria',
  languages: ['English', 'Yoruba'],
  church: { name: 'Grace Chapel Lagos', visible: true },
  profileVisibility: 'community-only',
  discoverable: { people: true, professionals: true, communities: true, churches: true },
  availability: 'Available for ministry projects',
  acceptsChat: ['Bible study', 'Prayer', 'Work inquiries'],
  translation: 'KJV',
  interests: ['Gospels', 'Leadership', 'Prayer', 'Software Development'],
  coins: 350, // Virtual coins balance for gifting
};

export const GIFTS = [
  { id: 'g_rose', name: 'Rose', price: 5, icon: 'heart', desc: 'Affordable everyday appreciation' },
  { id: 'g_bouquet', name: 'Flower Bouquet', price: 25, icon: 'sparkles', desc: 'A more expressive thank-you gift' },
  { id: 'g_star', name: 'Golden Star', price: 100, icon: 'star', desc: 'Premium appreciation gift' },
  { id: 'g_crown', name: 'Royal Crown', price: 500, icon: 'coin', desc: 'High-value creator-support gift' },
];

export const VIDEOS = [
  {
    id: 'v1',
    creator: { name: 'Pastor Tunde', handle: '@pastortunde', verified: true, avatar: 'PT', church: 'Grace Chapel Lagos' },
    caption: 'Why did Matthew include Tamar, Rahab, Ruth & Bathsheba in Jesus\'s genealogy? Grace rewrites family stories.',
    scripture: 'Matthew 1:5',
    category: 'Sermons',
    hashtags: ['#GenealogyOfGrace', '#BibleStudy', '#Gospel', '#JesusSaves'],
    duration: '0:58',
    sound: 'Original Sermon Audio · Pastor Tunde',
    videoUrl: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
    bg: '#142921',
    views: '24.8K',
    likes: 1840,
    liked: false,
    shares: 312,
    reposts: 95,
    gifts: 42,
    comments: [
      { id: 'c1', from: 'Sarah K.', text: 'This changed my whole perspective on generational blessings!', time: '2h', likes: 24, replies: [
        { id: 'cr1', from: 'Pastor Tunde', text: 'Amen Sarah! God breaks generational curses.', time: '1h' }
      ] },
      { id: 'c2', from: 'Daniel M.', text: 'Rahab\'s scarlet cord points straight to the cross.', time: '3h', likes: 18, replies: [] },
    ],
  },
  {
    id: 'v2',
    creator: { name: 'Grace Adeyemi', handle: '@graceadeyemi', verified: true, avatar: 'GA', church: 'Worship City UK' },
    caption: 'Acoustic worship session: "It Is Well With My Soul" recorded live at sunset. Rest in His peace today.',
    scripture: 'Psalm 23:2',
    category: 'Worship',
    hashtags: ['#AcousticWorship', '#ItIsWell', '#Peace', '#SpiritualRest'],
    duration: '1:15',
    sound: 'Live Acoustic Session · Grace Adeyemi',
    videoUrl: 'https://lorem.video/720p_h264_10s.mp4',
    bg: '#1a2736',
    views: '48.2K',
    likes: 4210,
    liked: true,
    shares: 980,
    reposts: 340,
    gifts: 156,
    comments: [
      { id: 'c3', from: 'Amaka O.', text: 'Your voice is so anointed. Tears in my eyes listening to this.', time: '4h', likes: 32, replies: [] },
    ],
  },
  {
    id: 'v3',
    creator: { name: 'Dr. Samuel Reyes', handle: '@samuelreyes', verified: true, avatar: 'SR', church: 'Amazon Basin Missions' },
    caption: 'Crossing the river to deliver Bibles in indigenous dialects. The harvest is plentiful!',
    scripture: 'Romans 10:14',
    category: 'Evangelism',
    hashtags: ['#Missions', '#GreatCommission', '#BibleTranslation', '#FaithInAction'],
    duration: '0:45',
    sound: 'River Journey Atmosphere · Field Audio',
    videoUrl: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/friday.mp4',
    bg: '#2e261a',
    views: '19.4K',
    likes: 2150,
    liked: false,
    shares: 420,
    reposts: 110,
    gifts: 78,
    comments: [
      { id: 'c4', from: 'Chidi N.', text: 'Praying for your safety and fruitfulness in the field!', time: '1d', likes: 15, replies: [] },
    ],
  },
  {
    id: 'v4',
    creator: { name: 'David Okafor', handle: '@davidokafor', verified: false, avatar: 'DO', church: 'Lagos Fellowship' },
    caption: 'When you try to schedule the Holy Spirit but John 3:8 reminds you the wind blows where it wishes.',
    scripture: 'John 3:8',
    category: 'Christian Comedy',
    hashtags: ['#ChristianHumor', '#Relatable', '#HolySpirit', '#FaithLife'],
    duration: '0:32',
    sound: 'Original Funny Commentary · David',
    videoUrl: 'https://raw.githubusercontent.com/intel-iot-devkit/sample-videos/master/person-bicycle-car-detection.mp4',
    bg: '#251b29',
    views: '35.1K',
    likes: 3890,
    liked: false,
    shares: 1140,
    reposts: 412,
    gifts: 65,
    comments: [
      { id: 'c5', from: 'Glen', text: 'This happens to me every single Sunday morning haha!', time: '5h', likes: 45, replies: [] },
    ],
  },
  {
    id: 'v5',
    creator: { name: 'Sister Mary O\'Connor', handle: '@maryoconnor', verified: true, avatar: 'MO', church: 'Dublin Faith Center' },
    caption: 'Morning meditation on God\'s handiwork: The heavens declare the glory of God, and the sky proclaims His craftsmanship.',
    scripture: 'Psalm 19:1',
    category: 'Devotional',
    hashtags: ['#Creation', '#MorningPrayer', '#GloryOfGod', '#FaithWalk'],
    duration: '0:40',
    sound: 'Gentle Morning Chimes · Sister Mary',
    videoUrl: 'https://lorem.video/720p.mp4',
    bg: '#1e293b',
    views: '12.6K',
    likes: 1940,
    liked: false,
    shares: 380,
    reposts: 124,
    gifts: 51,
    comments: [
      { id: 'c6', from: 'Patrick', text: 'Amen! God\'s creation never fails to leave me in awe.', time: '6h', likes: 21, replies: [] },
    ],
  },
  {
    id: 'v6',
    creator: { name: 'Caleb & The Gathering', handle: '@calebgathering', verified: true, avatar: 'CG', church: 'Sanctuary Worship' },
    caption: 'Spontaneous praise session: "Great is Your faithfulness, Lord unto me." Nothing compares to His presence!',
    scripture: 'Lamentations 3:23',
    category: 'Worship',
    hashtags: ['#PraiseBreak', '#FaithfulGod', '#WorshipNight', '#Jesus'],
    duration: '1:02',
    sound: 'Live Sanctuary Acoustics · Caleb',
    videoUrl: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
    bg: '#312e81',
    views: '29.3K',
    likes: 3120,
    liked: true,
    shares: 740,
    reposts: 280,
    gifts: 112,
    comments: [
      { id: 'c7', from: 'Esther', text: 'Listening to this on repeat while working today. God bless you all!', time: '3h', likes: 38, replies: [] },
    ],
  },
];

export const JOBS = [
  {
    id: 'job1',
    kind: 'job',
    title: 'Senior React Native Developer for Bible Translation App',
    client: { name: 'Wycliffe Global Partners', church: 'Faith Missions Alliance', verified: true },
    category: 'Software & Web Development',
    budget: '$3,500 – $4,500 / mo',
    deadline: 'Full-time · Remote',
    skills: ['React Native', 'Expo', 'TypeScript', 'Offline SQLite', 'Hermes'],
    description: 'We are expanding our mobile Scripture delivery platform to reach 50+ regional languages. Seeking an experienced React Native developer passionate about spreading God\'s Word.',
    proposalsCount: 6,
    status: 'open',
    posted: '2 days ago',
  },
  {
    id: 'job2',
    kind: 'task',
    title: 'Edit 5 Sermon Videos for Social Reels & YouTube Shorts',
    client: { name: 'Grace Spring Church', church: 'Grace Fellowship', verified: true },
    category: 'Graphic Design & Video Editing',
    budget: '$250 Fixed',
    deadline: '5 Days Delivery',
    skills: ['Premiere Pro', 'CapCut', 'Subtitles/Captions', 'Color Grading'],
    description: 'Cut 5 high-impact clips (under 60s) from our Sunday service. Add accurate subtitles, royalty-free background pad, and clean brand hooks.',
    proposalsCount: 11,
    status: 'open',
    posted: '1 day ago',
  },
  {
    id: 'job3',
    kind: 'task',
    title: 'Virtual Assistant for Church Outreach Administration',
    client: { name: 'Pastor Ade', church: 'Harvest International Lagos', verified: true },
    category: 'Virtual Assistants',
    budget: '$400 / month',
    deadline: '10 hrs/week · Ongoing',
    skills: ['Email Management', 'Google Sheets', 'Calendar Coordination', 'Member Care'],
    description: 'Help coordinate visitor follow-ups, prayer request logging, and monthly event reminders for a congregation of 500 members.',
    proposalsCount: 8,
    status: 'open',
    posted: '3 days ago',
  },
  {
    id: 'job4',
    kind: 'job',
    title: 'Worship Music Producer / Mixing Engineer',
    client: { name: 'Zion Sound Records', church: 'Redeemed Music Ministry', verified: true },
    category: 'Worship Musicians & Producers',
    budget: '$800 per EP Track',
    deadline: 'Contract · 3 Tracks',
    skills: ['Logic Pro / Pro Tools', 'Vocal Tuning', 'Mastering', 'Acoustic Guitar Mixing'],
    description: 'Production and mixing for a 3-track acoustic worship EP. Looking for a producer with deep appreciation for atmospheric sacred music.',
    proposalsCount: 4,
    status: 'open',
    posted: 'Just now',
  },
  {
    id: 'job5',
    kind: 'task',
    title: 'Translate 20 Devotional Articles from English to Yoruba',
    client: { name: 'West Africa Gospel Network', church: 'BSN Nigeria', verified: true },
    category: 'Writers, Editors & Translators',
    budget: '$300 Fixed',
    deadline: '2 Weeks',
    skills: ['Yoruba Fluency', 'Theological Translation', 'Proofreading'],
    description: 'Faithful translation of 20 daily devotional guides into standard written Yoruba with proper diacritics and scripture accuracy.',
    proposalsCount: 5,
    status: 'open',
    posted: '4 days ago',
  },
];

export const CHANNELS_DATA = [
  {
    id: 'ch1',
    name: 'Grace Spring Church',
    tagline: 'A family of believers walking in grace, truth, and community.',
    followers: '14.2K',
    category: 'Church Ministry',
    language: 'English · Yoruba',
    videoThumbnail: '#173d32',
    videoTitle: 'Welcome to Grace Spring: Our Heart & Mission',
    videoDuration: '1:45',
    recentPost: 'Sunday Service Live streaming tomorrow at 9:00 AM & 11:00 AM. Join us!',
  },
  {
    id: 'ch2',
    name: 'The Global Bible Project',
    tagline: 'Exploring the literary beauty and unified message of Scripture.',
    followers: '68.5K',
    category: 'Bible Education',
    language: 'Multilingual',
    videoThumbnail: '#2e261a',
    videoTitle: 'How to Read Biblical Poetry: The Psalms',
    videoDuration: '3:10',
    recentPost: 'New animated video series walking through Psalms 23 and the Good Shepherd motif.',
  },
  {
    id: 'ch3',
    name: 'Nairobi Worship Collective',
    tagline: 'Equipping and inspiring the African worship leaders of tomorrow.',
    followers: '9.8K',
    category: 'Music & Worship',
    language: 'English · Swahili',
    videoThumbnail: '#1b2b38',
    videoTitle: 'Swahili & English Worship Acoustic Session',
    videoDuration: '2:20',
    recentPost: 'Next worship workshop scheduled for Saturday Nov 21 at All Saints Cathedral.',
  },
];

export const CHURCHES = [
  { id: 'c1', name: 'Grace Chapel Lagos', location: 'Lagos, Nigeria', tradition: 'Pentecostal', verified: true, members: 1240, join: 'approval' },
  { id: 'c2', name: 'St. Andrew\'s Anglican Church', location: 'Nairobi, Kenya', tradition: 'Anglican', verified: true, members: 860, join: 'auto' },
  { id: 'c3', name: 'Redeemer Presbyterian', location: 'New York, USA', tradition: 'Presbyterian', verified: true, members: 3100, join: 'approval' },
  { id: 'c4', name: 'Holy Trinity Orthodox Cathedral', location: 'Athens, Greece', tradition: 'Greek Orthodox', verified: true, members: 540, join: 'invite' },
  { id: 'c5', name: 'Hillside Baptist Church', location: 'Manila, Philippines', tradition: 'Baptist', verified: false, members: 210, join: 'auto' },
  { id: 'c6', name: 'Igreja Batista da Lagoinha', location: 'Belo Horizonte, Brazil', tradition: 'Baptist', verified: true, members: 5200, join: 'approval' },
];

export const COMMUNITY_CATEGORIES = ['All', 'Churches', 'Bible books', 'Prayer', 'Life & family', 'Youth', 'Learning', 'Professionals', 'Online study', 'New believers', 'Regions'];

export const COMMUNITIES = [
  { id: 'g1', name: 'Grace Chapel Lagos', category: 'Churches', region: 'Nigeria', language: 'English', members: 1240, verified: true, privacy: 'Private', description: 'Official church community for members of Grace Chapel. Announcements, prayer, and Bible studies.', joined: true, rules: 'Be kind. No fundraising without admin approval.' },
  { id: 'g2', name: 'Gospel of John · 21 Days', category: 'Bible books', region: 'Global', language: 'English', members: 4820, verified: false, privacy: 'Public', description: 'A chapter-a-day walk through John with daily discussion prompts.', joined: true, rules: 'Stay on the day\'s passage.' },
  { id: 'g3', name: 'Night Watch Prayer', category: 'Prayer', region: 'Global', language: 'English', members: 2130, verified: false, privacy: 'Public', description: 'Intercessors who pray between 11pm and 3am in their local time zone.', joined: false, rules: 'Sensitive requests stay in the group.' },
  { id: 'g4', name: 'Christian Software Engineers', category: 'Professionals', region: 'Global', language: 'English', members: 980, verified: false, privacy: 'Public', description: 'Faith and work for developers, designers and founders. Job posts on Fridays.', joined: false, rules: 'No recruiter spam.' },
  { id: 'g5', name: 'Young Marrieds · Nairobi', category: 'Life & family', region: 'Kenya', language: 'English · Swahili', members: 310, verified: false, privacy: 'Private', description: 'Couples in their first ten years of marriage. Monthly meetups.', joined: false, rules: 'Confidential.' },
  { id: 'g6', name: 'New Believers Welcome', category: 'New believers', region: 'Global', language: 'English', members: 6700, verified: true, privacy: 'Public', description: 'Ask anything. Mentors reply within a day.', joined: false, rules: 'No question is too basic.' },
];

export const CHANNELS = ['General', 'Prayer', 'Bible Study', 'Announcements', 'Events'];

export const GROUP_MESSAGES = {
  g1: {
    General: [
      { id: 'm1', from: 'Pastor Tunde', text: 'Welcome everyone to the Grace Chapel community. Sunday service is 9am and 11am.', time: '08:12', pinned: true },
      { id: 'm2', from: 'Amaka O.', text: 'Is the youth meeting still on for Friday?', time: '08:40' },
      { id: 'm3', from: 'Glen', text: 'Yes, 6pm in the main hall. Bring a friend.', time: '08:41', mine: true },
    ],
    Prayer: [
      { id: 'm4', from: 'Bola A.', text: 'Please pray for my mother\'s surgery on Tuesday.', time: '07:02', prayer: true, praying: 14 },
      { id: 'm5', from: 'Chidi N.', text: 'Praying with you, Bola.', time: '07:10' },
    ],
    'Bible Study': [
      { id: 'm6', from: 'Pastor Tunde', text: 'This week: Matthew 1. Why does Matthew include Tamar, Rahab, Ruth and Bathsheba?', time: 'Mon', passage: { bookId: 'MAT', chapter: 1 } },
    ],
    Announcements: [
      { id: 'm7', from: 'Admin', text: 'Harvest Thanksgiving is Sunday 15 Nov. Volunteers needed for ushering.', time: 'Sun', pinned: true },
    ],
    Events: [
      { id: 'm8', from: 'Admin', text: 'Youth Night · Fri 6pm · Main Hall', time: 'Sun', event: true },
    ],
  },
  g2: {
    General: [
      { id: 'n1', from: 'Sarah K.', text: 'Day 3 today. John 3 is one of my favourites.', time: '06:30' },
      { id: 'n2', from: 'Daniel M.', text: 'Verse 8 about the wind has always puzzled me. Thoughts?', time: '06:45' },
    ],
    Prayer: [], 'Bible Study': [{ id: 'n3', from: 'Host', text: 'Discussion prompt for Day 3: what does "born again" mean in context?', time: '05:00', passage: { bookId: 'JHN', chapter: 3 } }], Announcements: [], Events: [],
  },
};

export const PEOPLE = [
  { id: 'p1', name: 'Rev. Esther Mwangi', username: '@esther_m', avatar: 'EM', headline: 'Pastoral care & Family counselor', church: 'St. Andrew\'s Anglican', country: 'Kenya', languages: ['English', 'Swahili'], verified: ['Ministry role', 'Identity'], accepts: ['Prayer', 'Pastoral guidance'], availability: 'Available now', skills: ['Counseling', 'Pastoral Care', 'Preaching'], interests: ['Grief', 'Marriage', 'Spiritual Growth'], mutual: 2, intro: 'Twelve years in pastoral care. Happy to pray with you or talk things through.' },
  { id: 'p2', name: 'David Okafor', username: '@david_o', avatar: 'DO', headline: 'UI/UX Product Designer & Video Creator', church: 'Grace Chapel Lagos', country: 'Nigeria', languages: ['English', 'Igbo'], verified: ['Identity'], accepts: ['Professional', 'Mentoring'], availability: 'Selected times', skills: ['Figma', 'Video Editing', 'Product Design'], interests: ['Career', 'Leadership', 'Youth'], mutual: 1, intro: 'Mentoring young designers and engineers. Faith and work in technology.' },
  { id: 'p3', name: 'Maria Santos', username: '@maria_s', avatar: 'MS', headline: 'Licensed Counselor (LPC) & Speaker', church: 'Hillside Baptist', country: 'Philippines', languages: ['English', 'Tagalog'], verified: ['Professional license', 'Identity'], accepts: ['Care / support'], availability: 'Message requests', skills: ['Trauma Therapy', 'Family Counseling'], interests: ['Anxiety', 'Family', 'Mental Health'], mutual: 0, intro: 'Licensed professional counselor. Christian, trauma-informed guidance.' },
  { id: 'p4', name: 'Jonas Berg', username: '@jonas_b', avatar: 'JB', headline: 'Koine Greek Student & Seminary Scholar', church: 'Grace Lutheran', country: 'Sweden', languages: ['English', 'Swedish'], verified: [], accepts: ['Bible study', 'General chat'], availability: 'Available now', skills: ['Biblical Greek', 'Manuscript Study'], interests: ['Greek', 'Romans', 'Theology'], mutual: 1, intro: 'Reading through Romans in Greek. Looking for a study partner.' },
  { id: 'p5', name: 'Grace Adeyemi', username: '@grace_worship', avatar: 'GA', headline: 'Worship Leader, Songwriter & Vocal Coach', church: 'Worship City UK', country: 'UK', languages: ['English', 'Yoruba'], verified: ['Identity'], accepts: ['General chat', 'Mentoring'], availability: 'Selected times', skills: ['Vocal Coaching', 'Worship Leading', 'Songwriting'], interests: ['Worship', 'Youth', 'Music Production'], mutual: 3, intro: 'Leading worship for 15 years. Coaching and mentoring worship teams.' },
  { id: 'p6', name: 'Samuel Reyes', username: '@samuel_missions', avatar: 'SR', headline: 'Church Planter & Cross-Cultural Missionary', church: 'Amazon Basin Missions', country: 'Brazil', languages: ['Portuguese', 'Spanish', 'English'], verified: ['Ministry role'], accepts: ['Prayer', 'General chat'], availability: 'Field missions', skills: ['Church Planting', 'Discipleship', 'Translation'], interests: ['Missions', 'Evangelism'], mutual: 0, intro: 'Planting churches and translating Scripture along the Amazon river basin.' },
];

export const CHATS = [
  { id: 'd1', with: 'Rev. Esther Mwangi', username: '@esther_m', avatar: 'EM', type: 'Prayer conversation', last: 'I will be praying for you this week.', time: '09:14', unread: 1, messages: [
    { id: 'x1', from: 'Glen', text: 'Thank you for agreeing to talk. I have been anxious about a decision at work.', mine: true, time: '09:02', status: 'read' },
    { id: 'x2', from: 'Rev. Esther Mwangi', text: 'Thank you for trusting me with that. Can I pray with you now, and then we talk through it?', time: '09:05', status: 'delivered' },
    { id: 'x3', from: 'Rev. Esther Mwangi', text: 'I will be praying for you this week.', time: '09:14', status: 'delivered' },
  ] },
  { id: 'd2', with: 'Jonas Berg', username: '@jonas_b', avatar: 'JB', type: 'Bible study', last: 'Romans 8 on Thursday?', time: 'Yesterday', unread: 0, messages: [
    { id: 'y1', from: 'Jonas Berg', text: 'Romans 8 on Thursday?', time: 'Yesterday', status: 'read' },
  ] },
  { id: 'd3', with: 'David Okafor', username: '@david_o', avatar: 'DO', type: 'Professional', last: 'Sent you the portfolio feedback.', time: 'Mon', unread: 0, messages: [
    { id: 'z1', from: 'David Okafor', text: 'Sent you the portfolio feedback.', time: 'Mon', status: 'read' },
  ] },
];

export const MESSAGE_REQUESTS = [
  { id: 'r1', from: 'Samuel Reyes', text: 'Hi Glen, we met in the Missions group. Could I ask about youth outreach in Lagos?' },
];

export const PRAYERS = [
  { id: 'pr1', author: 'Bola A.', audience: 'Church', title: 'Mother\'s surgery on Tuesday', body: 'Please pray for a successful surgery and quick recovery.', status: 'active', praying: 14, updates: [], created: '2d', verse: null, anonymous: false },
  { id: 'pr2', author: 'Glen', audience: 'Private', title: 'Wisdom for a job decision', body: 'Two offers. I want to choose where I can serve best.', status: 'active', praying: 0, updates: [], created: '1d', verse: 'PHP 4:6', anonymous: false, mine: true },
  { id: 'pr3', author: 'Anonymous', audience: 'Public', title: 'Strength through a hard season', body: 'Going through loss. Just need to know people are praying.', status: 'receiving', praying: 87, updates: [{ text: 'Thank you all. Felt carried this week.', when: '3h' }], created: '5d', verse: 'PSA 23', anonymous: true },
  { id: 'pr4', author: 'Chidi N.', audience: 'Community', title: 'Exams next week', body: 'Final year exams. Pray for focus and peace.', status: 'answered', praying: 22, updates: [{ text: 'Answered! Passed everything. God is faithful.', when: '1d' }], created: '3w', verse: null, anonymous: false },
];

export const CALENDAR = [
  { id: 'e1', date: '2026-10-26', title: 'Youth Night', kind: 'Church event', where: 'Grace Chapel · Main Hall', time: '18:00', tradition: null, rsvp: true },
  { id: 'e2', date: '2026-10-29', title: 'Gospel of John · Day 7 live discussion', kind: 'Community', where: 'Online · Live room', time: '20:00', tradition: null, rsvp: false },
  { id: 'e3', date: '2026-10-31', title: 'Reformation Day', kind: 'Observance', where: null, time: null, tradition: 'Protestant', scripture: 'Romans 1:17', source: 'USC Christian Holy Days Calendar' },
  { id: 'e4', date: '2026-11-01', title: 'All Saints\' Day', kind: 'Observance', where: null, time: null, tradition: 'Western (Catholic, Anglican, Lutheran)', scripture: 'Hebrews 12:1', source: 'USC Christian Holy Days Calendar' },
  { id: 'e5', date: '2026-11-15', title: 'Harvest Thanksgiving', kind: 'Church event', where: 'Grace Chapel', time: '09:00', tradition: null, rsvp: false },
];

export const PLANS = [
  { id: 'pl1', name: 'Gospel of John · 21 Days', days: 21, done: 6, today: { bookId: 'JHN', chapter: 3 }, shared: true, participants: ['Sarah K.', 'Daniel M.'], streak: 6, reminder: '06:30' },
  { id: 'pl2', name: 'Psalms of Comfort', days: 14, done: 2, today: { bookId: 'PSA', chapter: 23 }, shared: false, participants: [], streak: 2, reminder: null },
  { id: 'pl3', name: 'Advent · Waiting for the King', days: 28, done: 0, today: { bookId: 'MAT', chapter: 1 }, shared: false, participants: [], streak: 0, reminder: null, startsOn: '2026-11-29' },
];

export const DEVOTIONALS = [
  { id: 'dv1', title: 'Peace That Guards', author: 'Grace Chapel Devotional Team', tradition: 'Pentecostal', passage: { bookId: 'PHP', chapter: 4 }, body: 'Paul writes from prison, yet his instruction is to rejoice. The peace he describes is not the absence of trouble but a guard set around the heart.', question: 'Where do you need a guard today?' },
  { id: 'dv2', title: 'Born of the Spirit', author: 'Rev. Esther Mwangi', tradition: 'Anglican', passage: { bookId: 'JHN', chapter: 3 }, body: 'Nicodemus came with questions and left with a mystery. Faith often begins the same way.', question: 'What question are you bringing to Jesus tonight?' },
];

export const MEMORY_DECK = [
  { id: 'mv1', ref: 'Philippians 4:13', bookId: 'PHP', chapter: 4, verse: 13, confidence: 3, due: 'Today' },
  { id: 'mv2', ref: 'John 3:16', bookId: 'JHN', chapter: 3, verse: 16, confidence: 5, due: 'In 4 days' },
  { id: 'mv3', ref: 'Psalm 23:1', bookId: 'PSA', chapter: 23, verse: 1, confidence: 4, due: 'Tomorrow' },
];

export const COURSES = [
  { id: 'co1', title: 'Reading the Gospels Well', provider: 'Nairobi Bible Institute', level: 'Beginner', lessons: 8, done: 3, mode: 'Self-study', duration: '4 weeks' },
  { id: 'co2', title: 'Introduction to Koine Greek', provider: 'Open Seminary', level: 'Intermediate', lessons: 12, done: 0, mode: 'Live cohort', duration: '12 weeks' },
  { id: 'co3', title: 'Leading a Small Group', provider: 'Grace Chapel', level: 'Beginner', lessons: 5, done: 5, mode: 'Church', duration: '2 weeks', certificate: true },
];

export const LIVE = [
  { id: 'l1', title: 'Wednesday Bible Study · Matthew 1', host: 'Grace Chapel Lagos', status: 'live', viewers: 214, language: 'English', captions: true, audience: 'Community' },
  { id: 'l2', title: 'Night Watch Prayer Room', host: 'Night Watch Prayer', status: 'live', viewers: 58, language: 'English', captions: false, audience: 'Public' },
];

export const CARE_OPTIONS = [
  'I need someone to talk to', 'I need prayer', 'I need encouragement', 'I want to study the Bible with someone',
  'I need pastoral guidance', 'I want a qualified counselor', 'I need a career or ministry mentor', 'I want to encourage others', 'I want to join a support group',
];

export const COMPANION_CATEGORIES = ['Hope', 'Grief', 'Fear', 'Forgiveness', 'Relationships', 'Marriage & family', 'Wisdom', 'Work & finances', 'Faith & doubt', 'Prayer', 'Personal growth', 'Difficult passages'];
