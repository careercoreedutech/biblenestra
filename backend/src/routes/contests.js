// CONTEST CENTRE — Christian competitions: timed Bible quizzes (skill), creative entries (judged or
// popularity), free community voting, judges, results, coin prizes, certificates, Hall of Fame,
// leaderboards, organizers, sponsors and disputes. Paid entry and paid votes are NOT enabled: an entry
// fee can be stored and shown, but registration for a paid contest answers 402 PAYMENTS_NOT_ENABLED.
//
// The server holds quiz answers, times attempts, counts votes and works out every score and place,
// so a modified app can't fake a result. Prizes are paid in one database statement per contest.
import { Hono } from 'hono';
import { one, q } from '../lib/db.js';
import { bad, body, ApiError, forbidden, int, notFound, str, uuidParam, isUuid } from '../lib/http.js';
import { userJson, mediaUrl } from '../lib/shape.js';
import { sendNotification } from '../lib/push.js';
import { CONTEST_BANK } from '../lib/contestBank.js';
import { CONTEST_ADMIN_SCRIPT } from '../lib/contestAdminPage.js';
import { aiQuizQuestions } from '../lib/contestAi.js';
import { audit, requireAdmin, registerAdminScript } from './admin.js';

registerAdminScript(CONTEST_ADMIN_SCRIPT);

// Question pools for quizzes (by topic in the server bank)
export const CONTEST_CATEGORIES = {
  mixed: 'All of the Bible',
  gospels: 'Gospels & Jesus',
  old_testament: 'Old Testament',
  miracles: 'Miracles & Parables',
  prophets: 'Prophets & Kings',
  acts: 'Acts & Apostles',
  books: 'Books of the Bible',
  who: 'Who said it? (characters)',
  verses: 'Complete the verse (memory)',
  chronology: 'Bible timeline (order of events)',
};
const GRACE_SECONDS = 20;
const MAX_PRIZE_PLACES = 10;
const PLACE_BONUS = { 1: 100, 2: 60, 3: 40 };

const iso = (d) => (d ? new Date(d).toISOString() : null);
const ms = (d) => (d ? new Date(d).getTime() : null);
const limitSeconds = (row) => row.question_count * row.seconds_per_question;
const isAdmin = (me) => !!me && me.role === 'admin';
const canManage = (me, row) => isAdmin(me) || (!!me && !!row.organizer_id && row.organizer_id === me.id);
const originOf = (c) => new URL(c.req.url).origin;
const media = (c, key) => (!key ? null : /^https?:\/\//.test(key) ? key : mediaUrl(c.env, originOf(c), key));
const ctxOf = (c) => ({ env: c.env, executionCtx: (() => { try { return c.executionCtx; } catch (e) { return undefined; } })() });

// ---------- status ----------
export function statusOf(row, now = Date.now()) {
  if (row.cancelled) return 'cancelled';
  if (row.approval === 'pending') return 'pending_approval';
  if (row.approval === 'rejected') return 'rejected';
  if (row.settled_at || row.results_published_at) return 'completed';
  if (row.paused) return 'paused';
  const starts = ms(row.starts_at);
  const ends = ms(row.ends_at);
  if (now < starts) return row.registration_opens_at && now >= ms(row.registration_opens_at) ? 'registration_open' : 'upcoming';
  if (now < ends) return 'live';
  if (row.format === 'submission' && row.voting_enabled && row.voting_ends_at && now < ms(row.voting_ends_at)) return 'voting_open';
  return 'judging';
}
const registrationOpen = (row, now = Date.now()) => {
  const s = statusOf(row, now);
  if (s !== 'registration_open' && s !== 'live') return false;
  return !row.registration_closes_at || now < ms(row.registration_closes_at);
};

// ---------- shape ----------
function shape(c, row, me) {
  const status = statusOf(row);
  const out = {
    id: row.id,
    title: row.title,
    description: row.description,
    format: row.format,
    contestCategory: row.contest_category,
    contestCategoryLabel: row.category_label || row.contest_category,
    scoring: row.scoring,
    judgeWeight: row.judge_weight,
    votingEnabled: !!row.voting_enabled,
    allowSelfVote: !!row.allow_self_vote,
    bannerUrl: media(c, row.banner_url),
    rules: row.rules || '',
    eligibility: row.eligibility || '',
    submissionRequirements: row.submission_requirements || '',
    judgingCriteria: row.judging_criteria || '',
    entryKinds: row.entry_kinds || [],
    allowEdits: !!row.allow_edits,
    prizeText: row.prize_text,
    prizeCoins: row.prize_coins || [],
    prizePlaces: row.prize_places || [],
    category: row.category,
    categoryLabel: CONTEST_CATEGORIES[row.category] || 'Bible quiz',
    questionCount: row.question_count,
    secondsPerQuestion: row.seconds_per_question,
    limitSeconds: limitSeconds(row),
    registrationOpensAt: iso(row.registration_opens_at),
    registrationClosesAt: iso(row.registration_closes_at),
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    votingEndsAt: iso(row.voting_ends_at),
    resultsAt: iso(row.results_at),
    resultsPublishedAt: iso(row.results_published_at || row.settled_at),
    participantLimit: row.participant_limit,
    eligibleCountries: row.eligible_countries || [],
    entryFeeMinor: row.entry_fee_minor || 0,
    currency: row.currency || 'NGN',
    paymentsEnabled: false,
    teamMode: row.team_mode,
    certificatesFor: row.certificates_for,
    approval: row.approval,
    rejectReason: row.approval === 'rejected' ? row.reject_reason : undefined,
    organizerId: row.organizer_id,
    status,
    paused: !!row.paused,
    registrationOpen: registrationOpen(row),
    participants: Number(row.registrations || 0) + Number(row.unregistered_entries || 0),
    entries: row.entries === undefined ? undefined : Number(row.entries),
    submissions: row.submissions === undefined ? undefined : Number(row.submissions),
    canManage: canManage(me, row),
    isJudge: !!row.i_judge,
    myRegistration: row.my_registered_at ? { communityId: row.my_community_id, disqualified: !!row.my_disqualified } : null,
    mySubmissionId: row.my_submission_id || null,
    myVoteSubmissionId: row.my_vote || null,
    myCertificate: row.my_certificate || null,
    myEntry: row.my_started_at ? {
      finished: !!row.my_finished_at,
      correct: row.my_correct,
      total: row.my_total,
      durationMs: row.my_duration_ms,
      timedOut: !!row.my_timed_out,
      place: row.my_place,
      prizeCoins: row.my_prize_coins || 0,
      remainingSeconds: row.my_finished_at ? 0 : remainingSeconds(row.my_started_at, row),
    } : null,
  };
  return out;
}
const remainingSeconds = (startedAt, row) => Math.max(0, Math.ceil(limitSeconds(row) - (Date.now() - new Date(startedAt).getTime()) / 1000));

const SELECT = `SELECT c.*, cat.label AS category_label,
    (SELECT COUNT(*) FROM contest_entries e WHERE e.contest_id = c.id AND e.finished_at IS NOT NULL) AS entries,
    (SELECT COUNT(*) FROM contest_registrations r WHERE r.contest_id = c.id AND NOT r.disqualified) AS registrations,
    (SELECT COUNT(*) FROM contest_entries e WHERE e.contest_id = c.id
       AND NOT EXISTS (SELECT 1 FROM contest_registrations r WHERE r.contest_id = c.id AND r.user_id = e.user_id)) AS unregistered_entries,
    (SELECT COUNT(*) FROM contest_submissions s WHERE s.contest_id = c.id AND NOT s.disqualified) AS submissions,
    m.started_at AS my_started_at, m.finished_at AS my_finished_at, m.correct AS my_correct, m.total AS my_total,
    m.duration_ms AS my_duration_ms, m.timed_out AS my_timed_out, m.place AS my_place, m.prize_coins AS my_prize_coins,
    reg.created_at AS my_registered_at, reg.community_id AS my_community_id, reg.disqualified AS my_disqualified,
    sub.id AS my_submission_id,
    EXISTS (SELECT 1 FROM contest_judges j WHERE j.contest_id = c.id AND j.user_id = $1) AS i_judge,
    (SELECT v.submission_id FROM contest_votes v WHERE v.contest_id = c.id AND v.user_id = $1 AND v.valid LIMIT 1) AS my_vote,
    (SELECT cc.code FROM contest_certificates cc WHERE cc.contest_id = c.id AND cc.user_id = $1 AND NOT cc.revoked) AS my_certificate
  FROM contests c
  LEFT JOIN contest_categories cat ON cat.id = c.contest_category
  LEFT JOIN contest_entries m ON m.contest_id = c.id AND m.user_id = $1
  LEFT JOIN contest_registrations reg ON reg.contest_id = c.id AND reg.user_id = $1
  LEFT JOIN contest_submissions sub ON sub.contest_id = c.id AND sub.user_id = $1`;

async function load(c, id, { manage = false } = {}) {
  const me = c.get('user');
  const row = await one(c.env, `${SELECT} WHERE c.id = $2`, [me.id, id]);
  if (!row) throw notFound('Contest not found');
  const visible = !row.cancelled && row.approval === 'approved';
  if (!visible && !canManage(me, row)) throw notFound('Contest not found');
  if (manage && !canManage(me, row)) throw forbidden('Only the organizer or an admin can do this', 'NOT_ORGANIZER');
  return row;
}

// ---------- certificates ----------
const certCode = () => 'BN-' + Array.from(crypto.getRandomValues(new Uint8Array(8))).map((b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
async function issueCertificates(env, contest, rows) {
  // rows: [{ user_id, place }] in place order (place null = participant)
  const winners = Math.max(3, (contest.prize_coins || []).length, (contest.prize_places || []).length);
  let issued = 0;
  for (const r of rows) {
    let kind; let achievement;
    if (r.place && r.place <= winners) { kind = 'winner'; achievement = `${ordinal(r.place)} place`; }
    else if (r.place && r.place <= 10) { kind = 'finalist'; achievement = `Finalist (${ordinal(r.place)} place)`; }
    else if (contest.certificates_for === 'all') { kind = 'participant'; achievement = 'Participant'; }
    else continue;
    const ins = await q(env, `INSERT INTO contest_certificates (code, contest_id, user_id, kind, place, achievement) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (contest_id, user_id) DO NOTHING RETURNING id`, [certCode(), contest.id, r.user_id, kind, r.place || null, achievement]);
    issued += ins.length;
  }
  return issued;
}
const ordinal = (n) => { const t = n % 100; if (t >= 11 && t <= 13) return `${n}th`; return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`; };

async function notifyAll(env, contestId, userIds, title, bodyText, data = {}) {
  if (!userIds.length) return;
  await q(env, `INSERT INTO notifications (user_id, kind, title, body, data) SELECT u, 'contest', $2, $3, $4::jsonb FROM unnest($1::uuid[]) AS u`,
    [userIds, title, bodyText, JSON.stringify({ contestId, ...data })]);
}

// ---------- quiz results: paid once, in one statement ----------
export async function settle(ctx, contestId) {
  const env = ctx.env;
  const winners = await q(env, `WITH claim AS (
      UPDATE contests SET settled_at = now(), results_published_at = now(), updated_at = now()
      WHERE id = $1 AND format = 'quiz' AND settled_at IS NULL AND NOT cancelled AND approval = 'approved'
        AND ends_at + make_interval(secs => question_count * seconds_per_question + $2) < now()
      RETURNING id, title, prize_coins
    ), ranked AS (
      SELECT e.user_id, (row_number() OVER (ORDER BY e.correct DESC, e.duration_ms ASC, e.finished_at ASC))::int AS place
      FROM contest_entries e JOIN users u ON u.id = e.user_id, claim
      WHERE e.contest_id = claim.id AND e.finished_at IS NOT NULL AND e.correct > 0 AND NOT e.disqualified AND NOT u.banned
    ), prized AS (
      SELECT r.user_id, r.place, COALESCE(cl.prize_coins[r.place], 0) AS coins, cl.title, COALESCE(array_length(cl.prize_coins, 1), 0) AS places
      FROM ranked r, claim cl
    ), up_entries AS (
      UPDATE contest_entries e SET place = p.place, prize_coins = p.coins FROM prized p WHERE e.contest_id = $1 AND e.user_id = p.user_id
    ), up_users AS (
      UPDATE users u SET coins = u.coins + p.coins FROM prized p WHERE u.id = p.user_id AND p.coins > 0
    ), ledger AS (
      INSERT INTO coin_ledger (user_id, amount, reason, ref) SELECT user_id, coins, 'contest_prize', $1::text FROM prized WHERE coins > 0
    )
    SELECT user_id, place, coins, title, places FROM prized ORDER BY place`, [contestId, GRACE_SECONDS]);
  if (!winners.length) {
    const done = await one(env, 'SELECT id FROM contests WHERE id = $1 AND settled_at IS NOT NULL', [contestId]);
    if (!done) return [];
  }
  const contest = await one(env, 'SELECT * FROM contests WHERE id = $1', [contestId]);
  const others = await q(env, `SELECT user_id FROM contest_entries WHERE contest_id = $1 AND finished_at IS NOT NULL AND place IS NULL AND NOT disqualified`, [contestId]);
  await issueCertificates(env, contest, [...winners.map((w) => ({ user_id: w.user_id, place: w.place })), ...others.map((o) => ({ user_id: o.user_id, place: null }))]);
  for (const w of winners) {
    if (w.place > Math.max(3, w.places)) break;
    await sendNotification(ctx, {
      userId: w.user_id, kind: 'contest',
      title: `You placed #${w.place} in ${w.title}!`,
      body: w.coins > 0 ? `Well done! ${w.coins} coins have been added to your wallet, and your certificate is ready.` : 'Well done! Your certificate is ready.',
      data: { contestId, place: w.place, coins: w.coins },
    }).catch((e) => console.warn('[contest] winner notification failed', e && e.message));
  }
  return winners;
}

