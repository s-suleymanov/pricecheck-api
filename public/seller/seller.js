// public/seller/seller.js
(() => {
  const $ = (s) => document.querySelector(s);
  const norm = (s) => String(s ?? "").trim();

  const els = {
    meta: () => $("#meta"),
    emptyInline: () => $("#emptyInline"),
    sellerPanel: () => $("#sellerPanel"),
    grid: () => $("#grid"),
    pager: () => document.querySelector(".pager"),
  };

  const EXTERNAL_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg"
       viewBox="0 -960 960 960"
       width="20" height="20"
       style="width:20px;height:20px;display:block"
       aria-hidden="true" focusable="false">
    <path d="m216-160-56-56 464-464H360v-80h400v400h-80v-264L216-160Z"/>
  </svg>
`;

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function titleCaseWords(s) {
    const v = String(s ?? "").trim();
    if (!v) return "";
    return v
      .toLowerCase()
      .split(/\s+/g)
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
      .join(" ");
  }

  function initials(name) {
    const n = norm(name);
    if (!n) return "";
    const parts = n.split(/\s+/g).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }

  function setMeta(txt) {
    const el = els.meta();
    if (el) el.textContent = txt ?? "";
  }

  function setInlineEmptyHtml(html) {
    const el = els.emptyInline();
    if (!el) return;
    el.innerHTML = html || "";
    el.hidden = !html;
  }

  function parseSellerPath(pathname) {
    // /seller/
    // /seller/<name>/
    const clean = String(pathname || "/").replace(/\/+$/g, "/");
    const parts = clean.split("/").filter(Boolean);
    if (parts[0] !== "seller") return { name: "" };
    if (parts.length >= 2) return { name: norm(decodeURIComponent(parts[1] || "")) };
    return { name: "" };
  }

  function buildSellerPath(name) {
    const n = norm(name);
    if (!n) return "/seller/";
    return `/seller/${encodeURIComponent(n)}/`;
  }

  async function apiJson(url) {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const txt = await res.text().catch(() => "");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    let data = null;
    try {
      data = txt ? JSON.parse(txt) : null;
    } catch {
      throw new Error("Bad JSON");
    }

    if (!data || data.ok !== true) {
      throw new Error((data && (data.error || data.message)) || "API error");
    }

    return data;
  }

  function factRow(label, valueHtml) {
    if (!valueHtml) return "";
    return `
      <div class="seller-fact">
        <div class="seller-k">${escapeHtml(label)}</div>
        <div class="seller-v">${valueHtml}</div>
      </div>
    `;
  }

  function clearUi() {
    setMeta("");
    setInlineEmptyHtml("");

    const grid = els.grid();
    if (grid) grid.innerHTML = "";

    const panel = els.sellerPanel();
    if (panel) {
      panel.hidden = true;
      panel.innerHTML = "";
    }

    const pager = els.pager();
    if (pager) pager.style.display = "none";
  }

  function prettyName(raw) {
  const s = norm(raw);
  if (!s) return "";
  if (/^[a-z]{2,4}$/.test(s)) return s.toUpperCase(); // jbl -> JBL
  if (s === s.toLowerCase()) return titleCaseWords(s); // jabra -> Jabra
  return s;
}

    function prettyName(raw) {
  const s = norm(raw);
  if (!s) return "";
  if (/^[a-z]{2,4}$/.test(s)) return s.toUpperCase(); // jbl -> JBL
  if (s === s.toLowerCase()) return titleCaseWords(s); // jabra -> Jabra
  return s;
}

function labelFromKey(k) {
  const s = String(k ?? "").trim();
  if (!s) return "";
  // turn owned_by -> Owned By, founded in -> Founded In
  const spaced = s.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return spaced
    .split(" ")
    .map(w => w ? (w[0].toUpperCase() + w.slice(1)) : "")
    .join(" ");
}

function normalizeValue(v) {
  const s = String(v ?? "").trim();
  return s;
}

function isUrlKey(keyLower) {
  return keyLower === "url" || keyLower === "official_url" || keyLower === "website" || keyLower === "official site";
}

function prettyName(raw) {
  const s = norm(raw);
  if (!s) return "";
  if (/^[a-z]{2,4}$/.test(s)) return s.toUpperCase(); // jbl -> JBL
  if (s === s.toLowerCase()) return titleCaseWords(s); // jabra -> Jabra
  return s;
}

function renderSellerPanel(name, info) {
  const panel = els.sellerPanel();
  if (!panel) return;

  const displayName = prettyName(name);

  // Pull official URL from common keys (your API already provides official_url)
  const officialUrl = norm(
    info.official_url ||
    info.url ||
    info.website ||
    info["Official site"] ||
    info["Official Site"] ||
    ""
  );

  // Build dynamic rows from info object, excluding url fields
  const rows = [];
  const obj = (info && typeof info === "object") ? info : {};

  // Prefer a stable order if present, then everything else
  const preferred = ["type", "origin", "owned_by"];
  const seen = new Set();

  function pushKey(k) {
    if (!k) return;
    const rawVal = obj[k];
    const val = normalizeValue(rawVal);
    if (!val) return;

    const keyLower = String(k).toLowerCase().trim();
    if (isUrlKey(keyLower)) return; // don't show official url in the table

    // owned_by becomes link to /seller/<owned_by>/
    let valueHtml = escapeHtml(val);
    if (keyLower === "owned_by" || keyLower === "owned by") {
      valueHtml = `<a class="seller-link" href="${buildSellerPath(val)}">${escapeHtml(val)}</a>`;
    }

    rows.push(`
      <div class="seller-row">
        <div class="seller-k">${escapeHtml(labelFromKey(k))}</div>
        <div class="seller-v">${valueHtml}</div>
      </div>
    `);
  }

  // Add preferred keys first (support different casing)
  for (const pk of preferred) {
    // find matching key in object by case-insensitive compare
    const match = Object.keys(obj).find(k => String(k).toLowerCase().trim() === pk);
    if (match) {
      pushKey(match);
      seen.add(String(match).toLowerCase().trim());
    }
  }

  // Add the rest dynamically
  for (const k of Object.keys(obj)) {
    const keyLower = String(k).toLowerCase().trim();
    if (seen.has(keyLower)) continue;
    pushKey(k);
  }

  panel.hidden = false;
  panel.innerHTML = `
    <div class="seller-card">
      <div class="seller-left">
        <div class="seller-avatar" aria-hidden="true">
          ${escapeHtml(initials(displayName) || displayName[0] || "")}
        </div>

        <div class="seller-nameRow">
          <div class="seller-name">${escapeHtml(displayName)}</div>
          ${
            officialUrl
              ? `<a class="seller-ext" href="${escapeHtml(officialUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Official site">${EXTERNAL_SVG}</a>`
              : ""
          }
        </div>

        <div class="seller-actions">
          <button type="button" class="seller-pill" data-go-browse="${escapeHtml(displayName)}">Browse</button>
        </div>
      </div>

      <div class="seller-right">
        ${rows.length ? `<div class="seller-table">${rows.join("")}</div>` : `<div class="seller-empty">No seller info yet.</div>`}
      </div>
    </div>
  `;
}

  async function loadSeller(name) {
    clearUi();

    const q = norm(name);
    if (!q) {
      setInlineEmptyHtml(`
        <div class="msg">
          <span>Open a seller like <strong>/seller/jabra/</strong>.</span>
        </div>
      `);
      return;
    }

    setMeta("Loading...");
    const data = await apiJson(`/api/seller?name=${encodeURIComponent(q)}`);

    if (!data.found || !data.info) {
      setMeta("");
      setInlineEmptyHtml(`
        <div class="msg">
          <span>No seller info found for <strong>${escapeHtml(q)}</strong>.</span>
        </div>
      `);
      return;
    }

    setMeta("");
    renderSellerPanel(q, data.info);

    // Keep the grid empty for now (no filler messages)
    const grid = els.grid();
    if (grid) grid.innerHTML = "";
  }

  function wireOnce() {
    const panel = els.sellerPanel();
    if (!panel) return;

    panel.addEventListener("click", (e) => {
      const b1 = e.target.closest("button[data-go-browse]");
      if (b1) {
        const v = norm(b1.getAttribute("data-go-browse"));
        if (v) location.href = `/browse/${encodeURIComponent(v)}/`;
        return;
      }

      const b2 = e.target.closest("button[data-go-seller]");
      if (b2) {
        const v = norm(b2.getAttribute("data-go-seller"));
        if (v) location.href = buildSellerPath(v);
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    wireOnce();

    const parsed = parseSellerPath(location.pathname);
    loadSeller(parsed.name).catch((err) => {
      clearUi();
      setInlineEmptyHtml(`
        <div class="msg">
          <span>${escapeHtml(err && err.message ? err.message : "Failed to load seller info.")}</span>
        </div>
      `);
    });

    window.addEventListener("popstate", () => {
      const p = parseSellerPath(location.pathname);
      loadSeller(p.name).catch((err) => {
        clearUi();
        setInlineEmptyHtml(`
          <div class="msg">
            <span>${escapeHtml(err && err.message ? err.message : "Failed to load seller info.")}</span>
          </div>
        `);
      });
    });
  });
})();
