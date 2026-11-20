// SCRIPTURE COMPANION: the candidate pool for meaning (embedding) search.
//
// The pool = every reference in the curated theme index (companionIndex.js) + EXTRA_REFS below: well-known
// comfort and guidance passages that aren't in the index, each tagged with the themes it fits (the tags drive
// the abuse/danger exclusions and the theme labels on the reply). Every entry is checked against the KJV verse
// table by backend/test/companionSemantic.test.mjs. As in the index, verse TEXT is never stored here.
import { THEMES, THEME_KEYS } from './companionIndex.js';

export const EXTRA_REFS = {
  sickness: ['PSA 6:2', 'PSA 34:19', 'ISA 58:8', 'MAT 8:16-17', 'ACT 10:38', 'PSA 103:4', 'MRK 1:41', 'LUK 8:48'],
  finances: ['MAT 6:11', 'PSA 145:15-16', 'PRO 30:8', 'GEN 22:14', 'PSA 84:11', 'LUK 6:38', '1KI 17:16', 'DEU 15:10'],
  depression: ['PSA 13:5-6', 'PSA 18:28', 'PSA 77:1-2', 'ISA 50:10', 'JON 2:7', 'PSA 119:28', 'MIC 7:8', 'PSA 43:5'],
  grief: ['PSA 56:8', 'JHN 16:22', 'REV 7:17', '2SA 12:23', 'ROM 14:8', 'ISA 57:1-2'],
  fear: ['PSA 3:5-6', 'PSA 112:7', 'ISA 12:2', 'MRK 4:39-40', 'PSA 27:3', 'ISA 35:4', 'LUK 12:32', 'MRK 5:36'],
  anxiety: ['PSA 131:2', 'ISA 30:15', 'PSA 37:7', 'EXO 14:14', 'PSA 62:5-6', 'MAT 6:8', 'ISA 32:17'],
  loneliness: ['GEN 28:15', 'ISA 41:13', 'PSA 73:23-24', 'JHN 16:32', 'MAT 1:23', 'ROM 8:15', '1JN 3:1'],
  marriage: ['PRO 18:22', 'PRO 31:10-11', 'PSA 133:1', 'EPH 4:26'],
  children: ['1SA 2:21', 'JDG 13:3', 'LUK 1:24-25', 'PSA 128:3'],
  job: ['PRO 10:4', 'GEN 39:2-3', 'PSA 128:2', 'NEH 2:20', 'ISA 48:17', 'PSA 37:23-24', 'PRO 13:4'],
  exams: ['PRO 9:10', 'PSA 111:10', 'DAN 2:21', 'ISA 50:4', 'PSA 90:12', 'ECC 7:12'],
  guilt: ['ISA 44:22', 'ROM 5:8', 'EPH 2:8-9', 'ROM 3:23-24', 'LUK 7:47-48', 'PSA 86:5', 'ISA 55:7'],
  temptation: ['PSA 119:9', 'ROM 8:13', '1JN 2:16-17', 'GAL 6:9', 'ROM 7:24-25', 'JHN 8:36'],
  betrayal: ['PSA 109:4', 'MAT 18:21-22', 'LUK 23:34'],
  gratitude: ['PSA 95:1-2', 'PSA 103:5', 'ISA 25:1', 'LUK 1:46-47', 'PSA 28:7', 'PSA 147:1'],
  newBeginnings: ['GEN 12:1', 'ISA 65:17', 'PRO 4:18', '1PE 1:3', 'ISA 61:4'],
  dryness: ['PSA 84:2', 'PSA 27:4', 'ISA 40:28', 'HAB 3:17-18', 'MRK 9:24', 'PSA 16:8', 'ROM 10:17'],
  safety: ['PSA 32:7', 'PSA 57:1', 'PSA 59:16', 'ISA 25:4', 'PSA 31:2-3', 'PSA 142:5-6'],
  despair: ['PSA 116:8', 'JON 2:6', 'LAM 3:55-57', 'PSA 116:1-2', 'PSA 30:3'],
  hope: ['PSA 62:1-2', 'ISA 26:4', 'PSA 37:3', 'ROM 5:3-5', 'HEB 10:23', 'PSA 27:13', 'JAS 1:2-4', 'ROM 8:31', 'NUM 23:19', 'HEB 11:1', 'JHN 3:16', 'PSA 91:11'],
};

// ref → [themes] for the whole pool (index first, then extras)
export const POOL = new Map();
for (const k of THEME_KEYS) for (const ref of THEMES[k].refs) POOL.set(ref, [...(POOL.get(ref) || []), k].filter((x, i, a) => a.indexOf(x) === i));
for (const [k, refs] of Object.entries(EXTRA_REFS)) for (const ref of refs) POOL.set(ref, [...(POOL.get(ref) || []), k].filter((x, i, a) => a.indexOf(x) === i));

export const poolRefs = () => [...POOL.keys()];
export const refThemes = (ref) => POOL.get(ref) || [];
