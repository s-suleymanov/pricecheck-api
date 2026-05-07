(function () {
  const data = window.__BUYING_PAGE__ || {};
  const page = data.page || {};
  const picks = Array.isArray(data.picks) ? data.picks : [];
  const comparisonRows = Array.isArray(data.comparison_rows) ? data.comparison_rows : [];

    const BUYING_PRODUCT_EVENT_ENDPOINT = "/api/buying/product-event";

  function cleanBuyingEventValue(value, max = 800) {
    const text = String(value || "").trim();
    if (!text) return "";
    return text.slice(0, max);
  }

  function buyingDashboardKeyFromUrl(rawUrl) {
    const href = String(rawUrl || "").trim();
    if (!href) return "";

    try {
      const url = new URL(href, location.origin);
      const parts = url.pathname.split("/").filter(Boolean);
      const dashboardIndex = parts.indexOf("dashboard");

      if (dashboardIndex === -1) return "";

      const kind = parts[dashboardIndex + 2] || "";
      const value = parts[dashboardIndex + 3] || "";

      if (!kind || !value) return "";

      return `${kind}:${decodeURIComponent(value)}`;
    } catch {
      return "";
    }
  }

  function findBuyingProductByHref(rawHref) {
    const targetKey = buyingDashboardKeyFromUrl(rawHref);

    if (targetKey) {
      const hit = picks.find(product => {
        return buyingDashboardKeyFromUrl(product.dashboard_url) === targetKey;
      });

      if (hit) return hit;
    }

    const href = String(rawHref || "").trim();

    return picks.find(product => {
      return String(product.dashboard_url || "").trim() === href;
    }) || null;
  }

  function buyingProductEventBasePayload() {
    return {
      page_type: cleanBuyingEventValue(page.type || "guide", 80),
      page_category: cleanBuyingEventValue(page.category || page.category_label || "", 120),
      page_slug: cleanBuyingEventValue(page.slug || "", 160),
      page_title: cleanBuyingEventValue(page.title || document.title || "", 300),
      page_path: cleanBuyingEventValue(location.pathname, 500),
      page_url: cleanBuyingEventValue(location.href, 1000)
    };
  }

  function trackBuyingProductEvent(payload) {
    const eventType = cleanBuyingEventValue(payload?.event_type || "", 80);
    if (!eventType) return;

    const body = JSON.stringify({
      ...buyingProductEventBasePayload(),
      ...payload
    });

    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: "application/json" });
        const sent = navigator.sendBeacon(BUYING_PRODUCT_EVENT_ENDPOINT, blob);
        if (sent) return;
      }
    } catch {}

    try {
      fetch(BUYING_PRODUCT_EVENT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true
      }).catch(() => {});
    } catch {}
  }

  function wireBuyingProductEventTracking() {
    document.addEventListener("click", event => {
      const target = event.target && event.target.nodeType === 1
        ? event.target
        : event.target?.parentElement;

      const link = target?.closest?.("a[href]");
      if (!link) return;

      const href = link.getAttribute("href") || "";
      const key = buyingDashboardKeyFromUrl(href);

      if (!key) return;

      const product = findBuyingProductByHref(href);

      trackBuyingProductEvent({
        event_type: "dashboard_product_click",
        product_key: cleanBuyingEventValue(key, 200),
        product_pci: cleanBuyingEventValue(product?.pci || "", 80),
        product_upc: cleanBuyingEventValue(product?.upc || "", 80),
        product_title: cleanBuyingEventValue(product?.title || link.textContent || "", 300),
        product_label: cleanBuyingEventValue(product?.label || "", 160),
        product_slot: cleanBuyingEventValue(product?.slot || "", 160),
        target_url: cleanBuyingEventValue(link.href || href, 1000),
        target_label: cleanBuyingEventValue(link.textContent || product?.title || "", 300),
        metadata: {
          link_class: cleanBuyingEventValue(link.className || "", 200)
        }
      });
    }, { capture: true });
  }

  function trackBuyingPageView() {
    trackBuyingProductEvent({
      event_type: "page_view",
      metadata: {
        ranked_count: Number(data.ranked_count || picks.length || 0),
        pick_count: picks.length
      }
    });
  }

  const $ = (selector, root = document) => root.querySelector(selector);

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatGeneratedAt(value) {
    if (!value) return "";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "";

    return `Updated ${date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric"
    })}`;
  }

  function formatAuthorDate(value) {
    if (!value) return "";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "";

    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const yy = String(date.getFullYear()).slice(-2);

    return `${mm}.${dd}.${yy}`;
  }

  function sellerText(product) {
    const seller = product.best_seller;

    if (!seller || !seller.store) return "Best seller unavailable";

    const rating = seller.rating ? ` · ${seller.rating}★` : "";
    const reviews = seller.review_count ? ` · ${Number(seller.review_count).toLocaleString()} Reviews` : "";

    return `Best seller: ${seller.store}${rating}${reviews}`;
  }

  function storeCountText(count) {
    const n = Number(count || 0);

    if (n === 1) return "1 Store";
    return `${n} Stores`;
  }

  function firstLine(value) {
    if (Array.isArray(value)) return value[0] || "";
    return String(value || "");
  }

  function getTargetProduct() {
    const targetSlot = page.target_slot || page.primary_product_slot;

    if (targetSlot) {
        const found = picks.find(product => product.slot === targetSlot);
        if (found) return found;
    }

    return picks[0] || null;
    }

    function getProductDisplayLabel(product) {
    if (!product) return "Product";

    return product.label || product.title || product.model_name || product.brand || "Product";
    }

    function getWorthRangeState(item, priceCents) {
    const min = Number(item.min_cents ?? 0);
    const rawMax = item.max_cents;
    const max = rawMax === null || rawMax === undefined ? Infinity : Number(rawMax);

    if (!Number.isFinite(priceCents) || priceCents <= 0) return false;
    if (!Number.isFinite(min)) return false;

    return priceCents >= min && priceCents <= max;
    }

  function renderHero() {
    const hero = page.hero || {};

    $("#buyingEyebrow").textContent = hero.eyebrow || "Buying Guide";
    $("#buyingTitle").textContent = hero.heading || page.title || "Buying Guide";
    $("#buyingDek").textContent = hero.dek || page.description || "";

    const dek = $("#buyingDek");
    if (dek && !document.querySelector(".buying-author")) {
      const authorDate = formatAuthorDate(page.published_at || page.date || data.generated_at);

      dek.insertAdjacentHTML("afterend", `
        <p class="buying-author">
          <span>Sam Lyman</span>
          ${authorDate ? `<span class="buying-author__sep">/</span><span>${esc(authorDate)}</span>` : ""}
        </p>
      `);
    }

    const updated = $("#buyingUpdated");
    if (updated) updated.textContent = formatGeneratedAt(data.generated_at);

    const rankedCount = $("#rankedCount");

    if (rankedCount) {
    rankedCount.remove();
    }

  }

