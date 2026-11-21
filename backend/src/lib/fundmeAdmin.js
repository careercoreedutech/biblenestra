// FUND ME (round 3): the "Fund Me approvals" tab of the /admin dashboard. Registered with
// registerAdminScript() (see routes/admin.js) — it runs inside the dashboard page and only uses
// window.registerAdminTab / ctx.api / ctx.h (textContent-based DOM builder, so user content is never HTML).
// NOTE: plain JS in a string — no backticks or "${" inside.
export const FUNDME_ADMIN_SCRIPT = `
(function(){
if (!window.registerAdminTab) return;
var SYM = { GBP: '\\u00a3', USD: '$', EUR: '\\u20ac', NGN: '\\u20a6' };
function money(m, cur){ var w = Math.floor(m / 100), f = m % 100; return (SYM[cur] || '') + String(w).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',') + (f ? '.' + (f < 10 ? '0' : '') + f : ''); }
var STATUSES = [['pending_review','Pending review'],['live','Live'],['paused','Paused'],['rejected','Rejected'],['closed','Closed']];
var CHIP = { pending_review: 'gold', live: '', paused: 'mut', rejected: 'neg', closed: 'mut', draft: 'mut' };

window.registerAdminTab('Fund Me approvals', function(box, ctx){
  var h = ctx.h, api = ctx.api, toast = ctx.toast;
  var status = 'pending_review';
  box.appendChild(h('h2', { class: 'serif', text: 'Fund Me approvals' }));
  box.appendChild(h('p', { class: 'sub', text: 'Review new fundraisers before their public page goes live. Private documents are only visible here and to the organiser.' }));
  var pills = h('div', { class: 'row', style: 'margin-bottom:14px' }); box.appendChild(pills);
  var list = h('div'); box.appendChild(list);

  function drawPills(counts){
    pills.innerHTML = '';
    STATUSES.forEach(function(s){
      var n = counts && counts[s[0]] ? ' \\u00b7 ' + counts[s[0]] : '';
      pills.appendChild(h('button', { class: 'btn small ' + (status === s[0] ? '' : 'ghost'), text: s[1] + n, onclick: function(){ status = s[0]; load(); } }));
    });
  }
  function load(){
    list.innerHTML = ''; list.appendChild(h('div', { class: 'meta', text: 'Loading\\u2026' }));
    api('GET', '/admin/api/fundme?status=' + status).then(function(d){
      drawPills(d.counts); list.innerHTML = '';
      if (!d.items.length) { list.appendChild(h('div', { class: 'card empty' }, [h('span', { class: 'serif', text: 'Nothing here' }), status === 'pending_review' ? 'No fundraisers are waiting for review.' : 'No fundraisers with this status.'])); return; }
      d.items.forEach(function(f){ list.appendChild(card(f)); });
    }).catch(function(e){ list.innerHTML = ''; list.appendChild(h('div', { class: 'card', text: e.message })); });
  }
  function card(f){
    var detail = h('div');
    var head = h('div', { class: 'row', style: 'flex-wrap:nowrap;align-items:flex-start' }, [
      f.mainImageUrl ? h('img', { src: f.mainImageUrl, alt: '', style: 'width:96px;height:72px;object-fit:cover;border-radius:10px;flex:none;background:var(--raised)' }) : null,
      h('div', { class: 'grow' }, [
        h('div', { class: 'serif', style: 'font-size:18px;line-height:1.25', text: f.title }),
        h('div', { class: 'meta', text: (f.owner ? f.owner.displayName + ' \u00b7 ' : '') + money(f.raisedMinor, f.currency) + ' of ' + money(f.goalMinor, f.currency) + ' \u00b7 ' + f.donorsCount + ' donors' + (f.submittedAt ? ' \u00b7 submitted ' + new Date(f.submittedAt).toLocaleString() : '') }),
        f.rejectReason ? h('div', { class: 'meta', style: 'color:var(--neg)', text: 'Rejected: ' + f.rejectReason }) : null,
        (f.riskFlags && f.riskFlags.length) ? h('div', { class: 'row', style: 'gap:4px;margin-top:6px;flex-wrap:wrap' }, f.riskFlags.map(function(x){ return h('span', { class: 'chip neg', title: x.detail || '', text: x.label + (x.detail ? ' · ' + x.detail : '') }); })) : null,
        (f.status === 'pending_review' && !f.published) ? h('div', { class: 'meta', text: 'Fund Me credits: ' + (f.ownerCredits || 0) + ' · approving publishes it and uses 1 credit (none if rejected)' }) : null,
        h('div', { class: 'row', style: 'margin-top:8px;gap:8px' }, [
          h('span', { class: 'chip ' + (CHIP[f.status] || ''), text: f.status.replace('_', ' ') + (f.pausedBy ? ' (' + f.pausedBy + ')' : '') }),
          h('button', { class: 'btn small ghost', 'data-review': '1', text: 'Review', onclick: function(){ if (detail.childNodes.length) { detail.innerHTML = ''; return; } openDetail(f.id, detail); } }),
        ]),
      ]),
    ]);
    return h('div', { class: 'card' }, [head, detail]);
  }
  function openDetail(id, el){
    el.innerHTML = ''; el.appendChild(h('div', { class: 'meta', style: 'margin-top:10px', text: 'Loading\\u2026' }));
    api('GET', '/admin/api/fundme/' + id).then(function(f){
      el.innerHTML = '';
      var body = h('div', { style: 'border-top:1px solid var(--border);margin-top:12px;padding-top:12px' });
      if (f.mainImageUrl) body.appendChild(h('img', { src: f.mainImageUrl, alt: '', style: 'width:100%;max-width:360px;border-radius:12px;display:block;margin-bottom:10px' }));
      body.appendChild(h('div', { class: 'eyebrow', style: 'color:var(--gold)', text: 'Story' }));
      f.story.forEach(function(b){
        if (b.type === 'p') body.appendChild(h('div', { class: 'quote', text: b.text }));
        else body.appendChild(h('img', { src: b.url, alt: b.caption || '', style: 'max-width:200px;border-radius:10px;margin:6px 0;display:block' }));
      });
      var imgs = f.media.filter(function(m){ return m.kind === 'image'; });
      var docs = f.media.filter(function(m){ return m.kind === 'pdf'; });
      if (imgs.length) {
        body.appendChild(h('div', { class: 'eyebrow', style: 'color:var(--gold);margin-top:10px', text: 'Supporting photos' }));
        body.appendChild(h('div', { class: 'row' }, imgs.map(function(m){ return h('a', { href: m.url, target: '_blank', rel: 'noopener' }, [h('img', { src: m.url, alt: m.caption || '', style: 'width:96px;height:96px;object-fit:cover;border-radius:10px' })]); })));
      }
      if (docs.length) {
        body.appendChild(h('div', { class: 'eyebrow', style: 'color:var(--gold);margin-top:12px', text: 'Documents' }));
        docs.forEach(function(m){
          body.appendChild(h('div', { class: 'row', style: 'padding:6px 0' }, [
            h('span', { class: 'chip ' + (m.visibility === 'private' ? 'neg' : ''), text: m.visibility }),
            h('a', { href: m.url, target: '_blank', rel: 'noopener', text: m.caption || m.name || 'Document' }),
          ]));
        });
      }
      body.appendChild(h('div', { class: 'meta', style: 'margin-top:10px', text: 'Goal ' + money(f.goalMinor, f.currency) + ' \\u00b7 raised ' + money(f.raisedMinor, f.currency) + ' \\u00b7 public link ' + f.url }));
      var reason = h('input', { placeholder: 'Reason shown to the organiser (required to reject)', class: 'grow', style: 'min-width:240px' });
      var actions = h('div', { class: 'row', style: 'margin-top:12px' });
      function act(path, payload, done){ return function(ev){ var b = ev.target; b.disabled = true; api('POST', '/admin/api/fundme/' + f.id + '/' + path, payload ? payload() : undefined).then(function(){ toast(done); load(); }).catch(function(e){ b.disabled = false; toast(e.message, true); }); }; }
      if (f.status === 'pending_review' || f.status === 'paused') actions.appendChild(h('button', { class: 'btn', text: f.status === 'paused' ? 'Make live again' : 'Approve \\u2014 go live', onclick: act('approve', null, 'Approved \\u2014 the page is live') }));
      if (f.status === 'pending_review') { actions.appendChild(reason); actions.appendChild(h('button', { class: 'btn danger', text: 'Reject', onclick: function(ev){ if (reason.value.trim().length < 3) { toast('Add a short reason first', true); return; } act('reject', function(){ return { reason: reason.value.trim() }; }, 'Rejected \\u2014 the organiser was notified')(ev); } })); }
      if (f.status === 'live') actions.appendChild(h('button', { class: 'btn danger', text: 'Pause (hide page)', onclick: act('pause', null, 'Paused') }));
      if (f.status === 'live' || f.status === 'closed') actions.appendChild(h('a', { class: 'btn ghost', href: f.url, target: '_blank', rel: 'noopener', text: 'Open public page', style: 'text-decoration:none' }));
      body.appendChild(actions);
      el.appendChild(body);
    }).catch(function(e){ el.innerHTML = ''; el.appendChild(h('div', { class: 'meta', text: e.message })); });
  }
  drawPills(null); load();
});
})();
`;
