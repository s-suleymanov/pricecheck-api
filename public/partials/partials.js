// public/partials/partials.js
(async () => {
  async function loadPartial(mountId, url) {
    const mount = document.getElementById(mountId);
    if (!mount) return false;

    try {
      const res = await fetch(url, { cache: "default" });
      if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
      mount.innerHTML = await res.text();
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  }

  function normalizePath(p) {
    if (!p) return "/";
    return p.endsWith("/") ? p : p + "/";
  }

  function setActiveNavStrict() {
    const nav = document.querySelector("header.nav nav.links");
    if (!nav) return;

    const links = Array.from(nav.querySelectorAll("a[href]"));
    links.forEach(a => a.classList.remove("active"));

    const path = normalizePath(window.location.pathname);

    const allowedRoots = [
      "/",
      "/privacy-policy/",
      "/dashboard/",
      "/research/",
      "/insights/",
    ];

    let root = null;

    if (path === "/") {
      root = "/";
    } else {
      for (const r of allowedRoots) {
        if (r !== "/" && path.startsWith(r)) {
          root = r;
          break;
        }
      }
    }

    if (!root) return;

    const match = links.find(a => normalizePath(a.getAttribute("href")) === root);
    if (match) match.classList.add("active");
  }

  function wireMobileMenu() {
    const btn = document.getElementById("pcBurgerBtn");
    const menu = document.getElementById("pcMobileMenu");
    if (!btn || !menu) return;

    const open = () => {
      menu.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      btn.setAttribute("aria-label", "Close menu");
    };

    const close = () => {
      menu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      btn.setAttribute("aria-label", "Open menu");
    };

    btn.addEventListener("click", () => {
      const expanded = btn.getAttribute("aria-expanded") === "true";
      expanded ? close() : open();
    });

    document.addEventListener("keydown", e => {
      if (e.key === "Escape") close();
    });

    menu.addEventListener("click", e => {
      if (e.target.closest("a")) close();
    });

    const mq = window.matchMedia("(min-width: 901px)");
    mq.addEventListener?.("change", () => close());
  }

  // Load both partials
  const headerOk = await loadPartial("site-header", "/partials/header.html");
  const footerOk = await loadPartial("site-footer", "/partials/footer.html");

  // Only run header-dependent logic if header loaded
  if (headerOk) {
    setActiveNavStrict();
    wireMobileMenu();
  }

  // footerOk is just for debugging if needed
  if (!footerOk) {
    // optional: console.warn("Footer did not load");
  }
})();