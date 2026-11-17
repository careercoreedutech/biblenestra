// The "Ads" tab of the /admin dashboard: the remote ad-rules editor and ad statistics.
// Registered with registerAdminScript() from routes/ads.js. Runs inside the dashboard page and only uses
// window.registerAdminTab / ctx.api / ctx.h / ctx.toast.
// NOTE: plain JS in a string — no backticks or "${" inside.
export const ADS_ADMIN_SCRIPT = `
(function(){
if (!window.registerAdminTab) return;
var css = document.createElement('style');
css.textContent = [
  '.ads-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px;margin-bottom:14px}',
  '.ads-stat{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:14px 16px}',
  '.ads-stat .n{font-family:Newsreader,Georgia,serif;font-size:28px;font-weight:600;line-height:1.1}',
  '.ads-stat .l{font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--muted)}',
  '.ads-tbl{width:100%;border-collapse:collapse;font-size:13px}.ads-tbl th,.ads-tbl td{text-align:left;padding:7px 8px;border-top:1px solid var(--border)}',
  '.ads-tbl th{font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);border-top:0}.ads-tbl td.r,.ads-tbl th.r{text-align:right}',
  '.ads-f{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px 16px;margin-top:10px}',
  '.ads-f label{display:flex;flex-direction:column;gap:4px;font-size:12.5px;color:var(--muted);font-weight:600}',
  '.ads-f label.ck{flex-direction:row;align-items:center;gap:8px;color:var(--fg)}',
  '.ads-sec{font-family:Newsreader,Georgia,serif;font-size:18px;font-weight:600;margin:0 0 2px}',
  '.ads-note{background:#F5EBD7;color:#6B4E16;border-radius:12px;padding:10px 12px;font-size:13px;margin:8px 0 14px}'
].join('');
document.head.appendChild(css);

var SURF = [['video', 'Videos'], ['audio', 'Audio'], ['pdf', 'PDFs / books'], ['feed', 'Socials feed'], ['reader', 'Bible reader banner']];
function n(v){ return Number(v || 0).toLocaleString(); }
function pct(v){ return v === null || v === undefined ? '—' : v + '%'; }
function money(o){ var k = Object.keys(o || {}); return k.length ? k.map(function(c){ return c + ' ' + Number(o[c]).toFixed(2); }).join(' · ') : '—'; }
function mmss(s){ s = Math.round(s); var m = Math.floor(s / 60), r = s % 60; return m + ':' + (r < 10 ? '0' : '') + r; }

// Mirror of the app's planner (src/ads/rules.js) for the live preview.
function planVideo(cfg, dur){
  if (!cfg.enabled || !cfg.surfaces.video) return { pre: false, mids: [] };
  var v = cfg.video, band = v.bands[0];
  v.bands.forEach(function(b){ if (dur >= b.fromMin * 60) band = b; });
  var pre = !!v.preRoll && band.ads > 0;
  var count = v.midRolls ? Math.max(0, band.ads - 1) : 0;
  var pos = band.positions.slice(0, count).map(function(p){ return band.unit === 'pct' ? dur * p / 100 : p * 60; });
  if (pos.length < count) { pos = []; for (var i = 1; i <= count; i++) pos.push(dur * i / (count + 1)); }
  var mids = pos.filter(function(s){ return s >= 30 && s <= dur - v.minTailSec; }).sort(function(a, b){ return a - b; });
  return { pre: pre, mids: mids };
}

window.registerAdminTab('Ads', function(box, ctx){
  var h = ctx.h;
  box.appendChild(h('h2', { class: 'serif', text: 'Ads' }));
  box.appendChild(h('p', { class: 'sub', text: 'Where ads appear in Socials, Videos, Audio and PDFs, how often, and how they perform. BibleNestra Plus members never see these ads.' }));
  var nav = h('div', { class: 'row', style: 'gap:6px;margin:10px 0 14px' });
  var body = h('div');
  box.appendChild(nav); box.appendChild(body);
  function show(v){ nav.innerHTML = ''; ['Rules', 'Statistics'].forEach(function(x){ nav.appendChild(h('button', { class: 'btn small ' + (x === v ? '' : 'ghost'), text: x, onclick: function(){ show(x); } })); }); body.innerHTML = ''; (v === 'Rules' ? rulesView : statsView)(); }

  // ---------------- rules editor ----------------
  function rulesView(){
    var holder = h('div', { class: 'meta', text: 'Loading…' }); body.appendChild(holder);
    ctx.api('GET', '/admin/api/ads/config').then(function(d){ holder.remove(); drawForm(d); }).catch(function(e){ holder.textContent = e.message; });
  }
  function drawForm(d){
    var cfg = JSON.parse(JSON.stringify(d.config));
    var form = h('div'); body.appendChild(form);
    function ck(obj, key, label){ var i = h('input', { type: 'checkbox', checked: !!obj[key] }); i.addEventListener('change', function(){ obj[key] = i.checked; preview(); }); return h('label', { class: 'ck' }, [i, label]); }
    function num(obj, key, label, min, max, step){ var i = h('input', { type: 'number', min: min, max: max, step: step || 1, value: obj[key] }); i.addEventListener('input', function(){ obj[key] = i.value === '' ? null : Number(i.value); preview(); }); return h('label', {}, [label, i]); }
    function sec(title, sub, kids){ return h('div', { class: 'card' }, [h('div', { class: 'ads-sec', text: title }), sub ? h('div', { class: 'meta', text: sub }) : null, h('div', { class: 'ads-f' }, kids)]); }

    form.appendChild(h('div', { class: 'ads-note', text: 'Saved changes reach the apps within about 10 minutes (the app re-checks its rules every few minutes and whenever it comes back to the foreground). No app update is needed.' }));
    form.appendChild(h('div', { class: 'meta', style: 'margin-bottom:10px', text: d.version ? ('Current rules: version ' + d.version + ' · saved ' + new Date(d.updatedAt).toLocaleString()) : 'Using the built-in defaults (nothing saved yet).' }));

    form.appendChild(sec('Where ads show', 'Switch everything off, or one surface at a time.', [ck(cfg, 'enabled', 'Ads on (master switch)')].concat(SURF.map(function(s){ return ck(cfg.surfaces, s[0], s[1]); }))));

    // video
    var bandsBox = h('div');
    var prevBox = h('div', { class: 'meta', style: 'margin-top:10px' });
    var vcard = sec('Videos', 'Pre-roll = an ad before the video starts. Mid-rolls are full-screen ad breaks at the positions below; the player shows a short “Ad break” notice first. Never shown on YouTube videos.', [
      ck(cfg.video, 'preRoll', 'Pre-roll ad'), ck(cfg.video, 'midRolls', 'Mid-roll ad breaks'),
      num(cfg.video, 'skipAfterSec', 'Skip countdown (seconds)', 0, 60), num(cfg.video, 'noticeSec', '“Ad break” notice (seconds)', 0, 10),
      num(cfg.video, 'minTailSec', 'No mid-roll in the last … seconds', 0, 600),
    ]);
    vcard.appendChild(h('div', { class: 'meta', style: 'margin-top:8px', text: 'Note: Google AdMob decides when its own video ads can be skipped. The skip countdown is used by BibleNestra’s own ad-break screen and demo ads.' }));
    vcard.appendChild(h('div', { class: 'ads-sec', style: 'margin-top:14px;font-size:15px', text: 'Ads by video length' }));
    vcard.appendChild(h('div', { class: 'meta', text: 'A video uses the row with the highest “from” it reaches. “Ads” counts the pre-roll too. Positions are minutes into the video, or % of its length; if fewer positions than mid-rolls are given, breaks are spread evenly.' }));
    vcard.appendChild(bandsBox); vcard.appendChild(prevBox);
    form.appendChild(vcard);
    function drawBands(){
      bandsBox.innerHTML = '';
      var t = h('table', { class: 'ads-tbl', style: 'margin-top:8px' });
      t.appendChild(h('tr', {}, ['From (min)', 'Ads (incl. pre-roll)', 'Positions in', 'Mid-roll positions (comma separated)', ''].map(function(x){ return h('th', { text: x }); })));
      cfg.video.bands.forEach(function(b, i){
        var from = h('input', { type: 'number', min: 0, max: 600, step: 'any', value: b.fromMin, style: 'width:90px' });
        from.addEventListener('input', function(){ b.fromMin = from.value === '' ? null : Number(from.value); preview(); });
        var ads = h('input', { type: 'number', min: 0, max: 6, value: b.ads, style: 'width:80px' });
        ads.addEventListener('input', function(){ b.ads = ads.value === '' ? null : Number(ads.value); preview(); });
        var unit = h('select', {}, [h('option', { value: 'min', text: 'minutes', selected: b.unit === 'min' }), h('option', { value: 'pct', text: '% of length', selected: b.unit === 'pct' })]);
        unit.addEventListener('change', function(){ b.unit = unit.value; preview(); });
        var pos = h('input', { value: b.positions.join(', '), placeholder: 'e.g. 5, 12', style: 'width:100%' });
        pos.addEventListener('input', function(){ b.positions = pos.value.split(',').map(function(x){ return x.trim(); }).filter(Boolean).map(Number); preview(); });
        var del = h('button', { class: 'btn small ghost', text: 'Remove', disabled: cfg.video.bands.length < 2, onclick: function(){ cfg.video.bands.splice(i, 1); drawBands(); } });
        t.appendChild(h('tr', {}, [h('td', {}, [from]), h('td', {}, [ads]), h('td', {}, [unit]), h('td', {}, [pos]), h('td', {}, [del])]));
      });
      bandsBox.appendChild(t);
      bandsBox.appendChild(h('button', { class: 'btn small ghost', style: 'margin-top:8px', text: 'Add length band', disabled: cfg.video.bands.length >= 8, onclick: function(){ var last = cfg.video.bands[cfg.video.bands.length - 1]; cfg.video.bands.push({ fromMin: (last ? last.fromMin : 0) + 10, ads: 1, unit: 'min', positions: [] }); drawBands(); } }));
      preview();
    }
    function preview(){
      try {
        var sorted = JSON.parse(JSON.stringify(cfg)); sorted.video.bands.sort(function(a, b){ return a.fromMin - b.fromMin; });
        prevBox.textContent = 'Preview: ' + [3, 6, 12, 20, 45].map(function(m){ var p = planVideo(sorted, m * 60); var parts = (p.pre ? ['pre-roll'] : []).concat(p.mids.map(mmss)); return m + ' min → ' + (parts.length ? parts.join(' + ') : 'no ads'); }).join('  ·  ');
      } catch (e) { prevBox.textContent = ''; }
    }
    drawBands();

    form.appendChild(sec('Audio', 'Ads only play while the app is open on screen — never between tracks in the background.', [
      ck(cfg.audio, 'preRoll', 'Ad before the first track'), num(cfg.audio, 'betweenEvery', 'Ad between every N tracks (0 = off)', 0, 50), num(cfg.audio, 'skipAfterSec', 'Skip countdown (seconds)', 0, 60),
    ]));
    form.appendChild(sec('PDFs and books', null, [ck(cfg.pdf, 'preRoll', 'Ad before opening'), num(cfg.pdf, 'skipAfterSec', 'Skip countdown (seconds)', 0, 60)]));
    form.appendChild(sec('Socials feed', null, [num(cfg.feed, 'every', 'One sponsored card every N posts', 2, 50)]));

    var cats = h('input', { value: (cfg.disabledCategories || []).join(', '), placeholder: 'e.g. kids, prayer, funeral', style: 'width:100%' });
    cats.addEventListener('input', function(){ cfg.disabledCategories = cats.value.split(',').map(function(x){ return x.trim(); }).filter(Boolean); });
    form.appendChild(h('div', { class: 'card' }, [h('div', { class: 'ads-sec', text: 'No ads in these categories' }), h('div', { class: 'meta', text: 'Content category names (as used by videos, audio and books), comma separated. Not case-sensitive.' }), h('div', { style: 'margin-top:8px' }, [cats])]));

    form.appendChild(sec('Frequency caps', 'Full-screen ads (pre-rolls, ad breaks, game breaks) are limited per device so ads stay pleasant and within Google’s policies. Rewarded ads people choose to watch are not limited.', [
      num(cfg.caps, 'minSecondsBetween', 'At least … seconds between ads', 30, 3600), num(cfg.caps, 'maxPerHour', 'At most … per hour', 0, 20), num(cfg.caps, 'maxPerDay', 'At most … per day', 0, 100),
    ]));

    var note = h('input', { placeholder: 'What changed? (optional, kept in the history)', class: 'grow' });
    var save = h('button', { class: 'btn', text: 'Save rules' });
    var reset = h('button', { class: 'btn ghost', text: 'Reset form to defaults' });
    save.addEventListener('click', async function(){
      save.disabled = true;
      try { var r = await ctx.api('PUT', '/admin/api/ads/config', { config: cfg, note: note.value }); ctx.toast('Saved as version ' + r.version + ' — apps pick it up within ~10 minutes'); show('Rules'); }
      catch (e) { ctx.toast(e.message, true); save.disabled = false; }
    });
    reset.addEventListener('click', function(){ if (!confirm('Fill the form with the built-in defaults? Nothing is saved until you press Save.')) return; body.innerHTML = ''; drawForm({ config: d.defaults, defaults: d.defaults, history: d.history, version: d.version, updatedAt: d.updatedAt }); ctx.toast('Defaults loaded — press Save to use them'); });
    form.appendChild(h('div', { class: 'card' }, [h('div', { class: 'row' }, [note, reset, save])]));

    if (d.history && d.history.length) {
      var hc = h('div', { class: 'card' }, [h('div', { class: 'ads-sec', text: 'Recent saves' })]);
      d.history.forEach(function(x){ hc.appendChild(h('div', { class: 'row', style: 'padding:6px 0;border-top:1px solid var(--border)' }, [h('span', { class: 'chip', text: 'v' + x.version }), h('span', { class: 'grow', text: x.note || '' }), h('span', { class: 'meta', text: (x.admin || '—') + ' · ' + new Date(x.createdAt).toLocaleString() })])); });
      form.appendChild(hc);
    }
  }

  // ---------------- statistics ----------------
  function statsView(){
    var days = h('select', {}, [7, 30, 90].map(function(x){ return h('option', { value: x, text: 'Last ' + x + ' days', selected: x === 30 }); }));
    var test = h('input', { type: 'checkbox' });
    var out = h('div');
    body.appendChild(h('div', { class: 'row', style: 'margin-bottom:12px' }, [days, h('label', { class: 'row meta', style: 'gap:6px' }, [test, 'Include test / demo ads']), h('div', { class: 'grow' })]));
    body.appendChild(out);
    days.addEventListener('change', load); test.addEventListener('change', load);
    function stat(l, v, sub){ return h('div', { class: 'ads-stat' }, [h('div', { class: 'l', text: l }), h('div', { class: 'n', text: v }), sub ? h('div', { class: 'meta', text: sub }) : null]); }
    function table(cols, rows){
      var t = h('table', { class: 'ads-tbl' });
      t.appendChild(h('tr', {}, cols.map(function(c){ return h('th', { class: c[2] ? 'r' : '', text: c[0] }); })));
      rows.forEach(function(r){ t.appendChild(h('tr', {}, cols.map(function(c){ return h('td', { class: c[2] ? 'r' : '', text: c[1](r) }); }))); });
      return t;
    }
    async function load(){
      out.innerHTML = ''; out.appendChild(h('div', { class: 'meta', text: 'Loading…' }));
      var d;
      try { d = await ctx.api('GET', '/admin/api/ads/stats?days=' + days.value + (test.checked ? '&test=1' : '')); } catch (e) { out.innerHTML = ''; out.appendChild(h('div', { class: 'card', text: e.message })); return; }
      out.innerHTML = '';
      var t = d.totals;
      out.appendChild(h('div', { class: 'ads-grid' }, [
        stat('Impressions', n(t.impressions), n(t.requested) + ' requested'),
        stat('Fill rate', pct(t.fillRate), 'impressions ÷ requests'),
        stat('Completed', n(t.completed), pct(t.completionRate) + ' of impressions'),
        stat('Failed', n(t.failed), n(t.clicks) + ' clicks'),
        stat('Estimated revenue', money(t.revenue), 'from AdMob paid events'),
      ]));
      out.appendChild(h('div', { class: 'meta', style: 'margin:-4px 0 12px', text: 'Impressions are counted only when Google’s ad SDK reports the ad on screen (never on request). Estimated revenue needs impression-level ad revenue switched on in AdMob; AdMob’s own reports remain the source of truth for payments. Until the app uses real ad unit ids, ads are Google test ads and only appear with “Include test / demo ads”.' }));
      var COLS = [['Impr.', function(r){ return n(r.impressions); }, 1], ['Requested', function(r){ return n(r.requested); }, 1], ['Fill', function(r){ return pct(r.fillRate); }, 1], ['Completed', function(r){ return n(r.completed); }, 1], ['Failed', function(r){ return n(r.failed); }, 1], ['Revenue', function(r){ return money(r.revenue); }, 1]];
      out.appendChild(h('div', { class: 'card' }, [h('div', { class: 'ads-sec', text: 'By surface' }), d.bySurface.length ? table([['Surface', function(r){ return r.surface + ' (' + r.formats.join(', ') + ')'; }]].concat(COLS), d.bySurface) : h('div', { class: 'meta', text: 'No ad activity in this period.' })]));
      out.appendChild(h('div', { class: 'card' }, [h('div', { class: 'ads-sec', text: 'By day' }), d.byDay.length ? table([['Day', function(r){ return r.day; }]].concat(COLS), d.byDay) : h('div', { class: 'meta', text: 'No ad activity in this period.' })]));
    }
    load();
  }
  show('Rules');
});
})();
`;
