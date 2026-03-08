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

  const REVIEW_EXTERNAL_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg"
        height="18" viewBox="0 -960 960 960" width="18"
        fill="currentColor" aria-hidden="true" focusable="false">
      <path d="m216-160-56-56 464-464H360v-80h400v400h-80v-264L216-160Z"/>
    </svg>
  `;

  const REVIEW_STAR_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg"
        height="18" viewBox="0 -960 960 960" width="18"
        fill="currentColor" aria-hidden="true" focusable="false">
      <path d="m233-120 93-304L80-600h304l96-320 96 320h304L634-424l93 304-247-188-247 188Z"></path>
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
    selectedFileIndex: -1,
    followBrand: '',
    followingBrand: false,
    followStateKnown: false,
    followBusy: false
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
const contentsCard = document.getElementById('contentsCard');
const contentsContent = document.getElementById('contentsContent');
const mediaCard = document.getElementById('mediaCard');
const lineupCard = document.getElementById('lineup');
const lineupContent = document.getElementById('lineupContent');
let _codePanelEl = null;
let _codePanelOpen = false;

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

async function renderReviewsCard(productKey) {
  const el = document.getElementById('pc-reviews-card');
  if (!el) return;

  function mount(inner) {
    el.hidden = false;
    el.innerHTML = inner;
  }

  const iconPath = 'm363-390 117-71 117 71-31-133 104-90-137-11-53-126-53 126-137 11 104 90-31 133ZM80-80v-720q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H240L80-80Zm126-240h594v-480H160v525l46-45Zm-46 0v-480 480Z';

  mount(`
    <div class="spaced">
      <h2 data-icon-path="${iconPath}">Reviews</h2>
    </div>

    <div class="pc-reviews-wrap pc-reviews-loading">
      <div class="pc-reviews-skeleton"></div>
      <div class="pc-reviews-skeleton pc-reviews-skeleton--short"></div>
      <div class="pc-reviews-skeleton"></div>
    </div>
  `);
  wireCardIcons();

  let data;
  try {
    const res = await fetch(`/api/reviews/${encodeURIComponent(productKey)}`, {
      headers: { Accept: 'application/json' }
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (_err) {
    mount(`
      <div class="spaced">
        <h2 data-icon-path="${iconPath}">Reviews</h2>
      </div>
      <p class="note">Review data is not available for this product yet.</p>
    `);
    wireCardIcons();
    return;
  }

  const aggregate = data && typeof data === 'object' ? (data.aggregate || {}) : {};
  const customerSources = Array.isArray(data?.customer_sources)
    ? data.customer_sources
    : (Array.isArray(data?.sources) ? data.sources : []);
  const expertReviews = Array.isArray(data?.expert_reviews) ? data.expert_reviews : [];
  const distribution = (data && typeof data.distribution === 'object' && data.distribution)
    ? data.distribution
    : { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };

  const total = Number(aggregate.count || 0);
  const overall = Number(aggregate.overall || 0);
  const verifiedPct = aggregate.verified_pct == null ? null : Number(aggregate.verified_pct);

  const hasCustomer = total > 0 && overall > 0;
  const hasExpert = expertReviews.length > 0;

  if (!hasCustomer && !hasExpert) {
    mount(`
      <div class="spaced">
        <h2 data-icon-path="${iconPath}">Reviews</h2>
      </div>
      <p class="note">No reviews found yet.</p>
    `);
    wireCardIcons();
    return;
  }

  const fmtCompact = (n) => {
    const v = Number(n || 0);
    if (v >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(v);
  };

  const pct = (n, base) => {
    const num = Number(n || 0);
    const den = Number(base || 0);
    if (!den) return 0;
    return Math.round((num / den) * 100);
  };

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  let customerHtml = '';

  if (hasCustomer) {
    const breakdownRows = [5, 4, 3, 2, 1].map((star) => {
      const count = Number(distribution[star] || 0);
      const width = pct(count, total);

      return `
        <div class="pc-rv-breakdown-row" aria-label="${star} stars: ${count} reviews">
          <div class="pc-rv-breakdown-left">
            <span class="pc-rv-breakdown-label">
              <span class="pc-rv-breakdown-star-icon" aria-hidden="true">
                ${REVIEW_STAR_SVG}
              </span>
              <span>${star} stars</span>
            </span>
          </div>

          <div class="pc-rv-breakdown-bar">
            <div class="pc-rv-breakdown-fill pc-rv-breakdown-fill--${star}" style="width:${clamp(width, 0, 100)}%"></div>
          </div>

          <div class="pc-rv-breakdown-right">
            <span class="pc-rv-breakdown-count">${fmtCompact(count)}</span>
            <span class="pc-rv-breakdown-pct">${width}%</span>
          </div>
        </div>
      `;
    }).join('');

    const sortedSources = customerSources
      .slice()
      .sort((a, b) => Number(b.count || 0) - Number(a.count || 0));

    const sourceCards = sortedSources.map((s) => {
      const sourceName = String(s.name || s.slug || 'Source').trim() || 'Source';
      const sourceUrl = String(s.url || '').trim();
      const sourceCount = Number(s.count || 0);
      const sourceRating = Number(s.rating || 0);

      return `
        <article class="pc-rv-source-card">
          <div class="pc-rv-source-card__top">
            <div class="pc-rv-source-card__name">${escapeHtml(sourceName)}</div>
            ${
              sourceUrl
                ? `
                  <a
                    class="pc-rv-source-card__link"
                    href="${escapeHtml(sourceUrl)}"
                    target="_blank"
                    rel="noopener"
                    aria-label="Open ${escapeHtml(sourceName)} reviews"
                  >
                    ${REVIEW_EXTERNAL_SVG}
                  </a>
                `
                : ''
            }
          </div>

          <div class="pc-rv-source-card__rating">${sourceRating.toFixed(1)} / 5</div>
          <div class="pc-rv-source-card__count">${fmtCompact(sourceCount)} reviews</div>
        </article>
      `;
    }).join('');

    const confidence =
      total < 50 ? 'low' :
      total < 500 ? 'med' :
      'high';

    const confidenceLabel = {
      low: 'Low Confidence',
      med: 'Moderate Confidence',
      high: 'High Confidence'
    }[confidence];

    const verifiedPill = verifiedPct != null
      ? `<span class="pc-rv-pill">${verifiedPct}% verified</span>`
      : '';

    customerHtml = `
      <section class="pc-review-section">
        <div class="pc-rv-section-head">
          <div class="pc-rv-section-title">Customer Reviews</div>
        </div>

        <div class="pc-rv-customer-layout">
          <div class="pc-rv-summary-card">
            <div class="pc-rv-summary-label">Average rating</div>
            <div class="pc-rv-summary-score">${overall.toFixed(1)}</div>
            <div class="pc-rv-summary-scale">out of 5</div>
            <div class="pc-rv-summary-note">Based on ${fmtCompact(total)} customer reviews</div>

          <div class="pc-rv-summary-meta">
            <span class="pc-rv-confidence pc-rv-confidence--${confidence}">${confidenceLabel}</span>
            ${verifiedPill}
          </div>

          </div>

          <div class="pc-rv-breakdown-card">
            <div class="pc-rv-subhead">Rating breakdown</div>
            <div class="pc-rv-breakdown-list">
              ${breakdownRows}
            </div>
          </div>
        </div>

        ${
          sortedSources.length
            ? `
              <div class="pc-rv-block">
                <div class="pc-rv-subhead">By source</div>
                <div class="pc-rv-source-grid">
                  ${sourceCards}
                </div>
              </div>
            `
            : ''
        }
      </section>
    `;
  } else {
    customerHtml = `
      <section class="pc-review-section">
        <div class="pc-rv-section-head">
          <div class="pc-rv-section-title">Customer Reviews</div>
        </div>
        <p class="note">No customer reviews found yet.</p>
      </section>
    `;
  }

  const formatReviewDate = (raw) => {
    const s = String(raw || '').trim();
    if (!s) return '';
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(d);
  };

  let expertHtml = '';

  if (hasExpert) {
    const expertRows = expertReviews.map((r) => {
      const source = String(r.name || r.slug || 'Source').trim() || 'Source';
      const title = String(r.article_title || source).trim() || source;
      const verdict = String(r.verdict || '').trim();
      const url = String(r.url || '').trim();
      const reviewedAt = formatReviewDate(r.reviewed_at);

      const scoreOutOf5 = Number(r.score_out_of_5 || 0);
      const score = r.score == null ? null : Number(r.score);
      const scoreScale = r.score_scale == null ? 5 : Number(r.score_scale);

      const normalizedLabel = scoreOutOf5 > 0 ? `${scoreOutOf5.toFixed(1)}/5` : '';
      const rawLabel =
        score != null && scoreScale > 0
          ? (scoreScale === 5 ? '' : `${score}/${scoreScale}`)
          : '';

      const pros = Array.isArray(r.pros) ? r.pros.filter(Boolean).slice(0, 4) : [];
      const cons = Array.isArray(r.cons) ? r.cons.filter(Boolean).slice(0, 4) : [];

      return `
        <article class="pc-rv-expert-card">
          <div class="pc-rv-expert-top">
            <div class="pc-rv-expert-main">
              <div class="pc-rv-expert-source">${escapeHtml(source)}</div>

              <div class="pc-rv-expert-title-row">
                <div class="pc-rv-expert-title">${escapeHtml(title)}</div>
                ${
                  url
                    ? `
                      <a
                        class="pc-rv-expert-title-link"
                        href="${escapeHtml(url)}"
                        target="_blank"
                        rel="noopener"
                        aria-label="Open ${escapeHtml(title)}"
                      >
                        ${REVIEW_EXTERNAL_SVG}
                      </a>
                    `
                    : ''
                }
              </div>
            </div>

            ${
              normalizedLabel
                ? `
                  <div class="pc-rv-expert-score">
                    <div class="pc-rv-expert-score-main">★ ${escapeHtml(normalizedLabel)}</div>
                    ${rawLabel ? `<div class="pc-rv-expert-score-sub">${escapeHtml(rawLabel)}</div>` : ''}
                  </div>
                `
                : ''
            }
          </div>

          ${
            verdict
              ? `<div class="pc-rv-expert-verdict">${escapeHtml(verdict)}</div>`
              : ''
          }

          ${
            pros.length
              ? `
                <div class="pc-rv-expert-meta">
                  ${pros.map((p) => `<span class="pc-rv-expert-chip pc-rv-expert-chip--pro">Pro: ${escapeHtml(p)}</span>`).join('')}
                </div>
              `
              : ''
          }

          ${
            cons.length
              ? `
                <div class="pc-rv-expert-meta">
                  ${cons.map((c) => `<span class="pc-rv-expert-chip pc-rv-expert-chip--con">Con: ${escapeHtml(c)}</span>`).join('')}
                </div>
              `
              : ''
          }

          ${
            reviewedAt
              ? `
                <div class="pc-rv-expert-footer">
                  <div class="pc-rv-expert-date muted">Reviewed ${escapeHtml(reviewedAt)}</div>
                </div>
              `
              : ''
          }
        </article>
      `;
    }).join('');

    expertHtml = `
      <section class="pc-review-section">
        <div class="pc-rv-section-head">
          <div class="pc-rv-section-title">Expert Reviews</div>
        </div>

        <div class="pc-rv-expert-list">
          ${expertRows}
        </div>

        <p class="note">Scores are normalized to a 5 point scale for easier comparison.</p>
      </section>
    `;
  } else {
    expertHtml = `
      <section class="pc-review-section">
        <div class="pc-rv-section-head">
          <div class="pc-rv-section-title">Expert Reviews</div>
        </div>
        <p class="note">No expert reviews found yet.</p>
      </section>
    `;
  }

  mount(`
    <div class="spaced">
      <h2 data-icon-path="${iconPath}">Reviews</h2>
    </div>

    <div class="pc-reviews-stack">
      ${customerHtml}
      ${expertHtml}
    </div>
  `);

  wireCardIcons();
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

const FAVORITE_LABEL_NAME = 'Favorites';

let _favBusy        = false;
let _favIsFavorited = false;
let _favLabelId     = null;   // cached label id once we know it

async function wireFavoriteButton(entityKey, title, imageUrl, brand) {
  const btn = document.querySelector("[data-pc-favorite='1']");
  if (!btn) return;

  const iconOn  = btn.querySelector("[data-fav-icon='on']");
  const iconOff = btn.querySelector("[data-fav-icon='off']");

  // ── visual helpers ──────────────────────────────────────────────────────────
  function setFavorited(on) {
    if (iconOn)  iconOn.style.display  = on ? '' : 'none';
    if (iconOff) iconOff.style.display = on ? 'none' : '';
    btn.setAttribute('aria-pressed', String(!!on));
    btn.setAttribute('aria-label', on ? 'Remove from Favorites' : 'Add to Favorites');
    btn.title = on ? 'Remove from Favorites' : 'Add to Favorites';
  }

  // reset to unloaded state while we fetch
  _favIsFavorited = false;
  _favLabelId     = null;
  setFavorited(false);

  // ── load current state ──────────────────────────────────────────────────────
  try {
    const [labelsRes, checkRes] = await Promise.all([
      fetch('/api/labels', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      }),
      fetch(`/api/labels/check?entity_key=${encodeURIComponent(entityKey)}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      })
    ]);

    // 401 = not signed in; silently skip — button stays neutral
    if (labelsRes.status === 401) return;

    const labelsData = await labelsRes.json().catch(() => null);
    const checkData  = await checkRes.json().catch(() => null);

    if (!labelsData?.ok) return;

    const labels    = labelsData.results || [];
    const inIds     = new Set((checkData?.label_ids || []).map(Number));
    const favLabel  = labels.find(l => l.name === FAVORITE_LABEL_NAME);

    if (favLabel) {
      _favLabelId = favLabel.id;
      if (inIds.has(favLabel.id)) {
        _favIsFavorited = true;
        setFavorited(true);
      }
    }
  } catch (_e) {
    // network error — leave button in neutral state
  }

  // ── wire click ─────────────────────────────────────────────────────────────
  if (btn._pcFavBound) btn.removeEventListener('click', btn._pcFavBound);

  btn._pcFavBound = async function handleFavClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (_favBusy) return;

    _favBusy    = true;
    btn.disabled = true;

    try {
      // ── REMOVE ─────────────────────────────────────────────────────────────
      if (_favIsFavorited) {
        if (_favLabelId) {
          // fetch items to get the item's own id, then delete it
          const r = await fetch(`/api/labels/${_favLabelId}/items`, {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' }
          });
          const d    = await r.json().catch(() => null);
          const item = (d?.results || []).find(i => i.entity_key === entityKey);

          if (item) {
            await fetch(`/api/labels/${_favLabelId}/items/${item.id}`, {
              method: 'DELETE',
              credentials: 'same-origin'
            });
          }
        }

        _favIsFavorited = false;
        setFavorited(false);
        return;
      }

      // ── ADD ────────────────────────────────────────────────────────────────

      // 1. Ensure the Favorites label exists (create once if missing)
      if (!_favLabelId) {
        const createRes = await fetch('/api/labels', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: FAVORITE_LABEL_NAME })
        });

        if (createRes.status === 401) {
          window.pcOpenSignIn?.();
          return;
        }

        // If it already exists (race or the user has it but wasn't fetched),
        // the server might 400. Re-fetch labels to find it.
        if (!createRes.ok) {
          const refetchRes  = await fetch('/api/labels', {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' }
          });
          const refetchData = await refetchRes.json().catch(() => null);
          const existing    = (refetchData?.results || []).find(l => l.name === FAVORITE_LABEL_NAME);
          if (existing) _favLabelId = existing.id;
        } else {
          const createData = await createRes.json().catch(() => null);
          if (createData?.ok) _favLabelId = createData.label.id;
        }

        if (!_favLabelId) return; // could not resolve label
      }

      // 2. Add the product to the Favorites label
      const addRes = await fetch(`/api/labels/${_favLabelId}/items`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity_key: entityKey,
          title:      _dbClean(title).slice(0, 200),
          image_url:  _dbClean(imageUrl).slice(0, 500) || null,
          brand:      _dbClean(brand).slice(0, 100)    || null
        })
      });

      if (addRes.status === 401) {
        window.pcOpenSignIn?.();
        return;
      }

      if (addRes.ok) {
        _favIsFavorited = true;
        setFavorited(true);
      }

    } catch (_e) {
      // leave state unchanged on network error
    } finally {
      _favBusy    = false;
      btn.disabled = false;
    }
  };

  btn.addEventListener('click', btn._pcFavBound);
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
  wireBrandFollowButton();
  await loadNameOverridesOnce();
  wireHeaderToolButtons();
  wireCodeButton();
  renderCodeButtonState();

  window.addEventListener('pc:auth_changed', () => {
    loadBrandFollowState();
  });

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
      await renderOffers(true);
      renderCouponsCard();
      renderTimeline();
      renderVariants();
      renderDimensions();
      renderSidebarSpecs();
      renderContents();
      renderMediaPanel();
      renderFilesCard();
      renderForensics();
      renderLineup();
      renderSimilarProducts();
      await renderReviewsCard(state.lastKey);
      {
        const _hKey   = canonicalKey || state.lastKey;
        const _hTitle = bestTitle;
        const _hImg   = bestImg;
        const _hBrand = String(state.identity?.brand || "").trim();
        if (_hKey && _hTitle) {
          recordHistory(_hKey, _hTitle, _hImg, _hBrand);
        }
      }
      wireProductActions(canonicalKey || state.lastKey, bestTitle, bestImg, String(state.identity?.brand || '').trim());
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
    state.identity = null;
    state.selectedVariantKey = null;
    _closeCodePanel();
    renderCodeButtonState();
    if (brandRow) brandRow.hidden = true;
    if (brandLine) brandLine.textContent = '';
    if (contentsCard) contentsCard.hidden = true;
    if (contentsContent) contentsContent.innerHTML = '';
    $('#offers').innerHTML = '';
    $('#offersNote').textContent = '';
    state.followBrand = '';
    state.followingBrand = false;
    state.followStateKnown = false;
    state.followBusy = false;
    setFollowButtonUi();
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
    const forensicsList = $('#forensicsList');
    if (forensicsList) forensicsList.innerHTML = '';
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

    renderCodeButtonState();

    if (_codePanelOpen) {
      _renderCodePanel();
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
        const prevBrandKey = String(state.followBrand || '').trim().toLowerCase();
    const nextBrand = String(brand || '').trim();
    const nextBrandKey = nextBrand.toLowerCase();

    state.followBrand = nextBrand;

    if (nextBrandKey !== prevBrandKey) {
      state.followingBrand = false;
      state.followStateKnown = false;
      state.followBusy = false;
      setFollowButtonUi();
      loadBrandFollowState();
    } else {
      setFollowButtonUi();
    }
  }

  function getFollowButton() {
  return document.querySelector('.ph-follow');
}

