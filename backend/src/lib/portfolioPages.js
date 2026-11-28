// PORTFOLIO & PARTNER MANAGERS: public HTML pages in BibleNestra's Figma style (ivory page, ink text, orange accent,
// Playfair Display headings, DM Sans body). Plain server-rendered HTML, no scripts.
//   partnerLandingPage  GET /p/:code                    a Partner Manager's personal promotional page
//   recruitmentPage     GET /portfolio/invite/:code     and GET /partner/invite/:code (recruitment page)
//   notFoundPage        an invalid or closed link
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const PLAY = 'https://play.google.com/store/apps/details?id=com.biblenestra.app';
const pct = (n) => (Number.isInteger(n) ? String(n) : String(Number(n).toFixed(2)).replace(/\.?0+$/, ''));

function shell(title, desc, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
<style>
:root{--ivory:#F8F1E7;--paper:#FFFAF2;--ink:#281A11;--muted:#7C6C60;--line:#EADFCE;--plum:#FF6B1A;--plumDark:#5A2E18;--gold:#F4D88C;--goldDark:#6F4A12;--sage:#E7EAD7}
*{box-sizing:border-box}
body{margin:0;background:var(--ivory);color:var(--ink);font:16px/1.55 "DM Sans",system-ui,-apple-system,Segoe UI,Roboto,sans-serif;min-height:100vh}
main{max-width:520px;margin:0 auto;padding:28px 16px 48px}
.brand{font-size:12px;letter-spacing:2px;text-transform:uppercase;color:var(--plum);font-weight:700}
h1{font-family:"Playfair Display",Georgia,serif;font-size:30px;line-height:1.15;margin:10px 0 8px;color:var(--ink)}
h2{font-family:"Playfair Display",Georgia,serif;font-size:20px;margin:26px 0 8px}
p{color:var(--muted);margin:8px 0}
.card{background:var(--paper);border:1px solid var(--line);border-radius:22px;padding:20px 18px;margin-top:16px}
.hero{background:linear-gradient(135deg,#FFF2E5 0%,var(--gold) 100%);border-radius:26px;padding:24px 20px}
.hero p{color:var(--plumDark)}
ul{padding-left:20px;margin:8px 0;color:var(--ink)}
li{margin:6px 0}
.stat{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}
.stat:last-child{border-bottom:0}
.stat b{font-family:"Playfair Display",Georgia,serif;font-size:22px;color:var(--goldDark)}
.code{display:inline-block;letter-spacing:3px;font-weight:700;font-size:18px;padding:8px 14px;border-radius:999px;border:1.5px dashed var(--plum);color:var(--plumDark);background:var(--paper)}
.btn{display:block;text-align:center;padding:15px;border-radius:999px;background:var(--plum);color:#fff;text-decoration:none;font-weight:700;margin-top:12px}
.btn.ghost{background:transparent;color:var(--plumDark);border:1.5px solid var(--plum)}
small{display:block;color:var(--muted);margin-top:14px;font-size:13px}
</style></head><body><main>${body}</main></body></html>`;
}

export function notFoundPage(message) {
  return shell('BibleNestra', message, `<div class="brand">BibleNestra</div><h1>Link not available</h1><p>${esc(message)}</p>
<a class="btn" href="/">Go to BibleNestra</a>`);
}

function commissionCard(cfg, kind) {
  const partner = pct(cfg.partnerBps / 100);
  const pmShare = pct(cfg.pmBps / 100);
  if (kind === 'partner_manager') {
    return `<div class="card"><h2>How you are paid</h2>
<ul><li>Earn <b>${partner}%</b> of the eligible payments made by people you bring into BibleNestra (coins, Plus, Find Love plans, memberships and Fund Me fees). Donations are not included.</li>
<li>Commissions are held for ${cfg.holdDays} days, then you can withdraw them once your identity check is approved.</li>
<li>Your Portfolio Manager earns ${pmShare}% of your commission. You never pay for anything.</li></ul></div>`;
  }
  return `<div class="card"><h2>How you are paid</h2>
<ul><li>Earn <b>${pmShare}%</b> of the commissions earned by the Partner Managers you recruit (the ${partner}% partner commission on their referred members' eligible payments).</li>
<li>Commissions are held for ${cfg.holdDays} days, then withdrawable after your identity check is approved.</li>
<li>A dashboard to see every Partner Manager, their referrals and their earnings.</li></ul></div>`;
}

// Personal landing page (/partner/:username and /p/:code). Everything the partner controls comes from the Settings profile
// and the admin landing template; the membership plans come live from the 'creator_plans' config (or a names-only fallback).
export function partnerLandingPage({ name, intro, photoUrl, code, handle, origin, cfg, template, plans, playUrl, landingUrl, bannerUrl, shares }) {
  const first = String(name || 'A BibleNestra partner').split(' ')[0];
  const join = `${origin}/i/${code}`;
  const t = template || { headline: 'invites you to BibleNestra', benefits: [], accent: 'orange' };
  const accent = { orange: '#FF6B1A', gold: '#F4D88C', sage: '#E7EAD7' }[t.accent] || '#FF6B1A';
  const title = `${first} ${t.headline}`.trim();
  const planList = plans && plans.plans && plans.plans.length ? plans.plans : [];
  const planCard = planList.length
    ? `<div class="card"><h2>Membership plans</h2><ul>${planList.map((p) => `<li><b>${esc(p.name)}</b>${p.priceLabel ? ` · ${esc(p.priceLabel)}` : ''}${p.feeLabel ? ` · ${esc(p.feeLabel)}` : ''}</li>`).join('')}</ul>
<small>Create a membership for your community. Free creators can upgrade at any time.</small></div>`
    : '';
  const benefits = (t.benefits || []).map((b) => `<li>${esc(b)}</li>`).join('');
  const sh = shares || {};
  const shareRow = [['WhatsApp', sh.whatsapp], ['Facebook', sh.facebook], ['Telegram', sh.telegram], ['Email', sh.email]]
    .filter(([, u]) => u).map(([label, u]) => `<a class="btn ghost" href="${esc(u)}">${esc(label)}</a>`).join('');
  return shell(title, 'Read the Bible, pray and chat with believers. Join BibleNestra with my invitation.', `
<div class="brand">BibleNestra</div>
<div class="hero" style="margin-top:14px;background:linear-gradient(135deg,#FFF2E5 0%,${accent} 100%)">
${photoUrl ? `<img src="${esc(photoUrl)}" alt="" style="width:72px;height:72px;border-radius:50%;object-fit:cover;margin-bottom:10px">` : ''}
<h1>${esc(first)} ${esc(t.headline)}</h1>
<p>${esc(intro || 'Read the Bible together, pray with believers, study with trusted tools and find a Christian community near you.')}</p></div>
<div class="card" style="text-align:center"><p style="margin:0 0 10px">Your invitation code</p><span class="code">${esc(code)}</span>
<a class="btn" href="${esc(join)}">Sign up with ${esc(first)}'s code</a>
${playUrl ? `<a class="btn ghost" href="${esc(playUrl)}">Get the app</a>` : ''}
<small>After you install the app, enter the code <b>${esc(code)}</b> under Chats › Invite friends › “Have an invite code?”. Every sign-up through this page is linked to ${esc(first)}.</small></div>
<h2>What you will find</h2>
<div class="card"><ul>${benefits || '<li>The Bible in many translations, with study tools</li><li>Prayer wall and daily Bible readings</li>'}</ul></div>
<h2>Create a membership</h2>
<div class="card"><p>Start a group for your church, Bible study or prayer circle. Members join and learn together.</p></div>
${planCard}
<h2>Partner with BibleNestra</h2>
<div class="card"><p>Share BibleNestra with people you know and earn commissions on their eligible payments. Ask ${esc(first)} how to become a Partner Manager.</p></div>
<h2>Share</h2>
<div class="card" style="text-align:center">${shareRow || ''}<a class="btn ghost" href="${esc(landingUrl || '')}">Open this page</a>
${bannerUrl ? `<small><a href="${esc(bannerUrl)}">Download a promotion banner</a></small>` : ''}</div>
<small style="text-align:center">Promoted by ${esc(first)}${handle ? ` (@${esc(handle)})` : ''}. BibleNestra is a Christian app.</small>`);
}

export function recruitmentPage({ kind, info, cfg, origin, playUrl }) {
  const isPM = kind === 'portfolio_manager';
  const role = isPM ? 'Portfolio Manager' : 'Partner Manager';
  const path = isPM ? 'portfolio' : 'partner';
  const deep = `biblenestra://${path}/invite/${info.code}`;
  const closed = !info.open;
  const inviter = info.inviterName ? `<p>Invited by <b>${esc(info.inviterName)}</b>.</p>` : '';
  const duties = isPM
    ? `<li>Recruit Partner Managers with your own invitation links, WhatsApp and email shares.</li><li>Approve or decline the Partner Managers who apply to you (with Super Admin oversight).</li><li>Follow every Partner Manager's performance on your dashboard.</li>`
    : `<li>Share your personal promotional page with friends, family and your church community.</li><li>Follow your referred members and your commissions on your dashboard.</li><li>Withdraw your commissions once your identity check is approved.</li>`;
  return shell(`Become a ${role} at BibleNestra`, `Join BibleNestra as a ${role}.`, `
<div class="brand">BibleNestra · ${esc(role)} invitation</div>
<div class="hero" style="margin-top:14px"><h1>Become a ${esc(role)}</h1>
<p>Share BibleNestra with people who love the Bible, and earn transparent commissions from the eligible activity of the people you bring in.</p>${inviter}</div>
${closed ? `<div class="card"><h2>This invitation is closed</h2><p>It has expired, reached its limit, or was withdrawn. Ask the person who invited you for a new one.</p></div>` : `
<div class="card"><h2>Your opportunity</h2><ul>${duties}</ul></div>
${commissionCard(cfg, kind)}
<div class="card"><h2>Apply</h2><p>Open this invitation in the BibleNestra app, fill in the short application and wait for approval. ${isPM ? 'The Super Admin reviews Portfolio Manager applications.' : 'Your Portfolio Manager reviews your application.'}</p>
<a class="btn" href="${esc(deep)}">Open in the app</a>
${playUrl ? `<a class="btn ghost" href="${esc(playUrl)}">Get BibleNestra</a>` : ''}
<small>Invitation code: <b>${esc(info.code)}</b>. Creating an account needs your name, a phone number and an ID check before any withdrawal.</small></div>`}
<small style="text-align:center">Commission figures are the current settings.</small>`);
}

export { PLAY };
