// public/dashboard/dashboard.js
(function(){
  const $  = (s, ctx=document)=>ctx.querySelector(s);
  const fmt = new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});

  const OFFER_EXTERNAL_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg"
        height="26" viewBox="0 -960 960 960" width="26"
        fill="#86868b" aria-hidden="true" focusable="false">
      <path d="m216-160-56-56 464-464H360v-80h400v400h-80v-264L216-160Z"/>
    </svg>
  `;

  const state = {
    identity:null,
    variants:[],
    offers:[],
    history:[],
    historyStats: null,
    similar:[],
    lineup: null,
    selectedTimelineIndex: -1,
    rangeDays: 30,
    selectedVariantKey:null,
    lastKey:null,
    dimUnit: 'imperial',
    selectedFileIndex: -1
  };

    // Store-name overrides loaded from /public/data/name_overrides.json
  const STORE_NAME_OVERRIDES = Object.create(null);
  let STORE_OVERRIDES_LOADED = false;

  async function loadNameOverridesOnce(){
    if (STORE_OVERRIDES_LOADED) return;
    STORE_OVERRIDES_LOADED = true;

    try {
      const res = await fetch('/data/name_overrides.json', { headers: { 'Accept': 'application/json' } });
      if (!res.ok) return;
      const json = await res.json();

      const map = json && typeof json === 'object' ? json.store_names : null;
      if (!map || typeof map !== 'object') return;

      for (const [k, v] of Object.entries(map)) {
        const key = String(k || '').trim().toLowerCase();
        const val = String(v || '').trim();
        if (!key || !val) continue;
        STORE_NAME_OVERRIDES[key] = val;
      }
    } catch {
      // Silent fallback: keep local title-casing behavior if JSON can't load.
    }
  }

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

    // Use centralized overrides if available
    if (STORE_NAME_OVERRIDES[key]) return STORE_NAME_OVERRIDES[key];

    // If already mixed case, do not mangle it
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

const variant2Card = $('#variant2Card');
const variant2Pills = $('#variant2Pills');
const colorCard = $('#colorCard');
const colorPills = $('#colorPills');
const dimCard = document.getElementById('dim');
const dimToggle = document.getElementById('dimToggle');
const dimContent = document.getElementById('dimContent');
const filesCard = document.getElementById('files');
const filesContent = document.getElementById('filesContent');
const mediaCard = document.getElementById('mediaCard');
const lineupCard = document.getElementById('lineup');
const lineupContent = document.getElementById('lineupContent');
const securityIdsEl = document.getElementById('securityIds');

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

function imageOf(v){
  const raw = String(
    v?.image_url ||
    state.identity?.image_url ||
    '/logo/default.webp'
  ).trim();

  return raw || '/logo/default.webp';
}

function variantChoicesForVersion(list, version){
  const wantV = normLower(version || 'Default');
  const seen = new Set();
  const out = [];

  for (const v of list){
    if (normLower(versionOf(v)) !== wantV) continue;

    const label = normalizeSpaces(variantOf(v));
    if (!label) continue;

    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      label,
      image: imageOf(v)
    });
  }

  out.sort((a, b) => smartOptionCompare(a.label, b.label));
  return out;
}

function colorChoicesForVersionVariant(list, version, variant){
  const wantV = normLower(version || 'Default');
  const wantVar = normLower(variant || '');
  const seen = new Set();
  const out = [];

  for (const v of list){
    if (normLower(versionOf(v)) !== wantV) continue;

    const vv = variantOf(v);
    if (wantVar && normLower(vv) !== wantVar) continue;

    const label = normalizeSpaces(colorOf(v));
    if (!label) continue;

    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      label,
      image: imageOf(v)
    });
  }

  out.sort((a, b) => smartOptionCompare(a.label, b.label));
  return out;
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

function renderImageChoiceGroup(hostEl, options, selectedValue, onPick, typeLabel){
  if (!hostEl) return;

  hostEl.innerHTML = '';

  for (const opt of options){
    const label = normalizeSpaces(opt?.label);
    if (!label) continue;

    const image = String(opt?.image || '').trim() || '/logo/default.webp';

    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'media-choice' + (normLower(label) === normLower(selectedValue) ? ' is-active' : '');
    b.setAttribute('aria-label', `${typeLabel} ${label}`);

    b.innerHTML = `
      <span class="media-choice__thumb">
        <img
          src="${escapeHtml(image)}"
          alt="${escapeHtml(label)}"
          loading="lazy"
          decoding="async"
        >
      </span>
      <span class="media-choice__label">${escapeHtml(label)}</span>
    `;

    b.addEventListener('click', () => {
      onPick(label);
    });

    const img = b.querySelector('img');
    if (img) {
      img.addEventListener('error', () => {
        img.src = '/logo/default.webp';
      }, { once: true });
    }

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
  const currentVersion = String(state.selectedVersion || '').trim();

  if (!versions.some(v => normLower(v) === normLower(currentVersion))) {
    state.selectedVersion = versions[0] || 'Default';
  }

  // ----------------
  // Variant cards with image
  // ----------------
  const variantChoices = variantChoicesForVersion(list, state.selectedVersion);

  if (variant2Card && variant2Pills){
  if (variantChoices.length >= 2) {
    let desiredVar = state.selectedVariant2;
    if (desiredVar && !variantChoices.some(x => normLower(x.label) === normLower(desiredVar))) {
      desiredVar = null;
    }
    if (!desiredVar) desiredVar = variantChoices[0].label;

    state.selectedVariant2 = desiredVar;

    const visibleVariantChoices = variantChoices.filter(
      x => normLower(x.label) !== normLower(state.selectedVariant2)
    );

    if (visibleVariantChoices.length) {
      variant2Card.hidden = false;

      renderImageChoiceGroup(
        variant2Pills,
        visibleVariantChoices,
        null,
        (picked) => {
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
        },
        'Variant'
      );
    } else {
      variant2Card.hidden = true;
      variant2Pills.innerHTML = '';
    }
  } else {
    variant2Card.hidden = true;
    variant2Pills.innerHTML = '';
    state.selectedVariant2 = variantChoices[0]?.label || null;
  }
} else {
  state.selectedVariant2 = state.selectedVariant2 || (variantChoices[0]?.label || null);
}

  // ----------------
  // Color cards with image
  // ----------------
  const colorChoices = colorChoicesForVersionVariant(
    list,
    state.selectedVersion,
    state.selectedVariant2
  );

  if (colorCard && colorPills){
  if (colorChoices.length >= 2) {
    let desiredC = state.selectedColor;
    if (desiredC && !colorChoices.some(x => normLower(x.label) === normLower(desiredC))) {
      desiredC = null;
    }
    if (!desiredC) desiredC = colorChoices[0].label;

    state.selectedColor = desiredC;

    const visibleColorChoices = colorChoices.filter(
      x => normLower(x.label) !== normLower(state.selectedColor)
    );

    if (visibleColorChoices.length) {
      colorCard.hidden = false;

      renderImageChoiceGroup(
        colorPills,
        visibleColorChoices,
        null,
        (picked) => {
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
        },
        'Color'
      );
    } else {
      colorCard.hidden = true;
      colorPills.innerHTML = '';
    }
  } else {
    colorCard.hidden = true;
    if (colorPills) colorPills.innerHTML = '';
    state.selectedColor = colorChoices[0]?.label || null;
  }
} else {
  state.selectedColor = state.selectedColor || (colorChoices[0]?.label || null);
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

function wireCardIcons(){
  const ns = 'http://www.w3.org/2000/svg';

  document.querySelectorAll('h2[data-icon-path]').forEach(h2 => {
    if (h2.querySelector('.pc-h2-icon')) return;

    const pathData = String(h2.getAttribute('data-icon-path') || '').trim();
    if (!pathData) return;

    h2.classList.add('pc-h2-with-icon');

    const icon = document.createElement('span');
    icon.className = 'pc-h2-icon';
    icon.setAttribute('aria-hidden', 'true');

    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 -960 960 960');
    svg.setAttribute('focusable', 'false');

    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', pathData);

    svg.appendChild(path);
    icon.appendChild(svg);

    h2.prepend(icon);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  wireCardIcons();
  wireIdPillsCopy();
  await loadNameOverridesOnce();

  const key = currentKeyFromUrl() || "";
  if (!key.trim()) {
    document.getElementById("pTitle").textContent = "Search a product to view the dashboard.";
    return;
  }
  run(key);
});

document.querySelectorAll('#historyToggle .dim-unit-btn[data-range]').forEach(btn => {
  btn.addEventListener('click', () => {
    const n = parseInt(btn.getAttribute('data-range'), 10);
    if (!Number.isFinite(n)) return;
    state.rangeDays = n;

    document.querySelectorAll('#historyToggle .dim-unit-btn[data-range]').forEach(b => {
      b.classList.remove('is-active');
    });
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
      state.similar = Array.isArray(data.similar) ? data.similar : [];
      state.lineup = (data.lineup && typeof data.lineup === 'object') ? data.lineup : null;
      state.selectedLineupFamily = String(data?.lineup?.current_family?.model_number || '').trim() || null;
      state.selectedFileIndex = -1;
      state.selectedTimelineIndex = -1; 

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
      renderTimeline();
      renderVariants();
      renderDimensions();
      renderSidebarSpecs();
      renderMediaPanel();
      renderFilesCard();
      renderForensics();
      renderLineup();
      renderSimilarProducts();
    }catch(err){
      console.error(err);
      showMessage('Network error. Check console.');
    }
  }

  // ---------- UI ----------
  function showMessage(msg){
    $('#pTitle').textContent = msg;
    $('#pIds').textContent = '';
    $('#pIds').hidden = true;
    const brandRow = $('#pBrandRow');
    const brandLine = $('#pBrandLine');
    if (securityIdsEl) {
      securityIdsEl.hidden = true;
      securityIdsEl.innerHTML = '';
    }
    if (brandRow) brandRow.hidden = true;
    if (brandLine) brandLine.textContent = '';
    $('#offers').innerHTML = '';
    $('#offersNote').textContent = '';
    $('#kCurrent').textContent = 'NA';
    $('#kStore').textContent = '';
    $('#kTypical').textContent = 'NA';
    $('#kLow30').textContent = 'NA';
    $('#kLow30Date').textContent = '';
    $('#kIntegrity').textContent = 'NA';
    const specsContent = document.getElementById('specsContent');
    if (specsContent) specsContent.innerHTML = '<div class="sidebar-empty">Coming Soon</div>';
    if (mediaCard) mediaCard.hidden = true;
    const mediaContent = document.getElementById('mediaContent');
    if (mediaContent) {
      mediaContent.innerHTML = '';
    }
    const timelineCard = document.getElementById('year');
    const timelineContent = document.getElementById('timelineContent');
    const timelineSummary = document.getElementById('timelineSummary');
    if (timelineCard) timelineCard.hidden = true;
    if (timelineContent) timelineContent.innerHTML = '';
    if (timelineSummary) {
      timelineSummary.hidden = true;
      timelineSummary.textContent = '';
    }
    $('#forensicsList').innerHTML = '';
    $('#chart').innerHTML = '';
    $('#chartNote').textContent = 'No history yet';
    if (variant2Card) variant2Card.hidden = true;
    if (variant2Pills) variant2Pills.innerHTML = '';
    if (colorCard) colorCard.hidden = true;
    if (colorPills) colorPills.innerHTML = '';

    state.similar = [];
    const similarPanel = document.getElementById('panelSimilar');
    if (similarPanel) {
      similarPanel.innerHTML = '<div class="sidebar-empty">No similar products found.</div>';
    }
    if (dimCard) dimCard.hidden = true;
    if (dimToggle) dimToggle.innerHTML = '';
    if (dimContent) dimContent.innerHTML = '';
    if (filesCard) filesCard.hidden = true;
    if (filesContent) filesContent.innerHTML = '';
    if (lineupCard) lineupCard.hidden = true;
    if (lineupContent) lineupContent.innerHTML = '';
    state.selectedFileIndex = -1;
    state.selectedTimelineIndex = -1;
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

    // Title: prefer offer title, otherwise catalog model_name, otherwise fallback
    let title = null;

    if (!title) title =
    (id.model_name && String(id.model_name).trim()) ||
    (cur && cur.model_name && String(cur.model_name).trim()) ||
      (id.model_number && String(id.model_number).trim()) ||
      'Product';

    $('#pTitle').textContent = title;

        const selPci = id.selected_pci ? String(id.selected_pci).trim() : '';
    const selUpc = id.selected_upc ? cleanUpc(id.selected_upc) : '';
    const selAsin = id.asin ? up(id.asin) : '';

    const pIdsEl = $('#pIds');
    const selColor = normalizeSpaces(colorOf(cur));
    const selVariant = normalizeSpaces(variantOf(cur));

    const selectedBits = [];
    if (selColor) selectedBits.push(selColor);
    if (selVariant) selectedBits.push(selVariant);

    if (pIdsEl) {
      pIdsEl.innerHTML = selectedBits
        .map(v => `<span class="id-pill">${escapeHtml(v)}</span>`)
        .join('');
      pIdsEl.hidden = selectedBits.length === 0;
    }

    if (securityIdsEl) {
      const securityBits = [];
      if (selPci) securityBits.push(`<span class="id-pill is-copy" data-copy="PCI ${escapeHtml(selPci)}" role="button" tabindex="0">PCI ${escapeHtml(selPci)}</span>`);
      if (selUpc) securityBits.push(`<span class="id-pill is-copy" data-copy="UPC ${escapeHtml(selUpc)}" role="button" tabindex="0">UPC ${escapeHtml(selUpc)}</span>`);
      if (selAsin) securityBits.push(`<span class="id-pill is-copy" data-copy="ASIN ${escapeHtml(selAsin)}" role="button" tabindex="0">ASIN ${escapeHtml(selAsin)}</span>`);
      securityIdsEl.innerHTML = securityBits.join('');
      securityIdsEl.hidden = securityBits.length === 0;
    }

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

    const brandRow = document.getElementById('pBrandRow');
    const brandLine = document.getElementById('pBrandLine');

    if (brandRow) brandRow.hidden = !brand;
    if (brandLine) brandLine.textContent = brand || '';
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

  function normalizeTimelineInput(raw){
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object' && Array.isArray(raw.items)) return raw.items;
    return [];
  }

  function timelineSource(){
    const cur = getCurrentVariant() || null;

    if (Array.isArray(cur?.timeline)) return cur.timeline;
    if (cur?.timeline && typeof cur.timeline === 'object' && Array.isArray(cur.timeline.items)) {
      return cur.timeline.items;
    }

    if (Array.isArray(state.identity?.timeline)) return state.identity.timeline;
    if (state.identity?.timeline && typeof state.identity.timeline === 'object' && Array.isArray(state.identity.timeline.items)) {
      return state.identity.timeline.items;
    }

    return [];
  }

  function parseTimelineItem(input){
    if (!input || typeof input !== 'object') return null;

    const title = String(input.title || input.label || input.name || '').trim();
    const note = String(input.note || input.subtitle || input.description || '').trim();
    const kind = String(input.kind || input.type || '').trim();
    const rawDate = String(input.date || input.when || input.release_date || input.expected_date || '').trim();
    const rawYear = Number(input.year);

    const rawUrl = String(input.url || '').trim();
    const rawKey = String(input.key || '').trim();
    const rawPci = String(input.pci || '').trim();

    let stamp = null;
    let dateLabel = '';

    if (rawDate) {
      const d = new Date(rawDate);
      if (!Number.isNaN(d.getTime())) {
        stamp = d.getTime();
        dateLabel = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(d);
      } else if (/^\d{4}$/.test(rawDate)) {
        stamp = Date.UTC(Number(rawDate), 0, 1);
        dateLabel = rawDate;
      }
    } else if (Number.isFinite(rawYear) && rawYear >= 1900 && rawYear <= 3000) {
      stamp = Date.UTC(rawYear, 0, 1);
      dateLabel = String(rawYear);
    }

    if (!title) return null;

    const explicitFuture =
      input.future === true ||
      /^(upcoming|future|expected)$/i.test(String(input.group || input.phase || ''));

    let future = explicitFuture;

    if (!future && stamp != null) {
      const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(rawDate);
      if (isDateOnly) {
        const now = new Date();
        const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
        future = stamp >= todayUtc;
      } else {
        future = stamp > Date.now();
      }
    }

    let href = '';

    if (rawUrl) {
      href = rawUrl;
    } else if (rawKey) {
      const normalizedKey = normalizeKey(rawKey);
      if (normalizedKey) href = prettyDashboardUrl(normalizedKey, title).pathname;
    } else if (rawPci && isLikelyPci(rawPci)) {
      href = prettyDashboardUrl(`pci:${rawPci.toUpperCase()}`, title).pathname;
    }

    return {
      title,
      note,
      kind,
      dateLabel,
      stamp,
      future,
      href
    };
  }

    function cleanTimelineKind(raw, future){
    const k = String(raw || '').trim();
    if (!k) return '';

    const low = k.toLowerCase();

    // Hide generic labels that add no value or repeat what the layout already says.
    if ([
      'upcoming',
      'expected',
      'future',
      'past',
      'timeline',
      'release',
      'released'
    ].includes(low)) {
      return '';
    }

    return titleCase(k);
  }

  function timelineYearLabel(item){
    const stamp = Number(item?.stamp);
    if (Number.isFinite(stamp)) {
      return String(new Date(stamp).getUTCFullYear());
    }

    const label = String(item?.dateLabel || '').trim();
    if (/^\d{4}$/.test(label)) return label;

    const m = label.match(/\b(19|20|21)\d{2}\b/);
    return m ? m[0] : '';
  }

  function decorateTimelineItem(item, index){
    if (!item || typeof item !== 'object') return null;

    const title = String(item.title || '').trim();
    if (!title) return null;

    const dateLabel = String(item.dateLabel || '').trim();
    const yearLabel = timelineYearLabel(item);
    const kindLabel = cleanTimelineKind(item.kind, item.future === true);

    return {
      ...item,
      _index: index,
      title,
      dateLabel,
      yearLabel,
      kindLabel,
      shortLabel: dateLabel || yearLabel || 'Event'
    };
  }

  function dedupeTimelineItems(items){
    const seen = new Set();
    const out = [];

    for (const item of items){
      const sig = [
        String(item?.title || '').trim().toLowerCase(),
        String(item?.dateLabel || '').trim().toLowerCase(),
        item?.future ? '1' : '0',
        String(item?.href || '').trim().toLowerCase()
      ].join('|');

      if (!sig) continue;
      if (seen.has(sig)) continue;

      seen.add(sig);
      out.push(item);
    }

    return out;
  }

  function sortTimelineItems(items){
    return items.slice().sort((a, b) => {
      const ta = Number.isFinite(Number(a?.stamp))
        ? Number(a.stamp)
        : (a?.future ? Number.MAX_SAFE_INTEGER : 0);

      const tb = Number.isFinite(Number(b?.stamp))
        ? Number(b.stamp)
        : (b?.future ? Number.MAX_SAFE_INTEGER : 0);

      if (ta !== tb) return ta - tb;
      return String(a?.title || '').localeCompare(String(b?.title || ''));
    });
  }

    function dashboardKeyFromHref(href){
    const raw = String(href || '').trim();
    if (!raw) return null;

    try {
      const u = new URL(raw, location.origin);
      const parts = u.pathname.split('/').filter(Boolean);

      if (parts[0] !== 'dashboard') return null;

      // /dashboard/:kind/:value/
      if (parts.length >= 3 && isAllowedKind(parts[1])) {
        return normalizeKey(`${parts[1]}:${decodeURIComponent(parts[2] || '')}`);
      }

      // /dashboard/:slug/:kind/:value/
      if (parts.length >= 4 && isAllowedKind(parts[2])) {
        return normalizeKey(`${parts[2]}:${decodeURIComponent(parts[3] || '')}`);
      }
    } catch {}

    return null;
  }

  function timelineThreeSlots(items){
    const currentKey = normalizeKey(state.lastKey || '');
    const released = items.filter(item => !item.future);
    const upcoming = items.filter(item => item.future);

    let current = null;
    let past = null;
    let future = null;

    // Best case: one timeline item explicitly matches the current page
    if (currentKey) {
      current = items.find(item => dashboardKeyFromHref(item.href) === currentKey) || null;
    }

    // If current was found, use the most recent earlier released item as "Previous"
    if (current) {
      const earlier = released.filter(item => item !== current);
      past = earlier.length ? earlier[earlier.length - 1] : null;
    } else if (released.length) {
      // Fallback: treat the latest released item as the current model
      current = released[released.length - 1];
      past = released.length > 1 ? released[released.length - 2] : null;
    }

    // Earliest future item becomes "Next"
    future = upcoming.find(item => item !== current) || null;

    // Hard fallback if the source only has future data
    if (!current) {
      const cur = getCurrentVariant() || null;
      const id = state.identity || {};
      const title =
        String(
          cur?.model_name ||
          id.model_name ||
          id.model_number ||
          document.getElementById('pTitle')?.textContent ||
          'Current model'
        ).trim() || 'Current model';

      current = {
        title,
        note: '',
        dateLabel: '',
        yearLabel: '',
        kindLabel: '',
        href: currentKey ? prettyDashboardUrl(currentKey, title).pathname : ''
      };
    }

    return { past, current, future };
  }

  function renderTimelineBubble(item, slot){
    const label =
      slot === 'past'
        ? 'Previous'
        : slot === 'future'
          ? 'Next'
          : 'Current';

    const fallbackTitle =
      slot === 'past'
        ? 'No earlier model tracked'
        : slot === 'future'
          ? 'No next model tracked'
          : 'Current model';

    const title = String(item?.title || '').trim() || fallbackTitle;

    const metaBits = [];
    if (item?.dateLabel) metaBits.push(String(item.dateLabel).trim());
    if (item?.kindLabel && slot !== 'current') metaBits.push(String(item.kindLabel).trim());

    return `
      <section class="pc-timeline-callout pc-timeline-callout--${slot}${item ? '' : ' is-empty'}">
        <div class="pc-timeline-callout__eyebrow">${label}</div>

        <div class="pc-timeline-callout__title">${escapeHtml(title)}</div>

        ${
          metaBits.length
            ? `<div class="pc-timeline-callout__meta">${escapeHtml(metaBits.join(' • '))}</div>`
            : ''
        }

        ${
          item?.note
            ? `<div class="pc-timeline-callout__note">${escapeHtml(item.note)}</div>`
            : ''
        }

        ${
          item?.href && slot !== 'current'
            ? `<a class="pc-timeline-callout__link" href="${escapeHtml(item.href)}">View product</a>`
            : ''
        }
      </section>
    `;
  }

  function renderTimeline(){
    const card = document.getElementById('year');
    const host = document.getElementById('timelineContent');
    const summary = document.getElementById('timelineSummary');

    if (!card || !host) return;

    const items = sortTimelineItems(
      dedupeTimelineItems(
        normalizeTimelineInput(timelineSource())
          .map(parseTimelineItem)
          .filter(Boolean)
          .map((item, index) => decorateTimelineItem(item, index))
          .filter(Boolean)
      )
    );

    if (!items.length) {
      card.hidden = true;
      host.innerHTML = '';

      if (summary) {
        summary.hidden = true;
        summary.textContent = '';
      }
      return;
    }

    const slots = timelineThreeSlots(items);

    card.hidden = false;

    if (summary) {
      summary.hidden = true;
      summary.textContent = '';
    }

    host.innerHTML = `
      <div class="pc-timeline-simple">
        <div class="pc-timeline-simple__top">
          ${renderTimelineBubble(slots.past, 'past')}
          ${renderTimelineBubble(slots.future, 'future')}
        </div>

        <div class="pc-timeline-simple__track" aria-hidden="true">
          <span class="pc-timeline-simple__line"></span>
          <span class="pc-timeline-simple__dot pc-timeline-simple__dot--past"></span>
          <span class="pc-timeline-simple__dot pc-timeline-simple__dot--current"></span>
          <span class="pc-timeline-simple__dot pc-timeline-simple__dot--future"></span>
        </div>

        <div class="pc-timeline-simple__bottom">
          ${renderTimelineBubble(slots.current, 'current')}
        </div>
      </div>
    `;
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
      note.textContent = '';
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

      const priceText = (o._price != null) ? `${fmt.format(o._price)}` : 'No price';

      row.innerHTML = `
        <div>
          <div class="offer-store">${titleCase(o.store || '')}</div>
        </div>

        <div class="muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size: 18px;">
          ${tag ? escapeHtml(tag) : ''}
        </div>

        <div class="offer-right">
          <div class="muted-price offer-price">${escapeHtml(priceText)}</div>
          ${
            bestLink
              ? `<a class="btn btn-go offer-go" href="${bestLink}" target="_blank" rel="noopener" aria-label="Open offer">${OFFER_EXTERNAL_SVG}</a>`
              : `<span class="btn btn-go offer-go is-disabled" aria-hidden="true">${OFFER_EXTERNAL_SVG}</span>`
          }
        </div>
      `;

      wrap.appendChild(row);
    });

    note.textContent = 'PriceCheck does not use affiliate or sponsored links.';
  }

 function renderSimilarProducts(){
  const panel = document.getElementById('panelSimilar');
  const fallback = document.getElementById('similarContent');
  const host = panel || fallback;
  if (!host) return;

  const items = Array.isArray(state.similar) ? state.similar : [];

  if (!items.length) {
    if (panel) {
      panel.innerHTML = `<div class="sidebar-empty">No similar products found.</div>`;
    } else {
      host.innerHTML = 'No similar products found.';
    }
    return;
  }

  const html = `
    <div class="pc-similar-list">
      ${items.map((p) => {
        const key = String(p?.dashboard_key || '').trim();
        const title = String(p?.model_name || 'Product').trim() || 'Product';
        const href = key ? prettyDashboardUrl(key, title).pathname : '/dashboard/';
        const brand = titleCase(p?.brand || '');
        const category = titleCase(p?.category || '');
        const price = (typeof p?.best_price_cents === 'number' && p.best_price_cents > 0)
          ? fmt.format(p.best_price_cents / 100)
          : 'NA';
        const img = String(p?.image_url || '').trim() || '/logo/default.webp';

        return `
          <a class="pc-similar-item" href="${escapeHtml(href)}">
            <div class="pc-similar-thumb-wrap">
              <img
                class="pc-similar-thumb"
                src="${escapeHtml(img)}"
                alt=""
                loading="lazy"
                decoding="async"
              >
              <div class="pc-similar-price">${escapeHtml(price)}</div>
            </div>

            <div class="pc-similar-main">
              <div class="pc-similar-brand muted">${escapeHtml(brand)}</div>
              <div class="pc-similar-title">${escapeHtml(title)}</div>
              <div class="pc-similar-category muted">${escapeHtml(category)}</div>
            </div>
          </a>
        `;
      }).join('')}
    </div>
  `;

  if (panel) {
    panel.innerHTML = html;
  } else {
    host.innerHTML = html;
  }
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
  const hosts = [
    document.getElementById('pIds'),
    document.getElementById('securityIds')
  ].filter(Boolean);

  if (!hosts.length) return;

  async function handle(el){
    if (!el) return;

    const raw = el.getAttribute('data-copy') || el.textContent || '';
    const val = parseIdPillValue(raw);
    const ok = await copyText(val);

    if (!ok) return;

    const original = el.textContent;
    el.textContent = 'Copied';
    clearTimeout(el._pcCopyT);
    el._pcCopyT = setTimeout(() => {
      el.textContent = original;
    }, 900);
  }

  hosts.forEach(host => {
    if (host._pcCopyBound) return;
    host._pcCopyBound = true;

    host.addEventListener('click', (e) => {
      const el = e.target && e.target.closest ? e.target.closest('.id-pill.is-copy') : null;
      if (!el) return;
      handle(el);
    });

    host.addEventListener('keydown', (e) => {
      const el = e.target && e.target.closest ? e.target.closest('.id-pill.is-copy') : null;
      if (!el) return;

      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handle(el);
      }
    });
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

    function specValueToText(v){
    if (v == null) return '';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') return v.trim();
    return String(v).trim();
  }

  function flattenSpecsRows(obj, prefix = ''){
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];

    const rows = [];

    for (const [rawKey, rawVal] of Object.entries(obj)) {
      const key = String(rawKey || '').trim();
      if (!key) continue;

      const label = prefix ? `${prefix} • ${key}` : key;

      if (rawVal == null) continue;

      if (Array.isArray(rawVal)) {
        const joined = rawVal
          .map(specValueToText)
          .filter(Boolean)
          .join(', ');
        if (joined) rows.push([label, joined]);
        continue;
      }

      if (typeof rawVal === 'object') {
        rows.push(...flattenSpecsRows(rawVal, label));
        continue;
      }

      const text = specValueToText(rawVal);
      if (!text) continue;

      rows.push([label, text]);
    }

    return rows;
  }

  function renderSidebarSpecs(){
  const host = document.getElementById('specsContent');
  if (!host) return;

  const cur = getCurrentVariant() || null;

  const specs =
    (cur?.specs && typeof cur.specs === 'object' && !Array.isArray(cur.specs))
      ? cur.specs
      : (
          state.identity?.specs &&
          typeof state.identity.specs === 'object' &&
          !Array.isArray(state.identity.specs)
        )
        ? state.identity.specs
        : null;

  let rows = flattenSpecsRows(specs)
    .filter(([label, value]) => String(label || '').trim() && String(value || '').trim());

  if (!rows.length) {
    host.innerHTML = '<div class="sidebar-empty">Coming Soon</div>';
    return;
  }

  // Put the most useful buying specs first
  const priority = [
    'motor',
    'range',
    'battery',
    'top speed',
    'wheel size',
    'water resistance'
  ];

  rows.sort((a, b) => {
    const aKey = String(a[0] || '').trim().toLowerCase();
    const bKey = String(b[0] || '').trim().toLowerCase();

    const aIdx = priority.indexOf(aKey);
    const bIdx = priority.indexOf(bKey);

    const aRank = aIdx === -1 ? 999 : aIdx;
    const bRank = bIdx === -1 ? 999 : bIdx;

    if (aRank !== bRank) return aRank - bRank;
    return aKey.localeCompare(bKey);
  });

  host.innerHTML = `
    <div class="pc-specs-grid">
      ${rows.map(([label, value]) => `
        <div class="pc-spec-tile">
          <div class="pc-spec-tile__label">${escapeHtml(label)}</div>
          <div class="pc-spec-tile__value">${escapeHtml(value)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

  function normalizeMediaInput(raw){
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray(raw.items)) return raw.items;
  return [];
}

function safeUrl(raw){
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    return new URL(s);
  } catch {
    return null;
  }
}

function parseMediaItem(input){
  const obj = (typeof input === 'string')
    ? { url: input }
    : (input && typeof input === 'object' ? input : null);

  if (!obj) return null;

  const rawUrl = String(obj.url || '').trim();
  if (!rawUrl) return null;

  const url = safeUrl(rawUrl);
  if (!url) return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = url.pathname || '';

  let provider = 'Media';
  let kind = 'Media';
  let embedUrl = null;
  let frameClass = 'pc-media-frame pc-media-frame--wide';

  // YouTube
  if (host === 'youtu.be' || host.endsWith('youtube.com')) {
    provider = 'YouTube';
    kind = 'Video';
    frameClass = 'pc-media-frame pc-media-frame--wide';

    let videoId = '';

    if (host === 'youtu.be') {
      videoId = path.split('/').filter(Boolean)[0] || '';
    } else if (path === '/watch') {
      videoId = url.searchParams.get('v') || '';
    } else {
      const parts = path.split('/').filter(Boolean);
      if (parts[0] === 'shorts' && parts[1]) videoId = parts[1];
      else if (parts[0] === 'embed' && parts[1]) videoId = parts[1];
    }

    if (videoId) {
      embedUrl = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`;
    }
  }

  // TikTok
  else if (host.endsWith('tiktok.com')) {
    provider = 'TikTok';
    kind = 'Post';
    frameClass = 'pc-media-frame pc-media-frame--vertical';

    const m = path.match(/\/video\/(\d+)/i);
    if (m && m[1]) {
      embedUrl = `https://www.tiktok.com/player/v1/${m[1]}`;
    }
  }

  // Instagram
  else if (host.endsWith('instagram.com')) {
    const m = path.match(/^\/(reel|p)\/([^/?#]+)/i);
    if (m) {
      provider = 'Instagram';
      kind = m[1].toLowerCase() === 'reel' ? 'Reel' : 'Post';
      frameClass = 'pc-media-frame pc-media-frame--vertical';
      embedUrl = `https://www.instagram.com/${m[1]}/${m[2]}/embed`;
    }
  }

  const customTitle = String(obj.title || '').trim();
  const title =
    customTitle ||
    (
      provider === 'YouTube' ? 'Video' :
      (provider === 'TikTok' || provider === 'Instagram') ? 'Post' :
      'Media'
    );

  return {
    url: rawUrl,
    provider,
    kind,
    title,
    embedUrl,
    frameClass
  };
}

function renderMediaPanel(){
  const card = mediaCard;
  const panel = document.getElementById('mediaContent');
  if (!card || !panel) return;

  const cur = getCurrentVariant() || null;

  let rawMedia = null;

  if (Array.isArray(cur?.media)) rawMedia = cur.media;
  else if (Array.isArray(state.identity?.media)) rawMedia = state.identity.media;
  else if (cur?.media && typeof cur.media === 'object' && Array.isArray(cur.media.items)) rawMedia = cur.media;
  else if (state.identity?.media && typeof state.identity.media === 'object' && Array.isArray(state.identity.media.items)) rawMedia = state.identity.media;

  const items = normalizeMediaInput(rawMedia)
    .map((item) => parseMediaItem(item))
    .filter(Boolean);

  if (!items.length) {
    card.hidden = true;
    panel.innerHTML = '';
    return;
  }

  card.hidden = false;

  const videos = items.filter(item => item.kind === 'Video');
  const posts = items.filter(item => item.kind !== 'Video');

  function renderCard(item){
    return `
      <article class="pc-media-card${item.frameClass.includes('vertical') ? ' pc-media-card--post' : ' pc-media-card--video'}">
        <div class="pc-media-card__head">
          <div class="pc-media-card__title">${escapeHtml(item.title)}</div>
        </div>

        ${
          item.embedUrl
            ? `
              <div class="${escapeHtml(item.frameClass)}">
                <iframe
                  src="${escapeHtml(item.embedUrl)}"
                  title="${escapeHtml(item.title)}"
                  loading="lazy"
                  referrerpolicy="strict-origin-when-cross-origin"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowfullscreen
                ></iframe>
              </div>
            `
            : `
              <div class="pc-media-fallback">
                <div class="pc-media-fallback__text">Embed preview is not available for this link.</div>
              </div>
            `
        }
      </article>
    `;
  }

  panel.innerHTML = `
    <div class="pc-media-stack">
      ${videos.length ? `<div class="pc-media-grid pc-media-grid--videos">${videos.map(renderCard).join('')}</div>` : ''}
      ${posts.length ? `<div class="pc-media-grid pc-media-grid--posts">${posts.map(renderCard).join('')}</div>` : ''}
    </div>
  `;
}

function normalizeFilesInput(raw){
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray(raw.items)) return raw.items;
  return [];
}

function filesSource(){
  const cur = getCurrentVariant() || null;

  if (Array.isArray(cur?.files)) return cur.files;
  if (cur?.files && typeof cur.files === 'object' && Array.isArray(cur.files.items)) return cur.files;

  if (Array.isArray(state.identity?.files)) return state.identity.files;
  if (state.identity?.files && typeof state.identity.files === 'object' && Array.isArray(state.identity.files.items)) return state.identity.files;

  return [];
}

function hostedFileHref(raw){
  const s = String(raw || '').trim();
  if (!s) return '';

  try {
    const u = new URL(s, location.origin);
    if (u.origin !== location.origin) return '';
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return '';
  }
}

function inferFileFormat(href, explicitFormat){
  const forced = String(explicitFormat || '').trim();
  if (forced) return forced.toUpperCase();

  const clean = String(href || '').split('#')[0].split('?')[0];
  const ext = clean.includes('.') ? clean.split('.').pop().toLowerCase() : '';

  if (!ext) return 'FILE';
  if (ext === 'pdf') return 'PDF';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext)) return ext.toUpperCase();
  if (ext === 'txt') return 'TXT';
  if (['doc', 'docx'].includes(ext)) return ext.toUpperCase();
  if (['xls', 'xlsx', 'csv'].includes(ext)) return ext.toUpperCase();
  if (['zip', 'rar', '7z'].includes(ext)) return ext.toUpperCase();

  return ext.toUpperCase();
}