function setFollowButtonUi() {
  const btn = getFollowButton();
  if (!btn) return;

  const hasBrand = !!String(state.followBrand || '').trim();

  btn.hidden = !hasBrand;
  btn.disabled = !hasBrand || !!state.followBusy;

  let label = 'Follow';

  if (state.followBusy) {
    label = state.followingBrand ? 'Following...' : 'Saving...';
  } else if (state.followingBrand) {
    label = 'Following';
  }

  btn.textContent = label;
  btn.setAttribute('aria-pressed', state.followingBrand ? 'true' : 'false');
}

async function loadBrandFollowState() {
  const brand = String(state.followBrand || '').trim();

  state.followStateKnown = false;
  state.followingBrand = false;
  setFollowButtonUi();

  if (!brand) return;

  try {
    const res = await fetch(`/api/follows/brand?brand=${encodeURIComponent(brand)}`, {
      method: 'GET',
      credentials: 'same-origin',
      headers: {
        'Accept': 'application/json'
      }
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data || data.ok !== true) {
      state.followStateKnown = true;
      state.followingBrand = false;
      setFollowButtonUi();
      return;
    }

    state.followStateKnown = true;
    state.followingBrand = !!data.following;
    setFollowButtonUi();
  } catch (_err) {
    state.followStateKnown = true;
    state.followingBrand = false;
    setFollowButtonUi();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH: replace the existing toggleBrandFollow() function in dashboard.js
// with this version. The only change is the window.dispatchEvent call at the
// end so partials.js / following.js can react immediately.
// ─────────────────────────────────────────────────────────────────────────────

async function toggleBrandFollow() {
  const brand = String(state.followBrand || '').trim();
  if (!brand || state.followBusy) return;

  state.followBusy = true;
  setFollowButtonUi();

  try {
    const res = await fetch('/api/follows/brand/toggle', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ brand })
    });

    if (res.status === 401) {
      state.followBusy = false;
      setFollowButtonUi();
      if (typeof window.pcOpenSignIn === 'function') window.pcOpenSignIn();
      return;
    }

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data || data.ok !== true) {
      state.followBusy = false;
      setFollowButtonUi();
      return;
    }

    state.followingBrand   = !!data.following;
    state.followStateKnown = true;

    // ── NEW: notify sidebar and following page ──
    window.dispatchEvent(new CustomEvent('pc:following_changed', {
      detail: { brand, following: state.followingBrand }
    }));

    // Refresh sidebar immediately via partials
    window.pcRefreshSidebarFollowing?.();

  } catch (_err) {
    // keep existing state on network error
  } finally {
    state.followBusy = false;
    setFollowButtonUi();
  }
}


