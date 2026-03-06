(() => {
  // ─── Elements ────────────────────────────────────────────────────────────────
  const shell   = document.getElementById("pcAuthPageShell");
  const grid    = document.getElementById("pcHistoryGrid");
  const empty   = document.getElementById("pcHistoryEmpty");
  const clearBtn = document.getElementById("pcHistoryClearAll");

  if (!grid) return;

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function clean(v) {
    return String(v || "").trim();
  }

  // ─── Time formatting (YouTube-style) ─────────────────────────────────────────
  function timeAgo(dateStr) {
    const now  = Date.now();
    const then = new Date(dateStr).getTime();
    const diff = Math.max(0, now - then);

    const mins  = Math.floor(diff / 60_000);
    const hours = Math.floor(diff / 3_600_000);
    const days  = Math.floor(diff / 86_400_000);

    if (mins  < 1)  return "Just now";
    if (mins  < 60) return `${mins} min ago`;
    if (hours < 24) return `${hours} hr ago`;
    if (days  === 1) return "Yesterday";
    if (days  < 7)  return `${days} days ago`;

    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(dateStr));
  }

  function dayBucket(dateStr) {
    const d    = new Date(dateStr);
    const now  = new Date();
    const days = Math.floor((now - d) / 86_400_000);

    if (days < 1)  return "Today";
    if (days < 2)  return "Yesterday";
    if (days < 7)  return "This week";
    if (days < 14) return "Last week";
    if (days < 31) return "This month";

    return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(d);
  }

  // Build a pretty dashboard URL from entity_key (pci:X, asin:X, etc.)
  function dashboardUrl(entityKey) {
    const k = clean(entityKey);
    if (!k) return "/dashboard/";
    const [kind, ...rest] = k.split(":");
    const val = rest.join(":");
    if (!kind || !val) return "/dashboard/";
    return `/dashboard/${kind}/${encodeURIComponent(val)}/`;
  }

  // ─── Render ──────────────────────────────────────────────────────────────────
  let _allRows = [];

  function render(rows) {
    _allRows = Array.isArray(rows) ? rows : [];

    if (!_allRows.length) {
      grid.innerHTML = "";
      if (empty) empty.hidden = false;
      if (clearBtn) clearBtn.hidden = true;
      return;
    }

    if (empty) empty.hidden = true;
    if (clearBtn) clearBtn.hidden = false;

    // Group by day bucket
    const groups = [];
    const seenLabels = new Map();

    for (const row of _allRows) {
      const label = dayBucket(row.viewed_at);

      if (!seenLabels.has(label)) {
        seenLabels.set(label, groups.length);
        groups.push({ label, rows: [] });
      }

      groups[seenLabels.get(label)].rows.push(row);
    }

    grid.innerHTML = groups.map(group => `
      <div class="pc-history-group">
        <div class="pc-history-group__label">${esc(group.label)}</div>
        <div class="pc-history-group__items">
          ${group.rows.map(row => itemHtml(row)).join("")}
        </div>
      </div>
    `).join("");

    // Wire remove buttons
    grid.querySelectorAll("[data-remove-id]").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.preventDefault();
        e.stopPropagation();
        const id = Number(btn.getAttribute("data-remove-id"));
        await removeEntry(id, btn.closest(".pc-history-item"));
      });
    });
  }

  function itemHtml(row) {
    const href    = dashboardUrl(row.entity_key);
    const title   = clean(row.title) || "Product";
    const brand   = clean(row.brand);
    const imgSrc  = clean(row.image_url);
    const when    = timeAgo(row.viewed_at);

    const imgHtml = imgSrc
      ? `<img
           class="pc-history-item__img"
           src="${esc(imgSrc)}"
           alt=""
           loading="lazy"
           decoding="async"
           onerror="this.style.display='none'"
         >`
      : `<div class="pc-history-item__img-placeholder"></div>`;

    return `
      <div class="pc-history-item" data-history-id="${esc(String(row.id))}">
        <a class="pc-history-item__thumb" href="${esc(href)}" aria-label="${esc(title)}">
          ${imgHtml}
        </a>
        <div class="pc-history-item__body">
          ${brand ? `<div class="pc-history-item__brand">${esc(brand)}</div>` : ""}
          <a class="pc-history-item__title" href="${esc(href)}">${esc(title)}</a>
          <div class="pc-history-item__when">${esc(when)}</div>
        </div>
        <button
          class="pc-history-item__remove"
          type="button"
          data-remove-id="${esc(String(row.id))}"
          aria-label="Remove from history"
          title="Remove"
        >
          <svg viewBox="0 -960 960 960" width="18" height="18" aria-hidden="true">
            <path fill="currentColor" d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z"/>
          </svg>
        </button>
      </div>
    `;
  }

  // ─── API calls ───────────────────────────────────────────────────────────────
  async function load() {
    try {
      const res  = await fetch("/api/history", {
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) { render([]); return; }
      if (data.signed_in === false) { render([]); return; }

      render(Array.isArray(data.results) ? data.results : []);
    } catch (_e) {
      render([]);
    }
  }

  async function removeEntry(id, itemEl) {
    // Optimistically remove from DOM
    if (itemEl) {
      itemEl.style.opacity = "0.4";
      itemEl.style.pointerEvents = "none";
    }

    try {
      const res = await fetch(`/api/history/${id}`, {
        method: "DELETE",
        credentials: "same-origin"
      });

      if (res.ok) {
        _allRows = _allRows.filter(r => r.id !== id);
        render(_allRows);
      } else {
        // Revert on failure
        if (itemEl) { itemEl.style.opacity = ""; itemEl.style.pointerEvents = ""; }
      }
    } catch (_e) {
      if (itemEl) { itemEl.style.opacity = ""; itemEl.style.pointerEvents = ""; }
    }
  }

  async function clearAll() {
    if (!confirm("Clear all watch history?")) return;

    if (clearBtn) { clearBtn.disabled = true; clearBtn.textContent = "Clearing..."; }

    try {
      const res = await fetch("/api/history", {
        method: "DELETE",
        credentials: "same-origin"
      });

      if (res.ok) {
        render([]);
      }
    } catch (_e) {}
    finally {
      if (clearBtn) { clearBtn.disabled = false; clearBtn.textContent = "Clear all history"; }
    }
  }

  // ─── Wire clear button ───────────────────────────────────────────────────────
  if (clearBtn) {
    clearBtn.addEventListener("click", clearAll);
  }

  // ─── Boot ────────────────────────────────────────────────────────────────────
  load();

  // Re-load when auth changes (sign in)
  window.addEventListener("pc:auth_changed", e => {
    if (e?.detail?.signedIn) load();
    else render([]);
  });
})();