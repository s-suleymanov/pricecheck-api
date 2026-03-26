// public/browse/browse.js
(() => {
  // ----------------------------
  // Tiny helpers
  // ----------------------------
  const $ = (s, root = document) => root.querySelector(s);
  const norm = (s) => String(s ?? "").trim();
  const normLower = (s) => String(s ?? "").trim().toLowerCase();

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function aboutHtmlFull(about) {
    if (!about || typeof about !== "object") return "";

    const paragraphs = Array.isArray(about.paragraphs) ? about.paragraphs : [];

    const paraHtml = paragraphs
      .map((p) => String(p || "").trim())
      .filter(Boolean)
      .map((p) => `<p>${escapeHtml(p)}</p>`)
      .join("");

    if (!paraHtml) return "";

    return `
      <div class="detail-about">
        <div class="side-label">About</div>
        <div class="detail-about-paragraphs">${paraHtml}</div>
      </div>
    `;
  }

  function safeHref(raw, { sameOrigin = false } = {}) {
  const s = String(raw ?? "").trim();
  if (!s) return "";

  try {
    // Base relative URLs on current origin
    const u = new URL(s, location.origin);

    // Block dangerous schemes (javascript:, data:, file:, etc.)
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";

    // If we require same-origin, enforce it and return a relative path
    if (sameOrigin) {
      if (u.origin !== location.origin) return "";
      return `${u.pathname}${u.search}${u.hash}`;
    }

    return u.href;
  } catch (_e) {
    return "";
  }
}

  function slugify(s) {
    return String(s ?? "")
      .trim()
      .toLowerCase()
      .replace(/['"]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function clampInt(v, lo, hi, fallback) {
    const n = Number.parseInt(String(v ?? ""), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(lo, Math.min(hi, n));
  }

  function fmtPrice(cents) {
    if (typeof cents !== "number") return "";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
  }

  function isBrowseRailSignedIn() {
    try {
      const raw = localStorage.getItem("pc_auth_user");
      if (!raw) return false;

      const user = JSON.parse(raw);
      return !!String(user?.email || "").trim();
    } catch (_e) {
      return false;
    }
  }

  const BROWSE_RAIL_FIXED_TABS = [
    { key: "stores",   label: "Stores",   pathData: "M841-518v318q0 33-23.5 56.5T761-120H201q-33 0-56.5-23.5T121-200v-318q-23-21-35.5-54t-.5-72l42-136q8-26 28.5-43t47.5-17h556q27 0 47 16.5t29 43.5l42 136q12 39-.5 71T841-518Zm-272-42q27 0 41-18.5t11-41.5l-22-140h-78v148q0 21 14 36.5t34 15.5Zm-180 0q23 0 37.5-15.5T441-612v-148h-78l-22 140q-4 24 10.5 42t37.5 18Zm-178 0q18 0 31.5-13t16.5-33l22-154h-78l-40 134q-6 20 6.5 43t41.5 23Zm540 0q29 0 42-23t6-43l-42-134h-76l22 154q3 20 16.5 33t31.5 13ZM201-200h560v-282q-5 2-6.5 2H751q-27 0-47.5-9T663-518q-18 18-41 28t-49 10q-27 0-50.5-10T481-518q-17 18-39.5 28T393-480q-29 0-52.5-10T299-518q-21 21-41.5 29.5T211-480h-4.5q-2.5 0-5.5-2v282Zm560 0H201h560Z",   active: true  },
    { key: "intel",    label: "Intel",    pathData: "M324-111.5Q251-143 197-197t-85.5-127Q80-397 80-480t31.5-156Q143-709 197-763t127-85.5Q397-880 480-880t156 31.5Q709-817 763-763t85.5 127Q880-563 880-480t-31.5 156Q817-251 763-197t-127 85.5Q563-80 480-80t-156-31.5ZM480-160q56 0 105.5-17.5T676-227l-57-57q-29 21-64.5 32.5T480-240q-100 0-170-70t-70-170q0-100 70-170t170-70q100 0 170 70t70 170q0 39-12 75t-33 65l57 57q32-41 50-91t18-106q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-160q22 0 42.5-5.5T561-342l-61-61q-5 2-10 2.5t-10 .5q-33 0-56.5-23.5T400-480q0-33 23.5-56.5T480-560q33 0 56.5 23.5T560-480q0 6-.5 11.5T557-458l60 60q11-18 17-38.5t6-43.5q0-66-47-113t-113-47q-66 0-113 47t-47 113q0 66 47 113t113 47Z",    active: false },
    { key: "specs",    label: "Specs",    pathData: "M440-120v-240h80v80h320v80H520v80h-80Zm-320-80v-80h240v80H120Zm160-160v-80H120v-80h160v-80h80v240h-80Zm160-80v-80h400v80H440Zm160-160v-240h80v80h160v80H680v80h-80Zm-480-80v-80h400v80H120Z",    active: false },
    { key: "history",  label: "History",  pathData: "M120-240q-33 0-56.5-23.5T40-320q0-33 23.5-56.5T120-400h10.5q4.5 0 9.5 2l182-182q-2-5-2-9.5V-600q0-33 23.5-56.5T400-680q33 0 56.5 23.5T480-600q0 2-2 20l102 102q5-2 9.5-2h21q4.5 0 9.5 2l142-142q-2-5-2-9.5V-640q0-33 23.5-56.5T840-720q33 0 56.5 23.5T920-640q0 33-23.5 56.5T840-560h-10.5q-4.5 0-9.5-2L678-420q2 5 2 9.5v10.5q0 33-23.5 56.5T600-320q-33 0-56.5-23.5T520-400v-10.5q0-4.5 2-9.5L420-522q-5 2-9.5 2H400q-2 0-20-2L198-340q2 5 2 9.5v10.5q0 33-23.5 56.5T120-240Z",  active: false },
    { key: "media",    label: "Media",    pathData: "m380-300 280-180-280-180v360ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z",    active: false }
  ];

  const BROWSE_RAIL_ARROW_SVG = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <polyline points="9 6 15 12 9 18"></polyline>
    </svg>
  `;

  function createBrowseRailIconMarkup(pathData) {
    const d = String(pathData || "").trim();
    if (!d) return '<span class="browse-rail__placeholder"></span>';

    return `
      <svg viewBox="0 -960 960 960" aria-hidden="true" focusable="false">
        <path d="${escapeHtml(d)}"></path>
      </svg>
    `;
  }

  function stepBrowsePage(delta) {
    if (state.loading) return;

    const pages = Number.isFinite(state.pages) ? state.pages : 1;
    const nextPage = Math.max(1, Math.min(pages, state.page + delta));

    if (nextPage === state.page) return;

    state.page = nextPage;
    state.animateNextRender = false;
    startPageTransitionUI();

    writeUrl({ replace: false });
    load();
  }

  function renderBrowseRail() {
    const rail = document.getElementById("browseRail");
    if (!rail) return;

    const pages = Number.isFinite(state.pages) ? state.pages : 1;
    const showPrev = state.page > 1;
    const showNext = state.page < pages;

    rail.hidden = false;
rail.innerHTML = `
  <div class="browse-rail__inner">
    <div class="browse-rail__main">
      <div class="browse-rail__tabs">
        ${BROWSE_RAIL_FIXED_TABS.map((tab) => `
          <button
            type="button"
            class="browse-rail__btn${tab.active ? " is-active" : ""}"
            data-browse-rail-tab="${escapeHtml(tab.key)}"
            aria-label="${escapeHtml(tab.label)}"
            title="${escapeHtml(tab.label)}"
            ${tab.active ? 'aria-current="page"' : ""}
          >
            ${createBrowseRailIconMarkup(tab.pathData)}
          </button>
        `).join("")}
      </div>
    </div>

    <div class="browse-rail__pager">
      ${showPrev ? `
        <button
          type="button"
          class="browse-rail__btn browse-rail__arrow browse-rail__arrow--prev"
          id="browseRailPrevBtn"
          aria-label="Previous page"
          title="Previous page"
          ${state.loading ? "disabled" : ""}
        >
          ${BROWSE_RAIL_ARROW_SVG}
        </button>
      ` : ""}

      ${showNext ? `
        <button
          type="button"
          class="browse-rail__btn browse-rail__arrow"
          id="browseRailNextBtn"
          aria-label="Next page"
          title="Next page"
          ${state.loading ? "disabled" : ""}
        >
          ${BROWSE_RAIL_ARROW_SVG}
        </button>
      ` : ""}
    </div>
  </div>
`;

    rail.querySelector("#browseRailPrevBtn")?.addEventListener("click", () => {
      stepBrowsePage(-1);
    });

    rail.querySelector("#browseRailNextBtn")?.addEventListener("click", () => {
      stepBrowsePage(1);
    });

    rail.querySelectorAll("[data-browse-rail-tab]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const key = String(btn.getAttribute("data-browse-rail-tab") || "").trim().toLowerCase();

        // Prices is the current browse page, so do nothing
        if (key === "prices") return;

        e.preventDefault();
        e.stopPropagation();

        // Show quick sign in for gated tabs when signed out
        if (!isBrowseRailSignedIn()) {
          if (typeof window.pcOpenSignIn === "function") {
            window.pcOpenSignIn();
          }
          return;
        }

        // Signed in but not built yet: do nothing for now
      });
    });
  }

  // ----------------------------
  // DOM refs (cached once)
  // ----------------------------
  const els = {
    meta: null,
    grid: null,
    empty: null,
    emptyInline: null,
    prev: null,
    next: null,
    pager: null,
    sidecol: null,
    categoryPanel: null,
    brandPanel: null,
    familyPanel: null,
  };

  function cacheEls() {
    els.meta = $("#meta");
    els.grid = $("#grid");
    els.empty = $("#empty");
    els.emptyInline = $("#emptyInline");
    els.prev = $("#prev");
    els.next = $("#next");
    els.pager = document.querySelector(".pager");
    els.sidecol = $("#sidecol");
    els.categoryPanel = $("#categoryPanel");
    els.brandPanel = $("#brandPanel");
    els.familyPanel = $("#familyPanel");
  }

  // ----------------------------
  // State
  // ----------------------------
const state = {
    q: "",
    page: 1,
    limit: 36,
    sort: "recommended",

    // main filters (URL)
    brand: "",
    category: "",
    family: "",
    familyNorm: "",
    variant: "",
    variantNorm: "",
    color: "",
    colorNorm: "",

    condition: "new",      // "new" | "refurbished" | "bundle"
    hasRefurbished: false,
    hasBundle: false,

    // sidebar cached facets
    sideCats: [],
    sideFams: [],
    sideFacetKey: "",

    sideBrands: [],
    sideBrandsFacetKey: "",

    familyPanelKey: "",
    familyVariants: [],
    familyColors: [],

    // seller icon
    sellerSlug: "",
    hasSeller: false,
    sellerKey: "",
    sellerLogoUrl: "",

    // result payload
    kind: "product",
    value: "",
    total: 0,
    pages: 1,
    results: [],
    also: [],
    didYouMean: null,

    // request / ui
    loading: false,
    lastReqId: 0,
    lastError: "",
    animateNextRender: true,

    // Detail sidebar (expanded product view)
    detailSelectedVariantLabel: "",
    detailSelectedColorName: "",

    detailOpen: false,
    detailDashKey: "",
    detailTitle: "",
    detailBrand: "",
    detailImg: "",
    detailLoading: false,
    detailError: "",
    detailData: null,
    detailSourceCardEl: null,
    detailBookmarked: false,
    detailBookmarkKnown: false,
    detailBookmarkBusy: false,
  };

  // ----------------------------
  // Small DOM setters
  // ----------------------------
  function setText(el, txt) {
    if (el) el.textContent = txt ?? "";
  }

  function setMeta(txt) {
    setText(els.meta, txt || "");
  }

  function setInlineEmptyHtml(html) {
    if (els.emptyInline) els.emptyInline.innerHTML = html || "";
  }

  function showInlineEmpty(show) {
    if (els.emptyInline) els.emptyInline.hidden = !show;
  }

  function showEmpty(show) {
    if (els.empty) els.empty.hidden = !show;
  }

  // ----------------------------
  // URL parsing + building
  // ----------------------------
  function parseBrowsePath(pathname) {
    const clean = String(pathname || "/").replace(/\/+$/g, "/");
    const parts = clean.split("/").filter(Boolean);
    if (parts[0] !== "browse") return { q: "", page: 1, brand: "", category: "", family: "", variant: "", color: "" };

    let q = "";
    let brand = "";
    let category = "";
    let family = "";
    let variant = "";
    let color = "";
    let page = 1;

    let end = parts.length;
    if (parts.length >= 4 && parts[parts.length - 2] === "page") {
      const n = parseInt(parts[parts.length - 1], 10);
      if (Number.isFinite(n) && n > 0) page = n;
      end = parts.length - 2;
    }

    const core = parts.slice(1, end);

    // /browse/category/<Category>/
    if (core.length >= 2 && core[0] === "category") {
      const cat = decodeURIComponent(core[1] || "");
      category = norm(cat);
      q = category;
      return { q, page, brand: "", category, family: "", variant: "", color: "" };
    }

    if (core.length === 0) {
      return { q: "", page, brand: "", category: "", family: "", variant: "", color: "" };
    }

    const first = decodeURIComponent(core[0] || "");
    q = norm(first);

    for (let i = 1; i < core.length; i += 2) {
      const key = core[i];
      const val = core[i + 1] != null ? decodeURIComponent(core[i + 1]) : "";
      if (key === "category") category = norm(val);
      if (key === "family") family = norm(val);
      if (key === "variant") variant = norm(val);
      if (key === "color") color = norm(val);
    }

    if (category || family || variant || color) {
      brand = q;
    }

    return { q, page, brand, category, family, variant, color };
  }

  function buildBrowsePath({ q, page, brand, category, family, variant, color }) {
    const p = Number.isFinite(page) && page > 0 ? page : 1;

    if (brand) {
      let path = `/browse/${encodeURIComponent(brand)}/`;
      if (category) path += `category/${encodeURIComponent(category)}/`;
      if (family) path += `family/${encodeURIComponent(family)}/`;
      if (variant) path += `variant/${encodeURIComponent(variant)}/`;
      if (color) path += `color/${encodeURIComponent(color)}/`;
      if (p > 1) path += `page/${p}/`;
      return path;
    }

    if (category) {
      let path = `/browse/category/${encodeURIComponent(category)}/`;
      if (p > 1) path += `page/${p}/`;
      return path;
    }

    const qq = norm(q);
    if (!qq) return "/browse/";

    const slug = encodeURIComponent(slugify(qq));
    let path = `/browse/${slug}/`;
    if (p > 1) path += `page/${p}/`;
    return path;
  }

  function writeUrl({ replace = false } = {}) {
    const path = buildBrowsePath({
      q: state.q, page: state.page,
      brand: state.brand, category: state.category,
      family: state.family, variant: state.variant, color: state.color,
    });

    const sp = new URLSearchParams();

    if (state.condition && state.condition !== "new") sp.set("condition", state.condition);

    if (state.sort && state.sort !== "recommended") sp.set("sort", state.sort);

    const qs = sp.toString();
    const url = qs ? `${path}?${qs}` : path;

    if (replace) history.replaceState({}, "", url);
    else history.pushState({}, "", url);
  }

  function readUrl() {
    // Back-compat: old query string format
    const sp = new URLSearchParams(location.search);
    const oldBrand = norm(sp.get("brand") || "");
    const oldCategory = norm(sp.get("category") || "");
    const oldFamily = norm(sp.get("family") || "");
    const oldPage = parseInt(sp.get("page") || "1", 10);
    const oldPageNum = Number.isFinite(oldPage) && oldPage > 0 ? oldPage : 1;

    if (oldBrand || oldCategory || oldFamily) {
      state.brand = oldBrand;
      state.category = oldCategory;
      state.family = oldFamily;
      state.familyNorm = oldFamily.toLowerCase();
      state.q = oldBrand || oldCategory || "";
      state.page = oldPageNum;

      state.variant = "";
      state.variantNorm = "";
      state.color = "";
      state.colorNorm = "";

      writeUrl({ replace: true });
      return;
    }

    const parsed = parseBrowsePath(location.pathname);

    state.page = parsed.page;

    state.brand = norm(parsed.brand);
    state.category = norm(parsed.category);
    state.family = norm(parsed.family);
    state.familyNorm = state.family.toLowerCase();

    state.variant = norm(parsed.variant);
    state.variantNorm = state.variant.toLowerCase();

    state.color = norm(parsed.color);
    state.colorNorm = state.color.toLowerCase();

    const pathQ = norm(parsed.q);

    // plain /browse/<slug>/ mode: de-slugify, but prefer persisted typed value
    if (!state.brand && !state.category && !state.family) {
      let saved = "";
      try {
        saved = sessionStorage.getItem("pc_browse_search_value") || "";
      } catch (_e) {}

      const savedNorm = norm(saved);
      const looksSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(pathQ);

      if (savedNorm && slugify(savedNorm) === slugify(pathQ)) {
        state.q = savedNorm;
      } else if (looksSlug) {
        state.q = pathQ.replace(/-/g, " ").trim();
      } else {
        state.q = pathQ;
      }
    } else {
      state.q = pathQ;
    }

    const _sp = new URLSearchParams(location.search);
    const _cond = _sp.get("condition");
    state.condition = (_cond === "refurbished" || _cond === "bundle") ? _cond : "new";
    const _sort = String(_sp.get("sort") || "").trim().toLowerCase();
    state.sort =
      _sort === "lowest-price" ||
      _sort === "highest-price" ||
      _sort === "az"
        ? _sort
        : "recommended";
  }

  // ----------------------------
  // Head tags
  // ----------------------------
  function setHead({ title, description, canonical, robots } = {}) {
    if (title) document.title = title;

    if (description != null) {
      let el = document.querySelector('meta[name="description"]');
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute("name", "description");
        document.head.appendChild(el);
      }
      el.setAttribute("content", description);
    }

    if (canonical) {
      let link = document.querySelector('link[rel="canonical"]');
      if (!link) {
        link = document.createElement("link");
        link.setAttribute("rel", "canonical");
        document.head.appendChild(link);
      }
      link.setAttribute("href", canonical);
    }

    if (robots != null) {
      let el = document.querySelector('meta[name="robots"]');
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute("name", "robots");
        document.head.appendChild(el);
      }
      el.setAttribute("content", robots);
    }
  }

  // ----------------------------
  // Pager
  // ----------------------------
   function setPager() {
    const pages = Number.isFinite(state.pages) ? state.pages : 1;
    const shouldShow = pages > 1;

    if (els.pager) els.pager.style.display = shouldShow ? "flex" : "none";
    if (els.prev) els.prev.disabled = !shouldShow || state.loading || state.page <= 1;
    if (els.next) els.next.disabled = !shouldShow || state.loading || state.page >= pages;

    renderBrowseRail();
  }

  function setLoading(on) {
    state.loading = !!on;
    setPager();
  }

  function hardScrollTop() {
    try {
      document.documentElement.style.scrollBehavior = "auto";
      document.body.style.scrollBehavior = "auto";
    } catch (_e) {}
    window.scrollTo(0, 0);
    try {
      document.documentElement.style.scrollBehavior = "";
      document.body.style.scrollBehavior = "";
    } catch (_e) {}
  }

  function startPageTransitionUI() {
    if (els.grid) {
      els.grid.innerHTML = "";
      els.grid.style.removeProperty("--pc-delay");
    }
    showInlineEmpty(false);
    showEmpty(false);
    setMeta("");
    setLoading(true);
    hardScrollTop();
  }

  // ----------------------------
  // API (abortable)
  // ----------------------------
  let _activeLoadController = null;

  async function apiJson(url, { signal } = {}) {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);

    let data = null;
    try {
      data = await res.json();
    } catch (_e) {
      throw new Error(`Bad JSON from ${url}`);
    }

    if (!data || data.ok !== true) {
      const msg = data && (data.error || data.message) ? String(data.error || data.message) : "API ok:false";
      throw new Error(`${msg} (${url})`);
    }

    return data;
  }

  // ----------------------------
  // Dashboard path builder (same logic you had)
  // ----------------------------
  function dashPathFromKeyAndTitle(key, title) {
    const k = String(key || "").trim();
    if (!k) return "/dashboard/";

    const i = k.indexOf(":");
    if (i === -1) return "/dashboard/";

    const kind = k.slice(0, i).toLowerCase();
    const value = k.slice(i + 1).trim();
    if (!kind || !value) return "/dashboard/";

    const slug = slugify(title || "product");
    return `/dashboard/${slug}/${kind}/${encodeURIComponent(value)}/`;
  }

  // ----------------------------
  // Cards
  // ----------------------------
  function cardProduct(r) {
    const dashKey = String(r.dashboard_key || "").trim();
    const displayName = r.model_name || r.title || r.model_number || "Untitled";

    const img = r.image_url
      ? `<img class="img" src="${escapeHtml(r.image_url)}" alt="">`
      : `<div class="img ph"></div>`;

    const warn = r.dropship_warning ? `<span class="warn">Dropshipping risk</span>` : "";
    const refurbBadge = r.is_refurbished ? `<span class="card-badge card-badge--refurb"><svg viewBox="0 -960 960 960" width="13" height="13" aria-hidden="true" style="vertical-align:-1px;fill:currentColor"><path d="M204-318q-22-38-33-78t-11-82q0-134 93-228t227-94h7l-64-64 56-56 160 160-160 160-56-56 64-64h-7q-100 0-170 70.5T240-478q0 26 6 51t18 49l-60 60ZM481-40 321-200l160-160 56 56-64 64h7q100 0 170-70.5T720-482q0-26-6-51t-18-49l60-60q22 38 33 78t11 82q0 134-93 228t-227 94h-7l64 64-56 56Z"/></svg> Refurb</span>` : "";
    const bundleBadge = r.is_bundle ? `<span class="card-badge card-badge--bundle"><svg viewBox="0 -960 960 960" width="13" height="13" aria-hidden="true" style="vertical-align:-1px;fill:currentColor"><path d="M240-400v80h-80q-33 0-56.5-23.5T80-400v-400q0-33 23.5-56.5T160-880h400q33 0 56.5 23.5T640-800v80h-80v-80H160v400h80ZM400-80q-33 0-56.5-23.5T320-160v-400q0-33 23.5-56.5T400-640h400q33 0 56.5 23.5T880-560v400q0 33-23.5 56.5T800-80H400Zm0-80h400v-400H400v400Zm200-200Z"/></svg> Bundle</span>` : "";

    const brand = (r.brand || "").trim();
    const brandLine = brand ? brand : "";

        let aboutText = "";

    if (r.about && typeof r.about === "object") {
      const paragraphs = Array.isArray(r.about.paragraphs) ? r.about.paragraphs : [];
      const bullets = Array.isArray(r.about.bullets) ? r.about.bullets : [];

      aboutText =
        String(paragraphs.find(Boolean) || bullets.find(Boolean) || "").trim();
    }

    const hasAbout = !!aboutText;

    const aboutHtml = hasAbout
      ? `<div class="about-snippet">${escapeHtml(aboutText)}</div>`
      : "";

    const inner = `
      <div class="thumb">${img}</div>
      <div class="body">
        <div class="subtitle">${escapeHtml(brandLine)}</div>
        <div class="name ${hasAbout ? "name--with-about" : "name--no-about"}">${escapeHtml(displayName)}</div>
        ${aboutHtml}
        <div class="card-variants" data-card-variants="1"></div>
        <div class="price-row">
          <div class="price">${fmtPrice(r.best_price_cents)}</div>
          <div class="store-stack" data-store-stack="1"></div>
          ${warn}${refurbBadge}${bundleBadge}
        </div>
      </div>
    `;

    // No valid dashboard key: render a non-clickable card instead of a dead /dashboard/ link
    if (!dashKey) {
      return `
        <div class="card item is-disabled"
          aria-disabled="true"
          data-title="${escapeHtml(displayName)}"
          data-brand="${escapeHtml(brandLine)}"
          data-img="${escapeHtml(String(r.image_url || ""))}">
          ${inner}
        </div>
      `;
    }

    const href = dashPathFromKeyAndTitle(dashKey, displayName);

    return `
      <a class="card item"
        href="${escapeHtml(href)}"
        data-dash-key="${escapeHtml(dashKey)}"
        data-title="${escapeHtml(displayName)}"
        data-brand="${escapeHtml(brandLine)}"
        data-img="${escapeHtml(String(r.image_url || ""))}">
        ${inner}
      </a>
    `;
  }

  function cardFacet(f) {
    const img = f.image_url
      ? `<img class="img" src="${escapeHtml(f.image_url)}" alt="">`
      : `<div class="img ph"></div>`;

    const value = String(f.value || "");
    const products = typeof f.products === "number" ? f.products : 0;

    return `
      <button type="button"
        class="card item"
        data-nav-kind="${escapeHtml(f.kind)}"
        data-nav-value="${escapeHtml(value)}">
        ${img}
        <div class="body">
          <div class="subtitle"></div>
          <div class="name">${escapeHtml(value)}</div>
          <div class="row2">
            <div class="muted">${products} products</div>
          </div>
        </div>
      </button>
    `;
  }

  function animateGridCards(gridEl, { animate = true } = {}) {
    if (!gridEl) return;

    const cards = Array.from(gridEl.querySelectorAll(".card.item"));
    if (!cards.length) return;

    if (!animate) {
      for (const el of cards) {
        el.classList.remove("pc-enter");
        el.classList.remove("pc-enter-active");
        el.style.removeProperty("--pc-delay");
      }
      return;
    }

    for (let i = 0; i < cards.length; i++) {
      const el = cards[i];
      el.classList.remove("pc-enter-active");
      el.classList.add("pc-enter");
      const delay = Math.min(i * 28, 650);
      el.style.setProperty("--pc-delay", `${delay}ms`);
    }

    gridEl.getBoundingClientRect();

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        for (const el of cards) el.classList.add("pc-enter-active");
      });
    });
  }

  // ----------------------------
  // Variants + Colors (cards + detail)
  // ----------------------------
  const _compareCache = new Map(); // key -> Promise(data)

  function versionOfVariant(v) {
    return String(v?.version || "").trim();
  }

  function variantOnly(v) {
    return String(v?.variant || "").trim();
  }

  function groupOfVariant(v) {
    // model_number is your true family grouping
    return normLower(v?.model_number || v?.modelNumber || v?.family || "");
  }

  function colorOfVariant(v) {
    return String(v?.color || v?.color_label || v?.colorway || "").trim();
  }

  function variantKeyOf(v) {
  // Force the most specific key for selection:
  // UPC -> ASIN -> PCI -> existing key.
  const upc = normUpcLoose(v?.upc || v?.UPC || "");
  if (upc) return `upc:${upc}`;

  const asin = String(v?.asin || v?.ASIN || "").trim();
  if (asin) return `asin:${asin}`;

  const pci = String(v?.pci || v?.PCI || "").trim();
  if (pci) return `pci:${pci}`;

  return String(v?.key || "").trim();
}

  function findByKey(variants, key) {
  const list = Array.isArray(variants) ? variants : [];
  const raw = String(key || "").trim();
  if (!raw) return null;

  const k = normLower(raw);
  const { kind, value } = parseDashKey(raw);

  // 1) Exact match against any known key representation
  for (const v of list) {
    const vk = normLower(v?.key || "");
    const ek = normLower(variantKeyOf(v));
    if (vk && vk === k) return v;
    if (ek && ek === k) return v;
  }

  // 2) Identifier match (this is the critical part)
  if (kind === "upc") {
    const want = normUpcLoose(value);
    if (!want) return null;
    return list.find((v) => normUpcLoose(v?.upc || v?.UPC || "") === want) || null;
  }

  if (kind === "asin") {
    const want = normLower(value);
    if (!want) return null;
    return list.find((v) => normLower(v?.asin || v?.ASIN || "") === want) || null;
  }

  if (kind === "pci") {
    const want = normLower(value);
    if (!want) return null;
    return list.find((v) => normLower(v?.pci || v?.PCI || "") === want) || null;
  }

  return null;
}

  function isMeaningfulVariantLabel(lbl, curVer) {
    const raw = String(lbl || "").trim();
    if (!raw) return false;
    if (/^\d+$/.test(raw)) return false;
    if (raw.includes("•")) return false;

    const v = String(curVer || "").trim();
    if (v && raw.toLowerCase() === v.toLowerCase()) return false;

    const s = raw.toLowerCase();
    if (s === "default" || s === "standard" || s === "regular" || s === "base") return false;

    return true;
  }

  // backward compat name
  function isRealVariantLabel(lbl, curVer) {
    return isMeaningfulVariantLabel(lbl, curVer);
  }

  function uniqKeepFirstCase(arr) {
    const seen = new Set();
    const out = [];
    for (const x of arr || []) {
      const s = String(x ?? "").trim();
      if (!s) continue;
      const k = s.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
    return out;
  }

  function scopedByGroupAndVersion(variants, baseKey) {
    const cur = findByKey(variants, baseKey);
    if (!cur) return [];
    const g = groupOfVariant(cur);
    const v = normLower(versionOfVariant(cur));
    return (variants || []).filter((x) => {
      if (g && groupOfVariant(x) !== g) return false;
      if (v && normLower(versionOfVariant(x)) !== v) return false;
      return true;
    });
  }

    // ----------------------------
  // Variant label sorting (capacity-aware)
  // ----------------------------
  const _labelCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

  function capacityGbFromLabel(lbl) {
    const s = String(lbl || "").trim();
    if (!s) return null;

    // Match first capacity-like token: "256GB", "1 TB", "0.5TB", etc.
    const m = s.match(/(\d+(?:\.\d+)?)\s*(tb|gb|mb|kb)\b/i);
    if (!m) return null;

    const num = Number(m[1]);
    if (!Number.isFinite(num)) return null;

    const unit = String(m[2] || "").toLowerCase();

    // Compare in GB units (only relative ordering matters)
    const mult =
      unit === "tb" ? 1024 :
      unit === "gb" ? 1 :
      unit === "mb" ? 1 / 1024 :
      unit === "kb" ? 1 / (1024 * 1024) :
      null;

    if (mult == null) return null;
    return num * mult;
  }

  function sortVariantOptions(options) {
    const arr = (Array.isArray(options) ? options : []).map((o, i) => ({ ...o, _i: i }));

    arr.sort((a, b) => {
      const ag = capacityGbFromLabel(a.label);
      const bg = capacityGbFromLabel(b.label);

      // If both look like capacities, sort ascending: 256GB < 512GB < 1TB
      if (ag != null && bg != null) {
        if (ag < bg) return -1;
        if (ag > bg) return 1;
        return a._i - b._i;
      }

      // If only one is a capacity, put capacities first
      if (ag != null && bg == null) return -1;
      if (ag == null && bg != null) return 1;

      // Fallback: natural sort ("8GB" < "16GB", "10 core" > "8 core")
      const c = _labelCollator.compare(String(a.label || ""), String(b.label || ""));
      if (c) return c;

      // Stable tie-breaker
      return a._i - b._i;
    });

    return arr.map(({ _i, ...rest }) => rest);
  }

  function variantOptionsForSelectedKey(variants, selectedKey, contextTitle) {
  const list = Array.isArray(variants) ? variants : [];
  if (!list.length) return { options: [], activeVariant: "", curKey: "" };

  const cur = findByKey(list, selectedKey);
  if (!cur) return { options: [], activeVariant: "", curKey: "" };

  const curKey = variantKeyOf(cur);
  const curVer = versionOfVariant(cur);
  const curGroup = groupOfVariant(cur);

  let scoped = curGroup ? list.filter((v) => groupOfVariant(v) === curGroup) : list.slice();

  if (curVer) {
    const vNorm = normLower(curVer);
    scoped = scoped.filter((v) => normLower(versionOfVariant(v)) === vNorm);
  }

  const curLblRaw = variantOnly(cur);
  const curLblIsReal = isRealVariantLabel(curLblRaw, curVer, contextTitle);
  const curLblNorm = curLblIsReal ? normLower(curLblRaw) : "";

  // Build unique label -> key options.
  // Critical: if the current selected key belongs to a label, force that label's key to be curKey
  // so active highlighting is always key-true.
  const map = new Map(); // lowerLabel -> { label, key }

  for (const v of scoped) {
    const lbl = variantOnly(v);
    const key = variantKeyOf(v);
    if (!key) continue;

    if (!isRealVariantLabel(lbl, curVer, contextTitle)) continue;

    const lk = normLower(lbl);

    // If this label is the current label, always set its key to curKey.
    if (curLblNorm && lk === curLblNorm) {
      map.set(lk, { label: lbl, key: curKey });
      continue;
    }

    // Otherwise first key wins for that label.
    if (!map.has(lk)) map.set(lk, { label: lbl, key });
  }

  const options = sortVariantOptions(Array.from(map.values()));
  if (options.length < 2) return { options: [], activeVariant: "", curKey };

  // Do not guess the active label if the current row does not have a real label.
  const activeVariant = curLblIsReal ? curLblRaw : "";

  return { options, activeVariant, curKey };
}

  function pickKeyForLabelAndColor(variants, baseKey, label, colorName) {
    const list = Array.isArray(variants) ? variants : [];
    if (!list.length) return null;

    let scoped = scopedByGroupAndVersion(list, baseKey);
    if (!scoped.length) return null;

    const wantL = normLower(label);
    const wantC = normLower(colorName);

    if (wantL) scoped = scoped.filter((v) => normLower(variantOnly(v)) === wantL);

    if (wantC) {
      const hit = scoped.find((v) => {
        if (normLower(colorOfVariant(v)) !== wantC) return false;
        return !!variantKeyOf(v);
      });
      if (hit) return variantKeyOf(hit);
    }

    // fallback to first scoped row that can produce a key
    for (const v of scoped) {
      const k = variantKeyOf(v);
      if (k) return k;
    }

    return null;
  }

  function imageForKey(variants, key) {
    const hit = findByKey(variants, key);
    return String(hit?.image_url || "").trim();
  }

  async function compareCached(key) {
    const k = String(key || "").trim();
    if (!k) throw new Error("Missing compare key");
    if (_compareCache.has(k)) return _compareCache.get(k);

    const p = apiJson(`/api/compare/${encodeURIComponent(k)}`).catch((e) => {
      _compareCache.delete(k);
      throw e;
    });

    _compareCache.set(k, p);
    return p;
  }

  function updateCardKeyAndHref(cardEl, nextKey) {
    const k = String(nextKey || "").trim();
    if (!cardEl || !k) return;
    cardEl.setAttribute("data-dash-key", k);

    const title = cardEl.getAttribute("data-title") || "product";
    cardEl.setAttribute("href", dashPathFromKeyAndTitle(k, title));
  }

  function updateCardPrice(cardEl, bestCents) {
    if (!cardEl) return;
    const priceEl = cardEl.querySelector(".price");
    if (!priceEl) return;
    priceEl.textContent = typeof bestCents === "number" && bestCents > 0 ? fmtPrice(bestCents) : "";
  }

  function bestOfferCentsFromOffers(offers) {
    let best = null;
    for (const o of offers || []) {
      const p = typeof o?.price_cents === "number" && o.price_cents > 0 ? o.price_cents : null;
      const e = typeof o?.effective_price_cents === "number" && o.effective_price_cents > 0 ? o.effective_price_cents : null;
      const use = p != null && e != null && e <= p ? e : p;
      if (typeof use !== "number" || use <= 0) continue;
      if (best == null || use < best) best = use;
    }
    return best;
  }

  function parseDashKey(k) {
  const s = String(k || "").trim();
  const i = s.indexOf(":");
  if (i === -1) return { kind: "", value: "" };
  return { kind: s.slice(0, i).toLowerCase(), value: s.slice(i + 1).trim() };
}

function normUpcLoose(v) {
  // Keep digits only. Preserve leading zeros by not parsing as a number.
  return String(v ?? "").trim().replace(/[^\d]/g, "");
}

function offersForSelectedKey(data, selectedKey) {
  const offers = Array.isArray(data?.offers) ? data.offers : [];
  const variants = Array.isArray(data?.variants) ? data.variants : [];

  const { kind, value } = parseDashKey(selectedKey);
  const cur = findByKey(variants, selectedKey);

  // Pull identifiers from the resolved variant row first
  const curUpc = normUpcLoose(cur?.upc || cur?.UPC || "");
  const curAsin = normLower(cur?.asin || cur?.ASIN || "");
  const curPci = normLower(cur?.pci || cur?.PCI || "");

  // Also allow the key itself to provide the identifier
  const keyUpc = kind === "upc" ? normUpcLoose(value) : "";
  const keyAsin = kind === "asin" ? normLower(value) : "";
  const keyPci = kind === "pci" ? normLower(value) : "";

  // Strict priority: UPC -> ASIN -> PCI
  const upc = curUpc || keyUpc;
  if (upc) {
    return offers.filter((o) => normUpcLoose(o?.upc || o?.UPC || "") === upc);
  }

  const asin = curAsin || keyAsin;
  if (asin) {
    return offers.filter((o) => {
      const st = storeKeySimple(o?.store);
      const sku = normLower(o?.store_sku || o?.storeSku || "");
      const oAsin = normLower(o?.asin || o?.ASIN || "");
      return (oAsin && oAsin === asin) || (st === "amazon" && sku === asin);
    });
  }

  const pci = curPci || keyPci;
  if (pci) {
    return offers.filter((o) => normLower(o?.pci || "") === pci);
  }

  // Unknown, do not pretend
  return offers;
}

function fitCardVariantRow(host, totalOptionsCount) {
  if (!host) return;

  // Remove any existing "+N" control before fitting (any tag)
  const oldMore = host.querySelector('[data-card-variant-more="1"]');
  if (oldMore) oldMore.remove();

  let hidden = 0;

  // Start by removing from the end until it fits
  let btns = Array.from(host.querySelectorAll('button.pillbtn[data-card-variant-key]'));
  while (btns.length > 0 && host.scrollWidth > host.clientWidth) {
    const b = btns.pop();
    b.remove();
    hidden += 1;
  }

  // totalOptionsCount is for safety if you ever stop rendering all options.
  const remainingRendered = host.querySelectorAll('button.pillbtn[data-card-variant-key]').length;
  const impliedHidden = Math.max(0, (totalOptionsCount || 0) - remainingRendered);

  hidden = Math.max(hidden, impliedHidden);

  if (hidden <= 0) return;

  // Add "+N options" as plain text style (still clickable)
  const more = document.createElement("button");
  more.type = "button";
  more.className = "morelink";
  more.setAttribute("data-card-variant-more", "1");
  more.title = "Open all options";
  more.textContent = `+${hidden} option${hidden === 1 ? "" : "s"}`;
  host.appendChild(more);

  // If adding "+N options" caused overflow, delete one more pill at a time and increase N
  btns = Array.from(host.querySelectorAll('button.pillbtn[data-card-variant-key]'));
  while (btns.length > 0 && host.scrollWidth > host.clientWidth) {
    const b = btns.pop();
    b.remove();
    hidden += 1;
    more.textContent = `+${hidden} option${hidden === 1 ? "" : "s"}`;
  }

  // Extreme case: even "+N options" alone overflows (very narrow). Keep only "+N options".
  if (host.scrollWidth > host.clientWidth) {
    const keepMore = host.querySelector('[data-card-variant-more="1"]');
    host.innerHTML = "";
    if (keepMore) host.appendChild(keepMore);
  }
}

function renderCardVariantPills(cardEl, variants, selectedKey) {
  const host = cardEl ? cardEl.querySelector('[data-card-variants="1"]') : null;
  if (!host) return;

  const contextTitle = cardEl?.getAttribute("data-title") || "";
  const { options } = variantOptionsForSelectedKey(variants, selectedKey, contextTitle);

  if (!options.length) {
    host.removeAttribute("data-card-options");
    host.innerHTML = "";
    return;
  }

  // Store the full option set so resize can rebuild before fitting
  host.setAttribute("data-card-options", JSON.stringify(options));

  const selectedKeyNorm = normLower(selectedKey);

  host.innerHTML = options
    .map((opt) => {
      const active = normLower(opt.key) === selectedKeyNorm;

      return `
        <button type="button"
          class="pillbtn ${active ? "is-active" : ""}"
          data-card-variant-key="${escapeHtml(opt.key)}"
          title="${escapeHtml(opt.label)}">
          ${escapeHtml(opt.label)}
        </button>
      `;
    })
    .join("");

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      fitCardVariantRow(host, options.length);
    });
  });
}

function rerenderStoredCardVariantPills(cardEl) {
  const host = cardEl ? cardEl.querySelector('[data-card-variants="1"]') : null;
  if (!host) return;

  const raw = host.getAttribute("data-card-options");
  if (!raw) return;

  let options = [];
  try {
    options = JSON.parse(raw);
  } catch (_e) {
    return;
  }

  if (!Array.isArray(options) || !options.length) return;

  const selectedKeyNorm = normLower(cardEl.getAttribute("data-dash-key") || "");

  host.innerHTML = options
    .map((opt) => {
      const active = normLower(opt.key) === selectedKeyNorm;

      return `
        <button type="button"
          class="pillbtn ${active ? "is-active" : ""}"
          data-card-variant-key="${escapeHtml(opt.key)}"
          title="${escapeHtml(opt.label)}">
          ${escapeHtml(opt.label)}
        </button>
      `;
    })
    .join("");

  fitCardVariantRow(host, options.length);
}

function bumpCardReq(cardEl) {
  const n = Number.parseInt(cardEl?.dataset?.pcReq || "0", 10) || 0;
  const next = n + 1;
  if (cardEl) cardEl.dataset.pcReq = String(next);
  return next;
}

function isCardReqCurrent(cardEl, reqNum) {
  const cur = Number.parseInt(cardEl?.dataset?.pcReq || "0", 10) || 0;
  return cur === reqNum;
}

async function ensureCardVariantsLoaded(cardEl) {
  const baseKey = String(cardEl?.getAttribute("data-dash-key") || "").trim();
  if (!baseKey) return;
  if (cardEl.getAttribute("data-variants-loaded") === "1") return;

  cardEl.setAttribute("data-variants-loaded", "1");

  // Track this load so it cannot overwrite later user selections.
  const reqNum = bumpCardReq(cardEl);

  try {
    const data = await compareCached(baseKey);

    // If user clicked something else since this started, do nothing.
    if (!isCardReqCurrent(cardEl, reqNum)) return;

    // If the card key changed, do nothing (stale response).
    const nowKey = String(cardEl.getAttribute("data-dash-key") || "").trim();
    if (nowKey.toLowerCase() !== baseKey.toLowerCase()) return;

    const variants = Array.isArray(data?.variants) ? data.variants : [];
    renderCardVariantPills(cardEl, variants, nowKey);

    // Also update card's "From" price + store logos using ALL offers
    await updateCardPriceFromAllOffers(cardEl, Array.isArray(data?.offers) ? data.offers : []);
  } catch (_e) {
      try { cardEl.removeAttribute("data-variants-loaded"); } catch (_x) {}
  }
}

// Lazy card-variants hydrator (cuts initial /api/compare spam)
let _variantObserver = null;

function setupVariantHydrator(gridEl) {
  if (!gridEl) return;

  // Disconnect previous observer (new renders replace DOM)
  try {
    if (_variantObserver) _variantObserver.disconnect();
  } catch (_e) {}
  _variantObserver = null;

  const cards = Array.from(gridEl.querySelectorAll('a.card.item[data-dash-key]'));
  if (!cards.length) return;

  // Load only a few immediately (above the fold). Set to 0 if you want NONE eager.
  const EAGER = 4;
  for (const c of cards.slice(0, EAGER)) ensureCardVariantsLoaded(c);

  // Lazy load the rest when they come near the viewport
  _variantObserver = new IntersectionObserver(
    (entries) => {
      for (const ent of entries) {
        if (!ent.isIntersecting) continue;
        const cardEl = ent.target;
        _variantObserver.unobserve(cardEl);
        ensureCardVariantsLoaded(cardEl);
      }
    },
    { root: null, rootMargin: "300px 0px", threshold: 0.01 }
  );

  for (const c of cards.slice(EAGER)) _variantObserver.observe(c);
}

async function applyCardVariantSelection(cardEl, nextKey) {
  const k = String(nextKey || "").trim();
  if (!cardEl || !k) return;

  // Every selection bumps the request id. Only the latest selection is allowed to paint UI.
  const reqNum = bumpCardReq(cardEl);

  // Update href/key immediately so navigation and future checks are consistent.
  updateCardKeyAndHref(cardEl, k);

  try {
    const data = await compareCached(k);

    // Ignore if a newer click happened since this started.
    if (!isCardReqCurrent(cardEl, reqNum)) return;

    // Ignore if the card key is no longer this key.
    const nowKey = String(cardEl.getAttribute("data-dash-key") || "").trim();
    if (nowKey.toLowerCase() !== k.toLowerCase()) return;

    // Price is "From" across all offers (honest when offers cannot be scoped by spec)
    await updateCardPriceFromAllOffers(cardEl, Array.isArray(data?.offers) ? data.offers : []);

    const variants = Array.isArray(data?.variants) ? data.variants : [];
    if (variants.length) renderCardVariantPills(cardEl, variants, nowKey);
  } catch (_e) {
    // If request fails, do not overwrite anything.
  }
}

  // ----------------------------
  // Color map (cached)
  // ----------------------------
  let _colorMapPromise = null;

  function normKey(s) {
    return String(s ?? "").trim().toLowerCase();
  }

  function colorKey(s) {
    return normKey(s).replace(/\s+/g, " ");
  }

  async function loadColorMap() {
    if (_colorMapPromise) return _colorMapPromise;

    _colorMapPromise = (async () => {
      try {
        const res = await fetch("/data/color_hex.json", { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        return json && typeof json === "object" ? json : {};
      } catch (_e) {
        return {};
      }
    })();

    return _colorMapPromise;
  }

  // ----------------------------
  // Store name overrides (cached once)
  // ----------------------------
  const STORE_NAME_OVERRIDES = Object.create(null);
  let STORE_OVERRIDES_LOADED = false;

  async function loadNameOverridesOnce() {
    if (STORE_OVERRIDES_LOADED) return;
    STORE_OVERRIDES_LOADED = true;

    try {
      const res = await fetch("/data/name_overrides.json", {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return;

      const json = await res.json();
      const map = json && typeof json === "object" ? json.store_names : null;
      if (!map || typeof map !== "object") return;

      for (const [k, v] of Object.entries(map)) {
        const key = String(k || "").trim().toLowerCase();
        const val = String(v || "").trim();
        if (!key || !val) continue;
        STORE_NAME_OVERRIDES[key] = val;
      }
    } catch (_e) {
      // Silent fallback: keep generic capitalization if JSON can't load.
    }
  }

  // ----------------------------
  // Sellers map (cached)
  // ----------------------------
  let _sellersMapPromise = null;

  async function loadSellersMap() {
    if (_sellersMapPromise) return _sellersMapPromise;

    _sellersMapPromise = (async () => {
      try {
        const res = await fetch("/data/sellers.json", { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        return json && typeof json === "object" ? json : {};
      } catch (_e) {
        return {};
      }
    })();

    return _sellersMapPromise;
  }

  function resolveColorHex(name, cmap) {
    const raw = String(name ?? "").trim();
    if (!raw) return null;

    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw)) return raw;

    const k = colorKey(raw);
    let hex = cmap && cmap[k] ? String(cmap[k]) : "";

    if (!hex && k.includes("grey")) {
      const alt = k.replace(/grey/g, "gray");
      hex = cmap && cmap[alt] ? String(cmap[alt]) : "";
    }
    if (!hex && k.includes("gray")) {
      const alt = k.replace(/gray/g, "grey");
      hex = cmap && cmap[alt] ? String(cmap[alt]) : "";
    }

    if (!hex) return null;
    if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) return null;

    return hex;
  }

  // ----------------------------
  // Sidebar data loaders
  // ----------------------------
  function sellerSlugFromBrand(brandName) {
    return slugify(String(brandName || "").trim());
  }

  async function loadFamilyPanelFacets(reqId, { signal } = {}) {
    const fam = String(state.family || "").trim();
    if (!fam) {
      state.familyVariants = [];
      state.familyColors = [];
      state.familyPanelKey = "";
      return;
    }

    const key = `${normKey(state.brand)}|${normKey(state.category)}|${normKey(fam)}`;
    if (state.familyPanelKey === key) return;

    const qs = new URLSearchParams({ family: fam });
    if (state.brand) qs.set("brand", state.brand);
    if (state.category) qs.set("category", state.category);

    const data = await apiJson(`/api/family_panel?${qs.toString()}`, { signal });
    if (reqId !== state.lastReqId) return;

    state.familyVariants = Array.isArray(data.variants) ? data.variants : [];
    state.familyColors = Array.isArray(data.colors) ? data.colors : [];
    state.familyPanelKey = key;
  }

  async function loadBrandSeller(reqId, { signal } = {}) {
    const b = String(state.brand || "").trim();
    if (!b) {
      state.hasSeller = false;
      state.sellerSlug = "";
      state.sellerKey = "";
      state.sellerLogoUrl = "";
      return;
    }

    const slug = sellerSlugFromBrand(b);
    const key = slug;
    if (state.sellerKey === key) return;

    state.sellerKey = key;
    state.sellerSlug = slug;
    state.hasSeller = false;
    state.sellerLogoUrl = "";

    try {
      const data = await apiJson(`/api/seller?id=${encodeURIComponent(slug)}`, { signal });
      if (reqId !== state.lastReqId) return;

      state.hasSeller = !!(data && data.found === true);

      const logo =
        (data && data.seller && (data.seller.logo || data.seller.logo_url || data.seller.logoUrl || data.seller.image_url || data.seller.imageUrl)) ||
        (data && (data.logo || data.logo_url || data.logoUrl || data.image_url || data.imageUrl)) ||
        "";

      state.sellerLogoUrl = String(logo || "").trim();
    } catch (_e) {
      if (reqId !== state.lastReqId) return;
      state.hasSeller = false;
      state.sellerLogoUrl = "";
      state.sellerKey = "";
    }
  }

  async function loadBrandPanelFacets(reqId, { signal } = {}) {
    if (!state.brand) {
      state.sideCats = [];
      state.sideFams = [];
      state.sideFacetKey = "";
      return;
    }

    const key = `${state.brand.toLowerCase()}|${(state.category || "").toLowerCase()}`;
    if (state.sideFacetKey === key && Array.isArray(state.sideCats) && state.sideCats.length) return;

    const qs = new URLSearchParams({ brand: state.brand });
    if (state.category) qs.set("category", state.category);

    const data = await apiJson(`/api/brand_panel?${qs.toString()}`, { signal });
    if (reqId !== state.lastReqId) return;

    state.sideCats = Array.isArray(data.categories) ? data.categories : [];
    state.sideFams = Array.isArray(data.families) ? data.families : [];
    state.sideFacetKey = key;
  }

  async function loadCategoryPanelFacets(reqId, { signal } = {}) {
    if (!state.category) {
      state.sideBrands = [];
      state.sideBrandsFacetKey = "";
      return;
    }

    const key = state.category.toLowerCase();
    if (state.sideBrandsFacetKey === key && Array.isArray(state.sideBrands) && state.sideBrands.length) return;

    const qs = new URLSearchParams({ category: state.category });
    const data = await apiJson(`/api/category_panel?${qs.toString()}`, { signal });
    if (reqId !== state.lastReqId) return;

    state.sideBrands = Array.isArray(data.brands) ? data.brands : [];
    state.sideBrandsFacetKey = key;
  }

  // ----------------------------
  // Sidebar renderers (3 panels)
  // ----------------------------
  async function renderCategoryPanel() {
  if (!els.sidecol || !els.categoryPanel) return;

  const catName = String(state.category || "").trim();
  if (!catName) {
    els.categoryPanel.innerHTML = "";
    els.categoryPanel.hidden = true;
    return;
  }

  const brands = (Array.isArray(state.sideBrands) ? state.sideBrands : []).slice(0, 12);

  const brandButtons = await Promise.all(
    brands.map(async (b) => {
      const brandName = String(b || "").trim();
      if (!brandName) return "";

      const active = state.brand && state.brand.toLowerCase() === brandName.toLowerCase();
      const logoUrl = await storeLogoUrlForKey(brandName);
      const label = escapeHtml(brandName);

      return `
        <button
          type="button"
          class="brand-icon-btn ${active ? "is-active" : ""}"
          data-side-set="brand"
          data-side-value="${label}"
          aria-label="${label}"
          title="${label}"
        >
          ${
            logoUrl
              ? `<img
                  class="brand-icon-img"
                  src="${escapeHtml(logoUrl)}"
                  alt="${label}"
                  loading="lazy"
                  onerror="this.closest('button')?.remove()"
                >`
              : `<span class="brand-icon-fallback">${label.slice(0, 1).toUpperCase()}</span>`
          }
        </button>
      `;
    })
  );

  els.categoryPanel.hidden = false;
  els.categoryPanel.innerHTML = `
    <h2 class="side-title">${escapeHtml(catName)}</h2>

    ${brandButtons.filter(Boolean).length ? `
      <div class="side-block">
        <div class="side-label">Top Brands</div>
        <div class="brand-icon-grid">
          ${brandButtons.filter(Boolean).join("")}
        </div>
      </div>
    ` : ""}
  `;
}

  async function renderBrandPanel() {
    if (!els.sidecol || !els.brandPanel) return;

    const hasCategory = !!String(state.category || "").trim();
    const hasBrand = !!String(state.brand || "").trim();
    const hasFamily = !!String(state.family || "").trim();

    els.sidecol.hidden = !(hasCategory || hasBrand || hasFamily);

    if (!hasBrand) {
      els.brandPanel.innerHTML = "";
      els.brandPanel.hidden = true;
      if (els.familyPanel) {
        els.familyPanel.innerHTML = "";
        els.familyPanel.hidden = true;
      }
      return;
    }

    els.brandPanel.hidden = false;

    const brandName = String(state.brand || "").trim();
    const leftAlreadyShowsFacets = Array.isArray(state.also) && state.also.length > 0;

    const cats = leftAlreadyShowsFacets ? [] : (Array.isArray(state.sideCats) ? state.sideCats : []).slice(0, 14);
    const fams = (Array.isArray(state.sideFams) ? state.sideFams : []).slice(0, 12);

    const sellerBtn =
      state.hasSeller && state.sellerSlug && state.sellerLogoUrl
        ? `
          <a class="seller-icon"
             href="/seller/${encodeURIComponent(state.sellerSlug)}/"
             title="Seller information"
             aria-label="Seller information">
            <img class="seller-icon-img"
              src="${escapeHtml(state.sellerLogoUrl)}"
              alt=""
              onerror="this.closest('a') && this.closest('a').remove()">
          </a>
        `
        : "";

    els.brandPanel.innerHTML = `
      <div class="side-title-row">
        ${sellerBtn}
        <h2 class="side-title">${escapeHtml(brandName)}</h2>
      </div>

      ${cats.length ? `
        <div class="side-block">
          <div class="side-label">Category</div>
          <div class="pillrow">
            ${cats.map((c) => {
              const active = state.category && state.category.toLowerCase() === String(c).toLowerCase();
              return `
                <button type="button" class="pillbtn ${active ? "is-active" : ""}"
                  data-side-set="category" data-side-value="${escapeHtml(c)}">
                  ${escapeHtml(c)}
                </button>
              `;
            }).join("")}
          </div>
        </div>
      ` : ""}

      ${fams.length ? `
        <div class="side-block">
          <div class="side-label">Family</div>
          <div class="pillrow">
            ${fams.map((f) => {
              const active = state.familyNorm && state.familyNorm === String(f).toLowerCase();
              return `
                <button type="button" class="pillbtn ${active ? "is-active" : ""}"
                  data-side-set="family" data-side-value="${escapeHtml(f)}">
                  ${escapeHtml(f)}
                </button>
              `;
            }).join("")}
          </div>
        </div>
      ` : ""}
    `;

    // Family panel
    if (!els.familyPanel) return;

    const famName = String(state.family || "").trim();
    if (!famName) {
      els.familyPanel.innerHTML = "";
      els.familyPanel.hidden = true;
      return;
    }

    const variantsRaw = Array.isArray(state.familyVariants) ? state.familyVariants : [];
    const variants = variantsRaw.filter((v) => isMeaningfulVariantLabel(v, "")); // no version context here

    const colorsRaw = Array.isArray(state.familyColors) ? state.familyColors : [];
    const colors = uniqKeepFirstCase(colorsRaw);

    if (!variants.length && !colors.length) {
      els.familyPanel.innerHTML = "";
      els.familyPanel.hidden = true;
      return;
    }

    const cmap = await loadColorMap();

    const variantChips =
      variants.length >= 2
        ? `
          <div class="side-block">
            <div class="side-label">Variants</div>
            <div class="pillrow">
              ${variants.map((v) => {
                const active = state.variantNorm && state.variantNorm === String(v).toLowerCase();
                return `
                  <button type="button" class="pillbtn ${active ? "is-active" : ""}"
                    data-side-set="variant" data-side-value="${escapeHtml(v)}">
                    ${escapeHtml(v)}
                  </button>
                `;
              }).join("")}
            </div>
          </div>
        `
        : "";

    const colorSwatches =
      colors.length >= 2
        ? `
          <div class="side-block">
            <div class="side-label">Colors</div>
            <div class="pillrow">
              ${colors.map((c) => {
                const name = String(c || "").trim();
                const title = escapeHtml(name);
                const hex = resolveColorHex(name, cmap) || "#9ca3af";
                const border = hex.toLowerCase() === "#ffffff" ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.12)";
                const active = state.colorNorm && state.colorNorm === name.toLowerCase();

                return `
                  <button type="button"
                    class="swatchbtn ${active ? "is-active" : ""}"
                    data-side-set="color"
                    data-side-value="${escapeHtml(name)}"
                    title="${title}"
                    aria-label="${title}">
                    <span class="pc-swatch" style="--pc-swatch:${hex}; --pc-swatch-border:${border};"></span>
                  </button>
                `;
              }).join("")}
            </div>
          </div>
        `
        : "";

    els.familyPanel.hidden = false;
    els.familyPanel.innerHTML = `
      <h2 class="side-title">${escapeHtml(famName)}</h2>
      ${variantChips}
      ${colorSwatches}
    `;
  }

  function renderConditionFilter() {
    const el = document.getElementById("conditionFilter");
    if (!el) return;

    const showToggles = (state.hasRefurbished || state.hasBundle) && !state.lastError;
    const showSort = !state.lastError && (state.brand || state.category || state.q);
    const show = showToggles || showSort;

    el.hidden = !show;
    if (!show) { el.innerHTML = ""; return; }

    el.innerHTML = `
  <div class="browse-topbar">
    <div class="browse-topbar__left">
      ${showToggles ? `
        <div class="condition-seg">
          ${state.hasRefurbished ? `
            <button type="button" class="condition-seg__btn${state.condition === "refurbished" ? " is-active" : ""}" data-condition="refurbished">
              Refurb
            </button>` : ""}
          ${state.hasBundle ? `
            <button type="button" class="condition-seg__btn${state.condition === "bundle" ? " is-active" : ""}" data-condition="bundle">
              Bundle
            </button>` : ""}
        </div>
      ` : ""}
      </div>
        <div class="browse-topbar__right">
          ${showSort ? `
            <label class="browse-sort" for="browseSort">
              <span class="browse-sort__label">Sort</span>
              <select id="browseSort" class="browse-sort__select">
                <option value="recommended" ${state.sort === "recommended" ? "selected" : ""}>Recommended</option>
                <option value="lowest-price" ${state.sort === "lowest-price" ? "selected" : ""}>Lowest Price</option>
                <option value="highest-price" ${state.sort === "highest-price" ? "selected" : ""}>Highest Price</option>
                <option value="az" ${state.sort === "az" ? "selected" : ""}>A to Z</option>
              </select>
            </label>
          ` : ""}
        </div>
      </div>
    `;

    el.querySelectorAll("[data-condition]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = btn.getAttribute("data-condition");
        state.condition = state.condition === v ? "new" : v;
        state.page = 1;
        state.animateNextRender = false;
        startPageTransitionUI();
        writeUrl({ replace: false });
        load();
      });
    });

    el.querySelector("#browseSort")?.addEventListener("change", (e) => {
      state.sort = String(e.target.value || "recommended").trim().toLowerCase();
      state.page = 1;
      state.animateNextRender = false;
      startPageTransitionUI();
      writeUrl({ replace: false });
      load();
    });
  }

  // ----------------------------
  // Render main grid
  // ----------------------------
  async function render() {
    if (!els.grid) return;

    const q = (state.value || state.q || "").trim();
    const isPaged = state.page > 1;

    const canonical = `${location.origin}${buildBrowsePath({
      q: (state.value || state.q || "").trim(),
      page: 1,
      brand: state.brand,
      category: state.category,
      family: state.family,
      variant: state.variant,
      color: state.color,
    })}`;

    const robots = !q ? "noindex,follow" : isPaged ? "noindex,follow" : "index,follow";

    const total = typeof state.total === "number" ? state.total : 0;
    const desc = q
      ? `Browse ${q} on PriceCheck. ${total ? `${total} results.` : ""} Compare products and check the latest prices.`
      : "Browse PriceCheck. Search for a brand, category, or product name.";

    if (state.lastError) {
      setMeta(state.lastError);
      els.grid.innerHTML = "";
      showInlineEmpty(false);

      setInlineEmptyHtml(`<div class="msg"><span>${escapeHtml(state.lastError)}</span></div>`);
      showInlineEmpty(true);
      showEmpty(false);

      renderConditionFilter();
      await renderCategoryPanel();
      await renderBrandPanel();
      setPager();
      return;
    }

    const title = q ? `${q} Price Comparison and Deals - PriceCheck` : "Compare Product Prices Across Stores - PriceCheck";
    setHead({ title, description: desc, canonical, robots });

    setMeta("");

    const parts = [];

    if (Array.isArray(state.also) && state.also.length) {
      for (const f of state.also) parts.push(cardFacet(f));
    }

    if (Array.isArray(state.results) && state.results.length) {
      for (let i = 0; i < state.results.length; i++) parts.push(cardProduct(state.results[i]));
    }

    els.grid.innerHTML = parts.join("");
    animateGridCards(els.grid, { animate: !!state.animateNextRender });
    state.animateNextRender = true;

    setupVariantHydrator(els.grid);

    if (parts.length === 0) {
      const rawQ = (state.q || "").trim();
      const dym = state.didYouMean && state.didYouMean.value ? state.didYouMean : null;

      if (dym) {
        const shownQ = rawQ ? `"${escapeHtml(rawQ)}"` : "your search";
        const href = safeHref(dym.href, { sameOrigin: true }) || "/browse/";

        setInlineEmptyHtml(`
          <div class="msg">
            <span>No results for <strong>${shownQ}</strong>.</span>
            <span>Did you mean</span>
            <span class="dym-wrap">
              <a class="pc-dym" data-dym="1" href="${escapeHtml(href)}">${escapeHtml(dym.value)}</a><span class="pc-dym-q">?</span>
            </span>
            <span class="kbd" aria-hidden="true">Enter</span>
          </div>
        `);
      } else {
        const shownQ = rawQ ? `"${escapeHtml(rawQ)}"` : "your search";
        setInlineEmptyHtml(`
          <div class="msg">
            <span>No results for <strong>${shownQ}</strong>.</span>
          </div>
        `);
      }

      showInlineEmpty(true);
      showEmpty(false);
    } else {
      showInlineEmpty(false);
      showEmpty(false);
    }
    
    renderConditionFilter();
    await renderCategoryPanel();
    await renderBrandPanel();
    setPager();
  }

  // ----------------------------
  // Load results
  // ----------------------------
  async function load() {
    const reqId = ++state.lastReqId;

    // abort in-flight /api/search or /api/browse calls to feel snappier
    try {
      if (_activeLoadController) _activeLoadController.abort();
    } catch (_e) {}
    _activeLoadController = new AbortController();
    const signal = _activeLoadController.signal;

    setLoading(true);

    state.lastError = "";
    state.results = [];
    state.also = [];
    state.total = 0;
    state.pages = 1;
    state.kind = "product";
    state.value = "";
    state.didYouMean = null;

    try {
      if (!state.q && !state.brand && !state.category) {
        if (state.detailOpen) await closeDetail();

        state.hasSeller = false;
        state.sellerSlug = "";
        state.sellerKey = "";
        state.sellerLogoUrl = "";

        state.sideCats = [];
        state.sideFams = [];
        state.sideFacetKey = "";
        state.sideBrands = [];
        state.sideBrandsFacetKey = "";

        state.familyPanelKey = "";
        state.familyVariants = [];
        state.familyColors = [];

        setLoading(false);
        setMeta("Search for a brand, category, or product name.");

        if (els.grid) els.grid.innerHTML = "";

        showInlineEmpty(false);
        showEmpty(false);

        await renderCategoryPanel();
        await renderBrandPanel();
        setPager();

        try {
          window.dispatchEvent(new CustomEvent("pc:browse_results", { detail: { show: false, total: 0 } }));
        } catch (_e) {}

        return;
      }

      if (state.brand || state.category) {
        const qs = new URLSearchParams({
          page: String(state.page),
          limit: String(state.limit),
        });
        if (state.brand) qs.set("brand", state.brand);
        if (state.category) qs.set("category", state.category);
        if (state.family) qs.set("family", state.family);
        if (state.variant) qs.set("variant", state.variant);
        if (state.color) qs.set("color", state.color);
        qs.set("condition", state.condition || "new");
        if (state.sort) qs.set("sort", state.sort);

        const data = await apiJson(`/api/browse?${qs.toString()}`, { signal });
        if (reqId !== state.lastReqId) return;

        state.kind = data.type || "product";
        state.value = data.value || "";
        state.total = typeof data.total === "number" ? data.total : 0;
        state.pages = typeof data.pages === "number" ? data.pages : 1;
        state.results = Array.isArray(data.results) ? data.results : [];
        state.also = [];
        state.hasRefurbished = !!data.has_refurbished;
        state.hasBundle = !!data.has_bundle;

        await loadCategoryPanelFacets(reqId, { signal });
        await loadBrandPanelFacets(reqId, { signal });
        await loadBrandSeller(reqId, { signal });
        await loadFamilyPanelFacets(reqId, { signal });

        setLoading(false);
        await render();
        return;
      }

      const searchQs = new URLSearchParams({
        q: state.q,
        page: String(state.page),
        limit: String(state.limit),
        condition: state.condition || "new",
      });
      if (state.sort) searchQs.set("sort", state.sort);

      const data = await apiJson(`/api/search?${searchQs.toString()}`, { signal });

      if (reqId !== state.lastReqId) return;

      state.kind = data.kind || "product";
      state.value = data.value || "";
      state.total = typeof data.total === "number" ? data.total : 0;
      state.pages = typeof data.pages === "number" ? data.pages : 1;
      state.results = Array.isArray(data.results) ? data.results : [];
      state.also = Array.isArray(data.also) ? data.also : [];
      state.didYouMean = data.did_you_mean || null;

      if (state.kind === "brand" && state.value) {
        state.brand = String(state.value).trim();
        state.category = "";
        state.family = "";
        state.familyNorm = "";
        state.variant = "";
        state.variantNorm = "";
        state.color = "";
        state.colorNorm = "";

        state.q = state.brand;
        state.page = 1;
        writeUrl({ replace: true });
        load();
        return;
      }

      if (state.kind === "category" && state.value) {
        state.category = String(state.value).trim();
        state.brand = "";
        state.family = "";
        state.familyNorm = "";
        state.variant = "";
        state.variantNorm = "";
        state.color = "";
        state.colorNorm = "";

        state.q = state.category;
        state.page = 1;
        writeUrl({ replace: true });
        load();
        return;
      }

      await loadCategoryPanelFacets(reqId, { signal });
      await loadBrandPanelFacets(reqId, { signal });
      await loadBrandSeller(reqId, { signal });
      await loadFamilyPanelFacets(reqId, { signal });

      setLoading(false);
      await render();
    } catch (e) {
      if (reqId !== state.lastReqId) return;

      // ignore abort errors
      const msg = e && e.name === "AbortError" ? "" : (e && e.message ? e.message : "Search failed.");
      if (!msg) return;

      state.lastError = msg;
      setLoading(false);
      await render();
    }
  }

  // ----------------------------
  // Navigation state resets
  // ----------------------------
  function navTo(_kind, value) {
    state.q = norm(value);

    state.brand = "";
    state.category = "";
    state.family = "";
    state.familyNorm = "";
    state.variant = "";
    state.variantNorm = "";
    state.color = "";
    state.colorNorm = "";

    state.familyPanelKey = "";
    state.familyVariants = [];
    state.familyColors = [];

    state.hasSeller = false;
    state.sellerSlug = "";
    state.sellerKey = "";
    state.sellerLogoUrl = "";

    state.condition = "new";
    state.page = 1;
    writeUrl({ replace: false });
    load();
  }

  // ----------------------------
  // Detail sidebar (expanded view)
  // ----------------------------
  const DETAIL_CLOSE_SVG = `
    <svg xmlns="http://www.w3.org/2000/svg" height="26px" viewBox="0 0 24 24" width="26px"
        fill="none" stroke="currentColor" stroke-width="2.5"
        stroke-linecap="round" aria-hidden="true" focusable="false">
      <line x1="5" y1="5" x2="19" y2="19"/>
      <line x1="19" y1="5" x2="5" y2="19"/>
    </svg>
  `;

  const DETAIL_EXPAND_SVG = `
    <svg xmlns="http://www.w3.org/2000/svg" height="22px" viewBox="0 0 24 24" width="22px"
        fill="none" stroke="currentColor" stroke-width="2.5"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      <rect x="3" y="3" width="18" height="18" rx="2.5"/>
    </svg>
  `;

  const DETAIL_BOOKMARK_OFF_SVG = `
    <svg xmlns="http://www.w3.org/2000/svg" height="22px" viewBox="0 0 24 24" width="22px"
        fill="none" stroke="currentColor" stroke-width="2.5"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
    </svg>
  `;

  const DETAIL_BOOKMARK_ON_SVG = `
    <svg xmlns="http://www.w3.org/2000/svg" height="22px" viewBox="0 0 24 24" width="22px"
        fill="currentColor" stroke="currentColor" stroke-width="2.5"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
    </svg>
  `;

  function cleanDetailBookmarkText(v) {
    return String(v || "").trim();
  }

  function detailBookmarkMeta() {
    return {
      entity_key: cleanDetailBookmarkText(state.detailDashKey),
      title: cleanDetailBookmarkText(state.detailTitle).slice(0, 200),
      image_url: cleanDetailBookmarkText(state.detailImg).slice(0, 500) || null,
      brand: cleanDetailBookmarkText(state.detailBrand).slice(0, 100) || null,
    };
  }

  function detailBookmarkButtonHtml() {
  return `
    <button type="button"
            class="detail-action-btn"
            data-detail-bookmark="1"
            aria-label="Save"
            aria-pressed="false"
            title="Save">
      <span style="padding-top: 3px;" data-detail-bookmark-icon="off">${DETAIL_BOOKMARK_OFF_SVG}</span>
      <span style="padding-top: 3px;" data-detail-bookmark-icon="on" hidden>${DETAIL_BOOKMARK_ON_SVG}</span>
    </button>
  `;
}

  function detailHeadActionsHtml(dashHref) {
  return `
    <div class="detail-actions">
      ${detailBookmarkButtonHtml()}
      <a class="detail-action-btn"
        href="${escapeHtml(dashHref)}"
        title="Open full page"
        aria-label="Open full page">
        ${DETAIL_EXPAND_SVG}
      </a>
      <button type="button"
              class="detail-action-btn"
              data-detail-close="1"
              aria-label="Minimize">
        ${DETAIL_CLOSE_SVG}
      </button>
    </div>
  `;
}

  function setDetailBookmarkUi() {
    const btn = document.querySelector('#detailPanel [data-detail-bookmark="1"]');
    if (!btn) return;

    const iconOn = btn.querySelector('[data-detail-bookmark-icon="on"]');
    const iconOff = btn.querySelector('[data-detail-bookmark-icon="off"]');

    const on = !!state.detailBookmarked;
    const busy = !!state.detailBookmarkBusy;
    const hasKey = !!cleanDetailBookmarkText(state.detailDashKey);

    if (iconOn) iconOn.hidden = !on;
    if (iconOff) iconOff.hidden = on;

    btn.disabled = !hasKey || busy;
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.setAttribute("aria-label", on ? "Remove bookmark" : "Save to bookmarks");
    btn.title = busy
      ? (on ? "Removing..." : "Saving...")
      : (on ? "Remove bookmark" : "Save to bookmarks");
  }

  async function loadDetailBookmarkState() {
    const entityKey = cleanDetailBookmarkText(state.detailDashKey);

    state.detailBookmarkKnown = false;
    state.detailBookmarked = false;
    state.detailBookmarkBusy = false;
    setDetailBookmarkUi();

    if (!entityKey) return;

    try {
      const res = await fetch(`/api/bookmarks/check?entity_key=${encodeURIComponent(entityKey)}`, {
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      });

      const data = await res.json().catch(() => null);

      if (entityKey !== cleanDetailBookmarkText(state.detailDashKey)) return;

      state.detailBookmarkKnown = true;
      state.detailBookmarked = !!(data && data.ok && data.bookmarked);
      setDetailBookmarkUi();
    } catch (_e) {
      if (entityKey !== cleanDetailBookmarkText(state.detailDashKey)) return;
      state.detailBookmarkKnown = true;
      state.detailBookmarked = false;
      setDetailBookmarkUi();
    }
  }

  async function toggleDetailBookmark() {
    const meta = detailBookmarkMeta();
    if (!meta.entity_key || state.detailBookmarkBusy) return;

    state.detailBookmarkBusy = true;
    setDetailBookmarkUi();

    try {
      const res = await fetch("/api/bookmarks/toggle", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify(meta)
      });

      if (res.status === 401) {
        state.detailBookmarkBusy = false;
        setDetailBookmarkUi();
        if (typeof window.pcOpenSignIn === "function") window.pcOpenSignIn();
        return;
      }

      const data = await res.json().catch(() => null);

      if (data && data.ok) {
        state.detailBookmarked = !!data.bookmarked;
        state.detailBookmarkKnown = true;

        window.dispatchEvent(new CustomEvent("pc:bookmark_changed", {
          detail: {
            entity_key: meta.entity_key,
            bookmarked: state.detailBookmarked
          }
        }));
      }
    } catch (_e) {
      // keep current UI state on network failure
    } finally {
      state.detailBookmarkBusy = false;
      setDetailBookmarkUi();
    }
  }

  const OFFER_EXTERNAL_SVG = `
    <svg xmlns="http://www.w3.org/2000/svg"
         height="35px" viewBox="0 -960 960 960" width="35px"
         fill="#86868b" aria-hidden="true" focusable="false">
      <path d="m216-160-56-56 464-464H360v-80h400v400h-80v-264L216-160Z"/>
    </svg>
  `;

  function ensureDetailPanel() {
    if (!els.sidecol) return null;

    let panel = document.getElementById("detailPanel");
    if (panel) return panel;

    panel = document.createElement("div");
    panel.id = "detailPanel";
    panel.className = "side-panel detail";
    panel.hidden = true;

    els.sidecol.prepend(panel);

        panel.addEventListener("click", (e) => {
      const bookmarkBtn = e.target.closest("[data-detail-bookmark]");
      if (bookmarkBtn) {
        e.preventDefault();
        toggleDetailBookmark();
        return;
      }

      const closeBtn = e.target.closest("[data-detail-close]");
      if (closeBtn) {
        e.preventDefault();
        closeDetail();
        return;
      }

      const vbtn = e.target.closest("button[data-detail-variant-key]");
      if (vbtn) {
        e.preventDefault();

        const nextKey = String(vbtn.getAttribute("data-detail-variant-key") || "").trim();
        if (!nextKey) return;
        if (state.detailDashKey && nextKey.toLowerCase() === state.detailDashKey.toLowerCase()) return;

        const nextImg = String(vbtn.getAttribute("data-detail-variant-img") || "").trim();

        if (state.detailSourceCardEl) {
          applyCardVariantSelection(state.detailSourceCardEl, nextKey).catch(() => {});
        }

        const lbl = String(vbtn.getAttribute("data-detail-variant-label") || "").trim();
        if (lbl) state.detailSelectedVariantLabel = lbl;
        state.detailSelectedColorName = "";

        openDetailFromCard({
          dashKey: nextKey,
          title: state.detailTitle || "",
          brand: state.detailBrand || "",
          img: nextImg || state.detailImg || "",
          cardEl: state.detailSourceCardEl || null,
          keepSelections: true,
        });

        return;
      }

      const cbtn = e.target.closest("button[data-detail-color-name]");
      if (cbtn) {
        e.preventDefault();

        const picked = String(cbtn.getAttribute("data-detail-color-name") || "").trim();
        if (!picked) return;

        state.detailSelectedColorName = picked;

        const variants = Array.isArray(state.detailData?.variants) ? state.detailData.variants : [];
        const nextKey = pickKeyForLabelAndColor(variants, state.detailDashKey, state.detailSelectedVariantLabel, picked);
        if (!nextKey) return;

        const nextImg = imageForKey(variants, nextKey);

        if (state.detailSourceCardEl) {
          applyCardVariantSelection(state.detailSourceCardEl, nextKey).catch(() => {});
        }

        openDetailFromCard({
          dashKey: nextKey,
          title: state.detailTitle || "",
          brand: state.detailBrand || "",
          img: nextImg || state.detailImg || "",
          cardEl: state.detailSourceCardEl || null,
          keepSelections: true,
        });

        return;
      }
    });

    return panel;
  }

  function hideFacetPanelsForDetail() {
    if (els.sidecol) els.sidecol.hidden = false;
    if (els.categoryPanel) els.categoryPanel.hidden = true;
    if (els.brandPanel) els.brandPanel.hidden = true;
    if (els.familyPanel) els.familyPanel.hidden = true;
  }

  async function restoreFacetPanelsAfterDetail() {
    await renderCategoryPanel();
    await renderBrandPanel();
  }

  function renderDetailSkeleton() {
    const panel = ensureDetailPanel();
    if (!panel) return;

    const dashHrefRaw = state.detailDashKey
      ? dashPathFromKeyAndTitle(state.detailDashKey, state.detailTitle || "product")
      : "/dashboard/";
    const dashHref = safeHref(dashHrefRaw, { sameOrigin: true }) || "/dashboard/";
    panel.hidden = false;

    panel.innerHTML = `
        <div class="detail-head">
          <div class="detail-head-left">
            ${state.detailBrand ? `<div class="detail-head-brand muted">${escapeHtml(state.detailBrand)}</div>` : ""}
          </div>

            <div class="detail-head-right" style="display:flex; align-items:center; gap:20px;">
            ${detailHeadActionsHtml(dashHref)}
          </div>
        </div>

        <div class="detail-top">
          <div class="detail-title">${escapeHtml(state.detailTitle || "Product")}</div>
        </div>

      <div class="detail-img-wrap">
        ${state.detailImg ? `<img class="detail-img" src="${escapeHtml(state.detailImg)}" alt="">` : `<div class="detail-img ph"></div>`}
      </div>

      <div class="detail-variants" data-detail-variants="1"></div>

      <div class="detail-block muted">Loading offers…</div>
    `;

    setDetailBookmarkUi();
  }

    function renderDetailError(msg) {
    const panel = ensureDetailPanel();
    if (!panel) return;

    const dashHrefRaw = state.detailDashKey
      ? dashPathFromKeyAndTitle(state.detailDashKey, state.detailTitle || "product")
      : "/dashboard/";
    const dashHref = safeHref(dashHrefRaw, { sameOrigin: true }) || "/dashboard/";

    panel.hidden = false;

    panel.innerHTML = `
      <div class="detail-head">
        <div class="detail-head-left">
          ${state.detailBrand ? `<div class="detail-head-brand muted">${escapeHtml(state.detailBrand)}</div>` : ""}
        </div>

        <div class="detail-head-right" style="display:flex; align-items:center; gap:20px;">
          ${detailHeadActionsHtml(dashHref)}
        </div>
      </div>

      <div class="detail-top">
        <div class="detail-title">${escapeHtml(state.detailTitle || "Product")}</div>
      </div>

      <div class="detail-block">
        <div class="msg"><span>${escapeHtml(msg || "Failed to load product details.")}</span></div>
      </div>
    `;

    setDetailBookmarkUi();
  }

  async function renderDetailData(data) {
    const panel = ensureDetailPanel();
    if (!panel) return;

    const variants = Array.isArray(data?.variants) ? data.variants : [];
    const offers = offersForSelectedKey(data, state.detailDashKey);

    const { options, activeVariant } = variantOptionsForSelectedKey(
      variants,
      state.detailDashKey,
      state.detailTitle || ""
    );

    // Sync selected label/color from the current variant key (if available)
    const curVar = findByKey(variants, state.detailDashKey);
    const detailAbout =
      aboutHtmlFull(curVar?.about) ||
      aboutHtmlFull(data?.about);

    if (!curVar) {
      state.detailSelectedVariantLabel = "";
      state.detailSelectedColorName = "";
    } else {
      const bestImg = String(curVar?.image_url || "").trim();
      if (bestImg) state.detailImg = bestImg;

      const curLabel = variantOnly(curVar) || activeVariant || "";
      const curColor = colorOfVariant(curVar) || "";

      if (!state.detailSelectedVariantLabel && curLabel) state.detailSelectedVariantLabel = curLabel;
      if (!state.detailSelectedColorName && curColor) state.detailSelectedColorName = curColor;
    }

    // Colors are group+version scoped, then narrowed to the selected variant label if variant pills exist
    let scopedForColors = scopedByGroupAndVersion(variants, state.detailDashKey);
    const labelScope = normLower(state.detailSelectedVariantLabel);
    if (options.length && labelScope) {
      scopedForColors = scopedForColors.filter((v) => normLower(variantOnly(v)) === labelScope);
    }

    const colors = uniqKeepFirstCase(scopedForColors.map(colorOfVariant));
    const showColors = Array.isArray(colors) && colors.length >= 2;
    const cmap = showColors ? await loadColorMap() : null;

    const colorsRow = showColors
      ? `
        <div class="detail-colors" data-detail-colors="1">
          <div class="side-label">Colors</div>
          <div class="pillrow">
            ${colors
              .map((c) => {
                const name = String(c || "").trim();
                const title = escapeHtml(name);
                const hex = resolveColorHex(name, cmap) || "#9ca3af";
                const border = hex.toLowerCase() === "#ffffff" ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.12)";
                const active =
                  state.detailSelectedColorName &&
                  normLower(state.detailSelectedColorName) === normLower(name);

                return `
                  <button type="button"
                    class="swatchbtn ${active ? "is-active" : ""}"
                    data-detail-color-name="${escapeHtml(name)}"
                    title="${title}"
                    aria-label="${title}">
                    <span class="pc-swatch" style="--pc-swatch:${hex}; --pc-swatch-border:${border};"></span>
                  </button>
                `;
              })
              .join("")}
          </div>
        </div>
      `
      : "";

    const variantRow = options.length
      ? `
        <div class="detail-variants" data-detail-variants="1">
          <div class="side-label">Variants</div>
          <div class="pillrow">
            ${options
              .map((opt) => {
                const active = normLower(opt.key) === normLower(state.detailDashKey);
                const img = imageForKey(variants, opt.key);
                return `
                  <button type="button"
                    class="pillbtn ${active ? "is-active" : ""}"
                    data-detail-variant-label="${escapeHtml(opt.label)}"
                    data-detail-variant-key="${escapeHtml(opt.key)}"
                    data-detail-variant-img="${escapeHtml(img)}"
                    title="${escapeHtml(opt.label)}">
                    ${escapeHtml(opt.label)}
                  </button>
                `;
              })
              .join("")}
          </div>
        </div>
      `
      : "";

    const offerRows = renderOfferRows(offers);
    const dashHrefRaw = state.detailDashKey
      ? dashPathFromKeyAndTitle(state.detailDashKey, state.detailTitle || "product")
      : "/dashboard/";
    const dashHref = safeHref(dashHrefRaw, { sameOrigin: true }) || "/dashboard/";

    panel.hidden = false;
    panel.innerHTML = `
      <div class="detail-head">
        <div class="detail-head-left">
          ${state.detailBrand ? `<div class="detail-head-brand muted">${escapeHtml(state.detailBrand)}</div>` : ""}
        </div>

        <div class="detail-head-right" style="display:flex; align-items:center; gap:20px;">
          ${detailHeadActionsHtml(dashHref)}
        </div>
      </div>

      <div class="detail-top">
        <div class="detail-title">${escapeHtml(state.detailTitle || "Product")}</div>
      </div>

      <div class="detail-img-wrap">
        ${state.detailImg ? `<img class="detail-img" src="${escapeHtml(state.detailImg)}" alt="">` : `<div class="detail-img ph"></div>`}
      </div>

      ${variantRow}

      ${colorsRow}
      ${detailAbout}

      <div class="detail-block" style="margin-top:12px;">
        ${offerRows}
      </div>
    `;

    setDetailBookmarkUi();
  }

  function storeKeySimple(store) {
    const s = String(store || "").trim().toLowerCase();
    if (!s) return "";
    if (s === "best buy" || s === "bestbuy") return "bestbuy";
    if (s === "walmart" || s === "wal") return "walmart";
    if (s === "amazon" || s === "amz") return "amazon";
    if (s === "target") return "target";
    return s.replace(/\s+/g, "");
  }

  function formatStoreName(storeRaw) {
    const id = storeKeySimple(storeRaw);

    // 1) Central overrides (spacing, punctuation, acronyms)
    if (id && STORE_NAME_OVERRIDES[id]) return STORE_NAME_OVERRIDES[id];

    // 2) Fallback: "walmart" -> "Walmart", "newegg" -> "Newegg"
    if (!id) return String(storeRaw || "").trim();
    return id.charAt(0).toUpperCase() + id.slice(1);
  }

async function storeLogoUrlForKey(storeKey) {
  const k = String(storeKey || "").trim().toLowerCase();
  if (!k) return "";

  const sellers = await loadSellersMap();

  // sellers.json keys are your ids (example: "bestbuy", "5th_wheel")
  const entry = sellers && sellers[k] ? sellers[k] : null;
  const logo = entry && (entry.logo || entry.logo_url || entry.logoUrl || entry.image_url || entry.imageUrl) ? String(entry.logo || entry.logo_url || entry.logoUrl || entry.image_url || entry.imageUrl) : "";

  return String(logo || "").trim();
}

function bestOfferCentsAndStores(offers) {
  // Returns best price cents and store order (cheapest-first by their best offer)
  const bestByStore = new Map(); // storeKey -> cents

  for (const o of offers || []) {
    const st = storeKeySimple(o?.store);
    if (!st) continue;

    const p = typeof o?.price_cents === "number" && o.price_cents > 0 ? o.price_cents : null;
    const e = typeof o?.effective_price_cents === "number" && o.effective_price_cents > 0 ? o.effective_price_cents : null;
    const use = p != null && e != null && e <= p ? e : p;
    if (typeof use !== "number" || use <= 0) continue;

    const prev = bestByStore.get(st);
    if (prev == null || use < prev) bestByStore.set(st, use);
  }

  let best = null;
  for (const v of bestByStore.values()) {
    if (best == null || v < best) best = v;
  }

  const stores = Array.from(bestByStore.entries())
    .sort((a, b) => a[1] - b[1]) // cheapest store first
    .map(([st]) => st);

  return { bestCents: best, stores };
}

async function renderCardStoreStack(cardEl, stores) {
  if (!cardEl) return;
  const host = cardEl.querySelector('[data-store-stack="1"]');
  if (!host) return;

  const list = Array.isArray(stores) ? stores : [];
  if (!list.length) {
    host.innerHTML = "";
    return;
  }

  const MAX = 4;
  const shown = list.slice(0, MAX);
  const extra = list.length - shown.length;

  const bits = [];

  for (const st of shown) {
    const url = await storeLogoUrlForKey(st);
    const label = escapeHtml(formatStoreName(st));

    if (url) {
      bits.push(
        `<img class="store-badge" src="${escapeHtml(url)}" alt="${label}" title="${label}"
          onerror="this.remove()">`
      );
      continue;
    }

    const ch = escapeHtml(label.slice(0, 1).toUpperCase() || "?");
    bits.push(`<span class="store-badge store-badge-fallback" title="${label}" aria-label="${label}">${ch}</span>`);
  }

  if (extra > 0) {
    bits.push(`<span class="store-badge store-badge-more" title="+${extra} more" aria-label="+${extra} more">+${extra}</span>`);
  }

  host.innerHTML = bits.join("");
}

async function updateCardPriceFromAllOffers(cardEl, offers) {
  const priceEl = cardEl ? cardEl.querySelector(".price") : null;
  if (!priceEl) return;

  const { bestCents, stores } = bestOfferCentsAndStores(offers);
  priceEl.innerHTML =
  typeof bestCents === "number" && bestCents > 0
    ? `<span class="price-from">From</span> <span class="price-amt">${escapeHtml(fmtPrice(bestCents))}</span>`
    : "";

  await renderCardStoreStack(cardEl, stores);
}

  function canonicalOfferLink(store, offer) {
    const st = storeKeySimple(store);
    const sku = String(offer?.store_sku || "").trim();

    if (st === "amazon") {
      const asin = sku.toUpperCase();
      return /^[A-Z0-9]{10}$/.test(asin) ? `https://www.amazon.com/dp/${asin}` : "";
    }
    if (st === "bestbuy") {
      return /^\d{6,8}$/.test(sku) ? `https://www.bestbuy.com/site/${sku}.p` : "";
    }
    if (st === "walmart") {
      return /^\d{6,12}$/.test(sku) ? `https://www.walmart.com/ip/${sku}` : "";
    }
    if (st === "target") {
      return /^\d{8}$/.test(sku) ? `https://www.target.com/p/-/A-${sku}` : "";
    }
    return "";
  }

  function renderOfferRows(offers) {
    const rows = (offers || [])
      .map((o) => {
        const storeRaw = String(o?.store || "").trim();
        const store = formatStoreName(storeRaw);

        const price =
          typeof o?.price_cents === "number" && o.price_cents > 0 ? fmtPrice(o.price_cents) : "";
        const eff =
          typeof o?.effective_price_cents === "number" && o.effective_price_cents > 0
            ? fmtPrice(o.effective_price_cents)
            : "";
        const shown = eff && eff !== price ? eff : price;

        const tag = String(o?.offer_tag || "").trim();

        const rawLink = String(o?.url || "").trim() || canonicalOfferLink(storeRaw, o);
        const link = safeHref(rawLink);

        return `
          <div class="offer-row">
            <div class="offer-store">${escapeHtml(store)}</div>

            ${tag ? `<div class="offer-tag muted">${escapeHtml(tag)}</div>` : ""}

            <div class="offer-right">
              <div class="offer-price">${escapeHtml(shown || "")}</div>

              ${
                link
                  ? `
                    <a class="offer-icon"
                       href="${escapeHtml(link)}"
                       target="_blank"
                       rel="noopener noreferrer"
                       aria-label="Open ${escapeHtml(store)}">
                      ${OFFER_EXTERNAL_SVG}
                    </a>
                  `
                  : `<span class="offer-icon-spacer" aria-hidden="true"></span>`
              }
            </div>
          </div>
        `;
      })
      .join("");

    return rows ? `<div class="offers">${rows}</div>` : `<div class="detail-block muted">No offers.</div>`;
  }

  async function openDetailFromCard({ dashKey, title, brand, img, cardEl = null, keepSelections = false }) {
    const k = String(dashKey || "").trim();
    if (!k) return;

    state.detailOpen = true;
    document.body.classList.add("has-detail");
    state.detailSourceCardEl = cardEl || null;
    state.detailDashKey = k;
    state.detailTitle = String(title || "").trim();
    state.detailBrand = String(brand || "").trim();
    state.detailImg = String(img || "").trim();
    state.detailLoading = true;
    state.detailError = "";
    state.detailData = null;
    state.detailBookmarked = false;
    state.detailBookmarkKnown = false;
    state.detailBookmarkBusy = false;

    if (!keepSelections) {
      state.detailSelectedVariantLabel = "";
      state.detailSelectedColorName = "";
    }

    hideFacetPanelsForDetail();
    renderDetailSkeleton();
    loadDetailBookmarkState();

    try {
      const data = await compareCached(k);
      if (state.detailDashKey !== k) return;

      state.detailLoading = false;
      state.detailData = data;
      await renderDetailData(data);
    } catch (e) {
      if (state.detailDashKey !== k) return;
      state.detailLoading = false;
      state.detailError = e && e.message ? e.message : "Failed to load product details.";
      renderDetailError(state.detailError);
    }
  }

  async function closeDetail() {
    state.detailOpen = false;
    document.body.classList.remove("has-detail");
    state.detailDashKey = "";
    state.detailTitle = "";
    state.detailBrand = "";
    state.detailImg = "";
    state.detailLoading = false;
    state.detailError = "";
    state.detailData = null;
    state.detailSourceCardEl = null;
    state.detailBookmarked = false;
    state.detailBookmarkKnown = false;
    state.detailBookmarkBusy = false;

    const panel = document.getElementById("detailPanel");
    if (panel) panel.remove();

    await restoreFacetPanelsAfterDetail();
  }

  function isMobileBrowseView() {
  // Match your CSS breakpoint where .sidecol is hidden
  return window.matchMedia("(max-width: 860px)").matches;
  }

  // ----------------------------
  // Wire UI events
  // ----------------------------
  function wire() {
    if (els.prev) {
      els.prev.addEventListener("click", () => {
        stepBrowsePage(-1);
      });
    }

    if (els.next) {
      els.next.addEventListener("click", () => {
        stepBrowsePage(1);
      });
    }

  document.getElementById("conditionFilter")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-condition]");
    if (!btn) return;

    const picked = btn.getAttribute("data-condition");
    const next = picked === "refurbished" ? true : false;

    state.refurbished = state.refurbished === next ? null : next;
    state.page = 1;
    state.animateNextRender = false;
    startPageTransitionUI();
    writeUrl({ replace: false });
    load();
  });

    if (els.grid) {
      els.grid.addEventListener("click", (e) => {
        // 1) facet cards
        const btn = e.target.closest("button[data-nav-kind][data-nav-value]");
        if (btn) {
          const value = btn.getAttribute("data-nav-value");
          if (!value) return;
          navTo(btn.getAttribute("data-nav-kind") || "product", value);
          return;
        }

        // 2) card variant pills
        const vbtn = e.target.closest("button[data-card-variant-key], button[data-card-variant-more]");
        if (vbtn) {
          e.preventDefault();
          e.stopPropagation();

          const cardEl = vbtn.closest('a.card.item[data-dash-key]');
          if (!cardEl) return;

          ensureCardVariantsLoaded(cardEl).catch(() => {});

          if (vbtn.hasAttribute("data-card-variant-more")) {
            const dashKey = String(cardEl.getAttribute("data-dash-key") || "").trim();
            if (!dashKey) return;

            openDetailFromCard({
              dashKey,
              title: cardEl.getAttribute("data-title") || "",
              brand: cardEl.getAttribute("data-brand") || "",
              img: cardEl.getAttribute("data-img") || "",
              cardEl,
            });
            return;
          }

          const nextKey = String(vbtn.getAttribute("data-card-variant-key") || "").trim();
          if (!nextKey) return;

          applyCardVariantSelection(cardEl, nextKey).catch(() => {});
          return;
        }

        const a = e.target.closest('a.card.item[href]');
        if (!a) return;

        if (e.defaultPrevented) return;
        if (e.button && e.button !== 0) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

        const dashKey = String(a.getAttribute("data-dash-key") || "").trim();
        if (!dashKey) return;

        if (isMobileBrowseView()) return;

        if (state.detailOpen && normLower(state.detailDashKey) === normLower(dashKey)) {
          return;
        }

        e.preventDefault();

        openDetailFromCard({
          dashKey,
          title: a.getAttribute("data-title") || "",
          brand: a.getAttribute("data-brand") || "",
          img: a.getAttribute("data-img") || "",
          cardEl: a,
        });
      });
    }

    if (els.sidecol) {
      els.sidecol.addEventListener("click", (e) => {
        const setBtn = e.target.closest("button[data-side-set][data-side-value]");
        if (!setBtn) return;

        const which = String(setBtn.getAttribute("data-side-set") || "");
        const value = norm(setBtn.getAttribute("data-side-value"));
        if (!value) return;

        if (which === "category") {
          const isActive = state.category && state.category.toLowerCase() === value.toLowerCase();
          if (isActive) {
            state.category = "";
            state.family = "";
            state.familyNorm = "";
            state.familyPanelKey = "";
            state.familyVariants = [];
            state.familyColors = [];
            state.variant = "";
            state.variantNorm = "";
            state.color = "";
            state.colorNorm = "";
          } else {
            state.category = value;
            state.family = "";
            state.familyNorm = "";
            state.familyPanelKey = "";
            state.familyVariants = [];
            state.familyColors = [];
            state.variant = "";
            state.variantNorm = "";
            state.color = "";
            state.colorNorm = "";
          }

          state.page = 1;
          writeUrl({ replace: false });
          load();
          return;
        }

        if (which === "brand") {
          const isActive = state.brand && state.brand.toLowerCase() === value.toLowerCase();

          if (isActive) {
            state.brand = "";
            state.family = "";
            state.familyNorm = "";
            state.familyPanelKey = "";
            state.familyVariants = [];
            state.familyColors = [];
            state.variant = "";
            state.variantNorm = "";
            state.color = "";
            state.colorNorm = "";
          } else {
            state.brand = value;
            state.family = "";
            state.familyNorm = "";
            state.familyPanelKey = "";
            state.familyVariants = [];
            state.familyColors = [];
            state.variant = "";
            state.variantNorm = "";
            state.color = "";
            state.colorNorm = "";
          }

          state.page = 1;
          writeUrl({ replace: false });
          load();
          return;
        }

        if (which === "family") {
          const isActive = state.family && state.family.toLowerCase() === value.toLowerCase();

          if (isActive) {
            state.family = "";
            state.familyNorm = "";
            state.familyPanelKey = "";
            state.familyVariants = [];
            state.familyColors = [];
            state.variant = "";
            state.variantNorm = "";
            state.color = "";
            state.colorNorm = "";
          } else {
            state.family = value;
            state.familyNorm = value.toLowerCase();
            state.familyPanelKey = "";
            state.familyVariants = [];
            state.familyColors = [];
            state.variant = "";
            state.variantNorm = "";
            state.color = "";
            state.colorNorm = "";
          }

          state.page = 1;
          writeUrl({ replace: false });
          load();
          return;
        }

        if (which === "variant") {
          const isActive = state.variant && state.variant.toLowerCase() === value.toLowerCase();
          if (isActive) {
            state.variant = "";
            state.variantNorm = "";
          } else {
            state.variant = value;
            state.variantNorm = value.toLowerCase();
          }
          state.page = 1;
          writeUrl({ replace: false });
          load();
          return;
        }

        if (which === "color") {
          const isActive = state.color && state.color.toLowerCase() === value.toLowerCase();
          if (isActive) {
            state.color = "";
            state.colorNorm = "";
          } else {
            state.color = value;
            state.colorNorm = value.toLowerCase();
          }
          state.page = 1;
          writeUrl({ replace: false });
          load();
          return;
        }
      });
    }

    // Enter key triggers did-you-mean when visible
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && state.detailOpen) {
      closeDetail();
      return;
      }
      if (e.key !== "Enter") return;

      const tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.target && e.target.isContentEditable) return;
      if (tag === "button" || tag === "a") return;

      if (els.emptyInline && !els.emptyInline.hidden) {
        const dym = els.emptyInline.querySelector('a.pc-dym[data-dym="1"][href]');
        if (!dym) return;
        e.preventDefault();
        location.href = dym.getAttribute("href");
      }
    });

    // Refit variant rows on resize so "+N" stays correct
    let _fitT = null;
    window.addEventListener("resize", () => {
      clearTimeout(_fitT);
      _fitT = setTimeout(() => {
        if (!els.grid) return;

        const cards = Array.from(els.grid.querySelectorAll('a.card.item[data-dash-key]'));
        for (const card of cards) {
          rerenderStoredCardVariantPills(card);
        }
      }, 120);
    });

    window.addEventListener("popstate", () => {
      readUrl();
      load();
    });
  }

  // Optional SPA entry point for your header search
  window.pcBrowse = {
  async search(raw) {
    state.q = norm(raw);
    state.page = 1;

    state.brand = "";
    state.category = "";
    state.family = "";
    state.familyNorm = "";
    state.variant = "";
    state.variantNorm = "";
    state.color = "";
    state.colorNorm = "";

    state.sideCats = [];
    state.sideFams = [];
    state.sideFacetKey = "";
    state.sideBrands = [];
    state.sideBrandsFacetKey = "";

    state.familyPanelKey = "";
    state.familyVariants = [];
    state.familyColors = [];

    state.sellerSlug = "";
    state.hasSeller = false;
    state.sellerKey = "";
    state.sellerLogoUrl = "";

    state.condition = "new";

    if (state.detailOpen) await closeDetail();

    writeUrl({ replace: false });
    load();
  },
};

  // ----------------------------
  // Boot
  // ----------------------------
    document.addEventListener("DOMContentLoaded", async () => {
    cacheEls();
    readUrl();
    wire();
    renderBrowseRail();

    await loadNameOverridesOnce();

    writeUrl({ replace: true });
    load();
  });
})();