function renderQuickAnswer() {
  const root = $("#quickAnswerGrid");

  if (!root) return;

  const pageType = String(page.type || "").toLowerCase();
  const isComparison = pageType === "comparison";
  const isBrandGuide = pageType === "brand_guide";
  const isWorthIt = pageType === "worth_it";

  if (isWorthIt) {
    root.classList.add("buying-quick__grid--worth");

    const target = getTargetProduct();
    const targetLabel = getProductDisplayLabel(target);

    root.innerHTML = `
    <div class="quick-pick quick-pick--worth">
        <span>${esc(page.quick_answer_heading || "Quick Answer")}</span>
        <small>${esc(page.quick_answer || page.description || "")}</small>
        ${target ? `<a class="buying-button worth-quick-button" href="${esc(target.dashboard_url)}">View Full Page</a>` : ""}
    </div>
    `;

    return;
  }
  
  if ((isComparison || isBrandGuide) && Array.isArray(page.quick_answer) && page.quick_answer.length) {
      root.classList.add("buying-quick__grid--compare");
      root.classList.remove("buying-quick__grid--worth");

      const infographic = page.infographic && typeof page.infographic === "object"
        ? page.infographic
        : null;

      const infographicSrc = String(infographic?.src || "").trim();

      const infographicId = page.slug
        ? `pc-infographic-hidden:${page.slug}`
        : `pc-infographic-hidden:${location.pathname}`;

      const infographicHidden = infographicSrc && localStorage.getItem(infographicId) === "1";

      const infographicHtml = infographicSrc && !infographicHidden
        ? `
          <figure class="buying-infographic" data-buying-infographic data-infographic-storage-key="${esc(infographicId)}">
            <button class="buying-infographic__hide" type="button" data-hide-infographic="1">
              Hide infographic
            </button>

            <img
              src="${esc(infographicSrc)}"
              alt="${esc(infographic.alt || "")}"
              width="${esc(infographic.width || 1080)}"
              height="${esc(infographic.height || 1920)}"
              loading="lazy"
              decoding="async"
            >

            ${infographic.caption ? `<figcaption>${esc(infographic.caption)}</figcaption>` : ""}
          </figure>
        `
        : "";

      root.innerHTML = page.quick_answer.map(item => {
        return `
          <div class="quick-pick quick-pick--compare">
            <span>${esc(item.label || "")}</span>
            <small>${esc(item.body || "")}</small>
          </div>
        `;
      }).join("") + infographicHtml;

      return;
    }

  root.classList.remove("buying-quick__grid--compare");
  root.classList.remove("buying-quick__grid--worth");

 const quickAnswer = page.quick_answer && typeof page.quick_answer === "object"
  ? page.quick_answer
  : {};

const quickAnswerBody = String(quickAnswer.body || "").trim();

const quickAnswerHtml = quickAnswerBody
  ? `
    <div class="buying-quick__answer">
      <strong>${esc(quickAnswer.heading || "Quick Answer")}</strong>
      <p>${esc(quickAnswerBody)}</p>
    </div>
  `
  : "";

const infographic = page.infographic && typeof page.infographic === "object"
  ? page.infographic
  : quickAnswer.infographic && typeof quickAnswer.infographic === "object"
    ? quickAnswer.infographic
    : null;

const infographicSrc = String(infographic?.src || "").trim();

const infographicId = page.slug
  ? `pc-infographic-hidden:${page.slug}`
  : `pc-infographic-hidden:${location.pathname}`;

const infographicHidden = infographicSrc && localStorage.getItem(infographicId) === "1";

const infographicHtml = infographicSrc && !infographicHidden
  ? `
    <figure class="buying-infographic" data-buying-infographic data-infographic-storage-key="${esc(infographicId)}">
      <button class="buying-infographic__hide" type="button" data-hide-infographic="1">
        Hide infographic
      </button>

      <img
        src="${esc(infographicSrc)}"
        alt="${esc(infographic.alt || "")}"
        width="${esc(infographic.width || 1080)}"
        height="${esc(infographic.height || 1920)}"
        loading="lazy"
        decoding="async"
      >

      ${infographic.caption ? `<figcaption>${esc(infographic.caption)}</figcaption>` : ""}
    </figure>
  `
  : "";

  root.innerHTML = quickAnswerHtml + infographicHtml + picks.map(product => {
    return `
      <a class="quick-pick" href="#${esc(product.slot || "")}">
        <span>${esc(product.label)}</span>
        <strong>${esc(product.title)}</strong>
        <small>${esc(product.price)}</small>
      </a>
    `;
  }).join("");
}