function _dbClean(v) { return String(v || "").trim(); }

function _dbEsc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


let _bookmarkBusy = false;

async function wireBookmarkButton(entityKey, title, imageUrl, brand) {
  const btn = document.querySelector("[data-pc-bookmark='1']");
  if (!btn) return;

  const iconOn  = btn.querySelector("[data-bookmark-icon='on']");
  const iconOff = btn.querySelector("[data-bookmark-icon='off']");

  function setBookmarked(on) {
    if (iconOn)  iconOn.style.display  = on ? "" : "none";
    if (iconOff) iconOff.style.display = on ? "none" : "";
    btn.setAttribute("aria-pressed", String(!!on));
    btn.title = on ? "Remove bookmark" : "Save to bookmarks";
  }

  setBookmarked(false); // default until API returns

  // Check current state
  try {
    const res  = await fetch(`/api/bookmarks/check?entity_key=${encodeURIComponent(entityKey)}`, {
      credentials: "same-origin", headers: { Accept: "application/json" }
    });
    const data = await res.json().catch(() => null);
    if (data?.ok) setBookmarked(!!data.bookmarked);
  } catch (_e) {}

  // Remove any old listener
  if (btn._pcBookmarkBound) {
    btn.removeEventListener("click", btn._pcBookmarkBound);
  }

  btn._pcBookmarkBound = async function handleBookmarkClick(e) {
    e.preventDefault();
    e.stopPropagation();

    if (_bookmarkBusy) return;

    _bookmarkBusy = true;
    btn.disabled = true;

    try {
      const res = await fetch("/api/bookmarks/toggle", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_key: entityKey,
          title:      _dbClean(title).slice(0, 200),
          image_url:  _dbClean(imageUrl).slice(0, 500) || null,
          brand:      _dbClean(brand).slice(0, 100) || null
        })
      });
      if (res.status === 401) {
        window.pcOpenSignIn?.();
        return;
      }
      const data = await res.json().catch(() => null);
      if (data?.ok) setBookmarked(!!data.bookmarked);
    } catch (_e) {}
    finally {
      _bookmarkBusy = false;
      btn.disabled = false;
    }
  };

  btn.addEventListener("click", btn._pcBookmarkBound);
}


