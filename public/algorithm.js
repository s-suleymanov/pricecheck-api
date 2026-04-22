(() => {
  const feedEl  = document.getElementById("homeDeals");
  const pillsEl = document.getElementById("homePills");
  if (!feedEl) return;

  // ── Shimmer animation ─────────────────────────────────────────────────────
  if (!document.getElementById("pc-sty")) {
    const s = document.createElement("style"); s.id = "pc-sty";
    s.textContent = `@keyframes pc-sh{0%{background-position:200% 0}100%{background-position:-200% 0}}.pc-sk{background:linear-gradient(90deg,#ececec 25%,#f4f4f4 50%,#ececec 75%);background-size:200% 100%;animation:pc-sh 1.4s infinite;border-radius:4px}`;
    document.head.appendChild(s);
  }

  function paintPills(list) {
    if (!pillsEl) return;
    pillsEl.innerHTML = list.map(x =>
      `<a class="home-pill" href="${esc(x.href ? String(x.href) : bHref(x.q || x.label || ""))}">${esc(x.label || x.title || "")}</a>`
    ).join("");
  }

  const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const esc = s => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
  const $   = id => document.getElementById(id);
  const c2u = c  => { const n = Number(c); return Number.isFinite(n) ? fmt.format(n/100) : "—"; };

    const SHORTLIST_ADD_SVG = `
    <svg viewBox="0 -960 960 960" aria-hidden="true" focusable="false">
      <path d="M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z"></path>
    </svg>
  `;

  const SHORTLIST_ON_SVG = `
    <svg viewBox="0 -960 960 960" aria-hidden="true" focusable="false">
      <path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"></path>
    </svg>
  `;

  function shortlistApi() {
    return window.PriceCheckShortlist || null;
  }

  function shortlistButtonHtml() {
    return `
      <button
        type="button"
        class="home-deal__shortlist"
        data-shortlist-toggle="1"
        aria-label="Save to shortlist"
        title="Save to shortlist"
      >
        <span data-shortlist-icon="off">${SHORTLIST_ADD_SVG}</span>
        <span data-shortlist-icon="on" hidden>${SHORTLIST_ON_SVG}</span>
      </button>
    `;
  }

  function shortlistItemFromHomeCard(cardEl) {
    const api = shortlistApi();
    if (!api || !cardEl) return null;

    const key = String(cardEl.getAttribute("data-dash-key") || "").trim();
    if (!key) return null;

    const linkEl = cardEl.querySelector(".home-deal__link");
    const rawHref =
      linkEl?.getAttribute("href") ||
      cardEl.getAttribute("data-href") ||
      dashHref(key) ||
      "";

    const href = api.safeHref(rawHref, { sameOrigin: true });
    if (!href) return null;

    const rawPrice = Number(cardEl.getAttribute("data-price-cents"));
    const priceCents = Number.isFinite(rawPrice) ? rawPrice : null;

    let title = String(cardEl.getAttribute("data-title") || "").trim();
    if (!title) {
      title = String(cardEl.querySelector(".home-deal__title")?.textContent || "").trim();
    }

    let brand = String(cardEl.getAttribute("data-brand") || "").trim();
    if (!brand) {
      brand = String(cardEl.querySelector(".home-deal__brand, .home-deal__subtitle, .subtitle")?.textContent || "").trim();
    }

    let img = String(cardEl.getAttribute("data-img") || "").trim();
    if (!img) {
      img =
        String(cardEl.querySelector(".home-deal__img")?.getAttribute("src") || "").trim() ||
        String(cardEl.querySelector(".home-deal__img img")?.getAttribute("src") || "").trim();
    }

    return api.normalizeItem({
      key,
      href,
      title,
      brand,
      img,
      priceCents,
      source: "home"
    });
  }

  function syncShortlistButtons(root = document) {
    const api = shortlistApi();
    if (!api) return;

    root.querySelectorAll(".home-deal[data-dash-key]").forEach((card) => {
      let btn = card.querySelector("[data-shortlist-toggle='1']");
      if (!btn) {
        card.insertAdjacentHTML("beforeend", shortlistButtonHtml());
        btn = card.querySelector("[data-shortlist-toggle='1']");
      }
      if (!btn) return;

      const key = String(card.getAttribute("data-dash-key") || "").trim();
      const on = api.has(key);

      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-label", on ? "Remove from shortlist" : "Save to shortlist");
      btn.title = on ? "Remove from shortlist" : "Save to shortlist";

      const off = btn.querySelector("[data-shortlist-icon='off']");
      const onEl = btn.querySelector("[data-shortlist-icon='on']");
      if (off) off.hidden = on;
      if (onEl) onEl.hidden = !on;
    });
  }

  function initHomeShortlistUi() {
    const api = shortlistApi();
    if (!api) return;

    if (!document.body.dataset.homeShortlistBound) {
      document.body.dataset.homeShortlistBound = "1";

      document.body.addEventListener("click", (e) => {
        const saveBtn = e.target.closest("[data-shortlist-toggle='1']");
        if (saveBtn) {
          e.preventDefault();
          e.stopPropagation();

          const card = saveBtn.closest(".home-deal[data-dash-key]");
          const item = shortlistItemFromHomeCard(card);
          if (!item) return;

          api.toggle(item);
          syncShortlistButtons(document);
          return;
        }
      });
    }

    window.addEventListener("pc:shortlist_changed", () => {
      syncShortlistButtons(document);
    });

    api.mountRail();
    syncShortlistButtons(document);
  }

  function slugify(s) {
    return String(s ?? "").trim().toLowerCase()
      .replace(/['"]/g,"").replace(/&/g,"and").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
  }
  function dashHref(key) {
    const s = String(key||"").trim(), i = s.indexOf(":");
    return i===-1 ? "/dashboard/" : `/dashboard/${encodeURIComponent(s.slice(0,i))}/${encodeURIComponent(s.slice(i+1))}/`;
  }

  // ── Client-side brand→category inference ─────────────────────────────────
  // Mirrors the server-side table so the client can send enriched signals.
  const BRAND_TO_CATS = {
    apple:       ["laptop","laptops","tablet","phone","headphones","smartwatch","computer","monitor"],
    samsung:     ["phone","tv","television","monitor","tablet","headphones","speaker"],
    sony:        ["headphones","tv","camera","speaker","monitor","phone"],
    lg:          ["tv","television","monitor","oled","phone","appliance"],
    dell:        ["laptop","laptops","monitor","computer","desktop"],
    hp:          ["laptop","laptops","printer","monitor","computer","desktop"],
    lenovo:      ["laptop","laptops","computer","tablet","monitor"],
    asus:        ["laptop","laptops","monitor","computer","router","phone"],
    microsoft:   ["laptop","tablet","computer","keyboard","mouse","gaming","controller"],
    bose:        ["headphones","speaker","earbuds"],
    jbl:         ["speaker","headphones","earbuds"],
    logitech:    ["mouse","keyboard","webcam","speaker","headset","controller","gaming"],
    nikon:       ["camera","lens"],
    canon:       ["camera","printer"],
    dyson:       ["vacuum","appliance","hair"],
    shark:       ["vacuum","robot vacuum","appliance"],
    irobot:      ["robot vacuum","vacuum"],
    nintendo:    ["gaming","console","controller"],
    "turtle beach": ["headset","headphones","gaming"],
  };
  const KEYWORD_INFER = {
    macbook:  { brands:["apple"],     cats:["laptop","laptops","computer"] },
    imac:     { brands:["apple"],     cats:["computer","desktop","monitor"] },
    ipad:     { brands:["apple"],     cats:["tablet","tablets"] },
    iphone:   { brands:["apple"],     cats:["phone","phones"] },
    airpods:  { brands:["apple"],     cats:["headphones","earbuds"] },
    galaxy:   { brands:["samsung"],   cats:["phone","phones","tablet"] },
    odyssey:  { brands:["samsung"],   cats:["monitor","gaming"] },
    surface:  { brands:["microsoft"], cats:["laptop","tablet"] },
    xps:      { brands:["dell"],      cats:["laptop","laptops"] },
    thinkpad: { brands:["lenovo"],    cats:["laptop","laptops"] },
    roomba:   { brands:["irobot"],    cats:["robot vacuum","vacuum"] },
    ps5:      { brands:[],            cats:["gaming","console"] },
    xbox:     { brands:["microsoft"], cats:["gaming","console","controller"] },
  };

  function expandBrandsAndCats(brands, cats, kws) {
    const eb = new Set(brands), ec = new Set(cats);
    for (const kw of kws) {
      for (const [key, inf] of Object.entries(KEYWORD_INFER)) {
        if (kw === key || kw.includes(key) || key.includes(kw)) {
          inf.brands.forEach(b => eb.add(b));
          inf.cats.forEach(c => ec.add(c));
        }
      }
    }
    for (const b of brands) (BRAND_TO_CATS[b] || []).slice(0,4).forEach(c => ec.add(c));
    return { brands: [...eb].slice(0,15), cats: [...ec].slice(0,15) };
  }

  // ── Signal extraction from history ───────────────────────────────────────
  const STOP = new Set(["a","an","the","and","or","of","in","on","at","to","for","with","by","from","is","it","its","be","are","was","as","this","that","new","used","refurbished","set","pack","piece","lot","bundle","size","color","black","white","silver","gold","gray","grey","blue","red","pink","green","pro","plus","max","mini","se","xl","gen","inch","mm","cm","ft","gb","tb","mb","hz","w","v","mah"]);
  const CAT_RULES = [
    { cat:"headphones",    tests:["headphone","earbud","earphone","buds","airpods"] },
    { cat:"tv",            tests:["tv","oled","qled","television","smart tv"] },
    { cat:"laptop",        tests:["laptop","notebook","chromebook","macbook"] },
    { cat:"monitor",       tests:["monitor","display"] },
    { cat:"phone",         tests:["phone","iphone","galaxy","pixel"] },
    { cat:"tablet",        tests:["tablet","ipad"] },
    { cat:"camera",        tests:["camera","mirrorless","dslr"] },
    { cat:"speaker",       tests:["speaker","soundbar"] },
    { cat:"smartwatch",    tests:["watch","smartwatch"] },
    { cat:"robot vacuum",  tests:["robot vacuum","roomba","robovac"] },
    { cat:"gaming",        tests:["playstation","xbox","nintendo","gaming","console"] },
    { cat:"keyboard",      tests:["keyboard"] },
    { cat:"mouse",         tests:[" mouse "] },
    { cat:"router",        tests:["router","mesh wifi"] },
  ];

  function inferCats(title) {
    const t = ` ${String(title||"").toLowerCase()} `;
    return CAT_RULES.filter(r => r.tests.some(x => t.includes(x))).map(r => r.cat);
  }

  function recencyW(d) {
    if (!d) return 0.1;
    return Math.pow(0.5, (Date.now() - new Date(d).getTime()) / 86400000 / 14);
  }
  function tokenise(t) {
    return String(t||"").toLowerCase().replace(/[^a-z0-9\s]/g," ").split(/\s+/).filter(w => w.length >= 3 && !STOP.has(w));
  }

  function extractSignals(histRows) {
    if (!histRows?.length) return { brands:[], categories:[], keywords:[], seenKeys:[] };
    const bS={}, cS={}, kS={}, seen=[];
    for (const r of histRows) {
      const w   = recencyW(r.viewed_at);
      const key = String(r.entity_key||"").trim();
      if (key) seen.push(key);
      const b   = String(r.brand||"").trim().toLowerCase();
      if (b) bS[b] = (bS[b]||0) + w;
      for (const c of inferCats(r.title)) cS[c] = (cS[c]||0) + w * 1.5;
      for (const t of tokenise(r.title))  kS[t] = (kS[t]||0) + w * 0.6;
    }
    const topBrands = Object.entries(bS).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k])=>k);
    const topCats   = Object.entries(cS).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k])=>k);
    const topKws    = Object.entries(kS).sort((a,b)=>b[1]-a[1]).slice(0,12).map(([k])=>k);
    const { brands: eb, cats: ec } = expandBrandsAndCats(topBrands, topCats, topKws);
    return {
      brands:     eb,
      categories: ec,
      keywords:   topKws,
      seenKeys:   [...new Set(seen)],
    };
  }

  // ── Seller logos ──────────────────────────────────────────────────────────
  function getSellers() {
    if (window.__pcSellersMap && typeof window.__pcSellersMap === "object") {
      return Promise.resolve(window.__pcSellersMap);
    }

    if (window.__pcSellersMapPromise) {
      return window.__pcSellersMapPromise;
    }

    window.__pcSellersMapPromise = fetch("/data/sellers.json", {
      headers: { Accept: "application/json" }
    })
      .then(r => (r.ok ? r.json() : {}))
      .then(j => {
        window.__pcSellersMap = (j && typeof j === "object") ? j : {};
        return window.__pcSellersMap;
      })
      .catch(() => {
        window.__pcSellersMap = {};
        return window.__pcSellersMap;
      });

    return window.__pcSellersMapPromise;
  }
  function logoUrl(id, S) {
    const k = String(id||"").trim().toLowerCase();
    const e = S?.[k];
    return e ? String(e.logo||e.logo_url||e.logoUrl||e.image_url||e.imageUrl||"").trim() : "";
  }
  function uniq(a) {
    const s=new Set();
    return (a||[]).filter(x=>{const k=String(x||"").toLowerCase();if(!k||s.has(k))return false;s.add(k);return true;});
  }
  function normIconKey(v) {
    return String(v || "")
      .trim()
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "");
  }

  function iconsHtml({ brand, stores }, S) {
    const icons = [];
    const seen = new Set();

    function pushIcon(rawKey, label) {
      const key = normIconKey(rawKey || label);
      if (!key || seen.has(key)) return;
      seen.add(key);

      const url = logoUrl(key, S);
      icons.push({
        u: url,
        label,
        fb: (String(label || "?")[0] || "?").toUpperCase()
      });
    }

    if (brand) pushIcon(brand, brand);

    for (const st of uniq(stores || [])) {
      pushIcon(st, st);
    }

    return icons.slice(0, 3).map(it => {
      const t = esc(it.label);
      return it.u
        ? `<span class="home-deal__icon" title="${t}"><img src="${esc(it.u)}" alt="" loading="lazy" decoding="async" onerror="this.closest('.home-deal__icon')?.remove()"></span>`
        : `<span class="home-deal__icon home-deal__icon--fallback" title="${t}">${esc(it.fb)}</span>`;
    }).join("");
  }

  function dealImageUrl(raw, target = 320) {
    const s = String(raw || "").trim();
    if (!s) return "";

    // Best Buy
    if (s.includes("bbystatic.com")) {
      let out = s;

      out = out.replace(/maxWidth=\d+/i, `maxWidth=${target}`);
      out = out.replace(/maxHeight=\d+/i, `maxHeight=${target}`);

      if (!/format=/i.test(out)) {
        out += ";format=webp";
      }

      return out;
    }

    return s;
  }

  function cardHtml(item, S, eager = false) {
    const title = esc(item.title || "Product");
    const brand = esc(item.brand || "");
    const img = String(item.image_url || "").trim();
    const img320 = dealImageUrl(img, 320);
    const img640 = dealImageUrl(img, 640);
    const href = esc(dashHref(item.key));
    const key = esc(item.key || "");
    const priceCents = Number.isFinite(Number(item.min_price_cents)) ? Number(item.min_price_cents) : "";
    const hasCoupon = !!item.has_coupon;

    const imgTag = img
  ? `<img
      class="home-deal__img"
      src="${esc(img320)}"
      srcset="${esc(img320)} 320w, ${esc(img640)} 640w"
      sizes="(max-width: 560px) 50vw, (max-width: 980px) 33vw, 260px"
      width="320"
      height="320"
      alt=""
      loading="${eager ? "eager" : "lazy"}"
      fetchpriority="${eager ? "high" : "auto"}"
      decoding="async"
    >`
  : `<div class="home-deal__img is-empty" aria-hidden="true"></div>`;

    return `
      <article
        class="home-deal"
        data-dash-key="${key}"
        data-href="${href}"
        data-title="${title}"
        data-brand="${brand}"
        data-img="${esc(img)}"
        data-price-cents="${priceCents}"
      >
        ${shortlistButtonHtml()}

      <a class="home-deal__link" href="${href}" aria-label="${title}">
          <div class="home-deal__media">
            ${imgTag}
            ${recScoreBadgeHtml(item.overall_score)}
          </div>
          <div class="home-deal__body">
            <div class="home-deal__icons" aria-hidden="true">
              ${iconsHtml({ brand: item.brand, stores: item.stores }, S)}
            </div>
            <div class="home-deal__content">
              <div class="home-deal__title">${title}</div>
              <div class="home-deal__meta">
                <span class="home-deal__price">${c2u(item.min_price_cents)}</span>
                ${hasCoupon ? `<span class="home-deal__coupon">Coupon</span>` : ``}
              </div>
            </div>
          </div>
        </a>
      </article>
    `;
  }

    function recScoreTone(score) {
    const n = Number(score);
    if (!Number.isFinite(n)) return "";
    if (n >= 85) return "great";
    if (n >= 70) return "good";
    if (n >= 55) return "mixed";
    return "low";
  }

  function recScoreBadgeHtml(score) {
    const n = Number(score);
    if (!Number.isFinite(n) || n <= 0) return "";

    const tone = recScoreTone(n);
    return `
      <div class="home-deal__score home-deal__score--${tone}" aria-label="Overall score ${Math.round(n)}">
        ${Math.round(n)}
      </div>
    `;
  }

  function skelHtml(n) {
    const c=`<div class="home-deal" style="pointer-events:none" aria-hidden="true"><div class="home-deal__img is-empty pc-sk"></div><div class="home-deal__body"><div class="home-deal__content"><div class="pc-sk" style="width:70%;height:13px;margin-bottom:8px"></div><div class="pc-sk" style="width:40%;height:11px"></div></div></div></div>`;
    return Array.from({length:n},()=>c).join("");
  }
  function stopSkeletonGrid() {
    _bootLoading = false;
    clearTimeout(_skelResizeTimer);
    if (_skelRO) {
      _skelRO.disconnect();
      _skelRO = null;
    }
  }

