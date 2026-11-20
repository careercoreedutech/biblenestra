// JOB & ACADEMIC DIRECTORY: the 51 platforms the client asked for, in 7 categories. The app shows them in
// Opportunities → Directory (open in the in-app browser). Admins can edit, hide or add entries from the
// dashboard; edits are stored in the opportunity_directory table and override these defaults by slug.
//
// access:  live       — listings are imported into the app (sources = importer keys in lib/opportunities.js)
//          permission — the site has a feed, but its terms/robots need written permission first; the importer
//                       exists and is OFF until an admin switches it on
//          key        — needs an API key / OAuth token from the platform (env var); turns on when the key is set
//          partner    — needs a partner/affiliate/subscription agreement; no importer yet
//          link       — no usable feed or API; directory link only
// See scratch/jobs-integrations.md for the research behind each entry.

export const CATEGORIES = [
  { id: 'intl', label: 'International & remote', short: 'Remote & global', blurb: 'Global job boards and remote-first companies hiring worldwide.' },
  { id: 'africa', label: 'Nigerian & African', short: 'Nigeria & Africa', blurb: 'Job boards focused on Nigeria and the rest of Africa.' },
  { id: 'freelance', label: 'Freelancing', short: 'Freelance', blurb: 'Find clients and paid projects you can do from anywhere.' },
  { id: 'ai', label: 'AI training, data & tech', short: 'AI & tech', blurb: 'AI training, data annotation and tech talent networks.' },
  { id: 'academic', label: 'Academic & university', short: 'Academic', blurb: 'Lecturer, researcher and university staff jobs.' },
  { id: 'research', label: 'Research & scientific', short: 'Research', blurb: 'Research, lab and postdoc positions in science.' },
  { id: 'funding', label: 'Scholarships & funding', short: 'Scholarships', blurb: 'Scholarships, PhDs, fellowships and research funding.' },
];
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
export const ACCESS = ['live', 'permission', 'key', 'partner', 'link'];

const e = (category, slug, name, url, description, access = 'link', sources = []) => ({ category, slug, name, url, description, access, sources });