function wireInfographicControls() {
  document.addEventListener("click", event => {
    const button = event.target?.closest?.("[data-hide-infographic]");
    if (!button) return;

    const figure = button.closest("[data-buying-infographic]");
    if (!figure) return;

    const storageKey = figure.getAttribute("data-infographic-storage-key");

    if (storageKey) {
      try {
        localStorage.setItem(storageKey, "1");
      } catch {}
    }

    figure.remove();
  });
}

function renderPickCards() {
  const root = $("#topPicks");

  if (!root) return;

  const pageType = String(page.type || "").toLowerCase();
  const isComparison = pageType === "comparison";
  const isWorthIt = pageType === "worth_it";
  const isBrandGuide = pageType === "brand_guide";

  if (isWorthIt) {
    renderWorthItDecision(root);
    return;
  }

  if (isComparison) {
    renderComparisonDecision(root);
    return;
  }

  if (isBrandGuide) {
    renderBrandGuideDecision(root);
    return;
  }

  root.innerHTML = picks.map((product, index) => {
    const buyIf = firstLine(product.buy_if);
    const skipIf = firstLine(product.skip_if);

    return `
      <article class="buying-card" id="${esc(product.slot || `pick-${index + 1}`)}">
        <a class="buying-card__image" href="${esc(product.dashboard_url)}" aria-label="Open ${esc(product.title)} dashboard">
          <img src="${esc(product.image_url)}" alt="${esc(product.title)}" loading="lazy" decoding="async">
        </a>

        <div class="buying-card__body">
          <p class="buying-card__label">${esc(product.label)}</p>
          <h3 class="buying-card__title">${esc(product.title)}</h3>

          <div class="buying-card__meta">
            <span class="buying-pill">${esc(storeCountText(product.store_count))}</span>
          </div>

          <p class="buying-card__verdict">${esc(product.verdict)}</p>

          <div class="buying-card__decision">
            <div class="buying-decision-box">
              <strong>Buy If</strong>
              <p>${esc(buyIf)}</p>
            </div>

            <div class="buying-decision-box">
              <strong>Skip If</strong>
              <p>${esc(skipIf)}</p>
            </div>
          </div>
        </div>

        <div class="buying-card__side">
          <div>
            <div class="buying-price">${esc(product.price)}</div>
            <div class="buying-seller">${esc(sellerText(product))}</div>
          </div>

          <a class="buying-button" href="${esc(product.dashboard_url)}">See More</a>
        </div>
      </article>
    `;
  }).join("");
}

