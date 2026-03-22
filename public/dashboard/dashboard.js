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
    selectedVersion: null,
    selectedVariant2: null,
    selectedColor: null,
    lastKey:null,
    dimUnit: 'imperial',
    selectedFileIndex: -1,
    selectedLineupFamily: null,
    followBrand: '',
    followingBrand: false,
    followStateKnown: false,
    followBusy: false,
    mediaGroups: { images: [], videos: [], shorts: [] },
    activeMediaGroup: 'images',
    activeMediaIndex: 0,
    mediaBound: false,
    community: {
      tips: [],
      questions: [],
      reviews: [],
      counts: { tips: 0, questions: 0, reviews: 0 }
    },
  };

  let _runToken = 0;

  const tocEl = document.getElementById('dashboardToc');
  let _tocResizeObserver = null;
  let _tocMutationObserver = null;
  let _tocRefreshRaf = 0;
  let _tocScrollItems = [];
  let _tocScrollRaf = 0;
  let _tocScrollHandler = null;

  const PRODUCT_HEADER_TOC_ICON_PATH = 'M240-200h120v-240h240v240h120v-360L480-740 240-560v360Zm-80 80v-480l320-240 320 240v480H520v-240h-80v240H160Zm320-350Z';
  const QA_REPLY_ICON_PATH = 'M760-200v-160q0-50-35-85t-85-35H273l144 144-57 56-240-240 240-240 57 56-144 144h367q83 0 141.5 58.5T840-360v160h-80Z';

  function getDashboardHeaderOffset() {
    const host = document.getElementById('site-header');
    if (!host) return 88;

    const rect = host.getBoundingClientRect();
    const height = Math.max(host.offsetHeight || 0, rect.height || 0);

    return Math.max(72, Math.round(height));
  }

  function setDashboardOffsetVars() {
    const top = getDashboardHeaderOffset() + 12;
    document.documentElement.style.setProperty('--pc-dashboard-header-offset', `${top}px`);
  }

  function isActuallyVisible(el) {
    if (!el || el.hidden) return false;

    const cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;

    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  function createTocIconMarkup(pathData) {
    const d = String(pathData || '').trim();
    if (!d) return '';

    return `
      <svg viewBox="0 -960 960 960" aria-hidden="true" focusable="false">
        <path d="${escapeHtml(d)}"></path>
      </svg>
    `;
  }

  function getDashboardTocCards() {
  const wrap = document.querySelector('main.wrap');
  const productHeader = document.getElementById('productHeader');

  const cards = [];
  const seen = new Set();

  function pushCard(el) {
    if (!el) return;
    if (seen.has(el)) return;
    seen.add(el);
    cards.push(el);
  }

  if (productHeader) {
    pushCard(productHeader);
  }

  if (wrap) {
    wrap.querySelectorAll('section.card[id]').forEach((el) => {
      if (el.id === 'productHeader') return;
      if (el.closest('aside')) return;
      pushCard(el);
    });
  }

  return cards
    .filter((el) => {
      return el &&
        el.tagName === 'SECTION' &&
        el.classList.contains('card') &&
        !!el.id;
    })
    .map((card) => {
      if (!isActuallyVisible(card)) return null;

      if (card.id === 'productHeader') {
        return {
          id: 'productHeader',
          label: 'Overview',
          pathData: PRODUCT_HEADER_TOC_ICON_PATH,
          card
        };
      }

      const h2 = card.querySelector('h2[data-icon-path]');
      if (!h2) return null;

      const pathData = String(h2.getAttribute('data-icon-path') || '').trim();
      const label = normalizeSpaces(h2.textContent || card.id);

      if (!pathData || !label) return null;

      return {
        id: card.id,
        label,
        pathData,
        card
      };
    })
    .filter(Boolean);
}

  function setDashboardTocActive(targetId) {
    if (!tocEl) return;

    tocEl.querySelectorAll('.dashboard-toc__btn').forEach((btn) => {
      const isActive = String(btn.getAttribute('data-target') || '') === String(targetId || '');
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-current', isActive ? 'true' : 'false');
    });
  }

  function getDashboardTocActiveId(items) {
  if (!Array.isArray(items) || !items.length) return '';

  const cutoff = getDashboardHeaderOffset() + 28;
  let fallbackId = items[0].id;

  for (const item of items) {
    if (!item || !item.card) continue;

    const rect = item.card.getBoundingClientRect();

    if (rect.top <= cutoff) {
      fallbackId = item.id;
    }

    if (rect.top <= cutoff && rect.bottom > cutoff) {
      return item.id;
    }
  }

  return fallbackId;
}

function scheduleDashboardTocActiveSync() {
  if (_tocScrollRaf) return;

  _tocScrollRaf = requestAnimationFrame(() => {
    _tocScrollRaf = 0;

    if (!tocEl || !_tocScrollItems.length) return;

    const activeId = getDashboardTocActiveId(_tocScrollItems);
    if (activeId) {
      setDashboardTocActive(activeId);
    }
  });
}

  function scrollToDashboardCard(card) {
    if (!card) return;

    const offset = getDashboardHeaderOffset() + 18;
    const y = Math.max(
      0,
      Math.round(window.scrollY + card.getBoundingClientRect().top - offset)
    );

    window.scrollTo({
      top: y,
      behavior: 'smooth'
    });
  }

  function observeDashboardToc(items) {

  _tocScrollItems = Array.isArray(items) ? items.slice() : [];

  if (!_tocScrollItems.length) {
    if (_tocScrollRaf) {
      cancelAnimationFrame(_tocScrollRaf);
      _tocScrollRaf = 0;
    }

    if (_tocScrollHandler) {
      window.removeEventListener('scroll', _tocScrollHandler);
      _tocScrollHandler = null;
    }

    return;
  }

  if (!_tocScrollHandler) {
    _tocScrollHandler = () => {
      scheduleDashboardTocActiveSync();
    };

    window.addEventListener('scroll', _tocScrollHandler, { passive: true });
  }

  scheduleDashboardTocActiveSync();
}

function buildDashboardToc() {
  if (!tocEl) return;

  setDashboardOffsetVars();

  const items = getDashboardTocCards();

  if (!items.length) {
    tocEl.hidden = true;
    tocEl.innerHTML = '';

    _tocScrollItems = [];

    if (_tocScrollRaf) {
      cancelAnimationFrame(_tocScrollRaf);
      _tocScrollRaf = 0;
    }

    if (_tocScrollHandler) {
      window.removeEventListener('scroll', _tocScrollHandler);
      _tocScrollHandler = null;
    }

    return;
  }

  tocEl.hidden = false;

  tocEl.innerHTML = `
    <div class="dashboard-toc__inner">
      <div class="dashboard-toc__main">
        ${items.map((item) => `
          <button
            type="button"
            class="dashboard-toc__btn"
            data-target="${escapeHtml(item.id)}"
            aria-label="Jump to ${escapeHtml(item.label)}"
            title="${escapeHtml(item.label)}"
          >
            ${createTocIconMarkup(item.pathData)}
          </button>
        `).join('')}
      </div>

      <div class="dashboard-toc__bottom">
        <button
          type="button"
          class="dashboard-toc__btn dashboard-toc__btn--plus"
          id="dashboardTocCommunityBtn"
          aria-label="Contribute"
          title="Contribute"
        >
          <svg viewBox="0 -960 960 960" aria-hidden="true" focusable="false">
            <path d="M440-120v-320H120v-80h320v-320h80v320h320v80H520v320h-80Z"></path>
          </svg>
        </button>

        <button
          type="button"
          class="dashboard-toc__btn dashboard-toc__btn--bottom"
          id="dashboardTocMoreBtn"
          aria-label="More tools"
          title="More tools"
        >
          <svg viewBox="0 -960 960 960" aria-hidden="true" focusable="false">
            <path d="M183.5-183.5Q160-207 160-240t23.5-56.5Q207-320 240-320t56.5 23.5Q320-273 320-240t-23.5 56.5Q273-160 240-160t-56.5-23.5Zm240 0Q400-207 400-240t23.5-56.5Q447-320 480-320t56.5 23.5Q560-273 560-240t-23.5 56.5Q513-160 480-160t-56.5-23.5Zm240 0Q640-207 640-240t23.5-56.5Q687-320 720-320t56.5 23.5Q800-273 800-240t-23.5 56.5Q753-160 720-160t-56.5-23.5Zm-480-240Q160-447 160-480t23.5-56.5Q207-560 240-560t56.5 23.5Q320-513 320-480t-23.5 56.5Q273-400 240-400t-56.5-23.5Zm240 0Q400-447 400-480t23.5-56.5Q447-560 480-560t56.5 23.5Q560-513 560-480t-23.5 56.5Q513-400 480-400t-56.5-23.5Zm240 0Q640-447 640-480t23.5-56.5Q687-560 720-560t56.5 23.5Q800-513 800-480t-23.5 56.5Q753-400 720-400t-56.5-23.5Zm-480-240Q160-687 160-720t23.5-56.5Q207-800 240-800t56.5 23.5Q320-753 320-720t-23.5 56.5Q273-640 240-640t-56.5-23.5Zm240 0Q400-687 400-720t23.5-56.5Q447-800 480-800t56.5 23.5Q560-753 560-720t-23.5 56.5Q513-640 480-640t-56.5-23.5Zm240 0Q640-687 640-720t23.5-56.5Q687-800 720-800t56.5 23.5Q800-753 800-720t-23.5 56.5Q753-640 720-640t-56.5-23.5Z"></path>
          </svg>
        </button>
      </div>
    </div>
  `;

  tocEl.querySelectorAll('.dashboard-toc__btn[data-target]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = String(btn.getAttribute('data-target') || '').trim();
      const target = id ? document.getElementById(id) : null;
      if (!target) return;

      setDashboardTocActive(id);
      scrollToDashboardCard(target);
    });
  });

  const communityBtn = document.getElementById('dashboardTocCommunityBtn');
  if (communityBtn) {
    communityBtn.addEventListener('click', async () => {
      await openCommunityComposerFromTrigger();
    });
  }

  const moreBtn = document.getElementById('dashboardTocMoreBtn');
  if (moreBtn) {
    moreBtn.addEventListener('click', () => {
      window.location.href = '/apps/';
    });
  }

  setDashboardTocActive(getDashboardTocActiveId(items));
  observeDashboardToc(items);
}

  function scheduleDashboardTocRefresh() {
    if (!tocEl) return;

    if (_tocRefreshRaf) {
      cancelAnimationFrame(_tocRefreshRaf);
    }

    _tocRefreshRaf = requestAnimationFrame(() => {
      _tocRefreshRaf = 0;
      buildDashboardToc();
    });
  }

  function initDashboardTocObservers() {
    const host = document.getElementById('site-header');
    if (!host) return;

    if (!_tocResizeObserver && 'ResizeObserver' in window) {
      _tocResizeObserver = new ResizeObserver(() => {
        scheduleDashboardTocRefresh();
      });
      _tocResizeObserver.observe(host);
    }

    if (!_tocMutationObserver) {
      _tocMutationObserver = new MutationObserver(() => {
        scheduleDashboardTocRefresh();
      });
      _tocMutationObserver.observe(host, {
        childList: true,
        subtree: true
      });
    }

    window.addEventListener('resize', scheduleDashboardTocRefresh, { passive: true });
    window.addEventListener('load', scheduleDashboardTocRefresh);
  }

  function nextRunToken() {
    _runToken += 1;
    return _runToken;
  }

  function isStaleRun(token) {
    return token !== _runToken;
  }

  function safeHttpHref(raw, { sameOrigin = false } = {}) {
    const s = String(raw || '').trim();
    if (!s) return '';

    try {
      const u = new URL(s, location.origin);
      const proto = String(u.protocol || '').toLowerCase();

      if (proto !== 'http:' && proto !== 'https:') return '';
      if (sameOrigin && u.origin !== location.origin) return '';

      return u.href;
    } catch {
      return '';
    }
  }

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

  const desc = `Compare prices, price history, store offers, and verified coupons for ${cleanTitle} on PriceCheck.`;

  const pretty = prettyDashboardUrl(key, cleanTitle);
  const canonical = `${canonicalOriginForMeta()}${pretty.pathname}`;
  const img = absoluteImageForMeta(imageUrl);

  setMeta('description', desc);
  setCanonical(canonical);

  setOg('og:type', 'product');
  setOg('og:site_name', 'PriceCheck');
  setOg('og:title', pageTitle);
  setOg('og:description', desc);
  setOg('og:url', canonical);
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

    if (/^\d{6,7}$/.test(t)) return normalizeKey(`bby:${t}`);
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

