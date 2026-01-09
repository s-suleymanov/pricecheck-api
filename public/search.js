// public/search.js
(() => {
  const norm = (s) => String(s ?? "").trim();
  const digitsOnly = (s) => norm(s).replace(/\D/g, "");

  function looksLikeUrl(s) {
    const t = norm(s);
    if (!t) return false;
    if (/^https?:\/\//i.test(t)) return true;
    if (/^www\./i.test(t)) return true;
    if (/(amazon|target|walmart|bestbuy|apple|nike)\./i.test(t)) return true;
    return false;
  }

  function isPci(s) {
    return /^[A-Z][A-Z0-9]{7}$/i.test(norm(s));
  }

  function shouldGoDashboard(raw) {
    const t = norm(raw);
    if (!t) return false;

    if (looksLikeUrl(t)) return true;

    // explicit prefixes
    if (/^(asin|upc|pci|tcin|bby|wal|walmart|target|sku)\s*:/i.test(t)) return true;

    // raw ID shapes
    const d = digitsOnly(t);

    if (/^B[A-Z0-9]{9}$/i.test(t) && /\d/.test(t)) return true; // ASIN-like
    if (isPci(t)) return true;                     // PCI
    if (/^\d{12,14}$/.test(d)) return true;        // UPC (12) or EAN (13) or GTIN (14)
    if (/^\d{8}$/.test(d)) return true;            // TCIN
    if (/^\d{6,8}$/.test(d)) return true;          // Best Buy SKU-ish
    if (/^\d{6,12}$/.test(d)) return true;         // Walmart itemId-ish

    return false;
  }

  function dashboardUrl(raw) {
    const v = norm(raw);
    const u = new URL("/dashboard/", location.origin);
    u.searchParams.set("key", v); // dashboard reads key, but we will also accept q
    return u.toString();
  }

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

  function route(raw) {
    const v = norm(raw);
    if (!v) return;

    if (shouldGoDashboard(v)) {
      location.href = dashboardUrl(v);
      return;
    }

    location.href = browseUrl(v);
  }

  // Utility to wire any form + input to the unified router
  function bindForm(formEl, inputEl) {
    if (!formEl || !inputEl) return;

    formEl.addEventListener("submit", (e) => {
      e.preventDefault();
      route(inputEl.value);
    });
  }

  // expose minimal API
  window.pcSearch = { route, bindForm, shouldGoDashboard };
})();