function brandGuideBoolSpec(value) {
  if (typeof value === "boolean") return value;

  const text = String(value ?? "").trim().toLowerCase();

  return ["true", "yes", "1", "included"].includes(text);
}

function brandGuideBatterySpec(value) {
  const n = Number(value);

  if (!Number.isFinite(n) || n <= 0) return "N/A";

  const display = Number.isInteger(n) ? String(n) : n.toFixed(1);

  return `${display} Hours`;
}

function brandGuideWaterSpec(value) {
  const text = String(value ?? "").trim();

  if (!text) return "N/A";

  return text.toUpperCase();
}

function brandGuideCodecLabel(value) {
  return String(value || "")
    .trim()
    .replace(/\bsbc\b/gi, "SBC")
    .replace(/\baac\b/gi, "AAC")
    .replace(/\bldac\b/gi, "LDAC")
    .replace(/\blc3\b/gi, "LC3")
    .replace(/\baptx\b/gi, "aptX");
}

function brandGuideCodecSpec(value) {
  if (Array.isArray(value)) {
    const codecs = value
      .map(item => brandGuideCodecLabel(item))
      .filter(Boolean);

    return codecs.length ? codecs.join(", ") : "N/A";
  }

  const text = String(value ?? "").trim();

  if (!text) return "N/A";

  const parts = text
    .replace(/\s+and\s+/gi, ",")
    .split(/[,\n|/]+/)
    .map(item => brandGuideCodecLabel(item))
    .filter(Boolean);

  return parts.length ? parts.join(", ") : brandGuideCodecLabel(text);
}

function brandGuideSpecValue(key, value) {
  if (key === "active_noise_cancelling") {
    return brandGuideBoolSpec(value) ? "Included" : "Not Included";
  }

  if (key === "battery_life_hours") {
    return brandGuideBatterySpec(value);
  }

  if (key === "water_resistance_rating") {
    return brandGuideWaterSpec(value);
  }

  if (key === "multipoint_pairing") {
    return brandGuideBoolSpec(value) ? "Included" : "Not Included";
  }

  if (key === "codec_support") {
    return brandGuideCodecSpec(value);
  }

  return "N/A";
}

