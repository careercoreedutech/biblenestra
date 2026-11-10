// LIVE BIBLE BATTLES — two players, the same questions, the same clock.
// The server is the clock: a battle starts at starts_at, and question i is open during
// [starts_at + i*window, starts_at + (i+1)*window). Answers are only accepted for the open question and
// are timed by the server, so a slow phone or a fast network gives no advantage. Points: 100 for a
// correct answer plus up to 50 for speed. Phones poll GET /battles/:id (about once a second).
import { Hono } from 'hono';
import { one, q } from '../lib/db.js';
import { ApiError, bad, body, forbidden, int, isUuid, notFound, uuidParam } from '../lib/http.js';
import { userJson } from '../lib/shape.js';
import { notifyUser } from '../hub.js';
import { CONTEST_BANK } from '../lib/contestBank.js';

const QUESTIONS = 8;
const COUNTDOWN_MS = 5000;
const iso = (d) => (d ? new Date(d).toISOString() : null);

function pickQuestions() {
  const pool = CONTEST_BANK.filter((x) => x.c !== 'chronology' && x.o.length >= 2);
  const out = [];
  const used = new Set();
  while (out.length < QUESTIONS && used.size < pool.length) {
    const i = Math.floor(Math.random() * pool.length);
    if (used.has(i)) continue;
    used.add(i);
    out.push(pool[i]);
  }
  return out;
}

const windowMs = (b) => b.seconds_per_question * 1000;
function clockOf(b, now = Date.now()) {
  if (b.status !== 'active' || !b.starts_at) return { phase: b.status === 'finished' ? 'finished' : b.status, index: -1 };
  const t = now - new Date(b.starts_at).getTime();
  if (t < 0) return { phase: 'countdown', index: -1, msLeft: -t };
  const index = Math.floor(t / windowMs(b));
  if (index >= b.questions.length) return { phase: 'over', index: b.questions.length };
  return { phase: 'question', index, msLeft: windowMs(b) - (t % windowMs(b)) };
}

async function finishIfOver(env, b) {
  if (b.status !== 'active' || clockOf(b).phase !== 'over') return b;
  const done = await one(env, `WITH s AS (
      SELECT COALESCE(SUM(points) FILTER (WHERE user_id = $2), 0)::int AS s1, COALESCE(SUM(points) FILTER (WHERE user_id = $3), 0)::int AS s2
      FROM battle_answers WHERE battle_id = $1)
    UPDATE battles SET status = 'finished', score1 = s.s1, score2 = s.s2,
      winner = CASE WHEN s.s1 > s.s2 THEN $2::uuid WHEN s.s2 > s.s1 THEN $3::uuid ELSE NULL END
    FROM s WHERE id = $1 AND status = 'active' RETURNING battles.*`, [b.id, b.player1, b.player2]);
  return done || (await one(env, 'SELECT * FROM battles WHERE id = $1', [b.id]));
}

async function view(c, b, meId) {
  b = await finishIfOver(c.env, b);
  const clock = clockOf(b);
  const players = await q(c.env, `SELECT ${userJson('u')} AS u FROM users u WHERE u.id = ANY($1::uuid[])`, [[b.player1, b.player2].filter(Boolean)]);
  const byId = Object.fromEntries(players.map((p) => [p.u.id, p.u]));
  const answers = await q(c.env, 'SELECT user_id, q_index, option, correct, points FROM battle_answers WHERE battle_id = $1', [b.id]);
  const scoreOf = (uid) => answers.filter((a) => a.user_id === uid).reduce((n, a) => n + a.points, 0);
  const opp = b.player1 === meId ? b.player2 : b.player1;
  const reveal = (i) => {
    const x = b.questions[i];
    const mine = answers.find((a) => a.user_id === meId && a.q_index === i);
    const theirs = answers.find((a) => a.user_id === opp && a.q_index === i);
    return { index: i, question: x.q, options: x.o, correctIndex: x.a, reference: x.r, myOption: mine ? mine.option : null, myPoints: mine ? mine.points : 0, opponentCorrect: theirs ? theirs.correct : null };
  };
  const current = clock.phase === 'question' ? (() => {
    const x = b.questions[clock.index];
    const mine = answers.find((a) => a.user_id === meId && a.q_index === clock.index);
    return { index: clock.index, question: x.q, options: x.o, answered: !!mine, myOption: mine ? mine.option : null,
      opponentAnswered: answers.some((a) => a.user_id === opp && a.q_index === clock.index), msLeft: clock.msLeft };
  })() : null;
  const pastCount = b.status === 'finished' || clock.phase === 'over' ? b.questions.length : Math.max(0, clock.index);
  return {
    id: b.id,
    status: b.status,
    phase: clock.phase === 'over' ? 'finished' : clock.phase,
    serverNow: new Date().toISOString(),
    startsAt: iso(b.starts_at),
    msUntilStart: clock.phase === 'countdown' ? clock.msLeft : 0,
    secondsPerQuestion: b.seconds_per_question,
    total: b.questions.length,
    me: byId[meId] || null,
    opponent: opp ? byId[opp] || null : null,
    invited: !!b.invited,
    iAmInvited: !!b.invited && b.player2 === meId && b.status === 'waiting',
    myScore: b.status === 'finished' ? (b.player1 === meId ? b.score1 : b.score2) : scoreOf(meId),
    opponentScore: b.status === 'finished' ? (b.player1 === meId ? b.score2 : b.score1) : scoreOf(opp),
    winner: b.status === 'finished' ? (b.winner ? (b.winner === meId ? 'me' : 'opponent') : 'draw') : null,
    current,
    lastResult: clock.phase === 'question' && clock.index > 0 ? reveal(clock.index - 1) : null,
    review: b.status === 'finished' ? b.questions.map((_, i) => reveal(i)) : undefined,
    pastCount,
  };
}

