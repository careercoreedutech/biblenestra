// STAFF ACCESS: the owner-only "Staff" tab — invite people by one-time link, set roles / custom permissions, disable
// accounts, sign them out everywhere, resend or cancel links, jump to a person's activity in the Audit log.
// Registered with registerAdminScript() from routes/staff.js. Uses /admin/api/staff/*.
// NOTE: plain JS in a string — no backticks or "${" inside. Everything people typed is set with textContent.
export const STAFF_ADMIN_SCRIPT = `
(function(){
if (!window.registerAdminTab) return;

function when(s){ if (!s) return 'never'; return new Date(s).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }

// Per-area None / View / Manage pickers for a custom role
function permGrid(h, areas, current){
  var box = h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px;margin-top:8px' });
  var sels = {};
  areas.filter(function(a){ return !a.ownerOnly; }).forEach(function(a){
    var v = (current || {})[a.key] || '';
    var sel = h('select', { style: 'padding:5px 8px' }, [['', 'No access'], ['view', 'View'], ['manage', 'View + manage']].map(function(o){ return h('option', { value: o[0], text: o[1], selected: o[0] === v }); }));
    sels[a.key] = sel;
    box.appendChild(h('label', { class: 'card', style: 'margin:0;padding:8px 10px;display:flex;gap:8px;align-items:center', title: a.hint || '' }, [h('span', { class: 'grow', text: a.label }), sel]));
  });
  return { el: box, value: function(){ var o = {}; Object.keys(sels).forEach(function(k){ if (sels[k].value) o[k] = sels[k].value; }); return o; } };
}

function linkBox(h, toast, invite, note){
  var inp = h('input', { value: invite.link, readonly: true, class: 'grow', style: 'min-width:240px', onclick: function(){ this.select(); } });
  return h('div', { class: 'card', style: 'background:#FBF6EC;border-color:rgba(168,122,39,.35)' }, [
    h('div', { class: 'eyebrow', style: 'color:var(--gold)', text: 'One-time invite link' }),
    h('div', { class: 'row', style: 'margin-top:8px' }, [inp, h('button', { class: 'btn small', text: 'Copy link', onclick: function(){
      try { navigator.clipboard.writeText(invite.link).then(function(){ toast('Link copied'); }, function(){ inp.select(); document.execCommand('copy'); toast('Link copied'); }); }
      catch (e) { inp.select(); document.execCommand('copy'); toast('Link copied'); }
    } })]),
    h('p', { class: 'meta', style: 'margin:8px 0 0', text: (note || 'Send this link to the person yourself.') + ' It works once and expires ' + when(invite.expiresAt) + '. It is not shown again — make a new one if it gets lost.' }),
  ]);
}

window.registerAdminTab('Staff', function(box, ctx){
  var h = ctx.h, api = ctx.api, toast = ctx.toast;
  var data = null;
  box.appendChild(h('h2', { class: 'serif', text: 'Staff' }));
  box.appendChild(h('p', { class: 'sub', text: 'Invite people to this dashboard with limits on what they can see and do. They open the link, choose a username and password, then sign in on the normal dashboard sign-in. Only you (the owner) see this tab.' }));
  var inviteBox = h('div'); var created = h('div'); var list = h('div');
  box.appendChild(inviteBox); box.appendChild(created); box.appendChild(list);

  function roleSelect(value){
    return h('select', {}, data.roles.map(function(r){ return h('option', { value: r.key, text: r.label, selected: r.key === value }); }));
  }
  function roleHint(key){ var r = data.roles.find(function(x){ return x.key === key; }); return r ? r.hint : ''; }

  function drawInvite(){
    inviteBox.innerHTML = '';
    var name = h('input', { placeholder: 'Name (e.g. Grace — finance)', style: 'min-width:220px' });
    var note = h('input', { placeholder: 'Email or note (optional, for your records)', class: 'grow', style: 'min-width:220px' });
    var role = roleSelect('viewer');
    var hint = h('div', { class: 'meta', style: 'margin-top:6px', text: roleHint('viewer') });
    var expiry = h('select', {}, [[24, 'Link valid 24 hours'], [72, 'Link valid 3 days'], [168, 'Link valid 7 days'], [720, 'Link valid 30 days']].map(function(o){ return h('option', { value: o[0], text: o[1], selected: o[0] === 72 }); }));
    var access = h('input', { type: 'number', min: 1, max: 3650, placeholder: 'Access days (blank = no limit)', style: 'width:230px' });
    var gridHolder = h('div'); var grid = null;
    function onRole(){
      hint.textContent = roleHint(role.value);
      gridHolder.innerHTML = '';
      grid = null;
      if (role.value === 'custom') { grid = permGrid(h, data.areas, {}); gridHolder.appendChild(grid.el); }
    }
    role.onchange = onRole;
    var go = h('button', { class: 'btn', text: 'Create invite link' });
    go.onclick = async function(){
      if (!name.value.trim()) { name.focus(); return toast('Add a name', true); }
      go.disabled = true;
      try {
        var r = await api('POST', '/admin/api/staff/invites', { name: name.value.trim(), emailNote: note.value.trim() || undefined, role: role.value,
          permissions: grid ? grid.value() : undefined, expiresInHours: Number(expiry.value), accessDays: access.value ? Number(access.value) : undefined });
        created.innerHTML = ''; created.appendChild(linkBox(h, toast, r.invite, 'Invite for ' + r.staff.name + ' (' + r.staff.roleLabel + ').'));
        toast('Invite created'); drawInvite(); load();
      } catch (e) { toast(e.message, true); }
      go.disabled = false;
    };
    inviteBox.appendChild(h('div', { class: 'card' }, [
      h('div', { class: 'eyebrow', style: 'color:var(--primary)', text: 'Invite someone' }),
      h('div', { class: 'row', style: 'margin-top:10px' }, [name, note]),
      h('div', { class: 'row', style: 'margin-top:10px' }, [role, expiry, access, h('div', { class: 'grow' }), go]),
      hint, gridHolder,
    ]));
  }

  function card(s){
    var role = roleSelect(s.role);
    var gridHolder = h('div'); var grid = null;
    function onRole(){ gridHolder.innerHTML = ''; grid = null; if (role.value === 'custom') { grid = permGrid(h, data.areas, s.role === 'custom' ? s.permissions : {}); gridHolder.appendChild(grid.el); } }
    role.onchange = onRole; onRole();
    async function act(method, path, b, msg, after){
      try { var r = await api(method, path, b); toast(msg); if (after) after(r); load(); } catch (e) { toast(e.message, true); }
    }
    var linkOut = h('div');
    var status = s.status === 'disabled' ? h('span', { class: 'chip neg', text: 'Disabled' })
      : s.status === 'invited' ? h('span', { class: 'chip gold', text: 'Invited' }) : h('span', { class: 'chip', text: 'Active' });
    var inviteText = s.invite ? (s.invite.expired ? 'Link expired ' : 'Open link expires ') + when(s.invite.expiresAt) : (s.status === 'invited' ? 'No open link' : '');
    var bits = [
      h('div', { class: 'row' }, [
        h('div', { class: 'grow' }, [
          h('div', { class: 'row', style: 'gap:8px' }, [h('b', { text: s.name }), h('span', { class: 'chip mut', text: s.roleLabel }), status,
            s.lockedUntil && new Date(s.lockedUntil).getTime() > Date.now() ? h('span', { class: 'chip neg', text: 'Locked (wrong passwords)' }) : null]),
          h('div', { class: 'meta', style: 'margin-top:4px', text: [s.username ? '@' + s.username : 'No username yet', s.emailNote || null, 'Last sign-in ' + when(s.lastLoginAt),
            s.accessExpiresAt ? 'Access until ' + when(s.accessExpiresAt) : null, inviteText || null].filter(Boolean).join(' · ') }),
        ]),
      ]),
      h('div', { class: 'row', style: 'margin-top:12px' }, [
        role, h('button', { class: 'btn small', text: 'Save role', onclick: function(){
          act('PATCH', '/admin/api/staff/' + s.id, { role: role.value, permissions: grid ? grid.value() : undefined }, 'Role updated');
        } }),
        h('div', { class: 'grow' }),
        h('button', { class: 'btn small ghost', text: 'Activity', onclick: function(){ window.__auditStaff = s.id; if (window.adminShow) window.adminShow('Audit log'); } }),
        s.status !== 'disabled' ? h('button', { class: 'btn small ghost', text: s.hasPassword ? 'New sign-in link' : 'Resend invite', onclick: function(){
          act('POST', '/admin/api/staff/' + s.id + '/invite', {}, 'New link created — the old one no longer works', function(r){
            created.innerHTML = ''; created.appendChild(linkBox(h, toast, r.invite, (s.hasPassword ? 'Password reset link' : 'Invite') + ' for ' + s.name + '.'));
          });
        } }) : null,
        s.invite ? h('button', { class: 'btn small ghost', text: 'Revoke link', onclick: function(){ act('POST', '/admin/api/staff/' + s.id + '/invite/revoke', {}, 'Link cancelled'); } }) : null,
        s.status === 'active' ? h('button', { class: 'btn small ghost', text: 'Revoke sessions', title: 'Sign this person out everywhere', onclick: function(){
          if (confirm('Sign ' + s.name + ' out of every device?')) act('POST', '/admin/api/staff/' + s.id + '/revoke-sessions', {}, 'Signed out everywhere');
        } }) : null,
        s.status === 'disabled'
          ? h('button', { class: 'btn small', text: 'Enable', onclick: function(){ act('POST', '/admin/api/staff/' + s.id + '/enable', {}, 'Account enabled'); } })
          : h('button', { class: 'btn small danger', text: 'Disable', onclick: function(){
              if (confirm('Disable ' + s.name + '? They are signed out at once and can’t sign in until you enable the account again.')) act('POST', '/admin/api/staff/' + s.id + '/disable', {}, 'Account disabled');
            } }),
      ]),
      gridHolder, linkOut,
    ];
    return h('div', { class: 'card', style: s.status === 'disabled' ? 'opacity:.7' : '' }, bits);
  }

  async function load(){
    list.innerHTML = '<div class="meta">Loading…</div>';
    try { data = await api('GET', '/admin/api/staff'); } catch (e) { list.textContent = e.message; return; }
    if (!inviteBox.firstChild) drawInvite();
    list.innerHTML = '';
    if (!data.items.length) { list.appendChild(h('div', { class: 'card empty' }, [h('span', { class: 'serif', text: 'No staff yet' }), 'Create an invite link above.'])); return; }
    data.items.forEach(function(s){ list.appendChild(card(s)); });
    var legend = h('details', { class: 'card' }, [h('summary', { text: 'What each role can do', style: 'cursor:pointer;font-weight:600' })].concat(data.roles.map(function(r){
      var p = r.permissions ? Object.keys(r.permissions).map(function(k){ var a = data.areas.find(function(x){ return x.key === k; }); return (a ? a.label : k) + (r.permissions[k] === 'manage' ? ' (manage)' : ' (view)'); }).join(', ') : 'only the areas you tick';
      return h('p', { class: 'meta', style: 'margin:8px 0 0' }, [h('b', { text: r.label + ': ' }), p]);
    })));
    list.appendChild(legend);
  }
  load();
});
})();
`;
