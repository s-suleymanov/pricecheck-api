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

  function fmtPrice(cents) {
    if (typeof cents !== "number") return "N/A";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
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

  function readUrl() {
    const u = new URL(location.href);
    state.q = norm(u.searchParams.get("q") || "");
    const p = parseInt(u.searchParams.get("page") || "1", 10);
    state.page = Number.isFinite(p) && p > 0 ? p : 1;
  }

  function writeUrl({ replace = false } = {}) {
    const u = new URL(location.href);
    if (state.q) u.searchParams.set("q", state.q);
    else u.searchParams.delete("q");
    u.searchParams.set("page", String(state.page));

    if (replace) history.replaceState({}, "", u);
    else history.pushState({}, "", u);
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

  function setHead({ title, description, canonical } = {}) {
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
  }

  function cardProduct(r) {
    const dashKey = r.dashboard_key || "";
    const href = dashKey ? `/dashboard/?key=${encodeURIComponent(dashKey)}` : "/dashboard/";

    const img = r.image_url
      ? `<img class="img" src="${r.image_url}" alt="">`
      : `<div class="img ph"></div>`;

    const warn = r.dropship_warning ? `<span class="warn">Dropshipping risk</span>` : "";

    const brand = (r.brand || "").trim();
    const category = (r.category || "").trim();
    const version = (r.version || "").trim();

    // brand/category: no dot, just a space
    const bc = [brand, category].filter(Boolean).join(" ").trim();

    // add dot only before variant (version)
    const subtitle = version ? (bc ? `${bc} • ${version}` : version) : bc;

    const name = r.model_name || r.title || r.model_number || "Untitled";

    return `
      <a class="card item" href="${href}">
        <div class="thumb">
          ${img}
        </div>

        <div class="body">
          <div class="subtitle">${subtitle}</div>
          <div class="name">${name}</div>
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

  function render() {
    const grid = els.grid();
    if (!grid) return;

    // title behavior:
    // - if server resolved brand/category, show that label
    // - else show the raw query
    const titleText = state.value || state.q || "Browse PriceCheck";
    setTitle(titleText);

    const q = (state.value || state.q || "").trim();
    const canonical = q
      ? `${location.origin}/browse/?q=${encodeURIComponent(q)}`
      : `${location.origin}/browse/`;

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