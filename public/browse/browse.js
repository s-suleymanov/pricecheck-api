// public/browse/browse.js
(function () {
  const $ = (s) => document.querySelector(s);

  const state = {
    type: "brand",
    value: "",
    page: 1,
    limit: 24,
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
  }

  function writeUrl() {
    const url = new URL(location.href);
    url.searchParams.set("type", state.type);
    url.searchParams.set("value", state.value);
    url.searchParams.set("page", String(state.page));
    history.replaceState({}, "", url);
  }

  function fmtPrice(cents) {
    if (typeof cents !== "number") return "NA";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
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

  function render() {
    $("#type").value = state.type;
    $("#value").value = state.value;

    $("#title").textContent = state.value || "Browse";

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

    $("#type").value = state.type;
    $("#value").value = state.value;

    $("#go").addEventListener("click", async () => {
      state.type = $("#type").value;
      state.value = $("#value").value.trim();
      state.page = 1;
      writeUrl();
      await load();
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
    if (!state.value) {
      state.results = [];
      state.total = 0;
      state.pages = 1;
      render();
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
