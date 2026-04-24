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
      <path d="m233-120 65-281L80-590l288-25 112-265 112 265 288 25-218 189 65 281-247-149-247 149Z"></path>
    </svg>
  `;

    const RETURNS_PILL_SVG = `
    <svg xmlns="http://www.w3.org/2000/svg"
         height="16" viewBox="0 -960 960 960" width="16"
         fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M280-200v-80h284q63 0 109.5-40T720-420q0-60-46.5-100T564-560H312l104 104-56 56-200-200 200-200 56 56-104 104h252q97 0 166.5 63T800-420q0 94-69.5 157T564-200H280Z"></path>
    </svg>
  `;

  const DASHBOARD_BOTTOM_EXPAND_ICON_PATH = 'M200-120q-33 0-56.5-23.5T120-200v-160h80v160h160v80H200Zm400 0v-80h160v-160h80v160q0 33-23.5 56.5T760-120H600ZM120-600v-160q0-33 23.5-56.5T200-840h160v80H200v160h-80Zm640 0v-160H600v-80h160q33 0 56.5 23.5T840-760v160h-80Z';

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
    reviewCustomerSources: [],
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
    mediaItems: [],
    activeMediaIndex: 0,
    mediaBound: false,
    recommendation: null,
    community: {
      tips: [],
      questions: [],
      reviews: [],
      counts: { tips: 0, questions: 0, reviews: 0 }
    },
  };

  let _runToken = 0;
  let _specPillConfig = null;
  const marketingImagesCard = document.getElementById('marketingImagesCard');
  const marketingImagesContent = document.getElementById('marketingImagesContent');
  const tocEl = document.getElementById('dashboardToc');
  let _tocResizeObserver = null;
  let _tocMutationObserver = null;
  let _tocRefreshRaf = 0;
  let _tocScrollItems = [];
  let _tocScrollRaf = 0;
  let _tocScrollHandler = null;
  let _dashboardBottomPanelEl = null;
  let _dashboardBottomPanelResizerEl = null;
  let _dashboardBottomPanelOpen = false;
  let _dashboardBottomPanelHeight = 300;
  let _dashboardBottomPanelTab = 'reviews';
  let _dashboardBottomPanelDragCleanup = null;

  state.recommendation = null;

  const recommendationCard = document.getElementById('recommendationCard');
  const recommendationContent = document.getElementById('recommendationContent');
  if (recommendationCard) recommendationCard.hidden = true;
  if (recommendationContent) recommendationContent.innerHTML = '';

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

function normalizeCategoryKey(v){
  return String(v || '')
    .trim()
    .toLowerCase();
}

function normalizeSpecKey(v){
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[\/]+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function prettySpecPill(label, value){
  const rawLabel = String(label ?? '').trim();
  const rawValue = String(value ?? '').trim();

  if (!rawLabel || !rawValue) return null;

  if (/^(yes|true)$/i.test(rawValue)) {
    return {
      text: rawLabel,
      label: rawLabel
    };
  }

  if (/^(no|false)$/i.test(rawValue)) return null;

  return {
    text: rawValue,
    label: rawLabel
  };
}

async function loadSpecPillConfigOnce(){
  if (_specPillConfig) return _specPillConfig;

  try {
    const res = await fetch('/data/specs.json', {
      headers: { Accept: 'application/json' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    _specPillConfig = (data && typeof data === 'object') ? data : {};
  } catch {
    _specPillConfig = {};
  }

  return _specPillConfig;
}

function getCurrentSpecsObject(){
  const cur = getCurrentVariant() || null;

  if (cur && cur.specs && typeof cur.specs === 'object' && !Array.isArray(cur.specs)) {
    return cur.specs;
  }

  if (state.identity && state.identity.specs && typeof state.identity.specs === 'object' && !Array.isArray(state.identity.specs)) {
    return state.identity.specs;
  }

  return {};
}

function getCurrentCategoryForSpecPills(){
  const cur = getCurrentVariant() || null;

  return normalizeCategoryKey(
    cur?.category ||
    state.identity?.category ||
    ''
  );
}

function buildTopSpecPills(specs, configList){
  const specEntries = Object.entries(specs || {});
  if (!specEntries.length || !Array.isArray(configList) || !configList.length) return [];

  const byNormalizedKey = new Map();

  for (const [rawKey, rawValue] of specEntries) {
    const normKey = normalizeSpecKey(rawKey);
    if (!normKey) continue;
    if (rawValue == null) continue;

    const textValue =
      typeof rawValue === 'boolean'
        ? (rawValue ? 'Yes' : 'No')
        : String(rawValue).trim();

    if (!textValue) continue;

    byNormalizedKey.set(normKey, {
      label: String(rawKey).trim(),
      value: textValue
    });
  }

  const primary = configList.slice(0, 5);
  const fallback = configList[5] || null;

  const out = [];
  const used = new Set();

  for (const wanted of primary) {
    const hit = byNormalizedKey.get(normalizeSpecKey(wanted));
    if (!hit) continue;

    const pill = prettySpecPill(hit.label, hit.value);
    if (!pill) continue;

    out.push(pill);
    used.add(normalizeSpecKey(wanted));
  }

  if (out.length < 7 && fallback) {
    const fallbackHit = byNormalizedKey.get(normalizeSpecKey(fallback));
    if (fallbackHit && !used.has(normalizeSpecKey(fallback))) {
      const pill = prettySpecPill(fallbackHit.label, fallbackHit.value);
      if (pill) out.push(pill);
    }
  }

  return out.slice(0, 5);
}

function renderTopSpecPills(){
  const host = document.getElementById('phSpecPills');
  if (!host) return;

  const categoryKey = getCurrentCategoryForSpecPills();
  const config = _specPillConfig && typeof _specPillConfig === 'object'
    ? _specPillConfig
    : {};

  const configList = Array.isArray(config[categoryKey]) ? config[categoryKey] : [];
  const specs = getCurrentSpecsObject();
  const pills = buildTopSpecPills(specs, configList);

  if (!pills.length) {
    host.hidden = true;
    host.innerHTML = '';
    return;
  }

  host.hidden = false;
  host.innerHTML = pills
    .map(pill => `
      <span
        class="ph-spec-pill"
        data-tooltip="${escapeHtml(pill.label)}"
        aria-label="${escapeHtml(pill.label)}"
        tabindex="0"
      >${escapeHtml(pill.text)}</span>
    `)
    .join('');
}

function normalizeMarketingImagesInput(raw){
  if (!Array.isArray(raw)) return [];

  return raw
    .map(v => String(v || '').trim())
    .filter(Boolean)
    .filter((url, index, arr) => arr.indexOf(url) === index);
}

function normalizeMediaInput(raw){
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => {
      if (typeof item === 'string') return item.trim();

      if (item && typeof item === 'object') {
        return String(item.url || item.src || '').trim();
      }

      return '';
    })
    .filter(Boolean)
    .filter((url, index, arr) => arr.indexOf(url) === index);
}

function mediaSource(){
  const cur = getCurrentVariant() || null;

  if (Array.isArray(cur?.media)) return cur.media;
  if (cur?.media && typeof cur.media === 'object' && Array.isArray(cur.media.items)) {
    return cur.media.items;
  }

  if (Array.isArray(state.identity?.media)) return state.identity.media;
  if (state.identity?.media && typeof state.identity.media === 'object' && Array.isArray(state.identity.media.items)) {
    return state.identity.media.items;
  }

  return [];
}

function parseImageMediaItem(input){
  const rawUrl = String(input || '').trim();
  if (!rawUrl) return null;

  const url = safeMediaUrl(rawUrl);
  if (!url) return null;

  return {
    imageUrl: url.href,
    thumb: url.href,
    title: ''
  };
}

function safeMediaUrl(raw){
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

function clampHeroMediaIndex(){
  const list = Array.isArray(state.mediaItems) ? state.mediaItems : [];

  if (!list.length) {
    state.activeMediaIndex = 0;
    return;
  }

  if (state.activeMediaIndex < 0) state.activeMediaIndex = 0;
  if (state.activeMediaIndex >= list.length) state.activeMediaIndex = list.length - 1;
}

function heroMediaMarkup(item){
  if (!item || !item.imageUrl) {
    return `
      <div class="ph-media-stage__placeholder">
        <div class="ph-media-stage__title">No media yet</div>
        <div class="ph-media-stage__sub">Media for this product has not been added yet.</div>
      </div>
    `;
  }

  return `
    <div class="ph-media-asset ph-media-asset--image">
      <img
        src="${escapeHtml(item.imageUrl)}"
        alt="${escapeHtml(item.title || 'Product media')}"
        loading="lazy"
        decoding="async"
      >
    </div>
  `;
}

function renderHeroMediaStage(){
  const inner = document.getElementById('phMediaInner');
  const stage = document.getElementById('phMediaStage');

  if (!inner || !stage) return;

  const list = Array.isArray(state.mediaItems) ? state.mediaItems : [];
  clampHeroMediaIndex();

  const item = list[state.activeMediaIndex] || null;
  inner.innerHTML = heroMediaMarkup(item);

  stage.classList.toggle('is-empty', !list.length);
  stage.classList.remove('is-vertical');
}

function getCurrentHeroMediaItem(){
  const list = Array.isArray(state.mediaItems) ? state.mediaItems : [];
  clampHeroMediaIndex();
  return list[state.activeMediaIndex] || null;
}

function previewHeroMediaItem(item){
  const inner = document.getElementById('phMediaInner');
  const stage = document.getElementById('phMediaStage');
  if (!inner || !stage) return;

  inner.innerHTML = heroMediaMarkup(item || null);
  stage.classList.toggle('is-empty', !item);
  stage.classList.remove('is-vertical');
}

function restoreHeroMediaPreview(){
  renderHeroMediaStage();
}

function previewItemFromChoice(option){
  if (!option) return null;

  const direct = safeMediaUrl(
    option.image ||
    option.imageUrl ||
    option.thumb ||
    option.url ||
    ''
  );

  if (!direct) return null;

  return {
    imageUrl: direct.href,
    thumb: direct.href,
    title: String(option.label || '')
  };
}

function mediaChevronCardMarkup(direction){
  const isLeft = direction === 'left';

  const icon = isLeft
    ? `
      <svg viewBox="0 -960 960 960" aria-hidden="true" focusable="false">
        <path d="M560-240 320-480l240-240 56 56-184 184 184 184-56 56Z"></path>
      </svg>
    `
    : `
      <svg viewBox="0 -960 960 960" aria-hidden="true" focusable="false">
        <path d="M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z"></path>
      </svg>
    `;

  return `
    <button
      type="button"
      class="pc-media-strip__chevron"
      data-media-chevron="${escapeHtml(direction)}"
      aria-label="${isLeft ? 'Previous media' : 'Next media'}"
      title="${isLeft ? 'Previous media' : 'Next media'}"
    >
      <span class="pc-media-strip__chevron-icon">${icon}</span>
    </button>
  `;
}

function imageStripCardMarkup(item, index, isActive){
  const thumb = String(item?.thumb || item?.imageUrl || '').trim();
  if (!thumb) return '';

  return `
    <button
      type="button"
      class="pc-media-strip__thumb${isActive ? ' is-active' : ''}"
      data-media-image-index="${index}"
      aria-label="Show image ${index + 1}"
      aria-pressed="${isActive ? 'true' : 'false'}"
    >
      <img
        src="${escapeHtml(thumb)}"
        alt="${escapeHtml(item?.title || `Image ${index + 1}`)}"
        onerror="this.style.visibility='hidden';"
      >
    </button>
  `;
}

function updateMediaStripActiveState(){
  const host = document.getElementById('mediaStripPills');
  if (!host) return;

  host.querySelectorAll('[data-media-image-index]').forEach((btn) => {
    const index = Number(btn.getAttribute('data-media-image-index'));
    const isActive = index === state.activeMediaIndex;

    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function renderMediaStrip(){
  const host = document.getElementById('mediaStripPills');
  const section = document.getElementById('mediaStripSection');
  if (!host || !section) return;

  const images = Array.isArray(state.mediaItems) ? state.mediaItems : [];

  if (!images.length) {
    section.hidden = true;
    host.innerHTML = '';
    return;
  }

  if (images.length <= 1) {
    section.hidden = true;
    host.innerHTML = '';
    return;
  }

  section.hidden = false;

  const showSideChevrons = images.length > 1;

  host.innerHTML = `
      <div class="pc-media-strip-row">
      ${
        showSideChevrons ? `
          <div class="pc-media-strip-row__side pc-media-strip-row__side--left">
            ${mediaChevronCardMarkup('left')}
          </div>
        ` : ''
      }

      <div class="pc-media-strip-row__center">
        <div class="pc-media-strip-row__track">
          ${images.map((item, index) => {
            const isActive = state.activeMediaIndex === index;
            return imageStripCardMarkup(item, index, isActive);
          }).join('')}
        </div>
      </div>

      ${
        showSideChevrons ? `
          <div class="pc-media-strip-row__side pc-media-strip-row__side--right">
            ${mediaChevronCardMarkup('right')}
          </div>
        ` : ''
      }
    </div>
  `;

    host.querySelectorAll('[data-media-image-index]').forEach((btn) => {
    const activateFromThumb = () => {
      const index = Number(btn.getAttribute('data-media-image-index'));
      if (!Number.isInteger(index) || index < 0 || index >= images.length) return;
      if (state.activeMediaIndex === index) return;

      state.activeMediaIndex = index;
      renderHeroMediaStage();
      updateMediaStripActiveState();
    };

    btn.addEventListener('mouseenter', activateFromThumb);
    btn.addEventListener('focus', activateFromThumb);
    btn.addEventListener('click', activateFromThumb);
  });

  host.querySelectorAll('[data-media-chevron]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const direction = String(btn.getAttribute('data-media-chevron') || '').trim();

      if (!images.length) return;

      if (direction === 'left') {
        state.activeMediaIndex = (state.activeMediaIndex - 1 + images.length) % images.length;
      } else {
        state.activeMediaIndex = (state.activeMediaIndex + 1) % images.length;
      }

      renderHeroMediaStage();
      updateMediaStripActiveState();
    });
  });
}

function renderHeroMediaCarousel(){
  const items = normalizeMediaInput(mediaSource())
    .map(parseImageMediaItem)
    .filter(Boolean);

  state.mediaItems = items;
  state.activeMediaIndex = 0;

  renderHeroMediaStage();
  renderMediaStrip();
}

function marketingImagesSource(){
  const cur = getCurrentVariant() || null;

  const fromVariant = normalizeMarketingImagesInput(cur?.marketing_images);
  if (fromVariant.length) return fromVariant;

  const fromIdentity = normalizeMarketingImagesInput(state.identity?.marketing_images);
  if (fromIdentity.length) return fromIdentity;

  return [];
}

function renderMarketingImagesCard(){
  if (!marketingImagesCard || !marketingImagesContent) return;

  const items = marketingImagesSource();

  if (!items.length) {
    marketingImagesCard.hidden = true;
    marketingImagesContent.innerHTML = '';
    return;
  }

  marketingImagesCard.hidden = false;

  marketingImagesContent.innerHTML = `
    <div class="pc-marketing-grid">
      ${items.map((url, index) => `
        <figure class="pc-marketing-tile">
          <img
            src="${escapeHtml(url)}"
            alt="${escapeHtml(`Marketing image ${index + 1}`)}"
            loading="lazy"
            decoding="async"
            referrerpolicy="no-referrer"
          />
        </figure>
      `).join('')}
    </div>
  `;
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

    const offset = getDashboardHeaderOffset() - 12;
    const y = Math.max(
      0,
      Math.round(window.scrollY + card.getBoundingClientRect().top - offset)
    );

    window.scrollTo({
      top: y,
      behavior: 'auto'
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

function clampDashboardBottomPanelHeight(value) {
  const viewport = window.innerHeight || document.documentElement.clientHeight || 900;
  const max = Math.max(180, Math.floor(viewport - 60));
  return Math.max(42, Math.min(max, Math.round(Number(value) || 320)));
}

const nextStepsSearchBtn = document.getElementById('nextStepsSearchBtn');

if (nextStepsSearchBtn && !nextStepsSearchBtn._pcBound) {
  nextStepsSearchBtn._pcBound = true;
  nextStepsSearchBtn.addEventListener('click', () => {
    const input = document.querySelector('.nav-search__input');
    if (!input) return;
    input.focus();
    input.select?.();
    window.scrollTo({ top: 0, behavior: 'auto' });
  });
}

function ensureDashboardBottomPanel() {
  if (_dashboardBottomPanelEl) return _dashboardBottomPanelEl;

  const panel = document.createElement('div');
  panel.id = 'dashboardBottomPanel';
  panel.className = 'dashboard-bottom-panel';
  panel.hidden = true;
  panel.setAttribute('aria-hidden', 'true');

    panel.innerHTML = `
    <div class="dashboard-bottom-panel__resizer" id="dashboardBottomPanelResizer" aria-hidden="true"></div>

    <div class="dashboard-bottom-panel__body">
      <div class="dashboard-bottom-panel__topbar">
        <div class="dashboard-bottom-panel__tabs">
          <button
            type="button"
            class="dashboard-bottom-panel__tab is-active"
            id="dashboardBottomPanelTabReviews"
            data-panel-tab="reviews"
            aria-pressed="true"
          >
            Reviews
          </button>

          <button
            type="button"
            class="dashboard-bottom-panel__tab"
            id="dashboardBottomPanelTabTips"
            data-panel-tab="tips"
            aria-pressed="false"
          >
            Tips
          </button>

          <button
            type="button"
            class="dashboard-bottom-panel__tab"
            id="dashboardBottomPanelTabQuestions"
            data-panel-tab="questions"
            aria-pressed="false"
          >
            Q&amp;A
          </button>
        </div>

        <div class="dashboard-bottom-panel__actions">
          <button
            type="button"
            class="dashboard-bottom-panel__iconbtn"
            id="dashboardBottomPanelAddBtn"
            aria-label="Add"
            title="Add"
          >
            <svg viewBox="0 -960 960 960" aria-hidden="true" focusable="false">
              <path d="M440-120v-320H120v-80h320v-320h80v320h320v80H520v320h-80Z"></path>
            </svg>
          </button>

          <button
            type="button"
            class="dashboard-bottom-panel__iconbtn"
            id="dashboardBottomPanelExpandBtn"
            aria-label="Expand"
            title="Expand"
          >
            <svg viewBox="0 -960 960 960" aria-hidden="true" focusable="false">
              <path d="${DASHBOARD_BOTTOM_EXPAND_ICON_PATH}"></path>
            </svg>
          </button>

          <button
            type="button"
            class="dashboard-bottom-panel__iconbtn"
            id="dashboardBottomPanelCloseBtn"
            aria-label="Close"
            title="Close"
          >
            <svg viewBox="0 -960 960 960" aria-hidden="true" focusable="false">
              <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"></path>
            </svg>
          </button>
        </div>
      </div>

      <div class="dashboard-bottom-panel__content">
        <section
          class="dashboard-bottom-panel__pane"
          id="dashboardBottomPanelPaneReviews"
          data-panel-pane="reviews"
        >
          <div id="dashboardBottomReviewsContent">
            <div class="sidebar-empty">No reviews yet.</div>
          </div>
        </section>

        <section
          class="dashboard-bottom-panel__pane"
          id="dashboardBottomPanelPaneTips"
          data-panel-pane="tips"
          hidden
        >
      <div class="dashboard-bottom-community">
        <section class="dashboard-bottom-community__block">
          <div id="dashboardBottomCommunityTipsList">
            <div class="sidebar-empty">No tips yet.</div>
          </div>
        </section>
      </div>
    </section>

    <section
      class="dashboard-bottom-panel__pane"
      id="dashboardBottomPanelPaneQuestions"
      data-panel-pane="questions"
      hidden
    >
  <div class="dashboard-bottom-community">
    <section class="dashboard-bottom-community__block">
      <div id="dashboardBottomCommunityQuestionsList">
        <div class="sidebar-empty">No questions yet.</div>
      </div>
    </section>
  </div>