export async function settleDue(ctx) {
  const due = await q(ctx.env, `SELECT id FROM contests WHERE format = 'quiz' AND settled_at IS NULL AND NOT cancelled AND approval = 'approved'
      AND ends_at + make_interval(secs => question_count * seconds_per_question + $1) < now() LIMIT 5`, [GRACE_SECONDS]);
  for (const d of due) await settle(ctx, d.id);
}

// ---------- creative contest results ----------
export async function publishSubmissionResults(c, row) {
  const env = c.env;
  const claim = await one(env, `UPDATE contests SET results_published_at = now(), settled_at = now(), updated_at = now()
      WHERE id = $1 AND format = 'submission' AND results_published_at IS NULL AND NOT cancelled AND approval = 'approved'
        AND ends_at < now() AND (NOT voting_enabled OR voting_ends_at IS NULL OR voting_ends_at < now())
      RETURNING *`, [row.id]);
  if (!claim) throw new ApiError(409, 'NOT_READY', 'Results can be published once submissions (and voting) have closed, and only once');
  await q(env, `UPDATE contest_submissions s SET
      votes = (SELECT COUNT(*) FROM contest_votes v WHERE v.submission_id = s.id AND v.valid),
      judge_score = (SELECT AVG(score) FROM contest_judging_scores js WHERE js.submission_id = s.id)
    WHERE s.contest_id = $1`, [row.id]);
  const jw = Math.min(100, Math.max(0, claim.judge_weight)) / 100;
  await q(env, `WITH mx AS (SELECT GREATEST(MAX(votes), 1) AS m FROM contest_submissions WHERE contest_id = $1 AND NOT disqualified)
    UPDATE contest_submissions s SET final_score = CASE
        WHEN $2 = 'judged' THEN $3 * COALESCE(s.judge_score, 0) + (1 - $3) * (s.votes * 100.0 / mx.m)
        ELSE s.votes END
    FROM mx WHERE s.contest_id = $1`, [row.id, claim.scoring, jw]);
  const winners = await q(env, `WITH ranked AS (
      SELECT s.id, s.user_id, (row_number() OVER (ORDER BY s.final_score DESC, s.created_at ASC))::int AS place
      FROM contest_submissions s JOIN users u ON u.id = s.user_id
      WHERE s.contest_id = $1 AND NOT s.disqualified AND NOT u.banned
    ), prized AS (
      SELECT r.id, r.user_id, r.place, COALESCE(($2::int[])[r.place], 0) AS coins FROM ranked r
    ), up_sub AS (
      UPDATE contest_submissions s SET place = p.place, prize_coins = p.coins FROM prized p WHERE s.id = p.id
    ), up_users AS (
      UPDATE users u SET coins = u.coins + p.coins FROM prized p WHERE u.id = p.user_id AND p.coins > 0
    ), ledger AS (
      INSERT INTO coin_ledger (user_id, amount, reason, ref) SELECT user_id, coins, 'contest_prize', $1::text FROM prized WHERE coins > 0
    )
    SELECT user_id, place, coins FROM prized ORDER BY place`, [row.id, claim.prize_coins || []]);
  const certs = await issueCertificates(env, claim, winners.map((w) => ({ user_id: w.user_id, place: w.place })));
  const places = Math.max(3, (claim.prize_coins || []).length);
  for (const w of winners) {
    if (w.place > places) break;
    await sendNotification(c, {
      userId: w.user_id, kind: 'contest',
      title: `You placed #${w.place} in ${claim.title}!`,
      body: w.coins > 0 ? `Well done! ${w.coins} coins have been added to your wallet, and your certificate is ready.` : 'Well done! Your certificate is ready.',
      data: { contestId: row.id, place: w.place, coins: w.coins },
    }).catch(() => {});
  }
  const everyone = await q(env, 'SELECT user_id FROM contest_registrations WHERE contest_id = $1', [row.id]);
  const told = new Set(winners.slice(0, places).map((w) => w.user_id));
  await notifyAll(env, row.id, everyone.map((r) => r.user_id).filter((u) => !told.has(u)), `Results are out: ${claim.title}`, 'See the winners and the final standings.');
  return { winners, certificates: certs };
}

// ---------- leaderboards ----------
async function contestLeaderboard(c, row, meId, limit = 50) {
  if (row.format === 'quiz') {
    const rows = await q(c.env, `SELECT * FROM (
        SELECT ${userJson('u')} AS u, e.user_id, e.correct, e.total, e.duration_ms, e.prize_coins, u.country,
          (row_number() OVER (ORDER BY e.correct DESC, e.duration_ms ASC, e.finished_at ASC))::int AS place
        FROM contest_entries e JOIN users u ON u.id = e.user_id
        WHERE e.contest_id = $1 AND e.finished_at IS NOT NULL AND e.correct > 0 AND NOT e.disqualified AND NOT u.banned
      ) t WHERE t.place <= $2 OR t.user_id = $3 ORDER BY t.place`, [row.id, limit, meId || null]);
    return rows.map((r) => ({ place: r.place, user: r.u, country: r.country, correct: r.correct, total: r.total, durationMs: r.duration_ms, prizeCoins: r.prize_coins || 0, isMe: r.user_id === meId }));
  }
  const published = !!row.results_published_at;
  const rows = await q(c.env, `SELECT * FROM (
      SELECT ${userJson('u')} AS u, s.id, s.user_id, s.title, s.kind, s.votes, s.final_score, s.prize_coins, u.country,
        COALESCE(s.place, (row_number() OVER (ORDER BY s.votes DESC, s.created_at ASC))::int) AS place
      FROM contest_submissions s JOIN users u ON u.id = s.user_id
      WHERE s.contest_id = $1 AND NOT s.disqualified AND NOT u.banned
    ) t WHERE t.place <= $2 OR t.user_id = $3 ORDER BY t.place`, [row.id, limit, meId || null]);
  return rows.map((r) => ({ place: r.place, user: r.u, country: r.country, submissionId: r.id, title: r.title, kind: r.kind, votes: r.votes,
    score: published && r.final_score !== null ? Math.round(r.final_score * 10) / 10 : null, prizeCoins: r.prize_coins || 0, isMe: r.user_id === meId }));
}

// Church vs Church: each church's total from its best 5 members
async function churchLeaderboard(c, row) {
  const scoreExpr = row.format === 'quiz' ? 'e.correct' : 'COALESCE(s.final_score, s.votes)';
  const from = row.format === 'quiz'
    ? `contest_entries e JOIN contest_registrations r ON r.contest_id = e.contest_id AND r.user_id = e.user_id WHERE e.contest_id = $1 AND e.finished_at IS NOT NULL AND NOT e.disqualified`
    : `contest_submissions s JOIN contest_registrations r ON r.contest_id = s.contest_id AND r.user_id = s.user_id WHERE s.contest_id = $1 AND NOT s.disqualified`;
  const rows = await q(c.env, `WITH scored AS (
      SELECT r.community_id, ${scoreExpr} AS score, row_number() OVER (PARTITION BY r.community_id ORDER BY ${scoreExpr} DESC) AS rk
      FROM ${from} AND r.community_id IS NOT NULL
    )
    SELECT co.id, co.name, co.verified, SUM(sc.score)::real AS points, COUNT(*)::int AS members
    FROM scored sc JOIN communities co ON co.id = sc.community_id
    WHERE sc.rk <= 5 GROUP BY co.id, co.name, co.verified ORDER BY points DESC LIMIT 50`, [row.id]);
  return rows.map((r, i) => ({ place: i + 1, communityId: r.id, name: r.name, verified: !!r.verified, points: Math.round(r.points * 10) / 10, members: r.members }));
}