let versionCard = null;
let versionPills = null;

function ensureVersionCard(){
  versionCard = null;
  versionPills = null;
  return { versionCard: null, versionPills: null };
}

const variantColorSection = document.getElementById('variantColorSection');
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
const aboutCard = document.getElementById('aboutCard');
const aboutParagraphs = document.getElementById('aboutParagraphs');
const aboutPoints = document.getElementById('aboutPoints');
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

function syncVariantColorSectionVisibility(){
  if (!variantColorSection) return;

  const showVariant = !!(variant2Card && !variant2Card.hidden);
  const showColor = !!(colorCard && !colorCard.hidden);

  variantColorSection.hidden = !(showVariant || showColor);
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

function versionChoicesForVariants(list){
  const seen = new Set();
  const out = [];

  for (const v of list){
    const label = normalizeSpaces(versionOf(v) || 'Default');
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

function setTopbarRatingSummary(overall, count){
  const wrap = document.getElementById('phRatingSummary');
  const scoreEl = document.getElementById('phRatingScore');
  const countEl = document.getElementById('phRatingCount');

  if (!wrap || !scoreEl || !countEl) return;

  const scoreNum = Number(overall);
  const countNum = Number(count);

  if (!Number.isFinite(scoreNum) || scoreNum <= 0 || !Number.isFinite(countNum) || countNum <= 0) {
    wrap.hidden = true;
    scoreEl.textContent = '';
    countEl.textContent = '';
    return;
  }

  wrap.hidden = false;
  scoreEl.textContent = `★ ${scoreNum.toFixed(1)}`;
  countEl.textContent = `(${new Intl.NumberFormat('en-US').format(countNum)})`;
}

function clearTopbarRatingSummary(){
  setTopbarRatingSummary(null, null);
}

function communityAvatarHtml(name, imageUrl){
  const img = String(imageUrl || '').trim();
  const safeName = String(name || 'User').trim() || 'User';

  if (img) {
    return `<img class="pc-tip-card__avatar" src="${escapeHtml(img)}" alt="${escapeHtml(safeName)}" loading="lazy" decoding="async">`;
  }

  return `<div class="pc-tip-card__avatar"></div>`;
}

function communityRelativeTime(raw){
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';

  const diffMs = Date.now() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return '1 day ago';
  if (diffDays < 30) return `${diffDays} days ago`;

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths === 1) return '1 month ago';
  if (diffMonths < 12) return `${diffMonths} months ago`;

  const diffYears = Math.floor(diffMonths / 12);
  if (diffYears === 1) return '1 year ago';
  return `${diffYears} years ago`;
}

function communityVisitedLabel(raw){
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';

  return `Used ${new Intl.DateTimeFormat(undefined, {
    month: 'short',
    year: 'numeric'
  }).format(d)}`;
}

function communityStars(n){
  const rating = Math.max(1, Math.min(5, Number(n || 0)));
  if (!Number.isFinite(rating) || rating < 1) return '';
  return '★'.repeat(rating) + '☆'.repeat(5 - rating);
}

function answerCountLabel(n){
  const count = Math.max(0, Number(n || 0));
  return count === 1 ? '1 Answer' : `${count} Answers`;
}

function replyIconSvg(){
  return `
    <svg viewBox="0 -960 960 960" width="20" height="20" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="${QA_REPLY_ICON_PATH}"></path>
    </svg>
  `;
}

let _communityQaModalEl = null;
let _communityQaModalOpen = false;

function ensureCommunityQaModal(){
  if (_communityQaModalEl) return _communityQaModalEl;

  const el = document.createElement('div');
  el.id = 'pcCommunityQaModal';
  el.hidden = true;
  el.style.cssText = `
    position:fixed;
    inset:0;
    z-index:9600;
    display:flex;
    align-items:center;
    justify-content:center;
    padding:24px;
    background:rgba(15,23,42,.48);
  `;

  el.innerHTML = `
    <div style="
      width:min(760px, 100%);
      max-height:min(88vh, 820px);
      overflow:auto;
      background:#fff;
      border:1px solid rgba(15,23,42,.08);
      border-radius:20px;
      box-shadow:0 24px 70px rgba(15,23,42,.18);
    ">
      <div id="pcCommunityQaModalInner"></div>
    </div>
  `;

  el.addEventListener('click', (e) => {
    if (e.target === el) closeCommunityQaModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _communityQaModalOpen) {
      closeCommunityQaModal();
    }
  });

  document.body.appendChild(el);
  _communityQaModalEl = el;
  return el;
}

function closeCommunityQaModal(){
  if (!_communityQaModalEl) return;
  _communityQaModalEl.hidden = true;
  _communityQaModalOpen = false;
}

async function getCommunityViewerSignedIn(){
  try {
    const res = await fetch('/api/auth/me', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });

    const data = await res.json().catch(() => null);
    return !!data?.user?.id;
  } catch {
    return false;
  }
}

async function submitQuestionReply(questionId, body){
  const res = await fetch(`/api/community/question/${encodeURIComponent(questionId)}/answers`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ body })
  });

  const data = await res.json().catch(() => null);

  if (res.status === 401) {
    if (typeof window.pcOpenSignIn === 'function') {
      window.pcOpenSignIn();
      return { ok: false, auth: true };
    }
    throw new Error('Please sign in first.');
  }

  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || 'Could not save reply.');
  }

  return { ok: true, data };
}

