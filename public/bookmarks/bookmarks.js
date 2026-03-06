(() => {
  const grid     = document.getElementById("pcBookmarksGrid");
  const empty    = document.getElementById("pcBookmarksEmpty");
  const clearBtn = document.getElementById("pcBookmarksClearAll");
  const countEl  = document.getElementById("pcBookmarksCount");

  if (!grid) return;

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function clean(v) { return String(v || "").trim(); }

  function relativeDate(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const days = Math.floor(diff / 86_400_000);
    if (days < 1)  return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7)  return `${days} days ago`;
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(dateStr));
  }

  function dashboardUrl(entityKey) {
    const k = clean(entityKey);
    if (!k) return "/dashboard/";
    const [kind, ...rest] = k.split(":");
    const val = rest.join(":");
    if (!kind || !val) return "/dashboard/";
    return `/dashboard/${kind}/${encodeURIComponent(val)}/`;
  }

  // ─── State ────────────────────────────────────────────────────────────────────

  let _rows = [];

  // ─── Render ──────────────────────────────────────────────────────────────────

  function updateCount(n) {
    if (!countEl) return;
    countEl.textContent = n === 0 ? "" : `${n} saved`;
    countEl.hidden = n === 0;
  }

  function render(rows) {
    _rows = Array.isArray(rows) ? rows : [];
    const n = _rows.length;

    if (!n) {
      grid.innerHTML = "";
      if (empty)    empty.hidden = false;
      if (clearBtn) clearBtn.hidden = true;
      updateCount(0);
      return;
    }

    if (empty)    empty.hidden = true;
    if (clearBtn) clearBtn.hidden = false;
    updateCount(n);

    grid.innerHTML = _rows.map(row => itemHtml(row)).join("");

    grid.querySelectorAll("[data-remove-id]").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.preventDefault();
        e.stopPropagation();
        await removeItem(Number(btn.getAttribute("data-remove-id")), btn.closest(".pc-bm-card"));
      });
    });
  }

  function itemHtml(row) {
    const href    = dashboardUrl(row.entity_key);
    const title   = clean(row.title) || "Product";
    const brand   = clean(row.brand);
    const imgSrc  = clean(row.image_url);
    const when    = relativeDate(row.created_at);

    const imgHtml = imgSrc
      ? `<img class="pc-bm-card__img" src="${esc(imgSrc)}" alt="" loading="lazy" decoding="async" onerror="this.style.display='none'">`
      : `<div class="pc-bm-card__img-ph"></div>`;

    return `
      <div class="pc-bm-card" data-bookmark-id="${esc(String(row.id))}">
        <a class="pc-bm-card__thumb" href="${esc(href)}" aria-label="${esc(title)}">${imgHtml}</a>
        <div class="pc-bm-card__body">
          ${brand ? `<div class="pc-bm-card__brand">${esc(brand)}</div>` : ""}
          <a class="pc-bm-card__title" href="${esc(href)}">${esc(title)}</a>
          <div class="pc-bm-card__meta">
            <span class="pc-bm-card__when">${esc(when)}</span>
            <a class="pc-bm-card__view" href="${esc(href)}">View prices →</a>
          </div>
        </div>
        <button class="pc-bm-card__remove" type="button" data-remove-id="${esc(String(row.id))}"
          aria-label="Remove bookmark" title="Remove">
          <svg viewBox="0 -960 960 960" width="18" height="18"><path fill="currentColor" d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z"/></svg>
        </button>
      </div>
    `;
  }

  // ─── API ─────────────────────────────────────────────────────────────────────

  async function load() {
    try {
      const res  = await fetch("/api/bookmarks", { credentials: "same-origin", headers: { Accept: "application/json" } });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || data.signed_in === false) { render([]); return; }
      render(data.results || []);
    } catch (_e) { render([]); }
  }

  async function removeItem(id, el) {
    if (el) { el.style.opacity = "0.4"; el.style.pointerEvents = "none"; }

    try {
      const res = await fetch(`/api/bookmarks/${id}`, { method: "DELETE", credentials: "same-origin" });
      if (res.ok) {
        _rows = _rows.filter(r => r.id !== id);
        render(_rows);
      } else {
        if (el) { el.style.opacity = ""; el.style.pointerEvents = ""; }
      }
    } catch (_e) {
      if (el) { el.style.opacity = ""; el.style.pointerEvents = ""; }
    }
  }

  async function clearAll() {
    if (!confirm("Remove all bookmarks?")) return;
    if (clearBtn) { clearBtn.disabled = true; clearBtn.textContent = "Clearing…"; }

    try {
      const res = await fetch("/api/bookmarks", { method: "DELETE", credentials: "same-origin" });
      if (res.ok) render([]);
    } catch (_e) {}
    finally {
      if (clearBtn) { clearBtn.disabled = false; clearBtn.textContent = "Clear all"; }
    }
  }

  if (clearBtn) clearBtn.addEventListener("click", clearAll);

  // ─── Boot ─────────────────────────────────────────────────────────────────────

  load();

  window.addEventListener("pc:auth_changed", e => {
    if (e?.detail?.signedIn) load();
    else render([]);
  });
})();