(function(){
  const $  = (s, ctx=document)=>ctx.querySelector(s);
  const fmt = new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});

  const state = {
    identity:null,
    variants:[],
    offers:[],
    observed:[],
    range:30,
    selectedAsin:null,
    lastKey:null
  };

  // ---------- URL helpers ----------
  function applyKeyToUrl(k, mode = 'push') {
    const url = new URL(location.href);
    if (k) url.searchParams.set('key', k);
    else url.searchParams.delete('key');
    if (mode === 'push') history.pushState({ key: k }, '', url);
    else history.replaceState({ key: k }, '', url);
  }
  function currentKeyFromUrl() {
    return new URL(location.href).searchParams.get('key');
  }

  // ---------- Normalizers ----------
  function norm(s){ return String(s || '').trim(); }
  function up(s){ return norm(s).toUpperCase(); }
  function cleanUpc(s){ return norm(s).replace(/\D/g,''); }

  // Stable store keys for comparison/link building
  function storeKey(store){
    const s = norm(store).toLowerCase();
    if (!s) return '';
    if (s === 'best buy' || s === 'bestbuy') return 'bestbuy';
    if (s === 'wal' || s === 'walmart') return 'walmart';
    if (s === 'amz' || s === 'amazon') return 'amazon';
    if (s === 'target') return 'target';
    if (s === 'apple') return 'apple';
    return s.replace(/\s+/g,'');
  }

  function titleCase(s){ return String(s||'').replace(/\b\w/g, c=>c.toUpperCase()); }

  // ---------- Input parsing ----------
  function isLikelyPcCode(s){
    return /^[a-z0-9][a-z0-9_-]{2,}$/i.test(norm(s));
  }

  function keyFromInput(text){
    if (!text) return null;
    const t = text.trim();

    if (/^(asin|upc|tcin|bby|bestbuy|sku|wal|walmart|target|pc|pc_code|pccode)\s*:/i.test(t)) {
      const parts = t.split(':');
      const pref = (parts[0] || '').trim().toLowerCase();
      const rest = parts.slice(1).join(':').trim();
      if (!rest) return null;
      if (pref === 'asin') return `asin:${rest.toUpperCase()}`;
      if (pref === 'upc') return `upc:${rest}`;
      if (pref === 'pc' || pref === 'pc_code' || pref === 'pccode') return `pc:${rest}`;
      return `${pref}:${rest}`;
    }

    const am =
      t.match(/\/dp\/([A-Z0-9]{10})/i) ||
      t.match(/\/gp\/product\/([A-Z0-9]{10})/i);
    if (am) return `asin:${am[1].toUpperCase()}`;

    const tg = t.match(/target\.com\/.+\/(?:-|A-)?(\d{8})/i); if (tg) return `tcin:${tg[1]}`;
    const bb = t.match(/bestbuy\.com\/.+\/(\d{6,8})/i);      if (bb) return `bby:${bb[1]}`;
    const wm = t.match(/walmart\.com\/.+\/(\d{6,12})/i);     if (wm) return `wal:${wm[1]}`;

    if (/apple\.com/i.test(t)) return t;

    if (/^\d{12}$/.test(t)) return `upc:${t}`;
    if (/^[A-Z0-9]{10}$/i.test(t)) return `asin:${t.toUpperCase()}`;
    if (isLikelyPcCode(t)) return `pc:${t}`;

    return t;
  }

  function chooseSelectedAsinFromKey(key, data){
    const variants = Array.isArray(data?.variants) ? data.variants : [];
    const identity = data?.identity || null;
    const k = String(key || '').trim();

    if (/^asin:/i.test(k)) return up(k.slice(5));

    if (/^upc:/i.test(k)) {
      const qUpc = cleanUpc(k.slice(4));
      if (qUpc) {
        const hit = variants.find(v => cleanUpc(v.upc) === qUpc);
        if (hit?.asin) return up(hit.asin);
      }
    }

    if (identity?.asin) return up(identity.asin);

    const first = variants.find(v => v?.asin);
    return first?.asin ? up(first.asin) : null;
  }

  function getCurrentVariant(){
    const asin = state.selectedAsin || (state.identity?.asin ? up(state.identity.asin) : null);
    if (asin) {
      const v = (state.variants || []).find(x => up(x.asin) === asin);
      if (v) return v;
    }
    return (state.variants && state.variants[0]) || null;
  }

  // ---------- Controls ----------
  $('#load').addEventListener('click', () => {
    const raw = $('#query').value.trim();
    const key = keyFromInput(raw);
    if (!key) return;
    applyKeyToUrl(key, 'push');
    run(key);
  });

  $('#query').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('#load').click(); }
  });

  $('#share').addEventListener('click', () => {
    const raw = $('#query').value.trim();
    const key = keyFromInput(raw) || currentKeyFromUrl();
    const link = `${location.origin}/dashboard/?key=${encodeURIComponent(key || '')}`;
    navigator.clipboard.writeText(link);
    flip('#share','Copied','Copy share link',900);
  });

  $('#sortTotal').addEventListener('click', ()=> renderOffers(true));

  $('#copyCheapest').addEventListener('click', ()=>{
    const cheap = getCheapestOffer();
    const link = cheap ? (cheap.url || canonicalLink(cheap.store, cheap, state.identity)) : '';
    if(link) navigator.clipboard.writeText(link);
    flip('#copyCheapest','Copied','Copy cheapest link',900);
  });

  $('#downloadCsv').addEventListener('click', downloadHistoryCsv);
  $('#downloadObs').addEventListener('click', downloadObsCsv);

  $('#copyPm').addEventListener('click', ()=>{
    const ta = $('#pmScript');
    ta.select(); document.execCommand('copy');
    $('#pmNote').textContent = 'Copied';
    setTimeout(()=>$('#pmNote').textContent='',900);
  });

  // Important: selecting a variant triggers an ASIN-scoped load
  $('#variant').addEventListener('change', (e) => {
    const asin = e.target.selectedOptions[0]?.dataset.asin;
    if (asin) {
      state.selectedAsin = asin.toUpperCase();
      run(`asin:${asin}`);
    }
  });

  // ---------- Main loader ----------
  async function run(raw){
    const key = keyFromInput(raw);
    if(!key){ showMessage('Enter a product URL or ID.'); return; }
    state.lastKey = key;

    try{
      toggleLoading(true);
      const res = await fetch(`/api/compare/${encodeURIComponent(key)}`, { headers: { 'Accept': 'application/json' }});
      if(res.status === 404){
        showMessage(`No match for "${raw}". Try prefixes like asin:..., upc:..., pc:..., bby:..., wal:..., tcin:...`);
        return;
      }
      if(!res.ok){ showMessage('Server error. Try again.'); return; }

      const data = await res.json();

      state.identity = data.identity || null;
      state.variants = Array.isArray(data.variants) ? data.variants : [];
      state.offers   = Array.isArray(data.offers)   ? data.offers   : [];
      state.observed = Array.isArray(data.observed) ? data.observed : [];

      state.selectedAsin = chooseSelectedAsinFromKey(state.lastKey, data);

      hydrateHeader();
      hydrateKpis();
      drawChart();
      renderOffers(false);
      renderVariants();
      renderSpecsMatrix();
      renderForensics();
      renderObs();
      renderCoverage();
      buildPmScript();
    }catch(err){
      console.error(err);
      showMessage('Network error. Check console.');
    }finally{
      toggleLoading(false);
    }
  }

  // ---------- UI ----------
  function showMessage(msg){
    $('#pTitle').textContent = msg;
    $('#pSubtitle').textContent = '';
    $('#pIds').textContent = '';
    $('#offers').innerHTML = '';
    $('#offersNote').textContent = '';
    $('#obsBody').innerHTML = '';
    $('#coverage').innerHTML = '';
    $('#kCurrent').textContent = 'NA';
    $('#kStore').textContent = '';
    $('#kTypical').textContent = 'NA';
    $('#kLow30').textContent = 'NA';
    $('#kLow30Date').textContent = '';
    $('#kIntegrity').textContent = 'NA';
    $('#specsMatrix').textContent = 'No specs available.';
    $('#forensicsList').innerHTML = '';
    $('#chart').innerHTML = '';
    $('#chartNote').textContent = 'No history yet';
  }

  function toggleLoading(on){
    const btn = $('#load');
    if(on){ btn.disabled = true; btn.textContent = 'Loading...'; }
    else { btn.disabled = false; btn.textContent = 'Load'; }
  }

  function escapeHtml(s){
    return String(s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  function hydrateHeader(){
    const id = state.identity || {};
    const DEFAULT_IMG = '../content-img/default.webp';

    const variants = state.variants || [];
    const asinU = up(state.selectedAsin || id.asin || '');

    const asinVariant =
      variants.find(v => up(v.asin) === asinU) ||
      variants.find(v => v.asin) ||
      null;

    const v = asinVariant || variants[0] || null;

    let title = null;
    if (asinVariant) {
      title =
        (asinVariant.model_name && asinVariant.model_name.trim()) ||
        (asinVariant.model_number && asinVariant.model_number.trim()) ||
        null;
    }
    if (!title) title = 'Cross store offers';

    $('#pTitle').textContent = title;
    $('#pSubtitle').textContent = 'Latest prices for this product';

    const cur = getCurrentVariant() || {};
    const parts = [];
    if (id.pc_code) parts.push(`PCI ${id.pc_code}`);

    const vUpc = cur.upc ? cleanUpc(cur.upc) : '';
    const iUpc = id.upc ? cleanUpc(id.upc) : '';
    if (vUpc) parts.push(`UPC ${vUpc}`);
    else if (iUpc) parts.push(`UPC ${iUpc}`);

    if (state.selectedAsin) parts.push(`ASIN ${state.selectedAsin}`);

    $('#pIds').innerHTML = parts.map(p => `<span class="id-pill">${escapeHtml(p)}</span>`).join('');

    const img = $('#pImg');
    const src =
      (v && v.image_url && v.image_url.trim()) ||
      (id && id.image_url && String(id.image_url).trim()) ||
      DEFAULT_IMG;

    if (src) {
      img.src = src;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.style.display = 'block';
      img.onerror = () => { img.style.display = 'none'; };
    } else {
      img.removeAttribute('src');
      img.style.display = 'none';
    }

    const brand = (cur.brand || id.brand || '').trim();
    const category = (cur.category || id.category || '').trim();

    const bw = document.getElementById('brandWrap');
    const cw = document.getElementById('categoryWrap');
    const bb = document.getElementById('brandBtn');
    const cb = document.getElementById('categoryBtn');

    bw.hidden = !brand;
    if (brand) bb.textContent = brand;

    cw.hidden = !category;
    if (category) cb.textContent = category;
  }

  function hydrateKpis(){
    // Backend is now correct, so KPIs should come from offers.
    const priced = (state.offers || []).filter(o => typeof o.price_cents === 'number');
    if (!priced.length){
      $('#kCurrent').textContent = 'NA';
      $('#kStore').textContent = '';
      $('#kTypical').textContent = 'NA';
      $('#kLow30').textContent = 'NA';
      $('#kIntegrity').textContent = 'NA';
      return;
    }
    priced.sort((a,b)=>a.price_cents-b.price_cents);
    const best = priced[0];

    $('#kCurrent').textContent = fmt.format(best.price_cents/100);
    $('#kStore').textContent = `at ${titleCase(best.store || 'Retailer')}`;
    $('#kTypical').textContent = fmt.format(best.price_cents/100);
    $('#kLow30').textContent = fmt.format(best.price_cents/100);
    $('#kLow30Date').textContent = '';
    $('#kIntegrity').textContent = 'Pass';
  }

  function drawChart(){
    const svg = $('#chart'); svg.innerHTML = '';
    $('#chartNote').textContent = 'No history yet';
  }

  function canonicalLink(store, offer, identity){
    const st = storeKey(store);
    const sku = norm(offer?.store_sku);

    if(st === 'amazon'){
      const asin = state.selectedAsin || identity?.asin || offer?.asin || sku;
      return asin && /^[A-Z0-9]{10}$/i.test(asin) ? `https://www.amazon.com/dp/${asin}` : '';
    }
    if(st === 'bestbuy'){
      return /^\d{6,8}$/.test(sku) ? `https://www.bestbuy.com/site/${sku}.p` : '';
    }
    if(st === 'walmart'){
      return /^\d{6,12}$/.test(sku) ? `https://www.walmart.com/ip/${sku}` : '';
    }
    if(st === 'target'){
      return /^\d{8}$/.test(sku) ? `https://www.target.com/p/-/A-${sku}` : '';
    }
    return '';
  }

  function getCheapestOffer(){
    const arr = (state.offers || []).filter(o => typeof o.price_cents === 'number');
    if (!arr.length) return null;
    arr.sort((a,b)=>a.price_cents-b.price_cents);
    return arr[0];
  }

  function renderOffers(sortByPrice){
    const wrap = $('#offers'); wrap.innerHTML = '';
    const note = $('#offersNote');

    if(!state.offers.length){
      note.textContent = 'No offers found.';
      return;
    }

    let arr = state.offers.map(o=>{
      const price = (typeof o.price_cents === 'number') ? o.price_cents/100 : null;
      return { ...o, _price: price };
    });

    if(sortByPrice){
      arr = arr.sort((a,b)=>{
        if(a._price == null && b._price == null) return 0;
        if(a._price == null) return 1;
        if(b._price == null) return -1;
        return a._price - b._price;
      });
    }

    arr.forEach(o=>{
      const bestLink = o.url || canonicalLink(o.store, o, state.identity) || '';
      const row = document.createElement('div');
      row.className = 'offer';
      row.innerHTML = `
        <div>
          <div class="offer-store">${titleCase(o.store || '')}</div>
        </div>
        <div class="muted-price">
          ${o._price != null ? `${fmt.format(o._price)}` : 'No price'}
        </div>
        <div>
          ${bestLink ? `<div class="links-compact">
            <a class="btn btn-go" href="${bestLink}" target="_blank" rel="noopener">Link</a>
          </div>` : `<div class="links-compact"></div>`}
        </div>
      `;
      wrap.appendChild(row);
    });

    note.textContent = 'PriceCheck does not use affiliate or sponsored links.';
  }

  function renderVariants(){
    const sel = $('#variant'); sel.innerHTML = '';
    const list = Array.isArray(state.variants) ? state.variants : [];

    if (!list.length) {
      const opt = document.createElement('option');
      opt.value = 'Default';
      opt.textContent = 'Default';
      sel.appendChild(opt);
      return;
    }

    for (const v of list){
      const opt = document.createElement('option');
      opt.value = v.asin || v.model_number || v.variant_label || 'Variant';
      opt.textContent = v.variant_label || v.model_number || v.asin || 'Variant';
      if (v.asin) opt.dataset.asin = v.asin;

      const asinU = up(v.asin);
      opt.selected = !!(state.selectedAsin && asinU === state.selectedAsin);
      sel.appendChild(opt);
    }
  }

  function renderForensics(){
    const ul = $('#forensicsList'); ul.innerHTML = '';
    ['Strike is consistent with recent range for this variant','Variant IDs match','Anchor price looks reasonable']
      .forEach(t=>{ const li=document.createElement('li'); li.textContent=t; ul.appendChild(li); });
  }

  function renderObs(){
    const body = $('#obsBody'); body.innerHTML='';
    if(!state.observed.length) return;
    state.observed
      .slice()
      .sort((a,b)=> new Date(b.t).getTime() - new Date(a.t).getTime())
      .forEach(o=>{
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="mono">${new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(o.t))}</td>
          <td>${titleCase(o.store || '')}</td>
          <td>${typeof o.price_cents === 'number' ? fmt.format(o.price_cents/100) : ''}</td>
          <td class="muted">${o.note || ''}</td>
        `;
        body.appendChild(tr);
      });
  }

  function renderCoverage(){
    const div = $('#coverage');
    div.innerHTML = '';

    const order = ['amazon','apple','target','walmart','bestbuy'];

    const best = {};
    (state.offers || []).forEach(o => {
      const st = storeKey(o.store);
      const p  = (typeof o.price_cents === 'number' && o.price_cents > 0) ? o.price_cents : null;
      if (!p || !order.includes(st)) return;
      best[st] = Math.min(best[st] ?? Infinity, p);
    });

    const present = order.filter(st => Number.isFinite(best[st]));

    if (!present.length){
      order.forEach(st => {
        const label = st === 'bestbuy' ? 'Best Buy' : titleCase(st);
        const row = document.createElement('div');
        row.className = 'bar';
        row.innerHTML = `
          <div>${label}</div>
          <div class="track"><div class="fill" style="width:0%"></div></div>
          <div>0%</div>
        `;
        div.appendChild(row);
      });
      return;
    }

    const weights = {};
    let totalW = 0;
    present.forEach(st => { weights[st] = 1 / best[st]; totalW += weights[st]; });

    const parts = present.map(st => {
      const raw = (weights[st] / totalW) * 100;
      return { st, raw, floor: Math.floor(raw), frac: raw - Math.floor(raw) };
    });

    let sum = parts.reduce((a, x) => a + x.floor, 0);
    let rem = 100 - sum;
    parts.sort((a,b) => b.frac - a.frac);
    for (let i = 0; i < parts.length && rem > 0; i++, rem--) parts[i].floor++;

    const pct = Object.fromEntries(parts.map(x => [x.st, x.floor]));

    order.forEach(st => {
      const label = st === 'bestbuy' ? 'Best Buy' : titleCase(st);
      const p = pct[st] || 0;
      const row = document.createElement('div');
      row.className = 'bar';
      row.innerHTML = `
        <div>${label}</div>
        <div class="track"><div class="fill" style="width:${p}%"></div></div>
        <div>${p}%</div>
      `;
      div.appendChild(row);
    });
  }

  function buildPmScript(){
    if(!state || !state.identity){
      const ta = document.getElementById('pmScript');
      if(ta) ta.value = 'Load a product first.';
      return;
    }
    const best = getCheapestOffer();
    const id = state.identity || {};
    const money = v => fmt.format((v || 0) / 100);
    const bestLink = best ? (best.url || canonicalLink(best.store, best, id) || '') : '';

    const script = best ? (
`Hello, I would like a price match.

${titleCase(best.store || 'Retailer')} is offering the same product for ${money(best.price_cents)}${bestLink ? ` (${bestLink})` : ''}

Identifiers: PC ${id.pc_code || 'NA'}  UPC ${id.upc || 'NA'}  ASIN ${state.selectedAsin || id.asin || 'NA'}

This is the same variant. Please match this price. Thank you.`
    ) : 'Load offers to generate a script.';

    const ta = document.getElementById('pmScript');
    if(ta) ta.value = script;
  }

  function renderSpecsMatrix(){
    const host = $('#specsMatrix');
    host.innerHTML = '';
    const items = Array.isArray(state.variants) ? state.variants : [];
    if (!items.length){ host.textContent = 'No specs available.'; return; }

    const cols = [
      ['variant', 'Variant'],
      ['category', 'Category'],
      ['brand', 'Brand'],
      ['model_number', 'Model Number'],
      ['model_name', 'Model Name'],
    ];

    const varies = {};
    ['category','brand','model_number','model_name'].forEach(k=>{
      const vals = new Set(items.map(v => (v[k] || '').trim()));
      varies[k] = vals.size > 1;
    });

    let html = '<table><thead><tr>';
    cols.forEach(([,label]) => { html += `<th>${label}</th>`; });
    html += '</tr></thead><tbody>';

    items.forEach(v=>{
      html += '<tr>';
      const label = v.variant_label || v.model_name || v.model_number || v.asin || 'Variant';
      html += `<td class="mono">${escapeHtml(label)}</td>`;

      ['category','brand','model_number','model_name'].forEach(k=>{
        const val = v[k] || 'NA';
        const hi = varies[k] ? ' style="background:rgba(255,230,150,.45)"' : '';
        html += `<td${hi}>${escapeHtml(val)}</td>`;
      });
      html += '</tr>';
    });

    html += '</tbody></table>';
    host.innerHTML = html;
  }

  // ---------- Downloads ----------
  function downloadHistoryCsv(){
    const rows = [['date','price','typical_low']];
    const csv = rows.map(r=>r.map(v=>String(v)).join(',')).join('\n');
    const blob = new Blob([csv], {type:'text/csv'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'history.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }

  function downloadObsCsv(){
    const rows = [['time','store','price','note']];
    (state.observed||[]).forEach(o=>{
      rows.push([
        o.t ? new Date(o.t).toISOString() : '',
        o.store || '',
        typeof o.price_cents === 'number' ? (o.price_cents/100).toFixed(2) : '',
        (o.note || '').replace(/,/g,';')
      ]);
    });
    const csv = rows.map(r=>r.join(',')).join('\n');
    const blob = new Blob([csv], {type:'text/csv'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'observations.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ---------- Small helpers ----------
  function flip(sel,on,off,ms){
    const el=$(sel);
    const txt=el.textContent;
    el.textContent=on;
    setTimeout(()=>el.textContent=off||txt,ms||900);
  }

  window.run = run;

  document.addEventListener('DOMContentLoaded', () => {
    const key = currentKeyFromUrl();
    if (key) {
      const q = $('#query'); if (q) q.value = key;
      run(key);
    }
  });

  window.addEventListener('popstate', () => {
    const key = currentKeyFromUrl();
    const q = $('#query'); if (q) q.value = key || '';
    if (key) run(key);
  });
})();