async function openQuestionAnswersModal(questionId){
  const host = ensureCommunityQaModal();
  const inner = document.getElementById('pcCommunityQaModalInner');
  if (!inner) return;

  _communityQaModalOpen = true;
  host.hidden = false;

  inner.innerHTML = `
    <div style="padding:22px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between;gap:12px;">
      <div>
        <div style="font-size:20px;font-weight:700;color:#0f172a;">Answers</div>
        <div style="font-size:14px;color:#64748b;margin-top:4px;">Loading replies...</div>
      </div>
      <button type="button" id="pcCommunityQaModalClose" style="border:none;background:transparent;font-size:30px;line-height:1;cursor:pointer;color:#64748b;">×</button>
    </div>
  `;

  const closeBtn0 = document.getElementById('pcCommunityQaModalClose');
  if (closeBtn0) closeBtn0.addEventListener('click', closeCommunityQaModal);

  try {
    const [answersRes, signedIn] = await Promise.all([
      fetch(`/api/community/question/${encodeURIComponent(questionId)}/answers`, {
        headers: { Accept: 'application/json' }
      }),
      getCommunityViewerSignedIn()
    ]);

    const data = await answersRes.json().catch(() => null);

    if (!answersRes.ok || !data?.ok) {
      throw new Error(data?.error || 'Could not load answers.');
    }

    const question = data.question || {};
    const answers = Array.isArray(data.answers) ? data.answers : [];

    inner.innerHTML = `
      <div style="padding:22px;border-bottom:1px solid #e5e7eb;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
        <div style="min-width:0;">
          <div style="font-size:22px;font-weight:700;color:#0f172a;">${escapeHtml(question.title || 'Question')}</div>
          ${question.body ? `<div style="font-size:17px;color:#475569;margin-top:8px;line-height:1.55;">${escapeHtml(question.body)}</div>` : ''}
          <div style="font-size:14px;color:#64748b;margin-top:10px;">Asked by ${escapeHtml(question.author_name || 'User')}</div>
        </div>
        <button type="button" id="pcCommunityQaModalClose" style="border:none;background:transparent;font-size:30px;line-height:1;cursor:pointer;color:#64748b;">×</button>
      </div>

      <div style="padding:20px;display:grid;gap:14px;">
        ${
          signedIn
            ? `
              <form id="pcQaModalReplyForm" style="display:grid;gap:10px;">
                <textarea
                  id="pcQaModalReplyBody"
                  rows="3"
                  maxlength="1000"
                  placeholder="Write a reply..."
                  style="width:100%;padding:12px 14px;border:1px solid #dbe2ea;border-radius:12px;font:inherit;resize:vertical;"
                  required
                ></textarea>

                <div id="pcQaModalReplyError" hidden style="font-size:14px;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:12px 14px;"></div>

                <div style="display:flex;justify-content:flex-end;">
                  <button type="submit" id="pcQaModalReplySubmit" style="padding:10px 16px;border:none;border-radius:12px;background:#111827;color:#fff;font:inherit;font-weight:700;cursor:pointer;">
                    Reply
                  </button>
                </div>
              </form>
            `
            : ''
        }

        <div style="display:grid;gap:12px;">
          ${
            answers.length
              ? answers.map((a) => `
                  <article style="border:1px solid #e5e7eb;border-radius:16px;padding:14px 16px;">
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                      ${communityAvatarHtml(a.author_name, a.profile_image_url)}
                      <div>
                        <div style="font-size:16px;font-weight:700;color:#0f172a;">${escapeHtml(a.author_name || 'User')}</div>
                        <div style="font-size:14px;color:#64748b;">${escapeHtml(communityRelativeTime(a.created_at) || '')}</div>
                      </div>
                    </div>
                    <div style="font-size:16px;line-height:1.6;color:#334155;">${escapeHtml(a.body || '')}</div>
                  </article>
                `).join('')
              : '<div class="sidebar-empty">No answers yet.</div>'
          }
        </div>
      </div>
    `;

    const closeBtn = document.getElementById('pcCommunityQaModalClose');
    if (closeBtn) closeBtn.addEventListener('click', closeCommunityQaModal);

    const replyForm = document.getElementById('pcQaModalReplyForm');
    if (replyForm) {
      replyForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const bodyEl = document.getElementById('pcQaModalReplyBody');
        const errorEl = document.getElementById('pcQaModalReplyError');
        const submitBtn = document.getElementById('pcQaModalReplySubmit');

        const body = String(bodyEl?.value || '').trim();

        if (errorEl) {
          errorEl.hidden = true;
          errorEl.textContent = '';
        }

        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Posting...';
        }

        try {
          await submitQuestionReply(questionId, body);
          await Promise.all([
            openQuestionAnswersModal(questionId),
            renderCommunityCard(state.lastKey, null)
          ]);
        } catch (err) {
          if (errorEl) {
            errorEl.hidden = false;
            errorEl.textContent = String(err?.message || 'Could not save reply.');
          }
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Reply';
          }
        }
      });
    }
  } catch (err) {
    inner.innerHTML = `
      <div style="padding:22px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between;gap:12px;">
        <div style="font-size:20px;font-weight:700;color:#0f172a;">Answers</div>
        <button type="button" id="pcCommunityQaModalClose" style="border:none;background:transparent;font-size:30px;line-height:1;cursor:pointer;color:#64748b;">×</button>
      </div>
      <div style="padding:20px;">
        <div class="sidebar-empty">${escapeHtml(String(err?.message || 'Could not load answers.'))}</div>
      </div>
    `;

    const closeBtn = document.getElementById('pcCommunityQaModalClose');
    if (closeBtn) closeBtn.addEventListener('click', closeCommunityQaModal);
  }
}

let _communityComposerEl = null;
let _communityComposerOpen = false;
let _communityComposerMode = '';

function ensureCommunityComposer(){
  if (_communityComposerEl) return _communityComposerEl;

  const el = document.createElement('div');
  el.id = 'pcCommunityComposer';
  el.hidden = true;
  el.style.cssText = `
    position:fixed;
    inset:0;
    z-index:9500;
    display:flex;
    align-items:center;
    justify-content:center;
    padding:24px;
    background:rgba(15,23,42,.42);
  `;

  el.innerHTML = `
    <div style="
      width:min(560px, 100%);
      max-height:min(88vh, 760px);
      overflow:auto;
      background:#fff;
      border:1px solid rgba(15,23,42,.08);
      border-radius:20px;
      box-shadow:0 24px 70px rgba(15,23,42,.18);
    ">
      <div id="pcCommunityComposerInner"></div>
    </div>
  `;

  el.addEventListener('click', (e) => {
    if (e.target === el) closeCommunityComposer();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _communityComposerOpen) {
      closeCommunityComposer();
    }
  });

  document.body.appendChild(el);
  _communityComposerEl = el;
  return el;
}

function closeCommunityComposer(){
  if (!_communityComposerEl) return;
  _communityComposerEl.hidden = true;
  _communityComposerOpen = false;
  _communityComposerMode = '';
}

function openCommunityComposer(){
  const host = ensureCommunityComposer();
  const inner = document.getElementById('pcCommunityComposerInner');
  if (!inner) return;

  _communityComposerOpen = true;
  host.hidden = false;
  _communityComposerMode = '';

  inner.innerHTML = `
    <div style="padding:22px 22px 14px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between;gap:12px;">
      <div>
        <div style="font-size:22px;font-weight:600;color:#0f172a;">Contribute</div>
        <div style="font-size:16px;color:#64748b;margin-top:4px;">Choose what you want to share for this product.</div>
      </div>
      <button type="button" id="pcCommunityComposerClose" style="border:none;background:transparent;font-size:34px;line-height:1;cursor:pointer;color:#64748b;">×</button>
    </div>

    <div style="padding:20px;display:grid;gap:12px;">
      <button type="button" class="pc-community-choice-btn" data-community-choice="review" style="text-align:left;padding:16px;border:1px solid #e5e7eb;border-radius:16px;background:#fff;cursor:pointer;">
        <div style="font-size:18px;font-weight:600;color:#0f172a;">Post Review</div>
        <div style="font-size:16px;color:#64748b;margin-top:4px;">Share your experience and give a rating.</div>
      </button>

      <button type="button" class="pc-community-choice-btn" data-community-choice="question" style="text-align:left;padding:16px;border:1px solid #e5e7eb;border-radius:16px;background:#fff;cursor:pointer;">
        <div style="font-size:18px;font-weight:600;color:#0f172a;">Ask Question</div>
        <div style="font-size:16px;color:#64748b;margin-top:4px;">Ask something about this product.</div>
      </button>

      <button type="button" class="pc-community-choice-btn" data-community-choice="tip" style="text-align:left;padding:16px;border:1px solid #e5e7eb;border-radius:16px;background:#fff;cursor:pointer;">
        <div style="font-size:18px;font-weight:600;color:#0f172a;">Give Insider Tip</div>
        <div style="font-size:16px;color:#64748b;margin-top:4px;">Share a short buying or usage tip.</div>
      </button>
    </div>
  `;

  const closeBtn = document.getElementById('pcCommunityComposerClose');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeCommunityComposer);
  }

  inner.querySelectorAll('[data-community-choice]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const type = String(btn.getAttribute('data-community-choice') || '').trim();
      if (!type) return;
      renderCommunityComposerForm(type);
    });
  });
}

