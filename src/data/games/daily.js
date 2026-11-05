// Daily rotation for Bible games — pure functions, no React / RN imports (unit-testable in Node).
//
// Each game bank is split into pools (e.g. trivia: story questions, verse questions, book facts).
// For every pool we walk a seeded permutation of the whole pool, `take` items per day:
//   day N uses positions [N*take, N*take + take) (mod pool size) of that permutation.
// So no question repeats until the whole pool has been served (e.g. 209 story questions at
// 6/day = a 34-day cycle); options are re-shuffled every day. Everything is derived from the local calendar date (YYYY-MM-DD), so every user
// sees the same "today's set" and it changes at local midnight. No storage is needed.

// FNV-1a 32-bit string hash
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32 PRNG -> () => float in [0, 1)
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled(arr, seed) {
  const a = arr.slice();
  const r = rng(seed);
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const pad = (n) => (n < 10 ? '0' + n : '' + n);

// Local calendar date key, e.g. "2026-11-01"
export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Whole days since 1970-01-01 for a local date (DST-safe: uses the calendar date, not the clock)
export function dayNumber(d = new Date()) {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}

// Milliseconds until the next local midnight, and a short label ("7h", "42m")
export function msUntilReset(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return Math.max(0, next.getTime() - now.getTime());
}
export function resetLabel(now = new Date()) {
  const ms = msUntilReset(now);
  const h = Math.floor(ms / 3600000);
  if (h >= 1) return `${h}h`;
  return `${Math.max(1, Math.ceil(ms / 60000))}m`;
}

// Items of `pool` for `day`. The pool is walked through one seeded permutation, `take` items per
// day, so an item only comes back after the whole pool has been served (every ~L/take days).
export function takeForDay(pool, take, day, salt) {
  const L = pool.length;
  if (!L) return [];
  const n = Math.min(take, L);
  const perm = shuffled(pool.map((_, i) => i), hash(salt));
  const out = [];
  for (let k = 0; k < n; k += 1) out.push(pool[perm[(day * n + k) % L]]);
  return out;
}

// Shuffle a multiple-choice question's options for the day; returns a new object with the
// updated correctIndex (correct answer text is preserved).
export function shuffleOptions(q, seed) {
  if (!q || !Array.isArray(q.options)) return q;
  const order = shuffled(q.options.map((_, i) => i), seed);
  return { ...q, options: order.map((i) => q.options[i]), correctIndex: order.indexOf(q.correctIndex) };
}

// Build today's session. `mix` = [[poolKey, count], ...]; `items` carry `.pool`.
export function dailySelection(gameId, items, mix, date = new Date(), { shuffleChoices = true } = {}) {
  const day = dayNumber(date);
  const byPool = {};
  items.forEach((it) => { (byPool[it.pool] = byPool[it.pool] || []).push(it); });
  let picked = [];
  mix.forEach(([pool, count]) => {
    picked = picked.concat(takeForDay(byPool[pool] || [], count, day, `${gameId}:${pool}`));
  });
  picked = shuffled(picked, hash(`${gameId}@${day}`));
  return shuffleChoices ? picked.map((q) => shuffleOptions(q, hash(`${q.id}@${day}`))) : picked;
}

// ---------- Endless practice ("Keep playing") ----------
// Walks a seeded permutation of the WHOLE bank. No item repeats until every item has been served
// (a "lap"); then the next lap uses a fresh permutation, so the order changes every time round.
// `exclude` (e.g. today's daily set) is skipped. The whole state is { seed, position }, so a session
// can be saved and resumed later.
const lapCache = new Map();
function lapOrder(n, seed, lap) {
  const key = `${n}:${seed}:${lap}`;
  if (lapCache.has(key)) return lapCache.get(key);
  const perm = shuffled(Array.from({ length: n }, (_, i) => i), hash(`endless:${seed}#${lap}`));
  if (lap > 0 && n > 1) {
    // never serve the same item twice in a row across a lap boundary
    const prev = lapOrder(n, seed, lap - 1);
    if (perm[0] === prev[n - 1]) [perm[0], perm[1]] = [perm[1], perm[0]];
  }
  if (lapCache.size > 24) lapCache.delete(lapCache.keys().next().value);
  lapCache.set(key, perm);
  return perm;
}

export function createEndless(items, { seed = 1, start = 0, exclude = [] } = {}) {
  const L = items.length;
  const ex = new Set(exclude);
  const skipAll = L > 0 && items.every((it) => ex.has(it.id));
  let k = Math.max(0, start | 0);
  return {
    // -> { item, lap, served } or null for an empty bank
    next() {
      if (!L) return null;
      for (let guard = 0; guard <= L; guard += 1) {
        const lap = Math.floor(k / L);
        const item = items[lapOrder(L, seed, lap)[k % L]];
        k += 1;
        if (skipAll || !ex.has(item.id)) return { item, lap, served: k };
      }
      return null;
    },
    get position() { return k; },
    get size() { return L; },
  };
}

export function newSeed() {
  return (Math.floor(Math.random() * 0x7fffffff) ^ Date.now()) >>> 0;
}
