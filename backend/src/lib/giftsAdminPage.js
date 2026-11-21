// Admin section "Gift catalogue" inside the "Wallets & payments" tab (VIRTUAL GIFTS & STARS, client spec §16 gift items).
// Registered via the wallet core hook (window.__walletSections) from routes/virtualGifts.js. Uses /admin/api/gifts/*.
// textContent-based DOM builder only. NOTE: plain JS in a string — no backticks, no "${", no backslashes inside.
export const GIFTS_ADMIN_SCRIPT = `
(function(){
function num(n){ return Number(n || 0).toLocaleString(); }
function naira(minor){ return '₦' + (Number(minor || 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
function when(s){ if (!s) return '—'; return new Date(s).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function qs(o){ var p = []; Object.keys(o).forEach(function(k){ if (o[k] !== '' && o[k] != null) p.push(encodeURIComponent(k) + '=' + encodeURIComponent(o[k])); }); return p.length ? '?' + p.join('&') : ''; }
async function authHeaders(extra){
  var h = extra || {};
  var tk = localStorage.getItem('bnAdminToken');
  if (tk) { h['Authorization'] = 'Bearer ' + tk; return h; }
  var dev = localStorage.getItem('bnAdminDevUser');
  if (dev && window.__ADMIN__ && window.__ADMIN__.devMode) { h['X-Dev-User'] = dev; return h; }
  try { if (window.Clerk && window.Clerk.session) { var t = await window.Clerk.session.getToken(); if (t) h['Authorization'] = 'Bearer ' + t; } } catch (e) {}
  return h;
}
async function download(path, toast){
  try {
    var res = await fetch(path + (path.indexOf('?') < 0 ? '?' : '&') + 'format=csv', { headers: await authHeaders({ 'Accept': 'text/csv' }) });
    if (!res.ok) throw new Error('Export failed (' + res.status + ')');
    var a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob());
    var m = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/); a.download = m ? m[1] : 'export.csv';
    document.body.appendChild(a); a.click(); a.remove();
  } catch (e) { toast(e.message, true); }
}

(window.__walletSections = window.__walletSections || []).push({ title: 'Gift catalogue', render: function(box, ctx){
  var h = ctx.h, api = ctx.api, toast = ctx.toast;
  var nav = h('div', { class: 'row', style: 'gap:6px;margin-bottom:12px' });
  var panel = h('div');
  box.appendChild(h('p', { class: 'meta', text: 'Virtual gifts are bought with Gifting Coins. Each gift is ONE ledger operation (ref gift:<id>): sender −value, BibleNestra commission (default 20%, rounded down), recipient +rest as pending gift earnings. Kingdom Coin gifts (legacy reward coins) are separate.' }));
  box.appendChild(nav); box.appendChild(panel);
  var TABS = [['Catalogue', catalogue], ['Gifts sent', sends], ['Commission', commission], ['Recipient earnings', earnings], ['Creator programme', programme], ['Withdrawals', withdrawals], ['Settings', settings]];
  var cur = TABS[0][0];
  function draw(){ nav.innerHTML = ''; TABS.forEach(function(t){ nav.appendChild(h('button', { class: 'btn small' + (t[0] === cur ? '' : ' ghost'), text: t[0], onclick: function(){ go(t[0]); } })); }); }
  function go(name, arg){ cur = name; draw(); panel.innerHTML = ''; var t = TABS.find(function(x){ return x[0] === name; }); try { t[1](panel, arg); } catch (e) { panel.appendChild(h('div', { class: 'card', text: 'Failed: ' + e.message })); } }
  function table(cols, rows){
    var t = h('table', { style: 'width:100%;border-collapse:collapse;font-size:13px' });
    t.appendChild(h('tr', {}, cols.map(function(c){ return h('th', { style: 'text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--muted);font-weight:600', text: c[0] }); })));
    rows.forEach(function(r){ t.appendChild(h('tr', {}, cols.map(function(c){ var v = c[1](r); return h('td', { style: 'padding:6px 8px;border-bottom:1px solid var(--border);vertical-align:top' }, [typeof v === 'object' && v ? v : String(v == null ? '' : v)]); }))); });
    return h('div', { class: 'card', style: 'overflow-x:auto;padding:8px' }, [t]);
  }
  function inp(ph, w, type){ return h('input', { placeholder: ph, type: type || 'text', style: 'width:' + (w || 140) + 'px' }); }
  function stat(label, value, sub){ return h('div', { class: 'card', style: 'flex:1;min-width:140px;margin:0' }, [h('div', { class: 'meta', text: label }), h('b', { style: 'font-size:19px', text: value }), sub ? h('div', { class: 'meta', text: sub }) : null]); }
  function person(u){ return u ? (u.displayName || '?') + (u.handle ? ' @' + u.handle : '') : '(deleted)'; }
  function userLink(u){ if (!u) return '(deleted)'; return h('a', { href: '#', text: person(u), onclick: function(e){ e.preventDefault(); ctx.open('Member', { q: u.id }); } }); }

  // ---------- catalogue ----------
  async function catalogue(el){
    var d; try { d = await api('GET', '/admin/api/gifts/catalogue'); } catch (e) { el.appendChild(h('div', { class: 'card', text: e.message })); return; }
    var rate = d.rate || { coins: 1, perMinor: 100 };
    el.appendChild(h('p', { class: 'meta', text: 'Conversion rate: ' + rate.coins + ' coin(s) = ' + naira(rate.perMinor) + ' (Settings). Coin cost “auto” follows the rate; set a number to fix it for one gift. Premium gifts play a full-screen animation. Upload PNG/WebP/JPEG art or an animated GIF/WebP to replace the built-in artwork.' }));
    el.appendChild(table([
      ['', function(g){ return g.imageUrl ? h('img', { src: g.imageUrl, style: 'width:40px;height:40px;object-fit:contain;border-radius:8px' }) : h('span', { class: 'chip mut', text: g.art }); }],
      ['Gift', function(g){ return h('div', {}, [h('b', { text: g.name }), h('div', { class: 'meta', text: g.id + (g.animationUrl ? ' · animation uploaded' : '') })]); }],
      ['Retail', function(g){ return naira(g.priceMinor); }],
      ['Coins', function(g){ return h('div', {}, [h('b', { text: num(g.coins) }), h('div', { class: 'meta', text: g.coinsOverride == null ? 'auto' : 'fixed' })]); }],
      ['Tier', function(g){ return g.tier; }],
      ['Where', function(g){ return (g.contexts || []).join(', '); }],
      ['Sent', function(g){ return num(g.stats.sent); }],
      ['Status', function(g){ return h('span', { class: 'chip' + (g.active ? '' : ' mut'), text: g.active ? 'Active' : 'Inactive' }); }],
      ['', function(g){ return h('div', { class: 'row', style: 'gap:4px' }, [
        h('button', { class: 'btn small ghost', text: 'Edit', onclick: function(){ form(el, g, d.contexts); } }),
        h('button', { class: 'btn small ghost', text: g.active ? 'Deactivate' : 'Activate', onclick: async function(){ try { await api('PATCH', '/admin/api/gifts/catalogue/' + g.id, { active: !g.active }); toast('Saved'); go('Catalogue'); } catch (e) { toast(e.message, true); } } }),
      ]); }],
    ], d.items));
    el.appendChild(h('button', { class: 'btn small', text: 'Add a gift', onclick: function(){ form(el, null, d.contexts); } }));
  }
  function form(el, g, contexts){
    var box = h('div', { class: 'card', style: 'margin-top:10px' });
    var id = inp('id (e.g. dove)', 140); var name = inp('Name', 180); var desc = inp('Description', 260);
    var price = inp('Retail ₦', 110, 'number'); var coins = inp('Coins (empty = auto)', 150, 'number'); var sort = inp('Sort', 70, 'number');
    var tier = h('select', {}, [h('option', { value: 'standard', text: 'standard' }), h('option', { value: 'premium', text: 'premium (full-screen)' })]);
    var art = h('select', {}, ['star','flowers','heart','teddy','letter','diamond','crown','trophy','celebration','premium'].map(function(a){ return h('option', { value: a, text: 'art: ' + a }); }));
    var checks = {}; var ctxRow = h('div', { class: 'row', style: 'gap:10px' }, (contexts || []).map(function(cx){ var cb = h('input', { type: 'checkbox' }); checks[cx] = cb; return h('label', { class: 'meta' }, [cb, ' ' + cx]); }));
    if (g) { id.value = g.id; id.disabled = true; name.value = g.name; desc.value = g.description || ''; price.value = g.priceMinor / 100; coins.value = g.coinsOverride == null ? '' : g.coinsOverride; sort.value = g.sort; tier.value = g.tier; art.value = g.art; }
    (contexts || []).forEach(function(cx){ checks[cx].checked = !g || (g.contexts || []).indexOf(cx) >= 0; });
    box.appendChild(h('b', { text: g ? 'Edit ' + g.name : 'New gift' }));
    box.appendChild(h('div', { class: 'row', style: 'gap:8px;margin-top:8px;flex-wrap:wrap' }, [id, name, desc, price, coins, sort, tier, art]));
    box.appendChild(h('div', { style: 'margin-top:8px' }, [h('span', { class: 'meta', text: 'Can be sent in: ' }), ctxRow]));
    var save = h('button', { class: 'btn small', text: 'Save', onclick: async function(){
      var b = { name: name.value.trim(), description: desc.value.trim(), priceMinor: Math.round(parseFloat(price.value || '0') * 100), coins: coins.value === '' ? null : parseInt(coins.value, 10), sort: parseInt(sort.value || '0', 10), tier: tier.value, art: art.value,
        contexts: Object.keys(checks).filter(function(k){ return checks[k].checked; }) };
      try { if (g) await api('PATCH', '/admin/api/gifts/catalogue/' + g.id, b); else { b.id = id.value.trim(); await api('POST', '/admin/api/gifts/catalogue', b); } toast('Saved'); go('Catalogue'); } catch (e) { toast(e.message, true); }
    } });
    box.appendChild(h('div', { class: 'row', style: 'gap:8px;margin-top:10px' }, [save, h('button', { class: 'btn small ghost', text: 'Cancel', onclick: function(){ box.remove(); } })]));
    if (g) {
      ['image', 'animation'].forEach(function(slot){
        var f = h('input', { type: 'file', accept: 'image/png,image/webp,image/gif,image/jpeg' });
        f.onchange = async function(){
          var file = f.files[0]; if (!file) return;
          try {
            var res = await fetch('/admin/api/gifts/catalogue/' + g.id + '/art?slot=' + slot, { method: 'POST', headers: await authHeaders({ 'Content-Type': file.type || 'image/png' }), body: file });
            var j = await res.json(); if (!res.ok) throw new Error(j.error || 'Upload failed'); toast('Uploaded'); go('Catalogue');
          } catch (e) { toast(e.message, true); }
        };
        var has = slot === 'image' ? g.imageUrl : g.animationUrl;
        box.appendChild(h('div', { class: 'row', style: 'gap:8px;margin-top:8px;align-items:center' }, [
          h('span', { class: 'meta', text: (slot === 'image' ? 'Replacement image: ' : 'Animation (animated GIF / WebP): ') + (has ? 'uploaded' : 'built-in art') }), f,
          has ? h('button', { class: 'btn small ghost', text: 'Remove', onclick: async function(){ try { await api('DELETE', '/admin/api/gifts/catalogue/' + g.id + '/art?slot=' + slot); toast('Removed'); go('Catalogue'); } catch (e) { toast(e.message, true); } } }) : null,
        ]));
      });
    }
    el.appendChild(box);
  }

  // ---------- all gifts sent / received ----------
  function sends(el, preset){
    var p = preset || {};
    var fq = inp('user id or @handle', 200); fq.value = p.q || '';
    var role = h('select', {}, [h('option', { value: '', text: 'sent or received' }), h('option', { value: 'sent', text: 'sent by' }), h('option', { value: 'received', text: 'received by' })]);
    var fref = inp('reference (gift:…)', 200); var fgift = inp('gift id', 100);
    var fctx = h('select', {}, [h('option', { value: '', text: 'any context' })].concat(['chat','profile','live','post'].map(function(x){ return h('option', { value: x, text: x }); })));
    var ffrom = inp('', 140, 'date'); var fto = inp('', 140, 'date');
    var out = h('div'); var offset = 0;
    function params(){ return { q: fq.value.trim(), role: role.value, ref: fref.value.trim(), giftId: fgift.value.trim(), context: fctx.value, from: ffrom.value, to: fto.value ? fto.value + 'T23:59:59Z' : '' }; }
    async function load(more){
      if (!more) { offset = 0; out.innerHTML = ''; }
      var q = params(); q.offset = offset;
      var d; try { d = await api('GET', '/admin/api/gifts/sends' + qs(q)); } catch (e) { toast(e.message, true); return; }
      out.appendChild(table([
        ['When', function(s){ return when(s.createdAt); }], ['Gift', function(s){ return s.giftName; }], ['Coins', function(s){ return num(s.coins); }],
        ['Commission', function(s){ return num(s.commission) + ' (' + s.commissionPct + '%)'; }], ['Earnings', function(s){ return num(s.earnings); }],
        ['From', function(s){ return userLink(s.sender); }], ['To', function(s){ return userLink(s.recipient); }],
        ['Where', function(s){ return s.context.type; }], ['Reference', function(s){ return h('a', { href: '#', text: s.ref, onclick: function(e){ e.preventDefault(); ctx.open('Ledger search', { ref: s.ref }); } }); }],
      ], d.items));
      if (!d.items.length && !more) out.appendChild(h('div', { class: 'card empty', text: 'No gifts match.' }));
      if (d.nextOffset != null) { offset = d.nextOffset; out.appendChild(h('button', { class: 'btn small ghost', text: 'More', onclick: function(){ this.remove(); load(true); } })); }
    }
    el.appendChild(h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;margin-bottom:10px' }, [fq, role, fref, fgift, fctx, ffrom, fto,
      h('button', { class: 'btn small', text: 'Search', onclick: function(){ load(false); } }),
      h('button', { class: 'btn small ghost', text: 'CSV', onclick: function(){ download('/admin/api/gifts/sends' + qs(params()), toast); } })]));
    el.appendChild(out); load(false);
  }

  // ---------- commission ledger ----------
  async function commission(el, preset){
    var group = (preset && preset.group) || 'day';
    var d; try { d = await api('GET', '/admin/api/gifts/commission' + qs({ group: group })); } catch (e) { el.appendChild(h('div', { class: 'card', text: e.message })); return; }
    var r = d.reconciliation;
    el.appendChild(h('div', { class: 'card', style: r.ok && d.integrity.ok ? '' : 'border-color:var(--neg)' }, [
      h('span', { class: 'chip' + (r.ok ? '' : ' neg'), text: r.ok ? 'Gifts reconcile with the ledger' : 'Gift reconciliation mismatch' }),
      h('span', { class: 'chip' + (d.integrity.ok ? '' : ' neg'), style: 'margin-left:6px', text: d.integrity.ok ? 'Ledger integrity OK' : 'Ledger integrity mismatch' }),
      h('div', { class: 'meta', style: 'margin-top:6px', text: r.giftRows + ' gifts / ' + r.ledgerOps + ' ledger ops · coins ' + num(r.coins.rows) + ' / ' + num(r.coins.ledger) + ' · commission ' + num(r.commission.rows) + ' / ' + num(r.commission.ledger) + ' (platform balance ' + num(r.commission.platformBalance) + ') · earnings ' + num(r.earnings.rows) + ' / ' + num(r.earnings.ledger) }),
    ]));
    var tot = d.periods.reduce(function(a, p){ a.g += p.gifts; a.c += p.coins; a.m += p.commission; a.e += p.earnings; return a; }, { g: 0, c: 0, m: 0, e: 0 });
    el.appendChild(h('div', { class: 'row', style: 'gap:10px;margin-bottom:10px' }, [stat('Gifts', num(tot.g)), stat('Gift value (coins)', num(tot.c)), stat('BibleNestra commission', num(tot.m), 'current rate ' + (d.commissionBps / 100) + '%'), stat('Recipient earnings', num(tot.e))]));
    el.appendChild(h('div', { class: 'row', style: 'gap:6px;margin-bottom:8px' }, [
      h('button', { class: 'btn small' + (group === 'day' ? '' : ' ghost'), text: 'By day', onclick: function(){ go('Commission', { group: 'day' }); } }),
      h('button', { class: 'btn small' + (group === 'month' ? '' : ' ghost'), text: 'By month', onclick: function(){ go('Commission', { group: 'month' }); } }),
      h('button', { class: 'btn small ghost', text: 'CSV', onclick: function(){ download('/admin/api/gifts/commission' + qs({ group: group }), toast); } }),
      h('button', { class: 'btn small ghost', text: 'Commission ledger entries', onclick: function(){ ctx.open('Ledger search', { q: 'platform', wallet: 'commission_gift_coins' }); } }),
    ]));
    el.appendChild(table([['Period', function(p){ return p.period.slice(0, group === 'month' ? 7 : 10); }], ['Gifts', function(p){ return num(p.gifts); }], ['Coins', function(p){ return num(p.coins); }], ['Commission', function(p){ return num(p.commission); }], ['Earnings', function(p){ return num(p.earnings); }]], d.periods));
    el.appendChild(h('h3', { text: 'Per gift' }));
    el.appendChild(table([['Gift', function(p){ return p.name; }], ['Gifts', function(p){ return num(p.gifts); }], ['Coins', function(p){ return num(p.coins); }], ['Commission', function(p){ return num(p.commission); }], ['Earnings', function(p){ return num(p.earnings); }]], d.perGift));
  }

  // ---------- recipient earnings ----------
  function earnings(el){
    var fq = inp('user id or @handle', 220); var out = h('div');
    async function load(){
      out.innerHTML = '';
      var d; try { d = await api('GET', '/admin/api/gifts/earnings' + qs({ q: fq.value.trim() })); } catch (e) { toast(e.message, true); return; }
      out.appendChild(table([
        ['Member', function(r){ return userLink(r.user); }], ['Gifts', function(r){ return num(r.gifts); }], ['Gift value', function(r){ return num(r.value); }], ['Earned (80%)', function(r){ return num(r.earnings); }],
        ['Pending', function(r){ return num(r.balances.pending); }], ['Available', function(r){ return num(r.balances.available); }], ['Withdrawing', function(r){ return num(r.balances.withdrawing); }], ['Withdrawn', function(r){ return num(r.balances.withdrawn); }],
        ['Programme', function(r){ return r.programme; }],
        ['', function(r){ return h('button', { class: 'btn small ghost', text: 'Gifts', onclick: function(){ go('Gifts sent', { q: r.user.id }); } }); }],
      ], d.items));
      if (!d.items.length) out.appendChild(h('div', { class: 'card empty', text: 'No recipients yet.' }));
    }
    el.appendChild(h('div', { class: 'row', style: 'gap:6px;margin-bottom:10px' }, [fq, h('button', { class: 'btn small', text: 'Search', onclick: load })]));
    el.appendChild(out); load();
  }

  // ---------- creator payout programme ----------
  async function programme(el, preset){
    var status = (preset && preset.status != null) ? preset.status : 'pending';
    el.appendChild(h('div', { class: 'row', style: 'gap:6px;margin-bottom:10px' }, ['pending', 'approved', 'rejected', 'suspended', ''].map(function(s){ return h('button', { class: 'btn small' + (s === status ? '' : ' ghost'), text: s || 'all', onclick: function(){ go('Creator programme', { status: s }); } }); })));
    var d; try { d = await api('GET', '/admin/api/gifts/programme' + qs({ status: status })); } catch (e) { el.appendChild(h('div', { class: 'card', text: e.message })); return; }
    if (!d.items.length) { el.appendChild(h('div', { class: 'card empty', text: 'No applications.' })); return; }
    el.appendChild(table([
      ['Member', function(p){ return userLink(p.user); }], ['Applied', function(p){ return when(p.appliedAt); }], ['Legal name', function(p){ return p.legalName; }],
      ['Bank', function(p){ return p.bankName + ' · ' + p.accountName + ' · ' + p.accountNumber + ' (' + p.country + ')'; }], ['About', function(p){ return p.about || ''; }],
      ['Status', function(p){ return h('span', { class: 'chip' + (p.status === 'approved' ? '' : ' mut'), text: p.status }); }],
      ['', function(p){
        function act(st){ return h('button', { class: 'btn small' + (st === 'approved' ? '' : ' ghost'), text: st === 'approved' ? 'Approve' : st === 'rejected' ? 'Reject' : 'Suspend', onclick: async function(){
          var note = st === 'approved' ? '' : prompt('Reason (the member sees it)'); if (st !== 'approved' && !note) return;
          try { await api('POST', '/admin/api/gifts/programme/' + p.userId, { status: st, note: note }); toast('Saved'); go('Creator programme', { status: status }); } catch (e) { toast(e.message, true); }
        } }); }
        return h('div', { class: 'row', style: 'gap:4px' }, [p.status !== 'approved' ? act('approved') : null, p.status === 'pending' ? act('rejected') : null, p.status === 'approved' ? act('suspended') : null]);
      }],
    ], d.items));
  }

  // ---------- withdrawal queue ----------
  async function withdrawals(el, preset){
    var status = (preset && preset.status != null) ? preset.status : 'requested';
    var d; try { d = await api('GET', '/admin/api/gifts/withdrawals' + qs({ status: status })); } catch (e) { el.appendChild(h('div', { class: 'card', text: e.message })); return; }
    el.appendChild(h('div', { class: 'card', style: d.withdrawalsEnabled ? '' : 'border-color:var(--gold)' }, [h('b', { text: d.withdrawalsEnabled ? 'Withdrawals are OPEN for approved creators.' : 'Withdrawals are CLOSED (members can’t request).' }),
      h('div', { class: 'meta', text: 'No automatic cash-out: approve, pay by bank transfer yourself, then mark paid with the transfer reference. Rejecting returns the coins to the member’s available earnings. 1 earned coin = ' + naira(d.payoutRate.minorPerCoin) + ' · minimum ' + num(d.minWithdrawal) + ' coins. Switch: Wallets & payments › Settings.' })]));
    el.appendChild(h('div', { class: 'row', style: 'gap:6px;margin-bottom:10px' }, ['requested', 'approved', 'paid', 'rejected', ''].map(function(s){ return h('button', { class: 'btn small' + (s === status ? '' : ' ghost'), text: s || 'all', onclick: function(){ go('Withdrawals', { status: s }); } }); })));
    if (!d.items.length) { el.appendChild(h('div', { class: 'card empty', text: 'Nothing here.' })); return; }
    el.appendChild(table([
      ['Requested', function(w){ return when(w.createdAt); }], ['Member', function(w){ return userLink(w.user); }], ['Coins', function(w){ return num(w.coins); }], ['Pay', function(w){ return naira(w.payoutMinor); }],
      ['To', function(w){ var p = w.payoutTo || {}; return (p.legalName || '') + ' · ' + (p.bankName || '') + ' · ' + (p.accountName || '') + ' · ' + (p.accountNumber || ''); }],
      ['Status', function(w){ return h('div', {}, [h('span', { class: 'chip' + (w.status === 'paid' ? '' : ' mut'), text: w.status }), w.reference ? h('div', { class: 'meta', text: 'ref ' + w.reference }) : null, w.adminNote ? h('div', { class: 'meta', text: w.adminNote }) : null]); }],
      ['', function(w){
        async function act(a, b){ try { await api('POST', '/admin/api/gifts/withdrawals/' + w.id + '/' + a, b || {}); toast('Saved'); go('Withdrawals', { status: status }); } catch (e) { toast(e.message, true); } }
        return h('div', { class: 'row', style: 'gap:4px' }, [
          w.status === 'requested' ? h('button', { class: 'btn small', text: 'Approve', onclick: function(){ act('approve'); } }) : null,
          w.status === 'approved' ? h('button', { class: 'btn small', text: 'Mark paid', onclick: function(){ var ref = prompt('Bank transfer reference'); if (ref) act('paid', { reference: ref }); } }) : null,
          (w.status === 'requested' || w.status === 'approved') ? h('button', { class: 'btn small ghost', text: 'Reject', onclick: function(){ var n = prompt('Reason (the member sees it)'); if (n) act('reject', { note: n }); } }) : null,
        ]);
      }],
    ], d.items));
  }

  // ---------- settings (stored in wallet_config) ----------
  async function settings(el){
    var d; try { d = await api('GET', '/admin/api/wallet/config'); } catch (e) { el.appendChild(h('div', { class: 'card', text: e.message })); return; }
    var c = d.config;
    function save(key, value){ return api('PUT', '/admin/api/wallet/config', { key: key, value: value }).then(function(){ toast('Saved'); }).catch(function(e){ toast(e.message, true); }); }
    function row(title, hint, inputs, onSave){ el.appendChild(h('div', { class: 'card' }, [h('b', { text: title }), h('div', { class: 'meta', text: hint }), h('div', { class: 'row', style: 'gap:8px;margin-top:8px' }, inputs.concat([h('button', { class: 'btn small', text: 'Save', onclick: onSave })]))])); }
    var pct = inp('%', 80, 'number'); pct.value = c.gift_commission_bps / 100;
    row('Commission on gifts', 'BibleNestra keeps this share of each gift (client spec: 20%). Commission is rounded DOWN to whole coins; the recipient gets the rest. A change applies only to gifts sent after it — every gift stores its own rate.', [pct, h('span', { class: 'meta', text: '%' })], function(){ save('gift_commission_bps', Math.round(parseFloat(pct.value) * 100)); });
    var en = h('input', { type: 'checkbox' }); en.checked = c.gifts_enabled !== false;
    row('Gifting on', 'Turn off to pause all new gifts (kill switch). Nothing is charged while paused.', [en, h('span', { class: 'meta', text: 'Gifts enabled' })], function(){ save('gifts_enabled', en.checked); });
    var lim = inp('coins', 120, 'number'); lim.value = c.gift_daily_coin_limit;
    row('Daily gifting limit per member', 'Anti-fraud: the most Gifting Coins one member can send in 24 hours (0 = no limit).', [lim], function(){ save('gift_daily_coin_limit', parseInt(lim.value, 10)); });
    var adm = h('input', { type: 'checkbox' }); adm.checked = !!c.gift_admins_can_receive;
    row('Admin accounts can receive gifts', 'Off by default: platform / admin accounts are not eligible gift recipients.', [adm, h('span', { class: 'meta', text: 'Allow' })], function(){ save('gift_admins_can_receive', adm.checked); });
    el.appendChild(h('p', { class: 'meta', text: 'Conversion rate, earnings hold period, payout value, minimum withdrawal and the withdrawals switch are in Wallets & payments › Settings.' }));
  }

  draw(); go(cur);
}});
})();
`;
