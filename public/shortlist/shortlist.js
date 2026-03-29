(() => {
  const STORAGE_KEY = "pc_shortlist_v1";
  const OPEN_KEY = "pc_shortlist_open_v1";
  const LIMIT = 24;

  function cleanText(v, max = 500) {
    return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
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
    subscribe
  };
})();