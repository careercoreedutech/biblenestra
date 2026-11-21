// Admin section "Paystack" inside the "Wallets & payments" tab: setup status, the in-app payments switch, all Paystack
// payments (search, recheck, review queue) and BibleNestra Plus prices. Uses /admin/api/paystack/*.
// textContent-based DOM builder only. NOTE: plain JS in a string — no backticks, no "${", no backslashes inside.
export const PAYSTACK_ADMIN_SCRIPT = `
(function(){
function money(minor, cur){ return (cur === 'NGN' ? '₦' : (cur || '') + ' ') + (Number(minor || 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
function when(s){ if (!s) return '—'; return new Date(s).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
(window.__walletSections = window.__walletSections || []).push({ title: 'Paystack', render: function(box, ctx){
  var h = ctx.h, api = ctx.api, toast = ctx.toast;
  function table(cols, rows){
    var t = h('table', { style: 'width:100%;border-collapse:collapse;font-size:13px' });
    t.appendChild(h('tr', {}, cols.map(function(c){ return h('th', { style: 'text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--muted);font-weight:600', text: c[0] }); })));
    rows.forEach(function(r){ t.appendChild(h('tr', {}, cols.map(function(c){ var v = c[1](r); return h('td', { style: 'padding:6px 8px;border-bottom:1px solid var(--border);vertical-align:top' }, [typeof v === 'object' && v ? v : String(v == null ? '' : v)]); }))); });
    return h('div', { class: 'card', style: 'overflow-x:auto;padding:8px' }, [t]);
  }
  var top = h('div'); var pay = h('div'); var plus = h('div');
  box.appendChild(h('p', { class: 'meta', text: 'Every in-app purchase (coin, credit and gifting packs, Dating Plus / VIP, Memberships, BibleNestra Plus) is paid on Paystack’s page: card, bank transfer or USSD. Each payment is checked with Paystack on the server before anything is given, and only once. Card plans renew automatically; bank transfer / USSD plans get a reminder 3 days before they end.' }));
  box.appendChild(top); box.appendChild(pay); box.appendChild(plus);

  async function overview(){
    top.innerHTML = '';
    var d; try { d = await api('GET', '/admin/api/paystack/overview'); } catch (e) { top.appendChild(h('div', { class: 'card', text: e.message })); return; }
    var mode = !d.configured ? 'Not set up — add PAYSTACK_SECRET_KEY (wrangler secret)' : d.testMode ? 'TEST keys (no real money)' : 'LIVE keys';
    top.appendChild(h('div', { class: 'card' }, [
      h('div', {}, [h('b', { text: 'Status: ' }), h('span', { class: 'chip' + (d.configured ? '' : ' mut'), text: mode }), ' ', h('span', { class: 'meta', text: 'Currencies: ' + d.currencies.join(', ') })]),
      h('div', { class: 'meta', style: 'margin-top:6px', text: 'Webhook URL to paste in Paystack › Settings › API Keys & Webhooks: ' + d.webhookUrl }),
      h('div', { class: 'meta', text: 'Callback URL: ' + d.callbackUrl }),
      h('div', { class: 'row', style: 'gap:8px;margin-top:10px;align-items:center' }, [
        h('b', { text: 'In-app payments: ' + (d.inApp ? 'ON' : 'PAUSED') }),
        h('button', { class: 'btn small' + (d.inApp ? ' ghost' : ''), text: d.inApp ? 'Pause all in-app payments' : 'Turn in-app payments on', onclick: async function(){
          if (d.inApp && !confirm('Pause all in-app payments now? Members will see “Payments are paused”. Fund Me donations are not affected.')) return;
          try { await api('PUT', '/admin/api/paystack/in-app', { on: !d.inApp }); toast('Saved'); overview(); } catch (e) { toast(e.message, true); }
        } }),
      ]),
      h('div', { class: 'meta', style: 'margin-top:6px', text: 'Active Paystack plans — Dating: ' + d.active.dating + ' · Memberships: ' + d.active.memberships + ' · Plus: ' + d.active.plus + ' · Needs review: ' + d.active.review }),
    ]));
  }

  async function payments(filter){
    pay.innerHTML = '';
    var qIn = h('input', { placeholder: 'reference, @handle, user id or email', style: 'width:260px' });
    var st = h('select', {}, ['', 'pending', 'success', 'review', 'failed', 'abandoned', 'refunded'].map(function(s){ return h('option', { value: s, text: s || 'any status' }); }));
    var kd = h('select', {}, ['', 'wallet', 'membership', 'plus'].map(function(s){ return h('option', { value: s, text: s || 'any kind' }); }));
    if (filter) { qIn.value = filter.q || ''; st.value = filter.status || ''; kd.value = filter.kind || ''; }
    pay.appendChild(h('h3', { text: 'Payments' }));
    pay.appendChild(h('div', { class: 'row', style: 'gap:6px;margin-bottom:8px' }, [qIn, st, kd, h('button', { class: 'btn small', text: 'Search', onclick: function(){ payments({ q: qIn.value.trim(), status: st.value, kind: kd.value }); } })]));
    var qs = '?q=' + encodeURIComponent(qIn.value.trim()) + (st.value ? '&status=' + st.value : '') + (kd.value ? '&kind=' + kd.value : '');
    var d; try { d = await api('GET', '/admin/api/paystack/payments' + qs); } catch (e) { pay.appendChild(h('div', { class: 'card', text: e.message })); return; }
    if (!d.items.length) { pay.appendChild(h('div', { class: 'card meta', text: 'No payments yet.' })); return; }
    pay.appendChild(table([
      ['When', function(p){ return when(p.createdAt); }],
      ['Member', function(p){ return p.user ? (p.user.name || '?') + (p.user.handle ? ' @' + p.user.handle : '') : '—'; }],
      ['What', function(p){ return h('div', {}, [h('b', { text: p.title || p.kind }), h('div', { class: 'meta', text: p.kind + (p.purpose === 'renewal' ? ' · renewal' : '') })]); }],
      ['Amount', function(p){ return money(p.amountMinor, p.currency) + (p.test ? ' (test)' : ''); }],
      ['Status', function(p){ return h('span', { class: 'chip' + (p.status === 'success' ? '' : ' mut'), text: p.status }); }],
      ['Channel', function(p){ return p.channel || '—'; }],
      ['Reference', function(p){ return h('div', {}, [h('code', { text: p.reference }), p.error ? h('div', { class: 'meta', text: p.error }) : null]); }],
      ['', function(p){ return ['success', 'refunded'].indexOf(p.status) >= 0 ? '' : h('button', { class: 'btn small ghost', text: p.status === 'review' ? 'Retry grant' : 'Recheck', onclick: async function(){
        try { var r = await api('POST', '/admin/api/paystack/payments/' + encodeURIComponent(p.reference) + '/recheck'); toast('Now: ' + r.status); payments({ q: qIn.value.trim(), status: st.value, kind: kd.value }); } catch (e) { toast(e.message, true); }
      } }); }],
    ], d.items));
  }

  async function plusPlans(){
    plus.innerHTML = '';
    plus.appendChild(h('h3', { text: 'BibleNestra Plus prices' }));
    var d; try { d = await api('GET', '/admin/api/paystack/plus-plans'); } catch (e) { plus.appendChild(h('div', { class: 'card', text: e.message })); return; }
    d.items.forEach(function(p){
      var price = h('input', { type: 'number', value: String(p.priceMinor / 100), style: 'width:110px' });
      var label = h('input', { value: p.label, style: 'width:120px' });
      var note = h('input', { value: p.note || '', placeholder: 'note', style: 'width:200px' });
      var act = h('input', { type: 'checkbox' }); act.checked = p.active;
      plus.appendChild(h('div', { class: 'card row', style: 'gap:8px;align-items:center;flex-wrap:wrap' }, [
        h('b', { text: p.id + ' (' + p.interval + ')' }), label, h('span', { class: 'meta', text: p.currency }), price, note, h('label', { class: 'meta' }, [act, ' active']),
        h('button', { class: 'btn small', text: 'Save', onclick: async function(){
          try { await api('PATCH', '/admin/api/paystack/plus-plans/' + p.id, { priceMinor: Math.round(parseFloat(price.value || '0') * 100), label: label.value, note: note.value, active: act.checked }); toast('Saved'); plusPlans(); } catch (e) { toast(e.message, true); }
        } }),
        p.badge ? h('span', { class: 'chip', text: p.badge }) : null,
      ]));
    });
  }
  overview(); payments(); plusPlans();
} });
})();
`;
