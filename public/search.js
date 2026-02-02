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
  // Built-in nav destinations
  // -----------------------------
  const BUILTIN_PAGES = [
    { key: "support",  label: "Support",  href: "/support/" },
    { key: "policy",   label: "Privacy Policy", href: "/privacy-policy/" },
    { key: "partners", label: "Partners", href: "/partners/" },
    { key: "overview", label: "Overview", href: "/overview/" }
  ];

  function normalizeBuiltinKey(raw) {
    const t = norm(raw).toLowerCase();
    if (!t) return "";

    // Strip scheme/host if someone pastes a full site URL for your pages
    // Example: https://pricechecktool.com/support -> support
    try {
      if (/^https?:\/\//i.test(t)) {
        const u = new URL(t);
        const p = String(u.pathname || "/").toLowerCase();
        const cleaned = p.replace(/^\/+|\/+$/g, ""); // trim slashes
        return cleaned;
      }
    } catch (_e) {}

    // Strip leading/trailing slashes and collapse spaces
    return t.replace(/^\/+|\/+$/g, "").trim();
  }

  function builtinHrefFromRaw(raw) {
    const k = normalizeBuiltinKey(raw);
    if (!k) return null;
    const hit = BUILTIN_PAGES.find((p) => p.key === k);
    if (!hit) return null;
    return new URL(hit.href, location.origin).toString();
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

    // 0) built-in nav pages first
    const builtinHref = builtinHrefFromRaw(v);
    if (builtinHref) {
      location.href = builtinHref;
      return;
    }

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
      route(inputEl.value);
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
  if (active >= 0) return clearInlineOnly(); // user is navigating, do not inline-complete

  const typed = norm(inlineBase || input.value);
  if (!typed) return clearInlineOnly();

  const top = items[0];
  if (!top || !top.value) return clearInlineOnly();

  const sug = String(top.value).trim();
  if (!sug) return clearInlineOnly();

  const t = typed.toLowerCase();
  const s = sug.toLowerCase();

  // Only inline-complete if suggestion starts with what user typed
  if (!s.startsWith(t)) return clearInlineOnly();

  if (sug.length === typed.length) return clearInlineOnly();

  // Apply: set full suggestion, select the autocompleted tail
  input.value = sug;
  try {
    input.setSelectionRange(typed.length, sug.length);
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
                <div class="pc-ac__label">${escapeHtml(String(it.value || ""))}</div>
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

      close();

      if (it.href) {
        location.href = String(it.href);
        return;
      }

      // Otherwise, put the chosen label in the input, then route normally
      input.value = String(it.value || "").trim();
      route(input.value);
    }

    function builtinMatches(q) {
      const qq = norm(q).toLowerCase();
      if (!qq) return [];

      // Show built-ins on prefix match: "sup" -> Support
      return BUILTIN_PAGES
        .filter((p) => p.key.startsWith(qq) || p.label.toLowerCase().startsWith(qq))
        .map((p) => ({
          kind: "page",
          value: p.label,
          href: new URL(p.href, location.origin).toString(),
        }));
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
          .slice(0, maxItems);

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

      const builtins = builtinMatches(qq);

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
          .slice(0, maxItems);

        // Merge: built-in pages first, then API facets, keep within maxItems
        const merged = [];
        for (const b of builtins) merged.push(b);
        for (const f of facets) merged.push(f);

        // Dedup by (kind + value) just in case
        const seen = new Set();
        items = merged.filter((it) => {
          const k = `${it.kind}::${String(it.value || "").toLowerCase()}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        }).slice(0, maxItems);

        active = -1;
        render();
        applyInlineTopSuggestion();
      } catch (e) {
        if (String(e?.name) === "AbortError") return;
        console.error(e);

        // If API fails, still show built-ins if any
        const onlyBuiltins = builtinMatches(qq).slice(0, maxItems);
        items = onlyBuiltins;
        active = -1;
        render();
      }
    }

    const debouncedFetch = debounce(fetchSuggestions, 120);

    input.setAttribute("autocomplete", "off");
    input.setAttribute("aria-controls", box.id);
    input.setAttribute("aria-expanded", "false");

    input.addEventListener("input", () => {
    inlineBase = input.value;
    inlineOn = false;

      if (!norm(input.value)) {
        fetchPopular();
        return;
      }

      debouncedFetch(input.value);
    });

        input.addEventListener("focus", () => {
      if (!norm(input.value)) {
        fetchPopular();
      } else {
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

  window.pcSearch = { route, bindForm, shouldGoDashboard, attachAutocomplete };

// Auto-wire: attach autocomplete + submit routing on common inputs
document.addEventListener("DOMContentLoaded", () => {
  const input =
    document.querySelector(".nav-search__input") ||
    document.querySelector(".home-search__input") ||
    document.querySelector('input[type="search"]');

  if (!input) return;

  const form = input.closest("form");
  if (form) bindForm(form, input);

  attachAutocomplete(input, { endpoint: "/api/suggest", limit: 8 });

  // Auto-focus the search box on page load (fast typing, no click)
  // Do not steal focus if something else is already focused.
  if (document.activeElement && document.activeElement !== document.body) return;

  // Wait 1 frame so layout is ready, then focus without scrolling.
  requestAnimationFrame(() => {
    // If it's hidden (rare), do nothing
    const rect = input.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    try {
      input.focus({ preventScroll: true });
    } catch {
      input.focus();
    }

    // Put caret at end (helpful if browser autofills or restores value)
    try {
      const v = String(input.value || "");
      input.setSelectionRange(v.length, v.length);
    } catch {}
  });
});

})();