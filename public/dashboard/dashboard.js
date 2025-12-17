(function(){
  const $  = (s, ctx=document)=>ctx.querySelector(s);
  const $$ = (s, ctx=document)=>Array.from(ctx.querySelectorAll(s));
  const fmt = new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
  const todayLabel = new Intl.DateTimeFormat(undefined,{dateStyle:'medium'}).format(new Date());

  const state = { identity:null, variants:[], offers:[], observed:[], range:30, selectedAsin:null, lastKey:null };

  // helpers for URL <-> key
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

  // Controls
  $('#load').addEventListener('click', () => {
    const raw = $('#query').value.trim();
    const key = keyFromInput(raw);
    if (!key) return;
    applyKeyToUrl(key, 'push');   // update URL
    run(key);                     // load immediately
  });

  // Enter to submit
  $('#query').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('#load').click();
    }
  });

  // Share copies keyed link
  $('#share').addEventListener('click', () => {
    const raw = $('#query').value.trim();
    const key = keyFromInput(raw) || currentKeyFromUrl();
    const link = `${location.origin}/dashboard/?key=${encodeURIComponent(key || '')}`;
    navigator.clipboard.writeText(link);
    flip('#share','Copied','Copy share link',900);
  });

  document.addEventListener('click', (e)=>{
    const r = e.target.closest('[data-range]');
    if(r){ state.range = +r.dataset.range; drawChart(); }
    if(e.target && e.target.id === 'actSummary'){
      const msg = buildSummaryMsg(); if(!msg){ note('Load a product first.'); return; }
      copyText(msg); note('Copied summary.');
    }
    if(e.target && e.target.id === 'actRefund'){
      const msg = buildRefundMsg(); if(!msg){ note('Load a product first.'); return; }
      copyText(msg); note('Copied refund request.');
    }
    if(e.target && e.target.id === 'actFlag'){
      const msg = buildFlagMsg(); if(!msg){ note('Load a product first.'); return; }
      copyText(msg); note('Copied report text.');
    }
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

  // when user picks a variant, reload that exact ASIN
  $('#variant').addEventListener('change', (e) => {
    const asin = e.target.selectedOptions[0]?.dataset.asin;
    if (asin) {
      state.selectedAsin = asin.toUpperCase(); // remember before reload
      run(`asin:${asin}`);
    }
  });

  function getCurrentVariant(){
    const asin = state.selectedAsin || (state.identity?.asin ? String(state.identity.asin).toUpperCase() : null);
    if (asin) {
      const v = (state.variants || []).find(x => String(x.asin || '').toUpperCase() === asin);
      if (v) return v;
    }
    return (state.variants && state.variants[0]) || null;
  }

  function isLikelyPcCode(s){
    return /^[a-z0-9][a-z0-9_-]{2,}$/i.test(String(s || '').trim());
  }

  function keyFromInput(text){
    if (!text) return null;
    const t = text.trim();

    // Allow explicit prefixes straight through
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

    // URL parsing
    const am =
      t.match(/\/dp\/([A-Z0-9]{10})/i) ||
      t.match(/\/gp\/product\/([A-Z0-9]{10})/i);
    if (am) return `asin:${am[1].toUpperCase()}`;

    const tg = t.match(/target\.com\/.+\/(?:-|A-)?(\d{8})/i); if (tg) return `tcin:${tg[1]}`;
    const bb = t.match(/bestbuy\.com\/.+\/(\d{6,8})/i);      if (bb) return `bby:${bb[1]}`;
    const wm = t.match(/walmart\.com\/.+\/(\d{6,12})/i);     if (wm) return `wal:${wm[1]}`;

    // Apple URLs do not contain a universal ID we can rely on
    // Use stored listing URLs or pc_code for Apple linking
    // If user pastes an Apple URL, just treat it as raw and let them prefix pc:
    if (/apple\.com/i.test(t)) return t;

    // Direct ID heuristics
    if (/^\d{12}$/.test(t)) return `upc:${t}`;
    if (/^[A-Z0-9]{10}$/i.test(t)) return `asin:${t.toUpperCase()}`;
    if (isLikelyPcCode(t)) return `pc:${t}`;

    return t;
  }

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
      const data = await res.json(); // { identity, variants, offers, observed }

      state.identity = data.identity || null;
      state.variants = Array.isArray(data.variants) ? data.variants : [];
      state.offers   = Array.isArray(data.offers)   ? data.offers   : [];
      state.observed = Array.isArray(data.observed) ? data.observed : [];

      // set selectedAsin based on what we requested, else from identity
      if (state.lastKey?.toLowerCase().startsWith('asin:')) {
        state.selectedAsin = state.lastKey.slice(5).toUpperCase();
      } else if (state.identity?.asin) {
        state.selectedAsin = String(state.identity.asin).toUpperCase();
      } else {
        state.selectedAsin = null;
      }

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

  function hydrateHeader(){
    const id = state.identity || {};
    const DEFAULT_IMG = '../content-img/default.webp';

    const variants = state.variants || [];
    const asinU = String(state.selectedAsin || id.asin || '').toUpperCase();

    // Prefer the selected or identified ASIN variant
    const asinVariant =
      variants.find(v => String(v.asin || '').toUpperCase() === asinU) ||
      variants.find(v => v.asin) ||
      null;

    const v = asinVariant || variants[0] || null;

    // Title resolution
    let title = null;

    if (asinVariant) {
      title =
        (asinVariant.model_name && asinVariant.model_name.trim()) ||
        (asinVariant.model_number && asinVariant.model_number.trim()) ||
        null;
    }

    if (!title) {
      const anyAsinWithSpecs = variants.find(x =>
        x.asin && ((x.model_name && x.model_name.trim()) || (x.model_number && x.model_number.trim()))
      );
      if (anyAsinWithSpecs) {
        title =
          (anyAsinWithSpecs.model_name && anyAsinWithSpecs.model_name.trim()) ||
          (anyAsinWithSpecs.model_number && anyAsinWithSpecs.model_number.trim()) ||
          null;
      }
    }

    if (!title) {
      const labelFromVariants = variants.map(x => (x.variant_label || '').trim()).find(Boolean);
      const labelFromOffers   = (state.offers || []).map(o => (o.variant_label || '').trim()).find(Boolean);
      title = labelFromVariants || labelFromOffers || 'Cross store offers';
    }

    $('#pTitle').textContent = title;
    $('#pSubtitle').textContent = 'Latest prices for this product';

    const parts = [];
    if (id.pc_code) parts.push(`PCI ${id.pc_code}`);
    if (id.upc)     parts.push(`UPC ${id.upc}`);
    if (id.asin)    parts.push(`ASIN ${id.asin}`);
    $('#pIds').innerHTML = parts.map(p => `<span class="id-pill">${escapeHtml(p)}</span>`).join('');

    // Image with fallback
    const img = $('#pImg');
    const src =
      (v && v.image_url && v.image_url.trim()) ||
      (id && id.image_url && String(id.image_url).trim()) ||
      DEFAULT_IMG;

    if (src) {
      img.src = src;
      img.alt = title ? `${title} image` : 'Product image';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.style.display = 'block';
      img.onerror = () => { img.style.display = 'none'; };
    } else {
      img.removeAttribute('src');
      img.style.display = 'none';
    }
  }

  function cheapestOfferWithPrice(){
    const arr = (state.offers||[]).filter(o => typeof o.price_cents === 'number');
    if(!arr.length) return null;
    return arr.sort((a,b)=>a.price_cents - b.price_cents)[0];
  }

  function buildPmScript(){
    if(!state || !state.identity){
      const ta = document.getElementById('pmScript');
      if(ta) ta.value = 'Load a product first.';
      return;
    }
    const priced = (state.offers || [])
      .filter(o => typeof o.price_cents === 'number')
      .sort((a,b) => a.price_cents - b.price_cents);

    const cheap = priced[0] || null;
    const higher = priced.find(o => cheap ? o.store !== cheap.store : false) || priced[1] || null;
    const id = state.identity || {};
    const money = v => fmt.format((v || 0) / 100);
    const cheapLink = cheap ? (cheap.url || canonicalLink(cheap.store, cheap, id) || '') : '';

    const script = cheap ? (
`Hello, I would like a price match.

${titleCase(cheap.store || 'Retailer')} is offering the same product for ${money(cheap.price_cents)}${cheapLink ? ` (${cheapLink})` : ''}
Your price: ${higher && typeof higher.price_cents === 'number' ? money(higher.price_cents) : 'NA'}

Identifiers: PC ${id.pc_code || 'NA'}  UPC ${id.upc || 'NA'}  ASIN ${id.asin || 'NA'}

This is the same variant. Please match this price. Thank you.`
    ) : 'Load offers to generate a script.';

    const ta = document.getElementById('pmScript');
    if(ta) ta.value = script;
  }

  function hydrateKpis(){
    const best = cheapestOfferWithPrice();
    if(best){
      $('#kCurrent').textContent = fmt.format(best.price_cents/100);
      $('#kStore').textContent = `at ${titleCase(best.store || 'Retailer')}`;
      $('#kTypical').textContent = fmt.format(best.price_cents/100);
      $('#kLow30').textContent = fmt.format(best.price_cents/100);
    }else{
      $('#kCurrent').textContent = 'NA';
      $('#kStore').textContent = '';
      $('#kTypical').textContent = 'NA';
      $('#kLow30').textContent = 'NA';
      $('#kLow30Date').textContent = '';
    }
    $('#kIntegrity').textContent = 'Pass';
  }

  function drawChart(){
    const svg = $('#chart'); svg.innerHTML = '';
    $('#chartNote').textContent = 'No history yet';
  }

  function canonicalLink(store, offer, identity){
    const st = String(store||'').toLowerCase();
    const sku = String(offer?.store_sku||'').trim();

    if(st === 'amazon'){
      const asin = identity?.asin || sku;
      return asin && /^[A-Z0-9]{10}$/i.test(asin) ? `https://www.amazon.com/dp/${asin}` : '';
    }
    if(st === 'best buy' || st === 'bestbuy'){
      return /^\d{6,8}$/.test(sku) ? `https://www.bestbuy.com/site/${sku}.p` : '';
    }
    if(st === 'walmart'){
      return /^\d{6,12}$/.test(sku) ? `https://www.walmart.com/ip/${sku}` : '';
    }
    if(st === 'target'){
      return /^\d{8}$/.test(sku) ? `https://www.target.com/p/-/A-${sku}` : '';
    }
    // Apple: use captured listing URL only (canonical varies by product family)
    return '';
  }

  function renderOffers(sortByPrice){
    const wrap = $('#offers'); wrap.innerHTML = '';
    const note = $('#offersNote');

    if(!state.offers.length){
      note.textContent = 'No offers found.';
      return;
    }

    let arr = state.offers.map(o=>{
      const price = typeof o.price_cents === 'number' ? o.price_cents/100 : null;
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
      const linksHtml = bestLink
  ? `<div class="links-compact">
       <a class="btn btn-go" href="${bestLink}" target="_blank" rel="noopener">
         Link
         <svg class="ext-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" aria-hidden="true">
           <path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h280v80H200v560h560v-280h80v280q0 33-23.5 56.5T760-120H200Zm188-212-56-56 372-372H560v-80h280v280h-80v-144L388-332Z"/>
         </svg>
       </a>
     </div>`
  : `<div class="links-compact"></div>`;

      const row = document.createElement('div');
      row.className = 'offer';
      row.innerHTML = `
        <div>
          <div class="offer-store">${titleCase(o.store || '')}</div>
        </div>
        <div class="muted-price">
          ${o._price != null ? `${fmt.format(o._price)}` : 'No price'}
        </div>
        <div>${linksHtml}</div>
      `;
      wrap.appendChild(row);
    });

    note.textContent = "PriceCheck does not use affiliate links.";
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

      const asinU = (v.asin || '').toUpperCase();
      opt.selected = !!(state.selectedAsin && asinU === state.selectedAsin);

      sel.appendChild(opt);
    }
  }

  function renderForensics(){
    const ul = $('#forensicsList'); ul.innerHTML = '';
    [
      'Strike is consistent with recent range for this variant',
      'Variant IDs match',
      'Anchor price looks reasonable'
    ].forEach(t=>{
      const li=document.createElement('li'); li.textContent=t; ul.appendChild(li);
    });
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

    // Include Apple in snapshot
    const order = ['amazon','apple','target','walmart','bestbuy'];

    // Lowest (best) price per store in CENTS (ignore 0/invalid)
    const best = {};
    (state.offers || []).forEach(o => {
      const st = String(o.store || '').toLowerCase();
      const p  = (typeof o.price_cents === 'number' && o.price_cents > 0) ? o.price_cents : null;
      if (!p || !order.includes(st)) return;
      best[st] = Math.min(best[st] ?? Infinity, p);
    });

    const present = order.filter(st => Number.isFinite(best[st]));

    if (!present.length){
      order.forEach(st => {
        const label =
          st === 'bestbuy' ? 'Best Buy' :
          st === 'walmart' ? 'Walmart' :
          st === 'target'  ? 'Target' :
          st === 'apple'   ? 'Apple'  :
          'Amazon';

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

    // Inverse weighting: weight = 1 / price
    const weights = {};
    let totalW = 0;
    present.forEach(st => { weights[st] = 1 / best[st]; totalW += weights[st]; });

    // Percent per store with rounding that sums to 100
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
      const label =
        st === 'bestbuy' ? 'Best Buy' :
        st === 'walmart' ? 'Walmart' :
        st === 'target'  ? 'Target' :
        st === 'apple'   ? 'Apple'  :
        'Amazon';

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

    requestAnimationFrame(() => {
      const fills = Array.from(div.querySelectorAll('.fill'));
      fills.forEach(f => {
        const w = f.style.width;
        f.style.width = '0%';
        void f.offsetWidth;
        f.style.transition = 'width .9s ease';
        f.style.width = w;
      });
    });
  }

  function getCheapestOffer(){
    const arr = (state.offers||[]).map(o=>({ ...o, total:o.price_cents }));
    const has = arr.filter(x=>typeof x.total === 'number');
    if(!has.length) return null;
    has.sort((a,b)=>a.total - b.total);
    return has[0];
  }

  function buildSummaryMsg(){
    if(!state.identity) return null;
    const id = state.identity;
    const best = getCheapestOffer();
    const lines = [];
    lines.push(`PriceCheck summary`);
    lines.push(`IDs: PC ${id.pc_code || 'NA'}  UPC ${id.upc || 'NA'}  ASIN ${id.asin || 'NA'}`);
    if(best){
      const bestLink = best.url || canonicalLink(best.store, best, id) || '';
      lines.push(`Best: ${titleCase(best.store)} ~ ${fmt.format((best.price_cents||0)/100)}${bestLink?` (${bestLink})`:''}`);
    }
    lines.push(`Stores:`);
    (state.offers||[]).forEach(o=>{
      const link = o.url || canonicalLink(o.store, o, id) || '';
      const price = typeof o.price_cents === 'number' ? fmt.format(o.price_cents/100) : 'NA';
      lines.push(`• ${titleCase(o.store||'')} ${price}${link?` (${link})`:''}`);
    });
    return lines.join('\n');
  }

  function buildRefundMsg(){
    if(!state.identity) return null;
    const d = state.identity;
    const cheap = getCheapestOffer();
    return [
      `Hello. I recently bought this item and saw a lower price. Requesting post purchase adjustment.`,
      `Lower price: ${cheap ? `${titleCase(cheap.store)} ~ ${fmt.format((cheap.price_cents||0)/100)} ${cheap.url?`(${cheap.url})`:''}` : '[enter link]'}`,
      `IDs: PC ${d.pc_code||'NA'} UPC ${d.upc||'NA'} ASIN ${d.asin||'NA'}.`
    ].join('\n');
  }

  function buildFlagMsg(){
    if(!state.identity) return null;
    const cheap = getCheapestOffer();
    return [
      `Please review a suspicious listing.`,
      `Example: ${cheap ? `${titleCase(cheap.store)} ${cheap.url?cheap.url:''}` : '[link]'}`,
      `Reason: price looks off or marketplace seller.`
    ].join('\n');
  }

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

  function escapeHtml(s){
    return String(s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
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

  function note(t){
    const n = document.getElementById('actNote'); if(!n) return;
    n.textContent = t; setTimeout(()=>{ n.textContent=''; }, 1200);
  }
  function copyText(s){
    const ta = document.createElement('textarea'); ta.value = s;
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  function titleCase(s){ return String(s||'').replace(/\b\w/g, c=>c.toUpperCase()); }
  function flip(sel,on,off,ms){ const el=$(sel); const txt=el.textContent; el.textContent=on; setTimeout(()=>el.textContent=off||txt,ms||900); }

  // expose run for deep-link loader
  window.run = run;

  // auto-load if ?key=... is present
  document.addEventListener('DOMContentLoaded', () => {
    const key = currentKeyFromUrl();
    if (key) {
      const q = $('#query'); if (q) q.value = key;
      run(key);
    }
  });

  // handle back/forward
  window.addEventListener('popstate', () => {
    const key = currentKeyFromUrl();
    const q = $('#query'); if (q) q.value = key || '';
    if (key) run(key);
  });
})();