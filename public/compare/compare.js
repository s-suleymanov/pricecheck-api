(() => {
  const payload = window.__HEAD_TO_HEAD__ || {};
  const page = payload.page || {};
  const left = payload.left || {};
  const right = payload.right || {};
  const compareOptions = payload.compare_options || {};
  const NOT_LISTED = "Not Listed";

  const $ = id => document.getElementById(id);

  const els = {
    eyebrow: $("h2hEyebrow"),
    title: $("h2hTitle"),
    dek: $("h2hDek"),
    updated: $("h2hUpdated"),
    products: $("h2hProducts"),
    columnHead: $("h2hColumnHead"),
    quickAnswer: $("h2hQuickAnswer"),
    sellers: $("h2hSellers"),
    highlights: $("h2hHighlights"),
    verdicts: $("h2hVerdicts"),
    sections: $("h2hSections")
  };

  function cleanText(value, fallback = "") {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return text || fallback;
  }

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeKey(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  function isPlainObject(value) {
    return value && typeof value === "object" && !Array.isArray(value);
  }

  function isRealValue(value) {
    if (value === false) return true;
    if (value === 0) return true;
    if (value == null) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "string") return value.trim() !== "";
    return true;
  }

  function titleCase(value) {
    const text = cleanText(value);
    if (!text) return "";
    return text
      .split(" ")
      .map(word => {
        if (/^(ANC|USB|TV|IPX?\d+|AAC|SBC|LDAC|LC3|SSC)$/i.test(word)) {
          return word.toUpperCase();
        }

        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(" ");
  }

  function compactNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(1)));
  }

  function moneyFromCents(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return "";
    return `$${(n / 100).toFixed(2)}`;
  }

  function bestPrice(product) {
    return cleanText(product.best_price) || moneyFromCents(product.best_price_cents) || NOT_LISTED;
  }

  function bestStore(product) {
    const seller = product.best_seller || {};
    return titleCase(seller.store || "") || NOT_LISTED;
  }

  function productTitle(product) {
    return cleanText(product.label || product.title || product.model_name || "Product");
  }

  function productSubtitle(product) {
    const parts = [
      cleanText(product.brand),
      cleanText(product.category)
    ].filter(Boolean);

    return parts.join(" · ");
  }

  function productImage(product) {
    return cleanText(product.image_url || "/logo/default.webp");
  }

  function productUrl(product) {
    return cleanText(product.dashboard_url || "#");
  }

function flattenSpecs(source, prefix = "") {
  const out = new Map();

  if (!isPlainObject(source)) return out;

  for (const [key, value] of Object.entries(source)) {
    if (!isRealValue(value)) continue;

    const label = prefix ? `${prefix} ${key}` : key;

    if (isPlainObject(value)) {
      for (const [childKey, childValue] of flattenSpecs(value, label)) {
        out.set(childKey, childValue);
      }
    } else {
      out.set(label, value);
    }
  }

  return out;
}

const SPEC_KEY_ALIASES = {
  batterylifehours: "battery_life",
  batterylife: "battery_life",
  batteryaveragelife: "battery_life",
  singlechargelisteningtime: "battery_life",
  earbudbatterylife: "battery_life",

  batterylifewithcasehours: "case_battery_life",
  casebatterylife: "case_battery_life",
  chargingcasebatterylife: "case_battery_life",

  activenoisecancelling: "noise_canceling",
  noisecancelling: "noise_canceling",
  noisecanceling: "noise_canceling",
  anc: "noise_canceling",

  transparencymode: "transparency_mode",
  fit: "fit",
  fittype: "fit",
  headphonefit: "fit",

  waterresistancerating: "water_resistance",
  waterresistance: "water_resistance",

  multipointpairing: "multipoint",
  multipoint: "multipoint",

  wirelesschargingcase: "wireless_charging_case",

  fastcharging: "fast_charging",

  earbudchargetime: "earbud_charge_time",
  chargetime: "earbud_charge_time",

  codecsupport: "codec_support",
  codecs: "codec_support"
};

const QUICK_LOOK_KEYS = new Set([
  "battery_life",
  "case_battery_life",
  "noise_canceling",
  "transparency_mode",
  "fit",
  "water_resistance",
  "multipoint",
  "wireless_charging_case",
  "fast_charging",
  "earbud_charge_time",
  "codec_support"
]);

const SPEC_LABEL_OVERRIDES = {
  driversizemm: "Driver Size",
  driverdiametermm: "Driver Size",
  earbudweightg: "Earbud Weight",
  microphonecount: "Microphones",
  builtinmicrophone: "Built-In Microphone",
  bluetoothversion: "Bluetooth Version",
  chargingport: "Charging Port",
  connectiontype: "Connection Type",
  producttype: "Product Type",
  controltype: "Control Type",
  drivertype: "Driver Type",
  audiodrivertype: "Audio Driver Type",
  frequencyresponse: "Frequency Response",
  frequencyrange: "Frequency Range",
  wirelessrange: "Wireless Range",
  voiceassistant: "Voice Assistant",
  appsupport: "App Support",
  leaudio: "LE Audio",
  auracast: "Auracast"
};

function canonicalSpecKey(key) {
  const normalized = normalizeKey(key);
  return SPEC_KEY_ALIASES[normalized] || normalized;
}

function humanSpecLabel(key) {
  const normalized = normalizeKey(key);

  if (SPEC_LABEL_OVERRIDES[normalized]) {
    return SPEC_LABEL_OVERRIDES[normalized];
  }

  return titleCase(
    String(key || "")
      .replace(/_/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function autoValue(value) {
  if (!isRealValue(value)) return NOT_LISTED;

  if (Array.isArray(value)) {
    return value.map(item => cleanText(item)).filter(Boolean).join(", ") || NOT_LISTED;
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (typeof value === "number") {
    return compactNumber(value);
  }

  return cleanText(value, NOT_LISTED);
}

function mapSpecs(source) {
  const mapped = new Map();

  for (const [key, value] of flattenSpecs(source)) {
    const canonical = canonicalSpecKey(key);

    if (!canonical) continue;

    mapped.set(canonical, {
      key: canonical,
      label: humanSpecLabel(key),
      value
    });
  }

  return mapped;
}

function buildSpecsNormRows() {
  const leftSpecs = mapSpecs(left.specs_norm);
  const rightSpecs = mapSpecs(right.specs_norm);
  const keys = Array.from(new Set([...leftSpecs.keys(), ...rightSpecs.keys()]));

  return keys
    .filter(key => !QUICK_LOOK_KEYS.has(key))
    .map(key => {
      const leftItem = leftSpecs.get(key);
      const rightItem = rightSpecs.get(key);
      const label = leftItem?.label || rightItem?.label || "Spec";

      return {
        key,
        label,
        left: autoValue(leftItem?.value),
        right: autoValue(rightItem?.value),
        leftRaw: leftItem?.value,
        rightRaw: rightItem?.value
      };
    });
}

function buildSharedSpecRows(existingKeys = new Set()) {
  const leftSpecs = mapSpecs(left.specs);
  const rightSpecs = mapSpecs(right.specs);
  const rows = [];

  for (const [key, leftItem] of leftSpecs) {
    if (QUICK_LOOK_KEYS.has(key)) continue;
    if (existingKeys.has(key)) continue;
    if (!rightSpecs.has(key)) continue;

    const rightItem = rightSpecs.get(key);

    rows.push({
      key,
      label: leftItem.label,
      left: autoValue(leftItem.value),
      right: autoValue(rightItem.value),
      leftRaw: leftItem.value,
      rightRaw: rightItem.value
    });
  }

  return rows.sort((a, b) => a.label.localeCompare(b.label));
}

function buildFullSpecSections() {
  const specsNormRows = buildSpecsNormRows();

  const usedKeys = new Set([
    ...mapSpecs(left.specs_norm).keys(),
    ...mapSpecs(right.specs_norm).keys()
  ]);

  const sharedSpecRows = buildSharedSpecRows(usedKeys);

  const renderedKeys = new Set([
    ...QUICK_LOOK_KEYS,
    ...specsNormRows.map(row => row.key),
    ...sharedSpecRows.map(row => row.key)
  ]);

  return {
    specsNormRows,
    sharedSpecRows,
    renderedKeys
  };
}

function allSpecItems(product, renderedKeys = new Set()) {
  const items = [];
  const seen = new Set();

  function addFrom(sourceName, source) {
    const specs = mapSpecs(source);

    for (const [key, item] of specs) {
      if (renderedKeys.has(key)) continue;
      if (seen.has(key)) continue;

      seen.add(key);

      items.push({
        key,
        sourceName,
        label: item.label,
        value: autoValue(item.value)
      });
    }
  }

  addFrom("Core", product.specs_norm);
  addFrom("More", product.specs);

  return items;
}

function renderAllSpecsPanel(product, renderedKeys = new Set(), side = "left") {
  const items = allSpecItems(product, renderedKeys);
  const panelId = `h2hAllSpecsPanel-${side}`;

  return `
    <div class="h2h-all-specs-panel" id="${esc(panelId)}" hidden>
      ${
        items.length
          ? `
            <dl class="h2h-all-specs__list">
              ${items.map(item => `
                <div class="h2h-all-specs__row">
                  <dt>${esc(item.label)}</dt>
                  <dd>${esc(item.value)}</dd>
                </div>
              `).join("")}
            </dl>
          `
          : `<p class="h2h-all-specs__empty">No additional specs listed.</p>`
      }
    </div>
  `;
}

function wireAllSpecsToggles() {
  document.querySelectorAll("[data-all-specs-toggle]").forEach(button => {
    button.addEventListener("click", () => {
      const panelId = button.getAttribute("aria-controls");
      const panel = panelId ? document.getElementById(panelId) : null;
      if (!panel) return;

      const isOpen = button.getAttribute("aria-expanded") === "true";
      const nextOpen = !isOpen;

      button.setAttribute("aria-expanded", String(nextOpen));
      button.textContent = nextOpen ? "Hide Specs" : "More Specs";
      panel.hidden = !nextOpen;
    });
  });
}

  function readExact(source, key) {
    if (!isPlainObject(source)) return undefined;

    if (Object.prototype.hasOwnProperty.call(source, key)) {
      return source[key];
    }

    const wanted = normalizeKey(key);

    for (const [sourceKey, sourceValue] of Object.entries(source)) {
      if (normalizeKey(sourceKey) === wanted) {
        return sourceValue;
      }
    }

    return undefined;
  }

  function readSpec(product, keys) {
    const sources = [
      product.specs_norm,
      product.specs,
      product.dimensions,
      product
    ];

    for (const key of keys) {
      for (const source of sources) {
        const value = readExact(source, key);

        if (isRealValue(value)) {
          return value;
        }
      }
    }

    return null;
  }

  function formatPlain(value) {
    if (!isRealValue(value)) return NOT_LISTED;

    if (Array.isArray(value)) {
      return value.map(item => cleanText(item)).filter(Boolean).join(", ") || NOT_LISTED;
    }

    if (typeof value === "boolean") {
      return value ? "Yes" : "No";
    }

    return cleanText(value, NOT_LISTED);
  }

  function formatHours(value) {
    if (!isRealValue(value)) return NOT_LISTED;

    const n = Number(value);
    if (Number.isFinite(n)) {
      return `${compactNumber(n)}h`;
    }

    return cleanText(value, NOT_LISTED);
  }

  function formatMinutes(value) {
    if (!isRealValue(value)) return NOT_LISTED;

    const n = Number(value);
    if (Number.isFinite(n)) {
      return `${compactNumber(n)} min`;
    }

    return cleanText(value, NOT_LISTED);
  }

  function formatBoolean(value, yes = "Yes", no = "No") {
    if (value === true) return yes;
    if (value === false) return no;

    const text = cleanText(value).toLowerCase();
    if (!text) return NOT_LISTED;
    if (["true", "yes", "y", "1"].includes(text)) return yes;
    if (["false", "no", "n", "0"].includes(text)) return no;

    return titleCase(value);
  }

  function formatNoise(value) {
    return formatBoolean(value, "ANC", "No ANC");
  }

  function formatFit(value) {
    const text = cleanText(value);
    if (!text) return NOT_LISTED;

    const normalized = text.toLowerCase();

    if (normalized.includes("open") && normalized.includes("hook")) {
      return "Open-Ear Hook";
    }

    if (normalized.includes("ear hook")) {
      return "Ear Hook";
    }

    if (normalized.includes("open")) {
      return "Open-Ear";
    }

    if (normalized.includes("in-ear") || normalized.includes("in ear")) {
      return "In-Ear";
    }

    return titleCase(text);
  }

  function formatWater(value) {
    const text = cleanText(value);
    if (!text) return NOT_LISTED;
    return text.toUpperCase();
  }

  function formatCodec(value) {
    if (!isRealValue(value)) return NOT_LISTED;

    const list = Array.isArray(value)
      ? value
      : String(value).split(",").map(item => item.trim());

    const cleaned = list
      .map(item => cleanText(item))
      .filter(Boolean)
      .slice(0, 4);

    return cleaned.length ? cleaned.join(", ") : NOT_LISTED;
  }

  function getNumeric(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function getWaterScore(value) {
    const text = cleanText(value).toUpperCase();

    const scores = {
      IPX4: 4,
      IPX5: 5,
      IP55: 6,
      IP56: 7,
      IP57: 8,
      IP67: 9,
      IP68: 10
    };

    return scores[text] ?? null;
  }

  function compareClass(row, side) {
    if (!row.compare) return "";

    const leftRaw = row.leftRaw;
    const rightRaw = row.rightRaw;

    let leftScore = null;
    let rightScore = null;

    if (row.compare === "lowerPrice") {
      leftScore = getNumeric(leftRaw);
      rightScore = getNumeric(rightRaw);

      if (leftScore == null || rightScore == null || leftScore === rightScore) return "";
      return side === "left"
        ? leftScore < rightScore ? " is-better" : ""
        : rightScore < leftScore ? " is-better" : "";
    }

    if (row.compare === "higherNumber") {
      leftScore = getNumeric(leftRaw);
      rightScore = getNumeric(rightRaw);

      if (leftScore == null || rightScore == null || leftScore === rightScore) return "";
      return side === "left"
        ? leftScore > rightScore ? " is-better" : ""
        : rightScore > leftScore ? " is-better" : "";
    }

    if (row.compare === "water") {
      leftScore = getWaterScore(leftRaw);
      rightScore = getWaterScore(rightRaw);

      if (leftScore == null || rightScore == null || leftScore === rightScore) return "";
      return side === "left"
        ? leftScore > rightScore ? " is-better" : ""
        : rightScore > leftScore ? " is-better" : "";
    }

    return "";
  }

  function isControlsRow(row) {
    return normalizeKey(row?.key || row?.label) === "controls";
  }

  function controlItems(value) {
    if (!isRealValue(value) || value === NOT_LISTED) return [];

    if (Array.isArray(value)) {
      return value.map(item => cleanText(item)).filter(Boolean);
    }

    const text = cleanText(value);
    if (!text) return [];

    return text
      .split(/;\s+|,\s+(?=(?:press|tap|swipe|squeeze|pinch|hold)\b)/i)
      .map(item => cleanText(item))
      .filter(Boolean);
  }

  function controlValueHtml(value) {
    const items = controlItems(value);

    if (!items.length) {
      return `<strong class="h2h-metric-value">${esc(value || NOT_LISTED)}</strong>`;
    }

    return `
      <ul class="h2h-control-list">
        ${items.map(item => `<li>${esc(item)}</li>`).join("")}
      </ul>
    `;
  }

  function metricCell(row, side) {
    const value = side === "left" ? row.left : row.right;
    const empty = !isRealValue(value) || value === NOT_LISTED;
    const better = compareClass(row, side);
    const controls = isControlsRow(row);

    return `
      <div class="h2h-metric-cell${empty ? " is-empty" : ""}${better}${controls ? " h2h-metric-cell--controls" : ""}">
        ${
          controls
            ? controlValueHtml(value)
            : `<strong class="h2h-metric-value">${esc(value || NOT_LISTED)}</strong>`
        }
        <span class="h2h-metric-label">${esc(row.label)}</span>
      </div>
    `;
  }

  function metricRow(row) {
    return `
      <div class="h2h-metric-row">
        ${metricCell(row, "left")}
        ${metricCell(row, "right")}
      </div>
    `;
  }

  function optionLabel(option) {
    return cleanText(option.label || option.title || option.name || option.key || "Product");
  }

  function optionValue(option) {
    return cleanText(option.path || option.url || option.href || "");
  }

  function buildSelect(side, product, options) {
  const list = Array.isArray(options) && options.length
    ? options
    : [{
        label: productTitle(product),
        path: window.location.pathname,
        selected: true
      }];

  const selectId = side === "left" ? "h2hLeftSelect" : "h2hRightSelect";

  return `
    <select
      class="h2h-product-select"
      id="${selectId}"
      aria-label="${esc(productTitle(product))}"
    >
      ${list.map(option => {
        const selected = option.selected ? " selected" : "";
        const value = optionValue(option) || window.location.pathname;

        return `<option value="${esc(value)}"${selected}>${esc(optionLabel(option))}</option>`;
      }).join("")}
    </select>
  `;
}

  function wireSelect(id) {
    const select = $(id);
    if (!select) return;

    select.addEventListener("change", () => {
      const nextPath = cleanText(select.value);

      if (!nextPath || nextPath === window.location.pathname) return;

      window.location.href = nextPath;
    });
  }

  function renderHero() {
    if (els.eyebrow) {
      els.eyebrow.textContent = cleanText(page.eyebrow, "Comparison");
      els.eyebrow.href = "/explore/";
    }

    if (els.title) {
      els.title.textContent = cleanText(
        page.heading || page.title,
        `${productTitle(left)} vs ${productTitle(right)}`
      );
    }

    if (els.updated) {
      const generated = cleanText(page.generated_at);

      if (generated) {
        const date = new Date(generated);

        els.updated.textContent = Number.isNaN(date.getTime())
          ? ""
          : `Updated ${date.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric"
            })}`;
      } else {
        els.updated.textContent = "";
      }
    }
  }

  function renderProductCards() {
  if (!els.products) return;

  els.products.innerHTML = [left, right].map(product => `
    <a
      class="h2h-product"
      href="${esc(productUrl(product))}"
      aria-label="${esc(productTitle(product))}"
    >
      <span class="h2h-product__image" aria-hidden="true">
        <img
          src="${esc(productImage(product))}"
          alt=""
          loading="eager"
          decoding="async"
        />
      </span>
    </a>
  `).join("");
}

  function renderStickySelectors() {
    if (!els.columnHead) return;

    els.columnHead.innerHTML = `
      <div class="h2h-sticky-grid">
        <div class="h2h-sticky-product">
          ${buildSelect("left", left, compareOptions.left)}
        </div>

        <div class="h2h-sticky-product">
          ${buildSelect("right", right, compareOptions.right)}
        </div>
      </div>
    `;

    wireSelect("h2hLeftSelect");
    wireSelect("h2hRightSelect");
  }

  function firstString(...values) {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }

      if (Array.isArray(value) && value.length) {
        const first = value.find(item => typeof item === "string" && item.trim());
        if (first) return first.trim();
      }
    }

    return "";
  }

  function verdictSummary(product) {
    const verdict = product.verdict_json || {};

    return firstString(
      verdict.summary,
      verdict.quick_answer,
      verdict.quickAnswer,
      verdict.verdict,
      verdict.decision,
      verdict.short_verdict
    );
  }

  function renderQuickAnswer() {
    if (!els.quickAnswer) return;

    const leftText = verdictSummary(left);
    const rightText = verdictSummary(right);

    if (!leftText && !rightText) {
      els.quickAnswer.hidden = true;
      return;
    }

    els.quickAnswer.hidden = false;
    els.quickAnswer.innerHTML = `
      <div class="h2h-section__head">
        <h2>Quick Answer</h2>
      </div>

      <div class="h2h-answer-grid">
        <article class="h2h-answer-card">
          <h3>${esc(productTitle(left))}</h3>
          <p>${esc(leftText || "Pick this if its price and feature mix fits your use case better.")}</p>
        </article>

        <article class="h2h-answer-card">
          <h3>${esc(productTitle(right))}</h3>
          <p>${esc(rightText || "Pick this if its price and feature mix fits your use case better.")}</p>
        </article>
      </div>
    `;
  }

  function renderPrice() {
    if (!els.sellers) return;

    const rows = [
      {
        label: "Best Price",
        left: bestPrice(left),
        right: bestPrice(right),
        leftRaw: left.best_price_cents,
        rightRaw: right.best_price_cents,
        compare: "lowerPrice"
      },
      {
        label: "Lowest Store",
        left: bestStore(left),
        right: bestStore(right)
      },
      {
        label: "Stores Checked",
        left: left.store_count ? `${left.store_count}` : NOT_LISTED,
        right: right.store_count ? `${right.store_count}` : NOT_LISTED,
        leftRaw: left.store_count,
        rightRaw: right.store_count,
        compare: "higherNumber"
      }
    ];

    els.sellers.innerHTML = `
      <div class="h2h-metric-list">
        ${rows.map(metricRow).join("")}
      </div>
    `;
  }

  function specRow(label, keys, formatter, compare = "") {
    const leftRaw = readSpec(left, keys);
    const rightRaw = readSpec(right, keys);

    if (!isRealValue(leftRaw) && !isRealValue(rightRaw)) {
      return null;
    }

    return {
      label,
      left: formatter(leftRaw),
      right: formatter(rightRaw),
      leftRaw,
      rightRaw,
      compare
    };
  }

  function renderSpecs() {
    if (!els.highlights) return;

    const rows = [
      specRow("Earbud Battery Life", ["battery_life_hours", "Earbud Battery Life"], formatHours, "higherNumber"),
      specRow("Case Battery Life", ["battery_life_with_case_hours", "Case Battery Life"], formatHours, "higherNumber"),
      specRow("Noise Canceling", ["active_noise_cancelling", "Noise Canceling", "ANC"], formatNoise),
      specRow("Transparency Mode", ["transparency_mode", "Transparency Mode"], value => formatBoolean(value, "Yes", "No")),
      specRow("Fit", ["fit", "fit_type", "Fit"], formatFit),
      specRow("Water Resistance", ["water_resistance_rating", "Water Resistance"], formatWater, "water"),
      specRow("Multipoint Pairing", ["multipoint_pairing", "Multipoint Pairing"], value => formatBoolean(value, "Yes", "No")),
      specRow("Wireless Charging Case", ["wireless_charging_case", "Wireless Charging Case"], value => formatBoolean(value, "Yes", "No")),
      specRow("Fast Charging", ["fast_charging", "Fast Charging"], formatPlain),
      specRow("Earbud Charge Time", ["earbud_charge_time", "Earbud Charge Time"], formatMinutes),
      specRow("Codec Support", ["codec_support", "Codec Support"], formatCodec)
    ].filter(Boolean);

    if (!rows.length) {
      els.highlights.innerHTML = `
        <p class="h2h-empty">
          No useful comparison specs are available yet.
        </p>
      `;
      return;
    }

    els.highlights.innerHTML = `
      <div class="h2h-metric-list">
        ${rows.map(metricRow).join("")}
      </div>
    `;
  }

  function normalizeList(value) {
    if (Array.isArray(value)) {
      return value.map(item => cleanText(item)).filter(Boolean);
    }

    if (typeof value === "string" && value.trim()) {
      return [value.trim()];
    }

    return [];
  }

  function verdictLists(product) {
    const verdict = product.verdict_json || {};

    return {
      buy: normalizeList(verdict.buy_if || verdict.buyIf || verdict.best_for || verdict.bestFor),
      skip: normalizeList(verdict.skip_if || verdict.skipIf || verdict.not_for || verdict.notFor)
    };
  }

  function renderList(items) {
    if (!items.length) {
      return `<p>No clear notes yet.</p>`;
    }

    return `
      <ul>
        ${items.slice(0, 4).map(item => `<li>${esc(item)}</li>`).join("")}
      </ul>
    `;
  }

  function renderVerdicts() {
  if (!els.verdicts) return;

  const leftLists = verdictLists(left);
  const rightLists = verdictLists(right);
  const hasContent =
    leftLists.buy.length ||
    leftLists.skip.length ||
    rightLists.buy.length ||
    rightLists.skip.length;

  if (!hasContent) {
    els.verdicts.hidden = true;
    return;
  }

  els.verdicts.hidden = false;
  els.verdicts.innerHTML = `
    <div class="h2h-section__head">
      <h2>Buying Fit</h2>
    </div>

    <div class="h2h-verdict-grid h2h-verdict-grid--merged">
      <article class="h2h-verdict-card">
        <h3>Buy ${esc(productTitle(left))} If</h3>
        ${renderList(leftLists.buy)}
      </article>

      <article class="h2h-verdict-card">
        <h3>Buy ${esc(productTitle(right))} If</h3>
        ${renderList(rightLists.buy)}
      </article>

      <article class="h2h-verdict-card">
        <h3>Skip ${esc(productTitle(left))} If</h3>
        ${renderList(leftLists.skip)}
      </article>

      <article class="h2h-verdict-card">
        <h3>Skip ${esc(productTitle(right))} If</h3>
        ${renderList(rightLists.skip)}
      </article>
    </div>
  `;
}

  function renderFullSpecs() {
  if (!els.sections) return;

  const { specsNormRows, sharedSpecRows } = buildFullSpecSections();

  if (!specsNormRows.length && !sharedSpecRows.length) {
    els.sections.innerHTML = "";
    return;
  }

  els.sections.innerHTML = `
    <section class="h2h-section" id="h2hFullSpecs">
      <div class="h2h-section__head">
        <h2>Full Specs</h2>
      </div>

      ${specsNormRows.length ? `
        <div class="h2h-spec-group">
          <div class="h2h-metric-list">
            ${specsNormRows.map(metricRow).join("")}
          </div>
        </div>
      ` : ""}

      ${sharedSpecRows.length ? `
        <div class="h2h-spec-group">
          <div class="h2h-metric-list">
            ${sharedSpecRows.map(metricRow).join("")}
          </div>
        </div>
      ` : ""}
    </section>
  `;
  }

function renderProductEndCard(product, renderedKeys, side) {
  const panelId = `h2hAllSpecsPanel-${side}`;

  return `
    <article class="h2h-end-card">
      <a
        class="h2h-end-card__image"
        href="${esc(productUrl(product))}"
        aria-label="View ${esc(productTitle(product))}"
      >
        <img
          src="${esc(productImage(product))}"
          alt=""
          loading="lazy"
          decoding="async"
        />
      </a>

      <h3>${esc(productTitle(product))}</h3>

      <div class="h2h-end-actions">
        <a class="h2h-end-card__link" href="${esc(productUrl(product))}">
          View Product
        </a>

        <button
          class="h2h-all-specs-toggle"
          type="button"
          data-all-specs-toggle="${esc(side)}"
          aria-controls="${esc(panelId)}"
          aria-expanded="false"
        >
          More Specs
        </button>
      </div>

      ${renderAllSpecsPanel(product, renderedKeys, side)}
    </article>
  `;
}

function renderEndLinks() {
  if (!els.sections) return;

  const { renderedKeys } = buildFullSpecSections();

  els.sections.insertAdjacentHTML("beforeend", `
    <section class="h2h-section h2h-end-section" id="h2hEndLinks">
      <div class="h2h-section__head">
        <h2>Learn More</h2>
      </div>

      <div class="h2h-end-grid">
        ${renderProductEndCard(left, renderedKeys, "left")}
        ${renderProductEndCard(right, renderedKeys, "right")}
      </div>
    </section>
  `);

  wireAllSpecsToggles();
}

  function renderSectionTitles() {
    const quickLookTitle = document.querySelector("#h2hSpecsSection .h2h-section__head h2");

    if (quickLookTitle) {
      quickLookTitle.textContent = "Quick Look";
    }
  }

 function render() {
  renderHero();
  renderSectionTitles();
  renderProductCards();
  renderStickySelectors();
  renderQuickAnswer();
  renderPrice();
  renderSpecs();
  renderVerdicts();
  renderFullSpecs();
  renderEndLinks();
}

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }
})();