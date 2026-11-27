// FUND ME MONEY: the "Donations & payouts" section of Admin › Wallets & payments (wallet-core.md §9 hook point).
// Registered with registerAdminScript() from routes/fundmeMoney.js. Plain JS in a string: NO backticks and no dollar-brace
// inside. Uses ctx = { api, toast, esc, h, open } from the wallet tab; h() builds DOM with textContent (no HTML injection).
// Views: Donations (filters, CSV, detail + fee breakdown + status history + actions) · Due this run (monthly payouts,
// mark paid by hand) · Payout queue · Payouts · KYC (payout identity checks) · Reconciliation · Suspicious · Moderation ·
// Bank accounts · Credits · Rules.
export const FUNDME_MONEY_ADMIN_SCRIPT = `
(function(){
var SYM = { NGN: '₦', GBP: '£', USD: '$', EUR: '€' };
function money(m, cur){ return (SYM[cur] || ((cur || '') + ' ')) + (Number(m || 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
function feeLine(x){
  if (!x || !x.fees) return '';
  var o = x.original || {}, ch = x.charged || {};
  return 'Donor gave ' + money(o.amountMinor, o.currency) + (o.currency !== 'NGN' && o.fxRate ? ' at ₦' + o.fxRate + '/' + o.currency : '') +
    ' · charged ' + money(ch.amountMinor, ch.currency) + ' · BibleNestra fee ' + money(x.fees.platformMinor, x.fees.currency) +
    ' · Paystack fee (est.) ' + money(x.fees.processingMinor, x.fees.currency) + ' · VAT ' + money(x.fees.vatMinor, x.fees.currency) +
    ' · ' + (x.coverFees ? 'donor covered the fees' : 'fees taken from the gift');
}
function when(s){ if (!s) return '—'; return new Date(s).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function qs(o){ var p = []; Object.keys(o).forEach(function(k){ if (o[k] !== '' && o[k] != null) p.push(encodeURIComponent(k) + '=' + encodeURIComponent(o[k])); }); return p.length ? '?' + p.join('&') : ''; }
var STATUS = [['', 'All'], ['pending', 'Pending'], ['processing', 'Processing'], ['under_review', 'Under review'], ['verified', 'Verified'], ['approved_for_payout', 'Approved for payout'], ['paid', 'Paid'], ['refunded', 'Refunded'], ['failed', 'Failed'], ['flagged', 'Flagged']];
var CHIP = { pending: 'mut', processing: 'gold', under_review: 'neg', verified: '', approved_for_payout: 'gold', paid: '', refunded: 'mut', failed: 'neg', approved: 'gold', requested: 'mut', cancelled: 'mut' };
async function csvHeaders(){
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
    var res = await fetch(path + (path.indexOf('?') < 0 ? '?' : '&') + 'format=csv', { headers: await csvHeaders() });
    if (!res.ok) throw new Error('Export failed (' + res.status + ')');
    var a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob());
    a.download = path.indexOf('reconciliation') >= 0 ? 'fundme-reconciliation.csv' : 'fundme-donations.csv';
    document.body.appendChild(a); a.click(); a.remove();
  } catch (e) { toast(e.message, true); }
}

(window.__walletSections = window.__walletSections || []).push({ title: 'Donations & payouts', render: function(box, ctx){
  var h = ctx.h, api = ctx.api, toast = ctx.toast;
  var VIEWS = ['Donations', 'Due this run', 'Payout queue', 'Payouts', 'KYC', 'Reconciliation', 'Suspicious', 'Moderation', 'Bank accounts', 'Credits', 'Rules'];
  var view = 'Donations';
  box.appendChild(h('p', { class: 'meta', text: 'Fund Me donations are paid to BibleNestra (Paystack) and held for the beneficiary. Flow: pending → processing (received) → verified → approved for payout → paid. Every action here is logged.' }));
  var nav = h('div', { class: 'row', style: 'gap:6px;margin:8px 0 12px' }); box.appendChild(nav);
  var panel = h('div'); box.appendChild(panel);
  function drawNav(){ nav.innerHTML = ''; VIEWS.forEach(function(v){ nav.appendChild(h('button', { class: 'btn small' + (v === view ? '' : ' ghost'), text: v, onclick: function(){ go(v); } })); }); }
  function go(v, arg){ view = v; drawNav(); panel.innerHTML = ''; try { R[v](panel, arg || {}); } catch (e) { panel.appendChild(h('div', { class: 'card', text: 'Failed: ' + e.message })); } }
  function loading(el){ el.innerHTML = ''; el.appendChild(h('div', { class: 'meta', text: 'Loading…' })); }
  function fail(el){ return function(e){ el.innerHTML = ''; el.appendChild(h('div', { class: 'card', text: e.message })); }; }
  function chip(s, label){ return h('span', { class: 'chip ' + (CHIP[s] || ''), text: label || String(s || '').replace(/_/g, ' ') }); }
  function table(cols, rows){
    var t = h('table', { class: 'tbl', style: 'width:100%;border-collapse:collapse;font-size:13px' });
    t.appendChild(h('tr', {}, cols.map(function(c){ return h('th', { style: 'text-align:left;padding:6px;border-bottom:1px solid var(--border)', text: c[0] }); })));
    rows.forEach(function(r){ t.appendChild(h('tr', {}, cols.map(function(c){ var v = c[1](r); return h('td', { style: 'padding:6px;border-bottom:1px solid var(--border);vertical-align:top' }, [typeof v === 'string' || typeof v === 'number' ? String(v) : v]); }))); });
    return h('div', { style: 'overflow-x:auto' }, [t]);
  }
  function flags(list){ return (list || []).length ? h('div', { class: 'row', style: 'gap:4px;flex-wrap:wrap' }, list.map(function(f){ return h('span', { class: 'chip neg', title: f.detail || '', text: f.label }); })) : ''; }
  function act(method, path, payload, done, after){ return function(ev){ var b = ev && ev.target; if (b) b.disabled = true; api(method, path, payload ? payload() : undefined).then(function(r){ toast(done); if (after) after(r); }).catch(function(e){ if (b) b.disabled = false; toast(e.message, true); }); }; }

  var R = {};
  // ── Donations ────────────────────────────────────────────────────────────────────────────────────────────────
  R['Donations'] = function(el, preset){
    var f = { status: preset.status || '', q: preset.q || '', beneficiary: preset.beneficiary || '', fundraiserId: preset.fundraiserId || '', from: '', to: '', test: '' };
    var sel = h('select', { onchange: function(){ f.status = sel.value; load(); } }, STATUS.map(function(s){ return h('option', { value: s[0], text: s[1], selected: s[0] === f.status }); }));
    var qi = h('input', { placeholder: 'Reference, donation id, receipt or donor email', value: f.q, style: 'min-width:240px' });
    var bi = h('input', { placeholder: 'Beneficiary uuid or @handle', value: f.beneficiary });
    var fi = h('input', { placeholder: 'Request id', value: f.fundraiserId });
    var from = h('input', { type: 'date' }), to = h('input', { type: 'date' });
    var test = h('select', {}, [h('option', { value: '', text: 'Real + test' }), h('option', { value: 'false', text: 'Real only' }), h('option', { value: 'true', text: 'Test only' })]);
    function read(){ f.q = qi.value.trim(); f.beneficiary = bi.value.trim(); f.fundraiserId = fi.value.trim(); f.from = from.value; f.to = to.value; f.test = test.value; }
    el.appendChild(h('div', { class: 'card row', style: 'gap:8px;flex-wrap:wrap' }, [sel, qi, bi, fi, from, to, test,
      h('button', { class: 'btn small', text: 'Search', onclick: function(){ read(); load(); } }),
      h('button', { class: 'btn small ghost', text: 'Export CSV', onclick: function(){ read(); downloadCsv('/admin/api/fundme/donations' + qs(f), toast); } })]));
    var list = h('div'); el.appendChild(list);
    function load(){
      loading(list);
      api('GET', '/admin/api/fundme/donations' + qs(f)).then(function(d){
        list.innerHTML = '';
        var counts = d.counts || {};
        list.appendChild(h('div', { class: 'meta', style: 'margin:6px 0', text: Object.keys(counts).map(function(k){ return k.replace(/_/g, ' ') + ' ' + counts[k]; }).join(' · ') }));
        if (!d.items.length) { list.appendChild(h('div', { class: 'card', text: 'No donations match.' })); return; }
        list.appendChild(table([
          ['When', function(x){ return when(x.createdAt); }],
          ['Amount', function(x){ return money(x.amountMinor, x.currency) + (x.feeMinor ? ' (fee ' + money(x.feeMinor, x.currency) + ')' : '') + (x.original && x.original.currency !== x.currency ? ' · gave ' + money(x.original.amountMinor, x.original.currency) : ''); }],
          ['Status', function(x){ return h('div', {}, [chip(x.status, x.statusLabel), x.test ? chip('mut', 'test') : '', flags(x.riskFlags)]); }],
          ['Request / beneficiary', function(x){ return (x.fundraiserTitle || '') + ' — ' + (x.beneficiaryName || x.beneficiaryId || ''); }],
          ['Donor', function(x){ return (x.name || '') + (x.donorEmail ? ' · ' + x.donorEmail : ''); }],
          ['Reference', function(x){ return x.reference || ''; }],
          ['', function(x){ return h('button', { class: 'btn small ghost', text: 'Open', onclick: function(){ detail(x.id); } }); }],
        ], d.items));
      }).catch(fail(list));
    }
    load();
  };
  function detail(id){
    var wrap = h('div', { class: 'card', style: 'margin-top:12px;border:2px solid var(--gold)' });
    panel.insertBefore(wrap, panel.firstChild); loading(wrap);
    api('GET', '/admin/api/fundme/donations/' + id).then(function(d){
      var x = d.donation; wrap.innerHTML = '';
      wrap.appendChild(h('div', { class: 'row' }, [h('b', { text: money(x.amountMinor, x.currency) + ' → ' + (x.fundraiserTitle || '') }), chip(x.status, x.statusLabel), h('button', { class: 'btn small ghost', text: 'Close', onclick: function(){ wrap.remove(); } })]));
      wrap.appendChild(h('div', { class: 'meta', text: 'Fee ' + money(x.feeMinor, x.currency) + ' · net held for beneficiary ' + money(x.netMinor, x.currency) + ' · provider ' + x.provider + (x.test ? ' (TEST — no money)' : '') + ' · ref ' + (x.reference || '—') + ' · receipt ' + (x.receiptNo || '—') }));
      wrap.appendChild(h('div', { class: 'meta', text: 'Donor ' + (x.name || '') + (x.donorId ? ' (' + x.donorId + ')' : ' (guest)') + ' · beneficiary ' + (x.beneficiaryName || '') + ' (' + (x.beneficiaryId || '') + ')' + (x.payoutId ? ' · in payout ' + x.payoutId : '') }));
      wrap.appendChild(h('div', { class: 'meta', text: feeLine(x) }));
      if ((x.riskFlags || []).length) wrap.appendChild(flags(x.riskFlags));
      wrap.appendChild(h('div', { class: 'eyebrow', style: 'margin-top:10px', text: 'Status history' }));
      wrap.appendChild(table([['When', function(e){ return when(e.at); }], ['Change', function(e){ return (e.from || '—') + ' → ' + e.to; }], ['By', function(e){ return e.actor + (e.actorName ? ' (' + e.actorName + ')' : ''); }], ['Why', function(e){ return e.reason || ''; }]], d.history));
      wrap.appendChild(h('div', { class: 'eyebrow', style: 'margin-top:10px', text: 'Ledger' }));
      wrap.appendChild(d.ledger.length ? table([['Ref', function(e){ return e.ref; }], ['Account', function(e){ return e.account; }], ['Wallet', function(e){ return e.wallet; }], ['Amount', function(e){ return String(e.amount); }], ['Kind', function(e){ return e.kind; }]], d.ledger) : h('div', { class: 'meta', text: 'Nothing recorded (not received).' }));
      var reason = h('input', { placeholder: 'Reason (logged; required for review / fail / refund)', style: 'min-width:280px' });
      var row = h('div', { class: 'row', style: 'margin-top:12px;gap:6px;flex-wrap:wrap' }, [reason]);
      var LABEL = { verify: 'Verify', approve: 'Approve for payout', unapprove: 'Back to verified', review: 'Put under review', fail: 'Mark failed', refund: 'Refund (record)', recheck: 'Re-check with Paystack' };
      d.actions.forEach(function(a){
        row.appendChild(h('button', { class: 'btn small' + (a === 'refund' || a === 'fail' ? ' danger' : a === 'verify' || a === 'approve' ? '' : ' ghost'), text: LABEL[a] || a, onclick: function(ev){
          if (a === 'refund' && !confirm('Donations are non-refundable to donors: refund ONLY for an error or fraud. Continue?')) return;
          if (a === 'refund' && !confirm('Record a refund of ' + money(x.amountMinor, x.currency) + '? Refund the donor in the Paystack dashboard too (or it is sent through Paystack when keys are set and you choose OK on the next question).')) return;
          var via = a === 'refund' && x.provider === 'paystack' ? confirm('Send the refund through Paystack now?') : false;
          act('POST', '/admin/api/fundme/donations/' + x.id + '/' + a, function(){ return { reason: reason.value.trim(), viaPaystack: via }; }, 'Done', function(){ wrap.remove(); detail(x.id); })(ev);
        } }));
      });
      wrap.appendChild(row);
    }).catch(fail(wrap));
  }

  // ── Due this run (monthly payouts) ───────────────────────────────────────────────────────────────────────────
  R['Due this run'] = function(el){
    loading(el);
    api('GET', '/admin/api/fundme/due').then(function(d){
      el.innerHTML = '';
      el.appendChild(h('div', { class: 'card' }, [
        h('b', { text: d.monthly ? 'Monthly run: ' + d.runDate + ' (day ' + d.payoutDay + ')' : 'On-demand payouts (no monthly run)' }),
        h('p', { class: 'meta', text: d.explain }),
        h('p', { class: 'meta', text: 'Totals: ' + (d.totals.length ? d.totals.map(function(t){ return money(t.readyMinor, t.currency) + ' ready (' + money(t.payableMinor, t.currency) + ' payable now, ' + t.payable + '/' + t.requests + ' requests) · ' + money(t.checkingMinor, t.currency) + ' still being checked'; }).join(' · ') : 'nothing due') + (d.lastRun ? ' · last run ' + d.lastRun.runDate + ': ' + d.lastRun.approved + ' approved' : '') }),
      ]));
      if (!d.items.length) { el.appendChild(h('div', { class: 'card', text: 'Nothing due in this run.' })); return; }
      d.items.forEach(function(x){
        var ref = h('input', { placeholder: 'Bank transfer reference', style: 'min-width:220px' });
        var note = h('input', { placeholder: 'Note (optional)' });
        el.appendChild(h('div', { class: 'card' }, [
          h('div', { class: 'row' }, [h('b', { text: money(x.readyMinor, x.currency) }), chip(x.payable ? 'verified' : 'under_review', x.payable ? 'payable' : 'blocked'), h('span', { class: 'meta', text: x.title + ' → ' + (x.beneficiaryName || '') + (x.beneficiaryHandle ? ' @' + x.beneficiaryHandle : '') })]),
          h('div', { class: 'meta', text: x.readyCount + ' verified donation(s) · ' + money(x.checkingMinor, x.currency) + ' still being checked (' + x.checkingCount + ') · KYC ' + x.kycStatus.replace('_', ' ') + ' · bank ' + (x.bank ? x.bank.status.replace('_', ' ') + ' ' + x.bank.bankName + ' •••• ' + x.bank.last4 : 'none') + ' · minimum ' + money(x.minPayoutMinor, x.currency) + (x.blockers.length ? ' · blocked: ' + x.blockers.join(', ') : '') + (x.openPayouts.length ? ' · open payouts: ' + x.openPayouts.map(function(p){ return money(p.amountMinor, p.currency) + ' ' + p.status; }).join(', ') : '') }),
          h('div', { class: 'row', style: 'gap:6px;margin-top:8px;flex-wrap:wrap' }, [ref, note,
            h('button', { class: 'btn small', text: 'Mark paid (paid by hand)', onclick: function(ev){ if (ref.value.trim().length < 4) { toast('Enter the bank transfer reference', true); return; } if (!confirm('Mark ' + money(x.readyMinor, x.currency) + ' to ' + (x.beneficiaryName || 'the beneficiary') + ' as PAID with reference ' + ref.value.trim() + '?')) return; act('POST', '/admin/api/fundme/due/' + x.fundraiserId + '/paid', function(){ return { reference: ref.value.trim(), note: note.value.trim() }; }, 'Marked paid — beneficiary notified', function(){ go('Due this run'); })(ev); } }),
            h('button', { class: 'btn small ghost', text: 'Donations', onclick: function(){ go('Donations', { fundraiserId: x.fundraiserId }); } }),
            x.kycStatus !== 'approved' ? h('button', { class: 'btn small ghost', text: 'KYC', onclick: function(){ go('KYC', { status: x.kycStatus === 'none' ? 'pending_review' : x.kycStatus }); } }) : '',
          ]),
        ]));
      });
    }).catch(fail(el));
  };

  // ── KYC (payout identity checks — Fund Me payouts AND gift-earnings withdrawals) ─────────────────────────────
  R['KYC'] = function(el, preset){
    var status = preset.status || 'pending_review';
    var bar = h('div', { class: 'row', style: 'gap:6px;margin-bottom:8px' }); el.appendChild(bar);
    var list = h('div'); el.appendChild(list); loading(list);
    api('GET', '/admin/api/fundme/kyc?status=' + status).then(function(d){
      [['pending_review', 'Waiting'], ['approved', 'Approved'], ['rejected', 'Rejected']].forEach(function(s){ bar.appendChild(h('button', { class: 'btn small' + (s[0] === status ? '' : ' ghost'), text: s[1] + (d.counts[s[0]] ? ' · ' + d.counts[s[0]] : ''), onclick: function(){ go('KYC', { status: s[0] }); } })); });
      list.innerHTML = '';
      list.appendChild(h('p', { class: 'meta', text: 'A payout (Fund Me) or gift-earnings withdrawal can only be approved for a member whose KYC is approved. The legal name must match the bank account name (same words, any order; middle names ignored). The automatic BVN / NIN lookup (Dojah) is an upcoming feature, so check every ID by hand. You still approve every one.' }));
      if (!d.items.length) { list.appendChild(h('div', { class: 'card', text: 'None.' })); return; }
      d.items.forEach(function(k){
        var note = h('input', { placeholder: 'Reason (to reject; the member sees it)', style: 'min-width:240px' });
        list.appendChild(h('div', { class: 'card' }, [
          h('div', { class: 'row' }, [h('b', { text: k.displayName + (k.handle ? ' @' + k.handle : '') }), chip(k.status === 'approved' ? 'verified' : k.status === 'rejected' ? 'failed' : 'under_review', k.statusLabel)]),
          h('div', { class: 'meta', text: k.idTypeLabel + ' ' + k.idNumberMasked + ' · legal name “' + k.legalName + '” · ' + k.bankName + ' ' + k.accountNumberMasked + ' “' + k.accountName + '” ' + (k.nameResolved ? '(name from Paystack)' : '(name typed by the member — check it)') + ' · name match ' + (k.nameMatch ? 'yes' : 'NO') + ' · submitted ' + when(k.submittedAt) + (k.fundmeBank ? ' · Fund Me bank ' + k.fundmeBank.status.replace('_', ' ') + (k.fundmeBank.sameAccount ? ' (same account)' : ' (DIFFERENT account)') : '') + (k.reviewNote ? ' · note: ' + k.reviewNote : '') }),
          k.idCheck ? h('div', { class: 'row', style: 'gap:6px;margin-top:6px;flex-wrap:wrap' }, [chip(k.idCheck.status === 'matched' ? 'verified' : 'under_review', 'ID check: ' + k.idCheck.label), h('span', { class: 'meta', text: (k.idCheck.note || '') + (k.idCheck.checkedAt ? ' · checked ' + when(k.idCheck.checkedAt) : '') })]) : '',
          h('div', { class: 'row', style: 'gap:6px;margin-top:8px;flex-wrap:wrap' }, [
            k.status !== 'approved' ? h('button', { class: 'btn small', text: 'Approve', onclick: act('POST', '/admin/api/fundme/kyc/' + k.userId + '/approve', null, 'Approved', function(){ go('KYC', { status: status }); }) }) : '',
            note,
            h('button', { class: 'btn small danger', text: 'Reject', onclick: function(ev){ if (note.value.trim().length < 3) { toast('Add a reason', true); return; } act('POST', '/admin/api/fundme/kyc/' + k.userId + '/reject', function(){ return { reason: note.value.trim() }; }, 'Rejected', function(){ go('KYC', { status: status }); })(ev); } }),
            h('button', { class: 'btn small ghost', text: 'Reveal ID + account (logged)', onclick: function(ev){ act('POST', '/admin/api/fundme/kyc/' + k.userId + '/reveal', null, 'Revealed', function(r){ ev.target.replaceWith(h('b', { text: r.idType.toUpperCase() + ' ' + r.idNumber + ' · account ' + r.accountNumber })); })(ev); } }),
          ]),
        ]));
      });
    }).catch(fail(list));
  };

  // ── Payout queue ─────────────────────────────────────────────────────────────────────────────────────────────
  R['Payout queue'] = function(el){
    loading(el);
    api('GET', '/admin/api/fundme/payout-queue').then(function(d){
      el.innerHTML = '';
      el.appendChild(h('p', { class: 'meta', text: 'Per request: money approved for payout (ready), verified money (approve it after the ' + d.holdDays + '-day hold), and money still being checked. A payout needs a verified bank account and the minimum amount.' }));
      if (!d.items.length) { el.appendChild(h('div', { class: 'card', text: 'Nothing waiting.' })); return; }
      el.appendChild(table([
        ['Request', function(x){ return x.title + (x.test ? ' (TEST)' : ''); }],
        ['Beneficiary', function(x){ return (x.beneficiaryName || '') + (x.beneficiaryHandle ? ' @' + x.beneficiaryHandle : ''); }],
        ['Bank', function(x){ return x.bank ? h('div', {}, [chip(x.bank.status === 'verified' ? 'verified' : 'under_review', x.bank.status.replace('_', ' ')), ' ' + x.bank.bankName + ' •••• ' + x.bank.last4]) : chip('failed', 'none'); }],
        ['Checking', function(x){ return money(x.checkingMinor, x.currency); }],
        ['Verified', function(x){ return money(x.verifiedMinor, x.currency) + (x.verifiedPastHold ? ' (' + x.verifiedPastHold + ' past hold)' : ''); }],
        ['Ready', function(x){ return money(x.readyMinor, x.currency) + ' · ' + x.readyCount; }],
        ['', function(x){ return h('div', { class: 'row', style: 'gap:4px' }, [
          x.verifiedPastHold && !x.test ? h('button', { class: 'btn small ghost', text: 'Approve past hold', onclick: act('POST', '/admin/api/fundme/fundraisers/' + x.fundraiserId + '/approve-donations', null, 'Approved', function(){ go('Payout queue'); }) }) : '',
          x.readyMinor ? h('button', { class: 'btn small', text: 'Create payout', onclick: act('POST', '/admin/api/fundme/payouts', function(){ return { fundraiserId: x.fundraiserId, test: x.test }; }, 'Payout created', function(){ go('Payouts', { status: 'approved' }); }) }) : '',
          h('button', { class: 'btn small ghost', text: 'Donations', onclick: function(){ go('Donations', { fundraiserId: x.fundraiserId }); } }),
        ]); }],
      ], d.items));
    }).catch(fail(el));
  };

  // ── Payouts ──────────────────────────────────────────────────────────────────────────────────────────────────
  R['Payouts'] = function(el, preset){
    var status = preset.status || '';
    var bar = h('div', { class: 'row', style: 'gap:6px;margin-bottom:8px' }); el.appendChild(bar);
    var list = h('div'); el.appendChild(list);
    function load(){
      loading(list);
      api('GET', '/admin/api/fundme/payouts' + qs({ status: status })).then(function(d){
        bar.innerHTML = '';
        [['', 'All'], ['approved', 'Ready to pay'], ['processing', 'Sending'], ['under_review', 'Under review'], ['paid', 'Paid'], ['failed', 'Failed']].forEach(function(s){
          bar.appendChild(h('button', { class: 'btn small' + (status === s[0] ? '' : ' ghost'), text: s[1] + (s[0] && d.counts[s[0]] ? ' · ' + d.counts[s[0]] : ''), onclick: function(){ status = s[0]; load(); } }));
        });
        list.innerHTML = '';
        if (!d.items.length) { list.appendChild(h('div', { class: 'card', text: 'No payouts.' })); return; }
        d.items.forEach(function(p){ list.appendChild(payoutCard(p, d.autoPayouts, load)); });
      }).catch(fail(list));
    }
    load();
  };
  function payoutCard(p, auto, reload){
    var more = h('div');
    var ref = h('input', { placeholder: 'Bank / Paystack payment reference', style: 'min-width:220px' });
    var why = h('input', { placeholder: 'Note or reason', style: 'min-width:200px' });
    var acts = h('div', { class: 'row', style: 'gap:6px;margin-top:8px;flex-wrap:wrap' });
    if (p.status === 'approved' || p.status === 'processing') {
      acts.appendChild(ref); acts.appendChild(why);
      acts.appendChild(h('button', { class: 'btn small', text: 'Mark paid', onclick: function(ev){ if (ref.value.trim().length < 4) { toast('Enter the payment reference', true); return; } act('POST', '/admin/api/fundme/payouts/' + p.id + '/paid', function(){ return { reference: ref.value.trim(), reason: why.value.trim() }; }, 'Marked paid — beneficiary notified', reload)(ev); } }));
      if (p.status === 'approved' && auto && !p.test) acts.appendChild(h('button', { class: 'btn small ghost', text: 'Send via Paystack Transfer', onclick: act('POST', '/admin/api/fundme/payouts/' + p.id + '/transfer', null, 'Transfer started', reload) }));
      if (p.status === 'approved') acts.appendChild(h('button', { class: 'btn small ghost', text: 'Put under review', onclick: act('POST', '/admin/api/fundme/payouts/' + p.id + '/review', function(){ return { reason: why.value.trim() }; }, 'Under review', reload) }));
    }
    if (p.status === 'under_review') { acts.appendChild(why); acts.appendChild(h('button', { class: 'btn small', text: 'Clear review', onclick: act('POST', '/admin/api/fundme/payouts/' + p.id + '/clear', function(){ return { reason: why.value.trim() }; }, 'Ready to pay', reload) })); }
    if (['approved', 'processing', 'under_review'].indexOf(p.status) >= 0) acts.appendChild(h('button', { class: 'btn small danger', text: 'Mark failed', onclick: function(ev){ if (why.value.trim().length < 3) { toast('Add a reason', true); return; } act('POST', '/admin/api/fundme/payouts/' + p.id + '/fail', function(){ return { reason: why.value.trim() }; }, 'Payout failed — donations back in the queue', reload)(ev); } }));
    return h('div', { class: 'card' }, [
      h('div', { class: 'row' }, [h('b', { text: money(p.amountMinor, p.currency) }), chip(p.status, p.statusLabel), p.test ? chip('mut', 'test') : '', h('span', { class: 'meta', text: (p.fundraiserTitle || '') + ' → ' + (p.beneficiaryName || '') + ' · ' + p.donations + ' donations' })]),
      h('div', { class: 'meta', text: (p.bank ? p.bank.bankName + ' •••• ' + p.bank.last4 + ' (' + p.bank.accountName + ')' : '') + ' · approved ' + when(p.approvedAt) + (p.paidAt ? ' · paid ' + when(p.paidAt) + ' ref ' + p.reference : '') + (p.failureReason ? ' · failed: ' + p.failureReason : '') }),
      acts,
      h('button', { class: 'btn small ghost', style: 'margin-top:6px', text: 'History & donations', onclick: function(){ if (more.childNodes.length) { more.innerHTML = ''; return; } loading(more); api('GET', '/admin/api/fundme/payouts/' + p.id).then(function(d){ more.innerHTML = '';
        more.appendChild(h('div', { class: 'meta', text: 'Held for beneficiary: ' + money(d.held.held, p.currency) + ' · promised to unpaid payouts: ' + money(d.held.open, p.currency) }));
        if (d.bankAccount) more.appendChild(h('div', { class: 'row', style: 'gap:6px' }, [h('span', { class: 'meta', text: 'Bank: ' + d.bankAccount.bankName + ' ' + d.bankAccount.accountNumberMasked + ' · ' + d.bankAccount.accountName + ' · ' + d.bankAccount.status }), h('button', { class: 'btn small ghost', text: 'Reveal full number (logged)', onclick: function(ev){ act('POST', '/admin/api/fundme/bank-accounts/' + p.beneficiaryId + '/reveal', null, 'Revealed', function(r){ ev.target.replaceWith(h('b', { text: r.accountNumber + ' · ' + r.bankName + ' (' + r.bankCode + ')' })); })(ev); } })]));
        more.appendChild(table([['When', function(e){ return when(e.at); }], ['Change', function(e){ return (e.from || '—') + ' → ' + e.to; }], ['By', function(e){ return e.actor + (e.actorName ? ' (' + e.actorName + ')' : ''); }], ['Why', function(e){ return e.reason || ''; }]], d.history));
        more.appendChild(table([['Donation', function(x){ return money(x.netMinor, x.currency) + ' net'; }], ['Status', function(x){ return chip(x.status, x.statusLabel); }], ['Reference', function(x){ return x.reference || ''; }]], d.donations));
      }).catch(fail(more)); } }),
      more,
    ]);
  }

  // ── Reconciliation ───────────────────────────────────────────────────────────────────────────────────────────
  R['Reconciliation'] = function(el){
    loading(el);
    api('GET', '/admin/api/fundme/reconciliation').then(function(d){
      el.innerHTML = '';
      el.appendChild(h('div', { class: 'card row' }, [chip(d.ok ? 'verified' : 'failed', d.ok ? 'Balanced' : 'Mismatch'), h('span', { class: 'meta', text: 'Received = held + paid out + fees + refunded, and each matches the ledger (ledger E / F). Ledger integrity: ' + (d.integrity.ok ? 'OK (' + d.integrity.checked + ' balances)' : d.integrity.mismatches.length + ' mismatches') }), h('button', { class: 'btn small ghost', text: 'Export CSV', onclick: function(){ downloadCsv('/admin/api/fundme/reconciliation', toast); } })]));
      if (!d.currencies.length) el.appendChild(h('div', { class: 'card', text: 'No donations received yet.' }));
      el.appendChild(table([
        ['Currency', function(x){ return x.currency; }], ['Received', function(x){ return money(x.receivedMinor, x.currency) + (x.testReceivedMinor ? ' (test ' + money(x.testReceivedMinor, x.currency) + ')' : ''); }],
        ['Held', function(x){ return money(x.heldMinor, x.currency) + ' (ledger ' + money(x.ledger.heldMinor, x.currency) + ')'; }],
        ['Paid out', function(x){ return money(x.paidMinor, x.currency) + ' (ledger ' + money(x.ledger.paidMinor, x.currency) + ')'; }],
        ['Fees', function(x){ return money(x.feesMinor, x.currency) + ' (ledger ' + money(x.ledger.feesMinor, x.currency) + ')'; }],
        ['Refunded', function(x){ return money(x.refundedMinor, x.currency); }], ['Under review', function(x){ return money(x.underReviewMinor, x.currency); }],
        ['Check', function(x){ return chip(x.ok ? 'verified' : 'failed', x.ok ? 'OK' : (x.balanced ? 'ledger differs' : 'not balanced')); }],
      ], d.currencies));
      el.appendChild(h('div', { class: 'eyebrow', style: 'margin-top:14px', text: 'Payouts' }));
      el.appendChild(table([['Currency', function(x){ return x.currency; }], ['Status', function(x){ return x.status; }], ['Count', function(x){ return String(x.count); }], ['Total', function(x){ return money(x.totalMinor, x.currency); }]], d.payouts));
      el.appendChild(h('div', { class: 'eyebrow', style: 'margin-top:14px', text: 'Per request' }));
      el.appendChild(table([
        ['Request', function(x){ return x.title + (x.hasTest ? ' (has test)' : ''); }], ['Beneficiary', function(x){ return x.beneficiaryName; }],
        ['Received', function(x){ return money(x.receivedMinor, x.currency); }], ['Held', function(x){ return money(x.heldMinor, x.currency); }], ['Paid', function(x){ return money(x.paidMinor, x.currency); }],
        ['Fees', function(x){ return money(x.feesMinor, x.currency); }], ['Refunded', function(x){ return money(x.refundedMinor, x.currency); }], ['', function(x){ return chip(x.balanced ? 'verified' : 'failed', x.balanced ? 'OK' : 'check'); }],
      ], d.perRequest));
    }).catch(fail(el));
  };

  // ── Suspicious ───────────────────────────────────────────────────────────────────────────────────────────────
  R['Suspicious'] = function(el){
    loading(el);
    api('GET', '/admin/api/fundme/suspicious').then(function(d){
      el.innerHTML = '';
      el.appendChild(h('div', { class: 'eyebrow', text: 'Donations under review or flagged · ' + d.donations.length }));
      el.appendChild(d.donations.length ? table([['When', function(x){ return when(x.createdAt); }], ['Amount', function(x){ return money(x.amountMinor, x.currency); }], ['Status', function(x){ return chip(x.status, x.statusLabel); }], ['Flags', function(x){ return flags(x.riskFlags); }], ['Request', function(x){ return x.fundraiserTitle || ''; }], ['', function(x){ return h('button', { class: 'btn small ghost', text: 'Open', onclick: function(){ go('Donations', {}); setTimeout(function(){ detail(x.id); }, 50); } }); }]], d.donations) : h('div', { class: 'meta', text: 'None.' }));
      el.appendChild(h('div', { class: 'eyebrow', style: 'margin-top:12px', text: 'Flagged requests · ' + d.requests.length }));
      el.appendChild(d.requests.length ? table([['Request', function(x){ return x.title; }], ['Status', function(x){ return chip(x.status); }], ['Organiser', function(x){ return x.ownerName; }], ['Flags', function(x){ return flags(x.riskFlags); }]], d.requests) : h('div', { class: 'meta', text: 'None.' }));
      el.appendChild(h('div', { class: 'eyebrow', style: 'margin-top:12px', text: 'Payouts under review · ' + d.payouts.length }));
      d.payouts.forEach(function(p){ el.appendChild(payoutCard(p, false, function(){ go('Suspicious'); })); });
      el.appendChild(h('div', { class: 'eyebrow', style: 'margin-top:12px', text: 'Bank details waiting for review · ' + d.bankAccounts.length }));
      if (d.bankAccounts.length) el.appendChild(h('button', { class: 'btn small ghost', text: 'Open bank accounts', onclick: function(){ go('Bank accounts'); } }));
    }).catch(fail(el));
  };

  // ── Moderation (Fund Me requests) ────────────────────────────────────────────────────────────────────────────
  R['Moderation'] = function(el){
    loading(el);
    api('GET', '/admin/api/fundme?status=pending_review').then(function(d){
      el.innerHTML = '';
      el.appendChild(h('p', { class: 'meta', text: 'Requests waiting for review, flagged ones first. Approving publishes the request and uses ' + 'the organiser’s publish credit in the same transaction; rejecting uses none. Full review with photos and documents: the “Fund Me approvals” tab.' }));
      if (!d.items.length) { el.appendChild(h('div', { class: 'card', text: 'Nothing waiting for review.' })); return; }
      d.items.forEach(function(f){
        var reason = h('input', { placeholder: 'Reason shown to the organiser (to reject)', style: 'min-width:240px' });
        el.appendChild(h('div', { class: 'card' }, [
          h('div', { class: 'row' }, [h('b', { text: f.title }), h('span', { class: 'meta', text: (f.owner ? f.owner.displayName : '') + ' · goal ' + money(f.goalMinor, f.currency) + ' · credits ' + f.ownerCredits + ' · submitted ' + when(f.submittedAt) })]),
          flags(f.riskFlags),
          h('div', { class: 'row', style: 'gap:6px;margin-top:8px' }, [
            h('button', { class: 'btn small', text: 'Approve & publish', onclick: act('POST', '/admin/api/fundme/' + f.id + '/approve', null, 'Published', function(){ go('Moderation'); }) }),
            reason,
            h('button', { class: 'btn small danger', text: 'Reject', onclick: function(ev){ if (reason.value.trim().length < 3) { toast('Add a reason', true); return; } act('POST', '/admin/api/fundme/' + f.id + '/reject', function(){ return { reason: reason.value.trim() }; }, 'Rejected', function(){ go('Moderation'); })(ev); } }),
          ]),
        ]));
      });
    }).catch(fail(el));
  };

  // ── Bank accounts ────────────────────────────────────────────────────────────────────────────────────────────
  R['Bank accounts'] = function(el, preset){
    var status = preset.status || 'pending_review';
    var bar = h('div', { class: 'row', style: 'gap:6px;margin-bottom:8px' }, [['pending_review', 'Waiting'], ['verified', 'Verified'], ['rejected', 'Rejected']].map(function(s){ return h('button', { class: 'btn small' + (s[0] === status ? '' : ' ghost'), text: s[1], onclick: function(){ go('Bank accounts', { status: s[0] }); } }); }));
    el.appendChild(bar); var list = h('div'); el.appendChild(list); loading(list);
    api('GET', '/admin/api/fundme/bank-accounts?status=' + status).then(function(d){
      list.innerHTML = '';
      if (!d.items.length) { list.appendChild(h('div', { class: 'card', text: 'None.' })); return; }
      d.items.forEach(function(a){
        var note = h('input', { placeholder: 'Reason (to reject)' });
        list.appendChild(h('div', { class: 'card' }, [
          h('div', { class: 'row' }, [h('b', { text: a.displayName + (a.handle ? ' @' + a.handle : '') }), chip(a.status === 'verified' ? 'verified' : a.status === 'rejected' ? 'failed' : 'under_review', a.status.replace('_', ' '))]),
          h('div', { class: 'meta', text: a.bankName + ' ' + a.accountNumberMasked + ' · name “' + a.accountName + '” ' + (a.nameResolved ? '(confirmed by Paystack)' : '(typed by the member — check it against their ID / request)') + ' · updated ' + when(a.updatedAt) }),
          h('div', { class: 'row', style: 'gap:6px;margin-top:8px' }, [
            a.status !== 'verified' ? h('button', { class: 'btn small', text: 'Verify', onclick: act('POST', '/admin/api/fundme/bank-accounts/' + a.userId + '/verify', null, 'Verified', function(){ go('Bank accounts', { status: status }); }) }) : '',
            note,
            h('button', { class: 'btn small danger', text: 'Reject', onclick: function(ev){ if (note.value.trim().length < 3) { toast('Add a reason', true); return; } act('POST', '/admin/api/fundme/bank-accounts/' + a.userId + '/reject', function(){ return { reason: note.value.trim() }; }, 'Rejected', function(){ go('Bank accounts', { status: status }); })(ev); } }),
            h('button', { class: 'btn small ghost', text: 'Reveal number (logged)', onclick: function(ev){ act('POST', '/admin/api/fundme/bank-accounts/' + a.userId + '/reveal', null, 'Revealed', function(r){ ev.target.replaceWith(h('b', { text: r.accountNumber })); })(ev); } }),
          ]),
        ]));
      });
    }).catch(fail(list));
  };

  // ── Credits (purchases, usage, gifts) — read from the core ledger ────────────────────────────────────────────
  R['Credits'] = function(el){
    var kinds = [['purchase', 'Purchases'], ['test_purchase', 'Test purchases'], ['fundme_publish', 'Used to publish'], ['fundme_credit_gift_sent', 'Gifted (sent)'], ['fundme_credit_gift_received', 'Gifted (received)'], ['admin_adjust', 'Adjustments']];
    var kind = 'fundme_publish';
    var user = h('input', { placeholder: 'Member uuid or @handle (optional)' });
    var bar = h('div', { class: 'row', style: 'gap:6px;margin-bottom:8px;flex-wrap:wrap' }); el.appendChild(bar);
    var list = h('div'); el.appendChild(list);
    function draw(){ bar.innerHTML = ''; kinds.forEach(function(k){ bar.appendChild(h('button', { class: 'btn small' + (k[0] === kind ? '' : ' ghost'), text: k[1], onclick: function(){ kind = k[0]; draw(); load(); } })); }); bar.appendChild(user); bar.appendChild(h('button', { class: 'btn small ghost', text: 'Search', onclick: load })); bar.appendChild(h('button', { class: 'btn small ghost', text: 'Open in Ledger search', onclick: function(){ ctx.open('Ledger search', { wallet: 'fundme_credits', kind: kind, q: user.value.trim() }); } })); }
    function load(){
      loading(list);
      api('GET', '/admin/api/wallet/entries' + qs({ wallet: 'fundme_credits', kind: kind, q: user.value.trim() })).then(function(d){
        list.innerHTML = '';
        var items = d.items || d.entries || [];
        if (!items.length) { list.appendChild(h('div', { class: 'card', text: 'No entries.' })); return; }
        list.appendChild(table([['When', function(e){ return when(e.createdAt || e.created_at); }], ['Member', function(e){ return (e.user && (e.user.displayName || e.user.handle)) || e.account || ''; }], ['Credits', function(e){ return String(e.amount); }], ['Balance after', function(e){ return String(e.balanceAfter != null ? e.balanceAfter : ''); }], ['Counterparty', function(e){ return e.counterparty ? (e.counterparty.name || e.counterparty.id) : ''; }], ['Ref', function(e){ return e.ref || ''; }]], items));
      }).catch(fail(list));
    }
    draw(); load();
  };

  // ── Live exchange rates (lib/fxLive.js): status, flagged currencies, Refresh now ─────────────────────────────
  function fxCard(fx, rules){
    var row = null; (rules || []).forEach(function(r){ if (r.key === 'fundme_fx_ngn_per_unit') row = r; });
    var table = row && row.value ? row.value : {};
    var src = fx.source === 'exchangerate-api' ? 'live (Exchange Rate API, open.er-api.com)' : fx.source === 'manual' ? 'typed by staff' : 'seeded defaults (never refreshed yet)';
    var kids = [
      h('div', { class: 'row' }, [h('b', { text: 'Exchange rates' }), chip(fx.auto ? 'verified' : 'under_review', fx.auto ? 'auto refresh on' : 'auto refresh off')]),
      h('div', { class: 'meta', text: 'Source: ' + src + ' · rates last updated ' + when(fx.ratesUpdatedAt) + ' · provider published ' + when(fx.providerUpdatedAt) + ' (next ' + when(fx.providerNextUpdateAt) + ') · last attempt ' + when(fx.lastAttemptAt) + ' · last success ' + when(fx.lastSuccessAt) }),
      h('div', { class: 'meta', text: fx.auto ? 'Auto is on: the cron refreshes these at most every ' + fx.refreshHours + ' hours, so a rate you type by hand is overwritten on the next refresh. A rate that moved more than ' + fx.maxMovePct + '% is not applied and is listed below.' : 'Auto is off: the rates below are only what staff type. Turn fundme_fx_auto on to keep them live.' }),
      h('div', { class: 'meta', text: 'Current: ' + Object.keys(table).map(function(k){ return k + ' ₦' + Number(table[k]).toLocaleString(undefined, { maximumFractionDigits: 4 }); }).join(' · ') }),
    ];
    if (fx.lastError) kids.push(h('div', { class: 'meta', style: 'color:var(--neg)', text: 'Last refresh failed: ' + fx.lastError }));
    if (fx.eolAt) kids.push(h('div', { class: 'meta', style: 'color:var(--neg);font-weight:700', text: 'Warning: the rate API says this endpoint reaches end of life on ' + when(fx.eolAt) + '. Plan another rate source.' }));
    (fx.flagged || []).forEach(function(f){
      var txt = f.reason === 'moved_over_25pct' ? f.currency + ': fetched ₦' + f.fetched + ' moved ' + f.changePct + '% from the stored ₦' + f.stored + ' — NOT applied, old rate kept. Check it and apply by hand if it is right.' : f.currency + ': no usable rate in the API reply (' + f.reason + ') — old rate kept.';
      var line = [h('span', { class: 'chip neg', text: 'flagged' }), h('span', { class: 'meta', text: txt })];
      if (f.fetched) line.push(h('button', { class: 'btn small ghost', text: 'Use ₦' + f.fetched, onclick: act('PUT', '/admin/api/fundme/rules', function(){ var v = {}; Object.keys(table).forEach(function(k){ v[k] = table[k]; }); v[f.currency] = f.fetched; return { key: 'fundme_fx_ngn_per_unit', value: v }; }, 'Saved', function(){ go('Rules'); }) }));
      kids.push(h('div', { class: 'row', style: 'gap:6px;margin-top:4px;flex-wrap:wrap' }, line));
    });
    kids.push(h('div', { class: 'row', style: 'gap:6px;margin-top:8px;flex-wrap:wrap;align-items:center' }, [
      h('button', { class: 'btn small', text: 'Refresh now', onclick: act('POST', '/admin/api/fundme/fx/refresh', null, 'Rates checked', function(r){ if (r && r.ok === false) toast(r.error || 'Refresh failed', true); go('Rules'); }) }),
      h('a', { href: 'https://www.exchangerate-api.com', target: '_blank', rel: 'noopener', class: 'meta', text: 'Rates by Exchange Rate API' }),
    ]));
    return h('div', { class: 'card' }, kids);
  }

  // ── Rules ────────────────────────────────────────────────────────────────────────────────────────────────────
  R['Rules'] = function(el){
    loading(el);
    api('GET', '/admin/api/fundme/rules').then(function(d){
      el.innerHTML = '';
      el.appendChild(h('div', { class: 'card meta', text: 'Paystack: ' + (d.env.paystack ? 'connected' : 'not set up (donations off unless test mode)') + ' · automatic payouts (FUNDME_AUTO_PAYOUTS): ' + (d.env.autoPayouts ? 'on' : 'off — pay by bank transfer and enter the reference') + ' · test donations: ' + (d.env.testDonations ? 'on for testers' : 'off') }));
      if (d.fx) el.appendChild(fxCard(d.fx, d.rules));
      d.rules.forEach(function(r){
        var input = h('input', { value: JSON.stringify(r.value), style: 'min-width:260px;font-family:monospace' });
        el.appendChild(h('div', { class: 'card' }, [
          h('div', { class: 'row' }, [h('b', { text: r.key }), h('span', { class: 'meta', text: r.label })]),
          h('div', { class: 'row', style: 'gap:6px;margin-top:6px' }, [input, h('button', { class: 'btn small', text: 'Save', onclick: function(ev){ var v; try { v = JSON.parse(input.value); } catch (e) { toast('Not valid JSON', true); return; } act('PUT', '/admin/api/fundme/rules', function(){ return { key: r.key, value: v }; }, 'Saved', function(){ go('Rules'); })(ev); } }), h('span', { class: 'meta', text: 'default ' + JSON.stringify(r.default) })]),
        ]));
      });
    }).catch(fail(el));
  };

  drawNav(); go(view);
}});
})();
`;
