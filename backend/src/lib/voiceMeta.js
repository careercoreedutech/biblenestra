// VOICE NOTES (chat gaps): clean the meta a client sends with a kind='voice' message.
//   meta.durationMs  whole milliseconds, 0 … 15 min
//   meta.waveform    up to WAVEFORM_MAX loudness levels 0…1 (2 decimals), sampled while recording; longer arrays are
//                    squeezed down (loudest level of each bucket), junk values become 0, fewer than 2 levels are dropped.
// Everything else in meta (file, name, mentions, …) passes through untouched.
export const WAVEFORM_MAX = 64;
export const MAX_VOICE_MS = 15 * 60 * 1000;

const level = (v) => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.max(0, Math.min(1, n)) * 100) / 100;
};

export function cleanWaveform(input) {
  if (!Array.isArray(input) || input.length < 2) return null;
  const src = input.slice(0, 2000).map(level); // a very long array is cut before any work is done on it
  if (src.length <= WAVEFORM_MAX) return src;
  const out = [];
  for (let i = 0; i < WAVEFORM_MAX; i++) {
    const a = Math.floor((i * src.length) / WAVEFORM_MAX);
    const b = Math.max(a + 1, Math.floor(((i + 1) * src.length) / WAVEFORM_MAX));
    let peak = 0;
    for (let j = a; j < b; j++) if (src[j] > peak) peak = src[j];
    out.push(peak);
  }
  return out;
}

export function cleanVoiceMeta(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return meta;
  const out = { ...meta };
  if ('durationMs' in out) {
    const d = Number(out.durationMs);
    if (Number.isFinite(d) && d > 0) out.durationMs = Math.round(Math.min(d, MAX_VOICE_MS));
    else delete out.durationMs;
  }
  if ('waveform' in out) {
    const w = out.file ? null : cleanWaveform(out.waveform); // audio files picked from the phone carry no waveform
    if (w) out.waveform = w;
    else delete out.waveform;
  }
  return out;
}
