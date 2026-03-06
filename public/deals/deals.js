(() => {
  const shell = document.getElementById("pcAuthPageShell");
  const dealsEl = document.getElementById("pcDeals");
  const emptyEl = document.getElementById("pcDealsEmpty");

  if (!dealsEl) return;

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  const fmtMoney = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

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

  function dashboardHrefFromKey(key) {
    const s = String(key || "").trim();
    const i = s.indexOf(":");
    if (i === -1) return "/dashboard/";
    const kind = s.slice(0, i);
    const val = s.slice(i + 1);
    return `/dashboard/${encodeURIComponent(kind)}/${encodeURIComponent(val)}/`;
  }

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

    const brandName = String(brand || "").trim();
    if (brandName) {
      const brandId = slugify(brandName);
      const url = logoUrlForId(brandId, sellers);
      icons.push({ url, label: brandName, fallback: firstLetter(brandName) });
    }

    const storeList = uniq(Array.isArray(stores) ? stores : []);
    for (const st of storeList) {
      const storeId = String(st || "").trim().toLowerCase().replace(/\s+/g, "");
      const url = logoUrlForId(storeId, sellers);
      icons.push({ url, label: st, fallback: firstLetter(st) });
    }

    if (!icons.length) return "";

    const shown = icons.slice(0, 4);

    return shown
      .map((it) => {
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
      })
      .join("");
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

    const icons = iconStackHtml({ brand: x.brand, stores: x.stores }, sellers);

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
    // Reuse your existing endpoint for now
    const url = `/api/home_deals?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-cache"
    });

    if (!res.ok) throw new Error(`GET ${url} failed (${res.status})`);

    const json = await res.json();
    return Array.isArray(json.results) ? json.results : [];
  }

  let _rows = [];
  let _offset = 0;
  let _done = false;
  let _loading = false;

  const INITIAL = 24;
  const PAGE = 24;

  function ensureScaffold() {
    if (dealsEl._pcReady) return;
    dealsEl._pcReady = true;

    dealsEl.hidden = false;
    dealsEl.innerHTML = `
      <div class="home-deals__grid" id="pcDealsGrid"></div>
      <div class="home-deals__more" id="pcDealsMore" hidden>Loading more…</div>
      <div class="home-deals__sentinel" id="pcDealsSentinel" aria-hidden="true"></div>
    `;

    dealsEl._pcGrid = dealsEl.querySelector("#pcDealsGrid");
    dealsEl._pcMore = dealsEl.querySelector("#pcDealsMore");
    dealsEl._pcSentinel = dealsEl.querySelector("#pcDealsSentinel");
  }

  function rerenderAll() {
    if (!dealsEl._pcReady) return;
    const sellers = window.__pcSellersMap || {};
    dealsEl._pcGrid.innerHTML = _rows.map((r) => cardHtml(r, sellers)).join("");
  }

  function append(rows) {
    if (!rows || !rows.length) return;
    ensureScaffold();
    const sellers = window.__pcSellersMap || {};
    dealsEl._pcGrid.insertAdjacentHTML("beforeend", rows.map((r) => cardHtml(r, sellers)).join(""));
  }

  async function loadNext({ first = false } = {}) {
    if (_loading || _done) return;
    _loading = true;

    ensureScaffold();
    if (dealsEl._pcMore) dealsEl._pcMore.hidden = true;

    try {
      const take = first ? INITIAL : PAGE;
      const rows = await loadDealsPage(_offset, take);

      if (!rows.length) {
        _done = true;
        if (emptyEl && !_rows.length) emptyEl.hidden = false;
        return;
      }

      if (emptyEl) emptyEl.hidden = true;

      _rows = _rows.concat(rows);
      _offset += rows.length;

      append(rows);

      if (rows.length < take) _done = true;
    } catch (e) {
      console.error("deals failed:", e);
      if (emptyEl && !_rows.length) emptyEl.hidden = false;
    } finally {
      _loading = false;
      if (dealsEl._pcMore) dealsEl._pcMore.hidden = true;
    }
  }

  function wireInfiniteScroll() {
    ensureScaffold();
    const sentinel = dealsEl._pcSentinel;
    if (!sentinel || sentinel._pcObs) return;
    sentinel._pcObs = true;

    const obs = new IntersectionObserver(
      (entries) => {
        for (const ent of entries) {
          if (ent.isIntersecting) {
            if (dealsEl._pcMore && !_done) dealsEl._pcMore.hidden = false;
            loadNext({ first: false });
          }
        }
      },
      { root: null, rootMargin: "900px 0px", threshold: 0.01 }
    );

    obs.observe(sentinel);
  }

  function wireSubsToggle() {
    const toggle = document.getElementById("homeSideSubsToggle");
    const list = document.getElementById("homeSideSubsList");
    if (!toggle || !list) return;

    if (toggle._pcBound) return;
    toggle._pcBound = true;

    toggle.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expanded));
      list.hidden = expanded;
      toggle.classList.toggle("is-open", !expanded);
    });
  }

  async function boot() {
    wireSubsToggle();

    await loadNext({ first: true });
    wireInfiniteScroll();

    try {
      const sellers = await loadSellersMap();
      window.__pcSellersMap = sellers || {};
      rerenderAll();
    } catch (_e) {}
  }

  // If this is an auth-gated page and the shell is still hidden, wait for sign-in.
  if (shell && shell.hidden) {
    const onAuth = (ev) => {
      const d = ev && ev.detail ? ev.detail : {};
      if (!d.signedIn) return;
      window.removeEventListener("pc:auth_changed", onAuth);
      boot();
    };
    window.addEventListener("pc:auth_changed", onAuth);
  } else {
    boot();
  }
})();