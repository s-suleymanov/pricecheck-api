// public/admin/admin.js
const $ = (sel) => document.querySelector(sel);

let LAST_ITEM = null;

async function apiJson(url, opts = {}) {
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) throw new Error((data && data.error) ? data.error : `HTTP ${res.status}`);
  return data;
}

function esc(s){
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function money(cents){
  if (cents == null) return "—";
  return "$" + (Number(cents) / 100).toFixed(2);
}

function timeAgo(ts){
  if (!ts) return "—";
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return "—";
  const d = Date.now() - t;
  const m = Math.floor(d/60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m/60);
  if (h < 48) return `${h}h`;
  const days = Math.floor(h/24);
  return `${days}d`;
}

async function api(url){
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function renderCatalog(list){
  const mount = $("#catalog");
  if (!list?.length) { mount.innerHTML = `<div class="small">No results.</div>`; return; }
  mount.innerHTML = list.map(r => `
    <div class="row">
      <div class="meta">
        <div class="v"><b>${esc(r.model_name || r.model_number || "Catalog item")}</b></div>
        <div class="k">pci: ${esc(r.pci || "—")} · upc: ${esc(r.upc || "—")} · ${esc(r.brand || "—")} · ${esc(r.category || "—")}</div>
      </div>
      <div class="actions">
        <button class="chip" data-item-pci="${esc(r.pci || "")}" data-item-upc="${esc(r.upc || "")}">Open</button>
      </div>
    </div>
  `).join("");

  mount.querySelectorAll("button[data-item-pci],button[data-item-upc]").forEach(btn => {
    btn.addEventListener("click", () => {
      const pci = btn.getAttribute("data-item-pci") || "";
      const upc = btn.getAttribute("data-item-upc") || "";
      openItem({ pci: pci || null, upc: upc || null });
    });
  });
}

function renderListings(list){
  const mount = $("#listings");
  if (!list?.length) { mount.innerHTML = `<div class="small">No results.</div>`; return; }
  mount.innerHTML = list.map(r => `
    <div class="row">
      <div class="meta">
        <div class="v"><b>${esc(r.store || "Store")}</b> · ${esc(r.store_sku || "—")}</div>
        <div class="k">
          price: ${money(r.current_price_cents)} · effective: ${money(r.effective_price_cents)}
          · seen: ${timeAgo(r.current_price_observed_at || r.coupon_observed_at || r.created_at)}
          · coupon: ${esc(r.coupon_text || "—")}
        </div>
      </div>
      <div class="actions">
        <button class="chip" data-open-asin="${esc(r.store_sku || "")}"
                data-open-pci="${esc(r.pci || "")}"
                data-open-upc="${esc(r.upc || "")}">
          Open
        </button>
        ${r.url ? `<a class="chip" href="${esc(r.url)}" target="_blank" rel="noreferrer">Link</a>` : ``}
      </div>
    </div>
  `).join("");

  mount.querySelectorAll("button[data-open-asin]").forEach(btn => {
    btn.addEventListener("click", () => {
      const asin = btn.getAttribute("data-open-asin") || "";
      const pci = btn.getAttribute("data-open-pci") || "";
      const upc = btn.getAttribute("data-open-upc") || "";
      openItem({ asin: (pci || upc) ? null : (asin || null), pci: pci || null, upc: upc || null });
    });
  });
}

function inputRow(label, name, value, placeholder = "") {
  return `
    <label class="frow">
      <span class="frow__k">${esc(label)}</span>
      <input class="frow__in" name="${esc(name)}" value="${esc(value ?? "")}" placeholder="${esc(placeholder)}" />
    </label>
  `;
}

function pick(obj, keys){
  const out = {};
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
}

function lockForm(form, on){
  if (on) form.dataset.saving = "1";
  else delete form.dataset.saving;
  form.querySelectorAll("button, input").forEach(el => { el.disabled = !!on; });
}

function renderItem(data){
  const mount = $("#item");
  LAST_ITEM = data;

  if (!data) {
    mount.innerHTML = `<div class="small">Open an item to see details.</div>`;
    return;
  }

  const key = data.key || {};
  const anchor = data.anchor_catalog;
  const offers = data.offers || [];
  const gaps = data.gaps || {};

  const anchorHtml = anchor ? `
    <div class="sect">
      <div class="sect__title">Catalog (anchor)</div>
      <form class="form" data-catalog-id="${esc(anchor.id)}">
        ${inputRow("PCI", "pci", anchor.pci)}
        ${inputRow("UPC", "upc", anchor.upc)}
        ${inputRow("Brand", "brand", anchor.brand)}
        ${inputRow("Category", "category", anchor.category)}
        ${inputRow("Model number", "model_number", anchor.model_number)}
        ${inputRow("Model name", "model_name", anchor.model_name)}
        ${inputRow("Version", "version", anchor.version)}
        ${inputRow("Color", "color", anchor.color)}
        ${inputRow("Image URL", "image_url", anchor.image_url)}
        ${inputRow("Recall URL", "recall_url", anchor.recall_url)}
        ${inputRow("Dropship warning", "dropship_warning", anchor.dropship_warning)}
        <div class="form__actions">
          <button class="chip" type="submit">Save catalog</button>
          <span class="small" data-save-msg></span>
        </div>
      </form>
    </div>
  ` : `
    <div class="sect">
      <div class="sect__title">Catalog (anchor)</div>
      <div class="small">No catalog anchor found for this key.</div>
    </div>
  `;

  const offersHtml = offers.length ? `
    <div class="sect">
      <div class="sect__title">Offers (editable)</div>
      <div class="small" style="margin-bottom:8px">
        stores: ${esc(Object.keys(gaps.offers_by_store || {}).join(", ") || "—")}
      </div>
      ${offers.map(o => `
        <form class="offer" data-listing-id="${esc(o.id)}">
          <div class="offer__head">
            <div class="offer__t">
              <b>${esc(o.store || "Store")}</b>
              <span class="small"> · ${esc(o.store_sku || "—")}</span>
            </div>
            <div class="small">
              price ${money(o.current_price_cents)} · eff ${money(o.effective_price_cents)} · seen ${timeAgo(o.current_price_observed_at || o.coupon_observed_at || o.created_at)}
            </div>
          </div>

          <div class="offer__grid">
            ${inputRow("Status", "status", o.status, "active / dead / ...")}
            ${inputRow("Offer tag", "offer_tag", o.offer_tag, "refurb, open-box, etc")}
            ${inputRow("URL", "url", o.url, "https://...")}
            ${inputRow("Title", "title", o.title)}
            ${inputRow("PCI", "pci", o.pci)}
            ${inputRow("UPC", "upc", o.upc)}
          </div>

          <div class="form__actions">
            <button class="chip" type="submit">Save offer</button>
            ${o.url ? `<a class="chip" href="${esc(o.url)}" target="_blank" rel="noreferrer">Open link</a>` : ``}
            <span class="small" data-save-msg></span>
          </div>
        </form>
      `).join("")}
    </div>
  ` : `
    <div class="sect">
      <div class="sect__title">Offers</div>
      <div class="small">No offers found for this key.</div>
    </div>
  `;

  mount.innerHTML = `
    <div class="small">
      key: pci=${esc(key.pci || "—")} · upc=${esc(key.upc || "—")} · asin=${esc(key.asin || "—")} · model_number=${esc(key.model_number || "—")}
    </div>
    <div class="small" style="margin-top:6px">
      gaps: missing_catalog=${esc(String(!!gaps.missing_catalog))} · stale_offers=${esc(String((gaps.stale_offers||[]).length))} · coupon_missing=${esc(String((gaps.coupon_missing||[]).length))}
    </div>

    ${anchorHtml}
    ${offersHtml}
  `;

  // wire catalog save
  mount.querySelectorAll("form[data-catalog-id]").forEach(form => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (form.dataset.saving === "1") return;

      const id = form.getAttribute("data-catalog-id");
      const msg = form.querySelector("[data-save-msg]");
      msg.textContent = "Saving...";
      lockForm(form, true);

      const raw = Object.fromEntries(new FormData(form).entries());
      const payload = pick(raw, [
        "pci","upc","brand","category","model_number","model_name","version","color","image_url","recall_url","dropship_warning"
      ]);

      try {
        await apiJson(`/admin/api/catalog/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        msg.textContent = "Saved.";
        await reopenLastKey();
      } catch (err) {
        console.error(err);
        msg.textContent = "Save failed.";
        alert(String(err.message || err));
      } finally {
        lockForm(form, false);
      }
    });
  });

  // wire offer save
  mount.querySelectorAll("form[data-listing-id]").forEach(form => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (form.dataset.saving === "1") return;

      const id = form.getAttribute("data-listing-id");
      const msg = form.querySelector("[data-save-msg]");
      msg.textContent = "Saving...";
      lockForm(form, true);

      const raw = Object.fromEntries(new FormData(form).entries());
      const payload = pick(raw, ["status","offer_tag","url","title","pci","upc"]);

      try {
        await apiJson(`/admin/api/listing/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        msg.textContent = "Saved.";
        await reopenLastKey();
      } catch (err) {
        console.error(err);
        msg.textContent = "Save failed.";
        alert(String(err.message || err));
      } finally {
        lockForm(form, false);
      }
    });
  });
}

