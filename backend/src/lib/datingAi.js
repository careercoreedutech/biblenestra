// FIND LOVE — Workers AI vision checks (client answers Q25 / Q26, scratch/monetisation/client-answers.md W7 / W8).
//
// * checkPhoto(): a new dating photo goes live at once unless the model flags it (nudity / sexual content, a minor,
//   violence, or no visible face). Any doubt → NOT clean: an error, a timeout, a missing AI binding or a reply that is
//   not the strict JSON we asked for all return verdict 'error', and the caller keeps the photo pending for a human.
//   This module never says 'clean' unless every flag came back as an explicit false.
// * verificationPrecheck(): ADVISORY ONLY. The vision models take one image per call, so this describes the selfie,
//   the ID photo and the main profile photo separately and compares what they report (the code written on paper, the
//   gesture, apparent gender and age, name and birth year on the ID). It is not a biometric face match; an admin decides.
//
// Models: env.DATING_VISION_MODEL first, then Llama 3.2 11B Vision, then LLaVA 1.5. Both take the image as an array of
// 8-bit integers (`image: [...bytes]`). Llama 3.2 Vision needs Meta's licence accepted once per Cloudflare account
// (send { prompt: 'agree' } to the model once, e.g. from the Workers AI playground); until then it errors and LLaVA
// answers instead.
export const VISION_MODELS = ['@cf/meta/llama-3.2-11b-vision-instruct', '@cf/llava-hf/llava-1.5-7b-hf'];
const MAX_IMAGE_BYTES = 6 * 1024 * 1024; // the app sends ≤ 1600 px JPEGs (~0.3 MB); anything huge goes to a human
const TIMEOUT_MS = 25000;

export const hasAI = (env) => !!(env && env.AI && typeof env.AI.run === 'function');

/** The bytes of an R2 object (Workers R2 object, or the dev / test bucket whose body is a Buffer). */
export async function readObjectBytes(env, key) {
  if (!env.MEDIA || !key) return null;
  const obj = await env.MEDIA.get(key);
  if (!obj) return null;
  if (typeof obj.arrayBuffer === 'function') return new Uint8Array(await obj.arrayBuffer());
  if (obj.body instanceof Uint8Array) return new Uint8Array(obj.body);
  if (obj.body) return new Uint8Array(await new Response(obj.body).arrayBuffer());
  return null;
}

