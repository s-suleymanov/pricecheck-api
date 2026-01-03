// public/insights/insights.js
(() => {
  const $ = (s) => document.querySelector(s);

  const SEC = {
    news: $("#sec-news"),
    updates: $("#sec-updates"),
    blogs: $("#sec-blogs"),
    guides: $("#sec-guides"),
    all: $("#sec-all"),
  };

  const lastUpdatedEl = $("#lastUpdated");

  const safeText = (v) => (v == null ? "" : String(v));

  const esc = (s) =>
    safeText(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

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

  // Supports your "quick line" format: "type | source | url | title | 2025-12-29"
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
          image_url: "",
        });
      } else if (x && typeof x === "object") {
        out.push({ ...x, type: normalizeType(x.type) });
      }
    }
    return out;
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
  function pickDate(p) {
    return parseDate(p.published_at) || parseDate(p.date) || null;
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

  function initialsForSource(p) {
    const s = safeText(pickSource(p)).trim();
    if (!s) return "PC";
    const words = s.split(/\s+/).filter(Boolean);
    const a = (words[0] || "P")[0] || "P";
    const b = (words[1] || words[0] || "C")[0] || "C";
    return (a + b).toUpperCase();
  }

  function renderTwoCol(el, posts, opts = {}) {
    if (!el) return;

    const list = Array.isArray(posts) ? posts.slice() : [];
    list.sort((a, b) => (pickDate(b)?.getTime() || 0) - (pickDate(a)?.getTime() || 0));

    const heroCount = opts.heroCount ?? 2;
    const maxRows = opts.maxRows ?? 20;

    const withImages = list.filter((p) => pickImg(p));
    const heroes = withImages.slice(0, heroCount);
    const heroSet = new Set(heroes);

    let rest = list.filter((p) => !heroSet.has(p));
    if (!rest.length) rest = list.slice();

    const leftHtml = heroes
      .map((p) => {
        const title = esc(pickTitle(p));
        const source = esc(pickSource(p));
        const ago = esc(timeAgo(pickDate(p)));
        const desc = esc(pickSummary(p));
        const url = pickUrl(p);
        const href = url || "#";
        const target = url && isExternalUrl(url) ? ` target="_blank" rel="noopener"` : "";

        const img = pickImg(p);
        const imgHtml = img
          ? `<img class="ins-hero-card__img" src="${esc(img)}" alt="">`
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

      const rightHtml = rest.slice(0, maxRows).map((p) => {
      const title = esc(pickTitle(p));
      const source = esc(pickSource(p));
      const ago = esc(timeAgo(pickDate(p)));
      const meta = [source, ago].filter(Boolean).join(" • ");

      const url = pickUrl(p);
      const href = url || "#";
      const target = url && isExternalUrl(url) ? ` target="_blank" rel="noopener"` : "";
      const avatarHtml = thumbHtmlForPost(p);

      return `
        <a class="ins-item" href="${esc(href)}"${target}>
          ${avatarHtml}
          <div class="ins-item__main">
            <p class="ins-item__title">${title}</p>
            <div class="ins-item__meta">${esc(meta)}</div>
          </div>
        </a>
      `;
    }).join("");

    // THIS is the key: ins-left + ins-feed makes the two-column layout
    el.innerHTML = `
      <div class="ins-left">${leftHtml}</div>
      <div class="ins-feed">${rightHtml}</div>
    `;
  }

  const LOGO_DIR = "/insights/logo";
  const LOGO_MAP = window.__PC_LOGO_MAP || {};

  function keyFromUrl(url) {
    const u = safeText(url).trim();
    if (!u) return "";
    try {
      const host = new URL(u).hostname.toLowerCase().replace(/^www\./, "");
      if (host.includes("theverge.")) return "theverge";
      if (host.includes("techcrunch.")) return "techcrunch";
      if (host.includes("wired.")) return "wired";
      if (host.includes("consumerreports.")) return "consumerreports";
      if (host.includes("forbes.")) return "forbes";
      if (host.includes("mashable.")) return "mashable";
      if (host.includes("techspot.")) return "techspot";
      if (host.includes("cnet.")) return "cnet";
      return host.split(".")[0] || "";
    } catch {
      return "";
    }
  }

  function keyFromSource(source) {
    return safeText(source).trim().toLowerCase();
  }

  function logoPathForPost(p) {
    const explicit = safeText(p.logo || p.logo_url || "").trim();
    if (explicit) {
      if (/^https?:\/\//i.test(explicit) || explicit.startsWith("/")) return explicit;
      return `${LOGO_DIR}/${explicit}`;
    }

    const byUrl = keyFromUrl(pickUrl(p));
    if (byUrl && LOGO_MAP[byUrl]) return `${LOGO_DIR}/${LOGO_MAP[byUrl]}`;

    const bySource = keyFromSource(pickSource(p));
    if (bySource && LOGO_MAP[bySource]) return `${LOGO_DIR}/${LOGO_MAP[bySource]}`;

    return "";
  }

  function avatarHtmlForPost(p) {
    const logo = logoPathForPost(p);
    if (logo) {
      const alt = esc(pickSource(p) || "Source");
      return `<img class="ins-item__avatar" src="${esc(logo)}" alt="${alt}" loading="lazy" decoding="async">`;
    }

    const initials = esc(initialsForSource(p));
    return `<span class="ins-item__avatar is-fallback" aria-hidden="true">${initials}</span>`;
  }

  function thumbHtmlForPost(p) {
    const img = pickImg(p);
    if (img) {
      const alt = esc(pickTitle(p) || "Image");
      return `<img class="ins-item__avatar" src="${esc(img)}" alt="${alt}" loading="lazy" decoding="async">`;
    }
    return avatarHtmlForPost(p);
  }

  function setActiveTabFromHash() {
    const hash = (location.hash || "#news").replace("#", "").toLowerCase();
    const valid = new Set(["news", "updates", "blogs", "guides", "library"]);

    const target = valid.has(hash) ? hash : "news";

    document.querySelectorAll(".ins-tab").forEach((a) => {
      const h = (a.getAttribute("href") || "").replace("#", "").toLowerCase();
      a.classList.toggle("is-active", h === target);
    });

    // Hide all sections except the active one (so you don’t see everything stacked vertically)
    document.querySelectorAll(".ins-section").forEach((sec) => {
      sec.hidden = sec.id !== target;
    });
  }

  async function loadPosts() {
    const res = await fetch("/api/insights/posts", {
      headers: { Accept: "application/json" },
      cache: "no-cache",
    });
    if (!res.ok) throw new Error("Failed to load /api/insights/posts");
    const raw = await res.json();
    return expandQuickLines(Array.isArray(raw) ? raw : []);
  }

  function splitByType(posts) {
    const out = { news: [], updates: [], blogs: [], guides: [], all: [] };
    for (const p of posts) {
      const t = normalizeType(p.type);
      out.all.push(p);
      if (t === "news") out.news.push(p);
      else if (t === "blogs") out.blogs.push(p);
      else if (t === "guides") out.guides.push(p);
      else out.updates.push(p);
    }
    return out;
  }

  async function run() {
    const posts = await loadPosts();
    const buckets = splitByType(posts);

    renderTwoCol(SEC.news, buckets.news, { heroCount: 2, maxRows: 22 });
    renderTwoCol(SEC.updates, buckets.updates, { heroCount: 2, maxRows: 22 });
    renderTwoCol(SEC.blogs, buckets.blogs, { heroCount: 2, maxRows: 22 });
    renderTwoCol(SEC.guides, buckets.guides, { heroCount: 2, maxRows: 22 });

    // All can be one big feed; keep it two-col too if you want
    renderTwoCol(SEC.all, buckets.all, { heroCount: 2, maxRows: 50 });

    setActiveTabFromHash();

    // Keep tab highlighting + section visibility in sync with hash changes
    window.addEventListener("hashchange", setActiveTabFromHash);

    // Also intercept tab clicks so it feels instant
    document.querySelectorAll(".ins-tab").forEach((a) => {
      a.addEventListener("click", () => {
        // let hash change happen, our handler will do the rest
        requestAnimationFrame(setActiveTabFromHash);
      });
    });

    if (lastUpdatedEl) {
      const newest = posts
        .map((p) => pickDate(p))
        .filter(Boolean)
        .sort((a, b) => b.getTime() - a.getTime())[0];
      lastUpdatedEl.textContent = newest ? `Last updated ${timeAgo(newest)}.` : `Loaded ${posts.length} posts.`;
    }
  }

  run().catch((err) => {
    console.error("INSIGHTS FAILED:", err);
    if (lastUpdatedEl) lastUpdatedEl.textContent = "Failed to load posts.";
  });
})();
