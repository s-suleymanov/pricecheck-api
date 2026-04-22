(() => {
  const $ = (s, root = document) => root.querySelector(s);

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function fmtPrice(cents) {
    if (typeof cents !== "number") return "";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD"
    }).format(cents / 100);
  }

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function isBooleanLikeSpecValue(v) {
    if (typeof v === "boolean") return true;
    const s = String(v ?? "").trim().toLowerCase();
    return s === "yes" || s === "no" || s === "true" || s === "false";
  }

  function specValueIsTrue(v) {
    if (typeof v === "boolean") return v === true;
    const s = String(v ?? "").trim().toLowerCase();
    return s === "yes" || s === "true";
  }

  function formatSpecLabel(label) {
    return String(label ?? "").trim();
  }

  function formatSpecValue(value) {
    if (value == null) return "";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    return String(value).trim();
  }

  function hashSpecKey(str) {
    const s = String(str || "").trim().toLowerCase();
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h) + s.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h);
  }

  function specPillVars(key) {
    const h = hashSpecKey(key) % 360;
    const bg = `hsla(${h}, 72%, 92%, 1)`;
    const border = `hsla(${h}, 58%, 72%, 1)`;
    const text = `hsla(${h}, 62%, 34%, 1)`;
    return `--spec-pill-bg:${bg};--spec-pill-border:${border};--spec-pill-text:${text};`;
  }

  function splitSpecsForCard(specs, selectedSpecKeys = []) {
    if (!isPlainObject(specs)) {
      return { pills: [], rows: [], availableKeys: [] };
    }

    const pills = [];
    const nonBinaryRows = [];

    for (const [rawKey, rawValue] of Object.entries(specs)) {
      const key = formatSpecLabel(rawKey);
      if (!key) continue;

      if (isBooleanLikeSpecValue(rawValue)) {
        if (specValueIsTrue(rawValue)) {
          pills.push({ key, value: true });
        }
        continue;
      }

      const value = formatSpecValue(rawValue);
      if (!value) continue;
      nonBinaryRows.push({ key, value });
    }

    const availableKeys = nonBinaryRows.map((row) => row.key);

    const byKey = new Map(
      nonBinaryRows.map((row) => [row.key.toLowerCase(), row])
    );

    const selected = (Array.isArray(selectedSpecKeys) ? selectedSpecKeys : [])
      .map((x) => formatSpecLabel(x))
      .filter(Boolean)
      .slice(0, 4);

    let rows = [];

    if (selected.length) {
      rows = selected.map((key) => {
        const hit = byKey.get(key.toLowerCase());
        return {
          key,
          value: hit ? hit.value : ""
        };
      });
    } else {
      rows = nonBinaryRows.slice(0, 4).map((row) => ({
        key: row.key,
        value: row.value
      }));
    }

    return {
      pills,
      rows,
      availableKeys
    };
  }

  function collectTopSpecKeys(results) {
    const counts = new Map();

    for (const r of Array.isArray(results) ? results : []) {
      const split = splitSpecsForCard(r?.specs, []);
      for (const key of split.availableKeys) {
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }

    return Array.from(counts.entries())
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return a[0].localeCompare(b[0]);
      })
      .map(([key]) => key);
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
      <div class="browse-card-score browse-card-score--${tone}" aria-label="Overall score ${Math.round(n)}">
        ${Math.round(n)}
      </div>
    `;
  }

  function dealImageUrl(raw, target = 320) {
    const s = String(raw || "").trim();
    if (!s) return "";

    if (s.includes("bbystatic.com")) {
      let out = s;
      out = out.replace(/maxWidth=\d+/i, `maxWidth=${target}`);
      out = out.replace(/maxHeight=\d+/i, `maxHeight=${target}`);
      if (!/format=/i.test(out)) out += ";format=webp";
      return out;
    }

    return s;
  }

  const state = {
    rows: [],
    specsTopKeys: [],
    selectedSpecsTopKeys: []
  };

  function ensureSpecsTopSelection() {
    const available = new Set(state.specsTopKeys);
    state.selectedSpecsTopKeys = (state.selectedSpecsTopKeys || []).filter((k) => available.has(k));

    if (!state.selectedSpecsTopKeys.length) {
      state.selectedSpecsTopKeys = state.specsTopKeys.slice(0, 4);
    }
  }

  function renderTopbar() {
    const el = $("#shortlistTopbar");
    if (!el) return;

    const keys = Array.isArray(state.specsTopKeys) ? state.specsTopKeys : [];
    if (!keys.length) {
      el.innerHTML = "";
      return;
    }

    el.innerHTML = `
      <div class="browse-topbar browse-topbar--specs">
        <div class="browse-topbar__left browse-topbar__left--specs">
          ${keys.map((key) => {
            const active = state.selectedSpecsTopKeys.includes(key);
            return `
              <button
                type="button"
                class="spec-top-pill${active ? " is-active" : ""}"
                data-spec-top-key="${escapeHtml(key)}"
              >
                ${escapeHtml(key)}
              </button>
            `;
          }).join("")}
        </div>
      </div>
    `;

    el.querySelectorAll("[data-spec-top-key]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = String(btn.getAttribute("data-spec-top-key") || "").trim();
        if (!key) return;

        const current = Array.isArray(state.selectedSpecsTopKeys)
          ? [...state.selectedSpecsTopKeys]
          : [];

        const alreadySelected = current.includes(key);

        if (alreadySelected) {
          state.selectedSpecsTopKeys = current.filter((k) => k !== key);

          if (!state.selectedSpecsTopKeys.length) {
            state.selectedSpecsTopKeys = state.specsTopKeys.slice(0, 4);
          }

          renderGrid();
          return;
        }

        if (current.length >= 4) {
          window.alert("You can compare up to 4 specs at a time. Remove one first to add another.");
          return;
        }

        state.selectedSpecsTopKeys = [...current, key];
        renderGrid();
      });
    });
  }

  function cardProductSpecs(r) {
    const dashKey = String(r.dashboard_key || "").trim();
    const displayName = r.model_name || r.title || r.model_number || "Untitled";

    const rawImg = String(r.image_url || "").trim();
    const img320 = dealImageUrl(rawImg, 320);
    const img640 = dealImageUrl(rawImg, 640);

    const img = rawImg
      ? `<img
          class="img"
          src="${escapeHtml(img320)}"
          srcset="${escapeHtml(img320)} 320w, ${escapeHtml(img640)} 640w"
          sizes="(max-width: 560px) 50vw, (max-width: 980px) 33vw, 260px"
          width="320"
          height="320"
          alt=""
          loading="lazy"
          decoding="async"
        >`
      : `<div class="img ph"></div>`;

    const brand = (r.brand || "").trim();
    const brandLine = brand ? brand : "";

    const { pills, rows } = splitSpecsForCard(r.specs, state.selectedSpecsTopKeys);

    const pillsHtml = pills.length
      ? `
        <div class="spec-card-pills">
          ${pills.map((p) => `
            <span
              class="spec-pill"
              style="${specPillVars(p.key)}"
            >${escapeHtml(p.key)}</span>
          `).join("")}
        </div>
      `
      : "";

    const rowsHtml = rows.length
      ? `
        <div class="spec-card-grid">
          ${rows.map((row) => `
            <div class="spec-card-stat">
              <div class="spec-card-stat-label">${escapeHtml(row.key)}</div>
              <div class="spec-card-stat-value">${escapeHtml(row.value)}</div>
            </div>
          `).join("")}
        </div>
      `
      : "";

    const priceHtml = typeof r.best_price_cents === "number" ? fmtPrice(r.best_price_cents) : "";

    const href = dashKey
      ? `/dashboard/${encodeURIComponent((displayName || "product").toLowerCase().replace(/['"]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""))}/${encodeURIComponent(dashKey.split(":")[0])}/${encodeURIComponent(dashKey.split(":").slice(1).join(":"))}/`
      : "#";

    return `
      <a class="card item spec-card"
        href="${escapeHtml(href)}"
        data-dash-key="${escapeHtml(dashKey)}"
        data-title="${escapeHtml(displayName)}"
        data-brand="${escapeHtml(brandLine)}"
        data-img="${escapeHtml(String(r.image_url || ""))}">
        <div class="thumb">${img}${recScoreBadgeHtml(r.overall_score)}</div>

        <div class="spec-card-body">
          <div class="spec-card-head">
            <div class="spec-card-titlewrap">
              <div class="subtitle">${escapeHtml(brandLine)}</div>
              <div class="name name--no-about">${escapeHtml(displayName)}</div>
            </div>
            <div style="padding: 10px 0;" class="spec-card-price">${escapeHtml(priceHtml)}</div>
          </div> 

          ${pillsHtml}
          ${rowsHtml}
        </div>
      </a>
    `;
  }

  function renderGrid() {
    const meta = $("#shortlistMeta");
    const empty = $("#shortlistEmpty");
    const grid = $("#shortlistGrid");
    if (!grid) return;

    if (meta) {
      meta.textContent = state.rows.length === 1 ? "1 saved product" : `Showing ${state.rows.length} products`;
    }

    if (!state.rows.length) {
      grid.innerHTML = "";
      if (empty) {
        empty.hidden = false;
        empty.innerHTML = `<div class="msg"><span>Your shortlist is empty.</span></div>`;
      }
      return;
    }

    if (empty) {
      empty.hidden = true;
      empty.innerHTML = "";
    }

    grid.innerHTML = state.rows.map(cardProductSpecs).join("");
  }

  async function loadShortlistPage() {
    const api = window.PriceCheckShortlist;
    if (!api) return;

    const items = api.readItems();
    const keys = items.map((item) => String(item.key || "").trim()).filter(Boolean);

    if (!keys.length) {
      state.rows = [];
      state.specsTopKeys = [];
      state.selectedSpecsTopKeys = [];
      renderTopbar();
      renderGrid();
      return;
    }

    const url = `/api/shortlist_specs?keys=${encodeURIComponent(keys.join(","))}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const data = await res.json();

    state.rows = Array.isArray(data?.results) ? data.results : [];
    state.specsTopKeys = collectTopSpecKeys(state.rows);
    ensureSpecsTopSelection();

    renderTopbar();
    renderGrid();
  }

  window.addEventListener("pc:shortlist_changed", () => {
    loadShortlistPage().catch(console.error);
  });

  document.addEventListener("DOMContentLoaded", () => {
    loadShortlistPage().catch(console.error);
  });
})();