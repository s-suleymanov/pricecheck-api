// public/admin/bulk.js
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  function ensureAfter(el, id) {
    if (!el) return null;
    let node = document.getElementById(id);
    if (node) return node;

    node = document.createElement("div");
    node.id = id;
    node.className = "kicker";
    node.style.marginTop = "6px";
    el.insertAdjacentElement("afterend", node);
    return node;
  }

function renderColumnInspector(textareaId, lines, maxLen) {
    const ta = $(textareaId);
    if (!ta) return;

    // 1) counts line
    const meta = ensureAfter(ta, `meta_${textareaId}`);
    const filled = Array.isArray(lines) ? lines.filter((x) => String(x || "").trim() !== "").length : 0;
    const len = Array.isArray(lines) ? lines.length : 0;

    if (meta) {
      // show both how many pasted and how many filled relative to max rows
      const denom = maxLen || len || 0;
      meta.textContent =
        denom
          ? `Lines: ${len}. Filled: ${filled}/${denom}.`
          : `Lines: ${len}. Filled: ${filled}.`;
    }

    // 2) entries preview (first 30)
    const preview = ensureAfter(meta || ta, `peek_${textareaId}`);
    if (!preview) return;

    const showN = Math.min(30, Math.max(maxLen || len, len));
    const out = [];
    for (let i = 0; i < showN; i++) {
      const v = (i < len) ? String(lines[i] ?? "") : "";
      // show blanks as a visible marker so you can confirm alignment
      out.push(String(i + 1).padStart(3, " ") + "  " + (v.trim() === "" ? "·" : v));
    }

    preview.style.whiteSpace = "pre";
    preview.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    preview.style.fontSize = "12px";
    preview.style.lineHeight = "1.35";
    preview.style.padding = "10px 12px";
    preview.style.border = "1px solid var(--line, #eaecef)";
    preview.style.borderRadius = "12px";
    preview.style.background = "rgba(0,0,0,0.02)";
    preview.textContent = out.join("\n");
  }

  function renderAllColumnInspectors(cols, maxLen) {
    // Catalog
    renderColumnInspector("col_pci", cols.catalog.pci, maxLen);
    renderColumnInspector("col_model_name", cols.catalog.model_name, maxLen);
    renderColumnInspector("col_version", cols.catalog.version, maxLen);
    renderColumnInspector("col_color", cols.catalog.color, maxLen);
    renderColumnInspector("col_model_number", cols.catalog.model_number, maxLen);
    renderColumnInspector("col_brand", cols.catalog.brand, maxLen);

    // Listings
    renderColumnInspector("col_store_sku", cols.listings.store_sku, maxLen);
    renderColumnInspector("col_url", cols.listings.url, maxLen);
    renderColumnInspector("col_current_price_cents", cols.listings.current_price_cents, maxLen);
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
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) throw new Error((data && data.error) ? data.error : `HTTP ${res.status}`);
    return data;
  }

  // Normalize newlines only
  function normalizeNewlines(text) {
    return String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }

  // Preserve empty lines to maintain alignment (critical for optional blanks).
  // Also trims each line, and removes ONLY trailing blank lines (common paste artifact).
  function linesFromPreserve(text) {
    const raw = normalizeNewlines(text).split("\n").map((l) => String(l).trim());
    // drop trailing empties only
    while (raw.length && raw[raw.length - 1] === "") raw.pop();
    return raw;
  }

  // For required columns: ignore all-empty input, but preserve internal empties (so you can intentionally blank a required value if you really want to see the error).
  function linesFromRequired(text) {
    const arr = linesFromPreserve(text);
    // If user pasted nothing at all, return []
    const any = arr.some((x) => x !== "");
    return any ? arr : [];
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

    for (const r of rows.slice(0, 200)) {
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
    return "catalog_and_listings";
  }

  function readColumns() {
    // Catalog (required in catalog modes)
    const pci = linesFromRequired($("col_pci")?.value);
    const model_name = linesFromRequired($("col_model_name")?.value);
    const version = linesFromRequired($("col_version")?.value);

    // Catalog (optional, allow blanks)
    const color = linesFromPreserve($("col_color")?.value);
    const model_number = linesFromPreserve($("col_model_number")?.value);
    const brand = linesFromPreserve($("col_brand")?.value);

    // Listings (required in listings modes)
    const store_sku = linesFromRequired($("col_store_sku")?.value);
    const url = linesFromPreserve($("col_url")?.value); // OPTIONAL
    const current_price_cents = linesFromRequired($("col_current_price_cents")?.value);

    return {
      catalog: { pci, model_name, version, color, model_number, brand },
      listings: { store_sku, url, current_price_cents },
    };
  }

  function countFilled(arr) {
    if (!Array.isArray(arr) || !arr.length) return 0;
    let n = 0;
    for (const x of arr) if (String(x || "").trim() !== "") n++;
    return n;
  }

  function buildCountsSummary(cols, maxLen, wantCatalog, wantListings) {
    const parts = [];
    if (wantCatalog) {
      parts.push(
        `Catalog lines: pci ${cols.catalog.pci.length}, model_name ${cols.catalog.model_name.length}, version ${cols.catalog.version.length}, ` +
        `color ${cols.catalog.color.length} (${countFilled(cols.catalog.color)}/${maxLen} filled), ` +
        `model_number ${cols.catalog.model_number.length} (${countFilled(cols.catalog.model_number)}/${maxLen} filled), ` +
        `brand ${cols.catalog.brand.length} (${countFilled(cols.catalog.brand)}/${maxLen} filled)`
      );
    }
    if (wantListings) {
      parts.push(
        `Listings lines: store_sku ${cols.listings.store_sku.length}, url ${cols.listings.url.length}, current_price_cents ${cols.listings.current_price_cents.length}`
      );
    }
    return parts.join(" • ");
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
    const wantListings = (mode === "catalog_and_listings");

    // Decide maxLen only from required columns in the active mode.
    const reqLens = [];
    if (wantCatalog) {
      reqLens.push(cols.catalog.pci.length, cols.catalog.model_name.length, cols.catalog.version.length);
    }
    if (wantListings) {
      reqLens.push(cols.listings.store_sku.length, cols.listings.current_price_cents.length);
    }

    const maxLen = Math.max(0, ...reqLens);
    renderAllColumnInspectors(cols, maxLen);


    if (!maxLen) {
      addError("Paste at least one full row in the required columns for the selected mode.");
      setSummary("Fix errors to preview.");
      return { ok: false, rows: [], options: null };
    }

    // Required columns must exactly match maxLen.
    function requireExact(name, arr) {
      if (arr.length !== maxLen) addError(`${name} has ${arr.length} line(s), expected ${maxLen}.`);
      // Also disallow internal blank lines in required columns (almost always paste mistake).
      for (let i = 0; i < maxLen; i++) {
        if (String(takeAt(arr, i) || "").trim() === "") {
          addError(`${name} has an empty value at line ${i + 1}. Required columns cannot have blank lines.`);
          break;
        }
      }
    }

    if (wantCatalog) {
      if (!cols.catalog.pci.length) addError("Catalog: pci column is required.");
      if (!cols.catalog.model_name.length) addError("Catalog: model_name column is required.");
      if (!cols.catalog.version.length) addError("Catalog: version column is required.");

      if (cols.catalog.pci.length) requireExact("pci", cols.catalog.pci);
      if (cols.catalog.model_name.length) requireExact("model_name", cols.catalog.model_name);
      if (cols.catalog.version.length) requireExact("version", cols.catalog.version);
    }

    if (wantListings) {
      if (!cols.listings.store_sku.length) addError("Listings: store_sku column is required.");
      if (!cols.listings.current_price_cents.length) addError("Listings: current_price_cents column is required.");

      if (cols.listings.store_sku.length) requireExact("store_sku", cols.listings.store_sku);
      if (cols.listings.current_price_cents.length) requireExact("current_price_cents", cols.listings.current_price_cents);

      // url is optional, but if provided it cannot exceed maxLen
      validateOptional("url", cols.listings.url);
    }


    // Optional columns may be:
    // - length 0 (not provided)
    // - length == maxLen (full alignment)
    // - length < maxLen IF they truly ended early (we will treat missing as blank at bottom)
    // But if user wants blanks in the middle, they must preserve them by leaving empty lines, and that naturally gives length == maxLen.
    function validateOptional(name, arr) {
      if (!arr.length) return;
      if (arr.length > maxLen) addError(`${name} has ${arr.length} line(s), expected at most ${maxLen}.`);
    }

    if (wantCatalog) {
      validateOptional("color", cols.catalog.color);
      validateOptional("model_number", cols.catalog.model_number);
      validateOptional("brand", cols.catalog.brand);
    }

    const hadErrors = $("bulkErrors")?.children?.length > 0;
    if (hadErrors) {
      setSummary("Fix errors to preview.");
      return { ok: false, rows: [], options: null };
    }

    const rows = [];
    for (let i = 0; i < maxLen; i++) {
      const brandMaybe = emptyToNull(takeAt(cols.catalog.brand, i));
      const r = {
        __line: i + 1,

        // shared
        pci: wantCatalog ? emptyToNull(takeAt(cols.catalog.pci, i)) : null,
        upc: null,

        // catalog fields
        brand: wantCatalog ? (brandMaybe || defaultBrand) : null,
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

    const counts = buildCountsSummary(cols, maxLen, wantCatalog, wantListings);

    setSummary(
      `Ready. Rows: ${rows.length}. Mode: ${mode.replaceAll("_", " ")}. ` +
      `Catalog: ${options.doCatalog ? "on" : "off"}, Listings: ${options.doListings ? "on" : "off"}. ` +
      `(${counts})`
    );

    renderTableRows(rows);
    setStatus("Preview ready.");
    return { ok: true, rows, options };
  }

  function pasteTemplate() {
    $("source_store").value = "NIU";
    $("default_brand").value = "NIU";
    $("write_mode").value = "catalog_and_listings";

    $("col_pci").value = ["PCI123ABC", "PCI123ABD"].join("\n");
    $("col_model_name").value = ["NIU KQi 3 Electric scooter", "NIU KQi 3 Electric scooter"].join("\n");
    $("col_version").value = ["KQi 3 Pro", "KQi 3 Sport"].join("\n");

    // Example: second row has no color (blank line preserved)
    $("col_color").value = ["Black", ""].join("\n");

    $("col_model_number").value = ["kqi3_2025", "kqi3_2025"].join("\n");

    // Example: second row brand left blank to use Default brand
    $("col_brand").value = ["NIU", ""].join("\n");

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

    $("write_mode")?.addEventListener("change", () => {
      clearErrors();
      clearTable();
      setSummary("Mode changed. Click Preview rows.");
      setStatus("Ready.");
    });

    const watchIds = [
      "col_pci","col_model_name","col_version","col_color","col_model_number","col_brand",
      "col_store_sku","col_url","col_current_price_cents"
    ];

    for (const id of watchIds) {
      $(id)?.addEventListener("input", () => {
        const cols = readColumns();
        // pick a maxLen that is stable enough for live feedback:
        const mode = getWriteMode();
        const wantCatalog = (mode === "catalog_only" || mode === "catalog_and_listings");
        const wantListings = (mode === "listings_only" || mode === "catalog_and_listings");
        const reqLens = [];
        if (wantCatalog) reqLens.push(cols.catalog.pci.length, cols.catalog.model_name.length, cols.catalog.version.length);
        if (wantListings) reqLens.push(cols.listings.store_sku.length, cols.listings.current_price_cents.length);
        const maxLen = Math.max(0, ...reqLens);
        renderAllColumnInspectors(cols, maxLen);
      });
    }

    setStatus("Ready.");
  }

  document.addEventListener("DOMContentLoaded", wire);
})();