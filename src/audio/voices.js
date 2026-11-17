// Matches each narrator to a real voice installed on the phone (expo-speech / the device's text-to-speech).
// Phones don't report a voice's gender, so we recognise it from the voice id/name:
//   • Google TTS (most Android): en-us-x-iom-local, en-gb-x-gbb-network … (letter codes below)
//   • Samsung TTS: en-US-SMTm00 (m = male) / en-US-SMTf00 (f = female)
//   • iOS: voice names (Daniel, Aaron, Fred… / Samantha, Karen, Moira…)
// Each narrator prefers its own accent (US, UK, African…), then any voice of the right gender. If the phone
// has no voice of that gender we fall back to the default voice with a gentle pitch shift, and say so.

// Google TTS voice codes → gender (from Google's voice catalogue)
const GOOGLE = {
  // en-US
  sfg: 'f', iob: 'f', iog: 'f', tpc: 'f', tpf: 'f', iol: 'm', iom: 'm', tpd: 'm',
  // en-GB
  gba: 'f', gbc: 'f', gbg: 'f', gbb: 'm', gbd: 'm', rjs: 'm',
  // en-AU
  aua: 'f', auc: 'f', aub: 'm', aud: 'm',
  // en-IN
  ena: 'f', enc: 'f', ahp: 'f', cxx: 'f', end: 'm', ene: 'm',
  // en-NG / en-KE / en-ZA (where installed)
  tfn: 'f', tfo: 'm',
};

const IOS_MALE = ['aaron', 'arthur', 'daniel', 'fred', 'gordon', 'oliver', 'rishi', 'reed', 'rocko', 'eddy', 'grandpa', 'ralph', 'albert', 'junior', 'alex', 'tom', 'evan', 'nathan', 'lee', 'malcolm'];
const IOS_FEMALE = ['samantha', 'karen', 'moira', 'tessa', 'fiona', 'victoria', 'serena', 'martha', 'catherine', 'kate', 'nicky', 'allison', 'ava', 'susan', 'zoe', 'shelley', 'sandy', 'flo', 'grandma', 'kathy', 'veena', 'isha', 'nora', 'stephanie', 'joelle', 'noelle', 'siri female'];

/** 'male' | 'female' | null */
export function voiceGender(v) {
  const id = String((v && v.identifier) || '').toLowerCase();
  const name = String((v && v.name) || '').toLowerCase();
  const g = id.match(/-x-([a-z]{3})(?:-|$)/) || name.match(/-x-([a-z]{3})(?:-|$)/);
  if (g && GOOGLE[g[1]]) return GOOGLE[g[1]] === 'm' ? 'male' : 'female';
  const smt = `${id} ${name}`.match(/smt([mf])\d/);
  if (smt) return smt[1] === 'm' ? 'male' : 'female';
  if (/\bmale\b/.test(name) && !/female/.test(name)) return 'male';
  if (/female/.test(name)) return 'female';
  const word = (id.split('.').pop() || name).replace(/[^a-z ]/g, ' ').trim();
  if (IOS_MALE.some((n) => word === n || name === n || name.startsWith(`${n} `))) return 'male';
  if (IOS_FEMALE.some((n) => word === n || name === n || name.startsWith(`${n} `))) return 'female';
  return null;
}

const region = (v) => String(v.language || '').toLowerCase().replace('_', '-');
const isNetwork = (v) => /network/i.test(v.identifier || '') || /network/i.test(v.name || '');
const quality = (v) => (String(v.quality || '').toLowerCase() === 'enhanced' ? 1 : 0);

/** Sorts a narrator's candidate voices: preferred accents first, better quality, installed (offline) first. */
function rank(voices, accents) {
  return voices.slice().sort((a, b) => {
    const ia = accents.findIndex((x) => region(a).startsWith(x));
    const ib = accents.findIndex((x) => region(b).startsWith(x));
    const ra = ia < 0 ? 99 : ia;
    const rb = ib < 0 ? 99 : ib;
    if (ra !== rb) return ra - rb;
    if (quality(a) !== quality(b)) return quality(b) - quality(a);
    if (isNetwork(a) !== isNetwork(b)) return isNetwork(a) ? 1 : -1;
    return String(a.identifier).localeCompare(String(b.identifier));
  });
}

/**
 * Picks a distinct installed voice for every narrator.
 * → { [narratorId]: { voice: identifier|undefined, pitch, matched: boolean, accent: 'en-gb'|… } }
 */
export function assignVoices(narrators, voices) {
  const english = (voices || []).filter((v) => region(v).startsWith('en'));
  const pools = { male: english.filter((v) => voiceGender(v) === 'male'), female: english.filter((v) => voiceGender(v) === 'female') };
  const used = new Set();
  const out = {};
  for (const n of narrators) {
    const ranked = rank(pools[n.gender] || [], n.accents || ['en-us']);
    // prefer a voice no other narrator has taken; share one only if the phone has too few
    const pick = ranked.find((v) => !used.has(v.identifier)) || ranked[0];
    if (pick) {
      used.add(pick.identifier);
      out[n.id] = { voice: pick.identifier, pitch: n.pitch, matched: true, accent: region(pick) };
    } else {
      // no voice of this gender on the phone: default voice, nudged towards the right register
      out[n.id] = { voice: undefined, pitch: n.gender === 'male' ? n.fallbackPitch || 0.8 : n.fallbackPitch || 1.15, matched: false, accent: null };
    }
  }
  return out;
}

export function voiceCounts(voices) {
  const english = (voices || []).filter((v) => region(v).startsWith('en'));
  return {
    male: english.filter((v) => voiceGender(v) === 'male').length,
    female: english.filter((v) => voiceGender(v) === 'female').length,
    total: english.length,
  };
}
