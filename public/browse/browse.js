// public/browse/browse.js
(function () {
  const $ = (s) => document.querySelector(s);

  const state = {
    type: "brand",
    value: "",
    page: 1,
    limit: 500,
    pages: 1,
    total: 0,
    results: [],
  };

  function readUrl() {
    const url = new URL(location.href);
    const brand = url.searchParams.get("brand");
    const category = url.searchParams.get("category");

    if (brand) {
      state.type = "brand";
      state.value = brand;
    } else if (category) {
      state.type = "category";
      state.value = category;
    } else {
      state.type = (url.searchParams.get("type") || "brand").toLowerCase();
      state.value = url.searchParams.get("value") || "";
    }

    state.page = parseInt(url.searchParams.get("page") || "1", 10) || 1;
    if (state.page < 1) state.page = 1;

    if (!state.value) {
      state.type = "category";
    }
  }

  function writeUrl() {
    const url = new URL(location.href);

    // clear legacy params
    url.searchParams.delete("type");
    url.searchParams.delete("value");

    // clear both smart params first
    url.searchParams.delete("brand");
    url.searchParams.delete("category");

    if (state.type === "brand") url.searchParams.set("brand", state.value);
    else url.searchParams.set("category", state.value);

    url.searchParams.set("page", String(state.page));
    history.replaceState({}, "", url);
  }

  function fmtPrice(cents) {
    if (typeof cents !== "number") return "NA";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
  }

  async function inferTypeFromValue(raw) {
  const v = (raw || "").trim();
  if (!v) return "category";

  // fetch facets and try to match
  let brands = [];
  let categories = [];
  try {
    [brands, categories] = await Promise.all([
      fetchFacets("brand"),
      fetchFacets("category"),
    ]);
  } catch {
    return "category";
  }

  const norm = (s) => String(s || "").trim().toLowerCase();

  const vN = norm(v);

  // exact match first
  const brandHit = brands.some((r) => norm(r.value) === vN);
  const catHit = categories.some((r) => norm(r.value) === vN);
  if (brandHit && !catHit) return "brand";
  if (catHit && !brandHit) return "category";
  if (brandHit && catHit) {
    // tie-breaker: prefer brand if both exist
    return "brand";
  }

  // prefix match (helps with partial typing)
  const brandPrefix = brands.some((r) => norm(r.value).startsWith(vN));
  const catPrefix = categories.some((r) => norm(r.value).startsWith(vN));
  if (brandPrefix && !catPrefix) return "brand";
  if (catPrefix && !brandPrefix) return "category";

  // fallback
  return "category";
}

  async function fetchBrowse() {
    const qs = new URLSearchParams({
      type: state.type,
      value: state.value,
      page: String(state.page),
      limit: String(state.limit),
    }).toString();

    const res = await fetch(`/api/browse?${qs}`, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("fetch_failed");
    const data = await res.json();

    if (!data?.ok) throw new Error("bad_response");

    state.pages = data.pages || 1;
    state.total = data.total || 0;
    state.results = Array.isArray(data.results) ? data.results : [];
  }

  async function fetchFacets(kind) {
  const qs = new URLSearchParams({
    kind,
    limit: String(state.limit),
  }).toString();

  const res = await fetch(`/api/browse_facets?${qs}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("fetch_failed");
  const data = await res.json();
  if (!data?.ok) throw new Error("bad_response");
  return Array.isArray(data.results) ? data.results : [];
}

function renderFacets(kind, rows) {
  $("#title").textContent = "Browse PriceCheck";
  const label = kind === "category" ? "categories" : `${kind}s`;
  $("#meta").textContent = rows.length
    ? `Updated Weekly • ${rows.length} ${label} added`
    : "No data yet";
  $("#pageLabel").textContent = "";
  $("#prev").disabled = true;
  $("#next").disabled = true;

  const grid = $("#grid");
  grid.innerHTML = "";

  $("#empty").hidden = rows.length > 0;

  for (const r of rows) {
    const value = r.value || "";
    const products = typeof r.products === "number" ? r.products : 0;

    const href = kind === "brand"
      ? `/browse/?brand=${encodeURIComponent(value)}&page=1`
      : `/browse/?category=${encodeURIComponent(value)}&page=1`;

    const img = r.image_url
      ? `<img class="img" src="${r.image_url}" alt="">`
      : `<div class="img ph"></div>`;

    const card = document.createElement("a");
    card.className = "card item";
    card.href = href;

    card.innerHTML = `
      ${img}
      <div class="body">
        <div class="name">${value || "Untitled"}</div>
        <div class="row2">
          <div class="muted">${products} products</div>
        </div>
      </div>
    `;

    grid.appendChild(card);
    }
  }


  function render() {
    $("#value").value = state.value;

    $("#title").textContent = state.value
      ? `${state.type === "brand" ? "Brand" : "Category"}: ${state.value}`
      : "Browse PriceCheck";

    $("#meta").textContent = `${state.total} products`;
    $("#pageLabel").textContent = `Page ${state.page} of ${state.pages}`;

    $("#prev").disabled = state.page <= 1;
    $("#next").disabled = state.page >= state.pages;

    const grid = $("#grid");
    grid.innerHTML = "";

    $("#empty").hidden = state.results.length > 0;

    for (const r of state.results) {
      const key = r.dashboard_key || "";
      const href = key ? `/dashboard/?key=${encodeURIComponent(key)}` : "/dashboard/";

      const img = r.image_url ? `<img class="img" src="${r.image_url}" alt="">` : `<div class="img ph"></div>`;
      const warn = r.dropship_warning ? `<span class="warn">Dropshipping risk</span>` : "";

      const card = document.createElement("a");
      card.className = "card item";
      card.href = href;

      card.innerHTML = `
        ${img}
        <div class="body">
            <div class="subtitle">${(r.brand || "")}${r.category ? " " + r.category : ""}</div>
            <div class="name">${(r.model_name || r.model_number || "Untitled")}</div>
            <div class="row2">
                <div class="price">${fmtPrice(r.best_price_cents)}</div>
                ${warn}
            </div>
        </div>
      `;

      grid.appendChild(card);
    }
  }

  async function run() {
    readUrl();
    $("#value").value = state.value;

    async function doSearch() {
      state.value = $("#value").value.trim();
      state.page = 1;

      if (!state.value) {
        state.type = "category";
        writeUrl();
        await load();
        return;
      }

      $("#meta").textContent = "Loading...";
      state.type = await inferTypeFromValue(state.value);

      writeUrl();
      await load();
    }

    const triggerSearch = () => { doSearch(); };

    const icon = $("#searchIcon");
    if (icon) {
      icon.addEventListener("click", triggerSearch);
      icon.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          triggerSearch();
        }
      });
    }

    $("#value").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
          e.preventDefault();
          triggerSearch();
        }
      });

    $("#prev").addEventListener("click", async () => {
      if (state.page <= 1) return;
      state.page -= 1;
      writeUrl();
      await load();
    });

    $("#next").addEventListener("click", async () => {
      if (state.page >= state.pages) return;
      state.page += 1;
      writeUrl();
      await load();
    });

    await load();
  }

  async function load() {
    // When empty, show available categories (like your screenshot)
    if (!state.value) {
      $("#meta").textContent = "Loading...";
      try {
        const rows = await fetchFacets("category");
        renderFacets("category", rows);
      } catch {
        renderFacets("category", []);
      }
      return;
    }

    $("#meta").textContent = "Loading...";
    try {
      await fetchBrowse();
    } catch {
      state.results = [];
      state.total = 0;
      state.pages = 1;
    }
    render();
  }


  document.addEventListener("DOMContentLoaded", run);
})();