function renderCommunityComposerForm(type){
  const inner = document.getElementById('pcCommunityComposerInner');
  if (!inner) return;

  _communityComposerMode = type;

  const isTip = type === 'tip';
  const isQuestion = type === 'question';
  const isReview = type === 'review';

  inner.innerHTML = `
    <form id="pcCommunityComposerForm">
      <div style="padding:22px 22px 14px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between;gap:12px;">
        <div>
          <div style="font-size:20px;font-weight:700;color:#0f172a;">
            ${isTip ? 'Post Insider Tip' : isQuestion ? 'Ask Question' : 'Post Review'}
          </div>
          <div style="font-size:14px;color:#64748b;margin-top:6px;line-height:1.55;">
            ${isReview
              ? 'Posts may be reviewed before they appear. Make sure your review is accurate, specific, and based on your real experience.'
              : isQuestion
                ? 'Posts may be reviewed before they appear. Double check product details and ask one clear, specific question.'
                : 'Posts may be reviewed before they appear. Keep your tip accurate, practical, and based on real use.'}
          </div>
        </div>
        <button type="button" id="pcCommunityComposerClose" style="border:none;background:transparent;font-size:34px;line-height:1;cursor:pointer;color:#64748b;">×</button>
      </div>

      <div style="padding:20px;display:grid;gap:14px;">
        ${
          isQuestion
            ? `
              <label style="display:grid;gap:6px;">
                <span style="font-size:14px;font-weight:600;color:#0f172a;">Title</span>
                <input
                  id="pcCommunityFieldTitle"
                  type="text"
                  maxlength="160"
                  placeholder="Example: Does this include the charger?"
                  style="width:100%;padding:12px 14px;border:1px solid #dbe2ea;border-radius:12px;font:inherit;"
                  required
                >
              </label>
            `
            : ''
        }

        ${
          isReview
            ? `
              <label style="display:grid;gap:6px;">
                <span style="font-size:14px;font-weight:600;color:#0f172a;">Rating</span>
                <select
                  id="pcCommunityFieldRating"
                  style="width:100%;padding:12px 14px;border:1px solid #dbe2ea;border-radius:12px;font:inherit;"
                  required
                >
                  <option value="5">5 stars</option>
                  <option value="4">4 stars</option>
                  <option value="3">3 stars</option>
                  <option value="2">2 stars</option>
                  <option value="1">1 star</option>
                </select>
              </label>
            `
            : ''
        }

        ${
          isTip
            ? `
              <label style="display:grid;gap:6px;">
                <span style="font-size:14px;font-weight:600;color:#0f172a;">Visited date</span>
                <input
                  id="pcCommunityFieldVisitedAt"
                  type="date"
                  style="width:100%;padding:12px 14px;border:1px solid #dbe2ea;border-radius:12px;font:inherit;"
                >
              </label>
            `
            : ''
        }

        <label style="display:grid;gap:6px;">
          <span style="font-size:14px;font-weight:600;color:#0f172a;">
            ${isQuestion ? 'Details' : isReview ? 'Review' : 'Tip'}
          </span>
          <textarea
            id="pcCommunityFieldBody"
            rows="${isQuestion ? 6 : 5}"
            maxlength="${isReview ? 1200 : isQuestion ? 1000 : 600}"
            placeholder="${
              isTip
                ? 'Example: The black version usually gets discounted more often.'
                : isQuestion
                  ? 'Add any extra detail that helps people answer.'
                  : 'What was good, bad, or surprising?'
            }"
            style="width:100%;padding:12px 14px;border:1px solid #dbe2ea;border-radius:12px;font:inherit;resize:vertical;"
            required
          ></textarea>
        </label>

        <div id="pcCommunityComposerError" hidden style="font-size:14px;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:12px 14px;"></div>

        <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:6px;">
          <button type="button" id="pcCommunityComposerBack" style="padding:11px 16px;border:1px solid #dbe2ea;border-radius:12px;background:#fff;font:inherit;cursor:pointer;">Back</button>
          <button type="submit" id="pcCommunityComposerSubmit" style="padding:11px 16px;border:none;border-radius:12px;background:#111827;color:#fff;font:inherit;font-weight:700;cursor:pointer;">
            Post
          </button>
        </div>
      </div>
    </form>
  `;

  const closeBtn = document.getElementById('pcCommunityComposerClose');
  const backBtn = document.getElementById('pcCommunityComposerBack');
  const form = document.getElementById('pcCommunityComposerForm');

  if (closeBtn) closeBtn.addEventListener('click', closeCommunityComposer);
  if (backBtn) backBtn.addEventListener('click', openCommunityComposer);
  if (form) form.addEventListener('submit', submitCommunityComposerForm);
}

async function submitCommunityComposerForm(e){
  e.preventDefault();

  const submitBtn = document.getElementById('pcCommunityComposerSubmit');
  const errorEl = document.getElementById('pcCommunityComposerError');
  const type = String(_communityComposerMode || '').trim();

  if (!type || !state.lastKey) return;

  const titleEl = document.getElementById('pcCommunityFieldTitle');
  const bodyEl = document.getElementById('pcCommunityFieldBody');
  const ratingEl = document.getElementById('pcCommunityFieldRating');
  const visitedAtEl = document.getElementById('pcCommunityFieldVisitedAt');

  const payload = {
    post_type: type,
    title: titleEl ? String(titleEl.value || '').trim() : '',
    body: bodyEl ? String(bodyEl.value || '').trim() : '',
    rating: ratingEl ? Number(ratingEl.value || 0) : null,
    visited_at: visitedAtEl ? String(visitedAtEl.value || '').trim() : ''
  };

  if (errorEl) {
    errorEl.hidden = true;
    errorEl.textContent = '';
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Posting...';
  }

  try {
    const res = await fetch(`/api/community/${encodeURIComponent(state.lastKey)}/post`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => null);

    if (res.status === 401) {
      closeCommunityComposer();
      if (typeof window.pcOpenSignIn === 'function') {
        window.pcOpenSignIn();
        return;
      }
      throw new Error('Please sign in first.');
    }

    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || 'Could not save post.');
    }

    closeCommunityComposer();
    await renderCommunityCard(state.lastKey, null);
  } catch (err) {
    if (errorEl) {
      errorEl.hidden = false;
      errorEl.textContent = String(err?.message || 'Could not save post.');
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Post';
    }
  }
}

async function openCommunityComposerFromTrigger(){
  try {
    const res = await fetch('/api/auth/me', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });

    const data = await res.json().catch(() => null);
    const signedIn = !!data?.user?.id;

    if (!signedIn) {
      if (typeof window.pcOpenSignIn === 'function') {
        window.pcOpenSignIn();
        return;
      }

      alert('Please sign in first.');
      return;
    }

    openCommunityComposer();
  } catch {
    if (typeof window.pcOpenSignIn === 'function') {
      window.pcOpenSignIn();
      return;
    }

    alert('Please sign in first.');
  }
}

function wireCommunityAddButton(){
  const btn = document.getElementById('pcCommunityAddBtn');
  if (!btn || btn._pcCommunityBound) return;

  btn._pcCommunityBound = true;

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    await openCommunityComposerFromTrigger();
  });
}

function wireQuestionReplyUi(signedIn){
  document.querySelectorAll('[data-question-answer-link]').forEach((el) => {
    if (el._pcBound) return;
    el._pcBound = true;

    el.addEventListener('click', async (e) => {
      e.preventDefault();
      const questionId = String(el.getAttribute('data-question-answer-link') || '').trim();
      if (!questionId) return;
      await openQuestionAnswersModal(questionId);
    });
  });

  document.querySelectorAll('[data-question-reply-toggle]').forEach((btn) => {
    if (btn._pcBound) return;
    btn._pcBound = true;

    btn.addEventListener('click', async (e) => {
      e.preventDefault();

      if (!signedIn) {
        if (typeof window.pcOpenSignIn === 'function') {
          window.pcOpenSignIn();
        }
        return;
      }

      const questionId = String(btn.getAttribute('data-question-reply-toggle') || '').trim();
      if (!questionId) return;

      const box = document.querySelector(`[data-question-reply-box="${CSS.escape(questionId)}"]`);
      if (!box) return;

      const willOpen = box.hidden;
      box.hidden = !willOpen;

      if (willOpen) {
        const ta = box.querySelector('textarea');
        if (ta) ta.focus();
      }
    });
  });

  document.querySelectorAll('[data-question-reply-form]').forEach((form) => {
    if (form._pcBound) return;
    form._pcBound = true;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const questionId = String(form.getAttribute('data-question-reply-form') || '').trim();
      if (!questionId) return;

      const bodyEl = form.querySelector('textarea');
      const errorEl = form.querySelector('[data-question-reply-error]');
      const submitBtn = form.querySelector('button[type="submit"]');
      const body = String(bodyEl?.value || '').trim();

      if (errorEl) {
        errorEl.hidden = true;
        errorEl.textContent = '';
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Posting...';
      }

      try {
        await submitQuestionReply(questionId, body);
        await renderCommunityCard(state.lastKey, null);
        await openQuestionAnswersModal(questionId);
      } catch (err) {
        if (errorEl) {
          errorEl.hidden = false;
          errorEl.textContent = String(err?.message || 'Could not save reply.');
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Reply';
        }
      }
    });
  });
}

