// public/admin/bulk.js
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  async function apiJson(url, opts = {}) {
    const res = await fetch(url, {
      cache: "no-store",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) throw new Error((data && data.error) ? data.error : `HTTP ${res.status}`);
    return data;
  }

  function linesFrom(text) {
    return String(text || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length);
  }

  function takeAt(arr, i) {
    return (i >= 0 && i < arr.length) ? arr[i] : "";
  }

  function toIntOrNull(x) {
    const s = String(x == null ? "" : x).trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }

  function emptyToNull(x) {
    const s = String(x == null ? "" : x).trim();
    return s ? s : null;
  }

  function normStore(x) {
    // Manufacturer store, keep as user typed but trimmed.
    // Backend can canonicalize further if you want.
    const s = String(x || "").trim();
    return s ? s : null;
  }

  function setStatus(msg) {
    const el = $("status");
    if (el) el.textContent = msg;
  }

  function setSummary(msg) {
    const el = $("bulkSummary");
    if (el) el.textContent = msg;
  }

  function clearErrors() {
    const el = $("bulkErrors");
    if (el) el.innerHTML = "";
  }

  function addError(msg) {
    const el = $("bulkErrors");
    if (!el) return;
    const div = document.createElement("div");
    div.className = "kicker";
    div.style.marginTop = "6px";
    div.textContent = msg;
    el.appendChild(div);
  }

  function clearTable() {
    const tb = $("bulkTable")?.querySelector("tbody");
    if (tb) tb.innerHTML = "";
  }

  function renderTableRows(rows) {
    const tb = $("bulkTable")?.querySelector("tbody");
    if (!tb) return;
    tb.innerHTML = "";

    const cols = [
      "__i",
      "pci",
      "model_name",
      "version",
      "color",
      "model_number",
      "brand",
      "store_sku",
      "url",
      "current_price_cents",
    ];

    for (const r of rows.slice(0, 100)) {
      const tr = document.createElement("tr");

      for (const k of cols) {
        const td = document.createElement("td");
        td.style.padding = "8px";
        td.style.borderBottom = "1px solid #f0f1f3";
        td.style.verticalAlign = "top";

        let v = "";
        if (k === "__i") v = String(r.__line || "");
        else v = (r[k] == null ? "" : String(r[k]));

        td.textContent = v;
        tr.appendChild(td);
      }
      tb.appendChild(tr);
    }
  }

  function getWriteMode() {
    const v = String($("write_mode")?.value || "catalog_and_listings");
    if (v === "catalog_only") return "catalog_only";
    if (v === "listings_only") return "listings_only";
    return "catalog_and_listings";
  }

  function readColumns() {
    // Catalog
    const pci = linesFrom($("col_pci")?.value);
    const model_name = linesFrom($("col_model_name")?.value);
    const version = linesFrom($("col_version")?.value);
    const color = linesFrom($("col_color")?.value);
    const model_number = linesFrom($("col_model_number")?.value);
    const brand = linesFrom($("col_brand")?.value);

    // Listings
    const store_sku = linesFrom($("col_store_sku")?.value);
    const url = linesFrom($("col_url")?.value);
    const current_price_cents = linesFrom($("col_current_price_cents")?.value);

    return {
      catalog: { pci, model_name, version, color, model_number, brand },
      listings: { store_sku, url, current_price_cents },
    };
  }

  function buildRowsForPreview() {
    clearErrors();
    clearTable();

    const sourceStore = normStore($("source_store")?.value);
    const mode = getWriteMode();

    const defaultBrand = emptyToNull($("default_brand")?.value);

    if (!sourceStore) {
      addError("Manufacturer store is required.");
      setSummary("Fix errors to preview.");
      return { ok: false, rows: [], options: null };
    }

    const cols = readColumns();

    const wantCatalog = (mode === "catalog_only" || mode === "catalog_and_listings");
    const wantListings = (mode === "listings_only" || mode === "catalog_and_listings");

    const lengths = [];

    if (wantCatalog) {
      lengths.push(cols.catalog.pci.length);
      lengths.push(cols.catalog.model_name.length);
      lengths.push(cols.catalog.version.length);
      lengths.push(cols.catalog.color.length);
      lengths.push(cols.catalog.model_number.length);
      lengths.push(cols.catalog.brand.length);
    }

    if (wantListings) {
      lengths.push(cols.listings.store_sku.length);
      lengths.push(cols.listings.url.length);
      lengths.push(cols.listings.current_price_cents.length);
    }

    const maxLen = Math.max(0, ...lengths);
    if (!maxLen) {
      addError("Paste at least one value in one of the columns.");
      setSummary("Fix errors to preview.");
      return { ok: false, rows: [], options: null };
    }

    // Validate required columns based on mode
    if (wantCatalog) {
      if (!cols.catalog.pci.length) addError("Catalog: pci column is required.");
      if (!cols.catalog.model_name.length) addError("Catalog: model_name column is required.");
      if (!cols.catalog.version.length) addError("Catalog: version column is required.");
    }

    if (wantListings) {
      if (!cols.listings.store_sku.length) addError("Listings: store_sku column is required.");
      if (!cols.listings.url.length) addError("Listings: url column is required.");
      if (!cols.listings.current_price_cents.length) addError("Listings: current_price_cents column is required.");
    }

    // Validate line counts match exactly across pasted columns for the selected mode.
    // This is the "guided" part: no silent misalignment.
    function requireSameLen(name, arr) {
      if (arr.length === 0) return;
      if (arr.length !== maxLen) addError(`${name} has ${arr.length} lines, but expected ${maxLen}.`);
    }

    if (wantCatalog) {
      requireSameLen("pci", cols.catalog.pci);
      requireSameLen("model_name", cols.catalog.model_name);
      requireSameLen("version", cols.catalog.version);
      // Optional but if present must match
      if (cols.catalog.color.length) requireSameLen("color", cols.catalog.color);
      if (cols.catalog.model_number.length) requireSameLen("model_number", cols.catalog.model_number);
      if (cols.catalog.brand.length) requireSameLen("brand", cols.catalog.brand);
    }

    if (wantListings) {
      requireSameLen("store_sku", cols.listings.store_sku);
      requireSameLen("url", cols.listings.url);
      requireSameLen("current_price_cents", cols.listings.current_price_cents);
    }

    // If any errors were appended, stop.
    const hadErrors = $("bulkErrors")?.children?.length > 0;
    if (hadErrors) {
      setSummary("Fix errors to preview.");
      return { ok: false, rows: [], options: null };
    }

    const rows = [];
    for (let i = 0; i < maxLen; i++) {
      const r = {
        __line: i + 1,

        // shared
        pci: wantCatalog ? emptyToNull(takeAt(cols.catalog.pci, i)) : null,
        upc: null,

        // catalog fields
        brand: wantCatalog
          ? (emptyToNull(takeAt(cols.catalog.brand, i)) || defaultBrand)
          : null,
        category: null,
        model_number: wantCatalog ? emptyToNull(takeAt(cols.catalog.model_number, i)) : null,
        model_name: wantCatalog ? emptyToNull(takeAt(cols.catalog.model_name, i)) : null,
        version: wantCatalog ? emptyToNull(takeAt(cols.catalog.version, i)) : null,
        color: wantCatalog ? emptyToNull(takeAt(cols.catalog.color, i)) : null,
        image_url: null,
        recall_url: null,
        dropship_warning: null,
        coverage_warning: null,

        // listings fields
        store: wantListings ? sourceStore : null,
        store_sku: wantListings ? emptyToNull(takeAt(cols.listings.store_sku, i)) : null,
        url: wantListings ? emptyToNull(takeAt(cols.listings.url, i)) : null,
        current_price_cents: wantListings ? toIntOrNull(takeAt(cols.listings.current_price_cents, i)) : null,
        title: wantListings ? null : null,
        status: wantListings ? "active" : null,
        offer_tag: wantListings ? "official" : null,
      };

      rows.push(r);
    }

    const options = {
      doCatalog: wantCatalog,
      doListings: wantListings,
      doHistory: false,
    };

    setSummary(
      `Ready. Rows: ${rows.length}. Mode: ${mode.replaceAll("_", " ")}. ` +
      `Catalog: ${options.doCatalog ? "on" : "off"}, Listings: ${options.doListings ? "on" : "off"}.`
    );

    renderTableRows(rows);
    setStatus("Preview ready.");
    return { ok: true, rows, options };
  }

  function pasteTemplate() {
    // Minimal "columns" template. Each textarea gets example lines.
    $("source_store").value = "NIU";
    $("default_brand").value = "NIU";
    $("write_mode").value = "catalog_and_listings";

    $("col_pci").value = ["PCI123ABC", "PCI123ABD"].join("\n");
    $("col_model_name").value = ["NIU KQi 3 Electric scooter", "NIU KQi 3 Electric scooter"].join("\n");
    $("col_version").value = ["KQi 3 Pro", "KQi 3 Sport"].join("\n");
    $("col_color").value = ["Black", "Black"].join("\n");
    $("col_model_number").value = ["kqi3_2025", "kqi3_2025"].join("\n");
    $("col_brand").value = ["NIU", "NIU"].join("\n");

    $("col_store_sku").value = ["KQi3Pro-Black", "KQi3Sport-Black"].join("\n");
    $("col_url").value = ["https://www.niu.com/products/kqi-3-pro", "https://www.niu.com/products/kqi-3-sport"].join("\n");
    $("col_current_price_cents").value = ["99900", "79900"].join("\n");

    clearErrors();
    clearTable();
    setSummary("Template pasted. Click Preview rows.");
    setStatus("Template pasted.");
  }

  function clearAll() {
    const ids = [
      "source_store",
      "default_brand",
      "col_pci",
      "col_model_name",
      "col_version",
      "col_color",
      "col_model_number",
      "col_brand",
      "col_store_sku",
      "col_url",
      "col_current_price_cents",
    ];
    for (const id of ids) {
      const el = $(id);
      if (el) el.value = "";
    }
    clearErrors();
    clearTable();
    setSummary("Cleared.");
    setStatus("Ready.");
  }

  async function doImport() {
    clearErrors();

    const built = buildRowsForPreview();
    if (!built.ok) {
      setStatus("Fix errors.");
      return;
    }

    try {
      setStatus(`Importing ${built.rows.length} row(s)...`);

      const data = await apiJson("/admin/api/bulk", {
        method: "POST",
        body: JSON.stringify({ options: built.options, rows: built.rows }),
      });

      const errCount = Array.isArray(data.errors) ? data.errors.length : 0;

      setStatus(
        `Done. Catalog: ${data.catalog_upserts || 0}, Listings: ${data.listing_upserts || 0}, ` +
        `History: ${data.history_inserts || 0}, Errors: ${errCount}`
      );

      if (errCount) {
        for (const e of data.errors.slice(0, 200)) {
          addError(`Line ${e.line || 0}: ${e.error || "error"}`);
        }
      } else {
        setSummary(
          `Imported ${built.rows.length} rows. ` +
          `catalog_upserts=${data.catalog_upserts || 0}, listing_upserts=${data.listing_upserts || 0}.`
        );
      }
    } catch (e) {
      setStatus(`Failed: ${e && e.message ? e.message : "error"}`);
      addError(String(e && e.stack ? e.stack : e));
    }
  }

  function wire() {
    $("btnTemplate")?.addEventListener("click", pasteTemplate);
    $("btnClear")?.addEventListener("click", clearAll);

    $("btnPreview")?.addEventListener("click", () => {
      buildRowsForPreview();
    });

    $("btnValidate")?.addEventListener("click", () => {
      clearErrors();
      clearTable();
      const built = buildRowsForPreview();
      if (built.ok) setStatus("Validation passed.");
      else setStatus("Validation failed.");
    });

    $("btnImport")?.addEventListener("click", doImport);

    // If user changes mode, wipe preview so they don't import stale view
    $("write_mode")?.addEventListener("change", () => {
      clearErrors();
      clearTable();
      setSummary("Mode changed. Click Preview rows.");
      setStatus("Ready.");
    });
  }

  document.addEventListener("DOMContentLoaded", wire);
})();