</section>
      </div>
    </div>
  `;

  document.body.appendChild(panel);

  _dashboardBottomPanelEl = panel;
  _dashboardBottomPanelResizerEl = panel.querySelector('#dashboardBottomPanelResizer');

  if (_dashboardBottomPanelResizerEl) {
    _dashboardBottomPanelResizerEl.addEventListener('mousedown', startDashboardBottomPanelResize);
  }

  panel.querySelectorAll('[data-panel-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = String(btn.getAttribute('data-panel-tab') || '').trim();
      if (!tab) return;
      setDashboardBottomPanelTab(tab);
    });
  });

  const addBtn = panel.querySelector('#dashboardBottomPanelAddBtn');
  if (addBtn) {
    addBtn.addEventListener('click', async () => {
      await openCommunityComposerFromTrigger();
    });
  }

  const expandBtn = panel.querySelector('#dashboardBottomPanelExpandBtn');
  if (expandBtn) {
    expandBtn.addEventListener('click', () => {
      const viewport = window.innerHeight || document.documentElement.clientHeight || 900;
      _dashboardBottomPanelHeight = clampDashboardBottomPanelHeight(viewport);
      panel.style.height = `${_dashboardBottomPanelHeight}px`;
    });
  }

  const closeBtn = panel.querySelector('#dashboardBottomPanelCloseBtn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      closeDashboardBottomPanel();
    });
  }

  window.addEventListener('resize', () => {
    if (!_dashboardBottomPanelEl || _dashboardBottomPanelEl.hidden) return;
    _dashboardBottomPanelHeight = clampDashboardBottomPanelHeight(_dashboardBottomPanelHeight);
    _dashboardBottomPanelEl.style.height = `${_dashboardBottomPanelHeight}px`;
  });

  setDashboardBottomPanelTab(_dashboardBottomPanelTab);
  trapDashboardBottomPanelWheel();

  return panel;
}

function trapDashboardBottomPanelWheel() {
  const panel = ensureDashboardBottomPanel();
  const panes = panel.querySelectorAll('.dashboard-bottom-panel__pane');

  panes.forEach((pane) => {
    if (pane._pcWheelBound) return;
    pane._pcWheelBound = true;

    pane.addEventListener('wheel', (event) => {
      const el = pane;
      const delta = event.deltaY;
      const atTop = el.scrollTop <= 0;
      const atBottom = Math.ceil(el.scrollTop + el.clientHeight) >= el.scrollHeight;

      if ((delta < 0 && atTop) || (delta > 0 && atBottom)) {
        event.preventDefault();
      }

      event.stopPropagation();
    }, { passive: false });
  });
}

function setDashboardBottomPanelTab(tab) {
  const raw = String(tab || '').trim().toLowerCase();

  let next = 'reviews';
  if (raw === 'tips') next = 'tips';
  else if (raw === 'questions') next = 'questions';

  _dashboardBottomPanelTab = next;

  const panel = ensureDashboardBottomPanel();

  panel.querySelectorAll('[data-panel-tab]').forEach((btn) => {
    const isActive = String(btn.getAttribute('data-panel-tab') || '') === next;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });

  panel.querySelectorAll('[data-panel-pane]').forEach((pane) => {
    pane.hidden = String(pane.getAttribute('data-panel-pane') || '') !== next;
  });
}

function syncDashboardReviewsTocButton() {
  const btn = document.getElementById('dashboardTocReviewsBtn');
  if (!btn) return;

  btn.classList.toggle('is-open', !!_dashboardBottomPanelOpen);
  btn.setAttribute('aria-pressed', _dashboardBottomPanelOpen ? 'true' : 'false');
}

function openDashboardBottomPanel() {
  const panel = ensureDashboardBottomPanel();
  const viewport = window.innerHeight || document.documentElement.clientHeight || 900;
  _dashboardBottomPanelHeight = clampDashboardBottomPanelHeight(viewport * 0.5);

  panel.hidden = false;
  panel.setAttribute('aria-hidden', 'false');
  panel.style.height = `${_dashboardBottomPanelHeight}px`;

  document.body.classList.add('dashboard-bottom-panel-open');
  _dashboardBottomPanelOpen = true;

  setDashboardBottomPanelTab(_dashboardBottomPanelTab);
  syncDashboardReviewsTocButton();
}

function closeDashboardBottomPanel() {
  if (!_dashboardBottomPanelEl) return;

  _dashboardBottomPanelEl.hidden = true;
  _dashboardBottomPanelEl.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('dashboard-bottom-panel-open');
  _dashboardBottomPanelOpen = false;
  syncDashboardReviewsTocButton();
}

function clampRecommendationScore(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function recommendationTone(score) {
  const n = clampRecommendationScore(score);
  if (n >= 85) return 'great';
  if (n >= 70) return 'good';
  if (n >= 50) return 'mixed';
  return 'low';
}

function recommendationLabel(score) {
  const n = clampRecommendationScore(score);
  if (n >= 90) return 'Strong buy';
  if (n >= 80) return 'Recommended';
  if (n >= 65) return 'Consider';
  if (n >= 50) return 'Mixed';
  return 'Caution';
}

function renderRecommendationBreakdown(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return '';

  return `
    <div class="pc-rec-breakdown">
      ${list.slice(0, 4).map((item) => {
        const label = String(item?.label || '').trim();
        const score = clampRecommendationScore(item?.score);
        if (!label) return '';

        return `
          <div class="pc-rec-metric">
            <div class="pc-rec-metric__ring">
              <svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">
                <circle class="pc-rec-metric__track" cx="60" cy="60" r="48"></circle>
                <circle
                  class="pc-rec-metric__value pc-rec-metric__value--${recommendationTone(score)}"
                  cx="60"
                  cy="60"
                  r="48"
                  pathLength="100"
                  stroke-dasharray="${score} 100"
                ></circle>
              </svg>
              <span>${score}</span>
            </div>
            <div class="pc-rec-metric__label">${escapeHtml(label)}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderRecommendationList(title, items, kind) {
  const list = Array.isArray(items)
    ? items.map(v => String(v || '').trim()).filter(Boolean)
    : [];

  return `
    <div class="pc-rec-list-card">
      <div class="pc-rec-list-card__title pc-rec-list-card__title--${kind}">
        ${escapeHtml(title)} <span class="pc-rec-list-card__count">(${list.length})</span>
      </div>

      ${
        list.length
          ? `<div class="pc-rec-list">
              ${list.map(item => `
                <div class="pc-rec-list__item pc-rec-list__item--${kind}">
                  <span class="pc-rec-list__dot" aria-hidden="true"></span>
                  <span>${escapeHtml(item)}</span>
                </div>
              `).join('')}
            </div>`
          : `<div class="note">Nothing added yet.</div>`
      }
    </div>
  `;
}

function renderRecommendationCard() {
  const card = document.getElementById('recommendationCard');
  const el = document.getElementById('recommendationContent');
  if (!card || !el) return;

  const rec = state.recommendation;
  if (!rec) {
    card.hidden = true;
    el.innerHTML = '';
    return;
  }

  const score = clampRecommendationScore(rec.overall_score);
  const tone = recommendationTone(score);
  const verdict = String(rec.verdict || recommendationLabel(score)).trim();
  const summary = String(rec.summary || '').trim();
  const warning = 'This AI-generated summary may be incomplete or inaccurate. Please verify important details before buying.';

  card.hidden = false;
  el.innerHTML = `
    <div class="pc-rec pc-rec--${tone}">
      <div class="pc-rec-top">
        <div class="pc-rec-score-wrap">
          <div class="pc-rec-score-box">${score}</div>
          <div class="pc-rec-score-scale">/ 100</div>
        </div>

        <div class="pc-rec-main">
          <div class="pc-rec-verdict-row">
            <div class="pc-rec-verdict">${escapeHtml(verdict)}</div>
          </div>

          <div class="pc-rec-bar">
            <div class="pc-rec-bar__fill pc-rec-bar__fill--${tone}" style="width:${score}%"></div>
          </div>

          ${summary ? `<p class="pc-rec-summary">${escapeHtml(summary)}</p>` : ''}
        </div>
      </div>

      <div class="pc-rec-warning">
        <strong>Note:</strong> ${escapeHtml(warning)}
      </div>

      ${renderRecommendationBreakdown(rec.score_breakdown)}

      <div class="pc-rec-lists">
        ${renderRecommendationList('Pros', rec.strengths, 'pro')}
        ${renderRecommendationList('Cons', rec.weaknesses, 'con')}
      </div>

      <div class="pc-rec-warning">
        <strong>Note:</strong> This section may reflect subjective opinions from sources such as YouTube, Reddit, and partner sites. Use Specs, Price History, Sellers, and Expert Reviews for more objective evaluation.
      </div>
    </div>
  `;
}

function startDashboardBottomPanelResize(event) {
  if (!_dashboardBottomPanelEl) return;
  event.preventDefault();

  const startY = event.clientY;
  const startHeight = _dashboardBottomPanelHeight;

  const onMove = (moveEvent) => {
    const delta = startY - moveEvent.clientY;
    _dashboardBottomPanelHeight = clampDashboardBottomPanelHeight(startHeight + delta);
    _dashboardBottomPanelEl.style.height = `${_dashboardBottomPanelHeight}px`;
  };

  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    document.body.classList.remove('dashboard-bottom-panel-resizing');
    _dashboardBottomPanelDragCleanup = null;
  };

  document.body.classList.add('dashboard-bottom-panel-resizing');
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);

  _dashboardBottomPanelDragCleanup = onUp;
}

function buildSidebarRecommendationTocButton() {
  const rec = state.recommendation;
  if (!rec) return '';

  const score = clampRecommendationScore(rec.overall_score);
  const tone = recommendationTone(score);
  const label = recommendationLabel(score);

  return `
    <button
      type="button"
      class="dashboard-toc__btn dashboard-toc__btn--score dashboard-toc__btn--score-${tone}"
      id="dashboardTocRecommendationBtn"
      aria-label="Recommendation score ${score}"
      data-tooltip="Score"
    >
      <span class="dashboard-toc__score">${score}</span>
    </button>
  `;
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
          class="dashboard-toc__btn"
          id="dashboardTocReviewsBtn"
          aria-label="Reviews"
          title="Reviews"
        >
          <svg viewBox="0 -960 960 960" aria-hidden="true" focusable="false">
            <path d="M240-400h320v-80H240v80Zm0-120h480v-80H240v80Zm0-120h480v-80H240v80ZM80-80v-720q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H240L80-80Zm126-240h594v-480H160v525l46-45Zm-46 0v-480 480Z"></path>
          </svg>
        </button>

        ${buildSidebarRecommendationTocButton()}
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

  const reviewsBtn = document.getElementById('dashboardTocReviewsBtn');
  if (reviewsBtn) {
    reviewsBtn.addEventListener('click', () => {
      if (_dashboardBottomPanelOpen) {
        closeDashboardBottomPanel();
        return;
      }

      openDashboardBottomPanel();
      setDashboardBottomPanelTab('reviews');
    });
  }

  const recommendationBtn = document.getElementById('dashboardTocRecommendationBtn');
  if (recommendationBtn) {
    recommendationBtn.addEventListener('click', () => {
      const target = document.getElementById('recommendationCard');
      if (!target || target.hidden) return;

      scrollToDashboardCard(target);
    });
  }

  syncDashboardReviewsTocButton();
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
  const cur = getCurrentVariant() || null;
  const id = state.identity || {};

  const brand = String(cur?.brand || id?.brand || '').trim();
  const rawTitle = String(title || 'Product').trim() || 'Product';

  const cleanTitle = `${brand} ${rawTitle}`.trim();
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
      .map(word =>
        word
          .split('-')
          .map(part => part ? (part[0].toUpperCase() + part.slice(1).toLowerCase()) : part)
          .join('-')
      )
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

function computeWeightedTitleRating(){
  const customerSources = Array.isArray(state.reviewCustomerSources)
    ? state.reviewCustomerSources
    : [];

  let weightedSum = 0;
  let totalCount = 0;

  for (const source of customerSources) {
    const rating = Number(source?.rating ?? source?.score ?? source?.overall);
    const count = Number(source?.review_count ?? source?.count);

    if (!Number.isFinite(rating) || rating <= 0) continue;
    if (!Number.isFinite(count) || count <= 0) continue;

    weightedSum += rating * count;
    totalCount += count;
  }

  if (totalCount <= 0) return null;

  return {
    score: weightedSum / totalCount,
    count: totalCount
  };
}

function titleRatingTone(score){
  const n = Number(score);

  if (!Number.isFinite(n) || n <= 0) return 'low';
  if (n >= 4.6) return 'great';
  if (n >= 4.0) return 'good';
  if (n >= 3.0) return 'mixed';
  return 'low';
}

function renderTitleRatingBadge(){
  const el = document.getElementById('phTitleRating');
  if (!el) return;

  const data = computeWeightedTitleRating();

  el.className = 'ph-title-rating';
  el.hidden = true;
  el.textContent = '';

  if (!data) return;

  const score = Number(data.score);
  const tone = titleRatingTone(score);

  el.textContent = `★ ${score.toFixed(1)}`;
  el.classList.add(`ph-title-rating--${tone}`);
  el.setAttribute('data-tooltip', 'Rating');
  el.setAttribute('aria-label', 'Rating');
  el.setAttribute('tabindex', '0');
  el.hidden = false;
}

function clearTitleRatingBadge(){
  const el = document.getElementById('phTitleRating');
  if (!el) return;

  el.className = 'ph-title-rating';
  el.hidden = true;
  el.textContent = '';
}

function clearTopbarRatingSummary(){
  setTopbarRatingSummary(null, null);
}

function wireTopbarCommentButton(){
  const btn = document.getElementById('phCommentBtn');
  if (!btn || btn._pcBound) return;

  btn._pcBound = true;
  btn.addEventListener('click', async () => {
    await openCommunityComposerFromTrigger();
  });
}

function communityAvatarHtml(name, imageUrl){
  const img = String(imageUrl || '').trim();
  const safeName = String(name || 'User').trim() || 'User';
  const initial = escapeHtml((safeName[0] || 'U').toUpperCase());

  if (img) {
    return `
      <span class="pc-tip-card__avatar pc-tip-card__avatar--wrap" aria-hidden="true">
        <img
          class="pc-tip-card__avatar"
          src="${escapeHtml(img)}"
          alt="${escapeHtml(safeName)}"
          loading="lazy"
          decoding="async"
          onerror="this.style.display='none';this.nextElementSibling.hidden=false;"
        >
        <span class="pc-tip-card__avatar-fallback" hidden>${initial}</span>
      </span>
    `;
  }

  return `
    <span class="pc-tip-card__avatar pc-tip-card__avatar--text" aria-hidden="true">
      ${initial}
    </span>
  `;
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
  ensureDashboardBottomPanel();

  const tipsListEl = document.getElementById('dashboardBottomCommunityTipsList');
  const questionsListEl = document.getElementById('dashboardBottomCommunityQuestionsList');

  if (!tipsListEl || !questionsListEl) {
    return;
  }

  const resolvedProductKey =
  typeof productKey === 'string'
    ? productKey
    : (productKey && typeof productKey.key === 'string' ? productKey.key : '');

  if (!resolvedProductKey) {
    tipsListEl.innerHTML = '<div class="sidebar-empty">No tips yet.</div>';
    questionsListEl.innerHTML = '<div class="sidebar-empty">No questions yet.</div>';
    return;
  }

  tipsListEl.innerHTML = '<div class="sidebar-empty">Loading.</div>';
  questionsListEl.innerHTML = '<div class="sidebar-empty">Loading.</div>';

  let signedIn = false;
  let data;

  try {
    const [communityRes, authRes] = await Promise.all([
      fetch(`/api/community/${encodeURIComponent(resolvedProductKey)}`, {
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
    ? questions.map((question) => {
        const questionId = String(question.id || '').trim();
        const answerCount = Number(question.answer_count || 0);
        const canReply = !!questionId;

        return `
          <article class="pc-question-card">
            <div class="pc-question-card__body">${escapeHtml(question.body || '')}</div>

            <div class="pc-question-card__meta">
              <div class="pc-question-card__author">
                ${communityAvatarHtml(question.author_name, question.profile_image_url)}
                <div class="pc-question-card__author-meta">
                  <div class="pc-question-card__name">${escapeHtml(question.author_name || 'User')}</div>
                  <div class="pc-question-card__sub">${escapeHtml(communityRelativeTime(question.created_at) || '')}</div>
                </div>
              </div>

              <div class="pc-question-card__actions">
                ${
                  canReply
                    ? `
                      <a href="#" class="pc-question-card__link" data-question-answer-link="${escapeHtml(questionId)}">
                        ${answerCountLabel(answerCount)}
                      </a>

                      <button type="button" class="pc-question-card__reply" data-question-reply-toggle="${escapeHtml(questionId)}">
                        ${replyIconSvg()}
                        <span>Reply</span>
                      </button>
                    `
                    : ''
                }
              </div>
            </div>

            ${
              canReply
                ? `
                  <div class="pc-question-reply-box" data-question-reply-box="${escapeHtml(questionId)}" hidden>
                    <form class="pc-question-reply-form" data-question-reply-form="${escapeHtml(questionId)}">
                      <textarea rows="3" placeholder="Write a helpful reply"></textarea>
                      <div class="pc-question-reply-actions">
                        <div class="pc-question-reply-error" data-question-reply-error hidden></div>
                        <button type="submit">Reply</button>
                      </div>
                    </form>
                  </div>
                `
                : ''
            }
          </article>
        `;
      }).join('')
    : '<div class="sidebar-community">No questions yet. Ask the first useful question.</div>';

  wireQuestionReplyUi(signedIn);
}

function wireExpertReviewFollowButtons() {
  document.querySelectorAll('[data-expert-follow]').forEach((btn) => {
    if (btn._pcBound) return;
    btn._pcBound = true;

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

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

        alert('Following expert review sources is not live yet.');
        return;

        // Follow save logic can be added next.
      } catch {
        if (typeof window.pcOpenSignIn === 'function') {
          window.pcOpenSignIn();
          return;
        }

        alert('Please sign in first.');
      }
    });
  });
}

function ratingLogoSlug(raw){
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

function renderExpertReviewSource(source, url, title){
  const name = String(source || 'Source').trim() || 'Source';
  const logoSrc = `/logo/ratings/${ratingLogoSlug(name)}.webp`;

  if (url) {
    return `
      <a
        class="pc-rv-expert-title-row pc-rv-expert-title-row--link"
        href="${escapeHtml(url)}"
        target="_blank"
        rel="noopener"
        aria-label="Open ${escapeHtml(title || name)}"
      >
        <span style="display:inline-flex;align-items:center;min-height:40px;">
          <img
            src="${escapeHtml(logoSrc)}"
            alt="${escapeHtml(name)}"
            loading="lazy"
            decoding="async"
            style="height:auto;width:180px;display:block;"
            onerror="this.style.display='none';this.nextElementSibling.hidden=false;"
          >
          <span class="pc-rv-expert-title" hidden>${escapeHtml(name)}</span>
        </span>

        <span class="pc-rv-expert-title-link" aria-hidden="true" style="display:none;">
          ${REVIEW_EXTERNAL_SVG}
        </span>
      </a>
    `;
  }

  return `
    <div class="pc-rv-expert-title-row">
      <span style="display:inline-flex;align-items:center;min-height:40px;">
        <img
          src="${escapeHtml(logoSrc)}"
          alt="${escapeHtml(name)}"
          loading="lazy"
          decoding="async"
          style="height:auto;width:170px;display:block;"
          onerror="this.style.display='none';this.nextElementSibling.hidden=false;"
        >
        <span class="pc-rv-expert-title" hidden>${escapeHtml(name)}</span>
      </span>
    </div>
  `;
}

async function renderReviewsCard(productKey, runToken) {

  ensureDashboardBottomPanel();

  const cardEl = document.getElementById('pcReviewsMainCard');
  const el = document.getElementById('pcReviewsMainContent');
  const bottomReviewsEl = document.getElementById('dashboardBottomReviewsContent');

  if (!cardEl || !el) return;

  function mountCustomerReviews(inner) {
    if (runToken != null && isStaleRun(runToken)) return;
    if (!cardEl || !el) return;

    if (!inner) {
      cardEl.hidden = true;
      el.innerHTML = '';
      return;
    }

    cardEl.hidden = false;
    el.innerHTML = inner;
  }

  function mountUserReviews(inner) {
    if (runToken != null && isStaleRun(runToken)) return;
    if (bottomReviewsEl) bottomReviewsEl.innerHTML = inner;
  }

  const resolvedProductKey =
    typeof productKey === 'string'
      ? productKey
      : (productKey && typeof productKey.key === 'string' ? productKey.key : '');

  if (!resolvedProductKey) {
    mountCustomerReviews('');

    mountUserReviews(`
      <section class="pc-review-section">
        <p class="note">No reviews yet. Be the first to share your experience with this product.</p>
      </section>
    `);

    clearTitleRatingBadge();
    wireCardIcons();
    return;
  }

  mountCustomerReviews(`
    <div class="pc-reviews-wrap pc-reviews-loading">
      <div class="pc-reviews-skeleton"></div>
      <div class="pc-reviews-skeleton pc-reviews-skeleton--short"></div>
      <div class="pc-reviews-skeleton"></div>
    </div>
  `);

  mountUserReviews(`
    <div class="pc-reviews-wrap pc-reviews-loading">
      <div class="pc-reviews-skeleton"></div>
      <div class="pc-reviews-skeleton pc-reviews-skeleton--short"></div>
      <div class="pc-reviews-skeleton"></div>
    </div>
  `);
  wireCardIcons();

  let data;
  try {
    const res = await fetch(`/api/reviews/${encodeURIComponent(resolvedProductKey)}`, {
      headers: { Accept: 'application/json' }
    });

    if (runToken != null && isStaleRun(runToken)) return;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    data = await res.json();

    if (runToken != null && isStaleRun(runToken)) return;
  } catch (_err) {
    if (runToken != null && isStaleRun(runToken)) return;

    mountCustomerReviews('');
    clearTitleRatingBadge();

    mountUserReviews(`
      <section class="pc-review-section">
        <p class="note">No reviews yet. Be the first to share your experience with this product.</p>
      </section>
    `);

    wireCardIcons();
    return;
  }

  const aggregate = data && typeof data === 'object' ? (data.aggregate || {}) : {};
  const customerSources = Array.isArray(data?.customer_sources)
    ? data.customer_sources
    : (Array.isArray(data?.sources) ? data.sources : []);
  state.reviewCustomerSources = customerSources;
  const expertReviews = Array.isArray(data?.expert_reviews) ? data.expert_reviews : [];
  let communityReviews = Array.isArray(state.community?.reviews) ? state.community.reviews : [];

  if (!communityReviews.length) {
    try {
      const communityRes = await fetch(`/api/community/${encodeURIComponent(resolvedProductKey)}`, {
        headers: { Accept: 'application/json' }
      });

      if (runToken != null && isStaleRun(runToken)) return;

      if (communityRes.ok) {
        const communityData = await communityRes.json().catch(() => null);
        const fetchedReviews = Array.isArray(communityData?.reviews) ? communityData.reviews : [];

        if (fetchedReviews.length) {
          communityReviews = fetchedReviews;

          state.community = {
            tips: Array.isArray(communityData?.tips) ? communityData.tips : (state.community?.tips || []),
            questions: Array.isArray(communityData?.questions) ? communityData.questions : (state.community?.questions || []),
            reviews: fetchedReviews,
            counts: {
              tips: Number(communityData?.counts?.tips || state.community?.counts?.tips || 0),
              questions: Number(communityData?.counts?.questions || state.community?.counts?.questions || 0),
              reviews: Number(communityData?.counts?.reviews || fetchedReviews.length || 0)
            }
          };
        }
      }
    } catch {
      // keep fallback from state.community only
    }
  }
  const distribution = (data && typeof data.distribution === 'object' && data.distribution)
    ? data.distribution
    : { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };

  const total = Number(aggregate.count || 0);
  const overallNum = Number(aggregate.overall);
  const overall = Number.isFinite(overallNum) ? overallNum : 0;
  renderTitleRatingBadge();

  const verifiedPctNum = Number(aggregate.verified_pct);
  const verifiedPct = Number.isFinite(verifiedPctNum)
    ? Math.max(0, Math.min(100, Math.round(verifiedPctNum)))
    : null;

  const hasCustomer = total > 0 && overall > 0;
  const hasExpert = expertReviews.length > 0;
  const hasCommunity = communityReviews.length > 0;

  if (!hasCustomer && !hasExpert && !hasCommunity) {
  mountCustomerReviews('');

  mountUserReviews(`
    <section class="pc-review-section">
      <p class="note">No reviews yet. Be the first to share your experience with this product.</p>
    </section>
  `);

  clearTitleRatingBadge();
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

  let userReviewsHtml = '';

if (communityReviews.length) {
  userReviewsHtml = `
    <section class="pc-review-section">
      <div class="pc-rv-user-grid">
        ${communityReviews.map((review) => `
          <article class="pc-rv-expert-card">
            <div class="pc-rv-expert-top">
              <div class="pc-rv-expert-main">
                <div class="pc-rv-expert-source">${escapeHtml(review.author_name || 'User')}</div>
              </div>

              <div class="pc-rv-expert-score">
                <div class="pc-rv-expert-score-main">${escapeHtml(communityStars(review.rating))}</div>
              </div>
            </div>

            <div class="pc-rv-expert-verdict">${escapeHtml(review.body || '')}</div>

            <div class="pc-rv-expert-footer">
              <div class="pc-rv-expert-date">${escapeHtml(communityRelativeTime(review.created_at) || '')}</div>
            </div>
          </article>
        `).join('')}
      </div>
    </section>
  `;
} else {
  userReviewsHtml = `
    <section class="pc-review-section">
      <p class="note">No reviews yet. Be the first to share your experience with this product.</p>
    </section>
  `;
}

let customerHtml = '';

if (hasCustomer) {
  const breakdownRows = [5, 4, 3, 2, 1].map((star) => {
    const count = Number(distribution[star] || 0);
    const width = pct(count, total);

    return `
      <div class="pc-rv-breakdown-row">
        <div class="pc-rv-breakdown-left">
          <span class="pc-rv-breakdown-star-icon">${REVIEW_STAR_SVG}</span>
          <span class="pc-rv-breakdown-star-label">${star} star</span>
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

  const sortedSources = [...customerSources]
    .map((source) => {
      const count = Number(source?.review_count || source?.count || 0);
      return {
        ...source,
        _count: Number.isFinite(count) ? count : 0
      };
    })
    .sort((a, b) => b._count - a._count);

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

      const normalizedLabel = scoreOutOf5 != null ? `${scoreOutOf5.toFixed(1)}` : '';
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
             <div
                class="pc-rv-expert-title-row"
                style="gap:15px; justify-content:space-between;flex-wrap:wrap;"
              >
                ${renderExpertReviewSource(source, url, title)}

                <button
                  type="button"
                  class="ph-follow pc-rv-expert-follow"
                  data-expert-follow="${escapeHtml(source)}"
                  aria-label="Follow ${escapeHtml(source)}"
                  style="border:1px solid lightgray"
                >
                  Follow
                </button>
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
                  ${pros.map((p) => `
                    <span
                      class="pc-rv-expert-chip pc-rv-expert-chip--pro"
                      data-tooltip="Pro"
                      aria-label="Pro"
                      tabindex="0"
                    >${escapeHtml(p)}</span>
                  `).join('')}
                </div>
              `
              : ''
          }

          ${
            cons.length
              ? `
                <div class="pc-rv-expert-meta">
                  ${cons.map((c) => `
                    <span
                      class="pc-rv-expert-chip pc-rv-expert-chip--con"
                      data-tooltip="Con"
                      aria-label="Con"
                      tabindex="0"
                    >${escapeHtml(c)}</span>
                  `).join('')}
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
        <div class="pc-rv-expert-list">
          ${expertRows}
        </div>
      </section>
    `;
  } else {
    expertHtml = '';
  }

  if (runToken != null && isStaleRun(runToken)) return;

  mountCustomerReviews(`
    <div class="pc-reviews-wrap">
      ${customerHtml}
      ${expertHtml}
    </div>
  `);

  mountUserReviews(`
  <div class="pc-reviews-wrap">
    ${userReviewsHtml}
  </div>
`);

wireExpertReviewFollowButtons();
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

    b.addEventListener('mouseenter', () => {
      const previewItem = previewItemFromChoice(opt);
      if (!previewItem) return;
      previewHeroMediaItem(previewItem);
    });

    b.addEventListener('focus', () => {
      const previewItem = previewItemFromChoice(opt);
      if (!previewItem) return;
      previewHeroMediaItem(previewItem);
    });

    const img = b.querySelector('img');
    if (img) {
      img.addEventListener('error', () => {
        img.src = '/logo/default.webp';
      }, { once: true });
    }

    hostEl.appendChild(b);
  }

  hostEl.onmouseleave = () => {
    restoreHeroMediaPreview();
  };

  hostEl.onfocusout = () => {
    requestAnimationFrame(() => {
      if (!hostEl.contains(document.activeElement)) {
        restoreHeroMediaPreview();
      }
    });
  };
}

function pushVariantSelectionAndRun(){
  if (!state.selectedVariantKey) return;
  applyPrettyUrl(state.selectedVariantKey, $('#pTitle')?.textContent || 'Product', 'push');
  run(state.selectedVariantKey);
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
  await loadSpecPillConfigOnce();
  initDashboardShortlistUi();
  initDashboardTocObservers();
  scheduleDashboardTocRefresh();
  wireTopbarCommentButton();
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
    state.recommendation = (data.recommendation && typeof data.recommendation === 'object')
    ? data.recommendation
    : null;
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
    renderRecommendationCard();
    drawChart();
    renderCouponsCard();
    renderTopSpecPills();
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

    renderMarketingImagesCard();

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

    syncDashboardShortlistButton();
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
  state.reviewCustomerSources = [];
  clearTitleRatingBadge();

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

  if (aboutCard) aboutCard.hidden = true;
  if (aboutParagraphs) aboutParagraphs.innerHTML = '';
  if (aboutPoints) aboutPoints.innerHTML = '';

  if (brandRow) brandRow.hidden = true;
  if (brandLine) brandLine.textContent = '';

  const topPriceCard = document.getElementById('phTopPriceCard');
  const topPriceValue = document.getElementById('phTopPriceValue');
  const topCoinsValue = document.getElementById('phTopCoinsValue');

  if (topPriceCard) topPriceCard.hidden = true;
  if (topPriceValue) topPriceValue.innerHTML = '';
  if (topCoinsValue) topCoinsValue.textContent = '';

  const recallWrap = document.getElementById('ps-recall');
  const recallLink = document.getElementById('ps-recall-link');
  if (recallWrap) recallWrap.hidden = true;
  if (recallLink) recallLink.removeAttribute('href');

  const warnEl = document.getElementById('ps-warn');
  if (warnEl) warnEl.hidden = true;

  const limitedEl = document.getElementById('ps-limited');
  if (limitedEl) limitedEl.hidden = true;

  if (contentsCard) contentsCard.hidden = true;
  if (contentsContent) contentsContent.innerHTML = '';

  if (variant2Card) variant2Card.hidden = true;
  if (variant2Pills) variant2Pills.innerHTML = '';

  if (colorCard) colorCard.hidden = true;
  if (colorPills) colorPills.innerHTML = '';

  syncVariantColorSectionVisibility();

  const reviewsCard = document.getElementById('pcReviewsMainCard');
  const reviewsContent = document.getElementById('pcReviewsMainContent');

  if (reviewsCard) reviewsCard.hidden = true;
  if (reviewsContent) reviewsContent.innerHTML = '';

  $('#offers').innerHTML = '';
  $('#offersNote').textContent = '';

  state.followBrand = '';
  state.followingBrand = false;
  state.followStateKnown = false;
  state.followBusy = false;
  setFollowButtonUi();

  const specsCard = document.getElementById('specsCard');
  const specsContent = document.getElementById('specsContent');
  if (specsCard) specsCard.hidden = true;
  if (specsContent) specsContent.innerHTML = '';

state.mediaItems = [];
state.activeMediaIndex = 0;

const mediaInner = document.getElementById('phMediaInner');
const mediaStage = document.getElementById('phMediaStage');
const mediaStripSection = document.getElementById('mediaStripSection');
const mediaStripPills = document.getElementById('mediaStripPills');

if (mediaInner) {
  mediaInner.innerHTML = `
    <div class="ph-media-stage__placeholder">
      <div class="ph-media-stage__title">No media yet</div>
      <div class="ph-media-stage__sub">Media for this product has not been added yet.</div>
    </div>
  `;
}

  if (mediaStage) mediaStage.classList.remove('is-vertical');
  if (mediaStripSection) mediaStripSection.hidden = true;
  if (mediaStripPills) mediaStripPills.innerHTML = '';

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
  $('#chartNote').className = 'muted';
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

  const bottomTips = document.getElementById('dashboardBottomCommunityTipsList');
  const bottomQuestions = document.getElementById('dashboardBottomCommunityQuestionsList');
  const bottomReviews = document.getElementById('dashboardBottomReviewsContent');

  if (bottomTips) {
    bottomTips.innerHTML = `
      <div class="sidebar-empty">
        No tips yet. Be the first to share something useful about this product.
      </div>
    `;
  }

  if (bottomQuestions) {
    bottomQuestions.innerHTML = `
      <div class="sidebar-empty">
        No questions yet.
      </div>
    `;
  }

  if (bottomReviews) {
    bottomReviews.innerHTML = `
      <section class="pc-review-section">
        <p class="note">No reviews yet. Be the first to share your experience with this product.</p>
      </section>
    `;
  }

  syncDashboardShortlistButton();
  scheduleDashboardTocRefresh();
}

  function escapeHtml(s){
    return String(s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  function buildDashboardHeaderShortlistItem() {
    const key = String(state.lastKey || "").trim();
    if (!key) return null;

    const cur = getCurrentVariant() || null;
    const id = state.identity || {};

    const title =
      String(
        cur?.model_name ||
        id?.model_name ||
        id?.model_number ||
        "Product"
      ).trim() || "Product";

    const brand =
      String(cur?.brand || id?.brand || "").trim();

    const img =
      String(
        cur?.image_url ||
        id?.image_url ||
        "/logo/default.webp"
      ).trim();

    const priceCents = (() => {
      const offers = Array.isArray(state.offers) ? state.offers : [];

      const nums = offers
        .map((o) => {
          const effective = Number(o?.effective_price_cents);
          const current = Number(o?.price_cents ?? o?.current_price_cents);

          if (Number.isFinite(effective) && effective > 0) return effective;
          if (Number.isFinite(current) && current > 0) return current;
          return null;
        })
        .filter((v) => Number.isFinite(v) && v > 0);

      return nums.length ? Math.min(...nums) : null;
    })();

    const href = prettyDashboardUrl(key, title).pathname;

    return {
      key,
      href,
      title,
      brand,
      img,
      priceCents,
      source: "dashboard"
    };
  }

  function syncDashboardShortlistButton() {
    const api = window.PriceCheckShortlist;
    const btn = document.getElementById("phShortlistBtn");
    if (!btn) return;

    const key = String(state.lastKey || "").trim();

    if (!api || !key) {
      btn.hidden = true;
      return;
    }

    btn.hidden = false;
    const on = api.has(key);
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-label", on ? "Remove from shortlist" : "Save to shortlist");
    btn.title = on ? "Remove from shortlist" : "Save to shortlist";

    const iconOff = btn.querySelector("[data-shortlist-icon='off']");
    const iconOn = btn.querySelector("[data-shortlist-icon='on']");
    if (iconOff) iconOff.hidden = on;
    if (iconOn) iconOn.hidden = !on;
  }

  function initDashboardShortlistUi() {
    const api = window.PriceCheckShortlist;
    if (!api) return;

    if (!document.body.dataset.dashboardShortlistBound) {
      document.body.dataset.dashboardShortlistBound = "1";

      document.body.addEventListener("click", (e) => {
        const headerBtn = e.target.closest("#phShortlistBtn");
        if (headerBtn) {
          e.preventDefault();
          e.stopPropagation();

          const item = buildDashboardHeaderShortlistItem();
          if (!item) return;

          api.toggle(item);
          syncDashboardShortlistButton();
          return;
        }

        const saveBtn = e.target.closest("[data-shortlist-toggle='1']");
        if (!saveBtn) return;

        e.preventDefault();
        e.stopPropagation();

        const card = saveBtn.closest("[data-dash-key]");
        const item = shortlistItemFromDashboardCard(card);
        if (!item) return;

        api.toggle(item);
        syncDashboardShortlistButton();
      });
    }

    window.addEventListener("pc:shortlist_changed", () => {
      syncDashboardShortlistButton();
    });

    api.mountRail();
    syncDashboardShortlistButton();
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

    renderHeaderPriceCard();

    const verifiedDot = document.getElementById('pVerifiedDot');
    if (verifiedDot) {
      verifiedDot.hidden = !title || title === 'Product' || /^loading\.{0,3}$/i.test(String(title).trim());
    }

    const pIdsEl = $('#pIds');
    if (pIdsEl) {
      pIdsEl.innerHTML = '';
      pIdsEl.hidden = true;
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
    const brandHref = sellerHrefFromStore(brand);

    if (brandRow) brandRow.hidden = !brand;

    if (brandLine) {
      brandLine.textContent = brand || '';

      if (brand && brandHref) {
        brandLine.href = brandHref;
        brandLine.hidden = false;
        brandLine.setAttribute('aria-label', `Open ${brand} seller page`);
        brandLine.removeAttribute('tabindex');
      } else {
        brandLine.removeAttribute('href');
        brandLine.hidden = !brand;
      }
    }

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
  return document.querySelector('.ph-follow:not([data-expert-follow])');
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

let _labelPanelOpen   = false;
let _labelPanelEl     = null;

function _ensureLabelPanel() {
  if (_labelPanelEl) return _labelPanelEl;

  _labelPanelEl = document.createElement("div");
  _labelPanelEl.id = "pcLabelPickerPanel";
  _labelPanelEl.setAttribute("role", "dialog");
  _labelPanelEl.setAttribute("aria-label", "Save to Bookmarks");
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
      <span style="font-size:14px;font-weight:700;color:#111827;">Bookmark Manager</span>
      <a href="/labels/" style="font-size:14px;color:#6366f1;text-decoration:none;font-weight:600;">Edit</a>
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
  await wireLabelTrigger(entityKey, title, imageUrl, brand);
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
        const use = (e != null && p != null && e <= p) ? e : p;
        return use;
      })
      .filter(v => typeof v === 'number' && v > 0)
      .sort((a,b)=>a-b);

    if (priced.length) {
      const today = new Date().toISOString().slice(0, 10);
      workingPts = [{ d: today, price_cents: priced[0] }];
    } else {
      note.className = 'muted';
      note.textContent = 'No history yet';
      return;
    }
  }

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
    note.className = 'muted';
    note.textContent = 'No history yet';
    return;
  }

  renderHistoryVerdict(filtered);

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

    renderHistoryVerdict(filtered);
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

  function getHistoryTrendVerdict(points){
  const rows = Array.isArray(points) ? points : [];
  if (rows.length < 2) {
    return {
      key: 'stable',
      label: 'Stable'
    };
  }

  const first = Number(rows[0]?.price_cents);
  const last  = Number(rows[rows.length - 1]?.price_cents);

  if (!Number.isFinite(first) || !Number.isFinite(last) || first <= 0 || last <= 0) {
    return {
      key: 'stable',
      label: 'Stable'
    };
  }

  const delta = last - first;
  const pct = Math.abs(delta) / first;

  if (Math.abs(delta) < 300 || pct < 0.02) {
    return {
      key: 'stable',
      label: 'Stable'
    };
  }

  if (delta > 0) {
    return {
      key: 'wait',
      label: 'Wait'
    };
  }

  return {
    key: 'lower',
    label: 'Tracking Lower'
  };
}

  function renderHistoryVerdict(filtered){
  const note = $('#chartNote');
  if (!note) return;

  if (!Array.isArray(filtered) || !filtered.length) {
    note.className = 'muted';
    note.textContent = 'No history yet';
    return;
  }

  const verdict = getHistoryTrendVerdict(filtered);

  note.className = `history-verdict history-verdict--${verdict.key}`;
  note.innerHTML = `
    <span class="history-verdict__pill">${escapeHtml(verdict.label)}</span>
  `;
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

  function splitHeaderPriceParts(cents){
  const n = Number(cents);
  if (!Number.isFinite(n) || n <= 0) return null;

  const whole = String(Math.floor(n / 100));
  const frac = String(n % 100).padStart(2, '0');

  return { whole, frac };
}

function renderHeaderPriceCard(){
  const card = document.getElementById('phTopPriceCard');
  const priceEl = document.getElementById('phTopPriceValue');
  const coinsEl = document.getElementById('phTopCoinsValue');

  if (!card || !priceEl || !coinsEl) return;

  const bestCents = bestOfferCentsToday();
  const parts = splitHeaderPriceParts(bestCents);

  if (!parts) {
    card.hidden = true;
    priceEl.innerHTML = '';
    coinsEl.textContent = '';
    return;
  }

  const coinCount = Math.ceil(bestCents / 100);

  priceEl.innerHTML = `
    <span class="ph-top-price__from">from</span>
    <span class="ph-top-price__currency">$</span>
    <span class="ph-top-price__whole">${escapeHtml(parts.whole)}</span>
    <span class="ph-top-price__cents">.${escapeHtml(parts.frac)}</span>
  `;

  coinsEl.textContent = `${coinCount} Points`;
  card.hidden = false;
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
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      const [y, m, d] = rawDate.split('-').map(Number);
      const localDate = new Date(y, m - 1, d);

      if (!Number.isNaN(localDate.getTime())) {
        stamp = localDate.getTime();
        dateLabel = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(localDate);
      }
    } else {
      const parsed = new Date(rawDate);

      if (!Number.isNaN(parsed.getTime())) {
        stamp = parsed.getTime();
        dateLabel = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(parsed);
      } else if (/^\d{4}$/.test(rawDate)) {
        stamp = Date.UTC(Number(rawDate), 0, 1);
        dateLabel = rawDate;
      }
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

  let current = null;
  let past = null;
  let future = null;
  let currentIndex = -1;

  if (currentKey) {
    for (let i = items.length - 1; i >= 0; i--) {
      if (dashboardKeyFromHref(items[i]?.href) === currentKey) {
        currentIndex = i;
        break;
      }
    }
  }

  if (currentIndex === -1) {
    for (let i = items.length - 1; i >= 0; i--) {
      if (!items[i]?.future) {
        currentIndex = i;
        break;
      }
    }
  }

  if (currentIndex >= 0) {
    current = items[currentIndex] || null;
    past = currentIndex > 0 ? items[currentIndex - 1] : null;

    for (let i = currentIndex + 1; i < items.length; i++) {
      const candidate = items[i];
      const candidateKey = dashboardKeyFromHref(candidate?.href);

      if (currentKey) {
        if (candidateKey && candidateKey !== currentKey) {
          future = candidate;
          break;
        }
      } else {
        if (candidate?.href !== current?.href || candidate?.title !== current?.title) {
          future = candidate;
          break;
        }
      }
    }
  }

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
      'audio technica': 'audio-technica',
      'audio-technica': 'audio-technica',
      'amazon': 'amazon',
      'walmart': 'walmart',
      'target': 'target',
      'apple': 'apple'
    };

    if (map[raw]) return map[raw];

    return raw
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function sellerHrefFromStore(store){
    const slug = sellerSlugFromStore(store);
    if (!slug) return '';
    return `/seller/${encodeURIComponent(slug)}/`;
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
    if (offer?.return_days != null) {
      const n = Number(offer.return_days);
      if (Number.isFinite(n) && n > 0) {
        return `${n}d`;
      }
    }

    const sellerPeriod = String(seller?.policies?.return_period || '').trim();
    if (sellerPeriod) {
      const m = sellerPeriod.match(/(\d+)\s*(?:day|days|d)\b/i);
      if (m && m[1]) return `${m[1]}d`;
    }

    const offerPolicy = String(offer?.return_policy || '').trim();
    if (offerPolicy) {
      const m = offerPolicy.match(/(\d+)\s*(?:day|days|d)\b/i);
      if (m && m[1]) return `${m[1]}d`;
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

  function offerRatingMetaHtml(offer){
  const ratingNum = Number(offer?.rating);
  const reviewCountNum = Number(offer?.review_count);

  if (!Number.isFinite(ratingNum) || ratingNum <= 0) return '';
  if (!Number.isFinite(reviewCountNum) || reviewCountNum <= 0) return '';

  const countText = new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(reviewCountNum);

  return `
    <div class="offer-rating-meta" aria-label="${escapeHtml(`${ratingNum.toFixed(1)} stars from ${reviewCountNum} reviews`)}">
      <span class="offer-rating-meta__star" aria-hidden="true">${REVIEW_STAR_SVG}</span>
      <span class="offer-rating-meta__value">${escapeHtml(ratingNum.toFixed(1))}</span>
      <span class="offer-rating-meta__count">(${escapeHtml(countText)})</span>
    </div>
  `;
}

async function renderOffers(sortByPrice, runToken){
  if (runToken != null && isStaleRun(runToken)) return;

  const wrap = $('#offers');
  const note = $('#offersNote');

  if (!wrap || !note) return;

  wrap.innerHTML = '';

  if (!state.offers.length) {
    note.textContent = '';
    return;
  }

  function formatShippingLine(offer, seller){
    const rawCost = offer?.shipping_cost;

    if (rawCost != null && rawCost !== '') {
      const cents = Number(rawCost);

      if (Number.isFinite(cents)) {
        if (cents === 0) return 'Free shipping';
        if (cents > 0) return `+ ${fmt.format(cents / 100)} shipping`;
      }
    }

    const text = String(shippingTextForOffer(offer, seller) || '').trim();
    if (!text) return '';

    if (/^free\b/i.test(text)) return text;
    if (/^\$/.test(text)) return `+ ${text} shipping`;

    return text;
  }

  function returnsPillHtml(offer, seller){
  const text = String(returnsTextForOffer(offer, seller) || '').trim();
  if (!text) return '';

  return `
    <span
      class="offer-meta-pill offer-meta-pill--returns"
      data-tooltip="Return Policy"
      aria-label="Return Policy"
      tabindex="0"
    >
      <span class="offer-meta-pill__icon" aria-hidden="true">${RETURNS_PILL_SVG}</span>
      <span class="offer-meta-pill__text">${escapeHtml(text)}</span>
    </span>
  `;
}

  function sellerRatingPillHtml(seller){
  const raw = seller?.rating;

  if (raw == null || raw === '') return '';

  const num = Number(raw);
  const text =
    Number.isFinite(num) && num > 0
      ? num.toFixed(1)
      : String(raw).trim();

  if (!text) return '';

  return `
    <span
      class="offer-meta-pill offer-meta-pill--store-rating"
      data-tooltip="Google Rating"
      aria-label="Google Rating"
      tabindex="0"
    >
      <span class="offer-meta-pill__text">${escapeHtml(text)}</span>
    </span>
  `;
}

  let arr = state.offers.map((o) => {
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

  wrap.innerHTML = `
    <div class="offer-grid-head" role="presentation">
      <div class="offer-grid-head__cell offer-grid-head__cell--store">Store</div>
      <div class="offer-grid-head__cell">Price</div>
      <div class="offer-grid-head__cell">Delivery</div>
      <div class="offer-grid-head__cell">Rating</div>
    </div>
  `;

  sellerRows.forEach(({ offer: o, seller, hasSeller, sellerHref }) => {
    const bestLink = safeHttpHref(o.url || canonicalLink(o.store, o) || '');
    const storeDisplay = titleCase(seller?.name || o.store || '');
    const hasPrice = o._price != null;
    const priceText = hasPrice ? fmt.format(o._price) : '';
    const deliveryText = String(deliveryTextForOffer(o, seller) || '').trim();
    const shippingText = hasPrice ? formatShippingLine(o, seller) : '';
    const storeReturnsPillHtml = returnsPillHtml(o, seller);
    const storeRatingPill = sellerRatingPillHtml(seller);
    const storeMetaHtml = [storeRatingPill, storeReturnsPillHtml].filter(Boolean).join('');
    const ratingMetaHtml = offerRatingMetaHtml(o);

    const logoHtml = sellerLogoHtml(seller, storeDisplay);

    const logoSlotHtml = logoHtml
      ? (
          hasSeller && sellerHref
            ? `<a class="offer-logo-link" href="${escapeHtml(sellerHref)}" aria-label="Open ${escapeHtml(storeDisplay)} seller page">${logoHtml}</a>`
            : `<span class="offer-logo-link is-static" aria-hidden="true">${logoHtml}</span>`
        )
      : `<span class="offer-logo-spacer" aria-hidden="true"></span>`;

    const row = document.createElement('div');
    row.className = 'offer';

    row.innerHTML = `
      <div class="offer-store-cell" data-label="Store">
        ${logoSlotHtml}

        <div class="offer-store-copy">
          <div class="offer-store-row">
            <span class="offer-store">${escapeHtml(storeDisplay)}</span>
            ${
              bestLink
                ? `<a class="offer-go-inline" href="${escapeHtml(bestLink)}" target="_blank" rel="noopener" aria-label="Go to ${escapeHtml(storeDisplay)}">${OFFER_EXTERNAL_SVG}</a>`
                : ''
            }
          </div>

          ${
            storeMetaHtml
              ? `<div class="offer-store-meta">${storeMetaHtml}</div>`
              : ''
          }
        </div>
      </div>

      <div class="offer-price-col${shippingText ? '' : ' offer-price-col--single'}" data-label="Cost">
        <div class="muted-price offer-price">${priceText ? escapeHtml(priceText) : ''}</div>
        ${
          shippingText
            ? `<div class="offer-cell-sub">${escapeHtml(shippingText)}</div>`
            : ''
        }
      </div>

      <div class="offer-delivery-col" data-label="Delivery">
        <div class="offer-cell-main">${deliveryText ? escapeHtml(deliveryText) : ''}</div>
      </div>

      <div class="offer-rating-col" data-label="Rating">
        ${ratingMetaHtml || ''}
      </div>
    `;

    const wrapper = document.createElement('div');
    wrapper.className = 'offer-wrapper';
    wrapper.appendChild(row);
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

  const available = Math.round(mainRect.bottom - panelRect.top);

  // small trim so the bottoms visually finish on the same line
  return Math.max(0, available - 4);
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
    panel.style.height = '';
    panel.style.maxHeight = '';
    return;
  }

  panel.style.boxSizing = 'border-box';
  panel.style.height = `${availableHeight}px`;
  panel.style.maxHeight = `${availableHeight}px`;
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
    const proto = String(u.protocol || '').toLowerCase();

    if (proto !== 'http:' && proto !== 'https:') return '';

    // Local files stay relative on your own site.
    if (u.origin === location.origin) {
      return `${u.pathname}${u.search}${u.hash}`;
    }

    // Third-party files are allowed as full URLs.
    return u.href;
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
          src="${escapeHtml(item.href)}#view=Fit"
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

  const currentFamilyName =
    normalizeSpaces(currentFamily.model_number || '');

  const currentCategory =
    normalizeSpaces(currentFamily.category || '');

  const currentVersion =
    normalizeSpaces(
      state.selectedVersion ||
      currentFamily.selected_version ||
      currentFamily.products[0]?.version ||
      'Default'
    ) || 'Default';

  function normKey(v){
    return normLower(normalizeSpaces(v));
  }

  function dedupeBy(list, getKey){
    const out = [];
    const seen = new Set();

    for (const item of (Array.isArray(list) ? list : [])) {
      const key = normKey(getKey(item));
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }

    return out;
  }

  function moveSelectedFirst(list, getKey, selectedValue){
    const arr = Array.isArray(list) ? list.slice() : [];
    const selectedKey = normKey(selectedValue);
    if (!selectedKey) return arr;

    const picked = [];
    const rest = [];

    for (const item of arr) {
      if (normKey(getKey(item)) === selectedKey) picked.push(item);
      else rest.push(item);
    }

    return picked.concat(rest);
  }

  function productCountLabel(n){
    const count = Number(n) || 1;
    return `${count} product${count === 1 ? '' : 's'}`;
  }

  function familyCountLabel(n){
    const count = Number(n) || 1;
    return `${count} famil${count === 1 ? 'y' : 'ies'}`;
  }

  function categoryLabel(v){
    const text = normalizeSpaces(v);
    return text || 'Other';
  }

  const currentFallbackKey =
    normalizeKey(currentFamily.products[0]?.key || '') || '';

  const allFamilies = dedupeBy(
    [
      {
        model_number: currentFamily.model_number,
        key: currentFallbackKey,
        category: currentFamily.category || null,
        product_count: currentFamily.products.length
      },
      ...families
    ]
      .map((fam) => {
        const key = normalizeKey(fam?.key || '');
        const modelNumber = normalizeSpaces(fam?.model_number || '');
        if (!key || !modelNumber) return null;

        return {
          model_number: modelNumber,
          key,
          category: normalizeSpaces(fam?.category || ''),
          product_count: Number(fam?.product_count || 0) || 1
        };
      })
      .filter(Boolean),
    (fam) => fam.model_number
  );

  if (!allFamilies.length) {
    lineupCard.hidden = true;
    lineupContent.innerHTML = '';
    state.selectedLineupFamily = null;
    return;
  }

  const categoryCounts = new Map();
  allFamilies.forEach((fam) => {
    const key = normKey(fam.category);
    categoryCounts.set(key, (categoryCounts.get(key) || 0) + 1);
  });

  let categories = dedupeBy(
    allFamilies.map((fam) => ({
      value: normalizeSpaces(fam.category || ''),
      label: categoryLabel(fam.category || '')
    })),
    (item) => item.value
  );

  categories = moveSelectedFirst(categories, (item) => item.value, currentCategory);

  let visibleFamilies = allFamilies.filter(
    (fam) => normKey(fam.category) === normKey(currentCategory)
  );

  if (!visibleFamilies.length) {
    visibleFamilies = allFamilies.slice();
  }

  visibleFamilies = moveSelectedFirst(
    visibleFamilies,
    (fam) => fam.model_number,
    currentFamilyName
  );

  let visibleProducts = Array.isArray(currentFamily.products)
    ? currentFamily.products
        .map((product) => {
          const key = normalizeKey(product?.key || '');
          if (!key) return null;

          return {
            version: normalizeSpaces(product?.version || 'Default') || 'Default',
            key,
            model_name: normalizeSpaces(product?.model_name || '')
          };
        })
        .filter(Boolean)
    : [];

  visibleProducts = moveSelectedFirst(
    visibleProducts,
    (product) => product.version,
    currentVersion
  );

  function buildCategoryButton(item){
    const isActive = normKey(item.value) === normKey(currentCategory);

    const targetFamily =
      allFamilies.find((fam) => normKey(fam.category) === normKey(item.value)) ||
      null;

    const targetKey = normalizeKey(targetFamily?.key || '') || '';
    const targetTitle = normalizeSpaces(targetFamily?.model_number || item.label || 'Product');
    const count = categoryCounts.get(normKey(item.value)) || 1;

    return `
      <button
        type="button"
        class="pc-lineup-chip pc-lineup-chip--category${isActive ? ' is-active' : ''}"
        data-lineup-key="${escapeHtml(targetKey)}"
        data-lineup-title="${escapeHtml(targetTitle)}"
      >
        <div class="pc-lineup-chip__title">${escapeHtml(item.label)}</div>
        <div class="pc-lineup-chip__meta">${escapeHtml(familyCountLabel(count))}</div>
      </button>
    `;
  }

  function buildFamilyButton(fam){
    const isActive = normKey(fam.model_number) === normKey(currentFamilyName);

    return `
      <button
        type="button"
        class="pc-lineup-chip pc-lineup-chip--family${isActive ? ' is-active' : ''}"
        data-lineup-key="${escapeHtml(fam.key)}"
        data-lineup-title="${escapeHtml(fam.model_number)}"
      >
        <div class="pc-lineup-chip__title">${escapeHtml(fam.model_number)}</div>
        <div class="pc-lineup-chip__meta">${escapeHtml(productCountLabel(fam.product_count))}</div>
      </button>
    `;
  }

  function buildProductButton(product){
    const isActive = normKey(product.version) === normKey(currentVersion);
    const productTitle = product.model_name || `${currentFamilyName} ${product.version}`;

    return `
      <button
        type="button"
        class="pc-lineup-chip pc-lineup-chip--product${isActive ? ' is-active' : ''}"
        data-lineup-key="${escapeHtml(product.key)}"
        data-lineup-title="${escapeHtml(productTitle)}"
      >
        <div class="pc-lineup-chip__title">${escapeHtml(product.version)}</div>
        <div class="pc-lineup-chip__meta">${escapeHtml(product.model_name || currentFamilyName)}</div>
      </button>
    `;
  }

  lineupContent.innerHTML = `
    <div class="pc-lineup-stack">
      <section class="pc-lineup-row">
        <div class="pc-lineup-row__label">Categories</div>
        <div class="pc-lineup-chip-row">
          ${categories.map(buildCategoryButton).join('')}
        </div>
      </section>

      <section class="pc-lineup-row">
        <div class="pc-lineup-row__label">Families</div>
        <div class="pc-lineup-chip-row">
          ${visibleFamilies.map(buildFamilyButton).join('')}
        </div>
      </section>

      <section class="pc-lineup-row">
        <div class="pc-lineup-row__label">Products</div>
        <div class="pc-lineup-chip-row">
          ${visibleProducts.map(buildProductButton).join('')}
        </div>
      </section>
    </div>
  `;

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

const DIMENSION_WEIGHT_ICON_PATH = 'M240-200h480-480Zm240-480q17 0 28.5-11.5T520-720q0-17-11.5-28.5T480-760q-17 0-28.5 11.5T440-720q0 17 11.5 28.5T480-680Zm113 0h70q30 0 52 20t27 49l57 400q5 36-18.5 63.5T720-120H240q-37 0-60.5-27.5T161-211l57-400q5-29 27-49t52-20h70q-3-10-5-19.5t-2-20.5q0-50 35-85t85-35q50 0 85 35t35 85q0 11-2 20.5t-5 19.5ZM240-200h480Z';

function dimNum(v){
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

function dimText(n){
  if (!Number.isFinite(n)) return '';
  const rounded = Math.round(n * 100) / 100;
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

  const xLabel = formatAxisUnit(xIn, unit);
  const yLabel = formatAxisUnit(yIn, unit);
  const zLabel = zIn != null ? formatAxisUnit(zIn, unit) : '';

  const zGuideGap = 24;
  const zGuideDrop = Math.max(40, Math.min(70, frontH * 0.58));
  const zGuideX1 = right + zGuideGap;
  const zGuideY1 = top + zGuideDrop + 5;
  const zGuideX2 = zGuideX1 + dx;
  const zGuideY2 = zGuideY1 + dy;

  return `
    <svg class="dim-visual" viewBox="0 0 ${svgW} ${svgH}" role="img" aria-label="Proportional dimensions diagram">
      <title>Proportional dimensions diagram</title>

      <polygon
        points="${left},${top} ${right},${top} ${right + dx},${top + dy} ${left + dx},${top + dy}"
        fill="#eef2ff"
        stroke="#94a3b8"
        stroke-width="1.5"
      ></polygon>

      <polygon
        points="${right},${top} ${right},${bottom} ${right + dx},${bottom + dy} ${right + dx},${top + dy}"
        fill="#e2e8f0"
        stroke="#94a3b8"
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
              stroke="#d97706"
              stroke-width="2"
            ></line>

            <line
              x1="${zGuideX1 - 6}"
              y1="${zGuideY1}"
              x2="${zGuideX1 + 6}"
              y2="${zGuideY1}"
              stroke="#d97706"
              stroke-width="2"
            ></line>

            <line
              x1="${zGuideX2 - 6}"
              y1="${zGuideY2}"
              x2="${zGuideX2 + 6}"
              y2="${zGuideY2}"
              stroke="#d97706"
              stroke-width="2"
            ></line>

            <text
              x="${zGuideX2 - 13}"
              y="${zGuideY2 + 27.32}"
              font-size="14"
              font-weight="700"
              fill="#d97706"
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

  if (d.screenIn != null) {
    stats.push(renderDimStat('Screen', formatLengthUnit(d.screenIn, unit)));
  }

  if (d.heightIn != null && (zIn == null || Math.abs(d.heightIn - zIn) > 0.001)) {
    stats.push(renderDimStat('Height', formatLengthUnit(d.heightIn, unit)));
  }

  if (d.depthIn != null && (zIn == null || Math.abs(d.depthIn - zIn) > 0.001)) {
    stats.push(renderDimStat('Depth', formatLengthUnit(d.depthIn, unit)));
  }

  const weightMarkup = d.weightLb != null
    ? `
      <div class="dim-weight-badge" aria-label="Product weight">
        <span class="dim-weight-badge__icon" aria-hidden="true">
          <svg viewBox="0 -960 960 960" focusable="false">
            <path d="${escapeHtml(DIMENSION_WEIGHT_ICON_PATH)}"></path>
          </svg>
        </span>
        <span class="dim-weight-badge__text">${escapeHtml(formatWeightUnit(d.weightLb, unit))}</span>
      </div>
    `
    : '';

  if (!visual && !stats.length && !weightMarkup) return '';

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
                ${weightMarkup}
              </div>
            `
            : ''
        }

        ${
          !visual && weightMarkup
            ? `
              <div class="dim-weight-row">
                ${weightMarkup}
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