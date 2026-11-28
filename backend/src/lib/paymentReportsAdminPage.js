// Admin section "Payment verification" inside the "Wallets & payments" tab: the Pending Payment Verification queue
// (receipt, reference, amount, Paystack check, approve / grant manually / reject), manual membership grants, and
// single-use membership invitation links. Uses /admin/api/payment-reports/*, /admin/api/membership-grants and
// /admin/api/membership-invites. textContent-based DOM builder only. NOTE: plain JS in a string — no backticks, no "${",
// no backslashes inside (the test suite checks this).
export const PAYMENT_REPORTS_ADMIN_SCRIPT = `
(function(){
function money(minor, cur){ return (cur === 'NGN' ? '₦' : (cur || '') + ' ') + (Number(minor || 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
function when(s){ if (!s) return '—'; return new Date(s).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function dateInput(h, value){ return h('input', { type: 'date', value: value || '' }); }
(window.__walletSections = window.__walletSections || []).push({ title: 'Payment verification', render: function(box, ctx){
  var h = ctx.h, api = ctx.api, toast = ctx.toast;
  var status = 'pending';
  var filterRow = h('div', { class: 'row', style: 'gap:6px;margin-bottom:8px;align-items:center' });
  var queueBox = h('div');
  var grantBox = h('div', { class: 'card', style: 'margin-top:14px' });
  var inviteBox = h('div', { class: 'card', style: 'margin-top:14px' });
  box.appendChild(h('p', { class: 'meta', text: 'A receipt never confirms a payment. Check the reference with Paystack first; approving grants access once, through the same path as the Paystack webhook.' }));
  box.appendChild(filterRow); box.appendChild(queueBox); box.appendChild(grantBox); box.appendChild(inviteBox);

  function buildFilters(){
    filterRow.innerHTML = '';
    ['pending', 'approved', 'rejected', 'all'].forEach(function(s){
      filterRow.appendChild(h('button', { class: 'btn small' + (s === status ? '' : ' ghost'), text: s === 'pending' ? 'Pending verification' : s[0].toUpperCase() + s.slice(1), onclick: function(){ status = s; buildFilters(); render(); } }));
    });
  }
  buildFilters();

  function row(label, value){ return h('div', { class: 'meta', style: 'margin-top:3px' }, [h('b', { text: label + ': ' }), String(value == null || value === '' ? '—' : value)]); }

  function verificationBlock(v){
    if (!v || !v.checkedAt) return h('div', { class: 'meta', text: 'Not checked with Paystack yet.' });
    var verdict = v.found && v.gatewayStatus === 'success' ? (v.alreadyCredited ? 'Successful · already credited' : (v.amountOk ? 'Successful · ready to approve' : 'Successful · amount is below the price')) : (v.found ? 'Paystack says: ' + (v.gatewayStatus || 'unknown') : 'Not found at Paystack' + (v.gatewayError ? ' (' + v.gatewayError + ')' : ''));
    return h('div', { class: 'card', style: 'margin-top:8px;padding:8px' }, [
      h('b', { text: verdict }),
      row('Paystack amount', v.paidMinor != null ? money(v.paidMinor, v.paidCurrency) : '—'),
      row('Price expected', money(v.expectedMinor, v.paidCurrency || 'NGN')),
      row('Claimed by member', money(v.claimedMinor, 'NGN')),
      row('Customer email', v.customerEmail),
      row('Paid at', when(v.paidAt)),
      row('Channel', v.channel),
      row('Already credited', v.alreadyCredited ? 'yes' : 'no'),
      row('Known to BibleNestra', v.knownHere ? ('yes (' + (v.localStatus || '') + ')') : 'no'),
      row('Checked', when(v.checkedAt)),
    ]);
  }

  function reportCard(r){
    var out = h('div', { class: 'card', style: 'margin-bottom:10px' });
    var vbox = h('div');
    vbox.appendChild(verificationBlock(r.verification));
    var pic = h('div', { class: 'meta', text: 'Receipt: not loaded' });
    var viewBtn = h('button', { class: 'btn small ghost', text: 'View receipt', onclick: async function(){
      try { var d = await api('GET', '/admin/api/payment-reports/' + r.id + '/receipt?format=json'); pic.innerHTML = ''; pic.appendChild(h('img', { src: d.dataUrl, style: 'max-width:240px;max-height:320px;border-radius:8px;border:1px solid var(--border)' })); }
      catch (e) { toast(e.message, true); }
    } });
    var reasonIn = h('input', { placeholder: 'reason (required)', style: 'width:260px' });
    var expIn = dateInput(h, '');
    var reject = h('button', { class: 'btn small ghost', text: 'Reject', onclick: async function(){
      var reason = reasonIn.value.trim();
      if (reason.length < 5) return toast('Write the reason (at least 5 characters)', true);
      try { await api('POST', '/admin/api/payment-reports/' + r.id + '/reject', { reason: reason }); toast('Rejected'); render(); } catch (e) { toast(e.message, true); }
    } });
    var check = h('button', { class: 'btn small', text: 'Verify with Paystack', onclick: async function(){
      try { var d = await api('POST', '/admin/api/payment-reports/' + r.id + '/check'); vbox.innerHTML = ''; vbox.appendChild(verificationBlock(d.verification)); toast('Checked with Paystack'); } catch (e) { toast(e.message, true); }
    } });
    var approve = h('button', { class: 'btn small', text: 'Approve (Paystack)', onclick: async function(){
      if (!confirm('Approve this payment? Access is granted once, only if Paystack confirms it.')) return;
      try { var d = await api('POST', '/admin/api/payment-reports/' + r.id + '/approve', { mode: 'paystack' }); toast('Approved: ' + d.decision); render(); } catch (e) { toast(e.message, true); }
    } });
    var manual = h('button', { class: 'btn small ghost', text: 'Grant manually', onclick: async function(){
      var reason = reasonIn.value.trim();
      if (reason.length < 10) return toast('Write the reason for the manual grant (at least 10 characters)', true);
      if (!expIn.value) return toast('Set the access expiry date', true);
      if (!confirm('Grant this membership by hand? This is audit-logged with your reason.')) return;
      try { await api('POST', '/admin/api/payment-reports/' + r.id + '/approve', { mode: 'manual', reason: reason, expiresAt: new Date(expIn.value + 'T23:59:59').toISOString() }); toast('Granted'); render(); } catch (e) { toast(e.message, true); }
    } });
    out.appendChild(h('div', { style: 'display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap' }, [
      h('div', {}, [pic, viewBtn]),
      h('div', { style: 'flex:1;min-width:240px' }, [
        h('div', {}, [h('b', { text: r.title || r.kind }), h('span', { class: 'chip mut', text: ' ' + r.status })]),
        row('Member', (r.userName || '?') + (r.userHandle ? ' @' + r.userHandle : '')),
        row('Reference', r.reference),
        row('Amount paid (claimed)', r.displayAmount),
        row('Method', r.method),
        row('Submitted', when(r.createdAt)),
        r.note ? row('Note', r.note) : null,
        vbox,
        status === 'pending' ? h('div', { class: 'row', style: 'gap:6px;margin-top:8px;flex-wrap:wrap;align-items:center' }, [check, approve, reasonIn, expIn, manual, reject]) : row('Decision', (r.decisionMethod || r.status) + (r.decisionReason ? ' · ' + r.decisionReason : '') + (r.accessExpiresAt ? ' · access until ' + when(r.accessExpiresAt) : '')),
      ]),
    ]));
    return out;
  }

  async function render(){
    queueBox.innerHTML = '';
    var d;
    try { d = await api('GET', '/admin/api/payment-reports?status=' + status); } catch (e) { queueBox.appendChild(h('div', { class: 'card', text: e.message })); return; }
    if (!d.items.length) queueBox.appendChild(h('div', { class: 'card meta', text: status === 'pending' ? 'Nothing waiting for verification.' : 'No reports here.' }));
    d.items.forEach(function(r){ queueBox.appendChild(reportCard(r)); });
  }

  async function memberships(){
    var d = await api('GET', '/memberships/manage');
    return (d.items || []).filter(function(m){ return m.status !== 'archived'; });
  }
  async function plansOf(membershipId){
    var m = await api('GET', '/memberships/manage/' + membershipId);
    return m.plans || [];
  }

  async function buildGrant(){
    grantBox.innerHTML = '';
    grantBox.appendChild(h('h3', { text: 'Grant a membership by hand' }));
    grantBox.appendChild(h('p', { class: 'meta', text: 'Choose the member (their @handle), the membership and plan, then the expiry. Audit-logged with your reason.' }));
    var handleIn = h('input', { placeholder: '@handle', style: 'width:180px' });
    var memSel = h('select', {}, [h('option', { value: '', text: 'Loading memberships…' })]);
    var planSel = h('select', {}, [h('option', { value: '', text: 'Choose a membership first' })]);
    var expIn = dateInput(h, '');
    var reasonIn = h('input', { placeholder: 'reason (min 10 characters)', style: 'width:300px' });
    var grantBtn = h('button', { class: 'btn small', text: 'Grant access', onclick: async function(){
      if (!handleIn.value.trim() || !memSel.value || !planSel.value || !expIn.value) return toast('Choose the member, membership, plan and expiry', true);
      if (reasonIn.value.trim().length < 10) return toast('Write the reason (at least 10 characters)', true);
      if (!confirm('Grant this membership to ' + handleIn.value.trim() + '?')) return;
      try { await api('POST', '/admin/api/membership-grants', { handle: handleIn.value.trim(), membershipId: memSel.value, planId: planSel.value, expiresAt: new Date(expIn.value + 'T23:59:59').toISOString(), reason: reasonIn.value.trim() }); toast('Granted'); handleIn.value = ''; reasonIn.value = ''; }
      catch (e) { toast(e.message, true); }
    } });
    try {
      var list = await memberships();
      memSel.innerHTML = '';
      memSel.appendChild(h('option', { value: '', text: 'Choose a membership' }));
      list.forEach(function(m){ memSel.appendChild(h('option', { value: m.id, text: m.title })); });
    } catch (e) { toast(e.message, true); }
    memSel.onchange = async function(){
      planSel.innerHTML = '';
      try { var plans = await plansOf(memSel.value); plans.forEach(function(p){ planSel.appendChild(h('option', { value: p.id, text: p.name || p.label || p.id })); }); }
      catch (e) { toast(e.message, true); }
    };
    grantBox.appendChild(h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;align-items:center' }, [handleIn, memSel, planSel, h('span', { class: 'meta', text: 'expires' }), expIn, reasonIn, grantBtn]));
  }

  async function buildInvites(){
    inviteBox.innerHTML = '';
    inviteBox.appendChild(h('h3', { text: 'Membership invitation link' }));
    inviteBox.appendChild(h('p', { class: 'meta', text: 'One-time link for a verified paying member. It is admitted only if their verified payment for this membership is on their account. The link expires.' }));
    var handleIn = h('input', { placeholder: '@handle (optional: leave empty for anyone verified)', style: 'width:300px' });
    var memSel = h('select', {}, [h('option', { value: '', text: 'Loading…' })]);
    var planSel = h('select', {}, [h('option', { value: '', text: 'Choose a membership first' })]);
    var hoursIn = h('input', { type: 'number', value: '48', min: '1', max: '168', style: 'width:90px' });
    var out = h('div', { class: 'meta' });
    var mk = h('button', { class: 'btn small', text: 'Create link', onclick: async function(){
      if (!memSel.value || !planSel.value) return toast('Choose the membership and plan', true);
      var body = { membershipId: memSel.value, planId: planSel.value, expiresInHours: Number(hoursIn.value) || 48 };
      if (handleIn.value.trim()) body.handle = handleIn.value.trim();
      try { var d = await api('POST', '/admin/api/membership-invites', body); out.innerHTML = ''; out.appendChild(h('code', { text: d.link })); out.appendChild(h('div', { class: 'meta', text: 'Expires ' + when(d.invite.expiresAt) + ' · shown once, copy it now' })); toast('Link created'); }
      catch (e) { toast(e.message, true); }
    } });
    try {
      var list = await memberships();
      memSel.innerHTML = '';
      memSel.appendChild(h('option', { value: '', text: 'Choose a membership' }));
      list.forEach(function(m){ memSel.appendChild(h('option', { value: m.id, text: m.title })); });
    } catch (e) { toast(e.message, true); }
    memSel.onchange = async function(){
      planSel.innerHTML = '';
      try { var plans = await plansOf(memSel.value); plans.forEach(function(p){ planSel.appendChild(h('option', { value: p.id, text: p.name || p.label || p.id })); }); }
      catch (e) { toast(e.message, true); }
    };
    inviteBox.appendChild(h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;align-items:center' }, [handleIn, memSel, planSel, h('span', { class: 'meta', text: 'hours' }), hoursIn, mk]));
    inviteBox.appendChild(out);
  }

  render();
  buildGrant();
  buildInvites();
} });
})();
`;
