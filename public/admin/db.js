const $ = (sel) => document.querySelector(sel);

function esc(s){
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function normStore(s){
  return String(s || "").trim() || "Unknown";
}

function money(cents){
  if (cents == null || cents === "") return "";
  const n = Number(cents);
  if (!Number.isFinite(n)) return "";
  return String(Math.trunc(n));
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

async function apiJson(url, opts = {}) {
  const res = await fetch(url, {
    cache: "no-store",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) throw new Error((data && data.error) ? data.error : `HTTP ${res.status}`);
  return data;
}

function inputField(label, name, value, placeholder = "", extraAttrs = ""){
  return `
    <div class="fg">
      <label>${esc(label)}</label>
      <input name="${esc(name)}" value="${esc(value ?? "")}" placeholder="${esc(placeholder)}" ${extraAttrs} />
    </div>
  `;
}

function inputFieldFull(label, name, value, placeholder = "", extraAttrs = ""){
  return `
    <div class="fg full">
      <label>${esc(label)}</label>
      <input name="${esc(name)}" value="${esc(value ?? "")}" placeholder="${esc(placeholder)}" ${extraAttrs} />
    </div>
  `;
}

function lockForm(form, on){
  if (on) form.dataset.saving = "1";
  else delete form.dataset.saving;
  form.querySelectorAll("button, input").forEach(el => { el.disabled = !!on; });
}

function pick(obj, keys){
  const out = {};
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
}

function normalizeEmpty(v){
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function toIntOrNull(v){
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toNumOrNull(v){
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function renderOfferCard(offer){
  const seen = offer.current_price_observed_at || offer.coupon_observed_at || offer.created_at;
  const seenTxt = `seen ${timeAgo(seen)}`;

  return `
    <form class="offerCard" data-listing-id="${esc(offer.id)}">
      <div class="offerTop">
        <div>
          <div class="offerSku">${esc(offer.store_sku || "—")}</div>
          <div class="small">${esc(offer.status || "—")} · ${esc(offer.offer_tag || "—")}</div>
        </div>
        <div class="offerSeen">
          <div>${seenTxt}</div>
          <div class="small">price ${esc(offer.current_price_cents ?? "—")} · eff ${esc(offer.effective_price_cents ?? "—")}</div>
        </div>
      </div>

      <div class="offerGrid">
        ${inputField("Title", "title", offer.title, "Offer title")}
        ${inputField("URL", "url", offer.url, "https://...")}

        ${inputField("Status", "status", offer.status, "active / dead / ...")}
        ${inputField("Offer tag", "offer_tag", offer.offer_tag, "refurb, open-box, etc")}

        ${inputField("PCI", "pci", offer.pci, "PCI")}
        ${inputField("UPC", "upc", offer.upc, "UPC")}

        ${inputField("Price cents", "current_price_cents", offer.current_price_cents, "e.g. 19999")}
        ${inputField("Effective cents", "effective_price_cents", offer.effective_price_cents, "e.g. 17999")}

        ${inputField("Coupon text", "coupon_text", offer.coupon_text, "e.g. $20 off")}
        ${inputField("Coupon type", "coupon_type", offer.coupon_type, "cents / pct / ...")}

        ${inputField("Coupon cents", "coupon_value_cents", offer.coupon_value_cents, "e.g. 2000")}
        ${inputField("Coupon pct", "coupon_value_pct", offer.coupon_value_pct, "e.g. 10.00")}

        ${inputField("Requires clip", "coupon_requires_clip", offer.coupon_requires_clip, "true/false")}
        ${inputField("Coupon code", "coupon_code", offer.coupon_code, "optional")}

        ${inputFieldFull("Coupon expires at", "coupon_expires_at", offer.coupon_expires_at, "2026-01-26T00:00:00Z")}
      </div>

      <div class="offerLinks">
        <button class="chip" type="submit">Save offer</button>
        <button class="chip" type="button" data-record-price="1">Record price</button>
        ${offer.url ? `<a class="chip" href="${esc(offer.url)}" target="_blank" rel="noreferrer">Open</a>` : ``}
        <span class="small" data-save-msg></span>
      </div>
    </form>
  `;
}

function renderItemRow(item){
  const c = item.catalog;
  const offersByStore = item.offers_by_store || {};
  const storeKeys = Object.keys(offersByStore).sort((a,b) => a.localeCompare(b));

  const catTitle = c.model_name || c.model_number || "Catalog item";
  const catSub = `pci ${c.pci || "—"} · upc ${c.upc || "—"} · model_number ${c.model_number || "—"}`;

  return `
    <div class="itemRow" data-catalog-id="${esc(c.id)}">
      <div class="catCol">
        <div class="catTitle">${esc(catTitle)}</div>
        <div class="small">${esc(catSub)}</div>

        <form class="catForm" data-catalog-id="${esc(c.id)}">
          <div class="formGrid">
            ${inputField("PCI", "pci", c.pci, "PCI")}
            ${inputField("UPC", "upc", c.upc, "UPC")}
            ${inputField("Brand", "brand", c.brand, "Brand")}
            ${inputField("Category", "category", c.category, "Category")}
            ${inputField("Model number", "model_number", c.model_number, "Model number")}
            ${inputFieldFull("Model name", "model_name", c.model_name, "Brand + model + category")}
            ${inputField("Version", "version", c.version, "Version")}
            ${inputField("Color", "color", c.color, "Color")}
            ${inputFieldFull("Image URL", "image_url", c.image_url, "https://...")}
            ${inputFieldFull("Recall URL", "recall_url", c.recall_url, "https://...")}
            ${inputField("Dropship warning", "dropship_warning", c.dropship_warning, "true/false")}
            ${inputField("Coverage warning", "coverage_warning", c.coverage_warning, "true/false")}
          </div>

          <div class="rowActions">
            <button class="btn btnPrimary" type="submit">Save catalog</button>
            <span class="saveMsg" data-save-msg></span>
          </div>
        </form>
      </div>

      <div class="offersCol">
        <div class="storesRow">
          ${
            storeKeys.length
              ? storeKeys.map((store) => {
                  const list = offersByStore[store] || [];
                  return `
                    <div class="storeCol" data-store="${esc(store)}">
                      <div class="storeHead">
                        <div class="storeName">${esc(store)}</div>
                        <div class="storeCount">${esc(String(list.length))} offer(s)</div>
                      </div>
                      ${list.map(renderOfferCard).join("")}
                    </div>
                  `;
                }).join("")
              : `<div class="small">No offers found for this catalog item.</div>`
          }
        </div>
      </div>
    </div>
  `;
}

function render(items){
  const mount = $("#mount");
  if (!items || !items.length) {
    mount.innerHTML = `<div style="padding:14px" class="small">No results.</div>`;
    return;
  }
  mount.innerHTML = items.map(renderItemRow).join("");

  // wire catalog save
  mount.querySelectorAll("form.catForm").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (form.dataset.saving === "1") return;

      const id = form.getAttribute("data-catalog-id");
      const msg = form.querySelector("[data-save-msg]");
      msg.textContent = "Saving...";

      const raw = Object.fromEntries(new FormData(form).entries());
      const payload = {
        pci: normalizeEmpty(raw.pci),
        upc: normalizeEmpty(raw.upc),
        brand: normalizeEmpty(raw.brand),
        category: normalizeEmpty(raw.category),
        model_number: normalizeEmpty(raw.model_number),
        model_name: normalizeEmpty(raw.model_name),
        version: normalizeEmpty(raw.version),
        color: normalizeEmpty(raw.color),
        image_url: normalizeEmpty(raw.image_url),
        recall_url: normalizeEmpty(raw.recall_url),
        dropship_warning: raw.dropship_warning == null ? null : normalizeEmpty(raw.dropship_warning),
        coverage_warning: raw.coverage_warning == null ? null : normalizeEmpty(raw.coverage_warning),
      };

      lockForm(form, true);
      try {
        await apiJson(`/admin/api/catalog/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        msg.textContent = "Saved.";
      } catch (err) {
        console.error(err);
        msg.textContent = "Save failed.";
        alert(String(err.message || err));
      } finally {
        lockForm(form, false);
      }
    });
  });

  // wire offer save + record price
  mount.querySelectorAll("form.offerCard").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (form.dataset.saving === "1") return;

      const id = form.getAttribute("data-listing-id");
      const msg = form.querySelector("[data-save-msg]");
      msg.textContent = "Saving...";

      const raw = Object.fromEntries(new FormData(form).entries());

      // Parse numeric fields properly
      const payload = {
        pci: normalizeEmpty(raw.pci),
        upc: normalizeEmpty(raw.upc),
        title: normalizeEmpty(raw.title),
        status: normalizeEmpty(raw.status),
        offer_tag: normalizeEmpty(raw.offer_tag),
        url: normalizeEmpty(raw.url),

        current_price_cents: toIntOrNull(raw.current_price_cents),
        effective_price_cents: toIntOrNull(raw.effective_price_cents),

        coupon_text: normalizeEmpty(raw.coupon_text),
        coupon_type: normalizeEmpty(raw.coupon_type),
        coupon_value_cents: toIntOrNull(raw.coupon_value_cents),
        coupon_value_pct: toNumOrNull(raw.coupon_value_pct),

        coupon_requires_clip: normalizeEmpty(raw.coupon_requires_clip),
        coupon_code: normalizeEmpty(raw.coupon_code),
        coupon_expires_at: normalizeEmpty(raw.coupon_expires_at),
      };

      // Drop undefined keys
      Object.keys(payload).forEach((k) => {
        if (payload[k] === undefined) delete payload[k];
      });

      lockForm(form, true);
      try {
        await apiJson(`/admin/api/listing/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        msg.textContent = "Saved.";
      } catch (err) {
        console.error(err);
        msg.textContent = "Save failed.";
        alert(String(err.message || err));
      } finally {
        lockForm(form, false);
      }
    });

    const btnRecord = form.querySelector('button[data-record-price="1"]');
    if (btnRecord) {
      btnRecord.addEventListener("click", async () => {
        const msg = form.querySelector("[data-save-msg]");
        msg.textContent = "Recording price...";

        // We need store + store_sku. Store is on the parent storeCol.
        const storeCol = form.closest(".storeCol");
        const store = storeCol ? storeCol.getAttribute("data-store") : "";

        const raw = Object.fromEntries(new FormData(form).entries());
        const store_sku = form.querySelector(".offerSku")?.textContent?.trim() || "";

        const price_cents = toIntOrNull(raw.current_price_cents);
        if (!store || !store_sku || price_cents == null) {
          msg.textContent = "Missing store, sku, or price.";
          return;
        }

        const payload = {
          store,
          store_sku,
          price_cents,
          pci: normalizeEmpty(raw.pci),
          upc: normalizeEmpty(raw.upc),
          coupon_text: normalizeEmpty(raw.coupon_text),
          coupon_value_cents: toIntOrNull(raw.coupon_value_cents),
          coupon_value_pct: toNumOrNull(raw.coupon_value_pct),
          effective_price_cents: toIntOrNull(raw.effective_price_cents),
        };

        try {
          await apiJson(`/admin/api/db/price_history`, {
            method: "POST",
            body: JSON.stringify(payload),
          });
          msg.textContent = "Recorded.";
        } catch (err) {
          console.error(err);
          msg.textContent = "Record failed.";
          alert(String(err.message || err));
        }
      });
    }
  });
}

async function run(){
  const q = ($("#q").value || "").trim();
  $("#status").textContent = "Loading...";

  try {
    const data = await apiJson(`/admin/api/db/items?q=${encodeURIComponent(q)}&limit=25&offset=0`);
    render(data.items || []);
    $("#status").textContent = `Loaded ${String((data.items || []).length)} item(s).`;
  } catch (err) {
    console.error(err);
    $("#status").textContent = "Load failed.";
    alert(String(err.message || err));
  }
}

$("#btnRun").addEventListener("click", run);
$("#q").addEventListener("keydown", (e) => {
  if (e.key === "Enter") run();
});

// Auto-run on open
run();
