// public/partials/partials.js
(async () => {
  // -----------------------------
  // PriceCheck+ click toast (global)
  // -----------------------------

  let _pcPlusToastTimer = 0;

  function getPlusToastEl() {
    // Prefer the toast that ships with your header partial
    let el = document.getElementById("pcPlusToast");
    if (el) return el;

    // Fallback if some page does not include the header
    el = document.createElement("div");
    el.id = "pcPlusToast";
    el.className = "pc-plus-toast";
    el.hidden = true;
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
    return el;
  }

  function showPlusToast(msg = "A PriceCheck+ feature") {
    try {
      const el = getPlusToastEl();
      el.textContent = String(msg || "A PriceCheck+ feature");
      el.hidden = false;

      // restart animation
      el.classList.remove("is-show");
      void el.offsetHeight;
      el.classList.add("is-show");

      if (_pcPlusToastTimer) clearTimeout(_pcPlusToastTimer);

      _pcPlusToastTimer = window.setTimeout(() => {
        el.classList.remove("is-show");
        _pcPlusToastTimer = window.setTimeout(() => {
          el.hidden = true;
          el.textContent = "";
        }, 250);
      }, 5000);
    } catch (_e) {}
  }

  function wirePlusClicks() {
    // bind once per page load
    if (document.body && document.body._pcPlusClicksBound) return;
    if (document.body) document.body._pcPlusClicksBound = true;

    // Any element you mark with data-pc-plus="1" will show the toast on click
    const els = Array.from(document.querySelectorAll('[data-pc-plus="1"]'));
    for (const el of els) {
      if (el._pcPlusBound) continue;
      el._pcPlusBound = true;

      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        showPlusToast("A PriceCheck+ feature");
      });
    }
  }

  function wireHeaderSearch() {
    const form = document.querySelector('header.nav form.nav-search');
    const input = document.querySelector('header.nav input.nav-search__input');
    const logo = document.querySelector('header.nav a.logo-head');

    if (logo) {
      logo.addEventListener("click", (e) => {
        // allow open-in-new-tab behavior
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;

        try {
          sessionStorage.setItem("pc_clear_search_once", "1");
        } catch (_e) {}
        // Do NOT touch input.value here.
      });
    }

    if (!form || !input) return;

    if (form._pcHeaderSearchBound) return;
      form._pcHeaderSearchBound = true;

    function browseValueFromUrl() {
      // Back-compat: old query-string URLs
      const sp = new URLSearchParams(location.search);
      const brand = String(sp.get("brand") || "").trim();
      const category = String(sp.get("category") || "").trim();
      if (brand) return brand;
      if (category) return category;

      const parts = String(location.pathname || "/").split("/").filter(Boolean);
      if (parts[0] !== "browse") return "";

      // /browse/category/<category>/...
      if (parts[1] === "category") {
        let cat = parts[2] || "";
        try { cat = decodeURIComponent(cat); } catch (_e) {}
        return String(cat || "").trim();
      }

      // /browse/<brand>/category/<category>/... or /browse/<brand>/family/<family>/...
      if (parts.length >= 2) {
        let first = parts[1] || "";
        try { first = decodeURIComponent(first); } catch (_e) {}

        const next = String(parts[2] || "").toLowerCase();
        if (next === "category" || next === "family" || next === "page") {
          // This is a brand-filter URL, show the brand in the header search.
          return String(first || "").trim();
        }

        // Otherwise /browse/<slug>/, de-slugify for display.
        return String(first || "").replace(/-/g, " ").trim();
      }

      return "";
    }

    const p = (location.pathname || "/").toLowerCase();
    const onBrowse = p === "/browse" || p === "/browse/" || p.startsWith("/browse/");

    if (onBrowse) {
      const v = browseValueFromUrl();
      const vv = String(v || "").toLowerCase();
      input.value = vv;

      // Keep session persistence aligned with what the URL says
      try {
        if (vv) sessionStorage.setItem("pc_browse_search_value", vv);
        else sessionStorage.removeItem("pc_browse_search_value");
      } catch (_e) {}

      try { input.setSelectionRange(input.value.length, input.value.length); } catch (_e) {}
    } else {
      input.value = "";
      try { input.setSelectionRange(0, 0); } catch (_e) {}
    }

    if (!window.pcSearch) {
      console.warn("pcSearch missing. Include /search.js before /partials/partials.js");
      return;
    }

    window.pcSearch.bindForm(form, input);

    // Autocomplete is safe to attach here too.
    window.pcSearch.attachAutocomplete(input, { endpoint: "/api/suggest", limit: 8 });

    // Let search.js decide whether to restore (browse-only).
    window.pcSearch.restoreInputValue?.(input, { force: false });
  }

    function wireBrowseTabs() {
    const tabsBar = document.getElementById("pcBrowseTabs");
    if (!tabsBar) return;

    // Show only on browse pages
    const p = String(location.pathname || "/").toLowerCase();
    const shouldShow = (p === "/browse" || p === "/browse/" || p.startsWith("/browse/"));


    // Let CSS know whether tabs are visible (used to remove header border + spacing)
    document.body.classList.toggle("has-pc-tabs", shouldShow);

    tabsBar.hidden = !shouldShow;
    if (!shouldShow) return;

    const header = document.querySelector("header.nav");

    function setNavHeightVar(){
      if (!header) return;
      const h = Math.round(header.getBoundingClientRect().height);
      document.documentElement.style.setProperty("--pc-nav-h", `${h}px`);
    }

    setNavHeightVar();

    if (!tabsBar._pcNavHeightBound) {
      tabsBar._pcNavHeightBound = true;
      let raf = 0;
      window.addEventListener("resize", () => {
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(setNavHeightVar);
      }, { passive: true });
    }

        // Results count on the far right of the tabs bar (browse only)
    const countEl = tabsBar.querySelector("#pcTabsCount");

    function setTabsResultsCount(total, { show = true } = {}) {
      if (!countEl) return;

      const p2 = String(location.pathname || "/").toLowerCase();
      const onBrowse2 = p2.startsWith("/browse/");

      // Only show this on browse pages
      if (!onBrowse2 || !show || !Number.isFinite(total)) {
        countEl.hidden = true;
        countEl.textContent = "";
        return;
      }

      const n = Math.max(0, total | 0);
      countEl.textContent = n === 1 ? "1 result found" : `${n} results found`;
      countEl.hidden = false;
    }

    // Listen for browse.js updates (avoid double-binding)
    if (!window.__pcTabsResultsBound) {
      window.__pcTabsResultsBound = true;

      window.addEventListener("pc:browse_results", (ev) => {
        const d = ev && ev.detail ? ev.detail : {};
        const total = typeof d.total === "number" ? d.total : NaN;
        const show = d.show !== false;
        setTabsResultsCount(total, { show });
      });
    }

    setTabsResultsCount(NaN, { show: false });

    // Always force Prices active, no switching yet
    const tabs = Array.from(tabsBar.querySelectorAll(".pc-tab"));
    for (const t of tabs) {
      t.classList.remove("is-active");
      t.classList.add("is-disabled");
      t.removeAttribute("aria-current");
    }

    const prices = tabsBar.querySelector('.pc-tab[data-pc-tab="prices"]');
    if (prices) {
      prices.classList.add("is-active");
      prices.classList.remove("is-disabled");
      prices.setAttribute("aria-current", "page");
    }

  if (!tabsBar._pcClickBound) {
    tabsBar._pcClickBound = true;

    tabsBar.addEventListener("click", (e) => {
      const a = e.target.closest(".pc-tab");
      if (!a) return;

      // Always block navigation for now
      e.preventDefault();
      e.stopPropagation();

      // If it's disabled, show toast
      if (a.classList.contains("is-disabled")) {
        showPlusToast("A PriceCheck+ Feature");
      }
    });
  }

    // Sticky detection without sentinel: toggle when tabs reach the nav bottom
    if (!tabsBar._pcStickyReady) {
      tabsBar._pcStickyReady = true;

      const root = document.documentElement;

      const updateStuck = () => {
        // If tabs are hidden, ensure class is off
        if (tabsBar.hidden) {
          document.body.classList.remove("pc-tabs-stuck");
          tabsBar.classList.remove("is-stuck");
          return;
        }

        const navHStr = getComputedStyle(root).getPropertyValue("--pc-nav-h");
        const navH = Math.max(0, parseFloat(navHStr) || 0);

        // tabsBar is "stuck" when its top is at/above the sticky top line
        const r = tabsBar.getBoundingClientRect();
        const stuck = (window.scrollY > 30) && (r.top <= (navH + 0.5));

        tabsBar.classList.toggle("is-stuck", stuck);
        document.body.classList.toggle("pc-tabs-stuck", stuck);
      };

      let raf = 0;
      const onScroll = () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          updateStuck();
        });
      };

      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onScroll, { passive: true });

      // Run once after layout settles (important with margin-top:-20px)
      requestAnimationFrame(updateStuck);
    }
  }

  async function loadPartial(mountId, url) {
    const mount = document.getElementById(mountId);
    if (!mount) return false;

    try {
      const res = await fetch(url, { cache: "default" });
      if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
      mount.innerHTML = await res.text();
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  }

  const [headerOk, footerOk] = await Promise.all([
    loadPartial("site-header", "/partials/header.html"),
    loadPartial("site-footer", "/partials/footer.html"),
  ]);

  if (headerOk) {
    wireHeaderSearch();
    wireBrowseTabs();
    wirePlusClicks(); // makes AI click toast work on every page
  }
})();