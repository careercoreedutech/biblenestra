// The admin dashboard page (served by GET /admin). One self-contained HTML document in the BibleNestra
// "Sanctuary Paper" style. Sign-in: Clerk's frontend JS (CLERK_PUBLISHABLE_KEY) or, when AUTH_DEV_MODE=true,
// a dev-user box (X-Dev-User). Every action calls /admin/api/*, which checks role = 'admin' on the server.
// NOTE: the client script below avoids backticks and "${" because it lives inside a JS template string.

const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c').split(String.fromCharCode(0x2028)).join('\\u2028').split(String.fromCharCode(0x2029)).join('\\u2029');
const scriptSafe = (s) => String(s).replace(/<\/script/gi, '<\\/script');

function clerkScriptSrc(pk) {
  try {
    const part = String(pk).split('_')[2] || '';
    const host = atob(part).replace(/\$$/, '');
    if (!/^[a-z0-9.-]+$/i.test(host)) return null;
    return `https://${host}/npm/@clerk/clerk-js@5/dist/clerk.browser.js`;
  } catch (e) { return null; }
}

const CSS = `
:root{--screen:#F6F2EA;--surface:#fff;--raised:#F0EBE1;--border:#E7DFD1;--fg:#1C1915;--muted:#6B6255;--faint:#A1978A;
--primary:#2E3A87;--primarySoft:#E7E9F5;--gold:#A87A27;--goldLight:#D4A852;--night:#15172B;--nightFg:#F4EFE6;--neg:#B83A3A;--pos:#3E7B57;--rose:#B0475C}
*{box-sizing:border-box}html,body{margin:0;background:var(--screen);color:var(--fg);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.serif{font-family:Newsreader,Georgia,serif;font-weight:600;letter-spacing:-.3px}
header{background:var(--night);color:var(--nightFg);padding:22px 28px 18px;display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap}
header h1{margin:2px 0 0;font-size:28px}.eyebrow{font-size:10.5px;font-weight:700;letter-spacing:1.3px;text-transform:uppercase;color:var(--goldLight)}
header .who{margin-left:auto;font-size:13px;color:rgba(244,239,230,.7);display:flex;gap:10px;align-items:center}
main{max-width:1120px;margin:0 auto;padding:22px 20px 80px}
nav.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 20px}
nav.tabs button{border:1px solid var(--border);background:var(--surface);color:var(--fg);padding:8px 16px;border-radius:999px;font-weight:600;cursor:pointer}
nav.tabs button.on{background:var(--fg);color:var(--screen);border-color:var(--fg)}
.card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:16px 18px;box-shadow:0 1px 2px rgba(59,47,30,.06);margin-bottom:12px}
.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.grow{flex:1;min-width:0}
h2{font-size:22px;margin:0 0 4px}.sub{color:var(--muted);margin:0 0 16px}
input,select{border:1px solid var(--border);background:var(--raised);border-radius:10px;padding:9px 12px;font:inherit;color:var(--fg)}
input[type=checkbox]{width:16px;height:16px;accent-color:var(--primary)}
.btn{border:0;border-radius:999px;padding:9px 16px;font-weight:600;cursor:pointer;background:var(--primary);color:#fff;font:inherit;font-weight:600}
.btn.ghost{background:var(--surface);color:var(--fg);border:1px solid var(--border)}.btn.danger{background:var(--neg)}
.btn.small{padding:6px 12px;font-size:12.5px}.btn:disabled{opacity:.5;cursor:default}
.avatar{width:44px;height:44px;border-radius:50%;background:var(--raised);object-fit:cover;flex:none}
.chip{display:inline-block;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;background:var(--primarySoft);color:var(--primary)}
.chip.gold{background:#F5EBD7;color:var(--gold)}.chip.neg{background:rgba(184,58,58,.11);color:var(--neg)}.chip.mut{background:var(--raised);color:var(--muted)}
.meta{color:var(--faint);font-size:12.5px}.quote{background:var(--raised);border-radius:12px;padding:10px 12px;margin:10px 0;white-space:pre-wrap;word-break:break-word}
.empty{text-align:center;color:var(--muted);padding:34px 10px}.empty .serif{font-size:20px;color:var(--fg);display:block;margin-bottom:6px}
#toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:var(--night);color:var(--nightFg);padding:10px 18px;border-radius:999px;opacity:0;transition:opacity .2s;pointer-events:none;font-weight:600}
#toast.on{opacity:1}#toast.err{background:var(--neg)}
.signin{max-width:420px;margin:60px auto}.signin .card{padding:24px}
a{color:var(--primary);text-decoration:none;font-weight:600}a:hover{text-decoration:underline}
code{background:var(--raised);padding:2px 6px;border-radius:6px;font-size:12.5px}
.ext{border:2px dashed var(--border);border-radius:16px;padding:26px;text-align:center;color:var(--muted)}
`;

