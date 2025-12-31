// public/insights/insights.js
(() => {
  const $ = (s) => document.querySelector(s);
  function safeText(v) {
    return v == null ? "" : String(v);
  }

  function escapeHtml(s) {
    return safeText(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
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

  // future dates
  if (diffSec < 0) {
    const sec = Math.abs(diffSec);
    const min = Math.floor(sec / 60);
    if (min < 60) return `in ${min} min`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `in ${hr} hour${hr === 1 ? "" : "s"}`;
    const day = Math.floor(hr / 24);
    return `in ${day} day${day === 1 ? "" : "s"}`;
  }

  // past dates
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

  function isExternalUrl(url) {
    return /^https?:\/\//i.test(url);
  }

  function normalizeType(t) {
  const s = safeText(t).trim().toLowerCase();
  if (!s) return "updates";

  if (s === "news") return "news";
  if (s === "updates" || s === "update") return "updates";

  // allow singular and other variants
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
      // Format:
      // "type | source | url | title | 2025-12-29"
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
        summary: ""
      });
    } else if (x && typeof x === "object") {
      out.push({
        ...x,
        type: normalizeType(x.type)
      });
    }
  }
  return out;
}

  function normKey(s) {
  return safeText(s).trim().toLowerCase();
}

  function pickAvatarUrl(p) {
  const direct =
    safeText(p.avatar_url || p.avatar || p.logo_url || p.source_logo || "").trim();
  if (direct) return direct;

  const src = normKey(pickSource(p));

  const map = {
    "pricecheck": "/insights/logo/logo.png",
    "wired.com": "/insights/logo/wired.webp",
    "cnet.com": "/insights/logo/cnet.png",
    "techspot.com": "/insights/logo/techspot.png",
    "forbes.com": "/insights/logo/forbes.png",
    "mashable.com": "/insights/logo/mashables.png",
    "techcrunch.com": "/insights/logo/techcrunch.png",
    "nbc news": "/insights/logo/nbc-news.png",
    "consumerreports.org": "/insights/logo/crs.webp",
    "theverge.com": "/insights/logo/verge.webp",
    "engadget": "/insights/logo/engadget.png",
  };

  return map[src] || "";
}

  function initialsForSource(p) {
    const s = safeText(pickSource(p)).trim();
    if (!s) return "PC";
    const words = s.split(/\s+/).filter(Boolean);
    const a = (words[0] || "P")[0] || "P";
    const b = (words[1] || words[0] || "C")[0] || "C";
    return (a + b).toUpperCase();
  }

  function pickDate(p) {
    return parseDate(p.published_at) || parseDate(p.date) || null;
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
    return safeText(
      p.image_url || p.imageUrl || p.og_image || p.cover || p.thumbnail || ""
    ).trim();
  }

  function sortNewestFirst(posts) {
    return posts.slice().sort((a, b) => {
      const ta = (pickDate(a)?.getTime() || 0);
      const tb = (pickDate(b)?.getTime() || 0);
      return tb - ta;
    });
  }

  function bySection(posts) {
  const map = { news: [], updates: [], blogs: [], guides: [], all: [] };

  for (const p of posts) {
    const t = normalizeType(p?.type);
    const fixed = { ...p, type: t };

    map.all.push(fixed);
    (map[t] || map.updates).push(fixed);
  }

  return map;
}

  function renderSection(elId, posts, opts = {}) {
  const el = document.getElementById(elId);
  if (!el) return;

  const list = Array.isArray(posts) ? posts.slice() : [];
  const heroCount = opts.heroCount ?? 2;

  // If empty, show nothing (you can keep your "No posts yet" template if you want)
  if (!list.length) {
    el.innerHTML = `
      <div class="ins-left">
        <div class="ins-hero-card">
          <div class="ins-hero-card__body">
            <div class="ins-hero-card__meta">PriceCheck • no posts</div>
            <div class="ins-hero-card__title">No posts yet</div>
            <p class="ins-hero-card__desc">Check back later</p>
          </div>
        </div>
      </div>
      <div class="ins-feed"></div>
    `;
    return;
  }

  // Sort newest first
  list.sort((a, b) => +new Date(pickDate(b)) - +new Date(pickDate(a)));

  const withImages = list.filter(p => pickImg(p));
  const heroes = withImages.slice(0, heroCount);

  const heroSet = new Set(heroes);
  let rest = list.filter((p) => !heroSet.has(p));

  // If not enough posts, still fill right side
  if (!rest.length) rest = list.slice();

  const leftHtml = heroes.map((p) => {
    const title = escapeHtml(pickTitle(p));
    const source = escapeHtml(pickSource(p));
    const ago = timeAgo(pickDate(p));
    const desc = escapeHtml(pickSummary(p));
    const url = pickUrl(p);
    const href = url || "#";
    const target = url && isExternalUrl(url) ? ` target="_blank" rel="noopener"` : "";

    const img = pickImg(p);
    const imgHtml = img
      ? `<img class="ins-hero-card__img" src="${escapeHtml(img)}" alt="">`
      : `<div class="ins-hero-card__img" aria-hidden="true"></div>`;

    return `
      <a class="ins-hero-card" href="${escapeHtml(href)}"${target}>
        ${imgHtml}
        <div class="ins-hero-card__body">
          <div class="ins-hero-card__meta">${source} • ${escapeHtml(ago)}</div>
          <div class="ins-hero-card__title">${title}</div>
          ${desc ? `<p class="ins-hero-card__desc">${desc}</p>` : ``}
        </div>
      </a>
    `;
  }).join("");

  const rightHtml = rest.slice(0, 20).map((p) => {
    const title = escapeHtml(pickTitle(p));
    const source = escapeHtml(pickSource(p));
    const ago = timeAgo(pickDate(p));
    const meta = [source, ago].filter(Boolean).join(" • ");

    const url = pickUrl(p);
    const href = url || "#";
    const target = url && isExternalUrl(url) ? ` target="_blank" rel="noopener"` : "";

    const avatar = pickAvatarUrl(p);
    const srcLabel = escapeHtml(pickSource(p));
    const initials = escapeHtml(initialsForSource(p));

    const avatarHtml = avatar
      ? `<img class="ins-item__avatar" src="${escapeHtml(avatar)}" alt="${srcLabel}">`
      : `<span class="ins-item__avatar is-fallback" aria-hidden="true">${initials}</span>`;

    return `
        <a class="ins-item" href="${escapeHtml(href)}"${target}>
          ${avatarHtml}
          <div class="ins-item__main">
            <p class="ins-item__title">${title}</p>
            <div class="ins-item__meta">${escapeHtml(meta)}</div>
          </div>
        </a>
      `;
  }).join("");

  el.innerHTML = `
    <div class="ins-left">${leftHtml}</div>
    <div class="ins-feed">${rightHtml}</div>
  `;
}

  function renderAll(elId, posts) {
    const root = $("#" + elId);
    if (!root) return;
    const list = sortNewestFirst(posts).slice(0, 200);

    const html = list.map((p) => {
      const title = escapeHtml(pickTitle(p));
      const source = escapeHtml(pickSource(p));
      const ago = timeAgo(pickDate(p));
      const meta = [source, ago].filter(Boolean).join(" • ");
      const url = pickUrl(p);
      const href = url || "#";
      const target = url && isExternalUrl(url) ? ` target="_blank" rel="noopener"` : "";

      const avatar = pickAvatarUrl(p);
      const srcLabel = escapeHtml(pickSource(p));
      const initials = escapeHtml(initialsForSource(p));

      const avatarHtml = avatar
        ? `<img class="ins-item__avatar" src="${escapeHtml(avatar)}" alt="${srcLabel}">`
        : `<span class="ins-item__avatar is-fallback" aria-hidden="true">${initials}</span>`;

      return `
        <a class="ins-item" href="${escapeHtml(href)}"${target}>
          ${avatarHtml}
          <div class="ins-item__main">
            <p class="ins-item__title">${title}</p>
            <div class="ins-item__meta">${escapeHtml(meta)}</div>
          </div>
        </a>
      `;
    }).join("");

    root.innerHTML = `<div class="ins-feed">${html}</div>`;
  }

  function initTopNav() {
  const tabs = Array.from(document.querySelectorAll(".ins-topnav .ins-tab"));
  if (!tabs.length) return;

  tabs.forEach((a) => {
    a.addEventListener("click", (e) => {
      const href = a.getAttribute("href") || "";
      if (!href.startsWith("#")) return;

      const el = document.querySelector(href);
      if (!el) return;

      e.preventDefault();

      const y = el.getBoundingClientRect().top + window.pageYOffset;
      const OFFSET = 140; // tweak: 70–120 depending on how you want it to land
      window.scrollTo({ top: Math.max(0, y - OFFSET), behavior: "smooth" });

      history.replaceState(null, "", href);
    });
  });
}


  async function loadPosts() {
    const res = await fetch("/api/insights/posts", {
      headers: { Accept: "application/json" },
      cache: "no-cache"
    });
    if (!res.ok) throw new Error("Failed to load /api/insights/posts");
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  }

  async function run() {
    initTopNav();

    const raw = await loadPosts();
    const posts = expandQuickLines(raw);
    const sec = bySection(posts);

    renderSection("sec-news", sec.news);
    renderSection("sec-updates", sec.updates);
    renderSection("sec-blogs", sec.blogs);
    renderSection("sec-guides", sec.guides);
    renderSection("sec-all", sec.all, { heroCount: 0 }); // optional, or keep 2

    const last = $("#lastUpdated");
    if (last) last.textContent = `Loaded ${posts.length} posts.`;
  }

  run().catch((err) => {
    console.error("INSIGHTS RUN FAILED:", err);
    const last = $("#lastUpdated");
    if (last) last.textContent = "Failed to load posts. Check console.";
  });
})();
