// Admin tab "Feed ranking": shows the weights and limits behind the For you feed (read-only here; change them in
// Admin > Wallets & payments > Settings, key 'feed_ranking', JSON). Served through admin-page.js registerAdminTab.
// NOTE: the client script avoids backticks and "${" because it lives inside a JS template string.
export const FEED_RANKING_ADMIN_SCRIPT = `
(function(){
if (!window.registerAdminTab) return;
var LABELS = {
  exploration_pct: 'Exploration (% of slots from outside your circles)',
  decay_hours: 'Freshness decay (hours)',
  quality_decay_hours: 'Engagement decay (hours)',
  per_author_cap: 'Max posts per author in a window',
  window: 'Window size for the caps',
  pool_days: 'Candidate pool: last N days',
  evergreen_max: 'Candidate pool: top older posts',
  pool_max: 'Candidate pool: max candidates scored'
};
var WLABELS = {
  relevance: 'Interest match (topics)', social: 'People you follow', affinity: 'Past engagement with the author',
  quality: 'Engagement rate', locality: 'Same country, city or church', freshness: 'Recency', jitter: 'Per-user variety'
};
window.registerAdminTab('Feed ranking', function(box, ctx){
  var h = ctx.h, api = ctx.api, toast = ctx.toast;
  box.appendChild(h('h2', { class: 'serif', text: 'For you feed ranking' }));
  box.appendChild(h('p', { class: 'sub', text: 'How the For you feed orders posts for each person. Change the values in Wallets & payments > Settings (key feed_ranking, JSON). The Following tab is always newest first.' }));
  var body = h('div'); box.appendChild(body);
  function table(title, rows){
    var card = h('div', { class: 'card' });
    card.appendChild(h('div', { class: 'eyebrow', text: title }));
    rows.forEach(function(r){
      card.appendChild(h('div', { class: 'row', style: 'justify-content:space-between;border-top:1px solid var(--border);padding:8px 0' }, [
        h('span', { text: r[0] }), h('code', { text: String(r[1]) })
      ]));
    });
    return card;
  }
  async function load(){
    body.innerHTML = '';
    var d; try { d = await api('GET', '/admin/api/feed-ranking'); } catch (e) { body.appendChild(h('div', { class: 'card empty', text: e.message })); return; }
    var c = d.config, rows = [];
    Object.keys(LABELS).forEach(function(k){ rows.push([LABELS[k], c[k]]); });
    body.appendChild(table('Settings', rows));
    var wrows = []; Object.keys(WLABELS).forEach(function(k){ wrows.push([WLABELS[k], c.weights[k]]); });
    body.appendChild(table('Score weights', wrows));
    body.appendChild(h('div', { class: 'card sub', text: 'Topics: ' + d.topics.map(function(t){ return t.label; }).join(', ') + '.' }));
    var retag = h('div', { class: 'card' });
    var status = h('div', { class: 'sub', text: 'Posts published before topics existed have none. Re-tag adds topics to them from their text, kind and passage. Safe to run again: it only touches posts with no topics yet.' });
    var go = h('button', { class: 'btn small', text: 'Re-tag older posts' });
    go.onclick = async function(){
      go.disabled = true;
      var after = null, total = 0, batches = 0;
      try {
        do {
          var r = await api('POST', '/admin/api/feed-ranking/retag', { after: after, limit: 200 });
          total += r.tagged; after = r.next; batches += 1;
          status.textContent = 'Batch ' + batches + ' done · ' + total + ' posts tagged so far' + (after ? ' …' : '.');
        } while (after && batches < 500);
        toast('Re-tag finished: ' + total + ' posts tagged');
      } catch (e) { toast(e.message, true); }
      go.disabled = false;
    };
    retag.appendChild(status); retag.appendChild(go);
    body.appendChild(retag);
  }
  load();
});
})();
`;
