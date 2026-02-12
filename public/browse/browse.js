// public/browse/browse.js
(() => {
  const $ = (s) => document.querySelector(s);
  const norm = (s) => String(s ?? "").trim();

  const els = {
    meta: () => $("#meta"),
    grid: () => $("#grid"),
    empty: () => $("#empty"),
    emptyInline: () => $("#emptyInline"),
    prev: () => $("#prev"),
    next: () => $("#next"),
    pager: () => document.querySelector(".pager"),
    sidecol: () => $("#sidecol"),
    categoryPanel: () => $("#categoryPanel"),
    brandPanel: () => $("#brandPanel"),
    familyPanel: () => $("#familyPanel"),
  };

  const state = {
    q: "",
    page: 1,
    limit: 36,
    sideCats: [],
    sideFams: [],
    sideFacetKey: "",

    sideBrands: [],
    sideBrandsFacetKey: "",

    kind: "product",
    value: "",
    brand: "",
    category: "",
    family: "",
    familyNorm: "",
    total: 0,
    pages: 1,
    results: [],
    also: [],
    didYouMean: null,

    loading: false,
    lastReqId: 0,
    lastError: "",

    animateNextRender: true,
  };

  function setText(el, txt) {
    if (el) el.textContent = txt ?? "";
  }

  function setInlineEmptyHtml(html) {
  const el = els.emptyInline();
  if (el) el.innerHTML = html || "";
  }

  function showInlineEmpty(show) {
    const el = els.emptyInline();
    if (el) el.hidden = !show;
  }

  function setMeta(txt) {
    setText(els.meta(), txt || "");
  }

  function setEmptyText(txt) {
    const el = els.empty();
    if (el) el.textContent = txt || "No results.";
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function setEmptyHtml(html) {
    const el = els.empty();
    if (el) el.innerHTML = html || "";
  }

  function showEmpty(show) {
    const el = els.empty();
    if (el) el.hidden = !show;
  }

  function fmtPrice(cents) {
    if (typeof cents !== "number") return "";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
  }

  function slugify(s) {
    return String(s ?? "")
      .trim()
      .toLowerCase()
      .replace(/['"]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function parseBrowsePath(pathname) {

  const clean = String(pathname || "/").replace(/\/+$/g, "/");
  const parts = clean.split("/").filter(Boolean);
  if (parts[0] !== "browse") return { q: "", page: 1, brand: "", category: "", family: "" };

  let q = "";
  let brand = "";
  let category = "";
  let family = "";
  let page = 1;

  // Find optional trailing /page/<n>
  let end = parts.length;
  if (parts.length >= 4 && parts[parts.length - 2] === "page") {
    const n = parseInt(parts[parts.length - 1], 10);
    if (Number.isFinite(n) && n > 0) page = n;
    end = parts.length - 2;
  }

  // Remaining parts are:
  // ["browse"] OR ["browse", "<q>"] OR ["browse", "<brand>", "category", "<cat>", "family", "<fam>"] etc.
  const core = parts.slice(1, end);

  // Category browse URLs: /browse/category/<category>/ (plus optional /page/<n>/)
  if (core.length >= 2 && core[0] === "category") {
    const cat = decodeURIComponent(core[1] || "");
    category = norm(cat);
    q = category;
    return { q, page, brand: "", category, family: "" };
  }

  if (core.length === 0) {
    return { q: "", page, brand: "", category: "", family: "" };
  }

  // Always treat first segment as the primary text (brand or general q)
  const first = decodeURIComponent(core[0] || "");
  q = norm(first);

  // Optional filters
  for (let i = 1; i < core.length; i += 2) {
    const key = core[i];
    const val = core[i + 1] != null ? decodeURIComponent(core[i + 1]) : "";
    if (key === "category") category = norm(val);
    if (key === "family") family = norm(val);
  }

  // If we have category/family, we consider q to be the brand string
  if (category || family) {
    brand = q;
  }

  return { q, page, brand, category, family };
}

function buildBrowsePath({ q, page, brand, category, family }) {
  const p = Number.isFinite(page) && page > 0 ? page : 1;

  // If brand filter mode, build filter path
  if (brand) {
    let path = `/browse/${encodeURIComponent(brand)}/`;
    if (category) path += `category/${encodeURIComponent(category)}/`;
    if (family) path += `family/${encodeURIComponent(family)}/`;
    if (p > 1) path += `page/${p}/`;
    return path;
  }

  // Category-only mode: /browse/category/<Category>/
  if (category) {
    let path = `/browse/category/${encodeURIComponent(category)}/`;
    if (p > 1) path += `page/${p}/`;
    return path;
  }

  // Otherwise plain q path
  const qq = norm(q);
  if (!qq) return "/browse/";

  const slug = encodeURIComponent(slugify(qq));
  let path = `/browse/${slug}/`;

  if (p > 1) path += `page/${p}/`;
  return path;
}

function readUrl() {
  // Back-compat: if someone comes in with old query-string URLs, translate them once
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

    // Rewrite URL to the new path form immediately (no query string)
    writeUrl({ replace: true });
    return;
  }

    const parsed = parseBrowsePath(location.pathname);
  state.page = parsed.page;

  state.brand = norm(parsed.brand);
  state.category = norm(parsed.category);
  state.family = norm(parsed.family);
  state.familyNorm = state.family.toLowerCase();

  const pathQ = norm(parsed.q);

  // If we are in plain /browse/<slug>/ mode, de-slugify for display + API query.
  // Prefer the persisted typed value when it matches the slug.
  if (!state.brand && !state.category && !state.family) {
    let saved = "";
    try { saved = sessionStorage.getItem("pc_browse_search_value") || ""; } catch (_e) {}
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
}

  function setPager() {
  const pages = Number.isFinite(state.pages) ? state.pages : 1;

  const pager = els.pager();
  const prev = els.prev();
  const next = els.next();

  const shouldShow = pages > 1;

  // Force-hide/show the entire pager container
  if (pager) pager.style.display = shouldShow ? "flex" : "none";

  if (prev) prev.disabled = !shouldShow || state.loading || state.page <= 1;
  if (next) next.disabled = !shouldShow || state.loading || state.page >= pages;
  }

  function hardScrollTop() {
    // No smooth animation, ever
    try {
      document.documentElement.style.scrollBehavior = "auto";
      document.body.style.scrollBehavior = "auto";
    } catch (_e) {}

    // Jump instantly
    window.scrollTo(0, 0);

    // restore (optional)
    try {
      document.documentElement.style.scrollBehavior = "";
      document.body.style.scrollBehavior = "";
    } catch (_e) {}
  }

  function startPageTransitionUI() {
    // Immediately remove old content so there is no “flash” of stale cards
    const grid = els.grid();
    if (grid) {
      grid.innerHTML = "";
      // Also remove any per-card inline delay vars lingering if you ever reuse nodes
      grid.style.removeProperty("--pc-delay");
    }

    // Hide empty states immediately (avoid a brief flicker)
    showInlineEmpty(false);
    showEmpty(false);

    // Clear meta so it doesn’t show stale “Showing X-Y of Z”
    setMeta("");

    // Disable pager buttons immediately
    setLoading(true);

    // Jump to top immediately
    hardScrollTop();
  }

  function setLoading(on) {
    state.loading = !!on;
    setPager();
  }

  function writeUrl({ replace = false } = {}) {
    const path = buildBrowsePath({
      q: state.q,
      page: state.page,
      brand: state.brand,
      category: state.category,
      family: state.family,
    });

    if (replace) history.replaceState({}, "", path);
    else history.pushState({}, "", path);
  }

  async function apiJson(url) {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const txt = await res.text().catch(() => "");
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);

    let data;
    try {
      data = txt ? JSON.parse(txt) : null;
    } catch {
      throw new Error(`Bad JSON from ${url}`);
    }

    if (!data || data.ok !== true) {
      const msg = data && (data.error || data.message) ? String(data.error || data.message) : "API ok:false";
      throw new Error(`${msg} (${url})`);
    }

    return data;
  }

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

  function cardProduct(r, { isFirst = false } = {}) {
    const dashKey = String(r.dashboard_key || "").trim();

    const displayName = r.model_name || r.title || r.model_number || "Untitled";
    const href = dashKey ? dashPathFromKeyAndTitle(dashKey, displayName) : "/dashboard/";

    const img = r.image_url
      ? `<img class="img" src="${r.image_url}" alt="">`
      : `<div class="img ph"></div>`;

    const warn = r.dropship_warning ? `<span class="warn">Dropshipping risk</span>` : "";

    const brand = (r.brand || "").trim();
    const brandLine = brand ? brand : ""; // keep empty if missing

    const enterHint = isFirst
      ? `<span class="kbd pc-enter-kbd" aria-hidden="true">Enter</span>`
      : "";

    return `
      <a class="card item" href="${href}" ${isFirst ? 'data-first-card="1"' : ""}>
        <div class="thumb">
          ${img}
        </div>

        <div class="body">
          <div class="subtitle">${escapeHtml(brandLine)}</div>
          <div class="name">${escapeHtml(displayName)} ${enterHint}</div>
          <div class="price">${fmtPrice(r.best_price_cents)}</div>
          ${warn}
        </div>
      </a>
    `;
  }

  function cardFacet(f) {
    const img = f.image_url
      ? `<img class="img" src="${f.image_url}" alt="">`
      : `<div class="img ph"></div>`;

    const value = String(f.value || "");
    const products = typeof f.products === "number" ? f.products : 0;

    // No "Brand:" / "Category:" prefix, per your request
    return `
      <button type="button" class="card item" data-nav-kind="${f.kind}" data-nav-value="${value.replace(/"/g, "&quot;")}">
        ${img}
        <div class="body">
          <div class="subtitle"></div>
          <div class="name">${value}</div>
          <div class="row2">
            <div class="muted">${products} products</div>
          </div>
        </div>
      </button>
    `;
  }

  function uniqLower(arr) {
    const seen = new Set();
    const out = [];
    for (const v of arr || []) {
      const s = String(v || "").trim();
      if (!s) continue;
      const k = s.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
    return out;
  }

 function uniqFamilies(rows) {
  // Family = model_number (already uppercased by your SQL)
  const seen = new Set();
  const out = [];
  for (const r of rows || []) {
    const fam = String(r && (r.model_number || "")).trim();
    if (!fam) continue;
    const k = fam.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(fam);
  }
  return out;
}

async function loadBrandPanelFacets(reqId) {
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

    const data = await apiJson(`/api/brand_panel?${qs.toString()}`);
    if (reqId !== state.lastReqId) return;

    state.sideCats = Array.isArray(data.categories) ? data.categories : [];
    state.sideFams = Array.isArray(data.families) ? data.families : [];
    state.sideFacetKey = key;
}

async function loadCategoryPanelFacets(reqId) {
  if (!state.category) {
    state.sideBrands = [];
    state.sideBrandsFacetKey = "";
    return;
  }

  const key = state.category.toLowerCase();
  if (state.sideBrandsFacetKey === key && Array.isArray(state.sideBrands) && state.sideBrands.length) return;

  const qs = new URLSearchParams({ category: state.category });
  const data = await apiJson(`/api/category_panel?${qs.toString()}`);
  if (reqId !== state.lastReqId) return;

  state.sideBrands = Array.isArray(data.brands) ? data.brands : [];
  state.sideBrandsFacetKey = key;
}

async function renderCategoryPanel() {
  const side = els.sidecol();
  const panel = els.categoryPanel();
  if (!side || !panel) return;

  const catName = String(state.category || "").trim();
  if (!catName) {
    panel.innerHTML = "";
    panel.hidden = true;
    return;
  }

  const brands = (Array.isArray(state.sideBrands) ? state.sideBrands : []).slice(0, 14);

  const total = Number.isFinite(state.total) ? state.total : 0;
  const resultsLine = total === 1 ? "1 result found" : `${total} results found`;

  panel.hidden = false;
  panel.innerHTML = `
    <h2 class="side-title">${escapeHtml(catName)}</h2>
    <div class="side-sub muted">${escapeHtml(resultsLine)}</div>

    ${brands.length ? `

      <div class="side-block">
        <div class="side-label">Brand</div>
        <div class="pillrow">
          ${brands.map((b) => {
            const active = state.brand && state.brand.toLowerCase() === String(b).toLowerCase();
            return `
              <button type="button" class="pillbtn ${active ? "is-active" : ""}"
                data-side-set="brand" data-side-value="${escapeHtml(b)}">
                ${escapeHtml(b)}
              </button>
            `;
          }).join("")}
        </div>
      </div>
    ` : ""}
  `;
}

async function renderBrandPanel() {
  const side = els.sidecol();
  const panel = els.brandPanel();
  const famPanel = els.familyPanel();
  if (!side || !panel) return;

  const hasCategory = !!String(state.category || "").trim();
  const hasBrand = !!String(state.brand || "").trim();
  const hasFamily = !!String(state.family || "").trim();

  // Show the whole sidebar if any level is active
  side.hidden = !(hasCategory || hasBrand || hasFamily);

  // Brand card only shows when a brand is selected
  if (!hasBrand) {
    panel.innerHTML = "";
    panel.hidden = true;
    if (famPanel) {
      famPanel.innerHTML = "";
      famPanel.hidden = true;
    }
    return;
  }

  panel.hidden = false;

  const brandName = String(state.brand || "").trim();

  const leftAlreadyShowsFacets = Array.isArray(state.also) && state.also.length > 0;

  const cats = leftAlreadyShowsFacets
    ? []
    : (Array.isArray(state.sideCats) ? state.sideCats : []).slice(0, 14);

  const fams = (Array.isArray(state.sideFams) ? state.sideFams : []).slice(0, 12);

  panel.innerHTML = `
    <h2 class="side-title">${escapeHtml(brandName)}</h2>

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

  // Family card below the brand card (only when a family is selected)
  if (famPanel) {
    const famName = String(state.family || "").trim();
    if (famName) {
      famPanel.hidden = false;
      famPanel.innerHTML = `
        <h2 class="side-title">${escapeHtml(famName)}</h2>
      `;
    } else {
      famPanel.innerHTML = "";
      famPanel.hidden = true;
    }
  }
}

  function animateGridCards(gridEl, { animate = true } = {}) {
  if (!gridEl) return;

  const cards = Array.from(gridEl.querySelectorAll(".card.item"));
  if (!cards.length) return;

  if (!animate) {
    // Ensure no entering classes remain
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

  async function render() {
    const grid = els.grid();
    if (!grid) return;

    const q = (state.value || state.q || "").trim();
    const isPaged = state.page > 1;
    let canonical;
    canonical = `${location.origin}${buildBrowsePath({
      q: (state.value || state.q || "").trim(),
      page: 1,
      brand: state.brand,
      category: state.category,
      family: state.family,
    })}`;
    const robots = !q
      ? "noindex,follow"
      : (isPaged ? "noindex,follow" : "index,follow");
    const total = typeof state.total === "number" ? state.total : 0;
    const desc = q
      ? `Browse ${q} on PriceCheck. ${total ? `${total} results.` : ""} Compare products and check the latest prices.`
      : "Browse PriceCheck. Search for a brand, category, or product name.";

    if (state.lastError) {
      setMeta(state.lastError);
      grid.innerHTML = "";
      showInlineEmpty(false);

      setInlineEmptyHtml(`<div class="msg"><span>${escapeHtml(state.lastError)}</span></div>`);
      showInlineEmpty(true);
      showEmpty(false);
      await renderCategoryPanel();
      await renderBrandPanel();

      setPager();
      return;
    }

    const title = q
      ? `${q} Price Comparison and Deals - PriceCheck`
      : "Compare Product Prices Across Stores - PriceCheck";

    setHead({
      title,
      description: desc,
      canonical,
      robots,
    });

    const page = Number.isFinite(state.page) && state.page > 0 ? state.page : 1;
    const limit = Number.isFinite(state.limit) && state.limit > 0 ? state.limit : 0;

    setMeta("");

    const parts = [];

    if (Array.isArray(state.also) && state.also.length) {
      // If the server says "also" (the other facet matched), show clickable facet cards first
      for (const f of state.also) parts.push(cardFacet(f));
    }

    if (Array.isArray(state.results) && state.results.length) {
      for (let i = 0; i < state.results.length; i++) {
        parts.push(cardProduct(state.results[i], { isFirst: i === 0 }));
      }
    }

    grid.innerHTML = parts.join("");
    animateGridCards(grid, { animate: !!state.animateNextRender });
    state.animateNextRender = true;

    if (parts.length === 0) {
  const rawQ = (state.q || "").trim();
  const dym = state.didYouMean && state.didYouMean.value ? state.didYouMean : null;

  if (dym) {
    const shownQ = rawQ ? `"${escapeHtml(rawQ)}"` : "your search";
    const href = String(dym.href || "").trim();

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
    // No suggestion available: keep it minimal
    const shownQ = rawQ ? `"${escapeHtml(rawQ)}"` : "your search";
    setInlineEmptyHtml(`
      <div class="msg">
        <span>No results for <strong>${shownQ}</strong>.</span>
      </div>
    `);
  }

  showInlineEmpty(true);

  // Do not show the big empty card for normal no-results
  showEmpty(false);
} else {
  showInlineEmpty(false);
  showEmpty(false);
}

    await renderCategoryPanel();
    await renderBrandPanel();
    setPager();
  }

  async function load() {
    const reqId = ++state.lastReqId;
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
        setLoading(false);
        setMeta("Search for a brand, category, or product name.");
        const grid = els.grid();
        if (grid) grid.innerHTML = "";
        showEmpty(false);
        setPager();
        return;
      }

      // If brand/category filters exist, use /api/browse
      if (state.brand || state.category) {
        const qs = new URLSearchParams({
          page: String(state.page),
          limit: String(state.limit),
        });
        if (state.brand) qs.set("brand", state.brand);
        if (state.category) qs.set("category", state.category);
        if (state.family) qs.set("family", state.family);
        const data = await apiJson(`/api/browse?${qs.toString()}`);
        if (reqId !== state.lastReqId) return;

        state.kind = data.type || "product";
        state.value = data.value || "";
        state.total = typeof data.total === "number" ? data.total : 0;
        state.pages = typeof data.pages === "number" ? data.pages : 1;
        state.results = Array.isArray(data.results) ? data.results : [];
        state.also = [];
        await loadCategoryPanelFacets(reqId);
        await loadBrandPanelFacets(reqId);
        setLoading(false);
        await render();
        return;
      }

      // Otherwise use /api/search?q=...
      const qs = new URLSearchParams({
        q: state.q,
        page: String(state.page),
        limit: String(state.limit),
      }).toString();

      const data = await apiJson(`/api/search?${qs}`);
      if (reqId !== state.lastReqId) return;

      state.kind = data.kind || "product";
      state.value = data.value || "";
      state.total = typeof data.total === "number" ? data.total : 0;
      state.pages = typeof data.pages === "number" ? data.pages : 1;
      state.results = Array.isArray(data.results) ? data.results : [];
      state.also = Array.isArray(data.also) ? data.also : [];
      state.didYouMean = data.did_you_mean || null;

      // If search resolved to a brand, switch into brand filter mode
      // so the sidebar shows and category pills can work.
      if (state.kind === "brand" && state.value) {
        state.brand = String(state.value).trim();
        state.category = "";
        state.family = "";
        state.familyNorm = "";
        state.q = state.brand;   // keep the pretty /browse/Apple/
        state.page = 1;
        writeUrl({ replace: true }); // becomes /browse/Apple/
      }

      if (state.kind === "category" && state.value) {
        state.category = String(state.value).trim();
        state.brand = "";
        state.family = "";
        state.familyNorm = "";
        state.q = state.category;
        state.page = 1;
        writeUrl({ replace: true }); // becomes /browse/category/<Category>/
      }

      await loadCategoryPanelFacets(reqId);
      await loadBrandPanelFacets(reqId);
      setLoading(false);
      render();
    } catch (e) {
      if (reqId !== state.lastReqId) return;
      state.lastError = e && e.message ? e.message : "Search failed.";
      setLoading(false);
      render();
    }
  }

  function navTo(kind, value) {
    // When a user clicks the "also" facet card, we just set q to that facet value
    // The server will then resolve it as brand/category and return the right list
    state.q = norm(value);
    state.brand = "";
    state.category = "";
    state.page = 1;
    writeUrl({ replace: false });
    load();
  }

    function wire() {
    const prev = els.prev();
    const next = els.next();
    const grid = els.grid();

        if (prev) {
      prev.addEventListener("click", () => {
        if (state.loading || state.page <= 1) return;

        state.page -= 1;

        // Pager navigation should feel instant: no old cards visible, no animation
        state.animateNextRender = false;
        startPageTransitionUI();

        writeUrl({ replace: false });
        load();
      });
    }

    if (next) {
      next.addEventListener("click", () => {
        if (state.loading || state.page >= state.pages) return;

        state.page += 1;

        // Pager navigation should feel instant: no old cards visible, no animation
        state.animateNextRender = false;
        startPageTransitionUI();

        writeUrl({ replace: false });
        load();
      });
    }

    if (grid) {
      grid.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-nav-kind][data-nav-value]");
        if (!btn) return;
        const value = btn.getAttribute("data-nav-value");
        if (!value) return;
        navTo(btn.getAttribute("data-nav-kind") || "product", value);
      });
    }

    const sidecol = els.sidecol();
    if (sidecol) {
      sidecol.addEventListener("click", (e) => {
        const setBtn = e.target.closest("button[data-side-set][data-side-value]");
        if (!setBtn) return;

        const which = String(setBtn.getAttribute("data-side-set") || "");
        const value = norm(setBtn.getAttribute("data-side-value"));
        if (!value) return;

        if (which === "category") {
          const isActive = state.category && state.category.toLowerCase() === value.toLowerCase();

          if (isActive) {
            // Toggle off category -> back to plain brand view
            state.category = "";
            state.family = "";
            state.familyNorm = "";
          } else {
            // Set category, and reset family because families are category-sensitive
            state.category = value;
            state.family = "";
            state.familyNorm = "";
          }

          state.page = 1;
          writeUrl({ replace: false });
          load();
          return;
        }

        if (which === "brand") {
          const isActive = state.brand && state.brand.toLowerCase() === value.toLowerCase();

          if (isActive) {
            // Toggle off brand -> back to category-only view
            state.brand = "";
            state.family = "";
            state.familyNorm = "";
          } else {
            // Set brand while keeping the current category
            state.brand = value;
            state.family = "";
            state.familyNorm = "";
          }

          state.page = 1;
          writeUrl({ replace: false });
          load();
          return;
        }

        if (which === "family") {
          const isActive = state.family && state.family.toLowerCase() === value.toLowerCase();

          if (isActive) {
            // Toggle off family -> keep category if set, otherwise plain brand
            state.family = "";
            state.familyNorm = "";
          } else {
            state.family = value;
            state.familyNorm = value.toLowerCase();
          }

          state.page = 1;
          writeUrl({ replace: false });
          load();
          return;
        }
      });
    }

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;

      // Don’t hijack Enter if user is typing in an input/textarea/select
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.target && e.target.isContentEditable) return;

      if (tag === "button" || tag === "a") return;

      // 1) If our inline did-you-mean is showing, Enter goes there (existing behavior)
      const inline = els.emptyInline();
      if (inline && !inline.hidden) {
        const dym = inline.querySelector('a.pc-dym[data-dym="1"][href]');
        if (!dym) return;
        e.preventDefault();
        location.href = dym.getAttribute("href");
        return;
      }

      // 2) Otherwise, if we have result cards, Enter goes to the first card
      const grid = els.grid();
      if (!grid) return;

      const first = grid.querySelector('a.card.item[data-first-card="1"][href]');
      if (!first) return;

      e.preventDefault();
      first.click(); // triggers normal navigation
    });

    window.addEventListener("popstate", () => {
      readUrl();
      load();
    });
  }

  // Optional SPA entry point for your header search later
  window.pcBrowse = {
    search(raw) {
      state.q = norm(raw);
      state.page = 1;
      writeUrl({ replace: false });
      load();
    },
  };

  document.addEventListener("DOMContentLoaded", () => {
    readUrl();
    wire();
    writeUrl({ replace: true });
    load();
  });
})();