export const DIRECTORY = [
  // 1 International & remote
  e('intl', 'linkedin', 'LinkedIn Jobs', 'https://www.linkedin.com/jobs/', 'The largest professional network. Search jobs worldwide and set job alerts.'),
  e('intl', 'weworkremotely', 'We Work Remotely', 'https://weworkremotely.com/', 'One of the biggest remote-only job boards: programming, design, support, sales and more.', 'permission', ['weworkremotely']),
  e('intl', 'remoteok', 'Remote OK', 'https://remoteok.com/', 'Remote jobs in tech, marketing, customer support and more, many open worldwide.', 'live', ['remoteok']),
  e('intl', 'himalayas', 'Himalayas', 'https://himalayas.app/jobs', 'Remote jobs with clear location and time-zone rules, so you can see who can hire from Nigeria.', 'live', ['himalayas']),
  e('intl', 'remotive', 'Remotive', 'https://remotive.com/', 'Hand-picked remote jobs at tech companies.', 'live', ['remotive']),
  e('intl', 'workingnomads', 'Working Nomads', 'https://www.workingnomads.com/jobs', 'Curated remote jobs for people who want to work from anywhere.', 'live', ['workingnomads']),
  e('intl', 'wellfound', 'Wellfound', 'https://wellfound.com/jobs', 'Startup jobs (formerly AngelList Talent), with salary and equity shown up front.'),
  e('intl', 'indeed', 'Indeed Nigeria', 'https://ng.indeed.com/', 'Nigeria’s edition of the world’s biggest job search engine.'),
  e('intl', 'jooble', 'Jooble Nigeria', 'https://ng.jooble.org/', 'A job search engine that gathers vacancies from many Nigerian sites in one place.', 'key', ['jooble']),

  // 2 Nigerian & African
  e('africa', 'jobberman', 'Jobberman', 'https://www.jobberman.com/', 'Nigeria’s best-known job site, with jobs across every industry and free career resources.', 'partner'),
  e('africa', 'myjobmag', 'MyJobMag', 'https://www.myjobmag.com/', 'Thousands of Nigerian vacancies, updated daily, plus graduate trainee schemes.', 'live', ['myjobmag']),
  e('africa', 'hotnigerianjobs', 'Hot Nigerian Jobs', 'https://hotnigerianjobs.com/', 'Daily Nigerian job vacancies, recruitment drives and graduate programmes.', 'live', ['hotnigerianjobs']),
  e('africa', 'ngcareers', 'NgCareers', 'https://www.ngcareers.com/', 'Nigerian job listings. NgCareers now redirects to Jobberman.'),
  e('africa', 'jobzilla', 'Jobzilla', 'https://jobzilla.ng/', 'Fresh Nigerian job listings from employers across the country.', 'live', ['jobzilla']),
  e('africa', 'fuzu', 'Fuzu', 'https://www.fuzu.com/', 'Jobs and free career courses for Nigeria, Kenya and Uganda.', 'partner'),
  e('africa', 'brightermonday', 'BrighterMonday', 'https://www.brightermonday.co.ke/', 'East Africa’s leading job site (Kenya, Uganda, Tanzania).', 'partner'),
  e('africa', 'careers24', 'Careers24', 'https://www.careers24.com/', 'One of South Africa’s largest job sites.'),

  // 3 Freelancing
  e('freelance', 'upwork', 'Upwork', 'https://www.upwork.com/', 'The biggest freelance marketplace: writing, design, development, admin and more.', 'partner'),
  e('freelance', 'fiverr', 'Fiverr', 'https://www.fiverr.com/', 'Sell your skills as fixed-price “gigs” to buyers around the world.', 'partner'),
  e('freelance', 'freelancer', 'Freelancer', 'https://www.freelancer.com/', 'Bid on freelance projects posted by clients worldwide.', 'key', ['freelancer']),
  e('freelance', 'contra', 'Contra', 'https://contra.com/', 'Commission-free freelancing with a portfolio-style profile.'),
  e('freelance', 'toptal', 'Toptal', 'https://www.toptal.com/', 'An exclusive network for top developers, designers and finance experts (screening required).'),
  e('freelance', 'peopleperhour', 'PeoplePerHour', 'https://www.peopleperhour.com/', 'Freelance projects and hourly work, popular with UK and European clients.'),

  // 4 AI training, data & tech
  e('ai', 'andela', 'Andela', 'https://www.andela.com/', 'Connects African and global tech talent with remote roles at international companies.', 'live', ['andela']),
  e('ai', 'turing', 'Turing', 'https://www.turing.com/', 'Remote software and AI-training jobs with US companies.', 'live', ['turing']),
  e('ai', 'telusdigital', 'TELUS Digital', 'https://www.telusdigital.com/careers', 'AI data, rating and annotation work, plus customer-experience roles.'),
  e('ai', 'welodata', 'Welo Data', 'https://www.welodata.ai/', 'AI training and data work, including roles for Hausa, Igbo and Yoruba speakers.', 'live', ['welodata']),
  e('ai', 'mercor', 'Mercor', 'https://www.mercor.com/', 'Matches experts with paid AI-training and contract work.', 'live', ['mercor']),
  e('ai', 'invisible', 'Invisible', 'https://www.invisible.co/', 'AI training and operations work with leading AI labs.', 'live', ['invisible']),
  e('ai', 'micro1', 'micro1', 'https://www.micro1.ai/', 'AI-vetted remote engineering and AI-training jobs.'),

  // 5 Academic & university
  e('academic', 'jobsacuk', 'Jobs.ac.uk', 'https://www.jobs.ac.uk/', 'UK and international jobs in universities, research and higher education.'),
  e('academic', 'timeshighered', 'Times Higher Education Jobs', 'https://www.timeshighereducation.com/unijobs/', 'University jobs worldwide from Times Higher Education.', 'permission', ['timeshighered']),
  e('academic', 'academicpositions', 'Academic Positions', 'https://academicpositions.com/', 'PhD, postdoc and faculty jobs, mostly in Europe.'),
  e('academic', 'euraxess', 'EURAXESS', 'https://euraxess.ec.europa.eu/jobs', 'The European Commission’s portal for research jobs and funding in Europe.'),
  e('academic', 'higheredjobs', 'HigherEdJobs', 'https://www.higheredjobs.com/', 'Faculty and staff jobs at US colleges and universities.'),
  e('academic', 'academicjobsonline', 'Academic Jobs Online', 'https://academicjobsonline.org/', 'Faculty and postdoc jobs, mainly in mathematics and the sciences, with online applications.', 'live', ['academicjobsonline']),
  e('academic', 'chronicle', 'Chronicle Jobs', 'https://jobs.chronicle.com/', 'Higher-education jobs from The Chronicle of Higher Education.', 'permission', ['chronicle']),
  e('academic', 'academiccareers', 'Academic Careers', 'https://academiccareers.com/', 'Faculty and research jobs at universities worldwide.', 'permission', ['academiccareers']),
  e('academic', 'academictransfer', 'AcademicTransfer', 'https://www.academictransfer.com/', 'PhD, postdoc and academic jobs at Dutch universities.', 'partner'),
  e('academic', 'findapostdoc', 'FindAPostDoc', 'https://www.findapostdoc.com/', 'Postdoctoral research jobs worldwide.'),

  // 6 Research & scientific
  e('research', 'naturecareers', 'Nature Careers', 'https://www.nature.com/naturecareers', 'Science jobs, PhDs and postdocs from the publisher of Nature.', 'permission', ['naturecareers']),
  e('research', 'sciencecareers', 'Science Careers', 'https://www.science.org/careers', 'Science jobs and career advice from AAAS, publisher of Science.', 'permission', ['sciencecareers']),
  e('research', 'researchgate', 'ResearchGate Jobs', 'https://www.researchgate.net/jobs', 'Research jobs shared on the ResearchGate scientists’ network.'),
  e('research', 'newscientist', 'New Scientist Jobs', 'https://www.newscientist.com/jobs/', 'Science jobs from New Scientist. Their job board closed in late 2025; the link shows their notice.'),
  e('research', 'eurosciencejobs', 'EuroScienceJobs', 'https://www.eurosciencejobs.com/', 'Science and research jobs across Europe.'),
  e('research', 'postdocjobs', 'Postdoc Jobs', 'https://www.postdocjobs.com/', 'Postdoctoral positions, mainly in the United States.'),

  // 7 Scholarships & funding
  e('funding', 'scholarshipportal', 'ScholarshipPortal', 'https://www.scholarshipportal.com/', 'Search thousands of scholarships for study abroad.', 'partner'),
  e('funding', 'findaphd', 'FindAPhD', 'https://www.findaphd.com/', 'Funded PhD projects and studentships, many open to international students.', 'partner'),
  e('funding', 'cscuk', 'Commonwealth Scholarships', 'https://cscuk.fcdo.gov.uk/', 'UK-funded Master’s, PhD and fellowship awards for Commonwealth citizens, including Nigerians.', 'live', ['cscuk']),
  e('funding', 'chevening', 'Chevening', 'https://www.chevening.org/', 'The UK government’s fully funded Master’s scholarships. Applications usually open August to November.'),
  e('funding', 'cos', 'COS Funding Opportunities', 'https://www.cos.com/', 'Research funding database (now Pivot-RP by Clarivate); needs a university subscription.', 'partner'),
];

export const directoryBySlug = (slug) => DIRECTORY.find((d) => d.slug === slug);