let _bootLoading = false;
let _skelResizeTimer = null;
let _skelRO = null;

function getGridColumnCount() {
const grid = feedEl._g;
if (!grid) return 1;

const vw = window.innerWidth || document.documentElement.clientWidth || 0;
const gridWidth = Math.max(0, Math.floor(grid.clientWidth));

// Match your CSS breakpoints exactly
if (vw <= 360) return 1;
if (vw <= 560) return 2;

// Match your CSS gap rules
const gap = vw >= 980 ? 10 : 12;

// Match your desktop grid rule:
// grid-template-columns: repeat(auto-fill, minmax(240px, 1fr))
const minCardWidth = 240;

return Math.max(1, Math.floor((gridWidth + gap) / (minCardWidth + gap)));
}

function getSkeletonCount() {
const cols = getGridColumnCount();

// You can change this if you want fewer or more placeholder rows
const rows = cols >= 5 ? 2 : cols >= 3 ? 3 : 4;

return cols * rows;
}

function renderSkeletonGrid() {
if (!feedEl._g) return;
feedEl._g.innerHTML = skelHtml(getSkeletonCount());
}

function watchSkeletonGrid() {
if (_skelRO || !feedEl._g || !("ResizeObserver" in window)) return;

_skelRO = new ResizeObserver(() => {
    if (!_bootLoading) return;
    clearTimeout(_skelResizeTimer);
    _skelResizeTimer = setTimeout(() => {
    renderSkeletonGrid();
    }, 80);
});

_skelRO.observe(feedEl._g);
}