let _labelPanelOpen   = false;
let _labelPanelEl     = null;
let _labelCurrentKey  = null;
let _labelCurrentMeta = null;

function _ensureLabelPanel() {
  if (_labelPanelEl) return _labelPanelEl;

  _labelPanelEl = document.createElement("div");
  _labelPanelEl.id = "pcLabelPickerPanel";
  _labelPanelEl.setAttribute("role", "dialog");
  _labelPanelEl.setAttribute("aria-label", "Save to label");
  _labelPanelEl.style.cssText = `
    position:fixed; z-index:9000;
    bottom:24px; right:24px;
    width:300px; max-height:360px; overflow-y:auto;
    background:#fff; border:1px solid rgba(0,0,0,.12);
    border-radius:14px; box-shadow:0 12px 36px rgba(0,0,0,.15);
    padding:0; display:none; flex-direction:column;
  `;

  document.body.appendChild(_labelPanelEl);

  // Close on outside click
  document.addEventListener("click", e => {
    if (_labelPanelOpen &&
        !_labelPanelEl.contains(e.target) &&
        !e.target.closest("[data-pc-label-trigger='1']")) {
      _closeLabelPanel();
    }
  }, true);

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && _labelPanelOpen) _closeLabelPanel();
  });

  return _labelPanelEl;
}

function _closeLabelPanel() {
  if (_labelPanelEl) _labelPanelEl.style.display = "none";
  _labelPanelOpen = false;
}

function _positionPanel(trigger) {
  _labelPanelEl.style.display = "flex";
}

async function _loadLabelPanel(entityKey, title, imageUrl, brand) {
  const panel = _ensureLabelPanel();
  panel.innerHTML = `<div style="padding:14px;font-size:13px;color:#9ca3af;">Loading…</div>`;

  try {
    // Load labels + which ones already contain this product
    const [labelsRes, checkRes] = await Promise.all([
      fetch("/api/labels", { credentials: "same-origin", headers: { Accept: "application/json" } }),
      fetch(`/api/labels/check?entity_key=${encodeURIComponent(entityKey)}`, {
        credentials: "same-origin", headers: { Accept: "application/json" }
      })
    ]);

    if (labelsRes.status === 401) {
      _closeLabelPanel();
      window.pcOpenSignIn?.();
      return;
    }

    const labelsData = await labelsRes.json().catch(() => null);
    const checkData  = await checkRes.json().catch(() => null);

    if (!labelsData?.ok) {
      panel.innerHTML = `<div style="padding:14px;font-size:13px;color:#9ca3af;">Could not load labels.</div>`;
      return;
    }

    const labels  = labelsData.results || [];
    const inLabels = new Set((checkData?.label_ids || []).map(Number));

    _renderLabelPanel(panel, labels, inLabels, entityKey, title, imageUrl, brand);
  } catch (_e) {
    panel.innerHTML = `<div style="padding:14px;font-size:13px;color:#9ca3af;">Error loading labels.</div>`;
  }
}

