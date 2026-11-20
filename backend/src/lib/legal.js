// LEGAL: Terms of Service, Privacy Policy and the account-deletion page, as ONE editable source.
//
// !! DRAFT — A QUALIFIED LAWYER MUST REVIEW THIS TEXT BEFORE LAUNCH. !!
// It was written from a survey of the code (November 2026) to describe what the app actually does, but it is
// not legal advice. Check especially: the company details, governing law, the legal bases, the age rules for
// each country you launch in, Nigeria NDPA registration / DPO duties, and the retention periods.
// (This note is a source comment only — it is never shown on the public pages.)
//
// Served by the Worker at GET /terms, /privacy and /delete-account (routes/legal.js). The same text is exported
// to Markdown for review with renderMarkdown() (see scratch/legal/*.md).
//
// Placeholders are filled from Worker vars when set, otherwise the bracketed placeholder is shown:
//   {{COMPANY}}   LEGAL_COMPANY_NAME     [COMPANY LEGAL NAME]
//   {{ADDRESS}}   LEGAL_ADDRESS          [REGISTERED ADDRESS]
//   {{EMAIL}}     LEGAL_CONTACT_EMAIL    [CONTACT EMAIL]
//   {{LAW}}       LEGAL_GOVERNING_LAW    [GOVERNING LAW COUNTRY]
//   {{EFFECTIVE}} LEGAL_EFFECTIVE_DATE   [EFFECTIVE DATE]
//
// Mini markup used below: a string is a paragraph; { h3 }, { ul: [...] }, { note } (highlighted box) and
// { table: [[head…], [row…]…] }. Inline: **bold** and [text](url). Keep it plain English.

export const LEGAL_LAST_UPDATED = '20 November 2026';

export const PLACEHOLDERS = {
  COMPANY: { env: 'LEGAL_COMPANY_NAME', label: '[COMPANY LEGAL NAME]' },
  ADDRESS: { env: 'LEGAL_ADDRESS', label: '[REGISTERED ADDRESS]' },
  EMAIL: { env: 'LEGAL_CONTACT_EMAIL', label: '[CONTACT EMAIL]' },
  LAW: { env: 'LEGAL_GOVERNING_LAW', label: '[GOVERNING LAW COUNTRY]' },
  EFFECTIVE: { env: 'LEGAL_EFFECTIVE_DATE', label: '[EFFECTIVE DATE]' },
};

