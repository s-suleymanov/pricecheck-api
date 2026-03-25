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

  const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const esc = s => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
  const $   = id => document.getElementById(id);
  const c2u = c  => { const n = Number(c); return Number.isFinite(n) ? fmt.format(n/100) : "—"; };

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
  let _sp = null;
  function getSellers() {
    if (_sp) return _sp;
    _sp = fetch("/data/sellers.json",{headers:{Accept:"application/json"}})
      .then(r=>r.ok?r.json():{}).then(j=>j&&typeof j==="object"?j:{}).catch(()=>({}));
    return _sp;
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

    // brand/manufacturer first
    if (brand) pushIcon(brand, brand);

    // then stores, but never duplicate the brand/store already shown
    for (const st of uniq(stores || []).slice(0, 2)) {
      pushIcon(st, st);
    }

    return icons.slice(0, 3).map(it => {
      const t = esc(it.label);
      return it.u
        ? `<span class="home-deal__icon" title="${t}"><img src="${esc(it.u)}" alt="" loading="lazy" decoding="async" onerror="this.closest('.home-deal__icon')?.remove()"></span>`
        : `<span class="home-deal__icon home-deal__icon--fallback" title="${t}">${esc(it.fb)}</span>`;
    }).join("");
  }
  function cardHtml(item, S) {
    const title  = esc(item.title||"Product");
    const img    = String(item.image_url||"").trim();
    const href   = esc(dashHref(item.key));
    const imgTag = img
      ?`<img class="home-deal__img" src="${esc(img)}" alt="" loading="lazy" decoding="async">`
      :`<div class="home-deal__img is-empty" aria-hidden="true"></div>`;
    return `<a class="home-deal" href="${href}">${imgTag}<div class="home-deal__body"><div class="home-deal__icons" aria-hidden="true">${iconsHtml({brand:item.brand,stores:item.stores},S)}</div><div class="home-deal__content"><div class="home-deal__title">${title}</div><div class="home-deal__meta"><span class="home-deal__price">${c2u(item.min_price_cents)}</span><span class="home-deal__range"> – ${c2u(item.max_price_cents)}</span></div></div></div></a>`;
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
  let _done  = false;
  let _busy  = false;
  const PAGE = 24;

  
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
    feedEl._g.insertAdjacentHTML("beforeend", rows.map(r=>cardHtml(r,S)).join(""));
    rows.forEach(r=>{ if(r.key) _seen.add(r.key); });
  }
  function repaint() {
    if (!feedEl._rdy) return;
    const S = window.__pcSellersMap || {};
    feedEl._g.innerHTML = _rows.map(r=>cardHtml(r,S)).join("");
  }


  function swap(rows) {
  if (!rows?.length) return;
  scaffold();

  feedEl._g.style.transition = "opacity .2s";
  feedEl._g.style.opacity = "0";

  requestAnimationFrame(() => {
    feedEl._g.innerHTML = rows.map(r => cardHtml(r, window.__pcSellersMap || {})).join("");
    _seen = new Set(rows.map(r => r.key).filter(Boolean));

    requestAnimationFrame(() => {
      feedEl._g.style.opacity = "1";
    });
  });
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

    async function loadFirst(sig) {
    _bootLoading = true;
    scaffold(true);

         try {
        const j    = await apiFeed(sig, 0, PAGE);
        const rows = Array.isArray(j?.results) ? j.results : [];
        _rows = rows;
        _off = rows.length;
        _done = false;

        stopSkeletonGrid();
        feedEl._g.innerHTML = "";
        paint(rows);
        return rows.length;
    } catch(e) {
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
    // Never permanently done — if we somehow emptied the feed, reset offset
    // and start showing popular items again (endless loop)
    if (_done) {
      _off  = 0;
      _seen.clear();
      _done = false;
    }
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
  const FALLBACK = ["Apple","Samsung","Sony","LG","Dell","HP","TV","Laptop","Headphones","Monitor","Phone","Tablet","Camera","Smartwatch","Speaker","Gaming","Robot Vacuum","Coffee Maker","Router","Keyboard"]
    .map(label=>({label,q:label}));

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
    let list = [];
    try {
      const r = await fetch("/api/home_trends",{headers:{Accept:"application/json"},cache:"no-cache"});
      if (r.ok){const j=await r.json();list=Array.isArray(j.results)?j.results:[];}
    } catch(_){}
    list = list.length ? list : mkPills(sig);
    if (!list.length){pillsEl.hidden=true;return;}
    pillsEl.hidden = false;
    pillsEl.innerHTML = list.map(x=>`<a class="home-pill" href="${esc(x.href?String(x.href):bHref(x.q||x.label||""))}">${esc(x.label||x.title||"")}</a>`).join("");
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  async function boot() {
    const cold = { brands:[], categories:[], keywords:[], seenKeys:[] };

    // Fire history in parallel — don't wait for it before showing content
    const histP = fetch("/api/history",{headers:{Accept:"application/json"},cache:"no-cache"})
      .then(r=>r.ok?r.json():null).catch(()=>null);

    // Show shimmer → cold popular feed immediately
    await loadFirst(cold);
    _sig = cold;
    wireScroll();
    setTimeout(()=>renderPills(cold), 0);

    // Logos in background
    const doLogos = async()=>{
      try{window.__pcSellersMap=await getSellers();repaint();}catch(_){}
    };
    "requestIdleCallback" in window ? requestIdleCallback(doLogos) : setTimeout(doLogos, 0);

    // Personalization: once history loads, enrich signals and swap feed
    histP.then(async json=>{
      if (!json?.signed_in || !json.results?.length) return;
      const sig = extractSignals(json.results);
      if (!sig.brands.length && !sig.categories.length && !sig.keywords.length) return;
      try {
        const j    = await apiFeed(sig, 0, PAGE);
        const rows = Array.isArray(j?.results) ? j.results : [];
        if (rows.length >= 4) {
          _rows = rows; _off = rows.length; _done = false;
          _sig  = sig;
          swap(rows);
        }
        setTimeout(()=>renderPills(sig), 0);
      } catch(e) { console.error("[PC] personalize:", e); }
    });
  }

  boot();
})();