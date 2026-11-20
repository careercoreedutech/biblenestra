// SCRIPTURE COMPANION: curated, theme-tagged verse index.
//
// Each theme has a label, keywords (used for the instant safety/understanding pass and as a fallback when the
// model is unavailable) and ≥15 references, most central first. References use the app's USFM ids
// ("PHP 4:6-7"). Every entry is checked against the KJV verse table by backend/test/companion.test.mjs, and
// the verse TEXT is never stored here — it is always pulled from the Bible data in the reader's translation.

export const THEMES = {
  sickness: {
    label: 'Sickness and healing',
    keywords: ['sick', 'sickness', 'ill', 'illness', 'disease', 'cancer', 'diagnos', 'hospital', 'surgery', 'operation', 'pain', 'chronic', 'heal', 'healing', 'doctor', 'treatment', 'chemo', 'infection', 'fever', 'malaria', 'stroke', 'diabetes', 'kidney', 'heart attack', 'covid', 'health', 'medical', 'injury', 'recover'],
    refs: ['JER 17:14', 'PSA 103:2-3', 'PSA 147:3', 'JAS 5:14-15', 'ISA 53:5', 'EXO 15:26', 'PSA 41:3', '3JN 1:2', 'JER 30:17', 'PSA 30:2', 'MAL 4:2', 'PSA 107:20', '2KI 20:5', 'PRO 4:20-22', 'MRK 5:34', 'MAT 9:35', '2CO 12:9', 'PSA 73:26', 'ROM 8:18', 'LUK 5:31'],
  },
  finances: {
    label: 'Financial difficulty',
    keywords: ['money', 'debt', 'debts', 'rent', 'bills', 'broke', 'poor', 'poverty', 'financial', 'finances', 'salary', 'afford', 'loan', 'school fees', 'fees', 'bankrupt', 'pay', 'feed my family', 'food', 'business failing', 'business is failing', 'savings', 'income', 'eviction', 'evicted'],
    refs: ['PHP 4:19', 'MAT 6:31-33', 'PSA 37:25', 'DEU 8:18', 'HEB 13:5', '2CO 9:8', 'PSA 23:1', 'LUK 12:24', 'PSA 34:10', 'PRO 3:9-10', 'MAL 3:10', 'PRO 21:5', 'PRO 22:7', '1TI 6:6-8', 'PRO 10:22', 'MAT 6:26', 'PHP 4:11-13', 'ROM 13:8', 'LAM 3:22-23', 'PSA 112:5'],
  },
  depression: {
    label: 'Depression and discouragement',
    keywords: ['depress', 'discourag', 'hopeless', 'empty', 'numb', 'sad', 'sadness', 'down', 'low', 'worthless', 'no hope', 'give up', 'giving up', 'tired of everything', 'exhausted', 'burnt out', 'burned out', 'burnout', 'failure', 'can\'t go on', 'cannot go on', 'heavy', 'darkness', 'crying', 'cry every'],
    refs: ['PSA 42:11', 'PSA 34:18', 'ISA 40:29-31', 'PSA 40:1-3', '2CO 4:8-9', 'MAT 11:28-30', 'PSA 3:3', 'ROM 15:13', 'PSA 30:5', 'ISA 61:3', '2CO 4:16-18', 'DEU 31:8', 'JHN 16:33', 'PSA 31:24', '1KI 19:5-7', 'PSA 143:7-8', 'NEH 8:10', 'PSA 147:3', 'ISA 41:10'],
  },
  grief: {
    label: 'Grief and loss',
    keywords: ['died', 'death', 'dead', 'passed away', 'passed on', 'funeral', 'grief', 'grieving', 'mourning', 'mourn', 'loss of', 'lost my', 'buried', 'widow', 'widower', 'miscarriage', 'stillborn', 'bereave'],
    refs: ['MAT 5:4', 'PSA 34:18', 'REV 21:4', '1TH 4:13-14', 'JHN 11:25-26', 'JHN 14:1-3', '2CO 1:3-4', 'PSA 23:4', 'ROM 8:38-39', 'JHN 11:35', 'ECC 3:1-4', '1CO 15:55-57', 'ISA 25:8', 'PSA 73:26', 'LAM 3:31-33', 'PSA 116:15', '2CO 5:8', 'PSA 147:3', 'ISA 41:10'],
  },
  fear: {
    label: 'Fear',
    keywords: ['afraid', 'fear', 'scared', 'terrified', 'frightened', 'danger', 'threat', 'attack', 'nightmare', 'insecurity', 'kidnap', 'robbed', 'robbery', 'unsafe', 'courage', 'phobia', 'dread'],
    refs: ['ISA 41:10', '2TI 1:7', 'JOS 1:9', 'PSA 27:1', 'PSA 56:3-4', 'DEU 31:6', 'PSA 91:1-2', 'PSA 91:4-5', 'ISA 43:1-2', 'PSA 46:1-2', '1JN 4:18', 'MAT 10:29-31', 'PSA 118:6', 'HEB 13:6', 'PSA 34:4', 'PRO 29:25', 'PSA 121:7-8', 'ISA 54:17', 'PSA 23:4'],
  },
  anxiety: {
    label: 'Anxiety and worry',
    keywords: ['anxious', 'anxiety', 'worry', 'worried', 'worrying', 'stress', 'stressed', 'overwhelm', 'panic', 'nervous', 'restless', 'can\'t sleep', 'cannot sleep', 'insomnia', 'overthink', 'uncertain', 'uncertainty', 'pressure', 'tense'],
    refs: ['PHP 4:6-7', '1PE 5:7', 'MAT 6:34', 'MAT 6:25-27', 'PSA 94:19', 'PSA 55:22', 'ISA 26:3', 'JHN 14:27', 'PRO 12:25', 'PSA 46:10', 'PRO 3:5-6', 'LUK 12:25-26', 'PSA 139:23-24', '2TH 3:16', 'COL 3:15', 'PSA 4:8', 'ROM 8:28', 'PSA 56:3'],
  },
  loneliness: {
    label: 'Loneliness',
    keywords: ['lonely', 'loneliness', 'alone', 'no friends', 'isolated', 'isolation', 'nobody cares', 'no one cares', 'abandoned', 'rejected', 'left out', 'unloved', 'nobody', 'no one', 'by myself', 'single'],
    refs: ['DEU 31:6', 'HEB 13:5', 'PSA 68:6', 'PSA 27:10', 'MAT 28:20', 'PSA 25:16', 'JHN 14:18', 'PSA 139:7-10', 'ISA 49:15-16', 'ROM 8:38-39', 'ZEP 3:17', 'ECC 4:9-10', 'JHN 15:15', 'ISA 43:2', 'PSA 34:18', '2TI 4:16-17', 'PSA 147:3', 'ISA 41:10'],
  },
  marriage: {
    label: 'Marriage and relationships',
    keywords: ['marriage', 'married', 'husband', 'wife', 'spouse', 'divorce', 'separat', 'quarrel', 'fight', 'fighting', 'argument', 'relationship', 'boyfriend', 'girlfriend', 'fiance', 'in-law', 'in-laws', 'family conflict', 'my partner', 'wedding', 'unfaithful', 'reconcile'],
    refs: ['EPH 4:2-3', '1CO 13:4-7', 'COL 3:13-14', 'EPH 4:32', 'ECC 4:12', 'PRO 15:1', 'EPH 5:25', 'EPH 5:33', '1PE 3:7', '1PE 4:8', 'JAS 1:19', 'GEN 2:24', 'MRK 10:9', 'PRO 17:9', 'ROM 12:10', 'PHP 2:3-4', 'ROM 12:18', 'SNG 8:7', 'COL 3:19', 'RUT 1:16'],
  },
  children: {
    label: 'Waiting for children',
    keywords: ['child', 'children', 'baby', 'babies', 'pregnant', 'pregnancy', 'conceive', 'conception', 'fertility', 'infertility', 'infertile', 'barren', 'ivf', 'fruit of the womb', 'womb', 'trying for a baby', 'trying to conceive'],
    refs: ['1SA 1:27', 'PSA 113:9', 'GEN 18:14', 'GEN 21:1-2', 'LUK 1:37', 'PSA 127:3', '1SA 1:10-11', '1SA 1:17', 'GEN 25:21', 'GEN 30:22', 'HEB 11:11', 'LUK 1:13', 'HAB 2:3', 'PSA 27:14', 'LAM 3:25-26', 'ROM 4:20-21', 'PSA 37:4', 'ISA 40:31'],
  },
  job: {
    label: 'Job search and work',
    keywords: ['job', 'jobs', 'unemploy', 'employment', 'work', 'career', 'interview', 'laid off', 'layoff', 'fired', 'sacked', 'retrench', 'promotion', 'boss', 'office', 'vacancy', 'applications', 'cv', 'resume', 'hired', 'contract'],
    refs: ['PRO 16:3', 'PSA 37:5', 'JER 29:11', 'PRO 3:5-6', 'COL 3:23-24', 'PSA 90:17', 'MAT 7:7-8', 'PRO 22:29', 'PSA 32:8', 'PRO 16:9', 'ISA 30:21', 'DEU 28:12', 'PSA 121:1-2', 'ECC 9:10', 'PRO 12:11', 'ISA 43:19', 'DEU 31:8', 'PHP 4:19', 'JAS 1:5'],
  },
  exams: {
    label: 'Exams and studies',
    keywords: ['exam', 'exams', 'examination', 'test', 'tests', 'study', 'studies', 'studying', 'school', 'university', 'college', 'waec', 'jamb', 'neco', 'kcse', 'matric', 'gcse', 'a-level', 'thesis', 'dissertation', 'project defence', 'grades', 'student', 'semester', 'assignment', 'bar exam', 'board exam'],
    refs: ['JAS 1:5', 'PRO 2:6', 'DAN 1:17', 'PRO 16:3', 'COL 3:23', 'PHP 4:13', '2TI 2:15', 'PRO 18:15', 'PSA 119:99', 'DAN 1:20', 'PRO 4:7', 'PRO 1:5', 'JOS 1:8', 'PSA 32:8', '2TI 1:7', 'ECC 9:10', 'PHP 4:6-7', 'PRO 3:5-6', 'PSA 119:105', 'ISA 41:10'],
  },
  guilt: {
    label: 'Guilt and forgiveness',
    keywords: ['guilt', 'guilty', 'shame', 'ashamed', 'sin', 'sinned', 'forgive', 'forgiven', 'forgiveness', 'regret', 'mistake', 'condemn', 'backslid', 'repent', 'confess', 'my past', 'what i did', 'unworthy', 'abortion'],
    refs: ['1JN 1:9', 'PSA 103:12', 'ROM 8:1', 'ISA 1:18', 'PSA 51:10', 'PSA 32:5', 'MIC 7:18-19', '2CO 5:17', 'EPH 1:7', 'HEB 8:12', 'ISA 43:25', 'ACT 3:19', 'LUK 15:20', 'PSA 51:1-2', 'COL 1:13-14', 'HEB 4:16', 'PSA 130:3-4', 'JHN 8:10-11', 'PSA 32:1-2'],
  },
  temptation: {
    label: 'Temptation',
    keywords: ['tempt', 'temptation', 'lust', 'porn', 'pornography', 'addict', 'addiction', 'alcohol', 'drunk', 'drugs', 'gambling', 'betting', 'masturbat', 'fornicat', 'smoking', 'relapse', 'struggle with sin', 'urge', 'urges', 'weakness'],
    refs: ['1CO 10:13', 'JAS 1:12', 'JAS 4:7', 'HEB 4:15-16', 'HEB 2:18', 'MAT 26:41', 'GAL 5:16', 'PSA 119:11', '2TI 2:22', '1PE 5:8-9', 'EPH 6:11', 'ROM 6:12-14', 'ROM 13:14', 'PRO 4:23', 'TIT 2:11-12', '2PE 2:9', 'GAL 5:22-23', 'ROM 12:2', 'JUD 1:24'],
  },
  betrayal: {
    label: 'Betrayal and hurt',
    keywords: ['betray', 'betrayed', 'betrayal', 'cheated', 'cheating', 'lied to me', 'backstab', 'used me', 'deceived', 'hurt me', 'friend turned', 'stabbed in the back', 'disloyal', 'unfaithful', 'wronged', 'revenge', 'bitter', 'bitterness', 'resent'],
    refs: ['PSA 55:12-14', 'PSA 41:9', 'PSA 55:22', 'ROM 12:17-19', 'GEN 50:20', 'MAT 5:44', 'EPH 4:31-32', 'COL 3:13', 'PSA 27:10', 'LUK 6:27-28', 'PRO 20:22', '1PE 2:23', 'PSA 118:8', 'MIC 7:5-7', 'PSA 34:18', 'HEB 13:5', '2TI 4:16-17', 'ROM 8:28'],
  },
  gratitude: {
    label: 'Gratitude and celebration',
    keywords: ['thank', 'thankful', 'grateful', 'gratitude', 'celebrat', 'blessed', 'answered', 'testimony', 'praise', 'rejoice', 'happy', 'joy', 'good news', 'got the job', 'passed', 'promotion', 'birthday', 'anniversary', 'graduat', 'healed', 'delivered safely', 'new baby'],
    refs: ['PSA 118:24', '1TH 5:16-18', 'PSA 100:4-5', 'PSA 107:1', 'JAS 1:17', 'PSA 126:3', 'PHP 4:4', 'PSA 103:1-2', 'COL 3:17', 'PSA 16:11', 'PSA 9:1-2', 'EPH 5:19-20', 'PSA 30:11-12', 'PSA 136:1', '2CO 9:15', 'PSA 92:1-2', 'COL 2:6-7', 'PSA 34:1', 'NEH 8:10'],
  },
  newBeginnings: {
    label: 'New beginnings',
    keywords: ['new start', 'fresh start', 'start over', 'starting over', 'new beginning', 'new chapter', 'moving', 'relocat', 'new city', 'new country', 'new job', 'new year', 'change', 'transition', 'second chance', 'begin again', 'rebuild', 'travel', 'abroad', 'japa'],
    refs: ['ISA 43:18-19', '2CO 5:17', 'LAM 3:22-23', 'PHP 3:13-14', 'EZK 36:26', 'REV 21:5', 'JER 29:11', 'ISA 42:9', 'PSA 40:2-3', 'ROM 6:4', 'ECC 3:1', 'JOS 1:9', 'PRO 16:9', 'EPH 4:22-24', 'JOL 2:25', 'HAB 2:3', 'COL 3:10', 'PSA 51:10', 'ISA 40:31'],
  },
  dryness: {
    label: 'Spiritual dryness',
    keywords: ['dry', 'dryness', 'far from god', 'distant from god', 'god is silent', 'god feels far', 'can\'t pray', 'cannot pray', 'no desire to pray', 'lukewarm', 'cold', 'stagnant', 'doubt', 'doubting', 'faith is weak', 'weak faith', 'lost my faith', 'don\'t feel god', 'spiritual', 'bible reading', 'prayer life', 'backsliding'],
    refs: ['PSA 42:1-2', 'PSA 63:1', 'ISA 58:11', 'JHN 4:14', 'JHN 7:37-38', 'PSA 51:12', 'ISA 44:3', 'JAS 4:8', 'JER 29:13', 'PSA 143:6', 'REV 3:20', 'HOS 6:3', 'ISA 55:1', 'PSA 23:2-3', 'MAT 5:6', 'JHN 15:4-5', 'PSA 85:6', 'LAM 3:25', 'HEB 4:16'],
  },
  // Used for crisis messages (self-harm, suicide, abuse, danger) alongside the helplines.
  safety: {
    label: 'Refuge and safety',
    keywords: ['abuse', 'abused', 'abusive', 'beat me', 'beats me', 'hits me', 'violence', 'violent', 'assault', 'raped', 'rape', 'harass', 'stalk', 'trafficked', 'threatened', 'domestic'],
    refs: ['PSA 9:9', 'PSA 18:2', 'PRO 18:10', 'PSA 91:2', 'PSA 10:17-18', 'PSA 46:1', 'PSA 34:17-18', 'NAM 1:7', 'PSA 5:11', 'PSA 72:12-14', 'ISA 61:1', 'PSA 140:1', 'DEU 31:6', 'ISA 54:17', '2SA 22:3'],
  },
  despair: {
    label: 'Hope in despair',
    keywords: ['suicid', 'kill myself', 'end my life', 'end it all', 'want to die', 'wish i was dead', 'better off dead', 'self-harm', 'self harm', 'hurt myself', 'cut myself', 'cutting', 'overdose', 'no reason to live', 'not worth living'],
    refs: ['PSA 34:18', 'PSA 147:3', 'ISA 41:10', 'MAT 11:28', 'PSA 40:1-3', 'PSA 139:13-14', 'JER 29:11', 'ROM 8:38-39', 'ISA 43:1-2', 'PSA 23:4', '2CO 4:8-9', 'PSA 61:2', 'ISA 42:3', 'DEU 33:27', 'PSA 18:6', 'JHN 10:10', '1PE 5:7'],
  },
  // General hope and strength: tops up a reply when a situation names no clear theme.
  hope: {
    label: 'Hope and strength',
    keywords: ['hope', 'strength', 'encourage', 'help me', 'pray for me', 'tired', 'weary', 'weak', 'struggling', 'hard time', 'difficult'],
    refs: ['ROM 15:13', 'JER 29:11', 'PSA 46:1', 'ISA 40:31', 'PHP 4:13', 'ROM 8:28', 'LAM 3:22-23', 'PSA 121:1-2', 'MAT 11:28', '2CO 12:9', 'PSA 23:1', 'JHN 16:33', 'NUM 6:24-26', 'ZEP 3:17', 'HEB 6:19', 'DEU 31:8'],
  },
};

export const THEME_KEYS = Object.keys(THEMES);
// The themes the model may choose from (safety/despair are set by the crisis check; hope is the fallback).
export const SITUATION_THEMES = THEME_KEYS.filter((k) => !['hope'].includes(k));
