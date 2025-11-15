// public/research/research.js
(function(){
  const $  = (s, ctx=document)=>ctx.querySelector(s);
  const $$ = (s, ctx=document)=>Array.from(ctx.querySelectorAll(s));
  const fmtPct = v => (v > 0 ? '+' : '') + (Number(v).toFixed(1)) + '%';

  // ---- Tape (categories) ----
  async function hydrateTape(){
    const rail = $('.tape'); if(!rail) return;
    try{
      const r = await fetch('/api/research/tape').then(x=>x.json());
      const items = (r.items || []).slice(0,12).map(t => {
        const cls = Number(t.change_pct) < 0 ? 'gain' : 'lose';
        const val = fmtPct(Number(t.change_pct));
        return `<div class="ticker"><strong>${String(t.symbol||'').toUpperCase()}</strong> <span class="${cls}">${val}</span></div>`;
      }).join('');
      if(items) rail.innerHTML = items;
    }catch(e){ console.error(e); }
  }

  // ---- Gainers / Losers ----
  async function hydrateGainers(){
    const body = $('#gainers-body'); if(!body) return;
    try{
      const r = await fetch('/api/research/gainers').then(x=>x.json());
      const rows = (r.items||[]).map(x => `
        <tr>
          <td>${escapeHtml(x.title || 'Unknown')}</td>
          <td>${escapeHtml(x.category || 'Uncategorized')}</td>
          <td class="ok">${fmtPct(Number(x.change_pct))}</td>
          <td>${storePretty(x.store)}</td>
        </tr>`).join('');
      if (rows) body.innerHTML = rows;
    }catch(e){ console.error(e); }
  }

  async function hydrateLosers(){
    const body = $('#losers-body'); if(!body) return;
    try{
      const r = await fetch('/api/research/losers').then(x=>x.json());
      const rows = (r.items||[]).map(x => `
        <tr>
          <td>${escapeHtml(x.title || 'Unknown')}</td>
          <td>${escapeHtml(x.category || 'Uncategorized')}</td>
          <td class="warn">${fmtPct(Number(x.change_pct))}</td>
          <td>${storePretty(x.store)}</td>
        </tr>`).join('');
      if (rows) body.innerHTML = rows;
    }catch(e){ console.error(e); }
  }

  // ---- Heatmap ----
  async function hydrateHeatmap(){
    const box = $('.heat'); if(!box) return;
    try{
      const r = await fetch('/api/research/heatmap').then(x=>x.json());
      const items = (r.items||[]);
      if(!items.length) return;
      const cells = items.map(x=>{
        const pct = Number(x.change_pct);
        const cls = pct < 0 ? 'hot' : (pct > 0 ? 'cold' : '');
        return `<div class="cell ${cls}">${escapeHtml(x.category)}<br><span class="${pct < 0 ? 'ok' : (pct > 0 ? 'warn':'')}">${fmtPct(pct)}</span></div>`;
      }).join('');
      box.innerHTML = cells;
    }catch(e){ console.error(e); }
  }

  // ---- Cheapest share leaderboard ----
  async function hydrateShare(){
    const body = $('#share-body tbody') || $('#share-body'); // support your markup
    if(!body) return;
    try{
      const r = await fetch('/api/research/share').then(x=>x.json());
      const rows = (r.items||[]).map(x=>{
        const lowest = x.lowest ? `${x.lowest.store}` : 'NA';
        const lowPct = x.lowest ? ` ${x.lowest.share_pct}%` : '';
        const runner = x.runner_up ? `${x.runner_up.store} ${x.runner_up.share_pct}%` : '—';
        return `<tr>
          <td>${escapeHtml(x.category)}</td>
          <td>${escapeHtml(lowest)}</td>
          <td>${lowPct}</td>
          <td>${escapeHtml(runner)}</td>
        </tr>`;
      }).join('');
      if(rows) body.innerHTML = rows;
    }catch(e){ console.error(e); }
  }

  // ---- Open in Dashboard (auto redirect with key) ----
  function keyFromInput(text){
    if(!text) return null;
    const s = String(text).trim();
    const am = s.match(/amazon\.com\/.+\/dp\/(\w{10})/i); if(am) return `asin:${am[1]}`;
    const tg = s.match(/target\.com\/.+\/(?:-|A-)?(\d{8})/i); if(tg) return `tcin:${tg[1]}`;
    const bb = s.match(/bestbuy\.com\/.+\/(\d{6,8})/i); if(bb) return `bby:${bb[1]}`;
    const wm = s.match(/walmart\.com\/.+\/(\d{6,12})/i); if(wm) return `wal:${wm[1]}`;
    if(/^\d{12}$/.test(s)) return `upc:${s}`;
    if(/^\w{10}$/.test(s))  return `asin:${s}`;
    return s; // pass through
  }

  function wireSearch(){
    const wrap  = document.querySelector('.search');
    const input = wrap ? wrap.querySelector('input[type="text"]') : null;
    const btn   = wrap ? wrap.querySelector('.btn') : null;
    if(!input || !btn) return;

    function go(){
      const key = keyFromInput(input.value);
      if (!key) { location.href = '/dashboard/'; return; }
      location.href = '/dashboard/?key=' + encodeURIComponent(key);
    }
    btn.addEventListener('click', (e)=>{ e.preventDefault(); go(); });
    input.addEventListener('keydown', (e)=>{ if(e.key === 'Enter'){ e.preventDefault(); go(); } });
  }

  // ---- utils ----
  function storePretty(s){
    s = String(s||'').toLowerCase();
    if (s === 'bestbuy') return 'Best Buy';
    if (s === 'walmart') return 'Walmart';
    if (s === 'target')  return 'Target';
    if (s === 'amazon')  return 'Amazon';
    return s ? s.charAt(0).toUpperCase()+s.slice(1) : '';
  }
  function escapeHtml(s){
    return String(s||'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  // boot
  document.addEventListener('DOMContentLoaded', ()=>{
    hydrateTape();
    hydrateGainers();
    hydrateLosers();
    hydrateHeatmap();
    hydrateShare();
    wireSearch();
  });
})();