function _renderLabelPanel(panel, labels, inLabels, entityKey, title, imageUrl, brand) {
  const headerHtml = `
    <div style="display:flex;align-items:center;justify-content:space-between;
                padding:12px 14px 10px;border-bottom:1px solid rgba(0,0,0,.07);flex-shrink:0;">
      <span style="font-size:14px;font-weight:700;color:#111827;">Save to Label</span>
      <a href="/labels/" style="font-size:12px;color:#6366f1;text-decoration:none;font-weight:600;">Manage</a>
    </div>
  `;

  const labelsHtml = labels.length === 0
    ? `<div style="padding:14px;font-size:13px;color:#9ca3af;text-align:center;">
         No labels yet.<br>Create one below.
       </div>`
    : labels.map(lb => {
        const checked = inLabels.has(lb.id);
        return `
          <label style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;
                        transition:background .1s;" onmouseover="this.style.background='#f9fafb'"
                 onmouseout="this.style.background=''">
            <input type="checkbox"
              data-label-toggle="${lb.id}"
              ${checked ? "checked" : ""}
              style="width:16px;height:16px;cursor:pointer;accent-color:#6366f1;flex-shrink:0;"
            />
            <span style="font-size:14px;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;">${_dbEsc(lb.name)}</span>
            <span style="font-size:11px;color:#9ca3af;flex-shrink:0;">${lb.item_count || 0}</span>
          </label>
        `;
      }).join("");

  const footerHtml = `
    <div style="padding:10px 14px;border-top:1px solid rgba(0,0,0,.07);flex-shrink:0;">
      <div style="display:flex;gap:8px;align-items:center;">
        <input id="_pcLabelNewInput" type="text" placeholder="New label name…" maxlength="80"
          style="flex:1;padding:8px 10px;border-radius:8px;border:1.5px solid rgba(0,0,0,.14);
                 font:inherit;font-size:13px;outline:none;"
        />
        <button id="_pcLabelNewSubmit" type="button"
          style="flex-shrink:0;padding:8px 12px;border-radius:8px;border:none;
                 background:#111827;color:#fff;font:inherit;font-size:13px;
                 font-weight:700;cursor:pointer;">
          Add
        </button>
      </div>
    </div>
  `;

  panel.innerHTML = headerHtml + `<div style="overflow-y:auto;flex:1;">${labelsHtml}</div>` + footerHtml;

  // Wire checkboxes
  panel.querySelectorAll("[data-label-toggle]").forEach(cb => {
    cb.addEventListener("change", async () => {
      const labelId = Number(cb.getAttribute("data-label-toggle"));
      const adding  = cb.checked;
      cb.disabled   = true;

      try {
        if (adding) {
          await fetch(`/api/labels/${labelId}/items`, {
            method: "POST", credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              entity_key: entityKey,
              title:   _dbClean(title).slice(0, 200),
              image_url: _dbClean(imageUrl).slice(0, 500) || null,
              brand:   _dbClean(brand).slice(0, 100) || null
            })
          });
          inLabels.add(labelId);
        } else {
          // Find item id to delete — fetch items for label, match entity_key
          const r = await fetch(`/api/labels/${labelId}/items`, {
            credentials: "same-origin", headers: { Accept: "application/json" }
          });
          const d = await r.json().catch(() => null);
          const item = (d?.results || []).find(i => i.entity_key === entityKey);
          if (item) {
            await fetch(`/api/labels/${labelId}/items/${item.id}`, {
              method: "DELETE", credentials: "same-origin"
            });
          }
          inLabels.delete(labelId);
        }
      } catch (_e) {
        cb.checked = !adding; // revert on error
      } finally {
        cb.disabled = false;
      }
    });
  });

  // Wire "Add" button (create new label then add product)
  const newInput  = panel.querySelector("#_pcLabelNewInput");
  const newSubmit = panel.querySelector("#_pcLabelNewSubmit");

  async function createAndAdd() {
    const name = _dbClean(newInput?.value || "").slice(0, 80);
    if (!name || !newSubmit) return;

    newSubmit.disabled = true;
    newSubmit.textContent = "…";

    try {
      // Create label
      const createRes  = await fetch("/api/labels", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
      });
      const createData = await createRes.json().catch(() => null);
      if (!createData?.ok) throw new Error(createData?.error || "Failed");

      const newLabel = createData.label;

      // Add product to it
      await fetch(`/api/labels/${newLabel.id}/items`, {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_key: entityKey,
          title:   _dbClean(title).slice(0, 200),
          image_url: _dbClean(imageUrl).slice(0, 500) || null,
          brand:   _dbClean(brand).slice(0, 100) || null
        })
      });

      // Refresh panel
      newLabel.item_count = 1;
      labels.unshift(newLabel);
      inLabels.add(newLabel.id);
      _renderLabelPanel(panel, labels, inLabels, entityKey, title, imageUrl, brand);
    } catch (err) {
      alert(err.message || "Failed to create label.");
    } finally {
      if (newSubmit) { newSubmit.disabled = false; newSubmit.textContent = "Add"; }
    }
  }

  if (newSubmit) newSubmit.addEventListener("click", createAndAdd);
  if (newInput)  newInput.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); createAndAdd(); } });
}

async function wireLabelTrigger(entityKey, title, imageUrl, brand) {
  const trigger = document.querySelector("[data-pc-label-trigger='1']");
  if (!trigger) return;

  _labelCurrentKey  = entityKey;
  _labelCurrentMeta = { title, imageUrl, brand };

  if (trigger._pcLabelBound) trigger.removeEventListener("click", trigger._pcLabelBound);

  trigger._pcLabelBound = async function(e) {
    e.preventDefault();
    e.stopPropagation();

    if (_labelPanelOpen) {
      _closeLabelPanel();
      return;
    }

    _ensureLabelPanel();
    _positionPanel(trigger);
    _labelPanelOpen = true;
    await _loadLabelPanel(entityKey, title, imageUrl, brand);
  };

  trigger.addEventListener("click", trigger._pcLabelBound);
}

async function wireProductActions(entityKey, title, imageUrl, brand) {
  if (!entityKey) return;
  await Promise.all([
    wireBookmarkButton(entityKey, title, imageUrl, brand),
    wireLabelTrigger(entityKey, title, imageUrl, brand),
    wireFavoriteButton(entityKey, title, imageUrl, brand)
  ]);
}

function wireBrandFollowButton() {
  const btn = getFollowButton();
  if (!btn || btn._pcFollowBound) return;

  btn._pcFollowBound = true;

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    toggleBrandFollow();
  });
}

