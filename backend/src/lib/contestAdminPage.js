// The "Contests" tab of the /admin dashboard (Contest Centre). Registered with registerAdminScript() (see routes/admin.js).
// It runs inside the dashboard page and only uses window.registerAdminTab / ctx.api / ctx.h.
// NOTE: plain JS in a string — no backticks or "${" inside.
export const CONTEST_ADMIN_SCRIPT = `
(function(){
if (!window.registerAdminTab) return;
var LABEL = { upcoming: ['Scheduled', 'gold'], registration_open: ['Registration open', ''], live: ['Live', ''], voting_open: ['Voting', ''], judging: ['Judging', 'gold'],
  completed: ['Completed', 'mut'], paused: ['Paused', 'gold'], pending_approval: ['Needs approval', 'neg'], rejected: ['Rejected', 'mut'], cancelled: ['Cancelled', 'neg'] };
function when(s){ return s ? new Date(s).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''; }
function secs(ms){ return (Math.round((ms || 0) / 100) / 10) + 's'; }

window.registerAdminTab('Contests', function(box, ctx){
  var h = ctx.h;
  box.appendChild(h('h2', { class: 'serif', text: 'Contest Centre' }));
  box.appendChild(h('p', { class: 'sub', text: 'Quizzes, memory challenges, church vs church and creative contests (singing, writing, preaching, design, photo, video). Entry and votes are free; paid entry is not enabled. Coin prizes and certificates are issued automatically when results are published.' }));
  var views = ['Contests', 'New contest', 'Categories', 'Organizers', 'Reports'];
  var nav = h('div', { class: 'row', style: 'gap:6px;margin:10px 0 14px;flex-wrap:wrap' });
  var body = h('div');
  box.appendChild(nav); box.appendChild(body);
  var current = 'Contests';
  function show(v){ current = v; nav.innerHTML = ''; views.forEach(function(x){ nav.appendChild(h('button', { class: 'btn small ' + (x === v ? '' : 'ghost'), text: x, onclick: function(){ show(x); } })); }); body.innerHTML = ''; ({ 'Contests': listView, 'New contest': createView, 'Categories': catView, 'Organizers': orgView, 'Reports': reportView })[v](); }
  function col(label, el){ return h('div', { class: 'grow' }, [h('label', { class: 'f', text: label }), el]); }
  async function call(method, path, data, msg){ try { var r = await ctx.api(method, path, data); if (msg) ctx.toast(msg); return r; } catch (e) { ctx.toast(e.message, true); return null; } }

  // ---------------- list ----------------
  function listView(){
    var list = h('div'); body.appendChild(list);
    function act(label, cls, path, ask, data){
      return h('button', { class: 'btn small ' + cls, text: label, onclick: async function(){
        if (ask && !confirm(ask)) return;
        if (await call('POST', path, data, 'Done')) load();
      } });
    }
    function card(c){
      var s = LABEL[c.status] || LABEL.completed;
      var detail = h('div');
      var prizes = (c.prizeCoins || []).map(function(n, i){ return '#' + (i + 1) + ': ' + n + ' coins'; }).join(' · ');
      var base = '/admin/api/contests/' + c.id;
      function panel(fn){ return async function(){ detail.innerHTML = ''; detail.appendChild(h('div', { class: 'meta', text: 'Loading…' })); try { await fn(); } catch (e) { detail.innerHTML = ''; detail.appendChild(h('div', { class: 'meta', text: e.message })); } }; }
      var results = panel(async function(){
        var d = await ctx.api('GET', base);
        detail.innerHTML = '';
        if (!d.leaderboard.length) detail.appendChild(h('div', { class: 'meta', style: 'margin-top:10px', text: 'No scores yet.' }));
        d.leaderboard.forEach(function(r){
          var stat = c.format === 'quiz' ? r.correct + '/' + r.total + ' · ' + secs(r.durationMs) : (r.title || '') + ' · ' + (r.votes || 0) + ' votes' + (r.score !== null && r.score !== undefined ? ' · score ' + r.score : '');
          detail.appendChild(h('div', { class: 'row', style: 'margin-top:8px;gap:10px' }, [
            h('b', { text: '#' + r.place }), h('span', { class: 'grow', text: r.user.displayName + (r.user.handle ? ' (@' + r.user.handle + ')' : '') }),
            h('span', { class: 'meta', text: stat + (r.prizeCoins ? ' · ' + r.prizeCoins + ' coins paid' : '') }),
          ]));
        });
        if (d.sponsors && d.sponsors.length) {
          detail.appendChild(h('div', { class: 'serif', style: 'margin-top:14px', text: 'Sponsors' }));
          d.sponsors.forEach(function(sp){
            detail.appendChild(h('div', { class: 'row', style: 'margin-top:6px;gap:8px' }, [
              h('span', { class: 'grow', text: sp.name + (sp.contribution ? ' — ' + sp.contribution : '') + (sp.linkUrl ? ' (' + sp.linkUrl + ')' : '') }),
              sp.approved ? h('span', { class: 'chip', text: 'Approved' }) : h('button', { class: 'btn small', text: 'Approve', onclick: async function(){ if (await call('POST', '/admin/api/contest-sponsors/' + sp.id, { approved: true }, 'Sponsor approved')) results(); } }),
              h('button', { class: 'btn small danger', text: 'Remove', onclick: async function(){ if (confirm('Remove this sponsor?') && await call('POST', '/admin/api/contest-sponsors/' + sp.id, { remove: true }, 'Removed')) results(); } }),
            ]));
          });
        }
      });
      var votes = panel(async function(){
        var d = await ctx.api('GET', base + '/votes');
        detail.innerHTML = '';
        var fresh = d.items.filter(function(v){ return v.newAccount && v.valid; }).length;
        detail.appendChild(h('div', { class: 'meta', style: 'margin-top:10px', text: d.items.length + ' votes · ' + fresh + ' from accounts made within a day of voting (worth checking)' }));
        d.items.forEach(function(v){
          detail.appendChild(h('div', { class: 'row', style: 'margin-top:6px;gap:8px' }, [
            h('span', { class: 'grow', text: v.user.displayName + ' → ' + v.entryTitle + ' · ' + when(v.createdAt) }),
            v.newAccount ? h('span', { class: 'chip gold', text: 'New account' }) : null,
            v.valid ? h('button', { class: 'btn small danger', text: 'Reverse', onclick: async function(){ var why = prompt('Why reverse this vote?'); if (why && await call('POST', '/admin/api/contest-votes/' + v.id + '/reverse', { reason: why }, 'Vote reversed')) votes(); } })
              : h('span', { class: 'chip mut', text: 'Reversed: ' + (v.reversedReason || '') }),
          ]));
        });
      });
      return h('div', { class: 'card' }, [
        h('div', { class: 'row', style: 'gap:6px' }, [h('span', { class: 'chip ' + s[1], text: s[0] }), h('b', { class: 'grow', text: c.title }), h('span', { class: 'meta', text: when(c.startsAt) + ' → ' + when(c.endsAt) })]),
        h('div', { class: 'meta', style: 'margin-top:6px', text: (c.contestCategoryLabel || c.contestCategory) + (c.format === 'quiz' ? ' · ' + c.questionCount + ' questions · ' + c.secondsPerQuestion + 's each · ' + (c.entries || 0) + ' played' : ' · ' + c.scoring + (c.votingEnabled ? ' · voting until ' + when(c.votingEndsAt) : '') + ' · ' + (c.submissions || 0) + ' entries') + (c.organizerId ? ' · by an organizer' : '') }),
        prizes || c.prizeText ? h('div', { class: 'meta', style: 'margin-top:4px', text: 'Prizes: ' + [prizes, c.prizeText].filter(Boolean).join(' · ') }) : null,
        c.description ? h('div', { class: 'meta', style: 'margin-top:4px', text: c.description }) : null,
        h('div', { class: 'row', style: 'margin-top:10px;gap:6px;flex-wrap:wrap' }, [
          c.status === 'pending_approval' ? act('Approve', '', base + '/approve') : null,
          c.status === 'pending_approval' ? h('button', { class: 'btn small danger', text: 'Reject', onclick: async function(){ var why = prompt('Reason for the organizer?'); if (why && await call('POST', base + '/reject', { reason: why }, 'Rejected')) load(); } }) : null,
          h('button', { class: 'btn small ghost', text: 'Results & sponsors', onclick: results }),
          c.format === 'submission' ? h('button', { class: 'btn small ghost', text: 'Votes', onclick: votes }) : null,
          h('div', { class: 'grow' }),
          ['live', 'upcoming', 'registration_open'].indexOf(c.status) >= 0 ? act('End now', 'ghost', base + '/end', 'Close this contest now? Quiz prizes are paid once attempts in progress run out; creative contests move on to voting/judging.') : null,
          ['completed', 'cancelled'].indexOf(c.status) < 0 ? act('Cancel', 'danger', base + '/cancel', 'Cancel this contest? It disappears from the app and no prizes are paid.') : null,
        ]),
        detail,
      ]);
    }
    async function load(){
      list.innerHTML = '<div class="meta">Loading…</div>';
      var d; try { d = await ctx.api('GET', '/admin/api/contests'); } catch (e) { list.textContent = e.message; return; }
      list.innerHTML = '';
      var pending = d.items.filter(function(c){ return c.status === 'pending_approval'; }).length;
      if (pending) list.appendChild(h('div', { class: 'card', style: 'border-left:4px solid #c0392b' }, [h('b', { text: pending + ' contest' + (pending > 1 ? 's' : '') + ' waiting for approval' })]));
      if (!d.items.length) list.appendChild(h('div', { class: 'card empty' }, [h('span', { class: 'serif', text: 'No contests yet' }), 'Create one under New contest and it appears in Discover → Contest Centre.']));
      d.items.forEach(function(c){ list.appendChild(card(c)); });
    }
    load();
  }

  // ---------------- create ----------------
  function createView(){
    var f = {
      type: h('select', {}), title: h('input', { maxlength: '100', placeholder: 'e.g. Christmas Bible Challenge', style: 'width:100%' }),
      description: h('textarea', { maxlength: '2000', placeholder: 'What is it about?' }),
      topic: h('select', {}), count: h('input', { type: 'number', min: '5', max: '30', value: '10', style: 'width:100%' }),
      seconds: h('input', { type: 'number', min: '10', max: '60', value: '20', style: 'width:100%' }),
      scoring: h('select', {}, [h('option', { value: 'judged', text: 'Judges decide' }), h('option', { value: 'popularity', text: 'Community votes decide' })]),
      voting: h('input', { type: 'checkbox', checked: 'checked' }), weight: h('input', { type: 'number', min: '0', max: '100', value: '70', style: 'width:100%' }),
      votingEnds: h('input', { type: 'datetime-local' }), requirements: h('textarea', { maxlength: '2000', placeholder: 'What should people submit?' }),
      criteria: h('textarea', { maxlength: '2000', placeholder: 'Judging criteria' }),
      c1: h('input', { type: 'number', min: '0', value: '500', style: 'width:100%' }), c2: h('input', { type: 'number', min: '0', value: '250', style: 'width:100%' }), c3: h('input', { type: 'number', min: '0', value: '100', style: 'width:100%' }),
      prize: h('input', { maxlength: '200', placeholder: 'e.g. A study Bible (optional)', style: 'width:100%' }),
      start: h('input', { type: 'datetime-local' }), end: h('input', { type: 'datetime-local' }),
      rules: h('textarea', { maxlength: '5000', placeholder: 'Rules (optional)' }), eligibility: h('input', { maxlength: '2000', placeholder: 'Who can enter (optional)', style: 'width:100%' }),
      limit: h('input', { type: 'number', min: '1', placeholder: 'No limit', style: 'width:100%' }), countries: h('input', { placeholder: 'e.g. Nigeria, Ghana (empty = everywhere)', style: 'width:100%' }),
      certAll: h('input', { type: 'checkbox' }), notify: h('input', { type: 'checkbox' }),
    };
    var cats = [];
    var quizBox = h('div'); var subBox = h('div');
    function sync(){ var c = cats.filter(function(x){ return x.id === f.type.value; })[0] || { format: 'quiz' }; quizBox.style.display = c.format === 'quiz' ? '' : 'none'; subBox.style.display = c.format === 'quiz' ? 'none' : ''; if (c.scoring && c.format !== 'quiz') f.scoring.value = c.scoring; }
    f.type.onchange = sync;
    ctx.api('GET', '/admin/api/contests/categories').then(function(d){
      cats = d.categories.filter(function(x){ return x.active; });
      cats.forEach(function(k){ f.type.appendChild(h('option', { value: k.id, text: k.label })); });
      d.items.forEach(function(k){ f.topic.appendChild(h('option', { value: k.id, text: k.label + ' (' + k.questions + ' questions)' })); });
      sync();
    }).catch(function(e){ ctx.toast(e.message, true); });
    quizBox.appendChild(h('div', { class: 'row' }, [col('Questions from', f.topic), col('Number of questions', f.count), col('Seconds per question', f.seconds)]));
    subBox.appendChild(h('div', { class: 'row' }, [col('Winners chosen by', f.scoring), col('Judges share % (when votes count too)', f.weight), col('Voting ends (empty = 3 days after entries close)', f.votingEnds)]));
    subBox.appendChild(h('label', { class: 'row', style: 'gap:8px;margin-top:10px' }, [f.voting, 'Community voting (free, one vote each)']));
    subBox.appendChild(h('label', { class: 'f', text: 'Submission requirements' })); subBox.appendChild(f.requirements);
    subBox.appendChild(h('label', { class: 'f', text: 'Judging criteria' })); subBox.appendChild(f.criteria);
    var create = h('button', { class: 'btn', text: 'Create contest' });
    create.onclick = async function(){
      if (!f.title.value.trim()) { f.title.focus(); return ctx.toast('Add a title', true); }
      if (!f.end.value) { f.end.focus(); return ctx.toast('Choose when it ends', true); }
      create.disabled = true;
      var payload = {
        contestCategory: f.type.value, title: f.title.value.trim(), description: f.description.value, category: f.topic.value,
        questionCount: Number(f.count.value), secondsPerQuestion: Number(f.seconds.value),
        scoring: f.scoring.value, votingEnabled: f.voting.checked, judgeWeight: Number(f.weight.value),
        votingEndsAt: f.votingEnds.value ? new Date(f.votingEnds.value).toISOString() : undefined,
        submissionRequirements: f.requirements.value, judgingCriteria: f.criteria.value,
        prizeCoins: [Number(f.c1.value) || 0, Number(f.c2.value) || 0, Number(f.c3.value) || 0], prizeText: f.prize.value.trim(),
        startsAt: f.start.value ? new Date(f.start.value).toISOString() : null, endsAt: new Date(f.end.value).toISOString(),
        rules: f.rules.value, eligibility: f.eligibility.value, participantLimit: f.limit.value ? Number(f.limit.value) : undefined,
        eligibleCountries: f.countries.value.split(',').map(function(x){ return x.trim(); }).filter(Boolean),
        certificatesFor: f.certAll.checked ? 'all' : 'winners', notifyAll: f.notify.checked,
      };
      var r = await call('POST', '/admin/api/contests', payload);
      create.disabled = false;
      if (r) { ctx.toast('Contest created' + (r.notified ? ' · sent to ' + r.notified + ' bells' : '')); show('Contests'); }
    };
    body.appendChild(h('div', { class: 'card' }, [
      h('div', { class: 'serif', style: 'font-size:18px', text: 'New contest' }),
      h('label', { class: 'f', text: 'Type' }), f.type,
      h('label', { class: 'f', text: 'Title' }), f.title,
      h('label', { class: 'f', text: 'Description' }), f.description,
      quizBox, subBox,
      h('div', { class: 'row' }, [col('Coins for 1st', f.c1), col('Coins for 2nd', f.c2), col('Coins for 3rd', f.c3)]),
      h('label', { class: 'f', text: 'Other prize' }), f.prize,
      h('div', { class: 'row' }, [col('Starts (empty = now)', f.start), col('Ends / entries close', f.end)]),
      h('label', { class: 'f', text: 'Rules' }), f.rules,
      h('label', { class: 'f', text: 'Eligibility' }), f.eligibility,
      h('div', { class: 'row' }, [col('Participant limit', f.limit), col('Countries', f.countries)]),
      h('label', { class: 'row', style: 'gap:8px;margin-top:12px' }, [f.certAll, 'Certificates for every participant (winners always get one)']),
      h('label', { class: 'row', style: 'gap:8px;margin-top:8px' }, [f.notify, 'Tell everyone in their notifications (bell)']),
      h('div', { class: 'meta', style: 'margin-top:10px', text: 'Entry is free. Paid entry and paid votes are not enabled.' }),
      h('div', { class: 'row', style: 'margin-top:14px' }, [create]),
    ]));
  }

  // ---------------- categories ----------------
  async function catView(){
    var d = await call('GET', '/admin/api/contests/categories'); if (!d) return;
    body.appendChild(h('p', { class: 'meta', text: 'Switch a category off to stop new contests of that type. Running contests are not affected.' }));
    d.categories.forEach(function(k){
      var box = h('input', { type: 'checkbox' }); box.checked = !!k.active;
      box.onchange = function(){ call('PATCH', '/admin/api/contest-categories/' + k.id, { active: box.checked }, box.checked ? 'Switched on' : 'Switched off'); };
      body.appendChild(h('div', { class: 'card' }, [h('label', { class: 'row', style: 'gap:10px' }, [box, h('b', { class: 'grow', text: k.label }), h('span', { class: 'meta', text: k.format + ' · ' + k.scoring + (k.kinds && k.kinds.length ? ' · ' + k.kinds.join('/') : '') })]),
        k.description ? h('div', { class: 'meta', style: 'margin-top:4px', text: k.description }) : null]));
    });
  }

  // ---------------- organizers ----------------
  async function orgView(){
    body.appendChild(h('p', { class: 'meta', text: 'Organizers (churches, ministries, community leaders) can create contests from the app. Their contests wait for approval here.' }));
    var listBox = h('div'); var search = h('input', { placeholder: 'Find a user to make an organizer', style: 'width:100%' }); var results = h('div');
    body.appendChild(h('div', { class: 'card' }, [search, results])); body.appendChild(listBox);
    async function loadList(){
      var d = await call('GET', '/admin/api/contest-organizers'); if (!d) return;
      listBox.innerHTML = '';
      if (!d.items.length) listBox.appendChild(h('div', { class: 'meta', text: 'No organizers yet.' }));
      d.items.forEach(function(u){ listBox.appendChild(h('div', { class: 'card row', style: 'gap:10px' }, [h('b', { class: 'grow', text: u.displayName + (u.handle ? ' (@' + u.handle + ')' : '') }),
        h('button', { class: 'btn small danger', text: 'Remove access', onclick: async function(){ if (await call('POST', '/admin/api/contest-organizers/' + u.id, { canOrganize: false }, 'Access removed')) loadList(); } })])); });
    }
    var t = null;
    search.oninput = function(){ clearTimeout(t); t = setTimeout(async function(){
      results.innerHTML = ''; if (search.value.trim().length < 2) return;
      var d = await call('GET', '/admin/api/users?q=' + encodeURIComponent(search.value.trim())); if (!d) return;
      d.items.slice(0, 8).forEach(function(u){ results.appendChild(h('div', { class: 'row', style: 'gap:10px;margin-top:8px' }, [h('span', { class: 'grow', text: u.displayName + (u.handle ? ' (@' + u.handle + ')' : '') }),
        h('button', { class: 'btn small', text: 'Make organizer', onclick: async function(){ if (await call('POST', '/admin/api/contest-organizers/' + u.id, { canOrganize: true }, 'Organizer added')) { search.value = ''; results.innerHTML = ''; loadList(); } } })])); });
    }, 300); };
    loadList();
  }

  // ---------------- reports ----------------
  async function reportView(){
    var status = h('select', {}, [h('option', { value: 'open', text: 'Open' }), h('option', { value: 'resolved', text: 'Resolved' }), h('option', { value: 'rejected', text: 'Rejected' })]);
    var listBox = h('div');
    var certCode = h('input', { placeholder: 'BN-XXXXXXXX', style: 'width:160px' });
    body.appendChild(h('div', { class: 'row', style: 'gap:10px' }, [h('label', { class: 'f', text: 'Show' }), status, h('div', { class: 'grow' }), certCode,
      h('button', { class: 'btn small danger', text: 'Revoke certificate', onclick: async function(){ var code = certCode.value.trim().toUpperCase(); if (code && confirm('Revoke certificate ' + code + '?') && await call('POST', '/admin/api/contest-certificates/' + encodeURIComponent(code) + '/revoke', {}, 'Certificate revoked')) certCode.value = ''; } })]));
    body.appendChild(listBox);
    async function load(){
      var d = await call('GET', '/admin/api/contest-disputes?status=' + status.value); if (!d) return;
      listBox.innerHTML = '';
      if (!d.items.length) listBox.appendChild(h('div', { class: 'card empty' }, [h('span', { class: 'serif', text: 'Nothing here' })]));
      d.items.forEach(function(x){
        var res = h('input', { placeholder: 'Resolution (sent to the user)', style: 'width:100%' });
        listBox.appendChild(h('div', { class: 'card' }, [
          h('div', { class: 'row', style: 'gap:8px' }, [h('b', { class: 'grow', text: x.contestTitle }), h('span', { class: 'meta', text: x.user.displayName + ' · ' + when(x.createdAt) })]),
          h('div', { style: 'margin-top:6px', text: x.reason }),
          x.resolution ? h('div', { class: 'meta', style: 'margin-top:6px', text: 'Resolution: ' + x.resolution }) : null,
          x.status === 'open' ? h('div', {}, [res, h('div', { class: 'row', style: 'gap:6px;margin-top:8px' }, [
            h('button', { class: 'btn small', text: 'Resolve', onclick: async function(){ if (await call('POST', '/admin/api/contest-disputes/' + x.id, { status: 'resolved', resolution: res.value }, 'Resolved')) load(); } }),
            h('button', { class: 'btn small ghost', text: 'Reject', onclick: async function(){ if (await call('POST', '/admin/api/contest-disputes/' + x.id, { status: 'rejected', resolution: res.value }, 'Rejected')) load(); } }),
          ])]) : null,
        ]));
      });
    }
    status.onchange = load;
    load();
  }
  show('Contests');
});
})();
`;
