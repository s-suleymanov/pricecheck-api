// public/index.js
(() => {
  // -----------------------------
  // PWA: service worker (home)
  // -----------------------------
  function canUseSW() {
    return "serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost");
  }

  if (canUseSW()) {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }

  // -----------------------------
  // DOM
  // -----------------------------
  const dealsEl = document.getElementById("homeDeals");
  const pillsEl = document.getElementById("homePills");
  const catsEl = document.getElementById("homeSideCategories");
  const brandsEl = document.getElementById("homeSideBrands");

  if (!dealsEl) return;

  // -----------------------------
  // Small helpers
  // -----------------------------
  const fmtMoney = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

  function centsToUsd(c) {
    const n = Number(c);
    if (!Number.isFinite(n)) return "NA";
    return fmtMoney.format(n / 100);
  }

  function slugify(s) {
    return String(s ?? "")
      .trim()
      .toLowerCase()
      .replace(/['"]/g, "")
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function browseHrefFromText(q) {
    const slug = slugify(q);
    if (!slug) return "/browse/";
    return `/browse/${encodeURIComponent(slug)}/`;
  }

    // -----------------------------
  // Logos (brand + stores)
  // -----------------------------
  let _sellersMapPromise = null;

  async function loadSellersMap() {
    if (_sellersMapPromise) return _sellersMapPromise;

    _sellersMapPromise = (async () => {
      try {
        const res = await fetch("/data/sellers.json", { headers: { Accept: "application/json" } });
        if (!res.ok) return {};
        const json = await res.json();
        return json && typeof json === "object" ? json : {};
      } catch (_e) {
        return {};
      }
    })();

    return _sellersMapPromise;
  }

  function logoUrlForId(id, sellers) {
    const k = String(id || "").trim().toLowerCase();
    if (!k) return "";
    const entry = sellers && sellers[k] ? sellers[k] : null;
    const logo =
      entry && (entry.logo || entry.logo_url || entry.logoUrl || entry.image_url || entry.imageUrl)
        ? String(entry.logo || entry.logo_url || entry.logoUrl || entry.image_url || entry.imageUrl)
        : "";
    return String(logo || "").trim();
  }

  function firstLetter(s) {
    const t = String(s || "").trim();
    return (t[0] || "?").toUpperCase();
  }

  function uniq(arr) {
    const out = [];
    const seen = new Set();
    for (const x of arr || []) {
      const v = String(x || "").trim();
      if (!v) continue;
      const k = v.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(v);
    }
    return out;
  }

  function iconStackHtml({ brand, stores }, sellers) {
    const icons = [];

    // 1) Brand first (DJI first, Apple first, etc)
    const brandName = String(brand || "").trim();
    if (brandName) {
      const brandId = slugify(brandName); // matches your seller slug style
      const url = logoUrlForId(brandId, sellers);
      icons.push({ url, label: brandName, fallback: firstLetter(brandName) });
    }

    // 2) Stores (already store_key like amazon, bestbuy, walmart, target)
    const storeList = uniq(Array.isArray(stores) ? stores : []);
        for (const st of storeList) {
      const storeId = String(st || "").trim().toLowerCase().replace(/\s+/g, "");
      const url = logoUrlForId(storeId, sellers);
      icons.push({ url, label: st, fallback: firstLetter(st) });
    }

    if (!icons.length) return "";

    const MAX = 4;
    const shown = icons.slice(0, MAX);

    const bits = shown.map((it) => {
      const title = esc(it.label);
      if (it.url) {
        return `
          <span class="home-deal__icon" title="${title}" aria-label="${title}">
            <img src="${esc(it.url)}" alt="" loading="lazy" decoding="async" onerror="this.closest('.home-deal__icon') && this.closest('.home-deal__icon').remove()">
          </span>
        `;
      }
      return `
        <span class="home-deal__icon home-deal__icon--fallback" title="${title}" aria-label="${title}">
          ${esc(it.fallback)}
        </span>
      `;
    });

    return bits.join("");
  }

  function dashboardHrefFromKey(key) {
    const s = String(key || "").trim();
    const i = s.indexOf(":");
    if (i === -1) return "/dashboard/";
    const kind = s.slice(0, i);
    const val = s.slice(i + 1);
    return `/dashboard/${encodeURIComponent(kind)}/${encodeURIComponent(val)}/`;
  }

    function cardHtml(x, sellers) {
    const title = esc(x.title || "Product");
    const img = String(x.image_url || "").trim();

    const imgTag = img
      ? `<img class="home-deal__img" src="${esc(img)}" alt="" loading="lazy" decoding="async">`
      : `<div class="home-deal__img is-empty" aria-hidden="true"></div>`;

    const minP = centsToUsd(x.min_price_cents);
    const maxP = centsToUsd(x.max_price_cents);

    const href = dashboardHrefFromKey(x.key);

    const icons = iconStackHtml(
      { brand: x.brand, stores: x.stores },
      sellers
    );

    return `
      <a class="home-deal" href="${esc(href)}">
        ${imgTag}
        <div class="home-deal__body">
          <div class="home-deal__icons" aria-hidden="true">
            ${icons}
          </div>
          <div class="home-deal__content">
            <div class="home-deal__title">${title}</div>
            <div class="home-deal__meta">
              <span class="home-deal__price">${minP}</span>
              <span class="home-deal__range">to ${maxP}</span>
            </div>
          </div>
        </div>
      </a>
    `;
  }

  async function loadDealsPage(offset, limit) {
    const url = `/api/home_deals?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-cache"
    });

    if (!res.ok) throw new Error(`GET ${url} failed (${res.status})`);

    const json = await res.json();
    return Array.isArray(json.results) ? json.results : [];
  }

  let _dealsRows = [];
  let _dealsOffset = 0;
  let _dealsDone = false;
  let _dealsLoading = false;

  const INITIAL_DEALS = 24; // roughly 3 to 4 rows on many layouts
  const PAGE_DEALS = 24;

  function ensureDealsScaffold() {
    if (dealsEl._pcReady) return;
    dealsEl._pcReady = true;

    dealsEl.hidden = false;
    dealsEl.innerHTML = `
      <div class="home-deals__grid" id="homeDealsGrid"></div>
      <div class="home-deals__more" id="homeDealsMore" hidden>Loading more…</div>
      <div class="home-deals__sentinel" id="homeDealsSentinel" aria-hidden="true"></div>
    `;

    dealsEl._pcGrid = dealsEl.querySelector("#homeDealsGrid");
    dealsEl._pcMore = dealsEl.querySelector("#homeDealsMore");
    dealsEl._pcSentinel = dealsEl.querySelector("#homeDealsSentinel");
  }

  function appendDeals(rows) {
    if (!rows || !rows.length) return;
    ensureDealsScaffold();

    const sellers = window.__pcSellersMap || {};
    const html = rows.map((r) => cardHtml(r, sellers)).join("");
    dealsEl._pcGrid.insertAdjacentHTML("beforeend", html);
  }

  function rerenderAllDeals() {
    if (!dealsEl._pcReady) return;
    const sellers = window.__pcSellersMap || {};
    dealsEl._pcGrid.innerHTML = _dealsRows.map((r) => cardHtml(r, sellers)).join("");
  }

  async function loadNextDealsPage({ first = false } = {}) {
  if (_dealsLoading || _dealsDone) return;
  _dealsLoading = true;

  ensureDealsScaffold();

  // Only show "Loading more…" on later pages (not first paint)
  if (dealsEl._pcMore) dealsEl._pcMore.hidden = true;

  try {
    const take = first ? INITIAL_DEALS : PAGE_DEALS;
    const rows = await loadDealsPage(_dealsOffset, take);

    if (!rows.length) {
      _dealsDone = true;
      return;
    }

    _dealsRows = _dealsRows.concat(rows);
    _dealsOffset += rows.length;

    appendDeals(rows);

    // If server returned fewer than requested, we hit the end
    if (rows.length < take) _dealsDone = true;
  } catch (e) {
    console.error("home deals failed:", e);

    // If first page fails, hide the section like before
    if (first) {
      dealsEl.hidden = true;
      dealsEl.innerHTML = "";
    }
  } finally {
    _dealsLoading = false;

    // After the first grid chunk has attempted to render, reveal the sidebar contents
    if (first) document.body.classList.add("pc-home-ready");

    if (dealsEl._pcMore) dealsEl._pcMore.hidden = true;
  }
}

function wireDealsInfiniteScroll() {
  ensureDealsScaffold();

  const sentinel = dealsEl._pcSentinel;
  if (!sentinel || sentinel._pcObs) return;
  sentinel._pcObs = true;

  const obs = new IntersectionObserver(
    (entries) => {
      for (const ent of entries) {
        if (ent.isIntersecting) {
          // show loader text for subsequent page loads
          if (dealsEl._pcMore && !_dealsDone) dealsEl._pcMore.hidden = false;
          loadNextDealsPage({ first: false });
        }
      }
    },
    // Start loading before you actually reach the bottom
    { root: null, rootMargin: "900px 0px", threshold: 0.01 }
  );

  obs.observe(sentinel);
}

  // -----------------------------
  // Trend pills
  // -----------------------------
  const FALLBACK_TRENDS = [
    { label: "🔥 Price Drops Today", q: "price drops today" },
    { label: "📉 Under $100", q: "under 100" },
    { label: "🎮 Gaming Setup", q: "gaming setup" },
    { label: "🛴 Commuter Scooters", q: "commuter scooters" }
  ];

  async function loadTrends() {
    const res = await fetch("/api/home_trends", {
      headers: { Accept: "application/json" },
      cache: "no-cache"
    });

    if (!res.ok) throw new Error(`GET /api/home_trends failed (${res.status})`);

    const json = await res.json();
    return Array.isArray(json.results) ? json.results : [];
  }

  function renderTrends(rows) {
    if (!pillsEl) return;

    const list = rows && rows.length ? rows : FALLBACK_TRENDS;
    if (!list.length) {
      pillsEl.hidden = true;
      pillsEl.innerHTML = "";
      return;
    }

    pillsEl.hidden = false;
    pillsEl.innerHTML = list
      .map((x) => {
        const label = esc(x.label || x.title || "Trend");
        const href = x.href ? String(x.href) : browseHrefFromText(x.q || x.label || "");
        return `<a class="home-pill" href="${esc(href)}">${label}</a>`;
      })
      .join("");
  }

  async function loadSidebar() {
  const res = await fetch("/api/home_sidebar?cats=5&brands=5", {
    headers: { Accept: "application/json" },
    cache: "no-cache"
  });

  if (!res.ok) throw new Error(`GET /api/home_sidebar failed (${res.status})`);

  const json = await res.json();
  return {
    categories: Array.isArray(json.categories) ? json.categories : [],
    brands: Array.isArray(json.brands) ? json.brands : []
  };
}

  function renderSidebar({ categories = [], brands = [] } = {}) {
    if (catsEl) {
      catsEl.innerHTML = categories
        .map((x) => {
          const name = String(x.category || "").trim();
          if (!name) return "";
          const href = `/browse/category/${encodeURIComponent(name)}/`;
          return `<a class="home-side__item home-side__item--thin" href="${esc(href)}">${esc(name)}</a>`;
        })
        .join("");
    }

    if (brandsEl) {
      brandsEl.innerHTML = brands
        .map((x) => {
          const name = String(x.brand || "").trim();
          if (!name) return "";
          const href = browseHrefFromText(name);
          return `<a class="home-side__item home-side__item--thin" href="${esc(href)}">${esc(name)}</a>`;
        })
        .join("");
    }
  }

    // -----------------------------
    // Boot 
    // -----------------------------
    loadNextDealsPage({ first: true }).then(() => {
      wireDealsInfiniteScroll();

    // Load sellers after the first chunk is visible, then upgrade icons
    const loadLogos = async () => {
      try {
        const sellers = await loadSellersMap();
        window.__pcSellersMap = sellers || {};
        rerenderAllDeals();
      } catch (_e) {}
    };

    if ("requestIdleCallback" in window) requestIdleCallback(loadLogos);
    else setTimeout(loadLogos, 0);
  });

  // Trends and sidebar can happen after; they should not block the grid
  setTimeout(() => {
    loadTrends()
      .then(renderTrends)
      .catch((e) => {
        console.error("home trends failed:", e);
        renderTrends([]);
      });

    loadSidebar()
      .then(renderSidebar)
      .catch((e) => {
        console.error("home sidebar failed:", e);
        renderSidebar({ categories: [], brands: [] });
      });
  }, 0);
})();