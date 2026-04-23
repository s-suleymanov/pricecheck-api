(() => {
  const STORAGE_KEY = "pc_shortlist_v1";
  const OPEN_KEY = "pc_shortlist_open_v1";
  const LIMIT = 24;

  const SHORTLIST_REMOVE_SVG = `
    <svg viewBox="0 -960 960 960" aria-hidden="true" focusable="false">
      <path d="M256-200 200-256l224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"></path>
    </svg>
  `;

  const SHORTLIST_COMPARE_SVG = `
    <svg viewBox="0 -960 960 960" aria-hidden="true" focusable="false">
      <path d="m320-160-56-57 103-103H80v-80h287L264-503l56-57 200 200-200 200Zm320-240L440-600l200-200 56 57-103 103h287v80H593l103 103-56 57Z"></path>
    </svg>
  `;

  function cleanText(v, max = 500) {
    return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function safeHref(raw, { sameOrigin = false } = {}) {
    const s = String(raw ?? "").trim();
    if (!s) return "";

    try {
      const u = new URL(s, location.origin);

      if (u.protocol !== "http:" && u.protocol !== "https:") return "";

      if (sameOrigin) {
        if (u.origin !== location.origin) return "";
        return `${u.pathname}${u.search}${u.hash}`;
      }

      return u.href;
    } catch (_e) {
      return "";
    }
  }

  function normalizeItem(raw) {
    const item = {
      key: cleanText(raw?.key, 120),
      href: safeHref(raw?.href, { sameOrigin: true }),
      title: cleanText(raw?.title, 200),
      brand: cleanText(raw?.brand, 120),
      img: cleanText(raw?.img, 600),
      priceCents: Number.isFinite(raw?.priceCents) ? raw.priceCents : null,
      savedAt: Number(raw?.savedAt) || Date.now(),
      source: cleanText(raw?.source, 40) || "unknown"
    };

    if (!item.key || !item.href) return null;
    return item;
  }

  function readItems() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const arr = JSON.parse(raw || "[]");
      if (!Array.isArray(arr)) return [];

      return arr
        .map(normalizeItem)
        .filter(Boolean)
        .slice(0, LIMIT);
    } catch (_e) {
      return [];
    }
  }

  function writeItems(items) {
    const next = (Array.isArray(items) ? items : [])
      .map(normalizeItem)
      .filter(Boolean)
      .slice(0, LIMIT);

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (_e) {}

    return next;
  }

  function has(key) {
    const want = cleanText(key, 120).toLowerCase();
    if (!want) return false;
    return readItems().some((item) => item.key.toLowerCase() === want);
  }

  function add(rawItem) {
    const item = normalizeItem(rawItem);
    if (!item) return readItems();

    const cur = readItems().filter((x) => x.key.toLowerCase() !== item.key.toLowerCase());
    cur.push(item);
    return writeItems(cur);
  }

  function remove(key) {
    const want = cleanText(key, 120).toLowerCase();
    if (!want) return readItems();

    const cur = readItems().filter((item) => item.key.toLowerCase() !== want);
    return writeItems(cur);
  }

  function toggle(rawItem) {
    const item = normalizeItem(rawItem);
    if (!item) return readItems();

    if (has(item.key)) return remove(item.key);
    return add(item);
  }

  function clear() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_e) {}
    return [];
  }

  function readOpen() {
    try {
      return localStorage.getItem(OPEN_KEY) === "1";
    } catch (_e) {
      return false;
    }
  }

  function writeOpen(open) {
    try {
      localStorage.setItem(OPEN_KEY, open ? "1" : "0");
    } catch (_e) {}
    return !!open;
  }

  function subscribe(fn) {
    if (typeof fn !== "function") return () => {};

    const handler = (e) => {
      if (e.key && e.key !== STORAGE_KEY && e.key !== OPEN_KEY) return;
      fn({
        items: readItems(),
        open: readOpen()
      });
    };

    window.addEventListener("storage", handler);

    return () => {
      window.removeEventListener("storage", handler);
    };
  }

  function emitChange() {
    window.dispatchEvent(new CustomEvent("pc:shortlist_changed", {
      detail: {
        items: readItems(),
        open: readOpen()
      }
    }));
  }

  function setOpen(open) {
    const next = writeOpen(open);
    emitChange();
    return next;
  }

  function toggleOpen() {
    const next = !readOpen();
    writeOpen(next);
    emitChange();
    return next;
  }

  function addAndEmit(item) {
    const next = add(item);
    emitChange();
    return next;
  }

  function removeAndEmit(key) {
    const next = remove(key);
    emitChange();
    return next;
  }

  function toggleAndEmit(item) {
    const next = toggle(item);
    emitChange();
    return next;
  }

  function clearAndEmit() {
    const next = clear();
    emitChange();
    return next;
  }

  function renderRail({
    railId = "shortlistRail",
    miniId = "shortlistMini",
    shortlistHref = "/shortlist/",
    bodyClass = "has-shortlist"
  } = {}) {
    const rail = document.getElementById(railId);
    const mini = document.getElementById(miniId);
    if (!rail || !mini) return;

    const items = readItems();

    if (!items.length) {
      rail.hidden = true;
      document.body.classList.remove(bodyClass);
      mini.innerHTML = "";
      return;
    }

    rail.hidden = false;
    document.body.classList.add(bodyClass);

    mini.innerHTML = `
      ${items.map((item) => `
        <div class="shortlist-mini-item" title="${escapeHtml(item.title || item.brand || "Saved product")}">
          <a
            class="shortlist-mini-link"
            href="${escapeHtml(item.href)}"
            aria-label="${escapeHtml(item.title || item.brand || "Saved product")}"
          >
            ${item.img
              ? `<img class="shortlist-mini-img" src="${escapeHtml(item.img)}" alt="">`
              : `<div class="shortlist-mini-img"></div>`
            }
          </a>

          <button
            type="button"
            class="shortlist-mini-remove"
            data-shortlist-remove="${escapeHtml(item.key)}"
            aria-label="Remove from shortlist"
            title="Remove from shortlist"
          >
            ${SHORTLIST_REMOVE_SVG}
          </button>
        </div>
      `).join("")}

      ${items.length >= 2 ? `
        <div class="shortlist-mini-item shortlist-mini-item--launch">
          <a
            class="shortlist-mini-link shortlist-mini-link--launch"
            href="${escapeHtml(shortlistHref)}"
            aria-label="Open shortlist comparison"
            title="Open shortlist comparison"
          >
            <span class="shortlist-mini-launch-icon">${SHORTLIST_COMPARE_SVG}</span>
          </a>
        </div>
      ` : ""}
    `;
  }

  function bindRailEvents({
    bodyFlag = "pcShortlistRailBound"
  } = {}) {
    if (document.body.dataset[bodyFlag] === "1") return;
    document.body.dataset[bodyFlag] = "1";

    document.body.addEventListener("click", (e) => {
      const removeBtn = e.target.closest("[data-shortlist-remove]");
      if (!removeBtn) return;

      e.preventDefault();
      e.stopPropagation();

      const key = String(removeBtn.getAttribute("data-shortlist-remove") || "").trim();
      if (!key) return;

      removeAndEmit(key);
    });
  }

  function mountRail(options = {}) {
    bindRailEvents({
      bodyFlag: options.bodyFlag || "pcShortlistRailBound"
    });

    renderRail(options);

    const listener = () => {
      renderRail(options);
    };

    window.addEventListener("pc:shortlist_changed", listener);

    return () => {
      window.removeEventListener("pc:shortlist_changed", listener);
    };
  }

  window.PriceCheckShortlist = {
    safeHref,
    normalizeItem,
    readItems,
    writeItems,
    has,
    add: addAndEmit,
    remove: removeAndEmit,
    toggle: toggleAndEmit,
    clear: clearAndEmit,
    readOpen,
    setOpen,
    toggleOpen,
    subscribe,
    renderRail,
    mountRail
  };
})();