// CHRISTIAN CARE NETWORK (brief 6.7): Talk to a Priest (verified directory) + Talk to an Apostle (direct inbox).
//   GET    /care                         summary for the Care screen: apostle availability, my priest application, my care inboxes
//   GET    /care/priests?q=&country=&language=   approved + active priests only (+ country / language facets)
//   GET    /care/priests/mine            my application (any status)
//   POST   /care/priests/apply           apply / re-apply (→ pending)   {title?, name, photoUrl?, parish?, diocese?, country, languages[], bio?, availability?, referenceNote, confirm: true}
//   PATCH  /care/priests/mine            update availability / bio / languages / photo (no re-review)
//   GET    /care/priests/:id             one approved profile
//   POST   /care/priests/:id/message     start / reopen the private chat with that priest (labelled 'priest')
//   GET    /care/apostle                 { available, apostle } — "Coming soon" when not configured
//   POST   /care/apostle/chat            start / reopen the chat with the Apostle (labelled 'apostle'; one-time auto-reply greeting)
//   GET    /care/inbox?kind=apostle|priest   conversations started from the Care network that were addressed to me
//   Admin: GET /admin/api/care/priests?status=  ·  POST /admin/api/care/priests/:id/approve|reject|hide|suspend
//          GET|PUT /admin/api/care/apostle  { user: '@handle'|id|'', title?, greeting?, autoReply? }
import { Hono } from 'hono';
import { one, q } from '../lib/db.js';
import { ApiError, bad, body, forbidden, notFound, str, uuidParam } from '../lib/http.js';
import { userJson } from '../lib/shape.js';
import { notifyUser } from '../hub.js';
import { sendNotification } from '../lib/push.js';
import { audit, registerAdminScript, requireAdmin } from './admin.js';
import {
  AVAILABILITY, CARE_ADMIN_SCRIPT, PRIEST_STATUSES, getSetting, labelConversation, openDm, priestShape, resolveApostle, setSetting,
} from '../lib/care.js';

registerAdminScript(CARE_ADMIN_SCRIPT);

const P_SELECT = `SELECT p.*, u.avatar_url, u.handle, u.display_name FROM care_priests p JOIN users u ON u.id = p.user_id`;
const LISTED = `p.status = 'approved' AND NOT u.banned`;

const httpsOrNull = (v) => {
  const s = str(v, { max: 500, optional: true, field: 'Photo link' });
  if (!s) return null;
  if (!/^https:\/\/[^\s]+$/i.test(s)) throw bad('The photo must be an https:// link', 'BAD_PHOTO');
  return s;
};
const languagesOf = (v) => {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  const out = [];
  for (const x of arr) {
    const s = String(x || '').trim().slice(0, 40);
    if (s && !out.some((y) => y.toLowerCase() === s.toLowerCase())) out.push(s.charAt(0).toUpperCase() + s.slice(1));
  }
  if (!out.length) throw bad('Add at least one language', 'NO_LANGUAGE');
  return out.slice(0, 10);
};
const availabilityOf = (v, dflt = 'available') => {
  if (v == null || v === '') return dflt;
  if (!AVAILABILITY.includes(v)) throw bad(`Availability must be one of: ${AVAILABILITY.join(', ')}`, 'BAD_AVAILABILITY');
  return v;
};

async function notifyPriest(env, row, title, text) {
  try {
    await q(env, `INSERT INTO notifications (user_id, kind, title, body, data) VALUES ($1, 'care', $2, $3, $4::jsonb)`,
      [row.user_id, title, text, JSON.stringify({ priestId: row.id, route: 'Care' })]);
  } catch (e) { /* best effort */ }
}

// ---------- members (signed in) ----------
export const care = new Hono();

