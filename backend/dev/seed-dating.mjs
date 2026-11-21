// DEV ONLY — demo Find Love profiles for the local preview (never imported by src/, never run in production).
//   node dev/server.mjs --seed-dating                 seeds once, when no dating profile exists yet
//   DATING_DEMO_USER=david node dev/server.mjs --seed-dating
//       … also gives the dev user "david" (X-Dev-User: david) a dating profile, 300 Dating Coins, 3 likes waiting and one
//         match with a short conversation, so every Find Love screen has something to show.
// 20 fictional adults (23–39), city-level locations only. Every profile and photo is pre-approved.
//
// Photos: Unsplash (Unsplash License — free to use, no attribution required). Modest head-and-shoulders portraits.
// Source URLs (https://images.unsplash.com/<id>):
//   women: photo-1531123897727-8f129e1688ce · photo-1573496359142-b8d87734a5a2 · photo-1589156280159-27698a70f29e
//          photo-1567532939604-b6b5b0db2604 · photo-1494790108377-be9c29b29330 · photo-1438761681033-6461ffad8d80
//          photo-1544005313-94ddf0286df2 · photo-1534528741775-53994a69daeb · photo-1580489944761-15a19d654956
//          photo-1508214751196-bcfd4ca60f91 · photo-1531746020798-e6953c6e8e04 · photo-1548142813-c348350df52b
//   men:   photo-1531384441138-2736e62e0919 · photo-1522529599102-193c0d76b5b6 · photo-1595152772835-219674b2a8a6
//          photo-1506794778202-cad84cf45f1d · photo-1507003211169-0a1dd7228f2d · photo-1500648767791-00dcc994a43e
//          photo-1472099645785-5658abf4ff4e · photo-1519085360753-af0119f7cbe7 · photo-1539571696357-5a69c17a67c6
//          photo-1504257432389-52343af06ae3 · photo-1557862921-37829c790f19
const img = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=800&h=1000&q=80`;
const yearsAgo = (y, days) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - y); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10); };

const W = 'woman'; const M = 'man';
const PEOPLE = [
  // key, first name, gender, age, city, country, denomination, involvement, intention, bio, prompts, photos
  ['ada_love', 'Adaeze', W, 27, 'Lagos', 'Nigeria', 'Anglican', 'Serves in ministry', 'marriage', 'Choir alto, nurse, and lover of jollof Sundays. Looking for a man who prays first and plans second.', [['My favourite verse is…', 'Proverbs 31:25 — clothed with strength and dignity.'], ['On Sunday you’ll find me…', 'In the second row of the choir stand.']], ['photo-1531123897727-8f129e1688ce']],
  ['esther_k', 'Esther', W, 31, 'Accra', 'Ghana', 'Pentecostal', 'Church leader', 'marriage', 'Youth pastor and accountant. I believe in honest conversations, long walks and longer prayers.', [['I’m praying for…', 'A husband who leads with humility.']], ['photo-1573496359142-b8d87734a5a2']],
  ['grace_n', 'Grace', W, 25, 'Abuja', 'Nigeria', 'Baptist', 'Attends weekly', 'long_term', 'Architecture graduate. I sketch churches for fun and laugh at my own jokes.', [['A perfect first date is…', 'Small chops after Sunday service, then a gallery.']], ['photo-1589156280159-27698a70f29e']],
  ['wanjiru_m', 'Wanjiru', W, 29, 'Nairobi', 'Kenya', 'Presbyterian', 'Attends weekly', 'marriage', 'Software tester and worship guitarist. Kind, curious, a little bit nerdy.', [['Worship song on repeat…', '“Goodness of God”']], ['photo-1567532939604-b6b5b0db2604']],
  ['ruth_b', 'Ruth', W, 34, 'Port Harcourt', 'Nigeria', 'Methodist', 'Serves in ministry', 'marriage', 'Teacher, auntie of seven, Sunday-school superintendent. Faith, family and fresh pepper soup.', [['My friends would describe me as…', 'Loyal, loud when I laugh, quiet when I pray.']], ['photo-1494790108377-be9c29b29330']],
  ['hannah_o', 'Hannah', W, 26, 'Lagos', 'Nigeria', 'Non-denominational', 'Attends weekly', 'friendship_first', 'Content creator for a Christian charity. Friendship first — let’s see what God does.', [['I’m praying for…', 'Wisdom in my next career step.']], ['photo-1438761681033-6461ffad8d80']],
  ['naomi_t', 'Naomi', W, 30, 'Kumasi', 'Ghana', 'Catholic', 'Attends weekly', 'marriage', 'Pharmacist. Rosary in my bag, novels on my nightstand.', [['My favourite verse is…', 'Ruth 1:16.']], ['photo-1544005313-94ddf0286df2']],
  ['deborah_a', 'Deborah', W, 37, 'Ibadan', 'Nigeria', 'Anglican', 'Church leader', 'marriage', 'Lawyer and women’s fellowship leader. Grounded, warm and ready for something real.', [['On Sunday you’ll find me…', 'Greeting newcomers at the door.']], ['photo-1534528741775-53994a69daeb']],
  ['joy_e', 'Joy', W, 23, 'Enugu', 'Nigeria', 'Pentecostal', 'Attends sometimes', 'not_sure', 'Final-year medical student. Coffee, Bible journaling and too many tabs open.', [['A perfect first date is…', 'A bookshop and suya.']], ['photo-1580489944761-15a19d654956']],
  ['miriam_s', 'Miriam', W, 28, 'Kampala', 'Uganda', 'Seventh-day Adventist', 'Serves in ministry', 'long_term', 'Health worker who sings alto in a gospel quartet. Sabbath walks are my love language.', [['Worship song on repeat…', '“It is well”']], ['photo-1508214751196-bcfd4ca60f91']],
  ['tunde_a', 'Tunde', M, 32, 'Lagos', 'Nigeria', 'Pentecostal', 'Serves in ministry', 'marriage', 'Civil engineer and drummer in the worship team. I build bridges — literally and otherwise.', [['My favourite verse is…', 'Joshua 24:15.'], ['A perfect first date is…', 'Lekki boardwalk at sunset.']], ['photo-1531384441138-2736e62e0919']],
  ['kwame_b', 'Kwame', M, 29, 'Accra', 'Ghana', 'Methodist', 'Attends weekly', 'marriage', 'Product designer, football on Saturdays, church on Sundays, family always.', [['My friends would describe me as…', 'The one who remembers birthdays.']], ['photo-1522529599102-193c0d76b5b6']],
  ['emeka_o', 'Emeka', M, 35, 'Abuja', 'Nigeria', 'Catholic', 'Church leader', 'marriage', 'Doctor and parish youth coordinator. Ready to build a Christ-centred home.', [['I’m praying for…', 'A wife who loves God more than she loves me.']], ['photo-1595152772835-219674b2a8a6']],
  ['david_k', 'David', M, 27, 'Nairobi', 'Kenya', 'Baptist', 'Attends weekly', 'long_term', 'Teacher and amateur photographer. Ask me about my favourite Psalm.', [['Worship song on repeat…', '“Way Maker”']], ['photo-1506794778202-cad84cf45f1d']],
  ['samuel_m', 'Samuel', M, 38, 'Kumasi', 'Ghana', 'Presbyterian', 'Church leader', 'marriage', 'Elder, farmer and business owner. Quiet strength, loud laughter.', [['On Sunday you’ll find me…', 'Counting the offering with a smile.']], ['photo-1507003211169-0a1dd7228f2d']],
  ['joshua_e', 'Joshua', M, 24, 'Lagos', 'Nigeria', 'Non-denominational', 'Attends sometimes', 'friendship_first', 'Junior developer, gospel-rap fan, learning to cook egusi.', [['A perfect first date is…', 'Board games and amala.']], ['photo-1500648767791-00dcc994a43e']],
  ['daniel_o', 'Daniel', M, 31, 'Port Harcourt', 'Nigeria', 'Anglican', 'Serves in ministry', 'marriage', 'Oil & gas engineer who teaches Sunday school. Honest, patient, hopeful.', [['My favourite verse is…', 'Daniel 1:8 — of course.']], ['photo-1472099645785-5658abf4ff4e']],
  ['peter_w', 'Peter', M, 33, 'Kampala', 'Uganda', 'Pentecostal', 'Attends weekly', 'marriage', 'Banker and marathon runner. I run races and I run to God.', [['I’m praying for…', 'Patience. Still working on it.']], ['photo-1519085360753-af0119f7cbe7']],
  ['caleb_n', 'Caleb', M, 28, 'Ibadan', 'Nigeria', 'Baptist', 'Attends weekly', 'long_term', 'Radio presenter and choir tenor. Coffee snob, kind to strangers.', [['My friends would describe me as…', 'A good listener with a big voice.']], ['photo-1539571696357-5a69c17a67c6']],
  ['isaac_j', 'Isaac', M, 36, 'Enugu', 'Nigeria', 'Catholic', 'Serves in ministry', 'marriage', 'Architect and Knight of St. Mulumba. Family man in waiting.', [['On Sunday you’ll find me…', 'At the 7am Mass, then breakfast with my parents.']], ['photo-1504257432389-52343af06ae3']],
];

/** Seeds the profiles (+ the demo user's likes / match when demoUser is given). → number of profiles created. */
export async function seedDating(env, { demoUser = null } = {}) {
  const db = env.__db;
  const ids = {};
  for (const [key, first, gender, age, city, country, denom, inv, intention, bio, prompts, photos] of PEOPLE) {
    const u = (await db.query(`INSERT INTO users (clerk_id, display_name, country) VALUES ($1, $2, $3)
      ON CONFLICT (clerk_id) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`, [`dev_${key}`, `${first} (demo)`, country]))[0];
    ids[key] = u.id;
    await db.query(`INSERT INTO dating_profiles (user_id, first_name, birth_date, gender, interested_in, city, country, denomination, church_involvement, intention, bio, prompts, prefs, last_active_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb, now() - make_interval(mins => $14::int)) ON CONFLICT (user_id) DO NOTHING`,
    [u.id, first, yearsAgo(age, 40 + age * 3), gender, gender === W ? 'men' : 'women', city, country, denom, inv, intention, bio,
      JSON.stringify(prompts.map(([q, a]) => ({ q, a }))), JSON.stringify({ ageMin: 21, ageMax: 45, intentions: [], denominations: [], involvement: [] }), age * 7]);
    let pos = 0;
    for (const id of photos) {
      await db.query(`INSERT INTO dating_photos (user_id, url, position, status, reviewed_at) SELECT $1, $2, $3, 'approved', now()
        WHERE NOT EXISTS (SELECT 1 FROM dating_photos WHERE user_id = $1 AND url = $2)`, [u.id, img(id), pos++]);
    }
  }
  // a few likes between demo people, and one boosted profile so the BOOSTED label shows
  await db.query(`INSERT INTO dating_boosts (ref, user_id, kind, paid_with, amount, starts_at, ends_at)
    VALUES ('seed:boost:esther', $1, 'boost_3h', 'dating_coins', 400, now() - interval '20 minutes', now() + interval '160 minutes') ON CONFLICT (ref) DO NOTHING`, [ids.esther_k]);

  if (demoUser && /^[\w.-]{1,40}$/.test(demoUser)) {
    const me = (await db.query(`INSERT INTO users (clerk_id, display_name, country) VALUES ($1, $2, 'Nigeria')
      ON CONFLICT (clerk_id) DO UPDATE SET country = COALESCE(users.country, 'Nigeria') RETURNING id`, [`dev_${demoUser}`, demoUser.charAt(0).toUpperCase() + demoUser.slice(1)]))[0].id;
    await db.query(`INSERT INTO dating_profiles (user_id, first_name, birth_date, gender, interested_in, city, country, denomination, church_involvement, intention, bio, prompts, prefs)
      VALUES ($1, $2, $3, 'man', 'women', 'Lagos', 'Nigeria', 'Pentecostal', 'Serves in ministry', 'marriage',
        'Worship leader and civil servant. I love early-morning prayer, long conversations and good food with friends.',
        '[{"q":"My favourite verse is…","a":"Micah 6:8 — do justly, love mercy, walk humbly."}]'::jsonb, '{"ageMin":22,"ageMax":38,"intentions":[],"denominations":[],"involvement":[]}'::jsonb)
      ON CONFLICT (user_id) DO NOTHING`, [me, demoUser.charAt(0).toUpperCase() + demoUser.slice(1), yearsAgo(30, 100)]);
    await db.query(`INSERT INTO dating_photos (user_id, url, position, status, reviewed_at) SELECT $1, $2, 0, 'approved', now()
      WHERE NOT EXISTS (SELECT 1 FROM dating_photos WHERE user_id = $1)`, [me, img('photo-1557862921-37829c790f19')]);
    // coins via the ledger (one admin_adjust op, like an admin top-up)
    const ref = `seed:dating:${me}`;
    const op = await db.query(`INSERT INTO wallet_ops (ref, kind, meta) VALUES ($1, 'admin_adjust', '{"reason":"Dev seed"}'::jsonb) ON CONFLICT DO NOTHING RETURNING ref`, [ref]);
    if (op.length) {
      await db.query(`INSERT INTO wallet_balances (account, wallet, user_id, balance) VALUES ($1::text, 'dating_coins', $2::uuid, 300)
        ON CONFLICT (account, wallet) DO UPDATE SET balance = wallet_balances.balance + 300`, [String(me), me]);
      const b = (await db.query(`SELECT balance FROM wallet_balances WHERE account = $1 AND wallet = 'dating_coins'`, [me]))[0].balance;
      await db.query(`INSERT INTO wallet_entries (ref, leg, account, user_id, wallet, amount, balance_after, kind, meta)
        VALUES ($1, 1, $2::text, $3::uuid, 'dating_coins', 300, $4, 'admin_adjust', '{"reason":"Dev seed"}'::jsonb)`, [ref, String(me), me, b]);
    }
    const day = new Date().toISOString().slice(0, 10);
    for (const [k, action] of [['grace_n', 'like'], ['hannah_o', 'super_like'], ['naomi_t', 'like'], ['ada_love', 'like']]) {
      await db.query(`INSERT INTO dating_swipes (user_id, target_id, action, day) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [ids[k], me, action, day]);
    }
    // a match with Adaeze and a short conversation (labelled 'dating' like every Find Love chat)
    await db.query(`INSERT INTO dating_swipes (user_id, target_id, action, day) VALUES ($1, $2, 'like', $3) ON CONFLICT DO NOTHING`, [me, ids.ada_love, day]);
    const [a, b2] = [me, ids.ada_love].sort();
    const has = await db.query('SELECT 1 FROM dating_conversations WHERE user_a = $1 AND user_b = $2', [a, b2]);
    if (!has.length) {
      const conv = (await db.query(`INSERT INTO conversations (kind, last_message_at) VALUES ('dm', now()) RETURNING id`))[0].id;
      await db.query(`INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2), ($1, $3)`, [conv, me, ids.ada_love]);
      const m = (await db.query(`INSERT INTO dating_matches (user_a, user_b, conversation_id, created_at) VALUES ($1, $2, $3, now() - interval '2 hours') RETURNING id`, [a, b2, conv]))[0].id;
      await db.query(`INSERT INTO dating_conversations (conversation_id, user_a, user_b, match_id, status) VALUES ($1, $2, $3, $4, 'match')`, [conv, a, b2, m]);
      await db.query(`INSERT INTO messages (conversation_id, sender_id, kind, body, created_at) VALUES
        ($1, $2, 'text', 'Hi! I saw you sing in a choir too — which part do you sing? 😊', now() - interval '90 minutes')`, [conv, ids.ada_love]);
    }
  }
  return PEOPLE.length;
}
