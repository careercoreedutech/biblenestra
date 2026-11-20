// CHRISTIAN CARE NETWORK (brief 6.7): helpers for "Talk to a Priest" and "Talk to an Apostle".
// Routes live in routes/care.js; the admin tabs below are appended to /admin via registerAdminScript.
import { one, q } from './db.js';
import { forbidden, notFound } from './http.js';

export const PRIEST_STATUSES = ['pending', 'approved', 'rejected', 'hidden', 'suspended'];
export const AVAILABILITY = ['available', 'busy', 'away'];
export const DEFAULT_APOSTLE_GREETING = 'Peace be with you. Thank you for reaching out — I have received your message and will reply as soon as I can. You are in my prayers. 🙏';

const iso = (d) => (d ? new Date(d).toISOString() : null);

/** API shape of a priest profile. `full` adds the review fields (owner or admin only). */
export function priestShape(r, { full = false } = {}) {
  const out = {
    id: r.id,
    userId: r.user_id,
    title: r.title,
    name: r.name,
    displayName: `${r.title} ${r.name}`.trim(),
    photoUrl: r.photo_url || r.avatar_url || null,
    parish: r.parish || '',
    diocese: r.diocese || '',
    country: r.country,
    languages: r.languages || [],
    bio: r.bio || '',
    availability: r.availability,
    verified: r.status === 'approved',
    handle: r.handle || null,
  };
  if (full) {
    Object.assign(out, {
      status: r.status,
      referenceNote: r.reference_note || '',
      rejectReason: r.reject_reason || null,
      createdAt: iso(r.created_at),
      reviewedAt: iso(r.reviewed_at),
      account: r.display_name !== undefined ? { id: r.user_id, displayName: r.display_name, handle: r.handle || null } : undefined,
    });
  }
  return out;
}

