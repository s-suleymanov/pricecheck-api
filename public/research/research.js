// public/research/research.js
(function(){
  const $  = (s, ctx=document)=>ctx.querySelector(s);
  const $$ = (s, ctx=document)=>Array.from(ctx.querySelectorAll(s));

  // Positive = green, negative = yellow
  function fmtPct(v) {
    const n = Number(v);
    if (!isFinite(n)) return 'NA';
    const sign = n > 0 ? '+' : (n < 0 ? '' : '');
    return sign + n.toFixed(1) + '%';
  }

  function classForPct(pct, mode) {
    const n = Number(pct);
    if (!isFinite(n) || n === 0) return '';
    if (mode === 'tape') {
      return n > 0 ? 'gain' : 'lose';
    }
    // default: ok = green, warn = yellow
    return n > 0 ? 'ok' : 'warn';
  }

  // ---- Tape (categories) ----
  async function hydrateTape(){
    const rail = $('.tape');
    if (!rail) return;
    try{
      const r = await fetch('/api/research/tape').then(x=>x.json());
      const items = (r.items || []).slice(0,12).map(t => {
        const pct = Number(t.change_pct);
        const cls = classForPct(pct, 'tape');
        const val = fmtPct(pct);
        return `<div class="ticker"><strong>${String(t.symbol||'').toUpperCase()}</strong> <span class="${cls}">${val}</span></div>`;
      }).join('');
      if (items) rail.innerHTML = items;
    }catch(e){
      console.error('hydrateTape error', e);
    }
  }

  // ---- Indices card ----
  async function hydrateIndices(){
    try {
      const r = await fetch('/api/research/indices').then(x=>x.json());

      const pc100El   = $('#pc100Val');
      const elecEl    = $('#electronicsVal');
      const honestyEl = $('#dealHonestyVal');
      const lowestEl  = $('#lowestNotAmazonVal');

      if (pc100El) {
        const pct = Number(r.pc100_change_pct);
        pc100El.textContent = fmtPct(pct);
        pc100El.classList.remove('gain','lose','ok','warn');
        const cls = classForPct(pct, 'tape');
        if (cls) pc100El.classList.add(cls);
      }

      if (elecEl) {
        const pct = Number(r.electronics_change_pct);
        elecEl.textContent = fmtPct(pct);
        elecEl.classList.remove('gain','lose','ok','warn');
        const cls = classForPct(pct, 'tape');
        if (cls) elecEl.classList.add(cls);
      }

      if (honestyEl && r.deal_honesty_pct != null) {
        const v = Number(r.deal_honesty_pct);
        honestyEl.textContent = isFinite(v) ? v.toFixed(0) + '%' : 'NA';
      }

      if (lowestEl && r.lowest_not_amazon_pct != null) {
        const v = Number(r.lowest_not_amazon_pct);
        lowestEl.textContent = isFinite(v) ? v.toFixed(0) + '%' : 'NA';
      }
    } catch(e) {
      console.error('hydrateIndices error', e);
    }
  }

  // ---- Gainers / Losers ----
  async function hydrateGainers(){
    const body = $('#gainers-body');
    if (!body) return;
    try{
      const r = await fetch('/api/research/gainers').then(x=>x.json());
      const rows = (r.items||[]).map(x => {
        const pct = Number(x.change_pct);
        const cls = classForPct(pct);
        return `
        <tr>
          <td>${escapeHtml(x.title || 'Unknown')}</td>
          <td>${escapeHtml(x.category || 'Uncategorized')}</td>
          <td class="${cls}">${fmtPct(pct)}</td>
          <td>${storePretty(x.store)}</td>
        </tr>`;
      }).join('');
      if (rows) body.innerHTML = rows;
    }catch(e){
      console.error('hydrateGainers error', e);
    }
  }

  async function hydrateLosers(){
    const body = $('#losers-body');
    if (!body) return;
    try{
      const r = await fetch('/api/research/losers').then(x=>x.json());
      const rows = (r.items||[]).map(x => {
        const pct = Number(x.change_pct);
        const cls = classForPct(pct);
        return `
        <tr>
          <td>${escapeHtml(x.title || 'Unknown')}</td>
          <td>${escapeHtml(x.category || 'Uncategorized')}</td>
          <td class="${cls}">${fmtPct(pct)}</td>
          <td>${storePretty(x.store)}</td>
        </tr>`;
      }).join('');
      if (rows) body.innerHTML = rows;
    }catch(e){
      console.error('hydrateLosers error', e);
    }
  }

  // ---- Heatmap ----
  async function hydrateHeatmap(){
    const box = $('.heat');
    if (!box) return;
    try{
      const r = await fetch('/api/research/heatmap').then(x=>x.json());
      const items = (r.items||[]);
      if (!items.length) return;
      const cells = items.map(x=>{
        const pct = Number(x.change_pct);
        const spanCls = classForPct(pct);
        const cellCls = pct > 0 ? 'hot' : (pct < 0 ? 'cold' : '');
        return `<div class="cell ${cellCls}">${escapeHtml(x.category)}<br><span class="${spanCls}">${fmtPct(pct)}</span></div>`;
      }).join('');
      box.innerHTML = cells;
    }catch(e){
      console.error('hydrateHeatmap error', e);
    }
  }

  // ---- Cheapest share leaderboard (sample backend) ----
  async function hydrateShare(){
    const body = $('#share-body tbody') || $('#share-body');
    if (!body) return;
    try{
      const r = await fetch('/api/research/share').then(x=>x.json());
      const rows = (r.items||[]).map(x=>{
        const lowest   = x.lowest    ? `${x.lowest.store}` : 'NA';
        const lowPct   = x.lowest    ? ` ${x.lowest.share_pct}%` : '';
        const runner   = x.runner_up ? `${x.runner_up.store} ${x.runner_up.share_pct}%` : '—';
        return `<tr>
          <td>${escapeHtml(x.category)}</td>
          <td>${escapeHtml(lowest)}</td>
          <td>${lowPct}</td>
          <td>${escapeHtml(runner)}</td>
        </tr>`;
      }).join('');
      if (rows) body.innerHTML = rows;
    }catch(e){
      console.error('hydrateShare error', e);
    }
  }

  // ---- Open in Dashboard (auto redirect with key) ----
  function keyFromInput(text){
    if(!text) return null;
    const s = String(text).trim();
    const am = s.match(/amazon\.com\/.+\/dp\/(\w{10})/i); if (am) return `asin:${am[1]}`;
    const tg = s.match(/target\.com\/.+\/(?:-|A-)?(\d{8})/i); if (tg) return `tcin:${tg[1]}`;
    const bb = s.match(/bestbuy\.com\/.+\/(\d{6,8})/i); if (bb) return `bby:${bb[1]}`;
    const wm = s.match(/walmart\.com\/.+\/(\d{6,12})/i); if (wm) return `wal:${wm[1]}`;
    if (/^\d{12}$/.test(s)) return `upc:${s}`;
    if (/^\w{10}$/.test(s))  return `asin:${s}`;
    return s;
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
    return String(s||'').replace(/[&<>"']/g, c=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  // boot
  document.addEventListener('DOMContentLoaded', ()=>{
    hydrateTape();
    hydrateIndices();
    hydrateGainers();
    hydrateLosers();
    hydrateHeatmap();
    hydrateShare();
  });
})();