function withTimeout(p, ms) {
  let t;
  return Promise.race([p, new Promise((_, no) => { t = setTimeout(() => no(new Error('AI timeout')), ms); })]).finally(() => clearTimeout(t));
}
function replyText(out) {
  if (out == null) return '';
  if (typeof out === 'string') return out;
  const r = out.response ?? out.description ?? (out.result && (out.result.response ?? out.result.description));
  if (r && typeof r === 'object') return JSON.stringify(r);
  return String(r ?? '');
}
/** The first {...} object in a model reply, or null. */
export function parseJsonReply(text) {
  const s = String(text || '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { const v = JSON.parse(s.slice(a, b + 1)); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch (e) { return null; }
}

/** One image + one prompt → { json, model }. Tries each model; throws when none gives parseable JSON. */
export async function runVisionJson(env, bytes, prompt, { maxTokens = 300, timeoutMs = TIMEOUT_MS } = {}) {
  if (!hasAI(env)) throw new Error('AI binding missing');
  if (!bytes || !bytes.length) throw new Error('no image');
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('image too large for the AI check');
  const image = Array.from(bytes);
  const models = [...new Set([env.DATING_VISION_MODEL, ...VISION_MODELS].filter(Boolean))];
  let lastErr = null;
  for (const model of models) {
    const input = /llava/i.test(model)
      ? { image, prompt, max_tokens: maxTokens }
      : { messages: [{ role: 'system', content: 'You are a careful image safety reviewer. Reply with one JSON object only.' }, { role: 'user', content: prompt }], image, max_tokens: maxTokens, temperature: 0 };
    try {
      const out = await withTimeout(env.AI.run(model, input), timeoutMs);
      const json = parseJsonReply(replyText(out));
      if (json) return { json, model };
      lastErr = new Error(`${model}: reply was not JSON`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('No vision model answered');
}

// ─── photo check ───────────────────────────────────────────────────────────────────────────────────────────────────
export const PHOTO_PROMPT = [
  'Check this photo for a Christian dating app. Answer ONLY with this JSON and nothing else:',
  '{"nudity": true|false, "sexual": true|false, "minor": true|false, "violence": true|false, "face_visible": true|false, "reason": "one short sentence"}',
  'nudity: exposed genitals, buttocks or breasts, or a photo focused on underwear or swimwear.',
  'sexual: a sexual pose, act or suggestive gesture.',
  'minor: anyone in the photo who may be under 18.',
  'violence: weapons aimed at someone, blood, injury or gore.',
  'face_visible: a real human face is clearly visible (false for objects, landscapes, cartoons, text or screenshots).',
].join('\n');
const FLAG_LABELS = { nudity: 'nudity', sexual: 'sexual content', minor: 'may show a minor', violence: 'violence', no_face: 'no visible person or face' };

/**
 * → { verdict: 'clean' | 'flagged' | 'error', reason, labels, model }. 'clean' only when nudity, sexual, minor and
 * violence are all explicitly false AND face_visible is explicitly true. Never throws.
 */
export async function checkPhoto(env, bytes) {
  if (!hasAI(env)) return { verdict: 'error', reason: 'AI check unavailable (no Workers AI binding)', labels: null, model: null };
  let r;
  try { r = await runVisionJson(env, bytes, PHOTO_PROMPT, { maxTokens: 200 }); } catch (e) {
    return { verdict: 'error', reason: `AI check failed: ${String((e && e.message) || e).slice(0, 160)}`, labels: null, model: null };
  }
  const j = r.json;
  const flags = ['nudity', 'sexual', 'minor', 'violence'];
  const complete = flags.every((k) => typeof j[k] === 'boolean') && typeof j.face_visible === 'boolean';
  if (!complete) return { verdict: 'error', reason: 'AI reply was incomplete', labels: j, model: r.model };
  const hits = flags.filter((k) => j[k] === true);
  if (j.face_visible !== true) hits.push('no_face');
  if (!hits.length) return { verdict: 'clean', reason: null, labels: j, model: r.model };
  const why = hits.map((k) => FLAG_LABELS[k]).join(', ');
  const note = typeof j.reason === 'string' && j.reason.trim() ? ` (${j.reason.trim().slice(0, 200)})` : '';
  return { verdict: 'flagged', reason: `AI flagged: ${why}${note}`, labels: j, model: r.model };
}

// ─── verification pre-check (advisory) ─────────────────────────────────────────────────────────────────────────────
export const GESTURES = {
  thumbs_up: { label: 'Thumbs up', words: ['thumb'] },
  peace_sign: { label: 'Peace sign (two fingers)', words: ['peace', 'v sign', 'v-sign', 'two fingers', 'victory'] },
  open_palm: { label: 'Open palm next to your face', words: ['palm', 'open hand', 'waving', 'wave'] },
  point_up: { label: 'Point one finger up', words: ['point', 'index finger', 'one finger'] },
  hand_on_chin: { label: 'Hand on your chin', words: ['chin'] },
};
const PERSON_PROMPT = (what) => [
  `This is ${what}. Describe the main person for an identity check. Answer ONLY with this JSON and nothing else:`,
  '{"face_visible": true|false, "people": number, "gender": "man"|"woman"|"unknown", "age_range": "under 18"|"18-25"|"26-35"|"36-45"|"46-60"|"over 60"|"unknown", "hair": "short description", "glasses": true|false, "gesture": "what the hands are doing", "text_seen": "any handwritten or printed numbers or words visible, exactly as written"}',
].join('\n');
const ID_PROMPT = [
  'This should be a photo of a government identity document (national ID, passport, driver\'s licence or voter\'s card). Answer ONLY with this JSON and nothing else:',
  '{"is_id_document": true|false, "document_type": "short name", "has_face_photo": true|false, "gender": "man"|"woman"|"unknown", "age_range": "under 18"|"18-25"|"26-35"|"36-45"|"46-60"|"over 60"|"unknown", "name": "full name as printed, or empty", "date_of_birth": "as printed, or empty"}',
].join('\n');
const AGE_BUCKETS = ['under 18', '18-25', '26-35', '36-45', '46-60', 'over 60'];
const bucketOf = (age) => (age < 18 ? 0 : age <= 25 ? 1 : age <= 35 ? 2 : age <= 45 ? 3 : age <= 60 ? 4 : 5);
const g = (v) => (['man', 'woman'].includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : null);

async function describe(env, bytes, prompt) {
  if (!bytes) return { ok: false, error: 'image not available' };
  try { const r = await runVisionJson(env, bytes, prompt, { maxTokens: 300 }); return { ok: true, ...r.json, _model: r.model }; } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 160) };
  }
}

/**
 * selfie / id / profilePhoto: Uint8Array or null. profile: { firstName, gender, age, birthYear }. code + gesture: the
 * challenge shown on screen. → { status: 'done' | 'unavailable', confidence: 'high'|'medium'|'low'|'unknown', note, details }.
 * The note never repeats the name or date of birth printed on the ID (only whether they match).
 */
export async function verificationPrecheck(env, { selfie, id, profilePhoto, profile, code, gesture }) {
  const advisory = 'Advisory only: the AI compares described features, not a biometric face match.';
  if (!hasAI(env)) return { status: 'unavailable', confidence: 'unknown', note: `AI pre-check unavailable (no Workers AI binding). Review the images yourself. ${advisory}`, details: null };
  const [s, d, p] = await Promise.all([
    describe(env, selfie, PERSON_PROMPT('a live selfie taken for verification; the person should hold up a handwritten code and make a hand gesture')),
    describe(env, id, ID_PROMPT),
    profilePhoto ? describe(env, profilePhoto, PERSON_PROMPT('a dating profile photo')) : Promise.resolve({ ok: false, error: 'no uploaded profile photo to compare' }),
  ]);
  if (!s.ok && !d.ok) return { status: 'unavailable', confidence: 'unknown', note: `AI pre-check failed (${s.error}). Review the images yourself. ${advisory}`, details: { selfie: s, id: d, profilePhoto: p } };
  const good = []; const warn = []; let score = 0; let hard = false;
  // selfie: one face, the code, the gesture
  if (s.ok) {
    if (s.face_visible === true && Number(s.people || 1) === 1) { good.push('one face visible in the selfie'); score += 1; } else { warn.push('selfie: no single clear face'); hard = true; }
    const digits = String(s.text_seen || '').replace(/\D/g, '');
    if (code && digits.includes(String(code))) { good.push(`code ${code} readable in the selfie`); score += 2; } else warn.push(`code ${code} not read in the selfie`);
    const gw = (GESTURES[gesture] || { words: [] }).words;
    if (gw.some((w) => String(s.gesture || '').toLowerCase().includes(w))) { good.push('requested gesture seen'); score += 1; } else warn.push('requested gesture not confirmed');
    if (s.age_range === 'under 18') { warn.push('selfie: person may be under 18'); hard = true; }
  } else warn.push(`selfie not checked (${s.error})`);
  // gender + age consistency across the dating profile, the selfie, the profile photo and the ID
  const pg = g(profile.gender);
  for (const [label, x] of [['selfie', s], ['profile photo', p], ['ID', d]]) {
    if (!x.ok) continue;
    const xg = g(x.gender);
    if (xg && pg) { if (xg === pg) { score += 1; good.push(`${label}: gender matches the profile`); } else { warn.push(`${label}: gender looks different from the profile`); hard = true; } }
    const bi = AGE_BUCKETS.indexOf(x.age_range);
    if (bi >= 0 && profile.age) { if (Math.abs(bi - bucketOf(profile.age)) <= 1) score += 1; else warn.push(`${label}: apparent age (${x.age_range}) far from the profile age ${profile.age}`); }
  }
  if (s.ok && p.ok && s.hair && p.hair) good.push(`hair: selfie "${String(s.hair).slice(0, 40)}" / profile "${String(p.hair).slice(0, 40)}"`);
  // ID document
  if (d.ok) {
    if (d.is_id_document === true && d.has_face_photo === true) { good.push(`looks like an ID with a photo (${String(d.document_type || 'document').slice(0, 40)})`); score += 1; } else { warn.push('the ID image does not look like an ID with a face photo'); hard = true; }
    const nm = String(d.name || '').toLowerCase();
    const first = String(profile.firstName || '').toLowerCase().trim();
    if (nm && first) { if (nm.includes(first)) { good.push('first name appears on the ID'); score += 1; } else warn.push('first name not found on the ID'); }
    const yr = (String(d.date_of_birth || '').match(/(19|20)\d{2}/) || [])[0];
    if (yr && profile.birthYear) { if (Number(yr) === Number(profile.birthYear)) { good.push('birth year on the ID matches the profile'); score += 2; } else { warn.push('birth year on the ID differs from the profile'); hard = true; } }
    if (d.age_range === 'under 18') { warn.push('ID: may be under 18'); hard = true; }
  } else warn.push(`ID not checked (${d.error})`);
  if (!p.ok) warn.push(`profile photo not compared (${p.error})`);
  const confidence = hard ? 'low' : score >= 7 ? 'high' : score >= 4 ? 'medium' : 'low';
  const note = [good.length ? `Matches: ${good.join('; ')}.` : '', warn.length ? `Check: ${warn.join('; ')}.` : '', advisory].filter(Boolean).join(' ').slice(0, 1500);
  return { status: 'done', confidence, note, details: { selfie: s, id: d, profilePhoto: p, score } };
}
