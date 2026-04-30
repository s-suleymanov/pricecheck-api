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

  function sellerText(product) {
    const seller = product.best_seller;

    if (!seller || !seller.store) return "Best seller unavailable";

    const rating = seller.rating ? ` · ${seller.rating}★` : "";
    const reviews = seller.review_count ? ` · ${Number(seller.review_count).toLocaleString()} Reviews` : "";

    return `Best seller: ${seller.store}${rating}${reviews}`;
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

  if (isComparison && Array.isArray(page.quick_answer) && page.quick_answer.length) {
    root.classList.add("buying-quick__grid--compare");
    root.classList.remove("buying-quick__grid--worth");

    root.innerHTML = page.quick_answer.map(item => {
      return `
        <div class="quick-pick quick-pick--compare">
          <span>${esc(item.label || "")}</span>
          <small>${esc(item.body || "")}</small>
        </div>
      `;
    }).join("");

    return;
  }

  root.classList.remove("buying-quick__grid--compare");
  root.classList.remove("buying-quick__grid--worth");

  root.innerHTML = picks.map(product => {
    return `
      <a class="quick-pick" href="#${esc(product.slot || "")}">
        <span>${esc(product.label)}</span>
        <strong>${esc(product.title)}</strong>
        <small>${esc(product.price)}</small>
      </a>
    `;
  }).join("");
}

  function renderPickCards() {
  const root = $("#topPicks");

  if (!root) return;

  const pageType = String(page.type || "").toLowerCase();
    const isComparison = pageType === "comparison";
    const isWorthIt = pageType === "worth_it";

    if (isWorthIt) {
    renderWorthItDecision(root);
    return;
    }

    if (isComparison) {
    renderComparisonDecision(root);
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
            <span class="buying-pill">${esc(product.store_count)} Stores</span>
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
    ".buying-table-wrap",
    ".buying-method",
    ".buying-related:not([hidden])"
  ].join(",")));

  if (!items.length) return;

  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    items.forEach(item => item.classList.add("is-visible"));
    return;
  }

  items.forEach((item, index) => {
    item.classList.add("buying-reveal");
    item.style.setProperty("--buying-reveal-delay", `${Math.min(index * 45, 220)}ms`);
  });

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;

      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, {
    threshold: 0.12,
    rootMargin: "0px 0px -60px 0px"
  });

  items.forEach(item => observer.observe(item));
}

  function init() {
    wireBuyingProductEventTracking();
    renderHero();
    renderQuickAnswer();
    renderPickCards();
    renderComparisonTable();
    renderMethod();
    renderRelated();
    setupRevealAnimations();
    trackBuyingPageView();
    }

  init();
})();