function recordHistory(key, title, imageUrl, brand) {
  // Only record for signed-in users and when we have a real key
  if (!key || !title) return;

  // Fire-and-forget — never block the UI
  fetch("/api/history", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entity_key: key,
      title:      String(title || "").trim().slice(0, 200),
      image_url:  String(imageUrl || "").trim().slice(0, 500) || null,
      brand:      String(brand || "").trim().slice(0, 100)    || null
    })
  }).catch(() => {}); // silent fail — history is non-critical
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

    const SELLER_INFO_CACHE = new Map();

  function sellerSlugFromStore(store){
    const raw = String(store || '').trim().toLowerCase();
    if (!raw) return '';

    const map = {
      'best buy': 'bestbuy',
      'bestbuy': 'bestbuy',
      'amazon': 'amazon',
      'walmart': 'walmart',
      'target': 'target',
      'apple': 'apple'
    };

    if (map[raw]) return map[raw];

    return raw.replace(/[^a-z0-9]+/g, '');
  }

  function sellerHrefFromStore(store){
    const slug = sellerSlugFromStore(store);
    if (!slug) return '';
    return `/seller/${encodeURIComponent(slug)}/`; // if your real route is /sellers/, change /seller/ to /sellers/
  }

  async function getSellerInfo(store){
    const slug = sellerSlugFromStore(store);
    if (!slug) return { slug: '', found: false, seller: null };

    if (SELLER_INFO_CACHE.has(slug)) {
      return SELLER_INFO_CACHE.get(slug);
    }

    const pending = (async () => {
      try {
        const res = await fetch(`/api/seller?id=${encodeURIComponent(slug)}`, {
          headers: { Accept: 'application/json' }
        });

        if (!res.ok) {
          return { slug, found: false, seller: null };
        }

        const data = await res.json().catch(() => null);

        if (!data || data.ok !== true || !data.found || !data.seller) {
          return { slug, found: false, seller: null };
        }

        return { slug, found: true, seller: data.seller };
      } catch {
        return { slug, found: false, seller: null };
      }
    })();

    SELLER_INFO_CACHE.set(slug, pending);
    return pending;
  }

  function sellerLogoHtml(seller, fallbackName){
    const logo = String(seller?.logo || '').trim();
    const name = String(seller?.name || fallbackName || '').trim();
    if (!logo) return '';

    return `
      <img
        class="offer-logo"
        src="${escapeHtml(logo)}"
        alt="${escapeHtml(name)}"
        loading="lazy"
        decoding="async"
      >
    `;
  }

  function deliveryTextForOffer(offer, seller){
    if (norm(offer?.delivery_estimate)) return norm(offer.delivery_estimate);

    if (offer?.shipping_days != null) {
      const n = Number(offer.shipping_days);
      if (Number.isFinite(n) && n > 0) {
        return `${n} day${n === 1 ? '' : 's'}`;
      }
    }

    if (norm(seller?.policies?.delivery)) return norm(seller.policies.delivery);

    return '';
  }

  function shippingTextForOffer(offer, seller){
    if (offer?.free_shipping === true || offer?.shipping_cost === 0) return 'Free';

    if (typeof offer?.shipping_cost === 'number' && offer.shipping_cost > 0) {
      return fmt.format(offer.shipping_cost / 100);
    }

    if (norm(seller?.policies?.free_shipping_threshold)) {
      return `${norm(seller.policies.free_shipping_threshold)}`;
    }

    if (norm(seller?.policies?.shipping)) return norm(seller.policies.shipping);

    return '';
  }

  function returnsTextForOffer(offer, seller){
    if (norm(offer?.return_policy)) return norm(offer.return_policy);

    if (offer?.return_days != null) {
      const n = Number(offer.return_days);
      if (Number.isFinite(n) && n > 0) {
        return `${n}-day returns`;
      }
    }

    if (norm(seller?.policies?.return_period)) {
      return `${norm(seller.policies.return_period)} returns`;
    }

    return '';
  }

  function sellerFallbackHtml(sellerHref, hasSeller){
    if (hasSeller && sellerHref) {
      return `<a class="offer-detail-link" href="${escapeHtml(sellerHref)}">See site</a>`;
    }
    return 'Coming soon';
  }

  function sellerValueOrFallback(value, sellerHref, hasSeller){
    const text = String(value || '').trim();
    if (text) return escapeHtml(text);
    return sellerFallbackHtml(sellerHref, hasSeller);
  }

    async function renderOffers(sortByPrice){
    const wrap = $('#offers');
    wrap.innerHTML = '';

    const note = $('#offersNote');

    if (!state.offers.length) {
      note.textContent = '';
      return;
    }

    let arr = state.offers.map(o => {
      const cents = bestComparableCents(o);
      const price = (typeof cents === 'number') ? cents / 100 : null;
      return { ...o, _price: price, _price_cents: cents };
    });

    if (sortByPrice) {
      arr = arr.sort((a, b) => {
        if (a._price == null && b._price == null) return 0;
        if (a._price == null) return 1;
        if (b._price == null) return -1;
        return a._price - b._price;
      });
    }

    const sellerRows = await Promise.all(
      arr.map(async (o) => {
        const sellerInfo = await getSellerInfo(o.store);

        return {
          offer: o,
          seller: sellerInfo?.seller || null,
          hasSeller: sellerInfo?.found === true,
          sellerHref: sellerHrefFromStore(o.store)
        };
      })
    );

    sellerRows.forEach(({ offer: o, seller, hasSeller, sellerHref }) => {
      const bestLink = o.url || canonicalLink(o.store, o) || '';
      const storeDisplay = titleCase(seller?.name || o.store || '');
      const tag = (o.offer_tag || '').trim();
      const priceText = (o._price != null) ? `${fmt.format(o._price)}` : 'No price';

      const logoHtml = sellerLogoHtml(seller, storeDisplay);

      const logoSlotHtml = logoHtml
      ? (
          hasSeller && sellerHref
            ? `<a class="offer-logo-link" href="${escapeHtml(sellerHref)}" aria-label="Open ${escapeHtml(storeDisplay)} seller page">${logoHtml}</a>`
            : `<span class="offer-logo-link is-static" aria-hidden="true">${logoHtml}</span>`
        )
      : `<span class="offer-logo-spacer" aria-hidden="true"></span>`;

      const deliveryHtml = sellerValueOrFallback(
        deliveryTextForOffer(o, seller),
        sellerHref,
        hasSeller
      );

      const shippingHtml = sellerValueOrFallback(
        shippingTextForOffer(o, seller),
        sellerHref,
        hasSeller
      );

      const returnsHtml = sellerValueOrFallback(
        returnsTextForOffer(o, seller),
        sellerHref,
        hasSeller
      );

      const seeMoreHtml = (hasSeller && sellerHref)
        ? `<a class="offer-see-more__link" href="${escapeHtml(sellerHref)}">See more</a>`
        : `<span class="offer-see-more__coming">Coming soon</span>`;

      const row = document.createElement('div');
      row.className = 'offer';

      row.innerHTML = `
        <div class="offer-left">
          ${logoSlotHtml}

          <div class="offer-left-main">
            <div class="offer-store-row">
              <span class="offer-store">${escapeHtml(storeDisplay)}</span>
              ${
                bestLink
                  ? `<a class="offer-go-inline" href="${escapeHtml(bestLink)}" target="_blank" rel="noopener" aria-label="Go to ${escapeHtml(storeDisplay)}">${OFFER_EXTERNAL_SVG}</a>`
                  : ''
              }
            </div>

            <div class="muted-price offer-price">${escapeHtml(priceText)}</div>
          </div>
        </div>

        <div class="offer-tag-col muted">${tag ? escapeHtml(tag) : ''}</div>

        <button class="offer-expand-btn" type="button" aria-expanded="false" aria-label="Show seller details">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="9 6 15 12 9 18"/>
          </svg>
        </button>
      `;

      const details = document.createElement('div');
      details.className = 'offer-details';
      details.hidden = true;

      details.innerHTML = `
        <div class="offer-details-grid">
          <div class="offer-detail-cell">
            <div class="offer-detail-label">Delivery</div>
            <div class="offer-detail-value">${deliveryHtml}</div>
          </div>

          <div class="offer-detail-cell">
            <div class="offer-detail-label">Shipping</div>
            <div class="offer-detail-value">${shippingHtml}</div>
          </div>

          <div class="offer-detail-cell">
            <div class="offer-detail-label">Returns</div>
            <div class="offer-detail-value">${returnsHtml}</div>
          </div>
        </div>

        <div class="offer-see-more">
          ${seeMoreHtml}
        </div>
      `;

      row.querySelector('.offer-expand-btn').addEventListener('click', () => {
        const open = details.hidden;
        details.hidden = !open;
        row.querySelector('.offer-expand-btn').setAttribute('aria-expanded', String(open));
        row.querySelector('.offer-expand-btn').classList.toggle('is-open', open);
      });

      const wrapper = document.createElement('div');
      wrapper.className = 'offer-wrapper';
      wrapper.appendChild(row);
      wrapper.appendChild(details);
      wrap.appendChild(wrapper);
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
              <div class="pc-similar-price">&#9733;</div>
            </div>

            <div class="pc-similar-main">
              <div class="pc-similar-brand muted">${escapeHtml(brand)}</div>
              <div class="pc-similar-title">${escapeHtml(title)}</div>
              <div class="pc-similar-price-row muted">${escapeHtml(price)}</div>
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
  const ul = $('#forensicsList');
  if (!ul) return;

  ul.innerHTML = '';
  [
    'Strike is consistent with recent range for this variant',
    'Variant IDs match',
    'Anchor price looks reasonable'
  ].forEach(t => {
    const li = document.createElement('li');
    li.textContent = t;
    ul.appendChild(li);
  });
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

function codeItemsFromState() {
  const id = state.identity || {};

  const pci = String(id.selected_pci || '').trim();
  const upc = cleanUpc(id.selected_upc || '');
  const asin = up(id.asin || '');

  const out = [];
  if (pci) out.push({ kind: 'PCI', value: pci });
  if (upc) out.push({ kind: 'UPC', value: upc });
  if (asin) out.push({ kind: 'ASIN', value: asin });

  return out;
}

function renderCodeButtonState() {
  const btn = document.getElementById('phCodeBtn');
  if (!btn) return;

  const hasCodes = codeItemsFromState().length > 0;

  btn.disabled = !hasCodes;
  btn.setAttribute('aria-disabled', hasCodes ? 'false' : 'true');
  btn.title = hasCodes ? 'View product codes' : 'No product codes available';
}

function _ensureCodePanel() {
  if (_codePanelEl) return _codePanelEl;

  _codePanelEl = document.createElement('div');
  _codePanelEl.id = 'pcCodePanel';
  _codePanelEl.className = 'pc-code-panel';
  _codePanelEl.hidden = true;
  document.body.appendChild(_codePanelEl);

  document.addEventListener('click', (e) => {
    if (
      _codePanelOpen &&
      !_codePanelEl.contains(e.target) &&
      !e.target.closest("[data-pc-code-trigger='1']")
    ) {
      _closeCodePanel();
    }
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _codePanelOpen) _closeCodePanel();
  });

  return _codePanelEl;
}

function _closeCodePanel() {
  if (!_codePanelEl) return;
  _codePanelEl.hidden = true;
  _codePanelOpen = false;
}

function _renderCodePanel() {
  const panel = _ensureCodePanel();
  const items = codeItemsFromState();

  if (!items.length) {
    panel.innerHTML = `
      <div class="pc-code-panel__head">Codes</div>
      <div class="pc-code-panel__empty">No product codes available.</div>
    `;
    return;
  }

  panel.innerHTML = `
    <div class="pc-code-panel__head">Codes</div>
    <div class="pc-code-panel__list">
      ${items.map(item => `
        <button
          type="button"
          class="pc-code-pill"
          data-code-copy="${escapeHtml(item.value)}"
        >
          <span class="pc-code-pill__kind">${escapeHtml(item.kind)}</span>
          <span class="pc-code-pill__value">${escapeHtml(item.value)}</span>
        </button>
      `).join('')}
    </div>
    <div class="pc-code-panel__hint">Click a code to copy it.</div>
  `;

  panel.querySelectorAll('[data-code-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const value = String(btn.getAttribute('data-code-copy') || '').trim();
      if (!value) return;

      const ok = await copyText(value);
      if (!ok) return;

      const valueEl = btn.querySelector('.pc-code-pill__value');
      if (!valueEl) return;

      const original = valueEl.textContent;
      valueEl.textContent = 'Copied';

      clearTimeout(btn._pcCodeCopyT);
      btn._pcCodeCopyT = setTimeout(() => {
        valueEl.textContent = original;
      }, 900);
    });
  });
}