function parseFileItem(input, index){
  const obj = (input && typeof input === 'object' && !Array.isArray(input)) ? input : null;
  if (!obj) return null;

  const href = hostedFileHref(obj.path || obj.url || obj.href || '');
  if (!href) return null;

  const title = String(obj.title || obj.label || `File ${index + 1}`).trim();
  const type = String(obj.type || 'File').trim();
  const format = inferFileFormat(href, obj.format);
  const summary = String(obj.summary || obj.description || '').trim();
  const sizeLabel = String(obj.size_label || obj.size || '').trim();
  const updatedAt = String(obj.updated_at || obj.updated || '').trim();
  const downloadName = String(obj.download_name || obj.filename || '').trim();

  return {
    title: title || `File ${index + 1}`,
    type: type || 'File',
    format,
    href,
    summary,
    sizeLabel,
    updatedAt,
    downloadName,
    featured: obj.featured === true
  };
}

function isPdfFile(item){
  return String(item?.format || '').toUpperCase() === 'PDF' || /\.pdf(?:$|[?#])/i.test(String(item?.href || ''));
}

function isImageFile(item){
  return /\.(png|jpe?g|webp|gif|svg)(?:$|[?#])/i.test(String(item?.href || ''));
}

function renderFilePreview(item){
  if (!item) return '<div class="sidebar-empty">No file selected.</div>';

  if (isPdfFile(item)) {
    return `
      <div class="pc-file-frame-wrap">
        <iframe
          class="pc-file-frame"
          src="${escapeHtml(item.href)}#view=FitH"
          title="${escapeHtml(item.title)}"
          loading="lazy"
        ></iframe>
      </div>

      <div class="pc-file-actions">
        <a class="btn" href="${escapeHtml(item.href)}" target="_blank" rel="noopener">Open full file</a>
        <a class="btn" href="${escapeHtml(item.href)}" download="${escapeHtml(item.downloadName || item.title)}">Download</a>
      </div>
    `;
  }

  if (isImageFile(item)) {
    return `
      <div class="pc-file-image-wrap">
        <img
          class="pc-file-image"
          src="${escapeHtml(item.href)}"
          alt="${escapeHtml(item.title)}"
          loading="lazy"
          decoding="async"
        >
      </div>

      <div class="pc-file-actions">
        <a class="btn" href="${escapeHtml(item.href)}" target="_blank" rel="noopener">Open image</a>
        <a class="btn" href="${escapeHtml(item.href)}" download="${escapeHtml(item.downloadName || item.title)}">Download</a>
      </div>
    `;
  }

  return `
    <div class="pc-file-fallback">
      <div class="pc-file-fallback__title">${escapeHtml(item.format)} file</div>
      <div class="pc-file-fallback__text">This file is hosted on your own server. Use open or download below.</div>
    </div>

    <div class="pc-file-actions">
      <a class="btn" href="${escapeHtml(item.href)}" target="_blank" rel="noopener">Open file</a>
      <a class="btn" href="${escapeHtml(item.href)}" download="${escapeHtml(item.downloadName || item.title)}">Download</a>
    </div>
  `;
}

function renderFilesCard(){
  if (!filesCard || !filesContent) return;

  const items = normalizeFilesInput(filesSource())
    .map((item, index) => parseFileItem(item, index))
    .filter(Boolean);

  if (!items.length) {
    filesCard.hidden = true;
    filesContent.innerHTML = '';
    state.selectedFileIndex = -1;
    return;
  }

  filesCard.hidden = false;

  const hasActive =
    Number.isInteger(state.selectedFileIndex) &&
    state.selectedFileIndex >= 0 &&
    state.selectedFileIndex < items.length;

  if (!hasActive) {
    state.selectedFileIndex = -1;
  }

  const active =
    state.selectedFileIndex >= 0 && state.selectedFileIndex < items.length
      ? items[state.selectedFileIndex]
      : null;

  filesContent.innerHTML = `
    <div class="pc-files-grid">
      <div class="pc-files-list" role="tablist" aria-label="Product files">
        ${items.map((item, index) => {
          const isActive = index === state.selectedFileIndex;

          return `
        <button
          type="button"
          class="pc-file-item${isActive ? ' is-active' : ''}"
          data-file-index="${index}"
          role="tab"
          aria-selected="${isActive ? 'true' : 'false'}"
        >
          <div class="pc-file-item__head">
            <div class="pc-file-item__title">${escapeHtml(item.title)}</div>
            <div class="pc-file-item__format">${escapeHtml(item.format)}</div>
          </div>
          ${item.summary ? `<div class="pc-file-item__summary">${escapeHtml(item.summary)}</div>` : ''}
        </button>
      `;

        }).join('')}
      </div>

      <div class="pc-file-viewer${active ? '' : ' pc-file-viewer--closed'}" role="tabpanel">
        ${
          active
            ? renderFilePreview(active)
            : `
              <div class="sidebar-empty">Select a file to open the viewer.</div>
            `
        }
      </div>
    </div>
  `;

  filesContent.querySelectorAll('[data-file-index]').forEach(btn => {
    btn.addEventListener('click', () => {
      const next = Number(btn.getAttribute('data-file-index'));
      if (!Number.isInteger(next) || next < 0 || next >= items.length) return;
      if (next === state.selectedFileIndex) return;

      state.selectedFileIndex = next;
      renderFilesCard();
    });
  });
}

function normalizeLineupCurrentFamily(input){
  const obj = (input && typeof input === 'object' && !Array.isArray(input)) ? input : null;
  if (!obj) return null;

  const modelNumber = String(obj.model_number || '').trim();
  if (!modelNumber) return null;

  const seen = new Set();

  const products = (Array.isArray(obj.products) ? obj.products : Array.isArray(obj.models) ? obj.models : [])
    .map((m) => {
      const version = String(m?.version || 'Default').trim() || 'Default';
      const key = normalizeKey(m?.key || '');
      const modelName = String(m?.model_name || '').trim() || null;

      if (!key) return null;

      const sig = `${version.toLowerCase()}|${key.toLowerCase()}`;
      if (seen.has(sig)) return null;
      seen.add(sig);

      return {
        version,
        key,
        model_name: modelName
      };
    })
    .filter(Boolean)
    .sort((a, b) => smartOptionCompare(a.version, b.version));

  if (!products.length) return null;

  return {
    model_number: modelNumber,
    brand: String(obj.brand || '').trim() || null,
    category: String(obj.category || '').trim() || null,
    selected_version: String(obj.selected_version || '').trim() || null,
    products
  };
}

function lineupFamilies(){
  const raw = state.lineup && typeof state.lineup === 'object' ? state.lineup : null;
  if (!raw) return { current: null, families: [] };

  const current = normalizeLineupCurrentFamily(raw.current_family);

  const families = (Array.isArray(raw.families) ? raw.families : [])
    .map((fam) => {
      const modelNumber = String(fam?.model_number || '').trim();
      const key = normalizeKey(fam?.key || '');
      if (!modelNumber || !key) return null;

      const countNum = Number(fam?.product_count);

      return {
        model_number: modelNumber,
        key,
        category: String(fam?.category || '').trim() || null,
        product_count: (Number.isFinite(countNum) && countNum > 0) ? countNum : 1
      };
    })
    .filter(Boolean);

  if (current) {
    const hasCurrent = families.some(
      (fam) => fam.model_number.toLowerCase() === current.model_number.toLowerCase()
    );

    if (!hasCurrent) {
      const fallbackKey = current.products[0]?.key || '';
      if (fallbackKey) {
        families.unshift({
          model_number: current.model_number,
          key: fallbackKey,
          category: current.category || null,
          product_count: current.products.length
        });
      }
    }
  }

  return { current, families };
}

function renderLineup(){
  if (!lineupCard || !lineupContent) return;

  const pack = lineupFamilies();
  const families = Array.isArray(pack?.families) ? pack.families : [];
  const currentFamily = pack?.current || null;

  if (
    !currentFamily ||
    !families.length ||
    !Array.isArray(currentFamily.products) ||
    !currentFamily.products.length
  ) {
    lineupCard.hidden = true;
    lineupContent.innerHTML = '';
    state.selectedLineupFamily = null;
    return;
  }

  lineupCard.hidden = false;
  state.selectedLineupFamily = currentFamily.model_number;

  const currentFamilyName = String(currentFamily.model_number || '').trim().toLowerCase();
  const currentVersion =
    String(state.selectedVersion || currentFamily.selected_version || '').trim() || 'Default';

  const siblingFamilies = families.filter((fam) => {
    return String(fam?.model_number || '').trim().toLowerCase() !== currentFamilyName;
  });

  const showFamilyStrip = siblingFamilies.length > 0;

  function productCountLabel(n){
    const count = Number(n) || 1;
    return `${count} product${count === 1 ? '' : 's'}`;
  }

  const stripFamilies = showFamilyStrip
    ? [
        {
          model_number: currentFamily.model_number,
          key: '',
          product_count: currentFamily.products.length,
          isCurrent: true
        },
        ...siblingFamilies.map((fam) => ({
          ...fam,
          isCurrent: false
        }))
      ]
    : [];

  const modelCols = Math.max(1, currentFamily.products.length);

  const modelsHtml = currentFamily.products.map((model) => {
    const modelTitle =
      String(model?.model_name || '').trim() ||
      `${currentFamily.model_number} ${String(model?.version || 'Model').trim()}`;

    const isActiveModel = normLower(model.version) === normLower(currentVersion);

    return `
      <div class="pc-lineup-target">
        <span class="pc-lineup-target__arrow" aria-hidden="true"></span>

        <button
          type="button"
          class="pc-lineup-model${isActiveModel ? ' is-active' : ''}"
          data-lineup-key="${escapeHtml(model.key)}"
          data-lineup-title="${escapeHtml(modelTitle)}"
        >
          <div class="pc-lineup-model__version">${escapeHtml(model.version || 'Model')}</div>
          <div class="pc-lineup-model__name">${escapeHtml(modelTitle)}</div>
        </button>
      </div>
    `;
  }).join('');

  lineupContent.innerHTML = `
    <div class="pc-lineup-flow">
      ${
        showFamilyStrip ? `
          <div class="pc-lineup-family-row">
            ${stripFamilies.map((fam) => {
              const count = Number(fam.product_count) || 1;

              if (fam.isCurrent) {
                return `
                  <div class="pc-lineup-family-pill is-active">
                    <div class="pc-lineup-family-pill__name">${escapeHtml(fam.model_number)}</div>
                    <div class="pc-lineup-family-pill__count">${escapeHtml(productCountLabel(count))}</div>
                  </div>
                `;
              }

              return `
                <button
                  type="button"
                  class="pc-lineup-family-pill"
                  data-lineup-key="${escapeHtml(fam.key)}"
                  data-lineup-title="${escapeHtml(fam.model_number)}"
                >
                  <div class="pc-lineup-family-pill__name">${escapeHtml(fam.model_number)}</div>
                  <div class="pc-lineup-family-pill__count">${escapeHtml(productCountLabel(count))}</div>
                </button>
              `;
            }).join('')}
          </div>
        ` : ''
      }

      <div class="pc-lineup-root-wrap">
        <div class="pc-lineup-root">
          <div class="pc-lineup-root__eyebrow">Current family</div>
          <div class="pc-lineup-root__name">${escapeHtml(currentFamily.model_number)}</div>
          <div class="pc-lineup-root__count">${escapeHtml(productCountLabel(currentFamily.products.length))}</div>
        </div>
      </div>

      <div class="pc-lineup-tree" aria-hidden="true">
        <div class="pc-lineup-tree__stem"></div>
        <div class="pc-lineup-tree__bar${modelCols === 1 ? ' is-single' : ''}"></div>
      </div>

      <div class="pc-lineup-tree__targets">
        ${modelsHtml}
      </div>
    </div>
  `;

  const flowEl = lineupContent.querySelector('.pc-lineup-flow');
  if (flowEl) {
    flowEl.style.setProperty('--pc-lineup-cols', String(modelCols));
  }

  lineupContent.querySelectorAll('[data-lineup-key]').forEach((el) => {
    el.addEventListener('click', () => {
      const nextKey = normalizeKey(el.getAttribute('data-lineup-key') || '');
      const nextTitle = String(el.getAttribute('data-lineup-title') || 'Product').trim() || 'Product';

      if (!nextKey) return;
      if (nextKey === state.lastKey) return;

      applyPrettyUrl(nextKey, nextTitle, 'push');
      run(nextKey);
    });
  });
}

function dimNum(v){
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

function dimText(n){
  if (!Number.isFinite(n)) return '';
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function dimObj(raw){
  return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : null;
}

function firstNum(obj, keys){
  const src = dimObj(obj);
  if (!src) return null;

  for (const k of keys){
    const n = dimNum(src[k]);
    if (n != null) return n;
  }
  return null;
}

function normalizeDimensions(raw){
  const src = dimObj(raw);
  if (!src) return null;

  let lengthIn = firstNum(src, ['length_in', 'len_in']);
  let widthIn  = firstNum(src, ['width_in', 'wid_in']);
  let heightIn = firstNum(src, ['height_in', 'thickness_in']);
  let depthIn  = firstNum(src, ['depth_in']);
  let weightLb = firstNum(src, ['weight_lb']);
  let screenIn = firstNum(src, ['screen_in']);

  const lengthCm = firstNum(src, ['length_cm', 'len_cm']);
  const widthCm  = firstNum(src, ['width_cm', 'wid_cm']);
  const heightCm = firstNum(src, ['height_cm', 'thickness_cm']);
  const depthCm  = firstNum(src, ['depth_cm']);
  const weightKg = firstNum(src, ['weight_kg']);
  const screenCm = firstNum(src, ['screen_cm']);

  if (lengthIn == null && lengthCm != null) lengthIn = lengthCm / 2.54;
  if (widthIn == null && widthCm != null) widthIn = widthCm / 2.54;
  if (heightIn == null && heightCm != null) heightIn = heightCm / 2.54;
  if (depthIn == null && depthCm != null) depthIn = depthCm / 2.54;
  if (weightLb == null && weightKg != null) weightLb = weightKg / 0.45359237;
  if (screenIn == null && screenCm != null) screenIn = screenCm / 2.54;

  const hasAny = [lengthIn, widthIn, heightIn, depthIn, weightLb, screenIn].some(v => v != null);
  if (!hasAny) return null;

  return { lengthIn, widthIn, heightIn, depthIn, weightLb, screenIn };
}

function selectedDimensions(){
  const cur = getCurrentVariant();

  const fromVariant = normalizeDimensions(cur?.dimensions);
  if (fromVariant) return fromVariant;

  const fromIdentity = normalizeDimensions(state.identity?.dimensions);
  if (fromIdentity) return fromIdentity;

  return null;
}

function formatLengthUnit(inches, unit){
  if (inches == null) return '';
  if (unit === 'metric') return `${dimText(inches * 2.54)} cm`;
  return `${dimText(inches)} in`;
}

function formatWeightUnit(lb, unit){
  if (lb == null) return '';
  if (unit === 'metric') return `${dimText(lb * 0.45359237)} kg`;
  return `${dimText(lb)} lb`;
}

function formatAxisUnit(inches, unit){
  if (inches == null) return '';
  return unit === 'metric'
    ? `${dimText(inches * 2.54)} cm`
    : `${dimText(inches)} in`;
}

function getDimensionAxes(d){
  const xIn = d.lengthIn ?? d.widthIn ?? d.heightIn ?? d.depthIn ?? null;
  const yIn = d.widthIn ?? d.heightIn ?? d.depthIn ?? d.lengthIn ?? null;
  const zIn = d.depthIn ?? d.heightIn ?? null;

  return { xIn, yIn, zIn };
}

function renderDimensionVisual(d, unit){
  const { xIn, yIn, zIn } = getDimensionAxes(d);

  if (xIn == null || yIn == null) return '';

  const rawX = Math.max(Number(xIn) || 0.01, 0.01);
  const rawY = Math.max(Number(yIn) || 0.01, 0.01);
  const rawZ = Math.max(Number(zIn != null ? zIn : Math.min(rawX, rawY) * 0.14) || 0.01, 0.01);

  const maxFrontW = 250;
  const maxFrontH = 132;
  const maxDepth = 54;
  const minDepth = zIn != null ? 12 : 8;

  const baseScale = Math.min(maxFrontW / rawX, maxFrontH / rawY);

  let frontW = rawX * baseScale;
  let frontH = rawY * baseScale;
  let depth = Math.max(minDepth, Math.min(maxDepth, rawZ * baseScale));

  const maxTotalW = 320;
  const neededW = frontW + depth;

  if (neededW > maxTotalW) {
    const shrink = maxTotalW / neededW;
    frontW *= shrink;
    frontH *= shrink;
    depth *= shrink;
  }

  depth = Math.max(minDepth, depth);

  const left = 88;
  const top = 62;
  const dx = depth;
  const dy = -depth * 0.58;
  const right = left + frontW;
  const bottom = top + frontH;

  const xLineY = Math.min(226, bottom + 22);
  const xTextY = xLineY + 18;
  const yLineX = left - 28;

  const xLabel = `X ${formatAxisUnit(xIn, unit)}`;
  const yLabel = `Y ${formatAxisUnit(yIn, unit)}`;
  const zLabel = zIn != null ? `Z ${formatAxisUnit(zIn, unit)}` : '';

  const zGuideGap = 24;
  const zGuideDrop = Math.max(40, Math.min(70, frontH * 0.58));
  const zGuideX1 = right + zGuideGap;
  const zGuideY1 = top + zGuideDrop - 60;
  const zGuideX2 = zGuideX1 + dx;
  const zGuideY2 = zGuideY1 + dy;

  return `
    <svg class="dim-visual" viewBox="0 0 420 260" role="img" aria-label="Proportional dimensions diagram">
      <title>Proportional dimensions diagram</title>

      <polygon
        points="${left},${top} ${right},${top} ${right + dx},${top + dy} ${left + dx},${top + dy}"
        fill="#eef2ff"
        stroke="#c7d2fe"
        stroke-width="1.5"
      ></polygon>

      <polygon
        points="${right},${top} ${right},${bottom} ${right + dx},${bottom + dy} ${right + dx},${top + dy}"
        fill="#e2e8f0"
        stroke="#cbd5e1"
        stroke-width="1.5"
      ></polygon>

      <polygon
        points="${left},${top} ${right},${top} ${right},${bottom} ${left},${bottom}"
        fill="#ffffff"
        stroke="#94a3b8"
        stroke-width="2"
      ></polygon>

      <line x1="${left}" y1="${top}" x2="${left + dx}" y2="${top + dy}" stroke="#94a3b8" stroke-width="2"></line>
      <line x1="${right}" y1="${top}" x2="${right + dx}" y2="${top + dy}" stroke="#94a3b8" stroke-width="2"></line>
      <line x1="${right}" y1="${bottom}" x2="${right + dx}" y2="${bottom + dy}" stroke="#94a3b8" stroke-width="2"></line>

      <line x1="${left}" y1="${xLineY}" x2="${right}" y2="${xLineY}" stroke="#6366f1" stroke-width="2"></line>
      <line x1="${left}" y1="${xLineY - 7}" x2="${left}" y2="${xLineY + 7}" stroke="#6366f1" stroke-width="2"></line>
      <line x1="${right}" y1="${xLineY - 7}" x2="${right}" y2="${xLineY + 7}" stroke="#6366f1" stroke-width="2"></line>
      <text x="${(left + right) / 2}" y="${xTextY}" text-anchor="middle" font-size="14" font-weight="700" fill="#4338ca">${escapeHtml(xLabel)}</text>

      <line x1="${yLineX}" y1="${top}" x2="${yLineX}" y2="${bottom}" stroke="#14b8a6" stroke-width="2"></line>
      <line x1="${yLineX - 7}" y1="${top}" x2="${yLineX + 7}" y2="${top}" stroke="#14b8a6" stroke-width="2"></line>
      <line x1="${yLineX - 7}" y1="${bottom}" x2="${yLineX + 7}" y2="${bottom}" stroke="#14b8a6" stroke-width="2"></line>
      <text
        x="${yLineX - 12}"
        y="${(top + bottom) / 2}"
        text-anchor="middle"
        font-size="14"
        font-weight="700"
        fill="#0f766e"
        transform="rotate(-90 ${yLineX - 12} ${(top + bottom) / 2})"
      >${escapeHtml(yLabel)}</text>

      ${
          zIn != null
            ? `
              <line
                x1="${zGuideX1}"
                y1="${zGuideY1}"
                x2="${zGuideX2}"
                y2="${zGuideY2}"
                stroke="#64748b"
                stroke-width="2"
              ></line>

              <line
                x1="${zGuideX1 - 6}"
                y1="${zGuideY1}"
                x2="${zGuideX1 + 6}"
                y2="${zGuideY1}"
                stroke="#64748b"
                stroke-width="2"
              ></line>

              <line
                x1="${zGuideX2 - 6}"
                y1="${zGuideY2}"
                x2="${zGuideX2 + 6}"
                y2="${zGuideY2}"
                stroke="#64748b"
                stroke-width="2"
              ></line>

              <text
                x="${zGuideX2 + 14}"
                y="${zGuideY2 + 8}"
                font-size="14"
                font-weight="700"
                fill="#475569"
              >${escapeHtml(zLabel)}</text>
            `
            : ''
        }
    </svg>
  `;
}

function renderDimStat(label, value){
  return `
    <div class="dim-stat">
      <div class="dim-stat__label">${escapeHtml(label)}</div>
      <div class="dim-stat__value">${escapeHtml(value)}</div>
    </div>
  `;
}

function renderDimensions(){
  if (!dimCard || !dimContent) return;

  const d = selectedDimensions();

  if (!d) {
    dimCard.hidden = true;
    if (dimToggle) dimToggle.innerHTML = '';
    dimContent.innerHTML = '';
    return;
  }

  const unit = state.dimUnit === 'metric' ? 'metric' : 'imperial';
  const { xIn, yIn, zIn } = getDimensionAxes(d);

  const axisValues = [xIn, yIn, zIn].filter(v => v != null);
  const axisText = axisValues.map(v => unit === 'metric' ? dimText(v * 2.54) : dimText(v));
  const axisUnit = unit === 'metric' ? 'cm' : 'in';

  const visual = renderDimensionVisual(d, unit);
  const stats = [];

  // If we already have the XYZ diagram, do not repeat the same overall size below it.
  if (!(visual && zIn != null) && axisText.length >= 2) {
    stats.push(renderDimStat('Size', `${axisText.join(' x ')} ${axisUnit}`));
  }

  if (xIn != null && yIn != null) {
    stats.push(
      renderDimStat(
        'Footprint',
        `${formatLengthUnit(xIn, unit)} x ${formatLengthUnit(yIn, unit)}`
      )
    );
  }

  if (d.weightLb != null) {
    stats.push(renderDimStat('Weight', formatWeightUnit(d.weightLb, unit)));
  }

  if (d.screenIn != null) {
    stats.push(renderDimStat('Screen', formatLengthUnit(d.screenIn, unit)));
  }

  if (d.heightIn != null && (zIn == null || Math.abs(d.heightIn - zIn) > 0.001)) {
    stats.push(renderDimStat('Height', formatLengthUnit(d.heightIn, unit)));
  }

  if (d.depthIn != null && (zIn == null || Math.abs(d.depthIn - zIn) > 0.001)) {
    stats.push(renderDimStat('Depth', formatLengthUnit(d.depthIn, unit)));
  }

  if (!stats.length) {
    dimCard.hidden = true;
    if (dimToggle) dimToggle.innerHTML = '';
    dimContent.innerHTML = '';
    return;
  }

  dimCard.hidden = false;

  if (dimToggle) {
    dimToggle.innerHTML = `
      <button type="button" class="dim-unit-btn${unit === 'imperial' ? ' is-active' : ''}" data-dim-unit="imperial">in / lb</button>
      <button type="button" class="dim-unit-btn${unit === 'metric' ? ' is-active' : ''}" data-dim-unit="metric">cm / kg</button>
    `;

    dimToggle.querySelectorAll('[data-dim-unit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const next = String(btn.getAttribute('data-dim-unit') || '').trim();
        if (!next || next === state.dimUnit) return;
        state.dimUnit = next;
        renderDimensions();
      });
    });
  }

  dimContent.innerHTML = `
    <div class="dim-layout">
      ${
        visual
          ? `
            <div class="dim-visual-card">
              <div class="dim-visual-stage">
                ${visual}
              </div>
            </div>
          `
          : ''
      }

      <div class="dim-grid">
        ${stats.join('')}
      </div>
    </div>
  `;
}

  window.run = run;

  window.addEventListener('popstate', () => {
    const raw = currentKeyFromUrl();
    if (raw) run(raw);
  });
})();