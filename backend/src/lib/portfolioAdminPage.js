// PORTFOLIO & PARTNERS — "Portfolio & Partners" tab of the /admin dashboard. Registered with registerAdminScript() from
// routes/portfolio.js. Plain JS inside a string: no backticks and no template placeholders. All text goes through
// ctx.h (text nodes), so nothing a member typed is ever injected as HTML.
export const PORTFOLIO_ADMIN_SCRIPT = `
(function(){
if (!window.registerAdminTab) return;
window.adminTabAreas = window.adminTabAreas || {};
window.adminTabAreas['Portfolio & Partners'] = ['portfolio'];
function money(minor, cur){ var n = Number(minor || 0) / 100; return (cur === 'NGN' || !cur ? '\\u20A6' : cur + ' ') + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function when(s){ if (!s) return '\\u2014'; return new Date(s).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function esc(s){ return String(s == null ? '' : s); }
window.registerAdminTab('Portfolio & Partners', function(box, ctx){
  var h = ctx.h, api = ctx.api, toast = window.adminToast || function(){};
  var SECTIONS = [['overview','Overview'],['recruit','Recruit & invites'],['members','Managers'],['applications','Applications'],['partners','Partner Managers'],['withdrawals','Withdrawals'],['reports','Reports'],['monitor','Referrals & subscriptions'],['settings','Commission settings']];
  var current = 'overview';
  var nav = h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap;margin-bottom:14px' });
  var body = h('div');
  box.appendChild(h('h2', { class: 'serif', text: 'Portfolio & Partners' }));
  box.appendChild(h('p', { class: 'sub', text: 'Recruit Portfolio Managers (PMs), who recruit Partner Managers, who recruit members. Every appointment and recruitment is recorded permanently.' }));
  box.appendChild(nav); box.appendChild(body);
  function drawNav(){
    nav.innerHTML = '';
    SECTIONS.forEach(function(s){
      var b = h('button', { class: s[0] === current ? 'btn' : 'btn ghost', text: s[1] });
      b.onclick = function(){ current = s[0]; drawNav(); show(); };
      nav.appendChild(b);
    });
  }
  function card(children){ return h('div', { class: 'card', style: 'margin-bottom:12px' }, children); }
  function stat(label, value){ return h('div', { class: 'card', style: 'flex:1;min-width:150px' }, [h('div', { class: 'meta', text: label }), h('b', { style: 'font-size:20px', text: esc(value) })]); }
  function table(head, rows){
    var t = h('table', { class: 'tbl', style: 'width:100%;border-collapse:collapse;font-size:13px' });
    t.appendChild(h('tr', null, head.map(function(x){ return h('th', { style: 'text-align:left;padding:6px;border-bottom:1px solid #ddd', text: x }); })));
    rows.forEach(function(r){ t.appendChild(h('tr', null, r.map(function(c){ return h('td', { style: 'padding:6px;border-bottom:1px solid #eee;vertical-align:top' }, [c]); }))); });
    return t;
  }
  function field(label, el){ return h('label', { style: 'display:flex;flex-direction:column;gap:4px;min-width:180px;flex:1' }, [h('span', { class: 'meta', text: label }), el]); }
  function input(v, ph){ var i = h('input', { value: v || '', placeholder: ph || '' }); return i; }
  function select(opts, v){ var s = h('select'); opts.forEach(function(o){ var op = h('option', { value: o[0], text: o[1] }); if (o[0] === v) op.selected = true; s.appendChild(op); }); return s; }
  function act(label, fn, cls){ var b = h('button', { class: cls || 'btn ghost', text: label }); b.onclick = function(){ fn(b); }; return b; }
  async function run(fn, ok){ try { await fn(); if (ok) toast(ok); show(); } catch (e) { toast(e.message, true); } }

  async function viewOverview(){
    var d = await api('GET', '/admin/api/portfolio/overview');
    body.innerHTML = '';
    body.appendChild(h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap;margin-bottom:12px' }, [
      stat('Active PMs', d.portfolioManagers.active), stat('Suspended PMs', d.portfolioManagers.suspended),
      stat('Active partners', d.partnerManagers.active), stat('Partners pending', d.partnerManagers.pending),
      stat('Applications waiting', d.applicationsPending), stat('Referred users', d.referredUsers),
    ]));
    body.appendChild(h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap' }, [
      stat('Partner commissions', money(d.commissionsMinor.partner)), stat('PM commissions', money(d.commissionsMinor.portfolio)),
      stat('Paid out', money(d.commissionsMinor.paidOut)), stat('Withdrawals open', d.withdrawalsOpen),
    ]));
  }

  async function viewRecruit(){
    body.innerHTML = '';
    var box2 = h('div');
    var kind = 'portfolio_manager';
    var channel = select([['link','Link'],['email','Email'],['whatsapp','WhatsApp'],['social','Social media'],['manual','Manual']], 'link');
    var label = input('', 'Label, e.g. Lagos church network');
    var maxUses = input('', 'Max uses (blank = unlimited)');
    var days = input('', 'Expires in days (blank = never)');
    var email = input('', 'Email (for email invites)');
    body.appendChild(card([
      h('h3', { text: 'Create a Portfolio Manager invitation' }),
      h('p', { class: 'meta', text: 'The link is unique to this invitation. Share it on WhatsApp, by email or on social media, or copy it.' }),
      h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap' }, [field('Channel', channel), field('Label', label), field('Email', email), field('Max uses', maxUses), field('Expires in days', days)]),
      h('div', { style: 'margin-top:10px' }, [act('Create invitation', function(){
        run(async function(){
          var body2 = { kind: kind, channel: channel.value, label: label.value, email: email.value || null, maxUses: maxUses.value ? Number(maxUses.value) : null, expiresInDays: days.value ? Number(days.value) : null };
          await api('POST', '/admin/api/portfolio/invites', body2);
        }, 'Invitation created');
      }, 'btn')]),
    ]));
    body.appendChild(card([h('h3', { text: 'Appoint a Portfolio Manager directly' }),
      h('p', { class: 'meta', text: 'The person must already have a BibleNestra account. Enter their handle (without @) or user id.' }),
      h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap' }, [(function(){ var hd = input('', 'handle'); hd.id = 'pm-handle'; return field('Handle or user id', hd); })()]),
      h('div', { style: 'margin-top:10px' }, [act('Appoint Portfolio Manager', function(){
        var v = document.getElementById('pm-handle').value.trim();
        run(async function(){
          var payload = /^[0-9a-f-]{36}$/i.test(v) ? { userId: v, role: 'portfolio_manager' } : { handle: v, role: 'portfolio_manager' };
          await api('POST', '/admin/api/portfolio/members', payload);
        }, 'Portfolio Manager appointed');
      }, 'btn')])]));
    var list = await api('GET', '/admin/api/portfolio/invites');
    body.appendChild(h('h3', { text: 'Invitations' }));
    body.appendChild(table(['Code','Kind','Channel','Uses','Expires','Status','Links'], list.items.map(function(i){
      var links = h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' });
      links.appendChild(h('a', { href: i.share.whatsapp, target: '_blank', text: 'WhatsApp' }));
      links.appendChild(h('a', { href: i.share.email, text: 'Email' }));
      links.appendChild(h('a', { href: i.share.facebook, target: '_blank', text: 'Facebook' }));
      links.appendChild(h('a', { href: i.share.x, target: '_blank', text: 'X' }));
      links.appendChild(h('a', { href: i.link, target: '_blank', text: 'Open link' }));
      var status = i.revoked ? 'Revoked' : (i.expiresAt && new Date(i.expiresAt) < new Date()) ? 'Expired' : 'Open';
      var rev = i.revoked ? h('span', { text: '\\u2014' }) : act('Revoke', function(){ run(function(){ return api('POST', '/admin/api/portfolio/invites/' + i.id + '/revoke'); }, 'Invitation revoked'); });
      return [h('b', { text: i.code }), esc(i.kindLabel), esc(i.channel), i.uses + (i.maxUses ? ' / ' + i.maxUses : ''), when(i.expiresAt), status, h('div', null, [links, rev])];
    })));
  }

  async function viewMembers(){
    body.innerHTML = '';
    var role = select([['','All roles'],['portfolio_manager','Portfolio Managers'],['partner_manager','Partner Managers']], '');
    var status = select([['','Any status'],['active','Active'],['pending','Pending'],['suspended','Suspended']], '');
    var q = input('', 'Search name or handle');
    var out = h('div');
    body.appendChild(card([h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap' }, [field('Role', role), field('Status', status), field('Search', q)]),
      h('div', { style: 'margin-top:10px' }, [act('Search', function(){ load(); }, 'btn')])]));
    body.appendChild(out);
    async function load(){
      out.innerHTML = '';
      var qs = '?q=' + encodeURIComponent(q.value || '') + (role.value ? '&role=' + role.value : '') + (status.value ? '&status=' + status.value : '');
      var d = await api('GET', '/admin/api/portfolio/members' + qs);
      out.appendChild(table(['Name','Role','Status','Recruited by','Source','Joined','Actions'], d.items.map(function(m){
        var acts = h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' });
        if (m.status === 'active') acts.appendChild(act('Suspend', function(){ var r = window.prompt('Reason for suspension (the member sees it)'); if (!r) return; run(function(){ return api('POST', '/admin/api/portfolio/members/' + m.userId + '/suspend', { reason: r }); }, 'Suspended'); }));
        if (m.status === 'suspended') acts.appendChild(act('Reactivate', function(){ run(function(){ return api('POST', '/admin/api/portfolio/members/' + m.userId + '/reactivate', {}); }, 'Reactivated'); }));
        if (m.status !== 'pending') acts.appendChild(act('Deactivate', function(){ var r = window.prompt('Reason for deactivation (final until an admin reactivates)'); if (!r) return; run(function(){ return api('POST', '/admin/api/portfolio/members/' + m.userId + '/deactivate', { reason: r }); }, 'Deactivated'); }));
        if (m.role === 'partner_manager') acts.appendChild(act('Reassign', function(){ var handle = window.prompt('Handle of the Portfolio Manager to move this Partner Manager to (without @). Only the Super Admin can do this.'); if (!handle) return; run(async function(){ var pms = await api('GET', '/admin/api/portfolio/members?role=portfolio_manager&status=active'); var pm = pms.items.filter(function(x){ return String(x.handle || '').toLowerCase() === handle.replace(/^@/, '').toLowerCase(); })[0]; if (!pm) throw new Error('No active Portfolio Manager with that handle'); return api('POST', '/admin/api/portfolio/members/' + m.userId + '/reassign', { pmId: pm.userId }); }, 'Reassigned'); }));
        acts.appendChild(act('Details', function(){ viewDetail(m.userId); }));
        var recruiter = m.recruitedBy ? (m.recruitedBy.displayName || '@' + m.recruitedBy.handle) : (m.appointedByAdmin ? 'Super Admin' : '\\u2014');
        return [h('div', null, [h('b', { text: esc(m.displayName) }), h('div', { class: 'meta', text: m.handle ? '@' + m.handle : '' })]), esc(m.roleLabel), esc(m.status), esc(recruiter), esc(m.recruitmentSource), when(m.createdAt), acts];
      })));
      if (!d.items.length) out.appendChild(h('div', { class: 'card empty', text: 'No managers match.' }));
    }
    load();
  }

  // Monitor: every referral (who recruited whom), network subscriptions and the commission ledger. Read-only.
  async function viewMonitor(){
    body.innerHTML = '';
    var d = await api('GET', '/admin/api/portfolio/monitor');
    var t = d.totals || {};
    body.appendChild(h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap' }, [stat('Referred users', t.referrals), stat('Creators recruited', t.creatorsRecruited), stat('Invitations sent', t.invitations), stat('Invitations registered', t.invitationsRegistered)]));
    body.appendChild(card([h('h3', { text: 'Referrals (latest 100)' }), table(['Member','Partner Manager','Portfolio Manager','Joined'], d.referrals.map(function(r){ return ['@' + esc(r.handle), esc(r.partnerName || r.partnerHandle || '\\u2014'), esc(r.portfolioManagerName || '\\u2014'), when(r.createdAt)]; }))]));
    body.appendChild(card([h('h3', { text: 'Network subscriptions and creator plans (latest 100)' }), table(['Reference','Kind','Amount','Payer','Partner','Paid'], d.subscriptions.map(function(p){ return [esc(p.reference), esc(p.kind), money(p.amountMinor, p.currency), '@' + esc(p.payerHandle), esc(p.partnerName || '\\u2014'), when(p.paidAt)]; }))]));
    body.appendChild(card([h('h3', { text: 'Commission ledger by role and status' }), table(['Role','Status','Currency','Entries','Amount'], d.commissions.map(function(c){ return [esc(c.role), esc(c.status), esc(c.currency), String(c.count), money(c.amountMinor, c.currency)]; }))]));
  }

  async function viewDetail(id){
    var d = await api('GET', '/admin/api/portfolio/members/' + id);
    body.innerHTML = '';
    body.appendChild(h('button', { class: 'btn ghost', text: '\\u2190 Back to managers', onclick: function(){ current = 'members'; drawNav(); show(); } }));
    if (d.performance) {
      var p = d.performance;
      body.appendChild(h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap;margin:12px 0' }, [
        stat('Partner Managers', p.partners), stat('Referred users', p.referredUsers), stat('Eligible payments', p.payments), stat('PM commissions', money(p.pmCommissionMinor)),
      ]));
      body.appendChild(h('h3', { text: 'Partner Managers recruited' }));
      body.appendChild(partnerTable(d.partners));
    } else {
      body.appendChild(card([h('b', { text: esc(d.member.displayName) }), h('div', { class: 'meta', text: 'Partner Manager, recruited by ' + (d.member.recruitedBy ? (d.member.recruitedBy.displayName || '@' + d.member.recruitedBy.handle) : 'the Super Admin') + ' \\u00B7 status ' + d.member.status })]));
    }
    var earn = (d.earnings || []).map(function(e){ return card([h('b', { text: e.currency + ' ' + '' }), h('div', { class: 'meta', text: 'Held ' + money(e.heldMinor, e.currency) + ' \\u00B7 Available ' + money(e.availableMinor, e.currency) + ' \\u00B7 Paid ' + money(e.paidMinor, e.currency) })]); });
    earn.forEach(function(x){ body.appendChild(x); });
  }

  function partnerTable(items){
    return table(['Partner Manager','Status','Joined','Recruited through','Referred users','Payments','Commission','Available'], items.map(function(p){
      return [h('div', null, [h('b', { text: esc(p.displayName) }), h('div', { class: 'meta', text: p.handle ? '@' + p.handle : '' })]), esc(p.status), when(p.joinedAt), esc(p.source), p.referredUsers, p.payments, money(p.commissionMinor), money(p.availableMinor)];
    }));
  }

  async function viewApplications(){
    body.innerHTML = '';
    var d = await api('GET', '/admin/api/portfolio/applications?status=pending');
    body.appendChild(h('p', { class: 'meta', text: 'Portfolio Manager applications are decided here. Partner Manager applications go to their Portfolio Manager first; you can decide them too.' }));
    body.appendChild(table(['Applicant','Applying as','Approver','Applied','Answers','Decision'], d.items.map(function(a){
      var ans = a.answers || {};
      var txt = h('div', { class: 'meta', text: [ans.country, ans.city, ans.phone, ans.motivation].filter(Boolean).join(' \\u00B7 ') });
      var reason = h('input', { placeholder: 'Reason (required to decline)' });
      var dec = h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, [
        act('Approve', function(){ run(function(){ return api('POST', '/admin/api/portfolio/applications/' + a.id + '/approve', {}); }, 'Approved'); }, 'btn'),
        act('Decline', function(){ run(function(){ return api('POST', '/admin/api/portfolio/applications/' + a.id + '/reject', { reason: reason.value }); }, 'Declined'); }),
        reason,
      ]);
      return [h('div', null, [h('b', { text: esc(a.applicant.displayName) }), h('div', { class: 'meta', text: a.applicant.handle ? '@' + a.applicant.handle : '' })]), a.kind === 'portfolio_manager' ? 'Portfolio Manager' : 'Partner Manager', esc(a.approverName), when(a.createdAt), txt, dec];
    })));
    if (!d.items.length) body.appendChild(h('div', { class: 'card empty', text: 'No applications waiting.' }));
  }

  async function viewPartners(){
    body.innerHTML = '';
    var d = await api('GET', '/admin/api/portfolio/partners');
    body.appendChild(h('p', { class: 'meta', text: 'Every Partner Manager, with the Portfolio Manager who recruited them and their performance.' }));
    body.appendChild(partnerTable(d.items));
    if (!d.items.length) body.appendChild(h('div', { class: 'card empty', text: 'No Partner Managers yet.' }));
  }

  async function viewWithdrawals(){
    body.innerHTML = '';
    var status = select([['requested','Requested'],['approved','Approved, to pay'],['paid','Paid'],['rejected','Rejected'],['','All']], 'requested');
    var out = h('div');
    body.appendChild(card([field('Show', status), h('div', { style: 'margin-top:10px' }, [act('Show', function(){ load(); }, 'btn')])]));
    body.appendChild(out);
    async function load(){
      out.innerHTML = '';
      var d = await api('GET', '/admin/api/portfolio/withdrawals' + (status.value ? '?status=' + status.value : ''));
      out.appendChild(table(['Member','Amount','Status','Requested','Actions'], d.items.map(function(w){
        var ref = h('input', { placeholder: 'Payment reference' });
        var note = h('input', { placeholder: 'Note or reason' });
        var acts = h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' });
        if (w.status === 'requested') acts.appendChild(act('Approve', function(){ run(function(){ return api('POST', '/admin/api/portfolio/withdrawals/' + w.id + '/approve', { note: note.value }); }, 'Approved'); }, 'btn'));
        if (w.status === 'approved') { acts.appendChild(ref); acts.appendChild(act('Mark paid', function(){ run(function(){ return api('POST', '/admin/api/portfolio/withdrawals/' + w.id + '/paid', { reference: ref.value, note: note.value }); }, 'Marked paid'); }, 'btn')); }
        if (w.status === 'requested' || w.status === 'approved') { acts.appendChild(note); acts.appendChild(act('Reject', function(){ run(function(){ return api('POST', '/admin/api/portfolio/withdrawals/' + w.id + '/reject', { note: note.value }); }, 'Rejected'); })); }
        return [h('div', null, [h('b', { text: esc(w.member.displayName) }), h('div', { class: 'meta', text: w.member.handle ? '@' + w.member.handle : '' })]), money(w.amountMinor, w.currency), esc(w.status) + (w.reference ? ' \\u00B7 ' + w.reference : ''), when(w.requestedAt), acts];
      })));
      if (!d.items.length) out.appendChild(h('div', { class: 'card empty', text: 'No withdrawals here.' }));
    }
    load();
  }

  async function viewReports(){
    body.innerHTML = '';
    var month = h('input', { type: 'month', value: new Date().toISOString().slice(0, 7) });
    var out = h('div');
    body.appendChild(card([field('Month', month), h('div', { style: 'margin-top:10px' }, [act('Show report', function(){ load(); }, 'btn')])]));
    body.appendChild(out);
    async function load(){
      out.innerHTML = '';
      var d = await api('GET', '/admin/api/portfolio/report?month=' + month.value);
      out.appendChild(h('h3', { text: 'Commissions in ' + d.month }));
      out.appendChild(table(['Role','Status','Currency','Payments','Entries','Amount'], d.commissions.map(function(c){ return [c.role === 'partner' ? 'Partner Manager' : 'Portfolio Manager', c.status, c.currency, c.payments, c.count, money(c.amountMinor, c.currency)]; })));
      out.appendChild(h('p', { class: 'meta', text: 'New referred users this month: ' + d.newReferredUsers }));
      out.appendChild(h('h3', { text: 'Portfolio Managers' }));
      out.appendChild(table(['Portfolio Manager','New referred users','PM commission'], d.portfolioManagers.map(function(p){ return [esc(p.displayName), p.referredNew, money(p.commissionMinor)]; })));
      var csv = ['Role,Status,Currency,Payments,Entries,Amount'].concat(d.commissions.map(function(c){ return [c.role, c.status, c.currency, c.payments, c.count, (c.amountMinor / 100).toFixed(2)].join(','); })).join('\\n');
      out.appendChild(h('a', { class: 'btn ghost', href: 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv), download: 'portfolio-' + d.month + '.csv', text: 'Download CSV' }));
    }
    load();
  }

  async function viewSettings(){
    body.innerHTML = '';
    var c = await api('GET', '/admin/api/portfolio/config');
    var partner = input(String(c.partnerBps / 100), 'percent');
    var pm = input(String(c.pmBps / 100), 'percent');
    var hold = input(String(c.holdDays), 'days');
    var minW = input(String(c.minWithdrawalMinor / 100), 'amount in naira');
    var pmLimit = input(String(c.partnerLimit), 'number');
    var invLimit = input(String(c.inviteLimit), 'number');
    var pmAppr = select([['manual','Manual (Super Admin decides)'],['auto','Automatic']], c.pmApproval);
    var pnAppr = select([['manual','Manual (their PM decides)'],['auto','Automatic']], c.partnerApproval);
    var kinds = c.eligibleKinds || {};
    var kindBoxes = [['coins','Coins (gifting coin packs)'],['dating','Find Love (coins, Dating Plus, VIP)'],['plus','BibleNestra Plus'],['memberships','Memberships'],['fundme_fees','Fund Me fees (credit packs)'],['creator_plan','Creator plans (Standard and Premium)']].map(function(k){
      var cb = h('input', { type: 'checkbox' }); cb.checked = !!kinds[k[0]]; cb.setAttribute('data-kind', k[0]);
      return h('label', { style: 'display:flex;gap:8px;align-items:center' }, [cb, k[1]]);
    });
    kindBoxes.push(h('p', { class: 'meta', text: 'Donations are never eligible for commission.' }));
    function save(key, value, ok){ return run(function(){ return api('PUT', '/admin/api/portfolio/config', { key: key, value: value }); }, ok); }
    body.appendChild(card([h('h3', { text: 'Default commissions' }),
      h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap' }, [
        field('Partner Manager commission (% of eligible payment)', partner), field('Portfolio Manager share (% of partner commission)', pm),
        field('Hold before withdrawable (days)', hold), field('Minimum withdrawal (naira)', minW)]),
      h('div', { style: 'margin-top:10px' }, [act('Save commissions', function(){
        save('portfolio_partner_bps', Math.round(Number(partner.value) * 100), 'Saved');
        save('portfolio_pm_bps', Math.round(Number(pm.value) * 100));
        save('portfolio_hold_days', Number(hold.value));
        save('portfolio_min_withdrawal_minor', Math.round(Number(minW.value) * 100));
      }, 'btn')])]));
    // Membership override: a % of BibleNestra's take on subscriptions to memberships owned by referred creators (0 = off)
    var memPct = input(String((c.membershipCommissionBps || 0) / 100), 'percent, 0 = off');
    body.appendChild(card([h('h3', { text: 'Membership subscriptions of referred creators' }),
      h('p', { class: 'meta', text: 'Off while the percentage is 0. It is a percentage of BibleNestra\\u2019s take on those subscriptions. The take is the creator\\u2019s plan withdrawal fee (Free 0.5%, Standard 0.3%, Premium 0.131%).' }),
      h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap' }, [field('Partner Manager commission (% of BibleNestra take)', memPct)]),
      h('div', { style: 'margin-top:10px' }, [act('Save membership commission', function(){
        save('portfolio_membership_commission_bps', Math.round(Number(memPct.value) * 100), 'Saved');
      }, 'btn')])]));
    // Landing page template: headline, benefit copy and an accent colour from the design palette
    var lt = c.landingTemplate || {};
    var headline = input(lt.headline || '', 'invites you to BibleNestra');
    var benefits = h('textarea', { rows: 4, style: 'width:100%' }, []);
    benefits.value = (lt.benefits || []).join('\\n');
    var accent = select([['orange','Orange (brand)'],['gold','Gold'],['sage','Sage']], lt.accent || 'orange');
    body.appendChild(card([h('h3', { text: 'Partner landing page template' }),
      h('p', { class: 'meta', text: 'Shown on every partner page at /partner/handle. One benefit per line, up to 8.' }),
      h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap' }, [field('Headline (after the partner name)', headline), field('Accent colour', accent)]),
      field('Benefit copy', benefits),
      h('div', { style: 'margin-top:10px' }, [act('Save landing template', function(){
        var list = benefits.value.split('\\n').map(function(x){ return x.trim(); }).filter(Boolean);
        save('portfolio_landing_template', { headline: headline.value.trim(), benefits: list, accent: accent.value }, 'Landing template saved');
      }, 'btn')])]));
    body.appendChild(card([h('h3', { text: 'Eligible payment kinds' }), h('div', null, kindBoxes),
      h('div', { style: 'margin-top:10px' }, [act('Save eligible kinds', function(){
        var out = {}; kindBoxes.forEach(function(b){ var cb = b.querySelector('input'); out[cb.getAttribute('data-kind')] = cb.checked; });
        save('portfolio_eligible_kinds', out, 'Saved');
      }, 'btn')])]));
    body.appendChild(card([h('h3', { text: 'Recruitment limits and approvals' }),
      h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap' }, [field('Partner Managers per PM', pmLimit), field('Open invitations per PM', invLimit), field('Portfolio Manager applications', pmAppr), field('Partner applications', pnAppr)]),
      h('div', { style: 'margin-top:10px' }, [act('Save limits', function(){
        save('portfolio_pm_partner_limit', Number(pmLimit.value));
        save('portfolio_pm_invite_limit', Number(invLimit.value));
        save('portfolio_pm_auto_approve', pmAppr.value === 'auto');
        save('portfolio_partner_auto_approve', pnAppr.value === 'auto', 'Saved');
      }, 'btn')])]));
    body.appendChild(card([h('h3', { text: 'Reverse a commission' }), h('p', { class: 'meta', text: 'For a refund or chargeback: every open commission from that Paystack reference is reversed.' }),
      (function(){ var ref = h('input', { placeholder: 'Paystack reference' }); var why = h('input', { placeholder: 'Reason' }); return h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, [ref, why, act('Reverse', function(){ run(function(){ return api('POST', '/admin/api/portfolio/commissions/reverse', { reference: ref.value, reason: why.value }); }, 'Reversed'); })]); })(),
    ]));
  }

  var views = { overview: viewOverview, recruit: viewRecruit, members: viewMembers, applications: viewApplications, partners: viewPartners, withdrawals: viewWithdrawals, reports: viewReports, monitor: viewMonitor, settings: viewSettings };
  function show(){ body.innerHTML = ''; body.appendChild(h('div', { class: 'meta', text: 'Loading\\u2026' })); Promise.resolve().then(function(){ return views[current](); }).catch(function(e){ body.innerHTML = ''; body.appendChild(h('div', { class: 'card empty', text: e.message })); }); }
  drawNav();
  show();
});
})();
`;