const SCRIPT = `
(function(){
var CFG = window.__ADMIN__ || {};
var app = document.getElementById('app');
var who = document.getElementById('who');
var tabs = [];          // { name, render }
var current = null;
var getToken = null;    // async () => token (Clerk)

function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function h(tag, attrs, kids){
  var el = document.createElement(tag);
  Object.keys(attrs || {}).forEach(function(k){
    var v = attrs[k];
    if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v;
    else if (k.slice(0,2) === 'on') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, ''); else if (v !== false && v != null) el.setAttribute(k, v);
  });
  (kids || []).forEach(function(k){ if (k != null) el.appendChild(typeof k === 'string' ? document.createTextNode(k) : k); });
  return el;
}
var toastT;
function toast(msg, err){ var t = document.getElementById('toast'); t.textContent = msg; t.className = 'on' + (err ? ' err' : ''); clearTimeout(toastT); toastT = setTimeout(function(){ t.className = ''; }, 2600); }

async function api(method, path, body){
  var headers = { 'Accept': 'application/json' };
  var adminTk = localStorage.getItem('bnAdminToken');
  if (adminTk) headers['Authorization'] = 'Bearer ' + adminTk;
  else if (CFG.devMode && localStorage.getItem('bnAdminDevUser')) headers['X-Dev-User'] = localStorage.getItem('bnAdminDevUser');
  else if (getToken) { var tk = await getToken(); if (tk) headers['Authorization'] = 'Bearer ' + tk; }
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  var res = await fetch(path, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) });
  var data = null; try { data = await res.json(); } catch (e) {}
  if (!res.ok) { var err = new Error((data && data.error) || ('Request failed (' + res.status + ')')); err.code = data && data.code; err.status = res.status; throw err; }
  return data;
}
window.adminApi = api;

// Extension point for other areas (e.g. Fund Me approvals)
window.registerAdminTab = function(name, render){
  var t = tabs.find(function(x){ return x.name === name; });
  if (t) t.render = render; else tabs.push({ name: name, render: render });
  if (current) { drawTabs(); if (current === name) show(name); }
};

// ROUND 5: tab order + helpers other tab scripts can use
var tabOrder = [];
window.setAdminTabOrder = function(order){ tabOrder = order || []; sortTabs(); if (current) drawTabs(); };
function sortTabs(){
  var rank = function(n){ var i = tabOrder.indexOf(n); return i === -1 ? 999 : i; };
  tabs.sort(function(a, b){ return rank(a.name) - rank(b.name); });
}
window.adminToast = function(m, e){ toast(m, e); };
window.adminH = function(t, a, k){ return h(t, a, k); };
window.adminShow = function(name){ if (tabs.some(function(t){ return t.name === name; })) { show(name); window.scrollTo(0, 0); } };

function drawTabs(){
  sortTabs();
  var nav = document.getElementById('tabs');
  if (!nav) return;
  nav.innerHTML = '';
  tabs.forEach(function(t){ nav.appendChild(h('button', { class: t.name === current ? 'on' : '', text: t.name, onclick: function(){ show(t.name); } })); });
}
function show(name){
  current = name; drawTabs();
  var box = document.getElementById('panel'); box.innerHTML = '';
  var t = tabs.find(function(x){ return x.name === name; });
  try { t.render(box, { api: api, toast: toast, esc: esc, h: h }); } catch (e) { box.appendChild(h('div', { class: 'card', text: 'This tab failed to load: ' + e.message })); }
  try { history.replaceState(null, '', '#' + encodeURIComponent(name)); } catch (e) {}
}

// ---------- YouTube channels ----------
var CATS = ['Sermons','Worship','Bible study','Kids','Podcasts','Live services','Testimonies','Other'];
function youtubeTab(box){
  box.appendChild(h('h2', { class: 'serif', text: 'YouTube channels' }));
  box.appendChild(h('p', { class: 'sub', text: 'Channels shown in the app’s Watch section. Paste a channel link, an @handle or a channel id (UC…). Videos come from YouTube’s public feed.' }));
  var input = h('input', { placeholder: 'https://www.youtube.com/@channel  ·  @handle  ·  UC…', class: 'grow', style: 'min-width:260px' });
  var cat = h('select', {}, CATS.map(function(c){ return h('option', { value: c, text: c }); }));
  var feat = h('input', { type: 'checkbox' });
  var add = h('button', { class: 'btn', text: 'Add channel' });
  box.appendChild(h('div', { class: 'card' }, [h('div', { class: 'row' }, [input, cat, h('label', { class: 'row', style: 'gap:6px' }, [feat, 'Featured']), add])]));
  var list = h('div'); box.appendChild(list);
  add.onclick = async function(){
    if (!input.value.trim()) { input.focus(); return; }
    add.disabled = true; add.textContent = 'Looking up…';
    try { var ch = await api('POST', '/admin/api/youtube/channels', { input: input.value.trim(), category: cat.value, featured: feat.checked }); toast('Added ' + ch.title); input.value = ''; feat.checked = false; load(); }
    catch (e) { toast(e.message, true); }
    add.disabled = false; add.textContent = 'Add channel';
  };
  async function load(){
    list.innerHTML = '<div class="meta">Loading…</div>';
    var data; try { data = await api('GET', '/admin/api/youtube/channels'); } catch (e) { list.textContent = e.message; return; }
    list.innerHTML = '';
    if (!data.items.length) { list.appendChild(h('div', { class: 'card empty' }, [h('span', { class: 'serif', text: 'No channels yet' }), 'The app shows “Channels coming soon” until you add one.'])); return; }
    data.items.forEach(function(ch){
      var title = h('input', { value: ch.title, style: 'width:100%' });
      var c2 = h('select', {}, CATS.map(function(c){ return h('option', { value: c, text: c, selected: c === ch.category }); }));
      var order = h('input', { type: 'number', value: ch.sortOrder, style: 'width:76px', title: 'Order (lower first)' });
      var f2 = h('input', { type: 'checkbox', checked: ch.featured });
      var save = h('button', { class: 'btn small', text: 'Save' });
      var toggle = h('button', { class: 'btn small ghost', text: ch.active ? 'Deactivate' : 'Activate' });
      var del = h('button', { class: 'btn small danger', text: 'Delete' });
      save.onclick = async function(){ try { await api('PATCH', '/admin/api/youtube/channels/' + ch.id, { title: title.value, category: c2.value, featured: f2.checked, sortOrder: Number(order.value) || 0 }); toast('Saved'); load(); } catch (e) { toast(e.message, true); } };
      toggle.onclick = async function(){ try { await api('PATCH', '/admin/api/youtube/channels/' + ch.id, { active: !ch.active }); toast(ch.active ? 'Hidden from the app' : 'Visible in the app'); load(); } catch (e) { toast(e.message, true); } };
      del.onclick = async function(){ if (!confirm('Delete “' + ch.title + '”?')) return; try { await api('DELETE', '/admin/api/youtube/channels/' + ch.id); toast('Deleted'); load(); } catch (e) { toast(e.message, true); } };
      list.appendChild(h('div', { class: 'card' + (ch.active ? '' : ' inactive'), style: ch.active ? '' : 'opacity:.62' }, [
        h('div', { class: 'row' }, [
          ch.avatarUrl ? h('img', { class: 'avatar', src: ch.avatarUrl, alt: '' }) : h('div', { class: 'avatar' }),
          h('div', { class: 'grow' }, [title, h('div', { class: 'meta', style: 'margin-top:4px' }, [h('a', { href: ch.url, target: '_blank', rel: 'noopener', text: ch.handle ? '@' + ch.handle : ch.channelId }), ' · ' + ch.channelId + ' ', ch.featured ? h('span', { class: 'chip gold', text: 'Featured' }) : null, ' ', ch.active ? null : h('span', { class: 'chip mut', text: 'Hidden' })])]),
        ]),
        h('div', { class: 'row', style: 'margin-top:12px' }, [c2, h('label', { class: 'row', style: 'gap:6px' }, [f2, 'Featured']), h('label', { class: 'row meta', style: 'gap:6px' }, ['Order', order]), h('div', { class: 'grow' }), save, toggle, del]),
      ]));
    });
  }
  load();
}

// ---------- Reports ----------
function reportsTab(box){
  box.appendChild(h('h2', { class: 'serif', text: 'Reports queue' }));
  box.appendChild(h('p', { class: 'sub', text: 'Content people reported in the app. Removing or banning resolves every open report on the same item.' }));
  var state = { status: 'open' };
  var pills = h('div', { class: 'row', style: 'margin-bottom:14px' });
  var list = h('div');
  box.appendChild(pills); box.appendChild(list);
  function drawPills(){ pills.innerHTML = ''; ['open','resolved'].forEach(function(s){ pills.appendChild(h('button', { class: 'btn small ' + (state.status === s ? '' : 'ghost'), text: s === 'open' ? 'Open' : 'Resolved', onclick: function(){ state.status = s; drawPills(); load(); } })); }); }
  async function act(rep, what){
    if (what === 'ban' && !confirm('Ban ' + ((rep.target && rep.target.authorName) || 'this user') + '? They will no longer be able to use the app.')) return;
    try { await api('POST', '/admin/api/reports/' + rep.id + '/' + what); toast(what === 'dismiss' ? 'Report dismissed' : what === 'ban' ? 'User banned' : 'Content removed'); load(); }
    catch (e) { toast(e.message, true); }
  }
  async function load(){
    list.innerHTML = '<div class="meta">Loading…</div>';
    var data; try { data = await api('GET', '/admin/api/reports?status=' + state.status); } catch (e) { list.textContent = e.message; return; }
    list.innerHTML = '';
    if (!data.items.length) { list.appendChild(h('div', { class: 'card empty' }, [h('span', { class: 'serif', text: state.status === 'open' ? 'All clear' : 'Nothing resolved yet' }), state.status === 'open' ? 'No open reports right now.' : ''])); return; }
    data.items.forEach(function(rep){
      var t = rep.target;
      var kids = [
        h('div', { class: 'row' }, [h('span', { class: 'chip', text: rep.targetType }), rep.sameTargetOpen > 1 ? h('span', { class: 'chip neg', text: rep.sameTargetOpen + ' reports' }) : null, h('span', { class: 'meta grow', text: 'Reported by ' + (rep.reporter.displayName || 'someone') + ' · ' + new Date(rep.createdAt).toLocaleString() }), rep.status === 'resolved' ? h('span', { class: 'chip mut', text: rep.resolution }) : null]),
        rep.reason ? h('div', { class: 'meta', style: 'margin-top:6px', text: 'Reason: ' + rep.reason }) : null,
        t ? h('div', { class: 'quote', text: (t.text || '(no text)').slice(0, 1200) }) : h('div', { class: 'quote meta', text: 'This content no longer exists.' }),
        t ? h('div', { class: 'meta', text: 'By ' + (t.authorName || 'unknown') + (t.authorBanned ? ' · banned' : '') + (t.removed ? ' · removed' : '') }) : null,
      ];
      if (rep.status === 'open') {
        kids.push(h('div', { class: 'row', style: 'margin-top:12px' }, [
          rep.targetType !== 'user' && t && !t.removed ? h('button', { class: 'btn small', text: 'Remove ' + rep.targetType, onclick: function(){ act(rep, 'remove'); } }) : null,
          t && !t.authorBanned ? h('button', { class: 'btn small danger', text: 'Ban user', onclick: function(){ act(rep, 'ban'); } }) : null,
          h('button', { class: 'btn small ghost', text: 'Dismiss', onclick: function(){ act(rep, 'dismiss'); } }),
        ]));
      }
      list.appendChild(h('div', { class: 'card' }, kids));
    });
  }
  drawPills(); load();
}

// ---------- Fund Me (placeholder: the Fund Me area fills this via window.registerAdminTab) ----------
function fundMePlaceholder(box){
  box.appendChild(h('h2', { class: 'serif', text: 'Fund Me approvals' }));
  box.appendChild(h('div', { class: 'ext' }, [h('div', { class: 'serif', style: 'font-size:20px;color:var(--fg)', text: 'Coming soon' }), h('p', { text: 'Fund Me campaign approvals will appear here.' }), h('p', { class: 'meta' }, ['Developers: call ', h('code', { text: "window.registerAdminTab('Fund Me approvals', render)" }), ' with routes under ', h('code', { text: '/admin/api/fundme/*' }), '.'])]));
}

// ---------- Audit log ----------
function auditTab(box){
  box.appendChild(h('h2', { class: 'serif', text: 'Audit log' }));
  box.appendChild(h('p', { class: 'sub', text: 'The last 100 admin actions.' }));
  var list = h('div', { class: 'card' }); box.appendChild(list);
  api('GET', '/admin/api/actions').then(function(d){
    if (!d.items.length) { list.className = 'card empty'; list.textContent = 'No admin actions yet.'; return; }
    d.items.forEach(function(a, i){
      list.appendChild(h('div', { class: 'row', style: 'padding:8px 0;' + (i ? 'border-top:1px solid var(--border)' : '') }, [h('span', { class: 'chip', text: a.action }), h('span', { class: 'grow', text: (a.details && (a.details.title || a.details.displayName || a.details.text)) || a.targetId || '' }), h('span', { class: 'meta', text: (a.admin || '—') + ' · ' + new Date(a.createdAt).toLocaleString() })]));
    });
  }).catch(function(e){ list.textContent = e.message; });
}

tabs.push({ name: 'YouTube channels', render: youtubeTab });
tabs.push({ name: 'Reports', render: reportsTab });
tabs.push({ name: 'Fund Me approvals', render: fundMePlaceholder });
tabs.push({ name: 'Audit log', render: auditTab });

// ---------- sign-in ----------
function notAdmin(me){
  app.innerHTML = '';
  app.appendChild(h('div', { class: 'signin' }, [h('div', { class: 'card' }, [
    h('div', { class: 'eyebrow', text: 'Admins only' }), h('h2', { class: 'serif', text: 'This account isn’t an admin' }),
    h('p', { class: 'sub', text: 'Ask an existing admin to grant your account access, then reload.' }),
    h('button', { class: 'btn ghost', text: 'Sign out and retry', onclick: signOut }),
  ])]));
}
async function signOut(){
  localStorage.removeItem('bnAdminToken');
  localStorage.removeItem('bnAdminDevUser');
  if (window.Clerk && window.Clerk.user) { try { await window.Clerk.signOut(); } catch (e) {} }
  location.reload();
}
async function start(){
  var me;
  try { me = await api('GET', '/admin/api/me'); }
  catch (e) {
    localStorage.removeItem('bnAdminToken');
    if (e.code === 'NOT_ADMIN') return notAdmin();
    adminPasswordSignIn();
    return;
  }
  who.innerHTML = '';
  who.appendChild(h('span', { text: 'Signed in as ' + (me.displayName || 'Benjamin') }));
  who.appendChild(h('button', { class: 'btn small ghost', text: 'Sign out', onclick: signOut }));
  app.innerHTML = '';
  app.appendChild(h('nav', { class: 'tabs', id: 'tabs' }));
  app.appendChild(h('div', { id: 'panel' }));
  var want = decodeURIComponent((location.hash || '').slice(1));
  sortTabs();
  show(tabs.some(function(t){ return t.name === want; }) ? want : tabs[0].name);
}
function adminPasswordSignIn(){
  var userIn = h('input', { placeholder: 'Username (benjamin)', value: 'benjamin', style: 'width:100%;margin:8px 0 14px' });
  var passIn = h('input', { type: 'password', placeholder: 'Password', style: 'width:100%;margin:8px 0 16px' });
  var btn = h('button', { class: 'btn', style: 'width:100%', text: 'Sign in to Admin' });
  var form = h('form', { onsubmit: async function(e){
    e.preventDefault();
    if (!userIn.value.trim() || !passIn.value) return toast('Please enter username and password', true);
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      var res = await fetch('/admin/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ username: userIn.value.trim(), password: passIn.value })
      });
      var data = await res.json().catch(function(){ return {}; });
      if (!res.ok) throw new Error(data.error || 'Incorrect username or password');
      localStorage.setItem('bnAdminToken', data.token);
      toast('Welcome back, ' + (data.user.displayName || 'Benjamin'));
      start();
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false; btn.textContent = 'Sign in to Admin';
    }
  }}, [
    h('div', { class: 'eyebrow', text: 'BibleNestra Administrator' }),
    h('h2', { class: 'serif', text: 'Admin Portal' }),
    h('p', { class: 'sub', text: 'Enter your administrator username and password to continue.' }),
    h('label', { class: 'meta', text: 'Username' }), userIn,
    h('label', { class: 'meta', text: 'Password' }), passIn,
    btn
  ]);

  app.innerHTML = '';
  app.appendChild(h('div', { class: 'signin' }, [h('div', { class: 'card' }, [form])]));
}
window.addEventListener('load', function(){
  if (localStorage.getItem('bnAdminToken')) return start();
  if (CFG.devMode && localStorage.getItem('bnAdminDevUser')) return start();
  adminPasswordSignIn();
});
})();
`;

export function adminPageHtml(cfg, extraScripts = []) {
  const clerkSrc = cfg.clerkKey ? clerkScriptSrc(cfg.clerkKey) : null;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>BibleNestra · Admin</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,600&display=swap" rel="stylesheet">
<style>${CSS}</style>
<script>window.__ADMIN__ = ${json({ devMode: !!cfg.devMode, clerkKey: cfg.clerkKey || '' })};</script>
${clerkSrc ? `<script async crossorigin="anonymous" data-clerk-publishable-key="${String(cfg.clerkKey).replace(/[^\w$-]/g, '')}" src="${clerkSrc}"></script>` : ''}
</head><body>
<header><div><div class="eyebrow">BibleNestra</div><h1 class="serif">Admin dashboard</h1></div><div class="who" id="who"></div></header>
<main id="app"><div class="meta">Loading…</div></main>
<div id="toast"></div>
<script>${scriptSafe(SCRIPT)}</script>
${extraScripts.map((s) => `<script>${scriptSafe(s)}</script>`).join('\n')}
</body></html>`;
}
