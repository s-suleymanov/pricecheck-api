// public/browse/browse.js
(() => {
  const $ = (s) => document.querySelector(s);
  const norm = (s) => String(s ?? "").trim();

  const els = {
    title: () => $("#title"),
    meta: () => $("#meta"),
    grid: () => $("#grid"),
    empty: () => $("#empty"),
    emptyInline: () => $("#emptyInline"),
    prev: () => $("#prev"),
    next: () => $("#next"),
    pageLabel: () => $("#pageLabel"),
    pager: () => document.querySelector(".pager"),
  };

  const state = {
    q: "",
    page: 1,
    limit: 36,

    // server response
    kind: "product", // "brand" | "category" | "product"
    value: "",
    brand: "",
    category: "",
    total: 0,
    pages: 1,
    results: [],
    also: [],
    didYouMean: null,

    loading: false,
    lastReqId: 0,
    lastError: "",
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

  function clearEmptyStates() {
    showInlineEmpty(false);
    showEmpty(false); // keeps legacy #empty hidden unless you explicitly show it for errors
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

    function readUrl() {
    // 1) query params (brand/category) take priority
    const sp = new URLSearchParams(location.search);
    const b = norm(sp.get("brand") || "");
    const c = norm(sp.get("category") || "");

    state.brand = b;
    state.category = c;

    // 2) path-based browse (slug/page)
    const parsed = parseBrowsePath(location.pathname);
    state.q = norm(parsed.q);
    state.page = parsed.page;

    // If brand/category is set, we are not using q, and page comes from ?page=
    if (state.brand || state.category) {
      state.q = "";
      const qp = parseInt(sp.get("page") || "1", 10);
      state.page = Number.isFinite(qp) && qp > 0 ? qp : 1;
    }
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
    const pages = Number.isFinite(state.pages) ? state.pages : 1;

    const pager = els.pager();
    const label = els.pageLabel();
    const prev = els.prev();
    const next = els.next();

    const shouldShow = pages > 1;

    // Force-hide/show the entire pager container
    if (pager) pager.style.display = shouldShow ? "flex" : "none";

    setText(label, shouldShow ? `Page ${state.page} of ${pages}` : "");

    if (prev) prev.disabled = !shouldShow || state.loading || state.page <= 1;
    if (next) next.disabled = !shouldShow || state.loading || state.page >= pages;
  }

  function setLoading(on) {
    state.loading = !!on;
    setPager();
  }

  function writeUrl({ replace = false } = {}) {
  let path = buildBrowsePath(state.q, state.page);

  const sp = new URLSearchParams();
    if (state.brand) sp.set("brand", state.brand);
    if (state.category) sp.set("category", state.category);

    // IMPORTANT: when using brand/category filters, put page in the query string
    if (state.brand || state.category) {
      path = "/browse/"; // do not use /browse/{slug}/ in this mode
      if (state.page > 1) sp.set("page", String(state.page));
    }

    const qs = sp.toString();
    if (qs) path += `?${qs}`;

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

    const category = (r.category || "").trim();
    const version = (r.version || "").trim();

    // subtitle: category • variant (no brand)
    const subtitle = version
      ? (category ? `${version} ${category}` : version)
      : category;

    const enterHint = isFirst
      ? `<span class="kbd pc-enter-kbd" aria-hidden="true">Enter</span>`
      : "";

    return `
      <a class="card item" href="${href}" ${isFirst ? 'data-first-card="1"' : ""}>
        <div class="thumb">
          ${img}
        </div>

        <div class="body">
          <div class="name">${displayName} ${enterHint}</div>
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
    let canonical;
    if (state.brand || state.category) {
      const csp = new URLSearchParams();
      if (state.brand) csp.set("brand", state.brand);
      if (state.category) csp.set("category", state.category);
      canonical = `${location.origin}/browse/${csp.toString() ? "?" + csp.toString() : ""}`;
    } else {
      canonical = q
        ? `${location.origin}${buildBrowsePath(q, 1)}`
        : `${location.origin}/browse/`;
    }
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

    const metaParts = [];
    if (state.total) metaParts.push(`${state.total} products`);
    setMeta(metaParts.join(" • "));

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
    animateGridCards(grid);

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
        setTitle("Browse PriceCheck");
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

        const data = await apiJson(`/api/browse?${qs.toString()}`);
        if (reqId !== state.lastReqId) return;

        state.kind = data.type || "product";
        state.value = data.value || "";
        state.total = typeof data.total === "number" ? data.total : 0;
        state.pages = typeof data.pages === "number" ? data.pages : 1;
        state.results = Array.isArray(data.results) ? data.results : [];
        state.also = [];
        setLoading(false);
        render();
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