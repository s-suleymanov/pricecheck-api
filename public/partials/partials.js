(async () => {
  let _pcPlusToastTimer = 0;

  let pcAuthUser = null;

  const AUTH_STORAGE_KEY = "pc_auth_user";
  const WELCOME_PLUS_FLAG = "pc_welcome_plus_reward";

  // ─── Sellers map cache (shared with sidebar) ───────────────────────────────
  let _sellersMapCache   = null;
  let _sellersMapPromise = null;

  async function getSharedSellersMap() {
    if (_sellersMapCache) return _sellersMapCache;
    if (_sellersMapPromise) return _sellersMapPromise;

    _sellersMapPromise = fetch("/data/sellers.json", {
      headers: { Accept: "application/json" }
    })
      .then(r => (r.ok ? r.json() : {}))
      .then(data => {
        _sellersMapCache = (data && typeof data === "object") ? data : {};
        return _sellersMapCache;
      })
      .catch(() => {
        _sellersMapCache = {};
        return {};
      });

    return _sellersMapPromise;
  }

  function logoFromSellers(key, sellers) {
    const k = String(key || "").trim().toLowerCase();
    if (!k || !sellers) return "";
    const entry = sellers[k];
    if (!entry) return "";
    return String(
      entry.logo || entry.logo_url || entry.logoUrl ||
      entry.image_url || entry.imageUrl || ""
    ).trim();
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────
  function clean(v) {
    return String(v || "").trim();
  }

  function hasPlus(user) {
    return clean(user?.plan_tier).toLowerCase() === "plus";
  }

  function sidebarEsc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function sidebarTitleCase(s) {
    const v = String(s || "").trim();
    if (!v) return "";
    // Keep short all-caps tokens (e.g. "LG", "HP", "Sony" → let it pass)
    if (v.toUpperCase() === v && v.length <= 5) return v;
    return v
      .toLowerCase()
      .split(/\s+/g)
      .map(w => (w ? w[0].toUpperCase() + w.slice(1) : ""))
      .join(" ");
  }

  function getStoredAuthUser() {
    try {
      const raw = localStorage.getItem(AUTH_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      if (!parsed.email) return null;
      return parsed;
    } catch (_e) {
      return null;
    }
  }

  function setStoredAuthUser(user) {
    try {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user || {}));
    } catch (_e) {}
  }

  function clearStoredAuthUser() {
    try {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    } catch (_e) {}
  }

  function renderBrandForUser(user) {
    const wordmark = document.querySelector('[data-pc-wordmark="1"]');
    const edition  = document.querySelector('[data-pc-edition="1"]');
    if (!wordmark || !edition) return;

    if (hasPlus(user)) {
      wordmark.textContent = "PriceCheck+";
      return;
    }
    wordmark.textContent = "PriceCheck";
    edition.textContent  = "Beta";
  }

  function renderAccountTrigger(user) {
    const trigger   = document.querySelector('[data-account-menu-toggle="1"]');
    if (!trigger) return;

    const img      = document.getElementById("pcAccountTriggerImg");
    const fallback = document.getElementById("pcAccountTriggerFallback");
    if (!img || !fallback) return;

    const src = clean(user?.profile_image_url);
    if (src) {
      img.src    = src;
      img.hidden = false;
      fallback.hidden = true;
      return;
    }

    img.removeAttribute("src");
    img.hidden      = true;
    fallback.hidden = false;
    fallback.textContent = "S";
  }

  // ─── Welcome Plus modal ────────────────────────────────────────────────────
  function ensureWelcomePlusStyles() {
    if (document.getElementById("pcWelcomePlusStyles")) return;
    const style = document.createElement("style");
    style.id = "pcWelcomePlusStyles";
    style.textContent = `
      .pc-welcome-plus{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(15,23,42,.34);}
      .pc-welcome-plus__card{width:min(100%,560px);background:#ffffff;border:1px solid #e2e8f0;border-radius:24px;box-shadow:0 30px 80px rgba(15,23,42,.22);padding:28px;}
      .pc-welcome-plus__eyebrow{margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#14b8a6;}
      .pc-welcome-plus__title{margin:0 0 10px;font-size:34px;line-height:1.05;font-weight:800;color:#0f172a;}
      .pc-welcome-plus__body{margin:0;font-size:16px;line-height:1.7;color:#475569;}
      .pc-welcome-plus__actions{margin-top:22px;display:flex;justify-content:flex-end;}
      .pc-welcome-plus__btn{border:0;border-radius:999px;padding:12px 18px;background:#0f172a;color:#ffffff;font:inherit;font-weight:700;cursor:pointer;}
    `;
    document.head.appendChild(style);
  }

  function ensureWelcomePlusModal() {
    let modal = document.getElementById("pcWelcomePlusModal");
    if (modal) return modal;

    ensureWelcomePlusStyles();

    modal = document.createElement("div");
    modal.id        = "pcWelcomePlusModal";
    modal.className = "pc-welcome-plus";
    modal.hidden    = true;
    modal.innerHTML = `
      <div class="pc-welcome-plus__card" role="dialog" aria-modal="true" aria-labelledby="pcWelcomePlusTitle">
        <p class="pc-welcome-plus__eyebrow">Welcome</p>
        <h2 id="pcWelcomePlusTitle" class="pc-welcome-plus__title">Congratulations!</h2>
        <p class="pc-welcome-plus__body">
          You are one of the early PriceCheck users, so you just unlocked free PriceCheck+.
          Enjoy it on us.
        </p>
        <div class="pc-welcome-plus__actions">
          <button type="button" class="pc-welcome-plus__btn" data-pc-welcome-close="1">Awesome</button>
        </div>
      </div>
    `;

    modal.addEventListener("click", e => { if (e.target === modal) modal.hidden = true; });
    modal.addEventListener("click", e => {
      if (e.target.closest('[data-pc-welcome-close="1"]')) modal.hidden = true;
    });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && !modal.hidden) modal.hidden = true;
    });

    document.body.appendChild(modal);
    return modal;
  }

  function maybeShowWelcomePlusReward() {
    if (!pcAuthUser || !hasPlus(pcAuthUser)) return;

    let shouldShow = false;
    try { shouldShow = sessionStorage.getItem(WELCOME_PLUS_FLAG) === "1"; } catch (_e) {}
    if (!shouldShow) return;

    try { sessionStorage.removeItem(WELCOME_PLUS_FLAG); } catch (_e) {}

    ensureWelcomePlusModal().hidden = false;
  }

  // ─── Core auth UI ─────────────────────────────────────────────────────────
  function applyAuthUi(user) {
    pcAuthUser = user && user.email ? user : null;
    const signedIn = !!pcAuthUser;

    document.querySelectorAll('[data-auth-signedout-only="1"]').forEach(el => {
      el.hidden = signedIn;
      el.style.display = signedIn ? "none" : "";
      signedIn ? el.setAttribute("aria-hidden", "true") : el.removeAttribute("aria-hidden");
    });

    document.querySelectorAll('[data-auth-signedin-only="1"]').forEach(el => {
      el.hidden = !signedIn;
      el.style.display = signedIn ? "" : "none";
      !signedIn ? el.setAttribute("aria-hidden", "true") : el.removeAttribute("aria-hidden");
    });

    if (signedIn) setStoredAuthUser(pcAuthUser);
    else          clearStoredAuthUser();

    renderAccountTrigger(pcAuthUser);
    renderBrandForUser(pcAuthUser);

    const isAuthPage   = clean(document.body?.getAttribute("data-auth-page")) === "1";
    const authPageShell = document.getElementById("pcAuthPageShell");
    if (isAuthPage && authPageShell) {
      authPageShell.hidden = !signedIn;
      authPageShell.setAttribute("aria-hidden", signedIn ? "false" : "true");
    }

    if (!signedIn) {
      const menu    = document.getElementById("pcAccountMenu");
      const trigger = document.querySelector('[data-account-menu-toggle="1"]');
      if (menu)    menu.hidden = true;
      if (trigger) trigger.setAttribute("aria-expanded", "false");
    }

    maybeShowWelcomePlusReward();

    window.dispatchEvent(new CustomEvent("pc:auth_changed", {
      detail: { signedIn, user: pcAuthUser }
    }));
  }

  async function syncAuthUi() {
    try {
      const res  = await fetch("/api/auth/me", {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.ok !== true) return pcAuthUser;

      const user = data.user && data.user.email ? data.user : null;
      applyAuthUi(user);
      return user;
    } catch (_e) {
      return pcAuthUser;
    }
  }

  window.pcAuthSignOut = async function pcAuthSignOut(options = {}) {
    const reload = options.reload !== false;
    applyAuthUi(null);

    try {
      await fetch("/api/auth/signout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" }
      });
    } catch (_e) {}

    if (reload) window.location.reload();
  };

  // ─── Plus toast ───────────────────────────────────────────────────────────
  function getPlusToastEl() {
    let el = document.getElementById("pcPlusToast");
    if (el) return el;
    el = document.createElement("div");
    el.id        = "pcPlusToast";
    el.className = "pc-plus-toast";
    el.hidden    = true;
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
    return el;
  }

  function showPlusToast(msg = "A PriceCheck+ Elite feature") {
    try {
      const el = getPlusToastEl();
      el.textContent = String(msg || "A PriceCheck+ Elite feature");
      el.hidden = false;
      el.classList.remove("is-show");
      void el.offsetHeight;
      el.classList.add("is-show");

      if (_pcPlusToastTimer) clearTimeout(_pcPlusToastTimer);
      _pcPlusToastTimer = window.setTimeout(() => {
        el.classList.remove("is-show");
        _pcPlusToastTimer = window.setTimeout(() => {
          el.hidden      = true;
          el.textContent = "";
        }, 250);
      }, 5000);
    } catch (_e) {}
  }

  function handlePlusGateClick(e, explicitEl = null) {
    const trigger =
      explicitEl ||
      e?.currentTarget ||
      (e?.target?.closest ? e.target.closest('[data-pc-plus="1"]') : null);

    if (e) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
    }

    const signedIn = !!(pcAuthUser && pcAuthUser.email);

    if (!signedIn) {
      try { window.pcCloseAccountMenu?.(); } catch (_e) {}
      window.pcOpenSignIn?.();
      return;
    }

    const toastOnly =
      clean(trigger?.getAttribute("data-pc-plus-toast-only")) === "1";

    showPlusToast(
      toastOnly
        ? "A PriceCheck+ Elite feature"
        : "A PriceCheck+ Elite feature"
    );
  }

  function wirePlusClicks() {
    if (document.body?._pcPlusClicksBound) return;
    if (document.body) document.body._pcPlusClicksBound = true;

    document.querySelectorAll('[data-pc-plus="1"]').forEach(el => {
      if (el._pcPlusBound) return;
      el._pcPlusBound = true;
      el.addEventListener("click", e => handlePlusGateClick(e, el));
    });
  }

  // ─── Account menu ─────────────────────────────────────────────────────────
  function wireAccountMenu() {
    const trigger = document.querySelector('[data-account-menu-toggle="1"]');
    const menu    = document.getElementById("pcAccountMenu");
    if (!trigger || !menu || menu._pcAccountMenuBound) return;
    menu._pcAccountMenuBound = true;

    const isOpen    = ()    => !menu.hidden;
    const openMenu  = ()    => { menu.hidden = false; trigger.setAttribute("aria-expanded", "true"); };
    const closeMenu = ()    => { menu.hidden = true;  trigger.setAttribute("aria-expanded", "false"); };
    const toggle    = ()    => isOpen() ? closeMenu() : openMenu();

    trigger.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); toggle(); });
    document.addEventListener("click", e => {
      if (menu.hidden || menu.contains(e.target) || trigger.contains(e.target)) return;
      closeMenu();
    });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && isOpen()) { e.preventDefault(); closeMenu(); }
    });
    menu.addEventListener("click", e => {
      if (!e.target.closest('[data-account-signout="1"]')) return;
      e.preventDefault();
      closeMenu();
      window.pcAuthSignOut();
    });

    window.pcCloseAccountMenu = closeMenu;
  }

  // ─── Sign-in modal ────────────────────────────────────────────────────────
  function wireSignIn() {
    const modal = document.getElementById("pcSignInModal");
    if (!modal || modal._pcSignInBound) return;
    modal._pcSignInBound = true;

    const form       = document.getElementById("pcQuickSignInForm");
    const status     = document.getElementById("pcSignInStatus");
    const firstInput = document.getElementById("pcSignInEmail");

    const openers = Array.from(document.querySelectorAll('[data-signin-open="1"]'));
    const closers = Array.from(document.querySelectorAll('[data-signin-close="1"]'));

    let lastActive = null;

    function setStatus(msg = "") {
      if (!status) return;
      const text = clean(msg);
      status.textContent = text;
      status.hidden      = !text;
    }

    function openSignIn() {
      lastActive = document.activeElement;
      modal.hidden = false;
      document.body.classList.add("pc-signin-open");
      setStatus("");
      requestAnimationFrame(() => { try { firstInput?.focus(); } catch (_e) {} });
    }

    function closeSignIn() {
      modal.hidden = true;
      document.body.classList.remove("pc-signin-open");
      setStatus("");
      if (form) form.reset();
      try { lastActive?.focus?.(); } catch (_e) {}
    }

    window.pcOpenSignIn  = openSignIn;
    window.pcCloseSignIn = closeSignIn;

    openers.forEach(el => {
      if (el._pcSignInOpenBound) return;
      el._pcSignInOpenBound = true;
      el.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); openSignIn(); });
    });

    closers.forEach(el => {
      if (el._pcSignInCloseBound) return;
      el._pcSignInCloseBound = true;
      el.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); closeSignIn(); });
    });

    modal.addEventListener("click", e => { if (e.target === modal) closeSignIn(); });
    document.addEventListener("keydown", e => {
      if (!modal.hidden && e.key === "Escape") { e.preventDefault(); closeSignIn(); }
    });

    if (form && !form._pcSignInSubmitBound) {
      form._pcSignInSubmitBound = true;
      const submitBtn = form.querySelector('button[type="submit"]');

      function setBusy(busy) {
        if (!submitBtn) return;
        submitBtn.disabled    = !!busy;
        submitBtn.textContent = busy ? "Signing In..." : "Continue";
      }

      form.addEventListener("submit", async e => {
        e.preventDefault();
        const email    = clean(form.email?.value);
        const password = String(form.password?.value || "");
        if (!email || !password) { setStatus("Enter your email and password."); return; }

        setStatus("");
        setBusy(true);

        try {
          const res  = await fetch("/api/auth/signin", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
          });
          const data = await res.json().catch(() => ({}));

          if (!res.ok || !data.ok) {
            setStatus(data.error || "Unable to sign in right now.");
            setBusy(false);
            return;
          }

          applyAuthUi(data.user?.email ? data.user : null);
          closeSignIn();
          syncAuthUi();
        } catch (_err) {
          setStatus("Unable to sign in right now.");
        } finally {
          setBusy(false);
        }
      });
    }
  }

  // ─── Header search ────────────────────────────────────────────────────────
  function wireHeaderSearch() {
    const form  = document.querySelector("header.nav form.nav-search");
    const input = document.querySelector("header.nav input.nav-search__input");
    const logo  = document.querySelector("header.nav a.logo-head");

    if (logo) {
      logo.addEventListener("click", e => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;
        try { sessionStorage.setItem("pc_clear_search_once", "1"); } catch (_e) {}
      });
    }

    if (!form || !input || form._pcHeaderSearchBound) return;
    form._pcHeaderSearchBound = true;

    function browseValueFromUrl() {
      const sp       = new URLSearchParams(location.search);
      const brand    = clean(sp.get("brand"));
      const category = clean(sp.get("category"));
      if (brand)    return brand;
      if (category) return category;

      const parts = clean(location.pathname).split("/").filter(Boolean);
      if (parts[0] !== "browse") return "";

      if (parts[1] === "category") {
        let cat = parts[2] || "";
        try { cat = decodeURIComponent(cat); } catch (_e) {}
        return clean(cat);
      }

      if (parts.length >= 2) {
        let first = parts[1] || "";
        try { first = decodeURIComponent(first); } catch (_e) {}
        const next = String(parts[2] || "").toLowerCase();
        if (next === "category" || next === "family" || next === "page")
          return clean(first);
        return clean(first).replace(/-/g, " ");
      }
      return "";
    }

    const p        = (location.pathname || "/").toLowerCase();
    const onBrowse = p === "/browse" || p === "/browse/" || p.startsWith("/browse/");

    if (onBrowse) {
      const v  = browseValueFromUrl();
      const vv = v.toLowerCase();
      input.value = vv;
      try {
        vv
          ? sessionStorage.setItem("pc_browse_search_value", vv)
          : sessionStorage.removeItem("pc_browse_search_value");
      } catch (_e) {}
      try { input.setSelectionRange(input.value.length, input.value.length); } catch (_e) {}
    } else {
      input.value = "";
      try { input.setSelectionRange(0, 0); } catch (_e) {}
    }

    if (!window.pcSearch) {
      console.warn("pcSearch missing. Include /search.js before /partials/partials.js");
      return;
    }

    window.pcSearch.bindForm(form, input);
    window.pcSearch.attachAutocomplete(input, { endpoint: "/api/suggest", limit: 8 });
    window.pcSearch.restoreInputValue?.(input, { force: false });
  }

  // ─── Browse tabs ──────────────────────────────────────────────────────────
  function wireBrowseTabs() {
    const tabsBar = document.getElementById("pcBrowseTabs");
    if (!tabsBar) return;

    const p         = String(location.pathname || "/").toLowerCase();
    const shouldShow = p === "/browse" || p === "/browse/" || p.startsWith("/browse/");
    document.body.classList.toggle("has-pc-tabs", shouldShow);
    tabsBar.hidden = !shouldShow;
    if (!shouldShow) return;

    const header = document.querySelector("header.nav");

    function setNavHeightVar() {
      if (!header) return;
      document.documentElement.style.setProperty(
        "--pc-nav-h",
        `${Math.round(header.getBoundingClientRect().height)}px`
      );
    }
    setNavHeightVar();

    if (!tabsBar._pcNavHeightBound) {
      tabsBar._pcNavHeightBound = true;
      let raf = 0;
      window.addEventListener("resize", () => {
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(setNavHeightVar);
      }, { passive: true });
    }

    const countEl = tabsBar.querySelector("#pcTabsCount");

    function setTabsResultsCount(total, { show = true } = {}) {
      if (!countEl) return;
      const onBrowse2 = String(location.pathname || "/").toLowerCase().startsWith("/browse/");
      if (!onBrowse2 || !show || !Number.isFinite(total)) {
        countEl.hidden = true; countEl.textContent = ""; return;
      }
      const n = Math.max(0, total | 0);
      countEl.textContent = n === 1 ? "1 result found" : `${n} results found`;
      countEl.hidden = false;
    }

    if (!window.__pcTabsResultsBound) {
      window.__pcTabsResultsBound = true;
      window.addEventListener("pc:browse_results", ev => {
        const d     = ev?.detail ?? {};
        const total = typeof d.total === "number" ? d.total : NaN;
        setTabsResultsCount(total, { show: d.show !== false });
      });
    }
    setTabsResultsCount(NaN, { show: false });

    tabsBar.querySelectorAll(".pc-tab").forEach(t => {
      t.classList.remove("is-active");
      t.classList.add("is-disabled");
      t.removeAttribute("aria-current");
    });

    const prices = tabsBar.querySelector('.pc-tab[data-pc-tab="prices"]');
    if (prices) {
      prices.classList.add("is-active");
      prices.classList.remove("is-disabled");
      prices.setAttribute("aria-current", "page");
    }

    if (!tabsBar._pcClickBound) {
      tabsBar._pcClickBound = true;
      tabsBar.addEventListener("click", e => {
        const a = e.target.closest(".pc-tab");
        if (!a) return;
        e.preventDefault(); e.stopPropagation();
        if (a.classList.contains("is-disabled")) handlePlusGateClick(e);
      });
    }

    if (!tabsBar._pcStickyReady) {
      tabsBar._pcStickyReady = true;
      const root = document.documentElement;

      const updateStuck = () => {
        if (tabsBar.hidden) {
          document.body.classList.remove("pc-tabs-stuck");
          tabsBar.classList.remove("is-stuck");
          return;
        }
        const navH  = Math.max(0, parseFloat(getComputedStyle(root).getPropertyValue("--pc-nav-h")) || 0);
        const r     = tabsBar.getBoundingClientRect();
        const stuck = window.scrollY > 30 && r.top <= navH + 0.5;
        tabsBar.classList.toggle("is-stuck", stuck);
        document.body.classList.toggle("pc-tabs-stuck", stuck);
      };

      let raf = 0;
      const onScroll = () => {
        if (raf) return;
        raf = requestAnimationFrame(() => { raf = 0; updateStuck(); });
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onScroll, { passive: true });
      requestAnimationFrame(updateStuck);
    }
  }

  // ─── Auth-gated product actions ───────────────────────────────────────────
  function wireAuthGatedProductActions() {
    if (document._pcAuthGatedProductActionsBound) return;
    document._pcAuthGatedProductActionsBound = true;

    document.addEventListener("click", e => {
      const target = e.target?.closest?.(".ph-tool");
      if (!target) return;
      if (clean(target.getAttribute("data-pc-plus")) === "1") return;
      if (!!(pcAuthUser && pcAuthUser.email)) return;

      e.preventDefault(); e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
      try { window.pcCloseAccountMenu?.(); } catch (_e) {}
      window.pcOpenSignIn?.();
    }, true);
  }

  function wireAuthRequiredLinks() {
    if (document._pcAuthRequiredLinksBound) return;
    document._pcAuthRequiredLinksBound = true;

    document.addEventListener("click", e => {
      const link = e.target?.closest?.('[data-auth-required="1"]');
      if (!link) return;
      if (!!(pcAuthUser && pcAuthUser.email)) return;

      e.preventDefault(); e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
      try { window.pcCloseAccountMenu?.(); } catch (_e) {}
      window.pcOpenSignIn?.();
    }, true);
  }

  // ─── Sidebar following toggle (expand/collapse) ───────────────────────────
  function wireSidebarFollowingToggle() {
    const toggle = document.getElementById("homeSideSubsToggle");
    const list   = document.getElementById("homeSideSubsList");
    if (!toggle || !list || toggle._pcFollowingBound) return;
    toggle._pcFollowingBound = true;

    const expanded = toggle.getAttribute("aria-expanded") === "true";
    list.hidden = !expanded;
    toggle.classList.toggle("is-open", expanded);

    toggle.addEventListener("click", e => {
      e.preventDefault();
      const next = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", String(next));
      list.hidden = !next;
      toggle.classList.toggle("is-open", next);
    });
  }

  // ─── Sidebar following: load & render ─────────────────────────────────────
  // Debounce so rapid auth-change events collapse into one fetch.
  let _sidebarFollowingTimer = 0;

  function scheduleSidebarFollowingLoad() {
    clearTimeout(_sidebarFollowingTimer);
    _sidebarFollowingTimer = setTimeout(loadSidebarFollowing, 120);
  }

  function _sidebarDefaultHtml() {
    return `
      <li>
        <a class="home-side__item home-side__item--sub" href="/following/" data-auth-required="1">
          <span class="home-side__subs-avatar home-side__subs-avatar--sm" aria-hidden="true"
                style="display:flex;align-items:center;justify-content:center;">
            <svg viewBox="0 -960 960 960" width="20" height="20">
              <path fill="currentColor" d="M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z"/>
            </svg>
          </span>
          <span class="home-side__label">Add Brands</span>
        </a>
      </li>
    `;
  }

  function _sidebarSignedOutBrandsHtml(sellers) {
    const brands = ["apple", "microsoft", "samsung", "google"];

    return brands.map((brand) => {
      const label = sidebarTitleCase(brand);
      const logo  = logoFromSellers(brand, sellers);
      const initial = sidebarEsc((label[0] || "?").toUpperCase());

      return `
        <li>
          <a class="home-side__item home-side__item--sub" href="/browse/?brand=${encodeURIComponent(label)}">
            <span
              class="home-side__subs-avatar home-side__subs-avatar--sm"
              aria-hidden="true"
              style="overflow:hidden;display:flex;align-items:center;justify-content:center;flex-shrink:0;"
            >
              ${
                logo
                  ? `<img
                      src="${sidebarEsc(logo)}"
                      alt=""
                      loading="lazy"
                      decoding="async"
                      style="width:100%;height:100%;object-fit:contain;border-radius:4px;"
                      onerror="this.style.display='none';this.nextElementSibling.style.display='inline';"
                    >
                    <span style="display:none;font-size:11px;font-weight:700;line-height:1;">${initial}</span>`
                  : `<span style="font-size:11px;font-weight:700;line-height:1;">${initial}</span>`
              }
            </span>
            <span class="home-side__label">${sidebarEsc(label)}</span>
          </a>
        </li>
      `;
    }).join("");
  }

  async function loadSidebarFollowing() {
    const list = document.getElementById("homeSideSubsList");
    if (!list) return;

    const signedIn = !!(pcAuthUser && pcAuthUser.email);

    // Not signed in → show static company list, never "Add Brands"
    if (!signedIn) {
      const sellers = await getSharedSellersMap();
      list.innerHTML = _sidebarSignedOutBrandsHtml(sellers);
      return;
    }

    try {
      const res  = await fetch("/api/following?type=brand", {
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        list.innerHTML = _sidebarDefaultHtml();
        return;
      }

      const rows    = Array.isArray(data.results) ? data.results : [];
      const sellers = await getSharedSellersMap();

      _renderSidebarFollowingRows(list, rows, sellers);
    } catch (err) {
      console.error("loadSidebarFollowing failed:", err);
      list.innerHTML = _sidebarDefaultHtml();
    }
  }

  function _renderSidebarFollowingRows(list, rows, sellers) {
    const MAX   = 5;
    const shown = rows.slice(0, MAX);
    const extra = rows.length - shown.length;

    // No follows yet → default
    if (!shown.length) {
      list.innerHTML = _sidebarDefaultHtml();
      return;
    }

    // Avatar: logo img with text fallback, or initial letter
    function avatarInner(label, key) {
      const logo = logoFromSellers(key, sellers);
      const initial = sidebarEsc((String(label || "?").trim()[0] || "?").toUpperCase());

      if (logo) {
        return `
          <img
            src="${sidebarEsc(logo)}"
            alt=""
            loading="lazy"
            decoding="async"
            style="width:100%;height:100%;object-fit:contain;border-radius:4px;"
            onerror="this.style.display='none';this.nextElementSibling.style.display='inline';"
          >
          <span style="display:none;font-size:11px;font-weight:700;line-height:1;">${initial}</span>
        `;
      }

      return `<span style="font-size:11px;font-weight:700;line-height:1;">${initial}</span>`;
    }

    let html = shown.map(row => {
      const labelRaw = row.entity_label || row.entity_key || "Brand";
      const label    = sidebarTitleCase(labelRaw);
      const key      = String(row.entity_key || "").trim().toLowerCase();
      const href     = `/browse/?brand=${encodeURIComponent(label)}`;

      return `
        <li>
          <a class="home-side__item home-side__item--sub" href="${sidebarEsc(href)}">
            <span
              class="home-side__subs-avatar home-side__subs-avatar--sm"
              aria-hidden="true"
              style="overflow:hidden;display:flex;align-items:center;justify-content:center;flex-shrink:0;"
            >
              ${avatarInner(label, key)}
            </span>
            <span class="home-side__label">${sidebarEsc(label)}</span>
          </a>
        </li>
      `;
    }).join("");

    // "See all" row when there are more than 5
    if (extra > 0) {
      html += `
        <li>
          <a class="home-side__item home-side__item--sub" href="/following/">
            <span
              class="home-side__subs-avatar home-side__subs-avatar--sm"
              aria-hidden="true"
              style="display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;"
            >+${extra}</span>
            <span class="home-side__label">See all following</span>
          </a>
        </li>
      `;
    }

    list.innerHTML = html;
  }

  // Expose so the dashboard follow-button can trigger a sidebar refresh
  window.pcRefreshSidebarFollowing = scheduleSidebarFollowingLoad;

  // ─── Auth-required page gate ───────────────────────────────────────────────
  function maybeOpenAuthRequiredPage() {
    const isAuthPage = clean(document.body?.getAttribute("data-auth-page")) === "1";
    if (!isAuthPage || (pcAuthUser && pcAuthUser.email)) return;
    window.pcOpenSignIn?.();
  }

  // ─── Partial loader ───────────────────────────────────────────────────────
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

  // ─── Boot ─────────────────────────────────────────────────────────────────
  await Promise.all([
    loadPartial("site-header", "/partials/header.html"),
    loadPartial("site-footer", "/partials/footer.html"),
  ]);

  // Apply cached auth immediately (fast, no network)
  applyAuthUi(getStoredAuthUser());

  // Wire all UI
  wireHeaderSearch();
  wireBrowseTabs();
  wirePlusClicks();
  wireAccountMenu();
  wireSignIn();
  wireAuthGatedProductActions();
  wireAuthRequiredLinks();
  wireSidebarFollowingToggle();

  // Initial sidebar following load (uses cached user, fast)
  loadSidebarFollowing();

  // Whenever auth state changes (sign in / sign out / sync), refresh the sidebar.
  // Using a debounce so rapid back-to-back calls collapse into one fetch.
  window.addEventListener("pc:auth_changed", scheduleSidebarFollowingLoad);

  // Sync with server (confirms real session) then re-run gates
  syncAuthUi().finally(() => {
    maybeOpenAuthRequiredPage();
    // loadSidebarFollowing will fire via pc:auth_changed dispatched by syncAuthUi → applyAuthUi
  });
})();