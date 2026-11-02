// Daily rhythm & streak calculation shared helper.
// Rules match src/data/rhythm.js:
// - A day counts toward the streak if at least one step was completed (cardinality(steps) > 0).
// - One "grace day" per rolling 7 days bridges a missed day.
// - Streak is computed dynamically, not stored as a static counter.
// - Best streak is recorded when current streak exceeds previous best.

import { q } from './db.js';
import { today } from './http.js';

export const ALLOWED_STEPS = ['verse', 'reading', 'prayer', 'reflect'];

export function parseDateUtc(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatUtc(d) {
  return d.toISOString().slice(0, 10);
}

export function addDaysUtc(d, n) {
  const res = new Date(d.getTime());
  res.setUTCDate(res.getUTCDate() + n);
  return res;
}

/**
 * Computes streak from a map or set of completed days.
 * @param {Record<string, string[]> | Set<string>} rhythm - mapping of 'YYYY-MM-DD' -> steps array or set of days
 * @param {string} todayDateStr - the user's local date 'YYYY-MM-DD'
 */
export function computeStreak(rhythm = {}, todayDateStr) {
  const todayDate = parseDateUtc(todayDateStr);
  const has = (d) => {
    const key = formatUtc(d);
    if (rhythm instanceof Set) return rhythm.has(key);
    const steps = rhythm[key];
    return Array.isArray(steps) ? steps.length > 0 : Boolean(steps);
  };

  let cursor = has(todayDate) ? todayDate : addDaysUtc(todayDate, -1);
  let streak = 0;
  let lastGrace = null; // index (days back) where grace was used
  let graceUsedThisWeek = false;

  for (let i = 0; i < 400; i += 1) {
    if (has(cursor)) {
      streak += 1;
    } else {
      const canGrace = streak > 0 && (lastGrace === null || i - lastGrace >= 7) && has(addDaysUtc(cursor, -1));
      if (!canGrace) break;
      lastGrace = i;
      if (i < 7) graceUsedThisWeek = true;
    }
    cursor = addDaysUtc(cursor, -1);
  }

  return { streak, graceUsedThisWeek, doneToday: has(todayDate) };
}

/**
 * Computes a user's current streak from the rhythm_days table,
 * updates best_streak in the users table if current > best_streak,
 * and returns { streak, bestStreak, graceUsedThisWeek, doneToday }.
 */
export async function getUserStreak(env, userId, userTzOffset = 0, currentBestStreak = 0) {
  const userToday = today(userTzOffset);
  const rows = await q(env, `
    SELECT to_char(day, 'YYYY-MM-DD') AS day, steps
    FROM rhythm_days
    WHERE user_id = $1 AND cardinality(steps) > 0
    ORDER BY day DESC
    LIMIT 400
  `, [userId]);

  const rhythm = {};
  for (const r of rows) {
    rhythm[r.day] = r.steps;
  }

  const { streak, graceUsedThisWeek, doneToday } = computeStreak(rhythm, userToday);
  let bestStreak = currentBestStreak || 0;
  if (streak > bestStreak) {
    bestStreak = streak;
    await q(env, `UPDATE users SET best_streak = $2 WHERE id = $1`, [userId, bestStreak]);
  }

  return { streak, bestStreak, graceUsedThisWeek, doneToday };
}
