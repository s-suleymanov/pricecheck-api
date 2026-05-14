(function () {
  const data = window.__HEAD_TO_HEAD__ || {};
  const page = data.page || {};
  const left = data.left || {};
  const right = data.right || {};

  const $ = (selector, root = document) => root.querySelector(selector);

  const BLOCKED_EXTRA_KEYS = new Set([
    "pci",
    "upc",
    "asin",
    "id",
    "created_at",
    "updated_at",
    "image_url",
    "url",
    "slug",
    "title",
    "brand",
    "category",
    "model_name",
    "model_number",
    "version",
    "variant",
    "color"
  ]);

  const EXTRA_ROW_BLOCKS = [
    {
      title: "Available Colors",
      rows: [
        {
          key: "available_colors",
          label: "Available Colors"
        }
      ]
    },
    {
      title: "Normalized Specs",
      source: "specs_norm"
    },
    {
      title: "Manufacturer Specs",
      source: "specs"
    },
    {
      title: "Dimensions",
      source: "dimensions"
    }
  ];

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function firstArray(...values) {
    for (const value of values) {
      if (Array.isArray(value)) return value;
    }

    return [];
  }

  function firstObject(...values) {
    for (const value of values) {
      if (isPlainObject(value)) return value;
    }

    return {};
  }

  function firstText(...values) {
    for (const value of values) {
      const text = String(value ?? "").trim();
      if (text) return text;
    }

    return "";
  }

  function prettyKey(key) {
    return String(key || "")
      .replace(/_/g, " ")
      .replace(/-/g, " ")
      .toLowerCase()
      .replace(/\btv\b/g, "TV")
      .replace(/\bhdr\b/g, "HDR")
      .replace(/\bhdmi\b/g, "HDMI")
      .replace(/\banc\b/g, "ANC")
      .replace(/\bip\b/g, "IP")
      .replace(/\baac\b/g, "AAC")
      .replace(/\bsbc\b/g, "SBC")
      .replace(/\bldac\b/g, "LDAC")
      .replace(/\blc3\b/g, "LC3")
      .replace(/\baptx\b/g, "aptX")
      .replace(/\busb\b/g, "USB")
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  function cleanCompareLabel(label) {
    const cleaned = String(label || "").trim()
      .replace(/^Specs Norm\s+/i, "")
      .replace(/^Specs\s+/i, "")
      .replace(/^Dimensions\s+/i, "")
      .replace(/\s+In$/i, "")
      .replace(/\s+Lb$/i, "")
      .replace(/\s+Oz$/i, "")
      .replace(/\s+G$/i, "")
      .replace(/\s+Mm$/i, "");

    const overrides = {
      "Active Noise Cancelling": "ANC",
      "Transparency Mode": "Transparency",
      "Battery Life Hours": "Battery Per Charge",
      "Battery Life With Case Hours": "Total Battery",
      "Water Resistance Rating": "Water Resistance",
      "Multipoint Pairing": "Multipoint",
      "Codec Support": "Codecs",
      "Wireless Charging Case": "Wireless Charging",
      "Built In Microphone": "Microphone",
      "Driver Size Mm": "Driver Size",
      "Avg Rating": "Average Rating",
      "Max Review Count": "Review Count",
      "Store Count": "Stores",
      "Best Price": "Lowest Price"
    };

    return overrides[cleaned] || cleaned;
  }

  function isBlankRaw(value) {
    if (value == null) return true;

    if (typeof value === "string") {
      const text = value.trim().toLowerCase();
      return !text || text === "n/a" || text === "na" || text === "null" || text === "undefined";
    }

    if (Array.isArray(value)) return value.length === 0;

    if (isPlainObject(value)) return Object.keys(value).length === 0;

    return false;
  }

  function formatPrimitive(value, key = "") {
    if (isBlankRaw(value)) return "";

    if (value === true) return "Included";
    if (value === false) return "Not Included";

    if (typeof value === "number") {
      if (key === "battery_life_hours" || key === "battery_life_with_case_hours") {
        return `${Number.isInteger(value) ? value : value.toFixed(1)} Hours`;
      }

      if (key === "driver_size_mm") return `${value} mm`;

      if (/_in$/i.test(key)) return `${Number(value).toFixed(2)} in`;
      if (/_lb$/i.test(key)) return `${Number(value).toFixed(2)} lb`;
      if (/_oz$/i.test(key)) return `${Number(value).toFixed(1)} oz`;
      if (/_g$/i.test(key)) return `${Number(value).toFixed(0)} g`;
      if (/_mm$/i.test(key)) return `${Number(value).toFixed(0)} mm`;

      if (
        key === "price_cents" ||
        key === "best_price_cents" ||
        key === "current_price_cents" ||
        key === "effective_price_cents"
      ) {
        return `$${(value / 100).toFixed(2)}`;
      }

      return String(value);
    }

    return String(value);
  }

  function formatObject(value) {
    const entries = Object.entries(value || {})
      .filter(([, v]) => !isBlankRaw(v))
      .slice(0, 12);

    if (!entries.length) return "";

    return entries
      .map(([k, v]) => `${prettyKey(k)}: ${formatValue(v, k)}`)
      .filter(Boolean)
      .join(", ");
  }

  function formatValue(value, key = "") {
    if (isBlankRaw(value)) return "";

    if (Array.isArray(value)) {
      return value
        .map(item => {
          if (isPlainObject(item)) return formatObject(item);
          if (Array.isArray(item)) return formatValue(item, key);
          return formatPrimitive(item, key);
        })
        .filter(Boolean)
        .join(", ");
    }

    if (isPlainObject(value)) return formatObject(value);

    return formatPrimitive(value, key);
  }

  function displayCompareValue(value, key = "") {
    const formatted = formatValue(value, key).trim();
    return formatted.toLowerCase() === "n/a" ? "" : formatted;
  }

  function normalizedCompareValue(value, key = "") {
    return formatValue(value, key)
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  const HIGHER_IS_BETTER_KEYS = new Set([
    "battery_life_hours",
    "battery_life_with_case_hours",
    "active_noise_cancelling",
    "transparency_mode",
    "multipoint_pairing",
    "built_in_microphone",
    "wireless_charging_case",
    "water_resistance_rating",
    "codec_support",
    "driver_size_mm",
    "avg_rating",
    "max_review_count",
    "store_count",
    "listing_count"
  ]);

  const LOWER_IS_BETTER_KEYS = new Set([
    "price",
    "current_price",
    "best_price",
    "price_cents",
    "best_price_cents",
    "current_price_cents",
    "effective_price_cents",
    "lowest_price"
  ]);

  function codecScore(value) {
    const parts = (Array.isArray(value) ? value : String(value || "").split(/[,+/]/))
      .map(item => String(item || "").trim().toLowerCase())
      .filter(Boolean);

    if (!parts.length) return null;

    let score = 0;

    for (const part of parts) {
      if (part.includes("ldac")) score += 6;
      else if (part.includes("aptx")) score += 5;
      else if (part.includes("lc3")) score += 4;
      else if (part.includes("aac")) score += 3;
      else if (part.includes("sbc")) score += 2;
      else score += 1;
    }

    return score;
  }

  function comparableNumber(value, key = "") {
    if (value == null || value === "") return null;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;

    if (Array.isArray(value)) {
      if (key === "codec_support") return codecScore(value);
      return value.length ? value.length : null;
    }

    const text = String(value).trim();

    if (!text || /^(n\/a|na|null|undefined)$/i.test(text)) return null;

    if (key === "codec_support") return codecScore(text);

    if (key === "water_resistance_rating") {
      const match = text.toUpperCase().match(/IPX?(\d+)/);
      return match ? Number(match[1]) : null;
    }

    const match = text.match(/\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function valueClasses(key, value, otherValue, options = {}) {
    const classes = [];
    const lowerIsBetter = Boolean(options.lowerIsBetter);

    if (value === true || String(displayCompareValue(value, key)).toLowerCase() === "included") {
      classes.push("is-included");
    }

    if (isBlankRaw(value) || isBlankRaw(otherValue)) {
      return Array.from(new Set(classes)).join(" ");
    }

    if (typeof value === "boolean" || typeof otherValue === "boolean") {
      if (value === true && otherValue !== true) classes.push("is-better");
      return Array.from(new Set(classes)).join(" ");
    }

    const shouldCompareNumeric = HIGHER_IS_BETTER_KEYS.has(key) || LOWER_IS_BETTER_KEYS.has(key);
    if (!shouldCompareNumeric) {
      return Array.from(new Set(classes)).join(" ");
    }

    const ownNumber = comparableNumber(value, key);
    const otherNumber = comparableNumber(otherValue, key);

    if (ownNumber == null || otherNumber == null || ownNumber === otherNumber) {
      return Array.from(new Set(classes)).join(" ");
    }

    const better = lowerIsBetter ? ownNumber < otherNumber : ownNumber > otherNumber;
    if (better) classes.push("is-better");

    return Array.from(new Set(classes)).join(" ");
  }

  function valuesDiffer(a, b, key = "") {
    return normalizedCompareValue(a, key) !== normalizedCompareValue(b, key);
  }

  function productSlot(product, fallback) {
    return firstText(product.slot, product.product_slot, fallback);
  }

  function colorNames(product) {
    const colors = Array.isArray(product.colors_available)
      ? product.colors_available
      : [];

    const names = colors
      .map(item => {
        if (typeof item === "string") return item;
        if (!item || typeof item !== "object") return "";
        return firstText(item.color, item.variant, item.variant_label, item.label);
      })
      .filter(Boolean);

    if (!names.length && product.color) names.push(product.color);
    if (!names.length && product.variant) names.push(product.variant);

    return Array.from(new Set(names.map(name => String(name).trim()).filter(Boolean)));
  }

  function getNestedValue(product, key) {
    if (!product || !key) return undefined;

    if (Object.prototype.hasOwnProperty.call(product, key)) return product[key];
    if (product.specs_norm && Object.prototype.hasOwnProperty.call(product.specs_norm, key)) return product.specs_norm[key];
    if (product.specs && Object.prototype.hasOwnProperty.call(product.specs, key)) return product.specs[key];
    if (product.dimensions && Object.prototype.hasOwnProperty.call(product.dimensions, key)) return product.dimensions[key];
    if (product.ratings && Object.prototype.hasOwnProperty.call(product.ratings, key)) return product.ratings[key];

    return undefined;
  }

  function bestSellerLabel(product) {
    const sellers = Array.isArray(product.sellers) ? product.sellers : [];
    const seller = sellers[0];

    if (!seller) return "";

    const store = firstText(seller.store, "Store");
    const price = firstText(seller.price, product.best_price);

    return [store, price].filter(Boolean).join(" ");
  }

  function rowValue(product, row, fallbackSlot) {
    if (!product || !row) return "";

    const slot = productSlot(product, fallbackSlot);
    const values = isPlainObject(row.values) ? row.values : {};
    const key = String(row.key || "").trim();

    if (Object.prototype.hasOwnProperty.call(values, slot)) return values[slot];

    if (key === "price" || key === "current_price") return product.best_price || "";
    if (key === "store_count") return product.store_count ? `${product.store_count} Stores` : "";
    if (key === "best_seller") return bestSellerLabel(product);
    if (key === "colors" || key === "available_colors") return colorNames(product).join(", ");
    if (key === "avg_rating") return product.ratings?.avg_rating ?? "";
    if (key === "max_review_count") return product.ratings?.max_review_count ?? "";

    const nested = getNestedValue(product, key);

    if (nested !== undefined && nested !== null && nested !== "") return nested;

    return "";
  }

  function comparisonRows() {
    return firstArray(page.comparison_rows, data.comparison_rows);
  }

  function quickAnswerItems() {
    return firstArray(page.quick_answer, data.quick_answer);
  }

  function quickAnswerObject() {
    return firstObject(page.quick_answer, data.quick_answer);
  }

  function winnerItems() {
    return firstArray(page.winners, data.winners);
  }

  function verdictBlocks() {
    return firstArray(page.verdict_blocks, data.verdict_blocks);
  }

  function infographicData() {
    return firstObject(page.infographic, data.infographic);
  }

  function methodData() {
    return firstObject(page.method, data.method);
  }

  function flattenExtraRows(leftObj, rightObj, parentLabel = "") {
    const leftSafe = isPlainObject(leftObj) ? leftObj : {};
    const rightSafe = isPlainObject(rightObj) ? rightObj : {};

    const keys = new Set([
      ...Object.keys(leftSafe),
      ...Object.keys(rightSafe)
    ]);

    return Array.from(keys)
      .filter(key => !BLOCKED_EXTRA_KEYS.has(String(key).toLowerCase()))
      .filter(key => {
        const av = leftSafe[key];
        const bv = rightSafe[key];
        return !(av == null || av === "") || !(bv == null || bv === "");
      })
      .flatMap(key => {
        const av = leftSafe[key];
        const bv = rightSafe[key];

        if (isPlainObject(av) || isPlainObject(bv)) {
          const nextParent = [parentLabel, prettyKey(key)].filter(Boolean).join(" ");

          return flattenExtraRows(
            isPlainObject(av) ? av : {},
            isPlainObject(bv) ? bv : {},
            nextParent
          );
        }

        return [{
          key,
          label: cleanCompareLabel([parentLabel, prettyKey(key)].filter(Boolean).join(" ")),
          left: av,
          right: bv
        }];
      });
  }

  function dedupeRows(rows) {
    const seen = new Set();

    return rows.filter(row => {
      const key = String(row.label || row.key || "").toLowerCase().trim();

      if (!key || seen.has(key)) return false;

      seen.add(key);
      return true;
    });
  }

  function manualRows() {
    return comparisonRows().map(row => ({
      ...row,
      left: rowValue(left, row, "left"),
      right: rowValue(right, row, "right")
    }));
  }

  function allComparisonBlocks() {
    const blocks = [];
    const manual = manualRows();

    if (manual.length) {
      blocks.push({
        title: "Side-By-Side",
        rows: manual
      });
    }

    for (const block of EXTRA_ROW_BLOCKS) {
      if (Array.isArray(block.rows)) {
        blocks.push({
          title: block.title,
          rows: block.rows.map(row => ({
            ...row,
            left: rowValue(left, row, "left"),
            right: rowValue(right, row, "right")
          }))
        });

        continue;
      }

      const rows = flattenExtraRows(left[block.source] || {}, right[block.source] || {});

      if (rows.length) {
        blocks.push({
          title: block.title,
          rows
        });
      }
    }

    return blocks
      .map(block => ({
        title: block.title,
        rows: dedupeRows(block.rows)
      }))
      .filter(block => block.rows.length);
  }

  function renderInfographic() {
    const info = infographicData();
    const root = $("#h2hHeroInfographic");

    if (!root) return "";

    if (!info.src) {
      root.hidden = true;
      return "";
    }

    root.hidden = false;
    root.innerHTML = `
      <a class="h2h-hero-infographic__media" href="${esc(info.src)}" target="_blank" rel="noopener noreferrer">
        <img
          src="${esc(info.src)}"
          alt="${esc(info.alt || firstText(info.headline, page.title, "Comparison infographic"))}"
          width="${esc(info.width || 1080)}"
          height="${esc(info.height || 1920)}"
          loading="eager"
          decoding="async"
        >
      </a>
    `;

    return "";
  }

  function renderHero() {
    const hero = firstObject(page.hero, data.hero);

    const eyebrow = firstText(hero.eyebrow, page.eyebrow, "Comparison");
    const heading = firstText(hero.heading, page.heading, page.title, `${left.title || "Product"} vs ${right.title || "Product"}`);
    const dek = firstText(hero.dek, page.dek, page.description, page.subtitle);

    const eyebrowEl = $("#h2hEyebrow");
    const titleEl = $("#h2hTitle");
    const dekEl = $("#h2hDek");
    const updatedEl = $("#h2hUpdated");

    if (eyebrowEl) eyebrowEl.textContent = eyebrow;
    if (titleEl) titleEl.textContent = heading;
    if (dekEl) dekEl.textContent = dek;

    const rawDate = firstText(page.generated_at, page.updated_at, data.generated_at, data.updated_at);
    const date = rawDate ? new Date(rawDate) : null;

    if (updatedEl && date && !Number.isNaN(date.getTime())) {
      updatedEl.textContent = `Updated ${date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric"
      })}`;
    } else if (updatedEl) {
      updatedEl.textContent = "";
    }
  }

    function productCard(product, side) {
    return `
      <a class="h2h-product h2h-product--${esc(side)}" href="${esc(product.dashboard_url || "#")}" aria-label="View ${esc(product.title || product.label || "product")}">
        <span class="h2h-product__image">
          <img src="${esc(product.image_url || "/logo/default.webp")}" alt="${esc(product.title || "Product")}" loading="eager" decoding="async">
        </span>
      </a>
    `;
  }

  function renderProductCards() {
    const root = $("#h2hProducts");
    if (!root) return;

    root.innerHTML = `
      ${productCard(left, "left")}
      ${productCard(right, "right")}
    `;
  }

  function renderColumnHead() {
    const root = $("#h2hColumnHead");
    if (!root) return;

    root.innerHTML = `
      <div class="h2h-compare-row h2h-compare-row--column-head">
        <div class="h2h-compare-value">
          <strong>${esc(left.title || left.label || "Left Product")}</strong>
        </div>

        <div class="h2h-compare-label">
          vs
        </div>

        <div class="h2h-compare-value h2h-compare-value--right">
          <strong>${esc(right.title || right.label || "Right Product")}</strong>
        </div>
      </div>
    `;
  }

    function compareBlockHtml(block) {
    return `
      <section class="h2h-section h2h-compare-block">
        <div class="h2h-section__head">
          <h2>${esc(block.title || "Compare")}</h2>
        </div>

        <div class="h2h-compare-list">
          ${block.rows.map(row => {
            const key = String(row.key || "").trim();
            const leftValue = row.left;
            const rightValue = row.right;
            const leftText = displayCompareValue(leftValue, key);
            const rightText = displayCompareValue(rightValue, key);
            const label = firstText(row.label, prettyKey(key), "Compare");
            const diff = valuesDiffer(leftValue, rightValue, key);
            const lowerIsBetter = LOWER_IS_BETTER_KEYS.has(key);
            const leftState = valueClasses(key, leftValue, rightValue, { lowerIsBetter });
            const rightState = valueClasses(key, rightValue, leftValue, { lowerIsBetter });

            return `
              <div class="h2h-compare-row${diff ? " is-different" : ""}">
                <div class="h2h-compare-value${leftText ? "" : " is-empty"}${leftState ? ` ${leftState}` : ""}">
                  <strong>${esc(leftText)}</strong>
                </div>

                <div class="h2h-compare-label">
                  ${esc(label)}
                </div>

                <div class="h2h-compare-value h2h-compare-value--right${rightText ? "" : " is-empty"}${rightState ? ` ${rightState}` : ""}">
                  <strong>${esc(rightText)}</strong>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </section>
    `;
  }

  function renderCompareRows() {
    const root = $("#h2hHighlights");
    if (!root) return;

    const blocks = allComparisonBlocks();

    if (!blocks.length) {
      root.innerHTML = `
        <div class="h2h-empty">
          No comparison rows were found for this page yet.
        </div>
      `;
      return;
    }

    root.innerHTML = blocks.map(compareBlockHtml).join("");
  }

  function centsFromSeller(seller) {
    const explicit = Number(seller.price_cents || seller.effective_price_cents || seller.current_price_cents || 0);

    if (Number.isFinite(explicit) && explicit > 0) return explicit;

    const parsed = Number(String(seller.price || "").replace(/[^0-9.]/g, ""));

    if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed * 100);

    return null;
  }

  function moneyFromCents(cents) {
    const n = Number(cents);

    if (!Number.isFinite(n) || n <= 0) return "";

    return `$${(n / 100).toFixed(2)}`;
  }

  function sellerGroups(product) {
    const sellers = Array.isArray(product.sellers) ? product.sellers : [];
    const byStore = new Map();

    for (const seller of sellers) {
      const store = firstText(seller.store, "Store").toLowerCase();
      const label = firstText(seller.store, "Store");
      const cents = centsFromSeller(seller);

      if (!byStore.has(store)) {
        byStore.set(store, {
          label,
          count: 0,
          best_cents: null,
          worst_cents: null,
          has_coupon: false,
          best_rating: null,
          best_review_count: null,
          url: seller.url || product.dashboard_url || "#"
        });
      }

      const group = byStore.get(store);
      group.count += 1;

      if (seller.coupon_text || seller.coupon_type || seller.coupon_value_cents || seller.coupon_value_pct) {
        group.has_coupon = true;
      }

      if (seller.rating && (!group.best_rating || Number(seller.rating) > Number(group.best_rating))) {
        group.best_rating = seller.rating;
        group.best_review_count = seller.review_count || null;
      }

      if (cents) {
        if (!group.best_cents || cents < group.best_cents) {
          group.best_cents = cents;
          group.url = seller.url || group.url;
        }

        if (!group.worst_cents || cents > group.worst_cents) {
          group.worst_cents = cents;
        }
      }
    }

    return Array.from(byStore.values())
      .sort((a, b) => {
        const ap = a.best_cents || Number.MAX_SAFE_INTEGER;
        const bp = b.best_cents || Number.MAX_SAFE_INTEGER;
        return ap - bp || a.label.localeCompare(b.label);
      });
  }

function sellerStats(product) {
  const groups = sellerGroups(product);
  const prices = groups
    .flatMap(group => [group.best_cents, group.worst_cents])
    .filter(value => Number.isFinite(Number(value)) && Number(value) > 0);

  const min = prices.length ? Math.min(...prices) : null;
  const max = prices.length ? Math.max(...prices) : null;
  const listings = groups.reduce((sum, group) => sum + group.count, 0);

  return {
    lowest: moneyFromCents(min),
    stores: groups.length || product.store_count || "",
    listings: listings || "",
    range: min && max && min !== max ? `${moneyFromCents(min)} - ${moneyFromCents(max)}` : moneyFromCents(min)
  };
}

function priceCompareRow(label, leftValue, rightValue, options = {}) {
  const leftText = String(leftValue ?? "").trim();
  const rightText = String(rightValue ?? "").trim();
  const key = String(options.key || "").trim();
  const leftRaw = options.leftRaw ?? leftValue;
  const rightRaw = options.rightRaw ?? rightValue;
  const lowerIsBetter = Boolean(options.lowerIsBetter);
  const leftState = valueClasses(key, leftRaw, rightRaw, { lowerIsBetter });
  const rightState = valueClasses(key, rightRaw, leftRaw, { lowerIsBetter });

  return `
    <div class="h2h-compare-row h2h-price-row">
      <div class="h2h-compare-value${leftText ? "" : " is-empty"}${leftState ? ` ${leftState}` : ""}">
        <strong>${esc(leftText)}</strong>
      </div>

      <div class="h2h-compare-label">
        ${esc(label)}
      </div>

      <div class="h2h-compare-value h2h-compare-value--right${rightText ? "" : " is-empty"}${rightState ? ` ${rightState}` : ""}">
        <strong>${esc(rightText)}</strong>
      </div>
    </div>
  `;
}

function renderSellers() {
  const root = $("#h2hSellers");
  if (!root) return;

  const section = root.closest(".h2h-section");
  const title = section ? section.querySelector(".h2h-section__head h2") : null;

  const leftStats = sellerStats(left);
  const rightStats = sellerStats(right);

  root.innerHTML = `
    <div class="h2h-price-compare">
      ${priceCompareRow("Lowest Price", leftStats.lowest, rightStats.lowest, { key: "lowest_price", lowerIsBetter: true })}
      ${priceCompareRow("Stores", leftStats.stores, rightStats.stores, { key: "store_count" })}
      ${priceCompareRow("Listings", leftStats.listings, rightStats.listings, { key: "listing_count" })}
      ${priceCompareRow("Price Range", leftStats.range, rightStats.range, { key: "lowest_price", lowerIsBetter: true })}
    </div>
  `;
}

    function quickAnswerHtml() {
    const arr = quickAnswerItems();
    const obj = quickAnswerObject();

    const itemText = item => firstText(
      item?.body,
      item?.summary,
      item?.text,
      item?.description,
      typeof item === "string" ? item : ""
    );

    if (arr.length) {
      const leftText = itemText(arr[0]);
      const rightText = itemText(arr[1]);

      if (!leftText && !rightText) return "";

      return `
        <section class="h2h-section h2h-summary-section">
          <div class="h2h-compare-list h2h-summary-list">
            <div class="h2h-compare-row h2h-summary-row">
              <div class="h2h-compare-value h2h-summary-value${leftText ? "" : " is-empty"}">
                <p>${esc(leftText)}</p>
              </div>

              <div class="h2h-compare-label">
                Best For
              </div>

              <div class="h2h-compare-value h2h-compare-value--right h2h-summary-value${rightText ? "" : " is-empty"}">
                <p>${esc(rightText)}</p>
              </div>
            </div>
          </div>
        </section>
      `;
    }

    const body = firstText(obj.body, obj.summary, obj.text, obj.description);

    if (body) {
      return `
        <section class="h2h-section h2h-summary-section">
          <div class="h2h-compare-list h2h-summary-list">
            <div class="h2h-compare-row h2h-summary-row">
              <div class="h2h-compare-value h2h-summary-value">
                <p>${esc(body)}</p>
              </div>

              <div class="h2h-compare-label">
                Summary
              </div>

              <div class="h2h-compare-value h2h-compare-value--right h2h-summary-value is-empty">
                <p></p>
              </div>
            </div>
          </div>
        </section>
      `;
    }

    if (typeof page.quick_answer === "string" && page.quick_answer.trim()) {
      return `
        <section class="h2h-section h2h-summary-section">
          <div class="h2h-compare-list h2h-summary-list">
            <div class="h2h-compare-row h2h-summary-row">
              <div class="h2h-compare-value h2h-summary-value">
                <p>${esc(page.quick_answer)}</p>
              </div>

              <div class="h2h-compare-label">
                Summary
              </div>

              <div class="h2h-compare-value h2h-compare-value--right h2h-summary-value is-empty">
                <p></p>
              </div>
            </div>
          </div>
        </section>
      `;
    }

    return "";
  }

  function renderQuickAnswer() {
    const root = $("#h2hQuickAnswer");
    if (!root) return quickAnswerHtml();

    const html = quickAnswerHtml();

    if (!html) {
      root.hidden = true;
      return "";
    }

    root.hidden = false;
    root.outerHTML = html;
    return "";
  }

  function winnersBySide() {
    const winners = winnerItems();
    const leftSlot = productSlot(left, "left");
    const rightSlot = productSlot(right, "right");

    return {
      left: winners.filter(item => item.winner_slot === leftSlot),
      right: winners.filter(item => item.winner_slot === rightSlot),
      other: winners.filter(item => item.winner_slot !== leftSlot && item.winner_slot !== rightSlot)
    };
  }

  function winnerCard(item) {
    return `
      <article class="h2h-winner-card">
        <strong>${esc(item.label || "Winner")}</strong>
        ${item.reason ? `<p>${esc(item.reason)}</p>` : ""}
      </article>
    `;
  }

  function winnersHtml() {
    const grouped = winnersBySide();

    if (!grouped.left.length && !grouped.right.length && !grouped.other.length) return "";

    return `
      <section class="h2h-section">
        <div class="h2h-section__head">
          <h2>Category Winners</h2>
        </div>

        <div class="h2h-winner-columns">
          <section class="h2h-winner-column">
            <div class="h2h-winner-stack">
              ${grouped.left.map(winnerCard).join("")}
            </div>
          </section>

          <section class="h2h-winner-column">
            <div class="h2h-winner-stack">
              ${grouped.right.map(winnerCard).join("")}
            </div>
          </section>
        </div>

        ${grouped.other.length ? `
          <div class="h2h-winner-other">
            ${grouped.other.map(winnerCard).join("")}
          </div>
        ` : ""}
      </section>
    `;
  }

  function renderWinners() {
    const root = $("#h2hWinners");
    if (!root) return winnersHtml();

    const html = winnersHtml();

    if (!html) {
      root.hidden = true;
      return "";
    }

    root.hidden = false;
    root.outerHTML = html;
    return "";
  }

  function verdictsHtml() {
    const blocks = verdictBlocks();

    if (!blocks.length) return "";

    return `
      <section class="h2h-section">
        <div class="h2h-section__head">
          <h2>Who Should Buy Each One</h2>
        </div>

        <div class="h2h-decision-grid">
          ${blocks.map(block => `
            <article class="h2h-decision-card">
              <h3>${esc(block.heading || "Buy If")}</h3>

              ${Array.isArray(block.items) && block.items.length ? `
                <ul>
                  ${block.items.map(item => `<li>${esc(item)}</li>`).join("")}
                </ul>
              ` : block.body ? `<p>${esc(block.body)}</p>` : ""}
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  function renderVerdicts() {
    const root = $("#h2hVerdicts");
    if (!root) return verdictsHtml();

    const html = verdictsHtml();

    if (!html) {
      root.hidden = true;
      return "";
    }

    root.hidden = false;
    root.outerHTML = html;
    return "";
  }

  function finalVerdictHtml() {
    const text = firstText(page.final_verdict, data.final_verdict);

    if (!text) return "";

    return `
      <section class="h2h-section">
        <div class="h2h-section__head">
          <h2>Final Verdict</h2>
        </div>

        <div class="h2h-final">
          <p>${esc(text)}</p>
        </div>
      </section>
    `;
  }

  function methodHtml() {
    const method = methodData();

    if (!method.heading && !method.body) return "";

    return `
      <section class="h2h-section">
        <div class="h2h-section__head">
          <h2>${esc("Methodology")}</h2>
        </div>

        ${method.body ? `
          <div class="h2h-method">
            <p>${esc(method.body)}</p>
          </div>
        ` : ""}
      </section>
    `;
  }

  function renderExtraSections() {
    const root = $("#h2hSections");
    if (!root) return;

    const html = [
      renderQuickAnswer(),
      renderWinners(),
      renderVerdicts(),
      finalVerdictHtml(),
      methodHtml()
    ].join("");

    root.innerHTML = html;
  }

  function init() {
    renderHero();
    renderProductCards();
    renderInfographic();
    renderColumnHead();
    renderCompareRows();
    renderSellers();
    renderExtraSections();
  }

  init();
})();