async function renderCommunityCard(productKey, runToken){
  const card = document.getElementById('communityCard');
  const tipsCountEl = document.getElementById('pcCommunityTipsCount');
  const questionsCountEl = document.getElementById('pcCommunityQuestionsCount');
  const reviewsCountEl = document.getElementById('pcCommunityReviewsCount');
  const tipsListEl = document.getElementById('pcCommunityTipsList');
  const questionsListEl = document.getElementById('pcCommunityQuestionsList');
  const reviewListEl = document.getElementById('pcCommunityReviewList');

  if (!card || !tipsCountEl || !questionsCountEl || !reviewsCountEl || !tipsListEl || !questionsListEl || !reviewListEl) {
    return;
  }

  wireCommunityAddButton();

  tipsCountEl.textContent = '(0)';
  questionsCountEl.textContent = '(0)';
  reviewsCountEl.textContent = '(0)';

  tipsListEl.innerHTML = '<div class="sidebar-empty">Loading...</div>';
  questionsListEl.innerHTML = '<div class="sidebar-empty">Loading...</div>';
  reviewListEl.innerHTML = '<div class="sidebar-empty">Loading...</div>';

  card.hidden = false;

  let signedIn = false;
  let data;

  try {
    const [communityRes, authRes] = await Promise.all([
      fetch(`/api/community/${encodeURIComponent(productKey)}`, {
        headers: { Accept: 'application/json' }
      }),
      fetch('/api/auth/me', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      }).catch(() => null)
    ]);

    if (runToken != null && isStaleRun(runToken)) return;
    if (!communityRes.ok) throw new Error(`HTTP ${communityRes.status}`);

    data = await communityRes.json();

    if (authRes) {
      const authData = await authRes.json().catch(() => null);
      signedIn = !!authData?.user?.id;
    }

    if (runToken != null && isStaleRun(runToken)) return;
  } catch (_err) {
    if (runToken != null && isStaleRun(runToken)) return;

    tipsListEl.innerHTML = '<div class="community-empty">Could not load community tips.</div>';
    questionsListEl.innerHTML = '<div class="community-empty">Could not load questions.</div>';
    reviewListEl.innerHTML = '<div class="community-empty">Could not load reviews.</div>';
    return;
  }

  const tips = Array.isArray(data?.tips) ? data.tips : [];
  const questions = Array.isArray(data?.questions) ? data.questions : [];
  const reviews = Array.isArray(data?.reviews) ? data.reviews : [];
  const counts = data?.counts || {};

  state.community = {
    tips,
    questions,
    reviews,
    counts: {
      tips: Number(counts.tips || 0),
      questions: Number(counts.questions || 0),
      reviews: Number(counts.reviews || 0)
    }
  };

  const totalCount =
  state.community.counts.tips +
  state.community.counts.questions +
  state.community.counts.reviews;

  card.hidden = false;

  tipsCountEl.textContent = `(${state.community.counts.tips})`;
  questionsCountEl.textContent = `(${state.community.counts.questions})`;
  reviewsCountEl.textContent = `(${state.community.counts.reviews})`;

  tipsListEl.innerHTML = tips.length
    ? tips.map((tip) => `
        <article class="pc-tip-card">
          <div class="pc-tip-card__body">${escapeHtml(tip.body || '')}</div>

          <div class="pc-tip-card__foot">
            ${communityAvatarHtml(tip.author_name, tip.profile_image_url)}
            <div class="pc-tip-card__meta">
              <div class="pc-tip-card__name">${escapeHtml(tip.author_name || 'User')}</div>
              <div class="pc-tip-card__sub">${escapeHtml(communityVisitedLabel(tip.visited_at) || communityRelativeTime(tip.created_at) || '')}</div>
            </div>
          </div>
        </article>
      `).join('')
        : '<div class="sidebar-community">No tips yet. Be the first to contribute something useful.</div>';

      questionsListEl.innerHTML = questions.length
    ? questions.map((q) => {
        const answerCount = Number(q.answer_count || 0);
        const replyBoxId = `q-reply-${q.id}`;

        return `
          <article class="pc-qa-item">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
              <div style="min-width:0;flex:1;">
                <div class="pc-qa-item__question" style="font-weight:700;color:#0f172a;">${escapeHtml(q.title || '')}</div>
                ${q.body ? `<div class="pc-community-review-card__body" style="margin-top:8px;">${escapeHtml(q.body)}</div>` : ''}
              </div>

              ${
                signedIn
                  ? `
                    <button
                      type="button"
                      data-question-reply-toggle="${escapeHtml(String(q.id))}"
                      aria-label="Reply to this question"
                      title="Reply"
                      style="flex:0 0 auto;width:40px;height:40px;border:none;background:none;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;color:#0f172a;"
                    >
                      ${replyIconSvg()}
                    </button>
                  `
                  : ''
              }
            </div>

            <div class="pc-qa-item__meta" style="display:flex;align-items:center;gap:12px;margin-top:12px;font-size:13px;color:#64748b;">
              <span style="font-size:14px;">${escapeHtml(communityRelativeTime(q.created_at) || '')}</span>
              <a
                href="#"
                data-question-answer-link="${escapeHtml(String(q.id))}"
                style="color:#4f46e5;text-decoration:none;font-weight:600;font-size:14px;"
              >
                ${escapeHtml(answerCountLabel(answerCount))}
              </a>
            </div>

            ${
              signedIn
                ? `
                  <div
                    data-question-reply-box="${escapeHtml(String(q.id))}"
                    hidden
                    style="margin-top:14px;padding-top:14px;border-top:1px solid #e5e7eb;"
                  >
                    <form data-question-reply-form="${escapeHtml(String(q.id))}" style="display:grid;gap:10px;">
                      <textarea
                        rows="3"
                        maxlength="1000"
                        placeholder="Write a reply..."
                        style="width:100%;padding:12px 14px;border:1px solid #dbe2ea;border-radius:12px;font:inherit;resize:vertical;"
                        required
                      ></textarea>

                      <div data-question-reply-error hidden style="font-size:14px;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:12px 14px;"></div>

                      <div style="display:flex;justify-content:flex-end;">
                        <button
                          type="submit"
                          style="padding:10px 16px;border:none;border-radius:12px;background:#111827;color:#fff;font:inherit;font-weight:700;cursor:pointer;"
                        >
                          Reply
                        </button>
                      </div>
                    </form>
                  </div>
                `
                : ''
            }
          </article>
        `;
      }).join('')
        : '<div class="sidebar-community">No questions yet.</div>';

  reviewListEl.innerHTML = reviews.length
    ? reviews.map((review) => `
        <article class="pc-community-review-card">
          <div class="pc-community-review-card__top">
            <div class="pc-community-review-card__name">${escapeHtml(review.author_name || 'User')}</div>
            <div class="pc-community-review-card__rating">${escapeHtml(communityStars(review.rating))}</div>
          </div>

          <div class="pc-community-review-card__body">${escapeHtml(review.body || '')}</div>

          <div class="pc-community-review-card__meta">${escapeHtml(communityRelativeTime(review.created_at) || '')}</div>
        </article>
      `).join('')
        : '<div class="sidebar-community">No reviews yet. Share your experience to help others.</div>';

    wireQuestionReplyUi(signedIn);
}

