// Seed data for communities, people, prayers, calendar, plans, chats. Example records
// so every screen opens in a working state; a backend replaces these.

export const USER = {
  id: 'me',
  displayName: 'Glen',
  username: 'glen.a',
  headline: 'Youth leader · Software engineer',
  country: 'Nigeria',
  languages: ['English', 'Yoruba'],
  church: { name: 'Grace Chapel Lagos', visible: true },
  profileVisibility: 'community-only',
  discoverable: { people: true, professionals: false, communities: true, churches: true },
  availability: 'requests',
  acceptsChat: ['Bible study', 'Prayer'],
  translation: 'KJV',
  interests: ['Gospels', 'Leadership', 'Prayer', 'Youth'],
  preset: 'Morning Devotion',
  presets: [
    { name: 'Morning Devotion', translation: 'KJV', layout: 'Distraction-free', audio: true, reminder: '06:30' },
    { name: 'Academic Study', translation: 'WEB', layout: 'Study panel', audio: false, reminder: null },
    { name: 'Group Study', translation: 'KJV', layout: 'Split screen', audio: false, reminder: 'Thu 19:00' },
    { name: 'Sermon Preparation', translation: 'KJV', layout: 'Notes-first', audio: false, reminder: null },
  ],
};

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
  { id: 'g7', name: 'Campus Fellowship · UNILAG', category: 'Youth', region: 'Nigeria', language: 'English', members: 450, verified: false, privacy: 'Public', description: 'Students at the University of Lagos. Weekly Bible study on Thursdays.', joined: false, rules: 'Students only.' },
  { id: 'g8', name: 'Grief & Hope', category: 'Life & family', region: 'Global', language: 'English', members: 1520, verified: true, privacy: 'Private', description: 'A moderated support group for those walking through loss.', joined: false, rules: 'Moderated. Private by default.' },
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
  { id: 'p1', name: 'Rev. Esther Mwangi', headline: 'Pastoral care · Nairobi', country: 'Kenya', languages: ['English', 'Swahili'], verified: ['Ministry role', 'Identity'], accepts: ['Prayer', 'Pastoral guidance'], availability: 'Available now', interests: ['Grief', 'Marriage'], mutual: 2, intro: 'Twelve years in pastoral care. Happy to pray with you or talk things through.' },
  { id: 'p2', name: 'David Okafor', headline: 'Product designer · Mentor', country: 'Nigeria', languages: ['English'], verified: ['Identity'], accepts: ['Professional', 'Mentoring'], availability: 'Selected times', interests: ['Career', 'Leadership'], mutual: 1, intro: 'Mentoring young designers and engineers. Faith and work.' },
  { id: 'p3', name: 'Maria Santos', headline: 'Licensed counselor (LPC)', country: 'Philippines', languages: ['English', 'Tagalog'], verified: ['Professional license', 'Identity'], accepts: ['Care / support'], availability: 'Message requests', interests: ['Anxiety', 'Family'], mutual: 0, intro: 'Licensed professional counselor. Christian, trauma-informed.' },
  { id: 'p4', name: 'Jonas Berg', headline: 'Bible study partner · Greek student', country: 'Sweden', languages: ['English', 'Swedish'], verified: [], accepts: ['Bible study', 'General chat'], availability: 'Available now', interests: ['Greek', 'Romans'], mutual: 1, intro: 'Reading through Romans in Greek. Looking for a study partner.' },
  { id: 'p5', name: 'Grace Adeyemi', headline: 'Worship leader · Vocal coach', country: 'UK', languages: ['English', 'Yoruba'], verified: ['Identity'], accepts: ['General chat', 'Mentoring'], availability: 'Selected times', interests: ['Worship', 'Youth'], mutual: 3, intro: 'Leading worship for 15 years. Coaching young worship leaders.' },
  { id: 'p6', name: 'Samuel Reyes', headline: 'Missionary · Church planter', country: 'Brazil', languages: ['Portuguese', 'Spanish', 'English'], verified: ['Ministry role'], accepts: ['Prayer', 'General chat'], availability: 'Not accepting', interests: ['Missions', 'Evangelism'], mutual: 0, intro: 'Planting churches in the north of Brazil.' },
];