window.addEventListener("resize", () => {
if (!_bootLoading || !feedEl._g) return;
clearTimeout(_skelResizeTimer);
_skelResizeTimer = setTimeout(() => {
    renderSkeletonGrid();
}, 80);
}, { passive: true });

  // ── Feed state ────────────────────────────────────────────────────────────
  let _sig   = { brands:[], categories:[], keywords:[], seenKeys:[] };
  let _rows  = [];
  let _seen  = new Set();   // all keys ever shown (prevents repeats across pages)
  let _off   = 0;
  let _busy  = false;
  const PAGE = 24;

  const HOME_FEED_CACHE_KEY = "pc_home_feed_cache_v1";
  const HOME_FEED_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

  function normSig(sig) {
    return {
      brands: Array.isArray(sig?.brands) ? sig.brands : [],
      categories: Array.isArray(sig?.categories) ? sig.categories : [],
      keywords: Array.isArray(sig?.keywords) ? sig.keywords : [],
      seenKeys: Array.isArray(sig?.seenKeys) ? sig.seenKeys : [],
    };
  }

  function readHomeFeedCache() {
    try {
      const raw = localStorage.getItem(HOME_FEED_CACHE_KEY);
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;

      const age = Date.now() - Number(parsed.savedAt || 0);
      if (!Number.isFinite(age) || age < 0 || age > HOME_FEED_CACHE_TTL) {
        localStorage.removeItem(HOME_FEED_CACHE_KEY);
        return null;
      }

      if (!Array.isArray(parsed.rows) || !parsed.rows.length) return null;

      return {
        rows: parsed.rows,
        sig: normSig(parsed.sig),
        off: Number.isFinite(Number(parsed.off)) ? Number(parsed.off) : parsed.rows.length
      };
    } catch (_) {
      return null;
    }
  }

  function writeHomeFeedCache(payload) {
    try {
      localStorage.setItem(HOME_FEED_CACHE_KEY, JSON.stringify({
        savedAt: Date.now(),
        rows: Array.isArray(payload?.rows) ? payload.rows : [],
        sig: normSig(payload?.sig),
        off: Number.isFinite(Number(payload?.off)) ? Number(payload.off) : 0
      }));
    } catch (_) {}
  }

  function clearHomeFeedCache() {
    try {
      localStorage.removeItem(HOME_FEED_CACHE_KEY);
    } catch (_) {}
  }

  function hydrateFromCache(cache) {
    const rows = Array.isArray(cache?.rows) ? cache.rows : [];
    if (!rows.length) return 0;

    _sig  = normSig(cache.sig);
    _rows = rows;
    _off  = Number.isFinite(Number(cache.off)) ? Number(cache.off) : rows.length;
    _seen = new Set(rows.map(r => r?.key).filter(Boolean));

    scaffold();
    stopSkeletonGrid();
    feedEl._g.innerHTML = "";
    paint(rows);

    if (pillsEl) {
      paintPills(mkPills(_sig));
    }

    document.body.classList.add("pc-home-ready");

    getSellers()
      .then(() => {
        if (_rows.length) repaint();
      })
      .catch(() => {});

    return rows.length;
  }

  window.pcRefreshHomeFeed = function pcRefreshHomeFeed() {
    clearHomeFeedCache();
    window.location.reload();
  };

  
    function scaffold(skel=false) {
        if (!feedEl._rdy) {
            feedEl._rdy = true;
            feedEl.hidden = false;
            feedEl.innerHTML = `
            <div class="home-deals__grid" id="pcG"></div>
            <div class="home-deals__more" id="pcM" hidden>Loading more…</div>
            <div class="home-deals__sentinel" id="pcS" aria-hidden="true"></div>
            `;
            feedEl._g = $("pcG");
            feedEl._m = $("pcM");
            feedEl._s = $("pcS");
            watchSkeletonGrid();
        }

        if (skel) renderSkeletonGrid();
    }

  function paint(rows) {
  if (!rows?.length) return;
  scaffold();
  const S = window.__pcSellersMap || {};

  const existing = feedEl._g.children.length;
  feedEl._g.insertAdjacentHTML(
    "beforeend",
    rows.map((r, i) => cardHtml(r, S, existing + i < 8)).join("")
  );

  rows.forEach(r => { if (r.key) _seen.add(r.key); });
  syncShortlistButtons(feedEl._g);
}

  function repaint() {
    if (!feedEl._rdy) return;
    const S = window.__pcSellersMap || {};
    feedEl._g.innerHTML = _rows.map(r => cardHtml(r, S)).join("");
    syncShortlistButtons(feedEl._g);
  }

  function swap(rows) {
    if (!rows?.length) return;
    scaffold();

    feedEl._g.style.transition = "opacity .2s";
    feedEl._g.style.opacity = "0";

    requestAnimationFrame(() => {
      feedEl._g.innerHTML = rows.map(r => cardHtml(r, window.__pcSellersMap || {})).join("");
      _seen = new Set(rows.map(r => r.key).filter(Boolean));
      syncShortlistButtons(feedEl._g);

      requestAnimationFrame(() => {
        feedEl._g.style.opacity = "1";
      });
    });
  }

  async function getHomeViewerSignedIn() {
  try {
    const r = await fetch("/api/auth/me", {
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    });

    const json = await r.json().catch(() => null);
    return !!json?.user?.id;
  } catch (_) {
    return false;
  }
}

  // ── API call ──────────────────────────────────────────────────────────────
  async function apiFeed(sig, off, lim) {
    const r = await fetch("/api/home_feed", {
      method:"POST",
      headers:{"Content-Type":"application/json",Accept:"application/json"},
      body: JSON.stringify({
        signals:      { brands:sig.brands, categories:sig.categories, keywords:sig.keywords },
        exclude_keys: [...(sig.seenKeys||[]), ..._seen],
        limit: lim,
        offset: off,
      }),
    });
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }

