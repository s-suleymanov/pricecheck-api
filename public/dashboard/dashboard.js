// public/dashboard/dashboard.js
(function(){
  const $  = (s, ctx=document)=>ctx.querySelector(s);
  const fmt = new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});

  const state = {
    identity:null,
    variants:[],
    offers:[],
    observed:[],
    history:[],
    historyStats: null,
    rangeDays: 30,
    selectedVariantKey:null,   // NEW: pci:/upc
    lastKey:null
  };

  function slugifyTitle(s) {
  const raw = String(s || '').trim().toLowerCase();
  if (!raw) return 'product';

  return raw
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')     // non-alnum to dashes
    .replace(/^-+|-+$/g, '')         // trim dashes
    .slice(0, 80) || 'product';
}

  function setMeta(name, content) {
    if (!content) return;
    let el = document.querySelector(`meta[name="${name}"]`);
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute('name', name);
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  }

  function setOg(property, content) {
    if (!content) return;
    let el = document.querySelector(`meta[property="${property}"]`);
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute('property', property);
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  }

  function setCanonical(href) {
    if (!href) return;
    let el = document.querySelector('link[rel="canonical"]');
    if (!el) {
      el = document.createElement('link');
      el.setAttribute('rel', 'canonical');
      document.head.appendChild(el);
    }
    el.setAttribute('href', href);
  }

  function prettyDashboardUrl(key, title) {
    const slug = slugifyTitle(title);
    const url = new URL(location.href);
    url.pathname = `/dashboard/${slug}`;
    url.searchParams.set('key', key);
    return url;
  }

  function applyPrettyUrl(key, title, mode = 'replace') {
    const url = prettyDashboardUrl(key, title);
    if (mode === 'push') history.pushState({ key }, '', url);
    else history.replaceState({ key }, '', url);
  }

  function applySeoFromData(title, imageUrl, key) {
    const cleanTitle = String(title || 'Product').trim();
    const pageTitle = `${cleanTitle} • PriceCheck`;

    document.title = pageTitle;

    const desc = `Live price comparison across stores for ${cleanTitle}. Variant-aware matching by PCI and UPC.`;
    setMeta('description', desc);

    const canonical = prettyDashboardUrl(key, cleanTitle).toString();
    setCanonical(canonical);

    setOg('og:title', pageTitle);
    setOg('og:description', desc);
    setOg('og:url', canonical);

    if (imageUrl) {
      // ensure absolute for share bots
      const abs = imageUrl.startsWith('http') ? imageUrl : `${location.origin}${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`;
      setOg('og:image', abs);
      setMeta('twitter:image', abs);
    }

    setMeta('twitter:title', pageTitle);
    setMeta('twitter:description', desc);
  }

  // ---------- URL helpers ----------
  function applyKeyToUrl(k, mode = 'push') {
    const url = new URL(location.href);
    if (k) url.searchParams.set('key', k);
    else url.searchParams.delete('key');
    if (mode === 'push') history.pushState({ key: k }, '', url);
    else history.replaceState({ key: k }, '', url);
  }
  function currentKeyFromUrl() {
    const sp = new URL(location.href).searchParams;
    return sp.get('key') || sp.get('q');
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

  function titleCase(input) {
    const raw = String(input ?? '').trim();
    if (!raw) return '';

    const key = raw.toLowerCase();
    const OVERRIDE = {
      amazon: 'Amazon',
      target: 'Target',
      walmart: 'Walmart',
      bestbuy: 'Best Buy',
      bby: 'Best Buy',
      soloperformance: 'Solo Performance',
      radicaladventures: 'Radical Adventures',
      brandsmart: 'BrandsMart',
      aliexpress: 'AliExpress',
      electricsport: 'Electric Sport',
      electricride: 'Electric Ride',
      apple: 'Apple',
      dji: 'DJI',
      segway: 'Segway',
      iscooter: 'iScooter',
      lg: 'LG',
      sony: 'Sony',
      asus: 'ASUS',
      hp: 'HP',
      dell: 'Dell',
      bose: 'Bose',
    };
    if (OVERRIDE[key]) return OVERRIDE[key];

    if (/[A-Z].*[A-Z]/.test(raw) || /[a-z].*[A-Z]/.test(raw)) return raw;

    return raw
      .split(/\s+/)
      .map(w => w ? (w[0].toUpperCase() + w.slice(1).toLowerCase()) : w)
      .join(' ');
  }

  // PCI: 8 chars, first is a letter
  function isLikelyPci(s){
    return /^[A-Z][A-Z0-9]{7}$/i.test(norm(s));
  }

  function keyFromInput(text){
    if (!text) return null;
    const t = text.trim();

    if (/^(asin|upc|tcin|bby|bestbuy|sku|wal|walmart|target|pci)\s*:/i.test(t)) {
      const parts = t.split(':');
      const pref = (parts[0] || '').trim().toLowerCase();
      const rest = parts.slice(1).join(':').trim();
      if (!rest) return null;
      if (pref === 'asin') return `asin:${rest.toUpperCase()}`;
      if (pref === 'upc') return `upc:${rest}`;
      if (pref === 'pci') return `pci:${rest}`;
      // normalize some aliases
      if (pref === 'bestbuy' || pref === 'sku') return `bby:${rest}`;
      if (pref === 'walmart') return `wal:${rest}`;
      if (pref === 'target') return `tcin:${rest}`;
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

    if (/^\d{7}$/.test(t)) return `bby:${t}`;
    if (/^\d{8}$/.test(t)) return `tcin:${t}`;     // optional
    if (/^\d{12,14}$/.test(t)) return `upc:${t}`;  // I’d change 12 -> 12,14 to match your rule
    if (/^[A-Z0-9]{10}$/i.test(t)) return `asin:${t.toUpperCase()}`;
    if (isLikelyPci(t)) return `pci:${t}`;

    return t;
  }

  function chooseSelectedVariantKeyFromKey(key, data){
    const variants = Array.isArray(data?.variants) ? data.variants : [];
    const identity = data?.identity || {};
    const k = String(key || '').trim();

  function mapToExistingVariantKey(kind, rawVal){
    const val = String(rawVal || '').trim();
    if (!val || !variants.length) return null;

    if (kind === 'upc') {
      const want = cleanUpc(val);
      const hit = variants.find(v => cleanUpc(v?.upc) === want);
      return hit?.key || null;
    }

    if (kind === 'pci') {
      const want = up(val);
      const hit = variants.find(v => up(v?.pci) === want);
      return hit?.key || null;
    }

    return null;
  }

  if (/^(pci|upc):/i.test(k)) {
    const byKey = variants.find(v => String(v?.key || '') === k);
    if (byKey) return k;

    const kind = k.split(':')[0].toLowerCase();
    const val  = k.split(':').slice(1).join(':').trim();

    const mapped = mapToExistingVariantKey(kind, val);
    if (mapped) return mapped;

    // If nothing matches, keep k so backend can still resolve.
    return k;
  }

  // Prefer selected keys from identity (these should represent the page you are on)
  const mappedPci = identity.selected_pci ? mapToExistingVariantKey('pci', identity.selected_pci) : null;
  const mappedUpc = identity.selected_upc ? mapToExistingVariantKey('upc', identity.selected_upc) : null;

  if (mappedPci) return mappedPci;
  if (mappedUpc) return mappedUpc;

  // LAST RESORT fallback: use seed anchors too (prevents dropdown defaulting to first variant)
  const fallbackPci = identity.pci ? mapToExistingVariantKey('pci', identity.pci) : null;
  const fallbackUpc = identity.upc ? mapToExistingVariantKey('upc', identity.upc) : null;

  if (fallbackPci) return fallbackPci;
  if (fallbackUpc) return fallbackUpc;

  // If still nothing, do not silently pick the first variant.
  return null;
}

function getCurrentVariant(){
  const k = String(state.selectedVariantKey || '').trim();
  if (!k) return null;
  const hit = (state.variants || []).find(v => String(v?.key || '') === k);
  return hit || null;
}

const shareBtn = $('#share');
const sortTotalBtn = $('#sortTotal');
const copyCheapestBtn = $('#copyCheapest');
const downloadCsvBtn = $('#downloadCsv');
const downloadObsBtn = $('#downloadObs');
const copyPmBtn = $('#copyPm');
const variantSel = $('#variant');
const colorWrap = $('#colorWrap');
const colorSel  = $('#color');

// Share button (allow working even if query box is removed)
if (shareBtn) {
  shareBtn.addEventListener('click', () => {
    const raw = '';
    const key = keyFromInput(raw) || currentKeyFromUrl();
    const id = state.identity || {};
    const cur = getCurrentVariant() || null;

    const bestTitle =
      (id.model_name && String(id.model_name).trim()) ||
      (cur?.model_name && String(cur.model_name).trim()) ||
      (id.model_number && String(id.model_number).trim()) ||
      'Product';

    const link = prettyDashboardUrl(key || '', bestTitle).toString();
    navigator.clipboard.writeText(link);
    flip('#share','Copied','Copy share link',900);
  });
}

if (sortTotalBtn) sortTotalBtn.addEventListener('click', ()=> {
  renderOffers(true);
  renderCouponsCard();
});

if (copyCheapestBtn) copyCheapestBtn.addEventListener('click', ()=>{
  const cheap = getCheapestOffer();
  const link = cheap ? (cheap.url || canonicalLink(cheap.store, cheap, state.identity)) : '';
  if(link) navigator.clipboard.writeText(link);
  flip('#copyCheapest','Copied','Copy cheapest link',900);
});

if (downloadCsvBtn) downloadCsvBtn.addEventListener('click', downloadHistoryCsv);
if (downloadObsBtn) downloadObsBtn.addEventListener('click', downloadObsCsv);

if (copyPmBtn) copyPmBtn.addEventListener('click', ()=>{
  const ta = $('#pmScript');
  if (!ta) return;
  ta.select(); document.execCommand('copy');
  const note = $('#pmNote');
  if (note) {
    note.textContent = 'Copied';
    setTimeout(()=> note.textContent='', 900);
  }
});

function normLower(s){ return String(s || '').trim().toLowerCase(); }

function versionsFromVariants(list){
  const seen = new Set();
  const out = [];
  for (const v of list){
    const ver = String(v?.version || v?.variant_label || '').trim() || 'Default';
    const k = normLower(ver);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(ver);
  }
  return out;
}

function colorsForVersion(list, version){
  const want = normLower(version || 'Default');
  const seen = new Set();
  const out = [];
  for (const v of list){
    const ver = String(v?.version || v?.variant_label || '').trim() || 'Default';
    if (normLower(ver) !== want) continue;
    const c = String(v?.color || '').trim();
    if (!c) continue;
    const ck = normLower(c);
    if (seen.has(ck)) continue;
    seen.add(ck);
    out.push(c);
  }
  return out;
}

function chooseKeyForVersionColor(list, version, color){
  const wantV = normLower(version || 'Default');
  const wantC = normLower(color || '');

  if (wantC){
    const hit = list.find(v => {
      const ver = String(v?.version || v?.variant_label || '').trim() || 'Default';
      const col = String(v?.color || '').trim();
      return normLower(ver) === wantV && normLower(col) === wantC && String(v?.key || '').trim();
    });
    if (hit) return String(hit.key).trim();
  }

  const hit2 = list.find(v => {
    const ver = String(v?.version || v?.variant_label || '').trim() || 'Default';
    return normLower(ver) === wantV && String(v?.key || '').trim();
  });
  return hit2 ? String(hit2.key).trim() : null;
}

function syncVersionColorFromSelectedKey(){
  const list = Array.isArray(state.variants) ? state.variants : [];
  const k = String(state.selectedVariantKey || '').trim();
  const hit = list.find(v => String(v?.key || '').trim() === k);

  state.selectedVersion = hit ? (String(hit.version || hit.variant_label || '').trim() || 'Default') : null;
  state.selectedColor   = hit ? (String(hit.color || '').trim() || null) : null;
}

function renderVersionAndColor(){
  const list = Array.isArray(state.variants) ? state.variants : [];

  const versions = versionsFromVariants(list);
  variantSel.innerHTML = '';

  const desiredV = state.selectedVersion || (versions[0] || 'Default');
  for (const ver of (versions.length ? versions : ['Default'])){
    const opt = document.createElement('option');
    opt.value = ver;
    opt.textContent = ver;
    opt.selected = normLower(ver) === normLower(desiredV);
    variantSel.appendChild(opt);
  }
  state.selectedVersion = variantSel.value || 'Default';

  const colors = colorsForVersion(list, state.selectedVersion);

  if (colorWrap && colorSel){
    if (colors.length >= 2){
      colorWrap.hidden = false;
      colorSel.innerHTML = '';

      const desiredC = state.selectedColor || colors[0];
      for (const c of colors){
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        opt.selected = normLower(c) === normLower(desiredC);
        colorSel.appendChild(opt);
      }
      state.selectedColor = colorSel.value || colors[0];
    } else {
      colorWrap.hidden = true;
      colorSel.innerHTML = '';
      state.selectedColor = colors[0] || null;
    }
  }

  const resolvedKey = chooseKeyForVersionColor(list, state.selectedVersion, state.selectedColor);
  if (resolvedKey){
    state.selectedVariantKey = resolvedKey;
  }
}

// Version dropdown change
if (variantSel) {
  variantSel.addEventListener('change', () => {
    state.selectedVersion = variantSel.value || 'Default';
    state.selectedColor = null; // reset, we will pick first available color for this version
    renderVersionAndColor();
    if (state.selectedVariantKey){
      applyKeyToUrl(state.selectedVariantKey, 'push');
      run(state.selectedVariantKey);
    }
  });
}

// Color dropdown change
if (colorSel) {
  colorSel.addEventListener('change', () => {
    state.selectedColor = colorSel.value || null;
    renderVersionAndColor();
    if (state.selectedVariantKey){
      applyKeyToUrl(state.selectedVariantKey, 'push');
      run(state.selectedVariantKey);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(location.search);
  const key = params.get("key") || params.get("q") || "";

  if (!key.trim()) {
    document.getElementById("pTitle").textContent = "Search a product to view the dashboard.";
    return;
  }

  run(key);
});

document.querySelectorAll('button.pill[data-range]').forEach(btn => {
  btn.addEventListener('click', () => {
    const n = parseInt(btn.getAttribute('data-range'), 10);
    if (!Number.isFinite(n)) return;
    state.rangeDays = n;

    // Optional: visual active state
    document.querySelectorAll('button.pill[data-range]').forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');

    drawChart();
  });
});

  // ---------- Main loader ----------
  async function run(raw){
    const key = keyFromInput(raw);
    if(!key){ showMessage('Enter a product URL or ID.'); return; }
    state.lastKey = key;

    try{
      const res = await fetch(`/api/compare/${encodeURIComponent(key)}`, { headers: { 'Accept': 'application/json' }});
      if(res.status === 404){
        showMessage(`No match for "${raw}". Try prefixes like asin:..., upc:..., pci:..., bby:..., wal:..., tcin:...`);
        return;
      }
      if(!res.ok){ showMessage('Server error. Try again.'); return; }

      const data = await res.json();

      state.identity = data.identity || null;
      state.variants = Array.isArray(data.variants) ? data.variants : [];
      state.offers   = Array.isArray(data.offers)   ? data.offers   : [];
      state.history = (data.history && Array.isArray(data.history.daily)) ? data.history.daily : [];
      state.historyStats = (data.history && data.history.stats) ? data.history.stats : null;
      state.observed = Array.isArray(data.observed) ? data.observed : [];

      state.selectedVariantKey = chooseSelectedVariantKeyFromKey(state.lastKey, data);
      syncVersionColorFromSelectedKey();

      const id = data.identity || {};
      const cur = (() => {
        const k = chooseSelectedVariantKeyFromKey(state.lastKey, data);
        if (!k) return null;
        return (Array.isArray(data.variants) ? data.variants : []).find(v => String(v?.key || '') === k) || null;
      })();

      const bestTitle =
        (id.model_name && String(id.model_name).trim()) ||
        (cur?.model_name && String(cur.model_name).trim()) ||
        (id.model_number && String(id.model_number).trim()) ||
        'Product';

      const bestImg =
        (cur?.image_url && String(cur.image_url).trim()) ||
        (id.image_url && String(id.image_url).trim()) ||
        '';

      applyPrettyUrl(state.lastKey, bestTitle, 'replace');
      applySeoFromData(bestTitle, bestImg, state.lastKey);


      hydrateHeader();
      hydrateKpis();
      drawChart();
      renderOffers(false);
      renderCouponsCard();
      renderVariants();
      renderSpecsMatrix();
      renderForensics();
      renderObs();
      renderCoverage();
      buildPmScript();
    }catch(err){
      console.error(err);
      showMessage('Network error. Check console.');
    }
  }

  // ---------- UI ----------
  function showMessage(msg){
    $('#pTitle').textContent = msg;
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


  function escapeHtml(s){
    return String(s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  function hydrateHeader(){
    const id = state.identity || {};
    const DEFAULT_IMG = '../content-img/default.webp';

    {
      const warnEl = document.querySelector('#ps-warn'); // or whatever your dashboard warning element id is
      if (warnEl) warnEl.hidden = !(id.dropship_warning === true);
    }

    {
      const recallWrap = document.querySelector('#ps-recall');
      const recallLink = document.querySelector('#ps-recall-link');

      const url = (id.recall_url || '').trim();

      if (recallWrap) recallWrap.hidden = !url;

      if (recallLink) {
        if (url) {
          recallLink.href = url;
        } else {
          recallLink.removeAttribute('href');
        }
      }

    }

    const cur = getCurrentVariant() || null;

    // Title: prefer offer title, otherwise catalog model_name, otherwise fallback
    let title = null;

    if (!title) title =
    (id.model_name && String(id.model_name).trim()) ||
    (cur && cur.model_name && String(cur.model_name).trim()) ||
      (id.model_number && String(id.model_number).trim()) ||
      'Product';

    $('#pTitle').textContent = title;

    // Pills: show selected anchor keys (pci/upc/asin) if present
    const parts = [];
    const selPci = id.selected_pci ? String(id.selected_pci).trim() : '';
    const selUpc = id.selected_upc ? cleanUpc(id.selected_upc) : '';
    const selAsin = id.asin ? up(id.asin) : '';

    if (selPci) parts.push(`PCI ${selPci}`);
    if (selUpc) parts.push(`UPC ${selUpc}`);
    if (selAsin) parts.push(`ASIN ${selAsin}`);

    $('#pIds').innerHTML = parts.map(p => `<span class="id-pill">${escapeHtml(p)}</span>`).join('');

    const img = $('#pImg');
    const src =
      (cur && cur.image_url && String(cur.image_url).trim()) ||
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

    const brand = (cur?.brand || id.brand || '').trim();
    const category = (cur?.category || id.category || '').trim();

    const bw = document.getElementById('brandWrap');
    const cw = document.getElementById('categoryWrap');
    const bb = document.getElementById('brandBtn');
    const cb = document.getElementById('categoryBtn');

    bw.hidden = !brand;
      if (brand) {
        bb.textContent = brand;
        bb.onclick = () => {
          location.href = `/browse/?q=${encodeURIComponent(brand)}&page=1`;
        };
      } else {
        bb.onclick = null;
      }

      cw.hidden = !category;
      if (category) {
        cb.textContent = category;
        cb.onclick = () => {
          location.href = `/browse/?q=${encodeURIComponent(category)}&page=1`;
        };
      } else {
        cb.onclick = null;
      }
  }

  function hydrateKpis(){
    const priced = (state.offers || []).filter(o => typeof o.price_cents === 'number');
    if (!priced.length){
      $('#kCurrent').textContent = 'NA';
      $('#kStore').textContent = '';
      $('#kTypical').textContent = 'NA';
      $('#kTypicalNote').textContent = '';
      $('#kLow30').textContent = 'NA';
      $('#kLow30Date').textContent = '';
      $('#kIntegrity').textContent = 'NA';
      return;
    }

    priced.sort((a,b)=>a.price_cents-b.price_cents);
    const best = priced[0];

    $('#kCurrent').textContent = fmt.format(best.price_cents/100);
    $('#kStore').textContent = `at ${titleCase(best.store || 'Retailer')}`;

    const hs = state.historyStats || {};
    const tl90 = (typeof hs.typical_low_90_cents === 'number') ? hs.typical_low_90_cents : null;
    const tl30 = (typeof hs.typical_low_30_cents === 'number') ? hs.typical_low_30_cents : null;

    $('#kTypical').textContent = tl90 != null ? fmt.format(tl90/100) : 'NA';
    $('#kTypicalNote').textContent = tl90 != null ? 'based on daily lows' : '';

    $('#kLow30').textContent = tl30 != null ? fmt.format(tl30/100) : 'NA';

    const low30Date = hs.low_30_date ? new Date(hs.low_30_date) : null;
    const ok = low30Date && !Number.isNaN(low30Date.getTime());
    $('#kLow30Date').textContent = ok ? `lowest day: ${new Intl.DateTimeFormat(undefined,{dateStyle:'medium'}).format(low30Date)}` : '';

    // Keep your current “Pass” placeholder until you wire real integrity logic
    $('#kIntegrity').textContent = 'Pass';
  }

  function drawChart(){
  const svg = $('#chart');
  const note = $('#chartNote');
  svg.innerHTML = '';
  svg.setAttribute('viewBox', '0 0 700 200');
  svg.setAttribute('preserveAspectRatio', 'none');

  const pts = Array.isArray(state.history) ? state.history : [];
  if (!pts.length) {
    note.textContent = 'No history yet';
    return;
  }

  const days = state.rangeDays || 30;

  // Use UTC cutoff in ms to avoid timezone weirdness
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

  const filtered = pts
    .map(p => {
      const day = String(p?.d || '').slice(0, 10); // supports "2026-01-04" or "2026-01-04T08:00:00.000Z"
      const t = new Date(day + 'T00:00:00Z');
      return { d: day, t, price_cents: p?.price_cents };
    })
    .filter(r => Number.isFinite(r.t.getTime()) && typeof r.price_cents === 'number')
    .filter(r => r.t.getTime() >= cutoffMs)
    .sort((a,b)=>a.t - b.t);

  if (filtered.length < 2) {
    note.textContent = 'Not enough history yet';
    return;
  }

  note.textContent = '';

  const W = 700, H = 200;
  const padL = 10, padR = 10, padT = 10, padB = 18;

  const prices = filtered.map(p => p.price_cents);
  let minP = Math.min(...prices);
  let maxP = Math.max(...prices);

  if (minP === maxP) {
    minP = Math.max(0, minP - 50);
    maxP = maxP + 50;
  } else {
    const span = maxP - minP;
    minP = Math.max(0, Math.floor(minP - span * 0.08));
    maxP = Math.ceil(maxP + span * 0.08);
  }

  const x = (i) => padL + (i * (W - padL - padR)) / (filtered.length - 1);
  const y = (p) => padT + ((maxP - p) * (H - padT - padB)) / (maxP - minP);

  const linePath = filtered
    .map((p,i)=> `${i===0?'M':'L'} ${x(i).toFixed(2)} ${y(p.price_cents).toFixed(2)}`)
    .join(' ');

  const hs = state.historyStats || {};
  const typical =
    (typeof hs.typical_low_90_cents === 'number' ? hs.typical_low_90_cents : null) ??
    (typeof hs.typical_low_30_cents === 'number' ? hs.typical_low_30_cents : null);

  const typicalY = (typeof typical === 'number') ? y(typical) : null;

  const ns = 'http://www.w3.org/2000/svg';

  const p1 = document.createElementNS(ns, 'path');
  p1.setAttribute('d', linePath);
  p1.setAttribute('fill', 'none');
  p1.setAttribute('class', 'chart-line');
  p1.setAttribute('stroke', '#6366f1');
  p1.setAttribute('stroke-width', '2');
  p1.setAttribute('stroke-linecap', 'round');
  p1.setAttribute('stroke-linejoin', 'round');

  svg.appendChild(p1);

  if (typicalY != null) {
    const p2 = document.createElementNS(ns, 'path');
  p2.setAttribute('d', `M ${padL} ${typicalY.toFixed(2)} L ${W - padR} ${typicalY.toFixed(2)}`);
  p2.setAttribute('fill', 'none');
  p2.setAttribute('class', 'chart-line alt');
  p2.setAttribute('stroke', '#10b981');
  p2.setAttribute('stroke-width', '2');
  p2.setAttribute('stroke-dasharray', '4 4');
    svg.appendChild(p2);
  }


  const last = filtered[filtered.length - 1];
  const dot = document.createElementNS(ns, 'circle');
  dot.setAttribute('cx', x(filtered.length - 1));
  dot.setAttribute('cy', y(last.price_cents));
  dot.setAttribute('r', 3.5);
  dot.setAttribute('fill', '#6366f1');
  dot.setAttribute('class', 'chart-dot');
  svg.appendChild(dot);
}

  // Important: Amazon link should use offer.store_sku (ASIN), not a single selected ASIN
  function canonicalLink(store, offer){
    const st = storeKey(store);
    const sku = norm(offer?.store_sku);

    if(st === 'amazon'){
      const asin = up(sku);
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

  function moneyFromCents(c){
    return (typeof c === 'number') ? fmt.format(c/100) : 'NA';
  }

  function couponCandidates(){
  const offers = Array.isArray(state.offers) ? state.offers : [];
  return offers
    .map(o => {
      const price = (typeof o.price_cents === 'number') ? o.price_cents : null;
      const eff   = (typeof o.effective_price_cents === 'number') ? o.effective_price_cents : null;
      const text  = couponSummary(o);
      const has = !!String(o?.coupon_text || '').trim();

      const savings = (price != null && eff != null && eff > 0 && eff <= price) ? (price - eff) : null;

      return {
        ...o,
        _price: price,
        _eff: eff,
        _couponText: text,
        _hasCoupon: has,
        _savings: savings
      };
    })
    .filter(o => o._hasCoupon || o._eff != null);
}

function pickBestCoupon(list){
  const arr = (list || []).slice();

  // Best = biggest deterministic savings first, otherwise lowest effective price, otherwise any coupon text
  arr.sort((a,b) => {
    const as = (a._savings != null) ? a._savings : -1;
    const bs = (b._savings != null) ? b._savings : -1;
    if (bs !== as) return bs - as;

    const ae = (a._eff != null) ? a._eff : Number.POSITIVE_INFINITY;
    const be = (b._eff != null) ? b._eff : Number.POSITIVE_INFINITY;
    if (ae !== be) return ae - be;

    // fallback: cheaper sticker price
    const ap = (a._price != null) ? a._price : Number.POSITIVE_INFINITY;
    const bp = (b._price != null) ? b._price : Number.POSITIVE_INFINITY;
    return ap - bp;
  });

  return arr[0] || null;
}

function setMaybe(el, text, { asHtml = false } = {}) {
  if (!el) return;
  const t = String(text || '').trim();
  if (!t) {
    el.hidden = true;
    if (asHtml) el.innerHTML = '';
    else el.textContent = '';
    return;
  }
  el.hidden = false;
  if (asHtml) el.innerHTML = t;
  else el.textContent = t;
}

function renderCouponsCard(){
  const card = document.getElementById('couponCard');
  if (!card) return;

  const list = couponCandidates();
  const best = pickBestCoupon(list);

  if (!best){
    card.hidden = true;
    return;
  }

  card.hidden = false;

  const store = titleCase(best.store || 'Retailer');
  const link = best.url || canonicalLink(best.store, best) || '#';

  const priceCents = best._price;
  const effCents = best._eff;
  const showEff = (effCents != null && priceCents != null && effCents > 0 && effCents <= priceCents);

  const saveEl = document.getElementById('cpSave');
  if (saveEl) saveEl.textContent = (best._savings != null) ? `Save ${moneyFromCents(best._savings)}` : '';

  const stEl = document.getElementById('cpStore');
  if (stEl) stEl.textContent = store;

  const effEl = document.getElementById('cpEffective');
  if (effEl) effEl.textContent = showEff ? moneyFromCents(effCents) : (priceCents != null ? moneyFromCents(priceCents) : 'NA');

  const regEl = document.getElementById('cpRegular');
  if (regEl) regEl.textContent = showEff ? `Regular ${moneyFromCents(priceCents)}` : '';

const confEl = document.getElementById('cpConfidence');
const ruleEl = document.getElementById('cpRule');

// Confidence: only "Verified" if we can compute eff deterministically
const confidence =
  (showEff && best._savings != null) ? 'Verified price' :
  (String(best.coupon_text || '').trim() ? 'Promo noted' : '');

setMaybe(confEl, confidence);

// Rule: short action hint
const ruleBits = [];
if (best.coupon_requires_clip === true) ruleBits.push('Clip coupon');
if (String(best.coupon_code || '').trim()) ruleBits.push(`Code ${String(best.coupon_code).trim()}`);
setMaybe(ruleEl, ruleBits.join(' • '));

  const linkEl = document.getElementById('cpLink');
  if (linkEl) linkEl.href = link;

  // More coupons (top 3 besides best)
  const more = list
    .filter(o => o !== best)
    .slice(0, 3);

  const moreWrap = document.getElementById('cpMore');
  const moreLabel = document.getElementById('cpMoreLabel');

    if (moreWrap && moreLabel){
      if (!more.length){
        moreWrap.hidden = true;
        moreLabel.hidden = true;
      } else {
        moreWrap.hidden = false;
        moreLabel.hidden = false;
        moreWrap.innerHTML = more.map(o => {
          const st = titleCase(o.store || 'Retailer');
          const show = (o._eff != null) ? moneyFromCents(o._eff) : (o._price != null ? moneyFromCents(o._price) : 'NA');
          const t = o._couponText || String(o.coupon_text || '').trim();
          return `
            <div class="coupon-mini">
              <div class="coupon-mini__left">
                <div class="coupon-mini__store">${escapeHtml(st)}</div>
                <div class="coupon-mini__text">${escapeHtml(t)}</div>
              </div>
              <div class="coupon-mini__price">${escapeHtml(show)}</div>
            </div>
          `;
        }).join('');
      }
    }
  }

  function couponSummary(o){
    const txt = String(o?.coupon_text || '').trim();
    if (!txt) return '';
    const clip = (o?.coupon_requires_clip === true) ? 'Clip' : '';
    const code = String(o?.coupon_code || '').trim();
    const bits = [clip, code ? `Code ${code}` : ''].filter(Boolean);
    return bits.length ? `${txt} • ${bits.join(' • ')}` : txt;
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
      const bestLink = o.url || canonicalLink(o.store, o) || '';
      const row = document.createElement('div');
      row.className = 'offer';
      const tag = (o.offer_tag || '').trim();

      row.innerHTML = `
        <div>
          <div class="offer-store">${titleCase(o.store || '')}</div>
        </div>

        <div class="muted-price">
          ${o._price != null ? `${fmt.format(o._price)}` : 'No price'}
        </div>

        <div class="muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size: 18px;">
          ${tag ? escapeHtml(tag) : ''}
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
  syncVersionColorFromSelectedKey();
  renderVersionAndColor();
}

  function renderForensics(){
    const ul = $('#forensicsList'); ul.innerHTML = '';
    ['Strike is consistent with recent range for this variant','Variant IDs match','Anchor price looks reasonable']
      .forEach(t=>{ const li=document.createElement('li'); li.textContent=t; ul.appendChild(li); });
  }

  function renderObs(){
    const body = $('#obsBody'); body.innerHTML='';
    if(!state.observed.length) return;

    const getTime = (o) => o?.t || o?.observed_at || o?.observedAt || null;

    state.observed
      .slice()
      .sort((a,b)=> new Date(getTime(b) || 0).getTime() - new Date(getTime(a) || 0).getTime())
      .forEach(o=>{
        const tt = getTime(o);
        const d = tt ? new Date(tt) : null;
        const ok = d && !Number.isNaN(d.getTime());

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="mono">${ok ? new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(d) : ''}</td>
          <td>${titleCase(o.store || '')}</td>
          <td>${typeof o.price_cents === 'number' ? fmt.format(o.price_cents/100) : ''}</td>
          <td class="muted">Pass</td>
        `;
        body.appendChild(tr);
      });
  }

  function renderCoverage(){
    const div = $('#coverage');
    div.innerHTML = '';

    const offers = Array.isArray(state.offers) ? state.offers : [];

    const best = {};
    offers.forEach(o => {
      const st = storeKey(o.store);
      const p  = (typeof o.price_cents === 'number' && o.price_cents > 0) ? o.price_cents : null;
      if (!st || p == null) return;
      best[st] = Math.min(best[st] ?? Infinity, p);
    });

    const preferred = ['amazon','apple','target','walmart','bestbuy'];

    const seen = new Set();
    for (const o of offers) {
      const st = storeKey(o.store);
      if (st) seen.add(st);
    }

    const rest = [...seen].filter(s => !preferred.includes(s)).sort();
    const order = preferred.filter(s => seen.has(s)).concat(rest);
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
    const bestLink = best ? (best.url || canonicalLink(best.store, best) || '') : '';

    const script = best ? (
`Hello, I would like a price match.

${titleCase(best.store || 'Retailer')} is offering the same product for ${money(best.price_cents)}${bestLink ? ` (${bestLink})` : ''}

Identifiers: PCI ${id.selected_pci || id.pci || 'NA'}  UPC ${id.selected_upc || id.upc || 'NA'}  ASIN ${id.selected_asin || id.asin || 'NA'}

This is the same variant. Please match this price. Thank you.`
    ) : 'Load offers to generate a script.';

    const ta = document.getElementById('pmScript');
    if(ta) ta.value = script;
  }

  // ---------- Intelligence actions ----------
function intelligenceContext() {
  const id = state.identity || {};
  const v  = getCurrentVariant() || {};
  const offers = (state.offers || []).slice();

  const title =
    (v.model_name && String(v.model_name).trim()) ||
    (id.model_name && String(id.model_name).trim()) ||
    $('#pTitle')?.textContent ||
    'this item';

  // cheapest offer
  const priced = offers.filter(o => typeof o.price_cents === 'number' && o.price_cents > 0);
  priced.sort((a,b)=>a.price_cents-b.price_cents);
  const cheapest = priced[0] || null;

  // most expensive offer
  priced.sort((a,b)=>b.price_cents-a.price_cents);
  const highest = priced[0] || null;

  return { id, v, title, offers, cheapest, highest };
}

async function copyAndNote(text, note) {
  try { await navigator.clipboard.writeText(text); } catch {}
  const el = document.getElementById('actNote');
  if (el) {
    el.textContent = note || 'Copied.';
    setTimeout(()=>{ el.textContent = ''; }, 1800);
  }
}

function money(cents){
  if (typeof cents !== 'number') return 'NA';
  return fmt.format(cents/100);
}

function bestLinkForOffer(o){
  if(!o) return '';
  return o.url || canonicalLink(o.store, o) || '';
}

const actSummary = document.getElementById('actSummary');
const actRefund  = document.getElementById('actRefund');
const actFlag    = document.getElementById('actFlag');

if (actSummary) actSummary.addEventListener('click', async () => {
  const { title, offers, cheapest, highest } = intelligenceContext();

  const lines = [];
  lines.push(`PriceCheck summary for: ${title}`);
  lines.push('');
  if (!offers.length) {
    lines.push('No offers found yet.');
  } else {
    if (cheapest) {
      lines.push(`Cheapest: ${titleCase(cheapest.store)} at ${money(cheapest.price_cents)}${bestLinkForOffer(cheapest) ? ` (${bestLinkForOffer(cheapest)})` : ''}`);
    }
    if (highest && cheapest && highest.price_cents !== cheapest.price_cents) {
      lines.push(`Highest: ${titleCase(highest.store)} at ${money(highest.price_cents)}${bestLinkForOffer(highest) ? ` (${bestLinkForOffer(highest)})` : ''}`);
      const diff = highest.price_cents - cheapest.price_cents;
      lines.push(`Spread: ${money(diff)}`);
    }
    lines.push('');
    lines.push('Offers:');
    offers.forEach(o => {
      const link = bestLinkForOffer(o);
      lines.push(`- ${titleCase(o.store)}: ${typeof o.price_cents === 'number' ? money(o.price_cents) : 'No price'}${link ? ` (${link})` : ''}`);
    });
  }

  await copyAndNote(lines.join('\n'), 'Summary copied.');
  });

  if (actRefund) actRefund.addEventListener('click', async () => {
    const { title, cheapest } = intelligenceContext();
    const link = bestLinkForOffer(cheapest);

    const text =
  `Hi, I bought ${title} recently.

  I found it listed for a lower price right now${link ? ` (${link})` : ''}.
  Could you please match the current price or refund the difference?

  Thank you.`;

    await copyAndNote(text, 'Refund script copied.');
  });

  if (actFlag) actFlag.addEventListener('click', async () => {
    const { title, offers } = intelligenceContext();

    const suspicious = offers
      .filter(o => typeof o.price_cents === 'number' && o.price_cents > 0)
      .sort((a,b)=>a.price_cents-b.price_cents)[0];

    const link = bestLinkForOffer(suspicious);

    const text =
  `I want to flag this listing as potentially misleading.

  Item: ${title}
  Store: ${suspicious ? titleCase(suspicious.store) : 'Unknown'}
  Listing link: ${link || 'N/A'}

  Reason: price and listing details seem inconsistent with other reputable offers. Please review.`;

    await copyAndNote(text, 'Flag text copied.');
  });


  function renderSpecsMatrix(){
    const host = $('#specsMatrix');
    host.innerHTML = '';
    const items = Array.isArray(state.variants) ? state.variants : [];
    if (!items.length){ host.textContent = 'No specs available.'; return; }

    const cols = [
      ['variant', 'Variant'],
      ['category', 'Category'],
      ['brand', 'Brand'],
      ['model_number', 'Model'],
      ['model_name', 'Name'],
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
      const ver = (v.version || v.variant_label || '').trim();
      const col = (v.color || '').trim();
      const label =
        (ver && col ? `${ver} • ${col}` : (ver || col)) ||
        v.model_name || v.model_number || v.key || 'Variant';
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

  function downloadHistoryCsv(){
    const pts = Array.isArray(state.history) ? state.history : [];
    if (!pts.length) return;

    const days = state.rangeDays || 30;
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - days);

    const hs = state.historyStats || {};
    const typical =
      (typeof hs.typical_low_90_cents === 'number' ? hs.typical_low_90_cents : null) ??
      (typeof hs.typical_low_30_cents === 'number' ? hs.typical_low_30_cents : null);

    const rows = pts
      .map(p => {
        const day = String(p?.d || '').slice(0, 10);
        return { d: day, t: new Date(day + 'T00:00:00Z'), price_cents: p?.price_cents };
      })
      .filter(r => Number.isFinite(r.t.getTime()) && typeof r.price_cents === 'number')
      .filter(r => r.t >= cutoff)
      .sort((a,b)=>a.t - b.t)
      .map(r => ({
        date: r.d,
        price: (r.price_cents/100).toFixed(2),
        typical_low: (typeof typical === 'number') ? (typical/100).toFixed(2) : ''
      }));

    if (!rows.length) return;

    const header = ['date','price','typical_low'];
    const csv = [
      header.join(','),
      ...rows.map(r => `${r.date},${r.price},${r.typical_low}`)
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;

    const v = getCurrentVariant();
    const label = (v?.variant_label || v?.model_name || 'history').toString().trim().replace(/[^a-z0-9]+/gi,'-').toLowerCase();
    a.download = `pricecheck-${label}-${days}d.csv`;

    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function downloadObsCsv(){
    const rows = [['time','store','price','note']];
    (state.observed||[]).forEach(o=>{
      const t = o.t || o.observed_at || o.observedAt || '';
      rows.push([
        t ? new Date(t).toISOString() : '',
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

  window.addEventListener('popstate', () => {
    const raw = currentKeyFromUrl(); // raw user input from ?key= or ?q=
    const q = $('#query'); if (q) q.value = raw || '';
    if (raw) run(raw);
  });
})();