export const CHATS = [
  { id: 'd1', with: 'Rev. Esther Mwangi', type: 'Prayer conversation', last: 'I will be praying for you this week.', time: '09:14', unread: 1, messages: [
    { id: 'x1', from: 'Glen', text: 'Thank you for agreeing to talk. I have been anxious about a decision at work.', mine: true, time: '09:02' },
    { id: 'x2', from: 'Rev. Esther Mwangi', text: 'Thank you for trusting me with that. Can I pray with you now, and then we talk through it?', time: '09:05' },
    { id: 'x3', from: 'Rev. Esther Mwangi', text: 'I will be praying for you this week.', time: '09:14' },
  ] },
  { id: 'd2', with: 'Jonas Berg', type: 'Bible study', last: 'Romans 8 on Thursday?', time: 'Yesterday', unread: 0, messages: [
    { id: 'y1', from: 'Jonas Berg', text: 'Romans 8 on Thursday?', time: 'Yesterday' },
  ] },
  { id: 'd3', with: 'David Okafor', type: 'Professional', last: 'Sent you the portfolio feedback.', time: 'Mon', unread: 0, messages: [
    { id: 'z1', from: 'David Okafor', text: 'Sent you the portfolio feedback.', time: 'Mon' },
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

export const WISHES = [
  { id: 'w1', author: 'Amaka O.', category: 'Mentor / collaborator', title: 'Looking for a Christian business mentor', body: 'Starting a small catering business in Lagos. Would love guidance from someone who has done it.', responses: ['Mentor connection', 'Advice', 'Prayer'], visibility: 'Community', replies: 4 },
  { id: 'w2', author: 'Glen', category: 'Prayer & spiritual growth', title: 'Pray before an important decision', body: 'Deciding between two roles this week.', responses: ['Prayer', 'Encouragement'], visibility: 'Connections', replies: 2, mine: true },
  { id: 'w3', author: 'Daniel M.', category: 'Education', title: 'Need study resources on Greek', body: 'Beginner Koine Greek. Any free resources?', responses: ['Resources', 'Advice'], visibility: 'Public', replies: 7 },
];

export const CALENDAR = [
  { id: 'e1', date: '2026-10-26', title: 'Youth Night', kind: 'Church event', where: 'Grace Chapel · Main Hall', time: '18:00', tradition: null, rsvp: true },
  { id: 'e2', date: '2026-10-29', title: 'Gospel of John · Day 7 live discussion', kind: 'Community', where: 'Online · Live room', time: '20:00', tradition: null, rsvp: false },
  { id: 'e3', date: '2026-10-31', title: 'Reformation Day', kind: 'Observance', where: null, time: null, tradition: 'Protestant', scripture: 'Romans 1:17', source: 'USC Christian Holy Days Calendar' },
  { id: 'e4', date: '2026-11-01', title: 'All Saints\' Day', kind: 'Observance', where: null, time: null, tradition: 'Western (Catholic, Anglican, Lutheran)', scripture: 'Hebrews 12:1', source: 'USC Christian Holy Days Calendar' },
  { id: 'e5', date: '2026-11-15', title: 'Harvest Thanksgiving', kind: 'Church event', where: 'Grace Chapel', time: '09:00', tradition: null, rsvp: false },
  { id: 'e6', date: '2026-11-21', title: 'Presentation of the Theotokos', kind: 'Observance', where: null, time: null, tradition: 'Orthodox', scripture: 'Luke 1:46-55', source: 'Greek Orthodox Archdiocese planner' },
  { id: 'e7', date: '2026-11-29', title: 'First Sunday of Advent', kind: 'Season', where: null, time: null, tradition: 'Western', scripture: 'Isaiah 9:6', source: 'USC Christian Holy Days Calendar' },
  { id: 'e8', date: '2026-12-25', title: 'Christmas Day', kind: 'Observance', where: null, time: null, tradition: 'Western', scripture: 'Luke 2:11', source: 'USC Christian Holy Days Calendar' },
  { id: 'e9', date: '2027-01-07', title: 'Christmas (Julian calendar)', kind: 'Observance', where: null, time: null, tradition: 'Orthodox · Ethiopian · Coptic', scripture: 'Matthew 2:1', source: 'Greek Orthodox Archdiocese planner' },
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
  { id: 'l3', title: 'Gospel of John · Day 7 discussion', host: 'Sarah K.', status: 'scheduled', when: 'Thu 20:00', language: 'English', captions: true, audience: 'Group' },
  { id: 'l4', title: 'Worship Night · Replay', host: 'Grace Adeyemi', status: 'replay', language: 'English', captions: true, audience: 'Followers' },
];

export const RECORDINGS = [
  { id: 'rc1', title: 'Sunday Sermon · The Genealogy of Grace', speaker: 'Pastor Tunde', passage: 'Matthew 1', duration: '38:12', status: 'transcribed', privacy: 'Church', refs: ['Matthew 1:1', 'Luke 3:23', 'Genesis 22:18'] },
  { id: 'rc2', title: 'Personal study · Psalm 23', speaker: 'Glen', passage: 'Psalm 23', duration: '12:40', status: 'draft', privacy: 'Private', refs: [] },
  { id: 'rc3', title: 'Youth talk · Anxiety', speaker: 'Glen', passage: 'Philippians 4', duration: '21:05', status: 'failed', privacy: 'Private', refs: [] },
];

export const FEED = [
  { id: 'f1', author: 'Grace Chapel Lagos', kind: 'Announcement', text: 'Harvest Thanksgiving · Sunday 15 Nov. Bring your family.', time: '2h', likes: 48, comments: 6 },
  { id: 'f2', author: 'Sarah K.', kind: 'Reflection', text: 'John 3:8. The wind blows where it wishes. I keep trying to schedule the Spirit.', time: '4h', likes: 120, comments: 18, passage: { bookId: 'JHN', chapter: 3 } },
  { id: 'f3', author: 'Chidi N.', kind: 'Answered prayer', text: 'Passed all my finals. Thank you to everyone in the Prayer channel.', time: '1d', likes: 230, comments: 41 },
  { id: 'f4', author: 'Christian Software Engineers', kind: 'Job', text: 'Senior React Native engineer, remote, faith-based nonprofit. Apply in the group.', time: '1d', likes: 12, comments: 3 },
  { id: 'f5', author: 'Grace Adeyemi', kind: 'Worship', text: 'New arrangement of "It Is Well". Replay available in Live.', time: '2d', likes: 310, comments: 27 },
];

export const CARE_OPTIONS = [
  'I need someone to talk to', 'I need prayer', 'I need encouragement', 'I want to study the Bible with someone',
  'I need pastoral guidance', 'I want a qualified counselor', 'I need a career or ministry mentor', 'I want to encourage others', 'I want to join a support group',
];

export const COMPANION_CATEGORIES = ['Hope', 'Grief', 'Fear', 'Forgiveness', 'Relationships', 'Marriage & family', 'Wisdom', 'Work & finances', 'Faith & doubt', 'Prayer', 'Personal growth', 'Difficult passages'];