// =============================================================================================
// PRIVACY POLICY
// =============================================================================================
const PRIVACY = {
  slug: 'privacy',
  title: 'Privacy Policy',
  intro: [
    'This policy explains what information BibleNestra collects, why, who we share it with and the choices you have. We have tried to write it in plain language. If anything is unclear, contact us at {{EMAIL}}.',
  ],
  sections: [
    {
      id: 'who', h: 'Who we are',
      body: [
        'BibleNestra (the "app") is provided by **{{COMPANY}}**, {{ADDRESS}} ("we", "us"). We are the data controller for the personal information described here. You can reach us, including about data protection, at **{{EMAIL}}**.',
      ],
    },
    {
      id: 'summary', h: 'The short version',
      body: [{ ul: [
        'We collect what you give us (your profile, posts, prayers, messages and uploads) and a small amount of technical information needed to run the app.',
        'Your Bible reading, notes and many settings are stored on your phone. When you sign in, some of it is synced to our servers so it follows you to a new phone.',
        'Some features use AI run by our hosting provider, Cloudflare. AI answers can be wrong and are not pastoral, medical or professional advice.',
        'Ads are shown by Google AdMob. The app asks AdMob for **non-personalised** ads only.',
        'We do not sell your personal information.',
        'You can delete your account and its data at any time from the app, or by asking us. See [Delete your account](/delete-account).',
      ] }],
    },
    {
      id: 'collect', h: 'Information we collect',
      body: [
        { h3: 'Account and sign-in' },
        'You sign in with an email code, an email and password, Google or Apple. Sign-in is handled by our provider **Clerk**, which stores your email address, your name and profile photo (if your Google or Apple account shares them) and, if you choose a password, a securely hashed version of it. We receive a Clerk account ID and, when your account is first created, your name and profile photo.',
        { h3: 'Your profile' },
        'Display name, @handle, profile photo and banner, headline, bio, church, country, preferred Bible translation, chat availability and last-seen setting. Your device time zone offset is sent with each request so "today" matches your local day. If you joined through someone\'s invite link, we record who invited you.',
        { h3: 'Content you create' },
        'Posts, photos and videos, comments, reactions and saves; prayer requests (public, church-only, private or anonymous), prayer updates, "I am praying" and candles; event, community and group content; contest registrations, answers, submissions and votes; comments on videos; job posts and bids; member websites you submit; audio and books you upload to the media library; fundraisers and their supporting documents; and anything else you choose to post. Most of this is visible to other people, according to the audience you pick.',
        { h3: 'Messages and chats' },
        'Direct and group messages, including text, photos, videos, voice notes, files, reactions, replies, pins and forwarded messages, plus read status, typing indicators and online / last-seen status (you can hide last seen in chat settings). Chats started through the Care network ("Talk to a Priest", "Talk to an Apostle") are ordinary chats. **Messages are encrypted in transit but are not end-to-end encrypted**: they are stored on our servers so they sync across your devices. When you send a web link in a chat, our server visits that link to build a preview card (title, description, picture); the website sees a request from our server, not from you.',
        { h3: 'Sermon Studio recordings' },
        'If you record or upload a sermon, we store the audio, and our AI provider transcribes it and writes notes (summary, main points, scriptures). The microphone is used only while you are recording.',
        { h3: 'Scripture Companion and other AI features' },
        'When you use Scripture Companion, the message you write about your situation is sent to our server and processed by AI models to choose scriptures and write explanations, encouragement and a prayer. **We do not store your message itself.** We do store, linked to your account: the themes and a short AI-generated summary of your situation, whether a crisis signal was detected, the scriptures chosen and the text the AI wrote (so a reply can be reopened), and the last ~50 verses you were given (so we don\'t repeat them). If a crisis signal is detected, we use the country in your profile, or else the country our network provider derives from your connection, to show the right helplines. Your Companion history is also kept on your phone. One-tap exegesis and Bible study tools send only the Bible passage, not personal information.',
        { h3: 'Bible study and activity' },
        'Notes, highlights, bookmarks, reading-plan progress, daily rhythm and streaks, game and quiz scores, course and devotional progress, media-library listening position and reminders. Some of these stay only on your phone; others are synced when you are signed in.',
        { h3: 'Coins, gifts and rewards' },
        'Your coin balance and a ledger of coins earned and spent (welcome coins, rewarded ads, games, bids, gifts, contest prizes), gifts you send and receive, and a daily count of rewarded ads you watched.',
        { h3: 'Donations (Fund Me), if and when offered' },
        'If donations are switched on, we record the amount, currency, the name you give (or "anonymous"), an optional message and the payment status. Card or bank details are entered on the payment provider\'s page and are **never received or stored by us**. For donations made without signing in, we keep a scrambled (hashed) form of your IP address for a short time to stop abuse.',
        { h3: 'Device and technical information' },
        { ul: [
          'A push notification token and your device platform (Android / iOS), so we can send notifications.',
          'Your IP address and basic request information, which our hosting provider (Cloudflare) processes to deliver the app, protect it from attacks and keep short-lived error logs.',
          'When you were last active (updated at most every 10 minutes) and whether you are online in chat.',
          'Daily counts of ad events per account (requested, shown, clicked), kept for 14 days to prevent abuse. Ad statistics for our dashboard are added up across all users and contain no personal information.',
        ] },
        { h3: 'Phone permissions' },
        'The app asks for: **camera** and **photos** (to share pictures and videos), **microphone** (to record sermons and voice notes) and **notifications**. Each is used only when you use the related feature, and you can turn them off in your phone settings. The app does **not** access your location, contacts or call logs. Your country comes from your profile or, for helplines only, from your network connection.',
        { h3: 'Safety and moderation records' },
        'Reports you make or that others make about content or accounts, blocks, group bans, and the actions our moderators take (for example removing content or suspending an account).',
        { h3: 'Information from other people' },
        'Other users may mention you, invite you, add you to a group, report you or send you messages and gifts.',
        { h3: 'Information kept only on your phone' },
        'Bible Chat history, Scripture Companion history, child profiles in Family mode, many preferences and downloaded Bible texts are stored on your device. We cannot see them unless a feature says it syncs them. Erasing app data or uninstalling removes them.',
      ],
    },
    {
      id: 'use', h: 'How we use your information and our legal bases',
      body: [
        'We use personal information only for the purposes below. Where the law requires a "legal basis" (for example the EU/UK GDPR, Nigeria\'s Data Protection Act 2023, Kenya\'s Data Protection Act 2019, Ghana\'s Data Protection Act 2012 or South Africa\'s POPIA), we rely on the basis shown.',
        { table: [
          ['Purpose', 'Legal basis'],
          ['Create and run your account, sync your data, show your posts, deliver your messages and notifications', 'Performing our contract with you (these Terms)'],
          ['AI features you choose to use (Scripture Companion, sermon notes, exegesis, quiz drafts for contest organisers)', 'Contract; and your explicit consent for any sensitive information you choose to share'],
          ['Showing crisis helplines when a message suggests you may be in danger', 'Your vital interests and our legitimate interest in keeping people safe'],
          ['Safety, moderation, preventing spam, fraud and abuse, enforcing our Terms', 'Legitimate interests (keeping the community safe); legal obligation where it applies'],
          ['Showing ads that fund the free app, and counting ad rewards', 'Legitimate interests; consent where local law requires it for ads on your device'],
          ['Processing donations and subscriptions, if and when offered', 'Contract; legal obligations (tax, accounting)'],
          ['Improving the app using aggregated usage counts', 'Legitimate interests'],
          ['Complying with law and responding to lawful requests', 'Legal obligation'],
        ] },
        { h3: 'Sensitive information' },
        'Because BibleNestra is a faith community, much of what you share reveals your religious beliefs, and you may choose to share things about your health, family or emotional state (for example in prayers or Scripture Companion). Many laws treat this as "sensitive" or "special category" data. We process it only to provide the features you choose to use, on the basis of your explicit consent (which you give by choosing to share it, and can withdraw by deleting the content or your account) or, for content you deliberately make public, because you have made it public. We never use it for advertising.',
      ],
    },
    {
      id: 'ai', h: 'AI features',
      body: [
        'Scripture Companion, sermon transcripts and notes, one-tap exegesis and AI quiz drafts use AI models (Meta Llama, OpenAI Whisper and BAAI embedding models) run on **Cloudflare Workers AI**, our hosting provider. Your input is sent to those models only to produce your answer. We do not use your messages to train AI models, and the models run on Cloudflare under Cloudflare\'s customer terms (see Cloudflare\'s privacy policy for how it handles data it processes for us).',
        'AI output can be inaccurate, incomplete or unsuitable. It is **not** pastoral, medical, psychological, legal or financial advice, and it is not a substitute for your church, a doctor or a counsellor. If you are in danger or thinking about harming yourself, contact your local emergency number or a helpline straight away — the app shows helplines when it detects this, but it may not always detect it.',
      ],
    },
    {
      id: 'share', h: 'Who we share information with',
      body: [
        { h3: 'Other users' },
        'Your profile and anything you post publicly can be seen by other users, and some content (such as approved fundraiser pages, contest certificates and invite pages) can be seen on the web by anyone with the link. Prayers marked anonymous do not show your name to other users. Chat messages are seen by the people in that chat.',
        { h3: 'Service providers (processors)' },
        'We use these companies to run the app. They process data on our instructions and under contracts that protect it:',
        { ul: [
          '**Cloudflare, Inc.**: hosting of our servers (Workers), real-time chat delivery, storage of photos, videos, audio and files (R2), AI processing (Workers AI), network security and error logs.',
          '**Neon**: our Postgres database, which stores your account, content and messages.',
          '**Clerk, Inc.**: sign-in, account security, email codes and password resets.',
          '**Expo** (650 Industries, Inc.): sending push notifications to your device.',
          '**Google** (Google LLC / Google Ireland): Firebase Cloud Messaging delivers notifications on Android; Google Sign-In if you choose it; Google Play distributes the app (and will process subscription payments if Plus is offered).',
          '**Apple**: Sign in with Apple if you choose it, and push delivery on iPhone.',
          '**Google AdMob**: shows ads in the app (see "Ads" below).',
          '**YouTube** (Google): videos and live services in the app are played with YouTube\'s embedded player, and our server checks YouTube for live broadcasts on channels we feature.',
          '**Payment providers** (for example Stripe or Paystack), only if and when donations or payments are switched on.',
        ] },
        { h3: 'Content services your phone talks to directly' },
        'To show Bible texts, commentaries and word studies, the app downloads them from public services such as the Free Use Bible API (bible.helloao.org) and bolls.life. These services receive your IP address and the passage requested, like any website. Videos you open from YouTube, websites opened in the in-app browser and links to opportunities or helplines are run by those third parties under their own privacy policies.',
        { h3: 'Legal and safety reasons' },
        'We may share information if the law requires it, to respond to valid legal requests, or where we believe in good faith it is needed to protect someone\'s life or safety, to prevent fraud or abuse, or to protect our rights and users.',
        { h3: 'Business changes' },
        'If we are involved in a merger, acquisition or sale of assets, information may be transferred as part of that deal. We will tell you before your information becomes subject to a different privacy policy.',
        'We **do not sell** your personal information, and we do not share it for cross-context behavioural advertising.',
      ],
    },
    {
      id: 'ads', h: 'Ads',
      body: [
        'BibleNestra is free and is supported by ads from **Google AdMob**. The app requests **non-personalised ads only**, so ads are not chosen based on your profile or activity in other apps. Even for non-personalised ads, Google may use your device\'s advertising ID, IP address and similar information to limit how often you see an ad, measure performance and fight fraud. You can reset or delete your advertising ID in your phone\'s settings. Learn more in [Google\'s privacy policy](https://policies.google.com/privacy) and [how Google uses information from apps that use its services](https://policies.google.com/technologies/partner-sites).',
        'When you choose to watch a rewarded ad (for example to earn coins), Google tells our server that the ad was completed so we can give you the reward.',
      ],
    },
    {
      id: 'transfers', h: 'International transfers',
      body: [
        'Our providers operate around the world, so your information may be stored and processed in countries other than yours, including the United States and the European Union. Where the law requires it (for example the GDPR, Nigeria\'s NDPA, Kenya\'s DPA or POPIA), we rely on adequacy decisions, standard contractual clauses or other approved safeguards offered by our providers, and we only use providers that commit to protecting personal information.',
      ],
    },
    {
      id: 'retention', h: 'How long we keep information',
      body: [{ ul: [
        '**Account, profile, content and messages**: for as long as you keep your account. When you delete your account, they are erased (see [Delete your account](/delete-account)).',
        '**Posts you delete** are hidden from everyone straight away; the stored copy is erased when you delete your account. **Messages you delete for everyone** have their text and attachment link removed at once.',
        '**Scripture Companion records** (themes, AI summary, chosen verses and AI replies): kept with your account until you delete it; the list of recently given verses is limited to about 50.',
        '**Ad abuse counters**: 14 days. **Unfinished video uploads**: cleaned up after about a day.',
        '**Server and error logs**: a short period set by our hosting provider.',
        '**Records we must keep by law** (for example payment and tax records, if payments are switched on) and **moderation records** needed to keep the community safe may be kept longer, but only as long as needed.',
        'Copies in our providers\' backups are overwritten on their normal backup cycle.',
      ] }],
    },
    {
      id: 'security', h: 'Security',
      body: [
        'We use encryption in transit (HTTPS) for all connections, encrypted storage at our providers, signed and expiring links for private files, access controls on admin tools, and server checks on who can see each piece of content. No system is perfectly secure, so please use a strong password or a trusted Google / Apple account, and tell us at {{EMAIL}} if you notice anything wrong. If a breach is likely to put you at risk, we will tell you and the relevant regulator as the law requires.',
      ],
    },
    {
      id: 'rights', h: 'Your rights and choices',
      body: [
        'Depending on where you live, you may have the right to: **access** your information; **correct** it; **delete** it; **restrict** or **object** to some uses; **data portability** (a copy in a usable format); **withdraw consent** at any time (this does not affect what we did before); and **not be subject to decisions based solely on automated processing** that have legal or similarly significant effects (we do not make such decisions).',
        { h3: 'How to use them' },
        { ul: [
          'Edit your profile at any time in the app (Profile → Edit).',
          'Export your on-device notes, highlights and plans from Profile → Privacy → Export my data.',
          'Delete posts, prayers, messages and uploads yourself, or delete your whole account from Profile → Account → Delete my account.',
          'Turn off notifications, hide your last seen, block or report people, and leave groups at any time.',
          'For anything else, including a full copy of the data on our servers, email **{{EMAIL}}**. We may need to confirm your identity, and we will reply within the time the law allows (usually within one month).',
        ] },
        { h3: 'Nigeria (NDPA 2023)' },
        'You have the rights above under the Nigeria Data Protection Act 2023. If you are not satisfied with our answer, you can complain to the **Nigeria Data Protection Commission (NDPC)**.',
        { h3: 'Ghana, Kenya and South Africa' },
        'In **Ghana** (Data Protection Act 2012) you can complain to the Data Protection Commission; in **Kenya** (Data Protection Act 2019) to the Office of the Data Protection Commissioner; in **South Africa** (POPIA) to the Information Regulator. We process information lawfully, only for the purposes above, and keep it accurate and secure, as these laws require.',
        { h3: 'European Union and United Kingdom' },
        'You have the rights above under the EU or UK GDPR and can complain to your local data protection authority (in the UK, the Information Commissioner\'s Office).',
        { h3: 'United States' },
        'Residents of some US states (such as California) have rights to know, access, correct and delete personal information and to opt out of its "sale" or "sharing". We do not sell or share personal information in that sense. We will not treat you differently for using your rights.',
      ],
    },
    {
      id: 'children', h: 'Children',
      body: [
        'BibleNestra is not intended for children under **13**, and we do not knowingly allow them to create an account. In the European Union and the UK, if you are under the age at which you can consent to online services in your country (up to 16), you need a parent\'s or guardian\'s permission. Users under 18 should use the app with a parent\'s or guardian\'s involvement. The Family mode in the app keeps child profiles on the parent\'s device only; children should not have their own account. If you believe a child under 13 has given us personal information, contact {{EMAIL}} and we will delete it.',
      ],
    },
    {
      id: 'delete', h: 'Deleting your account',
      body: [
        'You can delete your account at any time in the app (**Profile → Account → Delete my account**). This permanently erases your profile, posts, prayers, comments, messages you sent, uploads, recordings, coins and other data linked to your account from our database and storage, and deletes your sign-in account at Clerk. If you can\'t use the app, email {{EMAIL}} from the address you signed in with. Full details are on our [account deletion page](/delete-account).',
      ],
    },
    {
      id: 'links', h: 'Other websites and services',
      body: [
        'The app can open YouTube videos, member websites, opportunity listings, Bible resources and helpline directories. Member websites open in an in-app browser but are run by their owners, not by us. Those sites may use cookies and collect information under their own privacy policies, which we do not control.',
      ],
    },
    {
      id: 'changes', h: 'Changes to this policy',
      body: [
        'We may update this policy as the app changes. We will change the "last updated" date and, for important changes, tell you in the app before they take effect.',
      ],
    },
    {
      id: 'contact', h: 'Contact us',
      body: [
        '**{{COMPANY}}**, {{ADDRESS}}. Email: **{{EMAIL}}**.',
      ],
    },
  ],
};

