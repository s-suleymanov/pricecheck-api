// public/browse/browse.js
(() => {
  const $ = (s) => document.querySelector(s);
  const norm = (s) => String(s ?? "").trim();

  const els = {
    title: () => $("#title"),
    meta: () => $("#meta"),
    grid: () => $("#grid"),
    empty: () => $("#empty"),
    prev: () => $("#prev"),
    next: () => $("#next"),
    pageLabel: () => $("#pageLabel"),
  };

  const state = {
    q: "",
    page: 1,
    limit: 36,

    // server response
    kind: "product", // "brand" | "category" | "product"
    value: "",
    total: 0,
    pages: 1,
    results: [],
    also: [],

    loading: false,
    lastReqId: 0,
    lastError: "",
  };

  function setText(el, txt) {
    if (el) el.textContent = txt ?? "";
  }

  function setTitle(txt) {
    setText(els.title(), txt || "Browse PriceCheck");
  }

  function setMeta(txt) {
    setText(els.meta(), txt || "");
  }

  function setEmptyText(txt) {
    const el = els.empty();
    if (el) el.textContent = txt || "No results.";
  }

  function showEmpty(show) {
    const el = els.empty();
    if (el) el.hidden = !show;
  }

  function readUrl() {
    const parsed = parseBrowsePath(location.pathname);
    state.q = norm(parsed.q);
    state.page = parsed.page;
  }

  function fmtPrice(cents) {
    if (typeof cents !== "number") return "N/A";
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

  function unslug(s) {
    return String(s ?? "").replace(/-/g, " ").trim();
  }

  function parseBrowsePath(pathname) {
    // Handles:
    // /browse/
    // /browse/segway/
    // /browse/segway/page/2/
    const clean = String(pathname || "/").replace(/\/+$/g, "/");
    const parts = clean.split("/").filter(Boolean); // ["browse", ...]
    if (parts[0] !== "browse") return { q: "", page: 1 };

    const slug = parts[1] || "";
    let page = 1;

    if (parts[2] === "page" && parts[3]) {
      const n = parseInt(parts[3], 10);
      if (Number.isFinite(n) && n > 0) page = n;
    }

    const q = slug ? unslug(decodeURIComponent(slug)) : "";
    return { q, page };
  }

  function buildBrowsePath(rawQ, page) {
    const q = norm(rawQ);
    const p = Number.isFinite(page) && page > 0 ? page : 1;

    if (!q) return "/browse/";

    const slug = encodeURIComponent(slugify(q));
    if (p === 1) return `/browse/${slug}/`;
    return `/browse/${slug}/page/${p}/`;
  }

  function setPager() {
    const label = els.pageLabel();
    setText(label, state.pages ? `Page ${state.page} of ${state.pages}` : "");

    const prev = els.prev();
    const next = els.next();
    if (prev) prev.disabled = state.loading || state.page <= 1;
    if (next) next.disabled = state.loading || state.page >= state.pages;
  }

  function setLoading(on) {
    state.loading = !!on;
    setPager();
  }

  function writeUrl({ replace = false } = {}) {
    const path = buildBrowsePath(state.q, state.page);
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

  function cardProduct(r) {
    const dashKey = String(r.dashboard_key || "").trim();

    const displayName = r.model_name || r.title || r.model_number || "Untitled";
    const href = dashKey ? dashPathFromKeyAndTitle(dashKey, displayName) : "/dashboard/";

    const img = r.image_url
      ? `<img class="img" src="${r.image_url}" alt="">`
      : `<div class="img ph"></div>`;

    const warn = r.dropship_warning ? `<span class="warn">Dropshipping risk</span>` : "";

    const category = (r.category || "").trim();
    const version = (r.version || "").trim();

    // subtitle: category • variant (no brand)
    const subtitle = version
      ? (category ? `${category} • ${version}` : version)
      : category;

    return `
      <a class="card item" href="${href}">
        <div class="thumb">
          ${img}
        </div>

        <div class="body">
          <div class="name">${displayName}</div>
          <div class="subtitle">${subtitle}</div>
        </div>

        <div class="right">
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

function animateGridCards(gridEl) {
  if (!gridEl) return;

  const cards = Array.from(gridEl.querySelectorAll(".card.item"));
  if (!cards.length) return;

  for (let i = 0; i < cards.length; i++) {
    const el = cards[i];
    el.classList.remove("pc-enter-active");
    el.classList.add("pc-enter");

    const delay = Math.min(i * 28, 650);
    el.style.setProperty("--pc-delay", `${delay}ms`);
  }

  // Force a style/layout read so the browser commits pc-enter first
  gridEl.getBoundingClientRect();

  // Two RAFs pushes the "active" flip past the first paint
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      for (const el of cards) el.classList.add("pc-enter-active");
    });
  });
}

  function render() {
    const grid = els.grid();
    if (!grid) return;

    // title behavior:
    // - if server resolved brand/category, show that label
    // - else show the raw query
    const titleText = state.value || state.q || "Browse PriceCheck";
    setTitle(titleText);

    const q = (state.value || state.q || "").trim();
    const isPaged = state.page > 1;
    const canonical = q
      ? `${location.origin}${buildBrowsePath(q, 1)}`
      : `${location.origin}/browse/`;
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
      setEmptyText(state.lastError);
      showEmpty(true);
      setPager();
      return;
    }

    const title = q
      ? `${q} Price Comparison and Deals`
      : "Compare Product Prices Across Stores | PriceCheck";

    setHead({
      title,
      description: desc,
      canonical,
      robots,
    });

    const metaParts = [];
    if (state.total) metaParts.push(`${state.total} products`);
    setMeta(metaParts.join(" • "));

    const parts = [];

    if (Array.isArray(state.also) && state.also.length) {
      // If the server says "also" (the other facet matched), show clickable facet cards first
      for (const f of state.also) parts.push(cardFacet(f));
    }

    if (Array.isArray(state.results) && state.results.length) {
      for (const r of state.results) parts.push(cardProduct(r));
    }

    grid.innerHTML = parts.join("");
    animateGridCards(grid);

    setEmptyText("No results.");
    showEmpty(parts.length === 0);
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

    try {
      if (!state.q) {
        setLoading(false);
        setTitle("Browse PriceCheck");
        setMeta("Search for a brand, category, or product name.");
        const grid = els.grid();
        if (grid) grid.innerHTML = "";
        showEmpty(false);
        setPager();
        return;
      }

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
        writeUrl({ replace: false });
        load();
      });
    }

    if (next) {
      next.addEventListener("click", () => {
        if (state.loading || state.page >= state.pages) return;
        state.page += 1;
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