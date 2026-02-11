// public/partials/partials.js
(async () => {
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
    const onBrowse = p === "/browse/" || p.startsWith("/browse/");

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

    // Important: avoid double-binding if search.js also runs on this page.
    // We'll let partials.js be the only place that wires the header input.
    window.pcSearch.bindForm(form, input);

    // Autocomplete is safe to attach here too.
    window.pcSearch.attachAutocomplete(input, { endpoint: "/api/suggest", limit: 8 });

    // Let search.js decide whether to restore (browse-only).
    window.pcSearch.restoreInputValue?.(input, { force: false });
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

  if (headerOk) wireHeaderSearch();
})();