async function loadFirst(sig, opts = {}) {
  const forceRefresh = !!opts.forceRefresh;

  if (!forceRefresh) {
    const cached = readHomeFeedCache();
    if (cached?.rows?.length) {
      return hydrateFromCache(cached);
    }
  }

  _bootLoading = true;
  scaffold(true);

  const sellersPromise = getSellers().catch(() => (window.__pcSellersMap || {}));

  try {
    const j = await apiFeed(sig, 0, PAGE);
    const rows = Array.isArray(j?.results) ? j.results : [];

    _rows = rows;
    _off = rows.length;
    _seen = new Set(rows.map(r => r?.key).filter(Boolean));

    stopSkeletonGrid();
    feedEl._g.innerHTML = "";
    paint(rows);

    writeHomeFeedCache({
      rows,
      sig,
      off: rows.length
    });

    sellersPromise.then(() => {
      if (_rows.length) repaint();
    });

    return rows.length;
  } catch (e) {
    console.error("[PC] first page:", e);
    stopSkeletonGrid();
    feedEl._g.innerHTML = "";
    return 0;
  } finally {
    document.body.classList.add("pc-home-ready");
  }
}

  async function loadMore() {
    if (_busy) return;
    _busy = true;
    if (feedEl._m) feedEl._m.hidden = true;
    try {
      const j    = await apiFeed(_sig, _off, PAGE);
      const rows = Array.isArray(j?.results) ? j.results : [];
      if (!rows.length) {
        // Server returned nothing — reset and start again from popular
        _off  = 0;
        _seen.clear();
        const j2    = await apiFeed({ brands:[], categories:[], keywords:[], seenKeys:[] }, 0, PAGE);
        const rows2 = Array.isArray(j2?.results) ? j2.results : [];
        _rows = _rows.concat(rows2);
        _off  = rows2.length;
        paint(rows2);
        return;
      }
      _rows = _rows.concat(rows);
      _off += rows.length;
      paint(rows);
    } catch(e) {
      console.error("[PC] loadMore:", e);
    } finally {
      _busy = false;
      if (feedEl._m) feedEl._m.hidden = true;
    }
  }

  // ── Infinite scroll (never ends) ─────────────────────────────────────────
  function wireScroll() {
    scaffold();
    const s = feedEl._s;
    if (!s || s._o) return; s._o = true;
    new IntersectionObserver(entries=>{
      for (const e of entries) {
        if (e.isIntersecting) {
          if (feedEl._m) feedEl._m.hidden = false;
          loadMore();
        }
      }
    }, { rootMargin: "1000px 0px", threshold: 0 }).observe(s);
  }

  // ── Trend pills ───────────────────────────────────────────────────────────
    const FALLBACK = [
    "TV",
    "Laptop",
    "Headphones",
    "Monitor",
    "Phone",
    "Tablet",
    "Camera",
    "Smartwatch",
    "Speaker",
    "Gaming",
    "Robot Vacuum",
    "Coffee Maker",
    "Router",
    "Keyboard",
    "Mouse",
    "Earbuds",
    "Soundbar",
    "Desktop",
    "Printer",
    "Console"
  ].map(label => ({ label, q: label }));

  function mkPills(sig) {
    if (!sig?.brands.length && !sig?.categories.length && !sig?.keywords.length) return FALLBACK;
    const bPills = sig.brands.slice(0,4).map(b=>({label:b[0].toUpperCase()+b.slice(1),q:b}));
    const cPills = sig.categories.slice(0,3).map(c=>({label:c[0].toUpperCase()+c.slice(1),q:c}));
    const kPills = sig.keywords.slice(0,3).map(k=>({label:k[0].toUpperCase()+k.slice(1),q:k}));
    const personal = [...bPills,...cPills,...kPills];
    const seen     = new Set(personal.map(p=>p.label.toLowerCase()));
    return [...personal,...FALLBACK.filter(t=>!seen.has(t.label.toLowerCase()))].slice(0,20);
  }
  function bHref(q){const s=slugify(q);return s?`/browse/${encodeURIComponent(s)}/`:"/browse/";}

  async function renderPills(sig) {
    if (!pillsEl) return;

    const fallback = mkPills(sig);
    paintPills(fallback);

    try {
      const r = await fetch("/api/home_trends", {
        headers: { Accept: "application/json" },
        cache: "no-cache"
      });

      if (!r.ok) return;

      const j = await r.json();
      const list = Array.isArray(j?.results) ? j.results : [];

      if (list.length) {
        paintPills(list);
      }
    } catch (_) {}
  }

  async function boot() {
  const cold = { brands: [], categories: [], keywords: [], seenKeys: [] };

  initHomeShortlistUi();

  const cached = readHomeFeedCache();
  if (cached?.rows?.length) {
    hydrateFromCache(cached);
    wireScroll();
    return;
  }

  let signedIn = false;
  try {
    signedIn = await getHomeViewerSignedIn();
  } catch (_) {
    signedIn = false;
  }

  if (!signedIn) {
  _sig = cold;
  renderPills(cold);
  await loadFirst(cold);
  wireScroll();
  return;
}

let sig = cold;

try {
  const r = await fetch("/api/history", {
    credentials: "same-origin",
    headers: { Accept: "application/json" }
  });

  const json = r.ok ? await r.json() : null;

  if (json?.signed_in && Array.isArray(json.results) && json.results.length) {
    const nextSig = extractSignals(json.results);

    if (nextSig.brands.length || nextSig.categories.length || nextSig.keywords.length) {
      sig = nextSig;
    }
  }
} catch (_) {}

_sig = sig;
renderPills(sig);
await loadFirst(sig);
wireScroll();
}

  boot();
})();