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

    const key = dashboardKeyFromRaw(v);
    if (key) {
      location.href = dashboardUrlFromKey(key);
      return;
    }

    location.href = browseUrl(v);
  }

  function bindForm(formEl, inputEl) {
    if (!formEl || !inputEl) return;
    formEl.addEventListener("submit", (e) => {
      e.preventDefault();
      route(inputEl.value);
    });
  }

  window.pcSearch = { route, bindForm, shouldGoDashboard };
})();