async function loadBattle(c) {
  const me = c.get('user');
  const b = await one(c.env, 'SELECT * FROM battles WHERE id = $1', [uuidParam(c)]);
  if (!b) throw notFound('Battle not found');
  if (b.player1 !== me.id && b.player2 !== me.id) throw forbidden('This is not your battle');
  return b;
}

const ping = (env, b) => [b.player1, b.player2].filter(Boolean).forEach((u) => notifyUser(env, u, { type: 'battle.update', battleId: b.id }).catch(() => {}));

export const battles = new Hono();

// Quick match: join someone waiting, or wait for an opponent (an open seat lasts 2 minutes)
battles.post('/battles/queue', async (c) => {
  const me = c.get('user');
  const matched = await one(c.env, `UPDATE battles SET player2 = $1, status = 'active', starts_at = now() + make_interval(secs => $2)
      WHERE id = (SELECT id FROM battles WHERE status = 'waiting' AND NOT invited AND player1 <> $1 AND created_at > now() - interval '2 minutes'
                  ORDER BY created_at LIMIT 1)
        AND status = 'waiting' RETURNING *`, [me.id, COUNTDOWN_MS / 1000]);
  if (matched) { ping(c.env, matched); return c.json(await view(c, matched, me.id)); }
  const mine = await one(c.env, `SELECT * FROM battles WHERE player1 = $1 AND status = 'waiting' AND NOT invited AND created_at > now() - interval '2 minutes' ORDER BY created_at DESC LIMIT 1`, [me.id]);
  if (mine) return c.json(await view(c, mine, me.id));
  await q(c.env, `UPDATE battles SET status = 'cancelled' WHERE player1 = $1 AND status = 'waiting' AND NOT invited`, [me.id]);
  const b = await one(c.env, `INSERT INTO battles (player1, questions) VALUES ($1, $2::jsonb) RETURNING *`, [me.id, JSON.stringify(pickQuestions())]);
  return c.json(await view(c, b, me.id), 201);
});

// Challenge someone (also used for a rematch)
async function challenge(c, opponentId, rematchOf = null) {
  const me = c.get('user');
  if (!isUuid(opponentId) || opponentId === me.id) throw bad('Choose someone to challenge');
  const opp = await one(c.env, 'SELECT id FROM users WHERE id = $1 AND NOT banned', [opponentId]);
  if (!opp) throw notFound('Player not found');
  const blocked = await one(c.env, 'SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)', [me.id, opponentId]);
  if (blocked) throw forbidden('You can’t challenge this person', 'BLOCKED');
  const b = await one(c.env, `INSERT INTO battles (player1, player2, invited, questions, rematch_of) VALUES ($1, $2, true, $3::jsonb, $4) RETURNING *`,
    [me.id, opponentId, JSON.stringify(pickQuestions()), rematchOf]);
  await q(c.env, `INSERT INTO notifications (user_id, kind, title, body, data) VALUES ($1, 'battle', $2, 'Tap to accept and play a live Bible battle.', $3::jsonb)`,
    [opponentId, `${me.display_name} challenged you to a Bible battle`, JSON.stringify({ battleId: b.id, fromId: me.id })]);
  ping(c.env, b);
  return c.json(await view(c, b, me.id), 201);
}
battles.post('/battles/challenge', async (c) => challenge(c, (await body(c)).userId));
battles.post('/battles/:id/rematch', async (c) => {
  const me = c.get('user');
  const b = await loadBattle(c);
  if (b.status !== 'finished') throw bad('Finish this battle first');
  return challenge(c, b.player1 === me.id ? b.player2 : b.player1, b.id);
});