function shuffled(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const countryOk = (row, me) => {
  const list = (row.eligible_countries || []).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  if (!list.length) return true;
  return !!me.country && list.includes(String(me.country).trim().toLowerCase());
};

async function register(c, row, b = {}) {
  const me = c.get('user');
  const existing = await one(c.env, 'SELECT * FROM contest_registrations WHERE contest_id = $1 AND user_id = $2', [row.id, me.id]);
  if (existing) {
    if (existing.disqualified) throw forbidden('You have been disqualified from this contest', 'DISQUALIFIED');
    return existing;
  }
  if (!registrationOpen(row)) throw new ApiError(409, 'REGISTRATION_CLOSED', statusOf(row) === 'upcoming' ? 'Registration hasn’t opened yet' : 'Registration is closed');
  if ((row.entry_fee_minor || 0) > 0) throw new ApiError(402, 'PAYMENTS_NOT_ENABLED', 'Paid entry opens soon. Registration for this contest isn’t available yet.');
  if (!countryOk(row, me)) throw forbidden('This contest isn’t open in your country. Check the country on your profile.', 'NOT_ELIGIBLE');
  if (row.participant_limit) {
    const n = await one(c.env, 'SELECT COUNT(*)::int AS n FROM contest_registrations WHERE contest_id = $1', [row.id]);
    if (n.n >= row.participant_limit) throw new ApiError(409, 'CONTEST_FULL', 'This contest is full');
  }
  let communityId = null;
  if (row.team_mode === 'church') {
    communityId = b.communityId;
    if (!isUuid(communityId)) throw bad('Choose the church you are competing for', 'CHURCH_REQUIRED');
    const member = await one(c.env, `SELECT co.verified FROM community_members m JOIN communities co ON co.id = m.community_id WHERE m.community_id = $1 AND m.user_id = $2 AND m.status = 'member'`, [communityId, me.id]);
    if (!member) throw forbidden('Join that church community first', 'NOT_A_MEMBER');
  }
  const reg = await one(c.env, `INSERT INTO contest_registrations (contest_id, user_id, community_id) VALUES ($1,$2,$3)
      ON CONFLICT (contest_id, user_id) DO UPDATE SET community_id = COALESCE(contest_registrations.community_id, EXCLUDED.community_id) RETURNING *`,
    [row.id, me.id, communityId]);
  await notifyAll(c.env, row.id, [me.id], `You’re registered: ${row.title}`, row.format === 'quiz' ? 'Good luck! You can play while the contest is live.' : 'Good luck! Submit your entry before the deadline.');
  return reg;
}

// ---------- media ownership for entries ----------
async function checkMedia(c, kind, key, meId) {
  if (!key) return null;
  const k = String(key);
  const prefix = { image: 'img', video: 'vid', audio: 'aud' }[kind];
  if (!prefix || !new RegExp(`^${prefix}/${meId}/[\\w.-]+$`).test(k)) throw bad('Upload the file first, then attach it', 'BAD_MEDIA');
  if (kind === 'video') {
    const v = await one(c.env, `SELECT 1 FROM video_uploads WHERE user_id = $1 AND video_key = $2 AND status = 'ready'`, [meId, k]);
    if (!v) throw bad('That video hasn’t finished uploading', 'BAD_MEDIA');
  }
  return k;
}

function submissionShape(c, s, meId, showVotes = true) {
  return {
    id: s.id,
    contestId: s.contest_id,
    user: s.u || undefined,
    kind: s.kind,
    title: s.title,
    description: s.description,
    body: s.body,
    mediaUrl: media(c, s.media_key),
    thumbnailUrl: media(c, s.thumb_key),
    votes: showVotes ? s.votes : undefined,
    place: s.place,
    score: s.final_score !== null && s.final_score !== undefined ? Math.round(s.final_score * 10) / 10 : null,
    prizeCoins: s.prize_coins || 0,
    disqualified: !!s.disqualified,
    mine: s.user_id === meId,
    createdAt: iso(s.created_at),
    updatedAt: iso(s.updated_at),
  };
}
const galleryOpen = (row) => ['voting_open', 'judging', 'completed'].includes(statusOf(row));

// ======================================================================
// Player routes
// ======================================================================
export const contests = new Hono();

contests.get('/contests/categories', async (c) => {
  const rows = await q(c.env, 'SELECT * FROM contest_categories WHERE active ORDER BY position');
  return c.json({ items: rows.map((r) => ({ id: r.id, label: r.label, description: r.description, format: r.format, scoring: r.scoring, kinds: r.kinds })), topics: CONTEST_CATEGORIES });
});

contests.get('/contests', async (c) => {
  await settleDue(ctxOf(c));
  const me = c.get('user');
  const rows = await q(c.env, `${SELECT} WHERE NOT c.cancelled AND c.approval = 'approved' ORDER BY c.ends_at DESC LIMIT 100`, [me.id]);
  let items = rows.map((r) => shape(c, r, me));
  const f = c.req.query();
  if (f.category) items = items.filter((x) => x.contestCategory === f.category);
  if (f.status) items = items.filter((x) => x.status === f.status);
  if (f.free === '1') items = items.filter((x) => !x.entryFeeMinor);
  if (f.paid === '1') items = items.filter((x) => x.entryFeeMinor > 0);
  if (f.country) items = items.filter((x) => !x.eligibleCountries.length || x.eligibleCountries.map((y) => y.toLowerCase()).includes(String(f.country).toLowerCase()));
  if (f.sort === 'closing') items = items.filter((x) => ['live', 'registration_open', 'voting_open'].includes(x.status)).sort((a, b) => ms(a.endsAt) - ms(b.endsAt));
  if (f.sort === 'popular') items.sort((a, b) => b.participants - a.participants);
  if (f.sort === 'prize') items.sort((a, b) => (b.prizeCoins[0] || 0) - (a.prizeCoins[0] || 0));
  return c.json({ items });
});

contests.get('/contests/mine', async (c) => {
  await settleDue(ctxOf(c));
  const me = c.get('user');
  const rows = await q(c.env, `${SELECT} WHERE (m.started_at IS NOT NULL OR reg.created_at IS NOT NULL OR sub.id IS NOT NULL
      OR EXISTS (SELECT 1 FROM contest_judges j WHERE j.contest_id = c.id AND j.user_id = $1) OR c.organizer_id = $1)
      AND (NOT c.cancelled OR c.organizer_id = $1) ORDER BY c.ends_at DESC LIMIT 100`, [me.id]);
  return c.json({ items: rows.map((r) => shape(c, r, me)) });
});

// Hall of Fame: past winners
contests.get('/contests/hall-of-fame', async (c) => {
  const rows = await q(c.env, `SELECT c.id, c.title, c.format, c.contest_category, cat.label, COALESCE(c.results_published_at, c.settled_at) AS done_at,
      COALESCE(
        (SELECT json_agg(x ORDER BY x.place) FROM (
          SELECT e.place, ${userJson('u')} AS u, NULL::text AS title, NULL::text AS kind, NULL::uuid AS submission_id
          FROM contest_entries e JOIN users u ON u.id = e.user_id WHERE e.contest_id = c.id AND e.place BETWEEN 1 AND 3
          UNION ALL
          SELECT s.place, ${userJson('u')}, s.title, s.kind, s.id FROM contest_submissions s JOIN users u ON u.id = s.user_id
          WHERE s.contest_id = c.id AND s.place BETWEEN 1 AND 3 AND NOT s.disqualified) x), '[]'::json) AS winners
    FROM contests c LEFT JOIN contest_categories cat ON cat.id = c.contest_category
    WHERE COALESCE(c.results_published_at, c.settled_at) IS NOT NULL AND NOT c.cancelled
    ORDER BY done_at DESC LIMIT 50`);
  return c.json({ items: rows.map((r) => ({ id: r.id, title: r.title, format: r.format, categoryLabel: r.label || r.contest_category, completedAt: iso(r.done_at),
    winners: (typeof r.winners === 'string' ? JSON.parse(r.winners) : r.winners).map((w) => ({ place: w.place, user: w.u, title: w.title, kind: w.kind, submissionId: w.submission_id })) })) });
});

// Global / weekly / monthly leaderboards, for people or churches, optionally by country
contests.get('/leaderboards', async (c) => {
  const me = c.get('user');
  const period = c.req.query('period') || 'all';
  const by = c.req.query('by') === 'church' ? 'church' : 'people';
  const country = String(c.req.query('country') || '').trim();
  const since = period === 'week' ? 'now() - interval \'7 days\'' : period === 'month' ? 'now() - interval \'30 days\'' : '\'-infinity\'::timestamptz';
  const pts = `WITH pts AS (
      SELECT e.user_id, e.correct * 10 + COALESCE((ARRAY[100,60,40])[e.place], 0) AS p, c.settled_at AS at
      FROM contest_entries e JOIN contests c ON c.id = e.contest_id
      WHERE c.settled_at IS NOT NULL AND e.finished_at IS NOT NULL AND NOT e.disqualified AND NOT e.timed_out
      UNION ALL
      SELECT s.user_id, 20 + COALESCE((ARRAY[100,60,40])[s.place], 0), c.results_published_at
      FROM contest_submissions s JOIN contests c ON c.id = s.contest_id
      WHERE c.results_published_at IS NOT NULL AND NOT s.disqualified
      UNION ALL
      SELECT b.winner, 15, b.created_at FROM battles b WHERE b.status = 'finished' AND b.winner IS NOT NULL
    )`;
  if (by === 'church') {
    const rows = await q(c.env, `${pts}
      SELECT u.church AS name, SUM(p.p)::int AS points, COUNT(DISTINCT u.id)::int AS members
      FROM pts p JOIN users u ON u.id = p.user_id
      WHERE p.at >= ${since} AND NOT u.banned AND COALESCE(u.church, '') <> '' AND ($1 = '' OR u.country ILIKE $1)
      GROUP BY u.church ORDER BY points DESC LIMIT 50`, [country]);
    return c.json({ items: rows.map((r, i) => ({ place: i + 1, name: r.name, points: r.points, members: r.members })) });
  }
  const rows = await q(c.env, `${pts}
    SELECT ${userJson('u')} AS u, u.id, u.country, SUM(p.p)::int AS points
    FROM pts p JOIN users u ON u.id = p.user_id
    WHERE p.at >= ${since} AND NOT u.banned AND ($1 = '' OR u.country ILIKE $1)
    GROUP BY u.id ORDER BY points DESC LIMIT 50`, [country]);
  return c.json({ items: rows.map((r, i) => ({ place: i + 1, user: r.u, country: r.country, points: r.points, isMe: r.id === me.id })) });
});

contests.get('/me/certificates', async (c) => {
  const me = c.get('user');
  const rows = await q(c.env, `SELECT cc.*, c.title FROM contest_certificates cc JOIN contests c ON c.id = cc.contest_id
      WHERE cc.user_id = $1 AND NOT cc.revoked ORDER BY cc.issued_at DESC`, [me.id]);
  return c.json({ items: rows.map((r) => ({ code: r.code, contestId: r.contest_id, contestTitle: r.title, kind: r.kind, place: r.place, achievement: r.achievement, issuedAt: iso(r.issued_at) })) });
});

// Judges: what's waiting for me
contests.get('/judging', async (c) => {
  const me = c.get('user');
  const rows = await q(c.env, `${SELECT} WHERE EXISTS (SELECT 1 FROM contest_judges j WHERE j.contest_id = c.id AND j.user_id = $1) AND NOT c.cancelled ORDER BY c.ends_at DESC`, [me.id]);
  return c.json({ items: rows.map((r) => shape(c, r, me)) });
});

// Organizers: contests I run (admins: all)
contests.get('/organizer/contests', async (c) => {
  const me = c.get('user');
  if (!isAdmin(me) && !me.can_organize) throw forbidden('Ask an admin for organizer access', 'NOT_ORGANIZER');
  const rows = await q(c.env, `${SELECT} WHERE ($2 OR c.organizer_id = $1) ORDER BY c.created_at DESC LIMIT 100`, [me.id, isAdmin(me)]);
  return c.json({ items: rows.map((r) => shape(c, r, me)), canOrganize: true });
});

// AI quiz generator (organizers/admins): drafts to review, never published automatically
contests.post('/contests/ai-questions', async (c) => {
  const me = c.get('user');
  if (!isAdmin(me) && !me.can_organize) throw forbidden('Only organizers can generate questions', 'NOT_ORGANIZER');
  const b = await body(c);
  const book = str(b.book, { min: 2, max: 40, field: 'Bible book' });
  const difficulty = ['easy', 'medium', 'hard'].includes(b.difficulty) ? b.difficulty : 'medium';
  const type = ['multiple_choice', 'true_false', 'fill_gap'].includes(b.type) ? b.type : 'multiple_choice';
  const count = int(b.count === undefined ? 5 : b.count, { min: 1, max: 15, field: 'Number of questions' });
  return c.json(await aiQuizQuestions(c.env, { book, difficulty, type, count }));
});

contests.post('/contests', async (c) => {
  const me = c.get('user');
  if (!isAdmin(me) && !me.can_organize) throw forbidden('Ask an admin for organizer access to create contests', 'NOT_ORGANIZER');
  const row = await createContest(c, await body(c), { asAdmin: isAdmin(me) });
  return c.json(shape(c, { ...row, registrations: 0, entries: 0, submissions: 0 }, me), 201);
});

contests.get('/contests/:id', async (c) => {
  const id = uuidParam(c);
  await settle(ctxOf(c), id);
  const me = c.get('user');
  const row = await load(c, id);
  const sponsors = await q(c.env, 'SELECT * FROM contest_sponsors WHERE contest_id = $1 AND (approved OR $2) ORDER BY created_at', [id, canManage(me, row)]);
  const org = row.organizer_id ? await one(c.env, `SELECT ${userJson('u')} AS u FROM users u WHERE u.id = $1`, [row.organizer_id]) : null;
  return c.json({ ...shape(c, row, me), organizer: org ? org.u : null,
    sponsors: sponsors.map((s) => ({ id: s.id, name: s.name, linkUrl: s.link_url, contribution: s.contribution, approved: !!s.approved })) });
});

contests.get('/contests/:id/leaderboard', async (c) => {
  const id = uuidParam(c);
  const row = await load(c, id);
  if (c.req.query('by') === 'church') return c.json({ items: await churchLeaderboard(c, row) });
  return c.json({ items: await contestLeaderboard(c, row, c.get('user').id) });
});

contests.post('/contests/:id/register', async (c) => {
  const row = await load(c, uuidParam(c));
  const reg = await register(c, row, await body(c).catch(() => ({})));
  return c.json({ registered: true, communityId: reg.community_id });
});

// ---------- quiz play ----------
contests.post('/contests/:id/start', async (c) => {
  const id = uuidParam(c);
  const me = c.get('user');
  const row = await load(c, id);
  if (row.format !== 'quiz') throw bad('This contest takes entries, not quiz answers');
  if (row.my_finished_at) throw new ApiError(409, 'ALREADY_ENTERED', 'You have already played this contest');
  if (!row.my_started_at) {
    if (statusOf(row) !== 'live') throw new ApiError(409, 'CONTEST_NOT_LIVE', ['upcoming', 'registration_open'].includes(statusOf(row)) ? 'This contest hasn’t started yet' : 'This contest has closed');
    if (row.team_mode === 'church' && !row.my_registered_at) throw new ApiError(409, 'CHURCH_REQUIRED', 'Register with your church first');
    await register(c, row, {});
  }
  const picks = shuffled(row.questions).slice(0, row.question_count).map((x) => x.id);
  await q(c.env, `INSERT INTO contest_entries (contest_id, user_id, question_ids, total) VALUES ($1, $2, $3, $4)
      ON CONFLICT (contest_id, user_id) DO NOTHING`, [id, me.id, picks, picks.length]);
  const entry = await one(c.env, 'SELECT question_ids, started_at FROM contest_entries WHERE contest_id = $1 AND user_id = $2', [id, me.id]);
  const byId = new Map(row.questions.map((x) => [x.id, x]));
  return c.json({
    remainingSeconds: remainingSeconds(entry.started_at, row),
    limitSeconds: limitSeconds(row),
    questions: entry.question_ids.map((qid) => byId.get(qid)).filter(Boolean).map((x) => ({ id: x.id, question: x.q, options: x.o })),
  });
});

contests.post('/contests/:id/submit', async (c) => {
  const id = uuidParam(c);
  const me = c.get('user');
  const row = await load(c, id);
  const entry = await one(c.env, 'SELECT * FROM contest_entries WHERE contest_id = $1 AND user_id = $2', [id, me.id]);
  if (!entry) throw new ApiError(409, 'NOT_STARTED', 'Start the contest first');
  const b = await body(c);
  const given = b.answers && typeof b.answers === 'object' && !Array.isArray(b.answers) ? b.answers : {};
  const byId = new Map(row.questions.map((x) => [x.id, x]));
  const answers = {};
  let correct = 0;
  for (const qid of entry.question_ids) {
    const v = given[qid];
    if (!Number.isInteger(v)) continue;
    answers[qid] = v;
    if (byId.get(qid) && byId.get(qid).a === v) correct += 1;
  }
  const limitMs = limitSeconds(row) * 1000;
  const elapsed = Date.now() - new Date(entry.started_at).getTime();
  const timedOut = elapsed > limitMs + GRACE_SECONDS * 1000;
  if (timedOut) correct = 0;
  await q(c.env, `UPDATE contest_entries SET finished_at = now(), answers = $3::jsonb, correct = $4, duration_ms = $5, timed_out = $6
      WHERE contest_id = $1 AND user_id = $2 AND finished_at IS NULL`,
    [id, me.id, JSON.stringify(answers), correct, Math.min(elapsed, limitMs), timedOut]);
  const result = await one(c.env, `SELECT t.* FROM (
      SELECT e.user_id, e.correct, e.total, e.duration_ms, e.timed_out,
        (row_number() OVER (ORDER BY e.correct DESC, e.duration_ms ASC, e.finished_at ASC))::int AS place
      FROM contest_entries e WHERE e.contest_id = $1 AND e.finished_at IS NOT NULL AND NOT e.disqualified) t WHERE t.user_id = $2`, [id, me.id]);
  return c.json({ correct: result.correct, total: result.total, durationMs: result.duration_ms, timedOut: result.timed_out, place: result.correct > 0 ? result.place : null });
});

contests.get('/contests/:id/review', async (c) => {
  const id = uuidParam(c);
  const row = await load(c, id);
  if (statusOf(row) !== 'completed') throw new ApiError(409, 'CONTEST_NOT_ENDED', 'Answers are shown when the contest ends');
  const entry = await one(c.env, 'SELECT question_ids, answers FROM contest_entries WHERE contest_id = $1 AND user_id = $2 AND finished_at IS NOT NULL', [id, c.get('user').id]);
  if (!entry) throw notFound('You didn’t play this contest');
  const byId = new Map(row.questions.map((x) => [x.id, x]));
  return c.json({
    items: entry.question_ids.map((qid) => byId.get(qid)).filter(Boolean).map((x) => ({
      id: x.id, question: x.q, options: x.o, correctIndex: x.a, reference: x.r,
      myAnswer: entry.answers && Number.isInteger(entry.answers[x.id]) ? entry.answers[x.id] : null,
    })),
  });
});

// ---------- creative entries ----------
contests.get('/contests/:id/submissions', async (c) => {
  const id = uuidParam(c);
  const me = c.get('user');
  const row = await load(c, id);
  const all = galleryOpen(row) || canManage(me, row) || !!row.i_judge;
  const rows = await q(c.env, `SELECT s.*, ${userJson('u')} AS u FROM contest_submissions s JOIN users u ON u.id = s.user_id
      WHERE s.contest_id = $1 AND ($2 OR s.user_id = $3) AND (NOT s.disqualified OR $4) AND NOT u.banned
      ORDER BY ${statusOf(row) === 'completed' ? 's.place NULLS LAST' : 's.votes DESC'}, s.created_at`, [id, all, me.id, canManage(me, row)]);
  return c.json({ items: rows.map((s) => submissionShape(c, s, me.id, row.voting_enabled)), galleryOpen: all });
});

contests.get('/submissions/:id', async (c) => {
  const me = c.get('user');
  const s = await one(c.env, `SELECT s.*, ${userJson('u')} AS u, u.country FROM contest_submissions s JOIN users u ON u.id = s.user_id WHERE s.id = $1`, [uuidParam(c)]);
  if (!s) throw notFound('Entry not found');
  const row = await load(c, s.contest_id);
  if (s.user_id !== me.id && !galleryOpen(row) && !canManage(me, row) && !row.i_judge) throw notFound('Entry not found');
  if (s.disqualified && s.user_id !== me.id && !canManage(me, row)) throw notFound('Entry not found');
  const rank = row.voting_enabled ? await one(c.env, `SELECT COUNT(*)::int + 1 AS rank FROM contest_submissions WHERE contest_id = $1 AND NOT disqualified AND votes > $2`, [s.contest_id, s.votes]) : null;
  return c.json({ ...submissionShape(c, s, me.id, row.voting_enabled), country: s.country, rank: rank ? rank.rank : null,
    contest: { id: row.id, title: row.title, status: statusOf(row), votingEnabled: !!row.voting_enabled, allowSelfVote: !!row.allow_self_vote, myVoteSubmissionId: row.my_vote || null } });
});

contests.put('/contests/:id/submission', async (c) => {
  const id = uuidParam(c);
  const me = c.get('user');
  const row = await load(c, id);
  if (row.format !== 'submission') throw bad('This contest is a quiz');
  if (statusOf(row) !== 'live') throw new ApiError(409, 'SUBMISSIONS_CLOSED', statusOf(row) === 'upcoming' || statusOf(row) === 'registration_open' ? 'Submissions open when the contest starts' : 'Submissions are closed');
  if (!row.my_registered_at) {
    if (row.team_mode === 'church') throw new ApiError(409, 'CHURCH_REQUIRED', 'Register with your church first');
    await register(c, row, {});
  } else if (row.my_disqualified) throw forbidden('You have been disqualified from this contest', 'DISQUALIFIED');
  const existing = await one(c.env, 'SELECT * FROM contest_submissions WHERE contest_id = $1 AND user_id = $2', [id, me.id]);
  if (existing && !row.allow_edits) throw new ApiError(409, 'EDITS_NOT_ALLOWED', 'This contest doesn’t allow changes after you submit');
  const b = await body(c);
  const kinds = row.entry_kinds && row.entry_kinds.length ? row.entry_kinds : ['image', 'video', 'audio', 'text'];
  const kind = String(b.kind || '');
  if (!kinds.includes(kind)) throw bad(`This contest takes: ${kinds.join(', ')}`, 'BAD_KIND');
  const title = str(b.title, { min: 1, max: 120, field: 'Title' });
  const description = str(b.description || '', { max: 2000, field: 'Description' });
  const text = str(b.body || '', { max: 20000, field: 'Text' });
  let mediaKey = null; let thumbKey = null;
  if (kind === 'text') { if (text.length < 20) throw bad('Write at least a few sentences', 'TOO_SHORT'); }
  else if (kind === 'video' && b.videoUid) {
    // videos are uploaded through /uploads/video; the entry refers to it by its upload id
    const v = await one(c.env, `SELECT video_key, thumb_key FROM video_uploads WHERE uid = $1 AND user_id = $2 AND status = 'ready'`, [String(b.videoUid), me.id]);
    if (!v || !v.video_key) throw bad('That video hasn’t finished uploading', 'BAD_MEDIA');
    mediaKey = v.video_key; thumbKey = v.thumb_key || null;
  } else {
    mediaKey = await checkMedia(c, kind, b.mediaKey, me.id);
    if (!mediaKey) throw bad('Attach your file', 'MEDIA_REQUIRED');
    if (b.thumbKey) {
      if (!new RegExp(`^(img|vid)/${me.id}/[\\w.-]+$`).test(String(b.thumbKey))) throw bad('Bad thumbnail', 'BAD_MEDIA');
      thumbKey = String(b.thumbKey);
    }
  }
  const s = await one(c.env, `INSERT INTO contest_submissions (contest_id, user_id, kind, title, description, body, media_key, thumb_key)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (contest_id, user_id) DO UPDATE SET kind = EXCLUDED.kind, title = EXCLUDED.title, description = EXCLUDED.description,
        body = EXCLUDED.body, media_key = EXCLUDED.media_key, thumb_key = EXCLUDED.thumb_key, updated_at = now()
      RETURNING *`, [id, me.id, kind, title, description, text, mediaKey, thumbKey]);
  return c.json(submissionShape(c, s, me.id), existing ? 200 : 201);
});

contests.delete('/contests/:id/submission', async (c) => {
  const id = uuidParam(c);
  const row = await load(c, id);
  if (statusOf(row) !== 'live') throw new ApiError(409, 'SUBMISSIONS_CLOSED', 'Submissions are locked');
  await q(c.env, 'DELETE FROM contest_submissions WHERE contest_id = $1 AND user_id = $2', [id, c.get('user').id]);
  return c.json({ ok: true });
});

// ---------- free community voting: one vote per person per contest ----------
contests.post('/contests/:id/vote', async (c) => {
  const id = uuidParam(c);
  const me = c.get('user');
  const row = await load(c, id);
  if (!row.voting_enabled) throw bad('This contest has no community voting');
  if (statusOf(row) !== 'voting_open') throw new ApiError(409, 'VOTING_CLOSED', 'Voting is not open');
  const b = await body(c);
  if (!isUuid(b.submissionId)) throw bad('Choose an entry');
  const s = await one(c.env, 'SELECT * FROM contest_submissions WHERE id = $1 AND contest_id = $2 AND NOT disqualified', [b.submissionId, id]);
  if (!s) throw notFound('Entry not found');
  if (s.user_id === me.id && !row.allow_self_vote) throw forbidden('You can’t vote for your own entry in this contest', 'NO_SELF_VOTE');
  const prior = await one(c.env, 'SELECT submission_id FROM contest_votes WHERE contest_id = $1 AND user_id = $2 AND valid', [id, me.id]);
  if (prior) {
    if (prior.submission_id === s.id) return c.json({ voted: true, submissionId: s.id, votes: s.votes });
    throw new ApiError(409, 'ALREADY_VOTED', 'You have already used your vote in this contest');
  }
  // one statement: record the vote and count it (the unique index stops a second vote)
  const r = await one(c.env, `WITH v AS (
      INSERT INTO contest_votes (contest_id, submission_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id
    ) UPDATE contest_submissions SET votes = votes + 1 WHERE id = $2 AND EXISTS (SELECT 1 FROM v) RETURNING votes`, [id, s.id, me.id]);
  if (!r) throw new ApiError(409, 'ALREADY_VOTED', 'You have already used your vote in this contest');
  // the entrant hears about votes at most once every 6 hours per contest
  const recent = await one(c.env, `SELECT 1 FROM notifications WHERE user_id = $1 AND kind = 'contest' AND data->>'contestId' = $2 AND data->>'type' = 'vote' AND created_at > now() - interval '6 hours'`, [s.user_id, id]);
  if (!recent && s.user_id !== me.id) await notifyAll(c.env, id, [s.user_id], `New votes for “${s.title}”`, `Your entry in ${row.title} has ${r.votes} ${r.votes === 1 ? 'vote' : 'votes'}.`, { type: 'vote', submissionId: s.id });
  return c.json({ voted: true, submissionId: s.id, votes: r.votes });
});

// ---------- judges ----------
contests.post('/contests/:id/scores/:submissionId', async (c) => {
  const id = uuidParam(c);
  const me = c.get('user');
  const row = await load(c, id);
  if (!row.i_judge) throw forbidden('You are not a judge for this contest', 'NOT_JUDGE');
  if (!['voting_open', 'judging'].includes(statusOf(row))) throw new ApiError(409, 'JUDGING_CLOSED', 'Judging opens after the submission deadline and closes when results are published');
  const sid = uuidParam(c, 'submissionId');
  const s = await one(c.env, 'SELECT id FROM contest_submissions WHERE id = $1 AND contest_id = $2', [sid, id]);
  if (!s) throw notFound('Entry not found');
  const b = await body(c);
  const score = int(b.score, { min: 0, max: 100, field: 'Score' });
  const comment = str(b.comment || '', { max: 1000, field: 'Comment' });
  await q(c.env, `INSERT INTO contest_judging_scores (submission_id, judge_id, score, comment) VALUES ($1,$2,$3,$4)
      ON CONFLICT (submission_id, judge_id) DO UPDATE SET score = EXCLUDED.score, comment = EXCLUDED.comment, updated_at = now()`, [sid, me.id, score, comment]);
  return c.json({ ok: true, score });
});

contests.get('/contests/:id/my-scores', async (c) => {
  const id = uuidParam(c);
  const me = c.get('user');
  const row = await load(c, id);
  if (!row.i_judge && !canManage(me, row)) throw forbidden('Judges only', 'NOT_JUDGE');
  const rows = await q(c.env, `SELECT js.submission_id, js.score, js.comment FROM contest_judging_scores js JOIN contest_submissions s ON s.id = js.submission_id
      WHERE s.contest_id = $1 AND js.judge_id = $2`, [id, me.id]);
  return c.json({ items: rows.map((r) => ({ submissionId: r.submission_id, score: r.score, comment: r.comment })) });
});

// ---------- disputes ----------
contests.post('/contests/:id/disputes', async (c) => {
  const id = uuidParam(c);
  await load(c, id);
  const b = await body(c);
  const reason = str(b.reason, { min: 5, max: 1000, field: 'Reason' });
  const sid = isUuid(b.submissionId) ? b.submissionId : null;
  const d = await one(c.env, 'INSERT INTO contest_disputes (contest_id, user_id, submission_id, reason) VALUES ($1,$2,$3,$4) RETURNING id', [id, c.get('user').id, sid, reason]);
  return c.json({ id: d.id, status: 'open' }, 201);
});

// ======================================================================
// Organizer routes (the organizer of a contest, or any admin)
// ======================================================================
contests.get('/contests/:id/manage', async (c) => {
  const id = uuidParam(c);
  const me = c.get('user');
  const row = await load(c, id, { manage: true });
  const [registrations, submissions, judges, sponsors, disputes, votes] = await Promise.all([
    q(c.env, `SELECT r.*, ${userJson('u')} AS u, co.name AS church FROM contest_registrations r JOIN users u ON u.id = r.user_id
        LEFT JOIN communities co ON co.id = r.community_id WHERE r.contest_id = $1 ORDER BY r.created_at`, [id]),
    q(c.env, `SELECT s.*, ${userJson('u')} AS u,
        (SELECT COUNT(*)::int FROM contest_judging_scores js WHERE js.submission_id = s.id) AS judge_count,
        (SELECT AVG(score)::real FROM contest_judging_scores js WHERE js.submission_id = s.id) AS judge_avg
        FROM contest_submissions s JOIN users u ON u.id = s.user_id WHERE s.contest_id = $1 ORDER BY s.created_at`, [id]),
    q(c.env, `SELECT ${userJson('u')} AS u FROM contest_judges j JOIN users u ON u.id = j.user_id WHERE j.contest_id = $1`, [id]),
    q(c.env, 'SELECT * FROM contest_sponsors WHERE contest_id = $1 ORDER BY created_at', [id]),
    q(c.env, `SELECT d.*, ${userJson('u')} AS u FROM contest_disputes d JOIN users u ON u.id = d.user_id WHERE d.contest_id = $1 ORDER BY d.created_at DESC`, [id]),
    one(c.env, 'SELECT COUNT(*) FILTER (WHERE valid)::int AS valid, COUNT(*) FILTER (WHERE NOT valid)::int AS reversed FROM contest_votes WHERE contest_id = $1', [id]),
  ]);
  return c.json({
    contest: shape(c, row, me),
    registrations: registrations.map((r) => ({ user: r.u, church: r.church, disqualified: !!r.disqualified, disqualifyReason: r.disqualify_reason, registeredAt: iso(r.created_at) })),
    submissions: submissions.map((s) => ({ ...submissionShape(c, s, me.id), judgeCount: s.judge_count, judgeAverage: s.judge_avg === null ? null : Math.round(s.judge_avg * 10) / 10, disqualifyReason: s.disqualify_reason })),
    judges: judges.map((j) => j.u),
    sponsors: sponsors.map((s) => ({ id: s.id, name: s.name, linkUrl: s.link_url, contribution: s.contribution, approved: !!s.approved })),
    disputes: disputes.map((d) => ({ id: d.id, user: d.u, submissionId: d.submission_id, reason: d.reason, status: d.status, resolution: d.resolution, createdAt: iso(d.created_at) })),
    votes,
    // money: paid entry and paid votes are not enabled, so there is no revenue yet
    revenue: { registrationMinor: 0, votesMinor: 0, currency: row.currency || 'NGN', paymentsEnabled: false },
  });
});

contests.patch('/contests/:id', async (c) => {
  const row = await load(c, uuidParam(c), { manage: true });
  const me = c.get('user');
  if (row.results_published_at || row.settled_at) throw new ApiError(409, 'CONTEST_SETTLED', 'Results are published; this contest can’t be changed');
  const b = await body(c);
  const started = Date.now() >= ms(row.starts_at);
  // Once a contest is open to players only wording and the later dates may change (fairness)
  const sets = []; const vals = [row.id];
  const set = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (b.title !== undefined) set('title', str(b.title, { min: 3, max: 100, field: 'Title' }));
  if (b.description !== undefined) set('description', str(b.description, { max: 2000, field: 'Description' }));
  if (b.prizeText !== undefined) set('prize_text', str(b.prizeText, { max: 200, field: 'Prize' }));
  for (const [k, col, max] of [['rules', 'rules', 5000], ['eligibility', 'eligibility', 2000], ['submissionRequirements', 'submission_requirements', 2000], ['judgingCriteria', 'judging_criteria', 2000]]) {
    if (b[k] !== undefined) set(col, str(b[k], { max, field: k }));
  }
  if (b.endsAt !== undefined) { const d = parseDate(b.endsAt, 'End'); if (d <= new Date(row.starts_at)) throw bad('The end must be after the start'); set('ends_at', d.toISOString()); }
  if (b.votingEndsAt !== undefined) { const d = parseDate(b.votingEndsAt, 'Voting end'); set('voting_ends_at', d.toISOString()); }
  if (b.resultsAt !== undefined) set('results_at', b.resultsAt ? parseDate(b.resultsAt, 'Results date').toISOString() : null);
  if (!started) {
    if (b.startsAt !== undefined) set('starts_at', parseDate(b.startsAt, 'Start').toISOString());
    if (b.participantLimit !== undefined) set('participant_limit', b.participantLimit === null ? null : int(b.participantLimit, { min: 1, max: 1000000, field: 'Participant limit' }));
    if (b.allowSelfVote !== undefined) set('allow_self_vote', !!b.allowSelfVote);
  } else if (b.startsAt !== undefined || b.participantLimit !== undefined) {
    throw new ApiError(409, 'ALREADY_STARTED', 'The start date and limits can’t change once the contest has started');
  }
  if (!sets.length) return c.json(shape(c, row, me));
  // organizer edits to an approved contest stay live; edits by organizers are logged
  await q(c.env, `UPDATE contests SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, vals);
  await audit(c.env, me, 'contest.edit', 'contest', row.id, { fields: Object.keys(b) });
  return c.json(shape(c, await load(c, row.id), me));
});

for (const [path, change, label] of [['pause', 'paused = true', 'paused'], ['resume', 'paused = false', 'resumed'], ['cancel', 'cancelled = true', 'cancelled']]) {
  contests.post(`/contests/:id/${path}`, async (c) => {
    const row = await load(c, uuidParam(c), { manage: true });
    if (row.results_published_at || row.settled_at) throw new ApiError(409, 'CONTEST_SETTLED', 'Results are already published');
    await q(c.env, `UPDATE contests SET ${change}, updated_at = now() WHERE id = $1`, [row.id]);
    await audit(c.env, c.get('user'), `contest.${path}`, 'contest', row.id, { title: row.title });
    if (path !== 'resume') {
      const people = await q(c.env, 'SELECT user_id FROM contest_registrations WHERE contest_id = $1', [row.id]);
      await notifyAll(c.env, row.id, people.map((p) => p.user_id), `${row.title} was ${label}`, path === 'cancel' ? 'This contest has been cancelled. No entry fees were charged.' : 'The organizer has paused this contest for now.');
    }
    return c.json({ ok: true, status: label });
  });
}

contests.post('/contests/:id/judges', async (c) => {
  const row = await load(c, uuidParam(c), { manage: true });
  const b = await body(c);
  const ids = (Array.isArray(b.userIds) ? b.userIds : []).filter(isUuid).slice(0, 20);
  if (!ids.length) throw bad('Choose at least one judge');
  const added = await q(c.env, `INSERT INTO contest_judges (contest_id, user_id) SELECT $1, u.id FROM users u WHERE u.id = ANY($2::uuid[]) AND NOT u.banned
      ON CONFLICT DO NOTHING RETURNING user_id`, [row.id, ids]);
  await notifyAll(c.env, row.id, added.map((a) => a.user_id), `You’re a judge for ${row.title}`, 'Open Contest Centre › Judging to score the entries after the deadline.', { type: 'judge' });
  await audit(c.env, c.get('user'), 'contest.judges.add', 'contest', row.id, { added: added.length });
  return c.json({ added: added.length });
});

contests.delete('/contests/:id/judges/:userId', async (c) => {
  const row = await load(c, uuidParam(c), { manage: true });
  await q(c.env, 'DELETE FROM contest_judges WHERE contest_id = $1 AND user_id = $2', [row.id, uuidParam(c, 'userId')]);
  await audit(c.env, c.get('user'), 'contest.judges.remove', 'contest', row.id, {});
  return c.json({ ok: true });
});

contests.post('/contests/:id/publish', async (c) => {
  const row = await load(c, uuidParam(c), { manage: true });
  if (row.format === 'quiz') {
    await settle(ctxOf(c), row.id);
    const done = await one(c.env, 'SELECT settled_at FROM contests WHERE id = $1', [row.id]);
    if (!done.settled_at) throw new ApiError(409, 'NOT_READY', 'Quiz results are published automatically once the contest closes and the last attempts run out');
    return c.json({ ok: true });
  }
  const r = await publishSubmissionResults(c, row);
  await audit(c.env, c.get('user'), 'contest.publish', 'contest', row.id, { winners: r.winners.length, certificates: r.certificates });
  return c.json({ ok: true, winners: r.winners.length, certificates: r.certificates });
});

contests.post('/contests/:id/disqualify', async (c) => {
  const row = await load(c, uuidParam(c), { manage: true });
  const b = await body(c);
  if (!isUuid(b.userId)) throw bad('Choose a participant');
  const reason = str(b.reason, { min: 3, max: 500, field: 'Reason' });
  if (row.results_published_at || row.settled_at) throw new ApiError(409, 'CONTEST_SETTLED', 'Results are published; contact an admin');
  const on = b.disqualified !== false;
  await q(c.env, `UPDATE contest_registrations SET disqualified = $3, disqualify_reason = $4 WHERE contest_id = $1 AND user_id = $2`, [row.id, b.userId, on, on ? reason : null]);
  await q(c.env, `UPDATE contest_submissions SET disqualified = $3, disqualify_reason = $4 WHERE contest_id = $1 AND user_id = $2`, [row.id, b.userId, on, on ? reason : null]);
  await q(c.env, `UPDATE contest_entries SET disqualified = $3 WHERE contest_id = $1 AND user_id = $2`, [row.id, b.userId, on]);
  await audit(c.env, c.get('user'), on ? 'contest.disqualify' : 'contest.reinstate', 'contest', row.id, { userId: b.userId, reason });
  if (on) await notifyAll(c.env, row.id, [b.userId], `Your entry in ${row.title} was disqualified`, `Reason: ${reason}. You can appeal from the contest page.`);
  return c.json({ ok: true, disqualified: on });
});

contests.post('/contests/:id/sponsors', async (c) => {
  const me = c.get('user');
  const row = await load(c, uuidParam(c), { manage: true });
  const b = await body(c);
  const name = str(b.name, { min: 2, max: 100, field: 'Sponsor name' });
  const link = b.linkUrl ? str(b.linkUrl, { max: 300, field: 'Link' }) : null;
  if (link && !/^https:\/\//.test(link)) throw bad('Links must start with https://');
  const contribution = str(b.contribution || '', { max: 300, field: 'Contribution' });
  const s = await one(c.env, `INSERT INTO contest_sponsors (contest_id, name, link_url, contribution, approved, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [row.id, name, link, contribution, isAdmin(me), me.id]);
  await audit(c.env, me, 'contest.sponsor.add', 'contest', row.id, { name });
  return c.json({ id: s.id, name: s.name, approved: !!s.approved }, 201);
});

// ---------- creating a contest (organizers: pending approval; admins: published) ----------
function parseDate(v, field) {
  const d = new Date(v);
  if (!v || Number.isNaN(d.getTime())) throw bad(`${field} must be a date`);
  return d;
}
function parsePrizes(v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > MAX_PRIZE_PLACES) throw bad(`Coin prizes: up to ${MAX_PRIZE_PLACES} places`);
  const list = v.map((x, i) => int(x, { min: 0, max: 100000, field: `Coins for place ${i + 1}` }));
  while (list.length && list[list.length - 1] === 0) list.pop();
  return list;
}
function parseCustomQuestions(list) {
  if (!Array.isArray(list)) return null;
  if (list.length > 100) throw bad('Up to 100 custom questions');
  return list.map((x, i) => {
    const qtext = str(x.q || x.question, { min: 5, max: 400, field: `Question ${i + 1}` });
    const opts = (x.o || x.options || []).map((o) => String(o || '').trim()).filter(Boolean);
    if (opts.length < 2 || opts.length > 5) throw bad(`Question ${i + 1} needs 2 to 5 options`);
    const a = Number(x.a !== undefined ? x.a : x.correctIndex);
    if (!Number.isInteger(a) || a < 0 || a >= opts.length) throw bad(`Question ${i + 1} needs its correct answer`);
    return { id: `cq${i + 1}_${crypto.randomUUID().slice(0, 6)}`, c: 'custom', q: qtext, o: opts.map((o) => o.slice(0, 160)), a, r: String(x.r || x.reference || '').slice(0, 80) };
  });
}

export async function createContest(c, b, { asAdmin }) {
  const me = c.get('user');
  const title = str(b.title, { min: 3, max: 100, field: 'Title' });
  const description = str(b.description, { max: 2000, field: 'Description' });
  const prizeText = str(b.prizeText, { max: 200, field: 'Prize' });
  const prizeCoins = parsePrizes(b.prizeCoins);
  const prizePlaces = Array.isArray(b.prizePlaces) ? b.prizePlaces.slice(0, MAX_PRIZE_PLACES).map((p, i) => ({ place: i + 1, description: str(p && (p.description || p), { max: 200, field: `Prize for place ${i + 1}` }) })).filter((p) => p.description) : [];
  if (!prizeText && !prizeCoins.length && !prizePlaces.length) throw bad('Add a prize: coins, or describe it');
  const catId = b.contestCategory || 'bible_knowledge';
  const cat = await one(c.env, 'SELECT * FROM contest_categories WHERE id = $1', [catId]);
  if (!cat) throw bad('Unknown contest category');
  if (!cat.active) throw bad('That category is switched off');
  const format = cat.format;
  const startsAt = b.startsAt ? parseDate(b.startsAt, 'Start') : new Date();
  const endsAt = parseDate(b.endsAt, format === 'quiz' ? 'End' : 'Submission deadline');
  if (endsAt <= startsAt || endsAt <= new Date()) throw bad('The end must be after the start, and in the future');
  const registrationOpensAt = b.registrationOpensAt ? parseDate(b.registrationOpensAt, 'Registration opens') : (format === 'submission' ? new Date() : null);
  const registrationClosesAt = b.registrationClosesAt ? parseDate(b.registrationClosesAt, 'Registration closes') : null;
  const resultsAt = b.resultsAt ? parseDate(b.resultsAt, 'Results date') : null;
  const fee = b.entryFeeMinor === undefined ? 0 : int(b.entryFeeMinor, { min: 0, max: 100000000, field: 'Entry fee' });
  const currency = ['NGN', 'USD', 'GBP', 'EUR', 'GHS', 'KES'].includes(b.currency) ? b.currency : 'NGN';
  const countries = Array.isArray(b.eligibleCountries) ? b.eligibleCountries.map((x) => String(x).trim()).filter(Boolean).slice(0, 60) : [];
  const limit = b.participantLimit ? int(b.participantLimit, { min: 1, max: 1000000, field: 'Participant limit' }) : null;
  const teamMode = b.teamMode === 'church' || catId === 'church_vs_church' ? 'church' : 'solo';
  const certificatesFor = b.certificatesFor === 'all' ? 'all' : 'winners';
  const rules = str(b.rules || '', { max: 5000, field: 'Rules' });
  const eligibility = str(b.eligibility || '', { max: 2000, field: 'Eligibility' });
  const requirements = str(b.submissionRequirements || '', { max: 2000, field: 'Submission requirements' });
  const criteria = str(b.judgingCriteria || '', { max: 2000, field: 'Judging criteria' });
  let banner = null;
  if (b.bannerUrl) {
    const v = String(b.bannerUrl);
    if (!(new RegExp(`^img/${me.id}/[\\w.-]+$`).test(v) || /^https:\/\/[\w.-]+\//.test(v))) throw bad('Upload a banner image first', 'BAD_IMAGE');
    banner = v;
  }

  let questionCount = 0; let seconds = 20; let pool = []; let topic = 'mixed';
  let scoring = 'skill'; let votingEnabled = false; let votingEndsAt = null; let kinds = []; let judgeWeight = 70;
  if (format === 'quiz') {
    questionCount = int(b.questionCount === undefined ? 10 : b.questionCount, { min: 5, max: 30, field: 'Number of questions' });
    seconds = int(b.secondsPerQuestion === undefined ? 20 : b.secondsPerQuestion, { min: 10, max: 60, field: 'Seconds per question' });
    const custom = parseCustomQuestions(b.customQuestions);
    if (custom && custom.length) {
      if (custom.length < questionCount) throw bad(`Add at least ${questionCount} custom questions (you have ${custom.length})`);
      pool = custom; topic = 'custom';
    } else {
      topic = b.category || (catId === 'scripture_memory' ? 'verses' : 'mixed');
      if (!CONTEST_CATEGORIES[topic]) throw bad('Unknown question topic');
      const bank = topic === 'mixed' ? CONTEST_BANK.filter((x) => x.c !== 'chronology' && x.c !== 'verses') : CONTEST_BANK.filter((x) => x.c === topic);
      if (bank.length < questionCount) throw bad(`That topic only has ${bank.length} questions`);
      pool = shuffled(bank).slice(0, questionCount * 3);
    }
  } else {
    scoring = ['judged', 'popularity'].includes(b.scoring) ? b.scoring : cat.scoring;
    votingEnabled = scoring === 'popularity' ? true : !!b.votingEnabled;
    if (votingEnabled) {
      votingEndsAt = b.votingEndsAt ? parseDate(b.votingEndsAt, 'Voting end') : new Date(endsAt.getTime() + 3 * 86400000);
      if (votingEndsAt <= endsAt) throw bad('Voting must end after the submission deadline');
    }
    judgeWeight = b.judgeWeight === undefined ? 70 : int(b.judgeWeight, { min: 0, max: 100, field: 'Judge weight' });
    if (scoring === 'judged' && !votingEnabled) judgeWeight = 100;
    const allowed = cat.kinds && cat.kinds.length ? cat.kinds : ['image', 'video', 'audio', 'text'];
    kinds = Array.isArray(b.entryKinds) && b.entryKinds.length ? b.entryKinds.filter((k) => allowed.includes(k)) : allowed;
    if (!kinds.length) throw bad('Choose the entry types this contest takes');
  }

  const row = await one(c.env, `INSERT INTO contests (title, description, prize_text, prize_coins, prize_places, category, question_count, seconds_per_question, questions,
      starts_at, ends_at, created_by, organizer_id, format, contest_category, scoring, judge_weight, voting_enabled, allow_self_vote, banner_url,
      rules, eligibility, submission_requirements, judging_criteria, entry_kinds, allow_edits, registration_opens_at, registration_closes_at,
      voting_ends_at, results_at, participant_limit, eligible_countries, entry_fee_minor, currency, team_mode, approval, certificates_for)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb,$10,$11,$12,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36)
    RETURNING *`,
  [title, description, prizeText, prizeCoins, JSON.stringify(prizePlaces), topic, questionCount, seconds, JSON.stringify(pool),
    startsAt.toISOString(), endsAt.toISOString(), me.id, format, catId, scoring, judgeWeight, votingEnabled, !!b.allowSelfVote, banner,
    rules, eligibility, requirements, criteria, kinds, b.allowEdits !== false, registrationOpensAt && registrationOpensAt.toISOString(),
    registrationClosesAt && registrationClosesAt.toISOString(), votingEndsAt && votingEndsAt.toISOString(), resultsAt && resultsAt.toISOString(),
    limit, countries, fee, currency, teamMode, asAdmin ? 'approved' : 'pending', certificatesFor]);
  await audit(c.env, me, 'contest.create', 'contest', row.id, { title, approval: row.approval });
  if (asAdmin && b.notifyAll) {
    const r = await q(c.env, `INSERT INTO notifications (user_id, kind, title, body, data)
        SELECT id, 'contest', $1, $2, $3::jsonb FROM users WHERE NOT banned RETURNING id`,
      [`New contest: ${title}`, prizeText || (prizeCoins.length ? `Win up to ${prizeCoins[0]} coins. Free to enter.` : 'Free to enter.'), JSON.stringify({ contestId: row.id })]);
    row.notified = r.length;
  }
  return row;
}

// ======================================================================
// Admin routes (/admin/api/*; role = 'admin')
// ======================================================================
export const adminContests = new Hono();
adminContests.use('/admin/api/contests', requireAdmin);
adminContests.use('/admin/api/contests/*', requireAdmin);
adminContests.use('/admin/api/contest-*', requireAdmin);

adminContests.get('/admin/api/contests/categories', async (c) => {
  const count = (k) => (k === 'mixed' ? CONTEST_BANK.filter((x) => x.c !== 'chronology' && x.c !== 'verses').length : CONTEST_BANK.filter((x) => x.c === k).length);
  const cats = await q(c.env, 'SELECT * FROM contest_categories ORDER BY position');
  return c.json({
    items: Object.entries(CONTEST_CATEGORIES).map(([id, label]) => ({ id, label, questions: count(id) })),
    categories: cats.map((r) => ({ id: r.id, label: r.label, description: r.description, format: r.format, scoring: r.scoring, kinds: r.kinds, active: r.active })),
  });
});

adminContests.patch('/admin/api/contest-categories/:id', async (c) => {
  const b = await body(c);
  const r = await one(c.env, 'UPDATE contest_categories SET active = $2 WHERE id = $1 RETURNING id, active', [c.req.param('id'), !!b.active]);
  if (!r) throw notFound('Category not found');
  await audit(c.env, c.get('user'), 'contest.category', 'contest_category', r.id, { active: r.active });
  return c.json(r);
});

adminContests.get('/admin/api/contests', async (c) => {
  await settleDue(ctxOf(c));
  const me = c.get('user');
  const rows = await q(c.env, `${SELECT} ORDER BY (c.approval = 'pending') DESC, c.created_at DESC LIMIT 200`, [me.id]);
  return c.json({ items: rows.map((r) => shape(c, r, me)) });
});

adminContests.post('/admin/api/contests', async (c) => {
  const row = await createContest(c, await body(c), { asAdmin: true });
  return c.json({ ...shape(c, row, c.get('user')), notified: row.notified || 0 }, 201);
});

async function adminLoad(c) {
  const row = await one(c.env, 'SELECT * FROM contests WHERE id = $1', [uuidParam(c)]);
  if (!row) throw notFound('Contest not found');
  return row;
}

adminContests.get('/admin/api/contests/:id', async (c) => {
  const row = await adminLoad(c);
  const sponsors = await q(c.env, 'SELECT * FROM contest_sponsors WHERE contest_id = $1 ORDER BY created_at', [row.id]);
  return c.json({ ...shape(c, row, c.get('user')), questions: row.questions, leaderboard: await contestLeaderboard(c, row, null, 100),
    sponsors: sponsors.map((x) => ({ id: x.id, name: x.name, linkUrl: x.link_url, contribution: x.contribution, approved: !!x.approved })) });
});

adminContests.patch('/admin/api/contests/:id', async (c) => {
  const row = await adminLoad(c);
  if (row.settled_at || row.results_published_at) throw new ApiError(409, 'CONTEST_SETTLED', 'This contest has finished and paid out');
  const b = await body(c);
  const title = b.title === undefined ? row.title : str(b.title, { min: 3, max: 100, field: 'Title' });
  const description = b.description === undefined ? row.description : str(b.description, { max: 2000, field: 'Description' });
  const prizeText = b.prizeText === undefined ? row.prize_text : str(b.prizeText, { max: 200, field: 'Prize' });
  const endsAt = b.endsAt === undefined ? new Date(row.ends_at) : parseDate(b.endsAt, 'End');
  if (endsAt <= new Date(row.starts_at)) throw bad('The end must be after the start');
  const votingEndsAt = b.votingEndsAt === undefined ? row.voting_ends_at : parseDate(b.votingEndsAt, 'Voting end').toISOString();
  const next = await one(c.env, `UPDATE contests SET title = $2, description = $3, prize_text = $4, ends_at = $5, voting_ends_at = $6, updated_at = now() WHERE id = $1 RETURNING *`,
    [row.id, title, description, prizeText, endsAt.toISOString(), votingEndsAt]);
  await audit(c.env, c.get('user'), 'contest.edit', 'contest', row.id, { title });
  return c.json(shape(c, next, c.get('user')));
});

adminContests.post('/admin/api/contests/:id/approve', async (c) => {
  const row = await adminLoad(c);
  const next = await one(c.env, `UPDATE contests SET approval = 'approved', reject_reason = NULL, updated_at = now() WHERE id = $1 RETURNING *`, [row.id]);
  await audit(c.env, c.get('user'), 'contest.approve', 'contest', row.id, { title: row.title });
  if (row.organizer_id) await notifyAll(c.env, row.id, [row.organizer_id], `Approved: ${row.title}`, 'Your contest is now visible in Contest Centre.');
  return c.json(shape(c, next, c.get('user')));
});

adminContests.post('/admin/api/contests/:id/reject', async (c) => {
  const row = await adminLoad(c);
  const reason = str((await body(c)).reason, { min: 3, max: 500, field: 'Reason' });
  const next = await one(c.env, `UPDATE contests SET approval = 'rejected', reject_reason = $2, updated_at = now() WHERE id = $1 RETURNING *`, [row.id, reason]);
  await audit(c.env, c.get('user'), 'contest.reject', 'contest', row.id, { reason });
  if (row.organizer_id) await notifyAll(c.env, row.id, [row.organizer_id], `Not approved: ${row.title}`, `Reason: ${reason}`);
  return c.json(shape(c, next, c.get('user')));
});

// Close to new players now. Quiz prizes follow once attempts in progress run out; creative contests move to voting/judging.
adminContests.post('/admin/api/contests/:id/end', async (c) => {
  const row = await adminLoad(c);
  if (row.settled_at || row.cancelled) throw new ApiError(409, 'CONTEST_SETTLED', 'This contest is already over');
  const next = await one(c.env, `UPDATE contests SET ends_at = LEAST(ends_at, now()), starts_at = LEAST(starts_at, now()), updated_at = now() WHERE id = $1 RETURNING *`, [row.id]);
  await audit(c.env, c.get('user'), 'contest.end', 'contest', row.id, { title: row.title });
  return c.json(shape(c, next, c.get('user')));
});

adminContests.post('/admin/api/contests/:id/cancel', async (c) => {
  const row = await adminLoad(c);
  if (row.settled_at) throw new ApiError(409, 'CONTEST_SETTLED', 'Prizes have been paid, so this can’t be cancelled');
  const next = await one(c.env, 'UPDATE contests SET cancelled = true, updated_at = now() WHERE id = $1 RETURNING *', [row.id]);
  await audit(c.env, c.get('user'), 'contest.cancel', 'contest', row.id, { title: row.title });
  return c.json(shape(c, next, c.get('user')));
});

// Votes: investigate and reverse
adminContests.get('/admin/api/contests/:id/votes', async (c) => {
  const row = await adminLoad(c);
  const rows = await q(c.env, `SELECT v.*, ${userJson('u')} AS u, u.created_at AS user_created, s.title AS entry_title,
      (u.created_at > v.created_at - interval '1 day') AS new_account
    FROM contest_votes v JOIN users u ON u.id = v.user_id JOIN contest_submissions s ON s.id = v.submission_id
    WHERE v.contest_id = $1 ORDER BY v.created_at DESC LIMIT 500`, [row.id]);
  return c.json({ items: rows.map((v) => ({ id: v.id, user: v.u, entryTitle: v.entry_title, submissionId: v.submission_id, valid: !!v.valid, reversedReason: v.reversed_reason, newAccount: !!v.new_account, createdAt: iso(v.created_at) })) });
});

adminContests.post('/admin/api/contest-votes/:id/reverse', async (c) => {
  const reason = str((await body(c)).reason, { min: 3, max: 300, field: 'Reason' });
  const v = await one(c.env, `WITH r AS (UPDATE contest_votes SET valid = false, reversed_reason = $2 WHERE id = $1 AND valid RETURNING submission_id, contest_id)
      UPDATE contest_submissions s SET votes = GREATEST(s.votes - 1, 0) FROM r WHERE s.id = r.submission_id RETURNING r.contest_id, s.votes`, [uuidParam(c), reason]);
  if (!v) throw notFound('Vote not found or already reversed');
  await audit(c.env, c.get('user'), 'contest.vote.reverse', 'contest', v.contest_id, { voteId: c.req.param('id'), reason });
  return c.json({ ok: true, votes: v.votes });
});

// Organizers
adminContests.get('/admin/api/contest-organizers', async (c) => {
  const rows = await q(c.env, `SELECT ${userJson('u')} AS u FROM users u WHERE u.can_organize ORDER BY u.display_name LIMIT 200`);
  return c.json({ items: rows.map((r) => r.u) });
});
adminContests.post('/admin/api/contest-organizers/:id', async (c) => {
  const on = !!(await body(c)).canOrganize;
  const r = await one(c.env, `UPDATE users SET can_organize = $2 WHERE id = $1 RETURNING id, display_name`, [uuidParam(c), on]);
  if (!r) throw notFound('User not found');
  await audit(c.env, c.get('user'), on ? 'contest.organizer.grant' : 'contest.organizer.revoke', 'user', r.id, {});
  if (on) await q(c.env, `INSERT INTO notifications (user_id, kind, title, body, data) VALUES ($1, 'contest', 'You can now organize contests', 'Open Contest Centre › Organize to create your first contest.', '{}'::jsonb)`, [r.id]);
  return c.json({ id: r.id, canOrganize: on });
});

// Disputes
adminContests.get('/admin/api/contest-disputes', async (c) => {
  const status = ['open', 'resolved', 'rejected'].includes(c.req.query('status')) ? c.req.query('status') : 'open';
  const rows = await q(c.env, `SELECT d.*, ${userJson('u')} AS u, c.title FROM contest_disputes d JOIN users u ON u.id = d.user_id JOIN contests c ON c.id = d.contest_id
      WHERE d.status = $1 ORDER BY d.created_at DESC LIMIT 200`, [status]);
  return c.json({ items: rows.map((d) => ({ id: d.id, contestId: d.contest_id, contestTitle: d.title, user: d.u, submissionId: d.submission_id, reason: d.reason, status: d.status, resolution: d.resolution, createdAt: iso(d.created_at) })) });
});
adminContests.post('/admin/api/contest-disputes/:id', async (c) => {
  const b = await body(c);
  const status = b.status === 'rejected' ? 'rejected' : 'resolved';
  const resolution = str(b.resolution, { min: 3, max: 1000, field: 'Resolution' });
  const d = await one(c.env, `UPDATE contest_disputes SET status = $2, resolution = $3, resolved_at = now() WHERE id = $1 RETURNING *`, [uuidParam(c), status, resolution]);
  if (!d) throw notFound('Dispute not found');
  await audit(c.env, c.get('user'), 'contest.dispute', 'contest', d.contest_id, { status });
  await notifyAll(c.env, d.contest_id, [d.user_id], 'Your contest report was reviewed', resolution);
  return c.json({ ok: true, status });
});

// Sponsors and certificates
adminContests.post('/admin/api/contest-sponsors/:id', async (c) => {
  const b = await body(c);
  const s = b.remove
    ? await one(c.env, 'DELETE FROM contest_sponsors WHERE id = $1 RETURNING contest_id, name', [uuidParam(c)])
    : await one(c.env, 'UPDATE contest_sponsors SET approved = $2 WHERE id = $1 RETURNING contest_id, name', [uuidParam(c), !!b.approved]);
  if (!s) throw notFound('Sponsor not found');
  await audit(c.env, c.get('user'), b.remove ? 'contest.sponsor.remove' : 'contest.sponsor.review', 'contest', s.contest_id, { name: s.name, approved: !!b.approved });
  return c.json({ ok: true });
});
adminContests.post('/admin/api/contest-certificates/:code/revoke', async (c) => {
  const r = await one(c.env, 'UPDATE contest_certificates SET revoked = true WHERE code = $1 RETURNING contest_id', [c.req.param('code')]);
  if (!r) throw notFound('Certificate not found');
  await audit(c.env, c.get('user'), 'contest.certificate.revoke', 'contest', r.contest_id, { code: c.req.param('code') });
  return c.json({ ok: true });
});

// ======================================================================
// Public: certificate verification (no sign-in)
// ======================================================================
export const contestPublic = new Hono();
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
async function certificateByCode(env, code) {
  if (!/^BN-[A-Z0-9]{8}$/.test(String(code || ''))) return null;
  return one(env, `SELECT cc.*, c.title AS contest_title, u.display_name, o.display_name AS organizer
      FROM contest_certificates cc JOIN contests c ON c.id = cc.contest_id JOIN users u ON u.id = cc.user_id
      LEFT JOIN users o ON o.id = c.organizer_id WHERE cc.code = $1`, [code]);
}
contestPublic.get('/certificates/:code{.+\\.json}', async (c) => {
  const code = c.req.param('code').replace(/\.json$/, '');
  const r = await certificateByCode(c.env, code);
  if (!r) return c.json({ valid: false }, 404);
  return c.json({ valid: !r.revoked, code: r.code, name: r.display_name, contest: r.contest_title, achievement: r.achievement, kind: r.kind, place: r.place, issuedAt: iso(r.issued_at), organizer: r.organizer || 'BibleNestra' });
});
contestPublic.get('/certificates/:code', async (c) => {
  const r = await certificateByCode(c.env, c.req.param('code'));
  c.header('Cache-Control', 'no-store');
  const status = !r ? 'not-found' : r.revoked ? 'revoked' : 'valid';
  const head = '<meta name="viewport" content="width=device-width,initial-scale=1"><title>BibleNestra certificate check</title>'
    + '<style>body{margin:0;font-family:Georgia,serif;background:#F6F2EA;color:#1C1915;display:flex;min-height:100vh;align-items:center;justify-content:center}'
    + '.card{max-width:520px;margin:24px;padding:28px;border-radius:20px;background:#fff;border:2px solid #D4A852;text-align:center}'
    + '.ok{color:#3E7B57;font-family:sans-serif;font-weight:700}.bad{color:#B83A3A;font-family:sans-serif;font-weight:700}'
    + 'h1{font-size:26px;margin:10px 0}.meta{font-family:sans-serif;color:#6B6255;font-size:14px;line-height:1.6}.code{font-family:monospace;color:#A87A27}</style>';
  const bodyHtml = status === 'not-found'
    ? '<div class="card"><p class="bad">No certificate with this code</p><p class="meta">Check the code and try again.</p></div>'
    : `<div class="card"><div class="${status === 'valid' ? 'ok' : 'bad'}">${status === 'valid' ? '✓ Valid certificate' : 'This certificate was revoked'}</div>`
      + `<h1>${esc(r.display_name)}</h1><p class="meta">${esc(r.achievement)}<br>${esc(r.contest_title)}<br>Issued ${esc(new Date(r.issued_at).toDateString())} by ${esc(r.organizer || 'BibleNestra')}</p>`
      + `<p class="code">${esc(r.code)}</p></div>`;
  return c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8">${head}</head><body>${bodyHtml}</body></html>`, status === 'not-found' ? 404 : 200);
});
