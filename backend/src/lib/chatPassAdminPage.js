// CHAT WEEK PASS — "Chat passes" tab of the /admin dashboard. Registered with registerAdminScript() from
// routes/referrals.js. Read-only, append-only purchase log + the current offer. The price and what a pass grants
// are Worker vars (CHAT_WEEK_PASS_COINS, CHAT_WEEK_PASS_EXTRA_SLOTS — see backend/SETUP.md), not editable here.
// NOTE: plain JS in a string — no backticks or "${" inside. All text is set with textContent (ctx.h).
export const CHAT_PASS_ADMIN_SCRIPT = `
(function(){
if (!window.registerAdminTab) return;
function when(s){ if (!s) return '—'; var d = new Date(s); return d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
function num(n){ return Number(n || 0).toLocaleString(); }
window.registerAdminTab('Chat passes', function(box, ctx){
  var h = ctx.h, api = ctx.api;
  box.appendChild(h('h2', { class: 'serif', text: 'Chat passes' }));
  box.appendChild(h('p', { class: 'sub', text: 'Free users who reach the new-chat limit can spend coins on a 7-day pass with extra new chats. Admins and subscribers never need one. Existing chats always stay open; only new chats are limited.' }));
  var head = h('div'); var list = h('div'); var more = h('div');
  box.appendChild(head); box.appendChild(list); box.appendChild(more);
  var before = null;
  function stat(label, n){ return h('div', { class: 'card', style: 'flex:1;min-width:140px' }, [h('div', { class: 'meta', text: label }), h('b', { style: 'font-size:22px', text: n })]); }
  async function load(){
    var d;
    try { d = await api('GET', '/admin/api/chat-passes' + (before ? '?before=' + before : '')); }
    catch (e) { list.appendChild(h('div', { class: 'card empty', text: e.message })); return; }
    if (!before) {
      head.innerHTML = '';
      var o = d.offer;
      head.appendChild(h('div', { class: 'card', style: 'margin-bottom:12px' }, [
        h('b', { text: 'Current offer: ' + num(o.coins) + ' coins = ' + (o.unlimited ? 'unlimited new chats' : '+' + o.extraSlots + ' new chats') + ' for ' + o.days + ' days' }),
        h('div', { class: 'meta', style: 'margin-top:4px', text: 'Change it with the Worker vars CHAT_WEEK_PASS_COINS and CHAT_WEEK_PASS_EXTRA_SLOTS (a number, or "unlimited"), then redeploy. No app release needed.' }),
      ]));
      head.appendChild(h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap;margin-bottom:12px' }, [
        stat('Passes sold', num(d.totals.purchases)), stat('Last 7 days', num(d.totals.purchases7d)),
        stat('Active now', num(d.totals.activePasses)), stat('Coins spent', num(d.totals.coinsSpent)),
      ]));
    }
    if (!d.items.length && !before) { list.appendChild(h('div', { class: 'card empty', text: 'No chat passes bought yet.' })); }
    d.items.forEach(function(p){
      list.appendChild(h('div', { class: 'card row', style: 'margin-bottom:8px;gap:12px' }, [
        h('div', { class: 'grow' }, [
          h('b', { text: p.user.displayName || 'Unknown' }),
          h('div', { class: 'meta', text: (p.user.handle ? '@' + p.user.handle + ' · ' : '') + 'bought ' + when(p.createdAt) + (p.extended ? ' · extended an active pass' : '') }),
        ]),
        h('div', { class: 'meta', style: 'text-align:right' }, [
          h('div', { text: '-' + num(p.coins) + ' coins · ' + (p.extraSlots == null ? 'unlimited' : '+' + p.extraSlots + ' chats') }),
          h('div', { text: 'until ' + when(p.expiresAt) }),
        ]),
      ]));
    });
    more.innerHTML = '';
    if (d.items.length === 50) {
      before = d.items[d.items.length - 1].id;
      more.appendChild(h('div', { style: 'text-align:center;margin:10px 0' }, [h('button', { class: 'btn ghost', text: 'Load more', onclick: load })]));
    }
  }
  load();
});
})();
`;