// =============================================================================================
// TERMS OF SERVICE
// =============================================================================================
const TERMS = {
  slug: 'terms',
  title: 'Terms of Service',
  intro: [
    'These terms are an agreement between you and **{{COMPANY}}** ("we", "us") about your use of BibleNestra. Please read them together with our [Privacy Policy](/privacy). By creating an account or using the app you agree to them. If you do not agree, please do not use BibleNestra.',
  ],
  sections: [
    {
      id: 'service', h: 'What BibleNestra is',
      body: [
        'BibleNestra is a Christian app for reading and studying the Bible, prayer, encouragement and community. It includes Bible reading and study tools, AI-assisted features, a social feed, a prayer wall, chats and groups, a Care network, videos and live services, a media library, contests and games, a jobs and opportunities board, member websites, coins and gifts, and (if and when offered) fundraising and subscriptions. Features may change, be added or be removed over time.',
      ],
    },
    {
      id: 'eligibility', h: 'Who can use BibleNestra',
      body: [{ ul: [
        'You must be at least **13 years old** to create an account.',
        'If you are under 18, or under the age of digital consent in your country (up to 16 in parts of the EU), you may only use BibleNestra with the permission and involvement of a parent or guardian, who accepts these terms for you.',
        'You may not use BibleNestra if we have previously banned you, or if the law forbids you from using it.',
      ] }],
    },
    {
      id: 'account', h: 'Your account',
      body: [
        'Give accurate information, keep your sign-in details safe and do not share your account. You are responsible for what happens under your account. Do not pretend to be someone else, including a church, ministry, priest or public figure. Tell us at {{EMAIL}} if you think your account has been misused.',
      ],
    },
    {
      id: 'community', h: 'Community rules',
      body: [
        'BibleNestra is a faith-based community. We want it to be a safe, kind and honest place for believers and seekers from every church tradition. When you use it, you agree **not** to:',
        { ul: [
          'harass, bully, threaten, shame or intimidate anyone, or encourage others to;',
          'post hate speech or attack people for their race, ethnicity, nationality, tribe, sex, disability, or for their church, denomination or faith;',
          'post sexual or pornographic content, or anything that sexualises children (we report child sexual abuse material to the authorities);',
          'post violent, graphic or self-harm content, or promote terrorism or criminal activity;',
          'scam, defraud or mislead people, including fake fundraisers, fake job offers, "seed offering" or miracle-for-money schemes, investment or crypto schemes, or requests for money in private messages;',
          'spam, send chain messages, or use bots or automated means to use the app;',
          'share someone else\'s private information, or photos or recordings of them, without permission;',
          'impersonate others or falsely claim to be a verified priest, pastor or ministry;',
          'upload content you do not have the right to share (for example copyrighted sermons, songs, books or videos without permission);',
          'interfere with, hack, scrape or overload the app, or get around our limits or safety features.',
        ] },
        'Respectful discussion of different beliefs and traditions is welcome. Please disagree graciously.',
      ],
    },
    {
      id: 'content', h: 'Your content',
      body: [
        'You own what you post. To run the app, you give us a **worldwide, non-exclusive, royalty-free licence** to host, store, copy, process, adapt (for example compress videos or create previews), display and distribute your content within BibleNestra and its public web pages (such as shared fundraiser or invite pages), for as long as it is on the service. This licence ends when you delete the content or your account, except where others have already shared it, or where we must keep it for legal or safety reasons.',
        'You are responsible for your content and promise that you have the rights to post it and that it follows these terms and the law. Public posts can be seen, shared and quoted by other users.',
      ],
    },
    {
      id: 'moderation', h: 'Reports, moderation and enforcement',
      body: [
        'You can report posts, comments, prayers, profiles, jobs, chats and other content in the app, and you can block people. Our moderators review reports and may remove content, limit features, remove you from groups, or suspend or ban accounts that break these terms, without notice where needed to protect others. Group owners and admins can also remove and ban people from their groups. We do not review everything before it is posted and are not responsible for what users post, but we act on reports. If you think we made a mistake, contact {{EMAIL}}.',
      ],
    },
    {
      id: 'ai', h: 'AI features',
      body: [
        'Scripture Companion, sermon notes and transcripts, exegesis and other AI features generate text automatically. **AI output may be wrong, incomplete or out of context.** Always read the Scripture itself and test what you read. AI output is not the teaching of any church and is not pastoral, medical, psychological, legal or financial advice. Do not rely on it for decisions about your health, safety, money or legal matters. Organisers who use AI to draft contest questions must review them before use.',
      ],
    },
    {
      id: 'crisis', h: 'Not an emergency service',
      body: [
        { note: 'BibleNestra is not a crisis or emergency service. If you or someone else is in danger, call your local emergency number now, or contact a crisis helpline. The app may show helplines for your country, but it cannot always detect when someone needs help, and nobody monitors messages in real time.' },
        'Chats with priests, the Apostle or other members of the Care network are conversations between people. We check priest applications before listing them, but we cannot guarantee anyone\'s identity, qualifications or advice.',
      ],
    },
    {
      id: 'jobs', h: 'Jobs, bids and opportunities',
      body: [
        'The jobs board lets members post work and send bids, and the opportunities section lists jobs, scholarships, grants and events gathered from other websites. **We are not an employer, recruiter or agent, and we are not a party to any agreement between members.** We do not check, endorse or guarantee any job, person, payment or outcome. Opportunity listings link to their original source, whose own terms apply. Be careful: never pay to apply for a job, and never share bank details, passwords or ID documents in chat. Placing a bid may cost coins; these are not refunded if a bid is not accepted.',
      ],
    },
    {
      id: 'contests', h: 'Contests, battles and games',
      body: [
        'Each contest has its own rules, eligibility, judging criteria and prizes, shown on the contest page; those rules form part of these terms for that contest. Organisers are responsible for their contests and for any non-coin prizes they promise. We may disqualify entries, withhold prizes or cancel contests in cases of cheating, multiple accounts, automated play or broken rules. Coin prizes follow the coin rules below.',
      ],
    },
    {
      id: 'coins', h: 'Coins, gifts and rewards',
      body: [{ ul: [
        'Coins, gifts, flames, badges and other virtual items are a **limited, non-transferable licence** to use features inside BibleNestra. They are **not money, have no cash value**, cannot be exchanged for cash, and cannot be sold or traded outside the app, unless we clearly say otherwise in the app for a specific feature.',
        'You may earn coins (for example welcome coins, rewarded ads, games and contests) and spend them (for example on bids or gifts). When you send a gift, part of its coin value may be credited to the creator, as shown in the app.',
        'We may change how coins are earned or priced, set limits, and correct mistakes. Coins may be removed if obtained by cheating, abuse or error, and are lost if your account is deleted or banned.',
      ] }],
    },
    {
      id: 'payments', h: 'Subscriptions, purchases and donations (if and when offered)',
      body: [
        'Paid features are not live yet. If and when we offer them: **BibleNestra Plus** subscriptions and **coin packs** will be sold through Google Play (or the App Store). Subscriptions renew automatically until you cancel in your store account. Prices, billing periods and refunds follow the store\'s terms and the price shown at purchase. Purchased coins follow the coin rules above and are not refundable except where the store\'s terms or the law require. **Fund Me donations** will be processed by a payment provider. A platform fee may apply and will be shown before you pay. We will update these terms with any extra details before payments go live.',
      ],
    },
    {
      id: 'fundme', h: 'Fund Me fundraisers',
      body: [
        'Fundraisers are reviewed before they go live, but **we do not verify every claim and do not guarantee how donations are used.** Fundraiser owners must tell the truth, use donations only for the stated purpose and follow the law, including tax and charity rules where they live. Donors give at their own risk and should only give to people and causes they trust. We may pause, remove or refuse any fundraiser.',
      ],
    },
    {
      id: 'ads', h: 'Ads',
      body: [
        'BibleNestra is free because it shows ads from Google AdMob. We try to keep ads appropriate for a Christian audience, but we do not control every ad and do not endorse advertisers. Rewarded ads give the rewards shown in the app only when the ad network confirms the ad was completed.',
      ],
    },
    {
      id: 'thirdparty', h: 'Third-party content, websites and videos',
      body: [
        'BibleNestra shows content from others: Bible translations and commentaries from public sources, YouTube videos and live streams, member websites opened in the in-app browser, and links to opportunities and helplines. These belong to their owners and are governed by their own terms (for example [YouTube\'s Terms of Service](https://www.youtube.com/t/terms)). We do not control them and are not responsible for them. Approval of a member website means it met our basic checks, not that we endorse it.',
      ],
    },
    {
      id: 'ip', h: 'Our app and intellectual property',
      body: [
        'The BibleNestra app, name, logo, design and our own content belong to us or our licensors. You may use the app for personal, non-commercial use under these terms. Do not copy, modify, reverse engineer or resell it except where the law allows. Bible texts are public domain or used under their licences. If you send us feedback or ideas, we may use them without obligation to you. To report content that infringes your copyright, email {{EMAIL}} with the details.',
      ],
    },
    {
      id: 'ending', h: 'Ending your use',
      body: [
        'You can stop using BibleNestra and delete your account at any time (Profile → Account → Delete my account, or see [Delete your account](/delete-account)). We may suspend or end your access if you break these terms, if the law requires it, or if we stop offering the service. Where reasonable, we will tell you and give you a chance to save your content. Sections that by their nature should continue (such as ownership, disclaimers, limits of liability and governing law) survive.',
      ],
    },
    {
      id: 'disclaimers', h: 'Disclaimers',
      body: [
        'We work hard to keep BibleNestra useful and safe, but it is provided **"as is" and "as available"**. To the fullest extent the law allows, we make no promises that it will always be available, error-free or secure, or that content (including AI output, user posts, Bible resources, listings and fundraisers) is accurate or reliable. Nothing in these terms limits rights you have as a consumer that cannot be limited by law.',
      ],
    },
    {
      id: 'liability', h: 'Limitation of liability',
      body: [
        'To the fullest extent the law allows, we are not liable for indirect, incidental, special or consequential losses, or for loss of data, profits, goodwill or opportunity, arising from your use of BibleNestra, from other users\' content or conduct, or from third-party services. Our total liability to you for any claim is limited to the greater of the amount you paid us in the 12 months before the claim or 50 US dollars (or the equivalent in your currency). We do not exclude liability for death or personal injury caused by our negligence, for fraud, or for anything else that cannot be excluded by law.',
      ],
    },
    {
      id: 'indemnity', h: 'Your responsibility to us',
      body: [
        'If you break these terms or the law, or your content infringes someone\'s rights, and this causes a claim against us, you agree to cover our reasonable losses and costs, to the extent the law allows.',
      ],
    },
    {
      id: 'law', h: 'Governing law and disputes',
      body: [
        'These terms are governed by the laws of **{{LAW}}**. Please contact us first at {{EMAIL}} so we can try to resolve any problem informally. If we cannot, disputes will be decided by the courts of {{LAW}}, unless the law of the country where you live gives you the right to bring a claim in your local courts or under your local law.',
      ],
    },
    {
      id: 'changes', h: 'Changes to these terms',
      body: [
        'We may update these terms. We will change the "last updated" date and, for important changes, tell you in the app before they take effect. If you keep using BibleNestra after that, you accept the new terms; if you do not agree, please stop using it and delete your account.',
      ],
    },
    {
      id: 'general', h: 'General',
      body: [
        'If any part of these terms cannot be enforced, the rest still applies. If we do not enforce a term straight away, we can still enforce it later. You may not transfer your rights under these terms; we may transfer ours to a company that takes over BibleNestra. These terms, the Privacy Policy and any feature-specific rules (such as contest rules) are the whole agreement between us about BibleNestra.',
      ],
    },
    {
      id: 'contact', h: 'Contact',
      body: [
        '**{{COMPANY}}**, {{ADDRESS}}. Email: **{{EMAIL}}**.',
      ],
    },
  ],
};