async function renderReviewsCard(productKey, runToken) {
  const el = document.getElementById('pc-reviews-card');
  if (!el) return;

  function mount(inner) {
    if (runToken != null && isStaleRun(runToken)) return;
    el.hidden = false;
    el.innerHTML = inner;
  }

  const iconPath = 'M240-400h320v-80H240v80Zm0-120h480v-80H240v80Zm0-120h480v-80H240v80ZM480-80 373-240H160q-33 0-56.5-23.5T80-320v-480q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H587L480-80Zm0-144 64-96h256v-480H160v480h256l64 96Zm0-336Z';

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

    if (runToken != null && isStaleRun(runToken)) return;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    data = await res.json();

    if (runToken != null && isStaleRun(runToken)) return;
  } catch (_err) {
    if (runToken != null && isStaleRun(runToken)) return;

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
  const overallNum = Number(aggregate.overall);
  const overall = Number.isFinite(overallNum) ? overallNum : 0;
  setTopbarRatingSummary(overall, total);

  const verifiedPctNum = Number(aggregate.verified_pct);
  const verifiedPct = Number.isFinite(verifiedPctNum)
    ? Math.max(0, Math.min(100, Math.round(verifiedPctNum)))
    : null;

  const hasCustomer = total > 0 && overall > 0;
  const hasExpert = expertReviews.length > 0;

  if (!hasCustomer && !hasExpert) {
    el.hidden = true;
    el.innerHTML = '';
    clearTopbarRatingSummary();
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
      const sourceUrl = safeHttpHref(s.url || '');
      const sourceCount = Number(s.count || 0);
      const sourceRatingNum = Number(s.rating || 0);
      const sourceRatingText =
        Number.isFinite(sourceRatingNum) && sourceRatingNum > 0
          ? `${sourceRatingNum.toFixed(1)} / 5`
          : 'No rating';

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

          <div class="pc-rv-source-card__rating">${escapeHtml(sourceRatingText)}</div>
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
      ? `<span class="pc-rv-pill">${verifiedPct}% Verified</span>`
      : '';

    customerHtml = `
      <section class="pc-review-section">
        <div class="pc-rv-section-head">
          <div class="pc-rv-section-title">Store Reviews</div>
        </div>

        <div class="pc-rv-customer-layout">
          <div class="pc-rv-summary-card">
            <div class="pc-rv-summary-label">Average rating</div>
            <div class="pc-rv-summary-score">${overall.toFixed(1)}</div>
            <div class="pc-rv-summary-scale">out of 5</div>
            <div class="pc-rv-summary-note">Based on ${fmtCompact(total)} reviews</div>

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
          <div class="pc-rv-section-title">Store Reviews</div>
        </div>
        <p class="note">No store reviews found yet.</p>
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
      const url = safeHttpHref(r.url || '');
      const reviewedAt = formatReviewDate(r.reviewed_at);

      const scoreOutOf5Num = Number(r.score_out_of_5 || 0);
      const scoreOutOf5 =
        Number.isFinite(scoreOutOf5Num) && scoreOutOf5Num > 0
          ? scoreOutOf5Num
          : null;

      const scoreNum = Number(r.score);
      const scoreScaleNum = Number(r.score_scale);

      const normalizedLabel = scoreOutOf5 != null ? `${scoreOutOf5.toFixed(1)}/5` : '';
      const rawLabel =
        Number.isFinite(scoreNum) &&
        Number.isFinite(scoreScaleNum) &&
        scoreScaleNum > 0 &&
        scoreScaleNum !== 5
          ? `${scoreNum}/${scoreScaleNum}`
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

  if (runToken != null && isStaleRun(runToken)) return;

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
    const isActive = normLower(label) === normLower(selectedValue);

    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'media-choice' + (isActive ? ' is-active' : '');
    b.setAttribute('aria-label', `${typeLabel} ${label}`);
    b.setAttribute('aria-pressed', isActive ? 'true' : 'false');

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

  if (variant2Card) {
    const h3 = variant2Card.querySelector('h3');
    if (h3) h3.textContent = 'Variant';
  }

  const currentVersion = String(state.selectedVersion || '').trim() || 'Default';

  // ----------------
  // Variant
  // ----------------
  const variantChoices = variantChoicesForVersion(list, currentVersion);

  if (variant2Card && variant2Pills){
    if (variantChoices.length >= 2) {
      let desiredVar = state.selectedVariant2;

      if (desiredVar && !variantChoices.some(x => normLower(x.label) === normLower(desiredVar))) {
        desiredVar = null;
      }
      if (!desiredVar) desiredVar = variantChoices[0].label;

      state.selectedVariant2 = desiredVar;
      variant2Card.hidden = false;

      renderImageChoiceGroup(
        variant2Pills,
        variantChoices,
        state.selectedVariant2,
        (picked) => {
          if (normLower(picked) === normLower(state.selectedVariant2)) return;

          state.selectedVariant2 = picked;
          state.selectedColor = null;

          const resolvedKey = chooseKeyForVersionVariantColor(
            list,
            currentVersion,
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
      state.selectedVariant2 = variantChoices[0]?.label || null;
    }
  } else {
    state.selectedVariant2 = state.selectedVariant2 || (variantChoices[0]?.label || null);
  }

  // ----------------
  // Color
  // ----------------
  const colorChoices = colorChoicesForVersionVariant(
    list,
    currentVersion,
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
      colorCard.hidden = false;

      renderImageChoiceGroup(
        colorPills,
        colorChoices,
        state.selectedColor,
        (picked) => {
          if (normLower(picked) === normLower(state.selectedColor)) return;

          state.selectedColor = picked;

          const resolvedKey = chooseKeyForVersionVariantColor(
            list,
            currentVersion,
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
      state.selectedColor = colorChoices[0]?.label || null;
    }
  } else {
    state.selectedColor = state.selectedColor || (colorChoices[0]?.label || null);
  }

  const resolvedKey = chooseKeyForVersionVariantColor(
    list,
    currentVersion,
    state.selectedVariant2,
    state.selectedColor
  );

  if (resolvedKey) {
    state.selectedVariantKey = resolvedKey;
  }

  syncVariantColorSectionVisibility();
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
  wireBrandFollowButton();
  await loadNameOverridesOnce();
  wireCodeButton();
  renderCodeButtonState();
  initDashboardTocObservers();
  scheduleDashboardTocRefresh();
  initSimilarSidebarObserver();

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

async function run(raw){
  const runToken = nextRunToken();
  const key = normalizeKey(raw);

  if (!key) {
    showMessage("Enter an ASIN, UPC, PCI, Best Buy SKU, Walmart itemId, or Target TCIN.");
    return;
  }

  state.lastKey = key;

  try{
    const res = await fetch(`/api/compare/${encodeURIComponent(key)}`, {
      headers: { 'Accept': 'application/json' }
    });

    if (isStaleRun(runToken)) return;

    if (res.status === 404){
      showMessage(`No match for "${raw}". Try prefixes like asin:..., upc:..., pci:..., bby:..., wal:..., tcin:...`);
      return;
    }

    if (!res.ok){
      showMessage('Server error. Try again.');
      return;
    }

    const data = await res.json();

    if (isStaleRun(runToken)) return;

    state.identity = data.identity || null;
    state.variants = Array.isArray(data.variants) ? data.variants : [];
    state.offers = Array.isArray(data.offers) ? data.offers : [];
    state.history = (data.history && Array.isArray(data.history.daily)) ? data.history.daily : [];
    state.historyStats = (data.history && data.history.stats) ? data.history.stats : null;
    state.similar = Array.isArray(data.similar) ? data.similar : [];
    state.lineup = (data.lineup && typeof data.lineup === 'object') ? data.lineup : null;
    state.selectedLineupFamily = String(data?.lineup?.current_family?.model_number || '').trim() || null;
    state.selectedFileIndex = -1;
    state.selectedTimelineIndex = -1;

    state.selectedVariantKey = chooseSelectedVariantKeyFromKey(state.lastKey, data);
    syncSelectorsFromSelectedKey();

    if (isStaleRun(runToken)) return;

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
      .map(o => {
        const offerUrl = safeHttpHref(o.url || canonicalLink(o.store, o) || '');
        return {
          "@type": "Offer",
          "priceCurrency": "USD",
          "price": (o.price_cents / 100).toFixed(2),
          "url": offerUrl || undefined,
          "seller": { "@type": "Organization", "name": titleCase(o.store || "Retailer") },
          "availability": "https://schema.org/InStock"
        };
      })
      .filter(o => o.url);

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

    if (canonicalKey) {
      state.lastKey = canonicalKey;
      applyPrettyUrl(canonicalKey, bestTitle, 'replace');
      applySeoFromData(bestTitle, bestImg, canonicalKey);
    }

    const kind = (String(canonicalKey || '').split(':')[0] || '').toLowerCase();
    if (kind === 'pci' && isOnCanonicalKey(canonicalKey) && isPrettyDashboardPath()) {
      setRobots('index,follow');
    } else {
      setRobots('noindex,follow');
    }

    if (isStaleRun(runToken)) return;

    hydrateHeader();
    hydrateKpis();
    drawChart();
    renderCouponsCard();
    renderAboutCard();
    renderTimeline();
    renderVariants();
    renderDimensions();
    renderSidebarSpecs();
    renderContents();
    renderHeroMediaCarousel();
    renderFilesCard();
    renderLineup();
    renderSimilarProducts();

    if (isStaleRun(runToken)) return;
    await renderOffers(true, runToken);

    if (isStaleRun(runToken)) return;
    await renderReviewsCard(state.lastKey, runToken);

    if (isStaleRun(runToken)) return;

    await renderCommunityCard(state.lastKey, runToken);

    if (isStaleRun(runToken)) return;

    {
      const _hKey = canonicalKey || state.lastKey;
      const _hTitle = bestTitle;
      const _hImg = bestImg;
      const _hBrand = String(state.identity?.brand || "").trim();

      if (_hKey && _hTitle) {
        recordHistory(_hKey, _hTitle, _hImg, _hBrand);
      }
    }

    await wireProductActions(
      canonicalKey || state.lastKey,
      bestTitle,
      bestImg,
      String(state.identity?.brand || '').trim()
    );

    scheduleDashboardTocRefresh();
    scheduleSimilarProductsRefresh();

  } catch(err){
    if (isStaleRun(runToken)) return;
    console.error(err);
    showMessage('Network error. Check console.');
  }
}

 function showMessage(msg){
  $('#pTitle').textContent = msg;

  const img = $('#pImg');
  if (img) {
    img.removeAttribute('src');
    img.style.display = 'none';
    img.onerror = null;
  }

  const pIdsEl = $('#pIds');
  if (pIdsEl) {
    pIdsEl.textContent = '';
    pIdsEl.hidden = true;
  }

  const brandRow = $('#pBrandRow');
  const brandLine = $('#pBrandLine');
  clearTopbarRatingSummary();

  state.identity = null;
  state.variants = [];
  state.offers = [];
  state.history = [];
  state.historyStats = null;
  state.similar = [];
  state.lineup = null;
  state.selectedVariantKey = null;
  state.selectedVersion = null;
  state.selectedVariant2 = null;
  state.selectedColor = null;
  state.selectedFileIndex = -1;
  state.selectedTimelineIndex = -1;
  state.selectedLineupFamily = null;

  _closeCodePanel();
  renderCodeButtonState();

  if (aboutCard) aboutCard.hidden = true;
  if (aboutParagraphs) aboutParagraphs.innerHTML = '';
  if (aboutPoints) aboutPoints.innerHTML = '';

  if (brandRow) brandRow.hidden = true;
  if (brandLine) brandLine.textContent = '';

  const recallWrap = document.getElementById('ps-recall');
  const recallLink = document.getElementById('ps-recall-link');
  if (recallWrap) recallWrap.hidden = true;
  if (recallLink) recallLink.removeAttribute('href');

  const warnEl = document.getElementById('ps-warn');
  if (warnEl) warnEl.hidden = true;

  const limitedEl = document.getElementById('ps-limited');
  if (limitedEl) limitedEl.hidden = true;

  if (versionCard) versionCard.hidden = true;
  if (versionPills) versionPills.innerHTML = '';

  if (contentsCard) contentsCard.hidden = true;
  if (contentsContent) contentsContent.innerHTML = '';

  if (variant2Card) variant2Card.hidden = true;
  if (variant2Pills) variant2Pills.innerHTML = '';

  if (colorCard) colorCard.hidden = true;
  if (colorPills) colorPills.innerHTML = '';

  syncVariantColorSectionVisibility();

  const couponCard = document.getElementById('couponCard');
  if (couponCard) couponCard.hidden = true;

  const reviewsCard = document.getElementById('pc-reviews-card');
  if (reviewsCard) {
    reviewsCard.hidden = true;
    reviewsCard.innerHTML = '';
  }

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
  $('#kTypicalNote').textContent = '';
  $('#kLow30').textContent = 'NA';
  $('#kLow30Date').textContent = '';
  $('#kIntegrity').textContent = 'NA';

  const specsCard = document.getElementById('specsCard');
  const specsContent = document.getElementById('specsContent');
  if (specsCard) specsCard.hidden = true;
  if (specsContent) specsContent.innerHTML = '';

  const mediaCard = document.getElementById('mediaCard');
  if (mediaCard) mediaCard.hidden = true;
  const mediaContent = document.getElementById('mediaContent');
  if (mediaContent) mediaContent.innerHTML = '';

  state.mediaGroups = { images: [], videos: [], shorts: [] };
  state.activeMediaGroup = 'images';
  state.activeMediaIndex = 0;

  const mediaInner = document.getElementById('phMediaInner');
  const mediaCounter = document.getElementById('phMediaCounter');
  const mediaStage = document.getElementById('phMediaStage');

  if (mediaInner) {
    mediaInner.innerHTML = `
      <div class="ph-media-stage__placeholder">
        <div class="ph-media-stage__title">No media yet</div>
        <div class="ph-media-stage__sub">Media for this product has not been added yet.</div>
      </div>
    `;
  }

  if (mediaCounter) mediaCounter.textContent = '0 / 0';
  if (mediaStage) mediaStage.classList.remove('is-vertical');

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

    state.community = {
    tips: [],
    questions: [],
    reviews: [],
    counts: { tips: 0, questions: 0, reviews: 0 }
  };

  const communityCard = document.getElementById('communityCard');
  const communityTips = document.getElementById('pcCommunityTipsList');
  const communityQuestions = document.getElementById('pcCommunityQuestionsList');
  const communityReviews = document.getElementById('pcCommunityReviewList');
  const communityTipsCount = document.getElementById('pcCommunityTipsCount');
  const communityQuestionsCount = document.getElementById('pcCommunityQuestionsCount');
  const communityReviewsCount = document.getElementById('pcCommunityReviewsCount');

    if (communityCard) communityCard.hidden = false;

  if (communityTips) {
    communityTips.innerHTML = `
      <div class="sidebar-empty">
        No tips yet. Be the first to share something useful about this product.
      </div>
    `;
  }

  if (communityQuestions) {
    communityQuestions.innerHTML = `
      <div class="sidebar-empty">
        No questions yet.
      </div>
    `;
  }

  if (communityReviews) {
    communityReviews.innerHTML = `
      <div class="sidebar-empty">
        No reviews yet. Share your experience to help the next person.
      </div>
    `;
  }

  if (communityTipsCount) communityTipsCount.textContent = '(0)';
  if (communityQuestionsCount) communityQuestionsCount.textContent = '(0)';
  if (communityReviewsCount) communityReviewsCount.textContent = '(0)';

  scheduleDashboardTocRefresh();
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

      const url = safeHttpHref(id.recall_url || '');

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

    const pIdsEl = $('#pIds');
    if (pIdsEl) {
      pIdsEl.innerHTML = '';
      pIdsEl.hidden = true;
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
  svg.onpointerleave = hideTip;

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

  const best = pickBestCoupon(list) || list[0];

  const store = titleCase(best.store || 'Retailer');
  const link = safeHttpHref(best.url || canonicalLink(best.store, best) || '');

  const priceCents = best._price;
  const effCents = best._eff;

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
  const badgeEl = document.getElementById('cpBadge');

  const confidence =
    (showEff && best._savings != null) ? 'Verified price' :
    (String(best.coupon_text || '').trim() ? 'Promo noted' : '');

  setMaybe(confEl, confidence);

  const ruleBits = [];
  if (best.coupon_requires_clip === true) ruleBits.push('Clip coupon');
  if (String(best.coupon_code || '').trim()) ruleBits.push(`Code ${String(best.coupon_code).trim()}`);
  setMaybe(ruleEl, ruleBits.join(' • '));

  if (badgeEl) {
    badgeEl.hidden = !(showEff && best._savings != null);
  }

  const linkEl = document.getElementById('cpLink');
  if (linkEl) {
    linkEl.href = link || '#';
    linkEl.style.pointerEvents = link ? '' : 'none';
    linkEl.setAttribute('aria-disabled', link ? 'false' : 'true');
  }

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
  const moreWrap = document.getElementById('cpMore');
  const moreLabel = document.getElementById('cpMoreLabel');

  if (!moreOuter || !moreWrap || !moreLabel) return;

  if (!more.length){
    moreOuter.hidden = true;
    moreLabel.hidden = true;
    moreWrap.innerHTML = '';
    return;
  }

  moreOuter.hidden = false;
  moreLabel.hidden = false;
  moreLabel.textContent = `All coupon options (${1 + more.length})`;

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
    const u = safeHttpHref(o.url || canonicalLink(o.store, o) || '');
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
      href = safeHttpHref(rawUrl);
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

  async function renderOffers(sortByPrice, runToken){
  if (runToken != null && isStaleRun(runToken)) return;

  const wrap = $('#offers');
  const note = $('#offersNote');

  wrap.innerHTML = '';

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

  if (runToken != null && isStaleRun(runToken)) return;

  sellerRows.forEach(({ offer: o, seller, hasSeller, sellerHref }) => {
    const bestLink = safeHttpHref(o.url || canonicalLink(o.store, o) || '');
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

let _similarResizeObserver = null;
let _similarRefreshRaf = 0;

function scheduleSimilarProductsRefresh() {
  if (_similarRefreshRaf) cancelAnimationFrame(_similarRefreshRaf);

  _similarRefreshRaf = requestAnimationFrame(() => {
    _similarRefreshRaf = 0;
    renderSimilarProducts();
  });
}

function initSimilarSidebarObserver() {
  const main = document.querySelector('.main-content');
  if (!main || !('ResizeObserver' in window)) return;

  if (_similarResizeObserver) {
    _similarResizeObserver.disconnect();
  }

  _similarResizeObserver = new ResizeObserver(() => {
    scheduleSimilarProductsRefresh();
  });

  _similarResizeObserver.observe(main);

  window.addEventListener('resize', scheduleSimilarProductsRefresh, { passive: true });
}

function getSidebarAvailableHeight() {
  const main = document.querySelector('.main-content');
  const panel = document.getElementById('panelSimilar');

  if (!main || !panel) return 0;

  const mainRect = main.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();

  const available = Math.floor(mainRect.bottom - panelRect.top);
  return Math.max(0, available);
}

function similarProductCardHtml(p) {
  const key = String(p?.dashboard_key || '').trim();
  const title = String(p?.model_name || 'Product').trim() || 'Product';
  const href = key ? prettyDashboardUrl(key, title).pathname : '/dashboard/';
  const brand = titleCase(p?.brand || '');
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
}

function fitSimilarProductsToSidebar(items) {
  const panel = document.getElementById('panelSimilar');
  if (!panel) return;

  const availableHeight = getSidebarAvailableHeight();

  if (!availableHeight) {
    panel.innerHTML = `<div class="sidebar-empty">No similar products found.</div>`;
    return;
  }

  panel.innerHTML = `<div class="pc-similar-list"></div>`;
  const list = panel.querySelector('.pc-similar-list');
  if (!list) return;

  let rendered = 0;

  for (const item of items) {
    list.insertAdjacentHTML('beforeend', similarProductCardHtml(item));

    if (panel.scrollHeight > availableHeight) {
      const last = list.lastElementChild;
      if (last) last.remove();
      break;
    }

    rendered += 1;
  }

  if (!rendered && items.length) {
    list.innerHTML = similarProductCardHtml(items[0]);
  }
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

  if (panel) {
    fitSimilarProductsToSidebar(items);
  } else {
    host.innerHTML = `
      <div class="pc-similar-list">
        ${items.map(similarProductCardHtml).join('')}
      </div>
    `;
  }
}

  function renderVariants(){
    syncSelectorsFromSelectedKey();
    renderVersionVariantColor();
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

function normalizeAboutInput(raw){
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const paragraphs = Array.isArray(raw.paragraphs)
    ? raw.paragraphs.map(v => String(v || '').trim()).filter(Boolean)
    : [];

  const bullets = Array.isArray(raw.bullets)
    ? raw.bullets.map(v => String(v || '').trim()).filter(Boolean)
    : [];

  if (!paragraphs.length && !bullets.length) return null;

  return { paragraphs, bullets };
}

function aboutSource(){
  const cur = getCurrentVariant() || null;

  const fromVariant = normalizeAboutInput(cur?.about);
  if (fromVariant) return fromVariant;

  const fromIdentity = normalizeAboutInput(state.identity?.about);
  if (fromIdentity) return fromIdentity;

  return null;
}

function renderAboutCard(){
  if (!aboutCard || !aboutParagraphs || !aboutPoints) return;

  const about = aboutSource();

  if (!about) {
    aboutCard.hidden = true;
    aboutParagraphs.innerHTML = '';
    aboutPoints.innerHTML = '';
    return;
  }

  aboutCard.hidden = false;

  aboutParagraphs.innerHTML = about.paragraphs.map((text) => `
    <p>${escapeHtml(text)}</p>
  `).join('');

  aboutPoints.innerHTML = about.bullets.map((text) => `
    <div class="about-point">
      <span class="about-point__dot" aria-hidden="true"></span>
      <div class="about-point__text">${escapeHtml(text)}</div>
    </div>
  `).join('');
}

function renderSidebarSpecs(){
  const card = document.getElementById('specsCard');
  const host = document.getElementById('specsContent');
  if (!card || !host) return;

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
    card.hidden = true;
    host.innerHTML = '';
    return;
  }

  card.hidden = false;

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
    const u = new URL(s, location.origin);
    const proto = String(u.protocol || '').toLowerCase();

    if (proto !== 'http:' && proto !== 'https:') return null;
    return u;
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

  // TikTok only
  if (host.endsWith('tiktok.com')) {
    provider = 'TikTok';
    kind = 'Short form content';
    frameClass = 'pc-media-frame pc-media-frame--vertical';

    const m = path.match(/\/video\/(\d+)/i);
    if (m && m[1]) {
      embedUrl = `https://www.tiktok.com/player/v1/${m[1]}`;
    }
  }

  // Instagram only
  else if (host.endsWith('instagram.com')) {
    const m = path.match(/^\/(reel|p)\/([^/?#]+)/i);
    if (m) {
      provider = 'Instagram';
      kind = 'Short form content';
      frameClass = 'pc-media-frame pc-media-frame--vertical';
      embedUrl = `https://www.instagram.com/${m[1]}/${m[2]}/embed`;
    }
  }

  // Ignore YouTube and everything else
  else {
    return null;
  }

  return {
    url: rawUrl,
    provider,
    kind,
    title: '',
    embedUrl,
    frameClass
  };
}

function mediaSource(){
  const cur = getCurrentVariant() || null;

  if (Array.isArray(cur?.media)) return cur.media;
  if (cur?.media && typeof cur.media === 'object' && Array.isArray(cur.media.items)) return cur.media.items;

  if (Array.isArray(state.identity?.media)) return state.identity.media;
  if (state.identity?.media && typeof state.identity.media === 'object' && Array.isArray(state.identity.media.items)) return state.identity.media.items;

  return [];
}

function detectImageUrl(raw){
  const url = safeUrl(raw);
  if (!url) return null;

  const pathname = String(url.pathname || '').toLowerCase();
  if (/\.(png|jpg|jpeg|webp|gif|svg)$/i.test(pathname)) return url.href;

  return null;
}

function detectDirectVideoUrl(raw){
  const url = safeUrl(raw);
  if (!url) return null;

  const pathname = String(url.pathname || '').toLowerCase();
  if (/\.(mp4|webm|ogg|mov)$/i.test(pathname)) return url.href;

  return null;
}

function parseHeroMediaItem(input){
  const obj = (typeof input === 'string')
    ? { url: input }
    : (input && typeof input === 'object' ? input : null);

  if (!obj) return null;

  const rawUrl = String(obj.url || obj.src || '').trim();
  if (!rawUrl) return null;

  const explicitType = String(obj.type || obj.kind || '').trim().toLowerCase();
  const title = String(obj.title || '').trim();

  const url = safeUrl(rawUrl);
  if (!url) return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = url.pathname || '';

  // explicit image always wins
  if (explicitType === 'image') {
    return {
      group: 'images',
      title,
      imageUrl: rawUrl
    };
  }

  // explicit short always wins
  if (explicitType === 'short') {
    if (host.endsWith('tiktok.com')) {
      const m = path.match(/\/video\/(\d+)/i);
      if (m && m[1]) {
        return {
          group: 'shorts',
          title,
          embedUrl: `https://www.tiktok.com/player/v1/${m[1]}`,
          frameClass: 'ph-media-embed ph-media-embed--vertical'
        };
      }
    }

    if (host.endsWith('instagram.com')) {
      const m = path.match(/^\/(reel|p)\/([^/?#]+)/i);
      if (m) {
        return {
          group: 'shorts',
          title,
          embedUrl: `https://www.instagram.com/${m[1]}/${m[2]}/embed`,
          frameClass: 'ph-media-embed ph-media-embed--vertical'
        };
      }
    }
  }

  // explicit video supports youtube embeds
  if (explicitType === 'video') {
    if (host.endsWith('youtube.com')) {
      const videoId = url.searchParams.get('v');
      if (videoId) {
        return {
          group: 'videos',
          title,
          embedUrl: `https://www.youtube.com/embed/${videoId}`,
          frameClass: 'ph-media-embed'
        };
      }
    }

    if (host === 'youtu.be') {
      const videoId = path.replace(/^\/+/, '').split('/')[0];
      if (videoId) {
        return {
          group: 'videos',
          title,
          embedUrl: `https://www.youtube.com/embed/${videoId}`,
          frameClass: 'ph-media-embed'
        };
      }
    }

    const directVideoUrl = detectDirectVideoUrl(rawUrl);
    if (directVideoUrl) {
      return {
        group: 'videos',
        title,
        videoUrl: directVideoUrl
      };
    }

    return null;
  }

  // auto-detect normal image files
  const imageUrl = detectImageUrl(rawUrl);
  if (imageUrl) {
    return {
      group: 'images',
      title,
      imageUrl
    };
  }

  // auto-detect direct video files
  const directVideoUrl = detectDirectVideoUrl(rawUrl);
  if (directVideoUrl) {
    return {
      group: 'videos',
      title,
      videoUrl: directVideoUrl
    };
  }

  // auto-detect TikTok
  if (host.endsWith('tiktok.com')) {
    const m = path.match(/\/video\/(\d+)/i);
    if (m && m[1]) {
      return {
        group: 'shorts',
        title,
        embedUrl: `https://www.tiktok.com/player/v1/${m[1]}`,
        frameClass: 'ph-media-embed ph-media-embed--vertical'
      };
    }
  }

  // auto-detect Instagram
  if (host.endsWith('instagram.com')) {
    const m = path.match(/^\/(reel|p)\/([^/?#]+)/i);
    if (m) {
      return {
        group: 'shorts',
        title,
        embedUrl: `https://www.instagram.com/${m[1]}/${m[2]}/embed`,
        frameClass: 'ph-media-embed ph-media-embed--vertical'
      };
    }
  }

  // auto-detect YouTube
  if (host.endsWith('youtube.com')) {
    const videoId = url.searchParams.get('v');
    if (videoId) {
      return {
        group: 'videos',
        title,
        embedUrl: `https://www.youtube.com/embed/${videoId}`,
        frameClass: 'ph-media-embed'
      };
    }
  }

  if (host === 'youtu.be') {
    const videoId = path.replace(/^\/+/, '').split('/')[0];
    if (videoId) {
      return {
        group: 'videos',
        title,
        embedUrl: `https://www.youtube.com/embed/${videoId}`,
        frameClass: 'ph-media-embed'
      };
    }
  }

  return null;
}

function getActiveHeroMediaList(){
  const group = String(state.activeMediaGroup || 'images');
  const groups = state.mediaGroups || {};
  return Array.isArray(groups[group]) ? groups[group] : [];
}

function clampHeroMediaIndex(){
  const list = getActiveHeroMediaList();
  if (!list.length) {
    state.activeMediaIndex = 0;
    return;
  }
  if (state.activeMediaIndex < 0) state.activeMediaIndex = 0;
  if (state.activeMediaIndex >= list.length) state.activeMediaIndex = list.length - 1;
}

function heroMediaMarkup(item){
  if (!item) {
    return `
      <div class="ph-media-stage__placeholder">
        <div class="ph-media-stage__title">No media yet</div>
        <div class="ph-media-stage__sub">Media for this product has not been added yet.</div>
      </div>
    `;
  }

  if (item.group === 'images' && item.imageUrl) {
    return `
      <div class="ph-media-asset ph-media-asset--image">
        <img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.title || 'Product media')}" loading="lazy" decoding="async">
      </div>
    `;
  }

  if (item.group === 'videos' && item.videoUrl) {
    return `
      <div class="ph-media-asset ph-media-asset--video">
        <video controls playsinline preload="metadata" src="${escapeHtml(item.videoUrl)}"></video>
      </div>
    `;
  }

  if (item.embedUrl) {
    return `
      <div class="${escapeHtml(item.frameClass || 'ph-media-embed')}">
        <iframe
          src="${escapeHtml(item.embedUrl)}"
          title="${escapeHtml(item.title || item.group || 'Media')}"
          loading="lazy"
          referrerpolicy="strict-origin-when-cross-origin"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowfullscreen
        ></iframe>
      </div>
    `;
  }

  return `
    <div class="ph-media-stage__placeholder">
      <div class="ph-media-stage__title">Unsupported media</div>
      <div class="ph-media-stage__sub">This media item could not be displayed.</div>
    </div>
  `;
}

function updateHeroMediaTabs(){
  document.querySelectorAll('.ph-media-tab[data-media-group]').forEach((btn) => {
    const group = String(btn.getAttribute('data-media-group') || '');
    const count = Array.isArray(state.mediaGroups?.[group]) ? state.mediaGroups[group].length : 0;
    const active = group === state.activeMediaGroup;

    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    btn.hidden = count === 0;
  });
}

function renderHeroMediaStage(){
  const inner = document.getElementById('phMediaInner');
  const counter = document.getElementById('phMediaCounter');
  const prev = document.getElementById('phMediaPrev');
  const next = document.getElementById('phMediaNext');
  const stage = document.getElementById('phMediaStage');

  if (!inner || !counter || !prev || !next || !stage) return;

  const list = getActiveHeroMediaList();
  clampHeroMediaIndex();

  const item = list[state.activeMediaIndex] || null;
  inner.innerHTML = heroMediaMarkup(item);

  counter.textContent = list.length ? `${state.activeMediaIndex + 1} / ${list.length}` : '0 / 0';
  prev.disabled = list.length <= 1;
  next.disabled = list.length <= 1;

  stage.classList.toggle('is-empty', !list.length);
  stage.classList.toggle('is-vertical', !!item && item.group === 'shorts');
}

function bindHeroMediaEventsOnce(){
  if (state.mediaBound) return;
  state.mediaBound = true;

  const prev = document.getElementById('phMediaPrev');
  const next = document.getElementById('phMediaNext');

  if (prev) {
    prev.addEventListener('click', () => {
      const list = getActiveHeroMediaList();
      if (list.length <= 1) return;
      state.activeMediaIndex = (state.activeMediaIndex - 1 + list.length) % list.length;
      renderHeroMediaStage();
    });
  }

  if (next) {
    next.addEventListener('click', () => {
      const list = getActiveHeroMediaList();
      if (list.length <= 1) return;
      state.activeMediaIndex = (state.activeMediaIndex + 1) % list.length;
      renderHeroMediaStage();
    });
  }

  document.querySelectorAll('.ph-media-tab[data-media-group]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const group = String(btn.getAttribute('data-media-group') || '');
      const list = Array.isArray(state.mediaGroups?.[group]) ? state.mediaGroups[group] : [];
      if (!list.length) return;

      state.activeMediaGroup = group;
      state.activeMediaIndex = 0;
      updateHeroMediaTabs();
      renderHeroMediaStage();
    });
  });
}

function renderHeroMediaCarousel(){
  const card = document.getElementById('mediaCard');
  if (card) {
    card.hidden = true;
    const panel = document.getElementById('mediaContent');
    if (panel) panel.innerHTML = '';
  }

  const items = normalizeMediaInput(mediaSource())
    .map(parseHeroMediaItem)
    .filter(Boolean);

  state.mediaGroups = {
    images: items.filter(x => x.group === 'images'),
    videos: items.filter(x => x.group === 'videos'),
    shorts: items.filter(x => x.group === 'shorts')
  };

  if (state.mediaGroups.images.length) state.activeMediaGroup = 'images';
  else if (state.mediaGroups.videos.length) state.activeMediaGroup = 'videos';
  else if (state.mediaGroups.shorts.length) state.activeMediaGroup = 'shorts';
  else state.activeMediaGroup = 'images';

  state.activeMediaIndex = 0;

  bindHeroMediaEventsOnce();
  updateHeroMediaTabs();
  renderHeroMediaStage();
}

function normalizeFilesInput(raw){
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray(raw.items)) return raw.items;
  return [];
}

function filesSource(){
  const cur = getCurrentVariant() || null;

  if (Array.isArray(cur?.files)) return cur.files;
  if (cur?.files && typeof cur.files === 'object' && Array.isArray(cur.files.items)) return cur.files.items;

  if (Array.isArray(state.identity?.files)) return state.identity.files;
  if (state.identity?.files && typeof state.identity.files === 'object' && Array.isArray(state.identity.files.items)) return state.identity.files.items;

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

  window.addEventListener('popstate', () => {
    const raw = currentKeyFromUrl();
    if (raw) run(raw);
  });
})();