battles.post('/battles/:id/accept', async (c) => {
  const me = c.get('user');
  const b = await loadBattle(c);
  if (b.player2 !== me.id || !b.invited) throw forbidden('This challenge is not for you');
  const started = await one(c.env, `UPDATE battles SET status = 'active', starts_at = now() + make_interval(secs => $2) WHERE id = $1 AND status = 'waiting' RETURNING *`, [b.id, COUNTDOWN_MS / 1000]);
  if (!started) throw new ApiError(409, 'NOT_WAITING', 'This challenge is no longer open');
  ping(c.env, started);
  return c.json(await view(c, started, me.id));
});

battles.post('/battles/:id/cancel', async (c) => {
  const me = c.get('user');
  const b = await loadBattle(c);
  const r = await one(c.env, `UPDATE battles SET status = 'cancelled' WHERE id = $1 AND status = 'waiting' RETURNING *`, [b.id]);
  if (!r) throw new ApiError(409, 'NOT_WAITING', 'The battle has already started');
  ping(c.env, r);
  return c.json(await view(c, r, me.id));
});

battles.get('/battles/:id', async (c) => {
  const b = await loadBattle(c);
  return c.json(await view(c, b, c.get('user').id));
});

battles.post('/battles/:id/answer', async (c) => {
  const me = c.get('user');
  const b = await loadBattle(c);
  if (b.status !== 'active') throw new ApiError(409, 'NOT_ACTIVE', 'This battle is not running');
  const bd = await body(c);
  const index = int(bd.index, { min: 0, max: b.questions.length - 1, field: 'Question' });
  const option = int(bd.option, { min: 0, max: 9, field: 'Answer' });
  const clock = clockOf(b);
  if (clock.phase !== 'question' || clock.index !== index) throw new ApiError(409, 'TOO_LATE', 'That question has closed');
  const x = b.questions[index];
  const correct = x.a === option;
  const points = correct ? 100 + Math.round(50 * (clock.msLeft / windowMs(b))) : 0;
  const ins = await one(c.env, `INSERT INTO battle_answers (battle_id, user_id, q_index, option, correct, points) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT DO NOTHING RETURNING points`, [b.id, me.id, index, option, correct, points]);
  if (!ins) throw new ApiError(409, 'ALREADY_ANSWERED', 'You already answered this question');
  ping(c.env, b);
  return c.json({ ok: true, index, locked: true });
});

battles.get('/battles', async (c) => {
  const me = c.get('user');
  const rows = await q(c.env, `SELECT b.*, ${userJson('o')} AS opp FROM battles b
      LEFT JOIN users o ON o.id = CASE WHEN b.player1 = $1 THEN b.player2 ELSE b.player1 END
      WHERE (b.player1 = $1 OR b.player2 = $1) AND b.status <> 'cancelled' ORDER BY b.created_at DESC LIMIT 30`, [me.id]);
  const items = [];
  for (const r0 of rows) {
    const r = await finishIfOver(c.env, r0);
    const mine = r.player1 === me.id ? r.score1 : r.score2;
    const theirs = r.player1 === me.id ? r.score2 : r.score1;
    items.push({ id: r.id, status: r.status, opponent: r0.opp && r0.opp.id ? r0.opp : null, iAmInvited: r.invited && r.player2 === me.id && r.status === 'waiting',
      myScore: mine, opponentScore: theirs, result: r.status !== 'finished' ? null : !r.winner ? 'draw' : r.winner === me.id ? 'won' : 'lost', createdAt: iso(r.created_at) });
  }
  const wins = items.filter((x) => x.result === 'won').length;
  return c.json({ items, stats: { played: items.filter((x) => x.result).length, wins } });
});
