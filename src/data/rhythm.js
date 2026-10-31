// Daily rhythm + streak helpers (Today tab).
// state.rhythm = { 'YYYY-MM-DD': ['verse', 'reading', 'prayer', 'reflect'] }
// A day counts toward the streak if at least one step was completed.
// One "grace day" per rolling 7 days bridges a missed day, so a single slip doesn't reset the streak.

export const STEPS = ['verse', 'reading', 'prayer', 'reflect'];

export function dayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// Demo history so the streak UI has something to show on first launch.
export function seedRhythm(today = new Date()) {
  const r = {};
  [1, 2, 3, 5, 6, 8, 9, 10, 11, 12].forEach((n) => {
    r[dayKey(addDays(today, -n))] = n % 3 === 0 ? ['verse', 'reading'] : ['verse', 'reading', 'prayer'];
  });
  return r;
}

export function computeStreak(rhythm = {}, today = new Date()) {
  const has = (d) => (rhythm[dayKey(d)] || []).length > 0;
  let cursor = has(today) ? today : addDays(today, -1);
  let streak = 0;
  let lastGrace = null; // index (days back) where grace was used
  let graceUsedThisWeek = false;
  for (let i = 0; i < 400; i += 1) {
    if (has(cursor)) {
      streak += 1;
    } else {
      const canGrace = streak > 0 && (lastGrace === null || i - lastGrace >= 7) && has(addDays(cursor, -1));
      if (!canGrace) break;
      lastGrace = i;
      if (i < 7) graceUsedThisWeek = true;
    }
    cursor = addDays(cursor, -1);
  }
  return { streak, graceUsedThisWeek, doneToday: has(today) };
}

export function weekDays(today = new Date()) {
  // Monday-first week containing today
  const dow = (today.getDay() + 6) % 7;
  const monday = addDays(today, -dow);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}