function wireCodeButton() {
  const btn = document.getElementById('phCodeBtn');
  if (!btn || btn._pcBound) return;

  btn._pcBound = true;

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (btn.disabled) return;

    if (_codePanelOpen) {
      _closeCodePanel();
      return;
    }

    _renderCodePanel();
    _codePanelEl.hidden = false;
    _codePanelOpen = true;
  });
}

function wireHeaderToolButtons() {
  const moreBtn = document.getElementById('phMoreToolsBtn');
  if (!moreBtn || moreBtn._pcBound) return;

  moreBtn._pcBound = true;

  moreBtn.addEventListener('click', (e) => {
    e.preventDefault();
    window.location.href = '/apps/';
  });
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

  function normalizeContentsInput(raw){
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray(raw.items)) return raw.items;
  return [];
}

function contentsSource(){
  const cur = getCurrentVariant() || null;

  if (Array.isArray(cur?.contents)) return cur.contents;
  if (cur?.contents && typeof cur.contents === 'object' && Array.isArray(cur.contents.items)) {
    return cur.contents.items;
  }

  if (Array.isArray(state.identity?.contents)) return state.identity.contents;
  if (state.identity?.contents && typeof state.identity.contents === 'object' && Array.isArray(state.identity.contents.items)) {
    return state.identity.contents.items;
  }

  return [];
}

