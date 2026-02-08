// public/search.js
(() => {
  const norm = (s) => String(s ?? "").trim();
  const digitsOnly = (s) => norm(s).replace(/\D/g, "");
  const up = (s) => norm(s).toUpperCase();

  function slugify(s) {
    return String(s ?? "")
      .trim()
      .toLowerCase()
      .replace(/['"]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function browseUrl(raw) {
    const v = norm(raw);
    if (!v) return new URL("/browse/", location.origin).toString();
    const slug = encodeURIComponent(slugify(v));
    return new URL(`/browse/${slug}/`, location.origin).toString();
  }

  function isPci(s) {
    const t = norm(s);
    // your PCI rule: 8 chars, first letter, must contain at least one digit
    return /^[A-Z][A-Z0-9]{7}$/i.test(t) && /\d/.test(t);
  }

    // -----------------------------
  // Browse-only persistence
  // -----------------------------
  const STORAGE_KEY = "pc_browse_search_value";

  function isBrowsePage() {
    const p = (location.pathname || "/").toLowerCase();
    return p === "/browse/" || p.startsWith("/browse/");
  }

  function safeGetSession(key) {
    try { return sessionStorage.getItem(key); } catch { return null; }
  }
  function safeSetSession(key, val) {
    try { sessionStorage.setItem(key, val); } catch {}
  }
  function safeDelSession(key) {
    try { sessionStorage.removeItem(key); } catch {}
  }

  // If the user clicked the logo, clear persisted search exactly once.
  function consumeClearOnceFlag() {
    const v = safeGetSession("pc_clear_search_once");
    if (v === "1") {
      safeDelSession("pc_clear_search_once");
      safeDelSession(STORAGE_KEY);
      return true;
    }
    return false;
  }

  function persistBrowseValue(raw) {
    consumeClearOnceFlag();

    const v = norm(raw);
    if (!v) return;
    if (dashboardKeyFromRaw(v)) return;

    safeSetSession(STORAGE_KEY, v.toLowerCase());
  }

  function readPersistedBrowseValue() {
    return safeGetSession(STORAGE_KEY) || "";
  }

  // Public helper used by partials.js after header loads.
  function restoreInputValue(inputEl, opts = {}) {
    const input = inputEl;
    if (!input) return;

    // Always consume the clear-once flag early, so we do not restore after logo click.
    consumeClearOnceFlag();

    if (!isBrowsePage()) return;

    // Only restore if empty unless force=true
    const force = !!opts.force;
    if (!force && norm(input.value)) return;

    const saved = readPersistedBrowseValue();
    if (!saved) return;

    const s = String(saved || "").toLowerCase();
    input.value = s;
    try {
      input.setSelectionRange(s.length, s.length);
    } catch {}
  }

  // Derive a normalized dashboard key from any input: prefix form, raw ID, or URL.
  function dashboardKeyFromRaw(raw) {
    const t = norm(raw);
    if (!t) return null;

    // 1) explicit prefixes (normalize aliases)
    const m = t.match(/^(asin|upc|pci|tcin|bby|bestbuy|sku|wal|walmart|target)\s*:\s*(.+)$/i);
    if (m) {
      const pref = m[1].toLowerCase();
      const rest = norm(m[2]);

      if (!rest) return null;
      if (pref === "bestbuy" || pref === "sku") return `bby:${digitsOnly(rest) || rest}`;
      if (pref === "walmart") return `wal:${digitsOnly(rest) || rest}`;
      if (pref === "target") return `tcin:${digitsOnly(rest) || rest}`;
      if (pref === "asin") return `asin:${up(rest)}`;
      if (pref === "upc") return `upc:${digitsOnly(rest) || rest}`;
      if (pref === "pci") return `pci:${up(rest)}`;
      return `${pref}:${rest}`;
    }

    // 2) URL parsing for major stores (do not treat https: as a key)
    const am =
      t.match(/\/dp\/([A-Z0-9]{10})/i) ||
      t.match(/\/gp\/product\/([A-Z0-9]{10})/i);
    if (am) return `asin:${up(am[1])}`;

    const tg = t.match(/target\.com\/.+\/(?:-|A-)?(\d{8})/i);
    if (tg) return `tcin:${tg[1]}`;

    const bb = t.match(/bestbuy\.com\/.+\/(\d{6,8})/i);
    if (bb) return `bby:${bb[1]}`;

    const wm = t.match(/walmart\.com\/.+\/(\d{6,12})/i);
    if (wm) return `wal:${wm[1]}`;

    // 3) raw ID shapes
    const d = digitsOnly(t);

    // ASIN: any 10 alnum with at least one digit (not only starting with B)
    if (/^[A-Z0-9]{10}$/i.test(t) && /\d/.test(t)) return `asin:${up(t)}`;

    // PCI
    if (isPci(t)) return `pci:${up(t)}`;

    // UPC/EAN/GTIN
    if (/^\d{12,14}$/.test(d)) return `upc:${d}`;

    // TCIN
    if (/^\d{8}$/.test(d)) return `tcin:${d}`;

    // Best Buy SKU-ish
    if (/^\d{6,8}$/.test(d)) return `bby:${d}`;

    // Walmart itemId-ish
    if (/^\d{6,12}$/.test(d)) return `wal:${d}`;

    return null;
  }

  function shouldGoDashboard(raw) {
    return !!dashboardKeyFromRaw(raw);
  }

  function dashboardUrlFromKey(key) {
    const k = norm(key);
    if (!k) return new URL("/dashboard/", location.origin).toString();
    const i = k.indexOf(":");
    if (i === -1) return new URL("/dashboard/", location.origin).toString();

    const kind = k.slice(0, i).trim().toLowerCase();
    const value = k.slice(i + 1).trim();
    if (!kind || !value) return new URL("/dashboard/", location.origin).toString();

    return new URL(`/dashboard/${kind}/${encodeURIComponent(value)}/`, location.origin).toString();
  }

  function route(raw) {
    const v = norm(raw);
    if (!v) return;

    // 1) dashboard keys
    const key = dashboardKeyFromRaw(v);
    if (key) {
      location.href = dashboardUrlFromKey(key);
      return;
    }

    // 2) browse fallback
    location.href = browseUrl(v);
  }

  function bindForm(formEl, inputEl) {
    if (!formEl || !inputEl) return;

    formEl.addEventListener("submit", (e) => {
      e.preventDefault();

      const v = norm(inputEl.value);
      if (!v) return;

      // Persist only if this search will go to browse (destination-based).
      persistBrowseValue(v);

      route(v);
    });
  }

  function debounce(fn, ms) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function attachAutocomplete(inputEl, opts = {}) {
    const input = inputEl;
    if (!input) return;

    const endpoint = String(opts.endpoint || "/api/suggest");
    const maxItems = Number(opts.limit || 8);
    let inlineBase = "";     // what the user actually typed
    let inlineOn = false;    // whether we currently have an inline completion applied

    // Ensure parent is positioned
    const parent =
      input.closest(".nav-search") ||
      input.closest(".home-search") ||
      input.parentElement;
    if (parent && getComputedStyle(parent).position === "static") {
      parent.style.position = "relative";
    }

    // Build / reuse dropdown
    let box = parent.querySelector(".pc-ac");
    if (!box) {
      box = document.createElement("div");
      box.className = "pc-ac";
      box.hidden = true;
      parent.appendChild(box);
    }

    box.setAttribute("role", "listbox");
    if (!box.id) box.id = "pc-ac-" + Math.random().toString(36).slice(2);

    let items = [];
    let active = -1;
    let lastQ = "";
    let aborter = null;

    function caretAtEnd() {
  try {
    return input.selectionStart === input.selectionEnd && input.selectionEnd === input.value.length;
  } catch {
    return true;
  }
}

function clearInlineOnly() {
  inlineOn = false;
  inlineBase = "";
}

    function applyInlineTopSuggestion() {
      if (!items.length) return clearInlineOnly();
      if (!caretAtEnd()) return clearInlineOnly();
      if (active >= 0) return clearInlineOnly();

      const typedRaw = String(inlineBase || input.value || "");
      const typed = typedRaw.trim();
      if (!typed) return clearInlineOnly();

      const top = items[0];
      if (!top) return clearInlineOnly();

      const sug = String(top.fill || top.value || "").trim().toLowerCase();
      if (!sug) return clearInlineOnly();

      const t = typed.toLowerCase();
      const s = sug; // already lower

      if (!s.startsWith(t)) return clearInlineOnly();
      if (s.length === t.length) return clearInlineOnly();

      // Preserve whatever the user typed for the prefix, but force the completion tail lowercase.
      const filled = typedRaw + sug.slice(typedRaw.length);

      input.value = filled;
      try {
        input.setSelectionRange(typedRaw.length, filled.length);
      } catch {}

      inlineOn = true;
    }

    function close() {
      parent.classList.remove("is-open");
      box.hidden = true;
      box.innerHTML = "";
      items = [];
      active = -1;
      input.removeAttribute("aria-activedescendant");
      input.setAttribute("aria-expanded", "false");
    }

    function openIfAny() {
      parent.classList.toggle("is-open", items.length > 0);
      box.hidden = items.length === 0;
      input.setAttribute("aria-expanded", items.length ? "true" : "false");
    }

    function render() {
      if (items.length === 0) return close();

      box.innerHTML = items
        .map((it, idx) => {
          const id = `${box.id}-opt-${idx}`;
          const isPage = it.kind === "page";
          const pill =
            it.kind === "brand" ? "Brand" :
            it.kind === "category" ? "Category" :
            it.kind === "combo" ? "Filter" :
            "Page";

          const count = Number(it.products || 0);
          const countText = !isPage && count > 0 ? `${count}` : "";
          const cls = idx === active ? "pc-ac__item is-active" : "pc-ac__item";

          return `
            <div class="${cls}" role="option" id="${id}" data-idx="${idx}" aria-selected="${idx === active}">
              <div class="pc-ac__left">
                <div class="pc-ac__label">${escapeHtml(String(it.value || "").toLowerCase())}</div>
              </div>
              <div class="pc-ac__meta">
                <span class="pc-ac__pill">${pill}</span>
                ${countText ? `<span class="pc-ac__count">${countText}</span>` : ""}
              </div>
            </div>
          `;
        })
        .join("");

      openIfAny();

      if (active >= 0) {
        input.setAttribute("aria-activedescendant", `${box.id}-opt-${active}`);
      }
    }

    function setActive(idx) {
      const n = items.length;
      if (n === 0) return;
      active = Math.max(0, Math.min(n - 1, idx));
      render();
    }

    function pick(idx) {
      const it = items[idx];
      if (!it) return;

      const display = String(it.value || "").trim();
      const chosen = String(it.fill || it.value || "").trim().toLowerCase();

      if (chosen) input.value = chosen;

      close();

      if (it.href) {
        // Persist only if this suggestion goes to browse.
        try {
          const u = new URL(String(it.href), location.origin);
          const p = (u.pathname || "/").toLowerCase();
          const isBrowseHref = p === "/browse/" || p.startsWith("/browse/");
          if (isBrowseHref && chosen) persistBrowseValue(chosen);
        } catch (_e) {}

        location.href = String(it.href);
        return;
      }

      if (chosen) persistBrowseValue(chosen);
      route(chosen);
    }

    async function fetchPopular() {
      // Only show popular when input is empty
      if (norm(input.value)) return;

      const qKey = "__popular__";
      if (qKey === lastQ) return;
      lastQ = qKey;

      if (aborter) aborter.abort();
      aborter = new AbortController();

      try {
        const url = new URL(endpoint, location.origin);
        url.searchParams.set("popular", "1");
        url.searchParams.set("limit", String(maxItems));

        const res = await fetch(url.toString(), { signal: aborter.signal, cache: "no-store" });
        if (!res.ok) throw new Error(`popular ${res.status}`);
        const data = await res.json();

        const api = Array.isArray(data?.results) ? data.results : [];
        items = api
          .filter((x) => x && (x.kind === "brand" || x.kind === "category") && x.value)
          .slice(0, maxItems)
          .map((x) => ({
            ...x,
            fill: String(x.value || "").trim().toLowerCase(),
          }));

        active = -1;
        render();
        clearInlineOnly(); // do not inline-complete for popular
      } catch (e) {
        if (String(e?.name) === "AbortError") return;
        console.error(e);
        close();
      }
    }

    async function fetchSuggestions(q) {
      const qq = norm(q);
      if (!qq) return close();

      if (qq === lastQ) return;
      lastQ = qq;

      if (aborter) aborter.abort();
      aborter = new AbortController();

      try {
        const url = new URL(endpoint, location.origin);
        url.searchParams.set("q", qq);
        url.searchParams.set("limit", String(maxItems));

        const res = await fetch(url.toString(), { signal: aborter.signal, cache: "no-store" });
        if (!res.ok) throw new Error(`suggest ${res.status}`);
        const data = await res.json();

        const api = Array.isArray(data?.results) ? data.results : [];

        const facets = api
          .filter((x) =>
            x &&
            (x.kind === "brand" || x.kind === "category" || x.kind === "combo") &&
            x.value
          )
          .slice(0, maxItems)
          .map((x) => ({
            ...x,
            fill: String(x.value || "").trim().toLowerCase(),
          }));

        // No built-in pages. Use API facets only.
        const seen = new Set();
        items = facets
          .filter((it) => {
            const k = `${it.kind}::${String(it.value || "").toLowerCase()}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          })
          .slice(0, maxItems);

        active = -1;
        render();
        applyInlineTopSuggestion();
      } catch (e) {
        if (String(e?.name) === "AbortError") return;
        console.error(e);

        close();
      }
    }

    const debouncedFetch = debounce(fetchSuggestions, 120);

    input.setAttribute("autocomplete", "off");
    input.setAttribute("aria-controls", box.id);
    input.setAttribute("aria-expanded", "false");
    restoreInputValue(input, { force: false });

    input.addEventListener("input", () => {
    inlineBase = input.value;
    inlineOn = false;

      if (!norm(input.value)) {
        fetchPopular();
        return;
      }

      debouncedFetch(input.value);
    });

      function isHomeDesktop() {
  const p = (location.pathname || "/").toLowerCase();
  const isHome = p === "/" || p === "/index.html";

  const desktop = window.matchMedia
    ? window.matchMedia("(min-width: 821px)").matches
    : window.innerWidth >= 821;

    return isHome && desktop;
  }

  function isHomeInput() {
    return input.classList.contains("home-search__input");
  }

  input.addEventListener("focus", () => {
    // Only auto-open popular on DESKTOP HOMEPAGE input
    if (isHomeDesktop() && isHomeInput()) {
      if (!norm(input.value)) {
        fetchPopular();
      } else {
        debouncedFetch(input.value);
      }
      return;
    }

    // Everywhere else: only suggest if user already typed/pasted
    if (norm(input.value)) {
      debouncedFetch(input.value);
    }
  });

    input.addEventListener("keydown", (e) => {
      // Accept inline completion with Tab or ArrowRight
      if (inlineOn && (e.key === "Tab" || e.key === "ArrowRight")) {
        e.preventDefault();
        try {
          input.setSelectionRange(input.value.length, input.value.length);
        } catch {}
        clearInlineOnly();
        return;
      }

      // Cancel inline completion (revert to what user typed) with Escape
      if (inlineOn && e.key === "Escape") {
        e.preventDefault();
        input.value = inlineBase || "";
        try {
          input.setSelectionRange(input.value.length, input.value.length);
        } catch {}
        clearInlineOnly();
        close();
        return;
      }

      if (box.hidden) {
        if (e.key === "ArrowDown") {
          if (!norm(input.value)) fetchPopular();
          else debouncedFetch(input.value);
        }
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive(active < 0 ? 0 : active + 1);
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive(active < 0 ? items.length - 1 : active - 1);
        return;
      }

      if (e.key === "Enter") {
        if (active >= 0) {
          e.preventDefault();
          pick(active);
        }
        return;
      }
    });

    box.addEventListener("mousedown", (e) => {
      // prevent input blur before click processes
      e.preventDefault();
    });

    box.addEventListener("click", (e) => {
      const el = e.target.closest("[data-idx]");
      if (!el) return;
      const idx = Number(el.getAttribute("data-idx"));
      if (!Number.isFinite(idx)) return;
      pick(idx);
    });

    document.addEventListener("click", (e) => {
      if (e.target === input) return;
      if (box.contains(e.target)) return;
      close();
    });

    input.addEventListener("blur", () => {
      // click handler uses mousedown preventDefault, so blur usually means real blur
      setTimeout(() => close(), 0);
    });

    // small HTML escape
    function escapeHtml(s) {
      return String(s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }

    return { close };
  }

    window.pcSearch = { route, bindForm, shouldGoDashboard, attachAutocomplete, restoreInputValue };

// Auto-wire: bind + autocomplete on any visible search inputs.
// Auto-focus is homepage-only and only for the input that opts in.
document.addEventListener("DOMContentLoaded", () => {
  // Only auto-wire the homepage search input here.
  // The header search is injected later via partials and wired in partials.js.
  const homeInputs = Array.from(document.querySelectorAll(".home-search__input"));

  for (const input of homeInputs) {
    const form = input.closest("form");
    if (form) bindForm(form, input);
    attachAutocomplete(input, { endpoint: "/api/suggest", limit: 8 });
  }

  // -----------------------------
  // Auto-focus + auto-open: HOME DESKTOP ONLY
  // -----------------------------
  const path = (location.pathname || "/").toLowerCase();
  const isHome = path === "/" || path === "/index.html";

  // Treat "mobile viewpoint" as a narrow layout (you can tune 820 if you want)
  const isDesktopViewport = () => {
    // matchMedia is best because it tracks viewport changes reliably
    if (window.matchMedia) return window.matchMedia("(min-width: 821px)").matches;
    return window.innerWidth >= 821;
  };

  // Only run homepage auto behaviors on desktop
  const allowHomeAuto = isHome && isDesktopViewport();
  if (!allowHomeAuto) return;

  // Only focus the homepage input that explicitly opts in
  const homeInput = document.querySelector('.home-search__input[data-pc-autofocus="1"]');
  if (!homeInput) return;

  // Do not steal focus if something else is already focused
  const ae = document.activeElement;
  if (ae && ae !== document.body && ae !== document.documentElement) return;

  requestAnimationFrame(() => {
    const rect = homeInput.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    try {
      homeInput.focus({ preventScroll: true });
    } catch {
      homeInput.focus();
    }

    try {
      const v = String(homeInput.value || "");
      homeInput.setSelectionRange(v.length, v.length);
    } catch {}
    homeInput.dispatchEvent(new Event("focus"));
  });
});

})();