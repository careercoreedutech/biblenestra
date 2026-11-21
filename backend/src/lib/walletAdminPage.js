// Admin dashboard tab "Wallets & payments" (WALLET CORE, client spec §16 core parts). Registered with
// registerAdminScript() from routes/wallet.js. Uses /admin/api/wallet/* (admins only).
// textContent-based DOM builder only (nothing typed by people is parsed as HTML).
// NOTE: plain JS in a string — no backticks or "${" inside.
//
// HOOK POINTS for the follow-up stages (contract: scratch/monetisation/wallet-core.md › "Admin hook points"):
//   In your own admin script (registerAdminScript(MY_SCRIPT) from your route module), add a section to this tab:
//     (window.__walletSections = window.__walletSections || []).push({ title: 'Gift catalogue', render: function(box, ctx){ … } });
//   ctx = { api, toast, esc, h, open(sectionTitle, preset) } — open('Ledger search', { ref: 'gift:' }) / open('Member', { q: userId }).
//   Works whatever order the scripts load in. Reserved titles (a placeholder shows until the owner registers it):
//     'Donations & payouts' (Fund Me agent) · 'Gift catalogue' (Virtual Gifts agent) · 'Dating' (Find Love agent).
//   A stage may also register its own top-level tab with window.registerAdminTab as usual.
export const WALLET_ADMIN_SCRIPT = `
(function(){
if (!window.registerAdminTab) return;
window.__walletSections = window.__walletSections || [];
window.registerWalletAdminSection = function(title, render){ window.__walletSections.push({ title: title, render: render }); };

var PLACEHOLDERS = [
  { title: 'Donations & payouts', text: 'Fund Me donations received by BibleNestra, verification, payout approval, payout history and reconciliation. Built in the Fund Me stage (ledger E is ready: wallets donations_held_*/donations_paid_*, table fundme_payouts).' },
  { title: 'Gift catalogue', text: 'Add / edit / deactivate gifts, coin prices and animations; all gifts sent and received; recipient earnings. Built in the Virtual Gifts stage (wallet.js postGift() already records the 20% / 80% split).' },
  { title: 'Dating', text: 'Dating Coin usage, message unlocks, rewarded-ad completions, boosts and Spotlight purchases. Built in the Find Love stage (Dating Plus / VIP subscriptions are already under Subscriptions).' },
];

async function authHeaders(){
  var h = { 'Accept': 'text/csv' };
  var tk = localStorage.getItem('bnAdminToken');
  if (tk) { h['Authorization'] = 'Bearer ' + tk; return h; }
  var dev = localStorage.getItem('bnAdminDevUser');
  if (dev && window.__ADMIN__ && window.__ADMIN__.devMode) { h['X-Dev-User'] = dev; return h; }
  try { if (window.Clerk && window.Clerk.session) { var t = await window.Clerk.session.getToken(); if (t) h['Authorization'] = 'Bearer ' + t; } } catch (e) {}
  return h;
}
async function downloadCsv(path, toast){
  try {
    var res = await fetch(path + (path.indexOf('?') < 0 ? '?' : '&') + 'format=csv', { headers: await authHeaders() });
    if (!res.ok) throw new Error('Export failed (' + res.status + ')');
    var blob = await res.blob();
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    var cd = res.headers.get('Content-Disposition') || '';
    var m = cd.match(/filename="([^"]+)"/);
    a.download = m ? m[1] : 'export.csv';
    document.body.appendChild(a); a.click(); a.remove();
  } catch (e) { toast(e.message, true); }
}
function num(n){ return Number(n || 0).toLocaleString(); }
function money(minor, cur){ var sym = { NGN: '\\u20A6', GBP: '\\u00A3', USD: '$', EUR: '\\u20AC' }[cur || 'NGN'] || ((cur || '') + ' '); return sym + (Number(minor || 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
function when(s){ if (!s) return '—'; var d = new Date(s); return d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function day(s){ if (!s) return '—'; return new Date(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
function qs(o){ var p = []; Object.keys(o).forEach(function(k){ if (o[k] !== '' && o[k] != null) p.push(encodeURIComponent(k) + '=' + encodeURIComponent(o[k])); }); return p.length ? '?' + p.join('&') : ''; }
function newKey(){ return 'adm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10); }

window.registerAdminTab('Wallets & payments', function(box, ctx){
  var h = ctx.h, api = ctx.api, toast = ctx.toast;
  var reg = null; // overview payload (wallet registry, kinds, config)
  box.appendChild(h('h2', { class: 'serif', text: 'Wallets & payments' }));
  box.appendChild(h('p', { class: 'sub', text: 'Separate balances for Fund Me credits, Dating Coins, Gifting Coins and gift earnings, BibleNestra commission, purchases and Dating Plus / VIP. Every movement is an append-only ledger entry with a unique reference. Kingdom Coins (free reward coins) are not part of these wallets.' }));
  var nav = h('div', { class: 'row', style: 'gap:6px;margin-bottom:14px' });
  var panel = h('div');
  box.appendChild(nav); box.appendChild(panel);

  var SECTIONS = [
    ['Overview', overview], ['Ledger search', ledger], ['Member', member], ['Purchases', purchases],
    ['Products & prices', products], ['Subscriptions', subscriptions], ['Settings', settings],
  ];
  var extra = (window.__walletSections || []).slice();
  PLACEHOLDERS.forEach(function(p){
    if (!extra.some(function(x){ return x.title === p.title; })) SECTIONS.push([p.title, function(el){ el.appendChild(h('div', { class: 'card' }, [h('span', { class: 'chip mut', text: 'Next stage' }), h('p', { class: 'meta', style: 'margin-top:8px', text: p.text })])); }]);
  });
  var sctx = { api: api, toast: toast, esc: ctx.esc, h: h, open: function(name, preset){ open(name, preset); } };
  extra.forEach(function(x){ SECTIONS.push([x.title, function(el){ x.render(el, sctx); }]); });
  var current = SECTIONS[0][0];
  function drawNav(){
    nav.innerHTML = '';
    SECTIONS.forEach(function(s){ nav.appendChild(h('button', { class: 'btn small' + (s[0] === current ? '' : ' ghost'), text: s[0], onclick: function(){ open(s[0]); } })); });
  }
  function open(name, arg){ current = name; drawNav(); panel.innerHTML = ''; var s = SECTIONS.find(function(x){ return x[0] === name; }); try { s[1](panel, arg); } catch (e) { panel.appendChild(h('div', { class: 'card', text: 'Failed: ' + e.message })); } }
  async function registry(){ if (!reg) reg = await api('GET', '/admin/api/wallet/overview'); return reg; }
  function walletOptions(withAll, userOnly){
    var o = withAll ? [h('option', { value: '', text: 'All wallets' })] : [];
    Object.keys((reg && reg.wallets_registry) || {}).forEach(function(k){ var w = reg.wallets_registry[k]; if (userOnly && w.owner !== 'user') return; o.push(h('option', { value: k, text: w.label + ' (' + k + ')' })); });
    return o;
  }
  function stat(label, value, sub){ return h('div', { class: 'card', style: 'flex:1;min-width:150px;margin:0' }, [h('div', { class: 'meta', text: label }), h('b', { style: 'font-size:20px', text: value }), sub ? h('div', { class: 'meta', text: sub }) : null]); }
  function table(cols, rows){
    var t = h('table', { style: 'width:100%;border-collapse:collapse;font-size:13px' });
    t.appendChild(h('tr', {}, cols.map(function(c){ return h('th', { style: 'text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--muted);font-weight:600', text: c[0] }); })));
    rows.forEach(function(r){ t.appendChild(h('tr', {}, cols.map(function(c){ var v = c[1](r); return h('td', { style: 'padding:6px 8px;border-bottom:1px solid var(--border);vertical-align:top' }, [typeof v === 'object' && v ? v : String(v == null ? '' : v)]); }))); });
    return h('div', { class: 'card', style: 'overflow-x:auto;padding:8px' }, [t]);
  }
  function amountCell(n){ return h('b', { style: 'color:' + (n < 0 ? 'var(--neg)' : 'var(--primary)'), text: (n > 0 ? '+' : '') + num(n) }); }
  function inp(ph, w, type){ return h('input', { placeholder: ph, type: type || 'text', style: 'width:' + (w || 160) + 'px' }); }

  // ---------- Overview ----------
  async function overview(el){
    el.appendChild(h('div', { class: 'meta', text: 'Loading…' }));
    reg = null;
    var d; try { d = await registry(); } catch (e) { el.innerHTML = ''; el.appendChild(h('div', { class: 'card', text: e.message })); return; }
    el.innerHTML = '';
    if (!d.playConfigured) el.appendChild(h('div', { class: 'card', style: 'border-color:var(--gold)' }, [h('b', { text: 'Google Play Billing is not configured yet.' }), h('div', { class: 'meta', text: 'Members see “coming soon”. Test purchases work only for admins / WALLET_TESTERS when WALLET_TEST_PURCHASES=true. Set GOOGLE_PLAY_PACKAGE_NAME + GOOGLE_PLAY_SERVICE_ACCOUNT_JSON when the Play developer account exists.' })]));
    var ig = d.integrity || { ok: true, checked: 0, mismatches: [] };
    el.appendChild(h('div', { class: 'card', style: ig.ok ? '' : 'border-color:var(--neg)' }, [
      h('span', { class: 'chip' + (ig.ok ? '' : ' neg'), text: ig.ok ? 'Ledger check passed' : 'Ledger mismatch' }),
      h('span', { class: 'meta', style: 'margin-left:8px', text: ig.ok ? ('All ' + num(ig.checked) + ' balances equal the sum of their ledger entries.') : (ig.mismatches.length + ' balance(s) differ from their entries: ' + ig.mismatches.map(function(m){ return m.account + ' / ' + m.wallet + ' (' + m.balance + ' vs ' + m.ledger + ')'; }).join(', ')) }),
    ]));
    var pur = d.purchases || {};
    el.appendChild(h('div', { class: 'row', style: 'gap:10px;margin-bottom:12px' }, [
      stat('Purchases verified', num(pur.verified)), stat('Pending', num(pur.pending), 'waiting for store verification'),
      stat('Failed', num(pur.failed)), stat('Refunded', num(pur.refunded)),
    ]));
    el.appendChild(h('h3', { text: 'Commission ledger (F)' }));
    if (!d.commission.length) el.appendChild(h('div', { class: 'card empty', text: 'No commission recorded yet.' }));
    else el.appendChild(h('div', { class: 'row', style: 'gap:10px;margin-bottom:12px' }, d.commission.map(function(c){ return stat(c.label, c.wallet === 'commission_gift_coins' ? num(c.total) + ' coins' : money(c.total, c.wallet.slice(-3).toUpperCase()), 'last 30 days: ' + num(c.last30) + ' · ' + num(c.entries) + ' entries'); })));
    el.appendChild(h('h3', { text: 'Balances held, by wallet' }));
    el.appendChild(table([['Wallet', function(r){ return r.label; }], ['Account', function(r){ return r.platform ? 'Platform' : 'Members'; }], ['Total', function(r){ return num(r.total); }], ['Holders', function(r){ return num(r.holders); }]], d.wallets));
    el.appendChild(h('h3', { text: 'Verified revenue (excluding test purchases)' }));
    el.appendChild(d.revenue.length ? table([['Area', function(r){ return r.area; }], ['Purchases', function(r){ return num(r.count); }], ['Total', function(r){ return money(r.totalMinor, r.currency); }]], d.revenue) : h('div', { class: 'card empty', text: 'No paid purchases yet.' }));
  }

  // ---------- Ledger search ----------
  function ledger(el, preset){
    registry().then(function(){
      var fq = inp('User id, @handle or platform', 210), fref = inp('Reference (prefix)', 170), fw = h('select', {}, walletOptions(true)), fk = inp('Type (kind), e.g. purchase', 170);
      var ff = inp('', 140, 'date'), ft = inp('', 140, 'date');
      if (preset && preset.q) fq.value = preset.q;
      if (preset && preset.ref) fref.value = preset.ref;
      var out = h('div'), more = h('div');
      var cursor = null;
      function params(){ return { q: fq.value.trim(), ref: fref.value.trim(), wallet: fw.value, kind: fk.value.trim(), from: ff.value, to: ft.value }; }
      async function run(reset){
        if (reset) { cursor = null; out.innerHTML = ''; }
        var p = params(); if (cursor) p.cursor = cursor;
        var d; try { d = await api('GET', '/admin/api/wallet/entries' + qs(p)); } catch (e) { toast(e.message, true); return; }
        if (!d.items.length && reset) out.appendChild(h('div', { class: 'card empty', text: 'No entries match.' }));
        if (d.items.length) out.appendChild(table([
          ['When', function(r){ return when(r.createdAt); }],
          ['Member', function(r){ return r.user ? (r.user.displayName + (r.user.handle ? ' @' + r.user.handle : '')) : r.account; }],
          ['Wallet', function(r){ return r.wallet; }], ['Type', function(r){ return r.label + ' (' + r.kind + ')'; }],
          ['Amount', function(r){ return amountCell(r.amount); }], ['Balance after', function(r){ return num(r.balanceAfter); }],
          ['Reference', function(r){ return h('a', { href: '#', text: r.ref, onclick: function(ev){ ev.preventDefault(); fref.value = r.ref; fq.value = ''; run(true); } }); }],
          ['Note', function(r){ return (r.meta && (r.meta.reason || r.meta.title)) || (r.counterparty ? 'with ' + r.counterparty.name : ''); }],
        ], d.items));
        cursor = d.nextCursor; more.innerHTML = '';
        if (cursor) more.appendChild(h('button', { class: 'btn ghost', text: 'Load more', onclick: function(){ run(false); } }));
      }
      el.appendChild(h('div', { class: 'card row', style: 'gap:8px' }, [fq, fref, fw, fk, h('span', { class: 'meta', text: 'From' }), ff, h('span', { class: 'meta', text: 'to' }), ft,
        h('button', { class: 'btn', text: 'Search', onclick: function(){ run(true); } }),
        h('button', { class: 'btn ghost', text: 'Export CSV', onclick: function(){ downloadCsv('/admin/api/wallet/entries' + qs(params()), toast); } })]));
      el.appendChild(out); el.appendChild(more);
      run(true);
    }).catch(function(e){ el.appendChild(h('div', { class: 'card', text: e.message })); });
  }

  // ---------- Member ----------
  function member(el, preset){
    registry().then(function(){
      var fq = inp('User id or @handle', 260);
      var out = h('div');
      if (preset && preset.q) fq.value = preset.q;
      async function load(){
        out.innerHTML = '';
        if (!fq.value.trim()) return;
        var d; try { d = await api('GET', '/admin/api/wallet/user' + qs({ q: fq.value.trim() })); } catch (e) { out.appendChild(h('div', { class: 'card empty', text: e.message })); return; }
        out.appendChild(h('div', { class: 'card' }, [h('b', { text: d.user.displayName + (d.user.handle ? ' @' + d.user.handle : '') }), h('div', { class: 'meta', text: d.user.id + (d.platform ? '' : ' · Kingdom Coins (reward coins): ' + num(d.kingdomCoins)) })]));
        var bal = Object.keys(d.balances).filter(function(k){ return d.platform || d.balances[k] || k.indexOf('donations_') !== 0; });
        out.appendChild(h('div', { class: 'row', style: 'gap:10px;margin-bottom:12px' }, bal.map(function(k){ var w = (reg.wallets_registry || {})[k] || { label: k }; return stat(w.label, w.unit === 'minor' ? money(d.balances[k], k.slice(-3).toUpperCase()) : num(d.balances[k])); })));
        if (d.platform) return;
        out.appendChild(h('div', { class: 'row', style: 'gap:8px;margin-bottom:12px' }, [
          h('button', { class: 'btn ghost small', text: 'All ledger entries', onclick: function(){ open('Ledger search', { q: d.user.id }); } }),
        ]));
        // manual adjustment
        var aw = h('select', {}, walletOptions(false, true)), aa = inp('Amount (+ or −)', 140, 'number'), ar = inp('Reason (required, shown in the audit log)', 320);
        var key = newKey();
        var go = h('button', { class: 'btn', text: 'Apply adjustment' });
        go.onclick = async function(){
          var amount = parseInt(aa.value, 10);
          if (!amount) { toast('Enter a whole, non-zero amount', true); return; }
          if (ar.value.trim().length < 5) { toast('A reason is required', true); return; }
          if (!confirm('Adjust ' + aw.value + ' by ' + amount + ' for ' + d.user.displayName + '?')) return;
          go.disabled = true;
          try { var r = await api('POST', '/admin/api/wallet/adjust', { userId: d.user.id, wallet: aw.value, amount: amount, reason: ar.value.trim(), idempotencyKey: key }); key = newKey(); toast(r.applied ? 'Adjustment applied' : 'Already applied'); load(); }
          catch (e) { toast(e.message, true); }
          go.disabled = false;
        };
        out.appendChild(h('div', { class: 'card' }, [h('b', { text: 'Manual adjustment' }), h('div', { class: 'meta', text: 'Creates a new ledger entry (kind admin_adjust). Balances can never go below zero. Logged with your reason in admin actions.' }), h('div', { class: 'row', style: 'gap:8px;margin-top:8px' }, [aw, aa, ar, go])]));
        out.appendChild(h('h3', { text: 'Subscriptions' }));
        out.appendChild(d.subscriptions.length ? table([['Plan', function(s){ return s.title; }], ['Status', function(s){ return s.status + (s.test ? ' (test)' : ''); }], ['Renews', function(s){ return s.autoRenew ? 'yes' : 'no'; }], ['Period ends', function(s){ return day(s.currentPeriodEnd); }]], d.subscriptions) : h('div', { class: 'card empty', text: 'No subscriptions.' }));
        out.appendChild(h('h3', { text: 'Recent purchases' }));
        out.appendChild(d.purchases.length ? table([['When', function(p){ return when(p.createdAt); }], ['Product', function(p){ return p.productId; }], ['Provider', function(p){ return p.provider + (p.test ? ' (test)' : ''); }], ['Status', function(p){ return p.status + (p.errorCode ? ' · ' + p.errorCode : ''); }], ['Price', function(p){ return p.priceLabel; }]], d.purchases) : h('div', { class: 'card empty', text: 'No purchases.' }));
      }
      el.appendChild(h('div', { class: 'card row', style: 'gap:8px' }, [fq, h('button', { class: 'btn', text: 'Open', onclick: load }), h('span', { class: 'meta', text: 'Type “platform” to see BibleNestra’s own ledgers.' })]));
      el.appendChild(out);
      if (fq.value) load();
    });
  }

  // ---------- Purchases ----------
  function purchases(el){
    var status = 'pending';
    var chips = h('div', { class: 'row', style: 'gap:6px' });
    var fprov = h('select', {}, [['', 'All providers'], ['play', 'Google Play'], ['test', 'Test'], ['apple', 'Apple']].map(function(o){ return h('option', { value: o[0], text: o[1] }); }));
    var fq = inp('User id or @handle', 180), fref = inp('Purchase id / order id / token', 200), ff = inp('', 140, 'date'), ft = inp('', 140, 'date');
    var out = h('div');
    function params(){ return { status: status, provider: fprov.value, q: fq.value.trim(), ref: fref.value.trim(), from: ff.value, to: ft.value }; }
    function drawChips(){ chips.innerHTML = ''; [['pending', 'Pending'], ['failed', 'Failed'], ['verified', 'Verified'], ['refunded', 'Refunded'], ['', 'All']].forEach(function(s){ chips.appendChild(h('button', { class: 'btn small' + (status === s[0] ? '' : ' ghost'), text: s[1], onclick: function(){ status = s[0]; drawChips(); load(); } })); }); }
    async function load(){
      out.innerHTML = '';
      var d; try { d = await api('GET', '/admin/api/wallet/purchases' + qs(params())); } catch (e) { toast(e.message, true); return; }
      if (!d.items.length) { out.appendChild(h('div', { class: 'card empty', text: 'No purchases match.' })); return; }
      out.appendChild(table([
        ['When', function(p){ return when(p.createdAt); }], ['Member', function(p){ return p.user ? p.user.displayName + (p.user.handle ? ' @' + p.user.handle : '') : '—'; }],
        ['Product', function(p){ return p.title; }], ['Provider', function(p){ return p.provider + (p.test ? ' (test)' : ''); }],
        ['Status', function(p){ return h('span', { class: 'chip' + (p.status === 'failed' ? ' neg' : p.status === 'pending' ? ' gold' : p.status === 'refunded' ? ' mut' : ''), text: p.status + (p.errorCode ? ' · ' + p.errorCode : '') }); }],
        ['Price', function(p){ return p.priceLabel; }], ['Units', function(p){ return num(p.units); }],
        ['', function(p){
          var row = h('div', { class: 'row', style: 'gap:4px' }, [h('button', { class: 'btn ghost small', text: 'Ledger', onclick: function(){ open('Ledger search', { ref: 'purchase:' + p.id }); } })]);
          if (p.status === 'verified') row.appendChild(h('button', { class: 'btn danger small', text: 'Refund', onclick: async function(){
            var reason = prompt('Reason for the refund (the units are taken back; fails if already spent):'); if (!reason) return;
            try { await api('POST', '/admin/api/wallet/purchases/' + p.id + '/refund', { reason: reason }); toast('Marked refunded'); load(); } catch (e) { toast(e.message, true); }
          } }));
          return row;
        }],
      ], d.items));
    }
    drawChips();
    el.appendChild(h('div', { class: 'card row', style: 'gap:8px' }, [chips, fprov, fq, fref, ff, ft, h('button', { class: 'btn', text: 'Filter', onclick: load }), h('button', { class: 'btn ghost', text: 'Export CSV', onclick: function(){ downloadCsv('/admin/api/wallet/purchases' + qs(params()), toast); } })]));
    el.appendChild(out);
    load();
  }

  // ---------- Products & prices ----------
  function products(el){
    var out = h('div');
    el.appendChild(h('p', { class: 'meta', text: 'Prices are in naira (saved in kobo). Deactivate a package to hide it from the app; past purchases keep their record. The Google Play product id must match the in-app product created in Play Console.' }));
    el.appendChild(out);
    async function load(){
      out.innerHTML = '';
      var d; try { d = await api('GET', '/admin/api/wallet/products'); } catch (e) { out.appendChild(h('div', { class: 'card', text: e.message })); return; }
      [['fundme', 'pack', 'Fund Me credit packs'], ['dating', 'pack', 'Dating Coin packs'], ['gifts', 'pack', 'Gifting Coin packs (proposal, client to confirm)'], ['dating', 'subscription', 'Dating Plus / VIP subscriptions']].forEach(function(g){
        var items = d.items.filter(function(p){ return p.area === g[0] && p.type === g[1]; });
        out.appendChild(h('h3', { text: g[2] }));
        items.forEach(function(p){ out.appendChild(g[1] === 'pack' ? packRow(p) : subRow(p)); });
        out.appendChild(h('button', { class: 'btn ghost small', style: 'margin-bottom:12px', text: '+ Add ' + (g[1] === 'pack' ? 'package' : 'plan'), onclick: function(ev){ ev.target.replaceWith(g[1] === 'pack' ? packRow(null, g[0]) : subRow(null)); } }));
      });
    }
    function field(label, input){ return h('label', { class: 'meta', style: 'display:flex;flex-direction:column;gap:2px' }, [label, input]); }
    function packRow(p, area){
      var id = inp('id e.g. dating_coins_750', 170); id.value = p ? p.id : ''; if (p) id.disabled = true;
      var title = inp('Title', 170); title.value = p ? p.title : '';
      var units = inp('Units', 90, 'number'); units.value = p ? p.units : '';
      var bonus = inp('Bonus', 80, 'number'); bonus.value = p ? p.bonusUnits : 0;
      var price = inp('Price ₦', 100, 'number'); price.value = p ? p.priceMinor / 100 : '';
      var play = inp('Play product id', 170); play.value = p ? (p.playProductId || '') : '';
      var sort = inp('Order', 60, 'number'); sort.value = p ? p.sortOrder : 0;
      var active = h('input', { type: 'checkbox' }); active.checked = p ? p.active : true;
      var save = h('button', { class: 'btn small', text: p ? 'Save' : 'Create' });
      save.onclick = async function(){
        var b = { title: title.value.trim(), units: parseInt(units.value, 10), bonusUnits: parseInt(bonus.value || '0', 10), priceMinor: Math.round(parseFloat(price.value) * 100), playProductId: play.value.trim() || null, sortOrder: parseInt(sort.value || '0', 10), active: active.checked };
        try {
          if (p) await api('PATCH', '/admin/api/wallet/products/' + encodeURIComponent(p.id), b);
          else { b.id = id.value.trim(); b.type = 'pack'; b.area = area; await api('POST', '/admin/api/wallet/products', b); }
          toast('Saved'); load();
        } catch (e) { toast(e.message, true); }
      };
      return h('div', { class: 'card row', style: 'gap:8px;align-items:flex-end;opacity:' + (p && !p.active ? '0.6' : '1') }, [field('Id', id), field('Title', title), field('Units', units), field('Bonus', bonus), field('Price (₦)', price), field('Google Play id', play), field('Order', sort), field('Active', active), save, p ? h('span', { class: 'meta', text: p.priceLabel + ' · ' + p.wallet }) : null]);
    }
    function subRow(p){
      var id = inp('id e.g. dating_vip_yearly', 170); id.value = p ? p.id : ''; if (p) id.disabled = true;
      var title = inp('Title', 160); title.value = p ? p.title : '';
      var price = inp('Price ₦', 100, 'number'); price.value = p ? p.priceMinor / 100 : '';
      var interval = h('select', {}, [['month', 'Monthly'], ['year', 'Yearly']].map(function(o){ return h('option', { value: o[0], text: o[1] }); })); interval.value = p ? p.interval : 'month';
      var tier = inp('Tier', 60, 'number'); tier.value = p ? p.tier : 1;
      var play = inp('Play product id', 170); play.value = p ? (p.playProductId || '') : '';
      var active = h('input', { type: 'checkbox' }); active.checked = p ? p.active : true;
      var be = (p && p.benefits) || {};
      var feats = h('textarea', { rows: '5', style: 'width:100%;box-sizing:border-box', placeholder: 'One benefit per line' }); feats.value = (be.features || []).join('\\n');
      var cycle = h('textarea', { rows: '2', style: 'width:100%;box-sizing:border-box', placeholder: 'Per billing cycle, one per line: wallet amount  e.g. dating_coins 300' }); cycle.value = (be.perCycle || []).map(function(g){ return g.wallet + ' ' + g.amount; }).join('\\n');
      var badge = inp('Badge', 90); badge.value = be.badge || '';
      var save = h('button', { class: 'btn small', text: p ? 'Save' : 'Create' });
      save.onclick = async function(){
        var per = [];
        var bad = false;
        cycle.value.split('\\n').forEach(function(l){ l = l.trim(); if (!l) return; var parts = l.split(/[\\s:]+/); var n = parseInt(parts[1], 10); if (!parts[0] || !n) bad = true; else per.push({ wallet: parts[0], amount: n }); });
        if (bad) { toast('Per-cycle lines must look like: dating_coins 300', true); return; }
        var benefits = Object.assign({}, be, { badge: badge.value.trim(), features: feats.value.split('\\n').map(function(x){ return x.trim(); }).filter(Boolean), perCycle: per });
        var b = { title: title.value.trim(), priceMinor: Math.round(parseFloat(price.value) * 100), interval: interval.value, tier: parseInt(tier.value || '0', 10), playProductId: play.value.trim() || null, active: active.checked, benefits: benefits };
        try {
          if (p) await api('PATCH', '/admin/api/wallet/products/' + encodeURIComponent(p.id), b);
          else { b.id = id.value.trim(); b.type = 'subscription'; b.area = 'dating'; await api('POST', '/admin/api/wallet/products', b); }
          toast('Saved'); load();
        } catch (e) { toast(e.message, true); }
      };
      return h('div', { class: 'card', style: 'opacity:' + (p && !p.active ? '0.6' : '1') }, [
        h('div', { class: 'row', style: 'gap:8px;align-items:flex-end' }, [field('Id', id), field('Title', title), field('Price (₦)', price), field('Billing', interval), field('Tier (higher = more)', tier), field('Google Play id', play), field('Badge', badge), field('Active', active), save]),
        h('div', { class: 'row', style: 'gap:12px;margin-top:8px;align-items:flex-start' }, [h('div', { class: 'grow' }, [h('div', { class: 'meta', text: 'Benefits shown to members' }), feats]), h('div', { class: 'grow' }, [h('div', { class: 'meta', text: 'Granted once per paid billing cycle' }), cycle])]),
      ]);
    }
    load();
  }

  // ---------- Subscriptions ----------
  function subscriptions(el){
    var status = 'active';
    var chips = h('div', { class: 'row', style: 'gap:6px' });
    var out = h('div');
    function drawChips(){ chips.innerHTML = ''; [['active', 'Active'], ['cancelled', 'Cancelled (until end)'], ['past_due', 'Past due'], ['expired', 'Expired'], ['refunded', 'Refunded'], ['', 'All']].forEach(function(s){ chips.appendChild(h('button', { class: 'btn small' + (status === s[0] ? '' : ' ghost'), text: s[1], onclick: function(){ status = s[0]; drawChips(); load(); } })); }); }
    async function load(){
      out.innerHTML = '';
      var d; try { d = await api('GET', '/admin/api/wallet/subscriptions' + qs({ status: status })); } catch (e) { toast(e.message, true); return; }
      if (!d.items.length) { out.appendChild(h('div', { class: 'card empty', text: 'No subscriptions.' })); return; }
      out.appendChild(table([
        ['Member', function(s){ return s.user ? s.user.displayName + (s.user.handle ? ' @' + s.user.handle : '') : '—'; }], ['Plan', function(s){ return s.title; }],
        ['Status', function(s){ return s.status + (s.test ? ' (test)' : ''); }], ['Provider', function(s){ return s.provider; }], ['Auto-renew', function(s){ return s.autoRenew ? 'on' : 'off'; }],
        ['Period', function(s){ return day(s.currentPeriodStart) + ' → ' + day(s.currentPeriodEnd); }],
        ['', function(s){ return s.user ? h('button', { class: 'btn ghost small', text: 'Member', onclick: function(){ open('Member', { q: s.user.id }); } }) : ''; }],
      ], d.items));
    }
    drawChips();
    el.appendChild(h('div', { class: 'card row', style: 'gap:8px' }, [chips, h('button', { class: 'btn ghost', text: 'Export CSV', onclick: function(){ downloadCsv('/admin/api/wallet/subscriptions' + qs({ status: status }), toast); } }), h('button', { class: 'btn ghost', text: 'Edit prices & benefits', onclick: function(){ open('Products & prices'); } })]));
    el.appendChild(out);
    load();
  }

  // ---------- Settings ----------
  async function settings(el){
    var d; try { d = await api('GET', '/admin/api/wallet/config'); } catch (e) { el.appendChild(h('div', { class: 'card', text: e.message })); return; }
    var c = d.config;
    function saveKey(key, value){ return api('PUT', '/admin/api/wallet/config', { key: key, value: value }).then(function(){ toast('Saved'); }).catch(function(e){ toast(e.message, true); }); }
    function rowOf(title, hint, inputs, onSave){ return h('div', { class: 'card' }, [h('b', { text: title }), h('div', { class: 'meta', text: hint }), h('div', { class: 'row', style: 'gap:8px;margin-top:8px' }, inputs.concat([h('button', { class: 'btn small', text: 'Save', onclick: onSave })]))]); }
    var pct = inp('%', 80, 'number'); pct.value = c.gift_commission_bps / 100;
    el.appendChild(rowOf('Gift commission', 'BibleNestra keeps this share of every eligible gift; the recipient gets the rest as gift earnings (client spec: 20%).', [pct, h('span', { class: 'meta', text: '%' })], function(){ saveKey('gift_commission_bps', Math.round(parseFloat(pct.value) * 100)); }));
    var rc = inp('coins', 90, 'number'); rc.value = c.gift_coin_rate.coins;
    var rn = inp('₦', 90, 'number'); rn.value = c.gift_coin_rate.perMinor / 100;
    el.appendChild(rowOf('Gifting coin conversion rate (proposal, client to confirm)', 'How many Gifting Coins equal how much money. Used to price gifts from their naira value and as a guide for packs — not hard-coded anywhere.', [rc, h('span', { class: 'meta', text: 'coins = ₦' }), rn], function(){ saveKey('gift_coin_rate', { coins: parseInt(rc.value, 10), perMinor: Math.round(parseFloat(rn.value) * 100), currency: 'NGN' }); }));
    var pr = inp('₦ per coin', 100, 'number'); pr.value = c.earnings_payout_rate.minorPerCoin / 100;
    el.appendChild(rowOf('Gift earnings payout value', 'What 1 earned coin is worth when an approved creator withdraws (creator payout programme).', [h('span', { class: 'meta', text: '1 coin = ₦' }), pr], function(){ saveKey('earnings_payout_rate', { minorPerCoin: Math.round(parseFloat(pr.value) * 100), currency: 'NGN' }); }));
    var hd = inp('days', 80, 'number'); hd.value = c.earnings_hold_days;
    el.appendChild(rowOf('Earnings hold period', 'New gift earnings stay pending this many days before they can be released for withdrawal.', [hd, h('span', { class: 'meta', text: 'days' })], function(){ saveKey('earnings_hold_days', parseInt(hd.value, 10)); }));
    var mw = inp('coins', 100, 'number'); mw.value = c.earnings_min_withdrawal;
    el.appendChild(rowOf('Minimum withdrawal', 'Smallest gift-earnings withdrawal, in coins.', [mw], function(){ saveKey('earnings_min_withdrawal', parseInt(mw.value, 10)); }));
    var we = h('input', { type: 'checkbox' }); we.checked = !!c.earnings_withdrawals_enabled;
    el.appendChild(rowOf('Gift earnings withdrawals', 'Off until the creator payout programme is approved (legal / regulatory review). When off, members see earnings but cannot request a withdrawal.', [we, h('span', { class: 'meta', text: 'Withdrawals open' })], function(){ if (we.checked && !confirm('Open gift-earnings withdrawals? Only do this after the legal review is done.')) { we.checked = false; return; } saveKey('earnings_withdrawals_enabled', we.checked); }));
    var fc = inp('credits', 80, 'number'); fc.value = c.fundme_publish_credits;
    el.appendChild(rowOf('Fund Me publishing cost', 'Credits deducted when a Fund Me request is successfully published (client spec: 1).', [fc], function(){ saveKey('fundme_publish_credits', parseInt(fc.value, 10)); }));
    var other = Object.keys(c).filter(function(k){ return ['gift_commission_bps', 'gift_coin_rate', 'earnings_payout_rate', 'earnings_hold_days', 'earnings_min_withdrawal', 'earnings_withdrawals_enabled', 'fundme_publish_credits'].indexOf(k) < 0; });
    other.forEach(function(k){
      var v = h('input', { style: 'width:320px' }); v.value = JSON.stringify(c[k]);
      el.appendChild(rowOf(k, 'Setting added by another feature (JSON value).', [v], function(){ var val; try { val = JSON.parse(v.value); } catch (e) { toast('Not valid JSON', true); return; } saveKey(k, val); }));
    });
  }

  drawNav();
  open(current);
});
})();
`;