function parseContentsItem(input, index){
  if (typeof input === 'string') {
    const label = String(input).trim();
    if (!label) return null;

    return {
      label,
      qty: null,
      note: ''
    };
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }

  const label = String(
    input.label ||
    input.name ||
    input.title ||
    input.item ||
    ''
  ).trim();

  if (!label) return null;

  const rawQty = input.qty ?? input.quantity ?? input.count ?? null;
  const qtyNum = Number(rawQty);
  const qty = Number.isInteger(qtyNum) && qtyNum > 0 ? qtyNum : null;

  const note = String(
    input.note ||
    input.description ||
    ''
  ).trim();

  return {
    label,
    qty,
    note
  };
}

function renderContents(){
  if (!contentsCard || !contentsContent) return;

  const items = normalizeContentsInput(contentsSource())
    .map((item, index) => parseContentsItem(item, index))
    .filter(Boolean);

  if (!items.length) {
    contentsCard.hidden = true;
    contentsContent.innerHTML = '';
    return;
  }

  contentsCard.hidden = false;

  const totalPieces = items.reduce((sum, item) => {
    return sum + (item.qty != null ? item.qty : 1);
  }, 0);

  const summaryText =
    totalPieces === items.length
      ? `${items.length} item${items.length === 1 ? '' : 's'} in the box`
      : `${items.length} line items, ${totalPieces} total pieces`;

  contentsContent.innerHTML = `
    <div class="pc-contents-grid">
      ${items.map((item) => `
        <article class="pc-content-item">
          <div class="pc-content-item__top">
            <div class="pc-content-item__label">${escapeHtml(item.label)}</div>
            ${item.qty != null ? `<div class="pc-content-item__qty">x${escapeHtml(String(item.qty))}</div>` : ''}
          </div>

          ${item.note ? `<div class="pc-content-item__note">${escapeHtml(item.note)}</div>` : ''}
        </article>
      `).join('')}
    </div>
  `;
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

      ${
        active
          ? `
            <div class="pc-file-viewer" role="tabpanel">
              ${renderFilePreview(active)}
            </div>
          `
          : ''
      }
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

const DIMENSION_FIELD_KEYS = new Set([
  'length_in', 'len_in',
  'width_in', 'wid_in',
  'height_in', 'thickness_in',
  'depth_in',
  'weight_lb',
  'screen_in',
  'length_cm', 'len_cm',
  'width_cm', 'wid_cm',
  'height_cm', 'thickness_cm',
  'depth_cm',
  'weight_kg',
  'screen_cm'
]);

function hasDimensionFields(raw){
  const obj = dimObj(raw);
  if (!obj) return false;

  return Object.keys(obj).some((key) => DIMENSION_FIELD_KEYS.has(String(key || '').trim()));
}

function collectDimensionSections(raw){
  const src = dimObj(raw);
  if (!src) return [];

  const out = [];
  const seen = new Set();

  function pushSection(label, value){
    const dims = normalizeDimensions(value);
    if (!dims) return;

    const cleanLabel = String(label || '').trim() || 'Dimensions';
    const sig = cleanLabel.toLowerCase();
    if (seen.has(sig)) return;
    seen.add(sig);

    out.push({
      label: cleanLabel,
      dims
    });
  }

  // Support the old flat structure
  if (hasDimensionFields(src)) {
    pushSection('Dimensions', src);
  }

  // Support nested custom groups like Folded / Open / Closed / Unfolded
  for (const [key, value] of Object.entries(src)) {
    if (!dimObj(value)) continue;
    if (!hasDimensionFields(value)) continue;
    pushSection(key, value);
  }

  return out;
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

function selectedDimensionSections(){
  const cur = getCurrentVariant();

  const fromVariant = collectDimensionSections(cur?.dimensions);
  if (fromVariant.length) return fromVariant;

  const fromIdentity = collectDimensionSections(state.identity?.dimensions);
  if (fromIdentity.length) return fromIdentity;

  return [];
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

  const svgW = 520;
  const svgH = 260;

  const maxFrontW = 250;
  const maxFrontH = 132;
  const maxDepth = 54;
  const minDepth = zIn != null ? 12 : 8;

  const baseScale = Math.min(maxFrontW / rawX, maxFrontH / rawY);

  let frontW = rawX * baseScale;
  let frontH = rawY * baseScale;
  let depth = Math.max(minDepth, Math.min(maxDepth, rawZ * baseScale));

  const maxTotalW = 340;
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
    <svg class="dim-visual" viewBox="0 0 ${svgW} ${svgH}" role="img" aria-label="Proportional dimensions diagram">
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

function renderDimensionSection(section, unit, showHeading){
  const d = section?.dims;
  if (!d) return '';

  const { xIn, yIn, zIn } = getDimensionAxes(d);

  const axisValues = [xIn, yIn, zIn].filter(v => v != null);
  const axisText = axisValues.map(v => unit === 'metric' ? dimText(v * 2.54) : dimText(v));
  const axisUnit = unit === 'metric' ? 'cm' : 'in';

  const visual = renderDimensionVisual(d, unit);
  const stats = [];

  if (!(visual && zIn != null) && axisText.length >= 2) {
    stats.push(renderDimStat('Size', `${axisText.join(' x ')} ${axisUnit}`));
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

  if (!visual && !stats.length) return '';

  return `
    <section class="dim-section">
      ${
        showHeading
          ? `<h3 class="dim-section__title">${escapeHtml(section.label || 'Dimensions')}</h3>`
          : ''
      }

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

        ${
          stats.length
            ? `
              <div class="dim-grid">
                ${stats.join('')}
              </div>
            `
            : ''
        }
      </div>
    </section>
  `;
}

function renderDimensions(){
  if (!dimCard || !dimContent) return;

  const sections = selectedDimensionSections();

  if (!sections.length) {
    dimCard.hidden = true;
    if (dimToggle) dimToggle.innerHTML = '';
    dimContent.innerHTML = '';
    return;
  }

  const unit = state.dimUnit === 'metric' ? 'metric' : 'imperial';

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

  const showSectionHeadings =
    sections.length > 1 ||
    (sections.length === 1 && String(sections[0]?.label || '').trim().toLowerCase() !== 'dimensions');

  dimContent.innerHTML = `
    <div class="dim-sections">
      ${sections.map(section => renderDimensionSection(section, unit, showSectionHeadings)).join('')}
    </div>
  `;
}

  window.run = run;

  function _dbClean(v) { return String(v || "").trim(); }

  function _dbEsc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  window.addEventListener('popstate', () => {
    const raw = currentKeyFromUrl();
    if (raw) run(raw);
  });
})();