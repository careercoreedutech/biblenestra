// DEV ONLY — demo memberships for the local preview (never imported by src/). Run with
//   node dev/server.mjs --seed-memberships        (seeds once, when no membership exists yet)
// Everything goes through the real API as the dev admin, so plans, conversations, grants and reviews behave as in prod.
//
// Cover images: Unsplash (Unsplash License — free to use, no attribution required). Source URLs:
//   School of Prayer ............. https://images.unsplash.com/photo-1533000759938-aa0ba70beceb
//   Inductive Bible Study ........ https://images.unsplash.com/photo-1504052434569-70ad5836ab65
//   Worship Leaders Academy ...... https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4
//   Kingdom Business Mentorship .. https://images.unsplash.com/photo-1519791883288-dc8bd696e667
//   Marriage God’s Way ........... https://images.unsplash.com/photo-1529156069898-49953e39b3ac
//   Youth Discipleship Circle .... https://images.unsplash.com/photo-1544531586-fde5298cdd40
import { createApp } from '../src/index.js';

const img = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1200&h=675&q=80`;
const N = (naira) => naira * 100; // kobo

const OWNERS = [
  { key: 'pastor_grace', name: 'Pastor Grace Okafor', handle: 'pastorgrace', bio: 'Intercessor and teacher for 18 years. Leads the Lagos House of Prayer and trains prayer teams across West Africa.', avatar: 'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=crop&w=200&h=200&q=80' },
  { key: 'dr_samuel', name: 'Dr. Samuel Adeyemi', handle: 'drsamuel', bio: 'New Testament lecturer (PhD, Biblical Studies). Helps everyday believers read Scripture carefully and joyfully.', avatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=200&h=200&q=80' },
  { key: 'minister_joy', name: 'Minister Joy Nwosu', handle: 'ministerjoy', bio: 'Worship pastor, songwriter and vocal coach. Has trained over 400 choir and praise-team members.', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&h=200&q=80' },
  { key: 'elder_david', name: 'Elder David Mensah', handle: 'elderdavid', bio: 'Founder of three companies and a church elder in Accra. Mentors Christian founders to build with integrity.', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&h=200&q=80' },
];
const REVIEWERS = ['Ngozi Eze', 'Michael Johnson', 'Blessing Adeyemi', 'Chinedu Okeke', 'Esther Mensah', 'Daniel Obi', 'Ruth Afolabi', 'Samuel Kariuki', 'Faith Wanjiru', 'Joseph Asante'];

const MEMBERSHIPS = [
  {
    owner: 'pastor_grace', title: 'School of Prayer', category: 'Prayer', cover: img('photo-1533000759938-aa0ba70beceb'), sortOrder: 3,
    introVideoUrl: 'https://www.youtube.com/watch?v=Kk8xXZG1y7k',
    headline: 'Learn to pray with power, faith and consistency',
    description: 'A 12-week guided journey into a life of prayer. Live classes every Tuesday, daily prayer prompts in the channel and a community of intercessors who will pray with you.',
    benefits: ['Weekly live prayer class (Tuesdays, 7pm WAT)', 'Daily prayer prompts in the channel', 'Prayer partners matched by city', 'Certificate after 12 weeks'],
    faqs: [
      { q: 'Is this for beginners?', a: 'Yes. We start from the Lord’s Prayer and build week by week. Seasoned intercessors are welcome too.' },
      { q: 'What if I miss a live class?', a: 'Every class is recorded and added to the Library within 24 hours.' },
      { q: 'Can my church prayer team join together?', a: 'Yes — ask an admin about a group grant for your team.' },
      { q: 'How do I cancel?', a: 'You can cancel anytime; you keep access until the end of the period you paid for.' },
    ],
    questions: [{ label: 'Which church or fellowship do you attend?', required: true }, { label: 'Is there anything you would like us to pray about with you?', required: false }],
    plans: [{ name: 'Monthly', priceMinor: N(5000), interval: 'month' }, { name: 'Yearly', priceMinor: N(50000), interval: 'year' }],
    lessons: [
      ['Week 1 · Why we pray', 'video', 'https://www.youtube.com/watch?v=Kk8xXZG1y7k', 32, true],
      ['Week 2 · The Lord’s Prayer, line by line', 'video', 'https://www.youtube.com/watch?v=Kk8xXZG1y7k', 41, true],
      ['Prayer journal template (PDF)', 'file', 'https://www.africau.edu/images/default/sample.pdf', null, false],
      ['Week 3 · Praying the Psalms', 'text', null, 12, false],
      ['Week 4 · Fasting and prayer', 'text', null, 15, false],
    ],
    reviews: [[5, 'This school changed my mornings. I finally have a prayer life that is not just emergencies.'], [5, 'Pastor Grace teaches with so much grace and clarity. The prayer partners are a blessing.'], [4, 'Very good. I wish the live class was a bit earlier for those of us in East Africa.'], [5, 'Worth every naira. The Psalms week was my favourite.'], [5, 'Our whole choir joined and our rehearsals now start in real prayer.']],
    posts: ['Welcome to the School of Prayer! 🙏 This week we begin with “Why we pray”. The recording is in the Library.', 'Prayer prompt for today: Psalm 46:10 — “Be still, and know that I am God.” Spend five quiet minutes with this verse before you speak.', 'Live class tonight at 7pm WAT. Bring your journal and one request you have stopped praying about.'],
    chat: [['Ngozi Eze', 'Good morning family! Who is doing the 6am prayer watch this week?'], ['Michael Johnson', 'Count me in. Psalm 46 has been speaking to me all week.'], ['Blessing Adeyemi', 'Please remember my mum’s surgery on Thursday 🙏']],
  },
  {
    owner: 'dr_samuel', title: 'Inductive Bible Study Masterclass', category: 'Bible Study', cover: img('photo-1504052434569-70ad5836ab65'), sortOrder: 2,
    headline: 'Read the Bible for yourself — observe, interpret, apply',
    description: 'Learn the inductive method seminary students use, in plain language. We study Philippians together over eight sessions, with worksheets and a community to ask questions.',
    benefits: ['8 recorded sessions on Philippians', 'Printable observation worksheets', 'Monthly live Q&A with Dr. Samuel', 'Discussion community for every chapter'],
    faqs: [
      { q: 'Do I need Greek or Hebrew?', a: 'No. Everything is taught from English translations; we show free tools for word studies.' },
      { q: 'Which Bible translation should I use?', a: 'Any literal translation works well — ESV, NKJV, NASB or KJV.' },
      { q: 'How long do I keep access?', a: 'The 90-day pass gives you the whole course and community for 90 days. Monthly members keep access while subscribed.' },
    ],
    questions: [{ label: 'Which Bible translation do you read most?', required: true }],
    plans: [{ name: '90-day pass', priceMinor: N(25000), interval: 'one_time', intervalDays: 90 }, { name: 'Monthly', priceMinor: N(9500), interval: 'month' }],
    lessons: [['Session 1 · What is inductive study?', 'video', 'https://www.youtube.com/watch?v=Kk8xXZG1y7k', 38, true], ['Observation worksheet', 'file', 'https://www.africau.edu/images/default/sample.pdf', null, false], ['Session 2 · Philippians 1', 'text', null, 20, true]],
    reviews: [[5, 'I have read the Bible for 20 years and never studied it like this. Eye-opening.'], [5, 'Clear, patient teaching. The worksheets are excellent.'], [5, 'My small group now uses this method every week.'], [4, 'Great content. Would love more sessions on the Old Testament.']],
    posts: ['Session 2 on Philippians 1 is now in the Library. Try the observation worksheet before you watch!', 'Live Q&A this Saturday at 4pm WAT — drop your questions in the Community.'],
    chat: [['Chinedu Okeke', 'In Phil 1:6, who is the “he” who began the good work?'], ['Esther Mensah', 'God himself — look at verse 2 for the context.']],
  },
  {
    owner: 'minister_joy', title: 'Worship Leaders Academy', category: 'Worship & Music', cover: img('photo-1511671782779-c97d3d27a1d4'), sortOrder: 1,
    headline: 'Lead God’s people into His presence with skill and humility',
    description: 'Vocal coaching, band leadership, song selection and the heart of a worshipper. Monthly mentorship calls and feedback on your recordings.',
    benefits: ['Vocal warm-ups and technique videos', 'Song-selection and set-list workshop', 'Monthly mentorship call', 'Send a recording, get personal feedback'],
    faqs: [
      { q: 'I am not a professional singer. Can I join?', a: 'Absolutely. Most of our members serve in local choirs and praise teams.' },
      { q: 'How does recording feedback work?', a: 'Post a voice note or video in the Community; Minister Joy or a coach replies within a week.' },
      { q: 'Is there a short trial?', a: 'Yes — the 7-day pass gives you a full week inside.' },
    ],
    questions: [{ label: 'What is your role in worship ministry (singer, instrumentalist, leader…)?', required: true }],
    plans: [{ name: 'Monthly', priceMinor: N(15000), interval: 'month' }, { name: '7-day pass', priceMinor: N(3000), interval: 'one_time', intervalDays: 7 }],
    lessons: [['Breathing and posture for singers', 'video', 'https://www.youtube.com/watch?v=Kk8xXZG1y7k', 18, true], ['Building a set list that tells a story', 'text', null, 10, true]],
    reviews: [[5, 'My voice has grown so much in three months. Thank you Minister Joy!'], [5, 'The set-list workshop transformed our Sunday services.'], [4, 'Very practical. The feedback on recordings is gold.']],
    posts: ['New this week: “Breathing and posture for singers” is in the Library. Practise it for five minutes a day.'],
    chat: [['Ruth Afolabi', 'Sharing my practice recording of “Way Maker” — feedback welcome!']],
  },
  {
    owner: 'elder_david', title: 'Kingdom Business Mentorship', category: 'Faith & Business', cover: img('photo-1519791883288-dc8bd696e667'), sortOrder: 0,
    headline: 'Build a business that honours God and serves people',
    description: 'A mentorship circle for Christian founders and professionals: integrity in money, hiring, pricing and rest. Small-group calls every fortnight.',
    benefits: ['Fortnightly small-group mentorship calls', 'Templates: budget, pricing, hiring', 'Accountability partners', 'Guest founders every month'],
    faqs: [{ q: 'Who is this for?', a: 'Founders, freelancers and professionals who want their work to reflect their faith.' }, { q: 'Is my business information kept private?', a: 'Yes. The community is members-only and we ask everyone to keep shared details confidential.' }],
    questions: [{ label: 'What does your business or work do?', required: true }, { label: 'What would you like help with first?', required: false }],
    plans: [{ name: 'Quarterly', priceMinor: N(75000), interval: 'days', intervalDays: 90 }, { name: 'Monthly', priceMinor: N(30000), interval: 'month' }],
    lessons: [['Money with integrity', 'text', null, 14, true]],
    reviews: [[5, 'Practical and deeply biblical. My pricing finally makes sense.'], [5, 'The accountability partners kept me going through a hard quarter.']],
    posts: [], chat: [],
  },
  {
    owner: 'pastor_grace', title: 'Marriage God’s Way', category: 'Marriage & Family', cover: img('photo-1529156069898-49953e39b3ac'), sortOrder: 0,
    creatorName: 'Pastors Tunde & Funmi Bakare', creatorBio: 'Married 25 years, pastoring couples in Ibadan. They teach communication, forgiveness and building a praying home.',
    headline: 'Grow a Christ-centred marriage, one honest conversation at a time',
    description: 'Monthly couples’ sessions, conversation guides for date nights and a supportive community of married and engaged couples.',
    benefits: ['Monthly couples’ session', 'Date-night conversation guides', 'Pre-marriage track for engaged couples'],
    faqs: [{ q: 'Do both spouses need an account?', a: 'One membership covers you both; your spouse can watch with you.' }, { q: 'Is it only for married couples?', a: 'Engaged couples are welcome — there is a pre-marriage track.' }],
    questions: [],
    plans: [{ name: 'Monthly', priceMinor: N(7500), interval: 'month' }],
    lessons: [['Communication that heals', 'text', null, 12, true]],
    reviews: [[5, 'We pray together every night now. Thank you!'], [4, 'Gentle, wise and very practical.']],
    posts: [], chat: [],
  },
  {
    owner: 'dr_samuel', title: 'Youth Discipleship Circle', category: 'Youth', cover: img('photo-1544531586-fde5298cdd40'), sortOrder: 0,
    headline: 'Real faith for real life — for ages 16 to 25',
    description: 'Weekly devotionals, honest conversations about purpose, relationships and career, and mentors who have walked the road before you.',
    benefits: ['Weekly youth devotional', 'Mentor check-ins', 'Career and purpose workshops'],
    faqs: [{ q: 'What ages is this for?', a: 'Young people aged 16 to 25.' }],
    questions: [{ label: 'How old are you?', required: true }],
    plans: [{ name: 'Monthly', priceMinor: N(2500), interval: 'month' }],
    lessons: [['Who am I in Christ?', 'text', null, 8, true]],
    reviews: [[5, 'The mentors actually listen. Love this circle.']],
    posts: [], chat: [],
  },
];

export async function seedMemberships(env) {
  const app = createApp();
  const call = async (user, method, path, body) => {
    const h = { 'X-Dev-User': user };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const res = await app.fetch(new Request(`http://seed.local${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
    return json;
  };
  const db = env.__db;
  const setUser = async (devKey, name, extra = {}) => {
    await call(devKey, 'GET', '/me');
    await db.query(`UPDATE users SET display_name = $2, handle = COALESCE($3, handle), bio = COALESCE($4, bio), avatar_url = COALESCE($5, avatar_url),
      verified = $6, created_at = COALESCE($7::timestamptz, created_at) WHERE clerk_id = $1`,
    [`dev_${devKey}`, name, extra.handle || null, extra.bio || null, extra.avatar || null, !!extra.verified, extra.joined || null]);
    return (await db.query('SELECT id FROM users WHERE clerk_id = $1', [`dev_${devKey}`]))[0].id;
  };
  const ownerIds = {};
  for (const o of OWNERS) ownerIds[o.key] = await setUser(o.key, o.name, { handle: o.handle, bio: o.bio, avatar: o.avatar, verified: true, joined: '2024-11-05' });
  const reviewerKeys = [];
  for (const [i, name] of REVIEWERS.entries()) {
    const key = `member_${i + 1}`;
    await setUser(key, name);
    reviewerKeys.push({ key, name });
  }
  await call('alice', 'GET', '/me');
  const days = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
  const made = [];
  for (const spec of MEMBERSHIPS) {
    const m = await call('admin', 'POST', '/memberships/manage', {
      title: spec.title, category: spec.category, coverKey: spec.cover, introVideoUrl: spec.introVideoUrl || null, headline: spec.headline,
      description: spec.description, benefits: spec.benefits, faqs: spec.faqs, questions: spec.questions, sortOrder: spec.sortOrder,
      ownerUserId: ownerIds[spec.owner], creatorName: spec.creatorName || '', creatorBio: spec.creatorBio || '',
    });
    for (const p of spec.plans) await call('admin', 'POST', `/memberships/manage/${m.id}/plans`, p);
    for (const [title, kind, mediaUrl, minutes, sample] of spec.lessons) {
      await call('admin', 'POST', `/memberships/manage/${m.id}/lessons`, { title, kind, mediaUrl, minutes, sample, body: kind === 'text' ? `${title}\n\nRead the passage slowly twice. Note what you see before asking what it means. Then write one way you will live it this week.` : '' });
    }
    if (spec.title === 'School of Prayer') await call('admin', 'POST', `/memberships/manage/${m.id}/promos`, { code: 'GRACE20', kind: 'percent', value: 20 });
    const pub = await call('admin', 'POST', `/memberships/manage/${m.id}/publish`);
    // reviewers: active members (they can chat and review)
    for (const [i, [rating, text]] of spec.reviews.entries()) {
      const r = reviewerKeys[(i + made.length * 2) % reviewerKeys.length];
      await call('admin', 'POST', `/memberships/manage/${m.id}/grant`, { userId: (await db.query('SELECT id FROM users WHERE clerk_id = $1', [`dev_${r.key}`]))[0].id, until: days(60) });
      await call(r.key, 'POST', `/memberships/${m.id}/reviews`, { rating, body: text });
    }
    const ownerKey = spec.owner;
    for (const text of spec.posts) await call(ownerKey, 'POST', `/conversations/${pub.channelId}/messages`, { text });
    for (const [name, text] of spec.chat) {
      const r = reviewerKeys.find((x) => x.name === name);
      await call('admin', 'POST', `/memberships/manage/${m.id}/grant`, { userId: (await db.query('SELECT id FROM users WHERE clerk_id = $1', [`dev_${r.key}`]))[0].id, until: days(60) });
      await call(r.key, 'POST', `/conversations/${pub.communityId}/messages`, { text });
    }
    made.push(pub);
  }
  // alice (the preview user): active in School of Prayer + Worship Leaders Academy, lapsed in the Bible Study masterclass
  const aliceId = (await db.query(`SELECT id FROM users WHERE clerk_id = 'dev_alice'`))[0].id;
  const by = (t) => made.find((x) => x.title === t);
  await call('admin', 'POST', `/memberships/manage/${by('School of Prayer').id}/grant`, { userId: aliceId, until: days(30), note: 'Demo member' });
  await call('admin', 'POST', `/memberships/manage/${by('Worship Leaders Academy').id}/grant`, { userId: aliceId, until: days(20), note: 'Demo member' });
  await call('admin', 'POST', `/memberships/manage/${by('Inductive Bible Study Masterclass').id}/grant`, { userId: aliceId, until: days(3), note: 'Demo lapsed member' });
  await db.query(`UPDATE membership_subscriptions SET expires_at = now() - interval '2 days' WHERE user_id = $1 AND membership_id = $2`, [aliceId, by('Inductive Bible Study Masterclass').id]);
  await call('admin', 'POST', '/memberships/manage/expire-now');
  return made.length;
}
