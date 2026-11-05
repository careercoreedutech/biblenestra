// Server-rendered HTML for Fund Me: the public fundraiser landing page (/f/:slug), the TEST checkout page
// (/pay/test/:ref) and a small message page. Self-contained (inline CSS + one nonce'd script), mobile-first,
// BibleNestra "Sanctuary Paper" look. ALL user content goes through esc() — never inject user HTML.
import { formatMoney, CURRENCY_SYMBOL } from './money.js';

export function esc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// Text with line breaks preserved (escaped first)
const escLines = (v) => esc(v).replace(/\r?\n/g, '<br>');
// JSON for a <script type="application/json"> block (can't break out of the tag)
const safeJson = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

function ago(isoStr) {
  if (!isoStr) return '';
  const s = Math.max(0, (Date.now() - new Date(isoStr).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return new Date(isoStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';

const FONT_LINK = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
  + '<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&display=swap" rel="stylesheet">';

const BASE_CSS = `
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:#F6F2EA;color:#1C1915;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
a{color:#2E3A87}
.serif{font-family:Newsreader,Georgia,serif}
.wrap{max-width:600px;margin:0 auto;padding:0 18px 56px}
.top{display:flex;align-items:center;justify-content:space-between;padding:14px 0}
.brand{display:flex;align-items:center;gap:8px;font-family:Newsreader,Georgia,serif;font-weight:600;font-size:18px;letter-spacing:-.2px;color:#1C1915;text-decoration:none}
.brand i{display:inline-flex;width:28px;height:28px;border-radius:9px;background:#2E3A87;color:#fff;align-items:center;justify-content:center;font-style:normal;font-size:14px}
.eyebrow{font-size:10.5px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#A87A27}
.card{background:#fff;border:1px solid #E7DFD1;border-radius:18px;box-shadow:0 1px 2px rgba(59,47,30,.06),0 1px 1px rgba(59,47,30,.04)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:0;border-radius:999px;padding:14px 22px;font-weight:700;font-size:15px;line-height:1;font-family:inherit;cursor:pointer;text-decoration:none}
.btn-primary{background:#2E3A87;color:#fff}.btn-primary:hover{background:#232C6B}
.btn-ghost{background:#fff;color:#1C1915;border:1px solid #E7DFD1}
.btn[disabled]{opacity:.45;cursor:default}
.banner{border-radius:14px;padding:12px 14px;margin:6px 0 14px;font-size:14px;border-left:3px solid}
.b-test{background:rgba(168,122,39,.10);border-color:#A87A27}
.b-ok{background:rgba(62,123,87,.12);border-color:#3E7B57}
.b-bad{background:rgba(184,58,58,.10);border-color:#B83A3A}
.b-info{background:#E7E9F5;border-color:#2E3A87}
`;

function page({ title, head = '', bodyHtml, nonce, script = '' }) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#F6F2EA">
<title>${esc(title)}</title>${head}${FONT_LINK}<style>${BASE_CSS}${PAGE_CSS}</style></head>
<body>${bodyHtml}${script ? `<script nonce="${esc(nonce)}">${script}</script>` : ''}</body></html>`;
}

const PAGE_CSS = `
.hero{width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:20px;display:block;background:#F0EBE1;cursor:zoom-in}
h1{font-family:Newsreader,Georgia,serif;font-weight:600;font-size:30px;line-height:1.15;letter-spacing:-.6px;margin:8px 0 6px}
.org{color:#6B6255;font-size:13.5px;display:flex;align-items:center;gap:8px;margin-bottom:16px}
.av{width:30px;height:30px;border-radius:50%;background:#F5EBD7;color:#8C6620;display:inline-flex;align-items:center;justify-content:center;font:600 12px Newsreader,Georgia,serif;flex:none;object-fit:cover}
.prog{padding:18px}
.raised{font-family:Newsreader,Georgia,serif;font-weight:600;font-size:30px;letter-spacing:-.6px;line-height:1.1}
.of{color:#6B6255;font-size:14px;margin-top:2px}
.bar{height:10px;border-radius:99px;background:#F0EBE1;overflow:hidden;margin:14px 0 10px}
.bar>span{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#2E3A87,#3F4BA8);transition:width .9s cubic-bezier(.2,.8,.2,1)}
.stats{display:flex;justify-content:space-between;gap:8px;font-size:13px;color:#6B6255}
.stats b{color:#1C1915;font-weight:700}
.actions{display:flex;gap:10px;margin-top:16px}.actions .btn{flex:1}
h2{font-family:Newsreader,Georgia,serif;font-weight:600;font-size:21px;letter-spacing:-.3px;margin:28px 0 10px}
.story p{margin:0 0 14px;font-family:Newsreader,Georgia,serif;font-size:18px;line-height:1.6;color:#2A251E}
.story figure{margin:6px 0 18px}.story figure img{width:100%;border-radius:14px;display:block;cursor:zoom-in;background:#F0EBE1}
figcaption{font-size:12.5px;color:#A1978A;margin-top:6px;text-align:center}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.grid button{padding:0;border:0;background:#F0EBE1;border-radius:12px;overflow:hidden;aspect-ratio:1;cursor:zoom-in}
.grid img{width:100%;height:100%;object-fit:cover;display:block}
.doc{display:flex;align-items:center;gap:12px;padding:12px 14px;margin-bottom:8px;text-decoration:none;color:#1C1915}
.doc .ic{width:38px;height:38px;border-radius:10px;background:rgba(184,58,58,.10);color:#B83A3A;font-weight:800;font-size:10px;line-height:38px;text-align:center;flex:none}
.doc .t{font-weight:600;font-size:14px}.doc .s{font-size:12px;color:#6B6255}
.donate{padding:18px;margin-top:10px}
.presets{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0}
.presets input{position:absolute;opacity:0;pointer-events:none}
.presets label{display:flex;align-items:center;justify-content:center;height:46px;border-radius:12px;border:1px solid #E7DFD1;background:#F6F2EA;font-weight:700;cursor:pointer}
.presets input:checked+label{background:#1C1915;color:#fff;border-color:#1C1915}
.presets input:focus-visible+label{outline:2px solid #2E3A87;outline-offset:2px}
.field{display:block;margin-top:10px}
.field span{display:block;font-size:12px;font-weight:700;color:#6B6255;margin-bottom:5px}
.money{position:relative}.money em{position:absolute;left:14px;top:50%;transform:translateY(-50%);font-style:normal;color:#6B6255;font-weight:700}
input[type=text],input[type=number],textarea{width:100%;border:1px solid #E7DFD1;background:#F6F2EA;border-radius:12px;padding:12px 14px;font-size:15px;font-family:inherit;color:#1C1915}
.money input{padding-left:32px}
textarea{min-height:84px;resize:vertical}
input:focus,textarea:focus{outline:none;border-color:#2E3A87;background:#fff}
.toggle{display:flex;align-items:center;gap:12px;margin:14px 0 4px;cursor:pointer;user-select:none}
.toggle input{appearance:none;-webkit-appearance:none;width:44px;height:26px;border-radius:99px;background:#D6CBB8;position:relative;flex:none;cursor:pointer;transition:background .2s;margin:0}
.toggle input::after{content:"";position:absolute;width:20px;height:20px;border-radius:50%;background:#fff;top:3px;left:3px;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.2)}
.toggle input:checked{background:#2E3A87}.toggle input:checked::after{left:21px}
.toggle small{display:block;color:#6B6255;font-size:12px}
.err{color:#B83A3A;font-size:13px;min-height:18px;margin-top:8px}
.closed{padding:18px;text-align:center}
.closed .serif{font-size:20px;font-weight:600}
.donor{display:flex;gap:12px;padding:14px 0;border-bottom:1px solid #EFE9DE}
.donor:last-child{border-bottom:0}
.donor .n{font-weight:700;font-size:14px}.donor .m{font-size:12.5px;color:#6B6255}
.donor q{display:block;margin-top:6px;font-family:Newsreader,Georgia,serif;font-style:italic;font-size:16px;color:#2A251E;quotes:"\\201C" "\\201D"}
.list{padding:2px 16px}
.share{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.share a,.share button{flex:1;min-width:120px;font-size:13.5px;padding:12px 14px}
.foot{text-align:center;color:#A1978A;font-size:12px;margin-top:36px}
.lb{position:fixed;inset:0;background:rgba(21,23,43,.92);display:none;align-items:center;justify-content:center;z-index:9;padding:20px;cursor:zoom-out}
.lb.on{display:flex}.lb img{max-width:100%;max-height:100%;border-radius:12px}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(20px);background:#15172B;color:#F4EFE6;padding:10px 16px;border-radius:99px;font-size:13.5px;opacity:0;transition:.25s;pointer-events:none}
.toast.on{opacity:1;transform:translateX(-50%) translateY(0)}
@media (min-width:640px){h1{font-size:36px}.wrap{padding-top:10px}}
`;

export function renderFundraiserPage(f, { nonce, result, pageUrl }) {
  const money = (m) => formatMoney(m, f.currency);
  const pct = Math.min(100, f.percent);
  const images = f.media.filter((m) => m.kind === 'image');
  const docs = f.media.filter((m) => m.kind === 'pdf');
  const desc = f.excerpt || `Help ${f.owner.displayName} raise ${money(f.goalMinor)}.`;
  const shareText = `${f.title} — ${pageUrl}`;
  const head = [
    `<meta name="description" content="${esc(desc)}">`,
    `<link rel="canonical" href="${esc(pageUrl)}">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="BibleNestra">',
    `<meta property="og:title" content="${esc(f.title)}">`,
    `<meta property="og:description" content="${esc(`${money(f.raisedMinor)} raised of ${money(f.goalMinor)} · ${desc}`)}">`,
    `<meta property="og:url" content="${esc(pageUrl)}">`,
    f.mainImageUrl ? `<meta property="og:image" content="${esc(f.mainImageUrl)}">` : '',
    `<meta name="twitter:card" content="${f.mainImageUrl ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${esc(f.title)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`,
    f.mainImageUrl ? `<meta name="twitter:image" content="${esc(f.mainImageUrl)}">` : '',
  ].join('');

  const banners = [];
  if (f.testMode) banners.push('<div class="banner b-test"><b>Test mode.</b> Payments are simulated — no real money moves.</div>');
  if (result === 'succeeded') banners.push('<div class="banner b-ok"><b>Thank you!</b> Your donation was received. God bless you for your generosity.</div>');
  if (result === 'failed') banners.push('<div class="banner b-bad"><b>The payment didn’t go through.</b> You haven’t been charged — please try again.</div>');
  if (result === 'cancelled') banners.push('<div class="banner b-info">Payment cancelled — you haven’t been charged.</div>');
  if (f.status === 'paused') banners.push('<div class="banner b-info">The organiser has paused donations for now.</div>');
  if (f.status === 'closed') banners.push('<div class="banner b-info">This fundraiser has ended and is no longer taking donations. Thank you to everyone who gave.</div>');

  const story = f.story.map((b) => (b.type === 'p'
    ? `<p>${escLines(b.text)}</p>`
    : `<figure><img src="${esc(b.url)}" alt="${esc(b.caption || 'Story photo')}" loading="lazy" data-lb>${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}</figure>`)).join('');

  const gallery = images.length ? `<h2>Photos</h2><div class="grid">${images.map((m) => `<button type="button" aria-label="${esc(m.caption || 'Open photo')}"><img src="${esc(m.url)}" alt="${esc(m.caption || 'Supporting photo')}" loading="lazy" data-lb></button>`).join('')}</div>` : '';
  const documents = docs.length ? `<h2>Documents</h2>${docs.map((m) => `<a class="doc card" href="${esc(m.url)}" target="_blank" rel="noopener"><span class="ic">PDF</span><span><span class="t">${esc(m.caption || m.name || 'Document')}</span><br><span class="s">${esc(m.caption && m.name ? m.name : 'Tap to open')}</span></span></a>`).join('')}` : '';

  const sym = CURRENCY_SYMBOL[f.currency] || '';
  let donate;
  if (f.donationsOpen) {
    donate = `<form id="donate" class="donate card" method="post" action="/f/${esc(f.slug)}/donations" novalidate>
      <div class="eyebrow">Give</div>
      <div class="serif" style="font-size:22px;font-weight:600;letter-spacing:-.3px">Make a donation</div>
      <div class="presets">${f.presets.map((p, i) => `<span><input type="radio" name="amount_minor" id="p${i}" value="${p}"${i === 1 ? ' checked' : ''}><label for="p${i}">${esc(money(p))}</label></span>`).join('')}</div>
      <label class="field"><span>Or enter an amount</span><span class="money"><em>${esc(sym)}</em><input type="number" name="amount_custom" id="custom" inputmode="decimal" min="${f.minMinor / 100}" max="${f.maxMinor / 100}" step="0.01" placeholder="Other amount"></span></label>
      <label class="field"><span>Your name</span><input type="text" name="donor_name" id="name" maxlength="80" autocomplete="name" placeholder="Name shown with your gift"></label>
      <label class="field"><span>Message (optional)</span><textarea name="message" id="msg" maxlength="500" placeholder="Words of encouragement…"></textarea></label>
      <label class="toggle"><input type="checkbox" name="anonymous" id="anon"><span>Give anonymously<small>Your name is hidden on this page (the organiser can still see it). Your gift still counts.</small></span></label>
      <div class="err" id="err" role="alert"></div>
      <button class="btn btn-primary" id="give" type="submit" style="width:100%">Donate</button>
    </form>`;
  } else if (f.status === 'live' && !f.paymentsReady) {
    donate = '<div id="donate" class="closed card"><div class="eyebrow">Give</div><div class="serif">Donations open soon</div><p style="color:#6B6255;margin:6px 0 0">Online giving is being set up. Please check back shortly — and share this page in the meantime.</p></div>';
  } else {
    donate = `<div id="donate" class="closed card"><div class="serif">${f.status === 'closed' ? 'This fundraiser has ended' : 'Donations are paused'}</div></div>`;
  }

  const donors = f.donations.length
    ? `<h2>Words of support <span style="color:#A1978A;font-weight:500;font-size:14px">· ${f.donorsCount}</span></h2><div class="card list">${f.donations.map((d) => `<div class="donor"><span class="av">${d.anonymous ? '✦' : esc(initials(d.name))}</span><div style="flex:1;min-width:0"><div class="n">${esc(d.name)}</div><div class="m">${esc(formatMoney(d.amountMinor, d.currency))} · ${esc(ago(d.createdAt))}</div>${d.message ? `<q>${escLines(d.message)}</q>` : ''}</div></div>`).join('')}</div>`
    : '<h2>Words of support</h2><div class="card" style="padding:18px;color:#6B6255">Be the first to give and leave a word of encouragement.</div>';

  const enc = encodeURIComponent;
  const bodyHtml = `<div class="wrap">
  <div class="top"><a class="brand" href="${esc(pageUrl)}"><i>✦</i>BibleNestra</a><span class="eyebrow" style="color:#6B6255">Fund Me</span></div>
  ${banners.join('')}
  ${f.mainImageUrl ? `<img class="hero" src="${esc(f.mainImageUrl)}" alt="${esc(f.title)}" data-lb>` : ''}
  <div style="margin-top:18px" class="eyebrow">Fundraiser</div>
  <h1>${esc(f.title)}</h1>
  <div class="org">${f.owner.avatarUrl ? `<img class="av" src="${esc(f.owner.avatarUrl)}" alt="">` : `<span class="av">${esc(initials(f.owner.displayName))}</span>`}<span>Organised by <b style="color:#1C1915">${esc(f.owner.displayName)}</b></span></div>
  <div class="card prog">
    <div class="raised">${esc(money(f.raisedMinor))}</div>
    <div class="of">raised of ${esc(money(f.goalMinor))} goal</div>
    <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span id="fill" style="width:0%" data-w="${pct}"></span></div>
    <div class="stats"><span><b>${f.percent}%</b> funded</span><span><b>${f.donorsCount}</b> ${f.donorsCount === 1 ? 'donor' : 'donors'}</span><span><b>${esc(money(f.remainingMinor))}</b> to go</span></div>
    <div class="actions">${f.donationsOpen || (f.status === 'live') ? '<a class="btn btn-primary" href="#donate">Donate now</a>' : ''}<button class="btn btn-ghost" type="button" id="shareBtn">Share</button></div>
  </div>
  <h2>Story</h2><div class="story">${story || '<p></p>'}</div>
  ${gallery}${documents}
  <h2>Support this fundraiser</h2>
  ${donate}
  ${donors}
  <h2>Share</h2>
  <div class="share">
    <a class="btn btn-ghost" href="https://wa.me/?text=${esc(enc(shareText))}" target="_blank" rel="noopener">WhatsApp</a>
    <a class="btn btn-ghost" href="https://www.facebook.com/sharer/sharer.php?u=${esc(enc(pageUrl))}" target="_blank" rel="noopener">Facebook</a>
    <a class="btn btn-ghost" href="https://twitter.com/intent/tweet?text=${esc(enc(shareText))}" target="_blank" rel="noopener">X</a>
    <button class="btn btn-ghost" type="button" id="copyBtn">Copy link</button>
  </div>
  <div class="foot">Fundraisers are reviewed by the BibleNestra team before they go live.</div>
</div>
<div class="lb" id="lb" role="dialog" aria-label="Photo"><img id="lbImg" alt=""></div>
<div class="toast" id="toast"></div>
<script type="application/json" id="cfg">${safeJson({ slug: f.slug, url: pageUrl, title: f.title, min: f.minMinor, max: f.maxMinor, sym, money: f.presets.map((p) => [p, money(p)]) })}</script>`;

  const script = `(function(){
var cfg=JSON.parse(document.getElementById('cfg').textContent);
var $=function(id){return document.getElementById(id)};
var fill=$('fill');requestAnimationFrame(function(){setTimeout(function(){fill.style.width=fill.getAttribute('data-w')+'%'},120)});
var t=$('toast'),tt;function toast(m){t.textContent=m;t.classList.add('on');clearTimeout(tt);tt=setTimeout(function(){t.classList.remove('on')},2200)}
function copy(){var u=cfg.url;if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(u).then(function(){toast('Link copied')},function(){prompt('Copy this link',u)})}else{prompt('Copy this link',u)}}
$('copyBtn').addEventListener('click',copy);
$('shareBtn').addEventListener('click',function(){if(navigator.share){navigator.share({title:cfg.title,url:cfg.url}).catch(function(){})}else copy()});
var lb=$('lb'),li=$('lbImg');
document.addEventListener('click',function(e){var el=e.target;if(el&&el.hasAttribute&&el.hasAttribute('data-lb')){li.src=el.currentSrc||el.src;li.alt=el.alt||'';lb.classList.add('on')}});
lb.addEventListener('click',function(){lb.classList.remove('on');li.removeAttribute('src')});
document.addEventListener('keydown',function(e){if(e.key==='Escape')lb.classList.remove('on')});
var form=$('donate');if(!form||form.tagName!=='FORM')return;
var custom=$('custom'),give=$('give'),err=$('err');
function amount(){var c=parseFloat(custom.value);if(c>0)return Math.round(c*100);var r=form.querySelector('input[name=amount_minor]:checked');return r?Number(r.value):0}
function fmt(m){var w=Math.floor(m/100),f=m%100;return cfg.sym+String(w).replace(/\\B(?=(\\d{3})+(?!\\d))/g,',')+(f?'.'+(f<10?'0':'')+f:'')}
function label(){var a=amount();give.textContent=a?'Donate '+fmt(a):'Donate'}
custom.addEventListener('input',function(){if(custom.value){form.querySelectorAll('input[name=amount_minor]').forEach(function(r){r.checked=false})}label()});
form.querySelectorAll('input[name=amount_minor]').forEach(function(r){r.addEventListener('change',function(){custom.value='';label()})});
label();
form.addEventListener('submit',function(e){e.preventDefault();err.textContent='';var a=amount();
if(!a||a<cfg.min){err.textContent='The smallest gift is '+fmt(cfg.min);return}
if(a>cfg.max){err.textContent='The largest single gift is '+fmt(cfg.max);return}
give.disabled=true;give.textContent='Starting secure checkout…';
fetch('/f/'+encodeURIComponent(cfg.slug)+'/donations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount_minor:a,message:$('msg').value,donor_name:$('name').value,anonymous:$('anon').checked})})
.then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})})
.then(function(x){if(x.ok&&x.j.checkoutUrl){location.href=x.j.checkoutUrl}else{throw new Error((x.j&&x.j.error)||'Something went wrong')}})
.catch(function(e2){err.textContent=e2.message||'Something went wrong';give.disabled=false;label()});});
})();`;
  return page({ title: `${f.title} · BibleNestra Fund Me`, head, bodyHtml, nonce, script });
}

export function renderTestCheckout(d, { nonce }) {
  const done = d.status !== 'pending';
  const bodyHtml = `<div class="wrap" style="max-width:460px">
  <div class="top"><span class="brand"><i>✦</i>Test checkout</span><span class="eyebrow">Demo</span></div>
  <div class="banner b-test"><b>TEST MODE — no real money moves.</b> This page stands in for the payment provider until real payments are set up.</div>
  <div class="card" style="padding:20px">
    ${d.mainImageUrl ? `<img src="${esc(d.mainImageUrl)}" alt="" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:14px;display:block;margin-bottom:14px">` : ''}
    <div class="eyebrow">Donation to</div>
    <div class="serif" style="font-size:22px;font-weight:600;letter-spacing:-.3px;line-height:1.2;margin:4px 0 14px">${esc(d.title)}</div>
    <div style="display:flex;justify-content:space-between;padding:12px 0;border-top:1px solid #EFE9DE"><span style="color:#6B6255">Amount</span><b class="serif" style="font-size:22px">${esc(d.amount)}</b></div>
    <div style="display:flex;justify-content:space-between;padding:12px 0;border-top:1px solid #EFE9DE"><span style="color:#6B6255">From</span><span>${d.anonymous ? 'Anonymous' : esc(d.donorName || 'A friend')}</span></div>
    ${done
    ? `<div class="banner ${d.status === 'succeeded' ? 'b-ok' : 'b-bad'}" style="margin-top:12px">This payment has already ${d.status === 'succeeded' ? 'succeeded' : esc(d.status)}.</div><a class="btn btn-primary" style="width:100%;margin-top:8px" href="${esc(d.returnUrl)}">Back to the fundraiser</a>`
    : `<button class="btn btn-primary" id="ok" type="button" style="width:100%;margin-top:14px">Simulate successful payment</button>
       <button class="btn btn-ghost" id="no" type="button" style="width:100%;margin-top:10px">Simulate failure</button>
       <div class="err" id="err" role="alert"></div>`}
  </div>
  <div class="foot">Reference ${esc(d.ref.slice(0, 18))}…</div>
</div>
<script type="application/json" id="cfg">${safeJson({ ref: d.ref, back: d.returnUrl })}</script>`;
  const script = done ? '' : `(function(){var cfg=JSON.parse(document.getElementById('cfg').textContent);
function go(status,btn){btn.disabled=true;btn.textContent=status==='succeeded'?'Processing…':'Declining…';
fetch('/webhooks/fundme/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ref:cfg.ref,status:status})})
.then(function(r){if(!r.ok)throw new Error('Webhook failed');location.href=cfg.back+'?donation='+status})
.catch(function(e){document.getElementById('err').textContent=e.message;btn.disabled=false})}
document.getElementById('ok').addEventListener('click',function(){go('succeeded',this)});
document.getElementById('no').addEventListener('click',function(){go('failed',this)});})();`;
  return page({ title: 'Test checkout · BibleNestra', bodyHtml, nonce, script });
}

export function renderMessagePage({ title, text }) {
  return page({
    title: `${title} · BibleNestra`,
    bodyHtml: `<div class="wrap" style="max-width:460px;padding-top:60px;text-align:center"><div class="brand" style="justify-content:center"><i>✦</i>BibleNestra</div><h1 style="margin-top:24px">${esc(title)}</h1><p style="color:#6B6255">${esc(text)}</p></div>`,
  });
}
