(function () {
  const $ = (s, ctx = document) => ctx.querySelector(s);

  const els = {
    bestLists: $("#pcExploreRankings"),
    worthIt: $("#pcExploreGuides"),
    comparisons: $("#pcExploreComparisons")
  };

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

  function renderCards(target, items) {
    if (!target) return;

    const safeItems = cleanItems(items);
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
    try {
      const res = await fetch("/api/explore", {
        headers: { "Accept": "application/json" }
      });

      if (!res.ok) throw new Error(`Explore request failed: ${res.status}`);

      const data = await res.json();

      const bestLists = [
        ...cleanItems(data.rankings),
        ...cleanItems(data.guides)
      ];

      renderCards(els.bestLists, bestLists);
      renderCards(els.worthIt, data.worth_it);
      renderCards(els.comparisons, data.comparisons);
    } catch (err) {
      console.warn("Explore API unavailable. Keeping static Explore links.", err);
    }
  }

  loadExplore();
})();