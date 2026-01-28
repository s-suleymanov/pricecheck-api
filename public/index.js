// public/index.js
(() => {
  const $ = (s) => document.querySelector(s);

  const LOGO_DIR = "/insights/logo";
  const LOGO_MAP = window.__PC_LOGO_MAP || {};

  const safeText = (v) => (v == null ? "" : String(v));

  const esc = (s) =>
    safeText(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

  function keyFromUrl(url) {
    const u = safeText(url).trim();
    if (!u) return "";
    try {
      const host = new URL(u).hostname.toLowerCase().replace(/^www\./, "");
      if (host.includes("cnet.")) return "cnet";
      return host.split(".")[0] || "";
    } catch {
      return "";
    }
  }

  function keyFromSource(source) {
    return safeText(source).trim().toLowerCase();
  }

  function pickTitle(p) {
    return safeText(p.title || p.name || "Untitled").trim() || "Untitled";
  }
  function pickSource(p) {
    return safeText(p.source || p.publisher || p.site || "PriceCheck").trim() || "PriceCheck";
  }
  function pickUrl(p) {
    return safeText(p.url || p.link || "").trim();
  }
  function pickSummary(p) {
    return safeText(p.summary || p.excerpt || p.description || "").trim();
  }
  function pickImg(p) {
    return safeText(p.image_url || p.imageUrl || p.og_image || p.cover || p.thumbnail || "").trim();
  }
  function isExternalUrl(url) {
    return /^https?:\/\//i.test(url);
  }

  function logoPathForPost(p) {
    const byUrl = keyFromUrl(pickUrl(p));
    if (byUrl && LOGO_MAP[byUrl]) return `${LOGO_DIR}/${LOGO_MAP[byUrl]}`;
    const bySource = keyFromSource(pickSource(p));
    if (bySource && LOGO_MAP[bySource]) return `${LOGO_DIR}/${LOGO_MAP[bySource]}`;
    return "";
  }

  function initialsForSource(p) {
    const s = safeText(pickSource(p)).trim();
    if (!s) return "PC";
    const words = s.split(/\s+/).filter(Boolean);
    const a = (words[0] || "P")[0] || "P";
    const b = (words[1] || words[0] || "C")[0] || "C";
    return (a + b).toUpperCase();
  }

  function avatarHtmlForPost(p) {
    const logo = logoPathForPost(p);
    if (logo) {
      // decoding=async + loading=lazy keeps it cheap; fetchpriority=low keeps it out of the way
      return `<img class="ins-item__avatar" src="${esc(logo)}" alt="${esc(
        pickSource(p) || "Source"
      )}" loading="lazy" decoding="async" fetchpriority="low">`;
    }
    return `<span class="ins-item__avatar is-fallback" aria-hidden="true">${esc(
      initialsForSource(p)
    )}</span>`;
  }

  function thumbHtmlForPost(p) {
    const img = pickImg(p);
    if (img) {
      return `<img class="ins-item__avatar" src="${esc(img)}" alt="${esc(
        pickTitle(p) || "Image"
      )}" loading="lazy" decoding="async" fetchpriority="low">`;
    }
    return avatarHtmlForPost(p);
  }

  function parseDate(v) {
    const s = safeText(v).trim();
    if (!s) return null;
    const d = new Date(s);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  function timeAgo(d) {
    if (!d) return "";
    const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);

    if (diffSec < 0) {
      const sec = Math.abs(diffSec);
      const min = Math.floor(sec / 60);
      if (min < 60) return `in ${min} min`;
      const hr = Math.floor(min / 60);
      if (hr < 24) return `in ${hr} hour${hr === 1 ? "" : "s"}`;
      const day = Math.floor(hr / 24);
      return `in ${day} day${day === 1 ? "" : "s"}`;
    }

    if (diffSec < 60) return "just now";
    const min = Math.floor(diffSec / 60);
    if (min < 60) return `${min} min ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
    const mo = Math.floor(day / 30);
    if (mo < 12) return `${mo} month${mo === 1 ? "" : "s"} ago`;
    const yr = Math.floor(mo / 12);
    return `${yr} year${yr === 1 ? "" : "s"} ago`;
  }

  function normalizeType(t) {
    const s = safeText(t).trim().toLowerCase();
    if (!s) return "updates";
    if (s === "news") return "news";
    if (s === "updates" || s === "update") return "updates";
    if (s === "blog" || s === "blogs") return "blogs";
    if (s === "guide" || s === "guides") return "guides";
    if (s.includes("news")) return "news";
    if (s.includes("update")) return "updates";
    if (s.includes("blog")) return "blogs";
    if (s.includes("guide")) return "guides";
    return "updates";
  }

  function expandQuickLines(arr) {
    const out = [];
    for (const x of Array.isArray(arr) ? arr : []) {
      if (typeof x === "string") {
        const parts = x.split("|").map((s) => s.trim());
        const type = normalizeType(parts[0] || "updates");
        const source = parts[1] || "PriceCheck";
        const url = parts[2] || "";
        const title = (parts[3] || "").trim() || "Untitled";
        const dateStr = (parts[4] || "").trim();
        const d = parseDate(dateStr);

        out.push({
          type,
          source,
          url,
          title,
          published_at: d ? d.toISOString() : "",
          summary: "",
          image_url: ""
        });
      } else if (x && typeof x === "object") {
        out.push({ ...x, type: normalizeType(x.type) });
      }
    }
    return out;
  }

  function bucketPosts(posts) {
    const b = { news: [], blogs: [], guides: [], updates: [] };
    for (const p of posts) {
      const t = normalizeType(p.type);
      if (t === "news") b.news.push(p);
      else if (t === "blogs") b.blogs.push(p);
      else if (t === "guides") b.guides.push(p);
      else b.updates.push(p);
    }

    for (const k of Object.keys(b)) {
      b[k].sort((a, b2) => (parseDate(b2.published_at)?.getTime() || 0) - (parseDate(a.published_at)?.getTime() || 0));
    }
    return b;
  }

  function currentTabFromHash() {
    const h = (location.hash || "#news").replace("#", "").toLowerCase();
    if (h === "blogs" || h === "guides" || h === "updates" || h === "news" || h === "trends") return h;
    return "news";
  }

  function setActiveHomeTab(type) {
    document.querySelectorAll(".home-tab[data-home-tab]").forEach((a) => {
      a.classList.toggle("is-active", a.dataset.homeTab === type);
    });
  }

  function titleFor(type) {
    if (type === "news") return "News";
    if (type === "trends") return "Trends";
    if (type === "blogs") return "Blogs";
    if (type === "guides") return "Guides";
    if (type === "updates") return "Updates";
    return "News";
  }

  function renderTwoCol(containerEl, posts, opts = {}) {
    const list = Array.isArray(posts) ? posts.slice() : [];
    list.sort((a, b) => (parseDate(b.published_at)?.getTime() || 0) - (parseDate(a.published_at)?.getTime() || 0));

    const heroCount = opts.heroCount ?? 2;
    const maxRows = opts.maxRows ?? 22;

    if (!list.length) {
      containerEl.innerHTML = `
        <div class="ins-left">
          <div class="ins-hero-card">
            <div class="ins-hero-card__body">
              <div class="ins-hero-card__meta">PriceCheck</div>
              <div class="ins-hero-card__title">No posts yet</div>
              <p class="ins-hero-card__desc">Nothing to show here yet.</p>
            </div>
          </div>
        </div>
        <div class="ins-feed"></div>
      `;
      return;
    }

    const withImages = list.filter((p) => pickImg(p));
    const heroes = withImages.slice(0, heroCount);
    const heroSet = new Set(heroes);

    let rest = list.filter((p) => !heroSet.has(p));
    if (!rest.length) rest = list.slice();

    const leftHtml = heroes
      .map((p) => {
        const title = esc(pickTitle(p));
        const source = esc(pickSource(p));
        const ago = esc(timeAgo(parseDate(p.published_at) || parseDate(p.date)));
        const desc = esc(pickSummary(p));
        const url = pickUrl(p);
        const href = url || "#";
        const target = url && isExternalUrl(url) ? ` target="_blank" rel="noopener"` : "";

        const img = pickImg(p);
        const imgHtml = img
          ? `<img class="ins-hero-card__img" src="${esc(img)}" alt="" loading="lazy" decoding="async" fetchpriority="low">`
          : `<div class="ins-hero-card__img" aria-hidden="true"></div>`;

        return `
          <a class="ins-hero-card" href="${esc(href)}"${target}>
            ${imgHtml}
            <div class="ins-hero-card__body">
              <div class="ins-hero-card__meta">${source} • ${ago}</div>
              <div class="ins-hero-card__title">${title}</div>
              ${desc ? `<p class="ins-hero-card__desc">${desc}</p>` : ``}
            </div>
          </a>
        `;
      })
      .join("");

    const rightHtml = rest
      .slice(0, maxRows)
      .map((p) => {
        const title = esc(pickTitle(p));
        const url = pickUrl(p);
        const href = url || "#";
        const target = url && isExternalUrl(url) ? ` target="_blank" rel="noopener"` : "";
        const avatarHtml = thumbHtmlForPost(p);

        return `
          <a class="ins-item" href="${esc(href)}"${target}>
            ${avatarHtml}
            <div class="ins-item__main">
              <p class="ins-item__title">${title}</p>
            </div>
          </a>
        `;
      })
      .join("");

    containerEl.innerHTML = `
      <div class="ins-left">${leftHtml}</div>
      <div class="ins-feed">${rightHtml}</div>
    `;
  }

  async function loadPosts() {
    const res = await fetch("/api/insights/posts", {
      headers: { Accept: "application/json" },
      cache: "no-cache"
    });
    if (!res.ok) throw new Error(`GET /api/insights/posts failed (${res.status})`);
    const raw = await res.json();
    return expandQuickLines(Array.isArray(raw) ? raw : []);
  }

  async function loadTrends() {
    const res = await fetch("/data/trends.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`GET /data/trends.json failed (${res.status})`);
    return await res.json();
  }

  function fmtPct(n) {
    const v = Number(n);
    if (!isFinite(v)) return "NA";
    const sign = v > 0 ? "+" : "";
    return sign + v.toFixed(1) + "%";
  }

  function renderTrends(containerEl, t) {
    const e = (s) =>
      String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

    const highlights = Array.isArray(t.highlights) ? t.highlights : [];
    const movers = Array.isArray(t.movers) ? t.movers : [];
    const cats = Array.isArray(t.categories) ? t.categories : [];
    const watch = Array.isArray(t.watchlist) ? t.watchlist : [];
    const alerts = Array.isArray(t.alerts) ? t.alerts : [];

    const hiHtml = highlights
      .map(
        (x) => `
      <div class="trends-card">
        <p class="trends-card__k">${e(x.label)}</p>
        <p class="trends-card__v">${e(x.value)}</p>
        <p class="trends-card__n">${e(x.note)}</p>
      </div>
    `
      )
      .join("");

    const moversHtml = movers
      .map((x) => {
        const pct = Number(x.movePct);
        const pillCls = pct > 0 ? "trends-pill is-up" : pct < 0 ? "trends-pill is-down" : "trends-pill";
        const href = x.url || "#";
        return `
        <a class="trends-row" href="${e(href)}">
          <span class="${pillCls}">${e(fmtPct(pct))}</span>
          <div class="trends-row__main">
            <p class="trends-row__title">${e(x.title)}</p>
            <p class="trends-row__meta">${e(x.category)} • Lowest: ${e(x.lowestStore)} ${
          x.lowestPrice != null ? "$" + Number(x.lowestPrice).toFixed(2) : ""
        }</p>
          </div>
        </a>
      `;
      })
      .join("");

    const catsHtml = cats
      .map(
        (x) => `
      <div class="trends-row">
        <span class="trends-pill">${e(fmtPct(x.trendPct))}</span>
        <div class="trends-row__main">
          <p class="trends-row__title">${e(x.name)}</p>
          <p class="trends-row__meta">${e(x.note || "")}</p>
        </div>
      </div>
    `
      )
      .join("");

    const watchHtml = watch
      .map(
        (x) => `
      <a class="trends-row" href="${e(x.go || "#")}">
        <span class="trends-pill">Watch</span>
        <div class="trends-row__main">
          <p class="trends-row__title">${e(x.title)}</p>
          <p class="trends-row__meta">${e(x.why || "")}</p>
        </div>
      </a>
    `
      )
      .join("");

    const alertsHtml = alerts
      .map(
        (x) => `
      <a class="trends-row" href="${e(x.url || "#")}" target="_blank" rel="noopener">
        <span class="trends-pill">Alert</span>
        <div class="trends-row__main">
          <p class="trends-row__title">${e(x.title)}</p>
          <p class="trends-row__meta">${e(x.note || "")}</p>
        </div>
      </a>
    `
      )
      .join("");

    containerEl.innerHTML = `
      <div class="trends">
        <div class="trends-grid">${hiHtml}</div>

        <div class="trends-card">
          <p class="trends-card__k">Big movers</p>
          ${moversHtml || `<p class="trends-card__n">No movers yet.</p>`}
        </div>

        <div class="trends-card">
          <p class="trends-card__k">Category trend</p>
          ${catsHtml || `<p class="trends-card__n">No categories yet.</p>`}
        </div>

        <div class="trends-card">
          <p class="trends-card__k">Watchlist</p>
          ${watchHtml || `<p class="trends-card__n">No watchlist yet.</p>`}
        </div>

        <div class="trends-card">
          <p class="trends-card__k">Alerts</p>
          ${alertsHtml || `<p class="trends-card__n">No alerts yet.</p>`}
        </div>
      </div>
    `;
  }

  // -----------------------------
  // Lazy Insights boot
  // -----------------------------
  const insListEl = $("#homeInsList");
  const insTitleEl = $("#homeInsTitle");
  const homeInsSection = $("#homeIns");

  if (!insListEl) {
    console.warn("index.js: missing #homeInsList (two-column container).");
    return;
  }

  let insightsStarted = false;
  let bucketsCache = null;

  function setTrendsMode(on) {
    insListEl.classList.toggle("is-trends", !!on);
  }

  function scrollToTabsRow() {
    const tabs = document.querySelector(".home-tabs");
    const header = document.querySelector("header");
    const target = tabs || header || document.body;
    requestAnimationFrame(() => target.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function wireTabsWhenReady() {
    document.querySelectorAll(".home-tab[data-home-tab]").forEach((a) => {
      a.addEventListener("click", async (e) => {
        const t = (a.dataset.homeTab || "").toLowerCase();
        if (!(t === "news" || t === "blogs" || t === "guides" || t === "updates" || t === "trends")) return;

        e.preventDefault();

        // If user clicks tabs before scrolling, start Insights immediately
        if (!insightsStarted) await startInsights();

        const next = t;
        if (location.hash !== `#${next}`) history.replaceState(null, "", `#${next}`);

        setActiveHomeTab(next);
        if (insTitleEl) insTitleEl.textContent = titleFor(next);

        if (next === "trends") {
          try {
            const data = await loadTrends();
            setTrendsMode(true);
            renderTrends(insListEl, data);
            scrollToTabsRow();
          } catch (err) {
            console.error(err);
            setTrendsMode(true);
            insListEl.innerHTML =
              `<div class="ins-left"><div class="ins-hero-card"><div class="ins-hero-card__body">` +
              `<div class="ins-hero-card__meta">Error</div>` +
              `<div class="ins-hero-card__title">Could not load Trends</div>` +
              `<p class="ins-hero-card__desc">Check /data/trends.json</p>` +
              `</div></div></div><div class="ins-feed"></div>`;
            scrollToTabsRow();
          }
          return;
        }

        setTrendsMode(false);
        renderTwoCol(insListEl, (bucketsCache?.[next] || []), { heroCount: 2, maxRows: 22 });
        scrollToTabsRow();
      });
    });

    window.addEventListener("hashchange", async () => {
      const t = currentTabFromHash();
      setActiveHomeTab(t);
      if (insTitleEl) insTitleEl.textContent = titleFor(t);

      if (!insightsStarted) return;

      if (t === "trends") {
        try {
          const data = await loadTrends();
          setTrendsMode(true);
          renderTrends(insListEl, data);
        } catch (err) {
          console.error(err);
          setTrendsMode(true);
          insListEl.innerHTML =
            `<div class="ins-left"><div class="ins-hero-card"><div class="ins-hero-card__body">` +
            `<div class="ins-hero-card__meta">Error</div>` +
            `<div class="ins-hero-card__title">Could not load Trends</div>` +
            `<p class="ins-hero-card__desc">Check /data/trends.json</p>` +
            `</div></div></div><div class="ins-feed"></div>`;
        }
        return;
      }

      setTrendsMode(false);
      renderTwoCol(insListEl, (bucketsCache?.[t] || []), { heroCount: 2, maxRows: 22 });
    });
  }

  async function startInsights() {
    if (insightsStarted) return;
    insightsStarted = true;

    // Optional: show a tiny placeholder while the fetch happens
    insListEl.innerHTML =
      `<div class="ins-left"><div class="ins-hero-card"><div class="ins-hero-card__body">` +
      `<div class="ins-hero-card__meta">Loading</div>` +
      `<div class="ins-hero-card__title">Fetching updates</div>` +
      `</div></div></div><div class="ins-feed"></div>`;

    try {
      const posts = await loadPosts();
      bucketsCache = bucketPosts(posts);

      const initial = currentTabFromHash();
      setActiveHomeTab(initial);
      if (insTitleEl) insTitleEl.textContent = titleFor(initial);

      if (initial === "trends") {
        try {
          const data = await loadTrends();
          setTrendsMode(true);
          renderTrends(insListEl, data);
        } catch (err) {
          console.error(err);
          setTrendsMode(true);
          insListEl.innerHTML =
            `<div class="ins-left"><div class="ins-hero-card"><div class="ins-hero-card__body">` +
            `<div class="ins-hero-card__meta">Error</div>` +
            `<div class="ins-hero-card__title">Could not load Trends</div>` +
            `<p class="ins-hero-card__desc">Check /data/trends.json</p>` +
            `</div></div></div><div class="ins-feed"></div>`;
        }
      } else {
        setTrendsMode(false);
        renderTwoCol(insListEl, bucketsCache[initial] || [], { heroCount: 2, maxRows: 22 });
      }
    } catch (err) {
      console.error("HOME INDEX FAILED:", err);
      insListEl.innerHTML =
        `<div class="ins-left"><div class="ins-hero-card"><div class="ins-hero-card__body">` +
        `<div class="ins-hero-card__meta">Error</div>` +
        `<div class="ins-hero-card__title">Could not load /api/insights/posts</div>` +
        `<p class="ins-hero-card__desc">Open DevTools Console to see the error.</p>` +
        `</div></div></div><div class="ins-feed"></div>`;
    }
  }

  function setupLazyInsights() {
    // If the user never scrolls, nothing loads.
    // If they click a tab, startInsights runs immediately via wireTabsWhenReady.

    if (!homeInsSection || !("IntersectionObserver" in window)) {
      // Fallback: do not auto-load; user can still trigger by clicking tabs.
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.some((e) => e.isIntersecting);
        if (!hit) return;
        io.disconnect();
        startInsights();
      },
      // Start a bit before it is visible, so it feels instant when they reach it
      { root: null, threshold: 0.01, rootMargin: "600px 0px" }
    );

    io.observe(homeInsSection);
  }

  // Boot (fast path)
  wireTabsWhenReady();
  setupLazyInsights();
})();