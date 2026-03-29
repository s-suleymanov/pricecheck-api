(() => {
  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function fmtPrice(cents) {
    if (typeof cents !== "number") return "";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD"
    }).format(cents / 100);
  }

  function renderShortlistPage(rootId = "shortlistPage") {
    const api = window.PriceCheckShortlist;
    const root = document.getElementById(rootId);
    if (!api || !root) return;

    const items = api.readItems();

    if (!items.length) {
      root.innerHTML = `
        <div class="shortlist-empty">
          Your shortlist is empty.
        </div>
        `;
        return;
        }

        root.innerHTML = `
        <div class="shortlist-page-grid">
            ${items.map((item) => `
            <div class="shortlist-item">
    <button
        type="button"
        class="shortlist-item__remove"
        data-shortlist-page-remove="${escapeHtml(item.key)}"
        aria-label="Remove from shortlist"
        title="Remove from shortlist"
    >
        ×
    </button>

    <a class="shortlist-item__link" href="${escapeHtml(item.href)}">
        <div class="shortlist-item__imgwrap">
        ${item.img
            ? `<img class="shortlist-item__img" src="${escapeHtml(item.img)}" alt="">`
            : `<div class="shortlist-item__img"></div>`
        }
        </div>

        <div class="shortlist-item__meta">
        <div class="shortlist-item__brand">${escapeHtml(item.brand)}</div>
        <div class="shortlist-item__title">${escapeHtml(item.title)}</div>
        <div class="shortlist-item__price">${escapeHtml(fmtPrice(item.priceCents))}</div>
        </div>
    </a>
    </div>
        `).join("")}
      </div>
    `;
  }

  window.PriceCheckShortlistPage = {
    render: renderShortlistPage
  };
})();