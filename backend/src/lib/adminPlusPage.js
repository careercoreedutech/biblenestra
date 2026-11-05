// ROUND 5 — admin page tabs: Dashboard, Users, Content, Communities & events, Announcements.
// Appended to the /admin page via registerAdminScript (see routes/admin.js). Uses window.registerAdminTab,
// window.adminShow and the ctx helpers (api, toast, h). All user content is set with textContent (never HTML).
// NOTE: no backticks or "${" inside the script string below.

export const ADMIN_PLUS_SCRIPT = `
(function(){
if (!window.registerAdminTab) return;

// ---------- extra styles ----------
var css = document.createElement('style');
css.textContent = [
  '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(178px,1fr));gap:12px;margin-bottom:14px}',
  '.stat{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:14px 16px}',
  '.stat .n{font-family:Newsreader,Georgia,serif;font-size:30px;font-weight:600;letter-spacing:-.5px;line-height:1.1}',
  '.stat .l{font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--muted)}',
  '.stat .d{font-size:12.5px;color:var(--pos);margin-top:3px}.stat.alert{border-color:rgba(184,58,58,.35);background:#FBF3F2;cursor:pointer}',
  '.stat.alert .n{color:var(--neg)}.stat.link{cursor:pointer}.stat.link:hover,.stat.alert:hover{box-shadow:0 2px 10px rgba(59,47,30,.1)}',
  '.bars{display:flex;align-items:flex-end;gap:6px;height:150px;padding:8px 0 0}',
  '.bars .b{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;min-width:0}',
  '.bars .b i{display:block;width:100%;max-width:34px;background:var(--primary);border-radius:6px 6px 2px 2px;min-height:2px}',
  '.bars .b span{font-size:10px;color:var(--faint);margin-top:5px;white-space:nowrap}.bars .b em{font-style:normal;font-size:10.5px;color:var(--muted);margin-bottom:3px}',
  '.ulist .u{display:flex;gap:12px;align-items:center;padding:10px 4px;border-top:1px solid var(--border);cursor:pointer}',
  '.ulist .u:first-child{border-top:0}.ulist .u:hover{background:var(--raised);border-radius:10px}',
  '.avatar.sm{width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--muted)}',
  '.overlay{position:fixed;inset:0;background:rgba(21,23,43,.4);display:flex;justify-content:flex-end;z-index:20}',
  '.drawer{width:min(560px,100%);height:100%;overflow:auto;background:var(--screen);padding:22px 22px 60px;box-shadow:-10px 0 30px rgba(0,0,0,.15)}',
  '.kv{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}.kv div{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:8px 10px}',
  '.kv b{display:block;font-size:18px}.kv span{font-size:11px;color:var(--muted)}',
  'textarea{border:1px solid var(--border);background:var(--raised);border-radius:10px;padding:9px 12px;font:inherit;color:var(--fg);width:100%;min-height:90px;resize:vertical}',
  'label.f{display:block;font-size:12px;font-weight:700;color:var(--muted);margin:10px 0 4px}',
  '.preview{background:#FBF6EC;border:1px solid rgba(168,122,39,.3);border-radius:18px;padding:14px 16px}',
  '.preview.urgent{background:#FBF1F0;border-color:rgba(184,58,58,.3)}',
  '.preview .t{font-family:Newsreader,Georgia,serif;font-size:18px;font-weight:600;margin:2px 0 4px}',
  '.two{display:grid;grid-template-columns:1.2fr 1fr;gap:14px}@media(max-width:760px){.two{grid-template-columns:1fr}}',
  '.pills{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}',
].join('');
document.head.appendChild(css);

var ORDER = ['Dashboard', 'Users', 'Content', 'Reports', 'Communities & events', 'Announcements', 'Fund Me approvals', 'YouTube channels', 'Audit log'];
if (window.setAdminTabOrder) window.setAdminTabOrder(ORDER);

function fmtDate(s){ if (!s) return '—'; var d = new Date(s); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
function fmtWhen(s){ if (!s) return 'never'; var d = new Date(s), diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now'; if (diff < 3600) return Math.floor(diff / 60) + ' min ago'; if (diff < 86400) return Math.floor(diff / 3600) + ' h ago';
  if (diff < 86400 * 30) return Math.floor(diff / 86400) + ' d ago'; return fmtDate(s); }
function num(n){ return Number(n || 0).toLocaleString(); }
function initials(name){ return String(name || '?').split(' ').map(function(x){ return x.charAt(0); }).join('').slice(0, 2).toUpperCase(); }
function avatar(h, u, cls){ return u && u.avatarUrl ? h('img', { class: 'avatar ' + (cls || 'sm'), src: u.avatarUrl, alt: '' }) : h('div', { class: 'avatar ' + (cls || 'sm'), text: initials(u && u.displayName) }); }
function pills(h, options, current, onPick){
  var box = h('div', { class: 'pills' });
  function draw(){ box.innerHTML = ''; options.forEach(function(o){ box.appendChild(h('button', { class: 'btn small ' + (o[0] === current ? '' : 'ghost'), text: o[1], onclick: function(){ current = o[0]; draw(); onPick(o[0]); } })); }); }
  draw(); return box;
}
function loadMoreBtn(h, onClick){ return h('div', { style: 'text-align:center;margin:10px 0' }, [h('button', { class: 'btn ghost', text: 'Load more', onclick: onClick })]); }

// ======================= Dashboard =======================
window.registerAdminTab('Dashboard', function(box, ctx){
  var h = ctx.h;
  box.appendChild(h('h2', { class: 'serif', text: 'Dashboard' }));
  box.appendChild(h('p', { class: 'sub', text: 'How BibleNestra is doing right now. Times are in your browser’s time zone; daily charts use UTC days.' }));
  var body = h('div', {}, [h('div', { class: 'meta', text: 'Loading…' })]); box.appendChild(body);
  ctx.api('GET', '/admin/api/stats').then(function(d){
    var t = d.totals; body.innerHTML = '';
    var attention = [];
    if (t.openReports) attention.push(['Open reports', t.openReports, 'Reports']);
    if (t.pendingFundraisers) attention.push(['Fundraisers to review', t.pendingFundraisers, 'Fund Me approvals']);
    if (attention.length) {
      body.appendChild(h('div', { class: 'eyebrow', style: 'color:var(--neg);margin-bottom:8px', text: 'Needs attention' }));
      body.appendChild(h('div', { class: 'grid' }, attention.map(function(a){ return h('div', { class: 'stat alert', onclick: function(){ window.adminShow(a[2]); } }, [h('div', { class: 'l', text: a[0] }), h('div', { class: 'n', text: num(a[1]) }), h('div', { class: 'meta', text: 'Open ' + a[2] + ' →' })]); })));
    }
    function stat(label, n, sub, tab){ return h('div', { class: 'stat' + (tab ? ' link' : ''), onclick: tab ? function(){ window.adminShow(tab); } : null }, [h('div', { class: 'l', text: label }), h('div', { class: 'n', text: num(n) }), sub ? h('div', { class: 'd', text: sub }) : null]); }
    body.appendChild(h('div', { class: 'grid' }, [
      stat('Users', t.users, '+' + num(t.newUsers7d) + ' this week · +' + num(t.newUsers24h) + ' today', 'Users'),
      stat('Active today', t.active24h, num(t.active7d) + ' active this week'),
      stat('Posts', t.posts, '+' + num(t.posts24h) + ' today', 'Content'),
      stat('Messages today', t.messages24h, null),
      stat('Prayer requests', t.prayers, null, 'Content'),
      stat('Communities', t.communities, num(t.upcomingEvents) + ' upcoming events', 'Communities & events'),
      stat('Coins in circulation', t.coinsInCirculation, num(t.gifts7d) + ' gifts this week'),
      stat('Live announcements', t.liveAnnouncements, t.banned ? num(t.banned) + ' banned accounts' : null, 'Announcements'),
    ]));
    // chart
    var metric = 'signups';
    var chartCard = h('div', { class: 'card' });
    var bars = h('div', { class: 'bars' });
    function drawChart(){
      bars.innerHTML = '';
      var max = Math.max.apply(null, d.series.map(function(x){ return x[metric]; }).concat([1]));
      d.series.forEach(function(x){
        var v = x[metric], pct = Math.round(v / max * 100);
        var day = new Date(x.day + 'T12:00:00Z');
        bars.appendChild(h('div', { class: 'b', title: x.day + ': ' + v }, [h('em', { text: v ? String(v) : '' }), h('i', { style: 'height:' + Math.max(pct, 1) + '%' }), h('span', { text: day.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) })]));
      });
    }
    chartCard.appendChild(h('div', { class: 'row' }, [h('div', { class: 'serif grow', style: 'font-size:18px', text: 'Last 14 days' }), pills(h, [['signups', 'Sign-ups'], ['posts', 'Posts'], ['messages', 'Messages']], metric, function(m){ metric = m; drawChart(); })]));
    chartCard.appendChild(bars); drawChart();
    body.appendChild(chartCard);
    // recent signups
    var rec = h('div', { class: 'card ulist' });
    rec.appendChild(h('div', { class: 'serif', style: 'font-size:18px;margin-bottom:6px', text: 'Newest members' }));
    if (!d.recentSignups.length) rec.appendChild(h('div', { class: 'meta', text: 'No one has signed up yet.' }));
    d.recentSignups.forEach(function(u){ rec.appendChild(h('div', { class: 'u', onclick: function(){ openUser(ctx, u.id); } }, [avatar(h, u), h('div', { class: 'grow' }, [h('div', { style: 'font-weight:600', text: u.displayName }), h('div', { class: 'meta', text: (u.handle ? '@' + u.handle + ' · ' : '') + 'joined ' + fmtWhen(u.createdAt) })])])); });
    body.appendChild(rec);
  }).catch(function(e){ body.innerHTML = ''; body.appendChild(h('div', { class: 'card', text: e.message })); });
});

// ======================= Users =======================
function openUser(ctx, id, onChange){
  var h = ctx.h;
  var ov = h('div', { class: 'overlay', onclick: function(e){ if (e.target === ov) close(); } });
  var dr = h('div', { class: 'drawer' }, [h('div', { class: 'meta', text: 'Loading…' })]);
  ov.appendChild(dr); document.body.appendChild(ov);
  function close(){ ov.remove(); if (onChange && changed) onChange(); }
  function esc(e){ if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } }
  document.addEventListener('keydown', esc);
  var changed = false;
  async function act(method, path, bodyObj, msg){
    try { await ctx.api(method, path, bodyObj); ctx.toast(msg); changed = true; load(); } catch (e) { ctx.toast(e.message, true); }
  }
  async function load(){
    var u; try { u = await ctx.api('GET', '/admin/api/users/' + id); } catch (e) { dr.innerHTML = ''; dr.appendChild(h('div', { class: 'card', text: e.message })); return; }
    dr.innerHTML = '';
    dr.appendChild(h('div', { class: 'row' }, [h('div', { class: 'grow' }), h('button', { class: 'btn small ghost', text: 'Close', onclick: close })]));
    dr.appendChild(h('div', { class: 'row', style: 'margin-top:6px' }, [avatar(h, u, ''), h('div', { class: 'grow' }, [
      h('div', { class: 'serif', style: 'font-size:24px', text: u.displayName }),
      h('div', { class: 'meta', text: [u.handle ? '@' + u.handle : null, u.church, u.country].filter(Boolean).join(' · ') || 'No details' }),
    ])]));
    dr.appendChild(h('div', { class: 'row', style: 'margin-top:10px;gap:6px' }, [
      u.role === 'admin' ? h('span', { class: 'chip', text: 'Admin' }) : null,
      u.verified ? h('span', { class: 'chip gold', text: 'Verified' }) : null,
      u.banned ? h('span', { class: 'chip neg', text: 'Banned' + (u.bannedReason ? ': ' + u.bannedReason : '') }) : null,
      h('span', { class: 'chip mut', text: 'Joined ' + fmtDate(u.createdAt) }),
      h('span', { class: 'chip mut', text: 'Last seen ' + fmtWhen(u.lastSeenAt) }),
    ]));
    if (u.headline || u.bio) dr.appendChild(h('div', { class: 'quote', text: [u.headline, u.bio].filter(Boolean).join('\\n\\n') }));
    var c = u.counts;
    dr.appendChild(h('div', { class: 'kv' }, [['Posts', c.posts], ['Comments', c.comments], ['Prayers', c.prayers], ['Messages', c.messages], ['Followers', c.followers], ['Coins', u.coins]].map(function(x){ return h('div', {}, [h('b', { text: num(x[1]) }), h('span', { text: x[0] })]); })));
    // actions
    var acts = h('div', { class: 'card' });
    acts.appendChild(h('div', { class: 'serif', style: 'font-size:17px;margin-bottom:8px', text: 'Actions' }));
    acts.appendChild(h('div', { class: 'row' }, [
      u.banned
        ? h('button', { class: 'btn small', text: 'Unban', onclick: function(){ if (confirm('Unban ' + u.displayName + '?')) act('POST', '/admin/api/users/' + u.id + '/ban', { banned: false }, 'Unbanned'); } })
        : h('button', { class: 'btn small danger', text: 'Ban', onclick: function(){ var r = prompt('Ban ' + u.displayName + '? They will be signed out of the app.\\nReason (optional, kept for the team):', ''); if (r === null) return; act('POST', '/admin/api/users/' + u.id + '/ban', { banned: true, reason: r }, 'Banned'); } }),
      h('button', { class: 'btn small ghost', text: u.verified ? 'Remove verified badge' : 'Give verified badge', onclick: function(){ act('POST', '/admin/api/users/' + u.id + '/verify', { verified: !u.verified }, u.verified ? 'Badge removed' : 'Verified'); } }),
      h('button', { class: 'btn small ghost', text: u.role === 'admin' ? 'Remove admin' : 'Make admin', onclick: function(){
        if (!confirm(u.role === 'admin' ? 'Remove admin rights from ' + u.displayName + '?' : 'Make ' + u.displayName + ' an admin? They will be able to use this dashboard.')) return;
        act('POST', '/admin/api/users/' + u.id + '/role', { role: u.role === 'admin' ? 'user' : 'admin' }, 'Role updated'); } }),
      h('button', { class: 'btn small ghost', text: 'View their content', onclick: function(){ close(); window.__adminContentAuthor = { id: u.id, displayName: u.displayName }; window.adminShow('Content'); } }),
    ]));
    var amt = h('input', { type: 'number', placeholder: '+50 or -20', style: 'width:120px' });
    var why = h('input', { placeholder: 'Reason (shown in their coin history)', class: 'grow' });
    acts.appendChild(h('label', { class: 'f', text: 'Adjust coins (they have ' + num(u.coins) + ')' }));
    acts.appendChild(h('div', { class: 'row' }, [amt, why, h('button', { class: 'btn small', text: 'Apply', onclick: function(){
      var n = parseInt(amt.value, 10); if (!n) return ctx.toast('Enter an amount like 50 or -20', true);
      if (!why.value.trim()) return ctx.toast('Add a reason', true);
      act('POST', '/admin/api/users/' + u.id + '/coins', { amount: n, reason: why.value.trim() }, (n > 0 ? 'Added ' : 'Removed ') + Math.abs(n) + ' coins'); } })]));
    dr.appendChild(acts);
    if (u.openReports.length) {
      dr.appendChild(h('div', { class: 'card' }, [h('div', { class: 'serif', style: 'font-size:17px', text: u.openReports.length + ' open report' + (u.openReports.length > 1 ? 's' : '') })].concat(u.openReports.map(function(r){ return h('div', { class: 'meta', style: 'margin-top:6px', text: r.targetType + ' · ' + (r.reason || 'no reason') + ' · ' + fmtWhen(r.createdAt) }); })).concat([h('button', { class: 'btn small ghost', style: 'margin-top:8px', text: 'Open Reports', onclick: function(){ close(); window.adminShow('Reports'); } })])));
    }
    var posts = h('div', { class: 'card' }, [h('div', { class: 'serif', style: 'font-size:17px', text: 'Recent posts' })]);
    if (!u.posts.length) posts.appendChild(h('div', { class: 'meta', text: 'No posts.' }));
    u.posts.forEach(function(p){
      posts.appendChild(h('div', { style: 'border-top:1px solid var(--border);padding:8px 0;margin-top:8px' }, [
        h('div', { class: 'row' }, [h('span', { class: 'chip mut', text: p.kind }), p.removed ? h('span', { class: 'chip neg', text: 'Removed' }) : null, h('span', { class: 'meta grow', text: fmtWhen(p.createdAt) + ' · ' + p.likes + ' likes · ' + p.comments + ' comments' }),
          p.removed ? h('button', { class: 'btn small ghost', text: 'Restore', onclick: function(){ act('POST', '/admin/api/content/posts/' + p.id + '/restore', undefined, 'Restored'); } })
                    : h('button', { class: 'btn small ghost', text: 'Remove', onclick: function(){ if (confirm('Remove this post from the app?')) act('POST', '/admin/api/content/posts/' + p.id + '/remove', undefined, 'Removed'); } })]),
        h('div', { style: 'margin-top:4px;white-space:pre-wrap', text: (p.text || '(no text)').slice(0, 400) }),
      ]));
    });
    dr.appendChild(posts);
    if (u.communities.length) dr.appendChild(h('div', { class: 'card' }, [h('div', { class: 'serif', style: 'font-size:17px;margin-bottom:6px', text: 'Communities' })].concat(u.communities.map(function(x){ return h('div', { class: 'meta', text: x.name + ' · ' + x.role }); }))));
    var led = h('div', { class: 'card' }, [h('div', { class: 'serif', style: 'font-size:17px;margin-bottom:6px', text: 'Coin history' })]);
    if (!u.coinLedger.length) led.appendChild(h('div', { class: 'meta', text: 'No coin activity.' }));
    u.coinLedger.forEach(function(l){ led.appendChild(h('div', { class: 'row', style: 'padding:3px 0' }, [h('span', { class: 'grow', text: l.reason.replace(/_/g, ' ') }), h('b', { style: 'color:' + (l.amount < 0 ? 'var(--neg)' : 'var(--pos)'), text: (l.amount > 0 ? '+' : '') + l.amount }), h('span', { class: 'meta', text: fmtDate(l.createdAt) })])); });
    dr.appendChild(led);
  }
  load();
}
window.adminOpenUser = function(id){ openUser({ api: window.adminApi, toast: window.adminToast, h: window.adminH }, id); };

window.registerAdminTab('Users', function(box, ctx){
  var h = ctx.h;
  var st = { q: '', filter: 'all', next: null };
  box.appendChild(h('h2', { class: 'serif', text: 'Users' }));
  box.appendChild(h('p', { class: 'sub', text: 'Search by name, @handle, church or Clerk user id. Click someone to see their details and actions.' }));
  var search = h('input', { placeholder: 'Search people…', class: 'grow', style: 'min-width:240px' });
  var tm; search.addEventListener('input', function(){ clearTimeout(tm); tm = setTimeout(function(){ st.q = search.value.trim(); load(true); }, 300); });
  box.appendChild(h('div', { class: 'card' }, [h('div', { class: 'row' }, [search])]));
  box.appendChild(pills(h, [['all', 'All'], ['reported', 'Reported'], ['banned', 'Banned'], ['admins', 'Admins'], ['verified', 'Verified']], st.filter, function(f){ st.filter = f; load(true); }));
  var list = h('div', { class: 'card ulist' }); box.appendChild(list);
  var more = h('div'); box.appendChild(more);
  async function load(reset){
    if (reset) { st.next = null; list.innerHTML = '<div class="meta">Loading…</div>'; }
    var url = '/admin/api/users?filter=' + st.filter + '&q=' + encodeURIComponent(st.q) + (st.next ? '&before=' + encodeURIComponent(st.next) : '');
    var d; try { d = await ctx.api('GET', url); } catch (e) { list.textContent = e.message; return; }
    if (reset) list.innerHTML = '';
    if (reset && !d.items.length) list.appendChild(h('div', { class: 'empty' }, [h('span', { class: 'serif', text: 'No one found' }), 'Try another search or filter.']));
    d.items.forEach(function(u){
      list.appendChild(h('div', { class: 'u', onclick: function(){ openUser(ctx, u.id, function(){ load(true); }); } }, [
        avatar(h, u),
        h('div', { class: 'grow' }, [
          h('div', { class: 'row', style: 'gap:6px' }, [h('b', { text: u.displayName }), u.role === 'admin' ? h('span', { class: 'chip', text: 'Admin' }) : null, u.verified ? h('span', { class: 'chip gold', text: 'Verified' }) : null, u.banned ? h('span', { class: 'chip neg', text: 'Banned' }) : null, u.openReports ? h('span', { class: 'chip neg', text: u.openReports + ' report' + (u.openReports > 1 ? 's' : '') }) : null]),
          h('div', { class: 'meta', text: [u.handle ? '@' + u.handle : null, u.church, 'joined ' + fmtDate(u.createdAt), 'seen ' + fmtWhen(u.lastSeenAt)].filter(Boolean).join(' · ') }),
        ]),
        h('div', { class: 'meta', style: 'text-align:right' }, [h('div', { text: num(u.posts) + ' posts' }), h('div', { text: num(u.coins) + ' coins' })]),
      ]));
    });
    st.next = d.next; more.innerHTML = '';
    if (d.next) more.appendChild(loadMoreBtn(h, function(){ load(false); }));
  }
  load(true);
});

// ======================= Content =======================
window.registerAdminTab('Content', function(box, ctx){
  var h = ctx.h;
  var author = window.__adminContentAuthor || null; window.__adminContentAuthor = null;
  var st = { type: 'posts', status: 'all', q: '', kind: '', next: null };
  box.appendChild(h('h2', { class: 'serif', text: 'Content' }));
  box.appendChild(h('p', { class: 'sub', text: 'Everything people post. Removing a post or prayer hides it in the app (you can restore it); removing a comment deletes it. Removing also resolves its open reports.' }));
  var authorBar = h('div');
  function drawAuthor(){ authorBar.innerHTML = ''; if (author) authorBar.appendChild(h('div', { class: 'card row' }, [h('span', { class: 'grow', text: 'Showing content by ' + author.displayName }), h('button', { class: 'btn small ghost', text: 'Show everyone', onclick: function(){ author = null; drawAuthor(); load(true); } })])); }
  box.appendChild(authorBar); drawAuthor();
  box.appendChild(pills(h, [['posts', 'Posts & videos'], ['comments', 'Comments'], ['prayers', 'Prayer requests']], st.type, function(t){ st.type = t; kindSel.style.display = t === 'posts' ? '' : 'none'; load(true); }));
  var search = h('input', { placeholder: 'Search text or author…', class: 'grow', style: 'min-width:220px' });
  var tm; search.addEventListener('input', function(){ clearTimeout(tm); tm = setTimeout(function(){ st.q = search.value.trim(); load(true); }, 300); });
  var kindSel = h('select', { onchange: function(){ st.kind = kindSel.value; load(true); } }, [['', 'All kinds'], ['Reflection', 'Reflection'], ['Video', 'Video'], ['Photo', 'Photo'], ['Prayer', 'Prayer'], ['Testimony', 'Testimony'], ['Verse', 'Verse'], ['Study', 'Study'], ['Announcement', 'Announcement'], ['Event', 'Event']].map(function(o){ return h('option', { value: o[0], text: o[1] }); }));
  box.appendChild(h('div', { class: 'card' }, [h('div', { class: 'row' }, [search, kindSel])]));
  box.appendChild(pills(h, [['all', 'All'], ['reported', 'Reported'], ['visible', 'Visible'], ['removed', 'Removed']], st.status, function(s){ st.status = s; load(true); }));
  var list = h('div'); box.appendChild(list);
  var more = h('div'); box.appendChild(more);
  async function act(item, what){
    var label = item.type === 'comments' ? 'Delete this comment permanently?' : 'Remove this from the app? You can restore it later.';
    if (what === 'remove' && !confirm(label)) return;
    try { await ctx.api('POST', '/admin/api/content/' + item.type + '/' + item.id + '/' + what); ctx.toast(what === 'remove' ? (item.type === 'comments' ? 'Comment deleted' : 'Removed') : 'Restored'); load(true); }
    catch (e) { ctx.toast(e.message, true); }
  }
  async function load(reset){
    if (reset) { st.next = null; list.innerHTML = '<div class="meta">Loading…</div>'; }
    var url = '/admin/api/content/' + st.type + '?status=' + st.status + '&q=' + encodeURIComponent(st.q) + (st.kind && st.type === 'posts' ? '&kind=' + encodeURIComponent(st.kind) : '') + (author ? '&authorId=' + author.id : '') + (st.next ? '&before=' + encodeURIComponent(st.next) : '');
    var d; try { d = await ctx.api('GET', url); } catch (e) { list.textContent = e.message; return; }
    if (reset) list.innerHTML = '';
    if (reset && !d.items.length) list.appendChild(h('div', { class: 'card empty' }, [h('span', { class: 'serif', text: 'Nothing here' }), 'No content matches these filters.']));
    d.items.forEach(function(it){
      var stats = it.type === 'posts' ? num(it.likes) + ' likes · ' + num(it.comments) + ' comments' + (it.hasVideo ? ' · video' : '') + (it.photos ? ' · ' + it.photos + ' photo' + (it.photos > 1 ? 's' : '') : '')
        : it.type === 'prayers' ? num(it.praying) + ' praying' + (it.anonymous ? ' · posted anonymously' : '') : (it.postText ? 'On: “' + it.postText + '”' : '');
      list.appendChild(h('div', { class: 'card', style: it.removed ? 'opacity:.7' : '' }, [
        h('div', { class: 'row', style: 'gap:6px' }, [
          h('span', { class: 'chip mut', text: it.kind }),
          it.removed ? h('span', { class: 'chip neg', text: 'Removed' }) : null,
          it.openReports ? h('span', { class: 'chip neg', text: it.openReports + ' report' + (it.openReports > 1 ? 's' : '') }) : null,
          h('a', { href: '#', class: 'grow', text: it.author.displayName + (it.author.banned ? ' (banned)' : ''), onclick: function(e){ e.preventDefault(); openUser(ctx, it.author.id, function(){ load(true); }); } }),
          h('span', { class: 'meta', text: fmtWhen(it.createdAt) }),
        ]),
        h('div', { class: 'quote', text: (it.text || '(no text)').slice(0, 1500) }),
        h('div', { class: 'row' }, [h('span', { class: 'meta grow', text: stats }),
          it.removed ? (it.type !== 'comments' ? h('button', { class: 'btn small ghost', text: 'Restore', onclick: function(){ act(it, 'restore'); } }) : null)
                     : h('button', { class: 'btn small danger', text: it.type === 'comments' ? 'Delete' : 'Remove', onclick: function(){ act(it, 'remove'); } })]),
      ]));
    });
    st.next = d.next; more.innerHTML = '';
    if (d.next) more.appendChild(loadMoreBtn(h, function(){ load(false); }));
  }
  load(true);
});

// ======================= Communities & events =======================
window.registerAdminTab('Communities & events', function(box, ctx){
  var h = ctx.h;
  var view = 'communities';
  box.appendChild(h('h2', { class: 'serif', text: 'Communities & events' }));
  box.appendChild(h('p', { class: 'sub', text: 'Verify trusted communities, hide ones that break the rules (members keep access; nobody new can find or join), change owners, and remove events.' }));
  box.appendChild(pills(h, [['communities', 'Communities'], ['upcoming', 'Upcoming events'], ['past', 'Past events']], view, function(v){ view = v; draw(); }));
  var panel = h('div'); box.appendChild(panel);
  function draw(){ panel.innerHTML = ''; if (view === 'communities') communities(); else events(view); }

  function communities(){
    var st = { q: '', filter: 'all' };
    var search = h('input', { placeholder: 'Search name, description or owner…', class: 'grow', style: 'min-width:220px' });
    var tm; search.addEventListener('input', function(){ clearTimeout(tm); tm = setTimeout(function(){ st.q = search.value.trim(); load(); }, 300); });
    panel.appendChild(h('div', { class: 'card' }, [h('div', { class: 'row' }, [search])]));
    panel.appendChild(pills(h, [['all', 'All'], ['verified', 'Verified'], ['hidden', 'Hidden'], ['private', 'Private']], st.filter, function(f){ st.filter = f; load(); }));
    var list = h('div'); panel.appendChild(list);
    async function patch(cm, b, msg){ try { await ctx.api('PATCH', '/admin/api/communities/' + cm.id, b); ctx.toast(msg); load(); } catch (e) { ctx.toast(e.message, true); } }
    async function changeOwner(cm, row){
      var d; try { d = await ctx.api('GET', '/admin/api/communities/' + cm.id + '/members'); } catch (e) { return ctx.toast(e.message, true); }
      var others = d.items.filter(function(m){ return m.role !== 'owner'; });
      if (!others.length) return ctx.toast('This community has no other members yet', true);
      var sel = h('select', {}, others.map(function(m){ return h('option', { value: m.id, text: m.displayName + (m.handle ? ' @' + m.handle : '') + (m.role === 'admin' ? ' (admin)' : '') }); }));
      var go = h('button', { class: 'btn small', text: 'Make owner', onclick: async function(){
        if (!confirm('Make ' + sel.options[sel.selectedIndex].text + ' the owner of ' + cm.name + '? The current owner becomes an admin.')) return;
        try { await ctx.api('POST', '/admin/api/communities/' + cm.id + '/owner', { userId: sel.value }); ctx.toast('Owner changed'); load(); } catch (e) { ctx.toast(e.message, true); } } });
      row.appendChild(h('div', { class: 'row', style: 'margin-top:10px' }, [h('span', { class: 'meta', text: 'New owner' }), sel, go]));
    }
    async function del(cm){
      var typed = prompt('This permanently deletes “' + cm.name + '”, its channels, messages and events.\\nType the community name to confirm:');
      if (typed === null) return;
      try { await ctx.api('DELETE', '/admin/api/communities/' + cm.id, { confirmName: typed }); ctx.toast('Community deleted'); load(); } catch (e) { ctx.toast(e.message, true); }
    }
    async function load(){
      list.innerHTML = '<div class="meta">Loading…</div>';
      var d; try { d = await ctx.api('GET', '/admin/api/communities?filter=' + st.filter + '&q=' + encodeURIComponent(st.q)); } catch (e) { list.textContent = e.message; return; }
      list.innerHTML = '';
      if (!d.items.length) list.appendChild(h('div', { class: 'card empty' }, [h('span', { class: 'serif', text: 'No communities' }), 'Nothing matches these filters.']));
      d.items.forEach(function(cm){
        var actions = h('div', { class: 'row', style: 'margin-top:10px' }, [
          h('button', { class: 'btn small ' + (cm.verified ? 'ghost' : ''), text: cm.verified ? 'Remove verified' : 'Verify', onclick: function(){ patch(cm, { verified: !cm.verified }, cm.verified ? 'Badge removed' : 'Verified'); } }),
          h('button', { class: 'btn small ghost', text: cm.hidden ? 'Unhide' : 'Hide', onclick: function(){ if (!cm.hidden && !confirm('Hide “' + cm.name + '”? Members keep access, but nobody new can find or join it.')) return; patch(cm, { hidden: !cm.hidden }, cm.hidden ? 'Visible again' : 'Hidden'); } }),
          h('button', { class: 'btn small ghost', text: 'Change owner', onclick: function(){ changeOwner(cm, card); } }),
          h('div', { class: 'grow' }),
          h('button', { class: 'btn small danger', text: 'Delete', onclick: function(){ del(cm); } }),
        ]);
        var card = h('div', { class: 'card', style: cm.hidden ? 'opacity:.75' : '' }, [
          h('div', { class: 'row', style: 'gap:6px' }, [h('b', { class: 'serif', style: 'font-size:18px', text: cm.name }), cm.verified ? h('span', { class: 'chip gold', text: 'Verified' }) : null, cm.hidden ? h('span', { class: 'chip neg', text: 'Hidden' }) : null, h('span', { class: 'chip mut', text: cm.privacy })]),
          cm.description ? h('div', { class: 'meta', style: 'margin-top:4px', text: cm.description.slice(0, 240) }) : null,
          h('div', { class: 'meta', style: 'margin-top:6px' }, [
            num(cm.members) + ' members · ' + num(cm.messages7d) + ' messages this week · ' + num(cm.upcomingEvents) + ' upcoming events · owner ',
            cm.owner ? h('a', { href: '#', text: cm.owner.displayName, onclick: function(e){ e.preventDefault(); openUser(ctx, cm.owner.id); } }) : 'none',
            ' · created ' + fmtDate(cm.createdAt),
          ]),
          actions,
        ]);
        list.appendChild(card);
      });
    }
    load();
  }

  function events(when){
    var list = h('div', {}, [h('div', { class: 'meta', text: 'Loading…' })]); panel.appendChild(list);
    ctx.api('GET', '/admin/api/events?when=' + when).then(function(d){
      list.innerHTML = '';
      if (!d.items.length) list.appendChild(h('div', { class: 'card empty' }, [h('span', { class: 'serif', text: when === 'past' ? 'No past events' : 'No upcoming events' })]));
      d.items.forEach(function(ev){
        list.appendChild(h('div', { class: 'card' }, [
          h('div', { class: 'row' }, [h('b', { class: 'serif grow', style: 'font-size:17px', text: ev.title }), h('span', { class: 'chip', text: new Date(ev.startsAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) })]),
          ev.description ? h('div', { class: 'meta', style: 'margin-top:4px', text: ev.description.slice(0, 240) }) : null,
          h('div', { class: 'row', style: 'margin-top:8px' }, [
            h('span', { class: 'meta grow', text: [ev.community ? ev.community.name : null, ev.host ? 'host ' + ev.host.displayName : null, ev.location || (ev.onlineUrl ? 'Online' : null), num(ev.going) + ' going'].filter(Boolean).join(' · ') }),
            h('button', { class: 'btn small danger', text: 'Remove event', onclick: async function(){
              var r = prompt('Remove “' + ev.title + '”? The host and everyone who RSVP’d get an in-app notice.\\nMessage for them (optional):', '');
              if (r === null) return;
              try { var res = await ctx.api('DELETE', '/admin/api/events/' + ev.id, { reason: r }); ctx.toast('Removed · ' + res.notified + ' notified'); draw(); } catch (e) { ctx.toast(e.message, true); } } }),
          ]),
        ]));
      });
    }).catch(function(e){ list.textContent = e.message; });
  }
  draw();
});

// ======================= Announcements =======================
window.registerAdminTab('Announcements', function(box, ctx){
  var h = ctx.h;
  var editing = null;
  box.appendChild(h('h2', { class: 'serif', text: 'Announcements' }));
  box.appendChild(h('p', { class: 'sub', text: 'A card at the top of everyone’s Today screen. Up to 3 show at once (urgent first). People can dismiss a card on their phone.' }));
  var KINDS = [['info', 'General'], ['verse', 'Verse of the day'], ['event', 'Event'], ['update', 'App update'], ['urgent', 'Urgent']];
  var f = {
    kind: h('select', {}, KINDS.map(function(k){ return h('option', { value: k[0], text: k[1] }); })),
    title: h('input', { maxlength: '120', placeholder: 'e.g. Join our Advent reading plan', style: 'width:100%' }),
    body: h('textarea', { maxlength: '1000', placeholder: 'A short message (optional)' }),
    verse: h('input', { maxlength: '60', placeholder: 'e.g. Isaiah 9:6 (optional)', style: 'width:100%' }),
    link: h('input', { maxlength: '500', placeholder: 'https://… (optional “Learn more” link)', style: 'width:100%' }),
    start: h('input', { type: 'datetime-local' }),
    end: h('input', { type: 'datetime-local' }),
    notify: h('input', { type: 'checkbox' }),
  };
  var prev = h('div', { class: 'preview' });
  function drawPreview(){
    prev.className = 'preview' + (f.kind.value === 'urgent' ? ' urgent' : '');
    prev.innerHTML = '';
    prev.appendChild(h('div', { class: 'eyebrow', style: 'color:' + (f.kind.value === 'urgent' ? 'var(--neg)' : 'var(--gold)'), text: (KINDS.find(function(k){ return k[0] === f.kind.value; }) || KINDS[0])[1] }));
    prev.appendChild(h('div', { class: 't', text: f.title.value || 'Your title' }));
    if (f.body.value) prev.appendChild(h('div', { style: 'white-space:pre-wrap;color:var(--muted)', text: f.body.value }));
    if (f.verse.value) prev.appendChild(h('div', { class: 'meta', style: 'margin-top:6px;color:var(--gold);font-weight:700', text: f.verse.value }));
    if (f.link.value) prev.appendChild(h('div', { style: 'margin-top:8px;color:var(--primary);font-weight:700', text: 'Learn more →' }));
  }
  ['kind', 'title', 'body', 'verse', 'link'].forEach(function(k){ f[k].addEventListener('input', drawPreview); f[k].addEventListener('change', drawPreview); });
  var formTitle = h('div', { class: 'serif', style: 'font-size:18px', text: 'New announcement' });
  var save = h('button', { class: 'btn', text: 'Publish' });
  var cancel = h('button', { class: 'btn ghost', text: 'Cancel edit', style: 'display:none' });
  var notifyRow = h('label', { class: 'row', style: 'gap:8px;margin-top:12px' }, [f.notify, 'Also add it to everyone’s notifications (bell)']);
  function toLocal(s){ if (!s) return ''; var d = new Date(s); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); }
  function resetForm(){ editing = null; f.kind.value = 'info'; f.title.value = ''; f.body.value = ''; f.verse.value = ''; f.link.value = ''; f.start.value = ''; f.end.value = ''; f.notify.checked = false; formTitle.textContent = 'New announcement'; save.textContent = 'Publish'; cancel.style.display = 'none'; notifyRow.style.display = ''; drawPreview(); }
  cancel.onclick = resetForm;
  save.onclick = async function(){
    if (!f.title.value.trim()) { f.title.focus(); return ctx.toast('Add a title', true); }
    var payload = { kind: f.kind.value, title: f.title.value.trim(), body: f.body.value, verseRef: f.verse.value.trim() || null, linkUrl: f.link.value.trim() || null,
      startsAt: f.start.value ? new Date(f.start.value).toISOString() : (editing ? undefined : null), endsAt: f.end.value ? new Date(f.end.value).toISOString() : null };
    save.disabled = true;
    try {
      if (editing) { await ctx.api('PATCH', '/admin/api/announcements/' + editing, payload); ctx.toast('Saved'); }
      else { payload.notifyAll = f.notify.checked; var r = await ctx.api('POST', '/admin/api/announcements', payload); ctx.toast('Published' + (r.notified ? ' · sent to ' + r.notified + ' bells' : '')); }
      resetForm(); load();
    } catch (e) { ctx.toast(e.message, true); }
    save.disabled = false;
  };
  box.appendChild(h('div', { class: 'two' }, [
    h('div', { class: 'card' }, [formTitle,
      h('label', { class: 'f', text: 'Type' }), f.kind,
      h('label', { class: 'f', text: 'Title' }), f.title,
      h('label', { class: 'f', text: 'Message' }), f.body,
      h('label', { class: 'f', text: 'Bible verse' }), f.verse,
      h('label', { class: 'f', text: 'Link' }), f.link,
      h('div', { class: 'row', style: 'margin-top:4px' }, [h('div', { class: 'grow' }, [h('label', { class: 'f', text: 'Show from (empty = now)' }), f.start]), h('div', { class: 'grow' }, [h('label', { class: 'f', text: 'Until (empty = until turned off)' }), f.end])]),
      notifyRow,
      h('div', { class: 'row', style: 'margin-top:14px' }, [save, cancel]),
    ]),
    h('div', {}, [h('div', { class: 'eyebrow', style: 'color:var(--muted);margin:4px 0 8px', text: 'Preview in the app' }), prev]),
  ]));
  var list = h('div', { style: 'margin-top:14px' }); box.appendChild(list);
  function status(a){ var now = Date.now(); if (!a.active) return ['Off', 'mut']; if (new Date(a.startsAt).getTime() > now) return ['Scheduled', 'gold']; if (a.endsAt && new Date(a.endsAt).getTime() <= now) return ['Ended', 'mut']; return ['Live', '']; }
  async function load(){
    list.innerHTML = '<div class="meta">Loading…</div>';
    var d; try { d = await ctx.api('GET', '/admin/api/announcements'); } catch (e) { list.textContent = e.message; return; }
    list.innerHTML = '';
    if (!d.items.length) list.appendChild(h('div', { class: 'card empty' }, [h('span', { class: 'serif', text: 'No announcements yet' }), 'Publish one above and it appears on everyone’s Today screen.']));
    d.items.forEach(function(a){
      var s = status(a);
      list.appendChild(h('div', { class: 'card' }, [
        h('div', { class: 'row', style: 'gap:6px' }, [h('span', { class: 'chip ' + s[1], text: s[0] }), h('span', { class: 'chip mut', text: (KINDS.find(function(k){ return k[0] === a.kind; }) || KINDS[0])[1] }), h('b', { class: 'grow', text: a.title }),
          h('span', { class: 'meta', text: fmtDate(a.startsAt) + (a.endsAt ? ' → ' + fmtDate(a.endsAt) : '') })]),
        a.body ? h('div', { class: 'meta', style: 'margin-top:6px;white-space:pre-wrap', text: a.body.slice(0, 300) }) : null,
        h('div', { class: 'row', style: 'margin-top:10px' }, [
          h('button', { class: 'btn small ghost', text: 'Edit', onclick: function(){ editing = a.id; f.kind.value = a.kind; f.title.value = a.title; f.body.value = a.body || ''; f.verse.value = a.verseRef || ''; f.link.value = a.linkUrl || ''; f.start.value = toLocal(a.startsAt); f.end.value = toLocal(a.endsAt); formTitle.textContent = 'Edit announcement'; save.textContent = 'Save changes'; cancel.style.display = ''; notifyRow.style.display = 'none'; drawPreview(); window.scrollTo({ top: 0, behavior: 'smooth' }); } }),
          h('button', { class: 'btn small ghost', text: a.active ? 'Turn off' : 'Turn on', onclick: async function(){ try { await ctx.api('PATCH', '/admin/api/announcements/' + a.id, { active: !a.active }); ctx.toast(a.active ? 'Turned off' : 'Turned on'); load(); } catch (e) { ctx.toast(e.message, true); } } }),
          h('div', { class: 'grow' }),
          h('button', { class: 'btn small danger', text: 'Delete', onclick: async function(){ if (!confirm('Delete “' + a.title + '”?')) return; try { await ctx.api('DELETE', '/admin/api/announcements/' + a.id); ctx.toast('Deleted'); load(); } catch (e) { ctx.toast(e.message, true); } } }),
        ]),
      ]));
    });
  }
  resetForm(); load();
});
})();
`;
