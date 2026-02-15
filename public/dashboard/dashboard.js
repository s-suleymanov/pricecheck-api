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
    selectedVariantKey:null,
    lastKey:null,
    families: []   
  };

  function setJsonLd(obj) {
    let el = document.querySelector('script[data-pc-jsonld="1"]');
    if (!el) {
      el = document.createElement('script');
      el.type = 'application/ld+json';
      el.setAttribute('data-pc-jsonld', '1');
      document.head.appendChild(el);
    }
    el.textContent = JSON.stringify(obj);
  }

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

    function setRobots(content) {
    let el = document.querySelector('meta[name="robots"]');
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute('name', 'robots');
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  }

  function canonicalKeyFromData(data, fallbackKey) {
    const id = data?.identity || {};
    const pci = String(id.selected_pci || '').trim();
    const upc = String(id.selected_upc || '').trim();

    if (pci) return `pci:${pci}`;
    if (upc) return `upc:${upc}`;
    return String(fallbackKey || '').trim() || null;
  }

    function urlKeyFromPathname() {
    const parts = location.pathname.split("/").filter(Boolean);
    if (parts[0] !== "dashboard") return null;

    // /dashboard/:kind/:value/
    if (parts.length >= 3 && isAllowedKind(parts[1])) {
      const kind = parts[1].toLowerCase();
      const value = decodeURIComponent(parts[2] || "");
      const k = `${kind}:${value}`;
      return normalizeKey(k);
    }

    // /dashboard/:slug/:kind/:value/
    if (parts.length >= 4 && isAllowedKind(parts[2])) {
      const kind = parts[2].toLowerCase();
      const value = decodeURIComponent(parts[3] || "");
      const k = `${kind}:${value}`;
      return normalizeKey(k);
    }

    return null;
  }

  function isOnCanonicalKey(canonicalKey) {
    const on = urlKeyFromPathname() || currentKeyFromUrl() || '';
    return String(on).trim().toLowerCase() === String(canonicalKey || '').trim().toLowerCase();
  }

    function slugifyBrowse(s) {
    return String(s ?? "")
      .trim()
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/['"]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
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
    const [kindRaw, ...rest] = String(key || '').trim().split(':');
    const kind = (kindRaw || '').toLowerCase();
    const value = rest.join(':').trim();

    const url = new URL(location.origin);
    if (kind && value) {
      url.pathname = `/dashboard/${slug}/${kind}/${encodeURIComponent(value)}/`;
    } else {
      url.pathname = `/dashboard/${slug}/`;
    }
    return url;
  }

  function applyPrettyUrl(key, title, mode = 'replace') {
    const url = prettyDashboardUrl(key, title);
    if (mode === 'push') history.pushState({ key }, '', url);
    else history.replaceState({ key }, '', url);
  }

  function canonicalOriginForMeta() {
    const h = String(location.hostname || '').toLowerCase();
    // Local/dev stays local
    if (h === 'localhost' || h === '127.0.0.1' || h.endsWith('.onrender.com')) return location.origin;

    // Production canonical host (forces www)
    if (h === 'pricechecktool.com' || h === 'www.pricechecktool.com') return 'https://www.pricechecktool.com';

    return location.origin;
  }

  function absoluteImageForMeta(imageUrl) {
    const u = String(imageUrl || '').trim();
    if (!u) return `${canonicalOriginForMeta()}/logo/default.webp`;
    if (u.startsWith('http')) return u;
    return `${canonicalOriginForMeta()}${u.startsWith('/') ? '' : '/'}${u}`;
  }

  function isPrettyDashboardPath() {
    const parts = location.pathname.split('/').filter(Boolean);
    // /dashboard/:slug/:kind/:value/
    return parts[0] === 'dashboard'
      && parts.length >= 4
      && /^[a-z0-9-]+$/.test(parts[1] || '')
      && /^[a-z]+$/i.test(parts[2] || '')
      && !!parts[3];
  }

  function applySeoFromData(title, imageUrl, key) {
  const cleanTitle = String(title || 'Product').trim() || 'Product';
  const pageTitle = `${cleanTitle} - PriceCheck`;

  document.title = pageTitle;

  const desc = `Compare prices for ${cleanTitle} across stores. See price history, cross-store offers, and any verified coupons, matched to the exact variant by PCI and UPC.`;

  // Update <meta name="description">
  setMeta('description', desc);

  // Build pretty path on the current origin (pushState must stay same-origin)
  const pretty = prettyDashboardUrl(key, cleanTitle);

  // Canonical URL can be cross-host (pricechecktool.com -> www.pricechecktool.com)
  const canonical = `${canonicalOriginForMeta()}${pretty.pathname}`;

  setCanonical(canonical);

  setOg('og:title', pageTitle);
  setOg('og:description', desc);
  setOg('og:url', canonical);

  const img = absoluteImageForMeta(imageUrl);
  setOg('og:image', img);

  setMeta('twitter:card', 'summary_large_image');
  setMeta('twitter:title', pageTitle);
  setMeta('twitter:description', desc);
  setMeta('twitter:image', img);
}

  function currentKeyFromUrl() {
    const parts = location.pathname.split("/").filter(Boolean);
    if (parts[0] !== "dashboard") return null;

    // /dashboard/:kind/:value/
    if (parts.length >= 3 && isAllowedKind(parts[1])) {
      const kind = parts[1].toLowerCase();
      const value = decodeURIComponent(parts[2] || "");
      const k = `${kind}:${value}`;
      return normalizeKey(k);
    }

    // /dashboard/:slug/:kind/:value/
    if (parts.length >= 4 && isAllowedKind(parts[2])) {
      const kind = parts[2].toLowerCase();
      const value = decodeURIComponent(parts[3] || "");
      const k = `${kind}:${value}`;
      return normalizeKey(k);
    }

    return null;
  }

  const ALLOWED_KINDS = new Set(["asin", "upc", "pci", "bby", "wal", "tcin"]);

  function isAllowedKind(k) {
    return ALLOWED_KINDS.has(String(k || "").trim().toLowerCase());
  }

  function normalizeKey(raw) {
    const t = String(raw || "").trim();
    if (!t) return null;

    // explicit prefix form: kind:value
    const m = t.match(/^([a-z]+)\s*:\s*(.+)$/i);
    if (m) {
      let kind = String(m[1] || "").trim().toLowerCase();
      let val = String(m[2] || "").trim();

      // alias mapping into the allowed set
      if (kind === "bestbuy" || kind === "sku") kind = "bby";
      if (kind === "walmart") kind = "wal";
      if (kind === "target") kind = "tcin";

      if (!isAllowedKind(kind)) return null;
      if (!val) return null;

      if (kind === "asin") {
        val = val.toUpperCase();
        if (!/^[A-Z0-9]{10}$/.test(val)) return null;
      }

      if (kind === "pci") {
        val = val.toUpperCase();
        if (!/^[A-Z][A-Z0-9]{7}$/.test(val)) return null;
      }

      if (kind === "upc") {
        val = val.replace(/\D/g, "");
        if (!/^\d{12,14}$/.test(val)) return null;
      }

      if (kind === "tcin") {
        val = val.replace(/\D/g, "");
        if (!/^\d{8}$/.test(val)) return null;
      }

      if (kind === "bby") {
        val = val.replace(/\D/g, "");
        if (!/^\d{6,8}$/.test(val)) return null;
      }

      if (kind === "wal") {
        val = val.replace(/\D/g, "");
        if (!/^\d{6,12}$/.test(val)) return null;
      }

      return `${kind}:${val}`;
    }

    // otherwise try to infer from URLs or raw IDs
    return keyFromInput(t);
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
      jbl: 'JBL',
      aliexpress: 'AliExpress',
      macys: "Macy's",
      niu: "NIU",
      voromotors: "Voro Motors",
      electricsport: 'Electric Sport',
      electricride: 'Electric Ride',
      apple: 'Apple',
      dji: 'DJI',
      segway: 'Segway',
      iscooter: 'iScooter',
      lg: 'LG',
      microcenter: "Micro Center",
      bjs: "BJ's",
      sony: 'Sony',
      asus: 'ASUS',
      hp: 'HP',
      dell: 'Dell',
      bose: 'Bose',
      samsclub: "Sam's Club",
      lowes: "Lowe's",
      ebay: "Ebay",
      alibaba: "Alibaba",
      aovo: "AOVO",
      logitechg: "Logitech G",
      macys: "Macy's",
      "5thwheel": "5th Wheel",
      turtlebeach: "Turtle Beach",
      gamestop: "GameStop"
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

    // Explicit kind:value
    const m = t.match(/^([a-z]+)\s*:\s*(.+)$/i);
    if (m) {
      let kind = String(m[1] || "").trim().toLowerCase();
      let rest = String(m[2] || "").trim();

      if (kind === "bestbuy" || kind === "sku") kind = "bby";
      if (kind === "walmart") kind = "wal";
      if (kind === "target") kind = "tcin";

      if (!isAllowedKind(kind)) return null;
      return normalizeKey(`${kind}:${rest}`);
    }

    const am =
      t.match(/\/dp\/([A-Z0-9]{10})/i) ||
      t.match(/\/gp\/product\/([A-Z0-9]{10})/i);
    if (am) return normalizeKey(`asin:${am[1]}`);

    const tg = t.match(/target\.com\/.+\/(?:-|A-)?(\d{8})/i);
    if (tg) return normalizeKey(`tcin:${tg[1]}`);

    const bb = t.match(/bestbuy\.com\/.+\/(\d{6,8})/i);
    if (bb) return normalizeKey(`bby:${bb[1]}`);

    const wm = t.match(/walmart\.com\/.+\/(\d{6,12})/i);
    if (wm) return normalizeKey(`wal:${wm[1]}`);

    if (/^\d{6,8}$/.test(t)) return normalizeKey(`bby:${t}`);
    if (/^\d{8}$/.test(t)) return normalizeKey(`tcin:${t}`);
    if (/^\d{12,14}$/.test(t)) return normalizeKey(`upc:${t}`);
    if (/^[A-Z0-9]{10}$/i.test(t)) return normalizeKey(`asin:${t}`);
    if (isLikelyPci(t)) return normalizeKey(`pci:${t}`);

    return null;
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

const downloadCsvBtn = $('#downloadCsv');
const downloadObsBtn = $('#downloadObs');
const copyPmBtn = $('#copyPm');
const variantSel = $('#variant');
const variant2Card = $('#variant2Card');
const variant2Pills = $('#variant2Pills');
const colorCard = $('#colorCard');
const colorPills = $('#colorPills');
const familyWrap = $('#familyWrap');
const familySel  = $('#familySel');

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

function normalizeSpaces(s){
  return String(s ?? '').replace(/\s+/g,' ').trim();
}

function parseSizeToken(raw){
  // Returns { kind: 'size', unitRank, value } for sortable sizes (GB/TB/inch/etc), else null
  const s = normalizeSpaces(raw).toLowerCase();
  if (!s) return null;

  // Storage: GB / TB
  // supports: "128GB", "128 gb", "1TB", "1 tb"
  let m = s.match(/^(\d+(?:\.\d+)?)\s*(tb|gb)\b/);
  if (m) {
    const num = parseFloat(m[1]);
    const unit = m[2];
    const gbValue = unit === 'tb' ? num * 1024 : num;
    return { kind: 'size', unitRank: 1, value: gbValue, unit: 'gb' };
  }

  // Inches: 11-inch, 13", 13 in, 13 inch
  m = s.match(/^(\d+(?:\.\d+)?)\s*(?:("|inches|inch|in)\b|-?inch\b)/);
  if (m) {
    const num = parseFloat(m[1]);
    return { kind: 'size', unitRank: 2, value: num, unit: 'in' };
  }

  // If you later want: mm, hz, w, mah, etc, add patterns here.

  return null;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function smartOptionCompare(a, b){
  const A = normalizeSpaces(a);
  const B = normalizeSpaces(b);

  const pa = parseSizeToken(A);
  const pb = parseSizeToken(B);

  // If both are "sizes" (GB/TB/inches), sort numerically by normalized value
  if (pa && pb && pa.kind === 'size' && pb.kind === 'size') {
    // If different unit families, keep them grouped (storage before inches)
    if (pa.unitRank !== pb.unitRank) return pa.unitRank - pb.unitRank;
    if (pa.value !== pb.value) return pa.value - pb.value;
    return collator.compare(A, B);
  }

  // If only one is a size, prefer sizes first (so storage options don't get mixed with words)
  if (pa && !pb) return -1;
  if (!pa && pb) return 1;

  // Otherwise natural alphanumeric: A2 < A10, Gen 2 < Gen 10, etc.
  return collator.compare(A, B);
}

function normLower(s){ return String(s || '').trim().toLowerCase(); }

function valueOf(v, key){
  const x = v?.[key];
  const t = String(x == null ? '' : x).trim();
  return t || '';
}

function versionOf(v){
  // "Model" dropdown shows catalog.version first, fallback to variant_label
    return valueOf(v, 'version') || 'Default';
}

function variantOf(v){
  // New dropdown is catalog.variant (can be blank)
  return valueOf(v, 'variant');
}

function colorOf(v){
  return valueOf(v, 'color');
}

function uniqList(arr){
  const seen = new Set();
  const out = [];

  for (const s of arr){
    const val = normalizeSpaces(s);
    const k = val.toLowerCase();
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(val);
  }

  out.sort(smartOptionCompare);
  return out;
}

function versionsFromVariants(list){
  return uniqList(list.map(versionOf));
}

function variantsForVersion(list, version){
  const wantV = normLower(version || 'Default');
  const vals = [];
  for (const v of list){
    if (normLower(versionOf(v)) !== wantV) continue;
    const vv = variantOf(v);
    if (vv) vals.push(vv);
  }
  return uniqList(vals);
}

function colorsForVersionVariant(list, version, variant){
  const wantV = normLower(version || 'Default');
  const wantVar = normLower(variant || '');
  const vals = [];
  for (const v of list){
    if (normLower(versionOf(v)) !== wantV) continue;

    // If a variant is selected, filter by it. If not selected, allow all.
    const vv = variantOf(v);
    if (wantVar && normLower(vv) !== wantVar) continue;

    const c = colorOf(v);
    if (c) vals.push(c);
  }
  return uniqList(vals);
}

function chooseKeyForVersionVariantColor(list, version, variant, color){
  const wantV = normLower(version || 'Default');
  const wantVar = normLower(variant || '');
  const wantC = normLower(color || '');

  // 1) Exact match: version + variant + color
  if (wantC){
    const hit = list.find(v => {
      if (normLower(versionOf(v)) !== wantV) return false;
      if (wantVar && normLower(variantOf(v)) !== wantVar) return false;
      if (normLower(colorOf(v)) !== wantC) return false;
      return String(v?.key || '').trim();
    });
    if (hit) return String(hit.key).trim();
  }

  // 2) version + variant (ignore color)
  if (wantVar){
    const hit2 = list.find(v => {
      if (normLower(versionOf(v)) !== wantV) return false;
      if (normLower(variantOf(v)) !== wantVar) return false;
      return String(v?.key || '').trim();
    });
    if (hit2) return String(hit2.key).trim();
  }

  // 3) version only
  const hit3 = list.find(v => {
    if (normLower(versionOf(v)) !== wantV) return false;
    return String(v?.key || '').trim();
  });
  return hit3 ? String(hit3.key).trim() : null;
}

function syncSelectorsFromSelectedKey(){
  const list = Array.isArray(state.variants) ? state.variants : [];
  const k = String(state.selectedVariantKey || '').trim();
  const hit = list.find(v => String(v?.key || '').trim() === k);

  state.selectedVersion = hit ? (versionOf(hit) || 'Default') : null;
  state.selectedVariant2 = hit ? (variantOf(hit) || null) : null;
  state.selectedColor   = hit ? (colorOf(hit) || null) : null;
}

function renderPillGroup(hostEl, options, selectedValue, onPick){
  if (!hostEl) return;

  hostEl.innerHTML = '';

  for (const opt of options){
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pill-choice' + (normLower(opt) === normLower(selectedValue) ? ' is-active' : '');
    b.textContent = opt;

    b.addEventListener('click', () => {
      onPick(opt);
    });

    hostEl.appendChild(b);
  }
}

function pushVariantSelectionAndRun(){
  if (!state.selectedVariantKey) return;
  applyPrettyUrl(state.selectedVariantKey, $('#pTitle')?.textContent || 'Product', 'push');
  run(state.selectedVariantKey);
}

function renderVersionVariantColor(){
  const list = Array.isArray(state.variants) ? state.variants : [];

  // ----------------
  // Model (version)
  // ----------------
  const versions = versionsFromVariants(list);
  if (variantSel){
    variantSel.innerHTML = '';
    const desiredV = state.selectedVersion || (versions[0] || 'Default');

    for (const ver of (versions.length ? versions : ['Default'])) {
      const opt = document.createElement('option');
      opt.value = ver;
      opt.textContent = ver;
      opt.selected = normLower(ver) === normLower(desiredV);
      variantSel.appendChild(opt);
    }
    state.selectedVersion = variantSel.value || 'Default';
  } else {
    state.selectedVersion = state.selectedVersion || (versions[0] || 'Default');
  }

  // ----------------
// Variant (catalog.variant) as pills
// ----------------
const v2 = variantsForVersion(list, state.selectedVersion);

if (variant2Card && variant2Pills){
  if (v2.length >= 1) {
    variant2Card.hidden = false;

    let desiredVar = state.selectedVariant2;
    if (desiredVar && !v2.some(x => normLower(x) === normLower(desiredVar))) desiredVar = null;
    if (!desiredVar) desiredVar = v2[0];

    state.selectedVariant2 = desiredVar;

    renderPillGroup(variant2Pills, v2, state.selectedVariant2, (picked) => {
      if (normLower(picked) === normLower(state.selectedVariant2)) return;

      state.selectedVariant2 = picked;
      state.selectedColor = null;

      renderVersionVariantColor();

      const resolvedKey = chooseKeyForVersionVariantColor(
        list,
        state.selectedVersion,
        state.selectedVariant2,
        state.selectedColor
      );
      if (resolvedKey) state.selectedVariantKey = resolvedKey;

      pushVariantSelectionAndRun();
    });
  } else {
    variant2Card.hidden = true;
    variant2Pills.innerHTML = '';
    state.selectedVariant2 = null;
  }
} else {
  state.selectedVariant2 = state.selectedVariant2 || (v2[0] || null);
}

// ----------------
// Color as pills
// ----------------
const colors = colorsForVersionVariant(list, state.selectedVersion, state.selectedVariant2);

if (colorCard && colorPills){
  if (colors.length >= 2) {
    colorCard.hidden = false;

    let desiredC = state.selectedColor;
    if (desiredC && !colors.some(x => normLower(x) === normLower(desiredC))) desiredC = null;
    if (!desiredC) desiredC = colors[0];

    state.selectedColor = desiredC;

    renderPillGroup(colorPills, colors, state.selectedColor, (picked) => {
      if (normLower(picked) === normLower(state.selectedColor)) return;

      state.selectedColor = picked;

      renderVersionVariantColor();

      const resolvedKey = chooseKeyForVersionVariantColor(
        list,
        state.selectedVersion,
        state.selectedVariant2,
        state.selectedColor
      );
      if (resolvedKey) state.selectedVariantKey = resolvedKey;

      pushVariantSelectionAndRun();
    });
  } else {
    colorCard.hidden = true;
    if (colorPills) colorPills.innerHTML = '';
    state.selectedColor = colors[0] || null;
  }
} else {
  state.selectedColor = state.selectedColor || (colors[0] || null);
}

  // Resolve to a variant.key
  const resolvedKey = chooseKeyForVersionVariantColor(
    list,
    state.selectedVersion,
    state.selectedVariant2,
    state.selectedColor
  );

  if (resolvedKey){
    state.selectedVariantKey = resolvedKey;
  }
}

if (familySel) {
  familySel.addEventListener('change', () => {
    const nextKey = String(familySel.value || '').trim();
    if (!nextKey) return;

    // Avoid pointless reload if you're already on it
    const curKey = String(state.lastKey || '').trim();
    if (nextKey.toLowerCase() === curKey.toLowerCase()) return;

    // New family should reset the variant selection cleanly
    state.selectedVariantKey = null;
    state.selectedVersion = null;
    state.selectedVariant2 = null;
    state.selectedColor = null;

    applyPrettyUrl(nextKey, $('#pTitle')?.textContent || 'Product', 'push');
    run(nextKey);
  });
}

// Model (version) dropdown change
if (variantSel) {
  variantSel.addEventListener('change', () => {
    state.selectedVersion = variantSel.value || 'Default';
    state.selectedVariant2 = null;
    state.selectedColor = null;
    renderVersionVariantColor();
    if (state.selectedVariantKey) {
      applyPrettyUrl(state.selectedVariantKey, $('#pTitle')?.textContent || 'Product', 'push');
      run(state.selectedVariantKey);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  wireIdPillsCopy();
  const key = currentKeyFromUrl() || "";
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
    const key = normalizeKey(raw);

    if (!key) {
      showMessage("Enter an ASIN, UPC, PCI, Best Buy SKU, Walmart itemId, or Target TCIN.");
      return;
    }

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
      state.families = Array.isArray(data.families) ? data.families : [];

      state.selectedVariantKey = chooseSelectedVariantKeyFromKey(state.lastKey, data);
      syncSelectorsFromSelectedKey();

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

      const offers = (state.offers || [])
      .filter(o => typeof o.price_cents === 'number' && o.price_cents > 0)
      .slice(0, 10)
      .map(o => ({
        "@type": "Offer",
        "priceCurrency": "USD",
        "price": (o.price_cents / 100).toFixed(2),
        "url": (o.url || canonicalLink(o.store, o) || undefined),
        "seller": { "@type": "Organization", "name": titleCase(o.store || "Retailer") },
        "availability": "https://schema.org/InStock"
      }))
      .filter(o => o.url); // require a url for cleanliness

    setJsonLd({
      "@context": "https://schema.org",
      "@type": "Product",
      "name": bestTitle,
      "image": bestImg ? [bestImg.startsWith('http') ? bestImg : `${location.origin}${bestImg.startsWith('/') ? '' : '/'}${bestImg}`] : undefined,
      "brand": (state.identity?.brand ? { "@type": "Brand", "name": state.identity.brand } : undefined),
      "sku": (state.identity?.selected_pci || undefined),
      "offers": offers.length ? offers : undefined
    });

      const canonicalKey = canonicalKeyFromData(data, state.lastKey);

      // always show the canonical PCI URL when possible
      if (canonicalKey) {
        state.lastKey = canonicalKey;
        applyPrettyUrl(canonicalKey, bestTitle, 'replace');
        applySeoFromData(bestTitle, bestImg, canonicalKey);
      }

      // robots: only index the pretty PCI canonical page
      const kind = (String(canonicalKey || '').split(':')[0] || '').toLowerCase();
      if (kind === 'pci' && isOnCanonicalKey(canonicalKey) && isPrettyDashboardPath()) {
        setRobots('index,follow');
      } else {
        setRobots('noindex,follow');
      }

      hydrateHeader();
      hydrateKpis();
      drawChart();
      renderOffers(true);
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
    const DEFAULT_IMG = '/logo/default.webp';

    {
      const warnEl = document.querySelector('#ps-warn'); // or whatever your dashboard warning element id is
      if (warnEl) warnEl.hidden = !(id.dropship_warning === true);
    }
    {
      const limited = document.querySelector('#ps-limited');
      if (limited) limited.hidden = !(id.coverage_warning === true);
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

    const brand = String(cur?.brand || id.brand || '').trim();
    const category = String(cur?.category || id.category || '').trim();

    // Family (model_number) dropdown
    const fam =
      (id.model_number && String(id.model_number).trim()) ||
      (cur?.model_number && String(cur.model_number).trim()) ||
      '';

    if (familyWrap && familySel) {
      // Only show when we have a brand + a current family
      if (!brand || !fam) {
        familyWrap.hidden = true;
        familySel.innerHTML = '';
      } else {
        familyWrap.hidden = false;

        // Build unique list of families for this brand from API
        const rows = Array.isArray(state.families) ? state.families : [];

        const map = new Map(); // model_number(lower) -> { model_number, key }
        for (const r of rows) {
          const mn = String(r?.model_number || '').trim();
          const k  = String(r?.key || '').trim();
          if (!mn || !k) continue;
          const lk = mn.toLowerCase();
          if (!map.has(lk)) map.set(lk, { model_number: mn, key: k });
        }

        // Ensure the current family is present even if API list is missing it
        // (we will add it only if we can find a key for it in the returned list)
        const items = Array.from(map.values());

        // Sort alphabetically, but keep current family at the top
        const famCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
        items.sort((a, b) => famCollator.compare(a.model_number, b.model_number));

        // Rebuild select
        familySel.innerHTML = '';

        // If we have nothing, fall back to showing the current family as a disabled single option
        if (!items.length) {
          const opt = document.createElement('option');
          opt.value = '';
          opt.textContent = fam;
          opt.selected = true;
          familySel.appendChild(opt);
          familySel.disabled = true;
        } else {
          familySel.disabled = false;

          for (const it of items) {
            const opt = document.createElement('option');
            opt.value = it.key;              // IMPORTANT: value is the jump key (pci:/upc:)
            opt.textContent = it.model_number;
            familySel.appendChild(opt);
          }

          // Select the current family if present, otherwise the first one
          const current = items.find(x => x.model_number.toLowerCase() === fam.toLowerCase());
          familySel.value = current ? current.key : (items[0]?.key || '');
        }
      }
    }

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

    const pIdsEl = $('#pIds');
    pIdsEl.innerHTML = parts
      .map(p => `<span class="id-pill is-copy" data-copy="${escapeHtml(p)}" role="button" tabindex="0">${escapeHtml(p)}</span>`)
      .join('');

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

    const bw = document.getElementById('brandWrap');
    const cw = document.getElementById('categoryWrap');
    const bb = document.getElementById('brandBtn');
    const cb = document.getElementById('categoryBtn');

    bw.hidden = !brand;
    if (brand) {
      bb.textContent = brand;
      bb.onclick = () => {
        const slug = slugifyBrowse(brand);
        location.href = slug ? `/browse/${encodeURIComponent(slug)}/` : `/browse/`;
      };
    } else {
      bb.onclick = null;
    }

    cw.hidden = !category;
    if (category) {
      cb.textContent = category;
      cb.onclick = () => {
        const slug = slugifyBrowse(category);
        location.href = slug ? `/browse/${encodeURIComponent(slug)}/` : `/browse/`;
      };
    } else {
      cb.onclick = null;
    }

  }

  function hydrateKpis(){
  const offers = Array.isArray(state.offers) ? state.offers : [];
  const priced = offers
    .map(o => ({ o, c: bestComparableCents(o) }))
    .filter(x => typeof x.c === 'number' && x.c > 0);

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

  priced.sort((a,b)=>a.c-b.c);
  const best = priced[0].o;
  const bestCents = priced[0].c;

  $('#kCurrent').textContent = fmt.format(bestCents/100);
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
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  function ensureChartTip(){
  const host = svg.parentElement;
  if (!host) return null;

  // Make sure the tooltip can position relative to the chart area
  const cs = getComputedStyle(host);
  if (cs.position === 'static') host.style.position = 'relative';

  let tip = host.querySelector('#chartTip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'chartTip';
      tip.className = 'chart-tip';
      tip.hidden = true;
      host.appendChild(tip);
    }
    return tip;
  }

  const tip = ensureChartTip();

  function showTip(px, py, text){
    if (!tip) return;
    tip.textContent = text;
    tip.style.left = `${px}px`;
    tip.style.top  = `${py}px`;
    tip.hidden = false;
  }

  function hideTip(){
    if (!tip) return;
    tip.hidden = true;
  }

  const pts = Array.isArray(state.history) ? state.history : [];

  let workingPts = pts;

  // Force today's point to reflect the cheapest current offer (including verified coupons),
  // even if price_history is Amazon-heavy.
  const today = new Date().toISOString().slice(0, 10);
  const todayBest = bestOfferCentsToday();

  if (typeof todayBest === 'number' && todayBest > 0){
    const idx = (Array.isArray(workingPts) ? workingPts : []).findIndex(p => String(p?.d || '').slice(0,10) === today);
    if (idx >= 0){
      const cur = Number(workingPts[idx]?.price_cents);
      if (!Number.isFinite(cur) || todayBest < cur){
        workingPts[idx].price_cents = todayBest;
      }
    } else {
      workingPts = (Array.isArray(workingPts) ? workingPts : []).concat([{ d: today, price_cents: todayBest }]);
    }
  }

  if (!workingPts.length) {
    const offers = Array.isArray(state.offers) ? state.offers : [];
    const priced = offers
      .map(o => {
        const p = (typeof o.price_cents === 'number' && o.price_cents > 0) ? o.price_cents : null;
        const e = (typeof o.effective_price_cents === 'number' && o.effective_price_cents > 0) ? o.effective_price_cents : null;
        // prefer effective if present and valid
        const use = (e != null && p != null && e <= p) ? e : p;
        return use;
      })
      .filter(v => typeof v === 'number' && v > 0)
      .sort((a,b)=>a-b);

    if (priced.length) {
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      workingPts = [{ d: today, price_cents: priced[0] }];
      note.textContent = ''; // we are rendering something useful
    } else {
      note.textContent = 'No history yet';
      return;
    }
  }  

  note.textContent = '';

    // Apply range filter
  const days = Number(state.rangeDays || 30);
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);

  const filtered = workingPts
    .map(p => {
      const day = String(p?.d || '').slice(0, 10);
      const t = new Date(day + 'T00:00:00Z');
      return { d: day, t, price_cents: p?.price_cents };
    })
    .filter(r => Number.isFinite(r.t.getTime()) && typeof r.price_cents === 'number' && r.price_cents > 0)
    .filter(r => r.t >= cutoff)
    .sort((a,b)=>a.t - b.t);

    if (!filtered.length) {
    note.textContent = 'No history yet';
    return;
  }

  if (filtered.length === 1) {
    const W = 700, H = 200;
    const padL = 0, padR = 10, padT = 10, padB = 18;
    const centerX = (padL + (W - padR)) / 2;

    const p = filtered[0].price_cents;

    // Pad min/max so a flat line is visible
    let minP = Math.max(0, p - 50);
    let maxP = p + 50;

    const y = (price) => padT + ((maxP - price) * (H - padT - padB)) / (maxP - minP);

    const ns = 'http://www.w3.org/2000/svg';
    const y0 = y(p);

    const line = document.createElementNS(ns, 'path');
    line.setAttribute('d', `M ${padL} ${y0.toFixed(2)} L ${centerX.toFixed(2)} ${y0.toFixed(2)}`);
    line.setAttribute('fill', 'none');
    line.setAttribute('class', 'chart-line');
    line.setAttribute('stroke', '#6366f1');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(line);

    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', centerX.toFixed(2));
    dot.setAttribute('cy', y0.toFixed(2));
    dot.setAttribute('r', 3.5);
    dot.setAttribute('fill', '#6366f1');
    dot.setAttribute('class', 'chart-dot');
    svg.appendChild(dot);

    const label = `${fmt.format(p/100)} • ${filtered[0].d}`;
    dot.addEventListener('pointerenter', (e) => {
      const hostRect = svg.parentElement.getBoundingClientRect();
      showTip(e.clientX - hostRect.left, e.clientY - hostRect.top, label);
    });
    dot.addEventListener('pointermove', (e) => {
      const hostRect = svg.parentElement.getBoundingClientRect();
      showTip(e.clientX - hostRect.left, e.clientY - hostRect.top, label);
    });
    dot.addEventListener('pointerleave', hideTip);

    note.textContent = '';
    return;
  }

  const W = 700, H = 200;
  const padL = 0, padR = 10, padT = 10, padB = 18;

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

    // Hover points (invisible) so users can read exact date + price
  const hostRect = () => svg.parentElement.getBoundingClientRect();

  filtered.forEach((pt, i) => {
    const cx = x(i);
    const cy = y(pt.price_cents);

    const hit = document.createElementNS(ns, 'circle');
    hit.setAttribute('cx', cx);
    hit.setAttribute('cy', cy);
    hit.setAttribute('r', 10);                 // big hit area
    hit.setAttribute('fill', 'transparent');   // invisible
    hit.style.cursor = 'default';

    const label = `${fmt.format(pt.price_cents/100)} • ${pt.d}`;

    hit.addEventListener('pointerenter', (e) => {
      const r = hostRect();
      showTip(e.clientX - r.left, e.clientY - r.top, label);
    });
    hit.addEventListener('pointermove', (e) => {
      const r = hostRect();
      showTip(e.clientX - r.left, e.clientY - r.top, label);
    });
    hit.addEventListener('pointerleave', hideTip);

    svg.appendChild(hit);
  });

  // Also hide tooltip if you leave the SVG entirely
  svg.addEventListener('pointerleave', hideTip);

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
    const offers = Array.isArray(state.offers) ? state.offers : [];
    let best = null;
    let bestC = null;

    for (const o of offers){
      const c = bestComparableCents(o);
      if (typeof c !== 'number' || c <= 0) continue;
      if (bestC == null || c < bestC){
        bestC = c;
        best = o;
      }
    }
    return best;
  }

  function moneyFromCents(c){
    return (typeof c === 'number') ? fmt.format(c/100) : 'NA';
  }

  function bestComparableCents(o){
    const p = (typeof o?.price_cents === 'number' && o.price_cents > 0) ? o.price_cents : null;
    const e = (typeof o?.effective_price_cents === 'number' && o.effective_price_cents > 0) ? o.effective_price_cents : null;
    // Use effective only when it is a real, better-or-equal price
    if (p != null && e != null && e <= p) return e;
    return p;
  }

  function bestOfferCentsToday(){
    const offers = Array.isArray(state.offers) ? state.offers : [];
    let best = null;
    for (const o of offers){
      const c = bestComparableCents(o);
      if (typeof c !== 'number') continue;
      if (best == null || c < best) best = c;
    }
    return best;
  }

  function couponCandidates(){
    const offers = Array.isArray(state.offers) ? state.offers : [];

    return offers
      .map(o => {
        const price = (typeof o.price_cents === 'number' && o.price_cents > 0) ? o.price_cents : null;
        const eff   = (typeof o.effective_price_cents === 'number' && o.effective_price_cents > 0) ? o.effective_price_cents : null;

        const hasCouponSignal =
          !!String(o?.coupon_text || '').trim() ||
          !!String(o?.coupon_code || '').trim() ||
          (o?.coupon_requires_clip === true);

        const text = couponSummary(o);

        const savings =
          (price != null && eff != null && eff > 0 && eff <= price) ? (price - eff) : null;

        return {
          ...o,
          _price: price,
          _eff: eff,
          _couponText: text,
          _hasCoupon: hasCouponSignal,
          _savings: savings
        };
      })
      // keep anything that has coupon signals OR a deterministic effective price
      .filter(o => o._hasCoupon || (o._eff != null));
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

  if (!list.length){
    card.hidden = true;
    return;
  }

  card.hidden = false;

  // Pick primary for the top summary
  const best = pickBestCoupon(list) || list[0];

  const store = titleCase(best.store || 'Retailer');
  const link  = best.url || canonicalLink(best.store, best) || '#';

  const priceCents = best._price;
  const effCents   = best._eff;

  const showEff =
    (effCents != null && priceCents != null && effCents > 0 && effCents <= priceCents);

  const saveEl = document.getElementById('cpSave');
  if (saveEl) saveEl.textContent = (best._savings != null) ? `Save ${moneyFromCents(best._savings)}` : '';

  const stEl = document.getElementById('cpStore');
  if (stEl) stEl.textContent = store;

  const effEl = document.getElementById('cpEffective');
  if (effEl) {
    effEl.textContent = showEff
      ? moneyFromCents(effCents)
      : (priceCents != null ? moneyFromCents(priceCents) : 'NA');
  }

  const regEl = document.getElementById('cpRegular');
  if (regEl) regEl.textContent = showEff ? `Regular ${moneyFromCents(priceCents)}` : '';

  const confEl = document.getElementById('cpConfidence');
  const ruleEl = document.getElementById('cpRule');

  const confidence =
    (showEff && best._savings != null) ? 'Verified price' :
    (String(best.coupon_text || '').trim() ? 'Promo noted' : '');

  setMaybe(confEl, confidence);

  const ruleBits = [];
  if (best.coupon_requires_clip === true) ruleBits.push('Clip coupon');
  if (String(best.coupon_code || '').trim()) ruleBits.push(`Code ${String(best.coupon_code).trim()}`);
  setMaybe(ruleEl, ruleBits.join(' • '));

  const linkEl = document.getElementById('cpLink');
  if (linkEl) linkEl.href = link;

  // ----------------------------
  // Build "more" list (deduped)
  // ----------------------------
  const seen = new Set();

  const more = (list || [])
    .filter(o => o !== best)
    .filter(o => {
      const k = [
        storeKey(o.store),
        String(o.coupon_text || '').trim().toLowerCase(),
        String(o.coupon_code || '').trim().toLowerCase(),
        o.coupon_requires_clip === true ? 'clip' : '',
        String(o._eff ?? ''),
        String(o._price ?? '')
      ].join('|');

      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a,b) => {
      const as = (a._savings != null) ? a._savings : -1;
      const bs = (b._savings != null) ? b._savings : -1;
      if (bs !== as) return bs - as;

      const ae = (a._eff != null) ? a._eff : Number.POSITIVE_INFINITY;
      const be = (b._eff != null) ? b._eff : Number.POSITIVE_INFINITY;
      if (ae !== be) return ae - be;

      const ap = (a._price != null) ? a._price : Number.POSITIVE_INFINITY;
      const bp = (b._price != null) ? b._price : Number.POSITIVE_INFINITY;
      return ap - bp;
    });

  const moreOuter = document.getElementById('cpMoreWrap');
  const moreWrap  = document.getElementById('cpMore');
  const moreLabel = document.getElementById('cpMoreLabel');

  if (!moreOuter || !moreWrap || !moreLabel) return;

  // If there are no additional options, hide the section
  if (!more.length){
    moreOuter.hidden = true;
    moreLabel.hidden = true;
    moreWrap.innerHTML = '';
    return;
  }

  moreOuter.hidden = false;
  moreLabel.hidden = false;
  moreLabel.textContent = `All coupon options (${1 + more.length})`;

  // Render best first, then the rest
  const all = [best, ...more];

  moreWrap.innerHTML = all.map(o => {
    const st = titleCase(o.store || 'Retailer');

    const pC = o._price;
    const eC = o._eff;

    const show = (eC != null && pC != null && eC > 0 && eC <= pC)
      ? moneyFromCents(eC)
      : (pC != null ? moneyFromCents(pC) : 'NA');

    const reg = (eC != null && pC != null && eC > 0 && eC <= pC)
      ? `Regular ${moneyFromCents(pC)}`
      : '';

    const t = (o._couponText || String(o.coupon_text || '').trim() || '').trim();
    const u = o.url || canonicalLink(o.store, o) || '';
    const badge = (o === best) ? `<span class="id-pill" style="margin-left:8px;">Best</span>` : '';

    return `
      <a class="coupon-mini" href="${u ? escapeHtml(u) : '#'}" target="_blank" rel="noopener"
         style="${u ? '' : 'pointer-events:none;'} text-decoration:none;color:inherit;">
        <div class="coupon-mini__left">
          <div class="coupon-mini__store">${escapeHtml(st)}${badge}</div>
          <div class="coupon-mini__text">${escapeHtml(t || 'Promo available')}</div>
          ${reg ? `<div class="coupon-mini__text" style="opacity:.75;">${escapeHtml(reg)}</div>` : ''}
        </div>
        <div class="coupon-mini__price">${escapeHtml(show)}</div>
      </a>
    `;
  }).join('');
}

  function couponSummary(o){
    const txt  = String(o?.coupon_text || '').trim();
    const clip = (o?.coupon_requires_clip === true) ? 'Clip coupon' : '';
    const code = String(o?.coupon_code || '').trim();

    // If there's no coupon_text, still surface code/clip as a real option
    if (!txt) {
      const bits = [clip, code ? `Code ${code}` : ''].filter(Boolean);
      return bits.join(' • '); // can be "Clip coupon", "Code BF50", or "Clip coupon • Code BF50"
    }

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
      const cents = bestComparableCents(o);
      const price = (typeof cents === 'number') ? cents/100 : null;
      return { ...o, _price: price, _price_cents: cents };
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
    syncSelectorsFromSelectedKey();
    renderVersionVariantColor();
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

async function copyText(text){
  const t = String(text || '').trim();
  if (!t) return false;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(t);
      return true;
    }
  } catch {}

  try {
    const ta = document.createElement('textarea');
    ta.value = t;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return !!ok;
  } catch {}

  return false;
}

function parseIdPillValue(raw){
  // "PCI NZQ8GS34" -> "NZQ8GS34", "UPC 0123..." -> digits, "ASIN B0..." -> asin
  const s = String(raw || '').trim();
  const m = s.match(/^(PCI|UPC|ASIN)\s+(.+)$/i);
  return (m ? String(m[2] || '').trim() : s);
}

function wireIdPillsCopy(){
  const host = document.getElementById('pIds');
  if (!host || host._pcCopyBound) return;
  host._pcCopyBound = true;

  async function handle(el){
    if (!el) return;
    const raw = el.getAttribute('data-copy') || el.textContent || '';
    const val = parseIdPillValue(raw);
    const ok = await copyText(val);

    if (!ok) return;

    // Useful feedback without changing styling: temporarily swap the text
    const original = el.textContent;
    el.textContent = 'Copied';
    clearTimeout(el._pcCopyT);
    el._pcCopyT = setTimeout(() => { el.textContent = original; }, 900);
  }

  host.addEventListener('click', (e) => {
    const el = e.target && e.target.closest ? e.target.closest('.id-pill.is-copy') : null;
    if (!el) return;
    handle(el);
  });

  host.addEventListener('keydown', (e) => {
    const el = e.target && e.target.classList && e.target.classList.contains('is-copy') ? e.target : null;
    if (!el) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handle(el);
    }
  });
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
    ['version', 'Model'],
    ['variant', 'Variant'],
    ['color', 'Color'],
    ['category', 'Category'],
    ['model_name', 'Name'],
  ];

    const varies = {};
    ['version','variant','color','category','model_name'].forEach(k=>{
      const vals = new Set(items.map(v => (String(v?.[k] || '').trim())));
      varies[k] = vals.size > 1;
    });

    let html = '<table><thead><tr>';
    cols.forEach(([,label]) => { html += `<th>${label}</th>`; });
    html += '</tr></thead><tbody>';

    items.forEach(v=>{
      html += '<tr>';
      // First column now is "Model" (version)
      const ver = String(v?.version || '').trim();
      html += `<td class="mono">${escapeHtml(ver || 'Default')}</td>`;

      // Then remaining columns in order
      ['variant','color','category','model_name'].forEach(k=>{
        const raw = String(v?.[k] || '').trim();
        const val = raw ? raw : (k === 'color' || k === 'variant' ? '—' : 'NA');
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

  window.run = run;

  window.addEventListener('popstate', () => {
    const raw = currentKeyFromUrl();
    if (raw) run(raw);
  });
})();