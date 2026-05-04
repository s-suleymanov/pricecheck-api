(function () {
  const $ = (s, ctx = document) => ctx.querySelector(s);

  const els = {
    rankings: $("#pcExploreRankings"),
    bestLists: $("#pcExploreBestLists"),
    brandGuides: $("#pcExploreBrandGuides"),
    worthIt: $("#pcExploreGuides"),
    comparisons: $("#pcExploreComparisons")
  };

  const STATIC_RANKINGS = [
    {
      title: "Earbuds",
      href: "/rankings/earbuds/"
    }
  ];

  const STATIC_BEST_LISTS = [
    {
      title: "Best Earbuds For Work Under $100",
      href: "/guides/earbuds/best-earbuds-for-work-under-100/"
    },
    {
      title: "Best First Earbuds To Buy",
      href: "/guides/earbuds/best-first-earbuds-to-buy/"
    },
    {
      title: "Best Earbuds Under $100",
      href: "/guides/earbuds/best-under-100/"
    }
  ];

  const STATIC_BRAND_GUIDES = [
    {
      title: "Which Soundcore Earbuds Should You Buy?",
      href: "/guides/earbuds/which-soundcore-earbuds-should-you-buy/"
    }
  ];

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function cleanItems(items) {
    return Array.isArray(items)
      ? items.filter(item => item && item.title && item.href)
      : [];
  }

  function dedupeItems(items) {
    const seen = new Set();

    return cleanItems(items).filter(item => {
      const key = String(item.href || "").trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function normalizeRankingTitle(item) {
    const href = String(item.href || "").toLowerCase();

    if (href === "/rankings/earbuds/" || href.includes("/rankings/earbuds/")) {
      return {
        ...item,
        title: "Earbuds"
      };
    }

    return item;
  }

  function isSoundcoreGuide(item) {
    return String(item.href || "").includes("/which-soundcore-earbuds-should-you-buy/");
  }

  function isWorkGuide(item) {
    return String(item.href || "").includes("/best-earbuds-for-work-under-100/");
  }

  function isStaticBestList(item) {
    const href = String(item.href || "").toLowerCase();

    return STATIC_BEST_LISTS.some(staticItem => {
      return String(staticItem.href || "").toLowerCase() === href;
    });
  }

  function renderCards(target, items) {
    if (!target) return;

    const safeItems = dedupeItems(items);
    if (!safeItems.length) return;

    target.innerHTML = safeItems.map(item => {
      return `
        <a class="pc-explore-card" href="${esc(item.href)}">
          <strong>${esc(item.title)}</strong>
        </a>
      `;
    }).join("");
  }

  async function loadExplore() {
    renderCards(els.rankings, STATIC_RANKINGS);
    renderCards(els.bestLists, STATIC_BEST_LISTS);
    renderCards(els.brandGuides, STATIC_BRAND_GUIDES);

    try {
      const res = await fetch("/api/explore", {
        headers: { "Accept": "application/json" }
      });

      if (!res.ok) throw new Error(`Explore request failed: ${res.status}`);

      const data = await res.json();

      const rankings = [
        ...STATIC_RANKINGS,
        ...cleanItems(data.rankings).map(normalizeRankingTitle)
      ];

      const bestLists = [
        ...STATIC_BEST_LISTS,
        ...cleanItems(data.guides).filter(item => {
          return !isSoundcoreGuide(item) && !isStaticBestList(item);
        })
      ];

      const brandGuides = [
        ...STATIC_BRAND_GUIDES,
        ...cleanItems(data.brand_guides),
        ...cleanItems(data.guides).filter(isSoundcoreGuide)
      ];

      renderCards(els.rankings, rankings);
      renderCards(els.bestLists, bestLists);
      renderCards(els.brandGuides, brandGuides);
      renderCards(els.worthIt, data.worth_it);
      renderCards(els.comparisons, data.comparisons);
    } catch (err) {
      console.warn("Explore API unavailable. Keeping static Explore links.", err);
    }
  }

  loadExplore();
})();