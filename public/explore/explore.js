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

  function renderCards(target, items, fallbackText) {
    if (!target) return;

    const safeItems = cleanItems(items);

    if (!safeItems.length) {
      target.innerHTML = `<div class="pc-explore-empty">${esc(fallbackText)}</div>`;
      return;
    }

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

      renderCards(els.bestLists, bestLists, "No best lists yet.");
      renderCards(els.worthIt, data.worth_it, "No worth-it checks yet.");
      renderCards(els.comparisons, data.comparisons, "No comparisons yet.");
    } catch (err) {
      console.error(err);

      renderCards(els.bestLists, [], "Best lists could not load.");
      renderCards(els.worthIt, [], "Worth-it checks could not load.");
      renderCards(els.comparisons, [], "Comparisons could not load.");
    }
  }

  loadExplore();
})();