care.get('/care', async (c) => {
  const me = c.get('user');
  const ap = await resolveApostle(c.env);
  const mine = await one(c.env, `${P_SELECT} WHERE p.user_id = $1`, [me.id]);
  const inbox = await q(c.env, 'SELECT kind, count(*)::int AS n FROM care_conversations WHERE target_id = $1 GROUP BY kind', [me.id]);
  const counts = Object.fromEntries(inbox.map((r) => [r.kind, r.n]));
  return c.json({
    apostle: ap.user ? { available: true, userId: ap.user.id, name: ap.title, displayName: ap.user.display_name, avatarUrl: ap.user.avatar_url || null, headline: ap.user.headline || null } : { available: false },
    isApostle: !!(ap.user && ap.user.id === me.id),
    priest: mine ? priestShape(mine, { full: true }) : null,
    inbox: { apostle: counts.apostle || 0, priest: counts.priest || 0 },
  });
});

care.get('/care/priests', async (c) => {
  const params = [];
  let where = LISTED;
  const qs = String(c.req.query('q') || '').trim().slice(0, 80);
  if (qs) {
    params.push(`%${qs.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    const n = params.length;
    where += ` AND (p.name ILIKE $${n} OR p.parish ILIKE $${n} OR p.diocese ILIKE $${n} OR p.country ILIKE $${n} OR p.bio ILIKE $${n})`;
  }
  const country = String(c.req.query('country') || '').trim();
  if (country) { params.push(country); where += ` AND lower(p.country) = lower($${params.length})`; }
  const language = String(c.req.query('language') || '').trim();
  if (language) { params.push(language); where += ` AND EXISTS (SELECT 1 FROM unnest(p.languages) l WHERE lower(l) = lower($${params.length}))`; }
  const rows = await q(c.env, `${P_SELECT} WHERE ${where}
    ORDER BY CASE p.availability WHEN 'available' THEN 0 WHEN 'busy' THEN 1 ELSE 2 END, p.name LIMIT 200`, params);
  const facets = await one(c.env, `SELECT
      COALESCE((SELECT json_agg(DISTINCT p.country ORDER BY p.country) FROM care_priests p JOIN users u ON u.id = p.user_id WHERE ${LISTED}), '[]'::json) AS countries,
      COALESCE((SELECT json_agg(DISTINCT l ORDER BY l) FROM care_priests p JOIN users u ON u.id = p.user_id, unnest(p.languages) l WHERE ${LISTED}), '[]'::json) AS languages`);
  const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v || []);
  return c.json({ items: rows.map((r) => priestShape(r)), countries: parse(facets.countries), languages: parse(facets.languages) });
});

care.get('/care/priests/mine', async (c) => {
  const me = c.get('user');
  const row = await one(c.env, `${P_SELECT} WHERE p.user_id = $1`, [me.id]);
  return c.json({ priest: row ? priestShape(row, { full: true }) : null });
});

care.post('/care/priests/apply', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  if (b.confirm !== true) throw bad('Please confirm that you are an ordained Catholic priest and that these details are true', 'NOT_CONFIRMED');
  const existing = await one(c.env, 'SELECT * FROM care_priests WHERE user_id = $1', [me.id]);
  if (existing && existing.status === 'approved') throw new ApiError(409, 'ALREADY_LISTED', 'Your profile is already verified');
  if (existing && ['hidden', 'suspended'].includes(existing.status)) throw forbidden('Your profile was paused by the Bible Nestra team. Please contact support.', 'SUSPENDED');
  const v = {
    title: str(b.title || 'Rev. Fr.', { min: 1, max: 40, field: 'Title' }),
    name: str(b.name, { min: 2, max: 120, field: 'Name' }),
    photo: httpsOrNull(b.photoUrl),
    parish: str(b.parish, { max: 160, optional: true, field: 'Parish' }) || '',
    diocese: str(b.diocese, { max: 160, optional: true, field: 'Diocese' }) || '',
    country: str(b.country, { min: 2, max: 80, field: 'Country' }),
    languages: languagesOf(b.languages),
    bio: str(b.bio, { max: 1200, optional: true, field: 'Short bio' }) || '',
    availability: availabilityOf(b.availability),
    reference: str(b.referenceNote, { min: 10, max: 2000, field: 'Reference / documents' }),
  };
  if (!v.parish && !v.diocese) throw bad('Add your parish or diocese', 'NO_PARISH');
  const row = await one(c.env, `INSERT INTO care_priests (user_id, title, name, photo_url, parish, diocese, country, languages, bio, availability, reference_note, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending')
    ON CONFLICT (user_id) DO UPDATE SET title = EXCLUDED.title, name = EXCLUDED.name, photo_url = EXCLUDED.photo_url, parish = EXCLUDED.parish,
      diocese = EXCLUDED.diocese, country = EXCLUDED.country, languages = EXCLUDED.languages, bio = EXCLUDED.bio, availability = EXCLUDED.availability,
      reference_note = EXCLUDED.reference_note, status = 'pending', reject_reason = NULL, updated_at = now()
    RETURNING *`, [me.id, v.title, v.name, v.photo, v.parish, v.diocese, v.country, v.languages, v.bio, v.availability, v.reference]);
  return c.json(priestShape({ ...row, avatar_url: me.avatar_url, handle: me.handle, display_name: me.display_name }, { full: true }), existing ? 200 : 201);
});

care.patch('/care/priests/mine', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const row = await one(c.env, 'SELECT * FROM care_priests WHERE user_id = $1', [me.id]);
  if (!row) throw notFound('You have not applied yet');
  const next = await one(c.env, `UPDATE care_priests SET availability = $2, bio = $3, languages = $4, photo_url = $5, updated_at = now()
    WHERE id = $1 RETURNING *`, [
    row.id,
    availabilityOf(b.availability, row.availability),
    b.bio !== undefined ? str(b.bio, { max: 1200, optional: true, field: 'Short bio' }) || '' : row.bio,
    b.languages !== undefined ? languagesOf(b.languages) : row.languages,
    b.photoUrl !== undefined ? httpsOrNull(b.photoUrl) : row.photo_url,
  ]);
  return c.json(priestShape({ ...next, avatar_url: me.avatar_url, handle: me.handle, display_name: me.display_name }, { full: true }));
});

care.get('/care/priests/:id', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const row = await one(c.env, `${P_SELECT} WHERE p.id = $1`, [id]);
  const own = row && row.user_id === me.id;
  if (!row || (!own && me.role !== 'admin' && (row.status !== 'approved' || (await one(c.env, 'SELECT banned FROM users WHERE id = $1', [row.user_id])).banned))) {
    throw notFound('This priest is not listed');
  }
  return c.json(priestShape(row, { full: own || me.role === 'admin' }));
});

care.post('/care/priests/:id/message', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const row = await one(c.env, `${P_SELECT} WHERE p.id = $1 AND ${LISTED}`, [id]);
  if (!row) throw notFound('This priest is not listed');
  if (row.user_id === me.id) throw bad('This is your own profile', 'OWN_PROFILE');
  const dm = await openDm(c.env, me.id, row.user_id);
  await labelConversation(c.env, dm.id, 'priest', me.id, row.user_id);
  return c.json({ id: dm.id, isNew: dm.isNew, label: 'Talk to a Priest', with: { id: row.user_id, displayName: `${row.title} ${row.name}`, avatarUrl: row.photo_url || row.avatar_url || null } }, dm.isNew ? 201 : 200);
});

care.get('/care/apostle', async (c) => {
  const ap = await resolveApostle(c.env);
  if (!ap.user) return c.json({ available: false });
  return c.json({ available: true, apostle: { userId: ap.user.id, name: ap.title, displayName: ap.user.display_name, avatarUrl: ap.user.avatar_url || null, headline: ap.user.headline || null } });
});

care.post('/care/apostle/chat', async (c) => {
  const me = c.get('user');
  const ap = await resolveApostle(c.env);
  if (!ap.user) throw new ApiError(503, 'APOSTLE_UNAVAILABLE', 'Talk to an Apostle is coming soon');
  if (ap.user.id === me.id) throw bad('You are the Apostle — open your Apostle inbox instead', 'IS_APOSTLE');
  const dm = await openDm(c.env, me.id, ap.user.id);
  const fresh = await labelConversation(c.env, dm.id, 'apostle', me.id, ap.user.id);
  if (fresh) {
    if (ap.autoReply && ap.greeting) {
      const msg = await one(c.env, `INSERT INTO messages (conversation_id, sender_id, kind, body, meta) VALUES ($1,$2,'text',$3,$4::jsonb) RETURNING id`,
        [dm.id, ap.user.id, ap.greeting.slice(0, 5000), JSON.stringify({ autoReply: true, care: 'apostle' })]);
      await q(c.env, 'UPDATE conversations SET last_message_at = now() WHERE id = $1', [dm.id]);
      await notifyUser(c.env, me.id, { type: 'message.new', conversationId: dm.id, messageId: msg.id });
    }
    await sendNotification(c, {
      userId: ap.user.id, kind: 'message', title: 'Talk to an Apostle', body: `${me.display_name} started a conversation with you`,
      data: { conversationId: dm.id, care: 'apostle' },
    });
  }
  return c.json({ id: dm.id, isNew: dm.isNew || fresh, label: 'Talk to an Apostle', with: { id: ap.user.id, displayName: ap.user.display_name, avatarUrl: ap.user.avatar_url || null } }, fresh ? 201 : 200);
});

// The Apostle's (or a priest's) filtered inbox: only chats started from the Care network and addressed to me.
care.get('/care/inbox', async (c) => {
  const me = c.get('user');
  const kind = c.req.query('kind') === 'priest' ? 'priest' : 'apostle';
  const rows = await q(c.env, `SELECT cc.conversation_id, cc.created_at, ${userJson('u')} AS requester, cv.last_message_at,
      (SELECT json_build_object('text', CASE WHEN m.deleted THEN 'This message was deleted' ELSE m.body END, 'senderId', m.sender_id, 'createdAt', m.created_at)
         FROM messages m WHERE m.conversation_id = cc.conversation_id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
      (SELECT count(*)::int FROM messages m JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = $1
         WHERE m.conversation_id = cc.conversation_id AND m.sender_id <> $1 AND NOT m.deleted AND m.created_at > cm.last_read_at) AS unread
    FROM care_conversations cc JOIN users u ON u.id = cc.requester_id JOIN conversations cv ON cv.id = cc.conversation_id
    WHERE cc.target_id = $1 AND cc.kind = $2 AND NOT u.banned
    ORDER BY cv.last_message_at DESC LIMIT 200`, [me.id, kind]);
  const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
  return c.json({
    kind,
    label: kind === 'apostle' ? 'Talk to an Apostle' : 'Talk to a Priest',
    items: rows.map((r) => {
      const last = parse(r.last_message);
      return {
        conversationId: r.conversation_id,
        requester: parse(r.requester),
        startedAt: new Date(r.created_at).toISOString(),
        lastMessageAt: new Date(r.last_message_at).toISOString(),
        lastMessage: last ? { text: last.text, mine: last.senderId === me.id, createdAt: new Date(last.createdAt).toISOString() } : null,
        unread: r.unread || 0,
      };
    }),
  });
});

// ---------- admin ----------
export const adminCare = new Hono();
adminCare.use('/admin/api/care/*', requireAdmin);

adminCare.get('/admin/api/care/priests', async (c) => {
  const status = String(c.req.query('status') || 'pending');
  if (!PRIEST_STATUSES.includes(status)) throw bad('Unknown status');
  const rows = await q(c.env, `${P_SELECT} WHERE p.status = $1 ORDER BY ${status === 'pending' ? 'p.created_at ASC' : 'p.updated_at DESC'} LIMIT 300`, [status]);
  const counts = await q(c.env, 'SELECT status, count(*)::int AS n FROM care_priests GROUP BY status');
  return c.json({ items: rows.map((r) => priestShape(r, { full: true })), counts: Object.fromEntries(counts.map((r) => [r.status, r.n])) });
});

const REVIEW = { approve: 'approved', reject: 'rejected', hide: 'hidden', suspend: 'suspended' };
adminCare.post('/admin/api/care/priests/:id/:action', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const action = c.req.param('action');
  const status = REVIEW[action];
  if (!status) throw notFound('Unknown action');
  const b = await c.req.json().catch(() => ({}));
  const reason = ['reject', 'suspend'].includes(action) ? str(b && b.reason, { max: 300, optional: true, field: 'Reason' }) : null;
  const row = await one(c.env, `UPDATE care_priests SET status = $2, reject_reason = $3, reviewed_by = $4, reviewed_at = now(), updated_at = now()
    WHERE id = $1 RETURNING *`, [id, status, reason || null, me.id]);
  if (!row) throw notFound('Profile not found');
  await audit(c.env, me, `priest.${action}`, 'care_priest', id, { name: row.name, reason: reason || null });
  if (action === 'approve') {
    await notifyPriest(c.env, row, 'You are now listed as a verified priest', 'Members can find you in Care network → Talk to a Priest and message you privately.');
  } else if (action === 'reject') {
    await notifyPriest(c.env, row, 'Your priest profile wasn’t approved', reason || 'Please check your details and reference, then apply again.');
  } else if (action === 'suspend') {
    await notifyPriest(c.env, row, 'Your priest profile was paused', reason || 'Please contact the Bible Nestra team.');
  }
  return c.json({ ok: true, status: row.status });
});

adminCare.get('/admin/api/care/apostle', async (c) => {
  const ap = await resolveApostle(c.env);
  const s = await getSetting(c.env, 'apostle');
  const conv = ap.user ? await q(c.env, `SELECT cc.conversation_id, cc.created_at, ${userJson('u')} AS requester,
      (SELECT count(*)::int FROM messages m WHERE m.conversation_id = cc.conversation_id) AS messages
    FROM care_conversations cc JOIN users u ON u.id = cc.requester_id WHERE cc.kind = 'apostle' AND cc.target_id = $1
    ORDER BY cc.created_at DESC LIMIT 50`, [ap.user.id]) : [];
  return c.json({
    user: ap.user ? { id: ap.user.id, displayName: ap.user.display_name, handle: ap.user.handle || null } : null,
    source: ap.source,
    configuredId: ap.configuredId,
    envUserId: c.env.APOSTLE_USER_ID || null,
    title: s.title || '',
    greeting: ap.greeting,
    autoReply: ap.autoReply,
    conversations: conv.map((r) => ({ id: r.conversation_id, createdAt: new Date(r.created_at).toISOString(), messages: r.messages, requester: typeof r.requester === 'string' ? JSON.parse(r.requester) : r.requester })),
  });
});

adminCare.put('/admin/api/care/apostle', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const prev = await getSetting(c.env, 'apostle');
  const next = { ...prev };
  if (b.user !== undefined) {
    const raw = String(b.user || '').trim();
    if (!raw) next.userId = null;
    else {
      const u = /^[0-9a-f-]{36}$/i.test(raw)
        ? await one(c.env, 'SELECT id FROM users WHERE id = $1', [raw])
        : await one(c.env, 'SELECT id FROM users WHERE lower(handle) = lower($1)', [raw.replace(/^@/, '')]);
      if (!u) throw bad('No account with that handle or id', 'USER_NOT_FOUND');
      next.userId = u.id;
    }
  }
  if (b.title !== undefined) next.title = str(b.title, { max: 60, optional: true, field: 'Name' }) || '';
  if (b.greeting !== undefined) next.greeting = str(b.greeting, { max: 1000, optional: true, field: 'Greeting' }) || '';
  if (b.autoReply !== undefined) next.autoReply = !!b.autoReply;
  await setSetting(c.env, 'apostle', next);
  await audit(c.env, me, 'care.apostle', 'care_settings', 'apostle', { userId: next.userId || null, autoReply: next.autoReply !== false });
  const ap = await resolveApostle(c.env);
  return c.json({ ok: true, available: !!ap.user, userId: ap.user ? ap.user.id : null });
});