// =============================================================================================
// ACCOUNT DELETION PAGE (Google Play "delete account" web link)
// =============================================================================================
const DELETE = {
  slug: 'delete-account',
  title: 'Delete your BibleNestra account',
  intro: [
    'You can delete your BibleNestra account and its data at any time. This page explains how, what is deleted and what may be kept.',
  ],
  sections: [
    {
      id: 'in-app', h: 'Delete it in the app (fastest)',
      body: [{ ul: [
        'Open BibleNestra and sign in.',
        'Tap your profile picture, then open the **Account** tab.',
        'Tap **Delete my account**, type DELETE to confirm, and tap **Delete forever**.',
      ] }, 'Your account is deleted straight away and you are signed out.'],
    },
    {
      id: 'email', h: 'Can\'t use the app?',
      body: [
        'Email **{{EMAIL}}** from the email address you use to sign in, with the subject "Delete my account". Include your @handle if you know it. We may ask you to confirm the request from that address. We will delete your account within 30 days and confirm by email.',
      ],
    },
    {
      id: 'deleted', h: 'What is deleted',
      body: [{ ul: [
        'Your profile (name, @handle, photo, banner, bio, church, country) and your sign-in account at our login provider (Clerk).',
        'Your posts, photos, videos, comments, reactions, prayers and prayer updates, events, wishes and member websites.',
        'Messages you sent in chats and groups, including photos, voice notes and files, and your group memberships.',
        'Sermon recordings, transcripts and notes; media-library uploads; fundraisers and their documents.',
        'Bible notes, highlights, bookmarks, plan progress, reminders and streaks synced to our servers.',
        'Scripture Companion records, coins and coin history, gifts, contest entries, job posts and bids, notifications and push tokens.',
      ] }],
    },
    {
      id: 'kept', h: 'What may be kept',
      body: [{ ul: [
        'Information on **your phone** (Bible Chat and Companion history, offline notes, settings) stays until you erase it in the app (Profile → Account → Reset local data) or uninstall BibleNestra.',
        'A deletion record with the date and outcome, but **no personal details**, so we can show that the request was completed.',
        'Reports about you, and moderators\' records of actions taken against content or accounts, where needed to keep the community safe or to meet legal duties.',
        'Payment and tax records, if payments are switched on, for as long as the law requires.',
        'Copies in our providers\' backups, until they are overwritten on their normal backup cycle.',
        'Content other people already shared or saved outside BibleNestra (for example screenshots).',
      ] }],
    },
    {
      id: 'more', h: 'More information',
      body: [
        'See our [Privacy Policy](/privacy) and [Terms of Service](/terms). Questions: **{{EMAIL}}**.',
      ],
    },
  ],
};

