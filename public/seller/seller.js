// public/seller/seller.js
(() => {
  const $ = (s) => document.querySelector(s);
  const norm = (s) => String(s ?? "").trim();

  const els = {
    meta: () => $("#meta"),
    emptyInline: () => $("#emptyInline"),
    sellerPanel: () => $("#sellerPanel"),
    grid: () => $("#grid"),
    pager: () => document.querySelector(".pager"),
  };

  const EXTERNAL_SVG = `
    <svg xmlns="http://www.w3.org/2000/svg"
         viewBox="0 -960 960 960"
         width="20" height="20"
         style="width:20px;height:20px;display:block"
         aria-hidden="true" focusable="false">
      <path d="m216-160-56-56 464-464H360v-80h400v400h-80v-264L216-160Z"/>
    </svg>
  `;

  function go404() {
    location.replace("/404/");
  }

  function isValidSellerSlug(s) {
    const v = norm(s).toLowerCase();
    return !!v && /^[a-z0-9_-]+$/.test(v);
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function titleCaseWords(s) {
    const v = String(s ?? "").trim();
    if (!v) return "";
    return v
      .toLowerCase()
      .split(/\s+/g)
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
      .join(" ");
  }

  function initials(name) {
    const n = norm(name);
    if (!n) return "";
    const parts = n.split(/\s+/g).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }

  function setMeta(txt) {
    const el = els.meta();
    if (el) el.textContent = txt ?? "";
  }

  function setInlineEmptyHtml(html) {
    const el = els.emptyInline();
    if (!el) return;
    el.innerHTML = html || "";
    el.hidden = !html;
  }

  function clearUi() {
    setMeta("");
    setInlineEmptyHtml("");

    const grid = els.grid();
    if (grid) grid.innerHTML = "";

    const panel = els.sellerPanel();
    if (panel) {
      panel.hidden = true;
      panel.innerHTML = "";
    }

    const pager = els.pager();
    if (pager) pager.style.display = "none";
  }

  function parseSellerPath(pathname) {
    const clean = String(pathname || "/").replace(/\/+$/g, "/");
    const parts = clean.split("/").filter(Boolean);
    if (parts[0] !== "seller") return { slug: "" };
    if (parts.length >= 2) return { slug: norm(decodeURIComponent(parts[1] || "")) };
    return { slug: "" };
  }

  function buildSellerPath(slug) {
    const n = norm(slug).toLowerCase();
    if (!n) return "/seller/";
    return `/seller/${encodeURIComponent(n)}/`;
  }

  function prettyName(raw) {
    const s = norm(raw);
    if (!s) return "";
    if (/^[a-z]{2,4}$/.test(s)) return s.toUpperCase();
    if (s === s.toLowerCase()) return titleCaseWords(s);
    return s;
  }

  function labelFromKey(k) {
    const s = String(k ?? "").trim();
    if (!s) return "";
    const spaced = s.replace(/_/g, " ").replace(/\s+/g, " ").trim();
    return spaced
      .split(" ")
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
      .join(" ");
  }

  function absUrl(pathOrUrl) {
    const s = String(pathOrUrl ?? "").trim();
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) return s;
    if (s.startsWith("/")) return location.origin + s;
    return "";
  }

  function upsertMetaByName(name, content) {
    const c = String(content ?? "").trim();
    if (!name) return;
    let el = document.querySelector(`meta[name="${CSS.escape(name)}"]`);
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute("name", name);
      document.head.appendChild(el);
    }
    el.setAttribute("content", c);
  }

  function upsertMetaByProp(prop, content) {
    const c = String(content ?? "").trim();
    if (!prop) return;
    let el = document.querySelector(`meta[property="${CSS.escape(prop)}"]`);
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute("property", prop);
      document.head.appendChild(el);
    }
    el.setAttribute("content", c);
  }

  function upsertLinkCanonical(href) {
    const h = String(href ?? "").trim();
    let el = document.querySelector(`link[rel="canonical"]`);
    if (!el) {
      el = document.createElement("link");
      el.setAttribute("rel", "canonical");
      document.head.appendChild(el);
    }
    el.setAttribute("href", h);
  }

  function upsertJsonLd(id, obj) {
    const sid = String(id ?? "").trim() || "jsonld";
    let el = document.getElementById(sid);
    if (!el) {
      el = document.createElement("script");
      el.type = "application/ld+json";
      el.id = sid;
      document.head.appendChild(el);
    }
    el.textContent = JSON.stringify(obj);
  }

  function buildSellerDescription(seller) {
    const parts = [];
    const name = norm(seller?.name);
    const type = norm(seller?.type);
    const locationTxt = norm(seller?.location);
    const founded = seller?.founded;

    if (type) parts.push(type);
    if (locationTxt) parts.push(`Location: ${locationTxt}`);
    if (Number.isFinite(Number(founded)) && Number(founded) > 0) parts.push(`Founded: ${Number(founded)}`);

    const rp = norm(seller?.policies?.return_period);
    const pm = norm(seller?.policies?.price_match);
    if (rp) parts.push(`Returns: ${rp}`);
    if (pm) parts.push(`Price match: ${pm}`);

    const base = name ? `Seller information for ${name} on PriceCheck.` : `Seller information on PriceCheck.`;
    const tail = parts.length ? ` ${parts.join(". ")}.` : "";
    return (base + tail).trim();
  }

  function applySellerSeo(slug, seller) {
    const siteName = "PriceCheck";
    const s = norm(slug).toLowerCase();

    const name = norm(seller?.name) || prettyName(s);
    const title = `${name} Seller Information | ${siteName}`;
    const desc = buildSellerDescription(seller);

    const canonicalPath = buildSellerPath(s);
    const canonicalUrl = `${location.origin}${canonicalPath}`;

    document.title = title;

    upsertMetaByName("description", desc);
    upsertMetaByName("robots", "index,follow");
    upsertLinkCanonical(canonicalUrl);

    // Open Graph
    upsertMetaByProp("og:site_name", siteName);
    upsertMetaByProp("og:type", "website");
    upsertMetaByProp("og:title", title);
    upsertMetaByProp("og:description", desc);
    upsertMetaByProp("og:url", canonicalUrl);

    const ogImage = absUrl(seller?.logo);
    if (ogImage) upsertMetaByProp("og:image", ogImage);

    // Twitter
    upsertMetaByName("twitter:card", ogImage ? "summary_large_image" : "summary");
    upsertMetaByName("twitter:title", title);
    upsertMetaByName("twitter:description", desc);
    if (ogImage) upsertMetaByName("twitter:image", ogImage);

    // JSON-LD Organization
    const org = {
      "@context": "https://schema.org",
      "@type": "Organization",
      name,
      url: norm(seller?.website) || canonicalUrl,
      logo: ogImage || undefined,
      foundingDate:
        Number.isFinite(Number(seller?.founded)) && Number(seller.founded) > 0
          ? String(Number(seller.founded))
          : undefined,
      areaServed: norm(seller?.location) || undefined,
      sameAs: norm(seller?.website) ? [norm(seller.website)] : undefined,
    };

    const phone = norm(seller?.contact?.phone);
    if (phone) {
      org.contactPoint = [
        {
          "@type": "ContactPoint",
          telephone: phone,
          contactType: "customer support",
        },
      ];
    }

    const cleaned = JSON.parse(JSON.stringify(org));
    upsertJsonLd("seller-jsonld", cleaned);
  }

  async function apiJson(url) {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const txt = await res.text().catch(() => "");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    let data = null;
    try {
      data = txt ? JSON.parse(txt) : null;
    } catch {
      throw new Error("Bad JSON");
    }

    if (!data || data.ok !== true) {
      throw new Error((data && (data.error || data.message)) || "API error");
    }

    return data;
  }

  function rowsFromFlatObject(obj, opts = {}) {
    const rows = [];
    const hideKeys = new Set((opts.hideKeys || []).map((k) => String(k).toLowerCase().trim()));

    for (const k of Object.keys(obj || {})) {
      const keyLower = String(k).toLowerCase().trim();
      if (hideKeys.has(keyLower)) continue;

      const rawVal = obj[k];
      if (rawVal === null || rawVal === undefined) continue;

      const valStr = typeof rawVal === "boolean" ? (rawVal ? "Yes" : "No") : String(rawVal).trim();
      if (!valStr) continue;

      rows.push(`
        <div class="seller-row">
          <div class="seller-k">${escapeHtml(labelFromKey(k))}</div>
          <div class="seller-v">${escapeHtml(valStr)}</div>
        </div>
      `);
    }

    return rows;
  }

  function renderSection(title, rowsHtml) {
    if (!rowsHtml || !rowsHtml.length) return "";
    return `
      <div class="seller-section">
        <div class="seller-section-title">${escapeHtml(title)}</div>
        <div class="seller-table">${rowsHtml.join("")}</div>
      </div>
    `;
  }

  function renderSellerPanel(slug, seller) {
    const panel = els.sellerPanel();
    if (!panel) return;

    const displayName = prettyName(seller.name || slug);

    const website = norm(seller.website || "");
    const logo = norm(seller.logo || "");

    const topFacts = {
      type: seller.type || "",
      location: seller.location || "",
      founded: seller.founded || "",
      owned_by: seller.owned_by || "",
    };

    const topRows = rowsFromFlatObject(topFacts);

    const policiesRows = rowsFromFlatObject(seller.policies || {});
    const contactRows = (() => {
      const c = seller.contact && typeof seller.contact === "object" ? seller.contact : {};
      const rows = [];

      if (norm(c.phone)) {
        rows.push(`
          <div class="seller-row">
            <div class="seller-k">Phone</div>
            <div class="seller-v"><a class="seller-link" href="tel:${escapeHtml(c.phone)}">${escapeHtml(c.phone)}</a></div>
          </div>
        `);
      }

      if (c.chat_available === true || c.chat_available === false) {
        rows.push(`
          <div class="seller-row">
            <div class="seller-k">Chat Available</div>
            <div class="seller-v">${c.chat_available ? "Yes" : "No"}</div>
          </div>
        `);
      }

      if (norm(c.support_page)) {
        rows.push(`
          <div class="seller-row">
            <div class="seller-k">Support Page</div>
            <div class="seller-v">
              <a class="seller-link" href="${escapeHtml(c.support_page)}" target="_blank" rel="noopener noreferrer">
                ${escapeHtml(c.support_page)}
              </a>
            </div>
          </div>
        `);
      }

      return rows;
    })();

    const sections = [
      renderSection("Overview", topRows),
      renderSection("Policies", policiesRows),
      renderSection("Support", contactRows),
    ].filter(Boolean);

    const avatarFallback = escapeHtml(initials(displayName) || displayName[0] || "");

    panel.hidden = false;
    panel.innerHTML = `
      <div class="seller-card">
        <div class="seller-left">
          <div class="seller-avatar" aria-hidden="true">
            ${
              logo
                ? `<img class="seller-logo" src="${escapeHtml(logo)}" alt="${escapeHtml(displayName)}" loading="lazy">`
                : avatarFallback
            }
          </div>

          <div class="seller-nameRow">
            <div class="seller-name">${escapeHtml(displayName)}</div>
            ${
              website
                ? `<a class="seller-ext" href="${escapeHtml(website)}" target="_blank" rel="noopener noreferrer" aria-label="Website">${EXTERNAL_SVG}</a>`
                : ""
            }
          </div>
        </div>

        <div class="seller-right">
          ${sections.length ? sections.join("") : ``}
        </div>
      </div>
    `;
  }

  async function loadSeller(slug) {
    clearUi();

    const q = norm(slug).toLowerCase();

    // No browse/search page. Anything without a real slug is 404.
    if (!q) {
      go404();
      return;
    }

    // Invalid slug format is 404.
    if (!isValidSellerSlug(q)) {
      go404();
      return;
    }

    setMeta("Loading...");

    let data;
    try {
      data = await apiJson(`/api/seller?id=${encodeURIComponent(q)}`);
    } catch {
      go404();
      return;
    }

    // Not in JSON: 404. No inline message.
    if (!data || !data.found || !data.seller) {
      go404();
      return;
    }

    setMeta("");
    applySellerSeo(q, data.seller);
    renderSellerPanel(q, data.seller);

    const grid = els.grid();
    if (grid) grid.innerHTML = "";
  }

  document.addEventListener("DOMContentLoaded", () => {
    const parsed = parseSellerPath(location.pathname);
    loadSeller(parsed.slug).catch(() => go404());

    window.addEventListener("popstate", () => {
      const p = parseSellerPath(location.pathname);
      loadSeller(p.slug).catch(() => go404());
    });
  });
})();