async function reopenLastKey() {
  const key = LAST_ITEM?.key || {};
  await openItem({
    pci: key.pci || null,
    upc: key.upc || null,
    asin: key.asin || null,
  });
}

async function runSearch(q){
  const data = await api(`/admin/api/search?q=${encodeURIComponent(q)}`);

  const bridge = data.bridge;
  const itemMount = $("#item");

  if (bridge && (bridge.pci || bridge.upc)) {
    itemMount.innerHTML = `
      <div class="small">
        bridge: <b>${esc(bridge.input)}</b>
        → sku ${esc(bridge.matched_listing?.store || "—")}:${esc(bridge.matched_listing?.store_sku || "—")}
        → pci <b>${esc(bridge.pci || "—")}</b>
        → model_number <b>${esc(bridge.model_number || "—")}</b>
      </div>
      <div style="margin-top:10px">
        <button class="chip" id="openBridged">Open bridged item</button>
      </div>
    `;

    $("#openBridged")?.addEventListener("click", () => {
      openItem({ pci: bridge.pci || null, upc: bridge.upc || null, asin: null });
    });
  } else {
    // keep whatever was there; do not overwrite item view on normal searches
  }

  renderCatalog(data.catalog);
  renderListings(data.listings);
}

async function openItem({ pci, upc, asin }){
  const params = new URLSearchParams();
  if (pci) params.set("pci", pci);
  if (upc) params.set("upc", upc);
  if (asin) params.set("asin", asin);
  const data = await api(`/admin/api/item?${params.toString()}`);
  renderItem(data);
}

$("#searchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = ($("#q").value || "").trim();
  if (!q) return;
  try {
    await runSearch(q);
  } catch (err) {
    console.error(err);
    alert("Search failed. Check server logs.");
  }
});

renderItem(null);
