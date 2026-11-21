// FIND LOVE admin: the "Dating" section of Admin › Wallets & payments (reserved title, wallet-core.md §9), registered with
// registerAdminScript() from routes/dating.js. Uses /admin/api/dating/* (admins only). Client spec §16: dating profiles +
// moderation (photos, reports, bans), Dating Coin usage, message unlocks, rewarded-ad completions, boosts / Spotlight,
// Plus / VIP subscriptions, price + rule settings — searchable by user id / @handle / name, reference, date and type.
// textContent-based DOM builder only (nothing typed by members is parsed as HTML).
// NOTE: plain JS in a string — no backticks or "${" inside.
export const DATING_ADMIN_SCRIPT = `
(function(){
(window.__walletSections = window.__walletSections || []).push({ title: 'Dating', render: function(box, ctx){
  var h = ctx.h, api = ctx.api, toast = ctx.toast;
  function num(n){ return Number(n || 0).toLocaleString(); }
  function when(s){ if (!s) return '-'; var d = new Date(s); return d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  function qs(o){ var p = []; Object.keys(o).forEach(function(k){ if (o[k] !== '' && o[k] != null) p.push(encodeURIComponent(k) + '=' + encodeURIComponent(o[k])); }); return p.length ? '?' + p.join('&') : ''; }
  function inp(ph, w, type){ return h('input', { placeholder: ph, type: type || 'text', style: 'width:' + (w || 150) + 'px' }); }
  function sel(opts){ return h('select', {}, opts.map(function(o){ return h('option', { value: o[0], text: o[1] }); })); }
  function stat(label, value, sub){ return h('div', { class: 'card', style: 'flex:1;min-width:140px;margin:0' }, [h('div', { class: 'meta', text: label }), h('b', { style: 'font-size:20px', text: value }), sub ? h('div', { class: 'meta', text: sub }) : null]); }
  function table(cols, rows){
    var t = h('table', { style: 'width:100%;border-collapse:collapse;font-size:13px' });
    t.appendChild(h('tr', {}, cols.map(function(c){ return h('th', { style: 'text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--muted);font-weight:600', text: c[0] }); })));
    rows.forEach(function(r){ t.appendChild(h('tr', {}, cols.map(function(c){ var v = c[1](r); return h('td', { style: 'padding:6px 8px;border-bottom:1px solid var(--border);vertical-align:top' }, [typeof v === 'object' && v ? v : String(v == null ? '' : v)]); }))); });
    return h('div', { class: 'card', style: 'overflow-x:auto;padding:8px' }, [t]);
  }
  function who(u){ if (!u) return '-'; return h('span', {}, [h('b', { text: u.name || 'Member' }), h('div', { class: 'meta', text: (u.handle ? '@' + u.handle + ' · ' : '') + u.id })]); }
  async function csv(path){
    try {
      var hd = { 'Accept': 'text/csv' };
      var tk = localStorage.getItem('bnAdminToken');
      if (tk) hd['Authorization'] = 'Bearer ' + tk; else { var dev = localStorage.getItem('bnAdminDevUser'); if (dev) hd['X-Dev-User'] = dev; }
      var res = await fetch(path + (path.indexOf('?') < 0 ? '?' : '&') + 'format=csv', { headers: hd });
      if (!res.ok) throw new Error('Export failed (' + res.status + ')');
      var a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = 'dating-export.csv'; document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { toast(e.message, true); }
  }

  box.appendChild(h('p', { class: 'sub', text: 'Find Love: profiles and moderation, Dating Coin usage, message unlocks, rewarded-ad completions, boosts and Spotlight, Dating Plus / VIP. Coins themselves live in the ledger (Ledger search, wallet dating_coins). Search by user id, @handle or name, reference, date and type.' }));
  var nav = h('div', { class: 'row', style: 'gap:6px;margin-bottom:12px' });
  var panel = h('div');
  box.appendChild(nav); box.appendChild(panel);
  var TABS = [['Overview', overview], ['Profiles', profiles], ['Photo queue', photos], ['Reports', reports], ['Coin usage', spends], ['Message unlocks', unlocks], ['Rewarded ads', adRewards], ['Boosts & Spotlight', boosts], ['Plus / VIP', subs], ['Prices & rules', settings]];
  var cur = 'Overview';
  function draw(){ nav.innerHTML = ''; TABS.forEach(function(t){ nav.appendChild(h('button', { class: 'btn small' + (t[0] === cur ? '' : ' ghost'), text: t[0], onclick: function(){ cur = t[0]; draw(); } })); }); panel.innerHTML = ''; var t = TABS.find(function(x){ return x[0] === cur; }); t[1](panel); }

  function filterBar(el, fields, run, csvPath){
    var inputs = {};
    var row = h('div', { class: 'row', style: 'gap:6px;margin-bottom:10px;flex-wrap:wrap' });
    fields.forEach(function(f){ var i = f[2] ? sel(f[2]) : inp(f[1], f[3], f[4]); inputs[f[0]] = i; row.appendChild(i); });
    var out = h('div');
    function vals(){ var o = {}; Object.keys(inputs).forEach(function(k){ o[k] = inputs[k].value.trim(); }); return o; }
    row.appendChild(h('button', { class: 'btn small', text: 'Search', onclick: function(){ run(out, vals()); } }));
    if (csvPath) row.appendChild(h('button', { class: 'btn small ghost', text: 'CSV', onclick: function(){ csv(csvPath + qs(vals())); } }));
    el.appendChild(row); el.appendChild(out);
    run(out, vals());
  }
  async function load(out, path, render){
    out.innerHTML = ''; out.appendChild(h('div', { class: 'meta', text: 'Loading…' }));
    try { var d = await api('GET', path); out.innerHTML = ''; render(d); } catch (e) { out.innerHTML = ''; out.appendChild(h('div', { class: 'card', text: e.message })); }
  }

  async function overview(el){
    await load(el, '/admin/api/dating/overview', function(d){
      el.appendChild(h('div', { class: 'row', style: 'gap:10px;margin-bottom:12px;flex-wrap:wrap' }, [
        stat('Profiles', num(d.profiles.total), num(d.profiles.active) + ' active · ' + num(d.profiles.paused) + ' hidden · ' + num(d.profiles.banned) + ' suspended'),
        stat('Photos waiting', num(d.photosPending), 'review mode: ' + d.photoReview),
        stat('Open reports', num(d.reportsOpen)),
        stat('Matches', num(d.matches), num(d.matches30) + ' in the last 30 days'),
        stat('Active boosts', num(d.boostsActive)),
        stat('Plus / VIP', num(d.plus) + ' / ' + num(d.vip), 'live subscriptions'),
      ]));
      el.appendChild(h('h3', { text: 'Dating Coins used (last 30 days)' }));
      el.appendChild(d.spends.length ? table([['Use', function(r){ return r.label; }], ['Times', function(r){ return num(r.count); }], ['Coins', function(r){ return num(r.coins); }]], d.spends) : h('div', { class: 'card empty', text: 'No coin use yet.' }));
      el.appendChild(h('h3', { text: 'Rewarded ads (last 30 days)' }));
      el.appendChild(h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap' }, [stat('Issued', num(d.ads.issued)), stat('Claimed', num(d.ads.claimed)), stat('Verified by AdMob SSV', num(d.ads.verified)), stat('Expired / unused', num(d.ads.expired))]));
      if (!d.requireSsv) el.appendChild(h('div', { class: 'card', style: 'border-color:var(--gold);margin-top:10px' }, [h('b', { text: 'SSV not required yet.' }), h('div', { class: 'meta', text: 'Ad rewards are accepted from signed app claims. Before launch: enable server-side verification on the AdMob rewarded unit (callback /ads/ssv) and set requireSsv: true under Prices & rules (or DATING_ADS_REQUIRE_SSV=true).' })]));
    });
  }

  function profiles(el){
    filterBar(el, [['q', 'user id, @handle or name', null, 220], ['status', '', [['', 'Any status'], ['active', 'Active'], ['paused', 'Hidden by member'], ['banned', 'Suspended']]], ['reported', '', [['', 'All'], ['1', 'Reported only']]]], function(out, v){
      load(out, '/admin/api/dating/profiles' + qs(v), function(d){
        if (!d.items.length) { out.appendChild(h('div', { class: 'card empty', text: 'No profiles.' })); return; }
        d.items.forEach(function(p){
          var acts = h('div', { class: 'row', style: 'gap:6px;margin-top:8px' });
          if (p.status === 'banned') acts.appendChild(h('button', { class: 'btn small ghost', text: 'Restore', onclick: function(){ act(p.userId, 'unban', {}); } }));
          else acts.appendChild(h('button', { class: 'btn small danger', text: 'Suspend', onclick: function(){ var r = prompt('Reason (shown to the member)'); if (r) act(p.userId, 'ban', { reason: r }); } }));
          acts.appendChild(h('button', { class: 'btn small ghost', text: p.verified ? 'Remove Verified' : 'Mark Verified', onclick: function(){ act(p.userId, 'verify', { verified: !p.verified }); } }));
          acts.appendChild(h('button', { class: 'btn small ghost', text: 'Ledger', onclick: function(){ ctx.open('Member', { q: p.userId }); } }));
          out.appendChild(h('div', { class: 'card' }, [
            h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, (p.photos || []).slice(0, 6).map(function(ph){ return h('img', { src: ph.url, title: ph.status, style: 'width:64px;height:80px;object-fit:cover;border-radius:8px;border:2px solid ' + (ph.status === 'approved' ? 'var(--primary)' : ph.status === 'rejected' ? 'var(--neg)' : 'var(--gold)') }); })),
            h('b', { text: p.firstName + ', ' + p.age + ' · ' + p.gender + ' seeking ' + p.interestedIn }),
            h('div', { class: 'meta', text: [p.city, p.country].filter(Boolean).join(', ') + ' · ' + (p.denomination || 'denomination not set') + ' · ' + p.intention + ' · status ' + p.status + (p.banReason ? ' (' + p.banReason + ')' : '') }),
            h('div', { class: 'meta', text: 'Account: ' + (p.user.name || '') + (p.user.handle ? ' @' + p.user.handle : '') + ' · ' + p.userId + ' · reports ' + p.reports + ' · matches ' + p.matches + ' · joined ' + when(p.createdAt) }),
            p.bio ? h('p', { text: p.bio }) : null, acts,
          ]));
        });
      });
    });
    async function act(id, a, body){ try { await api('POST', '/admin/api/dating/profiles/' + id + '/' + a, body); toast('Saved'); draw(); } catch (e) { toast(e.message, true); } }
  }

  function photos(el){
    filterBar(el, [['status', '', [['pending', 'Waiting'], ['approved', 'Approved'], ['rejected', 'Rejected']]], ['q', 'user id, @handle or name', null, 200]], function(out, v){
      load(out, '/admin/api/dating/photos' + qs(v), function(d){
        if (!d.items.length) { out.appendChild(h('div', { class: 'card empty', text: 'Nothing in this queue.' })); return; }
        var grid = h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap' });
        d.items.forEach(function(p){
          grid.appendChild(h('div', { class: 'card', style: 'width:180px;margin:0' }, [
            h('img', { src: p.url, style: 'width:100%;height:220px;object-fit:cover;border-radius:8px' }),
            h('div', { class: 'meta', text: p.firstName + ' · ' + p.userId.slice(0, 8) + ' · ' + when(p.createdAt) }),
            p.status === 'rejected' && p.rejectReason ? h('div', { class: 'meta', text: 'Rejected: ' + p.rejectReason }) : null,
            h('div', { class: 'row', style: 'gap:6px;margin-top:6px' }, [
              h('button', { class: 'btn small', text: 'Approve', onclick: function(){ review(p.id, 'approved'); } }),
              h('button', { class: 'btn small danger', text: 'Reject', onclick: function(){ var r = prompt('Reason (e.g. not modest, not a real photo, contact details)'); if (r) review(p.id, 'rejected', r); } }),
            ]),
          ]));
        });
        out.appendChild(grid);
      });
    });
    async function review(id, status, reason){ try { await api('POST', '/admin/api/dating/photos/' + id, { status: status, reason: reason || '' }); toast(status === 'approved' ? 'Approved' : 'Rejected'); draw(); } catch (e) { toast(e.message, true); } }
  }

  function reports(el){
    filterBar(el, [['status', '', [['open', 'Open'], ['actioned', 'Actioned'], ['dismissed', 'Dismissed'], ['', 'All']]], ['q', 'reported user id / @handle / name', null, 220]], function(out, v){
      load(out, '/admin/api/dating/reports' + qs(v), function(d){
        if (!d.items.length) { out.appendChild(h('div', { class: 'card empty', text: 'No reports.' })); return; }
        out.appendChild(table([
          ['When', function(r){ return when(r.createdAt); }], ['Reported', function(r){ return who(r.target); }], ['By', function(r){ return who(r.reporter); }],
          ['Reason', function(r){ return r.reason + (r.details ? ' — ' + r.details : ''); }], ['Status', function(r){ return r.status + (r.action ? ' (' + r.action + ')' : ''); }],
          ['', function(r){ if (r.status !== 'open') return ''; return h('div', { class: 'row', style: 'gap:4px' }, [
            h('button', { class: 'btn small danger', text: 'Suspend profile', onclick: function(){ handle(r.id, 'ban'); } }),
            h('button', { class: 'btn small ghost', text: 'Dismiss', onclick: function(){ handle(r.id, 'dismiss'); } }),
          ]); }],
        ], d.items));
      });
    });
    async function handle(id, action){ try { await api('POST', '/admin/api/dating/reports/' + id, { action: action }); toast('Done'); draw(); } catch (e) { toast(e.message, true); } }
  }

  var KINDS = [['', 'All uses'], ['super_like', 'Super Like'], ['priority_like', 'Priority Like'], ['message_request', 'Message request'], ['see_who_liked', 'See who liked you'], ['extra_swipes', '+20 swipes'], ['message_bundle', 'Message bundle'], ['boost_30m', 'Boost 30 min'], ['boost_1h', 'Boost 1 h'], ['boost_3h', 'Boost 3 h'], ['spotlight_24h', 'Spotlight 24 h']];
  function spends(el){
    filterBar(el, [['q', 'user id, @handle or name', null, 200], ['kind', '', KINDS], ['ref', 'reference starts with', null, 170], ['from', 'from', null, 140, 'date'], ['to', 'to', null, 140, 'date']], function(out, v){
      load(out, '/admin/api/dating/spends' + qs(v), function(d){
        if (!d.items.length) { out.appendChild(h('div', { class: 'card empty', text: 'No coin use found.' })); return; }
        out.appendChild(table([['When', function(r){ return when(r.createdAt); }], ['Member', function(r){ return who(r.user); }], ['Use', function(r){ return r.label; }],
          ['Spent', function(r){ return num(r.amount) + (r.wallet === 'dating_boosts' ? ' free boost' : ' coins'); }], ['Gives', function(r){ return r.units ? num(r.units) : ''; }],
          ['Reference', function(r){ return h('code', { text: r.ref }); }]], d.items));
      });
    }, '/admin/api/dating/spends');
  }
  function unlocks(el){
    filterBar(el, [['q', 'user id, @handle or name', null, 200], ['type', '', [['', 'Ads and coin bundles'], ['ad', 'Rewarded ad'], ['bundle', 'Coin bundle']]], ['from', 'from', null, 140, 'date'], ['to', 'to', null, 140, 'date']], function(out, v){
      load(out, '/admin/api/dating/message-unlocks' + qs(v), function(d){
        if (!d.items.length) { out.appendChild(h('div', { class: 'card empty', text: 'No message unlocks found.' })); return; }
        out.appendChild(table([['When', function(r){ return when(r.at); }], ['Member', function(r){ return who(r.user); }], ['How', function(r){ return r.type === 'ad' ? 'Rewarded ad' + (r.verified ? ' (SSV)' : '') : 'Coins (' + r.amount + ')'; }],
          ['Messages', function(r){ return num(r.units); }], ['Chat', function(r){ return h('code', { text: r.conversationId }); }], ['Reference', function(r){ return h('code', { text: r.ref }); }]], d.items));
      });
    }, '/admin/api/dating/message-unlocks');
  }
  function adRewards(el){
    filterBar(el, [['q', 'user id, @handle or name', null, 200], ['status', '', [['', 'Any'], ['issued', 'Issued'], ['claimed', 'Claimed'], ['expired', 'Expired'], ['rejected', 'Rejected']]], ['from', 'from', null, 140, 'date'], ['to', 'to', null, 140, 'date']], function(out, v){
      load(out, '/admin/api/dating/ad-rewards' + qs(v), function(d){
        if (!d.items.length) { out.appendChild(h('div', { class: 'card empty', text: 'No rewarded-ad records.' })); return; }
        out.appendChild(table([['Issued', function(r){ return when(r.issuedAt); }], ['Member', function(r){ return who(r.user); }], ['Status', function(r){ return r.status + (r.claimedVia ? ' via ' + r.claimedVia : ''); }],
          ['SSV', function(r){ return r.verified ? 'verified' : '-'; }], ['Transaction', function(r){ return r.transactionId || '-'; }], ['Messages', function(r){ return r.units || ''; }], ['Nonce', function(r){ return h('code', { text: r.nonce }); }]], d.items));
      });
    }, '/admin/api/dating/ad-rewards');
  }
  function boosts(el){
    filterBar(el, [['q', 'user id, @handle or name', null, 200], ['kind', '', [['', 'Boosts and Spotlight'], ['boost_30m', 'Boost 30 min'], ['boost_1h', 'Boost 1 h'], ['boost_3h', 'Boost 3 h'], ['spotlight_24h', 'Spotlight 24 h']]], ['active', '', [['', 'Any time'], ['1', 'Running now']]], ['from', 'from', null, 140, 'date'], ['to', 'to', null, 140, 'date']], function(out, v){
      load(out, '/admin/api/dating/boosts' + qs(v), function(d){
        if (!d.items.length) { out.appendChild(h('div', { class: 'card empty', text: 'No boosts found.' })); return; }
        out.appendChild(table([['Bought', function(r){ return when(r.createdAt); }], ['Member', function(r){ return who(r.user); }], ['Kind', function(r){ return r.label; }],
          ['Paid', function(r){ return r.paidWith === 'dating_boosts' ? 'free VIP boost' : num(r.amount) + ' coins'; }], ['Runs', function(r){ return when(r.startsAt) + ' → ' + when(r.endsAt); }],
          ['Stats', function(r){ return num(r.views) + ' views · ' + num(r.likes) + ' likes · ' + num(r.matches) + ' matches'; }], ['Reference', function(r){ return h('code', { text: r.ref }); }]], d.items));
      });
    }, '/admin/api/dating/boosts');
  }
  function subs(el){
    el.appendChild(h('p', { class: 'meta', text: 'Plan prices and benefits (features, flags, perCycle grants: VIP 300 coins + 2 boosts per billing cycle) are edited under Products & prices. Cancel, refunds and the full list: Subscriptions.' }));
    el.appendChild(h('div', { class: 'row', style: 'gap:6px;margin-bottom:10px' }, [h('button', { class: 'btn small ghost', text: 'Open Products & prices', onclick: function(){ ctx.open('Products & prices'); } }), h('button', { class: 'btn small ghost', text: 'Open Subscriptions', onclick: function(){ ctx.open('Subscriptions'); } })]));
    filterBar(el, [['q', 'user id, @handle or name', null, 200], ['status', '', [['', 'Live (active, cancelled until period end)'], ['all', 'All'], ['expired', 'Expired'], ['refunded', 'Refunded']]]], function(out, v){
      load(out, '/admin/api/dating/subscriptions' + qs(v), function(d){
        if (!d.items.length) { out.appendChild(h('div', { class: 'card empty', text: 'No Find Love subscriptions.' })); return; }
        out.appendChild(table([['Member', function(r){ return who(r.user); }], ['Plan', function(r){ return r.title; }], ['Status', function(r){ return r.status + (r.test ? ' (test)' : ''); }],
          ['Provider', function(r){ return r.provider; }], ['Period', function(r){ return when(r.currentPeriodStart) + ' → ' + when(r.currentPeriodEnd); }], ['Cycles granted', function(r){ return num(r.cycles); }]], d.items));
      });
    });
  }
  async function settings(el){
    await load(el, '/admin/api/dating/config', function(d){
      el.appendChild(h('p', { class: 'meta', text: 'Coin prices for each Find Love feature and the free-tier rules. Changes apply at once (no app release). Every change is logged.' }));
      [['dating_prices', 'Prices (Dating Coins)', d.prices], ['dating_rules', 'Rules', d.rules]].forEach(function(s){
        var ta = h('textarea', { style: 'width:100%;min-height:220px;font-family:monospace;font-size:12px' });
        ta.value = JSON.stringify(s[2], null, 2);
        el.appendChild(h('div', { class: 'card' }, [h('b', { text: s[1] }), ta, h('button', { class: 'btn small', style: 'margin-top:8px', text: 'Save', onclick: async function(){
          var v; try { v = JSON.parse(ta.value); } catch (e) { toast('Not valid JSON', true); return; }
          try { await api('PUT', '/admin/api/dating/config', { key: s[0], value: v }); toast('Saved'); } catch (e) { toast(e.message, true); }
        } })]));
      });
    });
  }
  draw();
}});
})();
`;
