(function () {
  const API = "/api/trending/earbuds";
  const $ = (selector, ctx = document) => ctx.querySelector(selector);

  const UP_PATH = "M440-320h80v-168l64 64 56-56-160-160-160 160 56 56 64-64v168Zm40 240q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z";
  const DOWN_PATH = "m480-320 160-160-56-56-64 64v-168h-80v168l-64-64-56 56 160 160Zm0 240q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z";

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[char]));
  }

  function money(cents) {
    const n = Number(cents);
    if (!Number.isFinite(n)) return "NA";
    return "$" + Math.round(n / 100).toLocaleString();
  }

  function pct(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "NA";
    return (n > 0 ? "+" : "") + n.toFixed(1) + "%";
  }

  function moveClass(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return "pc-move-flat";
    return n < 0 ? "pc-move-down" : "pc-move-up";
  }

  function arrowSvg(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return "";

    return `
      <svg class="pc-index-arrow" viewBox="0 -960 960 960" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="${n > 0 ? UP_PATH : DOWN_PATH}"></path>
      </svg>
    `;
  }

  function miniChart(series) {
    const points = (series || [])
      .filter(p => Number.isFinite(Number(p.value_cents)))
      .map(p => Number(p.value_cents));

    if (points.length < 2) {
      return `<svg class="pc-index-spark" viewBox="0 0 170 56" aria-hidden="true"></svg>`;
    }

    const w = 170;
    const h = 56;
    const pad = 5;
    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = Math.max(1, max - min);

    const coords = points.map((value, index) => {
      const x = pad + (index / (points.length - 1)) * (w - pad * 2);
      const y = h - pad - ((value - min) / range) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");

    return `
      <svg class="pc-index-spark" viewBox="0 0 ${w} ${h}" aria-hidden="true">
        <polyline class="pc-index-spark__line" points="${coords}"></polyline>
      </svg>
    `;
  }

  function indexMeta(item) {
    if (item.change30_pct != null) {
      return `
        <em class="pc-index-change ${moveClass(item.change30_pct)}">
          ${arrowSvg(item.change30_pct)}
          <span>${pct(item.change30_pct)}</span>
        </em>
      `;
    }

    return `<em class="pc-index-count">${Number(item.count || 0).toLocaleString()} tracked</em>`;
  }

  function renderIndices(items) {
    const box = $("#pcMarketIndexes");
    if (!box) return;

    const rows = Array.isArray(items) && items.length ? items : [
      { label: "All", count: 0, active: false, series: [] },
      { label: "Technology", count: 0, active: false, series: [] },
      { label: "Earbuds", count: 0, active: true, series: [] },
      { label: "Headphones", count: 0, active: false, series: [] }
    ];

    box.innerHTML = rows.map(item => `
      <article class="pc-index-card ${item.active ? "is-active" : ""}">
        <div class="pc-index-copy">
          <span>${escapeHtml(item.label)}</span>
          ${indexMeta(item)}
        </div>

        <div class="pc-index-chart">
          ${miniChart(item.series)}
        </div>
      </article>
    `).join("");
  }

  function productCell(item) {
    const image = item.image_url
      ? `<img src="${escapeHtml(item.image_url)}" alt="" loading="lazy" decoding="async">`
      : `<span class="pc-product-dot"></span>`;

    return `
      <a class="pc-market-product" href="${escapeHtml(item.href || "#")}">
        ${image}
        <span>
          <strong>${escapeHtml(item.title || "Unknown Earbuds")}</strong>
          <small>${escapeHtml(item.brand || "Unknown")}</small>
        </span>
      </a>
    `;
  }

  function renderRanked(items) {
    const body = $("#pcEarbuds100");
    if (!body) return;

    if (!items || !items.length) {
      body.innerHTML = `<tr><td colspan="6">No ranked earbuds yet.</td></tr>`;
      return;
    }

    body.innerHTML = items.map(item => `
        <tr>
            <td class="pc-rank">#${Number(item.rank || 0)}</td>
            <td>${productCell(item)}</td>
            <td>${money(item.current_price_cents)}</td>
            <td class="${moveClass(item.change30_pct)}">${item.change30_pct == null ? "Current" : pct(item.change30_pct)}</td>
            <td>${Number(item.value_score || 0).toFixed(1)}</td>
            <td><a class="pc-view" href="${escapeHtml(item.href || "#")}">View</a></td>
        </tr>
        `).join("");
    }

    function brandLogoSlug(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/&/g, "and")
        .replace(/[^a-z0-9]+/g, "");
    }

    function brandInitials(value) {
    return String(value || "PC")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part.charAt(0).toUpperCase())
        .join("") || "PC";
    }

    function companyLogo(item) {
    const brand = String(item.brand || "Unknown").trim();
    const slug = brandLogoSlug(brand);
    const src = `/logo/brands/${slug}.webp`;

    return `
        <span class="pc-company-logo" aria-hidden="true">
        <img
            src="${escapeHtml(src)}"
            alt=""
            loading="lazy"
            decoding="async"
            onerror="this.style.display='none';this.nextElementSibling.hidden=false;"
        >
        <span class="pc-company-logo__fallback" hidden>${escapeHtml(brandInitials(brand))}</span>
        </span>
    `;
    }

  function renderCompanies(items) {
    const box = $("#pcCompanies");
    if (!box) return;

    if (!items || !items.length) {
      box.innerHTML = `<div class="pc-empty">No companies yet.</div>`;
      return;
    }

    box.innerHTML = items.map(item => `
      <a class="pc-company-row" href="/browse/${encodeURIComponent(String(item.brand || "").toLowerCase())}/">
        <span>
          <strong>${escapeHtml(item.brand || "Unknown")}</strong>
        </span>
        <em class="${moveClass(item.avg_change30_pct)}">${item.avg_change30_pct == null ? money(item.avg_price_cents) : pct(item.avg_change30_pct)}</em>
      </a>
    `).join("");
  }

  async function bootTrending() {
    try {
      const data = await fetch(API, {
        headers: { "Accept": "application/json" },
        cache: "no-store"
      }).then(res => {
        if (!res.ok) throw new Error("Trending request failed");
        return res.json();
      });

      renderIndices(data.indices || []);
      renderRanked(data.ranked || []);
      renderCompanies(data.companies || []);
    } catch (error) {
      console.error("Trending load error", error);
      renderIndices([]);
      renderRanked([]);
      renderCompanies([]);
    }
  }

  document.addEventListener("DOMContentLoaded", bootTrending);
})();