export const LEGAL_DOCS = { terms: TERMS, privacy: PRIVACY, 'delete-account': DELETE };

// =============================================================================================
// Rendering
// =============================================================================================
const esc = (v) => String(v === null || v === undefined ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Values for each placeholder: the env var when set, else null (the bracketed placeholder is shown). */
export function legalValues(env = {}) {
  const out = {};
  for (const [k, p] of Object.entries(PLACEHOLDERS)) {
    const v = env && typeof env[p.env] === 'string' ? env[p.env].trim() : '';
    out[k] = v ? v.slice(0, 300) : null;
  }
  return out;
}

const SAFE_URL = /^(https:\/\/[^\s()]+|\/[a-z0-9\-/#]*|#[a-z0-9-]+)$/i;

// Inline markup → HTML. Text is escaped FIRST, then **bold** / [text](url) / {{PLACEHOLDER}} are applied.
function inlineHtml(text, vals) {
  let s = esc(text);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    const u = url.replace(/&amp;/g, '&');
    if (!SAFE_URL.test(u)) return label;
    const ext = u.startsWith('https://');
    return `<a href="${esc(u)}"${ext ? ' rel="noopener noreferrer" target="_blank"' : ''}>${label}</a>`;
  });
  s = s.replace(/\{\{([A-Z]+)\}\}/g, (m, k) => {
    const p = PLACEHOLDERS[k];
    if (!p) return m;
    const v = vals[k];
    if (!v) return `<span class="ph">${esc(p.label)}</span>`;
    if (k === 'EMAIL' && /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i.test(v)) return `<a href="mailto:${esc(v)}">${esc(v)}</a>`;
    return esc(v);
  });
  return s;
}

function blocksHtml(blocks, vals) {
  return blocks.map((b) => {
    if (typeof b === 'string') return `<p>${inlineHtml(b, vals)}</p>`;
    if (b.h3) return `<h3>${inlineHtml(b.h3, vals)}</h3>`;
    if (b.ul) return `<ul>${b.ul.map((li) => `<li>${inlineHtml(li, vals)}</li>`).join('')}</ul>`;
    if (b.note) return `<div class="note">${inlineHtml(b.note, vals)}</div>`;
    if (b.table) {
      const [head, ...rows] = b.table;
      return `<div class="tbl"><table><thead><tr>${head.map((h) => `<th>${inlineHtml(h, vals)}</th>`).join('')}</tr></thead><tbody>${
        rows.map((r) => `<tr>${r.map((c) => `<td>${inlineHtml(c, vals)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    }
    return '';
  }).join('\n');
}

const CSS = `
:root{--bg:#F6F2EA;--fg:#1C1915;--muted:#6B6257;--card:#fff;--line:#E7DFD1;--accent:#2E3A87;--gold:#A87A27;--note:rgba(184,58,58,.08);--noteline:#B83A3A;--ph:#FFF1C9}
@media (prefers-color-scheme:dark){:root{--bg:#14110E;--fg:#F1EBDF;--muted:#B3A895;--card:#1D1915;--line:#3A3229;--accent:#AEB8FF;--gold:#D9AE5F;--note:rgba(220,90,90,.14);--noteline:#E07A7A;--ph:#4A3B12}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
a{color:var(--accent)}
.wrap{max-width:720px;margin:0 auto;padding:0 16px 64px}
.top{display:flex;align-items:center;gap:10px;padding:16px 0 4px}
.brand{display:flex;align-items:center;gap:8px;font-family:Newsreader,Georgia,"Times New Roman",serif;font-weight:600;font-size:19px;color:var(--fg);text-decoration:none}
.brand i{display:inline-flex;width:30px;height:30px;border-radius:10px;background:#2E3A87;color:#fff;align-items:center;justify-content:center;font-style:normal;font-size:15px}
.eyebrow{font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:var(--gold);margin-top:22px}
h1{font-family:Newsreader,Georgia,"Times New Roman",serif;font-weight:600;font-size:32px;line-height:1.15;letter-spacing:-.4px;margin:6px 0 6px}
h2{font-family:Newsreader,Georgia,"Times New Roman",serif;font-weight:600;font-size:22px;line-height:1.25;margin:34px 0 8px;scroll-margin-top:12px}
h3{font-size:16px;margin:20px 0 4px}
.meta{color:var(--muted);font-size:14px;margin:0 0 14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:16px 18px;margin:18px 0}
.toc{columns:2;column-gap:20px;margin:0;padding-left:18px;font-size:14.5px}
@media (max-width:520px){.toc{columns:1}}
.toc li{margin:3px 0;break-inside:avoid}
p,li{max-width:68ch}ul{padding-left:20px}li{margin:6px 0}
.note{background:var(--note);border-left:3px solid var(--noteline);border-radius:12px;padding:12px 14px;margin:12px 0;font-weight:500}
.ph{background:var(--ph);border-radius:4px;padding:0 3px;font-weight:600}
.tbl{overflow-x:auto;margin:12px 0}
table{border-collapse:collapse;width:100%;font-size:14.5px;background:var(--card);border-radius:12px;overflow:hidden}
th,td{border:1px solid var(--line);padding:9px 10px;text-align:left;vertical-align:top}
th{font-weight:700}
.foot{margin-top:40px;color:var(--muted);font-size:14px;border-top:1px solid var(--line);padding-top:16px}
.foot a{margin-right:14px}
`;

/** Full HTML page for 'terms' | 'privacy' | 'delete-account'. No scripts. */
export function renderLegalPage(slug, env = {}) {
  const doc = LEGAL_DOCS[slug];
  if (!doc) return null;
  const vals = legalValues(env);
  const effective = vals.EFFECTIVE ? esc(vals.EFFECTIVE) : `<span class="ph">${esc(PLACEHOLDERS.EFFECTIVE.label)}</span>`;
  const toc = doc.sections.length > 4
    ? `<nav class="card" aria-label="Contents"><ol class="toc">${doc.sections.map((s) => `<li><a href="#${esc(s.id)}">${esc(s.h)}</a></li>`).join('')}</ol></nav>` : '';
  const sections = doc.sections.map((s) => `<section id="${esc(s.id)}"><h2>${inlineHtml(s.h, vals)}</h2>\n${blocksHtml(s.body, vals)}</section>`).join('\n');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#F6F2EA"><meta name="color-scheme" content="light dark">
<meta name="robots" content="index,follow">
<title>${esc(doc.title)} · BibleNestra</title><style>${CSS}</style></head>
<body><main class="wrap">
<header class="top"><span class="brand"><i>✦</i>BibleNestra</span></header>
<div class="eyebrow">Legal</div>
<h1>${esc(doc.title)}</h1>
<p class="meta">Effective ${effective} · Last updated ${esc(LEGAL_LAST_UPDATED)}</p>
${blocksHtml(doc.intro, vals)}
${toc}
${sections}
<footer class="foot"><a href="/terms">Terms of Service</a><a href="/privacy">Privacy Policy</a><a href="/delete-account">Delete your account</a></footer>
</main></body></html>`;
}

// ---------- Markdown (for review copies) ----------
function inlineMd(text, vals) {
  return String(text).replace(/\{\{([A-Z]+)\}\}/g, (m, k) => (PLACEHOLDERS[k] ? vals[k] || PLACEHOLDERS[k].label : m));
}

/** Markdown version of one document (links stay relative to the Worker unless `base` is given). */
export function renderMarkdown(slug, env = {}, { base = '' } = {}) {
  const doc = LEGAL_DOCS[slug];
  if (!doc) return null;
  const vals = legalValues(env);
  const fix = (t) => inlineMd(t, vals).replace(/\]\((\/[^)]*)\)/g, (m, p) => `](${base}${p})`);
  const blocks = (list) => list.map((b) => {
    if (typeof b === 'string') return fix(b);
    if (b.h3) return `### ${fix(b.h3)}`;
    if (b.ul) return b.ul.map((li) => `- ${fix(li)}`).join('\n');
    if (b.note) return `> ${fix(b.note)}`;
    if (b.table) {
      const [head, ...rows] = b.table;
      return [`| ${head.map(fix).join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(fix).join(' | ')} |`)].join('\n');
    }
    return '';
  }).join('\n\n');
  const out = [`# ${doc.title}`, `_Effective ${vals.EFFECTIVE || PLACEHOLDERS.EFFECTIVE.label} · Last updated ${LEGAL_LAST_UPDATED}_`, blocks(doc.intro)];
  for (const s of doc.sections) out.push(`## ${fix(s.h)}`, blocks(s.body));
  return out.join('\n\n') + '\n';
}