// ---------- settings ----------
export async function getSetting(env, key) {
  const row = await one(env, 'SELECT value FROM care_settings WHERE key = $1', [key]);
  return row ? (typeof row.value === 'string' ? JSON.parse(row.value) : row.value) || {} : {};
}
export async function setSetting(env, key, value) {
  await q(env, `INSERT INTO care_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [key, JSON.stringify(value || {})]);
}

/**
 * The Apostle's account: the admin setting (care_settings 'apostle'.userId) wins, else env APOSTLE_USER_ID.
 * → { user, greeting, autoReply, source } — user is null when nothing is set (the app shows "Coming soon").
 */
export async function resolveApostle(env) {
  const s = await getSetting(env, 'apostle');
  const id = s.userId || String(env.APOSTLE_USER_ID || '').trim() || null;
  const source = s.userId ? 'settings' : env.APOSTLE_USER_ID ? 'env' : null;
  let user = null;
  if (id && /^[0-9a-f-]{36}$/i.test(id)) {
    user = await one(env, 'SELECT id, display_name, handle, avatar_url, headline, banned FROM users WHERE id = $1', [id]);
    if (user && user.banned) user = null;
  }
  return {
    user,
    source,
    configuredId: id,
    autoReply: s.autoReply !== false,
    greeting: typeof s.greeting === 'string' && s.greeting.trim() ? s.greeting.trim() : DEFAULT_APOSTLE_GREETING,
    title: typeof s.title === 'string' && s.title.trim() ? s.title.trim() : 'The Apostle',
  };
}

/** Start (or reopen) the private 1:1 chat between two people — same rules as POST /conversations/dm. */
export async function openDm(env, meId, otherId) {
  const block = await one(env, 'SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)', [meId, otherId]);
  if (block) throw forbidden('You cannot message this person', 'BLOCKED');
  const target = await one(env, 'SELECT id FROM users WHERE id = $1 AND NOT banned', [otherId]);
  if (!target) throw notFound('This person is not available');
  const existing = await one(env, `SELECT c.id FROM conversations c
     JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = $1
     JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = $2
     WHERE c.kind = 'dm' LIMIT 1`, [meId, otherId]);
  if (existing) return { id: existing.id, isNew: false };
  const conv = await one(env, `INSERT INTO conversations (kind) VALUES ('dm') RETURNING id`);
  await q(env, `INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1, $2, 'member'), ($1, $3, 'member')`, [conv.id, meId, otherId]);
  return { id: conv.id, isNew: true };
}

/** Label a conversation as started from the Care network. → true when the label is new. */
export async function labelConversation(env, convId, kind, requesterId, targetId) {
  const rows = await q(env, `INSERT INTO care_conversations (conversation_id, kind, requester_id, target_id) VALUES ($1,$2,$3,$4)
    ON CONFLICT DO NOTHING RETURNING 1`, [convId, kind, requesterId, targetId]);
  return rows.length > 0;
}

// ---------- admin page tabs (appended to /admin via registerAdminScript; no backticks or "${" inside) ----------
export const CARE_ADMIN_SCRIPT = `
(function(){
if (!window.registerAdminTab) return;
function when(s){ if (!s) return '—'; var d = new Date(s); return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
var AV = { available: 'Available', busy: 'Busy', away: 'Away' };
window.registerAdminTab('Priests', function(box, ctx){
  var h = ctx.h, api = ctx.api, toast = ctx.toast;
  box.appendChild(h('h2', { class: 'serif', text: 'Talk to a Priest — verification' }));
  box.appendChild(h('p', { class: 'sub', text: 'Catholic priests apply from the app (Care network → Talk to a Priest → Apply). Check the reference or document note (e.g. call the parish or diocese) before approving. Only approved profiles are listed in the app; Hide or Suspend removes a profile from the directory at once.' }));
  var tabs = h('div', { class: 'row', style: 'margin-bottom:12px' });
  var list = h('div');
  box.appendChild(tabs); box.appendChild(list);
  var current = 'pending';
  var btns = {};
  ['pending', 'approved', 'rejected', 'hidden', 'suspended'].forEach(function(s){
    var b = h('button', { class: 'btn small' + (s === current ? '' : ' ghost'), text: s.charAt(0).toUpperCase() + s.slice(1) });
    btns[s] = b;
    b.onclick = function(){ current = s; Object.keys(btns).forEach(function(k){ btns[k].className = 'btn small ghost'; }); b.className = 'btn small'; load(); };
    tabs.appendChild(b);
  });
  async function act(id, action, payload){
    try { await api('POST', '/admin/api/care/priests/' + id + '/' + action, payload || {}); toast('Done'); load(); }
    catch (e) { toast(e.message, true); }
  }
  async function load(){
    list.innerHTML = '';
    var d; try { d = await api('GET', '/admin/api/care/priests?status=' + current); } catch (e) { list.appendChild(h('div', { class: 'card empty', text: e.message })); return; }
    Object.keys(btns).forEach(function(k){ var n = (d.counts || {})[k] || 0; btns[k].textContent = k.charAt(0).toUpperCase() + k.slice(1) + (n ? ' (' + n + ')' : ''); });
    if (!d.items.length) { list.appendChild(h('div', { class: 'card empty', text: 'Nothing here.' })); return; }
    d.items.forEach(function(p){
      var b = [];
      if (p.status !== 'approved') { var ok = h('button', { class: 'btn small', text: p.status === 'pending' ? 'Approve' : 'Approve again' }); ok.onclick = function(){ act(p.id, 'approve'); }; b.push(ok); }
      if (p.status === 'pending') {
        var no = h('button', { class: 'btn small ghost', text: 'Reject' });
        no.onclick = function(){ var r = window.prompt('Reason for the applicant (optional):', ''); if (r === null) return; act(p.id, 'reject', { reason: r }); };
        b.push(no);
      }
      if (p.status === 'approved') {
        var hide = h('button', { class: 'btn small ghost', text: 'Hide' }); hide.onclick = function(){ if (window.confirm('Hide ' + p.displayName + ' from the directory?')) act(p.id, 'hide'); }; b.push(hide);
      }
      if (p.status === 'approved' || p.status === 'hidden') {
        var sus = h('button', { class: 'btn small danger', text: 'Suspend' });
        sus.onclick = function(){ var r = window.prompt('Reason for suspending (optional, shown to the priest):', ''); if (r === null) return; act(p.id, 'suspend', { reason: r }); };
        b.push(sus);
      }
      list.appendChild(h('div', { class: 'card' }, [
        h('div', { class: 'row' }, [
          p.photoUrl ? h('img', { class: 'avatar', src: p.photoUrl, alt: '' }) : h('div', { class: 'avatar' }),
          h('div', { class: 'grow' }, [
            h('b', { text: p.displayName }),
            h('div', { class: 'meta', text: [p.parish, p.diocese, p.country].filter(Boolean).join(' · ') }),
            h('div', { class: 'meta', text: 'Languages: ' + (p.languages.join(', ') || '—') + ' · ' + (AV[p.availability] || p.availability) }),
          ]),
          h('span', { class: 'chip' + (p.status === 'approved' ? '' : ' mut'), text: p.status }),
        ]),
        p.bio ? h('p', { style: 'margin:10px 0 0', text: p.bio }) : null,
        h('div', { class: 'card', style: 'margin-top:10px;background:#FBF7EC' }, [
          h('div', { class: 'meta', text: 'Reference / documents (admins only)' }),
          h('div', { style: 'white-space:pre-wrap;margin-top:4px', text: p.referenceNote || '—' }),
        ]),
        h('div', { class: 'meta', style: 'margin-top:8px', text: 'Account: ' + (p.account ? p.account.displayName + (p.account.handle ? ' (@' + p.account.handle + ')' : '') : '—') + ' · applied ' + when(p.createdAt) + (p.reviewedAt ? ' · reviewed ' + when(p.reviewedAt) : '') + (p.rejectReason ? ' · reason: ' + p.rejectReason : '') }),
        h('div', { class: 'row', style: 'margin-top:10px' }, b),
      ]));
    });
  }
  load();
});

window.registerAdminTab('Apostle', function(box, ctx){
  var h = ctx.h, api = ctx.api, toast = ctx.toast;
  box.appendChild(h('h2', { class: 'serif', text: 'Talk to an Apostle' }));
  box.appendChild(h('p', { class: 'sub', text: 'Care network → Talk to an Apostle opens a private chat straight with this account. Those chats are labelled “Talk to an Apostle” so the Apostle can filter them (in the app: Care network → Apostle inbox). Leave the account empty to show “Coming soon” in the app.' }));
  var status = h('div', { class: 'meta' });
  var userIn = h('input', { class: 'grow', placeholder: 'Account: @handle or user id' });
  var titleIn = h('input', { class: 'grow', placeholder: 'Name shown in the app (default: The Apostle)' });
  var greetIn = h('textarea', { class: 'grow', rows: '4', style: 'width:100%', placeholder: 'Auto-reply greeting sent once when someone starts a conversation' });
  var autoIn = h('input', { type: 'checkbox' });
  var save = h('button', { class: 'btn', text: 'Save' });
  box.appendChild(h('div', { class: 'card' }, [
    status,
    h('div', { class: 'row', style: 'margin-top:10px' }, [h('span', { class: 'meta', style: 'width:90px', text: 'Account' }), userIn]),
    h('div', { class: 'row', style: 'margin-top:10px' }, [h('span', { class: 'meta', style: 'width:90px', text: 'Shown as' }), titleIn]),
    h('div', { class: 'row', style: 'margin-top:10px;align-items:flex-start' }, [h('span', { class: 'meta', style: 'width:90px', text: 'Greeting' }), greetIn]),
    h('label', { class: 'row', style: 'margin-top:10px' }, [autoIn, h('span', { text: 'Send the greeting automatically to new conversations' })]),
    h('div', { class: 'row', style: 'margin-top:12px' }, [save]),
  ]));
  var convBox = h('div');
  box.appendChild(h('h3', { class: 'serif', text: 'Recent “Talk to an Apostle” conversations' }));
  box.appendChild(convBox);
  async function load(){
    var d; try { d = await api('GET', '/admin/api/care/apostle'); } catch (e) { status.textContent = e.message; return; }
    status.textContent = d.user ? ('Current: ' + d.user.displayName + (d.user.handle ? ' (@' + d.user.handle + ')' : '') + ' · from ' + (d.source === 'env' ? 'the APOSTLE_USER_ID setting on the server' : 'this dashboard')) : (d.configuredId ? 'The configured account was not found or is banned — the app shows “Coming soon”.' : 'Not set — the app shows “Coming soon”.');
    userIn.value = d.source === 'settings' && d.user ? (d.user.handle ? '@' + d.user.handle : d.user.id) : '';
    titleIn.value = d.title || '';
    greetIn.value = d.greeting || '';
    autoIn.checked = d.autoReply !== false;
    convBox.innerHTML = '';
    if (!d.conversations || !d.conversations.length) { convBox.appendChild(h('div', { class: 'card empty', text: 'No conversations yet.' })); return; }
    d.conversations.forEach(function(c){
      convBox.appendChild(h('div', { class: 'card' }, [h('b', { text: c.requester ? c.requester.displayName : 'Member' }), h('div', { class: 'meta', text: 'Started ' + when(c.createdAt) + ' · ' + c.messages + ' message(s)' })]));
    });
  }
  save.onclick = async function(){
    save.disabled = true;
    try { await api('PUT', '/admin/api/care/apostle', { user: userIn.value.trim(), title: titleIn.value.trim(), greeting: greetIn.value.trim(), autoReply: autoIn.checked }); toast('Saved'); load(); }
    catch (e) { toast(e.message, true); }
    save.disabled = false;
  };
  load();
});
})();
`;
