(() => {
  const grid  = document.getElementById("pcFollowingGrid");
  const empty = document.getElementById("pcFollowingEmpty");

  if (!grid) return;

  // ─── Helpers ───────────────────────────────────────────────────────────────
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

  function titleCaseWords(s) {
    const v = clean(s);
    if (!v) return "";
    // Keep short all-caps as-is: "LG", "HP", "Sony" passes because mixed-case check prevents mangling
    if (v.toUpperCase() === v && v.length <= 5) return v;
    return v
      .toLowerCase()
      .split(/\s+/g)
      .map(w => (w ? w[0].toUpperCase() + w.slice(1) : ""))
      .join(" ");
  }

  function firstLetter(s) {
    return (clean(s)[0] || "?").toUpperCase();
  }

  // entity_key is already lowercase (matches brandKey() on the server)
  function brandIdFromKey(key) {
    return clean(key).toLowerCase();
  }

  function browseHrefForBrand(label) {
    const q = encodeURIComponent(clean(label));
    if (!q) return "/browse/";
    return `/browse/?brand=${q}`;
  }

  // ─── Sellers map ───────────────────────────────────────────────────────────
  let _sellersMapPromise = null;

  async function loadSellersMap() {
    if (_sellersMapPromise) return _sellersMapPromise;
    _sellersMapPromise = (async () => {
      try {
        const res = await fetch("/data/sellers.json", {
          headers: { Accept: "application/json" }
        });
        if (!res.ok) return {};
        const json = await res.json();
        return json && typeof json === "object" ? json : {};
      } catch (_e) {
        return {};
      }
    })();
    return _sellersMapPromise;
  }

  function logoUrlForId(id, sellers) {
    const k = clean(id).toLowerCase();
    if (!k) return "";
    const entry = sellers?.[k];
    if (!entry) return "";
    return clean(
      entry.logo || entry.logo_url || entry.logoUrl ||
      entry.image_url || entry.imageUrl || ""
    );
  }

  // ─── Card HTML ─────────────────────────────────────────────────────────────
  function cardHtml(row, sellers) {
    const labelRaw = row?.entity_label || row?.entity_key || "Brand";
    const label    = titleCaseWords(labelRaw);
    const id       = brandIdFromKey(row?.entity_key || label);
    const logo     = logoUrlForId(id, sellers);
    const href     = browseHrefForBrand(label);

    // Avatar: logo image (with onerror fallback to initial letter) or initial letter
    const avatarContent = logo
      ? `
          <img
            class="pc-following-card__avatarImg"
            src="${esc(logo)}"
            alt="${esc(label)}"
            loading="lazy"
            decoding="async"
            onerror="
              this.style.display='none';
              var fb=this.parentElement.querySelector('.pc-following-card__avatarFallback');
              if(fb) fb.style.display='';
            "
          >
          <span
            class="pc-following-card__avatarFallback"
            aria-hidden="true"
            style="display:none;"
          >${esc(firstLetter(label))}</span>
        `
      : `
          <span
            class="pc-following-card__avatarFallback"
            aria-hidden="true"
          >${esc(firstLetter(label))}</span>
        `;

    return `
      <a class="pc-following-card" href="${esc(href)}" aria-label="${esc(label)}">
        <div class="pc-following-card__top"></div>
        <div class="pc-following-card__avatar" aria-hidden="true">
          ${avatarContent}
        </div>
        <div class="pc-following-card__body">
          <div class="pc-following-card__name">${esc(label)}</div>
          <div class="pc-following-card__meta">Brand</div>
        </div>
      </a>
    `;
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  function render(rows, sellers) {
    const list = Array.isArray(rows) ? rows : [];

    if (!list.length) {
      grid.innerHTML = "";
      if (empty) empty.hidden = false;
      return;
    }

    if (empty) empty.hidden = true;
    grid.innerHTML = list.map(r => cardHtml(r, sellers)).join("");
  }

  // ─── Load ──────────────────────────────────────────────────────────────────
  let _loaded = false;

  async function load() {
    try {
      const res = await fetch("/api/following?type=brand", {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      });

      const data = await res.json().catch(() => null);

      // Debug: open DevTools console to see this
      console.log("[following] API status:", res.status, "| signed_in:", data?.signed_in, "| results:", data?.results?.length ?? "n/a");

      if (!res.ok || !data?.ok) {
        render([], {});
        return;
      }

      // Server says not signed in — wait for pc:auth_changed to trigger a re-load
      if (data.signed_in === false) {
        render([], {});
        return;
      }

      const rows    = Array.isArray(data.results) ? data.results : [];
      const sellers = await loadSellersMap();
      _loaded = true;
      render(rows, sellers);
    } catch (err) {
      console.error("[following] fetch error:", err);
      render([], {});
    }
  }

  load();

  // Re-load when auth flips (sign in / sign out)
  window.addEventListener("pc:auth_changed", (e) => {
    if (e?.detail?.signedIn) {
      load();
    } else {
      _loaded = false;
      render([], {});
    }
  });

  // Re-load when a follow is toggled from the dashboard
  window.addEventListener("pc:following_changed", () => {
    load();
    window.pcRefreshSidebarFollowing?.();
  });
})();