function renderBrandGuideSpecBoxes(product) {
  const specs = product && product.specs_norm && typeof product.specs_norm === "object"
    ? product.specs_norm
    : {};

  const items = [
    {
      key: "active_noise_cancelling",
      label: "ANC"
    },
    {
      key: "battery_life_hours",
      label: "Battery Life"
    },
    {
      key: "water_resistance_rating",
      label: "Water Resistance"
    },
    {
      key: "multipoint_pairing",
      label: "Multipoint"
    },
    {
      key: "codec_support",
      label: "Codec"
    }
  ];

  return `
    <div class="brand-guide-spec-grid" aria-label="${esc(product.title || "Product")} key specs">
      ${items.map(item => {
        return `
          <div class="brand-guide-spec-card">
            <strong>${esc(brandGuideSpecValue(item.key, specs[item.key]))}</strong>
            <span>${esc(item.label)}</span>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderBrandGuideDecision(root) {
  const parentSection = root.closest(".buying-section");
  const kicker = parentSection ? $(".buying-kicker", parentSection) : null;
  const isEarbudsBrandGuide = String(page.category || page.category_label || "")
    .toLowerCase()
    .includes("earbud");

  if (kicker) kicker.textContent = "Best For Each Buyer";

  function brandGuideFit(product) {
    const title = String(product.title || "").toLowerCase();
    const brand = String(page.brand || product.brand || "").toLowerCase();

    if (brand.includes("sony") || title.includes("sony")) {
      if (title.includes("wf-1000xm5") || title.includes("1000xm5")) {
        return {
          label: "Premium ANC Pick",
          fit: "Buy this if you want Sony's premium earbud pick for ANC, LDAC, and higher-end daily listening.",
          skip: "Skip it if you want the lowest-price Sony option."
        };
      }

      if (title.includes("wf-c700n") || title.includes("c700n")) {
        return {
          label: "Lower-Price ANC Pick",
          fit: "Buy this if you want Sony noise cancelling without paying premium XM5 pricing.",
          skip: "Skip it if you want Sony's strongest ANC and premium feature set."
        };
      }

      if (title.includes("wf-c510") || title.includes("c510")) {
        return {
          label: "Cheaper Simple Sony Pick",
          fit: "Buy this if you want a lower-price Sony pair for simple daily use and do not need ANC.",
          skip: "Skip it if noise cancelling matters."
        };
      }

      if (title.includes("linkbuds s")) {
        return {
          label: "Small Lightweight ANC Pick",
          fit: "Buy this if you want a smaller Sony ANC earbud for everyday use.",
          skip: "Skip it if you want Sony's top premium ANC pick."
        };
      }

      if (title.includes("linkbuds fit")) {
        return {
          label: "Workout Fit Pick",
          fit: "Buy this if you want a Sony pair focused more on movement, fit, and daily activity.",
          skip: "Skip it if you want the strongest Sony ANC."
        };
      }

      if (title.includes("wf-1000xm4") || title.includes("1000xm4")) {
        return {
          label: "Older Premium Value Pick",
          fit: "Buy this if you want older Sony premium value and the price is clearly below the XM5.",
          skip: "Skip it if the XM5 is close in price."
        };
      }

      return {
        label: product.label || "Sony Pick",
        fit: product.buyer_fit || product.verdict || "Buy this if it fits your Sony use case better than the other models.",
        skip: firstLine(product.skip_if) || "Skip it if another Sony model fits your main use case better."
      };
    }

    if (title.includes("p31i")) {
      return {
        label: "First Pair / Lower Price",
        fit: "Buy this if you want a lower-price first Soundcore pair with ANC, LDAC, multipoint, and strong battery life.",
        skip: "Skip it if wireless charging matters."
      };
    }

    if (title.includes("p40i")) {
      return {
        label: "Wireless Charging Pick",
        fit: "Buy this if you want a lower-price Soundcore pair with wireless charging, ANC, multipoint, and long battery life.",
        skip: "Skip it if LDAC matters."
      };
    }

    if (title.includes("p41i")) {
      return {
        label: "Huge Battery / Phone-Charging Case",
        fit: "Buy this if battery life is the reason you are buying, or if you want the phone-charging case.",
        skip: "Skip it if you want a compact case or wireless charging."
      };
    }

    if (title.includes("liberty 4 nc")) {
      return {
        label: "Safer All-Around ANC Pick",
        fit: "Buy this if you want the safest Soundcore pick for most people, with ANC, LDAC, multipoint, wireless charging, and broad store coverage.",
        skip: "Skip it if you want the upgraded Liberty model."
      };
    }

    if (title.includes("liberty 4 pro")) {
      return {
        label: "Upgraded Soundcore Pick",
        fit: "Buy this if you want the more premium Soundcore option with LDAC, ANC, multipoint, wireless charging, and deeper controls.",
        skip: "Skip it if you are trying to stay under $100."
      };
    }

    if (title.includes("space a40")) {
      return {
        label: "Smaller Older Value Pick",
        fit: "Buy this if you want a compact older Soundcore value pick with ANC, LDAC, multipoint, and wireless charging.",
        skip: "Skip it if you want the newest Soundcore model."
      };
    }

    if (title.includes("liberty 5")) {
      return {
        label: "Newer Liberty Pick Under $100",
        fit: "Buy this if you want a newer Liberty model with LDAC, Dolby Audio, ANC, multipoint, wireless charging, and IP55 durability.",
        skip: "Skip it if you want the cheaper Liberty 4 NC."
      };
    }

    if (title.includes("sport x20")) {
      return {
        label: "Workout Pick",
        fit: "Buy this if you want Soundcore earbuds for workouts, adjustable ear hooks, stronger water resistance, ANC, and long battery life.",
        skip: "Skip it if you want wireless charging or a tiny pocket case."
      };
    }

    if (title.includes("aeroclip")) {
      return {
        label: "Open-Ear Awareness Pick",
        fit: "Buy this if you want open-ear awareness, a clip-on fit, LDAC, multipoint, and less ear-canal pressure.",
        skip: "Skip it if you want ANC, sealed bass, or private listening."
      };
    }

    return {
      label: product.label || "Brand Pick",
      fit: product.buyer_fit || product.verdict || "Buy this if it matches your main use case better than the other models.",
      skip: firstLine(product.skip_if) || "Skip it if another model fits your main use case better."
    };
  }

  const cards = picks.map(product => {
    const fit = brandGuideFit(product);
    const specBoxes = isEarbudsBrandGuide ? renderBrandGuideSpecBoxes(product) : "";

    return `
      <article class="brand-guide-card" id="${esc(product.slot || "")}">
        <a class="brand-guide-card__image" href="${esc(product.dashboard_url)}" aria-label="Open ${esc(product.title)} dashboard">
          <img src="${esc(product.image_url)}" alt="${esc(product.title)}" loading="lazy" decoding="async">
        </a>

        <div class="brand-guide-card__body">
          <p class="buying-card__label">${esc(fit.label)}</p>
          <h3>${esc(product.title)}</h3>
          <p>${esc(fit.fit)}</p>

          ${specBoxes}

          <p class="brand-guide-card__skip">
            <span class="brand-guide-card__skip-icon" aria-hidden="true">
              <svg viewBox="0 -960 960 960" focusable="false">
                <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"></path>
              </svg>
            </span>
            <span>${esc(fit.skip)}</span>
          </p>

          <div class="brand-guide-card__action">
            <span class="brand-guide-card__price">From ${esc(product.price)}</span>
            <a class="brand-guide-card__link" href="${esc(product.dashboard_url)}">View Full Page</a>
          </div>
        </div>
      </article>
    `;
  }).join("");

  root.innerHTML = `
    <div class="brand-guide-block">
      <div class="brand-guide-grid">
        ${cards}
      </div>
    </div>

    ${page.final_verdict ? `
      <div class="worth-final-card">
        <p class="buying-kicker">Final Recommendation</p>
        <p>${esc(page.final_verdict)}</p>
      </div>
    ` : ""}
  `;
}

function renderComparisonDecision(root) {
  const parentSection = root.closest(".buying-section");
  const kicker = parentSection ? $(".buying-kicker", parentSection) : null;

  if (kicker) kicker.textContent = "Current Prices";

  const winners = Array.isArray(data.winners) ? data.winners : [];
  const verdictBlocks = Array.isArray(data.verdict_blocks) ? data.verdict_blocks : [];

  const priceCards = picks.map(product => {
    return `
      <article class="compare-price-card" id="${esc(product.slot || "")}">
        <a class="compare-price-card__image" href="${esc(product.dashboard_url)}">
          <img src="${esc(product.image_url)}" alt="${esc(product.title)}" loading="lazy" decoding="async">
        </a>

        <div>
          <h3>${esc(product.title)}</h3>
          <p class="compare-price-card__price">From ${esc(product.price)}</p>
          <p class="compare-price-card__seller">${esc(sellerText(product))}</p>
        </div>

        <a class="buying-button" href="${esc(product.dashboard_url)}">View Full Page</a>
      </article>
    `;
  }).join("");

  const winnerCards = winners.map(item => {
    return `
      <div class="compare-winner-card">
        <span>${esc(item.label)}</span>
        <strong>${esc(item.winner)}</strong>
        <p>${esc(item.reason || "")}</p>
      </div>
    `;
  }).join("");

  const verdictHtml = verdictBlocks.map(block => {
    return `
      <div class="compare-verdict-card">
        <h3>${esc(block.heading)}</h3>
        <ul>
          ${(block.items || []).map(item => `<li>${esc(item)}</li>`).join("")}
        </ul>
      </div>
    `;
  }).join("");

  const actionButtons = picks.map(product => {
    return `<a class="buying-button compare-action-button" href="${esc(product.dashboard_url)}">Open ${esc(product.label || product.title)}</a>`;
  }).join("");

  root.innerHTML = `
    <div class="compare-price-grid">
      ${priceCards}
    </div>

    <div class="compare-block">
      <div class="buying-section__head compare-block__head">
        <div>
          <p class="buying-kicker">Winner By Category</p>
        </div>
      </div>

      <div class="compare-winner-grid">
        ${winnerCards}
      </div>
    </div>

    <div class="compare-block">
      <div class="buying-section__head compare-block__head">
        <div>
          <p class="buying-kicker">Detailed Verdict</p>
        </div>
      </div>

      <div class="compare-verdict-grid">
        ${verdictHtml}
      </div>
    </div>

    <div class="compare-actions">
      ${actionButtons}
    </div>
  `;
}

function renderWorthItDecision(root) {
  const parentSection = root.closest(".buying-section");
  const kicker = parentSection ? $(".buying-kicker", parentSection) : null;

  if (kicker) kicker.textContent = "Current Price";

  const target = getTargetProduct();
    const targetLabel = getProductDisplayLabel(target);
    const targetPriceCents = target ? Number(target.price_cents || 0) : 0;

    const alternatives = Array.isArray(page.alternatives) ? page.alternatives : [];
    const priceRanges = Array.isArray(page.price_ranges) ? page.price_ranges : [];
    const buyIf = Array.isArray(page.buy_if) ? page.buy_if : [];
    const skipIf = Array.isArray(page.skip_if) ? page.skip_if : [];

    const priceRangeHtml = priceRanges.map(item => {
    const isCurrent = getWorthRangeState(item, targetPriceCents);

    return `
    <div class="worth-price-range-card${isCurrent ? " is-current" : ""}">
        <span>${esc(item.range || "")}</span>
        <strong>${esc(item.label || "")}</strong>
    </div>
    `;
    }).join("");

  const currentPriceHtml = target ? `
    <article class="worth-current-card">
        <a class="worth-current-card__image" href="${esc(target.dashboard_url)}">
        <img src="${esc(target.image_url)}" alt="${esc(target.title)}" loading="lazy" decoding="async">
        </a>

        <div class="worth-current-card__body">
        <p class="buying-card__label">${esc(target.label || target.title)}</p>
        <p class="worth-current-card__price">From ${esc(target.price)}</p>
        <p class="worth-current-card__seller">${esc(sellerText(target))}</p>
        <p class="worth-current-card__verdict">${esc(page.pricecheck_verdict || target.verdict || "")}</p>
        </div>

        <a class="buying-button" href="${esc(target.dashboard_url)}">View Full Page</a>
    </article>
    ` : "";

  const decisionHtml = `
  <div class="worth-decision-grid">
    <div class="worth-decision-card">
      <h3>${esc(page.buy_if_heading || `Buy ${targetLabel} If`)}</h3>
      <ul>
        ${buyIf.map(item => `<li>${esc(item)}</li>`).join("")}
      </ul>
    </div>

    <div class="worth-decision-card">
      <h3>${esc(page.skip_if_heading || `Skip ${targetLabel} If`)}</h3>
      <ul>
        ${skipIf.map(item => `<li>${esc(item)}</li>`).join("")}
      </ul>
    </div>
  </div>
`;

  const alternativesHtml = alternatives.map(item => {
    const product = picks.find(p => p.slot === item.product_slot);

    return `
      <article class="worth-alt-card">
        ${product ? `
          <a class="worth-alt-card__image" href="${esc(product.dashboard_url)}">
            <img src="${esc(product.image_url)}" alt="${esc(product.title)}" loading="lazy" decoding="async">
          </a>
        ` : ""}

        <div>
          <p class="worth-alt-card__label">${esc(item.label || "")}</p>
          <h3>${esc(product ? product.title : item.product_slot || "")}</h3>
          <p>${esc(item.body || "")}</p>
          ${product ? `<a href="${esc(product.dashboard_url)}">View Full Page</a>` : ""}
        </div>
      </article>
    `;
  }).join("");

  root.innerHTML = `
  <div class="worth-block">
    ${currentPriceHtml}
  </div>

  <div class="worth-block">
    <div class="buying-section__head compare-block__head">
      <div>
        <p class="buying-kicker">Good Price Range</p>
      </div>
    </div>

    <div class="worth-price-range-grid">
      ${priceRangeHtml}
    </div>
  </div>

  <div class="worth-block">
    ${decisionHtml}
  </div>

    <div class="worth-block">
      <div class="buying-section__head compare-block__head">
        <div>
          <p class="buying-kicker">Alternatives</p>
        </div>
      </div>

      <div class="worth-alt-grid">
        ${alternativesHtml}
      </div>
    </div>

    <div class="worth-final-card">
      <p class="buying-kicker">Final Verdict</p>
      <p>${esc(page.final_verdict || "")}</p>
    </div>
  `;
}

  function renderComparisonTable() {
    const table = $("#comparisonTable");

    if (!table) return;

    if (!picks.length || !comparisonRows.length) {
      table.innerHTML = "";
      return;
    }

    const head = `
      <thead>
        <tr>
          <th>Spec</th>
          ${picks.map(product => `<th>${esc(product.title)}</th>`).join("")}
        </tr>
      </thead>
    `;

    const body = `
      <tbody>
        ${comparisonRows.map(row => {
          return `
            <tr>
              <th>${esc(row.label)}</th>
              ${(row.values || []).map(value => `<td>${esc(value)}</td>`).join("")}
            </tr>
          `;
        }).join("")}
      </tbody>
    `;

    table.innerHTML = head + body;
  }

  function renderMethod() {
    const method = page.method || {};
    const heading = $("#methodHeading");
    const body = $("#methodBody");

    if (heading) heading.textContent = method.heading || "How PriceCheck Ranks Them";
    if (body) {
      body.textContent = method.body || "PriceCheck filters products by category and price, groups variants into the same product family, checks current store prices, and compares product specs.";
    }
  }

  function renderRelated() {
    const related = Array.isArray(page.related) ? page.related : [];
    const section = $("#relatedSection");
    const links = $("#relatedLinks");

    if (!section || !links) return;

    if (!related.length) {
      section.hidden = true;
      return;
    }

    section.hidden = false;

    links.innerHTML = related.map(item => {
      return `<a href="${esc(item.href || "#")}">${esc(item.label || "Related Page")}</a>`;
    }).join("");
  }

  function setupRevealAnimations() {
    const items = Array.from(document.querySelectorAll([
      ".buying-hero",
      ".quick-pick",
      ".buying-section",
      ".buying-card",
      ".brand-guide-card",
      ".buying-table-wrap",
      ".buying-method",
      ".buying-related:not([hidden])"
    ].join(",")));

    items.forEach(item => {
      item.classList.remove("buying-reveal");
      item.classList.add("is-visible");
      item.style.removeProperty("--buying-reveal-delay");
    });
  }

  function init() {
      renderHero();
      renderQuickAnswer();
      renderPickCards();
      renderComparisonTable();
      renderMethod();
      renderRelated();
      wireInfographicControls();
      setupRevealAnimations();
      wireBuyingProductEventTracking();
      trackBuyingPageView();
    }

  init();
})();