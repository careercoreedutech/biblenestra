// JOBS FEEDS: the "Opportunities" tab of the /admin dashboard — imported sources (switch on/off, run now) and the
// Job & Academic Directory editor. Registered with registerAdminScript() from routes/opportunities.js.
// NOTE: plain JS in a string — no backticks or "${" inside.
export const OPPS_ADMIN_SCRIPT = `
(function(){
if (!window.registerAdminTab) return;
var css = document.createElement('style');
css.textContent = [
  '.op-tbl{width:100%;border-collapse:collapse;font-size:13px}.op-tbl th,.op-tbl td{text-align:left;padding:7px 8px;border-top:1px solid var(--border);vertical-align:top}',
  '.op-tbl th{font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);border-top:0}',
  '.op-dir{display:grid;grid-template-columns:1fr 1.4fr 2fr auto;gap:6px;align-items:center;padding:6px 0;border-top:1px solid var(--border)}',
  '.op-dir input{width:100%}.op-sec{font-family:Newsreader,Georgia,serif;font-size:18px;font-weight:600;margin:14px 0 4px}',
  '.op-note{background:#F5EBD7;color:#6B4E16;border-radius:12px;padding:10px 12px;font-size:13px;margin:8px 0 14px}'
].join('');
document.head.appendChild(css);
function when(s){ return s ? new Date(s).toLocaleString() : '—'; }

window.registerAdminTab('Opportunities', function(box, ctx){
  var h = ctx.h;
  box.appendChild(h('h2', { class: 'serif', text: 'Opportunities' }));
  box.appendChild(h('p', { class: 'sub', text: 'Jobs, scholarships and more imported from outside sources, and the Job & Academic Directory shown in the app.' }));
  var nav = h('div', { class: 'row', style: 'gap:6px;margin:10px 0 14px' });
  var body = h('div');
  box.appendChild(nav); box.appendChild(body);
  function show(v){ nav.innerHTML = ''; ['Sources', 'Directory'].forEach(function(x){ nav.appendChild(h('button', { class: 'btn small ' + (x === v ? '' : 'ghost'), text: x, onclick: function(){ show(x); } })); }); body.innerHTML = ''; (v === 'Sources' ? sourcesView : dirView)(); }

  function sourcesView(){
    body.appendChild(h('div', { class: 'op-note', text: 'Sources marked “Needs permission” have a feed, but their terms ask for written permission first. Switch one on only after the site has agreed. Sources marked “Needs key” start working when the key is added as a Worker secret (wrangler secret put NAME).' }));
    var holder = h('div', { class: 'meta', text: 'Loading…' }); body.appendChild(holder);
    ctx.api('GET', '/admin/api/opportunity-sources').then(function(d){
      holder.remove();
      var tbl = h('table', { class: 'op-tbl' });
      tbl.appendChild(h('tr', {}, ['Source', 'Category', 'Status', 'Live', 'Last success', 'Last error', ''].map(function(t){ return h('th', { text: t }); })));
      d.items.forEach(function(s){
        var status = s.needsEnv && !s.hasKey ? h('span', { class: 'chip mut', text: 'Needs key: ' + s.needsEnv })
          : s.active ? h('span', { class: 'chip', text: 'On' })
          : s.needsPermission && !s.enabled ? h('span', { class: 'chip gold', text: 'Needs permission' })
          : h('span', { class: 'chip neg', text: 'Off' });
        var toggle = h('button', { class: 'btn small ghost', text: s.enabled ? 'Switch off' : 'Switch on', onclick: function(){
          if (!s.enabled && s.needsPermission && !confirm('Only switch ' + s.name + ' on if they have given written permission to show their listings. Continue?')) return;
          ctx.api('PATCH', '/admin/api/opportunity-sources/' + s.key, { enabled: !s.enabled }).then(function(){ ctx.toast(s.name + (s.enabled ? ' switched off' : ' switched on')); show('Sources'); }).catch(function(e){ ctx.toast(e.message, true); });
        } });
        var run = h('button', { class: 'btn small ghost', text: 'Run now', onclick: function(){
          run.disabled = true; run.textContent = 'Running…';
          ctx.api('POST', '/admin/api/opportunity-sources/' + s.key + '/run').then(function(r){ ctx.toast(r.error ? (s.name + ': ' + r.error) : (s.name + ': ' + r.count + ' listings'), !!r.error); show('Sources'); }).catch(function(e){ ctx.toast(e.message, true); run.disabled = false; run.textContent = 'Run now'; });
        } });
        tbl.appendChild(h('tr', {}, [
          h('td', {}, [h('a', { href: s.url, target: '_blank', rel: 'noopener', text: s.name }), h('div', { class: 'meta', text: 'every ' + s.everyHours + 'h' })]),
          h('td', { text: s.category || '—' }), h('td', {}, [status]), h('td', { text: String(s.live || 0) }),
          h('td', { text: when(s.lastOkAt) }), h('td', { class: 'meta', text: s.lastError || '' }),
          h('td', {}, [h('div', { class: 'row', style: 'gap:4px' }, [toggle, s.active ? run : null])]),
        ]));
      });
      body.appendChild(h('div', { class: 'card', style: 'overflow-x:auto' }, [tbl]));
    }).catch(function(e){ holder.textContent = e.message; });
  }

  function dirView(){
    var holder = h('div', { class: 'meta', text: 'Loading…' }); body.appendChild(holder);
    ctx.api('GET', '/admin/api/opportunity-directory').then(function(d){
      holder.remove();
      body.appendChild(h('p', { class: 'meta', text: 'Shown in the app under Opportunities → Directory. Edit a name, link or one-line description and press Save. “Reset” puts a built-in entry back to its default (or removes an entry you added).' }));
      var catSel = function(v){ return h('select', {}, d.categories.map(function(c){ return h('option', { value: c.id, text: c.label, selected: c.id === v }); })); };
      // add new
      var nName = h('input', { placeholder: 'Name' }), nUrl = h('input', { placeholder: 'https://…' }), nDesc = h('input', { placeholder: 'One-line description' }), nCat = catSel('intl');
      body.appendChild(h('div', { class: 'card' }, [h('div', { class: 'op-sec', style: 'margin-top:0', text: 'Add a platform' }), h('div', { class: 'op-dir' }, [nName, nUrl, nDesc, nCat]),
        h('button', { class: 'btn small', text: 'Add', onclick: function(){
          ctx.api('POST', '/admin/api/opportunity-directory', { name: nName.value, url: nUrl.value, description: nDesc.value, category: nCat.value }).then(function(){ ctx.toast('Added'); show('Directory'); }).catch(function(e){ ctx.toast(e.message, true); });
        } })]));
      d.categories.forEach(function(cat){
        var card = h('div', { class: 'card' }, [h('div', { class: 'op-sec', style: 'margin-top:0', text: cat.label })]);
        d.items.filter(function(x){ return x.category === cat.id; }).forEach(function(x){
          var name = h('input', { value: x.name }), url = h('input', { value: x.url }), desc = h('input', { value: x.description }), cs = catSel(x.category);
          var hid = h('input', { type: 'checkbox', checked: !!x.hidden });
          var save = h('button', { class: 'btn small', text: 'Save', onclick: function(){
            ctx.api('PUT', '/admin/api/opportunity-directory/' + x.slug, { name: name.value, url: url.value, description: desc.value, category: cs.value, hidden: hid.checked }).then(function(){ ctx.toast('Saved ' + name.value); }).catch(function(e){ ctx.toast(e.message, true); });
          } });
          var reset = x.edited ? h('button', { class: 'btn small ghost', text: x.custom ? 'Remove' : 'Reset', onclick: function(){
            ctx.api('DELETE', '/admin/api/opportunity-directory/' + x.slug).then(function(){ ctx.toast(x.custom ? 'Removed' : 'Reset to default'); show('Directory'); }).catch(function(e){ ctx.toast(e.message, true); });
          } }) : null;
          card.appendChild(h('div', { class: 'op-dir' }, [name, url, desc, cs]));
          card.appendChild(h('div', { class: 'row', style: 'gap:8px;margin-bottom:6px' }, [
            h('span', { class: 'chip ' + (x.access === 'live' ? '' : 'mut'), text: x.access }), h('label', { class: 'row', style: 'gap:4px' }, [hid, 'Hidden']), save, reset,
          ]));
        });
        body.appendChild(card);
      });
    }).catch(function(e){ holder.textContent = e.message; });
  }
  show('Sources');
});
})();
`;
